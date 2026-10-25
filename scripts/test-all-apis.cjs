const http = require("http");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../server/.env") });
const { query } = require("../server/config/postgresPool");

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

async function run() {
  console.log("=== Testing Backend APIs on localhost:4000 ===");

  // 1. Health
  const health = await request({ host: "localhost", port: 4000, path: "/api/health", method: "GET" });
  console.log("1. /api/health:", health.status, health.body?.ok ? "OK" : health.body);

  // Get sample users from DB
  const adminRes = await query("SELECT id, email FROM admins LIMIT 1");
  const admin = adminRes.rows[0];

  const facultyRes = await query("SELECT id, email FROM faculties LIMIT 1");
  const faculty = facultyRes.rows[0];

  const studentRes = await query("SELECT id, email, enrollment_no, device_fingerprint FROM students LIMIT 1");
  const student = studentRes.rows[0];

  console.log("Sample Users:", {
    admin: admin?.email,
    faculty: faculty?.email,
    student: student?.email,
  });

  // Try logging in as faculty or student if password known or generate token using jwt
  const jwt = require("jsonwebtoken");
  const adminToken = jwt.sign(
    { id: admin?.id, role: "ADMIN", email: admin?.email, type: "access" },
    process.env.JWT_SECRET,
    { expiresIn: "15m" }
  );
  const facultyToken = jwt.sign(
    { id: faculty?.id, role: "FACULTY", email: faculty?.email, type: "access" },
    process.env.JWT_SECRET,
    { expiresIn: "15m" }
  );
  const studentToken = jwt.sign(
    { id: student?.id, role: "STUDENT", email: student?.email, type: "access" },
    process.env.JWT_SECRET,
    { expiresIn: "15m" }
  );

  // 2. Auth me
  const meAdmin = await request({
    host: "localhost",
    port: 4000,
    path: "/api/auth/me",
    method: "GET",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  console.log("2. /api/auth/me (Admin):", meAdmin.status, meAdmin.body?.ok ? "OK" : meAdmin.body);

  const meFaculty = await request({
    host: "localhost",
    port: 4000,
    path: "/api/auth/me",
    method: "GET",
    headers: { Authorization: `Bearer ${facultyToken}` },
  });
  console.log("3. /api/auth/me (Faculty):", meFaculty.status, meFaculty.body?.ok ? "OK" : meFaculty.body);

  const meStudent = await request({
    host: "localhost",
    port: 4000,
    path: "/api/auth/me",
    method: "GET",
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  console.log("4. /api/auth/me (Student):", meStudent.status, meStudent.body?.ok ? "OK" : meStudent.body);

  // 5. Department list
  const depts = await request({
    host: "localhost",
    port: 4000,
    path: "/api/department",
    method: "GET",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  console.log("5. /api/department:", depts.status, depts.body?.ok ? `Found ${depts.body.departments?.length} departments` : depts.body);

  // 6. Subjects list
  const subs = await request({
    host: "localhost",
    port: 4000,
    path: "/api/subject",
    method: "GET",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  console.log("6. /api/subject:", subs.status, subs.body?.ok ? `Found ${subs.body.subjects?.length} subjects` : subs.body);

  // 7. Faculty active session
  const facActive = await request({
    host: "localhost",
    port: 4000,
    path: "/api/faculty/session/active",
    method: "GET",
    headers: { Authorization: `Bearer ${facultyToken}` },
  });
  console.log("7. /api/faculty/session/active:", facActive.status, facActive.body?.ok ? "OK" : facActive.body);

  // 8. Student today
  const stuToday = await request({
    host: "localhost",
    port: 4000,
    path: "/api/student/sessions/today",
    method: "GET",
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  console.log("8. /api/student/sessions/today:", stuToday.status, stuToday.body?.ok ? `Found ${stuToday.body.classes?.length} classes` : stuToday.body);

  // 9. Student recent sessions
  const stuRecent = await request({
    host: "localhost",
    port: 4000,
    path: "/api/student/sessions/recent",
    method: "GET",
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  console.log("9. /api/student/sessions/recent:", stuRecent.status, stuRecent.body?.ok ? `Found ${stuRecent.body.sessions?.length} sessions` : stuRecent.body);

  // 10. Student overview
  const stuOverview = await request({
    host: "localhost",
    port: 4000,
    path: "/api/student/attendance/overview",
    method: "GET",
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  console.log("10. /api/student/attendance/overview:", stuOverview.status, stuOverview.body?.ok ? "OK" : stuOverview.body);

  // 11. Activities
  const acts = await request({
    host: "localhost",
    port: 4000,
    path: "/api/activities",
    method: "GET",
    headers: { Authorization: `Bearer ${facultyToken}` },
  });
  console.log("11. /api/activities:", acts.status, acts.body?.ok ? `Found ${acts.body.activities?.length} activities` : acts.body);

  // 12. Device change requests
  const devReqs = await request({
    host: "localhost",
    port: 4000,
    path: "/api/faculty/device-change-requests",
    method: "GET",
    headers: { Authorization: `Bearer ${facultyToken}` },
  });
  console.log("12. /api/faculty/device-change-requests:", devReqs.status, devReqs.body?.ok ? `Found ${devReqs.body.requests?.length} requests` : devReqs.body);

  process.exit(0);
}

run().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
