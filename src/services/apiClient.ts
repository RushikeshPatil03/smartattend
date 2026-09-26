// src/services/apiClient.ts
//
// FINAL – aligned with backend auth + two-step QR flow
//

const FALLBACK_PROD_API = "https://smartattend-api-lpbx.onrender.com";

const RAW_API_BASE = String(import.meta.env.VITE_API_BASE_URL || "").trim();

const API_BASE = (() => {
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    const isLocalhost = host === "localhost" || host === "127.0.0.1" || host === "::1";
    const isPrivateIP =
      host.startsWith("192.168.") ||
      host.startsWith("10.") ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host);
    const isTunnel =
      host.endsWith(".loca.lt") ||
      host.endsWith(".localtunnel.me") ||
      host.endsWith(".trycloudflare.com") ||
      host.endsWith(".ts.net") ||
      host.endsWith(".tailscale.net");

    // 1. If accessed on a mobile phone or local device via Wi-Fi LAN IP (e.g. http://192.168.1.5:5173)
    if (isPrivateIP) {
      if (
        RAW_API_BASE &&
        !RAW_API_BASE.includes("localhost") &&
        !RAW_API_BASE.includes("127.0.0.1") &&
        RAW_API_BASE.startsWith("http")
      ) {
        return RAW_API_BASE.replace(/\/+$/, "");
      }
      // If no explicit local backend URL is specified, default to production Render backend
      // so mobile devices don't fail trying to reach non-existent port 4000 on their own IP
      return FALLBACK_PROD_API;
    }

    // 2. If running locally on laptop
    if (isLocalhost) {
      if (RAW_API_BASE && RAW_API_BASE !== "." && RAW_API_BASE !== "./") {
        return RAW_API_BASE.replace(/\/+$/, "");
      }
      return `${window.location.protocol}//${host}:4000`;
    }

    // 3. Tunnel environments
    if (isTunnel) {
      return "";
    }

    // 4. Production deployment (Cloudflare Pages, Vercel, Render, custom domain):
    if (
      RAW_API_BASE &&
      RAW_API_BASE !== "." &&
      RAW_API_BASE !== "./" &&
      !RAW_API_BASE.includes("localhost") &&
      !RAW_API_BASE.includes("127.0.0.1")
    ) {
      return RAW_API_BASE.replace(/\/+$/, "");
    }

    // Fallback: Default to official production API so production builds never hit invalid :4000 ports
    return FALLBACK_PROD_API;
  }

  if (RAW_API_BASE && !RAW_API_BASE.includes("localhost")) {
    return RAW_API_BASE.replace(/\/+$/, "");
  }
  return FALLBACK_PROD_API;
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

// 60 seconds timeout to accommodate free-tier cold starts (e.g. Render spin-up)
const DEFAULT_REQUEST_TIMEOUT_MS = Number(
  import.meta.env.VITE_API_REQUEST_TIMEOUT_MS || 60000
);

// Background warm-up ping for free-tier server instances
if (typeof window !== "undefined" && API_BASE && API_BASE.includes("onrender.com")) {
  try {
    fetch(`${API_BASE}/api/health`, { method: "GET", mode: "cors" }).catch(() => {});
  } catch {}
}

class ApiClient {
  token: string | null =
    typeof localStorage !== "undefined"
      ? localStorage.getItem("smartattend_access_token")
      : null;
  private refreshPromise: Promise<any> | null = null;
  private inFlightStopSessions = new Map<string, Promise<any>>();

  // ------------------------------------
  // Token handling: access token in memory + localStorage, refresh token in HttpOnly cookie
  // ------------------------------------
  setToken(token: string | null) {
    this.token = token;
    if (typeof localStorage !== "undefined") {
      if (token) {
        localStorage.setItem("smartattend_access_token", token);
      } else {
        localStorage.removeItem("smartattend_access_token");
      }
    }
  }

  // ------------------------------------
  // Core request wrapper (STRICT + SAFE)
  // ------------------------------------
  async request(
    method: string,
    url: string,
    body?: any,
    retryOnAuth = true,
    externalSignal?: AbortSignal
  ) {
    if (externalSignal?.aborted) {
      return { ok: false, error: "Request cancelled", aborted: true };
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, DEFAULT_REQUEST_TIMEOUT_MS);

    const onExternalAbort = () => {
      controller.abort();
    };

    if (externalSignal) {
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }

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
        // Automatically retry once on cold-start HTTP errors (502 Bad Gateway / 503 Service Unavailable / 504 Gateway Timeout)
        if ((res.status === 502 || res.status === 503 || res.status === 504) && retryOnAuth) {
          const isAttendance = url.includes("/attendance/");
          const retryDelay = isAttendance ? 350 : 1500;
          await new Promise((r) => setTimeout(r, retryDelay));
          return this.request(method, url, body, false, externalSignal);
        }

        if (res.status === 401 && retryOnAuth && !url.startsWith("/api/auth/")) {
          const refreshed = await this.refreshSession();
          if (refreshed?.ok && this.token) {
            return this.request(method, url, body, false, externalSignal);
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
      if (err?.name === "AbortError" || externalSignal?.aborted) {
        if (externalSignal?.aborted) {
          return { ok: false, error: "Request cancelled", aborted: true };
        }
        const timeoutSec = Math.round(DEFAULT_REQUEST_TIMEOUT_MS / 1000);
        const isRender = API_BASE.includes("onrender.com");
        return {
          ok: false,
          error: isRender
            ? `Server is spinning up (free tier cold start). Please retry in a moment.`
            : `Request timed out after ${timeoutSec}s. Please check your network connection.`,
        };
      }
      // If network error (e.g. Failed to fetch while server is spinning up or mobile WiFi blip), retry once rapidly
      if (retryOnAuth && !externalSignal?.aborted && (err?.message?.includes("fetch") || err?.message?.includes("NetworkError"))) {
        try {
          const isAttendance = url.includes("/attendance/");
          const retryDelay = isAttendance ? 300 : 1500;
          await new Promise((r) => setTimeout(r, retryDelay));
          return await this.request(method, url, body, false, externalSignal);
        } catch {
          // fall through to return error
        }
      }
      return { ok: false, error: err?.message || "Network error" };
    } finally {
      window.clearTimeout(timeoutId);
      if (externalSignal) {
        externalSignal.removeEventListener("abort", onExternalAbort);
      }
    }
  }

  get(url: string, signal?: AbortSignal) {
    return this.request("GET", url, undefined, true, signal);
  }
  post(url: string, data?: any, signal?: AbortSignal) {
    return this.request("POST", url, data, true, signal);
  }
  put(url: string, data?: any, signal?: AbortSignal) {
    return this.request("PUT", url, data, true, signal);
  }
  delete(url: string, signal?: AbortSignal) {
    return this.request("DELETE", url, undefined, true, signal);
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

  getMe = (signal?: AbortSignal) => this.get("/api/auth/me", signal);

  logout = async () => {
    await this.post("/api/auth/logout").catch(() => undefined);
    this.setToken(null);
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem("smartattend_user");
      localStorage.removeItem("smartattend_access_token");
    }
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

  getUsers = (signal?: AbortSignal) => this.get("/api/admin/users", signal);
  updateFacultyDeviceLock = (facultyId: string, enabled: boolean) =>
    this.put(`/api/admin/faculty/${encodeURIComponent(facultyId)}/device-lock`, {
      enabled,
    });
  getStudentAnalytics = (studentId: string, signal?: AbortSignal) =>
    this.get(`/api/admin/students/${encodeURIComponent(studentId)}/analytics`, signal);
  uploadAdminLogo = (data: { image: string }) =>
    this.post("/api/admin/profile/logo", data);
  updateAdminProfile = (data: {
    collegeName?: string;
    profilePhotoUrl?: string | null;
    newStoragePath?: string | null;
  }) => this.put("/api/admin/profile", data);

  // Departments
  getDepartments = (signal?: AbortSignal) => this.get("/api/department", signal);
  createDepartment = (data: any) =>
    this.post("/api/department", data);
  deleteDepartment = (id: string) =>
    this.delete(`/api/department/${id}`);

  // Subjects
  getSubjects = (signal?: AbortSignal) => this.get("/api/subject", signal);
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

  stopSession = (id: string) => {
    const sid = String(id || "").trim();
    if (!sid) return Promise.resolve({ ok: false, error: "Missing session ID" });
    const existing = this.inFlightStopSessions.get(sid);
    if (existing) return existing;
    const promise = this.post(`/api/faculty/session/${sid}/stop`).finally(() => {
      this.inFlightStopSessions.delete(sid);
    });
    this.inFlightStopSessions.set(sid, promise);
    return promise;
  };

  cancelSession = (id: string) =>
    this.post(`/api/faculty/session/${id}/cancel`);

  getSessionStatus = (id: string) =>
    this.get(`/api/faculty/sessions/${encodeURIComponent(id)}/status`);

  getSessionRosterSnapshot = (sessionId: string) =>
    this.get(`/api/faculty/sessions/${encodeURIComponent(sessionId)}/roster-snapshot`);

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
  getDeviceChangeRequestPhotos = (requestId: string) =>
    this.get(`/api/faculty/device-change-requests/${encodeURIComponent(requestId)}/photos`);
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
  verifyFace = (data: {
    sessionId?: string;
    fingerprint?: string;
    faceMatch?: boolean;
    faceMetrics?: any;
    liveFaceSignature?: string;
    liveFaceSignatureMirror?: string;
    liveFaceImageDataUrl?: string;
  }) => this.post("/api/attendance/face-verify", data);

  markAttendanceTwoStep = (data: {
    firstQrToken: string;
    secondQrToken: string;
    lat?: number | null;
    lng?: number | null;
    accuracy?: number | null;
    fingerprint?: string;
    scanGrantToken?: string;
    faceGrantToken?: string;
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
    faceGrantToken?: string;
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
    faceGrantToken?: string;
  }) => this.post("/api/attendance/totp", data);

  submitAttendanceSequence = (data: {
    sequence: Array<{ classId: string; code: string; index: number }>;
    lat?: number | null;
    lng?: number | null;
    accuracy?: number | null;
    fingerprint?: string | null;
    faceGrantToken?: string;
  }) => this.post("/api/attendance/submit", data);

  manualAttendance = (data: any) =>
    this.post("/api/attendance/manual", data);

  batchUpdateMatrixAttendance = (data: {
    updates: Array<{
      sessionId: string;
      enrollmentNo: string;
      status: "present" | "absent";
    }>;
    subjectId?: string;
    batchStartedAt?: string;
  }) => this.post("/api/attendance/matrix/batch-update", data);

  deleteAttendanceSession = (sessionId: string) =>
    this.delete(`/api/attendance/session/${encodeURIComponent(sessionId)}`);

  getSubjectBatches = (subjectId: string, facultyId?: string) =>
    this.get(`/api/subjects/${encodeURIComponent(subjectId)}/batches${facultyId ? `?facultyId=${encodeURIComponent(facultyId)}` : ""}`);

  saveSubjectBatches = (subjectId: string, data: { batches: any[] }) =>
    this.post(`/api/subjects/${encodeURIComponent(subjectId)}/batches`, data);

  fetchAttendance = (filters: any) => {
    const cleanFilters: Record<string, any> = {};
    if (filters && typeof filters === "object") {
      Object.entries(filters).forEach(([k, v]) => {
        if (
          v !== undefined &&
          v !== null &&
          v !== "" &&
          v !== "undefined" &&
          v !== "null"
        ) {
          cleanFilters[k] = v;
        }
      });
    }
    const qs = new URLSearchParams(cleanFilters).toString();
    return this.get(`/api/attendance${qs ? `?${qs}` : ""}`);
  };

  getSessionRosterHistory = (params: any) => {
    const cleanParams: Record<string, any> = {};
    if (params && typeof params === "object") {
      Object.entries(params).forEach(([k, v]) => {
        if (
          v !== undefined &&
          v !== null &&
          v !== "" &&
          v !== "undefined" &&
          v !== "null"
        ) {
          cleanParams[k] = v;
        }
      });
    }
    const qs = new URLSearchParams(cleanParams).toString();
    return this.get(`/api/faculty/session-roster-history${qs ? `?${qs}` : ""}`);
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

  getActivities = () =>
    this.get("/api/activities");

  getStudentActivities = () =>
    this.get("/api/activities/student");

  getCohortStudents = (
    params: {
      years?: number[];
      semesters?: number[];
      section?: string;
      departmentId?: string;
      usns?: string[];
    },
    signal?: AbortSignal
  ) => {
    const query = new URLSearchParams();
    if (params.years && params.years.length > 0) query.set("years", params.years.join(","));
    if (params.semesters && params.semesters.length > 0) query.set("semesters", params.semesters.join(","));
    if (params.section) query.set("section", params.section);
    if (params.departmentId) query.set("departmentId", params.departmentId);
    if (params.usns && params.usns.length > 0) query.set("usns", params.usns.join(","));
    return this.get(`/api/activities/cohort-students?${query.toString()}`, signal);
  };

  getPublicMobileLocationCapture = (token: string) =>
    this.get(`/api/public/mobile-location/${encodeURIComponent(token)}`);

  submitPublicMobileLocationCapture = (
    token: string,
    data: { lat: number; lng: number; accuracy?: number; deviceLabel?: string }
  ) => this.post(`/api/public/mobile-location/${encodeURIComponent(token)}`, data);
}

const apiClient = new ApiClient();
export default apiClient;
