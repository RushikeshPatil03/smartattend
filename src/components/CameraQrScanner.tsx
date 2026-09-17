import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Button } from "./Common";
import { Clock, RefreshCw, Search, ShieldAlert, ZoomIn, ZoomOut, Minus, Plus, Sparkles } from "lucide-react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";

type DetectorResult = { rawValue?: string };

declare global {
  interface Window {
    BarcodeDetector?: {
      new (options?: { formats?: string[] }): {
        detect: (source: CanvasImageSource) => Promise<DetectorResult[]>;
      };
      getSupportedFormats?: () => Promise<string[]>;
    };
  }
}

type CameraQrScannerProps = {
  title: string;
  hint?: string;
  statusTone?: "neutral" | "success" | "error";
  actionLabel?: string;
  onAction?: () => void;
  onCancel: () => void;
  onDetected: (value: string) => boolean | void;
  isScannerActive?: boolean;
  faceVerifiedExpiresAt?: number;
  onSessionExpired?: () => void;
};

let envStreamPool: MediaStream | null = null;
let envStreamPoolPromise: Promise<MediaStream | null> | null = null;

const ENV_CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 640 },
    height: { ideal: 480 },
    frameRate: { ideal: 24, max: 30 },
  },
};

const ENV_CAMERA_FALLBACK_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: { facingMode: "environment" },
};

function isEnvStreamUsable(stream: MediaStream | null): stream is MediaStream {
  if (!stream || !stream.active) return false;
  const tracks = stream.getVideoTracks();
  return tracks.length > 0 && tracks.some((t) => t.readyState === "live" && !t.muted);
}

export async function prewarmQrCamera(): Promise<void> {
  if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) return;
  if (isEnvStreamUsable(envStreamPool)) return;
  if (envStreamPoolPromise) return;

  envStreamPoolPromise = (async () => {
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(ENV_CAMERA_CONSTRAINTS);
      } catch {
        stream = await navigator.mediaDevices.getUserMedia(ENV_CAMERA_FALLBACK_CONSTRAINTS);
      }
      envStreamPool = stream;
      return stream;
    } catch {
      return null;
    } finally {
      envStreamPoolPromise = null;
    }
  })();
}

export async function consumeEnvStreamPool(): Promise<MediaStream | null> {
  if (isEnvStreamUsable(envStreamPool)) {
    const stream = envStreamPool;
    envStreamPool = null;
    return stream;
  }
  if (envStreamPoolPromise) {
    const stream = await envStreamPoolPromise;
    envStreamPool = null;
    return isEnvStreamUsable(stream) ? stream : null;
  }
  return null;
}

const SCAN_INTERVAL_MS = 60;
const DUPLICATE_DETECTION_COOLDOWN_MS = 400;

function isInsecureMobileCameraContext() {
  const host = window.location.hostname;
  const isLocalHost = host === "localhost" || host === "127.0.0.1";
  return !window.isSecureContext && !isLocalHost;
}

function getCameraErrorMessage(err: any): string {
  if (isInsecureMobileCameraContext()) {
    return "Camera requires HTTPS or localhost when opened on a mobile device.";
  }
  const errName = String(err?.name || "");
  const errMsg = String(err?.message || "").toLowerCase();
  if (errName === "NotAllowedError" || errMsg.includes("permission")) {
    return "Camera permission was denied. Allow camera access in browser settings to scan QR.";
  }
  if (errName === "NotFoundError" || errMsg.includes("not found")) {
    return "No suitable camera found on this device.";
  }
  if (errName === "NotReadableError" || errMsg.includes("in use")) {
    return "Camera is busy in another app. Close other camera apps and retry.";
  }
  return "Unable to start camera scanner. Check camera permissions.";
}

/** Haptic feedback on successful scan */
function triggerScanHaptic() {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate([40, 60, 40]);
    }
  } catch {
    // Haptics unavailable on this device/browser
  }
}

export default function CameraQrScanner({
  title,
  hint,
  statusTone = "neutral",
  actionLabel,
  onAction,
  onCancel,
  onDetected,
  isScannerActive = false,
  faceVerifiedExpiresAt,
  onSessionExpired,
}: CameraQrScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fallbackRegionIdRef = useRef(`qr-fallback-${Math.random().toString(36).slice(2)}`);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<{ detect: (source: CanvasImageSource) => Promise<DetectorResult[]> } | null>(null);
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const onDetectedRef = useRef(onDetected);
  const onSessionExpiredRef = useRef(onSessionExpired);
  const rafRef = useRef<number | null>(null);
  const decodeLockRef = useRef(false);
  const lastScanAtRef = useRef(0);
  const lastDetectedValueRef = useRef("");
  const lastDetectedAtRef = useRef(0);
  const mountedRef = useRef(true);

  // Zoom control state & refs
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [zoomRange, setZoomRange] = useState<{ min: number; max: number; step: number }>({ min: 1.0, max: 3.5, step: 0.1 });
  const [zoomValue, setZoomValue] = useState<number>(1.0);
  const [isHardwareZoom, setIsHardwareZoom] = useState(false);
  const [usingFallback, setUsingFallback] = useState(false);
  const [restartNonce, setRestartNonce] = useState(0);
  const [scanSuccessPulse, setScanSuccessPulse] = useState(false);

  // Non-blocking concurrency refs for smooth zoom & scanning loop
  const zoomLevelRef = useRef<number>(1.0);
  const isHardwareZoomRef = useRef(false);
  const pendingHardwareZoomRef = useRef<number | null>(null);
  const isApplyingHardwareZoomRef = useRef(false);

  // Pinch-to-zoom touch gesture refs
  const pinchStartDistRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef<number>(1.0);
  const [isPinching, setIsPinching] = useState(false);

  const isScanSuccess = scanSuccessPulse || statusTone === "success";

  useEffect(() => {
    onSessionExpiredRef.current = onSessionExpired;
  }, [onSessionExpired]);

  useEffect(() => {
    if (!faceVerifiedExpiresAt || faceVerifiedExpiresAt <= 0) {
      return;
    }

    const remainingMs = faceVerifiedExpiresAt - Date.now();
    if (remainingMs <= 0) {
      onSessionExpiredRef.current?.();
      return;
    }

    const timer = window.setTimeout(() => {
      onSessionExpiredRef.current?.();
    }, remainingMs);

    return () => window.clearTimeout(timer);
  }, [faceVerifiedExpiresAt]);

  const detectorSupported = useMemo(
    () => typeof window !== "undefined" && typeof window.BarcodeDetector !== "undefined",
    []
  );

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Concurrency-safe hardware zoom scheduler: drops intermediate stale values and queues latest
  const scheduleHardwareZoom = useCallback((targetZoom: number) => {
    pendingHardwareZoomRef.current = targetZoom;
    if (isApplyingHardwareZoomRef.current) return;

    const runQueue = async () => {
      isApplyingHardwareZoomRef.current = true;
      while (pendingHardwareZoomRef.current !== null && mountedRef.current) {
        const zoomToApply = pendingHardwareZoomRef.current;
        pendingHardwareZoomRef.current = null;
        const track = streamRef.current?.getVideoTracks?.()[0];
        if (track && track.readyState === "live") {
          try {
            await track.applyConstraints({
              advanced: [{ zoom: zoomToApply } as MediaTrackConstraintSet],
            });
          } catch {
            // Hardware constraint failed; smoothly fallback to software digital zoom
            isHardwareZoomRef.current = false;
            if (mountedRef.current) {
              setIsHardwareZoom(false);
            }
            break;
          }
        }
      }
      isApplyingHardwareZoomRef.current = false;
    };

    void runQueue();
  }, []);

  const handleZoomChange = useCallback((nextValue: number) => {
    const clamped = Math.min(Math.max(nextValue, zoomRange.min), zoomRange.max);
    const rounded = Math.round(clamped * 10) / 10;
    setZoomValue(rounded);
    zoomLevelRef.current = rounded;

    if (isHardwareZoomRef.current) {
      scheduleHardwareZoom(rounded);
    }
  }, [zoomRange, scheduleHardwareZoom]);

  // Touch Pinch-to-Zoom handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      pinchStartDistRef.current = dist;
      pinchStartZoomRef.current = zoomLevelRef.current;
      setIsPinching(true);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchStartDistRef.current !== null) {
      const currentDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const scale = currentDist / pinchStartDistRef.current;
      const nextZoom = pinchStartZoomRef.current * scale;
      handleZoomChange(nextZoom);
    }
  };

  const handleTouchEnd = () => {
    pinchStartDistRef.current = null;
    setIsPinching(false);
  };

  useEffect(() => {
    const stopCamera = () => {
      if (rafRef.current) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      const stream = streamRef.current;
      if (stream) {
        stream.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch {
            // Ignore track stop errors on older WebViews
          }
        });
        streamRef.current = null;
      }
      if (videoRef.current) {
        try {
          videoRef.current.pause();
        } catch {
          // ignore
        }
        videoRef.current.srcObject = null;
      }
    };

    if (!isScannerActive) {
      void (async () => {
        const scanner = html5QrCodeRef.current;
        if (scanner && scanner.isScanning) {
          try {
            await scanner.stop();
          } catch {
            // Ignore cleanup errors.
          }
        }
      })();
      stopCamera();
      setLoading(false);
      setScanSuccessPulse(false);
      return;
    }

    const stopFallbackScanner = async () => {
      const scanner = html5QrCodeRef.current;
      html5QrCodeRef.current = null;
      if (!scanner) return;
      try {
        if (scanner.isScanning) {
          await scanner.stop();
        }
      } catch {
        // Ignore cleanup errors.
      }
      try {
        await scanner.clear();
      } catch {
        // Ignore cleanup errors.
      }
    };

    const detectFrame = async () => {
      if (!mountedRef.current || decodeLockRef.current) return;

      const now = Date.now();
      if (now - lastScanAtRef.current < SCAN_INTERVAL_MS) {
        rafRef.current = window.requestAnimationFrame(() => {
          void detectFrame();
        });
        return;
      }
      lastScanAtRef.current = now;

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const detector = detectorRef.current;
      if (!video || !canvas || !detector) return;

      if (video.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA) {
        rafRef.current = window.requestAnimationFrame(() => {
          void detectFrame();
        });
        return;
      }

      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) {
        rafRef.current = window.requestAnimationFrame(() => {
          void detectFrame();
        });
        return;
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        setError("Unable to process camera frames on this device.");
        return;
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);

      // High-precision digital zoom crop on canvas for instant distant QR recognition
      const currentZoom = zoomLevelRef.current;
      if (currentZoom > 1.01 && !isHardwareZoomRef.current) {
        const cropW = width / currentZoom;
        const cropH = height / currentZoom;
        const cropX = (width - cropW) / 2;
        const cropY = (height - cropH) / 2;
        ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, width, height);
      } else {
        ctx.drawImage(video, 0, 0, width, height);
      }

      try {
        const results = await detector.detect(canvas);
        const rawValue = String(results?.[0]?.rawValue || "").trim();
        if (rawValue) {
          if (decodeLockRef.current) return;

          const isDuplicate =
            rawValue === lastDetectedValueRef.current &&
            now - lastDetectedAtRef.current < DUPLICATE_DETECTION_COOLDOWN_MS;
          if (isDuplicate) {
            rafRef.current = window.requestAnimationFrame(() => {
              void detectFrame();
            });
            return;
          }

          lastDetectedValueRef.current = rawValue;
          lastDetectedAtRef.current = now;
          decodeLockRef.current = true;

          // Haptic vibration feedback on mobile
          triggerScanHaptic();
          if (mountedRef.current) {
            setScanSuccessPulse(true);
          }

          try {
            const shouldClose = onDetectedRef.current(rawValue);
            if (shouldClose) {
              stopCamera();
              return;
            }
          } catch {
            // Keep scanning if the parent rejects this decoded value.
          }
          decodeLockRef.current = false;
        }
      } catch {
        // Keep scanning. Barcode detector can intermittently fail on some frames.
      }

      rafRef.current = window.requestAnimationFrame(() => {
        void detectFrame();
      });
    };

    const startFallbackScanner = async () => {
      setUsingFallback(true);
      setIsHardwareZoom(false);
      isHardwareZoomRef.current = false;

      const scanner = new Html5Qrcode(fallbackRegionIdRef.current, {
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        verbose: false,
      });
      html5QrCodeRef.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 24,
          qrbox: { width: 220, height: 220 },
          aspectRatio: 1,
        },
        (decodedText) => {
          const rawValue = String(decodedText || "").trim();
          if (!rawValue) return;
          if (decodeLockRef.current) return;

          const now = Date.now();
          const isDuplicate =
            rawValue === lastDetectedValueRef.current &&
            now - lastDetectedAtRef.current < DUPLICATE_DETECTION_COOLDOWN_MS;
          if (isDuplicate) return;

          lastDetectedValueRef.current = rawValue;
          lastDetectedAtRef.current = now;
          decodeLockRef.current = true;

          // Haptic vibration feedback on mobile
          triggerScanHaptic();
          if (mountedRef.current) {
            setScanSuccessPulse(true);
          }

          try {
            const shouldClose = onDetectedRef.current(rawValue);
            if (shouldClose) {
              void stopFallbackScanner();
              return;
            }
          } catch {
            // Keep scanning if the parent rejects this decoded value.
          }
          decodeLockRef.current = false;
        },
        () => {
          // Ignore frame-level decode misses while scanning.
        }
      );
    };

    const startCamera = async () => {
      try {
        setError("");
        setLoading(true);
        setUsingFallback(false);
        setScanSuccessPulse(false);

        // Ensure any previous stream is completely stopped
        stopCamera();

        if (!detectorSupported) {
          await startFallbackScanner();
          if (mountedRef.current) {
            setLoading(false);
          }
          return;
        }

        const Detector = window.BarcodeDetector;
        if (!Detector) {
          throw new Error("QR detector not available");
        }

        detectorRef.current = new Detector({ formats: ["qr_code"] });

        let stream: MediaStream | null = await consumeEnvStreamPool();
        let lastError: any = null;

        if (!stream) {
          for (let attempt = 0; attempt < 3; attempt++) {
            if (!mountedRef.current) return;
            try {
              stream = await navigator.mediaDevices.getUserMedia(ENV_CAMERA_CONSTRAINTS);
              break;
            } catch (primaryError: any) {
              lastError = primaryError;
              if (
                primaryError?.name === "OverconstrainedError" ||
                primaryError?.name === "ConstraintNotSatisfiedError"
              ) {
                try {
                  stream = await navigator.mediaDevices.getUserMedia(ENV_CAMERA_FALLBACK_CONSTRAINTS);
                  break;
                } catch (fallbackErr: any) {
                  lastError = fallbackErr;
                  break;
                }
              } else if (
                primaryError?.name === "NotReadableError" ||
                primaryError?.name === "AbortError"
              ) {
                // Wait briefly if hardware camera is releasing from previous step
                await new Promise((res) => setTimeout(res, 220));
                continue;
              } else {
                break;
              }
            }
          }
        }

        if (!stream) {
          throw lastError || new Error("Unable to open camera stream");
        }

        if (!mountedRef.current) {
          stream.getTracks().forEach((track) => {
            try {
              track.stop();
            } catch {
              // Ignore track stop errors on older WebViews
            }
          });
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        video.setAttribute("playsinline", "true");
        video.setAttribute("autoplay", "true");
        video.muted = true;

        video.onloadedmetadata = () => {
          if (mountedRef.current) {
            setLoading(false);
          }
        };

        try {
          await video.play();
        } catch (err: any) {
          const message = String(err?.message || "").toLowerCase();
          const interrupted =
            err?.name === "AbortError" ||
            message.includes("interrupted by a new load request") ||
            message.includes("play() request was interrupted");
          if (!interrupted) {
            throw err;
          }
        }

        if (mountedRef.current) {
          setLoading(false);
        }

        const [track] = stream.getVideoTracks();
        const capabilities =
          typeof track?.getCapabilities === "function"
            ? (track.getCapabilities() as MediaTrackCapabilities & {
                zoom?: { min?: number; max?: number; step?: number };
              })
            : {};
        const zoomCaps = capabilities.zoom;

        if (
          zoomCaps &&
          typeof zoomCaps.min === "number" &&
          typeof zoomCaps.max === "number" &&
          zoomCaps.max > zoomCaps.min
        ) {
          const step = typeof zoomCaps.step === "number" && zoomCaps.step > 0 ? zoomCaps.step : 0.1;
          setZoomRange({ min: zoomCaps.min, max: zoomCaps.max, step });
          const initialZoom = Math.min(Math.max(zoomCaps.min, 1), zoomCaps.max);
          setZoomValue(initialZoom);
          zoomLevelRef.current = initialZoom;
          isHardwareZoomRef.current = true;
          setIsHardwareZoom(true);
          scheduleHardwareZoom(initialZoom);
        } else {
          // Universal high-precision digital zoom fallback for iOS Safari / desktops / non-hardware devices
          setZoomRange({ min: 1.0, max: 3.5, step: 0.1 });
          setZoomValue(1.0);
          zoomLevelRef.current = 1.0;
          isHardwareZoomRef.current = false;
          setIsHardwareZoom(false);
        }

        rafRef.current = window.requestAnimationFrame(() => {
          void detectFrame();
        });
      } catch (err: any) {
        try {
          if (detectorSupported) {
            await startFallbackScanner();
            if (mountedRef.current) {
              setLoading(false);
            }
            return;
          }
        } catch {
          // Fall through to show error.
        }
        if (mountedRef.current) {
          setLoading(false);
          setError(getCameraErrorMessage(err));
        }
      }
    };

    void startCamera();

    return () => {
      stopCamera();
      void stopFallbackScanner();
    };
  }, [detectorSupported, isScannerActive, restartNonce, scheduleHardwareZoom]);

  // Compute preset zoom options based on available zoom range
  const presetButtons = useMemo(() => {
    const min = zoomRange.min;
    const max = zoomRange.max;
    if (max <= 2.2) {
      return [
        { label: "1x", value: Math.max(min, 1.0) },
        { label: "1.5x", value: Math.min(max, 1.5) },
        { label: "2x", value: max },
      ];
    }
    return [
      { label: "1x", value: Math.max(min, 1.0) },
      { label: "1.5x", value: 1.5 },
      { label: "2x", value: 2.0 },
      { label: "3x", value: Math.min(max, 3.0) },
    ];
  }, [zoomRange]);

  // Slider background fill percentage
  const zoomPercent = useMemo(() => {
    if (!zoomRange || zoomRange.max <= zoomRange.min) return 0;
    return Math.min(
      100,
      Math.max(0, ((zoomValue - zoomRange.min) / (zoomRange.max - zoomRange.min)) * 100)
    );
  }, [zoomRange, zoomValue]);

  return (
    <div className="fixed inset-0 z-[70] bg-black/85 backdrop-blur-[2px] flex items-center justify-center p-4">
      {/* Scoped CSS for laser scan line animation & custom slider */}
      <style>{`
        @keyframes scanline {
          0% { top: 8%; opacity: 0.85; }
          50% { top: 88%; opacity: 1; }
          100% { top: 8%; opacity: 0.85; }
        }
        .qr-laser-line {
          animation: scanline 2.4s ease-in-out infinite;
          will-change: top, opacity;
        }
        .zoom-slider-track::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #14b8a6;
          border: 2px solid #ffffff;
          box-shadow: 0 0 8px rgba(20, 184, 166, 0.8);
          cursor: pointer;
          transition: transform 0.1s ease;
        }
        .zoom-slider-track::-webkit-slider-thumb:active {
          transform: scale(1.25);
        }
        .zoom-slider-track::-moz-range-thumb {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #14b8a6;
          border: 2px solid #ffffff;
          box-shadow: 0 0 8px rgba(20, 184, 166, 0.8);
          cursor: pointer;
        }
      `}</style>

      <div className="w-full max-w-md bg-slate-950 border border-slate-700/80 rounded-2xl p-4 shadow-2xl">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-white">{title}</p>
          </div>
          <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={onCancel}>
            Cancel
          </Button>
        </div>

        {/* Camera Viewport with Pinch-to-Zoom Gesture Container */}
        <div
          className="relative rounded-xl overflow-hidden border border-slate-700/80 bg-black min-h-[320px] flex items-center justify-center select-none"
          style={{ touchAction: "none" }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* Floating Zoom Indicator Pill during Pinch / Active Zoom */}
          {zoomValue > 1.01 && (
            <div className="pointer-events-none absolute bottom-3 right-3 z-20 flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-950/80 backdrop-blur-md border border-teal-500/40 text-[11px] font-bold text-teal-300 shadow-lg">
              <ZoomIn size={12} className="text-teal-400" />
              {zoomValue.toFixed(1)}x
            </div>
          )}

          {usingFallback ? (
            <div className="relative h-[320px] w-full">
              <div id={fallbackRegionIdRef.current} className="h-[320px] w-full" />
            </div>
          ) : (
            <video
              ref={videoRef}
              className="w-full h-[320px] object-cover"
              autoPlay
              muted
              playsInline
              onLoadedMetadata={() => setLoading(false)}
              style={{
                transform: !isHardwareZoom && zoomValue > 1.01 ? `scale(${zoomValue})` : "none",
                transformOrigin: "center center",
                transition: isPinching ? "none" : "transform 0.12s ease-out",
              }}
            />
          )}

          {/* Viewfinder Overlay with Animated Laser Scanline and Corner Brackets */}
          {isScannerActive && !loading && !error ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div
                className={`relative w-56 h-56 transition-all duration-300 ${
                  isScanSuccess ? "scale-105" : "scale-100"
                }`}
              >
                {/* Corner Bracket: Top-Left */}
                <div
                  className={`absolute top-0 left-0 w-8 h-8 border-t-[3.5px] border-l-[3.5px] rounded-tl-lg transition-colors duration-300 ${
                    isScanSuccess
                      ? "border-emerald-400 drop-shadow-[0_0_12px_rgba(52,211,153,0.9)]"
                      : "border-cyan-400 drop-shadow-[0_0_8px_rgba(6,182,212,0.6)]"
                  }`}
                />
                {/* Corner Bracket: Top-Right */}
                <div
                  className={`absolute top-0 right-0 w-8 h-8 border-t-[3.5px] border-r-[3.5px] rounded-tr-lg transition-colors duration-300 ${
                    isScanSuccess
                      ? "border-emerald-400 drop-shadow-[0_0_12px_rgba(52,211,153,0.9)]"
                      : "border-cyan-400 drop-shadow-[0_0_8px_rgba(6,182,212,0.6)]"
                  }`}
                />
                {/* Corner Bracket: Bottom-Left */}
                <div
                  className={`absolute bottom-0 left-0 w-8 h-8 border-b-[3.5px] border-l-[3.5px] rounded-bl-lg transition-colors duration-300 ${
                    isScanSuccess
                      ? "border-emerald-400 drop-shadow-[0_0_12px_rgba(52,211,153,0.9)]"
                      : "border-cyan-400 drop-shadow-[0_0_8px_rgba(6,182,212,0.6)]"
                  }`}
                />
                {/* Corner Bracket: Bottom-Right */}
                <div
                  className={`absolute bottom-0 right-0 w-8 h-8 border-b-[3.5px] border-r-[3.5px] rounded-br-lg transition-colors duration-300 ${
                    isScanSuccess
                      ? "border-emerald-400 drop-shadow-[0_0_12px_rgba(52,211,153,0.9)]"
                      : "border-cyan-400 drop-shadow-[0_0_8px_rgba(6,182,212,0.6)]"
                  }`}
                />

                {/* Animated Laser Scanning Line */}
                {!isScanSuccess && (
                  <div className="absolute inset-x-2 qr-laser-line pointer-events-none">
                    <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_12px_#22d3ee,0_0_24px_#06b6d4]" />
                    <div className="h-5 w-full bg-gradient-to-b from-cyan-400/20 to-transparent -mt-[1px]" />
                  </div>
                )}

                {/* Success Indicator Flash */}
                {isScanSuccess && (
                  <div className="absolute inset-0 rounded-xl bg-emerald-500/15 animate-ping duration-500" />
                )}
              </div>
            </div>
          ) : null}

          {!isScannerActive ? (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-950/70 px-6 text-center text-sm text-slate-200">
              Tap the capture button to activate the camera and start scanning.
            </div>
          ) : loading ? (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-950/70 text-slate-100 text-sm">
              Opening camera...
            </div>
          ) : null}
        </div>

        <canvas ref={canvasRef} className="hidden" />

        {/* ── Advanced Lightweight Universal Zoom Control Bar ──────────────── */}
        <div className="mt-3 rounded-xl border border-slate-700/80 bg-slate-900/90 p-3 shadow-inner">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 text-slate-200 text-xs font-semibold">
              <ZoomIn size={14} className="text-teal-400" />
              <span>Camera Zoom</span>
              <span className="text-[10px] font-normal px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700/60 ml-1">
                {isHardwareZoom ? "Optical Lens" : "Enhanced Digital"}
              </span>
            </div>
            <div className="flex items-center gap-1 text-xs font-bold text-teal-300 bg-teal-950/70 px-2 py-0.5 rounded-lg border border-teal-500/30">
              {zoomValue.toFixed(1)}x
            </div>
          </div>

          {/* Quick Preset Buttons */}
          <div className="flex items-center gap-1.5 mb-2.5">
            {presetButtons.map((preset) => {
              const isActive = Math.abs(zoomValue - preset.value) < 0.08;
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => handleZoomChange(preset.value)}
                  className={`flex-1 py-1 text-xs rounded-lg font-semibold transition-all duration-150 cursor-pointer ${
                    isActive
                      ? "bg-teal-600 text-white shadow-md shadow-teal-950/60 border border-teal-400/80 scale-[1.02]"
                      : "bg-slate-800/90 text-slate-300 hover:text-white hover:bg-slate-700/80 border border-slate-700/60"
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>

          {/* Smooth Range Slider with Steppers */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleZoomChange(zoomValue - 0.2)}
              disabled={zoomValue <= zoomRange.min}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60 disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer"
              title="Zoom out"
            >
              <Minus size={14} />
            </button>

            <div className="relative flex-1 flex items-center">
              <input
                type="range"
                min={zoomRange.min}
                max={zoomRange.max}
                step={zoomRange.step}
                value={zoomValue}
                onChange={(event) => handleZoomChange(Number(event.target.value))}
                className="zoom-slider-track w-full h-2 rounded-lg appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, #0d9488 0%, #14b8a6 ${zoomPercent}%, #334155 ${zoomPercent}%, #334155 100%)`,
                }}
              />
            </div>

            <button
              type="button"
              onClick={() => handleZoomChange(zoomValue + 0.2)}
              disabled={zoomValue >= zoomRange.max}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60 disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer"
              title="Zoom in"
            >
              <Plus size={14} />
            </button>
          </div>

          <p className="mt-2 text-[10px] text-slate-400 flex items-center justify-between">
            <span>Pinch screen or drag slider to zoom</span>
            <span className="text-slate-400 font-mono">Max {zoomRange.max.toFixed(1)}x</span>
          </p>
        </div>

        <div
          className={`mt-3 rounded-xl border px-3 py-2 transition-colors duration-300 ${
            error || statusTone === "error"
              ? "border-red-500/30 bg-red-500/10"
              : isScanSuccess
                ? "border-emerald-500/40 bg-emerald-500/15"
                : "border-slate-700 bg-slate-900/70"
          }`}
        >
          {error ? (
            <p className="text-xs text-red-300">{error}</p>
          ) : (
            <p className={`text-xs ${isScanSuccess ? "text-emerald-300 font-medium" : "text-slate-300"}`}>
              {isScanSuccess ? "QR Code captured successfully!" : hint || "Point the rear camera at the QR and hold the phone steady."}
            </p>
          )}
        </div>

        {actionLabel && onAction ? (
          <div className="mt-3">
            <Button
              className="w-full bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700"
              onClick={onAction}
            >
              {actionLabel}
            </Button>
          </div>
        ) : null}

        {error ? (
          <div className="mt-3">
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => setRestartNonce((value) => value + 1)}
            >
              <RefreshCw size={16} />
              Retry Camera
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
