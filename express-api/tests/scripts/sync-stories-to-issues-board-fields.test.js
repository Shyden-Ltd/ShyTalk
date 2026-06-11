/* eslint-disable sonarjs/no-os-command-from-path
   -- test harness invokes `bash` and the script-under-test in temporary
   directories with controlled inputs (same pattern as the sibling
   sync-stories-to-issues test files). Not security-sensitive. */
/**
 * SHY-0081: Mirror architecture v3 — EVERY story type (incl. bug) becomes a
 * board DRAFT card; the GitHub Issues page is never written from the corpus.
 * (Supersedes the SHY-0074 v2 model where type:bug stories became Issues.)
 *
 * Value-level behavior matrix for scripts/sync-stories-to-issues.sh. Every
 * assertion names a concrete expected value landing on a concrete surface
 * (board field option id, draft body text, summary counter, item id) — no
 * "at least one X" shapes, per the strict-testing standard codified
 * 2026-06-10.
 *
 * Spec: .project/stories/SHY-0081-mirror-v3-uniform-board-drafts.md
 *
 * Harness: a pattern-matching mock `gh` (first-match rules file,
 * \x1f-delimited: pattern, stdout-response-file, exit-code, stderr-text)
 * that records every argv line AND captures stdin for GraphQL mutations
 * passing a body via `-F body=@-` (draft create/update), plus a STORIES_DIR
 * override so the matrix runs against generated fixture stories, never the
 * live corpus. (The mock retains issue-create/edit stdin capture for
 * back-compat, but v3 never invokes those — asserted by the no-issue-writes
 * tests.)
 */

const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'sync-stories-to-issues.sh');
const VALIDATOR = path.join(REPO_ROOT, 'scripts', 'check-story-frontmatter.sh');

const GITHUB_BODY_LIMIT = 65536;
const SOURCE_URL_PREFIX = 'https://github.com/Shyden-Ltd/ShyTalk/blob/main/.project/stories';

const TEMP_DIRS = [];
function tempDir(prefix = 'sync74-') {
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

// ============================================================== mock gh

/**
 * Pattern-matching mock gh. Behaviour:
 *  - appends the full argv line to recording.log
 *  - for `issue create` / `issue edit`, captures stdin to
 *    stdin-issue-<sub>-<n>.txt (n increments per capture, in call order)
 *  - for `api graphql` calls whose argv contains `body=@-`, captures stdin
 *    to stdin-graphql-<n>.txt (draft-issue bodies travel via stdin so the
 *    one-line-per-call recording format survives multi-line bodies)
 *  - walks rules.tsv (\x1f-separated: ERE-pattern, stdout-response-file,
 *    exit-code, stderr-text); FIRST matching pattern wins: cats the
 *    response file (if named), prints the stderr text (if any) to stderr,
 *    exits with the code (default 0). No match → exit 0, no output.
 */
function makePatternMockGh() {
  const dir = tempDir('mockgh74-');
  const ghPath = path.join(dir, 'gh');
  const recording = path.join(dir, 'recording.log');
  fs.writeFileSync(recording, '');
  const mockSource = `#!/usr/bin/env bash
DIR="${dir}"
args="$*"
printf '%s\\n' "$args" >> "$DIR/recording.log"
case "$1-$2" in
  issue-create|issue-edit)
    n=$(cat "$DIR/stdin-issue.count" 2>/dev/null || echo 0)
    n=$((n+1))
    printf '%s' "$n" > "$DIR/stdin-issue.count"
    cat > "$DIR/stdin-issue-$2-$n.txt"
    ;;
  api-graphql)
    if printf '%s' "$args" | grep -q -- 'body=@-'; then
      n=$(cat "$DIR/stdin-graphql.count" 2>/dev/null || echo 0)
      n=$((n+1))
      printf '%s' "$n" > "$DIR/stdin-graphql.count"
      cat > "$DIR/stdin-graphql-$n.txt"
    fi
    ;;
esac
if [ -f "$DIR/rules.tsv" ]; then
  # Unit-separator delimited: TAB is IFS *whitespace*, so consecutive tabs
  # collapse and empty fields vanish; \\x1f preserves them.
  while IFS=$'\\x1f' read -r pat resp code errtext; do
    [ -z "$pat" ] && continue
    if printf '%s' "$args" | grep -qE -- "$pat"; then
      if [ -n "$resp" ] && [ -f "$DIR/$resp" ]; then cat "$DIR/$resp"; fi
      if [ -n "$errtext" ]; then printf '%s\\n' "$errtext" >&2; fi
      [ -n "$code" ] || code=0
      exit "$code"
    fi
  done < "$DIR/rules.tsv"
fi
exit 0
`;
  fs.writeFileSync(ghPath, mockSource);
  fs.chmodSync(ghPath, 0o755);
  return { ghPath, dir, recording };
}

/** Write the rules file. rules = [[pattern, responseFile|'', exitCode|'', stderrText|''], ...] */
function writeRules(dir, rules) {
  const US = '\x1f';
  fs.writeFileSync(
    path.join(dir, 'rules.tsv'),
    rules.map((r) => `${r[0]}${US}${r[1] ?? ''}${US}${r[2] ?? ''}${US}${r[3] ?? ''}`).join('\n') +
      '\n',
  );
}

function writeResponse(dir, name, content) {
  fs.writeFileSync(path.join(dir, name), content);
}

function readRecording(recordingPath) {
  if (!fs.existsSync(recordingPath)) return [];
  return fs
    .readFileSync(recordingPath, 'utf-8')
    .split('\n')
    .filter((l) => l.length > 0);
}

/** stdin capture files in capture order. family = 'issue-create' | 'issue-edit' | 'graphql'. */
function readCaptures(dir, family) {
  const prefix = family === 'graphql' ? 'stdin-graphql-' : `stdin-${family}-`;
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.txt'))
    .sort((a, b) => {
      const na = Number(a.match(/-(\d+)\.txt$/)[1]);
      const nb = Number(b.match(/-(\d+)\.txt$/)[1]);
      return na - nb;
    })
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf-8'));
}

// ============================================================== fixtures

/** The live board's field/option schema (option names captured 2026-06-10). */
function selectField(name, id, options) {
  return {
    __typename: 'ProjectV2SingleSelectField',
    id,
    name,
    dataType: 'SINGLE_SELECT',
    options: Object.entries(options).map(([optName, optId]) => ({ id: optId, name: optName })),
  };
}
function textField(name, id) {
  return { __typename: 'ProjectV2Field', id, name, dataType: 'TEXT' };
}

const STATUS_OPTIONS = {
  Todo: 'opt-st-todo',
  'In Progress': 'opt-st-inprog',
  'In Review': 'opt-st-inrev',
  Done: 'opt-st-done',
  Cancelled: 'opt-st-cancel',
};

function fieldsResponse({ omitStatus = false, statusOptions = STATUS_OPTIONS } = {}) {
  const nodes = [
    selectField('Pri', 'field-pri', {
      P0: 'opt-pri-p0',
      P1: 'opt-pri-p1',
      P2: 'opt-pri-p2',
      P3: 'opt-pri-p3',
    }),
    selectField('Effort', 'field-effort', {
      XS: 'opt-eff-xs',
      S: 'opt-eff-s',
      M: 'opt-eff-m',
      L: 'opt-eff-l',
      XL: 'opt-eff-xl',
    }),
    selectField('Type', 'field-type', {
      feature: 'opt-type-feature',
      bug: 'opt-type-bug',
      refactor: 'opt-type-refactor',
      docs: 'opt-type-docs',
      infra: 'opt-type-infra',
      spike: 'opt-type-spike',
      chore: 'opt-type-chore',
    }),
    textField('SHY ID', 'field-shyid'),
    textField('Roadmap IDs', 'field-roadmap'),
  ];
  if (!omitStatus) {
    nodes.unshift(selectField('Status', 'field-status', statusOptions));
  }
  return JSON.stringify({
    data: { organization: { projectV2: { id: 'PROJ_1', fields: { nodes } } } },
  });
}

const ADD_ITEM_RESPONSE = JSON.stringify({
  data: { addProjectV2ItemById: { item: { id: 'ITEM_1' } } },
});

function draftAddResponse(itemId, contentId = `${itemId}_DI`) {
  // SHY-0079: addProjectV2DraftIssue now also returns the DraftIssue content
  // id (projectItem.content.id) for the sidecar.
  return JSON.stringify({
    data: { addProjectV2DraftIssue: { projectItem: { id: itemId, content: { id: contentId } } } },
  });
}

const DRAFT_UPDATE_RESPONSE = JSON.stringify({
  data: { updateProjectV2DraftIssue: { draftIssue: { id: 'DI_X' } } },
});

/** Items-map query node for a draft-backed board item. */
function draftNode(shyId, itemId, draftId, body, title = `${shyId}: Fixture story`) {
  return {
    id: itemId,
    content: { __typename: 'DraftIssue', id: draftId, title, body },
    fieldValueByName: { text: shyId },
  };
}

/** Items-map query node for an issue-backed board item. */
function issueNode(shyId, itemId, number, state = 'OPEN', title = `${shyId}: Fixture story`) {
  return {
    id: itemId,
    content: { __typename: 'Issue', id: `I_node_${number}`, number, state, title },
    fieldValueByName: { text: shyId },
  };
}

function itemsResponse(nodes, { hasNextPage = false, endCursor = null } = {}) {
  return JSON.stringify({
    data: {
      organization: {
        projectV2: { items: { pageInfo: { hasNextPage, endCursor }, nodes } },
      },
    },
  });
}

const EMPTY_ITEMS = itemsResponse([]);

/**
 * Generate a fully valid fixture story (passes check-story-frontmatter.sh —
 * template proven against the validator at authoring time).
 */
function makeStory(
  storiesDir,
  {
    id,
    slug,
    status = 'Draft',
    priority = 'P1',
    effort = 'M',
    type = 'bug',
    roadmaps = '[G001, G024]',
    why = 'Fixture.',
    releasedIn = '',
    notesExtra = '',
  },
) {
  const fileSlug = slug ?? `${id}-fixture-story`;
  const releasedLine = releasedIn ? `released_in: ${releasedIn}\n` : '';
  const content = `---
id: ${id}
status: ${status}
owner: claude
created: 2026-06-10
priority: ${priority}
effort: ${effort}
type: ${type}
roadmap_ids: ${roadmaps}
pr:
${releasedLine}---

# ${id}: Fixture story for board-field matrix tests

## User Story

As a test, I want a valid story, so that the sync script processes me.

## Why

${why}

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

Covered by the harness itself.

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
${notesExtra}`;
  const filePath = path.join(storiesDir, `${fileSlug}.md`);
  fs.writeFileSync(filePath, content);
  return { filePath, content, fileSlug };
}

/** The spec body the script should embed: file content after the closing
 *  frontmatter delimiter, with trailing newlines stripped (command-
 *  substitution semantics in the script). */
function expectedSpecBody(content) {
  const fmClose = content.indexOf('\n---\n', 3);
  const body = content.slice(fmClose + '\n---\n'.length);
  let end = body.length;
  while (end > 0 && body[end - 1] === '\n') end -= 1;
  return body.slice(0, end);
}

/** The exact hash the script computes: sha256 over the awk-extracted body
 *  stream (post-frontmatter lines, each newline-terminated). */
function currentBodyHash(content) {
  return crypto
    .createHash('sha256')
    .update(expectedSpecBody(content) + '\n')
    .digest('hex');
}

/** A previously-synced footer with a chosen status marker + stored hash. */
function syncedFooter(fileSlug, statusMarker, hash) {
  return (
    `---\n\n_Source: ${SOURCE_URL_PREFIX}/${fileSlug}.md_\n` +
    `_Status: ${statusMarker}_\n` +
    `_Last synced: 2026-06-10T00:00:00Z from commit abc123 body-hash: ${hash}_\n`
  );
}

/** An existing mirror body whose stored hash matches the CURRENT file —
 *  only the status marker (and any spec text) can differ. */
function existingBody(content, fileSlug, statusMarker) {
  return `Synced earlier.\n\n${syncedFooter(fileSlug, statusMarker, currentBodyHash(content))}`;
}

const STALE_HASH = '0'.repeat(64);

function runScript(args, env) {
  const res = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf-8',
    cwd: REPO_ROOT,
    timeout: 120_000,
    env,
  });
  return { code: res.status ?? 1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

function baseEnv(ghPath, storiesDir, extra = {}) {
  return {
    ...process.env,
    GH: ghPath,
    GH_TOKEN: 'fake-pat-for-test',
    GH_PAT_PROJECT: 'fake-pat-for-test',
    STORIES_DIR: storiesDir,
    // SHY-0078: zero backoff so the empty-read retry doesn't slow tests.
    ITEMS_MAP_RETRY_BACKOFF: '0',
    // SHY-0079: isolate the sidecar to the mock dir so tests never read or
    // clobber the real .project/board-items.json. Default points at a
    // (usually absent) per-mock file → bootstrap/no-overlay; sidecar tests
    // pre-write it.
    BOARD_ITEMS_FILE: path.join(path.dirname(ghPath), 'board-items.json'),
    ...extra,
  };
}

/** Standard create-path rules: empty items map (nothing on the board yet),
 *  bug-issue create returns a URL, node-id lookup resolves, draft create
 *  returns a generic item, board calls succeed. */
function createPathRules(dir, { fields = fieldsResponse(), items = EMPTY_ITEMS } = {}) {
  writeResponse(dir, 'resp-fields.json', fields);
  writeResponse(dir, 'resp-items.json', items);
  writeResponse(dir, 'resp-add.json', ADD_ITEM_RESPONSE);
  writeResponse(dir, 'resp-draft-add.json', draftAddResponse('ITEM_D1'));
  writeResponse(dir, 'resp-draft-update.json', DRAFT_UPDATE_RESPONSE);
  writeResponse(dir, 'resp-create-url.txt', 'https://github.com/Shyden-Ltd/ShyTalk/issues/100\n');
  writeResponse(dir, 'resp-node-id.txt', 'I_node_100\n');
  writeResponse(dir, 'resp-labels.txt', 'story\ndependencies\n');
  return [
    ['updateProjectV2ItemFieldValue', '', ''],
    ['updateProjectV2DraftIssue', 'resp-draft-update.json', ''],
    ['addProjectV2ItemById', 'resp-add.json', ''],
    ['addProjectV2DraftIssue', 'resp-draft-add.json', ''],
    ['items\\(first: 100', 'resp-items.json', ''],
    ['ProjectV2SingleSelectField', 'resp-fields.json', ''],
    // SHY-0078 dedup guard: the consistent-source issue search defaults to
    // "no existing issue" (empty) so the create path proceeds. Tests that
    // exercise a stale-map hit override this with a number-returning rule.
    ['^issue list', '', ''],
    ['^issue create', 'resp-create-url.txt', ''],
    ['^issue view 100 --json id', 'resp-node-id.txt', ''],
    ['^label list', 'resp-labels.txt', ''],
  ];
}

/** Field mutation line scoped to a specific board item — value-level AND
 *  attribution-level precise (no cross-story leakage possible). */
function fieldLine(lines, itemId, fieldId, valueExpr) {
  return lines.find(
    (l) =>
      l.includes('updateProjectV2ItemFieldValue') &&
      l.includes(`itemId=${itemId}`) &&
      l.includes(`fieldId=${fieldId}`) &&
      l.includes(valueExpr),
  );
}

// ============================================================== SHY-0081 v3 uniform routing

describe('SHY-0081 v3: every story type → a board DRAFT card; the Issues page is never written from the corpus (mock-gh)', () => {
  // The model reversal: in v2 a `type: bug` story became a GitHub Issue. In
  // v3 EVERY type (incl. bug) becomes a board draft; the Issues page is
  // reserved for a future, separate bug-REPORT intake — never written here.
  const ALL_TYPES = ['feature', 'bug', 'refactor', 'docs', 'infra', 'spike', 'chore'];
  const idFor = (i) => `SHY-81${String(i + 10)}`;

  let lines;
  let result;
  let mock;

  beforeAll(() => {
    mock = makePatternMockGh();
    const storiesDir = tempDir('stories81-');
    ALL_TYPES.forEach((type, i) => {
      writeResponse(mock.dir, `resp-draft-${idFor(i)}.json`, draftAddResponse(`ITEM_${idFor(i)}`));
    });
    ALL_TYPES.forEach((type, i) =>
      makeStory(storiesDir, { id: idFor(i), status: 'In Progress', type }),
    );
    const rules = createPathRules(mock.dir);
    const perStory = ALL_TYPES.map((_t, i) => [
      `addProjectV2DraftIssue.*title=${idFor(i)}:`,
      `resp-draft-${idFor(i)}.json`,
      '',
    ]);
    writeRules(mock.dir, [...perStory, ...rules]);
    result = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    lines = readRecording(mock.recording);
  });

  test('run exits 0 and reports 7 created — no draft/issue split (there is only one kind of card)', () => {
    expect(result.code).toBe(0);
    expect(result.stderr).toMatch(/Sync result: 7 created, 0 updated, 0 skipped, 0 failed/);
    // v2's "(N drafts, N issues)" split is gone — uniform routing means one kind.
    expect(result.stderr).not.toMatch(/drafts,.*issues\)/);
  });

  test.each(ALL_TYPES.map((t, i) => [t, idFor(i)]))(
    'type:%s story (%s) creates a board DRAFT item',
    (_type, id) => {
      expect(
        lines.find((l) => l.includes('addProjectV2DraftIssue') && l.includes(`title=${id}:`)),
      ).toBeDefined();
    },
  );

  test('exactly 7 draft creates fired (one per story, none duplicated)', () => {
    expect(lines.filter((l) => l.includes('addProjectV2DraftIssue'))).toHaveLength(7);
  });

  test('HEADLINE: NO gh issue create / edit / comment / close / list for ANY story type', () => {
    expect(lines.filter((l) => l.startsWith('issue create'))).toEqual([]);
    expect(lines.filter((l) => l.startsWith('issue edit'))).toEqual([]);
    expect(lines.filter((l) => l.startsWith('issue comment'))).toEqual([]);
    expect(lines.filter((l) => l.startsWith('issue close'))).toEqual([]);
    expect(lines.filter((l) => l.startsWith('issue list'))).toEqual([]);
  });

  test('the bug-type story is a DRAFT, not an Issue (the v2→v3 reversal, asserted at the value level)', () => {
    const id = idFor(ALL_TYPES.indexOf('bug'));
    expect(
      lines.find((l) => l.includes('addProjectV2DraftIssue') && l.includes(`title=${id}:`)),
    ).toBeDefined();
    expect(lines.find((l) => l.startsWith('issue create') && l.includes(`${id}:`))).toBeUndefined();
  });

  test('no addProjectV2ItemById — issue-backed board adds are retired', () => {
    expect(lines.filter((l) => l.includes('addProjectV2ItemById'))).toEqual([]);
  });

  test('the bug-type draft still gets its Type=bug board field (kind of work, on the board)', () => {
    const id = idFor(ALL_TYPES.indexOf('bug'));
    expect(fieldLine(lines, `ITEM_${id}`, 'field-type', 'optionId=opt-type-bug')).toBeDefined();
  });

  test('summary drops the issue-specific counters entirely (no comments/closed/dedup/labels-created)', () => {
    expect(result.stderr).not.toMatch(/comments posted/);
    expect(result.stderr).not.toMatch(/issues closed/);
    expect(result.stderr).not.toMatch(/dedup-guard hits/);
    expect(result.stderr).not.toMatch(/labels created/);
  });

  test('summary still reports the retained draft + board counters', () => {
    expect(result.stderr).toMatch(/status fields set: 7/);
    expect(result.stderr).toMatch(/bodies embedded: 7/);
    expect(result.stderr).toMatch(/project items added: 7/);
  });
});

describe('SHY-0081 v3: legacy issue-backed board items are converted to drafts (incremental migration safety net)', () => {
  test('an items-map entry still backed by an ISSUE → board item deleted, issue deleted, recreated as a draft', () => {
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories81m-');
    makeStory(storiesDir, { id: 'SHY-8120', status: 'In Progress', type: 'bug' });
    const items = itemsResponse([issueNode('SHY-8120', 'ITEM_I8120', 820)]);
    const rules = createPathRules(mock.dir, { items });
    writeRules(mock.dir, [['deleteProjectV2Item', '', ''], ['deleteIssue', '', ''], ...rules]);
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(0);
    const lines = readRecording(mock.recording);
    const delItemIdx = lines.findIndex(
      (l) => l.includes('deleteProjectV2Item') && l.includes('itemId=ITEM_I8120'),
    );
    const delIssueIdx = lines.findIndex(
      (l) => l.includes('deleteIssue') && l.includes('issueId=I_node_820'),
    );
    const createIdx = lines.findIndex(
      (l) => l.includes('addProjectV2DraftIssue') && l.includes('title=SHY-8120:'),
    );
    expect(delItemIdx).toBeGreaterThanOrEqual(0);
    expect(delIssueIdx).toBeGreaterThanOrEqual(0);
    expect(createIdx).toBeGreaterThan(delItemIdx);
    // The issue is only DELETED — never written (no create/edit/comment).
    expect(lines.filter((l) => l.startsWith('issue create'))).toEqual([]);
    expect(lines.filter((l) => l.startsWith('issue edit'))).toEqual([]);
    expect(lines.filter((l) => l.startsWith('issue comment'))).toEqual([]);
    expect(r.stderr).toMatch(/issues deleted: 1/);
    expect(r.stderr).toMatch(/project items deleted: 1/);
  });

  test('the converted card lands in the sidecar as backing=DRAFT (not the stale ISSUE)', () => {
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories81m2-');
    makeStory(storiesDir, { id: 'SHY-8121', status: 'In Progress', type: 'bug' });
    const items = itemsResponse([issueNode('SHY-8121', 'ITEM_I8121', 821)]);
    // createPathRules rewrites resp-draft-add.json, so build rules FIRST, then
    // override the draft-create response with distinct asserted ids.
    const rules = createPathRules(mock.dir, { items });
    writeResponse(
      mock.dir,
      'resp-draft-add.json',
      draftAddResponse('NEW_DRAFT_ITEM', 'NEW_DRAFT_DI'),
    );
    writeRules(mock.dir, [['deleteProjectV2Item', '', ''], ['deleteIssue', '', ''], ...rules]);
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(0);
    const sidecar = JSON.parse(fs.readFileSync(path.join(mock.dir, 'board-items.json'), 'utf-8'));
    expect(sidecar['SHY-8121'].backing).toBe('DRAFT');
    expect(sidecar['SHY-8121'].itemId).toBe('NEW_DRAFT_ITEM');
  });

  test('--dry-run on a legacy ISSUE-backed item (known via the sidecar) previews BOTH the delete + the draft create, ZERO mutations', () => {
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories81m3-');
    makeStory(storiesDir, { id: 'SHY-8122', status: 'In Progress', type: 'bug' });
    writeRules(mock.dir, createPathRules(mock.dir));
    // Dry-run makes NO gh calls — it never queries the live items API, so the
    // only way it knows a story is ISSUE-backed is the committed sidecar.
    fs.writeFileSync(
      path.join(mock.dir, 'board-items.json'),
      JSON.stringify({
        'SHY-8122': {
          backing: 'ISSUE',
          itemId: 'ITEM_I8122',
          contentId: 'I_node_822',
          issueNumber: 822,
        },
      }),
    );
    const r = runScript(['--all', '--dry-run'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(0);
    // Both preview lines fire (delete the legacy item+issue, then create a draft).
    expect(r.stderr).toMatch(
      /DRY-RUN: SHY-8122: legacy issue-backed item.*would DELETE.*issue #822/,
    );
    expect(r.stderr).toMatch(/DRY-RUN: SHY-8122: would CREATE DRAFT item/);
    // ZERO mutations actually fired.
    const lines = readRecording(mock.recording);
    expect(lines.filter((l) => l.includes('deleteProjectV2Item'))).toEqual([]);
    expect(lines.filter((l) => l.includes('deleteIssue'))).toEqual([]);
    expect(lines.filter((l) => l.includes('addProjectV2DraftIssue'))).toEqual([]);
  });

  test('delete-item FAILURE during conversion → exit 40, no issue delete, no draft create (no duplicate)', () => {
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories81m4-');
    makeStory(storiesDir, { id: 'SHY-8123', status: 'In Progress', type: 'bug' });
    const items = itemsResponse([issueNode('SHY-8123', 'ITEM_I8123', 823)]);
    const rules = createPathRules(mock.dir, { items });
    // The board-item delete fails → early return before issue-delete / recreate.
    writeRules(mock.dir, [['deleteProjectV2Item', '', '1'], ['deleteIssue', '', ''], ...rules]);
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(40);
    expect(r.stderr).toMatch(/failed to delete item ITEM_I8123 during issue→draft migration/);
    const lines = readRecording(mock.recording);
    // The issue was NOT deleted and NO draft was created — no duplicate left behind.
    expect(lines.filter((l) => l.includes('deleteIssue'))).toEqual([]);
    expect(lines.filter((l) => l.includes('addProjectV2DraftIssue'))).toEqual([]);
  });

  test('deleteIssue permission gap during conversion → loud warning + exit 40, but the draft IS still created', () => {
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories81m5-');
    makeStory(storiesDir, { id: 'SHY-8124', status: 'In Progress', type: 'bug' });
    const items = itemsResponse([issueNode('SHY-8124', 'ITEM_I8124', 824)]);
    const rules = createPathRules(mock.dir, { items });
    // Item delete succeeds; issue delete is forbidden (PAT lacks issue-delete).
    writeRules(mock.dir, [
      ['deleteProjectV2Item', '', ''],
      [
        'deleteIssue',
        '',
        '1',
        'GraphQL: Resource not accessible by personal access token (FORBIDDEN)',
      ],
      ...rules,
    ]);
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(40); // delete_issue_node counted the failure
    expect(r.stderr).toMatch(/::warning::.*deleteIssue.*GH_PAT_PROJECT/);
    const lines = readRecording(mock.recording);
    // The || true means the recreate is NOT blocked — the draft still lands.
    expect(
      lines.find((l) => l.includes('addProjectV2DraftIssue') && l.includes('title=SHY-8124:')),
    ).toBeDefined();
  });
});

// ============================================================== create-path matrix

describe('SHY-0081 v3: create path — per-value board-field matrix (every type is a draft card) (mock-gh)', () => {
  // SHY-0081 v3: every type (incl. bug) → a board draft card. Types cover all
  // 7 values; statuses cover all 5 lifecycle values; the per-value matrix
  // below proves each frontmatter value lands on the correct board field.
  const MATRIX = [
    {
      id: 'SHY-9001',
      status: 'Draft',
      priority: 'P0',
      effort: 'XS',
      type: 'feature',
      roadmaps: '[G001, G024]',
    },
    {
      id: 'SHY-9002',
      status: 'In Progress',
      priority: 'P1',
      effort: 'S',
      type: 'bug',
      roadmaps: '[G002]',
    },
    {
      id: 'SHY-9003',
      status: 'In Review',
      priority: 'P2',
      effort: 'M',
      type: 'refactor',
      roadmaps: '[G003]',
    },
    {
      id: 'SHY-9004',
      status: 'Done',
      priority: 'P3',
      effort: 'L',
      type: 'docs',
      roadmaps: '[G004]',
    },
    {
      id: 'SHY-9005',
      status: 'Cancelled',
      priority: 'P0',
      effort: 'XL',
      type: 'infra',
      roadmaps: '[G005]',
    },
    { id: 'SHY-9006', status: 'Draft', priority: 'P1', effort: 'M', type: 'spike', roadmaps: '[]' },
    {
      id: 'SHY-9007',
      status: 'Draft',
      priority: 'P2',
      effort: 'S',
      type: 'chore',
      roadmaps: '[G007]',
    },
  ];
  const IDS = MATRIX.map((m) => m.id);
  const DRAFT_IDS = IDS; // SHY-0081 v3: every story is a draft, no bug→issue special case
  const itemFor = (id) => `ITEM_D${id.slice(4)}`;

  let lines;
  let result;
  let mock;
  let stories;

  beforeAll(() => {
    mock = makePatternMockGh();
    const storiesDir = tempDir('stories74-');
    stories = Object.fromEntries(MATRIX.map((m) => [m.id, makeStory(storiesDir, m)]));
    const rules = createPathRules(mock.dir);
    // Per-story item ids so every field mutation is attributable.
    const perStory = [];
    for (const id of DRAFT_IDS) {
      writeResponse(mock.dir, `resp-draft-${id}.json`, draftAddResponse(itemFor(id)));
      perStory.push([`addProjectV2DraftIssue.*title=${id}:`, `resp-draft-${id}.json`, '']);
    }
    writeRules(mock.dir, [...perStory, ...rules]);
    result = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    lines = readRecording(mock.recording);
  });

  test('run exits 0 and reports 7 created (every type is a draft card)', () => {
    expect(result.code).toBe(0);
    expect(result.stderr).toMatch(/Sync result: 7 created, 0 updated, 0 skipped, 0 failed/);
  });

  // ---- Routing: every type → a draft, never the Issues tab
  test.each(IDS)('%s creates a board draft item; NO GitHub issue', (id) => {
    expect(
      lines.find((l) => l.includes('addProjectV2DraftIssue') && l.includes(`title=${id}:`)),
    ).toBeDefined();
    expect(lines.find((l) => l.startsWith('issue create') && l.includes(`${id}:`))).toBeUndefined();
  });

  test('NO issue list reconciliation search for any story (the items map does that)', () => {
    expect(lines.filter((l) => l.startsWith('issue list'))).toEqual([]);
  });

  test('items-map query fired twice — empty board triggers the SHY-0078 empty-read retry (single page each)', () => {
    // The create-path matrix runs against an empty board; SHY-0078 retries a
    // zero-item read once (Projects v2 lag guard), so two single-page reads.
    expect(lines.filter((l) => l.includes('items(first: 100'))).toHaveLength(2);
  });

  // ---- Status ×5 (the headline defect: lifecycle → board column)
  test.each([
    ['SHY-9001', 'Draft', 'opt-st-todo'],
    ['SHY-9002', 'In Progress', 'opt-st-inprog'],
    ['SHY-9003', 'In Review', 'opt-st-inrev'],
    ['SHY-9004', 'Done', 'opt-st-done'],
    ['SHY-9005', 'Cancelled', 'opt-st-cancel'],
  ])('%s (status: %s) → Status option %s on its own item', (id, _status, optionId) => {
    expect(fieldLine(lines, itemFor(id), 'field-status', `optionId=${optionId}`)).toBeDefined();
  });

  // ---- Pri ×4
  test.each([
    ['SHY-9001', 'P0', 'opt-pri-p0'],
    ['SHY-9002', 'P1', 'opt-pri-p1'],
    ['SHY-9003', 'P2', 'opt-pri-p2'],
    ['SHY-9004', 'P3', 'opt-pri-p3'],
  ])('%s (priority: %s) → Pri option %s', (id, _pri, optionId) => {
    expect(fieldLine(lines, itemFor(id), 'field-pri', `optionId=${optionId}`)).toBeDefined();
  });

  // ---- Effort ×5
  test.each([
    ['SHY-9001', 'XS', 'opt-eff-xs'],
    ['SHY-9002', 'S', 'opt-eff-s'],
    ['SHY-9003', 'M', 'opt-eff-m'],
    ['SHY-9004', 'L', 'opt-eff-l'],
    ['SHY-9005', 'XL', 'opt-eff-xl'],
  ])('%s (effort: %s) → Effort option %s', (id, _eff, optionId) => {
    expect(fieldLine(lines, itemFor(id), 'field-effort', `optionId=${optionId}`)).toBeDefined();
  });

  // ---- Type ×7
  test.each([
    ['SHY-9001', 'feature', 'opt-type-feature'],
    ['SHY-9002', 'bug', 'opt-type-bug'],
    ['SHY-9003', 'refactor', 'opt-type-refactor'],
    ['SHY-9004', 'docs', 'opt-type-docs'],
    ['SHY-9005', 'infra', 'opt-type-infra'],
    ['SHY-9006', 'spike', 'opt-type-spike'],
    ['SHY-9007', 'chore', 'opt-type-chore'],
  ])('%s (type: %s) → Type option %s', (id, _type, optionId) => {
    expect(fieldLine(lines, itemFor(id), 'field-type', `optionId=${optionId}`)).toBeDefined();
  });

  // ---- Text fields
  test('SHY ID text field carries the exact story id on every draft item', () => {
    for (const id of IDS) {
      expect(fieldLine(lines, itemFor(id), 'field-shyid', `text=${id}`)).toBeDefined();
    }
  });

  test('Roadmap IDs text field carries the comma-space-joined list', () => {
    expect(fieldLine(lines, itemFor('SHY-9001'), 'field-roadmap', 'text=G001, G024')).toBeDefined();
  });

  test('empty roadmap_ids ⇒ Roadmap IDs field is NOT written', () => {
    const line = lines.find(
      (l) =>
        l.includes('updateProjectV2ItemFieldValue') &&
        l.includes(`itemId=${itemFor('SHY-9006')}`) &&
        l.includes('fieldId=field-roadmap'),
    );
    expect(line).toBeUndefined();
  });

  // ---- Ordering invariants
  test('Status mutation fires AFTER the draft-creating mutation (last-writer vs built-in automation)', () => {
    for (const id of IDS) {
      const createIdx = lines.findIndex(
        (l) => l.includes('addProjectV2DraftIssue') && l.includes(`title=${id}:`),
      );
      const statusIdx = lines.findIndex(
        (l) =>
          l.includes('updateProjectV2ItemFieldValue') &&
          l.includes(`itemId=${itemFor(id)}`) &&
          l.includes('fieldId=field-status'),
      );
      expect(createIdx).toBeGreaterThanOrEqual(0);
      expect(statusIdx).toBeGreaterThan(createIdx);
    }
  });

  test('Status is the LAST field mutation on every item', () => {
    for (const id of IDS) {
      const fieldLines = lines.filter(
        (l) => l.includes('updateProjectV2ItemFieldValue') && l.includes(`itemId=${itemFor(id)}`),
      );
      expect(fieldLines.length).toBeGreaterThan(0);
      expect(fieldLines[fieldLines.length - 1]).toContain('fieldId=field-status');
    }
  });

  // ---- Labels (single-source): v3 creates no labels at all (no issues)
  test('no status:/priority:/effort:/type:/roadmap: label is ever created', () => {
    const familyCreates = lines.filter(
      (l) =>
        l.startsWith('label create') &&
        /label create (status:|priority:|effort:|type:|roadmap:)/.test(l),
    );
    expect(familyCreates).toEqual([]);
  });

  test('NO gh label create at all — the story label is no longer applied (inert)', () => {
    expect(lines.filter((l) => l.startsWith('label create'))).toEqual([]);
  });

  // ---- Draft body (full spec verbatim + footer with status marker), all 7
  test('draft body is the story body verbatim followed by the footer (Source + Status + Last synced)', () => {
    const bodies = readCaptures(mock.dir, 'graphql');
    expect(bodies).toHaveLength(7); // every story is a draft create
    const body = bodies.find((b) => b.includes('# SHY-9001:'));
    expect(body).toBeDefined();
    const spec = expectedSpecBody(stories['SHY-9001'].content);
    expect(body.startsWith(spec)).toBe(true);
    const afterSpec = body.slice(spec.length);
    expect(afterSpec).toMatch(
      new RegExp(
        '^\\n\\n---\\n\\n_Source: https:\\/\\/github\\.com\\/Shyden-Ltd\\/ShyTalk\\/blob\\/main\\/\\.project\\/stories\\/SHY-9001-fixture-story\\.md_\\n' +
          '_Status: Draft_\\n' +
          '_Last synced: \\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z from commit [0-9a-f]+ body-hash: [0-9a-f]{64}_\\n$',
      ),
    );
  });

  test('the bug-type story embeds the FULL spec in its draft (no bug-report stub)', () => {
    const bodies = readCaptures(mock.dir, 'graphql');
    const body = bodies.find((b) => b.includes('# SHY-9002:'));
    expect(body).toBeDefined();
    // It's the full spec body, not a "## Bug / ## Tracking" report.
    expect(body).toContain('## Acceptance Criteria');
    expect(body).not.toContain('## Tracking');
  });

  // ---- No Issues-tab writes of any kind
  test('zero issue create / edit / comment / close across the whole run', () => {
    for (const verb of ['create', 'edit', 'comment', 'close']) {
      expect(lines.filter((l) => l.startsWith(`issue ${verb}`))).toEqual([]);
    }
  });

  // ---- Run summary observability (v3 counters)
  test('summary line reports the v3 counters (no comments/closed/dedup)', () => {
    expect(result.stderr).toMatch(/status fields set: 7/);
    expect(result.stderr).toMatch(/bodies embedded: 7/);
    expect(result.stderr).toMatch(/bodies truncated: 0/);
    expect(result.stderr).not.toMatch(/comments posted/);
    expect(result.stderr).not.toMatch(/issues closed/);
    expect(result.stderr).not.toMatch(/dedup-guard hits/);
  });

  test('CORRECTIVE (pre-existing SHY-0067 bug): project-items-added counter survives the command-substitution subshell', () => {
    // The draft create echo is $()-captured; the counter increment must live
    // at the call site, not in the subshell. 7 draft items added here.
    expect(result.stderr).toMatch(/project items added: 7/);
  });

  // ---- STORIES_DIR isolation
  test('STORIES_DIR override isolates the run from the live corpus', () => {
    const realIds = lines.filter((l) => /SHY-00\d\d:/.test(l));
    expect(realIds).toEqual([]);
  });
});

// ============================================================== update path

describe('SHY-0081 v3: update path — stale draft bodies refresh in place, fields re-asserted (mock-gh)', () => {
  // SHY-9101: draft (chore). SHY-9102: draft (bug-type) — both update as
  // draft cards in v3 (a bug story is a draft, never an issue edit).
  let lines;
  let result;
  let mock;
  let s9101;

  beforeAll(() => {
    mock = makePatternMockGh();
    const storiesDir = tempDir('stories74u-');
    s9101 = makeStory(storiesDir, {
      id: 'SHY-9101',
      status: 'Done',
      priority: 'P0',
      effort: 'XL',
      type: 'chore',
      roadmaps: '[G011]',
    });
    makeStory(storiesDir, {
      id: 'SHY-9102',
      status: 'In Review',
      priority: 'P3',
      effort: 'XS',
      type: 'bug',
      roadmaps: '[G012]',
    });
    const staleDraftBody = `Old draft.\n\n${syncedFooter('SHY-9101-fixture-story', 'Done', STALE_HASH)}`;
    const staleDraftBody2 = `Old draft 2.\n\n${syncedFooter('SHY-9102-fixture-story', 'In Review', STALE_HASH)}`;
    const items = itemsResponse([
      draftNode('SHY-9101', 'ITEM_D9101', 'DI_9101', staleDraftBody),
      draftNode('SHY-9102', 'ITEM_D9102', 'DI_9102', staleDraftBody2),
    ]);
    writeRules(mock.dir, createPathRules(mock.dir, { items }));
    result = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    lines = readRecording(mock.recording);
  });

  test('run exits 0 and reports 2 updated, 0 created', () => {
    expect(result.code).toBe(0);
    expect(result.stderr).toMatch(/0 created, 2 updated/);
  });

  test('stale draft refreshes via updateProjectV2DraftIssue against its DraftIssue content id', () => {
    const line = lines.find((l) => l.includes('updateProjectV2DraftIssue'));
    expect(line).toBeDefined();
    expect(line).toContain('draftIssueId=DI_9101');
  });

  test('refreshed SHY-9101 draft body is the new full spec + footer (via stdin)', () => {
    const bodies = readCaptures(mock.dir, 'graphql');
    expect(bodies).toHaveLength(2); // two draft updates
    const body = bodies.find((b) => b.includes('# SHY-9101:'));
    expect(body).toBeDefined();
    expect(body.startsWith(expectedSpecBody(s9101.content))).toBe(true);
    expect(body).toContain('_Status: Done_');
  });

  test('the bug-type draft (SHY-9102) refreshes via updateProjectV2DraftIssue — never an issue edit', () => {
    expect(
      lines.find(
        (l) => l.includes('updateProjectV2DraftIssue') && l.includes('draftIssueId=DI_9102'),
      ),
    ).toBeDefined();
    expect(lines.filter((l) => l.startsWith('issue edit'))).toEqual([]);
    const bodies = readCaptures(mock.dir, 'graphql');
    expect(bodies.some((b) => b.includes('# SHY-9102:') && b.includes('_Status: In Review_'))).toBe(
      true,
    );
  });

  test('no item re-add on update: the existing board item is reused from the map', () => {
    expect(lines.filter((l) => l.includes('addProjectV2ItemById'))).toEqual([]);
    expect(lines.filter((l) => l.includes('addProjectV2DraftIssue'))).toEqual([]);
    expect(lines.filter((l) => l.startsWith('issue list'))).toEqual([]);
  });

  test.each([
    ['Status', 'field-status', 'optionId=opt-st-done'],
    ['Pri', 'field-pri', 'optionId=opt-pri-p0'],
    ['Effort', 'field-effort', 'optionId=opt-eff-xl'],
    ['Type', 'field-type', 'optionId=opt-type-chore'],
    ['SHY ID', 'field-shyid', 'text=SHY-9101'],
    ['Roadmap IDs', 'field-roadmap', 'text=G011'],
  ])('update path re-asserts %s on the draft item', (_name, fieldId, valueExpr) => {
    expect(fieldLine(lines, 'ITEM_D9101', fieldId, valueExpr)).toBeDefined();
  });

  test('the second draft item maps independently (In Review → opt-st-inrev on ITEM_D9102)', () => {
    expect(fieldLine(lines, 'ITEM_D9102', 'field-status', 'optionId=opt-st-inrev')).toBeDefined();
  });
});

// ============================================================== status transitions

describe('SHY-0081 v3: status transitions on draft cards — body marker + board column move, no comments (mock-gh)', () => {
  test('pure status flip (hash current, stored marker differs) refreshes the draft body + moves the board column', () => {
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories74tr-');
    const { content } = makeStory(storiesDir, { id: 'SHY-9103', status: 'In Review', type: 'bug' });
    // Stored marker says In Progress; hash is CURRENT — a pure status flip
    // (status lives in frontmatter, outside the body hash) must still be
    // detected via the footer marker and refresh the draft. A bug-type story
    // is a DRAFT in v3, so there is no issue timeline / comment.
    const body = existingBody(content, 'SHY-9103-fixture-story', 'In Progress');
    const items = itemsResponse([draftNode('SHY-9103', 'ITEM_D9103', 'DI_9103', body)]);
    writeRules(mock.dir, createPathRules(mock.dir, { items }));
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(0);
    const lines = readRecording(mock.recording);
    // No issue writes at all — drafts have no timeline.
    expect(lines.filter((l) => l.startsWith('issue comment'))).toEqual([]);
    expect(lines.filter((l) => l.startsWith('issue edit'))).toEqual([]);
    // Draft body refreshed with the NEW marker.
    expect(
      lines.find(
        (l) => l.includes('updateProjectV2DraftIssue') && l.includes('draftIssueId=DI_9103'),
      ),
    ).toBeDefined();
    expect(readCaptures(mock.dir, 'graphql')[0]).toContain('_Status: In Review_');
    // Board column moves too.
    expect(fieldLine(lines, 'ITEM_D9103', 'field-status', 'optionId=opt-st-inrev')).toBeDefined();
    expect(r.stderr).toMatch(/1 updated/);
    expect(r.stderr).not.toMatch(/comments posted/);
  });

  test('draft transition refreshes the body marker but posts NO comment (drafts have no timeline)', () => {
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories74tr2-');
    const { content } = makeStory(storiesDir, {
      id: 'SHY-9104',
      status: 'In Progress',
      type: 'feature',
    });
    const body = existingBody(content, 'SHY-9104-fixture-story', 'Draft');
    const items = itemsResponse([draftNode('SHY-9104', 'ITEM_D9104', 'DI_9104', body)]);
    writeRules(mock.dir, createPathRules(mock.dir, { items }));
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(0);
    const lines = readRecording(mock.recording);
    expect(lines.filter((l) => l.startsWith('issue comment'))).toEqual([]);
    expect(
      lines.find(
        (l) => l.includes('updateProjectV2DraftIssue') && l.includes('draftIssueId=DI_9104'),
      ),
    ).toBeDefined();
    expect(readCaptures(mock.dir, 'graphql')[0]).toContain('_Status: In Progress_');
    expect(r.stderr).not.toMatch(/comments posted/);
  });

  test('unchanged stories (hash + status both match) are full no-ops: no edits, no comments, no field writes', () => {
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories74tr3-');
    const a = makeStory(storiesDir, { id: 'SHY-9105', status: 'In Progress', type: 'feature' });
    const b = makeStory(storiesDir, { id: 'SHY-9106', status: 'In Review', type: 'bug' });
    const aBody = existingBody(a.content, 'SHY-9105-fixture-story', 'In Progress');
    const bBody = existingBody(b.content, 'SHY-9106-fixture-story', 'In Review');
    const items = itemsResponse([
      draftNode('SHY-9105', 'ITEM_D9105', 'DI_9105', aBody),
      draftNode('SHY-9106', 'ITEM_D9106', 'DI_9106', bBody),
    ]);
    writeRules(mock.dir, createPathRules(mock.dir, { items }));
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/2 skipped/);
    const lines = readRecording(mock.recording);
    expect(lines.filter((l) => l.includes('updateProjectV2ItemFieldValue'))).toEqual([]);
    expect(lines.filter((l) => l.includes('updateProjectV2DraftIssue'))).toEqual([]);
    expect(lines.filter((l) => l.startsWith('issue edit'))).toEqual([]);
    expect(lines.filter((l) => l.startsWith('issue comment'))).toEqual([]);
  });
});

// ============================================================== rebuild

describe('SHY-0074: --rebuild teardown (v3: recreates drafts) (mock-gh)', () => {
  test('refuses without REBUILD_CONFIRM=yes: exit 2 naming the env var, ZERO gh calls', () => {
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories74rb-');
    makeStory(storiesDir, { id: 'SHY-8001', type: 'feature' });
    writeRules(mock.dir, createPathRules(mock.dir));
    const r = runScript(['--rebuild'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('REBUILD_CONFIRM');
    expect(readRecording(mock.recording)).toEqual([]);
  });

  test('with REBUILD_CONFIRM=yes: deletes every board item + every story-labeled issue, then resyncs fresh', () => {
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories74rb2-');
    makeStory(storiesDir, { id: 'SHY-8003', type: 'feature' });
    const items = itemsResponse([
      draftNode('SHY-8001', 'ITEM_D1', 'DI_1', 'old'),
      issueNode('SHY-8002', 'ITEM_I2', 2),
    ]);
    const rules = createPathRules(mock.dir, { items });
    writeResponse(mock.dir, 'resp-story-issues.txt', '2\x1fI_node_2\n');
    writeRules(mock.dir, [
      ['deleteProjectV2Item', '', ''],
      ['deleteIssue', '', ''],
      ['^issue list --state all --label story', 'resp-story-issues.txt', ''],
      ...rules,
    ]);
    const r = runScript(
      ['--rebuild'],
      baseEnv(mock.ghPath, storiesDir, { REBUILD_CONFIRM: 'yes' }),
    );
    expect(r.code).toBe(0);
    const lines = readRecording(mock.recording);
    expect(
      lines.find((l) => l.includes('deleteProjectV2Item') && l.includes('itemId=ITEM_D1')),
    ).toBeDefined();
    expect(
      lines.find((l) => l.includes('deleteProjectV2Item') && l.includes('itemId=ITEM_I2')),
    ).toBeDefined();
    expect(
      lines.find((l) => l.includes('deleteIssue') && l.includes('issueId=I_node_2')),
    ).toBeDefined();
    // Fresh sync sees an EMPTY board (teardown reset the map): creates, not updates.
    expect(
      lines.find((l) => l.includes('addProjectV2DraftIssue') && l.includes('title=SHY-8003:')),
    ).toBeDefined();
    expect(lines.filter((l) => l.includes('updateProjectV2DraftIssue'))).toEqual([]);
    expect(r.stderr).toMatch(/project items deleted: 2/);
    expect(r.stderr).toMatch(/issues deleted: 1/);
  });

  test('deleteIssue permission gap → loud actionable warning naming the PAT, teardown continues, exit 40', () => {
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories74rb3-');
    makeStory(storiesDir, { id: 'SHY-8004', type: 'feature' });
    const items = itemsResponse([issueNode('SHY-8002', 'ITEM_I2', 2)]);
    const rules = createPathRules(mock.dir, { items });
    writeResponse(mock.dir, 'resp-story-issues.txt', '2\x1fI_node_2\n5\x1fI_node_5\n');
    writeRules(mock.dir, [
      ['deleteProjectV2Item', '', ''],
      [
        'deleteIssue',
        '',
        '1',
        'GraphQL: Resource not accessible by personal access token (FORBIDDEN)',
      ],
      ['^issue list --state all --label story', 'resp-story-issues.txt', ''],
      ...rules,
    ]);
    const r = runScript(
      ['--rebuild'],
      baseEnv(mock.ghPath, storiesDir, { REBUILD_CONFIRM: 'yes' }),
    );
    expect(r.code).toBe(40);
    expect(r.stderr).toMatch(/::warning::.*deleteIssue.*GH_PAT_PROJECT/);
    const lines = readRecording(mock.recording);
    // BOTH issues were attempted (teardown continued past the first failure)…
    expect(lines.filter((l) => l.includes('deleteIssue'))).toHaveLength(2);
    // …and the fresh sync still ran.
    expect(
      lines.find((l) => l.includes('addProjectV2DraftIssue') && l.includes('title=SHY-8004:')),
    ).toBeDefined();
  });

  test('--rebuild --dry-run previews the teardown without confirm and fires zero deletions', () => {
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories74rb4-');
    makeStory(storiesDir, { id: 'SHY-8005', type: 'feature' });
    writeRules(mock.dir, createPathRules(mock.dir));
    const r = runScript(['--rebuild', '--dry-run'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/DRY-RUN: would tear down/);
    const lines = readRecording(mock.recording);
    expect(lines.filter((l) => l.includes('deleteProjectV2Item'))).toEqual([]);
    expect(lines.filter((l) => l.includes('deleteIssue'))).toEqual([]);
  });
});

// ============================================================== items map

describe('SHY-0074: items-map query (mock-gh)', () => {
  test('map query failure aborts the run BEFORE any mutations (exit 40)', () => {
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories74im-');
    makeStory(storiesDir, { id: 'SHY-8101', type: 'feature' });
    const rules = createPathRules(mock.dir);
    writeRules(mock.dir, [['items\\(first: 100', '', '1'], ...rules]);
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(40);
    const lines = readRecording(mock.recording);
    expect(lines.filter((l) => l.includes('addProjectV2DraftIssue'))).toEqual([]);
    expect(lines.filter((l) => l.startsWith('issue create'))).toEqual([]);
    expect(lines.filter((l) => l.includes('updateProjectV2ItemFieldValue'))).toEqual([]);
  });

  test('multi-page pagination: items on page 2 are recognized (no duplicate creates)', () => {
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories74im2-');
    const a = makeStory(storiesDir, { id: 'SHY-8102', status: 'Draft', type: 'feature' });
    const b = makeStory(storiesDir, { id: 'SHY-8103', status: 'Draft', type: 'feature' });
    const page1 = itemsResponse(
      [
        draftNode(
          'SHY-8102',
          'ITEM_DA',
          'DI_A',
          existingBody(a.content, 'SHY-8102-fixture-story', 'Draft'),
        ),
      ],
      { hasNextPage: true, endCursor: 'CURSOR_1' },
    );
    const page2 = itemsResponse([
      draftNode(
        'SHY-8103',
        'ITEM_DB',
        'DI_B',
        existingBody(b.content, 'SHY-8103-fixture-story', 'Draft'),
      ),
    ]);
    const rules = createPathRules(mock.dir);
    writeResponse(mock.dir, 'resp-items-p1.json', page1);
    writeResponse(mock.dir, 'resp-items-p2.json', page2);
    writeRules(mock.dir, [
      ['cursor=CURSOR_1', 'resp-items-p2.json', ''],
      ['items\\(first: 100', 'resp-items-p1.json', ''],
      ...rules,
    ]);
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/2 skipped/);
    const lines = readRecording(mock.recording);
    expect(lines.filter((l) => l.includes('addProjectV2DraftIssue'))).toEqual([]);
    expect(lines.filter((l) => l.includes('items(first: 100'))).toHaveLength(2);
  });
});

// ============================================================== change detection

describe('SHY-0074: body-hash anchoring + idempotent skip (mock-gh)', () => {
  test('DRAFT: spec containing literal "body-hash:" text does not break change detection', () => {
    // Run 1: create the draft; capture the body the script generated.
    const mock1 = makePatternMockGh();
    const storiesDir = tempDir('stories74h-');
    makeStory(storiesDir, {
      id: 'SHY-8201',
      type: 'feature',
      notesExtra: '\nThis spec discusses the footer format `body-hash: deadbeef` inline.\n',
    });
    writeRules(mock1.dir, createPathRules(mock1.dir));
    const r1 = runScript(['--all'], baseEnv(mock1.ghPath, storiesDir));
    expect(r1.code).toBe(0);
    const generatedBody = readCaptures(mock1.dir, 'graphql')[0];
    expect(generatedBody).toContain('body-hash: deadbeef');

    // Run 2: the draft now "exists" with exactly that body. Unchanged file
    // ⇒ the script must extract the FOOTER hash (not the deadbeef in the
    // spec text) and skip.
    const mock2 = makePatternMockGh();
    const items = itemsResponse([draftNode('SHY-8201', 'ITEM_D8201', 'DI_8201', generatedBody)]);
    writeRules(mock2.dir, createPathRules(mock2.dir, { items }));
    const r2 = runScript(['--all'], baseEnv(mock2.ghPath, storiesDir));
    expect(r2.code).toBe(0);
    expect(r2.stderr).toContain('1 skipped');
    expect(readCaptures(mock2.dir, 'graphql')).toHaveLength(0);
  });
});

// ============================================================== truncation

describe('SHY-0074: oversize body truncation (mock-gh)', () => {
  test('DRAFT body over the 64K cap is line-truncated with notice + intact footer (exact arithmetic)', () => {
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories74t-');
    const bigLine = 'X'.repeat(100);
    const filler = Array.from({ length: 700 }, (_, i) => `Filler line ${i} ${bigLine}`).join('\n');
    const { content } = makeStory(storiesDir, {
      id: 'SHY-8301',
      type: 'feature',
      notesExtra: `\n${filler}\n`,
    });
    expect(content.length).toBeGreaterThan(GITHUB_BODY_LIMIT);
    writeRules(mock.dir, createPathRules(mock.dir));
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(0);

    const body = readCaptures(mock.dir, 'graphql')[0];
    expect(body.length).toBeLessThanOrEqual(GITHUB_BODY_LIMIT);
    const notice = body.match(
      /_\[spec truncated — (\d+) chars omitted; read the full file at the Source link\]_/,
    );
    expect(notice).not.toBeNull();
    // Truncation is at a whole-line boundary: the notice sits on its own
    // line after a complete (non-split) filler line.
    const beforeNotice = body.slice(0, notice.index);
    expect(beforeNotice.endsWith('\n\n…')).toBe(true);
    // Footer survives intact and parseable at the very end.
    expect(body).toMatch(
      /_Source: https:\/\/github\.com\/Shyden-Ltd\/ShyTalk\/blob\/main\/\.project\/stories\/SHY-8301-fixture-story\.md_\n_Status: Draft_\n_Last synced: .* body-hash: [0-9a-f]{64}_\n$/,
    );
    // Omitted count is arithmetically consistent with what was kept.
    const spec = expectedSpecBody(content);
    const keptSpec = beforeNotice.replace(/\n\n…$/, '');
    expect(Number(notice[1])).toBe(spec.length - keptSpec.length);
    expect(r.stderr).toMatch(/bodies truncated: 1/);
  });
});

// ============================================================== label migration

describe('SHY-0074: duplicated label-family migration (mock-gh)', () => {
  function migrationSetup(labelListContent) {
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories74m-');
    makeStory(storiesDir, { id: 'SHY-8401', type: 'bug' });
    const rules = createPathRules(mock.dir);
    writeResponse(mock.dir, 'resp-labels.txt', labelListContent);
    writeRules(mock.dir, rules);
    return { mock, storiesDir };
  }

  test('deletes every label in the five duplicated families, leaves story + foreign labels', () => {
    const { mock, storiesDir } = migrationSetup(
      'story\ndependencies\nstatus:done\nstatus:draft\npriority:p1\neffort:m\ntype:bug\nroadmap:g001\n',
    );
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(0);
    const lines = readRecording(mock.recording);
    const deletes = lines.filter((l) => l.startsWith('label delete'));
    const deleted = deletes.map((l) => l.replace(/^label delete /, '').replace(/ --yes$/, ''));
    expect(deleted.sort()).toEqual(
      ['status:done', 'status:draft', 'priority:p1', 'effort:m', 'type:bug', 'roadmap:g001'].sort(),
    );
    expect(deleted).not.toContain('story');
    expect(deleted).not.toContain('dependencies');
    expect(r.stderr).toMatch(/labels deleted: 6/);
  });

  test('idempotent: families already absent ⇒ zero deletions', () => {
    const { mock, storiesDir } = migrationSetup('story\ndependencies\n');
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(0);
    const deletes = readRecording(mock.recording).filter((l) => l.startsWith('label delete'));
    expect(deletes).toEqual([]);
    expect(r.stderr).toMatch(/labels deleted: 0/);
  });

  test('SHY-0081 v3: no `label create` fires at all (the story label is no longer applied)', () => {
    // v3 retired the issue path, so ensure_labels_for_story / build_labels are
    // gone — the run never creates the `story` label (or any other).
    const { mock, storiesDir } = migrationSetup('dependencies\n');
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(0);
    expect(readRecording(mock.recording).filter((l) => l.startsWith('label create'))).toEqual([]);
    expect(r.stderr).not.toMatch(/labels created/);
  });

  test('label delete failure → warning + N_FAILED + exit 40, sync continues', () => {
    const { mock, storiesDir } = migrationSetup('story\nstatus:done\n');
    const rules = createPathRules(mock.dir);
    writeResponse(mock.dir, 'resp-labels.txt', 'story\nstatus:done\n');
    writeRules(mock.dir, [['^label delete', '', '1'], ...rules]);
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(40);
    expect(r.stderr).toMatch(/label delete/);
    // The story itself still synced (as a draft) despite the migration failure.
    const drafts = readRecording(mock.recording).filter((l) =>
      l.includes('addProjectV2DraftIssue'),
    );
    expect(drafts).toHaveLength(1);
  });
});

// ============================================================== failure injection

describe('SHY-0074: per-component failure bubbles independently (mock-gh)', () => {
  function failingFieldRun(fieldId) {
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories74f-');
    makeStory(storiesDir, { id: 'SHY-8501', type: 'bug' });
    const rules = createPathRules(mock.dir);
    writeRules(mock.dir, [[`fieldId=${fieldId}`, '', '1'], ...rules]);
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    return { r, lines: readRecording(mock.recording) };
  }

  test.each([
    ['Pri', 'field-pri'],
    ['Effort', 'field-effort'],
    ['Type', 'field-type'],
    ['SHY ID', 'field-shyid'],
    ['Roadmap IDs', 'field-roadmap'],
    ['Status', 'field-status'],
  ])('%s mutation 5xx → [gh-error] + exit 40', (_name, fieldId) => {
    const { r } = failingFieldRun(fieldId);
    expect(r.code).toBe(40);
    expect(r.stderr).toMatch(/\[gh-error\] updateProjectV2ItemFieldValue/);
    expect(r.stderr).toContain('1 failed');
  });

  test('a failing Pri does not mask the draft create from having happened', () => {
    const { r, lines } = failingFieldRun('field-pri');
    expect(lines.filter((l) => l.includes('addProjectV2DraftIssue'))).toHaveLength(1);
    expect(r.code).toBe(40);
  });

  test('draft create failure on one story → exit 40; subsequent stories still sync', () => {
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories74f2-');
    makeStory(storiesDir, { id: 'SHY-8502', type: 'feature' });
    makeStory(storiesDir, { id: 'SHY-8503', type: 'bug' });
    const rules = createPathRules(mock.dir);
    // Fail ONLY SHY-8502's draft create; SHY-8503's must still be attempted.
    writeRules(mock.dir, [['addProjectV2DraftIssue.*title=SHY-8502:', '', '1'], ...rules]);
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(40);
    expect(r.stderr).toMatch(/failed to create draft/);
    const lines = readRecording(mock.recording);
    expect(
      lines.find((l) => l.includes('addProjectV2DraftIssue') && l.includes('title=SHY-8503:')),
    ).toBeDefined();
  });

  test('draft update failure → exit 40', () => {
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories74f3-');
    makeStory(storiesDir, { id: 'SHY-8504', type: 'feature' });
    const staleBody = `Old.\n\n${syncedFooter('SHY-8504-fixture-story', 'Draft', STALE_HASH)}`;
    const items = itemsResponse([draftNode('SHY-8504', 'ITEM_D8504', 'DI_8504', staleBody)]);
    const rules = createPathRules(mock.dir, { items });
    writeRules(mock.dir, [['updateProjectV2DraftIssue', '', '1'], ...rules]);
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(40);
    expect(r.stderr).toMatch(/failed to update draft/);
  });

  test('field-population failure on an EXISTING draft (update path) → exit 40', () => {
    // A draft already on the board, body changed → update path runs
    // populate_project_fields; a field mutation 5xx must surface + exit 40.
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories74f4-');
    makeStory(storiesDir, { id: 'SHY-8505', status: 'In Review', type: 'bug' });
    const staleBody = `Old.\n\n${syncedFooter('SHY-8505-fixture-story', 'In Review', STALE_HASH)}`;
    const items = itemsResponse([draftNode('SHY-8505', 'ITEM_D8505', 'DI_8505', staleBody)]);
    const rules = createPathRules(mock.dir, { items });
    writeRules(mock.dir, [['fieldId=field-status', '', '1'], ...rules]);
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(40);
    expect(r.stderr).toMatch(/\[gh-error\] updateProjectV2ItemFieldValue/);
    // No Issues-tab writes were attempted at any point.
    const lines = readRecording(mock.recording);
    expect(lines.filter((l) => l.startsWith('issue '))).toEqual([]);
  });
});

// ============================================================== config gaps

describe('SHY-0074: board config gaps degrade with warnings, not failures (mock-gh)', () => {
  test('Status field missing from the board → warning naming Status, exit 0, other fields still set', () => {
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories74g-');
    makeStory(storiesDir, { id: 'SHY-8601', type: 'bug' });
    writeRules(
      mock.dir,
      createPathRules(mock.dir, { fields: fieldsResponse({ omitStatus: true }) }),
    );
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/::warning::.*Status field/);
    const lines = readRecording(mock.recording);
    expect(lines.find((l) => l.includes('fieldId=field-pri'))).toBeDefined();
    expect(lines.find((l) => l.includes('fieldId=field-status'))).toBeUndefined();
  });

  test('Status option missing (renamed/deleted) → warning names option + story id, exit 0', () => {
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories74g2-');
    makeStory(storiesDir, { id: 'SHY-8602', status: 'In Review', type: 'bug' });
    const partialOptions = { ...STATUS_OPTIONS };
    delete partialOptions['In Review'];
    writeRules(
      mock.dir,
      createPathRules(mock.dir, { fields: fieldsResponse({ statusOptions: partialOptions }) }),
    );
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/::warning::.*In Review.*SHY-8602|::warning::.*SHY-8602.*In Review/);
    const lines = readRecording(mock.recording);
    expect(lines.find((l) => l.includes('fieldId=field-status'))).toBeUndefined();
  });

  test('story with an unknown status value is rejected by the validator gate (no mutations)', () => {
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories74g3-');
    const { filePath } = makeStory(storiesDir, { id: 'SHY-8603', type: 'bug' });
    fs.writeFileSync(
      filePath,
      fs.readFileSync(filePath, 'utf-8').replace('status: Draft', 'status: Bogus'),
    );
    writeRules(mock.dir, createPathRules(mock.dir));
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(40);
    expect(r.stderr).toContain('1 failed');
    const lines = readRecording(mock.recording);
    expect(lines.filter((l) => l.includes('updateProjectV2ItemFieldValue'))).toEqual([]);
  });
});

// ============================================================== dry-run

describe('SHY-0081 v3: dry-run fires nothing but previews everything (mock-gh)', () => {
  test('zero mutations; previews a DRAFT create for every type (incl. bug) + label-family deletion', () => {
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories74d-');
    makeStory(storiesDir, { id: 'SHY-8701', type: 'feature' });
    makeStory(storiesDir, { id: 'SHY-8702', type: 'bug' });
    const rules = createPathRules(mock.dir);
    writeResponse(mock.dir, 'resp-labels.txt', 'story\nstatus:done\npriority:p1\n');
    writeRules(mock.dir, rules);
    const r = runScript(['--all', '--dry-run'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(0);
    const lines = readRecording(mock.recording);
    expect(lines.filter((l) => l.includes('updateProjectV2ItemFieldValue'))).toEqual([]);
    expect(lines.filter((l) => l.includes('addProjectV2ItemById'))).toEqual([]);
    expect(lines.filter((l) => l.includes('addProjectV2DraftIssue'))).toEqual([]);
    expect(lines.filter((l) => l.startsWith('issue create'))).toEqual([]);
    expect(lines.filter((l) => l.startsWith('issue comment'))).toEqual([]);
    expect(lines.filter((l) => l.startsWith('issue close'))).toEqual([]);
    expect(lines.filter((l) => l.startsWith('label delete'))).toEqual([]);
    // Both stories (feature AND bug) preview a DRAFT create — no issue preview.
    expect(r.stderr).toMatch(/DRY-RUN: .*SHY-8701.*would CREATE DRAFT item/);
    expect(r.stderr).toMatch(/DRY-RUN: .*SHY-8702.*would CREATE DRAFT item/);
    expect(r.stderr).not.toMatch(/would CREATE issue/);
    expect(r.stderr).toMatch(/DRY-RUN: would DELETE label "status:done"/);
    expect(r.stderr).toMatch(/DRY-RUN: would DELETE label "priority:p1"/);
  });
});

// ============================================================== validator contract (Layer 3)

describe('SHY-0074: frontmatter validator pins the five-value status contract', () => {
  test.each(['Draft', 'In Progress', 'In Review', 'Done', 'Cancelled'])(
    'status "%s" is accepted',
    (status) => {
      const storiesDir = tempDir('stories74v-');
      const { filePath } = makeStory(storiesDir, { id: 'SHY-8801', status });
      const res = spawnSync('bash', [VALIDATOR, filePath], { encoding: 'utf-8' });
      expect(res.status).toBe(0);
    },
  );

  test('status outside the five lifecycle values is rejected', () => {
    const storiesDir = tempDir('stories74v2-');
    const { filePath } = makeStory(storiesDir, { id: 'SHY-8802' });
    fs.writeFileSync(
      filePath,
      fs.readFileSync(filePath, 'utf-8').replace('status: Draft', 'status: Backlog'),
    );
    const res = spawnSync('bash', [VALIDATOR, filePath], { encoding: 'utf-8' });
    expect(res.status).not.toBe(0);
  });
});

// ============================================================== SHY-0079 sidecar

describe('SHY-0079: board-items.json sidecar overlay heals stale Projects v2 reads (mock-gh)', () => {
  /** Write a sidecar fixture at the isolated BOARD_ITEMS_FILE path the
   *  baseEnv points at (mock dir / board-items.json). */
  function writeSidecar(mock, obj) {
    fs.writeFileSync(path.join(mock.dir, 'board-items.json'), JSON.stringify(obj, null, 2));
  }
  function readSidecar(mock) {
    const p = path.join(mock.dir, 'board-items.json');
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : null;
  }

  test('HEADLINE: stale-empty API + sidecar lists the draft → ZERO addProjectV2DraftIssue (the 2026-06-10 dup, fixed)', () => {
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories79a-');
    makeStory(storiesDir, { id: 'SHY-8801', type: 'feature' }); // non-bug → draft
    writeRules(mock.dir, createPathRules(mock.dir)); // items API empty (stale)
    writeSidecar(mock, {
      'SHY-8801': { backing: 'DRAFT', itemId: 'EXIST_ITEM', contentId: 'EXIST_DI', issueNumber: 0 },
    });
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(0);
    const lines = readRecording(mock.recording);
    // The exact failure mode — re-creating an existing draft — is prevented.
    expect(lines.filter((l) => l.includes('addProjectV2DraftIssue'))).toEqual([]);
    // It refreshed the existing draft via the sidecar's content id instead.
    expect(
      lines.find(
        (l) => l.includes('updateProjectV2DraftIssue') && l.includes('draftIssueId=EXIST_DI'),
      ),
    ).toBeDefined();
    expect(r.stderr).toMatch(/sidecar overlay fills: 1/);
    expect(r.stderr).toMatch(/0 created, 1 updated/);
  });

  test('overlay: API-present entry WINS over the sidecar (freshest live state)', () => {
    // Sidecar says SHY-8802 is a DRAFT at OLD_ITEM; the API returns it as a
    // DRAFT at a DIFFERENT item id with the current body. The merged map must
    // use the API item id (fresh), not the stale sidecar one.
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories79b-');
    const s = makeStory(storiesDir, { id: 'SHY-8802', status: 'Draft', type: 'feature' });
    const body = existingBody(s.content, 'SHY-8802-fixture-story', 'Draft');
    const items = itemsResponse([draftNode('SHY-8802', 'API_ITEM', 'API_DI', body)]);
    writeRules(mock.dir, createPathRules(mock.dir, { items }));
    writeSidecar(mock, {
      'SHY-8802': { backing: 'DRAFT', itemId: 'OLD_ITEM', contentId: 'OLD_DI', issueNumber: 0 },
    });
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/sidecar overlay fills: 0/); // API had it → no fill
    expect(r.stderr).toMatch(/1 skipped/); // hash+status match → no mutation
    const lines = readRecording(mock.recording);
    // No create; if any field write happened it would target API_ITEM, never OLD_ITEM.
    expect(lines.find((l) => l.includes('itemId=OLD_ITEM'))).toBeUndefined();
  });

  test('write-back: a new draft is recorded into board-items.json with item + content ids', () => {
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories79c-');
    makeStory(storiesDir, { id: 'SHY-8803', type: 'feature' });
    // createPathRules rewrites resp-draft-add.json, so build the rules FIRST,
    // then override the draft-create response with distinct asserted ids.
    const rules = createPathRules(mock.dir); // no sidecar → bootstrap
    writeResponse(
      mock.dir,
      'resp-draft-add.json',
      JSON.stringify({
        data: {
          addProjectV2DraftIssue: { projectItem: { id: 'PI_8803', content: { id: 'DI_8803' } } },
        },
      }),
    );
    writeRules(mock.dir, rules);
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(0);
    const sidecar = readSidecar(mock);
    expect(sidecar).not.toBeNull();
    expect(sidecar['SHY-8803']).toEqual({
      backing: 'DRAFT',
      itemId: 'PI_8803',
      contentId: 'DI_8803',
      issueNumber: 0,
    });
  });

  test('write-back: a legacy ISSUE-backed entry is converted + the sidecar reflects DRAFT (not the stale ISSUE)', () => {
    // SHY-8804 is a v2 leftover backed by an ISSUE. The incremental migration
    // deletes the item + issue and recreates a draft → the sidecar entry must
    // reflect DRAFT at the new item id, not the stale ISSUE.
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories79d-');
    makeStory(storiesDir, { id: 'SHY-8804', status: 'In Progress', type: 'bug' });
    const items = itemsResponse([issueNode('SHY-8804', 'ISSUE_ITEM', 884)]);
    const rules = createPathRules(mock.dir, { items });
    writeResponse(mock.dir, 'resp-draft-add.json', draftAddResponse('NEW_DRAFT', 'NEW_DI'));
    writeRules(mock.dir, [['deleteProjectV2Item', '', ''], ['deleteIssue', '', ''], ...rules]);
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(0);
    const sidecar = readSidecar(mock);
    expect(sidecar['SHY-8804'].backing).toBe('DRAFT'); // not the stale ISSUE
    expect(sidecar['SHY-8804'].itemId).toBe('NEW_DRAFT');
  });

  test('malformed sidecar → ::warning:: + API-only fallback, run completes, valid sidecar rewritten', () => {
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories79e-');
    makeStory(storiesDir, { id: 'SHY-8805', type: 'feature' });
    writeRules(mock.dir, createPathRules(mock.dir));
    fs.writeFileSync(path.join(mock.dir, 'board-items.json'), '{ this is not valid json ');
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/::warning::.*board-items\.json is malformed/);
    // Fell back to API-only (empty) → created the draft (no crash).
    const lines = readRecording(mock.recording);
    expect(
      lines.find((l) => l.includes('addProjectV2DraftIssue') && l.includes('title=SHY-8805:')),
    ).toBeDefined();
    // And rewrote a valid sidecar.
    const sidecar = readSidecar(mock);
    expect(sidecar['SHY-8805']).toBeDefined();
  });

  test('--dry-run: overlay still suppresses the create preview, ZERO mutations + ZERO write-back', () => {
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories79f-');
    makeStory(storiesDir, { id: 'SHY-8806', type: 'feature' });
    writeRules(mock.dir, createPathRules(mock.dir));
    writeSidecar(mock, {
      'SHY-8806': { backing: 'DRAFT', itemId: 'I8806', contentId: 'D8806', issueNumber: 0 },
    });
    const before = fs.readFileSync(path.join(mock.dir, 'board-items.json'), 'utf-8');
    const r = runScript(['--all', '--dry-run'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(0);
    const lines = readRecording(mock.recording);
    expect(lines.filter((l) => l.includes('addProjectV2DraftIssue'))).toEqual([]);
    expect(lines.filter((l) => l.includes('updateProjectV2DraftIssue'))).toEqual([]);
    // dry-run does not rewrite the sidecar.
    expect(fs.readFileSync(path.join(mock.dir, 'board-items.json'), 'utf-8')).toBe(before);
  });

  test('AC edge-3: a sidecar entry whose .md no longer exists is PURGED on --all write-back', () => {
    // SHY-8808 has a story file + an existing draft; SHY-8888 is in the
    // sidecar but has NO .md (deleted/renamed). After --all, the rewritten
    // sidecar keeps SHY-8808 and drops the orphaned SHY-8888.
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories79h-');
    const s = makeStory(storiesDir, { id: 'SHY-8808', status: 'Draft', type: 'feature' });
    const items = itemsResponse([
      draftNode(
        'SHY-8808',
        'IT_8808',
        'DI_8808',
        existingBody(s.content, 'SHY-8808-fixture-story', 'Draft'),
      ),
    ]);
    writeRules(mock.dir, createPathRules(mock.dir, { items }));
    writeSidecar(mock, {
      'SHY-8808': { backing: 'DRAFT', itemId: 'IT_8808', contentId: 'DI_8808', issueNumber: 0 },
      'SHY-8888': { backing: 'DRAFT', itemId: 'ORPHAN_IT', contentId: 'ORPHAN_DI', issueNumber: 0 },
    });
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(0);
    const sidecar = readSidecar(mock);
    expect(sidecar['SHY-8808']).toBeDefined(); // still has a .md → kept
    expect(sidecar['SHY-8888']).toBeUndefined(); // no .md → purged
  });

  test('bootstrap: absent sidecar behaves as SHY-0078 (creates) AND populates the sidecar', () => {
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories79g-');
    makeStory(storiesDir, { id: 'SHY-8807', type: 'feature' });
    writeRules(mock.dir, createPathRules(mock.dir)); // no sidecar file
    expect(readSidecar(mock)).toBeNull();
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(0);
    const lines = readRecording(mock.recording);
    expect(
      lines.find((l) => l.includes('addProjectV2DraftIssue') && l.includes('title=SHY-8807:')),
    ).toBeDefined();
    expect(readSidecar(mock)['SHY-8807']).toBeDefined();
    expect(r.stderr).toMatch(/sidecar overlay fills: 0/);
  });

  test('structural: overlay + write-back + sidecar path are env-overridable', () => {
    const src = fs.readFileSync(SCRIPT, 'utf-8');
    expect(src).toMatch(/overlay_board_items_sidecar/);
    expect(src).toMatch(/write_board_items_sidecar/);
    expect(src).toMatch(/BOARD_ITEMS_FILE:-/);
    expect(src).toMatch(/board_items_put/);
    expect(src).toMatch(/board_items_del/);
  });
});

// ============================================================== SHY-0080 ARG_MAX

describe('SHY-0080: items-map merges are ARG_MAX-safe (stdin, not --argjson) (mock-gh)', () => {
  test('REGRESSION: a board whose draft bodies exceed ARG_MAX still produces a COMPLETE map (no re-create)', () => {
    // The defect: the map carries full ~64K draft bodies; merging it via
    // `jq --argjson` overflowed the kernel argv limit (~2MB), jq failed, the
    // map silently emptied, and every draft was re-created. We build an items
    // API response of ~40 drafts × ~64K body (~2.6MB > ARG_MAX) including one
    // asserted story; with the stdin fix the map populates → the asserted
    // story is FOUND → ZERO addProjectV2DraftIssue. Pre-fix: overflow → empty
    // map → it would be re-created.
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories80-');
    const asserted = makeStory(storiesDir, { id: 'SHY-9050', status: 'Draft', type: 'feature' });
    const bigBody = `Big draft.\n\n${'X'.repeat(64000)}\n`;
    const nodes = [
      // The asserted story, present on the board with a body big enough to
      // contribute to the overflow.
      draftNode(
        'SHY-9050',
        'IT_9050',
        'DI_9050',
        `${bigBody}${existingBody(asserted.content, 'SHY-9050-fixture-story', 'Draft')}`,
      ),
      // 39 filler drafts to push the combined map past ARG_MAX.
      ...Array.from({ length: 39 }, (_, i) => {
        const id = `SHY-95${String(i + 10).padStart(2, '0')}`;
        return draftNode(id, `IT_${id}`, `DI_${id}`, bigBody);
      }),
    ];
    const items = itemsResponse(nodes);
    expect(items.length).toBeGreaterThan(2_000_000); // > typical ARG_MAX
    writeRules(mock.dir, createPathRules(mock.dir, { items }));
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(0);
    const lines = readRecording(mock.recording);
    // The map populated → SHY-9050 was found → NOT re-created.
    expect(lines.filter((l) => l.includes('addProjectV2DraftIssue'))).toEqual([]);
    // Exactly one items query (single page) was issued and parsed (not retried
    // as empty).
    expect(lines.filter((l) => l.includes('items(first: 100'))).toHaveLength(1);
  });

  test('structural: the map merges pipe via `jq -s` and never pass the map through --argjson', () => {
    const src = fs.readFileSync(SCRIPT, 'utf-8');
    // All THREE map merges use the stdin form: pagination, overlay merge,
    // and the fill-count (the last uses `jq -s` without -c — scalar output).
    expect(src).toMatch(/printf '%s\\n%s\\n' "\$ITEMS_MAP_JSON" "\$page_map" \| jq -c -s/);
    expect(src).toMatch(/printf '%s\\n%s\\n' "\$sidecar" "\$ITEMS_MAP_JSON" \| jq -c -s/);
    // Fill-count: stdin `jq -s` over the two slurped objects (its printf is on
    // a line-continuation, so pin its distinctive jq body, which proves stdin).
    expect(src).toMatch(/jq -s '\(\(\.\[0\] \| keys\) - \(\.\[1\] \| keys\)\)/);
    // No --argjson is fed ANY body-laden operand (map / page_map / sidecar) —
    // the overflow source. Variable-name-agnostic on the value side.
    expect(src).not.toMatch(/--argjson \w+ "\$ITEMS_MAP_JSON"/);
    expect(src).not.toMatch(/--argjson \w+ "\$page_map"/);
    expect(src).not.toMatch(/--argjson \w+ "\$sidecar"/);
  });
});

// ============================================================== workflow YAML (Layer 2)

describe('SHY-0074: workflow YAML pins', () => {
  const syncYaml = fs.readFileSync(
    path.join(REPO_ROOT, '.github/workflows/sync-stories-to-issues.yml'),
    'utf-8',
  );
  const injectYaml = fs.readFileSync(
    path.join(REPO_ROOT, '.github/workflows/inject-pr-closes.yml'),
    'utf-8',
  );

  test('GH_TOKEN routing from GH_PAT_PROJECT is unchanged', () => {
    expect(syncYaml).toContain('GH_TOKEN: ${{ secrets.GH_PAT_PROJECT }}');
    expect(syncYaml).toContain('GH_PAT_PROJECT: ${{ secrets.GH_PAT_PROJECT }}');
  });

  test('workflow_dispatch exposes the rebuild input wired to --rebuild + REBUILD_CONFIRM', () => {
    expect(syncYaml).toMatch(/rebuild:\n\s+description: .*DESTRUCTIVE/);
    expect(syncYaml).toContain('REBUILD_CONFIRM=yes');
    expect(syncYaml).toContain('--rebuild');
  });

  test('budget comment reflects the v2 call profile (items-map query + rebuild budget)', () => {
    expect(syncYaml).toMatch(/items-map query|items query/i);
    expect(syncYaml).toMatch(/rebuild/i);
  });

  test('inject-pr-closes no-ops gracefully when a story has no issue (non-bugs post-v2)', () => {
    // Non-bug stories have NO GitHub issue under v2 — the lookup-empty path
    // must SKIP with exit 0, not fail the PR check.
    expect(injectYaml).toMatch(/SKIP: no open issue found/);
    const skipBlock = injectYaml.slice(injectYaml.indexOf('SKIP: no open issue found'));
    expect(skipBlock).toMatch(/exit 0/);
  });

  // ---- SHY-0079 sidecar write-back wiring
  test('SHY-0079: board-items.json sidecar is committed via createCommitOnBranch with the Release App token', () => {
    expect(syncYaml).toContain('createCommitOnBranch');
    expect(syncYaml).toContain('actions/create-github-app-token');
    expect(syncYaml).toContain('secrets.RELEASE_APP_ID');
    expect(syncYaml).toContain('.project/board-items.json');
  });

  test('SHY-0079: board-items.json is NOT a push trigger path (committing it must not re-fire the sync)', () => {
    // The real triggers are present…
    expect(syncYaml).toContain('- ".project/stories/SHY-*.md"');
    // …and there is NO trigger-path LIST ENTRY for the sidecar (a quoted
    // `- "...board-items.json"` line). A comment mentioning it doesn't count.
    // Line-based (no backtracking regex) per the sonarjs slow-regex rule.
    const sidecarTriggerLine = syncYaml
      .split('\n')
      .some((l) => /^\s*- "/.test(l) && l.includes('board-items.json'));
    expect(sidecarTriggerLine).toBe(false);
  });

  test('SHY-0079: loop guard skips the Release App bot actor (defense-in-depth)', () => {
    expect(syncYaml).toMatch(/if:\s*github\.actor\s*!=\s*'shytalk-release-bot\[bot\]'/);
  });
});

// ============================================================== structural pins

describe('SHY-0074: structural pins on the script source', () => {
  const src = fs.readFileSync(SCRIPT, 'utf-8');

  test('STORIES_DIR is env-overridable (test isolation contract)', () => {
    expect(src).toMatch(/STORIES_DIR="\$\{STORIES_DIR:-/);
  });

  test('the broken relative Spec link is gone from the source', () => {
    expect(src).not.toContain('../blob/main/.project/stories');
    expect(src).not.toContain('**Spec:**');
  });

  test('hash extraction sed anchors on the Last-synced footer line, last match wins', () => {
    // The EXTRACTION (not the footer printf): must anchor at line start on
    // the footer prefix and take the last occurrence, so embedded specs
    // containing literal "body-hash:" text can't poison change detection.
    expect(src).toMatch(/sed -n 's\/\^_Last synced: \.\*body-hash: /);
    expect(src).toMatch(/\| tail -n 1/);
  });

  test('status-marker extraction sed anchors on the footer Status line, last match wins', () => {
    expect(src).toMatch(/sed -n 's\/\^_Status: /);
  });

  test('SHY-0081 v3: the issue-path machinery is fully retired from the source', () => {
    // No story-sync code creates/edits/comments/closes a GitHub issue, and the
    // retired helpers are gone (no dead code).
    for (const gone of [
      'create_issue_path',
      'issue_exists_for',
      'build_bug_body',
      'post_status_comment',
      'close_if_terminal',
      'extract_issue_node_id',
      'update_issue_body',
      'add_to_project_board',
      'ensure_labels_for_story',
      'build_labels',
    ]) {
      expect(src).not.toContain(`${gone}()`);
    }
    // gh issue create/edit/comment is never invoked from the script.
    expect(src).not.toMatch(/"\$GH" issue create/);
    expect(src).not.toMatch(/"\$GH" issue edit/);
    expect(src).not.toMatch(/"\$GH" issue comment/);
  });

  test('SHY-0081 v3: sync_one routes EVERY story to the draft path (no type==bug → issue branch)', () => {
    const fn = src.slice(src.indexOf('sync_one()'), src.indexOf('teardown_for_rebuild()'));
    // The create path calls create_draft_path unconditionally — no desired/ISSUE fork.
    expect(fn).toContain('create_draft_path "$file" "$id" "$title" "$hash"');
    expect(fn).not.toContain('create_issue_path');
    expect(fn).not.toMatch(/desired="ISSUE"/);
  });

  test('--rebuild still deletes story-labeled issues (the legacy migration) via delete_issue_node', () => {
    expect(src).toContain('delete_issue_node');
    expect(src).toMatch(/issue list --state all --label story/);
  });

  test('the SHY-0078 items-map empty-read retry is retained (the Projects v2 lag guard survives v3)', () => {
    expect(src).toMatch(/_items_map_pass/);
    expect(src).toMatch(/ITEMS_MAP_RETRY_BACKOFF/);
  });

  test('dead SYNC_GRACE_WINDOW_SECS config doc is removed (was documented but never implemented)', () => {
    expect(src).not.toContain('SYNC_GRACE_WINDOW_SECS');
  });
});
