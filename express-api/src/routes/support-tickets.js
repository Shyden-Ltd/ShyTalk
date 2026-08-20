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
const { writeLimiter } = require('../middleware/rateLimit');
const log = require('../utils/log');

const COLLECTION = 'supportTickets';

/**
 * Bounded explicitly rather than truncated. Silently cutting somebody's message
 * in half loses the part they cared about and tells them nothing.
 */
const MAX_MESSAGE_LENGTH = 2000;
const MAX_ADMIN_NOTE_LENGTH = 2000;

/** Categories exist to help triage, so the set is closed. */
const CATEGORIES = ['age', 'account', 'payment', 'safety', 'other'];

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
    log.info('support-tickets', 'Support ticket raised', { ticketId, uniqueId, category });

    res.json({ success: true, ticketId });
  } catch (err) {
    log.error('support-tickets', 'POST /api/support-tickets failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
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
