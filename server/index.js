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
  if (!origin) return false;
  try {
    const u = new URL(origin);
    if (u.protocol !== "https:") return false;
    return (
      u.hostname.endsWith(".loca.lt") ||
      u.hostname.endsWith(".localtunnel.me") ||
      u.hostname.endsWith(".trycloudflare.com") ||
      u.hostname.endsWith(".pages.dev") ||
      u.hostname.endsWith(".onrender.com") ||
      u.hostname.endsWith(".vercel.app") ||
      u.hostname.endsWith(".netlify.app")
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
      return callback(null, false);
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
// Core Middleware (Performance-optimized body parsers)
// ----------------------------------------------------
const defaultJsonParser = express.json({ limit: "50kb" });
const heavyJsonParser = express.json({ limit: "8mb" });

// Heavy payload endpoints that process base64 images, face signatures, or photo uploads
function isHeavyPayloadRoute(req) {
  const target = String(req.originalUrl || req.path || req.url || "");
  return (
    target.startsWith("/api/student/register") ||
    target.startsWith("/api/auth/device-change-request") ||
    target.startsWith("/api/faculty/profile/photo") ||
    target.startsWith("/api/admin/profile") ||
    target.startsWith("/api/attendance/mark") ||
    target.startsWith("/api/attendance/scan-grant/mark") ||
    target.startsWith("/api/attendance/totp") ||
    target.startsWith("/api/attendance/submit")
  );
}

app.use((req, res, next) => {
  if (isHeavyPayloadRoute(req)) {
    return heavyJsonParser(req, res, next);
  }
  return defaultJsonParser(req, res, next);
});

app.use(express.urlencoded({ extended: true, limit: "50kb" }));

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
// Root Landing Route (eliminates "Cannot GET /")
// ----------------------------------------------------
app.get("/", (req, res) => {
  if (req.accepts("html")) {
    return res.type("html").send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Smart Attendance API • Operational</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
          body { background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
          .card { background: rgba(30, 41, 59, 0.7); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 24px; padding: 36px; max-width: 520px; width: 100%; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5); backdrop-filter: blur(12px); text-align: center; }
          .badge { display: inline-flex; align-items: center; gap: 8px; background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.4); color: #34d399; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; padding: 6px 14px; border-radius: 999px; margin-bottom: 20px; }
          .dot { width: 8px; height: 8px; background: #10b981; border-radius: 50%; box-shadow: 0 0 12px #10b981; }
          h1 { font-size: 24px; font-weight: 800; margin-bottom: 10px; letter-spacing: -0.5px; }
          p { color: #94a3b8; font-size: 14px; line-height: 1.6; margin-bottom: 24px; }
          .btn-group { display: flex; flex-direction: column; gap: 12px; }
          .btn { display: inline-block; padding: 12px 24px; border-radius: 12px; font-size: 14px; font-weight: 600; text-decoration: none; transition: all 0.2s ease; }
          .btn-primary { background: linear-gradient(135deg, #059669, #0d9488); color: white; box-shadow: 0 4px 15px rgba(16, 185, 129, 0.3); }
          .btn-secondary { background: rgba(255, 255, 255, 0.05); color: #cbd5e1; border: 1px solid rgba(255, 255, 255, 0.1); }
          .footer { margin-top: 24px; font-size: 12px; color: #64748b; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="badge">
            <span class="dot"></span>
            Backend API Active
          </div>
          <h1>Smart Attendance System API</h1>
          <p>This is the backend API service powered by Node.js & Supabase. It serves authentication, realtime session grants, QR validation, and attendance ledgers.</p>
          <div class="btn-group">
            <a href="/api/health" class="btn btn-primary">View Health Diagnostics</a>
            ${env.FRONTEND_URL ? `<a href="${env.FRONTEND_URL}" class="btn btn-secondary">Go to Frontend Portal</a>` : ""}
          </div>
          <div class="footer">Environment: ${env.NODE_ENV} • Node.js ${process.version}</div>
        </div>
      </body>
      </html>
    `);
  }

  res.json({
    ok: true,
    service: "smart-qr-attendance-backend",
    message: "Smart Attendance Backend API is online and operational",
    healthCheck: "/api/health",
    frontendUrl: env.FRONTEND_URL || "https://smartattend.app",
    version: "1.0.0",
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
