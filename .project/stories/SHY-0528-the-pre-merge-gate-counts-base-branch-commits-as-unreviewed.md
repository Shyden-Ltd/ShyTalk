---
id: SHY-0528
status: In Review
owner: unassigned
created: 2026-09-06
priority: P2
effort: XS
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0528: The pre-merge gate counts base-branch commits as unreviewed

## User Story

As **a maintainer recording what happened to a finished story**, I want the
pre-merge gate to judge only the commits my pull request actually adds, so
that appending a note to a merged story does not force me to bump its review
marker over code that was reviewed before it merged.

## Why

Gate 3 of `scripts/pre-merge-check.sh` walks `git rev-list "${marker}..HEAD"`
and refuses any commit in that range that touches a path outside
`NEUTRAL_RE`. `HEAD` is the branch tip, so the range contains **every commit
on the base branch since the marker**, not only the commits the PR
introduces.

PR #2166 (2026-09-06) is the plain case: a docs-only branch cut from
`develop`, whose entire diff is one commit under `.project/`. Gate 3 listed
ten "unreviewed" commits, of which nine were already on `develop` — including
`7e8902c0d12` (SHY-0500's own implementation, reviewed across sixteen rounds
before it merged) and six `chore(board): sync board-items.json id-map`
commits written by the story-sync workflow.

The only ways out today are both wrong:

- bump the marker of a merged story to a `develop` commit, asserting a review
  that this PR did not perform — the marker-laundering that
  `reference-pre-merge-check-refuses-unreviewed-commits-after-the-marker`
  exists to prevent; or
- never write a story's outcome into its own Notes, leaving the record only
  in a handover document.

A branch that merges `develop` mid-flight hits the same false positive, which
is how several markers have already been bumped over other stories' code.

The second half of the same refusal is `NEUTRAL_RE='^\.project/stories/.*\.md$'`:
a handover under `.project/handoff/` and the generated `.project/board-items.json`
are project-tracking documents, not code, yet each makes its commit count as
unreviewed work.

## Acceptance Criteria

### Happy path

- [ ] Gate 3 considers only commits the branch adds — `git rev-list
      "${marker}..HEAD" "^${BASE_REF}"` — so a commit already on the base
      branch is never reported as unreviewed.
- [ ] A pull request whose only change is a note on a merged story passes the
      gate without its marker being bumped.
- [ ] Every project-tracking document is review-neutral: `NEUTRAL_RE` matches
      `.md` and `.json` under `.project/`, covering stories, the index, epics,
      handovers and `board-items.json`.

### Error paths

- [ ] A commit on the branch after the marker that touches code is still
      refused, naming the commit, with today's message.
- [ ] A code file under `.project/` (`.sh`, `.js`, anything but `.md`/`.json`)
      is still gated, so the broader neutral rule cannot hide a script.
- [ ] An unreachable or placeholder `Reviewed-up-to` sha still fails closed.

### Edge cases

- [ ] A branch that has merged the base branch in passes when its own commits
      are reviewed, and still fails when they are not.
- [ ] `BASE_REF` remains configurable and defaults to `origin/main`; a missing
      base ref fails loudly rather than exempting every commit.
- [ ] A multi-story pull request is judged against every marker, as today.

### Performance

- [ ] Unchanged: one extra revision-walk exclusion, no additional git calls.

### Security

- [ ] Unchanged: the gate neither relaxes what counts as code nor trusts a
      marker it cannot resolve to a real commit.

### UX

- [ ] The refusal keeps naming each offending commit, so the reader still
      knows what to re-review.

### i18n

- [ ] Not applicable: a maintainer-facing shell gate with no user-visible copy.

### Observability

- [ ] The OK line still prints every marker it checked, so a reader can see
      which reviews the verdict rests on.

## BDD Scenarios

**Scenario: A note on a finished story is not treated as unreviewed work**

- **Given** a story whose work was reviewed and merged some time ago
- **When** a maintainer opens a pull request that only adds a note to it
- **Then** the pre-merge gate accepts the pull request and still reports the
  reviews its verdict rests on

**Scenario: Work that has never been reviewed is still stopped**

- **Given** a branch carrying a change written after its story was last reviewed
- **When** the maintainer runs the pre-merge gate
- **Then** the gate refuses the pull request and names that change

## Test Plan

- Unit (`express-api/tests/scripts/pre-merge-check.test.js`, real temp repos,
  no mocks): a base branch that advances with a code commit after the marker
  while the branch adds only a story note — passes (red today, listing the
  base commit); an unreviewed code commit on the branch itself — still
  refused; a handover under `.project/handoff/` after the marker — passes; a
  `.project/tools/*.sh` after the marker — still refused; a branch that has
  merged the base in — passes with its own commits reviewed.
- Regression: the existing SHY-0127 / SHY-0131 / SHY-0133 / SHY-0486 /
  SHY-0518 cases stay green.
- Live: `BASE_REF=origin/develop scripts/pre-merge-check.sh 2166
  --skip-ci-check` reaches OK without any marker being bumped.

## Out of Scope

- Gate 1 (`scripts/check-pr-story-status.js`), which CI runs and which holds
  no marker logic.
- Judging conflict resolutions made inside a merge commit: `git diff-tree`
  already reports no paths for a merge, so merges are invisible to Gate 3
  today and stay so — noted here, not changed.

## Dependencies

- None. `scripts/pre-merge-check.sh` is the only holder of the marker walk
  (swept 2026-09-06: no other script or workflow reads `Reviewed-up-to`).

## Risks & Mitigations

- **Risk:** excluding the base ref hides a commit that is on the base branch
  but genuinely unreviewed. **Mitigation:** anything on `develop` passed this
  same gate to get there; the gate's job is the PR in front of it.
- **Risk:** the broader neutral rule exempts a future script under
  `.project/`. **Mitigation:** the rule matches `.md`/`.json` only, pinned by
  a test that keeps a `.project/**/*.sh` gated.

## Definition of Done

- [ ] Tests above red before the fix and green after.
- [ ] `scripts/pre-merge-check.sh` updated; shellcheck, ESLint and Prettier clean.
- [ ] PR #2166 passes the gate with no marker bumped.
- [ ] Story `In Review` with a `Reviewed-up-to` marker; index row updated.

## Notes

- 2026-09-06 15:30 WIB — **Filed** from the PR #2166 refusal: ten unreviewed
  commits reported, nine of them already on `develop`.

- 2026-09-06 15:45 WIB — PR opened into develop. **Inline review round 1** over
  `origin/develop..6ac5d541095`: one finding — the fail-closed BASE_REF check
  had been inserted between the `name-status` comment and the `STATUS_LINES`
  assignment it documents, orphaning the comment; lifted above the comment in
  `d23f0d59c7d` (the same orphaning caught on SHY-0527 round 1). Nothing else:
  the range exclusion, the widened neutral rule and the fail-closed check each
  carry a test that fails without them. Five cases red before the fix, green
  after; the two "still refused" pins (branch code after the marker, a `.sh`
  under `.project/`) green throughout. 45 green across both gate suites;
  shellcheck, ESLint and Prettier clean. Live: the fixed gate clears PR #2166
  with **no marker bumped**, still reporting `40cae39372b a36e06bbd5c`.

Reviewed-up-to: d23f0d59c7d
