const path = require("path");
const http = require("http");
const https = require("https");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");

const getLocalIP = require("./utils/getLocalIP");
const env = require("./config/env");
const { getSupabaseClient, isSupabaseConfigured } = require("./config/supabase");

// Routes
const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");
const facultyRoutes = require("./routes/faculty");
const studentRoutes = require("./routes/student");
const attendanceRoutes = require("./routes/attendance");
const departmentRoutes = require("./routes/department");
const subjectRoutes = require("./routes/subject");
const publicRoutes = require("./routes/public");

const app = express();

let server;
if (env.SSL_KEY_PATH && env.SSL_CERT_PATH && fs.existsSync(env.SSL_KEY_PATH) && fs.existsSync(env.SSL_CERT_PATH)) {
  const sslOptions = {
    key: fs.readFileSync(env.SSL_KEY_PATH),
    cert: fs.readFileSync(env.SSL_CERT_PATH),
  };
  server = https.createServer(sslOptions, app);
} else {
  server = http.createServer(app);
}

// ----------------------------------------------------
// CORS (Stable for Cloudflare Pages + Render + Local)
// ----------------------------------------------------
const allowedOrigins = new Set([
  ...env.CORS_ORIGINS,
  "https://smartattend.app",
  "https://www.smartattend.app",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
  "https://localhost:3000",
  "https://localhost:5173",
  "https://127.0.0.1:3000",
  "https://127.0.0.1:5173",
]);

const allowedOriginPatterns = env.CORS_ORIGIN_PATTERNS || [];

function normalizeRequestOrigin(origin) {
  if (!origin) return "";
  try {
    return new URL(origin).origin;
  } catch {
    return "";
  }
}

function matchesWildcardOrigin(origin, pattern) {
  if (!origin || !pattern) return false;
  if (pattern === "*") return true;

  try {
    const url = new URL(origin);
    const host = String(url.hostname || "").toLowerCase();
    const normalizedPattern = String(pattern).trim().toLowerCase();

    if (normalizedPattern.startsWith("http://*.") || normalizedPattern.startsWith("https://*.")) {
      const [protocol, rest] = normalizedPattern.split("://");
      if (`${url.protocol}` !== `${protocol}:`) return false;
      const suffix = rest.slice(2);
      return host === suffix || host.endsWith(`.${suffix}`);
    }

    if (normalizedPattern.startsWith("*.")) {
      const suffix = normalizedPattern.slice(2);
      return host === suffix || host.endsWith(`.${suffix}`);
    }
  } catch {
    return false;
  }

  return false;
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (env.CORS_ALLOW_ALL) return true;

  const normalized = normalizeRequestOrigin(origin);
  if (!normalized) return false;

  if (allowedOrigins.has(normalized)) return true;

  for (const pattern of allowedOriginPatterns) {
    if (matchesWildcardOrigin(normalized, pattern)) {
      return true;
    }
  }

  if (isLAN(normalized) || isTunnelOrigin(normalized)) return true;
  return false;
}

function isLAN(origin) {
  if (env.IS_PRODUCTION) return false;
  if (!origin) return true;
  try {
    const u = new URL(origin);
    const host = String(u.hostname || "");
    return (
      host.startsWith("172.") ||
      host.startsWith("192.168.") ||
      host.startsWith("10.") ||
      host === "localhost" ||
      host === "127.0.0.1"
    );
  } catch {
    return false;
  }
}

function isTunnelOrigin(origin) {
  if (env.IS_PRODUCTION) return false;
  if (!origin) return false;
  try {
    const u = new URL(origin);
    if (u.protocol !== "https:") return false;
    return (
      u.hostname.endsWith(".loca.lt") ||
      u.hostname.endsWith(".localtunnel.me") ||
      u.hostname.endsWith(".trycloudflare.com") ||
      u.hostname.endsWith(".pages.dev") ||
      u.hostname.endsWith(".onrender.com")
    );
  } catch {
    return false;
  }
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) {
        return callback(null, true);
      }
      console.warn("Blocked CORS origin:", origin);
      return callback(new Error("Not allowed by CORS"), false);
    },
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    maxAge: 600,
  })
);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use(compression());

// ----------------------------------------------------
// Core Middleware
// ----------------------------------------------------
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ----------------------------------------------------
// API Routes
// ----------------------------------------------------
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/student", studentRoutes);
app.use("/api/faculty", facultyRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/department", departmentRoutes);
app.use("/api/subject", subjectRoutes);
app.use("/api/public", publicRoutes);

// ----------------------------------------------------
// Health Check (Lightweight for fast Render cold start)
// ----------------------------------------------------
app.get("/api/health", async (_req, res) => {
  const supabaseConfigured = isSupabaseConfigured();
  let supabaseReady = false;
  let supabaseError = null;

  if (supabaseConfigured) {
    try {
      const client = getSupabaseClient();
      if (client) {
        const { error } = await client.from("admins").select("id").limit(1);
        if (error) {
          supabaseError = error.message;
        } else {
          supabaseReady = true;
        }
      } else {
        supabaseError = "Supabase client instance is null";
      }
    } catch (err) {
      supabaseError = err.message;
    }
  }

  res.json({
    ok: true,
    service: "smart-qr-attendance",
    database: "supabase-postgresql",
    supabaseConfigured,
    supabaseReady,
    supabaseError,
    uptimeSeconds: Math.floor(process.uptime()),
    memoryUsageMB: Math.round(process.memoryUsage().rss / (1024 * 1024)),
    environment: env.NODE_ENV,
    time: new Date().toISOString(),
  });
});

// ----------------------------------------------------
// Global Error Handler
// ----------------------------------------------------
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ ok: false, error: "Internal server error" });
});

// ----------------------------------------------------
// Start Server
// ----------------------------------------------------
const PORT = env.PORT || 4000;
const HOST = env.HOST || "0.0.0.0";
const LAN_IP = getLocalIP();

server.listen(PORT, HOST, () => {
  console.log("=================================================");
  console.log(" Smart Attendance System - Supabase Backend API  ");
  console.log("=================================================");
  const scheme = env.SSL_KEY_PATH && env.SSL_CERT_PATH ? "https" : "http";
  console.log(` Server running on: ${scheme}://localhost:${PORT}`);
  console.log(` LAN access:        ${scheme}://${LAN_IP}:${PORT}`);
  console.log(` Health check:     ${scheme}://localhost:${PORT}/api/health`);
  console.log(` Database:         Supabase PostgreSQL`);
  console.log("=================================================");
});

module.exports = { app, server };
