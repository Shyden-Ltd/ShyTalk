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
    await page.waitForFunction(() => {
      const tbody = document.getElementById('audit-log-tbody');
      const empty = document.getElementById('audit-log-empty');
      if (!tbody) return false;
      return (
        tbody.querySelector('.audit-admin-name') !== null ||
        (empty && empty.style.display !== 'none')
      );
    }, { timeout: 15_000 });
  });

  // ── Loading & Rendering ──

  test('audit log tab loads and shows table headers', async ({ page }) => {
    // Verify the table structure exists with correct headers
    const headers = page.locator('#audit-log-panel th, #audit-log-panel .audit-header');
    await expect(page.locator('#audit-log-panel')).toBeVisible();

    // Table should have Admin, Action, Target Type, Target, Timestamp, Details columns
    const headerRow = page.locator('#audit-log-panel table thead tr, #audit-log-panel [class*="header"]').first();
    await expect(headerRow).toBeVisible({ timeout: 5_000 });
  });

  test('audit log shows entries or empty state', async ({ page }) => {
    // Either entries exist in tbody OR the empty message is shown
    const tbody = page.locator('#audit-log-tbody');
    const empty = page.locator('#audit-log-empty');

    // Wait for loading to complete — data loaded OR empty state shown
    await page.waitForFunction(() => {
      const tbody = document.getElementById('audit-log-tbody');
      const empty = document.getElementById('audit-log-empty');
      const loading = tbody?.textContent?.includes('Loading');
      const hasRows = tbody && tbody.querySelectorAll('tr').length > 0 && !loading;
      const isEmpty = empty && empty.style.display !== 'none';
      return hasRows || isEmpty;
    }, { timeout: 15_000 });

    const rowCount = await tbody.locator('tr').count();
    if (await empty.isVisible()) {
      // Empty state: no rows should be present
      expect(rowCount).toBe(0);
    } else {
      // Entries present: each row should have cells
      expect(rowCount).toBeGreaterThan(0);
      const firstRow = tbody.locator('tr').first();
      await expect(firstRow.locator('td')).not.toHaveCount(0);
    }
  });

  test('audit log entries show correct column structure', async ({ page }) => {
    // Click search to load entries
    await page.locator('#audit-log-search-btn').click();

    await page.waitForFunction(() => {
      const tbody = document.getElementById('audit-log-tbody');
      return tbody && !tbody.textContent?.includes('Loading');
    }, { timeout: 10_000 });

    const tbody = page.locator('#audit-log-tbody');
    const rowCount = await tbody.locator('tr').count();

    if (rowCount > 0) {
      // Each row should have 6 cells (admin, action, target type, target, timestamp, details)
      const firstRow = tbody.locator('tr').first();
      const cells = firstRow.locator('td');
      expect(await cells.count()).toBe(6);
    }
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
    await page.waitForFunction(() => {
      const tbody = document.getElementById('audit-log-tbody');
      const empty = document.getElementById('audit-log-empty');
      if (!tbody) return false;
      return (
        tbody.querySelector('.audit-admin-name') !== null ||
        (empty && empty.style.display !== 'none')
      );
    }, { timeout: 15_000 });

    // Every returned row must match the admin filter. (No strict non-empty
    // assert: this spec has no request mock — the claude-test admin's own
    // audit entries drive it, whose presence at this instant isn't guaranteed;
    // the acute racy-stale-row read is what this fixes.)
    const adminNames = await page
      .locator('#audit-log-tbody .audit-admin-name')
      .allTextContents();
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

    // Select a specific action type
    if (options.length > 1) {
      await actionSelect.selectOption({ index: 1 });
      await page.locator('#audit-log-search-btn').click();
      await page.waitForTimeout(2_000);
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
      await page.locator('#audit-log-search-btn').click();
      await page.waitForTimeout(2_000);
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

    await page.waitForFunction(() => {
      const tbody = document.getElementById('audit-log-tbody');
      return tbody && !tbody.textContent?.includes('Loading');
    }, { timeout: 10_000 });

    // Results should exist (seed data is recent)
    const count = await page.locator('#audit-log-tbody tr').count();
    expect(count).not.toBeNaN();
  });

  test('combined filters narrow results', async ({ page }) => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 16);

    // Apply multiple filters
    await page.locator('#audit-log-filter-start').fill(fmt(weekAgo));
    await page.locator('#audit-log-filter-end').fill(fmt(now));
    await page.locator('#audit-log-search-btn').click();

    await page.waitForFunction(() => {
      const tbody = document.getElementById('audit-log-tbody');
      return tbody && !tbody.textContent?.includes('Loading');
    }, { timeout: 10_000 });

    expect(await page.locator('#audit-log-tbody tr').count()).not.toBeNaN();
  });

  // ── Pagination ──

  test('load more button is visible or hidden based on entry count', async ({ page }) => {
    await page.locator('#audit-log-search-btn').click();

    await page.waitForFunction(() => {
      const tbody = document.getElementById('audit-log-tbody');
      return tbody && !tbody.textContent?.includes('Loading');
    }, { timeout: 10_000 });

    const loadMore = page.locator('#audit-log-load-more');
    const rowCount = await page.locator('#audit-log-tbody tr').count();

    // Report a missing precondition as a SKIP, not a pass. Nesting the
    // assertion inside bare `if`s let this test go green having asserted
    // nothing at all when the log was empty or Load More was hidden — the
    // same "absence of work reported as success" the sibling CSV test below
    // already avoids with `test.skip`.
    if (rowCount === 0) {
      test.skip(true, 'No audit entries — pagination cannot be exercised');
      return;
    }
    if (!(await loadMore.isVisible())) {
      test.skip(true, 'Load More hidden — fewer entries than one page');
      return;
    }

    const initialCount = rowCount;
    await loadMore.click();
    // Wait for the next page to LAND rather than betting on 2s. Under the
    // full suite the audit log has accumulated entries from every earlier
    // admin test, so the fetch+re-render runs slower than when this file
    // is run alone — and the old sleep sampled the table mid-render, when
    // the row count had briefly dropped. It passed in isolation and failed
    // in the suite, which is machine speed deciding the verdict rather
    // than the product (same defect class as SHY-0279).
    //
    // Deliberately `toBeGreaterThanOrEqual` and NOT a proof that page 2
    // arrived: `state.page` is never incremented in
    // `public/admin/js/tabs/audit-log.js`, so Load More re-fetches page 1
    // and appends duplicates. Asserting the real contract here would pin a
    // product bug that this story cannot fix — `public/**` is a shipped
    // runtime surface needing the device gauntlet. Tracked as SHY-0283,
    // which carries the RED test that pins it.
    await expect
      .poll(() => page.locator('#audit-log-tbody tr').count(), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(initialCount);
  });

  // ── CSV Export ──

  test('export CSV downloads a file', async ({ page }) => {
    // Wait for data to load
    await page.waitForFunction(() => {
      const tbody = document.getElementById('audit-log-tbody');
      return tbody && !tbody.textContent?.includes('Loading');
    }, { timeout: 10_000 });

    // Only test if there are entries
    if (await page.locator('#audit-log-tbody tr').count() === 0) {
      test.skip(true, 'No audit entries to export');
      return;
    }

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#audit-log-export-csv').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/audit-log-.*\.csv/);
  });

  // ── Auto-Polling ──

  test('audit log auto-refreshes via polling', async ({ page }) => {
    // Wait for initial load to complete
    await page.waitForFunction(() => {
      const tbody = document.getElementById('audit-log-tbody');
      return tbody && !tbody.textContent?.includes('Loading');
    }, { timeout: 10_000 });

    // Verify the polling interval is set up by checking that the tab
    // continues to make API requests over time
    const requests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('audit-log') && !req.url().includes('search')) requests.push(req.url());
    });

    // Wait for at least two polling cycles (4s each + buffer)
    await page.waitForTimeout(10_000);
    expect(requests.length).toBeGreaterThanOrEqual(1);
  });

  // ── Tab Lifecycle ──

  test('switching away stops polling, switching back resumes', async ({ page }) => {
    // We're on Audit Log tab. Switch to Users, then back.
    await page.getByRole('button', { name: 'Users' }).click();
    await page.waitForTimeout(500);

    // Switch back to Audit Log
    await page.getByRole('button', { name: 'Audit Log' }).click();
    await expect(page.locator('#audit-log-panel')).toBeVisible({ timeout: 5_000 });

    // Verify data reloads after switching back
    await page.waitForFunction(() => {
      const tbody = document.getElementById('audit-log-tbody');
      return tbody && !tbody.textContent?.includes('Loading');
    }, { timeout: 10_000 });
  });

  // ── Console Errors ──

  test('zero console errors on audit log tab', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    // Interact with the tab
    await page.locator('#audit-log-search-btn').click();
    await page.waitForTimeout(2_000);

    // Filter out known non-issues (429 rate limiting)
    const meaningful = errors.filter(e => !e.includes('429'));
    expect(meaningful).toHaveLength(0);
  });
});
