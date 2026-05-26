/**
 * Public legal-versions endpoint.
 *
 * GET /api/legal/versions -> { privacy, terms, community }
 *
 * Returns the current numeric version of each legal document. Public:
 * the sign-up screen needs these versions BEFORE the user authenticates
 * to know which version they're accepting. The user-side acceptance
 * record (usersAcceptedPolicies/<uid>) stores the version-at-acceptance
 * so a returning user whose accepted version is < current is gated
 * through a re-acceptance flow (see j03 lapsed-returning journey).
 *
 * Versions are hardcoded here rather than stored in Firestore because:
 *   - they bump infrequently (legal review cadence, not user-driven)
 *   - admin UI for editing them would create regulatory risk (any
 *     accidental edit would silently flip every active user into the
 *     re-acceptance flow)
 *   - the source-of-truth document content lives in the website repo,
 *     and this endpoint is the integration-side numeric mirror that
 *     the app + admin tooling key off
 *
 * Future: if the legal team needs per-region versioning, this returns
 * the region as a hint and the response shape grows to per-region keys.
 */

const router = require('express').Router();

// UK OSA #17 PR 2 — privacy version bumped to 4 when the cohort-
// segregation language was added (May 2026). Terms + community
// unchanged; bump on next legal-review cycle.
const LEGAL_VERSIONS = Object.freeze({
  privacy: 4,
  terms: 1,
  community: 1,
});

router.get('/legal/versions', (_req, res) => {
  res.json(LEGAL_VERSIONS);
});

module.exports = router;
module.exports.LEGAL_VERSIONS = LEGAL_VERSIONS;
