/**
 * POST /api/livekit/token — REAL-services integration test.
 *
 * SHY-0125 (EPIC-0003 · SHY-0113 Rooms slice 1): migrated off ALL in-process
 * doubles. NO jest.mock of firebase / livekit-server-sdk / livekit-region / log,
 * and NO faked req.auth — the REAL auth middleware is in the chain.
 *   - Auth        : real `authMiddleware` verifying a real Firebase ID token
 *                   minted via the Auth emulator (tests/helpers/real-auth.js).
 *                   uniqueId resolves from a seeded real `users` doc; cohort/
 *                   admin ride on the real token claims. (Operator 2026-06-17:
 *                   "real now and in the future".)
 *   - Firestore   : real local emulator (room + users docs seeded + read).
 *   - LiveKit SDK : real `AccessToken` mint (local HS256 crypto — no server) +
 *                   real `TokenVerifier` decode. Region-secret selection is
 *                   proven by verify-succeeds-with-region / verify-throws-other.
 *   - region cfg  : real env-driven `livekit-region`.
 *   - log         : real (dev logger is a no-op counter — exercised, not asserted).
 *
 * NODE_ENV='local' is set BEFORE requiring src/utils/firebase so the Admin SDK +
 * Auth emulator target localhost. PER-FILE opt-in only — never prepend
 * NODE_ENV=local to the canonical `npm test` run (feedback-express-suite-no-node-env-override).
 *
 * COHORT (adult/minor — age segregation) and REGION (asia/eu — LiveKit routing)
 * are orthogonal axes; the cross-cohort gate matrix lives in livekit-cohort.test.js.
 *
 * AC → test map (SHY-0125):
 *   Auth real (proof)          -> "401 when no Authorization header", "401 on an invalid token",
 *                                 "403 when the caller is suspended (real middleware)"
 *   Happy/grants/identity      -> "mints a real token …", "uses the authed uniqueId …",
 *                                 "grants roomJoin + room + publish/subscribe", "stamps cohort metadata"
 *   Region (via signature)     -> "default region is asia …", "EU header routes to eu …",
 *                                 "falls back to the global secret …"
 *   url omitted in local       -> "omits the url field in local mode"
 *   Error 400/403/404          -> "400 when roomName missing", "400 when roomName non-string",
 *                                 "403 when the caller has no profile (no users doc)",
 *                                 "404 (opaque) when roomName fails the charset pattern",
 *                                 "404 when the room does not exist"
 *   Error 503                  -> "503 when the region has no credentials", "503 when only the api key is missing"
 *   Security                   -> "404 for a path-traversal roomName", "never leaks the signing secret"
 *   i18n                       -> "rejects an RTL/CJK roomName via the charset pattern (404)"
 *   Performance                -> "mints within the local-emulator budget"
 *   Observability              -> real log path runs unmocked (no assertion; see above)
 *
 * NOTE (policy — un-inducible error): the route's catch-all 500 cannot be
 * triggered without faking a DB/SDK failure (real toJwt does not throw on a
 * short secret; the emulator is up). Per "impossible-to-induce → escalate,
 * never silent-mock" it is left as defensive code with no faked test.
 */

const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

// Deterministic real LiveKit creds. HS256 signs with these verbatim, so the
// region matrix proves which secret was selected by verifying the minted token.
const ASIA_KEY = 'lk-asia-key';
const ASIA_SECRET = 'asia-secret-0000000000000000000000000000';
const EU_KEY = 'lk-eu-key';
const EU_SECRET = 'eu-secret-000000000000000000000000000000';
const FALLBACK_KEY = 'lk-fallback-key';
const FALLBACK_SECRET = 'fallback-secret-00000000000000000000000';

const LK_ENV_KEYS = [
  'LIVEKIT_API_KEY',
  'LIVEKIT_API_SECRET',
  'LIVEKIT_URL',
  'LIVEKIT_KEY_ASIA',
  'LIVEKIT_SECRET_ASIA',
  'LIVEKIT_URL_ASIA',
  'LIVEKIT_KEY_EU',
  'LIVEKIT_SECRET_EU',
  'LIVEKIT_URL_EU',
];
const PRIOR_LK_ENV = Object.fromEntries(LK_ENV_KEYS.map((k) => [k, process.env[k]]));

function setRegionEnv() {
  process.env.LIVEKIT_API_KEY = FALLBACK_KEY;
  process.env.LIVEKIT_API_SECRET = FALLBACK_SECRET;
  process.env.LIVEKIT_URL = 'wss://fallback.livekit.test';
  process.env.LIVEKIT_KEY_ASIA = ASIA_KEY;
  process.env.LIVEKIT_SECRET_ASIA = ASIA_SECRET;
  process.env.LIVEKIT_URL_ASIA = 'wss://asia.livekit.test';
  process.env.LIVEKIT_KEY_EU = EU_KEY;
  process.env.LIVEKIT_SECRET_EU = EU_SECRET;
  process.env.LIVEKIT_URL_EU = 'wss://eu.livekit.test';
}

const express = require('express');
const request = require('supertest');
const { TokenVerifier } = require('livekit-server-sdk');
const { db } = require('../../src/utils/firebase');
const { authMiddleware } = require('../../src/middleware/auth');
const { assertEmulatorReachable } = require('../helpers/firebase-emulator');
const { mintRealUser, mintTokenWithoutUserDoc, clearAuthCaches } = require('../helpers/real-auth');
const livekitRouter = require('../../src/routes/livekit');

const ROOMS = 'rooms';

/** App with the REAL auth middleware ahead of the router (per-request Bearer drives identity). */
function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware);
  app.use('/api', livekitRouter);
  return app;
}

async function seedRoom(roomName, data) {
  await db.doc(`${ROOMS}/${roomName}`).set(data);
}

/** Verify a real minted LiveKit token with a given key/secret; resolves claims or throws. */
function verifyWith(token, key, secret) {
  return new TokenVerifier(key, secret).verify(token);
}

beforeAll(async () => {
  await assertEmulatorReachable();
});

// Cross-file isolation note: the Firebase emulator is a SINGLE shared backend
// across all Jest workers (jest.config.js maxWorkers: 2), so a whole-collection
// clear here would race a concurrently-running sibling that also seeds rooms/users
// (e.g. livekit-cohort.test.js) and wipe its data mid-test. Instead every test
// seeds globally-unique, deterministic IDs via `set()` (idempotent — re-runs
// overwrite the same doc; bounded; no cross-talk), so NO whole-collection clear
// is needed. This route never writes Firestore (no `.add()` accumulation).
beforeEach(() => {
  setRegionEnv();
  clearAuthCaches();
});

afterAll(() => {
  for (const k of LK_ENV_KEYS) {
    if (PRIOR_LK_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = PRIOR_LK_ENV[k];
  }
  if (PRIOR_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = PRIOR_NODE_ENV;
});

describe('POST /api/livekit/token (real services + real auth)', () => {
  // ─── Real-auth proof (the middleware is genuinely in the chain) ─

  test('401 when no Authorization header', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/livekit/token')
      .send({ roomName: 'room-1' })
      .expect(401);
    expect(res.body.error).toBe('Missing or invalid Authorization header');
  });

  test('401 on an invalid token', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/livekit/token')
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ roomName: 'room-1' })
      .expect(401);
    expect(res.body.error).toBe('Authentication failed');
  });

  test('403 when the caller is suspended (real middleware enforces it)', async () => {
    await seedRoom('room-susp', { cohort: 'adult' });
    const user = await mintRealUser({ uniqueId: 50000020, cohort: 'adult', isSuspended: true });
    const app = createApp();
    const res = await request(app)
      .post('/api/livekit/token')
      .set(user.headers)
      .send({ roomName: 'room-susp' })
      .expect(403);
    expect(res.body.error).toBe('Account suspended');
  });

  // ─── Validation / error paths ──────────────────────────────────

  test('400 when roomName missing', async () => {
    const user = await mintRealUser({ uniqueId: 50000001, cohort: 'adult' });
    const app = createApp();
    const res = await request(app)
      .post('/api/livekit/token')
      .set(user.headers)
      .send({})
      .expect(400);
    expect(res.body.error).toBe('roomName is required');
  });

  test('400 when roomName is non-string (numeric)', async () => {
    const user = await mintRealUser({ uniqueId: 50000002, cohort: 'adult' });
    const app = createApp();
    const res = await request(app)
      .post('/api/livekit/token')
      .set(user.headers)
      .send({ roomName: 123 })
      .expect(400);
    expect(res.body.error).toBe('roomName is required');
  });

  test('403 when the caller has no profile (no users doc → uniqueId null)', async () => {
    const noProfile = await mintTokenWithoutUserDoc({ cohort: 'adult' });
    const app = createApp();
    const res = await request(app)
      .post('/api/livekit/token')
      .set(noProfile.headers)
      .send({ roomName: 'room-1' })
      .expect(403);
    expect(res.body.error).toBe('User profile not found');
  });

  test('404 (opaque) when roomName fails the charset pattern', async () => {
    const user = await mintRealUser({ uniqueId: 50000003, cohort: 'adult' });
    const app = createApp();
    const res = await request(app)
      .post('/api/livekit/token')
      .set(user.headers)
      .send({ roomName: 'has spaces!' })
      .expect(404);
    expect(res.body.error).toBe('Not found');
  });

  test('404 for a path-traversal roomName before any Firestore read', async () => {
    // `rooms/x/messages/y` would make db.doc() throw on an even-segment path;
    // the charset pattern rejects it first with an opaque 404 (no 500 oracle).
    const user = await mintRealUser({ uniqueId: 50000004, cohort: 'adult' });
    const app = createApp();
    const res = await request(app)
      .post('/api/livekit/token')
      .set(user.headers)
      .send({ roomName: 'x/messages/y' })
      .expect(404);
    expect(res.body.error).toBe('Not found');
  });

  test('rejects an RTL/CJK roomName via the charset pattern (404)', async () => {
    const user = await mintRealUser({ uniqueId: 50000005, cohort: 'adult' });
    const app = createApp();
    for (const roomName of ['مرحبا', '部屋', 'zero​width']) {
      const res = await request(app)
        .post('/api/livekit/token')
        .set(user.headers)
        .send({ roomName })
        .expect(404);
      expect(res.body.error).toBe('Not found');
    }
  });

  test('404 when the room does not exist', async () => {
    const user = await mintRealUser({ uniqueId: 50000006, cohort: 'adult' });
    const app = createApp();
    const res = await request(app)
      .post('/api/livekit/token')
      .set(user.headers)
      .send({ roomName: 'no-such-room' })
      .expect(404);
    expect(res.body.error).toBe('Not found');
  });

  // ─── Happy path: real token mint + verify ──────────────────────

  test('mints a real token a real cohort member can verify', async () => {
    await seedRoom('room-adult-1', { cohort: 'adult' });
    const user = await mintRealUser({ uniqueId: 99001, cohort: 'adult' });
    const app = createApp();

    const res = await request(app)
      .post('/api/livekit/token')
      .set(user.headers)
      .send({ roomName: 'room-adult-1' })
      .expect(200);

    expect(typeof res.body.token).toBe('string');
    const claims = await verifyWith(res.body.token, ASIA_KEY, ASIA_SECRET);
    expect(claims.sub).toBe('99001');
    expect(claims.video).toMatchObject({
      roomJoin: true,
      room: 'room-adult-1',
      canPublish: true,
      canSubscribe: true,
    });
  });

  test('uses the authed uniqueId as identity, ignoring a body-supplied identity', async () => {
    await seedRoom('room-adult-2', { cohort: 'adult' });
    const user = await mintRealUser({ uniqueId: 99002, cohort: 'adult' });
    const app = createApp();

    const res = await request(app)
      .post('/api/livekit/token')
      .set(user.headers)
      .send({ roomName: 'room-adult-2', identity: 'impersonated-user' })
      .expect(200);

    const claims = await verifyWith(res.body.token, ASIA_KEY, ASIA_SECRET);
    expect(claims.sub).toBe('99002');
    expect(claims.sub).not.toBe('impersonated-user');
  });

  test('stamps the room cohort onto the token metadata', async () => {
    await seedRoom('room-minor-1', { cohort: 'minor' });
    const user = await mintRealUser({ uniqueId: 70001, cohort: 'minor' });
    const app = createApp();

    const res = await request(app)
      .post('/api/livekit/token')
      .set(user.headers)
      .send({ roomName: 'room-minor-1' })
      .expect(200);

    const claims = await verifyWith(res.body.token, ASIA_KEY, ASIA_SECRET);
    expect(JSON.parse(claims.metadata)).toEqual({ cohort: 'minor' });
  });

  // ─── Region resolution proven via signature ────────────────────

  test('default region is asia (token verifies with the asia secret, not eu)', async () => {
    await seedRoom('room-adult-3', { cohort: 'adult' });
    const user = await mintRealUser({ uniqueId: 50000007, cohort: 'adult' });
    const app = createApp();

    const res = await request(app)
      .post('/api/livekit/token')
      .set(user.headers)
      .send({ roomName: 'room-adult-3' })
      .expect(200);

    await expect(verifyWith(res.body.token, ASIA_KEY, ASIA_SECRET)).resolves.toBeDefined();
    await expect(verifyWith(res.body.token, EU_KEY, EU_SECRET)).rejects.toThrow();
  });

  test('an EU CF-IPCountry header routes to the eu secret', async () => {
    await seedRoom('room-adult-4', { cohort: 'adult' });
    const user = await mintRealUser({ uniqueId: 50000008, cohort: 'adult' });
    const app = createApp();

    const res = await request(app)
      .post('/api/livekit/token')
      .set(user.headers)
      .set('cf-ipcountry', 'GB')
      .send({ roomName: 'room-adult-4' })
      .expect(200);

    await expect(verifyWith(res.body.token, EU_KEY, EU_SECRET)).resolves.toBeDefined();
    await expect(verifyWith(res.body.token, ASIA_KEY, ASIA_SECRET)).rejects.toThrow();
  });

  test('falls back to the global secret when the region secret is unset', async () => {
    delete process.env.LIVEKIT_KEY_ASIA;
    delete process.env.LIVEKIT_SECRET_ASIA;
    await seedRoom('room-adult-5', { cohort: 'adult' });
    const user = await mintRealUser({ uniqueId: 50000009, cohort: 'adult' });
    const app = createApp();

    const res = await request(app)
      .post('/api/livekit/token')
      .set(user.headers)
      .send({ roomName: 'room-adult-5' })
      .expect(200);

    await expect(verifyWith(res.body.token, FALLBACK_KEY, FALLBACK_SECRET)).resolves.toBeDefined();
  });

  // ─── url field + 503 credential paths ──────────────────────────

  test('omits the url field in local mode', async () => {
    await seedRoom('room-adult-6', { cohort: 'adult' });
    const user = await mintRealUser({ uniqueId: 50000010, cohort: 'adult' });
    const app = createApp();

    const res = await request(app)
      .post('/api/livekit/token')
      .set(user.headers)
      .send({ roomName: 'room-adult-6' })
      .expect(200);

    expect(res.body.url).toBeUndefined();
  });

  test('503 when the resolved region has no credentials', async () => {
    for (const k of LK_ENV_KEYS) delete process.env[k];
    await seedRoom('room-adult-7', { cohort: 'adult' });
    const user = await mintRealUser({ uniqueId: 50000011, cohort: 'adult' });
    const app = createApp();

    const res = await request(app)
      .post('/api/livekit/token')
      .set(user.headers)
      .send({ roomName: 'room-adult-7' })
      .expect(503);
    expect(res.body.error).toBe('Voice service not available');
  });

  test('503 when only the api key is missing', async () => {
    delete process.env.LIVEKIT_KEY_ASIA;
    delete process.env.LIVEKIT_API_KEY; // secrets remain set
    await seedRoom('room-adult-8', { cohort: 'adult' });
    const user = await mintRealUser({ uniqueId: 50000012, cohort: 'adult' });
    const app = createApp();

    const res = await request(app)
      .post('/api/livekit/token')
      .set(user.headers)
      .send({ roomName: 'room-adult-8' })
      .expect(503);
    expect(res.body.error).toBe('Voice service not available');
  });

  test('503 when only the api secret is missing (symmetric to the key branch)', async () => {
    // The route guard is `!apiKey || !apiSecret`; the key-missing branch is
    // covered above, this pins the secret-missing branch (key present, secret
    // absent for both region + fallback) so neither half of the `||` regresses.
    delete process.env.LIVEKIT_SECRET_ASIA;
    delete process.env.LIVEKIT_API_SECRET; // keys remain set
    await seedRoom('room-adult-11', { cohort: 'adult' });
    const user = await mintRealUser({ uniqueId: 50000015, cohort: 'adult' });
    const app = createApp();

    const res = await request(app)
      .post('/api/livekit/token')
      .set(user.headers)
      .send({ roomName: 'room-adult-11' })
      .expect(503);
    expect(res.body.error).toBe('Voice service not available');
  });

  // ─── Security: secret never leaves the server ──────────────────

  test('never leaks the signing secret in the response body or token payload', async () => {
    await seedRoom('room-adult-9', { cohort: 'adult' });
    const user = await mintRealUser({ uniqueId: 50000013, cohort: 'adult' });
    const app = createApp();

    const res = await request(app)
      .post('/api/livekit/token')
      .set(user.headers)
      .send({ roomName: 'room-adult-9' })
      .expect(200);

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(ASIA_SECRET);
    expect(serialized).not.toContain(FALLBACK_SECRET);
    // JWT payload (middle segment) must not embed the HS256 secret either.
    const payload = res.body.token.split('.')[1];
    const decoded = Buffer.from(payload, 'base64').toString('utf8');
    expect(decoded).not.toContain(ASIA_SECRET);
  });

  // ─── Performance ───────────────────────────────────────────────

  test('mints within the local-emulator budget', async () => {
    // Coarse UPPER bound (matches the SHY-0125 AC): real auth adds verifyIdToken
    // + ~3 Firestore round-trips (uniqueId resolve, suspension read, room read)
    // before the local JWT mint, so this guards against a hang / gross regression
    // (e.g. an N+1 or an accidental real network call), NOT a single extra
    // round-trip. A sub-500ms bound flakes under CI emulator load; 2000ms is the
    // CI-safe ceiling agreed in the story.
    await seedRoom('room-adult-10', { cohort: 'adult' });
    const user = await mintRealUser({ uniqueId: 50000014, cohort: 'adult' });
    const app = createApp();

    const started = Date.now();
    await request(app)
      .post('/api/livekit/token')
      .set(user.headers)
      .send({ roomName: 'room-adult-10' })
      .expect(200);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
