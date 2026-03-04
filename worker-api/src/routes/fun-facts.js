/**
 * Fun facts routes — CRUD for language/culture facts shown on splash screen.
 *
 * GET    /api/fun-facts             → All active facts (any authenticated user)
 * GET    /api/admin/fun-facts       → All facts (admin)
 * POST   /api/admin/fun-facts       → Create fact (admin)
 * PUT    /api/admin/fun-facts/:id   → Update fact (admin)
 * DELETE /api/admin/fun-facts/:id   → Delete fact (admin)
 */

const { json, jsonError, generateId, now } = require('../utils');
const { requireAdmin } = require('../middleware/auth');
const { getDoc, setDoc, updateDoc, deleteDoc, queryCollection, fieldFilter, orderBy } = require('../utils/firestore');

function registerFunFactRoutes(router) {
  // ── All active facts (any authenticated user) ──
  router.get('/api/fun-facts', async (request, env) => {
    const results = await queryCollection(env, 'funFacts', {
      where: fieldFilter('isActive', 'EQUAL', true),
    });

    // Shuffle (Firestore has no RANDOM() order)
    for (let i = results.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [results[i], results[j]] = [results[j], results[i]];
    }

    return json(results);
  });

  // ── All facts (admin) ──
  router.get('/api/admin/fun-facts', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const results = await queryCollection(env, 'funFacts', {
      orderBy: [orderBy('createdAt', 'DESCENDING')],
    });

    return json(results);
  });

  // ── Create fact (admin) ──
  router.post('/api/admin/fun-facts', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const body = await request.json().catch(() => null);
    if (!body) return jsonError('Invalid JSON body', 400);
    if (!body.text) return jsonError('text is required', 400);

    const id = generateId();
    const timestamp = now();

    await setDoc(env, `funFacts/${id}`, {
      id,
      text: body.text,
      category: body.category || 'trivia',
      emoji: body.emoji || '',
      sourceLanguage: body.sourceLanguage || body.source_language || '',
      isActive: body.isActive !== undefined ? !!body.isActive : (body.is_active !== false),
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    return json({ success: true, id });
  });

  // ── Update fact (admin) ──
  router.put('/api/admin/fun-facts/:id', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const body = await request.json().catch(() => null);
    if (!body) return jsonError('Invalid JSON body', 400);

    const existing = await getDoc(env, `funFacts/${params.id}`);
    if (!existing) return jsonError('Fun fact not found', 404);

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

    if (Object.keys(fields).length === 0) return jsonError('No fields to update', 400);

    fields.updatedAt = now();
    await updateDoc(env, `funFacts/${params.id}`, fields);

    return json({ success: true });
  });

  // ── Delete fact (admin) ──
  router.delete('/api/admin/fun-facts/:id', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const existing = await getDoc(env, `funFacts/${params.id}`);
    if (!existing) return jsonError('Fun fact not found', 404);

    await deleteDoc(env, `funFacts/${params.id}`);

    return json({ success: true });
  });
}

module.exports = { registerFunFactRoutes };
