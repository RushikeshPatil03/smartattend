import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Camera,
  CheckCircle2,
  Compass,
  LoaderCircle,
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
  isModelsLoaded,
  loadModelsIfNeeded,
  preloadForStudent,
} from "../utils/faceApiLoader";
import {
  runMovementLiveness,
  type ChallengeDirection,
  type LivenessChallenge,
} from "../utils/faceMovementLiveness";

const PORTRAIT_BETA_MIN = 55;
const PORTRAIT_BETA_MAX = 125;
const PORTRAIT_GAMMA_TOLERANCE = 28;
const ORIENTATION_UPDATE_THRESHOLD = 0.8;
// Throttled face quality assessment interval (~5 FPS) to prevent thermal throttling on mobile
const FACE_QUALITY_INTERVAL_MS = 200;

type ClientFaceVerification = {
  method: "client-faceapi";
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
    similarity?: number;
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

const FRONT_CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: "user" as const,
    width: { ideal: 480, max: 640 },
    height: { ideal: 480, max: 640 },
    frameRate: { ideal: 30, max: 30 },
  },
};

const FRONT_CAMERA_FALLBACK_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: "user" as const,
    width: { ideal: 480, max: 640 },
    height: { ideal: 480, max: 640 },
  },
};

let touchPrewarmedStream: MediaStream | null = null;
let touchPrewarmPromise: Promise<MediaStream | null> | null = null;
let touchPrewarmExpiryTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Releases any touch-prewarmed stream held in memory.
 * Call this when a touch gesture is aborted, cancelled, or the modal closes.
 */
export function releasePrewarmedFrontStream(): void {
  if (touchPrewarmExpiryTimer != null) {
    clearTimeout(touchPrewarmExpiryTimer);
    touchPrewarmExpiryTimer = null;
  }
  if (touchPrewarmedStream) {
    touchPrewarmedStream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        // ignore
      }
    });
    touchPrewarmedStream = null;
  }
  touchPrewarmPromise = null;
}

/**
 * Triggered on pointer down / touch start on the "Mark Attendance" button.
 * Powers on camera hardware the millisecond the finger touches the screen (50-100ms before click),
 * so the camera feed is ready the instant the finger lifts.
 *
 * Resilient for iOS Safari and Samsung / Android:
 * - Checks if stream is already live to avoid duplicate acquisition
 * - Has 6s auto-release timer to turn off camera LED if the student cancels or scrolls away
 * - Catches all hardware errors silently without throwing
 */
export async function touchDownPrewarmFrontCamera(): Promise<MediaStream | null> {
  if (typeof window === "undefined" || !navigator?.mediaDevices?.getUserMedia) {
    return null;
  }

  // 1. If already active and live, reuse it
  if (
    touchPrewarmedStream &&
    touchPrewarmedStream.active &&
    touchPrewarmedStream.getTracks().some((t) => t.readyState === "live")
  ) {
    return touchPrewarmedStream;
  }

  // 2. If a request is already in-flight, return the existing promise
  if (touchPrewarmPromise) {
    return touchPrewarmPromise;
  }

  // Clear any existing timer
  if (touchPrewarmExpiryTimer != null) {
    clearTimeout(touchPrewarmExpiryTimer);
    touchPrewarmExpiryTimer = null;
  }

  touchPrewarmPromise = (async () => {
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(FRONT_CAMERA_CONSTRAINTS);
      } catch {
        stream = await navigator.mediaDevices.getUserMedia(FRONT_CAMERA_FALLBACK_CONSTRAINTS);
      }

      touchPrewarmedStream = stream;

      // 6-second safety timeout: If student touches down but never opens capture modal,
      // release the hardware camera so device indicator turns off and other apps aren't blocked.
      touchPrewarmExpiryTimer = setTimeout(() => {
        releasePrewarmedFrontStream();
      }, 6000);

      return stream;
    } catch {
      touchPrewarmedStream = null;
      return null;
    } finally {
      touchPrewarmPromise = null;
    }
  })();

  return touchPrewarmPromise;
}

/**
 * Consumes the touch-down prewarmed camera stream for immediate display.
 * Cancels the expiry timer and transfers ownership to the active capture component.
 */
export async function consumePrewarmedFrontStream(): Promise<MediaStream | null> {
  if (touchPrewarmExpiryTimer != null) {
    clearTimeout(touchPrewarmExpiryTimer);
    touchPrewarmExpiryTimer = null;
  }

  if (
    touchPrewarmedStream &&
    touchPrewarmedStream.active &&
    touchPrewarmedStream.getTracks().some((t) => t.readyState === "live")
  ) {
    const stream = touchPrewarmedStream;
    touchPrewarmedStream = null;
    return stream;
  }

  if (touchPrewarmPromise) {
    try {
      const stream = await touchPrewarmPromise;
      touchPrewarmedStream = null;
      if (stream && stream.active && stream.getTracks().some((t) => t.readyState === "live")) {
        return stream;
      }
    } catch {
      touchPrewarmedStream = null;
    }
  }

  return null;
}

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
}> = (props) => {
  const {
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
    faceVerificationReferenceUrl = "",
    onStateChange,
  } = props;
  const enableFaceQuality = props.enableFaceQuality ?? !props.faceVerificationReferenceUrl;
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
  const smoothedProgressRef = useRef(0);

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

    releasePrewarmedFrontStream();

    setCameraActive(false);
    setCameraLoading(false);
    setFaceQuality(null);
    setVerificationInProgress(false);
    setVerificationMessage("");
    smoothedProgressRef.current = 0;
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
    // Only preload face recognition neural network models when a reference photo is provided
    // (i.e. during attendance verification). Initial registration has no reference photo
    // and only performs a photo snapshot + canvas signature.
    if (faceVerificationReferenceUrl && faceVerificationReferenceUrl.trim().length > 5) {
      void preloadForStudent(faceVerificationReferenceUrl);
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
      let stream: MediaStream | null = null;
      if (
        streamRef.current &&
        streamRef.current.active &&
        streamRef.current.getTracks().some((t) => t.readyState === "live")
      ) {
        stream = streamRef.current;
      } else {
        // 2. Consume touch-down pre-warmed stream if available (powers on during physical tap)
        stream = await consumePrewarmedFrontStream();

        if (!stream) {
          // Clean up previous stream and release video source
          if (streamRef.current) {
            streamRef.current.getTracks().forEach((track) => {
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

          if (
            orientation.supported &&
            orientation.permissionRequired &&
            !orientation.permissionGranted
          ) {
            void requestOrientationPermission();
          }

          // Zero-delay direct HAL acquisition (no artificial 80ms sleep)
          try {
            stream = await navigator.mediaDevices.getUserMedia(FRONT_CAMERA_CONSTRAINTS);
          } catch {
            stream = await navigator.mediaDevices.getUserMedia(FRONT_CAMERA_FALLBACK_CONSTRAINTS);
          }
        }
      }

      streamRef.current = stream;
      setCameraActive(true);

      // 3. Attach to video element and verify frames are flowing
      await waitForNextFrame();
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        video.setAttribute("playsinline", "true");
        video.setAttribute("autoplay", "true");
        video.muted = true;
        try {
          await video.play();
        } catch {
          // Autoplay fallback
        }
        // Wait until video has valid dimensions before lifting loading state
        await new Promise<void>((resolve) => {
          if (video.videoWidth > 0 && video.videoHeight > 0) {
            setCameraLoading(false);
            resolve();
            return;
          }
          const onFrame = () => {
            if (video.videoWidth > 0 && video.videoHeight > 0) {
              video.removeEventListener("loadeddata", onFrame);
              video.removeEventListener("playing", onFrame);
              setCameraLoading(false);
              resolve();
            }
          };
          video.addEventListener("loadeddata", onFrame);
          video.addEventListener("playing", onFrame);
          setTimeout(() => {
            setCameraLoading(false);
            resolve();
          }, 600);
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
      if (!videoRef.current || videoRef.current.videoWidth === 0 || videoRef.current.readyState < 2) {
        throw new Error("Camera preview is not ready yet. Please hold still.");
      }
      if (!faceQualityReady) {
        throw new Error(faceQuality?.reason || "Hold steady until your face is centered in the frame.");
      }
      let faceVerification: ClientFaceVerification | undefined;
      let imageDataUrl = "";
      const isVerificationMode = Boolean(
        faceVerificationReferenceUrl && faceVerificationReferenceUrl.trim().length > 5
      );
      if (isVerificationMode) {
        // ─────────────────────────────────────────────────────────────────
        // MODE A: ATTENDANCE 1:1 BIOMETRIC VERIFICATION MODE
        // ─────────────────────────────────────────────────────────────────
        setCaptureError("");
        setVerificationMessage("Checking live face movement...");
        smoothedProgressRef.current = 0;
        setLivenessProgress(0);
        setLivenessPassed(false);
        setLivenessChallenge(null);
        setLivenessDirection(null);
        // 1. Movement Liveness Challenge with Concurrent 1:1 Biometric Extraction
        if (!isModelsLoaded()) {
          await loadModelsIfNeeded();
        }
        let lastReportedPrompt = "";
        let lastReportedDirection: ChallengeDirection | null = null;
        let lastReportedProgress = 0;

        // Concurrent biometric matching promise:
        // Established the millisecond the initial frontal baseline is computed.
        let liveBiometricPromise: Promise<{
          capturedDataUrl: string;
          match: { matched: boolean; similarity: number; distance: number; threshold: number };
        }> | null = null;

        const startConcurrentBiometricExtraction = () => {
          if (liveBiometricPromise || !videoRef.current) return;
          const videoEl = videoRef.current;
          liveBiometricPromise = (async () => {
            const [capturedDataUrl, referenceDescriptor, liveDescriptor] = await Promise.all([
              captureVideoFrame(videoEl, DEFAULT_CAPTURE_OPTIONS),
              computeDescriptorFromImageURL(faceVerificationReferenceUrl!),
              computeDescriptorFromVideoFrame(videoEl),
            ]);
            const match = await compareFaceDescriptors(referenceDescriptor, liveDescriptor);
            return { capturedDataUrl, match };
          })();
        };

        const liveness = await runMovementLiveness(videoRef.current!, {
          onBaselineEstablished: () => {
            // First 2 stable frontal frames established baseline: fire extraction concurrently!
            startConcurrentBiometricExtraction();
          },
          onChallengeUpdate: (update) => {
            if (update.prompt !== lastReportedPrompt) {
              lastReportedPrompt = update.prompt;
              setVerificationMessage(update.prompt);
            }
            if (update.direction !== lastReportedDirection) {
              lastReportedDirection = update.direction;
              setLivenessDirection(update.direction);
              setLivenessChallenge(update.challenge);
            }
            if (update.passed) {
              smoothedProgressRef.current = 1.0;
              setLivenessProgress(1.0);
            } else {
              // Exponential Moving Average (EMA): filters camera noise while remaining instantly responsive
              const raw = update.progress;
              const prev = smoothedProgressRef.current;
              const smoothed = prev * 0.4 + raw * 0.6;
              smoothedProgressRef.current = smoothed;
              setLivenessProgress(smoothed);
            }
          },
        });
        if (!liveness.ok) {
          setLivenessPassed(false);
          throw new Error(liveness.reason || "Live face movement was not detected.");
        }

        // Liveness confirmed! Ensure biometric extraction was kicked off
        if (!liveBiometricPromise && videoRef.current) {
          startConcurrentBiometricExtraction();
        }

        let biometricResult: {
          capturedDataUrl: string;
          match: { matched: boolean; similarity: number; distance: number; threshold: number };
        };

        try {
          biometricResult = await liveBiometricPromise!;
        } catch {
          // Resilient fallback: re-run once if initial frame extraction failed
          if (videoRef.current) {
            const [capturedDataUrl, referenceDescriptor, liveDescriptor] = await Promise.all([
              captureVideoFrame(videoRef.current, DEFAULT_CAPTURE_OPTIONS),
              computeDescriptorFromImageURL(faceVerificationReferenceUrl!),
              computeDescriptorFromVideoFrame(videoRef.current),
            ]);
            const match = await compareFaceDescriptors(referenceDescriptor, liveDescriptor);
            biometricResult = { capturedDataUrl, match };
          } else {
            throw new Error("Unable to capture video frame for identity match.");
          }
        }

        const { capturedDataUrl, match } = biometricResult;
        if (!match.matched) {
          throw new Error(
            `Face mismatch: Detected face does not match the registered account photo (Similarity: ${(match.similarity * 100).toFixed(1)}% / Required: ${(match.threshold * 100).toFixed(0)}%).`
          );
        }

        // 3. BOTH Liveness and 1:1 Biometric Match succeeded!
        setLivenessProgress(1);
        setLivenessPassed(true);
        setVerificationMessage("Identity Verified ✓");

        if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
          try {
            navigator.vibrate(40);
          } catch {}
        }

        // Brief 180ms visual celebration so student clearly sees the emerald green checkmark
        await new Promise((res) => setTimeout(res, 180));

        faceVerification = {
          method: "client-faceapi",
          distance: match.distance,
          threshold: match.threshold,
          matched: true,
          liveness: "movement",
          livenessMetric: {
            ...liveness.metric,
            challenge: liveness.challenge,
            similarity: match.similarity,
          },
        };
        imageDataUrl = capturedDataUrl;
      } else {
        // ─────────────────────────────────────────────────────────────────
        // MODE B: INITIAL REGISTRATION / ENROLLMENT PHOTO CAPTURE MODE
        // ─────────────────────────────────────────────────────────────────
        setCaptureError("");
        setVerificationMessage("Capturing official profile photo...");
        imageDataUrl = captureVideoFrame(videoRef.current!, DEFAULT_CAPTURE_OPTIONS);
      }
      stopCamera();
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
      setCaptureError("");
    } catch (error: any) {
      setVerificationMessage("");
      smoothedProgressRef.current = 0;
      setLivenessProgress(0);
      setLivenessPassed(false);
      setLivenessChallenge(null);
      setLivenessDirection(null);
      const errMsg = error?.message || "Unable to capture photo.";
      setCaptureError(errMsg);
      // In autoCapture mode, schedule a 3-second auto-retry
      if (autoCapture) {
        if (retryCooldownTimerRef.current != null) {
          window.clearTimeout(retryCooldownTimerRef.current);
        }
        retryCooldownTimerRef.current = window.setTimeout(() => {
          retryCooldownTimerRef.current = null;
          if (cameraActive && !disabled) {
            void capturePhoto();
          }
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

    // Stagger MediaPipe init by 400ms from loop start to avoid simultaneous heavy
    // initialisation with face-api.js (script parse + WebGL shader compilation).
    // Both libraries compete for the same GPU resources; sequencing them cuts total
    // cold-init time and prevents frame-rate stuttering on the first few frames.
    const loopStartedAt = performance.now();
    const MEDIAPIPE_STARTUP_DELAY_MS = 400;
    let startupDelayDone = false;

    const run = async () => {
      if (cancelled) return;

      // Respect the startup stagger: skip MediaPipe calls until the delay has elapsed
      if (!startupDelayDone) {
        if (performance.now() - loopStartedAt < MEDIAPIPE_STARTUP_DELAY_MS) {
          frameId = requestAnimationFrame(run);
          return;
        }
        startupDelayDone = true;
      }

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

    const delay = 0;
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

  const activePromptTitle = useMemo(() => {
    if (livenessPassed) return "Identity Verified ✓";
    if (verificationInProgress) {
      if (livenessDirection === "LEFT") return "Turn your head left";
      if (livenessDirection === "RIGHT") return "Turn your head right";
      if (livenessDirection === "UP") return "Tilt your head up";
      if (livenessDirection === "DOWN") return "Tilt your head down";
      return verificationMessage || "Align your face";
    }
    return title;
  }, [livenessDirection, livenessPassed, title, verificationInProgress, verificationMessage]);

  const activePromptSubtitle = useMemo(() => {
    if (livenessPassed) return "Verified ✓";
    if (verificationInProgress && livenessDirection) {
      return "Keep going until the dot turns green";
    }
    if (verificationInProgress) {
      return "Hold still, looking into front camera...";
    }
    return description;
  }, [description, livenessDirection, livenessPassed, verificationInProgress]);

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
            <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
              {activePromptTitle}
            </h2>
            <p className="mt-1 text-xs sm:text-sm text-slate-500">
              {activePromptSubtitle}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5 text-center sm:text-left">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
              {activePromptTitle}
            </h2>
            <p className="mt-0.5 text-xs sm:text-sm text-slate-400">
              {activePromptSubtitle}
            </p>
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
              onLoadedMetadata={() => {
                setCameraActive(true);
                setCameraLoading(false);
              }}
              onCanPlay={() => {
                setCameraLoading(false);
                if (videoRef.current) {
                  videoRef.current.play().catch(() => {});
                }
              }}
              className={`absolute inset-0 h-full w-full object-cover -scale-x-100 bg-slate-950 transition-opacity duration-300 ${
                cameraLoading ? "opacity-0" : "opacity-100"
              }`}
            />

            {/* Seamless Active Shimmer / Radar Pulse Loader (Visible while hardware camera spins up) */}
            {cameraLoading && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/95 backdrop-blur-sm gap-4 animate-in fade-in duration-200 pointer-events-none">
                <div className="relative flex items-center justify-center">
                  <div className="absolute h-24 w-24 rounded-full border border-sky-500/25 bg-sky-500/5 animate-ping duration-1000" />
                  <div className="h-20 w-20 rounded-full border-2 border-dashed border-sky-400/40 animate-spin duration-3000" />
                  <div className="absolute rounded-full bg-slate-900/90 p-3.5 border border-sky-400/30 shadow-lg shadow-sky-500/20">
                    <Camera size={26} className="text-sky-400 animate-pulse" />
                  </div>
                </div>
                <div className="flex flex-col items-center gap-1.5 text-center px-6">
                  <span className="text-xs font-semibold text-sky-200 tracking-wide">
                    Initializing Front Camera...
                  </span>
                  <span className="text-[11px] text-slate-400 max-w-[200px]">
                    Hold phone upright in good lighting
                  </span>
                </div>
              </div>
            )}

            {/* Modern Directional Pill Slider (Google Face Unlock Style) & Face Guide */}
            {(verificationInProgress || livenessPassed) && livenessDirection ? (
              <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center z-20">
                {/* Horizontal Pill for Left/Right */}
                {(livenessDirection === "LEFT" || livenessDirection === "RIGHT") && (
                  <div className="relative h-12 w-48 rounded-full bg-black/25 backdrop-blur-[2px] border border-white/15 p-1 flex items-center shadow-[0_4px_24px_rgba(0,0,0,0.15)]">
                    <div
                      className={`h-10 w-10 rounded-full flex items-center justify-center shadow-md ${
                        livenessPassed
                          ? "bg-emerald-500/90 text-white shadow-lg shadow-emerald-500/40 border border-white/40 scale-105"
                          : "bg-sky-400/80 text-white backdrop-blur-md shadow-sky-500/20 border border-white/30"
                      }`}
                      style={{
                        transform: `translateX(${
                          livenessDirection === "LEFT"
                            ? (1 - Math.min(1, livenessProgress)) * 144
                            : Math.min(1, livenessProgress) * 144
                        }px)`,
                        transition: "transform 140ms cubic-bezier(0.16, 1, 0.3, 1), background-color 200ms ease, border-color 200ms ease, box-shadow 200ms ease",
                        willChange: "transform",
                      }}
                    >
                      {livenessPassed ? (
                        <CheckCircle2 size={22} className="text-white" />
                      ) : livenessDirection === "LEFT" ? (
                        <ArrowLeft size={20} className="stroke-[2.5]" />
                      ) : (
                        <ArrowRight size={20} className="stroke-[2.5]" />
                      )}
                    </div>
                  </div>
                )}

                {/* Vertical Pill for Up/Down */}
                {(livenessDirection === "UP" || livenessDirection === "DOWN") && (
                  <div className="relative w-12 h-48 rounded-full bg-black/25 backdrop-blur-[2px] border border-white/15 p-1 flex justify-center shadow-[0_4px_24px_rgba(0,0,0,0.15)]">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center shadow-md ${
                        livenessPassed
                          ? "bg-emerald-500/90 text-white shadow-lg shadow-emerald-500/40 border border-white/40 scale-105"
                          : "bg-sky-400/80 text-white backdrop-blur-md shadow-sky-500/20 border border-white/30"
                      }`}
                      style={{
                        transform: `translateY(${
                          livenessDirection === "UP"
                            ? (1 - Math.min(1, livenessProgress)) * 144
                            : Math.min(1, livenessProgress) * 144
                        }px)`,
                        transition: "transform 140ms cubic-bezier(0.16, 1, 0.3, 1), background-color 200ms ease, border-color 200ms ease, box-shadow 200ms ease",
                        willChange: "transform",
                      }}
                    >
                      {livenessPassed ? (
                        <CheckCircle2 size={22} className="text-white" />
                      ) : livenessDirection === "UP" ? (
                        <ArrowUp size={20} className="stroke-[2.5]" />
                      ) : (
                        <ArrowDown size={20} className="stroke-[2.5]" />
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Subtle Oval Face Guide when aligning or before direction starts */
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-10">
                <div
                  style={{ width: "min(38vw, 150px)", height: "min(48vw, 190px)" }}
                  className="rounded-[50%] border-2 border-dashed border-white/25 transition-opacity duration-300"
                />
              </div>
            )}

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
                  {livenessPassed
                    ? "Identity Verified ✓"
                    : verificationInProgress && verificationMessage
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
