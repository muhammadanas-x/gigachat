const Corestore = require('corestore')
const Gigauser = require('../lib/gigauser/Gigauser.js')
const fs = require('fs')
const path = require('path')

async function testUserCreation() {
  console.log('Starting user creation test')

  // Create temporary test directory
  const testDir = path.join(__dirname, 'test-gigauser')

  // Ensure directory exists
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir)
  }

  try {
    // Create corestore
    const store = new Corestore(testDir)
    await store.ready()

    console.log('Corestore ready')

    // Test seed
    const seed = 'abandon ability able about above absent absorb abstract absurd abuse access accident account accuse achieve acid acoustic acquire across act action actor'

    // Create user
    console.log('Attempting to create user')
    const user = await Gigauser.create(store, seed)

    console.log('User created successfully:', user.publicKey)

    // Close resources
    await user.close()
    await store.close()
  } catch (error) {
    console.error('Full error details:', error)
    console.error('Error stack:', error.stack)
    throw error
  }
}

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

testUserCreation()
  .then(() => {
    console.log('Test completed successfully')
    process.exit(0)
  })
  .catch(err => {
    console.error('Test failed:', err)
    process.exit(1)
  })
