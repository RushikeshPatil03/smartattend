const express = require("express");
const router = express.Router();

const adminAuth = require("../middleware/adminAuth");
const authMiddleware = require("../middleware/authMiddleware");
const { getSupabaseClient } = require("../config/supabase");

const attachAssignments = async (subjects, adminId) => {
  const subjectIds = subjects.map((subject) => String(subject.id || subject._id));
  if (!subjectIds.length) return subjects;

  const supabase = getSupabaseClient();
  if (!supabase) return subjects;

  const { data: assignments } = await supabase
    .from("subject_assignments")
    .select("id, subject, faculty, department, year, semester, section, class_code, created_by_admin, dept:departments(id, name, code), fac:faculties(id, name, email)")
    .in("subject", subjectIds)
    .eq("created_by_admin", adminId);

  const assignmentMap = new Map();
  (assignments || []).forEach((assignment) => {
    const key = String(assignment.subject);
    const list = assignmentMap.get(key) || [];
    list.push({
      id: assignment.id,
      _id: assignment.id,
      subject: assignment.subject,
      faculty: assignment.fac ? { id: assignment.fac.id, _id: assignment.fac.id, name: assignment.fac.name, email: assignment.fac.email } : assignment.faculty,
      department: assignment.dept ? { id: assignment.dept.id, _id: assignment.dept.id, name: assignment.dept.name, code: assignment.dept.code } : assignment.department,
      year: assignment.year,
      semester: assignment.semester,
      section: assignment.section,
      classCode: assignment.class_code,
      createdByAdmin: assignment.created_by_admin,
    });
    assignmentMap.set(key, list);
  });

  return subjects.map((subject) => {
    const sid = String(subject.id || subject._id);
    const subAssignments = (assignmentMap.get(sid) || []).sort((a, b) =>
      String(a.classCode || "").localeCompare(String(b.classCode || ""))
    );
    return {
      ...subject,
      _id: subject.id,
      assignments: subAssignments,
      assignmentCount: subAssignments.length,
    };
  });
};

// ======================================================
// CREATE SUBJECT (ADMIN ONLY)
// ======================================================
router.post("/", adminAuth, async (req, res) => {
  try {
    const { name, code, year, semester, departmentIds = [] } = req.body || {};
    const adminId = req.userId;

    if (!name || !code || !year || !semester) {
      return res.status(400).json({
        ok: false,
        error: "Name, code, year, and semester are required",
      });
    }

    const deps = Array.isArray(departmentIds)
      ? departmentIds.filter(Boolean)
      : [];

    const supabase = getSupabaseClient();
    if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

    if (deps.length > 0) {
      const { data: found } = await supabase
        .from("departments")
        .select("id")
        .in("id", deps)
        .eq("created_by_admin", adminId);

      const foundIds = (found || []).map((d) => String(d.id));
      const invalid = deps.filter((d) => !foundIds.includes(String(d)));
      if (invalid.length > 0) {
        return res.status(400).json({
          ok: false,
          error: "One or more departments not found",
        });
      }
    }

    const { data: subject, error } = await supabase
      .from("subjects")
      .insert({
        name: String(name).trim(),
        code: String(code).trim().toUpperCase(),
        year: Number(year),
        semester: Number(semester),
        departments: deps,
        created_by_admin: adminId,
      })
      .select("*")
      .single();

    if (error || !subject) {
      if (error?.code === "23505") {
        return res.status(409).json({ ok: false, error: "Subject already exists for this admin" });
      }
      throw error || new Error("Failed to create subject");
    }

    // Populate departments
    let populatedDepts = [];
    if (deps.length > 0) {
      const { data: deptData } = await supabase
        .from("departments")
        .select("id, name, code")
        .in("id", deps);
      populatedDepts = (deptData || []).map((d) => ({ ...d, _id: d.id }));
    }

    const formattedSubject = {
      ...subject,
      _id: subject.id,
      departments: populatedDepts,
      allottedFaculties: [],
    };

    const [subjectWithAssignments] = await attachAssignments([formattedSubject], adminId);
    return res.json({ ok: true, subject: subjectWithAssignments });
  } catch (err) {
    console.error("Subject create error:", err);
    return res.status(500).json({ ok: false, error: "Failed to create subject" });
  }
});

// ======================================================
// GET SUBJECTS (ADMIN/FACULTY)
// ======================================================
router.get("/", authMiddleware, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

    let query = supabase.from("subjects").select("*");

    if (req.userRole === "ADMIN") {
      query = query.eq("created_by_admin", req.userId);
    } else if (req.userRole === "FACULTY") {
      query = query.contains("allotted_faculties", [req.userId]);
    } else {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    const { data: subjects, error } = await query.order("name", { ascending: true });
    if (error) throw error;

    const list = subjects || [];
    const deptIds = [...new Set(list.flatMap((s) => s.departments || []))];
    const facIds = [...new Set(list.flatMap((s) => s.allotted_faculties || []))];

    const [deptRes, facRes] = await Promise.all([
      deptIds.length > 0 ? supabase.from("departments").select("id, name, code").in("id", deptIds) : { data: [] },
      facIds.length > 0 ? supabase.from("faculties").select("id, name, email").in("id", facIds) : { data: [] },
    ]);

    const deptMap = new Map((deptRes.data || []).map((d) => [String(d.id), { ...d, _id: d.id }]));
    const facMap = new Map((facRes.data || []).map((f) => [String(f.id), { ...f, _id: f.id }]));

    const populated = list.map((s) => ({
      ...s,
      _id: s.id,
      departments: (s.departments || []).map((id) => deptMap.get(String(id))).filter(Boolean),
      allottedFaculties: (s.allotted_faculties || []).map((id) => facMap.get(String(id))).filter(Boolean),
    }));

    const adminId = req.userRole === "ADMIN" ? req.userId : (req.user.created_by_admin || req.user.createdByAdmin);
    const result = await attachAssignments(populated, adminId);

    return res.json({ ok: true, subjects: result });
  } catch (err) {
    console.error("Subject fetch error:", err);
    return res.status(500).json({ ok: false, error: "Failed to fetch subjects" });
  }
});

// ======================================================
// DELETE SUBJECT (ADMIN ONLY)
// ======================================================
router.delete("/:id", adminAuth, async (req, res) => {
  try {
    const subjectId = req.params.id;
    const adminId = req.userId;
    const supabase = getSupabaseClient();
    if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

    // Fetch faculties with this subject allotted
    const { data: faculties } = await supabase
      .from("faculties")
      .select("id, allotted_subjects")
      .contains("allotted_subjects", [subjectId])
      .eq("created_by_admin", adminId);

    if (faculties && faculties.length > 0) {
      for (const fac of faculties) {
        const nextSubjs = (fac.allotted_subjects || []).filter((s) => String(s) !== String(subjectId));
        await supabase
          .from("faculties")
          .update({ allotted_subjects: nextSubjs })
          .eq("id", fac.id);
      }
    }

    await supabase.from("subject_assignments").delete().eq("subject", subjectId).eq("created_by_admin", adminId);
    const { error: deleteError } = await supabase.from("subjects").delete().eq("id", subjectId).eq("created_by_admin", adminId);
    if (deleteError) throw deleteError;

    return res.json({ ok: true });
  } catch (err) {
    console.error("Subject delete error:", err);
    return res.status(500).json({ ok: false, error: "Failed to delete subject" });
  }
});

// ======================================================
// ALLOT SUBJECT TO FACULTIES & DEPARTMENTS (ADMIN ONLY)
// ======================================================
router.post("/allot", adminAuth, async (req, res) => {
  try {
    const { subjectId, assignments = [] } = req.body || {};
    const adminId = req.userId;

    if (!subjectId) {
      return res.status(400).json({ ok: false, error: "Subject ID is required" });
    }

    const supabase = getSupabaseClient();
    if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

    const { data: subject } = await supabase
      .from("subjects")
      .select("*")
      .eq("id", subjectId)
      .eq("created_by_admin", adminId)
      .single();

    if (!subject) {
      return res.status(404).json({ ok: false, error: "Subject not found" });
    }

    const safeAssignments = Array.isArray(assignments)
      ? assignments
          .filter(Boolean)
          .map((assignment) => ({
            departmentId: String(assignment.departmentId || "").trim(),
            facultyId: String(assignment.facultyId || "").trim(),
            section: String(assignment.section || "").trim().toUpperCase(),
            classCode: String(assignment.classCode || "").trim().toUpperCase(),
          }))
          .filter(
            (assignment) =>
              assignment.departmentId &&
              assignment.facultyId &&
              assignment.section &&
              assignment.classCode
          )
      : [];

    if (!safeAssignments.length) {
      return res.status(400).json({
        ok: false,
        error: "At least one class assignment is required.",
      });
    }

    const safeDepartmentIds = [...new Set(safeAssignments.map((assignment) => assignment.departmentId))];
    const safeFacultyIds = [...new Set(safeAssignments.map((assignment) => assignment.facultyId))];

    if (safeDepartmentIds.length > 0) {
      const { data: departments } = await supabase
        .from("departments")
        .select("id")
        .in("id", safeDepartmentIds)
        .eq("created_by_admin", adminId);

      if ((departments || []).length !== safeDepartmentIds.length) {
        return res.status(400).json({
          ok: false,
          error: "One or more departments are invalid.",
        });
      }
    }

    if (safeFacultyIds.length > 0) {
      const { data: faculties } = await supabase
        .from("faculties")
        .select("id")
        .in("id", safeFacultyIds)
        .eq("created_by_admin", adminId);

      if ((faculties || []).length !== safeFacultyIds.length) {
        return res.status(400).json({
          ok: false,
          error: "One or more faculties are invalid.",
        });
      }
    }

    // Delete old assignments
    await supabase
      .from("subject_assignments")
      .delete()
      .eq("subject", subjectId)
      .eq("created_by_admin", adminId);

    // Insert new assignments
    const newAssignmentsRows = safeAssignments.map((assignment) => ({
      subject: subjectId,
      faculty: assignment.facultyId,
      department: assignment.departmentId,
      year: subject.year,
      semester: subject.semester,
      section: assignment.section,
      class_code: assignment.classCode,
      created_by_admin: adminId,
    }));

    const { error: insertAssignmentError } = await supabase
      .from("subject_assignments")
      .insert(newAssignmentsRows);

    if (insertAssignmentError) throw insertAssignmentError;

    // Update faculties' allotted_subjects
    const { data: allAdminFaculties } = await supabase
      .from("faculties")
      .select("id, allotted_subjects")
      .eq("created_by_admin", adminId);

    for (const fac of allAdminFaculties || []) {
      const isSelected = safeFacultyIds.includes(String(fac.id));
      const currentList = fac.allotted_subjects || [];
      const hasSubject = currentList.some((s) => String(s) === String(subjectId));

      if (isSelected && !hasSubject) {
        await supabase
          .from("faculties")
          .update({ allotted_subjects: [...currentList, subjectId] })
          .eq("id", fac.id);
      } else if (!isSelected && hasSubject) {
        await supabase
          .from("faculties")
          .update({
            allotted_subjects: currentList.filter((s) => String(s) !== String(subjectId)),
          })
          .eq("id", fac.id);
      }
    }

    // Update subject's departments and allotted_faculties
    const { data: updatedSubject, error: updateSubjError } = await supabase
      .from("subjects")
      .update({
        departments: safeDepartmentIds,
        allotted_faculties: safeFacultyIds,
        updated_at: new Date().toISOString(),
      })
      .eq("id", subjectId)
      .eq("created_by_admin", adminId)
      .select("*")
      .single();

    if (updateSubjError) throw updateSubjError;

    // Populate departments and faculties
    const [deptRes, facRes] = await Promise.all([
      safeDepartmentIds.length > 0 ? supabase.from("departments").select("id, name, code").in("id", safeDepartmentIds) : { data: [] },
      safeFacultyIds.length > 0 ? supabase.from("faculties").select("id, name, email").in("id", safeFacultyIds) : { data: [] },
    ]);

    const populated = {
      ...updatedSubject,
      _id: updatedSubject.id,
      departments: (deptRes.data || []).map((d) => ({ ...d, _id: d.id })),
      allottedFaculties: (facRes.data || []).map((f) => ({ ...f, _id: f.id })),
    };

    const [subjectWithAssignments] = await attachAssignments([populated], adminId);
    return res.json({ ok: true, subject: subjectWithAssignments });
  } catch (err) {
    console.error("Allot subject error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

module.exports = router;
