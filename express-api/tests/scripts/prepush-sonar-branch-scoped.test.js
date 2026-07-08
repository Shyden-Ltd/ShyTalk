/**
 * prepush-sonar-branch-scoped.test.js
 *
 * SHY-0164: the pre-push SonarCloud scan must grade the CURRENT branch's own
 * new code, not the working tree against main's gate. Without
 * `sonar.branch.name`, a local run (no CI env to auto-detect from) is graded
 * against main's quality gate — so a red main gate blocks every clean
 * feature-branch push. These pins lock the branch scope in place so a future
 * edit cannot silently revert to the main-graded behaviour, and confirm the
 * gate is still enforced (scoped, not disabled).
 */

const fs = require('fs');
const path = require('path');

const PRE_PUSH = fs.readFileSync(path.resolve(__dirname, '../../../.husky/pre-push'), 'utf8');

// The `./gradlew sonar ... ; then` invocation block. Sliced so the assertions
// target the real scan command, not an unrelated mention elsewhere in the hook.
function sonarInvocation() {
  const start = PRE_PUSH.indexOf('./gradlew sonar');
  if (start < 0) return '';
  const end = PRE_PUSH.indexOf('; then', start);
  return end < 0 ? PRE_PUSH.slice(start) : PRE_PUSH.slice(start, end);
}

describe('SHY-0164: pre-push Sonar is branch-scoped', () => {
  const invocation = sonarInvocation();

  test('the hook has a gradle sonar invocation', () => {
    expect(invocation).not.toBe('');
  });

  test('SONAR_BRANCH is derived from the checked-out branch', () => {
    expect(PRE_PUSH).toMatch(/SONAR_BRANCH="\$\(git rev-parse --abbrev-ref HEAD\)"/);
  });

  test('the sonar command passes -Dsonar.branch.name from SONAR_BRANCH', () => {
    expect(invocation).toMatch(/-Dsonar\.branch\.name="\$SONAR_BRANCH"/);
  });

  test('the quality gate is still WAITED ON (scoped, not disabled)', () => {
    expect(invocation).toMatch(/-Dsonar\.qualitygate\.wait=true/);
  });

  test('SONAR_BRANCH is assigned before it is referenced in the command', () => {
    const assignIdx = PRE_PUSH.indexOf('SONAR_BRANCH="$(git rev-parse');
    const useIdx = PRE_PUSH.indexOf('-Dsonar.branch.name="$SONAR_BRANCH"');
    expect(assignIdx).toBeGreaterThanOrEqual(0);
    expect(useIdx).toBeGreaterThan(assignIdx);
  });

  test('the gate is NOT defeated by a wait=false on the same invocation (JVM last -D wins)', () => {
    // A later `-Dsonar.qualitygate.wait=false` on the same command would silently
    // turn the gate off (Gradle/JVM: last -D for a key wins). Pin it out — the
    // hook is the ONLY enforcing gate (CI Sonar is advisory), so this must bite.
    expect(invocation).not.toMatch(/-Dsonar\.qualitygate\.wait=false/);
  });
});
