/* eslint-disable sonarjs/no-os-command-from-path
   -- test harness invokes `bash` to exec the validator under controlled
   inputs with carefully constructed fixture content. Not security-sensitive. */
/**
 * Tests for `scripts/check-epic-frontmatter.sh` — the validator that
 * enforces the EPIC file template documented in:
 *   - CLAUDE.md § "Agile Way of Working" → "### EPICs" subsection
 *   - .project/stories/SHY-0037-introduce-epics.md (this validator's spec)
 *
 * Exit codes (documented in --help and CLAUDE.md):
 *   0  success
 *   2  usage error (missing arg, unknown flag, --scan got a file path)
 *   30 missing required frontmatter field
 *   31 invalid frontmatter field value (regex / enum / array form / id↔filename mismatch)
 *   32 missing required `##` body section
 *   40 --scan mode found a problem — structural OR cross-corpus violation; inner cause
 *      surfaced via stderr category ("duplicate epic id", "unknown SHY reference",
 *      "duplicate epic claim")
 *
 * Per-file vs --scan asymmetry (architect-locked, per SHY-0037 AC line 39):
 *   - per-file invocation: structural checks ONLY (frontmatter regex + body sections + id↔filename)
 *   - --scan invocation: structural checks + cross-corpus checks (unknown ref, duplicate claim, ID collision)
 *
 * Fixture strategy: a single canonical valid.md at
 *   express-api/tests/scripts/fixtures/epic-frontmatter/valid.md
 * mutated per test. Mirrors check-story-frontmatter.test.js convention.
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'check-epic-frontmatter.sh');
const FIXTURE_VALID = path.join(__dirname, 'fixtures', 'epic-frontmatter', 'valid.md');

const VALID_CONTENT = fs.readFileSync(FIXTURE_VALID, 'utf8');

function runScript(args, opts = {}) {
  const res = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf-8',
    cwd: REPO_ROOT,
    timeout: 10_000,
    ...opts,
  });
  return {
    code: res.status ?? 1,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    signal: res.signal,
  };
}

const TEMP_DIRS = [];
function tempEpicFile(content, name = 'EPIC-0099-fixture.md') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-frontmatter-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  TEMP_DIRS.push(dir);
  return file;
}

function tempScanDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-scan-'));
  TEMP_DIRS.push(dir);
  return dir;
}

afterAll(() => {
  for (const d of TEMP_DIRS) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* swallow */
    }
  }
});

// ---------------------------------------------------------------- helpers

function removeFrontmatterField(content, field) {
  return content.replace(new RegExp(`^${field}:.*$\\n`, 'm'), '');
}

function setFrontmatterField(content, field, value) {
  return content.replace(new RegExp(`^${field}:.*$`, 'm'), `${field}: ${value}`);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function removeBodySection(content, heading) {
  const startRe = new RegExp(`^## ${escapeRegExp(heading)}(?:.*)?$`, 'm');
  const startMatch = startRe.exec(content);
  if (!startMatch) return content;
  const headerEnd = startMatch.index + startMatch[0].length;
  const tail = content.slice(headerEnd);
  const nextHeadingMatch = /\n## (?:[^#])/m.exec(tail);
  const endIdx = nextHeadingMatch ? headerEnd + nextHeadingMatch.index + 1 : content.length;
  return content.slice(0, startMatch.index) + content.slice(endIdx);
}

// ---------------------------------------------------------------- tests

describe('scripts/check-epic-frontmatter.sh', () => {
  describe('precondition', () => {
    test('script exists at the expected path', () => {
      expect(fs.existsSync(SCRIPT)).toBe(true);
    });

    test('script is executable (shebang line + bash syntax check)', () => {
      const first = fs.readFileSync(SCRIPT, 'utf8').split('\n', 1)[0];
      expect(first).toMatch(/^#!\/usr\/bin\/env bash$|^#!\/bin\/bash$/);
      const syntax = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
      expect(syntax.status).toBe(0);
    });
  });

  describe('happy path', () => {
    test('valid canonical fixture exits 0', () => {
      const file = tempEpicFile(VALID_CONTENT);
      const { code, stderr } = runScript([file]);
      expect(code).toBe(0);
      expect(stderr).toBe('');
    });

    test('--verbose prints [check] lines to stderr with specific check names; exit 0 (I6)', () => {
      // I6: previous version only asserted /^\[check\] /m — any [check] line passed,
      // so renames/drops of specific check names would be invisible. Now asserts the
      // documented check-name vocabulary so refactors that change verbose tokens fail.
      const file = tempEpicFile(VALID_CONTENT);
      const { code, stderr } = runScript(['--verbose', file]);
      expect(code).toBe(0);
      expect(stderr).toMatch(/\[check\] frontmatter:id/);
      expect(stderr).toMatch(/\[check\] value:id/);
      expect(stderr).toMatch(/\[check\] value:id-matches-filename/);
      expect(stderr).toMatch(/\[check\] value:title/);
      expect(stderr).toMatch(/\[check\] value:child_shys/);
      expect(stderr).toMatch(/\[check\] section:## Vision/);
    });

    test('stdout is silent on success without --verbose (I4 regression guard)', () => {
      // I4: a stray `echo` left in the script would be invisible without an explicit
      // stdout-emptiness assertion.
      const file = tempEpicFile(VALID_CONTENT);
      const { code, stdout } = runScript([file]);
      expect(code).toBe(0);
      expect(stdout).toBe('');
    });

    test.each([['true'], ['false'], ['yes'], ['1'], ['True']])(
      'SHY-0083: a stray mvp: "%s" on an EPIC is a no-op (SHY-only scope)',
      (val) => {
        // The mvp: classification flag is a SHY-level field (SHY-0083). The EPIC
        // validator must neither require nor reject it for ANY value — even
        // values that would be invalid on a SHY (yes/1/True) must be ignored,
        // proving the field is SHY-scoped only.
        const content = VALID_CONTENT.replace(/^id:.*$/m, (m) => `${m}\nmvp: ${val}`);
        const { code } = runScript([tempEpicFile(content)]);
        expect(code).toBe(0);
      },
    );
  });

  describe('missing frontmatter field → exit 30', () => {
    test.each(['id', 'status', 'owner', 'created', 'priority', 'title'])(
      'missing %s → exit 30 with field name in stderr',
      (field) => {
        const file = tempEpicFile(removeFrontmatterField(VALID_CONTENT, field));
        const { code, stderr } = runScript([file]);
        expect(code).toBe(30);
        expect(stderr).toMatch(new RegExp(`missing.*${field}`, 'i'));
      },
    );

    test('no frontmatter delimiters → exit 30', () => {
      const file = tempEpicFile('# EPIC body only, no frontmatter\n\n## Vision\nx\n');
      const { code, stderr } = runScript([file]);
      expect(code).toBe(30);
      expect(stderr).toMatch(/no frontmatter found/);
    });

    test('empty file → exit 30', () => {
      const file = tempEpicFile('');
      const { code, stderr } = runScript([file]);
      expect(code).toBe(30);
      expect(stderr).toMatch(/no frontmatter found/);
    });

    test('only opening --- (no closing) → exit 30', () => {
      const file = tempEpicFile('---\nid: EPIC-0099\n');
      const { code } = runScript([file]);
      expect(code).toBe(30);
    });
  });

  describe('invalid frontmatter value → exit 31', () => {
    test.each([
      ['id', 'EPIC-1', /id must match/],
      ['id', 'SHY-0001', /id must match/],
      ['id', 'epic-0001', /id must match/],
      ['id', 'EPIC-12345', /id must match/],
      ['id', 'EPIC-0099a', /id must match/],
      ['status', 'Frobnicated', /status must be one of/],
      ['status', 'in progress', /status must be one of/],
      ['priority', 'P9', /priority must be one of/],
      ['priority', 'p1', /priority must be one of/],
      ['child_shys', 'SHY-0001', /child_shys must be in array form/],
      ['child_shys', '"not array"', /child_shys must be in array form/],
    ])('invalid %s=%s → exit 31', (field, value, msgRe) => {
      const file = tempEpicFile(setFrontmatterField(VALID_CONTENT, field, value));
      const { code, stderr } = runScript([file]);
      expect(code).toBe(31);
      expect(stderr).toMatch(msgRe);
    });

    test('id mismatches filename → exit 31 (per-file structural check)', () => {
      // valid.md fixture has id: EPIC-0099 — write under a different filename.
      const file = tempEpicFile(VALID_CONTENT, 'EPIC-0042-wrong.md');
      const { code, stderr } = runScript([file]);
      expect(code).toBe(31);
      expect(stderr).toMatch(/id.*filename|filename.*id/i);
    });

    test('title is a non-empty string', () => {
      const file = tempEpicFile(setFrontmatterField(VALID_CONTENT, 'title', ''));
      const { code } = runScript([file]);
      expect(code).toBe(31);
    });
  });

  describe('missing body section → exit 32', () => {
    test.each(['Vision', 'Scope', 'Child SHYs', 'DoD at Epic Level', 'Notes'])(
      'missing ## %s → exit 32 with section name in stderr',
      (section) => {
        const file = tempEpicFile(removeBodySection(VALID_CONTENT, section));
        const { code, stderr } = runScript([file]);
        expect(code).toBe(32);
        expect(stderr).toMatch(new RegExp(`missing.*${escapeRegExp(section)}`, 'i'));
      },
    );
  });

  describe('--scan mode cross-corpus checks', () => {
    test('--scan over empty dir exits 0', () => {
      const dir = tempScanDir();
      const { code } = runScript(['--scan', dir]);
      expect(code).toBe(0);
    });

    test('--scan over dir with one valid EPIC exits 0', () => {
      const dir = tempScanDir();
      fs.writeFileSync(path.join(dir, 'EPIC-0099-fixture.md'), VALID_CONTENT);
      const { code } = runScript(['--scan', dir]);
      expect(code).toBe(0);
    });

    test('per-file with unknown child SHY reference → exit 0 (cross-checks skipped)', () => {
      const content = setFrontmatterField(VALID_CONTENT, 'child_shys', '[SHY-9999]');
      const file = tempEpicFile(content);
      const { code } = runScript([file]);
      // Per-file mode is structural only; cross-corpus check requires --scan.
      expect(code).toBe(0);
    });

    test('--scan with unknown child SHY reference → exit 40 (stderr names the SHY)', () => {
      const dir = tempScanDir();
      fs.writeFileSync(
        path.join(dir, 'EPIC-0099-fixture.md'),
        setFrontmatterField(VALID_CONTENT, 'child_shys', '[SHY-9999]'),
      );
      const { code, stderr } = runScript(['--scan', dir]);
      expect(code).toBe(40);
      expect(stderr).toMatch(/unknown SHY reference|SHY-9999/);
    });

    test('--scan with duplicate child SHY claim across two EPICs → exit 40 (stderr names the SHY)', () => {
      const dir = tempScanDir();
      // Create a real SHY file the EPICs can reference (so unknown-ref doesn't fire first).
      fs.writeFileSync(
        path.join(dir, 'SHY-0001-target.md'),
        '---\nid: SHY-0001\nstatus: Draft\nowner: claude\ncreated: 2026-06-08\npriority: P1\neffort: M\ntype: infra\nroadmap_ids: []\n---\n# SHY-0001\n',
      );
      fs.writeFileSync(
        path.join(dir, 'EPIC-0099-first.md'),
        setFrontmatterField(VALID_CONTENT, 'child_shys', '[SHY-0001]'),
      );
      // Second EPIC also claims SHY-0001 — must have a different EPIC ID to pass the collision check first.
      const second = setFrontmatterField(VALID_CONTENT, 'id', 'EPIC-0098').replace(
        /^child_shys:.*$/m,
        'child_shys: [SHY-0001]',
      );
      fs.writeFileSync(path.join(dir, 'EPIC-0098-second.md'), second);
      const { code, stderr } = runScript(['--scan', dir]);
      expect(code).toBe(40);
      expect(stderr).toMatch(/duplicate.*SHY-0001|SHY-0001.*claimed.*twice|duplicate epic claim/i);
    });

    test('--scan with EPIC ID collision (two EPIC-0099-*.md files) → exit 40 (stderr says collision)', () => {
      const dir = tempScanDir();
      fs.writeFileSync(path.join(dir, 'EPIC-0099-first.md'), VALID_CONTENT);
      fs.writeFileSync(path.join(dir, 'EPIC-0099-second.md'), VALID_CONTENT);
      const { code, stderr } = runScript(['--scan', dir]);
      expect(code).toBe(40);
      expect(stderr).toMatch(/EPIC-0099.*collision|collision.*EPIC-0099|duplicate.*EPIC-0099/i);
    });

    test('--scan with file path (not directory) → exit 2', () => {
      const file = tempEpicFile(VALID_CONTENT);
      const { code, stderr } = runScript(['--scan', file]);
      expect(code).toBe(2);
      expect(stderr).toMatch(/--scan requires a directory/);
    });

    test('--scan with missing dir → exit 2', () => {
      const { code } = runScript(['--scan', '/nonexistent/path/xyz']);
      expect(code).toBe(2);
    });

    test('--scan: valid EPIC precedes invalid one — scan reports the invalid one (I3 fix)', () => {
      // I3 fix: prior version wrote `EPIC-0002-good.md` with VALID_CONTENT whose id is
      // EPIC-0099 — that "good" file would ALSO fail id-mismatch. Now we write a genuinely
      // valid EPIC-0001 first, then an invalid EPIC-0099, proving the scan processes
      // the valid one cleanly before halting on the bad one.
      const dir = tempScanDir();
      const goodContent = setFrontmatterField(VALID_CONTENT, 'id', 'EPIC-0001');
      fs.writeFileSync(path.join(dir, 'EPIC-0001-good.md'), goodContent);
      const badContent = removeBodySection(VALID_CONTENT, 'Vision'); // id stays EPIC-0099
      fs.writeFileSync(path.join(dir, 'EPIC-0099-bad.md'), badContent);
      const { code, stderr } = runScript(['--scan', dir]);
      expect(code).toBe(40);
      expect(stderr).toMatch(/EPIC-0099-bad\.md/);
    });

    test('--scan with multi-entry child_shys: first known, second unknown → exit 40 names the second (I8)', () => {
      const dir = tempScanDir();
      fs.writeFileSync(
        path.join(dir, 'SHY-0001-exists.md'),
        '---\nid: SHY-0001\nstatus: Draft\n---\n# SHY\n',
      );
      fs.writeFileSync(
        path.join(dir, 'EPIC-0099-fixture.md'),
        setFrontmatterField(VALID_CONTENT, 'child_shys', '[SHY-0001, SHY-9999]'),
      );
      const { code, stderr } = runScript(['--scan', dir]);
      expect(code).toBe(40);
      expect(stderr).toMatch(/SHY-9999/);
    });

    test('--verbose --scan prints [check] scan: lines to stderr; stdout silent (C2)', () => {
      const dir = tempScanDir();
      fs.writeFileSync(path.join(dir, 'EPIC-0099-fixture.md'), VALID_CONTENT);
      const { code, stdout, stderr } = runScript(['--verbose', '--scan', dir]);
      expect(code).toBe(0);
      expect(stdout).toBe('');
      expect(stderr).toMatch(/\[check\] scan:/);
      expect(stderr).toMatch(/\[check\] frontmatter:id/);
    });

    test('--scan --verbose (flag AFTER --scan) → exit 2 with ordering hint (C1 guard)', () => {
      // C1: --scan does not shift before consuming its arg, so flag-after-scan would
      // silently be misinterpreted as the dir path. The bash guard rejects this with
      // an actionable error instead.
      const dir = tempScanDir();
      const { code, stderr } = runScript(['--scan', '--verbose', dir]);
      expect(code).toBe(2);
      expect(stderr).toMatch(/flags.*must precede --scan/);
    });
  });

  describe('edge cases', () => {
    test('EPIC with zero child SHYs accepted (child_shys: [])', () => {
      // valid.md already has child_shys: [] — confirm explicitly.
      const file = tempEpicFile(VALID_CONTENT);
      const { code } = runScript([file]);
      expect(code).toBe(0);
    });

    test('Cancelled status accepted (audit-trail preservation)', () => {
      const file = tempEpicFile(setFrontmatterField(VALID_CONTENT, 'status', 'Cancelled'));
      const { code } = runScript([file]);
      expect(code).toBe(0);
    });

    test('Done status accepted', () => {
      const file = tempEpicFile(setFrontmatterField(VALID_CONTENT, 'status', 'Done'));
      const { code } = runScript([file]);
      expect(code).toBe(0);
    });

    test('CRLF line endings normalised', () => {
      const file = tempEpicFile(VALID_CONTENT.replace(/\n/g, '\r\n'));
      const { code } = runScript([file]);
      expect(code).toBe(0);
    });

    test('UTF-8 BOM at start of file stripped', () => {
      const file = tempEpicFile('﻿' + VALID_CONTENT);
      const { code } = runScript([file]);
      expect(code).toBe(0);
    });

    test('trailing whitespace on --- delimiter tolerated', () => {
      // Markdown norm: 2 trailing spaces = hard line break. Validator must not break this.
      const file = tempEpicFile(VALID_CONTENT.replace(/^---$/m, '---  '));
      const { code } = runScript([file]);
      expect(code).toBe(0);
    });

    test('child_shys: [SHY-0001, SHY-0002] multi-entry array accepted in per-file mode', () => {
      const file = tempEpicFile(
        setFrontmatterField(VALID_CONTENT, 'child_shys', '[SHY-0001, SHY-0002]'),
      );
      const { code } = runScript([file]);
      expect(code).toBe(0);
    });

    test('child_shys: [   ] (whitespace-only between brackets) accepted (I5)', () => {
      // Distinct code path from `[]`: raw after sed extraction is "   ", non-empty,
      // so the inner `for entry in $(...)` is entered but word-splitting on pure
      // whitespace produces zero iterations. Must accept silently.
      const file = tempEpicFile(setFrontmatterField(VALID_CONTENT, 'child_shys', '[   ]'));
      const { code } = runScript([file]);
      expect(code).toBe(0);
    });

    test('CRLF-encoded EPIC in --scan mode with child_shys cross-check exits 0 (I7)', () => {
      // Pass 4 of validate_scan reads the ORIGINAL (non-normalised) file.
      // The [[:space:]] tolerance in grep patterns must handle \r without
      // false-positive on the cross-corpus child-SHY lookup.
      const dir = tempScanDir();
      fs.writeFileSync(
        path.join(dir, 'SHY-0001-target.md'),
        '---\nid: SHY-0001\nstatus: Draft\n---\n# SHY\n',
      );
      const crlf = setFrontmatterField(VALID_CONTENT, 'child_shys', '[SHY-0001]').replace(
        /\n/g,
        '\r\n',
      );
      fs.writeFileSync(path.join(dir, 'EPIC-0099-crlf.md'), crlf);
      const { code } = runScript(['--scan', dir]);
      expect(code).toBe(0);
    });
  });

  describe('security', () => {
    test('symlink inside --scan dir is skipped (not followed)', () => {
      const dir = tempScanDir();
      const target = tempEpicFile(VALID_CONTENT);
      const linkPath = path.join(dir, 'EPIC-0099-link.md');
      fs.symlinkSync(target, linkPath);
      const { code } = runScript(['--scan', dir]);
      // Symlink is skipped → no files matched → exits 0 successfully.
      expect(code).toBe(0);
    });

    test('--scan does not match arbitrary .md files (only EPIC-NNNN-*.md)', () => {
      const dir = tempScanDir();
      fs.writeFileSync(
        path.join(dir, 'README.md'),
        '# This is not an EPIC and must not be scanned\n',
      );
      fs.writeFileSync(path.join(dir, 'SHY-0001-foo.md'), '---\nbroken: yes\n---\n');
      const { code } = runScript(['--scan', dir]);
      expect(code).toBe(0);
    });

    test('filename glob is anchored — does not match malformed EPIC filenames', () => {
      // Avoid writing files with `/` in the name (POSIX path-separator) to keep
      // this test from touching paths outside the scan dir. Instead, place
      // files with names that look EPIC-like but should NOT match the glob.
      const dir = tempScanDir();
      // 2 digits not 4 — must not match
      fs.writeFileSync(path.join(dir, 'EPIC-99-short.md'), VALID_CONTENT);
      // lowercase 'epic' — must not match
      fs.writeFileSync(path.join(dir, 'epic-0099-lower.md'), VALID_CONTENT);
      // prefix character — must not match
      fs.writeFileSync(path.join(dir, 'xEPIC-0099-prefix.md'), VALID_CONTENT);
      const { code } = runScript(['--scan', dir]);
      // None of these names match EPIC-[0-9][0-9][0-9][0-9]-*.md → scan finds 0 files → exit 0.
      expect(code).toBe(0);
    });

    test('does NOT execute shell metacharacters in frontmatter values (C3)', () => {
      // Verifies the "all user-controlled strings quoted in shell pipelines" contract.
      // Target field: `title` — loosest regex (`non-empty, non-whitespace-only`), so the
      // payload reaches the grep/sed/awk pipelines (unlike `owner` which fails its
      // strict regex earlier). Sentinel file must NOT be created regardless of exit code.
      const sentinel = path.join(
        os.tmpdir(),
        `epic-shell-injection-sentinel-${Date.now()}-${process.pid}`,
      );
      try {
        fs.unlinkSync(sentinel);
      } catch {
        /* ignore: sentinel may not exist yet */
      }
      const mutated = setFrontmatterField(VALID_CONTENT, 'title', `Pwn $(touch ${sentinel})`);
      const file = tempEpicFile(mutated);
      runScript([file]);
      expect(fs.existsSync(sentinel)).toBe(false);
      try {
        fs.unlinkSync(sentinel);
      } catch {
        /* ignore: cleanup best-effort */
      }
    });
  });

  describe('UX/observability', () => {
    test('--help exits 0 with usage text', () => {
      const { code, stdout } = runScript(['--help']);
      expect(code).toBe(0);
      expect(stdout).toMatch(/check-epic-frontmatter\.sh/);
      expect(stdout).toMatch(/EXIT CODES/);
      expect(stdout).toMatch(/30.*missing required/i);
      expect(stdout).toMatch(/31.*invalid/i);
      expect(stdout).toMatch(/32.*body section/i);
      expect(stdout).toMatch(/40.*--scan/i);
    });

    test('-h is an alias for --help', () => {
      const { code, stdout } = runScript(['-h']);
      expect(code).toBe(0);
      expect(stdout).toMatch(/check-epic-frontmatter\.sh/);
    });

    test('no args → exit 2 with usage hint', () => {
      const { code, stderr } = runScript([]);
      expect(code).toBe(2);
      expect(stderr).toMatch(/usage|missing/i);
    });

    test('unknown flag → exit 2', () => {
      const { code, stderr } = runScript(['--frobnicate']);
      expect(code).toBe(2);
      expect(stderr).toMatch(/unknown flag/i);
    });

    test('failure stderr is machine-parseable (path: category: details)', () => {
      const file = tempEpicFile(removeFrontmatterField(VALID_CONTENT, 'title'));
      const { stderr } = runScript([file]);
      // Format: <absolute-path>: <category>: <details>
      expect(stderr).toMatch(/^\/.*\.md: [a-z][a-z ]*: .+/m);
    });
  });

  describe('performance (C4)', () => {
    test('single-file validation completes in under 500ms', () => {
      const file = tempEpicFile(VALID_CONTENT);
      const start = Date.now();
      const { code } = runScript([file]);
      const elapsed = Date.now() - start;
      expect(code).toBe(0);
      // Budget mirrors the SHY validator's per-file perf budget.
      expect(elapsed).toBeLessThan(500);
    });

    test('--scan over 20 EPIC files completes in under 5s', () => {
      // Spec Performance AC budget: <2s for 60 SHYs + 1 EPIC + cross-checks.
      // This is the EPIC-only stress (20 files) at <5s — a looser budget
      // for the more I/O-bound scan loop.
      const dir = tempScanDir();
      for (let i = 1; i <= 20; i += 1) {
        const n = String(i).padStart(4, '0');
        const content = setFrontmatterField(VALID_CONTENT, 'id', `EPIC-${n}`);
        fs.writeFileSync(path.join(dir, `EPIC-${n}-perf.md`), content);
      }
      const start = Date.now();
      const { code } = runScript(['--scan', dir]);
      const elapsed = Date.now() - start;
      expect(code).toBe(0);
      expect(elapsed).toBeLessThan(5000);
    });
  });
});
