/**
 * UserPairer - Handles the device pairing process for UserManager
 * Heavily inspired by AutopassPairer but with improved error handling
 */
const ReadyResource = require('ready-resource')
const BlindPairing = require('blind-pairing')
const Hyperswarm = require('hyperswarm')
const Autobase = require('autobase')
const z32 = require('z32')
const b4a = require('b4a')

class UserPairer extends ReadyResource {
  /**
   * Create a new UserPairer instance
   * @param {object} store - Corestore instance
   * @param {string} invite - Invite code (z32 encoded)
   * @param {object} [opts={}] - Configuration options
   * @param {Array|string} [opts.bootstrap] - Bootstrap servers for the swarm
   */
  constructor(store, invite, opts = {}) {
    super()
    this.store = store
    this.invite = invite
    this.swarm = null
    this.pairing = null
    this.candidate = null
    this.bootstrap = opts.bootstrap || null
    this.onresolve = null
    this.onreject = null
    this.user = null
    this.debug = !!opts.debug

    this.ready().catch(err => {
      console.error('Error initializing UserPairer:', err)
    })
  }

  /**
   * Initialize the pairer
   * @private
   */
  async _open() {
    // Ensure store is ready
    await this.store.ready()

    // Create a hyperswarm for pairing
    this.swarm = new Hyperswarm({
      keyPair: await this.store.createKeyPair('hyperswarm'),
      bootstrap: this.bootstrap
    })

    // Set up replication for the store
    const store = this.store
    this.swarm.on('connection', (connection, peerInfo) => {
      if (this.debug) console.log('UserPairer: New connection', peerInfo.publicKey.toString('hex'))
      store.replicate(connection)
    })

    // Create a BlindPairing instance
    this.pairing = new BlindPairing(this.swarm)

    // Get a local core to use as user data
    const core = Autobase.getLocalCore(this.store)
    await core.ready()
    const key = core.key
    await core.close()

    try {
      // Add a pairing candidate
      this.candidate = this.pairing.addCandidate({
        invite: z32.decode(this.invite),
        userData: key,
        onadd: async (result) => {
          if (this.debug) console.log('UserPairer: Pairing successful', result)

          if (this.user === null) {
            const UserManager = require('./user-manager') // Dynamic import to avoid circular dependency
            this.user = new UserManager(this.store, {
              swarm: this.swarm,
              key: result.key,
              encryptionKey: result.encryptionKey,
              bootstrap: this.bootstrap
            })
          }

          // Clean up references we don't need anymore
          this.swarm = null
          this.store = null

          // Resolve if someone is waiting
          if (this.onresolve) this._whenWritable()

          // Close the candidate
          this.candidate.close().catch(err => {
            console.error('Error closing candidate:', err)
          })
        }
      })
    } catch (err) {
      console.error('Error adding pairing candidate:', err)
      throw err
    }
  }

  /**
   * Wait until the user is writable before resolving
   * @private
   */
  _whenWritable() {
    if (this.user.base.writable) {
      this.onresolve(this.user)
      return
    }

    const check = () => {
      if (this.user.base.writable) {
        this.user.base.off('update', check)
        this.onresolve(this.user)
      }
    }

    this.user.base.on('update', check)
  }

  /**
   * Close the pairer and clean up resources
   * @private
   */
  async _close() {
    const closing = []

    if (this.candidate !== null) {
      closing.push(this.candidate.close().catch(err => {
        console.error('Error closing candidate:', err)
      }))
    }

    if (this.swarm !== null) {
      closing.push(this.swarm.destroy().catch(err => {
        console.error('Error destroying swarm:', err)
      }))
    }

    if (this.store !== null) {
      closing.push(this.store.close().catch(err => {
        console.error('Error closing store:', err)
      }))
    }

    try {
      await Promise.all(closing)
    } catch (err) {
      console.error('Error during UserPairer close:', err)
    }

    if (this.onreject) {
      this.onreject(new Error('Pairing closed'))
    } else if (this.user) {
      await this.user.close().catch(err => {
        console.error('Error closing user after pairing:', err)
      })
    }
  }

  /**
   * Get a promise that resolves when pairing is complete
   * @returns {Promise<UserManager>} The paired user
   */
  finished() {
    return new Promise((resolve, reject) => {
      this.onresolve = resolve
      this.onreject = reject
    })
  }
}

module.exports = UserPairer
