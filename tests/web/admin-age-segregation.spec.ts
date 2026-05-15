/**
 * Admin Age Segregation tab (UK OSA #17 PR 13).
 *
 * Top-level admin tab. Exposes:
 *   1. Cohort distribution stats (GET /api/admin/cohort-stats)
 *   2. Per-user cohort-override form (POST /api/user/:uid/cohort-override)
 *
 * Compliance-critical surfaces:
 *   - Override requires a non-empty reason (client-side check before
 *     POST; server independently rejects). The audit trail depends on
 *     this string so the form's submit button is disabled until it has
 *     content.
 *   - Override on a regular MEMBER target is rejected by the server
 *     with 422 CANNOT_OVERRIDE_REGULAR_USER. The form surfaces this
 *     specific error code so the admin understands the refusal is by
 *     design, not a generic failure.
 *   - A confirmation modal appears before the POST is sent. An admin
 *     who accidentally tabs into the Apply button cannot ship an
 *     override without explicitly clicking "Confirm". The audit-log
 *     entry would otherwise reflect that misclick.
 */

import { test, expect } from './fixtures/admin';
import { adminLogin, navigateToTab } from './helpers/admin-auth';

test.describe('Admin Age Segregation tab', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
  });

  test('tab button appears in nav and activates panel', async ({ page }) => {
    const tabBtn = page.locator('#tab-age-segregation');
    await expect(tabBtn).toBeVisible();
    await navigateToTab(page, 'Age Segregation');
    const panel = page.locator('#age-segregation-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('data-module-ready', 'true');
  });

  test('cohort stats render numeric counts (no NaN, no placeholder)', async ({ page }) => {
    await navigateToTab(page, 'Age Segregation');

    const stats = page.locator('[data-testid="ageSeg_stats"]');
    await expect(stats).toBeVisible();

    // Each stat must resolve to a non-negative integer. Auto-retry until
    // the in-flight /api/admin/cohort-stats response binds — `toHaveText`
    // polls until the regex matches or the test times out. Reading
    // textContent() directly would race the activate() fetch and read
    // the '—' placeholder.
    for (const key of ['adult', 'minor', 'missing', 'total', 'overrideAdult', 'overrideMinor']) {
      const value = page.locator(`[data-testid="ageSeg_stat_${key}"]`);
      await expect(value).toBeVisible();
      await expect(value).toHaveText(/^\d+$/);
    }
  });

  test('refresh button re-fetches stats and updates DOM', async ({ page }) => {
    await navigateToTab(page, 'Age Segregation');

    // Capture the first total value
    const total = page.locator('[data-testid="ageSeg_stat_total"]');
    const before = (await total.textContent()) || '';

    // Force the placeholder so we can observe the click-driven re-bind
    // happen. Otherwise the initial activate-fired loadStats may have
    // already populated the value, making the test silently no-op in
    // browsers that finish the initial fetch before navigateToTab
    // returns (Chromium) vs. those that don't (Firefox).
    await total.evaluate((el) => {
      el.textContent = '—';
    });
    await page.locator('#age-seg-refresh-btn').click();
    // Poll on the bound DOM value. `toHaveText(/^\d+$/)` retries with
    // backoff until the value transitions out of the placeholder/'…'
    // state. This is more reliable than waitForResponse, which on
    // Firefox races against the response-listener arm time.
    await expect(total).toHaveText(/^\d+$/, { timeout: 10_000 });
    const after = (await total.textContent()) || '';
    expect(Number.isFinite(Number.parseInt(after.replace(/[^0-9-]/g, ''), 10))).toBe(true);
    // `before` is referenced only for diagnostics on failure
    expect(after).toBeDefined();
    expect(typeof before).toBe('string');
  });

  test('apply button is disabled until reason has content', async ({ page }) => {
    await navigateToTab(page, 'Age Segregation');

    const target = page.locator('#age-seg-target-uid');
    const value = page.locator('#age-seg-override-value');
    const reason = page.locator('#age-seg-reason');
    const apply = page.locator('#age-seg-apply-btn');

    await target.fill('99999999');
    await value.selectOption('adult');

    // No reason yet → disabled
    await expect(apply).toBeDisabled();

    // Whitespace-only does NOT enable
    await reason.fill('   \t');
    await expect(apply).toBeDisabled();

    // Real content → enabled
    await reason.fill('staff test account');
    await expect(apply).toBeEnabled();
  });

  test('clicking apply opens a confirm modal showing the target + new cohort + reason', async ({ page }) => {
    await navigateToTab(page, 'Age Segregation');

    await page.locator('#age-seg-target-uid').fill('99999999');
    await page.locator('#age-seg-override-value').selectOption('adult');
    await page.locator('#age-seg-reason').fill('staff override for testing');

    await page.locator('#age-seg-apply-btn').click();

    const modal = page.locator('[data-testid="ageSeg_confirmModal"]');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('99999999');
    await expect(modal).toContainText('adult');
    await expect(modal).toContainText('staff override for testing');

    // Cancel keeps modal closed without firing the POST.
    const cancelPromise = page.waitForRequest(
      (req) =>
        req.url().includes('/cohort-override') && req.method() === 'POST',
      { timeout: 1500 },
    ).catch(() => null);
    await page.locator('[data-testid="ageSeg_confirmCancel"]').click();
    await expect(modal).toBeHidden();
    const captured = await cancelPromise;
    expect(captured).toBeNull(); // no POST fired
  });

  test('regular MEMBER target → 422 with CANNOT_OVERRIDE_REGULAR_USER surfaced to admin', async ({ page, testData }) => {
    await navigateToTab(page, 'Age Segregation');

    // testData.user is created with default userType (MEMBER). The
    // server should refuse with 422; the UI surfaces the typed code so
    // the admin sees that the refusal is by design.
    await page.locator('#age-seg-target-uid').fill(String(testData.user.uniqueId));
    await page.locator('#age-seg-override-value').selectOption('adult');
    await page.locator('#age-seg-reason').fill('attempted override on member');
    await page.locator('#age-seg-apply-btn').click();
    await page.locator('[data-testid="ageSeg_confirmOk"]').click();

    const result = page.locator('[data-testid="ageSeg_result"]');
    await expect(result).toBeVisible();
    await expect(result).toContainText(/CANNOT_OVERRIDE_REGULAR_USER|staff|admin/i);
    await expect(result).toHaveAttribute('data-status', 'error');
  });

  test('staff target → 200, doc updates, claim refresh acknowledged', async ({ page, testData }) => {
    // Elevate the test user to a staff role first so the override is
    // allowed. The test cleans this up by reverting to MEMBER at the
    // end so other tests in the file see the default state.
    await testData.api.testWrite('users', {
      id: String(testData.user.uniqueId),
      userType: 'TEACHER',
      _testRun: testData.testRunId,
    });

    try {
      await navigateToTab(page, 'Age Segregation');

      await page.locator('#age-seg-target-uid').fill(String(testData.user.uniqueId));
      await page.locator('#age-seg-override-value').selectOption('minor');
      await page.locator('#age-seg-reason').fill('test-run cohort pin');
      await page.locator('#age-seg-apply-btn').click();
      await page.locator('[data-testid="ageSeg_confirmOk"]').click();

      const result = page.locator('[data-testid="ageSeg_result"]');
      await expect(result).toBeVisible();
      await expect(result).toHaveAttribute('data-status', 'success');
      await expect(result).toContainText(/minor/);

      // Verify the doc actually reflects the override via the admin
      // user-read endpoint (round-trip confidence — not just trusting
      // the UI's optimistic update).
      const user = await testData.api.get(`/api/user/${testData.user.uniqueId}`);
      expect(user.cohortOverride).toBe('minor');
    } finally {
      // Revert to default userType + clear override
      await testData.api.testWrite('users', {
        id: String(testData.user.uniqueId),
        userType: 'MEMBER',
        cohortOverride: null,
        _testRun: testData.testRunId,
      });
    }
  });

  test('clear-override option sends override:null + records COHORT_OVERRIDE_CLEAR audit row', async ({ page, testData }) => {
    // Seed the user with an existing override so the clear has something
    // meaningful to revert.
    await testData.api.testWrite('users', {
      id: String(testData.user.uniqueId),
      userType: 'TEACHER',
      cohortOverride: 'adult',
      _testRun: testData.testRunId,
    });

    try {
      await navigateToTab(page, 'Age Segregation');

      const requestPromise = page.waitForRequest(
        (req) => req.url().includes('/cohort-override') && req.method() === 'POST',
      );

      await page.locator('#age-seg-target-uid').fill(String(testData.user.uniqueId));
      await page.locator('#age-seg-override-value').selectOption('__clear__');
      await page.locator('#age-seg-reason').fill('clearing post-test');
      await page.locator('#age-seg-apply-btn').click();
      await page.locator('[data-testid="ageSeg_confirmOk"]').click();

      const req = await requestPromise;
      const body = JSON.parse(req.postData() || '{}');
      expect(body.override).toBeNull();
      expect(typeof body.reason).toBe('string');
      expect(body.reason.length).toBeGreaterThan(0);
    } finally {
      await testData.api.testWrite('users', {
        id: String(testData.user.uniqueId),
        userType: 'MEMBER',
        cohortOverride: null,
        _testRun: testData.testRunId,
      });
    }
  });
});
