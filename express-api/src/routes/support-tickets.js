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
const { requireAdmin, resolveUniqueId } = require('../middleware/auth');
const {
  REPORT_ORIGIN,
  ReportDocumentError,
  buildReportDocument,
} = require('../utils/report-document');
const { attachmentKeysOf } = require('../utils/support-retention');
const { deleteObject, getObject, getSignedPutUrl, headObject } = require('../utils/r2');
const { refusalForStoredObject } = require('../utils/attachment-limits');
const { scanAttachment } = require('../utils/attachment-scan');
const { writeLimiter } = require('../middleware/rateLimit');
const log = require('../utils/log');
const { openTicketsPayload } = require('../utils/support-open-tickets');

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

/**
 * Check every attached object against the limits, from what is actually in
 * storage (SHY-0420).
 *
 * Reads each object's type and size back from R2 rather than trusting the
 * request: the request is the thing being checked, and a client that skipped
 * the client-side rules would otherwise face nothing at all.
 *
 * Fails CLOSED. An object we cannot measure is refused — "we could not check"
 * must never mean "it is fine" for a file a stranger uploaded and a member of
 * staff will open.
 *
 * @returns {Promise<string|null>} a sentence for the caller, or null to accept
 */
async function refusalForAttachedObjects(keys) {
  for (const key of keys) {
    let head = null;
    try {
      head = await headObject(key);
    } catch (err) {
      log.warn('support-tickets', 'Could not measure an attachment', { key, error: err.message });
    }
    const refusal = refusalForStoredObject(head);
    if (refusal) return refusal;

    const scan = await scanAttachment(key);
    if (!scan.clean) {
      return `That file could not be accepted (${scan.reason ?? 'it did not pass a check'}).`;
    }
  }
  return null;
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
 * Closed BECAUSE it became a report — SHY-0439.
 *
 * A distinct status rather than a flag on `resolved`, because a reopen path that
 * has to remember to check a boolean is a reopen path that will one day forget.
 * Reopening a safety matter would put it back in a queue that is not for safety
 * matters, which is the problem SHY-0437 exists to solve.
 */
const STATUS_CONVERTED = 'converted_to_report';

/**
 * Context fields the client may attach, as an ALLOWLIST.
 *
 * A denylist would be wrong here: it can only exclude the leaks somebody thought
 * of, and this payload is written by the client. An allowlist means a field
 * nobody anticipated is dropped rather than stored.
 */
const CONTEXT_ALLOWED_FIELDS = [
  'feature',
  'reason',
  'screen',
  'appVersion',
  'platform',
  // SHY-0437. Set when somebody read the report guide and chose to raise a
  // ticket anyway. The acceptance signal for that ticket is the RATIO of people
  // who go on to report against people who come here instead, and without this
  // the ratio cannot be computed. An allowlist drops what it does not name, so
  // the client can send this all it likes until it appears here.
  'raisedAfterReportGuide',
];

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

    // The limits, enforced HERE (SHY-0420).
    //
    // The client bounds these too — images by size, video by duration, refused
    // before any upload starts so nobody spends a video's worth of mobile data
    // to be told no. That is a courtesy to honest callers; it is not a bound.
    // These files are opened by staff, and a minor cohort is present, so the
    // rule has to hold for a caller who never ran our client at all.
    //
    // Measured from what was actually STORED rather than from what the request
    // claims, because the request is the thing being checked.
    const refusal = await refusalForAttachedObjects(attachments.keys);
    if (refusal) {
      return res.status(400).json({ error: refusal });
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

    // How many are actually open, which is NOT how many are shown (SHY-0424).
    // The list above is capped at MAX_OPEN_TICKETS_LISTED for readability, and
    // the client was deriving "You already have N requests open" from its
    // length — so somebody with eight was told they had five.
    //
    // Counted server-side rather than by reading them all back: one
    // aggregation, exact, and no second unbounded query over somebody's whole
    // support history.
    //
    // A count that FAILS does not fail the listing. The summaries are the
    // useful part, and `openTicketsPayload` states the absence rather than
    // guessing from the list length, which is the defect itself.
    let openCount = null;
    try {
      const counted = await db
        .collection(COLLECTION)
        .where('userId', '==', uniqueId)
        .where('status', '==', STATUS_OPEN)
        .count()
        .get();
      openCount = counted.data().count;
    } catch (err) {
      log.warn('support-tickets', 'Could not count open tickets; omitting the count', {
        error: err.message,
      });
    }

    res.json(openTicketsPayload(tickets, openCount));
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

    // VIEWABLE, not retrievable (SHY-0420).
    //
    // This used to mint a signed GET URL per key, which is a download link: a
    // moderator could pull an arbitrary stranger's file — often a photograph
    // of a real person, sometimes of abuse — onto their own machine, and once
    // it is there we have no further say in it.
    //
    // The admin UI now asks for each attachment through
    // `/support-tickets/:id/attachments/:index`, which streams it back
    // inline. No URL the browser can hand to a download manager, no link that
    // outlives the session, and every view goes through a route that knows who
    // is asking.
    return res.json({
      attachments: keys.map((key, index) => ({
        index,
        viewUrl: `/api/support-tickets/${req.params.id}/attachments/${index}`,
        contentType: null,
      })),
    });
  } catch (err) {
    log.error('support-tickets', 'GET /api/support-tickets/:id/attachments failed', {
      error: err.message,
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Stream ONE attachment back for viewing (SHY-0420).
 *
 * `Content-Disposition: inline` and no signed URL anywhere: the file is shown,
 * not handed over. A moderator needs to SEE what somebody attached in order to
 * act on it; they do not need a copy of it on their laptop, and the difference
 * matters most for exactly the files this route carries.
 *
 * Addressed by INDEX rather than by key, so an admin cannot ask for an
 * arbitrary object by naming it — the ticket decides which objects exist.
 */
router.get('/support-tickets/:id/attachments/:index', writeLimiter, async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;

    const doc = await db.doc(`${COLLECTION}/${req.params.id}`).get();
    if (!doc.exists) return res.status(404).json({ error: 'Ticket not found' });

    const keys = doc.data().attachments ?? [];
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0 || index >= keys.length) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    const object = await getObject(keys[index]);
    if (!object || !object.Body) return res.status(404).json({ error: 'Attachment not found' });

    // Inline, and never as an attachment download. `nosniff` stops a browser
    // deciding a file is something more interesting than we said it was, and
    // `no-store` keeps it out of a shared cache on the way.
    res.setHeader('Content-Type', object.ContentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');

    // Streamed rather than buffered: these are photographs and video, and
    // holding one in memory per moderator view is a needless cost.
    return object.Body.pipe(res);
  } catch (err) {
    log.error('support-tickets', 'GET attachment stream failed', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── List tickets (admin) ───────────────────────────────────────

router.get('/support-tickets', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;

    const status = req.query.status;
    const LISTABLE_STATUSES = [STATUS_OPEN, STATUS_RESOLVED, STATUS_CONVERTED];
    if (status !== undefined && !LISTABLE_STATUSES.includes(status)) {
      return res.status(400).json({
        error: `status must be one of: ${LISTABLE_STATUSES.map((s) => `"${s}"`).join(', ')}`,
      });
    }

    const userId = req.query.userId;
    if (userId !== undefined && (typeof userId !== 'string' || userId.trim() === '')) {
      return res.status(400).json({ error: 'userId must be a non-empty string' });
    }

    let query = db.collection(COLLECTION);
    if (status) query = query.where('status', '==', status);
    if (userId) query = query.where('userId', '==', String(userId));

    // SHY-0495: the ORDER is dropped when filtering by user, on purpose.
    //
    // `where('userId') + orderBy('createdAt')` needs a COMPOSITE index, and
    // supportTickets has none defined -- so it would pass against the emulator
    // and fail at runtime on dev, which is the worst place to find out.
    // Multiple equality filters are served from single-field indexes, so the
    // filtered query needs no new index.
    //
    // Nothing is lost: unordered is what "all of this person's tickets" wants.
    // The unfiltered list keeps its newest-first window, which is what a
    // triage queue wants.
    if (!userId) query = query.orderBy('createdAt', 'desc');

    const tickets = await queryDocs(query.limit(200));

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

    // SHY-0439. Terminal means terminal: this ticket's conversation moved to
    // moderation, and moving it back into the support queue would put a safety
    // matter into a queue that is not for safety matters -- which is the whole
    // problem SHY-0437 exists to solve. Refused here rather than only hidden in
    // the admin UI, because a hidden control is a decision about one screen.
    if (ticket.status === STATUS_CONVERTED) {
      return res.status(409).json({
        error: `This ticket became report ${ticket.convertedToReportId} and cannot be changed`,
      });
    }

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

/**
 * Everything the person told us, in the order they told us — SHY-0438.
 *
 * A ticket is the opening message plus whatever they added afterwards
 * (`messages`, appended by `POST /support-tickets/:id/messages`). A report
 * carrying only the opening message is a report missing the half that arrived
 * once they had thought about it, which for a safety matter is often the half
 * that names what actually happened.
 */
function conversationText(ticket) {
  const parts = [];
  if (typeof ticket?.message === 'string' && ticket.message.trim().length > 0) {
    parts.push(ticket.message.trim());
  }
  const followUps = Array.isArray(ticket?.messages) ? ticket.messages : [];
  for (const entry of followUps) {
    const text = typeof entry?.message === 'string' ? entry.message.trim() : '';
    if (text.length > 0) parts.push(text);
  }
  return parts.join('\n\n');
}

/**
 * Which of a ticket's attachments are no longer in storage.
 *
 * Reported AFTER the report is filed, never used to refuse it: evidence that
 * has gone is a reason to tell the admin what is missing, not a reason to leave
 * a safety report unfiled. A storage error is treated as missing, because from
 * the moderator's point of view an object they cannot open is absent either way.
 */
async function missingAttachmentKeys(keys) {
  const missing = [];
  for (const key of keys) {
    try {
      const head = await headObject(key);
      if (!head) missing.push(key);
    } catch {
      missing.push(key);
    }
  }
  return missing;
}

// ─── Turn a ticket into a report (admin) ────────────────────────

/**
 * The escape hatch from SHY-0437, made honest — SHY-0438.
 *
 * Somebody who could not manage the report flow raises a ticket instead, and an
 * admin files the report for them. Without this the ticket is answered as
 * correspondence: no moderation triage, no count against the reported person,
 * nothing that catches a repeat pattern, and nothing that can be appealed.
 *
 * **"One click" has a limit that cannot be engineered away.** A report needs a
 * reportedUserId and a reason; a ticket carries neither. Reading the text and
 * deciding who it is about is the part only a person can do, so the admin
 * supplies those two and everything else is carried across.
 *
 * The write order is the safety property: the report is created FIRST, and the
 * ticket is closed only once that succeeded. A ticket closed permanently with
 * no report filed is the worst outcome this flow has, and it is the one a
 * convenient `Promise.all` would produce.
 */
router.post('/support-tickets/:id/convert-to-report', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;

    const body = req.body ?? {};
    const { reportedUserId, reason, reportedUserName } = body;
    if (typeof reportedUserId !== 'string' || reportedUserId.length === 0) {
      return res.status(400).json({ error: 'reportedUserId is required' });
    }
    if (typeof reason !== 'string' || reason.length === 0) {
      return res.status(400).json({ error: 'reason is required' });
    }

    const ticket = await getDoc(`${COLLECTION}/${req.params.id}`);
    if (!ticket) return res.status(404).json({ error: 'Support ticket not found' });

    // Refused rather than repeated. Two reports for one ticket would count the
    // same complaint twice against the reported person.
    if (ticket.status === STATUS_CONVERTED) {
      return res.status(409).json({
        error: `This ticket has already been turned into report ${ticket.convertedToReportId}`,
      });
    }

    // Server-authoritative, exactly as POST /reports does it: the suspension
    // cascade keys off this value, so a caller-supplied one would let whoever
    // holds the request choose which account an admin can suspend.
    const reportedUserUniqueId = await resolveUniqueId(reportedUserId);
    if (!reportedUserUniqueId) {
      return res.status(400).json({ error: 'reportedUserId does not match any known user' });
    }

    // A reporter who has since been deleted must not break conversion: their
    // words and evidence are still what moderation needs to act on.
    const reporter = await getDoc(`users/${ticket.userId}`);

    const reportId = generateId();
    const timestamp = now();

    let reportDocument;
    try {
      reportDocument = buildReportDocument({
        reporterUniqueId: ticket.userId,
        reporterName: reporter?.displayName ?? reporter?.display_name ?? null,
        reporterDocUniqueId: reporter?.uniqueId ?? reporter?.unique_id ?? null,
        reportedUserId,
        reportedUserName: reportedUserName || null,
        reportedUserUniqueId,
        // Their own words, whole. A follow-up is part of what they told us, and
        // a report carrying only the opening message is a report missing the
        // half that arrived after they thought about it.
        description: conversationText(ticket),
        reason,
        evidenceUrls: attachmentKeysOf(ticket),
        origin: REPORT_ORIGIN.SUPPORT_TICKET,
        sourceSupportTicketId: req.params.id,
        createdAt: timestamp,
      });
    } catch (err) {
      // Only what the builder itself refuses. Anything else is a fault in this
      // route, and must reach the 500 handler rather than being dressed up as
      // something the admin typed wrong.
      if (!(err instanceof ReportDocumentError)) throw err;
      return res.status(400).json({ error: err.message });
    }

    // FIRST. If this throws, the ticket is untouched and the person still has a
    // ticket somebody can answer.
    await db.doc(`reports/${reportId}`).set(reportDocument, { merge: true });

    await db.doc(`${COLLECTION}/${req.params.id}`).update({
      status: STATUS_CONVERTED,
      convertedToReportId: reportId,
      convertedBy: req.auth.uid,
      convertedAt: timestamp,
    });

    await db.collection('auditLog').add({
      adminUid: req.auth.uniqueId,
      action: 'support_ticket_convert_to_report',
      actionType: 'support_ticket_convert_to_report',
      targetType: 'support_ticket',
      targetId: req.params.id,
      details: { reportId, reason },
      timestamp,
    });

    // Reported after the fact rather than refused before it: evidence that has
    // gone is a reason to tell the admin, not a reason to leave a safety report
    // unfiled.
    const missingAttachments = await missingAttachmentKeys(reportDocument.evidenceUrls);

    res.json({ success: true, reportId, missingAttachments });
  } catch (err) {
    log.error('support-tickets', 'POST /api/support-tickets/:id/convert-to-report failed', {
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
