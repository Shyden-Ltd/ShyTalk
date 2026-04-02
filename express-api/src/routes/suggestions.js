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
const { generateId, now } = require('../utils/helpers');
const log = require('../utils/log');
const { sanitise, sanitiseTitle } = require('../utils/text-sanitiser');
const { similarity } = require('../utils/similarity');
const { sendSystemPm } = require('../utils/system-pm');
const { sendFcmToTokens } = require('../utils/fcm');
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
  const tags = VALID_TAGS.map((t) => ({ id: t, name: t, category: t }));
  res.json({ tags });
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
    const snap = await db
      .collection('suggestions')
      .where('status', 'in', [...PUBLIC_STATUSES, 'pending'])
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
    const { direction, reason, reasonVisibility } = req.body;

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

    const sugDoc = await db.doc(`suggestions/${id}`).get();
    if (!sugDoc.exists) return res.status(404).json({ error: 'Suggestion not found' });

    const sugData = sugDoc.data();

    // Check status allows voting
    if (!VOTABLE_STATUSES.includes(sugData.status)) {
      return res
        .status(403)
        .json({ error: 'Cannot vote on this suggestion in its current status' });
    }

    // Creator cannot vote on own suggestion
    if (sugData.submitterUid === req.auth.uniqueId) {
      return res.status(403).json({ error: 'Cannot vote on your own suggestion' });
    }

    // Use transaction for atomicity
    await db.runTransaction(async (t) => {
      const voteRef = db.doc(`suggestions/${id}/votes/${req.auth.uniqueId}`);
      const existingVote = await t.get(voteRef);
      const sugRef = db.doc(`suggestions/${id}`);

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
        if (prev.vote === direction) {
          throw new Error('DUPLICATE_VOTE');
        }
        // Toggle: remove old, apply new
        const oldDir = prev.vote;
        t.set(voteRef, {
          voterId: req.auth.uniqueId,
          isCreatorVote: false,
          vote: direction,
          reason: cleanReason,
          reasonVisibility: reasonVisibility || null,
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
          reason: cleanReason,
          reasonVisibility: reasonVisibility || null,
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
    if (voteData.isCreatorVote) {
      return res.status(403).json({ error: 'Cannot remove creator vote' });
    }

    await db.runTransaction(async (t) => {
      t.delete(voteRef);
      const sugRef = db.doc(`suggestions/${id}`);
      if (voteData.vote === 'up') {
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

function requireAdmin(req, res) {
  if (!req.auth?.token?.admin) {
    res.status(403).json({ error: 'Admin access required' });
    return true;
  }
  return false;
}

async function createAuditEntry(adminUid, action, targetType, targetId, details) {
  try {
    const entryId = generateId();
    await db.doc(`moderationLog/${entryId}`).set({
      adminUid,
      action,
      actionType: action,
      targetType,
      targetId,
      details: details || {},
      timestamp: now(),
    });
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
      } catch {
        // Notification failure should not block the main operation
      }
    }
  } catch (err) {
    log.error('admin-suggestions', 'Notification dispatch failed', { error: err.message });
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
    if (requireAdmin(req, res)) return;

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
    if (requireAdmin(req, res)) return;

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
    if (requireAdmin(req, res)) return;

    const { q } = req.query;
    const snap = await db.collection('suggestions').get();
    let suggestions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

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
    if (requireAdmin(req, res)) return;

    const { id } = req.params;
    const { status: newStatus, reason, linkedRoadmapFeature } = req.body;

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
      updates.subscribers = [];
    }

    // Atomically update the suggestion via transaction
    await db.runTransaction(async (t) => {
      t.update(updates);
    });

    // Create moderation log entry
    await createAuditEntry(
      req.auth.uniqueId,
      `suggestion_${newStatus === 'accepted' ? 'approve' : newStatus}`,
      'suggestion',
      id,
      { previousStatus: currentStatus, newStatus, reason: reason || null },
    );

    // Notify subscribers
    await notifySubscribers(data, newStatus, {
      suggestionId: id,
      previousStatus: currentStatus,
      reason: reason || null,
    });

    log.info('admin-suggestions', 'Suggestion status changed', {
      id,
      from: currentStatus,
      to: newStatus,
      adminUid: req.auth.uniqueId,
    });

    res.json({ success: true });
  } catch (err) {
    log.error('admin-suggestions', 'Failed to change suggestion status', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /admin/suggestions/:id/link ────────────────────────────

router.put('/admin/suggestions/:id/link', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const { id } = req.params;
    const { roadmapFeatureId } = req.body;

    if (!roadmapFeatureId) {
      return res.status(400).json({ error: 'Roadmap feature ID is required' });
    }

    const sugDoc = await db.doc(`suggestions/${id}`).get();
    if (!sugDoc.exists) {
      return res.status(404).json({ error: 'Suggestion not found' });
    }

    // Verify the roadmap feature exists
    const featureDoc = await db.doc(`roadmapFeatures/${roadmapFeatureId}`).get();
    if (!featureDoc.exists) {
      return res.status(400).json({ error: 'Roadmap feature not found' });
    }

    await db.doc(`suggestions/${id}`).update({
      linkedRoadmapFeature: roadmapFeatureId,
      updatedAt: now(),
    });

    await createAuditEntry(req.auth.uniqueId, 'suggestion_link', 'suggestion', id, {
      roadmapFeatureId,
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
    if (requireAdmin(req, res)) return;

    const { id } = req.params;
    const { originalSuggestionId } = req.body;

    if (!originalSuggestionId) {
      return res.status(400).json({ error: 'Original suggestion ID is required' });
    }

    const dupDoc = await db.doc(`suggestions/${id}`).get();
    if (!dupDoc.exists) {
      return res.status(404).json({ error: 'Duplicate suggestion not found' });
    }

    const originalDoc = await db.doc(`suggestions/${originalSuggestionId}`).get();
    if (!originalDoc.exists) {
      return res.status(404).json({ error: 'Original suggestion not found' });
    }

    const dupData = dupDoc.data();

    // Mark duplicate as merged
    await db.doc(`suggestions/${id}`).update({
      status: 'merged',
      mergedIntoSuggestionId: originalSuggestionId,
      updatedAt: now(),
    });

    // Transfer upvotes to the original
    await db.doc(`suggestions/${originalSuggestionId}`).update({
      upvotes: FieldValue.increment(dupData.upvotes || 0),
      updatedAt: now(),
    });

    // Notify the duplicate's submitter
    await db.collection('notifications').add({
      uid: dupData.submitterUid,
      recipientUid: dupData.submitterUid,
      type: 'suggestion_merged',
      title: 'Your suggestion was merged',
      body: `Your suggestion "${dupData.title}" was merged into a similar suggestion.`,
      relatedId: id,
      originalSuggestionId,
      isRead: false,
      createdAt: now(),
    });

    // Create audit log entry
    await db.collection('auditLog').add({
      adminUid: req.auth.uniqueId,
      action: 'suggestion_merge',
      actionType: 'suggestion_merge',
      targetType: 'suggestion',
      targetId: id,
      details: {
        duplicateId: id,
        originalId: originalSuggestionId,
        transferredUpvotes: dupData.upvotes || 0,
      },
      timestamp: now(),
    });

    log.info('admin-suggestions', 'Suggestion merged as duplicate', {
      duplicateId: id,
      originalId: originalSuggestionId,
      adminUid: req.auth.uniqueId,
    });

    res.json({ success: true });
  } catch (err) {
    log.error('admin-suggestions', 'Failed to merge suggestion', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /admin/suggestions/blocked/:id ──────────────────────

router.delete('/admin/suggestions/blocked/:id', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

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
