# Smart QR Based Attendance System with Face Recognition

A secure, web-based attendance management system for educational institutions that combines dynamic QR codes, face verification, device validation, GPS/location checks, and real-time dashboards to reduce proxy attendance and automate academic attendance records.

The project is designed as a complete institutional workflow: administrators manage departments, subjects, users, and registration links; faculty create controlled attendance sessions; students scan session-specific QR codes and complete identity/location verification; and attendance records are stored, monitored, and reported through a centralized system.

## Project Summary

Traditional attendance systems are time-consuming, error-prone, and vulnerable to proxy attendance. Manual roll calls reduce classroom time, while simple QR attendance systems can be misused through screenshots, shared codes, or attendance marking from unauthorized locations.

This project solves those limitations through a multi-layer verification model. A faculty member starts an attendance session, the system generates short-lived dynamic QR data, and a student must scan the QR code from a valid device, pass location validation, and complete face verification before attendance is recorded. The system also provides real-time monitoring, analytics, and report support for academic record maintenance.

## Objectives

- Automate classroom attendance using QR-based attendance sessions.
- Reduce proxy attendance through dynamic QR tokens, device validation, location verification, and face matching.
- Provide separate role-based dashboards for admin, faculty, and student users.
- Store attendance data securely in a structured database.
- Enable faculty to monitor live attendance during active sessions.
- Generate useful attendance records for academic analysis and institutional reporting.
- Build a scalable foundation that can be extended for mobile apps, cloud deployment, and advanced analytics.

## Core Features

### Admin

- Secure admin registration and login.
- Department and subject management.
- Student and faculty account management.
- Controlled registration links for onboarding users.
- Subject allocation and academic structure configuration.
- Faculty/student monitoring and attendance analytics.
- Device change request visibility and control.

### Faculty

- Role-based faculty login.
- Subject-wise attendance session creation.
- Dynamic QR generation for active sessions.
- Mobile classroom location capture.
- Real-time attendance dashboard using Socket.IO.
- Attendance history and analytics.
- Manual attendance update support for valid exceptional cases.

### Student

- Student registration through authorized registration links.
- Secure login with device fingerprint support.
- QR scanning through browser camera access.
- Two-step QR validation for stronger anti-reuse protection.
- GPS/location based attendance validation.
- Live face capture and verification.
- Today's attendance status and recent attendance history.
- Device change request flow when a registered device changes.

## Security and Anti-Proxy Design

The system is intentionally designed with multiple verification layers because attendance fraud is rarely solved by one check alone.

| Layer | Purpose |
|---|---|
| Dynamic QR tokens | Prevent reuse of old or captured QR codes. |
| Two-step QR flow | Reduces screenshot sharing and accidental single-scan marking. |
| JWT authentication | Protects role-based API access. |
| Role-based authorization | Separates admin, faculty, and student permissions. |
| Device fingerprinting | Restricts attendance marking from unregistered devices. |
| GPS/location validation | Confirms that the student is within the permitted classroom radius. |
| Face quality checks | Ensures that a usable live face image is captured before verification. |
| Face verification | Compares the live student image with registered face data. |
| Real-time session validation | Ensures attendance is marked only for active and valid sessions. |

## Technology Stack

| Layer | Technologies |
|---|---|
| Frontend | React, TypeScript, Vite |
| UI | React components, CSS utility styling, Lucide React icons |
| QR scanning | html5-qrcode |
| QR generation | react-qr-code |
| Browser face quality check | MediaPipe Tasks Vision |
| Backend | Node.js, Express.js |
| Database | MongoDB, Mongoose |
| Real-time communication | Socket.IO |
| Authentication | JWT, bcryptjs |
| Optional face service | Python, FastAPI, DeepFace, FaceNet512 |
| Deployment support | Docker, Docker Compose |

## System Architecture

```text
                    Admin / Faculty / Student Browser
                                  |
                                  v
                  React + TypeScript Frontend (Vite)
       Dashboards | QR Scanner | Face Capture | Location Capture
                                  |
                                  v
                    Node.js + Express Backend API
       Auth | Sessions | QR Validation | Attendance | Reports
                                  |
                    +-------------+-------------+
                    |                           |
                    v                           v
              MongoDB Database        Optional FaceNet512 Service
       Users | Sessions | Attendance       FastAPI + DeepFace
```

## Attendance Workflow

1. Admin creates departments, subjects, faculty, students, and registration access.
2. Faculty logs in and starts an attendance session for a subject/class.
3. Backend creates the session and generates short-lived dynamic QR data.
4. Student logs in from a registered device and scans the displayed QR code.
5. System validates the session, QR token, user role, device fingerprint, and scan timing.
6. Student completes the second QR step within the allowed time window.
7. System checks the student's current location against the session radius.
8. Student submits a live face capture when face verification is enabled.
9. Backend compares the live face data with registered face data.
10. Attendance is stored in MongoDB after all required checks pass.
11. Faculty dashboard updates in real time.

## Repository Structure

```text
SmartAttendenceSystem/
  src/                    React + TypeScript frontend
    components/           Reusable UI, QR, camera, header, and capture components
    pages/                Admin, faculty, student, login, and registration pages
    services/             API client and attendance/session service calls
    utils/                Face quality, image capture, and live location helpers

  server/                 Node.js + Express backend
    config/               MongoDB connection setup
    middleware/           Auth, admin auth, and request protection
    models/               Mongoose schemas
    routes/               API route groups
    services/             QR, attendance, face, device, location, and session logic
    sockets/              Socket.IO real-time update setup

  face-service/           Optional Python FastAPI face embedding service
  public/                 Static frontend assets
  dist/                   Production frontend build
  docker-compose.yml      MongoDB/backend compose configuration
  FACE_VERIFICATION_SETUP.md
  QUICK_REFERENCE.md
```

## Main Modules

| Module | Description |
|---|---|
| Authentication | Handles secure login, JWT creation, password hashing, and user role validation. |
| Registration | Provides controlled onboarding through time-limited registration links. |
| Department and Subject Management | Maintains academic structure for attendance sessions and reports. |
| QR Session Management | Creates active attendance sessions and rotates dynamic QR tokens. |
| Attendance Processing | Validates QR, device, location, face data, and records final attendance. |
| Face Verification | Uses browser-side quality checks and optional FaceNet512 embeddings for identity verification. |
| Location Validation | Checks student location against faculty/session location and configured radius. |
| Device Fingerprinting | Links student attendance activity to a registered device to prevent misuse. |
| Real-Time Dashboard | Uses Socket.IO to show live attendance updates during active sessions. |
| Reports and Analytics | Supports attendance review, student tracking, and academic record maintenance. |

## Prerequisites

- Node.js 18 or later
- npm
- MongoDB installed locally or available through Docker
- Python 3.10 or later, only for the optional FaceNet512 service
- A modern browser with camera and location permission support
- HTTPS or localhost for production-like camera/location behavior

## Installation

### 1. Install Frontend Dependencies

From the project root:

```bash
npm install
```

### 2. Install Backend Dependencies

```bash
cd server
npm install
```

### 3. Configure Backend Environment

Create `server/.env`:

```env
PORT=4000
HOST=0.0.0.0
MONGO_URI=mongodb://localhost:27017/smart_attendance_system
JWT_SECRET=replace_with_a_strong_secret
QR_SECRET=replace_with_a_strong_qr_secret
FRONTEND_URL=http://localhost:5173
APP_TIMEZONE=Asia/Kolkata

QR_TTL_SECONDS=2
QR_RECENT_HISTORY=8
QR_MAX_SEQUENCE_DRIFT=2
QR_MIN_ROTATION_SECONDS=3
QR_MAX_TWO_STEP_GAP_SECONDS=45
QR_PRECHECK_SKEW_SECONDS=8
QR_VERIFY_MAX_AGE_SECONDS=20

DEFAULT_SESSION_RADIUS_METERS=50
MAX_LOCATION_ACCURACY_METERS=120
LOCATION_BASE_TOLERANCE_METERS=20
LOCATION_MAX_ACCURACY_MARGIN_METERS=60

REQUIRE_FACE_VERIFICATION=false
FACE_MATCH_THRESHOLD=0.75
FACE_CAPTURE_MAX_AGE_MS=10000
```

### 4. Configure Frontend Environment

Create `.env.local` in the project root:

```env
VITE_API_BASE_URL=http://localhost:4000
VITE_FRONTEND_URL=http://localhost:5173
VITE_API_REQUEST_TIMEOUT_MS=15000
VITE_QR_REFRESH_MS=2000
VITE_SESSION_RADIUS_METERS=50
VITE_MIN_SECOND_SCAN_DELAY_MS=2500
```

Optional MediaPipe model configuration:

```env
VITE_MEDIAPIPE_WASM_BASE_URL=https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm
VITE_MEDIAPIPE_FACE_DETECTOR_MODEL_URL=https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite
VITE_FACE_MIN_DETECTION_SCORE=0.62
VITE_FACE_MIN_AREA_RATIO=0.12
VITE_FACE_CENTER_TOLERANCE_RATIO=0.22
```

### 5. Start MongoDB

Use a local MongoDB service, or run MongoDB with Docker:

```bash
docker run -d --name smart-attendance-mongo -p 27017:27017 mongo:6
```

### 6. Start the Backend

```bash
cd server
npm start
```

Backend URL:

```text
http://localhost:4000
```

Health check:

```text
http://localhost:4000/api/health
```

### 7. Start the Frontend

From the project root:

```bash
npm run dev
```

Frontend URL:

```text
http://localhost:5173
```

## Optional FaceNet512 Service

The project includes an optional Python service for stronger face verification using DeepFace and FaceNet512.

### Start the Service

```bash
cd face-service
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8000
```

Face service health check:

```text
http://localhost:8000/health
```

### Enable It in the Backend

Add these values to `server/.env`:

```env
FACENET512_SERVICE_URL=http://localhost:8000
FACENET512_VERSION=facenet512-v1
FACENET512_DISTANCE_THRESHOLD=0.38
FACENET512_TIMEOUT_MS=10000
FACE_IMAGE_MAX_LENGTH=700000
REQUIRE_FACE_VERIFICATION=true
```

When configured, new student registrations can store FaceNet512 embeddings. During attendance, the live face capture is converted to an embedding and compared with the registered embedding. Existing users without embeddings can continue with the legacy fallback unless strict service verification is enabled.

## API Overview

| Route Group | Purpose |
|---|---|
| `/api/auth` | Login, authentication, device validation, and device change requests |
| `/api/admin` | Admin profile, users, registration links, analytics, and management features |
| `/api/faculty` | Faculty sessions, QR generation, location capture, and faculty analytics |
| `/api/student` | Student dashboard, attendance history, and student-specific data |
| `/api/attendance` | Attendance precheck, marking, manual updates, and attendance retrieval |
| `/api/department` | Department creation and management |
| `/api/subject` | Subject catalog and subject assignment management |
| `/api/public` | Public helper endpoints such as mobile location capture |
| `/api/health` | Backend health status |

## Database Collections

The backend uses MongoDB collections through Mongoose models:

- Admins
- Faculty
- Students
- Departments
- Subjects
- Subject assignments
- Sessions
- Attendance records
- Registration tokens
- Device change requests

## Testing Strategy

| Testing Type | Focus Area |
|---|---|
| Unit Testing | QR token generation, JWT validation, distance calculation, face matching logic, and attendance rules. |
| Integration Testing | Login to dashboard routing, QR scan to attendance API, session creation to live dashboard updates. |
| System Testing | Complete flow from faculty session creation to student scan, verification, storage, and reporting. |
| Security Testing | Expired QR rejection, invalid device blocking, out-of-radius denial, unauthorized role access, and duplicate marking prevention. |
| Usability Testing | Ease of use for admin setup, faculty attendance flow, and student attendance marking. |

## Expected Outcomes

- Faster and more accurate attendance marking.
- Reduced manual workload for faculty.
- Lower possibility of proxy attendance.
- Real-time visibility of present and absent students.
- Secure storage of academic attendance records.
- Better transparency for students, faculty, and administrators.
- A scalable base for future mobile and cloud-based attendance systems.

## Limitations

- Internet connectivity is required for live synchronization.
- Camera access is required for QR scanning and face verification.
- GPS accuracy depends on device quality and environment.
- Face verification can be affected by low lighting, poor camera quality, and improper face positioning.
- Production deployment should use HTTPS to support secure camera, location, and authentication workflows.

## Future Enhancements

- Native Android and iOS applications.
- Offline attendance caching with later synchronization.
- Cloud-hosted deployment for multi-campus institutions.
- Advanced liveness detection for stronger face verification.
- AI-based attendance analytics and shortage prediction.
- Automated PDF/Excel report generation.
- Biometric integration for additional security.
- Multi-classroom and multi-campus management.

## Academic Relevance

This project demonstrates practical application of computer science and engineering concepts such as full-stack web development, database design, authentication, real-time systems, QR-based secure token generation, face verification, location-based validation, and software testing.

It is suitable for academic submission because it addresses a real institutional problem and provides a complete working solution with technical, social, and operational value.

## Conclusion

The Smart QR Based Attendance System with Face Recognition provides a secure and modern approach to attendance management in educational institutions. By combining dynamic QR codes, face verification, device fingerprinting, GPS validation, real-time dashboards, and structured database storage, the system improves attendance accuracy, reduces proxy attendance, and minimizes administrative workload.

The project is practical for classroom use, technically extensible, and ready for future enhancement into a larger institution-level attendance platform.
