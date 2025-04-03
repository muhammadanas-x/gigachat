// test/gigaroom-basic.test.js - Basic GigaRoom Creation and Joining Test
const Corestore = require('corestore')
const Gigauser = require('../lib/gigauser/Gigauser.js')
const fs = require('fs')
const path = require('path')
const { rimraf } = require('rimraf')

// Test directories
const TEST_BASE_DIR = path.join('./test-gigaroom/')
const TEST_DIR_1 = path.join(TEST_BASE_DIR, 'user-creator')
const TEST_DIR_2 = path.join(TEST_BASE_DIR, 'user-joiner')

// Test seed phrases (unique for each test)
const TEST_SEED_1 = 'river blue mountain green forest tall river blue mountain green forest tall'
const TEST_SEED_2 = 'mountain green forest tall river blue mountain green forest tall river'

// Room test data
const TEST_ROOM = {
  name: 'Test GigaRoom',
  description: 'A room for testing basic functionality',
  type: 'community'
}
const TEST_ROOM2 = {
  name: '222 Test GigaRoom',
  description: 'A room for testing basic functionality',
  type: 'community'
}
// Utility delay function
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Test runner
async function runTests() {
  console.log('🔍 Starting GigaRoom Basic Tests...')
  console.log('-----------------------------')

  // Clean up any existing test directories
  await cleanup()

  try {
    // Run the tests
    await testRoomCreationAndJoining()

    console.log('-----------------------------')
    console.log('✅ All GigaRoom basic tests completed successfully!')
  } catch (error) {
    console.error('❌ Test failed:', error)
    console.error('Error stack:', error.stack)
    process.exit(1)
  } finally {
    // Clean up test directories
    await cleanup()
  }
}

// Core test function
async function testRoomCreationAndJoining() {
  console.log('\n📋 Test: Room Creation and Joining')

  // Create corestores for two users
  const store1 = new Corestore(TEST_DIR_1)
  const store2 = new Corestore(TEST_DIR_2)

  await store1.ready()
  await store2.ready()

  // Create first user (room creator)
  console.log('  - Creating first user...')
  const creatorUser = await Gigauser.create(store1, TEST_SEED_1)
  await creatorUser.ready()
  console.log(`  - Creator user created: ${creatorUser.publicKey.toString('hex').substring(0, 8)}...`)

  // Create first user's profile
  await creatorUser.updateProfile({
    name: 'Room Creator',
    status: 'Creating Test Room'
  })

  // Create room
  console.log('  - Creating test room...')
  const createdRoom = await creatorUser.createRoom(TEST_ROOM)
  console.log(`  - Room created with ID: ${createdRoom.id}`)

  // Create pairing invite
  console.log('  - Generating room invite...')
  const roomInvite = await createdRoom.createInvite()
  console.log(`  - Room invite generated: ${roomInvite.substring(0, 10)}...`)

  // Create second user (room joiner)
  console.log('  - Creating second user...')
  const joinerUser = await Gigauser.create(store2, TEST_SEED_2)
  await joinerUser.ready()
  console.log(`  - Joiner user created: ${joinerUser.publicKey.toString('hex').substring(0, 8)}...`)

  // Update joiner's profile
  await joinerUser.updateProfile({
    name: 'Room Joiner',
    status: 'Joining Test Room'
  })

  // Wait a bit for network propagation
  console.log('  - Waiting for network propagation...')
  await delay(2000)

  // Join the room
  console.log('  - Joining the room...')
  const joinedRoom = await joinerUser.joinRoom(roomInvite)
  console.log(`  - Joined room successfully: ${joinedRoom.id}`)

  // Verify room details
  console.log('  - Verifying room details...')
  if (joinedRoom.name !== TEST_ROOM.name) {
    throw new Error('Room name does not match')
  }

  console.log({ creatorRooms: creatorUser.rooms, joinerRooms: joinerUser.rooms })

  // Verify members
  console.log('  - Checking room members...')
  await delay(1000) // Give time for member sync
  console.log('  - Room members:', joinedRoom.members)

  // Verify the creator and joiner are in the room
  const creatorMember = joinedRoom.members.find(m =>
    Buffer.isBuffer(m.userKey)
      ? m.userKey.equals(creatorUser.publicKey)
      : m.userKey === creatorUser.publicKey.toString('hex')
  )
  const joinerMember = joinedRoom.members.find(m =>
    Buffer.isBuffer(m.userKey)
      ? m.userKey.equals(joinerUser.publicKey)
      : m.userKey === joinerUser.publicKey.toString('hex')
  )

  if (!creatorMember) {
    throw new Error('Creator not found in room members')
  }
  if (!joinerMember) {
    throw new Error('Joiner not found in room members')
  }

  // Verify rooms in user lists
  console.log('  - Checking user room lists...')
  const creatorRooms = creatorUser.rooms
  const joinerRooms = joinerUser.rooms
  const creatorRoomEntry = creatorRooms.find(r => r.id === createdRoom.id)
  const joinerRoomEntry = joinerRooms.find(r => r.id === createdRoom.id)

  if (!creatorRoomEntry) {
    throw new Error('Room not found in creator\'s room list')
  }
  if (!joinerRoomEntry) {
    throw new Error('Room not found in joiner\'s room list')
  }

  // Close users and stores
  console.log('  - Closing initial user instances...')
  await creatorUser.close()
  await joinerUser.close()
  await store1.close()
  await store2.close()

  // Reinitialize and verify synchronization
  console.log('\n📋 Test: Reinitialization and Synchronization')

  // Recreate corestores
  const reInitStore1 = new Corestore(TEST_DIR_1)
  const reInitStore2 = new Corestore(TEST_DIR_2)

  await reInitStore1.ready()
  await reInitStore2.ready()

  // Recreate users with same seeds
  console.log('  - Reinitializing first user...')
  const reInitCreatorUser = new Gigauser(reInitStore1)
  await reInitCreatorUser.ready()

  console.log('  - Reinitializing second user...')
  const reInitJoinerUser = new Gigauser(reInitStore2)
  await reInitJoinerUser.ready()


  await delay(2000)

  // Verify rooms are still present
  console.log('  - Checking reinitialized user room lists...')
  const reInitCreatorRooms = reInitCreatorUser.rooms
  const reInitJoinerRooms = reInitJoinerUser.rooms




  console.log('Creating another channel')
  const roomOfCreator = await reInitCreatorUser.getRoom(
    reInitCreatorRooms[0].id
  )

  await roomOfCreator.createChannel({
    name: 'gaming',
    type: 'text',
    isDefault: false
  })

  console.log('  - Waiting for network synchronization after new channel creation...')
  await delay(5000)
  // Wait for network sync

  const ownerChannels = roomOfCreator.channels
  const joinerChannels = await (await reInitJoinerUser.getRoom(reInitJoinerRooms[0].id)).channels

  console.log({
    reInitCreatorRooms,
    reInitJoinerRooms,
    ownerChannels,
    joinerChannels
  })




  const reInitCreatorRoomEntry = reInitCreatorRooms.find(r => r.name === TEST_ROOM.name)
  const reInitJoinerRoomEntry = reInitJoinerRooms.find(r => r.name === TEST_ROOM.name)

  if (!reInitCreatorRoomEntry) {
    throw new Error('Room not found in reinitialized creator\'s room list')
  }
  if (!reInitJoinerRoomEntry) {
    throw new Error('Room not found in reinitialized joiner\'s room list')
  }
  if (reInitCreatorUser.rooms.length !== reInitJoinerRooms.length) {
    throw new Error('Rooms do not sync after close. Weird!')
  }

  // Verify room details are consistent
  console.log('  - Verifying room details after reinitialization...')
  if (reInitCreatorRoomEntry.id !== reInitJoinerRoomEntry.id) {
    throw new Error('Room IDs do not match after reinitialization')
  }

  // Clean up reinitialized instances
  await reInitCreatorUser.close()
  await reInitJoinerUser.close()
  await reInitStore1.close()
  await reInitStore2.close()

  console.log('  ✓ Reinitialization and synchronization test passed')
}

// Helper function to clean up test directories
async function cleanup() {
  try {
    // Check if directories exist before attempting to remove
    if (fs.existsSync(TEST_DIR_1)) {
      await rimraf(TEST_DIR_1)
    }
    if (fs.existsSync(TEST_DIR_2)) {
      await rimraf(TEST_DIR_2)
    }
    if (fs.existsSync(TEST_BASE_DIR)) {
      await rimraf(TEST_BASE_DIR)
    }
  } catch (error) {
    console.error('Error during cleanup:', error)
  }
}

// Run the tests
runTests().catch(error => {
  console.error('Error running tests:', error)
  process.exit(1)
})
