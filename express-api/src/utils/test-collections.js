/**
 * The two collection lists the dev-only test-helper routes are built from.
 *
 * They live here, apart from `routes/test-helpers.js`, because the invariant
 * that binds them — every collection a test can WRITE must also be one
 * teardown can REMOVE — is worth asserting on its own, and importing the route
 * module drags in the Firebase Admin SDK (which `process.exit(1)`s without
 * emulator env). A plain constants module keeps that check honest and cheap.
 */

/**
 * Collections `/api/test/write/:collection` will accept.
 *
 * Anything here is reachable by a test, so anything here MUST also be
 * reachable by teardown — either through `SWEPT_BY_TEST_RUN` below or through
 * one of the bespoke sweeps in `deleteTestData` (users by `_testRun`,
 * deviceBindings/deviceBans/networkBans by their owning uniqueId). A
 * collection that is writeable but unswept leaks into shared state and skews
 * later assertions; `test-helpers-teardown-coverage.test.js` pins that.
 */
const WRITEABLE_COLLECTIONS = [
  'users',
  'rooms',
  'gifts',
  'conversations',
  'banners',
  'funFacts',
  'reports',
  'suspensionAppeals',
  'alerts',
  'suggestions',
  'ageVerificationSubmissions',
  // Phase 3 PR F (integration test #10): seed real coinPackages
  // docs so /api/economy/purchase can match a productId during
  // tests. Teardown sweeps these via the `_testRun` field
  // (deleteTestData → SWEPT_BY_TEST_RUN list).
  'coinPackages',
  // Allow tests that DELETE a device binding to re-seed it after
  // verifying deletion, so worker-scoped shared state is restored
  // for subsequent test files (per
  // [[feedback-test-isolation-no-leaks]]: never leak state between
  // tests). admin-maintenance.spec.ts:58 was the first caller.
  'deviceBindings',
  // SHY-0149: the web anti-abuse specs must seed a REAL ban and prove
  // the server-side gate refuses a banned user — a route-mocked ban
  // would prove nothing (§ No Stubs). Teardown sweeps both by
  // linkedUniqueId (see deleteTestData).
  'deviceBans',
  'networkBans',
  // SHY-0245: the admin log-filter specs guarded every assertion on
  // `if (rowCount > 0)`, so whenever the logs table happened to be empty —
  // a fresh emulator, a throttled logger, a tripped circuit breaker — the
  // filter under test went unverified and the spec still reported green.
  // Seeding a real `logs` document removes the "happened to be".
  'logs',
  // SHY-0245: the admin audit-log specs skipped themselves whenever the table
  // was empty ("No entries"), so CSV export and row structure went unverified.
  // Audit rows are written as a side effect of admin ACTIONS, which makes them
  // impossible to arrange deterministically without seeding.
  'adminAuditLog',
  // SHY-0245: the identity-graph specs need a graph of a KNOWN shape. The graph
  // is a stored document whose `nodes` array the creation endpoint never
  // writes, so neither seeding deviceBindings nor calling the API can produce
  // one — the 50-node and multi-account tests skipped themselves instead.
  'identityGraphs',
];

/**
 * Collections `deleteTestData` sweeps by matching the `_testRun` field.
 *
 * `users`, `deviceBindings`, `deviceBans` and `networkBans` are absent on
 * purpose — they are swept earlier by uniqueId-linked queries, not by a plain
 * `_testRun` scan. `reportLocks` is swept here but is not writeable; it is
 * created as a side effect of the report routes.
 */
const SWEPT_BY_TEST_RUN = [
  'gifts',
  'rooms',
  'banners',
  'funFacts',
  'conversations',
  'reports',
  'suspensionAppeals',
  'alerts',
  'reportLocks',
  // Phase 3 PR F: integration tests seed coinPackages tagged with
  // `_testRun` for /api/economy/purchase tests. Without this entry
  // tested packages would persist across runs and pollute later
  // queries on `coinPackages`.
  'coinPackages',
  // SHY-0245: `suggestions` was writeable via /api/test/write but never
  // swept, so every seeded suggestion leaked onto the public board and
  // skewed count/sort/pagination assertions in unrelated specs.
  'suggestions',
  // Same gap, same fix — the admin age-verification specs seed these.
  'ageVerificationSubmissions',
  // Seeded by the admin log-filter specs (see WRITEABLE_COLLECTIONS above).
  // Unswept, every seeded row would accumulate in the shared logs table and
  // skew the very row-count assertions the seeding exists to make reliable.
  'logs',
  // Same reasoning for seeded audit rows.
  'adminAuditLog',
  // And for seeded identity graphs.
  'identityGraphs',
];

/**
 * Collections removed by a bespoke query in `deleteTestData` rather than by
 * the generic `_testRun` scan — `users` by `_testRun` directly, the rest by
 * the uniqueId of the users being removed.
 */
const SWEPT_BY_BESPOKE_QUERY = ['users', 'deviceBindings', 'deviceBans', 'networkBans'];

module.exports = { WRITEABLE_COLLECTIONS, SWEPT_BY_TEST_RUN, SWEPT_BY_BESPOKE_QUERY };
