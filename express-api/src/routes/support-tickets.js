/**
 * Support tickets — SHY-0380.
 *
 *   POST   /api/support-tickets       raise one (authenticated user)
 *   GET    /api/support-tickets       list (admin only)
 *   PATCH  /api/support-tickets/:id   resolve + internal note (admin only)
 *
 * Why this exists: the age-restriction dialog offered a "Contact support" button
 * wired to the dismiss action, so it did nothing. The operator's decision was a
 * ticket an admin can action, not an email — an email leaves support with no
 * queue, no status and no audit trail, and fails outright on a device with no
 * mail app.
 *
 * Shaped deliberately on the existing appeals queue (`routes/reports.js:1363`):
 * validate, refuse a duplicate while one is still open, write with a generated
 * id. ShyTalk already has two user→admin queues (reports, appeals); a third
 * differently-shaped one would be the wrong outcome.
 *
 * This admin-dashboard surface is INTERIM by design. EPIC-0012 replaces it with
 * a support-agent role working from the website portal, so this must not grow
 * features that epic will own — no reply path, no assignment, no lifecycle
 * beyond open/resolved.
 */

const router = require('express').Router();
const { db, FieldValue } = require('../utils/firebase');
const { getDoc, queryDocs } = require('../utils/firestore-helpers');
const { generateId, now } = require('../utils/helpers');
const { requireAdmin } = require('../middleware/auth');
const { deleteObject, getSignedGetUrl, getSignedPutUrl } = require('../utils/r2');
const { writeLimiter } = require('../middleware/rateLimit');
const log = require('../utils/log');

const COLLECTION = 'supportTickets';

/**
 * Bounded explicitly rather than truncated. Silently cutting somebody's message
 * in half loses the part they cared about and tells them nothing.
 */
const MAX_MESSAGE_LENGTH = 1000;
const MAX_ADMIN_NOTE_LENGTH = 2000;

/**
 * Categories exist to help triage, so the set is closed.
 *
 * `bug` is SHY-0387's sixth approved category ("Something is broken"). The other
 * five predate it. The app's `SupportCategory` enum mirrors this list exactly —
 * a value here with no counterpart there is a category nobody can choose.
 */
const CATEGORIES = ['age', 'account', 'payment', 'safety', 'bug', 'other'];

/**
 * What somebody may attach — SHY-0387. The operator asked for screenshots AND
 * videos, so the set spans both.
 */
const ATTACHMENT_CONTENT_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['video/mp4', 'mp4'],
  ['video/quicktime', 'mov'],
]);

/**
 * Bounded because each attachment is an object an admin has to open. Ten is
 * generous for "show me the problem" and small enough that a ticket cannot be
 * used to park a media library.
 */
const MAX_ATTACHMENTS = 10;

/**
 * Refuse a caller we cannot identify — SHY-0426.
 *
 * `resolveUniqueId` answers null when a Firebase uid has no identityMap entry,
 * and the auth middleware passes that through as `req.auth.uniqueId = null`.
 * Nothing here treated null as "unknown"; it was used as though it were an
 * account number. Because `null === null`, every ownership test in this file
 * then passed for everybody at once:
 *
 *   - `where('userId','==',null)` matched every unidentified caller's tickets
 *   - `doc.userId !== uniqueId` was false, so appends were allowed
 *   - `support-tickets/null/` was one shared attachment folder
 *
 * Reproduced against the real stack: two accounts read each other's support
 * tickets — including the summary of a SAFETY report — and wrote into each
 * other's. An account we cannot identify cannot be authorised for anything
 * scoped to an account, so it is refused rather than guessed at.
 *
 * `Number.isInteger`, not a falsy test: uniqueId 0 is a real account and a
 * `!uniqueId` guard would lock it out.
 *
 * This is the SUPPORT surface only. The same shape exists across 29 route
 * files — see SHY-0426 for the central fix, which cannot simply reject in the
 * middleware because account creation legitimately runs before an identity
 * exists.
 */
function requireIdentity(req, res) {
  if (Number.isInteger(req.auth?.uniqueId)) return false;
  log.warn('support-tickets', 'Refused a caller with no resolved identity', {
    uid: req.auth?.uid,
    path: req.path,
  });
  res.status(403).json({ error: 'Your account could not be identified', code: 'no_identity' });
  return true;
}

/** Every attachment key lives under the owner's own folder. */
const attachmentPrefix = (uniqueId) => `support-tickets/${uniqueId}/`;

/**
 * Validate client-supplied R2 keys — the same three defences age-verification
 * applies, for the same reason: the key comes from the client, so each one is a
 * candidate route into somebody else's folder.
 *
 *   1. must sit under the caller's own prefix
 *   2. must not contain `..` or `//` — the literal key stores as-is, but a
 *      downstream consumer (admin viewer, signed GET, CDN) may normalise it
 *   3. the remainder must be a single segment, so a valid prefix cannot be
 *      extended into another account's directory
 *
 * @returns {{ok: true, keys: string[]} | {ok: false, error: string}}
 */
function validateAttachments(raw, uniqueId) {
  if (raw === undefined || raw === null) return { ok: true, keys: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'attachments must be a list' };
  if (raw.length > MAX_ATTACHMENTS) {
    return { ok: false, error: `at most ${MAX_ATTACHMENTS} attachments are allowed` };
  }

  const prefix = attachmentPrefix(uniqueId);
  for (const key of raw) {
    if (typeof key !== 'string' || key.length === 0) {
      return { ok: false, error: 'each attachment must be an upload key' };
    }
    if (!key.startsWith(prefix) || key.includes('..') || key.includes('//')) {
      return { ok: false, error: 'attachment does not belong to this account' };
    }
    if (key.slice(prefix.length).includes('/')) {
      return { ok: false, error: 'attachment does not belong to this account' };
    }
  }
  return { ok: true, keys: raw };
}

const STATUS_OPEN = 'open';
/** How many open tickets the choice screen will ever show. More is unreadable. */
const MAX_OPEN_TICKETS_LISTED = 5;
/** Long enough to recognise the problem, short enough to scan. */
const SUMMARY_MAX_LENGTH = 120;

/**
 * How many requests this person already has open — SHY-0396.
 *
 * Bounded by the same limit the choice screen uses, because the number is only
 * ever read as "none / one / a few". An unbounded count would let somebody with
 * a large history make ticket creation expensive.
 *
 * Never throws: this is observability, and losing the number must not cost
 * somebody their ticket. `null` records honestly that it was not known.
 */
async function countOpenTickets(uniqueId) {
  try {
    const docs = await queryDocs(
      db
        .collection(COLLECTION)
        .where('userId', '==', uniqueId)
        .where('status', '==', STATUS_OPEN)
        .limit(MAX_OPEN_TICKETS_LISTED),
    );
    return docs.length;
  } catch (err) {
    log.error('support-tickets', 'Counting open tickets failed', { error: err.message });
    return null;
  }
}

/** A shortened copy of the person's OWN message — never anybody else's. */
function summarise(message) {
  const text = typeof message === 'string' ? message.trim() : '';
  if (text.length <= SUMMARY_MAX_LENGTH) return text;
  return text.slice(0, SUMMARY_MAX_LENGTH) + '\u2026';
}
const STATUS_RESOLVED = 'resolved';

/**
 * Context fields the client may attach, as an ALLOWLIST.
 *
 * A denylist would be wrong here: it can only exclude the leaks somebody thought
 * of, and this payload is written by the client. An allowlist means a field
 * nobody anticipated is dropped rather than stored.
 */
const CONTEXT_ALLOWED_FIELDS = ['feature', 'reason', 'screen', 'appVersion', 'platform'];

/** Keep only the allowed context fields, coerced to short strings. */
function sanitiseContext(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const field of CONTEXT_ALLOWED_FIELDS) {
    const value = raw[field];
    if (typeof value === 'string' && value.length > 0) out[field] = value.slice(0, 200);
  }
  return out;
}

// ─── Issue an upload URL for an attachment ──────────────────────

/**
 * The client PUTs the bytes straight to R2 with this short-lived signed URL, so
 * the API never carries the file and never holds a long-lived storage
 * credential. Same flow as age verification.
 */
router.post('/support-tickets/upload-url', writeLimiter, async (req, res) => {
  try {
    if (requireIdentity(req, res)) return;
    const contentType = (req.body ?? {}).contentType;
    if (typeof contentType !== 'string' || !ATTACHMENT_CONTENT_TYPES.has(contentType)) {
      return res.status(400).json({
        error: `contentType must be one of: ${[...ATTACHMENT_CONTENT_TYPES.keys()].join(', ')}`,
      });
    }

    // The random component matters: R2 is bucket-private, but this flow HANDS
    // the key back to the client, so a key derived only from the account id
    // would let somebody who knows it name a stranger's past uploads.
    const ext = ATTACHMENT_CONTENT_TYPES.get(contentType);
    const r2Key = `${attachmentPrefix(req.auth.uniqueId)}${generateId()}.${ext}`;
    const uploadUrl = await getSignedPutUrl(r2Key, contentType, UPLOAD_SLOT_TTL_SEC);

    return res.json({ uploadUrl, r2Key, expiresInSec: UPLOAD_SLOT_TTL_SEC });
  } catch (err) {
    log.error('support-tickets', 'POST /api/support-tickets/upload-url failed', {
      error: err.message,
    });
    return res.status(500).json({ error: 'Failed to issue upload URL' });
  }
});

// ─── Remove an attachment before sending ────────────────────────

/**
 * Delete an upload the person has taken off their form.
 *
 * The bytes go up the moment a file is PICKED, before Send is pressed. So a
 * file removed from the form is already in the object store, and once the form
 * drops the key nothing references it: no ticket carries it, so no retention
 * rule and no erasure request will ever reach it.
 *
 * That is a data-protection problem rather than housekeeping. People attach
 * screenshots of private conversations and video of other people to safety
 * reports, and removing a file before sending is the moment somebody most
 * reasonably believes it is gone. Keeping an orphaned copy indefinitely, for no
 * purpose, is exactly what data minimisation forbids.
 *
 * The key comes from the CLIENT, so it gets the same three defences as the
 * upload path: it must sit under the caller's own prefix, and must contain
 * neither `..` nor `//`. Without that this endpoint would delete anything whose
 * key a caller could guess.
 */
router.delete('/support-tickets/attachments', writeLimiter, async (req, res) => {
  try {
    if (requireIdentity(req, res)) return;
    const r2Key = (req.body ?? {}).r2Key;
    const check = validateAttachments([r2Key], req.auth.uniqueId);
    if (!check.ok) return res.status(400).json({ error: check.error });

    await deleteObject(r2Key);
    log.info('support-tickets', 'attachment removed before sending', {
      uniqueId: req.auth.uniqueId,
    });
    return res.json({ deleted: true });
  } catch (err) {
    // Reported, never swallowed. Answering 200 on a failed delete would tell
    // somebody their file is gone while it is still there.
    log.error('support-tickets', 'DELETE /api/support-tickets/attachments failed', {
      error: err.message,
    });
    return res.status(500).json({ error: 'Failed to delete attachment' });
  }
});

// ─── Raise a ticket ─────────────────────────────────────────────

router.post('/support-tickets', writeLimiter, async (req, res) => {
  try {
    if (requireIdentity(req, res)) return;
    const body = req.body ?? {};
    const message = body.message;

    if (typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'message is required' });
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      return res
        .status(400)
        .json({ error: `message must be at most ${MAX_MESSAGE_LENGTH} characters` });
    }

    const category = body.category;
    if (category !== undefined && !CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `category must be one of: ${CATEGORIES.join(', ')}` });
    }

    // Identity comes from the verified token, NEVER from the payload. A body
    // carrying its own userId is ignored, not honoured.
    const uniqueId = req.auth.uniqueId;

    const attachments = validateAttachments(body.attachments, uniqueId);
    if (!attachments.ok) {
      return res.status(400).json({ error: attachments.error });
    }

    // SHY-0396: a second request is NEVER refused. Somebody with an open ticket
    // may have a genuinely different problem, and refusing them means the new
    // problem reaches nobody. The warning belongs in the client, which shows
    // what is already open (GET /support-tickets/mine/open) and offers to add to
    // it instead -- with the reminder that a duplicate for the SAME problem only
    // goes to the back of the queue. This route used to answer 409 here, which
    // blocked it outright.
    //
    // The same query the 409 used to run now RECORDS instead of refusing, so the
    // warning's effect can be measured rather than assumed: a ticket with
    // `openTicketsAtCreation > 0` was raised by somebody who had already been
    // shown one. Counted SERVER-side deliberately -- a client-sent "I saw the
    // warning" flag can be stale or simply untrue, and this costs nothing that
    // the refusal did not already cost.
    const openAtCreation = await countOpenTickets(uniqueId);

    const ticketId = generateId();
    await db.doc(`${COLLECTION}/${ticketId}`).set(
      {
        userId: uniqueId,
        message: message.trim(),
        category: category ?? 'other',
        context: sanitiseContext(body.context),
        attachments: attachments.keys,
        openTicketsAtCreation: openAtCreation,
        status: STATUS_OPEN,
        resolvedBy: null,
        resolvedAt: null,
        adminNote: null,
        createdAt: now(),
      },
      { merge: true },
    );

    // Deliberately not logging the message body: a support request can contain
    // anything, and logs are read by more people than the queue is.
    log.info('support-tickets', 'Support ticket raised', {
      ticketId,
      uniqueId,
      category,
      attachmentCount: attachments.keys.length,
    });

    res.json({ success: true, ticketId });
  } catch (err) {
    log.error('support-tickets', 'POST /api/support-tickets failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── View a ticket's attachments (admin) ────────────────────────

/**
 * Short-lived links for one ticket's attachments — SHY-0387.
 *
 * On demand rather than folded into the list, which returns up to 200 tickets:
 * signing every attachment of every ticket would mean thousands of signatures
 * per page load, nearly all of them for tickets nobody opens. Same shape as
 * `admin-age-verification`, which signs an ID image only when an admin looks at
 * it.
 *
 * The links expire. A link that does not is a permanent public URL to somebody's
 * support attachment, handed out by an endpoint that is behind a bearer token
 * precisely because the object should not be public.
 */
const ATTACHMENT_LINK_TTL_SEC = 300;

/**
 * Same lifetime for the upload slot.
 *
 * Passed EXPLICITLY rather than relying on `getSignedPutUrl`'s default, because
 * the response tells the client `expiresInSec` and the two would drift apart
 * silently — the client would schedule against a lifetime the URL does not have,
 * and uploads would start failing as an undiagnosable "upload failed".
 */
const UPLOAD_SLOT_TTL_SEC = 300;

// Rate-limited despite being a GET: each call mints up to MAX_ATTACHMENTS signed
// URLs, which makes it the cheapest signature-generation endpoint an
// authenticated token can loop on. Every other signing route here is limited.
/**
 * The caller's own OPEN tickets, with a short summary of each — SHY-0396.
 *
 * Mounted BEFORE `/support-tickets/:id/...` so `mine` is never taken for an id.
 *
 * This exists so the client can warn instead of refuse. Somebody with a request
 * already open is shown what it was about, reminded that a duplicate for the
 * SAME problem only goes to the back of the queue, and then given the choice:
 * add to that ticket, raise a new one, or go back. Without a summary there is
 * nothing to recognise the problem by, and the choice is unanswerable.
 *
 * The summary is a shortened copy of their OWN words, so no new stored field is
 * needed and nothing is revealed that they did not write.
 */
router.get('/support-tickets/mine/open', async (req, res) => {
  try {
    if (requireIdentity(req, res)) return;
    const uniqueId = req.auth.uniqueId;
    const docs = await queryDocs(
      db
        .collection(COLLECTION)
        .where('userId', '==', uniqueId)
        .where('status', '==', STATUS_OPEN)
        .limit(MAX_OPEN_TICKETS_LISTED),
    );

    // Belt and braces on top of the query: a support queue holds other people's
    // words, so ownership is re-checked here rather than trusted from the
    // filter alone.
    const tickets = docs
      .filter((d) => d.userId === uniqueId)
      .map((d) => ({
        ticketId: d.id,
        category: d.category ?? 'other',
        summary: summarise(d.message),
        createdAt: d.createdAt ?? null,
      }));

    res.json({ tickets });
  } catch (err) {
    log.error('support-tickets', 'Listing open tickets failed', { error: err.message });
    res.status(500).json({ error: 'Could not load your open requests' });
  }
});

/**
 * Add to a ticket the caller already has — SHY-0396, "it's the problem I
 * already reported".
 *
 * Without this the text has nowhere to go and would simply be dropped, which is
 * the worst outcome for somebody who has already had to ask twice.
 */
router.post('/support-tickets/:id/messages', writeLimiter, async (req, res) => {
  try {
    if (requireIdentity(req, res)) return;
    const uniqueId = req.auth.uniqueId;
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message) {
      return res.status(400).json({ error: 'message is required' });
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      return res
        .status(400)
        .json({ error: `message must be ${MAX_MESSAGE_LENGTH} characters or fewer` });
    }

    const snap = await db.doc(`${COLLECTION}/${req.params.id}`).get();
    // A ticket belonging to somebody else answers 404, not 403: whether their
    // ticket exists is not this caller's business.
    if (!snap.exists || snap.data().userId !== uniqueId) {
      return res.status(404).json({ error: 'Support request not found' });
    }

    await db.doc(`${COLLECTION}/${req.params.id}`).update({
      messages: FieldValue.arrayUnion({ message, addedAt: now(), addedBy: uniqueId }),
      updatedAt: now(),
    });

    log.info('support-tickets', 'Message added to an existing ticket', {
      ticketId: req.params.id,
      uniqueId,
    });

    res.json({ success: true, ticketId: req.params.id });
  } catch (err) {
    log.error('support-tickets', 'Adding to a ticket failed', { error: err.message });
    res.status(500).json({ error: 'Could not add to your request' });
  }
});

router.get('/support-tickets/:id/attachments', writeLimiter, async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;

    const doc = await db.doc(`${COLLECTION}/${req.params.id}`).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Tickets raised before SHY-0387 have no `attachments` field at all, so an
    // absent one is an empty list rather than a crash.
    const keys = doc.data().attachments ?? [];
    const attachments = await Promise.all(
      keys.map((key) => getSignedGetUrl(key, ATTACHMENT_LINK_TTL_SEC)),
    );

    return res.json({ attachments });
  } catch (err) {
    log.error('support-tickets', 'GET /api/support-tickets/:id/attachments failed', {
      error: err.message,
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── List tickets (admin) ───────────────────────────────────────

router.get('/support-tickets', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;

    const status = req.query.status;
    if (status !== undefined && ![STATUS_OPEN, STATUS_RESOLVED].includes(status)) {
      return res
        .status(400)
        .json({ error: `status must be "${STATUS_OPEN}" or "${STATUS_RESOLVED}"` });
    }

    let query = db.collection(COLLECTION);
    if (status) query = query.where('status', '==', status);
    const tickets = await queryDocs(query.orderBy('createdAt', 'desc').limit(200));

    res.json({ tickets });
  } catch (err) {
    log.error('support-tickets', 'GET /api/support-tickets failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Resolve a ticket (admin) ───────────────────────────────────

router.patch('/support-tickets/:id', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;

    const body = req.body ?? {};
    if (body.status !== STATUS_RESOLVED) {
      return res.status(400).json({ error: `status must be "${STATUS_RESOLVED}"` });
    }

    const adminNote = body.adminNote;
    if (adminNote !== undefined) {
      if (typeof adminNote !== 'string' || adminNote.length > MAX_ADMIN_NOTE_LENGTH) {
        return res.status(400).json({
          error: `adminNote must be a string of at most ${MAX_ADMIN_NOTE_LENGTH} characters`,
        });
      }
    }

    const ticket = await getDoc(`${COLLECTION}/${req.params.id}`);
    if (!ticket) return res.status(404).json({ error: 'Support ticket not found' });

    const timestamp = now();
    const update = {
      status: STATUS_RESOLVED,
      resolvedBy: req.auth.uid,
      resolvedAt: timestamp,
    };
    if (adminNote !== undefined) update.adminNote = adminNote;

    await db.doc(`${COLLECTION}/${req.params.id}`).update(update);

    // Audit AFTER the write succeeds, and only then: an entry for an action that
    // did not happen is worse than none. `PUT /config/:key` writes no audit entry
    // at all, which is the gap this deliberately does not reproduce.
    await db.collection('auditLog').add({
      adminUid: req.auth.uniqueId,
      action: 'support_ticket_resolve',
      actionType: 'support_ticket_resolve',
      targetType: 'support_ticket',
      targetId: req.params.id,
      details: { hasAdminNote: adminNote !== undefined },
      timestamp,
    });

    res.json({ success: true });
  } catch (err) {
    log.error('support-tickets', 'PATCH /api/support-tickets/:id failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
