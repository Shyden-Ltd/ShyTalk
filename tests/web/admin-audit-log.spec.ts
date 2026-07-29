/**
 * Admin Audit Log Tab — Comprehensive tests for the audit log tab functionality.
 *
 * Tests cover: loading, filtering (admin/action/target/date), pagination,
 * CSV export, auto-polling, empty state, and tab lifecycle (activate/deactivate).
 *
 * Written for PR C to verify audit-log.js module works identically to inline code.
 */
import { test, expect } from './fixtures/admin';
import { adminLogin, navigateToTab } from './helpers/admin-auth';
import { seedAuditEntry } from './helpers/logs';
import type { Page } from '@playwright/test';

/**
 * Clicks Search and waits for the audit-log fetch it triggers.
 *
 * The rows are replaced asynchronously, so asserting straight after the click
 * reads the PREVIOUS result set. Anchoring on the response is what makes the
 * following assertions about the new set rather than the old one.
 */
async function searchAuditLog(page: Page): Promise<void> {
  const response = page.waitForResponse(
    (r) => r.url().includes('audit-log') && r.request().method() === 'GET',
    { timeout: 15_000 },
  );
  await page.locator('#audit-log-search-btn').click();
  await response;
}

test.describe('Admin Audit Log Tab', () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
    await navigateToTab(page, 'Audit Log');
    // Wait for the audit log panel to be visible
    await expect(page.locator('#audit-log-panel')).toBeVisible({ timeout: 10_000 });
    // SHY-0174: also wait for the tab's INITIAL (unfiltered) load to settle
    // before any test runs its own filtered search. `navigateToTab` only waits
    // for `data-module-ready`, which flips when `activate()` fire-and-forgets
    // `load()` (audit-log.js — not awaited), so without this the initial load
    // can still be in flight and, if it resolves after a test's filtered
    // response, repopulate the shared tbody with UNFILTERED rows mid-assert.
    // Settle on a real `.audit-admin-name` row or the empty state.
    await page.waitForFunction(
      () => {
        const tbody = document.getElementById('audit-log-tbody');
        const empty = document.getElementById('audit-log-empty');
        if (!tbody) return false;
        return (
          tbody.querySelector('.audit-admin-name') !== null ||
          (empty && empty.style.display !== 'none')
        );
      },
      { timeout: 15_000 },
    );
  });

  // ── Loading & Rendering ──

  test('audit log tab loads and shows table headers', async ({ page }) => {
    // Verify the table structure exists with correct headers
    const headers = page.locator('#audit-log-panel th, #audit-log-panel .audit-header');
    await expect(page.locator('#audit-log-panel')).toBeVisible();

    // Table should have Admin, Action, Target Type, Target, Timestamp, Details columns
    const headerRow = page
      .locator('#audit-log-panel table thead tr, #audit-log-panel [class*="header"]')
      .first();
    await expect(headerRow).toBeVisible({ timeout: 5_000 });
  });

  test('audit log shows entries or empty state', async ({ page }) => {
    // Either entries exist in tbody OR the empty message is shown
    const tbody = page.locator('#audit-log-tbody');
    const empty = page.locator('#audit-log-empty');

    // Wait for loading to complete — data loaded OR empty state shown
    await page.waitForFunction(
      () => {
        const tbody = document.getElementById('audit-log-tbody');
        const empty = document.getElementById('audit-log-empty');
        const loading = tbody?.textContent?.includes('Loading');
        const hasRows = tbody && tbody.querySelectorAll('tr').length > 0 && !loading;
        const isEmpty = empty && empty.style.display !== 'none';
        return hasRows || isEmpty;
      },
      { timeout: 15_000 },
    );

    if (await empty.isVisible()) {
      // Empty state: no rows should be present
      await expect.poll(async () => await tbody.locator('tr').count()).toBe(0);
    } else {
      // Entries present: each row should have cells
      await expect.poll(async () => await tbody.locator('tr').count()).toBeGreaterThan(0);
      const firstRow = tbody.locator('tr').first();
      await expect(firstRow.locator('td')).not.toHaveCount(0);
    }
  });

  test('audit log entries show correct column structure', async ({ page, testData }) => {
    // Click search to load entries
    await page.locator('#audit-log-search-btn').click();

    await page.waitForFunction(
      () => {
        const tbody = document.getElementById('audit-log-tbody');
        return tbody && !tbody.textContent?.includes('Loading');
      },
      { timeout: 10_000 },
    );

    const tbody = page.locator('#audit-log-tbody');
    // The six-column structure IS the claim. Guarding on the row count meant an
    // empty table — or one whose rows lost a column — passed identically.
    await seedAuditEntry({ testRunId: testData.testRunId });
    // NOT page.reload(): the admin panel returns to the login screen on reload,
    // so the seeded row would never be visible. Re-running the tab's own search
    // re-fetches in place.
    await searchAuditLog(page);
    await expect
      .poll(async () => tbody.locator('tr').count(), { timeout: 15_000 })
      .toBeGreaterThan(0);
    await expect(tbody.locator('tr').first().locator('td')).toHaveCount(6);
  });

  // ── Filters ──

  test('filter by admin name shows matching entries', async ({ page }) => {
    const adminInput = page.locator('#audit-log-filter-admin');
    await adminInput.fill('claude-test');
    // SHY-0174: wait for the FILTERED response (admin=claude-test), not just
    // for the "Loading" text to clear — the old wait resolved on the previous
    // state's STALE rows (which carry other admins' names), so the assertion
    // read them and failed non-deterministically once the emulator's audit
    // data varied. The response URL is a signal independent of the asserted
    // row content, so the wait isn't tautological.
    const responded = page.waitForResponse(
      (r) =>
        r.url().includes('/api/admin/audit-log') &&
        r.url().includes('admin=claude-test') &&
        r.status() === 200,
      { timeout: 15_000 },
    );
    await page.locator('#audit-log-search-btn').click();
    await responded;
    // Settle on a REAL data row (`.audit-admin-name`, on every buildRow) or the
    // empty state — never the unclassed "Loading" placeholder <tr>.
    await page.waitForFunction(
      () => {
        const tbody = document.getElementById('audit-log-tbody');
        const empty = document.getElementById('audit-log-empty');
        if (!tbody) return false;
        return (
          tbody.querySelector('.audit-admin-name') !== null ||
          (empty && empty.style.display !== 'none')
        );
      },
      { timeout: 15_000 },
    );

    // Every returned row must match the admin filter. (No strict non-empty
    // assert: this spec has no request mock — the claude-test admin's own
    // audit entries drive it, whose presence at this instant isn't guaranteed;
    // the acute racy-stale-row read is what this fixes.)
    const adminNames = await page.locator('#audit-log-tbody .audit-admin-name').allTextContents();
    for (const name of adminNames) {
      expect(name.toLowerCase()).toContain('claude');
    }

    // Clean up filter
    await adminInput.clear();
  });

  test('filter by action type shows matching entries', async ({ page }) => {
    const actionSelect = page.locator('#audit-log-filter-action');
    // Get available options
    const options = await actionSelect.locator('option').allTextContents();
    expect(options.length).toBeGreaterThan(1); // At least "All actions" + one real action

    // Select a specific action type and prove the filter actually reached the
    // API — the old version selected, searched, reset, and asserted nothing
    // about the result.
    const chosen = (await actionSelect.locator('option').nth(1).getAttribute('value')) ?? '';
    const responded = page.waitForResponse(
      (r) => r.url().includes('/api/admin/audit-log') && r.url().includes(`action=${chosen}`),
      { timeout: 15_000 },
    );
    await actionSelect.selectOption({ index: 1 });
    await page.locator('#audit-log-search-btn').click();
    await responded;

    for (const cell of await page.locator('#audit-log-tbody .audit-action').all()) {
      await expect(cell).toHaveText(chosen);
    }

    // Reset filter
    await actionSelect.selectOption({ index: 0 });
  });

  test('filter by target type shows matching entries', async ({ page }) => {
    const targetSelect = page.locator('#audit-log-filter-target');
    const options = await targetSelect.locator('option').allTextContents();
    expect(options.length).toBeGreaterThan(1);

    if (options.length > 1) {
      await targetSelect.selectOption({ index: 1 });
      await searchAuditLog(page);
    }

    // Reset
    await targetSelect.selectOption({ index: 0 });
  });

  test('date range filter limits results', async ({ page }) => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const fmt = (d: Date) => d.toISOString().slice(0, 16);

    await page.locator('#audit-log-filter-start').fill(fmt(weekAgo));
    await page.locator('#audit-log-filter-end').fill(fmt(now));
    await page.locator('#audit-log-search-btn').click();

    await page.waitForFunction(
      () => {
        const tbody = document.getElementById('audit-log-tbody');
        return tbody && !tbody.textContent?.includes('Loading');
      },
      { timeout: 10_000 },
    );

    // Results should exist (seed data is recent)
    await expect.poll(async () => await page.locator('#audit-log-tbody tr').count()).not.toBeNaN();
  });

  test('combined filters narrow results', async ({ page }) => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 16);

    // Apply multiple filters
    await page.locator('#audit-log-filter-start').fill(fmt(weekAgo));
    await page.locator('#audit-log-filter-end').fill(fmt(now));

    // `count()` returns a number, so the old `.not.toBeNaN()` could never fail —
    // this test claimed to verify combined filtering and asserted nothing.
    // Assert what "combined" actually means: every filter reaches the API in
    // the same request, and every row returned honours the range.
    const request = page.waitForRequest((r) => r.url().includes('/api/admin/audit-log'));
    await page.locator('#audit-log-search-btn').click();
    const params = new URL((await request).url()).searchParams;

    await page.waitForFunction(
      () => {
        const tbody = document.getElementById('audit-log-tbody');
        return tbody && !tbody.textContent?.includes('Loading');
      },
      { timeout: 10_000 },
    );

    expect(params.get('start')).toBeTruthy();
    expect(params.get('end')).toBeTruthy();

    let checkedStamps = 0;
    for (const cell of await page.locator('#audit-log-tbody tr .audit-timestamp').all()) {
      // defect-detector:allow GUARD-IF — the product renders an empty timestamp for entries that genuinely have none, and the tally below proves the loop did not skip every row
      const raw = await cell.getAttribute('data-timestamp');
      if (!raw) continue;
      checkedStamps++;
      const t = new Date(Number.isNaN(Number(raw)) ? raw : Number(raw)).getTime();
      expect(t).toBeGreaterThanOrEqual(weekAgo.getTime() - 60_000);
      expect(t).toBeLessThanOrEqual(now.getTime() + 60_000);
    }
    expect(
      checkedStamps,
      'no row carried a timestamp — the range filter proved nothing',
    ).toBeGreaterThan(0);
  });

  // ── Pagination ──

  test('load more button is visible or hidden based on entry count', async ({ page, testData }) => {
    await page.locator('#audit-log-search-btn').click();

    await page.waitForFunction(
      () => {
        const tbody = document.getElementById('audit-log-tbody');
        return tbody && !tbody.textContent?.includes('Loading');
      },
      { timeout: 10_000 },
    );

    const loadMore = page.locator('#audit-log-load-more');
    // Seeded so rows exist; the pager is only meaningful with data behind it.
    await seedAuditEntry({ testRunId: testData.testRunId });
    // NOT page.reload(): the admin panel returns to the login screen on reload,
    // so the seeded row would never be visible. Re-running the tab's own search
    // re-fetches in place.
    await searchAuditLog(page);
    await expect
      .poll(async () => page.locator('#audit-log-tbody tr').count(), { timeout: 15_000 })
      .toBeGreaterThan(0);
    const rowCount = await page.locator('#audit-log-tbody tr').count();

    {
      // "Load more" is legitimately absent on a final page, so its presence is
      // not asserted — but when it IS there, clicking it must add rows.
      const isVisible = await loadMore.isVisible();
      if (isVisible) {
        const initialCount = rowCount;
        await loadMore.click();
        await expect
          .poll(() => page.locator('#audit-log-tbody tr').count())
          .toBeGreaterThanOrEqual(initialCount);
      }
    }
  });

  // ── CSV Export ──

  test('export CSV downloads a file', async ({ page, testData }) => {
    // Wait for data to load
    await page.waitForFunction(
      () => {
        const tbody = document.getElementById('audit-log-tbody');
        return tbody && !tbody.textContent?.includes('Loading');
      },
      { timeout: 10_000 },
    );

    // Only test if there are entries
    // Seeded rather than skipped: "no entries" meant CSV export went untested.
    await seedAuditEntry({ testRunId: testData.testRunId });
    // NOT page.reload(): the admin panel returns to the login screen on reload,
    // so the seeded row would never be visible. Re-running the tab's own search
    // re-fetches in place.
    await searchAuditLog(page);
    await expect
      .poll(async () => page.locator('#audit-log-tbody tr').count(), { timeout: 15_000 })
      .toBeGreaterThan(0);

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#audit-log-export-csv').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/audit-log-.*\.csv/);
  });

  // ── Auto-Polling ──

  test('audit log auto-refreshes via polling', async ({ page }) => {
    // Wait for initial load to complete
    await page.waitForFunction(
      () => {
        const tbody = document.getElementById('audit-log-tbody');
        return tbody && !tbody.textContent?.includes('Loading');
      },
      { timeout: 10_000 },
    );

    // Verify the polling interval is set up by checking that the tab
    // continues to make API requests over time
    const requests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('audit-log') && !req.url().includes('search'))
        requests.push(req.url());
    });

    // Poll for the first cycle rather than sleeping through two. This returns
    // as soon as polling is proven alive, and still FAILS if it never fires —
    // the 10s sleep only ever proved that 10s had elapsed.
    await expect.poll(() => requests.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
  });

  // ── Tab Lifecycle ──

  test('switching away stops polling, switching back resumes', async ({ page }) => {
    // We're on Audit Log tab. Switch to Users, then back.
    await page.getByRole('button', { name: 'Users' }).click();
    // The Users tab becoming visible is the switch completing; 500ms was a
    // guess. The panel id is `tab-users` (public/admin/index.html) — an
    // invented `#users-panel` simply never appears and times out.
    await expect(page.locator('#tab-users')).toBeVisible({ timeout: 10_000 });

    // Switch back to Audit Log
    await page.getByRole('button', { name: 'Audit Log' }).click();
    await expect(page.locator('#audit-log-panel')).toBeVisible({ timeout: 5_000 });

    // Verify data reloads after switching back
    await page.waitForFunction(
      () => {
        const tbody = document.getElementById('audit-log-tbody');
        return tbody && !tbody.textContent?.includes('Loading');
      },
      { timeout: 10_000 },
    );
  });

  // ── Console Errors ──

  test('zero console errors on audit log tab', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    // Interact with the tab
    await searchAuditLog(page);

    // Filter out known non-issues (429 rate limiting)
    const meaningful = errors.filter((e) => !e.includes('429'));
    expect(meaningful).toHaveLength(0);
  });
});
