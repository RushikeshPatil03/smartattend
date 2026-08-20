export enum UserRole {
  ADMIN = "ADMIN",
  FACULTY = "FACULTY",
  STUDENT = "STUDENT",
}

export interface WebAuthnCredential {
  id: string;
  publicKey: string;
  counter?: number;
  transports?: string[];
  deviceType?: string;
  backedUp?: boolean;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  department?: string;
  deviceFingerprint?: string;
  credentialId?: string | null;
  hasEnrolledPasskey?: boolean;
  deviceLockEnabled?: boolean;
  deviceAccessStatus?: string;
  enrollmentNo?: string | null;
  collegeName?: string | null;
  profilePhotoUrl?: string | null;
  facultyProfilePhotoUrl?: string | null;
  studentProfilePhotoUrl?: string | null;
}

export interface Department {
  id: string;
  name: string;
  code?: string;
}

export interface Subject {
  id: string;
  name: string;
  code: string;
  departmentId?: string;
  departmentName?: string;
}

export interface Session {
  id: string;
  facultyId: string;
  subjectId: string;
  departmentId?: string;
  year?: number;
  semester?: number;
  section?: string;
  startTime: number;
  endTime?: number;
  isActive: boolean;
  locationLat?: number;
  locationLng?: number;
  locationRadiusMeters?: number;
  currentDynamicToken?: string;
}

export interface AttendanceRecord {
  id: string;
  sessionId: string;
  studentId: string;
  timestamp: number;
  status: "present" | "absent";
}

// Navigation Views
export enum View {
  LOGIN = "LOGIN",
  ADMIN_DASHBOARD = "ADMIN_DASHBOARD",
  FACULTY_DASHBOARD = "FACULTY_DASHBOARD",
  STUDENT_DASHBOARD = "STUDENT_DASHBOARD",
  ADMIN_REGISTER = "ADMIN_REGISTER",
  REGISTER = "REGISTER",
  SCANQR = "SCANQR",
}
