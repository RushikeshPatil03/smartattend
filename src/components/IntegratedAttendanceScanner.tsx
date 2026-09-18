import React, { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Camera,
  CheckCircle2,
  Clock,
  MapPin,
  RefreshCw,
  Scan,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  UserCheck,
  X,
  Zap,
} from "lucide-react";
import { Button } from "./Common";
import { Html5Qrcode } from "html5-qrcode";
import { parseQrPayload, RotatingQrPayload } from "../utils/totpQrGenerator";
import { createSequentialBuffer } from "../services/sequentialQrBuffer";
import {
  assessMediaPipeFaceQuality,
  FaceQualityResult,
} from "../utils/mediaPipeFaceQuality";
import {
  compareFaceDescriptors,
  computeDescriptorFromImageURL,
  computeDescriptorFromVideoFrame,
  isModelsLoaded,
  loadModelsIfNeeded,
} from "../utils/faceApiLoader";
import { buildFaceSignatures } from "../utils/faceSignature";

type ScannerPhase = "QR_SCAN" | "FACE_ALIGN" | "SUBMITTING" | "SUCCESS" | "ERROR";

export type IntegratedScannerSuccessResult = {
  ok: boolean;
  already?: boolean;
  alreadyMarked?: boolean;
  markedAt?: string;
  session?: any;
  sessionId?: string;
  status?: string;
};

type IntegratedAttendanceScannerProps = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (result: IntegratedScannerSuccessResult) => void;
  registeredProfilePhotoUrl?: string;
  resolveLocation: () => Promise<{ lat: number; lng: number; accuracy?: number }>;
  fingerprint: string;
  submitAttendancePayload: (payload: {
    firstToken?: string;
    secondToken?: string;
    sequence?: RotatingQrPayload[];
    sessionId?: string;
    lat?: number;
    lng?: number;
    accuracy?: number;
    fingerprint: string;
    facePhotoWebp?: string;
    faceVerification?: any;
  }) => Promise<any>;
};

const STABILITY_REQUIRED_MS = 400; // 400ms stable face hold
const MANUAL_FALLBACK_DELAY_MS = 3000; // 3 seconds before manual capture button appears
const CANVAS_SIZE = 320; // 320x320 px ultra-compact downscale

export const IntegratedAttendanceScanner: React.FC<IntegratedAttendanceScannerProps> = ({
  isOpen,
  onClose,
  onSuccess,
  registeredProfilePhotoUrl,
  resolveLocation,
  fingerprint,
  submitAttendancePayload,
}) => {
  const [phase, setPhase] = useState<ScannerPhase>("QR_SCAN");
  const [statusMessage, setStatusMessage] = useState("Align QR inside the frame");
  const [errorMessage, setErrorMessage] = useState("");
  const [isFaceAligned, setIsFaceAligned] = useState(false);
  const [faceQualityReason, setFaceQualityReason] = useState("Looking for face...");
  const [showManualCapture, setShowManualCapture] = useState(false);
  const [capturedPhotoUrl, setCapturedPhotoUrl] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const sequentialBufferRef = useRef(createSequentialBuffer());

  const capturedQrDataRef = useRef<{
    kind: "totp" | "legacy";
    first?: string;
    second?: string;
    sequence?: RotatingQrPayload[];
    sessionId?: string;
  } | null>(null);

  const faceAlignmentTimerRef = useRef<number | null>(null);
  const stabilityStartTimeRef = useRef<number | null>(null);
  const manualFallbackTimerRef = useRef<number | null>(null);
  const isTransitioningRef = useRef(false);
  const animationFrameIdRef = useRef<number | null>(null);

  // Stop active camera tracks safely
  const stopCurrentStream = useCallback(() => {
    if (activeStreamRef.current) {
      activeStreamRef.current.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {}
      });
      activeStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  // Initialize camera stream on current video element
  const startCamera = useCallback(
    async (facingMode: "environment" | "user"): Promise<MediaStream | null> => {
      stopCurrentStream();
      try {
        const constraints: MediaStreamConstraints = {
          audio: false,
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: facingMode === "environment" ? 640 : 480 },
            height: { ideal: facingMode === "environment" ? 480 : 480 },
            frameRate: { ideal: 30 },
          },
        };

        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch {
          // Fallback to simple facingMode if ideal object fails
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode },
          });
        }

        activeStreamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        return stream;
      } catch (err: any) {
        console.error("Camera access error:", err);
        setErrorMessage(
          err?.name === "NotAllowedError"
            ? "Camera permission was denied. Please allow camera access."
            : "Could not start camera. Please ensure no other app is using it."
        );
        setPhase("ERROR");
        return null;
      }
    },
    [stopCurrentStream]
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // PHASE 1: QR Scanning Engine
  // ─────────────────────────────────────────────────────────────────────────────
  const startQrScanner = useCallback(async () => {
    setPhase("QR_SCAN");
    setStatusMessage("Point at the classroom Dynamic QR");
    setErrorMessage("");
    sequentialBufferRef.current.flush();
    capturedQrDataRef.current = null;

    const stream = await startCamera("environment");
    if (!stream) return;

    // Use fast BarcodeDetector if natively supported in browser, with Html5Qrcode fallback
    let isNativeBarcodeSupported = false;
    if ("BarcodeDetector" in window) {
      try {
        const formats = await (window as any).BarcodeDetector.getSupportedFormats?.();
        if (Array.isArray(formats) && formats.includes("qr_code")) {
          isNativeBarcodeSupported = true;
        }
      } catch {}
    }

    let isScanning = true;

    const handleDecodedText = (decodedText: string) => {
      if (!isScanning || isTransitioningRef.current) return;
      const raw = String(decodedText || "").trim();
      if (!raw) return;

      const totpPayload = parseQrPayload(raw);
      if (totpPayload) {
        const status = sequentialBufferRef.current.addBlock(totpPayload);
        if (status === "duplicate") {
          setStatusMessage("Block captured ✓ Hold for next rotation...");
          return;
        }

        if (status === "ready") {
          const sequence = sequentialBufferRef.current.getPayloads();
          isScanning = false;
          isTransitioningRef.current = true;
          try {
            navigator.vibrate?.(50);
          } catch {}

          capturedQrDataRef.current = {
            kind: "totp",
            sequence,
            sessionId: sequence?.[0]?.classId,
          };

          // Seamless transition directly to Face Alignment without tearing down modal
          transitionToFaceAlignment();
          return;
        }

        // First block captured
        try {
          navigator.vibrate?.(50);
        } catch {}
        setStatusMessage("Block 1 of 2 captured ✓ Keep camera steady...");
        return;
      }

      // Single/Legacy QR token
      if (raw.length > 20) {
        isScanning = false;
        isTransitioningRef.current = true;
        try {
          navigator.vibrate?.(50);
        } catch {}

        capturedQrDataRef.current = {
          kind: "legacy",
          first: raw,
          second: raw,
        };

        transitionToFaceAlignment();
      }
    };

    if (isNativeBarcodeSupported) {
      const barcodeDetector = new (window as any).BarcodeDetector({
        formats: ["qr_code"],
      });

      const scanLoop = async () => {
        if (!isScanning || !videoRef.current) return;
        if (videoRef.current.readyState >= 2) {
          try {
            const barcodes = await barcodeDetector.detect(videoRef.current);
            if (barcodes.length > 0 && barcodes[0].rawValue) {
              handleDecodedText(barcodes[0].rawValue);
            }
          } catch {}
        }
        if (isScanning) {
          animationFrameIdRef.current = window.requestAnimationFrame(scanLoop);
        }
      };
      animationFrameIdRef.current = window.requestAnimationFrame(scanLoop);
    } else {
      // Fallback to Html5Qrcode video scanner
      try {
        const scannerId = "integrated-qr-video-region";
        if (!html5QrCodeRef.current) {
          html5QrCodeRef.current = new Html5Qrcode(scannerId, {
            formatsToSupport: [0], // QR_CODE
            verbose: false,
          });
        }
        await html5QrCodeRef.current.start(
          { facingMode: "environment" },
          { fps: 20, qrbox: { width: 260, height: 260 } },
          (decodedText) => handleDecodedText(decodedText),
          () => {}
        );
      } catch (err) {
        console.warn("Html5Qrcode start warning:", err);
      }
    }
  }, [startCamera]);

  // ─────────────────────────────────────────────────────────────────────────────
  // PHASE 2: Seamless Transition to Face Verification Viewport
  // ─────────────────────────────────────────────────────────────────────────────
  const transitionToFaceAlignment = useCallback(async () => {
    // Stop QR detector loop
    if (animationFrameIdRef.current) {
      window.cancelAnimationFrame(animationFrameIdRef.current);
      animationFrameIdRef.current = null;
    }
    if (html5QrCodeRef.current) {
      try {
        await html5QrCodeRef.current.stop();
      } catch {}
    }

    setPhase("FACE_ALIGN");
    setStatusMessage("Center your face inside the circle");
    setIsFaceAligned(false);
    setShowManualCapture(false);
    stabilityStartTimeRef.current = null;
    isTransitioningRef.current = false;

    // Switch camera to front (user) mode on existing video element
    const stream = await startCamera("user");
    if (!stream) return;

    // Start 3-second manual fallback timer
    if (manualFallbackTimerRef.current) {
      window.clearTimeout(manualFallbackTimerRef.current);
    }
    manualFallbackTimerRef.current = window.setTimeout(() => {
      setShowManualCapture(true);
    }, MANUAL_FALLBACK_DELAY_MS);

    // Run continuous Face Quality & Alignment loop
    let isAnalyzing = true;

    const analyzeFaceLoop = async () => {
      if (!isAnalyzing || !videoRef.current || phase === "SUBMITTING" || phase === "SUCCESS") {
        return;
      }

      if (videoRef.current.readyState >= 2) {
        try {
          const quality: FaceQualityResult = await assessMediaPipeFaceQuality(
            videoRef.current
          );

          if (quality.ok && quality.centered && quality.largeEnough) {
            setIsFaceAligned(true);
            setFaceQualityReason("Hold still...");

            if (!stabilityStartTimeRef.current) {
              stabilityStartTimeRef.current = performance.now();
            } else if (
              performance.now() - stabilityStartTimeRef.current >=
              STABILITY_REQUIRED_MS
            ) {
              // 400ms Stable Centered Face reached -> Trigger Auto Capture!
              isAnalyzing = false;
              try {
                navigator.vibrate?.(50);
              } catch {}
              await executeCaptureAndSubmit();
              return;
            }
          } else {
            setIsFaceAligned(false);
            stabilityStartTimeRef.current = null;
            setFaceQualityReason(quality.reason || "Position face in circle");
          }
        } catch (err) {
          // Fallback if MediaPipe throws
          setIsFaceAligned(false);
        }
      }

      if (isAnalyzing) {
        animationFrameIdRef.current = window.requestAnimationFrame(analyzeFaceLoop);
      }
    };

    animationFrameIdRef.current = window.requestAnimationFrame(analyzeFaceLoop);
  }, [startCamera, phase]);

  // ─────────────────────────────────────────────────────────────────────────────
  // PHASE 3: Capture Frame (Downscale 320x320 WebP) and Dispatch
  // ─────────────────────────────────────────────────────────────────────────────
  const executeCaptureAndSubmit = useCallback(async () => {
    if (isTransitioningRef.current) return;
    isTransitioningRef.current = true;

    if (manualFallbackTimerRef.current) {
      window.clearTimeout(manualFallbackTimerRef.current);
      manualFallbackTimerRef.current = null;
    }
    if (animationFrameIdRef.current) {
      window.cancelAnimationFrame(animationFrameIdRef.current);
      animationFrameIdRef.current = null;
    }

    setPhase("SUBMITTING");
    setStatusMessage("Locking location & confirming attendance...");

    try {
      const video = videoRef.current;
      if (!video || !video.videoWidth || !video.videoHeight) {
        throw new Error("Camera feed unavailable for capture");
      }

      // Downscale to exactly 320x320 px canvas
      const canvas = canvasRef.current || document.createElement("canvas");
      canvas.width = CANVAS_SIZE;
      canvas.height = CANVAS_SIZE;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("Canvas context creation failed");

      // Center crop square from video
      const vWidth = video.videoWidth;
      const vHeight = video.videoHeight;
      const side = Math.min(vWidth, vHeight);
      const sourceX = (vWidth - side) / 2;
      const sourceY = Math.max(0, (vHeight - side) / 2);

      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(video, sourceX, sourceY, side, side, 0, 0, CANVAS_SIZE, CANVAS_SIZE);

      // Generate ultra-compact WebP payload (~8-15KB)
      let webpDataUrl = canvas.toDataURL("image/webp", 0.82);
      if (!webpDataUrl.startsWith("data:image/webp")) {
        webpDataUrl = canvas.toDataURL("image/jpeg", 0.82);
      }
      setCapturedPhotoUrl(webpDataUrl);

      // Evaluate face descriptor concurrently
      let faceVerification: any = {
        matched: false,
        method: "client-faceapi",
      };

      if (registeredProfilePhotoUrl) {
        try {
          const [refDesc, liveDesc] = await Promise.all([
            computeDescriptorFromImageURL(registeredProfilePhotoUrl),
            computeDescriptorFromVideoFrame(video),
          ]);

          const comparison = await compareFaceDescriptors(refDesc, liveDesc);
          faceVerification = {
            matched: comparison.matched,
            distance: comparison.distance,
            similarity: comparison.similarity,
            threshold: comparison.threshold,
            method: "client-faceapi",
          };
        } catch (err: any) {
          faceVerification = {
            matched: false,
            error: err?.message || "Face verification failed",
            method: "client-faceapi",
          };
        }
      }

      // Concurrently fetch GPS location
      const coords = await resolveLocation();

      // Dispatch unified payload
      const qrData = capturedQrDataRef.current;
      const payload: any = {
        lat: coords?.lat,
        lng: coords?.lng,
        accuracy: coords?.accuracy,
        fingerprint,
        facePhotoWebp: webpDataUrl,
        faceVerification,
      };

      if (qrData?.kind === "totp") {
        payload.sequence = qrData.sequence;
        payload.sessionId = qrData.sessionId;
      } else {
        payload.firstToken = qrData?.first;
        payload.secondToken = qrData?.second;
      }

      const res = await submitAttendancePayload(payload);

      if (res?.ok) {
        // Instant visual and haptic confirmation
        try {
          navigator.vibrate?.([50, 30, 50]);
        } catch {}

        setPhase("SUCCESS");
        setStatusMessage(
          res.already || res.alreadyMarked
            ? "Attendance Already Marked ✓"
            : "Attendance Verified & Marked ✓"
        );

        onSuccess(res);

        // Auto close modal after 1.5s
        window.setTimeout(() => {
          stopCurrentStream();
          onClose();
        }, 1500);
      } else {
        throw new Error(res?.error || res?.message || "Failed to record attendance");
      }
    } catch (err: any) {
      console.error("Attendance submission error:", err);
      try {
        navigator.vibrate?.(400);
      } catch {}
      setPhase("ERROR");
      setErrorMessage(err?.message || "Attendance verification failed");
    } finally {
      isTransitioningRef.current = false;
    }
  }, [
    fingerprint,
    registeredProfilePhotoUrl,
    resolveLocation,
    submitAttendancePayload,
    stopCurrentStream,
    onSuccess,
    onClose,
  ]);

  // Lifecycle control
  useEffect(() => {
    if (isOpen) {
      void startQrScanner();
    } else {
      stopCurrentStream();
      if (html5QrCodeRef.current) {
        html5QrCodeRef.current.stop().catch(() => {});
      }
      if (animationFrameIdRef.current) {
        window.cancelAnimationFrame(animationFrameIdRef.current);
        animationFrameIdRef.current = null;
      }
      if (manualFallbackTimerRef.current) {
        window.clearTimeout(manualFallbackTimerRef.current);
        manualFallbackTimerRef.current = null;
      }
    }
    return () => {
      stopCurrentStream();
      if (html5QrCodeRef.current) {
        html5QrCodeRef.current.stop().catch(() => {});
      }
      if (animationFrameIdRef.current) {
        window.cancelAnimationFrame(animationFrameIdRef.current);
      }
      if (manualFallbackTimerRef.current) {
        window.clearTimeout(manualFallbackTimerRef.current);
      }
    };
  }, [isOpen, startQrScanner, stopCurrentStream]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-md rounded-[32px] border border-white/15 bg-gradient-to-b from-slate-900 via-slate-900/98 to-slate-950 shadow-2xl overflow-hidden flex flex-col items-center text-white">
        {/* Ambient background glow */}
        <div
          className={`absolute -top-16 -right-16 h-48 w-48 rounded-full blur-3xl pointer-events-none transition-colors duration-500 ${
            phase === "SUCCESS"
              ? "bg-emerald-500/30"
              : isFaceAligned
              ? "bg-emerald-500/20"
              : "bg-indigo-500/20"
          }`}
        />

        {/* Header bar */}
        <div className="w-full flex items-center justify-between p-4 sm:p-5 border-b border-white/10 relative z-10">
          <div className="flex items-center gap-2.5">
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-xl border transition-colors ${
                phase === "SUCCESS"
                  ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400"
                  : phase === "FACE_ALIGN"
                  ? "bg-teal-500/20 border-teal-500/40 text-teal-300"
                  : "bg-indigo-500/20 border-indigo-500/40 text-indigo-300"
              }`}
            >
              {phase === "SUCCESS" ? (
                <CheckCircle2 size={18} />
              ) : phase === "FACE_ALIGN" ? (
                <UserCheck size={18} />
              ) : (
                <Scan size={18} />
              )}
            </div>
            <div>
              <h3 className="font-extrabold text-sm tracking-tight text-white">
                {phase === "QR_SCAN"
                  ? "Scan Attendance QR"
                  : phase === "FACE_ALIGN"
                  ? "Face Alignment"
                  : phase === "SUBMITTING"
                  ? "Submitting..."
                  : phase === "SUCCESS"
                  ? "Attendance Confirmed"
                  : "Verification Error"}
              </h3>
              <p className="text-[11px] text-slate-400 font-medium">
                {phase === "QR_SCAN"
                  ? "Step 1 of 2: Scan QR"
                  : phase === "FACE_ALIGN"
                  ? "Step 2 of 2: Auto-verify face"
                  : "Seamless 1-tap verification"}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-full bg-slate-800/80 hover:bg-slate-700 transition cursor-pointer"
            title="Cancel"
          >
            <X size={16} />
          </button>
        </div>

        {/* Viewport Area */}
        <div className="relative w-full aspect-square max-h-[360px] bg-black overflow-hidden flex items-center justify-center">
          {/* Main Video Stream */}
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className={`w-full h-full object-cover transition-opacity duration-300 ${
              phase === "SUBMITTING" || phase === "SUCCESS"
                ? "opacity-30"
                : "opacity-100"
            }`}
          />

          {/* Hidden Canvas for 320x320 Downscale */}
          <canvas ref={canvasRef} className="hidden" />

          {/* Fallback container for Html5Qrcode if needed */}
          <div id="integrated-qr-video-region" className="hidden" />

          {/* QR Scan Reticle Overlay */}
          {phase === "QR_SCAN" && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="relative w-56 h-56 rounded-3xl border-2 border-indigo-400/80 bg-indigo-500/10 backdrop-blur-2xs shadow-[0_0_40px_rgba(99,102,241,0.3)] flex items-center justify-center animate-pulse">
                {/* Corner accent marks */}
                <div className="absolute -top-1 -left-1 w-6 h-6 border-t-3 border-l-3 border-indigo-400 rounded-tl-xl" />
                <div className="absolute -top-1 -right-1 w-6 h-6 border-t-3 border-r-3 border-indigo-400 rounded-tr-xl" />
                <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-3 border-l-3 border-indigo-400 rounded-bl-xl" />
                <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-3 border-r-3 border-indigo-400 rounded-br-xl" />
                <Scan size={36} className="text-indigo-300 opacity-60" />
              </div>
            </div>
          )}

          {/* Face Alignment Circular Guide Overlay */}
          {phase === "FACE_ALIGN" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              {/* Circular Reticle with Active/Inactive Ring */}
              <div
                className={`relative w-64 h-64 rounded-full border-3 transition-all duration-300 flex items-center justify-center ${
                  isFaceAligned
                    ? "border-emerald-400 bg-emerald-500/15 shadow-[0_0_50px_rgba(16,185,129,0.5)] scale-102"
                    : "border-dashed border-amber-300/80 bg-black/25 shadow-[0_0_30px_rgba(0,0,0,0.5)]"
                }`}
              >
                {/* Animated active pulse */}
                {isFaceAligned && (
                  <div className="absolute inset-0 rounded-full border-2 border-emerald-400 animate-ping opacity-75" />
                )}

                {/* Center crosshair dot */}
                <div
                  className={`h-2 w-2 rounded-full transition-colors ${
                    isFaceAligned ? "bg-emerald-400" : "bg-amber-300/80"
                  }`}
                />
              </div>

              {/* Real-time Guide Status Pill */}
              <div className="mt-4 px-4 py-1.5 rounded-full bg-slate-900/90 border border-white/20 backdrop-blur-md shadow-lg">
                <p
                  className={`text-xs font-bold transition-colors ${
                    isFaceAligned ? "text-emerald-400" : "text-amber-300"
                  }`}
                >
                  {faceQualityReason}
                </p>
              </div>
            </div>
          )}

          {/* Submitting Loading Overlay */}
          {phase === "SUBMITTING" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/75 backdrop-blur-md p-6 text-center">
              <RefreshCw size={36} className="text-emerald-400 animate-spin mb-3" />
              <p className="font-extrabold text-sm text-white">{statusMessage}</p>
              <p className="text-xs text-slate-400 mt-1">Securing biometric & GPS audit record...</p>
            </div>
          )}

          {/* Celebratory Checkmark Confirmation Overlay */}
          {phase === "SUCCESS" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-md p-6 text-center animate-in zoom-in-95 duration-200">
              <motion.div
                initial={{ scale: 0, rotate: -20 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
                className="flex h-20 w-20 items-center justify-center rounded-3xl bg-emerald-500 text-white shadow-[0_0_40px_rgba(16,185,129,0.6)] mb-3"
              >
                <CheckCircle2 size={44} className="stroke-[2.5]" />
              </motion.div>
              <h4 className="text-lg font-black text-white">{statusMessage}</h4>
              <p className="text-xs text-emerald-300 font-medium mt-1">
                Sub-2.5s Verification Complete
              </p>
            </div>
          )}

          {/* Error State Overlay */}
          {phase === "ERROR" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 backdrop-blur-md p-6 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500/20 border border-rose-500/40 text-rose-400 mb-3">
                <ShieldAlert size={28} />
              </div>
              <h4 className="text-sm font-extrabold text-white">Verification Failed</h4>
              <p className="text-xs text-rose-300 max-w-xs mt-1 mb-4">
                {errorMessage || "Unable to complete attendance verification."}
              </p>
              <button
                type="button"
                onClick={startQrScanner}
                className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-white transition cursor-pointer"
              >
                Try Again
              </button>
            </div>
          )}
        </div>

        {/* Footer info & Manual capture fallback */}
        <div className="w-full p-4 flex flex-col items-center gap-2.5 relative z-10 bg-slate-950/60 border-t border-white/10">
          {phase === "QR_SCAN" && (
            <p className="text-xs text-slate-300 font-medium text-center">
              {statusMessage}
            </p>
          )}

          {phase === "FACE_ALIGN" && (
            <div className="w-full flex flex-col items-center gap-2">
              <p className="text-xs text-slate-400 text-center font-medium">
                Auto-capture will trigger as soon as your face is centered and steady.
              </p>

              {/* 3-Second Fallback Manual Capture Button */}
              {showManualCapture && (
                <motion.button
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  type="button"
                  onClick={executeCaptureAndSubmit}
                  className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 active:scale-98 font-bold text-xs text-white shadow-lg transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Camera size={15} />
                  <span>Capture Face Now (Manual Fallback)</span>
                </motion.button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default IntegratedAttendanceScanner;
