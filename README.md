# Gigachat: Decentralized P2P Messaging Platform

## 🚀 Overview

Gigachat is a cutting-edge, decentralized peer-to-peer (P2P) messaging platform built on Hypercore Protocol technologies. It provides secure, encrypted communication without centralized servers, giving users complete control over their data and privacy.

## ✨ Key Features

### 🔒 Decentralized Architecture
- Fully peer-to-peer communication
- No central servers or data storage
- End-to-end encryption
- Cryptographically secure message authentication

### 🌐 Multi-Device Support
- Seamless device synchronization
- Secure device pairing
- Identity management across multiple devices

### 🔐 Privacy-First Design
- Cryptographic key derivation from seed phrase
- Invite-based room and device joining
- Optional room encryption

### 💬 Flexible Messaging
- Create and join rooms/communities
- Support for text, voice, and file sharing
- Threaded conversations
- Rich message types (text, reactions, mentions)

## 🛠 Installation

```bash
npm install gigachat
```

## 🚀 Quick Start

### Creating a User

```javascript
const Corestore = require('corestore')
const Gigauser = require('gigachat/gigauser')

// Create a new user with a seed phrase
const store = new Corestore('./user-storage')
const user = await Gigauser.create(store, [
  'river', 'blue', 'mountain', 'green', 'forest', 
  'tall', 'river', 'blue', 'mountain', 'green', 
  'forest', 'tall'
])
```

### Creating a Room

```javascript
// Create a new room
const room = await user.createRoom({
  name: 'My Awesome Community',
  description: 'A place for cool people',
  isPrivate: false
})

// Generate an invite
const inviteCode = await room.createInvite()
console.log('Share this invite:', inviteCode)
```

### Joining a Room

```javascript
// Join a room using an invite
const joinedRoom = await user.joinRoom(inviteCode)
```

### Sending Messages

```javascript
// Send a message to a specific channel
const channel = room.channels.find(c => c.name === 'general')
await channel.sendMessage('Hello, Gigachat world!')
```

## 📦 Core Modules

### Gigauser
- Manages user identity
- Handles device synchronization
- Manages rooms and settings
- Provides key derivation and recovery mechanisms

### GigaRoom
- Represents a chat room/community
- Manages members, channels, and permissions
- Handles message and file sharing
- Supports room-level encryption

## 🔑 Key Concepts

### Seed Phrase Authentication
- Users are identified by a 20-word seed phrase
- Seed generates cryptographic keys deterministically
- Enables secure device recovery and pairing

### Blind Pairing
- Secure mechanism for adding devices and joining rooms
- Cryptographically verified invite system
- No central authority required

## 🛡️ Security Model

- End-to-end encryption
- Cryptographic signatures for message authenticity
- Deterministic key generation
- No centralized data storage
- Optional room-level encryption

## 📝 Advanced Usage

### Device Pairing

```javascript
// Create a pairing invite on the first device
const inviteCode = await user.createPairingInvite()

// Pair a new device using the invite
const newDevice = await Gigauser.pairDevice(newStore, inviteCode)
```

### Room Permissions

```javascript
// Create a role
const adminRole = await room.createRole({
  name: 'Admin',
  permissions: ['manage_room', 'kick_members']
})

// Add a member with a specific role
await room.addMember(userPublicKey, { roles: ['admin'] })
```

## 🔮 Future Roadmap

- Enhanced end-to-end encryption
- Advanced moderation tools
- Voice and video chat
- Enhanced file sharing
- Cross-platform support

## 🤝 Contributing

Contributions are welcome! Please check out our contribution guidelines.

## 📄 License

MIT License

## 💡 Powered By
- Hypercore Protocol
- Autobase
- Hyperswarm
- Corestore
