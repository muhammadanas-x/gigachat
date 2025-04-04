// test/reactivity.test.js
const Corestore = require('corestore')
const Gigauser = require('../lib/gigauser/Gigauser.js')
const { rimraf } = require('rimraf')
const path = require('path')
const fs = require('fs')

// Test directories
const TEST_BASE_DIR = path.join('./test-reactivity/')
const TEST_DIR_1 = path.join(TEST_BASE_DIR, 'user-emitter')
const TEST_DIR_2 = path.join(TEST_BASE_DIR, 'user-listener')

// Test seed phrases
const TEST_SEED_1 = 'test room emitter seed one two three four five six seven eight nine ten'
const TEST_SEED_2 = 'test room listener seed one two three four five six seven eight nine ten'

// Test room data
const TEST_ROOM = {
  name: 'Reactivity Test Room',
  description: 'A room for testing event reactivity',
  type: 'community'
}

// Utility functions
function delay(ms, message = '') {
  console.log(`⏳ Waiting ${ms}ms: ${message}`)
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Logger for events
class EventLogger {
  constructor(prefix) {
    this.prefix = prefix;
    this.events = [];
  }

  log(eventName, data) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      eventName,
      data: typeof data === 'object' ? JSON.parse(JSON.stringify(data)) : data
    };

    this.events.push(logEntry);
    console.log(`[${this.prefix}] ${timestamp} - ${eventName}:`,
      data ? JSON.stringify(data).substring(0, 100) + '...' : '');
    return logEntry;
  }

  clear() {
    this.events = [];
  }

  getEvents() {
    return [...this.events];
  }

  countByType(eventName) {
    return this.events.filter(e => e.eventName === eventName).length;
  }

  printSummary() {
    console.log(`\n${this.prefix} Event Summary:`);

    // Get unique event names
    const eventNames = [...new Set(this.events.map(e => e.eventName))];

    // Print count for each event type
    eventNames.forEach(name => {
      const count = this.countByType(name);
      console.log(`  - ${name}: ${count} events`);
    });

    console.log(`  Total: ${this.events.length} events\n`);
  }
}

async function runReactivityTest() {
  console.log('🔍 Starting Reactivity Test...');
  console.log('-------------------------------');

  // Clean up any existing test directories
  await cleanup();

  // Create event loggers
  const emitterLogger = new EventLogger('EMITTER');
  const listenerLogger = new EventLogger('LISTENER');

  try {
    // PART 1: Setup and Room Creation
    console.log('\n📋 PHASE 1: Initial Setup');

    // Create corestores
    const store1 = new Corestore(TEST_DIR_1);
    const store2 = new Corestore(TEST_DIR_2);

    await store1.ready();
    await store2.ready();

    // Create emitter user
    console.log('  - Creating emitter user...');
    const emitterUser = await Gigauser.create(store1, TEST_SEED_1);
    await emitterUser.ready();

    // Set up event listeners for emitter user
    setupUserEventListeners(emitterUser, emitterLogger);

    // Update emitter profile
    await emitterUser.updateProfile({
      name: 'Event Emitter',
      status: 'Testing Events'
    });

    // Create room
    console.log('  - Creating test room...');
    const emitterRoom = await emitterUser.createRoom(TEST_ROOM);

    // Set up event listeners for emitter room
    setupRoomEventListeners(emitterRoom, emitterLogger);

    // Generate room invite
    const roomInvite = await emitterRoom.createInvite();

    // Create listener user
    console.log('  - Creating listener user...');
    const listenerUser = await Gigauser.create(store2, TEST_SEED_2);
    await listenerUser.ready();

    // Set up event listeners for listener user
    setupUserEventListeners(listenerUser, listenerLogger);

    // Join the room as listener
    console.log('  - Joining the room as listener...');
    const listenerRoom = await listenerUser.joinRoom(roomInvite);

    // Set up event listeners for listener room
    setupRoomEventListeners(listenerRoom, listenerLogger);

    // Wait for room setup to complete
    await delay(2000, 'Initial room setup');

    // PART 2: Create and Update Room Content
    console.log('\n📋 PHASE 2: Room Content Manipulation');

    // Clear event logs for clean test
    emitterLogger.clear();
    listenerLogger.clear();

    // Create a channel
    console.log('  - Creating text channel...');
    await emitterRoom.createChannel({
      name: 'general',
      type: 'text',
      isDefault: true
    });

    // Wait for sync
    await delay(3000, 'Channel creation sync');

    // Update room details
    console.log('  - Updating room description...');
    await emitterRoom.updateRoom({
      description: 'Updated room description for reactivity test'
    });

    // Wait for sync
    await delay(3000, 'Room update sync');

    // Create another channel
    console.log('  - Creating second channel...');
    await emitterRoom.createChannel({
      name: 'random',
      type: 'text',
      isDefault: false
    });

    // Wait for sync
    await delay(3000, 'Second channel sync');

    // PART 3: Event Analysis
    console.log('\n📋 PHASE 3: Event Analysis');

    // Print event summaries
    emitterLogger.printSummary();
    listenerLogger.printSummary();

    // Verify expected events occurred
    verifyEvents(emitterLogger, listenerLogger);

    // PART 4: Close and Clean Up
    console.log('\n📋 PHASE 4: Clean Up');

    // Close all instances
    await emitterUser.close();
    await listenerUser.close();
    await store1.close();
    await store2.close();

    console.log('-------------------------------');
    console.log('✅ Reactivity Test Completed Successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('Error stack:', error.stack);
    process.exit(1);
  } finally {
    // Clean up test directories
    await cleanup();
  }
}

// Helper function to set up event listeners for a user
function setupUserEventListeners(user, logger) {
  // Core events
  user.on('update', () => logger.log('user:update'));
  user.on('error', (error) => logger.log('user:error', { message: error.message }));

  // Detailed events
  user.on('identity:updated', (data) => logger.log('user:identity:updated', data));
  user.on('profile:updated', (data) => logger.log('user:profile:updated', data));
  user.on('rooms:updated', (data) => logger.log('user:rooms:updated', data));
  user.on('devices:updated', (data) => logger.log('user:devices:updated', data));
  user.on('settings:updated', (data) => logger.log('user:settings:updated', data));
  user.on('invites:updated', () => logger.log('user:invites:updated'));
  user.on('writers:updated', () => logger.log('user:writers:updated'));
  user.on('update:complete', (types) => logger.log('user:update:complete', types));

  // Room-related events
  user.on('room:initialized', (roomId) => logger.log('user:room:initialized', { roomId }));
  user.on('room:update', (data) => logger.log('user:room:update', data));
  user.on('room:channels:updated', (data) => logger.log('user:room:channels:updated', data));
  user.on('room:members:updated', (data) => logger.log('user:room:members:updated', data));
}

// Helper function to set up event listeners for a room
function setupRoomEventListeners(room, logger) {
  // Core events
  room.on('update', () => logger.log('room:update'));
  room.on('error', (error) => logger.log('room:error', { message: error.message }));

  // Detailed events
  room.on('room:updated', (data) => logger.log('room:room:updated', data));
  room.on('channels:updated', (data) => logger.log('room:channels:updated', data));
  room.on('members:updated', (data) => logger.log('room:members:updated', data));
  room.on('categories:updated', (data) => logger.log('room:categories:updated', data));
  room.on('roles:updated', (data) => logger.log('room:roles:updated', data));
  room.on('messages:updated', () => logger.log('room:messages:updated'));
  room.on('files:updated', () => logger.log('room:files:updated'));
  room.on('reactions:updated', () => logger.log('room:reactions:updated'));
  room.on('invites:updated', () => logger.log('room:invites:updated'));
  room.on('permissions:updated', () => logger.log('room:permissions:updated'));
  room.on('threads:updated', () => logger.log('room:threads:updated'));
  room.on('update:complete', (types) => logger.log('room:update:complete', types));
}

// Helper function to verify events based on expectations
function verifyEvents(emitterLogger, listenerLogger) {
  console.log('\nEvent Verification:');

  // Verify emitter events
  console.log('  Emitter Events Verification:');

  // Check for room update events
  const hasRoomUpdates = emitterLogger.countByType('room:room:updated') > 0;
  console.log(`  - Room updates detected: ${hasRoomUpdates ? '✅' : '❌'}`);

  // Check for channel update events
  const hasChannelUpdates = emitterLogger.countByType('room:channels:updated') > 0;
  console.log(`  - Channel updates detected: ${hasChannelUpdates ? '✅' : '❌'}`);

  // Check for update:complete events
  const hasCompleteEvents = emitterLogger.countByType('room:update:complete') > 0;
  console.log(`  - Update complete events detected: ${hasCompleteEvents ? '✅' : '❌'}`);

  // Verify listener events
  console.log('\n  Listener Events Verification:');

  // Check if listener received room updates
  const listenerReceivedRoomUpdates = listenerLogger.countByType('room:room:updated') > 0;
  console.log(`  - Room updates received: ${listenerReceivedRoomUpdates ? '✅' : '❌'}`);

  // Check if listener received channel updates
  const listenerReceivedChannelUpdates = listenerLogger.countByType('room:channels:updated') > 0;
  console.log(`  - Channel updates received: ${listenerReceivedChannelUpdates ? '✅' : '❌'}`);

  // Check if listener received complete updates
  const listenerReceivedCompleteEvents = listenerLogger.countByType('room:update:complete') > 0;
  console.log(`  - Update complete events received: ${listenerReceivedCompleteEvents ? '✅' : '❌'}`);

  // Verify data propagation
  const channelCountEmitter = emitterLogger.events
    .filter(e => e.eventName === 'room:channels:updated')
    .pop()?.data?.length || 0;

  const channelCountListener = listenerLogger.events
    .filter(e => e.eventName === 'room:channels:updated')
    .pop()?.data?.length || 0;

  const channelsSynced = channelCountEmitter > 0 && channelCountEmitter === channelCountListener;
  console.log(`  - Channel count synced between peers (${channelCountEmitter}/${channelCountListener}): ${channelsSynced ? '✅' : '❌'}`);

  // Perform assertions
  if (!hasRoomUpdates || !hasChannelUpdates || !hasCompleteEvents) {
    console.error('❌ Emitter is not generating expected events');
  }

  if (!listenerReceivedRoomUpdates || !listenerReceivedChannelUpdates || !listenerReceivedCompleteEvents) {
    console.error('❌ Listener is not receiving expected events');
  }

  if (!channelsSynced) {
    console.error('❌ Channel data not properly synchronized between peers');
  }

  // Overall success
  const testPassed = hasRoomUpdates && hasChannelUpdates && hasCompleteEvents &&
    listenerReceivedRoomUpdates && listenerReceivedChannelUpdates &&
    listenerReceivedCompleteEvents && channelsSynced;

  console.log(`\nOverall event verification: ${testPassed ? '✅ PASSED' : '❌ FAILED'}`);

  if (!testPassed) {
    throw new Error('Event verification failed');
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
runReactivityTest().catch(error => {
  console.error('Error running tests:', error)
  process.exit(1)
})

