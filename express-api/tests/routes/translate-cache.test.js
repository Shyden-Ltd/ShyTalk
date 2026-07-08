'use strict';

/**
 * SHY-0165 — message-translation cache participant gate, REAL services.
 *
 * `verifyParticipant` compares a NUMBER `req.auth.uniqueId` against
 * `participantIds`, which are stored as STRINGS on both `conversations/{id}`
 * (the app + firestore.rules) and `rooms/{id}` (`room-mutations.js` writes
 * `String(req.auth.uniqueId)`). `["63000010"].includes(63000010)` is always
 * false, so the message-level cache read (line 157, BEFORE the quota check) and
 * write (line 189) are silently disabled for every real chat/room message.
 *
 * These tests are deterministic + provider-free by exploiting the route's
 * ordering: the cache read runs before the daily-quota check. Seed a pre-cached
 * translation AND exhaust the caller's quota — a VERIFIED participant
 * short-circuits to `cached:true`; the BUG falls through to a 429. Neither
 * branch calls the external translation provider. The cache WRITE (line 189) is
 * gated on the identical `participantVerified` flag, so proving the read is
 * enabled proves the write branch is reachable too.
 */
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const express = require('express');
const request = require('supertest');
const { db } = require('../../src/utils/firebase');
const { authMiddleware } = require('../../src/middleware/auth');
const { assertEmulatorReachable } = require('../helpers/firebase-emulator');
const { mintRealUser, clearAuthCaches } = require('../helpers/real-auth');
const translateRouter = require('../../src/routes/translate');

const FREE_DAILY_LIMIT = 50;
const today = () => new Date().toISOString().slice(0, 10);
// A caller whose free daily translations are already spent — so any path that
// does NOT short-circuit on a cache hit deterministically returns 429.
const quotaSpent = {
  translationsToday: FREE_DAILY_LIMIT,
  translationDate: today(),
  isSuperShy: false,
};

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware);
  app.use('/api', translateRouter);
  return app;
}

function translate(headers, body) {
  return request(createApp()).post('/api/translate').set(headers).send(body);
}

async function seedParent(collection, id, participantIds) {
  await db.doc(`${collection}/${id}`).set({ participantIds });
}
async function seedMessage(path, translations) {
  await db.doc(path).set({ text: 'hello', translations });
}

beforeAll(async () => {
  await assertEmulatorReachable();
});
afterAll(() => {
  if (PRIOR_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = PRIOR_NODE_ENV;
});
beforeEach(() => {
  clearAuthCaches();
});

describe('translate cache — participant gate coerces ids (conversations)', () => {
  test('a conversation participant with a pre-cached translation gets a cache hit, not a quota 429', async () => {
    const user = await mintRealUser({ uniqueId: 68000001, extraUserData: quotaSpent });
    await seedParent('conversations', 'conv-tc-1', [String(68000001), '68000099']); // Strings (prod)
    await seedMessage('conversations/conv-tc-1/messages/msg-1', { es: 'hola' });

    const res = await translate(user.headers, {
      text: 'hello',
      targetLang: 'es',
      messagePath: 'conversations/conv-tc-1/messages/msg-1',
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ translatedText: 'hola', cached: true });
  });
});

describe('translate cache — participant gate coerces ids (rooms)', () => {
  test('a room participant with a pre-cached translation gets a cache hit', async () => {
    const user = await mintRealUser({ uniqueId: 68000002, extraUserData: quotaSpent });
    await seedParent('rooms', 'room-tc-1', [String(68000002), '68000099']); // Strings (room-mutations writes these)
    await seedMessage('rooms/room-tc-1/messages/msg-1', { fr: 'bonjour' });

    const res = await translate(user.headers, {
      text: 'hello',
      targetLang: 'fr',
      messagePath: 'rooms/room-tc-1/messages/msg-1',
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ translatedText: 'bonjour', cached: true });
  });
});

describe('translate cache — the fix is a strict superset, not a bypass', () => {
  test('a NON-participant never reads the cache (stays unverified even after coercion)', async () => {
    // Caller 68000003 is absent from participantIds → must stay unverified, so
    // the cache is skipped and the exhausted quota returns 429. This asserts the
    // SAME outcome before and after the fix — the coercion must not widen access.
    const user = await mintRealUser({ uniqueId: 68000003, extraUserData: quotaSpent });
    await seedParent('conversations', 'conv-tc-2', ['68000088', '68000099']); // caller absent
    await seedMessage('conversations/conv-tc-2/messages/msg-1', { es: 'hola' });

    const res = await translate(user.headers, {
      text: 'hello',
      targetLang: 'es',
      messagePath: 'conversations/conv-tc-2/messages/msg-1',
    });

    expect(res.status).toBe(429); // cache skipped (not a participant) → quota exhausted
    expect(res.body.cached).not.toBe(true);
  });

  test('legacy Number-typed participantIds still verify the participant (coercion is symmetric)', async () => {
    const user = await mintRealUser({ uniqueId: 68000004, extraUserData: quotaSpent });
    await seedParent('conversations', 'conv-tc-3', [68000004, 68000099]); // Numbers (legacy)
    await seedMessage('conversations/conv-tc-3/messages/msg-1', { de: 'hallo' });

    const res = await translate(user.headers, {
      text: 'hello',
      targetLang: 'de',
      messagePath: 'conversations/conv-tc-3/messages/msg-1',
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ translatedText: 'hallo', cached: true });
  });
});
