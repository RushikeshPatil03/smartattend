const { getSupabaseClient } = require("../config/supabase");
const { verifyAccessToken } = require("../services/tokenService");

module.exports = async function adminAuth(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const token = header.split(" ")[1];

    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch {
      return res.status(401).json({ ok: false, error: "Invalid token" });
    }

    if (!decoded || decoded.role !== "ADMIN" || !decoded.id) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      return res.status(503).json({ ok: false, error: "Database service unavailable" });
    }

    const { data: admin } = await supabase
      .from("admins")
      .select("*")
      .eq("id", String(decoded.id))
      .single();

    if (!admin) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    admin._id = admin.id;
    admin.collegeName = admin.college_name || null;
    admin.profilePhotoUrl = admin.profile_photo_url || null;

    req.admin = admin;
    req.user = admin;
    req.userRole = "ADMIN";
    req.userId = String(admin.id);

    next();
  } catch (err) {
    console.error("adminAuth error:", err);
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
};
