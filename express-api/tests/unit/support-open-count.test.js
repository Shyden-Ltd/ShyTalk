/**
 * "You already have N requests open" must be a COUNT, not a display cap
 * (SHY-0424).
 *
 * `GET /support-tickets/mine/open` returns at most MAX_OPEN_TICKETS_LISTED (5)
 * summaries — a deliberate cap, because a choice screen listing twenty is
 * unreadable. The client then derived its heading from the LENGTH of that
 * list, so somebody with eight open requests was told they had five.
 *
 * The cap is a decision about how many to SHOW. It was being read as a fact
 * about how many EXIST, and the two stopped agreeing the moment somebody had
 * more than five.
 *
 * Counted server-side with Firestore's `count()` aggregation, so the number is
 * exact and does not need a second unbounded read to obtain.
 */

const { openTicketsPayload } = require('../../src/utils/support-open-tickets');

const summary = (id) => ({ ticketId: id, category: 'other', summary: 's', createdAt: 1 });

describe('openTicketsPayload', () => {
  test('reports the real count alongside the capped list', () => {
    const shown = [1, 2, 3, 4, 5].map((n) => summary(`t${n}`));
    expect(openTicketsPayload(shown, 8)).toEqual({
      tickets: shown,
      openCount: 8,
      shownCount: 5,
    });
  });

  test('the list stays capped — this changes the COUNT, not what is shown', () => {
    const shown = [1, 2, 3, 4, 5].map((n) => summary(`t${n}`));
    expect(openTicketsPayload(shown, 40).tickets).toHaveLength(5);
  });

  test('count and list agree when nobody is over the cap', () => {
    const shown = [summary('a'), summary('b')];
    expect(openTicketsPayload(shown, 2)).toEqual({
      tickets: shown,
      openCount: 2,
      shownCount: 2,
    });
  });

  test('a count that could not be determined is null, never a guess', () => {
    // The error path. Falling back to the list length would silently
    // reintroduce the exact defect this story is about, so the absence is
    // stated and the client decides what to say.
    const shown = [summary('a')];
    expect(openTicketsPayload(shown, null).openCount).toBeNull();
    expect(openTicketsPayload(shown, undefined).openCount).toBeNull();
  });

  test('a count lower than what is shown is not trusted', () => {
    // Only reachable if a ticket is resolved between the count and the list.
    // Reporting fewer open than are on screen in front of somebody is worse
    // than saying nothing.
    expect(openTicketsPayload([summary('a'), summary('b')], 1).openCount).toBeNull();
  });

  test('no tickets is an honest zero, not a null', () => {
    expect(openTicketsPayload([], 0)).toEqual({ tickets: [], openCount: 0, shownCount: 0 });
  });
});
