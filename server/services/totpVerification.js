/**
 * TOTP QR Verification Service
 * Validates consecutive rotating QR tokens from students
 * Uses high-speed memory cache with Supabase PostgreSQL persistence
 */

const crypto = require("crypto");
const { getSupabaseClient } = require("../config/supabase");

const TOTP_BLOCK_DURATION_MS = 2000;
const TOTP_SKEW_TOLERANCE_BLOCKS = Number(process.env.TOTP_SKEW_TOLERANCE_BLOCKS || 15); // 15 * 2s = 30s window for smooth scanning

const totpSecretMemoryStore = new Map();
const presenceMemoryStore = new Map(); // sessionId -> Set of studentIds

/**
 * Generate TOTP token (matching client-side logic)
 */
function generateTotpToken(secretKey, index) {
  const input = `${secretKey}:${index}`;
  let hash = 2166136261;

  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return String((hash >>> 0) % 1000000).padStart(6, "0");
}

/**
 * Calculate block index from timestamp
 */
function getBlockIndex(timestamp) {
  return Math.floor(timestamp / TOTP_BLOCK_DURATION_MS);
}

/**
 * Store session secret key
 */
async function storeSessionSecret(sessionId, secretKey, ttlSeconds = 3600) {
  if (!sessionId || !secretKey) {
    throw new Error("sessionId and secretKey are required");
  }

  const sid = String(sessionId);
  totpSecretMemoryStore.set(sid, {
    secretKey,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
      await supabase.from("totp_secrets").upsert({
        session_id: sid,
        secret_key: secretKey,
        expires_at: expiresAt,
      });
    } catch {
      // Memory store already set
    }
  }
}

async function getSessionSecret(sessionId) {
  if (!sessionId) return null;
  const sid = String(sessionId);

  const mem = totpSecretMemoryStore.get(sid);
  if (mem && mem.expiresAt > Date.now()) {
    return mem.secretKey;
  }

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data } = await supabase
        .from("totp_secrets")
        .select("secret_key, expires_at")
        .eq("session_id", sid)
        .single();

      if (data?.secret_key && new Date(data.expires_at).getTime() > Date.now()) {
        totpSecretMemoryStore.set(sid, {
          secretKey: data.secret_key,
          expiresAt: new Date(data.expires_at).getTime(),
        });
        return data.secret_key;
      }
    } catch {
      // Proceed to session lookup fallback
    }

    // Fallback: Check if session exists in DB and derive persistent secret
    try {
      const { data: session } = await supabase
        .from("sessions")
        .select("id, faculty, start_time, is_active")
        .eq("id", sid)
        .single();

      if (session) {
        const masterSalt = process.env.JWT_SECRET || "smartattend-totp-master-secret";
        const derivedSecret = crypto
          .createHmac("sha256", masterSalt)
          .update(`${session.id}:${session.faculty}:${session.start_time}`)
          .digest("base64url");

        totpSecretMemoryStore.set(sid, {
          secretKey: derivedSecret,
          expiresAt: Date.now() + 86400000,
        });

        // Best-effort upsert to totp_secrets table
        try {
          await supabase.from("totp_secrets").upsert({
            session_id: sid,
            secret_key: derivedSecret,
            expires_at: new Date(Date.now() + 86400000).toISOString(),
          });
        } catch {}

        return derivedSecret;
      }
    } catch {
      return null;
    }
  }

  return null;
}

async function getOrCreateSessionSecret(sessionId, ttlSeconds = 86400) {
  if (!sessionId) {
    throw new Error("sessionId is required");
  }

  const sid = String(sessionId);
  const existing = await getSessionSecret(sid);
  if (existing) return existing;

  const secretKey = crypto.randomBytes(24).toString("base64url");
  await storeSessionSecret(sid, secretKey, ttlSeconds);
  return secretKey;
}

/**
 * Verify two consecutive TOTP tokens
 */
async function verifyConsecutiveTotpTokens(sessionId, token1, token2, nowMs = Date.now()) {
  if (!sessionId || !token1 || !token2) {
    return { ok: false, error: "Missing sessionId or tokens" };
  }

  const secretKey = await getSessionSecret(sessionId);
  if (!secretKey) {
    return {
      ok: false,
      error: "Session not configured for TOTP verification. Faculty must initiate TOTP mode.",
    };
  }

  const currentBlockIndex = getBlockIndex(nowMs);

  for (
    let offset = TOTP_SKEW_TOLERANCE_BLOCKS * -1;
    offset <= TOTP_SKEW_TOLERANCE_BLOCKS;
    offset++
  ) {
    const block1Index = currentBlockIndex + offset;
    const block2Index = block1Index + 1;

    const expectedToken1 = generateTotpToken(secretKey, block1Index);
    const expectedToken2 = generateTotpToken(secretKey, block2Index);

    if (token1 === expectedToken1 && token2 === expectedToken2) {
      return {
        ok: true,
        blockIndex: block1Index,
        validatedAt: nowMs,
      };
    }
  }

  return {
    ok: false,
    error: "Token verification failed. Tokens do not match expected sequence.",
  };
}

async function verifyTotpSequence(sessionId, sequence, nowMs = Date.now()) {
  if (!sessionId || !Array.isArray(sequence) || sequence.length !== 2) {
    return { ok: false, error: "Exactly two QR blocks are required" };
  }

  const [block1, block2] = sequence;
  const firstIndex = Number(block1?.index);
  const secondIndex = Number(block2?.index);
  const firstCode = String(block1?.code || "").trim();
  const secondCode = String(block2?.code || "").trim();
  const firstClassId = String(block1?.classId || "").trim();
  const secondClassId = String(block2?.classId || "").trim();

  if (
    !Number.isSafeInteger(firstIndex) ||
    !Number.isSafeInteger(secondIndex) ||
    !/^\d{6}$/.test(firstCode) ||
    !/^\d{6}$/.test(secondCode)
  ) {
    return { ok: false, error: "Invalid QR block payload" };
  }

  if (firstClassId !== String(sessionId) || secondClassId !== String(sessionId)) {
    return { ok: false, error: "QR blocks are for a different session" };
  }

  if (secondIndex !== firstIndex + 1) {
    return { ok: false, error: "QR blocks must be consecutive and chronological" };
  }

  const currentBlockIndex = getBlockIndex(nowMs);
  const newestAllowedIndex = currentBlockIndex + TOTP_SKEW_TOLERANCE_BLOCKS;
  const oldestAllowedIndex = currentBlockIndex - TOTP_SKEW_TOLERANCE_BLOCKS - 1;
  if (firstIndex < oldestAllowedIndex || secondIndex > newestAllowedIndex) {
    return { ok: false, error: "QR sequence expired or outside clock tolerance" };
  }

  const secretKey = await getSessionSecret(sessionId);
  if (!secretKey) {
    return {
      ok: false,
      error: "Session not configured for TOTP verification. Faculty must initiate TOTP mode.",
    };
  }

  const expectedFirst = generateTotpToken(secretKey, firstIndex);
  const expectedSecond = generateTotpToken(secretKey, secondIndex);
  if (firstCode !== expectedFirst || secondCode !== expectedSecond) {
    return { ok: false, error: "Token verification failed. Tokens do not match expected sequence." };
  }

  return {
    ok: true,
    blockIndex: firstIndex,
    secondBlockIndex: secondIndex,
    validatedAt: nowMs,
  };
}

/**
 * Record instant presence in fast memory cache
 */
async function recordInstantPresence(sessionId, studentId) {
  if (!sessionId || !studentId) return;
  const sid = String(sessionId);
  const stuId = String(studentId);

  const existing = presenceMemoryStore.get(sid) || new Set();
  existing.add(stuId);
  presenceMemoryStore.set(sid, existing);
}

async function isStudentPresent(sessionId, studentId) {
  if (!sessionId || !studentId) return false;
  const set = presenceMemoryStore.get(String(sessionId));
  return set ? set.has(String(studentId)) : false;
}

async function clearSessionSecret(sessionId) {
  if (!sessionId) return;
  const sid = String(sessionId);
  totpSecretMemoryStore.delete(sid);
  presenceMemoryStore.delete(sid);

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      await supabase.from("totp_secrets").delete().eq("session_id", sid);
    } catch {
      // ignore
    }
  }
}

async function getPresentStudents(sessionId) {
  if (!sessionId) return [];
  const set = presenceMemoryStore.get(String(sessionId));
  return set ? Array.from(set) : [];
}

module.exports = {
  generateTotpToken,
  getBlockIndex,
  storeSessionSecret,
  getOrCreateSessionSecret,
  getSessionSecret,
  clearSessionSecret,
  verifyConsecutiveTotpTokens,
  verifyTotpSequence,
  recordInstantPresence,
  isStudentPresent,
  getPresentStudents,
  TOTP_BLOCK_DURATION_MS,
  TOTP_SKEW_TOLERANCE_BLOCKS,
};
