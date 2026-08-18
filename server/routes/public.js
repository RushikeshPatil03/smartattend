const express = require("express");
const router = express.Router();

const { getSupabaseClient } = require("../config/supabase");
const {
  getMobileLocationCapture,
  setMobileLocationCapture,
  purgeExpiredMobileCaptures,
} = require("../services/mobileLocationCapture");

function getTokenAvailability(record) {
  if (!record) {
    return { ok: false, error: "Invalid registration token" };
  }

  if (!record.is_active && !record.isActive) {
    return { ok: false, error: "Registration link is inactive" };
  }

  const expiresAt = record.expires_at || record.expiresAt;
  if (expiresAt && new Date(expiresAt) < new Date()) {
    return { ok: false, error: "Registration token expired" };
  }

  const maxUses = Number(record.max_uses || record.maxUses || 1);
  const usesCount = Number(record.uses_count || record.usesCount || 0);
  if (usesCount >= maxUses) {
    return { ok: false, error: "Registration limit reached" };
  }

  return {
    ok: true,
    remainingRegistrations: Math.max(maxUses - usesCount, 0),
  };
}

// ----------------------------------------------------
// PUBLIC: FETCH DEPARTMENTS FOR REGISTRATION
// GET /api/public/departments?token=
// ----------------------------------------------------
router.get("/departments", async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res
        .status(400)
        .json({ ok: false, error: "Registration token required" });
    }

    const supabase = getSupabaseClient();
    if (!supabase) return res.status(503).json({ ok: false, error: "Database unavailable" });

    const { data: record } = await supabase
      .from("registration_tokens")
      .select("*")
      .eq("token", String(token))
      .single();

    const availability = getTokenAvailability(record);
    if (!availability.ok) {
      return res.status(400).json({ ok: false, error: availability.error });
    }

    const { data: rawDepartments } = await supabase
      .from("departments")
      .select("id, name, code, created_by_admin")
      .eq("created_by_admin", String(record.admin_id))
      .order("name", { ascending: true });

    const departments = (rawDepartments || []).map((d) => ({
      ...d,
      _id: d.id,
      createdByAdmin: d.created_by_admin,
    }));

    return res.json({
      ok: true,
      departments,
      registration: {
        type: record.type,
        collegeName: record.college_name || "",
        expiresAt: record.expires_at,
        maxRegistrations: Number(record.max_uses || 1),
        usedRegistrations: Number(record.uses_count || 0),
        remainingRegistrations: availability.remainingRegistrations,
      },
    });
  } catch (err) {
    console.error("Public departments error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

router.get("/mobile-location/:token", async (req, res) => {
  try {
    await purgeExpiredMobileCaptures();
    const token = String(req.params.token || "");
    const record = await getMobileLocationCapture(token);
    if (!record) {
      return res.status(404).json({ ok: false, error: "Location capture request expired" });
    }

    return res.json({
      ok: true,
      status: record.status,
      expiresAt: record.expiresAt,
      capturedAt: record.capturedAt || null,
      coords: record.coords || null,
      accuracy: record.accuracy ?? null,
    });
  } catch (err) {
    console.error("Public mobile location get error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

router.post("/mobile-location/:token", async (req, res) => {
  try {
    await purgeExpiredMobileCaptures();
    const token = String(req.params.token || "");
    const record = await getMobileLocationCapture(token);
    if (!record) {
      return res.status(404).json({ ok: false, error: "Location capture request expired" });
    }

    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);
    const accuracy = Number(req.body?.accuracy || 0);
    const deviceLabel = String(req.body?.deviceLabel || "").trim();

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ ok: false, error: "Valid latitude and longitude required" });
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ ok: false, error: "Invalid coordinate range" });
    }

    record.status = "captured";
    record.coords = { lat, lng };
    record.accuracy = Number.isFinite(accuracy) && accuracy > 0 ? accuracy : null;
    record.deviceLabel = deviceLabel || null;
    record.capturedAt = Date.now();
    await setMobileLocationCapture(token, record);

    return res.json({ ok: true, captured: true });
  } catch (err) {
    console.error("Public mobile location submit error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

module.exports = router;
