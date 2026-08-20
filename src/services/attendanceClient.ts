// src/services/attendanceClient.ts
import apiClient from "./apiClient";

let markInFlightKey: string | null = null;
let markInFlightPromise: Promise<any> | null = null;

/**
 * Generate or retrieve a stable device fingerprint.
 * Stored once in localStorage and reused. Existing browser-derived values are
 * preserved so already-bound accounts keep working, while new installs get a
 * random stable ID that will not drift when browser/device attributes change.
 */
export function getFingerprint(): string {
  try {
    const cacheKey = "deviceFingerprintV2";
    const legacyKey = "deviceFingerprint";

    const cached = localStorage.getItem(cacheKey);
    if (cached) return cached;

    const legacy = localStorage.getItem(legacyKey);
    if (legacy) {
      localStorage.setItem(cacheKey, legacy);
      return legacy;
    }

    const randomId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    const fp = `device_${randomId}`;

    localStorage.setItem(cacheKey, fp);
    localStorage.setItem(legacyKey, fp);
    return fp;
  } catch {
    return "unknown-device";
  }
}

/**
 * Legacy browser fingerprint generator retained only as a recovery helper for
 * old clients that already registered with attribute-based fingerprints.
 */
export function getLegacyBrowserFingerprint(): string {
  try {
    const parts = [
      navigator.userAgent || "",
      navigator.language || "",
      (navigator as any).platform || "",
      Intl?.DateTimeFormat?.().resolvedOptions()?.timeZone || "",
      String(screen?.width ?? ""),
      String(screen?.height ?? ""),
      String(screen?.colorDepth ?? ""),
      String(window.devicePixelRatio ?? ""),
      String(navigator.hardwareConcurrency ?? ""),
      String((navigator as any).deviceMemory ?? ""),
    ];

    const raw = parts.join("|");
    return btoa(unescape(encodeURIComponent(raw)));
  } catch {
    return "unknown-device";
  }
}

/**
 * Normalize fingerprint before sending to backend
 */
export function normalizeClientFingerprint(fp?: string): string {
  if (!fp) return "";
  return String(fp).trim();
}

/**
 * SECURE TWO-STEP QR (NEW CORE)
 */
export async function markAttendanceTwoStep(
  firstQrToken: string,
  secondQrToken: string,
  fingerprint: string,
  lat?: number | null,
  lng?: number | null,
  scanGrant?: string | null,
  accuracy?: number | null,
  faceVerification?: Record<string, any> | null,
  webauthnAssertion?: any,
  webauthnChallengeKey?: string
) {
  try {
    const first = String(firstQrToken || "").trim();
    const second = String(secondQrToken || "").trim();
    if (!first || !second) {
      return { ok: false, error: "Two consecutive QR tokens required" };
    }

    const payload: any = {
      firstQrToken: first,
      secondQrToken: second,
      fingerprint: normalizeClientFingerprint(fingerprint),
    };

    if (scanGrant) {
      payload.scanGrantToken = String(scanGrant);
      payload.scanGrant = String(scanGrant);
    }

    if (webauthnAssertion) {
      payload.webauthnAssertion = webauthnAssertion;
    }
    if (webauthnChallengeKey) {
      payload.webauthnChallengeKey = webauthnChallengeKey;
    }

    if (lat != null && lng != null) {
      payload.lat = lat;
      payload.lng = lng;
    }
    if (accuracy != null) {
      payload.accuracy = accuracy;
    }
    if (faceVerification) {
      payload.faceVerification = faceVerification;
    }

    const dedupeKey = JSON.stringify(payload);
    if (markInFlightPromise && markInFlightKey === dedupeKey) {
      return await markInFlightPromise;
    }

    markInFlightKey = dedupeKey;
    markInFlightPromise = apiClient.post("/api/attendance/mark", payload);

    const result = await markInFlightPromise;
    return result;
  } catch (err: any) {
    console.error("markAttendanceTwoStep error", err);
    return { ok: false, error: err?.message || "Network error" };
  } finally {
    markInFlightKey = null;
    markInFlightPromise = null;
  }
}

/**
 * BACKWARD COMPATIBILITY LAYER
 *
 * This keeps existing UI working WITHOUT CHANGES.
 * If UI only passes one QR, we treat it as both steps.
 *
 * IMPORTANT:
 * Real dashboard scanning uses two-step properly. Other legacy components will
 * not crash if they still call this wrapper.
 */
export async function markAttendance(
  qrToken: string,
  fingerprint: string,
  lat?: number | null,
  lng?: number | null,
  scanGrant?: string | null,
  accuracy?: number | null
) {
  // Fallback: use same token for both (will usually FAIL backend
  // unless QR rotated, but prevents runtime crash)
  return markAttendanceTwoStep(
    qrToken,
    qrToken,
    fingerprint,
    lat,
    lng,
    scanGrant,
    accuracy,
    null
  );
}

/**
 * Fetch attendance records (faculty/admin)
 */
export async function fetchAttendance(filters: Record<string, any> = {}) {
  try {
    const qs = new URLSearchParams(filters).toString();
    return await apiClient.get(`/api/attendance?${qs}`);
  } catch (err: any) {
    console.error("fetchAttendance error", err);
    return { ok: false, error: err?.message || "Network error" };
  }
}

export default {
  getFingerprint,
  getLegacyBrowserFingerprint,
  markAttendance,
  markAttendanceTwoStep,
  fetchAttendance,
};
