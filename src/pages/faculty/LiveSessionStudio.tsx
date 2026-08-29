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
} from "lucide-react";
import { Button } from "../../components/Common";
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

const IsolatedRotatingQrEngine: React.FC<IsolatedRotatingQrEngineProps> = React.memo(({
  sessionId,
  sessionSecretKey,
  classCode = "",
  isActive,
  size = 320,
  isProjector = false,
}) => {
  const [currentToken, setCurrentToken] = useState<string>("");
  const [timeLeft, setTimeLeft] = useState<number>(2);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const prevTokenRef = useRef<string>("");
  const secretKeyRef = useRef<string | null>(sessionSecretKey || null);

  useEffect(() => {
    if (sessionSecretKey) {
      secretKeyRef.current = sessionSecretKey;
    }
  }, [sessionSecretKey]);

  useEffect(() => {
    let stopPolling: (() => void) | null = null;
    let cancelled = false;

    if (!sessionId || !isActive) {
      setCurrentToken("");
      return;
    }

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
        className="flex flex-col items-center justify-center rounded-2xl border border-slate-200/80 bg-slate-50/50 p-4"
      >
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
        <span className="mt-3 font-mono text-xs text-slate-500">Initializing QR Key...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center">
      <div
        className={`rounded-2xl border-4 border-white bg-white p-4 shadow-xl transition duration-200 ${
          isProjector ? "ring-4 ring-emerald-500/30" : ""
        }`}
      >
        <QRCode
          value={currentToken}
          size={size}
          level="M"
          className="h-auto max-w-full"
        />
      </div>

      <div className="mt-4 w-full max-w-[280px]">
        <div className="flex items-center justify-between text-xs font-mono font-semibold">
          <span className="text-emerald-700 flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-emerald-700 animate-pulse" />
            Rotating Token (2s)
          </span>
          <span className="text-slate-600">{timeLeft}s</span>
        </div>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80">
          <div
            className="h-full bg-emerald-700 transition-all duration-100 ease-linear rounded-full"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
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
  const [isCancelling, setIsCancelling] = useState(false);
  const [stoppingSession, setStoppingSession] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
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
    onLoadAttendees();
  }, [sessionId, onLoadAttendees]);

  // Fullscreen listeners
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setIsFullscreen(false);
      }
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

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

  return (
    <div className="space-y-6">
      {/* Fullscreen Ambient Projector HUD */}
      {isFullscreen && (
        <div
          ref={fullscreenContainerRef}
          className="fixed inset-0 z-[100] flex flex-col justify-between overflow-y-auto bg-[#070b14] p-6 text-slate-100 selection:bg-emerald-500 selection:text-white"
        >
          {/* Ambient Glows */}
          <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
            <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[700px] h-[700px] rounded-full bg-[radial-gradient(circle,rgba(16,185,129,0.18)_0%,rgba(20,184,166,0.10)_45%,transparent_70%)] blur-3xl" />
            <div
              className="absolute inset-0 opacity-[0.03]"
              style={{
                backgroundImage: `radial-gradient(rgba(255, 255, 255, 0.4) 1px, transparent 1px)`,
                backgroundSize: "32px 32px",
              }}
            />
          </div>

          {/* Projector Top Bar */}
          <div className="relative z-10 flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-4 backdrop-blur-md">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400">
                <Radio className="h-5 w-5 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold text-white tracking-tight">
                    {selectedSubject?.name || "Class Session"}
                  </span>
                  <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-mono font-semibold text-emerald-400">
                    {selectedSubject?.code || "LIVE"}
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  {selectedDepartment?.name || "Department"} • Section {activeSession?.section || "A"} • Started at {formattedStartTime}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/40 px-4 py-2 text-emerald-300">
                <Users size={18} />
                <span className="font-mono text-xl font-black">
                  {presentCount}
                  {effectiveTotalStudents > 0 ? ` / ${effectiveTotalStudents}` : ""}
                </span>
                <span className="text-xs text-emerald-400/70">checked in</span>
              </div>

              <button
                type="button"
                onClick={closeFullscreen}
                className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition cursor-pointer"
              >
                <Minimize2 size={16} /> Exit Projector Mode
              </button>
            </div>
          </div>

          {/* Projector Main QR Stage */}
          <div className="relative z-10 my-auto flex flex-col items-center justify-center py-6">
            <div className="relative rounded-3xl border border-emerald-500/40 bg-slate-900/90 p-8 shadow-[0_0_60px_rgba(16,185,129,0.2)] backdrop-blur-2xl">
              <IsolatedRotatingQrEngine
                sessionId={sessionId}
                sessionSecretKey={sessionSecretKey}
                classCode={classCode}
                isActive={!isReviewMode}
                size={460}
                isProjector={true}
              />

              <div className="mt-6 text-center">
                <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400 flex items-center justify-center gap-1.5">
                  <Sparkles size={14} /> Scan with SmartAttend Mobile App
                </p>
                <p className="mt-1 font-mono text-[11px] text-slate-400">
                  Rotating Dynamic QR Token • Protected by Classroom Geofence
                </p>
              </div>
            </div>
          </div>

          {/* Projector Footer Ticker */}
          <div className="relative z-10 flex items-center justify-between border-t border-slate-800/80 pt-4 text-xs text-slate-400">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
              <span>Broadcasting Live Attendance via Supabase Realtime</span>
            </div>
            <div className="font-mono text-slate-500">
              Press ESC or click Exit to return
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
          {/* Top Review Control Bar */}
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
                  </div>
                  <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight mt-1">
                    Attendance Final Review
                  </h2>
                </div>
              </div>

              {/* Right Uprights: Only Cancel Session & Save Attendance */}
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
                  className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 px-8 py-3 text-sm font-extrabold text-white shadow-[0_12px_28px_-6px_rgba(16,185,129,0.45)] hover:shadow-[0_16px_36px_-6px_rgba(16,185,129,0.55)] hover:brightness-105 active:scale-[0.98] transition duration-200 cursor-pointer disabled:opacity-50"
                >
                  <CheckCircle2 size={18} />
                  Save & Finalize Attendance
                </motion.button>
              </div>
            </div>

            {/* Session Stats Banner */}
            <div className="mt-6 pt-5 border-t border-slate-100 grid grid-cols-2 gap-3.5 sm:grid-cols-5">
              <div className="rounded-2xl bg-slate-50/90 p-4 border border-slate-200/80 col-span-2 sm:col-span-1 shadow-2xs">
                <p className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">Subject & Section</p>
                <p className="text-sm font-extrabold text-slate-900 truncate mt-1">
                  {selectedSubject?.name || "Subject"} ({activeSession?.section || "A"})
                </p>
              </div>

              <div className="rounded-2xl bg-emerald-50/90 p-4 border border-emerald-200/80 shadow-2xs">
                <p className="text-[10px] font-extrabold text-emerald-800 uppercase tracking-wider">Verified Presentees</p>
                <p className="text-2xl font-mono font-black text-emerald-700 mt-1">{presentCount}</p>
              </div>

              <div className="rounded-2xl bg-rose-50/90 p-4 border border-rose-200/80 shadow-2xs">
                <p className="text-[10px] font-extrabold text-rose-800 uppercase tracking-wider">Absentees</p>
                <p className="text-2xl font-mono font-black text-rose-700 mt-1">{absentCount}</p>
              </div>

              <div className="rounded-2xl bg-slate-50/90 p-4 border border-slate-200/80 shadow-2xs">
                <p className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">Class Quorum</p>
                <p className="text-2xl font-mono font-black text-slate-800 mt-1">{totalCount}</p>
              </div>

              <div className="rounded-2xl bg-teal-50/90 p-4 border border-teal-200/80 shadow-2xs">
                <p className="text-[10px] font-extrabold text-teal-800 uppercase tracking-wider">Present %</p>
                <p className="text-2xl font-mono font-black text-teal-700 mt-1">{attendancePercentage}%</p>
              </div>
            </div>
          </div>

          {/* Full-Width Single-Line Review Stream */}
          <div className="rounded-[32px] border border-white/85 bg-white/90 p-6 sm:p-8 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.06)] backdrop-blur-2xl">
            {/* Top Bar: 2 Segmented Tabs & Search Box */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-1.5 p-1 bg-slate-100/90 border border-slate-200/60 rounded-2xl w-fit">
                <button
                  type="button"
                  onClick={() => setReviewTab("present")}
                  className={`rounded-xl px-4 py-2.5 text-xs font-bold transition duration-150 flex items-center gap-1.5 cursor-pointer ${
                    reviewTab === "present"
                      ? "bg-emerald-600 text-white shadow-sm"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/60"
                  }`}
                >
                  <CheckCircle2 size={15} />
                  Presentees ({presentCount})
                </button>

                <button
                  type="button"
                  onClick={() => setReviewTab("absent")}
                  className={`rounded-xl px-4 py-2.5 text-xs font-bold transition duration-150 flex items-center gap-1.5 cursor-pointer ${
                    reviewTab === "absent"
                      ? "bg-rose-600 text-white shadow-sm"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/60"
                  }`}
                >
                  <UserX size={15} />
                  Absentees ({absentCount})
                </button>
              </div>

              {/* Search Box */}
              <div className="relative w-full sm:w-80">
                <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search name or USN..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-2xl border border-slate-200/90 bg-slate-50/70 pl-10 pr-3.5 py-2.5 text-xs font-medium text-slate-800 focus:bg-white focus:border-emerald-500 focus:outline-none focus:ring-4 focus:ring-emerald-500/10 transition"
                />
              </div>
            </div>

            {/* Student Single-Line Rows with Lightweight CSS Transitions */}
            <div className="mt-4 space-y-2.5 max-h-[520px] overflow-y-auto pr-1">
              {/* 1. Presentees Tab View */}
              {reviewTab === "present" && (
                filteredPresentList.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center text-slate-400 text-xs border border-dashed border-slate-200 rounded-3xl bg-slate-50/50">
                    <Users size={32} className="mb-2 text-slate-300" />
                    <p className="font-bold text-sm text-slate-700">No present students found</p>
                    {searchQuery && <p className="mt-0.5">Try a different search keyword or check Absentees.</p>}
                  </div>
                ) : (
                  filteredPresentList.map((item) => (
                    <div
                      key={item.enrollmentNo}
                      className="flex items-center justify-between rounded-2xl border border-emerald-200/80 bg-emerald-50/40 hover:bg-emerald-50/70 p-3.5 transition-colors duration-150"
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white border border-slate-200 overflow-hidden shadow-xs">
                          {item.photoUrl ? (
                            <img src={item.photoUrl} alt={item.name} className="h-full w-full object-cover" />
                          ) : (
                            <span className="font-extrabold text-xs text-slate-700">
                              {item.name.slice(0, 1).toUpperCase()}
                            </span>
                          )}
                        </div>

                        <div className="min-w-0 flex flex-col sm:flex-row sm:items-center sm:gap-4">
                          <p className="truncate text-sm font-bold text-slate-900">{item.name}</p>
                          <span className="font-mono text-xs font-semibold text-slate-500 bg-white/90 px-2 py-0.5 rounded-lg border border-slate-200/60 w-fit">
                            {item.enrollmentNo}
                          </span>
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-100/70 px-2 py-0.5 rounded-lg w-fit">
                            <Check size={12} /> Verified Present
                          </span>
                        </div>
                      </div>

                      {/* Action Button: Remove */}
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => onManualAttendance("absent", item.enrollmentNo)}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-bold text-rose-600 hover:bg-rose-100 hover:border-rose-300 active:scale-95 transition cursor-pointer shadow-2xs"
                          title="Remove student and mark as absent"
                        >
                          <Trash2 size={14} className="text-rose-600" />
                          <span>Remove</span>
                        </button>
                      </div>
                    </div>
                  ))
                )
              )}

              {/* 2. Absentees Tab View */}
              {reviewTab === "absent" && (
                filteredAbsentList.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center text-slate-400 text-xs border border-dashed border-slate-200 rounded-3xl bg-slate-50/50">
                    <CheckCircle2 size={32} className="mb-2 text-emerald-500" />
                    <p className="font-extrabold text-sm text-slate-800">100% Attendance Recorded!</p>
                    <p className="mt-0.5">All registered class students are currently marked present.</p>
                  </div>
                ) : (
                  filteredAbsentList.map((item) => (
                    <div
                      key={item.enrollmentNo}
                      className="flex items-center justify-between rounded-2xl border border-rose-200/80 bg-rose-50/30 hover:bg-rose-50/60 p-3.5 transition-colors duration-150"
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white border border-slate-200 overflow-hidden shadow-xs">
                          {item.photoUrl ? (
                            <img src={item.photoUrl} alt={item.name} className="h-full w-full object-cover" />
                          ) : (
                            <span className="font-bold text-xs text-slate-500">
                              {item.name.slice(0, 1).toUpperCase()}
                            </span>
                          )}
                        </div>

                        <div className="min-w-0 flex flex-col sm:flex-row sm:items-center sm:gap-4">
                          <p className="truncate text-sm font-bold text-slate-800">{item.name}</p>
                          <span className="font-mono text-xs font-semibold text-slate-500 bg-white/90 px-2 py-0.5 rounded-lg border border-slate-200/60 w-fit">
                            {item.enrollmentNo}
                          </span>
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700 bg-rose-100/70 px-2 py-0.5 rounded-lg w-fit">
                            <UserX size={12} /> Absent
                          </span>
                        </div>
                      </div>

                      {/* Action Button: Add */}
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => onManualAttendance("present", item.enrollmentNo)}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3.5 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 hover:border-emerald-400 active:scale-95 transition cursor-pointer shadow-2xs"
                          title="Add student to presentees"
                        >
                          <UserPlus size={14} className="text-emerald-700" />
                          <span>Add to Present</span>
                        </button>
                      </div>
                    </div>
                  ))
                )
              )}
            </div>

            {/* Manual Attendance Entry Bar */}
            <div className="mt-6 pt-4 border-t border-slate-100">
              <div className="flex flex-col sm:flex-row gap-2 max-w-lg">
                <input
                  type="text"
                  placeholder="Enter USN to add manually (e.g. 1RV21CS001)"
                  value={manualEnrollment}
                  onChange={(e) => setManualEnrollment(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && onManualAttendance("present")}
                  className="flex-1 rounded-2xl border border-slate-200/90 bg-slate-50/60 px-4 py-2.5 text-xs font-semibold text-slate-800 focus:bg-white focus:border-emerald-500 focus:outline-none focus:ring-4 focus:ring-emerald-500/10 transition"
                />
                <Button
                  onClick={() => onManualAttendance("present")}
                  disabled={manualLoading || !manualEnrollment.trim()}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-5 py-2.5 rounded-2xl flex items-center justify-center gap-1.5"
                >
                  <UserPlus size={14} /> Add to Presentees
                </Button>
              </div>
            </div>
          </div>
        </motion.div>
      ) : (
        /* ========================================================================= */
        /* MODE A: LIVE ATTENDANCE (ENLARGED DYNAMIC QR 8 COLS + COMPACT STREAM 4 COLS) */
        /* ========================================================================= */
        <>
          {/* Main Studio Control Banner */}
          <div className="relative overflow-hidden rounded-[32px] border border-emerald-500/30 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 p-6 sm:p-8 text-white shadow-[0_16px_40px_-12px_rgba(16,185,129,0.3)] backdrop-blur-2xl">
            <div className="absolute -top-10 -right-10 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(16,185,129,0.25)_0%,transparent_70%)] blur-3xl pointer-events-none" />

            <div className="relative z-10 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-4">
                <div className="flex h-15 w-15 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 shadow-[0_0_28px_rgba(16,185,129,0.35)]">
                  <Radio className="h-7 w-7 animate-pulse" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/40 bg-emerald-500/20 px-3 py-0.5 text-[11px] font-extrabold text-emerald-300 uppercase tracking-wide shadow-2xs">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                      Live Attendance Broadcast
                    </span>
                    <span className="font-mono text-xs text-slate-400 bg-slate-800/80 px-2.5 py-0.5 rounded-full border border-slate-700">
                      ID: {sessionId.slice(-8)}
                    </span>
                  </div>
                  <h2 className="mt-1 text-2xl font-black tracking-tight text-white sm:text-3xl">
                    {selectedSubject?.name || "Live Session"}
                  </h2>
                  <p className="text-xs text-slate-300 font-medium">
                    {selectedDepartment?.name || "Department"} • Year {activeSession?.year || "-"} • Sem {activeSession?.semester || "-"} • Sec {activeSession?.section || "A"}
                  </p>
                </div>
              </div>

              {/* Action Hub Buttons */}
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={openFullscreen}
                  className="inline-flex items-center gap-2 rounded-2xl border border-emerald-500/40 bg-emerald-600/30 px-4.5 py-3 text-xs font-bold text-emerald-200 hover:bg-emerald-600/50 transition duration-200 shadow-sm cursor-pointer"
                >
                  <Maximize2 size={16} /> Projector HUD
                </button>
                {showCancelConfirm ? (
                  <div className="flex items-center gap-2 bg-rose-950/80 border border-rose-500/50 rounded-2xl px-3.5 py-2 animate-in fade-in">
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
                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-800/80 px-4.5 py-3 text-xs font-semibold text-slate-300 hover:bg-slate-700 transition duration-200 cursor-pointer"
                  >
                    <Square size={14} /> Cancel Session
                  </button>
                )}
                <button
                  type="button"
                  disabled={stoppingSession}
                  onClick={handleEnterReviewMode}
                  className="inline-flex items-center gap-2 rounded-2xl border border-rose-500/50 bg-rose-600 px-6 py-3 text-xs font-bold text-white hover:bg-rose-700 active:scale-95 transition duration-200 shadow-[0_6px_20px_rgba(225,29,72,0.35)] cursor-pointer disabled:opacity-50"
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
                        {presentCount}
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

                {/* Live Stream List */}
                <div
                  className="mt-3 space-y-2 max-h-[390px] overflow-y-auto pr-1"
                  style={{
                    overscrollBehavior: "contain",
                    transform: "translateZ(0)",
                    WebkitOverflowScrolling: "touch",
                  }}
                >
                  <AnimatePresence initial={false}>
                    {filteredPresentList.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-14 text-center text-slate-400 text-xs border border-dashed border-slate-200 rounded-3xl bg-slate-50/50">
                        <Radio size={24} className="mb-2 text-emerald-400 animate-pulse" />
                        <p className="font-bold text-sm text-slate-700">Waiting for live scans</p>
                        <p className="mt-1 text-[11px] text-slate-400 max-w-[200px]">
                          Scanned students will appear here in real-time.
                        </p>
                      </div>
                    ) : (
                      filteredPresentList.map((item) => {
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
                            exit={{ opacity: 0, y: 6 }}
                            className="flex items-center justify-between rounded-2xl border border-emerald-200/80 bg-emerald-50/40 p-2.5 transition-colors duration-150"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white border border-slate-200 overflow-hidden shadow-2xs">
                                {item.photoUrl ? (
                                  <img src={item.photoUrl} alt={item.name} className="h-full w-full object-cover" />
                                ) : (
                                  <span className="font-extrabold text-xs text-slate-700">
                                    {item.name.slice(0, 1).toUpperCase()}
                                  </span>
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-xs font-bold text-slate-900">{item.name}</p>
                                <p className="font-mono text-[10px] text-slate-500 truncate">{item.enrollmentNo}</p>
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100/90 border border-emerald-300 px-2 py-0.5 text-[10px] font-extrabold text-emerald-800 shadow-2xs">
                                <Check size={10} className="stroke-[3]" /> {scanTime}
                              </span>
                            </div>
                          </motion.div>
                        );
                      })
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
