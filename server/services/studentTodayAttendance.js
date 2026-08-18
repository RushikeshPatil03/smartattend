const { getSupabaseClient } = require("../config/supabase");

const APP_TIMEZONE = process.env.APP_TIMEZONE || "Asia/Kolkata";
const IST_OFFSET_MINUTES = Number(process.env.APP_TIMEZONE_OFFSET_MINUTES || 330);

function getTodayRange() {
  const now = new Date();

  // Shift into IST, snap to local midnight, shift back to UTC
  const shiftedNow = new Date(now.getTime() + IST_OFFSET_MINUTES * 60 * 1000);
  const startOfShiftedDay = new Date(shiftedNow);
  startOfShiftedDay.setUTCHours(0, 0, 0, 0);

  const start = new Date(
    startOfShiftedDay.getTime() - IST_OFFSET_MINUTES * 60 * 1000
  );

  return { start, now };
}

function isEligibleSessionForStudent(session, student) {
  const subject = session?.subject;
  if (!subject) return false;

  const sameInstitution =
    String(subject.created_by_admin || subject.createdByAdmin || "") ===
    String(student.created_by_admin || student.createdByAdmin || "");
  if (!sameInstitution) return false;

  const sessionDept = session.department;
  const studentDept = student.department;

  if (sessionDept) {
    const sessionDeptId = typeof sessionDept === "object" ? sessionDept.id : sessionDept;
    const studentDeptId = typeof studentDept === "object" ? studentDept.id : studentDept;
    return String(sessionDeptId) === String(studentDeptId);
  }

  const depts = subject.departments || [];
  const studentDeptId = typeof studentDept === "object" ? studentDept.id : studentDept;
  return depts.some((d) => String(d) === String(studentDeptId));
}

function mapSessionRow(session, attendance) {
  const subject = session?.subject;
  const faculty = session?.faculty;
  const present = Boolean(attendance);

  const sessionId = session?.id || session?._id || attendance?.session || null;
  const attendanceId = attendance?.id || attendance?._id || null;

  return {
    attendanceId,
    _id: attendanceId || sessionId,
    sessionId,
    subjectName: subject?.name || "Subject",
    subjectCode: String(subject?.code || subject?.name || "SUB").toUpperCase(),
    facultyName: faculty?.name || "Faculty",
    startTime: session?.start_time || session?.startTime || null,
    endTime: session?.end_time || session?.endTime || null,
    markedAt: attendance?.timestamp || null,
    isActive: Boolean(session?.is_active ?? session?.isActive),
    status: present ? "present" : "absent",
    attendanceCode: present ? "P" : "A",
    present,
  };
}

async function getStudentTodayAttendance(studentId) {
  const { start, now } = getTodayRange();
  const supabase = getSupabaseClient();

  if (!supabase) {
    return {
      start,
      now,
      timezone: APP_TIMEZONE,
      classes: [],
    };
  }

  const { data: student } = await supabase
    .from("students")
    .select("id, year, semester, section, department, created_by_admin")
    .eq("id", String(studentId))
    .single();

  if (!student) {
    return {
      start,
      now,
      timezone: APP_TIMEZONE,
      classes: [],
    };
  }

  const normalizedSection = String(student.section || "").trim().toUpperCase();

  const { data: rawSessions } = await supabase
    .from("sessions")
    .select(`
      id,
      year,
      semester,
      section,
      department,
      start_time,
      end_time,
      is_active,
      subject:subjects(id, name, code, departments, created_by_admin),
      faculty:faculties(id, name)
    `)
    .eq("year", Number(student.year))
    .eq("semester", Number(student.semester))
    .eq("section", normalizedSection)
    .gte("start_time", start.toISOString())
    .lte("start_time", now.toISOString())
    .order("start_time", { ascending: true });

  const sessions = Array.isArray(rawSessions) ? rawSessions : [];
  const eligibleSessions = sessions.filter((session) =>
    isEligibleSessionForStudent(session, student)
  );
  const sessionIds = eligibleSessions.map((session) => session.id);

  let attendanceRows = [];
  if (sessionIds.length > 0) {
    const { data: attData } = await supabase
      .from("attendances")
      .select("id, session, timestamp, status")
      .eq("student", String(studentId))
      .in("session", sessionIds)
      .eq("status", "present")
      .order("timestamp", { ascending: true });

    attendanceRows = Array.isArray(attData) ? attData : [];
  }

  const attendanceBySession = new Map(
    attendanceRows.map((row) => [String(row.session), row])
  );

  const rows = eligibleSessions.map((session) =>
    mapSessionRow(session, attendanceBySession.get(String(session.id)))
  );

  return {
    start,
    now,
    timezone: APP_TIMEZONE,
    classes: rows.filter((row) => row.sessionId && row.startTime),
  };
}

module.exports = {
  APP_TIMEZONE,
  getStudentTodayAttendance,
};
