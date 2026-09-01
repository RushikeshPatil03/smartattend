import {
  computeLandmarksFromVideoFrame,
  type FaceLandmarks,
  type FacePoint,
} from "./faceApiLoader";

export type LivenessChallenge =
  | "TURN_LEFT"
  | "TURN_RIGHT"
  | "TILT_UP"
  | "TILT_DOWN";

export const CHALLENGES: readonly LivenessChallenge[] = [
  "TURN_LEFT",
  "TURN_RIGHT",
  "TILT_UP",
  "TILT_DOWN",
] as const;

export const DEFAULT_MOVEMENT_MAX_TIME_MS = Math.max(
  2400,
  Number(import.meta.env.VITE_FACEAPI_MOVEMENT_MAX_TIME_MS || 3200)
);
export const DEFAULT_MOVEMENT_SAMPLE_FPS = Math.max(
  8,
  Math.min(14, Number(import.meta.env.VITE_FACEAPI_MOVEMENT_SAMPLE_FPS || 10))
);
export const DEFAULT_MOVEMENT_TRANSLATE_THRESHOLD = Number(
  import.meta.env.VITE_FACEAPI_MOVEMENT_TRANSLATE_THRESHOLD || 0.045
);
export const DEFAULT_MOVEMENT_ROTATION_THRESHOLD = Number(
  import.meta.env.VITE_FACEAPI_MOVEMENT_ROTATION_THRESHOLD || 0.045
);

export const RELATIVE_PITCH_DELTA_THRESHOLD = 0.052;
export const RELATIVE_YAW_DELTA_THRESHOLD = 0.070;
export const MIN_LIVENESS_DURATION_MS = 350;
export const CONSECUTIVE_FRAMES_REQUIRED = 2;

export type ChallengeDirection = "UP" | "DOWN" | "LEFT" | "RIGHT";

export type ChallengeUpdate = {
  challenge: LivenessChallenge;
  direction: ChallengeDirection;
  prompt: string;
  progress: number; // 0.0 to 1.0
  passed: boolean;
  rawDelta: number;
  targetThreshold: number;
  reason?: string;
};

export type MovementLivenessOptions = {
  maxTimeMs?: number;
  sampleFps?: number;
  translateThreshold?: number;
  rotThreshold?: number;
  challenge?: LivenessChallenge;
  onChallengeUpdate?: (update: ChallengeUpdate) => void;
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
    pitchDelta?: number;
    yawDelta?: number;
  };
  reason?: string;
};

type FacePoseSample = {
  center: FacePoint;
  size: number;
  noseOffsetX: number;
  eyeTilt: number;
  pitchRatio: number;
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

export function getChallengeDirection(challenge: LivenessChallenge): ChallengeDirection {
  switch (challenge) {
    case "TILT_UP":
      return "UP";
    case "TILT_DOWN":
      return "DOWN";
    case "TURN_LEFT":
      return "LEFT";
    case "TURN_RIGHT":
      return "RIGHT";
    default:
      return "UP";
  }
}

export function getChallengePrompt(challenge: LivenessChallenge): string {
  switch (challenge) {
    case "TURN_LEFT":
      return "Turn head slightly left";
    case "TURN_RIGHT":
      return "Turn head slightly right";
    case "TILT_UP":
      return "Tilt head slightly upwards";
    case "TILT_DOWN":
      return "Tilt head slightly downwards";
    default:
      return "Please make a slight head movement";
  }
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
  const eyeMid = average(points.slice(36, 48));
  const nose = points[30] || { x: center.x, y: center.y };
  const chin = points[8] || { x: center.x, y: maxY };
  const faceHeight = Math.max(distance(eyeMid, chin), 1);

  const pitchRatio = (nose.y - eyeMid.y) / faceHeight;
  const yawRatio =
    (nose.x - points[0].x) / Math.max(distance(points[0], points[16]), 1);

  return {
    center,
    size,
    noseOffsetX: (nose.x - eyeMid.x) / faceHeight,
    eyeTilt: (rightEye.y - leftEye.y) / Math.max(distance(leftEye, rightEye), 1),
    pitchRatio,
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
  const direction = getChallengeDirection(challenge);
  const challengePrompt = getChallengePrompt(challenge);

  options.onChallengeUpdate?.({
    challenge,
    direction,
    prompt: challengePrompt,
    progress: 0,
    passed: false,
    rawDelta: 0,
    targetThreshold: challenge.startsWith("TILT")
      ? RELATIVE_PITCH_DELTA_THRESHOLD
      : RELATIVE_YAW_DELTA_THRESHOLD,
  });

  const startedAt = performance.now();

  let baseline: FacePoseSample | null = null;
  let samples = 0;
  let missingFaceSamples = 0;
  let maxTranslation = 0;
  let maxRotation = 0;
  let maxPitchDelta = 0;
  let maxYawDelta = 0;

  // State machine variables
  let consecutiveFrames = 0;
  let challengePassed = false;

  while (performance.now() - startedAt < maxTimeMs) {
    // Yield to the browser compositor to ensure smooth camera rendering
    await new Promise<void>((resolve) => {
      if (typeof requestAnimationFrame !== "undefined") {
        requestAnimationFrame(() => resolve());
      } else {
        setTimeout(resolve, 0);
      }
    });

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

    if (!baseline) {
      baseline = pose;
      await wait(sampleIntervalMs);
      continue;
    }

    const movement = compareSamples(baseline, pose);
    maxTranslation = Math.max(maxTranslation, movement.translation);
    maxRotation = Math.max(maxRotation, movement.rotation);

    const pitchDelta = pose.pitchRatio - baseline.pitchRatio;
    if (Math.abs(pitchDelta) > Math.abs(maxPitchDelta)) {
      maxPitchDelta = pitchDelta;
    }

    const yawDelta = pose.yawRatio - baseline.yawRatio;
    if (Math.abs(yawDelta) > Math.abs(maxYawDelta)) {
      maxYawDelta = yawDelta;
    }

    const elapsed = performance.now() - startedAt;

    // Determine motion delta towards the target challenge
    let currentDelta = 0;
    let targetThreshold = 1;

    if (challenge === "TILT_UP") {
      targetThreshold = RELATIVE_PITCH_DELTA_THRESHOLD;
      currentDelta = baseline.pitchRatio - pose.pitchRatio;
    } else if (challenge === "TILT_DOWN") {
      targetThreshold = RELATIVE_PITCH_DELTA_THRESHOLD;
      currentDelta = pose.pitchRatio - baseline.pitchRatio;
    } else if (challenge === "TURN_LEFT") {
      targetThreshold = RELATIVE_YAW_DELTA_THRESHOLD;
      currentDelta = pose.yawRatio - baseline.yawRatio;
    } else if (challenge === "TURN_RIGHT") {
      targetThreshold = RELATIVE_YAW_DELTA_THRESHOLD;
      currentDelta = baseline.yawRatio - pose.yawRatio;
    }

    // Granular delta progress calculation
    const deltaRatio = Math.max(0, currentDelta / targetThreshold);
    const currentProgress = Math.min(1.0, deltaRatio);

    if (deltaRatio >= 1.0) {
      consecutiveFrames += 1;
      if (consecutiveFrames >= CONSECUTIVE_FRAMES_REQUIRED) {
        challengePassed = true;
      }
    } else {
      consecutiveFrames = Math.max(0, consecutiveFrames - 1);
    }

    // Check completion condition
    if (challengePassed && elapsed >= MIN_LIVENESS_DURATION_MS) {
      options.onChallengeUpdate?.({
        challenge,
        direction,
        prompt: `${challengePrompt} ✓`,
        progress: 1.0,
        passed: true,
        rawDelta: currentDelta,
        targetThreshold,
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
          pitchDelta: maxPitchDelta,
          yawDelta: maxYawDelta,
        },
      };
    }

    // Send real-time progress update to the visual progress ring
    const promptText = challengePassed
      ? "Liveness verified ✓"
      : consecutiveFrames > 0
      ? `Hold ${challengePrompt.toLowerCase()}...`
      : challengePrompt;

    options.onChallengeUpdate?.({
      challenge,
      direction,
      prompt: promptText,
      progress: challengePassed ? 1.0 : Math.min(0.98, currentProgress),
      passed: challengePassed,
      rawDelta: currentDelta,
      targetThreshold,
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
      pitchDelta: maxPitchDelta,
      yawDelta: maxYawDelta,
    },
    reason: `Liveness challenge (${challengePrompt}) was not completed in time. Please try again.`,
  };
}
