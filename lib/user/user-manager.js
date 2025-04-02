/**
 * UserManager - Main class for managing user data and device synchronization
 * Inspired by Autopass but with enhanced functionality and error handling
 */
const ReadyResource = require('ready-resource')
const Autobase = require('autobase')
const BlindPairing = require('blind-pairing')
const Hyperswarm = require('hyperswarm')
const HyperDB = require('hyperdb')
const debounceify = require('debounceify')
const z32 = require('z32')
const b4a = require('b4a')
const crypto = require('crypto')
const { Router, dispatch } = require('../spec/hyperdispatch')
const db = require('../spec/db/index.js')
const UserPairer = require('./user-pairer')
const { generateKeyFromSeed } = require('../security/crypto.js')

/**
 * Helper function to safely handle operations that might throw
 * @private
 */
function noop() { }


class UserManager extends ReadyResource {
  /**
   * Create a new UserManager instance
   * @param {object} corestore - Corestore instance
   * @param {object} [opts={}] - Configuration options
   * @param {Buffer|string} [opts.seed] - Seed for deterministic key generation
   * @param {Buffer} [opts.key] - Key for loading existing user data
   * @param {Buffer} [opts.encryptionKey] - Key for encryption
   * @param {boolean} [opts.encrypt=true] - Whether to encrypt data
   * @param {object} [opts.swarm] - Existing Hyperswarm instance
   * @param {Array|string} [opts.bootstrap] - Bootstrap servers for the swarm
   * @param {boolean} [opts.debug=false] - Enable debug logging
   */
  constructor(corestore, opts = {}) {
    super()
    this.store = corestore
    this.router = new Router()
    this.swarm = opts.swarm || null
    this.bootstrap = opts.bootstrap || null
    this.debug = !!opts.debug
    this.base = null
    this.member = null
    this.pairing = null
    this.replicate = opts.replicate !== false
    this.encrypt = opts.encrypt !== false
    this.encryptionKey = opts.encryptionKey || null
    this.seed = opts.seed || null
    this.keyPair = null
    this.deviceName = opts.deviceName || 'Device-' + Math.floor(Math.random() * 10000)

    // Last update timestamp
    this.lastUpdate = Date.now()

    // In-memory cache for performance
    this._profileCache = null
    this._roomsCache = new Map()
    this._devicesCache = new Map()
    this._settingsCache = null

    // Setup update debouncer
    this._bump = debounceify(() => {
      this.lastUpdate = Date.now()
      return Promise.resolve()
    })

    // Register command handlers
    this._registerCommands()

    // Initialize the user manager
    this._boot(opts)
    this.ready().catch(err => {
      console.error('Error initializing UserManager:', err)
    })
  }

  /**
   * Register command handlers for the router
   * @private
   */
  _registerCommands() {
    // Writer management
    this.router.add('@usermanager/add-writer', async (data, context) => {
      await context.base.addWriter(data.key)
    })

    this.router.add('@usermanager/remove-writer', async (data, context) => {
      if (context.base.removeable(data.key)) {
        await context.base.removeWriter(data.key)
      }
    })

    // Invite management
    this.router.add('@usermanager/add-invite', async (data, context) => {
      await context.view.insert('@usermanager/invite', data)
    })

    // Profile management
    this.router.add('@usermanager/add-profile', async (data, context) => {
      try {
        await context.view.delete('@usermanager/profile', { id: data.id })
      } catch (err) {
        // Ignore errors if no existing profile
      }
      await context.view.insert('@usermanager/profile', data)
    })

    // Room management
    this.router.add('@usermanager/add-room', async (data, context) => {
      try {
        await context.view.delete('@usermanager/rooms', { id: data.id })
      } catch (err) {
        // Ignore errors if no existing room
      }
      await context.view.insert('@usermanager/rooms', data)
    })

    this.router.add('@usermanager/remove-room', async (data, context) => {
      await context.view.delete('@usermanager/rooms', { id: data.id })
    })

    // Device management
    this.router.add('@usermanager/add-device', async (data, context) => {
      try {
        await context.view.delete('@usermanager/devices', { id: data.id })
      } catch (err) {
        // Ignore errors if no existing device
      }
      await context.view.insert('@usermanager/devices', data)
    })

    this.router.add('@usermanager/remove-device', async (data, context) => {
      await context.view.delete('@usermanager/devices', { id: data.id })
    })

    // Settings management
    this.router.add('@usermanager/update-settings', async (data, context) => {
      try {
        await context.view.delete('@usermanager/settings', { id: data.id })
      } catch (err) {
        // Ignore errors if no existing settings
      }
      await context.view.insert('@usermanager/settings', data)
    })
  }

  /**
   * Initialize the Autobase for user data
   * @param {object} opts - Configuration options
   * @private
   */
  _boot(opts = {}) {
    const { key, encryptionKey } = opts

    this.base = new Autobase(this.store, key, {
      encrypt: this.encrypt,
      encryptionKey,
      open: (store) => {
        return HyperDB.bee(store.get('view'), db, {
          extension: false,
          autoUpdate: true
        })
      },
      apply: this._apply.bind(this)
    })

    this.base.on('update', () => {
      if (!this.base._interrupting) {
        this._cacheInvalidate()
        this.emit('update')
      }
    })

    this.base.on('error', (err) => {
      console.error('Autobase error:', err)
      this.emit('error', err)
    })
  }

  /**
   * Apply function for the Autobase
   * @private
   */
  async _apply(nodes, view, base) {
    try {
      for (const node of nodes) {
        if (!node.value) continue
        await this.router.dispatch(node.value, { view, base })
      }
      await view.flush()
    } catch (err) {
      console.error('Error in _apply:', err)
      throw err
    }
  }

  /**
   * Initialize the user manager
   * @private
   */
  async _open() {
    try {
      await this.base.ready()
      await this.store.ready()

      // Generate a keypair if seed is provided
      if (this.seed) {
        this.keyPair = await this.store.createKeyPair('identity', {
          seed: typeof this.seed === 'string' ? generateKeyFromSeed(this.seed) : this.seed
        })
      }

      if (this.replicate) {
        await this._setupReplication()
      }

      // Initialize user profile if this is a new user
      await this._initializeUser()

      // Add this device if not already registered
      await this._registerCurrentDevice()
    } catch (err) {
      console.error('Error in _open:', err)
      throw err
    }
  }

  /**
   * Set up replication for user data
   * @private
   */
  async _setupReplication() {
    try {
      await this.base.ready()

      if (this.swarm === null) {
        this.swarm = new Hyperswarm({
          keyPair: await this.store.createKeyPair('hyperswarm'),
          bootstrap: this.bootstrap
        })

        this.swarm.on('connection', (connection, peerInfo) => {
          if (this.debug) {
            console.log('UserManager: New connection', peerInfo.publicKey.toString('hex'))
          }
          this.store.replicate(connection)
        })
      }

      // Set up blind pairing
      this.pairing = new BlindPairing(this.swarm)

      // Add member to accept pairing requests
      this.member = this.pairing.addMember({
        discoveryKey: this.base.discoveryKey,
        onadd: async (candidate) => {
          try {
            // Verify the invite
            const id = candidate.inviteId
            const inv = await this.base.view.findOne('@usermanager/invite', {})

            if (!inv || !b4a.equals(inv.id, id)) {
              if (this.debug) console.log('UserManager: Invalid invite')
              return
            }

            // Open the candidate
            candidate.open(inv.publicKey)

            // Add the new device as a writer
            await this.addWriter(candidate.userData)

            // Send confirmation
            candidate.confirm({
              key: this.base.key,
              encryptionKey: this.base.encryptionKey
            })

            if (this.debug) console.log('UserManager: Pairing confirmed')
          } catch (err) {
            console.error('Error handling pairing request:', err)
          }
        }
      })

      // Join the swarm
      this.swarm.join(this.base.discoveryKey)
    } catch (err) {
      console.error('Error setting up replication:', err)
      throw err
    }
  }

  /**
   * Initialize user profile if not already exists
   * @private
   */
  async _initializeUser() {
    try {
      // Check if profile already exists
      const existingProfile = await this.getProfile()

      if (!existingProfile) {
        if (!this.keyPair) {
          // Generate a random keypair if none exists and no seed provided
          this.keyPair = await this.store.createKeyPair('identity')
        }

        // Create default profile
        const userId = b4a.toString(this.keyPair.publicKey, 'hex')
        const defaultProfile = {
          id: userId,
          name: 'User-' + Math.floor(Math.random() * 10000),
          status: 'Online',
          metadata: {}
        }

        await this.updateProfile(defaultProfile)

        // Create default settings
        const defaultSettings = {
          id: userId,
          theme: 'light',
          notifications: true,
          language: 'en',
          preferences: {}
        }

        await this.updateSettings(defaultSettings)
      } else {
        // If profile exists, make sure we have a keypair
        if (!this.keyPair) {
          const profileId = existingProfile.id
          // Try to derive keypair from id if possible, otherwise create a new one
          try {
            this.keyPair = await this.store.createKeyPair('identity', {
              publicKey: b4a.from(profileId, 'hex')
            })
          } catch (err) {
            console.warn('Could not derive keypair from profile ID, creating new one')
            this.keyPair = await this.store.createKeyPair('identity')
          }
        }
      }
    } catch (err) {
      console.error('Error initializing user:', err)
      throw err
    }
  }

  /**
   * Register the current device if not already registered
   * @private
   */
  async _registerCurrentDevice() {
    try {
      if (!this.base.writable) return

      const profile = await this.getProfile()
      if (!profile) return

      const devices = await this.getDevices()
      const deviceId = b4a.toString(this.base.writerKey, 'hex')

      let deviceExists = false
      for (const device of devices) {
        if (device.id === deviceId) {
          deviceExists = true
          // Update last seen time
          await this.base.append(dispatch('@usermanager/add-device', {
            id: deviceId,
            name: device.name,
            publicKey: this.base.writerKey,
            lastSeen: Date.now(),
            metadata: device.metadata || {}
          }))
          break
        }
      }

      if (!deviceExists) {
        // Register this device
        await this.base.append(dispatch('@usermanager/add-device', {
          id: deviceId,
          name: this.deviceName,
          publicKey: this.base.writerKey,
          lastSeen: Date.now(),
          metadata: {}
        }))
      }
    } catch (err) {
      console.error('Error registering current device:', err)
      // Non-fatal error, continue
    }
  }

  /**
   * Invalidate the cache when data updates
   * @private
   */
  _cacheInvalidate() {
    this._profileCache = null
    this._roomsCache.clear()
    this._devicesCache.clear()
    this._settingsCache = null
    this._bump().catch(err => {
      console.error('Error in _bump:', err)
    })
  }

  /**
   * Close the user manager and clean up resources
   * @private
   */
  async _close() {
    const closing = []

    if (this.swarm) {
      if (this.member) closing.push(this.member.close().catch(noop))
      if (this.pairing) closing.push(this.pairing.close().catch(noop))
      closing.push(this.swarm.destroy().catch(noop))
    }

    if (this.base) {
      closing.push(this.base.close().catch(noop))
    }

    // Wait for all close operations to complete
    try {
      await Promise.all(closing)
    } catch (err) {
      console.error('Error during close:', err)
    }
  }

  /**
   * Create a pairing invite for adding a new device
   * @param {object} [opts={}] - Invite options
   * @param {number} [opts.expiresIn=86400000] - Expiration time in milliseconds (default: 24 hours)
   * @returns {Promise<string>} - z32 encoded invite code
   */
  async createInvite(opts = {}) {
    if (this.opened === false) await this.ready()

    // Check if an invite already exists
    const existing = await this.base.view.findOne('@usermanager/invite', {})
    if (existing) {
      return z32.encode(existing.invite)
    }

    // Create a new invite
    const { id, invite, publicKey, expires } = BlindPairing.createInvite(
      this.base.key,
      {
        expiresIn: opts.expiresIn || 86400000 // Default: 24 hours
      }
    )

    const record = { id, invite, publicKey, expires }
    await this.base.append(dispatch('@usermanager/add-invite', record))

    return z32.encode(record.invite)
  }

  /**
   * Add a writer to the user manager
   * @param {Buffer} key - Writer's public key
   * @returns {Promise<boolean>} - Success flag
   */
  async addWriter(key) {
    try {
      await this.base.append(dispatch('@usermanager/add-writer', {
        key: b4a.isBuffer(key) ? key : b4a.from(key)
      }))
      return true
    } catch (err) {
      console.error('Error adding writer:', err)
      return false
    }
  }

  /**
   * Remove a writer from the user manager
   * @param {Buffer} key - Writer's public key
   * @returns {Promise<boolean>} - Success flag
   */
  async removeWriter(key) {
    try {
      if (!this.base.removeable(key)) {
        return false
      }

      await this.base.append(dispatch('@usermanager/remove-writer', {
        key: b4a.isBuffer(key) ? key : b4a.from(key)
      }))
      return true
    } catch (err) {
      console.error('Error removing writer:', err)
      return false
    }
  }

  /**
   * Get the user's profile
   * @returns {Promise<object>} - User profile
   */
  async getProfile() {
    try {
      // Use cached profile if available
      if (this._profileCache) return this._profileCache

      await this.base.view.ready()
      const profile = await this.base.view.findOne('@usermanager/profile', {})

      // Parse metadata if it exists
      if (profile && profile.metadata) {
        try {
          profile.metadata = JSON.parse(profile.metadata)
        } catch (err) {
          console.warn('Error parsing profile metadata:', err)
          profile.metadata = {}
        }
      }

      // Cache the result
      this._profileCache = profile

      return profile
    } catch (err) {
      console.error('Error getting profile:', err)
      return null
    }
  }

  /**
   * Update the user's profile
   * @param {object} profileData - New profile data
   * @param {string} [profileData.name] - User's display name
   * @param {string} [profileData.status] - User's status message
   * @param {string} [profileData.avatar] - User's avatar URI or blob ID
   * @param {object} [profileData.metadata] - Additional profile metadata (will be JSON stringified)
   * @returns {Promise<boolean>} - Success flag
   */
  async updateProfile(profileData) {
    try {
      if (!this.base.writable) {
        throw new Error('Not writable')
      }

      // Ensure we have a profile ID
      const profile = await this.getProfile()
      const id = profileData.id || (profile ? profile.id : b4a.toString(this.keyPair.publicKey, 'hex'))

      // Parse existing metadata if available
      let existingMetadata = {}
      if (profile && profile.metadata) {
        try {
          existingMetadata = JSON.parse(profile.metadata)
        } catch (err) {
          console.warn('Error parsing profile metadata:', err)
        }
      }

      // Combine with new metadata
      const combinedMetadata = {
        ...existingMetadata,
        ...(profileData.metadata || {})
      }

      // Merge with existing data if available
      const updatedProfile = {
        id,
        name: profileData.name || (profile ? profile.name : 'User-' + Math.floor(Math.random() * 10000)),
        status: profileData.status || (profile ? profile.status : 'Online'),
        avatar: profileData.avatar !== undefined ? profileData.avatar : (profile ? profile.avatar : null),
        metadata: JSON.stringify(combinedMetadata)
      }

      await this.base.append(dispatch('@usermanager/add-profile', updatedProfile))

      // Update cache
      this._profileCache = updatedProfile

      return true
    } catch (err) {
      console.error('Error updating profile:', err)
      return false
    }
  }

  /**
   * Get user settings
   * @returns {Promise<object>} - User settings
   */
  async getSettings() {
    try {
      // Use cached settings if available
      if (this._settingsCache) return this._settingsCache

      await this.base.view.ready()
      const settings = await this.base.view.findOne('@usermanager/settings', {})

      // Parse preferences if they exist
      if (settings && settings.preferences) {
        try {
          settings.preferences = JSON.parse(settings.preferences)
        } catch (err) {
          console.warn('Error parsing settings preferences:', err)
          settings.preferences = {}
        }
      }

      // Cache the result
      this._settingsCache = settings

      return settings
    } catch (err) {
      console.error('Error getting settings:', err)
      return null
    }
  }

  /**
   * Update user settings
   * @param {object} settingsData - New settings data
   * @param {string} [settingsData.theme] - UI theme preference
   * @param {boolean} [settingsData.notifications] - Notification settings
   * @param {string} [settingsData.language] - Language preference
   * @param {object} [settingsData.preferences] - Additional preferences (will be JSON stringified)
   * @returns {Promise<boolean>} - Success flag
   */
  async updateSettings(settingsData) {
    try {
      if (!this.base.writable) {
        throw new Error('Not writable')
      }

      // Ensure we have a settings ID
      const settings = await this.getSettings()
      const profile = await this.getProfile()
      const id = settingsData.id || (settings ? settings.id : (profile ? profile.id : b4a.toString(this.keyPair.publicKey, 'hex')))

      // Parse existing preferences if available
      let existingPreferences = {}
      if (settings && settings.preferences) {
        try {
          existingPreferences = JSON.parse(settings.preferences)
        } catch (err) {
          console.warn('Error parsing settings preferences:', err)
        }
      }

      // Combine with new preferences
      const combinedPreferences = {
        ...existingPreferences,
        ...(settingsData.preferences || {})
      }

      // Merge with existing data if available
      const updatedSettings = {
        id,
        theme: settingsData.theme !== undefined ? settingsData.theme : (settings ? settings.theme : 'light'),
        notifications: settingsData.notifications !== undefined ? settingsData.notifications : (settings ? settings.notifications : true),
        language: settingsData.language || (settings ? settings.language : 'en'),
        preferences: JSON.stringify(combinedPreferences)
      }

      await this.base.append(dispatch('@usermanager/update-settings', updatedSettings))

      // Update cache
      this._settingsCache = updatedSettings

      return true
    } catch (err) {
      console.error('Error updating settings:', err)
      return false
    }
  }

  /**
   * Get all rooms the user is a member of
   * @returns {Promise<Array<object>>} - Array of room data
   */
  async getRooms() {
    try {
      await this.base.view.ready()
      const rooms = await this.base.view.find('@usermanager/rooms', {})

      // Parse metadata for all rooms
      if (rooms && rooms.length) {
        for (const room of rooms) {
          if (room.metadata) {
            try {
              room.metadata = JSON.parse(room.metadata)
            } catch (err) {
              console.warn(`Error parsing metadata for room ${room.id}:`, err)
              room.metadata = {}
            }
          } else {
            room.metadata = {}
          }

          // Update cache
          this._roomsCache.set(room.id, room)
        }
      }

      return rooms || []
    } catch (err) {
      console.error('Error getting rooms:', err)
      return []
    }
  }

  /**
   * Get a specific room by ID
   * @param {string} roomId - Room ID
   * @returns {Promise<object>} - Room data
   */
  async getRoom(roomId) {
    try {
      // Check cache first
      if (this._roomsCache.has(roomId)) {
        return this._roomsCache.get(roomId)
      }

      await this.base.view.ready()
      const room = await this.base.view.findOne('@usermanager/rooms', { id: roomId })

      // Parse metadata if it exists
      if (room && room.metadata) {
        try {
          room.metadata = JSON.parse(room.metadata)
        } catch (err) {
          console.warn(`Error parsing metadata for room ${roomId}:`, err)
          room.metadata = {}
        }
      }

      // Cache the result
      if (room) {
        this._roomsCache.set(roomId, room)
      }

      return room
    } catch (err) {
      console.error(`Error getting room ${roomId}:`, err)
      return null
    }
  }

  /**
   * Add or update a room in the user's list
   * @param {object} roomData - Room data
   * @param {string} roomData.id - Unique room identifier
   * @param {string} [roomData.name] - Room display name
   * @param {Buffer} roomData.key - Room's public key
   * @param {Buffer} [roomData.encryptionKey] - Room's encryption key
   * @param {number} [roomData.lastAccessed] - Timestamp of last access
   * @param {boolean} [roomData.favorite] - Whether the room is favorited
   * @param {object} [roomData.metadata] - Additional room metadata (will be JSON stringified)
   * @returns {Promise<boolean>} - Success flag
   */
  async addRoom(roomData) {
    try {
      if (!this.base.writable) {
        throw new Error('Not writable')
      }

      if (!roomData.id) {
        throw new Error('Room ID is required')
      }

      if (!roomData.key) {
        throw new Error('Room key is required')
      }

      // Get existing room data if available
      const existingRoom = await this.getRoom(roomData.id)

      // Parse existing metadata if available
      let existingMetadata = {}
      if (existingRoom && existingRoom.metadata) {
        try {
          existingMetadata = JSON.parse(existingRoom.metadata)
        } catch (err) {
          console.warn('Error parsing room metadata:', err)
        }
      }

      // Combine with new metadata
      const combinedMetadata = {
        ...existingMetadata,
        ...(roomData.metadata || {})
      }

      const room = {
        id: roomData.id,
        name: roomData.name || (existingRoom ? existingRoom.name : 'Unnamed Room'),
        key: roomData.key,
        encryptionKey: roomData.encryptionKey || (existingRoom ? existingRoom.encryptionKey : null),
        lastAccessed: roomData.lastAccessed || Date.now(),
        favorite: roomData.favorite !== undefined ? roomData.favorite : (existingRoom ? existingRoom.favorite : false),
        metadata: JSON.stringify(combinedMetadata)
      }

      await this.base.append(dispatch('@usermanager/add-room', room))

      // Update cache
      this._roomsCache.set(room.id, room)

      return true
    } catch (err) {
      console.error('Error adding room:', err)
      return false
    }
  }

  /**
   * Remove a room from the user's list
   * @param {string} roomId - Room ID
   * @returns {Promise<boolean>} - Success flag
   */
  async removeRoom(roomId) {
    try {
      if (!this.base.writable) {
        throw new Error('Not writable')
      }

      await this.base.append(dispatch('@usermanager/remove-room', { id: roomId }))

      // Update cache
      this._roomsCache.delete(roomId)

      return true
    } catch (err) {
      console.error(`Error removing room ${roomId}:`, err)
      return false
    }
  }

  /**
   * Update a room's last accessed time
   * @param {string} roomId - Room ID
   * @returns {Promise<boolean>} - Success flag
   */
  async touchRoom(roomId) {
    try {
      const room = await this.getRoom(roomId)
      if (!room) return false

      return await this.addRoom({
        ...room,
        lastAccessed: Date.now()
      })
    } catch (err) {
      console.error(`Error touching room ${roomId}:`, err)
      return false
    }
  }

  /**
   * Toggle a room's favorite status
   * @param {string} roomId - Room ID
   * @returns {Promise<boolean>} - Success flag
   */
  async toggleFavorite(roomId) {
    try {
      const room = await this.getRoom(roomId)
      if (!room) return false

      return await this.addRoom({
        ...room,
        favorite: !room.favorite
      })
    } catch (err) {
      console.error(`Error toggling favorite for room ${roomId}:`, err)
      return false
    }
  }

  /**
   * Get all paired devices
   * @returns {Promise<Array<object>>} - Array of device data
   */
  async getDevices() {
    try {
      await this.base.view.ready()
      const devices = await this.base.view.find('@usermanager/devices', {})

      // Parse metadata for all devices
      if (devices && devices.length) {
        for (const device of devices) {
          if (device.metadata) {
            try {
              device.metadata = JSON.parse(device.metadata)
            } catch (err) {
              console.warn(`Error parsing metadata for device ${device.id}:`, err)
              device.metadata = {}
            }
          } else {
            device.metadata = {}
          }

          // Update cache
          this._devicesCache.set(device.id, device)
        }
      }

      return devices || []
    } catch (err) {
      console.error('Error getting devices:', err)
      return []
    }
  }

  /**
   * Get a specific device by ID
   * @param {string} deviceId - Device ID
   * @returns {Promise<object>} - Device data
   */
  async getDevice(deviceId) {
    try {
      // Check cache first
      if (this._devicesCache.has(deviceId)) {
        return this._devicesCache.get(deviceId)
      }

      await this.base.view.ready()
      const device = await this.base.view.findOne('@usermanager/devices', { id: deviceId })

      // Parse metadata if it exists
      if (device && device.metadata) {
        try {
          device.metadata = JSON.parse(device.metadata)
        } catch (err) {
          console.warn(`Error parsing metadata for device ${deviceId}:`, err)
          device.metadata = {}
        }
      }

      // Cache the result
      if (device) {
        this._devicesCache.set(deviceId, device)
      }

      return device
    } catch (err) {
      console.error(`Error getting device ${deviceId}:`, err)
      return null
    }
  }

  /**
   * Add or update a device
   * @param {object} deviceData - Device data
   * @param {string} deviceData.id - Unique device identifier
   * @param {string} [deviceData.name] - Device display name
   * @param {Buffer} deviceData.publicKey - Device's public key
   * @param {number} [deviceData.lastSeen] - Timestamp of last activity
   * @param {object} [deviceData.metadata] - Additional device metadata (will be JSON stringified)
   * @returns {Promise<boolean>} - Success flag
   */
  async addDevice(deviceData) {
    try {
      if (!this.base.writable) {
        throw new Error('Not writable')
      }

      if (!deviceData.id) {
        throw new Error('Device ID is required')
      }

      if (!deviceData.publicKey) {
        throw new Error('Device public key is required')
      }

      // Get existing device data if available
      const existingDevice = await this.getDevice(deviceData.id)

      // Parse existing metadata if available
      let existingMetadata = {}
      if (existingDevice && existingDevice.metadata) {
        try {
          existingMetadata = JSON.parse(existingDevice.metadata)
        } catch (err) {
          console.warn('Error parsing device metadata:', err)
        }
      }

      // Combine with new metadata
      const combinedMetadata = {
        ...existingMetadata,
        ...(deviceData.metadata || {})
      }

      const device = {
        id: deviceData.id,
        name: deviceData.name || (existingDevice ? existingDevice.name : 'Unknown Device'),
        publicKey: deviceData.publicKey,
        lastSeen: deviceData.lastSeen || Date.now(),
        metadata: JSON.stringify(combinedMetadata)
      }

      await this.base.append(dispatch('@usermanager/add-device', device))

      // Update cache
      this._devicesCache.set(device.id, device)

      return true
    } catch (err) {
      console.error('Error adding device:', err)
      return false
    }
  }

  /**
   * Remove a device
   * @param {string} deviceId - Device ID
   * @returns {Promise<boolean>} - Success flag
   */
  async removeDevice(deviceId) {
    try {
      if (!this.base.writable) {
        throw new Error('Not writable')
      }

      const device = await this.getDevice(deviceId)
      if (!device) return false

      // Don't allow removing the current device
      const currentDeviceId = b4a.toString(this.base.writerKey, 'hex')
      if (deviceId === currentDeviceId) {
        throw new Error('Cannot remove current device')
      }

      // Remove the device from writers if possible
      try {
        await this.removeWriter(device.publicKey)
      } catch (err) {
        console.error('Error removing device writer:', err)
        // Continue anyway
      }

      await this.base.append(dispatch('@usermanager/remove-device', { id: deviceId }))

      // Update cache
      this._devicesCache.delete(deviceId)

      return true
    } catch (err) {
      console.error(`Error removing device ${deviceId}:`, err)
      return false
    }
  }

  /**
   * Update a device's last seen time
   * @param {string} deviceId - Device ID
   * @returns {Promise<boolean>} - Success flag
   */
  async updateDeviceLastSeen(deviceId) {
    try {
      const device = await this.getDevice(deviceId)
      if (!device) return false

      return await this.addDevice({
        ...device,
        lastSeen: Date.now()
      })
    } catch (err) {
      console.error(`Error updating last seen for device ${deviceId}:`, err)
      return false
    }
  }

  /**
   * Check if the user manager is writable
   * @returns {boolean} - Whether the user manager is writable
   */
  get writable() {
    return this.base.writable
  }

  /**
   * Get the local writer key
   * @returns {Buffer} - Writer key
   */
  get writerKey() {
    return this.base.writerKey
  }

  /**
   * Get the user manager key
   * @returns {Buffer} - User manager key
   */
  get key() {
    return this.base.key
  }

  /**
   * Get the discovery key for networking
   * @returns {Buffer} - Discovery key
   */
  get discoveryKey() {
    return this.base.discoveryKey
  }

  /**
   * Get the encryption key
   * @returns {Buffer} - Encryption key
   */
  get encryptionKey() {
    return this.base.encryptionKey
  }

  /**
   * Get the user's public key
   * @returns {Buffer} - Public key
   */
  getPublicKey() {
    return this.keyPair ? this.keyPair.publicKey : null
  }

  /**
   * Static method to create a UserPairer for pairing devices
   * @param {object} store - Corestore instance
   * @param {string} invite - Invite code
   * @param {object} [opts={}] - Pairing options
   * @returns {UserPairer} - Pairer instance
   */
  static pair(store, invite, opts = {}) {
    return new UserPairer(store, invite, opts)
  }
}

module.exports = UserManager
