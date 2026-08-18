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

  if (lat == null || lng == null) {
    return { ok: false, error: "Location coordinates required" };
  }

  const dist = distanceMeters(
    Number(lat),
    Number(lng),
    Number(sessionLocation.lat),
    Number(sessionLocation.lng)
  );
  const radius = Number(sessionLocation.radiusMeters || 200);
  const accuracy = Number(accuracyMeters);
  const gpsMargin = Number.isFinite(accuracy) && accuracy > 0
    ? Math.min(accuracy, LOCATION_MAX_ACCURACY_MARGIN_METERS)
    : 0;
  const effectiveRadius = radius + LOCATION_BASE_TOLERANCE_METERS + gpsMargin;

  if (dist > effectiveRadius) {
    return {
      ok: false,
      error: "Outside allowed attendance range",
      distanceMeters: dist,
      allowedMeters: effectiveRadius,
    };
  }

  return { ok: true, distanceMeters: dist, allowedMeters: effectiveRadius };
}

module.exports = {
  distanceMeters,
  validateLocationInRadius,
};
