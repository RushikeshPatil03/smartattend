/**
 * Resilient Redis & In-Memory Hybrid Distributed State Provider
 * 
 * Provides high-performance distributed synchronization across PM2 cluster instances
 * or container replicas while guaranteeing seamless in-memory fallback if Redis is unavailable.
 * 
 * Distributed Primitives:
 *  1. Single-Use Grants (Anti-replay single-use tokens for scan & face verification)
 *  2. Distributed In-Flight Mutex Locks (Atomic NX lock with auto-expiry)
 *  3. Distributed Active Session Cache (Short TTL cache to relieve DB pressure)
 */

const crypto = require("crypto");
const Redis = require("ioredis");
const env = require("../config/env");

// Atomic GET and DELETE Lua Script (Ensures single-use grant consumption across all Redis versions)
const GET_DEL_LUA = `
local val = redis.call('GET', KEYS[1])
if val then
  redis.call('DEL', KEYS[1])
  return val
else
  return nil
end
`;

class HybridStateStore {
  constructor() {
    this.redis = null;
    this.isRedisReady = false;

    // High-performance in-memory fallback stores
    this.grantsMemoryStore = new Map();
    this.locksMemoryStore = new Map();
    this.sessionCache = new Map();

    this.initRedis();
    this.startMemorySweeper();
  }

  initRedis() {
    const redisUrl = process.env.REDIS_URL || env.REDIS_URL;
    if (!redisUrl) {
      console.log("[StateStore] REDIS_URL not configured. Operating in high-speed in-memory hybrid mode.");
      return;
    }

    try {
      this.redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        enableReadyCheck: false,
        lazyConnect: true,
        connectTimeout: 5000,
        retryStrategy(times) {
          // Exponential backoff capped at 3s
          return Math.min(times * 200, 3000);
        },
      });

      this.redis.on("connect", () => {
        this.isRedisReady = true;
        console.log("[StateStore] Redis connection established.");
      });

      this.redis.on("ready", () => {
        this.isRedisReady = true;
      });

      this.redis.on("error", (err) => {
        this.isRedisReady = false;
        console.warn("[StateStore] Redis connection warning (falling back to memory):", err?.message || err);
      });

      this.redis.on("close", () => {
        this.isRedisReady = false;
      });

      this.redis.on("reconnecting", () => {
        this.isRedisReady = false;
      });

      // Connect asynchronously without blocking application initialization
      this.redis.connect().catch((err) => {
        this.isRedisReady = false;
        console.warn("[StateStore] Redis initial connection failed, running on memory fallback:", err?.message || err);
      });
    } catch (err) {
      this.redis = null;
      this.isRedisReady = false;
      console.warn("[StateStore] Failed to initialize ioredis client (using in-memory store):", err?.message || err);
    }
  }

  sweepMemoryStore() {
    const now = Date.now();
    for (const [key, value] of this.grantsMemoryStore.entries()) {
      if (!value || Number(value.expiresAt || 0) <= now || value.consumed) {
        this.grantsMemoryStore.delete(key);
      }
    }
    for (const [key, expiresAt] of this.locksMemoryStore.entries()) {
      if (!expiresAt || Number(expiresAt || 0) <= now) {
        this.locksMemoryStore.delete(key);
      }
    }
    for (const [key, cached] of this.sessionCache.entries()) {
      if (!cached || Number(cached.expiresAt || 0) <= now) {
        this.sessionCache.delete(key);
      }
    }
  }

  startMemorySweeper() {
    // Background sweeper to prevent memory leaks in standalone or fallback mode
    this.sweeperInterval = setInterval(() => {
      try {
        this.sweepMemoryStore();
      } catch (err) {
        console.warn("[StateStore] Memory sweeper warning:", err?.message || err);
      }
    }, 30000);

    if (this.sweeperInterval.unref) {
      this.sweeperInterval.unref();
    }
  }

  isRedisConnected() {
    return Boolean(this.redis && this.isRedisReady);
  }

  // ----------------------------------------------------
  // DISTRIBUTED MUTEX LOCKS
  // ----------------------------------------------------

  /**
   * Atomically acquires an in-flight lock for student + session.
   * Prevents concurrent double-submissions from hitting database across PM2 cluster workers.
   * @param {string} lockKey
   * @param {number} ttlMs
   * @returns {Promise<boolean>}
   */
  async acquireLock(lockKey, ttlMs = 5000) {
    const fullKey = `lock:${lockKey}`;

    if (this.isRedisConnected()) {
      try {
        const res = await this.redis.set(fullKey, "1", "PX", ttlMs, "NX");
        return res === "OK";
      } catch (err) {
        console.warn("[StateStore] Redis acquireLock error, falling back to memory:", err?.message || err);
      }
    }

    // In-Memory Fallback
    const now = Date.now();
    const existingExpiry = this.locksMemoryStore.get(fullKey);
    if (existingExpiry && existingExpiry > now) {
      return false;
    }
    this.locksMemoryStore.set(fullKey, now + ttlMs);
    return true;
  }

  /**
   * Releases an acquired lock immediately.
   * @param {string} lockKey
   * @returns {Promise<void>}
   */
  async releaseLock(lockKey) {
    const fullKey = `lock:${lockKey}`;
    this.locksMemoryStore.delete(fullKey);

    if (this.isRedisConnected()) {
      try {
        await this.redis.del(fullKey);
      } catch (err) {
        console.warn("[StateStore] Redis releaseLock error:", err?.message || err);
      }
    }
  }

  // ----------------------------------------------------
  // SINGLE-USE SCAN GRANTS
  // ----------------------------------------------------

  /**
   * Saves a single-use scan grant.
   */
  async saveScanGrant({ token, studentId, sessionId, fingerprint, ttlMs = 90000 }) {
    const expiresAt = Date.now() + ttlMs;
    const grant = {
      token: String(token),
      studentId: String(studentId),
      sessionId: String(sessionId),
      fingerprint: String(fingerprint),
      consumed: false,
      createdAt: Date.now(),
      expiresAt,
    };
    const key = `grant:scan:${token}`;
    const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));

    // Store in memory fallback as well for seamless fallback
    this.grantsMemoryStore.set(key, grant);

    if (this.isRedisConnected()) {
      try {
        await this.redis.set(key, JSON.stringify(grant), "EX", ttlSeconds);
      } catch (err) {
        console.warn("[StateStore] Redis saveScanGrant error (cached in memory):", err?.message || err);
      }
    }

    return grant;
  }

  /**
   * Atomically consumes a single-use scan grant with anti-replay guarantees.
   */
  async consumeScanGrant({ token, studentId, sessionId, fingerprint }) {
    if (!token) {
      return { ok: false, error: "Scan grant token is required" };
    }
    const key = `grant:scan:${token}`;
    let grant = null;

    if (this.isRedisConnected()) {
      try {
        const raw = await this.redis.eval(GET_DEL_LUA, 1, key);
        if (raw) {
          grant = JSON.parse(raw);
          this.grantsMemoryStore.delete(key);
        }
      } catch (err) {
        console.warn("[StateStore] Redis consumeScanGrant error, checking memory:", err?.message || err);
      }
    }

    // If not found in Redis (or Redis offline/errored), check memory store
    if (!grant) {
      const memGrant = this.grantsMemoryStore.get(key);
      if (memGrant) {
        this.grantsMemoryStore.delete(key);
        grant = memGrant;
      }
    }

    if (!grant || grant.consumed || Number(grant.expiresAt || 0) < Date.now()) {
      return { ok: false, error: "Scan grant invalid or expired" };
    }

    if (
      grant.studentId !== String(studentId) ||
      grant.sessionId !== String(sessionId) ||
      grant.fingerprint !== String(fingerprint)
    ) {
      return { ok: false, error: "Scan grant context mismatch" };
    }

    return { ok: true, grant };
  }

  // ----------------------------------------------------
  // SINGLE-USE FACE VERIFICATION GRANTS
  // ----------------------------------------------------

  /**
   * Saves a single-use face verification grant.
   */
  async saveFaceGrant({
    token = null,
    studentId,
    sessionId = null,
    fingerprint = null,
    score = 1.0,
    method = "client-faceapi",
    ttlMs = 90000,
  }) {
    const grantToken = token || crypto.randomBytes(24).toString("hex");
    const expiresAt = Date.now() + ttlMs;
    const grant = {
      token: grantToken,
      studentId: String(studentId),
      sessionId: sessionId ? String(sessionId) : null,
      fingerprint: fingerprint ? String(fingerprint) : null,
      score: Number(score) || 1.0,
      method: String(method || "client-faceapi"),
      consumed: false,
      createdAt: Date.now(),
      expiresAt,
    };
    const key = `grant:face:${grantToken}`;
    const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));

    this.grantsMemoryStore.set(key, grant);

    if (this.isRedisConnected()) {
      try {
        await this.redis.set(key, JSON.stringify(grant), "EX", ttlSeconds);
      } catch (err) {
        console.warn("[StateStore] Redis saveFaceGrant error (cached in memory):", err?.message || err);
      }
    }

    return grant;
  }

  /**
   * Atomically consumes a single-use face grant with anti-replay guarantees.
   */
  async consumeFaceGrant({ token, studentId, sessionId, fingerprint }) {
    if (!token) {
      return {
        ok: false,
        code: "MISSING_FACE_GRANT",
        error: "Face verification grant token is required",
      };
    }
    const key = `grant:face:${token}`;
    let grant = null;

    if (this.isRedisConnected()) {
      try {
        const raw = await this.redis.eval(GET_DEL_LUA, 1, key);
        if (raw) {
          grant = JSON.parse(raw);
          this.grantsMemoryStore.delete(key);
        }
      } catch (err) {
        console.warn("[StateStore] Redis consumeFaceGrant error, checking memory:", err?.message || err);
      }
    }

    if (!grant) {
      const memGrant = this.grantsMemoryStore.get(key);
      if (memGrant) {
        this.grantsMemoryStore.delete(key);
        grant = memGrant;
      }
    }

    if (!grant || grant.consumed || Number(grant.expiresAt || 0) < Date.now()) {
      return {
        ok: false,
        code: "INVALID_FACE_GRANT",
        error: "Face verification grant expired or invalid. Please verify face again.",
      };
    }

    if (grant.studentId !== String(studentId)) {
      return {
        ok: false,
        code: "FACE_GRANT_STUDENT_MISMATCH",
        error: "Face verification grant does not belong to this student",
      };
    }

    if (grant.fingerprint && fingerprint && grant.fingerprint !== String(fingerprint)) {
      return {
        ok: false,
        code: "FACE_GRANT_DEVICE_MISMATCH",
        error: "Face verification grant used on an unauthorized device",
      };
    }

    if (grant.sessionId && sessionId && grant.sessionId !== String(sessionId)) {
      return {
        ok: false,
        code: "FACE_GRANT_SESSION_MISMATCH",
        error: "Face verification grant was issued for a different session",
      };
    }

    return { ok: true, grant };
  }

  // ----------------------------------------------------
  // ACTIVE SESSION CACHE
  // ----------------------------------------------------

  /**
   * Caches active session metadata across cluster nodes with a short TTL (5–10s).
   */
  async setCachedSession(sessionId, session, ttlSeconds = 10) {
    if (!sessionId || !session) return;
    const sid = String(sessionId);
    const key = `session:${sid}`;
    const now = Date.now();
    const ttlMs = ttlSeconds * 1000;

    // Local LRU micro-cache
    if (this.sessionCache.size >= 200) {
      const oldestKey = this.sessionCache.keys().next().value;
      if (oldestKey) this.sessionCache.delete(oldestKey);
    }
    this.sessionCache.set(sid, { session, expiresAt: now + ttlMs, cachedAt: now });

    if (this.isRedisConnected()) {
      try {
        await this.redis.set(key, JSON.stringify(session), "EX", ttlSeconds);
      } catch (err) {
        console.warn("[StateStore] Redis setCachedSession warning:", err?.message || err);
      }
    }
  }

  /**
   * Retrieves active session metadata from local memory or distributed Redis.
   */
  async getCachedSession(sessionId) {
    if (!sessionId) return null;
    const sid = String(sessionId);
    const now = Date.now();

    // Check local memory first (0ms hit)
    const local = this.sessionCache.get(sid);
    if (local && local.expiresAt > now) {
      return local.session;
    }

    // Check Redis across cluster
    if (this.isRedisConnected()) {
      try {
        const raw = await this.redis.get(`session:${sid}`);
        if (raw) {
          const session = JSON.parse(raw);
          this.sessionCache.set(sid, { session, expiresAt: now + 5000, cachedAt: now });
          return session;
        }
      } catch (err) {
        console.warn("[StateStore] Redis getCachedSession warning:", err?.message || err);
      }
    }

    return null;
  }

  /**
   * Invalidates cached session metadata locally and across Redis.
   */
  invalidateCachedSession(sessionId) {
    if (!sessionId) return;
    const sid = String(sessionId);
    this.sessionCache.delete(sid);

    if (this.isRedisConnected()) {
      this.redis.del(`session:${sid}`).catch((err) => {
        console.warn("[StateStore] Redis invalidateCachedSession warning:", err?.message || err);
      });
    }
  }

  // ----------------------------------------------------
  // CLEANUP & LIFECYCLE
  // ----------------------------------------------------

  /**
   * Closes the Redis connection cleanly during graceful shutdown.
   */
  async close() {
    if (this.sweeperInterval) {
      clearInterval(this.sweeperInterval);
    }
    if (this.redis) {
      try {
        await this.redis.quit();
        console.log("[StateStore] Redis connection closed gracefully.");
      } catch (err) {
        try {
          this.redis.disconnect();
        } catch {}
      } finally {
        this.isRedisReady = false;
        this.redis = null;
      }
    }
  }
}

// Singleton state store instance
const stateStore = new HybridStateStore();

module.exports = stateStore;
module.exports.HybridStateStore = HybridStateStore;
