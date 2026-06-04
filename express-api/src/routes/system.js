/**
 * System endpoints for external schedulers + health monitoring.
 *
 * GET  /api/system/health                   — public, Better Stack heartbeat.
 *                                             Returns 200 immediately,
 *                                             async-fires the serverHealth()
 *                                             metrics check (memory + PM2
 *                                             restart detection).
 *
 * POST /api/system/sweep-account-deletions  — requires Bearer auth.
 *                                             Synchronously runs
 *                                             accountDeletion() — daily
 *                                             03:00 UTC sweep scheduled
 *                                             by .github/workflows/
 *                                             cron-account-deletion.yml.
 *
 * POST /api/system/sweep-bans               — requires Bearer auth.
 *                                             Synchronously runs
 *                                             expireBans() — every-15-min
 *                                             sweep scheduled by
 *                                             .github/workflows/
 *                                             cron-expire-bans.yml.
 *
 * POST /api/system/dispatch-notifications   — requires Bearer auth.
 *                                             Synchronously runs
 *                                             dispatchNotifications() —
 *                                             every-5-min sweep scheduled
 *                                             by .github/workflows/
 *                                             cron-dispatch-notifications.yml.
 *                                             Was every 2 min in the
 *                                             in-process cron; cadence
 *                                             relaxed to every 5 min in
 *                                             the GH Actions move to keep
 *                                             total cluster minutes low
 *                                             (operator-approved).
 *
 * Architecture: replaces in-process node-cron schedules with either
 * external monitors (Better Stack for serverHealth) or GitHub Actions
 * scheduled workflows (for sweep operations). Public repo means GH
 * Actions is free + unlimited, so the scheduling layer is fully $0
 * with the auditability bonus of having the cron expressions in-repo.
 */

const router = require('express').Router();
const log = require('../utils/log');
const serverHealth = require('../cron/serverHealth');
const accountDeletion = require('../cron/accountDeletion');
const expireBans = require('../cron/expireBans');
const dispatchNotifications = require('../cron/notification-dispatch');
const alertManager = require('../utils/alertManagerInstance');
const { requireSystemAuth } = require('../middleware/system-auth');

router.get('/system/health', (req, res) => {
  // Respond immediately so the external monitor sees a fast 200. The
  // metrics check (memory threshold + PM2 restart detection) runs
  // fire-and-forget — a failure there is logged but doesn't affect
  // the heartbeat response.
  res.json({ status: 'ok' });

  serverHealth(alertManager).catch((err) => {
    log.error('system', 'serverHealth metrics check failed', { error: err.message });
  });
});

const SWEEP_TIMEOUT_DEFAULT_MS = 20 * 60 * 1000;

// Read the sweep timeout per-request so tests can inject a short
// timeout via `process.env.SWEEP_TIMEOUT_MS_OVERRIDE` without faking
// the system clock (supertest's HTTP transport relies on real timers).
// Production paths never set the override, so the default 20-min bound
// applies in deploys.
function getSweepTimeoutMs() {
  if (process.env.NODE_ENV === 'test' && process.env.SWEEP_TIMEOUT_MS_OVERRIDE) {
    const override = Number(process.env.SWEEP_TIMEOUT_MS_OVERRIDE);
    if (Number.isFinite(override) && override > 0) return override;
  }
  return SWEEP_TIMEOUT_DEFAULT_MS;
}

/**
 * Factory for sweep-style endpoint handlers.
 *
 * Each sweep endpoint shares the same shape: bearer-auth (applied
 * upstream by the route mounting), reject-if-in-flight with 409,
 * Promise.race with a hard timeout, error → 500 + log, and a
 * try/finally that guarantees the in-flight flag is cleared and the
 * timeout handle released.
 *
 * Returning a closure-captured handler gives each sweep its OWN
 * in-flight flag (independent of other sweeps), and exposes a
 * `_reset()` method behind a NODE_ENV=test guard so the test suite can
 * scrub any leaked flag from a Jest-aborted test without exposing the
 * mutation to production callers. Per the operator's
 * `[[feedback-test-isolation-no-leaks]]` directive.
 *
 * The factory is the "three similar lines" refactor of PRs #989, #990,
 * and this PR — by the time we have three sweep endpoints with
 * identical wrapping logic, the abstraction pays for itself in: (a)
 * one place to audit auth / timeout / error-handling semantics; (b)
 * the in-flight independence test only needs to assert per-endpoint
 * flag closure; (c) future sweep endpoints (e.g. PR #6's voice-room
 * scrap once RTDB onDisconnect lands) get the same defenses for free.
 *
 * @param {string} name short identifier used in log messages, e.g.
 *   'sweep-bans', 'sweep-account-deletions'.
 * @param {() => Promise<unknown>} sweepFn the underlying worker that
 *   does the actual sweep — typically a function from src/cron/*.
 * @returns Express handler.
 */
function createSweepHandler(name, sweepFn) {
  let inFlight = false;

  const handler = async (req, res) => {
    if (inFlight) {
      return res.status(409).json({ error: 'sweep already in flight' });
    }
    inFlight = true;
    let timeoutHandle;
    try {
      const timeoutMs = getSweepTimeoutMs();
      const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`sweep timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      });
      await Promise.race([sweepFn(), timeoutPromise]);
      res.json({ status: 'ok' });
    } catch (err) {
      log.error('system', `${name} failed`, { error: err.message });
      res.status(500).json({ error: 'sweep failed' });
    } finally {
      // Clear the timer first so a successful sweep doesn't leak the
      // pending setTimeout (the Promise.race winner ignores the loser
      // but the loser's setTimeout is still scheduled and would keep
      // Node alive past the response).
      if (timeoutHandle) clearTimeout(timeoutHandle);
      inFlight = false;
    }
  };

  if (process.env.NODE_ENV === 'test') {
    handler._reset = () => {
      inFlight = false;
    };
  }

  return handler;
}

const sweepAccountDeletions = createSweepHandler('sweep-account-deletions', accountDeletion);
const sweepBans = createSweepHandler('sweep-bans', expireBans);
const dispatchNotificationsHandler = createSweepHandler(
  'dispatch-notifications',
  dispatchNotifications,
);

router.post('/system/sweep-account-deletions', requireSystemAuth, sweepAccountDeletions);
router.post('/system/sweep-bans', requireSystemAuth, sweepBans);
router.post('/system/dispatch-notifications', requireSystemAuth, dispatchNotificationsHandler);

// Test-only reset hook. Exported behind a NODE_ENV guard so production
// code can't accidentally clobber the in-flight flags. Calls each
// sweep handler's `_reset()` closure so all flags scrub in one go.
if (process.env.NODE_ENV === 'test') {
  router._resetInFlightForTesting = () => {
    sweepAccountDeletions._reset();
    sweepBans._reset();
    dispatchNotificationsHandler._reset();
  };
}

module.exports = router;
