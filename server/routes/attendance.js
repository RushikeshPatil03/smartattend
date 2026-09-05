const express = require("express");
const router = express.Router();
const crypto = require("crypto");

const { getSupabaseClient } = require("../config/supabase");
const { verifyQRToken, validateTwoStepQR } = require("../services/qrService");
const {
  verifyTotpSequence,
  verifyConsecutiveTotpTokens,
  recordInstantPresence,
  removeInstantPresence,
  isStudentPresent,
} = require("../services/totpVerification");
const { validateStudentLocation } = require("../services/locationValidation");
const { verifyFaceAgainstStudent } = require("../services/faceVerification");
const { normalizeFingerprint } = require("../services/deviceFingerprint");
const { expireIfInactive, touchSession } = require("../services/sessionLifecycle");
const { broadcastAttendance } = require("../services/realtimeService");
const auth = require("../middleware/auth");
const rateLimit = require("../middleware/rateLimit");
const env = require("../config/env");

const SCAN_GRANT_TTL_MS = env.SCAN_GRANT_TTL_MS;
const QR_VERIFY_MAX_AGE_SECONDS = env.QR_VERIFY_MAX_AGE_SECONDS;
const QR_MAX_TWO_STEP_GAP_SECONDS = env.QR_MAX_TWO_STEP_GAP_SECONDS;
const QR_PRECHECK_SKEW_SECONDS = env.QR_PRECHECK_SKEW_SECONDS;

const scanGrantsMemoryStore = new Map();
const activeSessionsMemoryCache = new Map();
const sessionInflightPromises = new Map();
const ACTIVE_SESSION_CACHE_TTL_MS = 5000;
const ACTIVE_SESSION_CACHE_MAX_SIZE = 200;

function setCachedSession(sid, session) {
  if (activeSessionsMemoryCache.size >= ACTIVE_SESSION_CACHE_MAX_SIZE) {
    const oldestKey = activeSessionsMemoryCache.keys().next().value;
    if (oldestKey) {
      activeSessionsMemoryCache.delete(oldestKey);
    }
  }
  activeSessionsMemoryCache.delete(sid);
  activeSessionsMemoryCache.set(sid, { session, cachedAt: Date.now() });
}

function invalidateCachedSession(sessionId) {
  if (sessionId) {
    activeSessionsMemoryCache.delete(String(sessionId));
  }
}


async function getCachedActiveSession(sessionId) {
  const sid = String(sessionId);
  const cached = activeSessionsMemoryCache.get(sid);
  const now = Date.now();
  if (cached && now - cached.cachedAt < ACTIVE_SESSION_CACHE_TTL_MS) {
    // Refresh LRU order on hit
    activeSessionsMemoryCache.delete(sid);
    activeSessionsMemoryCache.set(sid, cached);
    return cached.session;
  }

  // Deduplicate concurrent inflight requests for the same session ID
  if (sessionInflightPromises.has(sid)) {
    return sessionInflightPromises.get(sid);
  }

  const fetchPromise = (async () => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) return null;

      const { data: rawSession } = await supabase
        .from("sessions")
        .select(`
          id,
          faculty,
          subject,
          department,
          year,
          semester,
          section,
          location,
          is_active,
          start_time,
          last_activity_at,
          subj:subjects(id, name, code, created_by_admin, departments)
        `)
        .eq("id", sid)
        .single();

      if (!rawSession) {
        activeSessionsMemoryCache.delete(sid);
        return null;
      }

      const session = await expireIfInactive(rawSession);
      if (session && (session.is_active || session.isActive)) {
        setCachedSession(sid, session);
      } else {
        activeSessionsMemoryCache.delete(sid);
      }
      return session;
    } finally {
      sessionInflightPromises.delete(sid);
    }
  })();

  sessionInflightPromises.set(sid, fetchPromise);
  return fetchPromise;
}

function cleanupExpiredScanGrants() {
  const now = Date.now();
  for (const [key, value] of scanGrantsMemoryStore.entries()) {
    if (!value || Number(value.expiresAt || 0) <= now) {
      scanGrantsMemoryStore.delete(key);
    }
  }
}

function cleanupExpiredActiveSessions() {
  const now = Date.now();
  for (const [key, cached] of activeSessionsMemoryCache.entries()) {
    if (!cached || now - Number(cached.cachedAt || 0) >= ACTIVE_SESSION_CACHE_TTL_MS) {
      activeSessionsMemoryCache.delete(key);
    }
  }
}

// Background cleanup interval (sweeps orphaned grants and expired sessions every 60s)
const memoryStoresCleanupInterval = setInterval(() => {
  try {
    cleanupExpiredScanGrants();
    cleanupExpiredActiveSessions();
  } catch (err) {
    console.warn("Memory store cleanup warning:", err?.message || err);
  }
}, 60000);

if (memoryStoresCleanupInterval.unref) {
  memoryStoresCleanupInterval.unref();
}

function getRequestMeta(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "");
  const ip = forwarded ? forwarded.split(",")[0].trim() : req.ip || req.socket?.remoteAddress || "unknown";
  const userAgent = String(req.headers["user-agent"] || "").slice(0, 500);
  return { ip, userAgent };
}

async function recordAttendanceAudit(entry) {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  try {
    const fullAudit = {
      attendance: entry.attendanceId || null,
      session: String(entry.sessionId),
      student: entry.studentId ? String(entry.studentId) : null,
      faculty: String(entry.facultyId),
      subject: String(entry.subjectId),
      enrollment_no: entry.enrollmentNo || entry.enrollment_no || null,
      student_name: entry.studentName || entry.student_name || null,
      student_email: entry.studentEmail || entry.student_email || null,
      action: entry.action,
      method: entry.method,
      actor_role: entry.actorRole,
      actor: String(entry.actorId),
      device_fingerprint: String(entry.deviceFingerprint || ""),
      location: entry.location || null,
      qr: entry.qr || null,
      face_verification: entry.faceVerification || null,
      request_meta: entry.requestMeta || null,
    };

    let { error } = await supabase.from("attendance_audits").insert(fullAudit);
    if (error && (error.code === "PGRST204" || error.code === "42703" || String(error.message || "").includes("column"))) {
      const baseAudit = {
        attendance: entry.attendanceId || null,
        session: String(entry.sessionId),
        student: entry.studentId ? String(entry.studentId) : null,
        faculty: String(entry.facultyId),
        subject: String(entry.subjectId),
        action: entry.action,
        method: entry.method,
        actor_role: entry.actorRole,
        actor: String(entry.actorId),
        device_fingerprint: String(entry.deviceFingerprint || ""),
        location: entry.location || null,
        qr: entry.qr || null,
        face_verification: entry.faceVerification || null,
        request_meta: entry.requestMeta || null,
      };
      await supabase.from("attendance_audits").insert(baseAudit);
    }
  } catch (err) {
    console.error("Attendance audit log error:", err.message);
  }
}

async function saveScanGrant({ token, studentId, sessionId, fingerprint }) {
  const expiresAt = Date.now() + SCAN_GRANT_TTL_MS;
  const grant = {
    studentId: String(studentId),
    sessionId: String(sessionId),
    fingerprint: String(fingerprint),
    consumed: false,
    createdAt: Date.now(),
    expiresAt,
  };

  scanGrantsMemoryStore.set(String(token), grant);

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      await supabase.from("scan_grants").upsert({
        grant_token: String(token),
        student_id: String(studentId),
        session_id: String(sessionId),
        fingerprint: String(fingerprint),
        consumed: false,
        expires_at: new Date(expiresAt).toISOString(),
      });
    } catch {
      // Memory store is active
    }
  }
}

async function consumeScanGrant({ token, studentId, sessionId, fingerprint }) {
  const key = String(token);
  let grant = scanGrantsMemoryStore.get(key);

  if (!grant) {
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { data } = await supabase
          .from("scan_grants")
          .select("*")
          .eq("grant_token", key)
          .single();

        if (data && new Date(data.expires_at).getTime() > Date.now()) {
          grant = {
            studentId: String(data.student_id),
            sessionId: String(data.session_id),
            fingerprint: String(data.fingerprint),
            consumed: Boolean(data.consumed),
            expiresAt: new Date(data.expires_at).getTime(),
          };
        }
      } catch {
        // Fallback
      }
    }
  }

  if (!grant || grant.consumed || grant.expiresAt < Date.now()) {
    if (grant && grant.expiresAt < Date.now()) {
      scanGrantsMemoryStore.delete(key);
    }
    return { ok: false, error: "Scan grant invalid or expired" };
  }

  if (
    grant.studentId !== String(studentId) ||
    grant.sessionId !== String(sessionId) ||
    grant.fingerprint !== String(fingerprint)
  ) {
    return { ok: false, error: "Scan grant context mismatch" };
  }

  grant.consumed = true;
  scanGrantsMemoryStore.set(key, grant);

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      await supabase
        .from("scan_grants")
        .update({ consumed: true })
        .eq("grant_token", key);
    } catch {
      // Ignored
    }
  }

  return { ok: true };
}

/**
 * Strict validation of student academic eligibility for an active class session.
 * Enforces college, department, year, semester, and section match.
 */
function validateStudentSessionEligibility(student, session) {
  if (!student || !session) {
    return { ok: false, error: "Invalid student or session context" };
  }

  // 1. College Check
  const subject = session.subj;
  if (
    subject?.created_by_admin &&
    (student.created_by_admin || student.createdByAdmin) &&
    String(subject.created_by_admin) !== String(student.created_by_admin || student.createdByAdmin)
  ) {
    return { ok: false, error: "Student does not belong to this college" };
  }

  // 2. Department Check
  const sessionDept = session.department ? String(session.department) : null;
  const studentDept = student.department ? String(student.department?.id || student.department) : null;
  if (sessionDept && studentDept) {
    if (sessionDept !== studentDept) {
      return { ok: false, error: "Student not enrolled in this session's department" };
    }
  } else if (studentDept && Array.isArray(subject?.departments) && subject.departments.length > 0) {
    if (!subject.departments.some((d) => String(d) === studentDept)) {
      return { ok: false, error: "Student not enrolled in this session's department" };
    }
  }

  // 3. Year & Semester Check
  if (session.year != null && student.year != null && Number(session.year) !== Number(student.year)) {
    return {
      ok: false,
      error: `Academic mismatch: You are in Year ${student.year}, but this lecture is for Year ${session.year}`,
    };
  }
  if (session.semester != null && student.semester != null && Number(session.semester) !== Number(student.semester)) {
    return {
      ok: false,
      error: `Academic mismatch: You are in Semester ${student.semester}, but this lecture is for Semester ${session.semester}`,
    };
  }

  // 4. Section Check (Strict: Case-insensitive, trimmed)
  const sessionSection = String(session.section || "").trim().toUpperCase();
  const studentSection = String(student.section || "").trim().toUpperCase();
  if (sessionSection && studentSection && sessionSection !== studentSection) {
    return {
      ok: false,
      error: `Section mismatch: You are registered in Section ${studentSection}, but this lecture is for Section ${sessionSection}`,
    };
  }

  return { ok: true };
}

// ----------------------------------------------------
// 1) PRECHECK (STUDENT FIRST SCAN)
// POST /api/attendance/precheck
// ----------------------------------------------------
router.post(
  "/precheck",
  auth(["STUDENT"]),
  rateLimit({
    prefix: "precheck",
    windowMs: 60 * 1000,
    max: 20,
  }),
  async (req, res) => {
    try {
      const student = req.user;
      const { qrToken, location, fingerprint } = req.body || {};

      if (!qrToken) {
        return res.status(400).json({ ok: false, error: "QR token required" });
      }

      const normalizedFp = normalizeFingerprint(fingerprint);
      if (!normalizedFp || String(student.device_fingerprint) !== normalizedFp) {
        return res.status(401).json({ ok: false, error: "Device mismatch - unauthorized scan" });
      }

      const precheckMaxAge =
        env.QR_TTL_SECONDS +
        Math.max(QR_PRECHECK_SKEW_SECONDS, QR_VERIFY_MAX_AGE_SECONDS);

      const verified = verifyQRToken(qrToken, {
        allowExpired: true,
        maxAgeSeconds: precheckMaxAge,
      });

      if (!verified.ok) {
        return res.status(400).json({ ok: false, error: verified.error });
      }

      const sessionId = verified.decoded.sessionId;
      const session = await getCachedActiveSession(sessionId);
      if (!session) {
        return res.status(404).json({ ok: false, error: "Session not found" });
      }

      const isRunning = Boolean(session?.is_active ?? session?.isActive);
      if (!isRunning) {
        return res.status(400).json({ ok: false, error: "Session is no longer active" });
      }

      const eligibility = validateStudentSessionEligibility(student, session);
      if (!eligibility.ok) {
        return res.status(403).json({ ok: false, error: eligibility.error });
      }

      const locationCheck = validateStudentLocation(location, session.location);
      if (!locationCheck.ok) {
        return res.status(403).json({ ok: false, error: locationCheck.error });
      }

      // Check if attendance already marked
      const supabase = getSupabaseClient();
      if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

      const { data: existingAttendance } = await supabase
        .from("attendances")
        .select("id, status")
        .eq("session", sessionId)
        .eq("student", student.id)
        .single();

      if (existingAttendance && existingAttendance.status !== "absent") {
        return res.status(409).json({ ok: false, error: "Attendance already marked for this session" });
      }

      const scanGrantToken = crypto.randomBytes(24).toString("hex");
      await saveScanGrant({
        token: scanGrantToken,
        studentId: student.id,
        sessionId,
        fingerprint: normalizedFp,
      });

      return res.json({
        ok: true,
        scanGrantToken,
        firstScannedAt: Date.now(),
        nextScanWithinSeconds: QR_MAX_TWO_STEP_GAP_SECONDS,
        sessionId,
        session: {
          id: session.id,
          _id: session.id,
          subjectName: subject?.name || "Subject",
          subjectCode: subject?.code || "",
          section: session.section,
        },
      });
    } catch (err) {
      console.error("Attendance precheck error:", err);
      return res.status(500).json({ ok: false, error: "Server error" });
    }
  }
);

// ----------------------------------------------------
// 2) MARK ATTENDANCE (TWO-STEP QR)
// POST /api/attendance/mark
// POST /api/attendance/scan-grant/mark
// ----------------------------------------------------
const handleMarkAttendance = async (req, res) => {
    try {
      const student = req.user;
      const {
        scanGrantToken,
        firstQrToken,
        secondQrToken,
        location,
        fingerprint,
        faceMatch,
        faceMetrics,
        faceEmbedding,
      } = req.body || {};

      if (!scanGrantToken || !firstQrToken || !secondQrToken) {
        return res.status(400).json({ ok: false, error: "Two dynamic QR scans & grant token required" });
      }

      const normalizedFp = normalizeFingerprint(fingerprint);
      if (!normalizedFp || String(student.device_fingerprint) !== normalizedFp) {
        return res.status(401).json({ ok: false, error: "Device mismatch - attendance blocked" });
      }

      const firstVerified = verifyQRToken(firstQrToken, {
        allowExpired: true,
        maxAgeSeconds: QR_VERIFY_MAX_AGE_SECONDS,
      });
      const secondVerified = verifyQRToken(secondQrToken, {
        allowExpired: false,
      });

      if (!firstVerified.ok || !secondVerified.ok) {
        return res.status(400).json({ ok: false, error: "QR token expired or invalid" });
      }

      const firstIat = Number(firstVerified.decoded?.iat || 0);
      const secondIat = Number(secondVerified.decoded?.iat || 0);
      const gapSeconds = Math.abs(secondIat - firstIat);
      if (gapSeconds > QR_MAX_TWO_STEP_GAP_SECONDS) {
        return res.status(400).json({ ok: false, error: "Scan timeout between QR rotations. Scan again." });
      }

      const sessionId = secondVerified.decoded.sessionId;
      if (String(firstVerified.decoded.sessionId) !== String(sessionId)) {
        return res.status(400).json({ ok: false, error: "QR scans belong to different sessions" });
      }

      const grantCheck = await consumeScanGrant({
        token: scanGrantToken,
        studentId: student.id,
        sessionId,
        fingerprint: normalizedFp,
      });

      if (!grantCheck.ok) {
        return res.status(400).json({ ok: false, error: grantCheck.error });
      }

      const sequenceCheck = await validateTwoStepQR({
        sessionId,
        firstToken: firstQrToken,
        secondToken: secondQrToken,
      });

      if (!sequenceCheck.ok) {
        return res.status(400).json({ ok: false, error: sequenceCheck.error });
      }

      const session = await getCachedActiveSession(sessionId);
      if (!session) {
        return res.status(404).json({ ok: false, error: "Session not found" });
      }

      const isRunning = Boolean(session?.is_active ?? session?.isActive);
      if (!isRunning) {
        return res.status(400).json({ ok: false, error: "Session is no longer active" });
      }

      const eligibility = validateStudentSessionEligibility(student, session);
      if (!eligibility.ok) {
        return res.status(403).json({ ok: false, error: eligibility.error });
      }

      const locationCheck = validateStudentLocation(location, session.location);
      if (!locationCheck.ok) {
        return res.status(403).json({ ok: false, error: locationCheck.error });
      }

      // Check face verification if enabled
      let faceVerificationResult = {
        verified: true,
        score: Number(faceMetrics?.confidence || 1),
        model: "client-mediapipe-facenet512",
      };

      if (env.REQUIRE_FACE_VERIFICATION || faceMatch != null || faceEmbedding != null) {
        const faceEval = await verifyFaceAgainstStudent(student, {
          faceMatch,
          faceMetrics,
          faceEmbedding,
        });

        if (!faceEval.ok) {
          return res.status(403).json({ ok: false, error: faceEval.error });
        }

        faceVerificationResult = {
          verified: true,
          score: Number(faceEval.score || 1),
          model: faceEval.model || "facenet512",
        };
      }

      // Row-level validation: Direct DB check to verify session is currently active
      const { data: liveSession, error: sessionCheckError } = await supabase
        .from("sessions")
        .select("is_active")
        .eq("id", sessionId)
        .single();

      if (sessionCheckError || !liveSession || !liveSession.is_active) {
        invalidateCachedSession(sessionId);
        return res.status(400).json({ ok: false, error: "Session is no longer active" });
      }

      // Insert Attendance atomically with USN snapshot (with schema-resilient fallback)
      const fullAttendancePayload = {
        session: sessionId,
        student: student.id,
        faculty: session.faculty,
        subject: session.subject,
        enrollment_no: student.enrollment_no || null,
        student_name: student.name || null,
        student_email: student.email || null,
        department_code: student.dept?.code || student.departmentCode || null,
        semester: Number(student.semester || session.semester) || null,
        section: String(student.section || session.section || "").toUpperCase() || null,
        year: Number(student.year || session.year) || null,
        timestamp: new Date().toISOString(),
        status: "present",
        location: {
          lat: Number(location.lat),
          lng: Number(location.lng),
          accuracy: location.accuracy != null ? Number(location.accuracy) : null,
          distanceMeters: locationCheck.distanceMeters != null ? Math.round(locationCheck.distanceMeters) : null,
        },
        device_fingerprint: normalizedFp,
        face_verification: faceVerificationResult,
      };

      let { data: attendance, error: insertError } = await supabase
        .from("attendances")
        .upsert(fullAttendancePayload, { onConflict: "session,student" })
        .select("*")
        .single();

      if (insertError && (insertError.code === "PGRST204" || insertError.code === "42703" || String(insertError.message || "").includes("column"))) {
        const baseAttendancePayload = {
          session: sessionId,
          student: student.id,
          faculty: session.faculty,
          subject: session.subject,
          timestamp: new Date().toISOString(),
          status: "present",
          location: {
            lat: Number(location.lat),
            lng: Number(location.lng),
            accuracy: location.accuracy != null ? Number(location.accuracy) : null,
            distanceMeters: locationCheck.distanceMeters != null ? Math.round(locationCheck.distanceMeters) : null,
          },
          device_fingerprint: normalizedFp,
          face_verification: faceVerificationResult,
        };
        const retryRes = await supabase
          .from("attendances")
          .upsert(baseAttendancePayload, { onConflict: "session,student" })
          .select("*")
          .single();
        attendance = retryRes.data;
        insertError = retryRes.error;
      }

      if (insertError || !attendance) {
        if (insertError?.code === "23505") {
          return res.status(409).json({ ok: false, error: "Attendance already marked for this session" });
        }
        if (String(insertError?.message || "").includes("Session is no longer active")) {
          invalidateCachedSession(sessionId);
          return res.status(400).json({ ok: false, error: "Session is no longer active" });
        }
        throw insertError || new Error("Failed to record attendance");
      }

      // Synchronously capture request metadata before connection ends
      const requestMeta = getRequestMeta(req);

      // Realtime Broadcast Payload
      const attendanceBroadcastPayload = {
        id: attendance.id,
        _id: attendance.id,
        sessionId,
        studentId: student.id,
        studentName: student.name,
        enrollmentNo: student.enrollment_no,
        timestamp: attendance.timestamp,
        status: "present",
        method: "QR_TWO_STEP",
      };

      // 1. Immediately return success response to student
      res.json({
        ok: true,
        attendanceId: attendance.id,
        _id: attendance.id,
        status: "present",
        markedAt: attendance.timestamp,
        session: {
          id: session.id,
          _id: session.id,
          subjectName: session.subj?.name || "Subject",
          subjectCode: session.subj?.code || "",
        },
      });

      // 2. Fire side effects asynchronously (non-blocking) with error handlers
      touchSession(sessionId).catch((err) => {
        console.warn("Background touchSession warning:", err?.message || err);
      });

      recordAttendanceAudit({
        attendanceId: attendance.id,
        sessionId,
        studentId: student.id,
        facultyId: session.faculty,
        subjectId: session.subject,
        enrollmentNo: student.enrollment_no,
        studentName: student.name,
        studentEmail: student.email,
        action: "MARK_PRESENT",
        method: "QR_TWO_STEP",
        actorRole: "STUDENT",
        actorId: student.id,
        deviceFingerprint: normalizedFp,
        location: {
          lat: Number(location.lat),
          lng: Number(location.lng),
          accuracy: Number(location.accuracy || 0),
        },
        qr: { firstIat, secondIat, gapSeconds },
        faceVerification: faceVerificationResult,
        requestMeta,
      }).catch((err) => {
        console.error("Background attendance audit log error:", err?.message || err);
      });

      broadcastAttendance(sessionId, attendanceBroadcastPayload).catch((err) => {
        console.error("Background realtime broadcast error:", err?.message || err);
      });

      return;
    } catch (err) {
      console.error("Mark attendance error:", err);
      return res.status(500).json({ ok: false, error: err?.message || "Server error" });
    }
  };

router.post(
  "/mark",
  auth(["STUDENT"]),
  rateLimit({
    prefix: "mark",
    windowMs: 60 * 1000,
    max: 15,
  }),
  handleMarkAttendance
);

router.post(
  "/scan-grant/mark",
  auth(["STUDENT"]),
  rateLimit({
    prefix: "mark",
    windowMs: 60 * 1000,
    max: 15,
  }),
  handleMarkAttendance
);


// ----------------------------------------------------
// 0) GET ATTENDANCE (GENERAL / ROSTER / FILTERED)
// GET /api/attendance
// ----------------------------------------------------
router.get("/", auth(["FACULTY", "ADMIN", "STUDENT"]), async (req, res) => {
  try {
    const {
      sessionId,
      includeDerivedAbsences,
      subjectId,
      departmentId,
      year,
      semester,
      section,
      startDate,
      endDate,
      date,
      studentId,
    } = req.query;

    const supabase = getSupabaseClient();
    if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

    // Scenario A: Fetch attendance for a specific session (Roster view)
    if (sessionId) {
      const { data: rawSession } = await supabase
        .from("sessions")
        .select(`
          id,
          faculty,
          subject,
          department,
          year,
          semester,
          section,
          is_active,
          start_time,
          end_time,
          created_at,
          subj:subjects(id, name, code, created_by_admin, departments, allotted_faculties),
          fac:faculties(id, name)
        `)
        .eq("id", String(sessionId))
        .single();

      if (!rawSession) {
        return res.status(404).json({ ok: false, error: "Session not found" });
      }

      if (req.userRole === "FACULTY") {
        const isDirectFaculty = String(rawSession.faculty) === String(req.userId);
        const isSubjectAllotted =
          Array.isArray(rawSession.subj?.allotted_faculties) &&
          rawSession.subj.allotted_faculties.some((f) => String(f) === String(req.userId));
        if (!isDirectFaculty && !isSubjectAllotted) {
          return res.status(403).json({ ok: false, error: "Forbidden" });
        }
      }

      // Fetch all recorded attendances for this session
      const { data: rawAttendances } = await supabase
        .from("attendances")
        .select(`
          id,
          student,
          timestamp,
          status,
          device_fingerprint,
          face_verification,
          location,
          enrollment_no,
          student_name,
          student_email,
          department_code,
          semester,
          section,
          year
        `)
        .eq("session", String(sessionId))
        .order("timestamp", { ascending: false });

      const rawList = rawAttendances || [];
      const distinctStudentIds = Array.from(new Set(rawList.map((a) => a.student).filter(Boolean)));
      const { data: studentProfiles } = distinctStudentIds.length > 0
        ? await supabase.from("students").select("id, name, enrollment_no, email, profile_photo_url").in("id", distinctStudentIds)
        : { data: [] };
      const studentProfileMap = new Map((studentProfiles || []).map((s) => [String(s.id), s]));

      const presentStudentIds = new Set();
      const presentEnrollmentNos = new Set();
      const presentRecords = rawList.map((att) => {
        const studentObj = studentProfileMap.get(String(att.student)) || {};
        const effectiveEnrollmentNo = studentObj.enrollment_no || att.enrollment_no || "";
        const effectiveName = studentObj.name || att.student_name || "Student (Archived)";
        const effectiveEmail = studentObj.email || att.student_email || "";
        const effectiveStudentId = studentObj.id || att.student || (effectiveEnrollmentNo ? `archived_${effectiveEnrollmentNo}` : `archived_${att.id}`);

        if (studentObj.id) presentStudentIds.add(String(studentObj.id));
        if (effectiveEnrollmentNo) presentEnrollmentNos.add(String(effectiveEnrollmentNo).trim().toUpperCase());

        return {
          id: att.id,
          _id: att.id,
          attendanceId: att.id,
          student: {
            id: effectiveStudentId,
            _id: effectiveStudentId,
            name: effectiveName,
            enrollmentNo: effectiveEnrollmentNo,
            enrollment_no: effectiveEnrollmentNo,
            email: effectiveEmail,
            profilePhotoUrl: studentObj.profile_photo_url || "",
            isArchived: !studentObj.id,
          },
          status: att.status || "present",
          timestamp: att.timestamp,
          markedAt: att.timestamp,
          deviceFingerprint: att.device_fingerprint || "",
          faceVerification: att.face_verification || null,
          location: att.location || null,
        };
      });

      const shouldIncludeDerived =
        includeDerivedAbsences === "true" ||
        includeDerivedAbsences === true ||
        includeDerivedAbsences === "1";

      let allRegisteredStudents = [];
      if (shouldIncludeDerived) {
        // Query all students enrolled for this session's department, year, semester, section
        let studentQuery = supabase
          .from("students")
          .select("id, name, enrollment_no, email, profile_photo_url, department, year, semester, section")
          .eq("year", Number(rawSession.year))
          .eq("semester", Number(rawSession.semester));

        const normalizedSec = String(rawSession.section || "").trim().toUpperCase();
        if (normalizedSec) {
          studentQuery = studentQuery.eq("section", normalizedSec);
        }

        if (rawSession.department) {
          studentQuery = studentQuery.eq("department", String(rawSession.department));
        }

        const { data: studentsList } = await studentQuery;
        allRegisteredStudents = studentsList || [];

        // Fallback filter if department wasn't directly in session table but in subject's allowed departments
        if (!rawSession.department && Array.isArray(rawSession.subj?.departments) && rawSession.subj.departments.length > 0) {
          allRegisteredStudents = allRegisteredStudents.filter((stu) =>
            rawSession.subj.departments.some((d) => String(d) === String(stu.department))
          );
        }
      }

      // Build absent derived list for students who haven't marked attendance
      const absentRecords = [];
      for (const stu of allRegisteredStudents) {
        const sid = String(stu.id);
        const eno = String(stu.enrollment_no || "").trim().toUpperCase();
        if (!presentStudentIds.has(sid) && (!eno || !presentEnrollmentNos.has(eno))) {
          absentRecords.push({
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
            status: "absent",
            timestamp: null,
            markedAt: null,
            deviceFingerprint: "",
            faceVerification: null,
            location: null,
          });
        }
      }

      // Query exact total enrolled students for this class
      let countQuery = supabase
        .from("students")
        .select("id", { count: "exact", head: true })
        .eq("year", Number(rawSession.year))
        .eq("semester", Number(rawSession.semester));

      if (rawSession.department) {
        countQuery = countQuery.eq("department", String(rawSession.department));
      }
      const normalizedSec = String(rawSession.section || "").trim().toUpperCase();
      if (normalizedSec) {
        countQuery = countQuery.eq("section", normalizedSec);
      }
      const { count: classTotal } = await countQuery;
      const fullRoster = [...presentRecords, ...absentRecords];
      const totalStudentsCount = classTotal || allRegisteredStudents.length || fullRoster.length || 0;

      return res.json({
        ok: true,
        sessionId: String(sessionId),
        attendance: fullRoster,
        attendees: presentRecords,
        count: presentRecords.length,
        totalStudents: totalStudentsCount,
        totalStrength: totalStudentsCount,
        session: {
          id: rawSession.id,
          _id: rawSession.id,
          subjectName: rawSession.subj?.name || "Subject",
          subjectCode: rawSession.subj?.code || "",
          facultyName: rawSession.fac?.name || "Faculty",
          isActive: Boolean(rawSession.is_active),
          startTime: rawSession.start_time,
          endTime: rawSession.end_time,
          totalStudents: totalStudentsCount,
          totalStrength: totalStudentsCount,
        },
      });
    }

    // Scenario B: Query attendance across filters (subject, department, dates, etc.)
    if (subjectId) {
      const { data: subjectCheck, error: subjectCheckErr } = await supabase
        .from("subjects")
        .select("id, name, code, created_by_admin, departments, allotted_faculties, year, semester")
        .eq("id", String(subjectId))
        .single();

      if (subjectCheckErr || !subjectCheck) {
        return res.status(404).json({ ok: false, error: "Subject not found" });
      }

      if (req.userRole === "FACULTY") {
        const isAllotted =
          Array.isArray(subjectCheck?.allotted_faculties) &&
          subjectCheck.allotted_faculties.some((f) => String(f) === String(req.userId));

        if (!isAllotted) {
          return res.status(403).json({ ok: false, error: "Forbidden: You are not allotted to this subject" });
        }
      }

      // 1) Fetch all conducted sessions for this subject
      let sessionQuery = supabase
        .from("sessions")
        .select("id, year, semester, section, department, start_time, end_time, is_active, faculty, fac:faculties(id, name)")
        .eq("subject", String(subjectId))
        .eq("is_active", false)
        .order("start_time", { ascending: true });

      if (departmentId) {
        sessionQuery = sessionQuery.eq("department", String(departmentId));
      }
      if (year) {
        sessionQuery = sessionQuery.eq("year", Number(year));
      }
      if (semester) {
        sessionQuery = sessionQuery.eq("semester", Number(semester));
      }
      if (section) {
        sessionQuery = sessionQuery.eq("section", String(section).trim().toUpperCase());
      }

      const targetDate = date || startDate;
      if (targetDate) {
        const dStart = new Date(targetDate);
        dStart.setUTCHours(0, 0, 0, 0);
        const dEnd = new Date(endDate || targetDate);
        dEnd.setUTCHours(23, 59, 59, 999);
        sessionQuery = sessionQuery.gte("start_time", dStart.toISOString()).lte("start_time", dEnd.toISOString());
      }

      const { data: rawSubjectSessions, error: sessionErr } = await sessionQuery;
      if (sessionErr) throw sessionErr;
      const subjectSessions = (rawSubjectSessions || []).map((s) => ({
        ...s,
        _id: s.id,
        startTime: s.start_time,
        endTime: s.end_time,
        isActive: s.is_active,
      }));

      // 2) Fetch Enrolled Students Roster
      let studentQuery = supabase
        .from("students")
        .select("id, name, enrollment_no, email, profile_photo_url, department, year, semester, section")
        .order("enrollment_no", { ascending: true });

      const adminId = subjectCheck?.created_by_admin || req.user?.created_by_admin || (req.userRole === "ADMIN" ? req.userId : null);
      if (adminId) {
        studentQuery = studentQuery.eq("created_by_admin", String(adminId));
      }

      if (departmentId) {
        studentQuery = studentQuery.eq("department", String(departmentId));
      } else if (Array.isArray(subjectCheck?.departments) && subjectCheck.departments.length > 0) {
        studentQuery = studentQuery.in("department", subjectCheck.departments);
      }

      if (year) {
        studentQuery = studentQuery.eq("year", Number(year));
      } else if (subjectCheck?.year) {
        studentQuery = studentQuery.eq("year", Number(subjectCheck.year));
      }

      if (semester) {
        studentQuery = studentQuery.eq("semester", Number(semester));
      } else if (subjectCheck?.semester) {
        studentQuery = studentQuery.eq("semester", Number(subjectCheck.semester));
      }

      if (section) {
        studentQuery = studentQuery.eq("section", String(section).trim().toUpperCase());
      }

      const { data: rawStudents, error: stuErr } = await studentQuery;
      if (stuErr) throw stuErr;

      const enrolledStudents = (rawStudents || []).map((s) => ({
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
      }));

      // 3) Fetch Recorded Attendances for matching sessions (direct select without N+1 relational joins)
      const sessionIds = subjectSessions.map((s) => String(s.id));
      let records = [];

      if (sessionIds.length > 0) {
        let attQuery = supabase
          .from("attendances")
          .select(`
            id,
            session,
            student,
            faculty,
            subject,
            enrollment_no,
            student_name,
            student_email,
            department_code,
            semester,
            section,
            year,
            timestamp,
            status,
            device_fingerprint,
            location,
            face_verification
          `)
          .in("session", sessionIds)
          .order("timestamp", { ascending: false });

        if (studentId) attQuery = attQuery.eq("student", String(studentId));
        if (req.userRole === "STUDENT") attQuery = attQuery.eq("student", req.userId);

        let { data: rawAttendances, error: attErr } = await attQuery;
        if (attErr && (attErr.code === "PGRST204" || attErr.code === "42703" || String(attErr.message || "").includes("column"))) {
          let retryQuery = supabase
            .from("attendances")
            .select(`
              id,
              session,
              student,
              faculty,
              subject,
              timestamp,
              status,
              device_fingerprint,
              location,
              face_verification
            `)
            .in("session", sessionIds)
            .order("timestamp", { ascending: false });
          if (studentId) retryQuery = retryQuery.eq("student", String(studentId));
          if (req.userRole === "STUDENT") retryQuery = retryQuery.eq("student", req.userId);
          const retryRes = await retryQuery;
          rawAttendances = retryRes.data;
          attErr = retryRes.error;
        }
        if (attErr) throw attErr;

        // In-memory O(1) lookups from already-fetched data
        const studentMap = new Map();
        for (const s of enrolledStudents) {
          studentMap.set(String(s.id), s);
          if (s.enrollmentNo) {
            studentMap.set(String(s.enrollmentNo).trim().toUpperCase(), s);
          }
        }

        const sessionMap = new Map();
        for (const s of subjectSessions) {
          sessionMap.set(String(s.id), s);
        }

        const subjectMeta = {
          id: subjectCheck.id,
          _id: subjectCheck.id,
          name: subjectCheck.name || "Subject",
          code: subjectCheck.code || "",
        };

        records = (rawAttendances || []).map((item) => {
          const stu =
            studentMap.get(String(item.student)) ||
            (item.enrollment_no ? studentMap.get(String(item.enrollment_no).trim().toUpperCase()) : null);
          const sess = sessionMap.get(String(item.session));

          const effectiveEnrollmentNo = stu?.enrollmentNo || stu?.enrollment_no || item.enrollment_no || "";
          const effectiveName = stu?.name || item.student_name || "Student (Archived)";
          const effectiveEmail = stu?.email || item.student_email || "";
          const effectiveStudentId = stu?.id || item.student || (effectiveEnrollmentNo ? `archived_${effectiveEnrollmentNo}` : `archived_${item.id}`);

          const facultyId = sess?.faculty || item.faculty || "";
          const facultyName = sess?.fac?.name || "Faculty";

          return {
            id: item.id,
            _id: item.id,
            attendanceId: item.id,
            sessionId: item.session,
            session: item.session,
            student: {
              id: effectiveStudentId,
              _id: effectiveStudentId,
              name: effectiveName,
              enrollmentNo: effectiveEnrollmentNo,
              enrollment_no: effectiveEnrollmentNo,
              email: effectiveEmail,
              profilePhotoUrl: stu?.profilePhotoUrl || stu?.profile_photo_url || "",
              isArchived: !stu,
            },
            subject: subjectMeta,
            faculty: {
              id: facultyId,
              _id: facultyId,
              name: facultyName,
            },
            status: item.status || "present",
            timestamp: item.timestamp,
            markedAt: item.timestamp,
          };
        });
      }

      // 4) Return Enriched Payload
      return res.json({
        ok: true,
        attendance: records,
        count: records.length,
        sessions: subjectSessions,
        students: enrolledStudents,
      });
    }

    // Scenario B (without subjectId): Query attendance across filters with lightweight columns (eliminates deep 4-table join)
    let query = supabase
      .from("attendances")
      .select(`
        id,
        session,
        student,
        faculty,
        subject,
        enrollment_no,
        student_name,
        student_email,
        department_code,
        semester,
        section,
        year,
        timestamp,
        status,
        device_fingerprint,
        location,
        face_verification
      `)
      .order("timestamp", { ascending: false })
      .limit(500);

    if (req.userRole === "FACULTY") query = query.eq("faculty", req.userId);
    if (studentId) query = query.eq("student", String(studentId));
    if (req.userRole === "STUDENT") query = query.eq("student", req.userId);

    const targetDate = date || startDate;
    if (targetDate) {
      const dStart = new Date(targetDate);
      dStart.setUTCHours(0, 0, 0, 0);
      const dEnd = new Date(endDate || targetDate);
      dEnd.setUTCHours(23, 59, 59, 999);
      query = query.gte("timestamp", dStart.toISOString()).lte("timestamp", dEnd.toISOString());
    }

    let { data: rawData, error } = await query;
    if (error && (error.code === "PGRST204" || error.code === "42703" || String(error.message || "").includes("column"))) {
      let baseQuery = supabase
        .from("attendances")
        .select(`
          id,
          session,
          student,
          faculty,
          subject,
          timestamp,
          status,
          device_fingerprint,
          location,
          face_verification
        `)
        .order("timestamp", { ascending: false })
        .limit(500);

      if (req.userRole === "FACULTY") baseQuery = baseQuery.eq("faculty", req.userId);
      if (studentId) baseQuery = baseQuery.eq("student", String(studentId));
      if (req.userRole === "STUDENT") baseQuery = baseQuery.eq("student", req.userId);
      if (targetDate) {
        const dStart = new Date(targetDate);
        dStart.setUTCHours(0, 0, 0, 0);
        const dEnd = new Date(endDate || targetDate);
        dEnd.setUTCHours(23, 59, 59, 999);
        baseQuery = baseQuery.gte("timestamp", dStart.toISOString()).lte("timestamp", dEnd.toISOString());
      }
      const retryRes = await baseQuery;
      rawData = retryRes.data;
      error = retryRes.error;
    }
    if (error) throw error;

    const attendancesList = rawData || [];

    // Lightweight batch lookups for unique foreign keys only if rows exist
    const sessionIds = Array.from(new Set(attendancesList.map((a) => a.session).filter(Boolean)));
    const subjectIds = Array.from(new Set(attendancesList.map((a) => a.subject).filter(Boolean)));
    const facultyIds = Array.from(new Set(attendancesList.map((a) => a.faculty).filter(Boolean)));
    const studentIds = Array.from(new Set(attendancesList.map((a) => a.student).filter(Boolean)));

    const [sessionRes, subjectRes, facultyRes, studentRes] = await Promise.all([
      sessionIds.length > 0
        ? supabase.from("sessions").select("id, year, semester, section, department, start_time, end_time").in("id", sessionIds)
        : Promise.resolve({ data: [] }),
      subjectIds.length > 0
        ? supabase.from("subjects").select("id, name, code").in("id", subjectIds)
        : Promise.resolve({ data: [] }),
      facultyIds.length > 0
        ? supabase.from("faculties").select("id, name").in("id", facultyIds)
        : Promise.resolve({ data: [] }),
      studentIds.length > 0
        ? supabase.from("students").select("id, name, enrollment_no, email, profile_photo_url").in("id", studentIds)
        : Promise.resolve({ data: [] }),
    ]);

    const sessionMap = new Map((sessionRes.data || []).map((s) => [String(s.id), s]));
    const subjectMap = new Map((subjectRes.data || []).map((s) => [String(s.id), s]));
    const facultyMap = new Map((facultyRes.data || []).map((f) => [String(f.id), f]));
    const studentMap = new Map((studentRes.data || []).map((s) => [String(s.id), s]));

    const filtered = attendancesList.filter((item) => {
      const sess = sessionMap.get(String(item.session));
      const effectiveYear = sess?.year ?? item.year;
      const effectiveSem = sess?.semester ?? item.semester;
      const effectiveSec = sess?.section ?? item.section;
      const effectiveDept = sess?.department ?? item.department_code;

      if (year && Number(effectiveYear) !== Number(year)) return false;
      if (semester && Number(effectiveSem) !== Number(semester)) return false;
      if (section && String(effectiveSec || "").toUpperCase() !== String(section).toUpperCase()) return false;
      if (departmentId && String(effectiveDept || "") !== String(departmentId)) return false;
      return true;
    });

    const records = filtered.map((item) => {
      const stu = studentMap.get(String(item.student));
      const subj = subjectMap.get(String(item.subject));
      const fac = facultyMap.get(String(item.faculty));

      const effectiveEnrollmentNo = stu?.enrollment_no || item.enrollment_no || "";
      const effectiveName = stu?.name || item.student_name || "Student (Archived)";
      const effectiveEmail = stu?.email || item.student_email || "";
      const effectiveStudentId = stu?.id || item.student || (effectiveEnrollmentNo ? `archived_${effectiveEnrollmentNo}` : `archived_${item.id}`);

      return {
        id: item.id,
        _id: item.id,
        attendanceId: item.id,
        sessionId: item.session,
        student: {
          id: effectiveStudentId,
          _id: effectiveStudentId,
          name: effectiveName,
          enrollmentNo: effectiveEnrollmentNo,
          email: effectiveEmail,
          profilePhotoUrl: stu?.profile_photo_url || "",
          isArchived: !stu,
        },
        subject: {
          id: subj?.id || item.subject,
          _id: subj?.id || item.subject,
          name: subj?.name || "Subject",
          code: subj?.code || "",
        },
        faculty: {
          id: fac?.id || item.faculty,
          _id: fac?.id || item.faculty,
          name: fac?.name || "Faculty",
        },
        status: item.status || "present",
        timestamp: item.timestamp,
        markedAt: item.timestamp,
      };
    });

    return res.json({
      ok: true,
      attendance: records,
      count: records.length,
    });
  } catch (err) {
    console.error("Fetch attendance error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ----------------------------------------------------
// 3) TOTP SUBMISSION & COMPATIBLE SUBMIT ROUTES
// POST /api/attendance/submit, /api/attendance/totp, /api/attendance/totp-submit
// ----------------------------------------------------
async function handleTotpAttendanceSubmission(req, res) {
  try {
    const student = req.user;
    const {
      sequence,
      token1,
      token2,
      fingerprint,
      faceMatch,
      faceMetrics,
      faceEmbedding,
    } = req.body || {};

    const rawSessionId =
      req.body?.sessionId ||
      req.body?.classId ||
      sequence?.[0]?.classId ||
      sequence?.[0]?.sessionId;

    const location =
      req.body?.location ||
      (req.body?.lat != null && req.body?.lng != null
        ? { lat: Number(req.body.lat), lng: Number(req.body.lng), accuracy: Number(req.body.accuracy || 0) }
        : null);

    if (!rawSessionId) {
      return res.status(400).json({ ok: false, error: "Session ID required" });
    }

    const sessionId = String(rawSessionId);
    const normalizedFp = normalizeFingerprint(fingerprint);

    if (!normalizedFp || String(student.device_fingerprint) !== normalizedFp) {
      return res.status(401).json({ ok: false, error: "Device mismatch - attendance blocked" });
    }

    let totpValidation;
    if (Array.isArray(sequence) && sequence.length >= 2) {
      totpValidation = await verifyTotpSequence(sessionId, sequence);
    } else if (token1 && token2) {
      totpValidation = await verifyConsecutiveTotpTokens(sessionId, token1, token2);
    } else {
      return res.status(400).json({ ok: false, error: "Two consecutive TOTP tokens required" });
    }

    if (!totpValidation.ok) {
      return res.status(400).json({ ok: false, error: totpValidation.error });
    }

    const session = await getCachedActiveSession(sessionId);
    if (!session) {
      return res.status(404).json({ ok: false, error: "Session not found" });
    }

    const isRunning = Boolean(session?.is_active ?? session?.isActive);
    if (!isRunning) {
      return res.status(400).json({ ok: false, error: "Session is no longer active" });
    }

    // Strict Section & Academic Eligibility Check
    const eligibility = validateStudentSessionEligibility(student, session);
    if (!eligibility.ok) {
      return res.status(403).json({ ok: false, error: eligibility.error });
    }

    // Fast-path in-memory duplicate check
    const isAlreadyPresent = await isStudentPresent(sessionId, student.id);
    if (isAlreadyPresent) {
      return res.json({
        ok: true,
        already: true,
        alreadyMarked: true,
        status: "present",
        session: {
          id: sessionId,
          _id: sessionId,
          subjectName: session.subj?.name || "Subject",
          subjectCode: session.subj?.code || "",
        },
      });
    }

    let locationCheck = { ok: true, distanceMeters: null };
    if (session.location) {
      locationCheck = validateStudentLocation(location, session.location);
      if (!locationCheck.ok) {
        return res.status(403).json({ ok: false, error: locationCheck.error });
      }
    }

    let faceVerificationResult = {
      verified: true,
      score: Number(faceMetrics?.confidence || 1),
      model: "totp-mediapipe-facenet512",
    };

    if (env.REQUIRE_FACE_VERIFICATION || faceMatch != null || faceEmbedding != null) {
      const faceEval = await verifyFaceAgainstStudent(student, {
        faceMatch,
        faceMetrics,
        faceEmbedding,
      });

      if (!faceEval.ok) {
        return res.status(403).json({ ok: false, error: faceEval.error });
      }

      faceVerificationResult = {
        verified: true,
        score: Number(faceEval.score || 1),
        model: faceEval.model || "facenet512",
      };
    }

    const supabase = getSupabaseClient();
    if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

    // Row-level validation: Direct DB check to verify session is currently active
    const { data: liveSession, error: sessionCheckError } = await supabase
      .from("sessions")
      .select("is_active")
      .eq("id", sessionId)
      .single();

    if (sessionCheckError || !liveSession || !liveSession.is_active) {
      invalidateCachedSession(sessionId);
      return res.status(400).json({ ok: false, error: "Session is no longer active" });
    }

    // Atomic upsert into attendances table
    const { data: attendance, error: insertError } = await supabase
      .from("attendances")
      .upsert({
        session: sessionId,
        student: student.id,
        faculty: session.faculty,
        subject: session.subject,
        timestamp: new Date().toISOString(),
        status: "present",
        location: location
          ? {
              lat: Number(location.lat),
              lng: Number(location.lng),
              accuracy: location.accuracy != null ? Number(location.accuracy) : null,
              distanceMeters: locationCheck.distanceMeters != null ? Math.round(locationCheck.distanceMeters) : null,
            }
          : null,
        device_fingerprint: normalizedFp,
        face_verification: faceVerificationResult,
      }, { onConflict: "session,student" })
      .select("*")
      .single();

    if (insertError || !attendance) {
      if (
        insertError?.code === "23505" ||
        String(insertError?.message || "").toLowerCase().includes("unique") ||
        String(insertError?.message || "").toLowerCase().includes("duplicate")
      ) {
        await recordInstantPresence(sessionId, student.id);
        return res.json({
          ok: true,
          already: true,
          alreadyMarked: true,
          status: "present",
          session: {
            id: session.id,
            _id: session.id,
            subjectName: session.subj?.name || "Subject",
            subjectCode: session.subj?.code || "",
          },
        });
      }
      console.error("Attendance insert error:", insertError);
      return res.status(400).json({ ok: false, error: insertError?.message || "Failed to record attendance" });
    }

    // Record presence in high-speed memory cache immediately
    await recordInstantPresence(sessionId, student.id);

    // Asynchronous non-blocking background tasks
    touchSession(sessionId).catch(() => {});

    try {
      const requestMeta = getRequestMeta(req);
      recordAttendanceAudit({
        attendanceId: attendance.id,
        sessionId,
        studentId: student.id,
        facultyId: session.faculty,
        subjectId: session.subject,
        action: "MARK_PRESENT",
        method: "QR_TOTP",
        actorRole: "STUDENT",
        actorId: student.id,
        deviceFingerprint: normalizedFp,
        location: location
          ? {
              lat: Number(location.lat),
              lng: Number(location.lng),
              accuracy: Number(location.accuracy || 0),
            }
          : null,
        qr: { blockIndex: totpValidation.blockIndex },
        faceVerification: faceVerificationResult,
        requestMeta,
      }).catch(() => {});
    } catch {}

    const attendanceBroadcastPayload = {
      id: attendance.id,
      _id: attendance.id,
      sessionId,
      studentId: student.id,
      studentName: student.name,
      enrollmentNo: student.enrollment_no,
      timestamp: attendance.timestamp,
      status: "present",
      method: "QR_TOTP",
    };

    broadcastAttendance(sessionId, attendanceBroadcastPayload).catch(() => {});

    return res.json({
      ok: true,
      attendanceId: attendance.id,
      _id: attendance.id,
      status: "present",
      markedAt: attendance.timestamp,
      session: {
        id: session.id,
        _id: session.id,
        subjectName: session.subj?.name || "Subject",
        subjectCode: session.subj?.code || "",
      },
    });
  } catch (err) {
    console.error("Attendance submission error:", err);
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
}

const totpRateLimiter = rateLimit({
  prefix: "totp-submit",
  windowMs: 60 * 1000,
  max: 30,
});

router.post("/submit", auth(["STUDENT"]), totpRateLimiter, handleTotpAttendanceSubmission);
router.post("/totp", auth(["STUDENT"]), totpRateLimiter, handleTotpAttendanceSubmission);
router.post("/totp-submit", auth(["STUDENT"]), totpRateLimiter, handleTotpAttendanceSubmission);

// ----------------------------------------------------
// 4) GET SESSION ATTENDEES (FACULTY / ADMIN)
// GET /api/attendance/session/:id/attendees
// ----------------------------------------------------
router.get("/session/:id/attendees", auth(["FACULTY", "ADMIN"]), async (req, res) => {
  try {
    const sessionId = req.params.id;
    const supabase = getSupabaseClient();
    if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

    const { data: session } = await supabase
      .from("sessions")
      .select("id, faculty, subject, department, year, semester, section, is_active, created_at")
      .eq("id", sessionId)
      .single();

    if (!session) {
      return res.status(404).json({ ok: false, error: "Session not found" });
    }

    if (req.userRole === "FACULTY" && String(session.faculty) !== String(req.userId)) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    const { data: rawAttendances } = await supabase
      .from("attendances")
      .select(`
        id,
        timestamp,
        status,
        device_fingerprint,
        face_verification,
        location,
        student:students(id, name, enrollment_no, email, profile_photo_url)
      `)
      .eq("session", sessionId)
      .order("timestamp", { ascending: false });

    const attendees = (rawAttendances || []).map((att) => ({
      id: att.id,
      _id: att.id,
      studentId: att.student?.id || att.student,
      studentName: att.student?.name || "Student",
      enrollmentNo: att.student?.enrollment_no || "",
      email: att.student?.email || "",
      profilePhotoUrl: att.student?.profile_photo_url || "",
      timestamp: att.timestamp,
      markedAt: att.timestamp,
      status: att.status || "present",
      deviceFingerprint: att.device_fingerprint || "",
      faceVerification: att.face_verification || null,
      location: att.location || null,
    }));

    // Query exact total enrolled students for this class
    let countQuery = supabase
      .from("students")
      .select("id", { count: "exact", head: true })
      .eq("year", Number(session.year))
      .eq("semester", Number(session.semester));

    if (session.department) {
      countQuery = countQuery.eq("department", String(session.department));
    }
    const normalizedSec = String(session.section || "").trim().toUpperCase();
    if (normalizedSec) {
      countQuery = countQuery.eq("section", normalizedSec);
    }
    const { count: classTotal } = await countQuery;
    const totalStudents = classTotal || 0;

    return res.json({
      ok: true,
      sessionId,
      count: attendees.length,
      totalStudents,
      totalStrength: totalStudents,
      attendees,
    });
  } catch (err) {
    console.error("Session attendees fetch error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ----------------------------------------------------
// 5) MANUAL ATTENDANCE (FACULTY / ADMIN)
// POST /api/attendance/manual & POST /api/attendance/session/:id/manual
// ----------------------------------------------------
async function handleManualAttendance(req, res) {
  try {
    const sessionId = req.body?.sessionId || req.params?.id;
    const { studentId, enrollmentNo, status } = req.body || {};

    if (!sessionId || (!studentId && !enrollmentNo) || !["present", "absent"].includes(status)) {
      return res.status(400).json({
        ok: false,
        error: "sessionId, student identifier (studentId or enrollmentNo), and valid status (present/absent) required",
      });
    }

    const supabase = getSupabaseClient();
    if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

    const { data: session } = await supabase
      .from("sessions")
      .select("id, faculty, subject, department, year, semester, section, subj:subjects(id, name, code, created_by_admin, departments)")
      .eq("id", String(sessionId))
      .single();

    if (!session) {
      return res.status(404).json({ ok: false, error: "Session not found" });
    }

    if (req.userRole === "FACULTY") {
      const isDirectFaculty = String(session.faculty) === String(req.userId);
      let isSubjectAllotted = false;
      if (!isDirectFaculty) {
        const { data: subj } = await supabase
          .from("subjects")
          .select("allotted_faculties")
          .eq("id", String(session.subject))
          .single();
        isSubjectAllotted =
          Array.isArray(subj?.allotted_faculties) &&
          subj.allotted_faculties.some((f) => String(f) === String(req.userId));
      }
      if (!isDirectFaculty && !isSubjectAllotted) {
        return res.status(403).json({ ok: false, error: "Forbidden: Not allotted to this session" });
      }
    }

    let student = null;
    if (studentId) {
      const { data } = await supabase
        .from("students")
        .select("id, name, enrollment_no, email, profile_photo_url, department, year, semester, section, created_by_admin")
        .eq("id", String(studentId))
        .single();
      student = data;
    } else if (enrollmentNo) {
      const { data } = await supabase
        .from("students")
        .select("id, name, enrollment_no, email, profile_photo_url, department, year, semester, section, created_by_admin")
        .ilike("enrollment_no", String(enrollmentNo).trim())
        .limit(1);
      student = data?.[0] || null;
    }

    if (!student) {
      return res.status(404).json({ ok: false, error: "Student not found" });
    }

    let attendance = null;
    if (status === "present") {
      const eligibility = validateStudentSessionEligibility(student, session);
      if (!eligibility.ok) {
        return res.status(403).json({ ok: false, error: eligibility.error });
      }
      const fullPayload = {
        session: String(sessionId),
        student: String(student.id),
        faculty: session.faculty,
        subject: session.subject,
        enrollment_no: student.enrollment_no || null,
        student_name: student.name || null,
        student_email: student.email || null,
        department_code: student.dept?.code || student.departmentCode || null,
        semester: Number(student.semester || session.semester) || null,
        section: String(student.section || session.section || "").toUpperCase() || null,
        year: Number(student.year || session.year) || null,
        status: "present",
        timestamp: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      let { data: upserted, error } = await supabase
        .from("attendances")
        .upsert(fullPayload, { onConflict: "session,student" })
        .select("*")
        .single();

      // If custom columns don't exist yet in Supabase schema, gracefully retry with base columns
      if (error && (error.code === "PGRST204" || error.code === "42703" || String(error.message || "").includes("column"))) {
        const basePayload = {
          session: String(sessionId),
          student: String(student.id),
          faculty: session.faculty,
          subject: session.subject,
          status: "present",
          timestamp: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        const retryRes = await supabase
          .from("attendances")
          .upsert(basePayload, { onConflict: "session,student" })
          .select("*")
          .single();
        upserted = retryRes.data;
        error = retryRes.error;
      }

      if (error || !upserted) throw error || new Error("Failed to mark manual attendance");
      attendance = upserted;
    } else {
      await supabase
        .from("attendances")
        .delete()
        .eq("session", String(sessionId))
        .eq("student", String(student.id));

      if (student.enrollment_no) {
        await supabase
          .from("attendances")
          .delete()
          .eq("session", String(sessionId))
          .ilike("enrollment_no", String(student.enrollment_no).trim());
      }

      // Clear from in-memory presence cache so student can re-scan if needed
      await removeInstantPresence(sessionId, student.id);
      if (student.enrollment_no) {
        await removeInstantPresence(sessionId, student.enrollment_no);
      }
    }

    const requestMeta = getRequestMeta(req);
    const attendanceBroadcastPayload = {
      id: attendance?.id || sessionId,
      _id: attendance?.id || sessionId,
      sessionId: String(sessionId),
      studentId: String(student.id),
      studentName: student.name,
      enrollmentNo: student.enrollment_no,
      timestamp: new Date().toISOString(),
      status,
      method: "MANUAL",
    };

    // 1. Immediately return success response
    res.json({
      ok: true,
      sessionId: String(sessionId),
      studentId: String(student.id),
      enrollmentNo: student.enrollment_no,
      status,
    });

    // 2. Fire audit log and realtime broadcast in the background (non-blocking)
    recordAttendanceAudit({
      attendanceId: attendance?.id || null,
      sessionId: String(sessionId),
      studentId: String(student.id),
      facultyId: session.faculty,
      subjectId: session.subject,
      enrollmentNo: student.enrollment_no,
      studentName: student.name,
      studentEmail: student.email,
      action: status === "present" ? "MANUAL_PRESENT" : "MANUAL_ABSENT",
      method: "MANUAL",
      actorRole: req.userRole,
      actorId: req.userId,
      requestMeta,
    }).catch((err) => {
      console.error("Background manual attendance audit error:", err?.message || err);
    });

    broadcastAttendance(sessionId, attendanceBroadcastPayload).catch((err) => {
      console.error("Background manual realtime broadcast error:", err?.message || err);
    });

    return;
  } catch (err) {
    console.error("Manual attendance error:", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || err?.details || "Failed to update attendance",
    });
  }
}

router.post("/manual", auth(["FACULTY", "ADMIN"]), handleManualAttendance);
router.post("/session/:id/manual", auth(["FACULTY", "ADMIN"]), handleManualAttendance);

// ----------------------------------------------------
// 6) ATTENDANCE AUDITS (ADMIN / FACULTY)
// GET /api/attendance/audits
// ----------------------------------------------------
router.get("/audits", auth(["ADMIN", "FACULTY"]), async (req, res) => {
  try {
    const { sessionId, studentId, limit = 50 } = req.query;
    const supabase = getSupabaseClient();
    if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

    let query = supabase
      .from("attendance_audits")
      .select(`
        id,
        action,
        method,
        actor_role,
        actor,
        device_fingerprint,
        location,
        qr,
        face_verification,
        created_at,
        sess:sessions(id, year, semester, section),
        stu:students(id, name, enrollment_no),
        fac:faculties(id, name),
        subj:subjects(id, name, code)
      `);

    if (sessionId) query = query.eq("session", String(sessionId));
    if (studentId) query = query.eq("student", String(studentId));
    if (req.userRole === "FACULTY") query = query.eq("faculty", req.userId);

    const { data: audits, error } = await query
      .order("created_at", { ascending: false })
      .limit(Number(limit));

    if (error) throw error;

    const formatted = (audits || []).map((a) => ({
      id: a.id,
      _id: a.id,
      action: a.action,
      method: a.method,
      actorRole: a.actor_role,
      actor: a.actor,
      deviceFingerprint: a.device_fingerprint,
      location: a.location,
      qr: a.qr,
      faceVerification: a.face_verification,
      createdAt: a.created_at,
      session: a.sess ? { ...a.sess, _id: a.sess.id } : null,
      student: a.stu ? { ...a.stu, _id: a.stu.id, enrollmentNo: a.stu.enrollment_no } : null,
      faculty: a.fac ? { ...a.fac, _id: a.fac.id } : null,
      subject: a.subj ? { ...a.subj, _id: a.subj.id } : null,
    }));

    return res.json({ ok: true, audits: formatted });
  } catch (err) {
    console.error("Fetch audits error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

module.exports = router;
module.exports.invalidateCachedSession = invalidateCachedSession;

