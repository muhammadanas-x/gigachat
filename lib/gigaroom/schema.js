// gigaroom-schema.js - Schema definition for GigaRoom module

const Hyperschema = require('hyperschema')
const HyperdbBuilder = require('hyperdb/builder')
const Hyperdispatch = require('hyperdispatch')

// Create schema namespace
const gigaroom = Hyperschema.from('./spec/schema')
const template = gigaroom.namespace('gigaroom')

// ============== Base schemas for writer management ==============
template.register({
  name: 'writer',
  compact: false,
  fields: [{
    name: 'key',
    type: 'buffer',
    required: true
  }]
})

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
  }, {
    name: 'roomId',
    type: 'string',
    required: false
  }, {
    name: 'maxUses',
    type: 'int',
    required: false
  }, {
    name: 'useCount',
    type: 'int',
    required: false
  }, {
    name: 'isRevoked',
    type: 'bool',
    required: false
  }]
})

// ============== Message schema ==============
template.register({
  name: 'message',
  compact: false,
  fields: [{
    name: 'id',
    type: 'string',
    required: true
  }, {
    name: 'roomId',
    type: 'string',
    required: true
  }, {
    name: 'channelId',
    type: 'string',
    required: false
  }, {
    name: 'type',
    type: 'string',
    required: true
  }, {
    name: 'sender',
    type: 'buffer',
    required: true
  }, {
    name: 'senderName',
    type: 'string',
    required: false
  }, {
    name: 'content',
    type: 'string',
    required: true
  }, {
    name: 'timestamp',
    type: 'int',
    required: true
  }, {
    name: 'signature',
    type: 'buffer',
    required: true
  }, {
    name: 'status',
    type: 'string',
    required: false
  }, {
    name: 'edited',
    type: 'bool',
    required: false
  }, {
    name: 'editedAt',
    type: 'int',
    required: false
  }, {
    name: 'replyToId',
    type: 'string',
    required: false
  }, {
    name: 'threadRootId',
    type: 'string',
    required: false
  }, {
    name: 'forwardedFromId',
    type: 'string',
    required: false
  }, {
    name: 'deleted',
    type: 'bool',
    required: false
  }, {
    name: 'deletedBy',
    type: 'buffer',
    required: false
  }, {
    name: 'deletedAt',
    type: 'int',
    required: false
  }, {
    name: 'searchableText',
    type: 'string',
    required: false
  }]
})

// ============== Reaction schema ==============
template.register({
  name: 'reaction',
  compact: false,
  fields: [{
    name: 'id',
    type: 'string',
    required: true
  }, {
    name: 'messageId',
    type: 'string',
    required: true
  }, {
    name: 'emoji',
    type: 'string',
    required: true
  }, {
    name: 'user',
    type: 'buffer',
    required: true
  }, {
    name: 'timestamp',
    type: 'int',
    required: true
  }]
})

// ============== Room schema ==============
template.register({
  name: 'room',
  compact: false,
  fields: [{
    name: 'id',
    type: 'string',
    required: true
  }, {
    name: 'type',
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
    name: 'avatar',
    type: 'string',
    required: false
  }, {
    name: 'createdAt',
    type: 'int',
    required: true
  }, {
    name: 'createdBy',
    type: 'buffer',
    required: true
  }, {
    name: 'discoveryKey',
    type: 'buffer',
    required: true
  }, {
    name: 'coreKey',
    type: 'buffer',
    required: true
  }, {
    name: 'isPrivate',
    type: 'bool',
    required: false
  }, {
    name: 'isEncrypted',
    type: 'bool',
    required: false
  }, {
    name: 'encryptionInfo',
    type: 'string',
    required: false
  }, {
    name: 'settings',
    type: 'string',
    required: false
  }, {
    name: 'metadata',
    type: 'string',
    required: false
  }]
})

// ============== Member schema ==============
template.register({
  name: 'member',
  compact: false,
  fields: [{
    name: 'id',
    type: 'string',
    required: true
  }, {
    name: 'roomId',
    type: 'string',
    required: true
  }, {
    name: 'userKey',
    type: 'buffer',
    required: true
  }, {
    name: 'displayName',
    type: 'string',
    required: false
  }, {
    name: 'joinedAt',
    type: 'int',
    required: true
  }, {
    name: 'invitedBy',
    type: 'buffer',
    required: false
  }, {
    name: 'lastActivity',
    type: 'int',
    required: false
  }, {
    name: 'status',
    type: 'string',
    required: false
  }, {
    name: 'lastReadId',
    type: 'string',
    required: false
  }, {
    name: 'roles',
    type: 'string',
    required: false
  }]
})

// ============== Role schema ==============
template.register({
  name: 'role',
  compact: false,
  fields: [{
    name: 'id',
    type: 'string',
    required: true
  }, {
    name: 'roomId',
    type: 'string',
    required: true
  }, {
    name: 'name',
    type: 'string',
    required: true
  }, {
    name: 'color',
    type: 'string',
    required: false
  }, {
    name: 'position',
    type: 'int',
    required: true
  }, {
    name: 'permissions',
    type: 'string',
    required: true
  }, {
    name: 'createdAt',
    type: 'int',
    required: true
  }, {
    name: 'createdBy',
    type: 'buffer',
    required: true
  }, {
    name: 'isDefault',
    type: 'bool',
    required: false
  }]
})

// ============== Permission Override schema ==============
template.register({
  name: 'permissionOverride',
  compact: false,
  fields: [{
    name: 'id',
    type: 'string',
    required: true
  }, {
    name: 'roomId',
    type: 'string',
    required: true
  }, {
    name: 'targetType',
    type: 'string',
    required: true
  }, {
    name: 'targetId',
    type: 'string',
    required: true
  }, {
    name: 'channelId',
    type: 'string',
    required: false
  }, {
    name: 'allow',
    type: 'string',
    required: true
  }, {
    name: 'deny',
    type: 'string',
    required: true
  }, {
    name: 'setAt',
    type: 'int',
    required: true
  }, {
    name: 'setBy',
    type: 'buffer',
    required: true
  }]
})

// ============== Thread schema ==============
template.register({
  name: 'thread',
  compact: false,
  fields: [{
    name: 'id',
    type: 'string',
    required: true
  }, {
    name: 'roomId',
    type: 'string',
    required: true
  }, {
    name: 'channelId',
    type: 'string',
    required: false
  }, {
    name: 'name',
    type: 'string',
    required: false
  }, {
    name: 'createdAt',
    type: 'int',
    required: true
  }, {
    name: 'createdBy',
    type: 'buffer',
    required: true
  }, {
    name: 'lastActivity',
    type: 'int',
    required: false
  }, {
    name: 'messageCount',
    type: 'int',
    required: false
  }, {
    name: 'isArchived',
    type: 'bool',
    required: false
  }, {
    name: 'settings',
    type: 'string',
    required: false
  }]
})

// ============== Channel schema ==============
template.register({
  name: 'channel',
  compact: false,
  fields: [{
    name: 'id',
    type: 'string',
    required: true
  }, {
    name: 'roomId',
    type: 'string',
    required: true
  }, {
    name: 'type',
    type: 'string',
    required: true
  }, {
    name: 'name',
    type: 'string',
    required: true
  }, {
    name: 'topic',
    type: 'string',
    required: false
  }, {
    name: 'position',
    type: 'int',
    required: true
  }, {
    name: 'categoryId',
    type: 'string',
    required: false
  }, {
    name: 'createdAt',
    type: 'int',
    required: true
  }, {
    name: 'createdBy',
    type: 'string', // Change from buffer to string
    required: true
  }, {
    name: 'isDefault',
    type: 'bool',
    required: false
  }, {
    name: 'settings',
    type: 'string',
    required: false
  }]
})
// ============== Category schema ==============
template.register({
  name: 'category',
  compact: false,
  fields: [{
    name: 'id',
    type: 'string',
    required: true
  }, {
    name: 'roomId',
    type: 'string',
    required: true
  }, {
    name: 'name',
    type: 'string',
    required: true
  }, {
    name: 'position',
    type: 'int',
    required: true
  }, {
    name: 'createdAt',
    type: 'int',
    required: true
  }, {
    name: 'createdBy',
    type: 'buffer',
    required: true
  }]
})

// ============== File Reference schema ==============
template.register({
  name: 'file',
  compact: false,
  fields: [{
    name: 'id',
    type: 'string',
    required: true
  }, {
    name: 'roomId',
    type: 'string',
    required: true
  }, {
    name: 'messageId',
    type: 'string',
    required: true
  }, {
    name: 'name',
    type: 'string',
    required: true
  }, {
    name: 'size',
    type: 'int',
    required: true
  }, {
    name: 'type',
    type: 'string',
    required: true
  }, {
    name: 'hash',
    type: 'string',
    required: true
  }, {
    name: 'owner',
    type: 'buffer',
    required: true
  }, {
    name: 'uploadedAt',
    type: 'int',
    required: true
  }, {
    name: 'coreKey',
    type: 'buffer',
    required: true
  }, {
    name: 'blobInfo',
    type: 'string',
    required: true
  }, {
    name: 'isEncrypted',
    type: 'bool',
    required: false
  }, {
    name: 'metadata',
    type: 'string',
    required: false
  }]
})

// ============== Mention schema ==============
template.register({
  name: 'mention',
  compact: false,
  fields: [{
    name: 'id',
    type: 'string',
    required: true
  }, {
    name: 'messageId',
    type: 'string',
    required: true
  }, {
    name: 'userId',
    type: 'buffer',
    required: false
  }, {
    name: 'roleId',
    type: 'string',
    required: false
  }, {
    name: 'roomId',
    type: 'string',
    required: true
  }, {
    name: 'timestamp',
    type: 'int',
    required: true
  }]
})

// Write schemas to disk
Hyperschema.toDisk(gigaroom)

// Create database template
const dbTemplate = HyperdbBuilder.from('./spec/schema', './spec/db')
const collections = dbTemplate.namespace('gigaroom')

// Register collections for database with optimized keys
collections.collections.register({
  name: 'writer',
  schema: '@gigaroom/writer',
  key: ['key']
})

collections.collections.register({
  name: 'invite',
  schema: '@gigaroom/invite',
  key: ['id']
})

collections.collections.register({
  name: 'message',
  schema: '@gigaroom/message',
  key: ['id']
})

collections.collections.register({
  name: 'reaction',
  schema: '@gigaroom/reaction',
  key: ['id']
})

collections.collections.register({
  name: 'room',
  schema: '@gigaroom/room',
  key: ['id']
})

collections.collections.register({
  name: 'member',
  schema: '@gigaroom/member',
  key: ['id']
})

collections.collections.register({
  name: 'role',
  schema: '@gigaroom/role',
  key: ['id']
})

collections.collections.register({
  name: 'permissionOverride',
  schema: '@gigaroom/permissionOverride',
  key: ['id']
})

collections.collections.register({
  name: 'thread',
  schema: '@gigaroom/thread',
  key: ['id']
})

collections.collections.register({
  name: 'channel',
  schema: '@gigaroom/channel',
  key: ['id']
})

collections.collections.register({
  name: 'category',
  schema: '@gigaroom/category',
  key: ['id']
})

collections.collections.register({
  name: 'file',
  schema: '@gigaroom/file',
  key: ['id']
})

collections.collections.register({
  name: 'mention',
  schema: '@gigaroom/mention',
  key: ['id']
})

// Define indexes for common query patterns
// const indexes = collections.indexes
//
// // Message indexes
// indexes.register({
//   name: 'messagesByRoom',
//   collection: '@gigaroom/message',
//   unique: false,
//   key: ['roomId', 'timestamp']
// })
//
// indexes.register({
//   name: 'messagesByThread',
//   collection: '@gigaroom/message',
//   unique: false,
//   key: ['threadRootId', 'timestamp']
// })
//
// indexes.register({
//   name: 'messagesByChannel',
//   collection: '@gigaroom/message',
//   unique: false,
//   key: ['channelId', 'timestamp']
// })
//
// // Member indexes
// indexes.register({
//   name: 'membersByRoom',
//   collection: '@gigaroom/member',
//   unique: false,
//   key: ['roomId']
// })
//
// indexes.register({
//   name: 'membersByUser',
//   collection: '@gigaroom/member',
//   unique: false,
//   key: ['userKey']
// })
//
// // Role indexes
// indexes.register({
//   name: 'rolesByRoom',
//   collection: '@gigaroom/role',
//   unique: false,
//   key: ['roomId', 'position']
// })
//
// // Channel indexes
// indexes.register({
//   name: 'channelsByRoom',
//   collection: '@gigaroom/channel',
//   unique: false,
//   key: ['roomId', 'id']
// })
//
// indexes.register({
//   name: 'channelsByCategory',
//   collection: '@gigaroom/channel',
//   unique: false,
//   key: ['categoryId', 'position']
// })
//
// // File indexes
// indexes.register({
//   name: 'filesByRoom',
//   collection: '@gigaroom/file',
//   unique: false,
//   key: ['roomId', 'uploadedAt']
// })
//
// indexes.register({
//   name: 'filesByMessage',
//   collection: '@gigaroom/file',
//   unique: false,
//   key: ['messageId']
// })
//
// // Mention indexes
// indexes.register({
//   name: 'mentionsByUser',
//   collection: '@gigaroom/mention',
//   unique: false,
//   key: ['userId', 'timestamp']
// })
//
// indexes.register({
//   name: 'mentionsByRole',
//   collection: '@gigaroom/mention',
//   unique: false,
//   key: ['roleId', 'timestamp']
// })


HyperdbBuilder.toDisk(dbTemplate)

// Setup command dispatching
const hyperdispatch = Hyperdispatch.from('./spec/schema', './spec/hyperdispatch')
const namespace = hyperdispatch.namespace('gigaroom')

// Register command handlers
namespace.register({
  name: 'remove-writer',
  requestType: '@gigaroom/writer'
})

namespace.register({
  name: 'add-writer',
  requestType: '@gigaroom/writer'
})

namespace.register({
  name: 'add-invite',
  requestType: '@gigaroom/invite'
})

namespace.register({
  name: 'create-room',
  requestType: '@gigaroom/room'
})

namespace.register({
  name: 'update-room',
  requestType: '@gigaroom/room'
})

namespace.register({
  name: 'add-member',
  requestType: '@gigaroom/member'
})

namespace.register({
  name: 'update-member',
  requestType: '@gigaroom/member'
})

namespace.register({
  name: 'remove-member',
  requestType: '@gigaroom/member'
})

namespace.register({
  name: 'create-role',
  requestType: '@gigaroom/role'
})

namespace.register({
  name: 'update-role',
  requestType: '@gigaroom/role'
})

namespace.register({
  name: 'delete-role',
  requestType: '@gigaroom/role'
})

namespace.register({
  name: 'set-permission-override',
  requestType: '@gigaroom/permissionOverride'
})

namespace.register({
  name: 'create-channel',
  requestType: '@gigaroom/channel'
})

namespace.register({
  name: 'update-channel',
  requestType: '@gigaroom/channel'
})

namespace.register({
  name: 'delete-channel',
  requestType: '@gigaroom/channel'
})

namespace.register({
  name: 'create-category',
  requestType: '@gigaroom/category'
})

namespace.register({
  name: 'update-category',
  requestType: '@gigaroom/category'
})

namespace.register({
  name: 'delete-category',
  requestType: '@gigaroom/category'
})

namespace.register({
  name: 'create-thread',
  requestType: '@gigaroom/thread'
})

namespace.register({
  name: 'update-thread',
  requestType: '@gigaroom/thread'
})

namespace.register({
  name: 'add-message',
  requestType: '@gigaroom/message'
})

namespace.register({
  name: 'edit-message',
  requestType: '@gigaroom/message'
})

namespace.register({
  name: 'delete-message',
  requestType: '@gigaroom/message'
})

namespace.register({
  name: 'add-reaction',
  requestType: '@gigaroom/reaction'
})

namespace.register({
  name: 'remove-reaction',
  requestType: '@gigaroom/reaction'
})

namespace.register({
  name: 'add-file',
  requestType: '@gigaroom/file'
})

namespace.register({
  name: 'add-mention',
  requestType: '@gigaroom/mention'
})

// Write dispatch configuration to disk
Hyperdispatch.toDisk(hyperdispatch)

module.exports = { gigaroom, dbTemplate, hyperdispatch }
