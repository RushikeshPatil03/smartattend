# SmartAttend - Updated (Backend + Docker + Features scaffold)

This updated repository adds:
- A Node/Express backend at `/server` with MongoDB models for Users, Sessions and Attendance.
- `/api/session` to create sessions and return a signed QR token.
- `/api/attendance` to verify a scanned QR + geolocation and store attendance server-side.
- `/api/export/attendance.csv` to download recent attendance as CSV.
- `docker-compose.yml` to run MongoDB + server locally.
- Example server Dockerfile and package.json.

## Quick start (local using Node)

1. Install Node 18+ and npm.
2. Start MongoDB (local) or use the docker-compose below.
3. From `/server`:
   - `npm install`
   - `MONGO_URI="mongodb://localhost:27017/smart_attendance_system" JWT_SECRET="your_jwt_secret" npm start`
4. Server runs on `http://localhost:4000`.

## Quick start with Docker Compose (recommended for demos)

1. Install Docker & Docker Compose.
2. At repository root run:
   - `docker compose up --build`
3. This will start:
   - MongoDB at `mongodb://localhost:27017`
   - Server at `http://localhost:4000`

## How the QR & attendance flow works

1. Faculty POSTs to `/api/session` with `{ title, facultyId, lat, lng, radiusMeters, durationMinutes }`.
   - Server creates a Session document and returns a signed `qrToken` (JWT).
2. Frontend renders the QR (contains the signed token) for students to scan or provides the token value.
3. Student posts to `/api/attendance` with `{ qrToken, userId, lat, lng }`.
   - Server verifies JWT, checks session time window and computes haversine distance.
   - If within radius and time, attendance is recorded.

## Connecting your frontend

- In the frontend, replace the current `simulateScan` logic with a `fetch` POST to `http://localhost:4000/api/attendance`.
- Example request:
```js
await fetch('http://localhost:4000/api/attendance', {
  method: 'POST',
  headers: {'Content-Type':'application/json'},
  body: JSON.stringify({ qrToken, userId: currentUserId, lat: gpsLat, lng: gpsLng })
});
```

## Notes & next steps

- This is a scaffold: you should harden auth, add rate-limits, validate inputs, and add HTTPS in production.
- Add role-based access control and secure endpoints for creating sessions and exporting CSVs.
- Consider moving JWT secret to a secure vault or environment variable.
- For production, use managed MongoDB (Atlas) and set `MONGO_URI` accordingly.
