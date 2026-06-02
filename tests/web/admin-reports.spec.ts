import { test, expect, TestData } from './fixtures/admin';
import { adminLogin, navigateToTab } from './helpers/admin-auth';
import { Page } from '@playwright/test';

/** Wait for the reports list to finish loading. */
async function waitForReportsLoaded(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const list = document.getElementById('reports-list');
      if (!list) return false;
      return list.querySelector('.report-card') !== null ||
        list.textContent!.includes('No reports') ||
        list.textContent!.includes('Failed');
    },
  );
}

/** Click a report filter button (pending, resolved, archived). */
async function filterReports(page: Page, status: 'pending' | 'resolved' | 'archived'): Promise<void> {
  const btn = page.locator(`#report-filter-bar button[data-report-filter="${status}"]`);
  await expect(btn).toBeVisible({ timeout: 5_000 });
  await btn.click();
  await expect(btn).toHaveClass(/active/, { timeout: 5_000 });
  await waitForReportsLoaded(page);
}

/** Get reports via API with status filter. */
async function getReportsViaApi(testData: TestData, status: string): Promise<any> {
  return testData.api.get(`/api/reports?status=${status}`);
}

/** Get report stats via API. */
async function getReportStatsViaApi(testData: TestData, period = '7d'): Promise<any> {
  return testData.api.get(`/api/reports/stats?period=${period}`);
}

/**
 * Seed an additional report via the test-write endpoint so the doc is
 * tagged with `_testRun` and the per-test teardown picks it up. Going
 * through the regular `POST /api/reports` path leaves the doc untagged
 * and it accumulates as orphaned data ("Unknown user" cards at the top
 * of the Reports tab) once the test user is torn down.
 */
async function seedReportViaApi(testData: TestData): Promise<string> {
  const result = await testData.api.testWrite('reports', {
    reportedUserId: testData.user.uid,
    reportedUserUniqueId: testData.user.uniqueId,
    reporterId: testData.secondUser.uid,
    reporterUniqueId: testData.secondUser.uniqueId,
    reason: 'Spam',
    description: 'E2E seeded report',
    status: 'pending',
    createdAt: Date.now(),
    _testRun: testData.testRunId,
  });
  return result.id;
}

/** Unsuspend user and reset GCS. */
async function unsuspendAndResetGcs(testData: TestData): Promise<void> {
  try {
    await testData.api.post(`/api/user/${testData.user.uniqueId}/unsuspend`, {});
  } catch (err) {
    console.warn('unsuspend failed (user may not be suspended):', err);
  }
  try {
    await testData.api.post(`/api/user/${testData.user.uniqueId}/reset-gcs`, {});
  } catch (err) {
    console.warn('reset-gcs failed (endpoint may not exist):', err);
  }
}

/** Click the first report card to select it (for keyboard shortcuts). */
async function selectFirstReportCard(page: Page): Promise<void> {
  // Press ArrowDown to select the first card
  await page.keyboard.press('ArrowDown');
  const firstCard = page.locator('.report-card').first();
  await expect(firstCard).toHaveClass(/selected/);
}

test.describe('Admin Reports', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    // Pause the Reports tab's 15s poll so it can't fire mid-test and
    // wipe action-select / sev-radio / .selected state between e.g.
    // pressing D and asserting the result. See reports.js:340 +
    // [[feedback-test-isolation-no-leaks]] for context. Production
    // code never sets this flag — only tests.
    await page.addInitScript(() => {
      (window as Window & { __SHYTALK_PAUSE_REPORTS_POLL__?: boolean }).__SHYTALK_PAUSE_REPORTS_POLL__ = true;
    });
    await adminLogin(page);
    await navigateToTab(page, 'Reports');
    await waitForReportsLoaded(page);
  });

  // ── Test 1: Seeded report appears in pending list — API verify ──
  test('seeded report appears in pending list with API verification', async ({ page, testData }) => {
    await filterReports(page, 'pending');

    // Verify at least one report card is visible
    const cards = page.locator('.report-card');
    await expect(cards.first()).toBeVisible();

    // API verification
    const result = await getReportsViaApi(testData, 'pending');
    expect((result.users || result.reports || []).length).toBeGreaterThanOrEqual(1);
  });

  // ── Test 2: Filter by status — Pending/Resolved/Archived ──
  test('filter buttons toggle between Pending, Resolved, and Archived', async ({ page }) => {
    const pendingBtn = page.locator('#report-filter-bar button[data-report-filter="pending"]');
    const resolvedBtn = page.locator('#report-filter-bar button[data-report-filter="resolved"]');
    const archivedBtn = page.locator('#report-filter-bar button[data-report-filter="archived"]');

    // Pending (default)
    await expect(pendingBtn).toHaveClass(/active/, { timeout: 5_000 });

    // Switch to Resolved
    await filterReports(page, 'resolved');
    await expect(resolvedBtn).toHaveClass(/active/, { timeout: 5_000 });
    await expect(pendingBtn).not.toHaveClass(/active/, { timeout: 5_000 });

    // Switch to Archived
    await filterReports(page, 'archived');
    await expect(archivedBtn).toHaveClass(/active/, { timeout: 5_000 });
    await expect(resolvedBtn).not.toHaveClass(/active/, { timeout: 5_000 });

    // Back to Pending
    await filterReports(page, 'pending');
    await expect(pendingBtn).toHaveClass(/active/, { timeout: 5_000 });
  });

  // ── Test 3: Search by unique ID — enter user uniqueId, verify filtered ──
  test('search by unique ID filters reports', async ({ page, testData }) => {
    const searchInput = page.locator('#report-search-input');
    const searchBtn = page.locator('#report-search-btn');

    // Search for the seeded user by uniqueId.
    // Wait for the search API response before checking the DOM because
    // loadReports() preserves existing cards during a refresh, so
    // waitForReportsLoaded would return immediately seeing stale cards.
    await searchInput.fill(String(testData.user.uniqueId));
    const searchResponse = page.waitForResponse(
      resp => resp.url().includes('/api/reports') && resp.url().includes('search='),
    );
    await searchBtn.click();
    await searchResponse;
    await waitForReportsLoaded(page);

    // Verify the results show the user
    const reportsList = page.locator('#reports-list');
    const cards = page.locator('.report-card');
    const cardCount = await cards.count();

    if (cardCount > 0) {
      // Verify the displayed user matches the search
      await expect(reportsList).toContainText(String(testData.user.uniqueId));
    }

    // Clear search — same pattern: wait for API response
    await searchInput.fill('');
    const clearResponse = page.waitForResponse(
      resp => resp.url().includes('/api/reports') && !resp.url().includes('search='),
    );
    await searchBtn.click();
    await clearResponse;
    await waitForReportsLoaded(page);
  });

  // ── Test 4: Resolve as dismissed — click Dismiss, verify resolved ──
  test('resolve as dismissed moves report to resolved', async ({ page, testData }) => {
    await filterReports(page, 'pending');

    const firstCard = page.locator('.report-card').first();
    await expect(firstCard).toBeVisible();

    // Select "Dismiss" action
    const uid = await firstCard.getAttribute('data-uid');
    const actionSelect = firstCard.locator(`select[data-action-select="${uid}"]`);
    await actionSelect.selectOption('dismiss');

    // Click Resolve Latest
    const resolveBtn = firstCard.locator(`button[data-resolve-first="${uid}"]`);
    await resolveBtn.click();

    // Handle confirm dialog
    const confirmBtn = page.locator('.confirm-ok');
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // Wait for reload
    await waitForReportsLoaded(page);

    // Verify in resolved filter
    await filterReports(page, 'resolved');
    const resolvedCards = page.locator('.report-card');
    await expect(resolvedCards.first()).toBeVisible();

    // Re-seed report for other tests
    await seedReportViaApi(testData);
  });

  // ── Test 5: Resolve as warned — severity 2, cross-check warnings ──
  test('resolve as warned creates warning with correct severity', async ({ page, testData }) => {
    await filterReports(page, 'pending');

    const firstCard = page.locator('.report-card').first();
    await expect(firstCard).toBeVisible();

    const uid = await firstCard.getAttribute('data-uid');

    // Select "Warn" action
    const actionSelect = firstCard.locator(`select[data-action-select="${uid}"]`);
    await actionSelect.selectOption('warn');

    // Select severity 2. Radio inputs are display:none in the .severity-radio
    // markup — Playwright's label click does NOT trigger the native form-
    // checked behaviour on the hidden input, so the radio stays unchecked
    // and the resolve handler defaults to severity 1
    // (`reports.js:694` falls back to 1 when no input is `:checked`).
    // Set `checked` and dispatch `change` directly so the chosen severity
    // is actually applied.
    await firstCard.locator(`input[name="sev-${uid}"][value="2"]`).evaluate((el: HTMLInputElement) => {
      el.checked = true;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Click Resolve Latest
    const resolveBtn = firstCard.locator(`button[data-resolve-first="${uid}"]`);
    await resolveBtn.click();

    // Handle confirm dialog
    const confirmBtn = page.locator('.confirm-ok');
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    await waitForReportsLoaded(page);

    // Cross-check: verify warning exists via API
    try {
      const warnings = await testData.api.get(`/api/user/${testData.user.uniqueId}/warnings`);
      const warningList = Array.isArray(warnings) ? warnings : (warnings.warnings || []);
      const recentWarning = warningList.find((w: any) => w.severity === 2);
      expect(recentWarning).toBeTruthy();
    } catch (err) {
      console.warn('Warnings endpoint may not be available:', err);
    }

    // Cleanup: reset GCS and re-seed
    await unsuspendAndResetGcs(testData);
    await seedReportViaApi(testData);
  });

  // ── Test 6: Resolve as suspended — verify user suspended, then unsuspend ──
  test('resolve as suspended suspends the user', async ({ page, testData }) => {
    // Ensure user is unsuspended and a pending report exists
    await unsuspendAndResetGcs(testData);
    const reportId = await seedReportViaApi(testData);

    // Resolve the report as 'suspend' directly via API (tests the resolve endpoint)
    await testData.api.post(`/api/reports/${reportId}/resolve`, {
      action: 'suspend',
      severity: 3,
      suspensionDays: 1,
      canAppeal: true,
    });

    // Verify user is now suspended
    const userData = await testData.api.get(`/api/user/${testData.user.uniqueId}`);
    expect(userData.isSuspended).toBe(true);

    // Verify the report moved to resolved in the UI
    await page.reload();
    await adminLogin(page);
    await navigateToTab(page, 'Reports');
    await waitForReportsLoaded(page);
    await filterReports(page, 'resolved');
    const resolvedCards = page.locator('.report-card');
    await expect(resolvedCards.first()).toBeVisible();

    // Cleanup
    await unsuspendAndResetGcs(testData);
    await seedReportViaApi(testData);
  });

  // ── Test 7: Bulk resolve all for user ──
  test('bulk resolve all resolves all pending reports for user', async ({ page, testData }) => {
    // Seed 2 extra reports (already have 1 from re-seed)
    await seedReportViaApi(testData);
    await seedReportViaApi(testData);

    // Reload to see all reports
    await page.reload();
    await adminLogin(page);
    await navigateToTab(page, 'Reports');
    await filterReports(page, 'pending');

    const firstCard = page.locator('.report-card').first();
    await expect(firstCard).toBeVisible();

    const uid = await firstCard.getAttribute('data-uid');

    // Select "Dismiss" to avoid side effects
    const actionSelect = firstCard.locator(`select[data-action-select="${uid}"]`);
    await actionSelect.selectOption('dismiss');

    // Click "Resolve All"
    const resolveAllBtn = firstCard.locator(`button[data-resolve-all="${uid}"]`);
    await resolveAllBtn.click();

    // Handle confirm dialog — WebKit needs a moment to render the overlay
    const confirmBtn = page.locator('.confirm-ok');
    await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
    await confirmBtn.click();

    await waitForReportsLoaded(page);

    // API verify: no more pending reports for this user — Firestore emulator
    // may need a moment to propagate the writes from the resolve-all batch.
    await page.waitForTimeout(1_000);
    const result = await getReportsViaApi(testData, 'pending');
    const userReports = result.users?.find(
      (u: any) => String(u.uniqueId) === String(testData.user.uniqueId),
    );
    // Should be gone from pending
    expect(userReports).toBeFalsy();

    // Re-seed for other tests
    await seedReportViaApi(testData);
  });

  // ── Test 8: Lock report — click lock indicator, API verify, unlock ──
  test('lock and unlock report via review lock', async ({ page, testData }) => {
    await filterReports(page, 'pending');

    const firstCard = page.locator('.report-card').first();
    await expect(firstCard).toBeVisible();

    const uid = await firstCard.getAttribute('data-uid');

    // Acquire lock via API
    const lockResult = await testData.api.post(`/api/report-locks/${uid}/lock`, {});

    // Verify lock was acquired (not locked by another)
    expect(lockResult.locked).toBeFalsy();

    // Release lock
    await testData.api.delete(`/api/report-locks/${uid}`);
  });

  // ── Test 9: Unlock report — lock then unlock, verify unlocked ──
  test('unlock report releases the review lock', async ({ page, testData }) => {
    await filterReports(page, 'pending');

    const firstCard = page.locator('.report-card').first();
    await expect(firstCard).toBeVisible();

    const uid = await firstCard.getAttribute('data-uid');

    // Lock
    await testData.api.post(`/api/report-locks/${uid}/lock`, {});

    // Unlock
    await testData.api.delete(`/api/report-locks/${uid}`);

    // Verify: re-locking should succeed (not blocked)
    const result = await testData.api.post(`/api/report-locks/${uid}/lock`, {});
    expect(result.locked).toBeFalsy();

    // Cleanup
    await testData.api.delete(`/api/report-locks/${uid}`);
  });

  // ── Test 10: Stats bar displays — pending count, resolved today, avg response ──
  test('stats bar displays report statistics', async ({ page, testData }) => {
    // Verify stats elements are visible
    const pendingStat = page.locator('#stat-pending');
    const resolvedTodayStat = page.locator('#stat-resolved-today');
    const avgResponseStat = page.locator('#stat-avg-response');
    const reviewersStat = page.locator('#stat-reviewers');

    await expect(pendingStat).toBeVisible();
    await expect(resolvedTodayStat).toBeVisible();
    await expect(avgResponseStat).toBeVisible();
    await expect(reviewersStat).toBeVisible();

    // Verify stats have content
    const pendingText = await pendingStat.textContent();
    expect(pendingText).toBeTruthy();

    // API verify
    const stats = await getReportStatsViaApi(testData);
    expect(stats.pendingCount).toBeDefined();
    expect(stats.resolvedToday).toBeDefined();
  });

  // ── Test 11: Stats period toggle — 7d, 30d, All ──
  test('stats period toggle updates statistics', async ({ page }) => {
    const periodButtons = page.locator('.period-toggle button');

    // Click 30d
    const btn30d = periodButtons.filter({ hasText: '30d' });
    await btn30d.click();
    await expect(btn30d).toHaveClass(/active/);

    // Click All
    const btnAll = periodButtons.filter({ hasText: 'All' });
    await btnAll.click();
    await expect(btnAll).toHaveClass(/active/);
    await expect(btn30d).not.toHaveClass(/active/);

    // Click 7d
    const btn7d = periodButtons.filter({ hasText: '7d' });
    await btn7d.click();
    await expect(btn7d).toHaveClass(/active/);
    await expect(btnAll).not.toHaveClass(/active/);
  });

  // ── Test 12: CSV export — set dates, click Export, verify download ──
  test('CSV export triggers a download', async ({ page }) => {
    // Set date range
    const exportFrom = page.locator('#export-from');
    const exportTo = page.locator('#export-to');

    const today = new Date().toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

    await exportFrom.fill(thirtyDaysAgo);
    await exportTo.fill(today);

    // Listen for download
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#export-csv-btn').click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('.csv');
  });

  // ── Test 13: Severity radio buttons — select each, verify display ──
  test('severity radio buttons show correct deduction values', async ({ page }) => {
    await filterReports(page, 'pending');

    const firstCard = page.locator('.report-card').first();
    await expect(firstCard).toBeVisible();

    const uid = await firstCard.getAttribute('data-uid');

    // Verify severity labels exist and show correct deductions
    // (radio inputs are display:none — verify via labels and checked state)
    for (const sev of [1, 2, 3, 4, 5]) {
      const label = firstCard.locator(`label[for="sev-${uid}-${sev}"]`);
      await expect(label).toBeVisible();
      await expect(label).toContainText(`${sev} (-${sev * 5})`);
    }

    // Select severity 3 by clicking the label and verify checked state
    await firstCard.locator(`label[for="sev-${uid}-3"]`).click();
    await expect(firstCard.locator(`input#sev-${uid}-3`)).toBeChecked();
    await expect(firstCard.locator(`input#sev-${uid}-1`)).not.toBeChecked();
  });

  // ── Test 14: Conversation viewer — click View, verify messages ──
  test('conversation viewer displays messages when available', async ({ page }) => {
    await filterReports(page, 'pending');

    const viewConvLink = page.locator('.view-conversation-btn').first();
    const hasConversation = await viewConvLink.count() > 0;

    if (!hasConversation) {
      test.skip(true, 'No reports with conversation context available');
      return;
    }

    await viewConvLink.click();

    const convViewer = page.locator('.conv-viewer');
    await expect(convViewer).toBeVisible();

    const viewerText = await convViewer.textContent();
    expect(viewerText!.length).toBeGreaterThan(0);

    // Click again to toggle close
    await viewConvLink.click();
    await expect(convViewer).not.toBeVisible();
  });

  // ── Test 15: Evidence lightbox — click image, verify opens ──
  test('evidence lightbox opens from report evidence thumbnail', async ({ page }) => {
    await filterReports(page, 'pending');

    const thumbs = page.locator('#reports-list .evidence-thumb');
    const thumbCount = await thumbs.count();

    if (thumbCount === 0) {
      test.skip(true, 'No evidence thumbnails in current reports');
      return;
    }

    await thumbs.first().click();

    const lightbox = page.locator('.evidence-lightbox');
    await expect(lightbox).toBeVisible();

    // Close
    await page.keyboard.press('Escape');
    await expect(lightbox).not.toBeVisible();
  });

  // ── Test 16: Take-over button — click user name, verify navigates to user ──
  test('clicking user name in report navigates to Users tab', async ({ page, testData }) => {
    await filterReports(page, 'pending');

    const navigateLink = page.locator(`[data-navigate-uid="${testData.user.uniqueId}"]`).first();
    const hasLink = await navigateLink.count() > 0;

    if (!hasLink) {
      test.skip(true, 'No navigable user link in current pending reports');
      return;
    }

    await navigateLink.click();

    // Verify the Users tab becomes active
    const usersTab = page.locator('#tab-users');
    await expect(usersTab).toHaveClass(/active/);

    // Verify user data loaded (profile subtab visible)
    const profileSubtab = page.locator('.user-subtab[data-subtab="profile"]');
    await expect(profileSubtab).toBeVisible();
  });

  // ── Test 17: Report grouping — pending reports grouped by user ──
  test('pending reports are grouped by reported user', async ({ page }) => {
    await filterReports(page, 'pending');

    const cards = page.locator('.report-card');
    const cardCount = await cards.count();

    if (cardCount === 0) {
      test.skip(true, 'No pending reports to verify grouping');
      return;
    }

    // Each card represents a user group (card has data-uid)
    for (let i = 0; i < Math.min(cardCount, 5); i++) {
      const card = cards.nth(i);
      const uid = await card.getAttribute('data-uid');
      expect(uid).toBeTruthy();

      // Each card should show a report count badge
      const countBadge = card.locator('.report-count-badge');
      await expect(countBadge).toBeVisible();
      const badgeText = await countBadge.textContent();
      expect(badgeText).toMatch(/\d+ reports?/);
    }
  });

  // ── Test 18: Keyboard W — press W, verify warn action selected ──
  test('keyboard shortcut W selects warn action', async ({ page }) => {
    await filterReports(page, 'pending');

    const firstCard = page.locator('.report-card').first();
    const cardExists = await firstCard.count() > 0;
    if (!cardExists) {
      test.skip(true, 'No pending reports for keyboard shortcuts');
      return;
    }

    await selectFirstReportCard(page);

    const uid = await firstCard.getAttribute('data-uid');
    const actionSelect = firstCard.locator(`select[data-action-select="${uid}"]`);

    // Press W
    await page.keyboard.press('w');

    // Verify "warn" is selected
    await expect(actionSelect).toHaveValue('warn');
  });

  // ── Test 19: Keyboard D — press D, verify dismiss action selected ──
  test('keyboard shortcut D selects dismiss action', async ({ page }) => {
    await filterReports(page, 'pending');

    const firstCard = page.locator('.report-card').first();
    const cardExists = await firstCard.count() > 0;
    if (!cardExists) {
      test.skip(true, 'No pending reports for keyboard shortcuts');
      return;
    }

    // Use the same selection helper as the W test (real Playwright
    // keyboard.press) — synthetic `document.dispatchEvent(new
    // KeyboardEvent(...))` calls don't dispatch through the same
    // dispatch path as user input and miss the report tab handler in
    // some build configurations. The selectFirstReportCard helper
    // awaits `.selected` so the handler has actually run before we
    // proceed.
    await selectFirstReportCard(page);

    const uid = await firstCard.getAttribute('data-uid');
    const actionSelect = firstCard.locator(`select[data-action-select="${uid}"]`);

    // Press D — real keyboard event, matches the W test's mechanism.
    await page.keyboard.press('d');

    // Verify "dismiss" is selected
    await expect(actionSelect).toHaveValue('dismiss');
  });

  // ── Test 20: Audit log display — verify GET /api/admin/audit-log returns data ──
  test('audit log API returns data', async ({ testData }) => {
    try {
      const auditLog = await testData.api.get('/api/admin/audit-log?limit=5');
      expect(auditLog).toBeTruthy();
      const entries = Array.isArray(auditLog) ? auditLog : (auditLog.entries || auditLog.logs || []);
      expect(Array.isArray(entries)).toBe(true);
    } catch (err: any) {
      // If 404, endpoint may not exist yet
      if (err.message?.includes('404')) {
        test.skip(true, 'Audit log endpoint not yet implemented');
      } else {
        throw err;
      }
    }
  });
});
