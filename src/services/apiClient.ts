// src/services/apiClient.ts
//
// FINAL – aligned with backend auth + two-step QR flow
//

const RAW_API_BASE = String(import.meta.env.VITE_API_BASE_URL || "").trim();

const API_BASE = (() => {
  if (RAW_API_BASE && RAW_API_BASE !== "." && RAW_API_BASE !== "./") {
    return RAW_API_BASE.replace(/\/+$/, "");
  }
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    const isTunnel =
      host.endsWith(".loca.lt") ||
      host.endsWith(".localtunnel.me") ||
      host.endsWith(".trycloudflare.com") ||
      host.endsWith(".ts.net") ||
      host.endsWith(".tailscale.net");

    return isTunnel ? "" : `${window.location.protocol}//${host}:4000`;
  }
  return "http://localhost:4000";
})();

function buildUrl(url: string): string {
  let cleanPath = url.startsWith("/") ? url : `/${url}`;
  if (!API_BASE) {
    return cleanPath;
  }
  if (API_BASE.endsWith("/api") && cleanPath.startsWith("/api/")) {
    cleanPath = cleanPath.slice(4);
  }
  return `${API_BASE}${cleanPath}`;
}

const DEFAULT_REQUEST_TIMEOUT_MS = Number(
  import.meta.env.VITE_API_REQUEST_TIMEOUT_MS || 15000
);

class ApiClient {
  token: string | null = null;
  private refreshPromise: Promise<any> | null = null;

  // ------------------------------------
  // Token handling: access token in memory, refresh token in HttpOnly cookie
  // ------------------------------------
  setToken(token: string | null) {
    this.token = token;
  }

  // ------------------------------------
  // Core request wrapper (STRICT + SAFE)
  // ------------------------------------
  async request(method: string, url: string, body?: any, retryOnAuth = true) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, DEFAULT_REQUEST_TIMEOUT_MS);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (this.token) {
        headers.Authorization = `Bearer ${this.token}`;
      }

      const fullUrl = buildUrl(url);

      const res = await fetch(fullUrl, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        credentials: "include",
      });

      const text = await res.text();
      let data: any = {};

      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { ok: false, error: text || "Invalid server response" };
      }

      // Normalize errors (do NOT silently ignore HTTP errors)
      if (!res.ok) {
        if (res.status === 401 && retryOnAuth && !url.startsWith("/api/auth/")) {
          const refreshed = await this.refreshSession();
          if (refreshed?.ok && this.token) {
            return this.request(method, url, body, false);
          }
        }
        if (res.status === 401 && !url.startsWith("/api/auth/refresh")) {
          this.setToken(null);
        }
        return {
          ok: false,
          status: res.status,
          error: data?.error || "Request failed",
        };
      }

      return data;
    } catch (err: any) {
      if (err?.name === "AbortError") {
        return {
          ok: false,
          error: `Request timed out after ${Math.round(
            DEFAULT_REQUEST_TIMEOUT_MS / 1000
          )}s`,
        };
      }
      return { ok: false, error: err?.message || "Network error" };
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  get(url: string) {
    return this.request("GET", url);
  }
  post(url: string, data?: any) {
    return this.request("POST", url, data);
  }
  put(url: string, data?: any) {
    return this.request("PUT", url, data);
  }
  delete(url: string) {
    return this.request("DELETE", url);
  }

  // ------------------------------------
  // AUTH
  // ------------------------------------
  login = async (
    role: string,
    email: string,
    password: string,
    fingerprint?: string
  ) => {
    const res = await this.post("/api/auth/login", {
      role,
      email,
      password,
      fingerprint,
    });

    if (res?.ok && (res.accessToken || res.token)) {
      this.setToken(res.accessToken || res.token);
    }

    return res;
  };

  refreshSession = async () => {
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = this.post("/api/auth/refresh")
      .then((res: any) => {
        if (res?.ok && (res.accessToken || res.token)) {
          this.setToken(res.accessToken || res.token);
        } else {
          this.setToken(null);
        }
        return res;
      })
      .finally(() => {
        this.refreshPromise = null;
      });

    return this.refreshPromise;
  };

  verifyDeviceChangeStudent = (data: { email: string; password: string }) =>
    this.post("/api/auth/device-change/verify-student", data);

  submitDeviceChangeRequest = (data: {
    verifyToken: string;
    fingerprint: string;
    selfieDataUrl: string;
  }) => this.post("/api/auth/device-change/request", data);

  logout = async () => {
    await this.post("/api/auth/logout").catch(() => undefined);
    this.setToken(null);
    return { ok: true };
  };

  // ------------------------------------
  // ADMIN
  // ------------------------------------
  createAdmin = (data: {
    name: string;
    collegeName: string;
    email: string;
    password: string;
  }) => this.post("/api/admin/create-admin", data);

  generateRegistrationToken = (data: {
    type: string;
    expiryHours: number;
    maxRegistrations: number;
  }) => this.post("/api/admin/generate-registration-link", data);

  getUsers = () => this.get("/api/admin/users");
  updateFacultyDeviceLock = (facultyId: string, enabled: boolean) =>
    this.put(`/api/admin/faculty/${encodeURIComponent(facultyId)}/device-lock`, {
      enabled,
    });
  getStudentAnalytics = (studentId: string) =>
    this.get(`/api/admin/students/${encodeURIComponent(studentId)}/analytics`);
  updateAdminProfile = (data: { collegeName?: string; profilePhotoUrl?: string | null }) =>
    this.put("/api/admin/profile", data);

  // Departments
  getDepartments = () => this.get("/api/department");
  createDepartment = (data: any) =>
    this.post("/api/department", data);
  deleteDepartment = (id: string) =>
    this.delete(`/api/department/${id}`);

  // Subjects
  getSubjects = () => this.get("/api/subject");
  createSubject = (data: any) =>
    this.post("/api/subject", data);
  deleteSubject = (id: string) =>
    this.delete(`/api/subject/${id}`);

  allotSubject = (data: {
    subjectId: string;
    assignments?: Array<{
      departmentId: string;
      facultyId: string;
      section: string;
      classCode: string;
    }>;
  }) => this.post("/api/subject/allot", data);

  // ------------------------------------
  // FACULTY SESSIONS
  // ------------------------------------
  startSession = (payload: any) =>
    this.post("/api/faculty/session/start", payload);

  stopSession = (id: string) =>
    this.post(`/api/faculty/session/${id}/stop`);

  cancelSession = (id: string) =>
    this.post(`/api/faculty/session/${id}/cancel`);

  getLiveQR = (sessionId: string) =>
    this.get(`/api/faculty/session/${sessionId}/qr`);
  getFacultySubjectAnalytics = (
    subjectId: string,
    filters?: { classCode?: string }
  ) => {
    const params = new URLSearchParams();
    const classCode = String(filters?.classCode || "").trim();
    if (classCode) {
      params.set("classCode", classCode);
    }
    const qs = params.toString();
    return this.get(
      `/api/faculty/subjects/${encodeURIComponent(subjectId)}/analytics${
        qs ? `?${qs}` : ""
      }`
    );
  };
  updateFacultyProfile = (data: { profilePhotoUrl: string }) =>
    this.put("/api/faculty/profile", data);
  getDeviceChangeRequests = (status = "pending") =>
    this.get(`/api/faculty/device-change-requests?status=${encodeURIComponent(status)}`);
  reviewDeviceChangeRequest = (
    requestId: string,
    data: { decision: "approved" | "rejected"; reviewNote?: string }
  ) => this.post(`/api/faculty/device-change-requests/${encodeURIComponent(requestId)}/review`, data);
  createMobileLocationCapture = (payload?: { facultyId?: string }) =>
    this.post("/api/faculty/location-capture/request", payload || {});
  getMobileLocationCapture = (token: string, facultyId?: string) => {
    const qs = facultyId
      ? `?facultyId=${encodeURIComponent(facultyId)}`
      : "";
    return this.get(`/api/faculty/location-capture/${encodeURIComponent(token)}${qs}`);
  };

  // ------------------------------------
  // ATTENDANCE (TWO-STEP QR)
  // ------------------------------------
  markAttendanceTwoStep = (data: {
    firstQrToken: string;
    secondQrToken: string;
    lat?: number | null;
    lng?: number | null;
    accuracy?: number | null;
    fingerprint?: string;
    scanGrantToken?: string;
    faceMatch?: any;
    faceMetrics?: any;
    faceEmbedding?: any;
  }) => this.post("/api/attendance/mark", data);

  markAttendance = (data: {
    firstQrToken: string;
    secondQrToken: string;
    lat?: number | null;
    lng?: number | null;
    accuracy?: number | null;
    fingerprint?: string | null;
    scanGrantToken?: string;
  }) => this.post("/api/attendance/mark", data);

  /**
   * High-concurrency TOTP-based attendance submission
   * Sends two consecutive rotating QR tokens in a single payload
   * Zero-latency Redis recording (no database disk writes during peak hours)
   */
  markAttendanceTOTP = (data: {
    token1: string;
    token2: string;
    sessionId: string;
    lat?: number | null;
    lng?: number | null;
    accuracy?: number | null;
    fingerprint?: string | null;
  }) => this.post("/api/attendance/totp", data);

  submitAttendanceSequence = (data: {
    sequence: Array<{ classId: string; code: string; index: number }>;
    lat?: number | null;
    lng?: number | null;
    accuracy?: number | null;
    fingerprint?: string | null;
  }) => this.post("/api/attendance/submit", data);

  manualAttendance = (data: any) =>
    this.post("/api/attendance/manual", data);

  fetchAttendance = (filters: any) => {
    const qs = new URLSearchParams(filters || {}).toString();
    return this.get(`/api/attendance?${qs}`);
  };

  // ------------------------------------
  // STUDENT DASHBOARD
  // ------------------------------------
  precheckAttendance = (payload: {
    locationQrPayload?: any;
    sessionId?: string;
    lat: number;
    lng: number;
    accuracy?: number;
    fingerprint: string;
  }) => this.post("/api/attendance/precheck", payload);

  getStudentRecentSessions = (limit = 20) =>
    this.get(`/api/student/sessions/recent?limit=${limit}`);

  getStudentTodaySessions = () =>
    this.get("/api/student/sessions/today");

  getStudentTodayLiveAttendance = () =>
    this.get("/api/student/attendance/today-live");

  getStudentActiveSession = () =>
    this.get("/api/student/session/active");

  getStudentAttendanceOverview = () =>
    this.get("/api/student/attendance/overview");

  getPublicMobileLocationCapture = (token: string) =>
    this.get(`/api/public/mobile-location/${encodeURIComponent(token)}`);

  submitPublicMobileLocationCapture = (
    token: string,
    data: { lat: number; lng: number; accuracy?: number; deviceLabel?: string }
  ) => this.post(`/api/public/mobile-location/${encodeURIComponent(token)}`, data);
}

const apiClient = new ApiClient();
export default apiClient;
