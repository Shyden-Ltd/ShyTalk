/**
 * Tests for scripts/manual-qa-runner.js
 *
 * Three layers:
 *   1. parseGherkin — pure-data parser tests against fixture .feature files.
 *   2. Pure helpers — classifySeverity, decodeJwtPayload, pickField, parseLiteral.
 *   3. Step matchers + scenario runner — stubbed `fetch` to verify dispatch
 *      and the result classification (pass / fail / STEP_NOT_IMPLEMENTED).
 *
 * Fixtures live in tests/scripts/fixtures/ and are committed — stable test
 * surface independent of the gitignored real journey files.
 */

const fs = require('fs');
const path = require('path');
const {
  parseGherkin,
  classifySeverity,
  decodeJwtPayload,
  pickField,
  parseLiteral,
  parseJsonishPredicate,
  executeStep,
  runFeatureFile,
} = require('../../scripts/manual-qa-runner');

const FIXTURE_DIR = path.join(__dirname, 'fixtures');

// ── parseGherkin ───────────────────────────────────────────────────

describe('parseGherkin', () => {
  const text = fs.readFileSync(path.join(FIXTURE_DIR, 'sample-auth.feature'), 'utf8');

  test('extracts the feature name', () => {
    const parsed = parseGherkin(text);
    expect(parsed.featureName).toBe('Fixture auth journey');
  });

  test('extracts background with steps', () => {
    const parsed = parseGherkin(text);
    expect(parsed.background).not.toBeNull();
    expect(parsed.background.steps).toHaveLength(2);
    expect(parsed.background.steps[0].kind).toBe('Given');
    expect(parsed.background.steps[0].text).toBe('the local stack is healthy');
  });

  test('extracts every scenario by name', () => {
    const parsed = parseGherkin(text);
    expect(parsed.scenarios.map((s) => s.name)).toEqual([
      'Alice signs in and reads her own profile',
      "Greta's admin claim uses the correct key",
      'Self-follow returns 400',
      'Manual-only step is recorded as skipped',
    ]);
  });

  test('extracts scenario tags', () => {
    const parsed = parseGherkin(text);
    expect(parsed.scenarios[0].tags).toEqual(['@blocker']);
    expect(parsed.scenarios[1].tags).toEqual(['@regression']);
    expect(parsed.scenarios[2].tags).toEqual([]);
    expect(parsed.scenarios[3].tags).toEqual(['@manual']);
  });

  test('extracts step kind + text', () => {
    const parsed = parseGherkin(text);
    const scenario = parsed.scenarios[0];
    expect(scenario.steps).toEqual([
      { kind: 'Given', text: 'Alice [P-02] is signed in' },
      { kind: 'When', text: 'Alice sends GET /api/users/50000010 with her ID token' },
      { kind: 'Then', text: 'the response status is 200' },
      { kind: 'Then', text: 'the response body has field "uniqueId" of type "number"' },
      { kind: 'Then', text: 'the response body contains "Alice"' },
    ]);
  });

  test('strips comments and blank lines', () => {
    const parsed = parseGherkin('# comment\n\nFeature: X\n\nScenario: Y\n  Given a\n');
    expect(parsed.featureName).toBe('X');
    expect(parsed.scenarios[0].steps).toHaveLength(1);
  });

  test('handles multiple tags on one line', () => {
    const parsed = parseGherkin('Feature: F\n@a @b @c\nScenario: S\n  Given x\n');
    expect(parsed.scenarios[0].tags).toEqual(['@a', '@b', '@c']);
  });

  test('feature-level tags vs scenario-level tags', () => {
    const parsed = parseGherkin(
      '@feature-tag\nFeature: F\n@scenario-tag\nScenario: S\n  Given x\n',
    );
    expect(parsed.featureTags).toEqual(['@feature-tag']);
    expect(parsed.scenarios[0].tags).toEqual(['@scenario-tag']);
  });
});

// ── classifySeverity ───────────────────────────────────────────────

describe('classifySeverity', () => {
  test('@blocker → Blocker', () => {
    expect(classifySeverity(['@blocker'])).toBe('Blocker');
  });
  test('@regression → Blocker (regression scenarios protect known fixes)', () => {
    expect(classifySeverity(['@regression', 'j12-bug-x'])).toBe('Blocker');
  });
  test('@minor → Minor', () => {
    expect(classifySeverity(['@minor'])).toBe('Minor');
  });
  test('no severity tag → Major (default)', () => {
    expect(classifySeverity(['@cohort', '@android'])).toBe('Major');
  });
  test('first matching tag wins', () => {
    expect(classifySeverity(['@polish', '@blocker'])).toBe('Blocker');
  });
});

// ── decodeJwtPayload ───────────────────────────────────────────────

describe('decodeJwtPayload', () => {
  test('decodes a base64url JWT payload', () => {
    // header.payload.signature; payload = {"uniqueId":42,"admin":true}
    const payload = Buffer.from(JSON.stringify({ uniqueId: 42, admin: true })).toString(
      'base64url',
    );
    const jwt = `aaa.${payload}.bbb`;
    expect(decodeJwtPayload(jwt)).toEqual({ uniqueId: 42, admin: true });
  });
  test('returns empty object for malformed input', () => {
    expect(decodeJwtPayload('not-a-jwt')).toEqual({});
  });
});

// ── pickField ──────────────────────────────────────────────────────

describe('pickField', () => {
  test('returns top-level field', () => {
    expect(pickField({ uniqueId: 5 }, 'uniqueId')).toBe(5);
  });
  test('falls through to body.user', () => {
    expect(pickField({ user: { uniqueId: 5 } }, 'uniqueId')).toBe(5);
  });
  test('top-level wins over nested', () => {
    expect(pickField({ uniqueId: 1, user: { uniqueId: 999 } }, 'uniqueId')).toBe(1);
  });
  test('returns undefined for missing', () => {
    expect(pickField({}, 'uniqueId')).toBeUndefined();
  });
});

// ── parseLiteral ───────────────────────────────────────────────────

describe('parseLiteral', () => {
  test('booleans', () => {
    expect(parseLiteral('true')).toBe(true);
    expect(parseLiteral('false')).toBe(false);
  });
  test('null', () => {
    expect(parseLiteral('null')).toBeNull();
  });
  test('integers', () => {
    expect(parseLiteral('42')).toBe(42);
    expect(parseLiteral('-7')).toBe(-7);
  });
  test('floats', () => {
    expect(parseLiteral('3.14')).toBe(3.14);
  });
  test('quoted strings', () => {
    expect(parseLiteral('"hello"')).toBe('hello');
  });
  test('bare strings', () => {
    expect(parseLiteral('bareword')).toBe('bareword');
  });
});

// ── parseJsonishPredicate ──────────────────────────────────────────

describe('parseJsonishPredicate', () => {
  test('empty input returns empty object', () => {
    expect(parseJsonishPredicate('')).toEqual({});
  });

  test('single key:value pair', () => {
    expect(parseJsonishPredicate('action: "blocked"')).toEqual({ action: 'blocked' });
  });

  test('multiple pairs, mixed types', () => {
    expect(
      parseJsonishPredicate(
        'action: "blocked", sourceId: 50000040, targetId: 60000010, reason: "cohort_mismatch"',
      ),
    ).toEqual({
      action: 'blocked',
      sourceId: 50000040,
      targetId: 60000010,
      reason: 'cohort_mismatch',
    });
  });

  test('quoted-string value containing a comma is NOT split mid-string', () => {
    expect(
      parseJsonishPredicate('senderId: 50000010, body: "hi adam, welcome to shytalk"'),
    ).toEqual({
      senderId: 50000010,
      body: 'hi adam, welcome to shytalk',
    });
  });

  test('boolean and null literals', () => {
    expect(parseJsonishPredicate('frozen: true, deleted: false, parent: null')).toEqual({
      frozen: true,
      deleted: false,
      parent: null,
    });
  });

  test('unresolved placeholder throws actionable error', () => {
    expect(() => parseJsonishPredicate('targetId: {newUniqueId}')).toThrow(
      /placeholder.*newUniqueId/i,
    );
  });

  test('malformed pair (missing colon) throws', () => {
    expect(() => parseJsonishPredicate('not_a_pair')).toThrow(/no colon/i);
  });

  test('handles trailing whitespace', () => {
    expect(parseJsonishPredicate('a: 1  ,  b: 2  ')).toEqual({ a: 1, b: 2 });
  });

  test('quoted string with internal colon does not split key', () => {
    expect(parseJsonishPredicate('url: "https://example.com:8080/x"')).toEqual({
      url: 'https://example.com:8080/x',
    });
  });
});

// ── executeStep — stubbed fetch ────────────────────────────────────

function makeCtx(overrides = {}) {
  return {
    apiBase: 'https://dev-api.example',
    firebaseApiKey: 'fake-key',
    personasPassword: 'fake-pw-not-real-just-stub-fixture',
    sessions: new Map(),
    lastResponse: null,
    locale: 'en',
    fetch: jest.fn(),
    ...overrides,
  };
}

describe('executeStep', () => {
  test('matches "the local stack is healthy"', async () => {
    const ctx = makeCtx({
      fetch: jest.fn(async () => ({ status: 200, json: async () => ({}) })),
    });
    const r = await executeStep({ kind: 'Given', text: 'the local stack is healthy' }, ctx);
    expect(r.ok).toBe(true);
    expect(ctx.fetch).toHaveBeenCalledWith('https://dev-api.example/api/health');
  });

  test('matches "the device locale is X"', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Given', text: 'the device locale is "ar"' }, ctx);
    expect(r.ok).toBe(true);
    expect(ctx.locale).toBe('ar');
  });

  test('unrecognised verb → STEP_NOT_IMPLEMENTED', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Alice does something completely unknown' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.code).toBe('STEP_NOT_IMPLEMENTED');
  });

  test('persona sign-in stores session', async () => {
    const idToken =
      'aaa.' +
      Buffer.from(JSON.stringify({ uniqueId: 50000010, admin: false })).toString('base64url') +
      '.bbb';
    const ctx = makeCtx({
      fetch: jest.fn(async () => ({
        status: 200,
        json: async () => ({ idToken, refreshToken: 'rt-x', localId: 'fb-uid-1' }),
      })),
    });
    const r = await executeStep({ kind: 'Given', text: 'Alice [P-02] is signed in' }, ctx);
    expect(r.ok).toBe(true);
    expect(ctx.sessions.get('Alice')).toMatchObject({ idToken, refreshToken: 'rt-x' });
    expect(ctx.sessions.get('Alice').customClaims.uniqueId).toBe(50000010);
  });

  test('API request stores lastResponse with parsed body', async () => {
    const idToken =
      'aaa.' + Buffer.from(JSON.stringify({ uniqueId: 50000010 })).toString('base64url') + '.bbb';
    const ctx = makeCtx({
      fetch: jest.fn(async (url) => {
        if (url.includes('signInWithPassword')) {
          return {
            status: 200,
            json: async () => ({ idToken, refreshToken: 'rt', localId: 'fb' }),
          };
        }
        return {
          status: 200,
          text: async () => JSON.stringify({ uniqueId: 50000010, displayName: 'Alice' }),
        };
      }),
    });
    await executeStep({ kind: 'Given', text: 'Alice [P-02] is signed in' }, ctx);
    const r = await executeStep(
      { kind: 'When', text: 'Alice sends GET /api/users/50000010 with her ID token' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.lastResponse.status).toBe(200);
    expect(ctx.lastResponse.body.uniqueId).toBe(50000010);
  });

  test('response-status assertion finds mismatch', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = { status: 200, body: {} };
    const r = await executeStep({ kind: 'Then', text: 'the response status is 404' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('200');
    expect(r.error).toContain('404');
  });

  test('response-field-of-type passes on match', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = { status: 200, body: { uniqueId: 42 } };
    const r = await executeStep(
      { kind: 'Then', text: 'the response body has field "uniqueId" of type "number"' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('response-field-of-type fails on wrong type', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = { status: 200, body: { uniqueId: '42' } };
    const r = await executeStep(
      { kind: 'Then', text: 'the response body has field "uniqueId" of type "number"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain('string');
    expect(r.error).toContain('number');
  });

  test('claims-include assertion (boolean true)', async () => {
    const ctx = makeCtx();
    ctx.sessions.set('Greta', { customClaims: { admin: true, uniqueId: 90000001 } });
    const r = await executeStep(
      { kind: 'Then', text: 'Greta\'s Firebase Auth custom claims include "admin" equal to true' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('claims-include catches drift', async () => {
    const ctx = makeCtx();
    // Simulate the bug we caught in cycle 1: claim written as isAdmin, not admin.
    ctx.sessions.set('Greta', { customClaims: { isAdmin: true, uniqueId: 90000001 } });
    const r = await executeStep(
      { kind: 'Then', text: 'Greta\'s Firebase Auth custom claims include "admin" equal to true' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain('claim "admin"');
  });

  test('claims-not-include catches stale key', async () => {
    const ctx = makeCtx();
    ctx.sessions.set('Greta', { customClaims: { admin: true, isAdmin: true } });
    const r = await executeStep(
      { kind: 'Then', text: 'Greta\'s Firebase Auth custom claims do not include "isAdmin"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain('unexpectedly present');
  });
});

// ── runScenario + runFeatureFile end-to-end ────────────────────────

describe('runFeatureFile end-to-end (stubbed fetch)', () => {
  function makeFakeFetch(state = {}) {
    return jest.fn(async (url, init = {}) => {
      // 1. Firebase sign-in
      if (typeof url === 'string' && url.includes('signInWithPassword')) {
        const claims = state.claims || { uniqueId: 50000010, admin: false };
        const idToken = 'h.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.s';
        return {
          status: 200,
          json: async () => ({ idToken, refreshToken: 'rt', localId: 'fb-1' }),
        };
      }
      // 2. /api/health
      if (typeof url === 'string' && url.endsWith('/api/health')) {
        return { status: 200, json: async () => ({ ok: true }) };
      }
      // 3. GET /api/users/<id> — succeeds
      if (
        typeof url === 'string' &&
        url.match(/\/api\/users\/\d+$/) &&
        (init.method || 'GET') === 'GET'
      ) {
        return {
          status: 200,
          text: async () =>
            JSON.stringify({ uniqueId: 50000010, displayName: 'Alice (P-02 adult power)' }),
        };
      }
      // 4. POST follow — 400 for self
      if (typeof url === 'string' && url.includes('/follow')) {
        return {
          status: 400,
          text: async () => JSON.stringify({ error: 'Cannot follow yourself' }),
        };
      }
      return { status: 500, text: async () => '{}' };
    });
  }

  test('happy path — Alice scenario passes (no findings)', async () => {
    const ctx = makeCtx({
      apiBase: 'https://dev-api.example',
      fetch: makeFakeFetch({ claims: { uniqueId: 50000010, admin: false } }),
    });
    const { findings, scenarioReports } = await runFeatureFile(
      path.join(FIXTURE_DIR, 'sample-auth.feature'),
      ctx,
    );
    const alicePass = scenarioReports.find(
      (s) => s.scenario === 'Alice signs in and reads her own profile',
    );
    expect(alicePass.status).toBe('pass');
    const selfFollowPass = scenarioReports.find((s) => s.scenario === 'Self-follow returns 400');
    expect(selfFollowPass.status).toBe('pass');
    // No findings on the happy-path scenarios (skipped @manual one is fine)
    const happyFindings = findings.filter(
      (f) =>
        f.scenario === 'Alice signs in and reads her own profile' ||
        f.scenario === 'Self-follow returns 400',
    );
    expect(happyFindings).toEqual([]);
  });

  test('Greta claim-key regression catches drift', async () => {
    // Inject the bug: claim is `isAdmin: true` not `admin: true`
    const ctx = makeCtx({
      fetch: makeFakeFetch({ claims: { uniqueId: 90000001, isAdmin: true } }),
    });
    const { findings, scenarioReports } = await runFeatureFile(
      path.join(FIXTURE_DIR, 'sample-auth.feature'),
      ctx,
    );
    const greta = scenarioReports.find(
      (s) => s.scenario === "Greta's admin claim uses the correct key",
    );
    expect(greta.status).toBe('fail');
    const gretaFinding = findings.find(
      (f) => f.scenario === "Greta's admin claim uses the correct key",
    );
    expect(gretaFinding.severity).toBe('Blocker'); // @regression tag
    expect(gretaFinding.error).toContain('admin');
  });

  test('@manual scenario is skipped, not failed', async () => {
    const ctx = makeCtx({ fetch: makeFakeFetch() });
    const result = await runFeatureFile(path.join(FIXTURE_DIR, 'sample-auth.feature'), ctx);
    const manualScenario = result.scenarioReports.find(
      (s) => s.scenario === 'Manual-only step is recorded as skipped',
    );
    expect(manualScenario.status).toBe('skipped');
    expect(result.findings.find((f) => f.scenario === manualScenario.scenario)).toBeUndefined();
  });

  test('unimplemented verb fails with Minor severity + STEP_NOT_IMPLEMENTED code', async () => {
    const ctx = makeCtx({ fetch: makeFakeFetch() });
    const { findings } = await runFeatureFile(
      path.join(FIXTURE_DIR, 'sample-failures.feature'),
      ctx,
    );
    const teleport = findings.find((f) => f.error.includes('teleports'));
    expect(teleport).toBeDefined();
    expect(teleport.severity).toBe('Minor');
    expect(teleport.code).toBe('STEP_NOT_IMPLEMENTED');
  });

  test('wrong status assertion fails the scenario', async () => {
    const ctx = makeCtx({ fetch: makeFakeFetch() });
    const { findings } = await runFeatureFile(
      path.join(FIXTURE_DIR, 'sample-failures.feature'),
      ctx,
    );
    const wrongStatus = findings.find(
      (f) => f.scenario === 'Wrong status assertion produces a finding',
    );
    expect(wrongStatus).toBeDefined();
    expect(wrongStatus.error).toContain('200');
    expect(wrongStatus.error).toContain('999');
  });
});

// ── Firestore-read matchers (v2) — stubbed db ──────────────────────

function makeFakeDb(docs = {}) {
  return {
    doc: (docPath) => ({
      get: async () => {
        const data = docs[docPath];
        return {
          exists: data !== undefined,
          data: () => data,
        };
      },
    }),
  };
}

describe('Firestore doc-field equal-to matcher', () => {
  test('passes when string field matches', async () => {
    const ctx = makeCtx({
      db: makeFakeDb({ 'users/50000010': { cohort: 'adult', uniqueId: 50000010 } }),
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000010" with field "cohort" equal to "adult"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('passes when numeric field matches', async () => {
    const ctx = makeCtx({
      db: makeFakeDb({ 'users/50000010': { cohort: 'adult', uniqueId: 50000010 } }),
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000010" with field "uniqueId" equal to 50000010',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('fails when string field drifts', async () => {
    const ctx = makeCtx({
      db: makeFakeDb({ 'users/50000010': { cohort: 'minor' } }),
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000010" with field "cohort" equal to "adult"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain('cohort');
    expect(r.error).toContain('minor');
    expect(r.error).toContain('adult');
  });

  test('fails loudly when doc is missing — does NOT silently pass', async () => {
    const ctx = makeCtx({ db: makeFakeDb({}) });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/99999999" with field "cohort" equal to "adult"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/does not exist|missing|not found/i);
  });

  test('fails with explicit error when ctx.db is not initialized', async () => {
    const ctx = makeCtx(); // no db
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/1" with field "cohort" equal to "adult"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db|firestore|admin/i);
  });

  test('handles boolean literal', async () => {
    const ctx = makeCtx({
      db: makeFakeDb({ 'users/50000010': { isAgeVerified: true } }),
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000010" with field "isAgeVerified" equal to true',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });
});

describe('Firestore doc-field containing matcher (array membership)', () => {
  test('passes when array contains the numeric element', async () => {
    const ctx = makeCtx({
      db: makeFakeDb({
        'users/50000010': { followingIds: [50000020, 50000060, 50000040] },
      }),
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000010" with field "followingIds" containing 50000060',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('passes when array contains the string element', async () => {
    const ctx = makeCtx({
      db: makeFakeDb({
        'rooms/r1': { participantIds: ['fb-uid-a', 'fb-uid-b'] },
      }),
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "rooms/r1" with field "participantIds" containing "fb-uid-b"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('fails when element is absent', async () => {
    const ctx = makeCtx({
      db: makeFakeDb({ 'users/50000010': { followingIds: [50000020, 50000040] } }),
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000010" with field "followingIds" containing 60000010',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain('followingIds');
    expect(r.error).toContain('60000010');
  });

  test('fails when field is not an array', async () => {
    const ctx = makeCtx({
      db: makeFakeDb({ 'users/50000010': { followingIds: 'not-an-array' } }),
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000010" with field "followingIds" containing 60000010',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/array|not.*array|type/i);
  });

  test('fails loudly when doc is missing', async () => {
    const ctx = makeCtx({ db: makeFakeDb({}) });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/99999999" with field "followingIds" containing 1',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/does not exist|missing|not found/i);
  });
});

describe('Firestore matchers end-to-end via runFeatureFile', () => {
  function makeFetchAndDb(docs) {
    return {
      fetch: jest.fn(async (url) => {
        if (typeof url === 'string' && url.includes('signInWithPassword')) {
          const idToken =
            'h.' +
            Buffer.from(JSON.stringify({ uniqueId: 50000010, admin: false })).toString(
              'base64url',
            ) +
            '.s';
          return {
            status: 200,
            json: async () => ({ idToken, refreshToken: 'rt', localId: 'fb-1' }),
          };
        }
        if (typeof url === 'string' && url.endsWith('/api/health')) {
          return { status: 200, json: async () => ({ ok: true }) };
        }
        return { status: 500, text: async () => '{}' };
      }),
      db: makeFakeDb(docs),
    };
  }

  test('happy-path scenario with correct doc data passes', async () => {
    const ctx = makeCtx(
      makeFetchAndDb({
        'users/50000010': {
          cohort: 'adult',
          uniqueId: 50000010,
          followingIds: [50000020, 50000060],
        },
      }),
    );
    const { findings, scenarioReports } = await runFeatureFile(
      path.join(FIXTURE_DIR, 'sample-firestore-reads.feature'),
      ctx,
    );
    const happyReport = scenarioReports.find(
      (s) => s.scenario === 'doc-field equality assertion passes when field matches',
    );
    expect(happyReport.status).toBe('pass');
    const happyFindings = findings.filter((f) => f.scenario === happyReport.scenario);
    expect(happyFindings).toEqual([]);
  });

  test('drifted-field scenario produces a Blocker finding (regression-grade)', async () => {
    const ctx = makeCtx(
      makeFetchAndDb({
        'users/50000010': {
          cohort: 'adult',
          uniqueId: 50000010,
          followingIds: [50000020, 50000060],
        },
      }),
    );
    const { findings } = await runFeatureFile(
      path.join(FIXTURE_DIR, 'sample-firestore-reads.feature'),
      ctx,
    );
    const drift = findings.find(
      (f) => f.scenario === 'doc-field equality assertion fails when field drifts',
    );
    expect(drift).toBeDefined();
    expect(drift.severity).toBe('Blocker');
    expect(drift.error).toMatch(/cohort/);
  });

  test('missing-doc scenario surfaces a finding (no silent pass)', async () => {
    const ctx = makeCtx(makeFetchAndDb({ 'users/50000010': { cohort: 'adult' } }));
    const { findings } = await runFeatureFile(
      path.join(FIXTURE_DIR, 'sample-firestore-reads.feature'),
      ctx,
    );
    const missing = findings.find(
      (f) => f.scenario === 'missing doc is a finding (not a silent pass)',
    );
    expect(missing).toBeDefined();
  });

  test('array-containing happy and unhappy paths both classified correctly', async () => {
    const ctx = makeCtx(
      makeFetchAndDb({
        'users/50000010': {
          cohort: 'adult',
          followingIds: [50000020, 50000060],
        },
      }),
    );
    const { findings, scenarioReports } = await runFeatureFile(
      path.join(FIXTURE_DIR, 'sample-firestore-reads.feature'),
      ctx,
    );
    const happyArray = scenarioReports.find(
      (s) => s.scenario === 'array-field containing assertion passes when element is present',
    );
    expect(happyArray.status).toBe('pass');
    const unhappyArray = findings.find(
      (f) => f.scenario === 'array-field containing assertion fails when element is absent',
    );
    expect(unhappyArray).toBeDefined();
    expect(unhappyArray.severity).toBe('Blocker'); // @regression
  });
});

// ── Firestore bulk-query matcher (v2) — stubbed db ────────────────

// Fake Firestore: extend to support .collection(path).get() returning docs.
function makeFakeDbWithCollections(collections = {}, docs = {}) {
  return {
    doc: (docPath) => ({
      get: async () => {
        const data = docs[docPath];
        return { exists: data !== undefined, data: () => data };
      },
    }),
    collection: (colPath) => ({
      get: async () => ({
        docs: (collections[colPath] || []).map((d, i) => ({
          id: d._id || `auto-${i}`,
          data: () => d,
        })),
      }),
    }),
  };
}

describe('Firestore bulk-query matcher (entries-matching)', () => {
  test('passes when actual count equals expected', async () => {
    const ctx = makeCtx({
      db: makeFakeDbWithCollections({
        auditLog: [
          { action: 'blocked', sourceId: 50000010, targetId: 60000010, reason: 'cohort_mismatch' },
          { action: 'blocked', sourceId: 50000040, targetId: 60000010, reason: 'cohort_mismatch' },
        ],
      }),
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has 1 entries in "auditLog" matching {action: "blocked", sourceId: 50000010, targetId: 60000010, reason: "cohort_mismatch"}',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('passes when expected count is zero and predicate filters everything out', async () => {
    const ctx = makeCtx({
      db: makeFakeDbWithCollections({
        auditLog: [{ action: 'blocked' }, { action: 'blocked' }],
      }),
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has 0 entries in "auditLog" matching {action: "device.ban"}',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('fails when count drifts', async () => {
    const ctx = makeCtx({
      db: makeFakeDbWithCollections({
        auditLog: [{ action: 'blocked' }, { action: 'blocked' }],
      }),
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has 5 entries in "auditLog" matching {action: "blocked"}',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain('2');
    expect(r.error).toContain('5');
  });

  test('predicate filters by ALL keys (AND semantics)', async () => {
    const ctx = makeCtx({
      db: makeFakeDbWithCollections({
        auditLog: [
          { action: 'blocked', sourceId: 1 },
          { action: 'blocked', sourceId: 2 },
          { action: 'other', sourceId: 1 },
        ],
      }),
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has 1 entries in "auditLog" matching {action: "blocked", sourceId: 1}',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('empty predicate counts every doc in the collection', async () => {
    const ctx = makeCtx({
      db: makeFakeDbWithCollections({
        auditLog: [{ a: 1 }, { b: 2 }, { c: 3 }],
      }),
    });
    const r = await executeStep(
      { kind: 'Then', text: 'the database has 3 entries in "auditLog" matching {}' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('subcollection path with slashes works', async () => {
    const ctx = makeCtx({
      db: makeFakeDbWithCollections({
        'users/50000010/gifts': [{ giftId: 'rose' }, { giftId: 'rose' }, { giftId: 'crown' }],
      }),
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has 2 entries in "users/50000010/gifts" matching {giftId: "rose"}',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('fails with explicit error when ctx.db is missing', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has 1 entries in "auditLog" matching {action: "blocked"}',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db|firestore|admin/i);
  });

  test('numeric and string predicate values both supported', async () => {
    const ctx = makeCtx({
      db: makeFakeDbWithCollections({
        auditLog: [
          { action: 'blocked', sourceId: 50000010 },
          { action: 'blocked', sourceId: '50000010' }, // wrong type — should NOT match
        ],
      }),
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has 1 entries in "auditLog" matching {sourceId: 50000010}',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('predicate with placeholder {var} reports an actionable error', async () => {
    const ctx = makeCtx({
      db: makeFakeDbWithCollections({ auditLog: [] }),
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has 1 entries in "auditLog" matching {targetId: 50000010, sourceId: {newUniqueId}}',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/placeholder|unresolved|newUniqueId/i);
  });
});

describe('Firestore bulk-query end-to-end via runFeatureFile', () => {
  function fetchOk() {
    return jest.fn(async (url) => {
      if (typeof url === 'string' && url.includes('signInWithPassword')) {
        const idToken =
          'h.' +
          Buffer.from(JSON.stringify({ uniqueId: 50000010, admin: false })).toString('base64url') +
          '.s';
        return {
          status: 200,
          json: async () => ({ idToken, refreshToken: 'rt', localId: 'fb-1' }),
        };
      }
      if (typeof url === 'string' && url.endsWith('/api/health')) {
        return { status: 200, json: async () => ({ ok: true }) };
      }
      return { status: 500, text: async () => '{}' };
    });
  }

  test('happy collection state — positive, zero, and subcollection scenarios all pass', async () => {
    const ctx = makeCtx({
      fetch: fetchOk(),
      db: makeFakeDbWithCollections({
        auditLog: [
          { action: 'blocked', sourceId: 50000010, targetId: 60000010, reason: 'cohort_mismatch' },
          { action: 'age_verification.approve', targetId: 50000010, adminId: 90000001 },
          { action: 'something_else' },
        ],
        'users/50000010/gifts': [{ giftId: 'rose' }, { giftId: 'rose' }, { giftId: 'crown' }],
      }),
    });
    const { findings, scenarioReports } = await runFeatureFile(
      path.join(FIXTURE_DIR, 'sample-firestore-queries.feature'),
      ctx,
    );
    const positive = scenarioReports.find(
      (s) => s.scenario === 'count matching the expected positive value passes',
    );
    expect(positive.status).toBe('pass');
    const zero = scenarioReports.find(
      (s) => s.scenario === 'count matching zero passes when collection has no matches',
    );
    expect(zero.status).toBe('pass');
    const sub = scenarioReports.find(
      (s) => s.scenario === 'subcollection path works (slash-separated)',
    );
    expect(sub.status).toBe('pass');
    // The drift scenario expects 5 but the seeded collection only has 1 'blocked' entry.
    const drift = findings.find((f) => f.scenario === 'count drift produces a finding');
    expect(drift).toBeDefined();
    expect(drift.severity).toBe('Blocker');
  });
});
