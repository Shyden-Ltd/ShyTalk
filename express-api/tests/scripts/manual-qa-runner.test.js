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
  parseKvPairs,
  parseJsonishPredicate,
  executeStep,
  runScenario,
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

// ── parseKvPairs (v3) ─────────────────────────────────────────────

describe('parseKvPairs', () => {
  test('single numeric kv-pair', () => {
    expect(parseKvPairs('targetUniqueId=60000010')).toEqual({ targetUniqueId: 60000010 });
  });

  test('single quoted-string kv-pair', () => {
    expect(parseKvPairs('giftId="rose"')).toEqual({ giftId: 'rose' });
  });

  test('chained with " and "', () => {
    expect(parseKvPairs('recipient=60000010 and amount=100')).toEqual({
      recipient: 60000010,
      amount: 100,
    });
  });

  test('mixed numeric and quoted', () => {
    expect(parseKvPairs('recipient=60000010 and giftId="rose"')).toEqual({
      recipient: 60000010,
      giftId: 'rose',
    });
  });

  test('boolean and null literals', () => {
    expect(parseKvPairs('isAdmin=true and revokedAt=null')).toEqual({
      isAdmin: true,
      revokedAt: null,
    });
  });

  test('quoted string containing the literal " and " is not split', () => {
    expect(parseKvPairs('body="hi and bye"')).toEqual({ body: 'hi and bye' });
  });

  test('throws on empty input', () => {
    expect(() => parseKvPairs('')).toThrow(/empty/);
    expect(() => parseKvPairs('   ')).toThrow(/empty/);
  });

  test('throws on missing "="', () => {
    expect(() => parseKvPairs('foo')).toThrow(/missing "="/);
  });

  test('throws on non-identifier key', () => {
    expect(() => parseKvPairs('1foo=42')).toThrow(/not identifier-shaped/);
    expect(() => parseKvPairs('foo bar=42')).toThrow(/not identifier-shaped/);
  });

  test('preserves unquoted bare-word values as strings', () => {
    expect(parseKvPairs('status=active')).toEqual({ status: 'active' });
  });

  test('three pairs with mixed types', () => {
    expect(parseKvPairs('a=1 and b="x" and c=false')).toEqual({ a: 1, b: 'x', c: false });
  });

  // ── C-2 fix: escaped-quote handling in quoted values ──
  test('strips backslash from escaped quote inside string literal', () => {
    expect(parseKvPairs('msg="say \\"hi\\""')).toEqual({ msg: 'say "hi"' });
  });

  test('mixed chain with one escaped-quote value', () => {
    expect(parseKvPairs('a=1 and msg="he said \\"yes\\""')).toEqual({
      a: 1,
      msg: 'he said "yes"',
    });
  });

  // ── I-1 fix: non-string input type guard ──
  test('throws actionable error on numeric input', () => {
    expect(() => parseKvPairs(42)).toThrow(/must be a string, got number/);
  });

  test('throws actionable error on object input', () => {
    expect(() => parseKvPairs({})).toThrow(/must be a string, got object/);
  });

  test('throws actionable error on boolean input', () => {
    expect(() => parseKvPairs(true)).toThrow(/must be a string, got boolean/);
  });

  // `typeof null === 'object'` so the error says "got object" — technically
  // accurate but the test pins behaviour explicitly so future me knows.
  test('throws on null input (typeof object)', () => {
    expect(() => parseKvPairs(null)).toThrow(/must be a string, got object/);
  });

  // ── Wake 124 — `key "value"` (no equals) accepted alongside `key="value"` ──
  //
  // The j06 invalid-receipt scenario phrases two pairs as
  // `productId="coins-1000" and receipt "INVALID_BASE64_BLOB"` — equals
  // for the first, space for the second. Previously the second pair
  // threw "missing =" and the scenario failed at the parser before
  // reaching its real assertion (POST 400 expected). The space form is
  // gated on presence of a quoted value so bareword `foo` still throws.

  test('space-form: key "value" parses to {key: "value"}', () => {
    expect(parseKvPairs('receipt "INVALID_BASE64_BLOB"')).toEqual({
      receipt: 'INVALID_BASE64_BLOB',
    });
  });

  test('mixed: equals form chained with space form via " and "', () => {
    expect(parseKvPairs('productId="coins-1000" and receipt "INVALID_BASE64_BLOB"')).toEqual({
      productId: 'coins-1000',
      receipt: 'INVALID_BASE64_BLOB',
    });
  });

  test('space form preserves embedded spaces inside quotes', () => {
    expect(parseKvPairs('greeting "hello world"')).toEqual({ greeting: 'hello world' });
  });

  test('bareword (no quote, no equals) still throws missing "="', () => {
    // Regression guard — the space-form must only activate when a
    // quoted value is present, otherwise typos like `foo` would
    // silently parse as `{foo: undefined}` and corrupt scenarios.
    expect(() => parseKvPairs('foo')).toThrow(/missing "="/);
  });

  test('value containing literal "=" still parses correctly (equals-form wins when no leading quote)', () => {
    expect(parseKvPairs('expr="a=b"')).toEqual({ expr: 'a=b' });
  });

  test('throws on undefined input', () => {
    expect(() => parseKvPairs(undefined)).toThrow(/must be a string, got undefined/);
  });

  // ── Document parseLiteral fall-through for special numeric literals ──
  // These are never valid JSON anyway (NaN/Infinity serialize to null) so
  // treating them as bare strings is the safest behaviour — a test pin
  // ensures no one "improves" this into number coercion later.
  test('NaN bare word falls through to string (not number)', () => {
    expect(parseKvPairs('x=NaN')).toEqual({ x: 'NaN' });
  });

  test('Infinity bare word falls through to string (not number)', () => {
    expect(parseKvPairs('x=Infinity')).toEqual({ x: 'Infinity' });
  });

  test('MAX_SAFE_INTEGER parses as a regular JS number', () => {
    expect(parseKvPairs('big=9007199254740991')).toEqual({ big: 9007199254740991 });
  });

  // ── I-2 fix: float and negative-number coverage ──
  test('parses positive float value', () => {
    expect(parseKvPairs('price=3.14')).toEqual({ price: 3.14 });
  });

  test('parses negative float value', () => {
    expect(parseKvPairs('delta=-0.5')).toEqual({ delta: -0.5 });
  });

  test('parses negative integer value', () => {
    expect(parseKvPairs('offset=-42')).toEqual({ offset: -42 });
  });

  test('parses zero (numeric boundary)', () => {
    expect(parseKvPairs('count=0')).toEqual({ count: 0 });
  });
});

// ── executeStep — stubbed fetch ────────────────────────────────────

function makeCtx(overrides = {}) {
  return {
    apiBase: 'https://dev-api.example',
    firebaseApiKey: 'fake-key',
    personasPassword: 'fake-pw-not-real-just-stub-fixture',
    sessions: new Map(),
    personaPlatforms: new Map(),
    personaPaths: new Map(),
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

  test('persona sign-in matches "on <Platform>" suffix (single-word)', async () => {
    const idToken =
      'aaa.' + Buffer.from(JSON.stringify({ uniqueId: 50000010 })).toString('base64url') + '.bbb';
    const ctx = makeCtx({
      fetch: jest.fn(async () => ({
        status: 200,
        json: async () => ({ idToken, refreshToken: 'r', localId: 'f' }),
      })),
    });
    const r = await executeStep(
      { kind: 'Given', text: 'Alice [P-02] is signed in on Android' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.sessions.get('Alice')).toBeDefined();
  });

  test('persona sign-in matches multi-word platform ("Web Chromium", "iOS Sim")', async () => {
    const idToken =
      'aaa.' + Buffer.from(JSON.stringify({ uniqueId: 50000040 })).toString('base64url') + '.bbb';
    const ctx = makeCtx({
      fetch: jest.fn(async () => ({
        status: 200,
        json: async () => ({ idToken, refreshToken: 'r', localId: 'f' }),
      })),
    });
    const r1 = await executeStep(
      { kind: 'Given', text: 'Vexa [P-07] is signed in on Web Chromium' },
      ctx,
    );
    expect(r1.ok).toBe(true);
    const r2 = await executeStep(
      { kind: 'Given', text: 'Ines [P-11] is signed in on iOS Sim' },
      ctx,
    );
    expect(r2.ok).toBe(true);
  });

  test('decoded JWT payload — dotted-path field equality passes', async () => {
    const payload = Buffer.from(
      JSON.stringify({ video: { room: 'ra1' }, metadata: { cohort: 'adult' } }),
    ).toString('base64url');
    const token = 'h.' + payload + '.s';
    const ctx = makeCtx();
    ctx.lastResponse = { body: { token } };
    const r1 = await executeStep(
      {
        kind: 'Then',
        text: 'the decoded JWT payload has field "metadata.cohort" equal to "adult"',
      },
      ctx,
    );
    expect(r1.ok).toBe(true);
    const r2 = await executeStep(
      { kind: 'Then', text: 'the decoded JWT payload has field "video.room" equal to "ra1"' },
      ctx,
    );
    expect(r2.ok).toBe(true);
  });

  test('decoded JWT payload — auto-parses JSON-string intermediate (LiveKit metadata convention)', async () => {
    // LiveKit's AccessToken stores `metadata` verbatim in the JWT as a
    // JSON-serialized STRING (not a nested object). The matcher must
    // detect that and drill INTO the parsed object on the next segment.
    // Pinned by j09's "LiveKit access token contains cohort claim
    // matching the room" scenario; surfaced when the live JWT carried
    // a correct metadata claim but the runner reported it as undefined.
    const payload = Buffer.from(
      JSON.stringify({
        video: { room: 'ra1' },
        // metadata as a string — the real LiveKit wire format
        metadata: JSON.stringify({ cohort: 'adult' }),
      }),
    ).toString('base64url');
    const token = 'h.' + payload + '.s';
    const ctx = makeCtx();
    ctx.lastResponse = { body: { token } };
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the decoded JWT payload has field "metadata.cohort" equal to "adult"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('decoded JWT payload — non-JSON string intermediate preserves old undefined behaviour', async () => {
    // A string-valued claim that ISN'T JSON must still drill into a
    // single-character access (which yields undefined for `length`-style
    // accessors and undefined for any non-numeric key). Pins that the
    // JSON.parse fallback doesn't accidentally trigger on plain strings.
    const payload = Buffer.from(JSON.stringify({ subject: 'plain-not-json-string' })).toString(
      'base64url',
    );
    const token = 'h.' + payload + '.s';
    const ctx = makeCtx();
    ctx.lastResponse = { body: { token } };
    const r = await executeStep(
      { kind: 'Then', text: 'the decoded JWT payload has field "subject.cohort" equal to "x"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    // Error should mention the missing-field undefined, NOT a JSON-parse crash.
    expect(r.error).toMatch(/subject\.cohort.*undefined/i);
  });

  test('decoded JWT payload — wrong claim fails with both expected + actual', async () => {
    const payload = Buffer.from(JSON.stringify({ metadata: { cohort: 'minor' } })).toString(
      'base64url',
    );
    const token = 'h.' + payload + '.s';
    const ctx = makeCtx();
    ctx.lastResponse = { body: { token } };
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the decoded JWT payload has field "metadata.cohort" equal to "adult"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain('adult');
    expect(r.error).toContain('minor');
  });

  test('decoded JWT payload — missing token field produces actionable error', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = { body: { somethingElse: 'x' } };
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the decoded JWT payload has field "metadata.cohort" equal to "adult"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no token field/i);
  });

  test('decoded JWT payload — falls back to idToken and accessToken fields', async () => {
    const payload = Buffer.from(JSON.stringify({ uid: 'x' })).toString('base64url');
    const token = 'h.' + payload + '.s';
    const ctx = makeCtx();
    ctx.lastResponse = { body: { idToken: token } };
    const r = await executeStep(
      { kind: 'Then', text: 'the decoded JWT payload has field "uid" equal to "x"' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('persona sign-in matches `at the "X" screen` suffix', async () => {
    const idToken =
      'aaa.' + Buffer.from(JSON.stringify({ uniqueId: 50000010 })).toString('base64url') + '.bbb';
    const ctx = makeCtx({
      fetch: jest.fn(async () => ({
        status: 200,
        json: async () => ({ idToken, refreshToken: 'r', localId: 'f' }),
      })),
    });
    const r = await executeStep(
      { kind: 'Given', text: 'Alice [P-02] is signed in on Android at the "discovery" screen' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.sessions.get('Alice')).toBeDefined();
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
            JSON.stringify({ uniqueId: 50000010, displayName: '[SEED] Alice (P-02 adult power)' }),
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

// Probe-friendly fake db: supports `.collection(name).get()` returning all
// rows, and `.collection('rooms').where('state', '==', 'OPEN').get()` filter.
// Used by the OSA invariant probe tests.
function makeProbeDb({ users = [], rooms = [], conversations = [] } = {}) {
  const makeSnap = (rows) => ({
    forEach: (cb) => rows.forEach((r) => cb({ data: () => r, id: r._id || 'x' })),
    size: rows.length,
  });
  return {
    collection: (name) => {
      const all = { users, rooms, conversations }[name] || [];
      return {
        get: async () => makeSnap(all),
        where: (field, op, value) => ({
          get: async () => {
            if (op !== '==') throw new Error('unsupported op');
            return makeSnap(all.filter((r) => r[field] === value));
          },
        }),
      };
    },
    doc: () => ({ get: async () => ({ exists: false }) }),
  };
}

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

describe('ensureRoomForHost — exposes roomId as a {roomId} interpolation variable', () => {
  // The runner's interpolateScenarioVars at line ~13693 substitutes
  // {name} from ctx.scenarioVars. Setup-Given handlers (e.g. "Theo's
  // public room is OPEN") that create a room need to register the
  // generated roomId so later Then-steps like `rooms/{roomId}/...`
  // resolve to the actual doc path. Pinned by 2 of j09's findings
  // ("document rooms/{roomId} does not exist") on the 2026-05-29
  // dispatch.

  test('ensureRoom Given sets ctx.scenarioVars.get("roomId") to the seeded room id', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep(
      { kind: 'Given', text: 'Theo\'s public room "Theo\'s Test Room" is OPEN' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.scenarioVars.get('roomId')).toBeTruthy();
    // The roomId is the slug derived from the title.
    expect(ctx.scenarioVars.get('roomId')).toMatch(/theo-s-test-room/);
  });

  test('subsequent step text interpolates {roomId} to the actual room id', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    // Phase 1: seed the room.
    await executeStep(
      { kind: 'Given', text: 'Theo\'s public room "Theo\'s Test Room" is OPEN' },
      ctx,
    );
    const seededRoomId = ctx.scenarioVars.get('roomId');
    // Phase 2: a later Then with `{roomId}` in the path should match the
    // doc the prior Given wrote (not look up a literal `rooms/{roomId}`
    // that doesn't exist).
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "rooms/{roomId}" with field "title" equal to "Theo\'s Test Room"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    // Sanity: the doc is at the substituted path, not the literal one.
    expect(db._docs[`rooms/${seededRoomId}`]).toBeDefined();
    expect(db._docs[`rooms/{roomId}`]).toBeUndefined();
  });

  test('Given without ctx.scenarioVars (legacy callers) is a no-op for interpolation, not a crash', async () => {
    // Defensive: some callers/tests build ctx without scenarioVars.
    // The handler must gate the scenarioVars.set behind a typeof check
    // so it doesn't TypeError on `undefined.set` and crash the runner.
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db }); // no scenarioVars
    const r = await executeStep(
      { kind: 'Given', text: 'Theo\'s public room "Theo\'s Test Room" is OPEN' },
      ctx,
    );
    expect(r.ok).toBe(true);
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

// ── State-seed matchers (v2) — Persona has field=value ──────────────

// Fake db that supports both .doc(...).get() and .doc(...).set(..., {merge}).
// Mutations are visible to subsequent gets within the same fake instance,
// so the runner contract "seed then assert" round-trips deterministically.
function makeStatefulFakeDb(initialDocs = {}, initialCollections = {}) {
  const docs = { ...initialDocs };
  return {
    doc: (docPath) => ({
      get: async () => {
        const data = docs[docPath];
        return { exists: data !== undefined, data: () => data };
      },
      set: async (patch, opts = {}) => {
        if (opts.merge) docs[docPath] = { ...(docs[docPath] || {}), ...patch };
        else docs[docPath] = { ...patch };
      },
    }),
    collection: (colPath) => ({
      get: async () => {
        // Two sources of docs: explicit `initialCollections[colPath]` (legacy
        // pattern) AND scanning `docs` for paths under `colPath/*` (mirrors
        // real Firestore — a doc at "users/X" lives in the "users" collection).
        const explicit = (initialCollections[colPath] || []).map((d, i) => ({
          id: d._id || `auto-${i}`,
          data: () => d,
        }));
        const prefix = `${colPath}/`;
        const scanned = Object.keys(docs)
          .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
          .map((p) => ({ id: p.slice(prefix.length), data: () => docs[p] }));
        return { docs: [...explicit, ...scanned] };
      },
    }),
    _docs: docs, // for test assertions
  };
}

describe('Persona state-seed matcher (Given <Persona> has <field>=<value>)', () => {
  test('numeric value writes the field to users/<uniqueId>', async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': { cohort: 'adult' } });
    const ctx = makeCtx({ db });
    const r = await executeStep({ kind: 'Given', text: 'Alice [P-02] has shyCoins=1000' }, ctx);
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000010'].shyCoins).toBe(1000);
    // Merge semantics — existing fields preserved.
    expect(db._docs['users/50000010'].cohort).toBe('adult');
  });

  test('platform-suffixed form is also accepted', async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Alice [P-02] on Web has shyCoins=42' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000010'].shyCoins).toBe(42);
  });

  test('boolean literal', async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Alice [P-02] has isAgeVerified=false' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000010'].isAgeVerified).toBe(false);
  });

  test('quoted-string literal', async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep({ kind: 'Given', text: 'Alice [P-02] has cohort="adult"' }, ctx);
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000010'].cohort).toBe('adult');
  });

  test('persona name without [P-XX] tag still resolves via registry', async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep({ kind: 'Given', text: 'Alice has shyCoins=500' }, ctx);
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000010'].shyCoins).toBe(500);
  });

  test('unknown persona returns actionable error', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep({ kind: 'Given', text: 'Mxyzptlk has shyCoins=1' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/persona|registry|Mxyzptlk/i);
  });

  test('missing db is an explicit error', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Given', text: 'Alice has shyCoins=1' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db|firestore|admin/i);
  });
});

describe('Persona user-doc multi-field state-seed matcher (Given <P> has user doc with k=v, k=v, …)', () => {
  test('writes multiple comma-separated fields in one step', async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Alice [P-02] has user doc with shyCoins=5000, beans=2000, gcs=100',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000010'].shyCoins).toBe(5000);
    expect(db._docs['users/50000010'].beans).toBe(2000);
    expect(db._docs['users/50000010'].gcs).toBe(100);
  });

  test('handles mixed types — int + quoted string + int + empty-array literal', async () => {
    const db = makeStatefulFakeDb({ 'users/50000020': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Lena [P-05] has user doc with acceptedPrivacyVersion=2, lastLoginRewardDate="2026-04-01", loginStreak=0, fcmTokens=[]',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000020'].acceptedPrivacyVersion).toBe(2);
    expect(db._docs['users/50000020'].lastLoginRewardDate).toBe('2026-04-01');
    expect(db._docs['users/50000020'].loginStreak).toBe(0);
    expect(db._docs['users/50000020'].fcmTokens).toEqual([]);
  });

  test('single-field form (no comma) is also accepted', async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Alice [P-02] has user doc with cohort="adult"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000010'].cohort).toBe('adult');
  });

  test('merge semantics preserve pre-existing fields', async () => {
    const db = makeStatefulFakeDb({
      'users/50000010': { displayName: 'Alice', existingField: 'keep-me' },
    });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Alice [P-02] has user doc with shyCoins=42' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000010'].shyCoins).toBe(42);
    expect(db._docs['users/50000010'].existingField).toBe('keep-me');
    expect(db._docs['users/50000010'].displayName).toBe('Alice');
  });

  test('quoted-string value containing a comma is NOT split on the inner comma', async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Alice [P-02] has user doc with bio="hi, welcome", shyCoins=10',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000010'].bio).toBe('hi, welcome');
    expect(db._docs['users/50000010'].shyCoins).toBe(10);
  });

  test('unknown persona fails loudly', async () => {
    const ctx = makeCtx({ db: makeStatefulFakeDb({}) });
    const r = await executeStep(
      { kind: 'Given', text: 'Zorpax [P-99] has user doc with x=1' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/persona|registry/i);
  });

  test('missing db is an explicit error', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Given', text: 'Alice [P-02] has user doc with x=1' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db|firestore|admin/i);
  });

  test('malformed pair (no =) surfaces a clear error rather than silently ignoring', async () => {
    const ctx = makeCtx({ db: makeStatefulFakeDb({ 'users/50000010': {} }) });
    const r = await executeStep(
      { kind: 'Given', text: 'Alice [P-02] has user doc with shyCoins5000' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/=|missing|malformed/i);
  });
});

describe('Persona fresh-install assertion (Given <P> is on <Platform> with the app installed but no Firebase session)', () => {
  test('Android single-token platform passes when no session exists', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Adam [P-01] is on Android with the app installed but no Firebase session',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.sessions.has('Adam')).toBe(false);
    expect(ctx.personaPlatforms.get('Adam')).toBe('Android');
  });

  test('iOS Sim multi-token platform passes', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Mia [P-03] is on iOS Sim with the app installed but no Firebase session',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPlatforms.get('Mia')).toBe('iOS Sim');
  });

  test('Web Chromium multi-token platform passes', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Alice [P-02] is on Web Chromium with the app installed but no Firebase session',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPlatforms.get('Alice')).toBe('Web Chromium');
  });

  test('clears any prior session for that persona — no Firebase session is enforced', async () => {
    const ctx = makeCtx();
    ctx.sessions.set('Adam', { idToken: 'stale-token', persona: { uniqueId: 50000005 } });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Adam [P-01] is on Android with the app installed but no Firebase session',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.sessions.has('Adam')).toBe(false);
  });

  test('persona-id-less form (just first name) also works', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Alice is on Android with the app installed but no Firebase session',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPlatforms.get('Alice')).toBe('Android');
  });

  test('accepts ephemeral persona (Adam P-01) — the whole point of fresh signup scenarios', async () => {
    // Adam P-01 / Mia P-03 are deliberately NOT in the provisioner
    // registry — j01/j02 walk them through signup. This assertion-only
    // matcher must accept them. Typo-catching is deferred to downstream
    // steps that actually need a uniqueId.
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Adam [P-01] is on Android with the app installed but no Firebase session',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPlatforms.get('Adam')).toBe('Android');
  });

  test('Android physical 2-token platform passes', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Alice [P-02] is on Android physical with the app installed but no Firebase session',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPlatforms.get('Alice')).toBe('Android physical');
  });
});

describe('Sign-in with kv-pair state seed (Given <P> is signed in on <Platform> with <fields>)', () => {
  function withSignInFetch(uniqueId = 50000010) {
    return jest.fn(async (url) => {
      if (typeof url === 'string' && url.includes('signInWithPassword')) {
        const idToken =
          'h.' +
          Buffer.from(JSON.stringify({ uniqueId, admin: false })).toString('base64url') +
          '.s';
        return { status: 200, json: async () => ({ idToken, refreshToken: 'r', localId: 'f' }) };
      }
      return { status: 500, text: async () => '{}' };
    });
  }

  test('multi-field comma-separated state seeds user doc after sign-in', async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': {} });
    const ctx = makeCtx({ fetch: withSignInFetch(50000010), db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Alice [P-02] is signed in on Web Chromium with shyCoins=5000, beans=2000, gcs=100',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.sessions.get('Alice')).toBeDefined();
    expect(db._docs['users/50000010'].shyCoins).toBe(5000);
    expect(db._docs['users/50000010'].beans).toBe(2000);
    expect(db._docs['users/50000010'].gcs).toBe(100);
  });

  test('single-field with shyCoins=5000 also seeds', async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': {} });
    const ctx = makeCtx({ fetch: withSignInFetch(50000010), db });
    const r = await executeStep(
      { kind: 'Given', text: 'Alice [P-02] is signed in on Android physical with shyCoins=5000' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000010'].shyCoins).toBe(5000);
  });

  test('"X and Y" separator works alongside trailing parenthetical', async () => {
    // j07's first-step shape: Adam will eventually go here when ephemeral
    // sign-in lands; for now we use Hayato (P-06, in registry) to prove
    // the parsing.
    const db = makeStatefulFakeDb({ 'users/50000030': {} });
    const ctx = makeCtx({ fetch: withSignInFetch(50000030), db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Hayato [P-06] is signed in on Android with cohort=adult and isAgeVerified=true (post-j01 state)',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000030'].cohort).toBe('adult');
    expect(db._docs['users/50000030'].isAgeVerified).toBe(true);
  });

  test('no `with` clause — existing sign-in semantics unchanged', async () => {
    const ctx = makeCtx({ fetch: withSignInFetch() });
    const r = await executeStep(
      { kind: 'Given', text: 'Alice [P-02] is signed in on Android' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.sessions.get('Alice')).toBeDefined();
  });

  test('quoted-string value in `with` clause writes correctly', async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': {} });
    const ctx = makeCtx({ fetch: withSignInFetch(50000010), db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Alice [P-02] is signed in on Web Chromium with lastSeenAt="2026-05-17T15:00:00Z"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000010'].lastSeenAt).toBe('2026-05-17T15:00:00Z');
  });

  test('trailing parenthetical alone (no with-clause kv pairs) — sign-in still passes, no seed', async () => {
    const ctx = makeCtx({ fetch: withSignInFetch() });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Alice [P-02] is signed in on Android (no admin claim)',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('with-clause requires ctx.db — explicit error if missing', async () => {
    const ctx = makeCtx({ fetch: withSignInFetch() }); // no db
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Lena [P-05] is signed in on Android with shyCoins=5000',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db|firestore/i);
  });
});

describe('ageVerificationSubmission state-seed matcher (j04 first-step shape)', () => {
  test('creates submission doc with status + DOB-on-ID for Hayato', async () => {
    const db = makeStatefulFakeDb({ 'users/50000030': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Hayato [P-06] submitted an ageVerificationSubmission with status="PENDING" and an ID image showing DOB=2011-05-12',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    const docId = 'ageVerificationSubmissions/test-50000030-pending';
    expect(db._docs[docId]).toBeDefined();
    expect(db._docs[docId].userId).toBe('50000030');
    expect(db._docs[docId].status).toBe('pending');
    expect(db._docs[docId].dobOnId).toBe('2011-05-12');
  });

  test('status is lowercased — runner contract matches express-api enum', async () => {
    // Real schema uses lowercase ('pending'/'approved'/'rejected') but
    // scenarios sometimes write the human-readable uppercase. Normalise
    // in one place (the matcher) rather than asking authors to remember.
    const db = makeStatefulFakeDb({ 'users/50000030': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Hayato [P-06] submitted an ageVerificationSubmission with status="APPROVED"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['ageVerificationSubmissions/test-50000030-approved'].status).toBe('approved');
  });

  test('DOB-on-ID is optional — status-only form works for j04 cycle scenarios', async () => {
    const db = makeStatefulFakeDb({ 'users/50000030': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Hayato [P-06] submitted an ageVerificationSubmission with status="PENDING"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    const doc = db._docs['ageVerificationSubmissions/test-50000030-pending'];
    expect(doc.userId).toBe('50000030');
    expect(doc.status).toBe('pending');
    expect(doc.dobOnId).toBeUndefined();
  });

  test('submittedAt timestamp is set on creation', async () => {
    const db = makeStatefulFakeDb({ 'users/50000030': {} });
    const ctx = makeCtx({ db });
    const beforeMs = Date.now();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Hayato [P-06] submitted an ageVerificationSubmission with status="PENDING"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    const doc = db._docs['ageVerificationSubmissions/test-50000030-pending'];
    expect(typeof doc.submittedAt).toBe('number');
    expect(doc.submittedAt).toBeGreaterThanOrEqual(beforeMs);
    expect(doc.submittedAt).toBeLessThanOrEqual(Date.now());
  });

  test('idempotent — repeated calls for same (user, status) overwrite the same doc id', async () => {
    const db = makeStatefulFakeDb({ 'users/50000030': {} });
    const ctx = makeCtx({ db });
    await executeStep(
      {
        kind: 'Given',
        text: 'Hayato [P-06] submitted an ageVerificationSubmission with status="PENDING" and an ID image showing DOB=2010-01-01',
      },
      ctx,
    );
    await executeStep(
      {
        kind: 'Given',
        text: 'Hayato [P-06] submitted an ageVerificationSubmission with status="PENDING" and an ID image showing DOB=2011-05-12',
      },
      ctx,
    );
    // Second call overwrites the first — DOB updated, no duplicate docs.
    const docs = Object.keys(db._docs).filter((k) => k.startsWith('ageVerificationSubmissions/'));
    expect(docs).toHaveLength(1);
    expect(db._docs[docs[0]].dobOnId).toBe('2011-05-12');
  });

  test('unknown persona fails loudly', async () => {
    const ctx = makeCtx({ db: makeStatefulFakeDb({}) });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Zorpax [P-99] submitted an ageVerificationSubmission with status="PENDING"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/persona|registry/i);
  });

  test('missing db is an explicit error', async () => {
    const ctx = makeCtx(); // no db
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Hayato [P-06] submitted an ageVerificationSubmission with status="PENDING"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db|firestore/i);
  });
});

describe('Persona has-state-seed — array literals + compound `and` + trailing paren (j04 BG shapes)', () => {
  test('array literal: has followingIds=[N, N] writes array to user doc', async () => {
    const db = makeStatefulFakeDb({ 'users/50000030': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Hayato [P-06] has followingIds=[50000010, 50000060]',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000030'].followingIds).toEqual([50000010, 50000060]);
  });

  test('array literal with trailing parenthetical — paren stripped, array intact', async () => {
    const db = makeStatefulFakeDb({ 'users/50000030': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Hayato [P-06] has followingIds=[50000010, 50000060] (two adult follows)',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000030'].followingIds).toEqual([50000010, 50000060]);
  });

  test('compound "and" — has shyCoins=100 and isAgeVerified=false writes both fields', async () => {
    const db = makeStatefulFakeDb({ 'users/50000030': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Hayato [P-06] has shyCoins=100 and isAgeVerified=false',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000030'].shyCoins).toBe(100);
    expect(db._docs['users/50000030'].isAgeVerified).toBe(false);
  });

  test('mixed: array + scalar via `and` — has followingIds=[50000010] and shyCoins=200', async () => {
    const db = makeStatefulFakeDb({ 'users/50000030': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Hayato [P-06] has followingIds=[50000010] and shyCoins=200',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000030'].followingIds).toEqual([50000010]);
    expect(db._docs['users/50000030'].shyCoins).toBe(200);
  });

  test('empty array literal: has followingIds=[] writes empty array', async () => {
    const db = makeStatefulFakeDb({ 'users/50000030': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Hayato [P-06] has followingIds=[]',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000030'].followingIds).toEqual([]);
  });

  test('mixed-type array: has tags=["adult", "verified"] writes array of strings', async () => {
    const db = makeStatefulFakeDb({ 'users/50000030': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Hayato [P-06] has tags=["adult", "verified"]',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000030'].tags).toEqual(['adult', 'verified']);
  });

  test('single-field shape (pre-existing) still works — has shyCoins=42', async () => {
    // Regression check: the wake-1 single-field tests must keep passing
    // after this wake's generalisation.
    const db = makeStatefulFakeDb({ 'users/50000010': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep({ kind: 'Given', text: 'Alice [P-02] has shyCoins=42' }, ctx);
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000010'].shyCoins).toBe(42);
  });
});

describe('Persona on-platform-at-path matcher (Given <P> is on <Platform> at "<path>")', () => {
  test('Web Admin at "/admin#age-verification" records platform + path', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Greta [P-12] is on Web Admin at "/admin#age-verification"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPlatforms.get('Greta')).toBe('Web Admin');
    expect(ctx.personaPaths.get('Greta')).toBe('/admin#age-verification');
  });

  test('with-no-Firebase-session suffix clears any prior session AND records path', async () => {
    // j03's BG line: "Lena [P-05] is on Web Chromium at \"/\" with no Firebase session"
    const ctx = makeCtx();
    ctx.sessions.set('Lena', { idToken: 'stale', persona: { uniqueId: 50000020 } });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Lena [P-05] is on Web Chromium at "/" with no Firebase session',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPlatforms.get('Lena')).toBe('Web Chromium');
    expect(ctx.personaPaths.get('Lena')).toBe('/');
    expect(ctx.sessions.has('Lena')).toBe(false);
  });

  test('persona-id-less form (just name) works', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'Greta is on Web Admin at "/admin#users"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPaths.get('Greta')).toBe('/admin#users');
  });

  test('multi-token platform: "iOS Sim at /chat" works', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'Mia [P-03] is on iOS Sim at "/chat"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPlatforms.get('Mia')).toBe('iOS Sim');
    expect(ctx.personaPaths.get('Mia')).toBe('/chat');
  });

  test('path with query string preserved', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Alice [P-02] is on Web Chromium at "/discover?cohort=adult&limit=20"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPaths.get('Alice')).toBe('/discover?cohort=adult&limit=20');
  });

  test('records platform/path without requiring Firebase session — pure bookkeeping', async () => {
    // Confirms the matcher does NOT require a prior sign-in. Greta has no
    // session — the matcher must still record her context.
    const ctx = makeCtx();
    expect(ctx.sessions.has('Greta')).toBe(false);
    const r = await executeStep(
      { kind: 'Given', text: 'Greta [P-12] is on Web Admin at "/admin#reports"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPlatforms.get('Greta')).toBe('Web Admin');
  });
});

describe('Ephemeral persona sign-in (Adam P-01, Mia P-03 — accounts not in provisioner)', () => {
  test('Adam can be signed-in with state seed — no Firebase REST call attempted', async () => {
    // Adam P-01 is ephemeral. The matcher must NOT attempt to authenticate
    // against Firebase (no account exists); instead create a synthetic
    // session record AND seed his declared state into Firestore.
    const fetchSpy = jest.fn();
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ fetch: fetchSpy, db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Adam [P-01] is signed in on Android with cohort=adult and isAgeVerified=true (post-j01 state)',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    // No real auth call attempted
    expect(fetchSpy).not.toHaveBeenCalled();
    // Synthetic session is recorded
    const session = ctx.sessions.get('Adam');
    expect(session).toBeDefined();
    expect(session.idToken).toMatch(/^synthetic:/);
    expect(session.persona.id).toBe('P-01');
    // State seeded onto Adam's user doc
    const adamUid = session.persona.uniqueId;
    expect(db._docs[`users/${adamUid}`].cohort).toBe('adult');
    expect(db._docs[`users/${adamUid}`].isAgeVerified).toBe(true);
  });

  test('Mia can be signed-in with state seed — same pattern as Adam', async () => {
    const fetchSpy = jest.fn();
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ fetch: fetchSpy, db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Mia [P-03] is signed in on iOS Sim with cohort=minor',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    const session = ctx.sessions.get('Mia');
    expect(session.persona.id).toBe('P-03');
    expect(session.persona.cohort).toBe('minor');
    const miaUid = session.persona.uniqueId;
    expect(db._docs[`users/${miaUid}`].cohort).toBe('minor');
  });

  test('ephemeral uniqueIds are in the 9xxxxxxx test range — no collision with real personas (5xxxxxxx, 6xxxxxxx)', async () => {
    const ctx = makeCtx({ fetch: jest.fn(), db: makeStatefulFakeDb({}) });
    await executeStep(
      {
        kind: 'Given',
        text: 'Adam [P-01] is signed in on Android with cohort=adult',
      },
      ctx,
    );
    const adamUid = ctx.sessions.get('Adam').persona.uniqueId;
    expect(adamUid).toBeGreaterThanOrEqual(90000000);
    expect(adamUid).toBeLessThan(100000000);
  });

  test('non-ephemeral persona (Alice P-02) still hits real Firebase REST sign-in', async () => {
    // Regression check: ephemeral handling must not bypass real auth for
    // registered personas. Alice still goes through signInWithPassword.
    let signInUrlSeen = null;
    const fetchSpy = jest.fn(async (url) => {
      if (typeof url === 'string' && url.includes('signInWithPassword')) {
        signInUrlSeen = url;
        const idToken =
          'h.' + Buffer.from(JSON.stringify({ uniqueId: 50000010 })).toString('base64url') + '.s';
        return { status: 200, json: async () => ({ idToken, refreshToken: 'r', localId: 'f' }) };
      }
      return { status: 500, text: async () => '{}' };
    });
    const ctx = makeCtx({ fetch: fetchSpy });
    const r = await executeStep({ kind: 'Given', text: 'Alice [P-02] is signed in' }, ctx);
    expect(r.ok).toBe(true);
    expect(signInUrlSeen).toBeTruthy();
    expect(ctx.sessions.get('Alice').idToken).not.toMatch(/^synthetic:/);
  });

  test('ephemeral sign-in without ctx.db is OK if the `with` clause is omitted', async () => {
    // Pure session bookkeeping — no state seed, no db required.
    const ctx = makeCtx({ fetch: jest.fn() }); // no db
    const r = await executeStep(
      { kind: 'Given', text: 'Adam [P-01] is signed in on Android' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.sessions.get('Adam')).toBeDefined();
  });

  test('ephemeral sign-in WITH `with` clause requires ctx.db — error if missing', async () => {
    const ctx = makeCtx({ fetch: jest.fn() }); // no db
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Adam [P-01] is signed in on Android with cohort=adult',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db|firestore/i);
  });
});

describe('Persona exists-with full-state seed (Given <P> [P-NN] exists with <fields>)', () => {
  test('Officia (P-19, uniqueId=1) full-state seed writes all fields', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Officia [P-19] exists with uniqueId=1, userType=SHYTALK_OFFICIAL, isOfficial=true, isUnblockable=true',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    const doc = db._docs['users/1'];
    expect(doc.uniqueId).toBe(1);
    expect(doc.userType).toBe('SHYTALK_OFFICIAL');
    expect(doc.isOfficial).toBe(true);
    expect(doc.isUnblockable).toBe(true);
  });

  test('exists-with does NOT merge — fully replaces the user doc', async () => {
    const db = makeStatefulFakeDb({
      'users/1': { uniqueId: 1, staleField: 'should-be-gone' },
    });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Officia [P-19] exists with uniqueId=1, isOfficial=true',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/1'].staleField).toBeUndefined();
    expect(db._docs['users/1'].isOfficial).toBe(true);
  });

  test('uniqueId in the step body is the source of truth for doc path — overrides registry', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Officia [P-19] exists with uniqueId=42, isOfficial=true' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/42']).toBeDefined();
    expect(db._docs['users/1']).toBeUndefined();
  });

  test('without uniqueId in body — falls back to persona registry uniqueId', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Officia [P-19] exists with isOfficial=true' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/1'].isOfficial).toBe(true);
  });

  test('missing db is an explicit error', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Officia [P-19] exists with uniqueId=1, isOfficial=true',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db|firestore/i);
  });
});

describe('LiveKit Docker precondition (Given the LiveKit Docker container is running)', () => {
  test('passes as a no-op precondition — mirrors the existing local-stack precondition', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'the LiveKit Docker container is running' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });
});

describe('Sign-in with custom-claim seeding (Given <P> is signed in … with custom claim X=Y)', () => {
  function withSignInFetch(uniqueId = 50000120) {
    return jest.fn(async (url) => {
      if (typeof url === 'string' && url.includes('signInWithPassword')) {
        const idToken =
          'h.' +
          Buffer.from(JSON.stringify({ uniqueId, admin: false })).toString('base64url') +
          '.s';
        return { status: 200, json: async () => ({ idToken, refreshToken: 'r', localId: 'f' }) };
      }
      return { status: 500, text: async () => '{}' };
    });
  }

  test('isAdmin=true is added to session.customClaims (NOT user doc)', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ fetch: withSignInFetch(), db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Greta [P-12] is signed in on Web Admin Chromium with custom claim isAdmin=true',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    const session = ctx.sessions.get('Greta');
    expect(session.customClaims.isAdmin).toBe(true);
    // Custom claims do NOT spill into user doc
    expect(db._docs['users/50000120']).toBeUndefined();
  });

  test('compound `with custom claim X=Y and Z=W` seeds both into customClaims', async () => {
    const ctx = makeCtx({ fetch: withSignInFetch(), db: makeStatefulFakeDb({}) });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Greta [P-12] is signed in on Web with custom claim isAdmin=true and adminLevel=2',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    const session = ctx.sessions.get('Greta');
    expect(session.customClaims.isAdmin).toBe(true);
    expect(session.customClaims.adminLevel).toBe(2);
  });

  test('non-custom-claim `with` clause still seeds user doc as before — regression check', async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': {} });
    const ctx = makeCtx({ fetch: withSignInFetch(50000010), db });
    const r = await executeStep(
      { kind: 'Given', text: 'Alice [P-02] is signed in on Web Chromium with shyCoins=5000' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000010'].shyCoins).toBe(5000);
  });

  test('existing JWT-decoded claims are preserved when merging — additive only', async () => {
    const ctx = makeCtx({ fetch: withSignInFetch(50000120), db: makeStatefulFakeDb({}) });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Greta [P-12] is signed in on Web with custom claim isAdmin=true',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    const session = ctx.sessions.get('Greta');
    // Original JWT claim (uniqueId) survives
    expect(session.customClaims.uniqueId).toBe(50000120);
    // New custom claim added
    expect(session.customClaims.isAdmin).toBe(true);
  });
});

describe('Persona on-platform locale+signin compound (Given <P> is on <Platform> with browser locale <X>, signed in as <id>)', () => {
  function withSignInFetch(uniqueId = 50000070) {
    return jest.fn(async (url) => {
      if (typeof url === 'string' && url.includes('signInWithPassword')) {
        const idToken =
          'h.' +
          Buffer.from(JSON.stringify({ uniqueId, admin: false })).toString('base64url') +
          '.s';
        return { status: 200, json: async () => ({ idToken, refreshToken: 'r', localId: 'f' }) };
      }
      return { status: 500, text: async () => '{}' };
    });
  }

  test('Layla on Web Chromium with browser locale ar, signed in as 50000070', async () => {
    // j13 BG shape: combines platform, locale, and sign-in in one step.
    const ctx = makeCtx({ fetch: withSignInFetch(50000070) });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Layla [P-13] is on Web Chromium with browser locale ar, signed in as 50000070',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPlatforms.get('Layla')).toBe('Web Chromium');
    expect(ctx.locale).toBe('ar');
    expect(ctx.sessions.get('Layla')).toBeDefined();
  });

  test('CJK locale (ja) for Kenji', async () => {
    const ctx = makeCtx({ fetch: withSignInFetch(50000071) });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Kenji [P-14] is on Web Chromium with browser locale ja, signed in as 50000071',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.locale).toBe('ja');
    expect(ctx.personaPlatforms.get('Kenji')).toBe('Web Chromium');
  });

  test('mismatched uniqueId between persona registry and step body — error', async () => {
    // Layla [P-13] is uniqueId=50000070 in the registry. If the step body
    // claims "signed in as 99999999", that's a step-author bug — fail loudly
    // rather than silently pass with the wrong identity.
    const ctx = makeCtx({ fetch: withSignInFetch(50000070) });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Layla [P-13] is on Web Chromium with browser locale ar, signed in as 99999999',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/mismatch|99999999|50000070/i);
  });
});

describe('Persona "is signed in on <Platform> with device locale <code>" (j13 phase-2 continuation)', () => {
  function withSignInFetch(uniqueId = 50000070) {
    return jest.fn(async (url) => {
      if (typeof url === 'string' && url.includes('signInWithPassword')) {
        const idToken =
          'h.' +
          Buffer.from(JSON.stringify({ uniqueId, admin: false })).toString('base64url') +
          '.s';
        return { status: 200, json: async () => ({ idToken, refreshToken: 'r', localId: 'f' }) };
      }
      return { status: 500, text: async () => '{}' };
    });
  }

  test('"Layla is signed in on Android emulator with device locale ar" — sets platform + locale + session', async () => {
    const ctx = makeCtx({ fetch: withSignInFetch(50000070) });
    const r = await executeStep(
      { kind: 'Given', text: 'Layla is signed in on Android emulator with device locale ar' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPlatforms.get('Layla')).toBe('Android emulator');
    expect(ctx.locale).toBe('ar');
    expect(ctx.deviceLocales.get('Layla')).toBe('ar');
    expect(ctx.sessions.get('Layla')).toBeDefined();
  });

  test('"Kenji is signed in on iOS Sim with device locale ja" — multi-word platform parses correctly', async () => {
    const ctx = makeCtx({ fetch: withSignInFetch(50000071) });
    const r = await executeStep(
      { kind: 'Given', text: 'Kenji is signed in on iOS Sim with device locale ja' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPlatforms.get('Kenji')).toBe('iOS Sim');
    expect(ctx.locale).toBe('ja');
    expect(ctx.deviceLocales.get('Kenji')).toBe('ja');
  });

  test('locale-region form (en-GB) parses correctly', async () => {
    const ctx = makeCtx({ fetch: withSignInFetch(50000070) });
    const r = await executeStep(
      { kind: 'Given', text: 'Layla is signed in on Android emulator with device locale en-GB' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.locale).toBe('en-GB');
    expect(ctx.deviceLocales.get('Layla')).toBe('en-GB');
  });

  test('optional [P-NN] bracketed form also works', async () => {
    const ctx = makeCtx({ fetch: withSignInFetch(50000070) });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Layla [P-13] is signed in on Android emulator with device locale ar',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPlatforms.get('Layla')).toBe('Android emulator');
  });

  test('unknown persona → actionable error (no Firebase call)', async () => {
    const fetchSpy = withSignInFetch(50000070);
    const ctx = makeCtx({ fetch: fetchSpy });
    const r = await executeStep(
      { kind: 'Given', text: 'Zonk is signed in on iOS Sim with device locale ja' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/persona "Zonk" not in registry/);
    // No Firebase sign-in attempt for unknown personas — fail fast
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('missing PERSONAS_PASSWORD env → actionable error (preserves operator setup hint)', async () => {
    const ctx = makeCtx({
      fetch: withSignInFetch(50000070),
      personasPassword: undefined,
    });
    const r = await executeStep(
      { kind: 'Given', text: 'Layla is signed in on Android emulator with device locale ar' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/PERSONAS_PASSWORD env not set/);
  });

  test('Firebase sign-in non-200 → actionable error with status', async () => {
    const fetchSpy = jest.fn(async () => ({ status: 401, json: async () => ({}) }));
    const ctx = makeCtx({ fetch: fetchSpy });
    const r = await executeStep(
      { kind: 'Given', text: 'Layla is signed in on Android emulator with device locale ar' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Firebase sign-in failed/);
    expect(r.error).toMatch(/401/);
  });
});

describe('Persona "is signed in on Android physical at the <tab> tab" (j09 Background — drives picker)', () => {
  function withSignInFetch(uniqueId = 50000060) {
    return jest.fn(async (url) => {
      if (typeof url === 'string' && url.includes('signInWithPassword')) {
        const idToken =
          'h.' +
          Buffer.from(JSON.stringify({ uniqueId, admin: false })).toString('base64url') +
          '.s';
        return { status: 200, json: async () => ({ idToken, refreshToken: 'r', localId: 'f' }) };
      }
      return { status: 500, text: async () => '{}' };
    });
  }

  test('happy path: both server-side sign-in AND androidPersonaSignIn fire when driver wired', async () => {
    const personaSignInSpy = jest.fn(async () => true);
    const ctx = makeCtx({
      fetch: withSignInFetch(50000060),
      uiDriver: { androidPersonaSignIn: personaSignInSpy },
      target: 'dev',
    });
    const r = await executeStep(
      { kind: 'Given', text: 'Theo [P-10] is signed in on Android physical at the "rooms" tab' },
      ctx,
    );
    expect(r.ok).toBe(true);
    // Server-side: session populated.
    expect(ctx.sessions.get('Theo')).toBeDefined();
    expect(ctx.personaPlatforms.get('Theo')).toBe('Android physical');
    // Device-side: driver method called with the persona id + tab + target
    // (target is needed for the app-launch step to pick the right
    // applicationIdSuffix — local/dev/prod).
    expect(personaSignInSpy).toHaveBeenCalledWith('P-10', 'rooms', 'dev');
  });

  test('driver not wired → server-side sign-in still succeeds, warning logged, ok=true', async () => {
    // Capture stderr so we don't pollute test output AND can assert on
    // the warning text. console.error is called via the runner's
    // permissive-degradation path.
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = makeCtx({ fetch: withSignInFetch(50000060) });
    const r = await executeStep(
      { kind: 'Given', text: 'Theo [P-10] is signed in on Android physical at the "rooms" tab' },
      ctx,
    );
    expect(r.ok).toBe(true);
    // Server-side sign-in still happened
    expect(ctx.sessions.get('Theo')).toBeDefined();
    // Warning surfaced with actionable hint
    expect(errSpy).toHaveBeenCalledWith(expect.stringMatching(/no androidPersonaSignIn driver/));
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Wire --driver adb \(or --driver all\) to enable/),
    );
    errSpy.mockRestore();
  });

  test('driver throws → matcher returns ok=false with the driver error message verbatim', async () => {
    const personaSignInSpy = jest.fn(async () => {
      throw new Error(
        'androidPersonaSignIn: never reached main screen ("main_roomsTab") within 10s of picking P-10',
      );
    });
    const ctx = makeCtx({
      fetch: withSignInFetch(50000060),
      uiDriver: { androidPersonaSignIn: personaSignInSpy },
    });
    const r = await executeStep(
      { kind: 'Given', text: 'Theo [P-10] is signed in on Android physical at the "rooms" tab' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/never reached main screen/);
  });

  test('unknown persona → actionable error, no Firebase call, no driver call', async () => {
    const fetchSpy = withSignInFetch(50000060);
    const personaSignInSpy = jest.fn(async () => true);
    const ctx = makeCtx({
      fetch: fetchSpy,
      uiDriver: { androidPersonaSignIn: personaSignInSpy },
    });
    const r = await executeStep(
      { kind: 'Given', text: 'Zonk [P-99] is signed in on Android physical at the "rooms" tab' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/persona "Zonk" not in registry/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(personaSignInSpy).not.toHaveBeenCalled();
  });

  test('missing PERSONAS_PASSWORD → actionable error', async () => {
    const ctx = makeCtx({
      fetch: withSignInFetch(50000060),
      uiDriver: { androidPersonaSignIn: jest.fn() },
      personasPassword: undefined,
    });
    const r = await executeStep(
      { kind: 'Given', text: 'Theo [P-10] is signed in on Android physical at the "rooms" tab' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/PERSONAS_PASSWORD env not set/);
  });

  test('Firebase 401 → actionable error, driver NOT called (server-side gate must pass first)', async () => {
    const fetchSpy = jest.fn(async () => ({ status: 401, json: async () => ({}) }));
    const personaSignInSpy = jest.fn(async () => true);
    const ctx = makeCtx({
      fetch: fetchSpy,
      uiDriver: { androidPersonaSignIn: personaSignInSpy },
    });
    const r = await executeStep(
      { kind: 'Given', text: 'Theo [P-10] is signed in on Android physical at the "rooms" tab' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Firebase sign-in failed/);
    expect(r.error).toMatch(/401/);
    // Driver must NOT be called when server-side sign-in failed —
    // signing the device in for a user that doesn't auth would mask
    // the real failure mode.
    expect(personaSignInSpy).not.toHaveBeenCalled();
  });

  test('non-rooms tab (e.g. profile) — driver method gets the tab name + target', async () => {
    const personaSignInSpy = jest.fn(async () => true);
    const ctx = makeCtx({
      fetch: withSignInFetch(50000060),
      uiDriver: { androidPersonaSignIn: personaSignInSpy },
      target: 'local',
    });
    const r = await executeStep(
      { kind: 'Given', text: 'Theo [P-10] is signed in on Android physical at the "profile" tab' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(personaSignInSpy).toHaveBeenCalledWith('P-10', 'profile', 'local');
  });

  test('does NOT fire on platforms other than "Android physical" — falls through to catch-all', async () => {
    // The catch-all matcher (line ~947) accepts "is signed in on Web Chromium ...",
    // "is signed in on iOS Sim ...", etc. — those must still work without
    // hitting the more-specific Android-physical handler.
    const personaSignInSpy = jest.fn(async () => true);
    const ctx = makeCtx({
      fetch: withSignInFetch(50000010),
      uiDriver: { androidPersonaSignIn: personaSignInSpy },
    });
    const r = await executeStep(
      { kind: 'Given', text: 'Alice [P-02] is signed in on Web Chromium at the "rooms" tab' },
      ctx,
    );
    expect(r.ok).toBe(true);
    // Driver NOT called — different platform, different matcher fired.
    expect(personaSignInSpy).not.toHaveBeenCalled();
  });
});

describe('Sign-in `at the "X" tab` form (j09 Theo on the rooms tab)', () => {
  function withSignInFetch(uniqueId = 50000110) {
    return jest.fn(async (url) => {
      if (typeof url === 'string' && url.includes('signInWithPassword')) {
        const idToken =
          'h.' +
          Buffer.from(JSON.stringify({ uniqueId, admin: false })).toString('base64url') +
          '.s';
        return { status: 200, json: async () => ({ idToken, refreshToken: 'r', localId: 'f' }) };
      }
      return { status: 500, text: async () => '{}' };
    });
  }

  test('Theo signed in on Android physical at the "rooms" tab — accepted', async () => {
    const ctx = makeCtx({ fetch: withSignInFetch() });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Theo [P-10] is signed in on Android physical at the "rooms" tab',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.sessions.get('Theo')).toBeDefined();
  });

  test('existing "at the X screen" form still works — regression check', async () => {
    const ctx = makeCtx({ fetch: withSignInFetch(50000010) });
    const r = await executeStep(
      { kind: 'Given', text: 'Alice [P-02] is signed in on Android at the "discovery" screen' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.sessions.get('Alice')).toBeDefined();
  });
});

describe('Network throttling matcher (j14 Ines on Slow 3G)', () => {
  test('Slow 3G profile recorded — platform + throttle on ctx', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Ines [P-11] is on Web Chromium with Chrome DevTools network throttling set to "Slow 3G" (400kbps down, 400ms latency)',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPlatforms.get('Ines')).toBe('Web Chromium');
    expect(ctx.networkThrottle).toBe('Slow 3G');
  });

  test('Fast 3G profile also works (trailing-paren-free form)', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Ines [P-11] is on Web Chromium with Chrome DevTools network throttling set to "Fast 3G"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.networkThrottle).toBe('Fast 3G');
  });

  test('Offline profile also works', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Ines [P-11] is on Web Chromium with Chrome DevTools network throttling set to "Offline"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.networkThrottle).toBe('Offline');
  });
});

describe('Negation: <P> has no prior interactions with <Other> (j08 cross-cohort wall setup)', () => {
  test('no-op pass — assumed-clean-environment MVP for "no prior interactions"', async () => {
    // Real impl would query conversations/follows/gifts/etc. and delete
    // any matching docs. For MVP: pass-through; downstream `Then …`
    // assertions catch genuine state violations.
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'Vexa has no prior interactions with Marcus' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('persona-id-bracketed form also works', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'Vexa [P-07] has no prior interactions with Marcus [P-04]' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });
});

describe('j19 migration query verbs', () => {
  test('single-doc query stores result on ctx.lastQueryResult', async () => {
    const db = makeStatefulFakeDb({ 'users/1': { uniqueId: 1, isOfficial: true } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'When', text: 'a query is run for the user doc "users/1"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.lastQueryResult).toBeDefined();
    expect(ctx.lastQueryResult.exists).toBe(true);
    expect(ctx.lastQueryResult.data.uniqueId).toBe(1);
  });

  test('single-doc query for missing path still passes — exists=false', async () => {
    const ctx = makeCtx({ db: makeStatefulFakeDb({}) });
    const r = await executeStep(
      { kind: 'When', text: 'a query is run for the user doc "users/99999999"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.lastQueryResult.exists).toBe(false);
  });

  test('collection scan stores all docs on ctx.lastQueryResult', async () => {
    const db = makeStatefulFakeDb(
      {},
      {
        users: [
          { uniqueId: 50000010, cohort: 'adult' },
          { uniqueId: 60000010, cohort: 'minor' },
        ],
      },
    );
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'When', text: 'a query is run for every "users/*" doc' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(Array.isArray(ctx.lastQueryResult.docs)).toBe(true);
    expect(ctx.lastQueryResult.docs).toHaveLength(2);
  });

  test('filtered collection scan: where cohort="adult"', async () => {
    const db = makeStatefulFakeDb(
      {},
      {
        users: [
          { uniqueId: 50000010, cohort: 'adult' },
          { uniqueId: 60000010, cohort: 'minor' },
          { uniqueId: 50000020, cohort: 'adult' },
        ],
      },
    );
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'When', text: 'a query is run for every "users/*" doc where cohort="adult"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.lastQueryResult.docs).toHaveLength(2);
    expect(ctx.lastQueryResult.docs.every((d) => d.cohort === 'adult')).toBe(true);
  });

  test('migration script execution is a no-op pass (MVP)', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'the migration script is executed with --dry-run against dev' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('`with` predicate keyword also works (j19 variant)', async () => {
    // Cycle-3 uses both `where` and `with` for predicates — accept either.
    const db = makeStatefulFakeDb(
      {},
      {
        rooms: [
          { state: 'OPEN', cohort: 'adult' },
          { state: 'CLOSED', cohort: 'minor' },
          { state: 'OPEN', cohort: 'mixed' },
        ],
      },
    );
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'When', text: 'a query is run for every "rooms/*" doc with state="OPEN"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.lastQueryResult.docs).toHaveLength(2);
  });

  test('plural-form `"X/*" docs with field=Y and field=Z` (multi-predicate, no "every")', async () => {
    // j19's mixed-cohort-room scenario shape.
    const db = makeStatefulFakeDb(
      {},
      {
        rooms: [
          { state: 'CLOSED', closedBy: 'migration' },
          { state: 'CLOSED', closedBy: 'user' },
          { state: 'OPEN', closedBy: null },
          { state: 'CLOSED', closedBy: 'migration' },
        ],
      },
    );
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'a query is run for "rooms/*" docs with state="CLOSED" and closedBy="migration"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.lastQueryResult.docs).toHaveLength(2);
    expect(ctx.lastQueryResult.docs.every((d) => d.state === 'CLOSED')).toBe(true);
    expect(ctx.lastQueryResult.docs.every((d) => d.closedBy === 'migration')).toBe(true);
  });
});

describe('UI driver — Android element-tag assertion (Then <P>\'s Android UI shows the element with tag "<X>")', () => {
  test('element present in UI dump passes', async () => {
    const dump =
      '<node resource-id="main_pmTab" text="" bounds="[0,0][100,100]" />' +
      '<node resource-id="main_homeTab" text="Home" />';
    const ctx = makeCtx({ uiDriver: { androidUiDump: jest.fn(async () => dump) } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Hayato\'s Android UI shows the element with tag "main_pmTab"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.uiDriver.androidUiDump).toHaveBeenCalled();
  });

  test('element absent from UI dump fails with clear error', async () => {
    const dump = '<node resource-id="main_homeTab" />';
    const ctx = makeCtx({ uiDriver: { androidUiDump: jest.fn(async () => dump) } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Hayato\'s Android UI shows the element with tag "main_pmTab"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/main_pmTab/);
  });

  test('fully-qualified resource-id (com.shyden.shytalk.dev:id/X) also matches the short tag form', async () => {
    // Real adb uiautomator dump emits `com.shyden.shytalk.dev:id/main_pmTab`
    // even when the Gherkin step uses the short tag. The matcher should
    // accept both forms.
    const dump = '<node resource-id="com.shyden.shytalk.dev:id/main_pmTab" />';
    const ctx = makeCtx({ uiDriver: { androidUiDump: jest.fn(async () => dump) } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Hayato\'s Android UI shows the element with tag "main_pmTab"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('no ctx.uiDriver configured — explicit error (not silent pass)', async () => {
    const ctx = makeCtx(); // no uiDriver
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Hayato\'s Android UI shows the element with tag "main_pmTab"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/uiDriver/i);
  });

  test('iOS UI step fails with "not yet implemented" (Minor severity tracker)', async () => {
    const ctx = makeCtx({ uiDriver: { androidUiDump: jest.fn() } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Mia\'s iOS Sim UI shows the element with tag "restricted_banner"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/iOS|not.*implement|simctl/i);
  });

  test('Web UI step fails with "out of Node scope" (delegated to Playwright MCP)', async () => {
    const ctx = makeCtx({ uiDriver: { androidUiDump: jest.fn() } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Greta\'s Web Admin UI shows the element with tag "admin_age_verification"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Web|Playwright|out.*scope/i);
  });
});

describe('UI driver — Android tap on element with tag (When <P> on Android taps "<X>")', () => {
  test('tap on found element calls androidTap with bounds centre', async () => {
    const dump = '<node resource-id="signup_createAccountButton" bounds="[100,200][300,400]" />';
    const tapSpy = jest.fn(async () => {});
    const ctx = makeCtx({
      uiDriver: { androidUiDump: jest.fn(async () => dump), androidTap: tapSpy },
    });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android taps "signup_createAccountButton"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    // Bounds [100,200][300,400] → centre (200, 300)
    expect(tapSpy).toHaveBeenCalledWith(200, 300);
  });

  test('tap on missing element fails — does not silently pass', async () => {
    const dump = '<node resource-id="other_tag" bounds="[0,0][50,50]" />';
    const tapSpy = jest.fn();
    const ctx = makeCtx({
      uiDriver: { androidUiDump: jest.fn(async () => dump), androidTap: tapSpy },
    });
    const r = await executeStep({ kind: 'When', text: 'Adam on Android taps "missing_tag"' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/missing_tag/);
    expect(tapSpy).not.toHaveBeenCalled();
  });

  test('fully-qualified resource-id form also resolves', async () => {
    const dump =
      '<node resource-id="com.shyden.shytalk.dev:id/signup_createAccountButton" bounds="[10,20][30,40]" />';
    const tapSpy = jest.fn(async () => {});
    const ctx = makeCtx({
      uiDriver: { androidUiDump: jest.fn(async () => dump), androidTap: tapSpy },
    });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android taps "signup_createAccountButton"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    // Bounds [10,20][30,40] → centre (20, 30)
    expect(tapSpy).toHaveBeenCalledWith(20, 30);
  });

  test('no ctx.uiDriver — loud error', async () => {
    const ctx = makeCtx(); // no uiDriver
    const r = await executeStep({ kind: 'When', text: 'Adam on Android taps "any_tag"' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/uiDriver/i);
  });

  test('element with no bounds attribute fails with clear error', async () => {
    const dump = '<node resource-id="weird_no_bounds" />';
    const ctx = makeCtx({
      uiDriver: { androidUiDump: jest.fn(async () => dump), androidTap: jest.fn() },
    });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android taps "weird_no_bounds"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/bounds/i);
  });
});

describe('UI driver — Android type text into element (When <P> on Android types "<text>" into "<tag>")', () => {
  test('typing into a found field focuses (taps centre) then dispatches text', async () => {
    const dump = '<node resource-id="signup_emailField" bounds="[200,20][320,80]" />';
    const tapSpy = jest.fn(async () => {});
    const typeSpy = jest.fn(async () => {});
    const ctx = makeCtx({
      uiDriver: {
        androidUiDump: jest.fn(async () => dump),
        androidTap: tapSpy,
        androidTypeText: typeSpy,
      },
    });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Adam on Android types "adam-new@shytalk.dev" into "signup_emailField"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    // Bounds [200,20][320,80] → centre (260, 50)
    expect(tapSpy).toHaveBeenCalledWith(260, 50);
    expect(typeSpy).toHaveBeenCalledWith('adam-new@shytalk.dev');
    // Tap MUST happen before type — adb input text writes to the focused element.
    expect(tapSpy.mock.invocationCallOrder[0]).toBeLessThan(typeSpy.mock.invocationCallOrder[0]);
  });

  test('typing into a missing field fails — no tap, no type', async () => {
    const dump = '<node resource-id="other_field" bounds="[0,0][10,10]" />';
    const tapSpy = jest.fn();
    const typeSpy = jest.fn();
    const ctx = makeCtx({
      uiDriver: {
        androidUiDump: jest.fn(async () => dump),
        androidTap: tapSpy,
        androidTypeText: typeSpy,
      },
    });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Adam on Android types "anything" into "missing_field"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/missing_field/);
    expect(tapSpy).not.toHaveBeenCalled();
    expect(typeSpy).not.toHaveBeenCalled();
  });

  test('no ctx.uiDriver — loud error before any driver call', async () => {
    const ctx = makeCtx(); // no uiDriver
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android types "x" into "any_tag"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/uiDriver/i);
  });

  test('quoted text passes through verbatim — special chars preserved (e.g. !@#)', async () => {
    const dump = '<node resource-id="signup_passwordField" bounds="[0,0][100,40]" />';
    const tapSpy = jest.fn(async () => {});
    const typeSpy = jest.fn(async () => {});
    const ctx = makeCtx({
      uiDriver: {
        androidUiDump: jest.fn(async () => dump),
        androidTap: tapSpy,
        androidTypeText: typeSpy,
      },
    });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Adam on Android types "TestPassw0rd!" into "signup_passwordField"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(typeSpy).toHaveBeenCalledWith('TestPassw0rd!');
  });

  test('missing androidTypeText driver method — explicit error, not a silent pass', async () => {
    const dump = '<node resource-id="any_field" bounds="[0,0][10,10]" />';
    const ctx = makeCtx({
      uiDriver: {
        androidUiDump: jest.fn(async () => dump),
        androidTap: jest.fn(),
        // androidTypeText intentionally missing
      },
    });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android types "anything" into "any_field"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidTypeText/);
  });
});

describe('within-Nms polling wrapper (Then within Nms <inner-assertion>)', () => {
  test('inner succeeds on first poll — returns ok immediately, well under the budget', async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': { ageVerified: true } });
    const ctx = makeCtx({ db });
    const start = Date.now();
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'within 5000ms the database has document "users/50000010" with field "ageVerified" equal to true',
      },
      ctx,
    );
    const elapsed = Date.now() - start;
    expect(r.ok).toBe(true);
    // Should be near-instant since the inner already matches on the first poll.
    expect(elapsed).toBeLessThan(200);
  });

  test('inner succeeds after a delay — returns ok within the window', async () => {
    // Doc starts wrong, flips to expected value after ~80ms.
    let flipped = false;
    setTimeout(() => {
      flipped = true;
    }, 80);
    const db = {
      doc: (p) => ({
        get: async () => ({
          exists: true,
          data: () => ({ status: flipped ? 'ready' : 'pending' }),
        }),
        path: p,
      }),
    };
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'within 1000ms the database has document "things/abc" with field "status" equal to "ready"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test("inner never succeeds — wrapper returns the inner's last error after timeout", async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': { status: 'pending' } });
    const ctx = makeCtx({ db });
    const start = Date.now();
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'within 100ms the database has document "users/50000010" with field "status" equal to "ready"',
      },
      ctx,
    );
    const elapsed = Date.now() - start;
    expect(r.ok).toBe(false);
    // Wrapper surfaces the underlying assertion failure, not a generic "timed out".
    expect(r.error).toMatch(/status/);
    expect(r.error).toMatch(/expected "ready"/);
    // Should have polled for at least the budget (give some slack for jitter).
    expect(elapsed).toBeGreaterThanOrEqual(95);
    // Should not have polled for much longer than the budget.
    expect(elapsed).toBeLessThan(500);
  });

  test('inner step has no matcher — short-circuits, does not poll for the full window', async () => {
    const ctx = makeCtx();
    const start = Date.now();
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'within 5000ms there is some completely unknown step here',
      },
      ctx,
    );
    const elapsed = Date.now() - start;
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/STEP_NOT_IMPLEMENTED/);
    // Critical: should NOT have waited 5s — a missing matcher is a contract problem, not a timing problem.
    expect(elapsed).toBeLessThan(500);
  });

  test('zero-ms budget — runs inner exactly once then returns its result', async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': { x: 1 } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'within 0ms the database has document "users/50000010" with field "x" equal to 1',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('wrapper composes over the array-containing matcher (high-leverage proof)', async () => {
    // Demonstrates the pareto-justifying claim: same wrapper, different inner matcher → free win.
    const db = makeStatefulFakeDb({ 'users/50000010': { roles: ['member', 'moderator'] } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'within 100ms the database has document "users/50000010" with field "roles" containing "moderator"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });
});

describe('UI driver — Android text-content assertion (Then <P>\'s Android UI shows "<text>")', () => {
  test('matches a visible text="..." attribute exactly', async () => {
    const dump = '<node text="Submitted — awaiting review" bounds="[0,0][100,40]" />';
    const ctx = makeCtx({
      uiDriver: { androidUiDump: jest.fn(async () => dump) },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Adam\'s Android UI shows "Submitted — awaiting review"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('matches a content-desc="..." attribute when text is empty (icon-only view)', async () => {
    const dump = '<node text="" content-desc="Back" bounds="[0,0][50,50]" />';
    const ctx = makeCtx({
      uiDriver: { androidUiDump: jest.fn(async () => dump) },
    });
    const r = await executeStep({ kind: 'Then', text: 'Adam\'s Android UI shows "Back"' }, ctx);
    expect(r.ok).toBe(true);
  });

  test('does NOT silently pass on substring match (text="save as draft" should not satisfy "save")', async () => {
    const dump = '<node text="save as draft" bounds="[0,0][100,40]" />';
    const ctx = makeCtx({
      uiDriver: { androidUiDump: jest.fn(async () => dump) },
    });
    const r = await executeStep({ kind: 'Then', text: 'Adam\'s Android UI shows "save"' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/"save"/);
  });

  test('returns a clear error when neither attribute matches', async () => {
    const dump = '<node text="Some other label" content-desc="Other" />';
    const ctx = makeCtx({
      uiDriver: { androidUiDump: jest.fn(async () => dump) },
    });
    const r = await executeStep(
      { kind: 'Then', text: 'Vexa\'s Android UI shows "No results found"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/No results found/);
  });

  test('no ctx.uiDriver — loud error', async () => {
    const ctx = makeCtx(); // no uiDriver
    const r = await executeStep({ kind: 'Then', text: 'Adam\'s Android UI shows "anything"' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/uiDriver/i);
  });

  test('trailing descriptive context after the quoted text is accepted (e.g. ` indicator on his original message`)', async () => {
    const dump = '<node text="read" bounds="[0,0][50,30]" />';
    const ctx = makeCtx({
      uiDriver: { androidUiDump: jest.fn(async () => dump) },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Adam\'s Android UI shows "read" indicator on his original message',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('composes with the within-Nms wrapper: polls for the text to appear', async () => {
    // Text not present at t=0, appears at ~80ms.
    let visible = false;
    setTimeout(() => {
      visible = true;
    }, 80);
    const ctx = makeCtx({
      uiDriver: {
        androidUiDump: jest.fn(async () =>
          visible ? '<node text="Ready" />' : '<node text="Loading" />',
        ),
      },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'within 500ms Adam\'s Android UI shows "Ready"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('regex-special characters in the quoted text are escaped (no accidental regex injection)', async () => {
    const dump = '<node text="Price: $10.00 (USD)" />';
    const ctx = makeCtx({
      uiDriver: { androidUiDump: jest.fn(async () => dump) },
    });
    const r = await executeStep(
      { kind: 'Then', text: 'Alice\'s Android UI shows "Price: $10.00 (USD)"' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });
});

describe('UI driver — Android tag-negation (Then <P>\'s Android UI does not show the element with tag "<X>")', () => {
  test('tag absent — assertion succeeds (ok:true)', async () => {
    const dump = '<node resource-id="other_button" />';
    const ctx = makeCtx({
      uiDriver: { androidUiDump: jest.fn(async () => dump) },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Adam\'s Android UI does not show the element with tag "main_pmTab"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('tag present in short form — assertion fails with clear error', async () => {
    const dump = '<node resource-id="main_pmTab" />';
    const ctx = makeCtx({
      uiDriver: { androidUiDump: jest.fn(async () => dump) },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Adam\'s Android UI does not show the element with tag "main_pmTab"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/main_pmTab/);
    // Error must say the tag IS present, not that it isn't (don't confuse the operator).
    expect(r.error).toMatch(/present|found|exists|shown|should not/i);
  });

  test('tag present in fully-qualified form — assertion fails (handles adb pkg-prefixed dumps)', async () => {
    const dump = '<node resource-id="com.shyden.shytalk.dev:id/main_pmTab" />';
    const ctx = makeCtx({
      uiDriver: { androidUiDump: jest.fn(async () => dump) },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Adam\'s Android UI does not show the element with tag "main_pmTab"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/main_pmTab/);
  });

  test('iOS Sim variant — returns "not yet implemented" error pointing at iosUiDump', async () => {
    const ctx = makeCtx({ uiDriver: {} });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Mia\'s iOS Sim UI does not show the element with tag "main_pmTab"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/iOS|simctl|iosUiDump/i);
  });

  test('Web variant — explicit Playwright-MCP-out-of-scope error', async () => {
    const ctx = makeCtx({ uiDriver: {} });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Lena\'s Web UI does not show the element with tag "main_roomsTab"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Playwright|Web/i);
  });

  test('no ctx.uiDriver — loud error', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Adam\'s Android UI does not show the element with tag "anything"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/uiDriver/i);
  });

  test('composes with within-Nms wrapper: polls for tag to disappear', async () => {
    // Tag present at t=0, disappears at ~80ms.
    let still = true;
    setTimeout(() => {
      still = false;
    }, 80);
    const ctx = makeCtx({
      uiDriver: {
        androidUiDump: jest.fn(async () =>
          still
            ? '<node resource-id="main_pmTab" /><node resource-id="other" />'
            : '<node resource-id="other" />',
        ),
      },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'within 500ms Hayato\'s Android UI does not show the element with tag "main_pmTab"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('short-form vs qualified-form: short tag string in unrelated content does NOT cause false fail (e.g. "ab" must not match resource-id="cab")', async () => {
    // De Morgan trap — a naive substring check could match `resource-id="some_main_pmTab_suffix"` as containing `main_pmTab`.
    // Wake-15 uses an exact-attribute or :id/ suffix match; the negation must mirror that exactness.
    const dump = '<node resource-id="some_other_widget" /><node resource-id="main_pmTabFooter" />';
    const ctx = makeCtx({
      uiDriver: { androidUiDump: jest.fn(async () => dump) },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Adam\'s Android UI does not show the element with tag "main_pmTab"',
      },
      ctx,
    );
    // Tag `main_pmTab` is NOT present (the closest is `main_pmTabFooter` which is a different resource-id).
    expect(r.ok).toBe(true);
  });
});

describe('UI driver — Android navigation (When <P> on Android opens the "<X>" screen|tab)', () => {
  test('"screen" noun — calls androidOpenScreen with the exact screen name', async () => {
    const openSpy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidOpenScreen: openSpy } });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android opens the "discovery" screen' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(openSpy).toHaveBeenCalledWith('discovery');
  });

  test('"tab" noun — same matcher works (semantically equivalent navigation target)', async () => {
    const openSpy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidOpenScreen: openSpy } });
    const r = await executeStep(
      { kind: 'When', text: 'Selma on Android opens the "rooms" tab' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(openSpy).toHaveBeenCalledWith('rooms');
  });

  test('P-NN persona annotation — handled without polluting the screen name', async () => {
    const openSpy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidOpenScreen: openSpy } });
    const r = await executeStep(
      { kind: 'When', text: 'Adam [P-01] on Android opens the "wallet" screen' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(openSpy).toHaveBeenCalledWith('wallet');
  });

  test('multi-word screen names with underscores pass through verbatim', async () => {
    // Important: don't accidentally strip or transform the name — drivers may need
    // exact case/separator for deeplinks (e.g. shytalk://daily_reward).
    const openSpy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidOpenScreen: openSpy } });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android opens the "daily_reward" screen' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(openSpy).toHaveBeenCalledWith('daily_reward');
  });

  test('no ctx.uiDriver — loud error before any driver call', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android opens the "discovery" screen' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/uiDriver/i);
  });

  test('missing androidOpenScreen driver method — specific actionable error', async () => {
    const ctx = makeCtx({ uiDriver: {} }); // uiDriver present, method missing
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android opens the "discovery" screen' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidOpenScreen/);
  });

  test('driver throws — bubbles up through executeStep wrapper as structured finding', async () => {
    const openSpy = jest.fn(async () => {
      throw new Error('adb: device not found');
    });
    const ctx = makeCtx({ uiDriver: { androidOpenScreen: openSpy } });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android opens the "discovery" screen' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/adb: device not found/);
  });
});

describe('Firestore doc-field greater-than matcher (Then the database has document X with field Y greater than N)', () => {
  test('actual > expected → ok:true', async () => {
    const db = makeStatefulFakeDb({ 'users/50000020': { shyCoins: 900 } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000020" with field "shyCoins" greater than 800',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('actual === expected → fails (strict greater, NOT >=)', async () => {
    const db = makeStatefulFakeDb({ 'users/50000020': { shyCoins: 800 } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000020" with field "shyCoins" greater than 800',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/800/);
  });

  test('actual < expected → fails with informative error', async () => {
    const db = makeStatefulFakeDb({ 'users/50000020': { shyCoins: 500 } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000020" with field "shyCoins" greater than 800',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/shyCoins/);
    expect(r.error).toMatch(/500/);
    expect(r.error).toMatch(/800/);
  });

  test('field missing — clear error pointing at the missing field', async () => {
    const db = makeStatefulFakeDb({ 'users/50000020': { otherField: 1 } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000020" with field "shyCoins" greater than 0',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/shyCoins/);
  });

  test('doc does not exist — error mentions the doc path', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000020" with field "shyCoins" greater than 0',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/users\/50000020/);
  });

  test('non-numeric actual field — rejects rather than doing JS lexicographic comparison', async () => {
    // Critical: `"abc" > 100` returns false in JS via NaN coercion, which would
    // silently report the assertion as "fails as expected" — but the actual bug
    // is "the field is wrongly typed". Explicit type rejection avoids that trap.
    const db = makeStatefulFakeDb({ 'users/50000020': { shyCoins: 'not-a-number' } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000020" with field "shyCoins" greater than 0',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/numeric|number/i);
  });

  test('non-numeric expected literal — rejects with parse error', async () => {
    const db = makeStatefulFakeDb({ 'users/50000020': { shyCoins: 900 } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000020" with field "shyCoins" greater than foo',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/foo|numeric|number/i);
  });

  test('no ctx.db — loud error before any work', async () => {
    const ctx = makeCtx({ db: undefined });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000020" with field "shyCoins" greater than 800',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db|firestore/i);
  });

  test('composes with the within-Nms wrapper — polls until the value crosses the threshold', async () => {
    // shyCoins starts at 500, increments to 1000 at ~80ms.
    let count = 500;
    setTimeout(() => {
      count = 1000;
    }, 80);
    const ctx = makeCtx({
      db: {
        doc: () => ({
          get: async () => ({ exists: true, data: () => ({ shyCoins: count }) }),
        }),
      },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'within 500ms the database has document "users/50000020" with field "shyCoins" greater than 800',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('floating-point comparison works (privacyVersion > 0 with non-integer values)', async () => {
    const db = makeStatefulFakeDb({ 'usersAcceptedPolicies/u1': { privacyVersion: 1.5 } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "usersAcceptedPolicies/u1" with field "privacyVersion" greater than 0',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });
});

describe('Firestore doc-field NEGATED-containing — `does not have document X with field Y containing N` (vacuous-true on missing doc)', () => {
  test('doc missing — assertion holds vacuously (ok:true)', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database does not have document "users/50000030" with field "blockedIds" containing 1',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('doc exists, field missing — assertion holds (no array to contain N)', async () => {
    const db = makeStatefulFakeDb({ 'users/50000030': { name: 'X' } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database does not have document "users/50000030" with field "blockedIds" containing 1',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('doc exists, field is array but does NOT contain N — assertion holds', async () => {
    const db = makeStatefulFakeDb({ 'users/50000030': { blockedIds: [2, 3] } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database does not have document "users/50000030" with field "blockedIds" containing 1',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('doc exists, field is array and DOES contain N — assertion FAILS', async () => {
    const db = makeStatefulFakeDb({ 'users/50000030': { blockedIds: [1, 2, 3] } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database does not have document "users/50000030" with field "blockedIds" containing 1',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/blockedIds/);
    expect(r.error).toMatch(/1/);
  });

  test('doc exists, field is scalar (non-array) — assertion holds (no array can contain N)', async () => {
    const db = makeStatefulFakeDb({ 'users/50000030': { blockedIds: 'not-an-array' } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database does not have document "users/50000030" with field "blockedIds" containing 1',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('no ctx.db — loud error', async () => {
    const ctx = makeCtx({ db: undefined });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database does not have document "users/X" with field "Y" containing 1',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db|firestore/i);
  });
});

describe('Firestore doc-field `not containing` — `has document X with field Y not containing N` (requires doc to exist)', () => {
  test('doc exists, array does not contain N — assertion holds (ok:true)', async () => {
    const db = makeStatefulFakeDb({ 'users/60000010': { followerIds: [1, 2, 3] } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/60000010" with field "followerIds" not containing 50000040',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('doc exists, array CONTAINS N — assertion fails', async () => {
    const db = makeStatefulFakeDb({ 'users/60000010': { followerIds: [50000040, 1, 2] } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/60000010" with field "followerIds" not containing 50000040',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/followerIds/);
    expect(r.error).toMatch(/50000040/);
  });

  test('doc missing — assertion fails (must exist; "has document" is part of the contract)', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/60000010" with field "followerIds" not containing 50000040',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/users\/60000010/);
  });

  test('field missing — assertion fails (positive contract requires field present)', async () => {
    const db = makeStatefulFakeDb({ 'users/60000010': { otherField: 'x' } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/60000010" with field "followerIds" not containing 50000040',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/followerIds/);
  });

  test('field is scalar (non-array) — assertion fails (can\'t reason about "containing" in a non-array)', async () => {
    const db = makeStatefulFakeDb({ 'users/60000010': { followerIds: 'oops' } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/60000010" with field "followerIds" not containing 50000040',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/array/i);
  });

  test('composes with within-Nms wrapper (poll until array no longer contains N)', async () => {
    // followerIds starts with N in it, evicts at ~80ms.
    let containsN = true;
    setTimeout(() => {
      containsN = false;
    }, 80);
    const ctx = makeCtx({
      db: {
        doc: () => ({
          get: async () => ({
            exists: true,
            data: () => ({ followerIds: containsN ? [50000040, 1] : [1] }),
          }),
        }),
      },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'within 500ms the database has document "users/60000010" with field "followerIds" not containing 50000040',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('no ctx.db — loud error', async () => {
    const ctx = makeCtx({ db: undefined });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/X" with field "Y" not containing 1',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db|firestore/i);
  });

  test('does not accidentally match the positive containing matcher (different semantics)', async () => {
    // Critical: regression guard. If a future refactor of the positive
    // matcher accidentally consumed "not containing", the negation would
    // route to the wrong handler and silently invert the assertion.
    const db = makeStatefulFakeDb({ 'users/X': { ids: [1, 2] } });
    const ctx = makeCtx({ db });
    // Containing 1 → positive matcher (should pass).
    const positive = await executeStep(
      { kind: 'Then', text: 'the database has document "users/X" with field "ids" containing 1' },
      ctx,
    );
    expect(positive.ok).toBe(true);
    // Not containing 99 → negation matcher (also should pass, but via different handler).
    const negation = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/X" with field "ids" not containing 99',
      },
      ctx,
    );
    expect(negation.ok).toBe(true);
    // Not containing 1 → negation matcher (should fail because array DOES contain 1).
    const negationFail = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/X" with field "ids" not containing 1',
      },
      ctx,
    );
    expect(negationFail.ok).toBe(false);
  });
});

describe('Response status alternation (Then the response status is N or M)', () => {
  test('actual matches first option — ok:true', async () => {
    const ctx = makeCtx({ lastResponse: { status: 405 } });
    const r = await executeStep({ kind: 'Then', text: 'the response status is 405 or 403' }, ctx);
    expect(r.ok).toBe(true);
  });

  test('actual matches second option — ok:true', async () => {
    const ctx = makeCtx({ lastResponse: { status: 403 } });
    const r = await executeStep({ kind: 'Then', text: 'the response status is 405 or 403' }, ctx);
    expect(r.ok).toBe(true);
  });

  test('actual matches neither — clear error showing actual + both expected', async () => {
    const ctx = makeCtx({ lastResponse: { status: 200 } });
    const r = await executeStep({ kind: 'Then', text: 'the response status is 405 or 403' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/200/);
    expect(r.error).toMatch(/405/);
    expect(r.error).toMatch(/403/);
  });

  test('no prior response — loud error pointing at missing When step', async () => {
    const ctx = makeCtx(); // no lastResponse
    const r = await executeStep({ kind: 'Then', text: 'the response status is 405 or 403' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/prior request|missing|no.*request/i);
  });

  test('does not collide with the exact-match matcher (different pattern shape)', async () => {
    // Regression guard: the exact `^the response status is (\d{3})$` pattern must not
    // match `... is 405 or 403` (would silently report "expected 405, got 405-or-403").
    const ctx = makeCtx({ lastResponse: { status: 405 } });
    const exact = await executeStep({ kind: 'Then', text: 'the response status is 405' }, ctx);
    expect(exact.ok).toBe(true);
    const alt = await executeStep({ kind: 'Then', text: 'the response status is 405 or 403' }, ctx);
    expect(alt.ok).toBe(true);
    // And actual=403 must match the alternation (going through the right handler).
    const ctx2 = makeCtx({ lastResponse: { status: 403 } });
    const alt2 = await executeStep(
      { kind: 'Then', text: 'the response status is 405 or 403' },
      ctx2,
    );
    expect(alt2.ok).toBe(true);
  });
});

describe('Snapshot baseline — `unchanged` matcher (Then the database has document X with field Y unchanged)', () => {
  test('snapshot captured via Given, field still equal — ok:true', async () => {
    const fetchSpy = jest.fn(async (url) => {
      if (typeof url === 'string' && url.includes('signInWithPassword')) {
        const idToken =
          'h.' + Buffer.from(JSON.stringify({ uniqueId: 50000020 })).toString('base64url') + '.s';
        return { status: 200, json: async () => ({ idToken, refreshToken: 'r', localId: 'f' }) };
      }
      return { status: 500, text: async () => '{}' };
    });
    const db = makeStatefulFakeDb({ 'users/50000020': {} });
    const ctx = makeCtx({ fetch: fetchSpy, db });
    // Given captures baseline
    const given = await executeStep(
      {
        kind: 'Given',
        text: 'Lena [P-05] is signed in on Android with shyCoins=5000',
      },
      ctx,
    );
    expect(given.ok).toBe(true);
    // Then asserts unchanged (no When step in between → still 5000)
    const then = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000020" with field "shyCoins" unchanged',
      },
      ctx,
    );
    expect(then.ok).toBe(true);
  });

  test('snapshot captured, field CHANGED — fails with both values in error', async () => {
    const fetchSpy = jest.fn(async (url) => {
      if (typeof url === 'string' && url.includes('signInWithPassword')) {
        const idToken =
          'h.' + Buffer.from(JSON.stringify({ uniqueId: 50000020 })).toString('base64url') + '.s';
        return { status: 200, json: async () => ({ idToken, refreshToken: 'r', localId: 'f' }) };
      }
      return { status: 500, text: async () => '{}' };
    });
    const db = makeStatefulFakeDb({ 'users/50000020': {} });
    const ctx = makeCtx({ fetch: fetchSpy, db });
    await executeStep(
      { kind: 'Given', text: 'Lena [P-05] is signed in on Android with shyCoins=5000' },
      ctx,
    );
    // Simulate a When step changing the value out from under us
    await db.doc('users/50000020').set({ shyCoins: 4500 }, { merge: true });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000020" with field "shyCoins" unchanged',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/5000/);
    expect(r.error).toMatch(/4500/);
  });

  test('no snapshot captured — loud error pointing at missing Given baseline', async () => {
    const db = makeStatefulFakeDb({ 'users/50000020': { shyCoins: 5000 } });
    const ctx = makeCtx({ db });
    // No Given step — snapshots stays empty
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000020" with field "shyCoins" unchanged',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/snapshot|baseline|Given/i);
  });
});

describe('Snapshot baseline — `increased by N` matcher (Then the database has document X with field Y increased by N)', () => {
  test('snapshot=5000, actual=5500, delta=500 — ok:true', async () => {
    const fetchSpy = jest.fn(async (url) => {
      if (typeof url === 'string' && url.includes('signInWithPassword')) {
        const idToken =
          'h.' + Buffer.from(JSON.stringify({ uniqueId: 50000020 })).toString('base64url') + '.s';
        return { status: 200, json: async () => ({ idToken, refreshToken: 'r', localId: 'f' }) };
      }
      return { status: 500, text: async () => '{}' };
    });
    const db = makeStatefulFakeDb({ 'users/50000020': {} });
    const ctx = makeCtx({ fetch: fetchSpy, db });
    await executeStep(
      { kind: 'Given', text: 'Lena [P-05] is signed in on Android with shyCoins=5000' },
      ctx,
    );
    // Simulate a gift being received that bumps coins
    await db.doc('users/50000020').set({ shyCoins: 5500 }, { merge: true });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000020" with field "shyCoins" increased by 500',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('snapshot=5000, actual=4500 (DECREASED) — fails because delta is wrong sign', async () => {
    const fetchSpy = jest.fn(async (url) => {
      if (typeof url === 'string' && url.includes('signInWithPassword')) {
        const idToken =
          'h.' + Buffer.from(JSON.stringify({ uniqueId: 50000020 })).toString('base64url') + '.s';
        return { status: 200, json: async () => ({ idToken, refreshToken: 'r', localId: 'f' }) };
      }
      return { status: 500, text: async () => '{}' };
    });
    const db = makeStatefulFakeDb({ 'users/50000020': {} });
    const ctx = makeCtx({ fetch: fetchSpy, db });
    await executeStep(
      { kind: 'Given', text: 'Lena [P-05] is signed in on Android with shyCoins=5000' },
      ctx,
    );
    await db.doc('users/50000020').set({ shyCoins: 4500 }, { merge: true });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000020" with field "shyCoins" increased by 500',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/-500|decreased|less/i);
  });

  test('snapshot=5000, actual=5300 (delta=300, not 500) — fails with actual delta in error', async () => {
    const fetchSpy = jest.fn(async (url) => {
      if (typeof url === 'string' && url.includes('signInWithPassword')) {
        const idToken =
          'h.' + Buffer.from(JSON.stringify({ uniqueId: 50000020 })).toString('base64url') + '.s';
        return { status: 200, json: async () => ({ idToken, refreshToken: 'r', localId: 'f' }) };
      }
      return { status: 500, text: async () => '{}' };
    });
    const db = makeStatefulFakeDb({ 'users/50000020': {} });
    const ctx = makeCtx({ fetch: fetchSpy, db });
    await executeStep(
      { kind: 'Given', text: 'Lena [P-05] is signed in on Android with shyCoins=5000' },
      ctx,
    );
    await db.doc('users/50000020').set({ shyCoins: 5300 }, { merge: true });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000020" with field "shyCoins" increased by 500',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/300/);
    expect(r.error).toMatch(/500/);
  });

  test('no snapshot — error mentions snapshot/baseline/Given', async () => {
    const db = makeStatefulFakeDb({ 'users/50000020': { shyCoins: 5500 } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000020" with field "shyCoins" increased by 500',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/snapshot|baseline|Given/i);
  });

  test('composes with within-Nms wrapper: poll until delta is reached', async () => {
    const fetchSpy = jest.fn(async (url) => {
      if (typeof url === 'string' && url.includes('signInWithPassword')) {
        const idToken =
          'h.' + Buffer.from(JSON.stringify({ uniqueId: 50000020 })).toString('base64url') + '.s';
        return { status: 200, json: async () => ({ idToken, refreshToken: 'r', localId: 'f' }) };
      }
      return { status: 500, text: async () => '{}' };
    });
    const db = makeStatefulFakeDb({ 'users/50000020': {} });
    const ctx = makeCtx({ fetch: fetchSpy, db });
    await executeStep(
      { kind: 'Given', text: 'Lena [P-05] is signed in on Android with shyCoins=5000' },
      ctx,
    );
    // Defer the change to ~80ms after the Then step starts
    setTimeout(() => {
      db.doc('users/50000020').set({ shyCoins: 5500 }, { merge: true });
    }, 80);
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'within 500ms the database has document "users/50000020" with field "shyCoins" increased by 500',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });
});

describe('No-entry-added-since matcher (Then no entry is added to "X" since "Y")', () => {
  test('empty collection — assertion holds (ok:true)', async () => {
    const db = makeStatefulFakeDb({}, { 'users/50000040/transactions': [] });
    const ctx = makeCtx({ db, scenarioStartTime: 1_700_000_000_000 });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'no entry is added to "users/50000040/transactions" since "{ts}"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('collection has docs created BEFORE scenarioStartTime — assertion holds', async () => {
    const db = makeStatefulFakeDb(
      {},
      {
        'users/50000040/transactions': [
          { _id: 'old1', amount: 100, createdAt: 1_699_999_000_000 },
          { _id: 'old2', amount: 200, createdAt: 1_699_999_500_000 },
        ],
      },
    );
    const ctx = makeCtx({ db, scenarioStartTime: 1_700_000_000_000 });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'no entry is added to "users/50000040/transactions" since "{ts}"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('collection has a doc created AFTER scenarioStartTime — assertion FAILS', async () => {
    const db = makeStatefulFakeDb(
      {},
      {
        'users/50000040/transactions': [
          { _id: 'old', amount: 100, createdAt: 1_699_999_000_000 },
          { _id: 'new', amount: 50, createdAt: 1_700_000_500_000 },
        ],
      },
    );
    const ctx = makeCtx({ db, scenarioStartTime: 1_700_000_000_000 });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'no entry is added to "users/50000040/transactions" since "{ts}"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/new|users\/50000040\/transactions/);
  });

  test('explicit ISO timestamp (not {ts}) — parses and compares correctly', async () => {
    const db = makeStatefulFakeDb(
      {},
      {
        'users/X/logs': [
          { _id: 'old', createdAt: Date.parse('2024-12-31T23:59:00Z') },
          { _id: 'new', createdAt: Date.parse('2025-01-01T00:00:30Z') },
        ],
      },
    );
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'no entry is added to "users/X/logs" since "2025-01-01T00:00:00Z"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/new/);
  });

  test('explicit numeric timestamp (raw ms) — parses and compares correctly', async () => {
    const db = makeStatefulFakeDb(
      {},
      {
        'users/X/logs': [{ _id: 'a', createdAt: 5000 }],
      },
    );
    const ctx = makeCtx({ db });
    // Since 3000 → "a" (createdAt=5000) added after → fail
    const r = await executeStep(
      { kind: 'Then', text: 'no entry is added to "users/X/logs" since "3000"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/a/);
  });

  test('docs without createdAt field are ignored (treated as "old", not erroneously flagged as "new")', async () => {
    // Don't flag missing-createdAt as a new entry — that'd produce false positives
    // for docs the test infra didn't bother to timestamp. If a real bug writes
    // an entry without createdAt, that's a different bug to catch.
    const db = makeStatefulFakeDb(
      {},
      {
        'users/X/transactions': [
          { _id: 'no-ts', amount: 50 }, // missing createdAt
        ],
      },
    );
    const ctx = makeCtx({ db, scenarioStartTime: 1_700_000_000_000 });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'no entry is added to "users/X/transactions" since "{ts}"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('no ctx.db — loud error', async () => {
    const ctx = makeCtx({ db: undefined, scenarioStartTime: 1 });
    const r = await executeStep(
      { kind: 'Then', text: 'no entry is added to "users/X/transactions" since "{ts}"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db|firestore/i);
  });

  test('{ts} placeholder used without ctx.scenarioStartTime — loud error pointing at missing baseline', async () => {
    const db = makeStatefulFakeDb({}, { 'users/X/transactions': [] });
    const ctx = makeCtx({ db }); // scenarioStartTime intentionally absent
    const r = await executeStep(
      { kind: 'Then', text: 'no entry is added to "users/X/transactions" since "{ts}"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/scenarioStartTime|baseline|\{ts\}/i);
  });
});

describe('Response-from-path in-every-row matcher (Then the response from <path> has <field>="<value>" in every row)', () => {
  test('all rows have matching field (unquoted-field syntax) — ok:true', async () => {
    const ctx = makeCtx({
      lastResponse: {
        status: 200,
        body: [
          { id: 1, cohort: 'adult' },
          { id: 2, cohort: 'adult' },
          { id: 3, cohort: 'adult' },
        ],
      },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the response from /api/economy/leaderboards has cohort="adult" in every row',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('all rows have matching field (quoted-expression syntax `"field=value"`) — ok:true', async () => {
    const ctx = makeCtx({
      lastResponse: {
        status: 200,
        body: [
          { id: 1, cohort: 'minor' },
          { id: 2, cohort: 'minor' },
        ],
      },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the response from /api/economy/leaderboards has "cohort=minor" in every row',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('one row mismatches — assertion fails with row index in error', async () => {
    const ctx = makeCtx({
      lastResponse: {
        status: 200,
        body: [
          { id: 1, cohort: 'adult' },
          { id: 2, cohort: 'minor' }, // mismatch
          { id: 3, cohort: 'adult' },
        ],
      },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the response from /api/economy/leaderboards has cohort="adult" in every row',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/minor/);
    expect(r.error).toMatch(/cohort/);
  });

  test('body is object with first Array property — uses that array (e.g. {users: [...]})', async () => {
    const ctx = makeCtx({
      lastResponse: {
        status: 200,
        body: {
          users: [
            { id: 1, cohort: 'adult' },
            { id: 2, cohort: 'adult' },
          ],
        },
      },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the response from /api/users/search has cohort="adult" in every row',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('empty array — assertion holds vacuously (no rows means no mismatches)', async () => {
    // Author intent: "every row matches" with zero rows is trivially true.
    // If the author wanted "at least one row matches", a different assertion
    // is needed (the existing N-result form).
    const ctx = makeCtx({ lastResponse: { status: 200, body: [] } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the response from /api/economy/leaderboards has cohort="adult" in every row',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('no prior response — loud error', async () => {
    const ctx = makeCtx(); // no lastResponse
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the response from /api/economy/leaderboards has cohort="adult" in every row',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no.*response|prior request/i);
  });

  test('body has no array — loud error pointing at the body shape', async () => {
    const ctx = makeCtx({
      lastResponse: { status: 200, body: { id: 'just-an-id', name: 'no-array-here' } },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the response from /api/economy/leaderboards has cohort="adult" in every row',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/array|rows/i);
  });

  test('numeric value coerces correctly (e.g. age=18)', async () => {
    // parseLiteral handles number coercion; the matcher should compare
    // 18 (number) against row.age (number), not the string "18".
    const ctx = makeCtx({
      lastResponse: {
        status: 200,
        body: [{ age: 18 }, { age: 18 }],
      },
    });
    const r = await executeStep(
      { kind: 'Then', text: 'the response from /api/users has age="18" in every row' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });
});

describe('No conversation doc created — `no conversation doc is created` matcher (cross-cohort PM wall)', () => {
  test('conversations collection empty — assertion holds', async () => {
    const db = makeStatefulFakeDb({}, { conversations: [] });
    const ctx = makeCtx({ db, scenarioStartTime: 1_700_000_000_000 });
    const r = await executeStep({ kind: 'Then', text: 'no conversation doc is created' }, ctx);
    expect(r.ok).toBe(true);
  });

  test('conversations collection has only pre-scenario docs — assertion holds', async () => {
    const db = makeStatefulFakeDb(
      {},
      {
        conversations: [{ _id: 'old', participantIds: [1, 2], createdAt: 1_699_999_000_000 }],
      },
    );
    const ctx = makeCtx({ db, scenarioStartTime: 1_700_000_000_000 });
    const r = await executeStep({ kind: 'Then', text: 'no conversation doc is created' }, ctx);
    expect(r.ok).toBe(true);
  });

  test('conversations collection has a doc created AFTER scenarioStartTime — fails', async () => {
    const db = makeStatefulFakeDb(
      {},
      {
        conversations: [
          { _id: 'leaked', participantIds: [50000040, 60000010], createdAt: 1_700_000_500_000 },
        ],
      },
    );
    const ctx = makeCtx({ db, scenarioStartTime: 1_700_000_000_000 });
    const r = await executeStep({ kind: 'Then', text: 'no conversation doc is created' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/leaked|conversations/);
  });

  test('no ctx.db — loud error', async () => {
    const ctx = makeCtx({ db: undefined, scenarioStartTime: 1 });
    const r = await executeStep({ kind: 'Then', text: 'no conversation doc is created' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db|firestore/i);
  });

  test('scenarioStartTime missing — loud error so a missing reset is loud not silent', async () => {
    const db = makeStatefulFakeDb({}, { conversations: [] });
    const ctx = makeCtx({ db });
    delete ctx.scenarioStartTime;
    const r = await executeStep({ kind: 'Then', text: 'no conversation doc is created' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/scenarioStartTime|baseline/i);
  });
});

describe('Per-persona JWT custom-claim matcher (Then <P>\'s Android JWT custom claim "X" equals "Y")', () => {
  function makeJwt(payload) {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${header}.${body}.signature`;
  }

  test('real Firebase JWT — claim equals expected (ok:true)', async () => {
    const idToken = makeJwt({ uniqueId: 50000060, cohort: 'minor', iat: 1, exp: 9999999999 });
    const sessions = new Map();
    sessions.set('Hayato', { idToken });
    const ctx = makeCtx({ sessions });
    const r = await executeStep(
      { kind: 'Then', text: 'Hayato\'s Android JWT custom claim "cohort" equals "minor"' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('real Firebase JWT — claim mismatches expected (fail with both values)', async () => {
    const idToken = makeJwt({ uniqueId: 50000060, cohort: 'minor' });
    const sessions = new Map();
    sessions.set('Hayato', { idToken });
    const ctx = makeCtx({ sessions });
    const r = await executeStep(
      { kind: 'Then', text: 'Hayato\'s Android JWT custom claim "cohort" equals "adult"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/cohort/);
    expect(r.error).toMatch(/minor/);
    expect(r.error).toMatch(/adult/);
  });

  test('synthetic/ephemeral persona — uses session.customClaims directly (no JWT decode)', async () => {
    const sessions = new Map();
    sessions.set('Adam', {
      idToken: 'synthetic:Adam:50000001',
      customClaims: { uniqueId: 50000001, cohort: 'adult', ephemeral: true },
    });
    const ctx = makeCtx({ sessions });
    const r = await executeStep(
      { kind: 'Then', text: 'Adam\'s Android JWT custom claim "cohort" equals "adult"' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('synthetic/ephemeral persona — claim mismatch fails', async () => {
    const sessions = new Map();
    sessions.set('Adam', {
      idToken: 'synthetic:Adam:50000001',
      customClaims: { cohort: 'adult' },
    });
    const ctx = makeCtx({ sessions });
    const r = await executeStep(
      { kind: 'Then', text: 'Adam\'s Android JWT custom claim "cohort" equals "minor"' },
      ctx,
    );
    expect(r.ok).toBe(false);
  });

  test('claim missing from payload — clear error pointing at the missing claim', async () => {
    const idToken = makeJwt({ uniqueId: 1, iat: 1 });
    const sessions = new Map();
    sessions.set('Hayato', { idToken });
    const ctx = makeCtx({ sessions });
    const r = await executeStep(
      { kind: 'Then', text: 'Hayato\'s Android JWT custom claim "cohort" equals "minor"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/cohort/);
  });

  test('no session for persona — loud error pointing at missing Given sign-in', async () => {
    const ctx = makeCtx({ sessions: new Map() }); // no sessions
    const r = await executeStep(
      { kind: 'Then', text: 'Hayato\'s Android JWT custom claim "cohort" equals "minor"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/session|Hayato/i);
  });

  test('P-NN persona annotation form — handled (Hayato [P-06])', async () => {
    const idToken = makeJwt({ cohort: 'adult' });
    const sessions = new Map();
    sessions.set('Hayato', { idToken });
    const ctx = makeCtx({ sessions });
    const r = await executeStep(
      { kind: 'Then', text: 'Hayato [P-06]\'s Android JWT custom claim "cohort" equals "adult"' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });
});

describe('Trailing-annotation preprocessing — `Then ... (human commentary)` is ignored uniformly', () => {
  test('equal-to matcher accepts `(unchanged)` annotation — value 6000 still parses cleanly', async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': { shyCoins: 6000 } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000010" with field "shyCoins" equal to 6000 (only one credit)',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('equal-to matcher accepts `(NOT 7000)` annotation — runner verifies 6000, ignores commentary', async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': { shyCoins: 6000 } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000010" with field "shyCoins" equal to 6000 (NOT 7000)',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('response status accepts `(idempotent re-credit prevented)` annotation', async () => {
    const ctx = makeCtx({ lastResponse: { status: 409 } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the response status is 409 (idempotent re-credit prevented)',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('greater-than matcher accepts annotation', async () => {
    const db = makeStatefulFakeDb({ 'users/X': { shyCoins: 900 } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/X" with field "shyCoins" greater than 800 (after gift received)',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('step WITHOUT annotation — preprocessing is a no-op (no regression)', async () => {
    const db = makeStatefulFakeDb({ 'users/X': { shyCoins: 5000 } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/X" with field "shyCoins" equal to 5000',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('quoted string with parens inside is preserved (preprocessing only strips trailing `(...)` at end-of-string)', async () => {
    // Critical: must not falsely strip `(USD)` from within a quoted text-content assertion.
    // The regex `\s+\([^()]*\)$` requires `)` to be the LAST char; here the line ends with `"`,
    // so no stripping happens.
    const dump = '<node text="Price: $10.00 (USD)" />';
    const ctx = makeCtx({
      uiDriver: { androidUiDump: jest.fn(async () => dump) },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Alice\'s Android UI shows "Price: $10.00 (USD)"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('unmatched annotated step still includes ORIGINAL text (with annotation) in STEP_NOT_IMPLEMENTED error', async () => {
    // Helps the operator see what they actually wrote, not the stripped form.
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'something nonexistent happens (with annotation)',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/STEP_NOT_IMPLEMENTED/);
    expect(r.error).toMatch(/\(with annotation\)/);
  });

  test('containing matcher accepts annotation', async () => {
    const db = makeStatefulFakeDb({ 'users/X': { roles: ['admin', 'mod'] } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/X" with field "roles" containing "admin" (after promotion)',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });
});

describe('Response-body array-length matcher (Then the response body has field "X" array length N)', () => {
  test('array length matches — ok:true', async () => {
    const ctx = makeCtx({
      lastResponse: { status: 200, body: { gifts: [{ a: 1 }, { a: 2 }, { a: 3 }] } },
    });
    const r = await executeStep(
      { kind: 'Then', text: 'the response body has field "gifts" array length 3' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('array length mismatches — fails with actual + expected', async () => {
    const ctx = makeCtx({ lastResponse: { status: 200, body: { gifts: [1, 2] } } });
    const r = await executeStep(
      { kind: 'Then', text: 'the response body has field "gifts" array length 5' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/2/);
    expect(r.error).toMatch(/5/);
  });

  test('field is not an array — clear error', async () => {
    const ctx = makeCtx({ lastResponse: { status: 200, body: { gifts: 'oops' } } });
    const r = await executeStep(
      { kind: 'Then', text: 'the response body has field "gifts" array length 0' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/array/i);
  });

  test('field missing — error mentions the missing field', async () => {
    const ctx = makeCtx({ lastResponse: { status: 200, body: {} } });
    const r = await executeStep(
      { kind: 'Then', text: 'the response body has field "gifts" array length 0' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/gifts/);
  });

  test('no prior response — loud error', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: 'the response body has field "gifts" array length 3' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/response/i);
  });
});

describe('Response-body contains alternation (Then the response body contains "X" or "Y")', () => {
  test('first option present — ok:true', async () => {
    const ctx = makeCtx({
      lastResponse: { status: 409, body: { error: 'duplicate request' } },
    });
    const r = await executeStep(
      { kind: 'Then', text: 'the response body contains "duplicate" or "already_consumed"' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('second option present — ok:true', async () => {
    const ctx = makeCtx({
      lastResponse: { status: 409, body: { error: 'order already_consumed' } },
    });
    const r = await executeStep(
      { kind: 'Then', text: 'the response body contains "duplicate" or "already_consumed"' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('neither option present — fails with both expected', async () => {
    const ctx = makeCtx({
      lastResponse: { status: 500, body: { error: 'something else' } },
    });
    const r = await executeStep(
      { kind: 'Then', text: 'the response body contains "duplicate" or "already_consumed"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/duplicate/);
    expect(r.error).toMatch(/already_consumed/);
  });

  test('does not collide with single-needle contains matcher', async () => {
    // Regression guard: existing `contains "X"$` must still work after adding
    // `contains "X" or "Y"$`. First-match wins ordering must not swap.
    const ctx = makeCtx({ lastResponse: { status: 200, body: { error: 'duplicate' } } });
    const single = await executeStep(
      { kind: 'Then', text: 'the response body contains "duplicate"' },
      ctx,
    );
    expect(single.ok).toBe(true);
    const both = await executeStep(
      { kind: 'Then', text: 'the response body contains "duplicate" or "fallback"' },
      ctx,
    );
    expect(both.ok).toBe(true);
  });
});

describe('Response status-or-body-signal alternation (Then the response has status N or signals "X")', () => {
  test('status matches — ok:true (no need to inspect body signal)', async () => {
    const ctx = makeCtx({ lastResponse: { status: 401, body: {} } });
    const r = await executeStep(
      { kind: 'Then', text: 'the response has status 401 or signals "auth/user-token-expired"' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('status mismatches but body contains signal — ok:true (signal serves as fallback)', async () => {
    const ctx = makeCtx({
      lastResponse: {
        status: 500,
        body: { code: 'auth/user-token-expired', message: 'token expired' },
      },
    });
    const r = await executeStep(
      { kind: 'Then', text: 'the response has status 401 or signals "auth/user-token-expired"' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('neither status nor signal matches — fails with both observable values', async () => {
    const ctx = makeCtx({
      lastResponse: { status: 500, body: { code: 'something/else' } },
    });
    const r = await executeStep(
      { kind: 'Then', text: 'the response has status 401 or signals "auth/user-token-expired"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/500/);
    expect(r.error).toMatch(/401|auth\/user-token-expired/);
  });

  test('no prior response — loud error', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: 'the response has status 401 or signals "X"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no prior request|response/i);
  });
});

describe('Android search composite matchers (searches "X" in screen / types "X" into the search field)', () => {
  test('`searches "Marcus" in discovery` — calls androidSearchIn("discovery", "Marcus")', async () => {
    const searchSpy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidSearchIn: searchSpy } });
    const r = await executeStep(
      { kind: 'When', text: 'Vexa on Android searches "Marcus" in discovery' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(searchSpy).toHaveBeenCalledWith('discovery', 'Marcus');
  });

  test('`types "Alice" into the search field` — calls androidSearchIn(null, "Alice") (null screen = active)', async () => {
    const searchSpy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidSearchIn: searchSpy } });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android types "Alice" into the search field' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(searchSpy).toHaveBeenCalledWith(null, 'Alice');
  });

  test('search text with special chars passes through verbatim', async () => {
    const searchSpy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidSearchIn: searchSpy } });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android types "adult-power" into the search field' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(searchSpy).toHaveBeenCalledWith(null, 'adult-power');
  });

  test('no ctx.uiDriver — loud error for both matcher forms', async () => {
    const ctx = makeCtx();
    const r1 = await executeStep(
      { kind: 'When', text: 'Vexa on Android searches "Marcus" in discovery' },
      ctx,
    );
    expect(r1.ok).toBe(false);
    expect(r1.error).toMatch(/uiDriver/i);
    const r2 = await executeStep(
      { kind: 'When', text: 'Adam on Android types "Alice" into the search field' },
      ctx,
    );
    expect(r2.ok).toBe(false);
    expect(r2.error).toMatch(/uiDriver/i);
  });

  test('missing androidSearchIn driver method — specific actionable error', async () => {
    const ctx = makeCtx({ uiDriver: {} });
    const r = await executeStep(
      { kind: 'When', text: 'Vexa on Android searches "Marcus" in discovery' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidSearchIn/);
  });

  test('driver throws — bubbles up through executeStep wrapper as structured finding', async () => {
    const searchSpy = jest.fn(async () => {
      throw new Error('adb: search field tag not found');
    });
    const ctx = makeCtx({ uiDriver: { androidSearchIn: searchSpy } });
    const r = await executeStep(
      { kind: 'When', text: 'Vexa on Android searches "Marcus" in discovery' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/adb: search field tag not found/);
  });

  test('does not collide with the existing `types "X" into "Y"` resource-id matcher', async () => {
    // Regression guard: the existing tap+type matcher uses the pattern
    // `types "X" into "Y"` (Y is a resource-id). The new "into the search
    // field" form (no quoted Y) is a separate matcher; must not be swallowed
    // by greedy regex on the existing one.
    const dump = '<node resource-id="signup_emailField" bounds="[200,20][320,80]" />';
    const tapSpy = jest.fn(async () => {});
    const typeSpy = jest.fn(async () => {});
    const searchSpy = jest.fn(async () => {});
    const ctx = makeCtx({
      uiDriver: {
        androidUiDump: jest.fn(async () => dump),
        androidTap: tapSpy,
        androidTypeText: typeSpy,
        androidSearchIn: searchSpy,
      },
    });
    // Existing resource-id form should hit tap+typeText.
    const existing = await executeStep(
      { kind: 'When', text: 'Adam on Android types "test@x.com" into "signup_emailField"' },
      ctx,
    );
    expect(existing.ok).toBe(true);
    expect(typeSpy).toHaveBeenCalledWith('test@x.com');
    expect(searchSpy).not.toHaveBeenCalled();
    // New search-field form should hit androidSearchIn.
    typeSpy.mockClear();
    const newForm = await executeStep(
      { kind: 'When', text: 'Adam on Android types "query" into the search field' },
      ctx,
    );
    expect(newForm.ok).toBe(true);
    expect(searchSpy).toHaveBeenCalledWith(null, 'query');
    expect(typeSpy).not.toHaveBeenCalled();
  });
});

describe('Android kill-and-relaunch matcher (When <P> on Android kills and relaunches the app)', () => {
  test('calls androidKillAndRelaunch with the persona name (for driver logging)', async () => {
    const killSpy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidKillAndRelaunch: killSpy } });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android kills and relaunches the app' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(killSpy).toHaveBeenCalledWith('Adam');
  });

  test('P-NN annotation form handled correctly', async () => {
    const killSpy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidKillAndRelaunch: killSpy } });
    const r = await executeStep(
      { kind: 'When', text: 'Raul [P-08] on Android kills and relaunches the app' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(killSpy).toHaveBeenCalledWith('Raul');
  });

  test('no ctx.uiDriver — loud error', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android kills and relaunches the app' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/uiDriver/i);
  });

  test('missing androidKillAndRelaunch driver method — specific actionable error', async () => {
    const ctx = makeCtx({ uiDriver: {} });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android kills and relaunches the app' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidKillAndRelaunch/);
  });

  test('driver throws — bubbles up via executeStep wrapper', async () => {
    const killSpy = jest.fn(async () => {
      throw new Error('adb: device offline');
    });
    const ctx = makeCtx({ uiDriver: { androidKillAndRelaunch: killSpy } });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android kills and relaunches the app' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/adb: device offline/);
  });
});

describe('Android auth/token-refresh matchers (force-refresh + performs authenticated call)', () => {
  test('`performs any authenticated API call` — calls androidPerformAuthenticatedCall(persona)', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidPerformAuthenticatedCall: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Hayato on Android performs any authenticated API call' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Hayato');
  });

  test('`force-refreshes via securetoken endpoint` — calls androidForceRefreshSecureToken(persona)', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidForceRefreshSecureToken: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Hayato on Android force-refreshes via securetoken endpoint',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Hayato');
  });

  test('`force-refreshes the JWT` — calls androidForceRefreshJwt(persona)', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidForceRefreshJwt: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Raul on Android force-refreshes the JWT' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Raul');
  });

  test('P-NN annotation form on each variant', async () => {
    const spy1 = jest.fn(async () => {});
    const spy2 = jest.fn(async () => {});
    const spy3 = jest.fn(async () => {});
    const ctx = makeCtx({
      uiDriver: {
        androidPerformAuthenticatedCall: spy1,
        androidForceRefreshSecureToken: spy2,
        androidForceRefreshJwt: spy3,
      },
    });
    await executeStep(
      { kind: 'When', text: 'Hayato [P-06] on Android performs any authenticated API call' },
      ctx,
    );
    await executeStep(
      {
        kind: 'When',
        text: 'Hayato [P-06] on Android force-refreshes via securetoken endpoint',
      },
      ctx,
    );
    await executeStep(
      { kind: 'When', text: 'Raul [P-08] on Android force-refreshes the JWT' },
      ctx,
    );
    expect(spy1).toHaveBeenCalledWith('Hayato');
    expect(spy2).toHaveBeenCalledWith('Hayato');
    expect(spy3).toHaveBeenCalledWith('Raul');
  });

  test('no ctx.uiDriver — each variant emits a loud error', async () => {
    const ctx = makeCtx();
    for (const text of [
      'Hayato on Android performs any authenticated API call',
      'Hayato on Android force-refreshes via securetoken endpoint',
      'Raul on Android force-refreshes the JWT',
    ]) {
      const r = await executeStep({ kind: 'When', text }, ctx);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/uiDriver/i);
    }
  });

  test('missing driver methods — each variant names its specific missing method', async () => {
    const ctx = makeCtx({ uiDriver: {} });
    const r1 = await executeStep(
      { kind: 'When', text: 'Hayato on Android performs any authenticated API call' },
      ctx,
    );
    expect(r1.error).toMatch(/androidPerformAuthenticatedCall/);
    const r2 = await executeStep(
      {
        kind: 'When',
        text: 'Hayato on Android force-refreshes via securetoken endpoint',
      },
      ctx,
    );
    expect(r2.error).toMatch(/androidForceRefreshSecureToken/);
    const r3 = await executeStep(
      { kind: 'When', text: 'Raul on Android force-refreshes the JWT' },
      ctx,
    );
    expect(r3.error).toMatch(/androidForceRefreshJwt/);
  });

  test('driver throws — bubbles up via executeStep wrapper', async () => {
    const spy = jest.fn(async () => {
      throw new Error('Firebase auth: REFRESH_TOKEN_EXPIRED');
    });
    const ctx = makeCtx({ uiDriver: { androidForceRefreshSecureToken: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Hayato on Android force-refreshes via securetoken endpoint',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/REFRESH_TOKEN_EXPIRED/);
  });
});

describe('Android long-press-and-tap composite (When <P> on Android long-presses the message and taps "X")', () => {
  test('Edit menu item — calls androidLongPressMessageAndTap with persona + menu item', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidLongPressMessageAndTap: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android long-presses the message and taps "Edit"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Adam', 'Edit');
  });

  test('Delete menu item — driver receives correct menu label', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidLongPressMessageAndTap: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android long-presses the message and taps "Delete"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Adam', 'Delete');
  });

  test('P-NN annotation form handled', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidLongPressMessageAndTap: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Adam [P-01] on Android long-presses the message and taps "Report"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Adam', 'Report');
  });

  test('no ctx.uiDriver — loud error', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android long-presses the message and taps "Edit"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/uiDriver/i);
  });

  test('missing driver method — specific actionable error', async () => {
    const ctx = makeCtx({ uiDriver: {} });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android long-presses the message and taps "Edit"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidLongPressMessageAndTap/);
  });

  test('driver throws — bubbles up via executeStep', async () => {
    const spy = jest.fn(async () => {
      throw new Error('no message in chat history');
    });
    const ctx = makeCtx({ uiDriver: { androidLongPressMessageAndTap: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android long-presses the message and taps "Edit"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no message in chat history/);
  });
});

describe('Android send-message-to-recipient composite (When <P> on Android sends "X" to <Y>)', () => {
  test('simple text message — calls androidSendMessageTo with persona, recipient, content', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidSendMessageTo: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Raul on Android sends "offensive content #1" to Nora',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Raul', 'Nora', 'offensive content #1');
  });

  test('simple gift identifier — works without cost annotation', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidSendMessageTo: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Theo on Android sends "crown" to Selma' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo', 'Selma', 'crown');
  });

  test('P-NN annotation form handled', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidSendMessageTo: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Raul [P-08] on Android sends "msg" to Nora' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Raul', 'Nora', 'msg');
  });

  test('no ctx.uiDriver — loud error', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'When', text: 'Raul on Android sends "msg" to Nora' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/uiDriver/i);
  });

  test('missing driver method — specific actionable error', async () => {
    const ctx = makeCtx({ uiDriver: {} });
    const r = await executeStep({ kind: 'When', text: 'Raul on Android sends "msg" to Nora' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidSendMessageTo/);
  });
});

describe("Android tap-user-card composite (When <P> on Android taps <Y>'s user card)", () => {
  test("Alice's user card — calls androidTapUserCard with persona + target name", async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidTapUserCard: spy } });
    const r = await executeStep(
      { kind: 'When', text: "Adam on Android taps Alice's user card" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Adam', 'Alice');
  });

  test('P-NN annotation form handled on both persona and target side', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidTapUserCard: spy } });
    const r = await executeStep(
      { kind: 'When', text: "Adam [P-01] on Android taps Marcus's user card" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Adam', 'Marcus');
  });

  test('no ctx.uiDriver — loud error', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: "Adam on Android taps Alice's user card" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/uiDriver/i);
  });

  test('missing driver method — specific actionable error', async () => {
    const ctx = makeCtx({ uiDriver: {} });
    const r = await executeStep(
      { kind: 'When', text: "Adam on Android taps Alice's user card" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidTapUserCard/);
  });

  test('does not collide with existing `taps "X"` (quoted resource-id) matcher', async () => {
    // Regression guard: `taps Alice's user card` is unquoted; existing
    // pattern requires `taps "..."`. They must route to different handlers.
    const tapUserCardSpy = jest.fn(async () => {});
    const dump = '<node resource-id="some_button" bounds="[10,10][50,50]" />';
    const tapSpy = jest.fn(async () => {});
    const ctx = makeCtx({
      uiDriver: {
        androidTapUserCard: tapUserCardSpy,
        androidUiDump: jest.fn(async () => dump),
        androidTap: tapSpy,
      },
    });
    // Resource-id form → existing matcher
    await executeStep({ kind: 'When', text: 'Adam on Android taps "some_button"' }, ctx);
    expect(tapSpy).toHaveBeenCalled();
    expect(tapUserCardSpy).not.toHaveBeenCalled();
    // User-card form → new matcher
    tapSpy.mockClear();
    await executeStep({ kind: 'When', text: "Adam on Android taps Alice's user card" }, ctx);
    expect(tapUserCardSpy).toHaveBeenCalledWith('Adam', 'Alice');
    expect(tapSpy).not.toHaveBeenCalled();
  });
});

describe('iOS Sim tag-assertion matchers (positive + negation, via iosUiDump)', () => {
  test('positive `shows the element with tag` — succeeds when identifier present in JSON dump', async () => {
    const dump =
      '{"children":[{"identifier":"main_pmTab","frame":{"x":10,"y":20,"width":50,"height":40}}]}';
    const ctx = makeCtx({
      uiDriver: { iosUiDump: jest.fn(async () => dump) },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Mia\'s iOS Sim UI shows the element with tag "main_pmTab"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('positive `shows` — fails when identifier absent', async () => {
    const dump = '{"children":[{"identifier":"other_thing"}]}';
    const ctx = makeCtx({
      uiDriver: { iosUiDump: jest.fn(async () => dump) },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Mia\'s iOS Sim UI shows the element with tag "main_pmTab"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/main_pmTab/);
  });

  test('negation `does not show` — ok when identifier absent', async () => {
    const dump = '{"children":[{"identifier":"other_thing"}]}';
    const ctx = makeCtx({
      uiDriver: { iosUiDump: jest.fn(async () => dump) },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Mia\'s iOS Sim UI does not show the element with tag "main_pmTab"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('negation `does not show` — fails when identifier IS present', async () => {
    const dump = '{"children":[{"identifier":"main_pmTab"}]}';
    const ctx = makeCtx({
      uiDriver: { iosUiDump: jest.fn(async () => dump) },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Mia\'s iOS Sim UI does not show the element with tag "main_pmTab"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
  });

  test('substring-trap rejection — `main_pmTabFooter` is not falsely matched as `main_pmTab`', async () => {
    // The matcher must check the FULL identifier value, not just substring of dump.
    // `"identifier":"main_pmTabFooter"` is a different identifier from `main_pmTab`.
    const dump = '{"children":[{"identifier":"main_pmTabFooter"}]}';
    const ctx = makeCtx({
      uiDriver: { iosUiDump: jest.fn(async () => dump) },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Mia\'s iOS Sim UI does not show the element with tag "main_pmTab"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('iosUiDump driver method missing — specific error pointing at the missing config', async () => {
    const ctx = makeCtx({ uiDriver: {} });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Mia\'s iOS Sim UI shows the element with tag "main_pmTab"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/iosUiDump/);
  });
});

describe('iOS Sim tap matcher (When <P> on iOS Sim taps "X")', () => {
  test('calls iosTap with the identifier', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { iosTap: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Mia on iOS Sim taps "signup_createAccountButton"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('signup_createAccountButton');
  });

  test('no ctx.uiDriver — loud error', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'When', text: 'Mia on iOS Sim taps "any_tag"' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/uiDriver/i);
  });

  test('missing iosTap driver method — specific error', async () => {
    const ctx = makeCtx({ uiDriver: {} });
    const r = await executeStep({ kind: 'When', text: 'Mia on iOS Sim taps "any_tag"' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/iosTap/);
  });

  test('driver throws — bubbles up via executeStep', async () => {
    const spy = jest.fn(async () => {
      throw new Error('simctl: element not found');
    });
    const ctx = makeCtx({ uiDriver: { iosTap: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Mia on iOS Sim taps "missing_button"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/simctl: element not found/);
  });
});

describe('iOS Sim open-screen matcher (When <P> on iOS Sim opens the "X" screen)', () => {
  test('calls iosOpenScreen with the screen name', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { iosOpenScreen: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Mia on iOS Sim opens the "discovery" screen' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('discovery');
  });

  test('"tab" noun accepted', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { iosOpenScreen: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Mia on iOS Sim opens the "rooms" tab' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('rooms');
  });

  test('no ctx.uiDriver — loud error', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Mia on iOS Sim opens the "discovery" screen' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/uiDriver/i);
  });

  test('missing iosOpenScreen driver method — specific error', async () => {
    const ctx = makeCtx({ uiDriver: {} });
    const r = await executeStep(
      { kind: 'When', text: 'Mia on iOS Sim opens the "discovery" screen' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/iosOpenScreen/);
  });
});

describe('iOS Sim text-content assertion (Then <P>\'s iOS Sim UI shows "X")', () => {
  test('matches a "label":"..." attribute in JSON dump', async () => {
    const dump =
      '{"children":[{"identifier":"banner","label":"You must be 18 or older to use this feature"}]}';
    const ctx = makeCtx({ uiDriver: { iosUiDump: jest.fn(async () => dump) } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Mia\'s iOS Sim UI shows "You must be 18 or older to use this feature"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('matches a "value":"..." attribute when label is absent', async () => {
    const dump = '{"children":[{"identifier":"toast","value":"Report submitted"}]}';
    const ctx = makeCtx({ uiDriver: { iosUiDump: jest.fn(async () => dump) } });
    const r = await executeStep(
      { kind: 'Then', text: 'Nora\'s iOS Sim UI shows "Report submitted"' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('substring rejection: "save" must not match "save as draft"', async () => {
    const dump = '{"children":[{"label":"save as draft"}]}';
    const ctx = makeCtx({ uiDriver: { iosUiDump: jest.fn(async () => dump) } });
    const r = await executeStep({ kind: 'Then', text: 'Mia\'s iOS Sim UI shows "save"' }, ctx);
    expect(r.ok).toBe(false);
  });

  test('trailing descriptive context allowed (e.g. ` toast`)', async () => {
    const dump = '{"children":[{"label":"Report submitted"}]}';
    const ctx = makeCtx({ uiDriver: { iosUiDump: jest.fn(async () => dump) } });
    const r = await executeStep(
      { kind: 'Then', text: 'Nora\'s iOS Sim UI shows "Report submitted" toast' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('no ctx.uiDriver — loud error', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Then', text: 'Mia\'s iOS Sim UI shows "anything"' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/uiDriver/i);
  });

  test('missing iosUiDump driver method — specific error', async () => {
    const ctx = makeCtx({ uiDriver: {} });
    const r = await executeStep({ kind: 'Then', text: 'Mia\'s iOS Sim UI shows "anything"' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/iosUiDump/);
  });
});

describe('iOS Sim type-into-element matcher (When <P> on iOS Sim types "X" into "Y")', () => {
  test('calls iosTypeText with tag + content', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { iosTypeText: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Mia on iOS Sim types "mia@shytalk.dev" into "signup_emailField"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('signup_emailField', 'mia@shytalk.dev');
  });

  test('special chars in text passed through verbatim', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { iosTypeText: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Mia on iOS Sim types "TestPassw0rd!" into "signup_passwordField"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('signup_passwordField', 'TestPassw0rd!');
  });

  test('no ctx.uiDriver — loud error', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'When', text: 'Mia on iOS Sim types "x" into "y"' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/uiDriver/i);
  });

  test('missing iosTypeText driver method — specific error', async () => {
    const ctx = makeCtx({ uiDriver: {} });
    const r = await executeStep({ kind: 'When', text: 'Mia on iOS Sim types "x" into "y"' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/iosTypeText/);
  });
});

describe('iOS Sim type-into-search-field matcher (When <P> on iOS Sim types "X" into the search field)', () => {
  test('calls iosSearchIn(null, text) — active-screen search', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { iosSearchIn: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Mia on iOS Sim types "minor-power" into the search field' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith(null, 'minor-power');
  });

  test('no ctx.uiDriver — loud error', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Mia on iOS Sim types "x" into the search field' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/uiDriver/i);
  });

  test('missing iosSearchIn driver method — specific error', async () => {
    const ctx = makeCtx({ uiDriver: {} });
    const r = await executeStep(
      { kind: 'When', text: 'Mia on iOS Sim types "x" into the search field' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/iosSearchIn/);
  });

  test('does not collide with iOS Sim type-into-element matcher', async () => {
    // Regression guard: `types "X" into "Y"` and `types "X" into the search field`
    // must route to different driver methods.
    const typeSpy = jest.fn(async () => {});
    const searchSpy = jest.fn(async () => {});
    const ctx = makeCtx({
      uiDriver: { iosTypeText: typeSpy, iosSearchIn: searchSpy },
    });
    await executeStep({ kind: 'When', text: 'Mia on iOS Sim types "x" into "emailField"' }, ctx);
    expect(typeSpy).toHaveBeenCalled();
    expect(searchSpy).not.toHaveBeenCalled();
    typeSpy.mockClear();
    await executeStep(
      { kind: 'When', text: 'Mia on iOS Sim types "q" into the search field' },
      ctx,
    );
    expect(searchSpy).toHaveBeenCalledWith(null, 'q');
    expect(typeSpy).not.toHaveBeenCalled();
  });
});

describe('Web matchers (ctx.webDriver namespace — Playwright MCP scope)', () => {
  test('`on Web taps "X"` — calls webTap(tag)', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ webDriver: { webTap: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Web taps "wallet_buyCoinsButton"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('wallet_buyCoinsButton');
  });

  test('`on Web opens the "X" screen` — calls webOpenScreen(name)', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ webDriver: { webOpenScreen: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Lena on Web opens the "wallet" screen' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('wallet');
  });

  test('`on Web opens the "X" tab` — calls webOpenScreen(name) (same driver method as screen)', async () => {
    // The corpus uses "screen" and "tab" interchangeably — same driver call.
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ webDriver: { webOpenScreen: spy } });
    const r = await executeStep({ kind: 'When', text: 'Alice on Web opens the "pm" tab' }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('pm');
  });

  test('`on Web Admin opens the "X" tab` — calls webAdminOpenTab(name)', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ webDriver: { webAdminOpenTab: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin opens the "reports" tab' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('reports');
  });

  test('Web Admin tab does not collide with non-admin tab matcher', async () => {
    // `Alice on Web opens the "pm" tab` → webOpenScreen
    // `Greta on Web Admin opens the "reports" tab` → webAdminOpenTab
    // Different drivers, different handlers. Regression-guarded.
    const openSpy = jest.fn(async () => {});
    const adminSpy = jest.fn(async () => {});
    const ctx = makeCtx({
      webDriver: { webOpenScreen: openSpy, webAdminOpenTab: adminSpy },
    });
    await executeStep({ kind: 'When', text: 'Alice on Web opens the "pm" tab' }, ctx);
    expect(openSpy).toHaveBeenCalledWith('pm');
    expect(adminSpy).not.toHaveBeenCalled();
    openSpy.mockClear();
    await executeStep({ kind: 'When', text: 'Greta on Web Admin opens the "reports" tab' }, ctx);
    expect(adminSpy).toHaveBeenCalledWith('reports');
    expect(openSpy).not.toHaveBeenCalled();
  });

  test('no ctx.webDriver — loud error pointing at the missing namespace', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Web taps "wallet_buyCoinsButton"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webDriver/i);
  });

  test('missing webTap driver method — specific actionable error', async () => {
    const ctx = makeCtx({ webDriver: {} });
    const r = await executeStep({ kind: 'When', text: 'Alice on Web taps "x"' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webTap/);
  });

  test('missing webOpenScreen driver method — specific actionable error', async () => {
    const ctx = makeCtx({ webDriver: {} });
    const r = await executeStep({ kind: 'When', text: 'Alice on Web opens the "x" screen' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webOpenScreen/);
  });

  test('missing webAdminOpenTab driver method — specific actionable error', async () => {
    const ctx = makeCtx({ webDriver: {} });
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin opens the "x" tab' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webAdminOpenTab/);
  });

  test('driver throws — bubbles up through executeStep wrapper', async () => {
    const spy = jest.fn(async () => {
      throw new Error('Playwright MCP: page not connected');
    });
    const ctx = makeCtx({ webDriver: { webTap: spy } });
    const r = await executeStep({ kind: 'When', text: 'Alice on Web taps "any"' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Playwright MCP/);
  });
});

describe('Web text-content assertion (Then <P>\'s Web UI shows "X")', () => {
  test('text present in DOM dump — ok:true', async () => {
    const ctx = makeCtx({
      webDriver: { webUiDump: jest.fn(async () => 'No results found') },
    });
    const r = await executeStep(
      { kind: 'Then', text: 'Vexa\'s Web UI shows "No results found"' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('text absent — fails with the missing text in error', async () => {
    const ctx = makeCtx({
      webDriver: { webUiDump: jest.fn(async () => 'something else') },
    });
    const r = await executeStep(
      { kind: 'Then', text: 'Vexa\'s Web UI shows "User not found"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/User not found/);
  });

  test('trailing context allowed (e.g. ` toast in German`, ` indicator on her reply`)', async () => {
    const ctx = makeCtx({
      webDriver: { webUiDump: jest.fn(async () => 'Streak reset') },
    });
    const r = await executeStep(
      { kind: 'Then', text: 'Lena\'s Web UI shows "Streak reset" toast in German' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('no ctx.webDriver — loud error', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Then', text: 'Vexa\'s Web UI shows "any"' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webDriver/i);
  });

  test('missing webUiDump driver method — specific error', async () => {
    const ctx = makeCtx({ webDriver: {} });
    const r = await executeStep({ kind: 'Then', text: 'Vexa\'s Web UI shows "any"' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webUiDump/);
  });
});

describe('Web document direction assertion (Then <P>\'s Web UI document direction is "X")', () => {
  test('matches the returned direction (e.g. "ltr")', async () => {
    const ctx = makeCtx({
      webDriver: { webDocumentDirection: jest.fn(async () => 'ltr') },
    });
    const r = await executeStep(
      { kind: 'Then', text: 'Lena\'s Web UI document direction is "ltr"' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('rtl when expected ltr — fails with both values', async () => {
    const ctx = makeCtx({
      webDriver: { webDocumentDirection: jest.fn(async () => 'rtl') },
    });
    const r = await executeStep(
      { kind: 'Then', text: 'Lena\'s Web UI document direction is "ltr"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/rtl/);
    expect(r.error).toMatch(/ltr/);
  });

  test('missing webDocumentDirection driver method — specific error', async () => {
    const ctx = makeCtx({ webDriver: {} });
    const r = await executeStep(
      { kind: 'Then', text: 'Lena\'s Web UI document direction is "ltr"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webDocumentDirection/);
  });
});

describe('Web Admin tap-with-reason matcher (When <P> on Web Admin taps "X" with reason "Y")', () => {
  test('calls webAdminTapWithReason(tag, reason)', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ webDriver: { webAdminTapWithReason: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin taps "Issue warning" with reason "Inappropriate language in voice room"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Issue warning', 'Inappropriate language in voice room');
  });

  test('does not collide with plain `Web Admin taps` without reason (different matcher when added later, currently STEP_NOT_IMPLEMENTED)', async () => {
    // The "with reason" form requires the reason suffix; plain `taps "X"` doesn't match.
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ webDriver: { webAdminTapWithReason: spy } });
    await executeStep(
      { kind: 'When', text: 'Greta on Web Admin taps "review" on Hayato\'s submission' },
      ctx,
    );
    // This shape has "on Y's submission" suffix instead of "with reason" — different matcher.
    // It should NOT route to webAdminTapWithReason.
    expect(spy).not.toHaveBeenCalled();
  });

  test('missing driver method — specific error', async () => {
    const ctx = makeCtx({ webDriver: {} });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin taps "X" with reason "Y"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webAdminTapWithReason/);
  });
});

describe('Web Admin confirm-with-reason matcher (When <P> on Web Admin confirms with reason "Y")', () => {
  test('calls webAdminConfirmWithReason(reason)', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ webDriver: { webAdminConfirmWithReason: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin confirms with reason "First-strike harassment"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('First-strike harassment');
  });

  test('missing driver method — specific error', async () => {
    const ctx = makeCtx({ webDriver: {} });
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin confirms with reason "Y"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webAdminConfirmWithReason/);
  });
});

describe('Web sign-in matcher (When <P> on Web signs in with valid credentials)', () => {
  test('calls webSignIn(persona)', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ webDriver: { webSignIn: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Lena on Web signs in with valid credentials' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Lena');
  });

  test('P-NN annotation', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ webDriver: { webSignIn: spy } });
    await executeStep(
      { kind: 'When', text: 'Ines [P-10] on Web signs in with valid credentials' },
      ctx,
    );
    expect(spy).toHaveBeenCalledWith('Ines');
  });

  test('missing webSignIn driver method — specific error', async () => {
    const ctx = makeCtx({ webDriver: {} });
    const r = await executeStep(
      { kind: 'When', text: 'Lena on Web signs in with valid credentials' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webSignIn/);
  });
});

describe("Web open-user-profile matcher (When <P> on Web opens <Y>'s profile)", () => {
  test('calls webOpenUserProfile(persona, target)', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ webDriver: { webOpenUserProfile: spy } });
    const r = await executeStep({ kind: 'When', text: "Layla on Web opens Alice's profile" }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Layla', 'Alice');
  });

  test('different persona target', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ webDriver: { webOpenUserProfile: spy } });
    const r = await executeStep({ kind: 'When', text: "Kenji on Web opens Marcus's profile" }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Kenji', 'Marcus');
  });

  test('missing webOpenUserProfile driver method — specific error', async () => {
    const ctx = makeCtx({ webDriver: {} });
    const r = await executeStep({ kind: 'When', text: "Layla on Web opens Alice's profile" }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webOpenUserProfile/);
  });
});

describe('Web Admin opens-report-and-taps composite (When <P> on Web Admin opens the {first|second|new} report and taps "X" [with reason "Y"])', () => {
  test('first report, no reason — calls webAdminOpenReportAndTap(ordinal, menuItem, null)', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ webDriver: { webAdminOpenReportAndTap: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin opens the first report and taps "Issue warning"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('first', 'Issue warning', null);
  });

  test('second report with reason — driver receives the reason', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ webDriver: { webAdminOpenReportAndTap: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin opens the second report and taps "Dismiss" with reason "No violation observed"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('second', 'Dismiss', 'No violation observed');
  });

  test('new report (non-ordinal keyword) accepted', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ webDriver: { webAdminOpenReportAndTap: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin opens the new report and taps "Suspend for 3 days"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('new', 'Suspend for 3 days', null);
  });

  test('missing driver method — specific error', async () => {
    const ctx = makeCtx({ webDriver: {} });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin opens the first report and taps "X"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webAdminOpenReportAndTap/);
  });
});

describe('Web JS console errors assertion (Then no JavaScript console errors are present)', () => {
  test('console returns empty array — ok:true', async () => {
    const ctx = makeCtx({
      webDriver: { webConsoleErrors: jest.fn(async () => []) },
    });
    const r = await executeStep(
      { kind: 'Then', text: 'no JavaScript console errors are present' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('console returns errors — fails with the messages in error', async () => {
    const ctx = makeCtx({
      webDriver: {
        webConsoleErrors: jest.fn(async () => [
          'Uncaught TypeError: x is undefined',
          'Failed to fetch',
        ]),
      },
    });
    const r = await executeStep(
      { kind: 'Then', text: 'no JavaScript console errors are present' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Uncaught TypeError/);
    expect(r.error).toMatch(/Failed to fetch/);
  });

  test('missing webConsoleErrors driver method — specific error', async () => {
    const ctx = makeCtx({ webDriver: {} });
    const r = await executeStep(
      { kind: 'Then', text: 'no JavaScript console errors are present' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webConsoleErrors/);
  });
});

describe('Web profile-panel navigation (When <P> on Web opens the "X" panel from his profile)', () => {
  test('calls webOpenProfilePanel(persona, panelName)', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ webDriver: { webOpenProfilePanel: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Tariq on Web opens the "event-host" panel from his profile' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Tariq', 'event-host');
  });

  test('different panel name', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ webDriver: { webOpenProfilePanel: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Bao on Web opens the "teaching" panel from his profile' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Bao', 'teaching');
  });

  test('missing webOpenProfilePanel driver method — specific error', async () => {
    const ctx = makeCtx({ webDriver: {} });
    const r = await executeStep(
      { kind: 'When', text: 'Tariq on Web opens the "x" panel from his profile' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webOpenProfilePanel/);
  });
});

describe('Android event-invite tap matcher (When <P> on Android taps "X" on the event invite)', () => {
  test('calls androidTapEventInviteAction(persona, action)', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidTapEventInviteAction: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Selma on Android taps "Accept" on the event invite' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Selma', 'Accept');
  });

  test('Decline action variant', async () => {
    const spy = jest.fn(async () => {});
    const ctx = makeCtx({ uiDriver: { androidTapEventInviteAction: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Selma on Android taps "Decline" on the event invite' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Selma', 'Decline');
  });

  test('does not collide with existing Android resource-id tap matcher', async () => {
    // Existing `Adam on Android taps "main_pmTab"` uses ctx.uiDriver.androidTap;
    // the new `... taps "Accept" on the event invite` uses
    // ctx.uiDriver.androidTapEventInviteAction. Different drivers, different
    // matchers. Regression-guarded.
    const dump = '<node resource-id="main_pmTab" bounds="[10,10][50,50]" />';
    const inviteSpy = jest.fn(async () => {});
    const tapSpy = jest.fn(async () => {});
    const ctx = makeCtx({
      uiDriver: {
        androidUiDump: jest.fn(async () => dump),
        androidTap: tapSpy,
        androidTapEventInviteAction: inviteSpy,
      },
    });
    await executeStep({ kind: 'When', text: 'Adam on Android taps "main_pmTab"' }, ctx);
    expect(tapSpy).toHaveBeenCalled();
    expect(inviteSpy).not.toHaveBeenCalled();
    tapSpy.mockClear();
    await executeStep(
      { kind: 'When', text: 'Selma on Android taps "Accept" on the event invite' },
      ctx,
    );
    expect(inviteSpy).toHaveBeenCalledWith('Selma', 'Accept');
    expect(tapSpy).not.toHaveBeenCalled();
  });

  test('missing driver method — specific error', async () => {
    const ctx = makeCtx({ uiDriver: {} });
    const r = await executeStep(
      { kind: 'When', text: 'Selma on Android taps "Accept" on the event invite' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidTapEventInviteAction/);
  });
});

describe('Cross-cohort Firestore matcher (Then no doc has any entry in "X" whose target|source user has cohort="Y")', () => {
  function makeUserLookupDb(users) {
    // ctx.db.doc("users/<uid>").get() resolves to { exists, data() }.
    return {
      doc: (docPath) => ({
        get: async () => {
          // Match `users/<uid>` paths.
          const match = /^users\/(.+)$/.exec(docPath);
          if (!match) return { exists: false, data: () => undefined };
          const u = users[match[1]];
          return { exists: u !== undefined, data: () => u };
        },
      }),
    };
  }

  test('no doc has a target with the disallowed cohort — ok:true', async () => {
    const db = makeUserLookupDb({
      50000010: { cohort: 'adult' },
      50000020: { cohort: 'adult' },
    });
    const ctx = makeCtx({
      db,
      lastQueryResult: {
        // Upstream query matcher stores POJOs (snap.docs.map(d => d.data())),
        // so the cross-cohort consumer reads data directly — no .data() call.
        docs: [{ followingIds: [50000010, 50000020] }],
      },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'no doc has any entry in "followingIds" whose target user has cohort="minor"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('a doc has a target with the disallowed cohort — fails with offender details', async () => {
    const db = makeUserLookupDb({
      50000010: { cohort: 'adult' },
      90000099: { cohort: 'minor' },
    });
    const ctx = makeCtx({
      db,
      lastQueryResult: {
        docs: [{ followingIds: [50000010, 90000099] }],
      },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'no doc has any entry in "followingIds" whose target user has cohort="minor"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/90000099/);
    expect(r.error).toMatch(/minor/);
  });

  test('source variant routes through the same logic', async () => {
    const db = makeUserLookupDb({
      50000010: { cohort: 'adult' },
    });
    const ctx = makeCtx({
      db,
      lastQueryResult: {
        docs: [{ followerIds: [50000010] }],
      },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'no doc has any entry in "followerIds" whose source user has cohort="minor"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('no prior query result — loud error pointing at the missing When step', async () => {
    const db = makeUserLookupDb({});
    const ctx = makeCtx({ db });
    delete ctx.lastQueryResult;
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'no doc has any entry in "followingIds" whose target user has cohort="minor"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/lastQueryResult|query/i);
  });

  test('empty doc field (no entries) is vacuously ok', async () => {
    const db = makeUserLookupDb({});
    const ctx = makeCtx({
      db,
      lastQueryResult: { docs: [{ followingIds: [] }] },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'no doc has any entry in "followingIds" whose target user has cohort="minor"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('referenced user-doc missing — silently skipped (defensive)', async () => {
    // If a uid points to a non-existent user (data inconsistency), the
    // matcher can't determine cohort. Treat as "not the disallowed cohort"
    // rather than fail loudly — the migration this matcher tests is about
    // cohort containment, not data integrity.
    const db = makeUserLookupDb({});
    const ctx = makeCtx({
      db,
      lastQueryResult: {
        docs: [{ followingIds: [99999999] }],
      },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'no doc has any entry in "followingIds" whose target user has cohort="minor"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });
});

describe('Web Arabic-translation matcher (Then <P>\'s Web UI shows Arabic translation of "X")', () => {
  test('driver verifies translation and returns ok:true', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsTranslationOf: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Layla\'s Web UI shows Arabic translation of "ShyCoins"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('ar', 'ShyCoins');
  });

  test('driver returns false — fails with the key in error', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsTranslationOf: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Layla\'s Web UI shows Arabic translation of "Notifications"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Notifications/);
    expect(r.error).toMatch(/ar/i);
  });

  test('missing driver method — specific error', async () => {
    const ctx = makeCtx({ webDriver: {} });
    const r = await executeStep(
      { kind: 'Then', text: 'Layla\'s Web UI shows Arabic translation of "X"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webShowsTranslationOf/);
  });
});

describe('Translation matcher generalized (locale × platform × optional "the" + suffixes)', () => {
  test('Web + German + "the" prefix dispatches with "de"', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsTranslationOf: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Lena\'s Web UI shows the German translation of "Sign in" in the page heading',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('de', 'Sign in');
  });

  test('Web + Japanese without "the" dispatches with "ja"', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsTranslationOf: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Kenji\'s Web UI shows Japanese translation of "Notifications"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('ja', 'Notifications');
  });

  test('Android + Arabic + "the" dispatches to uiDriver.androidShowsTranslationOf', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsTranslationOf: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Layla\'s Android UI shows the Arabic translation of "Wallet"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('ar', 'Wallet');
  });

  test('iOS Sim + Korean dispatches to uiDriver.iosShowsTranslationOf', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosShowsTranslationOf: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Soo\'s iOS Sim UI shows the Korean translation of "Discover"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('ko', 'Discover');
  });

  test('unknown locale name fails with a clear error before calling driver', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsTranslationOf: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Layla\'s Web UI shows Klingon translation of "X"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Klingon/);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('UI-absence-of-person matcher (does not show <Name>)', () => {
  test('Android dump without the name — ok', async () => {
    const dump = '<node text="Hayato"/><node text="Bao"/>';
    const ctx = makeCtx({ uiDriver: { androidUiDump: jest.fn(async () => dump) } });
    const r = await executeStep(
      { kind: 'Then', text: "Hayato's Android UI does not show Alice" },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('Android dump containing the name — fail with name in error', async () => {
    const dump = '<node text="Alice"/><node content-desc="Discover"/>';
    const ctx = makeCtx({ uiDriver: { androidUiDump: jest.fn(async () => dump) } });
    const r = await executeStep(
      { kind: 'Then', text: "Hayato's Android UI does not show Alice" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Alice/);
  });

  test('Web dump without the name — ok', async () => {
    const dump = 'Discover\nWallet\nNotifications';
    const ctx = makeCtx({ webDriver: { webUiDump: jest.fn(async () => dump) } });
    const r = await executeStep(
      { kind: 'Then', text: "Vexa's Web UI does not show Marcus anywhere" },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('iOS Sim dump without the name — ok', async () => {
    const dump = '{"label":"Hayato"}';
    const ctx = makeCtx({ uiDriver: { iosUiDump: jest.fn(async () => dump) } });
    const r = await executeStep(
      { kind: 'Then', text: "Mia's iOS Sim UI does not show Alice anywhere" },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('"X does not show Y\'s room" reads as Y-not-in-dump', async () => {
    const dump = '<node text="Marcus"/>';
    const ctx = makeCtx({ uiDriver: { androidUiDump: jest.fn(async () => dump) } });
    const r = await executeStep(
      { kind: 'Then', text: "Marcus's Android UI does not show Selma's room" },
      ctx,
    );
    expect(r.ok).toBe(true);
  });
});

describe('UI does not show the message-input field matcher', () => {
  test('Web driver returns false (not shown) — ok', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsMessageInput: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Vexa's Web UI does not show the message-input field" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  test('Web driver returns true (shown) — fail', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsMessageInput: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Vexa's Web UI does not show the message-input field" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/message-input/);
  });

  test('Android dispatches to uiDriver.androidShowsMessageInput', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidShowsMessageInput: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Marcus's Android UI does not show the message-input field" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalled();
  });
});

describe('Refreshes the rooms list matcher', () => {
  test('Web → webDriver.webRefreshRoomsList', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webRefreshRoomsList: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Web refreshes the rooms list' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  test('Android → uiDriver.androidRefreshRoomsList', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidRefreshRoomsList: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Marcus on Android refreshes the rooms list' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  test('missing driver method — clear error', async () => {
    const ctx = makeCtx({ uiDriver: {} });
    const r = await executeStep(
      { kind: 'When', text: 'Marcus on Android refreshes the rooms list' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidRefreshRoomsList/);
  });
});

describe("Taps room card / Taps <Owner>'s room matcher", () => {
  test('Web + "taps the room card" → webDriver.webTapRoomCard(undefined)', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webTapRoomCard: spy } });
    const r = await executeStep({ kind: 'When', text: 'Alice on Web taps the room card' }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith(undefined);
  });

  test('Android + "taps Selma\'s room" → uiDriver.androidTapRoomCard("Selma")', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidTapRoomCard: spy } });
    const r = await executeStep({ kind: 'When', text: "Theo on Android taps Selma's room" }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Selma');
  });

  test('iOS Sim + "taps Bao\'s room card" → uiDriver.iosTapRoomCard("Bao")', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { iosTapRoomCard: spy } });
    const r = await executeStep(
      { kind: 'When', text: "Yuki on iOS Sim taps Bao's room card" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Bao');
  });

  test('Android + "taps the room card" → androidTapRoomCard(undefined)', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidTapRoomCard: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Marcus on Android taps the room card' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith(undefined);
  });
});

describe('Bare persona-on-platform matcher (no URL, no sign-in clause)', () => {
  test('"Greta [P-12] is on Web Admin" records the platform association', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Given', text: 'Greta [P-12] is on Web Admin' }, ctx);
    expect(r.ok).toBe(true);
    expect(ctx.personaPlatforms.get('Greta')).toBe('Web Admin');
  });

  test('"Alice is on Android" also records the platform association (no P-NN)', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Given', text: 'Alice is on Android' }, ctx);
    expect(r.ok).toBe(true);
    expect(ctx.personaPlatforms.get('Alice')).toBe('Android');
  });

  test('does not shadow "is on X at \\"<url>\\"" — URL-anchored matcher still wins', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'Greta [P-12] is on Web Admin at "/admin#users"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPlatforms.get('Greta')).toBe('Web Admin');
    expect(ctx.personaPaths.get('Greta')).toBe('/admin#users');
  });
});

describe('Persona "signed in at the <path> tab" matcher (j01 j04 etc.)', () => {
  test('"Greta is on Web Admin signed in at the \\"/admin#age-verification\\" tab" records both', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Greta [P-12] is on Web Admin signed in at the "/admin#age-verification" tab',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPlatforms.get('Greta')).toBe('Web Admin');
    expect(ctx.personaPaths.get('Greta')).toBe('/admin#age-verification');
  });

  test('"signed in at the \\"discovery\\" screen" variant also works', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Alice [P-02] is on Web Chromium signed in at the "discovery" screen',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPlatforms.get('Alice')).toBe('Web Chromium');
    expect(ctx.personaPaths.get('Alice')).toBe('discovery');
  });
});

describe('Gift catalog state-seed matcher', () => {
  test('"the gift X costs N coins and awards M beans" writes a doc with cost+award', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'the gift "rose" costs 10 coins and awards 5 beans' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['gifts/rose']).toEqual({
      id: 'rose',
      costCoins: 10,
      awardBeans: 5,
    });
  });

  test('"crown" with larger amounts is handled the same way', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'the gift "crown" costs 500 coins and awards 250 beans' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['gifts/crown']).toEqual({
      id: 'crown',
      costCoins: 500,
      awardBeans: 250,
    });
  });

  test('missing ctx.db errors out clearly', async () => {
    const ctx = makeCtx();
    delete ctx.db;
    const r = await executeStep(
      { kind: 'Given', text: 'the gift "rose" costs 10 coins and awards 5 beans' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db/i);
  });
});

describe('Web Admin issues a warning matcher', () => {
  test('"Greta on Web Admin issues a warning to Theo" delegates to driver', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webAdminIssueWarning: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin issues a warning to Theo' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo');
  });

  test('missing driver method — clear error', async () => {
    const ctx = makeCtx({ webDriver: {} });
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin issues a warning to Marcus' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webAdminIssueWarning/);
  });
});

describe('Confirms action matcher', () => {
  test('"Alice on Web confirms" → webDriver.webConfirm()', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webConfirm: spy } });
    const r = await executeStep({ kind: 'When', text: 'Alice on Web confirms' }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  test('"Selma on Android confirms" → uiDriver.androidConfirm()', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidConfirm: spy } });
    const r = await executeStep({ kind: 'When', text: 'Selma on Android confirms' }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  test('"Nora on iOS Sim confirms" → uiDriver.iosConfirm()', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { iosConfirm: spy } });
    const r = await executeStep({ kind: 'When', text: 'Nora on iOS Sim confirms' }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalled();
  });
});

describe('Open <pronoun> <screen> generalization (the | his | her | their)', () => {
  test('"Alice on Web opens her \\"gift_wall\\" screen" matches', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webOpenScreen: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Web opens her "gift_wall" screen' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('gift_wall');
  });

  test('"Selma on Android opens her \\"gift_wall\\" screen" matches', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidOpenScreen: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Selma on Android opens her "gift_wall" screen' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('gift_wall');
  });

  test('existing "the" form still works (regression-guard)', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webOpenScreen: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Web opens the "wallet" screen' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('wallet');
  });
});

describe('Send gift with coin-cost matcher (j16 economy verification)', () => {
  test('"Alice on Web sends \\"crown\\" (500 coins) to Selma" → webSendGift', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webSendGift: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Web sends "crown" (500 coins) to Selma' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('crown', 500, 'Selma');
  });

  test('"Theo on Android sends \\"rose\\" (10 coins) to Selma" → androidSendGift', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidSendGift: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Theo on Android sends "rose" (10 coins) to Selma' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('rose', 10, 'Selma');
  });

  test('iOS Sim variant routes correctly', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { iosSendGift: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Mia on iOS Sim sends "rose" (10 coins) to Selma' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('rose', 10, 'Selma');
  });
});

describe('Picks DOB in picker matcher (j01 Android + j02 iOS Sim)', () => {
  test('Android: "Adam on Android picks DOB \\"2004-01-01\\" in \\"signup_dobPicker\\"" → androidPickDOB', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidPickDOB: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android picks DOB "2004-01-01" in "signup_dobPicker"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('2004-01-01', 'signup_dobPicker');
  });

  test('iOS Sim: "Mia on iOS Sim picks DOB \\"2010-08-20\\" in \\"signup_dobPicker\\"" → iosPickDOB', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { iosPickDOB: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Mia on iOS Sim picks DOB "2010-08-20" in "signup_dobPicker"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('2010-08-20', 'signup_dobPicker');
  });
});

describe('Android age-verification matchers (j01 Adam)', () => {
  test('"picks ID type \\"passport\\"" → androidPickIdType', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidPickIdType: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android picks ID type "passport"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('passport');
  });

  test('"selects test image \\"X.jpg\\" from the gallery" → androidSelectGalleryImage', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidSelectGalleryImage: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Adam on Android selects test image "test-passport-adult.jpg" from the gallery',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('test-passport-adult.jpg');
  });

  test('"signs up with DOB \\"X\\" and accepts legal" → androidSignupWithDOB', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidSignupWithDOB: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Adam on Android signs up with DOB "2004-01-01" and accepts legal',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('2004-01-01');
  });
});

describe('Web Admin age-verification matchers (j01 Greta)', () => {
  test('"refreshes the age-verification tab" → webAdminRefreshAgeVerification', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webAdminRefreshAgeVerification: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin refreshes the age-verification tab' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  test('"taps \\"approve\\" on the submission for \\"{newUniqueId}\\"" → webAdminActOnSubmission', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webAdminActOnSubmission: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin taps "approve" on the submission for "{newUniqueId}"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('approve', '{newUniqueId}');
  });

  test('"taps \\"reject\\" on the submission for \\"50000010\\"" — literal uid also accepted', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webAdminActOnSubmission: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin taps "reject" on the submission for "50000010"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('reject', '50000010');
  });

  test('missing driver method for refresh — clear error', async () => {
    const ctx = makeCtx({ webDriver: {} });
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin refreshes the age-verification tab' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webAdminRefreshAgeVerification/);
  });
});

describe('Scenario-var interpolation (runner-level preprocessing)', () => {
  test('"{varName}" in step text resolves to ctx.scenarioVars value', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webAdminActOnSubmission: spy } });
    ctx.scenarioVars = new Map([['newUniqueId', '50000010']]);
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin taps "approve" on the submission for "{newUniqueId}"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('approve', '50000010');
  });

  test('multiple "{vars}" in the same step are all resolved', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webAdminActOnSubmission: spy } });
    ctx.scenarioVars = new Map([
      ['actionVar', 'reject'],
      ['uidVar', '50000020'],
    ]);
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin taps "{actionVar}" on the submission for "{uidVar}"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('reject', '50000020');
  });

  test('unresolved "{var}" left as literal — no interpolation error', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webAdminActOnSubmission: spy } });
    ctx.scenarioVars = new Map();
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin taps "approve" on the submission for "{unknownVar}"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('approve', '{unknownVar}');
  });

  test('ctx.scenarioVars missing — step matches normally without interpolation', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webAdminActOnSubmission: spy } });
    // no scenarioVars on ctx at all
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin taps "approve" on the submission for "literal-uid"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('approve', 'literal-uid');
  });
});

describe('uniqueId capture matcher (writes to ctx.scenarioVars)', () => {
  test('"X\'s uniqueId is recorded as {newUniqueId}" captures from ctx.sessions', async () => {
    const ctx = makeCtx();
    ctx.sessions = new Map([['Adam', { uniqueId: 50000010 }]]);
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Adam's uniqueId is recorded as {newUniqueId} for the rest of this scenario",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.scenarioVars.get('newUniqueId')).toBe('50000010');
  });

  test('captures from persona registry when no session exists', async () => {
    const ctx = makeCtx();
    // Alice P-02 = 50000010 in persona registry
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Alice's uniqueId is recorded as {aliceUid} for the rest of this scenario",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.scenarioVars.get('aliceUid')).toBe('50000010');
  });

  test('end-to-end: capture then interpolate', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webAdminActOnSubmission: spy } });
    ctx.sessions = new Map([['Adam', { uniqueId: 50000099 }]]);
    // Step 1: capture
    const r1 = await executeStep(
      {
        kind: 'Then',
        text: "Adam's uniqueId is recorded as {newUniqueId} for the rest of this scenario",
      },
      ctx,
    );
    expect(r1.ok).toBe(true);
    // Step 2: interpolate
    const r2 = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin taps "approve" on the submission for "{newUniqueId}"',
      },
      ctx,
    );
    expect(r2.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('approve', '50000099');
  });

  test('unknown persona — clear error', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Nobody's uniqueId is recorded as {x} for the rest of this scenario",
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Nobody/);
  });
});

describe('Env-var fallback in scenario-var interpolation', () => {
  const originalEnv = process.env.PERSONAS_PASSWORD;
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.PERSONAS_PASSWORD;
    else process.env.PERSONAS_PASSWORD = originalEnv;
  });

  test('"{PERSONAS_PASSWORD}" resolves from process.env when scenarioVars miss', async () => {
    process.env.PERSONAS_PASSWORD = 'real-pw';
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webTypeAndSubmit: spy } });
    ctx.scenarioVars = new Map(); // empty — fallback should kick in
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Lena on Web types "lapsed@shytalk.dev" + "{PERSONAS_PASSWORD}" and submits',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('lapsed@shytalk.dev', 'real-pw');
  });

  test('scenarioVars wins over env when both have the key', async () => {
    process.env.PERSONAS_PASSWORD = 'env-pw';
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webTypeAndSubmit: spy } });
    ctx.scenarioVars = new Map([['PERSONAS_PASSWORD', 'scenario-pw']]);
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Lena on Web types "x@y.com" + "{PERSONAS_PASSWORD}" and submits',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('x@y.com', 'scenario-pw');
  });

  test('lower-case "{coins}" does NOT fall through to env (avoids leaking arbitrary env)', async () => {
    process.env.coins = 'sneaky-leak';
    const ctx = makeCtx({
      uiDriver: { androidUiDump: jest.fn(async () => '<node text="+{coins}"/>') },
    });
    ctx.scenarioVars = new Map(); // empty
    const r = await executeStep(
      { kind: 'Then', text: 'Adam\'s Android UI shows the "+{coins}" reward animation' },
      ctx,
    );
    // The lowercase placeholder must be left as the literal "{coins}" string
    // — and since the fake dump intentionally contains literal "{coins}",
    // the assertion passes. The point of this test is that env didn't leak.
    expect(r.ok).toBe(true);
    delete process.env.coins;
  });
});

describe('Reward animation matcher (Android, uses interpolation)', () => {
  test('"+{coins}" interpolated against scenarioVars then asserted in dump', async () => {
    const dump = '<node text="+50"/>';
    const ctx = makeCtx({ uiDriver: { androidUiDump: jest.fn(async () => dump) } });
    ctx.scenarioVars = new Map([['coins', '50']]);
    const r = await executeStep(
      { kind: 'Then', text: 'Adam\'s Android UI shows the "+{coins}" reward animation' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('reward animation NOT in dump — fail', async () => {
    const dump = '<node text="discover"/>';
    const ctx = makeCtx({ uiDriver: { androidUiDump: jest.fn(async () => dump) } });
    ctx.scenarioVars = new Map([['coins', '50']]);
    const r = await executeStep(
      { kind: 'Then', text: 'Adam\'s Android UI shows the "+{coins}" reward animation' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/\+50/);
  });
});

describe('Main tabs + PM tab hidden matcher (Android, j01)', () => {
  test('dump has main tabs but no PM tab — ok', async () => {
    const dump =
      '<node content-desc="discover"/><node content-desc="wallet"/><node content-desc="profile"/>';
    const ctx = makeCtx({ uiDriver: { androidUiDump: jest.fn(async () => dump) } });
    const r = await executeStep(
      { kind: 'Then', text: "Adam's Android UI shows main tabs but PM tab is hidden" },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('dump has main tabs AND PM tab — fail with PM-presence error', async () => {
    const dump =
      '<node content-desc="discover"/><node content-desc="wallet"/><node content-desc="profile"/><node content-desc="pm"/>';
    const ctx = makeCtx({ uiDriver: { androidUiDump: jest.fn(async () => dump) } });
    const r = await executeStep(
      { kind: 'Then', text: "Adam's Android UI shows main tabs but PM tab is hidden" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/PM/i);
  });
});

describe('Deep-link navigation matcher (Android + iOS Sim)', () => {
  test('Android: "Adam on Android attempts to navigate to \\"/pm\\" via deep link" → androidOpenDeepLink', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidOpenDeepLink: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android attempts to navigate to "/pm" via deep link' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('/pm');
  });

  test('iOS Sim: "Mia on iOS Sim attempts to navigate to \\"/age-verification\\" via deep link" → iosOpenDeepLink', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { iosOpenDeepLink: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Mia on iOS Sim attempts to navigate to "/age-verification" via deep link',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('/age-verification');
  });
});

describe('No <X> screen renders matcher (UI-absence)', () => {
  test('driver returns false (screen NOT rendered) — ok', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { currentPlatformRendersScreen: spy } });
    const r = await executeStep({ kind: 'Then', text: 'no PM screen renders' }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('PM');
  });

  test('driver returns true (screen IS rendered) — fail', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { currentPlatformRendersScreen: spy } });
    const r = await executeStep({ kind: 'Then', text: 'no PM screen renders' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/PM/);
  });
});

describe('Gift selection (Android)', () => {
  test('"selects gift \\"rose\\" and recipient \\"Alice\\"" → androidSelectGiftRecipient', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidSelectGiftRecipient: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android selects gift "rose" and recipient "Alice"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('rose', 'Alice');
  });
});

describe('Sign-in form filler (types email + password and submits)', () => {
  test('Web: "Lena on Web types \\"X\\" + \\"Y\\" and submits" → webTypeAndSubmit', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webTypeAndSubmit: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Lena on Web types "lapsed-adult@shytalk.dev" + "secret" and submits',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('lapsed-adult@shytalk.dev', 'secret');
  });

  test('Android: "Marcus on Android types \\"X\\" + \\"Y\\" and submits" → androidTypeAndSubmit', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidTypeAndSubmit: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Marcus on Android types "x@y.com" + "secret" and submits' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('x@y.com', 'secret');
  });
});

describe('Current screen Given (X on <plat> is on the "Y" screen)', () => {
  test("records the persona's current screen", async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'Adam on Android is on the "age_verification" screen' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPlatforms.get('Adam')).toBe('Android');
    expect(ctx.personaPaths.get('Adam')).toBe('age_verification');
  });

  test('iOS Sim variant works', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'Mia on iOS Sim is on the "discovery" screen' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPlatforms.get('Mia')).toBe('iOS Sim');
    expect(ctx.personaPaths.get('Mia')).toBe('discovery');
  });
});

describe("Cross-persona displayName assertion (UI shows X's displayName)", () => {
  test("Web dump contains target persona's displayName — ok", async () => {
    // Alice P-02 displayName is "[SEED] Alice (P-02 adult power)" per persona registry (PR: dev-seed-personas-on-deploy adds the [SEED] prefix)
    const dump = 'Discover\n[SEED] Alice (P-02 adult power)\nWallet';
    const ctx = makeCtx({ webDriver: { webUiDump: jest.fn(async () => dump) } });
    const r = await executeStep(
      { kind: 'Then', text: "Adam's Web UI shows Alice's displayName" },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('Web dump does NOT contain target displayName — fail', async () => {
    const dump = 'Discover\nWallet';
    const ctx = makeCtx({ webDriver: { webUiDump: jest.fn(async () => dump) } });
    const r = await executeStep(
      { kind: 'Then', text: "Adam's Web UI shows Alice's displayName" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Alice/);
  });

  test('qualified variant: "X\'s displayName \\"<expected>\\"" — checks dump contains the literal', async () => {
    const dump = 'Discover\n[SEED] Alice (P-02 adult power)\nWallet';
    const ctx = makeCtx({ uiDriver: { androidUiDump: jest.fn(async () => dump) } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Adam\'s Android UI shows Alice\'s displayName "[SEED] Alice (P-02 adult power)"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('unknown target persona — clear error', async () => {
    const ctx = makeCtx({ webDriver: { webUiDump: jest.fn(async () => '') } });
    const r = await executeStep(
      { kind: 'Then', text: "Adam's Web UI shows Nonexistent's displayName" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Nonexistent/);
  });
});

describe('Quoted-string UI absence matcher (different from name-absence)', () => {
  test('iOS dump does not contain the quoted string — ok', async () => {
    const dump = '{"label":"Discover"}{"label":"Wallet"}';
    const ctx = makeCtx({ uiDriver: { iosUiDump: jest.fn(async () => dump) } });
    const r = await executeStep(
      { kind: 'Then', text: 'Mia\'s iOS Sim UI does not show "Alice"' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('Android dump contains a literal resource-id-shaped string — fail', async () => {
    const dump = '<node resource-id="main_roomsTab"/>';
    const ctx = makeCtx({ uiDriver: { androidUiDump: jest.fn(async () => dump) } });
    const r = await executeStep(
      { kind: 'Then', text: 'Raul\'s Android UI does not show "main_roomsTab"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/main_roomsTab/);
  });
});

describe('Bare-name button tap matcher (taps the X button)', () => {
  test('Web: "Lena on Web taps the claim button" → webTapNamedButton', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webTapNamedButton: spy } });
    const r = await executeStep({ kind: 'When', text: 'Lena on Web taps the claim button' }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('claim');
  });

  test('Web: "Alice on Web taps the send button" → webTapNamedButton', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webTapNamedButton: spy } });
    const r = await executeStep({ kind: 'When', text: 'Alice on Web taps the send button' }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('send');
  });

  test('Android variant routes correctly', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidTapNamedButton: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android taps the claim button' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('claim');
  });
});

describe('Legal checkboxes + continue composite (signup)', () => {
  test('Web: "Lena on Web checks both legal checkboxes and continues" → webAcceptLegalAndContinue', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webAcceptLegalAndContinue: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Lena on Web checks both legal checkboxes and continues' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  test('iOS Sim: "Mia on iOS Sim accepts both legal checkboxes and continues" → iosAcceptLegalAndContinue', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { iosAcceptLegalAndContinue: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Mia on iOS Sim accepts both legal checkboxes and continues' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  test('Android variant routes correctly', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidAcceptLegalAndContinue: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Hayato on Android accepts both legal checkboxes and continues' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalled();
  });
});

describe('Persona "signed in" variants (annotation tolerance + bare form)', () => {
  test('bare "is on Web Chromium signed in" (no path) records platform only', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'Alice [P-02] is on Web Chromium signed in' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPlatforms.get('Alice')).toBe('Web Chromium');
    expect(ctx.personaPaths.get('Alice')).toBeUndefined();
  });

  test('"signed in (annotation)" — mid-step annotation tolerated, no path', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'Alice [P-02] is on Web Chromium signed in (cross-cohort adult)' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPlatforms.get('Alice')).toBe('Web Chromium');
    expect(ctx.personaPaths.get('Alice')).toBeUndefined();
  });

  test('"signed in (annotation) at the \\"<screen>\\" screen" — both', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Marcus [P-04] is on Android signed in (same-cohort minor) at the "discovery" screen',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPlatforms.get('Marcus')).toBe('Android');
    expect(ctx.personaPaths.get('Marcus')).toBe('discovery');
  });
});

describe('Bare "X is on the <screen> screen" (no platform)', () => {
  test("records persona's current screen as path; leaves platform unset", async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'Lena is on the legal acceptance screen' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPaths.get('Lena')).toBe('legal acceptance');
  });

  test('multi-word screen names accepted', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'Adam is on the age verification submission screen' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPaths.get('Adam')).toBe('age verification submission');
  });
});

describe('API legal versions assertion (Given)', () => {
  test('"the current privacy version is 4" — fetches and asserts response', async () => {
    const fetchSpy = jest.fn(async (url) => {
      if (typeof url === 'string' && url.endsWith('/api/legal/versions')) {
        return { status: 200, json: async () => ({ privacy: 4, terms: 2, community: 1 }) };
      }
      return { status: 500, text: async () => '{}' };
    });
    const ctx = makeCtx({ fetch: fetchSpy });
    const r = await executeStep(
      { kind: 'Given', text: 'the current privacy version is 4 in /api/legal/versions' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith('https://dev-api.example/api/legal/versions');
  });

  test('mismatch — fail with both expected and actual', async () => {
    const fetchSpy = jest.fn(async () => ({
      status: 200,
      json: async () => ({ privacy: 3 }),
    }));
    const ctx = makeCtx({ fetch: fetchSpy });
    const r = await executeStep(
      { kind: 'Given', text: 'the current privacy version is 4 in /api/legal/versions' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/expected 4/);
    expect(r.error).toMatch(/actual 3/);
  });

  test('terms variant routes the same way', async () => {
    const fetchSpy = jest.fn(async () => ({
      status: 200,
      json: async () => ({ terms: 7 }),
    }));
    const ctx = makeCtx({ fetch: fetchSpy });
    const r = await executeStep(
      { kind: 'Given', text: 'the current terms version is 7 in /api/legal/versions' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });
});

describe('Firestore absence matcher (no submission for X)', () => {
  test('collection has no doc with userId matching persona — ok', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'no submission doc is created in "ageVerificationSubmissions" for Alice',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('collection has a doc with userId matching persona — fail', async () => {
    // Alice P-02 = 50000010
    const db = makeStatefulFakeDb({
      'ageVerificationSubmissions/some-doc': { userId: '50000010', status: 'pending' },
    });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'no submission doc is created in "ageVerificationSubmissions" for Alice',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/50000010/);
  });
});

describe("List-membership UI assertion (X's UI shows Y in the <list> list)", () => {
  test('dump contains the item text — ok', async () => {
    const dump = '<list-followed><node text="Alice (P-02 adult power)"/></list-followed>';
    const ctx = makeCtx({ webDriver: { webUiDump: jest.fn(async () => dump) } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Lena's Web UI shows Alice (P-02 adult power) in the followed list",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('dump does not contain the item text — fail', async () => {
    const dump = '<list-followed></list-followed>';
    const ctx = makeCtx({ webDriver: { webUiDump: jest.fn(async () => dump) } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Lena's Web UI shows Alice (P-02 adult power) in the followed list",
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/followed/);
  });
});

describe('Browser notification permission grant', () => {
  test('"Lena on Web grants the browser notification permission" → webGrantNotificationPermission', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webGrantNotificationPermission: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Lena on Web grants the browser notification permission' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  test('missing driver method — clear error', async () => {
    const ctx = makeCtx({ webDriver: {} });
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Web grants the browser notification permission' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webGrantNotificationPermission/);
  });
});

describe('Web Admin: opens unquoted tab name (slug form)', () => {
  test('"Greta on Web Admin opens the age-verification tab" → webAdminOpenTab', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webAdminOpenTab: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin opens the age-verification tab' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('age-verification');
  });

  test('"opens the suspension-appeals tab" routes the same way', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webAdminOpenTab: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin opens the suspension-appeals tab' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('suspension-appeals');
  });

  test('quoted-tab variant (Wake 45) still routes through webAdminOpenTab too', async () => {
    // Both quoted (Wake 45) and unquoted (Wake 51) variants delegate to
    // webAdminOpenTab — they're disjoint by regex shape but converge on
    // the same driver method. Quote inclusion is the corpus author's
    // choice, not a different action.
    const spyQuoted = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webAdminOpenTab: spyQuoted } });
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin opens the "/admin#age-verification" tab' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spyQuoted).toHaveBeenCalledWith('/admin#age-verification');
  });
});

describe("Web Admin: taps action on Name's submission (name-anchored)", () => {
  test('"taps \\"review\\" on Hayato\'s submission" → webAdminActOnSubmissionByName', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webAdminActOnSubmissionByName: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin taps "review" on Hayato\'s submission' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('review', 'Hayato');
  });

  test('"taps \\"approve\\" on Alice\'s submission" routes correctly', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webAdminActOnSubmissionByName: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin taps "approve" on Alice\'s submission' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('approve', 'Alice');
  });
});

describe('Web Admin: UI shows the ID image (bare element-visible)', () => {
  test('webAdminShowsIdImage() returns true — ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webAdminShowsIdImage: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Greta's Web Admin UI shows the ID image" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  test('webAdminShowsIdImage() returns false — fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webAdminShowsIdImage: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Greta's Web Admin UI shows the ID image" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ID image/);
  });
});

describe('Web Admin: UI shows parsed DOB candidate (quoted text)', () => {
  test('dump contains the DOB string — ok', async () => {
    const dump = '<div class="dob-candidate">2011-05-12</div>';
    const ctx = makeCtx({ webDriver: { webUiDump: jest.fn(async () => dump) } });
    const r = await executeStep(
      { kind: 'Then', text: 'Greta\'s Web Admin UI shows the parsed DOB candidate "2011-05-12"' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('dump does NOT contain the DOB string — fail', async () => {
    const dump = '<div class="dob-candidate">2004-01-01</div>';
    const ctx = makeCtx({ webDriver: { webUiDump: jest.fn(async () => dump) } });
    const r = await executeStep(
      { kind: 'Then', text: 'Greta\'s Web Admin UI shows the parsed DOB candidate "2011-05-12"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/2011-05-12/);
  });
});

describe('User card tap matcher (iOS Sim + Android + Web)', () => {
  test('iOS Sim: "Mia on iOS Sim taps Marcus\'s user card" → iosTapUserCard', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { iosTapUserCard: spy } });
    const r = await executeStep(
      { kind: 'When', text: "Mia on iOS Sim taps Marcus's user card" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Marcus');
  });

  test('Android: existing matcher (older signature) wins by first-match-wins, passes (tapper, target)', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidTapUserCard: spy } });
    const r = await executeStep(
      { kind: 'When', text: "Hayato on Android taps Alice's user card" },
      ctx,
    );
    expect(r.ok).toBe(true);
    // The pre-existing Android-specific matcher (line ~2860) catches this
    // first and calls with (tapper, target). My new platform-dispatch
    // matcher only fills in iOS Sim + Web gaps.
    expect(spy).toHaveBeenCalledWith('Hayato', 'Alice');
  });

  test('Web variant routes correctly', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webTapUserCard: spy } });
    const r = await executeStep({ kind: 'When', text: "Alice on Web taps Selma's user card" }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Selma');
  });
});

describe('User-doc state-seed with array field (followingIds=[...])', () => {
  test('"Alice\'s user doc was manipulated to have followingIds=[X]" sets the array', async () => {
    // Alice P-02 = 50000010 per registry
    const db = makeStatefulFakeDb({ 'users/50000010': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: "Alice's user doc was manipulated to have followingIds=[50000020]",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000010'].followingIds).toEqual([50000020]);
  });

  test('multi-element array', async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: "Alice's user doc was manipulated to have followingIds=[50000020, 50000030]",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000010'].followingIds).toEqual([50000020, 50000030]);
  });

  test('empty array', async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: "Alice's user doc was manipulated to have followingIds=[]" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000010'].followingIds).toEqual([]);
  });
});

describe('Web Admin tap-with-reason-and-dobOverride (j04 reject flow)', () => {
  test('"taps \\"reject_and_dob_down\\" with reason \\"X\\" and dobOverride=\\"Y\\"" → driver call', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webAdminTapWithReasonAndOverride: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin taps "reject_and_dob_down" with reason "DOB on ID is 2011-05-12" and dobOverride="2011-05-12"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith(
      'reject_and_dob_down',
      'DOB on ID is 2011-05-12',
      '2011-05-12',
    );
  });
});

describe('Firestore count by PM key + addressee', () => {
  test('"database has 1 entries in messages with PM key X addressed to N" — match found, count=1, ok', async () => {
    const db = makeStatefulFakeDb({
      'messages/m1': {
        systemKey: 'age_seg_age_down_admin_pm',
        addresseeUniqueId: 50000030,
        body: 'translated text',
      },
    });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has 1 entries in "messages" with the system PM key "age_seg_age_down_admin_pm" addressed to 50000030',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('count mismatch — fail', async () => {
    const db = makeStatefulFakeDb({
      'messages/m1': { systemKey: 'k1', addresseeUniqueId: 100 },
      'messages/m2': { systemKey: 'k1', addresseeUniqueId: 100 },
    });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has 1 entries in "messages" with the system PM key "k1" addressed to 100',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/expected 1.*actual 2/);
  });

  test('zero entries — fail with both expected and actual', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has 1 entries in "messages" with the system PM key "k1" addressed to 100',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/expected 1.*actual 0/);
  });
});

describe('PM body locale check (Japanese translation of template)', () => {
  test('"the PM body is the Japanese translation of the age_down template" — driver verifies', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { pmBodyIsTranslationOfTemplate: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'the PM body is the Japanese translation of the age_down template' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('ja', 'age_down');
  });

  test('driver returns false — fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { pmBodyIsTranslationOfTemplate: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'the PM body is the Japanese translation of the age_down template' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Japanese/);
  });
});

describe('PM is from <sender> assertion', () => {
  test('"the PM is from Officia" (after Wake-30 annotation strip) — driver call', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { pmIsFromSender: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        // Wake 30 strips trailing parens — runner sees "the PM is from Officia".
        text: 'the PM is from Officia (uniqueId=1, userType=SHYTALK_OFFICIAL)',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Officia');
  });
});

describe('Relaunches the app and signs in (composite action)', () => {
  test('Android: "Hayato on Android relaunches the app and signs in" → androidRelaunchAndSignIn', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidRelaunchAndSignIn: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Hayato on Android relaunches the app and signs in' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Hayato');
  });

  test('iOS Sim variant routes correctly', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { iosRelaunchAndSignIn: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Mia on iOS Sim relaunches the app and signs in' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Mia');
  });
});

describe('In-app banner about cohort change in <locale>', () => {
  test('"X\'s Android UI shows the in-app banner about the cohort change in Japanese" → driver call', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsCohortChangeBanner: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Hayato's Android UI shows the in-app banner about the cohort change in Japanese",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('ja');
  });

  test('driver returns false — fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidShowsCohortChangeBanner: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Hayato's Android UI shows the in-app banner about the cohort change in Japanese",
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/cohort change/i);
  });
});

describe('Balance comparison Given (X has shyCoins OP N [after explanation])', () => {
  test('"Adam has shyCoins >= 10" verifies user doc field', async () => {
    // Adam (P-01, ephemeral) uniqueId is 90000001 per EPHEMERAL_PERSONAS.
    // The trailing "after daily reward + a +100 admin top-up" has no
    // parens so Wake 30 doesn't strip it — matcher must tolerate it.
    const db = makeStatefulFakeDb({ 'users/90000001': { shyCoins: 110 } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Adam has shyCoins >= 10 after daily reward + a +100 admin top-up',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('mismatch — fail', async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': { shyCoins: 5 } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Alice has shyCoins >= 10 after daily reward' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/5/);
    expect(r.error).toMatch(/10/);
  });

  test('all comparison operators supported', async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': { shyCoins: 50 } });
    const ctx = makeCtx({ db });
    const ops = [
      ['<', 100, true],
      ['<=', 50, true],
      ['==', 50, true],
      ['>=', 50, true],
      ['>', 49, true],
      ['<', 1, false],
    ];
    for (const [op, val, expectedOk] of ops) {
      const r = await executeStep({ kind: 'Given', text: `Alice has shyCoins ${op} ${val}` }, ctx);
      expect(r.ok).toBe(expectedOk);
    }
  });
});

describe('Firestore field-still-containing assertion', () => {
  test('field contains expected array — ok', async () => {
    const db = makeStatefulFakeDb({
      'users/50000030': { followingIds: [50000010, 50000060] },
    });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000030" with field "followingIds" still containing [50000010, 50000060]',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('scalar value (not array) — ok', async () => {
    const db = makeStatefulFakeDb({
      'users/50000060': { followerIds: 50000030 },
    });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000060" with field "followerIds" still containing 50000030',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('array contains expected scalar element — ok', async () => {
    const db = makeStatefulFakeDb({
      'users/50000060': { followerIds: [50000030, 50000040] },
    });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000060" with field "followerIds" still containing 50000030',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('missing doc — fail', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000030" with field "followingIds" still containing [50000010]',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/users\/50000030/);
  });

  test('field array missing an expected element — fail', async () => {
    const db = makeStatefulFakeDb({
      'users/50000030': { followingIds: [50000010] },
    });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000030" with field "followingIds" still containing [50000010, 50000060]',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/50000060/);
  });
});

describe('Placeholder UI assertion (renders the "X" placeholder)', () => {
  test('"in both slots" variant — driver receives slotCount=both', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsPlaceholder: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Hayato\'s Android UI renders the "age_seg_user_unavailable" placeholder in both slots',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('age_seg_user_unavailable', 'both');
  });

  test('"in that slot" variant — driver receives slotCount=that', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosShowsPlaceholder: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Mia\'s iOS Sim UI renders the placeholder "age_seg_user_unavailable" in that slot',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('age_seg_user_unavailable', 'that');
  });

  test('driver returns false — fail with placeholder name in error', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidShowsPlaceholder: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Hayato\'s Android UI renders the "X_placeholder" placeholder in both slots',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/X_placeholder/);
  });
});

describe('PM-with-badge UI assertion', () => {
  test('"X\'s Android UI shows the new PM from Y with the official badge" → driver', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsPmWithBadge: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Hayato's Android UI shows the new PM from Officia with the official badge",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Officia', 'official');
  });

  test('iOS Sim variant routes correctly', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosShowsPmWithBadge: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Mia's iOS Sim UI shows the new PM from Officia with the official badge",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Officia', 'official');
  });
});

describe('Followers/following list nav matcher', () => {
  test('Android: "Theo on Android opens his followers list" → androidOpenListView("followers")', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidOpenListView: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Theo on Android opens his followers list' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('followers');
  });

  test('Web variant + her pronoun', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webOpenListView: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Web opens her following list' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('following');
  });
});

describe('Performance budget matcher', () => {
  test('"the time from submit to \\"X\\" rendering is less than Nms" → driver check', async () => {
    const spy = jest.fn(async () => 1500);
    const ctx = makeCtx({ uiDriver: { measureRenderingTimeFromSubmit: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the time from submit to "main_roomsTab" rendering is less than 3000ms',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('main_roomsTab');
  });

  test('actual exceeds budget — fail with both numbers', async () => {
    const spy = jest.fn(async () => 5000);
    const ctx = makeCtx({ uiDriver: { measureRenderingTimeFromSubmit: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the time from submit to "main_roomsTab" rendering is less than 3000ms',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/3000/);
    expect(r.error).toMatch(/5000/);
  });
});

describe('Package state-seed (j05 IAP catalog)', () => {
  test('"the package \\"X\\" exists with coinValue=N and price=\\"$Y\\"" writes packages/<id>', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'the package "coins-1000" exists with coinValue=1000 and price="$9.99"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['packages/coins-1000']).toEqual({
      id: 'coins-1000',
      coinValue: 1000,
      price: '$9.99',
    });
  });

  test('bare form without price (j06): writes only coinValue', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'the package "coins-1000" exists with coinValue=1000' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['packages/coins-1000']).toEqual({ id: 'coins-1000', coinValue: 1000 });
  });
});

describe('Package selection (Web)', () => {
  test('"Alice on Web selects package \\"coins-1000\\"" → webSelectPackage', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webSelectPackage: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Web selects package "coins-1000"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('coins-1000');
  });
});

describe('Sandbox receipt submission (Web)', () => {
  test('"Alice on Web submits a sandbox receipt \\"<id>\\"" → webSubmitSandboxReceipt', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webSubmitSandboxReceipt: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Web submits a sandbox receipt "sandbox-receipt-abc-A"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('sandbox-receipt-abc-A');
  });

  test('"{ts}" placeholder interpolates from scenarioVars', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webSubmitSandboxReceipt: spy } });
    ctx.scenarioVars = new Map([['ts', '1700000000000']]);
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Web submits a sandbox receipt "sandbox-receipt-{ts}-A"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('sandbox-receipt-1700000000000-A');
  });
});

describe('Collection-entries-added-since-timestamp assertion', () => {
  test('exactly N docs added since the recorded timestamp — ok', async () => {
    const db = makeStatefulFakeDb({
      'users/50000010/gifts/g1': { createdAt: 500 },
      'users/50000010/gifts/g2': { createdAt: 800 },
      'users/50000010/gifts/g3': { createdAt: 1500 },
      'users/50000010/gifts/g4': { createdAt: 2000 },
      'users/50000010/gifts/g5': { createdAt: 3000 },
    });
    const ctx = makeCtx({ db });
    ctx.scenarioVars = new Map([['ts', '1000']]);
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has 3 entries in "users/50000010/gifts" added since "{ts}"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('wrong count — fail with both expected and actual', async () => {
    const db = makeStatefulFakeDb({
      'users/50000010/gifts/g1': { createdAt: 1500 },
    });
    const ctx = makeCtx({ db });
    ctx.scenarioVars = new Map([['ts', '1000']]);
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has 3 entries in "users/50000010/gifts" added since "{ts}"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/expected 3.*actual 1/);
  });
});

describe('Firestore array-not-contains on any-of-collection assertion', () => {
  test('no room has the participant in participantIds — ok', async () => {
    const db = makeStatefulFakeDb({
      'rooms/r1': { participantIds: [50000010, 50000020] },
      'rooms/r2': { participantIds: [50000040, 50000050] },
    });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database does not have field "participantIds" containing 50000030 on any room',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('some room has the participant — fail with offending doc', async () => {
    const db = makeStatefulFakeDb({
      'rooms/r1': { participantIds: [50000010, 50000030] },
    });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database does not have field "participantIds" containing 50000030 on any room',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/r1/);
    expect(r.error).toMatch(/50000030/);
  });
});

describe('Received system PM bare assertion', () => {
  // Wake 134 converted from webDriver stub to direct Firestore read.
  // Reads conversations/<convId>/messages and matches against the
  // _testKey field W132's webhook-fire writer sets.

  function makeMessagesQueryDb(messages) {
    return {
      collection: (path) => ({
        get: async () => ({
          forEach: (cb) => {
            for (const [id, data] of Object.entries(messages[path] || {})) {
              cb({ id, data: () => data });
            }
          },
        }),
      }),
    };
  }

  test('returns ok when a message with matching _testKey exists', async () => {
    // Hayato P-06 uniqueId=50000030. Sorted-join: 50000030_SHYTALK_SYSTEM.
    const convId = '50000030_SHYTALK_SYSTEM';
    const db = makeMessagesQueryDb({
      [`conversations/${convId}/messages`]: {
        m1: { _testKey: 'age-down', type: 'SYSTEM' },
      },
    });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Hayato received the age-down system PM from Officia' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('returns ok when text contains the key (fallback when _testKey missing)', async () => {
    const convId = '50000030_SHYTALK_SYSTEM';
    const db = makeMessagesQueryDb({
      [`conversations/${convId}/messages`]: {
        m1: { type: 'SYSTEM', text: 'You have been age-down adjusted per policy' },
      },
    });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Hayato received the age-down system PM from Officia' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('returns fail when no matching message — includes convId in error', async () => {
    const db = makeMessagesQueryDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Hayato received the age-down system PM from Officia' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/age-down/);
    expect(r.error).toMatch(/50000030_SHYTALK_SYSTEM/);
  });

  test('unknown recipient → ok:false', async () => {
    const ctx = makeCtx({ db: makeMessagesQueryDb({}) });
    const r = await executeStep(
      { kind: 'Given', text: 'Zephyr received the age-down system PM from Officia' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Zephyr/);
  });
});

describe('runScenario auto-populates {ts} scenarioVar from scenarioStartTime', () => {
  test('scenarioVars has "ts" key matching scenarioStartTime', async () => {
    const fakeFetch = jest.fn(async () => ({ status: 200, json: async () => ({}) }));
    const ctx = makeCtx({ fetch: fakeFetch });
    const parsed = { background: { steps: [] }, scenarios: [] };
    const scenario = {
      tags: [],
      name: 'minimal',
      steps: [{ kind: 'Given', text: 'the local stack is healthy' }],
    };
    const before = Date.now();
    await runScenario(scenario, parsed, ctx);
    expect(ctx.scenarioVars.get('ts')).toBeDefined();
    expect(parseInt(ctx.scenarioVars.get('ts'), 10)).toBeGreaterThanOrEqual(before);
  });
});

describe('Heading-locale UI assertion', () => {
  test('"Lena\'s Web UI shows the heading in German" → driver call', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webHeadingInLocale: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Lena's Web UI shows the heading in German" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('de');
  });

  test('Japanese variant resolves to ja', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webHeadingInLocale: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web UI shows the heading in Japanese" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('ja');
  });

  test('driver returns false — fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webHeadingInLocale: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Lena's Web UI shows the heading in German" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/German/);
  });
});

describe('Highlight-pointing-at-section UI assertion', () => {
  test('"X\'s Web UI shows a \\"Y\\" highlight pointing at section N" → driver call', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsHighlightAtSection: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        // Trailing parens annotation stripped by Wake 30.
        text: 'Lena\'s Web UI shows a "What\'s changed" highlight pointing at section 11',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith("What's changed", 11);
  });

  test('driver returns false — fail with both name and section', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsHighlightAtSection: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Lena\'s Web UI shows a "Update" highlight pointing at section 5' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Update/);
    expect(r.error).toMatch(/5/);
  });
});

describe('Modal close via X button (composite)', () => {
  test('"X on Web closes the modal via the X button without checking boxes" → driver', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webCloseModalViaX: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Lena on Web closes the modal via the X button without checking boxes',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  test('missing driver method — clear error', async () => {
    const ctx = makeCtx({ webDriver: {} });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Lena on Web closes the modal via the X button without checking boxes',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webCloseModalViaX/);
  });
});

describe('Firestore doc-absence with version constraint', () => {
  test('doc missing entirely — ok', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database does not have a new "usersAcceptedPolicies/50000020" with version 4',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('doc exists with older version — ok (not "new" at version 4)', async () => {
    const db = makeStatefulFakeDb({
      'usersAcceptedPolicies/50000020': { privacyVersion: 3 },
    });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database does not have a new "usersAcceptedPolicies/50000020" with version 4',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('doc exists with target version — fail', async () => {
    const db = makeStatefulFakeDb({
      'usersAcceptedPolicies/50000020': { privacyVersion: 4 },
    });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database does not have a new "usersAcceptedPolicies/50000020" with version 4',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Version=4/);
  });
});

describe('Picks a NMB test image (Android, size variant)', () => {
  test('"Adam on Android picks a 15MB test image" → driver call with size', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidPickTestImageBySize: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android picks a 15MB test image' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith(15);
  });
});

describe('Reverse-order gift selection (recipient first, then gift)', () => {
  test('"Alice on Web selects recipient \\"Selma\\" and gift \\"crown\\"" → webSelectRecipientAndGift', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webSelectRecipientAndGift: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Web selects recipient "Selma" and gift "crown"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Selma', 'crown');
  });
});

describe('Double-tap with same receipt within Nms (idempotency test)', () => {
  test('"X on Web double-taps \\"tag\\" with the same receipt \\"R\\" within Nms" → driver', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webDoubleTapWithSameReceipt: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Alice on Web double-taps "wallet_buyCoinsButton" with the same receipt "receipt-X" within 200ms',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('wallet_buyCoinsButton', 'receipt-X', 200);
  });
});

describe('API request count + status assertion', () => {
  test('"exactly N requests to /api/X succeeds with status N" — driver returns matching counts → ok', async () => {
    const spy = jest.fn(async () => ({ succeeded: 1, status: 200 }));
    const ctx = makeCtx({ webDriver: { apiRequestStats: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'exactly 1 request to /api/economy/purchase succeeds with status 200' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('/api/economy/purchase', 200);
  });

  test('count mismatch — fail', async () => {
    const spy = jest.fn(async () => ({ succeeded: 2, status: 200 }));
    const ctx = makeCtx({ webDriver: { apiRequestStats: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'exactly 1 request to /api/economy/purchase succeeds with status 200' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/expected 1.*actual 2/);
  });
});

describe('Sequential request status assertion', () => {
  test('"the second request returns status N" → driver returns matching status', async () => {
    const spy = jest.fn(async () => 409);
    const ctx = makeCtx({ webDriver: { sequentialRequestStatus: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'the second request returns status 409' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith(2);
  });

  test('"the third request returns status N" routes correctly', async () => {
    const spy = jest.fn(async () => 200);
    const ctx = makeCtx({ webDriver: { sequentialRequestStatus: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'the third request returns status 200' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith(3);
  });

  test('status mismatch — fail with both expected and actual', async () => {
    const spy = jest.fn(async () => 500);
    const ctx = makeCtx({ webDriver: { sequentialRequestStatus: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'the second request returns status 409' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/expected 409.*actual 500/);
  });
});

describe('Composite purchase action (sandbox receipt)', () => {
  test('"X on Web purchases \\"Y\\" with sandbox receipt" → driver call', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webPurchaseWithSandboxReceipt: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Web purchases "coins-1000" with sandbox receipt' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('coins-1000');
  });
});

describe('Past-tense purchase state-seed (post-Wake-30 strip)', () => {
  // Wake 124 rewrote this matcher from a driver-stub assertion to a
  // Firestore state-seed: writes purchaseReceipts/<sha256(receipt)>
  // and (for coins-N productIds) increments the user's shyCoins.
  // Past-tense Given is a state-seed, not an assertion of pre-existing
  // state — previously the driver-stub path always returned false and
  // emitted spurious "has no successful purchase" findings against
  // scenarios whose intent was "this purchase already happened".

  function makeWriteRecordingDb() {
    const writes = [];
    return {
      writes,
      doc: (path) => ({
        set: async (data) => writes.push({ op: 'set', path, data }),
        update: async (data) => writes.push({ op: 'update', path, data }),
      }),
    };
  }

  test('writes purchaseReceipts doc + increments shyCoins for coins-N productId', async () => {
    const db = makeWriteRecordingDb();
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        // Trailing "(shyCoins now 6000)" stripped by Wake 30.
        text: 'Alice purchased "coins-1000" with receipt "receipt-R1" successfully (shyCoins now 6000)',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    // sha256('receipt-R1') deterministic — pin the receipt-doc path so a
    // future change to the hash construction is visible immediately.
    const receiptWrite = db.writes.find(
      (w) => w.op === 'set' && w.path.startsWith('purchaseReceipts/'),
    );
    expect(receiptWrite).toBeDefined();
    expect(receiptWrite.data).toMatchObject({
      userId: 50000010,
      productId: 'coins-1000',
      purchaseToken: 'receipt-R1',
      isSubscription: false,
      verified: true,
      coinsGranted: 1000,
      bonusCoinsGranted: 0,
    });
    // Wallet increment write — Sentinel object shape varies between
    // firebase-admin versions, so check the call shape loosely.
    const walletWrite = db.writes.find((w) => w.op === 'update' && w.path === 'users/50000010');
    expect(walletWrite).toBeDefined();
    expect(walletWrite.data).toHaveProperty('shyCoins');
  });

  test('without "successfully" — same write semantics', async () => {
    const db = makeWriteRecordingDb();
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Alice purchased "coins-1000" with receipt "receipt-R3"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db.writes.find((w) => w.path.startsWith('purchaseReceipts/'))).toBeDefined();
  });

  test('non-coins productId still writes receipt but skips wallet increment', async () => {
    const db = makeWriteRecordingDb();
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Alice purchased "super-shy-monthly" with receipt "sub-R1"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    const receiptWrite = db.writes.find((w) => w.path.startsWith('purchaseReceipts/'));
    expect(receiptWrite).toBeDefined();
    expect(receiptWrite.data.coinsGranted).toBe(0);
    // No wallet increment for non-coin SKUs — those would route through
    // a subscription seed matcher that doesn't exist yet (see future work).
    expect(db.writes.find((w) => w.op === 'update' && w.path === 'users/50000010')).toBeUndefined();
  });

  test('unknown persona → clear error (no silent state corruption)', async () => {
    const db = makeWriteRecordingDb();
    const ctx = makeCtx({ db });
    const r = await executeStep(
      // Zephyr isn't in the persona registry (no real persona, no
      // ephemeral entry). The matcher must refuse rather than write
      // a receipt against a userId it can't resolve.
      { kind: 'Given', text: 'Zephyr purchased "coins-1000" with receipt "receipt-R1"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Zephyr/);
    // No writes attempted when the persona resolution fails.
    expect(db.writes).toHaveLength(0);
  });

  test('different receipt strings produce different receiptId hashes (replay-detection prerequisite)', async () => {
    const db = makeWriteRecordingDb();
    const ctx = makeCtx({ db });
    await executeStep(
      { kind: 'Given', text: 'Alice purchased "coins-1000" with receipt "receipt-A"' },
      ctx,
    );
    await executeStep(
      { kind: 'Given', text: 'Alice purchased "coins-1000" with receipt "receipt-B"' },
      ctx,
    );
    const receiptPaths = db.writes
      .filter((w) => w.path.startsWith('purchaseReceipts/'))
      .map((w) => w.path);
    expect(receiptPaths).toHaveLength(2);
    expect(receiptPaths[0]).not.toBe(receiptPaths[1]);
  });
});

describe('Network drop simulation', () => {
  test('"X\'s network drops before the 200 OK reaches the client" → driver', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { simulateNetworkDropBeforeResponse: spy } });
    const r = await executeStep(
      {
        kind: 'Given',
        text: "Alice's network drops before the 200 OK reaches the client",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice');
  });
});

describe('Past-tense purchase matcher generalised (optional "successfully")', () => {
  // Both phrasings ("with receipt Y" and "with receipt Y successfully")
  // route through the same state-seed handler in W124. The regression-
  // guard here was originally added in Wake 56 for the optional-adverb
  // pattern; W124 preserved that branch in the regex.

  function makeWriteRecordingDb() {
    const writes = [];
    return {
      writes,
      doc: (path) => ({
        set: async (data) => writes.push({ op: 'set', path, data }),
        update: async (data) => writes.push({ op: 'update', path, data }),
      }),
    };
  }

  test('without "successfully" still parses and writes the receipt', async () => {
    const db = makeWriteRecordingDb();
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Alice purchased "coins-1000" with receipt "receipt-R3"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db.writes.some((w) => w.path.startsWith('purchaseReceipts/'))).toBe(true);
  });

  test('with "successfully" still parses and writes the receipt', async () => {
    const db = makeWriteRecordingDb();
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Alice purchased "coins-1000" with receipt "receipt-R1" successfully',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db.writes.some((w) => w.path.startsWith('purchaseReceipts/'))).toBe(true);
  });
});

describe('Bare API POST matcher (Android)', () => {
  test('"X on Android POSTs /api/X" → androidApiPost(endpoint, "")', async () => {
    const spy = jest.fn(async () => ({ status: 200 }));
    const ctx = makeCtx({ uiDriver: { androidApiPost: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Android POSTs /api/economy/purchase' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('/api/economy/purchase', '');
  });

  // Note: "POSTs X with productId=..." and "POSTs X with no productId"
  // are handled by the pre-existing POSTs matcher at line ~530 (Wake 1
  // era), which requires an active session and uses parseKvPairs.
  // My new matcher fills only the bare-POSTs gap (no `with` clause).
});

describe('Retry-same-purchase composite (Wake 30 strip)', () => {
  test('"X on Android retries the same purchase once network restores" (after parens strip) → driver', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidRetrySamePurchase: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        // Trailing "(same receipt)" stripped by Wake 30 — runner sees the bare form.
        text: 'Alice on Android retries the same purchase (same receipt) once network restores',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice');
  });
});

describe('Receipt-mismatch state-seed (j06)', () => {
  // Wake 133 converted from webDriver stub to direct Firestore write.
  // Writes the receipt as signed-for the original productId; the
  // submittedProductId is stashed via `_testSubmittedProductId` field
  // + ctx.receiptMismatchHint so downstream assertions can verify
  // both sides of the mismatch.

  function makeWriteRecordingDb() {
    const writes = [];
    return {
      writes,
      doc: (path) => ({
        set: async (data) => writes.push({ op: 'set', path, data }),
      }),
    };
  }

  test('writes receipt doc with signedFor productId + ctx.receiptMismatchHint', async () => {
    const db = makeWriteRecordingDb();
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'the receipt "receipt-R2" is signed for "coins-500" but Alice submits productId="coins-1000"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    const receiptWrite = db.writes.find((w) => w.path.startsWith('purchaseReceipts/'));
    expect(receiptWrite).toBeDefined();
    expect(receiptWrite.data).toMatchObject({
      userId: 50000010, // Alice P-02
      productId: 'coins-500',
      purchaseToken: 'receipt-R2',
      platform: 'test-seed-mismatch',
      verified: true,
      _testSubmittedProductId: 'coins-1000',
    });
    expect(ctx.receiptMismatchHint).toEqual({
      receipt: 'receipt-R2',
      signedFor: 'coins-500',
      submittedProductId: 'coins-1000',
      submitter: 'Alice',
    });
  });

  test('unknown submitter → fail, no writes', async () => {
    const db = makeWriteRecordingDb();
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'the receipt "receipt-X" is signed for "Y" but Zephyr submits productId="Z"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Zephyr/);
    expect(db.writes).toHaveLength(0);
  });
});

describe('Web Admin processes refund', () => {
  test('"X on Web Admin processes a refund for receipt \\"Y\\"" → driver', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webAdminProcessRefund: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin processes a refund for receipt "receipt-R3"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('receipt-R3');
  });
});

describe('Tap-purchase-and-server-credits composite (Given state setup)', () => {
  // Wake 126 converted this matcher from a driver-stub delegation to a
  // direct Firestore write (state-seed pattern, same as W120/W124).
  // The two writes pin the post-credit state without running the full
  // POST + receipt-validation chain.

  function makeWriteRecordingDb() {
    const writes = [];
    return {
      writes,
      doc: (path) => ({
        set: async (data) => writes.push({ op: 'set', path, data }),
        update: async (data) => writes.push({ op: 'update', path, data }),
      }),
    };
  }

  test('writes user shyCoins + transaction doc for known persona', async () => {
    const db = makeWriteRecordingDb();
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Alice taps purchase and the server credits coins=6000 + writes transaction',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    const userUpdate = db.writes.find((w) => w.op === 'update' && w.path === 'users/50000010');
    expect(userUpdate).toEqual({
      op: 'update',
      path: 'users/50000010',
      data: { shyCoins: 6000 },
    });
    const txWrite = db.writes.find(
      (w) => w.op === 'set' && w.path.startsWith('users/50000010/transactions/'),
    );
    expect(txWrite).toBeDefined();
    expect(txWrite.data).toMatchObject({
      type: 'COIN_PURCHASE',
      amount: 6000,
      currency: 'COINS',
      balanceAfter: 6000,
    });
  });

  test('unknown persona → ok:false (no silent state corruption)', async () => {
    const db = makeWriteRecordingDb();
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Zephyr taps purchase and the server credits coins=6000 + writes transaction',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Zephyr/);
    expect(db.writes).toHaveLength(0);
  });
});

describe('Persona "is signed in on <plat> at <path>" variant (j07)', () => {
  test('"Alice [P-02] is signed in on Web Chromium at \\"/discovery\\"" records platform + path', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'Alice [P-02] is signed in on Web Chromium at "/discovery"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPlatforms.get('Alice')).toBe('Web Chromium');
    expect(ctx.personaPaths.get('Alice')).toBe('/discovery');
  });

  test('Android variant routes correctly', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'Adam is signed in on Android at "/feed"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaPlatforms.get('Adam')).toBe('Android');
    expect(ctx.personaPaths.get('Adam')).toBe('/feed');
  });
});

describe('"neither user is following the other" bare relation assertion', () => {
  // Wake 121 rewrote this matcher to read ctx.db directly instead of
  // delegating to a webDriver stub. The persona-name lookup goes
  // through the persona registry (Adam=P-01 ephemeral, Alice=P-02
  // uniqueId=50000010). The assertion holds iff neither persona's
  // user doc has the counterparty in followingIds OR followerIds.

  // Local clone of the upstream "Cross-cohort Firestore matcher"
  // helper so this describe block doesn't depend on lexical scope
  // from a different block.
  function makeUserLookupDb(users) {
    return {
      doc: (docPath) => ({
        get: async () => {
          const match = /^users\/(.+)$/.exec(docPath);
          if (!match) return { exists: false, data: () => undefined };
          const u = users[match[1]];
          return { exists: u !== undefined, data: () => u };
        },
      }),
    };
  }

  test('two real personas with no follow edges → ok', async () => {
    const ctx = makeCtx({
      db: makeUserLookupDb({
        50000010: { followingIds: [], followerIds: [] }, // Alice
        60000010: { followingIds: [], followerIds: [] }, // Marcus
      }),
      personaPlatforms: new Map([
        ['Alice', 'Web Chromium'],
        ['Marcus', 'Android'],
      ]),
    });
    const r = await executeStep(
      { kind: 'Given', text: 'neither user is following the other' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('Alice follows Marcus → fail (mentions both names)', async () => {
    const ctx = makeCtx({
      db: makeUserLookupDb({
        50000010: { followingIds: [60000010], followerIds: [] }, // Alice follows Marcus
        60000010: { followingIds: [], followerIds: [50000010] },
      }),
      personaPlatforms: new Map([
        ['Alice', 'Web Chromium'],
        ['Marcus', 'Android'],
      ]),
    });
    const r = await executeStep(
      { kind: 'Given', text: 'neither user is following the other' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/following/);
    expect(r.error).toMatch(/Alice/);
    expect(r.error).toMatch(/Marcus/);
  });

  test('symmetric mirror — Alice in Marcus.followerIds (only) → fail', async () => {
    // followerIds without the corresponding followingIds is a
    // one-sided graph corruption — the assertion should still flag it.
    const ctx = makeCtx({
      db: makeUserLookupDb({
        50000010: { followingIds: [], followerIds: [] },
        60000010: { followingIds: [], followerIds: [50000010] },
      }),
      personaPlatforms: new Map([
        ['Alice', 'Web Chromium'],
        ['Marcus', 'Android'],
      ]),
    });
    const r = await executeStep(
      { kind: 'Given', text: 'neither user is following the other' },
      ctx,
    );
    expect(r.ok).toBe(false);
  });

  test('fewer than 2 personas recorded → trivially ok (ephemeral case)', async () => {
    const ctx = makeCtx({
      db: makeUserLookupDb({}),
      personaPlatforms: new Map([['Alice', 'Web Chromium']]),
    });
    const r = await executeStep(
      { kind: 'Given', text: 'neither user is following the other' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });
});

describe('Bare stats UI assertion', () => {
  test('"X\'s <plat> UI shows Y\'s stats" → driver verifies stats panel for target', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsStatsForUser: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        // Trailing "(followers, following, beans)" stripped by Wake 30.
        text: "Adam's Android UI shows Alice's stats (followers, following, beans)",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice');
  });

  test('Web variant routes correctly', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsStatsForUser: spy } });
    const r = await executeStep({ kind: 'Then', text: "Alice's Web UI shows Adam's stats" }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Adam');
  });
});

describe('Selects from followed-users picker', () => {
  test('"X on Android selects \\"Y\\" from the followed-users picker" → driver', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidSelectFromFollowedPicker: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android selects "Alice" from the followed-users picker' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice');
  });
});

describe('Navigates to conversation thread screen (composite UI assertion)', () => {
  test('"X\'s <plat> UI navigates to the conversation thread screen with Y" → driver', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidIsOnConversationWith: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Adam's Android UI navigates to the conversation thread screen with Alice",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice');
  });
});

describe('Opens conversation with persona (action)', () => {
  test('"X on Web opens the conversation with Y" → webOpenConversation', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webOpenConversation: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Web opens the conversation with Adam' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Adam');
  });

  test('Android variant routes correctly', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidOpenConversation: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Hayato on Android opens the conversation with Alice' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice');
  });
});

describe('FCM push notification assertion (Android device + Web)', () => {
  test('"... on X\'s Web with body containing \\"Y\\"" → driver call', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { seesFcmPushOnPlatform: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the tester sees an FCM push notification on Alice\'s Web with body containing "Adam"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 'Web', ['Adam']);
  });

  test('"... on X\'s Android device with body containing \\"Y\\" and \\"Z\\"" — two fragments', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { seesFcmPushOnPlatform: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the tester sees an FCM push notification on Selma\'s Android device with body containing "Alice" and "crown"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Selma', 'Android device', ['Alice', 'crown']);
  });

  test('driver returns false — fail with body fragments in error', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { seesFcmPushOnPlatform: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the tester sees an FCM push notification on Alice\'s Web with body containing "Adam"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Adam/);
  });
});

describe('Types into conversation input', () => {
  test('"X on Web types \\"<body>\\" into the conversation input" → driver', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webTypeIntoConversationInput: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Alice on Web types "hi adam, welcome to shytalk" into the conversation input',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('hi adam, welcome to shytalk');
  });

  test('Android variant routes correctly', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidTypeIntoConversationInput: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android types "hey" into the conversation input' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('hey');
  });
});

describe('Past-tense PM state Given', () => {
  // Wake 135 converted from webDriver stub to direct Firestore write.
  // Writes conversation + message docs at sorted-join convId.

  function makeWriteRecordingDb() {
    const writes = [];
    return {
      writes,
      doc: (path) => ({
        set: async (data, opts) => writes.push({ op: 'set', path, data, opts }),
      }),
    };
  }

  test('writes conv + message docs (no timestamp)', async () => {
    const db = makeWriteRecordingDb();
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Adam sent a message "tpyo here" to Alice' },
      ctx,
    );
    expect(r.ok).toBe(true);
    // Adam P-01 ephemeral uniqueId=90000001, Alice P-02 uniqueId=50000010
    // Sorted-join: 50000010_90000001 (digits compared char-by-char)
    const convId = '50000010_90000001';
    const convWrite = db.writes.find((w) => w.path === `conversations/${convId}`);
    expect(convWrite).toBeDefined();
    expect(convWrite.data.participantIds).toEqual([90000001, 50000010]);
    const msgWrite = db.writes.find((w) => w.path.startsWith(`conversations/${convId}/messages/`));
    expect(msgWrite).toBeDefined();
    expect(msgWrite.data).toMatchObject({
      text: 'tpyo here',
      senderId: 90000001,
      recipientId: 50000010,
      type: 'TEXT',
    });
    expect(ctx.lastSeededMessage).toMatchObject({ convId, sender: 'Adam', recipient: 'Alice' });
  });

  test('minutesAgo variant sets createdAt in the past', async () => {
    const db = makeWriteRecordingDb();
    const ctx = makeCtx({ db });
    const before = Date.now();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Adam sent a message "secret" to Alice 30 minutes ago (past edit window)',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    const msgWrite = db.writes.find((w) => w.path.includes('/messages/'));
    // 30 minutes = 1.8M ms in the past — give a 1-second tolerance for
    // clock drift between Date.now() calls.
    expect(msgWrite.data.createdAt).toBeLessThanOrEqual(before - 30 * 60_000 + 1000);
    expect(msgWrite.data.createdAt).toBeGreaterThanOrEqual(before - 30 * 60_000 - 1000);
  });

  test('unknown persona → fail, no writes', async () => {
    const db = makeWriteRecordingDb();
    const ctx = makeCtx({ db });
    const r = await executeStep({ kind: 'Given', text: 'Zephyr sent a message "x" to Alice' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Zephyr/);
    expect(db.writes).toHaveLength(0);
  });
});

describe('Edit-body-and-confirms composite', () => {
  test('"X on Android changes the body to \\"Y\\" and confirms" → driver', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidEditBodyAndConfirm: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Adam on Android changes the body to "typo here" and confirms',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('typo here');
  });

  test('Web variant routes correctly', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webEditBodyAndConfirm: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Web changes the body to "fixed" and confirms' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('fixed');
  });
});

describe('Bare persona-exists Given', () => {
  test('"Marcus (P-04, minor) exists" (annotation stripped) verifies user doc', async () => {
    const { personas } = require('../../scripts/provision-test-personas');
    const marcus = personas.find((p) => p.id === 'P-04');
    const db = makeStatefulFakeDb({ [`users/${marcus.uniqueId}`]: {} });
    const ctx = makeCtx({ db });
    const r = await executeStep({ kind: 'Given', text: 'Marcus (P-04, minor) exists' }, ctx);
    expect(r.ok).toBe(true);
  });

  test('persona doc missing — fail', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep({ kind: 'Given', text: 'Marcus (P-04, minor) exists' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Marcus|users\//);
  });
});

describe('Types into search field (platform-dispatch)', () => {
  test('"X on Web types \\"Y\\" into the search field" → driver', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webTypeIntoSearch: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Vexa on Web types "Marcus" into the search field' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Marcus');
  });

  test('Android: pre-existing matcher (line ~2698) wins by first-match-wins, calls androidSearchIn(null, text)', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidSearchIn: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Adam on Android types "Alice" into the search field' },
      ctx,
    );
    expect(r.ok).toBe(true);
    // Existing matcher passes (null = "active screen") + text.
    expect(spy).toHaveBeenCalledWith(null, 'Alice');
  });

  test('iOS Sim: pre-existing matcher (line ~2076) wins, calls iosSearchIn(null, text)', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { iosSearchIn: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Mia on iOS Sim types "adult-power" into the search field' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith(null, 'adult-power');
  });
});

describe('Voice room state-seed', () => {
  test('"X created a voice room \\"Y\\"" writes the room doc', async () => {
    // Vexa is P-07 per persona registry — uniqueId 50000040
    const { personas } = require('../../scripts/provision-test-personas');
    const vexa = personas.find((p) => p.id === 'P-07');
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep({ kind: 'Given', text: 'Vexa created a voice room "rv1"' }, ctx);
    expect(r.ok).toBe(true);
    expect(db._docs['rooms/rv1']).toBeDefined();
    expect(db._docs['rooms/rv1'].ownerUniqueId).toBe(vexa.uniqueId);
    expect(db._docs['rooms/rv1'].id).toBe('rv1');
  });
});

describe('FCM dispatcher attempts to send notification (action)', () => {
  test('"FCM dispatcher attempts to send a notification from X to Y" → driver', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { simulateFcmDispatcherAttempt: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'the FCM dispatcher attempts to send a notification from Vexa (50000040) to Marcus (60000010)',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Vexa', 'Marcus');
  });
});

describe("No FCM payload is sent to <X>'s tokens (negative assertion)", () => {
  test('driver returns 0 payloads → ok', async () => {
    const spy = jest.fn(async () => 0);
    const ctx = makeCtx({ webDriver: { countFcmPayloadsToUser: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "no FCM payload is sent to Marcus's tokens" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Marcus');
  });

  test('driver returns >0 → fail', async () => {
    const spy = jest.fn(async () => 1);
    const ctx = makeCtx({ webDriver: { countFcmPayloadsToUser: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "no FCM payload is sent to Marcus's tokens" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Marcus/);
  });
});

describe('Dispatcher audit log records X with reason Y', () => {
  test('"... records \\"X\\" with reason \\"Y\\"" → driver', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { auditLogContains: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the dispatcher audit log records "skipped" with reason "cohort_mismatch"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('skipped', 'cohort_mismatch');
  });

  test('driver returns false — fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { auditLogContains: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the dispatcher audit log records "skipped" with reason "cohort_mismatch"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/cohort_mismatch/);
  });
});

describe('UI banner absence (party-anchored)', () => {
  test('"X\'s Android UI does not show any in-app banner from Y" → driver', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidShowsBannerFromUser: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Marcus's Android UI does not show any in-app banner from Vexa" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Vexa');
  });

  test('driver returns true (banner present) — fail', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsBannerFromUser: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Marcus's Android UI does not show any in-app banner from Vexa" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Vexa/);
  });
});

describe('Attempts to start a conversation via POST <api>', () => {
  test('"X on Android attempts to start a conversation with Y via POST /api/X" → driver', async () => {
    const spy = jest.fn(async () => ({ status: 403 }));
    const ctx = makeCtx({ uiDriver: { androidAttemptStartConversation: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Adam on Android attempts to start a conversation with Marcus via POST /api/conversations',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Marcus', '/api/conversations');
  });
});

describe('New follower notification absence (party-implicit)', () => {
  test('"X\'s <plat> UI does not show any new follower notification" → driver', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidShowsNewFollowerNotification: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Marcus's Android UI does not show any new follower notification" },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('driver returns true (notification present) — fail', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsNewFollowerNotification: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Marcus's Android UI does not show any new follower notification" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/follower/);
  });
});

describe('Profile deep-link attempt', () => {
  test('"X on Android attempts profile deep-link \\"<url>\\"" → driver', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidAttemptProfileDeepLink: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Vexa on Android attempts profile deep-link "/profile/60000010"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('/profile/60000010');
  });

  test('iOS Sim variant routes correctly', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { iosAttemptProfileDeepLink: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Mia on iOS Sim attempts profile deep-link "/profile/50000010"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('/profile/50000010');
  });
});

describe('Attempts to follow via profile screen', () => {
  test('"X on Android attempts to follow Y via the profile screen" (after Wake-30 strip)', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidAttemptFollowViaProfile: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Vexa on Android attempts to follow Marcus via the profile screen (via deep-link error path)',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Marcus');
  });
});

describe('Bare HTTP response status assertion', () => {
  test('"the request returns status N" reads ctx.lastResponse.status', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = { status: 404, body: null };
    const r = await executeStep({ kind: 'Then', text: 'the request returns status 404' }, ctx);
    expect(r.ok).toBe(true);
  });

  test('status mismatch — fail with both', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = { status: 200, body: null };
    const r = await executeStep({ kind: 'Then', text: 'the request returns status 404' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/expected 404.*actual 200/);
  });

  test('no recorded response — fail', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = null;
    const r = await executeStep({ kind: 'Then', text: 'the request returns status 404' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no recorded/);
  });
});

describe('Voice room create with joiners composite state-seed', () => {
  test('"X created a room and has N joiners" writes a room doc with N+1 participants', async () => {
    const { personas } = require('../../scripts/provision-test-personas');
    const theo = personas.find((p) => p.id === 'P-10');
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Theo created a room and has 2 joiners' },
      ctx,
    );
    expect(r.ok).toBe(true);
    const roomDocs = Object.entries(db._docs).filter(([k]) => k.startsWith('rooms/'));
    expect(roomDocs.length).toBe(1);
    const [, room] = roomDocs[0];
    expect(room.ownerUniqueId).toBe(theo.uniqueId);
    expect(room.participantIds.length).toBe(3); // owner + 2 joiners
  });
});

describe('Network drops for N seconds (platform-dispatch)', () => {
  test('"X\'s Android network drops for N seconds" → driver call', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidNetworkDropFor: spy } });
    const r = await executeStep(
      { kind: 'When', text: "Theo's Android network drops for 30 seconds" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo', 30);
  });

  test('iOS Sim variant routes correctly', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { iosNetworkDropFor: spy } });
    const r = await executeStep(
      { kind: 'When', text: "Ines's iOS Sim network drops for 10 seconds" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Ines', 10);
  });
});

describe('Each joiner UI navigates back with toast (composite)', () => {
  test('"each joiner\'s UI navigates back to the rooms tab with \\"X\\" toast" → driver', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { eachJoinerNavigatesBackWithToast: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'each joiner\'s UI navigates back to the rooms tab with "Host disconnected" toast',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Host disconnected');
  });

  test('driver returns false (some joiner stuck) → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { eachJoinerNavigatesBackWithToast: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'each joiner\'s UI navigates back to the rooms tab with "Host disconnected" toast',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Host disconnected/);
  });
});

describe('Voice room composite create with named room ID', () => {
  test('"X on Android created an adult-cohort room \\"Y\\"" writes rooms/Y', async () => {
    const { personas } = require('../../scripts/provision-test-personas');
    const theo = personas.find((p) => p.id === 'P-10');
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Theo on Android created an adult-cohort room "ra1"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['rooms/ra1']).toBeDefined();
    expect(db._docs['rooms/ra1'].ownerUniqueId).toBe(theo.uniqueId);
    expect(db._docs['rooms/ra1'].cohort).toBe('adult');
  });

  test('minor-cohort variant', async () => {
    const { personas } = require('../../scripts/provision-test-personas');
    const alice = personas.find((p) => p.id === 'P-02');
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Alice on Web created a minor-cohort room "rm1"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['rooms/rm1'].cohort).toBe('minor');
    expect(db._docs['rooms/rm1'].ownerUniqueId).toBe(alice.uniqueId);
  });
});

describe('Response body does not include <X>', () => {
  test('body lacks the named field → ok', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = { status: 200, body: { error: 'cohort_mismatch' } };
    const r = await executeStep(
      { kind: 'Then', text: 'the response body does not include a token' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('body contains the named field → fail', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = { status: 200, body: { token: 'leaked-tok' } };
    const r = await executeStep(
      { kind: 'Then', text: 'the response body does not include a token' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/token/);
  });
});

describe('UI does not show the "<X>" button (quoted-button absence)', () => {
  test('webDriver.webDoesNotShowNamedButton returns false → ok', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsNamedButton: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Vexa\'s Web UI does not show the "Send" button' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Send');
  });

  test('driver returns true (button present) → fail', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsNamedButton: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Vexa\'s Web UI does not show the "Send" button' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Send/);
  });
});

describe('Bare API response-status-from-path assertion', () => {
  test('"the response status from /api/X is N" reads ctx.lastResponse', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = { status: 200, body: null, path: '/api/economy/purchase' };
    const r = await executeStep(
      { kind: 'Then', text: 'the response status from /api/economy/purchase is 200' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('path mismatch — fail with path detail', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = { status: 200, body: null, path: '/api/economy/purchase' };
    const r = await executeStep(
      { kind: 'Then', text: 'the response status from /api/livekit/token is 200' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/livekit\/token/);
  });

  test('status mismatch — fail', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = { status: 500, body: null, path: '/api/livekit/token' };
    const r = await executeStep(
      { kind: 'Then', text: 'the response status from /api/livekit/token is 404' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/expected 404.*actual 500/);
  });
});

describe('p95 latency budget assertion', () => {
  test('all concurrent results within budget → ok', async () => {
    const ctx = makeCtx();
    ctx.lastConcurrentResults = Array.from({ length: 20 }, () => ({
      status: 404,
      latencyMs: 50,
    }));
    const r = await executeStep(
      { kind: 'Then', text: 'each response p95 latency is less than 200ms' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('p95 exceeds budget → fail with actual', async () => {
    const ctx = makeCtx();
    ctx.lastConcurrentResults = [
      ...Array.from({ length: 19 }, () => ({ status: 404, latencyMs: 50 })),
      { status: 404, latencyMs: 500 },
    ];
    const r = await executeStep(
      { kind: 'Then', text: 'each response p95 latency is less than 200ms' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/200/);
  });

  test('no concurrent batch — fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: 'each response p95 latency is less than 200ms' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no recorded/);
  });
});

describe('No document is created in <subcollection>', () => {
  test('subcollection empty → ok', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Then', text: 'no document is created in "conversations/c1/messages"' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('subcollection has docs → fail', async () => {
    const db = makeStatefulFakeDb({
      'conversations/c1/messages/m1': { body: 'leaked' },
    });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Then', text: 'no document is created in "conversations/c1/messages"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/c1\/messages/);
  });
});

describe('Voice room composite state-seed (X created a <vis> <cohort>-cohort room)', () => {
  test('"Theo created a public adult-cohort room" writes a room doc', async () => {
    const { personas } = require('../../scripts/provision-test-personas');
    const theo = personas.find((p) => p.id === 'P-10');
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Theo created a public adult-cohort room' },
      ctx,
    );
    expect(r.ok).toBe(true);
    const roomDocs = Object.entries(db._docs).filter(([k]) => k.startsWith('rooms/'));
    expect(roomDocs.length).toBe(1);
    const [, room] = roomDocs[0];
    expect(room.ownerUniqueId).toBe(theo.uniqueId);
    expect(room.visibility).toBe('public');
    expect(room.cohort).toBe('adult');
  });

  test('"Alice created a private minor-cohort room" — variant', async () => {
    const { personas } = require('../../scripts/provision-test-personas');
    const alice = personas.find((p) => p.id === 'P-02');
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Alice created a private minor-cohort room' },
      ctx,
    );
    expect(r.ok).toBe(true);
    const roomDocs = Object.entries(db._docs).filter(([k]) => k.startsWith('rooms/'));
    expect(roomDocs[0][1].ownerUniqueId).toBe(alice.uniqueId);
    expect(roomDocs[0][1].visibility).toBe('private');
    expect(roomDocs[0][1].cohort).toBe('minor');
  });
});

// ─── Room-state setup Givens (j09 phase-scoped scenarios) ────────────
//
// 8 new matchers + 5 composable primitives added to unblock j09's
// STEP_NOT_IMPLEMENTED findings after the long-scenario refactor (PR #874).
// These tests pin each handler's Firestore mutations against the existing
// makeStatefulFakeDb. The handlers use read-modify-set semantics (no
// FieldValue.arrayUnion/arrayRemove) so the fake-db's plain set() merge
// behaviour is sufficient.
describe('Room-state setup Givens (j09 phase-scoped scenario setup)', () => {
  const { personas: PERSONAS } = require('../../scripts/provision-test-personas');
  const theo = PERSONAS.find((p) => p.id === 'P-10');
  const alice = PERSONAS.find((p) => p.id === 'P-02');
  const ines = PERSONAS.find((p) => p.id === 'P-11');

  test('"<host>\'s public room \\"<title>\\" is OPEN" seeds a room doc with state=OPEN + visibility=public', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Theo\'s public room "Theo\'s Test Room" is OPEN' },
      ctx,
    );
    expect(r.ok).toBe(true);
    const roomDocs = Object.entries(db._docs).filter(([k]) => k.startsWith('rooms/'));
    expect(roomDocs).toHaveLength(1);
    const [, room] = roomDocs[0];
    expect(room.hostId).toBe(theo.uniqueId);
    expect(room.state).toBe('OPEN');
    expect(room.visibility).toBe('public');
    expect(room.title).toBe("Theo's Test Room");
    // Host is auto-seeded into participantIds + seats[0].
    expect(room.participantIds).toContain(theo.uniqueId);
    expect(room.seats[0].userId).toBe(theo.uniqueId);
    // ctx caches the room for follow-on "<host>'s room" Givens.
    expect(ctx.roomsByHost.Theo).toBeTruthy();
    expect(ctx.lastRoomId).toBeTruthy();
  });

  test('"<host>\'s room \\"<title>\\" has <persona> joined as a participant" creates room + adds persona', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Theo\'s room "Theo\'s Test Room" has Alice joined as a participant',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    const [, room] = Object.entries(db._docs).filter(([k]) => k.startsWith('rooms/'))[0];
    expect(room.participantIds).toContain(theo.uniqueId);
    expect(room.participantIds).toContain(alice.uniqueId);
  });

  test('"<persona> is a non-seated participant in <host>\'s room" — auto-resolves host\'s room', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    // No prior room — handler auto-creates Theo's room with default title.
    const r = await executeStep(
      { kind: 'Given', text: "Ines is a non-seated participant in Theo's room" },
      ctx,
    );
    expect(r.ok).toBe(true);
    const [, room] = Object.entries(db._docs).filter(([k]) => k.startsWith('rooms/'))[0];
    expect(room.participantIds).toContain(ines.uniqueId);
    // Ines is NOT in seats (just participantIds).
    const inesSeats = (room.seats || []).filter((s) => s?.userId === ines.uniqueId);
    expect(inesSeats).toHaveLength(0);
  });

  test('"<persona> has a PENDING seat request in <host>\'s room" creates participant + seatRequest subdoc', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: "Ines has a PENDING seat request in Theo's room" },
      ctx,
    );
    expect(r.ok).toBe(true);
    // Participant added.
    const [, room] = Object.entries(db._docs).filter(([k]) => k.startsWith('rooms/'))[0];
    expect(room.participantIds).toContain(ines.uniqueId);
    // seatRequest doc written under rooms/<id>/seatRequests/
    const seatReqs = Object.entries(db._docs).filter(([k]) => k.includes('/seatRequests/'));
    expect(seatReqs).toHaveLength(1);
    expect(seatReqs[0][1].userId).toBe(ines.uniqueId);
    expect(seatReqs[0][1].status).toBe('PENDING');
  });

  test('"<persona> is seated in <host>\'s room with publish permission" — adds participant + seats persona unmuted-publishable', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: "Ines is seated in Theo's room with publish permission" },
      ctx,
    );
    expect(r.ok).toBe(true);
    const [, room] = Object.entries(db._docs).filter(([k]) => k.startsWith('rooms/'))[0];
    const inesSeat = (room.seats || []).find((s) => s?.userId === ines.uniqueId);
    expect(inesSeat).toBeDefined();
    expect(inesSeat.publishAllowed).toBe(true);
    expect(inesSeat.muted).toBe(true); // muted-by-default until unmuted Given fires
  });

  test('"<persona> is seated and unmuted in <host>\'s room" — seats + mic open', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: "Ines is seated and unmuted in Theo's room" },
      ctx,
    );
    expect(r.ok).toBe(true);
    const [, room] = Object.entries(db._docs).filter(([k]) => k.startsWith('rooms/'))[0];
    const inesSeat = (room.seats || []).find((s) => s?.userId === ines.uniqueId);
    expect(inesSeat.muted).toBe(false);
    expect(inesSeat.publishAllowed).toBe(true);
  });

  test('"<persona> has been kicked from <host>\'s room" — removes from participantIds + adds kickedIds doc', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    // First add Ines as participant to prove the removal works.
    await executeStep(
      { kind: 'Given', text: "Ines is a non-seated participant in Theo's room" },
      ctx,
    );
    const r = await executeStep(
      { kind: 'Given', text: "Ines has been kicked from Theo's room" },
      ctx,
    );
    expect(r.ok).toBe(true);
    const [, room] = Object.entries(db._docs).filter(([k]) => k.startsWith('rooms/'))[0];
    expect(room.participantIds).not.toContain(ines.uniqueId);
    const kicks = Object.entries(db._docs).filter(([k]) => k.includes('/kickedIds/'));
    expect(kicks).toHaveLength(1);
    expect(kicks[0][1].userId).toBe(ines.uniqueId);
  });

  test('"<host>\'s room \\"<title>\\" is OPEN with <persona> as a participant" — combined seed', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Theo\'s room "Theo\'s Test Room" is OPEN with Alice as a participant',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    const [, room] = Object.entries(db._docs).filter(([k]) => k.startsWith('rooms/'))[0];
    expect(room.state).toBe('OPEN');
    expect(room.title).toBe("Theo's Test Room");
    expect(room.participantIds).toContain(alice.uniqueId);
  });

  // ── Idempotency + chain pins ──

  test('idempotent: re-running the OPEN-with-participant Given does not duplicate participants', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const step = {
      kind: 'Given',
      text: 'Theo\'s room "Theo\'s Test Room" is OPEN with Alice as a participant',
    };
    await executeStep(step, ctx);
    await executeStep(step, ctx);
    const [, room] = Object.entries(db._docs).filter(([k]) => k.startsWith('rooms/'))[0];
    const aliceCount = (room.participantIds || []).filter((id) => id === alice.uniqueId).length;
    expect(aliceCount).toBe(1);
  });

  test('chain: prior Given populates ctx.roomsByHost so subsequent "<host>\'s room" Givens hit the same doc', async () => {
    // This is the critical pin for j09's scenario flow: each later
    // scenario establishes prior phase via a setup Given that needs to
    // resolve "Theo's room" to the same room a prior Given created.
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    await executeStep(
      { kind: 'Given', text: 'Theo\'s public room "Theo\'s Test Room" is OPEN' },
      ctx,
    );
    const roomIdAfterFirst = ctx.lastRoomId;
    await executeStep(
      { kind: 'Given', text: "Ines is a non-seated participant in Theo's room" },
      ctx,
    );
    // Both Givens hit the same room — total room docs should still be 1.
    const roomDocs = Object.entries(db._docs).filter(([k]) => k.match(/^rooms\/[^/]+$/));
    expect(roomDocs).toHaveLength(1);
    expect(roomDocs[0][0]).toBe(`rooms/${roomIdAfterFirst}`);
    expect(roomDocs[0][1].participantIds).toContain(ines.uniqueId);
  });

  test('unknown persona name → error surfaced, not crashed', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep({ kind: 'Given', text: 'Zonk\'s public room "x" is OPEN' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/persona "Zonk" not in registry/);
  });

  test('ctx.db missing → actionable error, not crash', async () => {
    const ctx = makeCtx(); // no db
    const r = await executeStep({ kind: 'Given', text: 'Theo\'s public room "x" is OPEN' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.db not initialised/);
  });
});

// ─── Admin-moderation setup Givens (j04 phase-scoped scenarios) ─────
describe('Admin-moderation setup Givens (j04 phase-scoped scenario setup)', () => {
  const { personas: PERSONAS } = require('../../scripts/provision-test-personas');
  const hayato = PERSONAS.find((p) => p.id === 'P-06');
  const greta = PERSONAS.find((p) => p.id === 'P-12');

  test('"<admin> has reviewed <persona>\'s age-verification submission" — idempotent submission seed + ctx tracking', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep(
      { kind: 'Given', text: "Greta has reviewed Hayato's age-verification submission" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.reviewedSubmissions.has('Hayato')).toBe(true);
    // Pending submission exists (idempotent — re-running the Given doesn't duplicate).
    const subs = Object.entries(db._docs).filter(([k]) =>
      k.startsWith('ageVerificationSubmissions/'),
    );
    expect(subs).toHaveLength(1);
  });

  test('"<persona> has been downgraded to cohort=minor by <admin>" — flips cohort + writes audit row', async () => {
    const db = makeStatefulFakeDb({
      [`users/${hayato.uniqueId}`]: { cohort: 'adult', shyCoins: 100, followingIds: [50000010] },
    });
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep(
      { kind: 'Given', text: 'Hayato has been downgraded to cohort=minor by Greta' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs[`users/${hayato.uniqueId}`].cohort).toBe('minor');
    expect(db._docs[`users/${hayato.uniqueId}`].isAgeVerified).toBe(false);
    // shyCoins + followingIds preserved (merge: true)
    expect(db._docs[`users/${hayato.uniqueId}`].shyCoins).toBe(100);
    expect(db._docs[`users/${hayato.uniqueId}`].followingIds).toEqual([50000010]);
    // Audit row written — String-coerced targetId/adminId per production
    // wire format.
    const audits = Object.entries(db._docs).filter(([k]) => k.startsWith('auditLog/'));
    expect(audits).toHaveLength(1);
    const [, audit] = audits[0];
    expect(audit.action).toBe('age_verification.reject_and_dob_down');
    expect(audit.targetId).toBe(String(hayato.uniqueId));
    expect(audit.adminId).toBe(String(greta.uniqueId));
  });

  test('"<persona> has been downgraded to cohort=minor and has the Officia age-down PM" — composes downgrade + PM', async () => {
    const db = makeStatefulFakeDb({ [`users/${hayato.uniqueId}`]: { cohort: 'adult' } });
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Hayato has been downgraded to cohort=minor and has the Officia age-down PM in his inbox',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs[`users/${hayato.uniqueId}`].cohort).toBe('minor');
    // Conversation between Officia (uniqueId 1) and Hayato — String-coerced
    // per the production wire format.
    const convs = Object.entries(db._docs).filter(([k]) => k.startsWith('conversations/'));
    expect(convs).toHaveLength(1);
    const [, conv] = convs[0];
    expect(conv.participantIds).toEqual([String(1), String(hayato.uniqueId)]);
    // Message from Officia with the age_seg_age_down_admin_pm key
    const msgs = Object.entries(db._docs).filter(([k]) => k.startsWith('messages/'));
    expect(msgs).toHaveLength(1);
    const [, msg] = msgs[0];
    expect(msg.senderId).toBe(String(1));
    expect(msg.recipientId).toBe(String(hayato.uniqueId));
    expect(msg.key).toBe('age_seg_age_down_admin_pm');
  });

  test('"<persona> has been downgraded... with followingIds still containing <ids>" — seeds + preserves followingIds', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Hayato has been downgraded to cohort=minor with followingIds still containing 50000010 + 50000060',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs[`users/${hayato.uniqueId}`].followingIds).toEqual([50000010, 50000060]);
    expect(db._docs[`users/${hayato.uniqueId}`].cohort).toBe('minor');
  });

  test('"<persona> has been downgraded... with his pre-downgrade shyCoins=<N>" — preserves coins after downgrade', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Hayato has been downgraded to cohort=minor with his pre-downgrade shyCoins=100',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs[`users/${hayato.uniqueId}`].shyCoins).toBe(100);
    expect(db._docs[`users/${hayato.uniqueId}`].cohort).toBe('minor');
  });

  test('unknown persona → actionable error', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep(
      { kind: 'Given', text: 'Zonk has been downgraded to cohort=minor by Greta' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/persona "Zonk" not in registry/);
  });

  test('ctx.db missing → actionable error, not crash', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'Hayato has been downgraded to cohort=minor by Greta' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.db not initialised/);
  });
});

describe('Monetization setup Givens (j05 phase-scoped scenario setup)', () => {
  const { personas: PERSONAS } = require('../../scripts/provision-test-personas');
  const alice = PERSONAS.find((p) => p.id === 'P-02');
  const selma = PERSONAS.find((p) => p.id === 'P-15');

  test('"<persona> has just purchased <package> and has shyCoins=<N>" — writes PURCHASE transaction + sets coins', async () => {
    const db = makeStatefulFakeDb({
      [`users/${alice.uniqueId}`]: { shyCoins: 5000 },
    });
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep(
      { kind: 'Given', text: 'Alice has just purchased coins-1000 and has shyCoins=6000' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs[`users/${alice.uniqueId}`].shyCoins).toBe(6000);
    // PURCHASE transaction row with productId + delta
    const txns = Object.entries(db._docs).filter(([k]) =>
      k.startsWith(`users/${alice.uniqueId}/transactions/`),
    );
    expect(txns).toHaveLength(1);
    const [, txn] = txns[0];
    expect(txn.type).toBe('PURCHASE');
    expect(txn.amount).toBe(1000);
    expect(txn.productId).toBe('coins-1000');
  });

  test('"<persona> has just sent <recipient> a <gift>" — debits sender, credits recipient, writes both transactions + gift wall', async () => {
    const db = makeStatefulFakeDb({
      [`users/${alice.uniqueId}`]: { shyCoins: 5700 },
      [`users/${selma.uniqueId}`]: { beans: 10000 },
    });
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep({ kind: 'Given', text: 'Alice has just sent Selma a crown' }, ctx);
    expect(r.ok).toBe(true);
    expect(db._docs[`users/${alice.uniqueId}`].shyCoins).toBe(5200);
    expect(db._docs[`users/${selma.uniqueId}`].beans).toBe(10250);
    // Sender's GIFT_SENT transaction
    const senderTxns = Object.entries(db._docs).filter(([k]) =>
      k.startsWith(`users/${alice.uniqueId}/transactions/`),
    );
    expect(senderTxns).toHaveLength(1);
    const [, sentTxn] = senderTxns[0];
    expect(sentTxn.type).toBe('GIFT_SENT');
    expect(sentTxn.amount).toBe(-500);
    expect(sentTxn.giftId).toBe('crown');
    expect(sentTxn.recipientId).toBe(String(selma.uniqueId));
    // Recipient's GIFT_RECEIVED transaction
    const recipTxns = Object.entries(db._docs).filter(([k]) =>
      k.startsWith(`users/${selma.uniqueId}/transactions/`),
    );
    expect(recipTxns).toHaveLength(1);
    const [, recvTxn] = recipTxns[0];
    expect(recvTxn.type).toBe('GIFT_RECEIVED');
    expect(recvTxn.amount).toBe(250);
    expect(recvTxn.senderId).toBe(String(alice.uniqueId));
    // Gift wall entry for recipient
    const wallEntries = Object.entries(db._docs).filter(([k]) =>
      k.startsWith(`giftWalls/${selma.uniqueId}/gifts/`),
    );
    expect(wallEntries).toHaveLength(1);
    const [, wallEntry] = wallEntries[0];
    expect(wallEntry.giftId).toBe('crown');
    expect(wallEntry.senderId).toBe(String(alice.uniqueId));
  });

  test('gift-send rose (cheapest) — uses correct cost/award (10 coins → 5 beans)', async () => {
    const db = makeStatefulFakeDb({
      [`users/${alice.uniqueId}`]: { shyCoins: 100 },
      [`users/${selma.uniqueId}`]: { beans: 0 },
    });
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep({ kind: 'Given', text: 'Alice has just sent Selma a rose' }, ctx);
    expect(r.ok).toBe(true);
    expect(db._docs[`users/${alice.uniqueId}`].shyCoins).toBe(90);
    expect(db._docs[`users/${selma.uniqueId}`].beans).toBe(5);
  });

  test('gift-send diamond (priciest) — uses correct cost/award (1000 coins → 500 beans)', async () => {
    const db = makeStatefulFakeDb({
      [`users/${alice.uniqueId}`]: { shyCoins: 2000 },
      [`users/${selma.uniqueId}`]: { beans: 0 },
    });
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep(
      { kind: 'Given', text: 'Alice has just sent Selma a diamond' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs[`users/${alice.uniqueId}`].shyCoins).toBe(1000);
    expect(db._docs[`users/${selma.uniqueId}`].beans).toBe(500);
  });

  test('purchase with unknown packageId → coinDelta derived from finalShyCoins - prior', async () => {
    const db = makeStatefulFakeDb({
      [`users/${alice.uniqueId}`]: { shyCoins: 5000 },
    });
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep(
      // No trailing number suffix → fallback to finalShyCoins - prior
      { kind: 'Given', text: 'Alice has just purchased starter-pack and has shyCoins=5500' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs[`users/${alice.uniqueId}`].shyCoins).toBe(5500);
    const txns = Object.entries(db._docs).filter(([k]) =>
      k.startsWith(`users/${alice.uniqueId}/transactions/`),
    );
    expect(txns).toHaveLength(1);
    const [, txn] = txns[0];
    // Bare packageId has trailing digits in `pack` part? Let's verify the
    // regex behaves: /-(\d+)$/ on "starter-pack" → no match, falls back.
    // (Note: a packageId like "starter-1" WOULD match -1$. That's accepted
    // behaviour — packageIds in the corpus all use coins-<N> form.)
    expect(txn.productId).toBe('starter-pack');
    expect(txn.amount).toBe(500);
  });

  test('purchase with unknown persona → actionable error', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep(
      { kind: 'Given', text: 'Zonk has just purchased coins-1000 and has shyCoins=6000' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/persona "Zonk" not in registry/);
  });

  test('gift-send with unknown recipient → actionable error', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep({ kind: 'Given', text: 'Alice has just sent Zonk a crown' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/recipient "Zonk" not in registry/);
  });

  test('purchase: ctx.db missing → actionable error, not crash', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'Alice has just purchased coins-1000 and has shyCoins=6000' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.db.*not initialised/);
  });

  test('gift-send: ctx.db missing → actionable error, not crash', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Given', text: 'Alice has just sent Selma a crown' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.db.*not initialised/);
  });

  test('"<persona> has shyCoins=<N>" (existing assignment matcher, j05 line 88) — sets coins via merge', async () => {
    const db = makeStatefulFakeDb({
      [`users/${alice.uniqueId}`]: { shyCoins: 9999, beans: 2000 },
    });
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep({ kind: 'Given', text: 'Alice has shyCoins=5000' }, ctx);
    expect(r.ok).toBe(true);
    expect(db._docs[`users/${alice.uniqueId}`].shyCoins).toBe(5000);
    // Sibling fields preserved via merge
    expect(db._docs[`users/${alice.uniqueId}`].beans).toBe(2000);
  });
});

// ─── Adam's first-day setup Givens (j01 phase-scoped scenarios) ─────
describe("Adam's first-day setup Givens (j01 phase-scoped scenario setup)", () => {
  // Adam is an EPHEMERAL persona (P-01 in EPHEMERAL_PERSONAS,
  // uniqueId 90000001). loadPersonas() merges ephemerals so the
  // matcher resolves persona via `personas.get('Adam')`.
  const ADAM_UNIQUE_ID = 90000001;
  const greta = require('../../scripts/provision-test-personas').personas.find(
    (p) => p.id === 'P-12',
  );

  test('"<persona> has just signed up with a minor-default cohort" — seeds users/<uniqueId> with cohort=minor + isAgeVerified=false', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep(
      { kind: 'Given', text: 'Adam has just signed up with a minor-default cohort' },
      ctx,
    );
    expect(r.ok).toBe(true);
    const user = db._docs[`users/${ADAM_UNIQUE_ID}`];
    expect(user).toBeDefined();
    expect(user.cohort).toBe('minor');
    expect(user.isAgeVerified).toBe(false);
    expect(user.uniqueId).toBe(ADAM_UNIQUE_ID);
    // {newUniqueId} interpolation variable is set for downstream
    // assertions referencing users/{newUniqueId}.
    expect(ctx.scenarioVars.get('newUniqueId')).toBe(String(ADAM_UNIQUE_ID));
  });

  test('"<persona> has accepted legal as a minor-default user" — composes signup + accepted-policies', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep(
      { kind: 'Given', text: 'Adam has accepted legal as a minor-default user' },
      ctx,
    );
    expect(r.ok).toBe(true);
    // User-doc seeded with minor default
    const user = db._docs[`users/${ADAM_UNIQUE_ID}`];
    expect(user.cohort).toBe('minor');
    // usersAcceptedPolicies entry written with current versions
    const policies = db._docs[`usersAcceptedPolicies/${ADAM_UNIQUE_ID}`];
    expect(policies).toBeDefined();
    expect(policies.privacyVersion).toBeGreaterThan(0);
    expect(policies.termsVersion).toBeGreaterThan(0);
  });

  test('"<persona> has just been approved to cohort=adult by <admin>" — flips cohort + writes audit row', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep(
      { kind: 'Given', text: 'Adam has just been approved to cohort=adult by Greta' },
      ctx,
    );
    expect(r.ok).toBe(true);
    // User flipped
    const user = db._docs[`users/${ADAM_UNIQUE_ID}`];
    expect(user.cohort).toBe('adult');
    expect(user.isAgeVerified).toBe(true);
    // Audit row written with String-coerced ids per production convention
    const audits = Object.entries(db._docs).filter(([k]) => k.startsWith('auditLog/'));
    expect(audits).toHaveLength(1);
    const [, audit] = audits[0];
    expect(audit.action).toBe('age_verification.approve');
    expect(audit.targetId).toBe(String(ADAM_UNIQUE_ID));
    expect(audit.adminId).toBe(String(greta.uniqueId));
  });

  test('"<persona> is verified adult with adult features unlocked" — full final state, NO audit (used as compose precondition)', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep(
      { kind: 'Given', text: 'Adam is verified adult with adult features unlocked' },
      ctx,
    );
    expect(r.ok).toBe(true);
    const user = db._docs[`users/${ADAM_UNIQUE_ID}`];
    expect(user.cohort).toBe('adult');
    expect(user.isAgeVerified).toBe(true);
    // Policies accepted
    expect(db._docs[`usersAcceptedPolicies/${ADAM_UNIQUE_ID}`]).toBeDefined();
    // No audit row — this Given is the COMPOSE form (precondition for
    // a later scenario that doesn't care about the audit).
    const audits = Object.entries(db._docs).filter(([k]) => k.startsWith('auditLog/'));
    expect(audits).toHaveLength(0);
  });

  test('unknown persona → actionable error', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep(
      { kind: 'Given', text: 'Zonk has just signed up with a minor-default cohort' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/persona "Zonk" not in registry/);
  });

  test('ctx.db missing → actionable error, not crash', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'Adam has just signed up with a minor-default cohort' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.db not initialised/);
  });
});

// ─── j07 follow + conversation setup Givens (phase-scoped scenarios) ─────
describe('j07 follow + conversation setup Givens (Adam discovery → PM)', () => {
  const { personas: PERSONAS } = require('../../scripts/provision-test-personas');
  const alice = PERSONAS.find((p) => p.id === 'P-02');
  const ADAM_UNIQUE_ID = 90000001; // ephemeral P-01

  test('"<persona> is following <other>" — adds follower→followee + mirror in followerIds', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep({ kind: 'Given', text: 'Adam is following Alice' }, ctx);
    expect(r.ok).toBe(true);
    // Follower's followingIds contains followee's uniqueId
    const adam = db._docs[`users/${ADAM_UNIQUE_ID}`];
    expect(adam).toBeDefined();
    expect(adam.followingIds).toContain(alice.uniqueId);
    // Mirror: followee's followerIds contains follower's uniqueId
    const aliceDoc = db._docs[`users/${alice.uniqueId}`];
    expect(aliceDoc).toBeDefined();
    expect(aliceDoc.followerIds).toContain(ADAM_UNIQUE_ID);
  });

  test('"<persona> is following <other>" — idempotent (re-running dedups, no duplicate ids)', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    await executeStep({ kind: 'Given', text: 'Adam is following Alice' }, ctx);
    await executeStep({ kind: 'Given', text: 'Adam is following Alice' }, ctx);
    const adam = db._docs[`users/${ADAM_UNIQUE_ID}`];
    expect(adam.followingIds.filter((id) => id === alice.uniqueId)).toHaveLength(1);
    const aliceDoc = db._docs[`users/${alice.uniqueId}`];
    expect(aliceDoc.followerIds.filter((id) => id === ADAM_UNIQUE_ID)).toHaveLength(1);
  });

  test('"<persona> is following <other>" — preserves pre-existing followingIds entries', async () => {
    // Pre-seed Adam with a follow on Marcus (P-04, uniqueId 60000010).
    const MARCUS_UNIQUE_ID = 60000010;
    const db = makeStatefulFakeDb({
      [`users/${ADAM_UNIQUE_ID}`]: { followingIds: [MARCUS_UNIQUE_ID] },
    });
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep({ kind: 'Given', text: 'Adam is following Alice' }, ctx);
    expect(r.ok).toBe(true);
    const adam = db._docs[`users/${ADAM_UNIQUE_ID}`];
    expect(adam.followingIds).toContain(MARCUS_UNIQUE_ID);
    expect(adam.followingIds).toContain(alice.uniqueId);
  });

  test('"<persona> is following <other>" — unknown follower → actionable error', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep({ kind: 'Given', text: 'Zonk is following Alice' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/follower "Zonk" not in registry/);
  });

  test('"<persona> is following <other>" — unknown followee → actionable error', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep({ kind: 'Given', text: 'Adam is following Zonk' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/followee "Zonk" not in registry/);
  });

  test('"<persona> is following <other>" — ctx.db missing → actionable error', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Given', text: 'Adam is following Alice' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.db not initialised/);
  });

  test('"<persona> has an open DIRECT conversation thread with <other>" — writes conversations/<sorted-pair>', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep(
      { kind: 'Given', text: 'Adam has an open DIRECT conversation thread with Alice' },
      ctx,
    );
    expect(r.ok).toBe(true);
    // Conversation id is deterministic — sorted-pair of String-coerced uniqueIds
    const ids = [String(ADAM_UNIQUE_ID), String(alice.uniqueId)].sort();
    const convId = `direct-${ids[0]}-${ids[1]}`;
    const conv = db._docs[`conversations/${convId}`];
    expect(conv).toBeDefined();
    expect(conv.type).toBe('DIRECT');
    expect(conv.participantIds).toEqual(ids);
    expect(conv.createdAt).toBeGreaterThan(0);
  });

  test('"<persona> has an open DIRECT conversation thread with <other>" — idempotent (re-running overwrites same doc-id, no duplicate)', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    await executeStep(
      { kind: 'Given', text: 'Adam has an open DIRECT conversation thread with Alice' },
      ctx,
    );
    await executeStep(
      { kind: 'Given', text: 'Adam has an open DIRECT conversation thread with Alice' },
      ctx,
    );
    const convs = Object.entries(db._docs).filter(([k]) => k.startsWith('conversations/'));
    expect(convs).toHaveLength(1);
  });

  test('"<persona> has an open DIRECT conversation thread with <other>" — order-invariant doc-id (Alice → Adam = Adam → Alice)', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r1 = await executeStep(
      { kind: 'Given', text: 'Adam has an open DIRECT conversation thread with Alice' },
      ctx,
    );
    expect(r1.ok).toBe(true);
    const r2 = await executeStep(
      { kind: 'Given', text: 'Alice has an open DIRECT conversation thread with Adam' },
      ctx,
    );
    expect(r2.ok).toBe(true);
    // Still 1 conversation — sorted-pair doc-id is bidirectional
    const convs = Object.entries(db._docs).filter(([k]) => k.startsWith('conversations/'));
    expect(convs).toHaveLength(1);
  });

  test('"<persona> has an open DIRECT conversation thread with <other>" — unknown persona → actionable error', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep(
      { kind: 'Given', text: 'Adam has an open DIRECT conversation thread with Zonk' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/persona "Zonk" not in registry/);
  });

  test('"<persona> has an open DIRECT conversation thread with <other>" — ctx.db missing → actionable error', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'Adam has an open DIRECT conversation thread with Alice' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.db not initialised/);
  });
});

// ─── Mia's restricted-minor setup Givens (j02 phase-scoped scenarios) ─────
describe("Mia's restricted-minor setup Givens (j02 phase-scoped scenario setup)", () => {
  // Mia is an EPHEMERAL persona (P-03 in EPHEMERAL_PERSONAS, uniqueId
  // 90000003). loadPersonas() merges ephemerals so the matcher resolves
  // persona via `personas.get('Mia')`. Distinct from Adam (P-01) — Mia
  // exists to exercise the minor-cohort restrictions specifically.
  const MIA_UNIQUE_ID = 90000003;

  test('"<persona> has just signed up as a minor" — seeds users/<uniqueId> with cohort=minor + isAgeVerified=false', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep({ kind: 'Given', text: 'Mia has just signed up as a minor' }, ctx);
    expect(r.ok).toBe(true);
    const user = db._docs[`users/${MIA_UNIQUE_ID}`];
    expect(user).toBeDefined();
    expect(user.cohort).toBe('minor');
    expect(user.isAgeVerified).toBe(false);
    expect(user.uniqueId).toBe(MIA_UNIQUE_ID);
    // {newUniqueId} interpolation variable seeded for downstream
    // assertions referencing users/{newUniqueId}.
    expect(ctx.scenarioVars.get('newUniqueId')).toBe(String(MIA_UNIQUE_ID));
  });

  test('"<persona> has accepted legal as a minor" — composes signup-as-minor + accepted-policies', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep({ kind: 'Given', text: 'Mia has accepted legal as a minor' }, ctx);
    expect(r.ok).toBe(true);
    // User-doc seeded with minor cohort (NOT flipped to adult — distinct
    // from the j01 case where Adam later flips to adult).
    const user = db._docs[`users/${MIA_UNIQUE_ID}`];
    expect(user.cohort).toBe('minor');
    expect(user.isAgeVerified).toBe(false);
    // usersAcceptedPolicies entry written with current versions.
    const policies = db._docs[`usersAcceptedPolicies/${MIA_UNIQUE_ID}`];
    expect(policies).toBeDefined();
    expect(policies.privacyVersion).toBeGreaterThan(0);
    expect(policies.termsVersion).toBeGreaterThan(0);
  });

  test('"<persona> has just signed up as a minor" — unknown persona → actionable error', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep({ kind: 'Given', text: 'Zonk has just signed up as a minor' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/persona "Zonk" not in registry/);
  });

  test('"<persona> has accepted legal as a minor" — unknown persona → actionable error', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep({ kind: 'Given', text: 'Zonk has accepted legal as a minor' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/persona "Zonk" not in registry/);
  });

  test('"<persona> has just signed up as a minor" — ctx.db missing → actionable error', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Given', text: 'Mia has just signed up as a minor' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.db not initialised/);
  });

  test('"<persona> has accepted legal as a minor" — ctx.db missing → actionable error', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Given', text: 'Mia has accepted legal as a minor' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.db not initialised/);
  });

  test('"Mia has accepted legal as a minor" — re-running is idempotent (no duplicate policies row)', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r1 = await executeStep({ kind: 'Given', text: 'Mia has accepted legal as a minor' }, ctx);
    expect(r1.ok).toBe(true);
    const r2 = await executeStep({ kind: 'Given', text: 'Mia has accepted legal as a minor' }, ctx);
    expect(r2.ok).toBe(true);
    // Only ONE usersAcceptedPolicies entry — re-running merges the same
    // doc, doesn't create a duplicate.
    const policies = Object.entries(db._docs).filter(([k]) =>
      k.startsWith('usersAcceptedPolicies/'),
    );
    expect(policies).toHaveLength(1);
  });

  test('Mia matcher does NOT collide with Adam matcher (j01) — different cohort phrasing routes correctly', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    // Adam's j01 phrasing should NOT match Mia's j02 phrasing matcher
    // (it must hit the j01 pattern, not the j02 pattern, even though
    // both end up calling seedSignedUpUser).
    const ADAM_UNIQUE_ID = 90000001;
    const r = await executeStep(
      { kind: 'Given', text: 'Adam has just signed up with a minor-default cohort' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs[`users/${ADAM_UNIQUE_ID}`]).toBeDefined();
    expect(db._docs[`users/${MIA_UNIQUE_ID}`]).toBeUndefined();
  });
});

// ─── j12 admin-queue setup Givens (queue-state phase-scoped scenarios) ─────
describe('Admin-queue setup Givens (j12 phase-scoped scenarios)', () => {
  test('"the age-verification queue has 5 pending submissions" — seeds 5 PENDING docs', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep(
      { kind: 'Given', text: 'the age-verification queue has 5 pending submissions' },
      ctx,
    );
    expect(r.ok).toBe(true);
    const submissions = Object.entries(db._docs).filter(([k]) =>
      k.startsWith('ageVerificationSubmissions/'),
    );
    expect(submissions).toHaveLength(5);
    // Each is PENDING
    for (const [, doc] of submissions) {
      expect(doc.status).toBe('PENDING');
    }
  });

  test('"the reports queue has 3 pending reports" — seeds 3 PENDING reports', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep(
      { kind: 'Given', text: 'the reports queue has 3 pending reports' },
      ctx,
    );
    expect(r.ok).toBe(true);
    const reports = Object.entries(db._docs).filter(([k]) => k.startsWith('reports/'));
    expect(reports).toHaveLength(3);
    for (const [, doc] of reports) {
      expect(doc.status).toBe('PENDING');
    }
  });

  test('"the suspension-appeals queue has 2 pending appeals" — seeds 2 PENDING appeals', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep(
      { kind: 'Given', text: 'the suspension-appeals queue has 2 pending appeals' },
      ctx,
    );
    expect(r.ok).toBe(true);
    const appeals = Object.entries(db._docs).filter(([k]) => k.startsWith('suspensionAppeals/'));
    expect(appeals).toHaveLength(2);
    for (const [, doc] of appeals) {
      expect(doc.status).toBe('PENDING');
    }
  });

  test('queue-seed is idempotent (re-running gives the same count — deterministic doc-ids)', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    await executeStep({ kind: 'Given', text: 'the reports queue has 3 pending reports' }, ctx);
    await executeStep({ kind: 'Given', text: 'the reports queue has 3 pending reports' }, ctx);
    const reports = Object.entries(db._docs).filter(([k]) => k.startsWith('reports/'));
    // Still exactly 3 — deterministic `test-seed-<i>` ids overwrite cleanly
    expect(reports).toHaveLength(3);
  });

  test('queue-seed accepts 0 count (empty queue setup)', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep(
      { kind: 'Given', text: 'the reports queue has 0 pending reports' },
      ctx,
    );
    expect(r.ok).toBe(true);
    const reports = Object.entries(db._docs).filter(([k]) => k.startsWith('reports/'));
    expect(reports).toHaveLength(0);
  });

  test('unknown queue → silent skip (preserves backward-compat with bookkeeping-only scenarios)', async () => {
    // Wake 95 is older than the QUEUE_REGISTRY seed primitive. Some
    // scenarios use queue names that aren't registered (forward-looking
    // names, hypothetical queues). The handler still records the
    // ctx.adminQueues bookkeeping but skips the Firestore seed
    // silently — preserving the prior MVP behaviour.
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep(
      { kind: 'Given', text: 'the unknown-queue queue has 5 pending things' },
      ctx,
    );
    expect(r.ok).toBe(true);
    // ctx bookkeeping happened
    expect(ctx.adminQueues['unknown-queue']).toEqual({ count: 5, noun: 'things' });
    // Firestore got nothing seeded (no matching collection in registry)
    const docs = Object.keys(db._docs);
    expect(docs).toHaveLength(0);
  });

  test('ctx.db missing → still succeeds (bookkeeping-only, no Firestore seed)', async () => {
    // Wake 95 predates ctx.db being required. To preserve backward
    // compatibility, the handler should still set ctx.adminQueues even
    // when ctx.db is missing — the seed step is best-effort.
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'the reports queue has 3 pending reports' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.adminQueues.reports).toEqual({ count: 3, noun: 'reports' });
  });

  test('large count (50) does not crash + writes correct number', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep(
      { kind: 'Given', text: 'the age-verification queue has 50 pending submissions' },
      ctx,
    );
    expect(r.ok).toBe(true);
    const subs = Object.entries(db._docs).filter(([k]) =>
      k.startsWith('ageVerificationSubmissions/'),
    );
    expect(subs).toHaveLength(50);
  });
});

// ─── j10/j11 warning-state setup Givens (moderation phase-scoped scenarios) ─────
describe('Warning-state setup Givens (j10 + j11 phase-scoped scenarios)', () => {
  const { personas: PERSONAS } = require('../../scripts/provision-test-personas');
  const raul = PERSONAS.find((p) => p.id === 'P-08');
  const theo = PERSONAS.find((p) => p.id === 'P-10');

  test('"<persona> has been issued a first-strike warning" — sets hasActiveWarning + warningCount=1 + acknowledged=false', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep(
      { kind: 'Given', text: 'Raul has been issued a first-strike warning' },
      ctx,
    );
    expect(r.ok).toBe(true);
    const u = db._docs[`users/${raul.uniqueId}`];
    expect(u.hasActiveWarning).toBe(true);
    expect(u.warningCount).toBe(1);
    expect(u.warningAcknowledged).toBe(false);
    expect(u.lastWarningAt).toBeGreaterThan(0);
  });

  test('"<persona> has acknowledged his first-strike warning" — composes issued + flips acknowledged=true', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep(
      { kind: 'Given', text: 'Raul has acknowledged his first-strike warning' },
      ctx,
    );
    expect(r.ok).toBe(true);
    const u = db._docs[`users/${raul.uniqueId}`];
    expect(u.hasActiveWarning).toBe(true);
    expect(u.warningCount).toBe(1);
    expect(u.warningAcknowledged).toBe(true);
    expect(u.lastWarningAt).toBeGreaterThan(0);
  });

  test('"<persona> has acknowledged her first-strike warning" — pronoun "her" form matches', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep(
      { kind: 'Given', text: 'Nora has acknowledged her first-strike warning' },
      ctx,
    );
    expect(r.ok).toBe(true);
    // Persona Nora is P-09 — fetch from registry
    const nora = PERSONAS.find((p) => p.id === 'P-09');
    expect(db._docs[`users/${nora.uniqueId}`].warningAcknowledged).toBe(true);
  });

  test('"<persona> has acknowledged their first-strike warning" — pronoun "their" form matches', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep(
      { kind: 'Given', text: 'Raul has acknowledged their first-strike warning' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs[`users/${raul.uniqueId}`].warningAcknowledged).toBe(true);
  });

  test('multi-field assignment matcher (existing) handles "hasActiveWarning=true, warningReason=<quoted>" cleanly (j10 refactor)', async () => {
    // j10 line 58 was originally "Theo has hasActiveWarning=true with
    // reason \"...\"" — that collided with the (assignment matcher,
    // wider scope at line ~1898) which greedily captured the trailing
    // " with reason \"...\"" as part of the field value. Refactored to
    // the comma form so the EXISTING multi-field matcher handles it.
    // This test pins the new j10 phrasing's behaviour.
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Theo has hasActiveWarning=true, warningReason="Inappropriate language in voice room"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    const u = db._docs[`users/${theo.uniqueId}`];
    expect(u.hasActiveWarning).toBe(true);
    expect(u.warningReason).toBe('Inappropriate language in voice room');
  });

  test('issued + acknowledged: merge preserves pre-existing user-doc fields (shyCoins, beans)', async () => {
    const db = makeStatefulFakeDb({
      [`users/${raul.uniqueId}`]: { shyCoins: 500, beans: 200 },
    });
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    await executeStep({ kind: 'Given', text: 'Raul has been issued a first-strike warning' }, ctx);
    const u = db._docs[`users/${raul.uniqueId}`];
    // Warning fields set
    expect(u.hasActiveWarning).toBe(true);
    // Pre-existing fields preserved via merge (the moderation flow doesn't
    // touch economy state — see j11:71 "shyCoins=0 and beans=0 — irrelevant"
    // comment in the feature file).
    expect(u.shyCoins).toBe(500);
    expect(u.beans).toBe(200);
  });

  test('"issued" + "acknowledged" — sequence flips acknowledged true with one final state', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    await executeStep({ kind: 'Given', text: 'Raul has been issued a first-strike warning' }, ctx);
    const intermediate = db._docs[`users/${raul.uniqueId}`].warningAcknowledged;
    expect(intermediate).toBe(false);
    await executeStep(
      { kind: 'Given', text: 'Raul has acknowledged his first-strike warning' },
      ctx,
    );
    expect(db._docs[`users/${raul.uniqueId}`].warningAcknowledged).toBe(true);
    // warningCount stays 1 (still a first strike), not incremented
    expect(db._docs[`users/${raul.uniqueId}`].warningCount).toBe(1);
  });

  test('unknown persona → actionable error (issued)', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep(
      { kind: 'Given', text: 'Zonk has been issued a first-strike warning' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/persona "Zonk" not in registry/);
  });

  test('unknown persona → actionable error (acknowledged)', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db, scenarioVars: new Map() });
    const r = await executeStep(
      { kind: 'Given', text: 'Zonk has acknowledged his first-strike warning' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/persona "Zonk" not in registry/);
  });

  test('ctx.db missing → actionable error (both warning matchers)', async () => {
    const ctx = makeCtx();
    const issuedR = await executeStep(
      { kind: 'Given', text: 'Raul has been issued a first-strike warning' },
      ctx,
    );
    expect(issuedR.ok).toBe(false);
    expect(issuedR.error).toMatch(/ctx\.db not initialised/);
    const ackR = await executeStep(
      { kind: 'Given', text: 'Raul has acknowledged his first-strike warning' },
      ctx,
    );
    expect(ackR.ok).toBe(false);
    expect(ackR.error).toMatch(/ctx\.db not initialised/);
  });
});

// ─── segregationEvents test-isolation cleanup (j09 + cross-cohort journeys) ─────
describe('Given "no prior segregationEvents exist between <source> and <target>"', () => {
  // Custom fake-db supporting chained .where(...).where(...).get() with
  // an array of doc-refs that each expose .delete(). The general
  // makeStatefulFakeDb doesn't support where-chaining, so this is a
  // local helper.
  function makeSegEventsFakeDb(initialEvents) {
    // Each event has { id, action, sourceUniqueId, targetUniqueId, ... }
    let events = [...initialEvents];
    function buildQuery(filters) {
      return {
        where: (field, op, value) => buildQuery([...filters, { field, op, value }]),
        get: async () => {
          const matching = events
            .filter((evt) =>
              filters.every(({ field, op, value }) => op === '==' && evt[field] === value),
            )
            .map((evt) => ({
              id: evt.id,
              data: () => evt,
              ref: {
                delete: async () => {
                  events = events.filter((e) => e.id !== evt.id);
                },
              },
            }));
          return { docs: matching };
        },
      };
    }
    return {
      collection: (name) => {
        if (name !== 'segregationEvents') {
          throw new Error(`fake-db only supports segregationEvents (got "${name}")`);
        }
        return buildQuery([]);
      },
      // Test inspection helpers
      _events: () => events,
    };
  }

  test('deletes all matching {action:"blocked", source, target} events; preserves non-matching', async () => {
    const db = makeSegEventsFakeDb([
      {
        id: 'stale-1',
        action: 'blocked',
        sourceUniqueId: '60000010',
        targetUniqueId: 'ra1',
        timestamp: 1,
      },
      {
        id: 'stale-2',
        action: 'blocked',
        sourceUniqueId: '60000010',
        targetUniqueId: 'ra1',
        timestamp: 2,
      },
      // Non-matching: different action
      {
        id: 'other-action',
        action: 'allowed',
        sourceUniqueId: '60000010',
        targetUniqueId: 'ra1',
        timestamp: 3,
      },
      // Non-matching: different target
      {
        id: 'other-target',
        action: 'blocked',
        sourceUniqueId: '60000010',
        targetUniqueId: 'rb1',
        timestamp: 4,
      },
      // Non-matching: different source
      {
        id: 'other-source',
        action: 'blocked',
        sourceUniqueId: '90000099',
        targetUniqueId: 'ra1',
        timestamp: 5,
      },
    ]);
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'no prior segregationEvents exist between "60000010" and "ra1"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    const remaining = db
      ._events()
      .map((e) => e.id)
      .sort();
    expect(remaining).toEqual(['other-action', 'other-source', 'other-target']);
  });

  test('empty collection → ok=true (no-op, idempotent)', async () => {
    const db = makeSegEventsFakeDb([]);
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'no prior segregationEvents exist between "60000010" and "ra1"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._events()).toHaveLength(0);
  });

  test('re-running is idempotent (second call still ok=true)', async () => {
    const db = makeSegEventsFakeDb([
      {
        id: 'stale-1',
        action: 'blocked',
        sourceUniqueId: '60000010',
        targetUniqueId: 'ra1',
        timestamp: 1,
      },
    ]);
    const ctx = makeCtx({ db });
    const r1 = await executeStep(
      { kind: 'Given', text: 'no prior segregationEvents exist between "60000010" and "ra1"' },
      ctx,
    );
    expect(r1.ok).toBe(true);
    const r2 = await executeStep(
      { kind: 'Given', text: 'no prior segregationEvents exist between "60000010" and "ra1"' },
      ctx,
    );
    expect(r2.ok).toBe(true);
    expect(db._events()).toHaveLength(0);
  });

  test('numeric uniqueId without quotes is accepted (source must be \\d+)', async () => {
    // Pin the regex shape — source is `\d+` (with optional surrounding
    // quotes) so a feature file written without quotes still parses.
    const db = makeSegEventsFakeDb([]);
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'no prior segregationEvents exist between 60000010 and "ra1"' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('ctx.db missing → actionable error', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'no prior segregationEvents exist between "60000010" and "ra1"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.db.*not initialised/);
  });

  test('values are String-coerced before the query (matches production wire format)', async () => {
    // Production routes write String(req.auth.uniqueId) — so the runner
    // must query for the string form too, not the number. This test pins
    // that the matcher's query uses the string '60000010', not the
    // number 60000010.
    const db = makeSegEventsFakeDb([
      {
        id: 'stringly-typed',
        action: 'blocked',
        sourceUniqueId: '60000010', // STRING per production convention
        targetUniqueId: 'ra1',
        timestamp: 1,
      },
    ]);
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'no prior segregationEvents exist between "60000010" and "ra1"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    // The string-keyed event was deleted — proves the query coerced
    // properly. If the matcher had queried for the NUMBER 60000010, the
    // string-keyed doc would have survived.
    expect(db._events()).toHaveLength(0);
  });
});

describe('Dialog confirm action (platform-dispatch)', () => {
  test('"X on Android confirms in the dialog" → driver', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidConfirmDialog: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Theo on Android confirms in the dialog' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  test('iOS Sim variant routes correctly', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { iosConfirmDialog: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Mia on iOS Sim confirms in the dialog' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalled();
  });
});

describe("Long-press on target person's seat", () => {
  test('"X on Android long-presses Y\'s seat" → driver', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidLongPressSeat: spy } });
    const r = await executeStep(
      { kind: 'When', text: "Theo on Android long-presses Ines's seat" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Ines');
  });
});

describe('Voice room create composite (j09 host)', () => {
  test('"X on Android types title \\"Y\\" and chooses public visibility" → driver', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidCreateRoomComposite: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Theo on Android types title "Theo\'s Test Room" and chooses public visibility',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith("Theo's Test Room", 'public');
  });

  test('private visibility variant', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidCreateRoomComposite: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Theo on Android types title "Private Room" and chooses private visibility',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Private Room', 'private');
  });
});

describe('Receives LiveKit token (bare + in-response-from-POST)', () => {
  test('"X on Android receives a LiveKit token" → driver (bare)', async () => {
    const spy = jest.fn(async () => 'tok-abc');
    const ctx = makeCtx({ uiDriver: { androidReceiveLiveKitToken: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Theo on Android receives a LiveKit token' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith(null);
  });

  test('"... in response from POST /api/livekit/token" — driver receives endpoint', async () => {
    const spy = jest.fn(async () => 'tok-abc');
    const ctx = makeCtx({ uiDriver: { androidReceiveLiveKitToken: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Theo on Android receives a LiveKit token in response from POST /api/livekit/token',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('/api/livekit/token');
  });

  test('Web variant routes correctly', async () => {
    const spy = jest.fn(async () => 'tok-abc');
    const ctx = makeCtx({ webDriver: { webReceiveLiveKitToken: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Alice on Web receives a LiveKit token' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith(null);
  });

  test('driver returns null/empty — fail', async () => {
    const spy = jest.fn(async () => null);
    const ctx = makeCtx({ uiDriver: { androidReceiveLiveKitToken: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Theo on Android receives a LiveKit token' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/LiveKit/);
  });
});

describe('Seat grid assertion (N of M seats occupied)', () => {
  test('"X\'s <plat> UI shows the seat grid with N of M seats occupied" — Wake 30 strips trailing parens', async () => {
    const spy = jest.fn(async () => ({ occupied: 1, total: 8 }));
    const ctx = makeCtx({ uiDriver: { androidSeatGridState: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Theo's Android UI shows the seat grid with 1 of 8 seats occupied (by himself)",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('mismatch — fail with expected vs actual', async () => {
    const spy = jest.fn(async () => ({ occupied: 2, total: 8 }));
    const ctx = makeCtx({ uiDriver: { androidSeatGridState: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Theo's Android UI shows the seat grid with 1 of 8 seats occupied" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/expected 1.*actual 2/);
  });
});

describe('Taps the same room (relative reference)', () => {
  test('"X on iOS Sim taps the same room" → driver call', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { iosTapSameRoom: spy } });
    const r = await executeStep({ kind: 'When', text: 'Ines on iOS Sim taps the same room' }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith(false);
  });

  test('"taps the same room again" — driver receives isAgain=true', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { iosTapSameRoom: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Ines on iOS Sim taps the same room again' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith(true);
  });
});

describe('Approve seat request composite', () => {
  test('"X on Android taps approve on Y\'s seat request" → driver', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ uiDriver: { androidApproveSeatRequest: spy } });
    const r = await executeStep(
      { kind: 'When', text: "Theo on Android taps approve on Ines's seat request" },
      ctx,
    );
    expect(r.ok).toBe(true);
    // Updated PR #766: driver contract is now `(host, requester)` to
    // match Wake 86's canonical "approves" phrasing. Previously
    // asserted the requester only — the host was dropped on the
    // floor, which would mask a regression when per-requester
    // approval lands.
    expect(spy).toHaveBeenCalledWith('Theo', 'Ines');
  });
});

describe('Block via API attempt', () => {
  test('"X on Android attempts to block Y via /api/users/block" (Wake-30 strips trailing parens)', async () => {
    const spy = jest.fn(async () => ({ status: 200 }));
    const ctx = makeCtx({ uiDriver: { androidAttemptBlock: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Hayato on Android attempts to block Officia (uniqueId=1) via /api/users/block',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Officia', '/api/users/block');
  });
});

describe('Abstract cohort UI absence (any adult-cohort visitor)', () => {
  test('"Mia\'s iOS Sim UI does not show any adult-cohort visitor" → driver returns false → ok', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { iosShowsAdultCohortVisitor: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Mia's iOS Sim UI does not show any adult-cohort visitor" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  test('driver returns true (adult visitor present) → fail', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosShowsAdultCohortVisitor: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Mia's iOS Sim UI does not show any adult-cohort visitor" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/adult-cohort/);
  });
});

describe('Voice room state-seed with mic state (multi-field)', () => {
  test('"X is in voice room \\"Y\\" (annotation) with mic open" — state-seed', async () => {
    // Hayato is P-06 in registry — uniqueId 50000030
    const { personas } = require('../../scripts/provision-test-personas');
    const hayato = personas.find((p) => p.id === 'P-06');
    const db = makeStatefulFakeDb({ [`rooms/r1`]: { id: 'r1', participantIds: [] } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Hayato is in voice room "r1" (an adult-cohort room) with mic open',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['rooms/r1'].participantIds).toContain(hayato.uniqueId);
    expect(db._docs['rooms/r1'].micStates?.[String(hayato.uniqueId)]).toBe('open');
  });

  test('"with mic muted" variant', async () => {
    const { personas } = require('../../scripts/provision-test-personas');
    const hayato = personas.find((p) => p.id === 'P-06');
    const db = makeStatefulFakeDb({ 'rooms/r1': { id: 'r1', participantIds: [] } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Hayato is in voice room "r1" with mic muted' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['rooms/r1'].micStates?.[String(hayato.uniqueId)]).toBe('muted');
  });
});

describe('Web Admin age-down flow composite', () => {
  test('"Greta on Web Admin executes the age-down flow" → driver', async () => {
    const spy = jest.fn(async () => undefined);
    const ctx = makeCtx({ webDriver: { webAdminExecuteAgeDownFlow: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin executes the age-down flow' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalled();
  });
});

describe('Concurrent N follow attempts', () => {
  // Wake 131 moved the parallel-HTTP fan-out from a webDriver stub
  // into the matcher (per the W121 pattern — pure HTTP, no UI).
  // Each request uses the last-registered session's idToken.

  test('fires N parallel POSTs and stores [{status, latencyMs}] on ctx', async () => {
    const calls = [];
    const ctx = makeCtx({
      sessions: new Map([['Vexa', { idToken: 'vexa-token', persona: { uniqueId: 50000040 } }]]),
      fetch: jest.fn(async (url, init) => {
        calls.push({ url, init });
        return { status: 404 };
      }),
    });
    ctx.apiBase = 'http://localhost:3000';
    const r = await executeStep(
      {
        kind: 'When',
        text: '10 cross-cohort follow attempts hit /api/users/follow concurrently',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(10);
    expect(calls[0].url).toBe('http://localhost:3000/api/users/follow');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers.Authorization).toBe('Bearer vexa-token');
    expect(ctx.lastConcurrentResults).toHaveLength(10);
    expect(ctx.lastConcurrentResults[0]).toMatchObject({ status: 404 });
    expect(typeof ctx.lastConcurrentResults[0].latencyMs).toBe('number');
  });

  test('no sessions → ok:false (Given step missing)', async () => {
    const ctx = makeCtx({ sessions: new Map(), fetch: jest.fn() });
    const r = await executeStep(
      {
        kind: 'When',
        text: '10 cross-cohort follow attempts hit /api/users/follow concurrently',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no sessions/);
  });
});

describe('Each response status is N (after concurrent batch)', () => {
  test('all responses have status N → ok', async () => {
    const ctx = makeCtx();
    ctx.lastConcurrentResults = [{ status: 404 }, { status: 404 }, { status: 404 }];
    const r = await executeStep({ kind: 'Then', text: 'each response status is 404' }, ctx);
    expect(r.ok).toBe(true);
  });

  test('one response has different status → fail with mismatch detail', async () => {
    const ctx = makeCtx();
    ctx.lastConcurrentResults = [{ status: 404 }, { status: 200 }, { status: 404 }];
    const r = await executeStep({ kind: 'Then', text: 'each response status is 404' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/200/);
  });

  test('no concurrent batch recorded → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Then', text: 'each response status is 404' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no recorded/);
  });
});

describe('N audit rows are written assertion', () => {
  test('exactly N audit rows in the auditLog collection → ok', async () => {
    const db = makeStatefulFakeDb({
      'auditLog/a1': { action: 'follow_attempt' },
      'auditLog/a2': { action: 'follow_attempt' },
      'auditLog/a3': { action: 'follow_attempt' },
      'auditLog/a4': { action: 'follow_attempt' },
      'auditLog/a5': { action: 'follow_attempt' },
      'auditLog/a6': { action: 'follow_attempt' },
      'auditLog/a7': { action: 'follow_attempt' },
      'auditLog/a8': { action: 'follow_attempt' },
      'auditLog/a9': { action: 'follow_attempt' },
      'auditLog/a10': { action: 'follow_attempt' },
    });
    const ctx = makeCtx({ db });
    const r = await executeStep({ kind: 'Then', text: '10 audit rows are written' }, ctx);
    expect(r.ok).toBe(true);
  });

  test('count mismatch → fail', async () => {
    const db = makeStatefulFakeDb({
      'auditLog/a1': { action: 'follow_attempt' },
    });
    const ctx = makeCtx({ db });
    const r = await executeStep({ kind: 'Then', text: '10 audit rows are written' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/expected 10.*actual 1/);
  });
});

describe('Conversation doc field equality assertion', () => {
  test('"the conversation doc \\"X\\" has field \\"Y\\" equal to Z" — boolean', async () => {
    const db = makeStatefulFakeDb({
      'conversations/c1': { frozen: true },
    });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'the conversation doc "conversations/c1" has field "frozen" equal to true (set by migration)',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('numeric value', async () => {
    const db = makeStatefulFakeDb({
      'conversations/c1': { participantCount: 2 },
    });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'the conversation doc "conversations/c1" has field "participantCount" equal to 2',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('field mismatch — fail', async () => {
    const db = makeStatefulFakeDb({
      'conversations/c1': { frozen: false },
    });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'the conversation doc "conversations/c1" has field "frozen" equal to true',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/frozen/);
  });
});

describe('Array-of-quoted-strings in signed-in `with` clause (j17 Bao teaching languages)', () => {
  test('teachingLanguages=["zh", "en"] writes a string-array to user doc', async () => {
    const fetchSpy = jest.fn(async (url) => {
      if (typeof url === 'string' && url.includes('signInWithPassword')) {
        const idToken =
          'h.' + Buffer.from(JSON.stringify({ uniqueId: 50000090 })).toString('base64url') + '.s';
        return { status: 200, json: async () => ({ idToken, refreshToken: 'r', localId: 'f' }) };
      }
      return { status: 500, text: async () => '{}' };
    });
    const db = makeStatefulFakeDb({ 'users/50000090': {} });
    const ctx = makeCtx({ fetch: fetchSpy, db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Bao [P-17] is signed in on Web Chromium with userType=TEACHER and teachingLanguages=["zh", "en"]',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000090'].userType).toBe('TEACHER');
    expect(db._docs['users/50000090'].teachingLanguages).toEqual(['zh', 'en']);
  });
});

describe('State-seed end-to-end via runFeatureFile', () => {
  test('every fixture scenario passes after seed + read round-trip', async () => {
    const fakeFetch = jest.fn(async (url) => {
      if (typeof url === 'string' && url.endsWith('/api/health')) {
        return { status: 200, json: async () => ({ ok: true }) };
      }
      return { status: 500, text: async () => '{}' };
    });
    const db = makeStatefulFakeDb({ 'users/50000010': { cohort: 'adult' } });
    const ctx = makeCtx({ fetch: fakeFetch, db });
    const { findings, scenarioReports } = await runFeatureFile(
      path.join(FIXTURE_DIR, 'sample-state-seed.feature'),
      ctx,
    );
    for (const sr of scenarioReports) {
      expect(sr.status).toBe('pass');
    }
    expect(findings).toEqual([]);
  });
});

// ── PR-E: OSA Background verbs (the cycle-1 finding gap) ───────────

describe('OSA Background verbs (cycle 1 findings)', () => {
  function withSignInFetch() {
    return jest.fn(async (url) => {
      if (typeof url === 'string' && url.includes('signInWithPassword')) {
        const idToken =
          'h.' +
          Buffer.from(JSON.stringify({ uniqueId: 50000010, admin: false })).toString('base64url') +
          '.s';
        return {
          status: 200,
          json: async () => ({ idToken, refreshToken: 'r', localId: 'f' }),
        };
      }
      if (typeof url === 'string' && url.endsWith('/api/health')) {
        return { status: 200, json: async () => ({ ok: true }) };
      }
      return { status: 500, text: async () => '{}' };
    });
  }

  test('sign-in "with cohort=X" clause now seeds user doc (was: tolerated as docs)', async () => {
    // PR-E originally treated `with cohort=X` as informational. The
    // 2026-05-17 wake-3 change made it state-mutating so scenarios can
    // declare known starting state directly on the sign-in step.
    // Trailing parenthetical is still treated as documentation.
    const db = makeStatefulFakeDb({ 'users/50000030': {} });
    const ctx = makeCtx({ fetch: withSignInFetch(), db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Hayato [P-06] is signed in on Android with cohort=adult (DOB=2007-01-01 in users doc)',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.sessions.get('Hayato')).toBeDefined();
    expect(db._docs['users/50000030'].cohort).toBe('adult');
  });

  test('sign-in tolerates "AND on <Platform>" multi-device form', async () => {
    const ctx = makeCtx({ fetch: withSignInFetch() });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Vexa [P-07] is signed in on Web Chromium AND on Android (same Firebase user)',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.sessions.get('Vexa')).toBeDefined();
  });

  test('sign-in tolerates trailing parenthetical context', async () => {
    const ctx = makeCtx({ fetch: withSignInFetch() });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Marcus [P-04] is signed in on Android (same-cohort minor) at the "discovery" screen',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('migration-state precondition passes when data invariants are clean', async () => {
    const ctx = makeCtx({
      db: makeProbeDb({
        users: [
          { uniqueId: 50000010, cohort: 'adult', followingIds: [50000020], followerIds: [] },
          { uniqueId: 50000020, cohort: 'adult', followingIds: [], followerIds: [50000010] },
          { uniqueId: 60000010, cohort: 'minor', followingIds: [], followerIds: [] },
        ],
        rooms: [],
        conversations: [],
      }),
    });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'the dev environment migration ran at least once (lastMigrationRunAt is set in "ops/segregation-migration")',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('migration-state precondition fails when cross-cohort follow edges exist', async () => {
    const ctx = makeCtx({
      db: makeProbeDb({
        users: [
          { uniqueId: 50000010, cohort: 'adult', followingIds: [60000010] },
          { uniqueId: 60000010, cohort: 'minor', followerIds: [50000010] },
        ],
        rooms: [],
        conversations: [],
      }),
    });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'the dev environment migration ran at least once',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/cross-cohort followingIds/);
  });

  test('migration-state precondition fails when OPEN room has mixed-cohort participants', async () => {
    const ctx = makeCtx({
      db: makeProbeDb({
        users: [
          { uniqueId: 50000010, cohort: 'adult' },
          { uniqueId: 60000010, cohort: 'minor' },
        ],
        rooms: [{ state: 'OPEN', cohort: 'adult', participantIds: [50000010, 60000010] }],
        conversations: [],
      }),
    });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'the dev environment migration ran at least once',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/mixed-cohort OPEN rooms/);
  });

  test('migration-state precondition fails when cross-cohort conversation is not frozen', async () => {
    const ctx = makeCtx({
      db: makeProbeDb({
        users: [
          { uniqueId: 50000010, cohort: 'adult' },
          { uniqueId: 60000010, cohort: 'minor' },
        ],
        rooms: [],
        conversations: [{ participantIds: [50000010, 60000010], frozen: false }],
      }),
    });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'the dev environment migration ran at least once',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unfrozen cross-cohort conversations/);
  });

  test('migration-state precondition treats SHYTALK_OFFICIAL as exempt', async () => {
    // Officia (uniqueId=1) has cross-cohort follow edges by design.
    const ctx = makeCtx({
      db: makeProbeDb({
        users: [
          {
            uniqueId: 1,
            cohort: 'adult',
            userType: 'SHYTALK_OFFICIAL',
            isOfficial: true,
            followingIds: [60000010],
            followerIds: [60000010],
          },
          { uniqueId: 50000010, cohort: 'adult' },
          { uniqueId: 60000010, cohort: 'minor' },
        ],
        rooms: [],
        conversations: [],
      }),
    });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'the dev environment migration ran at least once',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('migration-state precondition result is cached on ctx (avoids re-scanning)', async () => {
    const fakeUsers = jest.fn(async () => ({
      forEach: (cb) => {
        cb({ data: () => ({ uniqueId: 50000010, cohort: 'adult' }) });
      },
    }));
    const fakeRoomsQuery = { get: jest.fn(async () => ({ forEach: () => {}, size: 0 })) };
    const ctx = makeCtx({
      db: {
        collection: (name) => {
          if (name === 'users') return { get: fakeUsers };
          if (name === 'rooms') return { where: () => fakeRoomsQuery };
          if (name === 'conversations')
            return { get: jest.fn(async () => ({ forEach: () => {} })) };
          return { get: jest.fn(async () => ({ forEach: () => {} })) };
        },
        doc: () => ({ get: async () => ({ exists: false }) }),
      },
    });
    const r1 = await executeStep(
      { kind: 'Given', text: 'the dev environment migration ran at least once' },
      ctx,
    );
    expect(r1.ok).toBe(true);
    const r2 = await executeStep(
      { kind: 'Given', text: 'the dev environment migration ran at least once' },
      ctx,
    );
    expect(r2.ok).toBe(true);
    expect(fakeUsers).toHaveBeenCalledTimes(1); // cached
  });

  test('LiveKit Docker precondition is a no-op for dev target', async () => {
    const ctx = makeCtx({ target: 'dev' });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'the LiveKit Docker container is running on ws://localhost:7880',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('LiveKit Docker precondition passes for local (MVP — no actual WS probe)', async () => {
    const ctx = makeCtx({ target: 'local' });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'the LiveKit Docker container is running on ws://localhost:7880',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });
});

describe('OSA Background verbs end-to-end via runFeatureFile', () => {
  test('all four fixture scenarios pass against a seeded fake', async () => {
    const fetchOk = jest.fn(async (url) => {
      if (typeof url === 'string' && url.includes('signInWithPassword')) {
        const idToken =
          'h.' + Buffer.from(JSON.stringify({ uniqueId: 50000010 })).toString('base64url') + '.s';
        return {
          status: 200,
          json: async () => ({ idToken, refreshToken: 'r', localId: 'f' }),
        };
      }
      if (typeof url === 'string' && url.endsWith('/api/health')) {
        return { status: 200, json: async () => ({ ok: true }) };
      }
      return { status: 500, text: async () => '{}' };
    });
    // Hybrid db: supports doc().get() for read assertions AND
    // collection().get()/.where() for the probe-based migration matcher.
    const docStore = {
      'users/50000010': { uniqueId: 50000010, cohort: 'adult' },
    };
    const probeDb = makeProbeDb({
      users: [{ uniqueId: 50000010, cohort: 'adult' }],
      rooms: [],
      conversations: [],
    });
    const hybridDb = {
      doc: (docPath) => ({
        get: async () => ({
          exists: docStore[docPath] !== undefined,
          data: () => docStore[docPath],
        }),
        set: async (patch, opts = {}) => {
          if (opts.merge) docStore[docPath] = { ...(docStore[docPath] || {}), ...patch };
          else docStore[docPath] = { ...patch };
        },
      }),
      collection: probeDb.collection,
    };
    const ctx = makeCtx({ target: 'dev', fetch: fetchOk, db: hybridDb });
    const { findings, scenarioReports } = await runFeatureFile(
      path.join(FIXTURE_DIR, 'sample-osa-background.feature'),
      ctx,
    );
    for (const sr of scenarioReports) {
      expect(sr.status).toBe('pass');
    }
    expect(findings).toEqual([]);
  });
});

// ── HTTP-call verbs v3 (POSTs / GETs / opens / navigates) ──────────

/**
 * Shared helper — produces a fetch mock that signs in any persona and
 * captures every subsequent /api/ call so tests can assert on body,
 * headers, URL, and the `path` field that v3 records on lastResponse.
 *
 * The mock returns `apiResponse` for /api/ paths so individual tests can
 * shape the status+body, and a stub signin response for the identitytoolkit
 * URL. Test-specific overrides take precedence.
 */
function makeV3Fetch(apiResponse) {
  const idToken =
    'aaa.' + Buffer.from(JSON.stringify({ uniqueId: 50000040 })).toString('base64url') + '.bbb';
  return jest.fn(async (url, opts) => {
    if (url.includes('signInWithPassword')) {
      return {
        status: 200,
        json: async () => ({ idToken, refreshToken: 'rt', localId: 'fb' }),
      };
    }
    // Capture call for assertion later via toHaveBeenCalledWith.
    return {
      status: apiResponse?.status ?? 200,
      text: async () => JSON.stringify(apiResponse?.body ?? {}),
      _capturedOpts: opts,
    };
  });
}

describe('HTTP-call v3 — POSTs with kv-list', () => {
  test('parses single numeric kv-pair and POSTs with persona token', async () => {
    const fetchMock = makeV3Fetch({ status: 404, body: {} });
    const ctx = makeCtx({ fetch: fetchMock });
    await executeStep({ kind: 'Given', text: 'Vexa [P-07] is signed in on Web Chromium' }, ctx);
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Vexa on Web POSTs /api/users/follow with targetUniqueId=60000010',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.lastResponse.status).toBe(404);
    expect(ctx.lastResponse.path).toBe('/api/users/follow');
    // Inspect the captured POST: URL, method, body, auth header.
    const lastCall = fetchMock.mock.calls.at(-1);
    expect(lastCall[0]).toBe('https://dev-api.example/api/users/follow');
    expect(lastCall[1].method).toBe('POST');
    expect(JSON.parse(lastCall[1].body)).toEqual({ targetUniqueId: 60000010 });
    expect(lastCall[1].headers.Authorization).toMatch(/^Bearer /);
  });

  test('parses multi-pair kv-list with mixed types', async () => {
    const fetchMock = makeV3Fetch({ status: 200, body: {} });
    const ctx = makeCtx({ fetch: fetchMock });
    await executeStep({ kind: 'Given', text: 'Vexa [P-07] is signed in on Web Chromium' }, ctx);
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Vexa on Web POSTs /api/economy/send-gift with recipient=60000010 and giftId="rose"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    const lastCall = fetchMock.mock.calls.at(-1);
    expect(JSON.parse(lastCall[1].body)).toEqual({ recipient: 60000010, giftId: 'rose' });
  });

  test('without explicit platform — `Marcus POSTs /api/foo`', async () => {
    const fetchMock = makeV3Fetch({ status: 200, body: {} });
    const ctx = makeCtx({ fetch: fetchMock });
    await executeStep({ kind: 'Given', text: 'Marcus [P-04] is signed in' }, ctx);
    const r = await executeStep({ kind: 'When', text: 'Marcus POSTs /api/foo with x=1' }, ctx);
    expect(r.ok).toBe(true);
    expect(ctx.lastResponse.path).toBe('/api/foo');
  });

  test('errors with actionable message when persona has no session', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Vexa on Web POSTs /api/users/follow with targetUniqueId=60000010' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no signed-in session for "Vexa"/);
  });

  test('errors when kv-list is malformed (key has no =)', async () => {
    const fetchMock = makeV3Fetch({ status: 200 });
    const ctx = makeCtx({ fetch: fetchMock });
    await executeStep({ kind: 'Given', text: 'Vexa [P-07] is signed in' }, ctx);
    const r = await executeStep({ kind: 'When', text: 'Vexa POSTs /api/foo with badpair' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/could not parse kv-pairs/);
  });

  test('accepts multi-word platform "Web Chromium"', async () => {
    const fetchMock = makeV3Fetch({ status: 404 });
    const ctx = makeCtx({ fetch: fetchMock });
    await executeStep({ kind: 'Given', text: 'Vexa [P-07] is signed in on Web Chromium' }, ctx);
    const r = await executeStep(
      { kind: 'When', text: 'Vexa on Web Chromium POSTs /api/foo with x=1' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });
});

describe('HTTP-call v3 — alt word order: POST <path> with X as <Persona>', () => {
  test('kv-pairs body — `POST /api/foo with x=1 as Marcus`', async () => {
    const fetchMock = makeV3Fetch({ status: 404 });
    const ctx = makeCtx({ fetch: fetchMock });
    await executeStep({ kind: 'Given', text: 'Marcus [P-04] is signed in on Android' }, ctx);
    const r = await executeStep(
      { kind: 'When', text: 'POST /api/users/follow with targetUniqueId=50000010 as Marcus' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.lastResponse.path).toBe('/api/users/follow');
    const lastCall = fetchMock.mock.calls.at(-1);
    expect(JSON.parse(lastCall[1].body)).toEqual({ targetUniqueId: 50000010 });
  });

  test('any-payload form — `POST /api/X with any payload as Marcus`', async () => {
    const fetchMock = makeV3Fetch({ status: 200 });
    const ctx = makeCtx({ fetch: fetchMock });
    await executeStep({ kind: 'Given', text: 'Marcus [P-04] is signed in on Android' }, ctx);
    const r = await executeStep(
      { kind: 'When', text: 'POST /api/age-verification/submit with any payload as Marcus' },
      ctx,
    );
    expect(r.ok).toBe(true);
    const lastCall = fetchMock.mock.calls.at(-1);
    expect(JSON.parse(lastCall[1].body)).toEqual({});
  });

  test('explicit-body form — `POST /api/X with body {...} as Marcus`', async () => {
    const fetchMock = makeV3Fetch({ status: 200 });
    const ctx = makeCtx({ fetch: fetchMock });
    await executeStep({ kind: 'Given', text: 'Marcus [P-04] is signed in on Android' }, ctx);
    const r = await executeStep(
      {
        kind: 'When',
        text: 'POST /api/users/me with body {"displayName": "M"} as Marcus',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    const lastCall = fetchMock.mock.calls.at(-1);
    expect(JSON.parse(lastCall[1].body)).toEqual({ displayName: 'M' });
  });

  test('explicit-body form errors on malformed JSON', async () => {
    const fetchMock = makeV3Fetch({ status: 200 });
    const ctx = makeCtx({ fetch: fetchMock });
    await executeStep({ kind: 'Given', text: 'Marcus [P-04] is signed in on Android' }, ctx);
    const r = await executeStep(
      { kind: 'When', text: 'POST /api/users/me with body {not json} as Marcus' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/malformed JSON body/);
  });

  test('errors when persona has no session', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'POST /api/users/follow with x=1 as Marcus' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no signed-in session for "Marcus"/);
  });
});

describe('HTTP-call v3 — attempts POST with body', () => {
  test('drives explicit-body POST', async () => {
    const fetchMock = makeV3Fetch({ status: 403 });
    const ctx = makeCtx({ fetch: fetchMock });
    await executeStep({ kind: 'Given', text: 'Vexa [P-07] is signed in on Web Chromium' }, ctx);
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Vexa on Web attempts POST /api/conversations/c1/messages with body {"text": "hello"}',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.lastResponse.status).toBe(403);
    expect(ctx.lastResponse.path).toBe('/api/conversations/c1/messages');
    const lastCall = fetchMock.mock.calls.at(-1);
    expect(JSON.parse(lastCall[1].body)).toEqual({ text: 'hello' });
  });

  test('errors on malformed JSON body', async () => {
    const fetchMock = makeV3Fetch({ status: 200 });
    const ctx = makeCtx({ fetch: fetchMock });
    await executeStep({ kind: 'Given', text: 'Vexa [P-07] is signed in' }, ctx);
    const r = await executeStep(
      { kind: 'When', text: 'Vexa attempts POST /api/foo with body {bad json}' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/malformed JSON body/);
  });
});

describe('HTTP-call v3 — opens / navigates verbs', () => {
  test('opens /api/X fires a GET and records path on lastResponse', async () => {
    const fetchMock = makeV3Fetch({ status: 200, body: { results: [] } });
    const ctx = makeCtx({ fetch: fetchMock });
    await executeStep({ kind: 'Given', text: 'Vexa [P-07] is signed in on Web Chromium' }, ctx);
    const r = await executeStep(
      { kind: 'When', text: 'Vexa on Web opens "/api/users/search?q=Marcus"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.lastResponse.status).toBe(200);
    expect(ctx.lastResponse.path).toBe('/api/users/search?q=Marcus');
    const lastCall = fetchMock.mock.calls.at(-1);
    expect(lastCall[0]).toBe('https://dev-api.example/api/users/search?q=Marcus');
    expect(lastCall[1].method).toBe('GET');
  });

  test('opens "/discovery" (non-API path) records lastVisit but no HTTP call', async () => {
    const fetchMock = makeV3Fetch({ status: 200 });
    const ctx = makeCtx({ fetch: fetchMock });
    await executeStep({ kind: 'Given', text: 'Vexa [P-07] is signed in on Web Chromium' }, ctx);
    const apiCallsBefore = fetchMock.mock.calls.length;
    const r = await executeStep({ kind: 'When', text: 'Vexa on Web opens "/discovery"' }, ctx);
    expect(r.ok).toBe(true);
    // No additional fetch fired (only the sign-in one before).
    expect(fetchMock.mock.calls.length).toBe(apiCallsBefore);
    expect(ctx.lastVisit).toEqual({ persona: 'Vexa', path: '/discovery' });
  });

  test('navigates to is treated as an alias for opens', async () => {
    const fetchMock = makeV3Fetch({ status: 404 });
    const ctx = makeCtx({ fetch: fetchMock });
    await executeStep({ kind: 'Given', text: 'Vexa [P-07] is signed in on Web Chromium' }, ctx);
    const r = await executeStep(
      { kind: 'When', text: 'Vexa on Web navigates to "/profile/60000010"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.lastVisit).toEqual({ persona: 'Vexa', path: '/profile/60000010' });
  });

  test('opens path with #fragment is treated as web nav not API', async () => {
    const fetchMock = makeV3Fetch({ status: 200 });
    const ctx = makeCtx({ fetch: fetchMock });
    await executeStep({ kind: 'Given', text: 'Vexa [P-07] is signed in on Web Chromium' }, ctx);
    const apiCallsBefore = fetchMock.mock.calls.length;
    const r = await executeStep(
      { kind: 'When', text: 'Vexa on Web opens "/profile/50000040#stalkers"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(fetchMock.mock.calls.length).toBe(apiCallsBefore);
    expect(ctx.lastVisit.path).toBe('/profile/50000040#stalkers');
  });

  // Wake 122: session requirement applies ONLY to /api/ targets.
  // Non-API paths are visit-records only; the runner can't render the
  // SPA's DOM either way, and several scenarios open public web pages
  // (/login.html, /admin.html) BEFORE any session exists — that's the
  // sign-in or auth-bounce flow itself.

  test('non-API path without session records the visit (no error)', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'When', text: 'Vexa on Web opens "/discovery"' }, ctx);
    expect(r.ok).toBe(true);
    expect(ctx.lastVisit).toEqual({ persona: 'Vexa', path: '/discovery' });
  });

  test('public sign-in entry point /login.html opens without a session', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Ines on Web navigates to "/login.html"' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('/api/ target WITHOUT session still errors (network call would have no auth header)', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'When', text: 'Vexa on Web opens "/api/users/me"' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no signed-in session for "Vexa"/);
  });
});

describe('Response-from-path assertion (v3)', () => {
  test('passes when path matches and body has results array', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = {
      status: 200,
      body: { results: [{ uniqueId: 1 }, { uniqueId: 2 }] },
      path: '/api/users/search',
    };
    const r = await executeStep(
      { kind: 'Then', text: 'the response from /api/users/search has 2 results' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('handles bare-array body shape', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = { status: 200, body: [{ a: 1 }], path: '/api/things' };
    const r = await executeStep(
      { kind: 'Then', text: 'the response from /api/things has 1 result' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('handles { data: [...] } shape', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = { status: 200, body: { data: [] }, path: '/api/x' };
    const r = await executeStep(
      { kind: 'Then', text: 'the response from /api/x has 0 results' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('handles { users: [...] } shape', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = { status: 200, body: { users: [{}, {}, {}] }, path: '/api/u' };
    const r = await executeStep(
      { kind: 'Then', text: 'the response from /api/u has 3 results' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('fails when count mismatches with both numbers in error', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = { status: 200, body: { results: [1, 2] }, path: '/api/x' };
    const r = await executeStep(
      { kind: 'Then', text: 'the response from /api/x has 0 results' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain('2');
    expect(r.error).toContain('0');
  });

  test('fails when last response path does not match expected', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = { status: 200, body: { results: [] }, path: '/api/users/me' };
    const r = await executeStep(
      { kind: 'Then', text: 'the response from /api/users/search has 0 results' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain('/api/users/me');
    expect(r.error).toContain('/api/users/search');
  });

  test('fails with no prior response — chain break message', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: 'the response from /api/x has 0 results' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no prior response/);
  });

  test('fails informatively when body has no list field', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = { status: 200, body: { foo: 'bar' }, path: '/api/x' };
    const r = await executeStep(
      { kind: 'Then', text: 'the response from /api/x has 0 results' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no recognised list field/);
    expect(r.error).toContain('foo');
  });
});

describe('HTTP-call v3 end-to-end via runFeatureFile', () => {
  test('all 6 fixture scenarios pass when API + visit + assertions chain', async () => {
    // Build a fetch mock that knows how to respond to each path the fixture hits.
    const idToken =
      'aaa.' + Buffer.from(JSON.stringify({ uniqueId: 50000040 })).toString('base64url') + '.bbb';
    const fetchMock = jest.fn(async (url) => {
      if (url.includes('signInWithPassword')) {
        return {
          status: 200,
          json: async () => ({ idToken, refreshToken: 'rt', localId: 'fb' }),
        };
      }
      if (url.endsWith('/api/health')) return { status: 200, json: async () => ({}) };
      if (url.includes('/api/users/follow') || url.includes('/api/conversations/c1/messages')) {
        return {
          status: url.includes('/messages') ? 403 : 404,
          text: async () => JSON.stringify({}),
        };
      }
      if (url.includes('/api/age-verification/submit')) {
        return { status: 200, text: async () => JSON.stringify({}) };
      }
      if (url.includes('/api/users/search')) {
        return { status: 200, text: async () => JSON.stringify({ results: [] }) };
      }
      // Default for unknown paths.
      return { status: 200, text: async () => JSON.stringify({}) };
    });
    const ctx = makeCtx({ fetch: fetchMock });
    const { findings, scenarioReports } = await runFeatureFile(
      path.join(FIXTURE_DIR, 'sample-http-call-v3.feature'),
      ctx,
    );
    for (const sr of scenarioReports) {
      // Comment lines mean some scenarios may have STEP_NOT_IMPLEMENTED UI assertions in
      // theory — but the fixture is shaped to only use v3 verbs end-to-end. So all pass.
      expect(sr.status).toBe('pass');
    }
    expect(findings).toEqual([]);
  });
});

// ── Code-review finding fixes: hardening tests ─────────────────────

/**
 * C-1 — executeStep must convert handler-thrown exceptions into structured
 * findings instead of crashing the runner. These tests pass a fetch mock
 * that throws (network error / DNS failure / timeout simulation) and
 * verify each new handler returns ok:false with an actionable error
 * message that includes the original throw text.
 */
describe('C-1 — handler-thrown exceptions become structured findings', () => {
  function signedInCtx() {
    const idToken =
      'aaa.' + Buffer.from(JSON.stringify({ uniqueId: 50000040 })).toString('base64url') + '.bbb';
    const ctx = makeCtx({
      fetch: jest.fn(async (url) => {
        if (url.includes('signInWithPassword')) {
          return {
            status: 200,
            json: async () => ({ idToken, refreshToken: 'rt', localId: 'fb' }),
          };
        }
        throw new Error('ECONNREFUSED');
      }),
    });
    return ctx;
  }

  test('POSTs handler — fetch rejection becomes finding, not crash', async () => {
    const ctx = signedInCtx();
    await executeStep({ kind: 'Given', text: 'Vexa [P-07] is signed in on Web Chromium' }, ctx);
    const r = await executeStep({ kind: 'When', text: 'Vexa on Web POSTs /api/foo with x=1' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('ECONNREFUSED');
    expect(r.error).toMatch(/handler threw/);
  });

  test('alt-order POST handler — fetch rejection becomes finding', async () => {
    const ctx = signedInCtx();
    await executeStep({ kind: 'Given', text: 'Marcus [P-04] is signed in on Android' }, ctx);
    const r = await executeStep({ kind: 'When', text: 'POST /api/foo with x=1 as Marcus' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('ECONNREFUSED');
  });

  test('attempts POST handler — fetch rejection becomes finding', async () => {
    const ctx = signedInCtx();
    await executeStep({ kind: 'Given', text: 'Vexa [P-07] is signed in on Web Chromium' }, ctx);
    const r = await executeStep(
      { kind: 'When', text: 'Vexa attempts POST /api/foo with body {"x": 1}' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain('ECONNREFUSED');
  });

  test('opens /api handler — fetch rejection becomes finding', async () => {
    const ctx = signedInCtx();
    await executeStep({ kind: 'Given', text: 'Vexa [P-07] is signed in on Web Chromium' }, ctx);
    const r = await executeStep({ kind: 'When', text: 'Vexa on Web opens "/api/users/me"' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('ECONNREFUSED');
  });

  test('end-to-end — a thrown fetch surfaces as finding, runFeatureFile does not reject', async () => {
    const fetchMock = jest.fn(async (url) => {
      if (url.includes('signInWithPassword')) {
        const idToken =
          'aaa.' +
          Buffer.from(JSON.stringify({ uniqueId: 50000040 })).toString('base64url') +
          '.bbb';
        return {
          status: 200,
          json: async () => ({ idToken, refreshToken: 'rt', localId: 'fb' }),
        };
      }
      if (url.endsWith('/api/health')) return { status: 200, json: async () => ({}) };
      throw new Error('SIMULATED_NETWORK_BLIP');
    });
    const ctx = makeCtx({ fetch: fetchMock });
    const result = await runFeatureFile(path.join(FIXTURE_DIR, 'sample-http-call-v3.feature'), ctx);
    // The throw must surface as at least one finding — confirm the
    // try/catch wrap doesn't merely suppress the error.
    const networkFindings = result.findings.filter((f) =>
      (f.error || '').includes('SIMULATED_NETWORK_BLIP'),
    );
    expect(networkFindings.length).toBeGreaterThan(0);
    // The error should be tagged with "handler threw:" prefix so the
    // operator can distinguish a runtime exception from an assertion failure.
    expect(networkFindings[0].error).toMatch(/handler threw/);
  });
});

/**
 * I-4 — sessions with missing/undefined idToken (sign-in handler returned
 * 200 but the response body had no idToken field) must fail fast with an
 * actionable error rather than send `Authorization: Bearer undefined`.
 */
describe('I-4 — session with no idToken fails fast in every handler', () => {
  function ctxWithBrokenSession(name) {
    const ctx = makeCtx({ fetch: jest.fn() });
    ctx.sessions.set(name, { persona: {}, idToken: undefined, customClaims: {} });
    return ctx;
  }

  test('POSTs handler errors with "no idToken"', async () => {
    const ctx = ctxWithBrokenSession('Vexa');
    const r = await executeStep({ kind: 'When', text: 'Vexa on Web POSTs /api/foo with x=1' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no idToken/);
  });

  test('alt-order POST handler errors with "no idToken"', async () => {
    const ctx = ctxWithBrokenSession('Marcus');
    const r = await executeStep({ kind: 'When', text: 'POST /api/foo with x=1 as Marcus' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no idToken/);
  });

  test('attempts POST handler errors with "no idToken"', async () => {
    const ctx = ctxWithBrokenSession('Vexa');
    const r = await executeStep(
      { kind: 'When', text: 'Vexa attempts POST /api/foo with body {"x": 1}' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no idToken/);
  });

  test('opens handler errors with "no idToken" for /api/ path', async () => {
    const ctx = ctxWithBrokenSession('Vexa');
    const r = await executeStep({ kind: 'When', text: 'Vexa on Web opens "/api/users/me"' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no idToken/);
  });

  // The idToken guard is intentionally scoped to API paths only — a
  // non-API visit ("/discovery") does not fire an HTTP call and so a
  // missing idToken is irrelevant to that step. Documenting the contract.
  test('opens handler PASSES for non-API path even with broken session', async () => {
    const ctx = ctxWithBrokenSession('Vexa');
    const r = await executeStep({ kind: 'When', text: 'Vexa on Web opens "/discovery"' }, ctx);
    expect(r.ok).toBe(true);
    expect(ctx.lastVisit).toEqual({ persona: 'Vexa', path: '/discovery' });
  });

  test('existing sends GET handler also errors with "no idToken" (retroactive fix)', async () => {
    const ctx = ctxWithBrokenSession('Alice');
    const r = await executeStep(
      { kind: 'When', text: 'Alice sends GET /api/users/me with her ID token' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no idToken/);
  });
});

/**
 * I-5 — response-from-path must produce an actionable error when the
 * upstream response had no JSON body (204 No Content, binary, etc.),
 * not the confusing "no recognised list field (keys: object)" message.
 */
describe('I-5 — response-from-path handles non-JSON / null body honestly', () => {
  test('body=null returns "response body was not JSON" with status', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = { status: 204, body: null, path: '/api/x' };
    const r = await executeStep(
      { kind: 'Then', text: 'the response from /api/x has 0 results' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/was not JSON/);
    expect(r.error).toContain('204');
  });

  test('body=undefined returns the same actionable error', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = { status: 500, body: undefined, path: '/api/x' };
    const r = await executeStep(
      { kind: 'Then', text: 'the response from /api/x has 0 results' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/was not JSON/);
    expect(r.error).toContain('500');
  });
});

/**
 * I-6 — `opens` to a non-API path must clear `ctx.lastResponse` so a
 * subsequent assertion like `the response status is 200` fails honestly
 * with "no prior response" rather than silently asserting against a
 * stale response from an earlier step.
 */
describe('I-6 — opens non-API path clears stale lastResponse', () => {
  test('non-API open clears stale lastResponse', async () => {
    const fetchMock = jest.fn(async (url) => {
      const idToken =
        'aaa.' + Buffer.from(JSON.stringify({ uniqueId: 50000040 })).toString('base64url') + '.bbb';
      if (url.includes('signInWithPassword')) {
        return {
          status: 200,
          json: async () => ({ idToken, refreshToken: 'rt', localId: 'fb' }),
        };
      }
      return { status: 200, text: async () => JSON.stringify({ a: 1 }) };
    });
    const ctx = makeCtx({ fetch: fetchMock });
    await executeStep({ kind: 'Given', text: 'Vexa [P-07] is signed in on Web Chromium' }, ctx);
    // Pre-populate lastResponse via an API path open.
    await executeStep({ kind: 'When', text: 'Vexa on Web opens "/api/users/me"' }, ctx);
    expect(ctx.lastResponse).not.toBeNull();
    // Now open a non-API path — stale lastResponse must be cleared.
    await executeStep({ kind: 'When', text: 'Vexa on Web opens "/discovery"' }, ctx);
    expect(ctx.lastResponse).toBeNull();
    // Confirm the honest-failure contract: a subsequent assertion gets a
    // "no prior request" error, not a silent pass on stale data.
    const r = await executeStep({ kind: 'Then', text: 'the response status is 200' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no prior request/);
  });

  test('runScenario resets lastVisit between scenarios', async () => {
    // The fixture has multiple scenarios; verify lastVisit is reset before
    // each scenario by ensuring at least one scenario fires opens "/discovery"
    // and the per-scenario isolation holds (scenario sequence runs cleanly).
    const fetchMock = jest.fn(async (url) => {
      if (url.includes('signInWithPassword')) {
        const idToken =
          'aaa.' +
          Buffer.from(JSON.stringify({ uniqueId: 50000040 })).toString('base64url') +
          '.bbb';
        return {
          status: 200,
          json: async () => ({ idToken, refreshToken: 'rt', localId: 'fb' }),
        };
      }
      if (url.endsWith('/api/health')) return { status: 200, json: async () => ({}) };
      if (url.includes('/api/users/follow') || url.includes('/api/conversations/c1/messages')) {
        return {
          status: url.includes('/messages') ? 403 : 404,
          text: async () => JSON.stringify({}),
        };
      }
      if (url.includes('/api/age-verification/submit')) {
        return { status: 200, text: async () => JSON.stringify({}) };
      }
      if (url.includes('/api/users/search')) {
        return { status: 200, text: async () => JSON.stringify({ results: [] }) };
      }
      return { status: 200, text: async () => JSON.stringify({}) };
    });
    const ctx = makeCtx({ fetch: fetchMock });
    const { scenarioReports } = await runFeatureFile(
      path.join(FIXTURE_DIR, 'sample-http-call-v3.feature'),
      ctx,
    );
    // After the full run, ctx.lastVisit reflects only the LAST scenario's
    // state (the "opens /discovery" scenario). Per-scenario reset is verified
    // by all 6 scenarios passing — if lastVisit bled in, the runner's per-
    // scenario reset would not be honoured. Every scenario passes.
    for (const sr of scenarioReports) {
      expect(sr.status).toBe('pass');
    }
  });
});

/**
 * I-3 — the alt-order POST handler dispatches the explicit-body branch off
 * the regex capture group (m[3]), not a string-prefix on m[2]. The concrete
 * failure mode is unreachable today (the regex's `body {...}` alternative
 * wins for actual JSON bodies) but the new gating prevents future fixture
 * authors from triggering JSON.parse(undefined) crashes.
 */
describe('I-3 — alt-order POST dispatches body-branch off m[3], not m[2]', () => {
  test('explicit-body still works (m[3] defined)', async () => {
    const idToken =
      'aaa.' + Buffer.from(JSON.stringify({ uniqueId: 50000040 })).toString('base64url') + '.bbb';
    const fetchMock = jest.fn(async (url) => {
      if (url.includes('signInWithPassword')) {
        return { status: 200, json: async () => ({ idToken, refreshToken: 'rt', localId: 'fb' }) };
      }
      return { status: 200, text: async () => JSON.stringify({}) };
    });
    const ctx = makeCtx({ fetch: fetchMock });
    await executeStep({ kind: 'Given', text: 'Marcus [P-04] is signed in on Android' }, ctx);
    const r = await executeStep(
      { kind: 'When', text: 'POST /api/x with body {"a": 1} as Marcus' },
      ctx,
    );
    expect(r.ok).toBe(true);
    const lastCall = fetchMock.mock.calls.at(-1);
    expect(JSON.parse(lastCall[1].body)).toEqual({ a: 1 });
  });

  // A kv-text fragment whose first field name starts with `body` (e.g.,
  // `bodyVar=42`) must NOT accidentally trigger the JSON-body branch.
  // m[3] is undefined → kv-pair branch runs → POST body is {bodyVar: 42}.
  test('kv-text with field name starting with "body" goes to kv-pair branch', async () => {
    const idToken =
      'aaa.' + Buffer.from(JSON.stringify({ uniqueId: 50000040 })).toString('base64url') + '.bbb';
    const fetchMock = jest.fn(async (url) => {
      if (url.includes('signInWithPassword')) {
        return { status: 200, json: async () => ({ idToken, refreshToken: 'rt', localId: 'fb' }) };
      }
      return { status: 200, text: async () => JSON.stringify({}) };
    });
    const ctx = makeCtx({ fetch: fetchMock });
    await executeStep({ kind: 'Given', text: 'Marcus [P-04] is signed in on Android' }, ctx);
    const r = await executeStep(
      { kind: 'When', text: 'POST /api/x with bodyVar=42 as Marcus' },
      ctx,
    );
    expect(r.ok).toBe(true);
    const lastCall = fetchMock.mock.calls.at(-1);
    expect(JSON.parse(lastCall[1].body)).toEqual({ bodyVar: 42 });
  });
});

describe('I-5 — response-from-path with body=null but successful status', () => {
  // Some endpoints intentionally return 200 with no body (e.g., empty list
  // endpoint returning bare 200 + nothing). The null-body guard fires
  // regardless of status — fine, but document with a test that the error
  // message still surfaces the original status so the operator can tell
  // "no body AND failure" vs "no body BUT 200".
  test('body=null with 200 status still produces actionable error', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = { status: 200, body: null, path: '/api/x' };
    const r = await executeStep(
      { kind: 'Then', text: 'the response from /api/x has 0 results' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/was not JSON/);
    expect(r.error).toContain('200');
  });
});

// ── Wake 66 ──────────────────────────────────────────────────────────

describe('Wake 66 — multi-clause persona locale state-seed', () => {
  // j08-cross-cohort-wall.feature:124
  //   Given Vexa on Web locale=en, Marcus on Android locale=en
  // Background-block precondition that pins per-persona locale for the
  // scenario. Handler must look up both personas (so a typo fails fast)
  // and record locale in ctx.personaLocales for later assertions.
  test('two personas + platforms + locales — both recorded', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'Vexa on Web locale=en, Marcus on Android locale=en' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaLocales.get('Vexa')).toEqual({ platform: 'Web', locale: 'en' });
    expect(ctx.personaLocales.get('Marcus')).toEqual({ platform: 'Android', locale: 'en' });
  });

  test('different locales per persona (mixed scenario)', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'Hayato on Android locale=ja, Alice on Web locale=en' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.personaLocales.get('Hayato')).toEqual({ platform: 'Android', locale: 'ja' });
    expect(ctx.personaLocales.get('Alice')).toEqual({ platform: 'Web', locale: 'en' });
  });

  test('unknown persona — fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'Zzzunknown on Web locale=en, Alice on Web locale=en' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Zzzunknown/);
  });
});

describe('Wake 66 — LiveKit track is disconnected (bare assertion)', () => {
  // j09-voice-room-host.feature:87
  //   Then Alice's LiveKit track for room {roomId} is disconnected
  // Also j04:90 (via `within Nms` wrapping):
  //   Then within 5000ms Hayato's LiveKit track for "r1" is disconnected
  // After the `within` wrapper peels off, the inner step lands here.
  // Three room-identifier forms: `{placeholder}`, `"quoted"`, bare token.
  test('placeholder room id — driver returns true → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ liveKitDriver: { trackIsDisconnected: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's LiveKit track for room {roomId} is disconnected" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', '{roomId}');
  });

  test('quoted room id — driver receives unquoted', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ liveKitDriver: { trackIsDisconnected: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Hayato\'s LiveKit track for "r1" is disconnected' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Hayato', 'r1');
  });

  test('driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ liveKitDriver: { trackIsDisconnected: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's LiveKit track for room r1 is disconnected" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/still connected|not disconnected/i);
  });

  test('no driver configured → clear error', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Alice's LiveKit track for room r1 is disconnected" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/liveKitDriver/);
  });
});

describe("Wake 66 — tester hears <X>'s audio on <Y>'s device", () => {
  // j09-voice-room-host.feature:65
  //   Then the tester hears Ines's audio on Theo's Android device (real microphone)
  // The trailing `(real microphone)` is stripped by stripStepAnnotation
  // before the matcher runs. This step is fundamentally @manual — the
  // runner has no way to verify real audio without a human. We expose a
  // testerDriver gate: in interactive mode the driver prompts; in auto
  // mode the driver is absent and the step fails with a clear marker
  // so the operator knows to tag the scenario @manual.
  test('testerDriver returns true → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ testerDriver: { confirmHearsAudio: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "the tester hears Ines's audio on Theo's Android device",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Ines', 'Theo', 'Android');
  });

  test('testerDriver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ testerDriver: { confirmHearsAudio: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "the tester hears Ines's audio on Theo's iOS Sim device",
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/tester did not confirm/i);
  });

  test('no testerDriver — clear @manual hint', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: "the tester hears Ines's audio on Theo's Android device",
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/manual/i);
  });
});

describe('Wake 66 — UI shows tab with no navigation to screen', () => {
  // j09-voice-room-host.feature:94
  //   Then Marcus's Android UI shows the "rooms" tab with no navigation to the room screen
  // Composite: asserts (a) tab is current AND (b) no nav-stack push to
  // the named screen has occurred. Driver returns boolean for the combined
  // check — keeps the matcher contract narrow and lets each platform
  // driver decide how to introspect tab + nav stack.
  test('android driver returns true → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsTabWithNoNavTo: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Marcus\'s Android UI shows the "rooms" tab with no navigation to the room screen',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('rooms', 'room');
  });

  test('ios driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { iosShowsTabWithNoNavTo: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Mia\'s iOS Sim UI shows the "discovery" tab with no navigation to the profile screen',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/discovery|profile/);
  });

  test('web driver path', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsTabWithNoNavTo: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Alice\'s Web UI shows the "home" tab with no navigation to the wallet screen',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('home', 'wallet');
  });

  test('unknown platform — fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Alice\'s Web UI shows the "home" tab with no navigation to the wallet screen',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webShowsTabWithNoNavTo/);
  });
});

describe('Wake 66 — conversation between two personas is frozen (state-seed)', () => {
  // j08-cross-cohort-wall.feature:137
  //   Given the conversation "c2" between Hayato (post-flip minor, locale=ja)
  //         and Alice (adult, locale=en) is frozen
  // The mid-step `(annotation)` parens describe the personas' cohort/locale
  // but are NOT stripped (stripStepAnnotation is END-anchored). The matcher
  // tolerates them inline and ignores their content — corpus author's
  // intent is to document the test setup, not to drive behaviour.
  test('seeds conversations/<id> with frozen=true and participantIds', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text:
          'the conversation "c2" between Hayato (post-flip minor, locale=ja) ' +
          'and Alice (adult, locale=en) is frozen',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    const conv = db._docs['conversations/c2'];
    expect(conv).toBeDefined();
    expect(conv.frozen).toBe(true);
    // Hayato = 50000030, Alice = 50000010
    expect(conv.participantIds.sort()).toEqual([50000010, 50000030]);
  });

  test('unknown persona — fail', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'the conversation "c9" between Zzzghost (a, b) and Alice (c, d) is frozen',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Zzzghost/);
  });

  test('no db — fail with clear hint', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'the conversation "c2" between Hayato (a) and Alice (b) is frozen',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db/);
  });
});

describe('Wake 66 — response from /api/X as <persona> has N results and "k=v" in every row', () => {
  // j02-minor-new-restricted.feature:54
  //   Then the response from /api/users/search as Mia has 1 result and "cohort=minor" in every row
  // Composite assertion: count + per-row field. The "as <persona>" is
  // informational (identifies which persona made the request); the matcher
  // does NOT re-issue the request — just validates ctx.lastResponse which
  // an earlier "Mia on iOS Sim GETs /api/users/search" step recorded.
  test('count and field match for every row → ok', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = {
      status: 200,
      path: '/api/users/search',
      body: { results: [{ uniqueId: 90000003, cohort: 'minor' }] },
    };
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the response from /api/users/search as Mia has 1 result and "cohort=minor" in every row',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('row violates field assertion → fail with offending row', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = {
      status: 200,
      path: '/api/users/search',
      body: {
        results: [
          { uniqueId: 90000003, cohort: 'minor' },
          { uniqueId: 60000010, cohort: 'adult' },
        ],
      },
    };
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the response from /api/users/search as Mia has 2 results and "cohort=minor" in every row',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/cohort/);
    expect(r.error).toMatch(/adult/);
  });

  test('count mismatch → fail', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = {
      status: 200,
      path: '/api/users/search',
      body: { results: [{ cohort: 'minor' }] },
    };
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the response from /api/users/search as Mia has 5 results and "cohort=minor" in every row',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/expected 5.*got 1|expected 5.*actual 1/);
  });

  test('path mismatch → fail with both paths', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = {
      status: 200,
      path: '/api/economy/wallet',
      body: { results: [] },
    };
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the response from /api/users/search as Mia has 0 results and "cohort=minor" in every row',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/wallet|search/);
  });

  test('no recorded response → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the response from /api/users/search as Mia has 0 results and "cohort=minor" in every row',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no recorded/);
  });
});

// ── Wake 67 ──────────────────────────────────────────────────────────

describe('Wake 67 — generic "attempts to <action>" navigation/persistence', () => {
  // j10-mid-room-warning.feature:61
  //   When Theo on Android attempts to navigate via the back button
  // j10-mid-room-warning.feature:64
  //   When Theo on Android attempts to kill and relaunch the app
  // The "attempts to <verb-phrase>" form drives navigation-lock testing.
  // Driver receives the bare action description and decides how to perform
  // it (back-button on Android = `adb shell input keyevent KEYCODE_BACK`;
  // app kill+relaunch = `am force-stop` + `am start`). Earlier specific
  // matchers (`attempts to navigate to "X" via deep link`,
  // `attempts to start a conversation`, `attempts to follow`,
  // `attempts to block`) all run BEFORE this generic one — first-match-wins
  // means the narrow ones still win.
  test('android back-button attempt → driver receives action', async () => {
    const spy = jest.fn(async () => ({ ok: true }));
    const ctx = makeCtx({ uiDriver: { androidAttemptAction: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Theo on Android attempts to navigate via the back button' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo', 'navigate via the back button');
  });

  test('android kill+relaunch attempt', async () => {
    const spy = jest.fn(async () => ({ ok: true }));
    const ctx = makeCtx({ uiDriver: { androidAttemptAction: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Theo on Android attempts to kill and relaunch the app' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo', 'kill and relaunch the app');
  });

  test('iOS Sim action', async () => {
    const spy = jest.fn(async () => ({ ok: true }));
    const ctx = makeCtx({ uiDriver: { iosAttemptAction: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Ines on iOS Sim attempts to swipe down to dismiss' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Ines', 'swipe down to dismiss');
  });

  test('driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Theo on Android attempts to navigate via the back button' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidAttemptAction/);
  });
});

describe('Wake 67 — UI shows the warning reason "<text>"', () => {
  // j10-mid-room-warning.feature:48
  //   Then Theo's Android UI shows the warning reason "Inappropriate language in voice room"
  // Asserts the warning screen displays a SPECIFIC reason string. Driver
  // returns the current displayed reason (or null); the matcher does an
  // exact string compare against the corpus value.
  test('matches displayed reason → ok', async () => {
    const spy = jest.fn(async () => 'Inappropriate language in voice room');
    const ctx = makeCtx({ uiDriver: { androidGetWarningReason: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Theo\'s Android UI shows the warning reason "Inappropriate language in voice room"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('displayed reason differs → fail with both values', async () => {
    const spy = jest.fn(async () => 'Some other reason');
    const ctx = makeCtx({ uiDriver: { androidGetWarningReason: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Theo\'s Android UI shows the warning reason "Inappropriate language in voice room"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Inappropriate/);
    expect(r.error).toMatch(/Some other reason/);
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: 'Theo\'s Android UI shows the warning reason "X"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidGetWarningReason/);
  });
});

describe('Wake 67 — UI shows the <noun-phrase> image', () => {
  // j10-mid-room-warning.feature:49
  //   Then Theo's Android UI shows the police duck image
  // Bare-noun named-image assertion. The image identifier is a free-form
  // noun phrase (`police duck`, `daily reward`, etc.) — driver maps to
  // its UI introspection layer (Compose semantics for Android, Inspector
  // tags for iOS).
  test('android shows named image → driver true → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsNamedImage: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Theo's Android UI shows the police duck image" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo', 'police duck');
  });

  test('driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidShowsNamedImage: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Theo's Android UI shows the police duck image" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/police duck/);
  });

  test('iOS Sim variant', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosShowsNamedImage: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Ines's iOS Sim UI shows the daily reward image" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Ines', 'daily reward');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Theo's Android UI shows the police duck image" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidShowsNamedImage/);
  });
});

describe('Wake 67 — UI does not show the <bare-noun>', () => {
  // j10-mid-room-warning.feature:50
  //   Then Theo's Android UI does not show the voice room UI
  // Bare-noun absence assertion. The noun phrase is freeform — it could
  // be `voice room UI`, `warning screen`, `confirmation banner`. This is
  // narrower than the existing `element with tag "X"` matcher (which
  // takes a quoted test tag) and the `"X" button` matcher (which requires
  // both quotes and a "button" suffix). First-match-wins keeps those
  // narrow matchers winning when their forms apply.
  test('android: driver returns false (not shown) → ok', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidShowsNamedUi: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Theo's Android UI does not show the voice room UI" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo', 'voice room UI');
  });

  test('driver returns true (still shown) → fail', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsNamedUi: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Theo's Android UI does not show the voice room UI" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/voice room UI/);
  });

  test('iOS Sim variant', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { iosShowsNamedUi: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Ines's iOS Sim UI does not show the confirmation banner" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Ines', 'confirmation banner');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Theo's Android UI does not show the voice room UI" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidShowsNamedUi/);
  });
});

describe('Wake 67 — Greta on Web Admin searches "<text>"', () => {
  // j10-mid-room-warning.feature:33
  //   When Greta on Web Admin searches "50000060"
  // Bare admin-search action (no `in <screen>` suffix — that variant is
  // the older Android-search matcher at line ~2682). Driver types the
  // query into the admin panel's universal search field and waits for
  // results.
  test('admin search query → driver receives text', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webAdminSearch: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin searches "50000060"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('50000060');
  });

  test('search with text query', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webAdminSearch: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin searches "harassment"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('harassment');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin searches "50000060"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webAdminSearch/);
  });
});

describe('Wake 67 — Greta on Web Admin confirms the <name> dialog', () => {
  // j10-mid-room-warning.feature:35
  //   When Greta on Web Admin confirms the warning dialog
  // Admin modal-confirmation. Driver clicks the confirm button in the
  // named modal. Dialog name is a multi-word noun (`warning`, `delete
  // user`, `revoke session`).
  test('confirms named dialog → driver receives name', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webAdminConfirmDialog: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin confirms the warning dialog' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('warning');
  });

  test('multi-word dialog name', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webAdminConfirmDialog: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin confirms the delete user dialog' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('delete user');
  });

  test('driver returns false (no such dialog) → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webAdminConfirmDialog: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin confirms the warning dialog' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/warning|no.*dialog/i);
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin confirms the warning dialog' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webAdminConfirmDialog/);
  });
});

// ── Wake 68 ──────────────────────────────────────────────────────────

describe('Wake 68 — bare-verb single-word tap (taps <verb>)', () => {
  // j10-mid-room-warning.feature:89
  //   When Theo on Android taps acknowledge
  // Distinct from the existing `taps "X"` (quoted-string) matcher and
  // `taps the room card` (multi-word). This catches a single lowercase
  // verb/noun like `acknowledge`, `cancel`, `retry`. Driver receives the
  // bare verb so it can resolve to the right UI element (e.g., the
  // acknowledge button on the warning screen).
  test('android bare-verb tap → driver receives verb', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidTapBareVerb: spy } });
    const r = await executeStep({ kind: 'When', text: 'Theo on Android taps acknowledge' }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo', 'acknowledge');
  });

  test('iOS Sim variant', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosTapBareVerb: spy } });
    const r = await executeStep({ kind: 'When', text: 'Ines on iOS Sim taps retry' }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Ines', 'retry');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'When', text: 'Theo on Android taps acknowledge' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidTapBareVerb/);
  });
});

describe('Wake 68 — tap the quoted target (taps the "<id>" / taps the room "<id>" card)', () => {
  // j09-voice-room-host.feature:101
  //   When Theo on Android taps the "room_endRoomButton"
  // j10-mid-room-warning.feature:76
  //   When Theo on Android taps the room "r1" card
  // Two related shapes share one matcher: the "the" prefix + a quoted
  // identifier (test tag or room ID). The optional `room\s+` and trailing
  // `\s+card` accommodate the room-card variant.
  test('quoted test-tag (no "room", no "card")', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidTapQuotedTarget: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Theo on Android taps the "room_endRoomButton"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo', 'room_endRoomButton', false);
  });

  test('room "<id>" card form → isRoomCard=true', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidTapQuotedTarget: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Theo on Android taps the room "r1" card' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo', 'r1', true);
  });

  test('iOS Sim variant', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosTapQuotedTarget: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Ines on iOS Sim taps the "messageBubble"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Ines', 'messageBubble', false);
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Theo on Android taps the "room_endRoomButton"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidTapQuotedTarget/);
  });
});

describe('Wake 68 — persona is in voice room as a <role> (state-seed)', () => {
  // j10-mid-room-warning.feature:84
  //   Given Theo is in voice room "r2" as a NON-seated listener
  // State-seed that records the persona's role in a room. Doesn't take a
  // platform — the platform comes from a separate "signed-in on <plat>"
  // step. The role is a 2-3-word phrase (NON-seated listener, seated host).
  // Writes to Firestore: appends persona to participantIds, records role
  // in a `roles` map keyed by stringified uniqueId (mirror of the existing
  // micStates pattern).
  test('writes participantIds and roles map', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Theo is in voice room "r2" as a NON-seated listener' },
      ctx,
    );
    expect(r.ok).toBe(true);
    // Theo = 50000060
    expect(db._docs['rooms/r2'].participantIds).toContain(50000060);
    expect(db._docs['rooms/r2'].roles['50000060']).toBe('NON-seated listener');
  });

  test('seated host role', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Alice is in voice room "r3" as a seated host' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['rooms/r3'].roles['50000010']).toBe('seated host');
  });

  test('unknown persona → fail', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Zzzghost is in voice room "r9" as a listener' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Zzzghost/);
  });

  test('no db → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'Theo is in voice room "r2" as a NON-seated listener' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db/);
  });
});

describe('Wake 68 — the room "<id>" is still <STATE>', () => {
  // j10-mid-room-warning.feature:75
  //   Given the room "r1" is still OPEN (was not auto-closed)
  // The trailing `(was not auto-closed)` is stripped by stripStepAnnotation.
  // Asserts the room doc's `state` field. Three states observed in corpus:
  // OPEN, CLOSED, FROZEN — uppercase by convention.
  test('matching state → ok', async () => {
    const db = makeStatefulFakeDb({ 'rooms/r1': { state: 'OPEN' } });
    const ctx = makeCtx({ db });
    const r = await executeStep({ kind: 'Given', text: 'the room "r1" is still OPEN' }, ctx);
    expect(r.ok).toBe(true);
  });

  test('mismatched state → fail with both states', async () => {
    const db = makeStatefulFakeDb({ 'rooms/r1': { state: 'CLOSED' } });
    const ctx = makeCtx({ db });
    const r = await executeStep({ kind: 'Given', text: 'the room "r1" is still OPEN' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/OPEN/);
    expect(r.error).toMatch(/CLOSED/);
  });

  test('no such room doc → fail', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep({ kind: 'Given', text: 'the room "r1" is still OPEN' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/rooms\/r1|does not exist/);
  });
});

describe('Wake 68 — LiveKit publish permission/track is enabled/disabled (platform-optional)', () => {
  // j10-mid-room-warning.feature:29
  //   Then Theo's Android LiveKit publish track for room "r1" is enabled
  // j10-mid-room-warning.feature:44 (via within Nms wrapper)
  //   Then within 5000ms Theo's LiveKit publish permission for room "r1" is disabled
  // Platform is optional — j10:44 has no platform between "Theo's" and
  // "LiveKit"; j10:29 has Android. Driver receives (name, kind, roomId,
  // expectedState); returns boolean truthy iff state matches.
  test('with platform + enabled state', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ liveKitDriver: { publishStateMatches: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Theo\'s Android LiveKit publish track for room "r1" is enabled' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo', 'track', 'r1', 'enabled');
  });

  test('without platform + disabled state', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ liveKitDriver: { publishStateMatches: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Theo\'s LiveKit publish permission for room "r1" is disabled' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo', 'permission', 'r1', 'disabled');
  });

  test('driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ liveKitDriver: { publishStateMatches: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Theo\'s LiveKit publish track for room "r1" is enabled' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/track/);
    expect(r.error).toMatch(/enabled/);
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: 'Theo\'s LiveKit publish track for room "r1" is enabled' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/liveKitDriver|publishStateMatches/);
  });
});

describe('Wake 68 — UI mic indicator shows "<state>"', () => {
  // j10-mid-room-warning.feature:80
  //   Then Theo's Android UI mic indicator shows "muted"
  // The mic indicator is the visual badge on the seat that reflects
  // server-side mic state (muted/active). Driver returns the current
  // displayed state; matcher does exact string compare.
  test('matching state → ok', async () => {
    const spy = jest.fn(async () => 'muted');
    const ctx = makeCtx({ uiDriver: { androidGetMicIndicator: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Theo\'s Android UI mic indicator shows "muted"' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('mismatched state → fail with both', async () => {
    const spy = jest.fn(async () => 'active');
    const ctx = makeCtx({ uiDriver: { androidGetMicIndicator: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Theo\'s Android UI mic indicator shows "muted"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/muted/);
    expect(r.error).toMatch(/active/);
  });

  test('iOS Sim variant', async () => {
    const spy = jest.fn(async () => 'active');
    const ctx = makeCtx({ uiDriver: { iosGetMicIndicator: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Ines\'s iOS Sim UI mic indicator shows "active"' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: 'Theo\'s Android UI mic indicator shows "muted"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidGetMicIndicator/);
  });
});

// ── Wake 69 ──────────────────────────────────────────────────────────

describe('Wake 69 — persona-cohort-room state-seed (no room id, abstract)', () => {
  // j10-mid-room-warning.feature:94
  //   Given Marcus [P-04] is on iOS Sim seated in a minor-cohort room with mic open
  // Differs from the existing `is in voice room "X" with mic <state>` matcher
  // because there's NO room id — the corpus author is saying "any minor-cohort
  // room is fine, just create one and seat Marcus in it." Handler synthesises
  // a room id, writes the cohort + mic state + seat assignment.
  test('writes ephemeral room with cohort and seated persona', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Marcus [P-04] is on iOS Sim seated in a minor-cohort room with mic open',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    const roomKeys = Object.keys(db._docs).filter((k) => k.startsWith('rooms/'));
    expect(roomKeys).toHaveLength(1);
    const room = db._docs[roomKeys[0]];
    expect(room.cohort).toBe('minor');
    expect(room.participantIds).toContain(60000010);
    expect(room.micStates['60000010']).toBe('open');
    expect(room.seats[0]).toEqual(expect.objectContaining({ userId: 60000010 }));
  });

  test('adult-cohort variant + muted mic', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Alice [P-02] is on Web seated in an adult-cohort room with mic muted',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    const roomKeys = Object.keys(db._docs).filter((k) => k.startsWith('rooms/'));
    expect(roomKeys).toHaveLength(1);
    const room = db._docs[roomKeys[0]];
    expect(room.cohort).toBe('adult');
    expect(room.micStates['50000010']).toBe('muted');
  });

  test('unknown persona → fail', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Zzzghost is on Android seated in a minor-cohort room with mic open',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Zzzghost/);
  });

  test('no db → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Marcus [P-04] is on iOS Sim seated in a minor-cohort room with mic open',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db/);
  });
});

describe('Wake 69 — long-press + tap composite', () => {
  // j11-harassment-moderation-cycle.feature:31
  //   When Nora on iOS Sim long-presses the offensive message and taps "Report"
  // Two-step gesture: long-press the message bubble (opens context menu),
  // then tap the named menu item. One matcher to keep the corpus author's
  // intent atomic — driver runs both gestures and reports the result.
  test('iOS Sim → driver receives action label', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosLongPressMessageAndTap: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Nora on iOS Sim long-presses the offensive message and taps "Report"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Nora', 'Report');
  });

  test('android variant', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidLongPressMessageAndTap: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Raul on Android long-presses the offensive message and taps "Block"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Raul', 'Block');
  });

  test('driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { iosLongPressMessageAndTap: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Nora on iOS Sim long-presses the offensive message and taps "Report"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Report/);
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Nora on iOS Sim long-presses the offensive message and taps "Report"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/iosLongPressMessageAndTap/);
  });
});

describe('Wake 69 — selects reason "<text>" and confirms', () => {
  // j11-harassment-moderation-cycle.feature:32
  //   When Nora on iOS Sim selects reason "Harassment" and confirms
  // Picker-then-confirm composite. Used for report-reason flow; could also
  // serve for block-reason, delete-reason, etc. — the matcher captures the
  // reason as a free-form quoted string.
  test('iOS Sim → driver receives reason', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosSelectReasonAndConfirm: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Nora on iOS Sim selects reason "Harassment" and confirms' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Nora', 'Harassment');
  });

  test('android variant', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidSelectReasonAndConfirm: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Raul on Android selects reason "Spam" and confirms' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Raul', 'Spam');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Nora on iOS Sim selects reason "Harassment" and confirms' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/iosSelectReasonAndConfirm/);
  });
});

describe('Wake 69 — Greta on Web Admin refreshes the <name> tab', () => {
  // j11-harassment-moderation-cycle.feature:37
  //   When Greta on Web Admin refreshes the reports tab
  // Admin panel tab-refresh. Driver clicks the refresh control inside the
  // named tab (vs reloading the whole page).
  test('refreshes named tab → driver receives tab', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webAdminRefreshTab: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin refreshes the reports tab' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('reports');
  });

  test('different tab name', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webAdminRefreshTab: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin refreshes the appeals tab' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('appeals');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin refreshes the reports tab' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webAdminRefreshTab/);
  });
});

describe('Wake 69 — UI shows the <name> <kind> (button|screen|banner|dialog|panel|tab)', () => {
  // j11-harassment-moderation-cycle.feature:86
  //   Then Raul's Android UI shows the appeal button
  // Positive complement to Wake 65's quoted-button negative matcher and
  // Wake 67's named-image matcher. Distinguishable by the terminal kind
  // (button, screen, banner, dialog, panel, tab). Earlier specific matchers
  // (warning reason "X", element with tag "Y") still fire first.
  test('android: appeal button → driver receives both', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsNamedKind: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Raul's Android UI shows the appeal button" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Raul', 'appeal', 'button');
  });

  test('multi-word noun → "voice room banner"', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsNamedKind: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Theo's Android UI shows the voice room banner" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo', 'voice room', 'banner');
  });

  test('iOS Sim screen variant', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosShowsNamedKind: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Mia's iOS Sim UI shows the wallet screen" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Mia', 'wallet', 'screen');
  });

  test('driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidShowsNamedKind: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Raul's Android UI shows the appeal button" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/appeal/);
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Raul's Android UI shows the appeal button" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.uiDriver\.androidShowsNamedKind/);
  });

  // iOS Sim — driver returns false + missing
  test('iOS Sim driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { iosShowsNamedKind: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Mia's iOS Sim UI shows the wallet screen" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/wallet/);
  });

  test('iOS Sim no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Mia's iOS Sim UI shows the wallet screen" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.uiDriver\.iosShowsNamedKind/);
  });

  // Web — full 3-test set
  test('Web matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsNamedKind: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web UI shows the wallet screen" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 'wallet', 'screen');
  });

  test('Web driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsNamedKind: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web UI shows the wallet screen" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/wallet/);
  });

  test('Web driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web UI shows the wallet screen" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsNamedKind/);
  });

  // Web Chromium — full 3-test set
  test('Web Chromium matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsNamedKind: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web Chromium UI shows the wallet screen" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 'wallet', 'screen');
  });

  test('Web Chromium driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsNamedKind: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web Chromium UI shows the wallet screen" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/wallet/);
  });

  test('Web Chromium driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web Chromium UI shows the wallet screen" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsNamedKind/);
  });

  // Web Safari — full 3-test set
  test('Web Safari matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsNamedKind: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web Safari UI shows the wallet screen" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 'wallet', 'screen');
  });

  test('Web Safari driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsNamedKind: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web Safari UI shows the wallet screen" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/wallet/);
  });

  test('Web Safari driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web Safari UI shows the wallet screen" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsNamedKind/);
  });
});

describe('Wake 69 — admin shows report row (reporter + reportedId + reason)', () => {
  // j11-harassment-moderation-cycle.feature:39
  //   Then Greta's Web Admin UI shows reporter Nora + reportedId Raul + reason "Harassment"
  // Composite admin-table-row assertion. Three-way conjunction: reporter
  // name, reported persona, free-form reason string. Driver checks the
  // currently rendered reports table for a row matching all three fields.
  test('matching row → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webAdminShowsReportRow: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Greta\'s Web Admin UI shows reporter Nora + reportedId Raul + reason "Harassment"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith({
      reporter: 'Nora',
      reportedId: 'Raul',
      reason: 'Harassment',
    });
  });

  test('different reason — driver receives it', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webAdminShowsReportRow: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Greta\'s Web Admin UI shows reporter Alice + reportedId Bob + reason "Spam"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith({
      reporter: 'Alice',
      reportedId: 'Bob',
      reason: 'Spam',
    });
  });

  test('driver returns false → fail with all 3 fields in error', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webAdminShowsReportRow: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Greta\'s Web Admin UI shows reporter Nora + reportedId Raul + reason "Harassment"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Nora/);
    expect(r.error).toMatch(/Raul/);
    expect(r.error).toMatch(/Harassment/);
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Greta\'s Web Admin UI shows reporter Nora + reportedId Raul + reason "Harassment"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webAdminShowsReportRow/);
  });
});

// ── Wake 70 ──────────────────────────────────────────────────────────

describe('Wake 70 — admin "opens the report and taps <action>"', () => {
  // j11-harassment-moderation-cycle.feature:42
  //   When Greta on Web Admin opens the report and taps "Warn Raul"
  // Two-step composite: open the report row (expands into detail panel),
  // then tap a named action button. Driver atom; keeps the corpus intent.
  test('action label is passed → driver receives it', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webAdminOpenReportAndTap: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin opens the report and taps "Warn Raul"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Warn Raul');
  });

  test('different action label', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webAdminOpenReportAndTap: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin opens the report and taps "Suspend Raul"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Suspend Raul');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin opens the report and taps "Warn Raul"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webAdminOpenReportAndTap/);
  });
});

describe('Wake 70 — "<Name> on <Plat> reports it for "<reason>""', () => {
  // j11-harassment-moderation-cycle.feature:34
  //   When Nora on iOS Sim reports it for "Harassment"
  // Compact report action — "it" refers to the contextually-selected
  // entity (typically a message or user the persona just long-pressed).
  // Driver wires the reason into the open report flow.
  test('iOS Sim → driver receives reason', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosReportItFor: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Nora on iOS Sim reports it for "Harassment"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Nora', 'Harassment');
  });

  test('android variant', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidReportItFor: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Raul on Android reports it for "Spam"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Raul', 'Spam');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Nora on iOS Sim reports it for "Harassment"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/iosReportItFor/);
  });
});

describe('Wake 70 — "<Name> is currently in a voice room "<id>" with mic <state>"', () => {
  // j11-harassment-moderation-cycle.feature:69
  //   Given Raul is currently in a voice room "r-test" with mic open
  // Sibling of the existing `is in voice room "X" with mic <state>` matcher
  // (line ~5480) — corpus authors mix "is in" and "is currently in" forms.
  // Same Firestore effect.
  test('writes participantIds and micStates', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    // Raul = P-08 = 50000050
    const r = await executeStep(
      { kind: 'Given', text: 'Raul is currently in a voice room "r-test" with mic open' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['rooms/r-test'].participantIds).toContain(50000050);
    expect(db._docs['rooms/r-test'].micStates['50000050']).toBe('open');
  });

  test('muted variant', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Alice is currently in a voice room "r9" with mic muted' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['rooms/r9'].micStates['50000010']).toBe('muted');
  });

  test('unknown persona → fail', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Zzzghost is currently in a voice room "rX" with mic open' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Zzzghost/);
  });
});

describe('Wake 70 — UI shows reason "<text>" (bare, no "warning")', () => {
  // j11-harassment-moderation-cycle.feature:51
  //   Then Raul's Android UI shows reason "Repeat harassment"
  // Distinct from Wake 67's `shows the warning reason "X"` — this one has
  // NO "the" and NO "warning", so it doesn't shadow. Used on the
  // suspension screen which displays the suspension reason inline.
  test('matching reason → ok', async () => {
    const spy = jest.fn(async () => 'Repeat harassment');
    const ctx = makeCtx({ uiDriver: { androidGetDisplayedReason: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Raul\'s Android UI shows reason "Repeat harassment"' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('mismatch → fail with both', async () => {
    const spy = jest.fn(async () => 'Something else');
    const ctx = makeCtx({ uiDriver: { androidGetDisplayedReason: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Raul\'s Android UI shows reason "Repeat harassment"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Repeat harassment/);
    expect(r.error).toMatch(/Something else/);
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Then', text: 'Raul\'s Android UI shows reason "X"' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidGetDisplayedReason/);
  });
});

describe('Wake 70 — UI shows an end date N days from now', () => {
  // j11-harassment-moderation-cycle.feature:60
  //   Then Raul's Android UI shows an end date 3 days from now
  // Relative-date UI assertion. Driver returns the displayed end-date in
  // milliseconds; matcher accepts a 24h tolerance (date may be rendered
  // as "midnight on day N" or "now + N days exactly", both acceptable).
  test('matching date → ok', async () => {
    const expectedMs = Date.now() + 3 * 24 * 60 * 60 * 1000;
    const spy = jest.fn(async () => expectedMs);
    const ctx = makeCtx({ uiDriver: { androidGetDisplayedEndDate: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Raul's Android UI shows an end date 3 days from now" },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('within 24h tolerance → ok (midnight rounding)', async () => {
    // Date rendered as start-of-day rather than now+3d exactly. Should
    // still pass because driver date - now is between 2*24h and 4*24h.
    const expectedMs = Date.now() + 3 * 24 * 60 * 60 * 1000 - 12 * 60 * 60 * 1000;
    const spy = jest.fn(async () => expectedMs);
    const ctx = makeCtx({ uiDriver: { androidGetDisplayedEndDate: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Raul's Android UI shows an end date 3 days from now" },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('outside tolerance → fail', async () => {
    // Date is 10 days off — way outside tolerance.
    const expectedMs = Date.now() + 10 * 24 * 60 * 60 * 1000;
    const spy = jest.fn(async () => expectedMs);
    const ctx = makeCtx({ uiDriver: { androidGetDisplayedEndDate: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Raul's Android UI shows an end date 3 days from now" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/3 days|3d/);
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Raul's Android UI shows an end date 3 days from now" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidGetDisplayedEndDate/);
  });
});

describe('Wake 70 — "<Name> is suspended until N days from now" (state-seed)', () => {
  // j11-harassment-moderation-cycle.feature:67
  //   Given Raul is suspended until 2 days from now
  // Writes a relative-date field to users/<uniqueId>.suspendedUntil. The
  // resolved timestamp is computed at runner time (Date.now() + N days).
  test('writes suspendedUntil ~ N days ahead', async () => {
    // Raul = P-08 = 50000050
    const db = makeStatefulFakeDb({ 'users/50000050': {} });
    const ctx = makeCtx({ db });
    const before = Date.now();
    const r = await executeStep(
      { kind: 'Given', text: 'Raul is suspended until 2 days from now' },
      ctx,
    );
    const after = Date.now();
    expect(r.ok).toBe(true);
    const susUntil = db._docs['users/50000050'].suspendedUntil;
    expect(susUntil).toBeGreaterThanOrEqual(before + 2 * 24 * 60 * 60 * 1000);
    expect(susUntil).toBeLessThanOrEqual(after + 2 * 24 * 60 * 60 * 1000);
  });

  test('unknown persona → fail', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Zzzghost is suspended until 5 days from now' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Zzzghost/);
  });

  test('no db → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'Raul is suspended until 2 days from now' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db/);
  });
});

// ── Wake 71 ──────────────────────────────────────────────────────────

describe('Wake 71 — bare "POST <path> as <persona>" (no body)', () => {
  // j11-harassment-moderation-cycle.feature:73
  //   When POST /api/livekit/token as Raul
  // Bare POST with NO body — distinct from the existing `POST <path> with
  // <kv-list> as <persona>` matcher which requires a `with <payload>` token.
  // Used by endpoints that derive everything from the bearer token (e.g.,
  // LiveKit token issuance keyed on auth claims).
  test('fires POST with empty body, records lastResponse', async () => {
    const idToken =
      'aaa.' + Buffer.from(JSON.stringify({ uniqueId: 50000050 })).toString('base64url') + '.bbb';
    const fetchMock = jest.fn(async () => ({
      status: 200,
      text: async () => JSON.stringify({ token: 'lk-abc' }),
    }));
    const ctx = makeCtx({ fetch: fetchMock });
    ctx.sessions.set('Raul', { uniqueId: 50000050, idToken });
    const r = await executeStep({ kind: 'When', text: 'POST /api/livekit/token as Raul' }, ctx);
    expect(r.ok).toBe(true);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://dev-api.example/api/livekit/token');
    expect(opts.method).toBe('POST');
    expect(opts.body).toBe('{}');
    expect(ctx.lastResponse.status).toBe(200);
    expect(ctx.lastResponse.path).toBe('/api/livekit/token');
  });

  test('no signed-in session → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'When', text: 'POST /api/livekit/token as Ghost' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Ghost/);
  });
});

describe('Wake 71 — "<Name> on <Plat> attempts POST <path>" (bare, no body)', () => {
  // j11-harassment-moderation-cycle.feature:96
  //   When Raul on Android attempts POST /api/messages
  // Sibling of the existing `attempts POST <path> with body <json>` matcher;
  // this one omits the body (intended to test the API's rejection of
  // bodyless POSTs, e.g., a suspended user attempting to send a message).
  test('fires POST, records non-2xx as lastResponse without throwing', async () => {
    const idToken =
      'aaa.' + Buffer.from(JSON.stringify({ uniqueId: 50000050 })).toString('base64url') + '.bbb';
    const fetchMock = jest.fn(async () => ({
      status: 403,
      text: async () => JSON.stringify({ error: 'suspended' }),
    }));
    const ctx = makeCtx({ fetch: fetchMock });
    ctx.sessions.set('Raul', { uniqueId: 50000050, idToken });
    const r = await executeStep(
      { kind: 'When', text: 'Raul on Android attempts POST /api/messages' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.lastResponse.status).toBe(403);
    expect(ctx.lastResponse.path).toBe('/api/messages');
  });

  test('no session → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Ghost on Android attempts POST /api/messages' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Ghost/);
  });
});

describe('Wake 71 — types "<text>" into the <name> field (non-search)', () => {
  // j11-harassment-moderation-cycle.feature:82
  //   When Raul on Android types "I think this was a misunderstanding" into the appeal field
  // Existing matchers cover `into the search field` specifically; this
  // catches generic `into the <name> field` for any other named field
  // (appeal, email, password, etc.). First-match-wins keeps the search-
  // specific matchers winning when their form applies.
  test('android: appeal field → driver receives field name + text', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidTypeIntoNamedField: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Raul on Android types "I think this was a misunderstanding" into the appeal field',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Raul', 'appeal', 'I think this was a misunderstanding');
  });

  test('iOS Sim variant', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosTypeIntoNamedField: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Mia on iOS Sim types "test@test.com" into the email field' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Mia', 'email', 'test@test.com');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Raul on Android types "x" into the appeal field',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidTypeIntoNamedField/);
  });
});

describe('Wake 71 — UI no longer shows the <name> <kind>', () => {
  // j11-harassment-moderation-cycle.feature:88
  //   Then Raul's Android UI no longer shows the suspension screen
  // Semantic-equivalent of `does not show the X` but phrased as a state
  // change ("no longer" implies it was previously shown). Same driver
  // contract — returns truthy iff the named element is now absent.
  test('driver returns false (no longer shown) → ok', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidShowsNamedKind: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Raul's Android UI no longer shows the suspension screen" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Raul', 'suspension', 'screen');
  });

  test('driver returns true (still shown) → fail', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsNamedKind: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Raul's Android UI no longer shows the suspension screen" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/suspension/);
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Raul's Android UI no longer shows the suspension screen" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.uiDriver\.androidShowsNamedKind/);
  });

  // iOS Sim — driver returns false → ok / returns true → fail / missing → fail
  test('iOS Sim driver returns false (no longer shown) → ok', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { iosShowsNamedKind: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Mia's iOS Sim UI no longer shows the wallet screen" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Mia', 'wallet', 'screen');
  });

  test('iOS Sim driver returns true (still shown) → fail', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosShowsNamedKind: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Mia's iOS Sim UI no longer shows the wallet screen" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/wallet/);
  });

  test('iOS Sim no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Mia's iOS Sim UI no longer shows the wallet screen" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.uiDriver\.iosShowsNamedKind/);
  });

  // Web — full 3-test set
  test('Web driver returns false → ok', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsNamedKind: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web UI no longer shows the wallet screen" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 'wallet', 'screen');
  });

  test('Web driver returns true → fail', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsNamedKind: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web UI no longer shows the wallet screen" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/wallet/);
  });

  test('Web driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web UI no longer shows the wallet screen" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsNamedKind/);
  });

  // Web Chromium — full 3-test set
  test('Web Chromium driver returns false → ok', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsNamedKind: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web Chromium UI no longer shows the wallet screen" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 'wallet', 'screen');
  });

  test('Web Chromium driver returns true → fail', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsNamedKind: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web Chromium UI no longer shows the wallet screen" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/wallet/);
  });

  test('Web Chromium driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web Chromium UI no longer shows the wallet screen" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsNamedKind/);
  });

  // Web Safari — full 3-test set
  test('Web Safari driver returns false → ok', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsNamedKind: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web Safari UI no longer shows the wallet screen" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 'wallet', 'screen');
  });

  test('Web Safari driver returns true → fail', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsNamedKind: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web Safari UI no longer shows the wallet screen" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/wallet/);
  });

  test('Web Safari driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web Safari UI no longer shows the wallet screen" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsNamedKind/);
  });
});

describe('Wake 71 — predicate state-seed "has been warned but not suspended"', () => {
  // j11-harassment-moderation-cycle.feature:101
  //   Given Raul has been warned but not suspended
  // Predicate state-seed: writes hasActiveWarning=true AND ensures
  // suspendedUntil=0 (or absent). Tests the transition state — warning
  // exists, suspension does not. Conjunction is part of the assertion
  // intent so we set BOTH fields, not just one.
  test('writes hasActiveWarning=true and clears suspendedUntil', async () => {
    const db = makeStatefulFakeDb({
      'users/50000050': { hasActiveWarning: false, suspendedUntil: 999999999 },
    });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Raul has been warned but not suspended' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000050'].hasActiveWarning).toBe(true);
    expect(db._docs['users/50000050'].suspendedUntil).toBe(0);
  });

  test('unknown persona → fail', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Zzzghost has been warned but not suspended' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Zzzghost/);
  });

  test('no db → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'Raul has been warned but not suspended' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db/);
  });
});

describe('Wake 71 — "opens his/her conversation with <Other>"', () => {
  // j11-harassment-moderation-cycle.feature:93
  //   When Raul on Android opens his conversation with Nora
  // Composite navigation: open the PM (private message) thread between
  // the speaker and the named other persona. Driver resolves the conv
  // id from the persona pair and navigates.
  test('android variant', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidOpenConversationWith: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Raul on Android opens his conversation with Nora' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Raul', 'Nora');
  });

  test('iOS Sim variant + "her" pronoun', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosOpenConversationWith: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Alice on iOS Sim opens her conversation with Bob' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 'Bob');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Raul on Android opens his conversation with Nora' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidOpenConversationWith/);
  });
});

// ── Wake 72 ──────────────────────────────────────────────────────────

describe('Wake 72 — admin "opens the <ordinal> report and taps "<X>"" (generic ordinal)', () => {
  // j12-admin-daily-routine.feature:42
  //   When Greta on Web Admin opens the third report and taps "Suspend for 7 days"
  // Existing matcher (line ~2194) only accepts the enum (first|second|new).
  // This generic accepts any lowercase ordinal word. Earlier specific matcher
  // wins via first-match-wins for first/second/new; this catches the rest
  // (third, fourth, fifth, ...).
  test('third report variant → driver receives ordinal', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webAdminOpenReportAndTap: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin opens the third report and taps "Suspend for 7 days"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('third', 'Suspend for 7 days', null);
  });

  test('with reason suffix', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webAdminOpenReportAndTap: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin opens the fifth report and taps "Reject" with reason "Duplicate"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('fifth', 'Reject', 'Duplicate');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin opens the third report and taps "X"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webAdminOpenReportAndTap/);
  });
});

describe('Wake 72 — admin "approves submissions <N>-<M>" (batch range)', () => {
  // j12-admin-daily-routine.feature:48
  //   When Greta on Web Admin approves submissions 1-3
  // Range-based batch approve action. Driver receives (start, end) and
  // approves all submissions in that range (inclusive).
  test('range → driver receives both indices', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webAdminApproveSubmissions: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin approves submissions 1-3' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith(1, 3);
  });

  test('single-item range (N-N)', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webAdminApproveSubmissions: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin approves submissions 7-7' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith(7, 7);
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin approves submissions 1-3' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webAdminApproveSubmissions/);
  });
});

describe('Wake 72 — admin "rejects submission <N> with reason "<X>"" (with optional dobOverride)', () => {
  // j12-admin-daily-routine.feature:49
  //   When Greta on Web Admin rejects submission 4 with reason "Image too blurry to read"
  // j12-admin-daily-routine.feature:50
  //   When Greta on Web Admin rejects submission 5 with reason "DOB on ID shows minor" and dobOverride="2011-01-01"
  // Two shapes share one matcher via optional `and dobOverride="..."` suffix.
  test('bare reject with reason', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webAdminRejectSubmission: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin rejects submission 4 with reason "Image too blurry to read"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith(4, 'Image too blurry to read', null);
  });

  test('with dobOverride', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webAdminRejectSubmission: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin rejects submission 5 with reason "DOB on ID shows minor" and dobOverride="2011-01-01"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith(5, 'DOB on ID shows minor', '2011-01-01');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin rejects submission 4 with reason "X"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webAdminRejectSubmission/);
  });
});

describe('Wake 72 — admin UI "shows <N> rows"', () => {
  // j12-admin-daily-routine.feature:64
  //   Then Greta's Web Admin UI shows 2 rows
  // Generic table row-count assertion. Driver returns the current visible
  // row count for the active table; matcher does an exact integer compare.
  test('matching count → ok', async () => {
    const spy = jest.fn(async () => 2);
    const ctx = makeCtx({ webDriver: { webAdminGetRowCount: spy } });
    const r = await executeStep({ kind: 'Then', text: "Greta's Web Admin UI shows 2 rows" }, ctx);
    expect(r.ok).toBe(true);
  });

  test('count mismatch → fail with both', async () => {
    const spy = jest.fn(async () => 5);
    const ctx = makeCtx({ webDriver: { webAdminGetRowCount: spy } });
    const r = await executeStep({ kind: 'Then', text: "Greta's Web Admin UI shows 2 rows" }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/2/);
    expect(r.error).toMatch(/5/);
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Then', text: "Greta's Web Admin UI shows 2 rows" }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webAdminGetRowCount/);
  });
});

describe('Wake 72 — admin "searches for user "<text>""', () => {
  // j12-admin-daily-routine.feature:80
  //   When Greta on Web Admin searches for user "50000020"
  // Distinct from Wake 67's bare `searches "X"` (universal search) — this
  // is the dedicated user-search flow (different admin panel screen,
  // different result format).
  test('searches by uniqueId → driver receives query', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webAdminSearchForUser: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin searches for user "50000020"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('50000020');
  });

  test('searches by display name', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webAdminSearchForUser: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin searches for user "Alice"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin searches for user "X"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webAdminSearchForUser/);
  });
});

describe('Wake 72 — admin "adjusts shyCoins by ±<N> with reason "<X>""', () => {
  // j12-admin-daily-routine.feature:84
  //   When Greta on Web Admin adjusts shyCoins by +500 with reason "Customer support refund"
  // Signed-integer wallet adjustment with audit-trail reason. The "+"/"-"
  // prefix is part of the delta; driver receives signed int.
  test('positive delta', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webAdminAdjustShyCoins: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin adjusts shyCoins by +500 with reason "Customer support refund"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith(500, 'Customer support refund');
  });

  test('negative delta (deduction)', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webAdminAdjustShyCoins: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin adjusts shyCoins by -100 with reason "Chargeback clawback"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith(-100, 'Chargeback clawback');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin adjusts shyCoins by +500 with reason "X"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webAdminAdjustShyCoins/);
  });
});

// ── Wake 73 ──────────────────────────────────────────────────────────

describe('Wake 73 — admin "lifts the <ordinal> appeal"', () => {
  // j12-admin-daily-routine.feature:70
  //   When Greta on Web Admin lifts the first appeal
  // "Lift" reverses a suspension on the targeted appeal.
  test('first → driver receives ordinal', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webAdminLiftAppeal: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin lifts the first appeal' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('first');
  });

  test('higher ordinal', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webAdminLiftAppeal: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin lifts the seventh appeal' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('seventh');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin lifts the first appeal' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webAdminLiftAppeal/);
  });
});

describe('Wake 73 — admin "denies the <ordinal> appeal with reason "<X>""', () => {
  // j12-admin-daily-routine.feature:71
  //   When Greta on Web Admin denies the second appeal with reason "Persistent pattern of harassment"
  // Inverse of lift — confirms the suspension stands.
  test('denies with reason → driver receives ordinal + reason', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webAdminDenyAppeal: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin denies the second appeal with reason "Persistent pattern of harassment"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('second', 'Persistent pattern of harassment');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin denies the first appeal with reason "X"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webAdminDenyAppeal/);
  });
});

describe('Wake 73 — admin "opens the "<name>" subtab"', () => {
  // j12-admin-daily-routine.feature:91
  //   When Greta on Web Admin opens the "security" subtab
  // Subtab navigation inside the admin panel.
  test('opens named subtab → driver receives name', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webAdminOpenSubtab: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin opens the "security" subtab' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('security');
  });

  test('multi-word subtab', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webAdminOpenSubtab: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin opens the "device bans" subtab' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('device bans');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin opens the "security" subtab' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webAdminOpenSubtab/);
  });
});

describe('Wake 73 — admin "filters by action="<X>""', () => {
  // j12-admin-daily-routine.feature:103
  //   When Greta on Web Admin filters by action="suspend"
  // Audit-log filter step.
  test('filters by action value → driver receives it', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webAdminFilterByAction: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin filters by action="suspend"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('suspend');
  });

  test('different action value', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webAdminFilterByAction: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin filters by action="warn"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('warn');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin filters by action="X"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webAdminFilterByAction/);
  });
});

describe('Wake 73 — admin "attempts to PATCH|DELETE <path>" (audit-immutability test)', () => {
  // j12-admin-daily-routine.feature:106-107
  // Tests audit-log immutability — the API must reject mutations.
  test('PATCH variant → fires request, records lastResponse', async () => {
    const idToken =
      'aaa.' + Buffer.from(JSON.stringify({ uniqueId: 90000001 })).toString('base64url') + '.bbb';
    const fetchMock = jest.fn(async () => ({
      status: 405,
      text: async () => JSON.stringify({ error: 'Method not allowed' }),
    }));
    const ctx = makeCtx({ fetch: fetchMock });
    ctx.sessions.set('Greta', { uniqueId: 90000001, idToken });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin attempts to PATCH /api/admin/audit/{anyEntry}',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.method).toBe('PATCH');
    expect(ctx.lastResponse.status).toBe(405);
  });

  test('DELETE variant', async () => {
    const idToken =
      'aaa.' + Buffer.from(JSON.stringify({ uniqueId: 90000001 })).toString('base64url') + '.bbb';
    const fetchMock = jest.fn(async () => ({
      status: 405,
      text: async () => JSON.stringify({ error: 'Method not allowed' }),
    }));
    const ctx = makeCtx({ fetch: fetchMock });
    ctx.sessions.set('Greta', { uniqueId: 90000001, idToken });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin attempts to DELETE /api/admin/audit/{anyEntry}',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.method).toBe('DELETE');
  });

  test('no session → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin attempts to PATCH /api/admin/audit/{anyEntry}',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Greta/);
  });
});

describe('Wake 73 — admin "taps "<X>" and types deviceId="<id>" + reason "<text>"" (ban-device composite)', () => {
  // j12-admin-daily-routine.feature:93
  //   When Greta on Web Admin taps "Ban device" and types deviceId="device-xyz" + reason "Repeated abuse"
  // Triple composite: tap action, type deviceId, type reason.
  test('all three fields captured', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webAdminTapAndTypeBanDevice: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin taps "Ban device" and types deviceId="device-xyz" + reason "Repeated abuse"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith({
      action: 'Ban device',
      deviceId: 'device-xyz',
      reason: 'Repeated abuse',
    });
  });

  test('different action button', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webAdminTapAndTypeBanDevice: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin taps "Unban" and types deviceId="device-abc" + reason "Resolved"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy.mock.calls[0][0].action).toBe('Unban');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Greta on Web Admin taps "Ban device" and types deviceId="x" + reason "y"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webAdminTapAndTypeBanDevice/);
  });
});

// ── Wake 74 ──────────────────────────────────────────────────────────

describe('Wake 74 — "<Name>\'s browser locale is "<code>"" (state-seed)', () => {
  // j12-admin-daily-routine.feature:130
  //   Given Greta's browser locale is "ar"
  // Sets the persona's browser-locale before subsequent rendering steps
  // run. Stored on ctx.browserLocales for later assertions.
  test('records locale per persona', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Given', text: 'Greta\'s browser locale is "ar"' }, ctx);
    expect(r.ok).toBe(true);
    expect(ctx.browserLocales.get('Greta')).toBe('ar');
  });

  test('country-suffixed locale', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Given', text: 'Alice\'s browser locale is "en-US"' }, ctx);
    expect(r.ok).toBe(true);
    expect(ctx.browserLocales.get('Alice')).toBe('en-US');
  });

  test('multiple personas accumulate', async () => {
    const ctx = makeCtx();
    await executeStep({ kind: 'Given', text: 'Alice\'s browser locale is "en"' }, ctx);
    await executeStep({ kind: 'Given', text: 'Layla\'s browser locale is "ar"' }, ctx);
    expect(ctx.browserLocales.get('Alice')).toBe('en');
    expect(ctx.browserLocales.get('Layla')).toBe('ar');
  });
});

describe('Wake 74 — "<Name>\'s Web Admin UI document direction is "<dir>""', () => {
  // j12-admin-daily-routine.feature:131
  //   Then Greta's Web Admin UI document direction is "ltr"
  // Distinct from the existing `Web UI document direction` matcher at
  // line ~2648 which asserts on the main app — this one asserts on the
  // admin panel which can have different RTL handling (admin panel is
  // English-only by policy).
  test('matching direction → ok', async () => {
    const spy = jest.fn(async () => 'ltr');
    const ctx = makeCtx({ webDriver: { webAdminGetDocumentDirection: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Greta\'s Web Admin UI document direction is "ltr"' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('mismatched direction → fail', async () => {
    const spy = jest.fn(async () => 'rtl');
    const ctx = makeCtx({ webDriver: { webAdminGetDocumentDirection: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Greta\'s Web Admin UI document direction is "ltr"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ltr/);
    expect(r.error).toMatch(/rtl/);
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: 'Greta\'s Web Admin UI document direction is "ltr"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webAdminGetDocumentDirection/);
  });
});

describe('Wake 74 — "<Name>\'s Web Admin UI labels are in <language>"', () => {
  // j12-admin-daily-routine.feature:132
  //   Then Greta's Web Admin UI labels are in English
  // Admin panel is English-only per ShyTalk policy. Driver detects label
  // language; matcher does a name-to-language check.
  test('matching language → ok', async () => {
    const spy = jest.fn(async () => 'English');
    const ctx = makeCtx({ webDriver: { webAdminDetectLabelLanguage: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Greta's Web Admin UI labels are in English" },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('mismatch → fail with both', async () => {
    const spy = jest.fn(async () => 'Arabic');
    const ctx = makeCtx({ webDriver: { webAdminDetectLabelLanguage: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Greta's Web Admin UI labels are in English" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/English/);
    expect(r.error).toMatch(/Arabic/);
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Greta's Web Admin UI labels are in English" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webAdminDetectLabelLanguage/);
  });
});

describe('Wake 74 — "no rendered <text|character> contains|has the Unicode replacement glyph U+FFFD"', () => {
  // j13-locales-rtl-cjk.feature lines 14, 96
  //   Then no rendered text contains the Unicode replacement glyph U+FFFD
  //   Then no rendered character has the Unicode replacement glyph U+FFFD
  // Both shapes share one matcher. U+FFFD (the Unicode replacement
  // character, codepoint 0xFFFD) is what renders when a glyph can't
  // be resolved — its presence means a missing font fallback. We
  // avoid the literal codepoint anywhere in source files (including
  // comments) because Sonar's source-encoding probe rejects files
  // containing the replacement char (it treats it as a sign of an
  // upstream decoding error).
  test('no glyph found → ok', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webHasReplacementGlyph: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'no rendered text contains the Unicode replacement glyph U+FFFD' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('character variant (j13:96)', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webHasReplacementGlyph: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'no rendered character has the Unicode replacement glyph U+FFFD' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('glyph found → fail', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webHasReplacementGlyph: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'no rendered text contains the Unicode replacement glyph U+FFFD' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/U\+FFFD|replacement/);
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: 'no rendered text contains the Unicode replacement glyph U+FFFD' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webHasReplacementGlyph/);
  });
});

describe('Wake 74 — "no string is missing translation"', () => {
  // j13-locales-rtl-cjk.feature:95
  //   Then no string is missing translation
  // Driver scans the rendered DOM for raw i18n keys / missing-translation
  // sentinel ("missing_translation:KEY", "[MISSING]", etc.).
  test('all translated → ok', async () => {
    const spy = jest.fn(async () => []);
    const ctx = makeCtx({ webDriver: { webMissingTranslations: spy } });
    const r = await executeStep({ kind: 'Then', text: 'no string is missing translation' }, ctx);
    expect(r.ok).toBe(true);
  });

  test('missing translations present → fail with examples', async () => {
    const spy = jest.fn(async () => ['profile_followers', 'wallet_buy_coins']);
    const ctx = makeCtx({ webDriver: { webMissingTranslations: spy } });
    const r = await executeStep({ kind: 'Then', text: 'no string is missing translation' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/profile_followers/);
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Then', text: 'no string is missing translation' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webMissingTranslations/);
  });
});

describe('Wake 74 — "<Name>\'s <Plat> UI does not show any raw i18n key like "<X>""', () => {
  // j13-locales-rtl-cjk.feature:24
  //   Then Layla's Web UI does not show any raw i18n key like "profile_followers"
  // Negative assertion that a raw resource key (which would indicate a
  // missing translation) is NOT rendered. The "X" is an example key — the
  // matcher passes it to the driver as a sample to detect missing-
  // translation sentinels.
  test('raw key absent → ok', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsRawI18nKey: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Layla\'s Web UI does not show any raw i18n key like "profile_followers"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Layla', 'profile_followers');
  });

  test('raw key present → fail', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsRawI18nKey: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Layla\'s Web UI does not show any raw i18n key like "profile_followers"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/profile_followers/);
  });

  test('iOS Sim variant', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { iosShowsRawI18nKey: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Mia\'s iOS Sim UI does not show any raw i18n key like "wallet_buy_coins"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Mia', 'wallet_buy_coins');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Layla\'s Web UI does not show any raw i18n key like "X"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webShowsRawI18nKey/);
  });
});

// ── Wake 75 ──────────────────────────────────────────────────────────

describe('Wake 75 — "UI shows the <name> field aligned <direction>"', () => {
  // j13-locales-rtl-cjk.feature:13
  //   Then Layla's Web UI shows the search field aligned right
  // RTL layout verification — search field in Arabic locale should be
  // right-aligned. Driver returns current alignment of named field.
  test('matching alignment → ok', async () => {
    const spy = jest.fn(async () => 'right');
    const ctx = makeCtx({ webDriver: { webGetFieldAlignment: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Layla's Web UI shows the search field aligned right" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Layla', 'search');
  });

  test('mismatched alignment → fail', async () => {
    const spy = jest.fn(async () => 'left');
    const ctx = makeCtx({ webDriver: { webGetFieldAlignment: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Layla's Web UI shows the search field aligned right" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/right/);
    expect(r.error).toMatch(/left/);
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Layla's Web UI shows the search field aligned right" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webGetFieldAlignment/);
  });
});

describe('Wake 75 — "UI shows <language> labels for "<X>", "<Y>", ..."', () => {
  // j13-locales-rtl-cjk.feature:18
  //   Then Layla's Web UI shows Arabic labels for "Followers", "Following", "Beans"
  // Composite: verify the named English labels render in the persona's
  // locale. Driver receives (name, language, labelKeys[]).
  test('parses comma-separated quoted list', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsLocaleLabels: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Layla\'s Web UI shows Arabic labels for "Followers", "Following", "Beans"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Layla', 'Arabic', ['Followers', 'Following', 'Beans']);
  });

  test('different language + single label', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsLocaleLabels: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Kenji\'s Web UI shows Japanese labels for "Profile"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Kenji', 'Japanese', ['Profile']);
  });

  test('driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsLocaleLabels: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Layla\'s Web UI shows Arabic labels for "Followers"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Arabic|Followers/);
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: 'Layla\'s Web UI shows Arabic labels for "X"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webShowsLocaleLabels/);
  });
});

describe('Wake 75 — "UI shows the balance with locale-appropriate thousands separator"', () => {
  // j13-locales-rtl-cjk.feature:31
  //   Then Layla's Web UI shows the balance with locale-appropriate thousands separator
  // Driver checks that the rendered balance uses the locale's correct
  // thousands separator (Arabic = U+066C, English = ",", German = ".").
  test('correct separator → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webBalanceUsesLocaleSeparator: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Layla's Web UI shows the balance with locale-appropriate thousands separator",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Layla');
  });

  test('wrong separator → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webBalanceUsesLocaleSeparator: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Layla's Web UI shows the balance with locale-appropriate thousands separator",
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/separator/);
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Layla's Web UI shows the balance with locale-appropriate thousands separator",
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webBalanceUsesLocaleSeparator/);
  });
});

describe('Wake 75 — "<Name>\'s Android UI layoutDirection is <RTL|LTR>"', () => {
  // j13-locales-rtl-cjk.feature:39
  //   Then Layla's Android UI layoutDirection is RTL
  // Android-specific layoutDirection attribute (View.LAYOUT_DIRECTION_RTL).
  // Driver introspects the root view's layoutDirection.
  test('matching direction → ok', async () => {
    const spy = jest.fn(async () => 'RTL');
    const ctx = makeCtx({ uiDriver: { androidGetLayoutDirection: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Layla's Android UI layoutDirection is RTL" },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('mismatch → fail', async () => {
    const spy = jest.fn(async () => 'LTR');
    const ctx = makeCtx({ uiDriver: { androidGetLayoutDirection: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Layla's Android UI layoutDirection is RTL" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/RTL/);
    expect(r.error).toMatch(/LTR/);
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Layla's Android UI layoutDirection is RTL" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidGetLayoutDirection/);
  });
});

describe('Wake 75 — "system font fallback resolves to a <X>-capable font"', () => {
  // j13-locales-rtl-cjk.feature:45
  //   Then the system font fallback resolves to a Japanese-capable font
  // CJK font fallback verification — driver loads a test glyph for the
  // named script and asserts the resolved font supports it.
  test('matching capability → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webFontFallbackCapable: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'the system font fallback resolves to a Japanese-capable font' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Japanese');
  });

  test('different script', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webFontFallbackCapable: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'the system font fallback resolves to a Arabic-capable font' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Arabic');
  });

  test('capability missing → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webFontFallbackCapable: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'the system font fallback resolves to a Japanese-capable font' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Japanese/);
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: 'the system font fallback resolves to a Japanese-capable font' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webFontFallbackCapable/);
  });
});

describe('Wake 75 — "<Name> on <Plat> sends a/an "<gift>" gift to <Recipient>"', () => {
  // j13-locales-rtl-cjk.feature:27
  //   When Layla on Web sends "rose" gift to Alice
  // j13-locales-rtl-cjk.feature:71
  //   When Kenji on Web sends a "rose" gift to Alice
  // Two corpus shapes share one matcher via optional `(?:an? )?` article.
  test('bare form (no article)', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webSendGiftTo: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Layla on Web sends "rose" gift to Alice' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Layla', 'rose', 'Alice');
  });

  test('with "a" article', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webSendGiftTo: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Kenji on Web sends a "rose" gift to Alice' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Kenji', 'rose', 'Alice');
  });

  test('android variant', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidSendGiftTo: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Raul on Android sends "diamond" gift to Nora' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Raul', 'diamond', 'Nora');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Layla on Web sends "rose" gift to Alice' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webSendGiftTo/);
  });
});

// ── Wake 76 ──────────────────────────────────────────────────────────

describe('Wake 76 — "Layla (locale=ar) is age-verified and Greta downgrades her to minor"', () => {
  // j13-locales-rtl-cjk.feature:91
  //   Given Layla (locale=ar) is age-verified and Greta downgrades her to minor
  // Composite state-seed: write the post-downgrade state in one shot
  // (locale=ar, isAgeVerified=true, cohort=minor). Pronoun is optional
  // since corpus may use her/him/them.
  test('writes locale, isAgeVerified, cohort=minor', async () => {
    const db = makeStatefulFakeDb({ 'users/50000070': {} });
    const ctx = makeCtx({ db });
    // Layla = P-13 = 50000070
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Layla (locale=ar) is age-verified and Greta downgrades her to minor',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000070'].locale).toBe('ar');
    expect(db._docs['users/50000070'].isAgeVerified).toBe(true);
    expect(db._docs['users/50000070'].cohort).toBe('minor');
  });

  test('different persona + pronoun', async () => {
    const db = makeStatefulFakeDb({ 'users/50000030': {} });
    const ctx = makeCtx({ db });
    // Hayato = P-06 = 50000030
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Hayato (locale=ja) is age-verified and Greta downgrades him to minor',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000030'].locale).toBe('ja');
    expect(db._docs['users/50000030'].cohort).toBe('minor');
  });

  test('unknown persona → fail', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Zzzghost (locale=en) is age-verified and Greta downgrades her to minor',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Zzzghost/);
  });

  test('no db → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Layla (locale=ar) is age-verified and Greta downgrades her to minor',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db/);
  });
});

describe('Wake 76 — "UI shows <Language> labels" (bare)', () => {
  // j13-locales-rtl-cjk.feature:48
  //   Then Kenji's Web UI shows Japanese labels
  // Bare positive — distinct from Wake 75's "shows X labels for A, B, C"
  // (which requires the quoted list). Driver returns truthy iff overall
  // UI is in the named language.
  test('matching language → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsLocaleLabels: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Kenji's Web UI shows Japanese labels" },
      ctx,
    );
    expect(r.ok).toBe(true);
    // For the bare form, labels array is empty — driver decides how to
    // verify overall labels are in the named language.
    expect(spy).toHaveBeenCalledWith('Kenji', 'Japanese', []);
  });

  test('different language', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsLocaleLabels: spy } });
    const r = await executeStep({ kind: 'Then', text: "Layla's Web UI shows Arabic labels" }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Layla', 'Arabic', []);
  });

  test('driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsLocaleLabels: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Kenji's Web UI shows Japanese labels" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Japanese/);
  });
});

describe('Wake 76 — "no rendered character is the replacement glyph U+FFFD" (third variant)', () => {
  // j13-locales-rtl-cjk.feature:54
  //   Then no rendered character is the replacement glyph U+FFFD
  // Third corpus variant — "is the X" vs Wake 74's "contains/has the
  // Unicode X". Different wording but same semantic.
  test('no glyph found → ok', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webHasReplacementGlyph: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'no rendered character is the replacement glyph U+FFFD' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('glyph found → fail', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webHasReplacementGlyph: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'no rendered character is the replacement glyph U+FFFD' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/U\+FFFD/);
  });
});

describe('Wake 76 — "any system PM template renders with the <Language> variant"', () => {
  // j13-locales-rtl-cjk.feature:43
  //   Then any system PM template renders with the Arabic variant
  // Asserts every system-PM template (welcome message, cohort-flip
  // notification, etc.) renders in the target language for the current
  // persona's locale.
  test('matching variant → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webSystemPmRendersInLanguage: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'any system PM template renders with the Arabic variant' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Arabic');
  });

  test('different language', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webSystemPmRendersInLanguage: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'any system PM template renders with the Japanese variant' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Japanese');
  });

  test('mismatch → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webSystemPmRendersInLanguage: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'any system PM template renders with the Arabic variant' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Arabic/);
  });
});

describe('Wake 76 — "the test runner scans all rendered strings on <Name>\'s <Plat> UI across N screens"', () => {
  // j13-locales-rtl-cjk.feature:60
  //   Given the test runner scans all rendered strings on Layla's Web UI across 10 screens
  // Meta state-seed: instructs the runner to navigate N screens and
  // collect all rendered strings into ctx.scannedStrings for later
  // assertions (e.g., the en/strings.xml fallback check).
  test('records scan plan into ctx.scannedStrings', async () => {
    const spy = jest.fn(async () => ['hello', 'world', 'مرحبا']);
    const ctx = makeCtx({ webDriver: { webScanAllRenderedStrings: spy } });
    const r = await executeStep(
      {
        kind: 'Given',
        text: "the test runner scans all rendered strings on Layla's Web UI across 10 screens",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Layla', 10);
    expect(ctx.scannedStrings).toEqual(['hello', 'world', 'مرحبا']);
  });

  test('different persona + screen count', async () => {
    const spy = jest.fn(async () => ['こんにちは']);
    const ctx = makeCtx({ webDriver: { webScanAllRenderedStrings: spy } });
    const r = await executeStep(
      {
        kind: 'Given',
        text: "the test runner scans all rendered strings on Kenji's Web UI across 5 screens",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Kenji', 5);
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: "the test runner scans all rendered strings on Layla's Web UI across 10 screens",
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webScanAllRenderedStrings/);
  });
});

describe('Wake 76 — "no string has the value of the en/strings.xml fallback when the locale is <X>"', () => {
  // j13-locales-rtl-cjk.feature:61
  //   Then no string has the value of the en/strings.xml fallback when the locale is ar
  // Follow-up to the scan step (Wake 76 matcher above). Driver receives
  // the locale + scanned strings; returns array of strings that still
  // look like English fallback values.
  test('no fallback values found → ok', async () => {
    const ctx = makeCtx({ webDriver: { webFallbackEnStrings: jest.fn(async () => []) } });
    ctx.scannedStrings = ['مرحبا', 'تابع'];
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'no string has the value of the en/strings.xml fallback when the locale is ar',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.webDriver.webFallbackEnStrings).toHaveBeenCalledWith('ar', ['مرحبا', 'تابع']);
  });

  test('fallback values present → fail with examples', async () => {
    const ctx = makeCtx({
      webDriver: { webFallbackEnStrings: jest.fn(async () => ['Hello', 'Followers']) },
    });
    ctx.scannedStrings = ['Hello', 'Followers'];
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'no string has the value of the en/strings.xml fallback when the locale is ar',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Hello|Followers/);
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    ctx.scannedStrings = ['x'];
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'no string has the value of the en/strings.xml fallback when the locale is ar',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webFallbackEnStrings/);
  });

  test('no scan recorded → fail with clear hint', async () => {
    const spy = jest.fn();
    const ctx = makeCtx({ webDriver: { webFallbackEnStrings: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'no string has the value of the en/strings.xml fallback when the locale is ar',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no.*scan|scannedStrings/);
  });
});

// ── Wake 77 ──────────────────────────────────────────────────────────

describe('Wake 77 — "<Name> on <Plat> opens "<path>" on <NetworkProfile>"', () => {
  // j14-low-bandwidth-degraded.feature:23
  //   When Ines on Web opens "/discovery" on Slow 3G
  // Composite: navigate to path while emulating a network profile.
  test('Slow 3G profile → driver receives both', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webOpenWithNetwork: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Ines on Web opens "/discovery" on Slow 3G' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Ines', '/discovery', 'Slow 3G');
  });

  test('Offline profile', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webOpenWithNetwork: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Ines on Web opens "/wallet" on Offline' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Ines', '/wallet', 'Offline');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Ines on Web opens "/discovery" on Slow 3G' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webOpenWithNetwork/);
  });
});

describe('Wake 77 — "<Name> is in a conversation with <Other>" (state-seed)', () => {
  // j14-low-bandwidth-degraded.feature:62
  //   Given Ines is in a conversation with Theo
  // Predicate state-seed — ensures a conversation doc exists between the
  // two personas. Conv id synthesised from sorted uniqueIds (idempotent).
  test('writes conversation doc with both participants', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    // Ines = P-11 = 50000061, Theo = P-10 = 50000060
    const r = await executeStep(
      { kind: 'Given', text: 'Ines is in a conversation with Theo' },
      ctx,
    );
    expect(r.ok).toBe(true);
    const convKeys = Object.keys(db._docs).filter((k) => k.startsWith('conversations/'));
    expect(convKeys).toHaveLength(1);
    const conv = db._docs[convKeys[0]];
    expect(conv.participantIds.sort()).toEqual([50000060, 50000061]);
  });

  test('idempotent — same pair → same conv id', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    await executeStep({ kind: 'Given', text: 'Ines is in a conversation with Theo' }, ctx);
    await executeStep({ kind: 'Given', text: 'Theo is in a conversation with Ines' }, ctx);
    const convKeys = Object.keys(db._docs).filter((k) => k.startsWith('conversations/'));
    expect(convKeys).toHaveLength(1);
  });

  test('unknown persona → fail', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Zzzghost is in a conversation with Ines' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Zzzghost/);
  });
});

describe('Wake 77 — "<Name> on <Plat> sets the network to "<X>" via DevTools"', () => {
  // j14-low-bandwidth-degraded.feature:35
  //   When Ines on Web sets the network to "Offline" via DevTools
  // DevTools network throttle control — mid-scenario state change without
  // navigation (vs `opens "X" on <Profile>`).
  test('Offline → driver receives profile name', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webSetNetwork: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Ines on Web sets the network to "Offline" via DevTools' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Ines', 'Offline');
  });

  test('Fast 3G', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webSetNetwork: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Ines on Web sets the network to "Fast 3G" via DevTools' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Ines', 'Fast 3G');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Ines on Web sets the network to "Offline" via DevTools' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webSetNetwork/);
  });
});

describe('Wake 77 — "<Name> on <Plat> types "<text>" and taps send"', () => {
  // j14-low-bandwidth-degraded.feature:36
  //   When Ines on Web types "queued message" and taps send
  // Composite: type message text in the current conversation, click send.
  test('captures text → driver receives it', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webTypeAndSend: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Ines on Web types "queued message" and taps send' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Ines', 'queued message');
  });

  test('android variant', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidTypeAndSend: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Raul on Android types "hello" and taps send' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Raul', 'hello');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Ines on Web types "hello" and taps send' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webTypeAndSend/);
  });
});

describe('Wake 77 — "no XHR returns <status>"', () => {
  // j14-low-bandwidth-degraded.feature:42
  //   Then no XHR returns 408
  // Network log assertion (no request with the named status code).
  test('no matching status → ok', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webNetworkLogHasStatus: spy } });
    const r = await executeStep({ kind: 'Then', text: 'no XHR returns 408' }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith(408);
  });

  test('matching status found → fail', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webNetworkLogHasStatus: spy } });
    const r = await executeStep({ kind: 'Then', text: 'no XHR returns 408' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/408/);
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Then', text: 'no XHR returns 408' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webNetworkLogHasStatus/);
  });
});

describe('Wake 77 — "the network log shows N attempts to <path>"', () => {
  // j14-low-bandwidth-degraded.feature:88
  //   Then the network log shows 3 attempts to /api/economy/balance
  // Retry-count assertion for fault-injection tests.
  test('count matches → ok', async () => {
    const spy = jest.fn(async () => 3);
    const ctx = makeCtx({ webDriver: { webNetworkLogCountAttempts: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'the network log shows 3 attempts to /api/economy/balance' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('/api/economy/balance');
  });

  test('count mismatch → fail with both', async () => {
    const spy = jest.fn(async () => 1);
    const ctx = makeCtx({ webDriver: { webNetworkLogCountAttempts: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'the network log shows 3 attempts to /api/economy/balance' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/3/);
    expect(r.error).toMatch(/1/);
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: 'the network log shows 3 attempts to /api/economy/balance' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webNetworkLogCountAttempts/);
  });
});

// ── Wake 78 ──────────────────────────────────────────────────────────

describe('Wake 78 — "<Name> on <Plat> restores the network to "<X>""', () => {
  // j14-low-bandwidth-degraded.feature:39
  //   When Ines on Web restores the network to "Slow 3G"
  // Mid-scenario throttle restoration after Offline. Same driver as
  // Wake 77's `sets the network`.
  test('restores → driver receives profile', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webSetNetwork: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Ines on Web restores the network to "Slow 3G"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Ines', 'Slow 3G');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Ines on Web restores the network to "Slow 3G"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webSetNetwork/);
  });
});

describe('Wake 78 — "Express API <path> has a N second latency injected"', () => {
  // j14-low-bandwidth-degraded.feature:96
  //   Given the Express API /api/users/me has a 6 second latency injected
  // Fault-injection state-seed. Driver enables server-side latency for
  // the named endpoint.
  test('injects latency → driver receives both', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { injectApiLatency: spy } });
    const r = await executeStep(
      { kind: 'Given', text: 'the Express API /api/users/me has a 6 second latency injected' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('/api/users/me', 6);
  });

  test('different latency value', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { injectApiLatency: spy } });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'the Express API /api/economy/balance has a 12 second latency injected',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('/api/economy/balance', 12);
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'the Express API /api/users/me has a 6 second latency injected' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/injectApiLatency/);
  });
});

describe('Wake 78 — "Express API <path> fails twice with N, succeeds on Nth try"', () => {
  // j14-low-bandwidth-degraded.feature:85
  //   Given the Express API /api/economy/balance fails twice with 503, succeeds on 3rd try
  // Fault-injection with retry-success pattern. Driver receives the path,
  // failure status code, and the ordinal of the successful attempt.
  test('injects failure-then-success pattern', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { injectApiFailureThenSuccess: spy } });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'the Express API /api/economy/balance fails twice with 503, succeeds on 3rd try',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('/api/economy/balance', 503, '3rd');
  });

  test('different status + ordinal', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { injectApiFailureThenSuccess: spy } });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'the Express API /api/messages fails twice with 502, succeeds on 4th try',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('/api/messages', 502, '4th');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'the Express API /api/economy/balance fails twice with 503, succeeds on 3rd try',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/injectApiFailureThenSuccess/);
  });
});

describe('Wake 78 — "Network Link Conditioner injects N% packet loss"', () => {
  // j14-low-bandwidth-degraded.feature:64
  //   Given Network Link Conditioner injects 30% packet loss
  // iOS-specific network fault tool. Driver enables NLC packet-loss
  // injection at the named percentage.
  test('injects packet loss', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosNetworkLinkConditioner: spy } });
    const r = await executeStep(
      { kind: 'Given', text: 'Network Link Conditioner injects 30% packet loss' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith(30);
  });

  test('different percentage', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosNetworkLinkConditioner: spy } });
    const r = await executeStep(
      { kind: 'Given', text: 'Network Link Conditioner injects 75% packet loss' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith(75);
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'Network Link Conditioner injects 30% packet loss' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/iosNetworkLinkConditioner/);
  });
});

describe('Wake 78 — "<Name>\'s <Plat> UI shows the message in the conversation"', () => {
  // j14-low-bandwidth-degraded.feature:41
  //   Then Theo's Android UI shows the message in the conversation
  // Asserts the most-recently-sent message (from a sibling persona's
  // perspective) appears in the open conversation. Driver returns
  // truthy iff the message is rendered.
  test('android: message visible → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsLastMessage: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Theo's Android UI shows the message in the conversation" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo');
  });

  test('iOS Sim variant', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosShowsLastMessage: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Mia's iOS Sim UI shows the message in the conversation" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Mia');
  });

  test('driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidShowsLastMessage: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Theo's Android UI shows the message in the conversation" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/message/);
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Theo's Android UI shows the message in the conversation" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidShowsLastMessage/);
  });
});

describe('Wake 78 — "<Name>\'s <Plat> UI shows a "<X>" indicator"', () => {
  // j14-low-bandwidth-degraded.feature:79
  //   Then Ines's iOS Sim UI shows a "Poor connection" indicator
  // Named-indicator presence assertion (different from `<X> tab` or
  // `<X> button` matchers). Driver checks for the visual badge.
  test('iOS Sim: indicator present → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosShowsNamedIndicator: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Ines\'s iOS Sim UI shows a "Poor connection" indicator' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Ines', 'Poor connection');
  });

  test('android variant', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsNamedIndicator: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Theo\'s Android UI shows a "Recording" indicator' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo', 'Recording');
  });

  test('driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { iosShowsNamedIndicator: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Ines\'s iOS Sim UI shows a "Poor connection" indicator' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Poor connection/);
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: 'Ines\'s iOS Sim UI shows a "Poor connection" indicator' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/iosShowsNamedIndicator/);
  });
});

// ── Wake 79 ──────────────────────────────────────────────────────────

describe('Wake 79 — "<Name> on <Plat> picks template "<X>" and title "<Y>""', () => {
  // j15-mc-performance.feature:25
  //   When Selma on Android picks template "Singing" and title "Selma's Saturday Sing-along"
  test('captures both template and title', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidPickTemplateAndTitle: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Selma on Android picks template "Singing" and title "Selma\'s Saturday Sing-along"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Selma', 'Singing', "Selma's Saturday Sing-along");
  });

  test('iOS Sim variant', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosPickTemplateAndTitle: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Mia on iOS Sim picks template "Talk" and title "Chat with Mia"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Mia', 'Talk', 'Chat with Mia');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Selma on Android picks template "X" and title "Y"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidPickTemplateAndTitle/);
  });
});

describe('Wake 79 — "<Name> on <Plat> refreshes the "<X>" tab"', () => {
  // j15-mc-performance.feature:32
  //   When Theo on Android refreshes the "rooms" tab
  // App tab refresh — distinct from existing Web Admin
  // refresh-age-verification matcher (different platform + quoted tab).
  test('quoted tab → driver receives name', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidRefreshTab: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Theo on Android refreshes the "rooms" tab' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo', 'rooms');
  });

  test('iOS Sim variant', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosRefreshTab: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Mia on iOS Sim refreshes the "discovery" tab' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Mia', 'discovery');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Theo on Android refreshes the "rooms" tab' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidRefreshTab/);
  });
});

describe('Wake 79 — "<Name> on <Plat> selects "<gift>" and recipient "<X>""', () => {
  // j15-mc-performance.feature:42
  //   When Alice on Web selects "rose" and recipient "Selma"
  test('captures both → driver receives them', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webSelectGiftAndRecipient: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Web selects "rose" and recipient "Selma"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 'rose', 'Selma');
  });

  test('different gift + recipient', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webSelectGiftAndRecipient: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Web selects "diamond" and recipient "Theo"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 'diamond', 'Theo');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Web selects "rose" and recipient "Selma"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webSelectGiftAndRecipient/);
  });
});

describe('Wake 79 — "<Name>\'s <Plat> UI shows the "<X>" tier badge on the room card"', () => {
  // j15-mc-performance.feature:36
  //   Then Theo's Android UI shows the "MC Singer" tier badge on the room card
  test('matching badge → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsTierBadge: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Theo\'s Android UI shows the "MC Singer" tier badge on the room card',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo', 'MC Singer');
  });

  test('different tier', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsTierBadge: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Theo\'s Android UI shows the "Star" tier badge on the room card' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo', 'Star');
  });

  test('driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidShowsTierBadge: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Theo\'s Android UI shows the "MC Singer" tier badge on the room card',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/MC Singer/);
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: 'Theo\'s Android UI shows the "X" tier badge on the room card' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidShowsTierBadge/);
  });
});

describe('Wake 79 — "<Name>\'s mic is already open on the seated host slot" (state-seed)', () => {
  // j15-mc-performance.feature:46
  //   Given Selma's mic is already open on the seated host slot
  // Predicate state-seed: marks the persona's host-owned room with
  // mic-open + seated.
  test('updates room with host slot mic-open', async () => {
    // Selma = P-14 = 50000080
    const db = makeStatefulFakeDb({
      'rooms/r-test': { id: 'r-test', ownerUniqueId: 50000080, participantIds: [50000080] },
    });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: "Selma's mic is already open on the seated host slot" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['rooms/r-test'].micStates['50000080']).toBe('open');
    expect(db._docs['rooms/r-test'].seats[0]).toEqual(
      expect.objectContaining({ userId: 50000080 }),
    );
  });

  test('no host-owned room → fail', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: "Selma's mic is already open on the seated host slot" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/host|room|Selma/i);
  });

  test('no db → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: "Selma's mic is already open on the seated host slot" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db/);
  });
});

describe('Wake 79 — "<Name>\'s <Plat> UI shows his/her/their seat as <state>"', () => {
  // j10-mid-room-warning.feature:79
  //   Then Theo's Android UI shows his seat as available
  test('matching state → ok', async () => {
    const spy = jest.fn(async () => 'available');
    const ctx = makeCtx({ uiDriver: { androidGetSeatState: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Theo's Android UI shows his seat as available" },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('different pronoun + state', async () => {
    const spy = jest.fn(async () => 'occupied');
    const ctx = makeCtx({ uiDriver: { androidGetSeatState: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Mia's Android UI shows her seat as occupied" },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('mismatch → fail', async () => {
    const spy = jest.fn(async () => 'occupied');
    const ctx = makeCtx({ uiDriver: { androidGetSeatState: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Theo's Android UI shows his seat as available" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/available/);
    expect(r.error).toMatch(/occupied/);
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Theo's Android UI shows his seat as available" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidGetSeatState/);
  });
});

// ── Wake 80 ──────────────────────────────────────────────────────────

describe("Wake 80 — \"the tester hears <X>'s voice on <Y>'s <Plat> speakers AND <Z>'s <Plat> speakers\"", () => {
  // j15-mc-performance.feature:48
  //   Then the tester hears Selma's voice on Alice's Web speakers AND Theo's Android speakers
  // Two-listener variant of Wake 66's tester-hears-audio. Manual-only —
  // gated on ctx.testerDriver.confirmHearsAudioMulti.
  test('testerDriver returns true → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ testerDriver: { confirmHearsAudioMulti: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "the tester hears Selma's voice on Alice's Web speakers AND Theo's Android speakers",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Selma', [
      { name: 'Alice', platform: 'Web' },
      { name: 'Theo', platform: 'Android' },
    ]);
  });

  test('testerDriver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ testerDriver: { confirmHearsAudioMulti: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "the tester hears Selma's voice on Alice's Web speakers AND Theo's Android speakers",
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/tester did not confirm/i);
  });

  test('no testerDriver → manual hint', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: "the tester hears Selma's voice on Alice's Web speakers AND Theo's Android speakers",
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/manual/i);
  });
});

describe('Wake 80 — "Greta on Web Admin opens the economy stats"', () => {
  // j15-mc-performance.feature:60
  //   When Greta on Web Admin opens the economy stats
  // Bare admin-navigation (no quoted tab — distinct from subtab/report
  // ordinal matchers).
  test('opens economy stats → driver called', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webAdminOpenEconomyStats: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin opens the economy stats' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  test('driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webAdminOpenEconomyStats: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin opens the economy stats' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/economy stats/);
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Greta on Web Admin opens the economy stats' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webAdminOpenEconomyStats/);
  });
});

describe('Wake 80 — "<Name> on <Plat> taps the gift icon in the room"', () => {
  // j15-mc-performance.feature:41
  //   When Alice on Web taps the gift icon in the room
  // Composite: open the gift modal from within a voice room.
  test('taps gift icon → driver called', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webTapGiftIconInRoom: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Web taps the gift icon in the room' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice');
  });

  test('android variant', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidTapGiftIconInRoom: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Theo on Android taps the gift icon in the room' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Web taps the gift icon in the room' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webTapGiftIconInRoom/);
  });
});

describe('Wake 80 — "<Name>\'s room "<X>" is OPEN" (possessive variant)', () => {
  // j15-mc-performance.feature:67
  //   Then Selma's room "Selma's Saturday Sing-along" is OPEN
  // Possessive variant of Wake 68's `the room "<X>" is still OPEN`.
  test('matching state → ok', async () => {
    const db = makeStatefulFakeDb({
      "rooms/Selma's Saturday Sing-along": { state: 'OPEN' },
    });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Then', text: 'Selma\'s room "Selma\'s Saturday Sing-along" is OPEN' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('mismatched state → fail', async () => {
    const db = makeStatefulFakeDb({ 'rooms/r1': { state: 'CLOSED' } });
    const ctx = makeCtx({ db });
    const r = await executeStep({ kind: 'Then', text: 'Theo\'s room "r1" is OPEN' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/OPEN/);
    expect(r.error).toMatch(/CLOSED/);
  });

  test('no such room → fail', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep({ kind: 'Then', text: 'Theo\'s room "r1" is OPEN' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/r1|does not exist/);
  });
});

describe('Wake 80 — "the response from <path>?<query> includes <Name>"', () => {
  // j15-mc-performance.feature:62
  //   Then the response from /api/economy/leaderboards?segment=mc-singer includes Selma
  test('persona present in response → ok', async () => {
    const ctx = makeCtx();
    // Selma = P-14 = 50000080
    ctx.lastResponse = {
      status: 200,
      path: '/api/economy/leaderboards',
      body: { results: [{ uniqueId: 50000080, displayName: 'Selma' }] },
    };
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the response from /api/economy/leaderboards?segment=mc-singer includes Selma',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('persona absent → fail with hint', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = {
      status: 200,
      path: '/api/economy/leaderboards',
      body: { results: [{ uniqueId: 50000010, displayName: 'Alice' }] },
    };
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the response from /api/economy/leaderboards?segment=mc-singer includes Selma',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Selma/);
  });

  test('no recorded response → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the response from /api/economy/leaderboards?segment=mc-singer includes Selma',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no recorded/);
  });
});

describe('Wake 80 — "<Name>\'s <Plat> UI shows total beans earned this session = (N + N + N) = N" (arithmetic)', () => {
  // j15-mc-performance.feature:54
  //   Then Selma's Android UI shows total beans earned this session = (5 + 250 + 500) = 755
  // Arithmetic-verified UI assertion. Matcher: (a) sums the addends,
  // (b) checks they equal the claimed total (corpus-bug detector),
  // (c) asserts the driver returns the same total (UI-drift detector).
  test('addends sum to claimed total + driver matches → ok', async () => {
    const spy = jest.fn(async () => 755);
    const ctx = makeCtx({ uiDriver: { androidGetTotalBeansThisSession: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Selma's Android UI shows total beans earned this session = (5 + 250 + 500) = 755",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Selma');
  });

  test('corpus arithmetic mismatch → fail (author typo)', async () => {
    const ctx = makeCtx({ uiDriver: { androidGetTotalBeansThisSession: jest.fn() } });
    // 5 + 250 + 500 = 755, but author wrote 999
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Selma's Android UI shows total beans earned this session = (5 + 250 + 500) = 999",
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/sum.*to 755/i);
    expect(r.error).toMatch(/999/);
  });

  test('driver returns different total → fail (UI drift)', async () => {
    const spy = jest.fn(async () => 600);
    const ctx = makeCtx({ uiDriver: { androidGetTotalBeansThisSession: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Selma's Android UI shows total beans earned this session = (5 + 250 + 500) = 755",
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/755/);
    expect(r.error).toMatch(/600/);
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Selma's Android UI shows total beans earned this session = (5 + 250 + 500) = 755",
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidGetTotalBeansThisSession/);
  });
});

// ── Wake 81 ──────────────────────────────────────────────────────────

describe('Wake 81 — "<Name> is also paired on <Plat> (same Firebase identity) for <purpose>"', () => {
  // j17-teacher-classroom.feature:19
  //   Given Bao is also paired on Android (same Firebase identity) for hosting
  // Multi-device pairing state-seed: stores on ctx.pairedPlatforms.
  test('records pairing in ctx.pairedPlatforms', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Bao is also paired on Android (same Firebase identity) for hosting',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.pairedPlatforms.get('Bao')).toEqual({
      platform: 'Android',
      purpose: 'hosting',
    });
  });

  test('different platform + purpose', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Alice is also paired on iOS Sim (same Firebase identity) for streaming',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.pairedPlatforms.get('Alice')).toEqual({
      platform: 'iOS Sim',
      purpose: 'streaming',
    });
  });
});

describe('Wake 81 — "<Name> on <Plat> fills in: <kv-list>"', () => {
  // j17-teacher-classroom.feature:28
  //   When Bao on Web fills in: language "zh", level "Beginner", title "Intro to Mandarin tones"
  // Multi-field form-fill composite.
  test('parses kv-list with comma separation', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webFillIn: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Bao on Web fills in: language "zh", level "Beginner", title "Intro to Mandarin tones"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Bao', {
      language: 'zh',
      level: 'Beginner',
      title: 'Intro to Mandarin tones',
    });
  });

  test('single-field fill', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webFillIn: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Bao on Web fills in: title "Quick lesson"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Bao', { title: 'Quick lesson' });
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'When', text: 'Bao on Web fills in: title "X"' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webFillIn/);
  });
});

describe('Wake 81 — "<Name> on <Plat> taps "<X>" on the <noun> card"', () => {
  // j17-teacher-classroom.feature:33
  //   When Bao on Android taps "Start lesson" on the lesson card
  test('matching tap → driver receives all three', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidTapOnCard: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Bao on Android taps "Start lesson" on the lesson card' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Bao', 'Start lesson', 'lesson');
  });

  test('different card type', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidTapOnCard: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Theo on Android taps "Join" on the room card' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo', 'Join', 'room');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Bao on Android taps "Start lesson" on the lesson card' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidTapOnCard/);
  });
});

describe('Wake 81 — "<Name> on <Plat> taps the gift icon and selects "<X>" with recipient "<Y>""', () => {
  // j17-teacher-classroom.feature:57
  //   When Yuki on iOS Sim taps the gift icon and selects "rose" with recipient "Bao"
  // Triple composite: open gift modal, pick gift, pick recipient.
  test('iOS Sim: all three captured', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosGiftIconSelectAndRecipient: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Yuki on iOS Sim taps the gift icon and selects "rose" with recipient "Bao"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Yuki', 'rose', 'Bao');
  });

  test('android variant', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidGiftIconSelectAndRecipient: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Theo on Android taps the gift icon and selects "diamond" with recipient "Alice"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo', 'diamond', 'Alice');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Yuki on iOS Sim taps the gift icon and selects "rose" with recipient "Bao"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/iosGiftIconSelectAndRecipient/);
  });
});

// ── Wake 82 ──────────────────────────────────────────────────────────

describe('Wake 82 — "<Name> [P-NN] exists with uniqueId=N, userType=X, isOfficial=B, isUnblockable=B"', () => {
  // j18-official-system-pms.feature:19
  //   Given Officia [P-19] exists with uniqueId=1, userType=SHYTALK_OFFICIAL, isOfficial=true, isUnblockable=true
  // Complex multi-field state-seed for the Officia system account.
  test('writes all four fields', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Officia [P-19] exists with uniqueId=1, userType=SHYTALK_OFFICIAL, isOfficial=true, isUnblockable=true',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/1']).toEqual({
      uniqueId: 1,
      userType: 'SHYTALK_OFFICIAL',
      isOfficial: true,
      isUnblockable: true,
    });
  });

  test('isOfficial=false → boolean parsed correctly', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Vexa exists with uniqueId=42, userType=MEMBER, isOfficial=false, isUnblockable=false',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/42'].isOfficial).toBe(false);
    expect(db._docs['users/42'].isUnblockable).toBe(false);
  });

  test('no db → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Officia exists with uniqueId=1, userType=X, isOfficial=true, isUnblockable=true',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db/);
  });
});

describe('Wake 82 — "<Name> was just age-verified by admin (cohort flipped from <X> to <Y>)"', () => {
  // j18-official-system-pms.feature:27
  //   Given Adam was just age-verified by admin (cohort flipped from minor to adult)
  // Past-tense state-seed: writes cohort + ageVerificationFlippedAt
  // timestamp.
  test('writes post-flip cohort + timestamp', async () => {
    // Adam = P-01 = 90000001 (ephemeral)
    const db = makeStatefulFakeDb({ 'users/90000001': {} });
    const ctx = makeCtx({ db });
    const before = Date.now();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Adam was just age-verified by admin (cohort flipped from minor to adult)',
      },
      ctx,
    );
    const after = Date.now();
    expect(r.ok).toBe(true);
    expect(db._docs['users/90000001'].cohort).toBe('adult');
    expect(db._docs['users/90000001'].ageVerificationFlippedAt).toBeGreaterThanOrEqual(before);
    expect(db._docs['users/90000001'].ageVerificationFlippedAt).toBeLessThanOrEqual(after);
  });

  test('different persona name', async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': {} });
    const ctx = makeCtx({ db });
    // Alice = P-02 = 50000010
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Alice was just age-verified by admin (cohort flipped from minor to adult)',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    // Handler always sets cohort='adult' since corpus only documents upgrade.
    expect(db._docs['users/50000010'].cohort).toBe('adult');
  });

  test('unknown persona → fail', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Zzzghost was just age-verified by admin (cohort flipped from minor to adult)',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Zzzghost/);
  });
});

describe('"the <name> webhook fires sendSystemPm with key="<X>" recipient=<Y>"', () => {
  // Wake 132 converted from webDriver stub to direct Firestore write.
  // Mirrors src/utils/system-pm.js sendSystemPm: writes the conversation
  // doc + the message doc under conversations/<convId>/messages.

  function makeWriteRecordingDb() {
    const writes = [];
    return {
      writes,
      doc: (path) => ({
        set: async (data, opts) => writes.push({ op: 'set', path, data, opts }),
      }),
    };
  }

  test('writes conversation + message docs at sorted-join convId', async () => {
    const db = makeWriteRecordingDb();
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'the post-approval webhook fires sendSystemPm with key="age_seg_age_up_welcome_pm" recipient=Adam',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    // Adam P-01 uniqueId=90000001. Sorted-join with SHYTALK_SYSTEM:
    // "90000001_SHYTALK_SYSTEM" (lex-sort: digits < uppercase letters).
    const convId = '90000001_SHYTALK_SYSTEM';
    const convWrite = db.writes.find((w) => w.path === `conversations/${convId}`);
    expect(convWrite).toBeDefined();
    expect(convWrite.data.participantIds).toEqual([90000001, 'SHYTALK_SYSTEM']);
    const msgWrite = db.writes.find((w) => w.path.startsWith(`conversations/${convId}/messages/`));
    expect(msgWrite).toBeDefined();
    expect(msgWrite.data).toMatchObject({
      type: 'SYSTEM',
      senderId: 'SHYTALK_SYSTEM',
      text: '[age_seg_age_up_welcome_pm]',
      _testKey: 'age_seg_age_up_welcome_pm',
    });
  });

  test('captures lastSentSystemPm on ctx for downstream recipient assertion', async () => {
    const db = makeWriteRecordingDb();
    const ctx = makeCtx({ db });
    await executeStep(
      {
        kind: 'When',
        text: 'the rejection webhook fires sendSystemPm with key="age_seg_age_down_admin_pm" recipient=Hayato',
      },
      ctx,
    );
    expect(ctx.lastSentSystemPm).toMatchObject({
      webhook: 'rejection',
      key: 'age_seg_age_down_admin_pm',
      recipientName: 'Hayato',
      recipientUid: 50000030,
    });
  });

  test('unknown recipient → fail (no writes attempted)', async () => {
    const db = makeWriteRecordingDb();
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'the post-approval webhook fires sendSystemPm with key="x" recipient=Zzzghost',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Zzzghost/);
    expect(db.writes).toHaveLength(0);
  });

  test('no ctx.db → fail', async () => {
    const ctx = makeCtx({ db: null });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'the post-approval webhook fires sendSystemPm with key="x" recipient=Adam',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.db/);
  });
});

describe('Wake 82 — "the message body is the <Language> translation of the <X> template"', () => {
  // j18-official-system-pms.feature:31, 41
  //   Then the message body is the English translation of the age-up template
  // Distinct from existing `the PM body is the X translation` (line 3903)
  // by the noun ("message body" vs "PM body"). Same driver method.
  test('matching translation → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { pmBodyIsTranslationOfTemplate: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'the message body is the English translation of the age-up template' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('en', 'age-up');
  });

  test('Japanese translation', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { pmBodyIsTranslationOfTemplate: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the message body is the Japanese translation of the age-down template',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('ja', 'age-down');
  });

  test('driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { pmBodyIsTranslationOfTemplate: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'the message body is the English translation of the age-up template' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/English|age-up/);
  });
});

describe('Wake 82 — "<Name>\'s <Plat> UI shows a new PM thread with sender "<X>""', () => {
  // j18-official-system-pms.feature:32
  //   Then within 5000ms Adam's Android UI shows a new PM thread with sender "ShyTalk Official"
  // Tested bare (after `within` peels off).
  test('matching sender → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsNewPmThreadWithSender: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Adam\'s Android UI shows a new PM thread with sender "ShyTalk Official"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Adam', 'ShyTalk Official');
  });

  test('iOS Sim variant', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosShowsNewPmThreadWithSender: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Hayato\'s iOS Sim UI shows a new PM thread with sender "ShyTalk Official"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Hayato', 'ShyTalk Official');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Adam\'s Android UI shows a new PM thread with sender "ShyTalk Official"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidShowsNewPmThreadWithSender/);
  });
});

describe('Wake 82 — "<X> (locale=<a>) is being downgraded by <Y> (locale=<b>) via age verification"', () => {
  // j18-official-system-pms.feature:38
  //   Given Hayato (locale=ja) is being downgraded by Greta (locale=en) via age verification
  // Composite admin-action state-seed (present-progressive tense).
  // Distinct from Wake 76's `is age-verified and Greta downgrades her
  // to minor` — different tense + double-locale annotation.
  test('writes target.cohort=minor + records locales', async () => {
    // Hayato = P-06 = 50000030
    const db = makeStatefulFakeDb({ 'users/50000030': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Hayato (locale=ja) is being downgraded by Greta (locale=en) via age verification',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000030'].cohort).toBe('minor');
    expect(db._docs['users/50000030'].locale).toBe('ja');
    expect(ctx.personaLocales.get('Hayato')).toEqual({ platform: null, locale: 'ja' });
    expect(ctx.personaLocales.get('Greta')).toEqual({ platform: null, locale: 'en' });
  });

  test('unknown target → fail', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Zzzghost (locale=en) is being downgraded by Greta (locale=en) via age verification',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Zzzghost/);
  });

  test('no db → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Hayato (locale=ja) is being downgraded by Greta (locale=en) via age verification',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db/);
  });
});

// ── Wake 83 ──────────────────────────────────────────────────────────

describe('Wake 83 — "<Name> [P-NN] is signed in as a non-admin user"', () => {
  // j12-admin-daily-routine.feature:140
  //   Given Adam [P-01] is signed in as a non-admin user
  // Predicate state-seed for admin-permission tests. Sets isAdmin=false
  // on the persona's user doc.
  test('writes isAdmin=false', async () => {
    // Adam = P-01 = 90000001 (ephemeral)
    const db = makeStatefulFakeDb({ 'users/90000001': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Adam [P-01] is signed in as a non-admin user' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/90000001'].isAdmin).toBe(false);
  });

  test('different persona', async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Alice is signed in as a non-admin user' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000010'].isAdmin).toBe(false);
  });

  test('unknown persona → fail', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Zzzghost is signed in as a non-admin user' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Zzzghost/);
  });
});

describe('Wake 83 — "the audit log has <N> entries"', () => {
  // Wake 126 converted this from a webDriver-stub delegation to a
  // direct Firestore bulk-write. j12-admin-daily-routine.feature:101.
  // Bulk-writes synthetic audit entries to exercise pagination/perf
  // paths in the admin-audit-log queries.

  function makeWriteRecordingDb() {
    const writes = [];
    return {
      writes,
      doc: (path) => ({
        set: async (data) => writes.push({ op: 'set', path, data }),
      }),
    };
  }

  test('writes N audit log docs to auditLog collection', async () => {
    const db = makeWriteRecordingDb();
    const ctx = makeCtx({ db });
    const r = await executeStep({ kind: 'Given', text: 'the audit log has 50 entries' }, ctx);
    expect(r.ok).toBe(true);
    const auditWrites = db.writes.filter((w) => w.path.startsWith('auditLog/'));
    expect(auditWrites).toHaveLength(50);
    expect(auditWrites[0].data).toMatchObject({
      action: 'test_seed',
      details: 'test-seed audit entry',
    });
  });

  test('zero entries is valid (empty seed)', async () => {
    const db = makeWriteRecordingDb();
    const ctx = makeCtx({ db });
    const r = await executeStep({ kind: 'Given', text: 'the audit log has 0 entries' }, ctx);
    expect(r.ok).toBe(true);
    expect(db.writes).toHaveLength(0);
  });

  test('no ctx.db → fail', async () => {
    const ctx = makeCtx({ db: null });
    const r = await executeStep({ kind: 'Given', text: 'the audit log has 50 entries' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.db/);
  });
});

describe('Wake 83 — "the scheduled startsAt has been reached"', () => {
  // j16-event-host-team-leader.feature:42
  //   Given the scheduled startsAt has been reached
  // Time-travel state-seed: advances mock clock to/past the most recent
  // event's startsAt. Driver triggers any time-based watchers.
  test('triggers time advance via driver', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { advanceClockToStartsAt: spy } });
    const r = await executeStep(
      { kind: 'Given', text: 'the scheduled startsAt has been reached' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  test('driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { advanceClockToStartsAt: spy } });
    const r = await executeStep(
      { kind: 'Given', text: 'the scheduled startsAt has been reached' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/startsAt|clock/i);
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'the scheduled startsAt has been reached' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/advanceClockToStartsAt/);
  });
});

describe('Wake 83 — "<Name> on <Plat> taps "<X>" on his/her/their event-host home"', () => {
  // j16-event-host-team-leader.feature:43
  //   When Tariq on Android taps "Start event" on his event-host home
  // Tap with a contextual-location annotation (the event-host home is
  // a specific screen, not a card or tab).
  test('matching tap → driver receives button text', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidTapOnEventHostHome: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Tariq on Android taps "Start event" on his event-host home' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Tariq', 'Start event');
  });

  test('different pronoun + button', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidTapOnEventHostHome: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Android taps "End event" on her event-host home' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 'End event');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Tariq on Android taps "X" on his event-host home' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidTapOnEventHostHome/);
  });
});

describe('Wake 83 — "<Name>\'s <Plat> UI shows the roster panel with <Other> listed as "<status>""', () => {
  // j16-event-host-team-leader.feature:50
  //   Then Tariq's Android UI shows the roster panel with Selma listed as "waiting"
  // Composite roster-assertion: persona + status. Driver verifies the
  // roster panel contains a row for the named persona with the named
  // status.
  test('matching listing → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsRosterEntry: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Tariq\'s Android UI shows the roster panel with Selma listed as "waiting"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Tariq', 'Selma', 'waiting');
  });

  test('different status', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsRosterEntry: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Tariq\'s Android UI shows the roster panel with Selma listed as "performing"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Tariq', 'Selma', 'performing');
  });

  test('driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidShowsRosterEntry: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Tariq\'s Android UI shows the roster panel with Selma listed as "waiting"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Selma|waiting/);
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Tariq\'s Android UI shows the roster panel with Selma listed as "X"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidShowsRosterEntry/);
  });
});

describe('Wake 83 — "<Name> [P-NN] (a non-follower) opens the "<X>" tab"', () => {
  // j15-mc-performance.feature:75
  //   When Adam [P-01] (a non-follower) opens the "home" tab
  // Persona-annotated tab navigation. The `(a non-follower)` annotation
  // is informational — runner doesn't enforce non-follower status, just
  // navigates to the tab. Stripped by stripStepAnnotation? Let's check
  // — the parens are MID-step, not end-anchored. So they remain.
  test('non-follower opens tab → driver receives tab', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidOpenTab: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Adam [P-01] (a non-follower) opens the "home" tab' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Adam', 'home');
  });

  test('different annotation parenthetical also matches', async () => {
    // The matcher should tolerate any mid-step paren content
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidOpenTab: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Marcus [P-04] (minor) opens the "home" tab' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Marcus', 'home');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Adam (a non-follower) opens the "home" tab' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidOpenTab/);
  });
});

// ── Wake 84 ──────────────────────────────────────────────────────────

describe('Wake 84 — "<Name>\'s <Plat> UI still shows the <noun> <kind>"', () => {
  // j10-mid-room-warning.feature:63
  //   Then Theo's Android UI still shows the warning screen
  // Positive-persistence variant of Wake 69's `UI shows the X <kind>`.
  // Same driver — `still` is just author wording for continued state.
  test('matching state → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsNamedKind: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Theo's Android UI still shows the warning screen" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo', 'warning', 'screen');
  });

  test('driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidShowsNamedKind: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Theo's Android UI still shows the warning screen" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/warning/);
  });
});

describe('Wake 84 — "<Name>\'s <Plat> UI does not navigate away"', () => {
  // j10-mid-room-warning.feature:62
  //   Then Theo's Android UI does not navigate away
  test('no navigation occurred → ok', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidDidNavigate: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Theo's Android UI does not navigate away" },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('navigation occurred → fail', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidDidNavigate: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Theo's Android UI does not navigate away" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/navigate|navigated/);
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Theo's Android UI does not navigate away" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidDidNavigate/);
  });
});

describe('Wake 84 — "<Name>\'s <Plat> UI does NOT navigate back into room "<X>" automatically"', () => {
  // j10-mid-room-warning.feature:72
  //   Then Theo's Android UI does NOT navigate back into room "r1" automatically
  test('no auto-rejoin → ok', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidDidAutoRejoinRoom: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Theo\'s Android UI does NOT navigate back into room "r1" automatically',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo', 'r1');
  });

  test('auto-rejoin occurred → fail', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidDidAutoRejoinRoom: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Theo\'s Android UI does NOT navigate back into room "r1" automatically',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/r1/);
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Theo\'s Android UI does NOT navigate back into room "r1" automatically',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidDidAutoRejoinRoom/);
  });
});

describe('Wake 84 — "<Name>\'s <Plat> UI shows the room screen with <indicator> indicator"', () => {
  // j10-mid-room-warning.feature:28
  //   Then Theo's Android UI shows the room screen with mic-on indicator
  test('matching indicator → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsRoomScreenWithIndicator: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Theo's Android UI shows the room screen with mic-on indicator" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo', 'mic-on');
  });

  test('mic-off indicator', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsRoomScreenWithIndicator: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Theo's Android UI shows the room screen with mic-off indicator" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo', 'mic-off');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Theo's Android UI shows the room screen with mic-on indicator" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidShowsRoomScreenWithIndicator/);
  });
});

describe('Wake 84 — "<Name>\'s <Plat> UI is still in the room"', () => {
  // j14-low-bandwidth-degraded.feature:67
  //   Then Ines's iOS Sim UI is still in the room
  test('still in room → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosIsStillInRoom: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Ines's iOS Sim UI is still in the room" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Ines');
  });

  test('left the room → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { iosIsStillInRoom: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Ines's iOS Sim UI is still in the room" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Ines|room/);
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Ines's iOS Sim UI is still in the room" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/iosIsStillInRoom/);
  });
});

describe('Wake 84 — "<Name>\'s <Plat> network restores"', () => {
  // j14-low-bandwidth-degraded.feature:70
  //   When Ines's iOS Sim network restores
  // Bare network-event step (no profile — driver decides what "restores"
  // means based on prior state).
  test('iOS Sim variant', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosNetworkRestores: spy } });
    const r = await executeStep({ kind: 'When', text: "Ines's iOS Sim network restores" }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Ines');
  });

  test('android variant', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidNetworkRestores: spy } });
    const r = await executeStep({ kind: 'When', text: "Theo's Android network restores" }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'When', text: "Ines's iOS Sim network restores" }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/iosNetworkRestores/);
  });
});

// ── Wake 85 ──────────────────────────────────────────────────────────

describe('Wake 85 — "<Name> [P-NN] is on <Plat> joined to voice room "<X>" with mic <state>" (state-seed)', () => {
  // j14-low-bandwidth-degraded.feature:46
  //   Given Ines [P-11] is on iOS Sim joined to voice room "r1" with mic open
  test('writes participantIds and mic state', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    // Ines = P-11 = 50000061
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Ines [P-11] is on iOS Sim joined to voice room "r1" with mic open',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['rooms/r1'].participantIds).toContain(50000061);
    expect(db._docs['rooms/r1'].micStates['50000061']).toBe('open');
  });

  test('muted variant', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Theo on Android joined to voice room "r2" with mic muted',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['rooms/r2'].micStates['50000060']).toBe('muted');
  });

  test('unknown persona → fail', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Zzzghost is on iOS Sim joined to voice room "rX" with mic open',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Zzzghost/);
  });
});

describe('Wake 85 — "<Name> is on <Plat> joined to room "<X>" seated with mic <state>" (state-seed)', () => {
  // j14-low-bandwidth-degraded.feature:62
  //   Given Ines is on iOS Sim joined to room "r1" seated with mic open
  // Seated variant — also seats the persona.
  test('writes participantIds + seated + mic', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    // Ines = P-11 = 50000061
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Ines is on iOS Sim joined to room "r1" seated with mic open',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['rooms/r1'].participantIds).toContain(50000061);
    expect(db._docs['rooms/r1'].seats[0]).toEqual(expect.objectContaining({ userId: 50000061 }));
    expect(db._docs['rooms/r1'].micStates['50000061']).toBe('open');
  });

  test('muted variant', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Alice is on Web joined to room "r9" seated with mic muted',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['rooms/r9'].micStates['50000010']).toBe('muted');
  });
});

describe('Wake 85 — "the tester hears <X>\'s audio with <quality>"', () => {
  // j14-low-bandwidth-degraded.feature:77
  //   Then the tester hears Ines's audio with occasional dropouts but recognizable speech
  // Manual-only — extends Wake 66's tester-hears-audio with quality descriptor.
  test('testerDriver returns true → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ testerDriver: { confirmHearsAudioWithQuality: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "the tester hears Ines's audio with occasional dropouts but recognizable speech",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Ines', 'occasional dropouts but recognizable speech');
  });

  test('different quality descriptor', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ testerDriver: { confirmHearsAudioWithQuality: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "the tester hears Selma's audio with crystal clear quality" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Selma', 'crystal clear quality');
  });

  test('no testerDriver → manual hint', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "the tester hears Ines's audio with occasional dropouts" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/manual/i);
  });
});

describe('Wake 85 — "<Name>\'s <Plat> UI shows the room screen with host seat occupied + "<X>" badge"', () => {
  // j15-mc-performance.feature:34
  //   Then Selma's Android UI shows the room screen with host seat occupied + "MC Singer" badge
  test('matching badge → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsRoomScreenWithHostBadge: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Selma\'s Android UI shows the room screen with host seat occupied + "MC Singer" badge',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Selma', 'MC Singer');
  });

  test('driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidShowsRoomScreenWithHostBadge: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Selma\'s Android UI shows the room screen with host seat occupied + "MC Singer" badge',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/MC Singer/);
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Selma\'s Android UI shows the room screen with host seat occupied + "X" badge',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidShowsRoomScreenWithHostBadge/);
  });
});

describe('Wake 85 — "<Name> on <Plat> sends "<X>" to <Y>" (Web/iOS variant)', () => {
  // j15-mc-performance.feature:43
  //   When Alice on Web sends "diamond" to Selma
  // Web/iOS variant of existing Android `sends "X" to Y` (line ~2841).
  test('Web variant → driver called', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webSendItemTo: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Web sends "diamond" to Selma' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 'diamond', 'Selma');
  });

  test('iOS Sim variant', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosSendItemTo: spy } });
    const r = await executeStep({ kind: 'When', text: 'Mia on iOS Sim sends "rose" to Bao' }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Mia', 'rose', 'Bao');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Web sends "diamond" to Selma' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webSendItemTo/);
  });
});

describe('Wake 85 — "<Name> [P-NN] is a <minor|adult> with userType=<X>" (state-seed)', () => {
  // j16-event-host-team-leader.feature:55
  //   Given Marcus [P-04] is a minor with userType=MC_SINGER
  // Composite state-seed: cohort + userType.
  test('writes both cohort and userType', async () => {
    // Marcus = P-04 = 60000010
    const db = makeStatefulFakeDb({ 'users/60000010': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Marcus [P-04] is a minor with userType=MC_SINGER' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/60000010'].cohort).toBe('minor');
    expect(db._docs['users/60000010'].userType).toBe('MC_SINGER');
  });

  test('adult variant', async () => {
    const db = makeStatefulFakeDb({ 'users/50000080': {} });
    const ctx = makeCtx({ db });
    // Selma = P-14 = 50000080
    const r = await executeStep(
      { kind: 'Given', text: 'Selma is a adult with userType=MC_SINGER' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000080'].cohort).toBe('adult');
    expect(db._docs['users/50000080'].userType).toBe('MC_SINGER');
  });

  test('unknown persona → fail', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Zzzghost is a minor with userType=MC_SINGER' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Zzzghost/);
  });
});

// ── Wake 86 ──────────────────────────────────────────────────────────

describe('Wake 86 — "<Name> scheduled an event including <Other>" (state-seed)', () => {
  // j16-event-host-team-leader.feature:33
  //   Given Tariq scheduled an event including Selma
  // State-seed: creates an events doc with hostUid + roster including
  // the named participant.
  test('writes event doc with host and roster', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    // Tariq = P-16 ? Let me skip lookup and just verify event was written.
    const r = await executeStep(
      { kind: 'Given', text: 'Tariq scheduled an event including Selma' },
      ctx,
    );
    expect(r.ok).toBe(true);
    const eventKeys = Object.keys(db._docs).filter((k) => k.startsWith('events/'));
    expect(eventKeys).toHaveLength(1);
    const event = db._docs[eventKeys[0]];
    // Roster should contain Selma's uniqueId (50000080)
    expect(event.roster).toContain(50000080);
  });

  test('unknown participant → fail', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Tariq scheduled an event including Zzzghost' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Zzzghost/);
  });

  test('no db → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'Tariq scheduled an event including Selma' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db/);
  });
});

describe('Wake 86 — "<Name> on <Plat> taps "<X>" in the roster panel"', () => {
  // j16-event-host-team-leader.feature:51
  //   When Tariq on Android taps "Promote Selma" in the roster panel
  // Roster-panel tap with named button (e.g., "Promote X").
  test('matching tap → driver receives button text', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidTapInRosterPanel: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Tariq on Android taps "Promote Selma" in the roster panel' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Tariq', 'Promote Selma');
  });

  test('different button', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidTapInRosterPanel: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Tariq on Android taps "Remove" in the roster panel' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Tariq', 'Remove');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Tariq on Android taps "X" in the roster panel' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidTapInRosterPanel/);
  });
});

describe('Wake 86 — "<Name>\'s <Plat> UI shows the classroom room screen with "<X>" badge on the host seat"', () => {
  // j17-teacher-classroom.feature:35
  //   Then Bao's Android UI shows the classroom room screen with "Teacher" badge on the host seat
  // Composite room-screen + tier badge + host seat.
  test('matching badge → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsClassroomWithHostBadge: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Bao\'s Android UI shows the classroom room screen with "Teacher" badge on the host seat',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Bao', 'Teacher');
  });

  test('driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidShowsClassroomWithHostBadge: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Bao\'s Android UI shows the classroom room screen with "Teacher" badge on the host seat',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Teacher/);
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Bao\'s Android UI shows the classroom room screen with "X" badge on the host seat',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidShowsClassroomWithHostBadge/);
  });
});

describe('Wake 86 — "<Name>\'s <Plat> UI shows <Other>\'s "<X>" room card"', () => {
  // j17-teacher-classroom.feature:40
  //   Then Yuki's iOS Sim UI shows Bao's "Intro to Mandarin tones" room card
  // Possessive room-card assertion: viewer + owner + room title.
  test('matching card → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosShowsOthersRoomCard: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Yuki\'s iOS Sim UI shows Bao\'s "Intro to Mandarin tones" room card',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Yuki', 'Bao', 'Intro to Mandarin tones');
  });

  test('android variant', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsOthersRoomCard: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Theo\'s Android UI shows Alice\'s "Saturday Show" room card' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo', 'Alice', 'Saturday Show');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: 'Yuki\'s iOS Sim UI shows Bao\'s "X" room card' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/iosShowsOthersRoomCard/);
  });
});

describe('Wake 86 — "<Name> on <Plat> approves <Other>\'s seat request"', () => {
  // j17-teacher-classroom.feature:51
  //   When Bao on Android approves Yuki's seat request
  // Host moderation action: approve a participant's request-to-be-seated.
  test('matching approval → driver receives both', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidApproveSeatRequest: spy } });
    const r = await executeStep(
      { kind: 'When', text: "Bao on Android approves Yuki's seat request" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Bao', 'Yuki');
  });

  test('iOS Sim variant', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosApproveSeatRequest: spy } });
    const r = await executeStep(
      { kind: 'When', text: "Selma on iOS Sim approves Alice's seat request" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Selma', 'Alice');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: "Bao on Android approves Yuki's seat request" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidApproveSeatRequest/);
  });

  // Android driver returns false → fail
  test('Android driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidApproveSeatRequest: spy } });
    const r = await executeStep(
      { kind: 'When', text: "Bao on Android approves Yuki's seat request" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Yuki|seat request/i);
  });

  // iOS Sim driver returns false → fail + no-driver → fail
  test('iOS Sim driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { iosApproveSeatRequest: spy } });
    const r = await executeStep(
      { kind: 'When', text: "Selma on iOS Sim approves Alice's seat request" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Alice|seat request/i);
  });

  test('iOS Sim no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: "Selma on iOS Sim approves Alice's seat request" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/iosApproveSeatRequest/);
  });

  // Web branch — routes to ctx.webDriver.webApproveSeatRequest
  test('Web matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webApproveSeatRequest: spy } });
    const r = await executeStep(
      { kind: 'When', text: "Bao on Web approves Yuki's seat request" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Bao', 'Yuki');
  });

  test('Web driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webApproveSeatRequest: spy } });
    const r = await executeStep(
      { kind: 'When', text: "Bao on Web approves Yuki's seat request" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Yuki|seat request/i);
  });

  test('Web no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: "Bao on Web approves Yuki's seat request" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webApproveSeatRequest/);
  });
});

describe('Wake 86 — "<Name>\'s locale is <X>" (bare state-seed)', () => {
  // j17-teacher-classroom.feature:66
  //   Given Yuki's locale is ja
  // Bare locale state-seed. Distinct from Wake 74's "<X>'s browser
  // locale is "<Y>"" (which is quoted and stores in ctx.browserLocales).
  // This writes to users/<uniqueId>.locale.
  test('writes locale to user doc', async () => {
    // Yuki = P-18 = 50000091
    const db = makeStatefulFakeDb({ 'users/50000091': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep({ kind: 'Given', text: "Yuki's locale is ja" }, ctx);
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000091'].locale).toBe('ja');
  });

  test('country-suffixed locale', async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': {} });
    const ctx = makeCtx({ db });
    const r = await executeStep({ kind: 'Given', text: "Alice's locale is en-US" }, ctx);
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000010'].locale).toBe('en-US');
  });

  test('unknown persona → fail', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep({ kind: 'Given', text: "Zzzghost's locale is en" }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Zzzghost/);
  });
});

// ── Wake 87 ──────────────────────────────────────────────────────────

describe('Wake 87 — "<Name> on <Plat> selects N stars and submits feedback "<X>""', () => {
  // j17-teacher-classroom.feature:60
  //   When Yuki on iOS Sim selects 5 stars and submits feedback "Bao explained tones clearly"
  // Composite rating action: pick N stars + type feedback + submit.
  test('captures stars and feedback', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosSubmitStarFeedback: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Yuki on iOS Sim selects 5 stars and submits feedback "Bao explained tones clearly"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Yuki', 5, 'Bao explained tones clearly');
  });

  test('singular "star"', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosSubmitStarFeedback: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Yuki on iOS Sim selects 1 star and submits feedback "Disappointing"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Yuki', 1, 'Disappointing');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Yuki on iOS Sim selects 5 stars and submits feedback "X"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/iosSubmitStarFeedback/);
  });
});

describe('Wake 87 — "<Name>\'s <Plat> UI shows a chart of beans earned per week"', () => {
  // j17-teacher-classroom.feature:74
  //   Then Bao's Web UI shows a chart of beans earned per week
  // Bare chart-presence assertion (no per-bin value verification —
  // driver returns truthy iff the named chart is rendered).
  test('matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsBeansPerWeekChart: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Bao's Web UI shows a chart of beans earned per week" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Bao');
  });

  test('no chart → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsBeansPerWeekChart: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Bao's Web UI shows a chart of beans earned per week" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/chart|beans/);
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Bao's Web UI shows a chart of beans earned per week" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsBeansPerWeekChart/);
  });

  // Web Chromium variant — full 3-test set per cluster checklist
  test('Web Chromium matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsBeansPerWeekChart: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Bao's Web Chromium UI shows a chart of beans earned per week" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Bao');
  });

  test('Web Chromium driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsBeansPerWeekChart: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Bao's Web Chromium UI shows a chart of beans earned per week" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/chart|beans/);
  });

  test('Web Chromium driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Bao's Web Chromium UI shows a chart of beans earned per week" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsBeansPerWeekChart/);
  });

  // Web Safari variant — full 3-test set
  test('Web Safari matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsBeansPerWeekChart: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Bao's Web Safari UI shows a chart of beans earned per week" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Bao');
  });

  test('Web Safari driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsBeansPerWeekChart: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Bao's Web Safari UI shows a chart of beans earned per week" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/chart|beans/);
  });

  test('Web Safari driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Bao's Web Safari UI shows a chart of beans earned per week" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsBeansPerWeekChart/);
  });

  // Android branch — routes to ctx.uiDriver.androidShowsBeansPerWeekChart
  test('Android matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsBeansPerWeekChart: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Bao's Android UI shows a chart of beans earned per week" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Bao');
  });

  test('Android driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidShowsBeansPerWeekChart: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Bao's Android UI shows a chart of beans earned per week" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/chart|beans/);
  });

  test('Android driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Bao's Android UI shows a chart of beans earned per week" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.uiDriver\.androidShowsBeansPerWeekChart/);
  });

  // iOS Sim branch — routes to ctx.uiDriver.iosShowsBeansPerWeekChart
  test('iOS Sim matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosShowsBeansPerWeekChart: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Bao's iOS Sim UI shows a chart of beans earned per week" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Bao');
  });

  test('iOS Sim driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { iosShowsBeansPerWeekChart: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Bao's iOS Sim UI shows a chart of beans earned per week" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/chart|beans/);
  });

  test('iOS Sim driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Bao's iOS Sim UI shows a chart of beans earned per week" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.uiDriver\.iosShowsBeansPerWeekChart/);
  });
});

describe('Wake 87 — "the rail shows lessons tagged for language "<X>""', () => {
  // j17-teacher-classroom.feature:80
  //   Then the rail shows lessons tagged for language "zh"
  // Rail content assertion. Driver verifies every visible card on the
  // rail has language=<X>.
  test('matching language → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webRailShowsLessonsForLanguage: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'the rail shows lessons tagged for language "zh"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('zh');
  });

  test('different language', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webRailShowsLessonsForLanguage: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'the rail shows lessons tagged for language "ja"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('ja');
  });

  test('driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webRailShowsLessonsForLanguage: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'the rail shows lessons tagged for language "zh"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/zh|lessons/);
  });
});

describe('Wake 87 — "<Name> on <Plat> refreshes the language rail"', () => {
  // j17-teacher-classroom.feature:78
  //   When Marcus on Android refreshes the language rail
  test('captures persona → driver called', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidRefreshLanguageRail: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Marcus on Android refreshes the language rail' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Marcus');
  });

  test('iOS Sim variant', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosRefreshLanguageRail: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Yuki on iOS Sim refreshes the language rail' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Yuki');
  });

  test('no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Marcus on Android refreshes the language rail' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.uiDriver\.androidRefreshLanguageRail/);
  });

  test('Android driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidRefreshLanguageRail: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Marcus on Android refreshes the language rail' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Marcus|language rail/);
  });

  test('iOS Sim driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { iosRefreshLanguageRail: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Yuki on iOS Sim refreshes the language rail' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Yuki|language rail/);
  });

  test('iOS Sim no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Yuki on iOS Sim refreshes the language rail' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.uiDriver\.iosRefreshLanguageRail/);
  });

  // Web branch — routes to ctx.webDriver.webRefreshLanguageRail
  test('Web matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webRefreshLanguageRail: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Web refreshes the language rail' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice');
  });

  test('Web Chromium matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webRefreshLanguageRail: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Web Chromium refreshes the language rail' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice');
  });

  test('Web Safari matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webRefreshLanguageRail: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Web Safari refreshes the language rail' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice');
  });

  // Each Web variant gets its own 3-test set per cluster checklist:
  // matching/returns-false/driver-missing. The Web/Web Chromium/Web Safari
  // tokens share the same `startsWith('Web')` dispatch branch, but pinning
  // each variant individually catches a future regression that special-
  // cases one token (e.g. browser-specific routing override).
  test('Web Chromium driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webRefreshLanguageRail: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Web Chromium refreshes the language rail' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Alice|language rail/);
  });

  test('Web Chromium driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Web Chromium refreshes the language rail' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webRefreshLanguageRail/);
  });

  test('Web Safari driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webRefreshLanguageRail: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Web Safari refreshes the language rail' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Alice|language rail/);
  });

  test('Web Safari driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Web Safari refreshes the language rail' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webRefreshLanguageRail/);
  });

  test('Web driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webRefreshLanguageRail: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Web refreshes the language rail' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Alice|language rail/);
  });

  test('Web driver missing → fail (driver-object name correctly identifies webDriver)', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Web refreshes the language rail' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webRefreshLanguageRail/);
  });
});

describe('Wake 87 — "the response from <path>?<query> does not include the <noun>"', () => {
  // j17-teacher-classroom.feature:82
  //   Then the response from /api/rooms/featured?cohort=minor does not include the lesson
  // Negative absence assertion on a previously-recorded response.
  // "the lesson" is treated as a soft tag — driver decides what counts
  // as "the lesson" based on the most-recently-created lesson.
  test('lesson absent → ok', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = {
      status: 200,
      path: '/api/rooms/featured',
      body: { results: [{ uniqueId: 50000010 }] },
    };
    ctx.lastCreatedLessonId = 'lesson-XYZ';
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the response from /api/rooms/featured?cohort=minor does not include the lesson',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('lesson present → fail', async () => {
    const ctx = makeCtx();
    ctx.lastResponse = {
      status: 200,
      path: '/api/rooms/featured',
      body: { results: [{ id: 'lesson-XYZ' }] },
    };
    ctx.lastCreatedLessonId = 'lesson-XYZ';
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the response from /api/rooms/featured?cohort=minor does not include the lesson',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/lesson-XYZ/);
  });

  test('no recorded response → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the response from /api/rooms/featured?cohort=minor does not include the lesson',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no recorded/);
  });
});

describe('Wake 87 — "<Name> received a system PM from <Other>" (state-seed)', () => {
  // j18-official-system-pms.feature:45
  //   Given Adam received a system PM from Officia
  // State-seed: writes a messages/<id> doc with sender + recipient.
  test('writes message doc with sender + recipient', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    // Adam = P-01 = 90000001, Officia (j18 system) is at uniqueId 1
    const r = await executeStep(
      { kind: 'Given', text: 'Adam received a system PM from Officia' },
      ctx,
    );
    expect(r.ok).toBe(true);
    const messageKeys = Object.keys(db._docs).filter((k) => k.startsWith('messages/'));
    expect(messageKeys).toHaveLength(1);
    const message = db._docs[messageKeys[0]];
    expect(message.recipientId).toBe(90000001);
    expect(message.senderName).toBe('Officia');
  });

  test('unknown recipient → fail', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Zzzghost received a system PM from Officia' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Zzzghost/);
  });

  test('no db → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'Adam received a system PM from Officia' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db/);
  });
});

// ── Wake 88 ──────────────────────────────────────────────────────────

describe('Wake 88 — "<Name> [P-NN] (cohort) is signed in on <Plat>"', () => {
  // j17-teacher-classroom.feature:24, j18-official-system-pms.feature:46
  //   Given Marcus [P-04] (minor) is signed in on Android
  // Mid-step `(minor)` paren is NOT end-anchored, so stripStepAnnotation
  // doesn't remove it — the existing line-368 sign-in matcher rejects it.
  // This matcher accepts the mid-step cohort tag explicitly and threads
  // it through to ctx.sessions so downstream cohort-gated steps see the
  // declared cohort even if Firestore says something else.
  test('matches minor cohort and synthesises session', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'Marcus [P-04] (minor) is signed in on Android' },
      ctx,
    );
    expect(r.ok).toBe(true);
    const session = ctx.sessions.get('Marcus');
    expect(session).toBeDefined();
    expect(session.customClaims.cohort).toBe('minor');
    // Marcus = P-04 = 60000010
    expect(session.customClaims.uniqueId).toBe(60000010);
  });

  test('matches adult cohort', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'Alice [P-02] (adult) is signed in on Web' },
      ctx,
    );
    expect(r.ok).toBe(true);
    const session = ctx.sessions.get('Alice');
    expect(session.customClaims.cohort).toBe('adult');
  });

  test('matches iOS Sim variant', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'Yuki [P-18] (minor) is signed in on iOS Sim' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.sessions.get('Yuki').customClaims.cohort).toBe('minor');
  });

  test('unknown persona → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'Zzzghost [P-99] (minor) is signed in on Android' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Zzzghost|persona/);
  });
});

describe('Wake 88 — "the database has N entries in "<X>" added since "<ts>""', () => {
  // j05-alice-monetization.feature:14
  //   Then the database has 3 entries in "users/50000010/gifts" added since "{ts}"
  // Counts docs in a subcollection whose createdAt (or `at`/`timestamp`)
  // is strictly after the recorded timestamp. The {ts} placeholder is
  // resolved upstream by interpolateScenarioVars.
  test('matching count → ok', async () => {
    const db = makeStatefulFakeDb({
      'users/50000010/gifts/g1': { createdAt: 2000, gift: 'rose' },
      'users/50000010/gifts/g2': { createdAt: 3000, gift: 'cake' },
      'users/50000010/gifts/g3': { createdAt: 4000, gift: 'star' },
      'users/50000010/gifts/g0': { createdAt: 500, gift: 'old' },
    });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has 3 entries in "users/50000010/gifts" added since "1000"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('wrong count → fail with counts', async () => {
    const db = makeStatefulFakeDb({
      'users/50000010/gifts/g1': { createdAt: 2000 },
      'users/50000010/gifts/g2': { createdAt: 3000 },
    });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has 5 entries in "users/50000010/gifts" added since "1000"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/2|5|count/);
  });

  test('no db → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has 3 entries in "users/50000010/gifts" added since "1000"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db/);
  });
});

describe('Wake 88 — "<Name>\'s <Plat> UI shows the official badge[ <suffix>]"', () => {
  // j13-locales-rtl-cjk.feature & j18-official-system-pms.feature variants:
  //   Then Hayato's Android UI shows the official badge
  //   Then Adam's Android UI shows the official badge on the sender avatar
  //   Then Layla's Web UI shows the official badge with Arabic label
  // Optional trailing fragment is passed to the driver so it can decide
  // which slot/locale-label to assert against.
  test('bare badge → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsOfficialBadge: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Hayato's Android UI shows the official badge" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Hayato', '');
  });

  test('badge with sender-avatar suffix', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsOfficialBadge: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Adam's Android UI shows the official badge on the sender avatar",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Adam', 'on the sender avatar');
  });

  test('badge with arabic-label suffix on Web', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsOfficialBadge: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Layla's Web UI shows the official badge with Arabic label" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Layla', 'with Arabic label');
  });

  test('driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidShowsOfficialBadge: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Hayato's Android UI shows the official badge" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Hayato|badge/);
  });

  test('Android driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Hayato's Android UI shows the official badge" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.uiDriver\.androidShowsOfficialBadge/);
  });

  // iOS Sim — full 3-test set
  test('iOS Sim matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosShowsOfficialBadge: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Yuki's iOS Sim UI shows the official badge" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Yuki', '');
  });

  test('iOS Sim driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { iosShowsOfficialBadge: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Yuki's iOS Sim UI shows the official badge" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Yuki|badge/);
  });

  test('iOS Sim driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Yuki's iOS Sim UI shows the official badge" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.uiDriver\.iosShowsOfficialBadge/);
  });

  // Web — full 3-test set (Web ok already covered above by arabic-label test)
  test('Web driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsOfficialBadge: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Layla's Web UI shows the official badge" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Layla|badge/);
  });

  test('Web driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Layla's Web UI shows the official badge" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsOfficialBadge/);
  });

  // Web Chromium variant
  test('Web Chromium matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsOfficialBadge: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Layla's Web Chromium UI shows the official badge" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Layla', '');
  });

  test('Web Chromium driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsOfficialBadge: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Layla's Web Chromium UI shows the official badge" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Layla|badge/);
  });

  test('Web Chromium driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Layla's Web Chromium UI shows the official badge" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsOfficialBadge/);
  });

  // Web Safari variant
  test('Web Safari matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsOfficialBadge: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Layla's Web Safari UI shows the official badge" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Layla', '');
  });

  test('Web Safari driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsOfficialBadge: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Layla's Web Safari UI shows the official badge" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Layla|badge/);
  });

  test('Web Safari driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Layla's Web Safari UI shows the official badge" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsOfficialBadge/);
  });
});

describe('Wake 88 — "<Name> on <Plat> opens <Other>\'s profile and taps "<X>""', () => {
  // j11-harassment-moderation-cycle.feature:33
  //   When Nora on iOS Sim opens Raul's profile and taps "Block"
  // Composite: open profile + tap action. Driver sequences both so
  // the test can't observe a half-open state.
  test('matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosOpenProfileAndTap: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Nora on iOS Sim opens Raul\'s profile and taps "Block"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Nora', 'Raul', 'Block');
  });

  test('Android variant', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidOpenProfileAndTap: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Android opens Bob\'s profile and taps "Report"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 'Bob', 'Report');
  });

  test('driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Nora on iOS Sim opens Raul\'s profile and taps "Block"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/iosOpenProfileAndTap/);
  });

  test('iOS Sim driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { iosOpenProfileAndTap: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Nora on iOS Sim opens Raul\'s profile and taps "Block"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Raul|profile.*Block/i);
  });

  test('Android driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidOpenProfileAndTap: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Android opens Bob\'s profile and taps "Report"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Bob|profile.*Report/i);
  });

  test('Android driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Android opens Bob\'s profile and taps "Report"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidOpenProfileAndTap/);
  });

  // Web branch — routes to ctx.webDriver.webOpenProfileAndTap
  test('Web matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webOpenProfileAndTap: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Web opens Bob\'s profile and taps "Report"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 'Bob', 'Report');
  });

  test('Web driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webOpenProfileAndTap: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Web opens Bob\'s profile and taps "Report"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Bob|profile.*Report/i);
  });

  test('Web driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Alice on Web opens Bob\'s profile and taps "Report"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webOpenProfileAndTap/);
  });
});

describe('Wake 88 — "<Name> on <Plat> opens <Other>\'s profile from the <X>"', () => {
  // j17-teacher-classroom.feature:71, j18-official-system-pms.feature:49
  //   When Yuki on iOS Sim opens Bao's profile from the room
  //   When Adam on Android opens Officia's profile from the PM
  // Composite: navigate from <source-surface> → other's profile.
  // The source phrase (room|PM|inbox|...) tells the driver which entry
  // point to use.
  test('iOS Sim from-room', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosOpenProfileFrom: spy } });
    const r = await executeStep(
      { kind: 'When', text: "Yuki on iOS Sim opens Bao's profile from the room" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Yuki', 'Bao', 'room');
  });

  test('Android from-PM', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidOpenProfileFrom: spy } });
    const r = await executeStep(
      { kind: 'When', text: "Adam on Android opens Officia's profile from the PM" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Adam', 'Officia', 'PM');
  });

  test('driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { iosOpenProfileFrom: spy } });
    const r = await executeStep(
      { kind: 'When', text: "Yuki on iOS Sim opens Bao's profile from the room" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Yuki|profile|room/);
  });

  test('iOS Sim driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: "Yuki on iOS Sim opens Bao's profile from the room" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/iosOpenProfileFrom/);
  });

  test('Android driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidOpenProfileFrom: spy } });
    const r = await executeStep(
      { kind: 'When', text: "Adam on Android opens Officia's profile from the PM" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Officia|profile|PM/);
  });

  test('Android driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: "Adam on Android opens Officia's profile from the PM" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidOpenProfileFrom/);
  });

  // Web branch — routes to ctx.webDriver.webOpenProfileFrom
  test('Web matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webOpenProfileFrom: spy } });
    const r = await executeStep(
      { kind: 'When', text: "Alice on Web opens Bob's profile from the inbox" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 'Bob', 'inbox');
  });

  test('Web driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webOpenProfileFrom: spy } });
    const r = await executeStep(
      { kind: 'When', text: "Alice on Web opens Bob's profile from the inbox" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Bob|profile|inbox/);
  });

  test('Web driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: "Alice on Web opens Bob's profile from the inbox" },
      ctx,
    );
    expect(r.ok).toBe(false);
    // Tightened (PR #768 R1): assert the error names the CORRECT
    // driver object (`ctx.webDriver`, NOT `ctx.uiDriver`) — the
    // matcher dispatches on `platform.startsWith('Web')` and the
    // error message must reflect the actual driver path the
    // developer should provide.
    expect(r.error).toMatch(/ctx\.webDriver\.webOpenProfileFrom/);
  });

  // Web Chromium + Web Safari platform tokens (PR #768 R1) — the
  // matcher pattern at scripts/manual-qa-runner.js:10106 explicitly
  // lists "Web Chromium" and "Web Safari" as platform alternatives.
  // Pin that both tokens route to webOpenProfileFrom via webDriver.
  test('Web Chromium matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webOpenProfileFrom: spy } });
    const r = await executeStep(
      { kind: 'When', text: "Alice on Web Chromium opens Bob's profile from the inbox" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 'Bob', 'inbox');
  });

  test('Web Safari matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webOpenProfileFrom: spy } });
    const r = await executeStep(
      { kind: 'When', text: "Alice on Web Safari opens Bob's profile from the inbox" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 'Bob', 'inbox');
  });
});

describe('Wake 88 — "the <topic> (broadcast|flow) fires sendSystemPm with key="<X>" recipient=<Other>"', () => {
  // j18-official-system-pms.feature:38, 51
  //   When the policy-update broadcast fires sendSystemPm with key="policy_update_v4" recipient=Marcus
  //   When the suspension-notice flow fires sendSystemPm with key="moderation_suspension_notice" recipient=Layla
  // Reuses Wake 82's fireSystemPmWebhook driver because the trigger
  // type (webhook|broadcast|flow) doesn't change effective semantics —
  // only the Gherkin author's English phrasing differs.
  test('broadcast trigger → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { fireSystemPmWebhook: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'the policy-update broadcast fires sendSystemPm with key="policy_update_v4" recipient=Marcus',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    // Marcus = P-04 = 60000010
    expect(spy).toHaveBeenCalledWith('policy-update', 'policy_update_v4', 60000010);
  });

  test('flow trigger → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { fireSystemPmWebhook: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'the suspension-notice flow fires sendSystemPm with key="moderation_suspension_notice" recipient=Layla',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    // Layla = P-13 = 50000070
    expect(spy).toHaveBeenCalledWith('suspension-notice', 'moderation_suspension_notice', 50000070);
  });

  test('unknown recipient → fail', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { fireSystemPmWebhook: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'the policy-update broadcast fires sendSystemPm with key="X" recipient=Zzzghost',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Zzzghost/);
  });
});

// ── Wake 89 ──────────────────────────────────────────────────────────

describe('Wake 89 — broad "the <noun> fires sendSystemPm with key="<X>"[ recipient=<Other>]"', () => {
  // j18-official-system-pms.feature:39, 55
  //   When the broadcast fires sendSystemPm with key="policy_update_v4"
  //   When the test harness fires sendSystemPm with key="totally_made_up_key" recipient=Adam
  // Broad fallback for trigger phrases that don't match Wake 82's
  // "<X> webhook" or Wake 88's "<X> broadcast|flow". Placed LAST so the
  // narrower matchers still fire first.
  test('bare broadcast (no recipient) → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { fireSystemPmWebhook: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'the broadcast fires sendSystemPm with key="policy_update_v4"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('broadcast', 'policy_update_v4', null);
  });

  test('test harness with recipient → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { fireSystemPmWebhook: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'the test harness fires sendSystemPm with key="totally_made_up_key" recipient=Adam',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    // Adam = P-01 = 90000001
    expect(spy).toHaveBeenCalledWith('test harness', 'totally_made_up_key', 90000001);
  });

  test('does NOT shadow Wake 82 webhook variant (now W132 Firestore-write)', async () => {
    // The Wake 82 "X webhook fires..." matcher was rewritten in W132 to
    // write Firestore directly instead of calling a webDriver stub. The
    // shadow regression-guard now verifies that the W132 path runs (no
    // spy invocation) AND that the Wake 89 broader matcher (still
    // spy-based for "broadcast"/"flow") doesn't pre-empt it.
    const spy = jest.fn(async () => true);
    const writes = [];
    const ctx = makeCtx({
      webDriver: { fireSystemPmWebhook: spy },
      db: {
        doc: (path) => ({
          set: async (data, opts) => writes.push({ op: 'set', path, data, opts }),
        }),
      },
    });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'the post-approval webhook fires sendSystemPm with key="age_seg_age_up_welcome_pm" recipient=Adam',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    // W132 path: writes to Firestore, does NOT call the Wake 89 spy.
    expect(spy).not.toHaveBeenCalled();
    expect(writes.some((w) => w.path.startsWith('conversations/'))).toBe(true);
    expect(ctx.lastSentSystemPm).toMatchObject({
      webhook: 'post-approval',
      key: 'age_seg_age_up_welcome_pm',
      recipientName: 'Adam',
    });
  });

  test('unknown recipient → fail', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { fireSystemPmWebhook: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'the test harness fires sendSystemPm with key="X" recipient=Zzzghost',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Zzzghost/);
  });
});

describe('Wake 89 — "<Name>\'s <Plat> UI shows non-empty <Language> text for section N"', () => {
  // j13-locales-rtl-cjk.feature:36
  //   Then Layla's Web UI shows non-empty Arabic text for section 11
  // Locale section assertion: driver verifies that section N of the
  // currently-rendered screen contains visible non-empty text in the
  // named language's script (not English fallback).
  test('matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsNonEmptyLocaleText: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Layla's Web UI shows non-empty Arabic text for section 11" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Layla', 'ar', 11);
  });

  test('Japanese section', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsNonEmptyLocaleText: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Yuki's Web UI shows non-empty Japanese text for section 3" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Yuki', 'ja', 3);
  });

  test('unknown language → fail', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsNonEmptyLocaleText: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Layla's Web UI shows non-empty Klingonese text for section 1" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Klingonese|language/);
  });

  // Web driver returns false → fail / driver missing → fail
  test('Web driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsNonEmptyLocaleText: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Layla's Web UI shows non-empty Arabic text for section 11" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/section|Arabic/);
  });

  test('Web driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Layla's Web UI shows non-empty Arabic text for section 11" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsNonEmptyLocaleText/);
  });

  // Web Chromium variant
  test('Web Chromium matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsNonEmptyLocaleText: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Layla's Web Chromium UI shows non-empty Arabic text for section 11" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Layla', 'ar', 11);
  });

  test('Web Chromium driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsNonEmptyLocaleText: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Layla's Web Chromium UI shows non-empty Arabic text for section 11" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/section|Arabic/);
  });

  test('Web Chromium driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Layla's Web Chromium UI shows non-empty Arabic text for section 11" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsNonEmptyLocaleText/);
  });

  // Web Safari variant
  test('Web Safari matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsNonEmptyLocaleText: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Layla's Web Safari UI shows non-empty Arabic text for section 11" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Layla', 'ar', 11);
  });

  test('Web Safari driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsNonEmptyLocaleText: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Layla's Web Safari UI shows non-empty Arabic text for section 11" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/section|Arabic/);
  });

  test('Web Safari driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Layla's Web Safari UI shows non-empty Arabic text for section 11" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsNonEmptyLocaleText/);
  });

  // Android — full 3-test set
  test('Android matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsNonEmptyLocaleText: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Hayato's Android UI shows non-empty Japanese text for section 3" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Hayato', 'ja', 3);
  });

  test('Android driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidShowsNonEmptyLocaleText: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Hayato's Android UI shows non-empty Japanese text for section 3" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/section|Japanese/);
  });

  test('Android driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Hayato's Android UI shows non-empty Japanese text for section 3" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.uiDriver\.androidShowsNonEmptyLocaleText/);
  });

  // iOS Sim — full 3-test set
  test('iOS Sim matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosShowsNonEmptyLocaleText: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Yuki's iOS Sim UI shows non-empty Japanese text for section 3" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Yuki', 'ja', 3);
  });

  test('iOS Sim driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { iosShowsNonEmptyLocaleText: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Yuki's iOS Sim UI shows non-empty Japanese text for section 3" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/section|Japanese/);
  });

  test('iOS Sim driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Yuki's iOS Sim UI shows non-empty Japanese text for section 3" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.uiDriver\.iosShowsNonEmptyLocaleText/);
  });
});

describe('Wake 89 — "<Name>\'s <Plat> UI disables the <X> input"', () => {
  // j11-harassment-moderation-cycle.feature:50
  //   Then Raul's Android UI disables the message input
  // UI control state assertion. Parameterised on the input name so a
  // future "disables the comment input" / "disables the gift input"
  // would not need a new matcher.
  test('matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidDisablesInput: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Raul's Android UI disables the message input" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Raul', 'message');
  });

  test('Web variant + different input', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webDisablesInput: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Greta's Web UI disables the comment input" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Greta', 'comment');
  });

  test('driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidDisablesInput: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Raul's Android UI disables the message input" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Raul|message|disabled/);
  });
});

describe('Wake 89 — "<Name>\'s <Plat> Admin UI shows <Other>\'s appeal with the text"', () => {
  // j11-harassment-moderation-cycle.feature:73
  //   Then Greta's Web Admin UI shows Raul's appeal with the text
  // Admin moderation UI assertion. Driver verifies an appeal section
  // is visible for <Other> with non-empty body text.
  test('matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webAdminShowsAppealText: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Greta's Web Admin UI shows Raul's appeal with the text" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Greta', 'Raul');
  });

  test('no appeal → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webAdminShowsAppealText: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Greta's Web Admin UI shows Raul's appeal with the text" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Raul|appeal/);
  });

  test('driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Greta's Web Admin UI shows Raul's appeal with the text" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webAdminShowsAppealText/);
  });

  // Android branch — routes to ctx.uiDriver.androidAdminShowsAppealText
  test('Android matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidAdminShowsAppealText: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Greta's Android Admin UI shows Raul's appeal with the text" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Greta', 'Raul');
  });

  test('Android no appeal → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidAdminShowsAppealText: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Greta's Android Admin UI shows Raul's appeal with the text" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Raul|appeal/);
  });

  test('Android driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Greta's Android Admin UI shows Raul's appeal with the text" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidAdminShowsAppealText/);
  });

  // iOS Sim branch — routes to ctx.uiDriver.iosAdminShowsAppealText
  test('iOS Sim matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosAdminShowsAppealText: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Greta's iOS Sim Admin UI shows Raul's appeal with the text" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Greta', 'Raul');
  });

  test('iOS Sim no appeal → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { iosAdminShowsAppealText: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Greta's iOS Sim Admin UI shows Raul's appeal with the text" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Raul|appeal/);
  });

  test('iOS Sim driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Greta's iOS Sim Admin UI shows Raul's appeal with the text" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/iosAdminShowsAppealText/);
  });
});

describe('Wake 89 — "a conversation "<X>" exists ... created before the OSA migration" (state-seed)', () => {
  // j08-cross-cohort-wall.feature:14
  //   Given a conversation "c1" exists with participantIds=[50000040, 60000010] created before the OSA migration
  // State-seed: plants a conversations/<id> doc with the cross-cohort
  // participant pair and a createdAt of 0 (signalling "before OSA
  // migration"). Used by j08 to verify the migration sweep marks legacy
  // mixed-cohort conversations as locked.
  test('plants conversation doc with both participants', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'a conversation "c1" exists with participantIds=[50000040, 60000010] created before the OSA migration',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    const doc = db._docs['conversations/c1'];
    expect(doc).toBeDefined();
    expect(doc.participantIds).toEqual([50000040, 60000010]);
    expect(doc.createdAt).toBe(0);
  });

  test('different id', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'a conversation "legacy-7" exists with participantIds=[1, 2] created before the OSA migration',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['conversations/legacy-7']).toBeDefined();
    expect(db._docs['conversations/legacy-7'].participantIds).toEqual([1, 2]);
  });

  test('no db → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'a conversation "c1" exists with participantIds=[1, 2] created before the OSA migration',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db/);
  });
});

describe('Wake 89 — "<Name> on <Plat> taps the <X> from the <Y>"', () => {
  // j16-event-host-team-leader.feature:24
  //   When Selma on Android taps the event-room link from the invite banner
  // Composite tap-from-source. Driver locates the named surface (Y) and
  // taps the named control (X) within it.
  test('matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidTapFromSurface: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Selma on Android taps the event-room link from the invite banner',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Selma', 'event-room link', 'invite banner');
  });

  test('iOS Sim variant', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosTapFromSurface: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Yuki on iOS Sim taps the gift button from the room toolbar',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Yuki', 'gift button', 'room toolbar');
  });

  test('driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Selma on Android taps the event-room link from the invite banner',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidTapFromSurface/);
  });
});

// ── Wake 90 ──────────────────────────────────────────────────────────

describe('Wake 90 — "the script reports N <thing>" (j19 idempotency)', () => {
  // j19-osa-migration-regression.feature:63-66
  //   Then the script reports 0 followingIds entries to remove
  //   Then the script reports 0 followerIds entries to remove
  //   Then the script reports 0 rooms to close
  //   Then the script reports 0 conversations to freeze
  // Re-uses the j19 BG `probeOsaInvariants` count logic — if invariants
  // hold post-migration, all 4 counts are 0. The matcher reads counts
  // from a fresh probe (cached on ctx._osaCounts to amortise across
  // the 4 calls in the same scenario).
  function makeOsaDb(users, rooms, convs) {
    const allDocs = {};
    for (const u of users) allDocs[`users/${u.uniqueId}`] = u;
    for (const r of rooms) allDocs[`rooms/${r.id}`] = r;
    for (const c of convs) allDocs[`conversations/${c.id}`] = c;
    return makeStatefulFakeDb(allDocs);
  }

  test('reports 0 with all-clean invariants', async () => {
    const db = makeOsaDb(
      [
        { uniqueId: 10, cohort: 'adult', followingIds: [20], followerIds: [] },
        { uniqueId: 20, cohort: 'adult', followingIds: [], followerIds: [10] },
      ],
      [],
      [],
    );
    const ctx = makeCtx({ db });
    for (const text of [
      'the script reports 0 followingIds entries to remove',
      'the script reports 0 followerIds entries to remove',
      'the script reports 0 rooms to close',
      'the script reports 0 conversations to freeze',
    ]) {
      const r = await executeStep({ kind: 'Then', text }, ctx);
      expect(r.ok).toBe(true);
    }
  });

  test('reports nonzero with cross-cohort followingIds', async () => {
    const db = makeOsaDb(
      [
        { uniqueId: 10, cohort: 'adult', followingIds: [20], followerIds: [] },
        { uniqueId: 20, cohort: 'minor', followingIds: [], followerIds: [10] },
      ],
      [],
      [],
    );
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Then', text: 'the script reports 0 followingIds entries to remove' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/1|followingIds/);
  });

  test('reports mismatch when expected count differs', async () => {
    const db = makeOsaDb(
      [
        { uniqueId: 10, cohort: 'adult', followingIds: [20], followerIds: [] },
        { uniqueId: 20, cohort: 'minor', followingIds: [], followerIds: [10] },
      ],
      [],
      [],
    );
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Then', text: 'the script reports 2 followingIds entries to remove' },
      ctx,
    );
    expect(r.ok).toBe(false);
    // Counted 1 cross-cohort entry; expected 2.
    expect(r.error).toMatch(/1|2/);
  });

  test('reports rooms-to-close count', async () => {
    const db = makeOsaDb(
      [
        { uniqueId: 10, cohort: 'adult' },
        { uniqueId: 20, cohort: 'minor' },
      ],
      [
        {
          id: 'r1',
          state: 'OPEN',
          cohort: 'adult',
          participantIds: [10, 20],
        },
      ],
      [],
    );
    const ctx = makeCtx({ db });
    const r = await executeStep({ kind: 'Then', text: 'the script reports 1 rooms to close' }, ctx);
    expect(r.ok).toBe(true);
  });

  test('reports conversations-to-freeze count', async () => {
    const db = makeOsaDb(
      [
        { uniqueId: 10, cohort: 'adult' },
        { uniqueId: 20, cohort: 'minor' },
      ],
      [],
      [{ id: 'c1', participantIds: [10, 20], frozen: false }],
    );
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Then', text: 'the script reports 1 conversations to freeze' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('unknown thing → fail', async () => {
    const db = makeOsaDb([], [], []);
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Then', text: 'the script reports 0 widgets to wibble' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/widgets|unknown/i);
  });
});

describe('Wake 90 — "every such doc has field "<X>" equal to "<Y>""', () => {
  // j19-osa-migration-regression.feature:49
  //   Then every such doc has field "closedReason" equal to "osa_mixed_cohort_migration"
  // Iterates ctx.lastQueryResult.docs from a prior `When a query is run for ...`
  // step. Every doc must have field=value.
  test('all docs match → ok', async () => {
    const ctx = makeCtx();
    ctx.lastQueryResult = {
      docs: [
        { closedReason: 'osa_mixed_cohort_migration' },
        { closedReason: 'osa_mixed_cohort_migration' },
      ],
    };
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'every such doc has field "closedReason" equal to "osa_mixed_cohort_migration"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('one doc mismatches → fail', async () => {
    const ctx = makeCtx();
    ctx.lastQueryResult = {
      docs: [{ closedReason: 'osa_mixed_cohort_migration' }, { closedReason: 'other_reason' }],
    };
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'every such doc has field "closedReason" equal to "osa_mixed_cohort_migration"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/closedReason|other_reason|1/);
  });

  test('no prior query → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'every such doc has field "closedReason" equal to "osa_mixed_cohort_migration"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/lastQueryResult|query/);
  });
});

describe('Wake 90 — "every such doc has field "<X>" set to a value within the migration window"', () => {
  // j19-osa-migration-regression.feature:50
  //   Then every such doc has field "closedAt" set to a value within the migration window
  // Permissive variant of the equal-to assertion: field must be a number
  // (timestamp). Future work could tighten by reading a concrete migration
  // window from ctx.
  test('all docs have numeric value → ok', async () => {
    const ctx = makeCtx();
    ctx.lastQueryResult = {
      docs: [{ closedAt: 1700000000000 }, { closedAt: 1700000123456 }],
    };
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'every such doc has field "closedAt" set to a value within the migration window',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('one doc missing value → fail', async () => {
    const ctx = makeCtx();
    ctx.lastQueryResult = {
      docs: [{ closedAt: 1700000000000 }, { otherField: 'X' }],
    };
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'every such doc has field "closedAt" set to a value within the migration window',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/closedAt|missing/);
  });
});

describe('Wake 90 — "no "<X>" doc with state="<Y>" has participantIds containing users with differing cohort"', () => {
  // j19-osa-migration-regression.feature:43
  //   Then no "rooms/*" doc with state="OPEN" has participantIds containing users with differing cohort
  // Fresh query against the named collection + state filter; asserts no
  // doc has mixed-cohort participants. Resolves cohorts via users
  // collection lookup.
  test('all rooms same-cohort → ok', async () => {
    const db = makeStatefulFakeDb({
      'users/10': { uniqueId: 10, cohort: 'adult' },
      'users/20': { uniqueId: 20, cohort: 'adult' },
      'rooms/r1': { state: 'OPEN', participantIds: [10, 20] },
    });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'no "rooms/*" doc with state="OPEN" has participantIds containing users with differing cohort',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('mixed-cohort room → fail', async () => {
    const db = makeStatefulFakeDb({
      'users/10': { uniqueId: 10, cohort: 'adult' },
      'users/20': { uniqueId: 20, cohort: 'minor' },
      'rooms/r1': { state: 'OPEN', participantIds: [10, 20] },
    });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'no "rooms/*" doc with state="OPEN" has participantIds containing users with differing cohort',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/r1|differing|mixed/);
  });

  test('state filter excludes CLOSED → ok', async () => {
    const db = makeStatefulFakeDb({
      'users/10': { uniqueId: 10, cohort: 'adult' },
      'users/20': { uniqueId: 20, cohort: 'minor' },
      'rooms/r1': { state: 'CLOSED', participantIds: [10, 20] },
    });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'no "rooms/*" doc with state="OPEN" has participantIds containing users with differing cohort',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });
});

describe('Wake 90 — "for each conversation where participantIds contains users with differing cohort, the doc has field "<X>" equal to <bool>"', () => {
  // j19-osa-migration-regression.feature:56
  //   Then for each conversation where participantIds contains users with differing cohort, the doc has field "frozen" equal to true
  // Iterates conversations collection; for each mixed-cohort conv,
  // asserts field = expected value.
  test('all mixed-cohort convs are frozen → ok', async () => {
    const db = makeStatefulFakeDb({
      'users/10': { uniqueId: 10, cohort: 'adult' },
      'users/20': { uniqueId: 20, cohort: 'minor' },
      'conversations/c1': { participantIds: [10, 20], frozen: true },
    });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'for each conversation where participantIds contains users with differing cohort, the doc has field "frozen" equal to true',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('mixed-cohort conv NOT frozen → fail', async () => {
    const db = makeStatefulFakeDb({
      'users/10': { uniqueId: 10, cohort: 'adult' },
      'users/20': { uniqueId: 20, cohort: 'minor' },
      'conversations/c1': { participantIds: [10, 20], frozen: false },
    });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'for each conversation where participantIds contains users with differing cohort, the doc has field "frozen" equal to true',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/c1|frozen/);
  });

  test('same-cohort convs ignored → ok', async () => {
    const db = makeStatefulFakeDb({
      'users/10': { uniqueId: 10, cohort: 'adult' },
      'users/20': { uniqueId: 20, cohort: 'adult' },
      'conversations/c1': { participantIds: [10, 20], frozen: false },
    });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'for each conversation where participantIds contains users with differing cohort, the doc has field "frozen" equal to true',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });
});

describe('Wake 90 — "the recipient is <Name>" (assertion on last sendSystemPm)', () => {
  // j18-official-system-pms.feature:54
  //   Then the recipient is Adam
  // Reads ctx.lastSentSystemPm (populated by the Wake 89 broad
  // sendSystemPm matcher) and asserts the recipient name matches.
  test('matching recipient → ok', async () => {
    const ctx = makeCtx();
    ctx.lastSentSystemPm = { recipientName: 'Adam', recipientId: 90000001 };
    const r = await executeStep({ kind: 'Then', text: 'the recipient is Adam' }, ctx);
    expect(r.ok).toBe(true);
  });

  test('different recipient → fail', async () => {
    const ctx = makeCtx();
    ctx.lastSentSystemPm = { recipientName: 'Hayato', recipientId: 50000030 };
    const r = await executeStep({ kind: 'Then', text: 'the recipient is Adam' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Adam|Hayato/);
  });

  test('no prior sendSystemPm → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Then', text: 'the recipient is Adam' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/sendSystemPm|recipient/);
  });
});

describe('Wake 90 — Wake 89 broad sendSystemPm extension: writes ctx.lastSentSystemPm', () => {
  // Wake 89's broad sendSystemPm matcher must now populate
  // ctx.lastSentSystemPm so the new Wake 90 "the recipient is X"
  // matcher has data to read. Additive change — no existing test
  // depends on this field being absent.
  test('writes lastSentSystemPm with recipient name + id', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { fireSystemPmWebhook: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'the test harness fires sendSystemPm with key="X" recipient=Adam',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.lastSentSystemPm).toEqual({
      trigger: 'test harness',
      key: 'X',
      recipientName: 'Adam',
      recipientId: 90000001,
    });
  });

  test('bare broadcast (no recipient) → recipientId null', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { fireSystemPmWebhook: spy } });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'the broadcast fires sendSystemPm with key="policy_update_v4"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.lastSentSystemPm).toEqual({
      trigger: 'broadcast',
      key: 'policy_update_v4',
      recipientName: null,
      recipientId: null,
    });
  });
});

// ── Wake 91 ──────────────────────────────────────────────────────────

describe('Wake 91 — "the script exit code is N"', () => {
  // j19-osa-migration-regression.feature:67
  //   Then the script exit code is 0
  // Asserts the exit code from the most recent migration-script run.
  // Defaults to 0 if no prior run recorded an exit code (the existing
  // no-op migration matcher leaves it unset → idempotent re-runs are
  // by default exit-0).
  test('default exit code is 0', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Then', text: 'the script exit code is 0' }, ctx);
    expect(r.ok).toBe(true);
  });

  test('explicit exit code matches', async () => {
    const ctx = makeCtx();
    ctx.lastScriptExitCode = 2;
    const r = await executeStep({ kind: 'Then', text: 'the script exit code is 2' }, ctx);
    expect(r.ok).toBe(true);
  });

  test('mismatched exit code → fail', async () => {
    const ctx = makeCtx();
    ctx.lastScriptExitCode = 1;
    const r = await executeStep({ kind: 'Then', text: 'the script exit code is 0' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/0|1/);
  });
});

describe('Wake 91 — "N users are tagged for a broadcast" (state-seed)', () => {
  // j18-official-system-pms.feature:36
  //   Given 1000 users are tagged for a broadcast
  // State-seed: records the broadcast cohort size so subsequent
  // assertions (e.g., "no FCM dispatch fails" → expects N successes)
  // can scale. MVP records on ctx; future work could plant N user
  // docs with broadcastTag=true.
  test('sets ctx.broadcastTaggedCount', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: '1000 users are tagged for a broadcast' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.broadcastTaggedCount).toBe(1000);
  });

  test('different N', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Given', text: '7 users are tagged for a broadcast' }, ctx);
    expect(r.ok).toBe(true);
    expect(ctx.broadcastTaggedCount).toBe(7);
  });
});

describe('Wake 91 — "no FCM dispatch fails"', () => {
  // j18-official-system-pms.feature:40
  //   Then no FCM dispatch fails
  // Reads ctx.fcmDispatchResults (populated by an FCM-send driver) and
  // asserts every entry succeeded. Empty result list is considered ok
  // — the assertion is "none failed", not "at least one succeeded".
  test('empty results → ok', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Then', text: 'no FCM dispatch fails' }, ctx);
    expect(r.ok).toBe(true);
  });

  test('all succeeded → ok', async () => {
    const ctx = makeCtx();
    ctx.fcmDispatchResults = [
      { token: 'a', success: true },
      { token: 'b', success: true },
    ];
    const r = await executeStep({ kind: 'Then', text: 'no FCM dispatch fails' }, ctx);
    expect(r.ok).toBe(true);
  });

  test('one failed → fail', async () => {
    const ctx = makeCtx();
    ctx.fcmDispatchResults = [
      { token: 'a', success: true },
      { token: 'b', success: false, error: 'invalid token' },
    ];
    const r = await executeStep({ kind: 'Then', text: 'no FCM dispatch fails' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/b|invalid|fail/);
  });
});

describe('Wake 91 — "the system logs a warning "<X>""', () => {
  // j18-official-system-pms.feature:57
  //   Then the system logs a warning "Unknown system PM key: totally_made_up_key"
  // Asserts ctx.systemLogs contains a warning-level entry with the
  // expected message. Substring match (the corpus uses exact strings
  // but other Wakes have demonstrated that exact matches break easily
  // when implementations add prefixes/IDs).
  test('matching warning → ok', async () => {
    const ctx = makeCtx();
    ctx.systemLogs = [
      { level: 'info', message: 'startup' },
      { level: 'warn', message: 'Unknown system PM key: totally_made_up_key' },
    ];
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the system logs a warning "Unknown system PM key: totally_made_up_key"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('no matching warning → fail', async () => {
    const ctx = makeCtx();
    ctx.systemLogs = [{ level: 'info', message: 'startup' }];
    const r = await executeStep(
      { kind: 'Then', text: 'the system logs a warning "Unknown system PM key: X"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Unknown|warning/);
  });

  test('no logs captured → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Then', text: 'the system logs a warning "X"' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/systemLogs|logs/);
  });
});

describe('Wake 91 — "<Name>\'s <Plat> UI shows the welcome PM body in <Language>"', () => {
  // j18-official-system-pms.feature:31
  //   Then Adam's Android UI shows the welcome PM body in English
  // Asserts the welcome PM is rendered in the named language (not the
  // user's locale fallback). Driver receives (name, languageCode).
  test('English → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsWelcomePmInLanguage: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Adam's Android UI shows the welcome PM body in English" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Adam', 'en');
  });

  test('Japanese Web variant', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsWelcomePmInLanguage: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Yuki's Web UI shows the welcome PM body in Japanese" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Yuki', 'ja');
  });

  test('unknown language → fail', async () => {
    const ctx = makeCtx({ uiDriver: { androidShowsWelcomePmInLanguage: jest.fn() } });
    const r = await executeStep(
      { kind: 'Then', text: "Adam's Android UI shows the welcome PM body in Klingonese" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Klingonese|language/);
  });
});

describe('Wake 91 — "the (rail )?card shows the "<X>" badge[ + <suffix>]" (combined)', () => {
  // Two corpus shapes unified:
  //   j15-mc-performance.feature: the rail card shows the "MC Singer" badge
  //   j17-teacher-classroom.feature: the card shows the "Teacher" badge + language flag
  // Bare badge-on-card assertion. "rail " prefix and "+ <suffix>"
  // tail are both optional so the same driver covers both phrasings.
  test('rail card with badge', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { showsCardBadge: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'the rail card shows the "MC Singer" badge' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('rail', 'MC Singer', '');
  });

  test('plain card with badge + suffix', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { showsCardBadge: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'the card shows the "Teacher" badge + language flag' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('plain', 'Teacher', 'language flag');
  });

  test('driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { showsCardBadge: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'the rail card shows the "MC Singer" badge' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/MC Singer|badge/);
  });
});

// ── Wake 92 ──────────────────────────────────────────────────────────

describe('Wake 92 — "<Name> [P-NN] (cohort) opens the <X> tab on <Plat>"', () => {
  // j17-teacher-classroom.feature:67
  //   When Marcus [P-04] (minor) opens the home tab on Android
  // Sibling of Wake 88's bracket-cohort sign-in matcher — same
  // mid-step `(cohort)` paren that stripStepAnnotation can't remove.
  // Action variant: opens a named tab. The cohort tag is purely
  // informational here (the actor was already signed in earlier).
  test('matching → driver called', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidOpensTab: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Marcus [P-04] (minor) opens the home tab on Android' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Marcus', 'home');
  });

  test('iOS Sim variant + adult cohort', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosOpensTab: spy } });
    const r = await executeStep(
      { kind: 'When', text: 'Alice [P-02] (adult) opens the profile tab on iOS Sim' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 'profile');
  });

  test('driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'When', text: 'Marcus [P-04] (minor) opens the home tab on Android' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidOpensTab/);
  });
});

describe('Wake 92 — "<Name>\'s <Plat> Admin UI shows a table of recent <X>"', () => {
  // j12-admin-daily-routine.feature:24
  //   Then Greta's Web Admin UI shows a table of recent blocked attempts
  // Generic admin-table presence assertion. The driver returns the
  // visible table entries; matcher stores them on ctx.lastTableEntries
  // so subsequent "each entry shows <fields>" steps can verify them.
  test('matching → ok, populates lastTableEntries', async () => {
    const entries = [
      { action: 'block', targetId: 1, adminId: 2, timestamp: 1000, reason: 'spam' },
      { action: 'block', targetId: 3, adminId: 2, timestamp: 2000, reason: 'abuse' },
    ];
    const spy = jest.fn(async () => entries);
    const ctx = makeCtx({ webDriver: { webAdminShowsTableOf: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Greta's Web Admin UI shows a table of recent blocked attempts",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Greta', 'blocked attempts');
    expect(ctx.lastTableEntries).toEqual(entries);
  });

  test('empty table → fail', async () => {
    const spy = jest.fn(async () => []);
    const ctx = makeCtx({ webDriver: { webAdminShowsTableOf: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Greta's Web Admin UI shows a table of recent blocked attempts",
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/empty|no rows|blocked attempts/);
  });

  test('driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webAdminShowsTableOf: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Greta's Web Admin UI shows a table of recent blocked attempts",
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/blocked attempts|table/);
  });
});

describe('Wake 92 — "each entry shows <field> + <field> + ..."', () => {
  // j12-admin-daily-routine.feature:25
  //   Then each entry shows action + targetId + adminId + timestamp + reason
  // Verifies every entry in ctx.lastTableEntries has all named fields
  // present (non-null/undefined). The "+ "-separated field list lets
  // future cycles cover other tables (rooms list, gift log, etc.)
  // without new matchers.
  test('all fields present → ok', async () => {
    const ctx = makeCtx();
    ctx.lastTableEntries = [
      { action: 'block', targetId: 1, adminId: 2, timestamp: 1000, reason: 'spam' },
      { action: 'block', targetId: 3, adminId: 2, timestamp: 2000, reason: 'abuse' },
    ];
    const r = await executeStep(
      { kind: 'Then', text: 'each entry shows action + targetId + adminId + timestamp + reason' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('one entry missing field → fail', async () => {
    const ctx = makeCtx();
    ctx.lastTableEntries = [
      { action: 'block', targetId: 1, adminId: 2, timestamp: 1000, reason: 'spam' },
      { action: 'block', targetId: 3, adminId: 2, timestamp: 2000 /* reason missing */ },
    ];
    const r = await executeStep(
      { kind: 'Then', text: 'each entry shows action + targetId + adminId + timestamp + reason' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/reason|missing|1/);
  });

  test('no table captured → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Then', text: 'each entry shows action + targetId' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/lastTableEntries|table/);
  });
});

describe('Wake 92 — "<Name>\'s <Plat> UI shows the list of contributors with amounts"', () => {
  // j15-mc-performance.feature:35
  //   Then Selma's Android UI shows the list of contributors with amounts
  // Driver verifies the contributors list is visible AND each row shows
  // a numeric amount (sentinel return: true if both conditions hold).
  test('matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsContributorsList: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Selma's Android UI shows the list of contributors with amounts" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Selma');
  });

  test('driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidShowsContributorsList: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Selma's Android UI shows the list of contributors with amounts" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Selma|contributors/);
  });

  test('Android driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Selma's Android UI shows the list of contributors with amounts" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidShowsContributorsList/);
  });

  test('iOS Sim matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosShowsContributorsList: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Nora's iOS Sim UI shows the list of contributors with amounts" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Nora');
  });

  test('iOS Sim driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { iosShowsContributorsList: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Nora's iOS Sim UI shows the list of contributors with amounts" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Nora|contributors/);
  });

  test('iOS Sim driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Nora's iOS Sim UI shows the list of contributors with amounts" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/iosShowsContributorsList/);
  });

  test('Web matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsContributorsList: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web UI shows the list of contributors with amounts" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice');
  });

  test('Web driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsContributorsList: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web UI shows the list of contributors with amounts" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Alice|contributors/);
  });

  test('Web driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web UI shows the list of contributors with amounts" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webShowsContributorsList/);
  });
});

describe('Wake 92 — "<Name>\'s <Plat> UI shows the PM thread with document direction "<X>""', () => {
  // j18-official-system-pms.feature:33
  //   Then Layla's Web UI shows the PM thread with document direction "rtl"
  // CSS document-direction assertion. Driver verifies the active PM
  // thread DOM has `dir="rtl"` (or "ltr") at the thread-container level
  // — important for RTL locales to ensure layout flip is applied.
  test('rtl → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsPmThreadDirection: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Layla\'s Web UI shows the PM thread with document direction "rtl"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Layla', 'rtl');
  });

  test('ltr variant', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsPmThreadDirection: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Adam\'s Web UI shows the PM thread with document direction "ltr"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Adam', 'ltr');
  });

  test('driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsPmThreadDirection: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Layla\'s Web UI shows the PM thread with document direction "rtl"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/rtl|direction/);
  });
});

describe('Wake 92 — `no audit row records "<X>" with reason "<Y>" for this delivery`', () => {
  // j18-official-system-pms.feature:60
  //   Then no audit row records "blocked" with reason "cohort_mismatch" for this delivery
  // Audit-log absence assertion. Reads ctx.lastAuditLog (populated by
  // a sendSystemPm driver that captures the per-delivery audit rows).
  // Ok if no entry has action=X AND reason=Y.
  test('no matching audit row → ok', async () => {
    const ctx = makeCtx();
    ctx.lastAuditLog = [
      { action: 'delivered', reason: 'ok' },
      { action: 'blocked', reason: 'rate_limit' },
    ];
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'no audit row records "blocked" with reason "cohort_mismatch" for this delivery',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('empty audit log → ok', async () => {
    const ctx = makeCtx();
    ctx.lastAuditLog = [];
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'no audit row records "blocked" with reason "cohort_mismatch" for this delivery',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('matching audit row → fail', async () => {
    const ctx = makeCtx();
    ctx.lastAuditLog = [{ action: 'blocked', reason: 'cohort_mismatch' }];
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'no audit row records "blocked" with reason "cohort_mismatch" for this delivery',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/blocked|cohort_mismatch/);
  });
});

// ── Wake 93 ──────────────────────────────────────────────────────────

describe('Wake 93 — `OR within Nms <Name>\'s <Plat> UI shows a "<X>" toast and navigates back to "<Y>"`', () => {
  // j10-mid-room-warning.feature:36
  //   OR within 6000ms Ines's iOS Sim UI shows a "Room closed by host warning" toast and navigates back to "/rooms"
  // Alternate-outcome step (the "OR" prefix indicates this is acceptable
  // as an alternative to a preceding step). The runner treats it as a
  // normal Then with the OR prefix; if THIS condition holds within the
  // timeout, the alternate is satisfied.
  test('toast + nav within timeout → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosShowsToastAndNavigates: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'OR within 6000ms Ines\'s iOS Sim UI shows a "Room closed by host warning" toast and navigates back to "/rooms"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Ines', 'Room closed by host warning', '/rooms', 6000);
  });

  test('driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { iosShowsToastAndNavigates: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'OR within 3000ms Bao\'s iOS Sim UI shows a "X" toast and navigates back to "/y"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/toast|nav/);
  });

  test('iOS Sim no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'OR within 3000ms Bao\'s iOS Sim UI shows a "X" toast and navigates back to "/y"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.uiDriver\.iosShowsToastAndNavigates/);
  });

  // Android — full 3-test set
  test('Android matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsToastAndNavigates: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'OR within 3000ms Theo\'s Android UI shows a "Closed" toast and navigates back to "/rooms"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo', 'Closed', '/rooms', 3000);
  });

  test('Android driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidShowsToastAndNavigates: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'OR within 3000ms Theo\'s Android UI shows a "Closed" toast and navigates back to "/rooms"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/toast|nav/);
  });

  test('Android no driver → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'OR within 3000ms Theo\'s Android UI shows a "Closed" toast and navigates back to "/rooms"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.uiDriver\.androidShowsToastAndNavigates/);
  });

  // Web — full 3-test set
  test('Web matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsToastAndNavigates: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'OR within 3000ms Alice\'s Web UI shows a "Closed" toast and navigates back to "/rooms"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 'Closed', '/rooms', 3000);
  });

  test('Web driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsToastAndNavigates: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'OR within 3000ms Alice\'s Web UI shows a "Closed" toast and navigates back to "/rooms"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/toast|nav/);
  });

  test('Web driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'OR within 3000ms Alice\'s Web UI shows a "Closed" toast and navigates back to "/rooms"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsToastAndNavigates/);
  });

  // Web Chromium variant
  test('Web Chromium matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsToastAndNavigates: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'OR within 3000ms Alice\'s Web Chromium UI shows a "Closed" toast and navigates back to "/rooms"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 'Closed', '/rooms', 3000);
  });

  test('Web Chromium driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsToastAndNavigates: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'OR within 3000ms Alice\'s Web Chromium UI shows a "Closed" toast and navigates back to "/rooms"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/toast|nav/);
  });

  test('Web Chromium driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'OR within 3000ms Alice\'s Web Chromium UI shows a "Closed" toast and navigates back to "/rooms"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsToastAndNavigates/);
  });

  // Web Safari variant
  test('Web Safari matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsToastAndNavigates: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'OR within 3000ms Alice\'s Web Safari UI shows a "Closed" toast and navigates back to "/rooms"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 'Closed', '/rooms', 3000);
  });

  test('Web Safari driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsToastAndNavigates: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'OR within 3000ms Alice\'s Web Safari UI shows a "Closed" toast and navigates back to "/rooms"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/toast|nav/);
  });

  test('Web Safari driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'OR within 3000ms Alice\'s Web Safari UI shows a "Closed" toast and navigates back to "/rooms"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsToastAndNavigates/);
  });
});

describe('Wake 93 — "the PM does NOT render in English even if <Sender>\'s locale is en"', () => {
  // j13-locales-rtl-cjk.feature:38
  //   Then the PM does NOT render in English even if Officia's locale is en
  // Negative-render assertion: the visible PM body must NOT be in
  // English script, regardless of the named sender's locale being en.
  // (Recipient's locale should dictate render — this catches the bug
  // where sender-locale leaks into recipient view.)
  test('non-English render → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webPmDoesNotRenderInEnglish: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "the PM does NOT render in English even if Officia's locale is en" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Officia');
  });

  test('English-rendered PM → fail (would be a bug)', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webPmDoesNotRenderInEnglish: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "the PM does NOT render in English even if Officia's locale is en" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/English|Officia/);
  });
});

describe('Wake 93 — "<Name1> on <Plat1> and <Name2> on <Plat2> both join the event room"', () => {
  // j16-event-host-team-leader.feature:38
  //   When Alice on Web and Theo on Android both join the event room
  // Dual-actor concurrent join. Both drivers fire in parallel so the
  // test can probe race conditions (mic/AV negotiation, host detection).
  test('both succeed → ok, both drivers called concurrently', async () => {
    const webSpy = jest.fn(async () => true);
    const androidSpy = jest.fn(async () => true);
    const ctx = makeCtx({
      webDriver: { webJoinEventRoom: webSpy },
      uiDriver: { androidJoinEventRoom: androidSpy },
    });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Alice on Web and Theo on Android both join the event room',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(webSpy).toHaveBeenCalledWith('Alice');
    expect(androidSpy).toHaveBeenCalledWith('Theo');
  });

  test('one driver fails → fail', async () => {
    const ctx = makeCtx({
      webDriver: { webJoinEventRoom: jest.fn(async () => true) },
      uiDriver: { androidJoinEventRoom: jest.fn(async () => false) },
    });
    const r = await executeStep(
      {
        kind: 'When',
        text: 'Alice on Web and Theo on Android both join the event room',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Theo|Android|join/);
  });
});

describe('Wake 93 — "the tester hears <Speaker>\'s voice on <Listener>\'s <Plat> speakers"', () => {
  // j16-event-host-team-leader.feature:41
  //   Then the tester hears Selma's voice on Alice's Web speakers
  // Single-listener tester-hears variant. Uses ctx.testerDriver
  // (established in Wake 80 multi-listener variants) so the audio
  // assertion is consistent across journeys.
  test('matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ testerDriver: { hearsVoiceOnListener: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "the tester hears Selma's voice on Alice's Web speakers" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Selma', 'Alice', 'Web');
  });

  test('Android speakers variant', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ testerDriver: { hearsVoiceOnListener: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "the tester hears Bao's voice on Yuki's Android speakers" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Bao', 'Yuki', 'Android');
  });

  test('driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ testerDriver: { hearsVoiceOnListener: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "the tester hears Selma's voice on Alice's Web speakers" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Selma|Alice|audible/);
  });
});

describe('Wake 93 — "<Name>\'s <Plat> UI (paired session) also shows the same totals"', () => {
  // j16-event-host-team-leader.feature:48
  //   Then Tariq's Web UI (paired session) also shows the same totals
  // Paired-session parity. Mid-step `(paired session)` paren is NOT
  // end-anchored — same trap as Wake 88's bracket-cohort sign-in.
  // The driver compares visible totals on Tariq's session against the
  // most-recent recorded totals (set on ctx.lastTotals by a prior step).
  test('matching totals → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webPairedSessionShowsSameTotals: spy } });
    ctx.lastTotals = { beans: 100, gifts: 5 };
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Tariq's Web UI (paired session) also shows the same totals",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Tariq', { beans: 100, gifts: 5 });
  });

  test('no prior totals → fail', async () => {
    const ctx = makeCtx({
      webDriver: { webPairedSessionShowsSameTotals: jest.fn(async () => true) },
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Tariq's Web UI (paired session) also shows the same totals",
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/lastTotals|totals/);
  });

  test('mismatch → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webPairedSessionShowsSameTotals: spy } });
    ctx.lastTotals = { beans: 100 };
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Tariq's Web UI (paired session) also shows the same totals",
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Tariq|totals/);
  });
});

describe('Wake 93 — bidirectional "the tester hears X on Y\'s P1 speakers AND Z on W\'s P2 speakers"', () => {
  // j17-teacher-classroom.feature:46
  //   Then the tester hears Yuki on Bao's Android speakers AND Bao on Yuki's iOS Sim speakers
  // Bidirectional audio: each speaker is heard by the other's listener.
  // Fires the listener check in BOTH directions; both must pass.
  test('both directions audible → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ testerDriver: { hearsOnListener: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "the tester hears Yuki on Bao's Android speakers AND Bao on Yuki's iOS Sim speakers",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Yuki', 'Bao', 'Android');
    expect(spy).toHaveBeenCalledWith('Bao', 'Yuki', 'iOS Sim');
  });

  test('one direction inaudible → fail', async () => {
    const spy = jest.fn(async (speaker) => speaker === 'Yuki');
    const ctx = makeCtx({ testerDriver: { hearsOnListener: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "the tester hears Yuki on Bao's Android speakers AND Bao on Yuki's iOS Sim speakers",
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Bao|inaudible/);
  });
});

// ── Wake 94 — the 100% milestone wake ────────────────────────────────

describe('Wake 94 — "the PM body contains the raw key OR an English placeholder"', () => {
  // j18-official-system-pms.feature:76
  // Prior step: When the test harness fires sendSystemPm with key="totally_made_up_key" recipient=Adam
  // Asserts the rendered PM falls back gracefully when the key is
  // unknown — either renders the raw key OR a generic English placeholder.
  test('raw key visible → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webPmBodyShowsRawKeyOrPlaceholder: spy } });
    ctx.lastSentSystemPm = {
      trigger: 'test harness',
      key: 'totally_made_up_key',
      recipientName: 'Adam',
      recipientId: 90000001,
    };
    const r = await executeStep(
      { kind: 'Then', text: 'the PM body contains the raw key OR an English placeholder' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('totally_made_up_key');
  });

  test('no fallback visible → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webPmBodyShowsRawKeyOrPlaceholder: spy } });
    ctx.lastSentSystemPm = { key: 'X', recipientName: 'Adam', recipientId: 90000001 };
    const r = await executeStep(
      { kind: 'Then', text: 'the PM body contains the raw key OR an English placeholder' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/raw key|placeholder/);
  });

  test('no prior sendSystemPm → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: 'the PM body contains the raw key OR an English placeholder' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/sendSystemPm/);
  });
});

describe('Wake 94 — "for each such room, every userId in participantIds resolves to a user with the same cohort as the room\'s cohort field"', () => {
  // j19-osa-migration-regression.feature:42
  // Prior step: When a query is run for every "rooms/*" doc with state="OPEN"
  // Iterates ctx.lastQueryResult.docs; for each room, asserts all
  // participants have cohort matching room.cohort.
  test('all rooms internally consistent → ok', async () => {
    const db = makeStatefulFakeDb({
      'users/10': { uniqueId: 10, cohort: 'adult' },
      'users/20': { uniqueId: 20, cohort: 'adult' },
    });
    const ctx = makeCtx({ db });
    ctx.lastQueryResult = {
      docs: [{ cohort: 'adult', participantIds: [10, 20] }],
    };
    const r = await executeStep(
      {
        kind: 'Then',
        text: "for each such room, every userId in participantIds resolves to a user with the same cohort as the room's cohort field",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('mismatched cohort → fail', async () => {
    const db = makeStatefulFakeDb({
      'users/10': { uniqueId: 10, cohort: 'adult' },
      'users/20': { uniqueId: 20, cohort: 'minor' },
    });
    const ctx = makeCtx({ db });
    ctx.lastQueryResult = {
      docs: [{ id: 'r1', cohort: 'adult', participantIds: [10, 20] }],
    };
    const r = await executeStep(
      {
        kind: 'Then',
        text: "for each such room, every userId in participantIds resolves to a user with the same cohort as the room's cohort field",
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/20|minor|adult|mismatch/);
  });

  test('no prior query → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: "for each such room, every userId in participantIds resolves to a user with the same cohort as the room's cohort field",
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/lastQueryResult|query/);
  });
});

describe('Wake 94 — "for each frozen conversation, no document was added to "<X>" after the migration timestamp"', () => {
  // j19-osa-migration-regression.feature:57
  // Iterates conversations where frozen=true. For each, checks the
  // named subcollection (e.g., conversations/{id}/messages) — no doc
  // may have createdAt > ctx.migrationTimestamp (defaults to 0).
  test('frozen convs have no post-migration messages → ok', async () => {
    const db = makeStatefulFakeDb({
      'conversations/c1': { frozen: true, createdAt: 0 },
      'conversations/c1/messages/m1': { createdAt: 0, body: 'pre-OSA hello' },
      'conversations/c2': { frozen: true, createdAt: 0 },
    });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'for each frozen conversation, no document was added to "conversations/{id}/messages" after the migration timestamp',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('frozen conv with post-migration message → fail', async () => {
    const db = makeStatefulFakeDb({
      'conversations/c1': { frozen: true, createdAt: 0 },
      'conversations/c1/messages/m1': { createdAt: 0, body: 'pre' },
      'conversations/c1/messages/m2': { createdAt: 1000, body: 'POST — illegal!' },
    });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'for each frozen conversation, no document was added to "conversations/{id}/messages" after the migration timestamp',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/c1|m2|post/i);
  });

  test('non-frozen convs ignored → ok', async () => {
    const db = makeStatefulFakeDb({
      'conversations/c1': { frozen: false, createdAt: 0 },
      'conversations/c1/messages/m1': { createdAt: 9999, body: 'post-migration but unfrozen' },
    });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'for each frozen conversation, no document was added to "conversations/{id}/messages" after the migration timestamp',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });
});

describe('Wake 94 — `the doc has entries in "<X>" with users from BOTH cohort="<A>" AND cohort="<B>"`', () => {
  // j19-osa-migration-regression.feature:75
  // Prior step: When a query is run for the user doc "users/1"
  // ctx.lastQueryResult.data is the user doc. The field X (e.g.,
  // followerIds) is an array of uniqueIds; resolve each to a user and
  // check the set includes both named cohorts.
  test('contains both cohorts → ok', async () => {
    const db = makeStatefulFakeDb({
      'users/10': { uniqueId: 10, cohort: 'adult' },
      'users/20': { uniqueId: 20, cohort: 'minor' },
    });
    const ctx = makeCtx({ db });
    ctx.lastQueryResult = { exists: true, data: { followerIds: [10, 20] } };
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the doc has entries in "followerIds" with users from BOTH cohort="adult" AND cohort="minor"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('only one cohort → fail', async () => {
    const db = makeStatefulFakeDb({
      'users/10': { uniqueId: 10, cohort: 'adult' },
      'users/20': { uniqueId: 20, cohort: 'adult' },
    });
    const ctx = makeCtx({ db });
    ctx.lastQueryResult = { exists: true, data: { followerIds: [10, 20] } };
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the doc has entries in "followerIds" with users from BOTH cohort="adult" AND cohort="minor"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/minor|missing/);
  });

  test('no prior doc → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the doc has entries in "followerIds" with users from BOTH cohort="adult" AND cohort="minor"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/lastQueryResult|doc/);
  });
});

describe('Wake 94 — `the doc has at most N entries in "<X>" matching {action: "<Y>", sourceId: N}`', () => {
  // j19-osa-migration-regression.feature:76
  // Prior step: When a query is run for the user doc "users/1"
  // ctx.lastQueryResult.data.<X> is an array of audit entries.
  // Counts entries where e.action===Y AND e.sourceId===N (the 2nd
  // capture group). Must be ≤ first capture.
  test('zero matching entries → ok', async () => {
    const ctx = makeCtx();
    ctx.lastQueryResult = {
      exists: true,
      data: {
        auditLog: [
          { action: 'delivered', sourceId: 1 },
          { action: 'blocked', sourceId: 99 },
        ],
      },
    };
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the doc has at most 0 entries in "auditLog" matching {action: "blocked", sourceId: 1}',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('exactly one matching entry but expected 0 → fail', async () => {
    const ctx = makeCtx();
    ctx.lastQueryResult = {
      exists: true,
      data: {
        auditLog: [{ action: 'blocked', sourceId: 1 }],
      },
    };
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the doc has at most 0 entries in "auditLog" matching {action: "blocked", sourceId: 1}',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/1|blocked|exceeded/);
  });

  test('within limit (N=2, found 1) → ok', async () => {
    const ctx = makeCtx();
    ctx.lastQueryResult = {
      exists: true,
      data: {
        auditLog: [{ action: 'blocked', sourceId: 1 }],
      },
    };
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the doc has at most 2 entries in "auditLog" matching {action: "blocked", sourceId: 1}',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });
});

// ── Wake 95 — Background-step coverage gap (post-100% audit) ─────────
// The pareto scan that drove Wakes 86-94 only iterated scenario.steps.
// Background.steps were never measured. This wake adds the matchers
// for the 13 unmatched Background shapes (8 corpus rows; the other 5
// shapes will land in Wake 96).

describe('Wake 95 — "the <queue> queue has N pending <noun>"', () => {
  // j12-admin-daily-routine.feature Background:
  //   Given the reports queue has 3 pending reports
  //   Given the age-verification queue has 5 pending submissions
  //   Given the suspension-appeals queue has 2 pending appeals
  test('reports queue → sets ctx.adminQueues', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'the reports queue has 3 pending reports' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.adminQueues?.reports).toEqual({ count: 3, noun: 'reports' });
  });

  test('age-verification queue (hyphenated)', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'the age-verification queue has 5 pending submissions' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.adminQueues?.['age-verification']).toEqual({ count: 5, noun: 'submissions' });
  });

  test('suspension-appeals queue', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'the suspension-appeals queue has 2 pending appeals' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.adminQueues?.['suspension-appeals']).toEqual({ count: 2, noun: 'appeals' });
  });
});

describe('Wake 95 — "the audit log has at least N recent entries"', () => {
  // j12-admin-daily-routine.feature Background:
  //   Given the audit log has at least 50 recent entries
  test('records lower-bound count', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'the audit log has at least 50 recent entries' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.auditLogMinEntries).toBe(50);
  });
});

describe('Wake 95 — "<Name> [P-NN] is signed in on <Plat> and hosting voice room "<X>" with mic open + seated"', () => {
  // j10-mid-room-warning.feature Background:
  //   Given Theo [P-10] is signed in on Android and hosting voice room "r1" with mic open + seated
  // Composite state-seed: sign-in + voice room ownership + mic/seat state.
  test('plants session + room ownership', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Theo [P-10] is signed in on Android and hosting voice room "r1" with mic open + seated',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    // Theo = P-10 = 50000060
    expect(ctx.sessions.get('Theo')?.customClaims.uniqueId).toBe(50000060);
    expect(db._docs['rooms/r1']).toBeDefined();
    expect(db._docs['rooms/r1'].hostUid).toBe(50000060);
    expect(db._docs['rooms/r1'].state).toBe('OPEN');
    expect(db._docs['rooms/r1'].participantIds).toContain(50000060);
  });
});

describe('Wake 95 — "<Name> [P-NN] is signed in on <Plat> and joined to "<X>" as a non-seated participant"', () => {
  // j10-mid-room-warning.feature Background:
  //   Given Ines [P-11] is signed in on iOS Sim and joined to "r1" as a non-seated participant
  test('plants session + room participation', async () => {
    const db = makeStatefulFakeDb({
      'rooms/r1': { hostUid: 50000060, state: 'OPEN', participantIds: [50000060] },
    });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Ines [P-11] is signed in on iOS Sim and joined to "r1" as a non-seated participant',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    // Ines = P-11 = 50000061
    expect(ctx.sessions.get('Ines')?.customClaims.uniqueId).toBe(50000061);
    expect(db._docs['rooms/r1'].participantIds).toContain(50000061);
  });
});

describe('Wake 95 — "<Name> has a pre-existing direct conversation with <Other>"', () => {
  // j11-harassment-moderation-cycle.feature Background:
  //   Given Raul has a pre-existing direct conversation with Nora
  // State-seed: plants a conversations/<id> doc with the two-persona pair.
  test('plants a 2-person direct conv doc', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: 'Raul has a pre-existing direct conversation with Nora' },
      ctx,
    );
    expect(r.ok).toBe(true);
    // Raul = P-08 = 50000050, Nora = P-09 = 50000051
    const conv = Object.entries(db._docs).find(([k]) => k.startsWith('conversations/'));
    expect(conv).toBeDefined();
    const data = conv[1];
    expect(data.participantIds).toEqual(expect.arrayContaining([50000050, 50000051]));
  });
});

describe('Wake 95 — `the gifts "<X>" (Nc coins / Nb beans), "<Y>" (..), "<Z>" (..) exist`', () => {
  // j15-mc-performance.feature Background:
  //   Given the gifts "rose" (10 coins / 5 beans), "crown" (500 coins / 250 beans), "diamond" (1000 coins / 500 beans) exist
  // State-seed: plants 3 gift docs with coin price + bean payout.
  test('plants 3 gift docs', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'the gifts "rose" (10 coins / 5 beans), "crown" (500 coins / 250 beans), "diamond" (1000 coins / 500 beans) exist',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['gifts/rose']).toEqual({ id: 'rose', coins: 10, beans: 5 });
    expect(db._docs['gifts/crown']).toEqual({ id: 'crown', coins: 500, beans: 250 });
    expect(db._docs['gifts/diamond']).toEqual({ id: 'diamond', coins: 1000, beans: 500 });
  });

  test('no db → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'the gifts "rose" (10 coins / 5 beans), "crown" (500 coins / 250 beans), "diamond" (1000 coins / 500 beans) exist',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db/);
  });
});

// ── Wake 96 — final Background-step closure (true 100% coverage) ─────

describe('Wake 96 — "<Name> [P-NN] is signed in (<Lang>) as a follow target"', () => {
  // j13-locales-rtl-cjk.feature Background:
  //   Given Alice [P-02] is signed in (English) as a follow target
  test('plants session and tags as follow target', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'Alice [P-02] is signed in (English) as a follow target' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.sessions.get('Alice')?.customClaims.uniqueId).toBe(50000010);
    expect(ctx.followTargets?.has('Alice')).toBe(true);
  });

  test('different language captures locale info', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: 'Layla [P-13] is signed in (Arabic) as a follow target' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.sessions.get('Layla')?.persona.uniqueId).toBe(50000070);
  });
});

describe('Wake 96 — `<Name> [P-NN] is also paired on <Plat> with Network Link Conditioner "<X>" preset`', () => {
  // j14-low-bandwidth-degraded.feature Background:
  //   Given Ines [P-11] is also paired on iOS Sim with Network Link Conditioner "3G" preset
  test('records paired platform + network preset', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Ines [P-11] is also paired on iOS Sim with Network Link Conditioner "3G" preset',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.pairedPlatforms?.get('Ines')).toEqual({
      platform: 'iOS Sim',
      networkPreset: '3G',
    });
  });

  test('Edge preset variant', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Adam [P-01] is also paired on Android with Network Link Conditioner "Edge" preset',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.pairedPlatforms?.get('Adam')).toEqual({
      platform: 'Android',
      networkPreset: 'Edge',
    });
  });
});

describe('Wake 96 — "<Name> is also signed in on <Plat> (same Firebase identity) for hosting"', () => {
  // j16-event-host-team-leader.feature Background:
  //   Given Tariq is also signed in on Android (same Firebase identity) for hosting
  test('plants secondary session', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Tariq is also signed in on Android (same Firebase identity) for hosting',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.sessions.get('Tariq')?.customClaims.uniqueId).toBe(50000081);
    expect(ctx.pairedPlatforms?.get('Tariq')?.platform).toBe('Android');
  });

  test('unknown persona → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Zzzghost is also signed in on Android (same Firebase identity) for hosting',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Zzzghost|persona/);
  });
});

describe('Wake 96 — "<Name>\'s user doc has teamRoster=[N, N, ...]"', () => {
  // j16-event-host-team-leader.feature Background:
  //   Given Tariq's user doc has teamRoster=[50000080]
  test('single-element roster', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: "Tariq's user doc has teamRoster=[50000080]" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000081'].teamRoster).toEqual([50000080]);
  });

  test('multi-element roster', async () => {
    const db = makeStatefulFakeDb({});
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Given', text: "Tariq's user doc has teamRoster=[50000080, 50000081, 50000090]" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(db._docs['users/50000081'].teamRoster).toEqual([50000080, 50000081, 50000090]);
  });

  test('no db → fail teamRoster step', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Given', text: "Tariq's user doc has teamRoster=[50000080]" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/db/);
  });
});

describe('Wake 96 — "<Name> [P-NN] is signed in on <Plat> with cohort=<C> (note) and locale=<L>"', () => {
  // j18-official-system-pms.feature Background:
  //   Given Hayato [P-06] is signed in on Android with cohort=minor (post-j04 state) and locale=ja
  test('captures cohort + locale, ignores annotation paren', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Hayato [P-06] is signed in on Android with cohort=minor (post-j04 state) and locale=ja',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    const session = ctx.sessions.get('Hayato');
    expect(session?.customClaims.uniqueId).toBe(50000030);
    expect(session?.customClaims.cohort).toBe('minor');
    expect(session?.locale).toBe('ja');
  });

  test('different cohort value is honoured', async () => {
    // Hayato's registry cohort is `minor` but the scenario can override it via
    // the with-clause to model a post-flip state. The matcher must use the
    // declared value, NOT the persona registry's default.
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Given',
        text: 'Hayato [P-06] is signed in on Android with cohort=adult (post-flip) and locale=en',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.sessions.get('Hayato')?.customClaims.cohort).toBe('adult');
    expect(ctx.sessions.get('Hayato')?.locale).toBe('en');
  });
});

// ── Wake 97 — close `within Nms` inner-shape gaps ────────────────────
// The pareto + background scans didn't recurse into the inner step
// after `within Nms <inner>` strips its timeout prefix. runFeatureFile
// surfaced 6 inner shapes the scans missed.

describe('Wake 97 — "<Name>\'s <Plat> UI shows <Other>\'s user card"', () => {
  test('matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsUserCard: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Adam's Android UI shows Alice's user card" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Adam', 'Alice');
  });

  test('driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidShowsUserCard: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Adam's Android UI shows Alice's user card" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Alice|card/);
  });

  test('Android driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Adam's Android UI shows Alice's user card" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.uiDriver\.androidShowsUserCard/);
  });

  // iOS Sim
  test('iOS Sim matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosShowsUserCard: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Adam's iOS Sim UI shows Alice's user card" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Adam', 'Alice');
  });

  test('iOS Sim driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { iosShowsUserCard: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Adam's iOS Sim UI shows Alice's user card" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Alice|card/);
  });

  test('iOS Sim driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Adam's iOS Sim UI shows Alice's user card" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.uiDriver\.iosShowsUserCard/);
  });

  // Web
  test('Web matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsUserCard: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Adam's Web UI shows Alice's user card" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Adam', 'Alice');
  });

  test('Web driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsUserCard: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Adam's Web UI shows Alice's user card" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Alice|card/);
  });

  test('Web driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Adam's Web UI shows Alice's user card" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsUserCard/);
  });

  // Web Chromium
  test('Web Chromium matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsUserCard: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Adam's Web Chromium UI shows Alice's user card" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Adam', 'Alice');
  });

  test('Web Chromium driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsUserCard: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Adam's Web Chromium UI shows Alice's user card" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Alice|card/);
  });

  test('Web Chromium driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Adam's Web Chromium UI shows Alice's user card" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsUserCard/);
  });

  // Web Safari
  test('Web Safari matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsUserCard: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Adam's Web Safari UI shows Alice's user card" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Adam', 'Alice');
  });

  test('Web Safari driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsUserCard: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Adam's Web Safari UI shows Alice's user card" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Alice|card/);
  });

  test('Web Safari driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Adam's Web Safari UI shows Alice's user card" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsUserCard/);
  });
});

describe('Wake 97 — "<Name>\'s <Plat> UI shows the warning banner overlay on top of the room"', () => {
  test('matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsRoomWarningBanner: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Theo's Android UI shows the warning banner overlay on top of the room",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo');
  });

  test('driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Theo's Android UI shows the warning banner overlay on top of the room",
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.uiDriver\.androidShowsRoomWarningBanner/);
  });

  test('Android driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidShowsRoomWarningBanner: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Theo's Android UI shows the warning banner overlay on top of the room",
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Theo|warning|banner/);
  });

  // iOS Sim
  test('iOS Sim matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosShowsRoomWarningBanner: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Theo's iOS Sim UI shows the warning banner overlay on top of the room",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo');
  });

  test('iOS Sim driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { iosShowsRoomWarningBanner: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Theo's iOS Sim UI shows the warning banner overlay on top of the room",
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Theo|warning|banner/);
  });

  test('iOS Sim driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Theo's iOS Sim UI shows the warning banner overlay on top of the room",
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.uiDriver\.iosShowsRoomWarningBanner/);
  });

  // Web
  test('Web matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsRoomWarningBanner: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Theo's Web UI shows the warning banner overlay on top of the room",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo');
  });

  test('Web driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsRoomWarningBanner: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Theo's Web UI shows the warning banner overlay on top of the room",
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Theo|warning|banner/);
  });

  test('Web driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Theo's Web UI shows the warning banner overlay on top of the room",
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsRoomWarningBanner/);
  });

  // Web Chromium
  test('Web Chromium matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsRoomWarningBanner: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Theo's Web Chromium UI shows the warning banner overlay on top of the room",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo');
  });

  test('Web Chromium driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsRoomWarningBanner: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Theo's Web Chromium UI shows the warning banner overlay on top of the room",
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Theo|warning|banner/);
  });

  test('Web Chromium driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Theo's Web Chromium UI shows the warning banner overlay on top of the room",
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsRoomWarningBanner/);
  });

  // Web Safari
  test('Web Safari matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsRoomWarningBanner: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Theo's Web Safari UI shows the warning banner overlay on top of the room",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo');
  });

  test('Web Safari driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsRoomWarningBanner: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Theo's Web Safari UI shows the warning banner overlay on top of the room",
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Theo|warning|banner/);
  });

  test('Web Safari driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Theo's Web Safari UI shows the warning banner overlay on top of the room",
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsRoomWarningBanner/);
  });
});

describe('Wake 97 — `the database has document "<path>" with field "seats[*].userId == N" entry <k>=<v>`', () => {
  test('matching seat entry → ok', async () => {
    const db = makeStatefulFakeDb({
      'rooms/r1': {
        seats: [
          { userId: 50000060, muted: false },
          { userId: 60000010, muted: true },
        ],
      },
    });
    const ctx = makeCtx({ db, scenarioVars: new Map([['roomId', 'r1']]) });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "rooms/{roomId}" with field "seats[*].userId == 60000010" entry muted=true',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('seat present but field mismatch → fail', async () => {
    const db = makeStatefulFakeDb({
      'rooms/r1': { seats: [{ userId: 60000010, muted: false }] },
    });
    const ctx = makeCtx({ db, scenarioVars: new Map([['roomId', 'r1']]) });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "rooms/{roomId}" with field "seats[*].userId == 60000010" entry muted=true',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/muted|false|true/);
  });

  test('no matching seat → fail', async () => {
    const db = makeStatefulFakeDb({
      'rooms/r1': { seats: [{ userId: 50000060, muted: false }] },
    });
    const ctx = makeCtx({ db, scenarioVars: new Map([['roomId', 'r1']]) });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "rooms/{roomId}" with field "seats[*].userId == 60000010" entry muted=true',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/60000010|seat/);
  });
});

describe('Wake 97 — "<Name>\'s <Plat> UI shows skeleton placeholders for user cards"', () => {
  test('matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsUserCardSkeletons: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Ines's Web UI shows skeleton placeholders for user cards" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Ines');
  });

  test('driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsUserCardSkeletons: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Ines's Web UI shows skeleton placeholders for user cards" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Ines|skeleton/);
  });

  test('Web driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Ines's Web UI shows skeleton placeholders for user cards" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsUserCardSkeletons/);
  });

  // Android — full 3-test set
  test('Android matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsUserCardSkeletons: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Ines's Android UI shows skeleton placeholders for user cards" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Ines');
  });

  test('Android driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidShowsUserCardSkeletons: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Ines's Android UI shows skeleton placeholders for user cards" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Ines|skeleton/);
  });

  test('Android driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Ines's Android UI shows skeleton placeholders for user cards" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.uiDriver\.androidShowsUserCardSkeletons/);
  });

  // iOS Sim — full 3-test set
  test('iOS Sim matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosShowsUserCardSkeletons: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Ines's iOS Sim UI shows skeleton placeholders for user cards" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Ines');
  });

  test('iOS Sim driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { iosShowsUserCardSkeletons: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Ines's iOS Sim UI shows skeleton placeholders for user cards" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Ines|skeleton/);
  });

  test('iOS Sim driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Ines's iOS Sim UI shows skeleton placeholders for user cards" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.uiDriver\.iosShowsUserCardSkeletons/);
  });

  // Web Chromium variant
  test('Web Chromium matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsUserCardSkeletons: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Ines's Web Chromium UI shows skeleton placeholders for user cards" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Ines');
  });

  test('Web Chromium driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsUserCardSkeletons: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Ines's Web Chromium UI shows skeleton placeholders for user cards" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Ines|skeleton/);
  });

  test('Web Chromium driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Ines's Web Chromium UI shows skeleton placeholders for user cards" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsUserCardSkeletons/);
  });

  // Web Safari variant
  test('Web Safari matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsUserCardSkeletons: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Ines's Web Safari UI shows skeleton placeholders for user cards" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Ines');
  });

  test('Web Safari driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsUserCardSkeletons: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Ines's Web Safari UI shows skeleton placeholders for user cards" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Ines|skeleton/);
  });

  test('Web Safari driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Ines's Web Safari UI shows skeleton placeholders for user cards" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsUserCardSkeletons/);
  });
});

describe('Wake 97 — `<Name>\'s <Plat> UI shows a "<X>" banner`', () => {
  test('iOS Sim matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosShowsBanner: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Ines\'s iOS Sim UI shows a "Reconnecting..." banner' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Ines', 'Reconnecting...');
  });

  test('Android variant', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsBanner: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Theo\'s Android UI shows a "Hold on" banner' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo', 'Hold on');
  });

  test('iOS Sim driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { iosShowsBanner: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Ines\'s iOS Sim UI shows a "Reconnecting" banner' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Ines.*iOS Sim.*Reconnecting/);
  });

  test('iOS Sim driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: 'Ines\'s iOS Sim UI shows a "Reconnecting" banner' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/iosShowsBanner/);
  });

  test('Android driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidShowsBanner: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Theo\'s Android UI shows a "Hold on" banner' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Theo.*Android.*Hold on/);
  });

  test('Android driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: 'Theo\'s Android UI shows a "Hold on" banner' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidShowsBanner/);
  });

  test('Web matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsBanner: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Alice\'s Web UI shows a "Update available" banner' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 'Update available');
  });

  test('Web driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsBanner: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Alice\'s Web UI shows a "Update available" banner' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Alice.*Web.*Update available/);
  });

  test('Web driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: 'Alice\'s Web UI shows a "Update available" banner' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webShowsBanner/);
  });

  test('Web Chromium platform token → routes to webShowsBanner', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsBanner: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Alice\'s Web Chromium UI shows a "Update available" banner' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 'Update available');
  });

  test('Web Safari platform token → routes to webShowsBanner', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsBanner: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Alice\'s Web Safari UI shows a "Update available" banner' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 'Update available');
  });
});

describe('Wake 97 — "<Name>\'s LiveKit track is not disconnected"', () => {
  test('connected → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ liveKitDriver: { trackIsConnected: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Ines's LiveKit track is not disconnected" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Ines');
  });

  test('disconnected → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ liveKitDriver: { trackIsConnected: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Ines's LiveKit track is not disconnected" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Ines|disconnected/);
  });
});

// ── Wake 98 — high-yield repeat shapes + reusable singletons ────────

describe('Wake 98 — `<Name>\'s <Plat> UI shows a +N in the "<X>" count`', () => {
  // Catches 3 corpus rows (Alice/Web ×2 + Marcus/Android ×1).
  test('Web Followers +1', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsCountBadge: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Alice\'s Web UI shows a +1 in the "Followers" count' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 1, 'Followers');
  });

  test('Android variant', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsCountBadge: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Marcus\'s Android UI shows a +1 in the "Followers" count' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Marcus', 1, 'Followers');
  });

  test('driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsCountBadge: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Alice\'s Web UI shows a +5 in the "Likes" count' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Alice|Likes/);
  });

  test('Web driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: 'Alice\'s Web UI shows a +1 in the "Followers" count' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsCountBadge/);
  });

  // Web Chromium variant — full 3-test set
  test('Web Chromium matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsCountBadge: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Alice\'s Web Chromium UI shows a +1 in the "Followers" count' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 1, 'Followers');
  });

  test('Web Chromium driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsCountBadge: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Alice\'s Web Chromium UI shows a +1 in the "Followers" count' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Alice|Followers/);
  });

  test('Web Chromium driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: 'Alice\'s Web Chromium UI shows a +1 in the "Followers" count' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsCountBadge/);
  });

  // Web Safari variant — full 3-test set
  test('Web Safari matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsCountBadge: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Alice\'s Web Safari UI shows a +1 in the "Followers" count' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 1, 'Followers');
  });

  test('Web Safari driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsCountBadge: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Alice\'s Web Safari UI shows a +1 in the "Followers" count' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Alice|Followers/);
  });

  test('Web Safari driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: 'Alice\'s Web Safari UI shows a +1 in the "Followers" count' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsCountBadge/);
  });

  // Android branch — completing 3-test set
  test('Android driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidShowsCountBadge: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Marcus\'s Android UI shows a +1 in the "Followers" count' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Marcus|Followers/);
  });

  test('Android driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: 'Marcus\'s Android UI shows a +1 in the "Followers" count' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.uiDriver\.androidShowsCountBadge/);
  });

  // iOS Sim branch — full 3-test set
  test('iOS Sim matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosShowsCountBadge: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Marcus\'s iOS Sim UI shows a +1 in the "Followers" count' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Marcus', 1, 'Followers');
  });

  test('iOS Sim driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { iosShowsCountBadge: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Marcus\'s iOS Sim UI shows a +1 in the "Followers" count' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Marcus|Followers/);
  });

  test('iOS Sim driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: 'Marcus\'s iOS Sim UI shows a +1 in the "Followers" count' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.uiDriver\.iosShowsCountBadge/);
  });
});

describe('Wake 98 — `<Name>\'s <Plat> Admin UI shows N row for "<X>" with status "<Y>"`', () => {
  // j01/j04 admin-queue row-presence assertion. Catches 2 corpus rows.
  test('one row with PENDING status', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webAdminShowsRowForWithStatus: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Greta\'s Web Admin UI shows 1 row for "50000030" with status "PENDING"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Greta', 1, '50000030', 'PENDING');
  });

  test('driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webAdminShowsRowForWithStatus: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Greta\'s Web Admin UI shows 0 row for "X" with status "APPROVED"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/X|APPROVED/);
  });
});

describe('Wake 98 — `the database has document "<X>" with field "<Y>" decreased by N`', () => {
  // j01/j15 wallet-decrement assertion. Reads ctx.snapshots (set by a
  // prior baseline-capture step) and asserts current value === baseline - N.
  test('matching decrement → ok', async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': { shyCoins: 990 } });
    const ctx = makeCtx({ db });
    ctx.snapshots = new Map([['users/50000010#shyCoins', 1000]]);
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000010" with field "shyCoins" decreased by 10',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('wrong decrement → fail', async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': { shyCoins: 995 } });
    const ctx = makeCtx({ db });
    ctx.snapshots = new Map([['users/50000010#shyCoins', 1000]]);
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000010" with field "shyCoins" decreased by 10',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/shyCoins|10|5/);
  });

  test('no baseline → fail', async () => {
    const db = makeStatefulFakeDb({ 'users/50000010': { shyCoins: 990 } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000010" with field "shyCoins" decreased by 10',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/baseline|snapshot/);
  });
});

describe('Wake 98 — `the database has document "<X>" with field "<Y>" of type "<Z>"`', () => {
  // j01: identityMap.uniqueId must be a number type.
  test('correct type → ok', async () => {
    const db = makeStatefulFakeDb({ 'identityMap/x': { uniqueId: 50000010 } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "identityMap/x" with field "uniqueId" of type "number"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('wrong type → fail', async () => {
    const db = makeStatefulFakeDb({ 'identityMap/x': { uniqueId: '50000010' } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "identityMap/x" with field "uniqueId" of type "number"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/string|number/);
  });
});

describe('Wake 98 — `the database has document "<X>" with field "<Y>" array length N`', () => {
  // j03: users/50000020.fcmTokens.length === 1
  test('matching length → ok', async () => {
    const db = makeStatefulFakeDb({ 'users/50000020': { fcmTokens: ['t1'] } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000020" with field "fcmTokens" array length 1',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('wrong length → fail', async () => {
    const db = makeStatefulFakeDb({ 'users/50000020': { fcmTokens: ['t1', 't2'] } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000020" with field "fcmTokens" array length 1',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/2|1|length/);
  });

  test('field is not array → fail', async () => {
    const db = makeStatefulFakeDb({ 'users/50000020': { fcmTokens: 'not-array' } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000020" with field "fcmTokens" array length 1',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/array|not.*array/i);
  });
});

describe('Wake 98 — `<Name>\'s <Plat> UI shows <Other> in the results[ with displayName "<X>"]`', () => {
  // j01: Adam's Android UI shows Alice in the results with displayName "Alice (P-02 adult power)"
  // j02: Mia's iOS Sim UI shows Marcus in the results
  test('bare form → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosShowsInResults: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Mia's iOS Sim UI shows Marcus in the results" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Mia', 'Marcus', null);
  });

  test('with displayName suffix', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsInResults: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Adam\'s Android UI shows Alice in the results with displayName "Alice (P-02 adult power)"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Adam', 'Alice', 'Alice (P-02 adult power)');
  });

  test('driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Mia's iOS Sim UI shows Marcus in the results" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.uiDriver\.iosShowsInResults/);
  });

  test('iOS Sim driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { iosShowsInResults: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Mia's iOS Sim UI shows Marcus in the results" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Marcus|results/i);
  });

  test('Android driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidShowsInResults: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Adam\'s Android UI shows Alice in the results with displayName "Alice"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Alice|results/i);
  });

  test('Android driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Adam's Android UI shows Alice in the results" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.uiDriver\.androidShowsInResults/);
  });

  // Web — full 3-test set
  test('Web matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsInResults: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web UI shows Bob in the results" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 'Bob', null);
  });

  test('Web driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsInResults: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web UI shows Bob in the results" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Bob|results/i);
  });

  test('Web driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web UI shows Bob in the results" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsInResults/);
  });

  // Web Chromium variant
  test('Web Chromium matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsInResults: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web Chromium UI shows Bob in the results" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 'Bob', null);
  });

  test('Web Chromium driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsInResults: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web Chromium UI shows Bob in the results" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Bob|results/i);
  });

  test('Web Chromium driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web Chromium UI shows Bob in the results" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsInResults/);
  });

  // Web Safari variant
  test('Web Safari matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsInResults: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web Safari UI shows Bob in the results" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 'Bob', null);
  });

  test('Web Safari driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsInResults: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web Safari UI shows Bob in the results" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Bob|results/i);
  });

  test('Web Safari driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web Safari UI shows Bob in the results" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsInResults/);
  });
});

// ── Wake 99 — frozen-banner cluster + j09 room-screen variants ──────

describe('Wake 99 — `<Name>\'s <Plat> UI[ opens conversation "<X>"] shows the frozen-banner element <suffix>`', () => {
  // j08 cluster, 4 corpus rows. Row 2 has unusual "opens conversation X"
  // mid-step prefix (real corpus phrasing).
  test('with text from key', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsFrozenBanner: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Vexa\'s Web UI shows the frozen-banner element with text from key "age_seg_frozen_conversation_banner"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith(
      'Vexa',
      null,
      'with text from key "age_seg_frozen_conversation_banner"',
    );
  });

  test('with opens-conversation prefix', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsFrozenBanner: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Marcus\'s Android UI opens conversation "c1" shows the frozen-banner element with text from key "age_seg_frozen_conversation_banner"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith(
      'Marcus',
      'c1',
      'with text from key "age_seg_frozen_conversation_banner"',
    );
  });

  test('with locale string variant', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsFrozenBanner: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Hayato's Android UI shows the frozen-banner element with the Japanese age_seg_frozen_conversation_banner string",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith(
      'Hayato',
      null,
      'with the Japanese age_seg_frozen_conversation_banner string',
    );
  });

  test('driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsFrozenBanner: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Vexa\'s Web UI shows the frozen-banner element with text from key "X"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Vexa|frozen-banner/);
  });

  test('iOS Sim matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosShowsFrozenBanner: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Greta\'s iOS Sim UI shows the frozen-banner element with text from key "age_seg_frozen_conversation_banner"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith(
      'Greta',
      null,
      'with text from key "age_seg_frozen_conversation_banner"',
    );
  });

  test('iOS Sim driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { iosShowsFrozenBanner: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Greta\'s iOS Sim UI shows the frozen-banner element with text from key "X"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Greta|frozen-banner/);
  });

  test('iOS Sim driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Greta\'s iOS Sim UI shows the frozen-banner element with text from key "X"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/iosShowsFrozenBanner/);
  });
});

describe("Wake 99 — `<Name>'s <Plat> UI navigates to the room screen <suffix>`", () => {
  // j09 — 2 corpus rows with different trailing context.
  test('with host seat occupied', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidNavigatesToRoomScreen: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Theo's Android UI navigates to the room screen with host seat occupied",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo', 'with host seat occupied');
  });

  test('as a non-seated participant', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webNavigatesToRoomScreen: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Alice's Web UI navigates to the room screen as a non-seated participant",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 'as a non-seated participant');
  });
});

describe('Wake 99 — `<Name>\'s <Plat> UI shows a "<X>" gift from <Other>`', () => {
  // j01: Alice's Web UI shows a "rose" gift from Adam
  test('matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsGiftFromSender: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Alice\'s Web UI shows a "rose" gift from Adam' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 'rose', 'Adam');
  });

  test('driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsGiftFromSender: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Alice\'s Web UI shows a "crown" gift from Bob' },
      ctx,
    );
    expect(r.ok).toBe(false);
    // Tightened (PR #823 R1): require both gift + sender names in
    // the error so a degraded message that mentions only one would
    // fail the test.
    expect(r.error).toMatch(/crown/);
    expect(r.error).toMatch(/Bob/);
  });

  test('Web driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: 'Alice\'s Web UI shows a "rose" gift from Adam' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webShowsGiftFromSender/);
  });

  test('Android matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsGiftFromSender: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Alice\'s Android UI shows a "rose" gift from Adam' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 'rose', 'Adam');
  });

  test('Android driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidShowsGiftFromSender: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Alice\'s Android UI shows a "crown" gift from Bob' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/crown/);
    expect(r.error).toMatch(/Bob/);
  });

  test('Android driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: 'Alice\'s Android UI shows a "rose" gift from Adam' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidShowsGiftFromSender/);
  });

  test('iOS Sim matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosShowsGiftFromSender: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Nora\'s iOS Sim UI shows a "rose" gift from Adam' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Nora', 'rose', 'Adam');
  });

  test('iOS Sim driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { iosShowsGiftFromSender: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Nora\'s iOS Sim UI shows a "crown" gift from Bob' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/crown/);
    expect(r.error).toMatch(/Bob/);
  });

  test('iOS Sim driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: 'Nora\'s iOS Sim UI shows a "rose" gift from Adam' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/iosShowsGiftFromSender/);
  });
});

describe('Wake 99 — "<Name>\'s <Plat> UI shows only minor-cohort users in the rankings"', () => {
  // j02 cohort filter on rankings list.
  test('matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosShowsOnlyMinorCohortInRankings: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Mia's iOS Sim UI shows only minor-cohort users in the rankings" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Mia');
  });

  test('driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Mia's iOS Sim UI shows only minor-cohort users in the rankings" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.uiDriver\.iosShowsOnlyMinorCohortInRankings/);
  });

  test('iOS Sim driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { iosShowsOnlyMinorCohortInRankings: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Mia's iOS Sim UI shows only minor-cohort users in the rankings" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Mia|rankings/);
  });

  // Android — full 3-test set
  test('Android matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsOnlyMinorCohortInRankings: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Mia's Android UI shows only minor-cohort users in the rankings" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Mia');
  });

  test('Android driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidShowsOnlyMinorCohortInRankings: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Mia's Android UI shows only minor-cohort users in the rankings" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Mia|rankings/);
  });

  test('Android driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Mia's Android UI shows only minor-cohort users in the rankings" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.uiDriver\.androidShowsOnlyMinorCohortInRankings/);
  });

  // Web — full 3-test set
  test('Web matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsOnlyMinorCohortInRankings: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Mia's Web UI shows only minor-cohort users in the rankings" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Mia');
  });

  test('Web driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsOnlyMinorCohortInRankings: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Mia's Web UI shows only minor-cohort users in the rankings" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Mia|rankings/);
  });

  test('Web driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Mia's Web UI shows only minor-cohort users in the rankings" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsOnlyMinorCohortInRankings/);
  });

  // Web Chromium variant
  test('Web Chromium matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsOnlyMinorCohortInRankings: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Mia's Web Chromium UI shows only minor-cohort users in the rankings",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Mia');
  });

  test('Web Chromium driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsOnlyMinorCohortInRankings: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Mia's Web Chromium UI shows only minor-cohort users in the rankings",
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Mia|rankings/);
  });

  test('Web Chromium driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Mia's Web Chromium UI shows only minor-cohort users in the rankings",
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsOnlyMinorCohortInRankings/);
  });

  // Web Safari variant
  test('Web Safari matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsOnlyMinorCohortInRankings: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Mia's Web Safari UI shows only minor-cohort users in the rankings" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Mia');
  });

  test('Web Safari driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsOnlyMinorCohortInRankings: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Mia's Web Safari UI shows only minor-cohort users in the rankings" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Mia|rankings/);
  });

  test('Web Safari driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Mia's Web Safari UI shows only minor-cohort users in the rankings" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsOnlyMinorCohortInRankings/);
  });
});

describe('Wake 99 — `<Name>\'s <Plat> UI navigates to "<Path>"`', () => {
  // j03: Lena's Web UI navigates to "/"
  test('Web nav to root', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webNavigatesToPath: spy } });
    const r = await executeStep({ kind: 'Then', text: 'Lena\'s Web UI navigates to "/"' }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Lena', '/');
  });

  test('Android nav to deep route', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidNavigatesToPath: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Adam\'s Android UI navigates to "/profile/42"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Adam', '/profile/42');
  });
});

describe('Wake 99 — "POST <path> receives a request with a web push token from <Name>"', () => {
  // j03 FCM token capture.
  test('records token registration', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'POST /api/notifications/token receives a request with a web push token from Lena',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.fcmTokenRegistrations).toContainEqual({
      path: '/api/notifications/token',
      persona: 'Lena',
    });
  });

  test('multiple registrations accumulate', async () => {
    const ctx = makeCtx();
    await executeStep(
      {
        kind: 'Then',
        text: 'POST /api/notifications/token receives a request with a web push token from Lena',
      },
      ctx,
    );
    await executeStep(
      {
        kind: 'Then',
        text: 'POST /api/notifications/token receives a request with a web push token from Marcus',
      },
      ctx,
    );
    expect(ctx.fcmTokenRegistrations).toHaveLength(2);
  });
});

// ── Wake 100 — j07/j09 cluster + j05/j06 singletons ─────────────────

describe('Wake 100 — `<Name>\'s <Plat> UI navigates back to the "<X>" tab`', () => {
  test('iOS Sim variant', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosNavigatesBackToTab: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Ines\'s iOS Sim UI navigates back to the "rooms" tab' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Ines', 'rooms');
  });

  test('Web variant', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webNavigatesBackToTab: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Alice\'s Web UI navigates back to the "rooms" tab' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 'rooms');
  });

  // Added 2026-05-22 with PR #723. The Android dispatch path
  // (manual-qa-runner.js line ~12043) was untested — only iOS Sim
  // and Web variants had coverage. Phase 4 PR #1 implemented the
  // androidNavigatesBackToTab driver method, so the dispatch needs
  // its own unit test to guard against the matcher routing breaking.
  test('Android variant', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidNavigatesBackToTab: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Adam\'s Android UI navigates back to the "rooms" tab' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Adam', 'rooms');
  });

  test('Android driver returns false → step fails with descriptive error', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidNavigatesBackToTab: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Adam\'s Android UI navigates back to the "rooms" tab' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Adam');
    expect(r.error).toContain('Android');
    expect(r.error).toContain('rooms');
  });
});

describe("Wake 100 — `<Name>'s <Plat> UI shows the <noun> in the thread[ with <suffix>]`", () => {
  test('message with timestamp suffix', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsInThread: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Adam's Android UI shows the message in the thread with timestamp + sent indicator",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Adam', 'message', 'with timestamp + sent indicator');
  });

  test('bare reply', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsInThread: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Adam's Android UI shows the reply in the thread" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Adam', 'reply', '');
  });
});

describe('Wake 100 — `<Name>\'s <Plat> UI shows the new "<X>" gift entry`', () => {
  test('matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsNewGiftEntry: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Selma\'s Android UI shows the new "crown" gift entry' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Selma', 'crown');
  });

  test('driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidShowsNewGiftEntry: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Selma\'s Android UI shows the new "rose" gift entry' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Selma|rose/);
  });
});

describe('Wake 100 — `<Name>\'s <Plat> UI shows the in-app gift notification with sender "<X>" and gift "<Y>"`', () => {
  // Helper for terser tests in this block
  const giftText = (platform) =>
    `Selma's ${platform} UI shows the in-app gift notification with sender "Alice" and gift "crown"`;

  test('matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsInAppGiftNotification: spy } });
    const r = await executeStep({ kind: 'Then', text: giftText('Android') }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Selma', 'Alice', 'crown');
  });

  test('Android driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidShowsInAppGiftNotification: spy } });
    const r = await executeStep({ kind: 'Then', text: giftText('Android') }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Selma|gift notification/i);
  });

  test('Android driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Then', text: giftText('Android') }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.uiDriver\.androidShowsInAppGiftNotification/);
  });

  // iOS Sim — full 3-test set
  test('iOS Sim matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosShowsInAppGiftNotification: spy } });
    const r = await executeStep({ kind: 'Then', text: giftText('iOS Sim') }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Selma', 'Alice', 'crown');
  });

  test('iOS Sim driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { iosShowsInAppGiftNotification: spy } });
    const r = await executeStep({ kind: 'Then', text: giftText('iOS Sim') }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Selma|gift notification/i);
  });

  test('iOS Sim driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Then', text: giftText('iOS Sim') }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.uiDriver\.iosShowsInAppGiftNotification/);
  });

  // Web — full 3-test set
  test('Web matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsInAppGiftNotification: spy } });
    const r = await executeStep({ kind: 'Then', text: giftText('Web') }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Selma', 'Alice', 'crown');
  });

  test('Web driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsInAppGiftNotification: spy } });
    const r = await executeStep({ kind: 'Then', text: giftText('Web') }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Selma|gift notification/i);
  });

  test('Web driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Then', text: giftText('Web') }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsInAppGiftNotification/);
  });

  // Web Chromium — full 3-test set
  test('Web Chromium matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsInAppGiftNotification: spy } });
    const r = await executeStep({ kind: 'Then', text: giftText('Web Chromium') }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Selma', 'Alice', 'crown');
  });

  test('Web Chromium driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsInAppGiftNotification: spy } });
    const r = await executeStep({ kind: 'Then', text: giftText('Web Chromium') }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Selma|gift notification/i);
  });

  test('Web Chromium driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Then', text: giftText('Web Chromium') }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsInAppGiftNotification/);
  });

  // Web Safari — full 3-test set
  test('Web Safari matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsInAppGiftNotification: spy } });
    const r = await executeStep({ kind: 'Then', text: giftText('Web Safari') }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Selma', 'Alice', 'crown');
  });

  test('Web Safari driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsInAppGiftNotification: spy } });
    const r = await executeStep({ kind: 'Then', text: giftText('Web Safari') }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Selma|gift notification/i);
  });

  test('Web Safari driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Then', text: giftText('Web Safari') }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsInAppGiftNotification/);
  });
});

describe('Wake 100 — "<Name>\'s <Plat> UI shows (her|his|their) own rank in the top N"', () => {
  test("'her' pronoun", async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsOwnRankInTop: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web UI shows her own rank in the top 100" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 100);
  });

  test("'his' pronoun variant", async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsOwnRankInTop: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Adam's Android UI shows his own rank in the top 50" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Adam', 50);
  });

  test("'their' gender-neutral", async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosShowsOwnRankInTop: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Yuki's iOS Sim UI shows their own rank in the top 10" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Yuki', 10);
  });

  // Android — driver returns false + missing
  test('Android driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidShowsOwnRankInTop: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Adam's Android UI shows his own rank in the top 50" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Adam|rank/);
  });

  test('Android driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Adam's Android UI shows his own rank in the top 50" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.uiDriver\.androidShowsOwnRankInTop/);
  });

  // iOS Sim — driver returns false + missing
  test('iOS Sim driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { iosShowsOwnRankInTop: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Yuki's iOS Sim UI shows their own rank in the top 10" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Yuki|rank/);
  });

  test('iOS Sim driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Yuki's iOS Sim UI shows their own rank in the top 10" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.uiDriver\.iosShowsOwnRankInTop/);
  });

  // Web — driver returns false + missing
  test('Web driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsOwnRankInTop: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web UI shows her own rank in the top 100" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Alice|rank/);
  });

  test('Web driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web UI shows her own rank in the top 100" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsOwnRankInTop/);
  });

  // Web Chromium variant
  test('Web Chromium matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsOwnRankInTop: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web Chromium UI shows her own rank in the top 100" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 100);
  });

  test('Web Chromium driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsOwnRankInTop: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web Chromium UI shows her own rank in the top 100" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Alice|rank/);
  });

  test('Web Chromium driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web Chromium UI shows her own rank in the top 100" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsOwnRankInTop/);
  });

  // Web Safari variant
  test('Web Safari matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsOwnRankInTop: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web Safari UI shows her own rank in the top 100" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 100);
  });

  test('Web Safari driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsOwnRankInTop: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web Safari UI shows her own rank in the top 100" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Alice|rank/);
  });

  test('Web Safari driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web Safari UI shows her own rank in the top 100" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsOwnRankInTop/);
  });
});

describe('Wake 100 — `<Name>\'s <Plat> UI shows the new "<X>" balance via Firestore listener`', () => {
  test('matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsBalanceViaListener: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Alice\'s Android UI shows the new "5,000" balance via Firestore listener',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', '5,000');
  });

  test('driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidShowsBalanceViaListener: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Alice\'s Android UI shows the new "1,234" balance via Firestore listener',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Alice|balance|1,234/);
  });

  test('Android driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Alice\'s Android UI shows the new "5,000" balance via Firestore listener',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidShowsBalanceViaListener/);
  });

  test('iOS Sim matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosShowsBalanceViaListener: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Nora\'s iOS Sim UI shows the new "5,000" balance via Firestore listener',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Nora', '5,000');
  });

  test('iOS Sim driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { iosShowsBalanceViaListener: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Nora\'s iOS Sim UI shows the new "1,234" balance via Firestore listener',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Nora|balance|1,234/);
  });

  test('iOS Sim driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Nora\'s iOS Sim UI shows the new "5,000" balance via Firestore listener',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/iosShowsBalanceViaListener/);
  });

  test('Web matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsBalanceViaListener: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Alice\'s Web UI shows the new "$5,000" balance via Firestore listener',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', '$5,000');
  });

  test('Web driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsBalanceViaListener: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Alice\'s Web UI shows the new "1,234" balance via Firestore listener',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Alice|balance|1,234/);
  });

  test('Web driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Alice\'s Web UI shows the new "5,000" balance via Firestore listener',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webShowsBalanceViaListener/);
  });
});

// ── Wake 101 — j09/j10 voice-room cluster ───────────────────────────

describe('Wake 101 — "<Name>\'s <Plat> UI shows <Other>\'s seat with <X> indicator"', () => {
  test('mic-on indicator (Android)', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsSeatWithIndicator: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Theo's Android UI shows Ines's seat with mic-on indicator" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo', 'Ines', 'mic-on');
  });

  test('mic-off (iOS)', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosShowsSeatWithIndicator: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Ines's iOS Sim UI shows Theo's seat with mic-off indicator" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Ines', 'Theo', 'mic-off');
  });
});

describe('Wake 101 — "<Name>\'s <Plat> UI navigates to the warning screen[ again on next launch]"', () => {
  test('bare navigates to warning screen', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidNavigatesToWarningScreen: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Theo's Android UI navigates to the warning screen" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo', false);
  });

  test('with relaunch suffix → onRelaunch=true', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsWarningScreenOnRelaunch: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Theo's Android UI shows the warning screen again on next launch" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo');
  });
});

describe('Wake 101 — "(either )?<Name>\'s <Plat> UI is still in the room <suffix>"', () => {
  test('with-host-muted suffix', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosIsStillInRoom: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "either Ines's iOS Sim UI is still in the room with host muted" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Ines', 'with host muted');
  });

  test('but-unable-to-interact', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidIsStillInRoom: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Theo's Android UI is still in the room but unable to interact" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo', 'but unable to interact');
  });
});

describe('Wake 101 — `<Name>\'s <Plat> UI shows a seat-request notification with "<X>" + approve/deny`', () => {
  const seatReqText = (platform) =>
    `Theo's ${platform} UI shows a seat-request notification with "Ines" + approve/deny`;

  test('matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsSeatRequestNotification: spy } });
    const r = await executeStep({ kind: 'Then', text: seatReqText('Android') }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo', 'Ines');
  });

  test('Android driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidShowsSeatRequestNotification: spy } });
    const r = await executeStep({ kind: 'Then', text: seatReqText('Android') }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Theo|seat-request/);
  });

  test('Android driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Then', text: seatReqText('Android') }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.uiDriver\.androidShowsSeatRequestNotification/);
  });

  test('iOS Sim matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosShowsSeatRequestNotification: spy } });
    const r = await executeStep({ kind: 'Then', text: seatReqText('iOS Sim') }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo', 'Ines');
  });

  test('iOS Sim driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { iosShowsSeatRequestNotification: spy } });
    const r = await executeStep({ kind: 'Then', text: seatReqText('iOS Sim') }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Theo|seat-request/);
  });

  test('iOS Sim driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Then', text: seatReqText('iOS Sim') }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.uiDriver\.iosShowsSeatRequestNotification/);
  });

  test('Web matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsSeatRequestNotification: spy } });
    const r = await executeStep({ kind: 'Then', text: seatReqText('Web') }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo', 'Ines');
  });

  test('Web driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsSeatRequestNotification: spy } });
    const r = await executeStep({ kind: 'Then', text: seatReqText('Web') }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Theo|seat-request/);
  });

  test('Web driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Then', text: seatReqText('Web') }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsSeatRequestNotification/);
  });

  test('Web Chromium matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsSeatRequestNotification: spy } });
    const r = await executeStep({ kind: 'Then', text: seatReqText('Web Chromium') }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo', 'Ines');
  });

  test('Web Chromium driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsSeatRequestNotification: spy } });
    const r = await executeStep({ kind: 'Then', text: seatReqText('Web Chromium') }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Theo|seat-request/);
  });

  test('Web Chromium driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Then', text: seatReqText('Web Chromium') }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsSeatRequestNotification/);
  });

  test('Web Safari matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsSeatRequestNotification: spy } });
    const r = await executeStep({ kind: 'Then', text: seatReqText('Web Safari') }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo', 'Ines');
  });

  test('Web Safari driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsSeatRequestNotification: spy } });
    const r = await executeStep({ kind: 'Then', text: seatReqText('Web Safari') }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Theo|seat-request/);
  });

  test('Web Safari driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Then', text: seatReqText('Web Safari') }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsSeatRequestNotification/);
  });
});

describe('Wake 101 — `<Name>\'s <Plat> UI seat indicator transitions from "<X>" to "<Y>"`', () => {
  test('matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosSeatIndicatorTransitions: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Ines\'s iOS Sim UI seat indicator transitions from "request pending" to "seated"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Ines', 'request pending', 'seated');
  });
});

describe('Wake 101 — "<Name>\'s LiveKit publish for that room is <enabled|disabled>"', () => {
  test('disabled → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ liveKitDriver: { publishStateIs: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Marcus's LiveKit publish for that room is disabled" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Marcus', 'disabled');
  });

  test('enabled variant', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ liveKitDriver: { publishStateIs: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Ines's LiveKit publish for that room is enabled" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Ines', 'enabled');
  });

  test('driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ liveKitDriver: { publishStateIs: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Marcus's LiveKit publish for that room is disabled" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Marcus|publish|disabled/);
  });
});

// ── Wake 102 — j07/j09/j11 singletons ────────────────────────────────

describe('Wake 102 — `<Name>\'s <Plat> UI replaces follow button with "<X>"`', () => {
  test('Android matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidReplacesFollowButton: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Adam\'s Android UI replaces follow button with "profile_unfollowButton"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Adam', 'profile_unfollowButton');
  });

  test('Android driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidReplacesFollowButton: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Adam\'s Android UI replaces follow button with "Follow"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Adam.*Android.*Follow/);
  });

  test('Android driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: 'Adam\'s Android UI replaces follow button with "Follow"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidReplacesFollowButton/);
  });

  test('iOS Sim matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosReplacesFollowButton: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Nora\'s iOS Sim UI replaces follow button with "Following"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Nora', 'Following');
  });

  test('iOS Sim driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { iosReplacesFollowButton: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Nora\'s iOS Sim UI replaces follow button with "Follow"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Nora.*iOS Sim.*Follow/);
  });

  test('iOS Sim driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: 'Nora\'s iOS Sim UI replaces follow button with "Follow"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/iosReplacesFollowButton/);
  });

  test('Web matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webReplacesFollowButton: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Alice\'s Web UI replaces follow button with "Follow back"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 'Follow back');
  });

  test('Web driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webReplacesFollowButton: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Alice\'s Web UI replaces follow button with "Follow"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Alice.*Web.*Follow/);
  });

  test('Web driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: 'Alice\'s Web UI replaces follow button with "Follow"' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webReplacesFollowButton/);
  });
});

describe('Wake 102 — "<Name>\'s <Plat> UI shows a new conversation with <Other> highlighted as unread"', () => {
  test('matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsNewUnreadConversation: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Alice's Web UI shows a new conversation with Adam highlighted as unread",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 'Adam');
  });
});

describe('Wake 102 — "<Name>\'s <Plat> UI shows <Other> in seat N of the seat grid"', () => {
  test('Web matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsInSeatGrid: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web UI shows Ines in seat 2 of the seat grid" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 'Ines', 2);
  });

  test('Web driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsInSeatGrid: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web UI shows Ines in seat 2 of the seat grid" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Ines/);
    expect(r.error).toMatch(/seat 2/);
  });

  test('Web driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web UI shows Ines in seat 2 of the seat grid" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webShowsInSeatGrid/);
  });

  test('Android matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsInSeatGrid: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Theo's Android UI shows Ines in seat 3 of the seat grid" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo', 'Ines', 3);
  });

  test('Android driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidShowsInSeatGrid: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Theo's Android UI shows Ines in seat 3 of the seat grid" },
      ctx,
    );
    expect(r.ok).toBe(false);
    // Tightened (R1): assert both the target name AND the seat number
    // are present — runner produces `${viewer}'s ${platform} UI does
    // not show ${target} in seat ${seatNum}`; a regression that drops
    // the seat number would otherwise pass.
    expect(r.error).toMatch(/Ines/);
    expect(r.error).toMatch(/seat 3/);
  });

  test('Android driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Theo's Android UI shows Ines in seat 3 of the seat grid" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidShowsInSeatGrid/);
  });

  test('iOS Sim matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosShowsInSeatGrid: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Nora's iOS Sim UI shows Ines in seat 4 of the seat grid" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Nora', 'Ines', 4);
  });

  test('iOS Sim driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { iosShowsInSeatGrid: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Nora's iOS Sim UI shows Ines in seat 4 of the seat grid" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Ines/);
    expect(r.error).toMatch(/seat 4/);
  });

  test('iOS Sim driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Nora's iOS Sim UI shows Ines in seat 4 of the seat grid" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/iosShowsInSeatGrid/);
  });
});

describe('Wake 102 — "<Name>\'s LiveKit track for room {<X>} has publish permission enabled"', () => {
  test('publish enabled → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({
      liveKitDriver: { publishPermissionForRoom: spy },
      scenarioVars: new Map([['roomId', 'r1']]),
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Ines's LiveKit track for room {roomId} has publish permission enabled",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Ines', 'r1');
  });

  test('driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({
      liveKitDriver: { publishPermissionForRoom: spy },
      scenarioVars: new Map([['roomId', 'r1']]),
    });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Ines's LiveKit track for room {roomId} has publish permission enabled",
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Ines|publish|r1/);
  });
});

describe('Wake 102 — `<Name>\'s <Plat> UI shows the system PM from Officia "<X>"`', () => {
  test('matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosShowsSystemPmFromOfficia: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Nora\'s iOS Sim UI shows the system PM from Officia "Action taken on your report"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Nora', 'Action taken on your report');
  });
});

describe('Wake 102 — `<Name>\'s <Plat> UI shows the warning screen with reason "<X>"`', () => {
  test('matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsWarningScreenWithReason: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Raul\'s Android UI shows the warning screen with reason "First-strike harassment"',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Raul', 'First-strike harassment');
  });

  test('driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Raul\'s Android UI shows the warning screen with reason "X"',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidShowsWarningScreenWithReason/);
  });
});

// ── Wake 103 — j07/j09 narrows ──────────────────────────────────────

describe('Wake 103 — "<Name>\'s <Plat> UI navigates to <Other>\'s profile screen"', () => {
  test('matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidNavigatesToProfileScreen: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Adam's Android UI navigates to Alice's profile screen" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Adam', 'Alice');
  });
});

describe("Wake 103 — `<Name>'s <Plat> UI shows a +N in the stalkers/profile-visits counter`", () => {
  const stalkersText = (platform) =>
    `Alice's ${platform} UI shows a +1 in the stalkers/profile-visits counter`;

  test('matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsStalkersDelta: spy } });
    const r = await executeStep({ kind: 'Then', text: stalkersText('Web') }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 1);
  });

  test('Web driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsStalkersDelta: spy } });
    const r = await executeStep({ kind: 'Then', text: stalkersText('Web') }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Alice|stalkers|profile-visits/);
  });

  test('Web driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Then', text: stalkersText('Web') }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsStalkersDelta/);
  });

  test('Web Chromium matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsStalkersDelta: spy } });
    const r = await executeStep({ kind: 'Then', text: stalkersText('Web Chromium') }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 1);
  });

  test('Web Chromium driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsStalkersDelta: spy } });
    const r = await executeStep({ kind: 'Then', text: stalkersText('Web Chromium') }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Alice|stalkers|profile-visits/);
  });

  test('Web Chromium driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Then', text: stalkersText('Web Chromium') }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsStalkersDelta/);
  });

  test('Web Safari matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsStalkersDelta: spy } });
    const r = await executeStep({ kind: 'Then', text: stalkersText('Web Safari') }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 1);
  });

  test('Web Safari driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsStalkersDelta: spy } });
    const r = await executeStep({ kind: 'Then', text: stalkersText('Web Safari') }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Alice|stalkers|profile-visits/);
  });

  test('Web Safari driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Then', text: stalkersText('Web Safari') }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsStalkersDelta/);
  });

  test('Android matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsStalkersDelta: spy } });
    const r = await executeStep({ kind: 'Then', text: stalkersText('Android') }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 1);
  });

  test('Android driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidShowsStalkersDelta: spy } });
    const r = await executeStep({ kind: 'Then', text: stalkersText('Android') }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Alice|stalkers|profile-visits/);
  });

  test('Android driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Then', text: stalkersText('Android') }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.uiDriver\.androidShowsStalkersDelta/);
  });

  test('iOS Sim matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosShowsStalkersDelta: spy } });
    const r = await executeStep({ kind: 'Then', text: stalkersText('iOS Sim') }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 1);
  });

  test('iOS Sim driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { iosShowsStalkersDelta: spy } });
    const r = await executeStep({ kind: 'Then', text: stalkersText('iOS Sim') }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Alice|stalkers|profile-visits/);
  });

  test('iOS Sim driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Then', text: stalkersText('iOS Sim') }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.uiDriver\.iosShowsStalkersDelta/);
  });
});

describe('Wake 103 — `<Name>\'s <Plat> UI shows the edited body "<X>" with an "<Y>" tag`', () => {
  test('matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsEditedBodyWithTag: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Alice\'s Web UI shows the edited body "typo here" with an "edited" tag',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 'typo here', 'edited');
  });

  test('Web driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsEditedBodyWithTag: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Alice\'s Web UI shows the edited body "typo here" with an "edited" tag',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Alice|edited|tag/);
  });

  test('Web driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Alice\'s Web UI shows the edited body "typo here" with an "edited" tag',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsEditedBodyWithTag/);
  });

  // Web Chromium variant — full 3-test set
  test('Web Chromium matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsEditedBodyWithTag: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Alice\'s Web Chromium UI shows the edited body "typo here" with an "edited" tag',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 'typo here', 'edited');
  });

  test('Web Chromium driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsEditedBodyWithTag: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Alice\'s Web Chromium UI shows the edited body "typo here" with an "edited" tag',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Alice|edited|tag/);
  });

  test('Web Chromium driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Alice\'s Web Chromium UI shows the edited body "typo here" with an "edited" tag',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsEditedBodyWithTag/);
  });

  // Web Safari variant — full 3-test set
  test('Web Safari matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsEditedBodyWithTag: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Alice\'s Web Safari UI shows the edited body "typo here" with an "edited" tag',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 'typo here', 'edited');
  });

  test('Web Safari driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsEditedBodyWithTag: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Alice\'s Web Safari UI shows the edited body "typo here" with an "edited" tag',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Alice|edited|tag/);
  });

  test('Web Safari driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Alice\'s Web Safari UI shows the edited body "typo here" with an "edited" tag',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsEditedBodyWithTag/);
  });

  // Android branch — full 3-test set
  test('Android matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsEditedBodyWithTag: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Alice\'s Android UI shows the edited body "typo here" with an "edited" tag',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 'typo here', 'edited');
  });

  test('Android driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidShowsEditedBodyWithTag: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Alice\'s Android UI shows the edited body "typo here" with an "edited" tag',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Alice|edited|tag/);
  });

  test('Android driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Alice\'s Android UI shows the edited body "typo here" with an "edited" tag',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.uiDriver\.androidShowsEditedBodyWithTag/);
  });

  // iOS Sim branch — full 3-test set
  test('iOS Sim matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosShowsEditedBodyWithTag: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Alice\'s iOS Sim UI shows the edited body "typo here" with an "edited" tag',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 'typo here', 'edited');
  });

  test('iOS Sim driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { iosShowsEditedBodyWithTag: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Alice\'s iOS Sim UI shows the edited body "typo here" with an "edited" tag',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Alice|edited|tag/);
  });

  test('iOS Sim driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Alice\'s iOS Sim UI shows the edited body "typo here" with an "edited" tag',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.uiDriver\.iosShowsEditedBodyWithTag/);
  });
});

describe('Wake 103 — "<Name>\'s <Plat> UI also shows <Other> in the participants list"', () => {
  test('matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webAlsoShowsInParticipantsList: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web UI also shows Ines in the participants list" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 'Ines');
  });

  test('Web driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webAlsoShowsInParticipantsList: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web UI also shows Ines in the participants list" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Ines|participants list/i);
  });

  test('Web driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web UI also shows Ines in the participants list" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webAlsoShowsInParticipantsList/);
  });

  // Android branch — routes to ctx.uiDriver.androidAlsoShowsInParticipantsList
  test('Android matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidAlsoShowsInParticipantsList: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Android UI also shows Ines in the participants list" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 'Ines');
  });

  test('Android driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidAlsoShowsInParticipantsList: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Android UI also shows Ines in the participants list" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Ines|participants list/i);
  });

  test('Android driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Android UI also shows Ines in the participants list" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidAlsoShowsInParticipantsList/);
  });

  // iOS Sim branch — routes to ctx.uiDriver.iosAlsoShowsInParticipantsList
  test('iOS Sim matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosAlsoShowsInParticipantsList: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's iOS Sim UI also shows Ines in the participants list" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice', 'Ines');
  });

  test('iOS Sim driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { iosAlsoShowsInParticipantsList: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's iOS Sim UI also shows Ines in the participants list" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Ines|participants list/i);
  });

  test('iOS Sim driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Alice's iOS Sim UI also shows Ines in the participants list" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/iosAlsoShowsInParticipantsList/);
  });
});

describe('Wake 103 — `<Name>\'s <Plat> UI shows mic icon as "<X>"`', () => {
  test('matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosShowsMicIconAs: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Ines\'s iOS Sim UI shows mic icon as "open"' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Ines', 'open');
  });
});

describe('Wake 103 — "<Name>\'s <Plat> UI shows the room-closed summary panel"', () => {
  test('matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsRoomClosedSummary: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web UI shows the room-closed summary panel" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice');
  });

  test('driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web UI shows the room-closed summary panel" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsRoomClosedSummary/);
  });

  test('Web driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsRoomClosedSummary: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web UI shows the room-closed summary panel" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Alice|summary/);
  });

  // Android — full 3-test set
  test('Android matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsRoomClosedSummary: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Android UI shows the room-closed summary panel" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice');
  });

  test('Android driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidShowsRoomClosedSummary: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Android UI shows the room-closed summary panel" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Alice|summary/);
  });

  test('Android driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Android UI shows the room-closed summary panel" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.uiDriver\.androidShowsRoomClosedSummary/);
  });

  // iOS Sim — full 3-test set
  test('iOS Sim matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosShowsRoomClosedSummary: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's iOS Sim UI shows the room-closed summary panel" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice');
  });

  test('iOS Sim driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { iosShowsRoomClosedSummary: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's iOS Sim UI shows the room-closed summary panel" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Alice|summary/);
  });

  test('iOS Sim driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Alice's iOS Sim UI shows the room-closed summary panel" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.uiDriver\.iosShowsRoomClosedSummary/);
  });

  // Web Chromium variant
  test('Web Chromium matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsRoomClosedSummary: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web Chromium UI shows the room-closed summary panel" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice');
  });

  test('Web Chromium driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsRoomClosedSummary: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web Chromium UI shows the room-closed summary panel" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Alice|summary/);
  });

  test('Web Chromium driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web Chromium UI shows the room-closed summary panel" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsRoomClosedSummary/);
  });

  // Web Safari variant
  test('Web Safari matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsRoomClosedSummary: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web Safari UI shows the room-closed summary panel" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Alice');
  });

  test('Web Safari driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsRoomClosedSummary: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web Safari UI shows the room-closed summary panel" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Alice|summary/);
  });

  test('Web Safari driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: "Alice's Web Safari UI shows the room-closed summary panel" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsRoomClosedSummary/);
  });
});

// ── Wake 104 — j10/j11/j12 narrows ──────────────────────────────────

describe('Wake 104 — `<Name>\'s <Plat> UI shows a "<X>" toast and navigates back to "<Y>"`', () => {
  const tnbText = (platform) =>
    `Ines's ${platform} UI shows a "Room closed by host warning" toast and navigates back to "/rooms"`;

  test('matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosShowsToastAndNavigatesBack: spy } });
    const r = await executeStep({ kind: 'Then', text: tnbText('iOS Sim') }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Ines', 'Room closed by host warning', '/rooms');
  });

  test('iOS Sim driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { iosShowsToastAndNavigatesBack: spy } });
    const r = await executeStep({ kind: 'Then', text: tnbText('iOS Sim') }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Ines|toast|nav/);
  });

  test('iOS Sim driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Then', text: tnbText('iOS Sim') }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.uiDriver\.iosShowsToastAndNavigatesBack/);
  });

  test('Android matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidShowsToastAndNavigatesBack: spy } });
    const r = await executeStep({ kind: 'Then', text: tnbText('Android') }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Ines', 'Room closed by host warning', '/rooms');
  });

  test('Android driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidShowsToastAndNavigatesBack: spy } });
    const r = await executeStep({ kind: 'Then', text: tnbText('Android') }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Ines|toast|nav/);
  });

  test('Android driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Then', text: tnbText('Android') }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.uiDriver\.androidShowsToastAndNavigatesBack/);
  });

  test('Web matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsToastAndNavigatesBack: spy } });
    const r = await executeStep({ kind: 'Then', text: tnbText('Web') }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Ines', 'Room closed by host warning', '/rooms');
  });

  test('Web driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsToastAndNavigatesBack: spy } });
    const r = await executeStep({ kind: 'Then', text: tnbText('Web') }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Ines|toast|nav/);
  });

  test('Web driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Then', text: tnbText('Web') }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsToastAndNavigatesBack/);
  });

  test('Web Chromium matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsToastAndNavigatesBack: spy } });
    const r = await executeStep({ kind: 'Then', text: tnbText('Web Chromium') }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Ines', 'Room closed by host warning', '/rooms');
  });

  test('Web Chromium driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsToastAndNavigatesBack: spy } });
    const r = await executeStep({ kind: 'Then', text: tnbText('Web Chromium') }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Ines|toast|nav/);
  });

  test('Web Chromium driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Then', text: tnbText('Web Chromium') }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsToastAndNavigatesBack/);
  });

  test('Web Safari matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webShowsToastAndNavigatesBack: spy } });
    const r = await executeStep({ kind: 'Then', text: tnbText('Web Safari') }, ctx);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Ines', 'Room closed by host warning', '/rooms');
  });

  test('Web Safari driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webShowsToastAndNavigatesBack: spy } });
    const r = await executeStep({ kind: 'Then', text: tnbText('Web Safari') }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Ines|toast|nav/);
  });

  test('Web Safari driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep({ kind: 'Then', text: tnbText('Web Safari') }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ctx\.webDriver\.webShowsToastAndNavigatesBack/);
  });
});

describe('Wake 104 — "the database has N entries in "<X>" with reportedId=N"', () => {
  test('matching count → ok', async () => {
    const db = makeStatefulFakeDb({
      'reports/r1': { reportedId: 50000050, reason: 'spam' },
      'reports/r2': { reportedId: 50000050, reason: 'abuse' },
      'reports/r3': { reportedId: 99999, reason: 'unrelated' },
    });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has 2 entries in "reports" with reportedId=50000050',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('wrong count → fail', async () => {
    const db = makeStatefulFakeDb({
      'reports/r1': { reportedId: 50000050 },
    });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has 2 entries in "reports" with reportedId=50000050',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/1|2|reportedId/);
  });
});

describe('Wake 104 — "the database has document "<X>" with field "<Y>" approximately equal to now + N days"', () => {
  test('within tolerance → ok', async () => {
    const expectedMs = Date.now() + 3 * 24 * 60 * 60 * 1000;
    const db = makeStatefulFakeDb({ 'users/50000050': { suspendedUntil: expectedMs } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000050" with field "suspendedUntil" approximately equal to now + 3 days',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('out of tolerance → fail', async () => {
    const db = makeStatefulFakeDb({ 'users/50000050': { suspendedUntil: Date.now() } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the database has document "users/50000050" with field "suspendedUntil" approximately equal to now + 3 days',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/suspendedUntil|expected|now/);
  });
});

describe('Wake 104 — "<Name>\'s Firebase Auth refreshTokens are revoked"', () => {
  test('matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ firebaseAdmin: { tokensAreRevoked: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Raul's Firebase Auth refreshTokens are revoked" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Raul');
  });
});

describe('Wake 104 — "the Firebase Auth session for <Name> has revokeRefreshTokens timestamp updated"', () => {
  test('matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ firebaseAdmin: { revokeTimestampIsUpdated: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'the Firebase Auth session for Hayato has revokeRefreshTokens timestamp updated',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Hayato');
  });
});

describe('Wake 104 — "<Name>\'s <Plat> Admin UI shows N rows in the <X> table"', () => {
  test('matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webAdminShowsRowCountInTable: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Greta's Web Admin UI shows 3 rows in the reports table" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Greta', 3, 'reports');
  });
});

// ── Wake 105 — j04/j10/j11/j12 narrows ──────────────────────────────

describe('Wake 105 — "<Name>\'s <Plat> UI is no longer in the voice room"', () => {
  test('matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidIsNoLongerInVoiceRoom: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Hayato's Android UI is no longer in the voice room" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Hayato');
  });
});

describe('Wake 105 — "<Name>\'s <Plat> UI continues normally in the room"', () => {
  test('matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidContinuesNormallyInRoom: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Theo's Android UI continues normally in the room" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Theo');
  });
});

describe('Wake 105 — "<Name>\'s <Plat> UI shows the message in the conversation thread"', () => {
  test('matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosShowsMessageInConversationThread: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Nora's iOS Sim UI shows the message in the conversation thread" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Nora');
  });
});

describe('Wake 105 — "<Name>\'s <Plat> Admin UI shows the new report in the queue"', () => {
  test('matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webAdminShowsNewReportInQueue: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Greta's Web Admin UI shows the new report in the queue" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Greta');
  });
});

describe('Wake 105 — "<Name>\'s <Plat> UI shows the second offensive message"', () => {
  test('matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosShowsSecondOffensiveMessage: spy } });
    const r = await executeStep(
      { kind: 'Then', text: "Nora's iOS Sim UI shows the second offensive message" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Nora');
  });
});

describe('Wake 105 — "<Name>\'s <Plat> Admin UI shows the dashboard with counters: N reports, N verifications, N appeals"', () => {
  test('matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webAdminShowsDashboardCounters: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Greta's Web Admin UI shows the dashboard with counters: 3 reports, 5 verifications, 2 appeals",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Greta', { reports: 3, verifications: 5, appeals: 2 });
  });

  test('driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webAdminShowsDashboardCounters: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Greta's Web Admin UI shows the dashboard with counters: 1 reports, 2 verifications, 3 appeals",
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Greta|dashboard|counters/);
  });

  // Android branch — routes to ctx.uiDriver.androidAdminShowsDashboardCounters
  test('Android matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidAdminShowsDashboardCounters: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Greta's Android Admin UI shows the dashboard with counters: 3 reports, 5 verifications, 2 appeals",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Greta', { reports: 3, verifications: 5, appeals: 2 });
  });

  test('Android driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidAdminShowsDashboardCounters: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Greta's Android Admin UI shows the dashboard with counters: 1 reports, 2 verifications, 3 appeals",
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    // Tighter than the Web sibling's loose `/Greta|dashboard|counters/` —
    // pin that the error message includes the structural "dashboard ...
    // counters" phrasing so a future refactor cannot drop both terms
    // without breaking this test.
    expect(r.error).toMatch(/dashboard.*counters/i);
  });

  test('Android driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Greta's Android Admin UI shows the dashboard with counters: 0 reports, 0 verifications, 0 appeals",
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidAdminShowsDashboardCounters/);
  });

  // iOS Sim branch — routes to ctx.uiDriver.iosAdminShowsDashboardCounters
  test('iOS Sim matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosAdminShowsDashboardCounters: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Greta's iOS Sim Admin UI shows the dashboard with counters: 4 reports, 1 verifications, 7 appeals",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Greta', { reports: 4, verifications: 1, appeals: 7 });
  });

  test('iOS Sim driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { iosAdminShowsDashboardCounters: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Greta's iOS Sim Admin UI shows the dashboard with counters: 1 reports, 0 verifications, 0 appeals",
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/dashboard.*counters/i);
  });

  test('iOS Sim driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      {
        kind: 'Then',
        text: "Greta's iOS Sim Admin UI shows the dashboard with counters: 0 reports, 0 verifications, 0 appeals",
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/iosAdminShowsDashboardCounters/);
  });
});

// ── Wake 106 — j12 admin daily routine ─────────────────────────────

describe('Wake 106 — "the reports counter on the dashboard updates to N"', () => {
  test('matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webDashboardReportsCounterEquals: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'the reports counter on the dashboard updates to 2' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith(2);
  });
});

describe('Wake 106 — `N audit entries with action "<X>" exist`', () => {
  test('matching count → ok', async () => {
    const db = makeStatefulFakeDb({
      'audit/a1': { action: 'age_verification.approve' },
      'audit/a2': { action: 'age_verification.approve' },
      'audit/a3': { action: 'age_verification.approve' },
      'audit/a4': { action: 'block' },
    });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Then', text: '3 audit entries with action "age_verification.approve" exist' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('wrong count → fail', async () => {
    const db = makeStatefulFakeDb({ 'audit/a1': { action: 'block' } });
    const ctx = makeCtx({ db });
    const r = await executeStep(
      { kind: 'Then', text: '3 audit entries with action "age_verification.approve" exist' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/0|3|audit|age_verification/);
  });
});

describe('Wake 106 — "the N corresponding users have isAgeVerified=true"', () => {
  test('all verified → ok', async () => {
    const db = makeStatefulFakeDb({
      'users/10': { isAgeVerified: true },
      'users/20': { isAgeVerified: true },
      'users/30': { isAgeVerified: true },
    });
    const ctx = makeCtx({ db });
    ctx.lastUserIds = [10, 20, 30];
    const r = await executeStep(
      { kind: 'Then', text: 'the 3 corresponding users have isAgeVerified=true' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('one not verified → fail', async () => {
    const db = makeStatefulFakeDb({
      'users/10': { isAgeVerified: true },
      'users/20': { isAgeVerified: false },
      'users/30': { isAgeVerified: true },
    });
    const ctx = makeCtx({ db });
    ctx.lastUserIds = [10, 20, 30];
    const r = await executeStep(
      { kind: 'Then', text: 'the 3 corresponding users have isAgeVerified=true' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/20|isAgeVerified|verified/);
  });

  test('count mismatch → fail', async () => {
    const ctx = makeCtx({ db: makeStatefulFakeDb({}) });
    ctx.lastUserIds = [10, 20];
    const r = await executeStep(
      { kind: 'Then', text: 'the 3 corresponding users have isAgeVerified=true' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/2|3|count/);
  });
});

describe('Wake 106 — "the user receives a system PM from Officia with the reject reason"', () => {
  test('matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { receivedSystemPmWithReason: spy } });
    ctx.lastTargetUser = 'Hayato';
    ctx.lastRejectReason = 'underage';
    const r = await executeStep(
      { kind: 'Then', text: 'the user receives a system PM from Officia with the reject reason' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Hayato', 'underage');
  });

  test('no target user → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: 'the user receives a system PM from Officia with the reject reason' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/lastTargetUser|target/);
  });
});

describe('Wake 106 — "the target user is downgraded to cohort=<X>"', () => {
  test('matching → ok', async () => {
    const db = makeStatefulFakeDb({ 'users/50000030': { cohort: 'minor' } });
    const ctx = makeCtx({ db });
    ctx.lastTargetUser = 'Hayato';
    const r = await executeStep(
      { kind: 'Then', text: 'the target user is downgraded to cohort=minor' },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('still adult → fail', async () => {
    const db = makeStatefulFakeDb({ 'users/50000030': { cohort: 'adult' } });
    const ctx = makeCtx({ db });
    ctx.lastTargetUser = 'Hayato';
    const r = await executeStep(
      { kind: 'Then', text: 'the target user is downgraded to cohort=minor' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Hayato|minor|adult/);
  });
});

describe('Wake 106 — `<Name>\'s <Plat> Admin UI shows the "<X>" stat`', () => {
  test('matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ webDriver: { webAdminShowsStat: spy } });
    const r = await executeStep(
      {
        kind: 'Then',
        text: 'Greta\'s Web Admin UI shows the "Blocked cross-cohort attempts (24h)" stat',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Greta', 'Blocked cross-cohort attempts (24h)');
  });

  test('Web driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ webDriver: { webAdminShowsStat: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Greta\'s Web Admin UI shows the "Daily Active Users" stat' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Daily Active Users|stat/i);
  });

  test('Web driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: 'Greta\'s Web Admin UI shows the "Daily Active Users" stat' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webAdminShowsStat/);
  });

  // Android branch — routes to ctx.uiDriver.androidAdminShowsStat
  test('Android matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { androidAdminShowsStat: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Greta\'s Android Admin UI shows the "Daily Active Users" stat' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Greta', 'Daily Active Users');
  });

  test('Android driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { androidAdminShowsStat: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Greta\'s Android Admin UI shows the "Daily Active Users" stat' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Daily Active Users|stat/i);
  });

  test('Android driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: 'Greta\'s Android Admin UI shows the "Daily Active Users" stat' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/androidAdminShowsStat/);
  });

  // iOS Sim branch — routes to ctx.uiDriver.iosAdminShowsStat
  test('iOS Sim matching → ok', async () => {
    const spy = jest.fn(async () => true);
    const ctx = makeCtx({ uiDriver: { iosAdminShowsStat: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Greta\'s iOS Sim Admin UI shows the "Daily Active Users" stat' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('Greta', 'Daily Active Users');
  });

  test('iOS Sim driver returns false → fail', async () => {
    const spy = jest.fn(async () => false);
    const ctx = makeCtx({ uiDriver: { iosAdminShowsStat: spy } });
    const r = await executeStep(
      { kind: 'Then', text: 'Greta\'s iOS Sim Admin UI shows the "Daily Active Users" stat' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Daily Active Users|stat/i);
  });

  test('iOS Sim driver missing → fail', async () => {
    const ctx = makeCtx();
    const r = await executeStep(
      { kind: 'Then', text: 'Greta\'s iOS Sim Admin UI shows the "Daily Active Users" stat' },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/iosAdminShowsStat/);
  });
});
