// GigaRoom.js - Main room module for Gigachat
// This class is designed to be managed by GigaUser instances, where each user
// can have multiple rooms (similar to Discord servers)
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

class GigaRoomPairer extends ReadyResource {
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
        if (this.room === null) {
          this.room = new GigaRoom(this.store, {
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
    if (this.room.base.writable) return
    const check = () => {
      if (this.room.base.writable) {
        this.room.base.off('update', check)
        this.onresolve(this.room)
      }
    }
    this.room.base.on('update', check)
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
    } else if (this.room) {
      await this.room.close()
    }
  }

  finished() {
    return new Promise((resolve, reject) => {
      this.onresolve = resolve
      this.onreject = reject
    })
  }
}

class GigaRoom extends ReadyResource {
  constructor(corestore, opts = {}) {
    super()

    // Core components
    this.router = new Router()
    this.store = corestore
    this.swarm = opts.swarm || null
    this.base = null
    this.bootstrap = opts.bootstrap || null
    this.member = null
    this.pairing = null
    this.replicate = opts.replicate !== false
    this.blobsCoreKey = null

    // Owner reference - the GigaUser that owns/manages this room
    this.owner = opts.owner || null

    // Room properties
    this.id = opts.id || null
    this.key = opts.key || null
    this.discoveryKey = null
    this.name = opts.name || null
    this.description = opts.description || null
    this.createdBy = opts.createdBy || null
    this.createdAt = opts.createdAt || null
    this.isPrivate = opts.isPrivate || false
    this.isEncrypted = opts.isEncrypted || false

    // Room data collections
    this._members = []
    this._channels = []
    this._categories = []
    this._roles = []
    this._settings = {}

    // Register handlers for commands
    this._registerHandlers()

    // Initialize autobase
    this._boot(opts)

    // Prepare for opening
    this.ready().catch(noop)
  }

  _boot(opts = {}) {
    const { encryptionKey, key } = opts

    // Initialize Autobase with proper handlers
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
    // Writer management
    this.router.add('@gigaroom/remove-writer', async (data, context) => {
      await context.base.removeWriter(data.key)
    })

    this.router.add('@gigaroom/add-writer', async (data, context) => {
      await context.base.addWriter(data.key)
    })

    // Invite management
    this.router.add('@gigaroom/add-invite', async (data, context) => {
      await context.view.insert('@gigaroom/invite', data)
    })

    // Room management
    this.router.add('@gigaroom/create-room', async (data, context) => {
      await context.view.insert('@gigaroom/room', data)
    })

    this.router.add('@gigaroom/update-room', async (data, context) => {
      try {
        await context.view.delete('@gigaroom/room', { id: data.id })
      } catch (e) {
        // Ignore deletion errors
      }
      await context.view.insert('@gigaroom/room', data)
    })

    // Member management
    this.router.add('@gigaroom/add-member', async (data, context) => {
      await context.view.insert('@gigaroom/member', data)
    })

    this.router.add('@gigaroom/update-member', async (data, context) => {
      try {
        await context.view.delete('@gigaroom/member', { id: data.id })
      } catch (e) {
        // Ignore deletion errors
      }
      await context.view.insert('@gigaroom/member', data)
    })

    this.router.add('@gigaroom/remove-member', async (data, context) => {
      await context.view.delete('@gigaroom/member', { id: data.id })
    })

    // Channel management
    this.router.add('@gigaroom/create-channel', async (data, context) => {
      await context.view.insert('@gigaroom/channel', data)
    })

    this.router.add('@gigaroom/update-channel', async (data, context) => {
      try {
        await context.view.delete('@gigaroom/channel', { id: data.id })
      } catch (e) {
        // Ignore deletion errors
      }
      await context.view.insert('@gigaroom/channel', data)
    })

    this.router.add('@gigaroom/delete-channel', async (data, context) => {
      await context.view.delete('@gigaroom/channel', { id: data.id })
    })

    // Category management
    this.router.add('@gigaroom/create-category', async (data, context) => {
      await context.view.insert('@gigaroom/category', data)
    })

    this.router.add('@gigaroom/create-role', async (data, context) => {
      await context.view.insert('@gigaroom/role', data)
    })

    this.router.add('@gigaroom/update-role', async (data, context) => {
      try {
        await context.view.delete('@gigaroom/role', { id: data.id })
      } catch (e) {
        // Ignore deletion errors
      }
      await context.view.insert('@gigaroom/role', data)
    })

    this.router.add('@gigaroom/delete-role', async (data, context) => {
      await context.view.delete('@gigaroom/role', { id: data.id })
    })

    // Add similar placeholder handlers for other commands if needed
    this.router.add('@gigaroom/set-permission-override', async (data, context) => {
      await context.view.insert('@gigaroom/permissionOverride', data)
    })

    // Add more empty handlers for other commands in the schema
    // This prevents the "Missing handler" error while providing a basic implementation
    const placeholderCommands = [
      '@gigaroom/add-message',
      '@gigaroom/edit-message',
      '@gigaroom/delete-message',
      '@gigaroom/add-reaction',
      '@gigaroom/remove-reaction',
      '@gigaroom/add-file',
      '@gigaroom/add-mention',
      '@gigaroom/update-category',
      '@gigaroom/delete-category',
      '@gigaroom/create-thread',
      '@gigaroom/update-thread'
    ]

    placeholderCommands.forEach(command => {
      this.router.add(command, async (data, context) => {
        // Basic insertion or update logic
        try {
          await context.view.insert(command.replace('@gigaroom/', '@gigaroom/'), data)
        } catch (error) {
          console.warn(`Placeholder handler for ${command}:`, error)
        }
      })
    })

    // Add more handlers as needed
  }

  // Apply updates from autobase
  async _apply(nodes, view, base) {
    const updates = {
      messages: false,
      members: false,
      channels: false,
      room: false
    }

    for (const node of nodes) {
      // Check node type to track what was updated
      if (node.value && typeof node.value === 'object') {
        const commandId = node.value[0] // First byte is command ID
        if (commandId >= 18 && commandId <= 20) updates.messages = true // Message commands
        if (commandId >= 5 && commandId <= 7) updates.members = true // Member commands
        if (commandId >= 12 && commandId <= 14) updates.channels = true // Channel commands
        if (commandId === 3 || commandId === 4) updates.room = true // Room commands
      }

      await this.router.dispatch(node.value, { view, base })
    }
    await view.flush()

    // Refresh room data after updates
    if (nodes.length > 0) {
      await this._loadRoomData()

      // Emit specific events based on what was updated
      if (updates.messages) this.emit('messages-updated')
      if (updates.members) this.emit('members-updated')
      if (updates.channels) this.emit('channels-updated')
      if (updates.room) this.emit('room-updated')
    }
  }

  // Open method
  async _open() {
    await this.base.ready()

    // Set up replication if enabled
    if (this.replicate) await this._replicate()

    // Load initial room data
    await this._loadRoomData()

    // Set up file storage core if needed
    if (!this.blobsCoreKey) {
      const k = `room-blobs-${this.id || 'default'}`
      const blobsCore = this.store.get({ name: k })
      await blobsCore.ready()
      this.blobsCoreKey = blobsCore.key
    }

    // Set up event listeners for propagation to owner if available
    this._setupEventPropagation()
  }

  // Set up event propagation to owner (GigaUser)
  _setupEventPropagation() {
    if (!this.owner) return

    // Forward relevant events to the owner
    const eventsToPropagate = [
      'update', 'message', 'member-join', 'member-leave',
      'channel-created', 'channel-updated', 'channel-deleted'
    ]

    for (const eventName of eventsToPropagate) {
      this.on(eventName, (data) => {
        // Add room ID to the data
        const eventData = { roomId: this.id, ...data }
        // Propagate to owner with a room- prefix
        this.owner.emit(`room-${eventName}`, eventData)
      })
    }
  }

  // Load room data from database
  async _loadRoomData() {
    try {
      // Load room details
      const roomData = await this.base.view.findOne('@gigaroom/room', {})
      if (roomData) {
        this.id = roomData.id
        this.name = roomData.name
        this.description = roomData.description
        this.createdBy = roomData.createdBy
        this.createdAt = roomData.createdAt
        this.isPrivate = roomData.isPrivate
        this.isEncrypted = roomData.isEncrypted

        // Load settings if available
        if (roomData.settings) {
          this._settings = this._safeParseJSON(roomData.settings, {})
        }
      }

      // Load members
      this._members = []
      const membersStream = this.base.view.find('@gigaroom/member', {})
      for await (const member of membersStream) {
        this._members.push(member)
      }

      // Load channels
      this._channels = []
      const channelsStream = this.base.view.find('@gigaroom/channel', {})
      for await (const channel of channelsStream) {
        this._channels.push(channel)
      }

      // Load categories
      this._categories = []
      const categoriesStream = this.base.view.find('@gigaroom/category', {})
      for await (const category of categoriesStream) {
        this._categories.push(category)
      }

      // Load roles if needed
      this._roles = []
      const rolesStream = this.base.view.find('@gigaroom/role', {})
      for await (const role of rolesStream) {
        this._roles.push(role)
      }

    } catch (err) {
      console.error('Error loading room data:', err)
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
    }

    this.pairing = new BlindPairing(this.swarm)
    this.member = this.pairing.addMember({
      discoveryKey: this.base.discoveryKey,
      onadd: async (candidate) => {
        try {
          const id = candidate.inviteId
          // Find the invite in the database
          let inv = null
          try {
            const stream = this.base.view.find('@gigaroom/invite', {})
            for await (const invite of stream) {
              if (b4a.equals(invite.id, id)) {
                inv = invite
                break
              }
            }
          } catch (err) {
            console.error('Error finding invite:', err)
          }

          // Check if invite exists and is valid
          if (!inv) return

          // Check if invite is expired
          const now = Date.now()
          if (inv.expires && inv.expires < now) return

          // Open the candidate and add the writer
          candidate.open(inv.publicKey)
          await this.addWriter(candidate.userData)
          candidate.confirm({
            key: this.base.key,
            encryptionKey: this.base.encryptionKey
          })
        } catch (err) {
          console.error('Error in member.onadd:', err)
        }
      }
    })

    // Join the swarm with the room's discovery key
    this.swarm.join(this.base.discoveryKey)
  }

  // Close method
  async _close() {
    if (this.swarm) {
      if (this.member) await this.member.close()
      if (this.pairing) await this.pairing.close()
      await this.swarm.destroy()
    }

    if (this.base) await this.base.close()
  }

  // Helper method for parsing JSON safely
  _safeParseJSON(jsonStr, defaultValue = null) {
    if (!jsonStr) return defaultValue
    try {
      return JSON.parse(jsonStr)
    } catch (err) {
      console.error('JSON parsing error:', err)
      return defaultValue
    }
  }

  // Create a new room
  async createRoom(roomData, creatorPublicKey) {
    if (!roomData.name) throw new Error('Room name is required')

    // Generate a unique room ID
    const roomId = crypto.randomBytes(8).toString('hex')

    // Create room object
    const room = {
      id: roomId,
      type: roomData.type || 'channel',
      name: roomData.name,
      description: roomData.description || '',
      avatar: roomData.avatar || null,
      createdAt: Date.now(),
      createdBy: creatorPublicKey,
      discoveryKey: this.base.discoveryKey,
      coreKey: this.base.key,
      isPrivate: roomData.isPrivate || false,
      isEncrypted: roomData.isEncrypted || false,
      settings: JSON.stringify(roomData.settings || {})
    }

    // Create default channels if not specified
    if (!roomData.noDefaultChannels) {
      // We'll add default channels after room creation
    }

    // Create the room
    await this.base.append(dispatch('@gigaroom/create-room', room))

    // Create default general channel
    await this.createChannel({
      name: 'general',
      type: 'text',
      isDefault: true
    }, creatorPublicKey)

    // Add the creator as admin member
    await this.addMember({
      userKey: creatorPublicKey,
      displayName: roomData.creatorDisplayName || 'Admin',
      roles: JSON.stringify(['admin'])
    })

    // Reload room data
    await this._loadRoomData()

    return this.id
  }

  // Add a writer to the room
  async addWriter(key) {
    await this.base.append(dispatch('@gigaroom/add-writer', { key: b4a.isBuffer(key) ? key : b4a.from(key) }))
    return true
  }

  // Remove a writer from the room
  async removeWriter(key) {
    await this.base.append(dispatch('@gigaroom/remove-writer', { key: b4a.isBuffer(key) ? key : b4a.from(key) }))
  }

  // Create a room invite
  async createInvite(opts = {}) {
    // Create a new invite using blind-pairing
    const { id, invite, publicKey, expires } = BlindPairing.createInvite(this.base.key)

    // Prepare invite record
    const record = {
      id,
      invite,
      publicKey,
      expires: opts.expires || (Date.now() + 24 * 60 * 60 * 1000), // Default 24h expiry
      roomId: this.id,
      maxUses: opts.maxUses || 0,
      useCount: 0,
      isRevoked: false
    }

    // Store the invite
    await this.base.append(dispatch('@gigaroom/add-invite', record))

    // Return encoded invite string
    return z32.encode(record.invite)
  }

  // Create a channel in the room
  async createChannel(channelData, creatorPublicKey) {
    if (!this.id) throw new Error('Room not initialized')
    if (!channelData.name) throw new Error('Channel name is required')

    // Generate a unique channel ID
    const channelId = crypto.randomBytes(8).toString('hex')

    // Get the highest position to place the new channel at the end
    let position = 0
    try {
      const channels = this._channels
      if (channels.length > 0) {
        const highestPos = Math.max(...channels.map(c => c.position))
        position = highestPos + 1
      }
    } catch (err) {
      console.error('Error getting channel position:', err)
    }

    // Create channel object
    const channel = {
      id: channelId,
      roomId: this.id,
      type: channelData.type || 'text',
      name: channelData.name,
      topic: channelData.topic || '',
      position: channelData.position !== undefined ? channelData.position : position,
      categoryId: channelData.categoryId || null,
      createdAt: Date.now(),
      createdBy: creatorPublicKey,
      isDefault: channelData.isDefault || false,
      settings: JSON.stringify(channelData.settings || {})
    }

    // Create the channel
    await this.base.append(dispatch('@gigaroom/create-channel', channel))

    // Reload room data
    await this._loadRoomData()

    return channelId
  }

  // Add a member to the room
  async addMember(memberData) {
    if (!this.id) throw new Error('Room not initialized')
    if (!memberData.userKey) throw new Error('User key is required')

    // Generate a unique member ID
    const memberId = crypto.randomBytes(8).toString('hex')

    // Create member object
    const member = {
      id: memberId,
      roomId: this.id,
      userKey: memberData.userKey,
      displayName: memberData.displayName || 'Member',
      joinedAt: Date.now(),
      invitedBy: memberData.invitedBy || null,
      lastActivity: Date.now(),
      status: memberData.status || 'active',
      lastReadId: null,
      roles: memberData.roles || JSON.stringify(['member'])
    }

    // Add the member
    await this.base.append(dispatch('@gigaroom/add-member', member))

    // Also add as writer if not already
    try {
      await this.addWriter(memberData.userKey)
    } catch (err) {
      console.error('Error adding writer:', err)
    }

    // Reload room data
    await this._loadRoomData()

    return memberId
  }

  // Remove a member from the room
  async removeMember(memberId) {
    if (!this.id) throw new Error('Room not initialized')

    // Find the member to get their key
    const member = this._members.find(m => m.id === memberId)
    if (!member) throw new Error('Member not found')

    // Remove the member
    await this.base.append(dispatch('@gigaroom/remove-member', { id: memberId }))

    // Optionally remove as writer
    // Note: We might want to keep them as a writer if they have other memberships
    // await this.removeWriter(member.userKey)

    // Reload room data
    await this._loadRoomData()

    return true
  }

  // Join a room using an invite
  static async joinRoom(store, inviteCode, opts = {}) {
    try {
      const pairer = GigaRoom.pair(store, inviteCode, opts)

      const pairingPromise = pairer.finished()
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Room joining timed out')), 30000)
      )

      const room = await Promise.race([pairingPromise, timeoutPromise])
      await room.ready()

      // Enhanced member addition
      if (opts.userKey) {
        try {
          await room.addMember({
            userKey: opts.userKey,
            displayName: opts.displayName || 'New Member',
            // Optional: Add more metadata
            metadata: {
              joinMethod: 'invite',
              inviteUsed: inviteCode
            }
          })
        } catch (memberError) {
          console.error('Error adding member:', memberError)
          // Optionally: Implement member addition retry or fallback
        }
      }

      return room
    } catch (err) {
      console.error('Comprehensive room joining error:', err)
      throw err
    }
  }

  // Static pair method
  static pair(store, invite, opts) {
    return new GigaRoomPairer(store, invite, opts)
  }

  // Static create method
  static async create(store, roomData, creatorPublicKey, opts = {}) {
    const room = new GigaRoom(store, opts)
    await room.ready()
    await room.createRoom(roomData, creatorPublicKey)

    // Emit room-created event for the owner to handle
    if (room.owner) {
      room.owner.emit('room-created', {
        roomId: room.id,
        name: room.name,
        key: room.key
      })
    }

    return room
  }

  // Update owner reference (for GigaUser to claim this room)
  setOwner(owner) {
    this.owner = owner
    this._setupEventPropagation()
    return this
  }

  // Getters for room data
  get members() {
    return this._members
  }

  get channels() {
    return this._channels
  }

  get categories() {
    return this._categories
  }

  get roles() {
    return this._roles
  }

  get settings() {
    return this._settings
  }

  // Get serializable room info for storing in GigaUser
  get roomInfo() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      key: this.key ? (Buffer.isBuffer(this.key) ? this.key.toString('hex') : this.key) : null,
      discoveryKey: this.discoveryKey ? (Buffer.isBuffer(this.discoveryKey) ? this.discoveryKey.toString('hex') : this.discoveryKey) : null,
      createdAt: this.createdAt,
      memberCount: this._members.length,
      lastAccessed: Date.now()
    }
  }
}

function noop(err) {
  if (err) console.error('Operation error:', err)
}

module.exports = GigaRoom
