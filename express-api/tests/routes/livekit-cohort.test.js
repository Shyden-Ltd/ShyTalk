/**
 * POST /api/livekit/token — cohort gate, REAL-services integration test.
 *
 * SHY-0125 (EPIC-0003 · SHY-0113 Rooms slice 1): migrated off ALL in-process
 * doubles. NO jest.mock of firebase / livekit-server-sdk / livekit-region / log,
 * and NO faked req.auth — the REAL auth middleware is in the chain and the cohort
 * claim rides on a REAL Firebase ID token minted via the Auth emulator.
 *
 * What the LiveKit token mint enforces (UK OSA #17 PR 7): the `/api/livekit/token`
 * route is the only Express choke-point between a client and a LiveKit room — rooms
 * are written direct-to-Firestore so the rules layer carries the read/write gates,
 * but the participant GRANT only happens here. A cross-cohort caller who somehow
 * learns a roomId could otherwise obtain a grant and speak in a wrong-cohort room.
 *
 * Contract pinned (all proven against real services here):
 *   1. Same-cohort caller → 200 + a token the cohort member can verify (control).
 *   2. Cross-cohort caller → 404 `{ error: 'Not found' }`, byte-identical to the
 *      room-missing 404 (existence-hiding parity with `requireSameCohort`).
 *   3. Admin caller → 200 even cross-cohort (moderation needs entry); NO audit row.
 *   4. Room missing → 404, same body. No audit row (gate not fired).
 *   5. Fail-closed defaults: room with no `cohort` → minor; missing/invalid caller
 *      claim → minor; `cohortOverride` (allow-listed) wins over `cohort`.
 *   6. Cross-cohort attempt writes a real `segregationEvents` row with the exact
 *      value shape (source/target cohorts, targetRoomId, surface, action, ts).
 *   7. The cohort gate fires BEFORE the credentials check (a mis-configured region
 *      must not leak room existence via a 503 to a cross-cohort caller).
 *   8. Defence-in-depth: the minted JWT's `metadata` carries the ROOM cohort.
 *
 * COHORT (adult/minor — age segregation) ≠ REGION (asia/eu — LiveKit routing):
 * orthogonal axes. The region matrix lives in livekit.test.js (signature proof) +
 * the livekit-region unit test (value matrix). This file sets region creds only so
 * the same-cohort/admin mints succeed (else 503), and verifies with the asia secret.
 *
 * NODE_ENV='local' is set BEFORE requiring src/utils/firebase so the Admin SDK +
 * Auth emulator target localhost. PER-FILE opt-in only — never prepend NODE_ENV=local
 * to the canonical `npm test` run (feedback-express-suite-no-node-env-override).
 *
 * AC → test map (SHY-0125 cohort slice):
 *   Happy / same-cohort       -> "200 + verifiable token … both adult", "… both minor"
 *   Cross-cohort deny + audit -> "404 (opaque) when adult caller targets a minor room",
 *                                "404 (opaque) when minor caller targets an adult room",
 *                                "writes a real segregationEvents row with the full value shape"
 *   Existence-hiding          -> "cross-cohort 404 body is byte-identical to room-missing 404"
 *   Admin bypass              -> "admin caller bypasses the gate (200) and writes no audit row",
 *                                "admin-bypass token metadata follows the ROOM cohort"
 *   Fail-closed (value matrix)-> "room without a cohort field defaults to minor — adult blocked",
 *                                "… minor allowed", "missing cohort claim → minor (blocked)",
 *                                "invalid cohort claim → minor (blocked)",
 *                                "cohortOverride:minor wins (adult blocked)",
 *                                "cohortOverride:adult wins (adult allowed)"
 *   Precedence / ordering     -> "roomName-missing 400 wins (no audit, no Firestore read)",
 *                                "malformed roomName → opaque 404 before the gate (no audit)",
 *                                "cohort gate fires BEFORE the credentials check (404 not 503)"
 *   Defence-in-depth metadata -> "JWT metadata carries the room cohort (adult / minor)",
 *                                "JWT metadata is a JSON string parsing to { cohort }",
 *                                "minted token carries BOTH cohort metadata AND the room grant",
 *                                "cross-cohort denial returns no token"
 *
 * NOTE (policy — un-inducible errors, escalate-not-mock): three old tests forced a
 * failure with a double — `audit-write failure does NOT leak`, `audit failure logs
 * the error`, and `Firestore lookup → 500`. Against the real emulator a Firestore
 * `add`/`get` cannot be made to reject deterministically without re-introducing a
 * mock, and the dev logger is a no-op counter (nothing to assert). The behavioural
 * guarantee they targeted — a cross-cohort caller always gets the SAME opaque 404
 * regardless of the fire-and-forget audit outcome — is structural (the audit `.catch`
 * never touches the response) and is covered by the opaque-404 + audit-row tests
 * below. The faked-failure cases are dropped per "impossible-to-induce → escalate,
 * never silent-mock" (same call as livekit.test.js's catch-all 500).
 */

const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

// Deterministic real LiveKit creds (HS256 needs ≥32-char secrets). The mints
// here use the default (asia) region; tokens are verified with the asia secret.
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
const { assertEmulatorReachable, clearCollection } = require('../helpers/firebase-emulator');
const { mintRealUser, clearAuthCaches } = require('../helpers/real-auth');
const livekitRouter = require('../../src/routes/livekit');

const ROOMS = 'rooms';
const SEG_EVENTS = 'segregationEvents';
const LIVEKIT_SURFACE = '/api/livekit/token';

/** App with the REAL auth middleware ahead of the router. */
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

/** Verify a real minted LiveKit token with a key/secret; resolves claims or throws. */
function verifyWith(token, key, secret) {
  return new TokenVerifier(key, secret).verify(token);
}

/**
 * Poll the real segregationEvents collection until a row for this source lands.
 * The route's audit write is fire-and-forget (not awaited), so it may post-date
 * the 404 response. Single-field equality query (always emulator-safe — a 2-field
 * query would need a composite index); the collection is cleared per-test and
 * each test uses a unique uniqueId, so at most one row matches.
 */
async function pollSegregationEvent(sourceUniqueId, { timeoutMs = 4000, intervalMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const query = db.collection(SEG_EVENTS).where('sourceUniqueId', '==', String(sourceUniqueId));
  let snap = await query.get();
  while (snap.empty && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    snap = await query.get();
  }
  return snap.empty ? [] : snap.docs.map((d) => d.data());
}

/**
 * Assert NO audit row exists for this source (used on the allow / admin-bypass
 * paths). Race-safe WITHOUT a wait: the allow branch in the route NEVER calls
 * writeSegregationEvent (the cross-cohort branch is not entered), so there is no
 * fire-and-forget write in flight to lose to. SEG_EVENTS is also cleared in
 * beforeEach and the query is scoped to this test's unique sourceUniqueId, so a
 * late write from a prior test (different id) cannot pollute this assertion.
 */
async function expectNoSegregationEvent(sourceUniqueId) {
  const snap = await db
    .collection(SEG_EVENTS)
    .where('sourceUniqueId', '==', String(sourceUniqueId))
    .get();
  expect(snap.empty).toBe(true);
}

beforeAll(async () => {
  await assertEmulatorReachable();
});

// Cross-file isolation: the emulator is a SINGLE shared backend across Jest
// workers (maxWorkers: 2), so a whole-collection clear of ROOMS/USERS here would
// race livekit.test.js (which also seeds those) and wipe its data mid-test. Both
// files seed globally-unique, deterministic IDs via `set()` (idempotent re-runs;
// disjoint ranges: this file 60000xxx, livekit.test.js 5xxxx/9xxxx/7xxxx), so no
// ROOMS/USERS clear is needed. SEG_EVENTS is the exception: the route writes it
// via `.add()` (non-idempotent — accumulates across runs) and ONLY this file
// touches it, so clearing it here races nothing and keeps per-run counts exact.
beforeEach(async () => {
  setRegionEnv();
  clearAuthCaches();
  await clearCollection(db, SEG_EVENTS);
});

afterAll(async () => {
  await clearCollection(db, SEG_EVENTS);
  for (const k of LK_ENV_KEYS) {
    if (PRIOR_LK_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = PRIOR_LK_ENV[k];
  }
  if (PRIOR_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = PRIOR_NODE_ENV;
});

describe('POST /api/livekit/token — cohort gate (real services + real auth)', () => {
  // ─── Same-cohort allow (control) ───────────────────────────────

  test('200 + verifiable token when caller and room are both adult', async () => {
    await seedRoom('room-adult', { cohort: 'adult' });
    const user = await mintRealUser({ uniqueId: 60000001, cohort: 'adult' });
    const app = createApp();

    const res = await request(app)
      .post('/api/livekit/token')
      .set(user.headers)
      .send({ roomName: 'room-adult' })
      .expect(200);

    const claims = await verifyWith(res.body.token, ASIA_KEY, ASIA_SECRET);
    expect(claims.sub).toBe('60000001');
    await expectNoSegregationEvent(60000001);
  });

  test('200 + verifiable token when caller and room are both minor', async () => {
    await seedRoom('room-minor', { cohort: 'minor' });
    const user = await mintRealUser({ uniqueId: 60000002, cohort: 'minor' });
    const app = createApp();

    const res = await request(app)
      .post('/api/livekit/token')
      .set(user.headers)
      .send({ roomName: 'room-minor' })
      .expect(200);

    const claims = await verifyWith(res.body.token, ASIA_KEY, ASIA_SECRET);
    expect(claims.sub).toBe('60000002');
    await expectNoSegregationEvent(60000002);
  });

  // ─── Cross-cohort deny + audit ─────────────────────────────────

  test('404 (opaque) when an adult caller targets a minor room', async () => {
    await seedRoom('xc-room-1', { cohort: 'minor' });
    const user = await mintRealUser({ uniqueId: 60000003, cohort: 'adult' });
    const app = createApp();

    const res = await request(app)
      .post('/api/livekit/token')
      .set(user.headers)
      .send({ roomName: 'xc-room-1' })
      .expect(404);

    expect(res.body).toEqual({ error: 'Not found' });
    expect(res.body.token).toBeUndefined();
    const rows = await pollSegregationEvent(60000003);
    expect(rows).toHaveLength(1);
  });

  test('404 (opaque) when a minor caller targets an adult room', async () => {
    await seedRoom('xc-room-2', { cohort: 'adult' });
    const user = await mintRealUser({ uniqueId: 60000004, cohort: 'minor' });
    const app = createApp();

    const res = await request(app)
      .post('/api/livekit/token')
      .set(user.headers)
      .send({ roomName: 'xc-room-2' })
      .expect(404);

    expect(res.body).toEqual({ error: 'Not found' });
    const rows = await pollSegregationEvent(60000004);
    expect(rows).toHaveLength(1);
  });

  test('cross-cohort 404 body is byte-identical to the room-missing 404 (existence-hiding)', async () => {
    await seedRoom('xc-room-3', { cohort: 'minor' });
    const adult = await mintRealUser({ uniqueId: 60000005, cohort: 'adult' });
    const app = createApp();

    const crossCohort = await request(app)
      .post('/api/livekit/token')
      .set(adult.headers)
      .send({ roomName: 'xc-room-3' })
      .expect(404);

    const missingRoom = await request(app)
      .post('/api/livekit/token')
      .set(adult.headers)
      .send({ roomName: 'does-not-exist' })
      .expect(404);

    // Identical bodies — a probe cannot distinguish "wrong cohort" from "no room".
    expect(crossCohort.body).toEqual(missingRoom.body);
    expect(crossCohort.text).toBe(missingRoom.text);
  });

  test('cross-cohort attempt writes a real segregationEvents row with the full value shape', async () => {
    await seedRoom('xc-room-4', { cohort: 'minor' });
    const user = await mintRealUser({ uniqueId: 60000006, cohort: 'adult' });
    const app = createApp();

    await request(app)
      .post('/api/livekit/token')
      .set(user.headers)
      .send({ roomName: 'xc-room-4' })
      .expect(404);

    const rows = await pollSegregationEvent(60000006);
    expect(rows).toHaveLength(1);
    const evt = rows[0];
    expect(evt).toMatchObject({
      sourceUniqueId: '60000006',
      sourceCohort: 'adult',
      targetUniqueId: 'xc-room-4',
      targetRoomId: 'xc-room-4',
      targetCohort: 'minor',
      surface: LIVEKIT_SURFACE,
      action: 'blocked',
      requestId: null,
    });
    expect(typeof evt.timestamp).toBe('number');
    expect(evt.timestamp).toBeGreaterThan(0);
  });

  test('room missing → 404 with no audit row (gate not fired)', async () => {
    const user = await mintRealUser({ uniqueId: 60000007, cohort: 'adult' });
    const app = createApp();

    const res = await request(app)
      .post('/api/livekit/token')
      .set(user.headers)
      .send({ roomName: 'ghost-room' })
      .expect(404);

    expect(res.body).toEqual({ error: 'Not found' });
    // A missing room is a regular 404 cause, not a gate hit — no audit row.
    expect(await pollSegregationEvent(60000007, { timeoutMs: 500 })).toHaveLength(0);
  });

  // ─── Admin bypass ──────────────────────────────────────────────

  test('admin caller bypasses the gate (200 cross-cohort) and writes no audit row', async () => {
    await seedRoom('admin-room', { cohort: 'minor' });
    const admin = await mintRealUser({ uniqueId: 60000008, cohort: 'adult', admin: true });
    const app = createApp();

    const res = await request(app)
      .post('/api/livekit/token')
      .set(admin.headers)
      .send({ roomName: 'admin-room' })
      .expect(200);

    expect(typeof res.body.token).toBe('string');
    await expectNoSegregationEvent(60000008);
  });

  test('admin-bypass token metadata follows the ROOM cohort, not the admin caller', async () => {
    // Admin is adult; room is minor. The metadata stamped on the JWT must be the
    // ROOM's cohort so any LiveKit-server-side policy treats the connection as
    // belonging to the room's cohort, not the admin's.
    await seedRoom('admin-room-2', { cohort: 'minor' });
    const admin = await mintRealUser({ uniqueId: 60000009, cohort: 'adult', admin: true });
    const app = createApp();

    const res = await request(app)
      .post('/api/livekit/token')
      .set(admin.headers)
      .send({ roomName: 'admin-room-2' })
      .expect(200);

    const claims = await verifyWith(res.body.token, ASIA_KEY, ASIA_SECRET);
    expect(JSON.parse(claims.metadata)).toEqual({ cohort: 'minor' });
  });

  // ─── Fail-closed defaults (value matrix) ───────────────────────

  test('room without a cohort field defaults to minor — an adult caller is blocked (404 + audit)', async () => {
    // Pre-PR-7 rooms have no cohort field; effectiveCohort fails them closed to
    // 'minor', so an adult cannot mint a token until the room is migration-tagged.
    await seedRoom('legacy-room-1', { name: 'legacy' /* no cohort */ });
    const user = await mintRealUser({ uniqueId: 60000010, cohort: 'adult' });
    const app = createApp();

    const res = await request(app)
      .post('/api/livekit/token')
      .set(user.headers)
      .send({ roomName: 'legacy-room-1' })
      .expect(404);

    expect(res.body).toEqual({ error: 'Not found' });
    const rows = await pollSegregationEvent(60000010);
    expect(rows[0]).toMatchObject({ sourceCohort: 'adult', targetCohort: 'minor' });
  });

  test('room without a cohort field defaults to minor — a minor caller is allowed (200)', async () => {
    await seedRoom('legacy-room-2', { name: 'legacy' /* no cohort */ });
    const user = await mintRealUser({ uniqueId: 60000011, cohort: 'minor' });
    const app = createApp();

    const res = await request(app)
      .post('/api/livekit/token')
      .set(user.headers)
      .send({ roomName: 'legacy-room-2' })
      .expect(200);

    const claims = await verifyWith(res.body.token, ASIA_KEY, ASIA_SECRET);
    expect(JSON.parse(claims.metadata)).toEqual({ cohort: 'minor' });
    await expectNoSegregationEvent(60000011);
  });

  test('a missing cohort claim is treated as minor — blocked from an adult room (404)', async () => {
    // Real user with a profile but NO cohort claim on the token → fail-closed minor.
    await seedRoom('adult-room-a', { cohort: 'adult' });
    const user = await mintRealUser({ uniqueId: 60000012 /* cohort omitted */ });
    const app = createApp();

    const res = await request(app)
      .post('/api/livekit/token')
      .set(user.headers)
      .send({ roomName: 'adult-room-a' })
      .expect(404);

    expect(res.body).toEqual({ error: 'Not found' });
    const rows = await pollSegregationEvent(60000012);
    expect(rows[0]).toMatchObject({ sourceCohort: 'minor', targetCohort: 'adult' });
  });

  test('an invalid cohort claim is treated as minor — blocked from an adult room (404)', async () => {
    // A bogus claim value (admin-panel typo / tampered token) must NOT be honoured;
    // cohortFromClaim allow-lists {adult,minor} and fails everything else closed.
    await seedRoom('adult-room-b', { cohort: 'adult' });
    const user = await mintRealUser({ uniqueId: 60000013, cohort: 'superadult' });
    const app = createApp();

    const res = await request(app)
      .post('/api/livekit/token')
      .set(user.headers)
      .send({ roomName: 'adult-room-b' })
      .expect(404);

    expect(res.body).toEqual({ error: 'Not found' });
    const rows = await pollSegregationEvent(60000013);
    expect(rows[0]).toMatchObject({ sourceCohort: 'minor', targetCohort: 'adult' });
  });

  test('cohortOverride wins over cohort — override:minor on a cohort:adult room blocks an adult caller', async () => {
    await seedRoom('override-room-1', { cohort: 'adult', cohortOverride: 'minor' });
    const user = await mintRealUser({ uniqueId: 60000014, cohort: 'adult' });
    const app = createApp();

    const res = await request(app)
      .post('/api/livekit/token')
      .set(user.headers)
      .send({ roomName: 'override-room-1' })
      .expect(404);

    expect(res.body).toEqual({ error: 'Not found' });
    const rows = await pollSegregationEvent(60000014);
    // Room resolves to the OVERRIDE (minor), not the cohort field (adult).
    expect(rows[0]).toMatchObject({ sourceCohort: 'adult', targetCohort: 'minor' });
  });

  test('cohortOverride wins over cohort — override:adult on a cohort:minor room allows an adult caller', async () => {
    await seedRoom('override-room-2', { cohort: 'minor', cohortOverride: 'adult' });
    const user = await mintRealUser({ uniqueId: 60000015, cohort: 'adult' });
    const app = createApp();

    const res = await request(app)
      .post('/api/livekit/token')
      .set(user.headers)
      .send({ roomName: 'override-room-2' })
      .expect(200);

    const claims = await verifyWith(res.body.token, ASIA_KEY, ASIA_SECRET);
    // Token metadata reflects the resolved (override → adult) cohort.
    expect(JSON.parse(claims.metadata)).toEqual({ cohort: 'adult' });
    await expectNoSegregationEvent(60000015);
  });

  // ─── Precedence / ordering (cohort-relevant) ───────────────────

  test('roomName-missing 400 wins over the cohort gate (no audit, no room read)', async () => {
    const user = await mintRealUser({ uniqueId: 60000016, cohort: 'adult' });
    const app = createApp();

    const res = await request(app)
      .post('/api/livekit/token')
      .set(user.headers)
      .send({})
      .expect(400);

    expect(res.body.error).toBe('roomName is required');
    await expectNoSegregationEvent(60000016);
  });

  test('malformed roomName → opaque 404 before the cohort gate (no audit row)', async () => {
    // The charset pattern rejects `x/messages/y` with the same opaque 404 BEFORE
    // any Firestore read or cohort comparison — so no audit row is written.
    const user = await mintRealUser({ uniqueId: 60000017, cohort: 'adult' });
    const app = createApp();

    const res = await request(app)
      .post('/api/livekit/token')
      .set(user.headers)
      .send({ roomName: 'x/messages/y' })
      .expect(404);

    expect(res.body).toEqual({ error: 'Not found' });
    await expectNoSegregationEvent(60000017);
  });

  test('cohort gate fires BEFORE the credentials check — cross-cohort caller gets 404, not 503', async () => {
    // If a refactor moved the region-credential validation above the cohort gate,
    // a cross-cohort caller hitting an unconfigured region would get 503 (revealing
    // the room exists) instead of the existence-hiding 404. Induce the real
    // condition: clear every region credential, then send a cross-cohort request.
    for (const k of LK_ENV_KEYS) delete process.env[k];
    await seedRoom('xc-room-5', { cohort: 'minor' });
    const user = await mintRealUser({ uniqueId: 60000018, cohort: 'adult' });
    const app = createApp();

    const res = await request(app)
      .post('/api/livekit/token')
      .set(user.headers)
      .send({ roomName: 'xc-room-5' })
      .expect(404);

    expect(res.body).toEqual({ error: 'Not found' });
    // The gate still fired (and audited) despite the missing creds.
    const rows = await pollSegregationEvent(60000018);
    expect(rows).toHaveLength(1);
  });

  // ─── Defence-in-depth: metadata.cohort JWT claim (PR 7) ────────

  test('JWT metadata carries the room cohort (adult)', async () => {
    await seedRoom('meta-room-1', { cohort: 'adult' });
    const user = await mintRealUser({ uniqueId: 60000019, cohort: 'adult' });
    const app = createApp();

    const res = await request(app)
      .post('/api/livekit/token')
      .set(user.headers)
      .send({ roomName: 'meta-room-1' })
      .expect(200);

    const claims = await verifyWith(res.body.token, ASIA_KEY, ASIA_SECRET);
    expect(JSON.parse(claims.metadata)).toEqual({ cohort: 'adult' });
  });

  test('JWT metadata carries the room cohort (minor)', async () => {
    await seedRoom('meta-room-2', { cohort: 'minor' });
    const user = await mintRealUser({ uniqueId: 60000020, cohort: 'minor' });
    const app = createApp();

    const res = await request(app)
      .post('/api/livekit/token')
      .set(user.headers)
      .send({ roomName: 'meta-room-2' })
      .expect(200);

    const claims = await verifyWith(res.body.token, ASIA_KEY, ASIA_SECRET);
    expect(JSON.parse(claims.metadata)).toEqual({ cohort: 'minor' });
  });

  test('JWT metadata is a JSON string parsing to { cohort } (wire format pinned)', async () => {
    // The client + LiveKit server agree on a JSON-serialized object; a refactor to
    // `at.metadata = { cohort }` (raw object) would break the wire + the j09 parse.
    await seedRoom('meta-room-3', { cohort: 'adult' });
    const user = await mintRealUser({ uniqueId: 60000021, cohort: 'adult' });
    const app = createApp();

    const res = await request(app)
      .post('/api/livekit/token')
      .set(user.headers)
      .send({ roomName: 'meta-room-3' })
      .expect(200);

    const claims = await verifyWith(res.body.token, ASIA_KEY, ASIA_SECRET);
    expect(typeof claims.metadata).toBe('string');
    expect(JSON.parse(claims.metadata)).toEqual({ cohort: 'adult' });
  });

  test('minted token carries BOTH the cohort metadata AND the room-join grant', async () => {
    // Replaces the old mock-introspected "metadata before addGrant" ordering pin:
    // ordering is invisible in the real JWT, but the observable contract is that
    // the minted token ends up with both the metadata claim and the room grant.
    await seedRoom('meta-room-4', { cohort: 'adult' });
    const user = await mintRealUser({ uniqueId: 60000022, cohort: 'adult' });
    const app = createApp();

    const res = await request(app)
      .post('/api/livekit/token')
      .set(user.headers)
      .send({ roomName: 'meta-room-4' })
      .expect(200);

    const claims = await verifyWith(res.body.token, ASIA_KEY, ASIA_SECRET);
    expect(JSON.parse(claims.metadata)).toEqual({ cohort: 'adult' });
    expect(claims.video).toMatchObject({ roomJoin: true, room: 'meta-room-4' });
  });

  test('cross-cohort denial returns no token (nothing to leak the cohort through)', async () => {
    await seedRoom('meta-room-5', { cohort: 'minor' });
    const user = await mintRealUser({ uniqueId: 60000023, cohort: 'adult' });
    const app = createApp();

    const res = await request(app)
      .post('/api/livekit/token')
      .set(user.headers)
      .send({ roomName: 'meta-room-5' })
      .expect(404);

    expect(res.body.token).toBeUndefined();
  });
});
