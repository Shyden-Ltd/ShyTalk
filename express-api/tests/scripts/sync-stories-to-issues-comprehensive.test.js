/* eslint-disable sonarjs/no-os-command-from-path
   -- test harness invokes `bash` and a mock `gh` binary under controlled
   inputs with carefully constructed fixture content. Not security-sensitive. */
/**
 * Tests for SHY-0067 — comprehensive fix to SHY-0002 issue/board mirror.
 *
 * Covers the 4 stacked defects + 1 schema gap surfaced in the 2026-06-09
 * session-close audit:
 *
 *   A. Workflow env exposes GH_PAT_PROJECT but gh CLI ignores it (needs GH_TOKEN).
 *   B. Script generates SHY-namespace labels (story, status:*, priority:*, etc.)
 *      that don't exist in the repo — every `gh issue create --label` fails.
 *   C. Script silences gh errors via `>/dev/null 2>&1` + always exits 0 via
 *      `return 0` regardless of N_FAILED count.
 *   D. Script has zero Project v2 board addition logic (SHY-0002 AC line 46 unmet).
 *   E. Project v2 board lacks the Type single-select field (operator decided
 *      script should auto-create via `createProjectV2Field` mutation).
 *
 * Spec: .project/stories/SHY-0067-fix-shy-0002-mirror-comprehensive.md
 *
 * Test architecture: static-assertion tests on the workflow YAML + script
 * source (cheap, fast, catches structural regressions) PLUS mock-gh runtime
 * tests reusing the makeMockGh harness pattern from
 * sync-stories-to-issues.test.js. Mocks let us verify the call sequence
 * (label create → issue create → project item-add → field-set) without
 * needing a real PAT or live GitHub API.
 *
 * Live-verify gate is NOT covered by Jest — it's a post-merge action item
 * captured in the SHY-0067 DoD, run manually within 10 min of PR merge.
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'sync-stories-to-issues.sh');
const WORKFLOW = path.join(REPO_ROOT, '.github/workflows/sync-stories-to-issues.yml');

const TEMP_DIRS = [];
function tempDir(prefix = 'sync67-') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  TEMP_DIRS.push(d);
  return d;
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

function runScript(args, opts = {}) {
  const res = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf-8',
    cwd: REPO_ROOT,
    timeout: 60_000,
    ...opts,
  });
  return {
    code: res.status ?? 1,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
  };
}

/**
 * Mock-gh that records every invocation AND supports per-(cmd, subcmd) response
 * fixtures. Extended for SHY-0067 to also support per-call exit-code overrides
 * via `gh-exit-cmd-<cmd>-<subcmd>` files so we can simulate `gh issue create`
 * failing while other calls succeed.
 */
function makeMockGh() {
  const dir = tempDir('mockgh67-');
  const ghPath = path.join(dir, 'gh');
  const recording = path.join(dir, 'recording.log');
  fs.writeFileSync(recording, '');
  const mockSource = `#!/usr/bin/env bash
echo "$@" >>"${recording}"
# SHY-0074 v2: the items-map query is also 'api graphql' but needs its own
# response/exit-code channel — it must not collide with mutation fixtures.
case "$*" in
  *"items(first: 100"*)
    if [ -f "${dir}/gh-exit-items-query" ]; then exit "$(cat "${dir}/gh-exit-items-query")"; fi
    if [ -f "${dir}/gh-responses-items-query" ]; then cat "${dir}/gh-responses-items-query"; fi
    exit 0
    ;;
esac
key="$1-$2"
respfile="${dir}/gh-responses-\${key}"
if [ -f "\${respfile}" ]; then
  cat "\${respfile}"
fi
percmd_exit="${dir}/gh-exit-cmd-\${key}"
if [ -f "\${percmd_exit}" ]; then
  exit "$(cat "\${percmd_exit}")"
fi
exitfile="${dir}/gh-exit-code"
if [ -f "\${exitfile}" ]; then
  exit "$(cat "\${exitfile}")"
fi
exit 0
`;
  fs.writeFileSync(ghPath, mockSource);
  fs.chmodSync(ghPath, 0o755);
  // Default: an empty board — every story routes down the create path.
  fs.writeFileSync(
    path.join(dir, 'gh-responses-items-query'),
    JSON.stringify({
      data: {
        organization: {
          projectV2: { items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } },
        },
      },
    }),
  );
  return { ghPath, dir, recording };
}

/**
 * SHY-0074 v2 routes only `type: bug` stories to `gh issue create` — these
 * runtime tests pin the ISSUE call sequence, so they need a bug fixture
 * (the real SHY-0001 is infra → draft-routed). STORIES_DIR isolates the
 * run from the live corpus.
 */
function makeBugStoryDir() {
  const storiesDir = tempDir('stories67-');
  fs.writeFileSync(
    path.join(storiesDir, 'SHY-7001-runtime-fixture.md'),
    `---
id: SHY-7001
status: Draft
owner: claude
created: 2026-06-10
priority: P1
effort: S
type: bug
roadmap_ids: [G001]
pr:
---

# SHY-7001: Runtime fixture bug story

## User Story

As a test, I want a valid bug story, so that the sync script processes me.

## Why

Fixture.

## Acceptance Criteria

### Happy path
- [ ] Fixture bullet.

### Error paths
N/A — fixture.

### Edge cases
N/A — fixture.

### Performance
N/A — fixture.

### Security
N/A — fixture.

### UX
N/A — fixture.

### i18n
N/A — fixture.

### Observability
N/A — fixture.

## BDD Scenarios

**Scenario: fixture**
- **Given** a fixture
- **When** synced
- **Then** it works

## Test Plan

Covered by the harness.

## Out of Scope

Everything else.

## Dependencies

None.

## Risks & Mitigations

None.

## Definition of Done

- [ ] Synced.

## Notes

Fixture.
`,
  );
  return storiesDir;
}

function mockEnv(ghPath, storiesDir) {
  return {
    ...process.env,
    GH: ghPath,
    GH_TOKEN: 'fake-pat-for-test',
    GH_PAT_PROJECT: 'fake-pat-for-test',
    STORIES_DIR: storiesDir,
    // SHY-0078: zero backoff so the empty-read retry doesn't slow tests.
    ITEMS_MAP_RETRY_BACKOFF: '0',
  };
}

function readRecording(recordingPath) {
  if (!fs.existsSync(recordingPath)) return [];
  return fs
    .readFileSync(recordingPath, 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

// ============================================================== Static assertions
// These run against the source files without invoking the script. Cheap +
// structural-regression-resistant. The mock-gh tests below cover runtime.

describe('SHY-0067: workflow YAML — Defect A (auth env propagation)', () => {
  let yamlContent;

  beforeAll(() => {
    yamlContent = fs.readFileSync(WORKFLOW, 'utf8');
  });

  test('workflow file exists', () => {
    expect(fs.existsSync(WORKFLOW)).toBe(true);
  });

  test('Defect A: workflow env block sets GH_TOKEN from GH_PAT_PROJECT secret', () => {
    // gh CLI authenticates via GH_TOKEN (highest priority) or GITHUB_TOKEN
    // (fallback) — NOT GH_PAT_PROJECT. The pre-SHY-0067 workflow exposed the
    // PAT only as `GH_PAT_PROJECT:` which gh ignores, so every `gh issue
    // create` ran with the read-only auto GITHUB_TOKEN and failed silently.
    expect(yamlContent).toMatch(/GH_TOKEN:\s*\$\{\{\s*secrets\.GH_PAT_PROJECT\s*\}\}/);
  });

  test('GH_PAT_PROJECT remains in env (script-level scope check + back-compat)', () => {
    // The script still reads GH_PAT_PROJECT for its own scope-check logic
    // (exits 30 with a helpful message if missing). Keep both env vars set
    // for back-compat + clarity.
    expect(yamlContent).toMatch(/GH_PAT_PROJECT:\s*\$\{\{\s*secrets\.GH_PAT_PROJECT\s*\}\}/);
  });

  test('workflow timeout-minutes raised to ≥15 to fit first-run label + field provisioning', () => {
    // First run with 53+ SHYs creates ~33 labels + 53 issues + 53 board items
    // + 6 field-sets each. Rough budget ~3 min API time + overhead. 15-min
    // window gives 5× headroom; 10-min (pre-SHY-0067) was tight.
    const timeoutMatch = yamlContent.match(/timeout-minutes:\s*(\d+)/);
    expect(timeoutMatch).not.toBeNull();
    if (timeoutMatch) {
      expect(Number.parseInt(timeoutMatch[1], 10)).toBeGreaterThanOrEqual(15);
    }
  });

  test('workflow permissions block stays at contents: read (PAT carries write scopes)', () => {
    // The auto GITHUB_TOKEN deliberately does NOT carry issues:write or
    // project:write — those come from the PAT, not the workflow token. Keep
    // the workflow-token scope minimal.
    // Use explicit horizontal-only whitespace classes ([ \t]) to avoid
    // sonarjs/slow-regex flagging consecutive \s* quantifiers (\s matches \n,
    // which would let the engine backtrack across the literal \n boundary).
    expect(yamlContent).toMatch(/permissions:[ \t]*\n[ \t]+contents:[ \t]+read/);
  });
});

describe('SHY-0067: script body — Defect C (silent-failure removal)', () => {
  let scriptContent;

  beforeAll(() => {
    scriptContent = fs.readFileSync(SCRIPT, 'utf8');
  });

  test('script does NOT pipe `gh issue create` to /dev/null 2>&1', () => {
    // Pre-SHY-0067 line 252: `if ! "$GH" issue create ... >/dev/null 2>&1; then`
    // silenced both stdout AND stderr, so we never knew WHY the create failed.
    // Post-fix: capture stderr to a tmpfile, log on failure, never silence.
    expect(scriptContent).not.toMatch(/"\$GH"\s+issue\s+create[^\n]*>\/dev\/null\s+2>&1/);
  });

  test('script does NOT pipe `gh issue edit` to /dev/null 2>&1', () => {
    // Same pattern at the issue-edit step; same fix applies.
    expect(scriptContent).not.toMatch(/"\$GH"\s+issue\s+edit[^\n]*>\/dev\/null\s+2>&1/);
  });

  test('script captures gh stderr to a tmpfile on failure (not silenced)', () => {
    // The fix uses a per-call stderr-capture pattern (mktemp + 2> redirect)
    // so failure messages are preserved for logging. Look for the canonical
    // shape introduced in SHY-0067.
    expect(scriptContent).toMatch(/mktemp|tmpfile|stderr_capture|GH_STDERR/);
  });

  test('script exits non-zero (E_API=40) when N_FAILED > 0 after sync_all', () => {
    // Pre-SHY-0067: `sync_all` finished and `set -e` propagated only if the
    // final printf failed. N_FAILED was data, never a gate. Post-fix: explicit
    // `[ "$N_FAILED" -gt 0 ]` guard followed by `exit "$E_API"` (or 40).
    // Split into two narrow assertions (no consecutive .{0,N}[\s\S]{0,M}
    // quantifiers) to avoid sonarjs/slow-regex super-linear backtracking.
    expect(scriptContent).toMatch(/N_FAILED.{0,80}-gt.{0,5}0/);
    expect(scriptContent).toMatch(/exit[ \t]+(40|"\$E_API"|\$E_API)/);
  });

  test('script defines E_API=40 exit code constant', () => {
    expect(scriptContent).toMatch(/E_API=40/);
  });
});

describe('SHY-0067: script body — Defect B (label auto-create)', () => {
  let scriptContent;

  beforeAll(() => {
    scriptContent = fs.readFileSync(SCRIPT, 'utf8');
  });

  test('script defines a label-ensure helper (e.g. ensure_label)', () => {
    // Function may be named ensure_label / ensure_labels / provision_labels.
    expect(scriptContent).toMatch(/ensure_label|provision_label/);
  });

  test('script invokes `gh label create` for missing labels', () => {
    expect(scriptContent).toMatch(/gh\s+label\s+create|"\$GH"\s+label\s+create/);
  });

  test('script lists existing labels via `gh label list` (cache for idempotency)', () => {
    expect(scriptContent).toMatch(/gh\s+label\s+list|"\$GH"\s+label\s+list/);
  });

  test('script treats "label already exists" as success (idempotent)', () => {
    // `gh label create story` returns 422 + stderr "label already exists"
    // when re-run. The fix detects this exit-code/stderr-substring + continues.
    expect(scriptContent).toMatch(/already exists|label.{0,40}exists/i);
  });
});

describe('SHY-0067: script body — Defect D (Project v2 board addition)', () => {
  let scriptContent;

  beforeAll(() => {
    scriptContent = fs.readFileSync(SCRIPT, 'utf8');
  });

  test('script defines a project-add helper (e.g. add_to_project_board)', () => {
    expect(scriptContent).toMatch(/add_to_project_board|add_to_project|project_add/);
  });

  test('script invokes the addProjectV2ItemById GraphQL mutation', () => {
    // GraphQL is the only API capable of adding to Projects v2 (no REST
    // endpoint). gh exposes it via `gh api graphql -f query='mutation { ... }'`.
    expect(scriptContent).toMatch(/addProjectV2ItemById/);
  });

  test('script invokes the updateProjectV2ItemFieldValue mutation for field population', () => {
    expect(scriptContent).toMatch(/updateProjectV2ItemFieldValue/);
  });

  test('script references the ShyTalk Stories Project v2 (number 1 in Shyden-Ltd)', () => {
    // The script must know WHICH project to add items to. Either via a hard-
    // coded project ID or via a lookup against `gh project list --owner ...`.
    expect(scriptContent).toMatch(
      /projectV2|ShyTalk Stories|Shyden-Ltd.{0,60}project|projectId|PROJECT_NUMBER/,
    );
  });
});

describe('SHY-0067: script body — Defect E (Type field auto-create)', () => {
  let scriptContent;

  beforeAll(() => {
    scriptContent = fs.readFileSync(SCRIPT, 'utf8');
  });

  test('script defines a Type-field-ensure helper', () => {
    expect(scriptContent).toMatch(/ensure_project_type_field|ensure_type_field|type_field_create/);
  });

  test('script invokes the createProjectV2Field mutation', () => {
    expect(scriptContent).toMatch(/createProjectV2Field/);
  });

  test('Type-field options include all 7 SHY types', () => {
    // type enum: feature, bug, refactor, docs, infra, spike, chore.
    // The fix passes these as singleSelectOptions to createProjectV2Field.
    const types = ['feature', 'bug', 'refactor', 'docs', 'infra', 'spike', 'chore'];
    const allPresent = types.every(
      (t) =>
        scriptContent.includes(`"${t}"`) ||
        scriptContent.includes(`name: ${t}`) ||
        scriptContent.includes(`name: "${t}"`),
    );
    expect(allPresent).toBe(true);
  });
});

describe('SHY-0067: script body — issue body passed via stdin (safe shell escape)', () => {
  let scriptContent;

  beforeAll(() => {
    scriptContent = fs.readFileSync(SCRIPT, 'utf8');
  });

  test('script invokes `gh issue create` with --body-file - (stdin) NOT --body "$body"', () => {
    // SHYs contain markdown with single quotes, backticks, and multi-line
    // sections. Passing as `--body "$body"` argv is shell-escape-fragile; the
    // fix uses `--body-file -` so the body comes from stdin via heredoc.
    expect(scriptContent).toMatch(/issue\s+create[^\n]*--body-file\s+-/);
    expect(scriptContent).not.toMatch(/issue\s+create[^\n]*--body\s+"\$body"/);
  });
});

// ============================================================== Mock-gh runtime tests
// These exercise the script end-to-end against a mock-gh binary, asserting
// the API call SEQUENCE matches the SHY-0067 contract.

describe('SHY-0067: runtime — label auto-create flow (mock-gh)', () => {
  test('first sync of a bug story invokes `gh label list` then `gh label create` before `issue create`', () => {
    const { ghPath, recording, dir } = makeMockGh();
    // `label list` returns empty array (no labels exist yet).
    fs.writeFileSync(path.join(dir, 'gh-responses-label-list'), '[]');
    // Realistic create/view responses — post reviewer-C1 the node-id
    // resolution failure is no longer silently swallowed, so the fixture
    // must let the create sequence complete.
    fs.writeFileSync(
      path.join(dir, 'gh-responses-issue-create'),
      'https://github.com/Shyden-Ltd/ShyTalk/issues/100\n',
    );
    fs.writeFileSync(path.join(dir, 'gh-responses-issue-view'), 'I_test_node_id\n');
    fs.writeFileSync(
      path.join(dir, 'gh-responses-api-graphql'),
      JSON.stringify({
        data: {
          organization: { projectV2: { id: 'PVT_test', fields: { nodes: [] } } },
          addProjectV2ItemById: { item: { id: 'PVTI_test' } },
        },
      }),
    );

    const { code } = runScript(['--story', 'SHY-7001'], {
      env: mockEnv(ghPath, makeBugStoryDir()),
    });
    expect(code).toBe(0);

    const calls = readRecording(recording);
    const labelListIdx = calls.findIndex((c) => c.startsWith('label list'));
    const labelCreateIdx = calls.findIndex((c) => c.startsWith('label create'));
    const issueCreateIdx = calls.findIndex((c) => c.startsWith('issue create'));
    // All three must occur, in this order: label list → label create → issue create.
    expect(labelListIdx).toBeGreaterThanOrEqual(0);
    expect(labelCreateIdx).toBeGreaterThan(labelListIdx);
    expect(issueCreateIdx).toBeGreaterThan(labelCreateIdx);
  });
});

describe('SHY-0067: runtime — silent-failure removal (mock-gh)', () => {
  test('script exits non-zero when `gh issue create` fails', () => {
    const { ghPath, dir } = makeMockGh();
    // Per-call exit override: `issue create` returns non-zero.
    fs.writeFileSync(path.join(dir, 'gh-exit-cmd-issue-create'), '1');

    const { code, stderr } = runScript(['--story', 'SHY-7001'], {
      env: mockEnv(ghPath, makeBugStoryDir()),
    });
    // Pre-SHY-0067: code would be 0 (silent success). Post-fix: code is 40.
    expect(code).toBe(40);
    // Stderr should reveal the failure — no more `>/dev/null 2>&1`.
    expect(stderr).toMatch(/failed to create issue|issue create failed|N_FAILED/i);
  });
});

describe('SHY-0067: runtime — Project v2 board addition (mock-gh)', () => {
  test('script invokes `gh api graphql` with addProjectV2ItemById after `issue create`', () => {
    const { ghPath, recording, dir } = makeMockGh();
    fs.writeFileSync(path.join(dir, 'gh-responses-label-list'), '[]');
    // `issue create` returns the issue URL (gh issue create's default stdout).
    fs.writeFileSync(
      path.join(dir, 'gh-responses-issue-create'),
      'https://github.com/Shyden-Ltd/ShyTalk/issues/100\n',
    );
    // `issue view 100 --json id --jq .id` returns the node ID. This is the
    // second gh call extract_issue_node_id() makes (it parses the issue
    // number from the URL then queries gh for the node_id).
    fs.writeFileSync(path.join(dir, 'gh-responses-issue-view'), 'I_test_node_id\n');
    // `api graphql` (for project lookups + mutation) returns enough JSON to
    // keep the script happy.
    fs.writeFileSync(
      path.join(dir, 'gh-responses-api-graphql'),
      JSON.stringify({
        data: {
          organization: {
            projectV2: {
              id: 'PVT_kwDOC_test',
              fields: { nodes: [] },
            },
          },
          addProjectV2ItemById: { item: { id: 'PVTI_lADO_test' } },
        },
      }),
    );

    const { code } = runScript(['--story', 'SHY-7001'], {
      env: mockEnv(ghPath, makeBugStoryDir()),
    });
    expect(code).toBe(0);

    const calls = readRecording(recording);
    // The board-add mutation must appear AFTER the issue create.
    const createIdx = calls.findIndex((c) => c.startsWith('issue create'));
    const projectAddIdx = calls.findIndex(
      (c) => c.startsWith('api graphql') && c.includes('addProjectV2ItemById'),
    );
    expect(createIdx).toBeGreaterThanOrEqual(0);
    expect(projectAddIdx).toBeGreaterThan(createIdx);
  });
});

// SHY-0067 reviewer-I3's "at least one field" runtime test used to live
// here. SHY-0074 DELETED it: that assertion shape is banned (it let the
// all-To-Do board defect ship), and its replacement is the per-value
// create+update field matrix in sync-stories-to-issues-board-fields.test.js
// (every Status/Pri/Effort/Type/SHY ID/Roadmap value asserted by exact
// option-id/text on a per-item basis).

// SHY-0067 reviewer-I4: extended summary format introduced by the fix is
// not covered by either test file. Assert it explicitly so a future
// regression to the original "Sync result: N created..." short form is
// caught.
describe('SHY-0067: extended summary format (mock-gh, reviewer-I4)', () => {
  test('--all --dry-run summary line contains the extended SHY-0067 counters', () => {
    const repoRoot = REPO_ROOT;
    const SYNC_SCRIPT = path.join(repoRoot, 'scripts', 'sync-stories-to-issues.sh');
    const res = require('node:child_process').spawnSync(
      'bash',
      [SYNC_SCRIPT, '--all', '--dry-run'],
      { encoding: 'utf-8', cwd: repoRoot, timeout: 90_000 },
    );
    expect(res.status ?? 1).toBe(0);
    const stderr = res.stderr ?? '';
    // SHY-0074 v2 form: created splits into drafts + issues.
    expect(stderr).toMatch(
      /Sync result: \d+ created \(\d+ drafts, \d+ issues\), \d+ updated, \d+ skipped, \d+ failed/,
    );
    // Extended counters (SHY-0067 + SHY-0074).
    expect(stderr).toMatch(/labels created: \d+/);
    expect(stderr).toMatch(/project items added: \d+/);
    expect(stderr).toMatch(/project items deleted: \d+/);
    expect(stderr).toMatch(/issues deleted: \d+/);
    expect(stderr).toMatch(/project fields updated: \d+/);
    expect(stderr).toMatch(/comments posted: \d+/);
    expect(stderr).toMatch(/issues closed: \d+/);
    expect(stderr).toMatch(/type-field auto-created: (yes|no)/);
  });
});

// SHY-0067 reviewer-I5 pinned the per-story lookup failure path. SHY-0074
// v2 replaced per-story `gh issue list` searches with the single paginated
// items-map query — the analogous failure mode is the map query failing,
// which must abort the whole run BEFORE any mutations (a wrong map would
// make every create-vs-update decision wrong → duplicate issues).
describe('SHY-0074: runtime — items-map lookup failure path (mock-gh)', () => {
  test('items query non-zero exit → exit 40 + no spurious issue create', () => {
    const { ghPath, recording, dir } = makeMockGh();
    fs.writeFileSync(path.join(dir, 'gh-responses-label-list'), '[]');
    // Simulate transient items-query failure (network/auth/rate-limit).
    fs.writeFileSync(path.join(dir, 'gh-exit-items-query'), '1');

    const { code, stderr } = runScript(['--story', 'SHY-7001'], {
      env: mockEnv(ghPath, makeBugStoryDir()),
    });
    expect(code).toBe(40);
    // No `issue create` call should have been recorded — the run aborts
    // before any mutation.
    const calls = readRecording(recording);
    const hasCreate = calls.some((c) => c.startsWith('issue create'));
    expect(hasCreate).toBe(false);
    // The error context should be visible in stderr (no >/dev/null silencing).
    expect(stderr).toMatch(/items-map query failed|items query/i);
  });
});

// SHY-0067 reviewer-I6: `add_to_project_board` failure is silently swallowed
// by `|| true` on the create path (line 847) and the update path (line 903),
// AND on every `set_project_field_*` call inside `populate_project_fields`
// (lines 581/586/591/595/599). AC line 79 of the story explicitly requires
// `N_FAILED++` + non-zero exit on board-add failure (Defect-C-class silent
// success otherwise leaks through the Defect-D code path). This test
// simulates the addProjectV2ItemById mutation returning a null item by
// shaping the gh api graphql response payload — load_project_cache still
// succeeds (project lookup is unaffected) but the mutation returns no item id,
// driving add_to_project_board to its empty-id branch (line 491-494).
describe('SHY-0067: runtime — board-add failure → N_FAILED (mock-gh, reviewer-I6)', () => {
  test('addProjectV2ItemById returning null item drives N_FAILED++ + exit 40', () => {
    const { ghPath, recording, dir } = makeMockGh();
    fs.writeFileSync(path.join(dir, 'gh-responses-label-list'), '[]');
    fs.writeFileSync(
      path.join(dir, 'gh-responses-issue-create'),
      'https://github.com/Shyden-Ltd/ShyTalk/issues/100\n',
    );
    fs.writeFileSync(path.join(dir, 'gh-responses-issue-view'), 'I_test_node_id\n');
    // Project lookup succeeds (so load_project_cache passes) BUT
    // addProjectV2ItemById returns null (simulates PAT missing project:write,
    // or upstream board id changing). Field-set keys are present so any
    // post-add path that incorrectly proceeds would still appear consistent.
    // (The items-map query is served separately by the mock's dedicated
    // channel — an empty board, so the create path runs.)
    fs.writeFileSync(
      path.join(dir, 'gh-responses-api-graphql'),
      JSON.stringify({
        data: {
          organization: {
            projectV2: { id: 'PVT_kwDOC_test', fields: { nodes: [] } },
          },
          addProjectV2ItemById: null,
        },
      }),
    );

    const { code, stderr } = runScript(['--story', 'SHY-7001'], {
      env: mockEnv(ghPath, makeBugStoryDir()),
    });

    // Pre-fix: `|| true` swallowed the return-1 from add_to_project_board,
    // script exited 0. Post-fix: failure increments N_FAILED and the
    // Defect-C exit-40 gate fires.
    expect(code).toBe(40);
    // The board-add error must surface in stderr (no `>/dev/null` silencing,
    // matches the Defect-C contract). emit() route OR explicit failure marker.
    expect(stderr).toMatch(/addProjectV2ItemById|item-add|project board|N_FAILED/i);
    // Sanity check: the addProjectV2ItemById mutation was actually invoked
    // (otherwise we'd be testing the wrong silent-failure path).
    const calls = readRecording(recording);
    const projectAdd = calls.find(
      (c) => c.startsWith('api graphql') && c.includes('addProjectV2ItemById'),
    );
    expect(projectAdd).toBeDefined();
  });
});

describe('SHY-0067: existing test compatibility', () => {
  // Existing sync-stories-to-issues.test.js covers the structural script
  // behaviour (help, exit codes, body-hash detection). Those tests must still
  // pass post-SHY-0067 — the fix is additive, not breaking. Confirmed by
  // running the full Jest suite post-implementation.
  //
  // This describe is intentionally a marker / smoke test reminder; full
  // coverage lives in the sibling file.
  test('sibling test file (sync-stories-to-issues.test.js) still exists', () => {
    expect(
      fs.existsSync(
        path.join(REPO_ROOT, 'express-api/tests/scripts/sync-stories-to-issues.test.js'),
      ),
    ).toBe(true);
  });
});
