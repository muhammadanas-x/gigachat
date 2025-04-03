// test/gigauser-pairing.test.js - Test device pairing and synchronization
const Corestore = require('corestore')
const Gigauser = require('../lib/gigauser/Gigauser.js')
const fs = require('fs')
const path = require('path')
const { rimraf } = require('rimraf')
const b4a = require('b4a')
const z32 = require('z32')
// Test directories
const TEST_DIR_1 = path.join('./test-gigauser/', 'test-gigauser-pairing-1')
const TEST_DIR_2 = path.join('./test-gigauser/', 'test-gigauser-pairing-2')

// Sample data
const TEST_SEED = 'abandon ability able about above absent absorb abstract absurd abuse access accident account accuse achieve acid acoustic acquire across act action actor'
const TEST_PROFILE = {
  name: 'Paired User',
  status: 'Syncing Devices',
  avatar: 'paired-avatar'
}
const TEST_ROOM = {
  id: 'paired-room-123',
  name: 'Paired Test Room',
  description: 'A room for testing device pairing'
}
const TEST_SETTINGS = {
  theme: 'light',
  notifications: false,
  language: 'en'
}

// Test runner
async function runTests() {
  console.log('🔍 Starting Gigauser Pairing tests...')
  console.log('-----------------------------')

  // Clean up any existing test directories
  await cleanup()

  try {
    // Run the tests
    await testDevicePairingSync()

    console.log('-----------------------------')
    console.log('✅ All pairing tests completed successfully!')
  } catch (error) {
    console.error('❌ Test failed:', error)
    process.exit(1)
  } finally {
    // Clean up test directories
    await cleanup()
  }
}

// Test device pairing and synchronization
async function testDevicePairingSync() {
  console.log('\n📋 Test: Device Pairing and Synchronization')

  // Create first corestore (primary device)
  const store1 = new Corestore(TEST_DIR_1)
  await store1.ready()

  // Create second corestore (secondary device)
  const store2 = new Corestore(TEST_DIR_2)
  await store2.ready()

  // Create primary user
  const primaryUser = await Gigauser.create(store1, TEST_SEED)
  await primaryUser.ready()
  console.log(`  - Primary user created: ${primaryUser.publicKey.toString('hex').substring(0, 8)}...`)

  // Create pairing invite
  const invite = await primaryUser.createPairingInvite()
  console.log(`  - Pairing invite created: ${invite.substring(0, 10)}...`)

  await delay(500)
  // Create secondary user by pairing
  const secondaryUser = await Gigauser.pairDevice(store2, invite)
  await secondaryUser.ready()


  await delay(500)


  console.log(`  - Secondary user paired successfully`)
  // await primaryUser.refreshUser()
  // await secondaryUser.refreshUser()


  const pub1 = (primaryUser.publicKey).toString('hex')
  const pub2 = (secondaryUser.publicKey).toString('hex')
  console.log({ pub1, pub2 })

  // Verify public keys match
  if (pub1 !== pub2) {
    throw new Error('Public keys do not match between devices')
  }

  // Update profile on primary device
  await primaryUser.updateProfile(TEST_PROFILE)
  console.log('  - Updated profile on primary device')

  // Wait a bit for sync
  await delay(500)

  console.log(primaryUser.profile, secondaryUser.profile)

  // Verify profile sync
  if (secondaryUser.profile.name !== TEST_PROFILE.name ||
    secondaryUser.profile.status !== TEST_PROFILE.status ||
    secondaryUser.profile.avatar !== TEST_PROFILE.avatar) {
    throw new Error('Profile did not sync correctly between devices')
  }

  // Add a room on secondary device
  await secondaryUser.addRoom(TEST_ROOM)
  console.log('  - Added room on secondary device')

  // Wait a bit for sync
  await delay(200)

  // Verify room sync
  const syncedRoom = primaryUser.rooms.find(r => r.id === TEST_ROOM.id)
  if (!syncedRoom || syncedRoom.name !== TEST_ROOM.name) {
    throw new Error('Room did not sync correctly between devices')
  }

  // Update settings on primary device
  await primaryUser.updateSettings(TEST_SETTINGS)
  console.log('  - Updated settings on primary device')

  // Wait a bit for sync
  await delay(200)

  // Verify settings sync
  if (secondaryUser.settings.theme !== TEST_SETTINGS.theme ||
    secondaryUser.settings.notifications !== TEST_SETTINGS.notifications ||
    secondaryUser.settings.language !== TEST_SETTINGS.language) {
    throw new Error('Settings did not sync correctly between devices')
  }

  // Clean up
  await primaryUser.close()
  await secondaryUser.close()
  await store1.close()
  await store2.close()

  console.log('  ✓ Device pairing and synchronization test passed')
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
  } catch (error) {
    console.error('Error during cleanup:', error)
  }
}

// Helper function for delay
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Run the tests
runTests().catch(error => {
  console.error('Error running tests:', error)
  process.exit(1)
})
