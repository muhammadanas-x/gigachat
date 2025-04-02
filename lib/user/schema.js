/**
 * Schema definition for the UserManager module
 */
const Hyperschema = require('hyperschema')
const HyperdbBuilder = require('hyperdb/builder')
const Hyperdispatch = require('hyperdispatch')

// Create schema with namespace
const userManager = Hyperschema.from('./spec/schema')
const template = userManager.namespace('usermanager')

// Register schema for user profile data
template.register({
  name: 'profile',
  compact: false,
  fields: [{
    name: 'id',
    type: 'string',
    required: true
  }, {
    name: 'name',
    type: 'string',
    required: true
  }, {
    name: 'status',
    type: 'string',
    required: false
  }, {
    name: 'avatar',
    type: 'string', // Can be a blob ID or a URI
    required: false
  }, {
    name: 'metadata',
    type: 'string',
    required: false
  }]
})

// Schema for rooms the user has joined
template.register({
  name: 'room',
  compact: false,
  fields: [{
    name: 'id',
    type: 'string',
    required: true
  }, {
    name: 'name',
    type: 'string',
    required: true
  }, {
    name: 'key',
    type: 'buffer',
    required: true
  }, {
    name: 'encryptionKey',
    type: 'buffer',
    required: false
  }, {
    name: 'lastAccessed',
    type: 'int',
    required: false
  }, {
    name: 'favorite',
    type: 'bool',
    required: false
  }, {
    name: 'metadata',
    type: 'string',
    required: false
  }]
})

// Schema for paired devices
template.register({
  name: 'device',
  compact: false,
  fields: [{
    name: 'id',
    type: 'string',
    required: true
  }, {
    name: 'name',
    type: 'string',
    required: true
  }, {
    name: 'publicKey',
    type: 'buffer',
    required: true
  }, {
    name: 'lastSeen',
    type: 'int',
    required: false
  }, {
    name: 'metadata',
    type: 'string',
    required: false
  }]
})

// Schema for pairing invites
template.register({
  name: 'invite',
  compact: false,
  fields: [{
    name: 'id',
    type: 'buffer',
    required: true
  }, {
    name: 'invite',
    type: 'buffer',
    required: true
  }, {
    name: 'publicKey',
    type: 'buffer',
    required: true
  }, {
    name: 'expires',
    type: 'int',
    required: true
  }]
})

// Schema for writer management
template.register({
  name: 'writer',
  compact: false,
  fields: [{
    name: 'key',
    type: 'buffer',
    required: true
  }]
})

// Schema for user settings
template.register({
  name: 'settings',
  compact: false,
  fields: [{
    name: 'id',
    type: 'string',
    required: true
  }, {
    name: 'theme',
    type: 'string',
    required: false
  }, {
    name: 'notifications',
    type: 'bool',
    required: false
  }, {
    name: 'language',
    type: 'string',
    required: false
  }, {
    name: 'preferences',
    type: 'string',
    required: false
  }]
})

// Write schema to disk
Hyperschema.toDisk(userManager)

// Set up the database builder
const dbTemplate = HyperdbBuilder.from('./spec/schema', './spec/db')
const collections = dbTemplate.namespace('usermanager')

// Register collections for the database
collections.collections.register({
  name: 'profile',
  schema: '@usermanager/profile',
  key: ['id']
})

collections.collections.register({
  name: 'rooms',
  schema: '@usermanager/room',
  key: ['id']
})

collections.collections.register({
  name: 'devices',
  schema: '@usermanager/device',
  key: ['id']
})

collections.collections.register({
  name: 'invite',
  schema: '@usermanager/invite',
  key: ['id']
})

collections.collections.register({
  name: 'writer',
  schema: '@usermanager/writer',
  key: ['key']
})

collections.collections.register({
  name: 'settings',
  schema: '@usermanager/settings',
  key: ['id']
})

// Write database configuration to disk
HyperdbBuilder.toDisk(dbTemplate)

// Set up the command dispatcher
const hyperdispatch = Hyperdispatch.from('./spec/schema', './spec/hyperdispatch')
const namespace = hyperdispatch.namespace('usermanager')

// Register command handlers
namespace.register({
  name: 'add-profile',
  requestType: '@usermanager/profile'
})

namespace.register({
  name: 'add-room',
  requestType: '@usermanager/room'
})

namespace.register({
  name: 'remove-room',
  requestType: '@usermanager/room'
})

namespace.register({
  name: 'add-device',
  requestType: '@usermanager/device'
})

namespace.register({
  name: 'remove-device',
  requestType: '@usermanager/device'
})

namespace.register({
  name: 'add-invite',
  requestType: '@usermanager/invite'
})

namespace.register({
  name: 'add-writer',
  requestType: '@usermanager/writer'
})

namespace.register({
  name: 'remove-writer',
  requestType: '@usermanager/writer'
})

namespace.register({
  name: 'update-settings',
  requestType: '@usermanager/settings'
})

// Write dispatch configuration to disk
Hyperdispatch.toDisk(hyperdispatch)

module.exports = {
  userManager,
  dbTemplate,
  hyperdispatch
}
