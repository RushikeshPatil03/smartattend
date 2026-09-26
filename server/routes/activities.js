// server/routes/activities.js
const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const { getSupabaseClient } = require("../config/supabase");
const { syncActivityBatches } = require("../services/batchManagementService");

// Helper: Ensure authenticated faculty or admin
function requireFaculty(req, res) {
  if (req.userRole !== "FACULTY" && req.userRole !== "ADMIN") {
    res.status(403).json({ ok: false, error: "Faculty access required" });
    return false;
  }
  return true;
}

// 1. GET /api/activities - List all activities for the logged-in faculty
router.get("/", authMiddleware, async (req, res) => {
  if (!requireFaculty(req, res)) return;
  const supabase = getSupabaseClient();
  if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

  try {
    const { data: activities, error } = await supabase
      .from("activities")
      .select(`
        *,
        dept:departments(id, name, code),
        batches:activity_batches(*)
      `)
      .eq("faculty", req.userId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    const includeArchived = req.query.includeArchived === "true";
    const cleanedActivities = (activities || []).map((act) => ({
      ...act,
      batches: includeArchived
        ? act.batches || []
        : (act.batches || []).filter((b) => b.is_active !== false),
    }));
    return res.json({ ok: true, activities: cleanedActivities });
  } catch (err) {
    console.error("Fetch activities error:", err);
    return res.status(500).json({ ok: false, error: "Failed to fetch activities" });
  }
});

// 2. GET /api/activities/cohort-students - Fast lookup of students for batch formation
router.get("/cohort-students", authMiddleware, async (req, res) => {
  if (!requireFaculty(req, res)) return;
  const supabase = getSupabaseClient();
  if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

  try {
    const years = req.query.years || req.query.year;
    const semesters = req.query.semesters || req.query.semester;
    const section = req.query.section || req.query.sections;
    const usns = req.query.usns;

    // 1. Get faculty's department or department passed in query
    let department = req.query.departmentId || req.query.department || req.user?.department;
    if (!department && req.userRole === "FACULTY") {
      const { data: faculty } = await supabase
        .from("faculties")
        .select("department")
        .eq("id", req.userId)
        .single();
      department = faculty?.department;
    }

    const buildBaseQuery = (includeDept = true) => {
      let q = supabase
        .from("students")
        .select("id, name, enrollment_no, year, semester, section, email, department");

      if (includeDept && department && String(department).toUpperCase() !== "ALL") {
        q = q.eq("department", department);
      }

      // Parse years
      if (years) {
        const yList = String(years)
          .split(",")
          .map((y) => Number(y.trim()))
          .filter((n) => !isNaN(n) && n > 0);
        if (yList.length === 1) {
          q = q.eq("year", yList[0]);
        } else if (yList.length > 1) {
          q = q.in("year", yList);
        }
      }

      // Parse semesters
      if (semesters) {
        const sList = String(semesters)
          .split(",")
          .map((s) => Number(s.trim()))
          .filter((n) => !isNaN(n) && n > 0);
        if (sList.length === 1) {
          q = q.eq("semester", sList[0]);
        } else if (sList.length > 1) {
          q = q.in("semester", sList);
        }
      }

      // Parse section (resilient against "B" vs "Section B")
      if (section && String(section).toUpperCase() !== "ALL") {
        const rawSec = String(section).trim();
        const cleanSec = rawSec.replace(/^SECTION\s+/i, "").trim().toUpperCase();
        const secVariants = Array.from(new Set([rawSec.toUpperCase(), cleanSec, `SECTION ${cleanSec}`])).filter(Boolean);
        if (secVariants.length === 1) {
          q = q.eq("section", secVariants[0]);
        } else if (secVariants.length > 1) {
          q = q.in("section", secVariants);
        }
      }

      return q;
    };

    let { data: students, error } = await buildBaseQuery(true).order("enrollment_no", { ascending: true });
    if (error) throw error;

    // Resilient fallback: If 0 students were found with department constraint, query without department
    if ((!students || students.length === 0) && department && String(department).toUpperCase() !== "ALL") {
      const fallback = await buildBaseQuery(false).order("enrollment_no", { ascending: true });
      if (!fallback.error && fallback.data && fallback.data.length > 0) {
        students = fallback.data;
      }
    }

    let resultStudents = students || [];

    // Also include any explicitly requested USNs (e.g. from existing batches) if not already present
    if (usns) {
      const usnList = (Array.isArray(usns) ? usns : String(usns).split(","))
        .map((u) => String(u).trim().toUpperCase())
        .filter(Boolean);
      if (usnList.length > 0) {
        const existingUsns = new Set(resultStudents.map((s) => (s.enrollment_no || "").toUpperCase()));
        const missingUsns = usnList.filter((u) => !existingUsns.has(u));
        if (missingUsns.length > 0) {
          const { data: explicitStudents } = await supabase
            .from("students")
            .select("id, name, enrollment_no, year, semester, section, email, department")
            .in("enrollment_no", missingUsns);

          if (explicitStudents && explicitStudents.length > 0) {
            resultStudents = [...resultStudents, ...explicitStudents];
            resultStudents.sort((a, b) => (a.enrollment_no || "").localeCompare(b.enrollment_no || ""));
          }
        }
      }
    }

    return res.json({ ok: true, students: resultStudents });
  } catch (err) {
    console.error("Fetch cohort students error:", err);
    return res.status(500).json({ ok: false, error: "Failed to fetch cohort students" });
  }
});

// 3. GET /api/activities/student - For Student Dashboard (placed before parameterized :id)
router.get("/student", authMiddleware, async (req, res) => {
  const supabase = getSupabaseClient();
  if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

  try {
    const { data: student } = await supabase
      .from("students")
      .select("id, department, year, semester, section, enrollment_no")
      .eq("id", req.userId)
      .single();

    if (!student) return res.status(404).json({ ok: false, error: "Student not found" });

    // Fetch activities for student's department
    const { data: activities, error } = await supabase
      .from("activities")
      .select(`
        *,
        dept:departments(code, name),
        batches:activity_batches(*)
      `)
      .eq("department", student.department);

    if (error) throw error;

    // Filter activities matching student's year, sem, section, and batch enrollment
    const studentEnrollment = (student.enrollment_no || "").trim().toUpperCase();
    const studentYear = Number(student.year);
    const studentSem = Number(student.semester);
    const studentSec = (student.section || "").trim().toUpperCase();

    const matchedActivities = (activities || []).filter((act) => {
      // Year match (or ALL)
      if (Array.isArray(act.years) && act.years.length > 0) {
        if (!act.years.map(Number).includes(studentYear)) return false;
      }
      // Semester match (or ALL)
      if (Array.isArray(act.semesters) && act.semesters.length > 0) {
        if (!act.semesters.map(Number).includes(studentSem)) return false;
      } else if (act.semester && Number(act.semester) !== studentSem) {
        return false;
      }
      // Section match (or ALL)
      if (act.section && act.section.toUpperCase() !== "ALL") {
        const sections = act.section.split(",").map((s) => s.trim().toUpperCase());
        if (!sections.includes(studentSec)) return false;
      }
      return true;
    }).map((act) => {
      // Determine student's assigned batch
      const batches = act.batches || [];
      let assignedBatch = batches.find((b) =>
        Array.isArray(b.student_enrollments) &&
        b.student_enrollments.some((e) => String(e).trim().toUpperCase() === studentEnrollment)
      );

      // If no specific batch assigned, default to batch 1
      if (!assignedBatch && batches.length > 0) {
        assignedBatch = batches[0];
      }

      const deptCode = act.dept?.code || "ACT";
      const batchCode = assignedBatch ? `${deptCode} - ${assignedBatch.batch_number}` : `${deptCode} - 1`;

      return {
        ...act,
        assignedBatch,
        batchCode,
      };
    });

    // Check live and completed sessions for matched activities
    const matchedActivityIds = matchedActivities.map((a) => String(a.id));
    let allSessions = [];
    let markedSessionIds = new Set();

    if (matchedActivityIds.length > 0) {
      const { data: rawSessions } = await supabase
        .from("sessions")
        .select("id, activity_id, batch_id, batch_ids, is_active, start_time, end_time")
        .in("activity_id", matchedActivityIds);

      allSessions = Array.isArray(rawSessions) ? rawSessions : [];
      const sessionIds = allSessions.map((s) => String(s.id));

      if (sessionIds.length > 0) {
        const { data: userAtt } = await supabase
          .from("attendances")
          .select("session, status")
          .eq("student", req.userId)
          .in("session", sessionIds)
          .eq("status", "present");

        if (Array.isArray(userAtt)) {
          userAtt.forEach((a) => markedSessionIds.add(String(a.session)));
        }
      }
    }

    const enrichedActivities = matchedActivities.map((act) => {
      const actSessions = allSessions.filter((s) => String(s.activity_id) === String(act.id));
      const liveSession = actSessions.find((s) => s.is_active === true);
      let hasActiveSession = false;
      let isAlreadyMarked = false;
      let activeSessionId = null;

      if (liveSession) {
        // If session has batch_id or batch_ids, check if it matches student's assignedBatch
        const hasSpecificBatches = Boolean(
          liveSession.batch_id ||
          (Array.isArray(liveSession.batch_ids) && liveSession.batch_ids.length > 0)
        );

        let batchMatches = !hasSpecificBatches;
        if (hasSpecificBatches && act.assignedBatch) {
          const assignedId = String(act.assignedBatch.id);
          if (Array.isArray(liveSession.batch_ids) && liveSession.batch_ids.length > 0) {
            batchMatches = liveSession.batch_ids.map(String).includes(assignedId);
          } else if (liveSession.batch_id) {
            batchMatches = String(liveSession.batch_id) === assignedId;
          }
        }

        if (batchMatches) {
          hasActiveSession = true;
          activeSessionId = liveSession.id;
          isAlreadyMarked = markedSessionIds.has(String(liveSession.id));
        }
      }

      // Compute completed activity sessions attendance stats
      const completedSessions = actSessions.filter((s) => !s.is_active && s.end_time);
      let totalConducted = 0;
      let totalAttended = 0;

      completedSessions.forEach((sess) => {
        const isPresent = markedSessionIds.has(String(sess.id));
        if (isPresent) {
          totalConducted += 1;
          totalAttended += 1;
          return;
        }

        const hasSpecificBatches = Boolean(
          sess.batch_id ||
          (Array.isArray(sess.batch_ids) && sess.batch_ids.length > 0)
        );

        if (!hasSpecificBatches) {
          totalConducted += 1;
        } else if (act.assignedBatch) {
          const assignedId = String(act.assignedBatch.id);
          const isMyBatch =
            (Array.isArray(sess.batch_ids) && sess.batch_ids.map(String).includes(assignedId)) ||
            (sess.batch_id && String(sess.batch_id) === assignedId);
          if (isMyBatch) {
            totalConducted += 1;
          }
        }
      });

      const attendancePercentage =
        totalConducted > 0 ? Number(((totalAttended / totalConducted) * 100).toFixed(1)) : 0;

      return {
        ...act,
        hasActiveSession,
        activeSessionId,
        isAlreadyMarked,
        totalSessionsConducted: totalConducted,
        sessionsAttended: totalAttended,
        sessionsMissed: Math.max(0, totalConducted - totalAttended),
        attendancePercentage,
      };
    });

    return res.json({ ok: true, activities: enrichedActivities });
  } catch (err) {
    console.error("Fetch student activities error:", err);
    return res.status(500).json({ ok: false, error: "Failed to fetch student activities" });
  }
});

// 4. POST /api/activities - Create Activity & Batches
router.post("/", authMiddleware, async (req, res) => {
  if (!requireFaculty(req, res)) return;
  const { name, type, eventDate, startDate, endDate, years, semesters, semester, section, batches } = req.body;

  if (!name || !type) {
    return res.status(400).json({ ok: false, error: "Activity name and type are required" });
  }

  const supabase = getSupabaseClient();
  if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

  try {
    // 1. Fetch faculty's department (allow explicit body override or fallback to faculty record)
    let department = req.body.department || req.body.departmentId || req.user?.department;
    if (!department) {
      const { data: faculty } = await supabase
        .from("faculties")
        .select("department")
        .eq("id", req.userId)
        .single();
      department = faculty?.department;
    }

    if (!department) {
      return res.status(400).json({ ok: false, error: "Department not found. Please provide a valid department." });
    }

    // 2. Insert Activity
    const upperType = String(type).trim().toUpperCase();

    const parsedYears = Array.isArray(years)
      ? years.map(Number).filter((n) => !isNaN(n) && n > 0)
      : (years ? [Number(years)] : []);

    const parsedSemesters = Array.isArray(semesters)
      ? semesters.map(Number).filter((n) => !isNaN(n) && n > 0)
      : (semesters ? [Number(semesters)] : (semester ? [Number(semester)] : []));

    const primarySem = parsedSemesters.length > 0 ? parsedSemesters[0] : (semester ? Number(semester) : null);

    const { data: activity, error: actError } = await supabase
      .from("activities")
      .insert({
        faculty: req.userId,
        department,
        name: name.trim(),
        type: upperType,
        event_date: upperType === "EVENT" ? eventDate : null,
        start_date: upperType === "TRAINING" ? startDate : null,
        end_date: upperType === "TRAINING" ? endDate : null,
        years: parsedYears,
        semesters: parsedSemesters,
        semester: primarySem,
        section: section ? section.trim().toUpperCase() : null,
      })
      .select("id, faculty, department, name, type, event_date, start_date, end_date, years, semesters, semester, section, is_active, created_at")
      .single();

    if (actError) throw actError;

    // 3. Insert Batches (Default batch if none specified)
    const batchesToInsert = (Array.isArray(batches) && batches.length > 0)
      ? batches.map((b, idx) => ({
          activity_id: activity.id,
          batch_number: Number(b.batchNumber || b.batch_number || idx + 1),
          batch_name: String(b.batchName || b.batch_name || `Batch ${idx + 1}`).trim(),
          student_enrollments: Array.isArray(b.studentEnrollments)
            ? b.studentEnrollments
            : (Array.isArray(b.student_enrollments) ? b.student_enrollments : []),
        }))
      : [{
          activity_id: activity.id,
          batch_number: 1,
          batch_name: "Default Batch",
          student_enrollments: [],
        }];

    const { data: insertedBatches, error: batchError } = await supabase
      .from("activity_batches")
      .insert(batchesToInsert)
      .select("id, activity_id, batch_number, batch_name, student_enrollments, created_at");

    if (batchError) throw batchError;

    return res.json({
      ok: true,
      activity: { ...activity, batches: insertedBatches },
      message: "Activity created successfully",
    });
  } catch (err) {
    console.error("Create activity error:", err);
    return res.status(500).json({ ok: false, error: err.message || "Failed to create activity" });
  }
});

// 5. PUT /api/activities/:id - Update Activity & Batches
router.put("/:id", authMiddleware, async (req, res) => {
  if (!requireFaculty(req, res)) return;
  const { id } = req.params;
  const { name, type, eventDate, startDate, endDate, years, semesters, semester, section, batches } = req.body;

  const supabase = getSupabaseClient();
  if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

  try {
    const upperType = type ? String(type).trim().toUpperCase() : undefined;
    const updatePayload = {
      updated_at: new Date().toISOString(),
    };

    if (name !== undefined) updatePayload.name = name.trim();
    if (upperType !== undefined) {
      updatePayload.type = upperType;
      updatePayload.event_date = upperType === "EVENT" ? eventDate : null;
      updatePayload.start_date = upperType === "TRAINING" ? startDate : null;
      updatePayload.end_date = upperType === "TRAINING" ? endDate : null;
    } else {
      if (eventDate !== undefined) updatePayload.event_date = eventDate;
      if (startDate !== undefined) updatePayload.start_date = startDate;
      if (endDate !== undefined) updatePayload.end_date = endDate;
    }

    if (years !== undefined) {
      updatePayload.years = Array.isArray(years)
        ? years.map(Number).filter((n) => !isNaN(n) && n > 0)
        : [];
    }

    if (semesters !== undefined) {
      const sList = Array.isArray(semesters)
        ? semesters.map(Number).filter((n) => !isNaN(n) && n > 0)
        : [];
      updatePayload.semesters = sList;
      updatePayload.semester = sList.length > 0 ? sList[0] : null;
    } else if (semester !== undefined) {
      updatePayload.semester = semester ? Number(semester) : null;
    }

    if (section !== undefined) updatePayload.section = section ? section.trim().toUpperCase() : null;

    const { data: updatedActivity, error: updateError } = await supabase
      .from("activities")
      .update(updatePayload)
      .eq("id", id)
      .eq("faculty", req.userId)
      .select("id, faculty, department, name, type, event_date, start_date, end_date, years, semesters, semester, section, is_active, updated_at")
      .single();

    if (updateError) throw updateError;
    if (!updatedActivity) {
      return res.status(404).json({ ok: false, error: "Activity not found or not owned by faculty" });
    }

    // Safely sync batches in-place if provided
    let updatedBatches = null;
    if (Array.isArray(batches)) {
      updatedBatches = await syncActivityBatches({
        supabase,
        activityId: id,
        facultyId: req.userId,
        batches,
        actorId: req.userId,
        actorRole: req.userRole,
      });
    }

    try {
      const { invalidateBatchRosterCache } = require("./attendance");
      if (typeof invalidateBatchRosterCache === "function") {
        invalidateBatchRosterCache(id);
      }
    } catch {}

    return res.json({
      ok: true,
      activity: {
        ...updatedActivity,
        ...(updatedBatches ? { batches: updatedBatches } : {}),
      },
      message: "Activity updated successfully",
    });
  } catch (err) {
    console.error("Update activity error:", err);
    return res.status(500).json({ ok: false, error: "Failed to update activity" });
  }
});

// 5. DELETE /api/activities/:id
router.delete("/:id", authMiddleware, async (req, res) => {
  if (!requireFaculty(req, res)) return;
  const { id } = req.params;
  const supabase = getSupabaseClient();
  if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

  try {
    const { error } = await supabase
      .from("activities")
      .delete()
      .eq("id", id)
      .eq("faculty", req.userId);

    if (error) throw error;
    return res.json({ ok: true, message: "Activity deleted successfully" });
  } catch (err) {
    console.error("Delete activity error:", err);
    return res.status(500).json({ ok: false, error: "Failed to delete activity" });
  }
});

module.exports = router;
