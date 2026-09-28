import { useMemo } from "react";
import type { EnrichedSheetRow } from "./AttendanceRosterTable";

export interface UseAttendanceLedgerParams {
  sessions: any[];
  batches: any[];
  attendances: any[];
  students: any[];
  selectedBatchId?: string;
  searchQuery?: string;
  filterAtRisk?: boolean;
  sessionRosterSnapshots?: any[];
}

/**
 * Bidirectional Batch-Merging & Splitting Attendance Preservation Engine
 * useAttendanceLedger Hook: Seamlessly calculates quorum percentages,
 * manages eligibility-aware denominators, and projects combined/split attendance views.
 */
export function useAttendanceLedger({
  sessions,
  batches,
  attendances,
  students,
  selectedBatchId = "ALL",
  searchQuery = "",
  filterAtRisk = false,
  sessionRosterSnapshots,
}: UseAttendanceLedgerParams) {
  return useMemo(() => {
    const isAll = !selectedBatchId || selectedBatchId === "ALL" || selectedBatchId === "all";
    const batchMap = new Map((batches || []).map((b: any) => [String(b.id), b]));

    // Index immutable session roster snapshots if available
    const rawSnapshots = Array.isArray(sessionRosterSnapshots) ? sessionRosterSnapshots : [];
    const sessionSnapshotMap = new Map<string, Set<string>>();
    const sessionsWithSnapshots = new Set<string>();

    rawSnapshots.forEach((sn: any) => {
      const sid = String(sn.session_id || sn.sessionId || "");
      const usn = String(sn.enrollment_no || sn.enrollmentNo || "").trim().toUpperCase();
      if (sid) {
        sessionsWithSnapshots.add(sid);
        if (usn) {
          if (!sessionSnapshotMap.has(sid)) sessionSnapshotMap.set(sid, new Set());
          sessionSnapshotMap.get(sid)!.add(usn);
        }
      }
    });

    // 1. Build map of student USN -> Set of batch IDs they belong to
    const studentBatches = new Map<string, Set<string>>();
    (batches || []).forEach((b: any) => {
      const bId = String(b.id);
      if (Array.isArray(b.student_enrollments)) {
        b.student_enrollments.forEach((u: any) => {
          const usn = String(u || "").trim().toUpperCase();
          if (!studentBatches.has(usn)) studentBatches.set(usn, new Set());
          studentBatches.get(usn)!.add(bId);
        });
      }
    });

    // 2. Visible sessions with bidirectional continuity:
    // If specific batch: keep unbatched class sessions (batch_id is null) PLUS sessions for selectedBatchId
    // PLUS any historical sessions attended by students currently in this batch
    const currentBatchUsns = new Set(
      batches?.find((b: any) => String(b.id) === String(selectedBatchId))?.student_enrollments?.map((u: any) => String(u || "").trim().toUpperCase()) || []
    );

    const visibleSessions = (sessions || []).filter((s: any) => {
      if (isAll) return true;
      const bId = s.batch_id || (Array.isArray(s.batch_ids) && s.batch_ids.length === 1 ? s.batch_ids[0] : null);
      const isWholeClass = !bId && (!s.batch_ids || s.batch_ids.length === 0);
      const isThisBatch =
        String(bId) === String(selectedBatchId) ||
        (Array.isArray(s.batch_ids) && s.batch_ids.some((id: any) => String(id) === String(selectedBatchId)));

      const hasTransferredAttendee = (attendances || []).some(
        (att: any) =>
          String(att.session?._id || att.session || att.sessionId) === String(s.id || s._id) &&
          currentBatchUsns.has(String(att.student?.enrollmentNo || att.student?.enrollment_no || att.enrollment_no || att.enrollmentNo || "").toUpperCase()) &&
          String(att.status).toLowerCase() === "present"
      );

      return isWholeClass || isThisBatch || hasTransferredAttendee;
    }).sort((a: any, b: any) => {
      const tA = new Date(a.start_time || a.startTime || 0).getTime();
      const tB = new Date(b.start_time || b.startTime || 0).getTime();
      return tA - tB;
    });

    // 3. Format columns
    const columns = visibleSessions.map((sess: any) => {
      const dateObj = new Date(sess.start_time || sess.startTime || sess.created_at || Date.now());
      const dateLabel = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, "0")}-${String(dateObj.getDate()).padStart(2, "0")} ${String(dateObj.getHours()).padStart(2, "0")}:${String(dateObj.getMinutes()).padStart(2, "0")}`;
      const facName = sess.fac?.name || sess.faculty?.name || "";
      const formattedDate = facName ? `${dateLabel} (${facName})` : dateLabel;
      const bId = sess.batch_id || "";
      let bName = sess.batchName || "";
      if (!bName && bId && batchMap.has(String(bId))) {
        const matchedB = batchMap.get(String(bId));
        bName = matchedB?.batch_name || `Batch ${matchedB?.batch_number}`;
      }
      return `${sess.id || sess._id}::${formattedDate}::${bId}::${bName}`;
    });

    const parsedCols = columns.map((c) => {
      const parts = c.split("::");
      return {
        colStr: c,
        sessionId: parts[0],
        batchId: parts[2] || null,
      };
    });

    // 4. Map recorded attendances
    const presentSet = new Set<string>();
    (attendances || []).forEach((att: any) => {
      const eno = String(att.student?.enrollmentNo || att.student?.enrollment_no || att.enrollment_no || att.enrollmentNo || "").trim().toUpperCase();
      const sid = String(att.session?._id || att.session || att.sessionId || "").trim();
      if (eno && sid && String(att.status).toLowerCase() === "present") {
        presentSet.add(`${eno}|${sid}`);
      }
    });

    // 5. Build rows with dynamic eligibility-aware quorum
    let studentList = students || [];
    if (!isAll) {
      studentList = studentList.filter((s: any) => {
        const eno = String(s.enrollmentNo || s.enrollment_no || "").trim().toUpperCase();
        return (s.batchId && String(s.batchId) === String(selectedBatchId)) ||
          studentBatches.get(eno)?.has(String(selectedBatchId));
      });
    }

    const rows: EnrichedSheetRow[] = studentList.map((stu: any) => {
      const eno = String(stu.enrollmentNo || stu.enrollment_no || "").trim().toUpperCase();
      const stuBatchSet = studentBatches.get(eno) || new Set<string>();
      if (stu.batchId) stuBatchSet.add(String(stu.batchId));

      let attended = 0;
      let totalEligible = 0;
      const attRec: Record<string, "P" | "P*" | "A" | "—"> = {};

      for (let i = 0; i < parsedCols.length; i++) {
        const { colStr, sessionId, batchId } = parsedCols[i];
        let isEligible = false;
        if (sessionsWithSnapshots.has(sessionId)) {
          isEligible = Boolean(sessionSnapshotMap.get(sessionId)?.has(eno)) || presentSet.has(`${eno}|${sessionId}`);
        } else {
          const isEntireClass = !batchId || batchId === "null" || batchId === "undefined" || batchId === "";
          const isStudentInBatch = Boolean(batchId && stuBatchSet.has(String(batchId)));
          isEligible = isEntireClass || isStudentInBatch || !isAll;
        }

        if (!isEligible) {
          attRec[colStr] = "—";
        } else {
          totalEligible++;
          if (presentSet.has(`${eno}|${sessionId}`)) {
            attRec[colStr] = "P";
            attended++;
          } else {
            // Check if student attended in an alternate batch
            const attendedElsewhere = (attendances || []).some((att: any) => {
              const attEno = String(att.student?.enrollmentNo || att.student?.enrollment_no || att.enrollment_no || att.enrollmentNo || "").trim().toUpperCase();
              const attSid = String(att.session?._id || att.session || att.sessionId || "").trim();
              return attEno === eno && attSid === sessionId && String(att.status).toLowerCase() === "present";
            });

            if (attendedElsewhere) {
              attRec[colStr] = "P*";
              attended++;
            } else {
              attRec[colStr] = "A";
            }
          }
        }
      }

      const percent = totalEligible > 0 ? (attended / totalEligible) * 100 : 0;
      const isCritical = totalEligible > 0 && percent < 60;
      const isWarning = totalEligible > 0 && percent >= 60 && percent < 75;
      const isAtRisk = isCritical || isWarning;

      return {
        name: stu.name || "Student",
        enrollmentNo: eno,
        attendance: attRec,
        attended,
        totalSessions: totalEligible,
        percent,
        isCritical,
        isWarning,
        isAtRisk,
        batchId: stu.batchId || null,
        batchName: stu.batchName || null,
      };
    }).sort((a, b) => a.enrollmentNo.localeCompare(b.enrollmentNo));

    const q = searchQuery.trim().toLowerCase();
    const filteredRows = rows.filter((r) => {
      if (filterAtRisk && !r.isAtRisk) return false;
      if (!q) return true;
      return r.name.toLowerCase().includes(q) || r.enrollmentNo.toLowerCase().includes(q);
    });

    return {
      visibleSessions,
      columns,
      rows: filteredRows,
      allRows: rows,
      totalEligibleCount: visibleSessions.length,
    };
  }, [sessions, batches, attendances, students, selectedBatchId, searchQuery, filterAtRisk]);
}

export default useAttendanceLedger;
