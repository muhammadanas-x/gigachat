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
const GigaRoom = require('../gigaroom/Gigaroom.js')

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
    await this.store.ready();
    this.swarm = new Hyperswarm({
      keyPair: await this.store.createKeyPair('hyperswarm'),
      bootstrap: this.bootstrap
    });

    const store = this.store;
    this.swarm.on('connection', (connection, peerInfo) => {
      store.replicate(connection);
    });

    this.pairing = new BlindPairing(this.swarm);
    const core = Autobase.getLocalCore(this.store);
    await core.ready();
    const key = core.key;
    await core.close();

    this.candidate = this.pairing.addCandidate({
      invite: z32.decode(this.invite),
      userData: key,
      onadd: async (result) => {
        if (this.user === null) {
          this.user = new Gigauser(this.store, {
            swarm: this.swarm,
            key: result.key,
            encryptionKey: result.encryptionKey,
            bootstrap: this.bootstrap,
          });
        }
        this.swarm = null;
        this.store = null;
        if (this.onresolve) this._whenWritable();
        this.candidate.close().catch(noop);
      }
    });
  }

  _whenWritable() {
    if (this.user.base.writable) return
    const check = () => {
      if (this.user.base.writable) {
        this.user.base.off('update', check)

        this.user._loadUserData()
        this.user.once('identity-updated', () => {
          console.log('Identity synchronized to paired device');
        });
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

    super()

    this.router = new Router();
    this.store = corestore;
    this.swarm = opts.swarm || null;
    this.base = null;
    this.bootstrap = opts.bootstrap || null;
    this.member = null;
    this.pairing = null;
    this.replicate = opts.replicate !== false;

    this._roomInstances = new Map() // Stores active GigaRoom instances by ID
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
      await context.view.insert('@gigauser/invite', data);
    });

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

    this.router.add('@gigauser/set-identity', async (data, context) => {
      try {
        await context.view.delete('@gigauser/identity', { key: 'default' })
      } catch (e) {
        console.log(e)
        // Ignore deletion errors
      }
      await context.view.insert('@gigauser/identity', data)
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

  async createIdentity(seed) {
    if (Array.isArray(seed)) {
      seed = seed.join(' ');
    }

    // Use consistent key derivation
    const keys = Gigauser.deriveKeysFromSeed(seed);
    this.publicKey = keys.publicKey;
    this.keyPair = {
      publicKey: keys.publicKey,
      secretKey: keys.secretKey
    };

    // Also store the encryption key for consistent encryption
    if (!this.base.encryptionKey) {
      this.base.encryptionKey = keys.encryptionKey;
    }
    //
    // Store discovery key for future recovery
    await this.base.append(dispatch('@gigauser/set-identity', {
      key: 'default',
      value: JSON.stringify({
        seed,
        publicKey: b4a.toString(this.publicKey, 'hex'),
        discoveryKey: b4a.toString(keys.discoveryKey, 'hex')
      })
    }));

    await this._createInitialProfile();

    return {
      publicKey: this.publicKey,
      profile: this._profile
    };
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
    this.forceUpdate()
  }

  // Open method
  async _open() {
    await this.base.ready();

    if (this.replicate) await this._replicate();

    await this._loadUserData()
    // Initialize user data
    await this.setupRecoveryResponder()
  }

  // Apply method for updates
  async _apply(nodes, view, base) {
    // Track which types of data are being updated
    const updates = {
      identity: false,
      profile: false,
      rooms: false,
      devices: false,
      settings: false,
      invites: false,
      writers: false
    };

    // Process each node
    for (const node of nodes) {
      try {
        // Dispatch the command to the router
        await this.router.dispatch(node.value, { view, base });

        // Determine which type of data was updated based on command ID or type
        const commandId = node.value[0]; // First byte is command ID
        const command = this._getCommandNameById(commandId);

        // Set the appropriate update flag
        if (command.includes('identity')) updates.identity = true;
        if (command.includes('profile')) updates.profile = true;
        if (command.includes('rooms')) updates.rooms = true;
        if (command.includes('devices')) updates.devices = true;
        if (command.includes('settings')) updates.settings = true;
        if (command.includes('invite')) updates.invites = true;
        if (command.includes('writer')) updates.writers = true;

        // Emit a command-specific event with node data
        this.emit(`command:${command}`, node.value);
      } catch (error) {
        console.error(`Error processing command in GigaUser:`, error);
        this.emit('error', error);
      }
    }

    // Ensure the view is flushed
    await view.flush();

    // Emit a general update event
    this.emit('update');

    // Conditionally refresh data and emit specific events
    const refreshPromises = [];

    // Identity
    if (updates.identity) {
      refreshPromises.push(this._refreshIdentity().then(() => {
        this.emit('identity:updated', { publicKey: this.publicKey });
      }));
    }

    // Profile
    if (updates.profile) {
      refreshPromises.push(this._refreshProfile().then(() => {
        this.emit('profile:updated', this._profile);
      }));
    }

    // Rooms
    if (updates.rooms) {
      refreshPromises.push(this._refreshRooms().then(() => {
        this.emit('rooms:updated', this._rooms);
      }));
    }

    // Devices
    if (updates.devices) {
      refreshPromises.push(this._refreshDevices().then(() => {
        this.emit('devices:updated', this._devices);
      }));
    }

    // Settings
    if (updates.settings) {
      refreshPromises.push(this._refreshSettings().then(() => {
        this.emit('settings:updated', this._settings);
      }));
    }

    // Other data types
    if (updates.invites) this.emit('invites:updated');
    if (updates.writers) this.emit('writers:updated');

    // Wait for all refresh operations to complete
    await Promise.all(refreshPromises);

    // Emit a final event indicating all updates are complete
    this.emit('update:complete', Object.keys(updates).filter(key => updates[key]));
  }

  _getCommandNameById(id) {
    // This is a mapping of command IDs to command names
    // You should build this from your command registry
    const commandMap = {
      // Writer commands
      1: 'remove-writer',
      2: 'add-writer',

      // Invite commands
      3: 'add-invite',

      // Profile command
      4: 'set-profile',

      // Room command
      5: 'update-rooms',

      // Device command
      6: 'update-devices',

      // Settings command
      7: 'update-settings',

      // Identity command 
      8: 'set-identity',

      // Add more command mappings as needed
    };

    return commandMap[id] || `unknown-command-${id}`;
  }

  async forceUpdate() {
    await this.base.update()
  }

  async _loadUserData() {
    await this._refreshIdentity()
    await this._refreshProfile()
    await this._refreshRooms()
    await this._refreshDevices()
    await this._refreshSettings()
  }


  // Load user data from database
  async _refreshIdentity() {
    try {
      const identityData = await this.base.view.findOne('@gigauser/identity', {});
      if (identityData && identityData.value) {
        const identity = this._safeParseJSON(identityData.value, {});

        if (identity.seed) {
          this.seed = identity.seed;
        }

        if (identity.publicKey) {
          this.publicKey = b4a.from(identity.publicKey, 'hex');
        }
      }
      return true;
    } catch (error) {
      console.error('Error refreshing identity:', error);
      this.emit('error', error);
      return false;
    }
  }

  async _refreshProfile() {
    try {
      if (!this.publicKey) {
        await this._refreshIdentity();
      }

      const key = this._safeKeyString(this.publicKey);
      const profileData = await this.base.view.get('@gigauser/profile', { key });

      if (profileData && profileData.value) {
        this._profile = this._safeParseJSON(profileData.value, this._profile);
      }

      return this._profile;
    } catch (error) {
      console.error('Error refreshing profile:', error);
      this.emit('error', error);
      return this._profile;
    }
  }

  async _refreshRooms() {
    try {
      if (!this.publicKey) {
        await this._refreshIdentity();
      }

      const key = this._safeKeyString(this.publicKey);
      const roomsData = await this.base.view.get('@gigauser/rooms', { key });

      if (roomsData && roomsData.value) {
        const parsedRooms = this._safeParseJSON(roomsData.value, []);

        // Keep track of current room instances
        const currentInstances = new Map(this._roomInstances);

        // Update the rooms array with the new data
        this._rooms = parsedRooms.map(room => {
          // Ensure namespaces are trimmed
          if (room.roomNamespace) {
            room.roomNamespace = room.roomNamespace.trim();
          }
          return room;
        });

        // Initialize any new room instances
        for (const roomInfo of this._rooms) {
          if (!currentInstances.has(roomInfo.id)) {
            // This is a new room, initialize it
            this._initializeRoomInstance(roomInfo).catch(err => {
              console.error(`Error initializing room ${roomInfo.id}:`, err);
            });
          }
        }
      }

      return this._rooms;
    } catch (error) {
      console.error('Error refreshing rooms:', error);
      this.emit('error', error);
      return this._rooms;
    }
  }

  async _refreshDevices() {
    try {
      if (!this.publicKey) {
        await this._refreshIdentity();
      }

      const key = this._safeKeyString(this.publicKey);
      const devicesData = await this.base.view.get('@gigauser/devices', { key });

      if (devicesData && devicesData.value) {
        this._devices = this._safeParseJSON(devicesData.value, []);
      }

      return this._devices;
    } catch (error) {
      console.error('Error refreshing devices:', error);
      this.emit('error', error);
      return this._devices;
    }
  }

  async _refreshSettings() {
    try {
      if (!this.publicKey) {
        await this._refreshIdentity();
      }

      const key = this._safeKeyString(this.publicKey);
      const settingsData = await this.base.view.get('@gigauser/settings', { key });

      if (settingsData && settingsData.value) {
        this._settings = this._safeParseJSON(settingsData.value, {});
      }

      return this._settings;
    } catch (error) {
      console.error('Error refreshing settings:', error);
      this.emit('error', error);
      return this._settings;
    }
  }

  // Helper method to initialize a single room instance
  async _initializeRoomInstance(roomInfo) {
    if (!roomInfo || !roomInfo.id) return null;

    try {
      console.log(`Initializing room instance: ${roomInfo.id}`);

      // Determine the namespace for the room
      let roomNamespace;

      if (roomInfo.roomNamespace) {
        // Use the full namespace string if available, ensuring it's trimmed
        roomNamespace = roomInfo.roomNamespace.trim();
      } else {
        // Fallback to roomId-based namespace
        roomNamespace = `${roomInfo.id}`.trim();
      }

      // Get the room store with the determined namespace
      const roomStore = this.store.namespace(roomNamespace);

      // Create room instance
      const room = new GigaRoom(roomStore, {
        owner: this,
        id: roomInfo.id,
        encryptionKey: roomInfo.encryptionKey
          ? (typeof roomInfo.encryptionKey === 'string'
            ? Buffer.from(roomInfo.encryptionKey, 'hex')
            : roomInfo.encryptionKey)
          : null,
        key: roomInfo.key
          ? Buffer.from(roomInfo.key, 'hex')
          : null,
        discoveryKey: roomInfo.discoveryKey
          ? Buffer.from(roomInfo.discoveryKey, 'hex')
          : null,
        name: roomInfo.name,
        namespace: roomNamespace
      });

      // Wait for room to be ready
      await room.ready();

      // Set up event forwarding
      this._setupRoomEvents(room);

      // Store the room instance
      this._roomInstances.set(roomInfo.id, room);

      // Emit a room initialized event
      this.emit('room:initialized', roomInfo.id);

      return room;
    } catch (error) {
      console.error(`Error initializing room ${roomInfo.id}:`, error);
      this.emit('error', error);
      return null;
    }
  }

  _setupRoomEvents(room) {
    if (!room) return;

    // Forward specific events with room context
    const eventsToForward = [
      'update', 'error',
      'room:updated', 'members:updated', 'channels:updated',
      'categories:updated', 'roles:updated', 'messages:updated',
      'files:updated', 'reactions:updated', 'invites:updated',
      'permissions:updated', 'threads:updated', 'update:complete'
    ];

    eventsToForward.forEach(eventName => {
      room.on(eventName, (data) => {
        // Forward the event with room context
        this.emit(`room:${eventName}`, {
          roomId: room.id,
          data: data
        });
      });
    });
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
    }

    this.pairing = new BlindPairing(this.swarm)
    this.member = this.pairing.addMember({
      discoveryKey: this.base.discoveryKey,
      onadd: async (candidate) => {
        try {
          const inviteBuffer = candidate.inviteId
          let inv = null
          try {
            const stream = this.base.view.find('@gigauser/invite', {})
            for await (const invite of stream) {
              if (b4a.equals(invite.id, inviteBuffer)) {
                inv = invite
                console.log('Found invite by direct invite buffer match')
                break
              }
            }
          } catch (err) {
            console.log('Error finding invite by buffer:', err)
          }

          if (!inv) {
            console.log('No matching invite found in the database, cannot complete pairing')
            return
          }

          const now = Date.now()
          if (inv.expires && inv.expires < now) {
            console.log(`Invite expired: expired at ${new Date(inv.expires).toISOString()}, current time ${new Date(now).toISOString()}`)
            return
          }

          console.log('Found valid invite, proceeding with pairing')

          const id = candidate.inviteId
          if (!b4a.equals(inv.id, id)) {
            console.log('Invite ID mismatch', b4a.toString(inv.id, 'hex'), b4a.toString(id, 'hex'))
            return
          }

          candidate.open(inv.publicKey)
          await this.addWriter(candidate.userData)
          candidate.confirm({
            key: this.base.key,
            encryptionKey: this.base.encryptionKey
          })
          console.log('Confirming, ', this.base.key, ' ', this.base.encryptionKey)
        } catch (err) {
          console.error('Replication error:', err)
        }
      }
    })

    // TODO move this into a different swarm instance for safety
    this.swarm.join(this.base.discoveryKey)

    // seed based pairing
    if (this.seed) {
      const keys = Gigauser.deriveKeysFromSeed(this.seed);
      this.swarm.join(keys.discoveryKey);
    }
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
    await this.base.ready()
    if (!profileData) return
    if (!this.publicKey) {
      await this._loadIdentity()
    }

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

    await this._refreshProfile()
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

    // Log existing rooms before adding
    console.log('Existing rooms before adding:', this._rooms)

    // Check if room exists
    const existingIndex = this._rooms.findIndex(r => r.id === roomData.id)

    // Merge function to preserve existing data and fill in missing information
    const mergeRoomData = (existingRoom, newRoomData) => {
      // Create a merged room object
      const mergedRoom = {
        ...existingRoom,
        ...newRoomData,
        id: roomData.id,
        // Preserve existing key if not provided
        key: newRoomData.key || existingRoom.key || null,
        // Preserve existing discoveryKey if not provided
        discoveryKey: newRoomData.discoveryKey || existingRoom.discoveryKey || null,
        // Preserve invite-related information
        inviteCode: newRoomData.inviteCode || existingRoom.inviteCode || null,
        roomNamespace: newRoomData.roomNamespace.trim() || existingRoom.roomNamespace.trim() || null,
        encryptionKey: newRoomData.encryptionKey || existingRoom.encryptionKey || null,
        // Always update lastAccessed
        lastAccessed: Date.now(),
      }

      // Add roomNamespace if it's not already present
      if (!mergedRoom.roomNamespace) {
        mergedRoom.roomNamespace = `${mergedRoom.inviteHash ? mergedRoom.inviteHash : mergedRoom.id}`.trim();
      }
      console.log(`Room merged:${mergedRoom.id} namespace: ${mergedRoom.roomNamespace} `);
      return mergedRoom;
    }

    if (existingIndex >= 0) {
      // Update existing room
      this._rooms[existingIndex] = mergeRoomData(
        this._rooms[existingIndex],
        roomData
      )
    } else {
      // Add new room with default values
      this._rooms.push(mergeRoomData({}, roomData))
    }

    // Log rooms after modification
    console.log('Rooms after modification:', this._rooms)

    // Append room data to base
    await this.base.append(dispatch('@gigauser/update-rooms', {
      key,
      value: JSON.stringify(this._rooms)
    }))

    // Log after appending
    console.log('Rooms appended to base')

    return this._rooms
  }


  async refreshRooms() {
    console.log('_apply room-updated')
    await this.base.ready()
    if (!this.publicKey) return

    console.log('Refreshing rooms...')

    const key = this._safeKeyString(this.publicKey)

    try {
      const roomsData = await this.base.view.get('@gigauser/rooms', { key })

      console.log('Rooms data retrieved:', roomsData)

      if (roomsData && roomsData.value) {
        const parsedRooms = this._safeParseJSON(roomsData.value, [])

        console.log('Parsed rooms:', parsedRooms)

        // Merge existing rooms with retrieved rooms
        const updatedRooms = parsedRooms.map(retrievedRoom => {
          const existingRoom = this._rooms.find(r => r.id === retrievedRoom.id)
          return {
            ...existingRoom,
            ...retrievedRoom,
            lastAccessed: Date.now()
          }
        })

        this._rooms = updatedRooms

        console.log('Updated rooms after refresh:', this._rooms)
      }
    } catch (err) {
      console.error('Rooms refresh error:', err)
    }
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
    await this.base.ready()

    await this.delay(200)
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

  async refreshSettings() {
    if (!this.publicKey) return
    await this.base.ready()
    const key = this._safeKeyString(this.publicKey)
    const settingsData = await this.base.view.get('@gigauser/settings', { key })
    console.log(settingsData)
    if (settingsData && settingsData.value) {
      this._settings = this._safeParseJSON(settingsData.value, {})
    }
  }

  static deriveKeysFromSeed(seed) {
    const seedPhrase = Array.isArray(seed) ? seed.join(' ') : seed;
    const seedBuffer = b4a.from(seedPhrase);

    // Master hash
    const masterHash = crypto.createHash('sha256').update(seedBuffer).digest();

    // Derive keys
    return {
      publicKey: masterHash.slice(0, 32),
      secretKey: masterHash,
      discoveryKey: crypto.createHash('sha256')
        .update(Buffer.concat([masterHash, Buffer.from('discovery')]))
        .digest(),
      encryptionKey: crypto.createHash('sha256')
        .update(Buffer.concat([masterHash, Buffer.from('encryption')]))
        .digest()
    };
  }

  // Invite and device pairing methods
  async createPairingInvite() {
    if (this.opened === false) await this.ready()
    // Create a new invite
    const { id, invite, publicKey, expires } = BlindPairing.createInvite(this.base.key)
    const record = { id, invite, publicKey, expires }

    // Log the invite details to help with debugging
    console.log('Creating new invite:', {
      id: b4a.toString(id, 'hex'),
      publicKey: b4a.toString(publicKey, 'hex'),
      expires
    })

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

  set profile(v) {
    this._profile = v
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
    const user = new Gigauser(store, { ...opts, seed })
    console.log('Gigauser.create - Instance created')

    try {
      await user.ready()
      console.log('Gigauser.create - Ready called')
      if (!user.publicKey && seed) {
        await user.createIdentity(seed)
      }
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

  static async recoverFromSeed(store, seed, opts = {}) {
    const seedPhrase = Array.isArray(seed) ? seed.join(' ') : seed;
    console.log('Starting recovery from seed phrase');

    // Derive keys from seed
    const keys = this.deriveKeysFromSeed(seedPhrase);

    // Create swarm for networking
    const swarm = new Hyperswarm({
      keyPair: await store.createKeyPair('hyperswarm'),
      bootstrap: opts.bootstrap || null
    });

    const recoveryTimeout = opts.timeout || 120000; // 2 minutes

    // Set up invite collection
    let receivedInvite = null;

    // Setup connection handler
    swarm.on('connection', (connection, peerInfo) => {
      console.log('Connected to peer:', peerInfo.publicKey.toString('hex').substring(0, 8));

      // Set up data handler for invite responses
      connection.on('data', (data) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === 'invite-response' && message.invite) {
            console.log('Received invite code from peer');
            receivedInvite = message.invite;
          }
        } catch (err) {
          // Ignore non-JSON data
        }
      });

      // Send invite request
      const requestMessage = JSON.stringify({
        type: 'invite-request',
        publicKey: keys.publicKey.toString('hex'),
        timestamp: Date.now()
      });

      connection.write(Buffer.from(requestMessage));
    });

    // Join the recovery topic
    console.log('Joining seed-derived topic:', keys.discoveryKey.toString('hex').substring(0, 8));
    swarm.join(keys.discoveryKey);

    try {
      // Promise that resolves when an invite is received
      const invitePromise = new Promise(resolve => {
        const checkInterval = setInterval(() => {
          if (receivedInvite) {
            clearInterval(checkInterval);
            resolve(receivedInvite);
          }
        }, 500);
      });

      // Promise that rejects after timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error('Recovery timeout: No invite received'));
        }, recoveryTimeout);
      });

      // Wait for either an invite or timeout
      console.log('Waiting for invite response...');
      const invite = await Promise.race([invitePromise, timeoutPromise]);

      // If we got here, we received an invite
      console.log('Successfully received invite, pairing device...');
      await swarm.destroy();

      // Use the existing pairing mechanism
      return await Gigauser.pairDevice(store, invite, opts);

    } catch (error) {
      console.log(error.message);

      // Clean up
      await swarm.destroy();

      // If timeout or error, create new user
      if (error.message.includes('timeout') || error.message.includes('No invite')) {
        console.log('Creating new user with seed');
        return await Gigauser.create(store, seedPhrase, opts);
      }

      // For other errors, propagate
      throw error;
    }
  }
  // Add this method to Gigauser class
  async setupRecoveryResponder() {
    if (!this.seed || !this.swarm) return;

    const keys = Gigauser.deriveKeysFromSeed(this.seed);

    // Join the recovery topic
    console.log('Setting up recovery responder on topic:', keys.discoveryKey.toString('hex').substring(0, 8));
    this.swarm.join(keys.discoveryKey);

    // Listen for connections and respond to invite requests
    this.swarm.on('connection', async (connection, peerInfo) => {
      console.log('Recovery topic connection from:', peerInfo.publicKey.toString('hex').substring(0, 8));

      connection.on('data', async (data) => {
        try {
          const message = JSON.parse(data.toString());

          if (message.type === 'invite-request') {
            console.log('Received invite request, generating invite');

            try {
              // Generate a fresh invite
              const invite = await this.createPairingInvite();

              // Send invite response
              const response = JSON.stringify({
                type: 'invite-response',
                invite,
                timestamp: Date.now()
              });

              connection.write(Buffer.from(response));
              console.log('Sent invite response to peer');
            } catch (err) {
              console.error('Error generating or sending invite:', err);
            }
          }
        } catch (err) {
          // Ignore non-JSON data
        }
      });
    });
  }


  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }




  // Rooms
  async createRoom(roomData) {
    await this.base.ready()
    if (!this.publicKey) throw new Error('Identity not created')

    // Generate a unique room ID with NO trailing spaces!
    const roomId = crypto.randomBytes(8).toString('hex')
    const roomNamespace = `${roomId}`.trim()
    console.log(`Creating room with namespace: ${roomNamespace}`)

    const roomStore = this.store.namespace(roomNamespace)

    // Create the room using GigaRoom.create with explicit namespace
    const room = await GigaRoom.create(roomStore, {
      ...roomData,
      id: roomId
    }, this.publicKey, {
      owner: this,
      creatorDisplayName: this._profile.name || 'User',
      namespace: roomNamespace // Pass namespace explicitly
    })
    await room.ready()

    // Ensure room is added to user's rooms with consistent namespace
    await this.addRoom({
      id: room.id,
      name: room.name,
      description: room.description,
      key: room.base.key ? room.base.key.toString('hex') : null,
      discoveryKey: room.base.discoveryKey ? room.base.discoveryKey.toString('hex') : null,
      roomNamespace: roomNamespace, // Consistent namespace with NO trailing space
      createdAt: Date.now(),
      encryptionKey: room.base.encryptionKey.toString('hex'),
      inviteHash: null,
    })

    // Store instance with clean namespace
    this._roomInstances.set(room.id, room)

    return room
  }

  async joinRoom(inviteCode, opts = {}) {
    console.log('Joining room with invite:', inviteCode.substring(0, 10))

    if (!this.publicKey) throw new Error('Identity not created')

    // Validate invite code
    if (!this._validateInviteCode(inviteCode)) {
      throw new Error('Invalid invite code')
    }

    // Derive a deterministic namespace from invite code - ENSURE NO TRAILING SPACE
    const inviteHash = crypto.createHash('sha256')
      .update(inviteCode)
      .digest('hex')
      .slice(0, 16)

    // Ensure store is ready before creating namespace
    if (typeof this.store.ready !== 'function') {
      throw new Error('Invalid corestore: missing ready method')
    }

    // Wait for store to be ready
    await this.store.ready()

    // IMPORTANT: Ensure NO trailing whitespace in namespace
    const roomNamespace = `${inviteHash}`.trim()
    console.log('Joining room with namespace:', roomNamespace)

    // Create room store with namespace
    const roomStore = this.store.namespace(roomNamespace)

    // Ensure room store is also ready
    if (typeof roomStore.ready !== 'function') {
      throw new Error('Invalid room namespace: missing ready method')
    }
    await roomStore.ready()

    // Use GigaRoom's join method, passing namespace for consistency
    const room = await GigaRoom.joinRoom(roomStore, inviteCode, {
      owner: this,
      userKey: this.publicKey,
      displayName: this._profile.name || 'User',
      namespace: roomNamespace, // Pass namespace explicitly
      ...opts
    })
    await room.ready()
    await room.forceUpdate()

    const roomData = await room.getRoomData()

    console.log('Room joined successfully:', {
      roomId: room.id,
      baseKey: room.base.key.toString('hex'),
      discoveryKey: room.base.discoveryKey.toString('hex'),
      namespace: roomNamespace
    })

    // Add to rooms list with consistent namespace
    await this.addRoom({
      id: roomData.id,
      name: room.name,
      description: room.description,
      key: room.base.key ? room.base.key.toString('hex') : null,
      discoveryKey: room.base.discoveryKey ? room.base.discoveryKey.toString('hex') : null,
      createdAt: room.createdAt || Date.now(),
      inviteCode: inviteCode,
      inviteHash: inviteHash,
      roomNamespace: roomNamespace, // No trailing spaces!
      encryptionKey: room.base.encryptionKey.toString('hex'),
    })

    // Store instance with clean namespace
    this._roomInstances.set(room.id, room)

    return room
  }

  // Invite code validation method
  _validateInviteCode(inviteCode) {
    // Implement invite code validation logic
    // e.g., check length, format, decode successfully
    try {
      z32.decode(inviteCode)
      return true
    } catch (error) {
      return false
    }
  }

  async _initializeRoomInstances() {
    console.log('Initializing room instances...')

    // Ensure this method is called after user data is loaded
    if (!this.publicKey) return

    // Try to load and initialize each room
    for (const roomInfo of this._rooms) {
      try {
        console.log(`Attempting to initialize room: ${roomInfo.id}`)

        const existing = this._roomInstances.get(roomInfo.id)
        if (existing) continue
        // Determine the namespace for the room

        let roomNamespace;
        console.log('INIT_ ', roomInfo)

        if (roomInfo.roomNamespace) {
          // Use the full namespace string if available
          roomNamespace = roomInfo.roomNamespace;
          console.log(`Using stored room namespace: ${roomNamespace} `);
        } else {
          // Fallback to roomId-based namespace (for rooms created by this user)
          roomNamespace = `${roomInfo.id}`.trim();
          console.log(`Using default roomId namespace: ${roomNamespace} `);
        }

        console.log(`INITROOM: Using namespace: ${roomNamespace} `);

        // Get the room store with the determined namespace
        const roomStore = this.store.namespace(roomNamespace)
        // Create room instance
        const room = new GigaRoom(roomStore, {
          owner: this,
          id: roomInfo.id,
          encryptionKey: roomInfo.encryptionKey,
          key: roomInfo.key ? Buffer.from(roomInfo.key, 'hex') : null,
          discoveryKey: roomInfo.discoveryKey ? Buffer.from(roomInfo.discoveryKey, 'hex') : null,
          name: roomInfo.name,
          roomNamespace
        })

        // Wait for room to be ready
        await room.ready()
        // todo, catch all events and fire them 

        // Store the room instance
        this._roomInstances.set(roomInfo.id, room)

        console.log(`Room initialized: ${roomInfo.id} `)
      } catch (error) {
        console.error(`Error initializing room ${roomInfo.id}: `, error)
      }
    }
  }

  async getRoom(roomId) {
    console.log(`getRoom called with roomId: ${roomId}`)

    // First, normalize the namespace by trimming whitespace
    const normalizedId = typeof roomId === 'string' ? roomId.trim() : roomId

    // Check if room exists in instance cache with normalized ID
    if (this._roomInstances.has(normalizedId)) {
      console.log(`Room found in instance cache with normalized ID: ${normalizedId}`)
      return this._roomInstances.get(normalizedId)
    }

    // Check if room exists in instance cache with original ID
    if (roomId !== normalizedId && this._roomInstances.has(roomId)) {
      console.log(`Room found in instance cache with original ID: ${roomId}`)
      return this._roomInstances.get(roomId)
    }

    // Find room in room list
    console.log('Looking for room in room list:', this._rooms.map(r => r.roomNamespace))
    let roomInfo = this._rooms.find(r => {
      // Try both direct match and normalized match
      const normalizedNamespace = r.roomNamespace ? r.roomNamespace.trim() : roomNamespace
      return normalizedNamespace === normalizedId || r.roomNamespace === roomId
    })

    if (!roomInfo) {
      throw new Error(`Room not found: ${roomId}. Available rooms: ${this._rooms.map(r => r.roomNamespace).join(', ')}`)
    }

    try {
      // Use normalized namespace
      const roomNamespace = roomInfo.roomNamespace.trim()
      console.log(`Loading room with namespace: ${roomNamespace}`)

      // Create room store
      const roomStore = this.store.namespace(roomNamespace)

      // Create room with consistent namespace
      const room = new GigaRoom(roomStore, {
        owner: this,
        id: roomInfo.id,
        encryptionKey: roomInfo.encryptionKey,
        key: roomInfo.key ? Buffer.from(roomInfo.key, 'hex') : null,
        discoveryKey: roomInfo.discoveryKey ? Buffer.from(roomInfo.discoveryKey, 'hex') : null,
        name: roomInfo.name,
        namespace: roomNamespace // Pass namespace explicitly
      })

      await room.ready()

      // Store with normalized namespace
      this._roomInstances.set(roomInfo.id, room)

      // Force an update to ensure we have latest data
      setTimeout(() => {
        room.forceUpdate().catch(err => {
          console.error('Error in delayed force update:', err)
        })
      }, 2000)

      return room

    } catch (err) {
      console.error(`Error loading room ${roomId}:`, err)
      throw err
    }
  }


  async updateRooms(rooms) {
    if (!this.publicKey) throw new Error("Public key is missing")
    if (!rooms) {
      throw new Error("updateRooms: Invalid rooms arg passed")
    }
    const key = this._safeKeyString(this.publicKey)
    await this.base.append(dispatch('@gigauser/update-rooms', {
      key,
      value: JSON.stringify(rooms)
    }))
  }

  // Leave a room
  async leaveRoom(roomId) {
    // Get the room instance
    let room
    try {
      room = await this.getRoom(roomId)
    } catch (err) {
      // Room might not be loaded, just remove from list
      const updatedRooms = this._rooms.filter(r => r.id !== roomId)
      await this.updateRooms(updatedRooms)
      return true
    }

    // Remove self from room members
    const memberInfo = room.members.find(m =>
      Buffer.isBuffer(m.userKey)
        ? m.userKey.equals(this.publicKey)
        : m.userKey === this.publicKey.toString('hex')
    )

    if (memberInfo) {
      await room.removeMember(memberInfo.id)
    }

    // Close the room instance
    await room.close()

    // Remove from instances map
    this._roomInstances.delete(roomNamespace)

    // Remove from rooms list
    const updatedRooms = this._rooms.filter(r => r.id !== roomId)
    await this.updateRooms(updatedRooms)

    return true
  }

  // Close all room instances
  async closeAllRooms() {
    const promises = []
    for (const room of this._roomInstances.values()) {
      promises.push(room.close())
    }

    await Promise.all(promises)
    this._roomInstances.clear()
  }

  // Override the close method to also close rooms
  async close() {
    await this.closeAllRooms()
    // Call the original close method
    await super.close()
  }


}



function noop(e) {
  console.log('op', e)
}

module.exports = Gigauser
