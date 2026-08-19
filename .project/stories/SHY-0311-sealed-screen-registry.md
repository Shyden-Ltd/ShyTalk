---
id: SHY-0311
status: Draft
owner: claude
created: 2026-08-17
priority: P1
effort: S
type: feature
roadmap_ids: []
epic: EPIC-0011
mvp: true
---

# SHY-0311: Five screens the server can never touch, held by a test rather than by good intentions

## User Story

As the **operator**, I want the screens that stop people — bans, App-Lock,
cohort segregation, unsafe-device, account deletion — to be unreachable from
any server manifest, so that a bad or hostile manifest push can never quietly
switch off enforcement.

## Why

Server-driven UI removes store review from the release path. That is the point
of EPIC-0011 and it is also its only real danger, and the danger is not evenly
spread.

**Almost every screen fails loudly.** A bad manifest wrecks the shop and users
see garbage and complain within the hour — then SDUI saves you again, because
the fix is another manifest push rather than another store review. Fast to
break, fast to fix, net win.

**Five screens fail silently, and always in the permissive direction.** Ask
what a banned user sees if a manifest bug removes the ban screen: a working
app. Nothing looks wrong. No crash, no error-rate spike, no support ticket —
and the one person who noticed is the last person who will report it. Cohort
segregation is worse: if it silently stops separating, adults and minors are in
the same voice rooms and the UI looks completely normal.

So the split is not important-vs-unimportant. It is **fails-visibly vs
fails-invisibly**, and only the second kind needs friction.

This lands **second in the epic, immediately after the schema**, because a
boundary added after its consumers exist is a boundary that has already been
crossed. And it is enforced by a **CI test rather than a convention**, because a
convention is a thing people remember until the night they do not.

**The sealed set is defence in depth, not the actual control.** A modified
client does not need to hide a gate — it simply never draws one. The real
control is server-side enforcement, audited in the design doc §6.2 and already
in place; its one gap is filed as SHY-0321. This story protects against *our
own bad push*, which is a different and more likely threat than a hacked
client.

## Acceptance Criteria

### Happy path

- [ ] `SealedScreen` enumerates exactly five members: `BAN_SUSPENSION`, `APP_LOCK`, `COHORT_GATE`, `UNSAFE_DEVICE`, `ACCOUNT_DELETION`.
- [ ] `isSealedRoute(route)` returns `true` for every route that renders one of the five, and `false` for every other route in the nav graph.
- [ ] `scripts/check-sealed-screens.js` exits `0` on the committed manifests.

### Error paths

- [ ] `scripts/check-sealed-screens.js` exits non-zero, naming the offending key and route, when a manifest references a sealed route.
- [ ] The check fails on a sealed route reached via `menus[].action.route` as well as `navigation[].tabs[].route` — every route-bearing field is walked, not just the obvious one.
- [ ] A sealed route reached by a `visibleIf`-hidden item still fails the check: hidden is not the same as absent, and a later manifest can unhide it.

### Edge cases

- [ ] Route matching is exact, not prefix — `accountDeletionHelp` is not treated as `accountDeletion`, and `account` does not match `accountDeletion`.
- [ ] Route comparison is case-sensitive and does not normalise, so a manifest cannot slip through with `AccountDeletion`; a case variant that resolves to a sealed screen fails the check.
- [ ] Adding a sixth route to a sealed screen's own definition automatically extends the check with no edit to the check script.
- [ ] A new nav route that is NOT sealed requires no change to this story's artefacts.

### Performance

- [ ] `scripts/check-sealed-screens.js` completes in under 2 s on the committed manifests, so it can sit in `lint.yml` without cost.

### Security

- [ ] The sealed set is the single source of truth: the route list lives in `SealedScreens.kt` and the CI script reads it rather than restating it, so the two cannot drift.
- [ ] A deliberately-crossing fixture manifest is committed and asserted to FAIL the check — the guard is proven to be able to fire, not merely to exist.
- [ ] Removing a member from `SealedScreen` fails a test that pins the set to exactly five, so shrinking the boundary is a conscious, reviewed act rather than a quiet edit.

### UX

- [ ] N/A — no user-facing surface. The user-visible consequence is negative and permanent: these five screens keep behaving exactly as they do today, whatever any manifest says.

### i18n

- [ ] N/A — no user-facing strings. The sealed screens keep their existing bundled strings in all 20 locales, which is precisely the property being protected.

### Observability

- [ ] The CI failure message names the manifest key, the offending route, and the sealed screen it resolves to — enough to fix it without opening the script.
- [ ] `parseManifest` records a degraded entry when it drops a sealed-route item at runtime, so a manifest that somehow reached a client is visible in logs.

## BDD Scenarios

**Scenario: A manifest that hides the ban screen cannot be published**

- **Given** someone edits a manifest so the ban screen is no longer shown
- **When** the change is checked before publishing
- **Then** the check refuses it
- **And** the message names the ban screen

**Scenario: An ordinary menu change is unaffected**

- **Given** someone adds a Support item to the settings menu
- **When** the change is checked before publishing
- **Then** the check passes

**Scenario: Hiding a sealed screen behind a condition is still refused**

- **Given** a manifest that references the App-Lock screen but hides it behind a switch
- **When** the change is checked before publishing
- **Then** the check refuses it

**Scenario: A similarly-named screen is not mistaken for a sealed one**

- **Given** a manifest that links to the account-deletion help page
- **When** the change is checked before publishing
- **Then** the check passes

## Test Plan

**RED first.** The crossing fixture is written and observed to fail the check
before the check is written to catch it.

### Kotlin unit (`shared/src/commonTest/kotlin/.../manifest/SealedScreensTest.kt`)

- `the sealed set contains exactly five members` — pins the set; shrinking it goes red
- `isSealedRoute is true for every route of every sealed screen`
- `isSealedRoute is false for every non-sealed route in the nav graph`
- `isSealedRoute does not match on prefix` (`accountDeletionHelp`, `account`)
- `isSealedRoute is case-sensitive`
- `a sealed route added to a screen definition is picked up without editing the check`

### Node (`express-api/tests/scripts/check-sealed-screens.test.js`)

- `exits 0 on the committed manifests`
- `exits non-zero on a manifest referencing a sealed route via navigation`
- `exits non-zero on a manifest referencing a sealed route via a menu action`
- `exits non-zero on a sealed route behind a visibleIf`
- `exits 0 on a route that merely resembles a sealed one`
- `names the key, the route, and the sealed screen in its message`
- `completes in under 2 seconds`

### Fixtures (committed, real)

- `manifests/__fixtures__/crosses-ban-screen.json` — must fail the check.
- `manifests/__fixtures__/resembles-sealed.json` — must pass.

These are real files asserted against the real script, not inline strings: the
guard's job is to inspect committed manifests, so the test must exercise it the
way CI does.

### Mutation proof

| Mutation | Must kill |
| -------- | --------- |
| `isSealedRoute` always returns `false` | `exits non-zero on a manifest referencing a sealed route via navigation` |
| prefix matching used instead of exact | `isSealedRoute does not match on prefix` |
| the walker skips `menus[].action.route` | `exits non-zero on a manifest referencing a sealed route via a menu action` |
| `visibleIf`-hidden items are skipped by the walker | `exits non-zero on a sealed route behind a visibleIf` |
| one member removed from `SealedScreen` | `the sealed set contains exactly five members` |

### CI wiring

- `scripts/check-sealed-screens.js` added to `.github/workflows/lint.yml`.
- Added to `.husky/pre-push` so it fails locally before it fails in CI.

## Out of Scope

- Server-side enforcement of bans/suspension/cohort — already in place
  (design §6.2); this story does not touch it.
- App Check on authenticated routes — SHY-0321.
- Any change to how the five screens themselves look or behave. This story
  makes them un-hot-pushable; it does not redesign them.
- Making a sealed screen's *copy* remotely editable. Deliberately excluded: the
  operator chose the strict option, and copy is the crack through which
  structure follows.

## Dependencies

- **SHY-0310** — consumes `isSealedRoute` from the parser; this story provides
  the real implementation behind that interface.
- **EPIC-0004 must be Done** (EPIC-0011 dependency gate).
- Must merge **before** SHY-0312 through SHY-0319, per the epic ordering.

## Risks & Mitigations

| Risk | Mitigation |
| ---- | ---------- |
| The boundary erodes over time as someone "just needs" one exception | The set is pinned to exactly five by a test. Growing or shrinking it requires editing that test, which is a visible, reviewable act. |
| The check exists but cannot actually fire | A committed crossing fixture is asserted to fail it, and the mutation table proves each rule independently. A guard nobody has seen fail is not a guard. |
| A sealed screen is reachable by a route nobody listed, so the seal has a hole | The route list lives with the screen definitions and the check reads it rather than restating it, so a new route is covered by construction. The nav-graph exhaustiveness test catches the rest. |
| Someone concludes the sealed set makes the app safe and skips server-side checks | Stated explicitly in Why and in Out of Scope: this protects against our own bad push. The server is the control. |

## Definition of Done

- [ ] Every AC checkbox above is met.
- [ ] Every named test exists, was observed RED first, and is now green.
- [ ] Every mutation in the table killed its named test and was reverted with a git-verified clean tree.
- [ ] The crossing fixture is committed and demonstrably fails the check.
- [ ] `scripts/check-sealed-screens.js` runs in `lint.yml` and in `.husky/pre-push`.
- [ ] `./gradlew :shared:compileKotlinIosArm64` passes.
- [ ] `cd express-api && npm test` passes; `npm run lint` clean at `--max-warnings=0`.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] `bash scripts/pre-merge-check.sh <PR#>` emits `PRE-MERGE-CHECK: OK`.
- [ ] Status `In Review` before merge; `Done` on release cut with `released_in:`.

## Notes (running log)

- **2026-08-17** — Story raised from design doc §6.1. Operator chose the strict option ("seal the five") after asking for the reasoning in plain terms, then added the sharper requirement that produced SHY-0321: *"we also need server-side verification on these areas, in case someone tries to make a hacked copy of the app… the API/backend should always be ensuring that any request is legal and within the rules."*
- **2026-08-17** — Deliberately ordered second in EPIC-0011. A sealed boundary introduced after its consumers is a boundary that has already been crossed.
- **2026-08-17** — The `visibleIf`-hidden case is in the AC on purpose. Hidden is not absent, and the next manifest can unhide it — so a reference to a sealed screen must fail the check even when that reference is currently invisible.
