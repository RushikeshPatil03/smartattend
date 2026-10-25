// src/services/attendanceClient.ts
import apiClient from "./apiClient";
import logger from "../utils/logger";

let markInFlightKey: string | null = null;
let markInFlightPromise: Promise<any> | null = null;

const DB_NAME = "smartattend_secure";
const DB_VERSION = 1;
const STORE_NAME = "device_identity";
const DEVICE_ID_KEY = "deviceId";
const LOCAL_CACHE_KEY = "sa_device_v1"; // localStorage fallback cache

/**
 * Open (or create) the IndexedDB database for device identity.
 * IndexedDB is more durable than localStorage and respects navigator.storage.persist().
 */
function openDeviceDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      return reject(new Error("IndexedDB not available"));
    }
    const timer = setTimeout(() => reject(new Error("IndexedDB open timeout")), 600);
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = (e) => {
        clearTimeout(timer);
        resolve((e.target as IDBOpenDBRequest).result);
      };
      req.onerror = () => {
        clearTimeout(timer);
        reject(req.error);
      };
      req.onblocked = () => {
        clearTimeout(timer);
        reject(new Error("IndexedDB blocked"));
      };
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });
}

function idbGet(db: IDBDatabase, key: string): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("IndexedDB get timeout")), 500);
    try {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => {
        clearTimeout(timer);
        resolve(req.result as string | undefined);
      };
      req.onerror = () => {
        clearTimeout(timer);
        reject(req.error);
      };
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });
}

function idbSet(db: IDBDatabase, key: string, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("IndexedDB set timeout")), 500);
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const req = tx.objectStore(STORE_NAME).put(value, key);
      req.onsuccess = () => {
        clearTimeout(timer);
        resolve();
      };
      req.onerror = () => {
        clearTimeout(timer);
        reject(req.error);
      };
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });
}

function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Get or create a stable device UUID.
 *
 * Storage priority (most durable → least durable):
 *   1. IndexedDB (protected by navigator.storage.persist() + PWA install)
 *   2. localStorage (fallback — may be evicted, but used as a cross-check)
 *
 * The UUID is a random identifier — zero hardware signals, zero PII.
 * Privacy-safe: equivalent to a session cookie but stored locally.
 */
async function getOrCreateDeviceId(): Promise<string> {
  try {
    const db = await openDeviceDB();

    // 1. Try IndexedDB first (most durable)
    let deviceId = await idbGet(db, DEVICE_ID_KEY);

    if (!deviceId) {
      // 2. Try localStorage as recovery (in case IndexedDB was cleared but localStorage wasn't)
      const cached =
        localStorage.getItem(LOCAL_CACHE_KEY) ||
        localStorage.getItem("deviceFingerprintV2") ||
        localStorage.getItem("deviceFingerprint");
      if (cached && cached.length > 10) {
        deviceId = cached;
        // Restore into IndexedDB
        await idbSet(db, DEVICE_ID_KEY, deviceId);
      }
    }

    if (!deviceId) {
      // 3. First time on this device — generate new UUID
      deviceId = `sa_${generateUUID()}`;
      await idbSet(db, DEVICE_ID_KEY, deviceId);
      try { localStorage.setItem(LOCAL_CACHE_KEY, deviceId); } catch { /* quota */ }
    } else {
      // Keep localStorage in sync with IndexedDB
      try { localStorage.setItem(LOCAL_CACHE_KEY, deviceId); } catch { /* quota */ }
    }

    return deviceId;
  } catch {
    // IndexedDB unavailable (very old browser or private mode on some browsers)
    // Fall back to localStorage UUID only
    try {
      const cached =
        localStorage.getItem(LOCAL_CACHE_KEY) ||
        localStorage.getItem("deviceFingerprintV2") ||
        localStorage.getItem("deviceFingerprint");
      if (cached && cached.length > 10) return cached;
      const newId = `sa_${generateUUID()}`;
      localStorage.setItem(LOCAL_CACHE_KEY, newId);
      return newId;
    } catch {
      // Everything blocked (ultra-strict private mode) — return a session-only ID
      return `sa_session_${generateUUID()}`;
    }
  }
}

// In-memory cache so repeated synchronous calls don't re-open IndexedDB
let _deviceIdCache: string | null = null;
let _deviceIdPromise: Promise<string> | null = null;

/**
 * Synchronous version — returns cached value if already resolved,
 * otherwise returns the localStorage fallback.
 * Always call initDeviceFingerprint() on app startup first.
 */
export function getFingerprint(): string {
  if (_deviceIdCache) return _deviceIdCache;
  // Synchronous fallback while async resolution is in flight
  try {
    const cached =
      localStorage.getItem(LOCAL_CACHE_KEY) ||
      localStorage.getItem("deviceFingerprintV2") ||
      localStorage.getItem("deviceFingerprint");
    if (cached && cached.length > 10) return cached;
  } catch { /* blocked */ }
  return "sa_pending";
}

/**
 * Initialize the device fingerprint at app startup.
 * Must be called once (e.g., in main.tsx or App.tsx) before any login.
 * Resolves the IndexedDB value and caches it in memory for synchronous access.
 */
export async function initDeviceFingerprint(): Promise<string> {
  if (_deviceIdCache) return _deviceIdCache;
  if (_deviceIdPromise) return _deviceIdPromise;

  const idPromise = getOrCreateDeviceId()
    .then((id) => {
      _deviceIdCache = id;
      return id;
    })
    .catch(() => {
      const fallback = getFingerprint();
      _deviceIdCache = fallback;
      return fallback;
    });

  // Guarantee resolution within 800ms max — NEVER hang caller!
  _deviceIdPromise = Promise.race([
    idPromise,
    new Promise<string>((resolve) =>
      setTimeout(() => {
        const fallback = getFingerprint();
        _deviceIdCache = fallback;
        resolve(fallback);
      }, 800)
    ),
  ]);

  return _deviceIdPromise;
}

/**
 * Request persistent storage from the browser.
 * Protects IndexedDB and localStorage from automatic OS eviction.
 * On installed PWAs (Android home screen), this is always granted automatically.
 * Call this on every successful login.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator?.storage?.persist) {
      return await navigator.storage.persist();
    }
  } catch { /* not supported */ }
  return false;
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
  faceGrantToken?: string | null,
  secondQrScannedAtMs?: number | null,
  /** ms between QR-2 generation (ts in payload) and student scan — used for timing anomaly detection */
  qr2GenToScanMs?: number | null
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

    if (secondQrScannedAtMs != null && !isNaN(Number(secondQrScannedAtMs))) {
      payload.secondQrScannedAtMs = Number(secondQrScannedAtMs);
    }

    // Generation-to-scan delay: time from QR-2 display on projector → student decode
    // This is device/network-independent and directly measures physical scanning speed.
    if (qr2GenToScanMs != null && !isNaN(Number(qr2GenToScanMs)) && Number(qr2GenToScanMs) > 0) {
      payload.qr2GenToScanMs = Number(qr2GenToScanMs);
    }

    if (scanGrant) {
      payload.scanGrantToken = String(scanGrant);
      payload.scanGrant = String(scanGrant);
    }

    if (lat != null && lng != null) {
      payload.lat = lat;
      payload.lng = lng;
    }
    if (accuracy != null) {
      payload.accuracy = accuracy;
    }
    if (faceGrantToken) {
      payload.faceGrantToken = String(faceGrantToken);
    }
    if (faceVerification) {
      payload.faceVerification = faceVerification;
    }

    const dedupeKey = JSON.stringify(payload);
    if (markInFlightPromise && markInFlightKey === dedupeKey) {
      return await markInFlightPromise;
    }

    markInFlightKey = dedupeKey;

    // Resilient client-side retry with randomized exponential jitter
    // Max 4 attempts: Initial immediate attempt, then 3 retries on transient errors
    const executeWithRetry = async () => {
      const maxAttempts = 4;
      const jitterDelays = [
        0, // Attempt 1: immediate
        300 + Math.floor(Math.random() * 150),  // Attempt 2: 300-450ms
        800 + Math.floor(Math.random() * 250),  // Attempt 3: 800-1050ms
        1800 + Math.floor(Math.random() * 400), // Attempt 4: 1800-2200ms
      ];

      let lastErrorResult: any = null;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (attempt > 0) {
          await new Promise((resolve) => setTimeout(resolve, jitterDelays[attempt]));
        }

        try {
          const res: any = await apiClient.post("/api/attendance/mark", payload);

          // Success or already marked
          if (res?.ok === true || res?.alreadyMarked === true || res?.already === true) {
            return res;
          }

          const status = Number(res?.status || 0);
          const errorMsg = String(res?.error || "").toLowerCase();

          // Deterministic business/client errors: DO NOT RETRY
          // (HTTP 400, 401, 403, 404, or known invalid credentials/mismatch codes)
          const isDeterministicClientError =
            (status >= 400 && status < 500 && status !== 429) ||
            res?.code === "DEVICE_MISMATCH" ||
            res?.code === "LOCATION_MISMATCH" ||
            res?.code === "FACE_MISMATCH" ||
            res?.code === "ELIGIBILITY_MISMATCH" ||
            res?.code === "INVALID_QR_TOKEN" ||
            res?.code === "INVALID_SCAN_GRANT" ||
            res?.code === "INVALID_FACE_GRANT" ||
            res?.code === "SESSION_EXPIRED" ||
            errorMsg.includes("device mismatch") ||
            errorMsg.includes("face mismatch") ||
            errorMsg.includes("location mismatch") ||
            errorMsg.includes("not enrolled") ||
            errorMsg.includes("session is no longer active");

          if (isDeterministicClientError) {
            return res;
          }

          // Transient server error (500, 502, 503, 504, 429, or network error response)
          lastErrorResult = res;
        } catch (callErr: any) {
          lastErrorResult = {
            ok: false,
            error: callErr?.message || "Network error",
          };
        }
      }

      return lastErrorResult || {
        ok: false,
        error: "Network connection unstable. Please hold your device steady and retry.",
      };
    };

    markInFlightPromise = executeWithRetry();
    const result = await markInFlightPromise;
    return result;
  } catch (err: any) {
    logger.error("markAttendanceTwoStep error", err);
    return {
      ok: false,
      error: "Network connection unstable. Please hold your device steady and retry.",
    };
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
    logger.error("fetchAttendance error", err);
    return { ok: false, error: err?.message || "Network error" };
  }
}

export default {
  getFingerprint,
  initDeviceFingerprint,
  requestPersistentStorage,
  markAttendance,
  markAttendanceTwoStep,
  fetchAttendance,
};
