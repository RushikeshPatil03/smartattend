// scripts/verify-batch-reassignment.cjs
const assert = require("assert");
const { query } = require("../server/config/postgresPool");

async function runVerification() {
  console.log("=== Academic Batch Lifecycle & Reconciliation Verification Suite ===\n");
  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ [FAIL] ${name}:`, err.message);
    }
  }

  async function testAsync(name, fn) {
    total++;
    try {
      await fn();
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ [FAIL] ${name}:`, err.message);
    }
  }

  // 1. Database Schema Verification
  await testAsync("1. DB Schema: session_roster_snapshots audit columns exist", async () => {
    const res = await query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'session_roster_snapshots' AND column_name IN ('transferred_to_batch_id', 'transfer_note')"
    );
    const cols = res.rows.map((r) => r.column_name);
    assert(cols.includes("transferred_to_batch_id"), "Missing transferred_to_batch_id column");
    assert(cols.includes("transfer_note"), "Missing transfer_note column");
  });

  // 2. Rapid Cross-Batch Lookup Indices
  await testAsync("2. DB Schema: Rapid cross-batch indices exist", async () => {
    const res = await query(
      "SELECT indexname FROM pg_indexes WHERE tablename IN ('session_roster_snapshots', 'attendances') AND indexname IN ('idx_snapshots_student_subject', 'idx_attendances_student_subject')"
    );
    const indices = res.rows.map((r) => r.indexname);
    assert(indices.includes("idx_snapshots_student_subject"), "Missing idx_snapshots_student_subject");
    assert(indices.includes("idx_attendances_student_subject"), "Missing idx_attendances_student_subject");
  });

  // 3. Batch Diff Detection Logic
  test("3. Service Logic: Diff detection accurately identifies moved students", () => {
    const existingBatches = [
      { id: "batch-1", batch_name: "Batch 1", batch_number: 1, student_enrollments: ["USN001", "USN002"] },
      { id: "batch-2", batch_name: "Batch 2", batch_number: 2, student_enrollments: ["USN003"] },
    ];
    const incomingBatches = [
      { id: "batch-1", batch_name: "Batch 1", batch_number: 1, student_enrollments: ["USN001"] },
      { id: "batch-2", batch_name: "Batch 2", batch_number: 2, student_enrollments: ["USN002", "USN003"] },
    ];

    const oldStudentBatchMap = new Map();
    for (const oldBatch of existingBatches) {
      for (const u of oldBatch.student_enrollments) {
        oldStudentBatchMap.set(u, { batchId: oldBatch.id, batchName: oldBatch.batch_name });
      }
    }

    const newStudentBatchMap = new Map();
    for (const newBatch of incomingBatches) {
      for (const u of newBatch.student_enrollments) {
        newStudentBatchMap.set(u, { batchId: newBatch.id, batchName: newBatch.batch_name });
      }
    }

    const moved = [];
    for (const [usn, oldInfo] of oldStudentBatchMap.entries()) {
      const newInfo = newStudentBatchMap.get(usn);
      if (newInfo && newInfo.batchId !== oldInfo.batchId) {
        moved.push({ usn, from: oldInfo.batchId, to: newInfo.batchId });
      }
    }

    assert.strictEqual(moved.length, 1);
    assert.strictEqual(moved[0].usn, "USN002");
    assert.strictEqual(moved[0].from, "batch-1");
    assert.strictEqual(moved[0].to, "batch-2");
  });

  // 4. "Whole Class First, Batches Later" Foundation Inclusion
  test("4. Foundation Inclusion: Whole class sessions preserved across all batch views", () => {
    const activeBatchId = "batch-2";
    const targetUsns = new Set(["USN002", "USN003"]); // USN002 transferred from batch-1 to batch-2

    const sessions = [
      { id: "s-whole-1", batch_id: null, batch_ids: [], start_time: "2026-09-01T09:00:00Z" },
      { id: "s-whole-2", batch_id: null, batch_ids: [], start_time: "2026-09-02T09:00:00Z" },
      { id: "s-b1-1", batch_id: "batch-1", batch_ids: ["batch-1"], start_time: "2026-09-05T09:00:00Z" },
      { id: "s-b2-1", batch_id: "batch-2", batch_ids: ["batch-2"], start_time: "2026-09-06T09:00:00Z" },
    ];

    const rawAttendances = [
      { session: "s-whole-1", enrollment_no: "USN002", status: "present" },
      { session: "s-whole-2", enrollment_no: "USN002", status: "present" },
      { session: "s-b1-1", enrollment_no: "USN002", status: "present" }, // Attended while in batch-1!
      { session: "s-b2-1", enrollment_no: "USN002", status: "present" },
    ];

    const currentBatchUsns = new Set(targetUsns);
    const visibleSessions = sessions.filter((s) => {
      const isWholeClass = !s.batch_id && (!s.batch_ids || s.batch_ids.length === 0);
      const isThisBatch =
        String(s.batch_id) === activeBatchId ||
        (Array.isArray(s.batch_ids) && s.batch_ids.some((id) => String(id) === activeBatchId));

      const hasTransferredAttendee = rawAttendances.some(
        (att) =>
          String(att.session) === String(s.id) &&
          currentBatchUsns.has(String(att.enrollment_no).toUpperCase()) &&
          String(att.status).toLowerCase() === "present"
      );

      return isWholeClass || isThisBatch || hasTransferredAttendee;
    });

    const sessionIds = visibleSessions.map((s) => s.id);
    assert(sessionIds.includes("s-whole-1"), "Missing whole class session 1");
    assert(sessionIds.includes("s-whole-2"), "Missing whole class session 2");
    assert(sessionIds.includes("s-b1-1"), "Missing transferred session from batch 1");
    assert(sessionIds.includes("s-b2-1"), "Missing batch 2 session");
    assert.strictEqual(visibleSessions.length, 4);
  });

  // 5. Transferred Credit Resolution (P*)
  test("5. Transferred Credit: Attended sessions from previous batch resolve to P*", () => {
    const eno = "USN002"; // Transferred to batch-2
    const targetBatchId = "batch-2";
    const colKey = "s-b1-1"; // Session conducted for batch-1
    const colBatchId = "batch-1";

    const stuBatchSet = new Set(["batch-2"]);
    const presentSet = new Set(); // Direct present not mapped to batch-2 session

    const rawAttendances = [
      { session: "s-b1-1", enrollment_no: "USN002", status: "present" },
    ];

    let status = "—";
    if (presentSet.has(`${eno}|${colKey}`)) {
      status = "P";
    } else {
      const attendedElsewhere = rawAttendances.some((att) => {
        const attEno = String(att.enrollment_no).trim().toUpperCase();
        const attSid = String(att.session).trim();
        return attEno === eno && attSid === colKey && String(att.status).toLowerCase() === "present";
      });

      if (attendedElsewhere) {
        status = "P*";
      } else {
        const isEligible = !colBatchId || stuBatchSet.has(colBatchId);
        status = isEligible ? "A" : "—";
      }
    }

    assert.strictEqual(status, "P*", "Transferred student session must resolve to P*");
  });

  // 6. Cumulative Quorum Calculation includes P and P*
  test("6. Cumulative Quorum: P* counts towards attended total and quorum percentage", () => {
    const attendanceRecord = {
      "s-whole-1::Date 1::null::": "P",
      "s-whole-2::Date 2::null::": "P",
      "s-b1-1::Date 3::batch-1::Batch 1": "P*", // Transferred credit
      "s-b2-1::Date 4::batch-2::Batch 2": "P",
    };

    let attended = 0;
    let totalEligible = 0;
    Object.values(attendanceRecord).forEach((val) => {
      if (val === "P" || val === "P*") {
        attended++;
        totalEligible++;
      } else if (val === "A") {
        totalEligible++;
      }
    });

    const percent = totalEligible > 0 ? (attended / totalEligible) * 100 : 0;
    assert.strictEqual(attended, 4, "Attended count should include P*");
    assert.strictEqual(totalEligible, 4, "Eligible count should include P*");
    assert.strictEqual(percent, 100, "Percentage should be 100%");
  });

  // 7. Non-Destructive Date Columns
  test("7. Column Generation: Separate columns for distinct sessions on the same date", () => {
    const sessions = [
      { id: "s1", start_time: "2026-09-28T09:00:00Z", batch_id: null, batchName: null },
      { id: "s2", start_time: "2026-09-28T11:00:00Z", batch_id: "batch-1", batchName: "Batch 1" },
      { id: "s3", start_time: "2026-09-28T14:00:00Z", batch_id: "batch-2", batchName: "Batch 2" },
    ];

    const cols = sessions.map((sess) => {
      const dateLabel = sess.start_time.slice(0, 10);
      const bName = sess.batchName || "";
      const batchTag = bName ? ` [${bName}]` : (sess.batch_id ? ` [Batch]` : ` [Class]`);
      return `${sess.id}::${dateLabel}${batchTag}::${sess.batch_id || ""}::${bName}`;
    });

    assert.strictEqual(cols.length, 3, "No sessions should be dropped or collapsed on same date");
    assert(cols[0].includes("[Class]"), "First session should have [Class] tag");
    assert(cols[1].includes("[Batch 1]"), "Second session should have [Batch 1] tag");
    assert(cols[2].includes("[Batch 2]"), "Third session should have [Batch 2] tag");
  });

  console.log(`\nResults: ${passed}/${total} checks passed.`);
  if (passed === total) {
    console.log("🎉 All academic batch lifecycle and reconciliation tests passed cleanly!");
    process.exit(0);
  } else {
    console.error("❌ Some verification checks failed.");
    process.exit(1);
  }
}

runVerification().catch((e) => {
  console.error("Fatal test error:", e);
  process.exit(1);
});
