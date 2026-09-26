// server/services/sessionRosterSnapshotService.js
/**
 * Immutable Session Roster Snapshot Service
 * Freezes the expected roster at session start time so future batch modifications,
 * renames, splits, merges, or reassignments never alter past attendance history.
 */

/**
 * Creates and persists the immutable roster snapshot for a newly created session.
 * Throws an error if snapshot creation fails so the caller can abort/rollback the session.
 */
async function createSessionRosterSnapshot(supabase, session, options = {}) {
  const sessionId = String(session.id);
  const isActivity = session.category === "ACTIVITY" || Boolean(session.activity_id);
  const resolvedBatchIds = Array.isArray(session.batch_ids) && session.batch_ids.length > 0
    ? session.batch_ids.map(String).filter((b) => b && b !== "all" && b !== "ALL")
    : (session.batch_id && session.batch_id !== "all" && session.batch_id !== "ALL" ? [String(session.batch_id)] : []);

  const snapshotRows = [];
  const usnToBatchMeta = new Map(); // usn -> { batch_id, batch_name, batch_number }

  if (isActivity) {
    const activityId = String(session.activity_id);
    if (resolvedBatchIds.length > 0) {
      // 1a. Activity with specific batches
      const { data: batchesData, error: bErr } = await supabase
        .from("activity_batches")
        .select("id, batch_name, batch_number, student_enrollments")
        .in("id", resolvedBatchIds);
      if (bErr) throw bErr;

      (batchesData || []).forEach((b) => {
        const enrollments = Array.isArray(b.student_enrollments) ? b.student_enrollments : [];
        enrollments.forEach((u) => {
          const usn = String(u || "").trim().toUpperCase();
          if (usn && !usnToBatchMeta.has(usn)) {
            usnToBatchMeta.set(usn, {
              batch_id: b.id,
              batch_name: b.batch_name,
              batch_number: b.batch_number,
            });
          }
        });
      });
    } else {
      // 1b. Activity without specific batches: check if activity has batches or is department-wide
      const { data: batchesData } = await supabase
        .from("activity_batches")
        .select("id, batch_name, batch_number, student_enrollments")
        .eq("activity_id", activityId);

      if (Array.isArray(batchesData) && batchesData.length > 0) {
        batchesData.forEach((b) => {
          const enrollments = Array.isArray(b.student_enrollments) ? b.student_enrollments : [];
          enrollments.forEach((u) => {
            const usn = String(u || "").trim().toUpperCase();
            if (usn && !usnToBatchMeta.has(usn)) {
              usnToBatchMeta.set(usn, {
                batch_id: b.id,
                batch_name: b.batch_name,
                batch_number: b.batch_number,
              });
            }
          });
        });
      }
    }

    if (usnToBatchMeta.size > 0) {
      // Fetch student profiles for these USNs
      const usnList = Array.from(usnToBatchMeta.keys());
      const { data: studentsList } = await supabase
        .from("students")
        .select("id, name, enrollment_no, email")
        .in("enrollment_no", usnList);

      const stuMap = new Map((studentsList || []).map((s) => [String(s.enrollment_no).trim().toUpperCase(), s]));

      usnList.forEach((usn) => {
        const s = stuMap.get(usn);
        const meta = usnToBatchMeta.get(usn) || {};
        snapshotRows.push({
          session_id: sessionId,
          student_id: s?.id || null,
          enrollment_no: usn,
          student_name: s?.name || usn,
          student_email: s?.email || null,
          batch_id: meta.batch_id || null,
          batch_name: meta.batch_name || null,
          batch_number: meta.batch_number || null,
          category: "ACTIVITY",
          subject_id: null,
          activity_id: activityId,
          created_at: session.start_time || new Date().toISOString(),
        });
      });
    } else if (session.department) {
      // Whole-cohort fallback for activity
      let query = supabase
        .from("students")
        .select("id, name, enrollment_no, email")
        .eq("department", String(session.department));
      if (session.semester) query = query.eq("semester", Number(session.semester));
      if (session.section && String(session.section).toUpperCase() !== "ALL") {
        query = query.eq("section", String(session.section).trim().toUpperCase());
      }
      const { data: deptStudents } = await query;
      (deptStudents || []).forEach((s) => {
        const usn = String(s.enrollment_no || "").trim().toUpperCase();
        if (usn) {
          snapshotRows.push({
            session_id: sessionId,
            student_id: s.id,
            enrollment_no: usn,
            student_name: s.name || usn,
            student_email: s.email || null,
            batch_id: null,
            batch_name: null,
            batch_number: null,
            category: "ACTIVITY",
            subject_id: null,
            activity_id: activityId,
            created_at: session.start_time || new Date().toISOString(),
          });
        }
      });
    }
  } else {
    // 2. Academic Session
    const subjectId = String(session.subject);
    if (resolvedBatchIds.length > 0) {
      // 2a. Academic session for specific batches
      const { data: batchesData, error: bErr } = await supabase
        .from("subject_batches")
        .select("id, batch_name, batch_number, student_enrollments")
        .in("id", resolvedBatchIds);
      if (bErr) throw bErr;

      (batchesData || []).forEach((b) => {
        const enrollments = Array.isArray(b.student_enrollments) ? b.student_enrollments : [];
        enrollments.forEach((u) => {
          const usn = String(u || "").trim().toUpperCase();
          if (usn && !usnToBatchMeta.has(usn)) {
            usnToBatchMeta.set(usn, {
              batch_id: b.id,
              batch_name: b.batch_name,
              batch_number: b.batch_number,
            });
          }
        });
      });

      const usnList = Array.from(usnToBatchMeta.keys());
      if (usnList.length > 0) {
        const { data: studentsList } = await supabase
          .from("students")
          .select("id, name, enrollment_no, email")
          .in("enrollment_no", usnList);

        const stuMap = new Map((studentsList || []).map((s) => [String(s.enrollment_no).trim().toUpperCase(), s]));

        usnList.forEach((usn) => {
          const s = stuMap.get(usn);
          const meta = usnToBatchMeta.get(usn) || {};
          snapshotRows.push({
            session_id: sessionId,
            student_id: s?.id || null,
            enrollment_no: usn,
            student_name: s?.name || usn,
            student_email: s?.email || null,
            batch_id: meta.batch_id || null,
            batch_name: meta.batch_name || null,
            batch_number: meta.batch_number || null,
            category: "REGULAR",
            subject_id: subjectId,
            activity_id: null,
            created_at: session.start_time || new Date().toISOString(),
          });
        });
      }
    } else {
      // 2b. Whole class cohort session
      let query = supabase
        .from("students")
        .select("id, name, enrollment_no, email")
        .eq("year", Number(session.year))
        .eq("semester", Number(session.semester));

      if (session.department) {
        query = query.eq("department", String(session.department));
      }
      const normalizedSec = String(session.section || "").trim().toUpperCase();
      if (normalizedSec && normalizedSec !== "ALL") {
        query = query.eq("section", normalizedSec);
      }

      const { data: cohortStudents } = await query;
      (cohortStudents || []).forEach((s) => {
        const usn = String(s.enrollment_no || "").trim().toUpperCase();
        if (usn) {
          snapshotRows.push({
            session_id: sessionId,
            student_id: s.id,
            enrollment_no: usn,
            student_name: s.name || usn,
            student_email: s.email || null,
            batch_id: null,
            batch_name: null,
            batch_number: null,
            category: "REGULAR",
            subject_id: subjectId,
            activity_id: null,
            created_at: session.start_time || new Date().toISOString(),
          });
        }
      });
    }
  }

  // Deduplicate by enrollment_no
  const uniqueRowsMap = new Map();
  snapshotRows.forEach((r) => {
    if (!uniqueRowsMap.has(r.enrollment_no)) {
      uniqueRowsMap.set(r.enrollment_no, r);
    }
  });
  const dedupedRows = Array.from(uniqueRowsMap.values());

  if (dedupedRows.length > 0) {
    const { error: insErr } = await supabase
      .from("session_roster_snapshots")
      .insert(dedupedRows);

    if (insErr) {
      console.error("[sessionRosterSnapshotService] Failed to insert roster snapshot:", insErr);
      throw insErr;
    }
  }

  return dedupedRows;
}

/**
 * Fetches the frozen roster snapshot records for a single session.
 */
async function getSessionRosterSnapshot(supabase, sessionId) {
  if (!sessionId) return [];
  const { data, error } = await supabase
    .from("session_roster_snapshots")
    .select("id, session_id, student_id, enrollment_no, student_name, student_email, batch_id, batch_name, batch_number, category, subject_id, activity_id, created_at")
    .eq("session_id", String(sessionId))
    .order("enrollment_no", { ascending: true });

  if (error) {
    console.error("[sessionRosterSnapshotService] Error fetching snapshot for session:", error.message);
    return [];
  }
  return data || [];
}

/**
 * Fetches frozen roster snapshots for multiple session IDs.
 */
async function getSessionRosterSnapshotsForSessions(supabase, sessionIds) {
  if (!Array.isArray(sessionIds) || sessionIds.length === 0) return [];
  const { data, error } = await supabase
    .from("session_roster_snapshots")
    .select("id, session_id, student_id, enrollment_no, student_name, student_email, batch_id, batch_name, batch_number, category, subject_id, activity_id, created_at")
    .in("session_id", sessionIds.map(String))
    .order("enrollment_no", { ascending: true });

  if (error) {
    console.error("[sessionRosterSnapshotService] Error fetching snapshots for sessions:", error.message);
    return [];
  }
  return data || [];
}

module.exports = {
  createSessionRosterSnapshot,
  getSessionRosterSnapshot,
  getSessionRosterSnapshotsForSessions,
};
