export type Tab =
  | "TAKE_ATTENDANCE"
  | "MANAGE_ATTENDANCE"
  | "DEVICE_REQUESTS"
  | "MANAGE_SUBJECTS";

export type RecentClassPreset = {
  key: string;
  label: string;
  departmentId: string;
  departmentName: string;
  departmentCode: string;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  year: string;
  semester: string;
  section: string;
  radiusMeters: string;
  location: { lat: number; lng: number } | null;
  updatedAt: number;
  available?: boolean;
};

export type SessionFormDraft = {
  departmentId: string;
  year: string;
  semester: string;
  section: string;
  subjectId: string;
  radiusMeters: string;
  location: { lat: number; lng: number } | null;
  manualLat: string;
  manualLng: string;
};

export type FacultySubjectAnalyticsData = {
  subject: {
    id: string;
    name: string;
    code: string;
  };
  filters: {
    selectedClassCode: string;
    classCodes: Array<{
      classCode: string;
      departmentName: string;
      departmentCode: string;
      section: string;
      year: number;
      semester: number;
    }>;
  };
  overview: {
    totalClasses: number;
    totalStudents: number;
    activeStudents: number;
    studentsBelow75: number;
    averageAttendancePercentage: number;
    averagePresentCount: number;
  };
  classCodeInsights: Array<{
    classCode: string;
    departmentName: string;
    departmentCode: string;
    year: number;
    semester: number;
    section: string;
    totalClasses: number;
    studentCount: number;
    averageAttendancePercentage: number;
    averagePresentCount: number;
  }>;
  sessionInsights: Array<{
    sessionId: string;
    classCode: string;
    facultyName?: string;
    date: string;
    section: string;
    departmentName: string;
    presentCount: number;
    eligibleCount: number;
    attendancePercentage: number;
  }>;
  students: Array<{
    studentId: string;
    name: string;
    enrollmentNo: string;
    profilePhotoUrl: string;
    classCode: string;
    departmentName: string;
    section: string;
    year: number;
    semester: number;
    totalClasses: number;
    attendedClasses: number;
    missedClasses: number;
    attendancePercentage: number;
    lastAttendanceStatus: "present" | "absent" | "none";
    lastClassAt: string | null;
  }>;
};

export type LiveAttendanceItem = {
  _id?: string;
  id?: string;
  timestamp?: string | number;
  status: "present" | "absent";
  student?: {
    name?: string;
    enrollmentNo?: string;
    profilePhotoUrl?: string;
    email?: string;
  };
  enrollmentNo?: string;
  distanceMeters?: number;
  isFaceVerified?: boolean;
};

export type DeviceRequestItem = {
  _id: string;
  id?: string;
  status: "pending" | "approved" | "rejected" | "expired";
  createdAt?: string;
  expiresAt?: string;
  reviewedAt?: string;
  reviewNote?: string;
  selfieDataUrl?: string;
  student?: {
    name?: string;
    enrollmentNo?: string;
    email?: string;
    year?: number | string;
    semester?: number | string;
    section?: string;
    profilePhotoUrl?: string;
  };
  reviewedBy?: {
    name?: string;
  };
  requestedCredentialId?: string;
  requestedPublicKey?: string;
  fingerprint?: string;
};
