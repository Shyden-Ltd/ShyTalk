import { expect, type Locator } from '@playwright/test';

/**
 * A list panel has exactly TWO valid resting states: it shows items, or it says
 * it is empty. A blank panel is neither — and a blank panel is precisely what a
 * stuck fetch, a 500, or a renderer that threw actually looks like.
 *
 * This replaces the shape
 *
 *   const n = await cards.count();
 *   if (n === 0) {
 *     await expect(list).toContainText('No reports');
 *   }
 *
 * which asserted NOTHING whenever data happened to exist. In a seeded suite
 * that is nearly always, so the empty-state message went unverified every run
 * while the test reported green — and, worse, a panel that rendered nothing at
 * all sailed through both branches.
 *
 * Polling (rather than reading once) means this also waits out the render
 * instead of racing it.
 */
export async function expectListSettled(
  list: Locator,
  items: Locator,
  emptyText: string | RegExp,
): Promise<void> {
  await expect
    .poll(
      async () => {
        if ((await items.count()) > 0) return 'items';
        const text = (await list.textContent()) ?? '';
        const isEmptyState =
          typeof emptyText === 'string' ? text.includes(emptyText) : emptyText.test(text);
        return isEmptyState ? 'empty-state' : 'neither';
      },
      {
        message: `list must either show items or state that it is empty (${emptyText}) — a blank panel is a failure`,
        timeout: 15_000,
      },
    )
    .not.toBe('neither');
}
