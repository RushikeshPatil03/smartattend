const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");

const { getSupabaseClient } = require("../config/supabase");
const { getStudentTodayAttendance } = require("../services/studentTodayAttendance");
const { normalizeFingerprint } = require("../services/deviceFingerprint");
const auth = require("../middleware/auth");
const env = require("../config/env");

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
    // Fallback
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

// ----------------------------------------------------
// STUDENT REGISTRATION
// POST /api/student/register
// ----------------------------------------------------
router.post("/register", async (req, res) => {
  try {
    const {
      token,
      name,
      email,
      password,
      enrollmentNo,
      year,
      semester,
      section,
      departmentId,
      fingerprint,
      faceSignature,
      faceSignatureMirror,
      faceSignatureVersion,
      faceEmbedding,
      faceEmbeddingModel,
      faceEmbeddingVersion,
      profilePhotoUrl,
    } = req.body || {};

    if (
      !token ||
      !name ||
      !email ||
      !password ||
      !enrollmentNo ||
      !year ||
      !semester ||
      !section ||
      !departmentId ||
      !fingerprint
    ) {
      return res.status(400).json({ ok: false, error: "All fields are required" });
    }

    if (env.REQUIRE_FACE_VERIFICATION && (!faceSignature || typeof faceSignature !== "string")) {
      return res.status(400).json({ ok: false, error: "Face registration is required" });
    }

    const normalizedEmail = String(email || "").trim().toLowerCase();
    const normalizedEnrollment = String(enrollmentNo || "").trim().toUpperCase();
    const normalizedName = String(name || "").trim();
    const normalizedSection = String(section || "").trim().toUpperCase();
    const normalizedFp = normalizeFingerprint(fingerprint);

    if (!normalizedFp) {
      return res.status(400).json({ ok: false, error: "Invalid device fingerprint" });
    }

    const supabase = getSupabaseClient();
    if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

    const { data: reg } = await supabase
      .from("registration_tokens")
      .select("*")
      .eq("token", String(token))
      .single();

    const tokenError = validateRegistrationToken(reg, "student");
    if (tokenError) {
      return res.status(400).json({ ok: false, error: tokenError });
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
      supabase.from("students").select("id").eq("email", normalizedEmail).limit(1),
      supabase.from("students").select("id").eq("enrollment_no", normalizedEnrollment).limit(1),
      supabase.from("students").select("id").eq("device_fingerprint", normalizedFp).limit(1),
      supabase.from("faculties").select("id").eq("device_fingerprint", normalizedFp).limit(1),
    ];

    const [byEmail, byEnrollment, byStuFp, byFacFp] = await Promise.all(checks);

    if ((byEmail?.data || []).length > 0) {
      return res.status(400).json({ ok: false, error: "Student with this email already exists" });
    }
    if ((byEnrollment?.data || []).length > 0) {
      return res.status(400).json({ ok: false, error: "Student with this enrollment number already exists" });
    }
    if (
      (byStuFp?.data || []).length > 0 ||
      (byFacFp?.data || []).length > 0
    ) {
      return res.status(400).json({ ok: false, error: "This device is already linked to another account" });
    }

    const reservedToken = await reserveRegistrationSlot(reg.id);
    if (!reservedToken) {
      return res.status(400).json({ ok: false, error: "Registration limit reached" });
    }

    try {
      const passwordHash = await bcrypt.hash(password, 10);

      const { data: student, error: insertError } = await supabase
        .from("students")
        .insert({
          name: normalizedName,
          email: normalizedEmail,
          password_hash: passwordHash,
          enrollment_no: normalizedEnrollment,
          year: Number(year),
          semester: Number(semester),
          section: normalizedSection,
          department: department.id,
          device_fingerprint: normalizedFp,
          created_by_admin: reg.admin_id,
          college_name: reg.college_name || "",
          profile_photo_url: String(profilePhotoUrl || ""),
          face_signature: String(faceSignature || ""),
          face_signature_mirror: String(faceSignatureMirror || ""),
          face_signature_version: String(faceSignatureVersion || ""),
          face_embedding: Array.isArray(faceEmbedding) ? faceEmbedding : null,
          face_embedding_model: String(faceEmbeddingModel || ""),
          face_embedding_version: String(faceEmbeddingVersion || ""),
          registered_via_token: reg.token,
        })
        .select("id")
        .single();

      if (insertError || !student) {
        throw insertError || new Error("Failed to insert student");
      }

      return res.json({ ok: true, studentId: student.id, _id: student.id });
    } catch (err) {
      await releaseRegistrationSlot(reg.id);
      throw err;
    }
  } catch (err) {
    console.error("Student registration error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ----------------------------------------------------
// TODAY'S SESSIONS / LIVE ATTENDANCE FOR STUDENT
// GET /api/student/sessions/today, /api/student/attendance/today-live, /api/student/live-attendance
// ----------------------------------------------------
const handleStudentTodayAttendance = async (req, res) => {
  try {
    const payload = await getStudentTodayAttendance(req.user._id || req.user.id);
    return res.json({
      ok: true,
      classes: payload.classes || [],
      data: payload.classes || [],
      count: payload.count || (payload.classes || []).length,
      start: payload.start,
      now: payload.now,
      timestamp: payload.now,
      timezone: payload.timezone,
    });
  } catch (err) {
    console.error("Student today sessions error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
};

router.get("/sessions/today", auth(["STUDENT"]), handleStudentTodayAttendance);
router.get("/attendance/today-live", auth(["STUDENT"]), handleStudentTodayAttendance);
router.get("/live-attendance", auth(["STUDENT"]), handleStudentTodayAttendance);

// ----------------------------------------------------
// ACTIVE SESSION FOR STUDENT
// GET /api/student/session/active
// ----------------------------------------------------
router.get("/session/active", auth(["STUDENT"]), async (req, res) => {
  try {
    const student = req.user;
    const supabase = getSupabaseClient();
    if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

    const normalizedSection = String(student.section || "").trim().toUpperCase();
    const studentDeptId = String(student.department?.id || student.department);

    const { data: rawSessions, error } = await supabase
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
        start_time,
        is_active,
        subj:subjects(id, name, code, created_by_admin, departments),
        fac:faculties(id, name)
      `)
      .eq("year", Number(student.year))
      .eq("semester", Number(student.semester))
      .eq("is_active", true);

    if (error) throw error;

    const matchingSession = (rawSessions || []).find((s) => {
      const sSec = String(s.section || "").trim().toUpperCase();
      if (sSec && normalizedSection && sSec !== normalizedSection) return false;
      if (s.department && String(s.department) !== studentDeptId) return false;
      return true;
    });

    if (!matchingSession) {
      return res.json({ ok: true, hasActiveSession: false, session: null });
    }

    return res.json({
      ok: true,
      hasActiveSession: true,
      session: {
        id: matchingSession.id,
        _id: matchingSession.id,
        subjectName: matchingSession.subj?.name || "Subject",
        subjectCode: matchingSession.subj?.code || "",
        facultyName: matchingSession.fac?.name || "Faculty",
        startTime: matchingSession.start_time,
        location: matchingSession.location,
        isActive: true,
      },
    });
  } catch (err) {
    console.error("Student active session error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ----------------------------------------------------
// RECENT SESSIONS FOR STUDENT
// GET /api/student/sessions/recent, /api/student/recent-sessions
// ----------------------------------------------------
const handleStudentRecentSessions = async (req, res) => {
  try {
    const studentId = req.user._id || req.user.id;
    const supabase = getSupabaseClient();
    if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

    const limit = Number(req.query.limit || 20);

    const { data: rawAttendances, error } = await supabase
      .from("attendances")
      .select(`
        id,
        timestamp,
        status,
        session,
        subject:subjects(id, name, code),
        faculty:faculties(id, name),
        sess:sessions(id, start_time, end_time, is_active)
      `)
      .eq("student", String(studentId))
      .order("timestamp", { ascending: false })
      .limit(limit);

    if (error) throw error;

    const formatted = (rawAttendances || []).map((att) => ({
      attendanceId: att.id,
      _id: att.id,
      sessionId: att.session,
      subjectName: att.subject?.name || "Subject",
      subjectCode: String(att.subject?.code || att.subject?.name || "SUB").toUpperCase(),
      facultyName: att.faculty?.name || "Faculty",
      startTime: att.sess?.start_time || att.timestamp,
      endTime: att.sess?.end_time || null,
      markedAt: att.timestamp,
      isActive: Boolean(att.sess?.is_active),
      status: att.status || "present",
      attendanceCode: att.status === "absent" ? "A" : "P",
      present: att.status !== "absent",
    }));

    return res.json({ ok: true, sessions: formatted });
  } catch (err) {
    console.error("Recent sessions error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
};

router.get("/sessions/recent", auth(["STUDENT"]), handleStudentRecentSessions);
router.get("/recent-sessions", auth(["STUDENT"]), handleStudentRecentSessions);

// ----------------------------------------------------
// ATTENDANCE OVERVIEW FOR STUDENT
// GET /api/student/attendance/overview, /api/student/attendance-overview
// ----------------------------------------------------
const handleStudentAttendanceOverview = async (req, res) => {
  try {
    const student = req.user;
    const studentId = String(student.id || student._id);
    const adminId = String(student.created_by_admin || student.createdByAdmin);
    const studentDeptId = String(student.department?.id || student.department);

    const supabase = getSupabaseClient();
    if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

    const { data: allSubjects } = await supabase
      .from("subjects")
      .select("id, name, code, allotted_faculties, departments")
      .eq("created_by_admin", adminId)
      .eq("year", Number(student.year))
      .eq("semester", Number(student.semester));

    const subjects = (allSubjects || []).filter((s) =>
      Array.isArray(s.departments) && s.departments.some((d) => String(d) === studentDeptId)
    );

    const subjectIds = subjects.map((s) => s.id);
    if (subjectIds.length === 0) {
      return res.json({
        ok: true,
        overview: {
          totalClassesConducted: 0,
          classesAttended: 0,
          classesMissed: 0,
          overallAttendancePercentage: 0,
          subjectCount: 0,
        },
        subjects: [],
      });
    }

    const { data: rawSessions } = await supabase
      .from("sessions")
      .select("id, subject, faculty, department, start_time, end_time, is_active")
      .in("subject", subjectIds)
      .eq("year", Number(student.year))
      .eq("semester", Number(student.semester))
      .eq("section", String(student.section || "").toUpperCase())
      .eq("is_active", false)
      .not("end_time", "is", null);

    const sessions = (rawSessions || []).filter(
      (s) => !s.department || String(s.department) === studentDeptId
    );

    const sessionIds = sessions.map((s) => s.id);
    let attendanceRows = [];
    if (sessionIds.length > 0) {
      const { data: attData } = await supabase
        .from("attendances")
        .select("session, timestamp, status")
        .eq("student", studentId)
        .in("session", sessionIds)
        .eq("status", "present");

      attendanceRows = attData || [];
    }

    const presentBySession = new Map(attendanceRows.map((row) => [String(row.session), row]));

    const subjectMap = new Map();
    subjects.forEach((subject) => {
      subjectMap.set(String(subject.id), {
        subjectId: subject.id,
        _id: subject.id,
        subjectName: subject.name,
        subjectCode: subject.code,
        totalClassesConducted: 0,
        classesAttended: 0,
        classesMissed: 0,
        attendancePercentage: 0,
      });
    });

    sessions.forEach((session) => {
      const entry = subjectMap.get(String(session.subject));
      if (entry) {
        entry.totalClassesConducted += 1;
        if (presentBySession.has(String(session.id))) {
          entry.classesAttended += 1;
        } else {
          entry.classesMissed += 1;
        }
      }
    });

    const subjectAnalytics = Array.from(subjectMap.values()).map((entry) => {
      const pct =
        entry.totalClassesConducted > 0
          ? Number(((entry.classesAttended / entry.totalClassesConducted) * 100).toFixed(2))
          : 0;
      return { ...entry, attendancePercentage: pct };
    });

    const overview = subjectAnalytics.reduce(
      (acc, s) => {
        acc.totalClassesConducted += s.totalClassesConducted;
        acc.classesAttended += s.classesAttended;
        acc.classesMissed += s.classesMissed;
        return acc;
      },
      {
        totalClassesConducted: 0,
        classesAttended: 0,
        classesMissed: 0,
        overallAttendancePercentage: 0,
        subjectCount: subjectAnalytics.length,
      }
    );

    overview.overallAttendancePercentage =
      overview.totalClassesConducted > 0
        ? Number(
            ((overview.classesAttended / overview.totalClassesConducted) * 100).toFixed(2)
          )
        : 0;

    return res.json({
      ok: true,
      overview,
      subjects: subjectAnalytics,
    });
  } catch (err) {
    console.error("Student attendance overview error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
};

router.get("/attendance/overview", auth(["STUDENT"]), handleStudentAttendanceOverview);
router.get("/attendance-overview", auth(["STUDENT"]), handleStudentAttendanceOverview);

module.exports = router;
