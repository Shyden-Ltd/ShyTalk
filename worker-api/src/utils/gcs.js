/**
 * Good Character Score (GCS) computation helper.
 *
 * GCS starts at 100 and is deducted when a user receives a warning.
 * Over time, the score recovers at +2 per month from the floor value.
 */

/**
 * Compute the display GCS score with time-based recovery.
 *
 * @param {number} floor - The lowest GCS score after last deduction
 * @param {number|null} lastDeductionMs - Unix ms of the last deduction
 * @returns {number} Current display score (0-100)
 */
function computeDisplayScore(floor, lastDeductionMs) {
  if (floor == null || floor >= 100) return 100;
  if (!lastDeductionMs) return floor;

  const monthsSince = (Date.now() - lastDeductionMs) / (30 * 24 * 60 * 60 * 1000);
  return Math.min(100, Math.round(floor + 2 * monthsSince));
}

module.exports = { computeDisplayScore };
