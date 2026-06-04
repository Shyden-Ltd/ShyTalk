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
 *                                             accountDeletion() — the same
 *                                             function that used to fire
 *                                             from the daily 03:00 UTC cron,
 *                                             now driven by a GitHub Actions
 *                                             scheduled workflow at the same
 *                                             cron expression.
 *
 * Future endpoints (added per cron-cluster migration):
 * POST /api/system/sweep-bans               — requires Bearer
 * POST /api/system/dispatch-notifications   — requires Bearer
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

// In-flight guards prevent concurrent sweeps from racing on the same
// 10-doc page. The GH Actions scheduled workflow runs once per cron
// tick, but a hand-triggered re-dispatch or a delayed first run
// overlapping the next scheduled run would otherwise pick up the same
// rows. The guard returns 409 so the caller sees a clean rejection
// rather than a partial double-execution.
//
// Paired with a hard timeout (SWEEP_TIMEOUT_MS): if accountDeletion()
// hangs forever (Firestore unreachable, R2 retry-loop, Auth SDK
// stuck), the timeout races the sweep and forces the handler to
// respond 500. Without this, the in-flight flag stays `true` forever
// and the GH Actions 409-as-success path masks the wedge from the
// Actions UI — operator only finds out a week later when the deletion
// queue hasn't drained. The 20-min bound is well inside the workflow's
// `timeout-minutes: 30` and the curl `--max-time 600` (10 min) — curl
// times out first so the workflow sees a hard failure, then the
// server's own timeout clears the flag so the NEXT day's run can
// proceed without manual intervention.
let accountDeletionInFlight = false;
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

router.post('/system/sweep-account-deletions', requireSystemAuth, async (req, res) => {
  if (accountDeletionInFlight) {
    return res.status(409).json({ error: 'sweep already in flight' });
  }
  accountDeletionInFlight = true;
  let timeoutHandle;
  try {
    const timeoutMs = getSweepTimeoutMs();
    const timeoutPromise = new Promise((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error(`sweep timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });
    await Promise.race([accountDeletion(), timeoutPromise]);
    res.json({ status: 'ok' });
  } catch (err) {
    log.error('system', 'sweep-account-deletions failed', { error: err.message });
    res.status(500).json({ error: 'sweep failed' });
  } finally {
    // Clear the timer first so a successful sweep doesn't leak it (the
    // Promise.race winner ignores the loser but the loser's setTimeout
    // is still pending and would keep Node alive past the response).
    if (timeoutHandle) clearTimeout(timeoutHandle);
    accountDeletionInFlight = false;
  }
});

// Test-only reset hook. Exported behind a NODE_ENV guard so production
// code can't accidentally clobber the in-flight flag — the consumer
// (system.test.js afterEach) calls this to scrub any leaked state from
// a Jest-timeout-aborted test that held a Promise open without
// resolving it. Per the operator's `[[feedback-test-isolation-no-leaks]]`
// directive: tests must be isolated, no leaked state across cases.
if (process.env.NODE_ENV === 'test') {
  router._resetInFlightForTesting = () => {
    accountDeletionInFlight = false;
  };
}

module.exports = router;
