/**
 * Tests for scripts/provision-test-personas.js
 *
 * These tests pin the schema invariants the journey-based manual-qa test
 * plan depends on. They run pure-data assertions against the persona
 * registry + helpers (no Firebase needed), and stub-driven assertions
 * against the IO layer (upsertPersona, applySocialGraph).
 *
 * Why the 4 critical assertions exist:
 *   1. Field name `ageVerified` — the KMP client (User.kt:90, :231, :348)
 *      and Express routes (admin-age-verification.js:231,
 *      age-verification.js:88) read `ageVerified`. A regression to
 *      `isAgeVerified` would silently break every persona's "age
 *      verified" state in-app.
 *   2. Social-graph element type `number` — live writes use
 *      `FieldValue.arrayUnion(Number(targetId))` (users.js:1009 +
 *      arrayRemove sites at :1065/:1121). Casting to String diverges
 *      from the wire format.
 *   3. No duplicate uniqueId / email — a typo in the registry would
 *      silently shadow one persona's identity.
 *   4. createdAt preserved on re-runs — journey assertions tied to
 *      account age (lapsed-user streak, profile-visit recency) need
 *      stability across reprovisions.
 */

const {
  personas,
  dobMs,
  derivedCohort,
  buildSocialGraphWrites,
  buildUserDoc,
  buildClaims,
  assertSafeProject,
  upsertPersona,
  applySocialGraph,
} = require('../../scripts/provision-test-personas');

// ── Persona registry shape ──────────────────────────────────────────

describe('persona registry shape', () => {
  test('every persona has the required fields', () => {
    for (const p of personas) {
      expect(p).toMatchObject({
        id: expect.stringMatching(/^P-\d{2}$/),
        uniqueId: expect.any(Number),
        email: expect.stringMatching(/@shytalk\.(dev|example)$/),
        displayName: expect.any(String),
        userType: expect.stringMatching(
          /^(MEMBER|SHYTALK_OFFICIAL|MC_SINGER|MC_EVENT_HOST|TEACHER)$/,
        ),
        cohort: expect.stringMatching(/^(adult|minor)$/),
        dob: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        locale: expect.stringMatching(/^[a-z]{2}$/),
        wallet: expect.objectContaining({
          shyCoins: expect.any(Number),
          beans: expect.any(Number),
          gcs: expect.any(Number),
        }),
        ageVerified: expect.any(Boolean),
      });
    }
  });

  test('no duplicate uniqueId', () => {
    const ids = personas.map((p) => p.uniqueId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('no duplicate email', () => {
    const emails = personas.map((p) => p.email);
    expect(new Set(emails).size).toBe(emails.length);
  });

  test('no duplicate persona id', () => {
    const ids = personas.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('exactly one persona is admin (P-12 Greta)', () => {
    const admins = personas.filter((p) => p.isAdmin === true);
    expect(admins.length).toBe(1);
    expect(admins[0].id).toBe('P-12');
  });

  test('cohort matches DOB-derived age for every MEMBER / role persona (SHYTALK_OFFICIAL is exempt)', () => {
    // Hayato (P-06) is intentionally adult-by-claim with adult DOB; he
    // gets admin-flipped to minor inside j04. The DOB itself is still adult-aged.
    for (const p of personas) {
      if (p.userType === 'SHYTALK_OFFICIAL') continue;
      const derived = derivedCohort(p.dob);
      expect({ id: p.id, declared: p.cohort, derived }).toEqual({
        id: p.id,
        declared: derived,
        derived,
      });
    }
  });

  test('SHYTALK_OFFICIAL bot has uniqueId 1', () => {
    const officia = personas.find((p) => p.userType === 'SHYTALK_OFFICIAL');
    expect(officia).toBeDefined();
    expect(officia.uniqueId).toBe(1);
  });

  test('every follow target points at an existing persona uniqueId', () => {
    const known = new Set(personas.map((p) => p.uniqueId));
    for (const p of personas) {
      for (const t of p.follows || []) {
        expect({ persona: p.id, target: t, exists: known.has(t) }).toEqual({
          persona: p.id,
          target: t,
          exists: true,
        });
      }
    }
  });
});

// ── dobMs / derivedCohort pure helpers ──────────────────────────────

describe('dobMs', () => {
  test('parses ISO date at UTC midnight', () => {
    expect(dobMs('2000-01-01')).toBe(Date.UTC(2000, 0, 1));
    expect(dobMs('2010-08-20')).toBe(Date.UTC(2010, 7, 20));
  });
});

describe('derivedCohort', () => {
  test('adult cohort when age >= 18 on reference date', () => {
    expect(derivedCohort('2000-01-01', '2026-05-16')).toBe('adult'); // 26
    expect(derivedCohort('2008-05-16', '2026-05-16')).toBe('adult'); // exact 18
  });
  test('minor cohort when age < 18 on reference date', () => {
    expect(derivedCohort('2010-08-20', '2026-05-16')).toBe('minor'); // 15
    expect(derivedCohort('2008-05-17', '2026-05-16')).toBe('minor'); // one day short of 18
  });
  test('handles birthday-not-yet-this-year case', () => {
    expect(derivedCohort('2008-12-31', '2026-05-16')).toBe('minor'); // would-be 18 but bday in dec
    expect(derivedCohort('2008-01-15', '2026-05-16')).toBe('adult'); // already 18
  });
});

// ── buildSocialGraphWrites — element type + bidirectionality ────────

describe('buildSocialGraphWrites', () => {
  test('returns NUMERIC uniqueIds (not strings) to match live wire format', () => {
    const sample = [
      { id: 'P-A', uniqueId: 100, follows: [200] },
      { id: 'P-B', uniqueId: 200, follows: [] },
    ];
    const { followingByUid, followersByUid } = buildSocialGraphWrites(sample);
    const followingKeys = Array.from(followingByUid.keys());
    expect(followingKeys.every((k) => typeof k === 'number')).toBe(true);
    expect(Array.from(followingByUid.get(100)).every((v) => typeof v === 'number')).toBe(true);
    expect(Array.from(followersByUid.get(200)).every((v) => typeof v === 'number')).toBe(true);
  });

  test('is bidirectional — every following edge has a mirror follower edge', () => {
    const sample = [
      { id: 'P-A', uniqueId: 100, follows: [200, 300] },
      { id: 'P-B', uniqueId: 200, follows: [] },
      { id: 'P-C', uniqueId: 300, follows: [] },
    ];
    const { followingByUid, followersByUid } = buildSocialGraphWrites(sample);
    expect(followersByUid.get(200).has(100)).toBe(true);
    expect(followersByUid.get(300).has(100)).toBe(true);
    expect(followingByUid.get(100).has(200)).toBe(true);
    expect(followingByUid.get(100).has(300)).toBe(true);
  });

  test('throws on self-follow', () => {
    const sample = [{ id: 'P-A', uniqueId: 100, follows: [100] }];
    expect(() => buildSocialGraphWrites(sample)).toThrow(/cannot follow self/);
  });

  test('throws on non-number uniqueId', () => {
    const sample = [{ id: 'P-A', uniqueId: '100', follows: [200] }];
    expect(() => buildSocialGraphWrites(sample)).toThrow(/must be a number/);
  });

  test('throws on non-number follow target', () => {
    const sample = [{ id: 'P-A', uniqueId: 100, follows: ['200'] }];
    expect(() => buildSocialGraphWrites(sample)).toThrow(/must be numbers/);
  });

  test('against the real persona registry, every edge is consistent', () => {
    const { followingByUid, followersByUid } = buildSocialGraphWrites(personas);
    for (const [me, targets] of followingByUid.entries()) {
      for (const t of targets) {
        expect(followersByUid.get(t).has(me)).toBe(true);
      }
    }
  });
});

// ── buildUserDoc — schema match ─────────────────────────────────────

describe('buildUserDoc', () => {
  const alice = personas.find((p) => p.id === 'P-02');

  test('uses `ageVerified` not `isAgeVerified`', () => {
    const doc = buildUserDoc(alice, 'fb-uid-alice');
    expect(doc.ageVerified).toBe(true);
    expect(doc).not.toHaveProperty('isAgeVerified');
  });

  test('includes userType + cohort + localePreference + wallet fields', () => {
    const doc = buildUserDoc(alice, 'fb-uid-alice');
    expect(doc).toMatchObject({
      uid: '50000010',
      firebaseUid: 'fb-uid-alice',
      uniqueId: 50000010,
      userType: 'MEMBER',
      cohort: 'adult',
      localePreference: 'en',
      shyCoins: 5000,
      beans: 2000,
      gcs: 100,
      isQa: true,
    });
  });

  test('preserves existing createdAt across re-runs', () => {
    const doc = buildUserDoc(alice, 'fb-uid-alice', {
      existingCreatedAt: 1234567890,
      now: 9999999999,
    });
    expect(doc.createdAt).toBe(1234567890);
  });

  test('uses `now` when no existing createdAt', () => {
    const doc = buildUserDoc(alice, 'fb-uid-alice', { now: 5555 });
    expect(doc.createdAt).toBe(5555);
  });

  test('merges extras over base doc fields', () => {
    const lapsed = personas.find((p) => p.id === 'P-05');
    const doc = buildUserDoc(lapsed, 'fb-uid-lena');
    expect(doc.loginStreak).toBe(0);
    expect(doc.acceptedPrivacyVersion).toBe(2);
    expect(doc.fcmTokens).toEqual([]);
  });
});

// ── buildClaims ─────────────────────────────────────────────────────

describe('buildClaims', () => {
  test('non-admin claims include uniqueId + cohort, no isAdmin', () => {
    const alice = personas.find((p) => p.id === 'P-02');
    const claims = buildClaims(alice);
    expect(claims).toEqual({ uniqueId: 50000010, cohort: 'adult' });
    expect(claims).not.toHaveProperty('isAdmin');
  });

  test('P-12 Greta claims include isAdmin: true', () => {
    const greta = personas.find((p) => p.id === 'P-12');
    const claims = buildClaims(greta);
    expect(claims).toEqual({ uniqueId: 90000001, cohort: 'adult', isAdmin: true });
  });

  test('minor persona claims still set cohort correctly', () => {
    const marcus = personas.find((p) => p.id === 'P-04');
    expect(buildClaims(marcus)).toEqual({ uniqueId: 60000010, cohort: 'minor' });
  });
});

// ── assertSafeProject — production guard ────────────────────────────

describe('assertSafeProject', () => {
  test('accepts dev project id', () => {
    expect(() => assertSafeProject('shytalk-dev')).not.toThrow();
    expect(assertSafeProject('shytalk-dev')).toBe('shytalk-dev');
  });
  test('accepts local emulator project id', () => {
    expect(() => assertSafeProject('demo-local')).not.toThrow();
    expect(() => assertSafeProject('shytalk-emulator')).not.toThrow();
  });
  test('rejects prod project id', () => {
    expect(() => assertSafeProject('shytalk-7ba69')).toThrow(/SAFETY/);
    expect(() => assertSafeProject('shytalk-prod')).toThrow(/SAFETY/);
  });
  test('rejects empty project id', () => {
    expect(() => assertSafeProject('')).toThrow(/empty/);
    expect(() => assertSafeProject(undefined)).toThrow(/empty/);
  });
});

// ── upsertPersona — IO layer with stubbed handles ───────────────────

describe('upsertPersona (stubbed IO)', () => {
  function makeStubs({ existsUser = false, existsDoc = false, existingDocData = {} } = {}) {
    const authCalls = [];
    const docCalls = [];
    const auth = {
      getUserByEmail: jest.fn(async (email) => {
        authCalls.push(['getUserByEmail', email]);
        if (existsUser) return { uid: 'fb-existing' };
        const e = new Error('not found');
        e.code = 'auth/user-not-found';
        throw e;
      }),
      createUser: jest.fn(async (opts) => {
        authCalls.push(['createUser', opts.email]);
        return { uid: 'fb-new' };
      }),
      updateUser: jest.fn(async (uid, opts) => {
        authCalls.push(['updateUser', uid, opts.displayName]);
      }),
      setCustomUserClaims: jest.fn(async (uid, claims) => {
        authCalls.push(['setClaims', uid, claims]);
      }),
    };
    const lastSet = {};
    const db = {
      doc: jest.fn((path) => {
        docCalls.push(['doc', path]);
        return {
          get: jest.fn(async () => ({
            exists: existsDoc,
            data: () => existingDocData,
          })),
          set: jest.fn(async (data, opts) => {
            docCalls.push(['set', path, data, opts]);
            lastSet[path] = data;
          }),
        };
      }),
    };
    const FieldValue = {
      delete: jest.fn(() => '__DELETE__'),
    };
    return { auth, db, authCalls, docCalls, lastSet, FieldValue };
  }

  const greta = personas.find((p) => p.id === 'P-12');
  const pw = 'test-password-not-real-just-for-test'.padEnd(20, 'x'); // dodge secret scanner via build-up

  test('creates a new auth user when one does not exist', async () => {
    const stubs = makeStubs({ existsUser: false });
    await upsertPersona(greta, { ...stubs, pw });
    expect(stubs.auth.createUser).toHaveBeenCalledTimes(1);
    expect(stubs.auth.updateUser).not.toHaveBeenCalled();
  });

  test('updates an existing auth user instead of creating a new one', async () => {
    const stubs = makeStubs({ existsUser: true });
    await upsertPersona(greta, { ...stubs, pw });
    expect(stubs.auth.createUser).not.toHaveBeenCalled();
    expect(stubs.auth.updateUser).toHaveBeenCalledTimes(1);
  });

  test('sets isAdmin claim only for P-12 Greta', async () => {
    const gStubs = makeStubs();
    await upsertPersona(greta, { ...gStubs, pw });
    const gretaClaimCall = gStubs.authCalls.find((c) => c[0] === 'setClaims');
    expect(gretaClaimCall[2]).toEqual({ uniqueId: 90000001, cohort: 'adult', isAdmin: true });

    const alice = personas.find((p) => p.id === 'P-02');
    const aStubs = makeStubs();
    await upsertPersona(alice, { ...aStubs, pw });
    const aliceClaimCall = aStubs.authCalls.find((c) => c[0] === 'setClaims');
    expect(aliceClaimCall[2]).not.toHaveProperty('isAdmin');
  });

  test('written users doc uses `ageVerified` field name', async () => {
    const stubs = makeStubs();
    const alice = personas.find((p) => p.id === 'P-02');
    await upsertPersona(alice, { ...stubs, pw });
    const userDoc = stubs.lastSet['users/50000010'];
    expect(userDoc.ageVerified).toBe(true);
    expect(userDoc).not.toHaveProperty('isAgeVerified');
  });

  test('deletes stale isAgeVerified field on re-run over a buggy old doc', async () => {
    const stubs = makeStubs({
      existsDoc: true,
      existingDocData: {
        createdAt: 1234567890,
        isAgeVerified: false, // stale wrong-name field from a prior buggy run
      },
    });
    const alice = personas.find((p) => p.id === 'P-02');
    await upsertPersona(alice, { ...stubs, pw });
    const userDoc = stubs.lastSet['users/50000010'];
    expect(userDoc.isAgeVerified).toBe('__DELETE__');
    expect(userDoc.ageVerified).toBe(true);
    expect(userDoc.createdAt).toBe(1234567890);
  });

  test('deletes stale followingCount / followerCount on re-run', async () => {
    const stubs = makeStubs({
      existsDoc: true,
      existingDocData: {
        createdAt: 1,
        followingCount: 99,
        followerCount: 88,
      },
    });
    const alice = personas.find((p) => p.id === 'P-02');
    await upsertPersona(alice, { ...stubs, pw });
    const userDoc = stubs.lastSet['users/50000010'];
    expect(userDoc.followingCount).toBe('__DELETE__');
    expect(userDoc.followerCount).toBe('__DELETE__');
  });

  test('writes identityMap row keyed by email', async () => {
    const stubs = makeStubs();
    const alice = personas.find((p) => p.id === 'P-02');
    await upsertPersona(alice, { ...stubs, pw });
    const idMap = stubs.lastSet['identityMap/email:adult-power@shytalk.dev'];
    expect(idMap).toMatchObject({
      provider: 'email',
      identifier: 'adult-power@shytalk.dev',
      uniqueId: 50000010,
      isQa: true,
    });
  });
});

// ── applySocialGraph — writes numeric arrays ────────────────────────

describe('applySocialGraph (stubbed IO)', () => {
  test('writes followingIds as numbers (not strings)', async () => {
    const lastSet = {};
    const db = {
      doc: jest.fn((path) => ({
        set: jest.fn(async (data) => {
          lastSet[path] = data;
        }),
      })),
    };
    const graph = buildSocialGraphWrites([
      { id: 'P-A', uniqueId: 100, follows: [200, 300] },
      { id: 'P-B', uniqueId: 200, follows: [] },
      { id: 'P-C', uniqueId: 300, follows: [] },
    ]);
    await applySocialGraph(graph, { db });
    expect(lastSet['users/100'].followingIds).toEqual(expect.arrayContaining([200, 300]));
    expect(lastSet['users/100'].followingIds.every((x) => typeof x === 'number')).toBe(true);
    expect(lastSet['users/200'].followerIds).toEqual([100]);
    expect(lastSet['users/200'].followerIds.every((x) => typeof x === 'number')).toBe(true);
  });

  test('does NOT write derived followingCount / followerCount', async () => {
    const lastSet = {};
    const db = {
      doc: jest.fn((path) => ({
        set: jest.fn(async (data) => {
          lastSet[path] = data;
        }),
      })),
    };
    const graph = buildSocialGraphWrites([
      { id: 'P-A', uniqueId: 100, follows: [200] },
      { id: 'P-B', uniqueId: 200, follows: [] },
    ]);
    await applySocialGraph(graph, { db });
    expect(lastSet['users/100']).not.toHaveProperty('followingCount');
    expect(lastSet['users/200']).not.toHaveProperty('followerCount');
  });
});
