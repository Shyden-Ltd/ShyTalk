/* eslint-disable sonarjs/no-os-command-from-path
   -- test harness invokes `bash` and the script-under-test in temporary
   directories with controlled inputs (same pattern as the sibling
   sync-stories-to-issues test files). Not security-sensitive. */
/**
 * SHY-0074: Mirror architecture v2 — bugs-only Issues, draft cards for
 * stories, faithful board columns.
 *
 * Value-level behavior matrix for scripts/sync-stories-to-issues.sh. Every
 * assertion names a concrete expected value landing on a concrete surface
 * (board field option id, draft/issue body text, comment text, close
 * reason, label set) — no "at least one X" shapes, per the strict-testing
 * standard codified 2026-06-10.
 *
 * Spec: .project/stories/SHY-0074-mirror-fidelity-board-body-labels.md
 *
 * Harness: a pattern-matching mock `gh` (first-match rules file,
 * \x1f-delimited: pattern, stdout-response-file, exit-code, stderr-text)
 * that records every argv line AND captures stdin for `issue create`/
 * `issue edit` (--body-file -) and for GraphQL mutations passing a body
 * via `-F body=@-` (draft create/update), plus a STORIES_DIR override so
 * the matrix runs against generated fixture stories, never the live corpus.
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
const BOARD_URL = 'https://github.com/orgs/Shyden-Ltd/projects/1';

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

function draftAddResponse(itemId) {
  return JSON.stringify({ data: { addProjectV2DraftIssue: { projectItem: { id: itemId } } } });
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

// ============================================================== create-path matrix

describe('SHY-0074 v2: create path — draft/bug routing + per-value board-field matrix (mock-gh)', () => {
  // One bug (→ real issue) + six non-bugs (→ board draft items). Types
  // cover all 7 values; statuses cover all 5 lifecycle values.
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
  const DRAFT_IDS = IDS.filter((id) => id !== 'SHY-9002');
  const itemFor = (id) => (id === 'SHY-9002' ? 'ITEM_I100' : `ITEM_D${id.slice(4)}`);

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
    writeResponse(
      mock.dir,
      'resp-add-100.json',
      JSON.stringify({ data: { addProjectV2ItemById: { item: { id: 'ITEM_I100' } } } }),
    );
    perStory.push(['addProjectV2ItemById.*contentId=I_node_100', 'resp-add-100.json', '']);
    writeRules(mock.dir, [...perStory, ...rules]);
    result = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    lines = readRecording(mock.recording);
  });

  test('run exits 0 and reports 7 created split as 6 drafts + 1 issue', () => {
    expect(result.code).toBe(0);
    expect(result.stderr).toMatch(/7 created \(6 drafts, 1 issues\)/);
  });

  // ---- Routing: Issues tab is bugs-only
  test('the bug story creates a real issue; NO draft item', () => {
    const creates = lines.filter((l) => l.startsWith('issue create'));
    expect(creates).toHaveLength(1);
    expect(creates[0]).toContain('--title SHY-9002:');
    expect(
      lines.find((l) => l.includes('addProjectV2DraftIssue') && l.includes('SHY-9002')),
    ).toBeUndefined();
  });

  test.each(DRAFT_IDS)('%s (non-bug) creates a board draft item; NO GitHub issue', (id) => {
    expect(
      lines.find((l) => l.includes('addProjectV2DraftIssue') && l.includes(`title=${id}:`)),
    ).toBeDefined();
    expect(lines.find((l) => l.startsWith('issue create') && l.includes(`${id}:`))).toBeUndefined();
  });

  test('the bug issue is added to the board via addProjectV2ItemById', () => {
    expect(
      lines.find((l) => l.includes('addProjectV2ItemById') && l.includes('contentId=I_node_100')),
    ).toBeDefined();
  });

  test('items-map replaces per-story issue search: zero `issue list` calls', () => {
    expect(lines.filter((l) => l.startsWith('issue list'))).toEqual([]);
  });

  test('exactly one items-map query fired (single-page corpus)', () => {
    expect(lines.filter((l) => l.includes('items(first: 100'))).toHaveLength(1);
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
  test('SHY ID text field carries the exact story id on every item (draft AND issue-backed)', () => {
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
  test('Status mutation fires AFTER the item-creating mutation (last-writer vs built-in automation)', () => {
    for (const id of IDS) {
      const createIdx = lines.findIndex(
        (l) =>
          (l.includes('addProjectV2DraftIssue') && l.includes(`title=${id}:`)) ||
          (id === 'SHY-9002' &&
            l.includes('addProjectV2ItemById') &&
            l.includes('contentId=I_node_100')),
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

  // ---- Labels (single-source)
  test('the bug issue carries exactly one label: story', () => {
    const createLine = lines.find((l) => l.startsWith('issue create'));
    expect(createLine).toMatch(/--label story$/);
  });

  test('no status:/priority:/effort:/type:/roadmap: label is ever created', () => {
    const familyCreates = lines.filter(
      (l) =>
        l.startsWith('label create') &&
        /label create (status:|priority:|effort:|type:|roadmap:)/.test(l),
    );
    expect(familyCreates).toEqual([]);
  });

  // ---- Draft body (full spec verbatim + footer with status marker)
  test('draft body is the story body verbatim followed by the v2 footer (Source + Status + Last synced)', () => {
    const bodies = readCaptures(mock.dir, 'graphql');
    expect(bodies).toHaveLength(6);
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

  // ---- Bug-report body
  test('bug issue body is a bug report: ## Bug = the Why content verbatim', () => {
    const bodies = readCaptures(mock.dir, 'issue-create');
    expect(bodies).toHaveLength(1);
    expect(bodies[0].startsWith('## Bug\n\nFixture.\n\n## Tracking\n')).toBe(true);
  });

  test('bug issue ## Tracking section links the story file, the board, and states the status', () => {
    const body = readCaptures(mock.dir, 'issue-create')[0];
    expect(body).toContain(
      `- Source: [.project/stories/SHY-9002-fixture-story.md](${SOURCE_URL_PREFIX}/SHY-9002-fixture-story.md)`,
    );
    expect(body).toContain(`- Tracked as SHY-9002 on the [ShyTalk Stories board](${BOARD_URL})`);
    expect(body).toContain('- Status: In Progress');
  });

  test('bug issue body footer carries Source + Status marker + Last synced', () => {
    const body = readCaptures(mock.dir, 'issue-create')[0];
    expect(body).toMatch(
      new RegExp(
        '---\\n\\n_Source: https:\\/\\/github\\.com\\/Shyden-Ltd\\/ShyTalk\\/blob\\/main\\/\\.project\\/stories\\/SHY-9002-fixture-story\\.md_\\n' +
          '_Status: In Progress_\\n' +
          '_Last synced: \\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z from commit [0-9a-f]+ body-hash: [0-9a-f]{64}_\\n$',
      ),
    );
  });

  test('bug issue body does NOT embed the full spec (the board card carries the work; the issue is the report)', () => {
    const body = readCaptures(mock.dir, 'issue-create')[0];
    expect(body).not.toContain('## Acceptance Criteria');
    expect(body).not.toContain('## BDD Scenarios');
  });

  // ---- Terminal statuses on create: drafts never close anything
  test('Done/Cancelled DRAFT stories cause no issue close (no issue exists)', () => {
    expect(lines.filter((l) => l.startsWith('issue close'))).toEqual([]);
  });

  // ---- Run summary observability
  test('summary line reports the v2 counters', () => {
    expect(result.stderr).toMatch(/status fields set: 7/);
    expect(result.stderr).toMatch(/bodies embedded: 7/);
    expect(result.stderr).toMatch(/bodies truncated: 0/);
    expect(result.stderr).toMatch(/comments posted: 0/);
    expect(result.stderr).toMatch(/issues closed: 0/);
  });

  test('CORRECTIVE (pre-existing SHY-0067 bug): project-items-added counter survives the command-substitution subshell', () => {
    // add_to_project_board is $()-captured; its counter increment used to
    // die in the subshell, reporting 0 forever. 6 drafts + 1 issue here.
    expect(result.stderr).toMatch(/project items added: 7/);
  });

  // ---- STORIES_DIR isolation
  test('STORIES_DIR override isolates the run from the live corpus', () => {
    const realIds = lines.filter((l) => /SHY-00\d\d:/.test(l));
    expect(realIds).toEqual([]);
  });
});

// ============================================================== update path

describe('SHY-0074 v2: update path — stale bodies refresh in place, fields re-asserted (mock-gh)', () => {
  // SHY-9101: draft-backed (chore). SHY-9102: issue-backed (bug).
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
    const staleIssueBody = `Old issue.\n\n${syncedFooter('SHY-9102-fixture-story', 'In Review', STALE_HASH)}`;
    const items = itemsResponse([
      draftNode('SHY-9101', 'ITEM_D9101', 'DI_9101', staleDraftBody),
      issueNode('SHY-9102', 'ITEM_I9102', 102),
    ]);
    const rules = createPathRules(mock.dir, { items });
    writeResponse(mock.dir, 'resp-body-102.txt', staleIssueBody);
    writeRules(mock.dir, [['^issue view 102 --json body', 'resp-body-102.txt', ''], ...rules]);
    result = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    lines = readRecording(mock.recording);
  });

  test('run exits 0 and reports 2 updated, 0 created', () => {
    expect(result.code).toBe(0);
    expect(result.stderr).toMatch(/0 created \(0 drafts, 0 issues\), 2 updated/);
  });

  test('stale draft refreshes via updateProjectV2DraftIssue against its DraftIssue content id', () => {
    const line = lines.find((l) => l.includes('updateProjectV2DraftIssue'));
    expect(line).toBeDefined();
    expect(line).toContain('draftIssueId=DI_9101');
  });

  test('refreshed draft body is the new full spec + footer (via stdin)', () => {
    const bodies = readCaptures(mock.dir, 'graphql');
    expect(bodies).toHaveLength(1);
    expect(bodies[0].startsWith(expectedSpecBody(s9101.content))).toBe(true);
    expect(bodies[0]).toContain('_Status: Done_');
  });

  test('stale issue refreshes via issue edit with the new bug-report body (via stdin)', () => {
    expect(lines.find((l) => l.startsWith('issue edit 102 --body-file -'))).toBeDefined();
    const bodies = readCaptures(mock.dir, 'issue-edit');
    expect(bodies).toHaveLength(1);
    expect(bodies[0].startsWith('## Bug\n')).toBe(true);
    expect(bodies[0]).toContain('- Status: In Review');
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

  test('issue-backed item maps independently (In Review → opt-st-inrev on ITEM_I9102)', () => {
    expect(fieldLine(lines, 'ITEM_I9102', 'field-status', 'optionId=opt-st-inrev')).toBeDefined();
  });
});

// ============================================================== status transitions

describe('SHY-0074 v2: status transitions — comments on bug issues, silent refresh on drafts (mock-gh)', () => {
  test('bug issue transition posts "Status: old → new" comment BEFORE the body refresh', () => {
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories74tr-');
    const { content } = makeStory(storiesDir, { id: 'SHY-9103', status: 'In Review', type: 'bug' });
    // Stored marker says In Progress; hash is CURRENT — a pure status flip
    // (status lives in frontmatter, outside the body hash) must still be
    // detected via the footer marker.
    const body = existingBody(content, 'SHY-9103-fixture-story', 'In Progress');
    const items = itemsResponse([issueNode('SHY-9103', 'ITEM_I9103', 103)]);
    const rules = createPathRules(mock.dir, { items });
    writeResponse(mock.dir, 'resp-body-103.txt', body);
    writeRules(mock.dir, [['^issue view 103 --json body', 'resp-body-103.txt', ''], ...rules]);
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(0);
    const lines = readRecording(mock.recording);
    const commentIdx = lines.findIndex(
      (l) => l === 'issue comment 103 --body Status: In Progress → In Review',
    );
    const editIdx = lines.findIndex((l) => l.startsWith('issue edit 103'));
    expect(commentIdx).toBeGreaterThanOrEqual(0);
    expect(editIdx).toBeGreaterThan(commentIdx);
    // Refreshed body carries the NEW marker + Tracking status line.
    const edited = readCaptures(mock.dir, 'issue-edit')[0];
    expect(edited).toContain('_Status: In Review_');
    expect(edited).toContain('- Status: In Review');
    // Board column moves too.
    expect(fieldLine(lines, 'ITEM_I9103', 'field-status', 'optionId=opt-st-inrev')).toBeDefined();
    expect(r.stderr).toMatch(/comments posted: 1/);
    expect(r.stderr).toMatch(/1 updated/);
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
    expect(r.stderr).toMatch(/comments posted: 0/);
  });

  test('unchanged stories (hash + status both match) are full no-ops: no edits, no comments, no field writes', () => {
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories74tr3-');
    const draft = makeStory(storiesDir, { id: 'SHY-9105', status: 'In Progress', type: 'feature' });
    const bug = makeStory(storiesDir, { id: 'SHY-9106', status: 'In Review', type: 'bug' });
    const draftBody = existingBody(draft.content, 'SHY-9105-fixture-story', 'In Progress');
    const issueBody = existingBody(bug.content, 'SHY-9106-fixture-story', 'In Review');
    const items = itemsResponse([
      draftNode('SHY-9105', 'ITEM_D9105', 'DI_9105', draftBody),
      issueNode('SHY-9106', 'ITEM_I9106', 106),
    ]);
    const rules = createPathRules(mock.dir, { items });
    writeResponse(mock.dir, 'resp-body-106.txt', issueBody);
    writeRules(mock.dir, [['^issue view 106 --json body', 'resp-body-106.txt', ''], ...rules]);
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

// ============================================================== close on terminal states

describe('SHY-0074 v2: terminal statuses close bug issues (mock-gh)', () => {
  function terminalSetup({ id, num, status, releasedIn = '', marker, state = 'OPEN' }) {
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories74cl-');
    const { content } = makeStory(storiesDir, { id, status, type: 'bug', releasedIn });
    const slug = `${id}-fixture-story`;
    const body = existingBody(content, slug, marker);
    const items = itemsResponse([issueNode(id, `ITEM_I${num}`, num, state)]);
    const rules = createPathRules(mock.dir, { items });
    writeResponse(mock.dir, `resp-body-${num}.txt`, body);
    writeRules(mock.dir, [
      [`^issue view ${num} --json body`, `resp-body-${num}.txt`, ''],
      ...rules,
    ]);
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    return { r, lines: readRecording(mock.recording) };
  }

  test('Done bug with released_in → transition comment, body refresh, close as completed naming the release', () => {
    const { r, lines } = terminalSetup({
      id: 'SHY-9107',
      num: 107,
      status: 'Done',
      releasedIn: 'v0.98.0',
      marker: 'In Review',
    });
    expect(r.code).toBe(0);
    expect(
      lines.find((l) => l === 'issue comment 107 --body Status: In Review → Done'),
    ).toBeDefined();
    const closeIdx = lines.findIndex(
      (l) => l === 'issue close 107 --reason completed --comment Released in v0.98.0',
    );
    const editIdx = lines.findIndex((l) => l.startsWith('issue edit 107'));
    expect(closeIdx).toBeGreaterThanOrEqual(0);
    expect(closeIdx).toBeGreaterThan(editIdx);
    expect(r.stderr).toMatch(/issues closed: 1/);
  });

  test('Done bug without released_in, otherwise unchanged but still open → closed as completed (no release comment)', () => {
    const { r, lines } = terminalSetup({
      id: 'SHY-9108',
      num: 108,
      status: 'Done',
      marker: 'Done',
    });
    expect(r.code).toBe(0);
    const close = lines.find((l) => l.startsWith('issue close 108'));
    expect(close).toBe('issue close 108 --reason completed');
    expect(r.stderr).toMatch(/issues closed: 1/);
  });

  test('Cancelled bug → closed as not planned', () => {
    const { r, lines } = terminalSetup({
      id: 'SHY-9109',
      num: 109,
      status: 'Cancelled',
      marker: 'In Progress',
    });
    expect(r.code).toBe(0);
    expect(
      lines.find((l) => l === 'issue comment 109 --body Status: In Progress → Cancelled'),
    ).toBeDefined();
    expect(lines.find((l) => l === 'issue close 109 --reason not planned')).toBeDefined();
  });

  test('already-CLOSED Done bug with no changes → no re-close, full skip', () => {
    const { r, lines } = terminalSetup({
      id: 'SHY-9110',
      num: 110,
      status: 'Done',
      marker: 'Done',
      state: 'CLOSED',
    });
    expect(r.code).toBe(0);
    expect(lines.filter((l) => l.startsWith('issue close'))).toEqual([]);
    expect(r.stderr).toMatch(/1 skipped/);
  });

  test('bug born terminal (rebuild path): create + board + fields, then immediate close naming the release', () => {
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories74cl2-');
    makeStory(storiesDir, { id: 'SHY-9111', status: 'Done', type: 'bug', releasedIn: 'v0.97.2' });
    writeRules(mock.dir, createPathRules(mock.dir));
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(0);
    const lines = readRecording(mock.recording);
    expect(lines.find((l) => l.startsWith('issue create --title SHY-9111:'))).toBeDefined();
    const closeIdx = lines.findIndex(
      (l) => l === 'issue close 100 --reason completed --comment Released in v0.97.2',
    );
    const statusIdx = lines.findIndex((l) => l.includes('fieldId=field-status'));
    expect(closeIdx).toBeGreaterThanOrEqual(0);
    expect(closeIdx).toBeGreaterThan(statusIdx);
  });

  test('bug born Cancelled → created then closed as not planned', () => {
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories74cl3-');
    makeStory(storiesDir, { id: 'SHY-9112', status: 'Cancelled', type: 'bug' });
    writeRules(mock.dir, createPathRules(mock.dir));
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(0);
    const lines = readRecording(mock.recording);
    expect(lines.find((l) => l === 'issue close 100 --reason not planned')).toBeDefined();
  });
});

// ============================================================== type flips

describe('SHY-0074 v2: type flip recreates the correct backing (mock-gh)', () => {
  test('draft-backed story re-typed to bug → draft item deleted, bug issue created on the board', () => {
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories74tf-');
    makeStory(storiesDir, { id: 'SHY-9201', status: 'In Progress', type: 'bug' });
    const items = itemsResponse([draftNode('SHY-9201', 'ITEM_D9201', 'DI_9201', 'old draft body')]);
    const rules = createPathRules(mock.dir, { items });
    writeRules(mock.dir, [['deleteProjectV2Item', '', ''], ...rules]);
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(0);
    const lines = readRecording(mock.recording);
    const delIdx = lines.findIndex(
      (l) => l.includes('deleteProjectV2Item') && l.includes('itemId=ITEM_D9201'),
    );
    const createIdx = lines.findIndex((l) => l.startsWith('issue create --title SHY-9201:'));
    expect(delIdx).toBeGreaterThanOrEqual(0);
    expect(createIdx).toBeGreaterThan(delIdx);
    expect(
      lines.find((l) => l.includes('addProjectV2ItemById') && l.includes('contentId=I_node_100')),
    ).toBeDefined();
    expect(r.stderr).toMatch(/type flip/i);
    expect(r.stderr).toMatch(/project items deleted: 1/);
  });

  test('issue-backed story re-typed to non-bug → item deleted, orphan issue closed as not planned, draft created', () => {
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories74tf2-');
    makeStory(storiesDir, { id: 'SHY-9202', status: 'In Progress', type: 'feature' });
    const items = itemsResponse([issueNode('SHY-9202', 'ITEM_I9202', 202)]);
    const rules = createPathRules(mock.dir, { items });
    writeRules(mock.dir, [['deleteProjectV2Item', '', ''], ...rules]);
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(0);
    const lines = readRecording(mock.recording);
    expect(
      lines.find((l) => l.includes('deleteProjectV2Item') && l.includes('itemId=ITEM_I9202')),
    ).toBeDefined();
    expect(lines.find((l) => l === 'issue close 202 --reason not planned')).toBeDefined();
    expect(
      lines.find((l) => l.includes('addProjectV2DraftIssue') && l.includes('title=SHY-9202:')),
    ).toBeDefined();
    expect(r.stderr).toMatch(/type flip/i);
  });
});

// ============================================================== rebuild

describe('SHY-0074 v2: --rebuild teardown (mock-gh)', () => {
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

describe('SHY-0074 v2: items-map query (mock-gh)', () => {
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

describe('SHY-0074 v2: body-hash anchoring + idempotent skip (mock-gh)', () => {
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

  test('BUG ISSUE: Why section containing literal "body-hash:" text does not break change detection', () => {
    const mock1 = makePatternMockGh();
    const storiesDir = tempDir('stories74h2-');
    makeStory(storiesDir, {
      id: 'SHY-8202',
      type: 'bug',
      why: 'Discusses the footer format `body-hash: deadbeef` inline.',
    });
    writeRules(mock1.dir, createPathRules(mock1.dir));
    const r1 = runScript(['--all'], baseEnv(mock1.ghPath, storiesDir));
    expect(r1.code).toBe(0);
    const generatedBody = readCaptures(mock1.dir, 'issue-create')[0];
    expect(generatedBody).toContain('body-hash: deadbeef');

    const mock2 = makePatternMockGh();
    const items = itemsResponse([issueNode('SHY-8202', 'ITEM_I8202', 100)]);
    const rules = createPathRules(mock2.dir, { items });
    writeResponse(mock2.dir, 'resp-existing-body.txt', generatedBody);
    writeRules(mock2.dir, [
      ['^issue view 100 --json body', 'resp-existing-body.txt', ''],
      ...rules,
    ]);
    const r2 = runScript(['--all'], baseEnv(mock2.ghPath, storiesDir));
    expect(r2.code).toBe(0);
    expect(r2.stderr).toContain('1 skipped');
    expect(readCaptures(mock2.dir, 'issue-edit')).toHaveLength(0);
  });
});

// ============================================================== truncation

describe('SHY-0074 v2: oversize body truncation (mock-gh)', () => {
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

  test('BUG body with an oversize Why is capped with notice + intact footer', () => {
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories74t2-');
    const filler = Array.from(
      { length: 700 },
      (_, i) => `Why filler line ${i} ${'Y'.repeat(100)}`,
    ).join('\n');
    makeStory(storiesDir, { id: 'SHY-8302', type: 'bug', why: filler });
    writeRules(mock.dir, createPathRules(mock.dir));
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(0);
    const body = readCaptures(mock.dir, 'issue-create')[0];
    expect(body.length).toBeLessThanOrEqual(GITHUB_BODY_LIMIT);
    expect(body.startsWith('## Bug\n')).toBe(true);
    expect(body).toMatch(
      /_\[spec truncated — \d+ chars omitted; read the full file at the Source link\]_/,
    );
    expect(body).toMatch(/_Last synced: .* body-hash: [0-9a-f]{64}_\n$/);
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

  test('CORRECTIVE (pre-existing SHY-0067 bug): labels-created counter survives the command-substitution subshell', () => {
    // ensure_labels_for_story was $()-captured; N_LABELS_CREATED used to
    // die in the subshell. With `story` absent from the repo, exactly one
    // label create fires (for the bug issue) and must be counted.
    const { mock, storiesDir } = migrationSetup('dependencies\n');
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(0);
    const creates = readRecording(mock.recording).filter((l) => l.startsWith('label create story'));
    expect(creates).toHaveLength(1);
    expect(r.stderr).toMatch(/labels created: 1/);
  });

  test('label delete failure → warning + N_FAILED + exit 40, sync continues', () => {
    const { mock, storiesDir } = migrationSetup('story\nstatus:done\n');
    const rules = createPathRules(mock.dir);
    writeResponse(mock.dir, 'resp-labels.txt', 'story\nstatus:done\n');
    writeRules(mock.dir, [['^label delete', '', '1'], ...rules]);
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(40);
    expect(r.stderr).toMatch(/label delete/);
    // The story itself still synced despite the migration failure.
    const creates = readRecording(mock.recording).filter((l) => l.startsWith('issue create'));
    expect(creates).toHaveLength(1);
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

  test('a failing Pri does not mask the issue create from having happened', () => {
    const { r, lines } = failingFieldRun('field-pri');
    expect(lines.filter((l) => l.startsWith('issue create'))).toHaveLength(1);
    expect(r.code).toBe(40);
  });

  test('draft create failure → exit 40; subsequent stories still sync', () => {
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories74f2-');
    makeStory(storiesDir, { id: 'SHY-8502', type: 'feature' });
    makeStory(storiesDir, { id: 'SHY-8503', type: 'bug' });
    const rules = createPathRules(mock.dir);
    writeRules(mock.dir, [['addProjectV2DraftIssue', '', '1'], ...rules]);
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(40);
    expect(r.stderr).toMatch(/failed to create draft/);
    const lines = readRecording(mock.recording);
    expect(lines.filter((l) => l.startsWith('issue create'))).toHaveLength(1);
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

  test('transition comment failure → exit 40, body refresh still attempted', () => {
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories74f4-');
    const { content } = makeStory(storiesDir, { id: 'SHY-8505', status: 'In Review', type: 'bug' });
    const body = existingBody(content, 'SHY-8505-fixture-story', 'In Progress');
    const items = itemsResponse([issueNode('SHY-8505', 'ITEM_I8505', 505)]);
    const rules = createPathRules(mock.dir, { items });
    writeResponse(mock.dir, 'resp-body-505.txt', body);
    writeRules(mock.dir, [
      ['^issue comment', '', '1'],
      ['^issue view 505 --json body', 'resp-body-505.txt', ''],
      ...rules,
    ]);
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(40);
    const lines = readRecording(mock.recording);
    expect(lines.find((l) => l.startsWith('issue edit 505'))).toBeDefined();
  });

  test('issue close failure → exit 40', () => {
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories74f5-');
    const { content } = makeStory(storiesDir, { id: 'SHY-8506', status: 'Done', type: 'bug' });
    const body = existingBody(content, 'SHY-8506-fixture-story', 'Done');
    const items = itemsResponse([issueNode('SHY-8506', 'ITEM_I8506', 506)]);
    const rules = createPathRules(mock.dir, { items });
    writeResponse(mock.dir, 'resp-body-506.txt', body);
    writeRules(mock.dir, [
      ['^issue close', '', '1'],
      ['^issue view 506 --json body', 'resp-body-506.txt', ''],
      ...rules,
    ]);
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(40);
    expect(r.stderr).toMatch(/failed to close/);
  });

  test('issue edit failure with the large body → stderr captured + exit 40', () => {
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories74f6-');
    makeStory(storiesDir, { id: 'SHY-8507', type: 'bug' });
    const staleBody = `Old.\n\n${syncedFooter('SHY-8507-fixture-story', 'Draft', STALE_HASH)}`;
    const items = itemsResponse([issueNode('SHY-8507', 'ITEM_I8507', 507)]);
    const rules = createPathRules(mock.dir, { items });
    writeResponse(mock.dir, 'resp-body-507.txt', staleBody);
    writeRules(mock.dir, [
      ['^issue view 507 --json body', 'resp-body-507.txt', ''],
      ['^issue edit', '', '1'],
      ...rules,
    ]);
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(40);
    expect(r.stderr).toContain('failed to update issue');
  });

  test('gh issue view failure after create → [gh-error] + N_FAILED + exit 40, board add skipped (reviewer C1)', () => {
    // The node-id resolution between `issue create` and the board add used
    // to be `2>/dev/null || true`-swallowed: a created issue with NO board
    // card and exit 0. The failure must surface + count.
    const mock = makePatternMockGh();
    const storiesDir = tempDir('stories74f7-');
    makeStory(storiesDir, { id: 'SHY-8508', type: 'bug' });
    const rules = createPathRules(mock.dir);
    writeRules(mock.dir, [['^issue view 100 --json id', '', '1', 'not found'], ...rules]);
    const r = runScript(['--all'], baseEnv(mock.ghPath, storiesDir));
    expect(r.code).toBe(40);
    expect(r.stderr).toMatch(/\[gh-error\] issue view 100/);
    expect(r.stderr).toContain('1 failed');
    const lines = readRecording(mock.recording);
    expect(lines.filter((l) => l.includes('addProjectV2ItemById'))).toEqual([]);
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

describe('SHY-0074 v2: dry-run fires nothing but previews everything (mock-gh)', () => {
  test('zero mutations; previews draft create, issue create, and label-family deletion', () => {
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
    expect(r.stderr).toMatch(/DRY-RUN: .*SHY-8701.*would CREATE DRAFT item/);
    expect(r.stderr).toMatch(/DRY-RUN: .*SHY-8702.*would CREATE issue/);
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

  test('build_labels no longer emits the duplicated families', () => {
    const fn = src.slice(
      src.indexOf('build_labels()'),
      src.indexOf('}', src.indexOf('build_labels()')),
    );
    for (const family of ['status:', 'priority:', 'effort:', 'type:', 'roadmap:']) {
      expect(fn).not.toContain(`'${family}`);
    }
  });

  test('dead SYNC_GRACE_WINDOW_SECS config doc is removed (was documented but never implemented)', () => {
    expect(src).not.toContain('SYNC_GRACE_WINDOW_SECS');
  });
});
