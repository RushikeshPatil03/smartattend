export type LiveLocation = {
  lat: number;
  lng: number;
  accuracy: number;
};

type LiveLocationOptions = {
  preferCached?: boolean;
  maxAgeMs?: number;
};

const MAX_ACCEPTABLE_ACCURACY_METERS = 120;
const LOCATION_WARMUP_WINDOW_MS = 30000;
const DEFAULT_CACHE_MAX_AGE_MS = 15000;

let lastResolvedLocation: (LiveLocation & { capturedAt: number }) | null = null;
let inFlightLocationPromise: Promise<LiveLocation> | null = null;

function isInsecureMobileContext() {
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
  return `Precise GPS required. Current accuracy is ~${Math.round(
    Number(accuracy || 0)
  )}m. Move outdoors and enable high-accuracy location.`;
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

export async function getLiveLocation(): Promise<LiveLocation> {
  return getLiveLocationWithOptions();
}

export async function getLiveLocationWithOptions(
  options: LiveLocationOptions = {}
): Promise<LiveLocation> {
  const preferCached = Boolean(options.preferCached);
  const maxAgeMs =
    typeof options.maxAgeMs === "number" && options.maxAgeMs > 0
      ? options.maxAgeMs
      : DEFAULT_CACHE_MAX_AGE_MS;

  if (
    preferCached &&
    lastResolvedLocation &&
    Date.now() - lastResolvedLocation.capturedAt <= maxAgeMs
  ) {
    return {
      lat: lastResolvedLocation.lat,
      lng: lastResolvedLocation.lng,
      accuracy: lastResolvedLocation.accuracy,
    };
  }

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

  inFlightLocationPromise = new Promise<LiveLocation>((resolve, reject) => {
    let done = false;
    let bestPos: GeolocationPosition | null = null;
    let lastErr: GeolocationPositionError | undefined;
    let watchId: number | null = null;
    let warmupTimer: number | null = null;

    const cleanup = () => {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      if (warmupTimer != null) window.clearTimeout(warmupTimer);
      watchId = null;
      warmupTimer = null;
    };

    const finishError = () => {
      cleanup();
      if (bestPos) {
        reject(new Error(precisionError(bestPos.coords.accuracy)));
      } else {
        reject(new Error(locationErrorMessage(lastErr)));
      }
    };

    const consumePosition = (pos: GeolocationPosition) => {
      if (done) return;
      const accuracy = Number(pos.coords.accuracy || 0);
      if (!Number.isFinite(accuracy) || accuracy <= 0) return;

      if (!bestPos || accuracy < Number(bestPos.coords.accuracy || Number.MAX_SAFE_INTEGER)) {
        bestPos = pos;
      }

      if (accuracy <= MAX_ACCEPTABLE_ACCURACY_METERS) {
        done = true;
        cleanup();
        const location = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy,
        };
        lastResolvedLocation = {
          ...location,
          capturedAt: Date.now(),
        };
        resolve(location);
      }
    };

    const onError = (err: GeolocationPositionError) => {
      if (done) return;
      lastErr = err;
      if (err.code === 1) {
        done = true;
        cleanup();
        reject(new Error(locationErrorMessage(err)));
      }
    };

    warmupTimer = window.setTimeout(() => {
      if (done) return;
      done = true;
      finishError();
    }, LOCATION_WARMUP_WINDOW_MS);

    watchId = navigator.geolocation.watchPosition(
      consumePosition,
      onError,
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  });

  try {
    return await inFlightLocationPromise;
  } finally {
    inFlightLocationPromise = null;
  }
}

export async function prewarmLiveLocation(
  options: LiveLocationOptions = {}
): Promise<LiveLocation | null> {
  try {
    return await getLiveLocationWithOptions({
      preferCached: true,
      ...options,
    });
  } catch {
    return null;
  }
}
