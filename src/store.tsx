import React, {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import apiClient from "./services/apiClient";
import {
  CACHE_KEYS,
  clearAllDataCaches,
  getCache,
  setCache,
} from "./utils/dataCache";

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

  fetchSubjects: (forceRefresh?: boolean, signal?: AbortSignal) => Promise<any[]>;
  fetchDepartments: (forceRefresh?: boolean, signal?: AbortSignal) => Promise<any[]>;
  fetchUsers: (signal?: AbortSignal) => Promise<any[]>;
  updateFacultyDeviceLock: (facultyId: string, enabled: boolean) => Promise<any>;

  sessions: any[];
  attendance: any[];
  subjects: any[];
  departments: any[];
  users: any[];

  addDepartment: (payload: any) => Promise<any>;
  updateDepartment: (id: string, payload: any) => Promise<any>;
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

let inflightDepartmentsPromise: Promise<any[]> | null = null;
let inflightSubjectsPromise: Promise<any[]> | null = null;
let lastSubjectsFetchTimestamp = 0;

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
  const [departments, setDepartments] = useState<any[]>(() => {
    const cached = getCache<any[]>(CACHE_KEYS.DEPARTMENTS);
    return Array.isArray(cached.data) ? cached.data : [];
  });
  const [subjects, setSubjects] = useState<any[]>(() => {
    const cached = getCache<any[]>(CACHE_KEYS.SUBJECTS);
    return Array.isArray(cached.data) ? cached.data : [];
  });
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

  // ---------------- FETCH HELPERS WITH 3-MIN STALENESS & DEDUPLICATION ----------------
  const fetchDepartments = useCallback(async (forceRefresh = false, signal?: AbortSignal) => {
    if (!apiClient.token || signal?.aborted) return [];

    const cached = getCache<any[]>(CACHE_KEYS.DEPARTMENTS);
    const hasCachedData = Array.isArray(cached.data) && cached.data.length > 0;

    // Return immediately from cache if fresh and not forced
    if (!forceRefresh && hasCachedData && !cached.isStale) {
      return cached.data!;
    }

    // Deduplicate in-flight concurrent requests
    if (inflightDepartmentsPromise) {
      return inflightDepartmentsPromise;
    }

    inflightDepartmentsPromise = (async () => {
      try {
        const res = await apiClient.getDepartments(signal);
        if (signal?.aborted) return [];
        if (res?.ok && Array.isArray(res.departments)) {
          setDepartments(res.departments);
          setCache(CACHE_KEYS.DEPARTMENTS, res.departments);
          return res.departments;
        }
        return hasCachedData ? cached.data! : [];
      } catch {
        return hasCachedData ? cached.data! : [];
      } finally {
        inflightDepartmentsPromise = null;
      }
    })();

    // If we have stale cached data, serve immediately while background refresh completes
    if (!forceRefresh && hasCachedData && cached.isStale) {
      return cached.data!;
    }

    return inflightDepartmentsPromise;
  }, []);

  const fetchSubjects = useCallback(async (forceRefresh = false, signal?: AbortSignal) => {
    if (!apiClient.token || signal?.aborted) return [];

    const now = Date.now();
    const cached = getCache<any[]>(CACHE_KEYS.SUBJECTS);
    const hasCachedData = Array.isArray(cached.data) && cached.data.length > 0;
    const isWithinStaleWindow =
      lastSubjectsFetchTimestamp > 0 &&
      now - lastSubjectsFetchTimestamp < 3 * 60 * 1000;

    // Return immediately from memory/cache if fresh within 3 minutes and not forced
    if (!forceRefresh && (isWithinStaleWindow || (hasCachedData && !cached.isStale))) {
      return subjects.length > 0 ? subjects : (cached.data || []);
    }

    // Deduplicate in-flight concurrent requests
    if (inflightSubjectsPromise) {
      return inflightSubjectsPromise;
    }

    inflightSubjectsPromise = (async () => {
      try {
        const res = await apiClient.getSubjects(signal);
        if (signal?.aborted) return [];
        if (res?.ok && Array.isArray(res.subjects)) {
          lastSubjectsFetchTimestamp = Date.now();
          setSubjects(res.subjects);
          setCache(CACHE_KEYS.SUBJECTS, res.subjects);
          return res.subjects;
        }
        return hasCachedData ? cached.data! : [];
      } catch {
        return hasCachedData ? cached.data! : [];
      } finally {
        inflightSubjectsPromise = null;
      }
    })();

    // If we have stale cached data, serve immediately while background refresh completes
    if (!forceRefresh && hasCachedData && cached.isStale) {
      return cached.data!;
    }

    return inflightSubjectsPromise;
  }, [subjects]);

  const fetchUsers = useCallback(async (signal?: AbortSignal) => {
    if (!apiClient.token || signal?.aborted) return [];
    const res = await apiClient.getUsers(signal);
    if (signal?.aborted) return [];
    if (res?.ok) setUsers(res.users || []);
    return res?.users || [];
  }, []);

  // Sync initial role data on boot if user was restored from localStorage
  useEffect(() => {
    if (currentUser) {
      const role = String(currentUser?.role || "").toUpperCase();
      if (role === "ADMIN") {
        void Promise.all([fetchDepartments(), fetchSubjects(), fetchUsers()]);
      } else if (role === "FACULTY") {
        void Promise.all([fetchDepartments(), fetchSubjects()]);
      } else if (role === "STUDENT") {
        void fetchDepartments();
      }
    }
  }, []);

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
    clearAllDataCaches();
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
      const role = String(res.user.role || "").toUpperCase();
      if (role === "ADMIN") {
        void Promise.all([fetchDepartments(), fetchSubjects(), fetchUsers()]);
      } else if (role === "FACULTY") {
        void Promise.all([fetchDepartments(), fetchSubjects()]);
      } else if (role === "STUDENT") {
        void fetchDepartments();
      }
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
  }, [fetchDepartments, fetchSubjects, fetchUsers]);

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
    const tempId = "temp_dept_" + Date.now();
    const optimisticDept = {
      _id: tempId,
      id: tempId,
      name: payload.name,
      code: payload.code,
      _isOptimistic: true,
    };

    // Optimistically add to state
    setDepartments((prev) => [...prev, optimisticDept]);

    try {
      const res = await apiClient.createDepartment(payload);
      if (res?.ok && res.department) {
        setDepartments((prev) => {
          const next = prev.map((d) =>
            (d._id === tempId || d.id === tempId) ? res.department : d
          );
          setCache(CACHE_KEYS.DEPARTMENTS, next);
          return next;
        });
        return res;
      } else {
        // Rollback
        setDepartments((prev) => prev.filter((d) => d._id !== tempId && d.id !== tempId));
        return res || { ok: false, error: "Failed to create department" };
      }
    } catch (err: any) {
      // Rollback
      setDepartments((prev) => prev.filter((d) => d._id !== tempId && d.id !== tempId));
      return { ok: false, error: err?.message || "Failed to create department" };
    }
  };

  const updateDepartment = async (id: string, payload: { name: string; code: string }) => {
    let prevDept: any = null;
    // Optimistic update
    setDepartments((prev) => {
      return prev.map((d) => {
        if ((d._id || d.id) === id) {
          prevDept = d;
          return { ...d, name: payload.name, code: payload.code };
        }
        return d;
      });
    });

    try {
      const res: any = await apiClient.put(`/api/department/${encodeURIComponent(id)}`, payload);
      if (res?.ok) {
        setDepartments((prev) => {
          const next = prev.map((d) =>
            (d._id || d.id) === id ? (res.department || { ...d, ...payload }) : d
          );
          setCache(CACHE_KEYS.DEPARTMENTS, next);
          return next;
        });
        return res;
      } else {
        // Rollback
        if (prevDept) {
          setDepartments((prev) =>
            prev.map((d) => ((d._id || d.id) === id ? prevDept : d))
          );
        }
        return res || { ok: false, error: "Failed to update department" };
      }
    } catch (err: any) {
      if (prevDept) {
        setDepartments((prev) =>
          prev.map((d) => ((d._id || d.id) === id ? prevDept : d))
        );
      }
      return { ok: false, error: err?.message || "Failed to update department" };
    }
  };

  const deleteDepartment = async (id: string) => {
    let deletedDept: any = null;
    let originalIndex = -1;

    // Optimistically remove from state
    setDepartments((prev) => {
      originalIndex = prev.findIndex((x) => (x.id || x._id) === id);
      if (originalIndex !== -1) {
        deletedDept = prev[originalIndex];
      }
      return prev.filter((x) => (x.id || x._id) !== id);
    });

    try {
      const res = await apiClient.deleteDepartment(id);
      if (res?.ok) {
        setDepartments((prev) => {
          const next = prev.filter((x) => (x.id || x._id) !== id);
          setCache(CACHE_KEYS.DEPARTMENTS, next);
          return next;
        });
        return res;
      } else {
        // Rollback
        if (deletedDept) {
          setDepartments((prev) => {
            const next = [...prev];
            next.splice(originalIndex >= 0 ? originalIndex : next.length, 0, deletedDept);
            return next;
          });
        }
        return res || { ok: false, error: "Failed to delete department" };
      }
    } catch (err: any) {
      // Rollback
      if (deletedDept) {
        setDepartments((prev) => {
          const next = [...prev];
          next.splice(originalIndex >= 0 ? originalIndex : next.length, 0, deletedDept);
          return next;
        });
      }
      return { ok: false, error: err?.message || "Failed to delete department" };
    }
  };

  const addSubject = async (payload: any) => {
    const res = await apiClient.createSubject(payload);
    if (res?.ok && res.subject) {
      setSubjects((s) => {
        const next = [...s, res.subject];
        setCache(CACHE_KEYS.SUBJECTS, next);
        return next;
      });
    }
    return res;
  };

  const deleteSubject = async (id: string) => {
    const res = await apiClient.deleteSubject(id);
    if (res?.ok) {
      setSubjects((s) => {
        const next = s.filter((x) => (x.id || x._id) !== id);
        setCache(CACHE_KEYS.SUBJECTS, next);
        return next;
      });
    }
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
    if (res?.ok && res.subject) {
      setSubjects((prev) => {
        const next = prev.map((s) =>
          (s.id || s._id) === (res.subject.id || res.subject._id) ? res.subject : s
        );
        setCache(CACHE_KEYS.SUBJECTS, next);
        return next;
      });
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
    updateDepartment,
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
