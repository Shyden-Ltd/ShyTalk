---
id: SHY-0310
status: Draft
owner: claude
created: 2026-08-17
priority: P1
effort: M
type: feature
roadmap_ids: []
epic: EPIC-0011
mvp: true
---

# SHY-0310: The UI manifest — schema, shared model, and a parser that cannot blank the screen

## User Story

As a **developer building the server-driven UI**, I want one shared, versioned
model of the manifest with a parser that degrades safely, so that every later
story reads the same types and no malformed document can ever leave a user
looking at an empty app.

## Why

This is the contract everything else in EPIC-0011 depends on. If it is wrong,
eleven stories are wrong with it.

The load-bearing decision is not the shape of the data — it is **what happens
when the data is bad**. A server-driven UI moves the app's appearance onto a
network resource, which means the app must have a defined, tested answer for
every way that resource can disappoint it: absent, truncated, wrong version,
unknown keys, a colour that is not a colour, a menu item pointing at a route
that does not exist.

The wrong answer is an exception that reaches Compose, because that renders as
a blank screen — the single worst outcome, since it is indistinguishable from a
crash and gives the user nothing to act on. The right answer is **per-section
degradation**: a broken `menus` block falls back to bundled menus while
`tokens` and `navigation` still apply. Nothing else in the epic can be trusted
until this is proven.

The model is deliberately **pure** — no I/O, no platform types, no coroutines.
That makes it fully exercisable in `commonTest` on the host JVM, which is both
faster and the only layer where test doubles are permitted at all under this
repo's real-only rule.

## Acceptance Criteria

### Happy path

- [ ] A well-formed manifest parses into `UiManifest` with every field populated and `degraded` empty.
- [ ] `parseManifest` returns `ParseResult.Ok` and the resulting model is value-equal to a hand-built expected instance.
- [ ] `tokens` distinguishes `TokenValue.Color` from `TokenValue.Dimen` by declared type, not by guessing from the literal.

### Error paths

- [ ] A document missing `schemaVersion` returns `ParseResult.Rejected` naming the missing field.
- [ ] A `schemaVersion` higher than this binary understands returns `Rejected`, so a future manifest is never half-read.
- [ ] Malformed JSON returns `Rejected` with the parser's message, never an exception escaping the function.
- [ ] A single malformed **section** (e.g. `menus` is a string) returns `Ok` with the bundled `menus` substituted and `"menus"` listed in `degraded` — the other sections still apply.

### Edge cases

- [ ] Unknown top-level keys are ignored, not rejected — a newer server must be able to add fields without breaking older clients.
- [ ] An empty `navigation` map parses successfully and yields no tabs, which is different from a malformed one.
- [ ] A `visibleIf` naming an unknown feature evaluates to hidden, not visible — an unresolvable condition fails closed.
- [ ] A colour token outside `#AARRGGBB`/`#RRGGBB` form degrades that one token, keeping the rest of the map.
- [ ] `minAppVersion` comparison handles unequal segment counts (`1.4` vs `1.4.0`) without throwing.

### Performance

- [ ] Parsing a 200 KB manifest completes in under 50 ms on the host JVM, asserted with a real timing test.
- [ ] Parsing allocates no coroutine, thread, or file handle — it is a pure function, asserted by having no such dependency available in `commonTest`.

### Security

- [ ] `isSealedRoute` is consulted for every `route` in `navigation` and `menus`; a sealed route degrades that item and records it in `degraded`. (Registry itself lands in SHY-0311; this story consumes the interface.)
- [ ] A manifest string is never interpreted as code, markup, or a format template — values are opaque text.
- [ ] `MenuAction.Url` rejects any scheme other than `https`, so a manifest cannot route a user to `javascript:` or a custom scheme.

### UX

- [ ] N/A — this story adds no user-facing surface. Its UX contribution is the guarantee, tested here, that a bad manifest never produces a blank screen; the visible behaviour lands in SHY-0313 and SHY-0314.

### i18n

- [ ] The `strings` map is keyed by locale and parses all 20 supported locales without special-casing any of them.
- [ ] A locale present in the manifest but unknown to the app is ignored rather than rejected.
- [ ] No user-facing string is introduced by this story, so no locale file changes.

### Observability

- [ ] Every `degraded` section name is returned to the caller so SHY-0313 can log it — degradation is never silent.
- [ ] `ParseResult.Rejected.reason` is specific enough to identify the offending field from a log line alone.
- [ ] `manifestVersion` survives parsing intact so it can be attached to telemetry.

## BDD Scenarios

**Scenario: A good manifest is accepted whole**

- **Given** the server has published a valid set of menus, colours and labels
- **When** the app reads it
- **Then** every one of those settings is applied
- **And** nothing is reported as having been skipped

**Scenario: One bad section does not spoil the rest**

- **Given** a published manifest whose menu section is corrupt but whose colours are fine
- **When** the app reads it
- **Then** the app keeps its built-in menus
- **And** the new colours are still applied
- **And** the skipped menu section is reported

**Scenario: A manifest from a newer app version is refused outright**

- **Given** a manifest written for a later version of the app
- **When** the app reads it
- **Then** the manifest is refused entirely
- **And** the app keeps the settings it already had

**Scenario: A hidden condition that cannot be judged stays hidden**

- **Given** a menu item shown only when a feature the app does not recognise is on
- **When** the app decides whether to show it
- **Then** the item stays hidden

## Test Plan

**RED first — every test below is written and observed failing before any
implementation exists.**

### Kotlin unit (`shared/src/commonTest/kotlin/.../manifest/`)

- `ManifestSchemaTest.kt`
  - `parses a complete manifest into an equal model`
  - `rejects a manifest with no schemaVersion, naming the field`
  - `rejects a schemaVersion newer than this binary`
  - `rejects malformed json without throwing`
  - `degrades only the malformed section and lists it`
  - `ignores unknown top-level keys`
  - `distinguishes color tokens from dimen tokens by declared type`
  - `degrades a single malformed colour token, keeping the others`
  - `compares minAppVersion across unequal segment counts`
  - `parses all 20 locales in the strings map`
  - `ignores a locale the app does not support`
  - `rejects a MenuAction url whose scheme is not https`
  - `degrades a navigation item pointing at a sealed route`
  - `parses a 200KB manifest in under 50ms`
- `VisibleIfTest.kt`
  - `shows an item whose feature is enabled`
  - `hides an item whose feature is disabled`
  - `hides an item whose feature is unknown`
  - `hides an item whose cohort does not match`
  - `shows an item with no predicate at all`

### iOS compile gate

- `./gradlew :shared:compileKotlinIosArm64` — the model is `commonMain`, so it
  must compile for Kotlin/Native. No JVM-only APIs (`String.format`,
  `System.currentTimeMillis`, `synchronized`) per the KMP rules in CLAUDE.md.

### Mutation proof (the story is not done without it)

Each of these mutations must turn a specific named test RED. A mutation that
kills nothing means the test is decoration:

| Mutation | Must kill |
| -------- | --------- |
| `visibleIf` unknown feature returns `true` | `hides an item whose feature is unknown` |
| per-section degradation replaced by whole-document rejection | `degrades only the malformed section and lists it` |
| unknown top-level keys cause rejection | `ignores unknown top-level keys` |
| `https` scheme check removed | `rejects a MenuAction url whose scheme is not https` |
| `degraded` list always returned empty | `degrades only the malformed section and lists it` |

### Not run for this story

- No device gauntlet: pure `commonMain` types with no runtime surface, no
  backend change, no `public/**` change. Classified **not** CI-config-only
  either — it is product code, so it runs the full non-device gauntlet
  (Kotlin unit, detekt, ktlint, iOS compile, `code-reviewer` 100% clean).

## Out of Scope

- Fetching the manifest over the network — SHY-0312 (server) and SHY-0313 (client).
- Disk caching and the bundled default — SHY-0313.
- Applying tokens to the Compose theme — the story filed by the SHY-0320 spike.
- Rendering navigation and menus — SHY-0314.
- The sealed-screen registry itself — SHY-0311. This story consumes
  `isSealedRoute` and lands with a minimal stub of the registry only if
  SHY-0311 has not merged first; the ordering in EPIC-0011 puts SHY-0311
  second precisely so that stub is never needed.
- Layout trees / `schemaVersion: 2` — Phase 2.

## Dependencies

- **EPIC-0004 must be Done** (EPIC-0011 dependency gate).
- No other story. This is the foundation; SHY-0312 through SHY-0319 all consume
  the types defined here.
- Exact interface contracts are fixed in
  `.project/plans/2026-08-17-server-driven-ui-phase1-plan.md` §"Interface
  Contracts" — do not rename anything declared there without updating that
  document in the same PR.

## Risks & Mitigations

| Risk | Mitigation |
| ---- | ---------- |
| The model shape proves wrong once real consumers exist, forcing a rewrite across eleven stories | The shape is derived from the design doc §4.1, which was reviewed against all four operator drivers before any code. `schemaVersion` exists so an unavoidable break is versioned rather than silent. |
| Per-section degradation is implemented but never actually exercised, so the guarantee is unproven | The mutation table above is part of the DoD, not a suggestion. A mutation that kills no test fails the story. |
| A JVM-only API slips into `commonMain` and breaks the iOS build | `./gradlew :shared:compileKotlinIosArm64` is in the Test Plan and in the DoD. This has bitten twice before (SHY-0300). |
| "Fail closed" for `visibleIf` hides something that should show, and nobody notices | Deliberate and correct: a hidden item is a visible bug someone reports, whereas a wrongly-shown item may be a leak. The `degraded` list makes it diagnosable. |

## Definition of Done

- [ ] Every AC checkbox above is met.
- [ ] Every test named in the Test Plan exists, was observed RED before implementation, and is now green.
- [ ] Every mutation in the mutation table was applied, killed a named test, and was reverted with a git-verified clean tree.
- [ ] `./gradlew :shared:compileKotlinIosArm64` passes.
- [ ] `./gradlew testDevDebugUnitTest :shared:jvmTest detekt` passes; `ktlint --relative` clean.
- [ ] `code-reviewer` 100% clean, zero findings, with `Reviewed-up-to: <sha>` recorded in Notes.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] `bash scripts/pre-merge-check.sh <PR#>` emits `PRE-MERGE-CHECK: OK`.
- [ ] Status flipped to `In Review` before merge; `Done` on the release cut with `released_in:` set.

## Notes (running log)

- **2026-08-17** — Story raised from `.project/plans/2026-08-17-server-driven-ui-design.md` §4.1 and §6.3. Purity of the model is a deliberate constraint, not an accident: it keeps the whole contract testable on the host JVM, which is the only layer where this repo permits test doubles.
- **2026-08-17** — `MenuAction.Url` https-only was added during spec review. A manifest that can hand the app an arbitrary scheme is a redirect primitive, and the manifest is exactly the surface an attacker would want if they got publish access.
