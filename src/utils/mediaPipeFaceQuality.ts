import type { Detection, FaceDetector } from "@mediapipe/tasks-vision";

export type FaceQualityResult = {
  supported: boolean;
  ready: boolean;
  ok: boolean;
  reason: string;
  faceCount: number;
  score: number;
  centered: boolean;
  largeEnough: boolean;
  stable: boolean;
  box?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

const WASM_BASE_URL =
  import.meta.env.VITE_MEDIAPIPE_WASM_BASE_URL ||
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm";

const MODEL_URL =
  import.meta.env.VITE_MEDIAPIPE_FACE_DETECTOR_MODEL_URL ||
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite";

const MIN_FACE_SCORE = Number(import.meta.env.VITE_FACE_MIN_DETECTION_SCORE || 0.62);
const MIN_FACE_AREA_RATIO = Number(import.meta.env.VITE_FACE_MIN_AREA_RATIO || 0.12);
const CENTER_TOLERANCE_RATIO = Number(import.meta.env.VITE_FACE_CENTER_TOLERANCE_RATIO || 0.22);
const STABLE_MOVE_TOLERANCE_RATIO = Number(import.meta.env.VITE_FACE_STABLE_MOVE_TOLERANCE_RATIO || 0.035);

let detectorPromise: Promise<FaceDetector | null> | null = null;
let lastCenter: { x: number; y: number; at: number } | null = null;

function createBaseResult(reason: string): FaceQualityResult {
  return {
    supported: false,
    ready: false,
    ok: false,
    reason,
    faceCount: 0,
    score: 0,
    centered: false,
    largeEnough: false,
    stable: false,
  };
}

async function getDetector() {
  if (detectorPromise) return detectorPromise;

  detectorPromise = (async () => {
    try {
      const { FaceDetector, FilesetResolver } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks(WASM_BASE_URL);
      return await FaceDetector.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: MODEL_URL,
        },
        runningMode: "VIDEO",
        minDetectionConfidence: MIN_FACE_SCORE,
      });
    } catch (error) {
      console.warn("MediaPipe face detector unavailable", error);
      return null;
    }
  })();

  return detectorPromise;
}

function getDetectionScore(detection: Detection) {
  return Number(detection.categories?.[0]?.score || 0);
}

export async function assessMediaPipeFaceQuality(
  video: HTMLVideoElement
): Promise<FaceQualityResult> {
  if (!video.videoWidth || !video.videoHeight) {
    return createBaseResult("Camera preview is not ready.");
  }

  const detector = await getDetector();
  if (!detector) {
    return {
      ...createBaseResult("MediaPipe face guidance unavailable."),
      supported: false,
      ready: false,
      ok: true,
    };
  }

  const result = detector.detectForVideo(video, performance.now());
  const detections = result.detections || [];

  if (detections.length !== 1) {
    lastCenter = null;
    return {
      supported: true,
      ready: true,
      ok: false,
      reason: detections.length > 1 ? "Only one face should be visible." : "Looking for face.",
      faceCount: detections.length,
      score: 0,
      centered: false,
      largeEnough: false,
      stable: false,
    };
  }

  const detection = detections[0];
  const box = detection.boundingBox;
  const score = getDetectionScore(detection);

  if (!box) {
    lastCenter = null;
    return {
      supported: true,
      ready: true,
      ok: false,
      reason: "Keep your face inside the guide.",
      faceCount: 1,
      score,
      centered: false,
      largeEnough: false,
      stable: false,
    };
  }

  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;
  const centerX = box.originX + box.width / 2;
  const centerY = box.originY + box.height / 2;
  const normalizedCenterDelta =
    Math.hypot(centerX - videoWidth / 2, centerY - videoHeight / 2) /
    Math.min(videoWidth, videoHeight);
  const areaRatio = (box.width * box.height) / (videoWidth * videoHeight);
  const centered = normalizedCenterDelta <= CENTER_TOLERANCE_RATIO;
  const largeEnough = areaRatio >= MIN_FACE_AREA_RATIO;

  const now = performance.now();
  const previous = lastCenter;
  const movedRatio = previous
    ? Math.hypot(centerX - previous.x, centerY - previous.y) / Math.min(videoWidth, videoHeight)
    : Number.POSITIVE_INFINITY;
  const stable =
    Boolean(previous) &&
    movedRatio <= STABLE_MOVE_TOLERANCE_RATIO &&
    now - previous.at >= 450;
  lastCenter = { x: centerX, y: centerY, at: previous && movedRatio <= STABLE_MOVE_TOLERANCE_RATIO ? previous.at : now };

  const ok = score >= MIN_FACE_SCORE && centered && largeEnough && stable;
  const reason = ok
    ? "Face ready."
    : !largeEnough
      ? "Move a little closer."
      : !centered
        ? "Center your face."
        : !stable
          ? "Hold steady."
          : "Looking for face.";

  return {
    supported: true,
    ready: true,
    ok,
    reason,
    faceCount: 1,
    score,
    centered,
    largeEnough,
    stable,
    box: {
      x: box.originX,
      y: box.originY,
      width: box.width,
      height: box.height,
    },
  };
}
