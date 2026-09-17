# SmartAttend - Complete Project Documentation
## Part 1 of 3: Overview, Architecture, Database and API

> **Document Purpose:** This documentation is written for the entire development team,
> including members who may not understand every technology. It explains WHAT exists,
> WHY it exists, HOW it works, and WHERE each part fits. Suitable for team learning,
> academic viva preparation, project review, and future maintenance.
> All claims are verified from actual source code and labeled accordingly.

---

# 1. PROJECT OVERVIEW

## 1.1 What Is SmartAttend?

SmartAttend is a digital college attendance system that replaces slow, fraud-prone manual
roll calls with a multi-layered, technology-verified approach.

**The Core Problems Solved:**
- Manual attendance wastes 10-15 minutes per class period
- Proxy attendance (friends marking absent students as present) is very easy to commit
- Paper registers are hard to analyze, generate reports from, or audit

**How SmartAttend Solves This:**
1. Faculty starts an attendance session - a rotating QR code appears on screen (changes every 2 seconds)
2. Students scan the QR code on their registered mobile phone
3. System verifies all of these simultaneously:
   - Correct QR sequence (two consecutive scans - prevents screenshot fraud)
   - Student is physically inside classroom (GPS geofencing)
   - Student is using their registered device (device fingerprint)
   - Student's face matches their registration photo (face verification)
4. All verification happens in under 5 seconds
5. Faculty sees live updates as students mark attendance

**Confirmed from code:** Three user roles exist (Admin, Faculty, Student) each with dedicated
dashboards and permissions. Confirmed in src/App.tsx, src/routes/ProtectedRoute.tsx, and all
backend route files.

## 1.2 Target Users

| Role     | Who They Are              | What They Do                                                              |
|----------|---------------------------|---------------------------------------------------------------------------|
| Admin    | College administrator/HOD | Creates accounts, manages departments & subjects, views all attendance    |
| Faculty  | Professor/Lecturer        | Starts sessions, displays QR, views live attendance, reviews device reqs  |
| Student  | College student           | Scans QR to mark attendance, views history, requests device changes       |

## 1.3 Key Features (All Confirmed from Code)

| Feature                          | Source File                                  | Description                                      |
|----------------------------------|----------------------------------------------|--------------------------------------------------|
| Dynamic rotating QR codes        | server/services/qrService.js                 | JWT-signed QR changes every 2 seconds            |
| Two-step QR scan validation      | qrService.js → validateTwoStepQR()           | Must scan TWO consecutive QRs - anti-screenshot  |
| TOTP backup attendance           | server/services/totpVerification.js          | 6-digit time code as QR alternative              |
| Face verification (on-device)    | server/services/faceVerification.js          | 256-hex facial landmark signature matching       |
| Face verification (AI service)   | face-service/app.py                          | FaceNet512 deep learning embedding comparison    |
| GPS geofencing                   | server/services/locationValidation.js        | Haversine formula classroom boundary check       |
| Device fingerprint binding       | server/services/deviceFingerprint.js         | One account per registered device                |
| Real-time attendance updates     | server/services/realtimeService.js           | Faculty sees live updates via Supabase Broadcast |
| Device change request flow       | server/routes/auth.js                        | Student selfie + faculty approval workflow       |
| Registration via invite token    | server/routes/auth.js + supabase_schema.sql  | Admin-generated one-time invite links            |
| JWT auth with token rotation     | server/services/tokenService.js              | 15-min access + 90-day refresh with rotation     |
| Role-based access control        | server/middleware/auth.js                    | Per-route role enforcement                       |
| Attendance analytics             | src/pages/AdminDashboard.tsx                 | Reports and per-student statistics               |
| PWA support                      | vite.config.ts                               | Installable on mobile like native app            |
| Mobile location capture          | server/services/mobileLocationCapture.js     | Faculty can use phone GPS via QR token relay     |

---

# 2. TECHNOLOGY STACK

## 2.1 Frontend Technologies

| Technology            | Version | Evidence                          | Purpose in Project                         |
|-----------------------|---------|-----------------------------------|--------------------------------------------|
| React                 | 19.2.4  | package.json                      | Complete UI framework                      |
| TypeScript            | 5.8.2   | package.json + all .tsx files     | Type-safe language (prevents bugs)         |
| Vite                  | 6.2.0   | package.json + vite.config.ts     | Ultra-fast dev server and build tool       |
| Tailwind CSS          | 4.3.3   | package.json                      | Utility-first CSS (rapid styling)          |
| React Router          | 7.18.2  | package.json + App.tsx            | Client-side page navigation                |
| Framer Motion         | 13.1.0  | package.json                      | Smooth page and element animations         |
| Lucide React          | 0.554.0 | package.json                      | Modern SVG icon library                    |
| html5-qrcode          | 2.3.8   | CameraQrScanner.tsx               | Camera-based QR code reading               |
| react-qr-code         | 2.0.18  | LiveSessionStudio.tsx             | Renders QR code image for faculty display  |
| @mediapipe/tasks-vision| 0.10.35| mediaPipeFaceQuality.ts           | On-device real-time face detection         |
| @supabase/supabase-js | 2.49.1  | src/services/supabaseClient.ts    | Supabase Realtime live subscription client |
| @simplewebauthn/browser| 13.3.0 | package.json                      | WebAuthn passkey support (browser-side)    |
| vite-plugin-pwa       | 1.3.0   | vite.config.ts                    | Service worker + PWA installability        |

## 2.2 Backend Technologies (Node.js Server)

| Technology              | Version     | Evidence                    | Purpose in Project                         |
|-------------------------|-------------|-----------------------------|--------------------------------------------|
| Node.js                 | (runtime)   | server/package.json         | JavaScript runtime for backend             |
| Express.js              | 4.21.2      | server/index.js             | HTTP server and route framework            |
| @supabase/supabase-js   | 2.49.1      | server/config/supabase.js   | Database access via Supabase SDK           |
| jsonwebtoken (JWT)      | 9.0.2       | tokenService.js qrService.js| Signs and verifies all JWT tokens          |
| bcrypt / bcryptjs       | 6.0.0/3.0.3 | server/routes/auth.js       | Secure password hashing (dual-library fallback) |
| helmet                  | 8.3.0       | server/index.js             | Sets secure HTTP response headers          |
| cors                    | 2.8.5       | server/index.js             | Cross-origin request control               |
| compression             | 1.8.1       | server/index.js             | Gzip response compression for performance  |
| pg                      | 8.23.0      | server/config/db.js         | Direct PostgreSQL connection driver        |
| dotenv                  | 16.3.1      | server/config/env.js        | Loads environment variables from .env      |
| nodemon                 | 3.0.1       | package.json (devDeps)      | Auto-restart server on file changes (dev)  |

## 2.3 Python Face AI Microservice

| Technology          | Version    | Evidence                       | Purpose                             |
|---------------------|------------|--------------------------------|-------------------------------------|
| FastAPI             | 0.115.6    | face-service/requirements.txt  | Serves /embed and /health endpoints |
| DeepFace            | 0.0.93     | face-service/app.py            | Wraps FaceNet512 neural network     |
| Uvicorn             | 0.32.1     | face-service/requirements.txt  | ASGI server that runs FastAPI       |
| OpenCV (headless)   | 4.10.0.84  | face-service/requirements.txt  | Image decoding and preprocessing    |
| tf-keras            | 2.18.0     | face-service/requirements.txt  | Deep learning backend for FaceNet   |

## 2.4 Database and Infrastructure

| Technology              | Evidence                             | Purpose                                   |
|-------------------------|--------------------------------------|-------------------------------------------|
| Supabase PostgreSQL      | supabase_schema.sql + supabase.js    | Primary database (16 tables, all data)    |
| Supabase Realtime        | server/services/realtimeService.js   | Live attendance event broadcasting        |
| Socket.IO               | server/sockets/createSocket.js       | Real-time session viewer count tracking   |
| Redis (optional)         | server/services/redisClient.js       | Socket.IO adapter for horizontal scaling  |

> **CRITICAL INCONSISTENCY:** docker-compose.yml contains a mongodb-clone service.
> The actual application uses Supabase PostgreSQL ONLY - there is ZERO MongoDB usage
> anywhere in the active code. The docker-compose is a LEGACY ARTIFACT from an earlier
> version. Do NOT mention MongoDB in presentations or documentation.

## 2.5 Deployment Infrastructure

| Platform         | What Is Deployed                | Evidence                       |
|------------------|----------------------------------|--------------------------------|
| Render.com       | Node.js backend API              | render.yaml                    |
| Cloudflare Pages | React frontend app               | .env.example comment           |
| Docker           | All three services (Dockerfiles) | Dockerfile in root, server/, face-service/ |
| PM2              | Node.js process management       | ecosystem.config.cjs           |
| Nginx            | Reverse proxy                    | nginx.conf                     |

---

# 3. COMPLETE FOLDER STRUCTURE

```
SmartAttendence/                     [Project Root]
|
|-- src/                             [Frontend - React + TypeScript]
|   |-- App.tsx                      Root component + routing setup (209 lines)
|   |-- main.tsx                     React DOM entry point (connects React to HTML)
|   |-- store.tsx                    Global state management - Context API (882 lines)
|   |-- types.ts                     Shared TypeScript type definitions
|   |-- index.css                    Global CSS styles
|   |
|   |-- components/                  [Reusable UI Components]
|   |   |-- AppLogo.tsx              Application logo/brand component
|   |   |-- CameraQrScanner.tsx      QR camera scanning component (35KB - complex)
|   |   |-- CollegeHeader.tsx        College branding header with logo
|   |   |-- Common.tsx               Shared UI: buttons, cards, modals, inputs (14KB)
|   |   |-- CountUp.tsx              Animated number counter component
|   |   |-- DashboardBackground.tsx  Role-specific animated background
|   |   |-- ErrorBoundary.tsx        React crash recovery wrapper
|   |   |-- HeaderBar.tsx            Top navigation bar component
|   |   |-- IntegratedAttendanceScanner.tsx  Combined QR+face+GPS scanner (29KB)
|   |   |-- LivePhotoCapture.tsx     Live camera face capture component (41KB)
|   |   +-- ProfileMenu.tsx          User profile dropdown menu (18KB)
|   |
|   |-- pages/                       [Full-Page Route Components]
|   |   |-- Login.tsx                Login page for all roles (40KB)
|   |   |-- Register.tsx             Student/Faculty registration page (35KB)
|   |   |-- AdminRegister.tsx        Admin account creation page (15KB)
|   |   |-- AdminDashboard.tsx       Admin control panel (92KB - LARGEST FILE)
|   |   |-- FacultyDashboard.tsx     Faculty interface (70KB)
|   |   |-- StudentDashboard.tsx     Student interface (76KB)
|   |   |-- ManageDepartments.tsx    Department management page
|   |   |-- ManageSubjectsCatalog.tsx Subject catalog management (48KB)
|   |   |-- MobileLocationCapture.tsx Mobile GPS capture page
|   |   +-- faculty/                 [Faculty-Specific Sub-Components]
|   |       |-- LiveSessionStudio.tsx  MAIN: QR display + live tracking (116KB)
|   |       |-- SessionSetupCard.tsx   Session configuration form (29KB)
|   |       |-- AttendanceRosterTable.tsx Live attendance roster (52KB)
|   |       |-- ClassSummaryReportModal.tsx Session end report modal
|   |       |-- DeviceRequestsView.tsx Device change request review (25KB)
|   |       |-- FacultyAnalyticsModal.tsx Analytics and statistics view
|   |       |-- ManageSubjectsView.tsx Subject management for faculty
|   |       +-- types.ts             Faculty-specific TypeScript types
|   |
|   |-- routes/
|   |   +-- ProtectedRoute.tsx       Role-based route authentication guard
|   |
|   |-- services/                    [Frontend API Communication Layer]
|   |   |-- apiClient.ts             ALL backend HTTP API calls (17KB - central client)
|   |   |-- attendanceClient.ts      Attendance API + device fingerprint generation (10KB)
|   |   |-- facultySession.ts        Faculty session management API calls
|   |   |-- sequentialQrBuffer.ts    QR token two-step buffering logic
|   |   +-- supabaseClient.ts        Supabase Realtime channel subscriptions (5KB)
|   |
|   +-- utils/                       [Frontend Utility Functions]
|       |-- clientFaceVerification.ts  Client-side face verification coordinator
|       |-- dataCache.ts             TTL-based in-memory + localStorage caching
|       |-- faceApiLoader.ts         face-api.js model loader + descriptor matching (20KB)
|       |-- faceMovementLiveness.ts  Anti-spoofing: head movement/blink detection (12KB)
|       |-- faceSignature.ts         256-hex face signature from facial landmarks (3KB)
|       |-- imageCapture.ts          Camera snapshot utility
|       |-- liveLocation.ts          GPS coordinate capture + continuous watch (11KB)
|       |-- mediaPipeFaceQuality.ts  MediaPipe real-time face quality assessment (5KB)
|       +-- totpQrGenerator.ts       Client-side TOTP 6-digit token generation (4KB)
|
|-- server/                          [Backend - Node.js]
|   |-- index.js                     Server entry: Express + CORS + routes (336 lines)
|   |
|   |-- config/
|   |   |-- db.js                    Direct PostgreSQL connection configuration
|   |   |-- env.js                   Typed + validated environment variable loader (180 lines)
|   |   |-- supabase.js              Supabase client factory (singleton pattern)
|   |   +-- supabase_schema.sql      Database schema (mirror of root-level file)
|   |
|   |-- routes/                      [Express Route Handlers]
|   |   |-- auth.js                  Login/logout/refresh/device change (812 lines)
|   |   |-- admin.js                 Admin-only operations (32KB)
|   |   |-- faculty.js               Faculty operations + session management (67KB)
|   |   |-- student.js               Student registration + profile (18KB)
|   |   |-- attendance.js            Attendance marking - QR TOTP scan-grant (84KB)
|   |   |-- department.js            Department CRUD operations (4.6KB)
|   |   |-- subject.js               Subject CRUD + allotment (14KB)
|   |   +-- public.js                Public endpoints - token validation health check
|   |
|   |-- middleware/                  [Express Middleware]
|   |   |-- auth.js                  JWT verify + DB lookup + RBAC (105 lines)
|   |   |-- adminAuth.js             Admin-specific auth shortcut
|   |   |-- authMiddleware.js        Auth middleware alias/wrapper
|   |   +-- rateLimit.js             In-memory rate limiter (69 lines)
|   |
|   |-- services/                    [Business Logic Services]
|   |   |-- qrService.js             QR generation + 2-step validation (257 lines)
|   |   |-- tokenService.js          JWT access/refresh issuance + rotation (185 lines)
|   |   |-- faceVerification.js      Face matching: signature + AI fallback (177 lines)
|   |   |-- faceEmbeddingService.js  FaceNet512 AI service HTTP client
|   |   |-- locationValidation.js    Haversine GPS geofencing (249 lines)
|   |   |-- totpVerification.js      TOTP attendance token system (369 lines)
|   |   |-- realtimeService.js       Supabase Broadcast micro-batching (251 lines)
|   |   |-- deviceFingerprint.js     Device fingerprint normalization
|   |   |-- mobileLocationCapture.js Mobile GPS relay token service
|   |   |-- sessionLifecycle.js      Session start/stop helper functions
|   |   |-- studentTodayAttendance.js Today's attendance query service
|   |   +-- redisClient.js           Optional Redis connection client
|   |
|   |-- sockets/
|   |   +-- createSocket.js          Socket.IO setup for live session rooms (139 lines)
|   |
|   |-- models/                      [Data Shape Definitions - 11 files]
|   |   |-- Admin.js                 Admin model schema
|   |   |-- Faculty.js               Faculty model schema
|   |   |-- Student.js               Student model schema
|   |   |-- Attendance.js            Attendance record schema
|   |   |-- AttendanceAudit.js       Audit log schema
|   |   |-- Department.js            Department schema
|   |   |-- DeviceChangeRequest.js   Device change request schema
|   |   |-- RegistrationToken.js     Registration token schema
|   |   |-- Session.js               Session schema
|   |   |-- Subject.js               Subject schema
|   |   +-- SubjectAssignment.js     Assignment schema
|   |
|   +-- utils/
|       +-- getLocalIP.js            Local network IP detection utility
|
|-- face-service/                    [Python AI Microservice]
|   |-- app.py                       FastAPI server with /embed and /health (85 lines)
|   |-- requirements.txt             Python package dependencies
|   +-- Dockerfile                   Container configuration
|
|-- supabase_schema.sql              Complete database schema SQL (676 lines)
|-- package.json                     Frontend project manifest
|-- vite.config.ts                   Vite build and PWA configuration
|-- render.yaml                      Render.com deployment specification
|-- docker-compose.yml               Docker development environment
|-- nginx.conf                       Nginx reverse proxy configuration
+-- ecosystem.config.cjs             PM2 process manager configuration
```

---

# 4. SYSTEM ARCHITECTURE

## 4.1 Architectural Patterns Used

| Pattern                  | Applied | Where in Project                                      |
|--------------------------|---------|-------------------------------------------------------|
| Client-Server            | YES     | Frontend communicates with Backend via REST API       |
| Layered Architecture     | YES     | Routes → Middleware → Services → Database             |
| REST API                 | YES     | All /api/* endpoints follow REST conventions          |
| Component-Based Frontend | YES     | React components with clear responsibilities          |
| Real-time Architecture   | YES     | Supabase Broadcast + Socket.IO for live updates       |
| Microservice (partial)   | YES     | Python face service is a separate deployable process  |
| PWA                      | YES     | vite-plugin-pwa adds service worker for offline/install|

## 4.2 Architecture Flow Diagram

```
USERS (Three types)
  Admin (Desktop Browser) ---+
  Faculty (Laptop/Browser) --+--> FRONTEND (React PWA)
  Student (Mobile Browser) --+    Cloudflare Pages: smartattend.app
                                  |
                        [Code-Split Lazy Pages]
                        Login | Register | AdminDash | FacultyDash | StudentDash
                                  |
                         [src/services/apiClient.ts]
                         Central HTTP API Client
                                  |
                          HTTPS REST Requests
                                  |
                                  v
                        BACKEND (Node.js Express)
                        Render.com: smartattend-api-lpbx.onrender.com
                        Port 4000 (dev) / 10000 (production)
                                  |
              [Global Middleware]
              CORS + Helmet + Compression + Body Parser + Rate Limiter
                                  |
              [Route Handlers]
              /api/auth | /api/attendance | /api/faculty
              /api/admin | /api/student | /api/department | /api/subject
                                  |
              [Auth Middleware: server/middleware/auth.js]
              JWT verify -> DB lookup -> Role check -> req.user
                                  |
              [Service Layer]
              qrService | tokenService | faceVerification
              locationValidation | totpVerification | realtimeService
                                  |
              [Supabase JS Client - Service Role Key]
                                  |
                                  v
                        SUPABASE POSTGRESQL
                        Mumbai region: ap-south-1
                        16 tables | RLS enabled | Realtime enabled
                        Auto-purge triggers | Atomic RPC functions
                                  |
                    [Supabase Realtime Broadcast]
                    Channel: session:<sessionId>
                    Event: BATCH_MARKED
                                  |
                                  v
              Faculty Browser [src/services/supabaseClient.ts]
              Receives live attendance updates
              
Optional: Face AI path
              /api/attendance/mark
                    |
                    v [when FACENET512_SERVICE_URL is set]
              PYTHON FACE SERVICE (FastAPI)
              Port 8000
              POST /embed -> DeepFace.represent() -> FaceNet512 embedding
              Cosine similarity comparison -> match/no-match
```

## 4.3 Data Flow for Attendance Marking

This is the most critical flow in the system:

```
Student opens app -> Authentication already done (JWT in localStorage)
-> Student dashboard shows "Join Session" or "Scan QR"
-> Student taps scan button
-> Camera opens
-> Student scans QR Code #1 (token stored in sequentialQrBuffer.ts)
-> App waits for QR to rotate (~2 seconds)
-> Student scans QR Code #2
-> App simultaneously:
   - Reads GPS coordinates (liveLocation.ts)
   - Captures face image (LivePhotoCapture.tsx or IntegratedAttendanceScanner.tsx)
   - Runs face-api.js local face matching (faceApiLoader.ts)
   - Gets device fingerprint (attendanceClient.ts)
-> POST /api/attendance/mark {
     firstQrToken, secondQrToken,
     lat, lng, accuracy,
     fingerprint,
     faceMatch (true/false from local comparison),
     faceMetrics (confidence score),
     liveFaceImageDataUrl (optional - for FaceNet512)
   }
-> Backend processes:
   1. JWT auth -> student identity confirmed
   2. Both QR tokens decoded and validated
   3. Session lookup -> verify active
   4. Cohort check -> student belongs to this session's class
   5. GPS check -> Haversine distance < classroom radius
   6. Device check -> fingerprint matches registered device
   7. Face check -> signature comparison OR AI service comparison
   8. INSERT INTO attendances -> UNIQUE constraint blocks duplicates (409)
   9. broadcastAttendance() -> Supabase Realtime micro-batch
-> Faculty's LiveSessionStudio.tsx receives BATCH_MARKED event
-> Faculty's attendance roster updates in real time
-> Student sees "Attendance Marked Successfully!" confirmation
```

---

# 5. DATABASE DOCUMENTATION

## 5.1 Database Overview

- **Technology:** PostgreSQL (relational, ACID-compliant)
- **Host:** Supabase managed cloud - Mumbai region (ap-south-1)
- **Client Library:** @supabase/supabase-js v2
- **Backend Key:** SUPABASE_SERVICE_ROLE_KEY (full access, bypasses Row Level Security)
- **Frontend Key:** SUPABASE_ANON_KEY (limited by RLS policies)
- **Extensions:** uuid-ossp (UUID generation), pgcrypto (crypto functions)
- **Total Tables:** 16 (all defined in supabase_schema.sql)
- **Total Schema Lines:** 676

## 5.2 Core Entity Tables (5 main entities)

### TABLE 1: admins
Purpose: College administrator accounts. Admins create and manage all other users.

| Column           | Type         | Required | Unique | Description                    |
|------------------|--------------|----------|--------|--------------------------------|
| id               | UUID         | YES (PK) | YES    | Auto-generated UUID identifier |
| name             | VARCHAR(120) | YES      | NO     | Full name of admin             |
| email            | VARCHAR(255) | YES      | YES    | Login email address            |
| password_hash    | VARCHAR(255) | YES      | NO     | Bcrypt hashed password         |
| college_name     | VARCHAR(255) | YES      | NO     | College name for branding      |
| profile_photo_url| TEXT         | NO       | NO     | URL to college logo image      |
| created_at       | TIMESTAMPTZ  | YES      | NO     | Auto-set creation timestamp    |
| updated_at       | TIMESTAMPTZ  | YES      | NO     | Auto-set update timestamp      |

Index: idx_admins_email ON admins(lower(email)) - enables case-insensitive fast login lookup

---

### TABLE 2: departments
Purpose: Academic departments within a college (e.g., Computer Science, Electronics).

| Column          | Type         | Required | Description                  |
|-----------------|--------------|----------|------------------------------|
| id              | UUID         | YES (PK) | Unique department ID         |
| name            | VARCHAR(120) | YES      | Full department name         |
| code            | VARCHAR(30)  | YES      | Short code e.g. "CS"         |
| created_by_admin| UUID (FK)    | YES      | References admins.id         |
| created_at      | TIMESTAMPTZ  | YES      | Creation timestamp           |
| updated_at      | TIMESTAMPTZ  | YES      | Update timestamp             |

Unique: UNIQUE(name, code, created_by_admin) - prevents duplicate departments per admin

---

### TABLE 3: subjects
Purpose: Academic subjects/courses with year and semester binding.

| Column             | Type         | Required | Description                          |
|--------------------|--------------|----------|--------------------------------------|
| id                 | UUID         | YES (PK) | Unique subject ID                    |
| name               | VARCHAR(150) | YES      | Subject name                         |
| code               | VARCHAR(30)  | YES      | Subject code                         |
| year               | SMALLINT     | YES      | Academic year (1-4, enforced)        |
| semester           | SMALLINT     | YES      | Semester number (1-8, enforced)      |
| departments        | UUID[]       | YES      | Array of department IDs              |
| allotted_faculties | UUID[]       | YES      | Array of faculty IDs who teach this  |
| created_by_admin   | UUID (FK)    | YES      | References admins.id                 |

Special: PostgreSQL array columns UUID[] with GIN indexes enable fast "is X in array?" queries.

---

### TABLE 4: faculties
Purpose: Faculty/professor accounts linked to a department and a registered device.

| Column             | Type         | Required | Description                          |
|--------------------|--------------|----------|--------------------------------------|
| id                 | UUID         | YES (PK) | Unique faculty ID                    |
| name               | VARCHAR(120) | YES      | Faculty full name                    |
| email              | VARCHAR(255) | YES UNIQ | Login email                          |
| password_hash      | VARCHAR(255) | YES      | Bcrypt hashed password               |
| profile_photo_url  | TEXT         | NO       | Faculty profile photo URL            |
| department         | UUID (FK)    | YES      | References departments.id            |
| device_fingerprint | VARCHAR(128) | YES      | Browser fingerprint of registered device |
| device_lock_enabled| BOOLEAN      | YES      | Whether device lock is enforced      |
| created_by_admin   | UUID (FK)    | YES      | References admins.id                 |
| allotted_subjects  | UUID[]       | YES      | Subjects this faculty teaches        |

---

### TABLE 5: students
Purpose: Student accounts with complete academic info and biometric data for verification.

| Column                 | Type         | Required | Description                               |
|------------------------|--------------|----------|-------------------------------------------|
| id                     | UUID         | YES (PK) | Unique student ID                         |
| name                   | VARCHAR(120) | YES      | Student full name                         |
| email                  | VARCHAR(255) | YES UNIQ | Login email                               |
| password_hash          | VARCHAR(255) | YES      | Bcrypt password hash                      |
| enrollment_no          | VARCHAR(50)  | YES UNIQ | College roll/enrollment number            |
| year                   | SMALLINT     | YES      | Academic year (1-4)                       |
| semester               | SMALLINT     | YES      | Current semester (1-8)                    |
| section                | VARCHAR(20)  | YES      | Class section (e.g., "A", "B")            |
| department             | UUID (FK)    | YES      | References departments.id                 |
| device_fingerprint     | VARCHAR(128) | YES      | Registered device browser fingerprint     |
| college_name           | VARCHAR(255) | NO       | Inherited from admin's college            |
| profile_photo_url      | TEXT         | NO       | Face registration photo URL               |
| face_signature         | TEXT         | NO       | 256-char hex facial landmark signature    |
| face_signature_mirror  | TEXT         | NO       | Mirror-image face signature (robustness)  |
| face_signature_version | VARCHAR(32)  | NO       | Signature algorithm version string        |
| face_embedding         | JSONB        | NO       | FaceNet512 embedding vector (float array) |
| face_embedding_model   | VARCHAR(50)  | NO       | Model name used for embedding             |
| registered_via_token   | VARCHAR(128) | YES      | The invite token used during registration |
| created_by_admin       | UUID (FK)    | YES      | References admins.id                      |

Key Index: idx_students_cohort ON students(created_by_admin, department, year, semester, section)
This composite index enables fast cohort matching when checking if a student belongs to a session's class.

## 5.3 Relational Tables

### TABLE 6: subject_assignments
Purpose: The "join table" that connects faculty to specific class sections for specific subjects.

Why this exists: A subject may be taught by different faculty to different sections.
E.g.: Prof. A teaches "Database Systems" to CS Year 2 Section A
      Prof. B teaches "Database Systems" to CS Year 2 Section B
      (They're the same subject but different assignments)

| Column          | Type        | Description                                       |
|-----------------|-------------|---------------------------------------------------|
| id              | UUID (PK)   | Unique assignment ID                              |
| subject         | UUID (FK)   | Which subject is being assigned                   |
| faculty         | UUID (FK)   | Which faculty teaches it                          |
| department      | UUID (FK)   | Which department's students                       |
| year            | SMALLINT    | Academic year of the class                        |
| semester        | SMALLINT    | Semester of the class                             |
| section         | VARCHAR(20) | Class section (A, B, C, etc.)                     |
| class_code      | VARCHAR(50) | Unique identifier for this specific class         |
| created_by_admin| UUID (FK)   | Which admin created this assignment               |

### TABLE 7: registration_tokens
Purpose: One-time or limited-use invite links that admin generates for new users to register.

| Column     | Type         | Description                                    |
|------------|--------------|------------------------------------------------|
| id         | UUID (PK)    | Token record ID                                |
| token      | VARCHAR(128) UNIQUE | The actual shareable token string       |
| type       | VARCHAR(20)  | 'student' or 'faculty'                         |
| admin_id   | UUID (FK)    | Which admin generated it                       |
| expires_at | TIMESTAMPTZ  | Expiry time (NULL means never expires)         |
| max_uses   | INT          | Maximum number of registrations allowed        |
| uses_count | INT          | How many times it has been used so far         |
| is_active  | BOOLEAN      | Whether the token is still usable              |

## 5.4 Attendance and Session Tables

### TABLE 8: sessions
Purpose: One session = one class lecture period where attendance is being taken.

| Column           | Type         | Description                                    |
|------------------|--------------|------------------------------------------------|
| id               | UUID (PK)    | Unique session ID                              |
| faculty          | UUID (FK)    | Faculty who started this session               |
| subject          | UUID (FK)    | Subject being taught                           |
| department       | UUID (FK)    | Target department (whose students attend)      |
| year             | SMALLINT     | Target academic year                           |
| semester         | SMALLINT     | Target semester                                |
| section          | VARCHAR(20)  | Target class section                           |
| start_time       | TIMESTAMPTZ  | When the session was started                   |
| end_time         | TIMESTAMPTZ  | When it ended (NULL if still active)           |
| last_activity_at | TIMESTAMPTZ  | Last database activity timestamp               |
| location         | JSONB        | {lat: float, lng: float, radiusMeters: float}  |
| is_active        | BOOLEAN      | True while session is running                  |

CRITICAL: CREATE UNIQUE INDEX uq_active_session_per_faculty ON sessions(faculty)
          WHERE (is_active = true)
This partial unique index ensures a faculty member can ONLY have ONE active session at a time.
If they try to start a second one, the database rejects it.

### TABLE 9: attendances
Purpose: Each row = one student marked present (or absent) in one session.

| Column           | Type         | Description                                    |
|------------------|--------------|------------------------------------------------|
| id               | UUID (PK)    | Unique attendance record ID                    |
| session          | UUID (FK)    | Which session this record belongs to           |
| student          | UUID (FK)    | Which student                                  |
| faculty          | UUID (FK)    | Which faculty was teaching                     |
| subject          | UUID (FK)    | Which subject                                  |
| timestamp        | TIMESTAMPTZ  | Exact time attendance was marked               |
| status           | VARCHAR(20)  | 'present' or 'absent'                          |
| location         | JSONB        | Student's GPS coordinates at marking time      |
| device_fingerprint| VARCHAR(128) | Device fingerprint used to mark                |
| face_verification | JSONB        | {ok, score, threshold, model, note}            |

CRITICAL: UNIQUE(session, student) - a student can be marked ONCE per session.
Attempting to mark again returns HTTP 409 Conflict.

### TABLE 10: attendance_audits
Purpose: Complete audit trail for all attendance actions (marking, session stops, device approvals).
Contents: action, method (QR/TOTP/MANUAL), actor_role, actor_id, device, location, QR info, face result.
Auto-purged: Records older than 90 days are deleted automatically to protect 500MB free-tier quota.

### TABLE 11: device_change_requests
Purpose: Students who switch phones submit a change request with their selfie photo. Faculty reviews.

| Column                          | Type         | Description                      |
|---------------------------------|--------------|----------------------------------|
| id                              | UUID (PK)    | Unique request ID                |
| student                         | UUID (FK)    | Requesting student               |
| department                      | UUID (FK)    | Student's department             |
| old_device_fingerprint          | VARCHAR(128) | Current registered device        |
| requested_device_fingerprint    | VARCHAR(128) | New device to be approved        |
| selfie_data_url                 | TEXT         | Base64 encoded selfie photo      |
| status                          | VARCHAR(20)  | pending/approved/rejected/expired|
| expires_at                      | TIMESTAMPTZ  | 24 hours from creation           |
| reviewed_by                     | UUID (FK)    | Faculty who reviewed it          |
| review_note                     | TEXT         | Faculty's comment on decision    |

Validation: Selfie must be < 700KB. Only one request per 24 hours per student.
Auto-expires: Pending requests older than 24 hours are marked 'expired'.

## 5.5 Ephemeral Tables (Temporary - Auto-Cleaned)

These tables store short-lived data and are automatically cleaned when data expires.

| Table Name                | Contents                              | Cleaned After          |
|---------------------------|---------------------------------------|------------------------|
| qr_states                 | QR token rotation history per session | 15 minutes past expiry |
| totp_secrets              | TOTP session secret keys              | 15 minutes past expiry |
| scan_grants               | 2-step QR pre-authorization tokens   | 5 minutes past expiry  |
| mobile_location_captures  | Faculty phone GPS relay tokens        | 10 minutes past expiry |
| refresh_tokens            | JWT refresh token hashes              | On token expiry        |

Auto-cleanup is handled by:
1. PostgreSQL AFTER INSERT triggers that delete expired records
2. purge_expired_attendance_data() RPC function callable from backend on demand

## 5.6 Critical Atomic Functions

These PostgreSQL stored procedures execute multiple operations as one atomic transaction.
This is important to prevent data corruption when multiple requests arrive simultaneously.

finalize_session_atomic(p_session_id, p_faculty_id):
  Purpose: Safely end a session
  Step 1: Lock session row exclusively (FOR UPDATE) - prevents race conditions
  Step 2: Verify faculty ownership
  Step 3: If already inactive, return idempotent response
  Step 4: UPDATE sessions SET is_active=false, end_time=now()
  Step 5: COUNT present attendees
  Step 6: INSERT into attendance_audits
  Step 7: Return complete result
  All steps in ONE transaction - cannot be partially completed.

reserve_registration_slot(p_token_id):
  Purpose: Safely claim one use of an invite token
  Atomically increments uses_count
  Marks token inactive if uses_count >= max_uses
  Returns failure if token expired or exhausted
  Prevents race condition where 2 students use same single-use token simultaneously

## 5.7 Row Level Security (RLS) Policies

All 16 tables have RLS enabled.

Backend (service_role key): Full access to all tables - enforced at application level.
Frontend (anon key): Limited access:
  - sessions: Can SELECT where is_active = true (for Realtime subscriptions)
  - attendances: Can SELECT (for viewing history)
  - All other tables: No direct access

---

# 6. API DOCUMENTATION

## 6.1 API Basics

- **Base URL (Development):** http://localhost:4000
- **Base URL (Production):** https://smartattend-api-lpbx.onrender.com
- **All endpoints prefixed with:** /api/
- **Authentication:** Authorization: Bearer <access_token> (JWT)
- **Access Token TTL:** 15 minutes
- **Refresh Token TTL:** 90 days (HttpOnly cookie, auto-rotated)
- **Body Size Limits:** 50KB default, 8MB for photo-heavy endpoints
- **Standard Success Response:** { "ok": true, ...data }
- **Standard Error Response:** { "ok": false, "error": "human-readable message" }

## 6.2 Authentication Routes (/api/auth)

### POST /api/auth/login
Purpose: Authenticate any user and receive JWT tokens.
Auth Required: None
Rate Limit: 20 requests per 15 minutes per IP+email combination

Request Body:
{
  "role": "STUDENT",                    // "ADMIN", "FACULTY", or "STUDENT"
  "email": "student@college.edu",
  "password": "mypassword",
  "fingerprint": "device-fingerprint"   // Required for STUDENT always, for FACULTY if device_lock_enabled
}

Success Response (HTTP 200):
{
  "ok": true,
  "token": "<access_jwt>",
  "accessToken": "<access_jwt>",
  "expiresIn": "15m",
  "user": {
    "id": "uuid",
    "name": "John Doe",
    "email": "john@college.edu",
    "role": "STUDENT",
    "enrollmentNo": "CS2021001",
    "collegeName": "ABC Engineering College",
    "profilePhotoUrl": "https://...logo...",
    "studentProfilePhotoUrl": "data:image/..."
  }
}
Also sets "refreshToken" as HttpOnly cookie (path: /api/auth).

Error Responses:
- HTTP 400: Missing credentials or missing device fingerprint
- HTTP 401: Wrong password or user not found
- HTTP 401: Device fingerprint mismatch (wrong device)
- HTTP 429: Too many login attempts (rate limited)

---

### POST /api/auth/refresh
Purpose: Exchange refresh token for a new access+refresh token pair.
Auth Required: RefreshToken cookie (or body.refreshToken)
Process: Validates old refresh token -> revokes it -> issues new token pair (token rotation)
Response: Same format as login response

---

### GET /api/auth/me
Purpose: Get authenticated user's latest profile data.
Auth Required: Bearer token
Response: { "ok": true, "user": { id, name, email, role, collegeName, ... } }

---

### POST /api/auth/logout
Purpose: Revoke refresh token and clear cookie.
Auth Required: None (reads cookie internally)
Always returns: { "ok": true }
Note: Idempotent - safe to call multiple times

---

### POST /api/auth/device-change/verify-student
Purpose: Step 1 of device change - verify student identity before requesting change.
Request: { "email": "...", "password": "..." }
Response: { "ok": true, "verifyToken": "<short-lived-jwt>", "expiresInSeconds": 600, "student": {...} }

---

### POST /api/auth/device-change/request
Purpose: Step 2 of device change - submit new device fingerprint with selfie proof.
Request: { "verifyToken": "...", "fingerprint": "new-device-fingerprint", "selfieDataUrl": "data:image/..." }
Validations: verifyToken must be valid, selfie < 700KB, only 1 request per 24 hours, new device not already bound to another account
Response: { "ok": true, "request": { "id": "...", "status": "pending" } }

---

## 6.3 Attendance Routes (/api/attendance)

### POST /api/attendance/mark
Purpose: Student marks their attendance for the current active session.
Auth Required: STUDENT bearer token
Body Size Limit: 8MB (contains face images)

Request Body:
{
  "firstQrToken": "<jwt>",              // First QR scan
  "secondQrToken": "<jwt>",             // Second QR scan (must be different from first)
  "lat": 18.5204,                       // GPS latitude
  "lng": 73.8567,                       // GPS longitude
  "accuracy": 12,                       // GPS accuracy in meters
  "fingerprint": "device-fingerprint",  // Current device fingerprint
  "faceMatch": true,                    // Result from local face-api.js comparison
  "faceMetrics": { "confidence": 0.92 },// Metrics from local comparison
  "liveFaceImageDataUrl": "data:image/..." // Optional: for FaceNet512 AI verification
}

Backend Validation Steps (confirmed from attendance.js):
1. JWT auth -> confirms student identity
2. Two QR tokens must be different (prevents sending same token twice)
3. Both tokens must decode to same sessionId
4. Session must exist and be active
5. Student must belong to session's cohort (year, semester, section, department, admin)
6. Student GPS must be within classroom boundary (Haversine + tolerance)
7. GPS accuracy must be < 30 meters (configurable)
8. Device fingerprint must match student's registered fingerprint
9. Face verification must pass (signature match or AI match)
10. INSERT attendance (UNIQUE constraint blocks duplicates -> HTTP 409)
11. Broadcast to faculty via Supabase Realtime

Success: { "ok": true, "attendance": { "id": "uuid", "session": "uuid", "student": "uuid", "status": "present" } }
HTTP 409: Already marked present in this session (idempotent - show success to user)
HTTP 422: GPS outside boundary / poor accuracy / face mismatch - specific error message
HTTP 403: Device fingerprint mismatch

---

### GET /api/attendance/active-session
Purpose: Check if there's a current active session for the student's class.
Auth Required: STUDENT bearer token
Matching: Finds sessions where department+year+semester+section+admin match student's enrollment
Response: { "ok": true, "session": { ...sessionData, "qr": "<current-qr-token>" } }
       or { "ok": false, "error": "No active session found" }

---

### GET /api/attendance/qr/:sessionId
Purpose: Get the current rotating QR token for a session (for faculty display).
Auth Required: FACULTY bearer token
Response: { "ok": true, "qr": "<jwt>", "rotationSeconds": 2, "nextRefreshInMs": 1750 }

---

### POST /api/attendance/totp
Purpose: Alternative attendance method using 6-digit TOTP code.
Auth Required: STUDENT bearer token
Request: { "sessionId": "uuid", "totpCode": "123456" }
Process: Validates TOTP code using HMAC-based block index computation
Response: Same as /mark

---

## 6.4 Faculty Routes (/api/faculty)

### POST /api/faculty/sessions/start
Purpose: Faculty starts a new attendance session for their class.
Auth Required: FACULTY bearer token

Request Body:
{
  "subjectId": "uuid",
  "departmentId": "uuid",
  "location": { "lat": 18.52, "lng": 73.85, "radiusMeters": 50 },
  "year": 2,
  "semester": 4,
  "section": "A"
}

Validations:
- Faculty must be allotted to this subject (checks subject_assignments table)
- Faculty must not have an existing active session
- Location GPS coordinates required

Response: {
  "ok": true,
  "session": { ...sessionData },
  "qr": "<initial-qr-token>",
  "secretKey": "abc123",     // For TOTP generation - shown to faculty, not stored raw
  "totalStudents": 45
}

---

### POST /api/faculty/sessions/:id/stop
Purpose: Faculty ends the active session.
Auth Required: FACULTY bearer token
Process: Calls finalize_session_atomic() PostgreSQL RPC for atomic, race-condition-safe stop
Response: { "ok": true, "session": {...}, "attendeeCount": 38 }

---

### GET /api/faculty/sessions/:id/roster
Purpose: Full attendance roster showing who attended and who didn't.
Auth Required: FACULTY bearer token
Response: List of all students in cohort with their attendance status for this session

---

### GET /api/faculty/device-requests
Purpose: View pending device change requests for students in faculty's department.
Auth Required: FACULTY bearer token
Response: List of pending requests with student info and selfie photos

---

### PUT /api/faculty/device-requests/:id/approve
Purpose: Faculty approves student's device change request.
Auth Required: FACULTY bearer token
Effect: Updates student.device_fingerprint to the requested_device_fingerprint in database

---

## 6.5 Admin Routes (/api/admin)

| Method | Path                              | Purpose                                    |
|--------|-----------------------------------|--------------------------------------------|
| POST   | /api/admin/registration-token     | Generate student or faculty invite link    |
| GET    | /api/admin/users                  | List all faculty and students              |
| PUT    | /api/admin/faculty/:id/device-lock| Enable or disable device lock for faculty  |
| GET    | /api/admin/attendance             | Query attendance records with filters      |
| PUT    | /api/admin/attendance/:id         | Manually update attendance status          |
| DELETE | /api/admin/attendance/:id         | Remove an attendance record                |
| GET    | /api/admin/sessions               | List all sessions with filters             |
| PUT    | /api/admin/profile                | Update college name and logo               |

## 6.6 CRUD Routes (Department, Subject, Student)

| Method | Path                     | Auth  | Purpose                          |
|--------|--------------------------|-------|----------------------------------|
| GET    | /api/department          | Any   | List all departments             |
| POST   | /api/department          | ADMIN | Create new department            |
| PUT    | /api/department/:id      | ADMIN | Update department                |
| DELETE | /api/department/:id      | ADMIN | Delete department (cascades)     |
| GET    | /api/subject             | Any   | List all subjects                |
| POST   | /api/subject             | ADMIN | Create new subject               |
| POST   | /api/subject/:id/allot   | ADMIN | Assign subject to faculty+class  |
| DELETE | /api/subject/:id         | ADMIN | Delete subject                   |
| POST   | /api/student/register    | None  | Register student with invite     |
| GET    | /api/public/reg-token/:t | None  | Validate registration invite     |
| GET    | /api/health              | None  | Server health check              |

---

# 7. AUTHENTICATION AND AUTHORIZATION

## 7.1 Complete Login Flow

1. User fills login form (email, password, role selector)
2. Frontend reads device fingerprint from IndexedDB (or generates new one)
3. Frontend sends POST /api/auth/login
4. Backend fetches user from correct table (admins/faculties/students)
5. bcrypt.compare(entered_password, stored_hash) -> password check
6. For Student/Faculty: normalizeFingerprint(sent_fp) compared with student.device_fingerprint
7. If all checks pass:
   a. Generate Access Token (JWT, 15min): {id, role, email, type:"access"}
   b. Generate Refresh Token (JWT, 90d): {id, role, email, name, jti, type:"refresh"}
   c. Store refresh token in memory + Supabase as SHA-256 hash
   d. Set refreshToken HttpOnly cookie (path:/api/auth, secure in production)
8. Return { accessToken, user } in response body
9. Frontend stores user in localStorage and accessToken for API calls
10. Frontend navigates to /admin, /faculty, or /student based on role

## 7.2 Per-Request Authentication (auth.js middleware)

Every protected endpoint runs through auth.js middleware:

1. Read Authorization header: "Bearer <token>"
2. jwt.verify(token, JWT_SECRET) - fails if expired or tampered
3. Decoded payload: { id, role, email }
4. SELECT from appropriate table (admins/faculties/students) WHERE id = decoded.id
5. If user not found in DB: 401 Unauthorized
6. Check decoded.role is in the route's allowed roles array
7. If role not allowed: 403 Forbidden
8. Set req.user, req.userRole, req.userId
9. Call next() - request proceeds to route handler

## 7.3 Refresh Token Security (Token Rotation)

Security model: When refresh token is used, old one is REVOKED and new one issued.

Why this matters:
- If attacker steals refresh token and uses it once -> they get a new access token
- But now the legitimate user's next request will find their refresh token already revoked
- This signals a potential token theft incident

Implementation in tokenService.js:
1. rotateRefreshToken(token) -> verify JWT signature
2. getRefreshRecord(jti) -> find stored hash in DB
3. Compare hashToken(token) with stored record.tokenHash
4. If mismatch -> throw "Refresh token revoked"
5. revokeRefreshToken(jti) -> delete from memory + Supabase
6. issueFor(user) -> generate brand new token pair

## 7.4 Device Fingerprint System

Purpose: Ensure one physical device per account. Prevents sharing login credentials.

Frontend (attendanceClient.ts):
- Generated from browser hardware characteristics
- Stored in IndexedDB (persistent, not accessible via localStorage or cookies)
- Sent with every login and attendance marking request

Backend (deviceFingerprint.js):
- normalizeFingerprint() - cleans and normalizes the fingerprint string
- legacyFingerprintHash() - supports older fingerprint format for backward compatibility

Enforcement Rules:
- Students: ALWAYS enforced. Different device = login blocked. Must request device change.
- Faculty: Enforced only when device_lock_enabled = true (admin can disable this).
- Admin: No device fingerprint checking at all.

## 7.5 Frontend Route Guards

ProtectedRoute.tsx wraps each dashboard:
- Checks currentUser from store (loaded from localStorage on app start)
- Verifies currentUser.role matches required roles
- If not authenticated: redirect to /login
- If wrong role: redirect to /login

App.tsx routing structure:
  /         -> RootRedirect (based on role)
  /login    -> Login page (public)
  /register -> Register page (public)
  /admin    -> AdminDashboard (ADMIN only, protected)
  /faculty  -> FacultyDashboard (FACULTY only, protected)
  /student  -> StudentDashboard (STUDENT only, protected)
  *         -> Redirect to /login (catch-all)

## 7.6 Rate Limiting

Implemented in rateLimit.js using in-memory token bucket algorithm:

- Per endpoint, configurable: prefix, windowMs, max attempts
- Login: 20 attempts per 15 minutes per IP+email combination
- Uses Map() in Node.js process memory
- Cleanup runs every 30 seconds (automatic timer)
- Returns HTTP 429 with Retry-After header

Limitation: Rate limit state is in-memory only. Server restart resets all counters.
            Not shared across multiple server processes (use Redis adapter for multi-process).

---

*End of Part 1 of 3*
*Continue to Part 2 for: Feature Workflows, Frontend State Management, Security Analysis, Real-time System*
*Continue to Part 3 for: Deployment Guide, Technology Glossary, Common Q&A for Viva*
