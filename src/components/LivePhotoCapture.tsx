import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Camera,
  CheckCircle2,
  Compass,
  RefreshCw,
  ShieldAlert,
  Smartphone,
} from "lucide-react";
import { Button } from "./Common";
import { captureVideoFrame, DEFAULT_CAPTURE_OPTIONS } from "../utils/imageCapture";
import {
  assessMediaPipeFaceQuality,
  type FaceQualityResult,
} from "../utils/mediaPipeFaceQuality";
import {
  compareFaceDescriptors,
  computeDescriptorFromImageURL,
  computeDescriptorFromVideoFrame,
  loadModelsIfNeeded,
} from "../utils/faceApiLoader";
import {
  runMovementLiveness,
  type ChallengeDirection,
  type LivenessChallenge,
} from "../utils/faceMovementLiveness";
import { buildFaceSignatures } from "../utils/faceSignature";

const PORTRAIT_BETA_MIN = 55;
const PORTRAIT_BETA_MAX = 125;
const PORTRAIT_GAMMA_TOLERANCE = 28;
const ORIENTATION_UPDATE_THRESHOLD = 0.8;
const FACE_QUALITY_INTERVAL_MS = 120;
const LEGACY_FACE_SCORE_THRESHOLD = Number(
  import.meta.env.VITE_FACEAPI_LEGACY_SCORE_THRESHOLD || 0.78
);

type ClientFaceVerification = {
  method: "client-faceapi" | "client-legacy-signature";
  distance?: number;
  score?: number;
  threshold: number;
  matched: true;
  liveness: "movement";
  livenessMetric?: {
    samples: number;
    translation: number;
    rotation: number;
    missingFaceSamples: number;
    pitchDelta?: number;
    yawDelta?: number;
    challenge?: string;
  };
};

type OrientationState = {
  beta: number | null;
  gamma: number | null;
  supported: boolean;
  permissionRequired: boolean;
  permissionGranted: boolean;
};

const initialOrientationState: OrientationState = {
  beta: null,
  gamma: null,
  supported: false,
  permissionRequired: false,
  permissionGranted: false,
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isPortraitUpright = (beta: number | null, gamma: number | null) => {
  if (!isFiniteNumber(beta) || !isFiniteNumber(gamma)) {
    return false;
  }

  return (
    beta >= PORTRAIT_BETA_MIN &&
    beta <= PORTRAIT_BETA_MAX &&
    Math.abs(gamma) <= PORTRAIT_GAMMA_TOLERANCE
  );
};

const waitForNextFrame = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });

function signatureSimilarity(left: string, right: string) {
  if (!left || left.length !== right.length) return 0;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference += Math.abs(parseInt(left[index], 16) - parseInt(right[index], 16));
  }
  return 1 - difference / (left.length * 15);
}

function captureErrorMessage(error: any) {
  const name = String(error?.name || "");
  const message = String(error?.message || "");
  const lower = message.toLowerCase();

  if (!window.isSecureContext && !["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    return "Camera requires HTTPS on mobile browsers. Open the secure link and try again.";
  }
  if (name === "NotAllowedError" || lower.includes("permission")) {
    return "Camera permission denied. Allow camera access in browser settings and try again.";
  }
  if (name === "NotReadableError") {
    return "Camera is busy. Close other apps using it, then retry.";
  }
  if (name === "NotFoundError") {
    return "No front camera was found on this device.";
  }
  return message || "Unable to open the camera. Check permissions and try again.";
}

async function compareLegacyFaceSignatures(referenceUrl: string, liveDataUrl: string) {
  const [reference, live] = await Promise.all([
    buildFaceSignatures(referenceUrl),
    buildFaceSignatures(liveDataUrl),
  ]);
  const score = Math.max(
    signatureSimilarity(reference.signature, live.signature),
    signatureSimilarity(reference.signature, live.mirrorSignature),
    signatureSimilarity(reference.mirrorSignature, live.signature),
    signatureSimilarity(reference.mirrorSignature, live.mirrorSignature)
  );
  return { score, matched: score >= LEGACY_FACE_SCORE_THRESHOLD };
}

const FRONT_CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: "user" as const,
    width: { ideal: 480, max: 640 },
    height: { ideal: 640, max: 800 },
    frameRate: { ideal: 24, max: 30 },
  },
};

const FRONT_CAMERA_FALLBACK_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: { facingMode: "user" as const },
};

/**
 * Preloads face verification neural network models and compiles WebGL shaders.
 * Does NOT acquire an exclusive hardware camera stream in the background to prevent
 * hardware lockouts, LED indicator surprises, and multi-camera conflicts.
 */
export async function prewarmFrontCamera(): Promise<void> {
  try {
    await loadModelsIfNeeded();
  } catch {
    // Background model prewarm errors are non-blocking
  }
}

const LivePhotoCapture: React.FC<{
  value: string;
  onChange: (nextValue: string) => void;
  onCaptured?: (result: {
    dataUrl: string;
    capturedAt: string;
    faceVerification?: ClientFaceVerification;
    realityChecks: {
      frontCamera: boolean;
      upright: boolean;
      sensorSupported: boolean;
      permissionGranted: boolean;
      beta: number | null;
      gamma: number | null;
    };
  }) => void;
  disabled?: boolean;
  autoStart?: boolean;
  autoCapture?: boolean;
  hideLauncher?: boolean;
  title?: string;
  description?: string;
  captureRequestKey?: number;
  showCapturedPreview?: boolean;
  compactMode?: boolean;
  enableFaceQuality?: boolean;
  faceVerificationReferenceUrl?: string;
  onStateChange?: (state: {
    cameraActive: boolean;
    cameraLoading: boolean;
    alignmentReady: boolean;
    canAutoGateCapture: boolean;
    captureEnabled: boolean;
  }) => void;
}> = ({
  value,
  onChange,
  onCaptured,
  disabled = false,
  autoStart = false,
  autoCapture = false,
  hideLauncher = false,
  title = "Live Profile Photo",
  description = "Look into the front camera and keep your face centered for verification.",
  captureRequestKey = 0,
  showCapturedPreview = true,
  compactMode = false,
  enableFaceQuality = false,
  faceVerificationReferenceUrl = "",
  onStateChange,
}) => {
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [captureError, setCaptureError] = useState("");
  const [faceQuality, setFaceQuality] = useState<FaceQualityResult | null>(null);
  const [verificationInProgress, setVerificationInProgress] = useState(false);
  const [verificationMessage, setVerificationMessage] = useState("");
  const [livenessProgress, setLivenessProgress] = useState(0);
  const [livenessChallenge, setLivenessChallenge] = useState<LivenessChallenge | null>(null);
  const [livenessDirection, setLivenessDirection] = useState<ChallengeDirection | null>(null);
  const [livenessPassed, setLivenessPassed] = useState(false);
  const [orientation, setOrientation] = useState<OrientationState>(initialOrientationState);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const orientationCleanupRef = useRef<(() => void) | null>(null);
  const orientationFrameRef = useRef<number | null>(null);
  const pendingOrientationRef = useRef<{ beta: number | null; gamma: number | null } | null>(null);
  const autoCaptureTimerRef = useRef<number | null>(null);
  const retryCooldownTimerRef = useRef<number | null>(null);
  const verificationInFlightRef = useRef(false);

  const alignmentReady = true;
  const canAutoGateCapture = false;
  const canUseFaceQualityGate = enableFaceQuality && Boolean(faceQuality?.supported && faceQuality.ready);
  const faceQualityReady = !canUseFaceQualityGate || Boolean(faceQuality?.ok);
  const captureEnabled =
    cameraActive &&
    !cameraLoading &&
    faceQualityReady &&
    !verificationInProgress &&
    !disabled;

  const stopCamera = () => {
    verificationInFlightRef.current = false;
    if (retryCooldownTimerRef.current != null) {
      window.clearTimeout(retryCooldownTimerRef.current);
      retryCooldownTimerRef.current = null;
    }
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
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

    setCameraActive(false);
    setCameraLoading(false);
    setFaceQuality(null);
    setVerificationInProgress(false);
    setVerificationMessage("");
    setLivenessProgress(0);
    setLivenessChallenge(null);
    setLivenessDirection(null);
    setLivenessPassed(false);
  };

  const startOrientationTracking = (
    permissionRequired: boolean,
    permissionGranted: boolean
  ) => {
    if (typeof window === "undefined" || typeof DeviceOrientationEvent === "undefined") {
      return;
    }

    orientationCleanupRef.current?.();

    const handleOrientation = (event: DeviceOrientationEvent) => {
      pendingOrientationRef.current = {
        beta: isFiniteNumber(event.beta) ? event.beta : null,
        gamma: isFiniteNumber(event.gamma) ? event.gamma : null,
      };

      if (orientationFrameRef.current != null) {
        return;
      }

      orientationFrameRef.current = requestAnimationFrame(() => {
        orientationFrameRef.current = null;
        const next = pendingOrientationRef.current;
        if (!next) {
          return;
        }

        setOrientation((prev) => {
          const betaChanged =
            prev.beta == null ||
            next.beta == null ||
            Math.abs(prev.beta - next.beta) >= ORIENTATION_UPDATE_THRESHOLD;
          const gammaChanged =
            prev.gamma == null ||
            next.gamma == null ||
            Math.abs(prev.gamma - next.gamma) >= ORIENTATION_UPDATE_THRESHOLD;

          if (
            !betaChanged &&
            !gammaChanged &&
            prev.supported &&
            prev.permissionRequired === permissionRequired &&
            prev.permissionGranted === permissionGranted
          ) {
            return prev;
          }

          return {
            ...next,
            supported: true,
            permissionRequired,
            permissionGranted,
          };
        });
      });
    };

    window.addEventListener("deviceorientation", handleOrientation, true);
    orientationCleanupRef.current = () => {
      window.removeEventListener("deviceorientation", handleOrientation, true);
    };
  };

  useEffect(() => {
    return () => {
      stopCamera();
      orientationCleanupRef.current?.();
      if (orientationFrameRef.current != null) {
        cancelAnimationFrame(orientationFrameRef.current);
      }
      if (autoCaptureTimerRef.current != null) {
        window.clearTimeout(autoCaptureTimerRef.current);
      }
      if (retryCooldownTimerRef.current != null) {
        window.clearTimeout(retryCooldownTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    void loadModelsIfNeeded();
    if (faceVerificationReferenceUrl) {
      void computeDescriptorFromImageURL(faceVerificationReferenceUrl);
    }
  }, [faceVerificationReferenceUrl]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof DeviceOrientationEvent === "undefined") {
      return;
    }

    const permissionRequired =
      typeof (DeviceOrientationEvent as any).requestPermission === "function";

    setOrientation((prev) => ({
      ...prev,
      supported: true,
      permissionRequired,
      permissionGranted: !permissionRequired,
    }));

    if (!permissionRequired) {
      startOrientationTracking(false, true);
    }
  }, []);

  const requestOrientationPermission = async () => {
    if (typeof DeviceOrientationEvent === "undefined") {
      setCaptureError("Orientation sensors are not supported on this device.");
      return;
    }

    const requestPermission = (DeviceOrientationEvent as any).requestPermission;
    if (typeof requestPermission !== "function") {
      return;
    }

    try {
      const state = await requestPermission();
      if (state !== "granted") {
        setCaptureError("Orientation permission was denied. Manual capture remains available.");
        return;
      }

      startOrientationTracking(true, true);
      setOrientation((prev) => ({
        ...prev,
        supported: true,
        permissionRequired: true,
        permissionGranted: true,
      }));
      setCaptureError("");
    } catch (error: any) {
      setCaptureError(error?.message || "Unable to enable orientation access.");
    }
  };

  const startCamera = async () => {
    setCaptureError("");
    setCameraLoading(true);

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera is not supported in this browser.");
      }

      // 1. Check if an active usable stream is already open to prevent camera tearing
      let stream: MediaStream;
      if (
        streamRef.current &&
        streamRef.current.active &&
        streamRef.current.getTracks().some((t) => t.readyState === "live")
      ) {
        stream = streamRef.current;
      } else {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
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

        if (
          orientation.supported &&
          orientation.permissionRequired &&
          !orientation.permissionGranted
        ) {
          void requestOrientationPermission();
        }

        // 2. Request front camera directly with graceful constraints fallback
        try {
          stream = await navigator.mediaDevices.getUserMedia(FRONT_CAMERA_CONSTRAINTS);
        } catch {
          stream = await navigator.mediaDevices.getUserMedia(FRONT_CAMERA_FALLBACK_CONSTRAINTS);
        }
      }

      streamRef.current = stream;
      setCameraActive(true);

      // 3. Attach to video element and verify frames are flowing
      await waitForNextFrame();
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        video.style.transform = "none";
        video.setAttribute("playsinline", "true");
        video.setAttribute("autoplay", "true");
        video.muted = true;
        try {
          await video.play();
        } catch {
          // Ignore autoplay restriction
        }

        // Wait until video has valid dimensions and is actively streaming frames
        await new Promise<void>((resolve) => {
          if (video.videoWidth > 0 && video.videoHeight > 0) {
            resolve();
            return;
          }
          let resolved = false;
          const onReady = () => {
            if (!resolved) {
              resolved = true;
              video.removeEventListener("loadeddata", onReady);
              video.removeEventListener("playing", onReady);
              resolve();
            }
          };
          video.addEventListener("loadeddata", onReady, { once: true });
          video.addEventListener("playing", onReady, { once: true });
          setTimeout(() => {
            if (!resolved) {
              resolved = true;
              video.removeEventListener("loadeddata", onReady);
              video.removeEventListener("playing", onReady);
              resolve();
            }
          }, 1200);
        });
      }
    } catch (error: any) {
      stopCamera();
      setCaptureError(captureErrorMessage(error));
    } finally {
      setCameraLoading(false);
    }
  };

  const capturePhoto = async () => {
    if (verificationInFlightRef.current) return;
    verificationInFlightRef.current = true;
    setVerificationInProgress(true);

    try {
      if (!videoRef.current) {
        throw new Error("Camera preview is not ready yet.");
      }

      let faceVerification: ClientFaceVerification | undefined;
      let imageDataUrl = "";

      if (faceVerificationReferenceUrl) {
        if (!faceQualityReady) {
          throw new Error(faceQuality?.reason || "Hold steady until your face is ready.");
        }

        setCaptureError("");
        setVerificationMessage("Preparing secure face check...");
        setLivenessProgress(0);
        setLivenessPassed(false);
        setLivenessChallenge(null);
        setLivenessDirection(null);

        await loadModelsIfNeeded();
        const liveness = await runMovementLiveness(videoRef.current!, {
          onChallengeUpdate: (update) => {
            setVerificationMessage(update.prompt);
            setLivenessProgress(update.progress);
            setLivenessChallenge(update.challenge);
            setLivenessDirection(update.direction);
            setLivenessPassed(update.passed);
          },
        });
        if (!liveness.ok) {
          setLivenessPassed(false);
          throw new Error(liveness.reason || "Live face movement was not detected.");
        }

        setLivenessPassed(true);
        setVerificationMessage("Matching your registered face...");
        imageDataUrl = captureVideoFrame(videoRef.current, DEFAULT_CAPTURE_OPTIONS);

        try {
          const [referenceDescriptor, liveDescriptor] = await Promise.all([
            computeDescriptorFromImageURL(faceVerificationReferenceUrl),
            computeDescriptorFromVideoFrame(videoRef.current),
          ]);
          const match = await compareFaceDescriptors(referenceDescriptor, liveDescriptor);
          if (!match.matched) {
            throw new Error("Face did not match the registered profile photo.");
          }
          faceVerification = {
            method: "client-faceapi",
            distance: match.distance,
            threshold: match.threshold,
            matched: true,
            liveness: "movement",
            livenessMetric: {
              ...liveness.metric,
              challenge: liveness.challenge,
            },
          };
        } catch (descriptorError: any) {
          if (String(descriptorError?.message || "").includes("did not match")) {
            throw descriptorError;
          }
          const fallback = await compareLegacyFaceSignatures(
            faceVerificationReferenceUrl,
            imageDataUrl
          );
          if (!fallback.matched) {
            throw new Error("Face did not match the registered profile photo.");
          }
          faceVerification = {
            method: "client-legacy-signature",
            score: fallback.score,
            threshold: LEGACY_FACE_SCORE_THRESHOLD,
            matched: true,
            liveness: "movement",
            livenessMetric: {
              ...liveness.metric,
              challenge: liveness.challenge,
            },
          };
        }
      } else {
        imageDataUrl = captureVideoFrame(videoRef.current, DEFAULT_CAPTURE_OPTIONS);
      }

      onChange(imageDataUrl);
      onCaptured?.({
        dataUrl: imageDataUrl,
        capturedAt: new Date().toISOString(),
        faceVerification,
        realityChecks: {
          frontCamera: true,
          upright: canAutoGateCapture ? alignmentReady : true,
          sensorSupported: orientation.supported,
          permissionGranted: orientation.permissionGranted,
          beta: orientation.beta,
          gamma: orientation.gamma,
        },
      });
      stopCamera();
      setCaptureError("");
    } catch (error: any) {
      setVerificationMessage("");
      setLivenessProgress(0);
      setLivenessPassed(false);
      setLivenessChallenge(null);
      setLivenessDirection(null);
      const errMsg = error?.message || "Unable to capture photo.";
      setCaptureError(errMsg);

      // In autoCapture mode, schedule a calm 3-second auto-retry so warnings do not flash rapidly
      if (autoCapture) {
        if (retryCooldownTimerRef.current != null) {
          window.clearTimeout(retryCooldownTimerRef.current);
        }
        retryCooldownTimerRef.current = window.setTimeout(() => {
          retryCooldownTimerRef.current = null;
          setCaptureError("");
        }, 3000);
      }
    } finally {
      verificationInFlightRef.current = false;
      setVerificationInProgress(false);
    }
  };

  useEffect(() => {
    onStateChange?.({
      cameraActive,
      cameraLoading,
      alignmentReady,
      canAutoGateCapture,
      captureEnabled,
    });
  }, [
    alignmentReady,
    cameraActive,
    cameraLoading,
    canAutoGateCapture,
    captureEnabled,
    onStateChange,
  ]);

  useEffect(() => {
    if (!autoStart || cameraActive || cameraLoading || value) return;

    // Use a 1-frame defer so disabled state settles from parent re-render
    const id = window.requestAnimationFrame(() => {
      if (!disabled) {
        void startCamera();
      }
    });

    return () => window.cancelAnimationFrame(id);
  }, [autoStart, cameraActive, cameraLoading, disabled, value]);

  useEffect(() => {
    if (
      !enableFaceQuality ||
      !cameraActive ||
      cameraLoading ||
      disabled ||
      value ||
      verificationInProgress
    ) {
      setFaceQuality(null);
      return;
    }

    let cancelled = false;
    let frameId: number | null = null;
    let lastRunAt = 0;

    const run = async () => {
      if (cancelled) return;

      const now = performance.now();
      if (now - lastRunAt >= FACE_QUALITY_INTERVAL_MS && videoRef.current) {
        lastRunAt = now;
        const nextQuality = await assessMediaPipeFaceQuality(videoRef.current);
        if (!cancelled) {
          setFaceQuality(nextQuality);
        }
      }

      frameId = requestAnimationFrame(run);
    };

    frameId = requestAnimationFrame(run);
    return () => {
      cancelled = true;
      if (frameId != null) {
        cancelAnimationFrame(frameId);
      }
    };
  }, [cameraActive, cameraLoading, disabled, enableFaceQuality, value, verificationInProgress]);

  useEffect(() => {
    if (autoCaptureTimerRef.current != null) {
      window.clearTimeout(autoCaptureTimerRef.current);
      autoCaptureTimerRef.current = null;
    }

    if (
      !autoCapture ||
      !cameraActive ||
      cameraLoading ||
      disabled ||
      value ||
      verificationInProgress ||
      captureError
    ) {
      return;
    }

    if (!faceQualityReady) {
      return;
    }

    const delay = 450;
    autoCaptureTimerRef.current = window.setTimeout(() => {
      capturePhoto();
      autoCaptureTimerRef.current = null;
    }, delay);

    return () => {
      if (autoCaptureTimerRef.current != null) {
        window.clearTimeout(autoCaptureTimerRef.current);
        autoCaptureTimerRef.current = null;
      }
    };
  }, [
    autoCapture,
    cameraActive,
    cameraLoading,
    captureError,
    disabled,
    faceQualityReady,
    verificationInProgress,
    value,
  ]);

  useEffect(() => {
    if (!captureRequestKey || !cameraActive || cameraLoading || disabled) {
      return;
    }
    if (!faceQualityReady) {
      setCaptureError(faceQuality?.reason || "Hold steady until your face is ready.");
      return;
    }
    capturePhoto();
  }, [
    cameraActive,
    cameraLoading,
    captureRequestKey,
    disabled,
    faceQuality?.reason,
    faceQualityReady,
  ]);

  return (
    <div
      className={
        compactMode
          ? "space-y-3 bg-transparent border-0 p-0 shadow-none text-white"
          : "surface-card space-y-4 rounded-[24px] border border-slate-200/80 p-4"
      }
    >
      {!compactMode ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-900">{title}</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div>
            <p className="text-sm font-semibold text-white">{title}</p>
            <p className="mt-0.5 text-xs leading-5 text-slate-400">{description}</p>
          </div>
          {canUseFaceQualityGate ? (
            <div
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${
                faceQualityReady
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : "border-rose-500/40 bg-rose-500/10 text-rose-300"
              }`}
            >
              <Compass size={14} />
              {faceQuality?.reason || "Checking Face"}
            </div>
          ) : null}
        </div>
      )}

      {cameraActive || cameraLoading ? (
        <div className="space-y-3">
          <div
            className="relative w-full aspect-[3/4] max-h-[480px] rounded-2xl overflow-hidden bg-black shadow-inner flex items-center justify-center border border-slate-800"
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 h-full w-full object-contain -scale-x-100"
              style={{ background: "black" }}
            />

            {/* Circular Progress Ring & Direction Guidance Overlay */}
            <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center z-10">
              <div
                className="relative flex items-center justify-center"
                style={{ width: "min(62vw, 260px)", height: "min(62vw, 260px)" }}
              >
                <svg
                  className="w-full h-full transform -rotate-90 drop-shadow-md"
                  viewBox="0 0 240 240"
                >
                  <defs>
                    <linearGradient id="livenessNormal" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#38bdf8" />
                      <stop offset="100%" stopColor="#0284c7" />
                    </linearGradient>
                    <linearGradient id="livenessMid" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#38bdf8" />
                      <stop offset="60%" stopColor="#f59e0b" />
                      <stop offset="100%" stopColor="#10b981" />
                    </linearGradient>
                    <linearGradient id="livenessDone" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#10b981" />
                      <stop offset="50%" stopColor="#22c55e" />
                      <stop offset="100%" stopColor="#059669" />
                    </linearGradient>
                    <filter id="emeraldGlow" x="-20%" y="-20%" width="140%" height="140%">
                      <feGaussianBlur stdDeviation="3.5" result="blur" />
                      <feComposite in="SourceGraphic" in2="blur" operator="over" />
                    </filter>
                  </defs>

                  {/* Background Track Arc */}
                  <circle
                    cx="120"
                    cy="120"
                    r="98"
                    stroke={verificationInProgress ? "rgba(255, 255, 255, 0.25)" : "rgba(255, 255, 255, 0.15)"}
                    strokeWidth={verificationInProgress ? "6" : "3"}
                    strokeDasharray={verificationInProgress ? undefined : "6 6"}
                    fill="none"
                  />

                  {/* Dynamic Progress Arc */}
                  {verificationInProgress || livenessPassed ? (
                    <circle
                      cx="120"
                      cy="120"
                      r="98"
                      stroke={
                        livenessPassed
                          ? "url(#livenessDone)"
                          : livenessProgress >= 0.5
                          ? "url(#livenessMid)"
                          : "url(#livenessNormal)"
                      }
                      strokeWidth={livenessPassed ? "8" : "7"}
                      strokeDasharray={2 * Math.PI * 98}
                      strokeDashoffset={2 * Math.PI * 98 * (1 - Math.min(1, Math.max(0, livenessProgress)))}
                      strokeLinecap="round"
                      fill="none"
                      filter={livenessPassed || livenessProgress >= 0.8 ? "url(#emeraldGlow)" : undefined}
                      style={{
                        transition: "stroke-dashoffset 90ms ease-out, stroke 200ms ease",
                      }}
                    />
                  ) : null}
                </svg>

                {/* Center Direction Arrow / Progress / Silhouette */}
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  {livenessPassed ? (
                    <div className="flex flex-col items-center justify-center animate-in fade-in zoom-in duration-300">
                      <div className="rounded-full bg-emerald-500/30 p-2.5 backdrop-blur-md border border-emerald-400/50 shadow-lg shadow-emerald-500/40">
                        <CheckCircle2 size={38} className="text-emerald-400" />
                      </div>
                      <span className="mt-1.5 text-[11px] font-bold text-emerald-300 tracking-wider uppercase bg-emerald-950/90 px-2.5 py-0.5 rounded-full border border-emerald-500/40 shadow-sm">
                        Verified ✓
                      </span>
                    </div>
                  ) : verificationInProgress && livenessDirection ? (
                    <div className="flex flex-col items-center justify-center animate-in fade-in duration-200">
                      <div className="rounded-full bg-slate-900/70 p-2.5 backdrop-blur-md border border-sky-400/50 shadow-lg">
                        {livenessDirection === "UP" && (
                          <ArrowUp size={30} className="text-sky-300 animate-bounce" />
                        )}
                        {livenessDirection === "DOWN" && (
                          <ArrowDown size={30} className="text-sky-300 animate-bounce" />
                        )}
                        {livenessDirection === "LEFT" && (
                          <ArrowLeft size={30} className="text-sky-300 animate-bounce" />
                        )}
                        {livenessDirection === "RIGHT" && (
                          <ArrowRight size={30} className="text-sky-300 animate-bounce" />
                        )}
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5 bg-slate-900/90 px-2.5 py-0.5 rounded-full border border-sky-400/30 shadow-sm">
                        <span className="text-[11px] font-bold text-sky-200">
                          {Math.round(livenessProgress * 100)}%
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div
                      style={{ width: "min(34vw, 140px)", height: "min(42vw, 175px)" }}
                      className="rounded-[50%] border-2 border-dashed border-white/30"
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Floating Challenge Prompt (Top-Center) */}
            <div className="absolute top-3 inset-x-3 z-20 flex justify-center pointer-events-none">
              <div
                className={`rounded-full backdrop-blur-md border px-4 py-1.5 text-xs font-semibold shadow-lg flex items-center gap-2 max-w-sm truncate transition-colors duration-200 ${
                  livenessPassed
                    ? "bg-emerald-950/85 border-emerald-400/40 text-emerald-200"
                    : verificationInProgress
                    ? "bg-sky-950/85 border-sky-400/40 text-sky-100"
                    : "bg-slate-900/80 border-white/20 text-white"
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full shrink-0 ${
                    livenessPassed
                      ? "bg-emerald-400"
                      : verificationInProgress
                      ? "bg-sky-400 animate-ping"
                      : "bg-emerald-400 animate-ping"
                  }`}
                />
                <span className="truncate">
                  {verificationInProgress && verificationMessage
                    ? verificationMessage
                    : faceQualityReady
                    ? "Face ready"
                    : faceQuality?.reason || "Looking for face..."}
                </span>
              </div>
            </div>

            {/* Floating Error Toast (Bottom-Center) */}
            {captureError ? (
              <div className="absolute bottom-3 inset-x-3 z-20 flex justify-center pointer-events-none">
                <div className="rounded-xl bg-rose-950/90 backdrop-blur-md border border-rose-500/40 px-3.5 py-2 text-xs text-rose-200 shadow-xl flex items-center gap-2 max-w-sm text-center">
                  <ShieldAlert size={14} className="text-rose-400 shrink-0" />
                  <span className="truncate">{captureError}</span>
                </div>
              </div>
            ) : null}
          </div>

          {autoCapture && captureError ? (
            <div className="flex items-center justify-center pt-1">
              <button
                type="button"
                onClick={() => {
                  if (retryCooldownTimerRef.current != null) {
                    window.clearTimeout(retryCooldownTimerRef.current);
                    retryCooldownTimerRef.current = null;
                  }
                  setCaptureError("");
                  void capturePhoto();
                }}
                className="w-full sm:w-auto px-6 py-2.5 bg-gradient-to-r from-sky-600 to-cyan-500 hover:from-sky-500 hover:to-cyan-400 text-white font-semibold text-xs rounded-xl shadow-lg flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-95"
              >
                <RefreshCw size={14} />
                Try Verification Again
              </button>
            </div>
          ) : !autoCapture ? (
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                type="button"
                onClick={capturePhoto}
                disabled={!captureEnabled}
                className="flex-1"
              >
                <Camera size={16} />
                {cameraLoading
                  ? "Starting Camera..."
                  : !faceQualityReady
                  ? faceQuality?.reason || "Looking for face..."
                  : "Capture Official Photo"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={stopCamera}
                className="flex-1"
              >
                Cancel Camera
              </Button>
            </div>
          ) : null}
        </div>
      ) : value && showCapturedPreview ? (
        <div className="space-y-3">
          <img
            src={value}
            alt="Captured profile"
            loading="lazy"
            className="aspect-square w-36 rounded-[22px] border border-slate-200 object-cover shadow-sm"
          />
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              type="button"
              variant="secondary"
              onClick={() => onChange("")}
              className="flex-1"
            >
              <RefreshCw size={16} />
              Retake Photo
            </Button>
          </div>
        </div>
      ) : hideLauncher ? (
        <div className="rounded-[22px] border border-dashed border-slate-200 bg-slate-50/80 p-5 text-center text-sm text-slate-500">
          Opening front camera...
        </div>
      ) : (
        <div className="rounded-[22px] border border-dashed border-slate-200 bg-slate-50/80 p-5">
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3 text-sm text-slate-600">
              <div className="rounded-2xl bg-white p-2 text-sky-700 shadow-sm">
                <Smartphone size={18} />
              </div>
              <div>
                <p className="font-semibold text-slate-800">Fast front-camera verification</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Opens the front camera for rapid live face verification with randomized liveness challenges.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                type="button"
                onClick={startCamera}
                disabled={cameraLoading || disabled}
                className="flex-1"
              >
                {cameraLoading ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" /> Opening Camera
                  </>
                ) : (
                  <>
                    <Camera size={16} /> Open Camera
                  </>
                )}
              </Button>
              {orientation.supported &&
              orientation.permissionRequired &&
              !orientation.permissionGranted ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={requestOrientationPermission}
                  className="flex-1"
                >
                  <Compass size={16} />
                  Enable Gyroscope
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {!cameraActive && captureError ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex items-start gap-2">
            <ShieldAlert size={16} className="mt-0.5 shrink-0" />
            <span>{captureError}</span>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={startCamera}
            disabled={cameraLoading || disabled}
          >
            <RefreshCw size={16} />
            Retry
          </Button>
        </div>
      ) : null}
    </div>
  );
};

export default LivePhotoCapture;
