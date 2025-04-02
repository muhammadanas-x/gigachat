/**
 * Cryptographic utilities for Gigachat
 * @module crypto
 */

const crypto = require('crypto');
const b4a = require('b4a');

/**
 * Sign data with a private key
 * @param {Buffer|string} data - Data to sign
 * @param {Buffer} privateKey - Private key
 * @returns {Buffer} - Signature
 */
function sign(data, privateKey) {
  const dataBuffer = typeof data === 'string' ? b4a.from(data) : data;

  // In a production implementation, this would use proper Ed25519 signatures
  // This is a placeholder that simulates signing
  const signature = crypto.createHmac('sha256', privateKey)
    .update(dataBuffer)
    .digest();

  return signature;
}

/**
 * Verify a signature
 * @param {Buffer|string} data - Original data
 * @param {Buffer} signature - Signature to verify
 * @param {Buffer} publicKey - Public key
 * @returns {boolean} - Whether the signature is valid
 */
function verify(data, signature, publicKey) {
  const dataBuffer = typeof data === 'string' ? b4a.from(data) : data;

  // In a production implementation, this would verify Ed25519 signatures
  // This is a placeholder that simulates verification
  const expectedSignature = crypto.createHmac('sha256', publicKey)
    .update(dataBuffer)
    .digest();

  return b4a.equals(signature, expectedSignature);
}

/**
 * Generate a hash of data
 * @param {Buffer|string} data - Data to hash
 * @returns {Buffer} - Hash value
 */
function hash(data) {
  const dataBuffer = typeof data === 'string' ? b4a.from(data) : data;
  return crypto.createHash('sha256').update(dataBuffer).digest();
}

/**
 * Cryptographic utilities for Gigachat
 * 
 * This module provides cryptographic functions for signing, verifying,
 * and hashing data.
 * 
 * Note: In a production environment, these functions should be replaced
 * with proper Ed25519 implementations. The current implementation uses
 * HMAC-SHA256 for simplicity.
 * 
 * @module crypto
 */

const crypto = require('crypto')
const b4a = require('b4a')

/**
 * Generate a deterministic key from a seed
 * @param {string|Buffer} seed - Seed for key generation
 * @returns {Buffer} - Generated key
 */
function generateKeyFromSeed(seed) {
  const seedBuffer = typeof seed === 'string' ? b4a.from(seed) : seed
  return crypto.createHash('sha256').update(seedBuffer).digest()
}

/**
 * Sign data with a private key
 * @param {Buffer|string} data - Data to sign
 * @param {Buffer} privateKey - Private key
 * @returns {Buffer} - Signature
 */
function sign(data, privateKey) {
  const dataBuffer = typeof data === 'string' ? b4a.from(data) : data

  // In a production implementation, this would use proper Ed25519 signatures
  // This is a placeholder that simulates signing
  return crypto.createHmac('sha256', privateKey)
    .update(dataBuffer)
    .digest()
}

/**
 * Verify a signature
 * @param {Buffer|string} data - Original data
 * @param {Buffer} signature - Signature to verify
 * @param {Buffer} publicKey - Public key
 * @returns {boolean} - Whether the signature is valid
 */
function verify(data, signature, publicKey) {
  const dataBuffer = typeof data === 'string' ? b4a.from(data) : data

  // In a production implementation, this would verify Ed25519 signatures
  // This is a placeholder that simulates verification
  const expectedSignature = crypto.createHmac('sha256', publicKey)
    .update(dataBuffer)
    .digest()

  return b4a.equals(signature, expectedSignature)
}

/**
 * Generate a hash of data
 * @param {Buffer|string} data - Data to hash
 * @returns {Buffer} - Hash value
 */
function hash(data) {
  const dataBuffer = typeof data === 'string' ? b4a.from(data) : data
  return crypto.createHash('sha256').update(dataBuffer).digest()
}

/**
 * Prepare a message for signing
 * @param {object} message - Message object
 * @returns {Buffer} - Prepared message buffer
 */
function prepareMessageForSigning(message) {
  // Create a deterministic representation of the message
  const signable = {
    id: message.id,
    type: message.type,
    content: message.content,
    author: message.author,
    timestamp: message.timestamp,
    references: message.references,
    metadata: message.metadata
  }

  return b4a.from(JSON.stringify(signable))
}

/**
 * Sign a message
 * @param {object} message - Message object
 * @param {Buffer} privateKey - Private key
 * @returns {object} - Message with signature
 */
function signMessage(message, privateKey) {
  const messageData = prepareMessageForSigning(message)
  message.signature = sign(messageData, privateKey)
  return message
}

/**
 * Verify a message signature
 * @param {object} message - Message with signature
 * @param {Buffer} publicKey - Public key to verify against (optional if message contains author)
 * @returns {boolean} - Whether the signature is valid
 */
function verifyMessage(message, publicKey) {
  try {
    if (!message.signature) return false

    const messageData = prepareMessageForSigning(message)
    const authorKey = publicKey || message.author

    if (!authorKey) return false

    return verify(messageData, message.signature, authorKey)
  } catch (error) {
    console.error('Error verifying message signature:', error)
    return false
  }
}

/**
 * Generate a random seed phrase (20 words)
 * @returns {string} - Space-separated random words
 */
function generateSeed() {
  // Simple word list for demonstration
  const wordList = [
    'apple', 'banana', 'cherry', 'date', 'elder', 'fig', 'grape', 'hemp',
    'ivy', 'juniper', 'kiwi', 'lemon', 'mango', 'nectarine', 'orange',
    'pear', 'quince', 'raspberry', 'strawberry', 'tangerine', 'ugli',
    'vanilla', 'walnut', 'xigua', 'yam', 'zucchini', 'acorn', 'bean',
    'carrot', 'daikon', 'eggplant', 'fennel', 'garlic', 'horseradish',
    'iceberg', 'jalapeno', 'kale', 'leek', 'mushroom', 'nettle', 'okra',
    'potato', 'quinoa', 'radish', 'spinach', 'turnip', 'ulluco', 'viburnum',
    'wasabi', 'ximenia', 'yarrow', 'zinnia'
  ]

  // Generate 20 random words
  const entropy = crypto.randomBytes(20)
  const words = []

  for (let i = 0; i < 20; i++) {
    const index = entropy[i] % wordList.length
    words.push(wordList[index])
  }

  return words.join(' ')
}

module.exports = {
  generateKeyFromSeed,
  sign,
  verify,
  hash,
  prepareMessageForSigning,
  signMessage,
  verifyMessage,
  generateSeed
}
