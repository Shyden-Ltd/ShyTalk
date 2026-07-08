/**
 * prepush-sonar-main-only-gate.test.js
 *
 * SHY-0164: the pre-push SonarCloud scan (Express+Kotlin coverage generation,
 * analysis, and quality-gate wait) runs ONLY when pushing `main`.
 *
 * Why main-only: SonarCloud's free plan will not expose a NON-main branch's
 * quality gate to the organisation ("Organization is not allowed to access data
 * from non-main branches"). So a local `-Dsonar.qualitygate.wait=true` on a
 * feature branch either errors outright (branch-scoped) or — without a branch
 * name — grades the working tree against MAIN's gate, blocking every clean
 * feature-branch push on pre-existing main debt. In the develop-flow feature
 * branches push to `develop` constantly, so the scan is gated on branch==main;
 * the quality gate's teeth land at the develop→main promotion, where main IS
 * analysed. CI's own Sonar step is advisory (build.gradle.kts wait=false, same
 * free-plan limit) so the main-push path here is the ONLY enforcing gate.
 *
 * These tests EXECUTE the hook's real bytes: (1) the branch-decision (real
 * condition, branch value injected) proves main runs the scan while a feature
 * branch skips it and falls THROUGH to later stages; (2) the gate's real
 * failure handler (driven by the `false`/`true` shell builtins in place of the
 * gradle command) proves a failing gate on the main path still BLOCKS the push.
 * Structural pins lock the command shape and guard against a regression back to
 * the unsound branch-scoped approach.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK_PATH = path.resolve(__dirname, '../../../.husky/pre-push');
const PRE_PUSH = fs.readFileSync(HOOK_PATH, 'utf8');

// ---------------------------------------------------------------------------
// Behavioural: the branch decision. We slice the hook's REAL guard condition +
// skip branch (`if [ "$CURRENT_BRANCH" != "main" ]; then <skip>`), inject a
// concrete CURRENT_BRANCH, and replace only the heavy scan body (the `else`)
// with a sentinel — the conditional and skip message are the hook's own bytes.
// A trailing sentinel after the closing `fi` proves neither branch `exit`s, so
// a skipped feature push still reaches the later stages (Playwright).
// ---------------------------------------------------------------------------
function runDecision(branch) {
  const ifStart = PRE_PUSH.indexOf('if [ "$CURRENT_BRANCH" != "main" ]');
  if (ifStart < 0) throw new Error('main-only guard (CURRENT_BRANCH != main) not found in hook');
  const elseIdx = PRE_PUSH.indexOf('\nelse', ifStart);
  if (elseIdx < 0) throw new Error("main-only guard's else branch not found");
  const realCondAndSkip = PRE_PUSH.slice(ifStart, elseIdx); // `if ...; then\n  echo skip`
  const harness = [
    'set -u',
    `CURRENT_BRANCH="${branch}"`,
    realCondAndSkip,
    'else',
    '  echo "__SCAN_RAN__"',
    'fi',
    'echo "__AFTER_GUARD__"',
  ].join('\n');
  // Absolute path (not PATH-resolved `bash`) to satisfy sonarjs/no-os-command-
  // from-path without a suppression — matches pr-checks-device-e2e-deferred.test.js.
  return spawnSync('/bin/bash', ['-c', harness], { encoding: 'utf8' });
}

describe('SHY-0164: the SonarCloud pre-push scan is gated on branch == main', () => {
  test('on main, the scan body runs and execution continues', () => {
    const r = runDecision('main');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('__SCAN_RAN__');
    expect(r.stdout).not.toMatch(/skipping SonarCloud/i);
    expect(r.stdout).toContain('__AFTER_GUARD__');
  });

  test('on a feature branch, the scan is skipped and execution falls THROUGH', () => {
    const branch = 'story/SHY-0164-prepush-sonar-main-only-gate';
    const r = runDecision(branch);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain('__SCAN_RAN__');
    expect(r.stdout).toMatch(/skipping SonarCloud pre-push gate/i);
    // The skip message names the branch (AC: "Feature branch (<name>) — …") so a
    // regression that drops $CURRENT_BRANCH from the echo is caught.
    expect(r.stdout).toContain(branch);
    // Falls through — a skipped feature push must still reach Playwright below.
    expect(r.stdout).toContain('__AFTER_GUARD__');
  });

  test('on develop, the scan is skipped (develop is not main)', () => {
    const r = runDecision('develop');
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain('__SCAN_RAN__');
    expect(r.stdout).toMatch(/skipping SonarCloud pre-push gate/i);
    expect(r.stdout).toContain('develop');
    expect(r.stdout).toContain('__AFTER_GUARD__');
  });

  test('a branch whose name merely starts with "main" is NOT treated as main', () => {
    // Exact-match guard: only the literal `main` runs the scan. A prefix like
    // `main-hotfix` or `mainline` must skip (it is not the protected branch).
    const r = runDecision('main-hotfix');
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain('__SCAN_RAN__');
    expect(r.stdout).toMatch(/skipping SonarCloud/i);
    expect(r.stdout).toContain('main-hotfix');
    expect(r.stdout).toContain('__AFTER_GUARD__');
  });

  test.each(['HEAD', ''])(
    'CURRENT_BRANCH=%p (detached HEAD / degenerate empty) skips — the documented safe direction',
    (branch) => {
      // `git rev-parse --abbrev-ref HEAD` returns the literal `HEAD` when
      // detached (and a degenerate case could yield empty). Either way the exact
      // `!= "main"` test must SKIP (never falsely gate as main) and fall through.
      // Story Risks & Mitigations: skipping is the safe direction.
      const r = runDecision(branch);
      expect(r.stdout).not.toContain('__SCAN_RAN__');
      expect(r.stdout).toContain('__AFTER_GUARD__');
    },
  );
});

// ---------------------------------------------------------------------------
// Behavioural: the main-path gate keeps its teeth. We slice the hook's REAL
// failure handler (from `; then` through the gate's closing `fi`) and drive the
// `if ! <cmd>` with the `false` / `true` shell builtins in place of the gradle
// command. `false` = the analysis failed; `true` = it passed. A trailing
// sentinel proves the pass path falls through.
// ---------------------------------------------------------------------------
function runGate(sonarCmd) {
  const start = PRE_PUSH.indexOf('if ! ./gradlew sonar');
  if (start < 0) throw new Error('gradle sonar gate not found in hook');
  const thenIdx = PRE_PUSH.indexOf('; then', start);
  if (thenIdx < 0) throw new Error("gate's `; then` not found");
  // Match the gate's OWN closing `fi` — a line that is just `fi` with any
  // indentation (`\n  fi` once nested inside the main-only else, `\nfi` at
  // column 0). indexOf('\nfi') alone would skip an indented `fi` and grab the
  // outer guard's `fi`, unbalancing the if/fi.
  const afterThen = PRE_PUSH.slice(thenIdx);
  const fiMatch = afterThen.match(/\n[ \t]*fi\b/);
  if (!fiMatch) throw new Error("gate's closing `fi` not found");
  const failureHandler = afterThen.slice(0, fiMatch.index + fiMatch[0].length); // `; then\n ...exit 1\n  fi`
  const harness = ['set -u', `if ! ${sonarCmd}${failureHandler}`, 'echo "__GATE_PASSED__"'].join(
    '\n',
  );
  // Absolute path (not PATH-resolved `bash`) to satisfy sonarjs/no-os-command-
  // from-path without a suppression — matches pr-checks-device-e2e-deferred.test.js.
  return spawnSync('/bin/bash', ['-c', harness], { encoding: 'utf8' });
}

describe('SHY-0164: the main-path Sonar gate keeps its teeth', () => {
  test('a failing gate BLOCKS the push (exit 1, no fall-through)', () => {
    const r = runGate('false');
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/SonarCloud quality gate FAILED/);
    expect(r.stdout).not.toContain('__GATE_PASSED__');
  });

  test('a passing gate falls through (exit 0)', () => {
    const r = runGate('true');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('__GATE_PASSED__');
  });
});

// ---------------------------------------------------------------------------
// Behavioural: the main-path SONAR_TOKEN guard. Slice the hook's real
// `if [ -z "$SONAR_TOKEN" ]; then … exit 1; fi` block and run it with the token
// unset vs set. NOTE: no `set -u` here — the hook itself runs under a plain
// `#!/usr/bin/env sh` with no `set -u`, and `[ -z "$SONAR_TOKEN" ]` on an unset
// var must be exercised faithfully (set -u would abort on the unbound var).
// ---------------------------------------------------------------------------
function runTokenCheck(tokenValue) {
  // Anchor on `]; then` (not just `if [ -z "$SONAR_TOKEN" ]`) so we match the
  // in-guard token check, NOT the `.env` loader near the top of the hook
  // (`if [ -z "$SONAR_TOKEN" ] && [ -f ".env" ]; then`), which has no `]; then`.
  const start = PRE_PUSH.indexOf('if [ -z "$SONAR_TOKEN" ]; then');
  if (start < 0) throw new Error('in-guard SONAR_TOKEN check not found in hook');
  const afterStart = PRE_PUSH.slice(start);
  const fiMatch = afterStart.match(/\n[ \t]*fi\b/);
  if (!fiMatch) throw new Error("SONAR_TOKEN guard's closing `fi` not found");
  const guard = afterStart.slice(0, fiMatch.index + fiMatch[0].length);
  const harness = [
    tokenValue === undefined ? 'unset SONAR_TOKEN' : `SONAR_TOKEN="${tokenValue}"`,
    guard,
    'echo "__TOKEN_OK__"',
  ].join('\n');
  return spawnSync('/bin/bash', ['-c', harness], { encoding: 'utf8' });
}

describe('SHY-0164: the main-path SONAR_TOKEN guard still blocks', () => {
  test('an unset SONAR_TOKEN blocks the push (exit 1, no fall-through)', () => {
    const r = runTokenCheck(undefined);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/SONAR_TOKEN not set — push blocked/);
    expect(r.stdout).not.toContain('__TOKEN_OK__');
  });

  test('a set SONAR_TOKEN falls through to the scan', () => {
    const r = runTokenCheck('dummy-token');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('__TOKEN_OK__');
  });
});

// ---------------------------------------------------------------------------
// Behavioural: the "No code changes" short-circuit ABOVE the guard is unchanged
// — a push with no code changes exits 0 before ever reaching the branch guard,
// regardless of branch. Slice the real `if [ "$HAS_CODE" = "false" ]; then …
// exit 0; fi` block and drive it with HAS_CODE=false vs true.
// ---------------------------------------------------------------------------
function runNoCodeShortCircuit(hasCode) {
  const start = PRE_PUSH.indexOf('if [ "$HAS_CODE" = "false" ]');
  if (start < 0) throw new Error('HAS_CODE short-circuit not found in hook');
  const afterStart = PRE_PUSH.slice(start);
  const fiMatch = afterStart.match(/\n[ \t]*fi\b/);
  if (!fiMatch) throw new Error("HAS_CODE short-circuit's closing `fi` not found");
  const block = afterStart.slice(0, fiMatch.index + fiMatch[0].length);
  const harness = ['set -u', `HAS_CODE="${hasCode}"`, block, 'echo "__PAST_SHORTCIRCUIT__"'].join(
    '\n',
  );
  return spawnSync('/bin/bash', ['-c', harness], { encoding: 'utf8' });
}

describe('SHY-0164: the "No code changes" short-circuit is unchanged', () => {
  test('no code changes → exits 0 before the branch guard', () => {
    const r = runNoCodeShortCircuit('false');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/No code changes/);
    expect(r.stdout).not.toContain('__PAST_SHORTCIRCUIT__');
  });

  test('code changes → falls through to the branch guard', () => {
    const r = runNoCodeShortCircuit('true');
    expect(r.status).toBe(0);
    expect(r.stdout).not.toMatch(/No code changes/);
    expect(r.stdout).toContain('__PAST_SHORTCIRCUIT__');
  });
});

// ---------------------------------------------------------------------------
// Structural: command shape + anti-regression locks.
// ---------------------------------------------------------------------------
function sonarInvocation() {
  const start = PRE_PUSH.indexOf('./gradlew sonar');
  if (start < 0) return '';
  const end = PRE_PUSH.indexOf('; then', start);
  return end < 0 ? PRE_PUSH.slice(start) : PRE_PUSH.slice(start, end);
}

describe('SHY-0164: structure locks', () => {
  test('CURRENT_BRANCH is derived from the checked-out branch', () => {
    expect(PRE_PUSH).toMatch(/CURRENT_BRANCH="\$\(git rev-parse --abbrev-ref HEAD\)"/);
  });

  test('the gate still hard-waits on the main path (wait=true present)', () => {
    expect(sonarInvocation()).toMatch(/-Dsonar\.qualitygate\.wait=true/);
  });

  test('the gate is NOT defeated by a wait=false anywhere in the hook', () => {
    // Gradle/JVM: last -D for a key wins; a later wait=false would silently
    // disable the gate. This hook is the ONLY enforcing gate, so pin it out.
    expect(PRE_PUSH).not.toMatch(/-Dsonar\.qualitygate\.wait=false/);
  });

  test('branch-name scoping is NOT reintroduced (unsound on the free plan)', () => {
    // sonar.branch.name made wait=true error, because the org cannot read a
    // non-main branch gate. The fix gates on branch==main instead. Guard
    // against reverting to the branch-scoped approach.
    expect(PRE_PUSH).not.toMatch(/-Dsonar\.branch\.name/);
  });

  test('the ENTIRE scan body sits INSIDE the main-only guard (all four components bounded by its else…fi)', () => {
    const guardIdx = PRE_PUSH.indexOf('if [ "$CURRENT_BRANCH" != "main" ]');
    const elseIdx = PRE_PUSH.indexOf('\nelse', guardIdx);
    // The guard's else ends with the "gate passed" echo, immediately before its
    // own closing `fi`; that fi is the upper bound for every scan component.
    const closingFiIdx = PRE_PUSH.indexOf(
      '\nfi',
      PRE_PUSH.indexOf('SonarCloud quality gate passed'),
    );
    expect(guardIdx).toBeGreaterThanOrEqual(0);
    expect(elseIdx).toBeGreaterThan(guardIdx);
    expect(closingFiIdx).toBeGreaterThan(elseIdx);
    // Both an UPPER and a lower bound for every part of the scan — the
    // SONAR_TOKEN check, the Express-jest coverage feeder, the Kotlin-jvmTest
    // coverage feeder, and the gradle sonar gate — so a future edit cannot hoist
    // e.g. the Express-jest step (and its Firebase-emulator dependency) back
    // above the guard while keeping the suite green (Performance AC).
    const components = {
      // `]; then` anchors the in-guard check, not the `.env` loader above.
      'SONAR_TOKEN check': PRE_PUSH.indexOf('if [ -z "$SONAR_TOKEN" ]; then'),
      'Express-jest feeder': PRE_PUSH.indexOf('Express tests with coverage'),
      'Kotlin-jvmTest feeder': PRE_PUSH.indexOf('Kotlin JVM tests'),
      'gradle sonar gate': PRE_PUSH.indexOf('./gradlew sonar'),
    };
    for (const [name, idx] of Object.entries(components)) {
      expect({ name, position: 'after else', ok: idx > elseIdx }).toEqual({
        name,
        position: 'after else',
        ok: true,
      });
      expect({ name, position: 'before guard fi', ok: idx < closingFiIdx }).toEqual({
        name,
        position: 'before guard fi',
        ok: true,
      });
    }
  });

  test('Playwright runs OUTSIDE the main-only guard (feature branches still web-test)', () => {
    // The guard's else ends with the "gate passed" echo, immediately before its
    // closing `fi`. The Playwright block must start AFTER that `fi`, so a
    // skipped feature-branch push still reaches it.
    const passedIdx = PRE_PUSH.indexOf('SonarCloud quality gate passed');
    const closingFiIdx = PRE_PUSH.indexOf('\nfi', passedIdx);
    const playwrightIdx = PRE_PUSH.indexOf('HAS_WEB=false');
    expect(passedIdx).toBeGreaterThanOrEqual(0);
    expect(closingFiIdx).toBeGreaterThan(passedIdx);
    expect(playwrightIdx).toBeGreaterThan(closingFiIdx);
  });
});
