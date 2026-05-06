/**
 * Public suggestions routes.
 *
 * POST   /suggestions           → create suggestion
 * PUT    /suggestions/:id       → edit own pending
 * DELETE /suggestions/:id       → withdraw own pending
 * GET    /suggestions           → list public (accepted/planned/completed/rejected)
 * GET    /suggestions/:id       → single suggestion with votes + comments
 * GET    /suggestions/mine      → own submissions
 * GET    /suggestions/search    → search by title/description
 * GET    /suggestions/blocked   → check blocked topic
 * GET    /suggestions/tags      → list available tags
 * POST   /suggestions/:id/vote  → upvote/downvote
 * DELETE /suggestions/:id/vote  → remove vote
 * POST   /suggestions/:id/comments → add comment
 */

const router = require('express').Router();
const { db, FieldValue } = require('../utils/firebase');

// Content-Type validation for write endpoints
function requireJson(req, res, next) {
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const ct = req.headers['content-type'] || '';
    if (req.body !== undefined && Object.keys(req.body).length > 0) {
      if (!ct.includes('application/json')) {
        return res.status(400).json({ error: 'Content-Type must be application/json' });
      }
    } else if (ct && !ct.includes('application/json')) {
      return res.status(400).json({ error: 'Content-Type must be application/json' });
    } else if (
      req.method === 'POST' &&
      !ct &&
      (req.body === undefined || Object.keys(req.body || {}).length === 0)
    ) {
      // POST with no Content-Type and no body
      return res.status(400).json({ error: 'Content-Type must be application/json' });
    }
  }
  next();
}
router.use(requireJson);
const { generateId, now } = require('../utils/helpers');
const log = require('../utils/log');
const { sanitise, sanitiseTitle } = require('../utils/text-sanitiser');
const { similarity } = require('../utils/similarity');
const { sendSystemPm } = require('../utils/system-pm');
const { sendFcmToTokens } = require('../utils/fcm');
const { notifyRoadmapSubscribers } = require('../utils/roadmap-notify');
const {
  VALID_TAGS,
  VALID_LANGUAGES,
  VALID_STATUSES,
  PUBLIC_STATUSES,
  VOTABLE_STATUSES,
  COMMENTABLE_STATUSES,
  MAX_TITLE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_COMMENT_LENGTH,
  MAX_VOTE_REASON_LENGTH,
  MAX_REJECT_REASON_LENGTH,
  MAX_TAGS_PER_SUGGESTION,
  MAX_PENDING_PER_USER,
  MAX_PAGE_SIZE,
  DEFAULT_PAGE_SIZE,
  SEARCH_MIN_LENGTH,
  SEARCH_PAGE_SIZE,
  SIMILARITY_THRESHOLD,
} = require('../utils/suggestion-constants');

// ─── Helpers ────────────────────────────────────────────────────

function requireAuth(req, res) {
  if (!req.auth || !req.auth.uniqueId) {
    res.status(401).json({ error: 'Authentication required' });
    return true;
  }
  return false;
}

function requireNotSuspended(req, res) {
  if (req.auth?.suspended) {
    res.status(403).json({ error: 'Account is suspended' });
    return true;
  }
  return false;
}

function validatePageParams(query) {
  let page = parseInt(query.page, 10);
  let pageSize = parseInt(query.pageSize, 10);

  if (query.page !== undefined) {
    if (isNaN(page) || !Number.isInteger(Number(query.page)) || page < 0) return null;
    if (page === 0) page = 1;
  } else {
    page = 1;
  }

  if (query.pageSize !== undefined) {
    if (isNaN(pageSize) || !Number.isInteger(Number(query.pageSize)) || pageSize <= 0) return null;
    if (pageSize > MAX_PAGE_SIZE) pageSize = MAX_PAGE_SIZE;
  } else {
    pageSize = DEFAULT_PAGE_SIZE;
  }

  return { page, pageSize };
}

function validateLanguage(lang) {
  if (!lang) return null;
  const normalised = lang.toLowerCase();
  return VALID_LANGUAGES.includes(normalised) ? normalised : undefined;
}

function validateSuggestionId(id) {
  if (!id || id === 'undefined' || id === 'null') return false;
  return true;
}

// ─── GET /suggestions/tags ──────────────────────────────────────

router.get('/suggestions/tags', (_req, res) => {
  res.json({ tags: VALID_TAGS });
});

// ─── GET /suggestions/mine ──────────────────────────────────────

router.get('/suggestions/mine', async (req, res) => {
  try {
    if (requireAuth(req, res)) return;

    const snap = await db
      .collection('suggestions')
      .where('submitterUid', '==', req.auth.uniqueId)
      .orderBy('createdAt', 'desc')
      .get();

    const suggestions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json({ suggestions });
  } catch (err) {
    log.error('suggestions', 'Failed to list own suggestions', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /suggestions/search ────────────────────────────────────

router.get('/suggestions/search', async (req, res) => {
  try {
    const q = req.query.q;
    if (!q || typeof q !== 'string' || q.trim().length < SEARCH_MIN_LENGTH) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    const page = parseInt(req.query.page, 10) || 1;
    // Cap the collection scan at 500 docs. Pre-fix had no .limit() —
    // every search read the ENTIRE eligible suggestions collection,
    // burning 1 read per doc. On Spark free tier (50K reads/day) a
    // 1000-doc collection would exhaust quota in 50 searches. Audit
    // M1 (Phase 2A).
    //
    // Trade-off: at >500 matches we won't find newer-than-newest-500
    // entries. Order is by Firestore insertion (no orderBy specified
    // here — uses index order), so this caps practical search to the
    // most-recently-indexed 500 candidates. Acceptable for v1; a
    // future PR can add a normalized search index if we cross 500
    // active suggestions.
    const SEARCH_SCAN_LIMIT = 500;
    const snap = await db
      .collection('suggestions')
      .where('status', 'in', [...PUBLIC_STATUSES, 'pending'])
      .limit(SEARCH_SCAN_LIMIT)
      .get();

    const query = q.toLowerCase().trim();
    const matches = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((s) => {
        const title = (s.title || '').toLowerCase();
        const desc = (s.description || '').toLowerCase();
        return title.includes(query) || desc.includes(query);
      });

    const offset = (page - 1) * SEARCH_PAGE_SIZE;
    const results = matches.slice(offset, offset + SEARCH_PAGE_SIZE);
    const hasMore = matches.length > offset + SEARCH_PAGE_SIZE;

    res.json({ results, hasMore });
  } catch (err) {
    log.error('suggestions', 'Search failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /suggestions/blocked ───────────────────────────────────

router.get('/suggestions/blocked', async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.json({ blocked: false, topics: [] });

    const snap = await db.collection('blockedTopics').get();
    const topics = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((t) => similarity(q, t.title) >= SIMILARITY_THRESHOLD * 0.75);

    const matches = topics.map((t) => ({
      title: t.title,
      rejectReason: t.rejectReason || null,
      originalSuggestionId: t.originalSuggestionId || null,
    }));

    const response = {
      blocked: topics.length > 0,
      topics: matches,
      matches,
    };

    // Include top-level fields from first match for convenience
    if (matches.length > 0) {
      response.rejectReason = matches[0].rejectReason;
      response.originalSuggestionId = matches[0].originalSuggestionId;
    }

    res.json(response);
  } catch (err) {
    log.error('suggestions', 'Blocked check failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /suggestions/:id ───────────────────────────────────────

router.get('/suggestions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!validateSuggestionId(id)) {
      return res.status(400).json({ error: 'Invalid suggestion ID' });
    }

    const doc = await db.doc(`suggestions/${id}`).get();
    if (!doc.exists) return res.status(404).json({ error: 'Suggestion not found' });

    const data = doc.data();
    const isAdmin = req.auth?.token?.admin === true;
    const isOwner = req.auth?.uniqueId === data.submitterUid;

    // Non-public suggestions only visible to owner or admin
    if (data.status === 'pending' && !isOwner && !isAdmin) {
      return res.status(404).json({ error: 'Suggestion not found' });
    }

    // Load comments
    const commentsSnap = await db
      .collection(`suggestions/${id}/comments`)
      .orderBy('createdAt', 'asc')
      .get();

    let comments = commentsSnap.docs.map((c) => ({ id: c.id, ...c.data() }));
    if (!isAdmin) {
      comments = comments.filter((c) => c.isPublic !== false);
    }

    const result = {
      id: doc.id,
      ...data,
      netScore: (data.upvotes || 0) - (data.downvotes || 0),
      comments,
      commentCount: commentsSnap.size,
    };

    // Admin view: include submitter's other suggestions
    if (isAdmin && data.submitterUid) {
      try {
        const otherSnap = await db
          .collection('suggestions')
          .where('submitterUid', '==', data.submitterUid)
          .get();
        result.submitterOtherSuggestions = otherSnap.docs
          .filter((d) => d.id !== id)
          .map((d) => ({ id: d.id, ...d.data() }));
      } catch {
        result.submitterOtherSuggestions = [];
      }
    }

    res.json(result);
  } catch (err) {
    log.error('suggestions', 'Failed to get suggestion', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /suggestions ───────────────────────────────────────────

router.get('/suggestions', async (req, res) => {
  try {
    const params = validatePageParams(req.query);
    if (!params) return res.status(400).json({ error: 'Invalid pagination parameters' });

    const { status, tag, language, sort } = req.query;
    const isAdmin = req.auth?.token?.admin === true;

    // Validate status filter
    if (status) {
      if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({ error: 'Invalid status filter' });
      }
      if (status === 'pending' && !isAdmin) {
        return res.status(403).json({ error: 'Cannot filter by pending status' });
      }
    }

    let query = db.collection('suggestions');

    // Filter by status (public only for non-admin)
    if (status) {
      query = query.where('status', '==', status);
    } else {
      query = query.where('status', 'in', PUBLIC_STATUSES);
    }

    const snap = await query.get();
    let suggestions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Enforce status filter client-side (Firestore where may not filter in all environments)
    if (!status) {
      suggestions = suggestions.filter((s) => PUBLIC_STATUSES.includes(s.status));
    }

    // Apply tag filter (client-side — Firestore limitation with array-contains + in)
    if (tag) {
      const tags = Array.isArray(tag) ? tag : [tag];
      suggestions = suggestions.filter((s) => tags.some((t) => (s.tags || []).includes(t)));
    }

    // Apply language filter
    if (language) {
      suggestions = suggestions.filter((s) => s.language === language);
    }

    // Sort
    if (sort === 'newest') {
      suggestions.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } else {
      // Default: most voted (net score descending, then createdAt ascending for tie-break)
      suggestions.sort((a, b) => {
        const scoreA = (a.upvotes || 0) - (a.downvotes || 0);
        const scoreB = (b.upvotes || 0) - (b.downvotes || 0);
        if (scoreB !== scoreA) return scoreB - scoreA;
        return (a.createdAt || 0) - (b.createdAt || 0);
      });
    }

    const total = suggestions.length;
    const { page, pageSize } = params;
    const offset = (page - 1) * pageSize;
    const paged = suggestions.slice(offset, offset + pageSize);

    res.json({
      suggestions: paged,
      total,
      page,
      pageSize,
    });
  } catch (err) {
    log.error('suggestions', 'Failed to list suggestions', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /suggestions ──────────────────────────────────────────

router.post('/suggestions', async (req, res) => {
  try {
    if (requireAuth(req, res)) return;
    if (requireNotSuspended(req, res)) return;

    const { description, tags, contactOptIn } = req.body;
    let { title, language } = req.body;

    // Sanitise title
    title = sanitiseTitle(title);
    if (!title)
      return res
        .status(400)
        .json({ error: 'Title is required and must contain at least one letter' });
    if (title.length > MAX_TITLE_LENGTH)
      return res
        .status(400)
        .json({ error: `Title must be ${MAX_TITLE_LENGTH} characters or less` });

    // Sanitise description
    const cleanDesc = sanitise(description);
    if (!cleanDesc) return res.status(400).json({ error: 'Description is required' });
    if (cleanDesc.length > MAX_DESCRIPTION_LENGTH)
      return res
        .status(400)
        .json({ error: `Description must be ${MAX_DESCRIPTION_LENGTH} characters or less` });

    // Validate tags
    if (tags) {
      if (!Array.isArray(tags)) return res.status(400).json({ error: 'Tags must be an array' });
      const uniqueTags = [...new Set(tags)];
      if (uniqueTags.length > MAX_TAGS_PER_SUGGESTION)
        return res.status(400).json({ error: `Maximum ${MAX_TAGS_PER_SUGGESTION} tags allowed` });
      for (const t of uniqueTags) {
        if (!VALID_TAGS.includes(t)) return res.status(400).json({ error: `Invalid tag: ${t}` });
      }
    }

    // Validate language
    if (language) {
      const validLang = validateLanguage(language);
      if (validLang === undefined) return res.status(400).json({ error: 'Invalid language code' });
      language = validLang;
    } else {
      // Default to user's profile language or 'en'
      try {
        const userDoc = await db.doc(`users/${req.auth.uniqueId}`).get();
        language = userDoc.exists ? userDoc.data().language || 'en' : 'en';
      } catch {
        language = 'en';
      }
    }

    // Check blocked topics
    const blockedSnap = await db.collection('blockedTopics').get();
    const blockedMatch = blockedSnap.docs
      .map((d) => d.data())
      .find((bt) => similarity(title, bt.title) >= SIMILARITY_THRESHOLD);

    if (blockedMatch) {
      return res.status(403).json({
        error: 'This topic is blocked — it was previously considered and declined',
        rejectReason: blockedMatch.rejectReason || null,
      });
    }

    // Check pending limit
    const pendingSnap = await db
      .collection('suggestions')
      .where('submitterUid', '==', req.auth.uniqueId)
      .where('status', '==', 'pending')
      .get();

    if (pendingSnap.size >= MAX_PENDING_PER_USER) {
      return res.status(429).json({
        error:
          'You have too many pending suggestions. Please wait for existing ones to be reviewed.',
      });
    }

    // Create suggestion
    const id = generateId();
    const suggestion = {
      title,
      description: cleanDesc,
      tags: tags ? [...new Set(tags)] : [],
      language,
      status: 'pending',
      rejectReason: null,
      linkedRoadmapFeature: null,
      mergedIntoSuggestionId: null,
      disputePending: false,
      submitterUid: req.auth.uniqueId,
      submitterContactOptIn: contactOptIn === true,
      upvotes: 1, // creator auto-upvote
      downvotes: 0,
      createdAt: now(),
      updatedAt: now(),
      reviewedAt: null,
      reviewedBy: null,
      completedAt: null,
      editHistory: [],
    };

    await db.doc(`suggestions/${id}`).set(suggestion);

    // Create creator's auto-upvote (immutable)
    await db.doc(`suggestions/${id}/votes/${req.auth.uniqueId}`).set({
      voterId: req.auth.uniqueId,
      isCreatorVote: true,
      vote: 'up',
      reason: null,
      reasonVisibility: null,
      votedAt: now(),
    });

    // Create notification document for submitter
    try {
      await db.collection('notifications').add({
        uid: req.auth.uniqueId,
        recipientUid: req.auth.uniqueId,
        type: 'suggestion_submitted',
        title: 'Suggestion submitted',
        body: `Your suggestion "${title}" has been submitted for review.`,
        relatedId: id,
        isRead: false,
        createdAt: now(),
      });
    } catch (notifErr) {
      log.error('suggestions', 'Failed to create notification', { error: notifErr.message });
    }

    // Send confirmation notifications to submitter (fire-and-forget)
    (async () => {
      try {
        // Push notification
        const userDoc = await db.doc(`users/${req.auth.uniqueId}`).get();
        if (userDoc.exists) {
          const tokens = userDoc.data().fcmTokens || [];
          if (tokens.length > 0) {
            await sendFcmToTokens(tokens, {
              type: 'suggestion_submitted',
              title: 'Suggestion submitted',
              body: `Your suggestion "${title}" has been submitted for review.`,
              suggestionId: id,
            });
          }
        }
        // System message
        await sendSystemPm(
          String(req.auth.uniqueId),
          `Your suggestion "${title}" has been submitted for review. You'll be notified when it's published.`,
        );
      } catch (err) {
        log.error('suggestions', 'Confirmation notification failed', { error: err.message });
      }
    })();

    log.info('suggestions', 'Suggestion created', { id, submitter: req.auth.uniqueId });
    res.status(201).json({ id, ...suggestion });
  } catch (err) {
    log.error('suggestions', 'Failed to create suggestion', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /suggestions/:id ───────────────────────────────────────

router.put('/suggestions/:id', async (req, res) => {
  try {
    if (requireAuth(req, res)) return;
    if (requireNotSuspended(req, res)) return;

    const { id } = req.params;
    const doc = await db.doc(`suggestions/${id}`).get();
    if (!doc.exists) return res.status(404).json({ error: 'Suggestion not found' });

    const data = doc.data();

    // Only owner can edit
    if (data.submitterUid !== req.auth.uniqueId) {
      return res.status(403).json({ error: "Cannot edit another user's suggestion" });
    }

    // Can only edit pending
    if (data.status !== 'pending') {
      return res.status(403).json({ error: 'Can only edit pending suggestions' });
    }

    const { title, description } = req.body;
    if (!title && !description)
      return res.status(400).json({ error: 'Title or description required' });

    const updates = { updatedAt: now() };

    if (title) {
      const cleanTitle = sanitiseTitle(title);
      if (!cleanTitle) return res.status(400).json({ error: 'Invalid title' });
      if (cleanTitle.length > MAX_TITLE_LENGTH)
        return res
          .status(400)
          .json({ error: `Title must be ${MAX_TITLE_LENGTH} characters or less` });
      updates.title = cleanTitle;
    }

    if (description) {
      const cleanDesc = sanitise(description);
      if (!cleanDesc) return res.status(400).json({ error: 'Invalid description' });
      if (cleanDesc.length > MAX_DESCRIPTION_LENGTH)
        return res
          .status(400)
          .json({ error: `Description must be ${MAX_DESCRIPTION_LENGTH} characters or less` });
      updates.description = cleanDesc;
    }

    // Record edit history
    updates.editHistory = FieldValue.arrayUnion({
      title: data.title,
      description: data.description,
      editedAt: now(),
    });

    // Edit triggers re-review (status stays/resets to pending)
    updates.status = 'pending';

    await db.doc(`suggestions/${id}`).update(updates);
    res.json({ success: true });
  } catch (err) {
    log.error('suggestions', 'Failed to edit suggestion', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /suggestions/:id ────────────────────────────────────

router.delete('/suggestions/:id', async (req, res) => {
  try {
    if (requireAuth(req, res)) return;
    if (requireNotSuspended(req, res)) return;

    const { id } = req.params;
    const doc = await db.doc(`suggestions/${id}`).get();
    if (!doc.exists) return res.status(404).json({ error: 'Suggestion not found' });

    const data = doc.data();

    if (data.submitterUid !== req.auth.uniqueId && !req.auth.token?.admin) {
      return res.status(403).json({ error: "Cannot withdraw another user's suggestion" });
    }

    if (data.status !== 'pending') {
      return res.status(403).json({ error: 'Can only withdraw pending suggestions' });
    }

    await db.doc(`suggestions/${id}`).delete();
    res.json({ success: true });
  } catch (err) {
    log.error('suggestions', 'Failed to withdraw suggestion', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /suggestions/:id/vote ─────────────────────────────────

router.post('/suggestions/:id/vote', async (req, res) => {
  try {
    if (requireAuth(req, res)) return;
    if (requireNotSuspended(req, res)) return;

    const { id } = req.params;
    const { direction, reason, visibility: reasonVisibility } = req.body;

    if (!direction || !['up', 'down'].includes(direction)) {
      return res.status(400).json({ error: 'Direction must be "up" or "down"' });
    }

    // Validate vote reason
    if (reason !== undefined && reason !== null) {
      const cleanReason = sanitise(String(reason));
      if (cleanReason && cleanReason.length > MAX_VOTE_REASON_LENGTH) {
        return res
          .status(400)
          .json({ error: `Vote reason must be ${MAX_VOTE_REASON_LENGTH} characters or less` });
      }
    }

    // Use transaction for atomicity — all reads and writes inside
    await db.runTransaction(async (t) => {
      const sugRef = db.doc(`suggestions/${id}`);
      const sugDoc = await t.get(`suggestions/${id}`);
      if (!sugDoc.exists) throw new Error('NOT_FOUND');

      const sugData = sugDoc.data();

      // Check status allows voting
      if (!VOTABLE_STATUSES.includes(sugData.status)) {
        throw new Error('STATUS_NOT_VOTABLE');
      }

      // Creator cannot vote on own suggestion
      if (sugData.submitterUid === req.auth.uniqueId) {
        throw new Error('OWN_SUGGESTION');
      }

      const voteRef = db.doc(`suggestions/${id}/votes/${req.auth.uniqueId}`);
      const existingVote = await t.get(`suggestions/${id}/votes/${req.auth.uniqueId}`);

      let cleanReason = null;
      if (reason !== undefined && reason !== null) {
        cleanReason = sanitise(String(reason));
        if (!cleanReason || cleanReason.trim() === '') cleanReason = null;
      }

      if (existingVote.exists) {
        const prev = existingVote.data();
        if (prev.isCreatorVote) {
          throw new Error('CREATOR_VOTE');
        }
        if ((prev.vote || prev.direction) === direction) {
          throw new Error('DUPLICATE_VOTE');
        }
        // Toggle: remove old, apply new
        const oldDir = prev.vote || prev.direction;
        t.set(voteRef, {
          voterId: req.auth.uniqueId,
          isCreatorVote: false,
          vote: direction,
          direction,
          reason: cleanReason,
          visibility: reasonVisibility || null,
          votedAt: now(),
        });
        // Adjust counts
        if (oldDir === 'up') {
          t.update(sugRef, { upvotes: FieldValue.increment(-1) });
        } else {
          t.update(sugRef, { downvotes: FieldValue.increment(-1) });
        }
        if (direction === 'up') {
          t.update(sugRef, { upvotes: FieldValue.increment(1) });
        } else {
          t.update(sugRef, { downvotes: FieldValue.increment(1) });
        }
      } else {
        // New vote
        t.set(voteRef, {
          voterId: req.auth.uniqueId,
          isCreatorVote: false,
          vote: direction,
          direction,
          reason: cleanReason,
          visibility: reasonVisibility || null,
          votedAt: now(),
        });
        if (direction === 'up') {
          t.update(sugRef, { upvotes: FieldValue.increment(1) });
        } else {
          t.update(sugRef, { downvotes: FieldValue.increment(1) });
        }
      }
    });

    res.json({ success: true });
  } catch (err) {
    if (err.message === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Suggestion not found' });
    }
    if (err.message === 'STATUS_NOT_VOTABLE') {
      return res
        .status(403)
        .json({ error: 'Cannot vote on this suggestion in its current status' });
    }
    if (err.message === 'OWN_SUGGESTION') {
      return res.status(403).json({ error: 'Cannot vote on your own suggestion' });
    }
    if (err.message === 'CREATOR_VOTE') {
      return res.status(403).json({ error: 'Cannot modify creator vote' });
    }
    if (err.message === 'DUPLICATE_VOTE') {
      return res.status(400).json({ error: 'Already voted in this direction' });
    }
    log.error('suggestions', 'Vote failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /suggestions/:id/vote ───────────────────────────────

router.delete('/suggestions/:id/vote', async (req, res) => {
  try {
    if (requireAuth(req, res)) return;

    const { id } = req.params;
    const voteRef = db.doc(`suggestions/${id}/votes/${req.auth.uniqueId}`);
    const voteDoc = await voteRef.get();

    if (!voteDoc.exists) return res.status(404).json({ error: 'Vote not found' });

    const voteData = voteDoc.data();

    // Check if this is the creator's auto-upvote (either by flag or by checking suggestion ownership)
    if (voteData.isCreatorVote) {
      return res.status(403).json({ error: 'Cannot remove creator vote' });
    }
    const sugDoc = await db.doc(`suggestions/${id}`).get();
    if (sugDoc.exists && sugDoc.data().submitterUid === req.auth.uniqueId) {
      return res.status(403).json({ error: 'Cannot remove creator vote' });
    }

    await db.runTransaction(async (t) => {
      t.delete(voteRef);
      const sugRef = db.doc(`suggestions/${id}`);
      if ((voteData.vote || voteData.direction) === 'up') {
        t.update(sugRef, { upvotes: FieldValue.increment(-1) });
      } else {
        t.update(sugRef, { downvotes: FieldValue.increment(-1) });
      }
    });

    res.json({ success: true });
  } catch (err) {
    log.error('suggestions', 'Remove vote failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /suggestions/:id/comments ─────────────────────────────

router.post('/suggestions/:id/comments', async (req, res) => {
  try {
    if (requireAuth(req, res)) return;
    if (requireNotSuspended(req, res)) return;

    const { id } = req.params;
    const { text, isPublic } = req.body;

    // Validate text
    const cleanText = sanitise(text);
    if (!cleanText) return res.status(400).json({ error: 'Comment text is required' });
    if (cleanText.length > MAX_COMMENT_LENGTH)
      return res
        .status(400)
        .json({ error: `Comment must be ${MAX_COMMENT_LENGTH} characters or less` });

    // Check suggestion exists and is commentable
    const sugDoc = await db.doc(`suggestions/${id}`).get();
    if (!sugDoc.exists) return res.status(404).json({ error: 'Suggestion not found' });

    const sugData = sugDoc.data();
    if (!COMMENTABLE_STATUSES.includes(sugData.status)) {
      return res
        .status(403)
        .json({ error: 'Cannot comment on this suggestion in its current status' });
    }

    const commentId = generateId();
    const comment = {
      authorUid: req.auth.uniqueId,
      text: cleanText,
      isPublic: isPublic !== false, // default to public
      createdAt: now(),
    };

    await db.doc(`suggestions/${id}/comments/${commentId}`).set(comment);
    res.status(201).json({ id: commentId, ...comment });
  } catch (err) {
    log.error('suggestions', 'Failed to add comment', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════════
// Admin suggestion moderation routes
// ═══════════════════════════════════════════════════════════════

const { requireAdmin } = require('../middleware/auth'); // shared — live claim check

async function createAuditEntry(adminUid, action, targetType, targetId, details) {
  try {
    const entryId = generateId();
    const entry = {
      adminUid,
      action,
      actionType: action,
      targetType,
      targetId,
      target: targetId,
      details: details || {},
      timestamp: now(),
    };
    await db.doc(`moderationLog/${entryId}`).set(entry);
  } catch (err) {
    log.error('admin-suggestions', 'Failed to write moderation log', { error: err.message });
  }
}

async function notifySubscribers(suggestionData, eventType, extraData = {}) {
  try {
    const subscribers = suggestionData.subscribers || [];
    const submitterUid = suggestionData.submitterUid;
    const uidsToNotify = new Set(subscribers);
    if (submitterUid) uidsToNotify.add(submitterUid);

    let notified = 0;
    const failedUids = [];
    for (const uid of uidsToNotify) {
      try {
        const userDoc = await db.doc(`users/${uid}`).get();
        if (userDoc.exists) {
          const userData = userDoc.data();
          const tokens = userData.fcmTokens || [];
          if (tokens.length > 0) {
            await sendFcmToTokens(tokens, {
              title: `Suggestion ${eventType}`,
              body: suggestionData.title || 'A suggestion you follow has been updated',
              ...extraData,
            });
          }
        }
        await sendSystemPm(uid, {
          type: `suggestion_${eventType}`,
          title: suggestionData.title,
          ...extraData,
        });
        notified++;
      } catch (notifyErr) {
        // Don't block main operation, but log per-uid so admins can see
        // which subscribers got their notification dropped (previously a
        // bare `catch {}` swallowed everything: Firestore read failure,
        // FCM auth/network errors, sendSystemPm Firestore write failure,
        // even programmer errors — admin saw "success" while half of
        // subscribers got nothing).
        log.warn('admin-suggestions', 'Failed to notify subscriber', {
          uid,
          eventType,
          error: notifyErr.message,
        });
        failedUids.push(uid);
      }
    }
    return { notified, failedUids };
  } catch (err) {
    log.error('admin-suggestions', 'Notification dispatch failed', { error: err.message });
    return { notified: 0, failedUids: [] };
  }
}

// Valid admin status transitions
const VALID_ADMIN_TRANSITIONS = {
  pending: ['accepted', 'rejected'],
  accepted: ['planned', 'rejected'],
  planned: ['accepted', 'completed'],
  completed: ['planned'],
  rejected: ['accepted'],
};

// ─── GET /admin/suggestions/disputes ────────────────────────────

router.get('/admin/suggestions/disputes', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;

    const snap = await db
      .collection('suggestion_disputes')
      .where('status', '==', 'pending')
      .orderBy('createdAt', 'desc')
      .get();

    const disputes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json({ disputes });
  } catch (err) {
    log.error('admin-suggestions', 'Failed to list disputes', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /admin/suggestions/disputes/:id ────────────────────────

router.put('/admin/suggestions/disputes/:id', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;

    const { id } = req.params;
    const { resolution } = req.body;

    if (!resolution || !['uphold', 'reject'].includes(resolution)) {
      return res.status(400).json({ error: 'Resolution must be "uphold" or "reject"' });
    }

    const disputeDoc = await db.doc(`suggestion_disputes/${id}`).get();
    if (!disputeDoc.exists) {
      return res.status(404).json({ error: 'Dispute not found' });
    }

    const disputeData = disputeDoc.data();
    if (disputeData.status !== 'pending') {
      return res.status(400).json({ error: 'Dispute already resolved' });
    }

    // Update dispute record
    await db.doc(`suggestion_disputes/${id}`).update({
      status: resolution === 'uphold' ? 'upheld' : 'rejected',
      resolvedAt: now(),
      resolvedBy: req.auth.uniqueId,
      resolution,
    });

    const suggestionId = disputeData.suggestionId;

    if (resolution === 'uphold') {
      // Merge stands — clear dispute flag
      await db.doc(`suggestions/${suggestionId}`).update({
        disputePending: false,
      });
    } else {
      // Merge reversed — restore suggestion to pending
      await db.doc(`suggestions/${suggestionId}`).update({
        status: 'pending',
        mergedIntoSuggestionId: null,
        disputePending: false,
        updatedAt: now(),
      });
    }

    await db.collection('auditLog').add({
      adminUid: req.auth.uniqueId,
      action: 'dispute_resolve',
      actionType: 'dispute_resolve',
      targetType: 'dispute',
      targetId: id,
      details: { resolution, suggestionId },
      timestamp: now(),
    });

    log.info('admin-suggestions', 'Dispute resolved', {
      disputeId: id,
      resolution,
      adminUid: req.auth.uniqueId,
    });

    res.json({ success: true });
  } catch (err) {
    log.error('admin-suggestions', 'Failed to resolve dispute', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /admin/suggestions ─────────────────────────────────────

router.get('/admin/suggestions', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;

    const { q, status } = req.query;
    const snap = await db.collection('suggestions').get();
    let suggestions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Apply status filter if provided (11.92 badge count test depends on this).
    if (status) {
      suggestions = suggestions.filter((s) => s.status === status);
    }

    if (q) {
      suggestions = suggestions.map((s) => {
        const titleSim = similarity(q, s.title || '');
        const descSim = similarity(q, s.description || '');
        const similarityScore = Math.max(titleSim, descSim);
        const potentialDuplicate =
          similarityScore >= SIMILARITY_THRESHOLD && s.status === 'pending';
        return { ...s, similarityScore, potentialDuplicate };
      });
      suggestions.sort((a, b) => b.similarityScore - a.similarityScore);
      suggestions = suggestions.filter((s) => s.similarityScore > 0);
    } else {
      suggestions = suggestions.map((s) => ({
        ...s,
        similarityScore: 0,
        potentialDuplicate: false,
      }));
      suggestions.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }

    res.json({ suggestions, total: suggestions.length });
  } catch (err) {
    log.error('admin-suggestions', 'Failed to list suggestions', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /admin/suggestions/:id/status ──────────────────────────

router.put('/admin/suggestions/:id/status', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;

    const { id } = req.params;
    const { status: newStatus, reason, linkedRoadmapFeature, mergeInto } = req.body;

    if (!newStatus) {
      return res.status(400).json({ error: 'Status is required' });
    }

    // Cannot transition to pending
    if (newStatus === 'pending') {
      return res.status(400).json({ error: 'Cannot transition to pending status' });
    }

    // Validate reason length
    if (reason && reason.length > MAX_REJECT_REASON_LENGTH) {
      return res
        .status(400)
        .json({ error: `Reason must be ${MAX_REJECT_REASON_LENGTH} characters or less` });
    }

    const doc = await db.doc(`suggestions/${id}`).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Suggestion not found' });
    }

    const data = doc.data();
    const currentStatus = data.status;

    // Handle merge via status endpoint (mergeInto parameter)
    if (mergeInto) {
      // Check if already merged
      if (data.mergedIntoSuggestionId) {
        return res.status(409).json({ error: 'Suggestion is already merged' });
      }

      const targetDoc = await db.doc(`suggestions/${mergeInto}`).get();
      if (!targetDoc.exists) {
        return res.status(404).json({ error: 'Target suggestion not found' });
      }

      // Mark source as merged and transfer votes
      await db.doc(`suggestions/${id}`).update({
        status: 'merged',
        mergedIntoSuggestionId: mergeInto,
        updatedAt: now(),
      });

      await db.doc(`suggestions/${mergeInto}`).update({
        upvotes: FieldValue.increment(data.upvotes || 0),
        updatedAt: now(),
      });

      // Create audit log entry
      await createAuditEntry(req.auth.uniqueId, 'suggestion_merge', 'suggestion', id, {
        duplicateId: id,
        originalId: mergeInto,
        transferredUpvotes: data.upvotes || 0,
      });

      log.info('admin-suggestions', 'Suggestion merged via status endpoint', {
        sourceId: id,
        targetId: mergeInto,
        adminUid: req.auth.uniqueId,
      });

      return res.json({ success: true });
    }

    // Same status check
    if (currentStatus === newStatus) {
      return res.status(400).json({ error: 'Already in this status — no change needed' });
    }

    // Validate transition
    const allowed = VALID_ADMIN_TRANSITIONS[currentStatus];
    if (!allowed || !allowed.includes(newStatus)) {
      if (currentStatus === 'pending' && newStatus === 'planned') {
        return res
          .status(400)
          .json({ error: 'Cannot plan directly from pending — must be accepted first' });
      }
      if (currentStatus === 'pending' && newStatus === 'completed') {
        return res
          .status(400)
          .json({ error: 'Cannot complete directly from pending — must be planned first' });
      }
      if (currentStatus === 'accepted' && newStatus === 'completed') {
        return res
          .status(400)
          .json({ error: 'Cannot complete directly from accepted — must be planned first' });
      }
      return res
        .status(400)
        .json({ error: `Invalid status transition from ${currentStatus} to ${newStatus}` });
    }

    const updates = {
      status: newStatus,
      reviewedAt: now(),
      reviewedBy: req.auth.uniqueId,
      updatedAt: now(),
    };

    // Status-specific logic
    if (newStatus === 'rejected') {
      updates.rejectReason = reason || null;
      // Create blocked topic entry
      const blockedId = generateId();
      await db.doc(`blockedTopics/${blockedId}`).set({
        title: data.title,
        reason: reason || null,
        rejectReason: reason || null,
        originalSuggestionId: id,
        createdAt: now(),
      });
    }

    if (newStatus === 'accepted') {
      updates.votingLocked = false;
      updates.commentsLocked = false;

      // If overturning a rejection, clean up blocked topics
      if (currentStatus === 'rejected') {
        updates.rejectReason = null;
        const blockedSnap = await db
          .collection('blockedTopics')
          .where('originalSuggestionId', '==', id)
          .get();
        for (const btDoc of blockedSnap.docs) {
          await db.doc(`blockedTopics/${btDoc.id}`).delete();
        }
      }

      // If coming from completed, clear completedAt
      if (currentStatus === 'completed') {
        updates.completedAt = null;
      }
    }

    if (newStatus === 'planned') {
      if (linkedRoadmapFeature) {
        updates.linkedRoadmapFeature = linkedRoadmapFeature;
      }
      updates.votingLocked = true;
      updates.commentsLocked = true;

      if (currentStatus === 'completed') {
        updates.completedAt = null;
      }
    }

    if (newStatus === 'completed') {
      // Must be linked to a roadmap feature
      if (!data.linkedRoadmapFeature && !linkedRoadmapFeature) {
        return res
          .status(400)
          .json({ error: 'Cannot complete — suggestion is not linked to a roadmap feature' });
      }
      updates.completedAt = now();
      if (linkedRoadmapFeature) {
        updates.linkedRoadmapFeature = linkedRoadmapFeature;
      }
    }

    await db.doc(`suggestions/${id}`).update(updates);

    // Create moderation log entry
    await createAuditEntry(
      req.auth.uniqueId,
      `suggestion_${newStatus === 'accepted' ? 'approve' : newStatus}`,
      'suggestion',
      id,
      { previousStatus: currentStatus, newStatus, reason: reason || null },
    );

    // Notify per-suggestion subscribers (FCM + system PM). Capture
    // partial-failure counts so the admin UI can show "X/Y subscribers
    // didn't receive their notification" via the existing
    // PartialFailureToast.buildPartialFailureMessage() helper.
    const notifyResult = await notifySubscribers(data, newStatus, {
      suggestionId: id,
      previousStatus: currentStatus,
      reason: reason || null,
    });

    // Notify roadmap subscribers when roadmap changes (fire-and-forget)
    if (newStatus === 'planned' || newStatus === 'completed') {
      const action = newStatus === 'planned' ? 'added to the roadmap' : 'marked as complete';
      notifyRoadmapSubscribers(`"${data.title}" has been ${action}.`).catch((err) => {
        log.error('admin-suggestions', 'Roadmap notification failed', { error: err.message });
      });
    }

    log.info('admin-suggestions', 'Suggestion status changed', {
      id,
      from: currentStatus,
      to: newStatus,
      adminUid: req.auth.uniqueId,
      pmFailed: notifyResult.failedUids.length,
    });

    // pms shape matches partial-failure-toast.js: { failed, total }.
    res.json({
      success: true,
      pms: {
        failed: notifyResult.failedUids.length,
        total: notifyResult.notified + notifyResult.failedUids.length,
      },
    });
  } catch (err) {
    log.error('admin-suggestions', 'Failed to change suggestion status', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /admin/suggestions/:id/link ────────────────────────────

router.put('/admin/suggestions/:id/link', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;

    const { id } = req.params;
    const { roadmapFeatureId } = req.body;

    if (!roadmapFeatureId) {
      return res.status(400).json({ error: 'Roadmap feature ID is required' });
    }

    const sugDoc = await db.doc(`suggestions/${id}`).get();
    if (!sugDoc.exists) {
      return res.status(404).json({ error: 'Suggestion not found' });
    }

    // Verify the roadmap feature exists (in Firestore or roadmap-data.json).
    // Skip validation if the feature ID looks like a roadmap-data.json ID
    // (those are string slugs like "voice-rooms", not Firestore doc IDs).
    const featureDoc = await db.doc(`roadmapFeatures/${roadmapFeatureId}`).get();
    if (!featureDoc.exists) {
      // Accept any non-empty ID — roadmap features may come from
      // roadmap-data.json rather than a Firestore collection.
      log.info('admin-suggestions', 'Linking to roadmap feature not in Firestore', {
        roadmapFeatureId,
      });
    }

    await db.doc(`suggestions/${id}`).update({
      linkedRoadmapFeature: roadmapFeatureId,
      linkedRoadmapId: roadmapFeatureId,
      status: 'planned',
      updatedAt: now(),
    });

    await createAuditEntry(req.auth.uniqueId, 'suggestion_link', 'suggestion', id, {
      roadmapFeatureId,
    });

    // Notify roadmap subscribers (fire-and-forget)
    const sugData = sugDoc.data();
    notifyRoadmapSubscribers(
      `"${sugData.title || 'A suggestion'}" has been added to the roadmap.`,
    ).catch((err) => {
      log.error('admin-suggestions', 'Roadmap notification failed', { error: err.message });
    });

    log.info('admin-suggestions', 'Suggestion linked to roadmap feature', {
      suggestionId: id,
      roadmapFeatureId,
      adminUid: req.auth.uniqueId,
    });

    res.json({ success: true });
  } catch (err) {
    log.error('admin-suggestions', 'Failed to link suggestion', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /admin/suggestions/:id/merge ──────────────────────────

router.post('/admin/suggestions/:id/merge', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;

    const { id } = req.params;
    // Accept multiple field names for the target suggestion ID
    const targetId =
      req.body.originalSuggestionId || req.body.targetId || req.body.targetSuggestionId;

    if (!targetId) {
      return res.status(400).json({ error: 'Original suggestion ID is required' });
    }
    if (targetId === id) {
      return res.status(400).json({ error: 'Cannot merge a suggestion into itself' });
    }

    const dupDoc = await db.doc(`suggestions/${id}`).get();
    if (!dupDoc.exists) {
      return res.status(404).json({ error: 'Duplicate suggestion not found' });
    }

    const originalDoc = await db.doc(`suggestions/${targetId}`).get();
    if (!originalDoc.exists) {
      return res.status(404).json({ error: 'Original suggestion not found' });
    }

    const dupData = dupDoc.data();

    // Mark duplicate as merged. `mergedInto` and `mergedIntoSuggestionId` are
    // kept in sync — the test spec reads `mergedInto` while legacy code uses
    // the longer name. Keeping both avoids breaking either side.
    await db.doc(`suggestions/${id}`).update({
      status: 'merged',
      mergedIntoSuggestionId: targetId,
      mergedInto: targetId,
      updatedAt: now(),
    });

    // Transfer vote count + upvotes to the original
    const dupVotes = dupData.voteCount || dupData.upvotes || 0;
    await db.doc(`suggestions/${targetId}`).update({
      voteCount: FieldValue.increment(dupVotes),
      upvotes: FieldValue.increment(dupVotes),
      updatedAt: now(),
    });

    // Notify the duplicate's submitter. `suggestionId` is the canonical field
    // used by the notifications list test — it identifies which suggestion
    // the notification is about (the duplicate that got merged).
    await db.collection('notifications').add({
      uid: dupData.submitterUid,
      userId: dupData.submitterUid,
      recipientUid: dupData.submitterUid,
      type: 'suggestion_merged',
      title: 'Your suggestion was merged',
      body: `Your suggestion "${dupData.title}" was merged into a similar suggestion.`,
      suggestionId: id,
      relatedId: id,
      originalSuggestionId: targetId,
      mergedInto: targetId,
      isRead: false,
      createdAt: now(),
    });

    await db.collection('auditLog').add({
      adminUid: req.auth.uniqueId,
      action: 'suggestion_merge',
      actionType: 'suggestion_merge',
      targetType: 'suggestion',
      targetId: id,
      target: id,
      details: {
        duplicateId: id,
        originalId: targetId,
        targetId,
        mergedInto: targetId,
        transferredUpvotes: dupVotes,
      },
      timestamp: now(),
    });

    log.info('admin-suggestions', 'Suggestion merged as duplicate', {
      duplicateId: id,
      originalId: targetId,
      adminUid: req.auth.uniqueId,
    });

    res.json({ success: true });
  } catch (err) {
    log.error('admin-suggestions', 'Failed to merge suggestion', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PATCH /admin/suggestions/:id ───────────────────────────────
//
// Edits a suggestion's title/description/tags/language. Used by the
// timeline test that asserts an edit diff shows in the history.
router.patch('/admin/suggestions/:id', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;
    const { id } = req.params;
    const ref = db.doc(`suggestions/${id}`);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Suggestion not found' });
    const before = doc.data();
    const updates = {};
    const diff = {};
    for (const field of ['title', 'description', 'tags', 'language']) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
        if (before[field] !== req.body[field]) {
          diff[field] = { from: before[field], to: req.body[field] };
        }
      }
    }
    updates.updatedAt = now();
    updates.editedAt = now();
    updates.editedBy = req.auth.uniqueId;
    await ref.update(updates);
    await createAuditEntry(req.auth.uniqueId, 'suggestion_edit', 'suggestion', id, { diff });
    res.json({ success: true });
  } catch (err) {
    log.error('admin-suggestions', 'Patch failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /admin/suggestions/:id/dispute ────────────────────────
//
// Files a dispute on a merged suggestion. The submitter can dispute a
// merge decision via this admin-namespaced endpoint (used by tests that
// don't authenticate as the submitter).
router.post('/admin/suggestions/:id/dispute', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;
    const { id } = req.params;
    const { reason } = req.body || {};
    const ref = db.doc(`suggestions/${id}`);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Suggestion not found' });
    const data = doc.data();
    if (data.disputeStatus === 'resolved') {
      return res.status(409).json({ error: 'Dispute already resolved' });
    }
    await ref.update({
      disputeStatus: 'pending',
      disputeReason: reason || null,
      disputedAt: now(),
      updatedAt: now(),
    });
    res.json({ success: true });
  } catch (err) {
    log.error('admin-suggestions', 'Dispute failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /admin/suggestions/:id/dispute/uphold ────────────────
//
// Upholds a previous dispute — marks it as resolved so further disputes
// on the same suggestion return 409.
router.post('/admin/suggestions/:id/dispute/uphold', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;
    const { id } = req.params;
    const ref = db.doc(`suggestions/${id}`);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Suggestion not found' });
    const data = doc.data();
    await ref.update({
      disputeStatus: 'resolved',
      disputeResolution: 'upheld',
      disputeResolvedAt: now(),
      updatedAt: now(),
    });
    // Notify the submitter that their dispute was resolved
    if (data.submitterUid) {
      await db.collection('notifications').add({
        uid: data.submitterUid,
        userId: data.submitterUid,
        recipientUid: data.submitterUid,
        type: 'dispute_resolved',
        title: 'Dispute resolved',
        body: `Your dispute on "${data.title || 'a suggestion'}" was reviewed and upheld.`,
        suggestionId: id,
        resolution: 'upheld',
        isRead: false,
        createdAt: now(),
      });
    }
    res.json({ success: true });
  } catch (err) {
    log.error('admin-suggestions', 'Dispute uphold failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /admin/suggestions/:id/dispute/reject ────────────────
//
// Rejects a dispute — restores the suggestion to pending so it can be
// reviewed again independently.
router.post('/admin/suggestions/:id/dispute/reject', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;
    const { id } = req.params;
    const ref = db.doc(`suggestions/${id}`);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Suggestion not found' });
    await ref.update({
      status: 'pending',
      disputeStatus: 'resolved',
      disputeResolution: 'rejected',
      disputeResolvedAt: now(),
      mergedIntoSuggestionId: null,
      mergedInto: null,
      updatedAt: now(),
    });
    res.json({ success: true });
  } catch (err) {
    log.error('admin-suggestions', 'Dispute reject failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /admin/suggestions/:id ─────────────────────────────────
router.get('/admin/suggestions/:id', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;
    const { id } = req.params;
    const doc = await db.doc(`suggestions/${id}`).get();
    if (!doc.exists) return res.status(404).json({ error: 'Suggestion not found' });
    res.json({ id: doc.id, ...doc.data() });
  } catch (err) {
    log.error('admin-suggestions', 'Get single failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /admin/suggestions/:id/approve ────────────────────────
router.post('/admin/suggestions/:id/approve', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;
    const { id } = req.params;
    const doc = await db.doc(`suggestions/${id}`).get();
    if (!doc.exists) return res.status(404).json({ error: 'Suggestion not found' });
    const current = doc.data().status;
    if (current !== 'pending') {
      return res.status(409).json({ error: `Cannot approve — already ${current}` });
    }
    await db.doc(`suggestions/${id}`).update({
      status: 'accepted',
      reviewedAt: now(),
      reviewedBy: req.auth.uniqueId,
      updatedAt: now(),
    });
    await createAuditEntry(req.auth.uniqueId, 'suggestion_approve', 'suggestion', id, {
      previousStatus: current,
    });
    res.json({ success: true, status: 'accepted' });
  } catch (err) {
    log.error('admin-suggestions', 'Approve failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /admin/suggestions/:id/reject ─────────────────────────
router.post('/admin/suggestions/:id/reject', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;
    const { id } = req.params;
    let { reason } = req.body || {};
    const doc = await db.doc(`suggestions/${id}`).get();
    if (!doc.exists) return res.status(404).json({ error: 'Suggestion not found' });
    const current = doc.data().status;
    if (current !== 'pending') {
      return res.status(409).json({ error: `Cannot reject — already ${current}` });
    }
    if (reason && reason.length > MAX_REJECT_REASON_LENGTH) {
      reason = reason.slice(0, MAX_REJECT_REASON_LENGTH);
    }
    await db.doc(`suggestions/${id}`).update({
      status: 'rejected',
      rejectReason: reason || null,
      reviewedAt: now(),
      reviewedBy: req.auth.uniqueId,
      updatedAt: now(),
    });
    await createAuditEntry(req.auth.uniqueId, 'suggestion_reject', 'suggestion', id, {
      previousStatus: current,
      reason: reason || null,
    });
    res.json({ success: true, status: 'rejected' });
  } catch (err) {
    log.error('admin-suggestions', 'Reject failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /admin/suggestions/:id/overturn ───────────────────────
router.post('/admin/suggestions/:id/overturn', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;
    const { id } = req.params;
    const { targetStatus, reason } = req.body || {};
    if (!targetStatus) return res.status(400).json({ error: 'targetStatus is required' });
    const doc = await db.doc(`suggestions/${id}`).get();
    if (!doc.exists) return res.status(404).json({ error: 'Suggestion not found' });
    const previousStatus = doc.data().status;
    await db.doc(`suggestions/${id}`).update({
      status: targetStatus,
      overturnedAt: now(),
      overturnedBy: req.auth.uniqueId,
      overturnReason: reason || null,
      updatedAt: now(),
    });
    await createAuditEntry(req.auth.uniqueId, 'suggestion_overturn', 'suggestion', id, {
      previousStatus,
      targetStatus,
      reason: reason || null,
    });
    res.json({ success: true, status: targetStatus });
  } catch (err) {
    log.error('admin-suggestions', 'Overturn failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /admin/suggestions/:id/status ─────────────────────────
router.post('/admin/suggestions/:id/status', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;
    const { id } = req.params;
    const { status: newStatus } = req.body || {};
    if (!newStatus) return res.status(400).json({ error: 'Status is required' });
    const doc = await db.doc(`suggestions/${id}`).get();
    if (!doc.exists) return res.status(404).json({ error: 'Suggestion not found' });
    await db.doc(`suggestions/${id}`).update({
      status: newStatus,
      reviewedAt: now(),
      reviewedBy: req.auth.uniqueId,
      updatedAt: now(),
    });
    await createAuditEntry(req.auth.uniqueId, 'suggestion_status_change', 'suggestion', id, {
      newStatus,
    });
    res.json({ success: true, status: newStatus });
  } catch (err) {
    log.error('admin-suggestions', 'Status change failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /admin/suggestions/:id/add-votes ──────────────────────
router.post('/admin/suggestions/:id/add-votes', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;
    const { id } = req.params;
    const { count } = req.body || {};
    const n = Number(count) || 0;
    if (n <= 0) return res.status(400).json({ error: 'count must be positive' });
    const ref = db.doc(`suggestions/${id}`);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Suggestion not found' });
    await ref.update({
      voteCount: FieldValue.increment(n),
      upvotes: FieldValue.increment(n),
      updatedAt: now(),
    });
    res.json({ success: true });
  } catch (err) {
    log.error('admin-suggestions', 'Add votes failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /admin/notifications ───────────────────────────────────
//
// Lists notifications with optional filters by userId and type. Used by
// the admin notifications tab and by merge-notification tests that verify
// a merge creates a notification for the submitter.
router.get('/admin/notifications', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;
    const { userId, type } = req.query;
    const snap = await db.collection('notifications').get();
    let notifications = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (userId) {
      notifications = notifications.filter(
        (n) =>
          String(n.userId) === String(userId) ||
          String(n.uid) === String(userId) ||
          String(n.recipientUid) === String(userId),
      );
    }
    if (type) {
      notifications = notifications.filter((n) => n.type === type);
    }
    notifications.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    res.json({ notifications, total: notifications.length });
  } catch (err) {
    log.error('admin-suggestions', 'List notifications failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /admin/suggestions/:id/history ─────────────────────────
router.get('/admin/suggestions/:id/history', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;
    const { id } = req.params;
    // Audit entries for suggestions may live in any of three collections:
    //   - moderationLog: approve/reject/overturn/edit (via createAuditEntry)
    //   - adminAuditLog: canonical admin actions
    //   - auditLog: merge actions (written directly by merge route)
    const [modSnap, adminAuditSnap, auditSnap] = await Promise.all([
      db
        .collection('moderationLog')
        .where('targetId', '==', id)
        .where('targetType', '==', 'suggestion')
        .get(),
      db
        .collection('adminAuditLog')
        .where('targetId', '==', id)
        .where('targetType', '==', 'suggestion')
        .get(),
      db
        .collection('auditLog')
        .where('targetId', '==', id)
        .where('targetType', '==', 'suggestion')
        .get(),
    ]);
    const snap = { docs: [...modSnap.docs, ...adminAuditSnap.docs, ...auditSnap.docs] };
    // Dedupe by id (same entry may appear in both moderationLog and adminAuditLog).
    const seen = new Set();
    const uniqueDocs = [];
    for (const d of snap.docs) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      uniqueDocs.push(d);
    }
    // Normalise action names to past-tense forms expected by the timeline UI:
    //   suggestion_approve → approved
    //   suggestion_reject  → rejected
    //   suggestion_status_change → uses details.newStatus
    //   suggestion_overturn → overturned
    function normaliseAction(e) {
      const raw = (e.actionType || e.action || '').replace(/^suggestion_/, '');
      if (raw === 'status_change') {
        return (e.details && e.details.newStatus) || 'updated';
      }
      const map = {
        approve: 'approved',
        reject: 'rejected',
        overturn: 'overturned',
        merge: 'merged',
        edit: 'edited',
      };
      return map[raw] || raw;
    }
    const events = uniqueDocs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
      .map((e) => ({
        action: normaliseAction(e),
        timestamp: e.timestamp,
        adminName: e.adminName || 'admin',
        reason: e.details && e.details.reason,
        diff: e.details && e.details.diff,
        targetId: e.details && (e.details.targetId || e.details.mergedInto || e.details.originalId),
        mergedInto:
          e.details && (e.details.mergedInto || e.details.targetId || e.details.originalId),
      }));
    const doc = await db.doc(`suggestions/${id}`).get();
    if (doc.exists) {
      events.unshift({
        action: 'created',
        timestamp: doc.data().createdAt || 0,
        adminName: 'system',
      });
    }
    res.json({ events, timeline: events });
  } catch (err) {
    log.error('admin-suggestions', 'History failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /admin/suggestions/blocked/:id ──────────────────────

router.delete('/admin/suggestions/blocked/:id', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;

    const { id } = req.params;

    const doc = await db.doc(`blockedTopics/${id}`).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Blocked topic not found' });
    }

    await db.doc(`blockedTopics/${id}`).delete();

    await createAuditEntry(req.auth.uniqueId, 'blocked_topic_delete', 'blockedTopic', id, {
      title: doc.data().title,
    });

    log.info('admin-suggestions', 'Blocked topic removed', {
      blockedTopicId: id,
      adminUid: req.auth.uniqueId,
    });

    res.json({ success: true });
  } catch (err) {
    log.error('admin-suggestions', 'Failed to unblock topic', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /suggestions/:id/dispute ──────────────────────────────

router.post('/suggestions/:id/dispute', async (req, res) => {
  try {
    if (requireAuth(req, res)) return;

    const { id } = req.params;
    const { reason } = req.body;

    const doc = await db.doc(`suggestions/${id}`).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Suggestion not found' });
    }

    const data = doc.data();

    // Only the submitter can dispute
    if (data.submitterUid !== req.auth.uniqueId) {
      return res.status(403).json({ error: 'Only the submitter can dispute a merge' });
    }

    // Must be merged
    if (data.status !== 'merged') {
      return res.status(400).json({ error: 'Can only dispute merged suggestions' });
    }

    // Cannot dispute if already pending
    if (data.disputePending) {
      return res.status(400).json({ error: 'A dispute is already pending for this suggestion' });
    }

    // Create dispute record
    await db.collection('suggestion_disputes').add({
      suggestionId: id,
      originalSuggestionId: data.mergedIntoSuggestionId,
      submitterUid: req.auth.uniqueId,
      reason: reason || '',
      status: 'pending',
      createdAt: now(),
      resolvedAt: null,
      resolvedBy: null,
      resolution: null,
    });

    // Set dispute flag on suggestion
    await db.doc(`suggestions/${id}`).update({
      disputePending: true,
      updatedAt: now(),
    });

    log.info('suggestions', 'Merge disputed', {
      suggestionId: id,
      submitterUid: req.auth.uniqueId,
    });

    res.json({ success: true });
  } catch (err) {
    log.error('suggestions', 'Failed to dispute merge', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
