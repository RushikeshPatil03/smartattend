const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const crypto = require("crypto");
const { getSupabaseClient } = require("../config/supabase");
const rateLimit = require("../middleware/rateLimit");
const authMiddleware = require("../middleware/authMiddleware");
const env = require("../config/env");
const {
  issueTokenPair,
  rotateRefreshToken,
  revokeRefreshToken,
} = require("../services/tokenService");

const {
  normalizeFingerprint,
  legacyFingerprintHash,
} = require("../services/deviceFingerprint");

const DEVICE_CHANGE_REQUEST_TTL_MS = 24 * 60 * 60 * 1000;
const DEVICE_CHANGE_VERIFY_TTL_SECONDS = 10 * 60;

function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.IS_PRODUCTION,
    sameSite: env.IS_PRODUCTION ? "none" : "lax",
    path: "/api/auth",
    maxAge: env.REFRESH_TOKEN_TTL_SECONDS * 1000,
  };
}

function readCookie(req, name) {
  const raw = String(req.headers.cookie || "");
  const parts = raw.split(";").map((part) => part.trim());
  for (const part of parts) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (decodeURIComponent(part.slice(0, index)) === name) {
      return decodeURIComponent(part.slice(index + 1));
    }
  }
  return "";
}

function clearRefreshCookie(res) {
  res.clearCookie("refreshToken", {
    httpOnly: true,
    secure: env.IS_PRODUCTION,
    sameSite: env.IS_PRODUCTION ? "none" : "lax",
    path: "/api/auth",
  });
}

function isDataUrlImage(value) {
  const raw = String(value || "");
  return /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(raw);
}

async function expireOldDeviceChangeRequests(studentId = null) {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  try {
    let query = supabase
      .from("device_change_requests")
      .update({
        status: "expired",
        selfie_data_url: "",
        reviewed_at: new Date().toISOString(),
        review_note: "Request expired automatically after 24 hours.",
        updated_at: new Date().toISOString(),
      })
      .eq("status", "pending")
      .lte("expires_at", new Date().toISOString());

    if (studentId) {
      query = query.eq("student", String(studentId));
    }

    await query;
  } catch (err) {
    console.error("Error expiring device change requests:", err.message);
  }
}

async function isFingerprintAlreadyBound(normalizedFp, studentId = null) {
  if (!normalizedFp) return true;
  const supabase = getSupabaseClient();
  if (!supabase) return false;

  try {
    let studentQuery = supabase
      .from("students")
      .select("id")
      .eq("device_fingerprint", normalizedFp);

    if (studentId) {
      studentQuery = studentQuery.neq("id", String(studentId));
    }

    const facultyQuery = supabase
      .from("faculties")
      .select("id")
      .eq("device_fingerprint", normalizedFp);

    const [studentRes, facultyRes] = await Promise.all([
      studentQuery.limit(1),
      facultyQuery.limit(1),
    ]);

    const studentUsed = (studentRes.data || []).length > 0;
    const facultyUsed = (facultyRes.data || []).length > 0;

    return Boolean(studentUsed || facultyUsed);
  } catch {
    return false;
  }
}

async function findRecentDeviceChangeRequest(studentId) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  try {
    const cutoff = new Date(Date.now() - DEVICE_CHANGE_REQUEST_TTL_MS).toISOString();
    const { data } = await supabase
      .from("device_change_requests")
      .select("id, status, expires_at, created_at")
      .eq("student", String(studentId))
      .gt("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!data) return null;
    return {
      id: data.id,
      _id: data.id,
      status: data.status,
      expiresAt: data.expires_at,
      createdAt: data.created_at,
    };
  } catch {
    return null;
  }
}

// POST /api/auth/login
router.post(
  "/login",
  rateLimit({
    prefix: "login",
    windowMs: 15 * 60 * 1000,
    max: 20,
    key: (req) =>
      `${req.ip || req.socket?.remoteAddress || "unknown"}:${String(
        req.body?.email || ""
      )
        .trim()
        .toLowerCase()}`,
  }),
  async (req, res) => {
    try {
      const {
        role,
        email,
        password,
        fingerprint,
      } = req.body || {};

      if (!role || !email || !password) {
        return res.status(400).json({ ok: false, error: "Missing credentials" });
      }

      const roleUpper = String(role).toUpperCase();
      const supabase = getSupabaseClient();
      if (!supabase) {
        return res.status(503).json({ ok: false, error: "Database unavailable" });
      }

      let user = null;
      const normalizedEmail = String(email).trim().toLowerCase();

      if (roleUpper === "ADMIN") {
        const { data } = await supabase.from("admins").select("*").eq("email", normalizedEmail).single();
        user = data;
      } else if (roleUpper === "FACULTY") {
        const { data } = await supabase.from("faculties").select("*").eq("email", normalizedEmail).single();
        user = data;
      } else if (roleUpper === "STUDENT") {
        const { data } = await supabase.from("students").select("*").eq("email", normalizedEmail).single();
        user = data;
      } else {
        return res.status(400).json({ ok: false, error: "Invalid role" });
      }

      if (!user) {
        return res.status(401).json({ ok: false, error: "User not found" });
      }

      user._id = user.id;
      const storedHash = user.password_hash || user.passwordHash || null;

      // ----------------------------
      // ADMIN AUTH (PASSWORD ONLY)
      // ----------------------------
      if (roleUpper === "ADMIN") {
        if (!storedHash) {
          return res.status(500).json({ ok: false, error: "Password not set for admin" });
        }

        const valid = await bcrypt.compare(password, storedHash);
        if (!valid) {
          return res.status(401).json({ ok: false, error: "Invalid password" });
        }
      }

      // -----------------------------------
      // STUDENT / FACULTY (DEVICE + PASSWORD)
      // -----------------------------------
      if (roleUpper === "STUDENT" || roleUpper === "FACULTY") {
        const shouldEnforceDevice =
          roleUpper === "STUDENT" || user.device_lock_enabled !== false;

        if (shouldEnforceDevice && !fingerprint) {
          return res.status(400).json({ ok: false, error: "Device fingerprint required" });
        }

        const storedFp = user.device_fingerprint || user.deviceFingerprint;
        if (shouldEnforceDevice && !storedFp) {
          return res.status(403).json({
            ok: false,
            error: "Account not bound to a device",
          });
        }

        if (shouldEnforceDevice && storedFp && fingerprint) {
          const normalizedNew = normalizeFingerprint(fingerprint);
          const normalizedLegacy = legacyFingerprintHash(fingerprint);

          const fingerprintMatch =
            storedFp === normalizedNew || storedFp === normalizedLegacy;

          if (!fingerprintMatch) {
            return res.status(401).json({
              ok: false,
              error: "Device mismatch - login blocked",
            });
          }
        }

        if (!storedHash) {
          return res.status(500).json({ ok: false, error: "Password not set for account" });
        }

        const valid = await bcrypt.compare(password, storedHash);
        if (!valid) {
          return res.status(401).json({ ok: false, error: "Invalid password" });
        }
      }

      // ----------------------------
      // ISSUE JWT
      // ----------------------------
      const tokens = await issueTokenPair(user, roleUpper);
      res.cookie("refreshToken", tokens.refreshToken, cookieOptions());

      let collegeName = user.college_name || user.collegeName || null;
      let profilePhotoUrl = user.profile_photo_url || user.profilePhotoUrl || null;
      const facultyProfilePhotoUrl =
        roleUpper === "FACULTY" ? String(profilePhotoUrl || "") || null : null;
      const studentProfilePhotoUrl =
        roleUpper === "STUDENT" ? String(profilePhotoUrl || "") || null : null;

      // Faculty/Student should receive their admin's college profile details
      const adminId = user.created_by_admin || user.createdByAdmin;
      if (roleUpper !== "ADMIN" && adminId) {
        const { data: adminProfile } = await supabase
          .from("admins")
          .select("college_name, profile_photo_url")
          .eq("id", String(adminId))
          .single();

        if (adminProfile) {
          collegeName = adminProfile.college_name || collegeName || null;
          profilePhotoUrl = adminProfile.profile_photo_url || null;
        }
      }

      return res.json({
        ok: true,
        token: tokens.accessToken,
        accessToken: tokens.accessToken,
        expiresIn: tokens.expiresIn,
        user: {
          id: user.id,
          _id: user.id,
          name: user.name,
          email: user.email,
          role: roleUpper,
          enrollmentNo: roleUpper === "STUDENT" ? user.enrollment_no || user.enrollmentNo || null : null,
          collegeName,
          profilePhotoUrl,
          facultyProfilePhotoUrl,
          studentProfilePhotoUrl,
        },
      });
    } catch (err) {
      console.error("Auth login error:", err);
      return res.status(500).json({ ok: false, error: "Server error" });
    }
  }
);

// POST /api/auth/refresh
router.post("/refresh", async (req, res) => {
  try {
    const refreshToken =
      String(req.body?.refreshToken || "").trim() || readCookie(req, "refreshToken");
    if (!refreshToken) {
      return res.status(401).json({ ok: false, error: "Refresh token required" });
    }

    const rotation = await rotateRefreshToken(refreshToken);
    const role = String(rotation.decoded.role || "").toUpperCase();
    const supabase = getSupabaseClient();
    if (!supabase) {
      clearRefreshCookie(res);
      return res.status(503).json({ ok: false, error: "Database unavailable" });
    }

    let user = null;
    const userId = String(rotation.decoded.id);

    if (role === "ADMIN") {
      const { data } = await supabase.from("admins").select("*").eq("id", userId).single();
      user = data;
    } else if (role === "FACULTY") {
      const { data } = await supabase.from("faculties").select("*").eq("id", userId).single();
      user = data;
    } else if (role === "STUDENT") {
      const { data } = await supabase.from("students").select("*").eq("id", userId).single();
      user = data;
    }

    if (!user) {
      clearRefreshCookie(res);
      return res.status(401).json({ ok: false, error: "User not found" });
    }

    user._id = user.id;
    const tokens = await rotation.issueFor(user);
    res.cookie("refreshToken", tokens.refreshToken, cookieOptions());

    let collegeName = user.college_name || user.collegeName || null;
    let profilePhotoUrl = user.profile_photo_url || user.profilePhotoUrl || null;
    const facultyProfilePhotoUrl =
      role === "FACULTY" ? String(profilePhotoUrl || "") || null : null;
    const studentProfilePhotoUrl =
      role === "STUDENT" ? String(profilePhotoUrl || "") || null : null;

    const adminId = user.created_by_admin || user.createdByAdmin;
    if (role !== "ADMIN" && adminId) {
      const { data: adminProfile } = await supabase
        .from("admins")
        .select("college_name, profile_photo_url")
        .eq("id", String(adminId))
        .single();

      if (adminProfile) {
        collegeName = adminProfile.college_name || collegeName || null;
        profilePhotoUrl = adminProfile.profile_photo_url || null;
      }
    }

    return res.json({
      ok: true,
      token: tokens.accessToken,
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn,
      user: {
        id: user.id,
        _id: user.id,
        name: user.name,
        email: user.email,
        role,
        enrollmentNo: role === "STUDENT" ? user.enrollment_no || user.enrollmentNo || null : null,
        collegeName,
        profilePhotoUrl,
        facultyProfilePhotoUrl,
        studentProfilePhotoUrl,
      },
    });
  } catch {
    clearRefreshCookie(res);
    return res.status(401).json({ ok: false, error: "Invalid refresh token" });
  }
});

// GET /api/auth/me - Fetch authenticated user profile with latest admin college branding
router.get("/me", authMiddleware, async (req, res) => {
  try {
    const user = req.user;
    const roleUpper = String(req.userRole || "").toUpperCase();
    const supabase = getSupabaseClient();
    if (!supabase) {
      return res.status(503).json({ ok: false, error: "Database unavailable" });
    }

    let collegeName = user.college_name || user.collegeName || null;
    let profilePhotoUrl = user.profile_photo_url || user.profilePhotoUrl || null;
    const facultyProfilePhotoUrl =
      roleUpper === "FACULTY" ? String(profilePhotoUrl || "") || null : null;
    const studentProfilePhotoUrl =
      roleUpper === "STUDENT" ? String(profilePhotoUrl || "") || null : null;

    // Faculty/Student should always receive their admin's latest college profile details
    const adminId = user.created_by_admin || user.createdByAdmin;
    if (roleUpper !== "ADMIN" && adminId) {
      const { data: adminProfile } = await supabase
        .from("admins")
        .select("college_name, profile_photo_url")
        .eq("id", String(adminId))
        .single();

      if (adminProfile) {
        collegeName = adminProfile.college_name || collegeName || null;
        profilePhotoUrl = adminProfile.profile_photo_url || null;
      }
    }

    return res.json({
      ok: true,
      user: {
        id: user.id,
        _id: user.id,
        name: user.name,
        email: user.email,
        role: roleUpper,
        enrollmentNo: roleUpper === "STUDENT" ? user.enrollment_no || user.enrollmentNo || null : null,
        collegeName,
        profilePhotoUrl,
        facultyProfilePhotoUrl,
        studentProfilePhotoUrl,
        createdByAdmin: adminId || null,
      },
    });
  } catch (err) {
    console.error("Auth /me error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// POST /api/auth/logout
router.post("/logout", async (req, res) => {
  try {
    const refreshToken = readCookie(req, "refreshToken");
    if (refreshToken) {
      const decoded = jwt.decode(refreshToken);
      if (decoded?.jti) {
        await revokeRefreshToken(decoded.jti);
      }
    }
  } catch {
    // Logout should remain idempotent
  }
  clearRefreshCookie(res);
  return res.json({ ok: true });
});

// POST /api/auth/device-change/verify-student
router.post("/device-change/verify-student", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "Email and password required" });
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      return res.status(503).json({ ok: false, error: "Database unavailable" });
    }

    const { data: student } = await supabase
      .from("students")
      .select("id, name, email, enrollment_no, password_hash, device_fingerprint, department, created_by_admin, dept:departments(id, name, code)")
      .eq("email", String(email).toLowerCase().trim())
      .single();

    if (!student) {
      return res.status(401).json({ ok: false, error: "Invalid student credentials" });
    }

    const valid = await bcrypt.compare(String(password), student.password_hash || "");
    if (!valid) {
      return res.status(401).json({ ok: false, error: "Invalid student credentials" });
    }

    await expireOldDeviceChangeRequests(student.id);
    const recentRequest = await findRecentDeviceChangeRequest(student.id);

    if (recentRequest) {
      return res.status(400).json({
        ok: false,
        error: "Only one device change request is allowed per 24 hours.",
        request: recentRequest,
      });
    }

    const verifyToken = jwt.sign(
      {
        type: "DEVICE_CHANGE_VERIFY",
        studentId: String(student.id),
      },
      env.JWT_SECRET,
      { expiresIn: DEVICE_CHANGE_VERIFY_TTL_SECONDS }
    );

    return res.json({
      ok: true,
      verifyToken,
      expiresInSeconds: DEVICE_CHANGE_VERIFY_TTL_SECONDS,
      student: {
        id: student.id,
        _id: student.id,
        name: student.name,
        email: student.email,
        enrollmentNo: student.enrollment_no,
        department: student.dept
          ? {
              id: student.dept.id,
              _id: student.dept.id,
              name: student.dept.name,
              code: student.dept.code,
            }
          : null,
      },
    });
  } catch (err) {
    console.error("Device change verify error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// POST /api/auth/device-change/request
router.post("/device-change/request", async (req, res) => {
  try {
    const {
      verifyToken,
      fingerprint,
      selfieDataUrl,
    } = req.body || {};
    if (!verifyToken || !fingerprint) {
      return res.status(400).json({ ok: false, error: "Verification token and device fingerprint required" });
    }
    if (!isDataUrlImage(selfieDataUrl)) {
      return res.status(400).json({ ok: false, error: "Live front-camera photo required" });
    }
    if (String(selfieDataUrl).length > 700000) {
      return res.status(400).json({ ok: false, error: "Photo is too large. Retake and try again." });
    }

    let decoded;
    try {
      decoded = jwt.verify(String(verifyToken), env.JWT_SECRET);
    } catch {
      return res.status(401).json({ ok: false, error: "Verification expired. Start again." });
    }

    if (!decoded || decoded.type !== "DEVICE_CHANGE_VERIFY" || !decoded.studentId) {
      return res.status(401).json({ ok: false, error: "Invalid verification token" });
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      return res.status(503).json({ ok: false, error: "Database unavailable" });
    }

    const { data: student } = await supabase
      .from("students")
      .select("id, device_fingerprint, department, created_by_admin, name, enrollment_no")
      .eq("id", String(decoded.studentId))
      .single();

    if (!student) {
      return res.status(404).json({ ok: false, error: "Student not found" });
    }

    await expireOldDeviceChangeRequests(student.id);
    const recentRequest = await findRecentDeviceChangeRequest(student.id);

    if (recentRequest) {
      return res.status(400).json({
        ok: false,
        error: "Only one device change request is allowed per 24 hours.",
        request: recentRequest,
      });
    }

    const normalizedFp = normalizeFingerprint(fingerprint);
    if (!normalizedFp) {
      return res.status(400).json({ ok: false, error: "Invalid device fingerprint" });
    }
    if (String(student.device_fingerprint) === String(normalizedFp)) {
      return res.status(400).json({ ok: false, error: "This is already your approved device." });
    }

    const alreadyBound = await isFingerprintAlreadyBound(normalizedFp, student.id);
    if (alreadyBound) {
      return res.status(400).json({
        ok: false,
        error: "This device is already linked to another account.",
      });
    }

    const expiresAt = new Date(Date.now() + DEVICE_CHANGE_REQUEST_TTL_MS).toISOString();
    const { data: createdRequest, error: insertError } = await supabase
      .from("device_change_requests")
      .insert({
        student: student.id,
        department: student.department,
        created_by_admin: student.created_by_admin,
        old_device_fingerprint: student.device_fingerprint,
        requested_device_fingerprint: normalizedFp,
        selfie_data_url: String(selfieDataUrl),
        status: "pending",
        expires_at: expiresAt,
      })
      .select("id, status, expires_at")
      .single();

    if (insertError || !createdRequest) {
      throw insertError || new Error("Failed to create request");
    }

    return res.json({
      ok: true,
      request: {
        id: createdRequest.id,
        _id: createdRequest.id,
        status: createdRequest.status,
        expiresAt: createdRequest.expires_at,
      },
    });
  } catch (err) {
    console.error("Device change request error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

module.exports = router;
