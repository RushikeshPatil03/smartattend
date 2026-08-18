const memoryBuckets = new Map();

function cleanupMemoryBuckets() {
  const now = Date.now();
  for (const [key, bucket] of memoryBuckets.entries()) {
    if (!bucket || bucket.resetAt <= now) {
      memoryBuckets.delete(key);
    }
  }
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

      cleanupMemoryBuckets();
      const now = Date.now();
      const bucket = memoryBuckets.get(key) || {
        count: 0,
        resetAt: now + windowMs,
      };

      if (bucket.resetAt <= now) {
        bucket.count = 0;
        bucket.resetAt = now + windowMs;
      }

      bucket.count += 1;
      memoryBuckets.set(key, bucket);

      if (bucket.count > max) {
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
