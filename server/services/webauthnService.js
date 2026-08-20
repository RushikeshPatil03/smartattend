const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");
const crypto = require("crypto");
const env = require("../config/env");

const RP_NAME = "Smart Attendance System";
const CHALLENGE_TTL_MS = 60 * 1000; // 60-second TTL

// In-memory challenge store with automatic expiration
const challengeStore = new Map();

function cleanupExpiredChallenges() {
  const now = Date.now();
  for (const [key, item] of challengeStore.entries()) {
    if (item.expiresAt <= now) {
      challengeStore.delete(key);
    }
  }
}

// Periodically purge expired challenges every 2 minutes
setInterval(cleanupExpiredChallenges, 2 * 60 * 1000).unref();

/**
 * Resolve Relying Party ID (RP ID) from request or environment
 */
function getRPID(req) {
  const origin = req?.headers?.origin || req?.headers?.referer || "";
  const hostHeader = req?.headers?.host || "";

  // 1. If local development, always return "localhost" for WebAuthn standard
  if (
    origin.includes("localhost") ||
    origin.includes("127.0.0.1") ||
    hostHeader.includes("localhost") ||
    hostHeader.includes("127.0.0.1")
  ) {
    return "localhost";
  }

  // 2. If explicit RP ID configured in environment
  if (process.env.WEBAUTHN_RP_ID) {
    return process.env.WEBAUTHN_RP_ID.trim();
  }

  // 3. Resolve from origin / referer domain (supports apex domain smartattend.app)
  if (origin) {
    try {
      const url = new URL(origin);
      const hostname = url.hostname;
      if (hostname.endsWith("smartattend.app")) {
        return "smartattend.app";
      }
      return hostname;
    } catch {
      // Fallback below
    }
  }

  if (hostHeader) {
    const hostNoPort = hostHeader.split(":")[0];
    if (hostNoPort.endsWith("smartattend.app")) {
      return "smartattend.app";
    }
    return hostNoPort;
  }

  if (env.FRONTEND_URL) {
    try {
      const url = new URL(env.FRONTEND_URL);
      return url.hostname;
    } catch {
      // Fallback
    }
  }

  return "smartattend.app";
}

/**
 * Resolve Expected Origin from request or environment
 */
function getExpectedOrigin(req) {
  const origin = req?.headers?.origin || "";
  if (origin) {
    try {
      const url = new URL(origin);
      return url.origin;
    } catch {
      // Fallback below
    }
  }

  const referer = req?.headers?.referer || "";
  if (referer) {
    try {
      const url = new URL(referer);
      return url.origin;
    } catch {
      // Fallback below
    }
  }

  return env.FRONTEND_URL || "https://smartattend.app";
}

/**
 * Store a challenge with strict 60-second TTL
 */
function storeChallenge(key, challenge, extra = {}) {
  cleanupExpiredChallenges();
  const expiresAt = Date.now() + CHALLENGE_TTL_MS;
  challengeStore.set(String(key), {
    challenge,
    expiresAt,
    ...extra,
  });
}

/**
 * Single-use challenge retrieval (consumed immediately upon retrieval)
 */
function consumeChallenge(key) {
  cleanupExpiredChallenges();
  const item = challengeStore.get(String(key));
  if (!item) return null;

  challengeStore.delete(String(key));
  if (item.expiresAt < Date.now()) {
    return null;
  }

  return item;
}

/**
 * Peak at a challenge without consuming (for multi-step verification where needed)
 */
function getChallenge(key) {
  cleanupExpiredChallenges();
  const item = challengeStore.get(String(key));
  if (!item || item.expiresAt < Date.now()) return null;
  return item;
}

/**
 * Generate Registration Options (Attestation)
 */
async function generateUserRegistrationOptions({ userId, userEmail, userName, req, challengeKey }) {
  const rpID = getRPID(req);
  const userGuid = String(userId || crypto.randomUUID());

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userID: Buffer.from(userGuid, "utf-8"),
    userName: String(userEmail || userGuid),
    userDisplayName: String(userName || userEmail || "User"),
    attestationType: "none", // Fastest & privacy preserving
    authenticatorSelection: {
      authenticatorAttachment: "platform", // Hardware chips: Touch ID, Face ID, Android Keystore, Windows Hello
      userVerification: "preferred",
      residentKey: "preferred",
    },
    timeout: 60000,
  });

  const key = challengeKey || `reg_${userGuid}`;
  storeChallenge(key, options.challenge, {
    userId: userGuid,
    userEmail,
    rpID,
  });

  return {
    options,
    challengeKey: key,
  };
}

/**
 * Verify Registration Response (Attestation)
 */
async function verifyUserRegistration({ response, challengeKey, req }) {
  const stored = consumeChallenge(challengeKey);
  if (!stored) {
    return {
      verified: false,
      error: "Registration challenge expired or already consumed. Please try again.",
    };
  }

  const expectedOrigin = getExpectedOrigin(req);
  const expectedRPID = stored.rpID || getRPID(req);

  try {
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: stored.challenge,
      expectedOrigin,
      expectedRPID,
      requireUserVerification: false,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return {
        verified: false,
        error: "WebAuthn registration verification failed.",
      };
    }

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    const publicKeyBase64 = Buffer.from(credential.publicKey).toString("base64url");

    return {
      verified: true,
      credential: {
        id: credential.id,
        publicKey: publicKeyBase64,
        counter: credential.counter || 0,
        transports: credential.transports || response.response?.transports || ["internal"],
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
      },
    };
  } catch (err) {
    console.error("WebAuthn verification error:", err.message);
    return {
      verified: false,
      error: err.message || "Failed to verify registration signature",
    };
  }
}

/**
 * Generate Authentication Options (Assertion Challenge)
 */
async function generateUserAuthenticationOptions({ credentialId, transports, req, challengeKey }) {
  const rpID = getRPID(req);

  const allowCredentials = credentialId
    ? [
        {
          id: credentialId,
          transports: Array.isArray(transports) && transports.length > 0 ? transports : ["internal"],
        },
      ]
    : undefined;

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials,
    userVerification: "preferred",
    timeout: 60000,
  });

  const key = challengeKey || `auth_${crypto.randomUUID()}`;
  storeChallenge(key, options.challenge, {
    credentialId,
    rpID,
  });

  return {
    options,
    challengeKey: key,
  };
}

/**
 * Verify Authentication Response (Assertion Signature)
 */
async function verifyUserAuthentication({ response, challengeKey, credential, req }) {
  const stored = consumeChallenge(challengeKey);
  if (!stored) {
    return {
      verified: false,
      error: "Authentication challenge expired or already consumed. Please scan/try again.",
    };
  }

  const expectedOrigin = getExpectedOrigin(req);
  const expectedRPID = stored.rpID || getRPID(req);

  if (!credential || !credential.publicKey || !credential.id) {
    return {
      verified: false,
      error: "No registered hardware passkey found for this account.",
    };
  }

  try {
    const publicKeyBytes = new Uint8Array(Buffer.from(credential.publicKey, "base64url"));

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: stored.challenge,
      expectedOrigin,
      expectedRPID,
      credential: {
        id: credential.id,
        publicKey: publicKeyBytes,
        counter: Number(credential.counter || 0),
        transports: credential.transports || ["internal"],
      },
      requireUserVerification: false,
    });

    if (!verification.verified) {
      return {
        verified: false,
        error: "Hardware signature validation failed.",
      };
    }

    return {
      verified: true,
      newCounter: verification.authenticationInfo?.newCounter || Number(credential.counter || 0) + 1,
    };
  } catch (err) {
    console.error("WebAuthn assertion verification error:", err.message);
    return {
      verified: false,
      error: err.message || "Failed to verify hardware assertion signature",
    };
  }
}

module.exports = {
  getRPID,
  getExpectedOrigin,
  storeChallenge,
  consumeChallenge,
  getChallenge,
  generateUserRegistrationOptions,
  verifyUserRegistration,
  generateUserAuthenticationOptions,
  verifyUserAuthentication,
};
