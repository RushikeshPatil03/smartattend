const crypto = require("crypto");

/**
 * BACKWARD COMPATIBLE fingerprint normalization.
 *
 * Supports:
 * - Old stored fingerprints
 * - New normalized fingerprints
 *
 * This PREVENTS LOCKING OUT existing users.
 */
function normalizeFingerprint(fp) {
  if (!fp) return "";

  const raw = String(fp).trim();
  if (!raw) return "";

  // NEW normalized (lowercase)
  const normalized = raw.toLowerCase();

  // Hash normalized
  const newHash = crypto
    .createHash("sha256")
    .update(normalized, "utf8")
    .digest("hex");

  return newHash;
}

/**
 * LEGACY SUPPORT:
 * Some users were stored with raw-hash logic.
 * This helps compare both if needed.
 */
function legacyFingerprintHash(fp) {
  if (!fp) return "";
  const raw = String(fp).trim();
  if (!raw) return "";

  return crypto
    .createHash("sha256")
    .update(raw, "utf8")
    .digest("hex");
}

module.exports = {
  normalizeFingerprint,
  legacyFingerprintHash,
};
