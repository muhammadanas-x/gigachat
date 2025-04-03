// test/gigauser-seed-recovery.test.js
const Corestore = require('corestore');
const Gigauser = require('../lib/gigauser/Gigauser.js');
const fs = require('fs');
const path = require('path');
const { rimraf } = require('rimraf');

// Test directories
const TEST_DIR_1 = path.join('./test-gigauser/', 'seed-recovery-1');
const TEST_DIR_2 = path.join('./test-gigauser/', 'seed-recovery-2');

// Test seed
const TEST_SEED = 'abandon ability able about above absent absorb abstract absurd abuse access accident account accuse achieve acid acoustic acquire across act action actor';

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Test runner
async function runTests() {
  console.log('🔍 Starting Seed Recovery tests...');

  // Clean up test directories
  await cleanup();

  try {
    const store1 = new Corestore(TEST_DIR_1);
    await store1.ready();

    const primaryUser = await Gigauser.create(store1, TEST_SEED);
    await primaryUser.ready();

    // Make sure primary is replicating
    await primaryUser.updateProfile({ name: 'Recovery Test User' });
    await primaryUser.updateSettings({ theme: 'dark' });

    console.log('Primary user created with profile:', primaryUser.profile.name);
    console.log('Primary public key:', primaryUser.publicKey.toString('hex'));

    // Allow time for the primary to announce on the network
    console.log('Waiting for primary to fully announce...');
    await delay(3000);

    // Add debugging to verify the primary is serving correctly
    const keys = Gigauser.deriveKeysFromSeed(TEST_SEED);
    console.log('Primary using discovery key:', keys.discoveryKey.toString('hex'));

    // Try to recover on second device
    const store2 = new Corestore(TEST_DIR_2);
    await store2.ready();

    console.log('Attempting recovery with seed phrase...');
    const recoveredUser = await Gigauser.recoverFromSeed(store2, TEST_SEED, {
      timeout: 20000 // 10 second timeout for tests
    });

    await recoveredUser.ready()

    console.log('Recovery completed');
    console.log(recoveredUser.profile)
    console.log('Recovered profile name:', recoveredUser.profile.name);
    console.log('Recovered settings:', recoveredUser.settings);

    // Verify data
    if (recoveredUser.profile.name !== 'Recovery Test User') {
      throw new Error('Profile name did not recover correctly');
    }

    if (recoveredUser.settings.theme !== 'dark') {
      throw new Error('Settings did not recover correctly');
    }

    await recoveredUser.updateProfile({ name: 'Caner', customParam: ["0", "1", "2"] })

    console.log('Username updated in pair client: ', recoveredUser.profile.name)

    await delay(5000)

    await primaryUser.refreshUser()

    if (primaryUser.profile.name !== "Caner") {
      throw new Error("Primary user did not updated")
    }


    console.log('Username updated in main client: ', recoveredUser.profile.name)


    console.log('✅ Recovery test passed!');

    // Clean up
    await primaryUser.close();
    await recoveredUser.close();
    await store1.close();
    await store2.close();

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  } finally {
    await cleanup();
  }
}

// Helper function to clean up test directories
async function cleanup() {
  if (fs.existsSync(TEST_DIR_1)) {
    await rimraf(TEST_DIR_1);
  }
  if (fs.existsSync(TEST_DIR_2)) {
    await rimraf(TEST_DIR_2);
  }
}

// Run the tests
runTests();
