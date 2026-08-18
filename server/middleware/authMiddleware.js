const { getSupabaseClient } = require("../config/supabase");
const { verifyAccessToken } = require("../services/tokenService");

function bearerToken(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return "";
  return header.split(" ")[1] || "";
}

module.exports = async function authMiddleware(req, res, next) {
  try {
    const token = bearerToken(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch {
      return res.status(401).json({ ok: false, error: "Invalid token" });
    }

    if (!decoded || !decoded.id || !decoded.role) {
      return res.status(401).json({ ok: false, error: "Invalid token payload" });
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      return res.status(503).json({ ok: false, error: "Database service unavailable" });
    }

    let user = null;
    const userId = String(decoded.id);

    switch (decoded.role) {
      case "ADMIN": {
        const { data } = await supabase.from("admins").select("*").eq("id", userId).single();
        user = data;
        break;
      }
      case "FACULTY": {
        const { data } = await supabase.from("faculties").select("*").eq("id", userId).single();
        user = data;
        break;
      }
      case "STUDENT": {
        const { data } = await supabase.from("students").select("*").eq("id", userId).single();
        user = data;
        break;
      }
      default:
        return res.status(401).json({ ok: false, error: "Unauthorized role" });
    }

    if (!user) {
      return res.status(401).json({ ok: false, error: "User not found" });
    }

    // Map snake_case to camelCase & provide dual _id and id
    user._id = user.id;
    user.createdByAdmin = user.created_by_admin || null;
    user.collegeName = user.college_name || null;
    user.profilePhotoUrl = user.profile_photo_url || null;
    user.enrollmentNo = user.enrollment_no || null;
    user.deviceFingerprint = user.device_fingerprint || null;
    user.deviceLockEnabled = user.device_lock_enabled !== false;
    user.allottedSubjects = user.allotted_subjects || [];

    req.user = user;
    req.userRole = decoded.role;
    req.userId = String(user.id);

    next();
  } catch (err) {
    console.error("Auth middleware error:", err);
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
};
