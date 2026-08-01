/**
 * Gift attribution and the event-level ledger (SHY-0267 phase 5).
 *
 * WHY THIS EXISTS. A showcase with four performers where the tips all land on
 * the host is not a rounding error — it is the performers being paid nothing for
 * the audience they drew. The seat says who is performing; this says what that
 * performance earned.
 *
 * A separate module rather than more code inside `economy.js` because the gift
 * path is already two thousand lines, and this is a distinct question: economy
 * moves the money, the ledger records who it was for.
 */
const { db } = require('./firebase');
const { generateId } = require('./helpers');
const log = require('./log');

/**
 * Record a gift against the event a room belongs to.
 *
 * NEVER THROWS and never blocks the gift. By the time this runs the coins have
 * moved; a ledger failure must not undo a paid-for gift. It is also a complete
 * no-op for ordinary rooms, which must be untouched by events.
 *
 * THE UNATTRIBUTED CASE IS THE INTERESTING ONE. A gift can arrive while nobody
 * is seated — between acts, or after a demote. It cannot be dropped, because the
 * sender paid for it, and it must not be credited to whoever last held the
 * stage, because they are no longer performing. So it goes to the event's host
 * and is MARKED, letting a payout run tell "the host performed" apart from
 * "nobody was on stage and the house took it".
 */
async function recordEventGift({ roomId, senderId, giftId, coinValue, beanReward }) {
  try {
    if (!roomId) return null;
    const roomSnap = await db.doc(`rooms/${roomId}`).get();
    if (!roomSnap.exists) return null;

    const eventId = roomSnap.data().eventId;
    // An ordinary room. Events must not change how the rest of the product works.
    if (!eventId) return null;

    const eventSnap = await db.doc(`events/${eventId}`).get();
    if (!eventSnap.exists) return null;
    const event = eventSnap.data();

    const performerId = event.currentPerformerId || null;
    const recipientId = performerId || event.hostId;

    const entryId = generateId();
    await db.doc(`events/${eventId}/giftLedger/${entryId}`).set({
      entryId,
      eventId,
      senderId: String(senderId),
      recipientId: String(recipientId),
      // Explicit, not inferred from `recipientId === hostId`: a host who is
      // genuinely performing is a different fact from nobody being on stage,
      // and they are indistinguishable once written.
      unattributed: !performerId,
      giftId: String(giftId || ''),
      coinValue: Number(coinValue) || 0,
      beanReward: Number(beanReward) || 0,
      at: Date.now(),
    });

    log.info('events', 'gift recorded on event ledger', { eventId, unattributed: !performerId });
    return entryId;
  } catch (err) {
    // Swallowed deliberately — see the note above.
    log.error('events', 'event ledger write failed', { roomId, error: err.message });
    return null;
  }
}

/**
 * Totals for an event, from ONE read of its ledger.
 *
 * The top contributor is the biggest SPENDER, not the most frequent giver:
 * twenty roses are worth less than one crown, and ranking by count would put the
 * wrong name on the host's screen.
 *
 * Ties break on the contributor id so the same ledger always names the same
 * person — a summary that changes between two reads is not a summary.
 */
async function summariseEvent(eventId) {
  const [snap, eventSnap] = await Promise.all([
    db.collection(`events/${eventId}/giftLedger`).get(),
    db.doc(`events/${eventId}`).get(),
  ]);
  const roster = eventSnap.exists ? eventSnap.data().roster || [] : [];

  let coinTotal = 0;
  let beanTotal = 0;
  const byContributor = new Map();

  for (const doc of snap.docs) {
    const entry = doc.data();
    const coins = Number(entry.coinValue) || 0;
    coinTotal += coins;
    beanTotal += Number(entry.beanReward) || 0;
    byContributor.set(entry.senderId, (byContributor.get(entry.senderId) || 0) + coins);
  }

  let topContributorId = null;
  let topSpend = -1;
  for (const [id, spend] of [...byContributor.entries()].sort((a, b) =>
    String(a[0]).localeCompare(String(b[0])),
  )) {
    if (spend > topSpend) {
      topSpend = spend;
      topContributorId = id;
    }
  }

  // Per-performer, because one total tells the host what the night made and
  // tells each performer nothing about what THEY earned — which is the silence
  // this whole feature exists to end.
  //
  // Seeded from the roster first so a performer who earned nothing appears at
  // ZERO rather than being absent. Absent and zero are different facts, and
  // someone who performed to a quiet room should see that they earned nothing
  // rather than wonder whether the page is broken.
  const perPerformer = new Map();
  for (const id of roster) {
    perPerformer.set(id, { uniqueId: id, giftCount: 0, coinTotal: 0, beanTotal: 0 });
  }
  for (const doc of snap.docs) {
    const entry = doc.data();
    // Unattributed gifts belong to the event, not to a performance, so they are
    // excluded from the per-performer split.
    if (entry.unattributed) continue;
    const row = perPerformer.get(entry.recipientId) || {
      uniqueId: entry.recipientId,
      giftCount: 0,
      coinTotal: 0,
      beanTotal: 0,
    };
    row.giftCount += 1;
    row.coinTotal += Number(entry.coinValue) || 0;
    row.beanTotal += Number(entry.beanReward) || 0;
    perPerformer.set(entry.recipientId, row);
  }

  return {
    eventId,
    giftCount: snap.size,
    coinTotal,
    beanTotal,
    topContributorId,
    topContributorCoins: topContributorId ? topSpend : 0,
    perPerformer: [...perPerformer.values()],
  };
}

module.exports = { recordEventGift, summariseEvent };
