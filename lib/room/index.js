/**
 * Room Management Module for Gigachat
 * 
 * This module provides room management, messaging, and file sharing
 * capabilities for Gigachat.
 * 
 * @module room
 */

const RoomManager = require('./room-manager')
const RoomPairer = require('./room-pairer')

/**
 * Create a new room
 * 
 * @param {object} store - Corestore instance
 * @param {object} [opts={}] - Configuration options
 * @param {string} [opts.name] - Room name
 * @param {string} [opts.description] - Room description
 * @param {Buffer} [opts.owner] - Owner's public key
 * @param {boolean} [opts.private=true] - Whether the room is private
 * @returns {Promise<RoomManager>} - A new room manager instance
 */
async function createRoom(store, opts = {}) {
  const room = new RoomManager(store, opts)
  await room.ready()
  return room
}

/**
 * Load an existing room by key
 * 
 * @param {object} store - Corestore instance
 * @param {Buffer} key - Room key
 * @param {object} [opts={}] - Configuration options
 * @returns {Promise<RoomManager>} - A loaded room manager instance
 */
async function loadRoom(store, key, opts = {}) {
  const options = {
    ...opts,
    key
  }

  const room = new RoomManager(store, options)
  await room.ready()
  return room
}

/**
 * Join a room with an invite code
 * 
 * @param {object} store - Corestore instance
 * @param {string} invite - Room invite code
 * @param {object} [opts={}] - Configuration options
 * @returns {Promise<RoomManager>} - A joined room manager instance
 */
async function joinRoom(store, invite, opts = {}) {
  return RoomManager.join(store, invite, opts)
}

module.exports = {
  RoomManager,
  RoomPairer,
  createRoom,
  loadRoom,
  joinRoom
}
