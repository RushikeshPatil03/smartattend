import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useApp } from "../store";
import {
  Play,
  List,
  Smartphone,
  BookOpen,
  Radio,
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  X,
} from "lucide-react";
import apiClient from "../services/apiClient";
import CollegeHeader from "../components/CollegeHeader";
import { subscribeToSessionAttendance } from "../services/supabaseClient";

// Modular Sub-Components
import {
  Tab,
  RecentClassPreset,
  SessionFormDraft,
  FacultySubjectAnalyticsData,
  LiveAttendanceItem,
  DeviceRequestItem,
} from "./faculty/types";
import LiveSessionStudio from "./faculty/LiveSessionStudio";
import SessionSetupCard from "./faculty/SessionSetupCard";
import AttendanceRosterTable from "./faculty/AttendanceRosterTable";
import DeviceRequestsView from "./faculty/DeviceRequestsView";
import FacultyAnalyticsModal from "./faculty/FacultyAnalyticsModal";
import ManageSubjectsView from "./faculty/ManageSubjectsView";

const QR_REFRESH_MS = Math.max(
  2000,
  Number(import.meta.env.VITE_QR_REFRESH_MS || 2000)
);
const DEFAULT_SESSION_RADIUS_METERS = Number(
  import.meta.env.VITE_SESSION_RADIUS_METERS || 50
);
const RECENT_CLASS_LIMIT = 6;

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

const FacultyDashboard: React.FC = () => {
  const {
    currentUser,
    subjects = [],
    sessions = [],
    departments = [],
    fetchDepartments,
    fetchSubjects,
    createSession,
    stopSession,
    cancelSession: cancelSessionFromStore,
    updateSessionToken,
    createSessionLocal,
    endSessionLocal,
    logout,
  } = useApp();

  const facultyId = (currentUser as any)?.id || (currentUser as any)?._id || null;
  const mySubjects = useMemo(() => subjects || [], [subjects]);

  // Tab State
  const [activeTab, setActiveTab] = useState<Tab>("TAKE_ATTENDANCE");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const activeSession = useMemo(
    () =>
      sessions.find(
        (s: any) => String(s.id || s._id) === String(activeSessionId || "")
      ) || null,
    [sessions, activeSessionId]
  );
  const isActiveSessionRunning = Boolean(
    activeSessionId && (activeSession as any)?.isActive
  );

  // Form States
  const [formSubject, setFormSubject] = useState("");
  const [formYear, setFormYear] = useState("1");
  const [formSem, setFormSem] = useState("1");
  const [formSection, setFormSection] = useState("A");
  const [formDepartment, setFormDepartment] = useState("");
  const [formRadius, setFormRadius] = useState(
    String(DEFAULT_SESSION_RADIUS_METERS)
  );
  const [locationState, setLocationState] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [isLocationConfirmed, setIsLocationConfirmed] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [sessionError, setSessionError] = useState("");
  const [startLoading, setStartLoading] = useState(false);
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");
  const [showManualLocation, setShowManualLocation] = useState(false);

  // Mobile Location Capture States
  const [mobileLocateLoading, setMobileLocateLoading] = useState(false);
  const [mobileLocateToken, setMobileLocateToken] = useState<string | null>(null);
  const [mobileLocateStatus, setMobileLocateStatus] = useState("");
  const [mobileLocateExpiresAt, setMobileLocateExpiresAt] = useState<number | null>(null);
  const mobileLocatePollRef = useRef<number | null>(null);

  // Live Session & Attendance States
  const [activeSessionSecretKey, setActiveSessionSecretKey] = useState<string | null>(null);
  const [totalClassStrength, setTotalClassStrength] = useState<number>(0);
  const [liveAttendance, setLiveAttendance] = useState<LiveAttendanceItem[]>([]);
  const [attendanceStatusMap, setAttendanceStatusMap] = useState<
    Record<string, "present" | "absent">
  >({});
  const [attendanceDataLoaded, setAttendanceDataLoaded] = useState(false);
  const [attendeesLoading, setAttendeesLoading] = useState(false);
  const [manualLoading, setManualLoading] = useState(false);
  const [manualEnrollment, setManualEnrollment] = useState("");

  // Sheet / Manage Attendance States
  const [sheetFilters, setSheetFilters] = useState({
    departmentId: "",
    year: "",
    semester: "",
    section: "",
    subjectId: "",
  });
  const [sheetColumns, setSheetColumns] = useState<string[]>([]);
  const [sheetRows, setSheetRows] = useState<
    { name: string; enrollmentNo: string; attendance: Record<string, "P" | "A"> }[]
  >([]);
  const [sheetLoading, setSheetLoading] = useState(false);
  const sheetMatrixCacheRef = useRef<
    Map<string, { columns: string[]; rows: any[]; cachedAt: number }>
  >(new Map());

  // Device Requests States
  const [deviceRequests, setDeviceRequests] = useState<DeviceRequestItem[]>([]);
  const [deviceRequestsLoading, setDeviceRequestsLoading] = useState(false);
  const [deviceRequestStatus, setDeviceRequestStatus] = useState<
    "all" | "pending" | "approved" | "rejected"
  >("all");
  const [deviceRequestError, setDeviceRequestError] = useState("");
  const [deviceRejectNote, setDeviceRejectNote] = useState<Record<string, string>>({});
  const [deviceReviewingId, setDeviceReviewingId] = useState("");

  // Presets & Subject Analytics States
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

  // Optimistic Attendance Rollback Toast Notification State
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    setToastMessage(msg);
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 4000);
  }, []);

  // Refs
  const updateSessionTokenRef = useRef(updateSessionToken);

  // Concurrency-Safe RequestAnimationFrame (RAF) Event Batching Queue & Timers
  const queueRef = useRef<any[]>([]);
  const rafTimerRef = useRef<number | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const realtimeUnsubscribeRef = useRef<(() => void) | null>(null);

  // Concurrency & Mutation Sequence Tracker for Optimistic Attendance Updates
  const pendingMutationVersionsRef = useRef<Map<string, number>>(new Map());
  const attendanceStatusMapRef = useRef(attendanceStatusMap);
  attendanceStatusMapRef.current = attendanceStatusMap;
  const liveAttendanceRef = useRef(liveAttendance);
  liveAttendanceRef.current = liveAttendance;

  // Department and Subject maps
  const departmentMap = useMemo(
    () =>
      new Map(
        departments.map((department: any) => [normalizeId(department), department])
      ),
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
      recentClasses
        .map((preset) => {
          const department = departmentMap.get(String(preset.departmentId));
          const subject = subjectMap.get(String(preset.subjectId));
          const available = Boolean(department && subject);
          return {
            ...preset,
            available,
          };
        })
        .sort((a, b) => a.label.localeCompare(b.label)),
    [recentClasses, departmentMap, subjectMap]
  );

  useEffect(() => {
    updateSessionTokenRef.current = updateSessionToken;
  }, [updateSessionToken]);

  // Load Recent Classes
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

  // Load Draft Form
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
      if (
        draft.location &&
        Number.isFinite(Number(draft.location.lat)) &&
        Number.isFinite(Number(draft.location.lng))
      ) {
        const lat = Number(draft.location.lat);
        const lng = Number(draft.location.lng);
        setLocationState({ lat, lng });
        setManualLat(String(draft.manualLat || lat.toFixed(6)));
        setManualLng(String(draft.manualLng || lng.toFixed(6)));
        setIsLocationConfirmed(false);
      }
    } catch {
      // Ignore draft parse errors
    }
  }, [facultyId, activeSessionId]);

  // Save Draft Form
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
    window.localStorage.setItem(
      sessionDraftStorageKey(facultyId),
      JSON.stringify(draft)
    );
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
    if (!departments.length || !subjects.length) {
      void Promise.all([fetchDepartments(), fetchSubjects()]);
    }
  }, [departments.length, subjects.length, fetchDepartments, fetchSubjects]);

  // Restore Active Session on Mount
  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      const res: any = await apiClient.get("/api/faculty/session/active");
      if (cancelled || !res?.ok || !res.session) return;
      const s = res.session;
      const secretKey = res.secretKey || s.secretKey || null;
      const totalStudents = Number(s.totalStudents || res.totalStudents || 0);
      createSessionLocal({
        id: s._id,
        facultyId: s.faculty,
        subjectId: s.subject,
        departmentId: s.department,
        year: s.year,
        semester: s.semester,
        section: s.section,
        startTime: new Date(s.startTime).getTime(),
        endTime: s.endTime ? new Date(s.endTime).getTime() : null,
        isActive: s.isActive,
        locationLat: s.location?.lat,
        locationLng: s.location?.lng,
        locationRadiusMeters: s.location?.radiusMeters || 200,
        currentDynamicToken: "",
        secretKey,
        totalStudents,
        totalStrength: totalStudents,
      });
      if (cancelled) return;
      setActiveSessionId(s._id);
      setActiveSessionSecretKey(secretKey);
      if (totalStudents > 0) {
        setTotalClassStrength(totalStudents);
      }
      if (s.location?.lat != null && s.location?.lng != null) {
        setLocationState({
          lat: Number(s.location.lat),
          lng: Number(s.location.lng),
        });
        setIsLocationConfirmed(true);
      }
    };
    restore();
    return () => {
      cancelled = true;
    };
  }, [createSessionLocal]);

  // Clean Mobile Location Polling on Unmount
  useEffect(() => {
    return () => {
      if (mobileLocatePollRef.current) {
        window.clearInterval(mobileLocatePollRef.current);
        mobileLocatePollRef.current = null;
      }
    };
  }, []);



  const persistRecentClasses = useCallback(
    (updater: (prev: RecentClassPreset[]) => RecentClassPreset[]) => {
      setRecentClasses((prev) => {
        const next = updater(prev).slice(0, RECENT_CLASS_LIMIT);
        if (facultyId) {
          window.localStorage.setItem(
            recentClassStorageKey(facultyId),
            JSON.stringify(next)
          );
        }
        return next;
      });
    },
    [facultyId]
  );

  const applyRecentClass = useCallback((preset: RecentClassPreset) => {
    setFormDepartment(preset.departmentId);
    setFormYear(preset.year);
    setFormSem(preset.semester);
    setFormSection(preset.section);
    setFormSubject(preset.subjectId);
    setFormRadius(preset.radiusMeters || String(DEFAULT_SESSION_RADIUS_METERS));
    setLocationState(preset.location);
    setIsLocationConfirmed(Boolean(preset.location));
    setManualLat(
      preset.location?.lat != null ? Number(preset.location.lat).toFixed(6) : ""
    );
    setManualLng(
      preset.location?.lng != null ? Number(preset.location.lng).toFixed(6) : ""
    );
    setShowManualLocation(false);
    setSessionError("");
    setLocationError("");
  }, []);

  const removeRecentClass = useCallback(
    (presetKey: string) => {
      persistRecentClasses((prev) => prev.filter((item) => item.key !== presetKey));
    },
    [persistRecentClasses]
  );

  const resetConfirmedLocation = useCallback(() => {
    setIsLocationConfirmed(false);
    setSessionError("");
  }, []);

  // Capture Browser Geolocation
  const captureLocation = useCallback(() => {
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
      if (
        !Number.isFinite(accuracy) ||
        accuracy <= 0 ||
        accuracy > MAX_ACCEPTABLE_ACCURACY_METERS
      ) {
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
        setLocationError(
          "Location requires HTTPS (or localhost). Open this app on a secure URL."
        );
        setShowManualLocation(true);
      } else if (err.code === 1) {
        setLocationError(
          "Location permission denied. Allow location access and try again."
        );
        setShowManualLocation(true);
      } else if (err.code === 2) {
        setLocationError(
          "Unable to detect your location. Check GPS/network and retry."
        );
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
  }, []);

  const setManualLocation = useCallback(() => {
    const lat = Number(manualLat);
    const lng = Number(manualLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setLocationError("Enter valid numeric latitude and longitude.");
      return;
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      setLocationError(
        "Latitude must be between -90 and 90, longitude between -180 and 180."
      );
      return;
    }
    setLocationState({ lat, lng });
    setIsLocationConfirmed(true);
    setLocationError("");
    setSessionError("");
  }, [manualLat, manualLng]);

  const showManualLocationEditor = useCallback(() => {
    if (locationState) {
      setManualLat(formatCoordinate(locationState.lat));
      setManualLng(formatCoordinate(locationState.lng));
    }
    setIsLocationConfirmed(false);
    setShowManualLocation(true);
    setSessionError("");
    setLocationError("");
  }, [locationState]);

  const stopMobileLocatePolling = useCallback(() => {
    if (mobileLocatePollRef.current) {
      window.clearInterval(mobileLocatePollRef.current);
      mobileLocatePollRef.current = null;
    }
  }, []);

  const closeMobileLocate = useCallback(() => {
    stopMobileLocatePolling();
    setMobileLocateToken(null);
    setMobileLocateStatus("");
    setMobileLocateExpiresAt(null);
    setMobileLocateLoading(false);
  }, [stopMobileLocatePolling]);

  const startLocateViaMobile = useCallback(async () => {
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
      const capture: any = await apiClient.getMobileLocationCapture(
        token,
        facultyId || undefined
      );
      if (!capture?.ok) {
        setMobileLocateStatus(
          capture?.error || "Mobile location request expired."
        );
        stopMobileLocatePolling();
        return;
      }
      if (
        capture.status === "captured" &&
        capture.coords?.lat != null &&
        capture.coords?.lng != null
      ) {
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
          `Mobile location captured${
            capture.accuracy
              ? ` (~${Math.round(Number(capture.accuracy))}m accuracy)`
              : ""
          }.`
        );
        stopMobileLocatePolling();
      }
    };

    await poll();
    mobileLocatePollRef.current = window.setInterval(poll, 2500);
  }, [facultyId, stopMobileLocatePolling]);

  // Launch Session Handler
  const start = useCallback(async () => {
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
      setSessionError(
        "Capture or confirm the location for this class before starting the session."
      );
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
      facultyId,
      subjectId: formSubject,
      departmentId: formDepartment,
      year: Number(formYear),
      semester: Number(formSem),
      section: String(formSection).toUpperCase(),
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
      const nextId = String(res.session.id || res.session._id);
      const secretKey = res.secretKey || res.session?.secretKey;
      const total = Number(res.totalStudents || res.session?.totalStudents || 0);
      setActiveSessionSecretKey(secretKey || null);
      setActiveSessionId(nextId);
      if (total > 0) {
        setTotalClassStrength(total);
      }
    } else {
      setSessionError(res?.error || "Failed to start session");
    }
    setStartLoading(false);
  }, [
    activeSessionId,
    formSubject,
    formDepartment,
    formYear,
    formSem,
    formSection,
    formRadius,
    locationState,
    isLocationConfirmed,
    facultyId,
    createSession,
    selectedDepartment,
    selectedSubject,
    persistRecentClasses,
  ]);

  // Synchronous, immediate Realtime WebSocket Teardown, RAF cancellation, and Buffer Clear
  const disconnectRealtime = useCallback(() => {
    if (realtimeUnsubscribeRef.current) {
      try {
        realtimeUnsubscribeRef.current();
      } catch (err) {
        console.warn("Realtime unsubscribe error:", err);
      }
      realtimeUnsubscribeRef.current = null;
    }
    if (rafTimerRef.current !== null) {
      window.clearTimeout(rafTimerRef.current);
      rafTimerRef.current = null;
    }
    if (rafIdRef.current !== null) {
      window.cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    queueRef.current = [];
  }, []);


  // Finalize Attendance: Teardown active realtime and local active session state without redundant API calls
  const stop = useCallback(() => {
    if (!activeSessionId) return;

    disconnectRealtime();
    endSessionLocal(activeSessionId);
    setActiveSessionId(null);
    setActiveSessionSecretKey(null);
    setTotalClassStrength(0);
    setLiveAttendance([]);
    setAttendanceStatusMap({});
    showToast("Attendance finalized and saved successfully.");
  }, [activeSessionId, disconnectRealtime, endSessionLocal, showToast]);

  const cancelSession = useCallback(async () => {
    if (!activeSessionId) return;
    disconnectRealtime();
    try {
      const res: any = await cancelSessionFromStore(activeSessionId);
      if (!res?.ok && res?.error) {
        alert(res.error);
        return;
      }
    } catch (err: any) {
      console.error("Cancel session error:", err);
    } finally {
      setActiveSessionId(null);
      setActiveSessionSecretKey(null);
      setTotalClassStrength(0);
      setLiveAttendance([]);
      setAttendanceStatusMap({});
    }
  }, [activeSessionId, cancelSessionFromStore, disconnectRealtime]);

  const loadCurrentAttendees = useCallback(async (includeDerived = true) => {
    if (!activeSessionId) return;
    setAttendeesLoading(true);
    setAttendanceDataLoaded(false);
    try {
      const res: any = await apiClient.fetchAttendance({
        sessionId: activeSessionId,
        includeDerivedAbsences: includeDerived,
      });
      if (res?.ok) {
        const nextAttendance = Array.isArray(res.attendance) ? res.attendance : [];
        setLiveAttendance(nextAttendance);
        const total = Number(
          res.totalStudents || res.totalStrength || nextAttendance.length || 0
        );
        if (total > 0) {
          setTotalClassStrength(total);
        }
        setAttendanceStatusMap((prev) => {
          const next = { ...prev };
          nextAttendance.forEach((item: any) => {
            const enrollmentNo = String(
              item?.student?.enrollmentNo || item?.enrollmentNo || ""
            ).trim();
            if (!enrollmentNo) return;
            if (!next[enrollmentNo]) {
              next[enrollmentNo] =
                String(item?.status || "").toLowerCase() === "present"
                  ? "present"
                  : "absent";
            }
          });
          return next;
        });
        setAttendanceDataLoaded(true);
      }
    } catch (err) {
      console.warn("Failed to load attendees:", err);
    } finally {
      setAttendeesLoading(false);
    }
  }, [activeSessionId]);

  const manual = useCallback(
    async (status: "present" | "absent", enrollmentNo?: string) => {
      if (!activeSessionId) return;
      const targetEnrollment = String(enrollmentNo || manualEnrollment).trim();
      if (!targetEnrollment) return;

      const isManualInput = !enrollmentNo;
      if (isManualInput) {
        setManualEnrollment("");
      }

      // 1. Capture snapshot of previous status for atomic rollback on network failure
      const currentMap = attendanceStatusMapRef.current;
      const currentList = liveAttendanceRef.current;
      const prevStatus: "present" | "absent" =
        currentMap[targetEnrollment] ||
        (() => {
          const item = currentList.find(
            (it: any) =>
              String(it?.student?.enrollmentNo || it?.enrollmentNo || "").trim() ===
              targetEnrollment
          );
          return String(item?.status || "").toLowerCase() === "present"
            ? "present"
            : "absent";
        })();

      // If already in the target status, skip unnecessary mutations
      if (prevStatus === status && currentMap[targetEnrollment] === status) {
        return;
      }

      // 2. Immediate Optimistic UI Update (< 1ms execution, 0 button lag)
      setAttendanceStatusMap((prev) => ({ ...prev, [targetEnrollment]: status }));
      setLiveAttendance((prev) => {
        const idx = prev.findIndex(
          (item: any) =>
            String(item?.student?.enrollmentNo || item?.enrollmentNo || "").trim() ===
            targetEnrollment
        );
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], status };
          return next;
        }
        const newRecord = {
          _id: `manual-${targetEnrollment}-${Date.now()}`,
          id: `manual-${targetEnrollment}-${Date.now()}`,
          timestamp: new Date().toISOString(),
          status,
          student: {
            name: targetEnrollment,
            enrollmentNo: targetEnrollment,
          },
          enrollmentNo: targetEnrollment,
        };
        return [newRecord, ...prev];
      });

      // 3. Concurrency Version Tracking: Increment mutation sequence for this student
      const mutationVersion =
        (pendingMutationVersionsRef.current.get(targetEnrollment) || 0) + 1;
      pendingMutationVersionsRef.current.set(targetEnrollment, mutationVersion);

      // 4. Background Non-Blocking API Execution with Rollback on Failure
      (async () => {
        try {
          const res: any = await apiClient.manualAttendance({
            sessionId: activeSessionId,
            enrollmentNo: targetEnrollment,
            status,
          });

          // Guard against out-of-order responses if superseded by a newer toggle
          if (
            pendingMutationVersionsRef.current.get(targetEnrollment) !== mutationVersion
          ) {
            return;
          }

          if (!res?.ok) {
            console.warn(
              `Manual attendance update failed for ${targetEnrollment}:`,
              res?.error
            );
            // Rollback state optimistically to previous status
            setAttendanceStatusMap((prev) => ({
              ...prev,
              [targetEnrollment]: prevStatus,
            }));
            setLiveAttendance((prev) => {
              const idx = prev.findIndex(
                (item: any) =>
                  String(item?.student?.enrollmentNo || item?.enrollmentNo || "").trim() ===
                  targetEnrollment
              );
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = { ...next[idx], status: prevStatus };
                return next;
              }
              return prev;
            });
            showToast(
              `Failed to update attendance for ${targetEnrollment}: ${
                res?.error || "Server error"
              }. Reverted.`
            );
          }
        } catch (err: any) {
          if (
            pendingMutationVersionsRef.current.get(targetEnrollment) !== mutationVersion
          ) {
            return;
          }
          console.error(
            `Network error during manual attendance for ${targetEnrollment}:`,
            err
          );
          // Rollback state optimistically to previous status
          setAttendanceStatusMap((prev) => ({
            ...prev,
            [targetEnrollment]: prevStatus,
          }));
          setLiveAttendance((prev) => {
            const idx = prev.findIndex(
              (item: any) =>
                String(item?.student?.enrollmentNo || item?.enrollmentNo || "").trim() ===
                targetEnrollment
            );
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = { ...next[idx], status: prevStatus };
              return next;
            }
            return prev;
          });
          showToast(
            `Network failure updating ${targetEnrollment}. Reverted.`
          );
        }
      })();
    },
    [activeSessionId, manualEnrollment, showToast]
  );

  const handleAttendanceItemToggle = useCallback(
    async (item: any) => {
      const enrollmentNo = String(
        item?.student?.enrollmentNo || item?.enrollmentNo || ""
      ).trim();
      if (!enrollmentNo || !activeSessionId) return;

      const currentMap = attendanceStatusMapRef.current;
      const currentStatus =
        currentMap[enrollmentNo] ||
        (String(item?.status || "").toLowerCase() === "present"
          ? "present"
          : "absent");
      const nextStatus: "present" | "absent" =
        currentStatus === "present" ? "absent" : "present";

      await manual(nextStatus, enrollmentNo);
    },
    [activeSessionId, manual]
  );

  // Flush Throttled Realtime Events to State in a Single Atomic Batch
  const flushRealtimeQueue = useCallback(() => {
    if (rafTimerRef.current !== null) {
      window.clearTimeout(rafTimerRef.current);
      rafTimerRef.current = null;
    }
    if (rafIdRef.current !== null) {
      window.cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    if (!queueRef.current.length) return;
    const rawEvents = [...queueRef.current];
    queueRef.current = [];

    // Deduplicate items in buffer by studentId or enrollmentNo (preserving latest state)
    const dedupedMap = new Map<string, any>();
    rawEvents.forEach((att) => {
      const studentId = String(
        att?.studentId || att?.student?._id || att?.student?.id || ""
      ).trim();
      const enrollmentNo = String(
        att?.enrollmentNo || att?.student?.enrollmentNo || ""
      ).trim();
      const key = studentId || enrollmentNo || String(att?.id || att?._id || Math.random());
      dedupedMap.set(key, att);
    });
    const events = Array.from(dedupedMap.values());

    setLiveAttendance((prev) => {
      let nextList = [...prev];
      events.forEach((att) => {
        const enrollmentNo = String(
          att.enrollmentNo || att.student?.enrollmentNo || ""
        ).trim();
        const studentId = String(
          att.studentId || att.student?._id || att.student?.id || ""
        ).trim();

        const existingIdx = nextList.findIndex((item: any) => {
          const itemEnrollment = String(
            item?.student?.enrollmentNo || item?.enrollmentNo || ""
          ).trim();
          const itemStudentId = String(
            item?.student?.id || item?.student?._id || item?.studentId || ""
          ).trim();
          return (
            (enrollmentNo && itemEnrollment === enrollmentNo) ||
            (studentId && itemStudentId === studentId)
          );
        });

        const newRecord: LiveAttendanceItem = {
          _id: att.id || att._id,
          id: att.id || att._id,
          timestamp: att.timestamp || new Date().toISOString(),
          status: att.status === "absent" ? "absent" : "present",
          student: {
            name: att.studentName || att.student?.name || enrollmentNo || "Student",
            enrollmentNo: enrollmentNo,
            profilePhotoUrl: att.profilePhotoUrl || att.student?.profilePhotoUrl,
            email: att.studentEmail || att.student?.email,
          },
          enrollmentNo: enrollmentNo,
          distanceMeters: att.distanceMeters ?? att.location?.distanceMeters,
          isFaceVerified: att.isFaceVerified ?? att.face_verification?.verified,
        };

        if (existingIdx >= 0) {
          nextList[existingIdx] = { ...nextList[existingIdx], ...newRecord };
        } else {
          nextList = [newRecord, ...nextList];
        }
      });
      return nextList;
    });

    setAttendanceStatusMap((prev) => {
      const nextMap = { ...prev };
      events.forEach((att) => {
        const enrollmentNo = String(
          att.enrollmentNo || att.student?.enrollmentNo || ""
        ).trim();
        if (enrollmentNo) {
          nextMap[enrollmentNo] = att.status === "absent" ? "absent" : "present";
        }
      });
      return nextMap;
    });
  }, []);

  // Schedule batch flush using 300ms window synchronized with next browser animation frame
  const scheduleQueueFlush = useCallback(() => {
    if (rafTimerRef.current !== null || rafIdRef.current !== null) {
      return;
    }

    rafTimerRef.current = window.setTimeout(() => {
      rafTimerRef.current = null;
      rafIdRef.current = window.requestAnimationFrame(() => {
        rafIdRef.current = null;
        flushRealtimeQueue();
      });
    }, 300);
  }, [flushRealtimeQueue]);

  // Supabase Realtime Attendance Subscription with Concurrency-Safe 300ms RAF Buffer
  useEffect(() => {
    if (!activeSessionId) {
      disconnectRealtime();
      return;
    }

    loadCurrentAttendees(true);

    const unsubscribe = subscribeToSessionAttendance(
      activeSessionId,
      (payload) => {
        const attendanceData = payload?.attendance || payload;
        if (!attendanceData) return;

        queueRef.current.push(attendanceData);
        scheduleQueueFlush();
      }
    );

    realtimeUnsubscribeRef.current = unsubscribe;

    return () => {
      disconnectRealtime();
    };
  }, [activeSessionId, disconnectRealtime, scheduleQueueFlush, loadCurrentAttendees]);


  // Load Device Requests
  const loadDeviceRequests = useCallback(async () => {
    setDeviceRequestsLoading(true);
    setDeviceRequestError("");
    try {
      const res: any = await apiClient.getDeviceChangeRequests(
        deviceRequestStatus
      );
      if (res?.ok) {
        setDeviceRequests(Array.isArray(res.requests) ? res.requests : []);
      } else {
        setDeviceRequestError(res?.error || "Failed to load device requests.");
      }
    } finally {
      setDeviceRequestsLoading(false);
    }
  }, [deviceRequestStatus]);

  useEffect(() => {
    if (activeTab === "DEVICE_REQUESTS") {
      loadDeviceRequests();
    }
  }, [activeTab, loadDeviceRequests]);

  // Subject Analytics Methods
  const loadSubjectAnalytics = useCallback(async (subjectId: string, classCode = "") => {
    setSubjectAnalyticsLoading(true);
    setSubjectAnalyticsError("");
    try {
      const res: any = await apiClient.getFacultySubjectAnalytics(subjectId, {
        classCode: classCode || undefined,
      });
      if (!res?.ok) {
        setSubjectAnalyticsError(
          res?.error || "Failed to load subject analytics."
        );
        return;
      }
      setSubjectAnalyticsData(res as FacultySubjectAnalyticsData);
    } catch (err: any) {
      setSubjectAnalyticsError(
        err?.message || "Failed to load subject analytics."
      );
    } finally {
      setSubjectAnalyticsLoading(false);
    }
  }, []);

  const openSubjectAnalytics = useCallback(async (subject: any) => {
    const subjectId = String(subject?._id || subject?.id || "");
    if (!subjectId) return;
    setSubjectAnalyticsTarget(subject);
    setAnalyticsClassCodeFilter("");
    setAnalyticsAttendanceFilter("all");
    setAnalyticsSearch("");
    setSubjectAnalyticsData(null);
    setSubjectAnalyticsOpen(true);
    await loadSubjectAnalytics(subjectId, "");
  }, [loadSubjectAnalytics]);

  const closeSubjectAnalytics = useCallback(() => {
    setSubjectAnalyticsOpen(false);
    setSubjectAnalyticsLoading(false);
    setSubjectAnalyticsError("");
    setSubjectAnalyticsData(null);
    setSubjectAnalyticsTarget(null);
    setAnalyticsClassCodeFilter("");
    setAnalyticsAttendanceFilter("all");
    setAnalyticsSearch("");
  }, []);

  const analyticsStudents = useMemo(() => {
    const base = subjectAnalyticsData?.students || [];
    return base
      .filter((student) => {
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
      })
      .filter((student) => {
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
    return (
      [...items].sort(
        (a, b) => b.averageAttendancePercentage - a.averageAttendancePercentage
      )[0] || null
    );
  }, [subjectAnalyticsData]);

  const weakestClassInsight = useMemo(() => {
    const items = subjectAnalyticsData?.classCodeInsights || [];
    return (
      [...items]
        .filter((item) => item.totalClasses > 0)
        .sort(
          (a, b) => a.averageAttendancePercentage - b.averageAttendancePercentage
        )[0] || null
    );
  }, [subjectAnalyticsData]);

  // Review Device Request
  const reviewDeviceRequest = useCallback(async (
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
  }, [deviceRejectNote, loadDeviceRequests]);

  // Manage Attendance Sheet Methods
  const loadSheet = useCallback(async (force = false) => {
    if (!sheetFilters.subjectId) return;

    const filterKey = `${sheetFilters.subjectId}_${sheetFilters.departmentId || ""}_${sheetFilters.year || ""}_${sheetFilters.semester || ""}_${sheetFilters.section || ""}`;
    const cached = sheetMatrixCacheRef.current.get(filterKey);
    const now = Date.now();
    if (!force && cached && now - cached.cachedAt < 60_000) {
      setSheetColumns(cached.columns);
      setSheetRows(cached.rows);
      return;
    }

    setSheetLoading(true);
    try {
      const res: any = await apiClient.fetchAttendance({
        subjectId: sheetFilters.subjectId,
        departmentId: sheetFilters.departmentId || undefined,
        year: sheetFilters.year || undefined,
        semester: sheetFilters.semester || undefined,
        section: sheetFilters.section || undefined,
      });
      if (!res?.ok) {
        setSheetLoading(false);
        return alert(res?.error || "Failed to load sheet");
      }

      // Compute matrix asynchronously in an idle frame to avoid blocking the main UI thread
      const { columns, rows } = await new Promise<{ columns: string[]; rows: any[] }>((resolve) => {
        const compute = () => {
          // Map all conducted sessions into columns:
          const sessionList = Array.isArray(res.sessions) ? res.sessions : [];
          const cols = sessionList.map((sess: any) => {
            const dateObj = new Date(sess.start_time || sess.startTime || sess.created_at || Date.now());
            const dateLabel = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, "0")}-${String(dateObj.getDate()).padStart(2, "0")} ${String(dateObj.getHours()).padStart(2, "0")}:${String(dateObj.getMinutes()).padStart(2, "0")}`;
            const facName = sess.fac?.name || sess.faculty?.name || "";
            const label = facName ? `${dateLabel} (${facName})` : dateLabel;
            return `${sess.id || sess._id}::${label}`;
          });

          // Map all enrolled students into rows:
          let studentList = Array.isArray(res.students) ? res.students : [];
          if (studentList.length === 0 && Array.isArray(res.attendance)) {
            const stuMap = new Map<string, { name: string; enrollmentNo: string }>();
            res.attendance.forEach((att: any) => {
              const eno = String(att.student?.enrollmentNo || att.student?.enrollment_no || "").trim().toUpperCase();
              if (eno && !stuMap.has(eno)) {
                stuMap.set(eno, { name: att.student?.name || "Student", enrollmentNo: eno });
              }
            });
            studentList = Array.from(stuMap.values());
          }

          const presentSet = new Set<string>(); // Stores "enrollmentNo|sessionId"
          (res.attendance || []).forEach((att: any) => {
            const eno = String(att.student?.enrollmentNo || att.student?.enrollment_no || "").trim().toUpperCase();
            const sid = String(att.session?._id || att.session || att.sessionId || "").trim();
            if (eno && sid && String(att.status).toLowerCase() === "present") {
              presentSet.add(`${eno}|${sid}`);
            }
          });

          // Pre-cache split keys to avoid repeated string splitting inside inner cell loop
          const parsedCols = cols.map((c) => ({
            colStr: c,
            colKey: c.split("::")[0],
          }));

          const matrixRows = studentList
            .map((stu: any) => {
              const eno = String(stu.enrollmentNo || stu.enrollment_no || "").trim().toUpperCase();
              const attRec: Record<string, "P" | "A"> = {};
              for (let i = 0; i < parsedCols.length; i++) {
                const { colStr, colKey } = parsedCols[i];
                attRec[colStr] = presentSet.has(`${eno}|${colKey}`) ? "P" : "A";
              }
              return {
                name: stu.name,
                enrollmentNo: eno,
                attendance: attRec,
              };
            })
            .sort((a, b) => a.enrollmentNo.localeCompare(b.enrollmentNo));

          resolve({ columns: cols, rows: matrixRows });
        };

        if (typeof window !== "undefined" && "requestIdleCallback" in window) {
          (window as any).requestIdleCallback(compute, { timeout: 200 });
        } else {
          setTimeout(compute, 0);
        }
      });

      sheetMatrixCacheRef.current.set(filterKey, {
        columns,
        rows,
        cachedAt: Date.now(),
      });
      setSheetColumns(columns);
      setSheetRows(rows);
    } catch (err: any) {
      console.error("Load sheet error:", err);
      alert(err?.message || "Failed to load attendance sheet");
    } finally {
      setSheetLoading(false);
    }
  }, [sheetFilters]);

  const exportCsv = useCallback(() => {
    if (!sheetRows.length) return;
    const esc = (v: any) => {
      const s = String(v ?? "");
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    };
    const lines = [
      ["Enrollment", "Name", ...sheetColumns.map((c) => c.split("::")[1] || c)].join(
        ","
      ),
      ...sheetRows.map((r) =>
        [
          esc(r.enrollmentNo),
          esc(r.name),
          ...sheetColumns.map((c) => esc(r.attendance[c] || "A")),
        ].join(",")
      ),
    ];
    const blob = new Blob([lines.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "Attendance_Sheet.csv";
    a.click();
    window.URL.revokeObjectURL(url);
  }, [sheetRows, sheetColumns]);

  const mobileLocateUrl = useMemo(() => {
    if (!mobileLocateToken) return "";
    return `${window.location.origin}/mobile-location?token=${encodeURIComponent(
      mobileLocateToken
    )}`;
  }, [mobileLocateToken]);

  const capturedLocationLabel = useMemo(() => {
    if (!locationState) return "";
    return `${formatCoordinate(locationState.lat)}, ${formatCoordinate(
      locationState.lng
    )}`;
  }, [locationState]);

  const capturedLocationMapUrl = useMemo(() => {
    if (!locationState) return "";
    return buildGoogleMapsLocationUrl(locationState.lat, locationState.lng);
  }, [locationState]);

  const openCapturedLocationInMaps = useCallback(() => {
    if (!capturedLocationMapUrl) return;
    window.open(capturedLocationMapUrl, "_blank", "noopener,noreferrer");
  }, [capturedLocationMapUrl]);

  const pendingRequestsCount = useMemo(() => {
    return deviceRequests.filter(
      (r) => String(r.status || "").toLowerCase() === "pending"
    ).length;
  }, [deviceRequests]);

  const navTabs = [
    {
      id: "TAKE_ATTENDANCE" as Tab,
      label: "Take Attendance",
      icon: Play,
      badge: isActiveSessionRunning ? "LIVE" : null,
    },
    {
      id: "MANAGE_ATTENDANCE" as Tab,
      label: "Manage Attendance",
      icon: List,
      badge: null,
    },
    {
      id: "DEVICE_REQUESTS" as Tab,
      label: "Device Requests",
      icon: Smartphone,
      badge: pendingRequestsCount > 0 ? `${pendingRequestsCount}` : null,
    },
    {
      id: "MANAGE_SUBJECTS" as Tab,
      label: "Manage Subjects",
      icon: BookOpen,
      badge: null,
    },
  ];

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden bg-[radial-gradient(ellipse_at_20%_10%,rgba(56,189,248,0.06),transparent_55%),radial-gradient(ellipse_at_80%_90%,rgba(99,102,241,0.06),transparent_55%),#f8fafc] selection:bg-emerald-500 selection:text-white pb-20">
      {/* Shared Ambient Gradient Mesh Background & Lighting */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden" aria-hidden="true">
        {/* Subtle Geometric Dot Matrix Grid */}
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: `radial-gradient(#0f172a 1px, transparent 1px)`,
            backgroundSize: "24px 24px",
          }}
        />

        <div className="absolute -top-32 right-0 w-[720px] h-[720px] rounded-full bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.08),transparent_55%)] blur-3xl will-change-transform" />
        <div className="absolute top-1/3 -left-20 w-[600px] h-[600px] rounded-full bg-[radial-gradient(circle,rgba(99,102,241,0.07)_0%,transparent_55%)] blur-3xl will-change-transform" />
        <div className="absolute -bottom-32 right-1/4 w-[500px] h-[500px] rounded-full bg-[radial-gradient(circle,rgba(6,182,212,0.05)_0%,transparent_60%)] blur-3xl will-change-transform" />
      </div>

      <div className="relative z-10 mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 space-y-6">
        {/* College Header with Elevated Glassmorphism */}
        <CollegeHeader
          className="surface-card mb-0 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/50 bg-white/70 backdrop-blur-2xl"
          collegeName={currentUser?.collegeName}
          profilePhotoUrl={currentUser?.profilePhotoUrl}
          profileMenuPhotoUrl={currentUser?.facultyProfilePhotoUrl}
          title="Faculty Dashboard"
          subtitle="Manage live attendance, rotating dynamic QR sessions, and student device requests."
          eyebrow="Faculty Portal"
          user={currentUser}
          roleLabel="Faculty"
          onLogout={logout}
          isLive={Boolean(activeSessionId || activeSession)}
        />

        {/* Navigation Tabs Bar with Glassmorphism and Fluid Sliding Pill */}
        <div className="rounded-3xl border border-slate-200/80 bg-white/80 p-2 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {navTabs.map((tab) => {
                const isActive = activeTab === tab.id;
                const Icon = tab.icon;

                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`relative flex items-center gap-2 rounded-2xl px-4.5 py-2.5 text-xs font-bold tracking-tight transition-all duration-200 select-none cursor-pointer ${
                      isActive
                        ? "text-white shadow-xs"
                        : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/70"
                    }`}
                  >
                    {isActive && (
                      <motion.div
                        layoutId="activeTabIndicator"
                        className="absolute inset-0 rounded-2xl bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 shadow-[0_4px_16px_rgba(16,185,129,0.35)]"
                        transition={{ type: "spring", stiffness: 450, damping: 35 }}
                      />
                    )}

                    <span className="relative z-10 flex items-center gap-2">
                      <Icon
                        size={16}
                        className={isActive ? "text-white" : "text-emerald-600"}
                      />
                      <span>{tab.label}</span>

                      {tab.badge && (
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${
                            tab.badge === "LIVE"
                              ? "bg-rose-500 text-white shadow-xs animate-pulse"
                              : "bg-emerald-100 text-emerald-800 border border-emerald-300"
                          }`}
                        >
                          {tab.badge === "LIVE" && (
                            <span className="h-1.5 w-1.5 rounded-full bg-white animate-ping" />
                          )}
                          {tab.badge}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Live Session Radar Pill Indicator (When Active) */}
            {isActiveSessionRunning && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="hidden sm:flex items-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 text-xs font-bold text-emerald-700 shadow-xs backdrop-blur-md"
              >
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                <span className="truncate max-w-[200px]">
                  Live: {selectedSubject?.code || activeSession?.section || "Session"}
                </span>
              </motion.div>
            )}
          </div>
        </div>

        {/* Tab Views with Fluid Mount Animation */}
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        >
          {activeTab === "TAKE_ATTENDANCE" && (
            <>
              {activeSessionId ? (
                <LiveSessionStudio
                  activeSession={activeSession}
                  sessionSecretKey={activeSessionSecretKey || (activeSession as any)?.secretKey}
                  totalClassStrength={totalClassStrength || (activeSession as any)?.totalStudents || (activeSession as any)?.totalStrength || 0}
                  liveAttendance={liveAttendance}
                  attendanceStatusMap={attendanceStatusMap}
                  attendanceDataLoaded={attendanceDataLoaded}
                  attendeesLoading={attendeesLoading}
                  manualLoading={manualLoading}
                  manualEnrollment={manualEnrollment}
                  setManualEnrollment={setManualEnrollment}
                  onLoadAttendees={loadCurrentAttendees}
                  onManualAttendance={manual}
                  onToggleAttendanceItem={handleAttendanceItemToggle}
                  onStopSession={stop}
                  onCancelSession={cancelSession}
                  onDisconnectRealtime={disconnectRealtime}
                  selectedSubject={selectedSubject}
                  selectedDepartment={selectedDepartment}
                />
              ) : (
                <SessionSetupCard
                  departments={departments}
                  mySubjects={mySubjects}
                  filteredSubjects={filteredSubjects}
                  formDepartment={formDepartment}
                  formYear={formYear}
                  formSem={formSem}
                  formSection={formSection}
                  formSubject={formSubject}
                  formRadius={formRadius}
                  locationState={locationState}
                  isLocationConfirmed={isLocationConfirmed}
                  manualLat={manualLat}
                  manualLng={manualLng}
                  showManualLocation={showManualLocation}
                  locating={locating}
                  locationError={locationError}
                  sessionError={sessionError}
                  startLoading={startLoading}
                  mobileLocateLoading={mobileLocateLoading}
                  mobileLocateToken={mobileLocateToken}
                  mobileLocateStatus={mobileLocateStatus}
                  mobileLocateExpiresAt={mobileLocateExpiresAt}
                  mobileLocateUrl={mobileLocateUrl}
                  capturedLocationLabel={capturedLocationLabel}
                  capturedLocationMapUrl={capturedLocationMapUrl}
                  recentClassCards={recentClassCards}
                  setFormDepartment={setFormDepartment}
                  setFormYear={setFormYear}
                  setFormSem={setFormSem}
                  setFormSection={setFormSection}
                  setFormSubject={setFormSubject}
                  setFormRadius={setFormRadius}
                  setManualLat={setManualLat}
                  setManualLng={setManualLng}
                  onCaptureLocation={captureLocation}
                  onStartLocateViaMobile={startLocateViaMobile}
                  onCloseMobileLocate={closeMobileLocate}
                  onSetManualLocation={setManualLocation}
                  onShowManualLocationEditor={showManualLocationEditor}
                  onOpenCapturedLocationInMaps={openCapturedLocationInMaps}
                  onApplyRecentClass={applyRecentClass}
                  onRemoveRecentClass={removeRecentClass}
                  onResetConfirmedLocation={resetConfirmedLocation}
                  onStartSession={start}
                />
              )}
            </>
          )}

          {activeTab === "MANAGE_ATTENDANCE" && (
            <AttendanceRosterTable
              departments={departments}
              mySubjects={mySubjects}
              sheetFilters={sheetFilters}
              sheetColumns={sheetColumns}
              sheetRows={sheetRows}
              sheetLoading={sheetLoading}
              setSheetFilters={setSheetFilters}
              onLoadSheet={loadSheet}
              onExportCsv={exportCsv}
            />
          )}

          {activeTab === "DEVICE_REQUESTS" && (
            <DeviceRequestsView
              deviceRequests={deviceRequests}
              deviceRequestsLoading={deviceRequestsLoading}
              deviceRequestStatus={deviceRequestStatus}
              deviceRequestError={deviceRequestError}
              deviceRejectNote={deviceRejectNote}
              deviceReviewingId={deviceReviewingId}
              setDeviceRequestStatus={setDeviceRequestStatus}
              setDeviceRejectNote={setDeviceRejectNote}
              onLoadDeviceRequests={loadDeviceRequests}
              onReviewDeviceRequest={reviewDeviceRequest}
            />
          )}

          {activeTab === "MANAGE_SUBJECTS" && (
            <ManageSubjectsView
              mySubjects={mySubjects}
              onOpenSubjectAnalytics={openSubjectAnalytics}
            />
          )}
        </motion.div>

        {/* Subject Intelligence Analytics Modal */}
        <FacultyAnalyticsModal
          isOpen={subjectAnalyticsOpen}
          loading={subjectAnalyticsLoading}
          error={subjectAnalyticsError}
          data={subjectAnalyticsData}
          targetSubject={subjectAnalyticsTarget}
          classCodeFilter={analyticsClassCodeFilter}
          attendanceFilter={analyticsAttendanceFilter}
          searchQuery={analyticsSearch}
          filteredStudents={analyticsStudents}
          strongestClass={strongestClassInsight}
          weakestClass={weakestClassInsight}
          setClassCodeFilter={setAnalyticsClassCodeFilter}
          setAttendanceFilter={setAnalyticsAttendanceFilter}
          setSearchQuery={setAnalyticsSearch}
          onClassCodeChange={async (code) => {
            setAnalyticsClassCodeFilter(code);
            if (subjectAnalyticsData?.subject?.id) {
              await loadSubjectAnalytics(
                String(subjectAnalyticsData.subject.id),
                code
              );
            }
          }}
          onClose={closeSubjectAnalytics}
        />


        {/* Optimistic UI Rollback Floating Toast */}
        <AnimatePresence>
          {toastMessage && (
            <motion.div
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="fixed top-6 inset-x-4 z-[110] flex justify-center pointer-events-none"
            >
              {(() => {
                const isSuccess =
                  toastMessage.toLowerCase().includes("finalized") ||
                  toastMessage.toLowerCase().includes("successfully");

                return (
                  <div
                    className={`pointer-events-auto flex items-center gap-3 rounded-2xl border px-5 py-3.5 shadow-2xl backdrop-blur-xl text-xs font-semibold ${
                      isSuccess
                        ? "border-emerald-500/40 bg-slate-900/95 text-emerald-200"
                        : "border-rose-500/40 bg-slate-900/95 text-rose-200"
                    }`}
                  >
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
                        isSuccess
                          ? "bg-emerald-500/20 text-emerald-400"
                          : "bg-rose-500/20 text-rose-400"
                      }`}
                    >
                      {isSuccess ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
                    </span>
                    <div className="max-w-md">
                      <p
                        className={`font-bold ${
                          isSuccess ? "text-emerald-100" : "text-rose-100"
                        }`}
                      >
                        {toastMessage}
                      </p>
                      <p
                        className={`text-[11px] font-normal mt-0.5 ${
                          isSuccess ? "text-emerald-300/70" : "text-rose-300/70"
                        }`}
                      >
                        {isSuccess ? "Session committed." : "Roster state restored."}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setToastMessage(null)}
                      className="ml-2 rounded-lg p-1 text-slate-400 hover:text-white transition cursor-pointer"
                    >
                      <X size={14} />
                    </button>
                  </div>
                );
              })()}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default FacultyDashboard;
