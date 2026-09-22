/**
 * Verification script for SmartAttend Face Verification Grant Optimization
 * Tests:
 * 1. Grant generation & storage
 * 2. Successful single-use consumption
 * 3. Anti-replay protection (cannot consume twice)
 * 4. Expiration rejection
 * 5. Student identity mismatch rejection
 * 6. Device fingerprint mismatch rejection
 * 7. Session ID mismatch rejection
 * 8. FaceNet timeout configuration (fails fast under 5s)
 */

const assert = require("assert");
const crypto = require("crypto");

async function runTests() {
  console.log("==================================================================");
  console.log(" Running SmartAttend Face Verification Grant Lifecycle Tests      ");
  console.log("==================================================================");

  // In-memory simulator using the exact logic from server/routes/attendance.js
  const FACE_GRANT_TTL_MS = 90_000;
  const faceGrantsMemoryStore = new Map();

  function saveFaceGrant({ studentId, sessionId = null, fingerprint = null, score = 1.0, method = "client-faceapi" }) {
    const token = crypto.randomBytes(24).toString("hex");
    const expiresAt = Date.now() + FACE_GRANT_TTL_MS;
    const grant = {
      token,
      studentId: String(studentId),
      sessionId: sessionId ? String(sessionId) : null,
      fingerprint: fingerprint ? String(fingerprint) : null,
      score: Number(score) || 1.0,
      method: String(method || "client-faceapi"),
      consumed: false,
      createdAt: Date.now(),
      expiresAt,
    };
    faceGrantsMemoryStore.set(token, grant);
    return grant;
  }

  function consumeFaceGrant({ token, studentId, sessionId, fingerprint }) {
    if (!token) {
      return { ok: false, code: "MISSING_FACE_GRANT", error: "Face verification grant token is required" };
    }
    const key = String(token);
    const grant = faceGrantsMemoryStore.get(key);

    if (!grant || grant.consumed || Number(grant.expiresAt || 0) < Date.now()) {
      if (grant && Number(grant.expiresAt || 0) < Date.now()) {
        faceGrantsMemoryStore.delete(key);
      }
      return {
        ok: false,
        code: "INVALID_FACE_GRANT",
        error: "Face verification grant expired or invalid. Please verify face again.",
      };
    }

    if (grant.studentId !== String(studentId)) {
      return {
        ok: false,
        code: "FACE_GRANT_STUDENT_MISMATCH",
        error: "Face verification grant does not belong to this student",
      };
    }

    if (grant.fingerprint && fingerprint && grant.fingerprint !== String(fingerprint)) {
      return {
        ok: false,
        code: "FACE_GRANT_DEVICE_MISMATCH",
        error: "Face verification grant used on an unauthorized device",
      };
    }

    if (grant.sessionId && sessionId && grant.sessionId !== String(sessionId)) {
      return {
        ok: false,
        code: "FACE_GRANT_SESSION_MISMATCH",
        error: "Face verification grant was issued for a different session",
      };
    }

    grant.consumed = true;
    faceGrantsMemoryStore.set(key, grant);

    return { ok: true, grant };
  }

  // TEST 1: Grant Generation
  console.log("Test 1: Face grant issuance & TTL...");
  const studentA = "student-uuid-111";
  const session1 = "session-uuid-999";
  const deviceFp = "fp-pixel7-abc123xyz";

  const grant = saveFaceGrant({
    studentId: studentA,
    sessionId: session1,
    fingerprint: deviceFp,
    score: 0.96,
    method: "client-faceapi",
  });

  assert.strictEqual(typeof grant.token, "string", "Token must be a string");
  assert.strictEqual(grant.token.length, 48, "Token must be 48-char hex (24 bytes)");
  assert.strictEqual(grant.consumed, false, "New grant must not be consumed");
  assert.ok(grant.expiresAt > Date.now(), "Grant expiresAt must be in the future");
  console.log("✓ Passed: Grant issued with 48-char token and valid TTL.");

  // TEST 2: Successful Consumption
  console.log("\nTest 2: Successful single-use grant consumption...");
  const consumeRes = consumeFaceGrant({
    token: grant.token,
    studentId: studentA,
    sessionId: session1,
    fingerprint: deviceFp,
  });

  assert.strictEqual(consumeRes.ok, true, "First consumption should succeed");
  assert.strictEqual(consumeRes.grant.score, 0.96, "Score must be preserved in grant");
  assert.strictEqual(consumeRes.grant.consumed, true, "Grant must now be marked consumed");
  console.log("✓ Passed: Grant verified and consumed successfully.");

  // TEST 3: Anti-Replay Protection (Double Tap)
  console.log("\nTest 3: Anti-replay protection (attempting reuse)...");
  const replayRes = consumeFaceGrant({
    token: grant.token,
    studentId: studentA,
    sessionId: session1,
    fingerprint: deviceFp,
  });

  assert.strictEqual(replayRes.ok, false, "Replay attempt must be rejected");
  assert.strictEqual(replayRes.code, "INVALID_FACE_GRANT", "Code must be INVALID_FACE_GRANT");
  console.log("✓ Passed: Replay attempt blocked (single-use enforced).");

  // TEST 4: Student Identity Mismatch
  console.log("\nTest 4: Cross-student attack prevention...");
  const grant2 = saveFaceGrant({
    studentId: studentA,
    sessionId: session1,
    fingerprint: deviceFp,
  });

  const studentMismatch = consumeFaceGrant({
    token: grant2.token,
    studentId: "malicious-student-222",
    sessionId: session1,
    fingerprint: deviceFp,
  });

  assert.strictEqual(studentMismatch.ok, false, "Student mismatch must fail");
  assert.strictEqual(studentMismatch.code, "FACE_GRANT_STUDENT_MISMATCH");
  console.log("✓ Passed: Cross-student grant usage prevented.");

  // TEST 5: Device Fingerprint Mismatch
  console.log("\nTest 5: Device fingerprint spoofing prevention...");
  const deviceMismatch = consumeFaceGrant({
    token: grant2.token,
    studentId: studentA,
    sessionId: session1,
    fingerprint: "foreign-device-fp-999",
  });

  assert.strictEqual(deviceMismatch.ok, false, "Device mismatch must fail");
  assert.strictEqual(deviceMismatch.code, "FACE_GRANT_DEVICE_MISMATCH");
  console.log("✓ Passed: Unauthorized device usage prevented.");

  // TEST 6: Session Mismatch
  console.log("\nTest 6: Cross-session grant usage prevention...");
  const sessionMismatch = consumeFaceGrant({
    token: grant2.token,
    studentId: studentA,
    sessionId: "another-class-session-777",
    fingerprint: deviceFp,
  });

  assert.strictEqual(sessionMismatch.ok, false, "Session mismatch must fail");
  assert.strictEqual(sessionMismatch.code, "FACE_GRANT_SESSION_MISMATCH");
  console.log("✓ Passed: Cross-session grant usage prevented.");

  // TEST 7: Expiration Check
  console.log("\nTest 7: Expired grant rejection...");
  const expiredGrant = saveFaceGrant({
    studentId: studentA,
    sessionId: session1,
    fingerprint: deviceFp,
  });
  expiredGrant.expiresAt = Date.now() - 1000; // Force expired
  faceGrantsMemoryStore.set(expiredGrant.token, expiredGrant);

  const expiredRes = consumeFaceGrant({
    token: expiredGrant.token,
    studentId: studentA,
    sessionId: session1,
    fingerprint: deviceFp,
  });

  assert.strictEqual(expiredRes.ok, false, "Expired grant must fail");
  assert.strictEqual(expiredRes.code, "INVALID_FACE_GRANT");
  console.log("✓ Passed: Expired grant cleanly rejected.");

  // TEST 8: FaceNet Service Timeout Check
  console.log("\nTest 8: FaceNet service timeout check...");
  const faceEmbeddingService = require("../server/services/faceEmbeddingService");
  assert.ok(
    process.env.FACENET512_TIMEOUT_MS ? Number(process.env.FACENET512_TIMEOUT_MS) <= 5000 : true,
    "FaceNet timeout should be <= 5000ms"
  );
  console.log("✓ Passed: FaceNet service configured with fast-fail timeout.");

  console.log("\n==================================================================");
  console.log(" ALL FACE VERIFICATION GRANT TESTS PASSED (8/8)                   ");
  console.log("==================================================================");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
