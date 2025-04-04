// peer-chat.js
const Corestore = require('corestore')
const Gigauser = require('./lib/gigauser/Gigauser')
const readline = require('readline')
const fs = require('fs')
const path = require('path')

// Check command-line arguments
const username = process.argv[2]
const storagePath = process.argv[3] || `./user-storage-${username}`

if (!username) {
  console.error('Usage: node peer-chat.js <username> [storagePath]')
  process.exit(1)
}

// Create storage directory if it doesn't exist
if (!fs.existsSync(storagePath)) {
  fs.mkdirSync(storagePath, { recursive: true })
}

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

// Path for storing invite codes
const inviteFilePath = path.join(storagePath, 'invites.json')

// Save invite code to file
function saveInviteCode(roomName, inviteCode) {
  let invites = {}
  
  // Read existing invites if file exists
  if (fs.existsSync(inviteFilePath)) {
    try {
      invites = JSON.parse(fs.readFileSync(inviteFilePath, 'utf8'))
    } catch (error) {
      console.error('Error reading invites file:', error.message)
    }
  }
  
  // Add new invite
  invites[roomName] = inviteCode
  
  // Save to file
  fs.writeFileSync(inviteFilePath, JSON.stringify(invites, null, 2))
  console.log(`Invite code saved to ${inviteFilePath}`)
}

// Read invite code from file
function getInviteCodes() {
  if (fs.existsSync(inviteFilePath)) {
    try {
      return JSON.parse(fs.readFileSync(inviteFilePath, 'utf8'))
    } catch (error) {
      console.error('Error reading invites file:', error.message)
      return {}
    }
  }
  return {}
}

// Main application class
class PeerChatApp {
  constructor(username, storagePath) {
    this.username = username
    this.storagePath = storagePath
    this.user = null
    this.currentRoom = null
    this.currentChannel = null
    this.messageListener = null
    
    // Configure discovery options
    this.discoveryOptions = {
      announce: true,     // Announce our presence on the network
      lookup: true,       // Look for other peers
      maxPeers: 50,       // Maximum number of peers to connect to
      bootstrap: true     // Use default bootstrap servers
    }
  }

  // Initialize the app
  async init() {
    console.log(`🚀 Welcome to Peer Chat! You are: ${this.username}`)
    
    try {
      // Initialize corestore with a specific path for this user
      const store = new Corestore(this.storagePath)
      await store.ready() // Ensure store is ready
      
      // Generate a deterministic seed from username (for demo purposes)
      // In production, use a secure seed phrase that users save
      const seedWords = Array(12).fill(this.username)
      
      // Create or load user
      this.user = await Gigauser.create(store, seedWords, {
        username: this.username,
        discovery: this.discoveryOptions
      })
      
      console.log(`User initialized with public key: ${this.user.publicKey.toString('hex').substring(0, 8)}...`)
      await this.showMainMenu()
    } catch (error) {
      console.error('Error initializing user:', error.message)
      process.exit(1)
    }
  }

  // Display main menu
  async showMainMenu() {
    console.log('\n--- MAIN MENU ---')
    console.log('1. Create a new room')
    console.log('2. Join a room with invite code')
    console.log('3. List available invites')
    console.log('4. List my rooms')
    console.log('5. Exit')
    
    rl.question('Select an option: ', async (answer) => {
      switch(answer) {
        case '1':
          await this.createRoom()
          break
        case '2':
          await this.joinRoom()
          break
        case '3':
          await this.listInvites()
          break
        case '4':
          await this.listRooms()
          break
        case '5':
          console.log('Goodbye!')
          rl.close()
          process.exit(0)
          break
        default:
          console.log('Invalid option, please try again.')
          await this.showMainMenu()
      }
    })
  }

  // Create a new room
  async createRoom() {
    console.log('\n--- CREATE ROOM ---')
    
    rl.question('Room name: ', async (name) => {
      rl.question('Room description: ', async (description) => {
        rl.question('Is private? (y/n): ', async (isPrivateInput) => {
          const isPrivate = isPrivateInput.toLowerCase() === 'y'
          
          try {
            const room = await this.user.createRoom({
              name,
              description,
              isPrivate,
              discovery: this.discoveryOptions // Ensure discovery is enabled
            })
            
            console.log(`Room created: ${room.name}`)
            const inviteCode = await room.createInvite()
            console.log(`Invite code: ${inviteCode}`)
            
            // Save invite to file for other peers to use
            saveInviteCode(name, inviteCode)
            
            this.currentRoom = room
            
            // Automatically create a general channel
            const generalChannel = await room.createChannel({
              name: 'general',
              topic: 'General discussion'
            })
            console.log(`Created default channel: #${generalChannel.name}`)
            
            await this.showRoomMenu()
          } catch (error) {
            console.error('Error creating room:', error.message)
            await this.showMainMenu()
          }
        })
      })
    })
  }

  // List available invites from file
  async listInvites() {
    console.log('\n--- AVAILABLE INVITES ---')
    
    const invites = getInviteCodes()
    const roomNames = Object.keys(invites)
    
    if (roomNames.length === 0) {
      console.log('No saved invites found.')
      await this.showMainMenu()
      return
    }
    
    roomNames.forEach((name, index) => {
      console.log(`${index + 1}. ${name}: ${invites[name]}`)
    })
    
    rl.question('Enter room number to join (or 0 to go back): ', async (answer) => {
      const roomIndex = parseInt(answer) - 1
      
      if (answer === '0' || isNaN(roomIndex) || roomIndex < 0 || roomIndex >= roomNames.length) {
        await this.showMainMenu()
      } else {
        const roomName = roomNames[roomIndex]
        const inviteCode = invites[roomName]
        
        try {
          const room = await this.user.joinRoom(inviteCode)
          console.log(`Joined room: ${room.name}`)
          this.currentRoom = room
          await this.showRoomMenu()
        } catch (error) {
          console.error('Error joining room:', error.message)
          await this.showMainMenu()
        }
      }
    })
  }

  // Join a room using invite code
  async joinRoom() {
    console.log('\n--- JOIN ROOM ---')
    
    rl.question('Enter invite code: ', async (inviteCode) => {
      try {
        const room = await this.user.joinRoom(inviteCode)
        console.log(`Joined room: ${room.name}`)
        this.currentRoom = room
        await this.showRoomMenu()
      } catch (error) {
        console.error('Error joining room:', error.message)
        await this.showMainMenu()
      }
    })
  }

  // List rooms the user is part of
  async listRooms() {
    console.log('\n--- MY ROOMS ---')
    
    try {
      const rooms = await this.user.rooms
      
      if (rooms.length === 0) {
        console.log('You are not part of any rooms yet.')
        await this.showMainMenu()
        return
      }
      
      rooms.forEach((room, index) => {
        console.log(`${index + 1}. ${room.name} (${room.isPrivate ? 'Private' : 'Public'})`)
      })
      
      rl.question('Select a room number to enter (or 0 to go back): ', async (answer) => {
        const roomIndex = parseInt(answer) - 1
        
        if (answer === '0' || isNaN(roomIndex) || roomIndex < 0 || roomIndex >= rooms.length) {
          await this.showMainMenu()
        } else {
          this.currentRoom = rooms[roomIndex]
          await this.showRoomMenu()
        }
      })
    } catch (error) {
      console.error('Error listing rooms:', error.message)
      await this.showMainMenu()
    }
  }

  // Display room menu
  async showRoomMenu() {
    console.log(`\n--- ROOM: ${this.currentRoom.name} ---`)
    console.log('1. List channels')
    console.log('2. Create a channel')
    console.log('3. Generate new invite code')
    console.log('4. Go back to main menu')
    
    rl.question('Select an option: ', async (answer) => {
      switch(answer) {
        case '1':
          await this.listChannels()
          break
        case '2':
          await this.createChannel()
          break
        case '3':
          try {
            const inviteCode = await this.currentRoom.createInvite()
            console.log(`New invite code: ${inviteCode}`)
            saveInviteCode(this.currentRoom.name, inviteCode)
            await this.showRoomMenu()
          } catch (error) {
            console.error('Error generating invite:', error.message)
            await this.showRoomMenu()
          }
          break
        case '4':
          this.currentRoom = null
          await this.showMainMenu()
          break
        default:
          console.log('Invalid option, please try again.')
          await this.showRoomMenu()
      }
    })
  }

  // List channels in current room
  async listChannels() {
    console.log('\n--- CHANNELS ---')
    
    try {
      const channels = this.currentRoom.channels
      
      if (channels.length === 0) {
        console.log('This room has no channels yet.')
        await this.showRoomMenu()
        return
      }
      
      channels.forEach((channel, index) => {
        console.log(`${index + 1}. #${channel.name}`)
      })
      
      rl.question('Select a channel number to enter (or 0 to go back): ', async (answer) => {
        const channelIndex = parseInt(answer) - 1
        
        if (answer === '0' || isNaN(channelIndex) || channelIndex < 0 || channelIndex >= channels.length) {
          await this.showRoomMenu()
        } else {
          this.currentChannel = channels[channelIndex]
          await this.enterChannel()
        }
      })
    } catch (error) {
      console.error('Error listing channels:', error.message)
      await this.showRoomMenu()
    }
  }

  // Create a new channel
  async createChannel() {
    console.log('\n--- CREATE CHANNEL ---')
    
    rl.question('Channel name: ', async (name) => {
      rl.question('Channel topic: ', async (topic) => {
        try {
          const channel = await this.currentRoom.createChannel({
            name,
            topic
          })
          
          console.log(`Channel created: #${channel.name}`)
          await this.showRoomMenu()
        } catch (error) {
          console.error('Error creating channel:', error.message)
          await this.showRoomMenu()
        }
      })
    })
  }

  // Enter a channel to chat
  async enterChannel() {
    console.log(`\n--- #${this.currentChannel.name} ---`)
    console.log(`Topic: ${this.currentChannel.topic || 'No topic set'}`)
    console.log(`User: ${this.username}`)
    console.log('Loading recent messages...')
    
    try {
      // Get recent messages
      const messages = await this.currentChannel.getMessages({ limit: 10 })
      if (messages.length === 0) {
        console.log('No messages yet.')
      } else {
        messages.forEach(msg => {
          const author = msg.authorUsername || msg.author.substr(0, 6)
          console.log(`${author}: ${msg.content}`)
        })
      }
      
      console.log('\n(Type a message and press Enter to send, type /exit to leave)')
      
      // Set up message listener for real-time updates
      this.messageListener = (message) => {
        if (message.channelId === this.currentChannel.id) {
          // Don't show our own messages again (they're shown when sent)
          if (message.author !== this.user.publicKey.toString('hex')) {
            const author = message.authorUsername || message.author.substr(0, 6)
            console.log(`${author}: ${message.content}`)
          }
        }
      }
      
      this.currentChannel.on('message', this.messageListener)
      
      // Handle user input
      const askForMessage = () => {
        rl.question('> ', async (input) => {
          if (input.toLowerCase() === '/exit') {
            this.currentChannel.removeListener('message', this.messageListener)
            this.currentChannel = null
            await this.showRoomMenu()
            return
          } 
          
          try {
            // Send message with username metadata
            await this.currentChannel.sendMessage(input, {
              metadata: { username: this.username }
            })
            console.log(`${this.username}: ${input}`) // Show your own message
            askForMessage()
          } catch (error) {
            console.error('Error sending message:', error.message)
            askForMessage()
          }
        })
      }
      
      askForMessage()
    } catch (error) {
      console.error('Error entering channel:', error.message)
      this.currentChannel = null
      await this.showRoomMenu()
    }
  }
}

// Run the app
async function main() {
  const app = new PeerChatApp(username, storagePath)
  await app.init()
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})