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
const { db } = require('../utils/firebase');
const { getDoc, queryDocs } = require('../utils/firestore-helpers');
const { generateId, now } = require('../utils/helpers');
const { requireAdmin } = require('../middleware/auth');
const { getSignedPutUrl, getSignedGetUrl } = require('../utils/r2');
const { writeLimiter } = require('../middleware/rateLimit');
const log = require('../utils/log');

const COLLECTION = 'supportTickets';

/**
 * Bounded explicitly rather than truncated. Silently cutting somebody's message
 * in half loses the part they cared about and tells them nothing.
 */
const MAX_MESSAGE_LENGTH = 2000;
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
    const uploadUrl = await getSignedPutUrl(r2Key, contentType);

    return res.json({ uploadUrl, r2Key, expiresInSec: 300 });
  } catch (err) {
    log.error('support-tickets', 'POST /api/support-tickets/upload-url failed', {
      error: err.message,
    });
    return res.status(500).json({ error: 'Failed to issue upload URL' });
  }
});

// ─── Raise a ticket ─────────────────────────────────────────────

router.post('/support-tickets', writeLimiter, async (req, res) => {
  try {
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

    const existing = await queryDocs(
      db
        .collection(COLLECTION)
        .where('userId', '==', uniqueId)
        .where('status', '==', STATUS_OPEN)
        .limit(1),
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: 'You already have an open support request' });
    }

    const ticketId = generateId();
    await db.doc(`${COLLECTION}/${ticketId}`).set(
      {
        userId: uniqueId,
        message: message.trim(),
        category: category ?? 'other',
        context: sanitiseContext(body.context),
        attachments: attachments.keys,
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

router.get('/support-tickets/:id/attachments', async (req, res) => {
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
