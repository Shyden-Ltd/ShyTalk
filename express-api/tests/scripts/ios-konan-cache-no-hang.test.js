/**
 * ios-tests.yml — ~/.konan cache must use restore + save split with
 * bounded save step.
 *
 * Self-discovered 2026-06-01 on PR #950 (i18n translation PR that did
 * not touch iOS code): the build-ios job's Post step "Cache
 * Kotlin/Native (~/.konan)" hung in `in_progress` for 2+ hours,
 * blocking the workflow's concurrency lock and stranding all
 * subsequent PR Checks runs on the branch. The job-level
 * `timeout-minutes: 90` did NOT enforce the kill — actions/cache
 * post-steps that are mid-upload to GitHub's cache backend do not
 * reliably respect timeout signals.
 *
 * Root cause: the combined `actions/cache@v5` step runs its save as
 * a synthetic POST step appended to the job's teardown. Post steps
 * cannot themselves be wrapped with `timeout-minutes` or
 * `continue-on-error` (those attributes apply only at the regular
 * step level). When the cache upload hangs (~.konan is multi-GB —
 * the largest cache in the job; SwiftPM/DerivedData/Pods/CocoaPods
 * all completed cleanly), the post step blocks indefinitely with no
 * escape hatch.
 *
 * Fix: split the combined step into `actions/cache/restore@v5`
 * (regular step at the head of the job) plus `actions/cache/save@v5`
 * (regular step AFTER the heavy build steps complete). The save
 * step gets:
 *   - `timeout-minutes` so a hung upload bounds the blast radius
 *   - `continue-on-error: true` so a hung/failed save doesn't fail
 *     the job (cache is a perf optimization, not a correctness gate)
 *   - `if:` guard that skips save on cache-hit (no point re-uploading
 *     the identical bundle)
 *
 * Pin the resulting workflow shape here so a future refactor that
 * regresses back to the combined `actions/cache` step is caught at
 * PR time, not after another PR is blocked for hours.
 */

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const IOS_TESTS_YML = path.join(REPO_ROOT, '.github/workflows/ios-tests.yml');

describe('ios-tests.yml — ~/.konan cache: restore + save split with bounded save', () => {
  let yamlText;

  beforeAll(() => {
    yamlText = fs.readFileSync(IOS_TESTS_YML, 'utf8');
  });

  test('does NOT use the combined actions/cache step for ~/.konan (anti-pattern)', () => {
    // Iterate over each `uses: actions/cache@<X>` line (combined
    // action). The split actions/cache/restore + actions/cache/save
    // won't match this prefix because of the slash after `cache`.
    // For each combined-cache step, assert that the next 300
    // characters don't include `path: ~/.konan` — i.e. no combined
    // step targets this cache.
    const combinedSteps = [...yamlText.matchAll(/uses: actions\/cache@\S+/g)];
    for (const m of combinedSteps) {
      const stepWindow = yamlText.substring(m.index, m.index + 300);
      expect(stepWindow).not.toMatch(/path:\s*~\/\.konan/);
    }
  });

  test('has an actions/cache/restore step for ~/.konan with id for save-guard', () => {
    // The restore step must carry an `id:` so a later save step can
    // gate on its cache-hit output. `id:` conventionally sits between
    // `name:` and `uses:` in the step body — search for an `id:` line
    // within ~200 chars BEFORE the `uses: actions/cache/restore@<X>`
    // → `path: ~/.konan` pair.
    const restoreWithId = yamlText.match(
      /id:\s+\S+[\s\S]{0,200}?uses: actions\/cache\/restore@\S+[\s\S]{0,200}?path: ~\/\.konan/,
    );
    expect(restoreWithId).not.toBeNull();
  });

  // Locate the save step body once via index arithmetic — avoids
  // unbounded-lazy regexes (`[^]*?`) that ESLint's sonarjs/slow-regex
  // flags as catastrophic-backtracking-prone. The step's safety
  // attributes (`if:`, `timeout-minutes:`, `continue-on-error:`) all
  // appear in the ~10 lines immediately above the `uses:` line per
  // YAML step convention.
  function findSaveStepBlock() {
    const usesPattern = /uses: actions\/cache\/save@\S+/;
    const usesMatch = yamlText.match(usesPattern);
    if (!usesMatch) return null;
    // Walk backwards from the `uses:` line to the step's `- name:`
    // header (bounded by 20 lines — far more than any real step).
    const upToUses = yamlText.substring(0, usesMatch.index + usesMatch[0].length);
    const lines = upToUses.split('\n');
    const stepHeaderIdx = (() => {
      for (let i = lines.length - 1; i >= Math.max(0, lines.length - 20); i--) {
        if (/^ {6}- /.test(lines[i])) return i;
      }
      return -1;
    })();
    if (stepHeaderIdx === -1) return null;
    // Walk forwards from `uses:` until the next step header or end.
    const allLines = yamlText.split('\n');
    let endIdx = allLines.length;
    for (let i = lines.length; i < Math.min(allLines.length, lines.length + 20); i++) {
      if (/^ {6}- /.test(allLines[i]) || /^ {4}\S/.test(allLines[i])) {
        endIdx = i;
        break;
      }
    }
    return allLines.slice(stepHeaderIdx, endIdx).join('\n');
  }

  test('has an actions/cache/save step for ~/.konan', () => {
    const block = findSaveStepBlock();
    expect(block).not.toBeNull();
    expect(block).toMatch(/uses: actions\/cache\/save@\S+/);
    expect(block).toMatch(/path:\s*~\/\.konan/);
  });

  test('the save step has timeout-minutes (bounded blast radius)', () => {
    const block = findSaveStepBlock();
    expect(block).not.toBeNull();
    expect(block).toMatch(/timeout-minutes:\s+\d+/);
  });

  test('the save step has continue-on-error: true (cache is not a correctness gate)', () => {
    const block = findSaveStepBlock();
    expect(block).not.toBeNull();
    expect(block).toMatch(/continue-on-error:\s+true/);
  });

  test('the save step has an if-guard so it skips save on cache-hit', () => {
    const block = findSaveStepBlock();
    expect(block).not.toBeNull();
    expect(block).toMatch(/if:[^\n]*cache-hit/);
  });
});

// The same restore+save split MUST apply to deploy-dev.yml and
// deploy-prod.yml — both contain iOS jobs that cache ~/.konan with
// the identical multi-GB payload + same actions/cache version. Per
// PR #951's reviewer note (pre-existing-systemic): a hung POST save
// here would block a DEPLOY (worse than blocking a PR Gate). This
// suite asserts the split was applied in all 3 workflows.
const DEPLOY_DEV_YML = path.join(REPO_ROOT, '.github/workflows/deploy-dev.yml');
const DEPLOY_PROD_YML = path.join(REPO_ROOT, '.github/workflows/deploy-prod.yml');

describe.each([
  ['deploy-dev.yml', DEPLOY_DEV_YML, 1],
  ['deploy-prod.yml', DEPLOY_PROD_YML, 2],
])('%s — ~/.konan cache split applied', (label, yamlPath, expectedSaveCount) => {
  let yamlText;

  beforeAll(() => {
    yamlText = fs.readFileSync(yamlPath, 'utf8');
  });

  test(`${label} does NOT use combined actions/cache for ~/.konan`, () => {
    const combinedSteps = [...yamlText.matchAll(/uses: actions\/cache@\S+/g)];
    for (const m of combinedSteps) {
      const stepWindow = yamlText.substring(m.index, m.index + 300);
      expect(stepWindow).not.toMatch(/path:\s*~\/\.konan/);
    }
  });

  test(`${label} has actions/cache/restore step(s) for ~/.konan with id for save-guard`, () => {
    const restoreOccurrences = [
      ...yamlText.matchAll(
        /id:\s+\S+[\s\S]{0,300}?uses: actions\/cache\/restore@\S+[\s\S]{0,300}?path: ~\/\.konan/g,
      ),
    ];
    expect(restoreOccurrences.length).toBe(expectedSaveCount);
  });

  test(`${label} has ${expectedSaveCount} actions/cache/save step(s) for ~/.konan`, () => {
    const saveOccurrences = [...yamlText.matchAll(/uses: actions\/cache\/save@\S+/g)];
    expect(saveOccurrences.length).toBe(expectedSaveCount);
  });

  test(`${label} every save step has timeout-minutes + continue-on-error + cache-hit if-guard`, () => {
    // For each `uses: actions/cache/save@<X>`, walk back to the step
    // header (`      - `) and forward to next sibling (~30 lines)
    // to extract the step body. Assert all 3 safety attrs present.
    const lines = yamlText.split('\n');
    const saveStepLineNumbers = [];
    for (let i = 0; i < lines.length; i++) {
      if (/uses: actions\/cache\/save@\S+/.test(lines[i])) saveStepLineNumbers.push(i);
    }
    expect(saveStepLineNumbers.length).toBe(expectedSaveCount);
    for (const lineNo of saveStepLineNumbers) {
      let headerIdx = -1;
      for (let j = lineNo; j >= Math.max(0, lineNo - 15); j--) {
        if (/^ {6}- /.test(lines[j])) {
          headerIdx = j;
          break;
        }
      }
      expect(headerIdx).toBeGreaterThanOrEqual(0);
      let endIdx = Math.min(lines.length, lineNo + 15);
      for (let j = lineNo + 1; j < Math.min(lines.length, lineNo + 15); j++) {
        if (/^ {6}- /.test(lines[j]) || /^ {2}\S/.test(lines[j])) {
          endIdx = j;
          break;
        }
      }
      const block = lines.slice(headerIdx, endIdx).join('\n');
      expect(block).toMatch(/timeout-minutes:\s+\d+/);
      expect(block).toMatch(/continue-on-error:\s+true/);
      expect(block).toMatch(/if:[^\n]*cache-hit/);
    }
  });
});
