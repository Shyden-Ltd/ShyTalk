/**
 * Builds the admin-facing partial-failure toast text from a moderation
 * resolve response. Returns null when the response is fully successful;
 * otherwise returns a single-line string the admin can act on.
 *
 * The shape locked here is the contract emitted by
 * /api/reports/:id/resolve and /api/reports/resolve-all/:userId in
 * express-api/src/routes/reports.js (Pass-9..Pass-13).
 *
 * Order matters: action-blocking failures first, audit (compliance) next,
 * PMs (delivery) last — so the admin reads the most actionable item first.
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
    if (result.cascade && result.cascade.rtdbEventsFailed > 0) {
      parts.push(
        result.cascade.rtdbEventsFailed +
          " RTDB event(s) didn't deliver — live clients may not see the change",
      );
    }
    if (result.reports && result.reports.failed > 0) {
      const total =
        result.reports.total != null
          ? result.reports.total
          : result.reports.failed + (result.reports.committed != null ? result.reports.committed : 0);
      parts.push(result.reports.failed + '/' + total + ' reports did not commit');
    }
    if (result.auditLog && result.auditLog.failed) {
      parts.push('audit log failed — escalate to ops');
    }
    if (result.lockRelease && result.lockRelease.failed) {
      parts.push('report lock not released — admin may need to unlock manually');
    }
    if (result.pms && result.pms.failed > 0) {
      const pmsTotal = result.pms.total != null ? result.pms.total : '?';
      parts.push(result.pms.failed + '/' + pmsTotal + ' PMs failed');
    }

    if (parts.length === 0) return null;
    return 'Partial: ' + parts.join('; ') + '. Please retry the failed step.';
  }

  return { buildPartialFailureMessage };
});
