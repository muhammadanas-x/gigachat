// Gigauser.js - Comprehensive User Module for Gigachat
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

class GigauserPairer extends ReadyResource {
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
        console.log('Candidate added, result:', result)
        if (this.user === null) {
          console.log('Creating new Gigauser instance')
          this.user = new Gigauser(this.store, {
            swarm: this.swarm,
            key: result.key,
            encryptionKey: result.encryptionKey,
            bootstrap: this.bootstrap
          })
        }
        console.log('User instance created')
        this.swarm = null
        this.store = null

        if (this.onresolve) this._whenWritable();
        this.candidate.close().catch(noop);

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

class Gigauser extends ReadyResource {
  constructor(corestore, opts = {}) {

    console.log('Gigauser constructor - Start')
    super()

    this.router = new Router();
    this.store = corestore;
    this.swarm = opts.swarm || null;
    this.base = null;
    this.bootstrap = opts.bootstrap || null;
    this.member = null;
    this.pairing = null;
    this.replicate = opts.replicate !== false;

    console.log('Gigauser constructor - Before key setup')
    // Identify the bootstrap key
    const key = opts.key ? opts.key : null

    // Core properties
    this.id = null
    this.key = key
    this.discoveryKey = null
    this.keyPair = null
    // User seed and identity
    this.seed = opts.seed || null
    this.publicKey = null

    // User data collections
    this._profile = {
      name: null,
      avatar: null,
      status: null,
      metadata: {}
    }
    this._rooms = []
    this._devices = []
    this._settings = {}

    // Router for handling different types of updates
    this.router = new Router()
    this._registerHandlers()

    this._boot(opts);
    console.log('Gigauser constructor - End')
    // Prepare for opening
    this.ready().catch(noop)
  }

  _boot(opts = {}) {
    const { encryptionKey, key } = opts

    // Initialize Autobase
    this.base = new Autobase(this.store, key, {
      encrypt: true,
      encryptionKey,
      open: (store) => {
        return HyperDB.bee(store.get('view'), db, {
          extension: false,
          autoUpdate: true
        })
      },
      apply: this._apply.bind(this)
    })

    // Handle base updates
    this.base.on('update', () => {
      if (!this.base._interrupting) {
        this.emit('update')
      }
    })
  }

  _registerHandlers() {
    // Writer management handlers
    this.router.add('@gigauser/remove-writer', async (data, context) => {
      await context.base.removeWriter(data.key)
    })

    this.router.add('@gigauser/add-writer', async (data, context) => {
      await context.base.addWriter(data.key)
    })

    // Invite handler
    this.router.add('@gigauser/add-invite', async (data, context) => {
      await context.view.insert('@gigauser/invite', data)
    })

    // Profile handler
    this.router.add('@gigauser/set-profile', async (data, context) => {
      try {
        await context.view.delete('@gigauser/profile', { key: data.key })
      } catch (e) {
        // Ignore deletion errors
      }
      await context.view.insert('@gigauser/profile', data)
    })

    // Rooms handler
    this.router.add('@gigauser/update-rooms', async (data, context) => {
      try {
        await context.view.delete('@gigauser/rooms', { key: data.key })
      } catch (e) {
        // Ignore deletion errors
      }
      await context.view.insert('@gigauser/rooms', data)
    })

    // Devices handler
    this.router.add('@gigauser/update-devices', async (data, context) => {
      try {
        await context.view.delete('@gigauser/devices', { key: data.key })
      } catch (e) {
        // Ignore deletion errors
      }
      await context.view.insert('@gigauser/devices', data)
    })

    // Settings handler
    this.router.add('@gigauser/update-settings', async (data, context) => {
      try {
        await context.view.delete('@gigauser/settings', { key: data.key })
      } catch (e) {
        // Ignore deletion errors
      }
      await context.view.insert('@gigauser/settings', data)
    })
  }

  // Utility methods
  _safeParseJSON(jsonStr, defaultValue = null) {
    if (!jsonStr) return defaultValue
    try {
      return JSON.parse(jsonStr)
    } catch (err) {
      console.error('JSON parsing error:', err)
      return defaultValue
    }
  }

  _safeKeyString(key) {
    if (typeof key === 'string') return key
    if (Buffer.isBuffer(key)) return b4a.toString(key, 'hex')
    return null
  }

  // Identity creation
  async createIdentity(seed) {
    if (Array.isArray(seed)) {
      seed = seed.join(' ')
    }

    const seedBuffer = b4a.from(seed)
    const hash = crypto.createHash('sha256').update(seedBuffer).digest()

    this.publicKey = hash.slice(0, 32)
    this.keyPair = {
      publicKey: this.publicKey,
      secretKey: hash
    }

    // Create initial profile
    await this._createInitialProfile()

    return {
      publicKey: this.publicKey,
      profile: this._profile
    }
  }

  async _createInitialProfile() {
    if (!this.publicKey) return

    const key = this._safeKeyString(this.publicKey)

    this._profile = {
      name: `User-${key.substring(0, 8)}`,
      avatar: null,
      status: 'Available',
      metadata: {}
    }

    await this.base.append(dispatch('@gigauser/set-profile', {
      key,
      value: JSON.stringify(this._profile)
    }))
  }

  // Open method
  async _open() {
    await this.base.ready();


    if (this.replicate) await this._replicate();

    // Initialize user data
    await this._loadUserData()
  }
  // Apply method for updates
  async _apply(nodes, view, base) {
    for (const node of nodes) {
      await this.router.dispatch(node.value, { view, base })
    }
    await view.flush()
  }

  // Load user data from database
  async _loadUserData() {
    if (!this.publicKey) return

    const key = this._safeKeyString(this.publicKey)

    // Load profile
    try {
      const profileData = await this.base.view.get('@gigauser/profile', { key })
      if (profileData && profileData.value) {
        this._profile = this._safeParseJSON(profileData.value, this._profile)
      }
    } catch (err) {
      console.error('Profile load error:', err)
    }

    // Load rooms
    try {
      const roomsData = await this.base.view.get('@gigauser/rooms', { key })
      if (roomsData && roomsData.value) {
        this._rooms = this._safeParseJSON(roomsData.value, [])
      }
    } catch (err) {
      console.error('Rooms load error:', err)
    }

    // Load devices
    try {
      const devicesData = await this.base.view.get('@gigauser/devices', { key })
      if (devicesData && devicesData.value) {
        this._devices = this._safeParseJSON(devicesData.value, [])
      }
    } catch (err) {
      console.error('Devices load error:', err)
    }

    // Load settings
    try {
      const settingsData = await this.base.view.get('@gigauser/settings', { key })
      if (settingsData && settingsData.value) {
        this._settings = this._safeParseJSON(settingsData.value, {})
      }
    } catch (err) {
      console.error('Settings load error:', err)
    }
  }

  // Replication method
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
      console.log('replicating..')
    }

    this.pairing = new BlindPairing(this.swarm)
    this.member = this.pairing.addMember({
      discoveryKey: this.base.discoveryKey,
      onadd: async (candidate) => {
        try {
          const id = candidate.inviteId
          const inv = await this.base.view.findOne('@gigauser/invite', {})

          if (!b4a.equals(inv.id, id)) return

          candidate.open(inv.publicKey)
          await this.addWriter(candidate.userData);
          candidate.confirm({
            key: this.base.key,
            encryptionKey: this.base.encryptionKey
          })
        } catch (err) {
          console.error('Replication error:', err)
        }
      }
    })

    this.swarm.join(this.base.discoveryKey)
  }

  // Close method
  async close() {
    if (this.swarm) {
      if (this.member) await this.member.close()
      if (this.pairing) await this.pairing.close()
      await this.swarm.destroy()
    }

    if (this.base) await this.base.close()
    if (this.local) await this.local.close()
    if (this.store) await this.store.close()
  }

  // Profile management
  async updateProfile(profileData) {
    if (!this.publicKey) throw new Error('Identity not created')

    const key = this._safeKeyString(this.publicKey)

    // Merge with existing profile
    this._profile = {
      ...this._profile,
      ...profileData
    }

    await this.base.append(dispatch('@gigauser/set-profile', {
      key,
      value: JSON.stringify(this._profile)
    }))

    return this._profile
  }

  async addWriter(key) {
    await this.base.append(dispatch('@gigauser/add-writer', { key: b4a.isBuffer(key) ? key : b4a.from(key) }));
    return true;
  }

  async removeWriter(key) {
    await this.base.append(dispatch('@gigauser/remove-writer', { key: b4a.isBuffer(key) ? key : b4a.from(key) }));
  }

  // Rooms management
  async addRoom(roomData) {
    if (!this.publicKey) throw new Error('Identity not created')

    const key = this._safeKeyString(this.publicKey)

    // Check if room exists
    const existingIndex = this._rooms.findIndex(r => r.id === roomData.id)

    if (existingIndex >= 0) {
      // Update existing room
      this._rooms[existingIndex] = {
        ...this._rooms[existingIndex],
        ...roomData,
        lastAccessed: Date.now()
      }
    } else {
      // Add new room
      this._rooms.push({
        ...roomData,
        lastAccessed: Date.now()
      })
    }

    await this.base.append(dispatch('@gigauser/update-rooms', {
      key,
      value: JSON.stringify(this._rooms)
    }))

    return this._rooms
  }

  async removeRoom(roomId) {
    if (!this.publicKey) throw new Error('Identity not created')

    const key = this._safeKeyString(this.publicKey)

    // Filter out the room
    this._rooms = this._rooms.filter(r => r.id !== roomId)

    await this.base.append(dispatch('@gigauser/update-rooms', {
      key,
      value: JSON.stringify(this._rooms)
    }))

    return this._rooms
  }

  async addDevice(deviceData) {
    if (!this.publicKey) throw new Error('Identity not created')

    const key = this._safeKeyString(this.publicKey)
    const deviceKey = this._safeKeyString(deviceData.publicKey)

    if (!deviceKey) {
      throw new Error('Invalid device public key')
    }

    // First get current devices from DB
    let currentDevices = []
    try {
      const result = await this.base.view.get('@gigauser/devices', { key })
      currentDevices = result && result.value ?
        this._safeParseJSON(result.value, []) :
        []
    } catch (err) {
      console.error('Error retrieving current devices:', err)
    }

    // Check if device already exists
    const existingIndex = currentDevices.findIndex(d =>
      this._safeKeyString(d.publicKey) === deviceKey
    )

    if (existingIndex >= 0) {
      // Update existing device
      currentDevices[existingIndex] = {
        ...currentDevices[existingIndex],
        ...deviceData,
        publicKey: deviceKey,
        lastSeen: Date.now()
      }
    } else {
      // Add new device
      currentDevices.push({
        ...deviceData,
        publicKey: deviceKey,
        lastSeen: Date.now()
      })
    }

    await this.base.append(dispatch('@gigauser/update-devices', {
      key,
      value: JSON.stringify(currentDevices)
    }))

    // Update local devices
    this._devices = currentDevices

    return this._devices
  }


  async removeDevice(deviceKey) {
    if (!this.publicKey) throw new Error('Identity not created')

    const key = this._safeKeyString(this.publicKey)
    const deviceKeyStr = this._safeKeyString(deviceKey)

    // Filter out the device
    this._devices = this._devices.filter(d =>
      this._safeKeyString(d.publicKey) !== deviceKeyStr
    )

    await this.base.append(dispatch('@gigauser/update-devices', {
      key,
      value: JSON.stringify(this._devices)
    }))

    return this._devices
  }

  // Settings management
  async updateSettings(settingsData) {
    if (!this.publicKey) throw new Error('Identity not created')

    const key = this._safeKeyString(this.publicKey)

    // Merge with existing settings
    this._settings = {
      ...this._settings,
      ...settingsData
    }

    await this.base.append(dispatch('@gigauser/update-settings', {
      key,
      value: JSON.stringify(this._settings)
    }))

    return this._settings
  }

  // Invite and device pairing methods
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

  // Static method for pairing a new device
  static async pairDevice(store, inviteCode, opts = {}) {
    if (!store) throw new Error('Corestore is required')
    if (!inviteCode) throw new Error('Invite code is required')

    try {
      const pair = Gigauser.pair(store, inviteCode, opts)

      // Add a global timeout
      const pairingPromise = pair.finished()
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Pairing timed out')), 45000)
      )

      const user = await Promise.race([pairingPromise, timeoutPromise])
      await user.ready()
      return user
    } catch (err) {
      console.error('Comprehensive pairing error:', err)
      console.error('Pairing error stack:', err.stack)
      throw err
    }
  }

  // Getters for easy access to user data
  get profile() {
    return this._profile
  }

  get rooms() {
    return this._rooms
  }

  get devices() {
    return this._devices
  }

  get settings() {
    return this._settings
  }

  // Static method for creating a new user
  static async create(store, seed, opts = {}) {
    console.log('Gigauser.create - Start')
    const user = new Gigauser(store, { ...opts, seed })
    console.log('Gigauser.create - Instance created')

    try {
      await user.ready()
      console.log('Gigauser.create - Ready called')

      await user.createIdentity(seed)
      console.log('Gigauser.create - Identity created')

      return user
    } catch (error) {
      console.error('Gigauser.create - Error:', error)
      console.error('Gigauser.create - Error stack:', error.stack)
      throw error
    }
  }

  // Pair method
  static pair(store, invite, opts) {
    return new GigauserPairer(store, invite, opts)
  }
}

// Utility functions
function toKey(k) {
  return b4a.isBuffer(k) ? k : z32.decode(k)
}

function noop(e) {
  console.log('op', e)

}

module.exports = Gigauser
