// Gigauser.js - User module for Gigachat
// Handle user profile, device pairing, and room management

const Autobase = require('autobase')
const BlindPairing = require('blind-pairing')
const HyperDB = require('hyperdb')
const Hyperswarm = require('hyperswarm')
const ReadyResource = require('ready-resource')
const z32 = require('z32')
const b4a = require('b4a')
const crypto = require('crypto')
const { Router, dispatch } = require('./spec/hyperdispatch')
const db = require('./spec/db/index.js')

/**
 * A class that handles the pairing process for the Gigauser module
 */
class GigauserPairer extends ReadyResource {
  /**
   * Create a new GigauserPairer instance
   * @param {object} store - Corestore instance 
   * @param {string} invite - Invite code for pairing
   * @param {object} opts - Configuration options
   * @param {object} opts.bootstrap - Bootstrap nodes for the swarm
   * @param {object} opts.keyPair - Optional keyPair to use for connection
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

    this.ready().catch(noop)
  }

  async _open() {
    await this.store.ready()
    this.swarm = new Hyperswarm({
      keyPair: await this.store.createKeyPair('hyperswarm'),
      bootstrap: this.bootstrap
    })

    const store = this.store
    this.swarm.on('connection', (connection, peerInfo) => {
      store.replicate(connection)
    })

    this.pairing = new BlindPairing(this.swarm)
    const core = Autobase.getLocalCore(this.store)
    await core.ready()
    const key = core.key
    await core.close()
    this.candidate = this.pairing.addCandidate({
      invite: z32.decode(this.invite),
      userData: key,
      onadd: async (result) => {
        if (this.user === null) {
          this.user = new Gigauser(this.store, {
            swarm: this.swarm,
            key: result.key,
            encryptionKey: result.encryptionKey,
            bootstrap: this.bootstrap
          })
        }
        this.swarm = null
        this.store = null
        if (this.onresolve) this._whenWritable()
        this.candidate.close().catch(noop)
      }
    })
  }

  _whenWritable() {
    if (this.user.base.writable) return
    const check = () => {
      if (this.user.base.writable) {
        this.user.base.off('update', check)
        this.onresolve(this.user)
      }
    }
    this.user.base.on('update', check)
  }

  async _close() {
    if (this.candidate !== null) {
      await this.candidate.close()
    }

    if (this.swarm !== null) {
      await this.swarm.destroy()
    }

    if (this.store !== null) {
      await this.store.close()
    }

    if (this.onreject) {
      this.onreject(new Error('Pairing closed'))
    } else if (this.user) {
      await this.user.close()
    }
  }

  finished() {
    return new Promise((resolve, reject) => {
      this.onresolve = resolve
      this.onreject = reject
    })
  }
}

/**
 * The main Gigauser class that handles user data, profile management,
 * and device pairing for the Gigachat application.
 */
class Gigauser extends ReadyResource {
  /**
   * Create a new Gigauser instance
   * @param {object} corestore - Corestore instance
   * @param {object} opts - Configuration options
   * @param {object} opts.swarm - Existing Hyperswarm instance (optional)
   * @param {Buffer} opts.key - Autobase key
   * @param {Buffer} opts.encryptionKey - Encryption key for the autobase
   * @param {array} opts.bootstrap - Bootstrap nodes for the swarm
   * @param {string|array} opts.seed - 20-word seed for the user's identity
   */
  constructor(corestore, opts = {}) {
    super()
    this.router = new Router()
    this.store = corestore
    this.swarm = opts.swarm || null
    this.base = null
    this.bootstrap = opts.bootstrap || null
    this.member = null
    this.pairing = null
    this.replicate = opts.replicate !== false

    // User identity
    this.seed = opts.seed || null
    this.keyPair = null
    this.publicKey = null

    // User profile data
    this.profile = {
      name: null,
      avatar: null,
      status: null,
      metadata: {}
    }

    // User's rooms and devices
    this.rooms = []
    this.devices = []
    this.settings = {}

    // Register handlers for commands
    this._registerHandlers()

    this._boot(opts)
    this.ready().catch(noop)
  }

  /**
   * Register handlers for autobase commands
   * @private
   */
  _registerHandlers() {
    // Core writer management commands
    this.router.add('@gigauser/remove-writer', async (data, context) => {
      await context.base.removeWriter(data.key)
    })

    this.router.add('@gigauser/add-writer', async (data, context) => {
      await context.base.addWriter(data.key)
    })

    this.router.add('@gigauser/add-invite', async (data, context) => {
      await context.view.insert('@gigauser/invite', data)
    })

    // User profile commands
    this.router.add('@gigauser/set-profile', async (data, context) => {
      // First try deleting existing profile
      try {
        await context.view.delete('@gigauser/profile', { key: data.key })
      } catch (e) {
        // Ignore errors if no existing record
      }
      // Then insert the new profile
      await context.view.insert('@gigauser/profile', data)
    })

    // Room management commands
    this.router.add('@gigauser/update-rooms', async (data, context) => {
      try {
        await context.view.delete('@gigauser/rooms', { key: data.key })
      } catch (e) {
        // Ignore errors if no existing record
      }
      await context.view.insert('@gigauser/rooms', data)
    })

    // Device management commands
    this.router.add('@gigauser/update-devices', async (data, context) => {
      try {
        await context.view.delete('@gigauser/devices', { key: data.key })
      } catch (e) {
        // Ignore errors if no existing record
      }
      await context.view.insert('@gigauser/devices', data)
    })

    // Settings commands
    this.router.add('@gigauser/update-settings', async (data, context) => {
      try {
        await context.view.delete('@gigauser/settings', { key: data.key })
      } catch (e) {
        // Ignore errors if no existing record
      }
      await context.view.insert('@gigauser/settings', data)
    })
  }

  /**
   * Initialize the autobase instance
   * @private
   * @param {object} opts - Configuration options
   */
  _boot(opts = {}) {
    const { encryptionKey, key } = opts

    this.base = new Autobase(this.store, key, {
      encrypt: true,
      encryptionKey,
      open(store) {
        return HyperDB.bee(store.get('view'), db, {
          extension: false,
          autoUpdate: true
        })
      },
      apply: this._apply.bind(this)
    })

    this.base.on('update', () => {
      if (!this.base._interrupting) this.emit('update')
    })
  }

  /**
   * Apply function for autobase updates
   * @private
   * @param {array} nodes - Nodes to process
   * @param {object} view - Current view
   * @param {object} base - Autobase instance
   */
  async _apply(nodes, view, base) {
    for (const node of nodes) {
      try {
        await this.router.dispatch(node.value, { view, base })
      } catch (err) {
        console.error('Error dispatching node:', err)
      }
    }
    await view.flush()
  }

  /**
   * Open and initialize the user module
   * @private
   */
  async _open() {
    await this.base.ready()

    // Create identity if seed was provided
    if (this.seed) {
      await this._createIdentity(this.seed)
    }

    if (this.replicate) {
      await this._replicate()
    }

    // Load existing user data
    await this._loadUserData()
  }

  /**
   * Create cryptographic identity from seed
   * @private
   * @param {string|array} seed - 20-word seed phrase
   */
  async _createIdentity(seed) {
    // Normalize seed to string if it's an array
    if (Array.isArray(seed)) {
      seed = seed.join(' ')
    }
    this.seed = seed

    // Create a deterministic keypair from the seed
    const seedBuffer = b4a.from(seed)
    const hash = crypto.createHash('sha256').update(seedBuffer).digest()

    // Derive key pair from hash
    // In a real implementation, use proper key derivation
    this.publicKey = hash.slice(0, 32)
    this.keyPair = {
      publicKey: this.publicKey,
      secretKey: hash // This is for illustration - real implementation would use proper key derivation
    }
  }

  /**
   * Load user data from the autobase
   * @private
   */
  async _loadUserData() {
    if (!this.publicKey) {
      return false
    }

    const key = b4a.toString(this.publicKey, 'hex')

    // Load profile
    try {
      const profileData = await this.base.view.get('@gigauser/profile', { key })
      if (profileData) {
        this.profile = profileData.value
      } else {
        // Create default profile if none exists
        await this._createDefaultProfile()
      }
    } catch (err) {
      // Create default profile if error occurred
      await this._createDefaultProfile()
    }

    // Load rooms
    try {
      const roomsData = await this.base.view.get('@gigauser/rooms', { key })
      if (roomsData) {
        this.rooms = roomsData.value
      }
    } catch (err) {
      this.rooms = []
    }

    // Load devices
    try {
      const devicesData = await this.base.view.get('@gigauser/devices', { key })
      if (devicesData) {
        this.devices = devicesData.value
      }
    } catch (err) {
      this.devices = []
    }

    // Load settings
    try {
      const settingsData = await this.base.view.get('@gigauser/settings', { key })
      if (settingsData) {
        this.settings = settingsData.value
      }
    } catch (err) {
      this.settings = {}
    }

    return true
  }

  /**
   * Create a default user profile
   * @private
   */
  async _createDefaultProfile() {
    if (!this.publicKey) return

    const key = b4a.toString(this.publicKey, 'hex')

    this.profile = {
      name: `User-${key.substring(0, 8)}`,
      avatar: null,
      status: 'Available',
      metadata: {}
    }

    const profileData = {
      key,
      value: JSON.stringify(this.profile)
    }

    await this.base.append(dispatch('@gigauser/set-profile', profileData))
  }

  /**
   * Close the Gigauser instance
   * @private
   */
  async _close() {
    if (this.swarm) {
      if (this.member) await this.member.close()
      if (this.pairing) await this.pairing.close()
      await this.swarm.destroy()
    }

    await this.base.close()
  }

  /**
   * Set up replication for the autobase
   * @private
   */
  async _replicate() {
    await this.base.ready()
    if (this.swarm === null) {
      this.swarm = new Hyperswarm({
        keyPair: await this.store.createKeyPair('hyperswarm'),
        bootstrap: this.bootstrap
      })
      this.swarm.on('connection', (connection, peerInfo) => {
        this.store.replicate(connection)
      })
    }

    this.pairing = new BlindPairing(this.swarm)
    this.member = this.pairing.addMember({
      discoveryKey: this.base.discoveryKey,
      onadd: async (candidate) => {
        try {
          const id = candidate.inviteId
          const inv = await this.base.view.findOne('@gigauser/invite', {})
          if (!b4a.equals(inv.id, id)) {
            return
          }
          candidate.open(inv.publicKey)
          await this.addWriter(candidate.userData)
          candidate.confirm({
            key: this.base.key,
            encryptionKey: this.base.encryptionKey
          })

          // Add the new device
          this.addDevice({
            publicKey: candidate.userData,
            name: 'New Device',
            lastSeen: Date.now()
          })
        } catch (err) {
          console.error('Error during pairing acceptance:', err)
        }
      }
    })

    this.swarm.join(this.base.discoveryKey)
  }

  /**
   * Get the writer key for this instance
   * @returns {Buffer} Writer key
   */
  get writerKey() {
    return this.base.local.key
  }

  /**
   * Get the autobase key
   * @returns {Buffer} Autobase key
   */
  get key() {
    return this.base.key
  }

  /**
   * Get the discovery key for networking
   * @returns {Buffer} Discovery key
   */
  get discoveryKey() {
    return this.base.discoveryKey
  }

  /**
   * Get the encryption key
   * @returns {Buffer} Encryption key
   */
  get encryptionKey() {
    return this.base.encryptionKey
  }

  /**
   * Check if this instance is writable
   * @returns {boolean} True if writable
   */
  get writable() {
    return this.base.writable
  }

  /**
   * Create an identity from a seed phrase
   * @param {string|array} seed - 20-word seed phrase
   * @returns {object} The public key of the created identity
   */
  async createIdentity(seed) {
    await this._createIdentity(seed)
    await this._createDefaultProfile()
    return {
      publicKey: this.publicKey,
      profile: this.profile
    }
  }

  /**
   * Update the user's profile
   * @param {object} profileData - Profile data to update
   * @returns {object} Updated profile
   */
  async updateProfile(profileData) {
    if (!this.publicKey) {
      throw new Error('Identity not created')
    }

    const key = b4a.toString(this.publicKey, 'hex')

    // Merge with existing profile
    this.profile = {
      ...this.profile,
      ...profileData
    }

    const data = {
      key,
      value: JSON.stringify(this.profile)
    }

    await this.base.append(dispatch('@gigauser/set-profile', data))
    return this.profile
  }

  /**
   * Get the user's complete profile
   * @returns {object} User profile
   */
  getProfile() {
    return {
      publicKey: this.publicKey,
      profile: this.profile,
      rooms: this.rooms,
      devices: this.devices,
      settings: this.settings
    }
  }

  /**
   * Add a room to the user's room list
   * @param {object} roomData - Room data
   * @returns {array} Updated room list
   */
  async addRoom(roomData) {
    if (!this.publicKey) {
      throw new Error('Identity not created')
    }

    const key = this._safeKeyString(this.publicKey)
    if (!key) throw new Error('Invalid public key')

    // Check if room already exists
    const existingIndex = this.rooms.findIndex(r => r.id === roomData.id)
    if (existingIndex >= 0) {
      // Update existing room
      this.rooms[existingIndex] = {
        ...this.rooms[existingIndex],
        ...roomData,
        lastAccessed: Date.now()
      }
    } else {
      // Add new room
      this.rooms.push({
        ...roomData,
        lastAccessed: Date.now()
      })
    }

    try {
      const data = {
        key,
        value: JSON.stringify(this.rooms)
      }

      await this.base.append(dispatch('@gigauser/update-rooms', data))
      return this.rooms
    } catch (err) {
      console.error('Error adding room:', err)
      throw err
    }
  }

  /**
   * Remove a room from the user's room list
   * @param {string} roomId - Room ID to remove
   * @returns {array} Updated room list
   */
  async removeRoom(roomId) {
    if (!this.publicKey) {
      throw new Error('Identity not created')
    }

    const key = b4a.toString(this.publicKey, 'hex')

    // Filter out the room
    this.rooms = this.rooms.filter(r => r.id !== roomId)

    const data = {
      key,
      value: JSON.stringify(this.rooms
      )
    }

    await this.base.append(dispatch('@gigauser/update-rooms', data))
    return this.rooms
  }

  /**
   * Get all rooms the user is a member of
   * @returns {array} List of rooms
   */
  getRooms() {
    return this.rooms
  }

  /**
   * Add a device to the user's device list
   * @param {object} deviceData - Device data
   * @returns {array} Updated device list
   */
  async addDevice(deviceData) {
    if (!this.publicKey) {
      throw new Error('Identity not created')
    }

    const key = this._safeKeyString(this.publicKey)
    if (!key) throw new Error('Invalid public key')

    // Convert publicKey to hex string for comparison
    const deviceKey = this._safeKeyString(deviceData.publicKey)
    if (!deviceKey) {
      throw new Error('Invalid device public key')
    }

    // Check if device already exists
    const existingIndex = this.devices.findIndex(d => {
      const dKey = this._safeKeyString(d.publicKey)
      return dKey === deviceKey
    })

    if (existingIndex >= 0) {
      // Update existing device
      this.devices[existingIndex] = {
        ...this.devices[existingIndex],
        ...deviceData,
        publicKey: deviceKey, // Store as string
        lastSeen: Date.now()
      }
    } else {
      // Add new device
      this.devices.push({
        ...deviceData,
        publicKey: deviceKey, // Store as string
        lastSeen: Date.now()
      })
    }

    const data = {
      key,
      value: JSON.stringify(this.devices)
    }

    await this.base.append(dispatch('@gigauser/update-devices', data))
    return this.devices
  }

  /**
   * Remove a device from the user's device list
   * @param {string|Buffer} deviceKey - Public key of device to remove
   * @returns {array} Updated device list
   */
  async removeDevice(deviceKey) {
    if (!this.publicKey) {
      throw new Error('Identity not created')
    }

    const key = b4a.toString(this.publicKey, 'hex')

    // Convert to string for comparison
    const deviceKeyStr = b4a.isBuffer(deviceKey)
      ? b4a.toString(deviceKey, 'hex')
      : deviceKey

    // Filter out the device
    this.devices = this.devices.filter(d => {
      const dKey = b4a.isBuffer(d.publicKey)
        ? b4a.toString(d.publicKey, 'hex')
        : d.publicKey
      return dKey !== deviceKeyStr
    })

    const data = {
      key,
      value: JSON.stringify(this.devices)
    }

    await this.base.append(dispatch('@gigauser/update-devices', data))
    return this.devices
  }

  /**
   * Get all devices associated with the user
   * @returns {array} List of devices
   */
  getDevices() {
    return this.devices
  }

  /**
   * Update user settings
   * @param {object} newSettings - Settings to update
   * @returns {object} Updated settings
   */
  async updateSettings(newSettings) {
    if (!this.publicKey) {
      throw new Error('Identity not created')
    }

    const key = b4a.toString(this.publicKey, 'hex')

    // Merge with existing settings
    this.settings = {
      ...this.settings,
      ...newSettings
    }

    const data = {
      key,
      value: JSON.stringify(this.settings)
    }

    await this.base.append(dispatch('@gigauser/update-settings', data))
    return this.settings
  }

  /**
   * Get user settings
   * @returns {object} User settings
   */
  getSettings() {
    return this.settings
  }

  /**
   * Create a pairing invite for adding a new device
   * @returns {string} Invite code
   */
  async createPairingInvite() {
    if (this.opened === false) await this.ready()
    const existing = await this.base.view.findOne('@gigauser/invite', {})
    if (existing) {
      return z32.encode(existing.invite)
    }

    const { id, invite, publicKey, expires } = BlindPairing.createInvite(this.base.key)
    const record = { id, invite, publicKey, expires }
    await this.base.append(dispatch('@gigauser/add-invite', record))
    return z32.encode(record.invite)
  }

  /**
   * Add a writer to the autobase
   * @param {Buffer} key - Writer key to add
   * @returns {boolean} Success indicator
   */
  async addWriter(key) {
    await this.base.append(dispatch('@gigauser/add-writer', { key: b4a.isBuffer(key) ? key : b4a.from(key) }))
    return true
  }

  /**
   * Remove a writer from the autobase
   * @param {Buffer} key - Writer key to remove
   */
  async removeWriter(key) {
    await this.base.append(dispatch('@gigauser/remove-writer', { key: b4a.isBuffer(key) ? key : b4a.from(key) }))
  }

  /**
   * Pair a device using an invite code
   * @static
   * @param {object} store - Corestore instance
   * @param {string} invite - Invite code
   * @param {object} opts - Additional options
   * @returns {Promise<Gigauser>} New Gigauser instance
   */
  static pair(store, invite, opts) {
    return new GigauserPairer(store, invite, opts)
  }

  /**
   * Static method to pair a new device
   * @static
   * @param {object} store - Corestore instance
   * @param {string} inviteCode - Invite code
   * @param {object} opts - Additional options
   * @returns {Promise<Gigauser>} Paired Gigauser instance
   */
  static async pairDevice(store, inviteCode, opts = {}) {
    if (!store) throw new Error('Corestore is required')
    if (!inviteCode) throw new Error('Invite code is required')

    try {
      // Create pairing instance
      const pair = Gigauser.pair(store, inviteCode, opts)

      // Wait for pairing to complete
      const user = await pair.finished()

      // Wait for user to be fully ready
      await user.ready()

      return user
    } catch (err) {
      console.error('Error pairing device:', err)
      throw err
    }
  }


  // Safely convert to/from buffer
  _safeBuffer(data) {
    if (Buffer.isBuffer(data)) return data
    if (typeof data === 'string') return b4a.from(data, 'hex')
    return null
  }

  // Safely convert key to string
  _safeKeyString(key) {
    if (typeof key === 'string') return key
    if (Buffer.isBuffer(key)) return b4a.toString(key, 'hex')
    return null
  }
}

function noop() { }

module.exports = Gigauser
