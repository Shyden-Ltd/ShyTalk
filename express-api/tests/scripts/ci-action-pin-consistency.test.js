/**
 * SHY-0162: version-agnostic guard on EVERY CI third-party action pin.
 *
 * Why this exists: Dependabot bumps an action's SHA per-path — `actions/cache`,
 * `actions/cache/restore`, `actions/cache/save` (and `setup-java`, `setup-node`)
 * arrive as SEPARATE PRs, and composite actions under `.github/actions/**` are
 * bumped on a different cadence than the workflows that call them. A run where
 * one ref moves but a sibling does not leaves the SAME action pinned to two
 * different SHAs (e.g. a v4 cache in a composite beside a v6 cache in a
 * workflow) — a latent action-behaviour/cache-format hazard. This guard fails
 * loudly the moment any action repo disagrees with itself, naming every
 * offender, regardless of WHICH SHA they're on. Because it never hardcodes a
 * SHA, a legitimate consistent bump keeps it green with no test edit — the
 * failure mode that repeatedly reddened `main` across the older frozen-literal
 * pin suites (see the version-agnostic conversions in the sibling *-pin tests).
 *
 * Scope vs `scripts/check-action-shas.sh`: the shell guard checks that every
 * third-party action is SHA-pinned repo-wide (format only). This adds the
 * cross-file CONSISTENCY invariant the shell guard has no notion of, and covers
 * BOTH `.github/workflows/**` and `.github/actions/**` (the composite blind
 * spot that let a stale `actions/cache@…#v4` sit unguarded).
 *
 * All scanning/analysis is pure + injectable so the diagnostic/throw path is
 * covered by synthetic fixtures, not only by a (hopefully-never) broken repo.
 */
// SHY-0284: these were defined here and nowhere else, so the invariant they
// encode could only run inside this Jest suite — which test-backend skips on
// workflow-only PRs, the exact shape of the partial Dependabot action bump
// the guard exists to catch. They now live in scripts/lib/action-pins.js so
// scripts/check-action-pin-consistency.js (run unconditionally by lint.yml)
// enforces the SAME scan. This suite keeps the fixture-level coverage.
const {
  repoOf,
  collectRefsFromText,
  collectAllRefs,
  findUnpinned,
  findInconsistentRepos,
  describeInconsistency,
} = require('../../../scripts/lib/action-pins');

describe('SHY-0162: every CI action is SHA-pinned + uses ONE SHA repo-wide', () => {
  const refs = collectAllRefs();

  describe('live repo invariants', () => {
    test('the collector finds the action corpus (guards against a silent zero-match pass)', () => {
      // ~16 distinct action repos across workflows + composite actions today.
      expect(refs.length).toBeGreaterThan(20);
    });

    test('scans BOTH workflows AND composite actions (composite blind-spot regression)', () => {
      const files = new Set(refs.map((r) => r.file));
      expect([...files].some((f) => f.startsWith('.github/workflows/'))).toBe(true);
      expect([...files].some((f) => f.startsWith('.github/actions/'))).toBe(true);
    });

    test('every third-party action ref is a 40-hex commit SHA, never a floating tag', () => {
      expect(findUnpinned(refs)).toEqual([]);
    });

    test('every action repo pins exactly ONE SHA (workflows + composite actions agree)', () => {
      const bad = findInconsistentRepos(refs);
      if (bad.length > 0) throw new Error(describeInconsistency(bad));
      expect(bad).toEqual([]);
    });
  });

  describe('analysis functions (injected fixtures — cover the failure/diagnostic paths)', () => {
    const A = 'a'.repeat(40);
    const B = 'b'.repeat(40);

    test('findInconsistentRepos names the repo + every offending SHA + file:action', () => {
      const bad = findInconsistentRepos([
        { file: 'wf.yml', action: 'actions/cache', ref: A, repo: 'actions/cache' },
        {
          file: '.github/actions/x/action.yml',
          action: 'actions/cache/restore',
          ref: B,
          repo: 'actions/cache',
        },
      ]);
      expect(bad).toHaveLength(1);
      expect(bad[0].repo).toBe('actions/cache');
      expect(Object.keys(bad[0].shas).sort()).toEqual([A, B].sort());
      expect(bad[0].shas[A]).toEqual(['wf.yml: actions/cache']);
      expect(bad[0].shas[B]).toEqual(['.github/actions/x/action.yml: actions/cache/restore']);
    });

    test('findInconsistentRepos returns [] when every ref of a repo agrees', () => {
      expect(
        findInconsistentRepos([
          { file: 'a.yml', action: 'actions/cache', ref: A, repo: 'actions/cache' },
          { file: 'b.yml', action: 'actions/cache/save', ref: A, repo: 'actions/cache' },
        ]),
      ).toEqual([]);
    });

    test('findUnpinned flags a floating tag but passes a 40-hex SHA', () => {
      expect(
        findUnpinned([
          { file: 'a.yml', action: 'actions/checkout', ref: 'v4', repo: 'actions/checkout' },
          { file: 'b.yml', action: 'actions/cache', ref: A, repo: 'actions/cache' },
        ]),
      ).toEqual(['a.yml: actions/checkout@v4']);
    });

    test('collectRefsFromText ignores a #-commented uses: line (comment immunity)', () => {
      const text = [
        `      # uses: actions/cache@${A} # STALE — do not use`,
        `      - uses: actions/cache@${B} # v6.1.0`,
      ].join('\n');
      const got = collectRefsFromText('wf.yml', text);
      expect(got).toHaveLength(1);
      expect(got[0].ref).toBe(B);
    });

    test('collectRefsFromText skips local (./) + container (docker://) refs', () => {
      const text = [
        '      - uses: ./.github/actions/setup-node',
        `      - uses: docker://alpine@sha256:${A}`,
        `      - uses: actions/setup-java@${A}  # v5.4.0`,
      ].join('\n');
      const got = collectRefsFromText('wf.yml', text);
      expect(got).toHaveLength(1);
      expect(got[0]).toMatchObject({
        action: 'actions/setup-java',
        ref: A,
        repo: 'actions/setup-java',
      });
    });

    test('collectRefsFromText on text with no uses: contributes nothing (empty-workflow edge)', () => {
      expect(collectRefsFromText('empty.yml', 'name: noop\non: push\njobs: {}\n')).toEqual([]);
    });

    test('repoOf groups sub-path actions under their owner/repo', () => {
      expect(repoOf('actions/cache/restore')).toBe('actions/cache');
      expect(repoOf('github/codeql-action/analyze')).toBe('github/codeql-action');
      expect(repoOf('actions/checkout')).toBe('actions/checkout');
    });

    test('findInconsistentRepos sorts multiple files sharing one SHA (deterministic report)', () => {
      const bad = findInconsistentRepos([
        { file: 'b.yml', action: 'actions/cache', ref: A, repo: 'actions/cache' },
        { file: 'a.yml', action: 'actions/cache', ref: A, repo: 'actions/cache' },
        { file: 'c.yml', action: 'actions/cache/restore', ref: B, repo: 'actions/cache' },
      ]);
      expect(bad).toHaveLength(1);
      // Both files on SHA A are listed sorted (a before b) regardless of input order.
      expect(bad[0].shas[A]).toEqual(['a.yml: actions/cache', 'b.yml: actions/cache']);
    });

    test('describeInconsistency renders every repo, every SHA, and the file list', () => {
      const msg = describeInconsistency([
        {
          repo: 'actions/cache',
          shas: { [A]: ['a.yml: actions/cache'], [B]: ['x/action.yml: actions/cache'] },
        },
        { repo: 'actions/setup-node', shas: { [A]: ['b.yml: actions/setup-node'] } },
      ]);
      expect(msg).toContain('actions/cache');
      expect(msg).toContain('actions/setup-node');
      expect(msg).toContain(A);
      expect(msg).toContain(B);
      expect(msg).toContain('x/action.yml: actions/cache');
      expect(msg).toMatch(/partial Dependabot bump/);
    });

    test('collectRefsFromText captures a quoted uses: value (no silent zero-match)', () => {
      const got = collectRefsFromText('wf.yml', `      - uses: "actions/checkout@${A}" # v4`);
      expect(got).toHaveLength(1);
      expect(got[0]).toMatchObject({ action: 'actions/checkout', ref: A });
    });

    test('a bystander file with other actions but not the drifted one causes no false failure (AC edge)', () => {
      // setup-node is consistent across a.yml/b.yml; a file using only checkout
      // must not create or perturb setup-node's consistency bucket.
      expect(
        findInconsistentRepos([
          { file: 'a.yml', action: 'actions/setup-node', ref: A, repo: 'actions/setup-node' },
          { file: 'b.yml', action: 'actions/setup-node', ref: A, repo: 'actions/setup-node' },
          { file: 'bystander.yml', action: 'actions/checkout', ref: B, repo: 'actions/checkout' },
        ]),
      ).toEqual([]);
    });
  });
});
