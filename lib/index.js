/**
 * Gigachat - A peer-to-peer decentralized chat library
 * 
 * Gigachat provides secure peer-to-peer messaging and file sharing
 * capabilities built on the Hypercore Protocol.
 * 
 * @module gigachat
 */

const user = require('./user')
const room = require('./room')

/**
 * Create a new Gigachat instance
 * 
 * @param {object} store - Corestore instance
 * @param {object} [opts={}] - Configuration options
 * @returns {object} - Gigachat API
 */
function Gigachat(store, opts = {}) {
  if (!store) {
    throw new Error('Corestore is required')
  }

  return {
    // User management
    user: {
      create: (seed, options = {}) => user.createUser(store, seed, { ...opts, ...options }),
      restore: (key, options = {}) => user.restoreUser(store, key, { ...opts, ...options }),
      pair: (invite, options = {}) => user.pairDevice(store, invite, { ...opts, ...options })
    },

    // Room management
    room: {
      create: (options = {}) => room.createRoom(store, { ...opts, ...options }),
      load: (key, options = {}) => room.loadRoom(store, key, { ...opts, ...options }),
      join: (invite, options = {}) => room.joinRoom(store, invite, { ...opts, ...options })
    }
  }
}

// Export individual components for advanced usage
Gigachat.user = user
Gigachat.room = room

module.exports = Gigachat
