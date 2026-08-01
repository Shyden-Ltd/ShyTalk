/**
 * Which scenarios the automated runner must not attempt, and why.
 *
 * Two reasons exist, and conflating them is the mistake this module prevents:
 *
 *   @manual         — a HUMAN must verify it (hearing real audio, judging
 *                     perceived quality). The product may be perfect; the
 *                     harness simply cannot be the judge.
 *
 *   @unimplemented  — the PRODUCT does not have this feature yet. j16's event
 *                     host/team-leader flows and j17's teacher classroom
 *                     assert on `teamRoster`, `rosterParticipants` and
 *                     `teachingLanguages`; none exists anywhere in
 *                     express-api/src or shared/src, because neither feature
 *                     is built.
 *
 * Reported as ordinary failures, the second kind is indistinguishable from a
 * regression — so it trains the reader to ignore red, which is the most
 * expensive thing a suite can do. Naming it keeps the build gap visible AS a
 * build gap.
 *
 * The tag is never a way to quieten a failing test for a feature that DOES
 * exist. The skip records which tag caused it precisely so that misuse is
 * auditable, and a guard in tests/unit/unimplemented-feature-tag.unit.test.js
 * pins that no working journey carries it.
 */

/** Exact tag → the reason recorded on the skipped scenario. */
const SKIP_TAGS = [
  ['@manual', '@manual — requires interactive human verification; not runnable in auto mode'],
  [
    '@unimplemented',
    '@unimplemented — the feature under test is not built in the product yet, so there is nothing to exercise',
  ],
];

/**
 * @param {string[]} [tags] the scenario's tags, verbatim
 * @returns {{skip: boolean, reason: string|null, tag: string|null}}
 */
function shouldSkipScenario(tags) {
  const list = Array.isArray(tags) ? tags : [];
  for (const [tag, reason] of SKIP_TAGS) {
    // Exact membership, never substring: `@unimplementedish` is a typo, and a
    // substring match would let it disable a scenario silently and forever.
    if (list.includes(tag)) return { skip: true, reason, tag };
  }
  return { skip: false, reason: null, tag: null };
}

module.exports = { shouldSkipScenario, SKIP_TAGS };
