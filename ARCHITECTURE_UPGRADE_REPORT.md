# SmartAttendanceSystem Architecture Upgrade Report

## 1. Current Architecture Review

The application uses React/Vite on the frontend and an Express backend with MongoDB, Mongoose, JWT auth, Socket.IO, dynamic QR generation, device fingerprint checks, GPS validation, and optional face verification. MongoDB is the source of truth for users, sessions, subjects, attendance, audit records, and security-relevant records. Redis is now optional for ephemeral QR state, scan grants, rate limits, and Socket.IO scaling; in-memory fallback remains for local single-instance use.

## 2. ACID Compliance Audit

Attendance duplicate prevention is protected by a unique MongoDB index on `{ session, student }`. QR attendance marking writes `Attendance` and `AttendanceAudit` together inside a MongoDB transaction when MongoDB is running as a replica set. Standalone MongoDB still falls back for local development, but full multi-document ACID requires a replica set.

## 3. Performance Bottlenecks

- Without `REDIS_URL`, `scanGrants` and `sessionQRState` fall back to process memory and do not survive Node restarts.
- Horizontal scaling requires Redis plus sticky sessions/load balancing.
- `SYNC_INDEXES=true` previously skipped `Attendance` and `Session`, so key indexes could be missing in production.
- Socket live counts emitted on duplicate joins and every leave path.
- Derived absence generation can become expensive for large classes and many sessions.

## 4. WebSocket Audit

Socket.IO uses one room per session and emits attendance updates only to the session room, which is the correct base architecture. The live-count tracking now ignores duplicate joins and emits only when membership actually changes. The Socket.IO Redis adapter is enabled automatically when `REDIS_URL` is configured.

## 5. QR Audit

The two-step QR flow is preserved. Tokens are signed JWTs with audience and issuer checks, short TTL, session binding, faculty/subject binding, sequence validation, and recent-token hash tracking. QR sequence history now uses Redis when configured and falls back to memory otherwise.

## 6. Redis Migration Plan

Keep MongoDB as source of truth. Redis support has been added for ephemeral state:

- `qr:{sessionId}`: recent token hashes, last issue time, TTL tied to session.
- `grant:{token}` and `grant-consumed:{token}`: one-time scan grant and atomic consume marker.
- Socket.IO Redis adapter pub/sub channels for cross-node rooms.
- `rate:{route}:{identity}`: short-lived rate limit counters.

Do not move Attendance, Students, Faculty, Sessions, Audit logs, Face records, or Security logs to Redis.

## 7. MongoDB Optimization Plan

Implemented indexes now cover high-frequency query paths:

- Attendance reports by session, faculty, subject, student, status, timestamp.
- Session lookup by faculty, subject/class group, active class group, and recent timeline.
- Index sync now includes `Session` and `Attendance`.

Run with `SYNC_INDEXES=true` during a controlled maintenance window, then keep `MONGO_AUTO_INDEX=false` in production.

## 8. Security Hardening Plan

Implemented required secret validation, rate limits, Redis-backed ephemeral state, one-time grant consume, and QR attendance audit writes. Preserve device fingerprint, two-step QR, session validation, location checks, role authorization, and face verification. Next hardening steps:

- Add manual-attendance audit coverage.
- Add security-event logs for rejected attempts.
- Restrict Socket.IO CORS to configured origins instead of wildcard after confirming all deployment origins.

## 9. GPS Trust Mitigation Strategy

Client GPS remains spoofable. Treat GPS as one signal only. Keep layered checks: location QR precheck, dynamic QR sequence, device fingerprint, session eligibility, optional face verification, and behavior analysis such as impossible travel, repeated failed attempts, and device changes.

## 10. Tailscale Funnel Analysis

Tailscale Funnel is acceptable for small deployments and demos if latency is stable and WebSocket connections remain healthy. At higher concurrency, measure tunnel latency, connection churn, and throughput before changing deployment. Do not migrate solely for architecture purity.

## 11. High-Concurrency Architecture

For one Node process, the current design is suitable for small to medium classroom concurrency when MongoDB indexes are present. For 1000+ concurrent students, use:

- Node.js behind a load balancer with sticky sessions.
- MongoDB replica set for transactions and durability.
- Redis for ephemeral QR state, scan grants, rate limits, and Socket.IO adapter.
- Session-room scoped emits only.
- MongoDB unique indexes as the final duplicate-prevention authority.

## 12. Failure Recovery Design

- Redis outage: disable new QR grants or fall back to single-instance memory; never lose committed attendance.
- Mongo outage: reject attendance writes, because MongoDB is the source of truth.
- Node restart: active sessions remain in MongoDB; QR/grant ephemeral state must be regenerated.
- Socket disconnect: attendance remains durable; client refresh can reload state.
- QR expiration: restart scan flow.
- Network spike: rely on short TTL plus two-step validation and clear retry errors.

## 13. Exact Code Changes

- `server/config/db.js`: index sync now includes `Session`, `Attendance`, `AttendanceAudit`, `RegistrationToken`, and `DeviceChangeRequest`.
- `server/models/Attendance.js`: added report and write-path indexes.
- `server/models/AttendanceAudit.js`: added durable QR attendance audit records.
- `server/models/Session.js`: added class timeline and faculty/session indexes.
- `server/services/sessionLifecycle.js`: made inactivity expiry conditional at update time and cheaper to touch.
- `server/services/redisClient.js`: added optional Redis connection helper.
- `server/services/qrService.js`: added Redis-backed QR state with memory fallback.
- `server/middleware/rateLimit.js`: added Redis-backed route throttling with memory fallback.
- `server/sockets/createSocket.js`: prevented duplicate room-count emits.
- `server/sockets/createSocket.js`: added optional Socket.IO Redis adapter.
- `server/index.js`: added required secret checks and short-secret production warnings.
- `server/routes/attendance.js`: scan grants are Redis-backed when configured, consumed before attendance write, and QR attendance audits are written with attendance.
- `server/routes/auth.js`: added login throttling.
- `server/middleware/auth.js`: removed legacy JWT `dev_secret` fallback.
- `docker-compose.yml`: added Redis service and `REDIS_URL`.

## 14. Expected Performance Improvements

The largest immediate gains are lower report query latency, less collection scanning, and fewer unnecessary socket emits. Attendance duplicate protection is stronger under concurrent retry because scan grants are now one-time at the route level, while the unique index remains the durable final guard.

## 15. Maximum Concurrent Users Before

Estimated single-instance practical range: 100-500 active users depending on machine size, MongoDB indexes, and QR polling cadence. Horizontal scaling is unsafe before Redis-backed ephemeral state or sticky sessions.

## 16. Maximum Concurrent Users After

With the implemented changes and Redis configured: 1000+ active users is a realistic target on appropriately sized infrastructure, assuming MongoDB indexes are built. With sticky load balancing, MongoDB replica set, Socket.IO Redis adapter, and measured tuning: 5000+ is practical with load testing.

## 17. Final Security Score

Current after changes: 8.5/10 for a college deployment with Redis configured. Remaining gaps are manual-attendance audit coverage, rejected-attempt security logs, stronger deployment secrets, and stricter socket CORS.

## 18. Final Scalability Score

Current after changes: 8/10 with Redis configured. Horizontal scale still needs sticky load balancing and production load tests.

## 19. Final Production Readiness Score

Current after changes: 8/10. Production readiness improves to 9/10 with MongoDB replica set enforcement, manual/security audit coverage, strict Socket.IO CORS, real secrets, and load testing.

## 20. Step-by-Step Implementation Roadmap

Phase 1: done. Add indexes, reduce socket churn, enforce configured secrets, consume grants, and make session touch/expiry safer.

Phase 2: mostly done. Redis support now covers scan grants, QR state, rate limits, and Socket.IO adapter. QR attendance audit logs are written with attendance. Remaining Phase 2 work is manual attendance audit coverage and rejected-attempt security logs.

Phase 3: deploy MongoDB as a replica set, add load balancer sticky sessions, run concurrency tests at 100, 500, 1000, and 5000 users, then tune Node/Mongo/Redis limits from measured results.
