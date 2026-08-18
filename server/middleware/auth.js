const { getSupabaseClient } = require("../config/supabase");
const { verifyAccessToken } = require("../services/tokenService");

function auth(allowedRoles = []) {
  const ALLOWED = allowedRoles.map((r) => String(r).toUpperCase());

  return async (req, res, next) => {
    try {
      const header = req.headers?.authorization;
      if (!header || !header.startsWith("Bearer ")) {
        return res.status(401).json({ ok: false, error: "Unauthorized" });
      }

      const token = header.split(" ")[1];
      if (!token) {
        return res.status(401).json({ ok: false, error: "Unauthorized" });
      }

      let decoded;
      try {
        decoded = verifyAccessToken(token);
      } catch {
        return res.status(401).json({ ok: false, error: "Invalid token" });
      }

      const { id, role } = decoded;
      const supabase = getSupabaseClient();
      if (!supabase) {
        return res.status(503).json({ ok: false, error: "Database unavailable" });
      }

      let user = null;
      if (role === "ADMIN") {
        const { data } = await supabase.from("admins").select("*").eq("id", String(id)).single();
        user = data;
      } else if (role === "FACULTY") {
        const { data } = await supabase.from("faculties").select("*").eq("id", String(id)).single();
        user = data;
      } else if (role === "STUDENT") {
        const { data } = await supabase.from("students").select("*").eq("id", String(id)).single();
        user = data;
      }

      if (!user) {
        return res.status(401).json({ ok: false, error: "Unauthorized" });
      }

      user._id = user.id;
      user.createdByAdmin = user.created_by_admin || null;
      user.collegeName = user.college_name || null;
      user.profilePhotoUrl = user.profile_photo_url || null;
      user.enrollmentNo = user.enrollment_no || null;
      user.deviceFingerprint = user.device_fingerprint || null;
      user.deviceLockEnabled = user.device_lock_enabled !== false;

      if (ALLOWED.length > 0 && !ALLOWED.includes(role)) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }

      req.user = user;
      req.userRole = role;
      req.userId = String(user.id);
      next();
    } catch {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
  };
}

module.exports = auth;
