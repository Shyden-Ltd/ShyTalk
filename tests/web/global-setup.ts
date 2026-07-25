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

  for (const col of collections) {
    try {
      const res = await fetch(`${apiBase}/api/test/clear/${col}`, {
        method: 'POST',
        headers: { 'X-Test-API-Key': testApiKey, 'Content-Type': 'application/json' },
      });
      if (!res.ok && res.status !== 404) {
        console.warn(`[global-setup] Clear ${col}: ${res.status}`);
      }
    } catch {
      // Endpoint may not exist — that's fine
    }
  }
  console.log('[global-setup] Cleared test collections');
}
