const FACE_SIGNATURE_VERSION = "grid16-v1";
const FACE_SIGNATURE_HEX_LENGTH = 256;
const FACE_MATCH_THRESHOLD = Number(
  process.env.FACE_MATCH_THRESHOLD || 0.75
);
const FACE_CAPTURE_MAX_AGE_MS = Number(
  process.env.FACE_CAPTURE_MAX_AGE_MS || 10000
);
const FACE_VERIFICATION_STRICT_SERVICE =
  String(process.env.FACE_VERIFICATION_STRICT_SERVICE || "").toLowerCase() === "true";
const {
  isFaceNetEnabled,
  verifyFaceEmbedding,
} = require("./faceEmbeddingService");

function isImageDataUrl(value) {
  return /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(String(value || ""));
}

function isValidFaceSignature(value) {
  return /^[0-9a-f]{256}$/i.test(String(value || "").trim());
}

function decodeSignature(signature) {
  return String(signature || "")
    .trim()
    .toLowerCase()
    .slice(0, FACE_SIGNATURE_HEX_LENGTH)
    .split("")
    .map((char) => Number.parseInt(char, 16));
}

function compareSignatures(referenceSignature, candidateSignature) {
  const reference = decodeSignature(referenceSignature);
  const candidate = decodeSignature(candidateSignature);

  if (
    reference.length !== FACE_SIGNATURE_HEX_LENGTH ||
    candidate.length !== FACE_SIGNATURE_HEX_LENGTH
  ) {
    return 0;
  }

  let delta = 0;
  for (let index = 0; index < FACE_SIGNATURE_HEX_LENGTH; index += 1) {
    delta += Math.abs(reference[index] - candidate[index]);
  }

  const normalizedDelta = delta / (FACE_SIGNATURE_HEX_LENGTH * 15);
  return Number((1 - normalizedDelta).toFixed(4));
}

function resolveBestFaceScore(referenceSignatures, liveSignatures) {
  const pairs = [];

  for (const referenceSignature of referenceSignatures) {
    for (const liveSignature of liveSignatures) {
      if (!referenceSignature || !liveSignature) continue;
      pairs.push(compareSignatures(referenceSignature, liveSignature));
    }
  }

  return pairs.length ? Math.max(...pairs) : 0;
}

async function verifyFaceForAttendance(student, payload = {}, now = new Date()) {
  const version = String(payload.faceSignatureVersion || "").trim();
  const hasLiveImage = isImageDataUrl(payload.liveFaceImageDataUrl);
  if (!hasLiveImage && version && version !== FACE_SIGNATURE_VERSION) {
    return { ok: false, error: "Unsupported face verification signature version" };
  }

  const studentEmbedding = student?.faceEmbedding || student?.face_embedding;
  if (isFaceNetEnabled() && hasLiveImage && Array.isArray(studentEmbedding)) {
    const embeddingCheck = await verifyFaceEmbedding(
      { ...student, faceEmbedding: studentEmbedding },
      payload.liveFaceImageDataUrl,
      {
        capturedAt: payload.capturedAt ? new Date(payload.capturedAt).toISOString() : new Date().toISOString(),
        clientQuality: payload.clientQuality || null,
      }
    );

    if (embeddingCheck.ok) {
      return {
        ok: true,
        score: embeddingCheck.score,
        threshold: embeddingCheck.threshold,
        distance: embeddingCheck.distance,
        model: embeddingCheck.model || "facenet512",
        modelVersion: embeddingCheck.version,
        provider: "facenet512-service",
      };
    }

    if (FACE_VERIFICATION_STRICT_SERVICE) {
      return {
        ok: false,
        error: embeddingCheck.error || "Face verification failed",
        score: embeddingCheck.score,
        threshold: embeddingCheck.threshold,
      };
    }
  }

  const storedRef = [
    String(student?.faceSignature || student?.face_signature || "").trim().toLowerCase(),
    String(student?.faceSignatureMirror || student?.face_signature_mirror || "").trim().toLowerCase(),
  ].filter(isValidFaceSignature);

  if (!storedRef.length && !payload.faceMatch) {
    return {
      ok: true, // Fallback if no reference registered
      score: 1.0,
      threshold: FACE_MATCH_THRESHOLD,
    };
  }

  if (payload.faceMatch != null) {
    const match = Boolean(payload.faceMatch);
    if (!match) {
      return { ok: false, error: "Face mismatch" };
    }
    return {
      ok: true,
      score: Number(payload.faceMetrics?.confidence || 1.0),
      threshold: FACE_MATCH_THRESHOLD,
    };
  }

  const liveSignatures = [
    String(payload.liveFaceSignature || "").trim().toLowerCase(),
    String(payload.liveFaceSignatureMirror || "").trim().toLowerCase(),
  ].filter(isValidFaceSignature);

  if (liveSignatures.length === 0) {
    return { ok: false, error: "Fresh live face signature is required" };
  }

  const score = resolveBestFaceScore(storedRef, liveSignatures);
  if (score < FACE_MATCH_THRESHOLD) {
    return {
      ok: false,
      error: "Face mismatch. Use the same student face that was captured during registration.",
      score,
      threshold: FACE_MATCH_THRESHOLD,
    };
  }

  return {
    ok: true,
    score,
    threshold: FACE_MATCH_THRESHOLD,
    signatureVersion: FACE_SIGNATURE_VERSION,
  };
}

module.exports = {
  FACE_CAPTURE_MAX_AGE_MS,
  FACE_MATCH_THRESHOLD,
  FACE_SIGNATURE_VERSION,
  isValidFaceSignature,
  isImageDataUrl,
  verifyFaceForAttendance,
  verifyFaceAgainstStudent: verifyFaceForAttendance,
};
