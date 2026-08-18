const express = require("express");
const router = express.Router();
const crypto = require("crypto");

const { getSupabaseClient } = require("../config/supabase");
const { verifyQRToken, validateTwoStepQR } = require("../services/qrService");
const {
  verifyTotpSequence,
  verifyConsecutiveTotpTokens,
  recordInstantPresence,
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

function cleanupExpiredScanGrants() {
  const now = Date.now();
  for (const [key, value] of scanGrantsMemoryStore.entries()) {
    if (!value || Number(value.expiresAt || 0) <= now) {
      scanGrantsMemoryStore.delete(key);
    }
  }
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
    await supabase.from("attendance_audits").insert({
      attendance: entry.attendanceId || null,
      session: String(entry.sessionId),
      student: String(entry.studentId),
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
    });
  } catch (err) {
    console.error("Attendance audit log error:", err.message);
  }
}

async function saveScanGrant({ token, studentId, sessionId, fingerprint }) {
  cleanupExpiredScanGrants();
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
  cleanupExpiredScanGrants();
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

      if (!qrToken || !fingerprint) {
        return res.status(400).json({ ok: false, error: "QR token & device fingerprint required" });
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
      const supabase = getSupabaseClient();
      if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

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
        .eq("id", sessionId)
        .single();

      if (!rawSession) {
        return res.status(404).json({ ok: false, error: "Session not found" });
      }

      const session = await expireIfInactive(rawSession);
      const isRunning = Boolean(session?.is_active ?? session?.isActive);
      if (!session || !isRunning) {
        return res.status(400).json({ ok: false, error: "Session is no longer active" });
      }

      const subject = session.subj;
      if (
        String(subject?.created_by_admin || "") !==
        String(student.created_by_admin || student.createdByAdmin || "")
      ) {
        return res.status(403).json({ ok: false, error: "Student does not belong to this college" });
      }

      const sessionDept = session.department;
      const studentDept = student.department;
      if (sessionDept) {
        if (String(sessionDept) !== String(studentDept)) {
          return res.status(403).json({ ok: false, error: "Student not in this session's department" });
        }
      } else {
        const allowedDepts = subject?.departments || [];
        if (!allowedDepts.some((d) => String(d) === String(studentDept))) {
          return res.status(403).json({ ok: false, error: "Student not in this session's department" });
        }
      }

      if (
        Number(session.year) !== Number(student.year) ||
        Number(session.semester) !== Number(student.semester) ||
        String(session.section || "").toUpperCase() !== String(student.section || "").toUpperCase()
      ) {
        return res.status(403).json({ ok: false, error: "Student not in this year/semester/section" });
      }

      const locationCheck = validateStudentLocation(location, session.location);
      if (!locationCheck.ok) {
        return res.status(403).json({ ok: false, error: locationCheck.error });
      }

      // Check if attendance already marked
      const { data: existingAttendance } = await supabase
        .from("attendances")
        .select("id")
        .eq("session", sessionId)
        .eq("student", student.id)
        .single();

      if (existingAttendance) {
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
// ----------------------------------------------------
router.post(
  "/mark",
  auth(["STUDENT"]),
  rateLimit({
    prefix: "mark",
    windowMs: 60 * 1000,
    max: 15,
  }),
  async (req, res) => {
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

      if (!scanGrantToken || !firstQrToken || !secondQrToken || !fingerprint) {
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

      const supabase = getSupabaseClient();
      if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

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
        .eq("id", sessionId)
        .single();

      if (!rawSession) {
        return res.status(404).json({ ok: false, error: "Session not found" });
      }

      const session = await expireIfInactive(rawSession);
      const isRunning = Boolean(session?.is_active ?? session?.isActive);
      if (!session || !isRunning) {
        return res.status(400).json({ ok: false, error: "Session is no longer active" });
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

      // Insert Attendance atomically
      const { data: attendance, error: insertError } = await supabase
        .from("attendances")
        .insert({
          session: sessionId,
          student: student.id,
          faculty: session.faculty,
          subject: session.subject,
          timestamp: new Date().toISOString(),
          status: "present",
          location: {
            lat: Number(location.lat),
            lng: Number(location.lng),
          },
          device_fingerprint: normalizedFp,
          face_verification: faceVerificationResult,
        })
        .select("*")
        .single();

      if (insertError || !attendance) {
        if (insertError?.code === "23505") {
          return res.status(409).json({ ok: false, error: "Attendance already marked for this session" });
        }
        throw insertError || new Error("Failed to record attendance");
      }

      await touchSession(sessionId);

      const requestMeta = getRequestMeta(req);
      await recordAttendanceAudit({
        attendanceId: attendance.id,
        sessionId,
        studentId: student.id,
        facultyId: session.faculty,
        subjectId: session.subject,
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
      });

      // Realtime Broadcast
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

      await broadcastAttendance(sessionId, attendanceBroadcastPayload);

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
      console.error("Mark attendance error:", err);
      return res.status(500).json({ ok: false, error: "Server error" });
    }
  }
);

// ----------------------------------------------------
// 3) TOTP SUBMISSION
// POST /api/attendance/totp-submit
// ----------------------------------------------------
router.post(
  "/totp-submit",
  auth(["STUDENT"]),
  rateLimit({
    prefix: "totp-submit",
    windowMs: 60 * 1000,
    max: 20,
  }),
  async (req, res) => {
    try {
      const student = req.user;
      const {
        sessionId,
        sequence,
        token1,
        token2,
        location,
        fingerprint,
        faceMatch,
        faceMetrics,
        faceEmbedding,
      } = req.body || {};

      if (!sessionId || !fingerprint) {
        return res.status(400).json({ ok: false, error: "Session ID & device fingerprint required" });
      }

      const normalizedFp = normalizeFingerprint(fingerprint);
      if (!normalizedFp || String(student.device_fingerprint) !== normalizedFp) {
        return res.status(401).json({ ok: false, error: "Device mismatch - attendance blocked" });
      }

      let totpValidation;
      if (Array.isArray(sequence) && sequence.length === 2) {
        totpValidation = await verifyTotpSequence(sessionId, sequence);
      } else if (token1 && token2) {
        totpValidation = await verifyConsecutiveTotpTokens(sessionId, token1, token2);
      } else {
        return res.status(400).json({ ok: false, error: "Two consecutive TOTP tokens required" });
      }

      if (!totpValidation.ok) {
        return res.status(400).json({ ok: false, error: totpValidation.error });
      }

      await recordInstantPresence(sessionId, student.id);

      const supabase = getSupabaseClient();
      if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

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
        .eq("id", sessionId)
        .single();

      if (!rawSession) {
        return res.status(404).json({ ok: false, error: "Session not found" });
      }

      const session = await expireIfInactive(rawSession);
      const isRunning = Boolean(session?.is_active ?? session?.isActive);
      if (!session || !isRunning) {
        return res.status(400).json({ ok: false, error: "Session is no longer active" });
      }

      const locationCheck = validateStudentLocation(location, session.location);
      if (!locationCheck.ok) {
        return res.status(403).json({ ok: false, error: locationCheck.error });
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

      const { data: attendance, error: insertError } = await supabase
        .from("attendances")
        .insert({
          session: sessionId,
          student: student.id,
          faculty: session.faculty,
          subject: session.subject,
          timestamp: new Date().toISOString(),
          status: "present",
          location: {
            lat: Number(location.lat),
            lng: Number(location.lng),
          },
          device_fingerprint: normalizedFp,
          face_verification: faceVerificationResult,
        })
        .select("*")
        .single();

      if (insertError || !attendance) {
        if (insertError?.code === "23505") {
          return res.status(409).json({ ok: false, error: "Attendance already marked for this session" });
        }
        throw insertError || new Error("Failed to record attendance");
      }

      await touchSession(sessionId);

      const requestMeta = getRequestMeta(req);
      await recordAttendanceAudit({
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
        location: {
          lat: Number(location.lat),
          lng: Number(location.lng),
          accuracy: Number(location.accuracy || 0),
        },
        qr: { blockIndex: totpValidation.blockIndex },
        faceVerification: faceVerificationResult,
        requestMeta,
      });

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

      await broadcastAttendance(sessionId, attendanceBroadcastPayload);

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
      console.error("TOTP submit error:", err);
      return res.status(500).json({ ok: false, error: "Server error" });
    }
  }
);

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

    return res.json({
      ok: true,
      sessionId,
      count: attendees.length,
      attendees,
    });
  } catch (err) {
    console.error("Session attendees fetch error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ----------------------------------------------------
// 5) MANUAL ATTENDANCE (FACULTY / ADMIN)
// POST /api/attendance/session/:id/manual
// ----------------------------------------------------
router.post("/session/:id/manual", auth(["FACULTY", "ADMIN"]), async (req, res) => {
  try {
    const sessionId = req.params.id;
    const { studentId, status } = req.body || {};

    if (!studentId || !["present", "absent"].includes(status)) {
      return res.status(400).json({ ok: false, error: "studentId and valid status (present/absent) required" });
    }

    const supabase = getSupabaseClient();
    if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

    const { data: session } = await supabase
      .from("sessions")
      .select("id, faculty, subject, department, year, semester, section")
      .eq("id", sessionId)
      .single();

    if (!session) {
      return res.status(404).json({ ok: false, error: "Session not found" });
    }

    if (req.userRole === "FACULTY" && String(session.faculty) !== String(req.userId)) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    const { data: student } = await supabase
      .from("students")
      .select("id, name, enrollment_no, email")
      .eq("id", String(studentId))
      .single();

    if (!student) {
      return res.status(404).json({ ok: false, error: "Student not found" });
    }

    let attendance;
    if (status === "present") {
      const { data: upserted, error } = await supabase
        .from("attendances")
        .upsert(
          {
            session: sessionId,
            student: student.id,
            faculty: session.faculty,
            subject: session.subject,
            status: "present",
            timestamp: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "session,student" }
        )
        .select("*")
        .single();

      if (error || !upserted) throw error || new Error("Failed to mark manual attendance");
      attendance = upserted;
    } else {
      await supabase
        .from("attendances")
        .delete()
        .eq("session", sessionId)
        .eq("student", student.id);
    }

    const requestMeta = getRequestMeta(req);
    await recordAttendanceAudit({
      attendanceId: attendance?.id || null,
      sessionId,
      studentId: student.id,
      facultyId: session.faculty,
      subjectId: session.subject,
      action: status === "present" ? "MANUAL_PRESENT" : "MANUAL_ABSENT",
      method: "MANUAL",
      actorRole: req.userRole,
      actorId: req.userId,
      requestMeta,
    });

    const attendanceBroadcastPayload = {
      id: attendance?.id || sessionId,
      _id: attendance?.id || sessionId,
      sessionId,
      studentId: student.id,
      studentName: student.name,
      enrollmentNo: student.enrollment_no,
      timestamp: new Date().toISOString(),
      status,
      method: "MANUAL",
    };

    await broadcastAttendance(sessionId, attendanceBroadcastPayload);

    return res.json({
      ok: true,
      sessionId,
      studentId: student.id,
      status,
    });
  } catch (err) {
    console.error("Manual attendance error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

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
