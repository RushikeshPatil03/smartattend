const express = require("express");
const router = express.Router();

const { getSupabaseClient } = require("../config/supabase");
const adminAuth = require("../middleware/adminAuth");
const authMiddleware = require("../middleware/authMiddleware");

// CREATE department (Admin Only)
router.post("/", adminAuth, async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const code = String(req.body?.code || "").trim().toUpperCase();
    if (!name || !code) {
      return res.status(400).json({ ok: false, error: "Name and code are required" });
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
        error: "Department with this name and code already exists for your college",
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

    if (error || !dept) {
      if (error?.code === "23505") {
        return res.status(409).json({
          ok: false,
          error: "Department with this name and code already exists for your college",
        });
      }
      throw error || new Error("Failed to create department");
    }

    return res.json({ ok: true, department: { ...dept, _id: dept.id } });
  } catch (err) {
    console.error("Department create error:", err);
    return res.status(500).json({ ok: false, error: "Failed to create department" });
  }
});

// GET departments for logged user
router.get("/", authMiddleware, async (req, res) => {
  try {
    let adminId = null;
    if (req.userRole === "ADMIN") {
      adminId = req.userId;
    } else if (req.userRole === "FACULTY" || req.userRole === "STUDENT") {
      adminId = req.user.created_by_admin || req.user.createdByAdmin;
    } else {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    const supabase = getSupabaseClient();
    if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

    const { data: departments, error } = await supabase
      .from("departments")
      .select("*")
      .eq("created_by_admin", String(adminId))
      .order("name", { ascending: true });

    if (error) throw error;

    const formatted = (departments || []).map((d) => ({
      ...d,
      _id: d.id,
      createdByAdmin: d.created_by_admin,
    }));

    return res.json({ ok: true, departments: formatted });
  } catch (err) {
    console.error("Department fetch error:", err);
    return res.status(500).json({ ok: false, error: "Failed to fetch departments" });
  }
});

// DELETE department (Admin Only)
router.delete("/:id", adminAuth, async (req, res) => {
  try {
    const departmentId = req.params.id;
    const adminId = req.userId;
    const supabase = getSupabaseClient();
    if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

    const [studentsRes, facultiesRes, subjectsRes] = await Promise.all([
      supabase.from("students").select("id", { count: "exact", head: true }).eq("department", departmentId).eq("created_by_admin", adminId),
      supabase.from("faculties").select("id", { count: "exact", head: true }).eq("department", departmentId).eq("created_by_admin", adminId),
      supabase.from("subjects").select("id", { count: "exact", head: true }).contains("departments", [departmentId]).eq("created_by_admin", adminId),
    ]);

    const inUse = (studentsRes.count || 0) > 0 || (facultiesRes.count || 0) > 0 || (subjectsRes.count || 0) > 0;
    if (inUse) {
      return res.status(400).json({
        ok: false,
        error: "Department is in use by students, faculties, or subjects.",
      });
    }

    const { error: deleteError } = await supabase
      .from("departments")
      .delete()
      .eq("id", departmentId)
      .eq("created_by_admin", adminId);

    if (deleteError) throw deleteError;

    return res.json({ ok: true });
  } catch (err) {
    console.error("Department delete error:", err);
    return res.status(500).json({ ok: false, error: "Failed to delete department" });
  }
});

module.exports = router;
