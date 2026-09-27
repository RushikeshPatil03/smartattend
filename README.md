# SmartAttend — Real-Time Smart QR & Biometric Attendance Platform

A high-concurrency, zero-trust digital attendance management system that eliminates proxy marking in higher education through time-rotating cryptographic QR codes, dual-step scan verification, client-side biometric liveness checking, GPS geofencing, and hardware device fingerprinting.

---

## 📌 Overview

**SmartAttend** is a production-engineered attendance platform built to replace slow, error-prone paper roll calls and easily bypassed static QR solutions. Traditional digital attendance implementations are vulnerable to widespread proxy marking: students take screenshots of static QR codes to forward to absent peers via messaging apps, spoof GPS coordinates using developer settings, or share accounts across multiple physical devices.

SmartAttend mitigates these vectors through a **multi-factor physical presence verification engine**:
1. **Dynamic Cryptographic QR Codes**: QR codes rotate every 2–3 seconds with HMAC-SHA256 signatures, requiring a strict sequential two-step scan to prove real-time viewing of the classroom display.
2. **Ellipsoidal Haversine GPS Geofencing**: Validates the student's physical coordinates against the faculty's classroom anchor coordinates within a configurable radius (e.g., 50 meters).
3. **Hardware-Bound Device Fingerprinting**: Binds student accounts to a unique client device hash stored in persistent browser storage, rejecting multiple account logins from the same hardware.
4. **Biometric Face Verification & Randomized Liveness**: Executes client-side facial landmark detection (MediaPipe Vision BlazeFace) and randomized movement challenges (blink, head turn left, head turn right) via `face-api.js` before granting attendance. An optional Python FaceNet512 microservice is supported for deep embedding comparison.
5. **Storage-Optimized PostgreSQL Ledger**: Manages concurrent attendance rushes on Supabase PostgreSQL (Mumbai `ap-south-1`) via the Supavisor Transaction Pooler (`port 6543`), immutable session roster snapshots, and automated ephemeral data purge triggers.

---

## ✨ Features

### 🛡️ Multi-Layer Anti-Proxy & Security
- **Time-Rotating Dynamic QR**: Projector studio regenerates signed QR tokens every 2–3 seconds (`QR_TTL_SECONDS=3`) to prevent screenshots, screen recordings, and projector theft.
- **Two-Step Sequential Scan Validation**: Students scan two consecutive QR iterations within a tight sequence window (`QR_MAX_SEQUENCE_DRIFT=2`), ensuring live visual presence in class.
- **Single-Use Scan Grants**: Successful sequential scans issue a short-lived cryptographic scan grant (`SCAN_GRANT_TTL_MS=90000`) that is atomically consumed upon attendance marking.
- **In-Memory Double-Tap Protection**: Sliding window lock (`lock:${sessionId}:${studentId}`) prevents duplicate concurrent submissions from hitting the database layer.
- **Ellipsoidal Geofencing**: Computes Haversine distance with configurable threshold radius and mobile location accuracy filtering (`MAX_LOCATION_ACCURACY_METERS=120`).
- **Mobile Classroom Anchor Relay**: Faculty can generate a pairing QR on their laptop and scan it with their mobile phone to capture precise room GPS coordinates on-the-fly.
- **Hardware Device Locking**: Restricts account operation to one validated device per student; device change requests require selfie verification and faculty/admin approval.
- **Dual-Tier Face Verification**:
  - *Tier 1 (Client-Side Default)*: MediaPipe Tasks Vision + `face-api.js` runs randomized challenge-response liveness (blink, head rotation) and compares 1:1 facial descriptors locally without transmitting raw video frames over the wire.
  - *Tier 2 (Optional Microservice)*: Asynchronous FastAPI worker utilizing DeepFace (FaceNet512) for server-side 512-dimensional embedding validation.

### 🏛️ Administrator Portal
- **Institution Profile & Branding**: Secure management of institution name and official college logos stored in isolated, access-controlled Supabase Storage buckets.
- **Department & Subject Management**: Full CRUD operations for academic departments, degree years (1–4), semesters (1–8), and subject catalogs.
- **Faculty & Student Directory**: User provisioning with single-use, time-limited cryptographic registration invitation links.
- **Cohort Promotion & Bulk Operations**: Academic year promotions with enrollment preservation and automated soft-archival.
- **System Audits & Analytics**: System-wide attendance audit trail tracking IP, device fingerprints, verification methods, and geolocations.

### 👨‍🏫 Faculty Portal
- **Interactive Projector Studio**: High-contrast, large-format dynamic QR presentation interface with full-screen toggle, sequence counter, and fallback numeric TOTP.
- **Live Attendance Roster**: Instant attendee list powered by Supabase Realtime WebSocket broadcast events (`BATCH_MARKED`).
- **Immutable Session Roster Snapshots**: Freezes expected student cohorts at the instant of session creation, ensuring subsequent batch reassignments never alter historical records.
- **Batch Management**: Non-destructive, in-place batch updates with UUID preservation and soft-archival for referenced batches.
- **Exception Overrides & Matrix Editor**: Manual attendance override controls for authorized student exceptions with audit logging.
- **Export Capabilities**: CSV export and printable attendance reports with percentage breakdowns.

### 🎓 Student Portal
- **PWA Mobile Client**: Installable Progressive Web App with offline-first shell caching, auto-focus camera scanning, and haptic feedback.
- **Dual Verification Workflow**: Integrated dynamic QR scanner with automatic fallback to 6-digit TOTP codes for low-light or damaged projector displays.
- **Attendance Overview & Metrics**: Real-time subject-wise percentage analytics, session status indicators (present/absent), and eligibility warnings.
- **Hardware Transition Workflow**: Integrated device change request submission with selfie proof when replacing or upgrading hardware.

---

## 🏗️ System Architecture

```mermaid
flowchart TD
    subgraph ClientLayer ["Client Layer (Browsers & PWA)"]
        Admin["Admin Portal (Web)"]
        Faculty["Faculty Studio (Laptop / Desktop)"]
        FacultyPhone["Faculty Mobile (GPS Relay)"]
        Student["Student App (Mobile PWA)"]
    end

    subgraph CDN ["Edge & CDN"]
        CF["Cloudflare Pages (Global Edge CDN)<br/>Static Assets • Wasm Binaries • Face Models"]
    end

    subgraph Compute ["Compute Services"]
        NodeAPI["Node.js Express API (Render Singapore)<br/>Auth • Dynamic QR • Geo Validation • Micro-Batcher"]
        FaceService["Optional FaceNet512 Service (Python FastAPI)<br/>DeepFace Biometric Embedding Engine"]
    end

    subgraph DataLayer ["Data & Realtime (Supabase Mumbai ap-south-1)"]
        Pooler["Supavisor Transaction Pooler (Port 6543)"]
        DirectDB["PostgreSQL Direct Connection (Port 5432)"]
        Realtime["Supabase Realtime Engine (WebSockets)"]
        Storage["Supabase Storage (Branding & Profile Photos)"]
    end

    Admin -->|HTTPS| CF
    Faculty -->|HTTPS| CF
    Student -->|HTTPS| CF

    Admin -->|REST API| NodeAPI
    Faculty -->|REST API| NodeAPI
    FacultyPhone -->|Location Relay| NodeAPI
    Student -->|Scan & Mark Attendance| NodeAPI

    NodeAPI -->|High-Concurrency Queries| Pooler
    NodeAPI -->|DDL Migrations / Schema Sync| DirectDB
    NodeAPI -->|Broadcast 'BATCH_MARKED'| Realtime
    NodeAPI -.->|Async Biometric Verify| FaceService

    Realtime -->|Live Attendee Updates| Faculty
    NodeAPI -->|Store & Fetch Assets| Storage
```

---

## 🔄 Application Workflow

```mermaid
sequenceDiagram
    autonumber
    actor F as Faculty
    actor S as Student
    participant API as Node.js Express API
    participant DB as Supabase PostgreSQL
    participant RT as Supabase Realtime

    F->>API: POST /api/faculty/session/start (Subject, Location, Radius)
    API->>DB: INSERT into sessions & freeze session_roster_snapshots
    DB-->>API: Session ID & Active State
    API-->>F: Session initialized
    F->>F: Display Dynamic QR Studio (Rotates every 2-3s)

    Note over S: Student opens PWA within classroom
    S->>S: Validate local device fingerprint (IndexedDB)
    S->>S: Verify face & liveness challenge (MediaPipe + face-api.js)
    S->>API: POST /api/attendance/precheck (QR Token 1, Device Fingerprint)
    API-->>S: Step 1 Validated (Awaiting next sequence)
    S->>API: POST /api/attendance/mark (QR Token 2, GPS Coords, Scan Grant)

    rect rgb(240, 248, 255)
        Note over API: In-Memory Verification (< 3ms)
        API->>API: Validate HMAC-SHA256 signature & rotation window
        API->>API: Compute Haversine distance against faculty anchor
        API->>API: Check sliding window lock (prevent double tap)
    end

    API->>DB: Atomic Upsert into attendances table
    API-->>S: HTTP 200 OK ("Attendance Verified")
    API->>RT: Broadcast "BATCH_MARKED" event to session channel
    RT-->>F: Realtime roster update (Attendee count increments)
```

---

## 🛠️ Tech Stack

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Frontend Framework** | React 19, TypeScript, Vite | Modern component rendering, strict type safety, and fast HMR builds |
| **Styling & UI** | Tailwind CSS v4, Lucide React, Framer Motion | Modern styling, icon set, and smooth animations |
| **PWA & Offline** | `vite-plugin-pwa`, Service Workers | Mobile home screen installation, background caching, and offline shell delivery |
| **QR Engine** | `html5-qrcode`, BarcodeDetector API, `react-qr-code` | High-speed multi-frame video scanning and dynamic QR generation |
| **Client Biometrics** | `@mediapipe/tasks-vision` (BlazeFace), `face-api.js` | On-device face detection, randomized movement liveness, and 1:1 descriptor comparison |
| **Backend API** | Node.js (v20+), Express 4 | High-throughput REST API, cryptographic validation, and session orchestration |
| **Security & Utilities** | Helmet, Compression, CORS, JWT (`jsonwebtoken`), `bcryptjs` | Request security headers, response payload compression, token signing, and password hashing |
| **Database & Pooling** | Supabase PostgreSQL, Supavisor Pooler, `pg` driver | Relational storage with RLS, pg connection pooling (`port 6543`), and auto-purge triggers |
| **Realtime Engine** | Supabase Realtime (`ws` WebSockets) | Low-latency broadcast channels pushing live attendance updates to faculty dashboards |
| **Optional Microservice**| Python 3.10+, FastAPI, DeepFace, FaceNet512, Uvicorn | Dedicated worker for asynchronous high-dimensional facial embedding computation |
| **Edge Hosting** | Cloudflare Pages (Frontend), Render (Backend API) | CDN distribution for client assets and managed container execution for the API |

---

## 📂 Project Structure

```text
SmartAttendence/
├── public/                          # Static browser assets and biometric weights
│   ├── models/                      # face-api.js weights (tiny_face_detector, landmarks, recognition)
│   │   └── mediapipe/               # MediaPipe Wasm binaries & BlazeFace TFLite model
│   ├── favicon.svg                  # Application brand icons
│   └── manifest.webmanifest         # PWA installation descriptor
├── server/                          # Backend REST API (Node.js + Express)
│   ├── config/                      # Infrastructure connectors and environment loader
│   │   ├── env.js                   # Validated environment variable schema
│   │   ├── postgresPool.js          # pg connection pooler for direct queries
│   │   ├── supabase.js              # Supabase JS client factory (service_role)
│   │   └── supabase_schema.sql      # Database schema reference definition
│   ├── middleware/                  # HTTP interceptors
│   │   ├── adminAuth.js             # Strict administrator authorization guard
│   │   ├── auth.js                  # Multi-role JWT authenticator (Student, Faculty, Admin)
│   │   ├── authMiddleware.js        # Session header token parser
│   │   └── rateLimit.js             # Route-level in-memory rate limiting
│   ├── migrations/                  # Versioned DDL migration scripts
│   │   ├── 20260922_attendance_concurrency_idempotency.sql
│   │   ├── 20260922_security_rls_hardening.sql
│   │   └── 20260926_batch_roster_snapshots_backfill.sql
│   ├── routes/                      # API endpoint controllers
│   │   ├── activities.js            # Extracurricular activity session management
│   │   ├── admin.js                 # Admin management, departments, subjects, audits
│   │   ├── attendance.js            # Dynamic QR verification, TOTP submission, marking
│   │   ├── auth.js                  # Authentication, registration, token refresh, device changes
│   │   ├── department.js            # Department lookup and management
│   │   ├── faculty.js               # Faculty sessions, rosters, location capture
│   │   ├── public.js                # Public registration metadata and mobile GPS relay
│   │   ├── student.js               # Student profile, attendance metrics, active session checks
│   │   └── subject.js               # Subject catalog and batch allocation
│   ├── services/                    # Core business logic
│   │   ├── batchManagementService.js      # Non-destructive batch update engine
│   │   ├── deviceFingerprint.js           # Client device hash validator
│   │   ├── faceEmbeddingService.js        # FaceNet512 client and signature comparisons
│   │   ├── locationValidation.js          # Haversine distance and accuracy math
│   │   ├── qrService.js                   # HMAC-SHA256 dynamic QR generation and verification
│   │   ├── realtimeService.js             # Supabase Realtime broadcast dispatcher
│   │   ├── sessionRosterSnapshotService.js# Point-in-time cohort freezing logic
│   │   └── totpVerification.js            # Numeric fallback OTP engine
│   ├── index.js                     # Express server entry point, CORS, and health checks
│   ├── package.json                 # Backend dependencies and run scripts
│   └── run_supabase_migration.js    # Direct connection migration runner
├── src/                             # Frontend application (React 19 + TypeScript)
│   ├── components/                  # Reusable UI widgets
│   │   ├── CameraQrScanner.tsx      # Video scanner with BarcodeDetector and fallback
│   │   ├── CollegeHeader.tsx        # Institutional branding and logo display header
│   │   ├── DashboardBackground.tsx  # Dynamic role-tinted backdrop
│   │   ├── LivePhotoCapture.tsx     # Front-camera capture with face validation overlay
│   │   └── ProfileMenu.tsx          # Account settings and session termination menu
│   ├── pages/                       # Application views
│   │   ├── AdminDashboard.tsx       # Institutional governance, catalogs, and logs
│   │   ├── AdminRegister.tsx        # First-run admin initialization
│   │   ├── FacultyDashboard.tsx     # Dynamic QR studio, live rosters, batch manager
│   │   ├── Login.tsx                # Role-based credential and device authentication
│   │   ├── MobileLocationCapture.tsx# Faculty mobile phone GPS pairing relay
│   │   ├── Register.tsx             # Student and faculty token-based onboarding
│   │   └── StudentDashboard.tsx     # Student scanner, biometric verification, history
│   ├── routes/                      # Client routing and authorization wrappers
│   │   └── ProtectedRoute.tsx       # Client-side role and authentication gate
│   ├── services/                    # API clients and data stores
│   │   ├── apiClient.ts             # Central Axios/fetch abstraction with auto-refresh
│   │   ├── attendanceClient.ts      # Device fingerprint generation and storage
│   │   └── supabaseClient.ts        # Frontend Supabase client (anon key)
│   ├── utils/                       # Algorithmic helpers
│   │   ├── faceApiLoader.ts         # Lazy model loader for face-api.js weights
│   │   ├── faceMovementLiveness.ts  # Challenge-response liveness state machine
│   │   ├── liveLocation.ts          # Geolocation API wrapper with accuracy filters
│   │   └── mediaPipeFaceQuality.ts  # MediaPipe BlazeFace quality pre-checker
│   ├── App.tsx                      # Root route configuration and code-splitting
│   ├── index.css                    # Tailwind utility layer and design tokens
│   ├── index.tsx                    # Client DOM mounting
│   ├── store.tsx                    # React context global state provider
│   └── types.ts                     # TypeScript entity and payload interfaces
├── face-service/                    # Optional FaceNet512 microservice (Python + FastAPI)
│   ├── app.py                       # DeepFace FastAPI endpoint for 512-d embeddings
│   ├── Dockerfile                   # Microservice container definition
│   └── requirements.txt             # Python dependencies (DeepFace, FastAPI, Uvicorn)
├── scripts/                         # QA, security, and load verification suites
│   ├── download-face-models.cjs     # Automated downloader for MediaPipe & face-api assets
│   ├── generate-test-token.cjs      # Mock student/faculty JWT generator for testing
│   ├── load-test.cjs                # High-concurrency local load test runner
│   ├── test-batch-history-preservation.cjs # Batch immutability verification suite
│   ├── test-institution-profile.cjs # Institutional logo security & MIME suite (node --test)
│   └── verify-security-hardening.cjs# RLS, rate limiting, and secret validation suite
├── Dockerfile                       # Multi-stage production container for Node.js API
├── render.yaml                      # Render Blueprint Infrastructure-as-Code specification
├── supabase_schema.sql              # Master idempotent PostgreSQL database schema
├── package.json                     # Frontend build scripts and workspace dependencies
├── tsconfig.json                    # TypeScript compiler configuration
└── vite.config.ts                   # Vite configuration with PWA and Tailwind plugins
```

---

## ⚙️ Prerequisites

Before installing and running the system, ensure your environment meets the following specifications:

- **Node.js**: `v20.11.0` or higher (tested on Node.js 22 LTS)
- **Package Manager**: `npm` (v10+)
- **Database**: A [Supabase](https://supabase.com) project (Free or Pro tier)
  - Target region recommendation: `ap-south-1` (Mumbai) for low latency across South Asia
- **Python (Optional)**: Python `3.10+` with `pip` (only required if deploying the standalone `face-service`)
- **Web Browser**: Modern Chromium-based browser (Chrome, Edge, Brave), Firefox, or Safari with Camera and Geolocation permissions enabled

---

## 🚀 Installation

### 1. Clone Repository
```bash
git clone https://github.com/RushikeshPatil03/smartattend.git
cd smartattend
```

### 2. Install Frontend Dependencies
```bash
npm install
```

### 3. Install Backend Dependencies
```bash
cd server
npm install
cd ..
```

### 4. Download Biometric Model Weights
Download the pre-trained MediaPipe BlazeFace models and `face-api.js` weights to `public/models/`:
```bash
npm run models:download
```

---

## 🔐 Environment Variables

### Frontend Configuration (`.env`)
Create a `.env` file in the root directory:

| Variable | Description | Required | Example |
| :--- | :--- | :---: | :--- |
| `VITE_API_BASE_URL` | Base URL pointing to the backend API | Yes | `http://localhost:4000` |
| `VITE_SUPABASE_URL` | Supabase project URL (`https://<ref>.supabase.co`) | Yes | `https://xyzcompany.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Public Supabase Anonymous Key | Yes | `eyJhbGciOiJIUzI1NiIsInR5c...` |
| `VITE_QR_REFRESH_MS` | QR rotation refresh period in milliseconds | Optional | `2000` (default: 2000) |
| `VITE_SESSION_RADIUS_METERS`| Default classroom geofencing radius in meters | Optional | `50` (default: 50) |

```env
# Frontend Root .env
VITE_API_BASE_URL=http://localhost:4000
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
VITE_QR_REFRESH_MS=2000
VITE_SESSION_RADIUS_METERS=50
```

---

### Backend Configuration (`server/.env`)
Create a `.env` file in the `server/` directory:

| Variable | Description | Required | Example |
| :--- | :--- | :---: | :--- |
| `PORT` | Local port for Express API | Yes | `4000` |
| `NODE_ENV` | Application environment (`development` or `production`)| Yes | `development` |
| `FRONTEND_URL` | Allowed client URL for CORS origin resolution | Yes | `http://localhost:5173` |
| `CORS_ORIGINS` | Comma-separated list of allowed CORS origins | Yes | `http://localhost:5173,https://smartattend.app` |
| `SUPABASE_URL` | Supabase project URL | Yes | `https://your-project-ref.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Service Role Secret (bypasses RLS for API) | Yes | `eyJhbGciOi...` |
| `SUPABASE_ANON_KEY` | Public Supabase Anonymous Key | Yes | `eyJhbGciOi...` |
| `DATABASE_URL` | Supavisor Transaction Pooler connection (`port 6543`) | Yes | `postgresql://postgres.ref:[PASS]@pooler:6543/postgres` |
| `DIRECT_URL` | Direct PostgreSQL connection (`port 5432`) for migrations | Yes | `postgresql://postgres:[PASS]@db.ref.supabase.co:5432/postgres` |
| `PG_MAX_POOL_SIZE` | Maximum concurrent connections in `pg` pool | Optional | `10` (recommended for 512MB RAM tier) |
| `JWT_SECRET` | Cryptographic secret for signing access tokens (min 32 chars)| Yes | `your-secure-jwt-secret-at-least-32-chars` |
| `JWT_REFRESH_SECRET` | Cryptographic secret for signing refresh tokens | Yes | `your-secure-refresh-secret-at-least-32-chars` |
| `QR_SECRET` | Secret key for dynamic QR HMAC signatures | Yes | `your-secure-qr-secret-at-least-32-chars` |
| `QR_TTL_SECONDS` | Dynamic QR code validity window in seconds | Optional | `3` (default: 3) |
| `DEFAULT_SESSION_RADIUS_METERS`| Default classroom boundary in meters | Optional | `50` (default: 50) |
| `MAX_LOCATION_ACCURACY_METERS` | Maximum GPS inaccuracy accepted from mobile clients | Optional | `120` (default: 120) |
| `REQUIRE_FACE_VERIFICATION` | Enforce biometric verification check before mark | Optional | `false` (default: false) |
| `FACENET512_SERVICE_URL` | URL to optional Python FaceNet512 microservice | Optional | `http://localhost:8000` |

```env
# server/.env
PORT=4000
NODE_ENV=development
HOST=0.0.0.0
FRONTEND_URL=http://localhost:5173
CORS_ORIGINS=http://localhost:5173,http://localhost:3000

SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-secret-key
SUPABASE_ANON_KEY=your-supabase-anon-key

DATABASE_URL=postgresql://postgres.your-project-ref:[PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:6543/postgres
DIRECT_URL=postgresql://postgres:[PASSWORD]@db.your-project-ref.supabase.co:5432/postgres
PG_MAX_POOL_SIZE=10

JWT_SECRET=smart_attendance_jwt_secure_key_32chars_long_prod_ready
JWT_REFRESH_SECRET=smart_attendance_jwt_refresh_key_32chars_long_prod_ready
QR_SECRET=smart_attendance_qr_secret_rotation_key_32chars_long_prod

QR_TTL_SECONDS=3
DEFAULT_SESSION_RADIUS_METERS=50
MAX_LOCATION_ACCURACY_METERS=120
REQUIRE_FACE_VERIFICATION=false
```

---

## ▶️ Running the Project

### Development Mode

Open two terminal windows:

**Terminal 1 — Backend API:**
```bash
npm run server:dev
# Backend listens on http://localhost:4000
# Health check available at: http://localhost:4000/api/health
```

**Terminal 2 — Frontend Application:**
```bash
npm run dev
# Frontend dev server starts at http://localhost:5173
```

Open `http://localhost:5173` in your browser.

---

### Optional: Running the FaceNet512 Biometric Microservice

If you wish to utilize the deep learning server-side face embedding verification:

```bash
cd face-service
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8000
```

Update `server/.env`:
```env
FACENET512_SERVICE_URL=http://localhost:8000
FACENET512_DISTANCE_THRESHOLD=0.38
REQUIRE_FACE_VERIFICATION=true
```

---

## 🗄️ Database Setup

SmartAttend uses **Supabase PostgreSQL** as its unified transactional ledger and real-time state engine.

### 1. Apply Master Schema
1. Open your **Supabase Dashboard** -> **SQL Editor**.
2. Copy the entire contents of `supabase_schema.sql`.
3. Execute the SQL script. This will provision:
   - All core entity tables (`admins`, `departments`, `subjects`, `faculties`, `students`, `subject_assignments`, `registration_tokens`).
   - Transaction tables (`sessions`, `attendances`, `attendance_audits`, `device_change_requests`).
   - Ephemeral cache tables (`qr_states`, `totp_secrets`, `scan_grants`, `mobile_location_captures`, `refresh_tokens`).
   - Storage optimization triggers (`purge_expired_attendance_data()`, opportunistic cleanup on insertion).
   - Atomic RPC functions (`finalize_session_atomic`, `reserve_registration_slot`, `release_registration_slot`).
   - Row-Level Security (RLS) policies granting backend access via `service_role`.
   - Realtime publication enabling live events on `sessions`.

### 2. Apply Migrations (Programmatic)
To execute migrations programmatically against the Supabase direct connection (`DIRECT_URL`):
```bash
node server/run_supabase_migration.js
```

---

## 🔌 API Documentation

All routes (except `/api/public` and `/api/auth/login`) require a Bearer token in the `Authorization` header: `Authorization: Bearer <access_token>`.

### Authentication & Public (`/api/auth`, `/api/public`)
| Method | Endpoint | Purpose | Auth |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/login` | Authenticate with email, password, role, and device fingerprint | Public |
| `POST` | `/api/auth/refresh` | Issue a new 15-minute access token using an active refresh token | Public |
| `GET` | `/api/auth/me` | Fetch active user profile and institution metadata | Bearer |
| `POST` | `/api/auth/logout` | Revoke active refresh token and invalidate session | Bearer |
| `POST` | `/api/auth/device-change/request` | Submit student device change request with selfie proof | Public |
| `GET` | `/api/public/departments` | Fetch departments for public registration dropdown | Public |
| `POST` | `/api/public/mobile-location/:token`| Receive mobile coordinates for classroom location pairing | Public |

### Attendance Engine (`/api/attendance`)
| Method | Endpoint | Purpose | Auth |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/attendance/precheck` | Validate initial dynamic QR scan and device fingerprint | Student |
| `POST` | `/api/attendance/mark` | Complete two-step attendance marking with GPS and scan grant | Student |
| `POST` | `/api/attendance/totp` | Submit attendance via fallback 6-digit numeric TOTP code | Student |
| `POST` | `/api/attendance/face-verify` | Verify facial embedding against enrolled biometric template | Student |
| `GET` | `/api/attendance/session/:id/attendees` | Fetch real-time attendee list for active or past session | Faculty / Admin |
| `POST` | `/api/attendance/manual` | Manually mark or override student status with audit logging | Faculty / Admin |
| `POST` | `/api/attendance/matrix/batch-update` | Batch-update attendance records without data loss | Faculty / Admin |
| `GET` | `/api/attendance/audits` | Query immutable attendance verification audit logs | Faculty / Admin |

### Faculty Operations (`/api/faculty`)
| Method | Endpoint | Purpose | Auth |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/faculty/register` | Register faculty account using an administrative token | Public |
| `POST` | `/api/faculty/session/start` | Launch a new classroom session and project dynamic QR | Faculty |
| `POST` | `/api/faculty/session/:id/stop`| Atomically close session and compute attendance totals | Faculty |
| `POST` | `/api/faculty/session/:id/cancel`| Cancel an active session and discard temporary records | Faculty |
| `GET` | `/api/faculty/session/:id/qr` | Fetch current active dynamic QR seed and sequence state | Faculty |
| `POST` | `/api/faculty/location-capture/request`| Generate a pairing token to capture room GPS via phone | Faculty |
| `GET` | `/api/faculty/device-change-requests` | View student device change requests within department | Faculty |
| `POST` | `/api/faculty/device-change-requests/:id/review` | Approve or reject a student device change request | Faculty |

### Administration (`/api/admin`)
| Method | Endpoint | Purpose | Auth |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/admin/create-admin` | Bootstrap initial system administrator account | Public (First-run) |
| `POST` | `/api/admin/profile/logo` | Upload official institution logo to Supabase Storage | Admin |
| `PUT` | `/api/admin/profile` | Update institution name and administrator profile | Admin |
| `POST` | `/api/admin/generate-registration-link` | Generate single-use invite tokens for students/faculty | Admin |
| `GET` | `/api/admin/users` | List all users across departments with filtering | Admin |
| `POST` | `/api/admin/departments` | Create new academic department | Admin |
| `DELETE`| `/api/admin/departments/:id` | Delete department (with cascading checks) | Admin |
| `POST` | `/api/admin/subjects` | Create subject and map to departments/faculty | Admin |
| `POST` | `/api/admin/students/promote` | Promote student cohorts to next semester/year | Admin |
| `POST` | `/api/admin/attendance/purge` | Execute manual purge trigger for expired ephemeral data| Admin |

---

## 🔑 Authentication & Authorization

SmartAttend implements a **zero-trust authentication architecture**:

```
+-------------------------------------------------------------------------+
|                        JWT AUTHENTICATION LIFECYCLE                     |
+-------------------------------------------------------------------------+

  Login (POST /api/auth/login)
    │
    ├── Credentials Check (bcrypt hash comparison)
    ├── Device Fingerprint Check (Match registered hardware hash)
    └── Success Response:
          ├── Access Token (15-min TTL, stored in-memory / React state)
          └── Refresh Token (7-day TTL, stored in HTTP-Only / Secure storage)

  Subsequent Requests
    │
    ├── Authorization: Bearer <access_token>
    └── Middleware Verification:
          ├── Check token signature with JWT_SECRET
          ├── Extract user UUID and Role (STUDENT | FACULTY | ADMIN)
          └── Enforce role guard: auth(["FACULTY", "ADMIN"])

  Token Expiry Handling
    │
    ├── Client receives HTTP 401 Unauthorized
    ├── Interceptor calls POST /api/auth/refresh with refresh token
    └── Server checks `refresh_tokens` table, issues new access token
```

### Role-Based Access Control (RBAC)
- **`STUDENT`**: Restricted to reading own profile, viewing own attendance metrics, initiating scans against active sessions, and submitting device change requests.
- **`FACULTY`**: Authorized to create and control class sessions, view real-time attendee lists, manage subject batches, review department device change requests, and manually adjust attendance.
- **`ADMIN`**: Full administrative access across all institutional resources, department/subject catalogs, user provisioning, global branding, and audit records.

---

## 🛡️ Security Mechanisms

| Defense Layer | Threat Model Mitigated | Technical Implementation |
| :--- | :--- | :--- |
| **Rotating QR HMAC** | Screenshot sharing, projection recording, remote proxy | Tokens signed with `QR_SECRET` rotating every 2–3s with timestamp check and sequence verification (`crypto.timingSafeEqual`). |
| **Two-Step Sequential Scan** | Blind brute force, single lucky scan | Client must buffer and transmit two contiguous QR tokens matching the server's sequence window. |
| **Scan Grant Primitive** | Replay attacks, race conditions | Single-use grant token saved in `scan_grants` table and invalidated atomically upon first write. |
| **Sliding Window Double-Tap** | Rapid-fire multi-click race conditions | In-memory key `lock:${sessionId}:${studentId}` blocks parallel requests within 5 seconds with HTTP 409 Conflict. |
| **Haversine Geofencing** | Remote attendance marking | Mathematical verification: \(d = 2R \arcsin\left(\sqrt{\sin^2(\Delta\phi/2) + \cos\phi_1\cos\phi_2\sin^2(\Delta\lambda/2)}\right)\). Rejects if \(d > \text{radius}\) or accuracy exceeds 120m. |
| **Device Locking** | Account sharing, multi-phone proxy | Hardware canvas, screen, and browser parameters hashed into a SHA-256 fingerprint; mismatched hardware logins are rejected. |
| **Liveness Challenge** | Static photograph and video playback spoofing | Randomized interactive challenges (blink detection via EAR < 0.20, directional head turn) requiring verification within 3.0 seconds. |
| **Database RLS Policies** | Data leakage, IDOR vulnerabilities | Row Level Security enabled across all tables; client requests mediated strictly by Node.js API via `service_role`. |
| **Payload Limiting & Sanitization**| Denial of Service (DoS), buffer overflow | Standard JSON bodies restricted to 50KB; heavy biometric/image endpoints capped at 2MB via `express.json({ limit })`. |

---

## 📊 Database / Data Model

```mermaid
erDiagram
    admins ||--o{ departments : "manages"
    admins ||--o{ subjects : "creates"
    admins ||--o{ faculties : "provisions"
    admins ||--o{ students : "enrolls"
    admins ||--o{ registration_tokens : "issues"

    departments ||--o{ faculties : "contains"
    departments ||--o{ students : "contains"
    departments ||--o{ subject_assignments : "assigns"

    subjects ||--o{ subject_assignments : "mapped_in"
    faculties ||--o{ subject_assignments : "teaches"
    faculties ||--o{ sessions : "launches"

    sessions ||--o{ attendances : "records"
    sessions ||--o{ session_roster_snapshots : "freezes"
    sessions ||--o{ attendance_audits : "logs"

    students ||--o{ attendances : "marks"
    students ||--o{ session_roster_snapshots : "belongs_to"
    students ||--o{ device_change_requests : "submits"

    sessions ||--o| qr_states : "rotates"
    sessions ||--o| totp_secrets : "generates"
```

---

## 🧪 Testing & Load Verification

SmartAttend includes comprehensive native integration, security, and load testing suites.

### 1. Run Unit & Security Test Suites
```bash
# Verify institutional profile, image header validation, and IDOR protections (21 tests)
node --test scripts/test-institution-profile.cjs

# Verify batch management and historical session roster immutability (5 tests)
node scripts/test-batch-history-preservation.cjs

# Verify security headers, rate limiting, and secret enforcement
node scripts/verify-security-hardening.cjs

# Verify Supabase Realtime broadcast payload efficiency
node scripts/verify-realtime-optimization.cjs
```

### 2. High-Concurrency Load Simulation
The load testing framework (`scripts/load-test.cjs`) is designed with a native zero-dependency HTTP client. It includes a safety guard that **strictly blocks execution against remote production domains**.

```bash
# Dry-run test with built-in mock server (zero database dependency)
npm run test:load:dry

# Smoke test (100 requests, 10 concurrent clients)
npm run test:load:smoke

# Standard classroom rush (500 requests, 25 concurrent clients)
npm run test:load:standard

# Auditorium burst (1,000 requests, 50 concurrent clients)
npm run test:load:burst

# Concurrency race condition check (300 rapid duplicate submissions)
npm run test:load:concurrency
```

### 3. Static Type Analysis & Production Build
```bash
# Verify TypeScript strict type-checking
npx tsc --noEmit

# Execute Vite production bundle build
npm run build
```

---

## 🚢 Deployment

### 1. Frontend Deployment — Cloudflare Pages
The frontend is optimized for static edge deployment on Cloudflare Pages:
1. Connect your GitHub repository to **Cloudflare Pages**.
2. Set the build configuration:
   - **Framework Preset**: `Vite`
   - **Build Command**: `npm run build`
   - **Build Output Directory**: `dist`
3. Configure Environment Variables in the Cloudflare Dashboard:
   - `VITE_API_BASE_URL`: `https://smartattend-api-lpbx.onrender.com`
   - `VITE_SUPABASE_URL`: `https://your-project-ref.supabase.co`
   - `VITE_SUPABASE_ANON_KEY`: `your-supabase-anon-key`

---

### 2. Backend Deployment — Render
The backend is configured as an Infrastructure-as-Code service via `render.yaml`:
- **Region**: Singapore (`ap-southeast-1`) — chosen for low-latency network interconnects with Supabase Mumbai (`ap-south-1`).
- **Runtime**: `Node` (or Docker via provided `Dockerfile`).
- **Build Command**: `cd server && npm install`
- **Start Command**: `cd server && npm start`
- **Health Check Path**: `/api/health`

Alternatively, deploy using Docker:
```bash
docker build -t smartattend-api -f Dockerfile .
docker run -p 4000:4000 --env-file server/.env smartattend-api
```

---

## 💡 Troubleshooting & FAQ

### 1. `Device mismatch - unauthorized scan`
- **Cause**: The student is attempting to mark attendance from a phone, browser, or profile different from the hardware registered on their account.
- **Solution**: The student must submit a device change request via the login portal (`POST /api/auth/device-change/request`). A faculty member or admin can review the request and approve the new device fingerprint.

### 2. `Location coordinates out of range`
- **Cause**: Haversine calculation determined the distance between the student and faculty classroom coordinates exceeded the session boundary (e.g., 50 meters), or GPS accuracy was worse than `MAX_LOCATION_ACCURACY_METERS` (120 meters).
- **Solution**: Ensure GPS is enabled on the device with high-accuracy mode. In high-rise campus buildings, faculty can recalibrate the classroom anchor using the **Mobile Location Capture** QR pairing workflow.

### 3. `Registration token limit reached or token expired`
- **Cause**: Registration tokens are single-use (`max_uses=1`) by default and have an expiration timestamp.
- **Solution**: An administrator must generate a new registration link via **Admin Dashboard** -> **Generate Registration Link**.

### 4. `Database connection pool exhaustion`
- **Cause**: Too many direct connections opened against PostgreSQL port 5432 on the Supabase free tier (capped at 60 connections).
- **Solution**: Verify that `DATABASE_URL` in `server/.env` points to the **Supavisor Transaction Pooler** (`port 6543`), not the direct connection (`port 5432`). Keep `DIRECT_URL` strictly for schema migrations.

---

## 📈 Project Status & Roadmap

### Project Status: **Active — Production v2.4 (Enterprise Edition)**

- [x] Multi-factor dynamic rotating QR codes (HMAC-SHA256, 2–3s rotation)
- [x] Two-step sequential scan buffering and atomic scan grants
- [x] Haversine GPS geofencing with faculty mobile phone pairing relay
- [x] Persistent browser device fingerprinting with device change approvals
- [x] Client-side face quality detection (MediaPipe Vision) & randomized challenge liveness (`face-api.js`)
- [x] High-concurrency Supabase PostgreSQL ledger with Supavisor connection pooling
- [x] Immutable session roster snapshots & non-destructive batch management
- [x] Realtime attendee counter broadcasts via Supabase Realtime
- [x] Native integration, security, and load test suites
- [ ] Bluetooth Low Energy (BLE) beacon proximity validation *(Planned)*
- [ ] RFID / Turnstile campus perimeter gateway hardware sync *(Planned)*
- [ ] Offline biometric sync for air-gapped field training facilities *(Planned)*

---

## 🤝 Contributing

Contributions are welcome! Please follow these steps:
1. Fork the repository (`https://github.com/RushikeshPatil03/smartattend`).
2. Create a feature branch: `git checkout -b feature/amazing-feature`.
3. Verify all test suites pass:
   ```bash
   node --test scripts/test-institution-profile.cjs
   node scripts/test-batch-history-preservation.cjs
   npx tsc --noEmit
   npm run build
   ```
4. Commit your changes: `git commit -m 'feat: add amazing feature'`.
5. Push to the branch: `git push origin feature/amazing-feature`.
6. Open a Pull Request.

---

## 📄 License

The backend package (`server/package.json`) is distributed under the **MIT License**. No top-level standalone LICENSE file has been defined for the root repository.

---

## 👨‍💻 Author

**Rushikesh Patil**
- **Email**: `patilrushi527@gmail.com`
- **GitHub**: [@RushikeshPatil03](https://github.com/RushikeshPatil03)
- **Repository**: [RushikeshPatil03/smartattend](https://github.com/RushikeshPatil03/smartattend)

---

## ⭐ Acknowledgements

- [Google MediaPipe](https://developers.google.com/mediapipe) for browser-based Wasm facial landmark vision.
- [face-api.js](https://github.com/justadudewhohacks/face-api.js) for TensorFlow.js facial recognition models.
- [Supabase](https://supabase.com) for managed PostgreSQL, Supavisor connection pooling, and Realtime WebSocket infrastructure.
- [Cloudflare Pages](https://pages.cloudflare.com) & [Render](https://render.com) for edge hosting and API execution.
