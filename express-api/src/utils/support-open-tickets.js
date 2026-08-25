/**
 * Shaping the "your open requests" payload (SHY-0424).
 *
 * `GET /support-tickets/mine/open` returns at most MAX_OPEN_TICKETS_LISTED
 * summaries — a deliberate cap, because a choice screen listing twenty is
 * unreadable. The client derived its heading from the LENGTH of that list, so
 * somebody with eight open requests was told they had five.
 *
 * The cap is a decision about how many to SHOW. It was being read as a fact
 * about how many EXIST, and the two stopped agreeing the moment somebody went
 * past five.
 *
 * Pure and separate from the route so the rules below can be pinned without
 * standing firebase up.
 */

'use strict';

/**
 * @param {Array} shown the capped summaries, exactly as they will be displayed
 * @param {number|null|undefined} openCount the server-side count, or absent
 * @returns {{tickets: Array, openCount: number|null, shownCount: number}}
 */
function openTicketsPayload(shown, openCount) {
  const tickets = Array.isArray(shown) ? shown : [];
  const shownCount = tickets.length;

  // Absent, rather than guessed. Falling back to the list length would
  // silently reintroduce the exact defect this exists to fix, so the absence
  // is STATED and the client decides what it can honestly say.
  if (!Number.isFinite(openCount)) {
    return { tickets, openCount: null, shownCount };
  }

  // Fewer open than are on screen is only reachable if a ticket is resolved
  // between the count and the list. Telling somebody they have fewer requests
  // than they can currently see is worse than saying nothing.
  if (openCount < shownCount) {
    return { tickets, openCount: null, shownCount };
  }

  return { tickets, openCount, shownCount };
}

module.exports = { openTicketsPayload };
