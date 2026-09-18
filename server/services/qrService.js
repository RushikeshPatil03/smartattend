// server/services/qrService.js
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const env = require("../config/env");
const { getSupabaseClient } = require("../config/supabase");

const QR_SECRET = env.QR_SECRET;
const QR_TTL = env.QR_TTL_SECONDS || 10;
const QR_AUDIENCE = "a";
const QR_ISSUER = "sa";
const QR_RECENT_HISTORY = Math.max(3, env.QR_RECENT_HISTORY || 3);
const QR_MAX_SEQUENCE_DRIFT = Math.max(0, env.QR_MAX_SEQUENCE_DRIFT || 1);
const QR_MIN_ROTATION_SECONDS = Math.max(2, env.QR_MIN_ROTATION_SECONDS || 2);
const QR_MIN_ROTATION_MS = QR_MIN_ROTATION_SECONDS * 1000;
const GRACE_PERIOD_BLOCKS = 3; // Allows current block + past 3 blocks (8-second window)

// =========================================================================
// L1 IN-MEMORY CACHES (Sub-millisecond access)
// =========================================================================
const qrMemoryStore = new Map();     // sessionId -> state object
const l1SecretCache = new Map();     // sessionId -> { secretKey, expiresAt }

// Auto-clean stale memory every 10 minutes to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [sid, entry] of l1SecretCache.entries()) {
    if (now > entry.expiresAt) l1SecretCache.delete(sid);
  }
}, 10 * 60 * 1000).unref();

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

// =========================================================================
// TOTP SECRET RESOLUTION (L1 Cache -> totp_secrets Table Fallback)
// =========================================================================
async function getSessionSecret(sessionId) {
  if (!sessionId) return null;
  const sid = String(sessionId);

  // 1. Check L1 Memory Cache
  const cached = l1SecretCache.get(sid);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.secretKey;
  }

  // 2. Database Fallback (handles server restart / cold boot mid-class)
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("totp_secrets")
        .select("secret_key, expires_at")
        .eq("session_id", sid)
        .single();

      if (!error && data?.secret_key) {
        const expiresAtMs = data.expires_at
          ? new Date(data.expires_at).getTime()
          : Date.now() + 4 * 60 * 60 * 1000;

        l1SecretCache.set(sid, {
          secretKey: data.secret_key,
          expiresAt: expiresAtMs,
        });

        return data.secret_key;
      }
    } catch {
      // Fallback failed, continue
    }
  }

  return null;
}

/**
 * Deterministic HMAC-SHA256 8-character token generator matching Faculty UI
 */
function generateTokenForBlock(secretKey, blockIndex) {
  return crypto
    .createHmac("sha256", secretKey)
    .update(`totp-qr:${blockIndex}`)
    .digest("hex")
    .substring(0, 8);
}

/**
 * HIGH-CONCURRENCY SLIDING WINDOW VALIDATION (Zero DB I/O once cached)
 */
async function validateDynamicQrTokenFast(sessionId, candidateToken) {
  if (!sessionId || !candidateToken) {
    return { valid: false, error: "Missing session or QR credentials" };
  }

  const cleanToken = String(candidateToken).trim().toLowerCase();
  const secretKey = await getSessionSecret(sessionId);

  if (!secretKey) {
    return { valid: false, error: "Session QR engine not found or expired. Please refresh the faculty screen." };
  }

  const currentBlock = Math.floor(Date.now() / 1000 / QR_MIN_ROTATION_SECONDS);
  const candidateBuf = Buffer.from(cleanToken);

  // Check current block and past grace blocks
  for (let i = 0; i <= GRACE_PERIOD_BLOCKS; i++) {
    const block = currentBlock - i;
    const expected = generateTokenForBlock(secretKey, block);
    const expectedBuf = Buffer.from(expected);

    if (candidateBuf.length === expectedBuf.length && crypto.timingSafeEqual(candidateBuf, expectedBuf)) {
      return { valid: true, blockIndex: block };
    }
  }

  return { valid: false, error: "QR Code rotated or expired. Please scan the live display." };
}

// =========================================================================
// BACKWARD COMPATIBLE QR STATE ENGINE (For existing two-step flows)
// =========================================================================
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
      // Fallback to empty state
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
      const expiresAt = new Date(Date.now() + 300 * 1000).toISOString();
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
  if (!sessionId) throw new Error("QR token requires sessionId");

  const now = Date.now();
  const state = await getQRState(sessionId);

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

  if (facultyId) payload.facultyId = String(facultyId);
  if (subjectId) payload.subjectId = String(subjectId);
  if (location && Number.isFinite(Number(location.lat)) && Number.isFinite(Number(location.lng))) {
    payload.location = {
      lat: Number(Number(location.lat).toFixed(6)),
      lng: Number(Number(location.lng).toFixed(6)),
      radiusMeters: Number(location.radiusMeters || 0),
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
  try {
    const decoded = jwt.verify(token, QR_SECRET, {
      ignoreExpiration: Boolean(options.allowExpired),
      audience: QR_AUDIENCE,
      issuer: QR_ISSUER,
    });

    if (!decoded || decoded.type !== "DYNAMIC_QR" || !decoded.sessionId) {
      return { ok: false, error: "Invalid or expired QR token" };
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
  if (!state || !Array.isArray(state.recentTokenHashes) || state.recentTokenHashes.length < 2) {
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
  if (!sessionId) return;
  const sid = String(sessionId);
  qrMemoryStore.delete(sid);
  l1SecretCache.delete(sid);

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      await supabase.from("qr_states").delete().eq("session_id", sid);
    } catch {
      // Best-effort cleanup
    }
  }
}

module.exports = {
  generateQRToken,
  generateQRTokenWithTiming,
  verifyQRToken,
  validateTwoStepQR,
  validateDynamicQrTokenFast,
  getSessionSecret,
  clearSessionQR,
};
