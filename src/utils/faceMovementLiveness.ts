import {
  computeLandmarksFromVideoFrame,
  type FaceLandmarks,
  type FacePoint,
} from "./faceApiLoader";

export const DEFAULT_MOVEMENT_MAX_TIME_MS = Math.max(
  2200,
  Number(import.meta.env.VITE_FACEAPI_MOVEMENT_MAX_TIME_MS || 3200)
);
export const DEFAULT_MOVEMENT_SAMPLE_FPS = Math.max(
  5,
  Math.min(8, Number(import.meta.env.VITE_FACEAPI_MOVEMENT_SAMPLE_FPS || 6))
);
export const DEFAULT_MOVEMENT_TRANSLATE_THRESHOLD = Number(
  import.meta.env.VITE_FACEAPI_MOVEMENT_TRANSLATE_THRESHOLD || 0.045
);
export const DEFAULT_MOVEMENT_ROTATION_THRESHOLD = Number(
  import.meta.env.VITE_FACEAPI_MOVEMENT_ROTATION_THRESHOLD || 0.045
);

type MovementLivenessOptions = {
  maxTimeMs?: number;
  sampleFps?: number;
  translateThreshold?: number;
  rotThreshold?: number;
};

export type MovementLivenessResult = {
  ok: boolean;
  metric: {
    samples: number;
    translation: number;
    rotation: number;
    missingFaceSamples: number;
  };
  reason?: string;
};

type FacePoseSample = {
  center: FacePoint;
  size: number;
  noseOffsetX: number;
  eyeTilt: number;
};

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });

function distance(left: FacePoint, right: FacePoint) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function average(points: FacePoint[]) {
  const total = points.reduce(
    (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
    { x: 0, y: 0 }
  );
  return {
    x: total.x / Math.max(points.length, 1),
    y: total.y / Math.max(points.length, 1),
  };
}

function getPoseSample(landmarks: FaceLandmarks): FacePoseSample | null {
  const points = landmarks.positions;
  if (points.length < 68) return null;

  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const size = Math.max(maxX - minX, maxY - minY, 1);
  const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };

  const leftEye = average(points.slice(36, 42));
  const rightEye = average(points.slice(42, 48));
  const nose = points[30];
  const chin = points[8];
  const eyeMid = average([leftEye, rightEye]);
  const faceHeight = Math.max(distance(eyeMid, chin), 1);

  return {
    center,
    size,
    noseOffsetX: (nose.x - eyeMid.x) / faceHeight,
    eyeTilt: (rightEye.y - leftEye.y) / Math.max(distance(leftEye, rightEye), 1),
  };
}

function compareSamples(first: FacePoseSample, next: FacePoseSample) {
  const normalizer = Math.max(first.size, next.size, 1);
  const translation = distance(first.center, next.center) / normalizer;
  const rotation =
    Math.abs(first.noseOffsetX - next.noseOffsetX) +
    Math.abs(first.eyeTilt - next.eyeTilt);
  return { translation, rotation };
}

export async function runMovementLiveness(
  video: HTMLVideoElement,
  options: MovementLivenessOptions = {}
): Promise<MovementLivenessResult> {
  const maxTimeMs = options.maxTimeMs || DEFAULT_MOVEMENT_MAX_TIME_MS;
  const sampleFps = options.sampleFps || DEFAULT_MOVEMENT_SAMPLE_FPS;
  const translateThreshold =
    options.translateThreshold || DEFAULT_MOVEMENT_TRANSLATE_THRESHOLD;
  const rotThreshold = options.rotThreshold || DEFAULT_MOVEMENT_ROTATION_THRESHOLD;
  const sampleIntervalMs = Math.round(1000 / sampleFps);
  const startedAt = performance.now();
  const armAt = startedAt + 300;

  let baseline: FacePoseSample | null = null;
  let samples = 0;
  let missingFaceSamples = 0;
  let maxTranslation = 0;
  let maxRotation = 0;

  while (performance.now() - startedAt < maxTimeMs) {
    const landmarks = await computeLandmarksFromVideoFrame(video);
    const pose = landmarks ? getPoseSample(landmarks) : null;

    if (!pose) {
      missingFaceSamples += 1;
      if (missingFaceSamples >= 4) {
        break;
      }
      await wait(sampleIntervalMs);
      continue;
    }

    samples += 1;
    missingFaceSamples = 0;
    if (!baseline) {
      baseline = pose;
      await wait(sampleIntervalMs);
      continue;
    }

    const movement = compareSamples(baseline, pose);
    maxTranslation = Math.max(maxTranslation, movement.translation);
    maxRotation = Math.max(maxRotation, movement.rotation);

    if (
      performance.now() >= armAt &&
      (maxTranslation >= translateThreshold || maxRotation >= rotThreshold)
    ) {
      return {
        ok: true,
        metric: {
          samples,
          translation: maxTranslation,
          rotation: maxRotation,
          missingFaceSamples,
        },
      };
    }

    await wait(sampleIntervalMs);
  }

  return {
    ok: false,
    metric: {
      samples,
      translation: maxTranslation,
      rotation: maxRotation,
      missingFaceSamples,
    },
    reason: "Keep your face centered and make a small natural head movement.",
  };
}
