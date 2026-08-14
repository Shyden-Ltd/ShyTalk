/* eslint-disable sonarjs/no-os-command-from-path --
 * This test spawns hardcoded binaries (`git`, `node`) with literal argv to
 * drive the REAL guard against REAL throwaway git repos — no user-controlled
 * command and no PATH manipulation. Matches the sibling check-story / check-epic
 * / check-node-version frontmatter test convention. */
/**
 * check-no-new-stubs.test.js — SHY-0108 + SHY-0112 (EPIC-0003)
 *
 * Tests the anti-regression ratchet guard. Real-only (CLAUDE.md § No
 * Stubs): the scan logic is exercised against REAL temporary files on
 * disk (real `fs`) and REAL throwaway git repos driven via the real CLI —
 * never `jest.mock`, which would be self-defeating for the very guard
 * that bans it.
 *
 * SHY-0112 widened the detectors (jest.fn / make*Fake* / mockResolved* /
 * Kotlin mockk / iOS doubles) and made the ratchet policy-aware (doubles
 * permitted ONLY in unit-test locations). Every banned literal is built by
 * string concatenation so this test source stays free of the patterns it
 * exercises (defence in depth alongside the guard's self-exclusion of
 * these two files).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const guard = require('../../../scripts/check-no-new-stubs');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SCRIPT_ABS = path.join(REPO_ROOT, guard.SCRIPT_REL);

/**
 * Real-only test helpers (CLAUDE.md § No Stubs). No jest.mock, no faked
 * collaborators — these build a REAL throwaway git repo on disk and drive
 * the REAL guard against it.
 */
function makeTempRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shy0108repo-'));
  const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  git(['init', '-q']);
  git(['config', 'user.email', 'shy0108@test.local']);
  git(['config', 'user.name', 'shy0108']);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  git(['add', '-A']); // gitTrackedFiles uses `git ls-files` → staged is enough
  return dir;
}

/**
 * Run `fn` while capturing the process's REAL stdout/stderr writes (output
 * inspection, NOT a behavioural double), restoring the originals afterwards.
 */
function capture(fn) {
  const outChunks = [];
  const errChunks = [];
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  process.stdout.write = (s) => {
    outChunks.push(String(s));
    return true;
  };
  process.stderr.write = (s) => {
    errChunks.push(String(s));
    return true;
  };
  let ret;
  try {
    ret = fn();
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
  return { ret, stdout: outChunks.join(''), stderr: errChunks.join('') };
}

const JEST_MOCK = 'jest' + ".mock('../src/thing')";
// Koin-binding form (no `class` keyword) so it matches ONLY fakeRepository —
// keeps the value matrix a clean 1:1. The structural `class Fake*Repository`
// overlap with iosDouble is covered explicitly in the SHY-0112 scanFiles block.
const FAKE_REPO = 'single<UserRepository> { ' + 'FakeUserRepository() }';
const PAGE_ROUTE = 'await page' + ".route('**/api/**', (r) => r.fulfill({ status: 200 }))";
// A real Kotlin fake-repo declaration: `class Fake*Repository` matches BOTH the
// Kotlin fakeRepository regex AND the structural iOS-double regex at the content
// level; the extension gate is what disambiguates at scan time.
const KT_CLASS_FAKE = 'class ' + 'FakeOrderRepository : OrderRepository {}';

// SHY-0112 blind-spot detectors (also concatenation-built so this source stays
// pattern-free). One literal per new CATEGORIES key.
const JEST_FN = 'const db = jest' + '.fn();';
const HAND_FAKE = 'const db = make' + 'StatefulFakeDb({ users: [] });';
const MOCK_RESOLVED = 'svc.fetchUser.mock' + 'ResolvedValue({ id: 1 });';
const MOCKK = 'val repo = mock' + 'k<UserRepository>(relaxed = true)';
const IOS_DOUBLE = 'class Mock' + 'URLProtocol: URLProtocol {}';

// Per-arm coverage of the multi-alternative regexes (one literal per branch so
// dropping any arm fails a test). kotlinMock has 3 arms; mockResolved has 7.
const MOCKK_PAREN = 'val repo = mock' + 'k(relaxed = true)';
const MOCKITO = 'Mock' + 'ito.when(repo.get()).thenReturn(null)';
const AT_MOCKK = '@Mock' + 'K private lateinit var repo: UserRepository';
const MOCK_REJECTED = 'svc.fetchUser.mock' + 'RejectedValue(new Error("x"));';
const MOCK_RETURN = 'svc.calc.mock' + 'ReturnValue(42);';
const MOCK_RESOLVED_ONCE = 'svc.fetchUser.mock' + 'ResolvedValueOnce(null);';
const MOCK_REJECTED_ONCE = 'svc.fetchUser.mock' + 'RejectedValueOnce(new Error());';
const MOCK_RETURN_ONCE = 'svc.calc.mock' + 'ReturnValueOnce(7);';
const MOCK_IMPL = 'svc.calc.mock' + 'Implementation(() => 1);';
const MOCK_IMPL_ONCE = 'svc.calc.mock' + 'ImplementationOnce(() => 2);';

/**
 * Category-agnostic expectation helpers — derived from the live CATEGORIES so a
 * future category addition never again forces a full-object assertion rewrite.
 */
const allFalse = () => Object.fromEntries(guard.CATEGORIES.map((c) => [c.key, false]));
const classify = (trueKeys) => ({ ...allFalse(), ...trueKeys });
const emptyOffenders = () => Object.fromEntries(guard.CATEGORIES.map((c) => [c.key, []]));

describe('SHY-0108 classifyContent — value matrix (exact booleans)', () => {
  test('jest.mock → jestMock only', () => {
    expect(guard.classifyContent(JEST_MOCK)).toEqual(classify({ jestMock: true }));
  });

  test('Fake<Word>Repository → fakeRepository only', () => {
    expect(guard.classifyContent(FAKE_REPO)).toEqual(classify({ fakeRepository: true }));
  });

  test('page.route → pageRoute only', () => {
    expect(guard.classifyContent(PAGE_ROUTE)).toEqual(classify({ pageRoute: true }));
  });

  test('clean content → all false', () => {
    expect(guard.classifyContent('const repo = realUserRepository();')).toEqual(classify({}));
  });

  test('all three present → all true', () => {
    expect(guard.classifyContent(`${JEST_MOCK}\n${FAKE_REPO}\n${PAGE_ROUTE}`)).toEqual(
      classify({ jestMock: true, fakeRepository: true, pageRoute: true }),
    );
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
    expect(d.newOffenders).toEqual(emptyOffenders());
    expect(d.staleEntries).toEqual(emptyOffenders());
  });

  test('baseline is non-trivial (captures the known EPIC-0003 debt)', () => {
    const baseline = guard.loadBaseline({ cwd: REPO_ROOT });
    // Sanity: the drain has real debt to ratchet — not an empty file.
    expect(baseline.jestMock.length).toBeGreaterThan(100);
    expect(baseline.fakeRepository.length).toBeGreaterThan(10);
    expect(baseline.pageRoute.length).toBeGreaterThan(0);
  });
});

describe('SHY-0108 diffBaseline — rename + multi-category coverage', () => {
  test('a renamed offender surfaces as BOTH a stale old-path AND a new new-path', () => {
    const baseline = { jestMock: ['old.test.js'], fakeRepository: [], pageRoute: [] };
    const off = { jestMock: ['new.test.js'], fakeRepository: [], pageRoute: [] };
    const d = guard.diffBaseline(off, baseline);
    expect(d.newOffenders.jestMock).toEqual(['new.test.js']);
    expect(d.staleEntries.jestMock).toEqual(['old.test.js']);
    expect(guard.isClean(d)).toBe(false);
  });

  test('new offenders across all three categories are each reported', () => {
    const d = guard.diffBaseline(
      { jestMock: ['j.test.js'], fakeRepository: ['F.kt'], pageRoute: ['p.spec.ts'] },
      { jestMock: [], fakeRepository: [], pageRoute: [] },
    );
    expect(d.newOffenders.jestMock).toEqual(['j.test.js']);
    expect(d.newOffenders.fakeRepository).toEqual(['F.kt']);
    expect(d.newOffenders.pageRoute).toEqual(['p.spec.ts']);
    expect(guard.isClean(d)).toBe(false);
  });

  test('new offenders across ALL 8 categories are each reported (every CATEGORIES entry participates)', () => {
    const d = guard.diffBaseline(
      {
        jestMock: ['j.test.js'],
        fakeRepository: ['F.kt'],
        pageRoute: ['p.spec.ts'],
        jestFn: ['fn.test.js'],
        handRolledFake: ['hand.test.js'],
        mockResolved: ['res.test.js'],
        kotlinMock: ['Mk.kt'],
        iosDouble: ['Dbl.swift'],
      },
      emptyOffenders(),
    );
    expect(d.newOffenders.jestFn).toEqual(['fn.test.js']);
    expect(d.newOffenders.handRolledFake).toEqual(['hand.test.js']);
    expect(d.newOffenders.mockResolved).toEqual(['res.test.js']);
    expect(d.newOffenders.kotlinMock).toEqual(['Mk.kt']);
    expect(d.newOffenders.iosDouble).toEqual(['Dbl.swift']);
    expect(guard.isClean(d)).toBe(false);
  });
});

describe('SHY-0108 scanFiles — unreadable file is skipped (catch branch)', () => {
  test('a path whose readFile throws is skipped; readable offenders still bucketed', () => {
    const read = (p) => {
      if (p === 'unreadable.test.js') throw new Error('EISDIR');
      return JEST_MOCK;
    };
    const off = guard.scanFiles(['unreadable.test.js', 'ok.test.js'], read);
    expect(off.jestMock).toEqual(['ok.test.js']);
  });
});

describe('SHY-0108 loadBaseline — error paths (the exit-2 sources)', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shy0108base-'));
    fs.mkdirSync(path.join(dir, 'scripts'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('missing baseline file → throws "Baseline not found"', () => {
    expect(() => guard.loadBaseline({ cwd: dir })).toThrow(/Baseline not found/);
  });

  test('malformed JSON → throws "malformed JSON"', () => {
    fs.writeFileSync(path.join(dir, guard.BASELINE_REL), '{ not valid json');
    expect(() => guard.loadBaseline({ cwd: dir })).toThrow(/malformed JSON/);
  });

  test('a non-array category → throws "must be an array"', () => {
    fs.writeFileSync(path.join(dir, guard.BASELINE_REL), JSON.stringify({ jestMock: 'nope' }));
    expect(() => guard.loadBaseline({ cwd: dir })).toThrow(/must be an array/);
  });

  test('missing categories normalise to empty arrays (no throw)', () => {
    fs.writeFileSync(
      path.join(dir, guard.BASELINE_REL),
      JSON.stringify({ jestMock: ['x.test.js'] }),
    );
    expect(guard.loadBaseline({ cwd: dir })).toEqual({
      ...emptyOffenders(),
      jestMock: ['x.test.js'],
    });
  });
});

describe('SHY-0108 gitTrackedFiles — real subprocess', () => {
  test('returns repo-relative paths for the real repo (incl. the guard script)', () => {
    const files = guard.gitTrackedFiles(REPO_ROOT);
    expect(Array.isArray(files)).toBe(true);
    expect(files).toContain('scripts/check-no-new-stubs.js');
  });

  test('a non-git directory → throws "git ls-files failed"', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shy0108nogit-'));
    try {
      expect(() => guard.gitTrackedFiles(dir)).toThrow(/git ls-files failed/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('SHY-0108 generateBaseline — deterministic write', () => {
  let repo;
  beforeEach(() => {
    repo = makeTempRepo({ 'a.test.js': JEST_MOCK, 'scripts/keep.txt': 'so scripts/ exists' });
  });
  afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

  test('writes a baseline capturing the offender; sorted + trailing newline', () => {
    const off = guard.generateBaseline({ cwd: repo });
    expect(off.jestMock).toEqual(['a.test.js']);
    const written = fs.readFileSync(path.join(repo, guard.BASELINE_REL), 'utf8');
    expect(written.endsWith('\n')).toBe(true);
    expect(JSON.parse(written)).toEqual({
      ...emptyOffenders(),
      jestMock: ['a.test.js'],
    });
  });

  test('is deterministic — two runs produce byte-identical output', () => {
    guard.generateBaseline({ cwd: repo });
    const first = fs.readFileSync(path.join(repo, guard.BASELINE_REL), 'utf8');
    guard.generateBaseline({ cwd: repo });
    const second = fs.readFileSync(path.join(repo, guard.BASELINE_REL), 'utf8');
    expect(second).toBe(first);
  });
});

describe('SHY-0108 reportAndExit — return code + emitted annotations', () => {
  test('clean diff → returns 0 and prints the remaining-debt summary', () => {
    const baseline = guard.loadBaseline({ cwd: REPO_ROOT });
    const clean = guard.diffBaseline(baseline, baseline);
    const { ret, stdout } = capture(() => guard.reportAndExit(clean, baseline));
    expect(ret).toBe(0);
    expect(stdout).toMatch(/clean/);
  });

  test('a NEW offender → returns 1 and emits a ::error file= NEW annotation', () => {
    const baseline = { jestMock: [], fakeRepository: [], pageRoute: [] };
    const diff = guard.diffBaseline(
      { jestMock: ['new.test.js'], fakeRepository: [], pageRoute: [] },
      baseline,
    );
    const { ret, stderr } = capture(() => guard.reportAndExit(diff, baseline));
    expect(ret).toBe(1);
    expect(stderr).toContain('::error file=new.test.js::NEW jest.mock(');
  });

  test('a STALE entry → returns 1 and emits a STALE baseline annotation', () => {
    const baseline = { jestMock: ['gone.test.js'], fakeRepository: [], pageRoute: [] };
    const diff = guard.diffBaseline({ jestMock: [], fakeRepository: [], pageRoute: [] }, baseline);
    const { ret, stderr } = capture(() => guard.reportAndExit(diff, baseline));
    expect(ret).toBe(1);
    expect(stderr).toContain('::error file=gone.test.js::STALE baseline entry');
  });

  test('a NEW offender in a SHY-0112 category emits its own label (jestFn)', () => {
    const diff = guard.diffBaseline(
      { ...emptyOffenders(), jestFn: ['fn.test.js'] },
      emptyOffenders(),
    );
    const { ret, stderr } = capture(() => guard.reportAndExit(diff, emptyOffenders()));
    expect(ret).toBe(1);
    expect(stderr).toContain('::error file=fn.test.js::NEW jest.fn(');
  });

  test('a STALE entry in a SHY-0112 category emits its label (iosDouble)', () => {
    const baseline = { ...emptyOffenders(), iosDouble: ['Gone.swift'] };
    const diff = guard.diffBaseline(emptyOffenders(), baseline);
    const { ret, stderr } = capture(() => guard.reportAndExit(diff, baseline));
    expect(ret).toBe(1);
    expect(stderr).toContain('::error file=Gone.swift::STALE');
    expect(stderr).toContain('iOS Mock/Fake/Stub/Spy type');
  });
});

describe('SHY-0108 main() — CLI exit-code contract (real spawned process)', () => {
  const runCli = (args, cwd) => spawnSync('node', [SCRIPT_ABS, ...args], { cwd, encoding: 'utf8' });

  test('--help → exit 0 + usage banner', () => {
    const r = runCli(['--help'], REPO_ROOT);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Bans (ratchet');
  });

  test('-h shorthand → exit 0 + usage banner', () => {
    const r = runCli(['-h'], REPO_ROOT);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Bans (ratchet');
  });

  test('clean repo (baseline matches offenders) → exit 0', () => {
    const repo = makeTempRepo({
      'a.test.js': JEST_MOCK,
      'scripts/no-stubs-baseline.json': `${JSON.stringify(
        { jestMock: ['a.test.js'], fakeRepository: [], pageRoute: [] },
        null,
        2,
      )}\n`,
    });
    try {
      const r = runCli([], repo);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/clean/);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('a NEW offender absent from the baseline → exit 1', () => {
    const repo = makeTempRepo({
      'a.test.js': JEST_MOCK,
      'scripts/no-stubs-baseline.json': `${JSON.stringify(
        { jestMock: [], fakeRepository: [], pageRoute: [] },
        null,
        2,
      )}\n`,
    });
    try {
      const r = runCli([], repo);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('ratchet violated');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('a STALE baseline entry (no longer offends) → exit 1 at the process boundary', () => {
    const repo = makeTempRepo({
      'scripts/no-stubs-baseline.json': `${JSON.stringify(
        { jestMock: ['gone.test.js'], fakeRepository: [], pageRoute: [] },
        null,
        2,
      )}\n`,
    });
    try {
      const r = runCli([], repo);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('STALE baseline entry');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('missing baseline → exit 2', () => {
    const repo = makeTempRepo({ 'a.test.js': 'const x = real();' });
    try {
      const r = runCli([], repo);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/Baseline not found/);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('malformed baseline → exit 2', () => {
    const repo = makeTempRepo({
      'a.test.js': 'const x = real();',
      'scripts/no-stubs-baseline.json': '{ broken',
    });
    try {
      const r = runCli([], repo);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/malformed JSON/);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('--generate-baseline → exit 0 + writes the baseline file', () => {
    const repo = makeTempRepo({ 'a.test.js': JEST_MOCK, 'scripts/keep.txt': 'x' });
    try {
      const r = runCli(['--generate-baseline'], repo);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/wrote/);
      const written = JSON.parse(fs.readFileSync(path.join(repo, guard.BASELINE_REL), 'utf8'));
      expect(written.jestMock).toEqual(['a.test.js']);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// SHY-0112 — the keystone: blind-spot detectors + unit↔integration boundary.
// ───────────────────────────────────────────────────────────────────────────

describe('SHY-0112 classifyContent — blind-spot detector value matrix', () => {
  test('jest.fn() collaborator → jestFn only', () => {
    expect(guard.classifyContent(JEST_FN)).toEqual(classify({ jestFn: true }));
  });

  test('make*Fake* hand-rolled factory → handRolledFake only', () => {
    expect(guard.classifyContent(HAND_FAKE)).toEqual(classify({ handRolledFake: true }));
  });

  // mockResolved has 7 surface forms — one assertion per regex alternative so
  // dropping any arm fails a test (C3).
  test.each([
    ['mockResolvedValue', MOCK_RESOLVED],
    ['mockRejectedValue', MOCK_REJECTED],
    ['mockReturnValue', MOCK_RETURN],
    ['mockResolvedValueOnce', MOCK_RESOLVED_ONCE],
    ['mockRejectedValueOnce', MOCK_REJECTED_ONCE],
    ['mockReturnValueOnce', MOCK_RETURN_ONCE],
    ['mockImplementation', MOCK_IMPL],
    ['mockImplementationOnce', MOCK_IMPL_ONCE],
  ])('%s → mockResolved only', (_label, literal) => {
    expect(guard.classifyContent(literal)).toEqual(classify({ mockResolved: true }));
  });

  // kotlinMock has 3 arms (mockk[(<] · Mockito. · @Mock*) — cover each (C2).
  test.each([
    ['mockk< generics', MOCKK],
    ['mockk( call', MOCKK_PAREN],
    ['Mockito. static', MOCKITO],
    ['@MockK annotation', AT_MOCKK],
  ])('%s → kotlinMock only', (_label, literal) => {
    expect(guard.classifyContent(literal)).toEqual(classify({ kotlinMock: true }));
  });

  test('iOS Mock/Fake/Stub/Spy type declaration → iosDouble only', () => {
    expect(guard.classifyContent(IOS_DOUBLE)).toEqual(classify({ iosDouble: true }));
  });

  test('a real collaborator name (no double pattern) → all false', () => {
    expect(guard.classifyContent('const repo = realUserRepository(); await repo.get();')).toEqual(
      classify({}),
    );
  });
});

describe('SHY-0112 scanFiles — new-category extension + path gating', () => {
  let dir;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shy0112scan-'));
    fs.writeFileSync(path.join(dir, 'collab.test.js'), JEST_FN);
    fs.mkdirSync(path.join(dir, 'kt'));
    fs.writeFileSync(path.join(dir, 'kt', 'Repo.kt'), MOCKK);
    fs.writeFileSync(path.join(dir, 'kt', 'NotKotlin.js'), MOCKK); // mockk in a .js → not bucketed
    fs.mkdirSync(path.join(dir, 'iosApp', 'iosAppTests'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'iosApp', 'iosAppTests', 'Dbl.swift'), IOS_DOUBLE);
    fs.mkdirSync(path.join(dir, 'iosApp', 'iosApp'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'iosApp', 'iosApp', 'Prod.swift'), IOS_DOUBLE); // product → not bucketed
    fs.mkdirSync(path.join(dir, 'iosApp', 'iosAppUITests'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'iosApp', 'iosAppUITests', 'Spy.swift'), IOS_DOUBLE);
    fs.writeFileSync(
      path.join(dir, 'kt', 'HandFake.kt'),
      'fun makeFakeRepo() = makeStatefulFakeDb()',
    );
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  const read = (p) => fs.readFileSync(path.join(dir, p), 'utf8');

  test('jest.fn buckets to jestFn for a .js file', () => {
    expect(guard.scanFiles(['collab.test.js'], read).jestFn).toEqual(['collab.test.js']);
  });

  test('mockk buckets to kotlinMock for .kt but NOT for .js (extension gate)', () => {
    const off = guard.scanFiles(['kt/Repo.kt', 'kt/NotKotlin.js'], read);
    expect(off.kotlinMock).toEqual(['kt/Repo.kt']);
  });

  test('iosDouble applies to a .swift TEST path but NOT to a .swift product path', () => {
    const off = guard.scanFiles(['iosApp/iosAppTests/Dbl.swift', 'iosApp/iosApp/Prod.swift'], read);
    expect(off.iosDouble).toEqual(['iosApp/iosAppTests/Dbl.swift']);
  });

  test('iosDouble also applies to a *UITests/ path (SWIFT_TEST_PATH Tests? variant)', () => {
    expect(guard.scanFiles(['iosApp/iosAppUITests/Spy.swift'], read).iosDouble).toEqual([
      'iosApp/iosAppUITests/Spy.swift',
    ]);
  });

  test('make*Fake* does NOT apply to a .kt file (extension gate; it is a fakeRepository concern there)', () => {
    const off = guard.scanFiles(['kt/HandFake.kt'], read);
    expect(off.handRolledFake).toEqual([]);
  });

  test('classifyContent flags the structural overlap: class Fake*Repository → BOTH fakeRepository and iosDouble', () => {
    expect(guard.classifyContent(KT_CLASS_FAKE)).toEqual(
      classify({ fakeRepository: true, iosDouble: true }),
    );
  });

  test('a Kotlin class Fake*Repository is bucketed ONLY as fakeRepository (extension gate beats the structural iosDouble match)', () => {
    fs.writeFileSync(path.join(dir, 'kt', 'ClassFake.kt'), KT_CLASS_FAKE);
    const off = guard.scanFiles(['kt/ClassFake.kt'], read);
    expect(off.fakeRepository).toEqual(['kt/ClassFake.kt']);
    expect(off.iosDouble).toEqual([]);
  });
});

describe('SHY-0112 isUnitTestLocation — the boundary predicate', () => {
  test.each([
    // JS — dir-based + suffix-based unit conventions
    ['express-api/tests/unit/pure.test.js', true],
    ['express-api/tests/unit/nested/pure.test.js', true],
    ['express-api/src/format.unit.test.js', true],
    ['express-api/src/format.unit.test.ts', true],
    // JS — NOT the convention (substring / integration locations)
    ['express-api/tests/unit-helpers/x.test.js', false],
    ['express-api/tests/cron/x.test.js', false],
    ['express-api/tests/integration/x.test.js', false],
    // Kotlin — non-instrumented host source sets = unit
    ['shared/src/commonTest/kotlin/Foo.kt', true],
    ['shared/src/jvmTest/kotlin/Foo.kt', true],
    ['shared/src/androidHostTest/kotlin/Foo.kt', true],
    ['app/src/test/java/Foo.kt', true],
    // Kotlin — instrumented = real-only (counted) — all 3 KT_INSTRUMENTED arms
    ['app/src/androidTest/java/Foo.kt', false],
    ['app/src/androidInstrumentedTest/java/Foo.kt', false],
    ['app/src/androidUiTest/java/Foo.kt', false],
    ['shared/src/androidUiTest/kotlin/Foo.kt', false],
    // iOS — no unit-location convention yet → always counted
    ['iosApp/iosAppTests/Foo.swift', false],
    ['iosApp/iosAppUITests/Foo.swift', false],
    // non-test production code is never a unit-test location
    ['express-api/src/server.js', false],
    ['shared/src/commonMain/kotlin/Foo.kt', false],
  ])('%s → unit=%s', (rel, expected) => {
    expect(guard.isUnitTestLocation(rel)).toBe(expected);
  });
});

describe('SHY-0112 policy-aware ratchet — boundary honoured end-to-end (real CLI)', () => {
  const runCli = (args, cwd) => spawnSync('node', [SCRIPT_ABS, ...args], { cwd, encoding: 'utf8' });
  const EMPTY_BASELINE = `${JSON.stringify({}, null, 2)}\n`;
  const withRepo = (files, fn) => {
    const repo = makeTempRepo({ 'scripts/no-stubs-baseline.json': EMPTY_BASELINE, ...files });
    try {
      return fn(repo);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  };

  test('a NEW jest.fn in an integration location (tests/cron) → exit 1, named under jestFn', () => {
    withRepo({ 'express-api/tests/cron/foo.test.js': JEST_FN }, (repo) => {
      const r = runCli([], repo);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('::error file=express-api/tests/cron/foo.test.js::NEW jest.fn(');
    });
  });

  test('the SAME jest.mock in a unit location (tests/unit + .unit.test.js) → exit 0', () => {
    withRepo({ 'express-api/tests/unit/pure.unit.test.js': JEST_MOCK }, (repo) => {
      const r = runCli([], repo);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/clean/);
    });
  });

  test('a Fake*Repository in a Kotlin host source set (commonTest) → exit 0 (exempt)', () => {
    withRepo({ 'shared/src/commonTest/kotlin/FakeFoo.kt': FAKE_REPO }, (repo) => {
      expect(runCli([], repo).status).toBe(0);
    });
  });

  test('the SAME Fake*Repository in an instrumented source set (androidTest) → exit 1', () => {
    withRepo({ 'app/src/androidTest/java/FakeFoo.kt': FAKE_REPO }, (repo) => {
      const r = runCli([], repo);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('app/src/androidTest/java/FakeFoo.kt');
    });
  });

  test('a NEW mockk in an instrumented Kotlin test (androidTest) → exit 1', () => {
    withRepo({ 'app/src/androidTest/java/RepoTest.kt': MOCKK }, (repo) => {
      const r = runCli([], repo);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(
        '::error file=app/src/androidTest/java/RepoTest.kt::NEW mockk/Mockito introduced',
      );
    });
  });

  test('a NEW Mockito. usage in an instrumented Kotlin test → exit 1 (the Mockito arm, full pipeline)', () => {
    withRepo({ 'app/src/androidTest/java/RepoTest.kt': MOCKITO }, (repo) => {
      const r = runCli([], repo);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(
        '::error file=app/src/androidTest/java/RepoTest.kt::NEW mockk/Mockito introduced',
      );
    });
  });

  test('the SAME mockk in a host Kotlin unit test (jvmTest) → exit 0 (policy permits)', () => {
    withRepo({ 'shared/src/jvmTest/kotlin/RepoTest.kt': MOCKK }, (repo) => {
      expect(runCli([], repo).status).toBe(0);
    });
  });

  test('a NEW iOS double in iosAppTests → exit 1', () => {
    withRepo({ 'iosApp/iosAppTests/StubThing.swift': IOS_DOUBLE }, (repo) => {
      const r = runCli([], repo);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('iosApp/iosAppTests/StubThing.swift');
    });
  });

  test('the tests/unit-helpers substring is NOT a unit location → scanned → exit 1', () => {
    withRepo({ 'express-api/tests/unit-helpers/foo.test.js': JEST_FN }, (repo) => {
      expect(runCli([], repo).status).toBe(1);
    });
  });

  test('a STALE baseline entry under a NEW category (jestFn) → exit 1', () => {
    const repo = makeTempRepo({
      'scripts/no-stubs-baseline.json': `${JSON.stringify({ jestFn: ['gone.test.js'] }, null, 2)}\n`,
      'express-api/src/keep.js': 'const x = real();',
    });
    try {
      const r = runCli([], repo);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('STALE baseline entry');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('--generate-baseline honours the boundary: a unit-location offender is NOT written to the baseline', () => {
    const repo = makeTempRepo({
      'express-api/tests/unit/pure.unit.test.js': JEST_MOCK, // unit → exempt
      'express-api/tests/cron/job.test.js': JEST_FN, // integration → counted
      'scripts/keep.txt': 'x',
    });
    try {
      expect(runCli(['--generate-baseline'], repo).status).toBe(0);
      const written = JSON.parse(fs.readFileSync(path.join(repo, guard.BASELINE_REL), 'utf8'));
      expect(written.jestMock).toEqual([]); // the unit-location jest.mock was exempted
      expect(written.jestFn).toEqual(['express-api/tests/cron/job.test.js']);
      // and a verify run on the generated baseline is immediately clean
      expect(runCli([], repo).status).toBe(0);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe('SHY-0112 CLAUDE.md §No-Stubs encodes the unit-only policy + boundary convention', () => {
  const claudeMd = fs.readFileSync(path.join(REPO_ROOT, 'CLAUDE.md'), 'utf8');

  test('states test doubles are permitted ONLY in unit tests', () => {
    expect(claudeMd).toMatch(/only in unit tests/i);
  });

  test('documents the greppable JS unit-test-location convention', () => {
    expect(claudeMd).toContain('tests/unit/');
    expect(claudeMd).toMatch(/\.unit\.test\./);
  });

  test('documents the Kotlin instrumented-vs-host boundary', () => {
    expect(claudeMd).toMatch(/androidTest/);
    expect(claudeMd).toMatch(/non-instrumented|host/i);
  });

  test('states every other layer is real-only / classified by what the test exercises', () => {
    expect(claudeMd).toMatch(/real-only/i);
    expect(claudeMd).toMatch(/exercises/i);
  });
});

describe('SHY-0112 widened baseline captures the new-category debt', () => {
  test('jestFn + mockResolved baselines are non-trivial (real EPIC-0003 debt)', () => {
    const baseline = guard.loadBaseline({ cwd: REPO_ROOT });
    expect(baseline.jestFn.length).toBeGreaterThan(100);
    expect(baseline.mockResolved.length).toBeGreaterThan(100);
    expect(baseline.iosDouble.length).toBeGreaterThanOrEqual(3);
  });
});

describe('SHY-0112 structural contracts', () => {
  test('the offender shape has exactly one key per CATEGORIES entry (EMPTY is category-driven)', () => {
    const empty = guard.scanFiles([], () => '');
    expect(Object.keys(empty).sort()).toEqual(guard.CATEGORIES.map((c) => c.key).sort());
    expect(Object.keys(empty)).toHaveLength(guard.CATEGORIES.length);
  });

  test('capture() restores process.stdout/stderr.write even when the wrapped fn throws', () => {
    const origOut = process.stdout.write;
    const origErr = process.stderr.write;
    expect(() =>
      capture(() => {
        process.stdout.write('partial'); // proves the swap was active mid-fn
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(process.stdout.write).toBe(origOut);
    expect(process.stderr.write).toBe(origErr);
  });
});
