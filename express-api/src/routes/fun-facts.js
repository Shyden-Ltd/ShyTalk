/**
 * Fun facts routes — CRUD for language/culture facts shown on splash screen.
 *
 * GET    /api/fun-facts             -> All active facts (any authenticated user)
 * GET    /api/admin/fun-facts       -> All facts (admin)
 * POST   /api/admin/fun-facts       -> Create fact (admin)
 * PUT    /api/admin/fun-facts/:id   -> Update fact (admin)
 * DELETE /api/admin/fun-facts/:id   -> Delete fact (admin)
 */

const router = require('express').Router();
const { db } = require('../utils/firebase');
const { generateId, now } = require('../utils/helpers');
const { requireAdmin } = require('../middleware/auth');
const { queryDocs } = require('../utils/firestore-helpers');
const log = require('../utils/log');

// -- All active facts (any authenticated user) --
router.get('/fun-facts', async (req, res) => {
  try {
    const results = await queryDocs(db.collection('funFacts').where('isActive', '==', true));

    // Shuffle (Firestore has no RANDOM() order)
    for (let i = results.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [results[i], results[j]] = [results[j], results[i]];
    }

    res.set('Cache-Control', 'public, max-age=3600');
    return res.json(results);
  } catch (err) {
    log.error('fun-facts', 'Failed to fetch active fun facts', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// -- All facts (admin) --
router.get('/admin/fun-facts', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const results = await queryDocs(db.collection('funFacts').orderBy('createdAt', 'desc'));

    return res.json(results);
  } catch (err) {
    log.error('fun-facts', 'Failed to fetch all fun facts', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// -- Create fact (admin) --
router.post('/admin/fun-facts', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const body = req.body;
    if (!body) return res.status(400).json({ error: 'Invalid JSON body' });
    if (!body.text) return res.status(400).json({ error: 'text is required' });

    const id = generateId();
    const timestamp = now();

    await db.doc(`funFacts/${id}`).set({
      id,
      text: body.text,
      category: body.category || 'trivia',
      emoji: body.emoji || '',
      sourceLanguage: body.sourceLanguage || body.source_language || '',
      isActive: body.isActive !== undefined ? !!body.isActive : body.is_active !== false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    return res.json({ success: true, id });
  } catch (err) {
    log.error('fun-facts', 'Failed to create fun fact', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// -- Update fact (admin) --
router.put('/admin/fun-facts/:id', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const body = req.body;
    if (!body) return res.status(400).json({ error: 'Invalid JSON body' });

    const docRef = db.doc(`funFacts/${req.params.id}`);
    const snap = await docRef.get();
    if (!snap.exists) return res.status(404).json({ error: 'Fun fact not found' });

    const fields = {};
    if (body.text !== undefined) fields.text = body.text;
    if (body.category !== undefined) fields.category = body.category;
    if (body.emoji !== undefined) fields.emoji = body.emoji;
    if (body.sourceLanguage !== undefined || body.source_language !== undefined) {
      fields.sourceLanguage = body.sourceLanguage ?? body.source_language;
    }
    if (body.isActive !== undefined || body.is_active !== undefined) {
      fields.isActive = !!(body.isActive ?? body.is_active);
    }

    if (Object.keys(fields).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    fields.updatedAt = now();
    await docRef.update(fields);

    return res.json({ success: true });
  } catch (err) {
    log.error('fun-facts', 'Failed to update fun fact', {
      factId: req.params.id,
      error: err.message,
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// -- Delete fact (admin) --
router.delete('/admin/fun-facts/:id', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const docRef = db.doc(`funFacts/${req.params.id}`);
    const snap = await docRef.get();
    if (!snap.exists) return res.status(404).json({ error: 'Fun fact not found' });

    await docRef.delete();

    return res.json({ success: true });
  } catch (err) {
    log.error('fun-facts', 'Failed to delete fun fact', {
      factId: req.params.id,
      error: err.message,
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
