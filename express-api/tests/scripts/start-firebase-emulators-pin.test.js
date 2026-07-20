/**
 * SHY-0226: the CI emulator toolchain must be version-pinned.
 *
 * Why this exists: .github/actions/start-firebase-emulators ran
 * `npm install -g firebase-tools` UNPINNED — every CI run silently adopted
 * the latest release. Between 2026-07-09 and 2026-07-20 (a window in which
 * change-detection routed no integration runs on main), firebase-tools
 * shipped 15.23.0 (07-09) and 15.24.0 (07-15); when #1650/#1651 finally ran
 * the suite, 4 positive-permission specs failed with Firestore rules
 * `evaluation error at L57:24` denials that the same rules + specs do NOT
 * produce under the locally-proven 15.15.0 — an emulator rules-engine
 * behaviour drift, indistinguishable from a product regression until
 * root-caused. The local stack IS the reference backend (real-only policy),
 * so CI must run the same pinned toolchain, upgraded deliberately (with the
 * cache key moving in lockstep), never implicitly.
 *
 * Contract (version-agnostic on purpose — a deliberate bump edits ONE line
 * and stays green here):
 *   1. the install line pins an exact `firebase-tools@<semver>`;
 *   2. the emulator-JAR cache key embeds that SAME version token, so a
 *      version bump cannot reuse a stale other-version JAR cache
 *      ([[feedback-ci-cache-downloads-version-aware]]).
 */
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const ACTION_PATH = path.join(REPO_ROOT, '.github/actions/start-firebase-emulators/action.yml');

// Anchored, ReDoS-safe: the exact-version install line. No `^`/`~` ranges —
// an exact semver only, so CI resolves ONE deterministic toolchain.
const PINNED_INSTALL_RE = /npm install -g firebase-tools@(\d+\.\d+\.\d+)\b/;
const UNPINNED_INSTALL_RE = /npm install -g firebase-tools(?!@)/;

// Line-iteration instead of a multiline regex: sonarjs/slow-regex flags
// `^\s*key:\s*(.+)$/m` (stacked quantifiers over overlapping alphabets) —
// same avoidance the sibling pr-checks pin tests document.
function cacheKeyLine(text) {
  return text.split('\n').find((l) => l.trimStart().startsWith('key:')) ?? '';
}

describe('SHY-0226: start-firebase-emulators pins the firebase-tools version', () => {
  let actionText;

  beforeAll(() => {
    actionText = fs.readFileSync(ACTION_PATH, 'utf8');
  });

  test('install line pins an exact firebase-tools@<semver>', () => {
    expect(actionText).toMatch(PINNED_INSTALL_RE);
  });

  test('no unpinned firebase-tools install remains', () => {
    expect(actionText).not.toMatch(UNPINNED_INSTALL_RE);
  });

  test('emulator cache key embeds the pinned version (stale-JAR guard)', () => {
    const version = PINNED_INSTALL_RE.exec(actionText)?.[1];
    expect(version).toBeDefined();
    expect(cacheKeyLine(actionText)).toContain(version);
  });
});
