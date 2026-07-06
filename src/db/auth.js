// src/db/auth.js
const crypto = require('crypto');

/**
 * Hash a password using crypto.scrypt
 * @param {string} password - The plain password
 * @returns {Promise<{hash: string, salt: string}>}
 */
function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      resolve({
        hash: derivedKey.toString('hex'),
        salt: salt
      });
    });
  });
}

/**
 * Verify a password against a hash and salt
 * @param {string} password - The plain password
 * @param {string} hash - The saved hash
 * @param {string} salt - The saved salt
 * @returns {Promise<boolean>}
 */
function verifyPassword(password, hash, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(derivedKey.toString('hex') === hash);
    });
  });
}

module.exports = {
  hashPassword,
  verifyPassword
};
