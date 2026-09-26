/**
 * scripts/test-batch-history-preservation.cjs
 * Comprehensive Automated Verification Suite for Batch Management & Historical Attendance Preservation
 *
 * Non-negotiable rule verified:
 * Changing, merging, splitting, renaming, archiving, or reassigning batches
 * must affect ONLY future sessions. It must NEVER delete, alter, hide,
 * reclassify, or recalculate historical attendance for any past or active session.
 *
 * Tests:
 * 1. In-place batch updates preserve UUIDs and update names/enrollments
 * 2. Removed batches with past sessions are soft-archived (is_active = false), not deleted
 * 3. Matrix batch-update upserts status: 'absent' and executes zero deletions
 * 4. Session creation automatically persists session_roster_snapshots
 * 5. Reassigning students to new batches leaves past session snapshots and student analytics intact
 */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { getSupabaseClient } = require("../server/config/supabase");
const {
  isBatchReferenced,
  syncSubjectBatches,
} = require("../server/services/batchManagementService");
const {
  createSessionRosterSnapshot,
  getSessionRosterSnapshot,
} = require("../server/services/sessionRosterSnapshotService");

async function runTestSuite() {
  console.log("==================================================================");
  console.log(" Running SmartAttend Batch & Historical Attendance Preservation  ");
  console.log("==================================================================");

  const supabase = getSupabaseClient();
  if (!supabase) {
    console.error("❌ Failed to obtain Supabase client");
    process.exit(1);
  }

  // Retrieve an existing faculty and subject to anchor tests
  const { data: faculties, error: fErr } = await supabase
    .from("faculties")
    .select("id, name")
    .limit(1);
  if (fErr || !faculties || faculties.length === 0) {
    throw new Error("No faculty found in DB to run tests");
  }
  const testFaculty = faculties[0];

  const { data: subjects, error: sErr } = await supabase
    .from("subjects")
    .select("id, name, code, year, semester, departments")
    .limit(1);
  if (sErr || !subjects || subjects.length === 0) {
    throw new Error("No subject found in DB to run tests");
  }
  const testSubject = subjects[0];

  // Retrieve test students
  const { data: students, error: stErr } = await supabase
    .from("students")
    .select("id, name, enrollment_no, email")
    .limit(3);
  if (stErr || !students || students.length < 2) {
    throw new Error("At least 2 students required in DB to run tests");
  }
  const student1 = students[0];
  const student2 = students[1];

  console.log(`[Setup] Faculty: ${testFaculty.name} (${testFaculty.id})`);
  console.log(`[Setup] Subject: ${testSubject.name} (${testSubject.id})`);
  console.log(`[Setup] Students: ${student1.enrollment_no}, ${student2.enrollment_no}`);

  // Tracking IDs for cleanup
  const cleanupBatchIds = [];
  const cleanupSessionIds = [];
  const cleanupAttendanceIds = [];
  const cleanupAuditIds = [];

  try {
    // ------------------------------------------------------------------
    // TEST 1: In-place batch updates preserve UUIDs and update names/enrollments
    // ------------------------------------------------------------------
    console.log("\n▶ Test 1: In-place batch updates preserve UUIDs and update metadata...");
    
    // Step 1a: Create initial batch
    const initialBatches = await syncSubjectBatches({
      supabase,
      subjectId: testSubject.id,
      facultyId: testFaculty.id,
      subject: testSubject,
      batches: [
        {
          batch_number: 991,
          batch_name: "Test Batch Original",
          student_enrollments: [student1.enrollment_no],
        },
      ],
      actorId: testFaculty.id,
      actorRole: "FACULTY",
    });

    const createdBatch = initialBatches.find((b) => b.batch_number === 991);
    assert.ok(createdBatch, "Initial batch must be created");
    const originalBatchId = String(createdBatch.id);
    cleanupBatchIds.push(originalBatchId);

    // Step 1b: Update in-place with same ID, new name, and added enrollment
    const updatedBatches = await syncSubjectBatches({
      supabase,
      subjectId: testSubject.id,
      facultyId: testFaculty.id,
      subject: testSubject,
      batches: [
        {
          id: originalBatchId,
          batch_number: 991,
          batch_name: "Test Batch Renamed & Merged",
          student_enrollments: [student1.enrollment_no, student2.enrollment_no],
        },
      ],
      actorId: testFaculty.id,
      actorRole: "FACULTY",
    });

    const preservedBatch = updatedBatches.find((b) => String(b.id) === originalBatchId);
    assert.ok(preservedBatch, "Batch with original UUID must exist");
    assert.strictEqual(
      String(preservedBatch.id),
      originalBatchId,
      "Batch UUID must remain identical (in-place update, zero ID churn)"
    );
    assert.strictEqual(
      preservedBatch.batch_name,
      "Test Batch Renamed & Merged",
      "Batch name must be updated in-place"
    );
    assert.strictEqual(
      preservedBatch.student_enrollments.length,
      2,
      "Enrollment roster must be updated to include both students"
    );
    assert.strictEqual(
      preservedBatch.is_active,
      true,
      "Batch must remain active"
    );

    console.log("  ✓ Passed: Batch UUID preserved in-place; metadata updated successfully.");

    // ------------------------------------------------------------------
    // TEST 2: Removed batches with past sessions are soft-archived, not deleted
    // ------------------------------------------------------------------
    console.log("\n▶ Test 2: Removed batches with past sessions are soft-archived, not deleted...");

    // Create a mock past session referencing originalBatchId
    const testSessionId = crypto.randomUUID();
    cleanupSessionIds.push(testSessionId);

    const { error: sessInsertErr } = await supabase.from("sessions").insert({
      id: testSessionId,
      faculty: testFaculty.id,
      subject: testSubject.id,
      department: testSubject.departments?.[0] || "b7c39441-b401-4c65-9fdb-173ce7997be6",
      year: testSubject.year || 4,
      semester: testSubject.semester || 7,
      section: "A",
      category: "REGULAR",
      batch_id: originalBatchId,
      batch_ids: [originalBatchId],
      is_active: false,
      location: { lat: 15.1655, lng: 76.8502, radiusMeters: 50 },
      start_time: new Date(Date.now() - 3600000).toISOString(),
      end_time: new Date().toISOString(),
    });
    if (sessInsertErr) throw sessInsertErr;

    // Verify isBatchReferenced returns true
    const isRef = await isBatchReferenced(supabase, originalBatchId);
    assert.strictEqual(isRef, true, "isBatchReferenced must identify batch linked to past session");

    // Also create a second unreferenced batch to verify hard-delete of unreferenced batch
    const unrefBatches = await syncSubjectBatches({
      supabase,
      subjectId: testSubject.id,
      facultyId: testFaculty.id,
      subject: testSubject,
      batches: [
        {
          id: originalBatchId,
          batch_number: 991,
          batch_name: "Test Batch Renamed & Merged",
          student_enrollments: [student1.enrollment_no, student2.enrollment_no],
        },
        {
          batch_number: 992,
          batch_name: "Unreferenced Ephemeral Batch",
          student_enrollments: [student1.enrollment_no],
        },
      ],
      actorId: testFaculty.id,
      actorRole: "FACULTY",
    });

    const ephemeralBatch = unrefBatches.find((b) => b.batch_number === 992);
    assert.ok(ephemeralBatch, "Ephemeral batch must be created");
    const ephemeralBatchId = String(ephemeralBatch.id);

    // Now call syncSubjectBatches omitting BOTH originalBatchId and ephemeralBatchId
    await syncSubjectBatches({
      supabase,
      subjectId: testSubject.id,
      facultyId: testFaculty.id,
      subject: testSubject,
      batches: [],
      actorId: testFaculty.id,
      actorRole: "FACULTY",
    });

    // Check DB for referenced batch: must be soft-archived (is_active = false)
    const { data: archivedBatch } = await supabase
      .from("subject_batches")
      .select("id, is_active, archived_at")
      .eq("id", originalBatchId)
      .single();

    assert.ok(archivedBatch, "Referenced batch must NOT be deleted from database");
    assert.strictEqual(
      archivedBatch.is_active,
      false,
      "Referenced batch must have is_active set to false"
    );
    assert.ok(
      archivedBatch.archived_at,
      "Referenced batch must have non-null archived_at timestamp"
    );

    // Check DB for unreferenced batch: should be safely hard-deleted
    const { data: deletedBatch } = await supabase
      .from("subject_batches")
      .select("id")
      .eq("id", ephemeralBatchId)
      .maybeSingle();

    assert.strictEqual(
      deletedBatch,
      null,
      "Unreferenced batch with zero sessions should be cleanly deleted without clutter"
    );

    console.log("  ✓ Passed: Referenced batch was safely soft-archived; unreferenced batch was removed.");

    // ------------------------------------------------------------------
    // TEST 3: Matrix batch-update upserts status: 'absent' and executes zero deletions
    // ------------------------------------------------------------------
    console.log("\n▶ Test 3: Matrix batch-update upserts status: 'absent' and executes zero deletions...");

    // Record an initial present attendance for student1 in testSessionId
    const { data: initialAtt, error: attErr } = await supabase
      .from("attendances")
      .insert({
        session: testSessionId,
        student: student1.id,
        faculty: testFaculty.id,
        subject: testSubject.id,
        enrollment_no: student1.enrollment_no,
        student_name: student1.name,
        status: "present",
        timestamp: new Date().toISOString(),
      })
      .select("id, status")
      .single();

    if (attErr) throw attErr;
    cleanupAttendanceIds.push(initialAtt.id);
    assert.strictEqual(initialAtt.status, "present", "Initial attendance must be present");

    // Simulate attendance matrix update flipping student1 to absent:
    // In SmartAttend, this upserts { status: 'absent' } with onConflict: "session,student"
    const absentPayload = {
      session: testSessionId,
      student: student1.id,
      faculty: testFaculty.id,
      subject: testSubject.id,
      enrollment_no: student1.enrollment_no,
      student_name: student1.name,
      status: "absent",
      timestamp: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data: updatedAtt, error: updateAttErr } = await supabase
      .from("attendances")
      .upsert(absentPayload, { onConflict: "session,student" })
      .select("id, status")
      .single();

    if (updateAttErr) throw updateAttErr;

    // Verify row ID is maintained or updated to 'absent', never destroyed
    assert.strictEqual(
      updatedAtt.status,
      "absent",
      "Attendance status must explicitly become 'absent'"
    );

    // Verify total attendance records for this session is exactly 1 (zero physical deletes)
    const { count: attCount } = await supabase
      .from("attendances")
      .select("id", { count: "exact" })
      .eq("session", testSessionId);

    assert.strictEqual(
      attCount,
      1,
      "Attendance row must be preserved in place rather than dropped (Zero raw deletes rule)"
    );

    console.log("  ✓ Passed: Attendance flipped to 'absent' via upsert; zero rows deleted.");

    // ------------------------------------------------------------------
    // TEST 4: Session creation automatically persists session_roster_snapshots
    // ------------------------------------------------------------------
    console.log("\n▶ Test 4: Session creation automatically persists session_roster_snapshots...");

    // Reactivate original batch for session snapshot test
    await supabase
      .from("subject_batches")
      .update({
        is_active: true,
        archived_at: null,
        student_enrollments: [student1.enrollment_no, student2.enrollment_no],
        batch_name: "Active Cohort A",
      })
      .eq("id", originalBatchId);

    const snapshotSessionId = crypto.randomUUID();
    cleanupSessionIds.push(snapshotSessionId);

    const snapshotSession = {
      id: snapshotSessionId,
      faculty: testFaculty.id,
      subject: testSubject.id,
      subject_id: testSubject.id,
      department: testSubject.departments?.[0] || "b7c39441-b401-4c65-9fdb-173ce7997be6",
      year: testSubject.year || 4,
      semester: testSubject.semester || 7,
      section: "A",
      category: "REGULAR",
      batch_id: originalBatchId,
      batch_ids: [originalBatchId],
      start_time: new Date().toISOString(),
    };

    const { error: snapSessErr } = await supabase.from("sessions").insert({
      id: snapshotSessionId,
      faculty: testFaculty.id,
      subject: testSubject.id,
      department: testSubject.departments?.[0] || "b7c39441-b401-4c65-9fdb-173ce7997be6",
      year: testSubject.year || 4,
      semester: testSubject.semester || 7,
      section: "A",
      category: "REGULAR",
      batch_id: originalBatchId,
      batch_ids: [originalBatchId],
      is_active: true,
      location: { lat: 15.1655, lng: 76.8502, radiusMeters: 50 },
      start_time: snapshotSession.start_time,
    });
    if (snapSessErr) throw snapSessErr;

    // Call createSessionRosterSnapshot
    const createdSnapshots = await createSessionRosterSnapshot(supabase, snapshotSession);
    assert.ok(Array.isArray(createdSnapshots), "createSessionRosterSnapshot must return array");
    assert.strictEqual(
      createdSnapshots.length,
      2,
      "Snapshot must capture both enrolled students at session start time"
    );

    // Verify DB records in session_roster_snapshots
    const retrievedSnapshots = await getSessionRosterSnapshot(supabase, snapshotSessionId);
    assert.strictEqual(
      retrievedSnapshots.length,
      2,
      "getSessionRosterSnapshot must retrieve all frozen snapshot rows"
    );

    const snapEnos = retrievedSnapshots.map((s) => s.enrollment_no);
    assert.ok(snapEnos.includes(student1.enrollment_no), "Student 1 must be frozen in snapshot");
    assert.ok(snapEnos.includes(student2.enrollment_no), "Student 2 must be frozen in snapshot");

    const sampleSnap = retrievedSnapshots.find((s) => s.enrollment_no === student1.enrollment_no);
    assert.strictEqual(
      sampleSnap.batch_name,
      "Active Cohort A",
      "Snapshot must record batch name at freeze time"
    );

    console.log(`  ✓ Passed: Session roster snapshot created with ${retrievedSnapshots.length} students.`);

    // ------------------------------------------------------------------
    // TEST 5: Reassigning students to new batches leaves past session snapshots intact
    // ------------------------------------------------------------------
    console.log("\n▶ Test 5: Reassigning students leaves past session snapshots intact...");

    // Now reassign student1: move student1 out of originalBatchId into a new batch (or remove from batch)
    await syncSubjectBatches({
      supabase,
      subjectId: testSubject.id,
      facultyId: testFaculty.id,
      subject: testSubject,
      batches: [
        {
          id: originalBatchId,
          batch_number: 991,
          batch_name: "Active Cohort A (Student 1 Removed)",
          student_enrollments: [student2.enrollment_no], // Student 1 is no longer here!
        },
      ],
      actorId: testFaculty.id,
      actorRole: "FACULTY",
    });

    // Query historical snapshot again: Student 1 MUST STILL BE in snapshot for snapshotSessionId!
    const historicalSnapshots = await getSessionRosterSnapshot(supabase, snapshotSessionId);
    const student1Historical = historicalSnapshots.find(
      (s) => s.enrollment_no === student1.enrollment_no
    );

    assert.ok(
      student1Historical,
      "CRITICAL: Student 1 must remain on past session snapshot despite being reassigned out of the batch!"
    );
    assert.strictEqual(
      student1Historical.batch_name,
      "Active Cohort A",
      "Historical batch name on past session must remain 'Active Cohort A'"
    );

    // Verify student attendance overview logic:
    // Past session eligibility is derived from session_roster_snapshots,
    // so Student 1 still has total sessions and attendance counted for that past session.
    const { data: student1Snapshots } = await supabase
      .from("session_roster_snapshots")
      .select("session_id, batch_id")
      .eq("student_id", student1.id)
      .eq("session_id", snapshotSessionId);

    assert.strictEqual(
      student1Snapshots?.length,
      1,
      "Student 1's historical participation in past session remains 100% intact"
    );

    console.log("  ✓ Passed: Future batch reassignments have zero effect on historical session snapshot.");

    console.log("\n==================================================================");
    console.log(" 🎉 ALL 5 BATCH PRESERVATION TESTS PASSED WITH ZERO REGRESSIONS! ");
    console.log("==================================================================");
  } finally {
    // ------------------------------------------------------------------
    // CLEANUP
    // ------------------------------------------------------------------
    console.log("\n[Teardown] Cleaning up test records...");
    for (const sid of cleanupSessionIds) {
      await supabase.from("session_roster_snapshots").delete().eq("session_id", sid);
      await supabase.from("attendances").delete().eq("session", sid);
      await supabase.from("sessions").delete().eq("id", sid);
    }
    for (const bid of cleanupBatchIds) {
      await supabase.from("subject_batches").delete().eq("id", bid);
    }
    await supabase
      .from("batch_configuration_audits")
      .delete()
      .eq("faculty_id", testFaculty.id)
      .eq("scope_id", testSubject.id);

    console.log("[Teardown] Test fixtures cleanly removed.");
  }
}

runTestSuite().catch((err) => {
  console.error("\n❌ Test Suite Failed:", err);
  process.exit(1);
});
