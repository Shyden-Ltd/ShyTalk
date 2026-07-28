'use strict';

/**
 * SHY-0165 — message-translation cache participant gate, REAL services.
 *
 * `verifyParticipant` compares a NUMBER `req.auth.uniqueId` against
 * `participantIds`, which are stored as STRINGS on both `conversations/{id}`
 * (the app + firestore.rules) and `rooms/{id}` (`room-mutations.js` writes
 * `String(req.auth.uniqueId)`). `["63000010"].includes(63000010)` is always
 * false, so the message-level cache read (line 157, BEFORE the quota check) and
 * write (line 194) are silently disabled for every real chat/room message.
 *
 * Deterministic + provider-free by two mechanisms:
 *  - READ tests: seed a pre-cached translation on the message AND exhaust the
 *    caller's quota. The cache read precedes the quota check, so a VERIFIED
 *    participant short-circuits to `cached:true`; the BUG falls through to 429.
 *  - WRITE test: seed translate.js's module-level string cache via the
 *    TRANSLATION_CACHE_*_PATH env paths it reads at require-time (the pattern
 *    translate-public.test.js uses), so a first-time translation resolves from
 *    disk with ZERO network, then asserts the participant-gated write persisted.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

// Point translate.js's require-time string cache at an isolated tmp dir (set
// BEFORE requiring translate.js). Also caps blast radius: without this a
// provider fall-through would write to the shared data/translation-cache.json.
const PRIOR_SEED_PATH = process.env.TRANSLATION_CACHE_SEED_PATH;
const PRIOR_RUNTIME_PATH = process.env.TRANSLATION_CACHE_RUNTIME_PATH;
const cacheTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'translate-cache-'));
process.env.TRANSLATION_CACHE_SEED_PATH = path.join(cacheTmpDir, 'seed.json');
process.env.TRANSLATION_CACHE_RUNTIME_PATH = path.join(cacheTmpDir, 'cache.json');
fs.writeFileSync(process.env.TRANSLATION_CACHE_SEED_PATH, '{}');

const express = require('express');
const request = require('supertest');
const { db } = require('../../src/utils/firebase');
const { authMiddleware } = require('../../src/middleware/auth');
const { assertEmulatorReachable } = require('../helpers/firebase-emulator');
const { mintRealUser, clearAuthCaches } = require('../helpers/real-auth');
const { createTranslationCache } = require('../../src/utils/translation-cache');

const PROBE_TEXT = 'shy-0165 write-path probe';
const PROBE_LANG = 'de';
const PROBE_TRANSLATION = 'geschriebene Übersetzung';
// Pre-seed the string cache so a first-time translateCached() resolves from disk
// with no provider call. Runs before the translate.js require below so its
// module-level stringCache (built from the same env paths) reads this back.
createTranslationCache({
  seedPath: process.env.TRANSLATION_CACHE_SEED_PATH,
  runtimePath: process.env.TRANSLATION_CACHE_RUNTIME_PATH,
}).set(PROBE_TEXT, PROBE_LANG, PROBE_TRANSLATION);

const translateRouter = require('../../src/routes/translate');

const FREE_DAILY_LIMIT = 50;
const todayStr = () => new Date().toISOString().slice(0, 10);
// Fresh per call (NOT frozen at module load) so a UTC-midnight boundary between
// module load and the request can't desync the quota date and fall through to
// the live provider.
const spentQuota = () => ({
  translationsToday: FREE_DAILY_LIMIT,
  translationDate: todayStr(),
  isSuperShy: false,
});

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
async function seedMessage(docPath, translations) {
  await db.doc(docPath).set({ text: 'hello', translations });
}

beforeAll(async () => {
  await assertEmulatorReachable();
});
afterAll(() => {
  if (PRIOR_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = PRIOR_NODE_ENV;
  if (PRIOR_SEED_PATH === undefined) delete process.env.TRANSLATION_CACHE_SEED_PATH;
  else process.env.TRANSLATION_CACHE_SEED_PATH = PRIOR_SEED_PATH;
  if (PRIOR_RUNTIME_PATH === undefined) delete process.env.TRANSLATION_CACHE_RUNTIME_PATH;
  else process.env.TRANSLATION_CACHE_RUNTIME_PATH = PRIOR_RUNTIME_PATH;
  fs.rmSync(cacheTmpDir, { recursive: true, force: true });
});
beforeEach(() => {
  clearAuthCaches();
});

describe('translate cache — participant gate coerces ids (conversations)', () => {
  test('a conversation participant with a pre-cached translation gets a cache hit, not a quota 429', async () => {
    const user = await mintRealUser({ uniqueId: 68000001, extraUserData: spentQuota() });
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
    const user = await mintRealUser({ uniqueId: 68000002, extraUserData: spentQuota() });
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

describe('translate cache — the WRITE path persists to the message doc', () => {
  test('a first-time translation by a participant is written to the message cache, and a re-request is a hit', async () => {
    const user = await mintRealUser({
      uniqueId: 68000005,
      extraUserData: { translationsToday: 0, translationDate: todayStr(), isSuperShy: false },
    });
    await seedParent('conversations', 'conv-tc-4', [String(68000005), '68000099']);
    await seedMessage('conversations/conv-tc-4/messages/msg-1', {}); // no cached translation yet

    const res = await translate(user.headers, {
      text: PROBE_TEXT,
      targetLang: PROBE_LANG,
      messagePath: 'conversations/conv-tc-4/messages/msg-1',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ translatedText: PROBE_TRANSLATION, cached: false });

    // The write (translate.js:194) is fire-and-forget — poll for it to land.
    let stored = null;
    for (let i = 0; i < 40 && !stored; i += 1) {
      const snap = await db.doc('conversations/conv-tc-4/messages/msg-1').get();
      if (snap.data()?.translations?.[PROBE_LANG]) stored = snap.data();
      // sleep-ok: poll interval — the loop breaks the moment the translation lands
      else await new Promise((resolve) => setTimeout(resolve, 25)); // sleep-ok: poll interval, loop breaks the instant the translation lands
    }
    expect(stored?.translations?.[PROBE_LANG]).toBe(PROBE_TRANSLATION);

    // And the persisted write makes the next identical request a cache hit.
    const res2 = await translate(user.headers, {
      text: PROBE_TEXT,
      targetLang: PROBE_LANG,
      messagePath: 'conversations/conv-tc-4/messages/msg-1',
    });
    expect(res2.status).toBe(200);
    expect(res2.body).toMatchObject({ translatedText: PROBE_TRANSLATION, cached: true });
  });
});

describe('translate cache — the fix is a strict superset, not a bypass', () => {
  test('a NON-participant never reads the cache (stays unverified even after coercion)', async () => {
    // Caller 68000003 is absent from participantIds → must stay unverified, so
    // the cache is skipped and the exhausted quota returns the 429 contract.
    // Asserts the SAME outcome before and after the fix — no access widening.
    const user = await mintRealUser({ uniqueId: 68000003, extraUserData: spentQuota() });
    await seedParent('conversations', 'conv-tc-2', ['68000088', '68000099']); // caller absent
    await seedMessage('conversations/conv-tc-2/messages/msg-1', { es: 'hola' });

    const res = await translate(user.headers, {
      text: 'hello',
      targetLang: 'es',
      messagePath: 'conversations/conv-tc-2/messages/msg-1',
    });

    expect(res.status).toBe(429);
    expect(res.body).toEqual({
      error: 'Daily translation limit reached',
      limit: FREE_DAILY_LIMIT,
      upgradePrompt: true,
    });
  });

  test('legacy Number-typed participantIds still verify the participant (coercion is symmetric)', async () => {
    const user = await mintRealUser({ uniqueId: 68000004, extraUserData: spentQuota() });
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
