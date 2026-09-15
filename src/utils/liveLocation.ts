export type LiveLocation = {
  lat: number;
  lng: number;
  accuracy: number;
};

export type CachedLiveLocation = LiveLocation & {
  capturedAt: number;
};

type LiveLocationOptions = {
  preferCached?: boolean;
  maxAgeMs?: number;
  timeoutMs?: number;
  maxAccuracyMeters?: number;
};

export const MAX_ACCEPTABLE_ACCURACY_METERS = 30; // Strict < 30m accuracy threshold for geo-fence security
export const ATTENDANCE_GPS_MAX_AGE_MS = 10_000; // 10 seconds fresh cache window
export const DISPLAY_GPS_MAX_AGE_MS = 60_000; // 1 minute window for initial dashboard display / pre-warming
export const ROLLING_CACHE_MAX_AGE_MS = ATTENDANCE_GPS_MAX_AGE_MS;
const GPS_FALLBACK_TIMEOUT_MS = 4000; // 4-second timeout fallback for getCurrentPosition

// In-memory rolling GPS cache
let lastResolvedLocation: CachedLiveLocation | null = null;
let bestRecentLocation: CachedLiveLocation | null = null;
let activeWatchId: number | null = null;
let watcherRefCount = 0;
const activeListeners = new Set<(location: LiveLocation) => void>();
let inFlightLocationPromise: Promise<LiveLocation> | null = null;

function isInsecureMobileContext() {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  const isLocalHost = host === "localhost" || host === "127.0.0.1";
  return !window.isSecureContext && !isLocalHost;
}

function locationErrorMessage(err?: GeolocationPositionError, deniedByPermissionApi = false) {
  if (isInsecureMobileContext()) {
    return "Location on mobile requires HTTPS. Open this app over https:// and allow location.";
  }

  if (deniedByPermissionApi) {
    return "Location permission denied. Allow location access in browser settings.";
  }

  if (!err) return "Unable to fetch location. Please enable GPS/location services.";
  if (err.code === 1) return "Location permission denied. Allow location access in browser settings.";
  if (err.code === 2) return "Location unavailable. Turn on GPS and try again.";
  if (err.code === 3) return "Location request timed out. Move to better signal and try again.";
  return "Unable to fetch location. Please enable GPS/location services.";
}

function precisionError(accuracy?: number) {
  return `Precise GPS required (< ${MAX_ACCEPTABLE_ACCURACY_METERS}m). Current accuracy is ~${Math.round(
    Number(accuracy || 0)
  )}m. Move outdoors or near a window for better satellite fix.`;
}

async function getPermissionState(): Promise<PermissionState | null> {
  try {
    if (!navigator.permissions?.query) return null;
    const status = await navigator.permissions.query({
      name: "geolocation" as PermissionName,
    });
    return status.state;
  } catch {
    return null;
  }
}

/**
 * Handle incoming GPS position and update rolling cache
 */
function handleIncomingPosition(pos: GeolocationPosition) {
  const accuracy = Number(pos.coords.accuracy || 0);
  if (!Number.isFinite(accuracy) || accuracy <= 0) return;

  const now = Date.now();
  const location: LiveLocation = {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy,
  };

  const cached: CachedLiveLocation = {
    ...location,
    capturedAt: now,
  };

  lastResolvedLocation = cached;

  if (
    !bestRecentLocation ||
    now - bestRecentLocation.capturedAt > DISPLAY_GPS_MAX_AGE_MS ||
    accuracy <= bestRecentLocation.accuracy
  ) {
    bestRecentLocation = cached;
  }

  // Notify all active listeners
  activeListeners.forEach((listener) => {
    try {
      listener(location);
    } catch {
      // Ignore listener error
    }
  });
}

/**
 * Start the continuous background rolling GPS watcher with watchPosition
 * Uses enableHighAccuracy: true and maximumAge: 10000 (10s cache)
 * Keeps rolling cache hot with 0ms latency on student submission
 */
export function startRollingGpsWatcher(
  onUpdate?: (location: LiveLocation) => void,
  maxAgeMs: number = ATTENDANCE_GPS_MAX_AGE_MS
): () => void {
  if (typeof window === "undefined" || !navigator.geolocation) {
    return () => {};
  }

  if (onUpdate) {
    activeListeners.add(onUpdate);
    // If we already have a warm cache (< maxAgeMs) with good accuracy, trigger callback immediately
    if (
      lastResolvedLocation &&
      Date.now() - lastResolvedLocation.capturedAt <= maxAgeMs &&
      lastResolvedLocation.accuracy <= MAX_ACCEPTABLE_ACCURACY_METERS
    ) {
      try {
        onUpdate({
          lat: lastResolvedLocation.lat,
          lng: lastResolvedLocation.lng,
          accuracy: lastResolvedLocation.accuracy,
        });
      } catch {}
    }
  }

  watcherRefCount += 1;

  if (activeWatchId === null) {
    try {
      activeWatchId = navigator.geolocation.watchPosition(
        (pos) => {
          handleIncomingPosition(pos);
        },
        (err) => {
          if (err.code === 1) stopInternalWatcher();
        },
        {
          enableHighAccuracy: true,
          maximumAge: 10000,
          timeout: 10000,
        }
      );
    } catch (err) {
      console.warn("Failed to start GPS watchPosition:", err);
    }
  }

  return () => {
    if (onUpdate) {
      activeListeners.delete(onUpdate);
    }
    watcherRefCount = Math.max(0, watcherRefCount - 1);
    if (watcherRefCount === 0) {
      stopInternalWatcher();
    }
  };
}

function stopInternalWatcher() {
  if (activeWatchId !== null && typeof navigator !== "undefined" && navigator.geolocation) {
    try {
      navigator.geolocation.clearWatch(activeWatchId);
    } catch {}
    activeWatchId = null;
  }
}

/**
 * Synchronous 0ms getter for rolling cached location
 * Defaults to 10-second attendance submission window and < 30m accuracy
 */
export function getInstantCachedLocation(
  maxAgeMs: number = ATTENDANCE_GPS_MAX_AGE_MS,
  maxAccuracy: number = MAX_ACCEPTABLE_ACCURACY_METERS
): LiveLocation | null {
  const now = Date.now();

  // 1. Check best recent fix in rolling window
  if (
    bestRecentLocation &&
    now - bestRecentLocation.capturedAt <= maxAgeMs &&
    bestRecentLocation.accuracy <= maxAccuracy
  ) {
    return {
      lat: bestRecentLocation.lat,
      lng: bestRecentLocation.lng,
      accuracy: bestRecentLocation.accuracy,
    };
  }

  // 2. Check latest resolved fix
  if (
    lastResolvedLocation &&
    now - lastResolvedLocation.capturedAt <= maxAgeMs &&
    lastResolvedLocation.accuracy <= maxAccuracy
  ) {
    return {
      lat: lastResolvedLocation.lat,
      lng: lastResolvedLocation.lng,
      accuracy: lastResolvedLocation.accuracy,
    };
  }

  return null;
}

export async function getLiveLocation(): Promise<LiveLocation> {
  return getLiveLocationWithOptions({ preferCached: true });
}

/**
 * Primary location resolver
 * 1. Checks 10s rolling cache first for INSTANT 0ms resolution.
 * 2. If cache is pending or cold, concurrently runs watchPosition listener and
 *    getCurrentPosition with a 4-second timeout.
 */
export async function getLiveLocationWithOptions(
  options: LiveLocationOptions = {}
): Promise<LiveLocation> {
  const maxAgeMs =
    typeof options.maxAgeMs === "number" && options.maxAgeMs > 0
      ? options.maxAgeMs
      : ATTENDANCE_GPS_MAX_AGE_MS;

  const maxAccuracy =
    typeof options.maxAccuracyMeters === "number" && options.maxAccuracyMeters > 0
      ? options.maxAccuracyMeters
      : MAX_ACCEPTABLE_ACCURACY_METERS;

  const timeoutMs =
    typeof options.timeoutMs === "number" && options.timeoutMs > 0
      ? options.timeoutMs
      : GPS_FALLBACK_TIMEOUT_MS;

  // 1. Instant 0ms Fast Path: Check rolling cache
  const cached = getInstantCachedLocation(maxAgeMs, maxAccuracy);
  if (cached) {
    return cached;
  }

  // 2. In-flight promise path: deduplicate concurrent requests
  if (inFlightLocationPromise) {
    return inFlightLocationPromise;
  }

  if (isInsecureMobileContext()) {
    throw new Error(locationErrorMessage());
  }

  if (!navigator.geolocation) {
    throw new Error("Geolocation is not supported in this browser.");
  }

  const permission = await getPermissionState();
  if (permission === "denied") {
    throw new Error(locationErrorMessage(undefined, true));
  }

  // Ensure rolling watcher is running with high accuracy & 10s cache
  startRollingGpsWatcher(undefined, maxAgeMs);

  inFlightLocationPromise = new Promise<LiveLocation>((resolve, reject) => {
    let done = false;
    let fallbackTimer: number | null = null;
    let unsubscribeListener: (() => void) | null = null;

    const cleanup = () => {
      if (fallbackTimer != null) window.clearTimeout(fallbackTimer);
      if (unsubscribeListener) unsubscribeListener();
      fallbackTimer = null;
      unsubscribeListener = null;
    };

    const onLocationArrived = (loc: LiveLocation) => {
      if (done) return;
      if (loc.accuracy <= maxAccuracy) {
        done = true;
        cleanup();
        resolve(loc);
      }
    };

    activeListeners.add(onLocationArrived);
    unsubscribeListener = () => activeListeners.delete(onLocationArrived);

    // Fallback: trigger single getCurrentPosition with 4-second timeout
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          handleIncomingPosition(pos);
          if (done) return;
          const acc = Number(pos.coords.accuracy || 0);
          if (acc > 0 && acc <= maxAccuracy) {
            done = true;
            cleanup();
            resolve({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy: acc,
            });
          }
        },
        (err) => {
          if (done) return;
          if (err.code === 1) {
            done = true;
            cleanup();
            reject(new Error(locationErrorMessage(err)));
          }
        },
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 10000 }
      );
    } catch {}

    fallbackTimer = window.setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();

      const lastCached =
        getInstantCachedLocation(maxAgeMs, maxAccuracy) ||
        getInstantCachedLocation(DISPLAY_GPS_MAX_AGE_MS, maxAccuracy);

      if (lastCached) {
        resolve(lastCached);
      } else if (
        lastResolvedLocation &&
        lastResolvedLocation.accuracy <= maxAccuracy
      ) {
        resolve({
          lat: lastResolvedLocation.lat,
          lng: lastResolvedLocation.lng,
          accuracy: lastResolvedLocation.accuracy,
        });
      } else if (lastResolvedLocation) {
        reject(new Error(precisionError(lastResolvedLocation.accuracy)));
      } else {
        reject(
          new Error(
            "GPS location acquisition timed out (4s). Please move near a window or check location settings."
          )
        );
      }
    }, timeoutMs);
  });

  try {
    return await inFlightLocationPromise;
  } finally {
    inFlightLocationPromise = null;
  }
}

/**
 * Prewarms the GPS engine ahead of scan (accepts up to 1-minute display cache)
 */
export async function prewarmLiveLocation(
  options: LiveLocationOptions = {}
): Promise<LiveLocation | null> {
  try {
    startRollingGpsWatcher(undefined, DISPLAY_GPS_MAX_AGE_MS);
    return await getLiveLocationWithOptions({
      preferCached: true,
      maxAgeMs: DISPLAY_GPS_MAX_AGE_MS,
      timeoutMs: 4000,
      ...options,
    });
  } catch {
    return null;
  }
}
