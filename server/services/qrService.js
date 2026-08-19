const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const env = require("../config/env");
const { getSupabaseClient } = require("../config/supabase");

const QR_SECRET = env.QR_SECRET;
const QR_TTL = env.QR_TTL_SECONDS; // dynamic QR lifetime in seconds
const QR_AUDIENCE = "a";
const QR_ISSUER = "sa";
const QR_RECENT_HISTORY = Math.max(3, env.QR_RECENT_HISTORY);
const QR_MAX_SEQUENCE_DRIFT = Math.max(0, env.QR_MAX_SEQUENCE_DRIFT);
const QR_MIN_ROTATION_SECONDS = Math.max(3, env.QR_MIN_ROTATION_SECONDS || 3);
const QR_MIN_ROTATION_MS = QR_MIN_ROTATION_SECONDS * 1000;
const QR_STATE_TTL_SECONDS = Math.max(
  QR_VERIFY_MAX_STATE_SECONDS(),
  Number(process.env.QR_STATE_TTL_SECONDS || 300)
);

function QR_VERIFY_MAX_STATE_SECONDS() {
  return (
    Math.max(env.QR_VERIFY_MAX_AGE_SECONDS, env.QR_MAX_TWO_STEP_GAP_SECONDS, QR_TTL) +
    120
  );
}

// In-memory cache for fast sub-millisecond dynamic QR rotation
const qrMemoryStore = new Map();

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

async function getQRState(sessionId) {
  const sid = String(sessionId);
  const cached = qrMemoryStore.get(sid);
  if (cached) return cached;

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data } = await supabase
        .from("qr_states")
        .select("state, expires_at")
        .eq("session_id", sid)
        .single();

      if (data && new Date(data.expires_at).getTime() > Date.now()) {
        const parsed = typeof data.state === "string" ? JSON.parse(data.state) : data.state;
        const state = {
          recentTokenHashes: Array.isArray(parsed?.recentTokenHashes) ? parsed.recentTokenHashes : [],
          lastIssuedAt: parsed?.lastIssuedAt || null,
          lastToken: parsed?.lastToken || null,
        };
        qrMemoryStore.set(sid, state);
        return state;
      }
    } catch {
      // Fall back to default
    }
  }

  return { recentTokenHashes: [], lastIssuedAt: null, lastToken: null };
}

async function setQRState(sessionId, state) {
  const sid = String(sessionId);
  qrMemoryStore.set(sid, state);

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const expiresAt = new Date(Date.now() + QR_STATE_TTL_SECONDS * 1000).toISOString();
      await supabase.from("qr_states").upsert({
        session_id: sid,
        state,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      });
    } catch {
      // Memory store is already updated
    }
  }
}

async function generateQRToken({ sessionId, facultyId, subjectId, location }) {
  if (!sessionId) {
    throw new Error("QR token requires sessionId");
  }

  const now = Date.now();
  const state = await getQRState(sessionId);

  // Keep a token visible for a minimum window to avoid "video-like" rapid changes.
  if (
    state.lastToken &&
    state.lastIssuedAt &&
    now - Number(state.lastIssuedAt) < QR_MIN_ROTATION_MS
  ) {
    return state.lastToken;
  }

  const payload = {
    sessionId: String(sessionId),
    type: "DYNAMIC_QR",
    iat: Math.floor(now / 1000),
  };

  if (facultyId) {
    payload.facultyId = String(facultyId);
  }
  if (subjectId) {
    payload.subjectId = String(subjectId);
  }
  if (
    location &&
    Number.isFinite(Number(location.lat)) &&
    Number.isFinite(Number(location.lng))
  ) {
    payload.location = {
      lat: Number(Number(location.lat).toFixed(6)),
      lng: Number(Number(location.lng).toFixed(6)),
      radiusMeters: Number(
        Number.isFinite(Number(location.radiusMeters))
          ? Number(location.radiusMeters)
          : 0
      ),
    };
  }

  const token = jwt.sign(payload, QR_SECRET, {
    expiresIn: QR_TTL,
    audience: QR_AUDIENCE,
    issuer: QR_ISSUER,
  });

  const tokenHash = hashToken(token);

  const lastHash = state.recentTokenHashes[state.recentTokenHashes.length - 1];
  if (lastHash !== tokenHash) {
    state.recentTokenHashes.push(tokenHash);
    if (state.recentTokenHashes.length > QR_RECENT_HISTORY) {
      state.recentTokenHashes.shift();
    }
  }
  state.lastIssuedAt = now;
  state.lastToken = token;

  await setQRState(sessionId, state);

  return token;
}

async function generateQRTokenWithTiming(input) {
  const token = await generateQRToken(input);
  const state = await getQRState(input.sessionId);
  const issuedAt = Number(state.lastIssuedAt || Date.now());
  const elapsedMs = Math.max(0, Date.now() - issuedAt);
  const nextRefreshInMs = Math.max(250, QR_MIN_ROTATION_MS - elapsedMs + 120);

  return {
    token,
    rotationSeconds: QR_MIN_ROTATION_SECONDS,
    nextRefreshInMs,
    issuedAt,
  };
}

function verifyQRToken(token, options = {}) {
  const allowExpired = Boolean(options.allowExpired);
  const maxAgeSeconds = Number(options.maxAgeSeconds || 0);

  try {
    const decoded = jwt.verify(token, QR_SECRET, {
      ignoreExpiration: allowExpired,
      audience: QR_AUDIENCE,
      issuer: QR_ISSUER,
    });

    if (!decoded || decoded.type !== "DYNAMIC_QR" || !decoded.sessionId) {
      return { ok: false, error: "Invalid or expired QR token" };
    }

    if (allowExpired && maxAgeSeconds > 0) {
      const iatSec = Number(decoded.iat || 0);
      if (!iatSec) {
        return { ok: false, error: "Invalid or expired QR token" };
      }
      const ageSec = Math.floor(Date.now() / 1000) - iatSec;
      if (ageSec > maxAgeSeconds) {
        return { ok: false, error: "Invalid or expired QR token" };
      }
    }

    return { ok: true, decoded };
  } catch {
    return { ok: false, error: "Invalid or expired QR token" };
  }
}

async function validateTwoStepQR({ sessionId, firstToken, secondToken }) {
  if (!sessionId || !firstToken || !secondToken) {
    return { ok: false, error: "Two QR tokens required" };
  }

  const state = await getQRState(sessionId);
  if (
    !state ||
    !Array.isArray(state.recentTokenHashes) ||
    state.recentTokenHashes.length < 2
  ) {
    return { ok: false, error: "QR session not initialized" };
  }

  const firstHash = hashToken(firstToken);
  const secondHash = hashToken(secondToken);
  if (firstHash === secondHash) {
    return { ok: false, error: "Two different dynamic QR scans are required" };
  }

  const firstIndex = state.recentTokenHashes.lastIndexOf(firstHash);
  const secondIndex = state.recentTokenHashes.lastIndexOf(secondHash);

  if (firstIndex < 0 || secondIndex < 0 || secondIndex !== firstIndex + 1) {
    return { ok: false, error: "QR sequence invalid or expired" };
  }

  const newestIndex = state.recentTokenHashes.length - 1;
  if (newestIndex - secondIndex > QR_MAX_SEQUENCE_DRIFT) {
    return { ok: false, error: "QR sequence invalid or expired" };
  }

  return { ok: true };
}

async function clearSessionQR(sessionId) {
  if (sessionId) {
    const sid = String(sessionId);
    qrMemoryStore.delete(sid);
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        await supabase.from("qr_states").delete().eq("session_id", sid);
      } catch {
        // Ignore deletion error
      }
    }
  }
}

module.exports = {
  generateQRToken,
  generateQRTokenWithTiming,
  verifyQRToken,
  validateTwoStepQR,
  clearSessionQR,
};
