const crypto = require("crypto");
const env = require("../config/env");
const { getSupabaseClient } = require("../config/supabase");

const MOBILE_LOCATION_CAPTURE_TTL_MS = env.MOBILE_LOCATION_CAPTURE_TTL_MS;
const captureMemoryStore = new Map();

function cleanupExpiredCaptures() {
  const now = Date.now();
  for (const [key, value] of captureMemoryStore.entries()) {
    if (!value || Number(value.expiresAt || 0) <= now) {
      captureMemoryStore.delete(key);
    }
  }
}

async function createMobileLocationCapture(facultyId) {
  cleanupExpiredCaptures();
  const captureToken = crypto.randomBytes(24).toString("hex");
  const expiresAt = Date.now() + MOBILE_LOCATION_CAPTURE_TTL_MS;

  const record = {
    facultyId: String(facultyId),
    createdAt: Date.now(),
    expiresAt,
    status: "pending",
    coords: null,
    accuracy: null,
    deviceLabel: null,
  };

  captureMemoryStore.set(captureToken, record);

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      await supabase.from("mobile_location_captures").insert({
        token: captureToken,
        faculty_id: String(facultyId),
        status: "pending",
        expires_at: new Date(expiresAt).toISOString(),
      });
    } catch {
      // Memory store is active
    }
  }

  return {
    captureToken,
    expiresInMs: MOBILE_LOCATION_CAPTURE_TTL_MS,
  };
}

async function getMobileLocationCapture(token) {
  cleanupExpiredCaptures();
  const mem = captureMemoryStore.get(String(token));
  if (mem) return mem;

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data } = await supabase
        .from("mobile_location_captures")
        .select("*")
        .eq("token", String(token))
        .single();

      if (data && new Date(data.expires_at).getTime() > Date.now()) {
        const record = {
          facultyId: String(data.faculty_id),
          createdAt: new Date(data.created_at).getTime(),
          expiresAt: new Date(data.expires_at).getTime(),
          status: data.status,
          coords: data.coords,
          accuracy: data.accuracy,
          deviceLabel: data.device_label,
          capturedAt: data.captured_at ? new Date(data.captured_at).getTime() : null,
        };
        captureMemoryStore.set(String(token), record);
        return record;
      }
    } catch {
      return null;
    }
  }

  return null;
}

async function setMobileLocationCapture(token, next) {
  captureMemoryStore.set(String(token), next);

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      await supabase
        .from("mobile_location_captures")
        .update({
          status: next.status,
          coords: next.coords,
          accuracy: next.accuracy,
          device_label: next.deviceLabel,
          captured_at: next.capturedAt ? new Date(next.capturedAt).toISOString() : new Date().toISOString(),
        })
        .eq("token", String(token));
    } catch {
      // Memory store already set
    }
  }
}

async function purgeExpiredMobileCaptures() {
  cleanupExpiredCaptures();
}

module.exports = {
  createMobileLocationCapture,
  getMobileLocationCapture,
  setMobileLocationCapture,
  purgeExpiredMobileCaptures,
};
