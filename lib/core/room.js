/**
 * Room management class for Gigachat
 * @class
 * @extends ReadyResource
 */

const ReadyResource = require('ready-resource');
const Autobase = require('autobase');
const HyperDB = require('hyperdb');
const Hyperblobs = require('hyperblobs');
const crypto = require('crypto');
const b4a = require('b4a');

class GigachatRoom extends ReadyResource {
  /**
   * Create or join a Gigachat room
   * @param {GigachatUser} user - User instance
   * @param {string} [roomId] - Room ID for existing rooms
   * @param {object} [opts={}] - Room options
   */
  constructor(user, roomId, opts = {}) {
    super();
    this.user = user;
    this.id = roomId;
    this.name = opts.name || 'Unnamed Room';
    this.description = opts.description || '';
    this.invite = opts.invite || null;
    this.store = user.store;
    this.base = null;
    this.view = null;
    this.files = null;
    this.lastAccessed = Date.now();
    this.members = new Map();

    // Initialize resource
    this.ready().catch(err => console.error('Failed to initialize GigachatRoom:', err));
  }

  /**
   * Initialize the room
   * @private
   */
  async _open() {
    // If we have an invite, join an existing room
    if (this.invite) {
      await this._joinWithInvite();
    }
    // Otherwise create a new room
    else {
      await this._createNew();
    }

    // Set up file storage
    this.files = new Hyperblobs(this.store.get('files'));
  }

  /**
   * Create a new room
   * @private
   */
  async _createNew() {
    // Set up Autobase for the room
    this.base = new Autobase(this.store, null, {
      valueEncoding: 'json',
      apply: this._applyMessages.bind(this),
      open: store => {
        return HyperDB.bee(store.get('room-db'), {
          keyEncoding: 'utf-8',
          valueEncoding: 'json'
        });
      }
    });

    await this.base.ready();
    this.view = this.base.view;

    // Generate a unique ID for the room
    this.id = b4a.toString(this.base.key, 'hex');

    // Add the creator as the first member and writer
    const initialMember = {
      publicKey: this.user.getPublicKey(),
      role: 'owner',
      joined: Date.now()
    };

    // Initialize the room data
    await this.base.append({
      type: 'room-create',
      name: this.name,
      description: this.description,
      created: Date.now(),
      owner: this.user.getPublicKey(),
      settings: {
        private: true
      }
    });

    // Add the creator as a member
    await this.base.append({
      type: 'member',
      action: 'add',
      publicKey: this.user.getPublicKey(),
      role: 'owner',
      joined: Date.now()
    });

    // Join the swarm to allow connections
    this.user.swarm.join(this.base.discoveryKey);
  }

  /**
   * Join an existing room with an invite
   * @private
   */
  async _joinWithInvite() {
    // This would implement blind-pairing to join an existing room
    // Similar to how Autopass handles pairing

    // This is a placeholder for the actual implementation
    // Would use the invite to get the room key and join it

    throw new Error('Room joining with invite not implemented yet');
  }

  /**
   * Apply messages from all writers to the view
   * @private
   * @param {Array} nodes - Message nodes from Autobase
   * @param {object} view - HyperDB view
   * @param {object} host - Autobase host
   */
  async _applyMessages(nodes, view, host) {
    for (const node of nodes) {
      const value = node.value;

      // Skip if no value (e.g., null message)
      if (!value) continue;

      // Message verification would happen here
      // Skip invalid messages

      switch (value.type) {
        case 'chat':
          await view.insert('messages', {
            key: value.id || crypto.randomBytes(16).toString('hex'),
            value
          });
          break;

        case 'file':
          await view.insert('files', {
            key: value.blobId.toString(),
            value
          });
          break;

        case 'member':
          if (value.action === 'add') {
            await host.addWriter(value.publicKey);
            await view.insert('members', {
              key: b4a.toString(value.publicKey, 'hex'),
              value
            });
          } else if (value.action === 'remove') {
            if (host.removeable(value.publicKey)) {
              await host.removeWriter(value.publicKey);
              await view.delete('members', {
                key: b4a.toString(value.publicKey, 'hex')
              });
            }
          }
          break;

        case 'room-create':
        case 'room-update':
          await view.insert('room-info', {
            key: 'info',
            value
          });
          break;
      }
    }
  }

  /**
   * Close the room and release resources
   * @private
   */
  async _close() {
    if (this.base) {
      await this.base.close();
    }
  }

  /**
   * Send a message to the room
   * @param {string} content - Message content
   * @param {string} [type='chat'] - Message type
   * @returns {Promise<object>} - The sent message
   */
  async sendMessage(content, type = 'chat') {
    const message = {
      id: crypto.randomBytes(16).toString('hex'),
      type,
      content,
      author: this.user.getPublicKey(),
      timestamp: Date.now(),
      // In a real implementation, this would be signed
      // signature: signMessage(...)
    };

    await this.base.append(message);
    this.lastAccessed = Date.now();

    return message;
  }

  /**
   * Get messages from the room
   * @param {object} [options={}] - Query options
   * @returns {Promise<Array>} - Array of messages
   */
  async getMessages(options = {}) {
    const { limit = 50, reverse = true } = options;

    // Query messages from the view
    const messages = await this.view.find('messages', {}, { limit, reverse });

    this.lastAccessed = Date.now();
    return messages.map(msg => msg.value);
  }

  /**
   * Share a file in the room
   * @param {object} file - File object with data, name, type
   * @returns {Promise<object>} - File metadata
   */
  async shareFile(file) {
    // Store the file in hyperblobs
    const blobId = await this.files.put(file.data);

    // Create file metadata
    const fileInfo = {
      blobId,
      name: file.name,
      size: file.data.length,
      type: file.type,
      hash: crypto.createHash('sha256').update(file.data).digest(),
      owner: this.user.getPublicKey(),
      timestamp: Date.now(),
      // In a real implementation, this would be signed
      // signature: signFile(...)
    };

    // Send file info as a message
    await this.sendMessage(fileInfo, 'file');

    return fileInfo;
  }

  /**
   * Retrieve a shared file
   * @param {string} blobId - Blob identifier
   * @returns {Promise<object>} - File data and metadata
   */
  async getFile(blobId) {
    // Get file metadata
    const fileInfo = await this.view.get('files', { key: blobId.toString() });

    if (!fileInfo) {
      throw new Error('File not found');
    }

    // Retrieve file content
    const content = await this.files.get(blobId);

    return {
      content,
      metadata: fileInfo.value
    };
  }

  /**
   * Create an invite to join this room
   * @param {object} [permissions={}] - Permissions for the invite
   * @returns {Promise<string>} - Invite code
   */
  async createInvite(permissions = {}) {
    // Would implement blind-pairing to create an invite
    // Similar to Autopass's invite creation

    // This is a placeholder for the actual implementation
    return this.base.createInvite();
  }

  /**
   * Add a new member to the room
   * @param {Buffer} userPublicKey - User's public key
   * @param {string} [role='member'] - Member role
   * @returns {Promise<boolean>} - Success indicator
   */
  async addMember(userPublicKey, role = 'member') {
    await this.base.append({
      type: 'member',
      action: 'add',
      publicKey: userPublicKey,
      role,
      joined: Date.now()
    });

    return true;
  }

  /**
   * Remove a member from the room
   * @param {Buffer} userPublicKey - User's public key
   * @returns {Promise<boolean>} - Success indicator
   */
  async removeMember(userPublicKey) {
    if (!this.base.removeable(userPublicKey)) {
      return false;
    }

    await this.base.append({
      type: 'member',
      action: 'remove',
      publicKey: userPublicKey,
      timestamp: Date.now()
    });

    return true;
  }

  /**
   * List all members in the room
   * @returns {Promise<Array>} - Array of member information
   */
  async listMembers() {
    const members = await this.view.find('members', {});
    return members.map(member => member.value);
  }

  /**
   * Update room settings
   * @param {object} settings - New settings
   * @returns {Promise<object>} - Updated settings
   */
  async updateSettings(settings) {
    await this.base.append({
      type: 'room-update',
      settings,
      timestamp: Date.now()
    });

    return settings;
  }

  /**
   * Get current room settings
   * @returns {Promise<object>} - Room settings
   */
  async getSettings() {
    const info = await this.view.get('room-info', { key: 'info' });
    return info && info.value.settings;
  }
}

module.exports = GigachatRoom;
