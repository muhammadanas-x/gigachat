/**
 * UserManager Module - Device-syncable user management with blind pairing
 * @module user-manager
 */

const UserManager = require('./user-manager')
const UserPairer = require('./user-pairer')

module.exports = {
  UserManager,
  UserPairer
}
