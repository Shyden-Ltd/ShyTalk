/**
 * Playwright global setup — runs once before all test files.
 *
 * Clears Firestore emulator data to prevent inter-run state accumulation.
 * Tests seed their own data via test/setup, so starting from a clean state
 * ensures no leftover documents from previous runs cause strict-mode
 * violations, stale count mismatches, or phantom data.
 */
export default async function globalSetup() {
  const apiBase = process.env.API_BASE_URL || 'http://localhost:3000';
  const testApiKey = process.env.TEST_API_KEY || '';

  if (!testApiKey) return; // CI uses real dev — no cleanup needed

  // Clear only test-generated collections to prevent inter-run accumulation.
  // System data (gifts, economyConfig, logs, etc.) is seeded by local/start.sh
  // and must NOT be cleared — tests depend on it.
  //
  // `reports` and `suspensionAppeals` are wiped each run because the
  // fixture teardown only catches docs tagged with `_testRun`; reports
  // / appeals created via the regular `/api/reports` path (some helpers
  // used that before being updated to `testWrite`) are NOT tagged and
  // would otherwise accumulate as orphaned `data-uid="undefined"`
  // cards at the top of the Reports and Appeals tabs, silently breaking
  // selectors like `.report-card.first()`.
  const collections = [
    'suggestions',
    'notifications',
    'moderationLog',
    'auditLog',
    'adminAuditLog',
    'blockedTopics',
    'reports',
    'suspensionAppeals',
  ];

  // Bounded, because an UNBOUNDED fetch here hangs the entire run silently.
  // A degraded Firestore emulator (2026-07-28) left /api/test/clear never
  // answering, so Playwright sat at 0% CPU producing zero output — no test
  // ever started and the pre-push gate simply never returned. An infinite
  // wait is indistinguishable from "slow", which is what made it cost two
  // 40-minute timeouts to diagnose. Fail fast and loud instead.
  const CLEAR_TIMEOUT_MS = 15_000;

  for (const col of collections) {
    try {
      const res = await fetch(`${apiBase}/api/test/clear/${col}`, {
        method: 'POST',
        headers: { 'X-Test-API-Key': testApiKey, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(CLEAR_TIMEOUT_MS),
      });
      if (!res.ok && res.status !== 404) {
        console.warn(`[global-setup] Clear ${col}: ${res.status}`);
      }
    } catch (err) {
      // A timeout is NOT the same as "endpoint missing" and must not be
      // swallowed the same way — it means the stack is unhealthy and every
      // test that follows will fail for reasons that have nothing to do with
      // the code under test.
      const name = (err as Error)?.name;
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new Error(
          `[global-setup] Clearing "${col}" did not answer within ${CLEAR_TIMEOUT_MS}ms. ` +
            `The local stack is unhealthy — restart it with ` +
            `\`bash local/stop.sh && bash local/start.sh\` (and restart the API with ` +
            `\`cd express-api && npm run local\`) before re-running.`,
        );
      }
      // Anything else: the endpoint may genuinely not exist on this target.
    }
  }
  console.log('[global-setup] Cleared test collections');
}
