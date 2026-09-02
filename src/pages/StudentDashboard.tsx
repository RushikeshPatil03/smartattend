import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../store";
import { Button, Card, Badge, CountUp } from "../components/Common";
import CollegeHeader from "../components/CollegeHeader";
import {
  Scan, MapPin, CheckCircle, XCircle, History, Camera, LoaderCircle, X,
  BookOpen, TrendingUp, AlertTriangle, RefreshCw, ChevronDown,
  Award, Clock, ShieldAlert
} from "lucide-react";
import { markAttendanceTwoStep, getFingerprint } from "../services/attendanceClient";
import apiClient from "../services/apiClient";
import {
  ATTENDANCE_GPS_MAX_AGE_MS,
  DISPLAY_GPS_MAX_AGE_MS,
  getInstantCachedLocation,
  getLiveLocationWithOptions,
  prewarmLiveLocation,
  startRollingGpsWatcher,
} from "../utils/liveLocation";
import { createSequentialBuffer } from "../services/sequentialQrBuffer";
import { parseQrPayload, RotatingQrPayload } from "../utils/totpQrGenerator";

import { loadModelsIfNeeded, computeDescriptorFromImageURL } from "../utils/faceApiLoader";

const preloadCameraQrScanner = () => import("../components/CameraQrScanner");
const CameraQrScanner = React.lazy(preloadCameraQrScanner);
const preloadLivePhotoCapture = () => import("../components/LivePhotoCapture");
const LivePhotoCapture = React.lazy(preloadLivePhotoCapture);

const prewarmFrontCamera = () => {
  preloadLivePhotoCapture().then((m) => m.prewarmFrontCamera?.()).catch(() => {});
};
const prewarmQrCamera = () => {
  preloadCameraQrScanner().then((m) => m.prewarmQrCamera?.()).catch(() => {});
};

type IdleCapableWindow = Window &
  typeof globalThis & {
    requestIdleCallback?: (
      callback: IdleRequestCallback,
      options?: IdleRequestOptions
    ) => number;
    cancelIdleCallback?: (handle: number) => void;
  };

const DYNAMIC_SECOND_SCAN_TIMEOUT_MS = 8000;
const MIN_DYNAMIC_ROTATION_WAIT_MS = Math.max(
  800,
  Number(import.meta.env.VITE_MIN_SECOND_SCAN_DELAY_MS || 1500)
);
const MAX_DYNAMIC_SEQUENCE_GAP_SECONDS = Math.max(
  4,
  Number(import.meta.env.VITE_QR_SEQUENCE_GAP_SECONDS || 6)
);
const FIRST_DYNAMIC_ARM_WINDOW_MS = 2500;
const FACE_VERIFICATION_WINDOW_MS = 15000;
type ScannerResult = string | { first: string; second: string } | { sequence: RotatingQrPayload[] } | null;
type DynamicPairScanResult =
  | { kind: "legacy"; first: string; second: string }
  | { kind: "totp"; sequence: RotatingQrPayload[] };
type DynamicQrPayload = {
  type?: string;
  sessionId?: string;
  iat?: number;
};
type TodayClassRow = {
  sessionId: string;
  subjectName: string;
  subjectCode: string;
  facultyName: string;
  startTime: string;
  endTime?: string | null;
  markedAt?: string | null;
  isActive: boolean;
  status: "present" | "absent";
  attendanceCode: "P" | "A";
};

type SubjectAttendanceRow = {
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  totalClassesConducted: number;
  classesAttended: number;
  classesMissed: number;
  attendancePercentage: number;
};

type AttendanceOverviewData = {
  overview: {
    totalClassesConducted: number;
    classesAttended: number;
    classesMissed: number;
    overallAttendancePercentage: number;
    subjectCount: number;
  };
  subjects: SubjectAttendanceRow[];
};

function isSameLocalDay(value: string | number | Date, reference = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return (
    date.getFullYear() === reference.getFullYear() &&
    date.getMonth() === reference.getMonth() &&
    date.getDate() === reference.getDate()
  );
}

function toTodayAttendanceRow(record: any): TodayClassRow | null {
  if (record?.sessionId && !record?.session) {
    const isPresent =
      String(record?.attendanceCode || record?.status || "").toUpperCase() === "P" ||
      String(record?.status || "").toLowerCase() === "present";

    return {
      sessionId: String(record.sessionId || ""),
      subjectName: String(record.subjectName || "Subject"),
      subjectCode: String(record.subjectCode || record.subjectName || "SUB").toUpperCase(),
      facultyName: String(record.facultyName || "Faculty"),
      startTime: String(record.startTime || record.markedAt || ""),
      endTime: record.endTime || null,
      markedAt: record.markedAt ? String(record.markedAt) : null,
      isActive: Boolean(record.isActive),
      status: isPresent ? "present" : "absent",
      attendanceCode: isPresent ? "P" : "A",
    };
  }

  const session = record?.session;
  if (!session) return null;

  const subject = session?.subject;
  const faculty = session?.faculty;
  const markedAt = record?.timestamp || record?.createdAt || null;
  const isPresent = String(record?.status || "").toLowerCase() === "present";

  return {
    sessionId: String(session?._id || record?.sessionId || ""),
    subjectName: String(subject?.name || record?.subjectName || "Subject"),
    subjectCode: String(subject?.code || record?.subjectCode || subject?.name || "SUB").toUpperCase(),
    facultyName: String(faculty?.name || record?.facultyName || "Faculty"),
    startTime: String(session?.startTime || markedAt || ""),
    endTime: session?.endTime || null,
    markedAt: markedAt ? String(markedAt) : null,
    isActive: Boolean(session?.isActive),
    status: isPresent ? "present" : "absent",
    attendanceCode: isPresent ? "P" : "A",
  };
}

function decodeDynamicQrPayload(token: string): DynamicQrPayload | null {
  const parts = String(token || "").trim().split(".");
  if (parts.length < 2) return null;

  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const json = window.atob(padded);
    const payload = JSON.parse(json);
    if (!payload || payload.type !== "DYNAMIC_QR" || !payload.sessionId) {
      return null;
    }
    return {
      type: payload.type,
      sessionId: String(payload.sessionId),
      iat: Number(payload.iat || 0),
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MY ATTENDANCE CARD
// Compact subject-wise attendance breakdown with animated progress bars,
// smart risk tiers, overall summary, and self-contained data fetching.
// ─────────────────────────────────────────────────────────────────────────────

const ATTENDANCE_THRESHOLDS = {
  SAFE: 75,      // ≥ 75% — Safe zone ✅
  WARNING: 60,   // 60–74% — Warning zone ⚠️
  CRITICAL: 40,  // 40–59% — Critical ❌
  // < 40% — Danger 🚨
} as const;

function getAttendanceTier(pct: number) {
  if (pct >= ATTENDANCE_THRESHOLDS.SAFE)     return { label: "✅",      color: "emerald", barColor: "bg-emerald-500", textColor: "text-emerald-700", bgColor: "bg-emerald-50",   borderColor: "border-emerald-200" } as const;
  if (pct >= ATTENDANCE_THRESHOLDS.WARNING)  return { label: "⚠️",      color: "amber",   barColor: "bg-amber-400",  textColor: "text-amber-700",   bgColor: "bg-amber-50",    borderColor: "border-amber-200" } as const;
  if (pct >= ATTENDANCE_THRESHOLDS.CRITICAL) return { label: "❌",      color: "rose",    barColor: "bg-rose-500",   textColor: "text-rose-700",    bgColor: "bg-rose-50",     borderColor: "border-rose-200" } as const;
  return                                            { label: "🚨",      color: "red",     barColor: "bg-red-600",    textColor: "text-red-700",     bgColor: "bg-red-50",      borderColor: "border-red-200" } as const;
}

function classesNeededToReach75(attended: number, total: number): number | null {
  // How many consecutive classes must the student attend to reach 75%?
  // Solve: (attended + x) / (total + x) >= 0.75
  if (total === 0) return null;
  const pct = attended / total;
  if (pct >= 0.75) return 0; // already safe
  // (attended + x) >= 0.75 * (total + x)
  // attended + x >= 0.75*total + 0.75x
  // 0.25x >= 0.75*total - attended
  // x >= (0.75*total - attended) / 0.25
  const needed = Math.ceil((0.75 * total - attended) / 0.25);
  return Math.max(0, needed);
}

function canSkipClasses(attended: number, total: number): number | null {
  // How many classes can the student miss and still stay ≥ 75%?
  // (attended) / (total + x) >= 0.75  — student skips but still has 'attended' present
  // attended >= 0.75 * (total + x)
  // x <= (attended / 0.75) - total
  if (total === 0) return null;
  const canSkip = Math.floor(attended / 0.75 - total);
  return canSkip > 0 ? canSkip : 0;
}

const OverallRingGauge: React.FC<{ pct: number }> = ({ pct }) => {
  const radius = 30;
  const circ = 2 * Math.PI * radius;
  const filled = (Math.min(pct, 100) / 100) * circ;
  const tier = getAttendanceTier(pct);

  const strokeColor =
    tier.color === "emerald" ? "#10b981"
    : tier.color === "amber"   ? "#f59e0b"
    : tier.color === "rose"    ? "#f43f5e"
    :                            "#dc2626";

  return (
    <svg width="80" height="80" viewBox="0 0 80 80" className="shrink-0" aria-label={`Overall attendance ${pct}%`}>
      {/* Track */}
      <circle cx="40" cy="40" r={radius} fill="none" stroke="#e2e8f0" strokeWidth="7" />
      {/* Filled arc */}
      <circle
        cx="40" cy="40" r={radius}
        fill="none"
        stroke={strokeColor}
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${circ}`}
        strokeDashoffset={0}
        transform="rotate(-90 40 40)"
        style={{ transition: "stroke-dasharray 0.8s cubic-bezier(0.4,0,0.2,1)" }}
      />
      <text x="40" y="44" textAnchor="middle" fontSize="14" fontWeight="700" fill={strokeColor}>
        {Math.round(pct)}%
      </text>
    </svg>
  );
};

const SubjectProgressBar: React.FC<{ subject: SubjectAttendanceRow; animDelay: number }> = ({
  subject,
  animDelay,
}) => {
  const pct = subject.attendancePercentage;
  const tier = getAttendanceTier(pct);
  const needed = classesNeededToReach75(subject.classesAttended, subject.totalClassesConducted);
  const canSkip = canSkipClasses(subject.classesAttended, subject.totalClassesConducted);

  // Tooltip-style contextual hint
  const hint =
    pct >= 75
      ? canSkip !== null && canSkip > 0
        ? `Can skip ~${canSkip} more class${canSkip !== 1 ? "es" : ""}`
        : "At safe threshold"
      : needed !== null && needed > 0
        ? `Attend ${needed} more to reach 75%`
        : "";

  return (
    <div
      className="group py-2.5 transition-colors hover:bg-slate-50/80 rounded-xl px-3 -mx-1"
      style={{ animationDelay: `${animDelay}ms` }}
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        {/* Subject name + code */}
        <div className="flex min-w-0 items-center gap-2">
          <BookOpen size={13} className="shrink-0 text-slate-400" />
          <span className="truncate text-[13px] font-semibold text-slate-800 leading-none">
            {subject.subjectName}
          </span>
          <span className="hidden sm:inline shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
            {subject.subjectCode}
          </span>
        </div>

        {/* Right: percentage + emoji */}
        <div className="flex shrink-0 items-center gap-1.5">
          <span className={`text-[13px] font-bold tabular-nums ${tier.textColor}`}>
            {pct.toFixed(pct % 1 === 0 ? 0 : 1)}%
          </span>
          <span className="text-sm leading-none">{tier.label}</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full transition-all duration-700 ease-out ${tier.barColor}`}
          style={{
            width: `${Math.min(pct, 100)}%`,
            transitionDelay: `${animDelay + 100}ms`,
          }}
        />
        {/* 75% marker */}
        <div
          className="absolute top-0 h-full w-[1.5px] bg-slate-400/60"
          style={{ left: "75%" }}
          title="75% threshold"
        />
      </div>

      {/* Stats row */}
      <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400">
        <span>
          {subject.classesAttended}/{subject.totalClassesConducted} classes
        </span>
        {hint && (
          <span className={`font-medium ${tier.textColor} opacity-80`}>{hint}</span>
        )}
      </div>
    </div>
  );
};

const MyAttendanceCard: React.FC = () => {
  const [overviewData, setOverviewData] = useState<AttendanceOverviewData | null>(null);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [expanded, setExpanded] = useState(false);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const fetchingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchOverview = useCallback(async (silent = false) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    if (!silent) setLoadState("loading");

    try {
      const res: any = await apiClient.getStudentAttendanceOverview();
      if (!mountedRef.current) return;

      if (res?.ok) {
        setOverviewData({
          overview: res.overview || {
            totalClassesConducted: 0, classesAttended: 0,
            classesMissed: 0, overallAttendancePercentage: 0, subjectCount: 0,
          },
          subjects: Array.isArray(res.subjects) ? res.subjects : [],
        });
        setLoadState("loaded");
        setLastFetchedAt(new Date());
      } else {
        setLoadState("error");
      }
    } catch {
      if (mountedRef.current) setLoadState("error");
    } finally {
      fetchingRef.current = false;
    }
  }, []);

  // Auto-load on mount
  useEffect(() => {
    if (loadState === "idle") {
      void fetchOverview(true);
    }
  }, [loadState, fetchOverview]);

  const sorted = useMemo(() => {
    if (!overviewData) return [];
    return [...overviewData.subjects].sort(
      (a, b) => a.attendancePercentage - b.attendancePercentage
    );
  }, [overviewData]);

  const overallPct = overviewData?.overview?.overallAttendancePercentage ?? 0;
  const overallTier = getAttendanceTier(overallPct);

  // Subjects at risk (< 75%)
  const atRisk = sorted.filter((s) => s.attendancePercentage < ATTENDANCE_THRESHOLDS.SAFE);
  const hasData = loadState === "loaded" && overviewData;

  return (
    <div className="mx-auto w-full max-w-lg">
      {/* Card header — always visible, acts as toggle */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full rounded-[20px] border border-slate-200 bg-white px-5 py-4 shadow-[0_8px_28px_-12px_rgba(15,23,42,0.18)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_32px_-12px_rgba(15,23,42,0.22)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
        aria-expanded={expanded}
        aria-label="Toggle My Attendance overview"
      >
        <div className="flex items-center justify-between gap-3">
          {/* Left: icon + title + badge */}
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-50 to-sky-50 border border-indigo-100 text-indigo-600">
              <TrendingUp size={18} />
            </div>
            <div className="min-w-0 text-left">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                Cumulative
              </p>
              <p className="text-sm font-bold tracking-tight text-slate-900">My Attendance</p>
            </div>
          </div>

          {/* Right: quick overall % or loading state */}
          <div className="flex shrink-0 items-center gap-2">
            {hasData && (
              <div className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${overallTier.bgColor} ${overallTier.borderColor} ${overallTier.textColor}`}>
                <Award size={11} />
                {overallPct.toFixed(overallPct % 1 === 0 ? 0 : 1)}%
              </div>
            )}
            {loadState === "loading" && (
              <LoaderCircle size={16} className="animate-spin text-slate-400" />
            )}
            <div className="text-slate-400 transition-transform duration-200" style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}>
              <ChevronDown size={18} />
            </div>
          </div>
        </div>

        {/* Risk alert strip — always visible if loaded and there are at-risk subjects */}
        {hasData && atRisk.length > 0 && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-left">
            <AlertTriangle size={13} className="shrink-0 text-amber-600" />
            <p className="text-[12px] font-semibold text-amber-700">
              {atRisk.length === 1
                ? `${atRisk[0].subjectName} is below 75%`
                : `${atRisk.length} subjects are below 75% attendance`}
            </p>
          </div>
        )}
      </button>

      {/* Expanded panel */}
      {expanded && (
        <div className="mt-2 overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-[0_12px_32px_-12px_rgba(15,23,42,0.18)]">

          {/* Loading skeleton */}
          {loadState === "loading" && (
            <div className="space-y-4 p-5">
              {[1, 2, 3].map((i) => (
                <div key={i} className="animate-pulse space-y-2">
                  <div className="flex justify-between">
                    <div className="h-3.5 w-40 rounded-full bg-slate-200" />
                    <div className="h-3.5 w-10 rounded-full bg-slate-200" />
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-200" />
                </div>
              ))}
            </div>
          )}

          {/* Error state */}
          {loadState === "error" && (
            <div className="flex flex-col items-center gap-3 py-10 text-center px-6">
              <XCircle size={32} className="text-rose-400" />
              <p className="text-sm font-semibold text-slate-700">Could not load attendance data</p>
              <p className="text-xs text-slate-400">Check your connection and try again.</p>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); void fetchOverview(false); }}
                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-white transition cursor-pointer"
              >
                <RefreshCw size={13} /> Retry
              </button>
            </div>
          )}

          {/* Loaded data */}
          {hasData && (
            <>
              {/* Overall summary strip */}
              <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-5 py-4">
                <div className="flex items-center gap-5">
                  <OverallRingGauge pct={overallPct} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 mb-1">
                      Overall Attendance
                    </p>
                    <p className={`text-2xl font-black tabular-nums tracking-tight ${overallTier.textColor}`}>
                      <CountUp value={overallPct} decimals={overallPct % 1 === 0 ? 0 : 1} suffix="%" />
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-2 text-[11px] font-medium text-slate-500">
                      <span className="flex items-center gap-1 text-emerald-700">
                        <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" />
                        <CountUp value={overviewData.overview.classesAttended} /> Present
                      </span>
                      <span className="flex items-center gap-1 text-rose-600">
                        <span className="h-2 w-2 rounded-full bg-rose-500 inline-block" />
                        <CountUp value={overviewData.overview.classesMissed} /> Absent
                      </span>
                      <span className="text-slate-400">
                        / <CountUp value={overviewData.overview.totalClassesConducted} /> Total
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Subject list */}
              <div className="px-4 pb-4 pt-3">
                {sorted.length === 0 ? (
                  <div className="py-8 text-center">
                    <Clock size={28} className="mx-auto mb-3 text-slate-300" />
                    <p className="text-sm font-medium text-slate-500">No completed sessions yet</p>
                    <p className="mt-1 text-xs text-slate-400">
                      Subject-wise stats appear once faculty ends a session.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100/80">
                    {sorted.map((subj, idx) => (
                      <SubjectProgressBar key={subj.subjectId} subject={subj} animDelay={idx * 60} />
                    ))}
                  </div>
                )}

                {/* Legend + last updated */}
                <div className="mt-4 flex items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-semibold text-slate-400">
                    <span className="flex items-center gap-1"><span className="h-1.5 w-3 rounded-full bg-emerald-500 inline-block" />≥75% Safe</span>
                    <span className="flex items-center gap-1"><span className="h-1.5 w-3 rounded-full bg-amber-400 inline-block" />60–74% Warn</span>
                    <span className="flex items-center gap-1"><span className="h-1.5 w-3 rounded-full bg-rose-500 inline-block" />&lt;60% Risk</span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); void fetchOverview(true); }}
                    className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition cursor-pointer"
                    title="Refresh attendance data"
                  >
                    <RefreshCw size={11} />
                    {lastFetchedAt ? `Updated ${lastFetchedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Refresh"}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

const StudentDashboard: React.FC = () => {
  const { currentUser, departments = [], fetchDepartments, logout } = useApp();

  const [scanStep, setScanStep] = useState<"IDLE" | "PREPARING" | "SCANNING" | "SUBMITTING" | "SUCCESS" | "ERROR">("IDLE");
  const [statusMsg, setStatusMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [recentSessions, setRecentSessions] = useState<any[]>([]);
  const [todayPanelOpen, setTodayPanelOpen] = useState(false);
  const [todayPanelLoading, setTodayPanelLoading] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [isScannerActive, setIsScannerActive] = useState(false);
  const [scannerType, setScannerType] = useState<"DYNAMIC_PAIR" | null>(null);
  const [scannerError, setScannerError] = useState("");
  const [scannerHint, setScannerHint] = useState("");
  const [scannerStatusTone, setScannerStatusTone] = useState<"neutral" | "success" | "error">("neutral");
  const [firstDynamicArmActive, setFirstDynamicArmActive] = useState(false);
  const [locationReady, setLocationReady] = useState(false);
  const [faceGateOpen, setFaceGateOpen] = useState(false);
  const [faceGateStatus, setFaceGateStatus] = useState<"VERIFYING" | "MATCHING" | "FAILED">("VERIFYING");
  const [faceGateMessage, setFaceGateMessage] = useState("");
  const [liveFacePhoto, setLiveFacePhoto] = useState("");
  const [faceVerifiedUntil, setFaceVerifiedUntil] = useState(0);
  const [sessionExpiredToast, setSessionExpiredToast] = useState(false);

  const mountedRef = useRef(true);
  const submitLockRef = useRef(false);
  const resetTimerRef = useRef<number | null>(null);
  const sessionExpiredToastTimerRef = useRef<number | null>(null);
  const loadingRecentRef = useRef(false);
  const cameraWarmupPromiseRef = useRef<Promise<void> | null>(null);
  const scannerResolveRef = useRef<((value: ScannerResult) => void) | null>(null);
  const sequentialQrBufferRef = useRef(createSequentialBuffer());
  const dynamicPairFirstTokenRef = useRef<string | null>(null);
  const dynamicPairFirstPayloadRef = useRef<DynamicQrPayload | null>(null);
  const dynamicPairFirstCapturedAtRef = useRef<number | null>(null);
  const dynamicPairLockedRef = useRef(false);
  const dynamicPairTimeoutRef = useRef<number | null>(null);
  const firstDynamicArmTimeoutRef = useRef<number | null>(null);
  const locationWarmupPromiseRef = useRef<Promise<any> | null>(null);
  const autoLaunchHandledRef = useRef(false);
  const pendingQrPairRef = useRef<DynamicPairScanResult | null>(null);
  const faceGateTimerRef = useRef<number | null>(null);
  const faceVerifiedUntilRef = useRef(0);

  const faceVerified = faceVerifiedUntil > Date.now();
  const registeredFacePhoto = String(currentUser?.studentProfilePhotoUrl || "").trim();

  const todaysClasses = useMemo<TodayClassRow[]>(
    () =>
      (recentSessions || [])
        .map((record: any) => toTodayAttendanceRow(record))
        .filter(
          (record): record is TodayClassRow =>
            Boolean(
              record &&
              record.sessionId &&
              record.startTime
            )
        )
        .sort(
          (a, b) =>
            new Date(a.markedAt || a.startTime).getTime() -
            new Date(b.markedAt || b.startTime).getTime()
        ),
    [recentSessions]
  );
  const todayAttendanceSummary = useMemo(() => {
    const present = todaysClasses.filter((record) => record.attendanceCode === "P").length;
    const absent = todaysClasses.filter((record) => record.attendanceCode === "A").length;
    return { present, absent, total: todaysClasses.length };
  }, [todaysClasses]);
  useEffect(() => {
    mountedRef.current = true;
    void preloadCameraQrScanner();
    void preloadLivePhotoCapture();
    void loadModelsIfNeeded();
    void prewarmFrontCamera();
    void prewarmQrCamera();
    if (registeredFacePhoto) {
      void computeDescriptorFromImageURL(registeredFacePhoto);
    }
    if (typeof navigator !== "undefined" && navigator?.permissions?.query) {
      navigator.permissions.query({ name: "camera" as any }).catch(() => undefined);
    }
    if (!departments.length) {
      void fetchDepartments();
    }

    // Start rolling 30-second GPS cache watcher in background for instant 0ms scan resolution
    const stopGpsWatcher = startRollingGpsWatcher((_loc) => {
      if (mountedRef.current) {
        setLocationReady(true);
      }
    });

    return () => {
      mountedRef.current = false;
      stopGpsWatcher();
      if (resetTimerRef.current) {
        window.clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
      if (firstDynamicArmTimeoutRef.current) {
        window.clearTimeout(firstDynamicArmTimeoutRef.current);
        firstDynamicArmTimeoutRef.current = null;
      }
      if (faceGateTimerRef.current) window.clearTimeout(faceGateTimerRef.current);
      if (sessionExpiredToastTimerRef.current) {
        window.clearTimeout(sessionExpiredToastTimerRef.current);
        sessionExpiredToastTimerRef.current = null;
      }
    };
  }, [registeredFacePhoto]);

  const handleLiveFaceCaptured = useCallback((capture: {
    faceVerification?: { matched?: boolean; liveness?: string };
  }) => {
    if (!capture.faceVerification?.matched || capture.faceVerification.liveness !== "movement") {
      faceVerifiedUntilRef.current = 0;
      setFaceVerifiedUntil(0);
      setFaceGateStatus("FAILED");
      setFaceGateMessage("Live face verification is required.");
      return;
    }

    const verifiedUntil = Date.now() + FACE_VERIFICATION_WINDOW_MS;
    faceVerifiedUntilRef.current = verifiedUntil;
    if (faceGateTimerRef.current) window.clearTimeout(faceGateTimerRef.current);
    setFaceVerifiedUntil(verifiedUntil);
    setFaceGateOpen(false);
    setLiveFacePhoto("");
    setFaceGateStatus("VERIFYING");
    setFaceGateMessage("");
    // Prewarm environment camera immediately while modal transitions
    void prewarmQrCamera();
    faceGateTimerRef.current = window.setTimeout(() => {
      if (!mountedRef.current) return;
      faceVerifiedUntilRef.current = 0;
      setFaceVerifiedUntil(0);
    }, FACE_VERIFICATION_WINDOW_MS);
  }, []);

  const closeScanner = useCallback((value: ScannerResult) => {
    dynamicPairLockedRef.current = true;
    if (dynamicPairTimeoutRef.current) {
      window.clearTimeout(dynamicPairTimeoutRef.current);
      dynamicPairTimeoutRef.current = null;
    }
    if (firstDynamicArmTimeoutRef.current) {
      window.clearTimeout(firstDynamicArmTimeoutRef.current);
      firstDynamicArmTimeoutRef.current = null;
    }
    dynamicPairFirstTokenRef.current = null;
    dynamicPairFirstPayloadRef.current = null;
    dynamicPairFirstCapturedAtRef.current = null;
    sequentialQrBufferRef.current.flush();
    setFirstDynamicArmActive(false);
    setIsScannerActive(false);
    setScannerHint("");
    setScannerStatusTone("neutral");
    setScannerOpen(false);
    setScannerType(null);
    setScannerError("");
    if (scannerResolveRef.current) {
      scannerResolveRef.current(value);
      scannerResolveRef.current = null;
    }
  }, []);

  const handleFaceSessionExpired = useCallback(() => {
    // 1. Immediately clear the verification token — no grace period
    faceVerifiedUntilRef.current = 0;
    setFaceVerifiedUntil(0);
    // 2. Close QR scanner if it is open (returns student to main dashboard view)
    if (scannerOpen) {
      closeScanner(null);
    }
    // 3. Reset scan step fully back to IDLE — not ERROR — so Mark Attendance is
    //    immediately re-tappable without the student needing to do anything extra
    setScanStep("IDLE");
    setStatusMsg("");
    setBusy(false);
    submitLockRef.current = false;
    // 4. Show a brief, non-blocking expiry notice as a floating toast
    //    that auto-clears after 3.5 seconds (non-intrusive)
    if (sessionExpiredToastTimerRef.current) {
      window.clearTimeout(sessionExpiredToastTimerRef.current);
    }
    setSessionExpiredToast(true);
    sessionExpiredToastTimerRef.current = window.setTimeout(() => {
      if (mountedRef.current) setSessionExpiredToast(false);
      sessionExpiredToastTimerRef.current = null;
    }, 3500);
  }, [scannerOpen, closeScanner]);

  useEffect(() => {
    const handleSecurityState = () => {
      if (document.visibilityState === "hidden") {
        faceVerifiedUntilRef.current = 0;
        setFaceVerifiedUntil(0);
        if (scannerOpen) {
          closeScanner(null);
        }
        // Reset to IDLE — not ERROR — student can immediately re-tap
        setScanStep("IDLE");
        setStatusMsg("");
        setBusy(false);
        submitLockRef.current = false;
      }
    };
    document.addEventListener("visibilitychange", handleSecurityState);
    return () => {
      document.removeEventListener("visibilitychange", handleSecurityState);
    };
  }, [scannerOpen, closeScanner]);

  const openDynamicPairScanner = useCallback(async (autoArm = false): Promise<DynamicPairScanResult | null> => {
    const hasMedia = !!navigator?.mediaDevices?.getUserMedia;
    if (!hasMedia) {
      setScanStep("ERROR");
      setStatusMsg("Camera is required to scan QR. Manual entry is not allowed.");
      return null;
    }

    return await new Promise<DynamicPairScanResult | null>((resolve) => {
      if (scannerResolveRef.current) {
        scannerResolveRef.current(null);
      }
      scannerResolveRef.current = (v) => {
        if (
          v &&
          typeof v === "object" &&
          (
            ("first" in v && "second" in v) ||
            ("sequence" in v && Array.isArray((v as any).sequence))
          )
        ) {
          if ("sequence" in v) {
            resolve({ kind: "totp", sequence: (v as any).sequence });
          } else {
            resolve({ kind: "legacy", first: (v as any).first, second: (v as any).second });
          }
        } else {
          resolve(null);
        }
      };
      sequentialQrBufferRef.current.flush();
      dynamicPairFirstTokenRef.current = null;
      dynamicPairFirstPayloadRef.current = null;
      dynamicPairFirstCapturedAtRef.current = null;
      dynamicPairLockedRef.current = false;
      setFirstDynamicArmActive(true);
      setIsScannerActive(true);
      setScannerHint(
        autoArm
          ? "Scanning the current Dynamic QR. Hold steady while the first code is captured."
          : "Scanning the current Dynamic QR. Hold steady while the attendance code is captured."
      );
      setScannerStatusTone("success");
      setScannerType("DYNAMIC_PAIR");
      setScannerError("");
      setScannerOpen(true);

      if (autoArm) {
        if (firstDynamicArmTimeoutRef.current) {
          window.clearTimeout(firstDynamicArmTimeoutRef.current);
        }
        firstDynamicArmTimeoutRef.current = window.setTimeout(() => {
          setFirstDynamicArmActive(false);
          setScannerStatusTone("neutral");
          setScannerHint("First QR was not captured. Tap the button or try again.");
          firstDynamicArmTimeoutRef.current = null;
        }, FIRST_DYNAMIC_ARM_WINDOW_MS);
      }
    });
  }, []);

  useEffect(() => {
    if (!scannerOpen) return;
    setScannerError("");
    setScannerStatusTone("neutral");
  }, [scannerOpen]);

  const armFirstDynamicCapture = useCallback(() => {
    if (dynamicPairLockedRef.current || dynamicPairFirstTokenRef.current) return;
    if (firstDynamicArmTimeoutRef.current) {
      window.clearTimeout(firstDynamicArmTimeoutRef.current);
    }
    setIsScannerActive(true);
    setFirstDynamicArmActive(true);
    setScannerStatusTone("success");
    setScannerHint("First QR capture is active. Hold the phone steady on the current Dynamic QR.");
    firstDynamicArmTimeoutRef.current = window.setTimeout(() => {
      setFirstDynamicArmActive(false);
      setScannerStatusTone("neutral");
      setScannerHint("First QR was not captured. Tap the button again and hold steady.");
      firstDynamicArmTimeoutRef.current = null;
    }, FIRST_DYNAMIC_ARM_WINDOW_MS);
  }, []);

  const resetDynamicPairFirst = useCallback((raw: string, payload: DynamicQrPayload, hint: string) => {
    if (firstDynamicArmTimeoutRef.current) {
      window.clearTimeout(firstDynamicArmTimeoutRef.current);
      firstDynamicArmTimeoutRef.current = null;
    }
    if (dynamicPairTimeoutRef.current) {
      window.clearTimeout(dynamicPairTimeoutRef.current);
    }

    setFirstDynamicArmActive(false);
    dynamicPairFirstTokenRef.current = raw;
    dynamicPairFirstPayloadRef.current = payload;
    dynamicPairFirstCapturedAtRef.current = Date.now();
    setScannerStatusTone("success");
    setScannerHint(hint);
    dynamicPairTimeoutRef.current = window.setTimeout(() => {
      closeScanner(null);
      setScanStep("ERROR");
      setStatusMsg("Second QR not scanned within 10 seconds. Try again.");
    }, DYNAMIC_SECOND_SCAN_TIMEOUT_MS);
  }, [closeScanner]);

  const loadStudentData = useCallback(async () => {
    if (loadingRecentRef.current) return;
    loadingRecentRef.current = true;

    try {
      const recentRes: any = await apiClient.getStudentTodayLiveAttendance();
      if (!mountedRef.current) return;

      if (recentRes?.ok) {
        setRecentSessions(Array.isArray(recentRes.classes) ? recentRes.classes : []);
      } else {
        setRecentSessions([]);
      }
    } catch {
      if (!mountedRef.current) return;
      setRecentSessions([]);
    } finally {
      loadingRecentRef.current = false;
    }
  }, []);

  // Fetch today's classes on initial dashboard visit
  useEffect(() => {
    void loadStudentData();
  }, [loadStudentData]);

  const warmLocation = useCallback(() => {
    if (locationWarmupPromiseRef.current) {
      return locationWarmupPromiseRef.current;
    }

    const promise = prewarmLiveLocation({ maxAgeMs: DISPLAY_GPS_MAX_AGE_MS })
      .then((coords) => {
        if (mountedRef.current) {
          setLocationReady(Boolean(coords));
        }
        return coords;
      })
      .finally(() => {
        locationWarmupPromiseRef.current = null;
      });

    locationWarmupPromiseRef.current = promise;
    return promise;
  }, []);

  const resolveLiveLocation = useCallback(async () => {
    // 1. Instant 0ms Fast Path from rolling 90s attendance GPS cache
    const instant = getInstantCachedLocation(ATTENDANCE_GPS_MAX_AGE_MS);
    if (instant) {
      if (mountedRef.current) {
        setLocationReady(true);
      }
      return instant;
    }

    // 2. Fresh high-accuracy GPS fix fallback
    const fresh = await getLiveLocationWithOptions({
      preferCached: true,
      maxAgeMs: ATTENDANCE_GPS_MAX_AGE_MS,
    });
    if (mountedRef.current) {
      setLocationReady(true);
    }
    return fresh;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const browserWindow = window as IdleCapableWindow;
    const warmup = () => {
      void preloadCameraQrScanner();
      void warmLocation();
    };

    if (typeof browserWindow.requestIdleCallback === "function") {
      const idleId = browserWindow.requestIdleCallback(warmup, {
        timeout: 2500,
      });
      return () => browserWindow.cancelIdleCallback?.(idleId);
    }

    const timerId = window.setTimeout(warmup, 600);
    return () => window.clearTimeout(timerId);
  }, [warmLocation]);

  const openTodayPanel = useCallback(async () => {
    setTodayPanelOpen(true);
    setTodayPanelLoading(true);
    await loadStudentData();
    if (mountedRef.current) {
      setTodayPanelLoading(false);
    }
  }, [loadStudentData]);

  const submitQrAttendance = useCallback(async () => {
    if (!faceVerifiedUntilRef.current || Date.now() > faceVerifiedUntilRef.current) {
      faceVerifiedUntilRef.current = 0;
      setFaceVerifiedUntil(0);
      setScanStep("ERROR");
      setStatusMsg("Face verification session expired. Please verify your live face again.");
      setBusy(false);
      return;
    }

    const pair = await openDynamicPairScanner(false);
    if (!pair) {
      pendingQrPairRef.current = null;
      setScanStep("IDLE");
      setStatusMsg("");
      setBusy(false);
      return;
    }

    // Double-check biometric window before finalizing network submission
    if (!faceVerifiedUntilRef.current || Date.now() > faceVerifiedUntilRef.current) {
      faceVerifiedUntilRef.current = 0;
      setFaceVerifiedUntil(0);
      pendingQrPairRef.current = null;
      setScanStep("ERROR");
      setStatusMsg("Biometric verification session expired while scanning. Please re-verify your face.");
      setBusy(false);
      return;
    }

    // Invalidate biometric session immediately upon single attendance mark attempt (anti-proxy protection)
    faceVerifiedUntilRef.current = 0;
    setFaceVerifiedUntil(0);

    pendingQrPairRef.current = pair;
    setScanStep("SUBMITTING");
    setStatusMsg("Confirming attendance with QR and GPS...");

    const coords = await resolveLiveLocation();
    const fingerprint = getFingerprint();

    const isTimeoutOrNetworkError = (res: any) => {
      if (!res || res.ok) return false;
      const errStr = String(res.error || res.message || "").toLowerCase();
      const status = Number(res.status || 0);
      return (
        errStr.includes("timed out") ||
        errStr.includes("timeout") ||
        errStr.includes("network error") ||
        errStr.includes("failed to fetch") ||
        errStr.includes("network request failed") ||
        status === 408 ||
        status === 502 ||
        status === 503 ||
        status === 504
      );
    };

    // Helper for executing the attendance request
    const executeSubmit = async () => {
      if (!pendingQrPairRef.current) {
        return { ok: false, error: "Missing QR payload" };
      }
      if (pendingQrPairRef.current.kind === "totp") {
        const seq = pendingQrPairRef.current.sequence;
        const targetSessionId = seq?.[0]?.classId || (seq?.[0] as any)?.sessionId;
        return await apiClient.post("/api/attendance/submit", {
          sessionId: targetSessionId,
          sequence: seq,
          fingerprint,
          lat: coords.lat,
          lng: coords.lng,
          accuracy: coords.accuracy,
          location: {
            lat: coords.lat,
            lng: coords.lng,
            accuracy: coords.accuracy,
          },
        });
      } else {
        return await markAttendanceTwoStep(
          pendingQrPairRef.current.first,
          pendingQrPairRef.current.second,
          fingerprint,
          coords.lat,
          coords.lng,
          null,
          coords.accuracy,
          null
        );
      }
    };

    let result: any = null;

    try {
      result = await executeSubmit();
    } catch (err: any) {
      result = { ok: false, error: err?.message || "Failed to submit attendance" };
    }

    // Automatic silent retry (1 retry) on network timeout or transient network failure
    if (!result?.ok && isTimeoutOrNetworkError(result)) {
      if (mountedRef.current) {
        setStatusMsg("Connection timed out. Retrying attendance confirmation...");
      }
      // Brief jittered pause before retry (350ms) to let network socket clear
      await new Promise((resolve) => setTimeout(resolve, 350));
      try {
        result = await executeSubmit();
      } catch (retryErr: any) {
        result = {
          ok: false,
          error: retryErr?.message || "Retry failed due to network error",
        };
      }
    }

    if (result?.ok) {
      const targetSessionId =
        pendingQrPairRef.current?.kind === "totp"
          ? pendingQrPairRef.current.sequence?.[0]?.classId || (pendingQrPairRef.current.sequence?.[0] as any)?.sessionId
          : pendingQrPairRef.current?.kind === "legacy"
            ? decodeDynamicQrPayload(pendingQrPairRef.current.first)?.sessionId
            : null;

      pendingQrPairRef.current = null;
      setScanStep("SUCCESS");
      setStatusMsg(result.already || result.alreadyMarked ? "Attendance already marked." : "Attendance confirmed.");

      // 1. Optimistic Local State Update (Instant 0ms UI Feedback)
      const markedSessionId = String(
        result?.session?.id ||
        result?.session?._id ||
        result?.sessionId ||
        targetSessionId ||
        ""
      );

      if (markedSessionId) {
        setRecentSessions((prev) => {
          const nowIso = new Date().toISOString();
          const existingIndex = prev.findIndex((item) => {
            const sid = String(
              item?.sessionId ||
              item?.session?.id ||
              item?.session?._id ||
              item?.session ||
              item?._id ||
              item?.id ||
              ""
            );
            return sid === markedSessionId;
          });

          if (existingIndex >= 0) {
            const updated = [...prev];
            updated[existingIndex] = {
              ...updated[existingIndex],
              status: "present",
              attendanceCode: "P",
              markedAt: result?.markedAt || updated[existingIndex]?.markedAt || nowIso,
            };
            return updated;
          }

          return [
            {
              sessionId: markedSessionId,
              subjectName: result?.session?.subjectName || "Subject",
              subjectCode: result?.session?.subjectCode || "SUB",
              facultyName: "Faculty",
              startTime: nowIso,
              markedAt: result?.markedAt || nowIso,
              isActive: true,
              status: "present",
              attendanceCode: "P",
            },
            ...prev,
          ];
        });
      }

      // 2. Silent background sync without blocking UI
      void loadStudentData().catch(() => {});

      if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = window.setTimeout(() => {
        if (!mountedRef.current) return;
        setScanStep("IDLE");
        setStatusMsg("");
      }, 1600);
      return;
    }

    const rawError = typeof result === "string" ? "Network or server error" : String(result?.error || "");
    const cleanError =
      rawError.includes("<!DOCTYPE") || rawError.includes("<html") || rawError.includes("<pre>")
        ? "Attendance server error. Please try again."
        : rawError || "Attendance failed.";

    setScanStep("ERROR");
    setStatusMsg(cleanError);
  }, [
    loadStudentData,
    openDynamicPairScanner,
    resolveLiveLocation,
  ]);

  const simulateScan = useCallback(async (forcedVerifiedUntil?: number) => {
    if (submitLockRef.current || busy) return;
    const currentVerifiedUntil = forcedVerifiedUntil ?? faceVerifiedUntilRef.current;
    if (currentVerifiedUntil <= Date.now()) {
      faceVerifiedUntilRef.current = 0;
      setFaceVerifiedUntil(0);
      setFaceGateStatus("VERIFYING");
      setFaceGateMessage("");
      setLiveFacePhoto("");
      setFaceGateOpen(true);
      return;
    }

    submitLockRef.current = true;
    setBusy(true);
    setScannerError("");
    setScanStep("PREPARING");
    setStatusMsg("Opening QR scanner...");

    try {
      pendingQrPairRef.current = null;
      void preloadCameraQrScanner();
      setScanStep("SCANNING");
      setStatusMsg("Scan the rotating Dynamic QR pair to mark attendance.");
      await submitQrAttendance();
    } catch (err: any) {
      const message = err?.message || "Attendance failed.";
      if (message.toLowerCase().includes("location")) {
        setLocationReady(false);
      }
      setScanStep("ERROR");
      setStatusMsg(message);
    } finally {
      setBusy(false);
      submitLockRef.current = false;
      void warmLocation();
    }
  }, [
    busy,
    submitQrAttendance,
    warmLocation,
  ]);

  useEffect(() => {
    autoLaunchHandledRef.current = true;
  }, []);

  const resetScan = () => {
    setScanStep("IDLE");
    setStatusMsg("");
    setBusy(false);
    pendingQrPairRef.current = null;
    submitLockRef.current = false;
    if (resetTimerRef.current) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    void warmLocation();
  };

  return (
    <div className="relative mx-auto min-h-screen max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Face Session Expired Toast — auto-dismisses after 3.5s */}
      {sessionExpiredToast && (
        <div
          className="fixed top-5 inset-x-4 z-[100] flex justify-center pointer-events-none"
          aria-live="assertive"
        >
          <div className="
            inline-flex items-center gap-3
            rounded-2xl border border-amber-500/40
            bg-amber-950/95 backdrop-blur-md
            px-5 py-3.5 shadow-2xl
            text-sm font-semibold text-amber-200
            animate-in slide-in-from-top-4 duration-300
          ">
            {/* Shield icon */}
            <span className="flex h-8 w-8 shrink-0 items-center justify-center 
                              rounded-xl bg-amber-500/20 text-amber-400">
              <ShieldAlert size={18} />
            </span>
            <div>
              <p className="font-bold text-amber-100">Verification session expired</p>
              <p className="text-xs text-amber-300/80 mt-0.5 font-normal">
                Tap Mark Attendance to verify your face again.
              </p>
            </div>
          </div>
        </div>
      )}

      {faceGateOpen && (
        <div className="fixed inset-0 z-[75] flex items-end sm:items-center justify-center bg-black/85 backdrop-blur-sm">
          <div className="
            relative w-full h-[92dvh] sm:h-auto sm:max-w-lg
            overflow-hidden
            rounded-t-[32px] sm:rounded-[28px]
            bg-slate-900 border border-slate-800
            shadow-[0_-24px_80px_-12px_rgba(0,0,0,0.7)]
            flex flex-col
          ">
            {/* Close button */}
            <button
              type="button"
              onClick={() => {
                setFaceGateOpen(false);
                setFaceGateStatus("VERIFYING");
                setLiveFacePhoto("");
                setBusy(false);
                submitLockRef.current = false;
                setScanStep("IDLE");
                setStatusMsg("");
              }}
              className="absolute top-4 right-4 z-30 p-2 text-slate-400 hover:text-white rounded-full bg-slate-800/80 hover:bg-slate-700 transition-colors cursor-pointer"
              title="Close face verification"
            >
              <X size={18} />
            </button>

            {/* Drag handle pill on mobile */}
            <div className="flex justify-center pt-3 pb-1 sm:hidden">
              <div className="h-1 w-10 rounded-full bg-slate-700" />
            </div>

            {/* LivePhotoCapture fills remaining space */}
            <div className="flex-1 overflow-y-auto px-4 pb-4 pt-2">
              <React.Suspense
                fallback={
                  <div className="flex h-full items-center justify-center py-12 text-sm text-slate-400">
                    Opening camera...
                  </div>
                }
              >
                <LivePhotoCapture
                  value={liveFacePhoto}
                  onChange={setLiveFacePhoto}
                  onCaptured={(capture) => {
                    handleLiveFaceCaptured(capture);
                    if (
                      capture.faceVerification?.matched &&
                      capture.faceVerification.liveness === "movement"
                    ) {
                      const freshExpiry = Date.now() + FACE_VERIFICATION_WINDOW_MS;
                      window.setTimeout(() => {
                        void simulateScan(freshExpiry);
                      }, 200);
                    }
                  }}
                  disabled={faceGateStatus === "MATCHING" || !registeredFacePhoto}
                  autoStart
                  autoCapture
                  hideLauncher
                  compactMode
                  showCapturedPreview={false}
                  faceVerificationReferenceUrl={registeredFacePhoto}
                  title="Face Verification"
                  description={
                    !registeredFacePhoto
                      ? "No registered student profile photo found."
                      : "Verify your live face to mark attendance."
                  }
                />
              </React.Suspense>
            </div>
          </div>
        </div>
      )}
      {scannerOpen && (
        <React.Suspense
          fallback={
            <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-black/85 p-4 text-sm text-white">
              Opening scanner...
            </div>
          }
        >
          <CameraQrScanner
            title="Scan Dynamic QR"
            hint={scannerError || scannerHint}
            statusTone={scannerError ? "error" : scannerStatusTone}
            isScannerActive={isScannerActive}
            faceVerifiedExpiresAt={faceVerifiedUntil}
            onSessionExpired={handleFaceSessionExpired}
            onCancel={() => closeScanner(null)}
            onDetected={(decodedText) => {
              if (dynamicPairLockedRef.current) return true;

              const raw = String(decodedText || "").trim();
              if (!raw) return false;

              if (scannerType === "DYNAMIC_PAIR") {
                const totpPayload = parseQrPayload(raw);
                if (totpPayload) {
                  const bufferedCount = sequentialQrBufferRef.current.getPayloads().length;
                  if (bufferedCount === 0 && !firstDynamicArmActive) {
                    setScannerStatusTone("neutral");
                    setScannerHint("Tap 'Capture First QR' when you are ready to lock the first code.");
                    return false;
                  }

                  const status = sequentialQrBufferRef.current.addBlock(totpPayload);

                  if (status === "duplicate") {
                    setScannerStatusTone("success");
                    setScannerHint("Same QR block detected. Waiting for the next rotation.");
                    return false;
                  }

                  if (status === "ready") {
                    const sequence = sequentialQrBufferRef.current.getPayloads();
                    dynamicPairLockedRef.current = true;
                    setScannerStatusTone("success");
                    setScannerHint("Second QR block captured. Submitting attendance...");
                    closeScanner({ sequence });
                    return true;
                  }

                  setScannerStatusTone("success");
                  setFirstDynamicArmActive(false);
                  setScannerHint("First QR block captured. Keep the camera steady for the next rotation.");
                  return false;
                }

                const first = dynamicPairFirstTokenRef.current;
                if (!first) {
                  if (!firstDynamicArmActive) {
                    setScannerStatusTone("neutral");
                    setScannerHint("Tap 'Capture First QR' when you are ready to lock the first code.");
                    return false;
                  }

                  const firstPayload = decodeDynamicQrPayload(raw);
                  if (!firstPayload) {
                    setScannerStatusTone("error");
                    setScannerHint("This is not a valid Dynamic QR. Point at the attendance QR.");
                    return false;
                  }

                  resetDynamicPairFirst(
                    raw,
                    firstPayload,
                    `First QR captured. Hold steady and wait ${Math.ceil(
                      MIN_DYNAMIC_ROTATION_WAIT_MS / 1000
                    )}s for the next Dynamic QR.`
                  );
                  return false;
                }

                const firstPayload = dynamicPairFirstPayloadRef.current;
                const secondPayload = decodeDynamicQrPayload(raw);
                if (!firstPayload || !secondPayload) {
                  setScannerStatusTone("error");
                  setScannerHint("This is not a valid Dynamic QR. Keep the camera on the attendance QR.");
                  return false;
                }

                if (secondPayload.sessionId !== firstPayload.sessionId) {
                  resetDynamicPairFirst(
                    raw,
                    secondPayload,
                    "New session QR captured as the first scan. Keep the camera steady for the next QR."
                  );
                  return false;
                }

                if (raw === first) {
                  setScannerStatusTone("success");
                  setScannerHint("Same QR detected again. Waiting for the next rotated Dynamic QR.");
                  return false;
                }

                if (Number(secondPayload.iat || 0) <= Number(firstPayload.iat || 0)) {
                  setScannerStatusTone("success");
                  setScannerHint("Waiting for the next rotated Dynamic QR.");
                  return false;
                }

                if (
                  Number(secondPayload.iat || 0) - Number(firstPayload.iat || 0) >
                  MAX_DYNAMIC_SEQUENCE_GAP_SECONDS
                ) {
                  resetDynamicPairFirst(
                    raw,
                    secondPayload,
                    "Latest QR captured as the first scan. Keep holding steady for the next QR."
                  );
                  return false;
                }

                const firstCapturedAt = dynamicPairFirstCapturedAtRef.current;
                if (
                  firstCapturedAt &&
                  Date.now() - firstCapturedAt < MIN_DYNAMIC_ROTATION_WAIT_MS
                ) {
                  setScannerStatusTone("success");
                  setScannerHint("First QR captured. Waiting for QR rotation. Keep the phone steady.");
                  return false;
                }

                dynamicPairLockedRef.current = true;
                setScannerStatusTone("success");
                setScannerHint("Second QR captured. Submitting attendance...");
                closeScanner({ first, second: raw });
                return true;
              }

              return false;
            }}
          />
        </React.Suspense>
      )}
      {todayPanelOpen && (
        <div className="fixed inset-0 z-[65] flex items-end justify-center bg-slate-950/55 p-3 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="max-h-[86vh] w-full max-w-lg overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_28px_90px_-36px_rgba(15,23,42,0.65)]">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2 font-semibold tracking-tight text-slate-900">
                <History size={18} />
                <span className="truncate">Today's Attendance</span>
              </div>
              <button
                type="button"
                onClick={() => setTodayPanelOpen(false)}
                aria-label="Close today's attendance"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
              >
                <X size={17} />
              </button>
            </div>

            <div className="max-h-[calc(86vh-58px)] overflow-y-auto px-4 py-4">
              {todayPanelLoading ? (
                <div className="flex min-h-[260px] flex-col items-center justify-center text-center">
                  <LoaderCircle size={28} className="animate-spin text-teal-600" />
                  <p className="mt-3 text-sm font-semibold text-slate-800">Fetching today's attendance</p>
                </div>
              ) : (
                <>
                  <div className="mb-3 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-600">
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">P Present</span>
                    <span className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-rose-700">A Absent</span>
                    <span className="ml-auto text-slate-500">{todayAttendanceSummary.total} class{todayAttendanceSummary.total === 1 ? "" : "es"}</span>
                  </div>

                  {todaysClasses.length === 0 ? (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 py-9 text-center text-slate-500">
                      <p className="font-medium">No classes found for today</p>
                      <p className="mt-1 text-xs text-slate-400">Started class sessions will appear here with P or A status.</p>
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                      <div className="grid grid-cols-[minmax(0,1fr)_minmax(72px,0.8fr)_56px] bg-slate-900 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-200">
                        <span>Sub Code</span>
                        <span>Time</span>
                        <span className="text-center">P/A</span>
                      </div>
                      {todaysClasses.map((record) => {
                        const time = new Date(record.startTime).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        });

                        return (
                          <div
                            key={record.sessionId}
                            className="grid grid-cols-[minmax(0,1fr)_minmax(72px,0.8fr)_56px] items-center border-t border-slate-100 px-4 py-3 text-sm"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="truncate font-mono font-bold text-slate-900">
                                  {record.subjectCode}
                                </p>
                                {record.isActive ? <Badge color="blue">Live</Badge> : null}
                              </div>
                              <p className="mt-0.5 truncate text-xs text-slate-500">
                                {record.subjectName} | {record.facultyName}
                              </p>
                            </div>
                            <p className="font-semibold text-slate-800">{time}</p>
                            <div className="flex justify-center">
                              <Badge color={record.attendanceCode === "P" ? "green" : "red"}>
                                {record.attendanceCode}
                              </Badge>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
      <CollegeHeader
        className="mx-auto mb-4 max-w-lg !top-0 rounded-t-none sm:rounded-t-[24px]"
        collegeName={currentUser?.collegeName}
        profilePhotoUrl={currentUser?.profilePhotoUrl}
        profileMenuPhotoUrl={currentUser?.studentProfilePhotoUrl}
        title="Student Dashboard"
        subtitle={currentUser?.enrollmentNo || "Ready to mark attendance"}
        eyebrow="Student Portal"
        user={currentUser}
        roleLabel="Student"
        onLogout={logout}
      />

      <div className="mx-auto mb-4 flex min-h-[310px] w-full max-w-lg items-center justify-center rounded-[24px] border border-slate-800 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-900 p-6 sm:p-8 text-white shadow-[0_24px_50px_-20px_rgba(15,23,42,0.85)]">
        {scanStep === "IDLE" && (
          <div className="w-full text-center">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-800/80 text-cyan-400 border border-slate-700/60 shadow-inner">
              <Scan size={36} />
            </div>
            <h2 className="text-2xl font-bold mb-2 tracking-tight text-white">Mark Attendance</h2>
            <p className="text-slate-300 text-sm mb-5 leading-relaxed">Scan the Dynamic QR directly for a faster demo flow.</p>
            <div className="mb-6 flex flex-wrap items-center justify-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em]">
              <span className="rounded-full border border-slate-700 bg-slate-800/80 px-3.5 py-1 text-slate-300">
                Camera On Tap
              </span>
              <span className={`rounded-full border px-3.5 py-1 ${locationReady ? "border-emerald-500/50 bg-emerald-950/60 text-emerald-300" : "border-slate-700 bg-slate-800/80 text-slate-300"}`}>
                GPS {locationReady ? "Ready" : "Warming"}
              </span>
            </div>
            <Button
              onClick={() => void simulateScan()}
              className="bg-teal-600 hover:bg-teal-500 active:bg-teal-700 w-full py-4 text-base sm:text-lg font-bold text-white shadow-lg shadow-teal-950/50 rounded-xl cursor-pointer flex items-center justify-center gap-2"
              disabled={busy}
            >
              <Camera size={20} /> Mark Attendance
            </Button>
          </div>
        )}

        {scanStep === "PREPARING" && (
          <div className="w-full text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-950/60 text-teal-400 border border-teal-500/40">
              <MapPin size={36} />
            </div>
            <h3 className="text-lg font-bold tracking-tight text-white">Getting Ready</h3>
            <p className="text-xs text-slate-300 mt-2">{statusMsg || "Preparing camera and live GPS."}</p>
          </div>
        )}

        {scanStep === "SCANNING" && (
          <div className="w-full text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-950/60 text-emerald-400 border border-emerald-500/40">
              <CheckCircle size={36} />
            </div>
            <h2 className="text-xl font-bold tracking-tight text-white">Scan Attendance QR</h2>
            <p className="text-slate-300 text-sm mb-6 mt-1">
              Hold steady while the app captures the rotating QR pair.
            </p>
            {statusMsg && <p className="text-xs text-slate-300 mt-3 leading-relaxed">{statusMsg}</p>}
          </div>
        )}

        {scanStep === "SUBMITTING" && (
          <div className="w-full text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-950/60 text-teal-400 border border-teal-500/40 animate-pulse">
              <CheckCircle size={36} />
            </div>
            <h2 className="text-xl font-bold tracking-tight text-white">Submitting</h2>
            <p className="text-slate-300 text-sm mt-1">{statusMsg || "Verifying QR, device, and location."}</p>
          </div>
        )}

        {scanStep === "SUCCESS" && (
          <div className="w-full text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-950/60 text-emerald-400 border border-emerald-500/40">
              <CheckCircle size={36} />
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-white">Present</h2>
            <p className="text-emerald-300 bg-emerald-950/60 border border-emerald-500/30 rounded-lg px-3 py-2 mt-3 text-sm">{statusMsg}</p>
            <Button onClick={resetScan} variant="secondary" className="mt-6 bg-white text-slate-900 border-none hover:bg-slate-100 font-bold cursor-pointer">Done</Button>
          </div>
        )}

        {scanStep === "ERROR" && (
          <div className="w-full text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-950/60 text-rose-400 border border-rose-500/40">
              <XCircle size={36} />
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-white">Failed</h2>
            <p className="text-rose-300 bg-rose-950/60 border border-rose-500/30 rounded-lg px-3 py-2 mt-3 text-sm">{statusMsg}</p>
            <Button onClick={resetScan} variant="secondary" className="mt-6 bg-white text-slate-900 border-none hover:bg-slate-100 font-bold cursor-pointer">Try Again</Button>
          </div>
        )}
      </div>

      {/* ── My Attendance Card ─────────────────────────────────────────── */}
      <div className="mx-auto mb-3 w-full max-w-lg">
        <MyAttendanceCard />
      </div>

      {/* ── Today's Attendance Quick Access ────────────────────────────── */}
      <div className="mx-auto flex w-full max-w-lg justify-center pb-8">
        <button
          type="button"
          onClick={openTodayPanel}
          className="min-w-[170px] rounded-2xl bg-slate-900 px-5 py-3 text-center text-white shadow-[0_18px_42px_-28px_rgba(15,23,42,0.8)] transition hover:-translate-y-0.5 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300">Today</p>
          <p className="mt-1 text-sm font-semibold tracking-tight">
            View Attendance
          </p>
        </button>
      </div>
    </div>
  );
};

export default StudentDashboard;
