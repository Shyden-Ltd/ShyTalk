/* eslint-disable sonarjs/no-os-command-from-path
   -- test harness invokes `bash`, `git`, and the script-under-test in
   temporary directories with controlled inputs (same pattern as
   check-large-files.test.js). Not security-sensitive. */
/**
 * Parse-phase characterization tests for sync-stories-to-issues.sh
 * (SHY-0040 — single-pass parser refactor safety net).
 *
 * These tests pin the script's OBSERVABLE parsing behaviour through a
 * black-box harness (spawnSync + mock `gh` recording argv) against
 * adversarial story fixtures in a temp repo skeleton, so the
 * subprocess-fan-out → single-pass-awk refactor cannot drift:
 *   - title fidelity through shell metacharacters and \x1f
 *   - exact label derivation incl. multi-roadmap expansion
 *   - malformed-frontmatter exit contract (40 + `validate` category)
 *
 * ONE test is CORRECTIVE, not characterization: probing found a live
 * bug where space-padded frontmatter values leak trailing whitespace
 * into labels (`priority:p1   `). The validator accepts padded files,
 * so the corruption is reachable in production. That test is RED
 * against the pre-refactor script BY DESIGN and goes green with the
 * single-pass parser's proper trimming (documented in the story Notes
 * as the sole byte-identical-contract exception).
 *
 * Fixture strategy: the script derives STORIES_DIR from its own path,
 * so each suite run copies the script + its validator sibling into a
 * tmp repo skeleton (scripts/ + .project/stories/ + git init) and runs
 * the COPY. The real corpus is never touched.
 */

const { spawnSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

let fixtureRepo;
let mockGhDir;

function runSync(args, extraEnv = {}) {
  const res = spawnSync(
    'bash',
    [path.join(fixtureRepo, 'scripts', 'sync-stories-to-issues.sh'), ...args],
    {
      encoding: 'utf-8',
      cwd: fixtureRepo,
      timeout: 60_000,
      env: {
        ...process.env,
        GH: path.join(mockGhDir, 'gh'),
        GH_TOKEN: 'fake-pat-for-test',
        GH_PAT_PROJECT: 'fake-pat-for-test',
        ...extraEnv,
      },
    },
  );
  return { code: res.status ?? 1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

function recordedCalls() {
  const rec = path.join(mockGhDir, 'recording.log');
  if (!fs.existsSync(rec)) return [];
  return fs.readFileSync(rec, 'utf-8').split('\n').filter(Boolean);
}

function resetRecording() {
  fs.writeFileSync(path.join(mockGhDir, 'recording.log'), '');
}

/** Minimal story that passes check-story-frontmatter.sh. */
function storyTemplate({ id, title, frontmatterOverrides = '' }) {
  return `---
id: ${id}
status: Draft
owner: claude
created: 2026-06-10
priority: P1
effort: S
type: infra
roadmap_ids: [G001, G024]
pr:
${frontmatterOverrides}---

# ${id}: ${title}

## User Story

As a tester, I want adversarial values, so that parsing is pinned.

## Why

Characterization fixture.

## Acceptance Criteria

### Happy path
- [ ] One bullet.

### Error paths
- [ ] N/A — fixture.

### Edge cases
- [ ] N/A — fixture.

### Performance
- [ ] N/A — fixture.

### Security
- [ ] N/A — fixture.

### UX
- [ ] N/A — fixture.

### i18n
- [ ] N/A — fixture.

### Observability
- [ ] N/A — fixture.

## BDD Scenarios

**Scenario: fixture**
- **Given** a fixture
- **When** it runs
- **Then** it parses

## Test Plan

Fixture only.

## Out of Scope

Everything.

## Dependencies

None.

## Risks & Mitigations

None.

## Definition of Done

- [ ] N/A.

## Notes (running log)

- fixture.
`;
}

function writeStory(id, title, opts = {}) {
  const file = path.join(fixtureRepo, '.project', 'stories', `${id}-fixture.md`);
  fs.writeFileSync(file, storyTemplate({ id, title, ...opts }));
  return file;
}

beforeAll(() => {
  fixtureRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-parse-char-'));
  fs.mkdirSync(path.join(fixtureRepo, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(fixtureRepo, '.project', 'stories'), { recursive: true });
  for (const s of ['sync-stories-to-issues.sh', 'check-story-frontmatter.sh']) {
    fs.copyFileSync(path.join(REPO_ROOT, 'scripts', s), path.join(fixtureRepo, 'scripts', s));
  }
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: fixtureRepo });
  execFileSync('git', ['config', 'user.email', 'test@shytalk.dev'], { cwd: fixtureRepo });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: fixtureRepo });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: fixtureRepo });

  mockGhDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-parse-gh-'));
  const ghPath = path.join(mockGhDir, 'gh');
  fs.writeFileSync(
    ghPath,
    `#!/usr/bin/env bash
echo "$@" >>"${mockGhDir}/recording.log"
key="$1-$2"
if [ -f "${mockGhDir}/resp-\${key}" ]; then cat "${mockGhDir}/resp-\${key}"; fi
exit 0
`,
  );
  fs.chmodSync(ghPath, 0o755);
  fs.writeFileSync(path.join(mockGhDir, 'resp-issue-list'), '');
  fs.writeFileSync(path.join(mockGhDir, 'recording.log'), '');

  // One commit so the script's `git rev-parse HEAD` footer works.
  fs.writeFileSync(path.join(fixtureRepo, '.gitkeep'), '');
  execFileSync('git', ['add', '-A'], { cwd: fixtureRepo });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: fixtureRepo });
});

afterAll(() => {
  for (const d of [fixtureRepo, mockGhDir]) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* swallow */
    }
  }
});

beforeEach(() => {
  resetRecording();
  // Fresh stories dir per test — no fixture bleed.
  const dir = path.join(fixtureRepo, '.project', 'stories');
  for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f));
});

describe('title fidelity through the parse phase', () => {
  test('quotes, $ and backticks reach `gh issue create --title` intact; \\x1f is stripped without corrupting fields', () => {
    // \x1f is the parser's record separator. The single-pass parser strips
    // exactly that byte from values (documented divergence: pre-refactor it
    // passed through) so a malicious/corrupt title can never shift fields
    // into each other — the labels below would scramble if it did.
    const title = 'Title with "quotes" and $dollar and `backticks` and \x1funit-sep end';
    writeStory('SHY-9999', title);
    const { code } = runSync(['--story', 'SHY-9999']);
    expect(code).toBe(0);
    const create = recordedCalls().find((c) => c.startsWith('issue create'));
    expect(create).toBeDefined();
    expect(create).toContain(
      '--title SHY-9999: Title with "quotes" and $dollar and `backticks` and unit-sep end',
    );
    expect(create).toContain(
      '--label story,status:draft,priority:p1,effort:s,type:infra,roadmap:g001,roadmap:g024',
    );
  });

  test('a 1000-char title survives byte-for-byte', () => {
    const title = `long-${'x'.repeat(995)}`;
    writeStory('SHY-9999', title);
    const { code } = runSync(['--story', 'SHY-9999']);
    expect(code).toBe(0);
    const create = recordedCalls().find((c) => c.startsWith('issue create'));
    expect(create).toContain(title);
  });
});

describe('label derivation', () => {
  test('clean frontmatter derives the exact label string incl. multi-roadmap expansion', () => {
    writeStory('SHY-9999', 'Clean fixture');
    const { code } = runSync(['--story', 'SHY-9999']);
    expect(code).toBe(0);
    const create = recordedCalls().find((c) => c.startsWith('issue create'));
    expect(create).toContain(
      '--label story,status:draft,priority:p1,effort:s,type:infra,roadmap:g001,roadmap:g024',
    );
  });

  test('CORRECTIVE (red pre-refactor): padded frontmatter values trim — no whitespace inside labels', () => {
    // Live bug in the pre-refactor parser: `priority:   P1   ` leaks its
    // trailing spaces into the label (`priority:p1   ,`). The validator
    // accepts padded files, so the corruption is production-reachable.
    // The single-pass parser must trim. Sole exception to the story's
    // byte-identical contract (documented in SHY-0040 Notes).
    const file = writeStory('SHY-9999', 'Padded fixture');
    let src = fs.readFileSync(file, 'utf-8');
    src = src.replace('priority: P1', 'priority:   P1   ').replace('effort: S', 'effort:\tS\t');
    fs.writeFileSync(file, src);
    const { code } = runSync(['--story', 'SHY-9999']);
    expect(code).toBe(0);
    const create = recordedCalls().find((c) => c.startsWith('issue create'));
    expect(create).toContain(
      '--label story,status:draft,priority:p1,effort:s,type:infra,roadmap:g001,roadmap:g024',
    );
  });
});

describe('malformed frontmatter exit contract', () => {
  test('unterminated frontmatter → validate-category failure, exit 40', () => {
    fs.writeFileSync(
      path.join(fixtureRepo, '.project', 'stories', 'SHY-9997-malformed.md'),
      '---\nid: SHY-9997\nstatus: Draft\nNO CLOSING DELIMITER\n',
    );
    const { code, stderr } = runSync(['--story', 'SHY-9997']);
    expect(code).toBe(40);
    expect(stderr).toMatch(/validate.*failed frontmatter validation/);
    expect(recordedCalls().some((c) => c.startsWith('issue create'))).toBe(false);
  });
});
