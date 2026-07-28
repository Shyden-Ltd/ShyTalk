---
id: SHY-0249
status: In Progress
owner: claude
created: 2026-07-29
priority: P1
effort: S
type: bug
roadmap_ids: []
---

# SHY-0249: An admin reviewing a suspension appeal cannot see who is appealing, or why they were suspended

## User Story

**As** a ShyTalk moderator deciding whether to reinstate a suspended account,
**I want** the appeal to show me who submitted it and the reports that led to the suspension,
**So that** I can make the decision on the evidence rather than on the appellant's own account of it.

## Why

The Appeals tab already has the interface for this. `public/admin/js/tabs/appeals.js` renders a
profile block (display name, unique ID, avatar), a suspension block (reason, start, end), and a
collapsible **"Reports & Evidence (N)"** disclosure listing each report's reason, reporter, date,
description, reported message text, evidence images and admin notes.

None of it works for a real appeal. Two independent defects, both on the read path:

**Defect A — the reports are never sent.** `GET /api/appeals` (`reports.js:1415`) enriches each
appeal with user data and nothing else. The panel reads `appeal.reports || []`, which is always
empty, so the entire "Reports & Evidence" section — roughly 40 lines of rendering — has never
displayed for anybody. The evidence an admin needs is in `reports` in Firestore, one query away,
and no query is made.

**Defect B — the appellant is never identified.** The appeal document written when a real user
appeals (`users.js:924`) stores the account as `uniqueId`. The read path looks for
`a.userId ?? a.user_id`. Neither matches, so `uid` is `undefined`, the user lookup is skipped, and
`userUniqueId`, `displayName`, `suspensionReason`, `suspensionStartDate` and `suspensionEndDate`
all come back `null`. The admin sees an unattributed block of appeal text.

Defect B survived because the test fixture writes the field the reader wants
(`test-helpers.js:269` sets `userId`) rather than the field the product writes. Every appeals test
passes against a document shape that only the tests create. That is why this needs a contract test,
not another per-case test.

The combination is what makes this P1 rather than cosmetic: on a minors-facing service, a
suspension is usually a safety action, and the appeal is the one place it gets reviewed. Right now
that review happens with the appellant unnamed and the evidence invisible. The likely outcome of an
appeal an admin cannot evaluate is that a correctly-suspended account gets reinstated.

## Acceptance Criteria

### Happy path

- [ ] `GET /api/appeals` returns each appeal with a `reports` array containing the reports filed
      against the appealing account, newest first.
- [ ] Each entry carries the fields the panel renders: `reason`, `status`, `resolvedAction`,
      `description`, `timestamp`, `reporterUniqueId`, `reporterName`, `type`, `messageText`,
      `evidenceUrls`, `adminNote`.
- [ ] An appeal written by the real user-facing endpoint resolves to its account, so
      `userUniqueId`, `displayName` and the three suspension fields are populated.
- [ ] The Appeals tab shows "Reports & Evidence (N)" for an appellant who has reports, and expands
      to list them.

### Error paths

- [ ] An appeal whose account no longer exists returns `reports: []` and null user fields rather
      than failing the whole request — one broken appeal must not blank the queue.
- [ ] A failure fetching reports for one appeal leaves the other appeals intact.
- [ ] `GET /api/appeals` still requires an admin; a non-admin caller gets the existing rejection and
      no appeal data.

### Edge cases

- [ ] An appellant with no reports gets `reports: []`, and the panel omits the disclosure entirely
      rather than rendering "Reports & Evidence (0)".
- [ ] Appeals are resolved by `uniqueId` OR the legacy `userId`/`user_id` spellings, so documents
      written before this fix still resolve.
- [ ] An appellant with more than 20 reports has the list capped, with the newest kept.

### Performance

- [ ] Report lookup is one query per appeal, issued concurrently across the page of appeals — the
      endpoint already caps at 100 appeals, and must not become 100 sequential round-trips.
- [ ] `GET /api/appeals` for 100 appeals stays within the same order of magnitude as today's
      user-enrichment-only cost.

### Security

- [ ] Reports are exposed on the admin endpoint only; no user-facing route gains report visibility.
- [ ] Reporter identity is already visible to admins in the Reports tab, so this adds no new
      disclosure — but it must not leak the reporter's email or auth uid, neither of which the
      panel renders.

### i18n

- [ ] N/A — the Appeals tab is an internal admin surface and is English-only by existing
      convention; this story adds no new user-facing strings.

### UX

- [ ] The disclosure is collapsed by default so a long report list does not push the decision
      buttons off-screen.
- [ ] The count in the summary matches the number of items listed.

### Observability

- [ ] A failure to load reports for an appeal logs at warn with the appeal id, and does not throw.
- [ ] The existing `GET /api/appeals` error log keeps its shape.

## BDD Scenarios

**Scenario: An admin sees the evidence behind a suspension**

- **Given** a suspended account with two reports filed against it
- **And** that account has submitted a suspension appeal
- **When** the admin opens the Appeals tab
- **Then** the appeal shows the account's display name and unique ID
- **And** a "Reports & Evidence (2)" section is present
- **And** expanding it lists both reports with their reasons and reporters

**Scenario: An appeal submitted through the app is attributed to its account**

- **Given** a user submits an appeal through the real suspension-appeal endpoint
- **When** the admin lists appeals
- **Then** the appeal resolves to that account
- **And** the display name, unique ID and suspension reason are populated, not null

**Scenario: An appellant with a clean record**

- **Given** an appealing account with no reports against it
- **When** the admin opens the Appeals tab
- **Then** the appeal renders without a "Reports & Evidence" section
- **And** no error is shown

**Scenario: One unresolvable appeal does not take down the queue**

- **Given** three appeals, one of which references an account that has been deleted
- **When** the admin lists appeals
- **Then** all three are returned
- **And** the orphaned one has null user fields and an empty reports array

## Test Plan

**Red first** — each fails against today's code:

- `express-api/tests/routes/appeals-evidence.test.js`
  - `every appeal carries the reports filed against the appellant` — fails: `reports` is undefined.
  - `an appeal written by the real endpoint resolves to its account` — writes via
    `POST /api/user/:uniqueId/appeal` then reads `GET /api/appeals`; fails: `userUniqueId` is null.
  - `an appellant with no reports gets an empty array, not undefined`
  - `a deleted appellant yields null user fields without failing the request`
  - `legacy userId-shaped appeal documents still resolve`
  - `reports come back newest-first and capped at 20`
- `express-api/tests/routes/appeals-fixture-contract.test.js`
  - `the appeal document the test fixture writes has the same shape the product writes` — this is
    the test that would have caught Defect B years ago, and is the reason the suite was green.
- `tests/web/admin-appeals.spec.ts`
  - `expanding related reports shows reason and reporter` — replaces the `test.skip(true, 'No
    related reports section in current appeals')` that treated a permanent product gap as a
    transient data condition.

**Green** — `GET /api/appeals` resolves the appellant across all three field spellings and joins
their reports concurrently; the fixture writes the production shape.

**Mutation proof** — reverting the report join must fail `appeals-evidence.test.js`; reverting the
`uniqueId` resolution must fail the real-endpoint test; changing the fixture back to `userId`-only
must fail the contract test.

## Out of Scope

- Redesigning the Appeals tab layout.
- Adding report evidence to any user-facing surface.
- Changing how suspensions or appeals are decided, or adding an appeal SLA.
- Backfilling historical appeal documents to a single field spelling — the read path accepts all
  three instead, which is cheaper and cannot fail halfway.

## Dependencies

- None. `reports` and `suspensionAppeals` both already exist and are already swept by test teardown
  (`express-api/src/utils/test-collections.js`).

## Risks & Mitigations

- **Risk:** one extra Firestore query per appeal, up to 100 per request, could be slow or burn
  free-tier quota. **Mitigation:** the queries are issued concurrently and each is capped at 20
  documents; the endpoint's existing 100-appeal limit bounds the total. Covered by the Performance
  AC.
- **Risk:** accepting three field spellings hides which one is canonical and invites a fourth.
  **Mitigation:** resolution goes through one named helper, and the fixture-contract test pins the
  production shape so new writes cannot drift again.
- **Risk:** a partial failure could blank the appeals queue. **Mitigation:** per-appeal failures are
  caught and degrade to `reports: []` with a warn log; covered by an Error-paths AC.

## Definition of Done

- [ ] All RED tests above written first and observed failing.
- [ ] Both defects fixed; every listed test green.
- [ ] Mutation-proven — each fix, reverted individually, fails a named test.
- [ ] Full `express-api` Jest suite green.
- [ ] `admin-appeals.spec.ts` green with zero skipped tests.
- [ ] LOCAL gauntlet green on real Android + real iPhone + all browsers.
- [ ] `code-reviewer` 100% clean.
- [ ] CI green by name: Detect Changes, Analyze JavaScript, PR Gate.
- [ ] Status flipped to In Review before merge.

## Notes

**2026-07-29** — Found while eradicating silent-skip guards under SHY-0245. The appeals test carried
`test.skip(true, 'No related reports section in current appeals')`, phrased as though the data were
merely absent that day. It is not absent — the section has never rendered for anyone. Investigating
why turned up Defect B alongside it: the test fixture writes `userId`, production writes `uniqueId`,
and the reader wants `userId`, so the entire appeals suite has been green against a document shape
only the tests produce.

This is the second time in this session that a guard turned out to be covering a locator or field
that does not exist in the product (`[data-remove]` in `admin-users-extra.spec.ts` was the first).
The pattern is worth naming: a conditional in a test is very often a fossilised bug report.
