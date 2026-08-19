import { test, expect } from '@playwright/test';
import { adminLogin, navigateToTab } from './helpers/admin-auth';

/**
 * Regression test for the appeals.js XSS defense added in PR #578.
 *
 * Background: appeals.js renderCard() interpolates `userUniqueId` and
 * each report's `reporterUniqueId` directly into a template literal
 * that is then assigned to `innerHTML`. A malicious uniqueId leaking
 * through (e.g. via API tampering, a corrupted user record, or a
 * future feature where these become user-controllable) would execute
 * as HTML/JS. PR #578 wrapped both with `${escapeHtml(String(...))}`
 * as defense-in-depth.
 *
 * Test design: route-intercept the GET /api/appeals?status=pending
 * call from the admin tab, return a synthetic appeal containing
 * `<script>` and `<img onerror>` payloads in `userUniqueId` and
 * `reports[0].reporterUniqueId`, then assert:
 *
 *  1. The DOM HTML contains escaped sequences (e.g. `&lt;script&gt;`)
 *  2. NO literal `<script>` injection from the payload appears
 *  3. NO `<img onerror=...>` from the payload appears
 *  4. Window sentinels (`__xss_executed`, `__xss_img`) stay false
 *
 * Pins the contract — any regression that drops the escapes will fail
 * loudly. Route mocking is the right tool here because the real API
 * normalizes uniqueId from the user record, so we can't seed the
 * malicious value through the API path.
 */

const SCRIPT_PAYLOAD = "<script>window.__xss_executed=true;</script>";
const IMG_PAYLOAD = "<img src=x onerror=window.__xss_img=true>";

test.describe('Admin Appeals — XSS defense (mocked API)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__xss_executed = false;
      (window as any).__xss_img = false;
    });
    await adminLogin(page);
  });

  test('userUniqueId with <script> payload renders escaped, not executed', async ({ page }) => {
    await page.route('**/api/appeals**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          appeals: [
            {
              id: 'xss-test-1',
              userId: 'xss-user-1',
              userUniqueId: SCRIPT_PAYLOAD,
              userDisplayName: 'XSS Test User',
              originalDisplayName: 'XSS Test User',
              appealText: 'XSS payload regression — script tag',
              status: 'pending',
              submittedAt: Date.now(),
              userInfo: {
                uniqueId: SCRIPT_PAYLOAD,
                displayName: 'XSS Test User',
              },
              reports: [],
            },
          ],
        }),
      });
    });

    await navigateToTab(page, 'Appeals');
    await page.waitForSelector('.appeal-card', { timeout: 10_000 });

    const card = page.locator('.appeal-card').first();
    const html = await card.evaluate((el) => el.innerHTML);

    expect(html, 'card HTML must contain escaped <script>').toContain('&lt;script&gt;');
    expect(html, 'card HTML must NOT contain a literal injected <script> tag').not.toMatch(
      /<script\b/,
    );

    const executed = await page.evaluate(() => (window as any).__xss_executed === true);
    expect(executed, '__xss_executed sentinel must remain false').toBe(false);
  });

  test('reporterUniqueId with <img onerror> payload renders escaped, not executed', async ({
    page,
  }) => {
    await page.route('**/api/appeals**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          appeals: [
            {
              id: 'xss-test-2',
              userId: 'xss-user-2',
              userUniqueId: '12345',
              userDisplayName: 'Normal User',
              originalDisplayName: 'Normal User',
              appealText: 'XSS payload regression — img onerror via reporter',
              status: 'pending',
              submittedAt: Date.now(),
              userInfo: {
                uniqueId: '12345',
                displayName: 'Normal User',
              },
              reports: [
                {
                  id: 'r1',
                  reason: 'spam',
                  status: 'pending',
                  reporterName: 'Reporter',
                  reporterUniqueId: IMG_PAYLOAD,
                  timestamp: Date.now(),
                },
              ],
            },
          ],
        }),
      });
    });

    await navigateToTab(page, 'Appeals');
    await page.waitForSelector('.appeal-card', { timeout: 10_000 });

    // The reports section is inside <details> — we need to interrogate
    // the full card innerHTML which contains both the visible and
    // collapsed-but-rendered DOM.
    const card = page.locator('.appeal-card').first();
    const html = await card.evaluate((el) => el.innerHTML);

    // Escaped sequences present
    expect(html, 'card HTML must contain escaped <img').toContain('&lt;img');
    // No injected <img onerror=...> from the payload (the avatar img,
    // if any, never has onerror=window.__xss_img — that's the payload).
    expect(
      html,
      'card HTML must NOT contain a literal <img ... onerror=window.__xss_img...> from the payload',
    ).not.toMatch(/<img[^>]*onerror=window\.__xss_img/);

    const imgExecuted = await page.evaluate(() => (window as any).__xss_img === true);
    expect(imgExecuted, '__xss_img sentinel must remain false').toBe(false);
  });
});
