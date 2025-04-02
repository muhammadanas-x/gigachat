/**
 * RoomPairer - Handles room joining with invite codes
 * Following Autopass patterns and best practices
 */
const ReadyResource = require('ready-resource')
const BlindPairing = require('blind-pairing')
const Hyperswarm = require('hyperswarm')
const z32 = require('z32')
const b4a = require('b4a')

/**
 * RoomPairer class manages the room joining process
 * 
 * @class
 * @extends ReadyResource
 */
class RoomPairer extends ReadyResource {
  /**
   * Create a new RoomPairer instance
   * @param {object} store - Corestore instance
   * @param {string} invite - Invite code (z32 encoded)
   * @param {object} [opts={}] - Configuration options
   * @param {Array|string} [opts.bootstrap] - Bootstrap servers for the swarm
   * @param {boolean} [opts.debug=false] - Enable debug logging
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
    this.room = null
    this.debug = !!opts.debug
    this._closing = false

    this.ready().catch(err => {
      if (!this._closing) {
        if (this.debug) console.error('Error initializing RoomPairer:', err)
        this.emit('error', err)
      }
    })
  }

  /**
   * Initialize the pairer
   * @private
   */
  async _open() {
    try {
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
        if (this.debug) {
          console.log('RoomPairer: New connection from',
            b4a.toString(peerInfo.publicKey, 'hex').slice(0, 8) + '...')
        }
        store.replicate(connection)
      })

      // Create a BlindPairing instance
      this.pairing = new BlindPairing(this.swarm)

      try {
        // Get the core key to use for pairing
        const RoomManager = require('./room-manager')
        const core = await this.store.get({ name: 'local', active: false })
        await core.ready()
        const key = core.key
        await core.close()

        // Add a pairing candidate
        this.candidate = this.pairing.addCandidate({
          invite: z32.decode(this.invite),
          userData: key,
          onadd: async (result) => {
            if (this.debug) {
              console.log('RoomPairer: Pairing successful')
            }

            if (this._closing) return

            if (this.room === null) {
              this.room = new RoomManager(this.store, {
                swarm: this.swarm,
                key: result.key,
                encryptionKey: result.encryptionKey,
                bootstrap: this.bootstrap,
                debug: this.debug
              })
            }

            // Clean up references we don't need anymore
            this.swarm = null
            this.store = null

            // Resolve if someone is waiting
            if (this.onresolve) this._whenWritable()

            // Close the candidate
            if (this.candidate) {
              this.candidate.close().catch(err => {
                if (this.debug && !this._closing) {
                  console.error('Error closing candidate:', err)
                }
              })
            }
          }
        })
      } catch (err) {
        if (this._closing) return
        if (this.debug) console.error('Error adding pairing candidate:', err)
        throw err
      }
    } catch (err) {
      if (this._closing) return
      if (this.debug) console.error('Error in RoomPairer._open:', err)
      throw err
    }
  }

  /**
   * Wait until the room is writable before resolving
   * @private
   */
  _whenWritable() {
    if (!this.room || !this.room.base) {
      setTimeout(() => this._whenWritable(), 100)
      return
    }

    if (this.room.base.writable) {
      this.onresolve(this.room)
      return
    }

    const check = () => {
      if (this.room.base.writable) {
        this.room.base.off('update', check)
        this.onresolve(this.room)
      }
    }

    this.room.base.on('update', check)
  }

  /**
   * Close the pairer and clean up resources
   * @private
   */
  async _close() {
    this._closing = true

    const closingPromises = []

    if (this.candidate !== null) {
      closingPromises.push(this.candidate.close().catch(err => {
        if (this.debug) console.error('Error closing candidate:', err)
      }))
    }

    if (this.swarm !== null) {
      closingPromises.push(this.swarm.destroy().catch(err => {
        if (this.debug) console.error('Error destroying swarm:', err)
      }))
    }

    // Wait for all resources to close
    try {
      await Promise.all(closingPromises)
    } catch (err) {
      if (this.debug) console.error('Error during RoomPairer close:', err)
    }

    // Clean up store only after network resources are closed
    if (this.store !== null) {
      try {
        await this.store.close()
      } catch (err) {
        if (this.debug) console.error('Error closing store:', err)
      }
    }

    if (this.onreject) {
      this.onreject(new Error('Pairing closed'))
    } else if (this.room) {
      try {
        await this.room.close()
      } catch (err) {
        if (this.debug) console.error('Error closing room after pairing:', err)
      }
    }
  }

  /**
   * Get a promise that resolves when pairing is complete
   * @returns {Promise<RoomManager>} The paired room
   */
  finished() {
    return new Promise((resolve, reject) => {
      this.onresolve = resolve
      this.onreject = reject
    })
  }
}

module.exports = RoomPairer
