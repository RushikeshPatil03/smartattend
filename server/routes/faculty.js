const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");

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
    .select("*")
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
      .select("*")
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
      .select("*")
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
      .select("*")
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
      .select("*")
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

    // Query exact total enrolled students for this class
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
    const totalStudents = totalClassStudents || 0;

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
    await expireOldDeviceChangeRequests({ department: deptId });
    await scrubReviewedDeviceRequestPhotos({ department: deptId });

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
        stu:students(id, name, email, enrollment_no, year, semester, section),
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

    const formatted = (requests || []).map((r) => ({
      id: r.id,
      _id: r.id,
      student: r.stu ? { ...r.stu, _id: r.stu.id, enrollmentNo: r.stu.enrollment_no } : r.student,
      department: r.dept ? { ...r.dept, _id: r.dept.id } : r.department,
      reviewedBy: r.rev ? { ...r.rev, _id: r.rev.id } : r.reviewed_by,
      oldDeviceFingerprint: r.old_device_fingerprint,
      requestedDeviceFingerprint: r.requested_device_fingerprint,
      selfieDataUrl: r.status === "pending" ? r.selfie_data_url || "" : "",
      status: r.status,
      expiresAt: r.expires_at,
      reviewedAt: r.reviewed_at,
      reviewNote: r.review_note || "",
      createdAt: r.created_at,
    }));

    return res.json({ ok: true, requests: formatted });
  } catch (err) {
    console.error("Fetch device change requests error:", err);
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
    await expireOldDeviceChangeRequests({ department: deptId });

    const supabase = getSupabaseClient();
    if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

    const { data: request } = await supabase
      .from("device_change_requests")
      .select("*")
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
        status,
        expires_at,
        reviewed_by,
        reviewed_at,
        review_note,
        created_at,
        stu:students(id, name, email, enrollment_no, year, semester, section),
        dept:departments(id, name, code),
        rev:faculties(id, name, email)
      `)
      .single();

    if (updateReqErr || !updatedRequest) throw updateReqErr || new Error("Failed to review request");

    const formatted = {
      id: updatedRequest.id,
      _id: updatedRequest.id,
      student: updatedRequest.stu ? { ...updatedRequest.stu, _id: updatedRequest.stu.id, enrollmentNo: updatedRequest.stu.enrollment_no } : updatedRequest.student,
      department: updatedRequest.dept ? { ...updatedRequest.dept, _id: updatedRequest.dept.id } : updatedRequest.department,
      reviewedBy: updatedRequest.rev ? { ...updatedRequest.rev, _id: updatedRequest.rev.id } : updatedRequest.reviewed_by,
      oldDeviceFingerprint: updatedRequest.old_device_fingerprint,
      requestedDeviceFingerprint: updatedRequest.requested_device_fingerprint,
      selfieDataUrl: "",
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
      .select("id, subject, faculty, department, year, semester, section, class_code, dept:departments(id, name, code)")
      .eq("subject", subjectId)
      .eq("faculty", req.userId)
      .eq("created_by_admin", String(adminId))
      .order("class_code", { ascending: true });

    const assignments = (rawAssignments || []).map((a) => ({
      ...a,
      _id: a.id,
      classCode: a.class_code,
      department: a.dept ? { ...a.dept, _id: a.dept.id } : a.department,
    }));

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

    // Query completed sessions for this subject
    const { data: rawSessions } = await supabase
      .from("sessions")
      .select("id, department, year, semester, section, start_time, end_time, is_active")
      .eq("faculty", req.userId)
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
        .eq("faculty", req.userId)
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
    const sessionInsights = filteredSessions.slice(0, 18).map((session) => {
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

    const { subjectId, departmentId, location, year, semester, section } = req.body || {};

    const facultyId =
      req.userRole === "FACULTY" ? req.userId : String(req.body?.facultyId || req.userId);

    if (!facultyId || !subjectId || !departmentId || !year || !semester || !section) {
      return res.status(400).json({
        ok: false,
        error: "facultyId, subjectId, departmentId, year, semester, section required",
      });
    }

    if (location?.lat == null || location?.lng == null) {
      return res.status(400).json({ ok: false, error: "Session location required" });
    }

    const supabase = getSupabaseClient();
    if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

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

    const { data: session, error: createError } = await supabase
      .from("sessions")
      .insert({
        faculty: facultyId,
        subject: subjectId,
        department: departmentId,
        year: Number(year),
        semester: Number(semester),
        section: String(section).toUpperCase(),
        location: {
          lat: Number(location.lat),
          lng: Number(location.lng),
          radiusMeters,
        },
        is_active: true,
        last_activity_at: new Date().toISOString(),
      })
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

    // Query exact total enrolled students for this class
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
    const totalStudents = totalClassStudents || 0;

    const formattedSession = {
      ...session,
      _id: session.id,
      isActive: true,
      startTime: session.start_time,
      lastActivityAt: session.last_activity_at,
      totalStudents,
      totalStrength: totalStudents,
    };

    const qrToken = await generateQRToken({
      sessionId: session.id,
      facultyId,
      subjectId,
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

    const { data: session, error } = await updateQuery.select("*").single();

    // Clean up QR, Secret, and realtime channel
    await clearSessionQR(sessionId);
    await clearSessionSecret(sessionId);
    await removeSessionChannel(sessionId);

    if (error || !session) {
      let existingQuery = supabase.from("sessions").select("*").eq("id", sessionId);
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

    let query = supabase.from("sessions").select("*").eq("id", sessionId);
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
      subjectId: String(session.subject),
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

module.exports = router;
