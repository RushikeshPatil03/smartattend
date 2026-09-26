// server/services/batchManagementService.js
/**
 * Safe, In-Place Batch Management Service
 * Ensures changing, merging, splitting, renaming, archiving, or reassigning batches
 * affects ONLY future sessions and NEVER deletes or distorts historical attendance.
 */

/**
 * Checks whether a batch ID is referenced by any historical or active session,
 * roster snapshot, or recorded attendance.
 */
async function isBatchReferenced(supabase, batchId) {
  if (!batchId) return false;
  const bid = String(batchId).trim();
  if (!bid) return false;

  try {
    // 1. Check sessions (direct batch_id or batch_ids array)
    const { data: s1 } = await supabase
      .from("sessions")
      .select("id")
      .eq("batch_id", bid)
      .limit(1);
    if (s1 && s1.length > 0) return true;

    const { data: s2 } = await supabase
      .from("sessions")
      .select("id")
      .contains("batch_ids", [bid])
      .limit(1);
    if (s2 && s2.length > 0) return true;

    // 2. Check immutable session roster snapshots
    const { data: snap } = await supabase
      .from("session_roster_snapshots")
      .select("id")
      .eq("batch_id", bid)
      .limit(1);
    if (snap && snap.length > 0) return true;

    // 3. Check recorded attendances
    const { data: att } = await supabase
      .from("attendances")
      .select("id")
      .eq("batch_id", bid)
      .limit(1);
    if (att && att.length > 0) return true;

    return false;
  } catch (err) {
    console.warn(`[batchManagementService] Error checking references for batch ${bid}:`, err.message);
    // If in doubt, assume referenced to protect data integrity
    return true;
  }
}

/**
 * Syncs subject batches in-place without destructive blind wipes.
 */
async function syncSubjectBatches({
  supabase,
  subjectId,
  facultyId,
  subject,
  batches,
  actorId,
  actorRole,
}) {
  const targetFacultyId = String(facultyId);
  const cleanSubjectId = String(subjectId);

  // 1. Fetch current batches in DB for this subject and faculty
  const { data: existingBatches, error: fetchErr } = await supabase
    .from("subject_batches")
    .select("id, subject_id, faculty_id, department_id, year, semester, section, batch_number, batch_name, student_enrollments, is_active")
    .eq("subject_id", cleanSubjectId)
    .eq("faculty_id", targetFacultyId);

  if (fetchErr) throw fetchErr;

  const existingList = existingBatches || [];
  const existingMap = new Map(existingList.map((b) => [String(b.id), b]));

  const incomingBatches = Array.isArray(batches) ? batches : [];
  const incomingIds = new Set(
    incomingBatches
      .map((b) => b.id ? String(b.id) : null)
      .filter(Boolean)
  );

  // 2. Handle removed batches (in DB but not in incoming)
  for (const oldBatch of existingList) {
    const oldId = String(oldBatch.id);
    if (!incomingIds.has(oldId)) {
      const referenced = await isBatchReferenced(supabase, oldId);
      if (referenced) {
        // Soft archive: keep row to preserve historical sessions
        await supabase
          .from("subject_batches")
          .update({
            is_active: false,
            archived_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", oldId);
      } else {
        // Unreferenced: safe to hard delete
        await supabase
          .from("subject_batches")
          .delete()
          .eq("id", oldId);
      }
    }
  }

  // 3. Process incoming batches (update existing in-place, insert new)
  for (let idx = 0; idx < incomingBatches.length; idx++) {
    const b = incomingBatches[idx];
    const batchNumber = Number(b.batch_number || b.batchNumber || idx + 1);
    const batchName = String(b.batch_name || b.batchName || `Batch ${batchNumber}`).trim();
    const studentEnrollments = Array.isArray(b.student_enrollments || b.studentEnrollments)
      ? (b.student_enrollments || b.studentEnrollments)
          .map((u) => String(u).trim().toUpperCase())
          .filter(Boolean)
      : [];

    const bYear = b.year ? Number(b.year) : (subject?.year ? Number(subject.year) : null);
    const bSem = b.semester ? Number(b.semester) : (subject?.semester ? Number(subject.semester) : null);
    const bSec = b.section ? String(b.section).trim().toUpperCase() : null;
    const bDept = b.department_id || (Array.isArray(subject?.departments) ? subject.departments[0] : null);

    if (b.id && existingMap.has(String(b.id))) {
      // Update in-place: preserves existing UUID and links to past sessions
      await supabase
        .from("subject_batches")
        .update({
          department_id: bDept,
          year: bYear,
          semester: bSem,
          section: bSec,
          batch_number: batchNumber,
          batch_name: batchName,
          student_enrollments: studentEnrollments,
          is_active: true,
          archived_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", String(b.id));
    } else {
      // New batch insertion
      await supabase
        .from("subject_batches")
        .insert({
          subject_id: cleanSubjectId,
          faculty_id: targetFacultyId,
          department_id: bDept,
          year: bYear,
          semester: bSem,
          section: bSec,
          batch_number: batchNumber,
          batch_name: batchName,
          student_enrollments: studentEnrollments,
          is_active: true,
          archived_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
    }
  }

  // 4. Fetch final active batches
  const { data: finalActiveBatches, error: finalErr } = await supabase
    .from("subject_batches")
    .select("id, subject_id, faculty_id, department_id, year, semester, section, batch_number, batch_name, student_enrollments, is_active, created_at, updated_at")
    .eq("subject_id", cleanSubjectId)
    .eq("faculty_id", targetFacultyId)
    .eq("is_active", true)
    .order("batch_number", { ascending: true });

  if (finalErr) throw finalErr;

  const resultBatches = finalActiveBatches || [];

  // 5. Audit Log (append-only)
  try {
    await supabase
      .from("batch_configuration_audits")
      .insert({
        scope_type: "SUBJECT",
        scope_id: cleanSubjectId,
        faculty_id: targetFacultyId,
        actor_id: actorId || targetFacultyId,
        actor_role: actorRole || "FACULTY",
        operation_type: "sync_batches",
        before_state: existingList,
        after_state: resultBatches,
        summary: `Synced ${resultBatches.length} active batches for subject ${subject?.code || cleanSubjectId}`,
        created_at: new Date().toISOString(),
      });
  } catch (auditErr) {
    console.warn("[batchManagementService] Failed to record subject batch audit:", auditErr.message);
  }

  return resultBatches;
}

/**
 * Syncs activity batches in-place without destructive blind wipes.
 */
async function syncActivityBatches({
  supabase,
  activityId,
  facultyId,
  batches,
  actorId,
  actorRole,
}) {
  const cleanActivityId = String(activityId);
  const targetFacultyId = String(facultyId);

  // 1. Fetch current batches in DB for this activity
  const { data: existingBatches, error: fetchErr } = await supabase
    .from("activity_batches")
    .select("id, activity_id, batch_number, batch_name, student_enrollments, is_active")
    .eq("activity_id", cleanActivityId);

  if (fetchErr) throw fetchErr;

  const existingList = existingBatches || [];
  const existingMap = new Map(existingList.map((b) => [String(b.id), b]));

  const incomingBatches = Array.isArray(batches) ? batches : [];
  const incomingIds = new Set(
    incomingBatches
      .map((b) => b.id ? String(b.id) : null)
      .filter(Boolean)
  );

  // 2. Handle removed batches
  for (const oldBatch of existingList) {
    const oldId = String(oldBatch.id);
    if (!incomingIds.has(oldId)) {
      const referenced = await isBatchReferenced(supabase, oldId);
      if (referenced) {
        await supabase
          .from("activity_batches")
          .update({
            is_active: false,
            archived_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", oldId);
      } else {
        await supabase
          .from("activity_batches")
          .delete()
          .eq("id", oldId);
      }
    }
  }

  // 3. Process incoming batches
  for (let idx = 0; idx < incomingBatches.length; idx++) {
    const b = incomingBatches[idx];
    const batchNumber = Number(b.batch_number || b.batchNumber || idx + 1);
    const batchName = String(b.batch_name || b.batchName || `Batch ${batchNumber}`).trim();
    const studentEnrollments = Array.isArray(b.student_enrollments || b.studentEnrollments)
      ? (b.student_enrollments || b.studentEnrollments)
          .map((u) => String(u).trim().toUpperCase())
          .filter(Boolean)
      : [];

    if (b.id && existingMap.has(String(b.id))) {
      await supabase
        .from("activity_batches")
        .update({
          batch_number: batchNumber,
          batch_name: batchName,
          student_enrollments: studentEnrollments,
          is_active: true,
          archived_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", String(b.id));
    } else {
      await supabase
        .from("activity_batches")
        .insert({
          activity_id: cleanActivityId,
          batch_number: batchNumber,
          batch_name: batchName,
          student_enrollments: studentEnrollments,
          is_active: true,
          archived_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
    }
  }

  // 4. Fetch final active batches
  const { data: finalActiveBatches, error: finalErr } = await supabase
    .from("activity_batches")
    .select("id, activity_id, batch_number, batch_name, student_enrollments, is_active, created_at, updated_at")
    .eq("activity_id", cleanActivityId)
    .eq("is_active", true)
    .order("batch_number", { ascending: true });

  if (finalErr) throw finalErr;

  const resultBatches = finalActiveBatches || [];

  // 5. Audit Log (append-only)
  try {
    await supabase
      .from("batch_configuration_audits")
      .insert({
        scope_type: "ACTIVITY",
        scope_id: cleanActivityId,
        faculty_id: targetFacultyId,
        actor_id: actorId || targetFacultyId,
        actor_role: actorRole || "FACULTY",
        operation_type: "sync_batches",
        before_state: existingList,
        after_state: resultBatches,
        summary: `Synced ${resultBatches.length} active batches for activity ${cleanActivityId}`,
        created_at: new Date().toISOString(),
      });
  } catch (auditErr) {
    console.warn("[batchManagementService] Failed to record activity batch audit:", auditErr.message);
  }

  return resultBatches;
}

module.exports = {
  isBatchReferenced,
  syncSubjectBatches,
  syncActivityBatches,
};
