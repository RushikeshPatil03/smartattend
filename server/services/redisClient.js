/**
 * Redis Client Stub for backward compatibility
 * All state is now handled by Supabase and in-memory caches.
 */

async function getRedisClient() {
  return null;
}

async function requireRedisClient() {
  return null;
}

async function createRedisDuplicate() {
  return null;
}

function shouldUseRedis() {
  return false;
}

function isRedisRequired() {
  return false;
}

function keyWithPrefix(key) {
  return String(key);
}

module.exports = {
  getRedisClient,
  requireRedisClient,
  createRedisDuplicate,
  shouldUseRedis,
  isRedisRequired,
  keyWithPrefix,
};
