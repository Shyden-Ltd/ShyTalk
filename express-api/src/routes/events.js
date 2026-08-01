/**
 * Scheduled events with a roster of performers (SHY-0267).
 *
 * j16 has asserted this feature across 11 scenarios since it was written and
 * none of it existed — no route, no model, no screen. The scenarios were tagged
 * `@unimplemented` to stop them reading as regressions, which was honest and was
 * never a plan.
 *
 * WHY THE ATTRIBUTION MATTERS. A showcase with four performers where the tips
 * all land on the host is not a rounding error; it is the performers being paid
 * nothing for the audience they drew. An event exists so that a room can change
 * hands between performers while the money follows whoever is actually on the
 * seat.
 *
 * WHY THE COHORT CHECK IS HERE AND NOT ONLY IN THE UI. A roster is a standing
 * working relationship between named people. Rooms, discovery and PMs all refuse
 * to cross the minor/adult line, and a roster is the one place the product could
 * create one instead — so the check runs on the server, against the VERIFIED
 * claim, in both directions.
 */
const router = require('express').Router();
const { db, FieldValue } = require('../utils/firebase');
const { generateId } = require('../utils/helpers');
const { cohortFromClaim, effectiveCohort } = require('../utils/firebase-claims');
const log = require('../utils/log');

/** Only an event host may schedule. The userType is the product's own gate. */
const HOST_USER_TYPE = 'MC_EVENT_HOST';

/** Event lifecycle. Forward-only; there is no un-closing an event. */
const STATE = {
  SCHEDULED: 'SCHEDULED',
  LIVE: 'LIVE',
  CLOSED: 'CLOSED',
};

const MAX_TITLE = 120;
const MAX_ROSTER = 25;

/** Mirrors Constants.MAX_SEATS — an event room is an ordinary room. */
const MAX_SEATS = 8;

/**
 * The seat index performers occupy.
 *
 * Seat 0 is the host's, by the same convention the rest of the product uses; a
 * rotating performer takes seat 1 so the host never has to leave their own
 * stage to hand over.
 */
const PERFORMER_SEAT = '1';

/**
 * Validate the scheduling payload.
 *
 * Returns an error STRING or null. Every rejection names what is wrong with the
 * request rather than "invalid input" — a host correcting a form needs to know
 * which field.
 */
function validateSchedule({ title, startsAt, durationMin, roster }) {
  if (typeof title !== 'string' || !title.trim()) return 'title is required';
  if (title.length > MAX_TITLE) return `title must be ${MAX_TITLE} characters or fewer`;

  const when = Date.parse(startsAt);
  if (!Number.isFinite(when)) return 'startsAt must be an ISO-8601 timestamp';
  // A backwards schedule is always a mistake, and accepting it silently makes an
  // event that can never legitimately start.
  if (when <= Date.now()) return 'startsAt must be in the future';

  const minutes = Number(durationMin);
  if (!Number.isFinite(minutes) || minutes <= 0) return 'durationMin must be a positive number';

  if (roster !== undefined && !Array.isArray(roster)) return 'roster must be an array';
  if (Array.isArray(roster) && roster.length > MAX_ROSTER) {
    return `roster may hold at most ${MAX_ROSTER} members`;
  }
  return null;
}

/**
 * Schedule an event.
 *
 * The roster is validated as a WHOLE before anything is written. A partial
 * event — created with the offending member quietly dropped — would be a
 * different event than the host asked for, and they would have no way to tell.
 */
router.post('/events', async (req, res) => {
  try {
    const hostId = req.auth.uniqueId;
    const { title, startsAt, durationMin } = req.body || {};
    const roster = Array.isArray(req.body?.roster) ? req.body.roster.map(String) : [];

    const invalid = validateSchedule({ title, startsAt, durationMin, roster });
    if (invalid) return res.status(400).json({ error: invalid });

    const hostSnap = await db.doc(`users/${hostId}`).get();
    if (!hostSnap.exists) return res.status(404).json({ error: 'Host not found' });
    const hostDoc = hostSnap.data();
    if (hostDoc.userType !== HOST_USER_TYPE) {
      return res.status(403).json({ error: 'Only an event host can schedule events' });
    }

    if (roster.includes(String(hostId))) {
      // The host is already present as the host. A self-invite would create an
      // invite they must accept to run their own event.
      return res.status(400).json({ error: 'the host is already part of the event' });
    }
    if (new Set(roster).size !== roster.length) {
      return res.status(400).json({ error: 'roster contains a duplicate member' });
    }

    // Cohort taken from the VERIFIED claim, never a request field.
    const hostCohort = cohortFromClaim(req) || effectiveCohort(hostDoc);

    const memberSnaps = await Promise.all(roster.map((id) => db.doc(`users/${id}`).get()));
    for (let i = 0; i < memberSnaps.length; i++) {
      const snap = memberSnaps[i];
      if (!snap.exists) {
        // Naming the missing member matters: a host who mistyped one id should
        // not have to diff their roster against the response.
        return res.status(400).json({ error: `roster member ${roster[i]} does not exist` });
      }
      if (effectiveCohort(snap.data()) !== hostCohort) {
        return res.status(403).json({
          error:
            'a roster cannot cross the minor/adult boundary — ' +
            `${roster[i]} is not in the host's cohort`,
        });
      }
    }

    const eventId = `${hostId}-${generateId()}`;
    const event = {
      eventId,
      hostId,
      hostName: String(hostDoc.displayName || '').trim() || String(hostId),
      title: title.trim(),
      startsAt,
      durationMin: Number(durationMin),
      roster,
      cohort: hostCohort,
      state: STATE.SCHEDULED,
      createdAt: new Date().toISOString(),
    };

    const batch = db.batch();
    batch.set(db.doc(`events/${eventId}`), event);
    for (const memberId of roster) {
      // The invite carries WHO and WHEN. "You were invited" without either is
      // not an invitation — the performer cannot tell whether they are free.
      batch.set(db.doc(`users/${memberId}/eventInvites/${eventId}`), {
        eventId,
        hostId,
        hostName: event.hostName,
        title: event.title,
        startsAt,
        status: 'PENDING',
        invitedAt: event.createdAt,
      });
    }
    await batch.commit();

    log.info('events', 'event scheduled', { eventId, roster: roster.length });
    res.status(201).json({ event });
  } catch (err) {
    log.error('events', 'POST /events failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Answer an invite.
 *
 * ONE handler for accept and decline because they are the same operation with
 * a different destination list, and splitting them duplicated the four ways
 * this can go wrong: a closed event, someone else's invite, an unknown event,
 * and a repeat.
 *
 * IDEMPOTENT BY CONSTRUCTION. A double tap on a slow connection must not roster
 * someone twice — a duplicate inflates every count the host reads and could seat
 * one person on two seats. `arrayRemove` then `arrayUnion` also makes a
 * change-of-mind move the member ACROSS rather than leaving them on both lists,
 * which would give the host a roster whose numbers do not add up.
 */
async function answerInvite(req, res, decision) {
  const uniqueId = req.auth.uniqueId;
  const { eventId } = req.params;

  const inviteRef = db.doc(`users/${uniqueId}/eventInvites/${eventId}`);
  const [eventSnap, inviteSnap] = await Promise.all([
    db.doc(`events/${eventId}`).get(),
    inviteRef.get(),
  ]);

  if (!eventSnap.exists) return res.status(404).json({ error: 'Event not found' });
  // A missing invite and someone else's invite are the same answer on purpose:
  // "not found" tells a stranger nothing about who else was invited.
  if (!inviteSnap.exists) return res.status(404).json({ error: 'Invite not found' });

  const event = eventSnap.data();
  if (event.state === STATE.CLOSED) {
    // Silently accepting would add a performer to a show that already happened.
    return res.status(409).json({ error: 'This event has closed' });
  }

  const accepted = decision === 'ACCEPTED';
  await db.doc(`events/${eventId}`).update({
    accepted: accepted ? FieldValue.arrayUnion(uniqueId) : FieldValue.arrayRemove(uniqueId),
    declined: accepted ? FieldValue.arrayRemove(uniqueId) : FieldValue.arrayUnion(uniqueId),
  });
  await inviteRef.update({ status: decision, answeredAt: new Date().toISOString() });

  log.info('events', 'invite answered', { eventId, decision });
  res.json({ ok: true, status: decision });
}

router.post('/events/:eventId/invite/accept', async (req, res) => {
  try {
    await answerInvite(req, res, 'ACCEPTED');
  } catch (err) {
    log.error('events', 'invite accept failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/events/:eventId/invite/decline', async (req, res) => {
  try {
    await answerInvite(req, res, 'DECLINED');
  } catch (err) {
    log.error('events', 'invite decline failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Read one event.
 *
 * Visible to the HOST and to anyone on the roster — a performer needs the start
 * time and who else is on it to decide whether to accept. Nobody else: an event
 * names real people and when they will be somewhere.
 *
 * `rosterStates` resolves each member to pending / accepted / declined, which is
 * what j16's roster panel shows. Without it the host is guessing who turned up.
 */
router.get('/events/:eventId', async (req, res) => {
  try {
    const uniqueId = req.auth.uniqueId;
    const snap = await db.doc(`events/${req.params.eventId}`).get();
    if (!snap.exists) return res.status(404).json({ error: 'Event not found' });

    const event = snap.data();
    const roster = event.roster || [];
    if (event.hostId !== uniqueId && !roster.includes(uniqueId)) {
      return res.status(403).json({ error: 'Not your event' });
    }

    const accepted = new Set(event.accepted || []);
    const declined = new Set(event.declined || []);
    const rosterStates = roster.map((id) => ({
      uniqueId: id,
      status: accepted.has(id) ? 'ACCEPTED' : declined.has(id) ? 'DECLINED' : 'PENDING',
    }));

    res.json({ event: { ...event, rosterStates } });
  } catch (err) {
    log.error('events', 'GET /events/:eventId failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Start a scheduled event.
 *
 * The event BINDS a room rather than inventing one, so seats, LiveKit and every
 * existing room behaviour keep working. An event is a room with an owner who is
 * allowed to change who sits in it.
 *
 * STARTING TWICE MUST NOT MAKE A SECOND ROOM. Two rooms for one event splits the
 * audience in half and neither half can see the other — so a repeat returns the
 * room that already exists. The host double-tapping "Start" is the expected
 * case, not an error.
 */
router.post('/events/:eventId/start', async (req, res) => {
  try {
    const uniqueId = req.auth.uniqueId;
    const { eventId } = req.params;

    const snap = await db.doc(`events/${eventId}`).get();
    if (!snap.exists) return res.status(404).json({ error: 'Event not found' });
    const event = snap.data();

    if (event.hostId !== uniqueId) {
      return res.status(403).json({ error: 'Only the host can start this event' });
    }
    if (event.state === STATE.CLOSED) {
      return res.status(409).json({ error: 'This event has closed' });
    }
    // Already live: hand back the same room. Idempotent, not an error.
    if (event.state === STATE.LIVE && event.roomId) {
      return res.json({ ok: true, roomId: event.roomId, eventId });
    }

    const startsAt = Date.parse(event.startsAt);
    if (Number.isFinite(startsAt) && startsAt > Date.now()) {
      // "Not yet" without a number sends the host back to guess. Ceil so the
      // last partial minute reads as 1 rather than 0.
      const minutes = Math.ceil((startsAt - Date.now()) / 60_000);
      return res.status(409).json({
        error: `This event starts in ${minutes} minute${minutes === 1 ? '' : 's'}`,
      });
    }

    // Only members who ACCEPTED are seeded. Holding a place for someone who
    // declined is how a host waits on a performer who was never coming; someone
    // who never answered simply is not expected, and must not block the start.
    const accepted = (event.accepted || []).filter((id) => (event.roster || []).includes(id));

    const roomId = `${eventId}-room`;
    await db.doc(`rooms/${roomId}`).set({
      roomId,
      name: event.title,
      ownerId: event.hostId,
      // `state`, matching the ChatRoom model the rest of the product reads.
      state: 'ACTIVE',
      eventId,
      participantIds: [],
      // The real 8-seat default map (Constants.MAX_SEATS / ChatRoom.DEFAULT_SEATS).
      // An event room that shipped without seats would render as a room with no
      // stage, and every existing seat reader would have to special-case it.
      seats: Object.fromEntries(
        Array.from({ length: MAX_SEATS }, (_, i) => [
          String(i),
          { userId: null, state: 'EMPTY', isMuted: false },
        ]),
      ),
      rosterParticipants: accepted,
      cohort: event.cohort,
      createdAt: Date.now(),
    });

    await db.doc(`events/${eventId}`).update({
      state: STATE.LIVE,
      roomId,
      startedAt: new Date().toISOString(),
    });

    log.info('events', 'event started', { eventId, roomId, roster: accepted.length });
    res.json({ ok: true, roomId, eventId });
  } catch (err) {
    log.error('events', 'POST /events/:eventId/start failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Load an event for a seat change, or send the right refusal.
 *
 * Returns the event, or null once it has already answered. Shared because
 * promote and demote reject on exactly the same four grounds, and two copies of
 * that list is how they drift apart.
 */
async function loadLiveEventForHost(req, res) {
  const snap = await db.doc(`events/${req.params.eventId}`).get();
  if (!snap.exists) {
    res.status(404).json({ error: 'Event not found' });
    return null;
  }
  const event = snap.data();
  if (event.hostId !== req.auth.uniqueId) {
    // A performer seating themselves would make the roster decorative.
    res.status(403).json({ error: 'Only the host can change seats in this event' });
    return null;
  }
  if (event.state !== STATE.LIVE) {
    res.status(409).json({
      error:
        event.state === STATE.CLOSED ? 'This event has closed' : 'This event has not started yet',
    });
    return null;
  }
  return event;
}

/**
 * Promote a rostered member into the performer seat.
 *
 * ONE performer at a time, by construction: promoting a second person replaces
 * the first rather than adding to them. Two "current performers" would make the
 * gift attribution in phase 5 ambiguous, and the money has to go somewhere.
 *
 * `currentPerformerId` is stored on the EVENT as well as the seat map. Phase 5
 * reads it on every gift, and re-deriving "who is performing" by scanning eight
 * seats per gift is both slower and a second place for the answer to live.
 */
router.post('/events/:eventId/promote', async (req, res) => {
  try {
    const event = await loadLiveEventForHost(req, res);
    if (!event) return undefined;

    const { uniqueId } = req.body || {};
    if (!uniqueId) return res.status(400).json({ error: 'uniqueId is required' });
    if (!(event.roster || []).includes(String(uniqueId))) {
      // Otherwise an event is a way to seat anyone in a room they were never
      // invited to.
      return res.status(400).json({ error: `${uniqueId} is not on this event's roster` });
    }

    const roomRef = db.doc(`rooms/${event.roomId}`);
    const roomSnap = await roomRef.get();
    if (!roomSnap.exists) return res.status(404).json({ error: 'Event room not found' });

    const seats = { ...(roomSnap.data().seats || {}) };
    // Clear any seat this member already holds, so a repeat promotion cannot
    // leave them seated twice.
    for (const [index, seat] of Object.entries(seats)) {
      if (seat && seat.userId === String(uniqueId)) {
        seats[index] = { userId: null, state: 'EMPTY', isMuted: false };
      }
    }
    seats[PERFORMER_SEAT] = { userId: String(uniqueId), state: 'OCCUPIED', isMuted: false };

    await roomRef.update({ seats });
    await db.doc(`events/${event.eventId}`).update({ currentPerformerId: String(uniqueId) });

    log.info('events', 'performer promoted', { eventId: event.eventId });
    res.json({ ok: true, seatIndex: Number(PERFORMER_SEAT) });
  } catch (err) {
    log.error('events', 'promote failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Demote whoever is in the performer seat.
 *
 * Clearing `currentPerformerId` to NULL is the load-bearing part. Between acts
 * nobody is performing, and phase 5 must not pay the person who just left the
 * stage for a gift that arrived after they did.
 *
 * Demoting an empty seat is a NO-OP rather than an error: the host tapping
 * demote twice, or after the performer has already left, is ordinary.
 */
router.post('/events/:eventId/demote', async (req, res) => {
  try {
    const event = await loadLiveEventForHost(req, res);
    if (!event) return undefined;

    const roomRef = db.doc(`rooms/${event.roomId}`);
    const roomSnap = await roomRef.get();
    if (!roomSnap.exists) return res.status(404).json({ error: 'Event room not found' });

    const seats = { ...(roomSnap.data().seats || {}) };
    const target = req.body?.uniqueId ? String(req.body.uniqueId) : null;
    for (const [index, seat] of Object.entries(seats)) {
      if (!seat || !seat.userId) continue;
      if (target && seat.userId !== target) continue;
      if (index === PERFORMER_SEAT || seat.userId === target) {
        seats[index] = { userId: null, state: 'EMPTY', isMuted: false };
      }
    }

    await roomRef.update({ seats });
    await db.doc(`events/${event.eventId}`).update({ currentPerformerId: null });

    log.info('events', 'performer demoted', { eventId: event.eventId });
    res.json({ ok: true });
  } catch (err) {
    log.error('events', 'demote failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
module.exports.STATE = STATE;
