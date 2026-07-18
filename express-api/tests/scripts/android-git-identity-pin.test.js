/**
 * app/build.gradle.kts — Android build-time git-identity injection pins
 * (SHY-0205).
 *
 * The reviewer's R1 pass flagged the asymmetry: the iOS half of this
 * mechanism is structurally pinned (ios-dev-configuration.test.js reads
 * Info.plist + the writers), while the Android half — the gradle
 * `providers.exec` calls, sanitisation regexes, and env precedence —
 * had no pin at all. Same convention as the iOS suite: read the build
 * file as text, regex-assert the load-bearing structure so a refactor
 * can't silently drop configuration-cache safety or the sanitiser.
 */
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const GRADLE = path.join(REPO_ROOT, 'app', 'build.gradle.kts');

describe('Android git-identity injection pins (SHY-0205)', () => {
  let src;
  beforeAll(() => {
    src = fs.readFileSync(GRADLE, 'utf8');
  });

  test.each([['GIT_BRANCH'], ['GIT_SHA'], ['GIT_DIRTY']])(
    'defaultConfig bakes buildConfigField %s',
    (field) => {
      const re = new RegExp(`buildConfigField\\("(?:String|Boolean)", "${field}"`);
      expect(src).toMatch(re);
    },
  );

  test('branch resolution prefers GITHUB_REF_NAME over local git (CI truth)', () => {
    const refIdx = src.indexOf('System.getenv("GITHUB_REF_NAME")');
    const branchGitIdx = src.indexOf('"rev-parse", "--abbrev-ref", "HEAD"');
    expect(refIdx).toBeGreaterThan(-1);
    expect(branchGitIdx).toBeGreaterThan(refIdx);
  });

  test.each([
    ['branch', /"git", "rev-parse", "--abbrev-ref", "HEAD"/],
    ['sha', /"git", "rev-parse", "--short", "HEAD"/],
    ['dirty', /"git", "status", "--porcelain"/],
  ])('%s is read via configuration-cache-safe providers.exec', (_slot, gitRe) => {
    // Every git read must go through providers.exec — a bare
    // Runtime.exec/exec would reintroduce the configuration-cache
    // staleness the story calls out as a risk.
    const idx = src.search(gitRe);
    expect(idx).toBeGreaterThan(-1);
    const windowBefore = src.slice(Math.max(0, idx - 200), idx);
    expect(windowBefore).toMatch(/providers\s{1,30}\.exec/);
  });

  test('branch label is sanitised to the safe charset before baking', () => {
    expect(src).toContain('replace(Regex("[^A-Za-z0-9._/-]"), "-")');
  });

  test('sha is hex-filtered before baking', () => {
    expect(src).toContain('replace(Regex("[^0-9a-fA-F]"), "")');
  });

  test('detached HEAD degrades to empty (renders ?) instead of the literal HEAD', () => {
    expect(src).toMatch(/takeUnless \{ it == "HEAD" \}/);
  });
});
