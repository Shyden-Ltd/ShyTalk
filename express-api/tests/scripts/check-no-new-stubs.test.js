/**
 * check-no-new-stubs.test.js — SHY-0108 (EPIC-0003 Phase X)
 *
 * Tests the anti-regression ratchet guard. Real-only (CLAUDE.md § No
 * Stubs): the scan logic is exercised against REAL temporary files on
 * disk (real `fs`) and against the REAL repo — never `jest.mock`, which
 * would be self-defeating for the very guard that bans it.
 *
 * The three banned literals are built by string concatenation so this
 * test source is itself free of the patterns it exercises (defence in
 * depth alongside the guard's own self-exclusion of these two files).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const guard = require('../../../scripts/check-no-new-stubs');

const REPO_ROOT = path.resolve(__dirname, '../../..');

const JEST_MOCK = 'jest' + ".mock('../src/thing')";
const FAKE_REPO = 'class ' + 'FakeUserRepository : UserRepository {}';
const PAGE_ROUTE = 'await page' + ".route('**/api/**', (r) => r.fulfill({ status: 200 }))";

describe('SHY-0108 classifyContent — value matrix (exact booleans)', () => {
  test('jest.mock → jestMock only', () => {
    expect(guard.classifyContent(JEST_MOCK)).toEqual({
      jestMock: true,
      fakeRepository: false,
      pageRoute: false,
    });
  });

  test('Fake<Word>Repository → fakeRepository only', () => {
    expect(guard.classifyContent(FAKE_REPO)).toEqual({
      jestMock: false,
      fakeRepository: true,
      pageRoute: false,
    });
  });

  test('page.route → pageRoute only', () => {
    expect(guard.classifyContent(PAGE_ROUTE)).toEqual({
      jestMock: false,
      fakeRepository: false,
      pageRoute: true,
    });
  });

  test('clean content → all false', () => {
    expect(guard.classifyContent('const repo = realUserRepository();')).toEqual({
      jestMock: false,
      fakeRepository: false,
      pageRoute: false,
    });
  });

  test('all three present → all true', () => {
    expect(guard.classifyContent(`${JEST_MOCK}\n${FAKE_REPO}\n${PAGE_ROUTE}`)).toEqual({
      jestMock: true,
      fakeRepository: true,
      pageRoute: true,
    });
  });

  test('a plain "Repository" with no Fake prefix is NOT flagged', () => {
    expect(guard.classifyContent('const x = new UserRepository();').fakeRepository).toBe(false);
  });
});

describe('SHY-0108 scanFiles — real temp tree + extension gating', () => {
  let dir;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shy0108-'));
    fs.writeFileSync(path.join(dir, 'a.test.js'), JEST_MOCK);
    fs.mkdirSync(path.join(dir, 'kt'));
    fs.writeFileSync(path.join(dir, 'kt', 'Foo.kt'), FAKE_REPO);
    fs.writeFileSync(path.join(dir, 'b.spec.ts'), PAGE_ROUTE);
    fs.writeFileSync(path.join(dir, 'clean.test.js'), 'const x = real();');
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  const read = (p) => fs.readFileSync(path.join(dir, p), 'utf8');

  test('buckets each offender into its category', () => {
    const off = guard.scanFiles(['a.test.js', 'kt/Foo.kt', 'b.spec.ts', 'clean.test.js'], read);
    expect(off.jestMock).toEqual(['a.test.js']);
    expect(off.fakeRepository).toEqual(['kt/Foo.kt']);
    expect(off.pageRoute).toEqual(['b.spec.ts']);
  });

  test('jest.mock / page.route patterns do NOT apply to a .kt file (extension gate)', () => {
    const p = 'kt/Weird.kt';
    fs.writeFileSync(path.join(dir, p), `${JEST_MOCK}\n${PAGE_ROUTE}`);
    const off = guard.scanFiles([p], read);
    expect(off.jestMock).toEqual([]);
    expect(off.pageRoute).toEqual([]);
  });

  test('Fake*Repository pattern does NOT apply to a .js file (extension gate)', () => {
    const p = 'js-with-fake.test.js';
    fs.writeFileSync(path.join(dir, p), FAKE_REPO);
    const off = guard.scanFiles([p], read);
    expect(off.fakeRepository).toEqual([]);
  });

  test('output is sorted (deterministic)', () => {
    fs.writeFileSync(path.join(dir, 'z.test.js'), JEST_MOCK);
    fs.writeFileSync(path.join(dir, 'm.test.js'), JEST_MOCK);
    const off = guard.scanFiles(['z.test.js', 'm.test.js', 'a.test.js'], read);
    expect(off.jestMock).toEqual(['a.test.js', 'm.test.js', 'z.test.js']);
  });
});

describe('SHY-0108 diffBaseline — new vs stale', () => {
  const baseline = { jestMock: ['known.test.js'], fakeRepository: [], pageRoute: [] };

  test('a new offender (not in baseline) is reported under newOffenders', () => {
    const off = { jestMock: ['known.test.js', 'new.test.js'], fakeRepository: [], pageRoute: [] };
    const d = guard.diffBaseline(off, baseline);
    expect(d.newOffenders.jestMock).toEqual(['new.test.js']);
    expect(d.staleEntries.jestMock).toEqual([]);
    expect(guard.isClean(d)).toBe(false);
  });

  test('a baseline entry that no longer offends is reported under staleEntries', () => {
    const off = { jestMock: [], fakeRepository: [], pageRoute: [] };
    const d = guard.diffBaseline(off, baseline);
    expect(d.staleEntries.jestMock).toEqual(['known.test.js']);
    expect(d.newOffenders.jestMock).toEqual([]);
    expect(guard.isClean(d)).toBe(false);
  });

  test('offenders exactly equal to baseline → clean', () => {
    const d = guard.diffBaseline(
      { jestMock: ['known.test.js'], fakeRepository: [], pageRoute: [] },
      baseline,
    );
    expect(guard.isClean(d)).toBe(true);
  });
});

describe('SHY-0108 committed baseline is in sync with the real repo', () => {
  test('real repo scan equals committed baseline (guard green on this branch)', () => {
    const off = guard.scanRepo({ cwd: REPO_ROOT });
    const baseline = guard.loadBaseline({ cwd: REPO_ROOT });
    const d = guard.diffBaseline(off, baseline);
    expect(d.newOffenders).toEqual({ jestMock: [], fakeRepository: [], pageRoute: [] });
    expect(d.staleEntries).toEqual({ jestMock: [], fakeRepository: [], pageRoute: [] });
  });

  test('baseline is non-trivial (captures the known EPIC-0003 debt)', () => {
    const baseline = guard.loadBaseline({ cwd: REPO_ROOT });
    // Sanity: the drain has real debt to ratchet — not an empty file.
    expect(baseline.jestMock.length).toBeGreaterThan(100);
    expect(baseline.fakeRepository.length).toBeGreaterThan(10);
    expect(baseline.pageRoute.length).toBeGreaterThan(0);
  });
});
