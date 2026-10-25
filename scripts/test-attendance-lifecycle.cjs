const http = require("http");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../server/.env") });
const { query } = require("../server/config/postgresPool");
const jwt = require("jsonwebtoken");

function request(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, raw: body });
        }
      });
    });
    req.on("error", reject);
    if (data) req.write(typeof data === "string" ? data : JSON.stringify(data));
    req.end();
  });
}

async function testLifecycle() {
  console.log("=== Testing Full Session and Attendance Marking Lifecycle ===");

  // 1. Fetch Mane (Faculty) and student
  const facRes = await query("SELECT id, email, department, created_by_admin FROM faculties WHERE email = 'mane@gmail.com'");
  const faculty = facRes.rows[0];

  const subRes = await query("SELECT id, name, code, year, semester FROM subjects WHERE created_by_admin = $1 LIMIT 1", [faculty.created_by_admin]);
  const subject = subRes.rows[0];

  const stuRes = await query("SELECT id, email, enrollment_no, device_fingerprint, department, year, semester, section FROM students WHERE email = 'ravikumarkanni21@gmail.com'");
  const student = stuRes.rows[0];

  console.log("Faculty:", faculty.email, "Subject:", subject.name, "Student:", student.enrollment_no, student.email);

  const facultyToken = jwt.sign(
    { id: faculty.id, role: "FACULTY", email: faculty.email, type: "access" },
    process.env.JWT_SECRET,
    { expiresIn: "15m" }
  );

  const studentToken = jwt.sign(
    { id: student.id, role: "STUDENT", email: student.email, type: "access" },
    process.env.JWT_SECRET,
    { expiresIn: "15m" }
  );

  // Stop any active sessions for faculty first
  const activeRes = await request({
    host: "localhost",
    port: 4000,
    path: "/api/faculty/session/active",
    method: "GET",
    headers: { Authorization: `Bearer ${facultyToken}` },
  });
  if (activeRes.body?.session?.id) {
    console.log("Stopping previous session:", activeRes.body.session.id);
    await request({
      host: "localhost",
      port: 4000,
      path: `/api/faculty/session/${activeRes.body.session.id}/stop`,
      method: "POST",
      headers: { Authorization: `Bearer ${facultyToken}` },
    });
  }

  // 2. Start a session
  console.log("\n1. Starting new faculty session...");
  const startRes = await request(
    {
      host: "localhost",
      port: 4000,
      path: "/api/faculty/session/start",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${facultyToken}`,
      },
    },
    {
      subjectId: subject.id,
      departmentId: student.department,
      year: student.year,
      semester: student.semester,
      section: student.section,
      location: {
        lat: 12.9716,
        lng: 77.5946,
        radius: 100,
      },
    }
  );

  console.log("Start Session Status:", startRes.status, startRes.body?.ok ? `Session ID: ${startRes.body.session?.id}` : startRes.body);
  if (!startRes.body?.ok) {
    throw new Error("Failed to start session: " + JSON.stringify(startRes.body));
  }

  const session = startRes.body.session;
  const sessionId = session.id;

  // 3. Get QR secret
  console.log("\n2. Getting Live QR for session...");
  const qrRes = await request({
    host: "localhost",
    port: 4000,
    path: `/api/faculty/session/${sessionId}/qr`,
    method: "GET",
    headers: { Authorization: `Bearer ${facultyToken}` },
  });
  console.log("QR response:", qrRes.status, qrRes.body?.ok ? `Secret Key length: ${qrRes.body.secretKey?.length}` : qrRes.body);
  const secretKey = qrRes.body.secretKey;

  // 4. Generate consecutive TOTP blocks
  const { generateTotpToken, getBlockIndex } = require("../server/services/totpVerification");
  const now = Date.now();
  const idx = getBlockIndex(now);
  const code1 = generateTotpToken(secretKey, idx);
  const code2 = generateTotpToken(secretKey, idx + 1);

  const sequence = [
    { classId: sessionId, code: code1, index: idx, ts: now },
    { classId: sessionId, code: code2, index: idx + 1, ts: now + 1000 },
  ];

  // 4.5 Get Face Grant Token
  console.log("\n2.5 Obtaining Face Verification Grant...");
  const faceGrantRes = await request(
    {
      host: "localhost",
      port: 4000,
      path: "/api/attendance/face-verify",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${studentToken}`,
      },
    },
    {
      sessionId,
      fingerprint: student.device_fingerprint,
      faceMatch: true,
      faceMetrics: { confidence: 0.95 },
    }
  );
  console.log("Face Grant response:", faceGrantRes.status, faceGrantRes.body);
  const faceGrantToken = faceGrantRes.body?.faceGrantToken;

  // 5. Submit attendance via /api/attendance/submit
  console.log("\n3. Submitting TOTP attendance from student...");
  const submitRes = await request(
    {
      host: "localhost",
      port: 4000,
      path: "/api/attendance/submit",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${studentToken}`,
      },
    },
    {
      sessionId,
      sequence,
      fingerprint: student.device_fingerprint,
      faceGrantToken,
      secondQrScannedAtMs: now + 1050,
      qr2GenToScanMs: 100,
      location: {
        lat: 12.9716,
        lng: 77.5946,
        accuracy: 15,
      },
    }
  );

  console.log("Submit Attendance Status:", submitRes.status, submitRes.body);

  // 6. Check attendees
  console.log("\n4. Checking session attendees...");
  const attendeesRes = await request({
    host: "localhost",
    port: 4000,
    path: `/api/attendance/session/${sessionId}/attendees`,
    method: "GET",
    headers: { Authorization: `Bearer ${facultyToken}` },
  });
  console.log("Attendees status:", attendeesRes.status, "Count:", attendeesRes.body?.attendees?.length);

  // 7. Stop session
  console.log("\n5. Stopping session...");
  const stopRes = await request({
    host: "localhost",
    port: 4000,
    path: `/api/faculty/session/${sessionId}/stop`,
    method: "POST",
    headers: { Authorization: `Bearer ${facultyToken}` },
  });
  console.log("Stop Session Status:", stopRes.status, stopRes.body);

  // 8. Clean up test session & attendance
  console.log("\n6. Cleaning up test session...");
  await query("DELETE FROM attendances WHERE session = $1", [sessionId]);
  await query("DELETE FROM session_roster_snapshots WHERE session_id = $1", [sessionId]);
  await query("DELETE FROM sessions WHERE id = $1", [sessionId]);
  console.log("Cleaned up successfully!");

  process.exit(0);
}

testLifecycle().catch((err) => {
  console.error("Lifecycle test failed:", err);
  process.exit(1);
});
