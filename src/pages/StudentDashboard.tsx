import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../store";
import { Button, Card, Badge } from "../components/Common";
import CollegeHeader from "../components/CollegeHeader";
import { Scan, MapPin, CheckCircle, XCircle, History, Camera, LoaderCircle, X } from "lucide-react";
import { markAttendanceTwoStep, getFingerprint } from "../services/attendanceClient";
import apiClient from "../services/apiClient";
import { getLiveLocationWithOptions, prewarmLiveLocation } from "../utils/liveLocation";
import { createSequentialBuffer } from "../services/sequentialQrBuffer";
import { parseQrPayload, RotatingQrPayload } from "../utils/totpQrGenerator";

import { loadModelsIfNeeded, computeDescriptorFromImageURL } from "../utils/faceApiLoader";

const preloadCameraQrScanner = () => import("../components/CameraQrScanner");
const CameraQrScanner = React.lazy(preloadCameraQrScanner);
const preloadLivePhotoCapture = () => import("../components/LivePhotoCapture");
const LivePhotoCapture = React.lazy(preloadLivePhotoCapture);

type IdleCapableWindow = Window &
  typeof globalThis & {
    requestIdleCallback?: (
      callback: IdleRequestCallback,
      options?: IdleRequestOptions
    ) => number;
    cancelIdleCallback?: (handle: number) => void;
  };

const DYNAMIC_SECOND_SCAN_TIMEOUT_MS = 10000;
const MIN_DYNAMIC_ROTATION_WAIT_MS = Math.max(
  1200,
  Number(import.meta.env.VITE_MIN_SECOND_SCAN_DELAY_MS || 2500)
);
const MAX_DYNAMIC_SEQUENCE_GAP_SECONDS = Math.max(
  4,
  Number(import.meta.env.VITE_QR_SEQUENCE_GAP_SECONDS || 7)
);
const FIRST_DYNAMIC_ARM_WINDOW_MS = 2500;
const FACE_VERIFICATION_WINDOW_MS = 60000;
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

const StudentDashboard: React.FC = () => {
  const { currentUser, logout } = useApp();

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
  const [faceGateOpen, setFaceGateOpen] = useState(true);
  const [faceGateStatus, setFaceGateStatus] = useState<"VERIFYING" | "MATCHING" | "FAILED">("VERIFYING");
  const [faceGateMessage, setFaceGateMessage] = useState("");
  const [liveFacePhoto, setLiveFacePhoto] = useState("");
  const [faceVerifiedUntil, setFaceVerifiedUntil] = useState(0);

  const mountedRef = useRef(true);
  const submitLockRef = useRef(false);
  const resetTimerRef = useRef<number | null>(null);
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
    if (registeredFacePhoto) {
      void computeDescriptorFromImageURL(registeredFacePhoto);
    }
    return () => {
      mountedRef.current = false;
      if (resetTimerRef.current) {
        window.clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
      if (firstDynamicArmTimeoutRef.current) {
        window.clearTimeout(firstDynamicArmTimeoutRef.current);
        firstDynamicArmTimeoutRef.current = null;
      }
      if (faceGateTimerRef.current) window.clearTimeout(faceGateTimerRef.current);
    };
  }, [registeredFacePhoto]);

  const handleLiveFaceCaptured = useCallback((capture: {
    faceVerification?: { matched?: boolean; liveness?: string };
  }) => {
    if (!capture.faceVerification?.matched || capture.faceVerification.liveness !== "movement") {
      setFaceVerifiedUntil(0);
      setFaceGateStatus("FAILED");
      setFaceGateMessage("Live face verification is required.");
      return;
    }

    const verifiedUntil = Date.now() + FACE_VERIFICATION_WINDOW_MS;
    if (faceGateTimerRef.current) window.clearTimeout(faceGateTimerRef.current);
    setFaceVerifiedUntil(verifiedUntil);
    setFaceGateOpen(false);
    setLiveFacePhoto("");
    setFaceGateStatus("VERIFYING");
    setFaceGateMessage("");
    faceGateTimerRef.current = window.setTimeout(() => {
      if (!mountedRef.current) return;
      setFaceVerifiedUntil(0);
      setFaceGateOpen(true);
      setFaceGateStatus("VERIFYING");
      setFaceGateMessage("Face verification expired. Verify again to mark attendance.");
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

  const warmLocation = useCallback(() => {
    if (locationWarmupPromiseRef.current) {
      return locationWarmupPromiseRef.current;
    }

    const promise = prewarmLiveLocation({ maxAgeMs: 15000 })
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
    const warmed = await warmLocation();
    if (warmed) return warmed;

    const fresh = await getLiveLocationWithOptions({
      preferCached: true,
      maxAgeMs: 15000,
    });
    if (mountedRef.current) {
      setLocationReady(true);
    }
    return fresh;
  }, [warmLocation]);

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
    const pair = await openDynamicPairScanner(false);
    if (!pair) {
      pendingQrPairRef.current = null;
      setScanStep("IDLE");
      setStatusMsg("");
      setBusy(false);
      return;
    }

    pendingQrPairRef.current = pair;
    setScanStep("SUBMITTING");
    setStatusMsg("Confirming attendance with QR and GPS...");

    const coords = await resolveLiveLocation();
    const fingerprint = getFingerprint();

    let result: any = null;

    try {
      if (pendingQrPairRef.current.kind === "totp") {
        const seq = pendingQrPairRef.current.sequence;
        const targetSessionId = seq?.[0]?.classId || (seq?.[0] as any)?.sessionId;
        result = await apiClient.post("/api/attendance/submit", {
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
        result = await markAttendanceTwoStep(
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
    } catch (err: any) {
      result = { ok: false, error: err?.message || "Failed to submit attendance" };
    }

    if (result?.ok) {
      pendingQrPairRef.current = null;
      setScanStep("SUCCESS");
      setStatusMsg(result.already || result.alreadyMarked ? "Attendance already marked." : "Attendance confirmed.");
      await loadStudentData();
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

  const simulateScan = useCallback(async () => {
    if (submitLockRef.current || busy) return;
    if (faceVerifiedUntil <= Date.now()) {
      setFaceVerifiedUntil(0);
      setFaceGateOpen(true);
      setFaceGateStatus("VERIFYING");
      setFaceGateMessage("Verify your face before marking attendance.");
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
    faceVerifiedUntil,
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
      {faceGateOpen && (
        <div className="fixed inset-0 z-[75] overflow-y-auto bg-black/85 p-4">
          <div className="mx-auto flex min-h-full w-full max-w-xl items-center justify-center py-4">
            <React.Suspense fallback={<div className="text-sm text-white">Opening face verification...</div>}>
              <LivePhotoCapture
                value={liveFacePhoto}
                onChange={setLiveFacePhoto}
                onCaptured={handleLiveFaceCaptured}
                disabled={faceGateStatus === "MATCHING" || !registeredFacePhoto}
                autoStart
                autoCapture
                hideLauncher
                compactMode
                showCapturedPreview={false}
                enableFaceQuality
                faceVerificationReferenceUrl={registeredFacePhoto}
                title="Verify Face"
                description={
                  !registeredFacePhoto
                    ? "No registered student profile photo is available."
                    : faceGateMessage || "Hold the phone upright and center your face to continue."
                }
              />
            </React.Suspense>
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
              onClick={simulateScan}
              className="bg-teal-600 hover:bg-teal-500 active:bg-teal-700 w-full py-4 text-base sm:text-lg font-bold text-white shadow-lg shadow-teal-950/50 rounded-xl cursor-pointer"
              disabled={busy || !faceVerified}
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
