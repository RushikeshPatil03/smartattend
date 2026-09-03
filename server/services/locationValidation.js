const EARTH_RADIUS_M = 6371000;

function toRad(n) {
  return (n * Math.PI) / 180;
}

function distanceMeters(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

const LOCATION_BASE_TOLERANCE_METERS = Number(
  process.env.LOCATION_BASE_TOLERANCE_METERS || 20
);
const LOCATION_MAX_ACCURACY_MARGIN_METERS = Number(
  process.env.LOCATION_MAX_ACCURACY_MARGIN_METERS || 60
);

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
    return { ok: true, distanceMeters: null };
  }

  const sessLat = Number(sessionLocation.lat);
  const sessLng = Number(sessionLocation.lng);
  if (!Number.isFinite(sessLat) || !Number.isFinite(sessLng)) {
    return { ok: true, distanceMeters: null };
  }

  const numLat = Number(lat);
  const numLng = Number(lng);
  if (!Number.isFinite(numLat) || !Number.isFinite(numLng)) {
    return { ok: false, error: "Valid numeric GPS coordinates required" };
  }

  const dist = distanceMeters(numLat, numLng, sessLat, sessLng);
  const radius = Math.max(10, Number(sessionLocation.radiusMeters || 50));
  const accuracy = Number(accuracyMeters);
  const gpsMargin = Number.isFinite(accuracy) && accuracy > 0
    ? Math.min(accuracy, LOCATION_MAX_ACCURACY_MARGIN_METERS)
    : 0;
  const effectiveRadius = radius + LOCATION_BASE_TOLERANCE_METERS + gpsMargin;

  if (dist > effectiveRadius) {
    const away = Math.round(dist);
    const limit = Math.round(effectiveRadius);
    return {
      ok: false,
      error: `Outside allowed classroom boundary. You are ${away}m away (limit is ${limit}m). Please move inside the classroom.`,
      distanceMeters: dist,
      allowedMeters: effectiveRadius,
    };
  }

  return { ok: true, distanceMeters: dist, allowedMeters: effectiveRadius };
}

function validateStudentLocation(studentLocation, sessionLocation) {
  if (
    !sessionLocation ||
    sessionLocation.lat == null ||
    sessionLocation.lng == null
  ) {
    return { ok: true, distanceMeters: null };
  }

  if (!studentLocation) {
    return {
      ok: false,
      error: "Live GPS location is required to verify your presence in class.",
    };
  }

  const lat = studentLocation.lat != null ? studentLocation.lat : studentLocation.latitude;
  const lng = studentLocation.lng != null ? studentLocation.lng : studentLocation.longitude;
  const accuracy = studentLocation.accuracy != null ? studentLocation.accuracy : null;

  if (lat == null || lng == null) {
    return {
      ok: false,
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
      error: "Invalid or out-of-range GPS coordinates detected.",
    };
  }

  return validateLocationInRadius(sessionLocation, numLat, numLng, accuracy);
}

module.exports = {
  distanceMeters,
  validateLocationInRadius,
  validateStudentLocation,
};
