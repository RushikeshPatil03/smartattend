/**
 * stateStoreAndDrainage.test.js
 *
 * Test suite for:
 * 1. Distributed/hybrid state provider (Locks, Scan Grants, Face Grants, Session Cache)
 * 2. AttendanceBatchWriter zero-loss lifecycle drainage (drainAndFlush)
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const stateStore = require("../services/stateStore");
const { attendanceBatchWriter } = require("../routes/attendance");

test("StateStore Distributed Mutex Locks", async (t) => {
  await t.test("acquires lock and prevents concurrent acquisition", async () => {
    const lockKey = `test_lock_${Date.now()}`;
    const acquired1 = await stateStore.acquireLock(lockKey, 2000);
    assert.equal(acquired1, true, "First lock acquisition should succeed");

    // Second acquisition attempt should fail while first lock is active
    const acquired2 = await stateStore.acquireLock(lockKey, 2000);
    assert.equal(acquired2, false, "Concurrent lock acquisition should be rejected");

    // Releasing lock allows subsequent acquisition
    await stateStore.releaseLock(lockKey);
    const acquired3 = await stateStore.acquireLock(lockKey, 2000);
    assert.equal(acquired3, true, "Lock acquisition should succeed after release");
    await stateStore.releaseLock(lockKey);
  });

  await t.test("lock automatically expires after TTL", async () => {
    const lockKey = `expire_lock_${Date.now()}`;
    const acquired = await stateStore.acquireLock(lockKey, 100); // 100ms TTL
    assert.equal(acquired, true);

    await new Promise((r) => setTimeout(r, 150));
    const acquiredAfterExpiry = await stateStore.acquireLock(lockKey, 100);
    assert.equal(acquiredAfterExpiry, true, "Lock should be re-acquirable after TTL expiry");
    await stateStore.releaseLock(lockKey);
  });
});

test("StateStore Single-Use Scan Grants", async (t) => {
  await t.test("saves and consumes scan grant atomically (anti-replay)", async () => {
    const token = `sg_token_${Date.now()}`;
    const studentId = "student_123";
    const sessionId = "session_456";
    const fingerprint = "fp_abc_789";

    const grant = await stateStore.saveScanGrant({
      token,
      studentId,
      sessionId,
      fingerprint,
      ttlMs: 5000,
    });

    assert.equal(grant.token, token);
    assert.equal(grant.studentId, studentId);

    // First consumption succeeds
    const consume1 = await stateStore.consumeScanGrant({
      token,
      studentId,
      sessionId,
      fingerprint,
    });
    assert.equal(consume1.ok, true, "First consumption must succeed");

    // Replay attempt fails immediately
    const consume2 = await stateStore.consumeScanGrant({
      token,
      studentId,
      sessionId,
      fingerprint,
    });
    assert.equal(consume2.ok, false, "Second consumption attempt must be rejected (single-use)");
  });

  await t.test("rejects scan grant on context mismatch", async () => {
    const token = `sg_mismatch_${Date.now()}`;
    await stateStore.saveScanGrant({
      token,
      studentId: "student_correct",
      sessionId: "session_correct",
      fingerprint: "fp_correct",
      ttlMs: 5000,
    });

    const mismatchCheck = await stateStore.consumeScanGrant({
      token,
      studentId: "student_wrong",
      sessionId: "session_correct",
      fingerprint: "fp_correct",
    });

    assert.equal(mismatchCheck.ok, false);
    assert.match(mismatchCheck.error, /mismatch/i);
  });
});

test("StateStore Single-Use Face Grants", async (t) => {
  await t.test("saves and consumes face verification grant with anti-replay", async () => {
    const studentId = "student_face_1";
    const sessionId = "session_face_1";
    const fingerprint = "fp_face_1";

    const grant = await stateStore.saveFaceGrant({
      studentId,
      sessionId,
      fingerprint,
      score: 0.98,
      method: "facenet512",
      ttlMs: 5000,
    });

    assert.ok(grant.token, "Face grant token must be generated");

    // First consumption succeeds
    const consume1 = await stateStore.consumeFaceGrant({
      token: grant.token,
      studentId,
      sessionId,
      fingerprint,
    });
    assert.equal(consume1.ok, true);
    assert.equal(consume1.grant.score, 0.98);

    // Second consumption is rejected (anti-replay)
    const consume2 = await stateStore.consumeFaceGrant({
      token: grant.token,
      studentId,
      sessionId,
      fingerprint,
    });
    assert.equal(consume2.ok, false);
    assert.equal(consume2.code, "INVALID_FACE_GRANT");
  });

  await t.test("validates student, device, and session matching on face grant", async () => {
    const grant = await stateStore.saveFaceGrant({
      studentId: "student_auth",
      sessionId: "session_auth",
      fingerprint: "fp_auth",
      ttlMs: 5000,
    });

    const mismatchStudent = await stateStore.consumeFaceGrant({
      token: grant.token,
      studentId: "other_student",
      sessionId: "session_auth",
      fingerprint: "fp_auth",
    });
    assert.equal(mismatchStudent.code, "FACE_GRANT_STUDENT_MISMATCH");
  });
});

test("StateStore Active Session Cache", async (t) => {
  await t.test("stores, retrieves, and invalidates active session cache", async () => {
    const sid = `sess_cache_${Date.now()}`;
    const sessionObj = { id: sid, is_active: true, subject: "CS101" };

    await stateStore.setCachedSession(sid, sessionObj, 10);
    const cached = await stateStore.getCachedSession(sid);
    assert.deepEqual(cached, sessionObj);

    stateStore.invalidateCachedSession(sid);
    const afterInvalidation = await stateStore.getCachedSession(sid);
    assert.equal(afterInvalidation, null);
  });
});

test("AttendanceBatchWriter Zero-Loss Drainage", async (t) => {
  await t.test("exposes drainAndFlush and stops accepting new batches during shutdown", async () => {
    assert.equal(typeof attendanceBatchWriter.drainAndFlush, "function");

    // Perform drainAndFlush
    await attendanceBatchWriter.drainAndFlush();

    // After draining, new enqueues should be cleanly rejected without unhandled errors
    await assert.rejects(
      async () => {
        await attendanceBatchWriter.enqueue({ test: true }, "student_x", "session_y");
      },
      /shutting down/i
    );

    // Reset draining flag for running server instance
    attendanceBatchWriter.isDraining = false;
  });
});
