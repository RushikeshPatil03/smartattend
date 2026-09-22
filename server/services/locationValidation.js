const EARTH_RADIUS_M = 6371000;

// Maximum acceptable GPS accuracy in meters for attendance marking (Strict < 30m)
const MAX_STUDENT_GPS_ACCURACY_METERS = Number(
  process.env.MAX_STUDENT_GPS_ACCURACY_METERS || 30
);

// Base tolerance margin added to classroom radius (meters)
const LOCATION_BASE_TOLERANCE_METERS = Number(
  process.env.LOCATION_BASE_TOLERANCE_METERS || 20
);

// Maximum allowance granted for sub-30m GPS jitter (meters)
const LOCATION_MAX_ACCURACY_MARGIN_METERS = Number(
  process.env.LOCATION_MAX_ACCURACY_MARGIN_METERS || 10
);

// In-memory LRU/TTL Cache for faculty classroom anchor coordinates (Sub-0.1ms lookup)
const ANCHOR_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes TTL
const MAX_CACHE_ENTRIES = 500;
const anchorLocationCache = new Map();

/**
 * Cache faculty classroom anchor coordinates in memory
 */
function cacheSessionAnchorLocation(sessionId, location, ttlMs = ANCHOR_CACHE_TTL_MS) {
  if (!sessionId || !location) return;
  const sid = String(sessionId);

  // Evict oldest if capacity exceeded
  if (anchorLocationCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = anchorLocationCache.keys().next().value;
    if (oldestKey) anchorLocationCache.delete(oldestKey);
  }

  const lat = Number(location.lat ?? location.latitude);
  const lng = Number(location.lng ?? location.longitude);
  const radiusMeters = Math.max(10, Number(location.radiusMeters || location.radius || 50));

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    anchorLocationCache.set(sid, {
      lat,
      lng,
      radiusMeters,
      cachedAt: Date.now(),
      expiresAt: Date.now() + ttlMs,
    });
  }
}

/**
 * Retrieve cached classroom anchor coordinates
 */
function getCachedSessionAnchorLocation(sessionId) {
  if (!sessionId) return null;
  const sid = String(sessionId);
  const entry = anchorLocationCache.get(sid);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    anchorLocationCache.delete(sid);
    return null;
  }

  return entry;
}

/**
 * Invalidate cached anchor coordinates
 */
function invalidateSessionAnchorLocation(sessionId) {
  if (!sessionId) return;
  anchorLocationCache.delete(String(sessionId));
}

function toRad(n) {
  return (n * Math.PI) / 180;
}

/**
 * Fast Haversine formula calculation (< 0.05ms)
 */
function distanceMeters(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const lat1Rad = toRad(lat1);
  const lat2Rad = toRad(lat2);

  const sinDLat2 = Math.sin(dLat / 2);
  const sinDLng2 = Math.sin(dLng / 2);

  const a =
    sinDLat2 * sinDLat2 +
    Math.cos(lat1Rad) * Math.cos(lat2Rad) * sinDLng2 * sinDLng2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

/**
 * Validate coordinates and check within boundary with accuracy verification
 */
function validateLocationInRadius(
  sessionLocation,
  lat,
  lng,
  accuracyMeters = null
) {
  if (
    !sessionLocation ||
    sessionLocation.lat == null ||
    sessionLocation.lng == null
  ) {
    return { ok: true, code: "LOCATION_NOT_ENFORCED", distanceMeters: null };
  }

  const sessLat = Number(sessionLocation.lat);
  const sessLng = Number(sessionLocation.lng);
  if (!Number.isFinite(sessLat) || !Number.isFinite(sessLng)) {
    return { ok: true, code: "LOCATION_NOT_ENFORCED", distanceMeters: null };
  }

  const numLat = Number(lat);
  const numLng = Number(lng);
  if (!Number.isFinite(numLat) || !Number.isFinite(numLng)) {
    return {
      ok: false,
      code: "INVALID_COORDINATES",
      error: "Valid numeric GPS coordinates required.",
    };
  }

  // 1. Strict GPS Accuracy Verification (< 30m)
  const accuracy = Number(accuracyMeters);
  if (Number.isFinite(accuracy) && accuracy > MAX_STUDENT_GPS_ACCURACY_METERS) {
    const accRound = Math.round(accuracy);
    return {
      ok: false,
      code: "POOR_GPS_ACCURACY",
      error: `Poor GPS accuracy (~${accRound}m). A precision of under ${MAX_STUDENT_GPS_ACCURACY_METERS}m is required to mark attendance. Move outdoors or near a window.`,
      accuracy: accRound,
      requiredAccuracy: MAX_STUDENT_GPS_ACCURACY_METERS,
    };
  }

  // 2. Ultra-fast Haversine distance computation (< 0.05ms)
  const dist = distanceMeters(numLat, numLng, sessLat, sessLng);
  const radius = Math.max(10, Number(sessionLocation.radiusMeters || sessionLocation.radius || 50));
  const gpsMargin =
    Number.isFinite(accuracy) && accuracy > 0
      ? Math.min(accuracy, LOCATION_MAX_ACCURACY_MARGIN_METERS)
      : 0;
  const effectiveRadius = radius + LOCATION_BASE_TOLERANCE_METERS + gpsMargin;

  // 3. Geo-fence Boundary Check
  if (dist > effectiveRadius) {
    const away = Math.round(dist);
    const limit = Math.round(effectiveRadius);
    return {
      ok: false,
      code: "OUT_OF_RANGE",
      error: `Outside allowed classroom boundary. You are ${away}m away (limit is ${limit}m). Please step inside the classroom.`,
      distanceMeters: Math.round(dist * 10) / 10,
      allowedMeters: Math.round(effectiveRadius * 10) / 10,
      accuracy: Number.isFinite(accuracy) ? Math.round(accuracy) : null,
    };
  }

  return {
    ok: true,
    code: "VERIFIED",
    distanceMeters: Math.round(dist * 10) / 10,
    allowedMeters: Math.round(effectiveRadius * 10) / 10,
    accuracy: Number.isFinite(accuracy) ? Math.round(accuracy) : null,
  };
}

/**
 * Primary student location validation entry point
 */
function validateStudentLocation(studentLocation, sessionLocation, sessionId = null) {
  // Check in-memory cached anchor coordinates if sessionLocation object is not full or if sessionId provided
  let anchor = sessionLocation;
  if (sessionId) {
    if (sessionLocation && sessionLocation.lat != null && sessionLocation.lng != null) {
      cacheSessionAnchorLocation(sessionId, sessionLocation);
    } else {
      const cachedAnchor = getCachedSessionAnchorLocation(sessionId);
      if (cachedAnchor) {
        anchor = cachedAnchor;
      }
    }
  }

  if (!anchor || anchor.lat == null || anchor.lng == null) {
    return { ok: true, code: "LOCATION_NOT_ENFORCED", distanceMeters: null };
  }

  if (!studentLocation) {
    return {
      ok: false,
      code: "LOCATION_REQUIRED",
      error: "Live GPS location is required to verify your presence in class.",
    };
  }

  const lat = studentLocation.lat != null ? studentLocation.lat : studentLocation.latitude;
  const lng = studentLocation.lng != null ? studentLocation.lng : studentLocation.longitude;
  const accuracy = studentLocation.accuracy != null ? studentLocation.accuracy : null;

  if (lat == null || lng == null) {
    return {
      ok: false,
      code: "LOCATION_REQUIRED",
      error: "Valid GPS coordinates are required to mark attendance.",
    };
  }

  const numLat = Number(lat);
  const numLng = Number(lng);
  if (
    !Number.isFinite(numLat) ||
    !Number.isFinite(numLng) ||
    numLat < -90 ||
    numLat > 90 ||
    numLng < -180 ||
    numLng > 180
  ) {
    return {
      ok: false,
      code: "INVALID_COORDINATES",
      error: "Invalid or out-of-range GPS coordinates detected.",
    };
  }

  return validateLocationInRadius(anchor, numLat, numLng, accuracy);
}

// In-memory velocity tracking to detect impossible travel / GPS jumping
const studentLocationHistory = new Map();
const VELOCITY_HISTORY_TTL_MS = 30 * 60 * 1000; // 30 minutes

function cleanupVelocityHistory() {
  const now = Date.now();
  for (const [key, value] of studentLocationHistory.entries()) {
    if (!value || now - value.timestamp > VELOCITY_HISTORY_TTL_MS) {
      studentLocationHistory.delete(key);
    }
  }
}

/**
 * Detect impossible physical velocity jumps between consecutive attendance check-ins
 * Flag if student moves > 5km in under 3 minutes (> 100 km/h).
 */
function checkSuspiciousLocationJump(studentId, lat, lng) {
  if (!studentId || lat == null || lng == null) return { ok: true };
  const sid = String(studentId);
  const numLat = Number(lat);
  const numLng = Number(lng);
  if (!Number.isFinite(numLat) || !Number.isFinite(numLng)) return { ok: true };

  cleanupVelocityHistory();
  const prev = studentLocationHistory.get(sid);
  const now = Date.now();

  if (prev && prev.timestamp) {
    const elapsedMs = Math.max(0, now - prev.timestamp);
    if (elapsedMs < 3 * 60 * 1000) {
      const dist = distanceMeters(prev.lat, prev.lng, numLat, numLng);
      // If student moved more than 5,000 meters in under 3 minutes
      if (dist > 5000) {
        const safeElapsedMs = Math.max(elapsedMs, 100);
        const speedKmh = Math.round((dist / 1000) / (safeElapsedMs / 3600000));
        return {
          ok: false,
          code: "IMPOSSIBLE_TRAVEL",
          error: `Suspicious location change detected (${Math.round(dist / 1000)}km in ${Math.round(elapsedMs / 1000)}s, ~${speedKmh} km/h). Attendance blocked for location integrity.`,
          distanceMeters: Math.round(dist),
          speedKmh,
        };
      }
    }
  }

  // Update last seen coordinates
  studentLocationHistory.set(sid, { lat: numLat, lng: numLng, timestamp: now });
  return { ok: true };
}

module.exports = {
  distanceMeters,
  validateLocationInRadius,
  validateStudentLocation,
  checkSuspiciousLocationJump,
  cacheSessionAnchorLocation,
  getCachedSessionAnchorLocation,
  invalidateSessionAnchorLocation,
  MAX_STUDENT_GPS_ACCURACY_METERS,
};
