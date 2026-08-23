import {
  computeLandmarksFromVideoFrame,
  type FaceLandmarks,
  type FacePoint,
} from "./faceApiLoader";

export type LivenessChallenge = "BLINK" | "TURN_LEFT" | "TURN_RIGHT";

export const CHALLENGES: readonly LivenessChallenge[] = [
  "BLINK",
  "TURN_LEFT",
  "TURN_RIGHT",
] as const;

export const DEFAULT_MOVEMENT_MAX_TIME_MS = Math.max(
  2400,
  Number(import.meta.env.VITE_FACEAPI_MOVEMENT_MAX_TIME_MS || 3200)
);
export const DEFAULT_MOVEMENT_SAMPLE_FPS = Math.max(
  5,
  Math.min(10, Number(import.meta.env.VITE_FACEAPI_MOVEMENT_SAMPLE_FPS || 8))
);
export const DEFAULT_MOVEMENT_TRANSLATE_THRESHOLD = Number(
  import.meta.env.VITE_FACEAPI_MOVEMENT_TRANSLATE_THRESHOLD || 0.045
);
export const DEFAULT_MOVEMENT_ROTATION_THRESHOLD = Number(
  import.meta.env.VITE_FACEAPI_MOVEMENT_ROTATION_THRESHOLD || 0.045
);

export const EAR_CLOSED_THRESHOLD = 0.20;
export const EAR_OPEN_THRESHOLD = 0.23;
export const YAW_TURN_THRESHOLD = 0.055;

export type MovementLivenessOptions = {
  maxTimeMs?: number;
  sampleFps?: number;
  translateThreshold?: number;
  rotThreshold?: number;
  challenge?: LivenessChallenge;
  onChallengeUpdate?: (update: {
    challenge: LivenessChallenge;
    prompt: string;
    progress: number;
    passed: boolean;
    reason?: string;
  }) => void;
};

export type MovementLivenessResult = {
  ok: boolean;
  challenge: LivenessChallenge;
  challengePrompt: string;
  metric: {
    samples: number;
    translation: number;
    rotation: number;
    missingFaceSamples: number;
    earMin?: number;
    earMax?: number;
    yawDelta?: number;
  };
  reason?: string;
};

type FacePoseSample = {
  center: FacePoint;
  size: number;
  noseOffsetX: number;
  eyeTilt: number;
  ear: number;
  yawRatio: number;
};

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });

function distance(left: FacePoint, right: FacePoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function average(points: FacePoint[]): FacePoint {
  const total = points.reduce(
    (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
    { x: 0, y: 0 }
  );
  return {
    x: total.x / Math.max(points.length, 1),
    y: total.y / Math.max(points.length, 1),
  };
}

export function getRandomLivenessChallenge(): LivenessChallenge {
  const index = Math.floor(Math.random() * CHALLENGES.length);
  return CHALLENGES[index];
}

export function getChallengePrompt(challenge: LivenessChallenge): string {
  switch (challenge) {
    case "BLINK":
      return "Please blink your eyes";
    case "TURN_LEFT":
      return "Turn head slightly to the left";
    case "TURN_RIGHT":
      return "Turn head slightly to the right";
    default:
      return "Please make a slight head movement";
  }
}

function calculateEAR(points: FacePoint[], startIdx: number): number {
  const p0 = points[startIdx];
  const p1 = points[startIdx + 1];
  const p2 = points[startIdx + 2];
  const p3 = points[startIdx + 3];
  const p4 = points[startIdx + 4];
  const p5 = points[startIdx + 5];

  if (!p0 || !p1 || !p2 || !p3 || !p4 || !p5) return 0.25;

  const vertical1 = distance(p1, p5);
  const vertical2 = distance(p2, p4);
  const horizontal = distance(p0, p3);

  if (horizontal <= 0.001) return 0.25;
  return (vertical1 + vertical2) / (2.0 * horizontal);
}

export function computeEyeAspectRatio(landmarks: FaceLandmarks): {
  ear: number;
  leftEar: number;
  rightEar: number;
} {
  const points = landmarks.positions;
  if (points.length < 68) return { ear: 0.25, leftEar: 0.25, rightEar: 0.25 };
  const rightEar = calculateEAR(points, 36);
  const leftEar = calculateEAR(points, 42);
  const ear = (leftEar + rightEar) / 2;
  return { ear, leftEar, rightEar };
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
  const nose = points[30] || { x: center.x, y: center.y };
  const chin = points[8] || { x: center.x, y: maxY };
  const eyeMid = average([leftEye, rightEye]);
  const faceHeight = Math.max(distance(eyeMid, chin), 1);

  const rightCheek = points[0] || { x: minX, y: center.y };
  const leftCheek = points[16] || { x: maxX, y: center.y };
  const cheekSpan = Math.max(leftCheek.x - rightCheek.x, 1);
  const yawRatio = (nose.x - rightCheek.x) / cheekSpan;

  const { ear } = computeEyeAspectRatio(landmarks);

  return {
    center,
    size,
    noseOffsetX: (nose.x - eyeMid.x) / faceHeight,
    eyeTilt: (rightEye.y - leftEye.y) / Math.max(distance(leftEye, rightEye), 1),
    ear,
    yawRatio,
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

  const challenge = options.challenge || getRandomLivenessChallenge();
  const challengePrompt = getChallengePrompt(challenge);

  options.onChallengeUpdate?.({
    challenge,
    prompt: challengePrompt,
    progress: 0,
    passed: false,
  });

  const startedAt = performance.now();
  const armAt = startedAt + 200;

  let baseline: FacePoseSample | null = null;
  let samples = 0;
  let missingFaceSamples = 0;
  let maxTranslation = 0;
  let maxRotation = 0;
  let earMin = 1.0;
  let earMax = 0.0;
  let maxYawDelta = 0;

  // State machine variables
  let eyeSawOpen = false;
  let eyeSawClosed = false;
  let challengePassed = false;

  while (performance.now() - startedAt < maxTimeMs) {
    const landmarks = await computeLandmarksFromVideoFrame(video);
    const pose = landmarks ? getPoseSample(landmarks) : null;

    if (!pose) {
      missingFaceSamples += 1;
      if (missingFaceSamples >= 5) {
        break;
      }
      await wait(sampleIntervalMs);
      continue;
    }

    samples += 1;
    missingFaceSamples = 0;

    earMin = Math.min(earMin, pose.ear);
    earMax = Math.max(earMax, pose.ear);

    if (!baseline) {
      baseline = pose;
      if (pose.ear >= EAR_OPEN_THRESHOLD) {
        eyeSawOpen = true;
      }
      await wait(sampleIntervalMs);
      continue;
    }

    const movement = compareSamples(baseline, pose);
    maxTranslation = Math.max(maxTranslation, movement.translation);
    maxRotation = Math.max(maxRotation, movement.rotation);

    const yawDelta = pose.yawRatio - baseline.yawRatio;
    if (Math.abs(yawDelta) > Math.abs(maxYawDelta)) {
      maxYawDelta = yawDelta;
    }

    const elapsed = performance.now() - startedAt;
    const timeProgress = Math.min(elapsed / maxTimeMs, 1);

    // --- Check Challenge Conditions ---
    if (challenge === "BLINK") {
      if (pose.ear >= EAR_OPEN_THRESHOLD) {
        eyeSawOpen = true;
      }
      if (eyeSawOpen && pose.ear <= EAR_CLOSED_THRESHOLD) {
        eyeSawClosed = true;
        options.onChallengeUpdate?.({
          challenge,
          prompt: "Blink detected, reopening...",
          progress: 0.6,
          passed: false,
        });
      }
      if (eyeSawClosed && pose.ear >= EAR_OPEN_THRESHOLD) {
        challengePassed = true;
      }
    } else if (challenge === "TURN_LEFT") {
      // Nose shifting towards left side relative to baseline or absolute yaw
      if (
        yawDelta >= YAW_TURN_THRESHOLD ||
        pose.yawRatio >= 0.57 ||
        (pose.noseOffsetX - baseline.noseOffsetX) >= 0.045
      ) {
        challengePassed = true;
      }
    } else if (challenge === "TURN_RIGHT") {
      // Nose shifting towards right side relative to baseline or absolute yaw
      if (
        yawDelta <= -YAW_TURN_THRESHOLD ||
        pose.yawRatio <= 0.43 ||
        (pose.noseOffsetX - baseline.noseOffsetX) <= -0.045
      ) {
        challengePassed = true;
      }
    }

    // Fallback: general micro-movement threshold met after warmup
    const generalMovementPassed =
      performance.now() >= armAt &&
      (maxTranslation >= translateThreshold || maxRotation >= rotThreshold);

    if (challengePassed || (challenge !== "BLINK" && generalMovementPassed)) {
      options.onChallengeUpdate?.({
        challenge,
        prompt: `${challengePrompt} ✓`,
        progress: 1.0,
        passed: true,
      });

      return {
        ok: true,
        challenge,
        challengePrompt,
        metric: {
          samples,
          translation: maxTranslation,
          rotation: maxRotation,
          missingFaceSamples,
          earMin,
          earMax,
          yawDelta: maxYawDelta,
        },
      };
    }

    options.onChallengeUpdate?.({
      challenge,
      prompt: challengePrompt,
      progress: Math.min(timeProgress * 0.8, 0.8),
      passed: false,
    });

    await wait(sampleIntervalMs);
  }

  return {
    ok: false,
    challenge,
    challengePrompt,
    metric: {
      samples,
      translation: maxTranslation,
      rotation: maxRotation,
      missingFaceSamples,
      earMin,
      earMax,
      yawDelta: maxYawDelta,
    },
    reason: `Liveness challenge (${challengePrompt}) was not completed in time. Please try again.`,
  };
}
