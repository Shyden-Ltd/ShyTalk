/**
 * check-test-defects.test.js
 *
 * The detector is a GATE: the gauntlet launcher refuses to start while it
 * reports anything, so a false positive blocks every run and a false negative
 * lets a test that proves nothing report green. Nothing verified it until now,
 * and it shipped four distinct classes of false positive before anyone read
 * what it was reporting:
 *
 *   1. `/^[a-z]/.test(name)` parsed as a test declaration
 *   2. prose inside a block comment parsed as code
 *   3. `}` inside a regex literal counted as a real brace, truncating bodies
 *   4. three real assertion idioms unknown to it (supertest `.expect(200)`,
 *      the `try { …; throw } catch { expect… }` must-throw pattern, and
 *      assertions delegated to same-file helpers)
 *
 * Every one of those is pinned below, alongside the true positives, so the
 * detector cannot quietly regress into crying wolf or into silence.
 *
 * Real module, real parser, real source strings — no doubles.
 */
const path = require('path');

const detector = require(path.resolve(__dirname, '../../../scripts/check-test-defects.js'));
const { scanJestSource } = detector;

const categoriesIn = (src) => scanJestSource(src).map((f) => f.category);

describe('true positives — tests that cannot fail', () => {
  test('an empty test body is NO-ASSERT', () => {
    expect(
      categoriesIn(`
        test('logs the thing', async () => {
          // Logging is handled by middleware, not individual routes
        });
      `),
    ).toEqual(['NO-ASSERT']);
  });

  test('a body that only sets up mocks and never asserts is NO-ASSERT', () => {
    expect(
      categoriesIn(`
        test('second login from new IP: new IP added to graph', async () => {
          mockDocGet.mockImplementation(() => Promise.resolve(makeGraphDoc('g1')));
          // After second login, graph should have 2 IPs
        });
      `),
    ).toEqual(['NO-ASSERT']);
  });

  test('an assertion behind a status check is GUARD-IF', () => {
    // The shape that let "GET /api/suggestions returns ETag header" pass on a
    // response with no ETag header.
    expect(
      categoriesIn(`
        test('returns ETag header', async () => {
          const res = await request(app).get('/api/suggestions');
          if (res.status === 200 && res.headers.etag) {
            expect(typeof res.headers.etag).toBe('string');
          }
        });
      `),
    ).toEqual(['GUARD-IF']);
  });

  test('nested guards are still GUARD-IF', () => {
    expect(
      categoriesIn(`
        test('new account: no suggestions initially', async () => {
          const res = await request(app).get('/api/suggestions/mine');
          if (res.status === 200) {
            if (res.body.suggestions) {
              expect(res.body.suggestions).toHaveLength(0);
            }
          }
        });
      `),
    ).toEqual(['GUARD-IF']);
  });

  test('an assertion only inside a ternary is GUARD-IF', () => {
    expect(
      categoriesIn(`
        test('x', () => {
          ok ? expect(a).toBe(1) : null;
        });
      `),
    ).toEqual(['GUARD-IF']);
  });

  test('an assertion only behind && is GUARD-IF', () => {
    expect(
      categoriesIn(`
        test('x', () => {
          ok && expect(a).toBe(1);
        });
      `),
    ).toEqual(['GUARD-IF']);
  });
});

describe('true negatives — tests that genuinely assert', () => {
  test('a plain unconditional expect is clean', () => {
    expect(categoriesIn(`test('x', () => { expect(1).toBe(1); });`)).toEqual([]);
  });

  test('one unconditional assertion clears a body that also has guarded ones', () => {
    // Conditional assertions are fine as EXTRA coverage; they are only a
    // defect when they are the ONLY coverage.
    expect(
      categoriesIn(`
        test('x', async () => {
          const res = await request(app).get('/x');
          expect(res.status).toBe(200);
          if (res.body.etag) { expect(typeof res.body.etag).toBe('string'); }
        });
      `),
    ).toEqual([]);
  });

  test('supertest .expect(200) counts as an assertion', () => {
    // Hundreds of route tests assert ONLY this way; counting just `expect(`
    // reported every one of them as asserting nothing.
    expect(
      categoriesIn(`
        test('an EXPIRED device ban no longer blocks', async () => {
          const caller = await mintRealUser({ uniqueId: '5003' });
          await probeAs(caller).expect(200);
        });
      `),
    ).toEqual([]);
  });

  test('assertSucceeds / assertFails count as assertions', () => {
    // The Firestore-rules suites assert exclusively through these.
    expect(
      categoriesIn(`
        test('banned user still reads their OWN users doc', async () => {
          await assertSucceeds(dbFor(BANNED).doc('users/1').get());
        });
      `),
    ).toEqual([]);
    expect(
      categoriesIn(`test('denied', async () => { await assertFails(db.doc('x').set({})); });`),
    ).toEqual([]);
  });

  test('the try/throw/catch must-throw idiom is not a guarded assertion', () => {
    // The catch is guaranteed to run or the explicit throw fails the test, so
    // its assertions are not optional.
    expect(
      categoriesIn(`
        test('attaches status to thrown error', async () => {
          try {
            await apiCall('POST', '/api/users', {});
            throw new Error('expected apiCall to throw');
          } catch (err) {
            expect(err.status).toBe(400);
          }
        });
      `),
    ).toEqual([]);
  });

  test('a guarded expect with a throwing fall-through is not GUARD-IF', () => {
    // `if (ok) { expect(...); return; } throw new Error(...)` cannot pass
    // while proving nothing — the throw IS the failure path.
    expect(
      categoriesIn(`
        test('does NOT contain dangerous pattern', () => {
          const idx = SRC.indexOf(pattern);
          if (idx === -1) {
            expect(idx).toBe(-1);
            return;
          }
          throw new Error('found ' + pattern);
        });
      `),
    ).toEqual([]);
  });

  test('an assertion delegated to a same-file helper counts', () => {
    expect(
      categoriesIn(`
        function expectDenied(res) { expect(res.status).toBe(403); }
        test('blocks a banned caller', async () => {
          expectDenied(await probeAs(banned));
        });
      `),
    ).toEqual([]);
  });

  test('helper-calls-helper resolves transitively', () => {
    expect(
      categoriesIn(`
        function base(res) { expect(res.status).toBe(403); }
        const expectDenied = (res) => base(res);
        test('blocks', async () => { expectDenied(await probeAs(banned)); });
      `),
    ).toEqual([]);
  });

  test('an unconditional throw is an assertion', () => {
    expect(categoriesIn(`test('x', () => { doWork(); throw new Error('nope'); });`)).toEqual([]);
  });

  test('a body whose ONLY failure path is a conditional throw is still GUARD-IF', () => {
    // Deliberate, and not the same as the fall-through case above: when `ok`
    // is truthy this body runs to completion having proved nothing, which is
    // exactly the defect. A guard-throw is only sufficient when something
    // unconditional also asserts, or when the throw is the fall-through.
    expect(categoriesIn(`test('x', () => { if (!ok) throw new Error('nope'); });`)).toEqual([
      'GUARD-IF',
    ]);
  });
});

describe('the parser is a parser, not a pattern match', () => {
  test('a regex predicate named .test() is not a test declaration', () => {
    // `\\b(?:test|it)\\s*\\(` matched the `test(` inside `/^[a-z]/.test(name)`,
    // so every regex predicate in the suite was reported as a defective test.
    expect(
      categoriesIn(`
        const isSlug = (name) => /^[a-z]/.test(name) && !/[^a-z0-9_-]/.test(name);
        test('x', () => { expect(isSlug('ab')).toBe(true); });
      `),
    ).toEqual([]);
  });

  test('prose inside a block comment is not code', () => {
    expect(
      categoriesIn(`
        /**
         * A. Workflow env exposes GH_PAT_PROJECT but gh CLI ignores it.
         *    test('this is prose, not a test', () => {})
         */
        test('x', () => { expect(1).toBe(1); });
      `),
    ).toEqual([]);
  });

  test('braces inside a regex literal do not truncate the test body', () => {
    // `/\\$\\{[^}]*\\}/` was counted as real braces, so the body ended early
    // and the expect below it fell outside the test.
    expect(
      categoriesIn(`
        test('every substitution is escaped', () => {
          const subs = SRC.match(/\\$\\{[^}]*reportCount[^}]*\\}/g) || [];
          expect(subs.length).toBeGreaterThan(0);
        });
      `),
    ).toEqual([]);
  });

  test('a string containing a brace does not truncate the body', () => {
    expect(
      categoriesIn(`
        test('x', () => {
          const s = '} not a brace {';
          expect(s).toContain('not');
        });
      `),
    ).toEqual([]);
  });

  test('an unparseable file is reported, never silently skipped', () => {
    // A file the detector cannot read is a file it cannot vouch for — exactly
    // the blind spot it exists to remove.
    const findings = scanJestSource("test('x', () => { this is not javascript ");
    expect(findings.map((f) => f.category)).toEqual(['PARSE-FAIL']);
    expect(findings[0].text).toMatch(/could not parse/);
  });
});

describe('parked and skipped tests', () => {
  test('test.skip with a title is PARKED', () => {
    expect(detector.classifySkipLine("  test.skip('does a thing', () => {})")).toBe('PARKED');
  });

  test('test.skip with a condition is SKIP-COND', () => {
    expect(detector.classifySkipLine('  test.skip(isRoot, "cannot test as root")')).toBe(
      'SKIP-COND',
    );
  });

  test('a bare test.skip() is SKIP-COND', () => {
    expect(detector.classifySkipLine('  test.skip();')).toBe('SKIP-COND');
  });

  test('an ordinary test line is neither', () => {
    expect(detector.classifySkipLine("  test('does a thing', () => {})")).toBeNull();
  });

  test('a parked test is not ALSO reported as asserting nothing', () => {
    // Double-reporting one defect as two inflates the count and makes the
    // ratchet lie about progress.
    expect(categoriesIn(`test.skip('parked', () => {});`)).toEqual([]);
  });
});
