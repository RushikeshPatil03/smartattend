# SmartAttend - Smart QR Attendance System with Face Recognition & Geolocation

A secure, web-based attendance management system for educational institutions that combines rotating dynamic QR codes, browser-side face verification, device fingerprint validation, GPS/location geofencing, and real-time dashboards to eliminate proxy attendance and automate institutional attendance records.

The project is designed as a complete institutional workflow: administrators configure departments, subjects, faculty, students, and registration access; faculty create and monitor controlled attendance sessions; students scan dynamic QR codes from validated devices within the geofenced classroom radius and complete identity verification; and attendance records are stored and tracked through a centralized Supabase PostgreSQL ledger.

---

## Production Architecture

The SmartAttend production deployment leverages a modern cloud architecture designed for high concurrency, security, and low operational overhead:

- **Frontend**: Vite + React 19 + TypeScript + PWA deployed on **Cloudflare Pages**.
- **Backend API**: Node.js + Express deployed on **Render** (Region: Singapore / South Asia).
- **Database**: **Supabase PostgreSQL** (hosted in Mumbai `ap-south-1`) connecting via the Supavisor Transaction Pooler (`port 6543`) for runtime operations, and direct connections (`port 5432`) for DDL schema migrations.
- **Real-Time Synchronization**: **Supabase Realtime** for instant attendance roster updates and live session attendee counts.
- **Face Verification**: Client-side face quality checks (MediaPipe Tasks Vision) and face recognition (`face-api.js` loaded from local static assets) by default.
- **Optional FaceNet512 Service**: Standalone Python FastAPI microservice utilizing DeepFace for 512-dimensional face embeddings when `FACENET512_SERVICE_URL` is configured.

```text
                           Admin / Faculty / Student Browser (PWA)
                                             |
                      +----------------------+----------------------+
                      |                                             |
                      v                                             v
        Cloudflare Pages (Frontend CDN)                 Render (Node.js API)
     React 19 | PWA | MediaPipe | face-api       Auth | QR Validation | GPS Check
                      |                                             |
                      +----------------------+----------------------+
                                             |
                                             v
                                  Supabase (Mumbai ap-south-1)
                      PostgreSQL Database (Port 6543) | Supabase Realtime
                                             |
                                             v (Optional)
                                 FaceNet512 Python Microservice
                                      FastAPI + DeepFace
```

---

## Core Features & Workflow

### 1. Multi-Layer Anti-Proxy Verification
| Layer | Mechanism | Purpose |
|---|---|---|
| Dynamic Rotating QR | Time-limited tokens (rotating every 2–3s) with cryptographic HMAC signatures | Eliminates screenshot sharing, forwarding, and projection theft |
| Two-Step QR Scan | Sequential pair verification with anti-replay guarantees | Prevents accidental single scans and brute-force token generation |
| Device Fingerprinting | Client-side hardware/browser signature stored in IndexedDB with device-lock | Restricts attendance marking to the student's authorized device |
| GPS Geofencing | Haversine distance validation against faculty session coordinates (e.g. 50m radius) | Ensures student is physically present inside the designated classroom |
| Face Verification | Local MediaPipe face detection + face-api feature matching (optional FaceNet512) | Verifies the physical presence of the enrolled student |
| Realtime Session Ledger | Atomic session state and frozen roster snapshots | Ensures historical attendance integrity across batch modifications |

### 2. Role-Based Capabilities
- **Administrator**:
  - Secure institutional onboarding and branding management (college name and logo stored in isolated storage).
  - Department and subject catalog management.
  - Faculty and student directory with time-limited registration links.
  - Device change request review and approval workflows.
  - System-wide attendance audit logs and analytics.
- **Faculty**:
  - Subject and activity session creation with custom geofence radius.
  - Dynamic QR Studio with real-time attendee counters powered by Supabase Realtime.
  - Attendance roster history with point-in-time snapshot preservation.
  - Batch management with non-destructive in-place updates and historical soft-archival.
  - Mobile classroom location capture via QR pairing.
  - Manual attendance marking for approved exceptions.
- **Student**:
  - Secure login with device binding.
  - Camera-based dynamic QR scanner with auto-focus and fallback detection.
  - Automated GPS coordinate verification and face verification.
  - Real-time today's attendance status and cumulative attendance metrics.
  - Device change request submission when upgrading hardware.

---

## Technology Stack

| Layer | Technologies |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, Vite PWA |
| UI & Icons | Lucide React, Framer Motion, HTML5 Audio, Canvas API |
| Camera & QR | html5-qrcode (fallback), BarcodeDetector API, react-qr-code |
| Face Verification (Default) | MediaPipe Tasks Vision (BlazeFace), face-api.js |
| Face Verification (Optional) | Python, FastAPI, DeepFace, FaceNet512 |
| Backend API | Node.js (v20+), Express, Helmet, Compression, CORS, JWT, bcrypt / bcryptjs |
| Database & Realtime | Supabase PostgreSQL, Supavisor Connection Pooler (port 6543), pg, Supabase Realtime (ws) |
| Hosting & Deployment | Cloudflare Pages (Frontend), Render (Backend API) |

---

## Repository Structure

```text
SmartAttendence/
  ├── src/                       # Frontend application (React 19 + Vite)
  │   ├── components/            # UI components (QR scanner, camera, modals, headers)
  │   ├── pages/                 # Admin, Faculty, and Student dashboards and routes
  │   ├── services/              # Supabase client, API client, and session services
  │   └── utils/                 # Face loaders, live location, logger, and cache helpers
  ├── server/                    # Backend API (Node.js + Express)
  │   ├── config/                # Supabase client, PostgreSQL pooler, and environment config
  │   ├── middleware/            # JWT authentication, admin auth, and rate limiters
  │   ├── migrations/            # SQL migration scripts for schema updates
  │   ├── routes/                # API route handlers (auth, admin, faculty, student, attendance)
  │   └── services/              # QR crypto, batch management, snapshots, and location checks
  ├── public/                    # Static assets, web app manifest, icons, and face-api models
  ├── face-service/              # Optional Python FaceNet512 microservice (DeepFace)
  ├── scripts/                   # Automated integration, security, and load test suites
  ├── render.yaml                # Render Infrastructure-as-Code deployment configuration
  └── Dockerfile                 # Production container image for backend API
```

---

## Setup & Local Development

### Prerequisites
- Node.js 20 or later
- npm
- Supabase project (URL and API keys)
- Python 3.10+ (only if running the optional FaceNet512 service)

### 1. Install Dependencies
```bash
# Install frontend dependencies
npm install

# Install backend dependencies
cd server
npm install
cd ..
```

### 2. Configure Environment Variables
Create `.env` in the project root:
```env
VITE_API_BASE_URL=http://localhost:4000
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
VITE_QR_REFRESH_MS=2000
VITE_SESSION_RADIUS_METERS=50
```

Create `server/.env`:
```env
PORT=4000
NODE_ENV=development
HOST=0.0.0.0
FRONTEND_URL=http://localhost:5173

# Supabase Credentials
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
SUPABASE_ANON_KEY=your-supabase-anon-key

# PostgreSQL Connection String (Supavisor Transaction Pooler, Port 6543)
DATABASE_URL=postgresql://postgres.your-project-ref:[PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:6543/postgres

# Security Secrets (minimum 32 characters)
JWT_SECRET=your-secure-jwt-secret-min-32-chars-long
QR_SECRET=your-secure-qr-secret-min-32-chars-long

# Attendance Parameters
QR_TTL_SECONDS=3
DEFAULT_SESSION_RADIUS_METERS=50
MAX_LOCATION_ACCURACY_METERS=120
REQUIRE_FACE_VERIFICATION=false
```

### 3. Run Development Servers
```bash
# Start backend server (port 4000)
npm run server:dev

# In a separate terminal, start frontend dev server (port 5173)
npm run dev
```

---

## Optional FaceNet512 Python Service

When advanced 512-dimensional facial embedding comparison is required, start the Python microservice:

```bash
cd face-service
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8000
```

Enable it in `server/.env`:
```env
FACENET512_SERVICE_URL=http://localhost:8000
FACENET512_VERSION=facenet512-v1
FACENET512_DISTANCE_THRESHOLD=0.38
REQUIRE_FACE_VERIFICATION=true
```

---

## Testing & Quality Assurance

Run the automated integration and security test suites:

```bash
# Test batch management & attendance history preservation
node scripts/test-batch-history-preservation.cjs

# Test institution profile and logo security
node --test scripts/test-institution-profile.cjs

# Run TypeScript compiler check
npx tsc --noEmit

# Run production build
npm run build
```

---

## Production Deployment

### Cloudflare Pages (Frontend)
- **Framework Preset**: Vite
- **Build Command**: `npm run build`
- **Build Output Directory**: `dist`
- **Environment Variables**: `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

### Render (Backend API)
- The backend is configured via `render.yaml`:
  - **Runtime**: Node
  - **Build Command**: `cd server && npm install`
  - **Start Command**: `cd server && npm start`
  - **Health Check Path**: `/api/health`
