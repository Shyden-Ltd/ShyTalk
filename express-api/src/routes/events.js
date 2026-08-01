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

module.exports = router;
module.exports.STATE = STATE;
