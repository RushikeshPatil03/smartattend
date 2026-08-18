const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const env = require("../config/env");
const { getSupabaseClient } = require("../config/supabase");

const refreshMemoryStore = new Map();

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function cleanupMemoryRefreshTokens() {
  const now = Date.now();
  for (const [key, value] of refreshMemoryStore.entries()) {
    if (!value || Number(value.expiresAt || 0) <= now) {
      refreshMemoryStore.delete(key);
    }
  }
}

function buildAccessPayload(user, role) {
  const userId = String(user.id || user._id || "");
  return {
    id: userId,
    _id: userId,
    role,
    email: user.email,
    type: "access",
  };
}

async function storeRefreshToken({ jti, userId, role, token }) {
  const expiresAtMs = Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000;
  const record = {
    userId: String(userId),
    role,
    tokenHash: hashToken(token),
    createdAt: Date.now(),
    expiresAt: expiresAtMs,
  };

  cleanupMemoryRefreshTokens();
  refreshMemoryStore.set(String(jti), record);

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      await supabase.from("refresh_tokens").upsert({
        jti: String(jti),
        user_id: String(userId),
        role,
        token_hash: hashToken(token),
        expires_at: new Date(expiresAtMs).toISOString(),
      });
    } catch {
      // Memory store acts as resilient fallback
    }
  }
}

async function getRefreshRecord(jti) {
  cleanupMemoryRefreshTokens();
  const memRecord = refreshMemoryStore.get(String(jti));
  if (memRecord) return memRecord;

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("refresh_tokens")
        .select("*")
        .eq("jti", String(jti))
        .single();

      if (data && !error) {
        return {
          userId: String(data.user_id),
          role: data.role,
          tokenHash: data.token_hash,
          createdAt: new Date(data.created_at).getTime(),
          expiresAt: new Date(data.expires_at).getTime(),
        };
      }
    } catch {
      return null;
    }
  }

  return null;
}

async function revokeRefreshToken(jti) {
  if (!jti) return;
  refreshMemoryStore.delete(String(jti));

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      await supabase.from("refresh_tokens").delete().eq("jti", String(jti));
    } catch {
      // Ignored
    }
  }
}

async function issueTokenPair(user, role) {
  const accessPayload = buildAccessPayload(user, role);
  const accessToken = jwt.sign(accessPayload, env.JWT_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL,
  });

  const jti = crypto.randomUUID();
  const userId = String(user.id || user._id || "");
  const refreshPayload = {
    id: userId,
    _id: userId,
    role,
    email: user.email,
    type: "refresh",
    jti,
  };
  const refreshToken = jwt.sign(refreshPayload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.REFRESH_TOKEN_TTL,
  });

  await storeRefreshToken({
    jti,
    userId,
    role,
    token: refreshToken,
  });

  return {
    accessToken,
    refreshToken,
    token: accessToken,
    expiresIn: env.ACCESS_TOKEN_TTL,
    refreshExpiresInSeconds: env.REFRESH_TOKEN_TTL_SECONDS,
  };
}

function verifyAccessToken(token) {
  const decoded = jwt.verify(token, env.JWT_SECRET);
  if (!decoded || decoded.type !== "access" || !decoded.id || !decoded.role) {
    throw new Error("Invalid access token");
  }
  return decoded;
}

async function rotateRefreshToken(token) {
  const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET);
  if (!decoded || decoded.type !== "refresh" || !decoded.jti || !decoded.id || !decoded.role) {
    throw new Error("Invalid refresh token");
  }

  const record = await getRefreshRecord(decoded.jti);
  if (
    !record ||
    record.tokenHash !== hashToken(token) ||
    String(record.userId) !== String(decoded.id) ||
    String(record.role) !== String(decoded.role)
  ) {
    throw new Error("Refresh token revoked");
  }

  await revokeRefreshToken(decoded.jti);

  return {
    decoded,
    async issueFor(user) {
      return issueTokenPair(user, decoded.role);
    },
  };
}

module.exports = {
  issueTokenPair,
  verifyAccessToken,
  rotateRefreshToken,
  revokeRefreshToken,
};
