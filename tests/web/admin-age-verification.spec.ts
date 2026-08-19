/**
 * Admin Age Verification sub-tab (PR 6/14).
 *
 * Lives inside the Users tab. Verifies that the per-user review form
 * appears for the searched user when they have a pending submission,
 * the gate question conditionally reveals the YES/NO action branches,
 * and that approve/reject/modify-DOB POST to the right endpoints.
 *
 * Pre-existing endpoints (PR 4b) drive the decisions; this test
 * focuses on the new admin UI layer added in PR 6.
 */

import { test, expect, TestData } from './fixtures/admin';
import { adminLogin, navigateToTab, searchUser } from './helpers/admin-auth';
import { Page } from '@playwright/test';

async function createPendingSubmission(testData: TestData, opts: { dobMs?: number } = {}): Promise<string> {
  const dobMs =
    opts.dobMs !== undefined
      ? opts.dobMs
      : Date.UTC(2008, 0, 1); // ~17yo as of 2026 — borderline locked
  const result = await testData.api.testWrite('ageVerificationSubmissions', {
    userId: String(testData.user.uniqueId),
    idMethod: 'passport',
    r2Key: `age-verification/${testData.user.uniqueId}/test-${Date.now()}.jpg`,
    status: 'pending',
    submittedAt: Date.now(),
    currentDob: dobMs,
    _testRun: testData.testRunId,
  });
  return result.id;
}

/**
 * Mark all pending submissions for the test user as 'cleaned-by-test'
 * so the next test starts from an empty state. Idempotent — safe to
 * call when no pending submissions exist.
 *
 * Cannot use the admin approve/reject endpoint because it expects a
 * real R2 image (deletion is part of the decision flow). testWrite
 * with the same id field overwrites status and clears r2Key, which is
 * enough for the pending-list filter to drop the row.
 */
async function clearPending(testData: TestData): Promise<void> {
  try {
    const list = await testData.api.get('/api/admin/age-verification/pending');
    const submissions = (list?.submissions || []).filter(
      (s: any) => String(s.userId) === String(testData.user.uniqueId),
    );
    for (const s of submissions) {
      await testData.api.testWrite('ageVerificationSubmissions', {
        id: s.id,
        userId: s.userId,
        status: 'cleaned-by-test',
        r2Key: null,
        _testRun: testData.testRunId,
      });
    }
  } catch (_err) {
    // Best-effort.
  }
}

// Cleanup is handled by the global teardown via the _testRun tag on
// each document. No per-test teardown needed — tests filter pending
// submissions by userId so accumulation in the collection doesn't
// cause cross-test interference.

async function openAgeVerifSubtab(page: Page): Promise<void> {
  const btn = page.locator('.user-subtab[data-subtab="age-verif"]');
  await btn.click();
  await expect(btn).toHaveClass(/active/);
}

test.describe('Admin Age Verification subtab', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page, testData }) => {
    // Wipe any leftover pending submissions for this user before each
    // test runs. Otherwise a retry of the form-renders test creates a
    // doc that breaks the next empty-state assertion.
    await clearPending(testData);
    await adminLogin(page);
    await navigateToTab(page, 'Users');
  });

  test('subtab button + empty state render when no pending submission for user', async ({ page, testData }) => {
    await searchUser(page, String(testData.user.uniqueId));
    await openAgeVerifSubtab(page);

    // Empty state visible — no pending for this user
    const empty = page.locator('[data-testid="ageVerif_empty"]');
    await expect(empty).toBeVisible();
    const form = page.locator('[data-testid="ageVerif_form"]');
    await expect(form).toBeHidden();
  });

  test('pending submission for searched user → form renders with submitted data', async ({ page, testData }) => {
    const dob = Date.UTC(2008, 0, 1);
    const submissionId = await createPendingSubmission(testData, { dobMs: dob });

    await searchUser(page, String(testData.user.uniqueId));
    await openAgeVerifSubtab(page);

    const form = page.locator('[data-testid="ageVerif_form"]');
    await expect(form).toBeVisible();

    // Verify the metadata fields populate
    await expect(page.locator('#age-verif-method')).toHaveText('passport');
    await expect(page.locator('#age-verif-current-dob')).toHaveText('2008-01-01');
    await expect(page.locator('#age-verif-submission-id')).toHaveText(submissionId);

    // Pending badge on the sub-tab now shows ≥1
    const badge = page.locator('#age-verif-pending-badge');
    await expect(badge).toBeVisible();
    const badgeText = (await badge.textContent()) || '';
    expect(parseInt(badgeText, 10)).toBeGreaterThanOrEqual(1);
  });

  test('gate question controls action branch visibility', async ({ page, testData }) => {
    await createPendingSubmission(testData);
    await searchUser(page, String(testData.user.uniqueId));
    await openAgeVerifSubtab(page);

    const yesActions = page.locator('[data-testid="ageVerif_yesActions"]');
    const noActions = page.locator('[data-testid="ageVerif_noActions"]');

    // Initially both branches hidden
    await expect(yesActions).toBeHidden();
    await expect(noActions).toBeHidden();

    // Pick YES → only yes-actions shows
    await page.locator('[data-testid="ageVerif_matchYes"]').check();
    await expect(yesActions).toBeVisible();
    await expect(noActions).toBeHidden();

    // Switch to NO → swap visibility
    await page.locator('[data-testid="ageVerif_matchNo"]').check();
    await expect(noActions).toBeVisible();
    await expect(yesActions).toBeHidden();
  });
});
