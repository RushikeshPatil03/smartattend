// scripts/verify-attendance-concurrency.cjs
// Tests in-batch deduplication, queue starvation handling, and idempotent conflict resolution.

const assert = require("assert");

console.log("==================================================================");
console.log(" Running SmartAttend Attendance Concurrency & Idempotency Tests   ");
console.log("==================================================================");

// Mock implementation of the updated AttendanceBatchWriter logic
class TestAttendanceBatchWriter {
  constructor(mockDb) {
    this.queue = [];
    this.timer = null;
    this.BATCH_WINDOW_MS = 60;
    this.MAX_BATCH_SIZE = 30;
    this.mockDb = mockDb;
    this.flushCount = 0;
  }

  enqueue(payload, studentId, sessionId) {
    return new Promise((resolve, reject) => {
      const sid = String(sessionId);
      const stid = String(studentId);

      // In-batch duplicate deduplication within same micro-batch window
      const isDupe = this.queue.some(
        (item) => String(item.sessionId) === sid && String(item.studentId) === stid
      );
      if (isDupe) {
        return resolve({ alreadyMarked: true, already: true, studentId: stid, sessionId: sid });
      }

      this.queue.push({ payload, resolve, reject, studentId: stid, sessionId: sid });
      if (this.queue.length >= this.MAX_BATCH_SIZE) {
        this.flush();
      } else if (!this.timer) {
        this.timer = setTimeout(() => this.flush(), this.BATCH_WINDOW_MS);
      }
    });
  }

  async flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.queue.length === 0) return;

    this.flushCount += 1;
    const items = this.queue.splice(0, this.MAX_BATCH_SIZE);
    if (this.queue.length > 0) {
      this.timer = setTimeout(() => this.flush(), this.BATCH_WINDOW_MS);
    }

    try {
      const payloads = items.map((i) => i.payload);
      const { data, error } = await this.mockDb.upsert(payloads, {
        onConflict: "session,student",
        ignoreDuplicates: true,
      });

      if (error) throw error;

      const resultMap = new Map((data || []).map((row) => [String(row.student), row]));

      for (const item of items) {
        const row = resultMap.get(String(item.studentId));
        if (row) {
          item.resolve(row);
        } else {
          item.resolve({
            alreadyMarked: true,
            already: true,
            studentId: item.studentId,
            sessionId: item.sessionId,
          });
        }
      }
    } catch (err) {
      items.forEach((item) => item.reject(err));
    }
  }
}

// Simulated in-memory PostgreSQL table with UNIQUE(session, student)
class MockPostgresAttendances {
  constructor() {
    this.rows = new Map(); // key: "session:student" -> record
  }

  async upsert(payloads, options = {}) {
    const list = Array.isArray(payloads) ? payloads : [payloads];
    const insertedRows = [];

    for (const p of list) {
      const key = `${p.session}:${p.student}`;
      if (this.rows.has(key)) {
        if (options.ignoreDuplicates) {
          // ON CONFLICT DO NOTHING: row is skipped, 0 rows returned
          continue;
        } else {
          // Overwrite (legacy upsert behavior)
          this.rows.set(key, { ...p, id: this.rows.get(key).id, updated_at: new Date() });
          insertedRows.push(this.rows.get(key));
        }
      } else {
        const record = {
          id: `att_${Math.random().toString(36).substring(2, 9)}`,
          ...p,
          created_at: new Date(),
        };
        this.rows.set(key, record);
        insertedRows.push(record);
      }
    }

    return { data: insertedRows, error: null };
  }
}

async function runTests() {
  const db = new MockPostgresAttendances();
  const batcher = new TestAttendanceBatchWriter(db);

  console.log("Test 1: Concurrent duplicate scans for the same student in same batch window...");
  const sessionId = "session-test-uuid-100";
  const studentId = "student-test-uuid-001";

  // Simulate 10 simultaneous requests from the same student
  const requests = Array.from({ length: 10 }, (_, i) =>
    batcher.enqueue(
      { session: sessionId, student: studentId, timestamp: new Date().toISOString() },
      studentId,
      sessionId
    )
  );

  const results = await Promise.all(requests);
  const newlyCreated = results.filter((r) => !r.alreadyMarked);
  const alreadyMarked = results.filter((r) => r.alreadyMarked);

  assert.strictEqual(newlyCreated.length, 1, "Exactly 1 scan must be newly inserted");
  assert.strictEqual(alreadyMarked.length, 9, "Exactly 9 scans must be identified as already marked");
  assert.strictEqual(db.rows.size, 1, "Database must only contain exactly 1 row for this student & session");
  console.log("✓ Passed: Exactly 1 record created, 9 duplicates cleanly handled without duplicate DB rows.\n");

  console.log("Test 2: Subsequent retry scan in a new batch window after record is already in DB...");
  const retryResult = await batcher.enqueue(
    { session: sessionId, student: studentId, timestamp: new Date().toISOString() },
    studentId,
    sessionId
  );
  // Wait for batch flush
  await new Promise((r) => setTimeout(r, 80));

  assert.strictEqual(retryResult.alreadyMarked, true, "Subsequent scan must return alreadyMarked: true");
  assert.strictEqual(db.rows.size, 1, "Database row count must remain 1");
  console.log("✓ Passed: Subsequent retry scan recognized database record and returned alreadyMarked: true.\n");

  console.log("Test 3: Multiple distinct students in a concurrent burst (35 students)...");
  const distinctRequests = Array.from({ length: 35 }, (_, i) => {
    const sId = `student-distinct-${i}`;
    return batcher.enqueue(
      { session: sessionId, student: sId, timestamp: new Date().toISOString() },
      sId,
      sessionId
    );
  });

  const distinctResults = await Promise.all(distinctRequests);
  const distinctCreated = distinctResults.filter((r) => !r.alreadyMarked);

  assert.strictEqual(distinctCreated.length, 35, "All 35 distinct students must be successfully created");
  // Total rows: 1 from Test 1 + 35 from Test 3 = 36
  assert.strictEqual(db.rows.size, 36, "Database must contain exactly 36 distinct rows");
  assert.ok(batcher.flushCount >= 2, "Batcher must have flushed multiple times without starvation");
  console.log("✓ Passed: 35 distinct students handled across multiple batch flushes without queue starvation.\n");

  console.log("==================================================================");
  console.log(" ALL CONCURRENCY & IDEMPOTENCY TESTS PASSED (3/3)                 ");
  console.log("==================================================================");
}

runTests().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
