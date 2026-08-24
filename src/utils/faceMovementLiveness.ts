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
  5,
  Math.min(10, Number(import.meta.env.VITE_FACEAPI_MOVEMENT_SAMPLE_FPS || 8))
);
export const DEFAULT_MOVEMENT_TRANSLATE_THRESHOLD = Number(
  import.meta.env.VITE_FACEAPI_MOVEMENT_TRANSLATE_THRESHOLD || 0.045
);
export const DEFAULT_MOVEMENT_ROTATION_THRESHOLD = Number(
  import.meta.env.VITE_FACEAPI_MOVEMENT_ROTATION_THRESHOLD || 0.045
);

export const RELATIVE_PITCH_DELTA_THRESHOLD = 0.055;
export const RELATIVE_YAW_DELTA_THRESHOLD = 0.075;
export const MIN_LIVENESS_DURATION_MS = 500;
export const CONSECUTIVE_FRAMES_REQUIRED = 3;

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

export function getChallengePrompt(challenge: LivenessChallenge): string {
  switch (challenge) {
    case "TURN_LEFT":
      return "Turn head slightly to the left";
    case "TURN_RIGHT":
      return "Turn head slightly to the right";
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
  const challengePrompt = getChallengePrompt(challenge);

  options.onChallengeUpdate?.({
    challenge,
    prompt: challengePrompt,
    progress: 0,
    passed: false,
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
    const timeProgress = Math.min(elapsed / maxTimeMs, 1);

    // --- Check Challenge Conditions (Strict Relative Movements) ---
    if (challenge === "TILT_UP") {
      // Relative pitch change upwards (nose moves upward relative to eye midpoint, pitchRatio decreases)
      const tiltUpDelta = baseline.pitchRatio - pose.pitchRatio;
      if (tiltUpDelta >= RELATIVE_PITCH_DELTA_THRESHOLD) {
        consecutiveFrames += 1;
        options.onChallengeUpdate?.({
          challenge,
          prompt: "Holding head tilt up...",
          progress: Math.min(
            0.35 + (consecutiveFrames / CONSECUTIVE_FRAMES_REQUIRED) * 0.55,
            0.9
          ),
          passed: false,
        });
        if (consecutiveFrames >= CONSECUTIVE_FRAMES_REQUIRED) {
          challengePassed = true;
        }
      } else {
        consecutiveFrames = Math.max(0, consecutiveFrames - 1);
      }
    } else if (challenge === "TILT_DOWN") {
      // Relative pitch change downwards (nose moves downward relative to eye midpoint, pitchRatio increases)
      const tiltDownDelta = pose.pitchRatio - baseline.pitchRatio;
      if (tiltDownDelta >= RELATIVE_PITCH_DELTA_THRESHOLD) {
        consecutiveFrames += 1;
        options.onChallengeUpdate?.({
          challenge,
          prompt: "Holding head tilt down...",
          progress: Math.min(
            0.35 + (consecutiveFrames / CONSECUTIVE_FRAMES_REQUIRED) * 0.55,
            0.9
          ),
          passed: false,
        });
        if (consecutiveFrames >= CONSECUTIVE_FRAMES_REQUIRED) {
          challengePassed = true;
        }
      } else {
        consecutiveFrames = Math.max(0, consecutiveFrames - 1);
      }
    } else if (challenge === "TURN_LEFT") {
      // Relative yaw change to left from initial baseline
      if (yawDelta >= RELATIVE_YAW_DELTA_THRESHOLD) {
        consecutiveFrames += 1;
        options.onChallengeUpdate?.({
          challenge,
          prompt: "Holding head turn left...",
          progress: Math.min(
            0.35 + (consecutiveFrames / CONSECUTIVE_FRAMES_REQUIRED) * 0.55,
            0.9
          ),
          passed: false,
        });
        if (consecutiveFrames >= CONSECUTIVE_FRAMES_REQUIRED) {
          challengePassed = true;
        }
      } else {
        consecutiveFrames = Math.max(0, consecutiveFrames - 1);
      }
    } else if (challenge === "TURN_RIGHT") {
      // Relative yaw change to right from initial baseline
      const rightYawDelta = baseline.yawRatio - pose.yawRatio;
      if (rightYawDelta >= RELATIVE_YAW_DELTA_THRESHOLD) {
        consecutiveFrames += 1;
        options.onChallengeUpdate?.({
          challenge,
          prompt: "Holding head turn right...",
          progress: Math.min(
            0.35 + (consecutiveFrames / CONSECUTIVE_FRAMES_REQUIRED) * 0.55,
            0.9
          ),
          passed: false,
        });
        if (consecutiveFrames >= CONSECUTIVE_FRAMES_REQUIRED) {
          challengePassed = true;
        }
      } else {
        consecutiveFrames = Math.max(0, consecutiveFrames - 1);
      }
    }

    // Must satisfy challenge condition AND minimum liveness sampling time guard
    if (challengePassed && elapsed >= MIN_LIVENESS_DURATION_MS) {
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
          pitchDelta: maxPitchDelta,
          yawDelta: maxYawDelta,
        },
      };
    }

    if (consecutiveFrames === 0) {
      options.onChallengeUpdate?.({
        challenge,
        prompt: challengePrompt,
        progress: Math.min(timeProgress * 0.6, 0.6),
        passed: false,
      });
    }

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
