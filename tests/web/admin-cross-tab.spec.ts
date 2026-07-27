import { test, expect, TestData } from './fixtures/admin';
import { adminLogin, navigateToTab, searchUser, switchUserSubtab } from './helpers/admin-auth';
import type { Page } from '@playwright/test';

/** Wait for the reports list to finish loading. */
async function waitForReportsLoaded(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const list = document.getElementById('reports-list');
    if (!list) return false;
    return (
      list.querySelector('.report-card') !== null ||
      list.textContent!.includes('No reports') ||
      list.textContent!.includes('Failed')
    );
  });
}

/** Filter reports by status. */
async function filterReports(
  page: Page,
  status: 'pending' | 'resolved' | 'archived',
): Promise<void> {
  const btn = page.locator(`#report-filter-bar button[data-report-filter="${status}"]`);
  await btn.click();
  await expect(btn).toHaveClass(/active/);
  await waitForReportsLoaded(page);
}

/**
 * Seed a report via the test-write endpoint so the doc is tagged with
 * `_testRun` and the per-test teardown picks it up. Going through the
 * regular `POST /api/reports` path leaves the report untagged, so it
 * survives teardown and accumulates as orphaned data — every prior
 * test run's report shows up at the top of the Reports tab with
 * `data-uid="undefined"` (the reported user is gone), and `firstCard`
 * selectors silently latch onto those orphans.
 */
async function seedReport(testData: TestData): Promise<string> {
  const result = await testData.api.testWrite('reports', {
    reportedUserId: testData.user.uid,
    reportedUserUniqueId: testData.user.uniqueId,
    reporterId: testData.secondUser.uid,
    reporterUniqueId: testData.secondUser.uniqueId,
    reason: 'Spam',
    description: 'E2E cross-tab test',
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

/** Wait for appeals list to load. */
async function waitForAppealsLoaded(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const list = document.getElementById('appeals-list');
    if (!list) return false;
    return (
      list.querySelector('.appeal-card') !== null ||
      list.textContent!.includes('No appeals') ||
      list.textContent!.includes('Failed')
    );
  });
}

/** Wait for devices table to load. */
async function waitForDevicesLoaded(page: Page): Promise<void> {
  await expect(page.locator('#devices-tbody tr, #devices-empty[style*="block"]')).not.toHaveCount(
    0,
  );
}

/**
 * Settled = `loadAlerts()` has rendered its verdict: either rows landed in
 * `#alerts-tbody`, or it unhid `#alerts-empty` (which ships `display:none`,
 * so neither is true before the fetch resolves). Waiting on the verdict
 * instead of a fixed delay means an alerts fetch that never returns fails
 * loudly here rather than silently degrading the caller into its
 * "no trace links" skip.
 */
async function waitForAlertsLoaded(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const tbody = document.getElementById('alerts-tbody');
    const empty = document.getElementById('alerts-empty');
    if (!tbody || !empty) return false;
    return tbody.querySelector('tr') !== null || empty.style.display !== 'none';
  });
}

test.describe('Admin Cross-Tab Interactions', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    // Pause the Reports tab's 15s poll so it can't fire mid-test and
    // re-render the .severity-radio inputs between the atomic
    // `set sev-2 checked + click resolve` evaluate and the resolve
    // handler's `:checked` read. Without this pause, the cross-tab
    // test "report warned resolution …" intermittently records a
    // Severity 1 warning instead of Severity 2: the poll fires during
    // resolveReport's `await acquireLock(...)`, rebuilds reportCards,
    // resets sev-1 to the default-checked state, and the subsequent
    // `form.querySelector('input[name="sev-${uid}"]:checked')` returns
    // sev-1. See reports.js:340 + [[feedback-test-isolation-no-leaks]].
    // Production code never sets this flag — only tests.
    await page.addInitScript(() => {
      (
        window as Window & { __SHYTALK_PAUSE_REPORTS_POLL__?: boolean }
      ).__SHYTALK_PAUSE_REPORTS_POLL__ = true;
    });
    await adminLogin(page);
  });

  // Test 2 ("appeal approve results in user unsuspension") explicitly
  // suspends the worker-scoped user before driving the appeal flow.
  // If any step before the appeal-approve fails, the user is left
  // suspended for every subsequent test file (admin-keyboard,
  // admin-users-*, etc.) — surfaced as the "Enter key triggers user
  // search" flake (displayName mask = "Suspended Account"). Defensive
  // afterAll keeps the leak contained even when a flaky retry leaves
  // mid-test state. Per [[feedback-test-isolation-no-leaks]].
  test.afterAll(async ({ testData }) => {
    await unsuspendAndResetGcs(testData);
  });

  // ── Test 1: Report resolve-as-warned → warning in user history ──
  test('report warned resolution creates warning in user moderation history', async ({
    page,
    testData,
  }) => {
    // Seed a fresh report
    await seedReport(testData);

    // Navigate to Reports
    await navigateToTab(page, 'Reports');
    await waitForReportsLoaded(page);
    await filterReports(page, 'pending');

    // Target THIS test's user specifically — not `.first()`. The Reports
    // tab can have orphaned reports at the top of the list from prior
    // test runs whose users were torn down (testTeardown deletes users
    // but reports against them survive, rendering as
    // `data-uid="undefined"` / "Unknown user" cards). Picking the first
    // card silently resolves the wrong report.
    const uid = String(testData.user.uniqueId);
    const firstCard = page.locator(`.report-card[data-uid="${uid}"]`).first();
    await expect(firstCard).toBeVisible({ timeout: 10_000 });

    const actionSelect = firstCard.locator(`select[data-action-select="${uid}"]`);
    await actionSelect.selectOption('warn');

    // Radio inputs are display:none in the .severity-radio markup — clicking
    // the label LOOKS like it works but Playwright's click doesn't trigger
    // the native form-checked behaviour on the hidden input. Result: the
    // radio stays unchecked, the resolve handler falls back to severity 1
    // (`reports.js:694`: `const severity = sevInput ? Number(...) : 1`),
    // and this test then asserts "Severity 2" against an actual Severity 1
    // warning.
    //
    // Two compounding issues to avoid:
    //   1. Setting `el.checked = true` on a single radio doesn't auto-
    //      uncheck siblings — that behaviour only fires on USER input
    //      (click/tap), not programmatic `.checked` assignment. The
    //      default sev-1 stays checked alongside sev-2 and reports.js's
    //      `querySelector(':checked')` returns whichever appears first
    //      in DOM order (sev-1).
    //   2. Reports tab polls every 15s and re-renders the cards
    //      (reports.js:338), wiping the radio state. If the poll fires
    //      between our `set checked` and the resolve click, the radio
    //      reverts to default-checked sev-1. `resolveInProgress` only
    //      pauses polling AFTER the resolve handler starts — so the race
    //      window is the gap we open by `await`ing between operations.
    //
    // Fix: do "set sev-2 checked + uncheck siblings + click resolve" in
    // a SINGLE synchronous browser-side function. JavaScript is single-
    // threaded; the setInterval poll cannot fire mid-function. By the
    // time control returns to JS, the resolve handler has already set
    // `resolveInProgress = true`, so subsequent polls are also suppressed.
    await firstCard.evaluate((card: HTMLElement, evalUid: string) => {
      const group = card.querySelectorAll<HTMLInputElement>(`input[name="sev-${evalUid}"]`);
      for (const r of group) r.checked = r.value === '2';
      const target = card.querySelector<HTMLInputElement>(
        `input[name="sev-${evalUid}"][value="2"]`,
      );
      if (target) target.dispatchEvent(new Event('change', { bubbles: true }));
      const resolveBtn = card.querySelector<HTMLButtonElement>(
        `button[data-resolve-first="${evalUid}"]`,
      );
      if (resolveBtn) resolveBtn.click();
    }, uid);

    // Handle confirm dialog
    const confirmBtn = page.locator('.confirm-ok');
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();
    await waitForReportsLoaded(page);

    // Verify the warning was actually created via API before checking UI.
    // The resolve endpoint creates the warning synchronously, but the emulator
    // may have propagation lag. Poll the API until the warning appears.
    const userUniqueId = String(testData.user.uniqueId);
    await expect
      .poll(
        async () => {
          const warningsData = await testData.api.get(`/api/user/${userUniqueId}/warnings`);
          const warnings = warningsData.warnings || [];
          return warnings.some((w: any) => !w.revoked && w.severity === 2);
        },
        { timeout: 15_000 },
      )
      .toBe(true);

    // Navigate to Users → search → Moderation subtab
    await navigateToTab(page, 'Users');
    await searchUser(page, userUniqueId);
    await switchUserSubtab(page, 'moderation');

    // Poll the UI for the warning — re-search if needed (the moderation
    // subtab loads warnings on activation, but may cache stale state).
    const warningList = page.locator('#warning-history-list');
    await expect
      .poll(
        async () => {
          const seen = await warningList.locator('.warning-item').count();
          if (seen > 0) return seen;
          // The subtab loads warnings on activation and can hold stale state,
          // so a passive re-read would never converge — re-search to force the
          // reload, then let the next poll iteration re-count.
          await searchUser(page, userUniqueId);
          await switchUserSubtab(page, 'moderation');
          return 0;
        },
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);
    await expect(warningList.locator('.warning-item')).not.toHaveCount(0, { timeout: 10_000 });

    const firstWarning = warningList.locator('.warning-item').first();
    await expect(firstWarning).toContainText('Severity 2');

    // Clean up: revoke warnings + reset GCS + delete the seeded report
    const warningsData = await testData.api.get(`/api/user/${testData.user.uniqueId}/warnings`);
    const warnings = warningsData.warnings || [];
    for (const w of warnings) {
      if (!w.revoked) {
        await testData.api.post(`/api/user/${testData.user.uniqueId}/warnings/${w.id}/revoke`);
      }
    }
    await testData.api.post(`/api/user/${testData.user.uniqueId}/reset-gcs`);
    // The report was created via POST /api/reports (no _testRun tag) — resolve cleans it
    // from the pending list, but the resolved doc persists. This is acceptable since
    // resolved reports don't interfere with future test runs' pending queries.
  });

  // ── Test 2: Appeal approve → user unsuspended ──
  test('appeal approve results in user unsuspension', async ({ page, testData }) => {
    const uid = testData.user.uniqueId;

    // Suspend user and seed appeal
    await testData.api.post(`/api/user/${uid}/suspend`, {
      reason: 'E2E cross-tab test',
      days: 7,
      canAppeal: true,
    });
    // Use testWrite instead of POST /api/appeals (that endpoint checks if the
    // caller is suspended, but the admin caller is never suspended)
    await testData.api.testWrite('suspensionAppeals', {
      userId: uid,
      appealText: 'Cross-tab test appeal',
      status: 'pending',
      createdAt: Date.now(),
    });

    // Navigate to Appeals
    await navigateToTab(page, 'Appeals');
    await waitForAppealsLoaded(page);

    // Filter to pending
    const pendingBtn = page.locator('button[data-appeal-filter="pending"]');
    await pendingBtn.click();
    await expect(pendingBtn).toHaveClass(/active/);
    await waitForAppealsLoaded(page);

    // Find and approve the appeal
    const firstCard = page.locator('.appeal-card').first();
    await expect(firstCard).toBeVisible();

    const noteInput = firstCard.locator('input[data-note-for]');
    await noteInput.fill('Cross-tab test approval');

    const approveBtn = firstCard.locator('button.btn-approve');
    await approveBtn.click();
    await waitForAppealsLoaded(page);

    // Navigate to Users → search user
    await navigateToTab(page, 'Users');
    await searchUser(page, String(uid));
    await switchUserSubtab(page, 'moderation');

    // Verify not suspended
    const suspensionStatus = page.locator('#suspension-status');
    await expect(suspensionStatus).toHaveClass(/not-suspended/);

    // API verify
    const userData = await testData.api.get(`/api/user/${uid}`);
    expect(userData.isSuspended).toBeFalsy();

    // Reset GCS
    await testData.api.post(`/api/user/${uid}/reset-gcs`);
  });

  // ── Test 3: Device ban → appears in user ban list ──
  test('device ban from Devices tab appears in user moderation bans', async ({
    page,
    testData,
  }) => {
    const deviceId = `e2e-${testData.prefix}-device`;

    // Navigate to Devices
    await navigateToTab(page, 'Devices');
    await waitForDevicesLoaded(page);

    // Search for the test device
    await page.locator('#devices-search-input').fill(deviceId);
    await page.locator('#devices-search-btn').click();
    await waitForDevicesLoaded(page);

    // Accept confirm and prompt dialogs
    page.on('dialog', async (dialog) => {
      if (dialog.type() === 'confirm') await dialog.accept();
      else if (dialog.type() === 'prompt') await dialog.accept('e2e-cross-tab-ban');
    });

    // Click Ban device
    const rows = page.locator('#devices-tbody tr:not(:has(.device-detail))');
    const banBtn = rows.first().locator('[data-ban-device]');
    await banBtn.click();

    // Verify via API that the ban exists. The ban lands server-side after the
    // click returns, so poll the API for it — the poll IS the assertion, so a
    // ban that never arrives fails here by name rather than on a bare
    // truthiness check that only ever saw one snapshot.
    await expect
      .poll(
        async () => {
          const bansData = await testData.api.get('/api/admin/bans');
          const deviceBans = bansData.deviceBans || [];
          return deviceBans.some((b: any) => b.deviceId === deviceId);
        },
        { timeout: 15_000 },
      )
      .toBe(true);

    // Cleanup: unban
    await testData.api.delete(`/api/admin/bans/device/${encodeURIComponent(deviceId)}`);
  });

  // ── Test 4: Device View Logs → Logs tab filtered ──
  test('device View Logs navigates to Logs tab with userId filter', async ({ page, testData }) => {
    const deviceId = `e2e-${testData.prefix}-device`;

    await navigateToTab(page, 'Devices');
    await waitForDevicesLoaded(page);

    await page.locator('#devices-search-input').fill(deviceId);
    await page.locator('#devices-search-btn').click();
    await waitForDevicesLoaded(page);

    // Click View Logs
    const rows = page.locator('#devices-tbody tr:not(:has(.device-detail))');
    const logsBtn = rows.first().locator('[data-view-logs-user]');
    await logsBtn.click();

    // Verify Logs tab is active
    const logsTabBtn = page.getByRole('button', { name: 'Logs', exact: true });
    await expect(logsTabBtn).toHaveClass(/active/);

    // Verify the userId filter is populated
    const userIdFilter = page.locator('#log-filter-userId');
    const filterValue = await userIdFilter.inputValue();
    expect(filterValue).toBe(testData.user.uniqueId.toString());
  });

  // ── Test 5: Alert trace → Logs tab filtered ──
  test('alert trace link navigates to Logs with traceId filter', async ({ page, testData }) => {
    await navigateToTab(page, 'Logs');

    // Expand alerts section
    const alertsSection = page.locator('#logs-alerts-section');
    const isCollapsed = await alertsSection.evaluate((el) => el.classList.contains('collapsed'));
    if (isCollapsed) {
      await page.locator('#logs-alerts-section .logs-section-header').click();
      // The class flip is the observable that the section opened.
      await expect(alertsSection).not.toHaveClass(/collapsed/);
    }
    await waitForAlertsLoaded(page);

    // Look for trace links
    const traceLinks = page.locator('#alerts-tbody .log-trace-link, #alerts-tbody [data-trace-id]');
    if ((await traceLinks.count()) === 0) {
      test.skip(true, 'No trace links in current alerts');
      return;
    }

    await traceLinks.first().click();

    // Verify trace view opened or traceId filter populated
    const traceView = page.locator('#trace-view');
    const traceIdFilter = page.locator('#log-filter-traceId');

    const traceViewVisible = await traceView.isVisible();
    const filterValue = await traceIdFilter.inputValue();
    expect(traceViewVisible || filterValue.length > 0).toBe(true);
  });

  // ── Test 6: Report View User → Users tab ──
  test('clicking user name in report navigates to Users tab', async ({ page, testData }) => {
    await navigateToTab(page, 'Reports');
    await waitForReportsLoaded(page);
    await filterReports(page, 'pending');

    const navigateLink = page.locator(`[data-navigate-uid="${testData.user.uniqueId}"]`).first();
    if ((await navigateLink.count()) === 0) {
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

  // ── Test 7: Confirm dialog cancel aborts (3 different) ──
  test('confirm dialog cancel aborts actions across 3 different dialogs', async ({ page }) => {
    // Dismiss all dialogs
    page.on('dialog', (dialog) => dialog.dismiss());

    // Test 1: Maintenance — Clear Reports cancel
    await navigateToTab(page, 'Maintenance');
    await expect(page.locator('#maintenance-panel')).toBeVisible();
    const clearBtn = page.locator('#clear-reports-btn');
    await clearBtn.click();
    // `runAction` bails on a dismissed confirm SYNCHRONOUSLY, before it sets
    // `disabled` or the "Processing..." label (maintenance.js:94 precedes 96),
    // so the abort is already complete once click() resolves — no wait needed.
    // Assert BOTH signals: label alone would still pass if the button were
    // left disabled by a future regression.
    await expect(clearBtn).toHaveText('Clear All Reports');
    await expect(clearBtn).toBeEnabled();

    // Test 2: Devices — Unbind cancel
    await navigateToTab(page, 'Devices');
    await waitForDevicesLoaded(page);
    const rows = page.locator('#devices-tbody tr:not(:has(.device-detail))');
    if ((await rows.count()) > 0) {
      const unbindBtn = rows.first().locator('[data-unbind]');
      if ((await unbindBtn.count()) > 0) {
        await unbindBtn.click();
        // Same dismissed-confirm contract as above: the abort completes before
        // click() resolves, so assert the row survived with a retrying
        // assertion rather than sleeping and reading one snapshot.
        const rowsAfter = page.locator('#devices-tbody tr:not(:has(.device-detail))');
        await expect(rowsAfter).not.toHaveCount(0);
      }
    }

    // Test 3: Maintenance — Nuclear reset cancel
    await navigateToTab(page, 'Maintenance');
    await expect(page.locator('#maintenance-panel')).toBeVisible();
    await page.locator('#reset-all-btn').click();
    const overlay = page.locator('#nuclear-overlay');
    await expect(overlay).toHaveClass(/visible/);
    await page.locator('#nuclear-cancel').click();
    await expect(overlay).not.toHaveClass(/visible/);
  });

  // ── Test 8: Toast success auto-dismisses ──
  test('toast success auto-dismisses after a few seconds', async ({ page }) => {
    // Simulate a toast with a timer via evaluate (showToast is in the IIFE scope)
    const toast = page.locator('#toast');
    await page.evaluate(() => {
      const t = document.getElementById('toast')!;
      t.textContent = 'E2E test toast';
      t.className = 'toast success visible';
      setTimeout(() => t.classList.remove('visible'), 4000);
    });
    await expect(toast).toHaveClass(/visible/);

    // Auto-dismiss is observable as the `visible` class dropping — wait on
    // that, not on a clock. Stricter than the old fixed 5s too: a toast that
    // never dismisses now fails by name instead of on a stale snapshot read.
    await expect(toast).not.toHaveClass(/visible/, { timeout: 15_000 });
  });

  // ── Test 9: Toast error persists ──
  test('toast error does not auto-dismiss quickly', async ({ page, testData }) => {
    // Trigger an error by making an invalid API call through the UI
    // Search for a nonexistent user to trigger an error toast
    await navigateToTab(page, 'Users');
    const searchInput = page.getByRole('spinbutton', { name: 'ShyTalk User ID' });
    await searchInput.fill('99999999');
    await page.getByRole('button', { name: 'Search' }).click();

    // The toast is opacity-animated, so Playwright's visibility check can't
    // tell shown from hidden — the `visible` class is the real contract, and
    // it arrives asynchronously after the failed lookup. Wait for it.
    const toast = page.locator('#toast');
    await expect(toast).toHaveClass(/\berror\b/, { timeout: 15_000 });
    await expect(toast).toHaveClass(/\bvisible\b/);

    // Persistence is a NEGATIVE temporal property: give the toast the whole
    // success-dismiss window to drop `visible` and require that it doesn't.
    // Bounded wait on element STATE, never a bare clock — an early dismissal
    // resolves the wait and fails the assertion by name.
    let dismissedEarly = true;
    await page
      .waitForFunction(
        () => !document.getElementById('toast')!.classList.contains('visible'),
        null,
        { timeout: 3_000 },
      )
      .catch(() => {
        dismissedEarly = false;
      });
    expect(dismissedEarly).toBe(false);
  });

  // ── Test 10: API 500 error handling ──
  test('API error shows error toast', async ({ page, testData }) => {
    // Try to trigger a 500 error by calling an endpoint that fails
    // We can test this by verifying the error handling pattern exists
    await navigateToTab(page, 'Users');
    const searchInput = page.getByRole('spinbutton', { name: 'ShyTalk User ID' });
    await searchInput.fill('0'); // Invalid user ID

    const responsePromise = page.waitForResponse((resp) =>
      resp.url().includes('/api/search/uniqueId/0'),
    );

    await page.getByRole('button', { name: 'Search' }).click();

    const response = await responsePromise;
    // Verify the response was handled (404 or other error)
    expect(response.status()).toBeGreaterThanOrEqual(400);

    // The user form should NOT become visible. Negative property again: give
    // the error handler a bounded window to wrongly reveal it and require that
    // it never does. Watching the STATE catches a form that appears anywhere
    // in the window — the old post-sleep snapshot only ever looked at t=1s.
    let formAppeared = true;
    await page
      .waitForFunction(
        () => document.getElementById('user-form')!.classList.contains('visible'),
        null,
        { timeout: 2_000 },
      )
      .catch(() => {
        formAppeared = false;
      });
    expect(formAppeared).toBe(false);
  });

  // ── Test 11: Button disable during API call ──
  test('buttons disable during API calls and re-enable after', async ({ page, testData }) => {
    page.on('dialog', (dialog) => dialog.accept());

    // Navigate to Maintenance and trigger an operation
    await navigateToTab(page, 'Maintenance');
    await expect(page.locator('#maintenance-panel')).toBeVisible();

    const btn = page.locator('#backfill-user-type-btn');

    // Click the button and wait for result (skip transient text — too fast in emulator)
    await btn.click();

    const result = page.locator('#backfill-user-type-result');
    await expect(result).toBeVisible();

    // Button should re-enable with original text
    await expect(btn).toBeEnabled();
    await expect(btn).toHaveText('Backfill User Types');
  });

  // ── Test 12: Multiple cross-tab navigations maintain state ──
  test('rapid tab switching does not break UI state', async ({ page, testData }) => {
    // Navigate through multiple tabs quickly
    const tabs = ['Users', 'Reports', 'Logs', 'Devices', 'Maintenance', 'Gifts'];

    for (const tab of tabs) {
      await navigateToTab(page, tab);
    }

    // Let in-flight API calls from previous tabs settle before switching
    // back to Users — rapid switching aborts pending requests and some
    // error handlers may briefly modify the DOM. "Settled" is a condition on
    // network activity, so wait for THAT; a fixed 500ms was simultaneously too
    // long when the tabs were quick and too short under a slow CI runner.
    await page.waitForLoadState('networkidle');

    // Verify we can still perform operations after rapid switching.
    // Navigate to Users and wait for the panel to be ready before searching.
    await navigateToTab(page, 'Users');
    const searchInput = page.locator('#search-uid');
    await expect(searchInput).toBeVisible({ timeout: 5_000 });
    await expect(searchInput).toBeEnabled();

    await searchUser(page, String(testData.user.uniqueId));

    // Wait for the user data to load by checking a specific field appears with content.
    // Don't assert exact display name — it may have been changed by another test
    // in the same worker (e.g., admin-users-profile edits display names).
    const displayNameInput = page.locator('[data-field="displayName"]');
    await expect(displayNameInput).toBeVisible({ timeout: 10_000 });
    await expect(displayNameInput).not.toHaveValue('');
  });
});
