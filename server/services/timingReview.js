/**
 * timingReview.js
 *
 * Robust timing stats for the "Needs Review" QR-2 scan anomaly signal.
 *
 * Uses Median Absolute Deviation (MAD) — resistant to outliers and small samples.
 * This is purely informational: it NEVER blocks or rejects any student attendance.
 *
 * The "Needs Review" flag means:
 *   - The student's QR-2 scan arrived significantly later than the session median,
 *     AND it exceeded the absolute minimum threshold (NEEDS_REVIEW_MIN_QR2_AGE_MS).
 *   - Faculty can use this to follow up; it does NOT affect recorded attendance.
 */

"use strict";

/**
 * Compute the median of a numeric array.
 * Returns 0 for empty arrays.
 * @param {number[]} values
 * @returns {number}
 */
function median(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Compute robust timing statistics for a session using Median Absolute Deviation (MAD).
 *
 * Formula:
 *   median      = median(values)
 *   MAD         = median(|v_i - median|)
 *   robustDev   = 1.4826 * MAD   (consistent estimator of std dev under normality)
 *
 * @param {number[]} timingValues  Array of qr2_scan_timing_ms values (must be > 0)
 * @returns {{ median: number, robustDeviation: number, count: number }}
 */
function computeRobustStats(timingValues) {
  const valid = (timingValues || []).filter((v) => typeof v === "number" && v > 0);
  if (valid.length === 0) {
    return { median: 0, robustDeviation: 0, count: 0 };
  }

  const med = median(valid);
  const absoluteDeviations = valid.map((v) => Math.abs(v - med));
  const mad = median(absoluteDeviations);
  const robustDeviation = 1.4826 * mad;

  return {
    median: Math.round(med),
    robustDeviation: Math.round(robustDeviation),
    count: valid.length,
  };
}

/**
 * Determine whether a single timing value should be flagged for faculty review.
 *
 * Conditions (BOTH must be true):
 *   1. timingMs >= minAbsMs         (absolute floor — prevents spurious flags)
 *   2. timingMs > stats.median + 3 * stats.robustDeviation  (comparative outlier)
 *   3. stats.count >= minSamples    (don't flag until baseline is reliable)
 *
 * @param {number} timingMs         The student's qr2_scan_timing_ms value
 * @param {{ median: number, robustDeviation: number, count: number }} stats
 * @param {number} [minAbsMs=500]   Absolute minimum threshold (config-driven)
 * @param {number} [minSamples=5]   Minimum sample count for comparative flagging
 * @returns {boolean}
 */
function shouldFlagForReview(timingMs, stats, minAbsMs = 500, minSamples = 5) {
  if (!timingMs || timingMs <= 0) return false;

  // Absolute floor — below this there's nothing meaningful to flag
  if (timingMs < minAbsMs) return false;

  // Need enough samples for a reliable session baseline
  if (!stats || stats.count < minSamples) return false;

  // Comparative outlier: > median + 3 robust standard deviations
  const comparativeThreshold = stats.median + 3 * stats.robustDeviation;
  return timingMs > comparativeThreshold;
}

module.exports = { computeRobustStats, shouldFlagForReview, median };
