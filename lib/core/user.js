/**
 * User management class for Gigachat
 * @class
 * @extends ReadyResource
 */

const ReadyResource = require('ready-resource');
const Corestore = require('corestore');
const Hyperswarm = require('hyperswarm');
const BlindPairing = require('blind-pairing');
const b4a = require('b4a');
const z32 = require('z32');
const GigachatRoom = require('./room');

class GigachatUser extends ReadyResource {
  /**
   * Create a new Gigachat user
   * @param {object} store - Corestore instance
   * @param {string|Buffer} [seed] - Optional seed for key generation
   * @param {object} [opts={}] - Configuration options
   */
  constructor(store, seed, opts = {}) {
    super();
    this.store = store;
    this.seed = seed;
    this.swarm = null;
    this.keyPair = null;
    this.rooms = new Map();
    this.bootstrap = opts.bootstrap || null;
    this.profile = {
      name: opts.name || 'Anonymous',
      avatar: null,
      status: 'online',
      metadata: {}
    };

    // Initialize resource
    this.ready().catch(err => console.error('Failed to initialize GigachatUser:', err));
  }

  /**
   * Initialize the user
   * @private
   */
  async _open() {
    await this.store.ready();

    // Initialize networking
    this.swarm = new Hyperswarm({
      keyPair: await this.store.createKeyPair('hyperswarm'),
      bootstrap: this.bootstrap
    });

    // Set up replication
    this.swarm.on('connection', (connection, peerInfo) => {
      this.store.replicate(connection);
    });

    // Initialize identity
    if (this.seed) {
      await this.createIdentity(this.seed);
    }
  }

  /**
   * Close the user instance and release resources
   * @private
   */
  async _close() {
    for (const [roomId, room] of this.rooms) {
      await room.close();
    }

    if (this.swarm) {
      await this.swarm.destroy();
    }

    await this.store.close();
  }

  /**
   * Create a user identity from seed
   * @param {string|Buffer} seed - Seed for deterministic key generation
   * @returns {Promise<Buffer>} - The user's public key
   */
  async createIdentity(seed) {
    // Implementation for creating identity from seed
    // This would generate deterministic keys from the seed
    // Similar to how Autopass handles identity

    // For now, we'll just use the seed to create a keypair
    this.keyPair = await this.store.createKeyPair('identity', {
      seed: typeof seed === 'string' ? b4a.from(seed) : seed
    });

    return this.keyPair.publicKey;
  }

  /**
   * Get the user's public key
   * @returns {Buffer} - The user's public key
   */
  getPublicKey() {
    return this.keyPair ? this.keyPair.publicKey : null;
  }

  /**
   * Create a new chat room
   * @param {string} name - Room name
   * @param {object} [options={}] - Room configuration options
   * @returns {Promise<GigachatRoom>} - The created room
   */
  async createRoom(name, options = {}) {
    if (!this.keyPair) {
      throw new Error('User identity must be created before creating rooms');
    }

    // Implementation for creating a new room
    // This would set up an Autobase instance and configure it

    // For now, just create a basic room
    const room = new GigachatRoom(this, null, {
      name,
      ...options
    });

    await room.ready();
    this.rooms.set(room.id, room);

    return room;
  }

  /**
   * Join an existing room using an invite code
   * @param {string} invite - Room invite code
   * @returns {Promise<GigachatRoom>} - The joined room
   */
  async joinRoom(invite) {
    if (!this.keyPair) {
      throw new Error('User identity must be created before joining rooms');
    }

    // Implementation for joining a room using blind-pairing
    // Similar to how Autopass handles pairing

    // This is a placeholder for the actual implementation
    const room = new GigachatRoom(this, null, {
      invite
    });

    await room.ready();
    this.rooms.set(room.id, room);

    return room;
  }

  /**
   * Leave a chat room
   * @param {string} roomId - Room identifier
   * @returns {Promise<boolean>} - Success indicator
   */
  async leaveRoom(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return false;
    }

    await room.close();
    this.rooms.delete(roomId);

    return true;
  }

  /**
   * List all rooms the user is a member of
   * @returns {Array<object>} - Array of room information
   */
  listRooms() {
    const roomList = [];

    for (const [roomId, room] of this.rooms) {
      roomList.push({
        id: roomId,
        name: room.name,
        lastAccessed: room.lastAccessed
      });
    }

    return roomList;
  }

  /**
   * Update user profile information
   * @param {object} profile - Profile data to update
   * @returns {Promise<object>} - Updated profile
   */
  async updateProfile(profile) {
    this.profile = {
      ...this.profile,
      ...profile,
      metadata: {
        ...this.profile.metadata,
        ...(profile.metadata || {})
      }
    };

    // Would actually persist this to storage in a real implementation

    return this.profile;
  }

  /**
   * Get the current user's profile
   * @returns {object} - User profile
   */
  getProfile() {
    return this.profile;
  }

  /**
   * Create an invite for pairing a new device
   * @returns {Promise<string>} - Device pairing invite code
   */
  async createPairingInvite() {
    // Would implement device pairing logic using blind-pairing
    // Similar to Autopass's pairing code

    // This is a placeholder for the actual implementation
    const { id, invite } = BlindPairing.createInvite(this.getPublicKey());
    return z32.encode(invite);
  }

  /**
   * Pair this device using an invite from another device
   * @param {string} invite - Device pairing invite code
   * @returns {Promise<boolean>} - Success indicator
   */
  async pairDevice(invite) {
    // Would implement device pairing logic using blind-pairing
    // Similar to Autopass's pairing code

    // This is a placeholder for the actual implementation
    return true;
  }
}

module.exports = GigachatUser;
