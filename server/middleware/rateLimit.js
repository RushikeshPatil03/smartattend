const memoryBuckets = new Map();
const CLEANUP_INTERVAL_MS = 30000;

// Periodic cleanup of expired rate limit buckets (every 30 seconds)
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of memoryBuckets.entries()) {
    if (!bucket || bucket.resetAt <= now) {
      memoryBuckets.delete(key);
    }
  }
}, CLEANUP_INTERVAL_MS);

// Allow Node.js process to exit cleanly without waiting for this background timer
if (cleanupTimer.unref) {
  cleanupTimer.unref();
}

function getClientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function rateLimit(options = {}) {
  const windowMs = Number(options.windowMs || 60000);
  const max = Number(options.max || 60);
  const prefix = options.prefix || "route";
  const keyFn =
    options.key ||
    ((req) => req.userId || req.user?._id || req.user?.id || getClientIp(req));

  return function rateLimitMiddleware(req, res, next) {
    try {
      const identity = String(keyFn(req) || "anonymous");
      const key = `rate:${prefix}:${identity}`;

      const now = Date.now();
      let bucket = memoryBuckets.get(key);

      if (!bucket || bucket.resetAt <= now) {
        bucket = {
          count: 1,
          resetAt: now + windowMs,
        };
        memoryBuckets.set(key, bucket);
        return next();
      }

      bucket.count += 1;

      if (bucket.count > max) {
        const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
        res.setHeader("Retry-After", String(retryAfterSeconds));
        return res.status(429).json({
          ok: false,
          error: "Too many attempts. Please wait and try again.",
        });
      }

      return next();
    } catch {
      return next();
    }
  };
}

module.exports = rateLimit;
