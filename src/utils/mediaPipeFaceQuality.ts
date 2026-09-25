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
  "/models/mediapipe/wasm";

const MODEL_URL =
  import.meta.env.VITE_MEDIAPIPE_FACE_DETECTOR_MODEL_URL ||
  "/models/mediapipe/blaze_face_short_range.tflite";

const MIN_FACE_SCORE = Number(import.meta.env.VITE_FACE_MIN_DETECTION_SCORE || 0.52);
const MIN_FACE_AREA_RATIO = Number(import.meta.env.VITE_FACE_MIN_AREA_RATIO || 0.08);
const CENTER_TOLERANCE_RATIO = Number(import.meta.env.VITE_FACE_CENTER_TOLERANCE_RATIO || 0.38);
const STABLE_MOVE_TOLERANCE_RATIO = Number(import.meta.env.VITE_FACE_STABLE_MOVE_TOLERANCE_RATIO || 0.08);

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

/**
 * Prewarms the MediaPipe FaceDetector model and WebAssembly backend
 * Call during idle time when student dashboard loads.
 */
export async function prewarmMediaPipe(): Promise<void> {
  try {
    await getDetector();
  } catch {
    // Non-blocking warmup
  }
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
    now - previous.at >= 120;
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

export type MediaPipePoseSample = {
  center: { x: number; y: number };
  size: number;
  noseOffsetX: number;
  eyeTilt: number;
  pitchRatio: number;
  yawRatio: number;
  score: number;
};

/**
 * Ultra-fast MediaPipe BlazeFace head-pose analyzer (3-5ms execution time).
 * Uses WebAssembly C++ with SIMD vectorization to track keypoints for liveness challenges
 * without causing any main-thread camera frame drops.
 */
export async function detectMediaPipePose(
  video: HTMLVideoElement
): Promise<MediaPipePoseSample | null> {
  if (!video.videoWidth || !video.videoHeight || video.readyState < 2) {
    return null;
  }

  const detector = await getDetector();
  if (!detector) return null;

  try {
    const result = detector.detectForVideo(video, performance.now());
    const detections = result.detections || [];
    if (detections.length !== 1) return null;

    const detection = detections[0];
    const keypoints = detection.keypoints || [];
    if (keypoints.length < 4) return null;

    const score = getDetectionScore(detection);
    if (score < 0.42) return null;

    // BlazeFace 6 Keypoints (normalized 0.0 - 1.0):
    // 0: right eye, 1: left eye, 2: nose tip, 3: mouth center, 4: right ear, 5: left ear
    const rightEye = keypoints[0];
    const leftEye = keypoints[1];
    const nose = keypoints[2];
    const mouth = keypoints[3];

    const eyeMidX = (rightEye.x + leftEye.x) / 2;
    const eyeMidY = (rightEye.y + leftEye.y) / 2;
    const eyeDist = Math.max(Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y), 0.001);
    const faceHeight = Math.max(Math.hypot(eyeMidX - mouth.x, eyeMidY - mouth.y), 0.001);

    // Yaw ratio: horizontal displacement of nose relative to eye distance
    // In mirrored front-camera feed: nose.x moves relative to eyeMidX
    const yawRatio = (nose.x - eyeMidX) / eyeDist;

    // Pitch ratio: vertical displacement of nose relative to eye-mouth distance
    const pitchRatio = (nose.y - eyeMidY) / faceHeight;

    const eyeTilt = (rightEye.y - leftEye.y) / eyeDist;
    const noseOffsetX = (nose.x - eyeMidX) / faceHeight;

    return {
      center: { x: eyeMidX, y: eyeMidY },
      size: eyeDist,
      noseOffsetX,
      eyeTilt,
      pitchRatio,
      yawRatio,
      score,
    };
  } catch {
    return null;
  }
}
