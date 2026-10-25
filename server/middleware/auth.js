const { getSupabaseClient } = require("../config/supabase");
const { verifyAccessToken } = require("../services/tokenService");

const USER_CACHE_TTL_MS = 30 * 1000; // 30 seconds
const MAX_CACHE_ENTRIES = 500;
const userCache = new Map();

function getCachedUser(userId) {
  const entry = userCache.get(userId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    userCache.delete(userId);
    return null;
  }
  return entry.user;
}

function setCachedUser(userId, user) {
  if (userCache.has(userId)) {
    userCache.delete(userId);
  } else if (userCache.size >= MAX_CACHE_ENTRIES) {
    // Evict oldest entry (Map iterates in insertion order)
    const oldestKey = userCache.keys().next().value;
    if (oldestKey) userCache.delete(oldestKey);
  }
  userCache.set(userId, {
    user,
    expiresAt: Date.now() + USER_CACHE_TTL_MS,
  });
}

function invalidateUserCache(userId) {
  if (userId) {
    userCache.delete(String(userId));
  }
}

function clearUserCache() {
  userCache.clear();
}

// Bounded sweep every 60 seconds to clean expired cache entries
const cacheSweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of userCache.entries()) {
    if (now > entry.expiresAt) {
      userCache.delete(key);
    }
  }
}, 60 * 1000);
if (cacheSweeper.unref) {
  cacheSweeper.unref();
}

function auth(allowedRoles = []) {
  const ALLOWED = allowedRoles.map((r) => String(r).toUpperCase());

  return async (req, res, next) => {
    try {
      const header = req.headers?.authorization;
      if (!header || !header.startsWith("Bearer ")) {
        return res.status(401).json({ ok: false, code: "UNAUTHORIZED", error: "Unauthorized" });
      }

      const token = header.split(" ")[1];
      if (!token) {
        return res.status(401).json({ ok: false, code: "UNAUTHORIZED", error: "Unauthorized" });
      }

      let decoded;
      try {
        decoded = verifyAccessToken(token);
      } catch {
        return res.status(401).json({ ok: false, code: "INVALID_TOKEN", error: "Invalid token" });
      }

      const { id, role } = decoded;
      const supabase = getSupabaseClient();
      if (!supabase) {
        return res.status(503).json({ ok: false, error: "Database unavailable" });
      }

      const userIdStr = String(id);
      let user = getCachedUser(userIdStr);

      if (!user) {
        if (role === "ADMIN") {
          const { data, error } = await supabase
            .from("admins")
            .select("id, name, email, college_name, created_at")
            .eq("id", userIdStr)
            .maybeSingle();

          if (error) {
            invalidateUserCache(userIdStr);
            return res.status(401).json({ ok: false, code: "UNAUTHORIZED", error: "Authentication failed" });
          }
          user = data;
        } else if (role === "FACULTY") {
          const { data, error } = await supabase
            .from("faculties")
            .select(
              "id, name, email, department, device_fingerprint, device_lock_enabled, " +
              "profile_photo_url, created_by_admin, allotted_subjects, " +
              "credential_id, public_key, counter"
            )
            .eq("id", userIdStr)
            .maybeSingle();

          if (error) {
            invalidateUserCache(userIdStr);
            return res.status(401).json({ ok: false, code: "UNAUTHORIZED", error: "Authentication failed" });
          }
          user = data;
        } else if (role === "STUDENT") {
          const { data, error } = await supabase
            .from("students")
            .select(
              "id, name, email, enrollment_no, year, semester, section, department, " +
              "device_fingerprint, college_name, profile_photo_url, " +
              "created_by_admin, credential_id, public_key, counter, " +
              "face_signature, face_signature_mirror, face_signature_version, " +
              "face_embedding, face_embedding_model, face_embedding_version"
            )
            .eq("id", userIdStr)
            .maybeSingle();

          if (error) {
            invalidateUserCache(userIdStr);
            return res.status(401).json({ ok: false, code: "UNAUTHORIZED", error: "Authentication failed" });
          }
          user = data;
        }

        if (!user) {
          invalidateUserCache(userIdStr);
          return res.status(401).json({ ok: false, code: "UNAUTHORIZED", error: "User not found or account deactivated" });
        }

        // Cache a clone of the DB user row
        setCachedUser(userIdStr, { ...user });
      }

      // Clone user so mutations to req.user do not taint the cached object
      const userObj = { ...user };
      userObj._id = userObj.id;
      userObj.departmentId = userObj.department || null;
      userObj.department_id = userObj.department || null;
      userObj.createdByAdmin = userObj.created_by_admin || null;
      userObj.collegeName = userObj.college_name || null;
      userObj.profilePhotoUrl = userObj.profile_photo_url || null;
      userObj.enrollmentNo = userObj.enrollment_no || null;
      userObj.deviceFingerprint = userObj.device_fingerprint || null;
      userObj.deviceLockEnabled = userObj.device_lock_enabled !== false;
      userObj.allottedSubjects = userObj.allotted_subjects || [];
      userObj.year = userObj.year != null ? Number(userObj.year) : null;
      userObj.semester = userObj.semester != null ? Number(userObj.semester) : null;
      userObj.section = userObj.section || null;

      if (ALLOWED.length > 0 && !ALLOWED.includes(role)) {
        return res.status(403).json({ ok: false, code: "FORBIDDEN", error: "Access forbidden for this user role" });
      }

      req.user = userObj;
      req.userRole = role;
      req.userId = String(userObj.id);
      next();
    } catch {
      return res.status(401).json({ ok: false, code: "UNAUTHORIZED", error: "Authentication failed" });
    }
  };
}

auth.invalidateUserCache = invalidateUserCache;
auth.clearUserCache = clearUserCache;
auth.userCache = userCache;

module.exports = auth;
