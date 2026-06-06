/* eslint-disable sonarjs/no-os-command-from-path
   -- test harness invokes `bash` to exec the validator under controlled
   inputs with carefully constructed fixture content. Not security-sensitive. */
/**
 * Tests for `scripts/check-story-frontmatter.sh` — the validator that
 * enforces the Agile user-story template documented in:
 *   - CLAUDE.md § "Agile Way of Working"
 *   - .project/stories/SHY-0001-establish-agile-workflow.md
 *
 * Exit codes (documented in --help and CLAUDE.md):
 *   0  success
 *   2  usage error (missing arg, unknown flag, --scan got a file path)
 *   10 missing required frontmatter field
 *   11 invalid frontmatter field value (regex / enum)
 *   12 missing required `##` body section
 *   13 BDD coverage gap (scenarios < AC bullets)
 *   14 missing required `###` AC sub-heading
 *   20 --scan mode found a failing file (inner category in stderr)
 *
 * Fixture strategy: a single canonical valid.md at
 *   express-api/tests/scripts/fixtures/story-frontmatter/valid.md
 * is mutated by helper functions per test, written to a temp file, then
 * fed to the validator. Avoids maintaining ~40 near-identical fixtures.
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'check-story-frontmatter.sh');
const FIXTURE_VALID = path.join(__dirname, 'fixtures', 'story-frontmatter', 'valid.md');

const VALID_CONTENT = fs.readFileSync(FIXTURE_VALID, 'utf8');

/** Spawn the validator with the given args + return { code, stdout, stderr }.
 *  Uses spawnSync (not execFileSync) so stderr is captured on BOTH success
 *  and failure — execFileSync throws on non-zero and exposes stderr only
 *  via the error, which would discard verbose-output captures on exit 0. */
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

/** Write content to a temp .md file and return its absolute path. Caller cleans up via cleanupAll(). */
const TEMP_FILES = [];
function tempStoryFile(content, name = 'SHY-0099-fixture.md') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shy-frontmatter-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  TEMP_FILES.push(dir);
  return file;
}

function tempScanDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shy-scan-'));
  TEMP_FILES.push(dir);
  return dir;
}

afterAll(() => {
  for (const d of TEMP_FILES) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* swallow */
    }
  }
});

// ---------------------------------------------------------------- helpers

/** Remove a frontmatter line by field name. Returns mutated content. */
function removeFrontmatterField(content, field) {
  return content.replace(new RegExp(`^${field}:.*$\\n`, 'm'), '');
}

/** Replace a frontmatter field's value. Returns mutated content. */
function setFrontmatterField(content, field, value) {
  return content.replace(new RegExp(`^${field}:.*$`, 'm'), `${field}: ${value}`);
}

/** Remove a body section header line and its body up to the next `## `. */
function removeBodySection(content, heading) {
  // JS regex doesn't support \Z; use a split-based approach to find the
  // section start, then scan forward for the next `## ` heading or the
  // end of the string. Safer than wrestling the regex.
  const startRe = new RegExp(`^## ${escapeRegExp(heading)}(?:.*)?$`, 'm');
  const startMatch = startRe.exec(content);
  if (!startMatch) return content;
  const headerEnd = startMatch.index + startMatch[0].length;
  const tail = content.slice(headerEnd);
  // Find next `## ` heading (at start of a line) AFTER the matched header.
  const nextHeadingMatch = /\n## (?:[^#])/m.exec(tail);
  const endIdx = nextHeadingMatch ? headerEnd + nextHeadingMatch.index + 1 : content.length;
  return content.slice(0, startMatch.index) + content.slice(endIdx);
}

/** Remove an AC sub-heading line and its body up to the next `### ` or `## `. */
function removeAcSubheading(content, heading) {
  const startRe = new RegExp(`^### ${escapeRegExp(heading)}$`, 'm');
  const startMatch = startRe.exec(content);
  if (!startMatch) return content;
  const headerEnd = startMatch.index + startMatch[0].length;
  const tail = content.slice(headerEnd);
  // Next `### ` or `## ` heading at start of line.
  const nextHeadingMatch = /\n(?:### |## )/m.exec(tail);
  const endIdx = nextHeadingMatch ? headerEnd + nextHeadingMatch.index + 1 : content.length;
  return content.slice(0, startMatch.index) + content.slice(endIdx);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------- tests

describe('scripts/check-story-frontmatter.sh', () => {
  // ============================================================== precondition
  describe('precondition', () => {
    it('script file exists', () => {
      expect(fs.existsSync(SCRIPT)).toBe(true);
    });

    it('script is executable (mode includes user-x)', () => {
      const mode = fs.statSync(SCRIPT).mode;
      // 0o100 is the user-execute bit.
      expect(mode & 0o100).toBe(0o100);
    });
  });

  // ============================================================== happy path
  describe('happy path', () => {
    it('exits 0 against the canonical valid fixture', () => {
      const { code, stderr } = runScript([FIXTURE_VALID]);
      expect(code).toBe(0);
      expect(stderr).toBe('');
    });

    it('exits 0 against a SHY-0001 file with multi-item roadmap_ids', () => {
      const mutated = setFrontmatterField(VALID_CONTENT, 'roadmap_ids', '[G001, G024, G053]');
      const f = tempStoryFile(mutated);
      const { code } = runScript([f]);
      expect(code).toBe(0);
    });

    it('exits 0 against a SHY-0001 file with single-item roadmap_ids', () => {
      const mutated = setFrontmatterField(VALID_CONTENT, 'roadmap_ids', '[G001]');
      const f = tempStoryFile(mutated);
      const { code } = runScript([f]);
      expect(code).toBe(0);
    });
  });

  // ============================================================== missing frontmatter fields → exit 10
  describe('missing frontmatter field → exit 10', () => {
    const REQUIRED = [
      'id',
      'status',
      'owner',
      'created',
      'priority',
      'effort',
      'type',
      'roadmap_ids',
    ];

    describe.each(REQUIRED)('missing %s', (field) => {
      let result;
      beforeAll(() => {
        const mutated = removeFrontmatterField(VALID_CONTENT, field);
        const f = tempStoryFile(mutated);
        result = runScript([f]);
      });
      it('exits with code 10', () => expect(result.code).toBe(10));
      it(`stderr names the field "${field}"`, () => {
        expect(result.stderr).toMatch(
          new RegExp(`missing required frontmatter field:\\s*${field}`),
        );
      });
      it('stderr includes the absolute file path', () => {
        expect(result.stderr).toMatch(/^\//m);
      });
    });

    it('does NOT require pr field (advisory-only)', () => {
      const mutated = removeFrontmatterField(VALID_CONTENT, 'pr');
      const f = tempStoryFile(mutated);
      const { code } = runScript([f]);
      expect(code).toBe(0);
    });
  });

  // ============================================================== invalid frontmatter values → exit 11
  describe('invalid frontmatter value → exit 11', () => {
    it('rejects id not matching ^SHY-NNNN$', () => {
      const mutated = setFrontmatterField(VALID_CONTENT, 'id', 'SHY-1');
      const f = tempStoryFile(mutated);
      const { code, stderr } = runScript([f]);
      expect(code).toBe(11);
      expect(stderr).toMatch(/id must match SHY-NNNN pattern/);
    });

    it('rejects status not in {Draft, In Progress, In Review, Done, Cancelled}', () => {
      const mutated = setFrontmatterField(VALID_CONTENT, 'status', 'pending');
      const f = tempStoryFile(mutated);
      const { code, stderr } = runScript([f]);
      expect(code).toBe(11);
      expect(stderr).toMatch(/Draft/);
      expect(stderr).toMatch(/Cancelled/);
    });

    it('rejects priority outside {P0, P1, P2, P3}', () => {
      const mutated = setFrontmatterField(VALID_CONTENT, 'priority', 'P5');
      const f = tempStoryFile(mutated);
      const { code, stderr } = runScript([f]);
      expect(code).toBe(11);
      expect(stderr).toMatch(/P0/);
      expect(stderr).toMatch(/P3/);
    });

    it('rejects effort outside {XS, S, M, L, XL}', () => {
      const mutated = setFrontmatterField(VALID_CONTENT, 'effort', 'gigantic');
      const f = tempStoryFile(mutated);
      const { code, stderr } = runScript([f]);
      expect(code).toBe(11);
      expect(stderr).toMatch(/\bXS\b/);
      expect(stderr).toMatch(/\bXL\b/);
    });

    it('rejects type outside the 7-value enum', () => {
      const mutated = setFrontmatterField(VALID_CONTENT, 'type', 'maintenance');
      const f = tempStoryFile(mutated);
      const { code, stderr } = runScript([f]);
      expect(code).toBe(11);
      expect(stderr).toMatch(/feature/);
      expect(stderr).toMatch(/spike/);
    });

    it('rejects scalar roadmap_ids (must be array form)', () => {
      const mutated = setFrontmatterField(VALID_CONTENT, 'roadmap_ids', 'G001');
      const f = tempStoryFile(mutated);
      const { code, stderr } = runScript([f]);
      expect(code).toBe(11);
      expect(stderr).toMatch(/roadmap_ids must be in array form/);
    });
  });

  // ============================================================== missing body sections → exit 12
  describe('missing body section → exit 12', () => {
    const REQUIRED_SECTIONS = [
      'User Story',
      'Why',
      'Acceptance Criteria',
      'BDD Scenarios',
      'Test Plan',
      'Out of Scope',
      'Dependencies',
      'Risks & Mitigations',
      'Definition of Done',
      'Notes',
    ];

    describe.each(REQUIRED_SECTIONS)('missing ## %s', (section) => {
      let result;
      beforeAll(() => {
        const mutated = removeBodySection(VALID_CONTENT, section);
        const f = tempStoryFile(mutated);
        result = runScript([f]);
      });
      it('exits with code 12', () => expect(result.code).toBe(12));
      it(`stderr names the missing section "## ${section}"`, () => {
        expect(result.stderr).toMatch(
          new RegExp(`missing required body section:\\s*## ${escapeRegExp(section)}`),
        );
      });
    });

    it('exits 0 with `## Test Plan (TDD)` (prefix-match tolerates suffix)', () => {
      const mutated = VALID_CONTENT.replace(/^## Test Plan\b/m, '## Test Plan (TDD)');
      const f = tempStoryFile(mutated);
      const { code } = runScript([f]);
      expect(code).toBe(0);
    });

    it('exits 0 with `## Notes (running log)` (prefix-match tolerates suffix)', () => {
      const mutated = VALID_CONTENT.replace(/^## Notes\b/m, '## Notes (running log)');
      const f = tempStoryFile(mutated);
      const { code } = runScript([f]);
      expect(code).toBe(0);
    });
  });

  // ============================================================== missing AC sub-headings → exit 14
  describe('missing AC sub-heading → exit 14', () => {
    const DIMENSIONS = [
      'Happy path',
      'Error paths',
      'Edge cases',
      'Performance',
      'Security',
      'UX',
      'i18n',
      'Observability',
    ];

    describe.each(DIMENSIONS)('missing ### %s', (dim) => {
      let result;
      beforeAll(() => {
        const mutated = removeAcSubheading(VALID_CONTENT, dim);
        const f = tempStoryFile(mutated);
        result = runScript([f]);
      });
      it('exits with code 14', () => expect(result.code).toBe(14));
      it(`stderr names the missing sub-heading "### ${dim}"`, () => {
        expect(result.stderr).toMatch(
          new RegExp(`missing required AC sub-heading:\\s*### ${escapeRegExp(dim)}`),
        );
      });
    });
  });

  // ============================================================== BDD coverage → exit 13
  describe('BDD coverage → exit 13', () => {
    it('exits 13 when scenario count < AC checkbox count', () => {
      // Bump AC checkbox count to 3 by adding more bullets under Happy path;
      // BDD still has 1 scenario from the fixture.
      const mutated = VALID_CONTENT.replace(
        /^- \[ \] Validator accepts this file$/m,
        '- [ ] Validator accepts this file\n- [ ] Extra AC bullet 1\n- [ ] Extra AC bullet 2',
      );
      const f = tempStoryFile(mutated);
      const { code, stderr } = runScript([f]);
      expect(code).toBe(13);
      expect(stderr).toMatch(/BDD coverage gap.*3 AC bullets.*1 scenarios/);
    });

    it('exits 0 when scenario count equals AC checkbox count', () => {
      // 1 AC bullet + 1 scenario in fixture.
      const { code } = runScript([FIXTURE_VALID]);
      expect(code).toBe(0);
    });

    it('exits 0 when scenario count exceeds AC checkbox count', () => {
      const mutated = VALID_CONTENT.replace(
        /(\*\*Scenario: Validator accepts this canonical fixture\*\*\n(?:.+\n)+)/,
        '$1\n**Scenario: Extra scenario 1**\n- **Given** X\n- **When** Y\n- **Then** Z\n',
      );
      const f = tempStoryFile(mutated);
      const { code } = runScript([f]);
      expect(code).toBe(0);
    });

    it('does NOT count `- [ ]` checkboxes inside ## Definition of Done', () => {
      // Fixture has 1 AC bullet + 2 DoD bullets + 1 BDD scenario.
      // 1 AC vs 1 BDD = pass. DoD checkboxes should be ignored.
      const { code } = runScript([FIXTURE_VALID]);
      expect(code).toBe(0);
    });

    it('does NOT count `**Scenario:` occurrences outside ## BDD Scenarios as scenarios', () => {
      // Mention `**Scenario:` in the Why section. Should NOT count.
      const mutated = VALID_CONTENT.replace(
        /^## Why$/m,
        '## Why\n\nAlso: this prose mentions **Scenario:** as a meta-reference; it must NOT be counted.\n',
      );
      const f = tempStoryFile(mutated);
      const { code } = runScript([f]);
      expect(code).toBe(0);
    });
  });

  // ============================================================== edge cases
  describe('edge cases', () => {
    it('exits 10 against a 0-byte file', () => {
      const f = tempStoryFile('');
      const { code, stderr } = runScript([f]);
      expect(code).toBe(10);
      expect(stderr).toMatch(/no frontmatter found/);
    });

    it('exits 0 with CRLF line endings (\\r stripped before matching)', () => {
      const mutated = VALID_CONTENT.replace(/\n/g, '\r\n');
      const f = tempStoryFile(mutated);
      const { code } = runScript([f]);
      expect(code).toBe(0);
    });

    it('exits 0 with a UTF-8 BOM at file start', () => {
      const mutated = '﻿' + VALID_CONTENT;
      const f = tempStoryFile(mutated);
      const { code } = runScript([f]);
      expect(code).toBe(0);
    });

    it('exits 0 with emoji + CJK content in body', () => {
      const mutated = VALID_CONTENT.replace(
        /^## Why$/m,
        '## Why\n\n🚀 ship-ready · 山田太郎 · ٱلسَّلَامُ\n',
      );
      const f = tempStoryFile(mutated);
      const { code } = runScript([f]);
      expect(code).toBe(0);
    });

    it('exits 0 with trailing whitespace on every line', () => {
      const mutated = VALID_CONTENT.replace(/\n/g, '   \n');
      const f = tempStoryFile(mutated);
      const { code } = runScript([f]);
      expect(code).toBe(0);
    });

    it('exits 0 when filename contains shell metacharacters', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shy-meta-'));
      TEMP_FILES.push(dir);
      const f = path.join(dir, 'SHY-0099-foo&bar.md');
      fs.writeFileSync(f, VALID_CONTENT);
      const { code } = runScript([f]);
      expect(code).toBe(0);
    });

    it('exits 0 under LC_ALL=C', () => {
      const { code } = runScript([FIXTURE_VALID], { env: { ...process.env, LC_ALL: 'C' } });
      expect(code).toBe(0);
    });

    it('exits 0 under LC_ALL=ja_JP.UTF-8', () => {
      const { code } = runScript([FIXTURE_VALID], {
        env: { ...process.env, LC_ALL: 'ja_JP.UTF-8' },
      });
      expect(code).toBe(0);
    });
  });

  // ============================================================== --scan mode → exit 20
  describe('--scan mode', () => {
    it('exits 0 against an empty directory', () => {
      const dir = tempScanDir();
      const { code } = runScript(['--scan', dir]);
      expect(code).toBe(0);
    });

    it('exits 0 against a directory with only SHY-INDEX.md (glob excludes it)', () => {
      const dir = tempScanDir();
      fs.writeFileSync(path.join(dir, 'SHY-INDEX.md'), '# Index\n');
      const { code } = runScript(['--scan', dir]);
      expect(code).toBe(0);
    });

    it('exits 0 against a directory of multiple valid stories', () => {
      const dir = tempScanDir();
      fs.writeFileSync(path.join(dir, 'SHY-0001-a.md'), VALID_CONTENT);
      fs.writeFileSync(path.join(dir, 'SHY-0002-b.md'), VALID_CONTENT);
      fs.writeFileSync(path.join(dir, 'SHY-0003-c.md'), VALID_CONTENT);
      const { code } = runScript(['--scan', dir]);
      expect(code).toBe(0);
    });

    it('exits 20 on the FIRST failing file in lexicographical order', () => {
      const dir = tempScanDir();
      fs.writeFileSync(path.join(dir, 'SHY-0001-good.md'), VALID_CONTENT);
      fs.writeFileSync(
        path.join(dir, 'SHY-0002-bad.md'),
        removeFrontmatterField(VALID_CONTENT, 'id'),
      );
      fs.writeFileSync(
        path.join(dir, 'SHY-0003-alsobad.md'),
        removeFrontmatterField(VALID_CONTENT, 'status'),
      );
      const { code, stderr } = runScript(['--scan', dir]);
      expect(code).toBe(20);
      expect(stderr).toMatch(/SHY-0002-bad\.md/);
      // SHY-0003 must NOT be reported (stop-on-first).
      expect(stderr).not.toMatch(/SHY-0003/);
    });

    it('ignores hidden files (.DS_Store) and non-SHY .md files (README.md)', () => {
      const dir = tempScanDir();
      fs.writeFileSync(path.join(dir, '.DS_Store'), Buffer.from([0]));
      fs.writeFileSync(path.join(dir, 'README.md'), 'a readme');
      fs.writeFileSync(path.join(dir, 'SHY-0001-valid.md'), VALID_CONTENT);
      const { code } = runScript(['--scan', dir]);
      expect(code).toBe(0);
    });

    it('exits 2 when --scan argument is a file, not a directory', () => {
      const { code, stderr } = runScript(['--scan', FIXTURE_VALID]);
      expect(code).toBe(2);
      expect(stderr).toMatch(/--scan requires a directory/);
    });
  });

  // ============================================================== security
  describe('security', () => {
    it('does NOT execute frontmatter values (shell injection sample)', () => {
      // The validator should treat `$(touch /tmp/sentinel)` as a literal
      // string, not as a command substitution.
      const sentinel = path.join(os.tmpdir(), `shy-sentinel-${Date.now()}-${process.pid}`);
      // Use unique sentinel name so a parallel test run can't false-positive.
      const mutated = setFrontmatterField(VALID_CONTENT, 'owner', `"$(touch ${sentinel})"`);
      const f = tempStoryFile(mutated);
      runScript([f]);
      expect(fs.existsSync(sentinel)).toBe(false);
    });

    it('does NOT follow symlinks during --scan (excludes via ! -type l)', () => {
      const dir = tempScanDir();
      // Create the target of the symlink — a file that, if read, would fail validation.
      const target = path.join(dir, 'target.md');
      fs.writeFileSync(target, removeFrontmatterField(VALID_CONTENT, 'id'));
      // Symlink with a name that DOES match the SHY-NNNN glob.
      const link = path.join(dir, 'SHY-9999-evil.md');
      fs.symlinkSync(target, link);
      const { code } = runScript(['--scan', dir]);
      // Symlink rejected by type → no story files validated → exit 0.
      expect(code).toBe(0);
    });
  });

  // ============================================================== UX / observability
  describe('UX / observability', () => {
    it('--help exits 0 and lists all 8 exit codes', () => {
      const { code, stdout } = runScript(['--help']);
      expect(code).toBe(0);
      // Each documented exit code appears in --help.
      for (const c of [0, 2, 10, 11, 12, 13, 14, 20]) {
        expect(stdout).toMatch(new RegExp(`\\b${c}\\b`));
      }
    });

    it('exits 2 with usage error when no arguments given', () => {
      const { code } = runScript([]);
      expect(code).toBe(2);
    });

    it('exits 2 with usage error on unknown flag', () => {
      const { code } = runScript(['--bogus']);
      expect(code).toBe(2);
    });

    it('stderr lines fit within 80 chars on failure (message part)', () => {
      const mutated = removeFrontmatterField(VALID_CONTENT, 'id');
      const f = tempStoryFile(mutated);
      const { stderr } = runScript([f]);
      const lines = stderr.split('\n').filter((l) => l.length > 0);
      // The CI-log-readability AC applies to the MESSAGE PART of structured
      // stderr (`<path>: <category>: <details>`). Absolute paths on CI
      // runners can be longer than 80 chars on their own; we check that
      // the post-path portion (category + details) fits.
      for (const line of lines) {
        // Split on first `: ` to peel off the path prefix.
        const firstColon = line.indexOf(': ');
        const messagePart = firstColon >= 0 ? line.slice(firstColon + 2) : line;
        expect(messagePart.length).toBeLessThanOrEqual(80);
      }
    });

    it('stdout is silent on success without --verbose', () => {
      const { stdout } = runScript([FIXTURE_VALID]);
      expect(stdout).toBe('');
    });

    it('--verbose prints [check] lines to stderr', () => {
      const { stderr } = runScript(['--verbose', FIXTURE_VALID]);
      expect(stderr).toMatch(/\[check\]/);
    });
  });

  // ============================================================== performance
  describe('performance', () => {
    it('single-file validation completes in under 500ms', () => {
      const t0 = process.hrtime.bigint();
      runScript([FIXTURE_VALID]);
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      expect(ms).toBeLessThan(500);
    });

    it('--scan over a directory of 20 stories completes in under 5s', () => {
      const dir = tempScanDir();
      for (let i = 1; i <= 20; i++) {
        const slug = String(i).padStart(4, '0');
        fs.writeFileSync(path.join(dir, `SHY-${slug}-perf.md`), VALID_CONTENT);
      }
      const t0 = process.hrtime.bigint();
      runScript(['--scan', dir]);
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      expect(ms).toBeLessThan(5000);
    });
  });
});
