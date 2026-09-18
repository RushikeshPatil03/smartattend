// server/services/authService.js
let bcrypt;
try {
  bcrypt = require("bcrypt"); // High-speed C++ binding using libuv threadpool
} catch {
  bcrypt = require("bcryptjs"); // Pure JS fallback
}
let argon2 = null;
try {
  argon2 = require("argon2");
} catch {
  // argon2 is optional; falls back cleanly to bcrypt
}

/**
 * Non-blocking password verification.
 * Automatically detects argon2 or bcrypt hashes.
 */
async function verifyUserPassword(plainPassword, storedHash) {
  if (!plainPassword || !storedHash) return false;
  const passwordStr = String(plainPassword);
  const hashStr = String(storedHash);

  // 1. Argon2 support if hash starts with $argon2 and package exists
  if (hashStr.startsWith("$argon2") && argon2) {
    try {
      return await argon2.verify(hashStr, passwordStr);
    } catch (err) {
      console.error("Argon2 verification failed:", err?.message || err);
      return false;
    }
  }

  // 2. Multi-threaded Bcrypt comparison (runs on libuv threadpool)
  return new Promise((resolve) => {
    bcrypt.compare(passwordStr, hashStr, (err, isMatch) => {
      if (err) {
        // Safe fallback to bcryptjs if native addon encounters an error
        try {
          const bcryptjs = require("bcryptjs");
          bcryptjs.compare(passwordStr, hashStr, (fallbackErr, fallbackMatch) => {
            if (fallbackErr) return resolve(false);
            resolve(Boolean(fallbackMatch));
          });
        } catch {
          resolve(false);
        }
        return;
      }
      resolve(Boolean(isMatch));
    });
  });
}

/**
 * Non-blocking password hashing with optimal 10 salt rounds.
 */
async function hashUserPassword(plainPassword) {
  const passwordStr = String(plainPassword);
  return new Promise((resolve, reject) => {
    bcrypt.hash(passwordStr, 10, (err, hash) => {
      if (err) return reject(err);
      resolve(hash);
    });
  });
}

module.exports = {
  verifyUserPassword,
  hashUserPassword,
};
