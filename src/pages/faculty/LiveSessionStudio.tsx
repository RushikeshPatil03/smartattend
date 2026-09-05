import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import QRCode from "react-qr-code";
import {
  Users,
  Clock,
  Maximize2,
  Minimize2,
  Square,
  UserPlus,
  Trash2,
  ShieldCheck,
  Sparkles,
  CheckCircle2,
  Radio,
  XCircle,
  Search,
  Check,
  UserX,
  UserCheck,
  Download,
  AlertTriangle,
  ShieldAlert,
} from "lucide-react";
import { Button, CountUp } from "../../components/Common";
import { LiveAttendanceItem } from "./types";
import {
  startQrPolling,
  serializeQrPayload,
  generateRotatingQrPayload,
  RotatingQrPayload,
} from "../../utils/totpQrGenerator";
import apiClient from "../../services/apiClient";

interface LiveSessionStudioProps {
  activeSession: any;
  sessionSecretKey?: string | null;
  totalClassStrength?: number;
  liveAttendance: LiveAttendanceItem[];
  attendanceStatusMap: Record<string, "present" | "absent">;
  attendanceDataLoaded?: boolean;
  attendeesLoading?: boolean;
  manualLoading: boolean;
  manualEnrollment: string;
  setManualEnrollment: (val: string) => void;
  onLoadAttendees: (includeDerived?: boolean) => Promise<void>;
  onManualAttendance: (status: "present" | "absent", enrollmentNo?: string) => Promise<void>;
  onToggleAttendanceItem?: (item: any) => Promise<void>;
  onStopSession: () => Promise<void>;
  onCancelSession: () => Promise<void>;
  onDisconnectRealtime?: () => void;
  selectedSubject?: any;
  selectedDepartment?: any;
}

// ---------------------------------------------------------------------------
// Self-Contained Leaf Dynamic QR Engine
// Encapsulates 100% of the 2-second TOTP generation in browser memory.
// Changes to currentToken only re-render this leaf component, causing 0 re-renders
// in LiveSessionStudio or root FacultyDashboard.
// ---------------------------------------------------------------------------
interface IsolatedRotatingQrEngineProps {
  sessionId: string;
  sessionSecretKey?: string | null;
  classCode?: string;
  isActive: boolean;
  size?: number;
  isProjector?: boolean;
}

interface AttendanceProgressRingProps {
  percentage: number;
  size?: number;
  strokeWidth?: number;
}

export const AttendanceProgressRing: React.FC<AttendanceProgressRingProps> = React.memo(({
  percentage,
  size = 56,
  strokeWidth = 4,
}) => {
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const validPct = Math.min(100, Math.max(0, isNaN(percentage) ? 0 : percentage));
  const offset = circumference - (validPct / 100) * circumference;

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg className="h-full w-full -rotate-90 transform" viewBox={`0 0 ${size} ${size}`}>
        {/* Background track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          className="stroke-slate-800"
          strokeWidth={strokeWidth}
          fill="none"
        />
        {/* Animated Progress Arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="url(#emeraldGradient)"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          fill="none"
          className="transition-all duration-500 ease-out"
        />
        <defs>
          <linearGradient id="emeraldGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#10B981" />
            <stop offset="100%" stopColor="#34D399" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center font-mono leading-none">
        <span className="text-xs font-black text-emerald-400">{Math.round(validPct)}%</span>
      </div>
    </div>
  );
});
AttendanceProgressRing.displayName = "AttendanceProgressRing";

interface AttendanceDonutChartProps {
  presentCount: number;
  absentCount: number;
  totalCount: number;
  percentage: number;
}

export const AttendanceDonutChart: React.FC<AttendanceDonutChartProps> = React.memo(({
  presentCount,
  absentCount,
  totalCount,
  percentage,
}) => {
  const radius = 70;
  const strokeWidth = 16;
  const circumference = 2 * Math.PI * radius; // ~439.82297

  const denominator = Math.max(totalCount, presentCount + absentCount, 1);
  const presentRatio = Math.min(1, Math.max(0, presentCount / denominator));
  const absentRatio = Math.min(1 - presentRatio, Math.max(0, absentCount / denominator));

  // Present strokeDashoffset: how much of the ring is covered by present arc
  const presentOffset = circumference * (1 - presentRatio);

  // Absent segment starting after present arc
  const absentLength = circumference * absentRatio;

  const isQuorumMet = percentage >= 75;

  return (
    <div className="flex flex-col items-center justify-center p-2">
      <div className="relative flex items-center justify-center w-60 h-60">
        {/* Glow ambient circle */}
        <div
          className={`absolute inset-4 rounded-full blur-3xl opacity-30 transition-all duration-700 ${
            isQuorumMet ? "bg-emerald-500 shadow-[0_0_50px_rgba(16,185,129,0.3)]" : "bg-rose-500 shadow-[0_0_50px_rgba(244,63,94,0.3)]"
          }`}
        />

        <svg className="h-full w-full -rotate-90 transform overflow-visible" viewBox="0 0 200 200">
          <defs>
            {/* Linear Gradients */}
            <linearGradient id="modernPresentGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#10b981" />
              <stop offset="100%" stopColor="#2dd4bf" />
            </linearGradient>
            <linearGradient id="modernAbsentGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#f43f5e" />
              <stop offset="100%" stopColor="#e11d48" />
            </linearGradient>

            {/* Neon Glow Drop Shadows */}
            <filter id="emeraldGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#10b981" floodOpacity="0.45" />
            </filter>
            <filter id="roseGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#f43f5e" floodOpacity="0.45" />
            </filter>
          </defs>

          {/* Background Track Circle with frosted track */}
          <circle
            cx={100}
            cy={100}
            r={radius}
            stroke="rgba(241, 245, 249, 0.85)"
            strokeWidth={strokeWidth}
            fill="none"
          />

          {/* Absent Arc with Round End Caps & Neon Glow */}
          {absentRatio > 0 && (
            <circle
              cx={100}
              cy={100}
              r={radius}
              stroke="url(#modernAbsentGrad)"
              strokeWidth={strokeWidth}
              strokeDasharray={`${absentLength} ${circumference}`}
              strokeDashoffset={-circumference * presentRatio}
              strokeLinecap="round"
              fill="none"
              filter="url(#roseGlow)"
              className="transition-all duration-700 ease-out"
            />
          )}

          {/* Present Arc with Round End Caps & Neon Glow */}
          {presentRatio > 0 && (
            <circle
              cx={100}
              cy={100}
              r={radius}
              stroke="url(#modernPresentGrad)"
              strokeWidth={strokeWidth}
              strokeDasharray={circumference}
              strokeDashoffset={presentOffset}
              strokeLinecap="round"
              fill="none"
              filter="url(#emeraldGlow)"
              className="transition-all duration-700 ease-out"
            />
          )}
        </svg>

        {/* Circular Frosted Glass Center Hub Overlay */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-28 h-28 rounded-full backdrop-blur-md bg-white/80 border border-white/90 shadow-lg flex flex-col items-center justify-center text-center">
            <span className="text-2xl font-black font-mono text-slate-900 tracking-tight leading-none">
              <CountUp value={percentage} suffix="%" />
            </span>
            <span className="text-[9px] font-extrabold tracking-widest text-slate-400 uppercase mt-1">
              ATTENDED
            </span>
          </div>
        </div>
      </div>

      {/* Dynamic Quorum Status Badge */}
      <div className="mt-2 text-center">
        {isQuorumMet ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-300/80 px-3.5 py-1 text-xs font-extrabold text-emerald-800 shadow-[0_0_12px_rgba(16,185,129,0.2)]">
            <CheckCircle2 size={13} className="text-emerald-600" />
            ✓ Safe Quorum (≥75%)
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 border border-rose-300/80 px-3.5 py-1 text-xs font-extrabold text-rose-800 shadow-[0_0_12px_rgba(244,63,94,0.2)]">
            <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" />
            ⚠ Below Target Threshold (&lt;75%)
          </span>
        )}
      </div>
    </div>
  );
});
AttendanceDonutChart.displayName = "AttendanceDonutChart";

interface LinearTotpCountdownBarProps {
  progressPercent: number;
  timeLeft: number;
  isProjector?: boolean;
}

export const LinearTotpCountdownBar: React.FC<LinearTotpCountdownBarProps> = React.memo(({
  progressPercent,
  timeLeft,
  isProjector = false,
}) => {
  const validPct = Math.min(100, Math.max(0, progressPercent));

  return (
    <div className={`w-full ${isProjector ? "max-w-[460px]" : "max-w-[330px]"}`}>
      {/* Top Text Row (matches image: [dot] Rotating Token (2s) ... 2s) */}
      <div className={`flex items-center justify-between font-mono text-xs font-semibold tracking-tight ${
        isProjector ? "text-emerald-400" : "text-emerald-700"
      }`}>
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
          <span className={isProjector ? "text-emerald-300 font-bold" : "text-emerald-800 font-bold"}>
            Rotating Token (2s)
          </span>
        </div>
        <span className={isProjector ? "text-slate-300 font-mono text-xs font-semibold" : "text-slate-600 font-mono text-xs font-semibold"}>
          {timeLeft}s
        </span>
      </div>

      {/* Modern Slim Line Progress Bar (exactly matching the user screenshot) */}
      <div className={`mt-2 h-2.5 w-full overflow-hidden rounded-full ${
        isProjector ? "bg-slate-800 border border-slate-700/80" : "bg-slate-100 border border-slate-200/80"
      } shadow-inner`}>
        <div
          className="h-full rounded-full bg-[#059669] transition-all duration-100 ease-linear shadow-[0_0_8px_rgba(5,150,105,0.4)]"
          style={{ width: `${validPct}%` }}
        />
      </div>
    </div>
  );
});
LinearTotpCountdownBar.displayName = "LinearTotpCountdownBar";

interface RecentCheckInsTickerProps {
  items: Array<{
    enrollmentNo: string;
    name: string;
    photoUrl?: string;
    timestamp?: any;
  }>;
  variant?: "compact" | "projector";
}

export const RecentCheckInsTicker: React.FC<RecentCheckInsTickerProps> = React.memo(({
  items,
  variant = "compact",
}) => {
  if (!items.length) return null;

  return (
    <div className="w-full">
      <div className="flex items-center justify-between pb-2">
        <span className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-400 uppercase tracking-wider">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
          Recent Arrivals ({items.length})
        </span>
        <span className="font-mono text-[10px] text-slate-400">Live verified</span>
      </div>

      <div className="flex flex-wrap gap-2 sm:gap-2.5">
        <AnimatePresence initial={false}>
          {items.slice(0, 5).map((student, idx) => (
            <motion.div
              key={student.enrollmentNo}
              layout
              initial={{ opacity: 0, scale: 0.85, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.85, y: 8 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className={`flex items-center gap-2 rounded-2xl border px-3 py-1.5 backdrop-blur-xl shadow-sm ${
                variant === "projector"
                  ? "border-emerald-500/30 bg-slate-900/80 text-slate-200"
                  : "border-emerald-200/80 bg-emerald-50/70 text-slate-800"
              }`}
            >
              {/* Avatar / Initial Fallback */}
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-white border border-slate-200/80 overflow-hidden shadow-2xs">
                {student.photoUrl ? (
                  <img src={student.photoUrl} alt={student.name} className="h-full w-full object-cover" />
                ) : (
                  <span className="font-black text-[11px] text-slate-700">
                    {student.name.slice(0, 1).toUpperCase()}
                  </span>
                )}
              </div>

              {/* Student details */}
              <div className="min-w-0 pr-1">
                <p className="truncate text-xs font-bold leading-tight max-w-[120px]">{student.name}</p>
                <div className="flex items-center gap-1.5 font-mono text-[10px] leading-tight text-slate-500">
                  <span className="truncate">{student.enrollmentNo}</span>
                  <span>•</span>
                  <span className="text-emerald-700 font-semibold">
                    {idx === 0 ? "Just now" : "Verified"}
                  </span>
                </div>
              </div>

              {/* Face Verified Green Badge */}
              <div className="flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[9px] font-black text-emerald-700 shrink-0">
                <Check size={10} className="stroke-[3]" />
                <span className="hidden sm:inline">Face Verified</span>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
});
RecentCheckInsTicker.displayName = "RecentCheckInsTicker";

const IsolatedRotatingQrEngine: React.FC<IsolatedRotatingQrEngineProps> = React.memo(({
  sessionId,
  sessionSecretKey,
  classCode = "",
  isActive,
  size = 300,
  isProjector = false,
}) => {
  const [currentToken, setCurrentToken] = useState<string>("");
  const [timeLeft, setTimeLeft] = useState<number>(2);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const secretKeyRef = useRef<string | null>(sessionSecretKey || null);
  const prevTokenRef = useRef<string>("");

  useEffect(() => {
    if (sessionSecretKey) {
      secretKeyRef.current = sessionSecretKey;
    }
  }, [sessionSecretKey]);

  useEffect(() => {
    if (!isActive || !sessionId) return;
    let cancelled = false;
    let stopPolling: (() => void) | null = null;

    const initEngine = async () => {
      try {
        let key = secretKeyRef.current;
        if (!key) {
          const res: any = await apiClient.getLiveQR(sessionId);
          if (cancelled) return;
          if (res?.ok && res.secretKey) {
            key = res.secretKey;
            secretKeyRef.current = key;
          }
        }

        if (!key || cancelled) return;

        // 1. Generate immediate synchronous 1st payload on frame 0
        const payload = generateRotatingQrPayload(
          key,
          sessionId,
          classCode || ""
        );
        const serialized = serializeQrPayload(payload);
        setCurrentToken(serialized);
        prevTokenRef.current = serialized;

        // 2. Start dedicated 2000ms client-side TOTP engine in memory
        stopPolling = startQrPolling(
          key,
          sessionId,
          classCode || "",
          (newPayload: RotatingQrPayload) => {
            if (!cancelled) {
              const nextSerialized = serializeQrPayload(newPayload);
              if (nextSerialized !== prevTokenRef.current) {
                prevTokenRef.current = nextSerialized;
                setCurrentToken(nextSerialized);
              }
            }
          },
          2000
        );
      } catch (err) {
        console.error("Isolated TOTP Engine init error:", err);
      }
    };

    initEngine();

    return () => {
      cancelled = true;
      if (stopPolling) {
        stopPolling();
        stopPolling = null;
      }
    };
  }, [sessionId, sessionSecretKey, classCode, isActive]);

  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(() => {
      const msIntoCurrentBlock = Date.now() % 2000;
      const remainingSec = Math.ceil((2000 - msIntoCurrentBlock) / 1000);
      const pct = (msIntoCurrentBlock / 2000) * 100;
      setTimeLeft(remainingSec);
      setProgressPercent(pct);
    }, 100);
    return () => clearInterval(interval);
  }, [isActive]);

  if (!isActive) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center text-slate-400">
        <p className="text-sm font-semibold">QR Code Generator Inactive</p>
      </div>
    );
  }

  if (!currentToken) {
    return (
      <div
        style={{ width: size, height: size }}
        className="flex flex-col items-center justify-center rounded-2xl border border-slate-700/60 bg-slate-900/60 p-4"
      >
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
        <span className="mt-3 font-mono text-xs text-slate-400">Initializing QR Key...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center">
      <div
        className={`rounded-2xl border-4 border-white bg-white p-4 shadow-2xl transition duration-200 ${
          isProjector ? "ring-8 ring-emerald-500/20 shadow-[0_0_60px_rgba(16,185,129,0.35)]" : "shadow-[0_0_30px_rgba(0,0,0,0.3)]"
        }`}
      >
        <QRCode
          value={currentToken}
          size={size}
          level="M"
          className="h-auto max-w-full"
        />
      </div>

      {/* Modern Clean Linear Countdown Bar (matches exact line type timer) */}
      <div className={`mt-5 w-full flex justify-center ${isProjector ? "max-w-[420px]" : "max-w-[330px]"}`}>
        <LinearTotpCountdownBar
          progressPercent={progressPercent}
          timeLeft={timeLeft}
          isProjector={isProjector}
        />
      </div>
    </div>
  );
});
IsolatedRotatingQrEngine.displayName = "IsolatedRotatingQrEngine";

export const LiveSessionStudio: React.FC<LiveSessionStudioProps> = React.memo(({
  activeSession,
  sessionSecretKey,
  totalClassStrength,
  liveAttendance,
  attendanceStatusMap,
  manualLoading,
  manualEnrollment,
  setManualEnrollment,
  onLoadAttendees,
  onManualAttendance,
  onStopSession,
  onCancelSession,
  onDisconnectRealtime,
  selectedSubject,
  selectedDepartment,
}) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isReviewMode, setIsReviewMode] = useState(false);
  const [reviewTab, setReviewTab] = useState<"present" | "absent">("present");
  const [searchQuery, setSearchQuery] = useState("");
  const [liveSearchQuery, setLiveSearchQuery] = useState("");
  const [isCancelling, setIsCancelling] = useState(false);
  const [stoppingSession, setStoppingSession] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [atRiskStudents, setAtRiskStudents] = useState<any[]>([]);
  const [atRiskLoading, setAtRiskLoading] = useState(false);
  const fullscreenContainerRef = useRef<HTMLDivElement | null>(null);

  const sessionId = String(activeSession?.id || activeSession?._id || "");
  const classCode = String(selectedSubject?.code || selectedSubject?.name || sessionId).slice(0, 12);
  const effectiveTotalStudents = Number(
    totalClassStrength ||
    activeSession?.totalStudents ||
    activeSession?.totalStrength ||
    0
  );

  // Auto-sync roster on mount or session change
  useEffect(() => {
    setIsReviewMode(false);
    setShowCancelConfirm(false);
    onLoadAttendees(true);
  }, [sessionId, onLoadAttendees]);

  // Fullscreen listeners
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setIsFullscreen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isFullscreen) {
        closeFullscreen();
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isFullscreen]);

  // Mission Control Active Elapsed Timer (HH:MM:SS)
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

  useEffect(() => {
    if (!activeSession?.startTime || isReviewMode) return;
    const startMs = new Date(activeSession.startTime).getTime();
    if (isNaN(startMs)) return;

    const updateTimer = () => {
      const now = Date.now();
      const diffSec = Math.max(0, Math.floor((now - startMs) / 1000));
      setElapsedSeconds(diffSec);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [activeSession?.startTime, isReviewMode]);

  const formattedElapsed = useMemo(() => {
    const hrs = Math.floor(elapsedSeconds / 3600);
    const mins = Math.floor((elapsedSeconds % 3600) / 60);
    const secs = elapsedSeconds % 60;
    return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }, [elapsedSeconds]);

  const openFullscreen = async () => {
    setIsFullscreen(true);
    setTimeout(async () => {
      try {
        if (fullscreenContainerRef.current?.requestFullscreen) {
          await fullscreenContainerRef.current.requestFullscreen();
        }
      } catch {
        // Fallback to state-based fullscreen
      }
    }, 10);
  };

  const closeFullscreen = async () => {
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        // Ignore exit errors
      }
    }
    setIsFullscreen(false);
  };

  // Normalized Present Students List (Sorted by newest check-in first)
  const presentList = useMemo(() => {
    const map = new Map<string, {
      rawItem: any;
      student: any;
      enrollmentNo: string;
      name: string;
      photoUrl: string;
      status: "present";
      timestamp?: any;
    }>();

    (liveAttendance || []).forEach((item: any) => {
      const student = item?.student || {};
      const enrollmentNo = String(student.enrollmentNo || item?.enrollmentNo || "").trim();
      if (!enrollmentNo) return;
      const currentStatus =
        attendanceStatusMap[enrollmentNo] ||
        (String(item?.status || "").toLowerCase() === "present" ? "present" : "absent");

      if (currentStatus === "present") {
        map.set(enrollmentNo, {
          rawItem: item,
          student,
          enrollmentNo,
          name: student.name || item?.name || "Student",
          photoUrl: student.profilePhotoUrl || item?.profilePhotoUrl || "",
          status: "present",
          timestamp: item?.timestamp || item?.markedAt || Date.now(),
        });
      }
    });

    return Array.from(map.values()).sort((a, b) => {
      const timeA = new Date(a.timestamp || 0).getTime();
      const timeB = new Date(b.timestamp || 0).getTime();
      return timeB - timeA;
    });
  }, [liveAttendance, attendanceStatusMap]);

  // Normalized Absent Students List (Sorted alphabetically by enrollment number)
  const absentList = useMemo(() => {
    const map = new Map<string, {
      rawItem: any;
      student: any;
      enrollmentNo: string;
      name: string;
      photoUrl: string;
      status: "absent";
    }>();

    (liveAttendance || []).forEach((item: any) => {
      const student = item?.student || {};
      const enrollmentNo = String(student.enrollmentNo || item?.enrollmentNo || "").trim();
      if (!enrollmentNo) return;
      const currentStatus =
        attendanceStatusMap[enrollmentNo] ||
        (String(item?.status || "").toLowerCase() === "present" ? "present" : "absent");

      if (currentStatus === "absent") {
        map.set(enrollmentNo, {
          rawItem: item,
          student,
          enrollmentNo,
          name: student.name || item?.name || "Student",
          photoUrl: student.profilePhotoUrl || item?.profilePhotoUrl || "",
          status: "absent",
        });
      }
    });

    return Array.from(map.values()).sort((a, b) =>
      a.enrollmentNo.localeCompare(b.enrollmentNo)
    );
  }, [liveAttendance, attendanceStatusMap]);

  const presentCount = presentList.length;
  const absentCount = absentList.length;
  const totalCalculated = presentCount + absentCount;
  const totalCount = Math.max(effectiveTotalStudents, totalCalculated);

  const attendancePercentage = useMemo(() => {
    if (totalCount <= 0) return "0.0";
    const pct = (presentCount / totalCount) * 100;
    return pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(1);
  }, [presentCount, totalCount]);

  const formattedStartTime = useMemo(() => {
    if (!activeSession?.startTime) return "-";
    return new Date(activeSession.startTime).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }, [activeSession?.startTime]);

  // Handle Stop Session -> Immediately stop session on server (stops QR generation and student scanning) and enter Review Mode with full roster
  const handleEnterReviewMode = async () => {
    if (stoppingSession) return;

    // Immediate Realtime WebSocket Disconnect on Stop:
    // Synchronously unsubscribe WebSocket channel, cancel pending timers & clear queue buffers
    // so attendee list freezes in memory with zero background socket re-renders
    if (onDisconnectRealtime) {
      onDisconnectRealtime();
    }

    setStoppingSession(true);
    setShowCancelConfirm(false);

    // Non-blocking concurrent background fetch for At-Risk (<75%) students in this subject
    const subjectId = String(selectedSubject?.id || selectedSubject?._id || activeSession?.subject || "");
    if (subjectId) {
      setAtRiskLoading(true);
      apiClient.getFacultySubjectAnalytics(subjectId, {
        classCode: activeSession?.classCode || undefined
      })
      .then((res: any) => {
        if (res?.ok && Array.isArray(res.students)) {
          // Filter strictly below 75% who have attended at least 1 class
          const below75 = res.students
            .filter((s: any) => Number(s.totalClasses || 0) > 0 && Number(s.attendancePercentage || 0) < 75)
            .sort((a: any, b: any) => Number(a.attendancePercentage) - Number(b.attendancePercentage))
            .slice(0, 5);
          setAtRiskStudents(below75);
        }
      })
      .catch((err) => console.warn("At-risk analytics fetch skipped:", err))
      .finally(() => setAtRiskLoading(false));
    }

    try {
      await apiClient.stopSession(sessionId);
      setIsReviewMode(true);
      await onLoadAttendees(true);
    } catch (err) {
      console.error("Stop session error:", err);
      setIsReviewMode(true);
      await onLoadAttendees(true);
    } finally {
      setStoppingSession(false);
    }
  };

  // Immediate, non-blocking Cancel Session execution
  const handleConfirmCancel = async () => {
    if (isCancelling) return;
    setIsCancelling(true);
    try {
      await onCancelSession();
    } finally {
      setIsCancelling(false);
      setShowCancelConfirm(false);
      setIsReviewMode(false);
    }
  };

  // Filtered lists by search query
  const filteredPresentList = useMemo(() => {
    if (!searchQuery.trim()) return presentList;
    const q = searchQuery.toLowerCase().trim();
    return presentList.filter(
      (s) => s.name.toLowerCase().includes(q) || s.enrollmentNo.toLowerCase().includes(q)
    );
  }, [presentList, searchQuery]);

  const filteredAbsentList = useMemo(() => {
    if (!searchQuery.trim()) return absentList;
    const q = searchQuery.toLowerCase().trim();
    return absentList.filter(
      (s) => s.name.toLowerCase().includes(q) || s.enrollmentNo.toLowerCase().includes(q)
    );
  }, [absentList, searchQuery]);

  // Review Mode Absent Candidates for Quick Auto-Add by last 3 digits, USN, or name
  const reviewCandidateMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return absentList.filter((s) => {
      const en = s.enrollmentNo.toLowerCase();
      const nm = s.name.toLowerCase();
      return en.endsWith(q) || en.includes(q) || nm.includes(q);
    });
  }, [absentList, searchQuery]);

  // Review Mode Search KeyDown: Auto-add student if query matches 1 absent student or exact match
  const handleReviewSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (reviewCandidateMatches.length === 1) {
        const target = reviewCandidateMatches[0];
        onManualAttendance("present", target.enrollmentNo);
        setSearchQuery("");
      } else if (reviewCandidateMatches.length > 1) {
        const exact = reviewCandidateMatches.find(
          (s) => s.enrollmentNo.toLowerCase() === searchQuery.trim().toLowerCase()
        );
        if (exact) {
          onManualAttendance("present", exact.enrollmentNo);
          setSearchQuery("");
        }
      }
    }
  };

  // Mode A Live Stream Filtered Presentees
  const filteredLivePresentList = useMemo(() => {
    if (!liveSearchQuery.trim()) return presentList;
    const q = liveSearchQuery.toLowerCase().trim();
    return presentList.filter(
      (s) => s.name.toLowerCase().includes(q) || s.enrollmentNo.toLowerCase().includes(q)
    );
  }, [presentList, liveSearchQuery]);

  // Mode A Absent Candidates for Quick Auto-Add by last 3 digits or characters
  const absentCandidateMatches = useMemo(() => {
    const q = liveSearchQuery.trim().toLowerCase();
    if (!q) return [];
    return absentList.filter((s) => {
      const en = s.enrollmentNo.toLowerCase();
      const nm = s.name.toLowerCase();
      return en.endsWith(q) || en.includes(q) || nm.includes(q);
    });
  }, [absentList, liveSearchQuery]);

  // Mode A Search KeyDown: Auto-add student if query uniquely matches 1 absent student or exact match
  const handleLiveSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (absentCandidateMatches.length === 1) {
        const studentToAdd = absentCandidateMatches[0];
        onManualAttendance("present", studentToAdd.enrollmentNo);
        setLiveSearchQuery("");
      } else if (absentCandidateMatches.length > 1) {
        const exact = absentCandidateMatches.find(
          (s) => s.enrollmentNo.toLowerCase() === liveSearchQuery.trim().toLowerCase()
        );
        if (exact) {
          onManualAttendance("present", exact.enrollmentNo);
          setLiveSearchQuery("");
        }
      }
    }
  };

  // CSV Export Handler for Review Screen
  const handleExportCsv = () => {
    const lines: string[] = [];
    lines.push("Enrollment No,Student Name,Status,Verified At");

    presentList.forEach((s) => {
      const timeStr = s.timestamp ? new Date(s.timestamp).toLocaleTimeString() : "Verified";
      lines.push(`"${s.enrollmentNo}","${s.name.replace(/"/g, '""')}","Present","${timeStr}"`);
    });

    absentList.forEach((s) => {
      lines.push(`"${s.enrollmentNo}","${s.name.replace(/"/g, '""')}","Absent","-"`);
    });

    const csvContent = lines.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeCode = (selectedSubject?.code || "Session").replace(/[^a-zA-Z0-9_-]/g, "_");
    const dateStr = new Date().toISOString().slice(0, 10);
    link.setAttribute("href", url);
    link.setAttribute("download", `Attendance_${safeCode}_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const reviewDurationText = useMemo(() => {
    const mins = Math.floor(elapsedSeconds / 60);
    const secs = elapsedSeconds % 60;
    if (mins === 0) return `${secs}s`;
    return `${mins}m ${secs}s`;
  }, [elapsedSeconds]);

  return (
    <div className="space-y-6">
      {/* Fullscreen Ambient Projector HUD */}
      {isFullscreen && (
        <div
          ref={fullscreenContainerRef}
          className="fixed inset-0 z-[100] flex flex-col justify-between overflow-y-auto bg-[#070b14] p-6 sm:p-8 text-slate-100 selection:bg-emerald-500 selection:text-white"
        >
          {/* Ambient Glows */}
          <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
            <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[750px] h-[750px] rounded-full bg-[radial-gradient(circle,rgba(16,185,129,0.22)_0%,rgba(99,102,241,0.12)_45%,transparent_70%)] blur-3xl" />
            <div
              className="absolute inset-0 opacity-[0.04]"
              style={{
                backgroundImage: `radial-gradient(rgba(255, 255, 255, 0.5) 1px, transparent 1px)`,
                backgroundSize: "32px 32px",
              }}
            />
          </div>

          {/* Projector Top Bar: Executive Mission Control HUD */}
          <div className="relative z-10 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-800/90 bg-slate-900/80 px-6 py-4 backdrop-blur-2xl shadow-2xl">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.3)]">
                <Radio className="h-6 w-6 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-2.5">
                  <span className="text-xl font-black text-white tracking-tight">
                    {selectedSubject?.name || "Class Session"}
                  </span>
                  <span className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-0.5 text-xs font-mono font-bold text-emerald-300">
                    {selectedSubject?.code || "LIVE"}
                  </span>
                </div>
                <p className="text-xs text-slate-400 font-medium mt-0.5">
                  {selectedDepartment?.name || "Department"} • Section {activeSession?.section || "A"} • Started {formattedStartTime}
                </p>
              </div>
            </div>

            {/* Middle: Live Beacon Pill with Elapsed HH:MM:SS */}
            <div className="flex items-center gap-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-950/60 px-4 py-1.5 shadow-[0_0_15px_rgba(16,185,129,0.2)]">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                </span>
                <span className="font-mono text-xs font-extrabold uppercase tracking-wider text-emerald-300">
                  LIVE
                </span>
                <span className="text-slate-600">|</span>
                <span className="font-mono text-xs font-bold text-emerald-200">
                  {formattedElapsed}
                </span>
              </div>
            </div>

            {/* Right: Circular Progress Ring, Counter & Exit Button */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3.5 rounded-2xl border border-slate-700/80 bg-slate-800/70 px-4 py-2 shadow-inner">
                <AttendanceProgressRing
                  percentage={Number(attendancePercentage) || 0}
                  size={46}
                  strokeWidth={4}
                />
                <div className="text-left">
                  <div className="font-mono text-lg font-black text-emerald-400 flex items-center gap-1.5">
                    <Users size={16} />
                    <span>
                      {presentCount}
                      {effectiveTotalStudents > 0 ? ` / ${effectiveTotalStudents}` : ""} Present
                    </span>
                  </div>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
                    {effectiveTotalStudents > 0 ? `${attendancePercentage}% of class attended` : "Live attendees"}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={closeFullscreen}
                className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/90 px-4 py-2.5 text-xs font-bold text-slate-200 hover:bg-slate-700 hover:text-white transition duration-150 cursor-pointer shadow-sm active:scale-95"
                title="Exit projector mode (ESC)"
              >
                <Minimize2 size={16} /> Exit Projector
              </button>
            </div>
          </div>

          {/* Projector Main QR Stage */}
          <div className="relative z-10 my-auto flex flex-col items-center justify-center py-6">
            <div className="relative rounded-[36px] border border-emerald-500/40 bg-slate-900/90 p-8 sm:p-10 shadow-[0_0_80px_rgba(16,185,129,0.25)] backdrop-blur-2xl">
              <IsolatedRotatingQrEngine
                sessionId={sessionId}
                sessionSecretKey={sessionSecretKey}
                classCode={classCode}
                isActive={!isReviewMode}
                size={460}
                isProjector={true}
              />

              <div className="mt-6 text-center">
                <p className="text-xs font-bold uppercase tracking-widest text-emerald-400 flex items-center justify-center gap-1.5">
                  <Sparkles size={14} /> Scan with SmartAttend Mobile App
                </p>
                <p className="mt-1 font-mono text-[11px] text-slate-400">
                  Rotating Dynamic QR Token (2s cycle) • Protected by Classroom Geofence
                </p>
              </div>
            </div>
          </div>

          {/* Projector Live Arrivals Ticker */}
          {presentList.length > 0 && (
            <div className="relative z-10 my-2 w-full max-w-4xl mx-auto">
              <RecentCheckInsTicker
                items={presentList}
                variant="projector"
              />
            </div>
          )}

          {/* Projector Footer Ticker */}
          <div className="relative z-10 flex items-center justify-between border-t border-slate-800/80 pt-4 text-xs text-slate-400">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
              <span>Broadcasting Live Attendance via Supabase Realtime • End-to-End Encrypted</span>
            </div>
            <div className="font-mono text-slate-500 flex items-center gap-2">
              <span>Press <kbd className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">ESC</kbd> or click Exit to return</span>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODE B: SESSION STOPPED / REVIEW & FINALIZE ATTENDANCE (FULL-WIDTH 100%) */}
      {/* ========================================================================= */}
      {isReviewMode ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          {/* Top Review Control Bar - Executive Header */}
          <div className="rounded-[32px] border border-white/85 bg-white/90 p-6 sm:p-8 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.06)] backdrop-blur-2xl">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              {/* Left Context */}
              <div className="flex items-center gap-3.5">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-700 shadow-sm">
                  <ShieldCheck className="h-6 w-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 py-0.5 text-[11px] font-extrabold text-rose-700 uppercase tracking-wider shadow-2xs">
                      <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                      Session Locked • QR Inactive
                    </span>
                    <span className="font-mono text-xs text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200">
                      ID: {sessionId.slice(-8)}
                    </span>
                  </div>
                  <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight mt-1">
                    Attendance Final Review & Audit
                  </h2>
                  <p className="text-xs text-slate-500 font-medium mt-0.5">
                    {selectedSubject?.name || "Subject"} ({selectedSubject?.code || "Code"}) • Sec {activeSession?.section || "A"} • Year {activeSession?.year || "-"} Sem {activeSession?.semester || "-"}
                  </p>
                </div>
              </div>

              {/* Right Uprights: Cancel Session & Instant Save Attendance */}
              <div className="flex items-center gap-3">
                {showCancelConfirm ? (
                  <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 rounded-2xl px-3.5 py-2 animate-in fade-in">
                    <span className="text-xs font-bold text-rose-800">Discard session?</span>
                    <button
                      type="button"
                      disabled={isCancelling}
                      onClick={handleConfirmCancel}
                      className="inline-flex items-center gap-1 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold text-xs px-3 py-1.5 rounded-xl cursor-pointer transition shadow-sm"
                    >
                      {isCancelling ? "Cancelling..." : "Yes, Discard"}
                    </button>
                    <button
                      type="button"
                      disabled={isCancelling}
                      onClick={() => setShowCancelConfirm(false)}
                      className="text-xs font-semibold px-2.5 py-1.5 text-slate-600 hover:bg-slate-200/60 rounded-xl cursor-pointer transition"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={isCancelling}
                    onClick={() => setShowCancelConfirm(true)}
                    className="inline-flex items-center gap-1.5 rounded-2xl border border-rose-200 bg-rose-50/60 px-4 py-3 text-xs font-bold text-rose-700 hover:bg-rose-100/80 transition cursor-pointer disabled:opacity-50"
                  >
                    <XCircle size={15} />
                    Cancel Session
                  </button>
                )}

                <motion.button
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={onStopSession}
                  disabled={isCancelling}
                  className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 px-7 py-3 text-sm font-extrabold text-white shadow-[0_12px_28px_-6px_rgba(16,185,129,0.45)] hover:shadow-[0_16px_36px_-6px_rgba(16,185,129,0.55)] hover:brightness-105 active:scale-[0.98] transition duration-200 cursor-pointer disabled:opacity-50"
                >
                  <CheckCircle2 size={18} />
                  Save & Finalize Attendance
                </motion.button>
              </div>
            </div>
          </div>

          {/* 2-Column Responsive Executive Review Layout */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Left Column: Modern SVG Donut Chart + At-Risk Students (<75%) Analytics (5 cols) */}
            <div className="lg:col-span-5 flex flex-col space-y-6">
              {/* Donut Chart & Core Metrics Card */}
              <div className="rounded-[32px] border border-white/85 bg-white/90 p-6 sm:p-7 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.06)] backdrop-blur-2xl flex flex-col items-center justify-between text-center">
                <div className="w-full flex items-center justify-between pb-3.5 border-b border-slate-100 text-left">
                  <div>
                    <h3 className="font-extrabold text-slate-900 text-sm tracking-tight">Session Analytics</h3>
                    <p className="text-[11px] text-slate-500 font-medium">Real-time quorum & turnout breakdown</p>
                  </div>
                  <span className="font-mono text-xs font-bold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full border border-slate-200/70">
                    {activeSession?.section ? `Section ${activeSession.section}` : "All"}
                  </span>
                </div>

                {/* Futuristic Multi-Layered SVG Donut Chart */}
                <div className="my-2 w-full flex justify-center">
                  <AttendanceDonutChart
                    presentCount={presentCount}
                    absentCount={absentCount}
                    totalCount={totalCount}
                    percentage={Number(attendancePercentage) || 0}
                  />
                </div>

                {/* 2x2 Metric Cards Grid */}
                <div className="w-full grid grid-cols-2 gap-3 mt-3">
                  <div className="rounded-2xl bg-emerald-50/80 border border-emerald-200/80 p-3 text-left shadow-2xs">
                    <p className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-800">
                      Verified Present
                    </p>
                    <p className="text-2xl font-mono font-black text-emerald-700 mt-0.5">
                      <CountUp value={presentCount} />
                    </p>
                  </div>

                  <div className="rounded-2xl bg-rose-50/80 border border-rose-200/80 p-3 text-left shadow-2xs">
                    <p className="text-[10px] font-extrabold uppercase tracking-wider text-rose-800">
                      Absentees
                    </p>
                    <p className="text-2xl font-mono font-black text-rose-700 mt-0.5">
                      <CountUp value={absentCount} />
                    </p>
                  </div>

                  <div className="rounded-2xl bg-slate-50/90 border border-slate-200/80 p-3 text-left shadow-2xs">
                    <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                      Class Quorum
                    </p>
                    <p className="text-2xl font-mono font-black text-slate-800 mt-0.5">
                      <CountUp value={totalCount} />
                    </p>
                  </div>

                  <div className="rounded-2xl bg-indigo-50/80 border border-indigo-200/80 p-3 text-left shadow-2xs">
                    <p className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-800">
                      Duration
                    </p>
                    <p className="text-2xl font-mono font-black text-indigo-700 mt-0.5">
                      {reviewDurationText}
                    </p>
                  </div>
                </div>

                {/* Direct Instant CSV Export Button */}
                <div className="w-full mt-4 pt-3.5 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={handleExportCsv}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50/90 hover:bg-slate-100 px-4 py-2.5 text-xs font-bold text-slate-700 hover:text-slate-900 transition shadow-2xs cursor-pointer active:scale-98"
                  >
                    <Download size={14} className="text-slate-600" />
                    Export CSV Report
                  </button>
                </div>
              </div>

              {/* At-Risk Subject Analytics Card (<75%) */}
              <div className="rounded-[32px] border border-white/85 bg-white/90 p-6 sm:p-7 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.06)] backdrop-blur-2xl">
                <div className="flex items-center justify-between pb-3.5 border-b border-slate-100">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600">
                      <ShieldAlert size={18} />
                    </div>
                    <div>
                      <h4 className="font-extrabold text-slate-900 text-sm tracking-tight">
                        At-Risk Students (&lt;75%)
                      </h4>
                      <p className="text-[11px] text-slate-500 font-medium">
                        Subject: {selectedSubject?.code || "Current Subject"}
                      </p>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-rose-50 border border-rose-200 text-rose-700">
                    Subject Deficit
                  </span>
                </div>

                <div className="mt-3.5 space-y-2">
                  {atRiskLoading ? (
                    /* Subtle Skeleton Loading Rows */
                    <div className="space-y-2 py-1">
                      {[1, 2, 3].map((n) => (
                        <div key={n} className="flex items-center justify-between rounded-xl bg-slate-50 p-2.5 animate-pulse">
                          <div className="flex items-center gap-2.5">
                            <div className="h-7 w-7 rounded-lg bg-slate-200" />
                            <div className="space-y-1">
                              <div className="h-3 w-24 rounded bg-slate-200" />
                              <div className="h-2.5 w-16 rounded bg-slate-200" />
                            </div>
                          </div>
                          <div className="h-5 w-14 rounded-full bg-slate-200" />
                        </div>
                      ))}
                    </div>
                  ) : atRiskStudents.length === 0 ? (
                    /* Celebration State: All students healthy ≥ 75% */
                    <div className="flex flex-col items-center justify-center py-6 px-4 text-center rounded-2xl bg-emerald-50/60 border border-emerald-200/80">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 mb-2">
                        <CheckCircle2 size={22} />
                      </div>
                      <p className="font-bold text-xs text-emerald-900">
                        Healthy Subject Quorum
                      </p>
                      <p className="text-[11px] text-emerald-700/90 mt-1 max-w-xs leading-relaxed">
                        All students maintain healthy attendance (≥75%). No students at risk.
                      </p>
                    </div>
                  ) : (
                    /* Render Up to 5 At-Risk Students */
                    atRiskStudents.map((s: any) => {
                      const pct = Number(s.attendancePercentage || 0);
                      const attended = Number(s.attendedClasses || 0);
                      const total = Number(s.totalClasses || 0);
                      const studentName = s.studentName || s.name || "Student";
                      const enrollmentNo = s.enrollmentNo || s.usn || "-";

                      return (
                        <div
                          key={enrollmentNo}
                          className="flex items-center justify-between rounded-xl border border-rose-100 bg-rose-50/40 hover:bg-rose-50/70 p-2.5 transition-colors"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white border border-rose-200 text-rose-700 font-extrabold text-[10px] shadow-2xs">
                              {studentName.slice(0, 1).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-xs font-bold text-slate-900 leading-tight">
                                {studentName}
                              </p>
                              <p className="font-mono text-[10px] text-slate-500 truncate leading-tight">
                                {enrollmentNo}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0 text-right">
                            <div>
                              <span className="inline-block font-mono text-[11px] font-black text-rose-700 bg-rose-100 border border-rose-200/80 px-2 py-0.5 rounded-md shadow-2xs">
                                {pct.toFixed(0)}%
                              </span>
                              <p className="font-mono text-[9px] text-slate-400 mt-0.5">
                                {attended}/{total} classes
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Right Column: Interactive Roster with Quick-Add Search & 1-Click Toggles (7 cols) */}
            <div className="lg:col-span-7 flex flex-col">
              <div className="flex-1 rounded-[32px] border border-white/85 bg-white/90 p-6 sm:p-7 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.06)] backdrop-blur-2xl flex flex-col">
                {/* Header Controls: Segmented Tabs & Quick-Add Search Bar */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-slate-100">
                  <div className="flex items-center gap-1.5 p-1 bg-slate-100/90 border border-slate-200/60 rounded-2xl w-fit">
                    <button
                      type="button"
                      onClick={() => setReviewTab("present")}
                      className={`rounded-xl px-3.5 py-2 text-xs font-bold transition duration-150 flex items-center gap-1.5 cursor-pointer ${
                        reviewTab === "present"
                          ? "bg-emerald-600 text-white shadow-sm"
                          : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/60"
                      }`}
                    >
                      <CheckCircle2 size={14} />
                      Presentees ({presentCount})
                    </button>

                    <button
                      type="button"
                      onClick={() => setReviewTab("absent")}
                      className={`rounded-xl px-3.5 py-2 text-xs font-bold transition duration-150 flex items-center gap-1.5 cursor-pointer ${
                        reviewTab === "absent"
                          ? "bg-rose-600 text-white shadow-sm"
                          : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/60"
                      }`}
                    >
                      <UserX size={14} />
                      Absentees ({absentCount})
                    </button>
                  </div>

                  {/* Upgraded Quick-Add Search Bar (Supports last 3 digits, USN, or name + Enter) */}
                  <div className="relative w-full sm:w-80">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Search by last 3 digits, USN, or name (Press Enter)..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={handleReviewSearchKeyDown}
                      className="w-full rounded-xl border border-slate-200/90 bg-slate-50/70 pl-8.5 pr-8 py-2 text-xs font-semibold text-slate-800 focus:bg-white focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition shadow-2xs placeholder:text-slate-400"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery("")}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer p-0.5"
                        title="Clear search"
                      >
                        <XCircle size={13} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Auto-Add Hint Chip when 1 absent student uniquely matches search query */}
                {reviewCandidateMatches.length === 1 && (
                  <div className="mt-2.5 flex items-center justify-between rounded-xl bg-emerald-50 border border-emerald-200/80 px-3 py-1.5 text-xs text-emerald-800 animate-fadeIn shadow-2xs">
                    <span className="truncate">
                      Press <strong>Enter</strong> to mark present: <strong>{reviewCandidateMatches[0].name}</strong> ({reviewCandidateMatches[0].enrollmentNo})
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        onManualAttendance("present", reviewCandidateMatches[0].enrollmentNo);
                        setSearchQuery("");
                      }}
                      className="ml-2 shrink-0 px-2 py-0.5 text-[10px] font-bold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition cursor-pointer shadow-xs"
                    >
                      + Add
                    </button>
                  </div>
                )}

                {/* Interactive Roster Scrollable List (fits comfortably with zero clutter) */}
                <div
                  className="mt-3.5 space-y-2 max-h-[560px] overflow-y-auto pr-1 overscroll-contain"
                  style={{
                    transform: "translateZ(0)",
                    WebkitOverflowScrolling: "touch",
                  }}
                >
                  {/* 1. Presentees Tab View */}
                  {reviewTab === "present" && (
                    filteredPresentList.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-16 text-center text-slate-400 text-xs border border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
                        <Users size={28} className="mb-2 text-slate-300" />
                        <p className="font-bold text-xs text-slate-700">No present students found</p>
                        {searchQuery && <p className="mt-0.5 text-[11px]">Try a different keyword or check Absentees.</p>}
                      </div>
                    ) : (
                      filteredPresentList.map((item) => (
                        <div
                          key={item.enrollmentNo}
                          className="flex items-center justify-between rounded-xl border border-emerald-200/80 bg-emerald-50/40 hover:bg-emerald-50/70 p-2.5 transition-colors duration-150"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white border border-slate-200 overflow-hidden shadow-2xs">
                              {item.photoUrl ? (
                                <img src={item.photoUrl} alt={item.name} className="h-full w-full object-cover" />
                              ) : (
                                <span className="font-extrabold text-[11px] text-slate-700">
                                  {item.name.slice(0, 1).toUpperCase()}
                                </span>
                              )}
                            </div>

                            <div className="min-w-0">
                              <p className="truncate text-xs font-bold text-slate-900 leading-tight">{item.name}</p>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="font-mono text-[10px] text-slate-500 font-semibold leading-tight">
                                  {item.enrollmentNo}
                                </span>
                                <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-emerald-700 bg-emerald-100/80 px-1.5 py-0.2 rounded">
                                  <Check size={9} className="stroke-[3]" /> Present
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* 1-Click Toggle: Mark Absent */}
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => onManualAttendance("absent", item.enrollmentNo)}
                              className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-bold text-rose-600 hover:bg-rose-100 hover:border-rose-300 active:scale-95 transition cursor-pointer shadow-2xs"
                              title={`Mark ${item.name} as absent`}
                            >
                              <Trash2 size={12} className="text-rose-600" />
                              <span>Mark Absent</span>
                            </button>
                          </div>
                        </div>
                      ))
                    )
                  )}

                  {/* 2. Absentees Tab View */}
                  {reviewTab === "absent" && (
                    filteredAbsentList.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-16 text-center text-slate-400 text-xs border border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
                        <CheckCircle2 size={28} className="mb-2 text-emerald-500" />
                        <p className="font-extrabold text-xs text-slate-800">100% Attendance Recorded!</p>
                        <p className="mt-0.5 text-[11px]">All enrolled students are marked present.</p>
                      </div>
                    ) : (
                      filteredAbsentList.map((item) => (
                        <div
                          key={item.enrollmentNo}
                          className="flex items-center justify-between rounded-xl border border-rose-200/80 bg-rose-50/30 hover:bg-rose-50/60 p-2.5 transition-colors duration-150"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white border border-slate-200 overflow-hidden shadow-2xs">
                              {item.photoUrl ? (
                                <img src={item.photoUrl} alt={item.name} className="h-full w-full object-cover" />
                              ) : (
                                <span className="font-bold text-[11px] text-slate-500">
                                  {item.name.slice(0, 1).toUpperCase()}
                                </span>
                              )}
                            </div>

                            <div className="min-w-0">
                              <p className="truncate text-xs font-bold text-slate-800 leading-tight">{item.name}</p>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="font-mono text-[10px] text-slate-500 font-semibold leading-tight">
                                  {item.enrollmentNo}
                                </span>
                                <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-rose-700 bg-rose-100/80 px-1.5 py-0.2 rounded">
                                  <UserX size={9} /> Absent
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* 1-Click Toggle: Mark Present */}
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => onManualAttendance("present", item.enrollmentNo)}
                              className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100 hover:border-emerald-400 active:scale-95 transition cursor-pointer shadow-2xs"
                              title={`Mark ${item.name} as present`}
                            >
                              <UserPlus size={12} className="text-emerald-700" />
                              <span>Mark Present</span>
                            </button>
                          </div>
                        </div>
                      ))
                    )
                  )}
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      ) : (
        /* ========================================================================= */
        /* MODE A: LIVE ATTENDANCE (ENLARGED DYNAMIC QR 8 COLS + COMPACT STREAM 4 COLS) */
        /* ========================================================================= */
        <>
          {/* Main Studio Control Banner - Executive Mission Control HUD */}
          <div className="relative overflow-hidden rounded-[32px] border border-slate-700/60 bg-gradient-to-br from-slate-950 via-slate-900/95 to-slate-950 p-6 sm:p-8 text-white shadow-2xl backdrop-blur-2xl">
            <div className="absolute -top-10 -right-10 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(16,185,129,0.20)_0%,transparent_70%)] blur-3xl pointer-events-none" />
            <div className="absolute -bottom-10 -left-10 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(99,102,241,0.15)_0%,transparent_70%)] blur-3xl pointer-events-none" />

            <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              {/* Left Details */}
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 shadow-[0_0_30px_rgba(16,185,129,0.35)]">
                  <Radio className="h-7 w-7 animate-pulse" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2.5">
                    {/* Live Beacon Pill */}
                    <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/40 bg-emerald-500/20 px-3.5 py-1 text-xs font-mono font-black text-emerald-300 shadow-2xs">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                      </span>
                      <span>LIVE</span>
                      <span className="text-emerald-500/60">•</span>
                      <span>{formattedElapsed}</span>
                    </div>

                    <span className="font-mono text-xs text-slate-400 bg-slate-800/80 px-2.5 py-1 rounded-full border border-slate-700/80">
                      ID: {sessionId.slice(-8)}
                    </span>
                  </div>

                  <h2 className="mt-1.5 text-2xl font-black tracking-tight text-white sm:text-3xl">
                    {selectedSubject?.name || "Live Session"}
                  </h2>
                  <p className="text-xs text-slate-300 font-medium">
                    {selectedDepartment?.name || "Department"} • Year {activeSession?.year || "-"} • Sem {activeSession?.semester || "-"} • Sec {activeSession?.section || "A"}
                  </p>
                </div>
              </div>

              {/* Middle: Progress Ring */}
              <div className="hidden xl:flex items-center gap-3.5 rounded-2xl border border-slate-700/60 bg-slate-800/50 px-4 py-2.5 backdrop-blur-xl">
                <AttendanceProgressRing
                  percentage={Number(attendancePercentage) || 0}
                  size={48}
                  strokeWidth={4}
                />
                <div className="text-left font-mono">
                  <div className="text-xs font-extrabold uppercase tracking-wider text-slate-400">Class Attendance</div>
                  <div className="text-sm font-bold text-emerald-400">
                    {presentCount} / {totalCount} Enrolled
                  </div>
                </div>
              </div>

              {/* Right: Action Hub Buttons */}
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={openFullscreen}
                  className="inline-flex items-center gap-2 rounded-2xl border border-indigo-500/40 bg-indigo-600/30 px-5 py-3 text-xs font-bold text-indigo-200 hover:bg-indigo-600/50 transition duration-200 shadow-[0_0_20px_rgba(99,102,241,0.25)] cursor-pointer active:scale-95"
                  title="Launch high-contrast projector view"
                >
                  <Maximize2 size={16} /> Projector HUD
                </button>

                {showCancelConfirm ? (
                  <div className="flex items-center gap-2 bg-rose-950/90 border border-rose-500/50 rounded-2xl px-3.5 py-2 animate-in fade-in">
                    <span className="text-xs font-bold text-rose-200">Discard session?</span>
                    <button
                      type="button"
                      disabled={isCancelling}
                      onClick={handleConfirmCancel}
                      className="inline-flex items-center gap-1 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold text-xs px-3 py-1.5 rounded-xl cursor-pointer transition shadow-sm"
                    >
                      {isCancelling ? "Cancelling..." : "Yes, Cancel"}
                    </button>
                    <button
                      type="button"
                      disabled={isCancelling}
                      onClick={() => setShowCancelConfirm(false)}
                      className="text-xs font-semibold px-2.5 py-1.5 text-slate-300 hover:bg-slate-800 rounded-xl cursor-pointer transition"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={isCancelling}
                    onClick={() => setShowCancelConfirm(true)}
                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-700/80 bg-slate-800/80 px-4.5 py-3 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition duration-200 cursor-pointer"
                  >
                    <Square size={14} /> Cancel Session
                  </button>
                )}

                <button
                  type="button"
                  disabled={stoppingSession}
                  onClick={handleEnterReviewMode}
                  className="inline-flex items-center gap-2 rounded-2xl border border-rose-500/50 bg-rose-600 px-6 py-3 text-xs font-bold text-white hover:bg-rose-700 active:scale-95 transition duration-200 shadow-[0_6px_24px_rgba(225,29,72,0.4)] cursor-pointer disabled:opacity-50"
                >
                  <Square size={14} /> {stoppingSession ? "Stopping..." : "Stop Session"}
                </button>
              </div>
            </div>
          </div>

          {/* Grid: Enlarged Dynamic QR (8 cols) + Beside Stream (4 cols) */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Enlarged Space: Dynamic Rotating QR Stage (8 cols) */}
            <div className="lg:col-span-8 flex flex-col">
              <div className="relative flex-1 rounded-[32px] border border-white/85 bg-white/90 p-7 sm:p-8 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.06)] backdrop-blur-2xl flex flex-col items-center justify-between text-center">
                <div className="w-full flex items-center justify-between pb-3.5 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-ping" />
                    <h3 className="font-extrabold text-slate-900 text-sm tracking-tight">Dynamic Rotating QR Studio</h3>
                  </div>
                  <span className="flex items-center gap-1 font-bold text-xs text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200/70 shadow-2xs">
                    <ShieldCheck size={14} /> Geofenced Verification
                  </span>
                </div>

                {/* QR Studio Presentation with Enlarged High-Contrast QR */}
                <div className="my-6 w-full flex flex-col items-center justify-center">
                  <IsolatedRotatingQrEngine
                    sessionId={sessionId}
                    sessionSecretKey={sessionSecretKey}
                    classCode={classCode}
                    isActive={!isReviewMode}
                    size={330}
                    isProjector={false}
                  />
                </div>

                <div className="w-full rounded-2xl bg-slate-50/90 border border-slate-200/80 p-4 text-left shadow-2xs">
                  <div className="flex items-center justify-between text-xs text-slate-600 font-medium">
                    <span className="flex items-center gap-1.5">
                      <Clock size={14} className="text-slate-400" />
                      Session Started: <strong className="font-mono text-slate-800">{formattedStartTime}</strong>
                    </span>
                    <span className="font-mono text-[11px] text-slate-500">
                      Scan via SmartAttend Student App
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Beside Space: Live Scan Stream (4 cols) */}
            <div className="lg:col-span-4 flex flex-col">
              <div className="flex-1 rounded-[32px] border border-white/85 bg-white/90 p-5 sm:p-6 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.06)] backdrop-blur-2xl flex flex-col">
                {/* Stream Header */}
                <div className="flex items-center justify-between pb-3.5 border-b border-slate-100">
                  <div>
                    <h3 className="font-extrabold text-slate-900 text-sm tracking-tight flex items-center gap-1.5">
                      <Radio size={15} className="text-emerald-500 animate-pulse" />
                      Live Scan Stream
                    </h3>
                    <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                      Real-time student check-ins
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-xl font-black text-emerald-600 flex items-center gap-1.5 justify-end">
                      <Users size={17} />
                      <span>
                        <CountUp value={presentCount} />
                        {effectiveTotalStudents > 0 ? ` / ${effectiveTotalStudents}` : ""}
                      </span>
                    </div>
                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                      Checked In
                    </span>
                  </div>
                </div>

                {/* Live Feed Status Bar */}
                <div className="mt-3.5 flex items-center justify-between rounded-2xl bg-emerald-50/90 border border-emerald-200/80 px-3.5 py-2 text-xs shadow-2xs">
                  <span className="flex items-center gap-1.5 font-extrabold text-emerald-800">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
                    Live Scanning Active
                  </span>
                  <span className="font-mono font-bold text-emerald-700">
                    {presentCount}
                    {effectiveTotalStudents > 0 ? ` / ${effectiveTotalStudents}` : ""} Present
                  </span>
                </div>

                {/* High-Performance Compact Student Search Bar */}
                <div className="mt-3 relative">
                  <div className="relative">
                    <Search
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                    />
                    <input
                      type="text"
                      placeholder="Search or add by last 3 digits / name (Press Enter)..."
                      value={liveSearchQuery}
                      onChange={(e) => setLiveSearchQuery(e.target.value)}
                      onKeyDown={handleLiveSearchKeyDown}
                      className="w-full rounded-xl border border-slate-200/90 bg-slate-50/70 pl-8.5 pr-8 py-2 text-xs font-semibold text-slate-800 placeholder:text-slate-400 focus:bg-white focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition shadow-2xs"
                    />
                    {liveSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setLiveSearchQuery("")}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer p-0.5"
                        title="Clear search"
                      >
                        <XCircle size={14} />
                      </button>
                    )}
                  </div>

                  {/* Auto-Add Hint Chip when exactly 1 absent student matches */}
                  {absentCandidateMatches.length === 1 && (
                    <div className="mt-1.5 flex items-center justify-between rounded-lg bg-emerald-50 border border-emerald-200/80 px-2.5 py-1 text-[11px] text-emerald-800 animate-fadeIn">
                      <span className="truncate">
                        Press <strong>Enter</strong> to mark present: <strong>{absentCandidateMatches[0].name}</strong> ({absentCandidateMatches[0].enrollmentNo})
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          onManualAttendance("present", absentCandidateMatches[0].enrollmentNo);
                          setLiveSearchQuery("");
                        }}
                        className="ml-1.5 shrink-0 px-1.5 py-0.5 text-[10px] font-bold bg-emerald-600 text-white rounded hover:bg-emerald-700 transition cursor-pointer"
                      >
                        + Add
                      </button>
                    </div>
                  )}
                </div>

                {/* Live Stream Scrollable List (Fits ~10 records in visible window layout) */}
                <div
                  className="mt-3 space-y-1.5 max-h-[480px] overflow-y-auto pr-1 overscroll-contain"
                  style={{
                    transform: "translateZ(0)",
                    WebkitOverflowScrolling: "touch",
                  }}
                >
                  <AnimatePresence initial={false}>
                    {liveSearchQuery.trim() ? (
                      /* SEARCH RESULTS VIEW */
                      absentCandidateMatches.length === 0 && filteredLivePresentList.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-center text-slate-400 text-xs border border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
                          <Search size={22} className="mb-2 text-slate-400" />
                          <p className="font-bold text-xs text-slate-700">
                            No matching students
                          </p>
                          <p className="mt-0.5 text-[11px] text-slate-400 max-w-[220px]">
                            No students match &quot;{liveSearchQuery}&quot;. Try another name or USN.
                          </p>
                        </div>
                      ) : (
                        <>
                          {/* Matching Absent Candidates (1-click to Mark Present) */}
                          {absentCandidateMatches.map((item) => (
                            <motion.div
                              key={`search-absent-${item.enrollmentNo}`}
                              layout
                              initial={{ opacity: 0, y: -4 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, scale: 0.95 }}
                              transition={{ duration: 0.12 }}
                              className="flex items-center justify-between rounded-xl border border-amber-200/90 bg-amber-50/50 px-2.5 py-1.5 transition-colors duration-150 hover:bg-amber-50/80"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white border border-amber-200 overflow-hidden shadow-2xs">
                                  {item.photoUrl ? (
                                    <img src={item.photoUrl} alt={item.name} className="h-full w-full object-cover" />
                                  ) : (
                                    <span className="font-extrabold text-[11px] text-amber-700">
                                      {item.name.slice(0, 1).toUpperCase()}
                                    </span>
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <p className="truncate text-xs font-bold text-slate-900 leading-tight">{item.name}</p>
                                  <div className="flex items-center gap-1.5">
                                    <p className="font-mono text-[10px] text-slate-500 truncate leading-tight">{item.enrollmentNo}</p>
                                    <span className="rounded bg-amber-100 border border-amber-300/80 px-1 py-0.2 text-[9px] font-bold text-amber-700">
                                      Not Checked In
                                    </span>
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => {
                                    onManualAttendance("present", item.enrollmentNo);
                                    setLiveSearchQuery("");
                                  }}
                                  title={`Mark ${item.name} (${item.enrollmentNo}) as present`}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-extrabold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs active:scale-95 transition cursor-pointer"
                                >
                                  <Check size={11} className="stroke-[3]" />
                                  <span>+ Mark Present</span>
                                </button>
                              </div>
                            </motion.div>
                          ))}

                          {/* Matching Already Present Students (Verified with remove option) */}
                          {filteredLivePresentList.map((item) => {
                            const scanTime = item.timestamp
                              ? new Date(item.timestamp).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  second: "2-digit",
                                })
                              : "Verified";

                            return (
                              <motion.div
                                key={`search-present-${item.enrollmentNo}`}
                                layout
                                initial={{ opacity: 0, y: -4 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                transition={{ duration: 0.12 }}
                                className="flex items-center justify-between rounded-xl border border-emerald-200/80 bg-emerald-50/40 px-2.5 py-1.5 transition-colors duration-150 hover:bg-emerald-50/70"
                              >
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white border border-slate-200 overflow-hidden shadow-2xs">
                                    {item.photoUrl ? (
                                      <img src={item.photoUrl} alt={item.name} className="h-full w-full object-cover" />
                                    ) : (
                                      <span className="font-extrabold text-[11px] text-slate-700">
                                        {item.name.slice(0, 1).toUpperCase()}
                                      </span>
                                    )}
                                  </div>
                                  <div className="min-w-0">
                                    <p className="truncate text-xs font-bold text-slate-900 leading-tight">{item.name}</p>
                                    <p className="font-mono text-[10px] text-slate-500 truncate leading-tight">{item.enrollmentNo}</p>
                                  </div>
                                </div>

                                <div className="flex items-center gap-1.5 shrink-0">
                                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100/90 border border-emerald-300 px-2 py-0.5 text-[9px] font-extrabold text-emerald-800 shadow-2xs">
                                    <Check size={10} className="stroke-[3]" /> {scanTime}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => onManualAttendance("absent", item.enrollmentNo)}
                                    title={`Remove ${item.name} (${item.enrollmentNo})`}
                                    className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 active:scale-90 transition cursor-pointer"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </div>
                              </motion.div>
                            );
                          })}
                        </>
                      )
                    ) : (
                      /* DEFAULT LIVE SCAN STREAM VIEW (Newest Arrivals First) */
                      presentList.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-center text-slate-400 text-xs border border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
                          <Radio size={22} className="mb-2 text-emerald-400 animate-pulse" />
                          <p className="font-bold text-xs text-slate-700">
                            Waiting for live scans
                          </p>
                          <p className="mt-0.5 text-[11px] text-slate-400 max-w-[200px]">
                            New arrivals appear here at the top in real-time.
                          </p>
                        </div>
                      ) : (
                        presentList.map((item) => {
                          const scanTime = item.timestamp
                            ? new Date(item.timestamp).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                              })
                            : "Verified";

                          return (
                            <motion.div
                              key={item.enrollmentNo}
                              layout
                              initial={{ opacity: 0, y: -6 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, scale: 0.95 }}
                              transition={{ duration: 0.15 }}
                              className="flex items-center justify-between rounded-xl border border-emerald-200/80 bg-emerald-50/40 px-2.5 py-1.5 transition-colors duration-150 hover:bg-emerald-50/70"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white border border-slate-200 overflow-hidden shadow-2xs">
                                  {item.photoUrl ? (
                                    <img src={item.photoUrl} alt={item.name} className="h-full w-full object-cover" />
                                  ) : (
                                    <span className="font-extrabold text-[11px] text-slate-700">
                                      {item.name.slice(0, 1).toUpperCase()}
                                    </span>
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <p className="truncate text-xs font-bold text-slate-900 leading-tight">{item.name}</p>
                                  <p className="font-mono text-[10px] text-slate-500 truncate leading-tight">{item.enrollmentNo}</p>
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100/90 border border-emerald-300 px-2 py-0.5 text-[9px] font-extrabold text-emerald-800 shadow-2xs">
                                  <Check size={10} className="stroke-[3]" /> {scanTime}
                                </span>
                                {/* Quick Remove / Trash Dustbin Icon */}
                                <button
                                  type="button"
                                  onClick={() => onManualAttendance("absent", item.enrollmentNo)}
                                  title={`Remove ${item.name} (${item.enrollmentNo})`}
                                  className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 active:scale-90 transition cursor-pointer"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </motion.div>
                          );
                        })
                      )
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
});

LiveSessionStudio.displayName = "LiveSessionStudio";
export default LiveSessionStudio;
