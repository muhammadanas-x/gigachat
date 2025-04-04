// test/channel-sync-complete.test.js
const Corestore = require('corestore')
const Gigauser = require('../lib/gigauser/Gigauser.js')
const fs = require('fs')
const path = require('path')
const { rimraf } = require('rimraf')

// Test directories
const TEST_BASE_DIR = path.join('./test-channel-sync/')
const TEST_DIR_1 = path.join(TEST_BASE_DIR, 'user-creator')
const TEST_DIR_2 = path.join(TEST_BASE_DIR, 'user-joiner')

// Test seed phrases (unique for each test)
const TEST_SEED_1 = 'river blue mountain green forest tall river blue mountain green forest tall'
const TEST_SEED_2 = 'mountain green forest tall river blue mountain green forest tall river'

// Room test data
const TEST_ROOM = {
  name: 'Channel Sync Test Room',
  description: 'A room for testing channel synchronization',
  type: 'community'
}

// Utility delay function
function delay(ms, message = '') {
  console.log(`⏳ Waiting ${ms}ms: ${message}`)
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Detailed logging function
function logChannels(title, channels) {
  console.log(`\n${title} Channels:`)
  if (!channels || channels.length === 0) {
    console.log('  No channels found')
    return
  }
  channels.forEach((channel, index) => {
    console.log(`  ${index + 1}. ID: ${channel.id}, Name: ${channel.name}, Position: ${channel.position}`)
  })
}

// Test runner
async function runChannelSyncTest() {
  console.log('🔍 Starting Channel Synchronization Test...')
  console.log('-----------------------------')

  // Clean up any existing test directories
  await cleanup()

  try {
    // PART 1: Initial Setup and Room Creation
    console.log('\n📋 PHASE 1: Initial Setup')

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
      status: 'Creating Sync Test Room'
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

    // Wait for network propagation
    await delay(2000, 'Initial network setup')

    // Join the room
    console.log('  - Joining the room...')
    const joinedRoom = await joinerUser.joinRoom(roomInvite)
    console.log(`  - Joined room successfully: ${joinedRoom.id}`)


    console.log({
      creatorRooms: creatorUser.rooms,
      joinerRooms: joinerUser.rooms
    })

    // PART 2: First Channel Creation
    console.log('\n📋 PHASE 2: First Channel Creation')

    console.log({ creatorRooms: creatorUser.rooms })
    // Create first channel by creator
    const creatorRoom = await creatorUser.getRoom(creatorUser.rooms[0].id)
    console.log('Creator room retrieved:', {
      roomId: creatorRoom.id,
      baseReady: !!creatorRoom.base,
      baseKey: creatorRoom.base ? creatorRoom.base.key.toString('hex') : 'No base'
    })

    // Create the channel with comprehensive logging
    try {
      await creatorRoom.createChannel({
        name: 'general-chat',
        type: 'text',
        isDefault: true
      })
      console.log('Channel created successfully')
    } catch (channelCreateError) {
      console.error('Error creating channel:', channelCreateError)
      throw channelCreateError
    }    // Wait for sync
    await delay(5000, 'Waiting for first channel sync')

    // Verify channels
    const creatorRoomAfterFirstChannel = await creatorUser.getRoom(creatorUser.rooms[0].id)
    const joinerRoomAfterFirstChannel = await joinerUser.getRoom(joinerUser.rooms[0].id)

    logChannels('Creator', creatorRoomAfterFirstChannel.channels)
    logChannels('Joiner', joinerRoomAfterFirstChannel.channels)

    // Verify first channel sync
    if (creatorRoomAfterFirstChannel._channels.length !== joinerRoomAfterFirstChannel._channels.length) {
      throw new Error('Channel count mismatch after first channel creation')
    }

    // PART 3: Close and Reinitialize
    console.log('\n📋 PHASE 3: Close and Reinitialize')

    // Close all instances
    await creatorUser.close()
    await joinerUser.close()
    await store1.close()
    await store2.close()

    // Reinitialize stores and users
    const reInitStore1 = new Corestore(TEST_DIR_1)
    const reInitStore2 = new Corestore(TEST_DIR_2)

    await reInitStore1.ready()
    await reInitStore2.ready()

    const reInitCreatorUser = new Gigauser(reInitStore1)
    const reInitJoinerUser = new Gigauser(reInitStore2)

    await reInitCreatorUser.ready()
    await reInitJoinerUser.ready()
    // Wait for reinitialization
    await delay(2000, 'Waiting for reinitialization')

    // PART 4: Second Channel Creation After Reinitialization
    console.log('\n📋 PHASE 4: Second Channel Creation After Reinitialization')


    console.log('ROOMS OF CREATOR AFTER REINIT: ', reInitCreatorUser.rooms)
    console.log('ROOMS OF JOINER AFTER REINIT: ', reInitJoinerUser.rooms)

    // Get rooms for reinitialized users
    const reInitCreatorRoom = await reInitCreatorUser.getRoom(reInitCreatorUser.rooms[0].id)

    // Create second channel
    await reInitCreatorRoom.createChannel({
      name: 'gaming',
      type: 'text',
      isDefault: false
    })

    // Wait for sync
    await delay(6000, 'Waiting for second channel sync after reinitialization')

    // Get rooms again to ensure fresh data
    const reInitCreatorRoomFinal = await reInitCreatorUser.getRoom(reInitCreatorUser.rooms[0].id)
    const reInitJoinerRoomFinal = await reInitJoinerUser.getRoom(reInitJoinerUser.rooms[0].id)


    // Log and verify channels

    await delay(5000, 'Waiting for second channel sync after adding a new channel')
    await reInitCreatorRoomFinal.refreshChannels()
    await reInitJoinerRoomFinal.refreshChannels()
    logChannels('Reinitialized Creator channels', reInitCreatorRoomFinal.channels)
    logChannels('Reinitialized Joiner channels', reInitJoinerRoomFinal.channels)


    // Verify second channel sync
    if (reInitCreatorRoomFinal.channels.length !== reInitJoinerRoomFinal.channels.length) {
      throw new Error('Channel count mismatch after second channel creation')
    }

    const finalCreatorRoomFinal = await reInitCreatorUser.getRoom(reInitCreatorUser.rooms[0].id)
    const finalJoinerRoomFinal = await reInitJoinerUser.getRoom(reInitJoinerUser.rooms[0].id)


    console.log({
      creatorRooms: reInitCreatorUser.rooms,
      joinerRooms: reInitJoinerUser.rooms
    })

    logChannels('Final Creator channels', finalCreatorRoomFinal.channels)
    logChannels('Final Joiner channels', finalJoinerRoomFinal.channels)



    console.log('-----------------------------')
    console.log('✅ Channel Synchronization Test Completed Successfully!')

    // Clean up
    await reInitCreatorUser.close()
    await reInitJoinerUser.close()
    await reInitStore1.close()
    await reInitStore2.close()

  } catch (error) {
    console.error('❌ Test failed:', error)
    console.error('Error stack:', error.stack)
    process.exit(1)
  } finally {
    // Clean up test directories
    await cleanup()
  }
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
runChannelSyncTest().catch(error => {
  console.error('Error running tests:', error)
  process.exit(1)
})
