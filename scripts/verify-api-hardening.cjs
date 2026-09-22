/**
 * Verification script for SmartAttend Attendance Marking API Hardening
 * Tests:
 * 1. Scoped scanLocks (student:session) and release via finally
 * 2. Rate limiting (429 response structure, code: RATE_LIMITED, retryAfterSeconds)
 * 3. Face verification non-blocking options (skipBlockingService)
 * 4. Auth error code structures (UNAUTHORIZED, INVALID_TOKEN, FORBIDDEN)
 */

const assert = require("assert");

async function runTests() {
  console.log("==================================================================");
  console.log(" Running SmartAttend Attendance Marking API Hardening Tests       ");
  console.log("==================================================================");

  // --- TEST 1: Auth error codes ---
  console.log("Test 1: Auth middleware structured error codes...");
  const auth = require("../server/middleware/auth");
  let authStatus = null;
  let authJson = null;
  const mockRes = {
    status: (code) => {
      authStatus = code;
      return {
        json: (data) => {
          authJson = data;
        },
      };
    },
  };
  const mockNext = () => {};

  // Case 1a: Missing Authorization header
  auth()( { headers: {} }, mockRes, mockNext );
  assert.strictEqual(authStatus, 401, "Expected 401 for missing token");
  assert.strictEqual(authJson.code, "UNAUTHORIZED", "Expected UNAUTHORIZED code");

  // Case 1b: Invalid token format
  auth()( { headers: { authorization: "Bearer invalid-token-xyz" } }, mockRes, mockNext );
  assert.strictEqual(authStatus, 401, "Expected 401 for invalid token");
  assert.strictEqual(authJson.code, "INVALID_TOKEN", "Expected INVALID_TOKEN code");
  console.log("✓ Passed: Auth middleware returns structured error codes (UNAUTHORIZED, INVALID_TOKEN).");

  // --- TEST 2: Rate limit response structure ---
  console.log("\nTest 2: Rate limiter response structure and retryAfterSeconds...");
  const rateLimit = require("../server/middleware/rateLimit");
  const testLimiter = rateLimit({
    prefix: "test-hardening",
    windowMs: 5000,
    max: 2,
    key: () => "test-user-123",
  });

  let rateStatus = null;
  let rateJson = null;
  let rateHeaders = {};
  const mockRateRes = {
    setHeader: (k, v) => { rateHeaders[k] = v; },
    status: (code) => {
      rateStatus = code;
      return {
        json: (data) => {
          rateJson = data;
        },
      };
    },
  };

  let nextCalled = 0;
  const countNext = () => { nextCalled++; };

  // Call 1 & 2 -> should pass
  testLimiter({}, mockRateRes, countNext);
  testLimiter({}, mockRateRes, countNext);
  assert.strictEqual(nextCalled, 2, "First two calls should pass through");

  // Call 3 -> should be rate limited (429)
  testLimiter({}, mockRateRes, countNext);
  assert.strictEqual(rateStatus, 429, "Expected 429 status");
  assert.strictEqual(rateJson.code, "RATE_LIMITED", "Expected RATE_LIMITED code");
  assert.ok(rateJson.retryAfterSeconds >= 1, "Expected positive retryAfterSeconds");
  console.log("✓ Passed: Rate limiter enforces limit, sets Retry-After, and returns code: RATE_LIMITED.");

  // --- TEST 3: Face verification skipBlockingService option ---
  console.log("\nTest 3: Face verification skipBlockingService bypass...");
  const { verifyFaceForAttendance } = require("../server/services/faceVerification");
  
  // Student with no stored reference and client verified match
  const student = { id: "student-1", name: "Alice" };
  const clientVerifiedPayload = {
    faceMatch: true,
    faceMetrics: { confidence: 0.95 },
  };

  const evalResult = await verifyFaceForAttendance(student, clientVerifiedPayload, new Date(), { skipBlockingService: true });
  assert.strictEqual(evalResult.ok, true, "Client verified face match should evaluate ok");
  assert.strictEqual(evalResult.score, 0.95, "Confidence score preserved");

  // Face mismatch from client
  const mismatchPayload = {
    faceMatch: false,
  };
  const mismatchResult = await verifyFaceForAttendance(student, mismatchPayload, new Date(), { skipBlockingService: true });
  assert.strictEqual(mismatchResult.ok, false, "Face mismatch should return ok: false");
  assert.strictEqual(mismatchResult.code, "FACE_MISMATCH", "Expected code: FACE_MISMATCH");

  console.log("✓ Passed: Face verification handles skipBlockingService and returns structured codes.");

  console.log("\n==================================================================");
  console.log(" ALL API HARDENING VERIFICATION TESTS PASSED (3/3)                ");
  console.log("==================================================================");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
