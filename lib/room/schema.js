/**
 * Schema definition for the RoomManager module
 */
const Hyperschema = require('hyperschema')
const HyperdbBuilder = require('hyperdb/builder')
const Hyperdispatch = require('hyperdispatch')

// Create schema with namespace
const roomManager = Hyperschema.from('./spec/schema')
const template = roomManager.namespace('room')

// Register schema for room information
template.register({
  name: 'info',
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
    name: 'description',
    type: 'string',
    required: false
  }, {
    name: 'created',
    type: 'int',
    required: true
  }, {
    name: 'updated',
    type: 'int',
    required: false
  }, {
    name: 'owner',
    type: 'buffer',
    required: false
  }, {
    name: 'private',
    type: 'bool',
    required: false
  }, {
    name: 'settings',
    type: 'string',
    required: false
  }]
})

// Schema for message data
template.register({
  name: 'messages',
  compact: false,
  fields: [{
    name: 'id',
    type: 'string',
    required: true
  }, {
    name: 'value',
    type: 'string',
    required: true
  }]
})

// Schema for file metadata
template.register({
  name: 'files',
  compact: false,
  fields: [{
    name: 'id',
    type: 'string',
    required: true
  }, {
    name: 'value',
    type: 'string',
    required: true
  }]
})

// Schema for room members
template.register({
  name: 'members',
  compact: false,
  fields: [{
    name: 'id',
    type: 'string',
    required: true
  }, {
    name: 'publicKey',
    type: 'buffer',
    required: true
  }, {
    name: 'role',
    type: 'string',
    required: true
  }, {
    name: 'joined',
    type: 'int',
    required: true
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

// Write schema to disk
Hyperschema.toDisk(roomManager)

// Set up the database builder
const dbTemplate = HyperdbBuilder.from('./spec/schema', './spec/db')
const collections = dbTemplate.namespace('room')

// Register collections for the database
collections.collections.register({
  name: 'info',
  schema: '@room/info',
  key: ['id']
})

collections.collections.register({
  name: 'messages',
  schema: '@room/messages',
  key: ['id']
})

collections.collections.register({
  name: 'files',
  schema: '@room/files',
  key: ['id']
})

collections.collections.register({
  name: 'members',
  schema: '@room/members',
  key: ['id']
})

collections.collections.register({
  name: 'invite',
  schema: '@room/invite',
  key: ['id']
})

collections.collections.register({
  name: 'writer',
  schema: '@room/writer',
  key: ['key']
})

// Write database configuration to disk
HyperdbBuilder.toDisk(dbTemplate)

// Set up the command dispatcher
const hyperdispatch = Hyperdispatch.from('./spec/schema', './spec/hyperdispatch')
const namespace = hyperdispatch.namespace('room')

// Register command handlers
namespace.register({
  name: 'update-info',
  requestType: '@room/info'
})

namespace.register({
  name: 'add-message',
  requestType: '@room/messages'
})

namespace.register({
  name: 'edit-message',
  requestType: '@room/messages'
})

namespace.register({
  name: 'delete-message',
  requestType: '@room/messages'
})

namespace.register({
  name: 'add-file',
  requestType: '@room/files'
})

namespace.register({
  name: 'delete-file',
  requestType: '@room/files'
})

namespace.register({
  name: 'add-member',
  requestType: '@room/members'
})

namespace.register({
  name: 'remove-member',
  requestType: '@room/members'
})

namespace.register({
  name: 'add-invite',
  requestType: '@room/invite'
})

namespace.register({
  name: 'add-writer',
  requestType: '@room/writer'
})

namespace.register({
  name: 'remove-writer',
  requestType: '@room/writer'
})

// Write dispatch configuration to disk
Hyperdispatch.toDisk(hyperdispatch)

module.exports = {
  roomManager,
  dbTemplate,
  hyperdispatch
}
