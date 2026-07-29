'use strict';

/**
 * SHY-0250 — comments posted on the suggestions board never appear.
 *
 * The board renders cards ONLY from the list endpoint (`GET /api/suggestions`)
 * and `renderCommentSection` reads `suggestion.comments || []`. The list
 * endpoint returns raw `suggestions` documents, and comments live in the
 * `suggestions/{id}/comments` SUBCOLLECTION — so no list item has ever carried
 * a `comments` key, and the board's comment list has always been empty for
 * everyone. The comment-submit handler even refreshes via `fetchSuggestions()`,
 * the very call that cannot carry the comment it just posted.
 *
 * Only `GET /api/suggestions/:id` loads comments, and the board never calls it.
 *
 * REAL services throughout: real Auth-emulator tokens, real Firestore
 * documents and real subcollection writes. No doubles.
 */
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { db } = require('../../src/utils/firebase');
const { authMiddleware } = require('../../src/middleware/auth');
const { assertEmulatorReachable } = require('../helpers/firebase-emulator');
const { mintRealUser, clearAuthCaches } = require('../helpers/real-auth');
const suggestionsRouter = require('../../src/routes/suggestions');

// Namespaced well clear of the other suites so a parallel worker cannot collide.
const ADMIN_ID = 65000001;
const READER_ID = 65000002;
const PREFIX = `shy0250-${process.pid}`;

const CREATED = [];

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware);
  app.use('/api', suggestionsRouter);
  return app;
}

/** Write a suggestion in the production shape. */
async function seedSuggestion({ status = 'accepted', title }) {
  const id = `${PREFIX}-${CREATED.length}-${Date.now()}`;
  const now = Date.now();
  await db.doc(`suggestions/${id}`).set({
    id,
    title: title || `SHY-0250 ${status} suggestion`,
    description: 'Seeded by suggestions-list-comments.test.js',
    tags: [],
    language: 'en',
    status,
    rejectReason: null,
    linkedRoadmapFeature: null,
    mergedIntoSuggestionId: null,
    disputePending: false,
    submitterUid: READER_ID,
    submitterContactOptIn: false,
    upvotes: 1,
    downvotes: 0,
    createdAt: now,
    updatedAt: now,
  });
  CREATED.push(id);
  return id;
}

async function seedComment(suggestionId, { text, isPublic = true }) {
  const commentId = `c-${crypto.randomBytes(4).toString('hex')}`;
  await db.doc(`suggestions/${suggestionId}/comments/${commentId}`).set({
    id: commentId,
    text,
    authorName: 'Commenter',
    authorUid: READER_ID,
    isPublic,
    createdAt: Date.now(),
  });
  return commentId;
}

/** Pull one seeded suggestion out of a list response by id. */
function findItem(body, id) {
  return (body.suggestions || []).find((s) => s.id === id);
}

describe('SHY-0250 — GET /api/suggestions must carry comments', () => {
  let app;
  let reader;
  let admin;

  beforeAll(async () => {
    await assertEmulatorReachable();
    app = createApp();
    reader = await mintRealUser({ uniqueId: READER_ID });
    admin = await mintRealUser({ uniqueId: ADMIN_ID, admin: true });
  });

  afterAll(async () => {
    for (const id of CREATED) {
      const comments = await db.collection(`suggestions/${id}/comments`).get();
      await Promise.all(comments.docs.map((d) => d.ref.delete()));
      await db.doc(`suggestions/${id}`).delete();
    }
    clearAuthCaches();
    process.env.NODE_ENV = PRIOR_NODE_ENV;
  });

  test('an accepted suggestion carries its comments in the LIST response', async () => {
    const id = await seedSuggestion({ status: 'accepted' });
    await seedComment(id, { text: 'A visible comment' });

    const res = await request(app).get('/api/suggestions?pageSize=50').set(reader.headers);
    expect(res.status).toBe(200);

    const item = findItem(res.body, id);
    expect(item).toBeDefined();
    // The board does `suggestion.comments || []`, so an ABSENT key and an empty
    // array are indistinguishable to it — assert the key exists AND the content.
    expect(Array.isArray(item.comments)).toBe(true);
    expect(item.comments.map((c) => c.text)).toEqual(['A visible comment']);
  });

  test('commentCount accompanies comments, matching the single-suggestion endpoint', async () => {
    const id = await seedSuggestion({ status: 'accepted' });
    await seedComment(id, { text: 'one' });
    await seedComment(id, { text: 'two' });

    const res = await request(app).get('/api/suggestions?pageSize=50').set(reader.headers);
    const item = findItem(res.body, id);
    expect(item.commentCount).toBe(2);
  });

  test('a non-public comment is withheld from a non-admin caller', async () => {
    const id = await seedSuggestion({ status: 'accepted' });
    await seedComment(id, { text: 'public one' });
    await seedComment(id, { text: 'private one', isPublic: false });

    const res = await request(app).get('/api/suggestions?pageSize=50').set(reader.headers);
    const texts = findItem(res.body, id).comments.map((c) => c.text);
    expect(texts).toContain('public one');
    expect(texts).not.toContain('private one');
  });

  test('an admin DOES see the non-public comment in the list', async () => {
    const id = await seedSuggestion({ status: 'accepted' });
    await seedComment(id, { text: 'admin-visible', isPublic: false });

    const res = await request(app).get('/api/suggestions?pageSize=50').set(admin.headers);
    const texts = findItem(res.body, id).comments.map((c) => c.text);
    expect(texts).toContain('admin-visible');
  });

  test('a suggestion with no comments returns [] — never undefined', async () => {
    const id = await seedSuggestion({ status: 'accepted' });

    const res = await request(app).get('/api/suggestions?pageSize=50').set(reader.headers);
    const item = findItem(res.body, id);
    expect(item.comments).toEqual([]);
    expect(item.commentCount).toBe(0);
  });

  test.each(['planned', 'completed', 'rejected'])(
    'a %s suggestion carries an empty comments array (the board never renders them)',
    async (status) => {
      const id = await seedSuggestion({ status });
      await seedComment(id, { text: 'should not be loaded' });

      const res = await request(app).get('/api/suggestions?pageSize=50').set(reader.headers);
      const item = findItem(res.body, id);
      expect(item).toBeDefined();
      expect(item.comments).toEqual([]);
    },
  );

  test('the doc-ref comment id wins over an `id` field inside stored data', async () => {
    const id = await seedSuggestion({ status: 'accepted' });
    const commentId = `c-${crypto.randomBytes(4).toString('hex')}`;
    await db.doc(`suggestions/${id}/comments/${commentId}`).set({
      id: 'ATTACKER-SUPPLIED',
      text: 'identity check',
      authorName: 'Commenter',
      isPublic: true,
      createdAt: Date.now(),
    });

    const res = await request(app).get('/api/suggestions?pageSize=50').set(reader.headers);
    const comment = findItem(res.body, id).comments.find((c) => c.text === 'identity check');
    expect(comment.id).toBe(commentId);
  });
});
