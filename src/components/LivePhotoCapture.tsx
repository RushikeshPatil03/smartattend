import React, { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Compass, RefreshCw, ShieldAlert, Smartphone } from "lucide-react";
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
import { runMovementLiveness } from "../utils/faceMovementLiveness";
import { buildFaceSignatures } from "../utils/faceSignature";

const PORTRAIT_BETA_MIN = 55;
const PORTRAIT_BETA_MAX = 125;
const PORTRAIT_GAMMA_TOLERANCE = 28;
const ORIENTATION_UPDATE_THRESHOLD = 0.8;
const FACE_QUALITY_INTERVAL_MS = 250;
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
  description = "Hold the phone upright in portrait mode at face or waist level. Landscape or flat positions stay blocked when sensors are available.",
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
  const [orientation, setOrientation] = useState<OrientationState>(initialOrientationState);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const orientationCleanupRef = useRef<(() => void) | null>(null);
  const orientationFrameRef = useRef<number | null>(null);
  const pendingOrientationRef = useRef<{ beta: number | null; gamma: number | null } | null>(null);
  const autoCaptureTimerRef = useRef<number | null>(null);
  const verificationInFlightRef = useRef(false);

  const alignmentReady = useMemo(
    () => isPortraitUpright(orientation.beta, orientation.gamma),
    [orientation.beta, orientation.gamma]
  );

  const canAutoGateCapture =
    orientation.supported &&
    (!orientation.permissionRequired || orientation.permissionGranted);
  const canUseFaceQualityGate = enableFaceQuality && Boolean(faceQuality?.supported && faceQuality.ready);
  const faceQualityReady = !canUseFaceQualityGate || Boolean(faceQuality?.ok);
  const captureEnabled =
    cameraActive &&
    !cameraLoading &&
    (!canAutoGateCapture || alignmentReady) &&
    faceQualityReady &&
    !verificationInProgress &&
    !disabled;

  const stopCamera = () => {
    verificationInFlightRef.current = false;
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraActive(false);
    setCameraLoading(false);
    setFaceQuality(null);
    setVerificationInProgress(false);
    setVerificationMessage("");
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
    setCameraActive(true);

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera is not supported in this browser.");
      }

      if (
        orientation.supported &&
        orientation.permissionRequired &&
        !orientation.permissionGranted
      ) {
        void requestOrientationPermission();
      }

      await waitForNextFrame();

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: "user",
            width: { ideal: 480, max: 640 },
            height: { ideal: 640, max: 800 },
            frameRate: { ideal: 30, max: 30 },
          },
        });
      } catch (primaryError: any) {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: "user" },
        });
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.style.transform = "none";
        await videoRef.current.play().catch(() => undefined);
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
        await loadModelsIfNeeded();
        setVerificationMessage("Checking live face movement...");
        const liveness = await runMovementLiveness(videoRef.current!);
        if (!liveness.ok) {
          throw new Error(liveness.reason || "Live face movement was not detected.");
        }

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
            livenessMetric: liveness.metric,
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
            livenessMetric: liveness.metric,
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
      setCaptureError(error?.message || "Unable to capture photo.");
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
    if (!autoStart || disabled || cameraActive || cameraLoading || value) {
      return;
    }

    void startCamera();
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
      verificationInProgress
    ) {
      return;
    }

    if (canAutoGateCapture && !alignmentReady) {
      return;
    }
    if (!faceQualityReady) {
      return;
    }

    const delay = canAutoGateCapture ? 700 : 1400;
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
    alignmentReady,
    autoCapture,
    cameraActive,
    cameraLoading,
    canAutoGateCapture,
    disabled,
    faceQualityReady,
    verificationInProgress,
    value,
  ]);

  useEffect(() => {
    if (!captureRequestKey || !cameraActive || cameraLoading || disabled) {
      return;
    }
    if (canAutoGateCapture && !alignmentReady) {
      setCaptureError("Hold the phone upright before verifying.");
      return;
    }
    if (!faceQualityReady) {
      setCaptureError(faceQuality?.reason || "Hold steady until your face is ready.");
      return;
    }
    capturePhoto();
  }, [
    alignmentReady,
    cameraActive,
    cameraLoading,
    canAutoGateCapture,
    captureRequestKey,
    disabled,
    faceQuality?.reason,
    faceQualityReady,
  ]);

  return (
    <div className="surface-card space-y-4 rounded-[24px] border border-slate-200/80 p-4">
      {!compactMode ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-900">{title}</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">{title}</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
          </div>
          {canUseFaceQualityGate ? (
            <div
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${
                faceQualityReady
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-rose-200 bg-rose-50 text-rose-700"
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
          <div className="relative overflow-hidden rounded-[22px] border border-slate-200 bg-black">
            <video ref={videoRef} className="aspect-[3/4] w-full object-cover" autoPlay muted playsInline />
          </div>

          {autoCapture ? (
            <div className="rounded-2xl border border-teal-100 bg-teal-50 px-4 py-3 text-center text-sm font-medium text-teal-800">
              {verificationMessage || (canAutoGateCapture
                ? alignmentReady
                  ? faceQualityReady
                    ? "Face ready. Capturing automatically..."
                    : faceQuality?.reason || "Checking face..."
                  : "Hold the phone upright and stay steady."
                : faceQualityReady
                  ? "Stay steady. Capturing automatically..."
                  : faceQuality?.reason || "Checking face...")}
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button type="button" onClick={capturePhoto} disabled={!captureEnabled} className="flex-1">
                <Camera size={16} />
                {cameraLoading ? "Starting Camera..." : "Capture Photo"}
              </Button>
              <Button type="button" variant="secondary" onClick={stopCamera} className="flex-1">
                Cancel Camera
              </Button>
            </div>
          )}
        </div>
      ) : value && showCapturedPreview ? (
        <div className="space-y-3">
          <img src={value} alt="Captured profile" loading="lazy" className="aspect-square w-36 rounded-[22px] border border-slate-200 object-cover shadow-sm" />
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button type="button" variant="secondary" onClick={() => onChange("")} className="flex-1">
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
                <p className="font-semibold text-slate-800">Mobile-ready capture</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Opens the front camera directly and uses orientation sensors, when available, to verify upright portrait holding.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
            <Button type="button" onClick={startCamera} disabled={cameraLoading || disabled} className="flex-1">
                {cameraLoading ? <><RefreshCw size={16} className="animate-spin" /> Opening Camera</> : <><Camera size={16} /> Open Camera</>}
              </Button>
              {orientation.supported && orientation.permissionRequired && !orientation.permissionGranted ? (
                <Button type="button" variant="secondary" onClick={requestOrientationPermission} className="flex-1">
                  <Compass size={16} />
                  Enable Gyroscope
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {captureError ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex items-start gap-2">
            <ShieldAlert size={16} className="mt-0.5 shrink-0" />
            <span>{captureError}</span>
          </div>
          {!cameraActive ? (
            <Button type="button" variant="secondary" onClick={startCamera} disabled={cameraLoading || disabled}>
              <RefreshCw size={16} />
              Retry
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default LivePhotoCapture;
