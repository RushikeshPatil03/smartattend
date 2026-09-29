/**
 * timingReview.test.js
 *
 * Unit tests for QR-2 timing calculation, Median Absolute Deviation (MAD),
 * and the "Needs Review" threshold logic.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { median, computeRobustStats, shouldFlagForReview } = require("../services/timingReview");

test("median calculation", async (t) => {
  await t.test("returns 0 for empty array", () => {
    assert.equal(median([]), 0);
    assert.equal(median(null), 0);
  });

  await t.test("calculates median for odd-length array", () => {
    assert.equal(median([100, 200, 300]), 200);
    assert.equal(median([500, 100, 300]), 300); // unsorted input
  });

  await t.test("calculates median for even-length array", () => {
    assert.equal(median([100, 200, 300, 400]), 250);
  });

  await t.test("handles single element", () => {
    assert.equal(median([150]), 150);
  });
});

test("computeRobustStats (MAD & robustDeviation)", async (t) => {
  await t.test("returns 0 stats for empty or invalid data", () => {
    const stats = computeRobustStats([]);
    assert.deepEqual(stats, { median: 0, robustDeviation: 0, count: 0 });
  });

  await t.test("computes accurate median and robust deviation for uniform distribution", () => {
    // Normal scans clustered around 200ms
    const timings = [190, 200, 210, 200, 205, 195, 200];
    const stats = computeRobustStats(timings);
    assert.equal(stats.median, 200);
    assert.equal(stats.count, 7);
    assert.ok(stats.robustDeviation >= 0);
  });

  await t.test("outlier resistance: MAD does not blow up with single high outlier", () => {
    const timingsWithoutOutlier = [190, 200, 205, 210, 195, 200];
    const timingsWithOutlier = [190, 200, 205, 210, 195, 200, 25000]; // 25s proxy outlier

    const stats1 = computeRobustStats(timingsWithoutOutlier);
    const stats2 = computeRobustStats(timingsWithOutlier);

    // Median and robust deviation remain stable despite the extreme outlier
    assert.ok(Math.abs(stats1.median - stats2.median) <= 10);
    assert.ok(stats2.robustDeviation < 50); // MAD doesn't explode like standard deviation
  });
});

test("shouldFlagForReview threshold logic", async (t) => {
  const normalStats = { median: 210, robustDeviation: 30, count: 20 };

  await t.test("flags significant outlier exceeding 3*MAD and minimum absolute threshold", () => {
    // Threshold is 210 + 3*30 = 300ms, but min absolute threshold is 500ms
    // Student at 740ms: >= 500 AND > 300 -> true
    assert.equal(shouldFlagForReview(740, normalStats, 500, 5), true);
  });

  await t.test("does not flag scan below absolute minimum threshold (500ms) even if mathematically an outlier", () => {
    // Suppose median is 100ms, robustDeviation is 10ms.
    // 3*MAD threshold is 130ms. Student scans at 350ms.
    // 350ms > 130ms, BUT 350ms < 500ms (min absolute) -> must NOT flag!
    const tightStats = { median: 100, robustDeviation: 10, count: 20 };
    assert.equal(shouldFlagForReview(350, tightStats, 500, 5), false);
  });

  await t.test("does not flag normal scans close to median", () => {
    assert.equal(shouldFlagForReview(220, normalStats, 500, 5), false);
    assert.equal(shouldFlagForReview(250, normalStats, 500, 5), false);
  });

  await t.test("low sample count safety: does not flag when fewer than minimum samples exist", () => {
    // Only 3 students scanned so far — baseline not yet established
    const earlyStats = { median: 200, robustDeviation: 20, count: 3 };
    assert.equal(shouldFlagForReview(1200, earlyStats, 500, 5), false);
  });

  await t.test("does not flag invalid or negative timing values", () => {
    assert.equal(shouldFlagForReview(0, normalStats, 500, 5), false);
    assert.equal(shouldFlagForReview(-100, normalStats, 500, 5), false);
    assert.equal(shouldFlagForReview(null, normalStats, 500, 5), false);
  });
});
