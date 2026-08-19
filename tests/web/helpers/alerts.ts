import type { Page } from '@playwright/test';

/**
 * Resolves once `loadAlerts()` has rendered its verdict.
 *
 * Either rows landed in `#alerts-tbody`, or it unhid `#alerts-empty` — which
 * ships `display:none`, so NEITHER is true before the fetch resolves. That
 * makes the pair a genuine settled-signal rather than a proxy for one.
 *
 * Waiting on the verdict instead of a fixed delay means an alerts fetch that
 * never returns fails loudly here, rather than silently degrading the caller
 * into whichever "nothing to check" branch it happens to have. Six callers in
 * admin-alerts.spec.ts previously slept 2s each and then tested `count() > 0`,
 * so a slow or broken fetch simply skipped the assertions.
 *
 * Lives here rather than in one spec because two specs need it, and a settle
 * rule that disagrees between files is worse than none.
 */
export async function waitForAlertsLoaded(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const tbody = document.getElementById('alerts-tbody');
    const empty = document.getElementById('alerts-empty');
    if (!tbody || !empty) return false;
    return tbody.querySelector('tr') !== null || empty.style.display !== 'none';
  });
}
