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
  Play,
  XCircle,
  Search,
  Check,
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
  liveAttendance: LiveAttendanceItem[];
  attendanceStatusMap: Record<string, "present" | "absent">;
  attendanceDataLoaded?: boolean;
  attendeesLoading?: boolean;
  manualLoading: boolean;
  manualEnrollment: string;
  setManualEnrollment: (val: string) => void;
  onLoadAttendees: () => Promise<void>;
  onManualAttendance: (status: "present" | "absent", enrollmentNo?: string) => Promise<void>;
  onToggleAttendanceItem?: (item: any) => Promise<void>;
  onStopSession: () => Promise<void>;
  onCancelSession: () => Promise<void>;
  selectedSubject?: any;
  selectedDepartment?: any;
}

// ---------------------------------------------------------------------------
// Self-Contained Leaf Dynamic QR Engine
// Encapsulates 100% of the 3-second TOTP generation in browser memory.
// Changes to currentToken only re-render this leaf component, causing 0 re-renders
// in LiveSessionStudio or root FacultyDashboard.
// ---------------------------------------------------------------------------
interface IsolatedRotatingQrEngineProps {
  sessionId: string;
  sessionSecretKey?: string | null;
  classCode?: string;
  isActive?: boolean;
  size?: number;
  isProjector?: boolean;
}

const IsolatedRotatingQrEngine: React.FC<IsolatedRotatingQrEngineProps> = React.memo(({
  sessionId,
  sessionSecretKey,
  classCode = "",
  isActive = true,
  size = 330,
  isProjector = false,
}) => {
  const [currentToken, setCurrentToken] = useState<string>("");
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

        // Generate immediate synchronous 1st payload on frame 0
        const initial = generateRotatingQrPayload(key, sessionId, classCode);
        setCurrentToken(serializeQrPayload(initial));

        // Start dedicated 3000ms client-side TOTP engine in memory
        stopPolling = startQrPolling(
          key,
          sessionId,
          classCode,
          (payload: RotatingQrPayload) => {
            if (!cancelled) {
              setCurrentToken(serializeQrPayload(payload));
            }
          },
          3000
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
  }, [sessionId, isActive, classCode]);

  const renderToken = currentToken || "smartattend://session/init";

  return (
    <div className="relative flex flex-col items-center justify-center">
      {/* High-Contrast, Glare-Free, Static QR Frame (Zero Blur / Zero Scaling Jitter) */}
      <div
        className={`relative rounded-3xl bg-white p-6 shadow-xl border ${
          isProjector
            ? "border-emerald-500/60 p-8 shadow-[0_0_50px_rgba(16,185,129,0.3)]"
            : "border-slate-200 shadow-slate-200/60"
        }`}
      >
        {/* Crisp QR Code without animation scale distortions */}
        <QRCode
          value={renderToken}
          size={size}
          level="M"
          style={{ width: "100%", maxWidth: size, height: "auto", display: "block" }}
        />
      </div>
    </div>
  );
});
IsolatedRotatingQrEngine.displayName = "IsolatedRotatingQrEngine";

export const LiveSessionStudio: React.FC<LiveSessionStudioProps> = React.memo(({
  activeSession,
  sessionSecretKey,
  liveAttendance,
  attendanceStatusMap,
  manualLoading,
  manualEnrollment,
  setManualEnrollment,
  onLoadAttendees,
  onManualAttendance,
  onStopSession,
  onCancelSession,
  selectedSubject,
  selectedDepartment,
}) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isReviewMode, setIsReviewMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const fullscreenContainerRef = useRef<HTMLDivElement | null>(null);

  const sessionId = String(activeSession?.id || activeSession?._id || "");
  const classCode = String(selectedSubject?.code || selectedSubject?.name || sessionId).slice(0, 12);

  // Auto-sync roster on mount or session change
  useEffect(() => {
    setIsReviewMode(false);
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
        // Fallback to overlay mode if fullscreen API is blocked
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

  const presentCount = presentList.length;

  const formattedStartTime = useMemo(() => {
    if (!activeSession?.startTime) return "-";
    return new Date(activeSession.startTime).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }, [activeSession?.startTime]);

  // Handle Stop Session -> enter Review Mode
  const handleEnterReviewMode = () => {
    setIsReviewMode(true);
  };

  // Handle Resume Session -> exit Review Mode back to Live Dynamic QR
  const handleResumeLiveSession = () => {
    setIsReviewMode(false);
  };

  // Filtered present list by search query (for review mode or live stream filter)
  const filteredPresentList = useMemo(() => {
    if (!searchQuery.trim()) return presentList;
    const q = searchQuery.toLowerCase().trim();
    return presentList.filter(
      (s) => s.name.toLowerCase().includes(q) || s.enrollmentNo.toLowerCase().includes(q)
    );
  }, [presentList, searchQuery]);

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
                <span className="font-mono text-xl font-black">{presentCount}</span>
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
          <div className="rounded-3xl border border-slate-200/80 bg-white/90 p-6 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.06)] backdrop-blur-xl">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              {/* Left Action Buttons: Resume & Cancel */}
              <div className="flex items-center gap-3">
                <Button
                  variant="secondary"
                  onClick={handleResumeLiveSession}
                  className="rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 hover:bg-slate-100 flex items-center gap-2 cursor-pointer shadow-sm"
                >
                  <Play size={15} className="text-emerald-600 fill-emerald-600" />
                  Resume Session
                </Button>

                <Button
                  variant="outline"
                  onClick={onCancelSession}
                  className="rounded-xl px-4 py-2.5 text-xs font-semibold text-rose-600 border-rose-200 hover:bg-rose-50 hover:border-rose-300 flex items-center gap-1.5 cursor-pointer"
                >
                  <XCircle size={15} />
                  Cancel Session
                </Button>
              </div>

              {/* Right Action Button: Save Attendance */}
              <div className="flex items-center gap-3">
                <Button
                  onClick={onStopSession}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm px-7 py-2.5 rounded-xl shadow-lg shadow-emerald-600/30 flex items-center gap-2 cursor-pointer transition active:scale-95"
                >
                  <CheckCircle2 size={18} />
                  Save Attendance
                </Button>
              </div>
            </div>

            {/* Session Stats Banner */}
            <div className="mt-6 pt-5 border-t border-slate-100 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div className="rounded-2xl bg-slate-50 p-3.5 border border-slate-100">
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Subject & Section</p>
                <p className="text-sm font-bold text-slate-900 truncate mt-0.5">
                  {selectedSubject?.name || "Subject"} ({activeSession?.section || "A"})
                </p>
              </div>

              <div className="rounded-2xl bg-emerald-50/80 p-3.5 border border-emerald-100">
                <p className="text-[11px] font-semibold text-emerald-800 uppercase tracking-wider">Verified Presentees</p>
                <p className="text-xl font-mono font-black text-emerald-700 mt-0.5">{presentCount}</p>
              </div>

              <div className="rounded-2xl bg-slate-50 p-3.5 border border-slate-100">
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Session Started</p>
                <p className="text-sm font-mono font-bold text-slate-800 mt-0.5">{formattedStartTime}</p>
              </div>
            </div>
          </div>

          {/* Full-Width Single-Line Review Stream */}
          <div className="rounded-3xl border border-slate-200/80 bg-white/90 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl">
            {/* Top Bar: Title & Search Box */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="rounded-xl bg-emerald-600 text-white font-bold text-xs px-4 py-2 flex items-center gap-2 shadow-md shadow-emerald-600/20">
                  <CheckCircle2 size={15} />
                  Verified Presentees ({presentCount})
                </span>
              </div>

              {/* Search Box */}
              <div className="relative w-full sm:w-72">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search name or USN..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/70 pl-9 pr-3 py-2 text-xs font-medium text-slate-800 focus:bg-white focus:border-emerald-500 focus:outline-none focus:ring-4 focus:ring-emerald-500/10 transition"
                />
              </div>
            </div>

            {/* Student Single-Line Rows (Scrollable) */}
            <div className="mt-4 space-y-2 max-h-[520px] overflow-y-auto pr-1">
              <AnimatePresence initial={false}>
                {filteredPresentList.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center text-slate-400 text-xs border border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
                    <Users size={28} className="mb-2 text-slate-300" />
                    <p className="font-semibold text-slate-600">No present students found</p>
                    {searchQuery && <p className="mt-0.5">Try a different search keyword.</p>}
                  </div>
                ) : (
                  filteredPresentList.map((item) => (
                    <motion.div
                      key={item.enrollmentNo}
                      layout
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 4 }}
                      className="flex items-center justify-between rounded-2xl border border-emerald-200/80 bg-emerald-50/40 hover:bg-emerald-50/70 p-3.5 transition duration-150"
                    >
                      {/* 1-Line Student Identity: Small Photo, Name, USN */}
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white border border-slate-200 overflow-hidden shadow-sm">
                          {item.photoUrl ? (
                            <img src={item.photoUrl} alt={item.name} className="h-full w-full object-cover" />
                          ) : (
                            <span className="font-bold text-xs text-slate-700">
                              {item.name.slice(0, 1).toUpperCase()}
                            </span>
                          )}
                        </div>

                        <div className="min-w-0 flex flex-col sm:flex-row sm:items-center sm:gap-4">
                          <p className="truncate text-sm font-bold text-slate-900">{item.name}</p>
                          <span className="font-mono text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200/60 w-fit">
                            {item.enrollmentNo}
                          </span>
                        </div>
                      </div>

                      {/* Action Button: Red Dustbin (Remove from Presentees) */}
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => onManualAttendance("absent", item.enrollmentNo)}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-100 hover:border-rose-300 active:scale-95 transition cursor-pointer shadow-sm"
                          title="Remove from presentees"
                        >
                          <Trash2 size={15} className="text-rose-600" />
                          <span>Remove</span>
                        </button>
                      </div>
                    </motion.div>
                  ))
                )}
              </AnimatePresence>
            </div>

            {/* Manual Attendance Entry Bar */}
            <div className="mt-5 pt-4 border-t border-slate-100">
              <div className="flex gap-2 max-w-md">
                <input
                  type="text"
                  placeholder="Enter USN to add manually (e.g. 1RV21CS001)"
                  value={manualEnrollment}
                  onChange={(e) => setManualEnrollment(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && onManualAttendance("present")}
                  className="flex-1 rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2 text-xs font-medium text-slate-800 focus:bg-white focus:border-emerald-500 focus:outline-none focus:ring-4 focus:ring-emerald-500/10 transition"
                />
                <Button
                  onClick={() => onManualAttendance("present")}
                  disabled={manualLoading || !manualEnrollment.trim()}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-4 py-2 rounded-xl"
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
          <div className="relative overflow-hidden rounded-3xl border border-emerald-500/30 bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950/80 p-6 text-white shadow-[0_12px_40px_-12px_rgba(16,185,129,0.25)] backdrop-blur-xl">
            <div className="absolute top-0 right-0 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />

            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 shadow-[0_0_24px_rgba(16,185,129,0.3)]">
                  <Radio className="h-7 w-7 animate-pulse" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/40 bg-emerald-500/20 px-2.5 py-0.5 text-[11px] font-bold text-emerald-300 uppercase tracking-wide">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                      Live Attendance Active
                    </span>
                    <span className="font-mono text-xs text-slate-400">
                      ID: {sessionId.slice(-8)}
                    </span>
                  </div>
                  <h2 className="mt-1 text-2xl font-black tracking-tight text-white sm:text-3xl">
                    {selectedSubject?.name || "Live Session"}
                  </h2>
                  <p className="text-xs text-slate-300">
                    {selectedDepartment?.name || "Department"} • Year {activeSession?.year || "-"} • Sem {activeSession?.semester || "-"} • Sec {activeSession?.section || "A"}
                  </p>
                </div>
              </div>

              {/* Action Hub Buttons */}
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={openFullscreen}
                  className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-600/30 px-4 py-2.5 text-xs font-bold text-emerald-200 hover:bg-emerald-600/50 transition duration-200 shadow-sm cursor-pointer"
                >
                  <Maximize2 size={16} /> Projector HUD
                </button>
                <button
                  type="button"
                  onClick={onCancelSession}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2.5 text-xs font-semibold text-slate-300 hover:bg-slate-700 transition duration-200 cursor-pointer"
                >
                  <Square size={14} /> Cancel Session
                </button>
                <button
                  type="button"
                  onClick={handleEnterReviewMode}
                  className="inline-flex items-center gap-2 rounded-xl border border-rose-500/50 bg-rose-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-rose-700 active:scale-95 transition duration-200 shadow-[0_4px_16px_rgba(225,29,72,0.3)] cursor-pointer"
                >
                  <Square size={14} /> Stop Session
                </button>
              </div>
            </div>

          </div>

          {/* Grid: Enlarged Dynamic QR (8 cols) + Beside Stream (4 cols) */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Enlarged Space: Dynamic Rotating QR Stage (8 cols) */}
            <div className="lg:col-span-8 flex flex-col">
              <div className="relative flex-1 rounded-3xl border border-slate-200/80 bg-white/90 p-7 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl flex flex-col items-center justify-between text-center">
                <div className="w-full flex items-center justify-between pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-ping" />
                    <h3 className="font-bold text-slate-900 text-sm tracking-tight">Dynamic Rotating QR Studio</h3>
                  </div>
                  <span className="flex items-center gap-1 font-semibold text-xs text-emerald-600">
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

                <div className="w-full rounded-2xl bg-slate-50 border border-slate-100 p-3.5 text-left">
                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span className="flex items-center gap-1.5 font-medium">
                      <Clock size={14} className="text-slate-400" />
                      Session Started: <strong className="font-mono text-slate-800">{formattedStartTime}</strong>
                    </span>
                    <span className="font-mono text-[11px] text-slate-400">
                      Scan via SmartAttend Student App
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Beside Space: Live Scan Stream (4 cols) - Pure High-Performance Read-Only Ticker */}
            <div className="lg:col-span-4 flex flex-col">
              <div className="flex-1 rounded-3xl border border-slate-200/80 bg-white/90 p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl flex flex-col">
                {/* Stream Header */}
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm tracking-tight flex items-center gap-1.5">
                      <Radio size={15} className="text-emerald-500 animate-pulse" />
                      Live Scan Stream
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Real-time student check-ins
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-xl font-black text-emerald-600 flex items-center gap-1.5 justify-end">
                      <Users size={17} />
                      {presentCount}
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Checked In
                    </span>
                  </div>
                </div>

                {/* Live Feed Status Bar */}
                <div className="mt-3 flex items-center justify-between rounded-xl bg-emerald-50/80 border border-emerald-100 px-3.5 py-2 text-xs">
                  <span className="flex items-center gap-1.5 font-bold text-emerald-800">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
                    Live Scanning Active
                  </span>
                  <span className="font-mono font-bold text-emerald-700">
                    {presentCount} Present
                  </span>
                </div>

                {/* Live Stream List (Scrollable with Hardware-Accelerated 60 FPS Containment) */}
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
                      <div className="flex flex-col items-center justify-center py-14 text-center text-slate-400 text-xs border border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
                        <Radio size={24} className="mb-2 text-emerald-400 animate-pulse" />
                        <p className="font-semibold text-slate-700">Waiting for live scans</p>
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
                            className="flex items-center justify-between rounded-xl border border-emerald-200/80 bg-emerald-50/40 p-2.5 transition-colors duration-150"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white border border-slate-200 overflow-hidden shadow-sm">
                                {item.photoUrl ? (
                                  <img src={item.photoUrl} alt={item.name} className="h-full w-full object-cover" />
                                ) : (
                                  <span className="font-bold text-xs text-slate-700">
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
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100/90 border border-emerald-200 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
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
