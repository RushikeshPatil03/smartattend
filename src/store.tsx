// src/store.tsx
import React, {
  createContext,
  useContext,
  useCallback,
  useState,
  ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import apiClient from "./services/apiClient";

/**
 * Application Views
 */
export const View = {
  LOGIN: "LOGIN",
  ADMIN_DASHBOARD: "ADMIN_DASHBOARD",
  FACULTY_DASHBOARD: "FACULTY_DASHBOARD",
  STUDENT_DASHBOARD: "STUDENT_DASHBOARD",
  ADMIN_REGISTER: "ADMIN_REGISTER",
  REGISTER: "REGISTER",
} as const;

type ViewType = (typeof View)[keyof typeof View];

interface AppContextValue {
  view: ViewType;
  currentView: ViewType;
  currentUser: any;
  updateCurrentUser: (patch: Record<string, any>) => void;

  navigateTo: (v: ViewType) => void;
  goToAdminRegister: () => void;

  login: (
    role: string,
    email: string,
    password: string,
    fingerprint?: string
  ) => Promise<any>;
  logout: () => Promise<void>;
  restoreSession: () => Promise<any>;

  generateRegistrationLink: (
    type: string,
    expiryHours?: number,
    maxRegistrations?: number
  ) => Promise<any>;

  fetchSubjects: () => Promise<any[]>;
  fetchDepartments: () => Promise<any[]>;
  fetchUsers: () => Promise<void>;
  updateFacultyDeviceLock: (facultyId: string, enabled: boolean) => Promise<any>;

  sessions: any[];
  attendance: any[];
  subjects: any[];
  departments: any[];
  users: any[];

  addDepartment: (payload: any) => Promise<any>;
  deleteDepartment: (id: string) => Promise<any>;
  addSubject: (payload: any) => Promise<any>;
  deleteSubject: (id: string) => Promise<any>;
  allotSubject: (
    subjectId: string,
    assignments?: Array<{
      departmentId: string;
      facultyId: string;
      section: string;
      classCode: string;
    }>
  ) => Promise<any>;

  createSession: (payload: {
    facultyId: string;
    subjectId: string;
    departmentId: string;
    location: any;
    year: number;
    semester: number;
    section: string;
  }) => Promise<any>;
  stopSession: (sessionId: string) => Promise<any>;
  cancelSession: (sessionId: string) => Promise<any>;

  createSessionLocal: (session: any) => void;
  endSessionLocal: (sessionId: string, endTime?: number) => void;
  removeSessionLocal: (sessionId: string) => void;
  updateSessionToken: (sessionId: string, token: string) => void;

  submitAttendance: (
    qrToken: string,
    lat?: number | null,
    lng?: number | null,
    fingerprint?: string | null
  ) => Promise<any>;

  addAttendanceLocal: (att: any) => void;
  fetchAttendance: (filters: any) => Promise<any>;
}

const AppContext = createContext<AppContextValue | null>(null);

export const AppProvider = ({ children }: { children: ReactNode }) => {
  const [view, setView] = useState<ViewType>(View.LOGIN);
  const [currentUser, setCurrentUser] = useState<any>(() => {
    try {
      const saved =
        typeof localStorage !== "undefined"
          ? localStorage.getItem("smartattend_user")
          : null;
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const navigate = useNavigate();
  const location = useLocation();

  const [sessions, setSessions] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);

  const routeByView: Record<ViewType, string> = {
    [View.LOGIN]: "/login",
    [View.ADMIN_DASHBOARD]: "/admin",
    [View.FACULTY_DASHBOARD]: "/faculty",
    [View.STUDENT_DASHBOARD]: "/student",
    [View.ADMIN_REGISTER]: "/admin/register",
    [View.REGISTER]: "/register",
  };

  const viewByPath = useCallback((pathname: string): ViewType => {
    if (pathname.startsWith("/admin/register")) return View.ADMIN_REGISTER;
    if (pathname.startsWith("/admin")) return View.ADMIN_DASHBOARD;
    if (pathname.startsWith("/faculty")) return View.FACULTY_DASHBOARD;
    if (pathname.startsWith("/student")) return View.STUDENT_DASHBOARD;
    if (pathname.startsWith("/register")) return View.REGISTER;
    return View.LOGIN;
  }, []);

  const currentRouteView = viewByPath(location.pathname);

  const navigateTo = useCallback(
    (v: ViewType) => {
      setView(v);
      navigate(routeByView[v], { replace: false });
    },
    [navigate]
  );
  const updateCurrentUser = useCallback((patch: Record<string, any>) => {
    setCurrentUser((prev: any) => {
      if (!prev) return prev;
      const updated = { ...prev, ...patch };
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem("smartattend_user", JSON.stringify(updated));
        }
      } catch {
        // Storage full/disabled fallback
      }
      return updated;
    });
  }, []);

  const normalizeFrontendOrigin = useCallback((rawOrigin: string) => {
    const value = String(rawOrigin || "").trim();
    if (!value) return value;

    try {
      const parsed = new URL(value);
      const isLocalDevHost =
        parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "0.0.0.0";

      const shouldStripDevPort = parsed.port === "5173" && !isLocalDevHost;

      if (shouldStripDevPort) {
        parsed.port = "";
      }

      return parsed.origin;
    } catch {
      return value.replace(/\/+$/, "");
    }
  }, []);

  const resolveRegistrationLink = useCallback((type: string, token: string, serverLink?: string) => {
    const currentOrigin =
      typeof window !== "undefined" ? normalizeFrontendOrigin(window.location.origin) : "";
    const fallbackOrigin =
      normalizeFrontendOrigin(
        import.meta.env.VITE_FRONTEND_URL ||
        `${window.location.protocol}//${window.location.host}`
      );

    const fallbackLink = `${fallbackOrigin}/register?token=${token}&role=${type}`;
    if (!serverLink) return currentOrigin ? `${currentOrigin}/register?token=${token}&role=${type}` : fallbackLink;

    try {
      const parsed = new URL(serverLink);
      const looksLocalhost =
        parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "0.0.0.0";

      if (currentOrigin && (looksLocalhost || parsed.origin !== currentOrigin)) {
        const current = new URL(currentOrigin);
        parsed.protocol = current.protocol;
        parsed.host = current.host;
        return parsed.toString();
      }

      return normalizeFrontendOrigin(parsed.toString()) + parsed.pathname + parsed.search;
    } catch {
      return currentOrigin ? `${currentOrigin}/register?token=${token}&role=${type}` : fallbackLink;
    }
  }, [normalizeFrontendOrigin]);

  // ---------------- AUTH ----------------
  const login = async (
    role: string,
    email: string,
    password: string,
    fingerprint?: string
  ) => {
    const res = await apiClient.login(
      role,
      email,
      password,
      fingerprint
    );
    if (res?.ok && res.user) {
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem("smartattend_user", JSON.stringify(res.user));
        }
      } catch {
        // Fallback if storage is disabled
      }
      setCurrentUser(res.user);
      if (res.user.role === "ADMIN") {
        navigateTo(View.ADMIN_DASHBOARD);
        void Promise.all([fetchDepartments(), fetchSubjects(), fetchUsers()]);
      } else if (res.user.role === "FACULTY") {
        setUsers([]);
        navigateTo(View.FACULTY_DASHBOARD);
        void Promise.all([fetchDepartments(), fetchSubjects()]);
      } else if (res.user.role === "STUDENT") {
        setSubjects([]);
        setUsers([]);
        navigateTo(View.STUDENT_DASHBOARD);
        void fetchDepartments();
      }
    }
    return res;
  };

  const logout = async () => {
    await apiClient.logout();
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem("smartattend_user");
        localStorage.removeItem("smartattend_access_token");
      }
    } catch {
      // Fallback
    }
    setCurrentUser(null);
    setSessions([]);
    setAttendance([]);
    setDepartments([]);
    setSubjects([]);
    setUsers([]);
    navigateTo(View.LOGIN);
  };

  const restoreSession = useCallback(async () => {
    const res = await apiClient.refreshSession();
    if (res?.ok && res.user) {
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem("smartattend_user", JSON.stringify(res.user));
        }
      } catch {
        // Fallback
      }
      setCurrentUser(res.user);
    } else if (res?.status === 401) {
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.removeItem("smartattend_user");
          localStorage.removeItem("smartattend_access_token");
        }
      } catch {
        // Fallback
      }
      setCurrentUser(null);
    }
    return res;
  }, []);

  // ---------------- ADMIN ----------------
  const generateRegistrationLink = async (
    type: string,
    expiryHours = 24,
    maxRegistrations = 1
  ) => {
    const res = await apiClient.generateRegistrationToken({
      type,
      expiryHours,
      maxRegistrations,
    });
    if (!res?.ok) return res;

    return {
      ok: true,
      token: res.token,
      config: res.config,
      link: resolveRegistrationLink(type, res.token, res.link),
    };
  };

  const fetchDepartments = async () => {
    if (!apiClient.token) return [];
    const res = await apiClient.getDepartments();
    if (res?.ok) setDepartments(res.departments || []);
    return res?.departments || [];
  };

  const fetchSubjects = async () => {
    if (!apiClient.token) return [];
    const res = await apiClient.getSubjects();
    if (res?.ok) setSubjects(res.subjects || []);
    return res?.subjects || [];
  };

  const fetchUsers = async () => {
    if (!apiClient.token) return;
    const res = await apiClient.getUsers();
    if (res?.ok) setUsers(res.users || []);
  };

  const updateFacultyDeviceLock = async (facultyId: string, enabled: boolean) => {
    const res = await apiClient.updateFacultyDeviceLock(facultyId, enabled);
    if (res?.ok && res.faculty) {
      setUsers((prev) =>
        prev.map((user: any) =>
          String(user.id) === String(facultyId) ? { ...user, ...res.faculty } : user
        )
      );
    }
    return res;
  };

  // ---------------- SESSIONS ----------------
  const createSessionLocal = (session: any) => {
    setSessions((prev) => {
      const id = session?.id || session?._id;
      const filtered = prev.filter((s: any) => (s.id || s._id) !== id);
      return [...filtered, session];
    });
  };

  const updateSessionToken = (sessionId: string, token: string) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId || s._id === sessionId
          ? { ...s, currentDynamicToken: token }
          : s
      )
    );
  };

  const endSessionLocal = (sessionId: string, endTime = Date.now()) => {
    setSessions((prev) =>
      prev.map((s) =>
        (s.id === sessionId || s._id === sessionId) ? { ...s, isActive: false, endTime } : s
      )
    );
  };

  const removeSessionLocal = (sessionId: string) => {
    setSessions((prev) =>
      prev.filter((s: any) => (s.id || s._id) !== sessionId)
    );
  };

  const createSession = async (payload: any) => {
    const res = await apiClient.startSession(payload);
    if (!res?.ok) return res;

    const s = res.session;
    const totalStudents = s?.totalStudents || res?.totalStudents || 0;
    const newSession = {
      id: s._id,
      facultyId: s.faculty,
      subjectId: s.subject,
      departmentId: s.department,
      year: s.year,
      semester: s.semester,
      section: s.section,
      startTime: new Date(s.startTime).getTime(),
      endTime: null,
      isActive: true,
      locationLat: s.location?.lat,
      locationLng: s.location?.lng,
      locationRadiusMeters: s.location?.radiusMeters || 200,
      currentDynamicToken: res.qr,
      secretKey: res.secretKey,
      totalStudents,
      totalStrength: totalStudents,
    };

    createSessionLocal(newSession);
    return { ok: true, session: newSession, secretKey: res.secretKey, qr: res.qr, totalStudents };
  };

  const stopSession = async (sessionId: string) => {
    const res = await apiClient.stopSession(sessionId);
    endSessionLocal(sessionId);
    return res;
  };

  const cancelSession = async (sessionId: string) => {
    const res = await apiClient.cancelSession(sessionId);
    removeSessionLocal(sessionId);
    return res;
  };

  // ---------------- ATTENDANCE ----------------
  const addAttendanceLocal = (att: any) => {
    setAttendance((prev) => {
      const exists = prev.some(
        (a) => a.sessionId === att.sessionId && a.studentId === att.studentId
      );
      return exists ? prev : [...prev, att];
    });
  };

  const submitAttendance = async (
    qrToken: string,
    lat?: number | null,
    lng?: number | null,
    fingerprint?: string | null
  ) => {
    const res = await apiClient.markAttendance({
      firstQrToken: qrToken,
      secondQrToken: qrToken,
      lat,
      lng,
      fingerprint,
    });

    if (res?.ok && res.attendance) {
      addAttendanceLocal({
        id: res.attendance._id,
        sessionId: res.attendance.session,
        studentId: res.attendance.student,
        timestamp: Date.now(),
        status: "present",
      });
    }
    return res;
  };

  // ---------------- CRUD ----------------
  const addDepartment = async (payload: any) => {
    const res = await apiClient.createDepartment(payload);
    if (res?.ok) setDepartments((d) => [...d, res.department]);
    return res;
  };

  const deleteDepartment = async (id: string) => {
    const res = await apiClient.deleteDepartment(id);
    if (res?.ok)
      setDepartments((d) => d.filter((x) => x._id !== id));
    return res;
  };

  const addSubject = async (payload: any) => {
    const res = await apiClient.createSubject(payload);
    if (res?.ok) setSubjects((s) => [...s, res.subject]);
    return res;
  };

  const deleteSubject = async (id: string) => {
    const res = await apiClient.deleteSubject(id);
    if (res?.ok) setSubjects((s) => s.filter((x) => x._id !== id));
    return res;
  };

  const allotSubject = async (
    subjectId: string,
    assignments: Array<{
      departmentId: string;
      facultyId: string;
      section: string;
      classCode: string;
    }> = []
  ) => {
    const res = await apiClient.allotSubject({
      subjectId,
      assignments,
    });
    if (res?.ok) {
      setSubjects((prev) =>
        prev.map((s) => (s._id === res.subject._id ? res.subject : s))
      );
    }
    return res;
  };

  const value: AppContextValue = {
    view,
    currentView: currentRouteView || view,
    currentUser,
    updateCurrentUser,

    navigateTo,
    goToAdminRegister: () => navigateTo(View.ADMIN_REGISTER),

    login,
    logout,
    restoreSession,

    generateRegistrationLink,

    fetchSubjects,
    fetchDepartments,
    fetchUsers,
    updateFacultyDeviceLock,

    sessions,
    attendance,
    subjects,
    departments,
    users,

    addDepartment,
    deleteDepartment,
    addSubject,
    deleteSubject,
    allotSubject,

    createSession,
    stopSession,
    cancelSession,
    createSessionLocal,
    endSessionLocal,
    removeSessionLocal,
    updateSessionToken,

    submitAttendance,
    addAttendanceLocal,

    fetchAttendance: (filters: any) =>
      apiClient.fetchAttendance(filters),
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
};
