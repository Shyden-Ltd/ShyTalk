/**
 * SHY-0226: `.github/**` changes must light BACKEND so the pin guard runs.
 *
 * Why this exists: pr-checks.yml's detect-changes case statement classified
 * `.github/*` as "no flags" alongside `.claude/*`, `.project/*` and `*.md`.
 * A workflow-only PR therefore skipped test-backend AND sonarcloud — the two
 * jobs that run the SHY-0162 pin-consistency guard — and `workflow_only=true`
 * skipped sonarcloud a second way. That is exactly how #1646 (setup-java
 * 5.5.0→5.6.0, workflow-only) auto-merged green on 2026-07-20 while
 * reintroducing a two-SHA drift: every guard-carrying job reported "skipped",
 * PR Gate saw no failures, auto-merge fired. The drift then failed all 17
 * queued Dependabot PRs.
 *
 * Contract pinned here (behaviorally, by executing the production case
 * statement — mirror of the canonical harness in
 * pr-checks-app-changed-split.test.js):
 *   - any `.github/**` path (workflows, composite actions, dependabot.yml)
 *     classifies as BACKEND=true, so the guard runs on the diff class that
 *     introduces drift;
 *   - `.claude/*`, `.project/*` and plain `*.md` stay no-flag (md-only PRs
 *     keep their cheap path);
 *   - `express-api/**` classification is untouched;
 *   - the downstream gates that make BACKEND matter stay wired: test-backend
 *     requires `backend_changed == 'true'`, sonarcloud requires
 *     `workflow_only != 'true'`, and WORKFLOW_ONLY derivation includes
 *     `$BACKEND` in its all-false conjunction (so BACKEND=true forces
 *     workflow_only=false).
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const PR_CHECKS_PATH = path.join(REPO_ROOT, '.github/workflows/pr-checks.yml');

/**
 * Extract a workflow step's full YAML block by its `- name:` header.
 * Mirror of the canonical helper in pr-checks-app-changed-split.test.js.
 */
function extractStep(yamlText, stepName) {
  const lines = yamlText.split('\n');
  const stepHeader = `      - name: ${stepName}`;
  const matches = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimEnd() === stepHeader) matches.push(i);
  }
  if (matches.length === 0) {
    throw new Error(
      `Could not find step "${stepName}" in workflow file. ` +
        'Step was renamed, removed, or indentation changed (helper ' +
        'requires 6-space step indent) — update this test to match.',
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous step name "${stepName}": found at lines ${matches
        .map((i) => i + 1)
        .join(', ')}. Use a more specific name or scope to a single job.`,
    );
  }
  const startIdx = matches[0];
  let endIdx = startIdx + 1;
  while (endIdx < lines.length) {
    const trimmed = lines[endIdx].trimEnd();
    if (trimmed.startsWith('      - name:')) break;
    if (trimmed.length > 0 && !trimmed.startsWith(' ')) break;
    endIdx++;
  }
  return lines.slice(startIdx, endIdx).join('\n');
}

/**
 * Extract a job's full YAML block by `<jobName>:` at 2-space indent.
 * Mirror of the canonical helper in pr-checks-app-changed-split.test.js —
 * job-gate pins MUST be scoped to their job: the literal
 * `backend_changed == 'true'` also appears in another job's input wiring
 * (`with: backend_changed: ...`) and in integration-tests' OR-clause, so a
 * whole-file substring check would stay green if test-backend alone
 * dropped its gate (R1).
 */
function extractJob(yamlText, jobName) {
  const lines = yamlText.split('\n');
  const jobsSectionIdx = lines.findIndex((l) => l.trimEnd() === 'jobs:');
  if (jobsSectionIdx < 0) {
    throw new Error('Could not find "jobs:" section in workflow file.');
  }
  const jobHeader = `  ${jobName}:`;
  const matches = [];
  for (let i = jobsSectionIdx + 1; i < lines.length; i++) {
    if (lines[i].trimEnd() === jobHeader) matches.push(i);
  }
  if (matches.length === 0) {
    throw new Error(`Could not find job "${jobName}" in workflow file.`);
  }
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous job name "${jobName}": found at lines ${matches.map((i) => i + 1).join(', ')}.`,
    );
  }
  const startIdx = matches[0];
  let endIdx = startIdx + 1;
  while (endIdx < lines.length) {
    const trimmed = lines[endIdx].trimEnd();
    if (/^ {2}[a-zA-Z_][\w-]*:$/.test(trimmed)) break;
    if (trimmed.length > 0 && !trimmed.startsWith(' ')) break;
    endIdx++;
  }
  return lines.slice(startIdx, endIdx).join('\n');
}

/**
 * Run the production case statement against a synthetic file list in a real
 * bash shell and return the flag values. Mirror of the canonical behavioral
 * harness in pr-checks-app-changed-split.test.js.
 */
function classifyFiles(yamlText, files) {
  const stepBlock = extractStep(yamlText, 'Detect changed paths');
  const caseMatch = stepBlock.match(/case "\$file" in([\s\S]*?)esac/);
  if (!caseMatch) {
    throw new Error('Could not find case statement in detect-changes step');
  }
  const caseBody = caseMatch[1];
  const flagsInit =
    'ANDROID_APP=false IOS_APP=false APP=false BACKEND=false WEB=false INTEGRATION=false OTHER=false';
  const fileList = files.map((f) => `'${f.replace(/'/g, "'\\''")}'`).join(' ');
  const script = `
set -e
${flagsInit}
for file in ${fileList}; do
  case "$file" in${caseBody}esac
done
echo "ANDROID_APP=$ANDROID_APP"
echo "IOS_APP=$IOS_APP"
echo "APP=$APP"
echo "BACKEND=$BACKEND"
echo "WEB=$WEB"
echo "INTEGRATION=$INTEGRATION"
echo "OTHER=$OTHER"
`;
  // Absolute /bin/bash (not PATH lookup): satisfies
  // sonarjs/no-os-command-from-path and matches the runner's shell.
  const out = execFileSync('/bin/bash', ['-c', script], { encoding: 'utf8' });
  const result = {};
  for (const line of out.trim().split('\n')) {
    const [k, v] = line.split('=');
    result[k] = v;
  }
  return result;
}

describe('SHY-0226: .github/** lights BACKEND so the pin guard cannot be skipped', () => {
  let yamlText;

  beforeAll(() => {
    yamlText = fs.readFileSync(PR_CHECKS_PATH, 'utf8');
  });

  describe('behavioral: production case statement classification', () => {
    test('a workflow file change classifies as BACKEND (the #1646 hole)', () => {
      const flags = classifyFiles(yamlText, [
        '.github/workflows/test-backend.yml',
      ]);
      expect(flags.BACKEND).toBe('true');
    });

    test('a composite-action change classifies as BACKEND', () => {
      const flags = classifyFiles(yamlText, [
        '.github/actions/setup-jdk-gradle/action.yml',
      ]);
      expect(flags.BACKEND).toBe('true');
    });

    test('a dependabot.yml change classifies as BACKEND', () => {
      const flags = classifyFiles(yamlText, ['.github/dependabot.yml']);
      expect(flags.BACKEND).toBe('true');
    });

    test('.github changes set ONLY backend (no app/web/integration bleed)', () => {
      const flags = classifyFiles(yamlText, [
        '.github/workflows/pr-checks.yml',
      ]);
      expect(flags).toMatchObject({
        ANDROID_APP: 'false',
        IOS_APP: 'false',
        APP: 'false',
        BACKEND: 'true',
        WEB: 'false',
        INTEGRATION: 'false',
        OTHER: 'false',
      });
    });

    test('plain markdown stays no-flag (md-only PRs keep the cheap path)', () => {
      const flags = classifyFiles(yamlText, ['README.md', 'docs/notes.md']);
      expect(flags).toMatchObject({ BACKEND: 'false', OTHER: 'false' });
    });

    test('.claude/* and .project/* stay no-flag', () => {
      const flags = classifyFiles(yamlText, [
        '.claude/settings.json',
        '.project/stories/SHY-0226-setup-java-pin-drift-heal-and-guards.md',
      ]);
      expect(flags).toMatchObject({ BACKEND: 'false', OTHER: 'false' });
    });

    test('a .md file UNDER .github still classifies BACKEND (first-match ordering pin)', () => {
      // .github/pull_request_template.md matches BOTH the `.github/*` arm
      // and the residual `*.md` no-op arm — this pins that the `.github/*`
      // arm stays FIRST. Re-merging `.github/*` into the no-op arm (or
      // reordering it after) would silently recreate the #1646 hole for
      // .github markdown-adjacent diffs with every other case still green (R1).
      const flags = classifyFiles(yamlText, [
        '.github/pull_request_template.md',
      ]);
      expect(flags.BACKEND).toBe('true');
    });

    test('express-api classification is untouched by the reorder', () => {
      const flags = classifyFiles(yamlText, ['express-api/src/index.js']);
      expect(flags).toMatchObject({ BACKEND: 'true', APP: 'false' });
    });
  });

  describe('structural: the downstream wiring that makes BACKEND matter', () => {
    test('WORKFLOW_ONLY derivation includes $BACKEND in the all-false conjunction', () => {
      const stepBlock = extractStep(yamlText, 'Detect changed paths');
      expect(stepBlock).toContain('[ "$BACKEND" = "false" ]');
    });

    test('test-backend job gates on backend_changed', () => {
      expect(extractJob(yamlText, 'test-backend')).toContain(
        "needs.detect-changes.outputs.backend_changed == 'true'",
      );
    });

    test('sonarcloud job skips only when workflow_only (which BACKEND=true forces false)', () => {
      expect(extractJob(yamlText, 'sonarcloud')).toContain(
        "needs.detect-changes.outputs.workflow_only != 'true'",
      );
    });
  });
});
