const express = require("express");
const router = express.Router();
let bcrypt;
try {
  bcrypt = require("bcrypt");
} catch {
  bcrypt = require("bcryptjs");
}

const { getSupabaseClient } = require("../config/supabase");
const {
  generateQRToken,
  generateQRTokenWithTiming,
  clearSessionQR,
} = require("../services/qrService");
const { getOrCreateSessionSecret, clearSessionSecret } = require("../services/totpVerification");
const { removeSessionChannel } = require("../services/realtimeService");
const { normalizeFingerprint } = require("../services/deviceFingerprint");
const { expireIfInactive, touchSession } = require("../services/sessionLifecycle");
const {
  createMobileLocationCapture,
  getMobileLocationCapture,
} = require("../services/mobileLocationCapture");
const authMiddleware = require("../middleware/authMiddleware");
const { invalidateCachedSession } = require("./attendance");
const env = require("../config/env");

const DEFAULT_SESSION_RADIUS_METERS = Number(
  process.env.DEFAULT_SESSION_RADIUS_METERS || 50
);

function isImageDataUrl(value) {
  const raw = String(value || "");
  return /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(raw);
}

function validateRegistrationToken(reg, expectedType) {
  if (!reg) return "Invalid registration token";
  if (!reg.is_active && !reg.isActive) return "Registration link is inactive";
  const expiresAt = reg.expires_at || reg.expiresAt;
  if (expiresAt && new Date(expiresAt) < new Date()) {
    return "Registration token expired";
  }
  if (reg.type !== expectedType) {
    return `Token not for ${expectedType} registration`;
  }
  const usesCount = Number(reg.uses_count || reg.usesCount || 0);
  const maxUses = Number(reg.max_uses || reg.maxUses || 1);
  if (usesCount >= maxUses) {
    return "Registration limit reached";
  }
  return null;
}

async function reserveRegistrationSlot(regId) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase.rpc("reserve_registration_slot", {
      p_token_id: String(regId),
    });

    if (!error && data?.ok && data.token) {
      return data.token;
    }
  } catch {
    // Fallback to direct query
  }

  const { data: current } = await supabase
    .from("registration_tokens")
    .select("id, admin_id, type, is_active, uses_count, max_uses, expires_at")
    .eq("id", String(regId))
    .single();

  if (
    current &&
    current.is_active &&
    current.uses_count < current.max_uses &&
    (!current.expires_at || new Date(current.expires_at) > new Date())
  ) {
    const nextUses = current.uses_count + 1;
    const { data: updated } = await supabase
      .from("registration_tokens")
      .update({
        uses_count: nextUses,
        last_used_at: new Date().toISOString(),
        is_active: nextUses < current.max_uses,
        updated_at: new Date().toISOString(),
      })
      .eq("id", String(regId))
      .select("id, admin_id, is_active, uses_count, max_uses, expires_at, last_used_at")
      .single();

    return updated;
  }

  return null;
}

async function releaseRegistrationSlot(regId) {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  try {
    await supabase.rpc("release_registration_slot", { p_token_id: String(regId) });
  } catch {
    const { data: current } = await supabase
      .from("registration_tokens")
      .select("id, uses_count, max_uses, expires_at, is_active")
      .eq("id", String(regId))
      .single();

    if (current) {
      await supabase
        .from("registration_tokens")
        .update({
          uses_count: Math.max(current.uses_count - 1, 0),
          is_active: !current.expires_at || new Date(current.expires_at) > new Date(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", String(regId));
    }
  }
}

const DEVICE_CHANGE_MAX_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

async function deleteOldDeviceChangeRequests(filter = {}) {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  try {
    const cutoff = new Date(Date.now() - DEVICE_CHANGE_MAX_RETENTION_MS).toISOString();
    let query = supabase
      .from("device_change_requests")
      .delete()
      .lte("created_at", cutoff);

    if (filter.department) {
      query = query.eq("department", String(filter.department));
    }

    await query;
  } catch (err) {
    console.error("Error deleting old device change requests (>7 days):", err.message);
  }
}

async function expireOldDeviceChangeRequests(filter = {}) {
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

    if (filter.department) {
      query = query.eq("department", String(filter.department));
    }

    await query;
  } catch (err) {
    console.error("Error expiring device change requests:", err.message);
  }
}

async function scrubReviewedDeviceRequestPhotos(filter = {}) {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  try {
    let query = supabase
      .from("device_change_requests")
      .update({
        selfie_data_url: "",
        updated_at: new Date().toISOString(),
      })
      .in("status", ["approved", "rejected", "expired"])
      .neq("selfie_data_url", "");

    if (filter.department) {
      query = query.eq("department", String(filter.department));
    }

    await query;
  } catch (err) {
    console.error("Error scrubbing device change photos:", err.message);
  }
}

function stripReviewedDeviceRequestPhoto(request) {
  if (!request) return request;
  if (String(request.status || "") !== "pending") {
    return { ...request, selfieDataUrl: "", selfie_data_url: "" };
  }
  return request;
}

function buildAssignmentKey(assignment) {
  const departmentId =
    assignment && typeof assignment.department === "object"
      ? assignment.department?.id || assignment.department?._id || assignment.department
      : assignment?.department;

  return [
    String(departmentId || ""),
    Number(assignment?.year || 0),
    Number(assignment?.semester || 0),
    String(assignment?.section || "").toUpperCase(),
  ].join("::");
}

async function isFingerprintAlreadyBound(normalizedFp, studentId = null) {
  if (!normalizedFp) return true;
  const supabase = getSupabaseClient();
  if (!supabase) return false;

  try {
    let studentQuery = supabase.from("students").select("id").eq("device_fingerprint", normalizedFp);
    if (studentId) {
      studentQuery = studentQuery.neq("id", String(studentId));
    }
    const facultyQuery = supabase.from("faculties").select("id").eq("device_fingerprint", normalizedFp);

    const [studentRes, facultyRes] = await Promise.all([
      studentQuery.limit(1),
      facultyQuery.limit(1),
    ]);

    return (studentRes.data || []).length > 0 || (facultyRes.data || []).length > 0;
  } catch {
    return false;
  }
}

// PUT /api/faculty/profile
router.put("/profile", authMiddleware, async (req, res) => {
  try {
    if (req.userRole !== "FACULTY") {
      return res.status(403).json({ ok: false, error: "Faculty access required" });
    }

    const profilePhotoUrl = String(req.body?.profilePhotoUrl || "").trim();
    if (!profilePhotoUrl) {
      return res.status(400).json({ ok: false, error: "Profile photo is required" });
    }

    if (!isImageDataUrl(profilePhotoUrl)) {
      return res.status(400).json({ ok: false, error: "Invalid profile photo format" });
    }

    if (profilePhotoUrl.length > 700000) {
      return res.status(400).json({ ok: false, error: "Profile photo is too large" });
    }

    const supabase = getSupabaseClient();
    if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

    const { data: updated, error } = await supabase
      .from("faculties")
      .update({
        profile_photo_url: profilePhotoUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", req.userId)
      .select("id, profile_photo_url")
      .single();

    if (error || !updated) throw error || new Error("Failed to update profile");

    return res.json({
      ok: true,
      faculty: {
        id: updated.id,
        _id: updated.id,
        profilePhotoUrl: updated.profile_photo_url || "",
      },
    });
  } catch (err) {
    console.error("Update faculty profile error:", err);
    return res.status(500).json({ ok: false, error: "Failed to update profile photo" });
  }
});

// ----------------------------------------------------
// FACULTY REGISTRATION
// POST /api/faculty/register
// ----------------------------------------------------
router.post("/register", async (req, res) => {
  try {
    const {
      token,
      name,
      email,
      password,
      departmentId,
      fingerprint,
    } = req.body || {};

    if (!token || !name || !email || !password || !departmentId || !fingerprint) {
      return res.status(400).json({ ok: false, error: "All fields are required" });
    }

    const supabase = getSupabaseClient();
    if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

    const { data: reg } = await supabase
      .from("registration_tokens")
      .select("id, admin_id, type, is_active, uses_count, max_uses, expires_at")
      .eq("token", String(token))
      .single();

    const tokenError = validateRegistrationToken(reg, "faculty");
    if (tokenError) {
      return res.status(400).json({ ok: false, error: tokenError });
    }

    const normalizedName = String(name || "").trim();
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const normalizedFp = normalizeFingerprint(fingerprint);

    if (!normalizedFp) {
      return res.status(400).json({ ok: false, error: "Invalid device fingerprint" });
    }

    const { data: department } = await supabase
      .from("departments")
      .select("id")
      .eq("id", departmentId)
      .eq("created_by_admin", reg.admin_id)
      .single();

    if (!department) {
      return res.status(400).json({
        ok: false,
        error: "Selected department does not belong to this admin",
      });
    }

    const checks = [
      supabase.from("faculties").select("id").eq("email", normalizedEmail).limit(1),
      supabase.from("faculties").select("id").eq("device_fingerprint", normalizedFp).limit(1),
      supabase.from("students").select("id").eq("device_fingerprint", normalizedFp).limit(1),
    ];

    const [existingFacByEmail, existingFacByFp, existingStuByFp] = await Promise.all(checks);

    const hasConflict =
      (existingFacByEmail?.data || []).length > 0 ||
      (existingFacByFp?.data || []).length > 0 ||
      (existingStuByFp?.data || []).length > 0;

    if (hasConflict) {
      return res.status(400).json({
        ok: false,
        error: "Faculty with this email or device already exists",
      });
    }

    const reservedToken = await reserveRegistrationSlot(reg.id);
    if (!reservedToken) {
      return res.status(400).json({ ok: false, error: "Registration limit reached" });
    }

    try {
      const passwordHash = await bcrypt.hash(password, 10);

      const { data: faculty, error } = await supabase
        .from("faculties")
        .insert({
          name: normalizedName,
          email: normalizedEmail,
          password_hash: passwordHash,
          department: department.id,
          device_fingerprint: normalizedFp,
          created_by_admin: reg.admin_id,
        })
        .select("id")
        .single();

      if (error || !faculty) {
        throw error || new Error("Failed to insert faculty");
      }

      return res.json({ ok: true, facultyId: faculty.id, _id: faculty.id });
    } catch (err) {
      await releaseRegistrationSlot(reg.id);
      throw err;
    }
  } catch (err) {
    console.error("Faculty registration error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ----------------------------------------------------
// GET ACTIVE SESSION (FACULTY)
// GET /api/faculty/session/active
// ----------------------------------------------------
router.get("/session/active", authMiddleware, async (req, res) => {
  try {
    if (req.userRole !== "FACULTY" && req.userRole !== "ADMIN") {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    const facultyId =
      req.userRole === "FACULTY" ? req.userId : String(req.query.facultyId || req.userId);

    if (!facultyId) {
      return res.status(400).json({ ok: false, error: "facultyId required" });
    }

    const supabase = getSupabaseClient();
    if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

    const { data: session } = await supabase
      .from("sessions")
      .select(
        "id, faculty, subject, category, activity_id, batch_id, batch_ids, department, year, semester, section, " +
        "start_time, end_time, last_activity_at, is_active, location, created_at, updated_at, " +
        "activity:activities(id, name, type, years, semesters, semester, section)"
      )
      .eq("faculty", facultyId)
      .eq("is_active", true)
      .order("start_time", { ascending: false })
      .limit(1)
      .single();

    if (!session) {
      return res.json({ ok: true, session: null });
    }

    const active = await expireIfInactive(session);
    const isRunning = Boolean(active?.is_active ?? active?.isActive);
    if (!active || !isRunning) {
      return res.json({ ok: true, session: null });
    }

    // Query exact total enrolled students for this class or activity
    let totalStudents = 0;
    let resolvedBatchName = null;
    const effectiveBatchIds = Array.isArray(active.batch_ids) && active.batch_ids.length > 0
      ? active.batch_ids
      : (active.batch_id ? [active.batch_id] : []);

    if (active.category === "ACTIVITY" || active.activity_id) {
      if (effectiveBatchIds.length > 0) {
        const { data: bDataList } = await supabase
          .from("activity_batches")
          .select("batch_name, batch_number, student_enrollments")
          .in("id", effectiveBatchIds);
        const usns = new Set();
        (bDataList || []).forEach((b) => {
          if (b.batch_name && !resolvedBatchName) resolvedBatchName = b.batch_name;
          if (Array.isArray(b.student_enrollments)) {
            b.student_enrollments.forEach((u) => usns.add(String(u).trim().toUpperCase()));
          }
        });
        totalStudents = usns.size;
      } else {
        const { data: bList } = await supabase
          .from("activity_batches")
          .select("batch_name, batch_number, student_enrollments")
          .eq("activity_id", active.activity_id);
        const usns = new Set();
        (bList || []).forEach((b) => {
          if (Array.isArray(b.student_enrollments)) {
            b.student_enrollments.forEach((u) => usns.add(String(u).trim().toUpperCase()));
          }
        });
        totalStudents = usns.size;
      }

      if (totalStudents === 0 && effectiveBatchIds.length === 0 && active.department) {
        let q = supabase
          .from("students")
          .select("id", { count: "exact", head: true })
          .eq("department", String(active.department));
        const actYears = Array.isArray(active.activity?.years) && active.activity.years.length > 0
          ? active.activity.years
          : (active.year ? [Number(active.year)] : []);
        if (actYears.length === 1) q = q.eq("year", actYears[0]);
        else if (actYears.length > 1) q = q.in("year", actYears);

        const actSems = Array.isArray(active.activity?.semesters) && active.activity.semesters.length > 0
          ? active.activity.semesters
          : (active.semester ? [Number(active.semester)] : []);
        if (actSems.length === 1) q = q.eq("semester", actSems[0]);
        else if (actSems.length > 1) q = q.in("semester", actSems);

        if (active.section && String(active.section).toUpperCase() !== "ALL") {
          q = q.eq("section", String(active.section).trim().toUpperCase());
        }
        const { count } = await q;
        totalStudents = count || 0;
      }
    } else {
      // Academic Session: Check if specific subject batches were selected
      if (effectiveBatchIds.length > 0) {
        const { data: bDataList } = await supabase
          .from("subject_batches")
          .select("batch_name, batch_number, student_enrollments")
          .in("id", effectiveBatchIds);
        const usns = new Set();
        (bDataList || []).forEach((b) => {
          if (b.batch_name && !resolvedBatchName) resolvedBatchName = b.batch_name;
          if (Array.isArray(b.student_enrollments)) {
            b.student_enrollments.forEach((u) => usns.add(String(u).trim().toUpperCase()));
          }
        });
        totalStudents = usns.size;
      }

      if (totalStudents === 0 && effectiveBatchIds.length === 0) {
        let countQuery = supabase
          .from("students")
          .select("id", { count: "exact", head: true })
          .eq("year", Number(active.year))
          .eq("semester", Number(active.semester));

        if (active.department) {
          countQuery = countQuery.eq("department", String(active.department));
        }
        const normalizedSection = String(active.section || "").trim().toUpperCase();
        if (normalizedSection) {
          countQuery = countQuery.eq("section", normalizedSection);
        }
        const { count: totalClassStudents } = await countQuery;
        totalStudents = totalClassStudents || 0;
      }
    }

    const secretKey = await getOrCreateSessionSecret(active.id);

    const formatted = {
      ...active,
      _id: active.id,
      isActive: true,
      startTime: active.start_time,
      endTime: active.end_time,
      lastActivityAt: active.last_activity_at,
      secretKey,
      totalStudents,
      totalStrength: totalStudents,
      years: active.activity?.years || (active.year ? [active.year] : []),
      semesters: active.activity?.semesters || (active.semester ? [active.semester] : []),
      activityName: active.activity?.name,
      batchName: resolvedBatchName || active.batchName,
    };

    return res.json({
      ok: true,
      session: formatted,
      secretKey,
      totalStudents,
      totalStrength: totalStudents,
    });
  } catch (err) {
    console.error("Fetch active session error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

router.post("/location-capture/request", authMiddleware, async (req, res) => {
  try {
    if (req.userRole !== "FACULTY" && req.userRole !== "ADMIN") {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }
    const facultyId =
      req.userRole === "FACULTY" ? req.userId : String(req.body?.facultyId || req.userId);
    const created = await createMobileLocationCapture(facultyId);

    return res.json({
      ok: true,
      captureToken: created.captureToken,
      expiresInMs: created.expiresInMs,
    });
  } catch (err) {
    console.error("Create mobile location capture error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

router.get("/location-capture/:token", authMiddleware, async (req, res) => {
  try {
    if (req.userRole !== "FACULTY" && req.userRole !== "ADMIN") {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    const token = String(req.params.token || "");
    const record = await getMobileLocationCapture(token);
    if (!record) {
      return res.status(404).json({ ok: false, error: "Capture request expired or not found" });
    }

    const facultyId =
      req.userRole === "FACULTY" ? req.userId : String(req.query?.facultyId || req.userId);
    if (req.userRole === "FACULTY" && String(record.facultyId) !== String(facultyId)) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    return res.json({
      ok: true,
      status: record.status,
      expiresAt: record.expiresAt,
      capturedAt: record.capturedAt || null,
      coords: record.coords || null,
      accuracy: record.accuracy ?? null,
      deviceLabel: record.deviceLabel || null,
    });
  } catch (err) {
    console.error("Get mobile location capture error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ----------------------------------------------------
// DEVICE CHANGE REQUESTS (FACULTY DEPARTMENT-SCOPED)
// GET /api/faculty/device-change-requests
// ----------------------------------------------------
router.get("/device-change-requests", authMiddleware, async (req, res) => {
  try {
    if (req.userRole !== "FACULTY") {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    const deptId = req.user.department;
    const adminId = req.user.created_by_admin || req.user.createdByAdmin;
    await Promise.allSettled([
      expireOldDeviceChangeRequests({ department: deptId }),
      deleteOldDeviceChangeRequests({ department: deptId }),
      scrubReviewedDeviceRequestPhotos({ department: deptId }),
    ]);

    const status = String(req.query.status || "pending").toLowerCase();
    const allowedStatuses = ["pending", "approved", "rejected", "expired", "all"];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ ok: false, error: "Invalid request status" });
    }

    const supabase = getSupabaseClient();
    if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

    let query = supabase
      .from("device_change_requests")
      .select(`
        id,
        student,
        department,
        created_by_admin,
        old_device_fingerprint,
        requested_device_fingerprint,
        selfie_data_url,
        status,
        expires_at,
        reviewed_by,
        reviewed_at,
        review_note,
        created_at,
        stu:students(id, name, email, enrollment_no, year, semester, section, profile_photo_url),
        dept:departments(id, name, code),
        rev:faculties(id, name, email)
      `)
      .eq("department", String(deptId))
      .eq("created_by_admin", String(adminId));

    if (status !== "all") {
      query = query.eq("status", status);
    }

    const { data: requests, error } = await query
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    // Direct student lookup fallback if relation join was null
    const missingStudentIds = [
      ...new Set(
        (requests || [])
          .filter((r) => (!r.stu || !r.stu.profile_photo_url) && r.student)
          .map((r) => String(r.student))
      ),
    ];

    const studentMap = new Map();
    if (missingStudentIds.length > 0) {
      const { data: fallbackStudents } = await supabase
        .from("students")
        .select("id, name, email, enrollment_no, year, semester, section, profile_photo_url")
        .in("id", missingStudentIds);

      (fallbackStudents || []).forEach((s) => {
        studentMap.set(String(s.id), s);
      });
    }

    const formatted = (requests || []).map((r) => {
      const stuData = r.stu || studentMap.get(String(r.student)) || null;
      return {
        id: r.id,
        _id: r.id,
        student: stuData
          ? {
              id: stuData.id,
              _id: stuData.id,
              name: stuData.name,
              email: stuData.email,
              enrollmentNo: stuData.enrollment_no,
              year: stuData.year,
              semester: stuData.semester,
              section: stuData.section,
              profilePhotoUrl: stuData.profile_photo_url || "",
              profile_photo_url: stuData.profile_photo_url || "",
            }
          : (typeof r.student === "object" ? r.student : { id: r.student, _id: r.student }),
        department: r.dept ? { ...r.dept, _id: r.dept.id } : r.department,
        reviewedBy: r.rev ? { ...r.rev, _id: r.rev.id } : r.reviewed_by,
        oldDeviceFingerprint: r.old_device_fingerprint,
        requestedDeviceFingerprint: r.requested_device_fingerprint,
        selfieDataUrl: r.status === "pending" ? (r.selfie_data_url || "") : "",
        selfie_data_url: r.status === "pending" ? (r.selfie_data_url || "") : "",
        status: r.status,
        expiresAt: r.expires_at,
        reviewedAt: r.reviewed_at,
        reviewNote: r.review_note || "",
        createdAt: r.created_at,
      };
    });

    return res.json({ ok: true, requests: formatted });
  } catch (err) {
    console.error("Fetch device change requests error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ----------------------------------------------------
// GET DEVICE CHANGE REQUEST PHOTOS (DIRECT COMPARISON)
// GET /api/faculty/device-change-requests/:id/photos
// ----------------------------------------------------
router.get("/device-change-requests/:id/photos", authMiddleware, async (req, res) => {
  try {
    if (req.userRole !== "FACULTY") {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    const { id } = req.params;
    if (!id) return res.status(400).json({ ok: false, error: "Request ID required" });

    const supabase = getSupabaseClient();
    if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

    const { data: request, error: reqErr } = await supabase
      .from("device_change_requests")
      .select("id, student, selfie_data_url, status, stu:students(id, name, enrollment_no, profile_photo_url)")
      .eq("id", String(id))
      .single();

    if (reqErr || !request) {
      return res.status(404).json({ ok: false, error: "Device change request not found" });
    }

    let officialPhotoUrl = request.stu?.profile_photo_url || "";
    let studentName = request.stu?.name || "";
    let enrollmentNo = request.stu?.enrollment_no || "";

    if (!officialPhotoUrl && request.student) {
      const { data: stu } = await supabase
        .from("students")
        .select("name, enrollment_no, profile_photo_url")
        .eq("id", String(request.student))
        .single();
      if (stu) {
        officialPhotoUrl = stu.profile_photo_url || "";
        studentName = stu.name || studentName;
        enrollmentNo = stu.enrollment_no || enrollmentNo;
      }
    }

    return res.json({
      ok: true,
      requestId: request.id,
      selfieDataUrl: request.status === "pending" ? (request.selfie_data_url || "") : "",
      officialPhotoUrl: officialPhotoUrl || "",
      studentName,
      enrollmentNo,
      status: request.status,
    });
  } catch (err) {
    console.error("Fetch device request photos error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ----------------------------------------------------
// REVIEW DEVICE CHANGE REQUEST
// POST /api/faculty/device-change-requests/:id/review
// ----------------------------------------------------
router.post("/device-change-requests/:id/review", authMiddleware, async (req, res) => {
  try {
    if (req.userRole !== "FACULTY") {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    const decision = String(req.body?.decision || "").toLowerCase();
    const reviewNote = String(req.body?.reviewNote || "").trim().slice(0, 500);
    if (!["approved", "rejected"].includes(decision)) {
      return res.status(400).json({ ok: false, error: "Decision must be approved or rejected" });
    }
    if (decision === "rejected" && !reviewNote) {
      return res.status(400).json({ ok: false, error: "Rejection reason required" });
    }

    const deptId = req.user.department;
    const adminId = req.user.created_by_admin || req.user.createdByAdmin;
    await Promise.allSettled([
      expireOldDeviceChangeRequests({ department: deptId }),
      deleteOldDeviceChangeRequests({ department: deptId }),
      scrubReviewedDeviceRequestPhotos({ department: deptId }),
    ]);

    const supabase = getSupabaseClient();
    if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

    const { data: request } = await supabase
      .from("device_change_requests")
      .select(
        "id, student, department, created_by_admin, status, expires_at, " +
        "old_device_fingerprint, requested_device_fingerprint, review_note"
      )
      .eq("id", req.params.id)
      .eq("department", String(deptId))
      .eq("created_by_admin", String(adminId))
      .single();

    if (!request) {
      return res.status(404).json({ ok: false, error: "Request not found" });
    }
    if (request.status !== "pending") {
      return res.status(400).json({ ok: false, error: `Request is already ${request.status}` });
    }
    if (new Date(request.expires_at) <= new Date()) {
      await supabase
        .from("device_change_requests")
        .update({
          status: "expired",
          selfie_data_url: "",
          reviewed_at: new Date().toISOString(),
          review_note: "Request expired automatically after 24 hours.",
          updated_at: new Date().toISOString(),
        })
        .eq("id", request.id);
      return res.status(400).json({ ok: false, error: "Request expired" });
    }

    const { data: student } = await supabase
      .from("students")
      .select("id, department, created_by_admin, device_fingerprint")
      .eq("id", String(request.student))
      .single();

    if (!student) {
      await supabase
        .from("device_change_requests")
        .update({
          status: "rejected",
          selfie_data_url: "",
          reviewed_by: req.userId,
          reviewed_at: new Date().toISOString(),
          review_note: "Student account no longer exists.",
          updated_at: new Date().toISOString(),
        })
        .eq("id", request.id);
      return res.status(404).json({ ok: false, error: "Student not found" });
    }

    if (
      String(student.department) !== String(deptId) ||
      String(student.created_by_admin) !== String(adminId)
    ) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    if (decision === "approved") {
      if (String(student.device_fingerprint) !== String(request.old_device_fingerprint)) {
        await supabase
          .from("device_change_requests")
          .update({
            status: "rejected",
            selfie_data_url: "",
            reviewed_by: req.userId,
            reviewed_at: new Date().toISOString(),
            review_note: "Rejected automatically because the student's device was already changed.",
            updated_at: new Date().toISOString(),
          })
          .eq("id", request.id);
        return res.status(409).json({
          ok: false,
          error: "Student device was already changed. This request is stale.",
        });
      }

      const alreadyBound = await isFingerprintAlreadyBound(
        request.requested_device_fingerprint,
        student.id
      );
      if (alreadyBound) {
        await supabase
          .from("device_change_requests")
          .update({
            status: "rejected",
            selfie_data_url: "",
            reviewed_by: req.userId,
            reviewed_at: new Date().toISOString(),
            review_note: "Rejected automatically because the requested device is already bound.",
            updated_at: new Date().toISOString(),
          })
          .eq("id", request.id);
        return res.status(409).json({
          ok: false,
          error: "Requested device is already linked to another account.",
        });
      }

      // Update student's device fingerprint
      const studentUpdate = {
        device_fingerprint: request.requested_device_fingerprint,
        updated_at: new Date().toISOString(),
      };

      await supabase
        .from("students")
        .update(studentUpdate)
        .eq("id", student.id);
    }

    const { data: updatedRequest, error: updateReqErr } = await supabase
      .from("device_change_requests")
      .update({
        status: decision,
        selfie_data_url: "",
        reviewed_by: req.userId,
        reviewed_at: new Date().toISOString(),
        review_note: reviewNote,
        updated_at: new Date().toISOString(),
      })
      .eq("id", request.id)
      .select(`
        id,
        student,
        department,
        old_device_fingerprint,
        requested_device_fingerprint,
        selfie_data_url,
        status,
        expires_at,
        reviewed_by,
        reviewed_at,
        review_note,
        created_at,
        stu:students(id, name, email, enrollment_no, year, semester, section, profile_photo_url),
        dept:departments(id, name, code),
        rev:faculties(id, name, email)
      `)
      .single();

    if (updateReqErr || !updatedRequest) throw updateReqErr || new Error("Failed to review request");

    const formatted = {
      id: updatedRequest.id,
      _id: updatedRequest.id,
      student: updatedRequest.stu
        ? {
            ...updatedRequest.stu,
            _id: updatedRequest.stu.id,
            enrollmentNo: updatedRequest.stu.enrollment_no,
            profilePhotoUrl: updatedRequest.stu.profile_photo_url || "",
            profile_photo_url: updatedRequest.stu.profile_photo_url || "",
          }
        : updatedRequest.student,
      department: updatedRequest.dept ? { ...updatedRequest.dept, _id: updatedRequest.dept.id } : updatedRequest.department,
      reviewedBy: updatedRequest.rev ? { ...updatedRequest.rev, _id: updatedRequest.rev.id } : updatedRequest.reviewed_by,
      oldDeviceFingerprint: updatedRequest.old_device_fingerprint,
      requestedDeviceFingerprint: updatedRequest.requested_device_fingerprint,
      selfieDataUrl: updatedRequest.selfie_data_url || "",
      selfie_data_url: updatedRequest.selfie_data_url || "",
      status: updatedRequest.status,
      expiresAt: updatedRequest.expires_at,
      reviewedAt: updatedRequest.reviewed_at,
      reviewNote: updatedRequest.review_note || "",
      createdAt: updatedRequest.created_at,
    };

    return res.json({ ok: true, request: formatted });
  } catch (err) {
    console.error("Review device change request error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ----------------------------------------------------
// FACULTY SUBJECT ANALYTICS
// GET /api/faculty/subjects/:subjectId/analytics
// ----------------------------------------------------
router.get("/subjects/:subjectId/analytics", authMiddleware, async (req, res) => {
  try {
    if (req.userRole !== "FACULTY") {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    const subjectId = String(req.params.subjectId || "").trim();
    const rawClassCode = String(req.query.classCode || "").trim();
    const selectedClassCode =
      rawClassCode &&
      rawClassCode.toLowerCase() !== "undefined" &&
      rawClassCode.toLowerCase() !== "null"
        ? rawClassCode.toUpperCase()
        : "";

    const supabase = getSupabaseClient();
    if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

    const { data: subject } = await supabase
      .from("subjects")
      .select("id, name, code, year, semester, allotted_faculties")
      .eq("id", subjectId)
      .single();

    const isAllotted = Array.isArray(subject?.allotted_faculties) && subject.allotted_faculties.some((f) => String(f) === String(req.userId));
    if (!subject || !isAllotted) {
      return res.status(404).json({ ok: false, error: "Subject not found for this faculty" });
    }

    const adminId = req.user.created_by_admin || req.user.createdByAdmin;
    const { data: rawAssignments } = await supabase
      .from("subject_assignments")
      .select("id, subject, faculty, department, year, semester, section, class_code, dept:departments(id, name, code), fac:faculties(id, name, email)")
      .eq("subject", subjectId)
      .eq("created_by_admin", String(adminId))
      .order("class_code", { ascending: true });

    // Deduplicate assignments by class_code
    const seenClassCodes = new Set();
    const assignments = [];
    (rawAssignments || []).forEach((a) => {
      const code = String(a.class_code || "").toUpperCase();
      if (!seenClassCodes.has(code)) {
        seenClassCodes.add(code);
        assignments.push({
          ...a,
          _id: a.id,
          classCode: a.class_code,
          department: a.dept ? { ...a.dept, _id: a.dept.id } : a.department,
        });
      }
    });

    if (!assignments.length) {
      return res.json({
        ok: true,
        subject: {
          id: subject.id,
          _id: subject.id,
          name: subject.name,
          code: subject.code,
        },
        filters: {
          selectedClassCode: selectedClassCode || "",
          classCodes: [],
        },
        overview: {
          totalClasses: 0,
          totalStudents: 0,
          activeStudents: 0,
          studentsBelow75: 0,
          averageAttendancePercentage: 0,
          averagePresentCount: 0,
        },
        classCodeInsights: [],
        sessionInsights: [],
        students: [],
      });
    }

    const allClassCodes = assignments.map((assignment) => ({
      classCode: assignment.classCode,
      departmentName: assignment.department?.name || "Department",
      departmentCode: assignment.department?.code || "",
      section: assignment.section,
      year: assignment.year,
      semester: assignment.semester,
    }));

    const scopedAssignments = selectedClassCode
      ? assignments.filter((assignment) => String(assignment.classCode || "") === selectedClassCode)
      : assignments;

    if (selectedClassCode && scopedAssignments.length === 0) {
      return res.status(400).json({ ok: false, error: "Invalid class code for this subject" });
    }

    const assignmentByKey = new Map();
    const eligibleStudentsByKey = new Map();

    for (const assignment of scopedAssignments) {
      const key = buildAssignmentKey(assignment);
      assignmentByKey.set(key, assignment);

      const deptId = assignment.department?.id || assignment.department;
      const { data: students } = await supabase
        .from("students")
        .select("id, name, enrollment_no, department, year, semester, section, profile_photo_url")
        .eq("department", String(deptId))
        .eq("year", Number(assignment.year))
        .eq("semester", Number(assignment.semester))
        .eq("section", String(assignment.section || "").toUpperCase())
        .eq("created_by_admin", String(adminId));

      eligibleStudentsByKey.set(key, students || []);
    }

    // Query completed sessions for this subject across all allotted faculties
    const { data: rawSessions } = await supabase
      .from("sessions")
      .select("id, faculty, department, year, semester, section, start_time, end_time, is_active, fac:faculties(id, name)")
      .eq("subject", subjectId)
      .eq("is_active", false)
      .not("end_time", "is", null)
      .order("end_time", { ascending: false });

    const sessions = rawSessions || [];
    const filteredSessions = sessions
      .map((session) => {
        const assignmentKey = buildAssignmentKey(session);
        const assignment = assignmentByKey.get(assignmentKey);
        if (!assignment) return null;
        return {
          ...session,
          _id: session.id,
          assignmentKey,
          classCode: assignment.classCode,
          assignment,
          startTime: session.start_time,
          endTime: session.end_time,
        };
      })
      .filter(Boolean);

    const sessionIds = filteredSessions.map((s) => s.id);
    let attendanceRows = [];
    if (sessionIds.length > 0) {
      const { data: attData } = await supabase
        .from("attendances")
        .select("session, student, timestamp, status")
        .in("session", sessionIds)
        .eq("subject", subjectId)
        .eq("status", "present");

      attendanceRows = attData || [];
    }

    const presentStudentsBySession = new Map();
    const studentPresentCount = new Map();

    attendanceRows.forEach((row) => {
      const sessionKey = String(row.session);
      const studentKey = String(row.student);
      const presentSet = presentStudentsBySession.get(sessionKey) || new Set();
      presentSet.add(studentKey);
      presentStudentsBySession.set(sessionKey, presentSet);
      studentPresentCount.set(studentKey, (studentPresentCount.get(studentKey) || 0) + 1);
    });

    const totalClassesByAssignmentKey = new Map();
    const sessionInsights = filteredSessions.slice(0, 25).map((session) => {
      const sessionKey = String(session.id);
      const eligibleStudents = eligibleStudentsByKey.get(session.assignmentKey) || [];
      const presentCount = (presentStudentsBySession.get(sessionKey) || new Set()).size;
      const eligibleCount = eligibleStudents.length;
      const attendancePercentage =
        eligibleCount > 0 ? Number(((presentCount / eligibleCount) * 100).toFixed(2)) : 0;

      return {
        sessionId: session.id,
        _id: session.id,
        classCode: session.classCode,
        facultyName: session.fac?.name || "Faculty",
        date: session.endTime || session.startTime,
        section: session.section,
        departmentName: session.assignment?.department?.name || "Department",
        presentCount,
        eligibleCount,
        attendancePercentage,
      };
    });

    filteredSessions.forEach((session) => {
      totalClassesByAssignmentKey.set(
        session.assignmentKey,
        (totalClassesByAssignmentKey.get(session.assignmentKey) || 0) + 1
      );
    });

    const latestSessionByAssignmentKey = new Map();
    filteredSessions.forEach((session) => {
      if (!latestSessionByAssignmentKey.has(session.assignmentKey)) {
        latestSessionByAssignmentKey.set(session.assignmentKey, session);
      }
    });

    const classCodeInsights = scopedAssignments.map((assignment) => {
      const assignmentKey = buildAssignmentKey(assignment);
      const eligibleStudents = eligibleStudentsByKey.get(assignmentKey) || [];
      const relevantSessions = filteredSessions.filter(
        (session) => session.assignmentKey === assignmentKey
      );

      const totalClasses = relevantSessions.length;
      const totalAttendancePercentage = relevantSessions.reduce((sum, session) => {
        const sessionKey = String(session.id);
        const presentCount = (presentStudentsBySession.get(sessionKey) || new Set()).size;
        const eligibleCount = eligibleStudents.length;
        const pct = eligibleCount > 0 ? (presentCount / eligibleCount) * 100 : 0;
        return sum + pct;
      }, 0);

      const averageAttendancePercentage =
        totalClasses > 0 ? Number((totalAttendancePercentage / totalClasses).toFixed(2)) : 0;

      const averagePresentCount =
        totalClasses > 0
          ? Number(
              (
                relevantSessions.reduce(
                  (sum, session) =>
                    sum + (presentStudentsBySession.get(String(session.id)) || new Set()).size,
                  0
                ) / totalClasses
              ).toFixed(2)
            )
          : 0;

      return {
        classCode: assignment.classCode,
        departmentName: assignment.department?.name || "Department",
        departmentCode: assignment.department?.code || "",
        year: assignment.year,
        semester: assignment.semester,
        section: assignment.section,
        totalClasses,
        studentCount: eligibleStudents.length,
        averageAttendancePercentage,
        averagePresentCount,
      };
    });

    const students = [];
    for (const assignment of scopedAssignments) {
      const assignmentKey = buildAssignmentKey(assignment);
      const eligibleStudents = eligibleStudentsByKey.get(assignmentKey) || [];
      const totalClasses = totalClassesByAssignmentKey.get(assignmentKey) || 0;
      const latestSession = latestSessionByAssignmentKey.get(assignmentKey) || null;
      const latestPresentSet = latestSession
        ? presentStudentsBySession.get(String(latestSession.id)) || new Set()
        : new Set();

      eligibleStudents.forEach((student) => {
        const attendedClasses = studentPresentCount.get(String(student.id)) || 0;
        const attendancePercentage =
          totalClasses > 0 ? Number(((attendedClasses / totalClasses) * 100).toFixed(2)) : 0;

        students.push({
          studentId: student.id,
          _id: student.id,
          name: student.name,
          enrollmentNo: student.enrollment_no,
          profilePhotoUrl: student.profile_photo_url || "",
          classCode: assignment.classCode,
          departmentName: assignment.department?.name || "Department",
          section: assignment.section,
          year: assignment.year,
          semester: assignment.semester,
          totalClasses,
          attendedClasses,
          missedClasses: Math.max(totalClasses - attendedClasses, 0),
          attendancePercentage,
          lastAttendanceStatus: latestSession
            ? latestPresentSet.has(String(student.id))
              ? "present"
              : "absent"
            : "none",
          lastClassAt: latestSession ? latestSession.endTime || latestSession.startTime : null,
        });
      });
    }

    students.sort((a, b) => {
      if (a.attendancePercentage !== b.attendancePercentage) {
        return a.attendancePercentage - b.attendancePercentage;
      }
      return String(a.enrollmentNo || "").localeCompare(String(b.enrollmentNo || ""));
    });

    const totalClasses = filteredSessions.length;
    const totalStudents = students.length;
    const totalAttendancePercentageAcrossSessions = filteredSessions.reduce((sum, session) => {
      const eligibleCount = (eligibleStudentsByKey.get(session.assignmentKey) || []).length;
      const presentCount = (presentStudentsBySession.get(String(session.id)) || new Set()).size;
      return sum + (eligibleCount > 0 ? (presentCount / eligibleCount) * 100 : 0);
    }, 0);

    const overview = {
      totalClasses,
      totalStudents,
      activeStudents: students.filter((student) => student.attendedClasses > 0).length,
      studentsBelow75: students.filter(
        (student) => student.totalClasses > 0 && student.attendancePercentage < 75
      ).length,
      averageAttendancePercentage:
        totalClasses > 0
          ? Number((totalAttendancePercentageAcrossSessions / totalClasses).toFixed(2))
          : 0,
      averagePresentCount:
        totalClasses > 0
          ? Number(
              (
                filteredSessions.reduce(
                  (sum, session) =>
                    sum + (presentStudentsBySession.get(String(session.id)) || new Set()).size,
                  0
                ) / totalClasses
              ).toFixed(2)
            )
          : 0,
    };

    return res.json({
      ok: true,
      subject: {
        id: subject.id,
        _id: subject.id,
        name: subject.name,
        code: subject.code,
      },
      filters: {
        selectedClassCode: selectedClassCode || "",
        classCodes: allClassCodes,
      },
      overview,
      classCodeInsights,
      sessionInsights,
      students,
    });
  } catch (err) {
    console.error("Faculty subject analytics error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ----------------------------------------------------
// SESSION START
// POST /api/faculty/session/start
// ----------------------------------------------------
router.post("/session/start", authMiddleware, async (req, res) => {
  try {
    if (req.userRole !== "FACULTY" && req.userRole !== "ADMIN") {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    const {
      category,
      activityId,
      batchId,
      batchIds,
      subjectId,
      departmentId,
      location,
      year,
      semester,
      section,
    } = req.body || {};

    const isActivity = String(category || "").toUpperCase() === "ACTIVITY";

    const facultyId =
      req.userRole === "FACULTY" ? req.userId : String(req.body?.facultyId || req.userId);

    if (location?.lat == null || location?.lng == null) {
      return res.status(400).json({ ok: false, error: "Session location required" });
    }

    const supabase = getSupabaseClient();
    if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

    let resolvedDepartmentId = departmentId;
    let resolvedYear = year;
    let resolvedSemester = semester;
    let resolvedSection = section;

    let resolvedBatchIds = [];
    if (Array.isArray(batchIds) && batchIds.length > 0) {
      resolvedBatchIds = batchIds.map(String).filter((b) => b && b !== "all" && b !== "ALL");
    } else if (batchId && batchId !== "all" && batchId !== "ALL") {
      resolvedBatchIds = [String(batchId)];
    }

    let academicBatchName = req.body?.batchName || null;

    if (isActivity) {
      if (!activityId) {
        return res.status(400).json({
          ok: false,
          error: "activityId is required for activity sessions",
        });
      }

      const { data: activity, error: actErr } = await supabase
        .from("activities")
        .select("id, name, type, department, years, semesters, semester, section, faculty")
        .eq("id", activityId)
        .single();

      if (actErr || !activity) {
        return res.status(404).json({ ok: false, error: "Activity not found" });
      }

      if (req.userRole === "FACULTY" && String(activity.faculty) !== String(req.userId)) {
        return res.status(403).json({
          ok: false,
          error: "Activity is not allotted to this faculty",
        });
      }

      resolvedDepartmentId = departmentId || activity.department;
      const actYears = Array.isArray(activity.years) && activity.years.length > 0
        ? activity.years
        : (activity.semester ? [Math.ceil(activity.semester / 2)] : (year ? [Number(year)] : [1]));
      const actSems = Array.isArray(activity.semesters) && activity.semesters.length > 0
        ? activity.semesters
        : (activity.semester ? [Number(activity.semester)] : (semester ? [Number(semester)] : [1]));

      const passedYears = Array.isArray(req.body.years) && req.body.years.length > 0 ? req.body.years.map(Number) : actYears;
      const passedSems = Array.isArray(req.body.semesters) && req.body.semesters.length > 0 ? req.body.semesters.map(Number) : actSems;

      resolvedYear = passedYears[0] || 1;
      resolvedSemester = passedSems[0] || 1;
      resolvedSection = section ? String(section).toUpperCase() : String(activity.section || "ALL").toUpperCase();
    } else {
      if (!facultyId || !subjectId || !departmentId || !year || !semester || !section) {
        return res.status(400).json({
          ok: false,
          error: "facultyId, subjectId, departmentId, year, semester, section required",
        });
      }

      const { data: subject } = await supabase
        .from("subjects")
        .select("id, departments, allotted_faculties")
        .eq("id", subjectId)
        .single();

      if (!subject) {
        return res.status(404).json({ ok: false, error: "Subject not found" });
      }

      if (req.userRole === "FACULTY") {
        const isAllotted = (subject.allotted_faculties || []).some((f) => String(f) === String(req.userId));
        if (!isAllotted) {
          return res.status(403).json({
            ok: false,
            error: "Subject is not allotted to this faculty",
          });
        }
      }

      const deptAllowed = (subject.departments || []).some((d) => String(d) === String(departmentId));
      if (!deptAllowed) {
        return res.status(400).json({
          ok: false,
          error: "Selected department is not mapped to this subject",
        });
      }
    }

    // Check for existing active session
    const { data: existingActive } = await supabase
      .from("sessions")
      .select("*")
      .eq("faculty", facultyId)
      .eq("is_active", true)
      .single();

    if (existingActive) {
      const expiredCheck = await expireIfInactive(existingActive);
      const isRunning = Boolean(expiredCheck?.is_active ?? expiredCheck?.isActive);
      if (isRunning) {
        return res.status(400).json({
          ok: false,
          error: "An active session already exists",
        });
      }
    }

    const radiusMeters = Number(location.radiusMeters || DEFAULT_SESSION_RADIUS_METERS);
    if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) {
      return res.status(400).json({ ok: false, error: "Allowed radius must be greater than 0" });
    }

    const sessionInsertPayload = {
      faculty: facultyId,
      subject: isActivity ? null : subjectId,
      category: isActivity ? "ACTIVITY" : "REGULAR",
      activity_id: isActivity ? activityId : null,
      batch_id: resolvedBatchIds.length > 0 ? resolvedBatchIds[0] : null,
      batch_ids: resolvedBatchIds,
      department: isActivity ? resolvedDepartmentId : departmentId,
      year: isActivity ? Number(resolvedYear) : Number(year),
      semester: isActivity ? Number(resolvedSemester) : Number(semester),
      section: isActivity ? resolvedSection : String(section).toUpperCase(),
      location: {
        lat: Number(location.lat),
        lng: Number(location.lng),
        radiusMeters,
      },
      is_active: true,
      last_activity_at: new Date().toISOString(),
    };

    const { data: session, error: createError } = await supabase
      .from("sessions")
      .insert(sessionInsertPayload)
      .select("*")
      .single();

    if (createError || !session) {
      if (createError?.code === "23505") {
        return res.status(400).json({
          ok: false,
          error: "An active session already exists",
        });
      }
      throw createError || new Error("Failed to start session");
    }

    // Query exact total enrolled students for this class or activity
    let totalStudents = 0;
    if (isActivity) {
      if (resolvedBatchIds.length > 0) {
        const { data: batchesData } = await supabase
          .from("activity_batches")
          .select("student_enrollments")
          .in("id", resolvedBatchIds);
        const uniqueEnrollments = new Set();
        (batchesData || []).forEach((b) => {
          if (Array.isArray(b.student_enrollments)) {
            b.student_enrollments.forEach((e) => uniqueEnrollments.add(String(e).trim().toUpperCase()));
          }
        });
        totalStudents = uniqueEnrollments.size;
      } else {
        const { data: batchesData } = await supabase
          .from("activity_batches")
          .select("student_enrollments")
          .eq("activity_id", activityId);
        const uniqueEnrollments = new Set();
        (batchesData || []).forEach((b) => {
          if (Array.isArray(b.student_enrollments)) {
            b.student_enrollments.forEach((e) => uniqueEnrollments.add(String(e).trim().toUpperCase()));
          }
        });
        totalStudents = uniqueEnrollments.size;
      }

      if (totalStudents === 0 && resolvedDepartmentId) {
        let countQuery = supabase
          .from("students")
          .select("id", { count: "exact", head: true })
          .eq("department", String(resolvedDepartmentId));
        if (resolvedSemester) countQuery = countQuery.eq("semester", Number(resolvedSemester));
        if (resolvedSection && resolvedSection !== "ALL") {
          countQuery = countQuery.eq("section", resolvedSection);
        }
        const { count } = await countQuery;
        totalStudents = count || 0;
      }
    } else {
      // Academic Session: Check if specific subject batches were selected
      if (!academicBatchName && req.body?.batchName) {
        academicBatchName = req.body.batchName;
      }
      if (resolvedBatchIds.length > 0) {
        const { data: batchesData } = await supabase
          .from("subject_batches")
          .select("batch_name, batch_number, student_enrollments")
          .in("id", resolvedBatchIds);
        const uniqueEnrollments = new Set();
        (batchesData || []).forEach((b) => {
          if (b.batch_name && !academicBatchName) academicBatchName = b.batch_name;
          if (Array.isArray(b.student_enrollments)) {
            b.student_enrollments.forEach((e) => uniqueEnrollments.add(String(e).trim().toUpperCase()));
          }
        });
        totalStudents = uniqueEnrollments.size;
      }

      if (totalStudents === 0 && resolvedBatchIds.length === 0) {
        let countQuery = supabase
          .from("students")
          .select("id", { count: "exact", head: true })
          .eq("year", Number(year))
          .eq("semester", Number(semester));

        if (departmentId) {
          countQuery = countQuery.eq("department", String(departmentId));
        }
        const normalizedSection = String(section || "").trim().toUpperCase();
        if (normalizedSection) {
          countQuery = countQuery.eq("section", normalizedSection);
        }
        const { count: totalClassStudents } = await countQuery;
        totalStudents = totalClassStudents || 0;
      }
    }

    const formattedSession = {
      ...session,
      _id: session.id,
      isActive: true,
      startTime: session.start_time,
      lastActivityAt: session.last_activity_at,
      totalStudents,
      totalStrength: totalStudents,
      years: isActivity ? (Array.isArray(req.body.years) ? req.body.years : [session.year]) : [session.year],
      semesters: isActivity ? (Array.isArray(req.body.semesters) ? req.body.semesters : [session.semester]) : [session.semester],
      activityName: req.body.activityName || null,
      batchName: isActivity ? (req.body.batchName || null) : (academicBatchName || req.body.batchName || null),
      batch_ids: resolvedBatchIds,
      batchIds: resolvedBatchIds,
    };

    const qrToken = await generateQRToken({
      sessionId: session.id,
      facultyId,
      subjectId: isActivity ? undefined : subjectId,
      location: session.location,
    });
    const secretKey = await getOrCreateSessionSecret(session.id);

    return res.json({
      ok: true,
      session: formattedSession,
      qr: qrToken,
      secretKey,
      totalStudents,
      totalStrength: totalStudents,
    });
  } catch (err) {
    console.error("Session start error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ----------------------------------------------------
// SESSION STATUS CHECK (LIGHTWEIGHT AUTO-EXPIRY DETECTOR)
// GET /api/faculty/sessions/:id/status
// ----------------------------------------------------
router.get(["/sessions/:id/status", "/session/:id/status"], authMiddleware, async (req, res) => {
  try {
    const sessionId = String(req.params.id);
    const supabase = getSupabaseClient();
    if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

    const { data: session, error } = await supabase
      .from("sessions")
      .select("id, is_active")
      .eq("id", sessionId)
      .single();

    if (error || !session) {
      return res.json({ ok: true, isActive: false, sessionId });
    }

    return res.json({
      ok: true,
      isActive: Boolean(session.is_active),
      sessionId,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
});

// ----------------------------------------------------
// SESSION ROSTER SNAPSHOT (ATOMIC INITIAL ROSTER STATE)
// GET /api/faculty/sessions/:id/roster-snapshot
// ----------------------------------------------------
router.get(["/sessions/:id/roster-snapshot", "/session/:id/roster-snapshot"], authMiddleware, async (req, res) => {
  try {
    const sessionId = String(req.params.id);
    const supabase = getSupabaseClient();
    if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

    const { data: session, error: sessErr } = await supabase
      .from("sessions")
      .select(`
        id, faculty, subject, category, activity_id, batch_id, batch_ids, department, year, semester, section, is_active, start_time,
        subj:subjects(id, name, code, created_by_admin, departments, allotted_faculties),
        activity:activities(id, name, type, years, semesters, semester, section, department)
      `)
      .eq("id", sessionId)
      .single();

    if (sessErr || !session) {
      return res.status(404).json({ ok: false, error: "Session not found" });
    }

    if (req.userRole === "FACULTY") {
      const isDirectFaculty = String(session.faculty) === String(req.userId);
      const isSubjectAllotted =
        Array.isArray(session.subj?.allotted_faculties) &&
        session.subj.allotted_faculties.some((f) => String(f) === String(req.userId));
      const isActivityOwner = session.category === "ACTIVITY" && isDirectFaculty;
      if (!isDirectFaculty && !isSubjectAllotted && !isActivityOwner) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }
    }

    // Fetch recorded attendances
    const { data: rawAttendances } = await supabase
      .from("attendances")
      .select(`
        id, student, timestamp, status, device_fingerprint, face_verification, location,
        enrollment_no, student_name, student_email,
        profile:students(id, name, enrollment_no, email, profile_photo_url)
      `)
      .eq("session", sessionId)
      .order("timestamp", { ascending: false });

    const rawList = rawAttendances || [];
    const recordedStudentIds = new Set();
    const recordedEnrollmentNos = new Set();
    const presentStudentIds = new Set();
    const presentEnrollmentNos = new Set();

    const recordedRecords = rawList.map((att) => {
      const studentObj = (Array.isArray(att.profile) ? att.profile[0] : att.profile) || {};
      const effectiveEnrollmentNo = studentObj.enrollment_no || att.enrollment_no || "";
      const effectiveName = studentObj.name || att.student_name || "Student";
      const effectiveEmail = studentObj.email || att.student_email || "";
      const effectiveStudentId = studentObj.id || att.student || `stud_${effectiveEnrollmentNo}`;
      const status = String(att.status || "present").toLowerCase() === "absent" ? "absent" : "present";

      if (studentObj.id) recordedStudentIds.add(String(studentObj.id));
      if (effectiveEnrollmentNo) recordedEnrollmentNos.add(String(effectiveEnrollmentNo).trim().toUpperCase());

      if (status === "present") {
        if (studentObj.id) presentStudentIds.add(String(studentObj.id));
        if (effectiveEnrollmentNo) presentEnrollmentNos.add(String(effectiveEnrollmentNo).trim().toUpperCase());
      }

      return {
        id: att.id,
        _id: att.id,
        attendanceId: att.id,
        student: {
          id: effectiveStudentId,
          _id: effectiveStudentId,
          name: effectiveName,
          enrollmentNo: effectiveEnrollmentNo,
          email: effectiveEmail,
          profilePhotoUrl: studentObj.profile_photo_url || "",
        },
        enrollmentNo: effectiveEnrollmentNo,
        status,
        timestamp: att.timestamp,
        markedAt: att.timestamp,
      };
    });

    const presentRecords = recordedRecords.filter((r) => r.status === "present");

    // Query enrolled students for this class section OR activity batch
    let allRegisteredStudents = [];

    if (session.category === "ACTIVITY" || session.activity_id) {
      let batchEnrollments = [];
      const effectiveBatchIds = Array.isArray(session.batch_ids) && session.batch_ids.length > 0
        ? session.batch_ids
        : (session.batch_id ? [session.batch_id] : []);

      if (effectiveBatchIds.length > 0) {
        const { data: bDataList } = await supabase
          .from("activity_batches")
          .select("student_enrollments")
          .in("id", effectiveBatchIds);
        const uSet = new Set();
        (bDataList || []).forEach((b) => {
          if (Array.isArray(b.student_enrollments)) {
            b.student_enrollments.forEach((u) => uSet.add(String(u).trim().toUpperCase()));
          }
        });
        batchEnrollments = Array.from(uSet);
      } else if (session.activity_id) {
        const { data: batchesData } = await supabase
          .from("activity_batches")
          .select("student_enrollments")
          .eq("activity_id", session.activity_id);
        const uSet = new Set();
        (batchesData || []).forEach((b) => {
          if (Array.isArray(b.student_enrollments)) {
            b.student_enrollments.forEach((u) => uSet.add(String(u).trim().toUpperCase()));
          }
        });
        batchEnrollments = Array.from(uSet);
      }

      if (batchEnrollments.length > 0) {
        const cleanUsns = batchEnrollments.map((u) => String(u).trim().toUpperCase()).filter(Boolean);
        const { data: batchStudents } = await supabase
          .from("students")
          .select("id, name, enrollment_no, email, profile_photo_url, department, year, semester, section")
          .in("enrollment_no", cleanUsns);

        const stuMap = new Map((batchStudents || []).map((s) => [String(s.enrollment_no).trim().toUpperCase(), s]));
        allRegisteredStudents = cleanUsns.map((usn) => {
          const found = stuMap.get(usn);
          if (found) return found;
          return {
            id: `ext_${usn}`,
            name: usn,
            enrollment_no: usn,
            email: "",
            profile_photo_url: "",
            department: session.department,
            year: session.year,
            semester: session.semester,
            section: session.section,
          };
        });
      } else {
        // Fallback: Query all students in activity cohort
        let actQuery = supabase
          .from("students")
          .select("id, name, enrollment_no, email, profile_photo_url, department, year, semester, section")
          .order("enrollment_no", { ascending: true });

        const deptId = session.department || session.activity?.department;
        if (deptId) {
          actQuery = actQuery.eq("department", String(deptId));
        }

        const actYears = Array.isArray(session.activity?.years) && session.activity.years.length > 0
          ? session.activity.years
          : (session.year ? [Number(session.year)] : []);
        if (actYears.length === 1) {
          actQuery = actQuery.eq("year", actYears[0]);
        } else if (actYears.length > 1) {
          actQuery = actQuery.in("year", actYears);
        }

        const actSems = Array.isArray(session.activity?.semesters) && session.activity.semesters.length > 0
          ? session.activity.semesters
          : (session.semester ? [Number(session.semester)] : []);
        if (actSems.length === 1) {
          actQuery = actQuery.eq("semester", actSems[0]);
        } else if (actSems.length > 1) {
          actQuery = actQuery.in("semester", actSems);
        }

        const actSec = session.section || session.activity?.section;
        if (actSec && String(actSec).toUpperCase() !== "ALL") {
          actQuery = actQuery.eq("section", String(actSec).trim().toUpperCase());
        }

        const { data: actStudents } = await actQuery;
        allRegisteredStudents = actStudents || [];
      }
    } else {
      const effectiveBatchIds = Array.isArray(session.batch_ids) && session.batch_ids.length > 0
        ? session.batch_ids
        : (session.batch_id ? [session.batch_id] : []);

      if (effectiveBatchIds.length > 0) {
        const { data: bDataList } = await supabase
          .from("subject_batches")
          .select("student_enrollments")
          .in("id", effectiveBatchIds);
        const uSet = new Set();
        (bDataList || []).forEach((b) => {
          if (Array.isArray(b.student_enrollments)) {
            b.student_enrollments.forEach((u) => uSet.add(String(u).trim().toUpperCase()));
          }
        });

        if (uSet.size > 0) {
          const cleanUsns = Array.from(uSet);
          const { data: batchStudents } = await supabase
            .from("students")
            .select("id, name, enrollment_no, email, profile_photo_url, department, year, semester, section")
            .in("enrollment_no", cleanUsns);

          const stuMap = new Map((batchStudents || []).map((s) => [String(s.enrollment_no).trim().toUpperCase(), s]));
          allRegisteredStudents = cleanUsns.map((usn) => {
            const found = stuMap.get(usn);
            if (found) return found;
            return {
              id: `ext_${usn}`,
              name: usn,
              enrollment_no: usn,
              year: session.year,
              semester: session.semester,
              section: session.section,
            };
          });
        }
      }

      if (allRegisteredStudents.length === 0 && effectiveBatchIds.length === 0) {
        let studentQuery = supabase
          .from("students")
          .select("id, name, enrollment_no, email, profile_photo_url, department, year, semester, section")
          .eq("year", Number(session.year))
          .eq("semester", Number(session.semester));

        const normalizedSec = String(session.section || "").trim().toUpperCase();
        if (normalizedSec) {
          studentQuery = studentQuery.eq("section", normalizedSec);
        }
        if (session.department) {
          studentQuery = studentQuery.eq("department", String(session.department));
        }

        const { data: studentsList } = await studentQuery;
        allRegisteredStudents = studentsList || [];

        if (!session.department && Array.isArray(session.subj?.departments) && session.subj.departments.length > 0) {
          allRegisteredStudents = allRegisteredStudents.filter((stu) =>
            session.subj.departments.some((d) => String(d) === String(stu.department))
          );
        }
      }
    }

    const derivedAbsentRecords = [];
    for (const stu of allRegisteredStudents) {
      const sid = String(stu.id);
      const eno = String(stu.enrollment_no || "").trim().toUpperCase();
      if (!recordedStudentIds.has(sid) && (!eno || !recordedEnrollmentNos.has(eno))) {
        derivedAbsentRecords.push({
          id: `derived-absent-${stu.id}`,
          _id: `derived-absent-${stu.id}`,
          attendanceId: null,
          student: {
            id: stu.id,
            _id: stu.id,
            name: stu.name || "Student",
            enrollmentNo: stu.enrollment_no || "",
            email: stu.email || "",
            profilePhotoUrl: stu.profile_photo_url || "",
          },
          enrollmentNo: stu.enrollment_no || "",
          status: "absent",
          timestamp: null,
          markedAt: null,
        });
      }
    }

    const allAbsentRecords = [
      ...recordedRecords.filter((r) => r.status === "absent"),
      ...derivedAbsentRecords,
    ];

    const totalStudents = Math.max(
      allRegisteredStudents.length,
      presentRecords.length + allAbsentRecords.length
    );

    return res.json({
      ok: true,
      sessionId,
      attendance: [...presentRecords, ...allAbsentRecords],
      presentRecords,
      absentRecords: allAbsentRecords,
      presentCount: presentRecords.length,
      absentCount: allAbsentRecords.length,
      totalStudents,
      totalStrength: totalStudents,
    });
  } catch (err) {
    console.error("Roster snapshot error:", err);
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
});

// ----------------------------------------------------
// SESSION STOP
// POST /api/faculty/session/:id/stop
// ----------------------------------------------------
router.post("/session/:id/stop", authMiddleware, async (req, res) => {
  try {
    if (req.userRole !== "FACULTY" && req.userRole !== "ADMIN") {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    const sessionId = String(req.params.id);
    const supabase = getSupabaseClient();
    if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

    // Clean up QR, Secret, realtime channel, and active session memory cache
    await clearSessionQR(sessionId);
    await clearSessionSecret(sessionId);
    await removeSessionChannel(sessionId);
    if (typeof invalidateCachedSession === "function") {
      invalidateCachedSession(sessionId);
    }

    const facultyId = req.userRole === "FACULTY" ? req.userId : null;

    // Invoke atomic finalization stored procedure in PostgreSQL
    let rpcRes = null;
    try {
      rpcRes = await supabase.rpc("finalize_session_atomic", {
        p_session_id: sessionId,
        p_faculty_id: facultyId,
      });
    } catch (rpcErr) {
      console.warn("finalize_session_atomic RPC invoke error:", rpcErr?.message || rpcErr);
    }

    const rpcData = rpcRes?.data;
    const rpcError = rpcRes?.error;

    if (!rpcError && rpcData) {
      if (!rpcData.ok) {
        if (rpcData.already_stopped || rpcData.error_code === "CONFLICT") {
          const session = rpcData.session || {};
          return res.json({
            ok: true,
            session: {
              ...session,
              _id: session.id,
              isActive: false,
              endTime: session.end_time,
              lastActivityAt: session.last_activity_at,
            },
            attendeeCount: rpcData.attendee_count ?? 0,
            alreadyStopped: true,
          });
        }
        if (rpcData.error_code === "NOT_FOUND") {
          return res.status(404).json({ ok: false, error: rpcData.error || "Session not found" });
        }
        if (rpcData.error_code === "FORBIDDEN") {
          return res.status(403).json({ ok: false, error: rpcData.error || "Forbidden" });
        }
        return res.status(400).json({ ok: false, error: rpcData.error || "Failed to stop session" });
      }

      const session = rpcData.session || {};
      return res.json({
        ok: true,
        session: {
          ...session,
          _id: session.id,
          isActive: false,
          endTime: session.end_time,
          lastActivityAt: session.last_activity_at,
        },
        attendeeCount: rpcData.attendee_count ?? 0,
      });
    }

    // Resilient fallback in case RPC is not yet registered in database
    let updateQuery = supabase
      .from("sessions")
      .update({
        is_active: false,
        end_time: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId)
      .eq("is_active", true);

    if (req.userRole === "FACULTY") {
      updateQuery = updateQuery.eq("faculty", req.userId);
    }

    const { data: session, error } = await updateQuery
      .select(
        "id, faculty, subject, department, year, semester, section, " +
        "start_time, end_time, last_activity_at, is_active, location"
      )
      .single();

    if (error || !session) {
      let existingQuery = supabase
        .from("sessions")
        .select(
          "id, faculty, subject, department, year, semester, section, " +
          "start_time, end_time, last_activity_at, is_active, location"
        )
        .eq("id", sessionId);
      if (req.userRole === "FACULTY") existingQuery = existingQuery.eq("faculty", req.userId);
      const { data: existing } = await existingQuery.single();

      if (!existing) {
        return res.status(404).json({ ok: false, error: "Session not found" });
      }
      return res.json({
        ok: true,
        session: { ...existing, _id: existing.id, isActive: false },
        alreadyStopped: true,
      });
    }

    return res.json({
      ok: true,
      session: {
        ...session,
        _id: session.id,
        isActive: false,
        endTime: session.end_time,
        lastActivityAt: session.last_activity_at,
      },
    });
  } catch (err) {
    console.error("Session stop error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ----------------------------------------------------
// SESSION CANCEL (ROLLBACK MISTAKE)
// POST /api/faculty/session/:id/cancel
// ----------------------------------------------------
router.post("/session/:id/cancel", authMiddleware, async (req, res) => {
  try {
    if (req.userRole !== "FACULTY" && req.userRole !== "ADMIN") {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    const sessionId = String(req.params.id);
    const supabase = getSupabaseClient();
    if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

    let fetchQuery = supabase.from("sessions").select("id, faculty").eq("id", sessionId);
    if (req.userRole === "FACULTY") fetchQuery = fetchQuery.eq("faculty", req.userId);
    const { data: session } = await fetchQuery.single();

    if (!session) {
      return res.json({
        ok: true,
        canceled: true,
        alreadyGone: true,
        deletedAttendanceCount: 0,
      });
    }

    // 1. Clean in-memory and ephemeral state stores & realtime channel
    await clearSessionQR(sessionId);
    await clearSessionSecret(sessionId);
    await removeSessionChannel(sessionId);

    // 2. Cascade delete dependent database records in safe foreign-key order
    try {
      await supabase.from("attendance_audits").delete().eq("session", sessionId);
    } catch {}

    try {
      await supabase.from("scan_grants").delete().eq("session_id", sessionId);
    } catch {}

    try {
      await supabase.from("qr_states").delete().eq("session_id", sessionId);
    } catch {}

    try {
      await supabase.from("totp_secrets").delete().eq("session_id", sessionId);
    } catch {}

    // 3. Delete attendance records from this session
    let deletedAttendanceCount = 0;
    try {
      const { data: deletedAttendances } = await supabase
        .from("attendances")
        .delete()
        .eq("session", sessionId)
        .select("id");
      deletedAttendanceCount = (deletedAttendances || []).length;
    } catch {}

    // 4. Delete the session row itself
    const { error: deleteError } = await supabase.from("sessions").delete().eq("id", sessionId);

    // Fallback: If hard delete failed due to external constraint, mark inactive so session is never stuck
    if (deleteError) {
      await supabase
        .from("sessions")
        .update({
          is_active: false,
          end_time: new Date().toISOString(),
          last_activity_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", sessionId);
    }

    return res.json({
      ok: true,
      canceled: true,
      deletedAttendanceCount,
    });
  } catch (err) {
    console.error("Session cancel error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ----------------------------------------------------
// GET LIVE QR (ROTATING)
// GET /api/faculty/session/:id/qr
// ----------------------------------------------------
router.get("/session/:id/qr", authMiddleware, async (req, res) => {
  try {
    if (req.userRole !== "FACULTY" && req.userRole !== "ADMIN") {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    const sessionId = req.params.id;
    const supabase = getSupabaseClient();
    if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

    let query = supabase
      .from("sessions")
      .select(
        "id, faculty, subject, department, year, semester, section, " +
        "start_time, end_time, last_activity_at, is_active, location, created_at"
      )
      .eq("id", sessionId);
    if (req.userRole === "FACULTY") query = query.eq("faculty", req.userId);
    let { data: session } = await query.single();

    if (!session) {
      return res.status(404).json({ ok: false, error: "Session not found" });
    }

    session = await expireIfInactive(session);
    const isRunning = Boolean(session?.is_active ?? session?.isActive);
    if (!session || !isRunning) {
      await clearSessionQR(sessionId);
      return res.status(400).json({ ok: false, error: "Session inactive" });
    }

    await touchSession(session.id);

    const qrTiming = await generateQRTokenWithTiming({
      sessionId: session.id,
      facultyId: String(session.faculty),
      subjectId: session.subject ? String(session.subject) : undefined,
      location: session.location,
    });
    const secretKey = await getOrCreateSessionSecret(session.id);

    return res.json({
      ok: true,
      qr: qrTiming.token,
      secretKey,
      qrRotationSeconds: qrTiming.rotationSeconds,
      nextRefreshInMs: qrTiming.nextRefreshInMs,
    });
  } catch (err) {
    console.error("QR fetch error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ----------------------------------------------------
// GET /api/faculty/session-roster-history
// Bidirectional Batch-Merging & Splitting Ledger History
// ----------------------------------------------------
router.get("/session-roster-history", authMiddleware, async (req, res) => {
  try {
    const {
      subjectId,
      activityId,
      departmentId,
      year,
      semester,
      section,
      batchId,
    } = req.query;

    const supabase = getSupabaseClient();
    if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

    const cleanId = (val) => {
      if (val === undefined || val === null) return null;
      const s = String(val).trim();
      if (!s || s === "undefined" || s === "null" || s === "all" || s === "ALL") return null;
      return s;
    };
    const isUuid = (val) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(val || "").trim());

    const cleanSubjId = cleanId(subjectId);
    const cleanActId = cleanId(activityId);
    const cleanDeptId = cleanId(departmentId);
    const cleanBatchId = cleanId(batchId);

    const isActivity = Boolean(cleanActId);

    let batches = [];
    let sessions = [];
    let students = [];
    let attendances = [];

    if (isActivity) {
      if (!isUuid(cleanActId)) {
        return res.status(400).json({ ok: false, error: "Invalid activity ID" });
      }

      const { data: activity, error: actErr } = await supabase
        .from("activities")
        .select("id, name, type, department, years, semesters, semester, section, faculty")
        .eq("id", cleanActId)
        .single();

      if (actErr || !activity) {
        return res.status(404).json({ ok: false, error: "Activity not found" });
      }

      if (req.userRole === "FACULTY" && String(activity.faculty) !== String(req.userId)) {
        return res.status(403).json({ ok: false, error: "Forbidden: Not your activity" });
      }

      // Fetch Batches
      const { data: actBatches } = await supabase
        .from("activity_batches")
        .select("id, batch_number, batch_name, student_enrollments")
        .eq("activity_id", cleanActId)
        .order("batch_number", { ascending: true });
      batches = actBatches || [];

      // Fetch Sessions
      let sessQuery = supabase
        .from("sessions")
        .select("id, year, semester, section, department, start_time, end_time, is_active, faculty, batch_id, batch_ids, fac:faculties(id, name)")
        .eq("activity_id", cleanActId)
        .order("start_time", { ascending: true });

      const { data: rawSessions } = await sessQuery;
      const batchMap = new Map(batches.map((b) => [String(b.id), b]));

      sessions = (rawSessions || []).map((s) => {
        let bName = null;
        if (s.batch_id && batchMap.has(String(s.batch_id))) {
          const b = batchMap.get(String(s.batch_id));
          bName = b.batch_name || `Batch ${b.batch_number}`;
        }
        return {
          id: s.id,
          _id: s.id,
          startTime: s.start_time,
          endTime: s.end_time,
          start_time: s.start_time,
          end_time: s.end_time,
          isActive: s.is_active,
          batch_id: s.batch_id || null,
          batch_ids: s.batch_ids || [],
          batchName: bName,
          faculty: s.faculty,
          fac: s.fac,
        };
      });

      // Fetch Students
      let enrolledUsns = new Set();
      batches.forEach((b) => {
        if (Array.isArray(b.student_enrollments)) {
          b.student_enrollments.forEach((u) => {
            const clean = String(u || "").trim().toUpperCase();
            if (clean) enrolledUsns.add(clean);
          });
        }
      });

      if (enrolledUsns.size > 0) {
        const usnArray = Array.from(enrolledUsns);
        const { data: matchedStudents } = await supabase
          .from("students")
          .select("id, name, enrollment_no, email, profile_photo_url, department, year, semester, section")
          .in("enrollment_no", usnArray);

        const matchedMap = new Map();
        (matchedStudents || []).forEach((s) => {
          matchedMap.set(String(s.enrollment_no || "").trim().toUpperCase(), s);
        });

        students = usnArray.map((usn) => {
          const s = matchedMap.get(usn);
          const assignedBatch = batches.find(
            (b) => Array.isArray(b.student_enrollments) && b.student_enrollments.some((e) => String(e).trim().toUpperCase() === usn)
          );
          return {
            id: s?.id || `ext_${usn}`,
            _id: s?.id || `ext_${usn}`,
            name: s?.name || "Student",
            enrollmentNo: usn,
            enrollment_no: usn,
            email: s?.email || "",
            profilePhotoUrl: s?.profile_photo_url || "",
            batchId: assignedBatch?.id || null,
            batchName: assignedBatch?.batch_name || (assignedBatch?.batch_number ? `Batch ${assignedBatch.batch_number}` : null),
          };
        });
      } else {
        let stuQuery = supabase
          .from("students")
          .select("id, name, enrollment_no, email, profile_photo_url, department, year, semester, section")
          .order("enrollment_no", { ascending: true });

        if (activity.department) stuQuery = stuQuery.eq("department", activity.department);
        if (activity.section && String(activity.section).toUpperCase() !== "ALL") {
          stuQuery = stuQuery.eq("section", String(activity.section).trim().toUpperCase());
        }
        const { data: deptStudents } = await stuQuery;
        students = (deptStudents || []).map((s) => ({
          id: s.id,
          _id: s.id,
          name: s.name || "Student",
          enrollmentNo: s.enrollment_no || "",
          enrollment_no: s.enrollment_no || "",
          email: s.email || "",
          profilePhotoUrl: s.profile_photo_url || "",
          batchId: null,
          batchName: null,
        }));
      }
    } else {
      if (!cleanSubjId || !isUuid(cleanSubjId)) {
        return res.status(400).json({ ok: false, error: "Valid subjectId required" });
      }

      const { data: subjectCheck, error: subjectCheckErr } = await supabase
        .from("subjects")
        .select("id, name, code, created_by_admin, departments, allotted_faculties, year, semester")
        .eq("id", cleanSubjId)
        .single();

      if (subjectCheckErr || !subjectCheck) {
        return res.status(404).json({ ok: false, error: "Subject not found" });
      }

      if (req.userRole === "FACULTY") {
        const isAllotted =
          Array.isArray(subjectCheck?.allotted_faculties) &&
          subjectCheck.allotted_faculties.some((f) => String(f) === String(req.userId));
        if (!isAllotted) {
          return res.status(403).json({ ok: false, error: "Forbidden: Not allotted to subject" });
        }
      }

      // Fetch Batches
      const { data: subBatches } = await supabase
        .from("subject_batches")
        .select("id, batch_number, batch_name, student_enrollments")
        .eq("subject_id", cleanSubjId)
        .order("batch_number", { ascending: true });
      batches = subBatches || [];

      // Fetch Sessions
      let sessQuery = supabase
        .from("sessions")
        .select("id, year, semester, section, department, start_time, end_time, is_active, faculty, batch_id, batch_ids, fac:faculties(id, name)")
        .eq("subject", cleanSubjId)
        .eq("is_active", false)
        .order("start_time", { ascending: true });

      if (cleanDeptId && isUuid(cleanDeptId)) {
        sessQuery = sessQuery.eq("department", cleanDeptId);
      }
      if (year && !isNaN(Number(year))) {
        sessQuery = sessQuery.eq("year", Number(year));
      }
      if (semester && !isNaN(Number(semester))) {
        sessQuery = sessQuery.eq("semester", Number(semester));
      }
      if (section && String(section).trim() && String(section).toUpperCase() !== "ALL") {
        sessQuery = sessQuery.eq("section", String(section).trim().toUpperCase());
      }

      const { data: rawSessions } = await sessQuery;
      const batchMap = new Map(batches.map((b) => [String(b.id), b]));

      sessions = (rawSessions || []).map((s) => {
        let bName = null;
        if (s.batch_id && batchMap.has(String(s.batch_id))) {
          const b = batchMap.get(String(s.batch_id));
          bName = b.batch_name || `Batch ${b.batch_number}`;
        }
        return {
          id: s.id,
          _id: s.id,
          startTime: s.start_time,
          endTime: s.end_time,
          start_time: s.start_time,
          end_time: s.end_time,
          isActive: s.is_active,
          batch_id: s.batch_id || null,
          batch_ids: s.batch_ids || [],
          batchName: bName,
          faculty: s.faculty,
          fac: s.fac,
        };
      });

      // Fetch Students
      let stuQuery = supabase
        .from("students")
        .select("id, name, enrollment_no, email, profile_photo_url, department, year, semester, section")
        .order("enrollment_no", { ascending: true });

      const adminId = subjectCheck?.created_by_admin || req.user?.created_by_admin;
      if (adminId) stuQuery = stuQuery.eq("created_by_admin", String(adminId));

      if (cleanDeptId && isUuid(cleanDeptId)) {
        stuQuery = stuQuery.eq("department", cleanDeptId);
      } else if (Array.isArray(subjectCheck?.departments) && subjectCheck.departments.length > 0) {
        stuQuery = stuQuery.in("department", subjectCheck.departments);
      }

      const targetYear = year && !isNaN(Number(year)) ? Number(year) : (subjectCheck?.year ? Number(subjectCheck.year) : null);
      if (targetYear) stuQuery = stuQuery.eq("year", targetYear);

      const targetSem = semester && !isNaN(Number(semester)) ? Number(semester) : (subjectCheck?.semester ? Number(subjectCheck.semester) : null);
      if (targetSem) stuQuery = stuQuery.eq("semester", targetSem);

      if (section && String(section).trim() && String(section).toUpperCase() !== "ALL") {
        stuQuery = stuQuery.eq("section", String(section).trim().toUpperCase());
      }

      const { data: rawStudents } = await stuQuery;
      students = (rawStudents || []).map((s) => {
        const sUsn = String(s.enrollment_no || "").trim().toUpperCase();
        const assignedBatch = batches.find(
          (b) => Array.isArray(b.student_enrollments) && b.student_enrollments.some((e) => String(e).trim().toUpperCase() === sUsn)
        );
        return {
          id: s.id,
          _id: s.id,
          name: s.name || "Student",
          enrollmentNo: s.enrollment_no || "",
          enrollment_no: s.enrollment_no || "",
          email: s.email || "",
          profilePhotoUrl: s.profile_photo_url || "",
          department: s.department,
          year: s.year,
          semester: s.semester,
          section: s.section,
          batchId: assignedBatch?.id || null,
          batchName: assignedBatch?.batch_name || (assignedBatch?.batch_number ? `Batch ${assignedBatch.batch_number}` : null),
        };
      });
    }

    // Fetch recorded attendances for all returned sessions
    const sessionIds = sessions.map((s) => String(s.id));
    if (sessionIds.length > 0) {
      const { data: rawAttendances } = await supabase
        .from("attendances")
        .select("id, session, student, faculty, enrollment_no, student_name, student_email, timestamp, status, batch_id")
        .in("session", sessionIds)
        .order("timestamp", { ascending: false });

      attendances = (rawAttendances || []).map((att) => ({
        id: att.id,
        _id: att.id,
        attendanceId: att.id,
        sessionId: att.session,
        session: att.session,
        student: att.student,
        enrollmentNo: att.enrollment_no || "",
        enrollment_no: att.enrollment_no || "",
        status: att.status || "present",
        timestamp: att.timestamp,
        batch_id: att.batch_id || null,
      }));
    }

    if (cleanBatchId) {
      const targetBatch = batches.find((b) => String(b.id) === String(cleanBatchId));
      if (targetBatch && Array.isArray(targetBatch.student_enrollments)) {
        const batchUsnSet = new Set(
          targetBatch.student_enrollments.map((u) => String(u || "").trim().toUpperCase())
        );

        // 1. Filter students to ONLY enrolled students of this batch
        students = students.filter((s) => {
          const usn = String(s.enrollmentNo || s.enrollment_no || "").trim().toUpperCase();
          return batchUsnSet.has(usn);
        });

        // 2. Filter sessions to full-strength class sessions (batch_id is null / empty)
        // PLUS sessions specifically conducted for this batch (batch_id === cleanBatchId or batch_ids contains cleanBatchId)
        sessions = sessions.filter((s) => {
          const isFullClass = !s.batch_id && (!s.batch_ids || s.batch_ids.length === 0);
          const isThisBatch =
            String(s.batch_id) === String(cleanBatchId) ||
            (Array.isArray(s.batch_ids) && s.batch_ids.map(String).includes(String(cleanBatchId)));
          return isFullClass || isThisBatch;
        });

        // 3. Filter attendances to only records for this batch's students and sessions
        const allowedSessionIds = new Set(sessions.map((s) => String(s.id)));
        attendances = attendances.filter((att) => {
          const usn = String(att.enrollmentNo || att.enrollment_no || "").trim().toUpperCase();
          const sid = String(att.sessionId || att.session || "");
          return batchUsnSet.has(usn) && allowedSessionIds.has(sid);
        });
      }
    } else {
      // BATCHES REMOVED or NO BATCH SELECTED (Single default batch view for entire class):
      // "date will be assigned based on majority records"
      // If multiple sessions occurred on the same calendar date (e.g. historical batch sessions),
      // collapse them into 1 canonical session having the majority attendance records on that date.
      if (sessions.length > 0) {
        // 1. Count attendance per session
        const sessionAttCount = new Map();
        attendances.forEach((att) => {
          const sid = String(att.sessionId || att.session || "");
          sessionAttCount.set(sid, (sessionAttCount.get(sid) || 0) + 1);
        });

        // 2. Group sessions by calendar date (YYYY-MM-DD in UTC / local)
        const sessionsByDate = new Map();
        sessions.forEach((s) => {
          const rawDate = s.start_time || s.startTime || "";
          const dateKey = rawDate ? String(rawDate).slice(0, 10) : `session_${s.id}`;
          if (!sessionsByDate.has(dateKey)) sessionsByDate.set(dateKey, []);
          sessionsByDate.get(dateKey).push(s);
        });

        const canonicalSessions = [];
        const sessionAliasMap = new Map(); // otherSessionId -> canonicalSessionId

        sessionsByDate.forEach((dateSessions) => {
          if (dateSessions.length === 1) {
            canonicalSessions.push(dateSessions[0]);
          } else {
            // Find majority session (session with the maximum attendances on this date)
            let majoritySession = dateSessions[0];
            let maxCount = sessionAttCount.get(String(majoritySession.id)) || 0;

            for (let i = 1; i < dateSessions.length; i++) {
              const cur = dateSessions[i];
              const curCount = sessionAttCount.get(String(cur.id)) || 0;
              if (curCount > maxCount) {
                majoritySession = cur;
                maxCount = curCount;
              }
            }

            canonicalSessions.push({
              ...majoritySession,
              batch_id: null,
              batch_ids: [],
              batchName: null,
            });

            const canonId = String(majoritySession.id);
            dateSessions.forEach((s) => {
              sessionAliasMap.set(String(s.id), canonId);
            });
          }
        });

        sessions = canonicalSessions.sort((a, b) => {
          const tA = new Date(a.start_time || a.startTime || 0).getTime();
          const tB = new Date(b.start_time || b.startTime || 0).getTime();
          return tA - tB;
        });

        // 3. Remap and deduplicate attendances onto canonical session columns
        const seenStudentSession = new Set();
        const mergedAttendances = [];

        attendances.forEach((att) => {
          const originalSid = String(att.sessionId || att.session || "");
          const canonicalSid = sessionAliasMap.get(originalSid) || originalSid;
          const usn = String(att.enrollmentNo || att.enrollment_no || att.student || "").trim().toUpperCase();
          const dedupeKey = `${usn}|${canonicalSid}`;

          if (!seenStudentSession.has(dedupeKey)) {
            seenStudentSession.add(dedupeKey);
            mergedAttendances.push({
              ...att,
              session: canonicalSid,
              sessionId: canonicalSid,
            });
          } else if (String(att.status).toLowerCase() === "present") {
            const existing = mergedAttendances.find(
              (m) =>
                String(m.enrollmentNo || m.enrollment_no || "").trim().toUpperCase() === usn &&
                String(m.sessionId || m.session) === canonicalSid
            );
            if (existing) {
              existing.status = "present";
            }
          }
        });

        attendances = mergedAttendances;
      }
    }

    return res.json({
      ok: true,
      sessions,
      batches,
      students,
      attendance: attendances,
      attendances,
      count: attendances.length,
    });
  } catch (err) {
    console.error("Session roster history error:", err);
    return res.status(500).json({ ok: false, error: err.message || "Failed to fetch session roster history" });
  }
});

module.exports = router;
