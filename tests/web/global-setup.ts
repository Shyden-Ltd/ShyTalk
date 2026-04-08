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
  // Only clear collections that accumulate across test runs and cause strict
  // mode violations or stale data assertions. Do NOT clear collections seeded
  // by fixtures (funFacts, banners, reports, etc.) — the fixture teardown
  // handles those per-worker.
  const collections = [
    'suggestions', 'notifications', 'moderationLog', 'auditLog', 'adminAuditLog',
    'blockedTopics', 'funFacts',
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
