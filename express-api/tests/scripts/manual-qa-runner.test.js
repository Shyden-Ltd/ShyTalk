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
