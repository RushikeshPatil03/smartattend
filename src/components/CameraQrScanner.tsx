import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "./Common";
import { RefreshCw, Search, ZoomIn } from "lucide-react";
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
};

const SCAN_INTERVAL_MS = 60;
const DUPLICATE_DETECTION_COOLDOWN_MS = 400;

function isInsecureMobileCameraContext() {
  const host = window.location.hostname;
  const isLocalHost = host === "localhost" || host === "127.0.0.1";
  return !window.isSecureContext && !isLocalHost;
}

function getCameraErrorMessage(err: any) {
  if (isInsecureMobileCameraContext()) {
    return "Camera on mobile requires HTTPS. Open this app over https:// and try again.";
  }

  const name = String(err?.name || "");
  const message = String(err?.message || "").toLowerCase();

  if (name === "NotAllowedError" || message.includes("permission")) {
    return "Camera permission denied. Allow camera access in browser settings and reload the page.";
  }

  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No camera was found on this device.";
  }

  if (name === "NotReadableError" || message.includes("could not start video source")) {
    return "Camera is busy or unavailable. Close other apps using the camera and try again.";
  }

  if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
    return "This browser could not start the requested camera. Try another browser or device.";
  }

  if (name === "AbortError") {
    return "Camera startup was interrupted. Please try scanning again.";
  }

  return err?.message || "Unable to open the camera. Allow camera permission and try again.";
}

function triggerScanHaptic() {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    try {
      navigator.vibrate(80);
    } catch {
      // Ignore vibration error on unsupported platforms
    }
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
}: CameraQrScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fallbackRegionIdRef = useRef(`qr-fallback-${Math.random().toString(36).slice(2)}`);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<{ detect: (source: CanvasImageSource) => Promise<DetectorResult[]> } | null>(null);
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const onDetectedRef = useRef(onDetected);
  const rafRef = useRef<number | null>(null);
  const decodeLockRef = useRef(false);
  const lastScanAtRef = useRef(0);
  const lastDetectedValueRef = useRef("");
  const lastDetectedAtRef = useRef(0);
  const mountedRef = useRef(true);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [zoomRange, setZoomRange] = useState<{ min: number; max: number; step: number } | null>(null);
  const [zoomValue, setZoomValue] = useState<number | null>(null);
  const [usingFallback, setUsingFallback] = useState(false);
  const [restartNonce, setRestartNonce] = useState(0);
  const [scanSuccessPulse, setScanSuccessPulse] = useState(false);

  const isScanSuccess = scanSuccessPulse || statusTone === "success";

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

  useEffect(() => {
    const stopCamera = () => {
      if (rafRef.current) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      const stream = streamRef.current;
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
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
      ctx.drawImage(video, 0, 0, width, height);

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

    const applyZoom = async (track: MediaStreamTrack, nextZoom: number) => {
      try {
        await track.applyConstraints({
          advanced: [{ zoom: nextZoom } as MediaTrackConstraintSet],
        });
        if (mountedRef.current) {
          setZoomValue(nextZoom);
        }
      } catch {
        // Ignore unsupported zoom updates.
      }
    };

    const startFallbackScanner = async () => {
      setUsingFallback(true);
      setZoomRange(null);
      setZoomValue(null);

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

        if (!detectorSupported) {
          await startFallbackScanner();
          setLoading(false);
          return;
        }

        const Detector = window.BarcodeDetector;
        if (!Detector) {
          throw new Error("QR detector not available");
        }

        detectorRef.current = new Detector({ formats: ["qr_code"] });

        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: 640 },
              height: { ideal: 480 },
              frameRate: { ideal: 30, max: 30 },
            },
          });
        } catch (primaryError: any) {
          if (
            primaryError?.name !== "OverconstrainedError" &&
            primaryError?.name !== "ConstraintNotSatisfiedError"
          ) {
            throw primaryError;
          }
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: "environment" },
          });
        }

        if (!mountedRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        video.onloadedmetadata = () => {
          setLoading(false);
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
        setLoading(false);

        const [track] = stream.getVideoTracks();
        const capabilities =
          typeof track.getCapabilities === "function"
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
          await applyZoom(track, initialZoom);
        }

        setLoading(false);
        rafRef.current = window.requestAnimationFrame(() => {
          void detectFrame();
        });
      } catch (err: any) {
        try {
          if (detectorSupported) {
            await startFallbackScanner();
            setLoading(false);
            return;
          }
        } catch {
          // Fall through to show error.
        }
        setLoading(false);
        setError(getCameraErrorMessage(err));
      }
    };

    void startCamera();

    return () => {
      stopCamera();
      void stopFallbackScanner();
    };
  }, [detectorSupported, isScannerActive, restartNonce]);

  const handleZoomChange = async (nextValue: number) => {
    setZoomValue(nextValue);
    const track = streamRef.current?.getVideoTracks?.()[0];
    if (!track) return;
    try {
      await track.applyConstraints({
        advanced: [{ zoom: nextValue } as MediaTrackConstraintSet],
      });
    } catch {
      setError("Zoom control is not available on this device.");
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/85 backdrop-blur-[2px] flex items-center justify-center p-4">
      {/* Scoped CSS for laser scan line animation */}
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
      `}</style>

      <div className="w-full max-w-md bg-slate-950 border border-slate-700/80 rounded-2xl p-4 shadow-2xl">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-white">{title}</p>
          <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={onCancel}>
            Cancel
          </Button>
        </div>

        <div className="relative rounded-xl overflow-hidden border border-slate-700/80 bg-black min-h-[320px] flex items-center justify-center">
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
              style={{ transform: "none" }}
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

        {zoomRange ? (
          <div className="mt-4 rounded-xl border border-slate-700/80 bg-slate-900/80 p-3">
            <div className="flex items-center gap-2 text-slate-200 text-xs font-medium mb-2">
              <ZoomIn size={14} />
              Camera Zoom
            </div>
            <input
              type="range"
              min={zoomRange.min}
              max={zoomRange.max}
              step={zoomRange.step}
              value={zoomValue ?? zoomRange.min}
              onChange={(event) => void handleZoomChange(Number(event.target.value))}
              className="w-full accent-teal-500"
            />
            <p className="mt-1 text-[11px] text-slate-400">
              Move right to zoom in when your phone camera supports it.
            </p>
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-slate-700/80 bg-slate-900/80 p-3">
            <div className="flex items-center gap-2 text-slate-200 text-xs font-medium">
              <Search size={14} />
              {usingFallback
                ? "Using compatibility scanner for this browser."
                : "Zoom is not exposed by this browser/device camera."}
            </div>
          </div>
        )}

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

