import { test, expect } from '@playwright/test';

/**
 * Dev deployment sanity checks — lightweight verification that services
 * are up and pages load after deployment. NOT a full test suite.
 *
 * Used by deploy-dev.yml instead of the full Playwright matrix.
 *
 * Auth: dev web is gated behind HTTP Basic auth (PR #441 lockdown).
 * The deploy workflow passes the shared password via
 * DEV_BASIC_AUTH_PASSWORD; we plug it into Playwright's built-in
 * `httpCredentials` option via `test.use(...)` so every page.goto() /
 * request.get() against WEB_BASE includes the Authorization header.
 * When the env var is unset (e.g. running locally against
 * `localhost:8888`), the conditional `use` is skipped — localhost has
 * no Pages Function gate.
 */

const WEB_BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';
const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000';
const DEV_BASIC_AUTH_PASSWORD = process.env.DEV_BASIC_AUTH_PASSWORD;

if (DEV_BASIC_AUTH_PASSWORD) {
  // Username is ignored by the lockdown helper — only the password
  // matters — but 'dev' is a stable canonical value so the
  // Authorization header has a fixed shape between runs.
  test.use({ httpCredentials: { username: 'dev', password: DEV_BASIC_AUTH_PASSWORD } });
}

test.describe('Dev Sanity Checks', () => {

  test('landing page loads', async ({ page }) => {
    const res = await page.goto(WEB_BASE);
    expect(res?.ok()).toBe(true);
    await expect(page.locator('.logo')).toBeVisible({ timeout: 10_000 });
  });

  test('roadmap page loads with data', async ({ page }) => {
    await page.goto(`${WEB_BASE}/roadmap.html`);
    // Wait for roadmap items to render (fetched from roadmap-data.json)
    await expect(page.locator('.phase-card, .roadmap-phase')).not.toHaveCount(0, { timeout: 15_000 });
  });

  test('admin panel loads', async ({ page }) => {
    const res = await page.goto(`${WEB_BASE}/admin/`);
    expect(res?.ok()).toBe(true);
    // Should show login or dashboard
    await expect(page.locator('#login-screen, #dashboard-screen')).not.toHaveCount(0, { timeout: 10_000 });
  });

  test('portal loads', async ({ page }) => {
    const res = await page.goto(`${WEB_BASE}/portal/`);
    expect(res?.ok()).toBe(true);
  });

  test('events.json is accessible', async ({ page }) => {
    const res = await page.request.get(`${WEB_BASE}/events/events.json`);
    expect(res.ok()).toBe(true);
    const data = await res.json();
    expect(data).toHaveProperty('events');
  });

  test('API health endpoint responds', async ({ page }) => {
    const probe = await page.request.get(`${API_BASE}/api/health`).catch(() => null);
    // CI starts the API in playwright-tests.yml (lines ~205-207 wait
    // for /api/health to respond). A missing probe in CI means an
    // unexpected outage — surface as a failure, not a silent skip
    // (that was the G050 gap). Local pre-push may run without the
    // full stack, so preserve the skip there.
    if (!probe) {
      if (process.env.CI) {
        throw new Error(`API at ${API_BASE} did not respond — expected running in CI`);
      }
      test.skip(true, 'API not running — skipping (local pre-push without stack)');
    }
    expect(probe!.ok()).toBe(true);
  });

  test('API firebase-config responds', async ({ page }) => {
    const probe = await page.request.get(`${API_BASE}/api/firebase-config`).catch(() => null);
    if (!probe) {
      if (process.env.CI) {
        throw new Error(`API at ${API_BASE} did not respond — expected running in CI`);
      }
      test.skip(true, 'API not running — skipping (local pre-push without stack)');
    }
    expect(probe!.ok()).toBe(true);
    const data = await probe!.json();
    expect(data).toHaveProperty('apiKey');
    expect(data).toHaveProperty('projectId');
  });

  test('no console errors on landing page', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    await page.goto(WEB_BASE);
    await page.waitForTimeout(2_000);
    // Filter out 429 rate-limiting errors — Cloudflare throttles when 5 browsers hit dev simultaneously
    const meaningful = errors.filter(e => !e.includes('429'));
    expect(meaningful).toHaveLength(0);
  });
});
