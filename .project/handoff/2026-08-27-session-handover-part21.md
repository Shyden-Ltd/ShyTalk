# Session handover — part 21

**2026-08-27.** The session that took **v0.98.0 → v0.99.0**: 333 commits,
106 stories, promoted to `main` and released.

---

## What shipped

| | |
|---|---|
| **Released** | **v0.99.0** — versionCode 178, tag `v0.99.0` |
| Promotion | #2033, merge commit, 333 commits / 106 stories |
| Epics touched | EPIC-0004, EPIC-0006, EPIC-0011, EPIC-0012 |
| **Dependabot** | **19 open alerts → 0**, verified after the merge |

### Release gate, as actually walked

- Journey matrix, **real OnePlus** (`3b402284`): **15/15**, walked twice — once
  before and once after the SHY-0473 refactor, because a proven command stops
  being proven when you change it.
- Android instrumentation, real device: **103/103 executed**.
- Express suite: **514 suites, 15,645 tests**.
- Dev environment: deployed from develop; sanity check and the credentialed
  Playwright smoke suite green.
- Promotion CI: **28/28 jobs**.

---

## The promotion was blocked four times. Each was a real defect.

**None of them were flakes**, and none would have been found without promoting.

### 1. develop was three commits BEHIND main (#2032)

Since the v0.98.0 release: develop at 176/0.97.15, main at 177/0.98.0. The
release bumped the version on main and was never merged back down. Promoting
would have **regressed the shipped version**, because a promotion carries
develop's `build.gradle.kts` with it.

Synced as a **merge commit**, not a squash — a squash replays the content with no
ancestry, so the same three commits would have been re-presented as conflicts on
the next promotion.

**The sync-down after v0.99.0 was done immediately (#2043), not left for later.**

### 2. Eight Android E2E failures — SHY-0474

`android-e2e` runs **only on PRs whose base is `main`** (`pr-checks.yml`), so it
is a *promotion* gate, not a per-story gate. All 106 stories' PRs were green
while the suite had been broken for months.

Five causes, found by fixing the first three:

1. `AgeVerificationSubmitViewModel` missing from `TestKoinModule` — and once
   registered, its `AgeVerificationRepository` was missing too.
2. The resource-count pin, moved 838 → 884 deliberately.
3. **Instrumentation tests were never signed in.** `SharedNavGraph` reads
   `resolvedUniqueId`; the fake defaults it to null, so the user-flags listener
   never subscribed and `ownCohort` stayed `minor` — invisible until SHY-0459
   hid the messages tab and wallet from minors.
4. The cohort has **two readers**: the messages tab asks the nav graph's
   `ownCohort`, the wallet asks `user.cohort` on the profile document.
5. `FakeUserRepository` is a singleton `ResetFakesRule` never reset.

Signing every test in wholesale broke ten passing tests, so the shipped design is
**opt-in** (`cohort: String? = null`).

### 3. WebKit Sign In test raced the header — SHY-0476

Failed on **both** WebKit projects, passed locally in 7.3s. It waited for the
modal hook (registered by `suggestions-board.js`) then clicked a button injected
by `shared-header.js`. Two scripts, neither implying the other. Mutation-tested:
breaking the hook still fails the test, so the added wait masks nothing.

### 4. The board-sync bot's ci-skip marker — SHY-0477

The sidecar commit carried a ci-skip marker. GitHub honours it on the **head
commit for `pull_request` events**, so the moment it landed on develop the
promotion PR had **zero check runs** and main's three required checks could never
report: `BLOCKED`, `mergeable: MERGEABLE`, nothing failing to point at. It
stranded #2033 eleven minutes after a fully green 28/28 run.

A test **pinned the marker in place** ("retains…"). Reversed with evidence: of
four workflows with a `push:` trigger, none but the sync itself reaches develop,
and it is paths-filtered. The marker fired nothing and cost a release.

**And it cannot be quoted:** the commit fixing it put the literal marker in its
subject and skipped its own CI.

---

## Also shipped

- **SHY-0473** — a `--target dev` journey run asserted against `localhost:3000`
  while the phone talked to dev. It did not fail; with a local stack up it
  **passed**. Now target-derived, and a dev run without credentials refuses
  (exit 2) before anything is installed.
- **SHY-0475** (Draft) — `RoomBrowsingTest`/`RoomCreationTest` fail on a real
  OnePlus and pass on CI's emulator. Pre-existing on clean develop. The product
  is fine: the journey matrix walks rooms on that phone, 15/15.
- **SHY-0478** (Draft) — see below.

---

## ⚠️ Merging a promotion PR DELETES develop

`deleteBranchOnMerge = true`, and a promotion PR's head branch **is develop**. It
was deleted at the moment the release succeeded, with no warning.

**Restoring it is not a push** — develop's ruleset requires three checks a new
branch cannot have. Recreate the ref at its previous head:

```
gh api repos/O/R/git/refs -X POST \
  -f ref='refs/heads/develop' -f sha="$(git rev-parse <last-develop-head>)"
```

Use the **full 40-char sha** (an abbreviation returns `422 Object does not
exist`). If the SHA was not written down, it is the promotion merge commit's
**second parent**: `git rev-list --parents -n1 <merge>`.

Filed as **SHY-0478** (Draft): promote from a disposable `release/x.y.z` branch
so develop is never a PR head. Turning the repo setting off would also work but
is wider than the problem — an operator call.

---

## State at handover

| | |
|---|---|
| `main` | `7080cf12dca` — **chore: release v0.99.0** |
| `develop` | `edc0cd15369` — synced, **0 behind main**, version 178/0.99.0 |
| Open PRs | none |
| Open Dependabot alerts | **0** |
| Dev environment | deploy dispatched from develop after the sync-down |

## Recovered continuity

Handovers **16–20** were stranded on `story/SHY-0458-conversations-read-path-via-api`,
an unmerged branch whose content was split into per-story PRs. They are restored
to develop with this one, so the chain is unbroken.

## Open, for the operator

- **SHY-0475** — room instrumentation tests on real hardware.
- **SHY-0478** — promotion head branch.
- **SHY-0470 / SHY-0471** — still Draft, awaiting decisions.
- **EPIC-0004** (boot/login) is next on the board.
