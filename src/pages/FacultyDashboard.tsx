import React, { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../store";
import { Badge, Button, Card, Skeleton } from "../components/Common";
import QRCode from "react-qr-code";
import { startQrPolling, serializeQrPayload, RotatingQrPayload } from "../utils/totpQrGenerator";
import {
  BarChart3,
  BookOpen,
  CheckCircle,
  Clock,
  Crosshair,
  Download,
  ExternalLink,
  Filter,
  LoaderCircle,
  List,
  MapPin,
  Play,
  Maximize2,
  Minimize2,
  RefreshCw,
  Search,
  Smartphone,
  Square,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  UserPlus,
  Users,
} from "lucide-react";
import apiClient from "../services/apiClient";
import CollegeHeader from "../components/CollegeHeader";
import { subscribeToSessionAttendance } from "../services/supabaseClient";

type Tab = "TAKE_ATTENDANCE" | "MANAGE_ATTENDANCE" | "DEVICE_REQUESTS" | "MANAGE_SUBJECTS";
const QR_REFRESH_MS = Math.max(
  3000,
  Number(import.meta.env.VITE_QR_REFRESH_MS || 5000)
);
const DEFAULT_SESSION_RADIUS_METERS = Number(
  import.meta.env.VITE_SESSION_RADIUS_METERS || 50
);
const RECENT_CLASS_LIMIT = 6;
const YEAR_OPTIONS = ["1", "2", "3", "4"] as const;
const SEMESTER_OPTIONS = ["1", "2", "3", "4", "5", "6", "7", "8"] as const;
const SECTION_OPTIONS = ["A", "B", "C", "D"] as const;

type RecentClassPreset = {
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
};

type SessionFormDraft = {
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

type FacultySubjectAnalyticsData = {
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

const normalizeId = (value: any) => String(value?._id || value?.id || value || "");

const recentClassStorageKey = (facultyId: string | null) =>
  `faculty_recent_classes_${facultyId || "anonymous"}`;
const sessionDraftStorageKey = (facultyId: string | null) =>
  `faculty_session_draft_${facultyId || "anonymous"}`;

const buildRecentClassKey = ({
  departmentCode,
  year,
  semester,
  section,
  subjectCode,
}: {
  departmentCode?: string;
  year: string;
  semester: string;
  section: string;
  subjectCode?: string;
}) =>
  `${String(departmentCode || "DEPT").trim().toUpperCase()}${String(year || "").trim()}${String(semester || "").trim()}${String(section || "").trim().toUpperCase()}-${String(subjectCode || "SUB").trim().toUpperCase()}`;

const formatCoordinate = (value: number) => Number(value).toFixed(6);

const buildGoogleMapsLocationUrl = (lat: number, lng: number) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${formatCoordinate(lat)},${formatCoordinate(lng)}`
  )}`;

const formatPercent = (value: number | null | undefined) =>
  `${Number(value || 0).toFixed(Number(value || 0) % 1 === 0 ? 0 : 1)}%`;

const getPercentBadgeColor = (value: number) =>
  value >= 85 ? "green" : value >= 75 ? "blue" : value >= 60 ? "yellow" : "red";

const QrPanel: React.FC<{
  title: string;
  value?: string;
  footer?: React.ReactNode;
  emptyText: string;
}> = React.memo(({ title, value, footer, emptyText }) => (
  <div className="w-full max-w-full overflow-hidden rounded-lg border border-slate-100 bg-slate-50 p-4 text-center">
    <p className="text-sm font-semibold text-slate-700 mb-3">{title}</p>
    {value ? (
      <div className="flex flex-col items-center">
        <div className="bg-white p-4">
          <QRCode
            value={value}
            size={280}
            level="L"
            style={{ width: "100%", maxWidth: 280, height: "auto" }}
          />
        </div>
        {footer ? <span className="mt-2 text-[10px] text-slate-400 flex items-center justify-center gap-1">{footer}</span> : null}
      </div>
    ) : (
      <div className="text-slate-400 text-xs text-center py-8">{emptyText}</div>
    )}
  </div>
));
QrPanel.displayName = "QrPanel";

const FacultyDashboard: React.FC = () => {
  const { currentUser, subjects = [], sessions = [], departments = [], createSession, stopSession, updateSessionToken, createSessionLocal, logout } = useApp();
  const facultyId = (currentUser as any)?.id || (currentUser as any)?._id || null;
  const mySubjects = useMemo(() => subjects || [], [subjects]);

  const [activeTab, setActiveTab] = useState<Tab>("TAKE_ATTENDANCE");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const activeSession = useMemo(() => sessions.find((s: any) => String(s.id || s._id) === String(activeSessionId || "")) || null, [sessions, activeSessionId]);

  const [formSubject, setFormSubject] = useState("");
  const [formYear, setFormYear] = useState("1");
  const [formSem, setFormSem] = useState("1");
  const [formSection, setFormSection] = useState("A");
  const [formDepartment, setFormDepartment] = useState("");
  const [formRadius, setFormRadius] = useState(
    String(DEFAULT_SESSION_RADIUS_METERS)
  );
  const [locationState, setLocationState] = useState<{ lat: number; lng: number } | null>(null);
  const [isLocationConfirmed, setIsLocationConfirmed] = useState(false);
  const [manualEnrollment, setManualEnrollment] = useState("");
  const [sheetFilters, setSheetFilters] = useState({ departmentId: "", year: "", semester: "", section: "", subjectId: "" });
  const [sheetColumns, setSheetColumns] = useState<string[]>([]);
  const [sheetRows, setSheetRows] = useState<{ name: string; enrollmentNo: string; attendance: Record<string, "P" | "A"> }[]>([]);
  const [liveAttendance, setLiveAttendance] = useState<any[]>([]);
  const [attendanceStatusMap, setAttendanceStatusMap] = useState<Record<string, "present" | "absent">>({});
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [sessionError, setSessionError] = useState("");
  const [startLoading, setStartLoading] = useState(false);
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");
  const [showManualLocation, setShowManualLocation] = useState(false);
  const [mobileLocateLoading, setMobileLocateLoading] = useState(false);
  const [mobileLocateToken, setMobileLocateToken] = useState<string | null>(null);
  const [mobileLocateStatus, setMobileLocateStatus] = useState("");
  const [mobileLocateExpiresAt, setMobileLocateExpiresAt] = useState<number | null>(null);
  const [manualLoading, setManualLoading] = useState(false);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [dynamicQrToken, setDynamicQrToken] = useState("");
  const [qrRotationSeconds, setQrRotationSeconds] = useState(Math.round(QR_REFRESH_MS / 1000));
  const [isQrFullscreen, setIsQrFullscreen] = useState(false);
  const [attendanceDataLoaded, setAttendanceDataLoaded] = useState(false);
  const [attendeesLoading, setAttendeesLoading] = useState(false);
  const [attendeesError, setAttendeesError] = useState("");
  const [deviceRequests, setDeviceRequests] = useState<any[]>([]);
  const [deviceRequestsLoading, setDeviceRequestsLoading] = useState(false);
  const [deviceRequestStatus, setDeviceRequestStatus] = useState<"all" | "pending" | "approved" | "rejected">("all");
  const [deviceRequestError, setDeviceRequestError] = useState("");
  const [deviceRejectNote, setDeviceRejectNote] = useState<Record<string, string>>({});
  const [deviceReviewingId, setDeviceReviewingId] = useState("");
  const [recentClasses, setRecentClasses] = useState<RecentClassPreset[]>([]);
  const [subjectAnalyticsOpen, setSubjectAnalyticsOpen] = useState(false);
  const [subjectAnalyticsLoading, setSubjectAnalyticsLoading] = useState(false);
  const [subjectAnalyticsError, setSubjectAnalyticsError] = useState("");
  const [subjectAnalyticsData, setSubjectAnalyticsData] =
    useState<FacultySubjectAnalyticsData | null>(null);
  const [subjectAnalyticsTarget, setSubjectAnalyticsTarget] = useState<any>(null);
  const [analyticsClassCodeFilter, setAnalyticsClassCodeFilter] = useState("");
  const [analyticsAttendanceFilter, setAnalyticsAttendanceFilter] = useState("all");
  const [analyticsSearch, setAnalyticsSearch] = useState("");
  const dynamicTokenRef = useRef("");
  const updateSessionTokenRef = useRef(updateSessionToken);
  const qrFullscreenRef = useRef<HTMLDivElement | null>(null);
  const totpStopRef = useRef<(() => void) | null>(null);
  const sessionSecretKeyRef = useRef<string | null>(null);

  const qrRef = useRef<number | null>(null);
  const mobileLocatePollRef = useRef<number | null>(null);
  const isActiveSessionRunning = Boolean(activeSessionId && (activeSession as any)?.isActive);
  const departmentMap = useMemo(
    () => new Map(departments.map((department: any) => [normalizeId(department), department])),
    [departments]
  );
  const subjectMap = useMemo(
    () => new Map(mySubjects.map((subject: any) => [normalizeId(subject), subject])),
    [mySubjects]
  );
  const filteredSubjects = useMemo(() => {
    if (!formDepartment) return mySubjects;
    return mySubjects.filter((s: any) => {
      const depts = Array.isArray(s?.departments) ? s.departments : [];
      return depts.some((d: any) => normalizeId(d) === String(formDepartment));
    });
  }, [mySubjects, formDepartment]);
  const selectedDepartment = useMemo(
    () => departmentMap.get(String(formDepartment)) || null,
    [departmentMap, formDepartment]
  );
  const selectedSubject = useMemo(
    () => subjectMap.get(String(formSubject)) || null,
    [subjectMap, formSubject]
  );
  const recentClassCards = useMemo(
    () =>
      recentClasses.map((preset) => {
        const department = departmentMap.get(String(preset.departmentId));
        const subject = subjectMap.get(String(preset.subjectId));
        const available = Boolean(department && subject);
        return {
          ...preset,
          available,
        };
      }).sort((a, b) => a.label.localeCompare(b.label)),
    [recentClasses, departmentMap, subjectMap]
  );

  useEffect(() => {
    updateSessionTokenRef.current = updateSessionToken;
  }, [updateSessionToken]);

  useEffect(() => {
    if (!facultyId) {
      setRecentClasses([]);
      return;
    }
    try {
      const raw = window.localStorage.getItem(recentClassStorageKey(facultyId));
      const parsed = raw ? JSON.parse(raw) : [];
      setRecentClasses(Array.isArray(parsed) ? parsed : []);
    } catch {
      setRecentClasses([]);
    }
  }, [facultyId]);

  useEffect(() => {
    if (!facultyId || activeSessionId) return;
    try {
      const raw = window.localStorage.getItem(sessionDraftStorageKey(facultyId));
      const draft = raw ? (JSON.parse(raw) as Partial<SessionFormDraft>) : null;
      if (!draft) return;
      setFormDepartment(String(draft.departmentId || ""));
      setFormYear(String(draft.year || "1"));
      setFormSem(String(draft.semester || "1"));
      setFormSection(String(draft.section || "A").toUpperCase());
      setFormSubject(String(draft.subjectId || ""));
      setFormRadius(String(draft.radiusMeters || DEFAULT_SESSION_RADIUS_METERS));
      if (draft.location && Number.isFinite(Number(draft.location.lat)) && Number.isFinite(Number(draft.location.lng))) {
        const lat = Number(draft.location.lat);
        const lng = Number(draft.location.lng);
        setLocationState({ lat, lng });
        setManualLat(String(draft.manualLat || lat.toFixed(6)));
        setManualLng(String(draft.manualLng || lng.toFixed(6)));
        setIsLocationConfirmed(false);
      }
    } catch {
      // Ignore invalid saved drafts.
    }
  }, [facultyId, activeSessionId]);

  useEffect(() => {
    if (!facultyId || activeSessionId) return;
    const draft: SessionFormDraft = {
      departmentId: formDepartment,
      year: formYear,
      semester: formSem,
      section: String(formSection || "A").toUpperCase(),
      subjectId: formSubject,
      radiusMeters: formRadius,
      location: locationState
        ? { lat: Number(locationState.lat), lng: Number(locationState.lng) }
        : null,
      manualLat,
      manualLng,
    };
    window.localStorage.setItem(sessionDraftStorageKey(facultyId), JSON.stringify(draft));
  }, [
    facultyId,
    activeSessionId,
    formDepartment,
    formYear,
    formSem,
    formSection,
    formSubject,
    formRadius,
    locationState,
    manualLat,
    manualLng,
  ]);

  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setIsQrFullscreen(false);
      }
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      const res: any = await apiClient.get("/api/faculty/session/active");
      if (cancelled || !res?.ok || !res.session) return;
      const s = res.session;
      createSessionLocal({
        id: s._id, facultyId: s.faculty, subjectId: s.subject, year: s.year, semester: s.semester, section: s.section,
        startTime: new Date(s.startTime).getTime(), endTime: s.endTime ? new Date(s.endTime).getTime() : null, isActive: s.isActive,
        locationLat: s.location?.lat, locationLng: s.location?.lng, locationRadiusMeters: s.location?.radiusMeters || 200, currentDynamicToken: "",
      });
      if (cancelled) return;
      setActiveSessionId(s._id);
      if (s.location?.lat != null && s.location?.lng != null) {
        setLocationState({ lat: Number(s.location.lat), lng: Number(s.location.lng) });
        setIsLocationConfirmed(true);
      }
    };
    restore();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (mobileLocatePollRef.current) {
        window.clearInterval(mobileLocatePollRef.current);
        mobileLocatePollRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const clear = () => {
      cancelled = true;
      if (qrRef.current) window.clearTimeout(qrRef.current);
      if (totpStopRef.current) totpStopRef.current();
      qrRef.current = null;
      totpStopRef.current = null;
      sessionSecretKeyRef.current = null;
    };
    if (!activeSessionId || !isActiveSessionRunning) return clear;

    // Try TOTP-based local generation first (zero-server-load)
    const initializeTotpQr = async () => {
      try {
        const r: any = await apiClient.getLiveQR(activeSessionId);
        if (!r?.ok || !r.secretKey) {
          // Fallback to traditional server polling if secretKey unavailable
          startServerPolling();
          return;
        }

        // Store secretKey for local token generation
        sessionSecretKeyRef.current = r.secretKey;
        const classCode = String(selectedSubject?.code || selectedSubject?.name || activeSessionId).slice(0, 12);

        // Start local TOTP generation instead of server polling
        totpStopRef.current = startQrPolling(
          r.secretKey,
          activeSessionId,
          classCode,
          (payload: RotatingQrPayload) => {
            const serialized = serializeQrPayload(payload);
            if (dynamicTokenRef.current !== serialized) {
              dynamicTokenRef.current = serialized;
              updateSessionTokenRef.current(activeSessionId, serialized);
              setDynamicQrToken(serialized);
            }
          },
          3000
        );

        setQrRotationSeconds(3);
      } catch {
        // Fallback to server polling on any error
        startServerPolling();
      }
    };

    const startServerPolling = () => {
      const scheduleQrPoll = (delayMs: number) => {
        if (cancelled) return;
        const safeDelay = Math.max(250, Math.min(Number(delayMs) || QR_REFRESH_MS, 30000));
        qrRef.current = window.setTimeout(pollQr, safeDelay);
      };
      const pollQr = async () => {
        const r: any = await apiClient.getLiveQR(activeSessionId);
        if (r?.ok && r.qr) {
          if (dynamicTokenRef.current !== r.qr) {
            dynamicTokenRef.current = r.qr;
            updateSessionTokenRef.current(activeSessionId, r.qr);
            setDynamicQrToken(r.qr);
          }
          if (Number(r.qrRotationSeconds) > 0) {
            setQrRotationSeconds(Number(r.qrRotationSeconds));
          }
          scheduleQrPoll(Number(r.nextRefreshInMs || QR_REFRESH_MS));
        } else if (String(r?.error || "").toLowerCase().includes("inactive")) {
          setActiveSessionId(null);
        } else {
          scheduleQrPoll(QR_REFRESH_MS);
        }
      };
      pollQr();
    };

    initializeTotpQr();
    return clear;
  }, [activeSessionId, isActiveSessionRunning, selectedSubject]);

  useEffect(() => {
    const token = String((activeSession as any)?.currentDynamicToken || "");
    dynamicTokenRef.current = token;
    setDynamicQrToken(token);
  }, [activeSessionId, activeSession]);

  useEffect(() => {
    if (!activeSessionId) return;

    loadCurrentAttendees();

    const unsubscribe = subscribeToSessionAttendance(activeSessionId, (payload) => {
      if (!payload?.attendance) return;
      const att = payload.attendance;
      const enrollmentNo = String(att.enrollmentNo || "").trim();

      setLiveAttendance((prev) => {
        const existingIdx = prev.findIndex(
          (item: any) =>
            String(item?.student?.enrollmentNo || item?.enrollmentNo || "").trim() === enrollmentNo
        );
        const newRecord = {
          _id: att.id || att._id,
          id: att.id || att._id,
          timestamp: att.timestamp,
          status: att.status || "present",
          student: {
            name: att.studentName,
            enrollmentNo: att.enrollmentNo,
          },
        };
        if (existingIdx >= 0) {
          const copy = [...prev];
          copy[existingIdx] = { ...copy[existingIdx], ...newRecord };
          return copy;
        }
        return [newRecord, ...prev];
      });

      if (enrollmentNo) {
        setAttendanceStatusMap((prev) => ({
          ...prev,
          [enrollmentNo]: att.status === "absent" ? "absent" : "present",
        }));
      }
    });

    return () => {
      unsubscribe();
    };
  }, [activeSessionId]);

  const loadDeviceRequests = async () => {
    setDeviceRequestsLoading(true);
    setDeviceRequestError("");
    try {
      const res: any = await apiClient.getDeviceChangeRequests(deviceRequestStatus);
      if (res?.ok) {
        setDeviceRequests(Array.isArray(res.requests) ? res.requests : []);
      } else {
        setDeviceRequestError(res?.error || "Failed to load device requests.");
      }
    } finally {
      setDeviceRequestsLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === "DEVICE_REQUESTS") {
      loadDeviceRequests();
    }
  }, [activeTab, deviceRequestStatus]);

  const loadSubjectAnalytics = async (subjectId: string, classCode = "") => {
    setSubjectAnalyticsLoading(true);
    setSubjectAnalyticsError("");
    try {
      const res: any = await apiClient.getFacultySubjectAnalytics(subjectId, {
        classCode: classCode || undefined,
      });
      if (!res?.ok) {
        setSubjectAnalyticsError(res?.error || "Failed to load subject analytics.");
        return;
      }
      setSubjectAnalyticsData(res as FacultySubjectAnalyticsData);
    } catch (err: any) {
      setSubjectAnalyticsError(err?.message || "Failed to load subject analytics.");
    } finally {
      setSubjectAnalyticsLoading(false);
    }
  };

  const openSubjectAnalytics = async (subject: any) => {
    const subjectId = String(subject?._id || subject?.id || "");
    if (!subjectId) return;
    setSubjectAnalyticsTarget(subject);
    setAnalyticsClassCodeFilter("");
    setAnalyticsAttendanceFilter("all");
    setAnalyticsSearch("");
    setSubjectAnalyticsData(null);
    setSubjectAnalyticsOpen(true);
    await loadSubjectAnalytics(subjectId, "");
  };

  const closeSubjectAnalytics = () => {
    setSubjectAnalyticsOpen(false);
    setSubjectAnalyticsLoading(false);
    setSubjectAnalyticsError("");
    setSubjectAnalyticsData(null);
    setSubjectAnalyticsTarget(null);
    setAnalyticsClassCodeFilter("");
    setAnalyticsAttendanceFilter("all");
    setAnalyticsSearch("");
  };

  const analyticsStudents = useMemo(() => {
    const base = subjectAnalyticsData?.students || [];
    return base.filter((student) => {
      if (analyticsAttendanceFilter === "below_75") {
        return student.totalClasses > 0 && student.attendancePercentage < 75;
      }
      if (analyticsAttendanceFilter === "75_plus") {
        return student.attendancePercentage >= 75;
      }
      if (analyticsAttendanceFilter === "90_plus") {
        return student.attendancePercentage >= 90;
      }
      if (analyticsAttendanceFilter === "zero") {
        return student.totalClasses > 0 && student.attendancePercentage === 0;
      }
      return true;
    }).filter((student) => {
      const query = analyticsSearch.trim().toLowerCase();
      if (!query) return true;
      return (
        String(student.name || "").toLowerCase().includes(query) ||
        String(student.enrollmentNo || "").toLowerCase().includes(query) ||
        String(student.classCode || "").toLowerCase().includes(query)
      );
    });
  }, [subjectAnalyticsData, analyticsAttendanceFilter, analyticsSearch]);

  const strongestClassInsight = useMemo(() => {
    const items = subjectAnalyticsData?.classCodeInsights || [];
    return [...items].sort(
      (a, b) => b.averageAttendancePercentage - a.averageAttendancePercentage
    )[0] || null;
  }, [subjectAnalyticsData]);

  const weakestClassInsight = useMemo(() => {
    const items = subjectAnalyticsData?.classCodeInsights || [];
    return [...items]
      .filter((item) => item.totalClasses > 0)
      .sort((a, b) => a.averageAttendancePercentage - b.averageAttendancePercentage)[0] || null;
  }, [subjectAnalyticsData]);

  const reviewDeviceRequest = async (
    requestId: string,
    decision: "approved" | "rejected"
  ) => {
    const note = String(deviceRejectNote[requestId] || "").trim();
    if (decision === "rejected" && !note) {
      setDeviceRequestError("Please add a rejection reason before rejecting.");
      return;
    }
    setDeviceReviewingId(requestId);
    setDeviceRequestError("");
    try {
      const res: any = await apiClient.reviewDeviceChangeRequest(requestId, {
        decision,
        reviewNote: note,
      });
      if (!res?.ok) {
        setDeviceRequestError(res?.error || "Failed to review request.");
        return;
      }
      await loadDeviceRequests();
    } finally {
      setDeviceReviewingId("");
    }
  };

  const captureLocation = () => {
    const MAX_ACCEPTABLE_ACCURACY_METERS = 120;
    setLocating(true);
    setLocationError("");
    if (!navigator.geolocation) {
      setLocationError("Geolocation is not supported in this browser.");
      setLocating(false);
      return;
    }
    const onPosition = (p: GeolocationPosition) => {
        const accuracy = Number(p.coords.accuracy || 0);
        if (!Number.isFinite(accuracy) || accuracy <= 0 || accuracy > MAX_ACCEPTABLE_ACCURACY_METERS) {
          setLocationError(
            `Precise GPS required. Current accuracy is ~${Math.round(
              accuracy || 0
            )}m. Move outdoors and enable high-accuracy location.`
          );
          setShowManualLocation(true);
          setLocating(false);
          return;
        }
        setLocationState({ lat: p.coords.latitude, lng: p.coords.longitude });
        setIsLocationConfirmed(true);
        setManualLat(formatCoordinate(p.coords.latitude));
        setManualLng(formatCoordinate(p.coords.longitude));
        setSessionError("");
        setShowManualLocation(false);
        setLocating(false);
      };

    const onError = (err: GeolocationPositionError) => {
        const insecure =
          !window.isSecureContext &&
          window.location.hostname !== "localhost" &&
          window.location.hostname !== "127.0.0.1";
        if (insecure) {
          setLocationError("Location requires HTTPS (or localhost). Open this app on a secure URL.");
          setShowManualLocation(true);
        } else if (err.code === 1) {
          setLocationError("Location permission denied. Allow location access and try again.");
          setShowManualLocation(true);
        } else if (err.code === 2) {
          setLocationError("Unable to detect your location. Check GPS/network and retry.");
          setShowManualLocation(true);
        } else if (err.code === 3) {
          navigator.geolocation.getCurrentPosition(
            onPosition,
            () => {
              setLocationError("Location request timed out. Please try again.");
              setShowManualLocation(true);
              setLocating(false);
            },
            { enableHighAccuracy: false, timeout: 20000, maximumAge: 120000 }
          );
          return;
        } else {
          setLocationError("Failed to capture location.");
          setShowManualLocation(true);
        }
        setLocating(false);
      };

    navigator.geolocation.getCurrentPosition(onPosition, onError, {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 0,
    });
  };

  const setManualLocation = () => {
    const lat = Number(manualLat);
    const lng = Number(manualLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setLocationError("Enter valid numeric latitude and longitude.");
      return;
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      setLocationError("Latitude must be between -90 and 90, longitude between -180 and 180.");
      return;
    }
    setLocationState({ lat, lng });
    setIsLocationConfirmed(true);
    setLocationError("");
    setSessionError("");
  };

  const showManualLocationEditor = () => {
    if (locationState) {
      setManualLat(formatCoordinate(locationState.lat));
      setManualLng(formatCoordinate(locationState.lng));
    }
    setIsLocationConfirmed(false);
    setShowManualLocation(true);
    setSessionError("");
    setLocationError("");
  };

  const stopMobileLocatePolling = () => {
    if (mobileLocatePollRef.current) {
      window.clearInterval(mobileLocatePollRef.current);
      mobileLocatePollRef.current = null;
    }
  };

  const closeMobileLocate = () => {
    stopMobileLocatePolling();
    setMobileLocateToken(null);
    setMobileLocateStatus("");
    setMobileLocateExpiresAt(null);
    setMobileLocateLoading(false);
  };

  const startLocateViaMobile = async () => {
    setLocationError("");
    setSessionError("");
    setMobileLocateLoading(true);
    setMobileLocateStatus("Generating mobile capture QR...");
    stopMobileLocatePolling();

    const res: any = await apiClient.createMobileLocationCapture({ facultyId });
    if (!res?.ok || !res.captureToken) {
      setMobileLocateLoading(false);
      setMobileLocateStatus("");
      setLocationError(res?.error || "Failed to create mobile location QR.");
      return;
    }

    const token = String(res.captureToken);
    setMobileLocateToken(token);
    setMobileLocateExpiresAt(Date.now() + Number(res.expiresInMs || 180000));
    setMobileLocateStatus("Scan this QR from a mobile phone to send live GPS.");
    setMobileLocateLoading(false);

    const poll = async () => {
      const capture: any = await apiClient.getMobileLocationCapture(token, facultyId || undefined);
      if (!capture?.ok) {
        setMobileLocateStatus(capture?.error || "Mobile location request expired.");
        stopMobileLocatePolling();
        return;
      }
      if (capture.status === "captured" && capture.coords?.lat != null && capture.coords?.lng != null) {
        const nextLat = Number(capture.coords.lat);
        const nextLng = Number(capture.coords.lng);
        setLocationState({ lat: nextLat, lng: nextLng });
        setIsLocationConfirmed(true);
        setManualLat(nextLat.toFixed(6));
        setManualLng(nextLng.toFixed(6));
        setShowManualLocation(false);
        setSessionError("");
        setLocationError("");
        setMobileLocateStatus(
          `Mobile location captured${capture.accuracy ? ` (~${Math.round(Number(capture.accuracy))}m accuracy)` : ""}.`
        );
        stopMobileLocatePolling();
      }
    };

    await poll();
    mobileLocatePollRef.current = window.setInterval(poll, 2500);
  };

  const persistRecentClasses = (updater: (prev: RecentClassPreset[]) => RecentClassPreset[]) => {
    setRecentClasses((prev) => {
      const next = updater(prev).slice(0, RECENT_CLASS_LIMIT);
      if (facultyId) {
        window.localStorage.setItem(recentClassStorageKey(facultyId), JSON.stringify(next));
      }
      return next;
    });
  };

  const applyRecentClass = (preset: RecentClassPreset) => {
    setFormDepartment(preset.departmentId);
    setFormYear(preset.year);
    setFormSem(preset.semester);
    setFormSection(preset.section);
    setFormSubject(preset.subjectId);
    setFormRadius(preset.radiusMeters || String(DEFAULT_SESSION_RADIUS_METERS));
    setLocationState(preset.location);
    setIsLocationConfirmed(Boolean(preset.location));
    setManualLat(preset.location?.lat != null ? Number(preset.location.lat).toFixed(6) : "");
    setManualLng(preset.location?.lng != null ? Number(preset.location.lng).toFixed(6) : "");
    setShowManualLocation(false);
    setSessionError("");
    setLocationError("");
  };

  const removeRecentClass = (presetKey: string) => {
    persistRecentClasses((prev) => prev.filter((item) => item.key !== presetKey));
  };

  const resetConfirmedLocation = () => {
    setIsLocationConfirmed(false);
    setSessionError("");
  };

  const start = async () => {
    setSessionError("");
    if (activeSessionId) {
      setSessionError("A session is already active.");
      return;
    }
    if (!formSubject) {
      setSessionError("Please choose a subject.");
      return;
    }
    if (!formDepartment) {
      setSessionError("Please choose a department.");
      return;
    }
    if (!locationState) {
      setSessionError("Capture location before starting the session.");
      return;
    }
    if (!isLocationConfirmed) {
      setSessionError("Capture or confirm the location for this class before starting the session.");
      return;
    }
    setStartLoading(true);
    const radiusMeters = Number(formRadius || DEFAULT_SESSION_RADIUS_METERS);
    if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) {
      setSessionError("Allowed radius must be greater than 0.");
      setStartLoading(false);
      return;
    }
    const nextPreset: RecentClassPreset = {
      key: buildRecentClassKey({
        departmentCode: selectedDepartment?.code || selectedDepartment?.name,
        year: formYear,
        semester: formSem,
        section: formSection,
        subjectCode: selectedSubject?.code || selectedSubject?.name,
      }),
      label: buildRecentClassKey({
        departmentCode: selectedDepartment?.code || selectedDepartment?.name,
        year: formYear,
        semester: formSem,
        section: formSection,
        subjectCode: selectedSubject?.code || selectedSubject?.name,
      }),
      departmentId: formDepartment,
      departmentName: selectedDepartment?.name || "Department",
      departmentCode: selectedDepartment?.code || "",
      subjectId: formSubject,
      subjectName: selectedSubject?.name || "Subject",
      subjectCode: selectedSubject?.code || "",
      year: formYear,
      semester: formSem,
      section: String(formSection).toUpperCase(),
      radiusMeters: String(radiusMeters),
      location: {
        lat: Number(locationState.lat),
        lng: Number(locationState.lng),
      },
      updatedAt: Date.now(),
    };
    const res: any = await createSession({
      facultyId, subjectId: formSubject, departmentId: formDepartment, year: Number(formYear), semester: Number(formSem), section: String(formSection).toUpperCase(),
      location: {
        lat: Number(locationState.lat),
        lng: Number(locationState.lng),
        radiusMeters,
      },
    });
    if (res?.ok && res.session) {
      persistRecentClasses((prev) => [
        nextPreset,
        ...prev.filter((item) => item.key !== nextPreset.key),
      ]);
      setActiveSessionId(String(res.session.id || res.session._id));
    } else setSessionError(res?.error || "Failed to start session");
    setStartLoading(false);
  };

  const stop = async () => {
    if (!activeSessionId) return;
    const res: any = await stopSession(activeSessionId);
    if (!res?.ok) alert(res?.error || "Failed to stop session");
    setActiveSessionId(null);
    setIsQrFullscreen(false);
    setLiveAttendance([]);
  };

  const cancelSession = async () => {
    if (!activeSessionId) return;
    const ok = window.confirm(
      "Cancel this session? This is for accidental start and will end the live session now."
    );
    if (!ok) return;
    const res: any = await apiClient.post(
      `/api/faculty/session/${activeSessionId}/cancel`
    );
    if (!res?.ok) {
      alert(res?.error || "Failed to cancel session");
      return;
    }
    setActiveSessionId(null);
    setLiveAttendance([]);
    setDynamicQrToken("");
    setIsQrFullscreen(false);
  };

  const openQrFullscreen = async () => {
    if (!activeSessionId) return;
    setIsQrFullscreen(true);
    window.setTimeout(async () => {
      try {
        if (qrFullscreenRef.current?.requestFullscreen) {
          await qrFullscreenRef.current.requestFullscreen();
        }
      } catch {
        // If browser blocks fullscreen API, fallback to fixed-screen mode only.
      }
    }, 0);
  };

  const closeQrFullscreen = async () => {
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        // ignore exit errors
      }
    }
    setIsQrFullscreen(false);
  };

  const loadCurrentAttendees = async () => {
    if (!activeSessionId) return;
    setAttendeesLoading(true);
    setAttendeesError("");
    setAttendanceDataLoaded(false);
    try {
      const res: any = await apiClient.fetchAttendance({
        sessionId: activeSessionId,
        includeDerivedAbsences: true,
      });
      if (res?.ok) {
        const nextAttendance = Array.isArray(res.attendance) ? res.attendance : [];
        setLiveAttendance(nextAttendance);
        setAttendanceStatusMap(() => {
          const next: Record<string, "present" | "absent"> = {};
          nextAttendance.forEach((item: any) => {
            const enrollmentNo = String(item?.student?.enrollmentNo || "").trim();
            if (!enrollmentNo) return;
            next[enrollmentNo] = String(item?.status || "").toLowerCase() === "present" ? "present" : "absent";
          });
          return next;
        });
        setAttendanceDataLoaded(true);
      } else {
        setAttendeesError(res?.error || "Failed to load attendees.");
        setLiveAttendance([]);
        setAttendanceStatusMap({});
      }
    } finally {
      setAttendeesLoading(false);
    }
  };

  const manual = async (status: "present" | "absent", enrollmentNo?: string) => {
    if (!activeSessionId) return;
    const v = String(enrollmentNo || manualEnrollment).trim();
    if (!v) return;
    setManualLoading(true);
    const res: any = await apiClient.manualAttendance({ sessionId: activeSessionId, enrollmentNo: v, status });
    if (!res?.ok) alert(res?.error || "Manual attendance failed");
    setAttendanceStatusMap((prev) => ({ ...prev, [v]: status }));
    setManualEnrollment("");
    setManualLoading(false);
  };

  const handleAttendanceItemToggle = async (item: any) => {
    const enrollmentNo = String(item?.student?.enrollmentNo || "").trim();
    if (!enrollmentNo || !activeSessionId) return;

    const currentStatus = attendanceStatusMap[enrollmentNo] || (String(item?.status || "").toLowerCase() === "present" ? "present" : "absent");
    const nextStatus: "present" | "absent" = currentStatus === "present" ? "absent" : "present";

    setAttendanceStatusMap((prev) => ({ ...prev, [enrollmentNo]: nextStatus }));
    await manual(nextStatus, enrollmentNo);
  };

  const loadSheet = async () => {
    if (!sheetFilters.subjectId) return;
    setSheetLoading(true);
    const res: any = await apiClient.fetchAttendance({
      subjectId: sheetFilters.subjectId, departmentId: sheetFilters.departmentId || undefined, year: sheetFilters.year || undefined,
      semester: sheetFilters.semester || undefined, section: sheetFilters.section || undefined,
    });
    if (!res?.ok) {
      setSheetLoading(false);
      return alert(res?.error || "Failed to load sheet");
    }
    const logs = Array.isArray(res.attendance) ? res.attendance : [];
    const sessionMeta = new Map<string, { orderTime: number; label: string }>();
    const stu = new Map<string, { name: string; enrollmentNo: string }>();
    const prs = new Set<string>();
    const toDateTimeKey = (dt: Date) => {
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, "0");
      const d = String(dt.getDate()).padStart(2, "0");
      const hh = String(dt.getHours()).padStart(2, "0");
      const mm = String(dt.getMinutes()).padStart(2, "0");
      return `${y}-${m}-${d} ${hh}:${mm}`;
    };
    logs.forEach((x: any) => {
      const sid = String(x?.session?._id || x?.session || "").trim();
      const sortTime = new Date(
        x?.session?.startTime || x?.timestamp || x?.createdAt || Date.now()
      ).getTime();
      const label = toDateTimeKey(
        new Date(x?.session?.startTime || x?.timestamp || x?.createdAt || Date.now())
      );
      const colKey = sid || label;
      if (!sessionMeta.has(colKey)) {
        sessionMeta.set(colKey, { orderTime: sortTime, label });
      }
      const e = String(x?.student?.enrollmentNo || "").trim();
      if (!e) return;
      if (!stu.has(e)) stu.set(e, { name: x?.student?.name || "", enrollmentNo: e });
      if (String(x?.status || "").toLowerCase() === "present") {
        prs.add(`${e}|${colKey}`);
      }
    });
    const columns = Array.from(sessionMeta.entries())
      .sort((a, b) => a[1].orderTime - b[1].orderTime)
      .map(([colKey, meta]) => `${colKey}::${meta.label}`);
    const rows = Array.from(stu.values()).sort((a, b) => a.enrollmentNo.localeCompare(b.enrollmentNo)).map((s) => {
      const attendance: Record<string, "P" | "A"> = {};
      columns.forEach((c) => {
        const [colKey] = c.split("::");
        attendance[c] = prs.has(`${s.enrollmentNo}|${colKey}`) ? "P" : "A";
      });
      return { ...s, attendance };
    });
    setSheetColumns(columns);
    setSheetRows(rows);
    setSheetLoading(false);
  };

  const exportCsv = () => {
    if (!sheetRows.length) return;
    const esc = (v: any) => {
      const s = String(v ?? "");
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      [
        "Enrollment",
        "Name",
        ...sheetColumns.map((c) => c.split("::")[1] || c),
      ].join(","),
      ...sheetRows.map((r) => [
        esc(r.enrollmentNo),
        esc(r.name),
        ...sheetColumns.map((c) => esc(r.attendance[c] || "A")),
      ].join(",")),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "Attendance_Sheet.csv";
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const presentRows = useMemo(() => {
    const seen = new Map<string, any>();
    (liveAttendance || []).forEach((a: any) => {
      if (String(a?.status || "").toLowerCase() !== "present") return;
      const e = String(a?.student?.enrollmentNo || "");
      if (e && !seen.has(e)) seen.set(e, a);
    });
    return Array.from(seen.values()).sort((a: any, b: any) => String(a?.student?.enrollmentNo || "").localeCompare(String(b?.student?.enrollmentNo || "")));
  }, [liveAttendance]);

  const attendanceCards = useMemo(() => {
    const collection = Array.isArray(liveAttendance) ? liveAttendance : [];
    return collection
      .map((a: any) => {
        const student = a?.student || {};
        const enrollmentNo = String(student?.enrollmentNo || "").trim();
        const status = String(a?.status || "").toLowerCase() === "present" ? "present" : "absent";
        return {
          ...a,
          student,
          enrollmentNo,
          status,
        };
      })
      .filter((a) => Boolean(a.enrollmentNo))
      .sort((a, b) => a.enrollmentNo.localeCompare(b.enrollmentNo));
  }, [liveAttendance]);

  const totalAttendanceStrength = useMemo(() => (Array.isArray(liveAttendance) ? liveAttendance.length : 0), [liveAttendance]);

  const mobileLocateUrl = useMemo(() => {
    if (!mobileLocateToken) return "";
    return `${window.location.origin}/mobile-location?token=${encodeURIComponent(mobileLocateToken)}`;
  }, [mobileLocateToken]);

  const capturedLocationLabel = useMemo(() => {
    if (!locationState) return "";
    return `${formatCoordinate(locationState.lat)}, ${formatCoordinate(locationState.lng)}`;
  }, [locationState]);

  const capturedLocationMapUrl = useMemo(() => {
    if (!locationState) return "";
    return buildGoogleMapsLocationUrl(locationState.lat, locationState.lng);
  }, [locationState]);

  const openCapturedLocationInMaps = () => {
    if (!capturedLocationMapUrl) return;
    window.open(capturedLocationMapUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="mx-auto min-h-screen max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {isQrFullscreen && activeSessionId && (
        <div
          ref={qrFullscreenRef}
          className="fixed inset-0 z-[80] overflow-auto bg-white p-4 md:p-8"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Badge color="green">LIVE</Badge>
              <span className="text-sm text-slate-600">
                Full Screen QR View
              </span>
            </div>
            <Button variant="secondary" onClick={closeQrFullscreen}>
              <Minimize2 size={14} /> Minimize
            </Button>
          </div>
          <div className="flex min-h-[420px] max-h-[90vh] w-full max-w-full flex-col items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-700 mb-4">
              Attendance QR
            </p>
            {dynamicQrToken ? (
              <div className="bg-white p-4">
                <QRCode
                  value={dynamicQrToken}
                  size={520}
                  level="L"
                  style={{ width: "100%", maxWidth: 520, height: "auto" }}
                />
              </div>
            ) : (
              <p className="text-slate-400 text-sm">Waiting for QR token...</p>
            )}
          </div>
        </div>
      )}

      <CollegeHeader
        className="surface-card mb-6"
        collegeName={currentUser?.collegeName}
        profilePhotoUrl={currentUser?.profilePhotoUrl}
        profileMenuPhotoUrl={currentUser?.facultyProfilePhotoUrl}
        title="Faculty Dashboard"
        subtitle="Manage attendance, QR sessions, and student device requests."
        eyebrow="Faculty Portal"
        user={currentUser}
        roleLabel="Faculty"
        onLogout={logout}
      />

      <div className="flex flex-wrap gap-2 mb-6 border-b border-slate-200 pb-1">
        {[{ id: "TAKE_ATTENDANCE", label: "Take Attendance", icon: Play }, { id: "MANAGE_ATTENDANCE", label: "Manage Attendance", icon: List }, { id: "DEVICE_REQUESTS", label: "Device Requests", icon: Smartphone }, { id: "MANAGE_SUBJECTS", label: "Manage Subjects", icon: BookOpen }].map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id as Tab)} className={`flex items-center gap-2 px-6 py-3 rounded-t-lg font-medium transition-all ${activeTab === tab.id ? "bg-teal-600 text-white shadow-sm translate-y-[1px]" : "bg-white text-slate-600 hover:bg-slate-50"}`}><tab.icon size={18} /> {tab.label}</button>
        ))}
      </div>

      {activeTab === "TAKE_ATTENDANCE" && <Card title={activeSessionId ? "Session Details" : "Configure Session"}>
        {!activeSessionId && <div className="space-y-4">
          {recentClassCards.length ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-800">Daily Classes</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {recentClassCards.map((preset) => (
                  <div key={preset.key} className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm transition-shadow hover:shadow">
                    <button
                      type="button"
                      onClick={() => applyRecentClass(preset)}
                      disabled={!preset.available}
                      className="min-w-0 break-words text-sm font-semibold tracking-normal text-slate-800 transition-colors hover:text-teal-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {preset.label}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeRecentClass(preset.key)}
                      className="text-[11px] font-medium text-slate-400 transition-colors hover:text-red-500"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Department</label>
              <select
                className="w-full border rounded p-2"
                value={formDepartment}
                onChange={(e) => {
                  setFormDepartment(e.target.value);
                  setFormSubject("");
                  resetConfirmedLocation();
                }}
              >
                <option value="">-- Choose Department --</option>
                {departments.map((d: any) => (
                  <option key={d._id || d.id} value={d._id || d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Year</label>
              <select className="w-full border rounded p-2 disabled:bg-slate-100 disabled:text-slate-400" value={formYear} onChange={(e) => { setFormYear(e.target.value); resetConfirmedLocation(); }} disabled={!formDepartment}>{YEAR_OPTIONS.map((y) => <option key={y} value={y}>{y}</option>)}</select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Semester</label>
              <select className="w-full border rounded p-2 disabled:bg-slate-100 disabled:text-slate-400" value={formSem} onChange={(e) => { setFormSem(e.target.value); resetConfirmedLocation(); }} disabled={!formDepartment}>{SEMESTER_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}</select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Section</label>
              <select className="w-full border rounded p-2 disabled:bg-slate-100 disabled:text-slate-400" value={formSection} onChange={(e) => { setFormSection(e.target.value); resetConfirmedLocation(); }} disabled={!formDepartment}>{SECTION_OPTIONS.map((sec) => <option key={sec} value={sec}>{sec}</option>)}</select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Subject</label>
              <select className="w-full border rounded p-2 disabled:bg-slate-100 disabled:text-slate-400" value={formSubject} onChange={(e) => { setFormSubject(e.target.value); resetConfirmedLocation(); }} disabled={!formDepartment}>
                <option value="">-- Choose Subject --</option>
                {filteredSubjects.map((s: any) => <option key={s._id || s.id} value={s._id || s.id}>{s.name} ({s.code})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Allowed Radius (meters)</label>
              <input
                type="number"
                min={1}
                max={1000}
                className="w-full border rounded p-2 text-sm disabled:bg-slate-100 disabled:text-slate-400"
                value={formRadius}
                onChange={(e) => setFormRadius(e.target.value)}
                disabled={!formDepartment}
              />
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Button onClick={captureLocation} disabled={locating} className="w-full sm:w-auto">{locating ? <><Crosshair size={16} /> Capturing...</> : <><MapPin size={16} /> Capture Location</>}</Button>
            <Button onClick={startLocateViaMobile} variant="secondary" disabled={mobileLocateLoading} className="w-full sm:w-auto">
              {mobileLocateLoading ? <><RefreshCw size={16} className="animate-spin" /> Preparing...</> : <><Smartphone size={16} /> Locate via Mobile</>}
            </Button>
            <Button onClick={start} disabled={startLoading || !locationState || !isLocationConfirmed || !formDepartment || !formSubject || !!activeSessionId} className="w-full sm:w-auto">{startLoading ? <><RefreshCw size={16} className="animate-spin" /> Starting...</> : <><Play size={16} /> Start Session</>}</Button>
            {isLocationConfirmed && <span className="text-xs text-slate-500 flex items-center gap-1"><CheckCircle size={12} className="text-green-500" /> GPS Captured</span>}
          </div>
          {locationState && isLocationConfirmed ? (
            <div className="rounded-xl border border-green-200 bg-green-50/60 px-4 py-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-green-700">
                    Captured Coordinates
                  </p>
                  <p className="mt-1 break-words font-mono text-sm text-slate-800">
                    {capturedLocationLabel}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={openCapturedLocationInMaps}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
                  >
                    <ExternalLink size={12} />
                    See Location
                  </button>
                  <button
                    type="button"
                    onClick={showManualLocationEditor}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
                  >
                    <MapPin size={12} />
                    Edit Coordinates
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {mobileLocateToken ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-800">Mobile Location QR</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Scan this from a phone connected to the same accessible app URL.
                    {window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
                      ? " This page is running on localhost, so mobile scan will work only if you open the app from a LAN or tunnel URL."
                      : ""}
                  </p>
                </div>
                <Button variant="secondary" onClick={closeMobileLocate}>Close</Button>
              </div>
              <div className="mt-4 flex w-full max-w-full flex-col items-center overflow-hidden">
                <div className="bg-white p-3">
                  <QRCode
                    value={mobileLocateUrl}
                    size={220}
                    level="L"
                    style={{ width: "100%", maxWidth: 220, height: "auto" }}
                  />
                </div>
                <p className="mt-3 text-xs text-slate-600 text-center">
                  {mobileLocateStatus || "Waiting for mobile location..."}
                </p>
                {mobileLocateExpiresAt ? (
                  <p className="mt-1 text-[11px] text-slate-400">
                    Expires at {new Date(mobileLocateExpiresAt).toLocaleTimeString()}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
          {(showManualLocation || !window.isSecureContext) && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input className="w-full border rounded p-2 text-sm" placeholder="Latitude (e.g. 19.0760)" value={manualLat} onChange={(e) => setManualLat(e.target.value)} />
              <input className="w-full border rounded p-2 text-sm" placeholder="Longitude (e.g. 72.8777)" value={manualLng} onChange={(e) => setManualLng(e.target.value)} />
              <Button onClick={setManualLocation} variant="secondary"><MapPin size={14} /> Use Manual Location</Button>
            </div>
          )}
          {locationError && <p className="text-xs text-red-600">{locationError}</p>}
          {sessionError && <p className="text-xs text-red-600">{sessionError}</p>}
        </div>}

        {activeSessionId && <div className="space-y-4">
          <div className="flex flex-wrap gap-4 items-center"><Badge color="green">LIVE</Badge><span className="text-sm text-slate-600 flex items-center gap-1"><Users size={14} /> {presentRows.length} present</span><span className="text-xs text-slate-400 flex items-center gap-1"><Clock size={12} /> Started at {activeSession?.startTime ? new Date(activeSession.startTime).toLocaleTimeString() : "-"}</span></div>
          <div className="grid grid-cols-1 gap-4">
            <QrPanel
              title="Attendance"
              value={dynamicQrToken || undefined}
              footer={<><RefreshCw size={10} /> QR changes every {qrRotationSeconds} seconds</>}
              emptyText="Waiting for QR token..."
            />
          </div>
          <div className="flex flex-col justify-end gap-2 sm:flex-row">
            {!isQrFullscreen ? (
              <Button variant="secondary" onClick={openQrFullscreen}>
                <Maximize2 size={14} /> Full Screen
              </Button>
            ) : (
              <Button variant="secondary" onClick={closeQrFullscreen}>
                <Minimize2 size={14} /> Minimize
              </Button>
            )}
            <Button variant="secondary" onClick={cancelSession}>
              <Square size={14} /> Cancel Session
            </Button>
            <Button variant="danger" onClick={stop}>
              <Square size={14} /> Stop Session
            </Button>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-teal-50 via-white to-slate-50 p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-teal-600 px-3 py-2 text-lg font-bold text-white shadow-sm">{presentRows.length} / {totalAttendanceStrength || 0}</div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Attendance</p>
                  <p className="text-sm font-semibold text-slate-800">Present / Total Strength</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => void loadCurrentAttendees()}
                  variant="secondary"
                  disabled={attendeesLoading}
                  className="min-w-[180px]"
                >
                  {attendeesLoading ? <><RefreshCw size={14} className="animate-spin" /> Loading...</> : <><Users size={14} /> Load Attendance Data</>}
                </Button>
                <button
                  type="button"
                  onClick={() => void loadCurrentAttendees()}
                  aria-label="Refresh attendance data"
                  className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                >
                  <RefreshCw size={16} className={attendeesLoading ? "animate-spin" : ""} />
                </button>
              </div>
            </div>
          </div>
          <Card title="Attendance Roster">
            {!attendanceDataLoaded ? (
              <div className="flex min-h-[180px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-center">
                <Users size={28} className="mb-3 text-slate-400" />
                <p className="text-base font-semibold text-slate-700">Attendance list is not loaded yet.</p>
                <p className="mt-1 max-w-sm text-sm text-slate-500">Use Load Attendance Data to fetch the current student roster and reveal attendance controls.</p>
              </div>
            ) : (
              <>
                <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-10">
                  {attendanceCards.length === 0 ? (
                    <div className="col-span-full rounded-2xl border border-dashed border-slate-200 bg-slate-50 py-10 text-center text-sm text-slate-400">
                      No attendance records loaded for this session yet.
                    </div>
                  ) : (
                    attendanceCards.map((item: any) => {
                      const enrollmentNo = String(item?.student?.enrollmentNo || "").trim();
                      const isPresent = (attendanceStatusMap[enrollmentNo] || item.status) === "present";
                      const fullName = String(item?.student?.name || "Student");

                      return (
                        <button
                          key={`${enrollmentNo || item?._id || "unknown"}-${isPresent ? "present" : "absent"}`}
                          type="button"
                          title={`${fullName} — ${enrollmentNo}`}
                          onClick={() => void handleAttendanceItemToggle(item)}
                          className={`group flex aspect-[0.72] min-w-0 flex-col items-center justify-center rounded-2xl border p-2 text-center transition-all hover:-translate-y-0.5 hover:shadow-lg ${
                            isPresent
                              ? "border-emerald-300 bg-emerald-50 shadow-emerald-100"
                              : "border-slate-200 bg-white shadow-slate-100"
                          }`}
                        >
                          <div className={`flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border ${
                            isPresent ? "border-emerald-300 bg-emerald-100" : "border-slate-200 bg-slate-100"
                          }`}>
                            {item.student?.profilePhotoUrl ? (
                              <img
                                src={item.student.profilePhotoUrl}
                                alt={fullName}
                                loading="lazy"
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <Users size={18} className={isPresent ? "text-emerald-600" : "text-slate-400"} />
                            )}
                          </div>
                          <div className={`mt-2 truncate text-[10px] font-semibold uppercase tracking-[0.14em] ${isPresent ? "text-emerald-900" : "text-slate-500"}`}>
                            {enrollmentNo || "USN"}
                          </div>
                          <div className="mt-1 hidden truncate text-[10px] text-slate-500 group-hover:block">
                            {fullName}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    className="min-w-0 flex-1 rounded border border-slate-200 px-3 py-2 text-sm"
                    placeholder="Enter Enrollment No"
                    value={manualEnrollment}
                    onChange={(e) => setManualEnrollment(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && manual("present")}
                  />
                  <Button onClick={() => manual("present")} disabled={manualLoading} className="w-full sm:w-auto">
                    <UserPlus size={14} /> Add
                  </Button>
                </div>
              </>
            )}
          </Card>
        </div>}
      </Card>}

      {activeTab === "MANAGE_ATTENDANCE" && <Card className="space-y-4">
        <div className="flex flex-wrap gap-2 items-end">
          <select className="border rounded p-2 text-sm" value={sheetFilters.departmentId} onChange={(e) => setSheetFilters((p) => ({ ...p, departmentId: e.target.value }))}><option value="">All Departments</option>{departments.map((d: any) => <option key={d._id || d.id} value={d._id || d.id}>{d.name}</option>)}</select>
          <select className="border rounded p-2 text-sm" value={sheetFilters.year} onChange={(e) => setSheetFilters((p) => ({ ...p, year: e.target.value }))}><option value="">All Years</option>{[1, 2, 3, 4].map((y) => <option key={y} value={y}>{y}</option>)}</select>
          <select className="border rounded p-2 text-sm" value={sheetFilters.semester} onChange={(e) => setSheetFilters((p) => ({ ...p, semester: e.target.value }))}><option value="">All Semesters</option>{[1, 2, 3, 4, 5, 6, 7, 8].map((s) => <option key={s} value={s}>{s}</option>)}</select>
          <select className="border rounded p-2 text-sm" value={sheetFilters.section} onChange={(e) => setSheetFilters((p) => ({ ...p, section: e.target.value }))}><option value="">All Sections</option>{["A", "B", "C", "D"].map((sec) => <option key={sec} value={sec}>{sec}</option>)}</select>
          <select className="border rounded p-2 text-sm min-w-[220px]" value={sheetFilters.subjectId} onChange={(e) => setSheetFilters((p) => ({ ...p, subjectId: e.target.value }))}><option value="">-- Choose Subject --</option>{mySubjects.map((s: any) => <option key={s._id || s.id} value={s._id || s.id}>{s.name} ({s.code})</option>)}</select>
          <Button onClick={loadSheet} disabled={sheetLoading || !sheetFilters.subjectId}>{sheetLoading ? <><RefreshCw size={14} className="animate-spin" /> Loading...</> : <><List size={14} /> Load Sheet</>}</Button>
          <Button variant="secondary" onClick={exportCsv} disabled={!sheetRows.length}><Download size={14} /> Download CSV</Button>
        </div>
        <div className="w-full overflow-auto rounded-xl border border-slate-100">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50"><tr><th className="px-4 py-2 text-left text-xs font-semibold text-slate-600">Enrollment</th><th className="px-4 py-2 text-left text-xs font-semibold text-slate-600">Student Name</th>{sheetColumns.map((c) => <th key={c} className="px-3 py-2 text-center text-xs font-semibold text-slate-600">{c.split("::")[1] || c}</th>)}</tr></thead>
            <tbody>{!sheetRows.length ? <tr><td colSpan={2 + sheetColumns.length} className="px-4 py-6 text-center text-xs text-slate-400">Load a sheet using filters.</td></tr> : sheetRows.map((row) => <tr key={row.enrollmentNo} className="border-t"><td className="px-4 py-2 font-mono text-xs text-slate-700">{row.enrollmentNo}</td><td className="px-4 py-2 text-xs text-slate-800">{row.name}</td>{sheetColumns.map((c) => <td key={`${row.enrollmentNo}-${c}`} className="px-3 py-2 text-center text-xs">{row.attendance[c] === "P" ? <Badge color="green">P</Badge> : <Badge color="gray">A</Badge>}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </Card>}

      {activeTab === "DEVICE_REQUESTS" && <Card title="Device Change Requests">
        <div className="flex flex-col gap-3 mb-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm text-slate-500">
              Requests expire after 24 hours. Completed requests stay visible with reviewer details.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(["all", "pending", "approved", "rejected"] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setDeviceRequestStatus(status)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
                    deviceRequestStatus === status
                      ? "border-teal-500 bg-teal-50 text-teal-700"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>
          <Button variant="secondary" onClick={loadDeviceRequests} disabled={deviceRequestsLoading}>
            {deviceRequestsLoading ? <><RefreshCw size={14} className="animate-spin" /> Loading...</> : <><RefreshCw size={14} /> Refresh</>}
          </Button>
        </div>
        {deviceRequestError ? <p className="mb-3 text-sm text-red-600">{deviceRequestError}</p> : null}
        <div className="space-y-4">
          {deviceRequestsLoading ? (
            <div className="space-y-3">
              <Skeleton className="shimmer h-28 w-full" />
              <Skeleton className="shimmer h-28 w-full" />
            </div>
          ) : null}
          {!deviceRequestsLoading && deviceRequests.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 py-10 text-center text-sm text-slate-400">
              No {deviceRequestStatus === "all" ? "" : deviceRequestStatus} device change requests for your department.
            </div>
          ) : null}
          {deviceRequests.map((request: any) => {
            const expiresAt = request.expiresAt ? new Date(request.expiresAt) : null;
            const reviewedAt = request.reviewedAt ? new Date(request.reviewedAt) : null;
            const student = request.student || {};
            const status = String(request.status || "pending").toLowerCase();
            const isPending = status === "pending";
            const statusColor =
              status === "approved"
                ? "green"
                : status === "rejected"
                  ? "red"
                  : status === "expired"
                    ? "gray"
                    : "yellow";
            const reviewedLabel =
              status === "approved"
                ? "Approved"
                : status === "rejected"
                  ? "Rejected"
                  : "Updated";
            const reviewerLabel =
              status === "approved"
                ? "Approved by"
                : status === "rejected"
                  ? "Rejected by"
                  : "Reviewed by";
            return (
              <div key={request._id || request.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className={isPending ? "grid grid-cols-1 lg:grid-cols-[160px_1fr] gap-4" : "space-y-2"}>
                  {isPending ? (
                    <div>
                      {request.selfieDataUrl ? (
                        <img
                          src={request.selfieDataUrl}
                          alt="Student live verification"
                          className="h-40 w-40 rounded-lg border border-slate-200 object-cover"
                        />
                      ) : (
                        <div className="h-40 w-40 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center text-xs text-slate-400">
                          No photo
                        </div>
                      )}
                    </div>
                  ) : null}
                  <div className={isPending ? "space-y-3" : "space-y-2"}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="font-bold text-slate-900">{student.name || "Student"}</h3>
                        {isPending ? (
                          <>
                            <p className="text-sm font-semibold text-slate-700">USN: {student.enrollmentNo || "-"}</p>
                            <p className="text-xs text-slate-500">{student.email || "-"}</p>
                            <p className="text-xs text-slate-500">
                              Year {student.year || "-"}, Semester {student.semester || "-"}, Section {student.section || "-"}
                            </p>
                          </>
                        ) : (
                          <p className="text-sm text-slate-600">
                            {student.enrollmentNo || "-"} | {student.email || "-"} | Y{student.year || "-"} S{student.semester || "-"} Sec {student.section || "-"}
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <Badge color={statusColor as any}>{status.toUpperCase()}</Badge>
                        <p className="mt-1 text-xs text-slate-400">
                          {isPending
                            ? `Expires ${expiresAt ? expiresAt.toLocaleString() : "soon"}`
                            : `${reviewedLabel} ${reviewedAt ? reviewedAt.toLocaleString() : ""}`}
                        </p>
                      </div>
                    </div>

                    <div className={isPending ? "rounded-lg bg-slate-50 p-3 text-xs text-slate-500" : "text-xs text-slate-500"}>
                      {isPending ? (
                        <>
                          <p>Review the live photo against college records or your in-person knowledge before approving.</p>
                          <p className="mt-1">The requested device is rechecked for conflicts at approval time.</p>
                        </>
                      ) : (
                        <>
                          <p>
                            {reviewerLabel}{" "}
                            <span className="font-semibold text-slate-700">
                              {request.reviewedBy?.name || "Faculty"}
                            </span>
                          </p>
                          {status === "rejected" && request.reviewNote ? (
                            <p className="mt-1">
                              Reason: <span className="font-semibold text-slate-700">{request.reviewNote}</span>
                            </p>
                          ) : null}
                        </>
                      )}
                    </div>

                    {isPending ? (
                      <>
                        <textarea
                          className="w-full rounded-lg border border-slate-200 p-2 text-sm"
                          rows={2}
                          placeholder="Reason required only when rejecting"
                          value={deviceRejectNote[request._id] || ""}
                          onChange={(e) =>
                            setDeviceRejectNote((prev) => ({
                              ...prev,
                              [request._id]: e.target.value,
                            }))
                          }
                        />

                        <div className="flex flex-wrap gap-2">
                          <Button
                            onClick={() => reviewDeviceRequest(request._id, "approved")}
                            disabled={deviceReviewingId === request._id}
                          >
                            <CheckCircle size={14} /> Approve Device
                          </Button>
                          <Button
                            variant="danger"
                            onClick={() => reviewDeviceRequest(request._id, "rejected")}
                            disabled={deviceReviewingId === request._id}
                          >
                            Reject
                          </Button>
                        </div>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>}

      {activeTab === "MANAGE_SUBJECTS" && <Card title="My Allotted Subjects">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {mySubjects.length === 0 ? <div className="col-span-3 text-center py-10 text-slate-400 italic bg-slate-50 rounded-lg border border-dashed">No subjects allotted yet. Contact Admin.</div> : mySubjects.map((sub: any) => (
            <div key={sub._id || sub.id} className="relative bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-bold text-lg text-slate-800 mb-1">{sub.name}</h3>
                  <div className="inline-block bg-teal-50 text-teal-700 text-xs font-mono px-2 py-1 rounded">{sub.code}</div>
                </div>
                <Button variant="outline" className="shrink-0" onClick={() => openSubjectAnalytics(sub)}>
                  <BarChart3 size={14} /> Analytics
                </Button>
              </div>
              <div className="mt-4 pt-4 border-t border-slate-100 flex justify-between items-center gap-3">
                <span className="text-xs text-slate-500 font-medium">Department</span>
                <span className="text-xs text-right text-slate-800 font-bold">{Array.isArray(sub.departments) && sub.departments.length ? sub.departments.map((d: any) => d.name).join(", ") : sub.departmentName || "General"}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>}

      {subjectAnalyticsOpen ? (
        <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-slate-950/60 p-4">
          <div className="flex max-h-[90vh] w-full max-w-[1180px] flex-col overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-2xl">
            <div className="border-b border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(45,212,191,0.18),_transparent_34%),linear-gradient(135deg,_#0f172a_0%,_#115e59_54%,_#14b8a6_100%)] px-5 py-4 text-white md:px-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em]">
                    <BarChart3 size={14} />
                    Subject Analytics
                  </div>
                  <h3 className="truncate text-xl font-semibold md:text-2xl">
                    {subjectAnalyticsData?.subject?.name || subjectAnalyticsTarget?.name || "Analytics"}
                  </h3>
                  <p className="mt-1 text-sm text-teal-50/90">
                    Filter class performance, spot risk patterns, and review student-wise attendance without leaving Manage Subjects.
                  </p>
                </div>
                <Button variant="secondary" className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={closeSubjectAnalytics}>
                  Close
                </Button>
              </div>
            </div>

            <div className="overflow-auto bg-[linear-gradient(180deg,_#f8fafc_0%,_#ecfeff_100%)] p-4 md:p-5">
              {subjectAnalyticsLoading ? (
                <div className="flex min-h-[340px] items-center justify-center">
                  <div className="rounded-3xl border border-slate-200 bg-white px-8 py-10 text-center shadow-sm">
                    <LoaderCircle size={28} className="mx-auto animate-spin text-teal-600" />
                    <p className="mt-3 text-base font-semibold text-slate-900">Loading analytics</p>
                    <p className="mt-1 text-sm text-slate-500">Building class-wise and student-wise attendance insights.</p>
                  </div>
                </div>
              ) : subjectAnalyticsError ? (
                <div className="flex min-h-[320px] items-center justify-center">
                  <div className="max-w-md rounded-3xl border border-rose-200 bg-white px-6 py-8 text-center shadow-sm">
                    <TriangleAlert size={26} className="mx-auto text-rose-500" />
                    <p className="mt-3 text-lg font-semibold text-slate-900">Unable to load analytics</p>
                    <p className="mt-2 text-sm text-slate-600">{subjectAnalyticsError}</p>
                  </div>
                </div>
              ) : subjectAnalyticsData ? (
                <div className="space-y-4">
                  <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="grid gap-3 lg:grid-cols-[1.15fr_1fr]">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge>{subjectAnalyticsData.subject.code}</Badge>
                          <Badge color="gray">{subjectAnalyticsData.filters.classCodes.length} class code{subjectAnalyticsData.filters.classCodes.length === 1 ? "" : "s"}</Badge>
                        </div>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                          <div className="rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">Total Classes</p>
                            <p className="mt-2 text-2xl font-bold text-slate-900">{subjectAnalyticsData.overview.totalClasses}</p>
                          </div>
                          <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">Avg Attendees %</p>
                            <p className="mt-2 text-2xl font-bold text-slate-900">{formatPercent(subjectAnalyticsData.overview.averageAttendancePercentage)}</p>
                          </div>
                          <div className="rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-700">Students Covered</p>
                            <p className="mt-2 text-2xl font-bold text-slate-900">{subjectAnalyticsData.overview.totalStudents}</p>
                          </div>
                          <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-700">Below 75%</p>
                            <p className="mt-2 text-2xl font-bold text-slate-900">{subjectAnalyticsData.overview.studentsBelow75}</p>
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Strongest Class</p>
                              <p className="mt-2 text-lg font-semibold text-slate-900">{strongestClassInsight?.classCode || "No data"}</p>
                            </div>
                            <TrendingUp className="text-emerald-500" size={20} />
                          </div>
                          {strongestClassInsight ? <p className="mt-3 text-sm text-slate-600">{formatPercent(strongestClassInsight.averageAttendancePercentage)} average attendance in {strongestClassInsight.totalClasses} classes.</p> : <p className="mt-3 text-sm text-slate-500">No completed class data yet.</p>}
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Needs Focus</p>
                              <p className="mt-2 text-lg font-semibold text-slate-900">{weakestClassInsight?.classCode || "No data"}</p>
                            </div>
                            <TrendingDown className="text-rose-500" size={20} />
                          </div>
                          {weakestClassInsight ? <p className="mt-3 text-sm text-slate-600">{formatPercent(weakestClassInsight.averageAttendancePercentage)} average attendance, worth immediate follow-up.</p> : <p className="mt-3 text-sm text-slate-500">No risk class identified yet.</p>}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="grid gap-3 lg:grid-cols-[220px_220px_1fr]">
                      <div>
                        <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Class Code</label>
                        <select
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                          value={analyticsClassCodeFilter}
                          onChange={async (e) => {
                            const next = e.target.value;
                            setAnalyticsClassCodeFilter(next);
                            await loadSubjectAnalytics(String(subjectAnalyticsData.subject.id), next);
                          }}
                        >
                          <option value="">All Class Codes</option>
                          {subjectAnalyticsData.filters.classCodes.map((item) => (
                            <option key={item.classCode} value={item.classCode}>
                              {item.classCode} • {item.departmentCode || item.departmentName} • Sec {item.section}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Attendance Filter</label>
                        <select
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                          value={analyticsAttendanceFilter}
                          onChange={(e) => setAnalyticsAttendanceFilter(e.target.value)}
                        >
                          <option value="all">All Students</option>
                          <option value="below_75">Below 75%</option>
                          <option value="75_plus">75% and above</option>
                          <option value="90_plus">90% and above</option>
                          <option value="zero">Zero attendance</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Search Student</label>
                        <div className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2">
                          <Search size={16} className="text-slate-400" />
                          <input
                            className="w-full bg-transparent text-sm outline-none"
                            placeholder="Name, enrollment, or class code"
                            value={analyticsSearch}
                            onChange={(e) => setAnalyticsSearch(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
                    <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Class Insights</p>
                          <h4 className="mt-1 text-lg font-semibold text-slate-900">Performance by class code</h4>
                        </div>
                        <Filter size={18} className="text-slate-400" />
                      </div>
                      <div className="mt-4 space-y-3">
                        {subjectAnalyticsData.classCodeInsights.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-400">
                            No completed classes found for this selection.
                          </div>
                        ) : subjectAnalyticsData.classCodeInsights.map((item) => (
                          <div key={item.classCode} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-base font-semibold text-slate-900">{item.classCode}</p>
                                  <Badge color={getPercentBadgeColor(item.averageAttendancePercentage) as any}>{formatPercent(item.averageAttendancePercentage)}</Badge>
                                </div>
                                <p className="mt-1 text-sm text-slate-500">{item.departmentName} • Sem {item.semester} • Sec {item.section}</p>
                              </div>
                              <div className="text-right text-sm text-slate-500">
                                <p>{item.totalClasses} classes</p>
                                <p>{item.studentCount} students</p>
                              </div>
                            </div>
                            <div className="mt-3 h-2 rounded-full bg-slate-200">
                              <div className="h-2 rounded-full bg-[linear-gradient(90deg,_#14b8a6_0%,_#2563eb_100%)]" style={{ width: `${Math.max(4, Math.min(item.averageAttendancePercentage, 100))}%` }} />
                            </div>
                            <p className="mt-3 text-sm text-slate-600">Average present count: {item.averagePresentCount}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Recent Sessions</p>
                        <h4 className="mt-1 text-lg font-semibold text-slate-900">Latest attendance trail</h4>
                      </div>
                      <div className="mt-4 overflow-x-auto">
                        <table className="w-full min-w-[640px] text-left text-sm">
                          <thead className="bg-slate-50">
                            <tr>
                              <th className="px-4 py-3">Class</th>
                              <th className="px-4 py-3">Date</th>
                              <th className="px-4 py-3">Present</th>
                              <th className="px-4 py-3">Attendance</th>
                            </tr>
                          </thead>
                          <tbody>
                            {subjectAnalyticsData.sessionInsights.length === 0 ? (
                              <tr>
                                <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-400">No recent completed sessions found.</td>
                              </tr>
                            ) : subjectAnalyticsData.sessionInsights.map((session) => (
                              <tr key={session.sessionId} className="border-t border-slate-100">
                                <td className="px-4 py-3">
                                  <div className="font-semibold text-slate-800">{session.classCode}</div>
                                  <div className="text-xs text-slate-500">{session.departmentName} • Sec {session.section}</div>
                                </td>
                                <td className="px-4 py-3 text-slate-600">{new Date(session.date).toLocaleString()}</td>
                                <td className="px-4 py-3 text-slate-600">{session.presentCount}/{session.eligibleCount}</td>
                                <td className="px-4 py-3"><Badge color={getPercentBadgeColor(session.attendancePercentage) as any}>{formatPercent(session.attendancePercentage)}</Badge></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Student Breakdown</p>
                        <h4 className="mt-1 text-lg font-semibold text-slate-900">Attendance percentage by student</h4>
                      </div>
                      <p className="text-sm text-slate-500">{analyticsStudents.length} student{analyticsStudents.length === 1 ? "" : "s"} after filters</p>
                    </div>
                    <div className="mt-4 overflow-x-auto">
                      <table className="w-full min-w-[920px] text-left text-sm">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="px-4 py-3">Student</th>
                            <th className="px-4 py-3">Class Code</th>
                            <th className="px-4 py-3">Attendance</th>
                            <th className="px-4 py-3">Attended</th>
                            <th className="px-4 py-3">Missed</th>
                            <th className="px-4 py-3">Last Class</th>
                          </tr>
                        </thead>
                        <tbody>
                          {analyticsStudents.length === 0 ? (
                            <tr>
                              <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-400">No students match the selected filters.</td>
                            </tr>
                          ) : analyticsStudents.map((student) => (
                            <tr key={student.studentId} className="border-t border-slate-100">
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-3">
                                  {student.profilePhotoUrl ? (
                                    <img src={student.profilePhotoUrl} alt={student.name} className="h-10 w-10 rounded-2xl border border-slate-200 object-cover" />
                                  ) : (
                                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-xs font-bold text-slate-500">
                                      {String(student.name || "S").slice(0, 1).toUpperCase()}
                                    </div>
                                  )}
                                  <div>
                                    <div className="font-semibold text-slate-800">{student.name}</div>
                                    <div className="text-xs text-slate-500">{student.enrollmentNo}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <div className="font-semibold text-slate-800">{student.classCode}</div>
                                <div className="text-xs text-slate-500">{student.departmentName} • Sec {student.section}</div>
                              </td>
                              <td className="px-4 py-3"><Badge color={getPercentBadgeColor(student.attendancePercentage) as any}>{formatPercent(student.attendancePercentage)}</Badge></td>
                              <td className="px-4 py-3 text-slate-700">{student.attendedClasses}/{student.totalClasses}</td>
                              <td className="px-4 py-3 text-slate-700">{student.missedClasses}</td>
                              <td className="px-4 py-3">
                                {student.lastAttendanceStatus === "none" ? (
                                  <span className="text-slate-400">No class yet</span>
                                ) : (
                                  <div>
                                    <Badge color={student.lastAttendanceStatus === "present" ? "green" : "red"}>
                                      {student.lastAttendanceStatus === "present" ? "Present" : "Absent"}
                                    </Badge>
                                    <div className="mt-1 text-xs text-slate-500">{student.lastClassAt ? new Date(student.lastClassAt).toLocaleString() : "-"}</div>
                                  </div>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default FacultyDashboard;
