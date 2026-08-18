const FACENET512_SERVICE_URL = String(process.env.FACENET512_SERVICE_URL || "").replace(/\/+$/, "");
const FACENET512_MODEL = "facenet512";
const FACENET512_VERSION = String(process.env.FACENET512_VERSION || "facenet512-v1");
const FACENET512_DISTANCE_THRESHOLD = Number(
  process.env.FACENET512_DISTANCE_THRESHOLD || 0.38
);
const FACENET512_TIMEOUT_MS = Number(process.env.FACENET512_TIMEOUT_MS || 10000);
const FACE_IMAGE_MAX_LENGTH = Number(process.env.FACE_IMAGE_MAX_LENGTH || 700000);

function isImageDataUrl(value) {
  return /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(String(value || ""));
}

function isFaceNetEnabled() {
  return Boolean(FACENET512_SERVICE_URL);
}

function normalizeEmbedding(value) {
  if (!Array.isArray(value)) return null;
  const embedding = value.map(Number);
  if (
    embedding.length < 128 ||
    embedding.length > 4096 ||
    embedding.some((item) => !Number.isFinite(item))
  ) {
    return null;
  }
  return embedding;
}

async function postToFaceService(path, payload) {
  if (!FACENET512_SERVICE_URL) {
    return { ok: false, skipped: true, error: "FaceNet512 service is not configured" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FACENET512_TIMEOUT_MS);

  try {
    const response = await fetch(`${FACENET512_SERVICE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) {
      return {
        ok: false,
        error: data?.error || `Face service failed with HTTP ${response.status}`,
      };
    }
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error:
        error?.name === "AbortError"
          ? "Face service timed out"
          : error?.message || "Face service unavailable",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function cosineDistance(reference, candidate) {
  if (!reference || !candidate || reference.length !== candidate.length) {
    return Number.POSITIVE_INFINITY;
  }

  let dot = 0;
  let refMag = 0;
  let candMag = 0;
  for (let index = 0; index < reference.length; index += 1) {
    dot += reference[index] * candidate[index];
    refMag += reference[index] * reference[index];
    candMag += candidate[index] * candidate[index];
  }

  if (refMag <= 0 || candMag <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  return Number((1 - dot / (Math.sqrt(refMag) * Math.sqrt(candMag))).toFixed(6));
}

async function createFaceEmbedding(imageDataUrl, context = {}) {
  const image = String(imageDataUrl || "").trim();
  if (!isImageDataUrl(image)) {
    return { ok: false, error: "A valid face image is required" };
  }
  if (image.length > FACE_IMAGE_MAX_LENGTH) {
    return { ok: false, error: "Face image is too large" };
  }

  const result = await postToFaceService("/embed", {
    imageDataUrl: image,
    model: FACENET512_MODEL,
    modelVersion: FACENET512_VERSION,
    context,
  });

  if (!result.ok) return result;

  const embedding = normalizeEmbedding(
    result.data?.embedding || result.data?.faceEmbedding || result.data?.descriptor
  );
  if (!embedding) {
    return { ok: false, error: "Face service returned an invalid embedding" };
  }

  return {
    ok: true,
    embedding,
    model: String(result.data?.model || FACENET512_MODEL),
    version: String(result.data?.modelVersion || result.data?.version || FACENET512_VERSION),
    quality: result.data?.quality || null,
  };
}

async function verifyFaceEmbedding(student, imageDataUrl, context = {}) {
  const referenceEmbedding = normalizeEmbedding(student?.faceEmbedding || []);
  if (!referenceEmbedding) {
    return { ok: false, error: "Student FaceNet512 face data is missing" };
  }

  const live = await createFaceEmbedding(imageDataUrl, {
    ...context,
    studentId: String(student?._id || ""),
    purpose: "attendance",
  });
  if (!live.ok) return live;

  const distance = cosineDistance(referenceEmbedding, live.embedding);
  const threshold = FACENET512_DISTANCE_THRESHOLD;

  return {
    ok: distance <= threshold,
    error: distance <= threshold ? null : "Face mismatch. Use the registered student face.",
    score: Number((1 - distance).toFixed(6)),
    distance,
    threshold,
    model: live.model,
    version: live.version,
    quality: live.quality,
  };
}

module.exports = {
  FACENET512_DISTANCE_THRESHOLD,
  FACENET512_MODEL,
  FACENET512_VERSION,
  createFaceEmbedding,
  isFaceNetEnabled,
  verifyFaceEmbedding,
};
