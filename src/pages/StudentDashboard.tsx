import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useApp } from "../store";
import { Button, Card, Badge, CountUp } from "../components/Common";
import CollegeHeader from "../components/CollegeHeader";
import {
  Scan, MapPin, CheckCircle, XCircle, History, Camera, LoaderCircle, X,
  BookOpen, TrendingUp, AlertTriangle, RefreshCw, ChevronDown,
  Award, Clock, ShieldAlert, Calendar, Users, UserRound, Mail, GraduationCap, ShieldCheck,
  Smartphone, CheckCircle2
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

import { preloadForStudent } from "../utils/faceApiLoader";
import { prewarmMediaPipe } from "../utils/mediaPipeFaceQuality";

import {
  touchDownPrewarmFrontCamera,
  releasePrewarmedFrontStream,
  prewarmFrontCamera,
} from "../components/LivePhotoCapture";

const CameraQrScanner = React.lazy(() => import("../components/CameraQrScanner"));
const LivePhotoCapture = React.lazy(() => import("../components/LivePhotoCapture"));

const preloadCameraQrScanner = () => import("../components/CameraQrScanner");
const preloadLivePhotoCapture = () => import("../components/LivePhotoCapture");
const prewarmQrCamera = () => import("../components/CameraQrScanner").then((m) => m.prewarmQrCamera());

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
  300,
  Number(import.meta.env.VITE_MIN_SECOND_SCAN_DELAY_MS || 500)
);
const MAX_DYNAMIC_SEQUENCE_GAP_SECONDS = Math.max(
  4,
  Number(import.meta.env.VITE_QR_SEQUENCE_GAP_SECONDS || 6)
);
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
  batchName?: string | null;
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

/**
 * 3-note success chime via Web Audio API:
 * Notes: C5 (523Hz) -> E5 (659Hz) -> G5 (784Hz), each 80ms long
 * with exponential gain decay from 0.18 to 0 over 300ms for a clean tone.
 */
function playSuccessChime(): void {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    if (ctx.state === "suspended") {
      void ctx.resume();
    }

    const notes = [523, 659, 784]; // C5, E5, G5
    const noteInterval = 0.08; // 80ms spacing
    const rampDuration = 0.30; // 300ms fade out
    const now = ctx.currentTime;

    notes.forEach((freq, idx) => {
      const startTime = now + idx * noteInterval;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, startTime);

      // Clean exponential decay: 0.18 -> 0.0001 (Web Audio requires positive target for exponential decay)
      gain.gain.setValueAtTime(0.18, startTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + rampDuration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + rampDuration);
    });

    // Clean up AudioContext hardware instance after chime concludes
    setTimeout(() => {
      try {
        void ctx.close();
      } catch {}
    }, 650);
  } catch {
    // Non-blocking fallback if browser policy restricts audio
  }
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

  // Actionable contextual hint
  const hint =
    pct >= 75
      ? canSkip !== null && canSkip > 0
        ? `Can skip ~${canSkip} more class${canSkip !== 1 ? "es" : ""}`
        : "At safe threshold"
      : needed !== null && needed > 0
        ? `Attend ${needed} more to reach 75%`
        : "Below 75% threshold";

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
          {subject.batchName && (
            <span className="shrink-0 rounded-md bg-indigo-50 border border-indigo-200/70 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
              {subject.batchName}
            </span>
          )}
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

      {/* Stats row & Always-visible contextual actionable hint */}
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11px]">
        <span className="text-slate-400 font-medium">
          {subject.classesAttended}/{subject.totalClassesConducted} classes
        </span>
        <span
          className={
            tier.color === "emerald"
              ? "text-slate-500 font-normal"
              : `${tier.textColor} font-bold`
          }
        >
          {hint}
        </span>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// FaceVerificationProgressBar — 60fps RAF-driven 4px countdown timer overlay
// Starts full (100%) and drains linearly toward faceVerifiedUntil.
// Color transitions: Emerald (≥50%) -> Amber (<50%) -> Rose (<20%).
// Pure CSS + RAF with zero React state re-rendering overhead on frame ticks.
// ---------------------------------------------------------------------------
interface FaceVerificationProgressBarProps {
  expiresAt: number;
  totalDurationMs?: number;
  onExpire?: () => void;
}

const FaceVerificationProgressBar: React.FC<FaceVerificationProgressBarProps> = React.memo(({
  expiresAt,
  totalDurationMs = FACE_VERIFICATION_WINDOW_MS,
  onExpire,
}) => {
  const barRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLSpanElement | null>(null);
  const rafIdRef = useRef<number>(0);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    if (!expiresAt || expiresAt <= Date.now()) return;

    const duration = Math.max(1000, totalDurationMs);
    let isRunning = true;

    const tick = () => {
      if (!isRunning) return;
      const now = Date.now();
      const remainingMs = Math.max(0, expiresAt - now);
      const ratio = Math.min(1, Math.max(0, remainingMs / duration));
      const pct = ratio * 100;
      const sec = Math.max(0, Math.ceil(remainingMs / 1000));

      if (barRef.current) {
        barRef.current.style.width = `${pct}%`;
        if (pct < 20) {
          barRef.current.style.backgroundColor = "#f43f5e"; // rose-500
        } else if (pct < 50) {
          barRef.current.style.backgroundColor = "#f59e0b"; // amber-500
        } else {
          barRef.current.style.backgroundColor = "#10b981"; // emerald-500
        }
      }

      if (textRef.current) {
        textRef.current.textContent = `Face verified · ${sec}s remaining`;
      }

      if (remainingMs <= 0) {
        isRunning = false;
        onExpireRef.current?.();
        return;
      }

      rafIdRef.current = requestAnimationFrame(tick);
    };

    rafIdRef.current = requestAnimationFrame(tick);

    return () => {
      isRunning = false;
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [expiresAt, totalDurationMs]);

  const initialSec = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));

  return (
    <div className="fixed top-0 left-0 right-0 z-[80] flex flex-col items-center pointer-events-none select-none animate-in fade-in duration-200">
      {/* Slim 4px Progress Track and Draining Bar */}
      <div className="w-full h-1 bg-black/50 backdrop-blur-xs overflow-hidden shadow-xs">
        <div
          ref={barRef}
          className="h-full bg-emerald-500 transition-none will-change-[width,background-color]"
          style={{ width: "100%" }}
        />
      </div>

      {/* Floating Pill Below the Bar */}
      <div className="mt-2.5 inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-slate-900/90 border border-white/15 text-white backdrop-blur-md shadow-lg">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
        <span ref={textRef} className="font-mono text-xs font-bold text-slate-100">
          Face verified · {initialSec}s remaining
        </span>
      </div>
    </div>
  );
});
FaceVerificationProgressBar.displayName = "FaceVerificationProgressBar";

const MyAttendanceCard: React.FC = () => {
  const [overviewData, setOverviewData] = useState<AttendanceOverviewData | null>(null);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const fetchingRef = useRef(false);
  const mountedRef = useRef(true);

  const fetchOverview = useCallback(async (silent = false) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setIsRefreshing(true);
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
      if (mountedRef.current) setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void fetchOverview(false);
    return () => { mountedRef.current = false; };
  }, [fetchOverview]);

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
  const hasData = (loadState === "loaded" || loadState === "idle") && !!overviewData;

  return (
    <div className="mx-auto w-full max-w-lg">
      <div className="overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-[0_8px_28px_-12px_rgba(15,23,42,0.18)]">
        {/* Header bar with circular refresh button */}
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 border border-indigo-200/80 text-indigo-600">
              <BookOpen size={14} />
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-800">Academic Overview</h3>
              <p className="text-[10px] text-slate-400">
                {lastFetchedAt
                  ? `Updated ${lastFetchedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                  : loadState === "loading"
                  ? "Loading records..."
                  : "Tap refresh to sync"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void fetchOverview(true)}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
            title="Refresh academic attendance"
          >
            <RefreshCw size={13} className={loadState === "loading" ? "animate-spin text-indigo-600" : ""} />
          </button>
        </div>

        {/* Loading skeleton */}
        {loadState === "loading" && !overviewData && (
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
        {loadState === "error" && !overviewData && (
          <div className="flex flex-col items-center gap-3 py-10 text-center px-6">
            <XCircle size={32} className="text-rose-400" />
            <p className="text-sm font-semibold text-slate-700">Could not load attendance data</p>
            <p className="text-xs text-slate-400">Check your connection and try again.</p>
            <button
              type="button"
              onClick={() => void fetchOverview(false)}
              className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-white transition cursor-pointer"
            >
              <RefreshCw size={13} /> Retry
            </button>
          </div>
        )}

        {/* Loaded data */}
        {hasData && (
          <>
            {/* Risk alert strip — visible if there are at-risk subjects */}
            {atRisk.length > 0 && (
              <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 flex items-center gap-2">
                <AlertTriangle size={14} className="shrink-0 text-amber-600" />
                <p className="text-[12px] font-semibold text-amber-800">
                  {atRisk.length === 1
                    ? `${atRisk[0].subjectName} is below 75%`
                    : `${atRisk.length} subjects are below 75% attendance`}
                </p>
              </div>
            )}

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
                  onClick={() => void fetchOverview(true)}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition cursor-pointer"
                  title="Refresh attendance data"
                >
                  <RefreshCw size={11} className={isRefreshing ? "animate-spin" : ""} />
                  {lastFetchedAt ? `Updated ${lastFetchedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Refresh"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

interface StudentAssignedActivity {
  id: string;
  name: string;
  type: "TRAINING" | "EVENT";
  event_date?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  semester?: number | null;
  section?: string | null;
  batchCode: string;
  assignedBatch?: {
    id: string;
    batch_number: number;
    batch_name: string;
    student_enrollments: string[];
  };
  hasActiveSession?: boolean;
  activeSessionId?: string | null;
  isAlreadyMarked?: boolean;
  totalSessionsConducted?: number;
  sessionsAttended?: number;
  sessionsMissed?: number;
  attendancePercentage?: number;
}

const AssignedActivitiesSection: React.FC<{
  activities: StudentAssignedActivity[];
  loading: boolean;
  onRefresh: () => void;
  onScanActivity: (activity: StudentAssignedActivity) => void;
}> = React.memo(({ activities, loading, onRefresh, onScanActivity }) => {
  const activeCount = useMemo(() => {
    return activities.filter((a) => a.hasActiveSession && !a.isAlreadyMarked).length;
  }, [activities]);

  const formatDate = (dateStr?: string | null) => {
    if (!dateStr) return null;
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="w-full">
      <div className="rounded-[24px] border border-slate-200/90 bg-white/90 p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 text-amber-600">
              <Award size={20} />
            </div>
            <div className="min-w-0 text-left">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                Cohorts & Workshops
              </p>
              <h3 className="text-sm font-bold tracking-tight text-slate-900">
                My Assigned Activities & Trainings
              </h3>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {activeCount > 0 && (
              <span className="flex items-center gap-1.5 rounded-full bg-rose-50 border border-rose-200 px-2.5 py-1 text-[11px] font-mono font-bold text-rose-600 shadow-2xs animate-pulse">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500" />
                </span>
                {activeCount} Live
              </span>
            )}
            {activities.length > 0 && (
              <span className="rounded-full bg-slate-100 border border-slate-200 px-2.5 py-0.5 text-xs font-bold text-slate-700 font-mono">
                {activities.length}
              </span>
            )}
            <button
              type="button"
              onClick={onRefresh}
              className="p-1 text-slate-400 hover:text-slate-600 transition cursor-pointer"
              title="Refresh activities"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {/* Content directly visible */}
        <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
            {loading && activities.length === 0 ? (
              <div className="space-y-3">
                {[1, 2].map((i) => (
                  <div key={i} className="animate-pulse rounded-2xl border border-slate-200/80 bg-slate-50 p-4 space-y-2">
                    <div className="h-4 w-3/4 rounded bg-slate-200" />
                    <div className="h-3 w-1/2 rounded bg-slate-200" />
                  </div>
                ))}
              </div>
            ) : activities.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center">
                <Award size={28} className="mx-auto mb-2 text-slate-300" />
                <p className="text-xs font-semibold text-slate-600">No activities currently assigned</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Trainings and event sessions for your section and batch will appear here.
                </p>
              </div>
            ) : (
              activities.map((act) => {
                const isTraining = act.type === "TRAINING";
                const isLive = Boolean(act.hasActiveSession && !act.isAlreadyMarked);
                const isMarked = Boolean(act.isAlreadyMarked);

                const eventDateFormatted = formatDate(act.event_date);
                const startDateFormatted = formatDate(act.start_date);
                const endDateFormatted = formatDate(act.end_date);
                const dateDisplay = isTraining
                  ? startDateFormatted && endDateFormatted
                    ? `${startDateFormatted} – ${endDateFormatted}`
                    : startDateFormatted || endDateFormatted || "Ongoing Training"
                  : eventDateFormatted || "Scheduled Event";

                return (
                  <div
                    key={act.id}
                    className={`relative overflow-hidden rounded-2xl border transition-all ${
                      isLive
                        ? "border-rose-300 bg-gradient-to-br from-rose-50/70 via-white to-orange-50/40 shadow-[0_4px_20px_-4px_rgba(244,63,94,0.18)] ring-1 ring-rose-400/40"
                        : "border-slate-200/90 bg-white hover:border-slate-300 shadow-2xs"
                    } p-4`}
                  >
                    {/* Top Row: Type Badge + Batch Tag + Live Indicator */}
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {/* Type Badge */}
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide border shadow-2xs ${
                            isTraining
                              ? "bg-amber-50 text-amber-800 border-amber-200"
                              : "bg-purple-50 text-purple-800 border-purple-200"
                          }`}
                        >
                          {isTraining ? <Award size={11} /> : <Calendar size={11} />}
                          {isTraining ? "Training" : "Event"}
                        </span>

                        {/* Batch Tag: department_code - [batch_number] */}
                        <span className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-0.5 text-[11px] font-mono font-bold text-white shadow-2xs">
                          <Users size={11} className="text-slate-300" />
                          {act.batchCode}
                        </span>

                        {act.assignedBatch?.batch_name && act.assignedBatch.batch_name !== "Default Batch" && (
                          <span className="text-[11px] text-slate-500 font-medium truncate max-w-[130px]" title={act.assignedBatch.batch_name}>
                            ({act.assignedBatch.batch_name})
                          </span>
                        )}
                      </div>

                      {/* Live or Marked Status Pill */}
                      {isLive && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-500 text-white px-2.5 py-0.5 text-[10px] font-black uppercase shadow-xs animate-pulse">
                          <span className="h-1.5 w-1.5 rounded-full bg-white animate-ping" />
                          ● LIVE
                        </span>
                      )}

                      {isMarked && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-[10px] font-bold">
                          <CheckCircle size={11} className="text-emerald-600" />
                          Present
                        </span>
                      )}
                    </div>

                    {/* Activity Name */}
                    <h4 className="text-sm font-extrabold text-slate-900 tracking-tight leading-snug">
                      {act.name}
                    </h4>

                    {/* Scheduled Date */}
                    <div className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500 font-medium">
                      <Clock size={12} className="text-slate-400 shrink-0" />
                      <span>{dateDisplay}</span>
                    </div>

                    {typeof act.totalSessionsConducted === "number" && act.totalSessionsConducted > 0 && (
                      <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                        <span className="text-slate-500 font-medium">
                          Attendance: <span className="font-bold text-slate-800">{act.sessionsAttended || 0}/{act.totalSessionsConducted}</span> sessions
                        </span>
                        <span className="font-bold font-mono text-indigo-600 bg-indigo-50 border border-indigo-200/60 px-2 py-0.5 rounded-full text-[11px]">
                          {act.attendancePercentage ?? 0}%
                        </span>
                      </div>
                    )}

                    {/* Live Action CTA: Tap to Scan & Mark Attendance */}
                    {isLive && (
                      <div className="mt-3 pt-3 border-t border-rose-100/80 flex items-center justify-between gap-3">
                        <div className="text-[11px] font-semibold text-rose-700 leading-tight">
                          Attendance session is currently active!
                        </div>
                        <button
                          type="button"
                          onPointerDown={() => void touchDownPrewarmFrontCamera()}
                          onTouchStart={() => void touchDownPrewarmFrontCamera()}
                          onClick={() => onScanActivity(act)}
                          className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-rose-600 via-rose-500 to-amber-500 px-4 py-2 text-xs font-extrabold text-white shadow-md shadow-rose-900/20 hover:brightness-110 active:scale-98 transition cursor-pointer"
                        >
                          <Camera size={14} />
                          <span>Scan QR</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
      </div>
    </div>
  );
});

function getFriendlyAttendanceMessage(result: any): {
  title: string;
  message: string;
  type: "error" | "location" | "face" | "expired" | "device";
} {
  const code = String(result?.code || "").toUpperCase();
  const rawMsg = String(result?.error || result?.message || "");
  const lowerMsg = rawMsg.toLowerCase();

  if (
    code === "ALREADY_MARKED" ||
    result?.already ||
    result?.alreadyMarked ||
    lowerMsg.includes("already marked") ||
    lowerMsg.includes("already recorded")
  ) {
    return {
      title: "Already Recorded",
      message: "Your attendance for this session was already recorded earlier.",
      type: "error",
    };
  }

  if (
    code === "OUT_OF_RANGE" ||
    lowerMsg.includes("out of range") ||
    lowerMsg.includes("distance") ||
    lowerMsg.includes("meters away")
  ) {
    return {
      title: "Outside Classroom Range",
      message: "You appear to be outside the classroom zone. Please move closer to your lecture room and try again.",
      type: "location",
    };
  }

  if (code === "LOCATION_ERROR" || lowerMsg.includes("location") || lowerMsg.includes("gps")) {
    return {
      title: "Location Check Failed",
      message: "We could not determine your accurate GPS location. Please turn on Location / GPS with High Accuracy and retry.",
      type: "location",
    };
  }

  if (
    code === "SESSION_EXPIRED" ||
    code === "SESSION_NOT_FOUND" ||
    lowerMsg.includes("session ended") ||
    lowerMsg.includes("session expired") ||
    lowerMsg.includes("session not found")
  ) {
    return {
      title: "Session Ended",
      message: "This attendance session has ended or is no longer accepting new scans.",
      type: "expired",
    };
  }

  if (
    code === "INVALID_QR" ||
    code === "QR_TIMEOUT" ||
    lowerMsg.includes("qr code expired") ||
    lowerMsg.includes("qr timeout") ||
    lowerMsg.includes("invalid qr")
  ) {
    return {
      title: "QR Code Expired",
      message: "The projected QR code rotates every few seconds. Please scan the current code displayed on the screen.",
      type: "expired",
    };
  }

  if (code === "FACE_MISMATCH" || lowerMsg.includes("face mismatch") || lowerMsg.includes("face verification failed")) {
    return {
      title: "Face Verification Failed",
      message: "Face did not match your registered profile photo. Make sure your face is well-lit and directly facing the camera.",
      type: "face",
    };
  }

  if (code === "DEVICE_MISMATCH" || lowerMsg.includes("device mismatch") || lowerMsg.includes("unrecognized device")) {
    return {
      title: "Unregistered Device",
      message: "This device is not linked to your student account. Please use your registered phone or request a device change.",
      type: "device",
    };
  }

  if (code === "RATE_LIMITED" || lowerMsg.includes("too many requests")) {
    const retrySec = result?.retryAfterSeconds || 5;
    return {
      title: "Please Slow Down",
      message: `Too many rapid scan attempts. Please wait ${retrySec} seconds before trying again.`,
      type: "error",
    };
  }

  if (code === "REQUEST_IN_FLIGHT" || lowerMsg.includes("in flight")) {
    return {
      title: "Check-in In Progress",
      message: "Your attendance submission is currently being processed. Please wait a moment.",
      type: "error",
    };
  }

  if (code === "ELIGIBILITY_MISMATCH" || lowerMsg.includes("not enrolled") || lowerMsg.includes("eligibility")) {
    return {
      title: "Not Enrolled",
      message: "You are not enrolled in this specific class, subject, or batch.",
      type: "error",
    };
  }

  if (code === "REMOVED_BY_FACULTY" || lowerMsg.includes("faculty")) {
    return {
      title: "Manual Faculty Action",
      message: "Your attendance was updated directly by the faculty.",
      type: "error",
    };
  }

  if (
    lowerMsg.includes("timeout") ||
    lowerMsg.includes("network") ||
    lowerMsg.includes("fetch") ||
    lowerMsg.includes("failed to fetch")
  ) {
    return {
      title: "Connection Issue",
      message: "Unable to reach the attendance server. Please check your internet connection and try again.",
      type: "error",
    };
  }

  return {
    title: "Attendance Unsuccessful",
    message:
      rawMsg.length > 0 && !rawMsg.includes("<") && rawMsg.length < 120
        ? rawMsg
        : "Could not record attendance. Please try scanning again.",
    type: "error",
  };
}

const StudentDashboard: React.FC = () => {
  const { currentUser, departments = [], fetchDepartments, logout } = useApp();

  const [scanStep, setScanStep] = useState<
    "IDLE" | "PREPARING" | "SCANNING" | "SUBMITTING" | "SUCCESS" | "ALREADY_MARKED" | "ERROR"
  >("IDLE");
  const [errorDetails, setErrorDetails] = useState<{
    title: string;
    message: string;
    type: "error" | "location" | "face" | "expired" | "device";
  }>({
    title: "Attendance Unsuccessful",
    message: "",
    type: "error",
  });
  const [statusMsg, setStatusMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [recentSessions, setRecentSessions] = useState<any[]>([]);
  const [profileModalTab, setProfileModalTab] = useState<"academics" | "activities" | "profile" | null>(null);
  const [todayPanelOpen, setTodayPanelOpen] = useState(false);
  const [todayPanelLoading, setTodayPanelLoading] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [isScannerActive, setIsScannerActive] = useState(false);
  const [scannerType, setScannerType] = useState<"DYNAMIC_PAIR" | null>(null);
  const [scannerError, setScannerError] = useState("");
  const [scannerHint, setScannerHint] = useState("");
  const [scannerStatusTone, setScannerStatusTone] = useState<"neutral" | "success" | "error">("neutral");
  const [locationReady, setLocationReady] = useState(false);
  const [faceGateOpen, setFaceGateOpen] = useState(false);
  const [faceGateStatus, setFaceGateStatus] = useState<"VERIFYING" | "MATCHING" | "FAILED">("VERIFYING");
  const [faceGateMessage, setFaceGateMessage] = useState("");
  const [liveFacePhoto, setLiveFacePhoto] = useState("");
  const [faceVerifiedUntil, setFaceVerifiedUntil] = useState(0);
  const [sessionExpiredToast, setSessionExpiredToast] = useState(false);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [studentActivities, setStudentActivities] = useState<StudentAssignedActivity[]>([]);
  const [studentActivitiesLoading, setStudentActivitiesLoading] = useState(true);

  const fetchStudentActivities = useCallback(async (silent = false) => {
    if (!silent) setStudentActivitiesLoading(true);
    try {
      const res: any = await apiClient.getStudentActivities();
      if (!mountedRef.current) return;
      if (res?.ok && Array.isArray(res.activities)) {
        setStudentActivities(res.activities);
      }
    } catch (err) {
      console.error("Failed to fetch student activities:", err);
    } finally {
      if (mountedRef.current && !silent) {
        setStudentActivitiesLoading(false);
      }
    }
  }, []);

  // Lazy-load student assigned activities only when user opens the activities tab
  useEffect(() => {
    if (profileModalTab === "activities") {
      void fetchStudentActivities();
    }
  }, [profileModalTab, fetchStudentActivities]);

  useEffect(() => {
    navigator.storage?.persisted?.().then((persisted) => {
      if (!persisted) setShowInstallBanner(true);
    });
  }, []);

  const mountedRef = useRef(true);
  const submitLockRef = useRef(false);
  const resetTimerRef = useRef<number | null>(null);
  const sessionExpiredToastTimerRef = useRef<number | null>(null);
  const loadingRecentRef = useRef(false);
  const gpsStopRef = useRef<(() => void) | null>(null);
  const cameraWarmupPromiseRef = useRef<Promise<void> | null>(null);
  const scannerResolveRef = useRef<((value: ScannerResult) => void) | null>(null);
  const sequentialQrBufferRef = useRef(createSequentialBuffer());
  const dynamicPairFirstTokenRef = useRef<string | null>(null);
  const dynamicPairFirstPayloadRef = useRef<DynamicQrPayload | null>(null);
  const dynamicPairFirstCapturedAtRef = useRef<number | null>(null);
  const dynamicPairLockedRef = useRef(false);
  const dynamicPairTimeoutRef = useRef<number | null>(null);
  const locationWarmupPromiseRef = useRef<Promise<any> | null>(null);
  const autoLaunchHandledRef = useRef(false);
  const pendingQrPairRef = useRef<DynamicPairScanResult | null>(null);
  const faceGateTimerRef = useRef<number | null>(null);
  const faceVerifiedUntilRef = useRef(0);
  const faceVerificationPayloadRef = useRef<{
    dataUrl?: string;
    faceVerification?: any;
  } | null>(null);
  const faceGrantTokenRef = useRef<string | null>(null);
  const faceGrantPromiseRef = useRef<Promise<any> | null>(null);

  const faceVerified = faceVerifiedUntil > Date.now();
  const registeredFacePhoto = useMemo(() => {
    const studentPhoto = String(
      currentUser?.studentProfilePhotoUrl ||
      currentUser?.student?.profilePhotoUrl ||
      currentUser?.studentPhotoUrl ||
      ""
    ).trim();
    if (studentPhoto && studentPhoto.length > 5) return studentPhoto;

    const raw = String(currentUser?.profile_photo_url || currentUser?.profilePhotoUrl || "").trim();
    if (raw && raw.length > 5) {
      return raw;
    }
    return "";
  }, [currentUser]);

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

  const studentCohortText = useMemo(() => {
    const sem = currentUser?.semester ?? 1;
    const sec = currentUser?.section || "A";
    const year = currentUser?.year;
    if (year) {
      return `Sem ${sem} · Sec ${sec} (Yr ${year})`;
    }
    return `Sem ${sem} · Sec ${sec}`;
  }, [currentUser?.semester, currentUser?.section, currentUser?.year]);

  // Derived live session status from already-loaded recentSessions and studentActivities
  const hasActiveLiveSession = useMemo(() => {
    const fromClasses = (recentSessions || []).some((s: any) => {
      const isActive = s?.isActive === true || s?.is_active === true;
      if (!isActive) return false;
      const isPresent = String(s?.status || "").toLowerCase() === "present" || s?.attendanceCode === "P";
      return !isPresent;
    });
    const fromActivities = (studentActivities || []).some(
      (act) => act.hasActiveSession && !act.isAlreadyMarked
    );
    return fromClasses || fromActivities;
  }, [recentSessions, studentActivities]);
  /**
   * Schedule a callback during browser idle time with a deadline fallback.
   * Uses requestIdleCallback when available (Chrome/Android), falls back
   * to setTimeout for Safari/iOS.
   */
  function scheduleIdle(callback: () => void, fallbackDelayMs: number): void {
    if (typeof requestIdleCallback !== "undefined") {
      requestIdleCallback(() => callback(), { timeout: fallbackDelayMs + 500 });
    } else {
      setTimeout(callback, fallbackDelayMs);
    }
  }

  useEffect(() => {
    mountedRef.current = true;

    // 1. EAGER COMPONENT PRELOAD: Preload LivePhotoCapture & CameraQrScanner immediately
    // so JS chunks are parsed and compiled in mobile RAM before student taps anything.
    void preloadCameraQrScanner();
    void preloadLivePhotoCapture();

    // 2. IMMEDIATE GPS WATCHER: Start rolling GPS watcher at t=0ms so location fix is ready within 60s window
    const stopGpsWatcher = startRollingGpsWatcher((_loc) => {
      if (mountedRef.current) setLocationReady(true);
    });
    gpsStopRef.current = stopGpsWatcher;

    // 3. IMMEDIATE WEBGL & MODEL PRE-WARMING: Warmup neural networks and WebGL shaders on mount
    void preloadForStudent(registeredFacePhoto);
    void prewarmMediaPipe();
    void prewarmQrCamera();

    // 4. Background permission query & department list sync
    scheduleIdle(() => {
      if (!mountedRef.current) return;
      if (typeof navigator !== "undefined" && navigator?.permissions?.query) {
        navigator.permissions.query({ name: "camera" as any }).catch(() => undefined);
      }
      if (!departments.length) {
        void fetchDepartments();
      }
    }, 1000);

    return () => {
      mountedRef.current = false;
      releasePrewarmedFrontStream();
      gpsStopRef.current?.();
      gpsStopRef.current = null;
      if (resetTimerRef.current) {
        window.clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
      if (faceGateTimerRef.current) window.clearTimeout(faceGateTimerRef.current);
      if (sessionExpiredToastTimerRef.current) {
        window.clearTimeout(sessionExpiredToastTimerRef.current);
        sessionExpiredToastTimerRef.current = null;
      }
    };
  }, [registeredFacePhoto]);

  const closeScanner = useCallback((value: ScannerResult) => {
    dynamicPairLockedRef.current = true;
    if (dynamicPairTimeoutRef.current) {
      window.clearTimeout(dynamicPairTimeoutRef.current);
      dynamicPairTimeoutRef.current = null;
    }
    dynamicPairFirstTokenRef.current = null;
    dynamicPairFirstPayloadRef.current = null;
    dynamicPairFirstCapturedAtRef.current = null;
    sequentialQrBufferRef.current.flush();
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
    faceVerifiedUntilRef.current = 0;
    setFaceVerifiedUntil(0);
    faceVerificationPayloadRef.current = null;
    faceGrantTokenRef.current = null;
    faceGrantPromiseRef.current = null;
    if (faceGateTimerRef.current) {
      window.clearTimeout(faceGateTimerRef.current);
      faceGateTimerRef.current = null;
    }

    if (scannerOpen) {
      closeScanner(null);
    }
    setFaceGateOpen(false);

    setScanStep("IDLE");
    setStatusMsg("");
    setBusy(false);
    submitLockRef.current = false;

    if (sessionExpiredToastTimerRef.current) {
      window.clearTimeout(sessionExpiredToastTimerRef.current);
    }
    setSessionExpiredToast(true);
    sessionExpiredToastTimerRef.current = window.setTimeout(() => {
      if (mountedRef.current) setSessionExpiredToast(false);
      sessionExpiredToastTimerRef.current = null;
    }, 3500);
  }, [scannerOpen, closeScanner]);

  const handleLiveFaceCaptured = useCallback((capture: {
    dataUrl: string;
    capturedAt: string;
    faceVerification?: { matched?: boolean; liveness?: string; score?: number; distance?: number };
    realityChecks?: any;
  }) => {
    if (!capture.faceVerification?.matched || capture.faceVerification.liveness !== "movement") {
      faceVerifiedUntilRef.current = 0;
      setFaceVerifiedUntil(0);
      faceVerificationPayloadRef.current = null;
      setFaceGateStatus("FAILED");
      setFaceGateMessage("Live face verification is required.");
      return;
    }

    const verifiedUntil = Date.now() + FACE_VERIFICATION_WINDOW_MS;
    faceVerifiedUntilRef.current = verifiedUntil;
    faceVerificationPayloadRef.current = {
      faceVerification: capture.faceVerification,
    };

    // Obtain cryptographically signed, short-lived face verification grant
    const fingerprint = getFingerprint();
    faceGrantTokenRef.current = null;
    faceGrantPromiseRef.current = apiClient
      .verifyFace({
        faceMatch: Boolean(capture.faceVerification?.matched),
        faceMetrics: capture.faceVerification,
        fingerprint,
      })
      .then((res: any) => {
        if (res?.ok && res?.faceGrantToken) {
          faceGrantTokenRef.current = String(res.faceGrantToken);
        }
        return res;
      })
      .catch(() => null);
    if (faceGateTimerRef.current) window.clearTimeout(faceGateTimerRef.current);
    setFaceVerifiedUntil(verifiedUntil);
    setFaceGateOpen(false);
    setLiveFacePhoto("");
    setFaceGateStatus("VERIFYING");
    setFaceGateMessage("");

    faceGateTimerRef.current = window.setTimeout(() => {
      if (!mountedRef.current) return;
      handleFaceSessionExpired();
    }, FACE_VERIFICATION_WINDOW_MS);

    // Give mobile OS 120ms to flush the front camera hardware before opening rear camera
    setStatusMsg("Step 2 of 2: Scan Classroom QR");
    setTimeout(() => {
      if (!mountedRef.current) return;
      void submitQrAttendance();
    }, 120);
  }, [handleFaceSessionExpired]);

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

  const openDynamicPairScanner = useCallback(async (): Promise<DynamicPairScanResult | null> => {
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
      setIsScannerActive(true);
      setScannerHint("Point at the Dynamic QR — it will capture automatically.");
      setScannerStatusTone("neutral");
      setScannerType("DYNAMIC_PAIR");
      setScannerError("");
      setScannerOpen(true);
    });
  }, []);

  useEffect(() => {
    if (!scannerOpen) return;
    setScannerError("");
    setScannerStatusTone("neutral");
  }, [scannerOpen]);

  const resetDynamicPairFirst = useCallback((raw: string, payload: DynamicQrPayload, hint: string) => {
    if (dynamicPairTimeoutRef.current) {
      window.clearTimeout(dynamicPairTimeoutRef.current);
    }

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

  const lastStudentDataFetchMs = useRef<number>(0);
  const STUDENT_DATA_FETCH_DEBOUNCE_MS = 30_000; // 30 seconds

  const loadStudentData = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && now - lastStudentDataFetchMs.current < STUDENT_DATA_FETCH_DEBOUNCE_MS) {
      return; // Skip — data is fresh enough
    }
    lastStudentDataFetchMs.current = now;

    if (loadingRecentRef.current) return;
    loadingRecentRef.current = true;

    try {
      const recentRes: any = await apiClient.getStudentTodayLiveAttendance();
      if (!mountedRef.current) return;

      if (recentRes?.ok && Array.isArray(recentRes.classes)) {
        setRecentSessions(recentRes.classes);
      }
    } catch {
      // Retain optimistic local state on background network error
    } finally {
      loadingRecentRef.current = false;
    }
  }, []);

  const openTodayPanel = useCallback(async () => {
    setTodayPanelOpen(true);
    setTodayPanelLoading(true);
    await loadStudentData(true);
    if (mountedRef.current) {
      setTodayPanelLoading(false);
    }
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
    // 1. Instant 0ms Fast Path from rolling attendance GPS cache (accurate fix <= 120m)
    const instant =
      getInstantCachedLocation(ATTENDANCE_GPS_MAX_AGE_MS) ||
      getInstantCachedLocation(DISPLAY_GPS_MAX_AGE_MS);
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

  const submitQrAttendance = useCallback(async () => {
    if (!faceVerifiedUntilRef.current || Date.now() > faceVerifiedUntilRef.current) {
      faceVerifiedUntilRef.current = 0;
      setFaceVerifiedUntil(0);
      setScanStep("ERROR");
      setStatusMsg("Face verification session expired. Please verify your live face again.");
      setBusy(false);
      return;
    }

    const pair = await openDynamicPairScanner();
    if (!pair) {
      pendingQrPairRef.current = null;
      setScanStep("IDLE");
      setStatusMsg("");
      setBusy(false);
      return;
    }

    // Double-check biometric window before finalizing network submission
    if (!faceVerifiedUntilRef.current || Date.now() > faceVerifiedUntilRef.current) {
      handleFaceSessionExpired();
      return;
    }

    const facePayload = faceVerificationPayloadRef.current;

    // Invalidate biometric session immediately upon single attendance mark attempt (anti-proxy protection)
    faceVerifiedUntilRef.current = 0;
    setFaceVerifiedUntil(0);
    faceVerificationPayloadRef.current = null;
    if (faceGateTimerRef.current) {
      window.clearTimeout(faceGateTimerRef.current);
      faceGateTimerRef.current = null;
    }

    pendingQrPairRef.current = pair;
    setScanStep("SUBMITTING");
    setStatusMsg("QR captured. Getting your GPS location...");
    setBusy(true);

    try {
      let coords: any = null;
      try {
        coords = await resolveLiveLocation();
        setStatusMsg("GPS locked ✓  Sending to server...");
      } catch (locErr: any) {
        pendingQrPairRef.current = null;
        setScanStep("ERROR");
        try { navigator.vibrate?.(400); } catch {}
        setStatusMsg(
          locErr?.message || "GPS location is required to verify your presence in class."
        );
        return;
      }
      const fingerprint = getFingerprint();

      // Resolve face grant token if still in flight
      let faceGrantToken = faceGrantTokenRef.current;
      if (!faceGrantToken && faceGrantPromiseRef.current) {
        try {
          const grantRes = await Promise.race([
            faceGrantPromiseRef.current,
            new Promise((resolve) => setTimeout(() => resolve(null), 2500)),
          ]);
          if (grantRes?.ok && grantRes?.faceGrantToken) {
            faceGrantToken = String(grantRes.faceGrantToken);
          }
        } catch {}
      }
      faceGrantTokenRef.current = null;
      faceGrantPromiseRef.current = null;

      // Execute attendance submit with 12s fast timeout
      const submitPromise = (async () => {
        if (pendingQrPairRef.current?.kind === "totp") {
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
            faceGrantToken,
            faceVerification: facePayload?.faceVerification,
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
            facePayload?.faceVerification || null,
            faceGrantToken
          );
        }
      })();

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Server response timed out. Please scan again.")), 9000)
      );

      let result: any = null;
      try {
        result = await Promise.race([submitPromise, timeoutPromise]);
      } catch (err: any) {
        result = { ok: false, error: err?.message || "Failed to submit attendance" };
      }

      const isSuccess = Boolean(result?.ok);
      const isAlreadyMarked = Boolean(
        result?.already ||
        result?.alreadyMarked ||
        String(result?.error || result?.message || "").toLowerCase().includes("already marked")
      );

      if (isSuccess || isAlreadyMarked) {
        const targetSessionId =
          pendingQrPairRef.current?.kind === "totp"
            ? pendingQrPairRef.current.sequence?.[0]?.classId || (pendingQrPairRef.current.sequence?.[0] as any)?.sessionId
            : pendingQrPairRef.current?.kind === "legacy"
              ? decodeDynamicQrPayload(pendingQrPairRef.current.first)?.sessionId
              : null;

        pendingQrPairRef.current = null;
        if (isAlreadyMarked) {
          setScanStep("ALREADY_MARKED");
          setStatusMsg("Attendance already recorded for this session");
        } else {
          setScanStep("SUCCESS");
          setStatusMsg("Attendance confirmed ✓");
        }
        try { navigator.vibrate?.([80, 40, 160]); } catch {}
        playSuccessChime();

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
        lastStudentDataFetchMs.current = 0;
        void loadStudentData().catch(() => {});
        void fetchStudentActivities(true).catch(() => {});

        if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
        resetTimerRef.current = window.setTimeout(() => {
          if (!mountedRef.current) return;
          setScanStep("IDLE");
          setStatusMsg("");
        }, 4000);
        return;
      }

      // Map raw response into friendly, actionable user message
      const friendly = getFriendlyAttendanceMessage(result);
      setErrorDetails(friendly);
      setScanStep("ERROR");
      try { navigator.vibrate?.(400); } catch {}
      setStatusMsg(friendly.message);
    } finally {
      // ALWAYS unlock the UI so student can immediately retry or scan again
      setBusy(false);
    }
  }, [
    handleFaceSessionExpired,
    loadStudentData,
    openDynamicPairScanner,
    resolveLiveLocation,
  ]);

  const handleStartAttendance = useCallback(() => {
    if (busy) return;

    if (!registeredFacePhoto || registeredFacePhoto.length < 5) {
      setScanStep("ERROR");
      setErrorDetails({
        title: "Face Profile Missing",
        message: "No registered face photo found on your account. Please contact your college administrator to upload your official photo.",
        type: "face",
      });
      setStatusMsg("No registered face photo found on your account. Please contact your college administrator to upload your official photo.");
      return;
    }

    // If biometric verification is already valid within the 15s window, jump straight to QR
    if (faceVerifiedUntilRef.current && Date.now() < faceVerifiedUntilRef.current) {
      void submitQrAttendance();
      return;
    }

    // Step 1: Open Face Gate Modal first (Only front camera is requested)
    setFaceGateStatus("VERIFYING");
    setFaceGateMessage("Looking for your face...");
    setLiveFacePhoto("");
    setFaceGateOpen(true);
    setScanStep("SCANNING");
    setStatusMsg("Step 1 of 2: Face Verification");

    // Warm up GPS location only — NEVER prewarm rear camera while front camera is starting!
    void warmLocation();
  }, [busy, registeredFacePhoto, submitQrAttendance, warmLocation]);

  const simulateScan = useCallback(() => {
    handleStartAttendance();
  }, [handleStartAttendance]);

  useEffect(() => {
    autoLaunchHandledRef.current = true;
  }, []);

  const resetScan = () => {
    setScanStep("IDLE");
    setStatusMsg("");
    setErrorDetails({
      title: "Attendance Unsuccessful",
      message: "",
      type: "error",
    });
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
    <div className="relative min-h-screen w-full overflow-x-hidden selection:bg-emerald-500 selection:text-white">
      <div className="relative z-10 mx-auto min-h-screen max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {showInstallBanner && (
        <div className="mx-0 mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-center gap-3 text-sm shadow-sm">
          <span>📲</span>
          <div>
            <p className="font-semibold text-amber-900">Install SmartAttend for secure login</p>
            <p className="text-xs text-amber-700/80 mt-0.5">
              Tap the browser menu → "Add to Home Screen" to protect your session.
            </p>
          </div>
          <button
            onClick={() => setShowInstallBanner(false)}
            className="ml-auto shrink-0 rounded-lg p-1 text-amber-500 hover:bg-amber-100 hover:text-amber-700 transition"
          >
            <X size={14} />
          </button>
        </div>
      )}

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

      {/* Step 1: Face Verification Gate Modal (Directional Liveness + Face Matching) */}
      {faceGateOpen && (
        <div className="fixed inset-0 z-[65] flex items-center justify-center bg-slate-950/85 p-3 backdrop-blur-sm sm:p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md overflow-hidden rounded-[24px] border border-slate-700/80 bg-slate-950 p-4 shadow-2xl text-white">
            <div className="flex items-center justify-between mb-3 border-b border-slate-800 pb-2.5">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-teal-500/20 text-teal-400">
                  <Camera size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Step 1: Face Verification</h3>
                  <p className="text-[11px] text-slate-400">Follow the directional head movement</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setFaceGateOpen(false);
                  setScanStep("IDLE");
                  setStatusMsg("");
                  setBusy(false);
                  releasePrewarmedFrontStream();
                }}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
                title="Cancel"
              >
                <X size={16} />
              </button>
            </div>

            <React.Suspense
              fallback={
                <div className="flex h-64 items-center justify-center text-slate-400 text-sm">
                  <LoaderCircle size={24} className="animate-spin text-teal-500 mr-2" />
                  Loading camera & models...
                </div>
              }
            >
              <LivePhotoCapture
                value={liveFacePhoto}
                onChange={setLiveFacePhoto}
                onCaptured={handleLiveFaceCaptured}
                autoStart={true}
                autoCapture={true}
                hideLauncher={true}
                compactMode={true}
                title="Live Liveness & Identity Check"
                description="Hold camera at eye level and follow the directional prompt"
                faceVerificationReferenceUrl={registeredFacePhoto}
              />
            </React.Suspense>
          </div>
        </div>
      )}

      {/* Step 2: Camera QR Scanner with 15s Countdown Overlay */}
      {scannerOpen && (
        <>
          {faceVerified && faceVerifiedUntil > Date.now() && (
            <FaceVerificationProgressBar
              expiresAt={faceVerifiedUntil}
              totalDurationMs={FACE_VERIFICATION_WINDOW_MS}
              onExpire={handleFaceSessionExpired}
            />
          )}
          <React.Suspense
            fallback={
              <div className="fixed inset-0 z-[70] bg-black/85 backdrop-blur-[2px] flex items-center justify-center text-white text-sm">
                <LoaderCircle size={28} className="animate-spin text-cyan-400 mr-2" />
                Opening camera scanner...
              </div>
            }
          >
            <CameraQrScanner
            title="Step 2: Scan Classroom QR"
            hint={scannerHint}
            statusTone={scannerStatusTone}
            isScannerActive={scannerOpen}
            faceVerifiedExpiresAt={faceVerifiedUntil}
            onSessionExpired={handleFaceSessionExpired}
            onDetected={(rawValue) => {
              const totpPayload = parseQrPayload(rawValue);
              if (totpPayload) {
                const status = sequentialQrBufferRef.current.addBlock(totpPayload);
                if (status === "duplicate") {
                  setScannerStatusTone("neutral");
                  setScannerHint("Block captured ✓ Hold steady for next rotation...");
                  return false;
                }
                if (status === "ready") {
                  const sequence = sequentialQrBufferRef.current.getPayloads();
                  closeScanner({ sequence });
                  return true;
                }
                setScannerStatusTone("success");
                setScannerHint("Block 1 of 2 captured ✓ Next rotation in 1s...");
                return false;
              }

              // Single QR fallback
              if (rawValue && rawValue.length > 20) {
                closeScanner(rawValue);
                return true;
              }

              return false;
            }}
            onCancel={() => {
              closeScanner(null);
              setScanStep("IDLE");
              setStatusMsg("");
              setBusy(false);
            }}
          />
        </React.Suspense>
        </>
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
        onOpenAcademicAttendance={() => setProfileModalTab("academics")}
        onOpenActivities={() => setProfileModalTab("activities")}
        onOpenProfileModal={(tab) => setProfileModalTab(tab === "activities" ? "activities" : "academics")}
      />

      <div className="mx-auto mb-4 relative flex min-h-[340px] w-full max-w-lg flex-col justify-between rounded-[24px] border border-slate-800 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-900 p-5 sm:p-7 text-white shadow-[0_24px_50px_-20px_rgba(15,23,42,0.85)]">
        {/* 4-Step Progress Stepper */}
        <div className="mb-4 w-full border-b border-slate-800/80 pb-3" aria-label="Attendance marking steps">
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-400">
            {/* Step 1: Face Check */}
            <div className="flex items-center gap-1.5">
              <div
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold transition-colors ${
                  faceVerified
                    ? "bg-emerald-500 text-slate-950"
                    : faceGateOpen
                    ? "bg-teal-500 text-white animate-pulse"
                    : "bg-slate-800 text-slate-400"
                }`}
              >
                {faceVerified ? "✓" : "1"}
              </div>
              <span className={faceVerified ? "text-emerald-400 font-semibold" : faceGateOpen ? "text-teal-300 font-semibold" : "text-slate-400"}>
                Face
              </span>
            </div>

            <div className="h-[1px] flex-1 mx-2 bg-slate-800" />

            {/* Step 2: Scan QR */}
            <div className="flex items-center gap-1.5">
              <div
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold transition-colors ${
                  scanStep === "SUBMITTING" || scanStep === "SUCCESS" || scanStep === "ALREADY_MARKED"
                    ? "bg-emerald-500 text-slate-950"
                    : scannerOpen
                    ? "bg-cyan-500 text-white animate-pulse"
                    : "bg-slate-800 text-slate-400"
                }`}
              >
                {scanStep === "SUBMITTING" || scanStep === "SUCCESS" || scanStep === "ALREADY_MARKED" ? "✓" : "2"}
              </div>
              <span className={scanStep === "SUBMITTING" || scanStep === "SUCCESS" || scanStep === "ALREADY_MARKED" ? "text-emerald-400 font-semibold" : scannerOpen ? "text-cyan-300 font-semibold" : "text-slate-400"}>
                QR
              </span>
            </div>

            <div className="h-[1px] flex-1 mx-2 bg-slate-800" />

            {/* Step 3: Location */}
            <div className="flex items-center gap-1.5">
              <div
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold transition-colors ${
                  scanStep === "SUCCESS" || scanStep === "ALREADY_MARKED"
                    ? "bg-emerald-500 text-slate-950"
                    : scanStep === "SUBMITTING"
                    ? "bg-teal-500 text-white animate-pulse"
                    : locationReady
                    ? "bg-emerald-950 text-emerald-400 border border-emerald-500/40"
                    : "bg-slate-800 text-slate-400"
                }`}
              >
                {scanStep === "SUCCESS" || scanStep === "ALREADY_MARKED" ? "✓" : "3"}
              </div>
              <span className={scanStep === "SUCCESS" || scanStep === "ALREADY_MARKED" ? "text-emerald-400 font-semibold" : scanStep === "SUBMITTING" ? "text-teal-300 font-semibold" : "text-slate-400"}>
                GPS
              </span>
            </div>

            <div className="h-[1px] flex-1 mx-2 bg-slate-800" />

            {/* Step 4: Marked */}
            <div className="flex items-center gap-1.5">
              <div
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold transition-colors ${
                  scanStep === "SUCCESS" || scanStep === "ALREADY_MARKED"
                    ? "bg-emerald-500 text-slate-950"
                    : "bg-slate-800 text-slate-400"
                }`}
              >
                {scanStep === "SUCCESS" || scanStep === "ALREADY_MARKED" ? "✓" : "4"}
              </div>
              <span className={scanStep === "SUCCESS" || scanStep === "ALREADY_MARKED" ? "text-emerald-400 font-semibold" : "text-slate-400"}>
                Marked
              </span>
            </div>
          </div>
        </div>

        {/* State Card Contents */}
        {scanStep === "IDLE" && (
          <div className="w-full text-center my-auto py-2">
            {hasActiveLiveSession && (
              <div className="absolute top-4 right-4 sm:top-5 sm:right-5 z-10">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-950/80 border border-rose-500/50 px-3 py-1 text-xs font-mono font-extrabold text-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.35)] animate-pulse">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500" />
                  </span>
                  ● LIVE
                </span>
              </div>
            )}
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-800/80 text-cyan-400 border border-slate-700/60 shadow-inner">
              <Scan size={36} />
            </div>
            <div className="flex items-center justify-center gap-2 mb-1.5">
              <h2 className="text-2xl font-bold tracking-tight text-white">Mark Attendance</h2>
              {hasActiveLiveSession && (
                <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/20 border border-rose-500/40 px-2 py-0.5 text-[10px] font-black text-rose-400 animate-pulse">
                  ● LIVE
                </span>
              )}
            </div>
            <p className="text-slate-300 text-xs sm:text-sm mb-4 leading-relaxed max-w-sm mx-auto">
              Verify your face with directional liveness, then scan the rotating classroom QR.
            </p>

            {faceVerified && faceVerifiedUntil > Date.now() ? (
              <div className="mb-4 inline-flex items-center gap-2 rounded-xl bg-emerald-950/70 border border-emerald-500/50 px-3.5 py-1.5 text-xs text-emerald-300 font-medium">
                <ShieldCheck size={16} className="text-emerald-400" />
                Face verified • Ready to scan QR
              </div>
            ) : (
              <div className="mb-4 flex flex-wrap items-center justify-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em]">
                <span className="rounded-full border border-slate-700 bg-slate-800/80 px-3 py-1 text-slate-300">
                  Liveness Check
                </span>
                <span
                  className={`rounded-full border px-3 py-1 ${
                    locationReady
                      ? "border-emerald-500/50 bg-emerald-950/60 text-emerald-300"
                      : "border-slate-700 bg-slate-800/80 text-slate-300"
                  }`}
                >
                  GPS {locationReady ? "Ready ✓" : "Warming"}
                </span>
              </div>
            )}

            <Button
              onPointerDown={() => void touchDownPrewarmFrontCamera()}
              onTouchStart={() => void touchDownPrewarmFrontCamera()}
              onClick={() => void handleStartAttendance()}
              className="bg-teal-600 hover:bg-teal-500 active:bg-teal-700 w-full py-3.5 text-base sm:text-lg font-bold text-white shadow-lg shadow-teal-950/50 rounded-xl cursor-pointer flex items-center justify-center gap-2 transition disabled:opacity-60"
              disabled={busy}
            >
              <Camera size={20} />
              {faceVerified && faceVerifiedUntil > Date.now() ? "Scan Classroom QR" : "Start Verification"}
            </Button>
          </div>
        )}

        {scanStep === "PREPARING" && (
          <div className="w-full text-center my-auto py-4">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-950/60 text-teal-400 border border-teal-500/40 animate-pulse">
              <LoaderCircle size={36} className="animate-spin text-teal-400" />
            </div>
            <h3 className="text-lg font-bold tracking-tight text-white">Getting Ready</h3>
            <p className="text-xs text-slate-300 mt-2 max-w-xs mx-auto">
              {statusMsg || "Preparing camera and checking live GPS coordinates..."}
            </p>
          </div>
        )}

        {scanStep === "SCANNING" && (
          <div className="w-full text-center my-auto py-4">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-cyan-950/60 text-cyan-400 border border-cyan-500/40">
              <Scan size={36} className="animate-pulse" />
            </div>
            <h2 className="text-xl font-bold tracking-tight text-white">Scan Classroom QR</h2>
            <p className="text-slate-300 text-xs sm:text-sm mb-2 mt-1">
              Point your camera steadily at the projector screen.
            </p>
            {statusMsg && <p className="text-xs text-cyan-300/80 mt-2 leading-relaxed">{statusMsg}</p>}
          </div>
        )}

        {scanStep === "SUBMITTING" && (
          <div className="w-full text-center my-auto py-4">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-950/60 text-teal-400 border border-teal-500/40">
              <LoaderCircle size={36} className="animate-spin text-teal-400" />
            </div>
            <h2 className="text-xl font-bold tracking-tight text-white">Verifying Attendance</h2>
            <p className="text-slate-300 text-xs sm:text-sm mt-1 max-w-xs mx-auto">
              {statusMsg || "Validating cryptographic token, device integrity, and location..."}
            </p>
            <div className="mt-4 flex justify-center">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-800 px-3 py-1 text-[11px] text-slate-300">
                <span className="h-1.5 w-1.5 rounded-full bg-teal-400 animate-ping" />
                Processing request...
              </span>
            </div>
          </div>
        )}

        {scanStep === "SUCCESS" && (
          <div className="w-full text-center my-auto py-2">
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: [1.2, 1.0], opacity: 1 }}
              transition={{ type: "spring", duration: 0.5 }}
              className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-950/70 text-emerald-400 border border-emerald-500/50 shadow-[0_0_25px_rgba(16,185,129,0.35)]"
            >
              <CheckCircle2 size={38} />
            </motion.div>
            <h2 className="text-2xl font-bold tracking-tight text-white">Attendance Marked!</h2>
            <p className="text-emerald-300 bg-emerald-950/60 border border-emerald-500/30 rounded-lg px-3.5 py-2.5 mt-3 text-xs sm:text-sm max-w-sm mx-auto">
              {statusMsg || "Your attendance was verified and recorded successfully."}
            </p>
            <Button
              onClick={() => {
                if (resetTimerRef.current) {
                  window.clearTimeout(resetTimerRef.current);
                  resetTimerRef.current = null;
                }
                resetScan();
              }}
              variant="secondary"
              className="mt-5 w-full max-w-xs mx-auto bg-white text-slate-900 border-none hover:bg-slate-100 font-bold cursor-pointer py-2.5 rounded-xl transition"
            >
              Done
            </Button>
          </div>
        )}

        {scanStep === "ALREADY_MARKED" && (
          <div className="w-full text-center my-auto py-2">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.3 }}
              className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-950/60 text-amber-400 border border-amber-500/40 shadow-[0_0_20px_rgba(245,158,11,0.25)]"
            >
              <CheckCircle2 size={38} />
            </motion.div>
            <h2 className="text-2xl font-bold tracking-tight text-white">Already Recorded</h2>
            <p className="text-amber-200 bg-amber-950/60 border border-amber-500/30 rounded-lg px-3.5 py-2.5 mt-3 text-xs sm:text-sm max-w-sm mx-auto">
              {statusMsg || "Your attendance for this session was previously recorded. No further action is required."}
            </p>
            <Button
              onClick={() => {
                if (resetTimerRef.current) {
                  window.clearTimeout(resetTimerRef.current);
                  resetTimerRef.current = null;
                }
                resetScan();
              }}
              variant="secondary"
              className="mt-5 w-full max-w-xs mx-auto bg-white text-slate-900 border-none hover:bg-slate-100 font-bold cursor-pointer py-2.5 rounded-xl transition"
            >
              Done
            </Button>
          </div>
        )}

        {scanStep === "ERROR" && (
          <div className="w-full text-center my-auto py-2">
            <div
              className={`mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border ${
                errorDetails.type === "location"
                  ? "bg-amber-950/60 text-amber-400 border-amber-500/40"
                  : errorDetails.type === "expired"
                  ? "bg-amber-950/60 text-amber-400 border-amber-500/40"
                  : "bg-rose-950/60 text-rose-400 border-rose-500/40"
              }`}
            >
              {errorDetails.type === "location" ? (
                <MapPin size={34} />
              ) : errorDetails.type === "face" ? (
                <Camera size={34} />
              ) : errorDetails.type === "expired" ? (
                <Clock size={34} />
              ) : errorDetails.type === "device" ? (
                <Smartphone size={34} />
              ) : (
                <XCircle size={34} />
              )}
            </div>
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
              {errorDetails.title || "Attendance Unsuccessful"}
            </h2>
            <div
              className={`rounded-lg px-3.5 py-2.5 mt-3 text-xs sm:text-sm max-w-sm mx-auto border ${
                errorDetails.type === "location" || errorDetails.type === "expired"
                  ? "bg-amber-950/60 border-amber-500/30 text-amber-200"
                  : "bg-rose-950/60 border-rose-500/30 text-rose-200"
              }`}
            >
              <p className="leading-relaxed">{errorDetails.message || statusMsg || "An error occurred during submission."}</p>
            </div>
            <div className="mt-5 flex justify-center">
              <Button
                onClick={resetScan}
                disabled={busy}
                variant="secondary"
                className="w-full max-w-xs bg-white text-slate-900 border-none hover:bg-slate-100 font-bold cursor-pointer py-2.5 rounded-xl transition disabled:opacity-50"
              >
                Try Again
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Today's Attendance Quick Access Button ── */}
      <div className="mx-auto mb-6 flex w-full max-w-lg items-center justify-center">
        <div
          onClick={openTodayPanel}
          className="group relative flex w-full items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900 px-5 py-3.5 text-white shadow-[0_18px_42px_-28px_rgba(15,23,42,0.8)] transition hover:-translate-y-0.5 hover:bg-slate-800/90 cursor-pointer"
        >
          <div className="flex items-center gap-3 text-left">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-800 text-cyan-400 border border-slate-700/60 shadow-inner group-hover:bg-slate-700 transition">
              <History size={20} />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Today's Records</p>
              <p className="text-sm font-bold tracking-tight text-white">View Attendance</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            {recentSessions.length > 0 && (
              <span className="rounded-full bg-slate-800 px-2.5 py-1 text-xs font-mono font-bold text-slate-300 border border-slate-700/50">
                {todayAttendanceSummary.total} {todayAttendanceSummary.total === 1 ? "class" : "classes"}
              </span>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void openTodayPanel();
              }}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-700/70 bg-slate-800/80 text-slate-400 hover:text-cyan-300 hover:bg-slate-700 transition cursor-pointer"
              title="Refresh today's records"
            >
              <RefreshCw size={13} className={todayPanelLoading || loadingRecentRef.current ? "animate-spin text-cyan-400" : ""} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Today's Attendance Lower-Side Popup Sheet ── */}
      {todayPanelOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[65] flex items-end justify-center bg-slate-950/55 p-3 backdrop-blur-sm sm:items-center sm:p-4 animate-in fade-in duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget) setTodayPanelOpen(false);
          }}
        >
          <div className="max-h-[86vh] w-full max-w-lg overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_28px_90px_-36px_rgba(15,23,42,0.65)] flex flex-col">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5 bg-slate-50/80">
              <div className="flex min-w-0 items-center gap-2.5 font-bold tracking-tight text-slate-900">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-teal-50 border border-teal-200/80 text-teal-700">
                  <Calendar size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 leading-tight">Today's Attendance</h3>
                  <p className="text-[11px] font-medium text-slate-400">
                    {new Date().toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void loadStudentData(true)}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 hover:bg-slate-100 transition cursor-pointer"
                  title="Refresh"
                >
                  <RefreshCw size={14} className={loadingRecentRef.current ? "animate-spin text-teal-600" : ""} />
                </button>
                <button
                  type="button"
                  onClick={() => setTodayPanelOpen(false)}
                  aria-label="Close today's attendance"
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 hover:bg-slate-100 transition cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="max-h-[calc(86vh-64px)] overflow-y-auto p-4">
              {todayPanelLoading ? (
                <div className="flex min-h-[220px] flex-col items-center justify-center text-center">
                  <LoaderCircle size={28} className="animate-spin text-teal-600" />
                  <p className="mt-3 text-sm font-semibold text-slate-800">Fetching today's attendance...</p>
                </div>
              ) : (
                <>
                  <div className="mb-3.5 flex flex-wrap items-center gap-2 text-xs font-semibold">
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-0.5 text-emerald-700 font-mono">
                      {todayAttendanceSummary.present} Present
                    </span>
                    <span className="rounded-full border border-rose-200 bg-rose-50 px-3 py-0.5 text-rose-700 font-mono">
                      {todayAttendanceSummary.absent} Absent
                    </span>
                    <span className="ml-auto text-[11px] font-medium text-slate-400 font-mono">
                      {todayAttendanceSummary.total} class{todayAttendanceSummary.total === 1 ? "" : "es"}
                    </span>
                  </div>

                  {todaysClasses.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 py-9 text-center text-slate-500">
                      <Clock size={28} className="mx-auto mb-2 text-slate-300" />
                      <p className="text-xs font-semibold text-slate-600">No classes recorded yet today</p>
                      <p className="mt-0.5 text-[11px] text-slate-400">Class sessions will appear here as faculty begins sessions.</p>
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
                      <div className="grid grid-cols-[minmax(0,1fr)_minmax(72px,0.8fr)_56px] bg-slate-900 px-3.5 py-2.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-200">
                        <span>Subject</span>
                        <span>Time</span>
                        <span className="text-center">Status</span>
                      </div>
                      <div className="divide-y divide-slate-100">
                        {todaysClasses.map((record) => {
                          const time = new Date(record.startTime).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          });
                          const isPresent = record.attendanceCode === "P";

                          return (
                            <div
                              key={record.sessionId}
                              className="grid grid-cols-[minmax(0,1fr)_minmax(72px,0.8fr)_56px] items-center px-3.5 py-2.5 text-xs transition hover:bg-slate-50/60"
                            >
                              <div className="min-w-0 pr-2">
                                <div className="flex items-center gap-1.5">
                                  <span className="truncate font-mono font-bold text-slate-900">
                                    {record.subjectCode}
                                  </span>
                                  {record.isActive ? (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 border border-rose-200 px-1.5 py-0.5 text-[9px] font-extrabold text-rose-600 uppercase animate-pulse">
                                      Live
                                    </span>
                                  ) : null}
                                </div>
                                <p className="mt-0.5 truncate text-[11px] text-slate-500">
                                  {record.subjectName} · {record.facultyName}
                                </p>
                              </div>

                              <div className="min-w-0">
                                <span className="font-mono text-slate-700 font-medium">{time}</span>
                              </div>

                              <div className="flex justify-center">
                                <span
                                  className={`inline-flex items-center justify-center rounded-lg px-2.5 py-1 text-xs font-black font-mono shadow-2xs ${
                                    isPresent
                                      ? "bg-emerald-500 text-white border border-emerald-600"
                                      : "bg-rose-500 text-white border border-rose-600"
                                  }`}
                                >
                                  {record.attendanceCode}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Screen-Centered Modal for Academic Attendance & Activities ── */}
      {profileModalTab !== null && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/65 p-3 sm:p-6 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget) setProfileModalTab(null);
          }}
        >
          <div className="max-h-[88vh] w-full max-w-lg flex flex-col rounded-[26px] border border-slate-200 bg-white shadow-[0_28px_90px_-36px_rgba(15,23,42,0.65)] overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5 bg-slate-50/80">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-2xl bg-indigo-600 text-white font-bold flex items-center justify-center text-sm shadow-sm overflow-hidden shrink-0">
                  {currentUser?.profilePhotoUrl || currentUser?.studentProfilePhotoUrl ? (
                    <img
                      src={currentUser?.studentProfilePhotoUrl || currentUser?.profilePhotoUrl}
                      alt="Profile"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    currentUser?.name?.slice(0, 2).toUpperCase() || "ST"
                  )}
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-slate-900 leading-tight truncate">
                    {currentUser?.name || "Student Records"}
                  </h3>
                  <p className="text-[11px] font-mono text-slate-500 truncate">
                    {currentUser?.enrollmentNo || "USN"} · {studentCohortText}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setProfileModalTab(null)}
                aria-label="Close modal"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 hover:bg-slate-100 transition cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Segmented Tab Navigation: Strictly Academics & Activities */}
            <div className="px-4 pt-2.5 pb-2 bg-white border-b border-slate-100 flex gap-2">
              <button
                type="button"
                onClick={() => setProfileModalTab("academics")}
                className={`flex-1 py-2 px-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                  profileModalTab === "academics"
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                <BookOpen size={14} />
                <span>Academic Attendance</span>
              </button>
              <button
                type="button"
                onClick={() => setProfileModalTab("activities")}
                className={`flex-1 py-2 px-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                  profileModalTab === "activities"
                    ? "bg-purple-600 text-white shadow-xs"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                <Award size={14} />
                <span>Activities & Events</span>
                {studentActivities.length > 0 && (
                  <span className="rounded-full bg-purple-100 text-purple-800 px-1.5 py-0.2 text-[10px] font-mono">
                    {studentActivities.length}
                  </span>
                )}
              </button>
            </div>

            {/* Modal Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {profileModalTab === "academics" && (
                <div className="space-y-3">
                  <MyAttendanceCard />
                </div>
              )}

              {profileModalTab === "activities" && (
                <div className="space-y-3">
                  <AssignedActivitiesSection
                    activities={studentActivities}
                    loading={studentActivitiesLoading}
                    onRefresh={() => void fetchStudentActivities(false)}
                    onScanActivity={() => {
                      setProfileModalTab(null);
                      void handleStartAttendance();
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
  );
};

export default StudentDashboard;
