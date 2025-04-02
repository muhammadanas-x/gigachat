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
  };

  return b4a.from(JSON.stringify(signable));
}

/**
 * Sign a message
 * @param {object} message - Message object
 * @param {Buffer} privateKey - Private key
 * @returns {object} - Message with signature
 */
function signMessage(message, privateKey) {
  const messageData = prepareMessageForSigning(message);
  message.signature = sign(messageData, privateKey);
  return message;
}

/**
 * Verify a message signature
 * @param {object} message - Message with signature
 * @returns {boolean} - Whether the signature is valid
 */
function verifySignature(message) {
  try {
    const messageData = prepareMessageForSigning(message);
    return verify(messageData, message.signature, message.author);
  } catch (error) {
    return false;
  }
}

module.exports = {
  sign,
  verify,
  hash,
  prepareMessageForSigning,
  signMessage,
  verifySignature
};
