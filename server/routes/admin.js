const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const { getSupabaseClient } = require("../config/supabase");
const adminAuth = require("../middleware/adminAuth");

function sanitizePositiveInt(value, fallback, min = 1, max = 1000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), min), max);
}

function normalizeFrontendUrl(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) return "";

  try {
    const parsed = new URL(value);
    const isLocalDevHost =
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "0.0.0.0";

    const shouldStripDevPort = parsed.port === "5173" && !isLocalDevHost;

    if (shouldStripDevPort) {
      parsed.port = "";
    }

    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return value.replace(/\/+$/, "");
  }
}

function getFrontendBaseUrl(req) {
  const configured = String(process.env.FRONTEND_URL || "").trim();
  if (configured) {
    return normalizeFrontendUrl(configured);
  }

  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const forwardedHost = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
  if (forwardedProto && forwardedHost) {
    return normalizeFrontendUrl(`${forwardedProto}://${forwardedHost}`);
  }

  const origin = String(req.headers.origin || "").trim();
  if (origin) {
    return normalizeFrontendUrl(origin);
  }

  const referer = String(req.headers.referer || "").trim();
  if (referer) {
    try {
      const parsed = new URL(referer);
      return normalizeFrontendUrl(parsed.origin);
    } catch {
      // Ignore invalid referer
    }
  }

  return "https://smartattend.app";
}

// ------------------------------------------------------
// 1) ADMIN SELF-REGISTRATION (OPEN)
// POST /api/admin/create-admin
// ------------------------------------------------------
router.post("/create-admin", async (req, res) => {
  try {
    const { name, email, password, collegeName } = req.body || {};

    if (!name || !email || !password || !collegeName) {
      return res.status(400).json({ ok: false, error: "All fields required" });
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      return res.status(503).json({ ok: false, error: "Database unavailable" });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const { data: exists } = await supabase
      .from("admins")
      .select("id")
      .eq("email", normalizedEmail)
      .single();

    if (exists) {
      return res.status(400).json({ ok: false, error: "Admin already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const { data: admin, error } = await supabase
      .from("admins")
      .insert({
        name: String(name).trim(),
        email: normalizedEmail,
        password_hash: passwordHash,
        college_name: String(collegeName).trim(),
      })
      .select("id")
      .single();

    if (error || !admin) {
      throw error || new Error("Failed to create admin");
    }

    return res.json({ ok: true, adminId: admin.id, _id: admin.id });
  } catch (err) {
    console.error("create-admin error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ------------------------------------------------------
// 1.5) UPDATE ADMIN PROFILE (ADMIN ONLY)
// PUT /api/admin/profile
// ------------------------------------------------------
router.put("/profile", adminAuth, async (req, res) => {
  try {
    const { collegeName, profilePhotoUrl } = req.body || {};
    const adminId = req.userId;
    const supabase = getSupabaseClient();
    if (!supabase) {
      return res.status(503).json({ ok: false, error: "Database unavailable" });
    }

    const updates = { updated_at: new Date().toISOString() };
    if (typeof collegeName === "string") {
      const trimmed = collegeName.trim();
      if (!trimmed) {
        return res.status(400).json({ ok: false, error: "College name cannot be empty" });
      }
      updates.college_name = trimmed;
    }
    if (typeof profilePhotoUrl === "string") {
      updates.profile_photo_url = profilePhotoUrl.trim() || null;
    }

    const { data: updated, error } = await supabase
      .from("admins")
      .update(updates)
      .eq("id", adminId)
      .select("id, name, email, college_name, profile_photo_url")
      .single();

    if (error || !updated) {
      throw error || new Error("Failed to update profile");
    }

    if (updates.college_name) {
      await supabase
        .from("students")
        .update({ college_name: updates.college_name })
        .eq("created_by_admin", adminId)
        .catch(() => undefined);
    }

    return res.json({
      ok: true,
      admin: {
        id: updated.id,
        _id: updated.id,
        name: updated.name,
        email: updated.email,
        collegeName: updated.college_name || null,
        profilePhotoUrl: updated.profile_photo_url || null,
      },
    });
  } catch (err) {
    console.error("update admin profile error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ------------------------------------------------------
// 2) GENERATE REGISTRATION TOKENS (ADMIN ONLY)
// POST /api/admin/generate-registration-link
// ------------------------------------------------------
router.post("/generate-registration-link", adminAuth, async (req, res) => {
  try {
    const { type, expiryHours, maxRegistrations } = req.body || {};

    if (!["student", "faculty"].includes(type)) {
      return res.status(400).json({ ok: false, error: "Invalid type" });
    }

    const safeMaxRegistrations = sanitizePositiveInt(maxRegistrations, 1, 1, 10000);
    const safeExpiryHours = sanitizePositiveInt(expiryHours, 24, 1, 24 * 365);
    const expiresAt = new Date(Date.now() + safeExpiryHours * 60 * 60 * 1000).toISOString();

    const token = "REG_" + crypto.randomBytes(24).toString("hex");
    const supabase = getSupabaseClient();
    if (!supabase) {
      return res.status(503).json({ ok: false, error: "Database unavailable" });
    }

    const { data: record, error } = await supabase
      .from("registration_tokens")
      .insert({
        token,
        type,
        admin_id: req.userId,
        college_name: req.admin.college_name || req.admin.collegeName,
        expires_at: expiresAt,
        max_uses: safeMaxRegistrations,
        uses_count: 0,
        is_active: true,
      })
      .select("*")
      .single();

    if (error || !record) {
      throw error || new Error("Failed to generate token");
    }

    const frontend = getFrontendBaseUrl(req);

    return res.json({
      ok: true,
      token: record.token,
      link: `${frontend}/register?token=${record.token}&role=${type}`,
      config: {
        type: record.type,
        expiresAt: record.expires_at,
        expiryHours: safeExpiryHours,
        maxRegistrations: record.max_uses,
        remainingRegistrations: Math.max(record.max_uses - record.uses_count, 0),
      },
    });
  } catch (err) {
    console.error("generate-registration-link error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ------------------------------------------------------
// 3) GET USERS CREATED BY THIS ADMIN
// GET /api/admin/users
// ------------------------------------------------------
router.get("/users", adminAuth, async (req, res) => {
  try {
    const adminId = req.userId;
    const supabase = getSupabaseClient();
    if (!supabase) {
      return res.status(503).json({ ok: false, error: "Database unavailable" });
    }

    const [studentsRes, facultiesRes] = await Promise.all([
      supabase
        .from("students")
        .select("id, name, email, year, semester, section, device_fingerprint, created_at, department:departments(id, name, code)")
        .eq("created_by_admin", adminId)
        .order("name", { ascending: true }),
      supabase
        .from("faculties")
        .select("id, name, email, device_fingerprint, device_lock_enabled, created_at, department:departments(id, name, code)")
        .eq("created_by_admin", adminId)
        .order("name", { ascending: true }),
    ]);

    const students = studentsRes.data || [];
    const faculties = facultiesRes.data || [];

    const users = [
      ...students.map((u) => ({
        id: u.id,
        _id: u.id,
        name: u.name,
        email: u.email,
        role: "STUDENT",
        departmentId: u.department?.id || null,
        departmentName: u.department?.name || null,
        departmentCode: u.department?.code || null,
        year: u.year || null,
        semester: u.semester || null,
        section: u.section || null,
        status: u.device_fingerprint ? "Bounded" : "Unbounded",
        createdAt: u.created_at,
      })),
      ...faculties.map((u) => ({
        id: u.id,
        _id: u.id,
        name: u.name,
        email: u.email,
        role: "FACULTY",
        departmentId: u.department?.id || null,
        departmentName: u.department?.name || null,
        departmentCode: u.department?.code || null,
        status: u.device_fingerprint ? "Bounded" : "Unbounded",
        deviceLockEnabled: u.device_lock_enabled !== false,
        deviceAccessStatus: u.device_lock_enabled === false ? "Any Device" : "Device Locked",
        createdAt: u.created_at,
      })),
    ];

    return res.json({ ok: true, users });
  } catch (err) {
    console.error("admin users error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ------------------------------------------------------
// 3.25) UPDATE FACULTY DEVICE LOCK (ADMIN ONLY)
// PUT /api/admin/faculty/:facultyId/device-lock
// ------------------------------------------------------
router.put("/faculty/:facultyId/device-lock", adminAuth, async (req, res) => {
  try {
    const enabled = Boolean(req.body?.enabled);
    const facultyId = req.params.facultyId;
    const adminId = req.userId;
    const supabase = getSupabaseClient();
    if (!supabase) {
      return res.status(503).json({ ok: false, error: "Database unavailable" });
    }

    const { data: faculty, error } = await supabase
      .from("faculties")
      .update({ device_lock_enabled: enabled, updated_at: new Date().toISOString() })
      .eq("id", facultyId)
      .eq("created_by_admin", adminId)
      .select("id, name, email, device_fingerprint, device_lock_enabled, created_at, department:departments(id, name, code)")
      .single();

    if (error || !faculty) {
      return res.status(404).json({ ok: false, error: "Faculty not found" });
    }

    return res.json({
      ok: true,
      faculty: {
        id: faculty.id,
        _id: faculty.id,
        name: faculty.name,
        email: faculty.email,
        role: "FACULTY",
        departmentId: faculty.department?.id || null,
        departmentName: faculty.department?.name || null,
        departmentCode: faculty.department?.code || null,
        status: faculty.device_fingerprint ? "Bounded" : "Unbounded",
        deviceLockEnabled: faculty.device_lock_enabled !== false,
        deviceAccessStatus: faculty.device_lock_enabled === false ? "Any Device" : "Device Locked",
        createdAt: faculty.created_at,
      },
    });
  } catch (err) {
    console.error("update faculty device lock error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ------------------------------------------------------
// 3.5) GET STUDENT ATTENDANCE ANALYTICS (ADMIN ONLY)
// GET /api/admin/students/:studentId/analytics
// ------------------------------------------------------
router.get("/students/:studentId/analytics", adminAuth, async (req, res) => {
  try {
    const studentId = req.params.studentId;
    const adminId = req.userId;
    const supabase = getSupabaseClient();
    if (!supabase) {
      return res.status(503).json({ ok: false, error: "Database unavailable" });
    }

    const { data: student } = await supabase
      .from("students")
      .select("id, name, email, enrollment_no, semester, section, year, profile_photo_url, department, dept:departments(id, name, code)")
      .eq("id", studentId)
      .eq("created_by_admin", adminId)
      .single();

    if (!student) {
      return res.status(404).json({ ok: false, error: "Student not found" });
    }

    const studentDeptId = student.dept?.id || student.department;

    // Fetch subjects for this student cohort
    const { data: allSubjects } = await supabase
      .from("subjects")
      .select("id, name, code, allotted_faculties, departments")
      .eq("created_by_admin", adminId)
      .eq("year", Number(student.year))
      .eq("semester", Number(student.semester));

    const subjects = (allSubjects || []).filter((s) =>
      Array.isArray(s.departments) && s.departments.some((d) => String(d) === String(studentDeptId))
    );

    const subjectIds = subjects.map((s) => s.id);

    if (subjectIds.length === 0) {
      return res.json({
        ok: true,
        student: {
          id: student.id,
          _id: student.id,
          name: student.name,
          email: student.email,
          enrollmentNo: student.enrollment_no,
          semester: student.semester,
          section: student.section,
          year: student.year,
          departmentName: student.dept?.name || null,
          departmentCode: student.dept?.code || null,
          profilePhotoUrl: student.profile_photo_url || "",
        },
        overview: {
          totalClassesConducted: 0,
          classesAttended: 0,
          classesMissed: 0,
          overallAttendancePercentage: 0,
          subjectCount: 0,
          strongSubjects: 0,
          riskSubjects: 0,
        },
        subjects: [],
        recentSessions: [],
      });
    }

    // Fetch all completed sessions for this class group
    const { data: rawSessions } = await supabase
      .from("sessions")
      .select("id, subject, faculty, department, start_time, end_time, is_active, subj:subjects(id, name, code), fac:faculties(id, name)")
      .in("subject", subjectIds)
      .eq("year", Number(student.year))
      .eq("semester", Number(student.semester))
      .eq("section", String(student.section || "").toUpperCase())
      .eq("is_active", false)
      .not("end_time", "is", null)
      .order("end_time", { ascending: false });

    const sessions = (rawSessions || []).filter(
      (s) => !s.department || String(s.department) === String(studentDeptId)
    );

    const sessionIds = sessions.map((s) => s.id);
    let attendanceRows = [];
    if (sessionIds.length > 0) {
      const { data: attData } = await supabase
        .from("attendances")
        .select("session, timestamp, status")
        .eq("student", student.id)
        .in("session", sessionIds)
        .eq("status", "present");
      attendanceRows = attData || [];
    }

    const presentBySession = new Map(
      attendanceRows.map((row) => [String(row.session), row])
    );

    // Fetch faculty names for subjects
    const facultyIds = [...new Set(subjects.flatMap((s) => s.allotted_faculties || []))];
    const facultyNameMap = new Map();
    if (facultyIds.length > 0) {
      const { data: facs } = await supabase
        .from("faculties")
        .select("id, name")
        .in("id", facultyIds);
      (facs || []).forEach((f) => facultyNameMap.set(String(f.id), f.name));
    }

    const subjectMap = new Map();
    for (const subject of subjects) {
      const facultyNames = (subject.allotted_faculties || [])
        .map((fId) => facultyNameMap.get(String(fId)))
        .filter(Boolean);

      subjectMap.set(String(subject.id), {
        subjectId: subject.id,
        _id: subject.id,
        subjectName: subject.name || "Subject",
        subjectCode: subject.code || "",
        facultyNames,
        totalClassesConducted: 0,
        classesAttended: 0,
        classesMissed: 0,
        attendancePercentage: 0,
        lastClassAt: null,
      });
    }

    for (const session of sessions) {
      const present = presentBySession.has(String(session.id));
      const subjectId = String(session.subject || session.subj?.id || "");
      const entry = subjectMap.get(subjectId);

      if (entry) {
        entry.totalClassesConducted += 1;
        if (present) {
          entry.classesAttended += 1;
        } else {
          entry.classesMissed += 1;
        }

        const endedAt = session.end_time || session.start_time || null;
        if (endedAt && (!entry.lastClassAt || new Date(endedAt) > new Date(entry.lastClassAt))) {
          entry.lastClassAt = endedAt;
        }
      }
    }

    const recentSessions = sessions.slice(0, 12).map((session) => {
      const present = presentBySession.has(String(session.id));
      return {
        sessionId: session.id,
        _id: session.id,
        subjectName: session.subj?.name || "Subject",
        subjectCode: session.subj?.code || "",
        facultyName: session.fac?.name || "Faculty",
        status: present ? "present" : "absent",
        attendanceCode: present ? "P" : "A",
        startTime: session.start_time || null,
        endTime: session.end_time || null,
      };
    });

    const subjectAnalytics = Array.from(subjectMap.values())
      .map((entry) => {
        const attendancePercentage =
          entry.totalClassesConducted > 0
            ? Number(
                ((entry.classesAttended / entry.totalClassesConducted) * 100).toFixed(2)
              )
            : 0;

        return {
          ...entry,
          attendancePercentage,
        };
      })
      .sort((a, b) => {
        if (a.attendancePercentage !== b.attendancePercentage) {
          return b.attendancePercentage - a.attendancePercentage;
        }
        return `${a.subjectName}::${a.subjectCode}`.localeCompare(
          `${b.subjectName}::${b.subjectCode}`
        );
      });

    const overview = subjectAnalytics.reduce(
      (acc, subject) => {
        acc.totalClassesConducted += subject.totalClassesConducted;
        acc.classesAttended += subject.classesAttended;
        acc.classesMissed += subject.classesMissed;
        if (subject.attendancePercentage >= 75) acc.strongSubjects += 1;
        if (subject.totalClassesConducted > 0 && subject.attendancePercentage < 75) {
          acc.riskSubjects += 1;
        }
        return acc;
      },
      {
        totalClassesConducted: 0,
        classesAttended: 0,
        classesMissed: 0,
        overallAttendancePercentage: 0,
        subjectCount: subjectAnalytics.length,
        strongSubjects: 0,
        riskSubjects: 0,
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
      student: {
        id: student.id,
        _id: student.id,
        name: student.name,
        email: student.email,
        enrollmentNo: student.enrollment_no,
        semester: student.semester,
        section: student.section,
        year: student.year,
        departmentName: student.dept?.name || null,
        departmentCode: student.dept?.code || null,
        profilePhotoUrl: student.profile_photo_url || "",
      },
      overview,
      subjects: subjectAnalytics,
      recentSessions,
    });
  } catch (err) {
    console.error("admin student analytics error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ------------------------------------------------------
// 4) DEPARTMENTS (ADMIN-SCOPED)
// ------------------------------------------------------
router.get("/departments", adminAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

    const { data: list, error } = await supabase
      .from("departments")
      .select("*")
      .eq("created_by_admin", req.userId)
      .order("name", { ascending: true });

    if (error) throw error;
    const departments = (list || []).map((d) => ({ ...d, _id: d.id }));
    return res.json({ ok: true, departments });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

router.post("/departments", adminAuth, async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const code = String(req.body?.code || "").trim().toUpperCase();
    if (!name || !code) {
      return res.status(400).json({ ok: false, error: "Name and code required" });
    }

    const supabase = getSupabaseClient();
    if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

    const { data: existing } = await supabase
      .from("departments")
      .select("id")
      .eq("name", name)
      .eq("code", code)
      .eq("created_by_admin", req.userId)
      .single();

    if (existing) {
      return res.status(409).json({
        ok: false,
        error: "Department already exists for this admin",
      });
    }

    const { data: dept, error } = await supabase
      .from("departments")
      .insert({
        name,
        code,
        created_by_admin: req.userId,
      })
      .select("*")
      .single();

    if (error || !dept) throw error || new Error("Failed to create department");

    return res.json({ ok: true, department: { ...dept, _id: dept.id } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

router.delete("/departments/:id", adminAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

    await supabase
      .from("departments")
      .delete()
      .eq("id", req.params.id)
      .eq("created_by_admin", req.userId);

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ------------------------------------------------------
// 5) SUBJECTS (ADMIN-SCOPED)
// ------------------------------------------------------
router.get("/subjects", adminAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

    const { data: rawSubjects, error } = await supabase
      .from("subjects")
      .select("*")
      .eq("created_by_admin", req.userId)
      .order("name", { ascending: true });

    if (error) throw error;

    const subjects = rawSubjects || [];
    const deptIds = [...new Set(subjects.flatMap((s) => s.departments || []))];
    const facIds = [...new Set(subjects.flatMap((s) => s.allotted_faculties || []))];

    const [deptRes, facRes] = await Promise.all([
      deptIds.length > 0 ? supabase.from("departments").select("id, name, code").in("id", deptIds) : { data: [] },
      facIds.length > 0 ? supabase.from("faculties").select("id, name, email").in("id", facIds) : { data: [] },
    ]);

    const deptMap = new Map((deptRes.data || []).map((d) => [String(d.id), { ...d, _id: d.id }]));
    const facMap = new Map((facRes.data || []).map((f) => [String(f.id), { ...f, _id: f.id }]));

    const populated = subjects.map((s) => ({
      ...s,
      _id: s.id,
      departments: (s.departments || []).map((id) => deptMap.get(String(id))).filter(Boolean),
      allottedFaculties: (s.allotted_faculties || []).map((id) => facMap.get(String(id))).filter(Boolean),
    }));

    return res.json({ ok: true, subjects: populated });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

router.post("/subjects", adminAuth, async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const code = String(req.body?.code || "").trim().toUpperCase();
    const { departmentIds = [], year, semester } = req.body || {};

    if (!name || !code) {
      return res.status(400).json({ ok: false, error: "Name & code required" });
    }

    const deps = Array.isArray(departmentIds)
      ? departmentIds.filter(Boolean)
      : [departmentIds].filter(Boolean);

    const supabase = getSupabaseClient();
    if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

    const { data: subj, error } = await supabase
      .from("subjects")
      .insert({
        name,
        code,
        year: Number(year),
        semester: Number(semester),
        departments: deps,
        created_by_admin: req.userId,
      })
      .select("*")
      .single();

    if (error || !subj) throw error || new Error("Failed to create subject");

    return res.json({ ok: true, subject: { ...subj, _id: subj.id } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

router.delete("/subjects/:id", adminAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

    await supabase
      .from("subjects")
      .delete()
      .eq("id", req.params.id)
      .eq("created_by_admin", req.userId);

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ------------------------------------------------------
// 6) STUDENT LIFECYCLE, DELETION & RETENTION (ADMIN-SCOPED)
// ------------------------------------------------------

// DELETE /api/admin/students/:id
// Safely removes student account while preserving all USN-tagged attendance logs
router.delete("/students/:id", adminAuth, async (req, res) => {
  try {
    const studentId = req.params.id;
    const adminId = req.userId;
    const supabase = getSupabaseClient();
    if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

    // 1. Fetch student to get enrollment number for audit & count
    const { data: student, error: fetchErr } = await supabase
      .from("students")
      .select("id, name, enrollment_no, email")
      .eq("id", studentId)
      .eq("created_by_admin", adminId)
      .single();

    if (fetchErr || !student) {
      return res.status(404).json({ ok: false, error: "Student not found" });
    }

    // 2. Count preserved attendance logs
    const { count: preservedCount } = await supabase
      .from("attendances")
      .select("id", { count: "exact", head: true })
      .or(`student.eq.${studentId},enrollment_no.eq.${student.enrollment_no}`);

    // 3. Ensure any attendances referencing this student have snapshot columns populated
    await supabase
      .from("attendances")
      .update({
        enrollment_no: student.enrollment_no,
        student_name: student.name,
        student_email: student.email,
        updated_at: new Date().toISOString(),
      })
      .eq("student", studentId)
      .is("enrollment_no", null);

    // 4. Delete student from students table
    const { error: deleteErr } = await supabase
      .from("students")
      .delete()
      .eq("id", studentId)
      .eq("created_by_admin", adminId);

    if (deleteErr) throw deleteErr;

    return res.json({
      ok: true,
      message: "Student deleted successfully. Attendance logs preserved with USN.",
      enrollmentNo: student.enrollment_no,
      preservedAttendanceCount: preservedCount || 0,
    });
  } catch (err) {
    console.error("Delete student error:", err);
    return res.status(500).json({ ok: false, error: "Failed to delete student" });
  }
});

// POST /api/admin/students/promote
// Promotes students to the next semester or academic year while retaining attendance logs
router.post("/students/promote", adminAuth, async (req, res) => {
  try {
    const adminId = req.userId;
    const { studentIds, targetSemester, targetYear, targetSection, departmentId } = req.body || {};

    const supabase = getSupabaseClient();
    if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

    let query = supabase
      .from("students")
      .select("id, name, enrollment_no, year, semester, section, department")
      .eq("created_by_admin", adminId);

    if (Array.isArray(studentIds) && studentIds.length > 0) {
      query = query.in("id", studentIds);
    } else if (departmentId) {
      query = query.eq("department", departmentId);
    } else {
      return res.status(400).json({ ok: false, error: "studentIds or departmentId required" });
    }

    const { data: students, error: fetchErr } = await query;
    if (fetchErr) throw fetchErr;

    if (!students || students.length === 0) {
      return res.status(404).json({ ok: false, error: "No matching students found to promote" });
    }

    const updates = [];
    for (const student of students) {
      const currentYear = Number(student.year || 1);
      const currentSem = Number(student.semester || 1);

      let nextSem = targetSemester ? Number(targetSemester) : currentSem + 1;
      let nextYear = targetYear
        ? Number(targetYear)
        : nextSem % 2 === 1 && currentSem % 2 === 0
        ? currentYear + 1
        : currentYear;

      nextYear = Math.min(Math.max(nextYear, 1), 4);
      nextSem = Math.min(Math.max(nextSem, 1), 8);

      const payload = {
        year: nextYear,
        semester: nextSem,
        updated_at: new Date().toISOString(),
      };
      if (targetSection) payload.section = String(targetSection).toUpperCase();

      updates.push(
        supabase
          .from("students")
          .update(payload)
          .eq("id", student.id)
          .eq("created_by_admin", adminId)
      );
    }

    await Promise.all(updates);

    return res.json({
      ok: true,
      message: `Successfully promoted ${students.length} student(s). All historical attendance logs preserved.`,
      promotedCount: students.length,
    });
  } catch (err) {
    console.error("Promote students error:", err);
    return res.status(500).json({ ok: false, error: "Failed to promote students" });
  }
});

// POST /api/admin/attendance/purge
// Explicit database-level purge for attendance logs (Admin Only)
router.post("/attendance/purge", adminAuth, async (req, res) => {
  try {
    const adminId = req.userId;
    const { enrollmentNo, beforeDate, subjectId, confirmPurge } = req.body || {};

    if (!confirmPurge) {
      return res.status(400).json({
        ok: false,
        error: "Confirmation required to purge attendance records permanently.",
      });
    }

    const supabase = getSupabaseClient();
    if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

    let deleteQuery = supabase.from("attendances").delete();

    if (enrollmentNo) {
      deleteQuery = deleteQuery.eq("enrollment_no", String(enrollmentNo).trim().toUpperCase());
    }
    if (beforeDate) {
      deleteQuery = deleteQuery.lte("timestamp", new Date(beforeDate).toISOString());
    }
    if (subjectId) {
      deleteQuery = deleteQuery.eq("subject", subjectId);
    }

    const { data: deleted, error: delErr } = await deleteQuery.select("id");
    if (delErr) throw delErr;

    return res.json({
      ok: true,
      message: "Explicit attendance purge completed successfully.",
      purgedCount: (deleted || []).length,
    });
  } catch (err) {
    console.error("Purge attendance error:", err);
    return res.status(500).json({ ok: false, error: "Failed to purge attendance records" });
  }
});

module.exports = router;
