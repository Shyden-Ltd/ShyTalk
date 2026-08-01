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
const { db } = require('../utils/firebase');
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

module.exports = router;
module.exports.STATE = STATE;
