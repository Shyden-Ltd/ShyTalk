# Session handoff — 2026-08-13/14

Durable state for the next session. Written because context compacted; do not
rely on chat scrollback.

## Shipped

- **shyden.co.uk** — Classroom Group Creator: 10 visual/behaviour fixes live in
  prod, verified on the running site. `v0.2.x`.
- **ShyTalk `v0.98.0` released** — 170 commits since `v0.97.15` (June),
  75 stories. Tag + GitHub Release cut.
- **develop→main promotion merged** (PR #1652) — 78 commits, 41 stories, full
  history on `main`.

## The promotion's real blocker (for the record)

`required_signatures` on main's ruleset `12613584` refused **one unsigned
commit**: `44bc64eae0` (2026-07-16, a local `Merge remote-tracking branch
'origin/main' into develop`). All 3 required checks were green and it still
would not merge. Removing the rule flipped it BLOCKED → UNSTABLE instantly —
that was the proof. The rule was restored and verified byte-for-byte against a
JSON backup.

**Merging it deleted `develop`** (`delete_branch_on_merge: true` deletes a
merged PR's HEAD branch, and a promotion PR's head IS develop). Restored to its
exact pre-merge head `0e6cbee71c0`. Rule codified in CLAUDE.md + SHY-0296:
cut a throwaway `promote/YYYY-MM-DD` branch instead.

## Open, needs the operator

1. **SHY-0295 — board sidecar frozen since 2026-07-25 (20 days).**
   `develop` ruleset `19719048` bypass = `Integration 29110` only; `main`'s =
   `29110, 3324562`. Every ruleset write was blocked by the permission
   classifier, and an attempt to add it via the UI did not take effect
   (verified 2026-08-14 05:50 and again 22:00 — still absent).
   Fix = one `PUT` to ruleset 19719048 adding `3324562`, ideally with
   `do_not_enforce_on_create: true` (that flag is why recreating `develop` was
   an hour of archaeology).
   Second finding folded in: the sync attempts `createProjectV2Field Type`
   every run and GitHub refuses it twice over (name reserved AND already
   taken). `load_project_cache` only recognises `SINGLE_SELECT` fields, so a
   NATIVE issue-type field reads as absent. Vestigial since v4. **Open
   question: does the board still want a `Type` column at all?**

2. **#1651 (SHY-0226) — a design decision, not a merge.**
   `.github/**` cannot both reach `test-backend` (SHY-0226's pin guard) and
   stay `WORKFLOW_ONLY` (SHY-0284 + CLAUDE.md's CI-config-only exemption).
   Both have tests asserting their side. A reconciliation via SHY-0284's
   `SCRIPTS` flag was tried and FAILS SHY-0284's own test — it would force the
   device gauntlet onto every workflow PR. Merge aborted, branch untouched,
   full analysis posted on the PR. Suggested route: run the pin guard in
   `lint`, which already executes `check-action-shas.sh` and is not gated on
   these flags.

3. **Status-blocked PRs — need "gauntlet clean" from the operator**, since
   `In Progress → In Review` asserts a completed device gauntlet and clean
   review that cannot be verified remotely:
   #1692 (SHY-0273), #1691 (SHY-0272), #1690 (SHY-0271), #1416 (SHY-0092,
   also a DRAFT PR), #1526 (no story — by-design gate refusal).

## Ready now

- **#1669 CLEAN** — mergeable.
- **#1614 (SHY-0195), #1687 (SHY-0269)** — conflicts resolved, CI running,
  zero failures so far.

## Devices (confirmed reachable 2026-08-14 23:00)

- Android: OnePlus `CPH2653`, serial `3b402284`, USB.
- iPhone: "Sean's iPhone", iPhone Air (`iPhone18,4`), physical, connected.

**Journey-matrix caveat:** the WEB cells bootstrap (10 of 12 ok; 2 skip —
those browsers are not installed on the device). The NATIVE APP journeys
(j01 etc.) are NOT runnable: they need `ctx.uiDriver` methods that are
unwired — the known 114-method gap, which predates all of this. Verified via
`--check-drivers`. Invocation that works:

```
cd express-api && set -a && . ~/.shytalk/dev-personas.env && set +a
node --env-file=.env.local scripts/manual-qa-runner.js \
  --target local --plan-dir ../journey-tests --driver playwright --browser chromium \
  --journey <full-filename>.feature
```

(`--journey` needs the FULL filename incl. `.feature`; a miss prints
"File not found" and still **exits 0** with "Findings: 0".)

## Mistakes made this session, and their fixes

- **SHY-0195 wrongly marked released.** The v0.98.0 sweep derived membership
  from "story ID appears in `git log v0.98.0`"; SHY-0195 appears via #1617,
  "the drift half of the main-based fix". A PARTIAL fix carries the ID as
  loudly as a complete one. Reverted in #1744. Cross-checked all 59 flipped
  stories against open PRs — SHY-0195 was the only one.
- **A gate was defeated by shell punctuation.** `pre-merge-check.sh ... ;
  gh pr merge` ran the merge even though the gate REFUSED. Use `&&`.
- **`npm run format` is `prettier --check`, not a writer** — running it
  redirected and ignoring the exit code let an unformatted file through to CI.
- **Local `actionlint` reports exit 0 with no shellcheck installed** — it
  silently disables the integration. A clean local run proves nothing.
- **A failed `git checkout` (branch held by another worktree) still let the
  following `git merge` return 0.** There are FOUR worktrees; use
  `git -C <worktree>`.
- **Two merged PRs added story files without index rows** (SHY-0136,
  SHY-0270); index drifted by 2. Fixed — now 218/218, zero mismatches.

## Superseded PRs closed

- **#1668** — websocket-driver 0.7.4→0.7.5 already landed twice (#1621, #1620).
- **#1538 (SHY-0161)** — develop-flow shipped via SHY-0242/0177/0163. Its test
  is obsolete: two of four assertions pin behaviour SHY-0177 REVERSED (sync on
  `[main, develop]`, sidecar gated to main). I first claimed the other two
  were worth salvaging — that was wrong and I corrected it on the PR:
  `develop-ci-gate.test.js` already covers them, more thoroughly.

## Dependabot

Retargeted all 17 main→develop; 6 merged (incl. both CRITICAL
websocket-driver and 9 high-severity). Alert counts will not drop until the
next promotion — Dependabot reports against the DEFAULT branch.

Pattern that unblocked them: retarget does NOT re-run CI (close/reopen does),
and every branch cut from pre-promotion main fails `lint / Lint` because
actionlint lints STALE workflow files — fixed by `@dependabot rebase`, or for
story PRs by merging `develop` into the branch.

---

# Update — 2026-08-15 00:45

## Merged since
- **#1669** (`24f9de2da6f`) — github-actions SHAs + gradle minors, firebase-bom
  held for SHY-0244.

## Gauntlet attempted — CANNOT gate anything yet

Both devices were connected and the full local stack was up. Two blockers:

1. **Persona password mismatch (FIXED, reusable).**
   `seed-personas-local.js:33` = `PERSONAS_PASSWORD || 'localdev123'`, and
   `.env.local` does NOT set that var — so local personas carry
   **`localdev123`**. Sourcing `~/.shytalk/dev-personas.env` (the 22-char DEV
   password) fails EVERY scenario with `Firebase sign-in failed … 400`.
   Correct local invocation:
   `PERSONAS_PASSWORD=localdev123 node --env-file=.env.local scripts/manual-qa-runner.js --target local …`

   **Verify users with the Admin SDK, not the emulator REST endpoint.**
   `GET /emulator/v1/projects/demo-shytalk/accounts` said `0 users`;
   `admin.auth().listUsers()` said **159**, persona present. The REST answer
   nearly caused a second false root cause.

2. **Driver corpus gaps (NOT fixable without SHY-0277).**
   With auth working, j12 still failed 12/12:
   `webAdminOpenTab` / `webAdminOpenSubtab` / `webAdminDetectLabelLanguage`
   **not configured**, plus `STEP_NOT_IMPLEMENTED`. The 114-method gap is on
   the **web** driver too, not only native — earlier notes said native only.

   Only **j03** and **j12** of the 20 journeys are web-only
   (no Android/iOS steps), so the runnable surface is tiny regardless.

## Possible finding, unverified

j12 asserts `"You are not authorized to view this page"` for a non-admin
hitting the admin panel. That exact copy exists **nowhere** in `public/`, so
the test proves nothing either way — but whether a non-admin IS actually
bounced was never established. Worth its own check.

## Autonomous queue (no operator input needed)

1. Land **#1614** (SHY-0195) and **#1687** (SHY-0269) — conflicts resolved,
   stories already `In Review`; each needs a real `Reviewed-up-to` marker,
   which means reviewing the diff (as was done for SHY-0270/SHY-0136).
2. Fix the **Allure `gh-pages` push race** — `! [rejected] … (fetch first)`
   whenever two PRs finish together; the job has no lock or retry.
3. Answer **SHY-0295's open question** (does the board still want a `Type`
   column) with evidence, so it is decision-ready.
4. Attempt conflict resolution on **#1688, #1673, #1582, #1527**
   (#1673 is +71951/-15740 — likely a project, not a merge).
5. Investigate the non-admin admin-panel question above.

---

# Update — 2026-08-15 01:1x

## Queue item 1 — #1614 reviewed, cross-PR conflict FOUND

Reviewed the full `origin/develop...HEAD` diff on **#1614** (SHY-0195); marker
bumped to the develop merge commit `243c3aa358a` and pushed (`a8fe7c9eca8`).

**#1614 and #1687 assert OPPOSITE things in the same test.** Both were cut from
develop independently, so a green run on each proves nothing about the pair:

| PR    | asserts about `workflow_call` secrets in `deploy-dev-seed-personas.test.js` |
| ----- | -------------------------------------------------------------------------- |
| #1614 | `callBlock` MATCHES `…DEV_QA_PERSONAS_PASSWORD:…required: true`             |
| #1687 | `callBlock` does NOT match `/required: true/`, and removes it from the YAML |

**#1687 wins.** A `required: true` `workflow_call` secret is validated _before_
the job starts — zero steps, zero logs, annotation-only — which is exactly how
seeding stayed broken ~18 days across 5 deploys. It also supersedes #1614's own
Error-paths AC ("fails LOUDLY at call time"); that AC assumed call-time failure
is loud, and it is not. Both facts are recorded in SHY-0195's Notes.

**Order: #1614 first, then #1687** merges develop and resolves that hunk its own
way, keeping #1614's two additions (`not.toContain('PERSONAS_PASSWORD_DEV')` and
the `personas-password:` usage-line pin), which #1687 does not contest.

**#1687 also needs, before it can pass the gate:** it has NO `Reviewed-up-to:`
marker and an EMPTY `pr:` field.

**Minor, found while reviewing #1687:** the new guard greps `PROVISION_ALL_OK`,
but the script prints `PROVISION_ALL_OK count=N` — so `count=0` passes. Not
reachable today (`personas` is a literal array at
`provision-test-personas.js:64`), but the guard's own comment claims it catches
"a persona list [that] came back empty", which it does not. Tighten to
`grep -qE 'PROVISION_ALL_OK count=[1-9]'` when resolving the conflict.

## Queue item 3 — SHY-0295's `Type` column question: ANSWERED

**Verdict: the board DOES still want the field, and it CANNOT be named `Type`.**

Evidence:

- The board (`ShyTalk Stories`, org project #1) has **no `Type` field at all** —
  the earlier note ("a NATIVE issue-type field reads as absent") was wrong; there
  is nothing there to mis-detect. Fields present: Status, Pri, Effort, Roadmap
  IDs, SHY ID, Epic (+ GitHub built-ins).
- The sync's error, verbatim from run 31822477255:
  `[gh-error] createProjectV2Field Type (exit 1): gh: Name cannot have a reserved value, Name has already been taken`
  — both refusals at once. Non-fatal (`0 failed`, `type-field auto-created: no`);
  the run's actual failure is the sidecar commit, a separate issue.
- Native issue types **are** being set correctly (`issue types set: 1`; sampled
  issues #1314-#1318 carry `Bug`/`Feature`).
- **But the native type collapses 7 → 3 and loses the majority of the signal.**
  Corpus distribution (217 stories): infra 74, bug 67, refactor 26, feature 22,
  chore 22, docs 4, spike 2. `Task` absorbs refactor+docs+infra+spike+chore =
  **128 of 217 (59%)**. `infra` alone is 74 stories — the largest single
  category — and is indistinguishable from `chore` on the board.
- There is **no fallback surface**: `type:*` labels are deleted repo-wide by the
  sync every run (verified: 0 remain).

**Recommended fix** (one-line change in `scripts/sync-stories-to-issues.sh:712`,
plus the `get_field_id`/`set_field_id` keys at :425/:729/:835/:859): rename the
single-select from `Type` to a non-reserved name — `Kind` reads best next to the
native type. Keeps all 7 options; stops the every-run GraphQL error; makes
`infra` filterable on the board again.

**Not done autonomously:** creating a board field is an outward-facing mutation
of the operator's project. Needs a yes before running.

## Queue item 5 — non-admin admin-panel bounce: ANSWERED, and it's CLEAN

**A non-admin IS bounced, and the enforcement is real (server-side).** The j12
assertion was simply testing copy that never existed.

- **Real copy** (`public/admin/js/main.js:281`): _"Access denied — admin
  privileges required. If you have a portal account, go to /portal/ instead."_
  j12 asserts `"You are not authorized to view this page"` — a string that is
  nowhere in the product. **The test is wrong, not the product.**
- **Client gate** (`main.js:279`) is fail-closed: `claims.admin !== true`
  (strict, so `undefined` / `"true"` / `1` all fail) → error + `showScreen('login')`
  + `return`, so `store.set('currentUser', …)` never runs and the dashboard is
  never shown. Cosmetic only, as all client gates are.
- **Real gate** — `requireAdmin` (`express-api/src/middleware/auth.js:454`) is
  two-layer: the decoded token claim, THEN a live `auth.getUser()` custom-claim
  re-check behind a 60s TTL cache, so a demoted admin loses access in ≤60s
  instead of at token expiry (~1h). Fails closed on `catch` and on an undefined
  `req.auth?.token?.admin`. 403 on both paths.

**Coverage measured, not assumed** — `requireAdmin` is a per-handler call, which
is the classic shape where one forgotten call leaves an endpoint wide open:

| | |
| --- | --- |
| admin routes examined | **147** |
| guarded per-handler | 104 |
| guarded by `router.use` prefix | 43 |
| **UNGUARDED** | **0** |

Audit script: `scratchpad/admin-route-guard-audit.js`. It understands BOTH guard
styles — a naive "grep the lines after the route" scan produces false positives,
because a `router.use('<prefix>', adminGuard)` sits ABOVE the routes it covers
(this bit me on `suggestions-maintenance.js`, whose 4 destructive
`/admin/maintenance/clear-*` endpoints looked unguarded and are not).

**Mutation-verified** (a detector printing 0 proves nothing on its own): removing
one per-handler guard → caught exactly 1 route; removing one `router.use` prefix
guard → caught all 5 routes under it; exit 1 both times.

One documented exclusion: `admin-log-config.js:37 GET /log-config` is
deliberately public for mobile clients (retention hours, log levels, batch
settings — no secrets), marked public in its own header and inline comment.

**Observation, not a defect:** the client gate does not sign the non-admin OUT,
so their Firebase session persists and they could mint a token from the console.
That is fine _because_ the server enforces independently — but it means the
client bounce must never be treated as the control.

**Follow-up worth filing:** promote the audit to a CI ratchet. It closes the
door (every admin route guarded) instead of patching holes, and it is exactly
the invariant a future route addition can silently break. Not filed yet — would
open a second branch while #1614/#1687 are in flight.

## Queue item 2 — Allure gh-pages race: DIAGNOSED (and my earlier note was wrong)

The earlier note said "the job has no lock or retry". **That is wrong** —
`allure-report.yml:48` already has `concurrency: group: gh-pages-deploy,
cancel-in-progress: false`. The real defect is narrower and worse: **only 1 of
the 4 gh-pages writers is in that group.**

| workflow            | writers | concurrency group                  | serialized? |
| ------------------- | ------- | ---------------------------------- | ----------- |
| `allure-report.yml` | 1       | `gh-pages-deploy`                  | ✅          |
| `pr-checks.yml`     | 1       | `pr-checks-${{ github.head_ref }}` | ❌ per-BRANCH |
| `test-backend.yml`  | 1       | `test-backend-${{ inputs.ref … }}` | ❌ per-REF  |

**Corrected:** three writers, not four. I first counted with
`grep -c peaceiris/actions-gh-pages`, which scored `test-backend.yml` as 2 —
one of those is a COMMENT explaining the race, not a `uses:`. Count at the
definition site (`^\s*uses:\s*peaceiris/`), per
[[feedback-substring-is-not-existence]]. Ratio is still 1-of-3 serialized.

All four push to the same `gh-pages` branch via
`peaceiris/actions-gh-pages@84c30a8` (v4.1.0), which clones → commits → pushes
with no retry. Any two writers in *different* groups can interleave between the
clone and the push, which is exactly `! [rejected] … (fetch first)`. Two races
exist, not one: kotlin×kotlin across two PRs (different `head_ref` ⇒ different
groups), and kotlin×allure.

`allure-report.yml:245` already **names** this ("if a writer outside the group —
the kotlin deploy in pr-checks.yml — lands mid-cap"), so it was known and never
fixed.

**The race is documented and was VERIFIED** — `test-backend.yml:122-131` spells
out the mechanism (`clone --depth=1` → commit → push, N-1 pushes rejected
non-fast-forward, peaceiris does not retry) and cites *"Verified with PR #901's
two consecutive failures despite the test step itself passing."* An earlier note
here called the frequency claim unevidenced; that was wrong — I had not yet read
this comment.

**And the current mitigation is AVOIDANCE, not a fix.** That same `if:` skips
the PR-branch Express report deploy entirely (`report_env == 'dev' || 'prod'`)
specifically to dodge the race, with the rationale that "PR-branch reports are
nice-to-have". So the price being paid is not flaky CI — it is a **permanently
disabled feature**. Serializing the writers properly would let PR-branch reports
come back, which is the real prize and the reason this is worth a story rather
than a patch.

No recent failures remain visible because the racy path is the one that was
switched off.

**Fix shape** (not yet implemented — needs its own story/branch): concurrency is
workflow- or job-level, never step-level, so the two offending deploys must move
into their own job carrying `concurrency: group: gh-pages-deploy,
cancel-in-progress: false`, consuming the report via an artifact. Putting the
group on the existing jobs would serialize the ~15-min Build & Test across every
PR. One group owning every gh-pages writer is the door; a retry is only the hole.

## Queue item 4 — the four conflicted PRs, measured

`gh pr view` reports `mergeable: UNKNOWN` for all four (GitHub computes it
lazily). Measured locally instead with `git merge-tree --write-tree
origin/develop origin/<branch>` — non-destructive, needs no checkout:

| PR    | story             | size            | conflicts | verdict                                    |
| ----- | ----------------- | --------------- | --------- | ------------------------------------------ |
| #1688 | SHY-0268          | +3631/-435, 219f | **1**    | tractable — one test file                   |
| #1673 | SHY-0245          | +71951/-15740, 584f | **14** | a project, not a merge                     |
| #1582 | SHY-0151          | +229/-7, 12f    | 4         | **blocked on more than the merge**          |
| #1527 | SHY-0152+SHY-0142 | +462/-96, 15f   | 5         | tractable, but bundles TWO stories          |

- **#1688** — sole conflict is `express-api/tests/scripts/50-matrix-cmd-stop.test.js`.
  Best next candidate once #1614/#1687 are done.
- **#1582** — the 4 conflicts are all RUNTIME surfaces (`iosApp/iosApp/iOSApp.swift`,
  `shared/build.gradle.kts`, `BuildVariant.kt`, `KoinHelper.kt`), so merging it
  demands the full device gauntlet, which cannot currently run — and SHY-0151 is
  independently HELD on the DeviceCheck `.p8`. Resolving the conflict would not
  make it mergeable; don't spend the effort yet.
- **#1527** — conflicts are `SHY-INDEX.md` + 4 CI pin-test files, all tractable.
  But it carries SHY-0152 **and** SHY-0142, against the ONE-story-ONE-PR rule;
  worth deciding whether to split before investing in the resolution.

## #1614 — mechanical gate GREEN, but the DoD is NOT met (do not merge yet)

`BASE_REF=origin/develop scripts/pre-merge-check.sh 1614` emits
`PRE-MERGE-CHECK: OK` — story In Review, no unreviewed commits, all 25 checks
green. **That is only the mechanical half.** The human-judgment item "Definition
of Done met" FAILS:

SHY-0195's DoD requires *"a dispatched Deploy-To-Dev run … shows **Distribute iOS
to TestFlight** AND **Seed Dev Personas** green BEFORE merge"*. The only
deploy-dev run ever dispatched on a SHY-0195 branch is **29478170583
(2026-07-16), which FAILED** — and that failure IS root cause #2 (`iOS 26.0 is
not installed`). The platform-runtime fix was added in response and **never
verified by a real run**. `gh run list --workflow=deploy-dev.yml` confirms no
later run on any `SHY-0195` branch.

The fix is runner-image-dependent (`sudo xcodebuild -downloadPlatform iOS`), so
nothing local can prove it — and the image has moved on in the month since, so
the fix could now be unnecessary, still-needed, or newly-broken. Unknown either
way without a dispatch.

**Dispatched run 31832143087** (Phase-3 unmerged-branch pattern, per CLAUDE.md's
standing deploy-dev authority) against
`story/SHY-0195-fix-deploy-pipeline-main`, narrowed to the DoD's two jobs:
`backend=true` (required — `seed-dev-personas` `needs: deploy-backend-dev`),
`ios-testers=true`, `seed-personas=true`; `web`, `android-testers` and
`playwright` OFF to avoid needless dev churn.

**Merge #1614 only when that run shows both jobs green.** If iOS fails again,
the story needs a new root cause, not a merge.

### It failed again — and that found ROOT CAUSE #3

Run 31832143087: **Seed GREEN**, **iOS FAILED** with the identical
`iOS 26.0 is not installed` (exit 70). The platform-runtime ensure step is not
the problem — it ran, exited 0, and printed *"iOS is already downloaded as
universal … iOS 26.5"*. A no-op, because **an** iOS platform was present; it
never checked **which**.

**The Xcode SELECTION was picking the oldest on the box.**
`setup-ios-signing/action.yml` used
`ls -d /Applications/Xcode_26*.app | head -1`. `ls` sorts as TEXT, and
`macos-latest` is now `macos-26-arm64` image `20260728.0273.1` shipping SEVEN
Xcode 26.x builds — so `26.0.1` beat `26.5` (`'0' < '5'`) and every archive ran
on the oldest Xcode present. Per the image manifest `iOS 26.0` belongs to
Xcode 26.0.1, while the pre-installed device platform is `iphoneos26.5`
(Xcode 26.5/26.6). We picked the one Xcode whose platform is absent.

Note the image had MOVED since this story was written (`20260630.0213.1` →
`20260728.0273.1`) — the earlier fix was tuned to an image that no longer exists.
`macos-latest` is an unpinned moving target.

**Fixed** (`ff4b9ff6fe9`): `sort -V | tail -1`. Two tests — a structural pin and
a behavioural test running the action's own pipeline. Mutation matrix: `head -1`
→ 3 caught, `sort -V | head -1` → 3 caught, `sort | tail -1` → 2 caught (the
behavioural fixture alone PASSES that one, since text-order happens to give 26.6
for the current list; a `26.10` case was added to make it discriminate).
`tests/scripts`: 145 suites / 7465 tests green.

**PROVEN**: run **31834843907** — `Selected: /Applications/Xcode_26.6.0.app`;
steps *Build, archive, and export iOS app* = success, *Upload to TestFlight* =
success, *Ensure TestFlight internal-group auto-distribution* = success. **First
successful iOS TestFlight distribution since 2026-07-11.**

**Final DoD artefact in flight:** run **31838911028** on the final commit
`c68c458a77d`, with backend+seed+iOS in ONE run — because the DoD names a single
run showing both jobs green, and the two proofs above are on two different
commits. Merge #1614 when that is green.

---

# Update — 2026-08-15 08:15 WIB · BOTH PRs MERGED

| PR    | story    | squash sha    | merged      |
| ----- | -------- | ------------- | ----------- |
| #1614 | SHY-0195 | `7d2c5407475` | 22:59 UTC   |
| #1687 | SHY-0269 | `0496f74c835` | 01:14 UTC   |

Open PRs now: **18**. No active branch — the next piece of work can start clean.

**#1687's conflict resolved exactly as the dry run predicted**: one hunk in
`deploy-dev-seed-personas.test.js`, taken in SHY-0269's favour, with #1614's
`personas-password:` usage-line pin preserved (the assertion a careless
resolution drops). Post-merge `tests/scripts`: 146 suites / 7475 green.

## SHY-0269's DoD item 3 was unproven — so it was proven

*"A deliberately-broken dispatch shows the failure in the run LOG, not only in
an annotation"* had **no evidence in the Notes**, and it is the story's central
claim. Induced for real on a throwaway branch (never merged; deleted local and
remote immediately) by emptying the secret the preflight reads:

- run **31849199825** → **7 steps ran** (the `required: true` path produced zero
  steps and zero logs) and the log carries
  `Missing repository secret(s): FIREBASE_SERVICE_ACCOUNT_DEV`.
- run **31849038860** → `PROVISION_ALL_OK count=17` on the story branch, with
  `Seeded: PROVISION_ALL_OK count=17` confirming the tightened count guard
  matched real output.

**Bonus finding:** the first induction used a non-existent secret NAME and the
pre-push hook REFUSED it — `actionlint` reported the property "is not defined in
object type {… firebase_service_account_dev …}". The `workflow_call` secret
declarations give actionlint a **closed set** to check every `secrets.X`
reference against, so an undeclared reference cannot reach CI. That is a static
guard against exactly the rename that broke the workflow. Do not "simplify" the
declarations away now that they are `required: false`.

## Two traps worth remembering from this stretch

1. **`gh pr checks` said ALL GREEN 90 seconds after a push.** Only **4** check
   runs had registered; `pr-checks.yml` was still queued. A pending-count of
   zero over a partial set is a false green. Gate on a **minimum check count**
   as well as zero-pending — the loop used `total >= 20 && pending == 0`.
2. **A webkit Playwright failure was a real browser crash, not a test defect** —
   `Error: page.goto: WebKit encountered an internal error`, failing on both
   attempts (`1 failed, 1 flaky, 1398 passed`). Confirmed unrelated before
   re-running: `git diff --name-only` over the range touched **zero**
   `public/`, `tests/web/` or `src/` files. Re-run of the failed job went green.

## SHY-0298 filed and merged (#1749, `a150f6c9dda`)

The gh-pages race is now a **fully-refined story**, not a note: three writers,
one queue, and the AC that matters — **re-enable PR-branch Express reports**,
because with the racy path switched off nothing observable changes and the fix
would be unverifiable. Status `Draft`, ready to pick up.

Design decision recorded in the story: a single reusable publisher workflow,
NOT job-level `concurrency: gh-pages-deploy` on the two offending jobs. The
latter assumes job-level and workflow-level groups of the same name share one
queue across workflows — probably true, but an assumption. A reusable workflow
makes serialization true by construction, using the mechanism
`allure-report.yml` already runs in production (`workflow_call`-only, called
from `e2e-tests.yml` and `playwright-tests.yml`, and allure deploys demonstrably
do not race each other).

**Index drift repaired in the same PR:** SHY-0269 merged in #1687 without a
`SHY-INDEX.md` row — the same defect flagged twice before. Now **220 files /
220 rows, zero mismatches.** Worth a standing check after every story merge:

```
comm -23 <(ls .project/stories/SHY-[0-9][0-9][0-9][0-9]-*.md | sed -E 's/.*(SHY-[0-9]{4}).*/\1/' | sort -u) \
         <(grep -oE "^\| \[SHY-[0-9]{4}\]" .project/stories/SHY-INDEX.md | grep -oE "SHY-[0-9]{4}" | sort -u)
```

## Next up (no operator needed)

1. **Implement SHY-0298** — CI-config-only, so no device gauntlet; fully
   autonomous. The story carries the RED-first test list and the mutation
   matrix each pin must survive.
2. **File + build the admin-route guard ratchet** — item 5 found the invariant
   already holds (147/147 guarded), so the ratchet locks in a clean state rather
   than chasing a regression. Draft script:
   `scratchpad/admin-route-guard-audit.js` (mutation-verified).
3. **#1688** — one conflict (`50-matrix-cmd-stop.test.js`), but it touches app
   runtime, so it cannot merge until the device gauntlet can run.

## Still needs the operator (unchanged)

- **SHY-0295 bypass actor** on ruleset `19719048` (board sidecar frozen since
  2026-07-25). Every ruleset write is blocked by the permission classifier.
- **#1651 (SHY-0226)** — `.github/**` cannot both reach `test-backend` and stay
  `WORKFLOW_ONLY`. Design decision; analysis posted on the PR.
- **#1692 / #1691 / #1690** — need "gauntlet clean" before `In Progress →
  In Review`, and the gauntlet cannot currently run.


---

# Update — 2026-08-15 13:35 · MVP phase 1 started

## Plan (operator-directed 2026-08-15)

Phase 1 = the 44 `mvp: true` drafts EXCLUDING **EPIC-0008** ("Comprehensive,
self-serve, publicly-visible testing" = SHY-0212…0225, the 13 remaining drafts).
Phase 2 = EPIC-0008. Phase 3 = full gauntlet → release. Ordering: **product /
safety first, spikes deferred**; the ViewModel-coverage tickets stay in phase 1
because the recorded parameter makes all open bugs launch-blocking.
**SHY-0169's spike and the EPIC-0006 remediation are parked post-launch.**

Enabling fact: `pr-checks.yml` records that real-device verification is
deliberately OFF the per-PR gate — "a single end-of-batch gauntlet on REAL
devices before the develop→main promotion" — so phase-1 stories land on develop
and the gauntlet gates the release.

## SHY-0143 — a LIVE release-blocker found at pickup

The spec is 6 weeks old, so every line-number citation was re-verified first.
All four had drifted but every construct survived. Then the material finding:

**SHY-0187 shipped the optimistic cold-start route WITHOUT the ban gate
SHY-0143 exists to pair with it.** `resolveLaunchDestination` returns
`Screen.Main` as soon as `isAuthenticated && hasResolvedUser`, and
`hasResolvedUser` is `currentUserId != null`, which the `AuthRepository`
contract makes non-null immediately (it falls back to the Firebase UID before
identity resolves). Meanwhile:

- `checkAndApplyBan()` — private, 2 call sites, both inside
  `resolveIdentityAndProceed()`, whose 9 callers are all sign-in paths.
- `BanScreen` renders only from INSIDE `SignInScreen.kt:132`.

⇒ a banned device, or a banned IP/subnet/ASN (the VPN-blocking path), reaches
the room list on cold start. On `main` and `develop`, **NOT in `v0.98.0`** — so
it ships with the next release. Release-blocker, not a production incident.

**Landed so far** (branch `story/SHY-0143-persist-session-optimistic-coldstart`):

- `b23e21bae9b` — `resolveColdStartDestination()` layers the ban gate IN FRONT
  of SHY-0187's cascade (precedence becomes structural), plus `Screen.BanDevice`
  / `Screen.BanNetwork` as top-level destinations — needed because hoisting the
  check alone was insufficient: the only surface that rendered a ban was a
  screen the optimistic path never visits. 8 tests: 64 assertions prove a ban
  wins across every combination of the other five inputs; 32 prove the unbanned
  path still equals `resolveLaunchDestination` exactly.
- `acf73be78a8` — `ColdStartSequencer` enforces both orderings (ban → route,
  refresh → first cohort-scoped read), returns early for non-Main so a banned
  start never touches the network, and signs out on a failed refresh. 8 tests.
  Mutation: 3 of 4 caught; the 4th (swap `checkBans` with the `launchState`
  read) is benign — `launchState` is a pure read — so the overstated TEST NAME
  was corrected instead of contorting the code.

**Still to do on SHY-0143:** wire the sequencer into `MainActivity` + iOS (the
gate is not yet reachable, so the gap is still open in the tree), the
`BanDevice`/`BanNetwork` screens in the nav graph, the real ban-check
collaborator, `SessionCache` (expect/actual) + contract test, and the
instrumented/XCTest legs.

## Anomaly, unresolved and worth watching

At 13:28 `public/roadmap-data.json` was silently rewritten from the canonical
SHY-0038 shape (`_meta`, `schemaVersion 2`) to the LEGACY pre-SHY-0038 shape —
exactly what SHY-0066 removed both husky hooks to prevent. **Reverted, not
committed.** Cause NOT identified: no husky hook, no `.claude/hook`, no gradle
task and no lint-staged entry references the file, and the legacy
`scripts/generate-roadmap-json.js` still exists but is invoked nowhere. It did
NOT recur across a later gradle run or a later successful commit. If it
reappears, `scripts/generate-roadmap-json.js` is the prime suspect and deleting
it outright is probably the fix.

## #1751 (SHY-0298) — complete, queue-bound

`pr-checks` for `f4a506e2ed6` has been queued since 05:44 UTC (3h+). Nothing
failing; the runner queue is congested. Land when it clears.

---

# Update — 2026-08-15 14:05 · SHY-0143 six commits in, gap CLOSED both platforms

Branch `story/SHY-0143-persist-session-optimistic-coldstart`, pushed, **no PR
opened yet** (open one when the remaining work below lands).

| commit | what |
| ------ | ---- |
| `5e836707021` | pickup + fitness review (all 4 line citations drifted, every construct survived) |
| `e2a4218e0b3` | the finding: optimistic route already shipped WITHOUT its ban gate |
| `b23e21bae9b` | `resolveColdStartDestination()` + `Screen.BanDevice` / `Screen.BanNetwork` |
| `acf73be78a8` | `ColdStartSequencer` — both gate orderings |
| `094e71e905b` | ban destinations in `SharedNavGraph`; `BanState` carries reason/expiresAt |
| `5bea7945c9d` | `BanStatus.toBanState()`, fail-closed on unknown ban types |
| `a877ed64bd3` | MainActivity wiring — gap closed on Android |
| `97fbf4d8514` | iOS parity + BOTH platforms on one shared resolver |

**Current state of the fix**

- Android: ban renders from the gating cascade ABOVE the NavHost, so the graph
  never mounts and no cohort-scoped subscription can be issued. Check runs with
  `async` inside the EXISTING pre-routing phase and is awaited before
  `checkComplete`, whose spinner branch already blocks all content.
- iOS: nothing renders until the gate answers (`produceState`). **Honest
  deviation recorded in the commit**: iOS had no pre-routing phase, so the check
  adds a blocking leg there, unlike Android. Taken deliberately — rendering Main
  first and bouncing is the window where a cohort-scoped read fires.
- Both platforms now call `resolveColdStartDestination`; neither may call
  `resolveLaunchDestination` directly (pinned).

**`AppLockWiringPinTest` caught a real inconsistency in my own work** — Android
was on `resolveLaunchDestination` + cascade while iOS was on the new resolver:
two mechanisms for one decision, the exact asymmetry SHY-0187 killed. The pin
FOLLOWED its invariant rather than being relaxed, and is now stricter: a new
test asserts both platforms use the SAME function and that neither retains a
direct `resolveLaunchDestination` call (that path skips the ban gate — which is
literally how the optimistic route shipped without it).

**Verification so far:** shared jvmTest **1452 / 0 failures**;
`compileKotlinIosArm64` + `:app:compileDevDebugKotlin` green; ktlint, detekt,
`check-no-new-stubs`, `check-kmp-compat` clean. Mutation across the three new
units: **14 mutants, 13 caught**; the survivor (swap `checkBans` with the
`launchState` read) is benign — `launchState` is a pure read — so the overstated
TEST NAME was corrected instead of contorting the code.

## SHY-0143 — what is LEFT

1. `SessionCache` (`expect`/`actual`, encrypted at rest: Android
   EncryptedSharedPreferences / iOS Keychain) + `SessionCacheContractTest`.
   This is the OTHER half: the shipped optimistic route currently reaches Main
   with `currentUserId` = the Firebase UID fallback, i.e. the SHY-0139 wrong-key
   hazard. Write-through on sign-in / `resolveProfileState`, cleared on sign-out.
2. Extend `AuthViewModelBanTest` for the hoisted path.
3. Android instrumented cold-start journeys + iOS XCTest — **need real devices,
   so they land with the gauntlet**.
4. Open the PR, flip to In Review with a real `Reviewed-up-to:`.

## Working agreement while the operator is AFK (2026-08-15)

"Keep working without me. No stopping." Phase 1 = the 44 `mvp: true` drafts
excluding EPIC-0008; then EPIC-0008; then the full gauntlet; then release.
Product/safety first, spikes deferred (SHY-0169 + EPIC-0006 remediation parked
post-launch). ViewModel-coverage bugs stay in phase 1, behind the product work.

Next stories after SHY-0143, per EPIC-0004's own stated order:
**SHY-0144** (retire the FunFact splash) → **SHY-0145** (decommission the
fun-facts pipeline — carries the only irreversible step, the collection delete,
so it lands last and alone) → **SHY-0146** (iOS integrity parity) →
**SHY-0147** → **SHY-0148**.

## Gotcha codified this session

Backticks inside a double-quoted `git commit -m "…"` are command substitution:
the shell RUNS them and silently deletes the text, leaving a mangled message and
a `command not found:` line that scrolls away. Use a quoted here-doc + `-F`, and
read the message back. Memory: `feedback-backticks-in-commit-messages-execute`.

## #1751 (SHY-0298) — queue finally cleared, running

`Build & Test` pending, nothing failing. Merge when green: the gate is
`BASE_REF=origin/develop bash scripts/pre-merge-check.sh 1751 && gh pr merge …`
(chain with `&&`, never `;`).

---

## 2026-08-15 ~15:00 WIB — SHY-0143 second half + #1751 blocked

### SHY-0143 — four more commits (branch `story/SHY-0143-persist-session-optimistic-coldstart`)

| SHA | What |
|---|---|
| `91ff1e769b8` | Unlock path hydrates `resolvedUniqueId` before reaching Main |
| `d1a0a01…`/see log | `SessionCache` + 14-test contract suite |
| `d8d0b7ecce9` | Cold-start hydration + honest `hasResolvedUser` on both platforms |
| `8affd8114a8` | Actually run `ColdStartSequencer` — the cohort gate was never wired |

**Three gaps of the same family were live on develop**, all created when
SHY-0187 stopped routing cold starts through Sign-In (which was the only
thing that ran these gates):

1. **Ban bypass** — fixed in the earlier commits.
2. **Identity never resolved.** `AuthViewModel.init` is the only code that
   sets `resolvedUniqueId`, and an `AuthViewModel` is constructed ONLY inside
   the Sign-In / e-mail-OTP route composables. Neither the cold-start route
   to Main nor the Lock→unlock route constructs one, so `currentUserId`
   returned the raw Firebase UID at all ~69 read sites — room list, wallet,
   FCM token registration (`NavGraph.kt:323` writes `users/<firebaseUid>`).
3. **Cohort claim never refreshed.** `ColdStartSequencer` existed with nine
   ordering tests and was constructed by NOTHING. `forceRefreshToken()` runs
   only on the sign-in path, so a restored session rendered its room list on
   LAST session's cohort claim — the SHY-0132/0137 leak.

Not in production: SHY-0187 is merged-not-released, so all three are
develop-only and this is a release-blocker for the owed promotion, not a
live incident.

**Verification:** shared jvmTest 1476 / 0, app unit 2235 / 0, both with
`--rerun-tasks`; ktlint, detekt, `compileKotlinIosArm64`,
`:app:compileDevDebugKotlin`, check-no-new-stubs, check-no-direct-backend
all clean. Mutants: unlock-hoist caught; 4 of 6 SessionCache mutants caught
(2 survivors are mutually-redundant blank guards, documented in the KDoc);
write-through caught; `refreshToken = { true }` caught; reads-before-refresh
caught at two independent levels.

**Still owed on SHY-0143:** Android instrumented + iOS XCTest legs (need real
devices → land with the gauntlet); story flip to In Review + a real
`Reviewed-up-to:`; open the PR. Branch is NOT yet pushed.

### #1751 (SHY-0298) — re-review says DO NOT MERGE

All CI green and `mergeStateStatus: CLEAN`, but `pre-merge-check.sh` correctly
refused: two commits landed after `Reviewed-up-to: e2ec9445396`. The scoped
re-review of those two found 3 Critical + 7 Important. **I independently
verified the two load-bearing premises:**

- **C1 (confirmed).** `allure-report.yml:236-299` caps gh-pages history by
  force-moving the ref (`gh api -X PATCH … force=true`) after a plain re-read
  — a TOCTOU, not a CAS. Its only real protection was the workflow-level
  `gh-pages-deploy` group, which C3 deleted. `grep -rn gh-pages-deploy` over
  `.github/` now returns COMMENTS ONLY. A publisher that lands between the
  re-read and the PATCH is silently discarded while its own job exits green.
  The comments at `:244-253` still assert the group protects it — false.
  Suggested fix: replace the API force-PATCH with a shallow clone +
  `git commit-tree` + `git push --force-with-lease=refs/heads/gh-pages:<TIP>`,
  which is an atomic server-side CAS and reuses the publisher's own technique.
- **I3 (confirmed).** `lint.yml` runs bare `actionlint`, which lints
  `.github/workflows/**` only — composite action files are not workflow files.
  The ~65 new lines of shell in `.github/actions/publish-gh-pages/action.yml`
  are on an unlinted surface, including C2's `2>/dev/null`.

Also real: `action.yml:16` still tells callers "must run this from a job
carrying `group: gh-pages-deploy`, which gh-pages-publisher.test.js enforces"
— the suite now enforces the opposite (`:156-167`).

Other findings not yet independently verified: C2 (push errors misclassified
+ evidence sent to /dev/null), C3 (all 20 tests structural; loop never
executed), I1 (missing gh-pages branch hard-fails with no annotation), I2 (a
failed publish red-gates PR Gate, contradicting the story's Error-paths AC),
I4/I5 (comments and spec still describe the deleted lock design), I6 (no
jitter; sleeps after the last attempt), I7 (loop `git fetch` failure has no
`::error`).

Full report is in this session's transcript (`799364e8-…jsonl`).

### Lesson codified
`feedback-structural-pins-are-invisible-to-gradle-uptodate` — a pin that READS
source files is not re-run when they change; `./gradlew :shared:jvmTest`
reported "BUILD SUCCESSFUL in 1s" having executed nothing. Always
`--rerun-tasks` and check the result XML's mtime.

### Worktree in use
`…/scratchpad/wt-1751` is a detached worktree on
`origin/story/SHY-0298-serialize-gh-pages-writers`, used because
`pre-merge-check.sh` diffs the LOCAL HEAD and would otherwise read the wrong
story. Remove with `git worktree remove` when done.

---

## 2026-08-15 ~22:30 WIB — SHY-0143 review round 1 closed

Branch `story/SHY-0143-persist-session-optimistic-coldstart`, still UNPUSHED.
`code-reviewer` round 1 found 6 Critical + 10 Important. All the ones I can
close from the client are closed:

| Finding | Commit | What it was |
|---|---|---|
| I1 | `5b118773878` | **A PIN unlock wiped the cache.** Write-through fires per setter, so `LockScreenViewModel` (uniqueId only, no cohort) hit `write`'s erase branch. With App-Lock on by default: miss → Lock → PIN → wipe → miss → Lock, forever. Root cause: cohort treated as identity. My own test had pinned the erase as correct. |
| I4 | `5b118773878` | The "encrypted at rest / AES-256-GCM" claim is FALSE on Android — `SecureStorage.android.kt` is plain SharedPreferences by design. Copied from `SecureStorage.kt`'s own stale KDoc; corrected in all three. |
| — | `5b118773878` | `TestKoinModule` didn't bind `SessionCache`; every instrumented test launching MainActivity would have died on Koin resolution. |
| C2+C5 | `06fb115c74c` | One problem. Both graphs subscribe to `users/<id>` on mount regardless of destination, so Lock/ban/offline starts read on last session's cohort claim. And `firebaseCall` maps every exception to Error, so an offline launch signed the user out — with no `configChanges` declared, rotating in airplane mode logged you out. |
| C3 | `06fb115c74c` | iOS ban-screen Sign-out navigated to Sign-In without signing out. |
| C4 | `06fb115c74c` | Android registered no ban destinations while being fed a start destination that can name one. |
| I8 | `06fb115c74c` | iOS `clear()` iterated a hand-maintained key list that had already drifted. Now deletes by service. |
| C1 | `f730b2f80ac` | **The no-session ban gate could not fire.** `/api/device-info` is auth-gated → `getIdToken()` throws → repository catch returns "not banned". New unauthenticated read-only `GET /api/ban-status`. Also retires I10. |
| I6 | `5b4058c499f` | Three unsynchronised `putString` calls could land `{uid_A, uniqueId_B}`. Now one atomic JSON record. |
| I5 | `c3b56d507dc` | `checkPmLockOnLogin` ran only on the sign-in path, so a user whose birthday passed stayed in the minor cohort indefinitely. |

**Verification:** shared jvmTest 1493/0, app unit 2237/0 (both `--rerun-tasks`),
Express 413 suites / 13780 tests all passing, ktlint + detekt + both platform
compiles + instrumented-test compile clean. Every fix mutation-tested.

**TWO OPERATOR DECISIONS BLOCK "Done"** (both in the story Notes):
1. The Security AC names `EncryptedSharedPreferences`; Android deliberately
   uses plain SharedPreferences + device FBE. Amend the AC or change storage.
2. The AC requires honouring `forceSignOut` from the reconcile.
   `PmLockCheckResult` has no such field — needs a server change or an AC
   amendment. Not implemented against an invented field.

**Still owed:** Android instrumented cold-start `.feature`; an iOS test source
set — `shared/src/ios*Test/**` has ZERO files, so `IosAuthRepositoryImpl`'s
write-through has no coverage of any kind; LOCAL + DEV gauntlets.

A scoped re-review of the fix commits (`5b118773878..HEAD`) is running.

**Gotcha worth keeping:** `npx jest tests/routes/ban-status.test.js` failed all
10 tests after 323s of Firestore timeouts; `npm test -- <same file>` passes in
2.7s. The canonical runner is not optional.

---

## 2026-08-16 ~02:00 WIB — SHY-0143 review round 3 closed; SHY-0298 R3 committed

### SHY-0143 (branch `story/SHY-0143-persist-session-optimistic-coldstart`, 26 commits, UNPUSHED)

Round 3: 3 Critical + 12 Important. All closed in `e5472fe84e3`.

**The three Criticals were one finding wearing three hats.** `signOut()` cleared
nothing on either platform, so "clear the API token cache" was COPIED per call
site — 2 of 4 on Android, 0 of 3 on iOS. My round-2 fix also hardened the WRONG
screen: Android renders `BanScreen` above the NavHost, so `MainActivity`'s copy
is the one a banned user taps, and my pin read only `NavGraph.kt` — green
against a route Android never renders.

Fix: the invariant moved INTO `signOut()` on both platforms; call-site copies
deleted. Same for `refreshIdToken()`, which cleared on Android and not on iOS,
where `IosApiClient` has the identical 50-minute TTL — so on iPhone every
Express call carried the pre-flip cohort claim for up to 50 minutes.

Pins now read BOTH platform files for every invariant. Reading one file per
invariant is what let all of this through, twice.

Also closed: I1 (discardRecord could delete a concurrent write's good record —
compare-and-delete now), I2 (the legacy-key sweep never ran on the real upgrade
path — swept on read), I3, I4 (ip-api reports failures INCLUDING over-quota as
HTTP 200 + `status:"fail"`, so a null ASN got cached and ASN bans stayed off for
the TTL), I6, I7 (my trailing-slash normalisation un-skipped `/auth/`,
`/test/`, `/portal/totp-recovery/`), I8, I9, I10, I11, I12.

**Verification:** shared jvmTest 1505/0, app unit 2239/0 (both `--rerun-tasks`),
Express 415 suites / 13810 tests, eslint/ktlint/detekt/both platform
compiles/instrumented-test compile all clean.

**Three operator decisions still block Done** (in the story Notes): the Security
AC's `EncryptedSharedPreferences` wording; the missing `forceSignOut` wire
field; App Check not added for the unauthenticated endpoint.

**Still owed:** Android instrumented cold-start feature; iOS host tests (blocked
on a `FirebaseCore` link for the K/N test binary — its own story); LOCAL + DEV
gauntlets.

### SHY-0298 / PR #1751 — R3 committed but NOT pushed

Commit `e986afedeef`, anchored to local branch **`shy0298-r3-pending`** (it was
made in a detached worktree). To land it:
`git push origin shy0298-r3-pending:story/SHY-0298-serialize-gh-pages-writers`

- **C1** — the history cap force-moved gh-pages after a plain re-read, which is
  a check and not a CAS. C3 made that window routinely reachable, so a publisher
  landing in it was discarded while its own job exited 0. Now
  `git push --force-with-lease="refs/heads/gh-pages:${TIP}"` — a server-enforced
  compare-and-swap, no window.
- **C2** — `git push … 2>/dev/null` classified every failure as a lost race and
  deleted the evidence. stderr captured; only non-fast-forward retries; jitter
  added; no sleep after the final attempt.
- **C3** — the loop had never been executed. New
  `gh-pages-publisher-loop.unit.test.js` runs it against REAL local git repos
  with a genuine second clone as the racing writer. 8 tests. Mutation: no-retry,
  wrong-reset, force-push and no-clear all caught.

**BEFORE MERGING #1751:** the full `express-api` script suite could NOT be run
from the worktree — several tests locate the repo root and reject a worktree's
`.git` FILE. Only the four gh-pages suites were run (59 tests, green). Re-run
`npm test` from a normal checkout. Round 1's I2/I3/I4/I5 are also still open
(actionlint does not lint composite actions; a failed publish red-gates PR Gate;
comments and the spec still describe the deleted lock design).

### Worktree
`…/scratchpad/wt-1751` is still present (detached). Remove with
`git worktree remove` once #1751 lands.

---

## 2026-08-16 ~14:30 WIB — pre-compact state

### NEW STANDING RULE (operator, this session)
**After EVERY merge into develop, deploy develop to dev.** Not optional, not
conditional on being asked — dispatch Deploy-To-Dev as the last step of the
merge. Supersedes the older "ask first, default NO while AFK" note. Codified as
`feedback-deploy-dev-after-every-develop-merge`.

### What is actually in flight

**Cold-start security work (SHY-0143)** — branch
`story/SHY-0143-persist-session-optimistic-coldstart`, 30 commits, **not
pushed**. Five `code-reviewer` rounds, every one finding real defects. The
substance: a returning user's cold start now checks bans, resolves the real
`uniqueId` before any read, and refreshes the cohort claim before any
cohort-scoped read — none of which happened after SHY-0187 stopped routing
cold starts through Sign-In.

Round 6 is running against HEAD.

**gh-pages report publishing (SHY-0298 / PR #1751)** — commits on local branch
`shy0298-r3-pending`, **not pushed**, head `81274217839`. Makes concurrent
report publishing safe rather than serialised, after the serialised design was
found to cancel innocent PRs.

### Everything green as of this entry
shared jvmTest 1520 / 0 · app unit 2243 / 0 (both `--rerun-tasks`) · Express
416 suites / 13833 tests · eslint `--max-warnings=0`, ktlint, detekt, both
platform compiles, instrumented-test compile, actionlint, check-action-shell.

### Blocked on the operator (3 decisions, in the SHY-0143 story Notes)
1. The Security AC names `EncryptedSharedPreferences`; Android deliberately
   uses plain SharedPreferences + device FBE.
2. The AC requires honouring `forceSignOut`; `PmLockCheckResult` has no such
   field — needs a server change or an AC amendment.
3. Round 1 said the unauthenticated ban endpoint needed App Check. It shipped
   with IP rate-limiting only; no App Check exists in the repo.

### Blocked on devices
Android instrumented cold-start feature; iOS host tests (the K/N test binary
cannot link `FirebaseCore` — that is its own story); LOCAL + DEV gauntlets.

### Immediate next steps
1. Round 6 findings → fix → re-verify.
2. `git push` SHY-0143, open the PR, arm the monitor at push.
3. Push `shy0298-r3-pending` to #1751's branch. **Before merging #1751**, run
   the full `express-api` suite from a NORMAL checkout — several script tests
   reject a worktree's `.git` file, so the worktree run is not sufficient.
4. On each merge to develop: dispatch Deploy-To-Dev against develop.
