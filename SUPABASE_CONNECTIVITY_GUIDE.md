# SmartAttend Supabase Database Connectivity & Deployment Guide

This document outlines the database connectivity architecture, Supabase connection pooler configuration, Render deployment settings, and free-tier compatibility guidelines for **SmartAttend**.

---

## 1. Database Access Architecture

SmartAttend utilizes a hybrid connectivity architecture designed specifically for high concurrency attendance bursts on free-tier infrastructure:

```
+-----------------------------------------------------------------------------------+
|                              SmartAttend Architecture                              |
+-----------------------------------------------------------------------------------+

[ Student & Faculty Clients (Web / Mobile) ]
                    │
                    ▼  (HTTPS / WSS)
[ Cloudflare Pages Frontend: https://smartattend.app ]
                    │
                    ▼  (CORS REST API)
[ Render Free Tier Web Service (Singapore) ] (Single Node, 512MB RAM)
   │
   ├─► [ Primary Runtime Access: @supabase/supabase-js ]
   │      - Protocol: HTTPS / REST (PostgREST) + WSS (Realtime)
   │      - Endpoint: https://<project-ref>.supabase.co
   │      - Behavior: PostgREST acts as an internal connection pooler at Supabase,
   │                  multiplexing hundreds of concurrent HTTP requests over a small
   │                  fixed set of PostgreSQL connections.
   │                  This prevents connection exhaustion during 100+ student scan bursts.
   │
   ├─► [ Direct High-Concurrency SQL Queries: pg.Pool (postgresPool.js) ]
   │      - Protocol: PostgreSQL TCP via Supavisor Pooler
   │      - Port: 6543 (Transaction Mode)
   │      - Endpoint: aws-0-ap-south-1.pooler.supabase.com:6543
   │      - Pool Settings: Max 10 connections, 30s idle timeout
   │      - Behavior: Supavisor assigns a PostgreSQL connection only during active query
   │                  execution, returning it immediately to the pool.
   │
   └─► [ Schema Migrations & DDL: pg.Client (run_supabase_migration.js) ]
          - Protocol: PostgreSQL TCP (Direct / Session Mode)
          - Port: 5432
          - Endpoint: db.<project-ref>.supabase.co:5432
          - Behavior: Required for DDL (CREATE TABLE, ALTER TABLE, CREATE INDEX)
                      which requires session-level transactional state.
```

---

## 2. Port & Protocol Comparison

| Purpose | Tool / Driver | Supabase Port | Pooler Mode | Connection String Env Var |
| :--- | :--- | :--- | :--- | :--- |
| **Runtime API Operations** (Attendance, Sessions, Auth) | `@supabase/supabase-js` | 443 (HTTPS) | PostgREST Internal Pool | `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` |
| **Direct High-Concurrency SQL** (Raw queries, batch workers) | `pg.Pool` (`server/config/postgresPool.js`) | **6543** | **Transaction** (Supavisor) | `DATABASE_URL` |
| **Schema Migrations & DDL** (`run_supabase_migration.js`) | `pg.Client` | **5432** | **Direct / Session** | `DIRECT_URL` |

> [!IMPORTANT]
> **Never run DDL migrations (e.g. `CREATE INDEX`, `ALTER TABLE`) through Port 6543 (Transaction Pooler).**
> Supavisor transaction pooler does not support multi-statement transactions with session-level locks or prepared statements. Always use `DIRECT_URL` (Port 5432) for running migrations.

---

## 3. Free-Tier Infrastructure Limits & Optimizations

### Supabase Free Tier (Mumbai `ap-south-1`)
- **Direct Postgres Connection Ceiling:** 60 connections max.
- **Database Size:** 500 MB.
- **Monthly Bandwidth:** 5 GB egress.
- **Optimization Strategy:**
  1. Main backend utilizes PostgREST over HTTPS (`SUPABASE_URL`), meaning 100 simultaneous student scan requests result in PostgREST multiplexing down to ~5-10 Postgres backend worker connections.
  2. For raw queries using `pg.Pool`, `PG_MAX_POOL_SIZE` is capped at `10` to leave ample headroom for Supabase dashboard and migration tools.
  3. Single-use face verification grants (`SCAN_GRANT_TTL_MS=90000`) store base64 biometric descriptors client-side/in-memory and exchange only lightweight tokens, drastically reducing DB storage and network egress.

### Render Free Tier (Singapore Region)
- **RAM:** 512 MB.
- **CPU:** 0.1 CPU shared.
- **Sleep Behavior:** Spins down after 15 minutes of inactivity. Cold start takes ~30-50 seconds.
- **Keep-Alive Tuning:**
  - `server.keepAliveTimeout = 65000` (65 seconds) in `server/index.js` ensures TCP sockets remain open across proxy layers (Cloudflare / Render reverse proxy), eliminating TLS handshake latency on repeated scans.
- **Health Check:** `/api/health` queries `admins` table with a limit of 1 to verify database readiness with sub-millisecond query time.

---

## 4. Environment Variables Reference

### Render Production Environment (`render.yaml`)

Configure the following variables in the [Render Dashboard](https://dashboard.render.com/):

```env
# Application Runtime
NODE_ENV=production
PORT=10000
FRONTEND_URL=https://smartattend.app
CORS_ORIGINS=https://smartattend.app,https://www.smartattend.app,https://smartattend-api-lpbx.onrender.com
CORS_ORIGIN_PATTERNS=https://*.smartattend.app,https://*.pages.dev,https://*.onrender.com

# Supabase API (PostgREST over HTTPS)
SUPABASE_URL=https://[YOUR-PROJECT-REF].supabase.co
SUPABASE_SERVICE_ROLE_KEY=[YOUR-SERVICE-ROLE-KEY]
SUPABASE_ANON_KEY=[YOUR-ANON-KEY]

# Direct Database Connections
DATABASE_URL=postgresql://postgres.[YOUR-PROJECT-REF]:[PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:6543/postgres
DIRECT_URL=postgresql://postgres:[PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres
PG_MAX_POOL_SIZE=10

# Security Secrets (Generated automatically or min 32 chars)
JWT_SECRET=[SECURE-32-CHAR-SECRET]
JWT_REFRESH_SECRET=[SECURE-32-CHAR-SECRET]
QR_SECRET=[SECURE-32-CHAR-SECRET]

# Attendance & QR Guard
QR_TTL_SECONDS=3
QR_RECENT_HISTORY=8
SCAN_GRANT_TTL_MS=90000
DEFAULT_SESSION_RADIUS_METERS=50
MAX_LOCATION_ACCURACY_METERS=120
REQUIRE_FACE_VERIFICATION=false
```

---

## 5. Running Database Migrations

When applying schema updates (such as concurrency unique constraints or WebAuthn tables):

```bash
# In your local terminal or deployment step:
cd server

# Ensure DIRECT_URL is set in server/.env pointing to port 5432
node run_supabase_migration.js
```

The migration runner will automatically verify that you are connecting via port 5432 and apply all DDL statements safely.

---

## 6. Verifying Connectivity & Troubleshooting

### Check Database Health via API
Visit: `https://<your-render-url>/api/health`

Expected JSON response:
```json
{
  "ok": true,
  "service": "smart-qr-attendance",
  "database": "supabase-postgresql",
  "supabaseConfigured": true,
  "supabaseReady": true,
  "supabaseError": null,
  "uptimeSeconds": 142,
  "memoryUsageMB": 48,
  "environment": "production"
}
```

### Common Issues & Remedies

| Error / Symptom | Root Cause | Solution |
| :--- | :--- | :--- |
| `remaining connection slots are reserved for non-replication superuser connections` | Connection limit (60) reached on Supabase | Check that runtime queries use PostgREST or `DATABASE_URL` with port 6543. Ensure `PG_MAX_POOL_SIZE` <= 10. |
| `prepared statement "..." does not exist` | Attempting to use prepared statements through Supavisor Transaction Pooler (port 6543) | Disable prepared statements or use session pooler (port 5432). PostgREST (`@supabase/supabase-js`) handles this automatically. |
| `504 Gateway Timeout` on first request | Render instance waking from 15-min idle sleep | Normal on free tier (~40s cold start). Keep-alive pings can be configured with UptimeRobot or cron job hitting `/api/health`. |
