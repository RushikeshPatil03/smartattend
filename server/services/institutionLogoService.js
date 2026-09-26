const crypto = require("crypto");
const { getSupabaseClient } = require("../config/supabase");

const BUCKET_NAME = "institution-logos";
const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB limit
const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/**
 * Inspects binary magic bytes to determine the true image format.
 * Returns 'image/png', 'image/jpeg', 'image/webp', or null.
 *
 * @param {Buffer} buffer
 * @returns {string|null}
 */
function detectImageMimeType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
    return null;
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  // WebP: RIFF (bytes 0-3) ... WEBP (bytes 8-11)
  if (
    buffer[0] === 0x52 && // 'R'
    buffer[1] === 0x49 && // 'I'
    buffer[2] === 0x46 && // 'F'
    buffer[3] === 0x46 && // 'F'
    buffer[8] === 0x57 && // 'W'
    buffer[9] === 0x45 && // 'E'
    buffer[10] === 0x42 && // 'B'
    buffer[11] === 0x50 // 'P'
  ) {
    return "image/webp";
  }

  return null;
}

let bucketEnsured = false;

/**
 * Ensures the 'institution-logos' public bucket exists in Supabase Storage.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
async function ensureLogoBucket(supabase) {
  if (bucketEnsured || !supabase) return;
  try {
    const { data: bucket, error } = await supabase.storage.getBucket(BUCKET_NAME);
    if (!bucket || error) {
      await supabase.storage.createBucket(BUCKET_NAME, {
        public: true,
        fileSizeLimit: MAX_IMAGE_BYTES,
        allowedMimeTypes: Array.from(ALLOWED_MIME_TYPES),
      });
    }
    bucketEnsured = true;
  } catch {
    // Continue even if getBucket fails (e.g. RLS or already exists via migration)
    bucketEnsured = true;
  }
}

/**
 * Extracts the storage object path from a public Supabase Storage URL
 * strictly scoped to the given adminId.
 *
 * @param {string|null} url
 * @param {string} adminId
 * @returns {string|null}
 */
function extractStoragePath(url, adminId) {
  if (!url || typeof url !== "string" || !adminId) return null;
  const cleanAdminId = String(adminId).trim();
  if (!cleanAdminId) return null;

  const targetPrefix = `logos/${cleanAdminId}/`;
  const index = url.indexOf(targetPrefix);
  if (index === -1) return null;

  const rawPath = url.slice(index);
  const cleanPath = rawPath.split("?")[0].split("#")[0].trim();

  // Ensure path is strictly scoped under logos/<adminId>/ and contains no traversal
  if (cleanPath.startsWith(targetPrefix) && !cleanPath.includes("..")) {
    return cleanPath;
  }
  return null;
}

/**
 * Processes and securely uploads an institution logo to the 'institution-logos' bucket.
 *
 * @param {Object} params
 * @param {string} params.adminId - The authenticated admin ID
 * @param {string} params.imageDataUrl - Base64 Data URL (data:image/...)
 * @returns {Promise<{ ok: boolean, url?: string, storagePath?: string, error?: string }>}
 */
async function uploadInstitutionLogo({ adminId, imageDataUrl }) {
  if (!adminId || typeof adminId !== "string") {
    return { ok: false, error: "Authentication required" };
  }

  const cleanAdminId = adminId.trim();
  if (!cleanAdminId) {
    return { ok: false, error: "Invalid admin identity" };
  }

  if (!imageDataUrl || typeof imageDataUrl !== "string") {
    return { ok: false, error: "No image data provided" };
  }

  const raw = imageDataUrl.trim();
  const match = raw.match(/^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/i);
  if (!match) {
    return {
      ok: false,
      error: "Invalid image format. Must be a valid PNG, JPEG, or WebP image.",
    };
  }

  let declaredMime = match[1].toLowerCase();
  if (declaredMime === "image/jpg") declaredMime = "image/jpeg";

  if (!ALLOWED_MIME_TYPES.has(declaredMime)) {
    return {
      ok: false,
      error: "Unsupported image format. Only PNG, JPEG, and WebP are allowed.",
    };
  }

  let buffer;
  try {
    buffer = Buffer.from(match[3], "base64");
  } catch {
    return { ok: false, error: "Malformed base64 image data" };
  }

  if (buffer.length > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      error: `Logo file size exceeds the 2MB limit (current: ${(buffer.length / (1024 * 1024)).toFixed(2)}MB).`,
    };
  }

  const detectedMime = detectImageMimeType(buffer);
  if (!detectedMime) {
    return {
      ok: false,
      error: "Uploaded file is not a valid or readable image.",
    };
  }

  if (detectedMime !== declaredMime) {
    return {
      ok: false,
      error: `Image content type (${detectedMime}) does not match declared type (${declaredMime}).`,
    };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return { ok: false, error: "Database/Storage service unavailable" };
  }

  await ensureLogoBucket(supabase);

  const extMap = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
  };
  const ext = extMap[detectedMime] || "png";
  const uniqueToken = `${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
  const storagePath = `logos/${cleanAdminId}/${uniqueToken}.${ext}`;

  try {
    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(storagePath, buffer, {
        contentType: detectedMime,
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadError) {
      console.error("Storage upload error:", uploadError);
      return { ok: false, error: "Failed to store logo in cloud storage" };
    }

    const { data: publicUrlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(storagePath);

    if (!publicUrlData || !publicUrlData.publicUrl) {
      return { ok: false, error: "Failed to retrieve logo public URL" };
    }

    return {
      ok: true,
      url: publicUrlData.publicUrl,
      storagePath,
    };
  } catch (err) {
    console.error("uploadInstitutionLogo exception:", err);
    return { ok: false, error: "Internal error uploading logo" };
  }
}

/**
 * Removes an object from the 'institution-logos' bucket.
 * Strictly verifies the path belongs to the given adminId to prevent unauthorized deletions.
 *
 * @param {string} storagePath
 * @param {string} adminId
 */
async function deleteInstitutionLogo(storagePath, adminId) {
  if (!storagePath || !adminId) return false;
  const cleanAdminId = String(adminId).trim();
  const cleanPath = String(storagePath).trim();

  // Security guard: Ensure path is strictly inside logos/<adminId>/
  if (!cleanPath.startsWith(`logos/${cleanAdminId}/`) || cleanPath.includes("..")) {
    console.warn("Attempted to delete storage path outside admin scope:", cleanPath);
    return false;
  }

  const supabase = getSupabaseClient();
  if (!supabase) return false;

  try {
    const { error } = await supabase.storage.from(BUCKET_NAME).remove([cleanPath]);
    if (error) {
      console.warn("Failed to delete storage object:", cleanPath, error?.message || error);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("deleteInstitutionLogo exception:", err?.message || err);
    return false;
  }
}

module.exports = {
  BUCKET_NAME,
  MAX_IMAGE_BYTES,
  detectImageMimeType,
  ensureLogoBucket,
  extractStoragePath,
  uploadInstitutionLogo,
  deleteInstitutionLogo,
};
