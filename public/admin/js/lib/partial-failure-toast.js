/**
 * Builds the admin-facing partial-failure toast text from a moderation
 * resolve response. Returns null when the response is fully successful;
 * otherwise returns a single-line string the admin can act on.
 *
 * The shape locked here is the contract emitted by
 * /api/reports/:id/resolve and /api/reports/resolve-all/:userId in
 * express-api/src/routes/reports.js. The MOD_ERROR token registry exported
 * from that file is the source of truth for the `error` strings.
 *
 * Order: action-blocking failures (warning/suspension/cascade) first,
 * compliance/lock middle, delivery (PMs) last — so the admin reads the
 * most actionable item first.
 *
 * UMD-ish module: works as a CommonJS require() in tests AND as a browser
 * <script> tag (attaches to window).
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    global.PartialFailureToast = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function buildPartialFailureMessage(result) {
    if (!result) return null;

    const parts = [];

    if (result.warning && result.warning.failed) {
      parts.push('warning was NOT applied');
    }
    if (result.suspension && result.suspension.failed) {
      parts.push('suspension was NOT applied');
    }
    if (result.cascade && result.cascade.partial) {
      const detail = result.cascade.userDocFailed
        ? 'user-doc clear failed'
        : (result.cascade.failedRoomIds || []).length + ' room(s) need manual cleanup';
      parts.push('room cascade partial — ' + detail);
    }
    // Number.isFinite rejects NaN, ±Infinity, AND non-numbers — stricter than
    // typeof === 'number' which admits NaN. A misimplemented backend sending
    // `failed: NaN` would otherwise coerce `NaN > 0` → false and silently
    // omit the toast (the exact silent-failure class this lib defends against).
    function isPositiveCount(x) {
      return Number.isFinite(x) && x > 0;
    }
    function finiteOr(x, fallback) {
      return Number.isFinite(x) ? x : fallback;
    }

    if (result.cascade && isPositiveCount(result.cascade.rtdbEventsFailed)) {
      parts.push(
        result.cascade.rtdbEventsFailed +
          " RTDB event(s) didn't deliver — live clients may not see the change",
      );
    }
    if (result.reports && isPositiveCount(result.reports.failed)) {
      const total = Number.isFinite(result.reports.total)
        ? result.reports.total
        : result.reports.failed + finiteOr(result.reports.committed, 0);
      parts.push(result.reports.failed + '/' + total + ' reports did not commit');
    }
    if (result.auditLog && result.auditLog.failed) {
      parts.push('audit log failed — escalate to ops');
    }
    if (result.lockRelease && result.lockRelease.failed) {
      parts.push('report lock not released — admin may need to unlock manually');
    }
    if (result.pms && isPositiveCount(result.pms.failed)) {
      const pmsTotal = Number.isFinite(result.pms.total) ? result.pms.total : '?';
      parts.push(result.pms.failed + '/' + pmsTotal + ' PMs failed');
    }

    if (parts.length === 0) return null;
    return 'Partial: ' + parts.join('; ') + '. Please retry the failed step.';
  }

  /**
   * Show either the partial-failure toast or a normal success toast,
   * depending on whether the response carries any partial-failure flags.
   *
   * @param showToast {(msg: string, kind?: 'success' | 'error') => void}
   *   The page-level toast function (varies between admin/portal/etc.).
   * @param result {object} — API response body.
   * @param successMessage {string | null} — message for the all-clear path.
   *   Pass null to show NO toast on success (e.g., silent autosave).
   */
  function showResultToast(showToast, result, successMessage) {
    const partialMessage = buildPartialFailureMessage(result);
    if (partialMessage) {
      showToast(partialMessage, 'error');
    } else if (successMessage !== null && successMessage !== undefined) {
      showToast(successMessage, 'success');
    }
  }

  return { buildPartialFailureMessage, showResultToast };
});
