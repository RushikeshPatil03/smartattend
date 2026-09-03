// src/services/attendanceClient.ts
import apiClient from "./apiClient";

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
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(db: IDBDatabase, key: string): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result as string | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbSet(db: IDBDatabase, key: string, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
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

  _deviceIdPromise = getOrCreateDeviceId().then((id) => {
    _deviceIdCache = id;
    return id;
  });

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
  faceVerification?: Record<string, any> | null
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
  initDeviceFingerprint,
  requestPersistentStorage,
  getLegacyBrowserFingerprint,
  markAttendance,
  markAttendanceTwoStep,
  fetchAttendance,
};
