import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Asserts that NO console error arrives within a bounded window.
 *
 * Negative assertions are the one shape a condition-wait cannot express: there
 * is no state to wait for, because the whole claim is that nothing happens. A
 * `waitFor` would resolve at t=0 and prove nothing at all.
 *
 * So the window is inverted — we wait FOR the error, and its failure to arrive
 * is the pass. That keeps the observation bounded and honest while removing
 * the fixed `waitForTimeout` sleep, which measured elapsed time rather than
 * anything about the product (SHY-0245).
 *
 * Use a POSITIVE wait first wherever one exists (a panel becoming visible, a
 * response landing) and reserve this for "and then nothing bad happened".
 */
export async function expectNoConsoleErrorWithin(
  page: Page,
  windowMs: number,
  ignore: (text: string) => boolean = () => false,
): Promise<void> {
  const offender = await page
    .waitForEvent('console', {
      predicate: (msg) => msg.type() === 'error' && !ignore(msg.text()),
      timeout: windowMs,
    })
    .then((msg) => msg.text())
    .catch(() => null);

  // Report the offending text, not just a boolean — a bare `toBe(null)` makes
  // a real regression maximally annoying to diagnose.
  expect(offender, offender ? `unexpected console error: ${offender}` : undefined).toBeNull();
}
