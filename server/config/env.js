const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PRODUCTION = NODE_ENV === "production";

function clean(value) {
  return String(value || "").trim();
}

function parseNumber(name, fallback, options = {}) {
  const raw = clean(process.env[name]);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a valid number`);
  }
  if (options.min != null && value < options.min) {
    throw new Error(`${name} must be >= ${options.min}`);
  }
  if (options.max != null && value > options.max) {
    throw new Error(`${name} must be <= ${options.max}`);
  }
  return value;
}

function parseBoolean(name, fallback = false) {
  const raw = clean(process.env[name]).toLowerCase();
  if (!raw) return fallback;
  if (["true", "1", "yes", "on"].includes(raw)) return true;
  if (["false", "0", "no", "off"].includes(raw)) return false;
  throw new Error(`${name} must be a boolean`);
}

function parseList(name) {
  return clean(process.env[name])
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function requireValue(name) {
  const value = clean(process.env[name]);
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

function requireStrongSecret(name, fallback = "smart-attendance-system-default-strong-jwt-secret-key-32-chars-min") {
  const value = clean(process.env[name]) || fallback;
  if (value.length < 32) {
    const message = `${name} must be at least 32 characters`;
    if (IS_PRODUCTION) throw new Error(message);
    console.warn(`${message} before production deployment`);
  }
  return value;
}

function optionalStrongSecret(name, fallback) {
  const value = clean(process.env[name]);
  if (!value) return fallback;
  if (value.length < 32) {
    const message = `${name} must be at least 32 characters`;
    if (IS_PRODUCTION) throw new Error(message);
    console.warn(`${message} before production deployment`);
  }
  return value;
}

function normalizeOrigin(origin) {
  const value = clean(origin).replace(/\/+$/, "");
  if (!value) return "";
  try {
    return new URL(value).origin;
  } catch {
    throw new Error(`Invalid origin configured: ${origin}`);
  }
}

function normalizeOriginPattern(pattern) {
  const value = clean(pattern).replace(/\/+$/, "");
  if (!value) return "";
  if (value === "*") return "*";
  if (value.startsWith("http://*.") || value.startsWith("https://*.") || value.startsWith("*.")) {
    return value;
  }
  return normalizeOrigin(value);
}

const frontendUrl = normalizeOrigin(process.env.FRONTEND_URL || "https://smartattend.app");
const defaultCorsOrigins = [
  "https://smartattend.app",
  "https://www.smartattend.app",
  "https://smartattend-qt1x.onrender.com",
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:3000",
];

const corsOrigins = Array.from(
  new Set([
    frontendUrl,
    ...defaultCorsOrigins.map(normalizeOrigin),
    ...parseList("CORS_ORIGINS").map(normalizeOrigin),
  ].filter(Boolean))
);

const defaultCorsOriginPatterns = [
  "https://*.smartattend.app",
  "https://*.pages.dev",
  "https://*.onrender.com",
];

const corsOriginPatterns = Array.from(
  new Set([
    ...defaultCorsOriginPatterns.map(normalizeOriginPattern),
    ...parseList("CORS_ORIGIN_PATTERNS").map(normalizeOriginPattern),
  ].filter(Boolean))
);

const env = {
  NODE_ENV,
  IS_PRODUCTION,
  PORT: parseNumber("PORT", 4000, { min: 1, max: 65535 }),
  HOST: clean(process.env.HOST) || "0.0.0.0",
  FRONTEND_URL: frontendUrl,
  CORS_ORIGINS: corsOrigins,
  CORS_ORIGIN_PATTERNS: corsOriginPatterns,
  CORS_ALLOW_ALL: parseBoolean("CORS_ALLOW_ALL", !IS_PRODUCTION),
  SSL_KEY_PATH: clean(process.env.SSL_KEY_PATH),
  SSL_CERT_PATH: clean(process.env.SSL_CERT_PATH),
  
  // Supabase Configuration
  SUPABASE_URL:
    clean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL) ||
    "https://zjgsnwjbxxkzrquclugv.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY:
    clean(process.env.SUPABASE_SERVICE_ROLE_KEY) ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpqZ3Nud2pieHhrenJxdWNsdWd2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzA3NTUwMSwiZXhwIjoyMTAyNjUxNTAxfQ.NQYGQ0pZIMZDE5EpMANkWCNqOIG0MbUigA-Q2N0f3G4",
  SUPABASE_ANON_KEY:
    clean(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY) ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpqZ3Nud2pieHhrenJxdWNsdWd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwNzU1MDEsImV4cCI6MjEwMjY1MTUwMX0.RKmyLaQb3Tvvgk6VRq6UsvlqVByg24d8nyB7zZRRvfI",
  
  // JWT Configuration
  JWT_SECRET: requireStrongSecret("JWT_SECRET"),
  JWT_REFRESH_SECRET: optionalStrongSecret(
    "JWT_REFRESH_SECRET",
    requireStrongSecret("JWT_SECRET")
  ),
  ACCESS_TOKEN_TTL: clean(process.env.ACCESS_TOKEN_TTL) || "15m",
  REFRESH_TOKEN_TTL: clean(process.env.REFRESH_TOKEN_TTL) || "7d",
  REFRESH_TOKEN_TTL_SECONDS: parseNumber("REFRESH_TOKEN_TTL_SECONDS", 7 * 24 * 60 * 60, {
    min: 60,
  }),

  // QR & Attendance Security
  QR_SECRET: requireStrongSecret("QR_SECRET", "smart-attendance-system-default-strong-qr-secret-key-32-chars"),
  QR_TTL_SECONDS: parseNumber("QR_TTL_SECONDS", 3, { min: 1 }),
  QR_RECENT_HISTORY: parseNumber("QR_RECENT_HISTORY", 8, { min: 3 }),
  QR_MAX_SEQUENCE_DRIFT: parseNumber("QR_MAX_SEQUENCE_DRIFT", 2, { min: 0 }),
  QR_MIN_ROTATION_SECONDS: parseNumber("QR_MIN_ROTATION_SECONDS", 3, { min: 0 }),
  QR_VERIFY_MAX_AGE_SECONDS: parseNumber("QR_VERIFY_MAX_AGE_SECONDS", 20, { min: 1 }),
  QR_MAX_TWO_STEP_GAP_SECONDS: parseNumber("QR_MAX_TWO_STEP_GAP_SECONDS", 45, { min: 1 }),
  QR_PRECHECK_SKEW_SECONDS: parseNumber("QR_PRECHECK_SKEW_SECONDS", 8, { min: 0 }),
  SCAN_GRANT_TTL_MS: parseNumber("SCAN_GRANT_TTL_MS", 90000, { min: 5000 }),
  MAX_LOCATION_ACCURACY_METERS: parseNumber("MAX_LOCATION_ACCURACY_METERS", 120, {
    min: 1,
  }),
  REQUIRE_FACE_VERIFICATION: parseBoolean("REQUIRE_FACE_VERIFICATION", false),
  MOBILE_LOCATION_CAPTURE_TTL_MS: parseNumber(
    "MOBILE_LOCATION_CAPTURE_TTL_MS",
    180000,
    { min: 5000 }
  ),
  DEFAULT_SESSION_RADIUS_METERS: parseNumber("DEFAULT_SESSION_RADIUS_METERS", 50, { min: 1 }),
  FACENET512_SERVICE_URL: clean(process.env.FACENET512_SERVICE_URL),
};

module.exports = env;
