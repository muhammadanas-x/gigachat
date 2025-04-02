/**
 * RoomManager - Main class for managing rooms in Gigachat
 * Following patterns from Autopass with improved security and error handling
 */
const ReadyResource = require('ready-resource')
const Autobase = require('autobase')
const BlindPairing = require('blind-pairing')
const Hyperswarm = require('hyperswarm')
const HyperDB = require('hyperdb')
const Hyperblobs = require('hyperblobs')
const crypto = require('crypto')
const b4a = require('b4a')
const z32 = require('z32')
const { Router, dispatch } = require('../spec/hyperdispatch')
const db = require('../spec/db/index.js')

/**
 * RoomManager class handles chat rooms, messages, and file sharing
 * 
 * @class
 * @extends ReadyResource
 */
class RoomManager extends ReadyResource {
  /**
   * Create a new RoomManager instance
   * @param {object} corestore - Corestore instance
   * @param {object} [opts={}] - Configuration options
   * @param {Buffer|string} [opts.key] - Key for loading existing room
   * @param {string} [opts.invite] - Invite code for joining a room
   * @param {string} [opts.name] - Room name (for new rooms)
   * @param {string} [opts.description] - Room description (for new rooms)
   * @param {Buffer} [opts.owner] - Owner's public key (for new rooms)
   * @param {Buffer} [opts.encryptionKey] - Key for encryption
   * @param {boolean} [opts.encrypt=true] - Whether to encrypt data
   * @param {object} [opts.swarm] - Existing Hyperswarm instance
   * @param {Array|string} [opts.bootstrap] - Bootstrap servers for the swarm
   * @param {boolean} [opts.private=true] - Whether the room is private
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
    this.view = null
    this.files = null
    this.member = null
    this.pairing = null
    this.replicate = opts.replicate !== false
    this.encrypt = opts.encrypt !== false
    this.encryptionKey = opts.encryptionKey || null

    // Room details
    this.name = opts.name || 'Unnamed Room'
    this.description = opts.description || ''
    this.owner = opts.owner || null
    this.invite = opts.invite || null
    this.id = null
    this.private = opts.private !== false
    this.lastAccessed = Date.now()

    // State tracking
    this._closing = false
    this._initialized = false

    // Register command handlers
    this._registerCommands()

    // Initialize the room
    this._boot(opts)
    this.ready().catch(err => {
      if (!this._closing) {
        if (this.debug) console.error('Error initializing RoomManager:', err)
        this.emit('error', err)
      }
    })
  }

  /**
   * Register command handlers for the router
   * @private
   */
  _registerCommands() {
    // Writer management
    this.router.add('@room/add-writer', async (data, context) => {
      await context.base.addWriter(data.key)
    })

    this.router.add('@room/remove-writer', async (data, context) => {
      if (context.base.removeable(data.key)) {
        await context.base.removeWriter(data.key)
      }
    })

    // Invite management
    this.router.add('@room/add-invite', async (data, context) => {
      await context.view.insert('@room/invite', data)
    })

    // Room info management
    this.router.add('@room/update-info', async (data, context) => {
      try {
        await context.view.delete('@room/info', { id: 'room-info' })
      } catch (err) {
        // Ignore errors if no existing info
        if (this.debug) console.debug('No room info to delete:', err.message)
      }
      await context.view.insert('@room/info', data)
    })

    // Message management
    this.router.add('@room/add-message', async (data, context) => {
      await context.view.insert('@room/messages', data)
    })

    this.router.add('@room/edit-message', async (data, context) => {
      try {
        await context.view.delete('@room/messages', { id: data.id })
      } catch (err) {
        // Ignore errors if message doesn't exist
        if (this.debug) console.debug('Message not found for edit:', err.message)
      }
      await context.view.insert('@room/messages', data)
    })

    this.router.add('@room/delete-message', async (data, context) => {
      await context.view.delete('@room/messages', { id: data.id })
    })

    // Member management
    this.router.add('@room/add-member', async (data, context) => {
      try {
        await context.view.delete('@room/members', { id: data.id })
      } catch (err) {
        // Ignore errors if member doesn't exist
        if (this.debug) console.debug('No member to delete:', err.message)
      }
      await context.view.insert('@room/members', data)

      // Add as writer if they aren't already
      if (data.publicKey) {
        try {
          await context.base.addWriter(data.publicKey)
        } catch (err) {
          if (this.debug) console.error('Error adding member as writer:', err)
        }
      }
    })

    this.router.add('@room/remove-member', async (data, context) => {
      await context.view.delete('@room/members', { id: data.id })

      // Remove as writer if removable
      if (data.publicKey && context.base.removeable(data.publicKey)) {
        try {
          await context.base.removeWriter(data.publicKey)
        } catch (err) {
          if (this.debug) console.error('Error removing member as writer:', err)
        }
      }
    })

    // File management
    this.router.add('@room/add-file', async (data, context) => {
      await context.view.insert('@room/files', data)
    })

    this.router.add('@room/delete-file', async (data, context) => {
      await context.view.delete('@room/files', { id: data.id })
    })
  }

  /**
   * Initialize the Autobase for room data
   * @param {object} opts - Configuration options
   * @private
   */
  _boot(opts = {}) {
    const { key, encryptionKey } = opts

    this.base = new Autobase(this.store, key, {
      encrypt: this.encrypt,
      encryptionKey,
      open: (store) => {
        return HyperDB.bee(store.get('room-db'), db, {
          extension: false,
          autoUpdate: true
        })
      },
      apply: this._apply.bind(this)
    })

    this.base.on('update', () => {
      if (!this.base._interrupting && !this._closing) {
        this.lastAccessed = Date.now()
        this.emit('update')
      }
    })

    this.base.on('error', (err) => {
      if (!this._closing) {
        if (this.debug) console.error('Autobase error:', err)
        this.emit('error', err)
      }
    })
  }

  /**
   * Apply function for the Autobase
   * @private
   * @param {Array} nodes - Nodes to apply
   * @param {object} view - View to apply to
   * @param {object} base - Base instance
   */
  async _apply(nodes, view, base) {
    for (const node of nodes) {
      if (!node.value) continue

      // Verify message signature if it's a message or file
      if (
        node.value.type === '@room/add-message' ||
        node.value.type === '@room/edit-message' ||
        node.value.type === '@room/add-file'
      ) {
        const message = node.value.value
        if (message && message.signature && message.author) {
          // Skip invalid messages
          if (!this._verifySignature(message)) {
            if (this.debug) console.warn('Skipping message with invalid signature')
            continue
          }
        }
      }

      await this.router.dispatch(node.value, { view, base })
    }
    await view.flush()
  }

  /**
   * Verify a message signature
   * @param {object} message - The message to verify
   * @returns {boolean} - Whether the signature is valid
   * @private
   */
  _verifySignature(message) {
    try {
      // Create a deterministic representation of the message
      const signable = this._prepareMessageForSigning(message)

      // Verify the signature
      const signature = b4a.isBuffer(message.signature)
        ? message.signature
        : b4a.from(message.signature, 'hex')

      const author = b4a.isBuffer(message.author)
        ? message.author
        : b4a.from(message.author, 'hex')

      // In a real implementation, this would use proper Ed25519 verification
      // For demonstration purposes, we'll use a simple HMAC check
      const expectedSignature = crypto.createHmac('sha256', author)
        .update(signable)
        .digest()

      return b4a.equals(signature, expectedSignature)
    } catch (err) {
      if (this.debug) console.error('Error verifying signature:', err)
      return false
    }
  }

  /**
   * Prepare a message for signing/verification
   * @param {object} message - The message object
   * @returns {Buffer} - The prepared message buffer
   * @private
   */
  _prepareMessageForSigning(message) {
    // Create a deterministic representation of the message
    const signable = {
      id: message.id,
      type: message.type,
      content: message.content,
      author: message.author,
      timestamp: message.timestamp,
      references: message.references,
      metadata: message.metadata
    }

    return b4a.from(JSON.stringify(signable))
  }

  /**
   * Initialize the room manager
   * @private
   */
  async _open() {
    try {
      await this.base.ready()
      await this.store.ready()

      this.view = this.base.view

      // Set up file storage
      this.files = new Hyperblobs(this.store.get('blobs'))

      // If we have an invite, join an existing room
      if (this.invite) {
        await this._joinWithInvite()
      }
      // Otherwise, if no key was provided, create a new room
      else if (!this.base.key) {
        await this._createNew()
      }
      // If key was provided, load existing room
      else {
        await this._loadExisting()
      }

      // Set up replication if needed
      if (this.replicate) {
        await this._setupReplication()
      }

      this._initialized = true
      this.emit('ready')
    } catch (err) {
      if (this._closing) return
      if (this.debug) console.error('Error in RoomManager._open:', err)
      throw err
    }
  }

  /**
   * Create a new room
   * @private
   */
  async _createNew() {
    // Generate room ID based on the base key
    this.id = b4a.toString(this.base.key, 'hex')

    // Initialize the room data
    const roomInfo = {
      id: 'room-info',
      name: this.name,
      description: this.description,
      created: Date.now(),
      owner: this.owner,
      private: this.private,
      settings: {
        notifications: true,
        encryption: this.encrypt
      }
    }

    // Save room info
    await this.base.append(dispatch('@room/update-info', roomInfo))

    // Add the creator as a member if owner is provided
    if (this.owner) {
      const ownerId = b4a.toString(this.owner, 'hex')

      await this.base.append(dispatch('@room/add-member', {
        id: ownerId,
        publicKey: this.owner,
        role: 'owner',
        joined: Date.now()
      }))
    }

    if (this.debug) console.log(`Created new room: ${this.id}`)
  }

  /**
   * Load an existing room
   * @private
   */
  async _loadExisting() {
    // Generate room ID based on the base key
    this.id = b4a.toString(this.base.key, 'hex')

    // Load room info
    try {
      const roomInfo = await this.view.get('@room/info', { id: 'room-info' })

      if (roomInfo) {
        this.name = roomInfo.value.name || this.name
        this.description = roomInfo.value.description || this.description
        this.owner = roomInfo.value.owner || this.owner
        this.private = roomInfo.value.private !== undefined ? roomInfo.value.private : this.private
      }

      if (this.debug) console.log(`Loaded existing room: ${this.id}`)
    } catch (err) {
      if (this.debug) console.warn('Could not load room info:', err)
    }
  }

  /**
   * Join an existing room with an invite code
   * @private
   */
  async _joinWithInvite() {
    if (!this.invite) {
      throw new Error('No invite code provided')
    }

    try {
      // Create a RoomPairer to handle the joining process
      const RoomPairer = require('./room-pairer')
      const pairer = new RoomPairer(this.store, this.invite, {
        bootstrap: this.bootstrap,
        debug: this.debug
      })

      // Wait for pairing to complete
      const result = await pairer.finished()

      // Update our base with the results
      this.base = result.base
      this.view = result.base.view
      this.swarm = result.swarm
      this.encryptionKey = result.encryptionKey

      // Generate room ID based on the base key
      this.id = b4a.toString(this.base.key, 'hex')

      // Load room info
      await this._loadExisting()

      if (this.debug) console.log(`Joined room via invite: ${this.id}`)
    } catch (err) {
      if (this.debug) console.error('Error joining room with invite:', err)
      throw new Error('Failed to join room with invite: ' + err.message)
    }
  }

  /**
   * Set up replication for room data
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
            console.log('RoomManager: New connection from',
              b4a.toString(peerInfo.publicKey, 'hex').slice(0, 8) + '...')
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
            const inv = await this.base.view.findOne('@room/invite', {})

            if (!inv || !b4a.equals(inv.id, id)) {
              if (this.debug) console.log('RoomManager: Invalid invite')
              return
            }

            // Open the candidate
            candidate.open(inv.publicKey)

            // Add the new member as a writer
            await this.addWriter(candidate.userData)

            // Send confirmation
            candidate.confirm({
              key: this.base.key,
              encryptionKey: this.base.encryptionKey
            })

            if (this.debug) console.log('RoomManager: Pairing confirmed')
          } catch (err) {
            if (this._closing) return
            console.error('Error handling room pairing request:', err)
          }
        }
      })

      // Join the swarm
      this.swarm.join(this.base.discoveryKey)
    } catch (err) {
      if (this._closing) return
      if (this.debug) console.error('Error setting up room replication:', err)
      throw err
    }
  }

  /**
   * Close the room manager and clean up resources
   * @private
   */
  async _close() {
    this._closing = true

    const closingPromises = []

    // Close member and pairing first
    if (this.member) {
      closingPromises.push(this.member.close().catch(err => {
        if (this.debug) console.error('Error closing room member:', err)
      }))
    }

    if (this.pairing) {
      closingPromises.push(this.pairing.close().catch(err => {
        if (this.debug) console.error('Error closing room pairing:', err)
      }))
    }

    // Wait for member and pairing to close
    try {
      await Promise.all(closingPromises)
    } catch (err) {
      if (this.debug) console.error('Error closing room pairing components:', err)
    }

    // Then close swarm
    if (this.swarm) {
      try {
        await this.swarm.destroy()
      } catch (err) {
        if (this.debug) console.error('Error destroying room swarm:', err)
      }
    }

    // Close file storage
    if (this.files) {
      try {
        // Hyperblobs doesn't have a close method, but we should clean up if needed
      } catch (err) {
        if (this.debug) console.error('Error closing room files:', err)
      }
    }

    // Finally close base
    if (this.base) {
      try {
        await this.base.close()
      } catch (err) {
        if (this.debug) console.error('Error closing room base:', err)
      }
    }
  }

  /**
   * Create an invite for joining the room
   * @param {object} [opts={}] - Invite options
   * @param {number} [opts.expiresIn=86400000] - Expiration time in milliseconds (default: 24 hours)
   * @returns {Promise<string>} - z32 encoded invite code
   */
  async createInvite(opts = {}) {
    if (this.opened === false) await this.ready()
    if (!this.base.writable) {
      throw new Error('Not writable')
    }

    // Check if an invite already exists
    const existing = await this.base.view.findOne('@room/invite', {})
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
    await this.base.append(dispatch('@room/add-invite', record))

    return z32.encode(record.invite)
  }

  /**
   * Add a writer to the room
   * @param {Buffer} key - Writer's public key
   * @returns {Promise<boolean>} - Success flag
   */
  async addWriter(key) {
    if (this.opened === false) await this.ready()
    if (!this.base.writable) {
      throw new Error('Not writable')
    }

    try {
      await this.base.append(dispatch('@room/add-writer', {
        key: b4a.isBuffer(key) ? key : b4a.from(key)
      }))
      return true
    } catch (err) {
      if (this._closing) return false
      if (this.debug) console.error('Error adding room writer:', err)
      throw err
    }
  }

  /**
   * Remove a writer from the room if possible
   * @param {Buffer} key - Writer's public key
   * @returns {Promise<boolean>} - Success flag
   */
  async removeWriter(key) {
    if (this.opened === false) await this.ready()
    if (!this.base.writable) {
      throw new Error('Not writable')
    }

    const writerKey = b4a.isBuffer(key) ? key : b4a.from(key)

    if (!this.base.removeable(writerKey)) {
      return false
    }

    try {
      await this.base.append(dispatch('@room/remove-writer', {
        key: writerKey
      }))
      return true
    } catch (err) {
      if (this._closing) return false
      if (this.debug) console.error('Error removing room writer:', err)
      throw err
    }
  }

  /**
   * Send a message to the room
   * @param {object} message - Message object
   * @param {string} message.content - Message content
   * @param {Buffer} message.author - Author's public key
   * @param {string} [message.type='text'] - Message type
   * @param {Array} [message.references=[]] - Message references
   * @param {object} [message.metadata={}] - Message metadata
   * @returns {Promise<object>} - The sent message with ID
   */
  async sendMessage(message) {
    if (this.opened === false) await this.ready()
    if (!this.base.writable) {
      throw new Error('Not writable')
    }

    try {
      // Generate a unique ID for the message
      const id = crypto.randomBytes(16).toString('hex')

      // Create the message object
      const msg = {
        id,
        type: message.type || 'text',
        content: message.content,
        author: message.author,
        timestamp: Date.now(),
        references: message.references || [],
        metadata: message.metadata || {}
      }

      // Sign the message if author key is provided
      if (message.authorPrivateKey) {
        msg.signature = this._signMessage(msg, message.authorPrivateKey)
      }

      // Add the message to the room
      await this.base.append(dispatch('@room/add-message', {
        id,
        value: msg
      }))

      return msg
    } catch (err) {
      if (this._closing) throw new Error('Room is closing')
      if (this.debug) console.error('Error sending message:', err)
      throw err
    }
  }

  /**
   * Sign a message with the author's private key
   * @param {object} message - Message to sign
   * @param {Buffer} privateKey - Author's private key
   * @returns {Buffer} - Message signature
   * @private
   */
  _signMessage(message, privateKey) {
    const signable = this._prepareMessageForSigning(message)

    // In a real implementation, this would use proper Ed25519 signatures
    // For demonstration purposes, we'll use a simple HMAC
    return crypto.createHmac('sha256', privateKey)
      .update(signable)
      .digest()
  }

  /**
   * Get messages from the room
   * @param {object} [opts={}] - Query options
   * @param {number} [opts.limit=50] - Maximum number of messages to return
   * @param {boolean} [opts.reverse=true] - Whether to return messages in reverse order
   * @param {string} [opts.lt] - Return messages lexicographically less than this ID
   * @param {string} [opts.gt] - Return messages lexicographically greater than this ID
   * @param {string} [opts.type] - Filter by message type
   * @returns {Promise<Array>} - Array of messages
   */
  async getMessages(opts = {}) {
    if (this.opened === false) await this.ready()

    try {
      const {
        limit = 50,
        reverse = true,
        lt,
        gt,
        type
      } = opts

      const queryOpts = {
        limit,
        reverse,
        lt,
        gt
      }

      // Get messages from the view
      let messages = await this.view.find('@room/messages', {}, queryOpts)

      // Filter by type if specified
      if (type && messages.length > 0) {
        messages = messages.filter(msg => msg.value && msg.value.type === type)
      }

      // Extract the actual message values
      return messages.map(msg => msg.value)
    } catch (err) {
      if (this._closing) return []
      if (this.debug) console.error('Error getting messages:', err)
      throw err
    }
  }

  /**
   * Add a member to the room
   * @param {object} member - Member data
   * @param {Buffer} member.publicKey - Member's public key
   * @param {string} [member.role='member'] - Member's role
   * @param {object} [member.metadata={}] - Member metadata
   * @returns {Promise<boolean>} - Success flag
   */
  async addMember(member) {
    if (this.opened === false) await this.ready()
    if (!this.base.writable) {
      throw new Error('Not writable')
    }

    try {
      if (!member.publicKey) {
        throw new Error('Member public key is required')
      }

      const publicKey = b4a.isBuffer(member.publicKey)
        ? member.publicKey
        : b4a.from(member.publicKey, 'hex')

      const id = b4a.toString(publicKey, 'hex')

      // Add the member to the room
      await this.base.append(dispatch('@room/add-member', {
        id,
        publicKey,
        role: member.role || 'member',
        joined: Date.now(),
        metadata: member.metadata || {}
      }))

      // Add as writer
      await this.addWriter(publicKey)

      return true
    } catch (err) {
      if (this._closing) return false
      if (this.debug) console.error('Error adding member:', err)
      throw err
    }
  }

  /**
   * Remove a member from the room
   * @param {string|Buffer} memberId - Member's ID or public key
   * @returns {Promise<boolean>} - Success flag
   */
  async removeMember(memberId) {
    if (this.opened === false) await this.ready()
    if (!this.base.writable) {
      throw new Error('Not writable')
    }

    try {
      let id = memberId
      let publicKey = null

      // Convert buffer to hex string if needed
      if (b4a.isBuffer(memberId)) {
        publicKey = memberId
        id = b4a.toString(memberId, 'hex')
      }

      // If we only have ID, get the member to find the public key
      if (!publicKey) {
        const member = await this.getMember(id)
        if (!member) return false
        publicKey = member.publicKey
      }

      // Remove the member
      await this.base.append(dispatch('@room/remove-member', {
        id,
        publicKey
      }))

      // Try to remove as writer if possible
      try {
        await this.removeWriter(publicKey)
      } catch (err) {
        if (this.debug) console.debug('Could not remove writer:', err.message)
        // Continue anyway - this is expected if the writer isn't removable
      }

      return true
    } catch (err) {
      if (this._closing) return false
      if (this.debug) console.error('Error removing member:', err)
      throw err
    }
  }

  /**
   * Get all members in the room
   * @returns {Promise<Array>} - Array of members
   */
  async getMembers() {
    if (this.opened === false) await this.ready()

    try {
      // Get members from the view
      const members = await this.view.find('@room/members', {})

      return members.map(member => member.value)
    } catch (err) {
      if (this._closing) return []
      if (this.debug) console.error('Error getting members:', err)
      throw err
    }
  }

  /**
   * Get a specific member by ID
   * @param {string} memberId - Member ID
   * @returns {Promise<object>} - Member data
   */
  async getMember(memberId) {
    if (this.opened === false) await this.ready()

    try {
      // Get member from the view
      const member = await this.view.get('@room/members', { id: memberId })

      return member ? member.value : null
    } catch (err) {
      if (this._closing) return null
      if (this.debug) console.error(`Error getting member ${memberId}:`, err)
      throw err
    }
  }

  /**
   * Share a file in the room
   * @param {object} file - File object
   * @param {Buffer} file.data - File data
   * @param {string} file.name - File name
   * @param {string} file.type - File MIME type
   * @param {Buffer} file.author - Author's public key
   * @param {Buffer} [file.authorPrivateKey] - Author's private key for signing
   * @param {object} [file.metadata={}] - File metadata
   * @returns {Promise<object>} - File metadata with blob ID
   */
  async shareFile(file) {
    if (this.opened === false) await this.ready()
    if (!this.base.writable) {
      throw new Error('Not writable')
    }

    try {
      if (!file.data || !file.name || !file.author) {
        throw new Error('File data, name, and author are required')
      }

      // Store the file in hyperblobs
      const blobId = await this.files.put(file.data)

      // Calculate file hash
      const hash = crypto.createHash('sha256').update(file.data).digest()

      // Create file metadata
      const fileInfo = {
        id: blobId.toString(),
        blobId,
        name: file.name,
        size: file.data.length,
        type: file.type || 'application/octet-stream',
        hash: hash.toString('hex'),
        author: file.author,
        timestamp: Date.now(),
        metadata: file.metadata || {}
      }

      // Sign the file if private key is provided
      if (file.authorPrivateKey) {
        // Create a signable representation
        const signable = Buffer.from(JSON.stringify({
          blobId: fileInfo.blobId,
          name: fileInfo.name,
          size: fileInfo.size,
          type: fileInfo.type,
          hash: fileInfo.hash,
          timestamp: fileInfo.timestamp
        }))

        // Sign with private key
        fileInfo.signature = crypto.createHmac('sha256', file.authorPrivateKey)
          .update(signable)
          .digest()
          .toString('hex')
      }

      // Add file info to the room
      await this.base.append(dispatch('@room/add-file', {
        id: fileInfo.id,
        value: fileInfo
      }))

      // Also add a message about the file
      await this.sendMessage({
        content: `File: ${file.name}`,
        type: 'file',
        author: file.author,
        authorPrivateKey: file.authorPrivateKey,
        metadata: {
          fileId: fileInfo.id,
          fileName: file.name,
          fileSize: file.data.length,
          fileType: file.type
        }
      })

      return fileInfo
    } catch (err) {
      if (this._closing) throw new Error('Room is closing')
      if (this.debug) console.error('Error sharing file:', err)
      throw err
    }
  }

  /**
   * Get a file from the room
   * @param {string} fileId - File ID
   * @returns {Promise<object>} - File data and metadata
   */
  async getFile(fileId) {
    if (this.opened === false) await this.ready()

    try {
      // Get file metadata
      const fileInfo = await this.view.get('@room/files', { id: fileId })

      if (!fileInfo) {
        throw new Error('File not found')
      }

      const metadata = fileInfo.value

      // Parse the blob ID
      const blobId = metadata.blobId

      // Retrieve file content
      const content = await this.files.get(blobId)

      // Verify file hash
      const hash = crypto.createHash('sha256').update(content).digest().toString('hex')

      if (hash !== metadata.hash) {
        throw new Error('File content verification failed')
      }

      return {
        content,
        metadata
      }
    } catch (err) {
      if (this._closing) throw new Error('Room is closing')
      if (this.debug) console.error(`Error getting file ${fileId}:`, err)
      throw err
    }
  }

  /**
   * List all files in the room
   * @param {object} [opts={}] - Query options
   * @param {number} [opts.limit=50] - Maximum number of files to return
   * @param {boolean} [opts.reverse=true] - Whether to return files in reverse order
   * @returns {Promise<Array>} - Array of file metadata
   */
  async getFiles(opts = {}) {
    if (this.opened === false) await this.ready()

    try {
      const { limit = 50, reverse = true } = opts

      // Get files from the view
      const files = await this.view.find('@room/files', {}, { limit, reverse })

      return files.map(file => file.value)
    } catch (err) {
      if (this._closing) return []
      if (this.debug) console.error('Error getting files:', err)
      throw err
    }
  }

  /**
   * Delete a file from the room
   * @param {string} fileId - File ID
   * @returns {Promise<boolean>} - Success flag
   */
  async deleteFile(fileId) {
    if (this.opened === false) await this.ready()
    if (!this.base.writable) {
      throw new Error('Not writable')
    }

    try {
      // Get file metadata first to ensure it exists
      const fileInfo = await this.view.get('@room/files', { id: fileId })

      if (!fileInfo) {
        return false
      }

      // Delete the file metadata
      await this.base.append(dispatch('@room/delete-file', {
        id: fileId
      }))

      // Try to clear the blob data
      try {
        await this.files.clear(fileInfo.value.blobId)
      } catch (err) {
        if (this.debug) console.warn('Could not clear blob data:', err)
        // Continue anyway - the metadata is removed
      }

      return true
    } catch (err) {
      if (this._closing) return false
      if (this.debug) console.error(`Error deleting file ${fileId}:`, err)
      throw err
    }
  }

  /**
   * Get room information
   * @returns {Promise<object>} - Room information
   */
  async getInfo() {
    if (this.opened === false) await this.ready()

    try {
      const info = await this.view.get('@room/info', { id: 'room-info' })

      return info ? info.value : {
        id: 'room-info',
        name: this.name,
        description: this.description,
        created: Date.now(),
        owner: this.owner,
        private: this.private
      }
    } catch (err) {
      if (this._closing) return null
      if (this.debug) console.error('Error getting room info:', err)
      throw err
    }
  }

  /**
   * Update room information
   * @param {object} info - New room information
   * @param {string} [info.name] - Room name
   * @param {string} [info.description] - Room description
   * @param {boolean} [info.private] - Room privacy setting
   * @param {object} [info.settings] - Room settings
   * @returns {Promise<object>} - Updated room information
   */
  async updateInfo(info) {
    if (this.opened === false) await this.ready()
    if (!this.base.writable) {
      throw new Error('Not writable')
    }

    try {
      // Get current info
      const currentInfo = await this.getInfo()

      // Merge with new info
      const updatedInfo = {
        ...currentInfo,
        name: info.name !== undefined ? info.name : currentInfo.name,
        description: info.description !== undefined ? info.description : currentInfo.description,
        private: info.private !== undefined ? info.private : currentInfo.private,
        settings: {
          ...(currentInfo.settings || {}),
          ...(info.settings || {})
        },
        updated: Date.now()
      }

      // Update the room info
      await this.base.append(dispatch('@room/update-info', updatedInfo))

      // Update local properties
      this.name = updatedInfo.name
      this.description = updatedInfo.description
      this.private = updatedInfo.private

      return updatedInfo
    } catch (err) {
      if (this._closing) throw new Error('Room is closing')
      if (this.debug) console.error('Error updating room info:', err)
      throw err
    }
  }

  /**
   * Check if the room manager is writable
   * @returns {boolean} - Whether the room manager is writable
   */
  get writable() {
    return this.base ? this.base.writable : false
  }

  /**
   * Get the local writer key
   * @returns {Buffer} - Writer key
   */
  get writerKey() {
    return this.base ? this.base.writerKey : null
  }

  /**
   * Get the room manager key
   * @returns {Buffer} - Room manager key
   */
  get key() {
    return this.base ? this.base.key : null
  }

  /**
   * Get the discovery key for networking
   * @returns {Buffer} - Discovery key
   */
  get discoveryKey() {
    return this.base ? this.base.discoveryKey : null
  }

  /**
   * Get the encryption key
   * @returns {Buffer} - Encryption key
   */
  get encryptionKey() {
    return this.base ? this.base.encryptionKey : null
  }

  /**
   * Static method to create a room from a pairing invite
   * @param {object} store - Corestore instance
   * @param {string} invite - Invite code
   * @param {object} [opts={}] - Pairing options
   * @returns {Promise<RoomManager>} - The paired room manager
   */
  static async join(store, invite, opts = {}) {
    const RoomPairer = require('./room-pairer')
    const pairer = new RoomPairer(store, invite, opts)

    try {
      const room = await pairer.finished()
      return room
    } catch (err) {
      await pairer.close().catch(err => {
        if (opts.debug) console.error('Error closing room pairer:', err)
      })
      throw err
    }
  }
}

module.exports = RoomManager
