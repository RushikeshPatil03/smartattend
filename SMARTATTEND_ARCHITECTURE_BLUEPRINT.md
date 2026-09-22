# SmartAttend.app: High-Concurrency, Zero-Latency Architecture Blueprint
**Target Burst Capacity:** 1,000+ Concurrent Students in 30 Seconds Across Simultaneous Classrooms  
**Infrastructure Budget:** $0.00 (Cloudflare Pages + Render Free Tier + Supabase Free Tier)  
**Target Latency:** Sub-200ms API Acknowledgment, Sub-600ms Faculty Dashboard Reflection

---

## Executive Summary & Bottleneck Diagnosis

The university attendance scenario represents an extreme **micro-burst traffic pattern**:
- **0 requests/sec** for 55 minutes.
- **50 to 100 requests/sec (1,000+ scans across 30 seconds)** when multiple faculty members reveal the dynamic QR code at the start of a class period.

On free-tier infrastructure, unoptimized architectures collapse under this pattern due to 4 compounding failure modes:
1. **Threadpool & CPU Saturation from Bcrypt & DeepFace:** A single bcrypt comparison takes 70–100ms of CPU; a single DeepFace inference consumes 350–1200ms of 100% CPU. Handling 20 concurrent requests locks the Node.js event loop and blows Python's 512MB RAM limit (causing OOM `SIGKILL 137`).
2. **Postgres Connection Exhaustion:** 1,000 individual incoming writes hitting Postgres directly (port 5432) will exceed Supabase’s max connection cap (60 connections on free tier), throwing `FATAL: remaining connection slots are reserved`.
3. **Supabase Realtime Quota Breach:** Subscribing 1,000 students to Supabase Realtime WebSocket channels breaches the 200 concurrent connection limit and triggers severe message rate throttling (100 msgs/sec quota).
4. **Multi-Hop Edge-to-Origin Latency:** The physical network roundtrips between student browsers (Edge/ISP), Cloudflare Pages (Edge), Render (Oregon/Frankfurt), and Supabase (Mumbai) add 150–400ms of network overhead per request if calls are made synchronously in series.

Below is the definitive engineering blueprint to solve each failure mode with mathematical rigor while preserving 100% free-tier compliance.

```
+---------------------------------------------------------------------------------------------------------+
|                                    SMARTATTEND 30-SECOND BURST ARCHITECTURE                             |
+---------------------------------------------------------------------------------------------------------+
                                                                                                           
 [1,000+ Students (Chrome PWA)]                             [10-20 Faculty Dashboards]                     
             |                                                           ^                                 
             | 1. Two-Step Dynamic QR Scans                              | 6. Micro-Batched Broadcasts     
             | 2. Client-Side MediaPipe Face Vector (<2KB)               |    (Every 600ms, max 2 msgs/sec)
             v                                                           |                                 
  +----------------------+                                               |                                 
  |   Cloudflare Pages   | (Edge Static Asset Delivery & DNS)            |                                 
  +----------------------+                                               |                                 
             |                                                           |                                 
             | HTTP Keep-Alive / Compression                             |                                 
             v                                                           |                                 
  +--------------------------------------------------------------------+ |                                 
  |                        RENDER (Node.js API)                        | |                                 
  |                                                                    | |                                 
  |  [Fast-Ack Ingress] ---> [LRU Memory Grant & Session Check: 2ms]   | |                                 
  |           |                        |                               | |                                 
  |           | (Return 200 OK)        v                               | |                                 
  |           +-----------------> [In-Memory Ring Queue]               | |                                 
  |                                    |                               | |                                 
  |                                    | 50-item / 60ms Micro-Batch    | |                                 
  |                                    v                               | |                                 
  |                        [Bulk Upsert / Copy RPC]                    | |                                 
  +------------------------------------|-------------------------------+ |                                 
                                       |                                 |                                 
               PostgREST / Supavisor   |                                 | Realtime Broadcast              
               Port 6543 (Pooler)      v                                 |                                 
  +--------------------------------------------------------------------+ |                                 
  |                       SUPABASE POSTGRESQL (Mumbai)                 | |                                 
  |                                                                    | |                                 
  |  - Raw Writes: Bulk Upsert into `attendances`                      | |                                 
  |  - Realtime: WebSocket Broadcasts ONLY to Faculty Channels --------+ |                                 
  |  - Async Biometric Queue: `face_verification_queue`                |                                   
  +--------------------------------------------------------------------+                                   
                                       |                                                                   
                                       | Pulls batch jobs (every 2-5s)                                     
                                       v                                                                   
  +--------------------------------------------------------------------+                                   
  |                     FASTAPI MICROSERVICE (DeepFace)                |                                   
  |  - Runs strictly out-of-band as an Asynchronous Audit Worker        |                                   
  |  - Processes 1-2 faces sequentially (Zero memory spikes)           |                                   
  |  - Flags suspicious scans without ever blocking the student UI     |                                   
  +--------------------------------------------------------------------+                                   
```

---

## Pillar A: Concurrency & Load Balancing Strategy

### 1. The 30-Second Ingress Architecture
To process 1,000 students in 30 seconds without spinning up paid servers, the ingestion pipeline must be decoupled into **Fast Synchronous Verification** and **Asynchronous Micro-Batched Persistence**.

#### Execution Pipeline:
1. **Pre-Validation at Memory Speed (< 3ms):**
   - When a student submits a scan (`POST /api/attendance/mark`), the API does **not** hit Postgres for authorization.
   - **Active Session State:** Kept in Node.js LRU memory cache (`activeSessionsMemoryCache` with 5-second TTL). The session parameters, coordinates, geofence radius, and active QR salt are already in RAM.
   - **Cryptographic Sequence Validation:** The 2-step dynamic QR tokens are verified using HMAC-SHA256 signature and TOTP time-window math (`crypto.timingSafeEqual`) in pure Node.js memory (< 0.5ms).
   - **Geofence Check:** Haversine distance formula computed in RAM (< 0.1ms).
   - **One-Time Scan Grant:** Consumed atomically from the in-memory map or Redis `SETNX` (< 1ms).
2. **Double-Tap Lock (Sliding Window):**
   - Enforce an in-memory lock key `lock:${sessionId}:${studentId}`. Any duplicate tap within 5 seconds receives an immediate HTTP 409 Conflict without touching the database.
3. **Immediate Client Acknowledgment:**
   - As soon as memory checks pass, the scan is guaranteed valid. The server enqueues the record into the `AttendanceBatchWriter` ring buffer.
   - The HTTP response returns **HTTP 200 OK** in **~25–45ms** total wire time. The student's UI immediately displays the green checkmark: *"Attendance Verified"*.

### 2. High-Throughput Write Micro-Batching Pattern
Instead of 1,000 individual `INSERT` queries opening 1,000 transactions, the backend batches items using an internal flush window:

```javascript
// Optimized Micro-Batcher Configuration
class AttendanceBatchWriter {
  constructor() {
    this.queue = [];
    this.timer = null;
    this.BATCH_WINDOW_MS = 60; // 60ms aggregation window
    this.MAX_BATCH_SIZE = 50;  // Flush immediately if 50 requests arrive
  }
  
  enqueue(payload, studentId, sessionId) {
    return new Promise((resolve, reject) => {
      this.queue.push({ payload, resolve, reject, studentId, sessionId });
      if (this.queue.length >= this.MAX_BATCH_SIZE) {
        this.flush();
      } else if (!this.timer) {
        this.timer = setTimeout(() => this.flush(), this.BATCH_WINDOW_MS);
      }
    });
  }
}
```

#### Database Impact:
- 1,000 requests over 30 seconds = ~33 requests/second.
- With a 60ms / 50-item window, 33 requests/second collapse into **1 single multi-row insert every 600ms** or **2 inserts per second**!
- Database load drops by **97%**.

---

## Pillar B: Asynchronous Facial Recognition & Auth Pipeline

### 1. Solving the DeepFace CPU/Memory Crisis
DeepFace model execution (`Facenet512` + `mediapipe`) requires ~1.2 seconds of CPU and ~400MB RAM. Executing this synchronously inside the attendance endpoint causes catastrophic timeouts under 1,000 users.

#### Two-Pronged Biometric Architecture:

#### A. Client-Side Landmark Vectorization (Zero Server Cost)
SmartAttend's frontend PWA already includes MediaPipe Vision (`dist/assets/vision_bundle-DOlXQUHX.js`).
1. When the student takes a selfie, the client browser computes the **FaceMesh 468-point landmark vector** or **MobileFaceNet embedding** locally on the client's GPU/WebGL in **~80ms**.
2. The browser sends a compact vector array (`[0.142, -0.052, ...]`, ~2 KB payload) instead of a 500 KB base64 JPEG image!
3. The Node.js server compares the live vector with the registered student vector using Cosine Distance:
   $$\text{Cosine Distance} = 1 - \frac{\mathbf{u} \cdot \mathbf{v}}{\|\mathbf{u}\| \|\mathbf{v}\|}$$
   Comparing two 128/512-D vectors in Node.js takes **0.005 milliseconds** (5 microseconds). It can verify 10,000 vectors per second on a single CPU thread without calling Python!

#### B. Asynchronous Python Worker (Out-of-Band Audit)
If server-side DeepFace image verification is mandated:
1. **Never block the check-in:** The attendance record is inserted immediately with `face_verification_status = 'PENDING'`.
2. **Worker Deferral:** The face image URL or compressed thumbnail is pushed to a lightweight Postgres queue table `biometric_audit_jobs`.
3. **FastAPI Background Consumer:**
   The Python FastAPI instance runs a detached polling loop or Celery-style worker with concurrency set to **1**:
   ```python
   # face-service/worker.py
   import time
   from deepface import DeepFace
   
   def process_audit_queue(supabase_client):
       while True:
           # Fetch up to 2 pending jobs
           jobs = supabase_client.rpc("claim_biometric_jobs", {"batch_size": 2}).execute()
           if not jobs.data:
               time.sleep(2)
               continue
               
           for job in jobs.data:
               # Heavy DeepFace inference safely isolated from user traffic
               res = DeepFace.verify(job["live_img"], job["ref_img"], model_name="Facenet512")
               supabase_client.rpc("complete_biometric_job", {
                   "job_id": job["id"],
                   "verified": res["verified"],
                   "distance": res["distance"]
               }).execute()
   ```
4. If a face mismatch occurs, the database trigger flags the attendance record to `status = 'FLAGGED'` and notifies the faculty dashboard via Realtime. The student was never delayed.

### 2. Eliminating Bcrypt CPU Bottlenecks During Morning Login Spikes
Bcrypt at cost factor 10 takes 80ms of CPU per verification. 500 students logging in before class consumes 40 seconds of pure CPU, locking the Node.js event loop.

#### Structural Fixes:
1. **Persistent Session Strategy (95% Bypass):**
   - University attendance occurs daily. Students should **almost never** have to enter their password at 9:00 AM.
   - Configure **long-lived Refresh Tokens (30 days)** stored in `httpOnly`, `Secure`, `SameSite=None` cookies with sliding rotation.
   - When the student opens the Chrome PWA, the app silently calls `/api/auth/refresh` (cryptographic token lookup via indexed DB hash in 2ms), instantly issuing a fresh 1-hour JWT. Zero bcrypt hashing required!
2. **Offload Bcrypt to Libuv Threadpool:**
   - In Node.js, ensure `UV_THREADPOOL_SIZE` is set to 8 or 16 (default is 4):
     ```bash
     export UV_THREADPOOL_SIZE=16
     ```
   - Use the native C++ binding `bcrypt` (not pure JS `bcryptjs`), allowing password hashing to run on worker threads outside the main event loop.
3. **Argon2id Hybrid Migration:**
   - Migrate student passwords to **Argon2id** (`argon2.hash(pwd, { type: argon2.argon2id, timeCost: 2, memoryCost: 15360, parallelism: 1 })`).
   - Argon2id is immune to GPU/ASIC attacks, operates with predictable memory footprints, and releases CPU cycles significantly faster than bcrypt on multi-threaded runtimes.

---

## Pillar C: Database & Real-Time Sync Optimization

### 1. Supabase Postgres Optimization & Connection Pooling

#### A. Direct Port 5432 vs. Supavisor Port 6543
- **Never** point the Node.js backend to direct Postgres connection port 5432 in high-concurrency production.
- Connect via **Supavisor (Transaction Mode Pooler)** on **port 6543**:
  ```env
  DATABASE_URL=postgres://postgres.[ref]:[password]@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true
  ```
- **Why?** Transaction pooling multiplexes 1,000 incoming Express DB requests onto 15 persistent physical connections to Postgres, preventing connection spikes and memory crashes.

#### B. Indexing Strategy for Zero-Contention Inserts
Heavy write paths degrade if tables carry excessive or redundant indexes. Optimize the `attendances` table:

```sql
-- 1. Atomic Idempotency Constraint (Essential for ON CONFLICT upsert)
ALTER TABLE attendances 
ADD CONSTRAINT uq_attendance_session_student UNIQUE (session, student);

-- 2. Ultra-Fast Faculty Query Partial Index (Zero overhead on absent/failed records)
CREATE INDEX IF NOT EXISTS idx_attendances_session_present 
ON attendances (session, timestamp DESC) 
WHERE status = 'present';

-- 3. Student Profile History Index
CREATE INDEX IF NOT EXISTS idx_attendances_student_recent 
ON attendances (student, timestamp DESC);

-- DROP unnecessary composite indexes that slow down writes:
DROP INDEX IF EXISTS idx_attendances_subject_faculty;
```

#### C. Relational Flat Columns vs. JSONB
- **Flat Typed Columns (`UUID`, `TIMESTAMPTZ`, `VARCHAR`):**
  Use for all indexed and relational query fields (`id`, `session`, `student`, `faculty`, `subject`, `status`, `timestamp`).
- **JSONB:**
  Use exclusively for non-relational diagnostic payloads:
  - `location`: `{"lat": 19.076, "lng": 72.877, "accuracy": 12, "dist": 8}`
  - `device`: `{"fingerprint": "a3f8...", "ip": "103.21...", "ua": "Chrome/128"}`
  - `face_verification`: `{"verified": true, "score": 0.94, "model": "facenet512"}`
- This hybrid structure prevents wide row bloat while avoiding slow schema migrations.

### 2. Supabase Realtime Architecture: Eliminating Broadcast Overload

#### The Root Cause of Realtime Drops
Supabase Free Tier allows **200 concurrent WebSocket connections** and **100 messages/sec**. If 1,000 students connect to Supabase Realtime, the project exceeds limits and Supabase forcibly throttles or drops messages.

#### The Architectural Solution: Asymmetric Broadcast Topography

```
                    [1,000 Students]
                           |
                           | HTTP POST /api/attendance/mark
                           v
                 [Render Express API]
                           |
                           | Internal 600ms Micro-Batcher
                           | (Packs 20-30 student arrivals into 1 payload)
                           v
        [Supabase Realtime Channel: `session:{sessionId}`]
                           |
                           | Max 1 to 2 Broadcast messages per second
                           v
                 [10-20 Faculty Dashboards]
```

1. **Disconnect Students from Realtime:**
   Students **never** open a WebSocket connection to Supabase. When a student marks attendance, their HTTP POST response immediately provides their status (`{ ok: true, status: 'present' }`). There is zero functional need for a student to listen to other students' check-ins.
2. **Only Faculty Dashboards Connect:**
   In any 30-second window across a campus, there are typically 10 to 20 active classrooms. That means **only 10 to 20 WebSocket connections** exist across the entire university! (Utilization: 10% of Supabase free tier).
3. **Micro-Batched Event Serialization:**
   Instead of sending 1 broadcast per student, `realtimeService.js` flushes an ultra-compact batch every 600ms:
   ```json
   {
     "e": "BATCH_MARKED",
     "s": "3f8b8c2e-...",
     "items": [
       {"id":"att_1","sId":"stud_1","roll":"CS101","name":"Alice","t":1726928000},
       {"id":"att_2","sId":"stud_2","roll":"CS102","name":"Bob","t":1726928001}
     ]
   }
   ```
4. **Bandwidth Savings:**
   Payload size drops by **85%**, message frequency drops from 33 msgs/sec to **1.6 msgs/sec per classroom**, completely immunizing the system against drops.

---

## Pillar D: Implementation Roadmap & Isolated Local Staging

### Progressive Phase Breakdown

```
+---------------------------------------------------------------------------------------+
| PHASE 1: Realtime Topography & Client Decoupling (Days 1 - 2)                         |
| - Verify student clients do NOT establish Realtime sockets.                           |
| - Audit `src/` to ensure only `FacultyDashboard.tsx` opens `session:{id}` channel.     |
| - Validate `BATCH_MARKED` handler on Faculty Dashboard.                              |
+---------------------------------------------------------------------------------------+
                                           |
                                           v
+---------------------------------------------------------------------------------------+
| PHASE 2: Auth Hardening & Libuv Threading (Days 3 - 4)                                 |
| - Configure `UV_THREADPOOL_SIZE=16` in Render launch command.                         |
| - Verify 30-day refresh token rotation in `server/routes/auth.js`.                    |
| - Eliminate cold-start bcrypt storms through proactive token refreshes.               |
+---------------------------------------------------------------------------------------+
                                           |
                                           v
+---------------------------------------------------------------------------------------+
| PHASE 3: Biometric Decoupling & Client Vectorization (Days 5 - 7)                     |
| - Convert DeepFace in `attendance.js` from blocking synchronous call to async audit.  |
| - Test client-side MediaPipe landmark calculation in `LivePhotoCapture.tsx`.          |
| - Reduce image payload from 500KB base64 to 2KB vector.                               |
+---------------------------------------------------------------------------------------+
                                           |
                                           v
+---------------------------------------------------------------------------------------+
| PHASE 4: Database Pooling & Micro-Batching Validation (Days 8 - 10)                   |
| - Switch DB connections to Supavisor port 6543 (Transaction Mode).                   |
| - Apply optimized partial indexes in `supabase_schema.sql`.                           |
| - Benchmark `AttendanceBatchWriter` under concurrent simulated load.                  |
+---------------------------------------------------------------------------------------+
                                           |
                                           v
+---------------------------------------------------------------------------------------+
| PHASE 5: Isolated Local Load Testing (Days 11 - 12)                                   |
| - Run local Docker staging stack (`docker-compose.yml`).                              |
| - Execute 1,000-user Artillery / Autocannon burst test on single laptop.              |
+---------------------------------------------------------------------------------------+
```

---

## Isolated Local Staging & Verification Guide

To test these high-concurrency modifications locally on a single machine without touching production or spending money:

### 1. Local Staging Stack Configuration
The repository already contains a clean `docker-compose.yml`. We can configure it to mirror production locally:

```yaml
# docker-compose.staging.yml
version: '3.8'

services:
  # Local Redis for ephemeral lock & scan grant testing
  redis-staging:
    image: redis:7-alpine
    container_name: smartattend-redis-staging
    ports:
      - "6380:6379"

  # Local Mock / Standalone Python Face Service
  face-staging:
    build:
      context: ./face-service
      dockerfile: Dockerfile
    container_name: smartattend-face-staging
    ports:
      - "8001:8000"
    environment:
      - FACE_MODEL_NAME=Facenet512
      - FACE_DETECTOR_BACKEND=mediapipe
```

### 2. High-Concurrency Simulation Script (Autocannon / Artillery)
Create a standalone load-test script in `scripts/load_test_burst.js` using `autocannon` to simulate the 30-second 1,000-user challenge:

```javascript
// scripts/load_test_burst.js
const autocannon = require("autocannon");

async function runBurstTest() {
  console.log("🚀 Starting 30-Second 1,000-Student Burst Test on Local Staging...");

  const result = await autocannon({
    url: "http://localhost:5000/api/attendance/mark",
    connections: 50,       // 50 concurrent HTTP sockets
    duration: 30,          // 30 seconds
    amount: 1000,          // Total 1,000 requests
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": "Bearer MOCK_TEST_STUDENT_TOKEN",
    },
    body: JSON.stringify({
      sessionId: "mock-session-uuid",
      firstToken: "mock-valid-qr-1",
      secondToken: "mock-valid-qr-2",
      fingerprint: "test-fp-12345",
      location: { lat: 19.076, lng: 72.877, accuracy: 10 },
      faceMetrics: { confidence: 0.98 }
    }),
  });

  console.log(autocannon.printResult(result));
}

runBurstTest();
```

### 3. Acceptance Verification Metrics
When running the 1,000-request test:
| Metric | Target | Failure Threshold |
| :--- | :--- | :--- |
| **p95 Response Latency** | **< 150 ms** | > 500 ms |
| **p99 Response Latency** | **< 300 ms** | > 1,000 ms |
| **HTTP Error Rate (5xx)** | **0.00%** | > 0.1% |
| **Postgres Connections Used** | **< 12 connections** | > 40 connections |
| **Realtime Messages/Sec** | **< 2.5 msgs/sec** | > 20 msgs/sec |
| **Node.js Process Memory** | **< 180 MB** | > 450 MB (Free tier OOM) |

---

## Conclusion & Architectural Summary

By implementing this blueprint:
1. **Concurrency:** Ingestion shifts from synchronous database writes to **in-memory authorization + 60ms micro-batch upserts**, reducing DB calls by **97%**.
2. **Biometrics:** DeepFace shifts from a blocking bottleneck to **client-side MediaPipe vectorization** and an **out-of-band audit queue**, freeing up 100% of the server CPU during attendance.
3. **Database:** Traffic routes through **Supavisor Transaction Pooler (6543)** with targeted partial indexes, completely eliminating connection saturation.
4. **Realtime:** Attendance updates become an **asymmetric faculty-only broadcast** micro-batched at 600ms, using less than 10% of Supabase's free message and connection quotas.

The entire architecture operates comfortably within the **$0 free tiers** of Cloudflare Pages, Render, and Supabase while achieving true university-grade enterprise performance.
