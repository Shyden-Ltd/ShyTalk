# Server-Driven UI — Phase 1 Implementation Plan

> **For agentic workers:** each task below corresponds to exactly ONE story file
> in `.project/stories/` and ships as ONE PR, per this repo's Agile rules. The
> story carries the Acceptance Criteria, BDD scenarios, Test Plan and DoD —
> **do not duplicate those here.** This document carries what a story cannot:
> the file structure and the **cross-story interface contracts**, so the author
> of Task 7 knows the exact names and types Task 3 produced.

**Goal:** Ship the manifest pipeline and config layer, so navigation, menus,
settings, design tokens, copy and feature availability can change without a
Play Store or App Store release.

**Architecture:** One versioned JSON document served by the Express API,
resolved per-caller against cohort/platform/app-version. Clients resolve it
through three tiers — fresh fetch → disk cache → binary-bundled default — and
never block first paint on the network. Five enforcement screens are sealed
from the manifest and that boundary is held by a CI test, not convention.

**Tech Stack:** Kotlin Multiplatform (`commonMain`) · Compose Multiplatform ·
Express + Firebase Admin SDK · Jest · Playwright · Kotlin/JVM unit ·
Android instrumented BDD · XCTest/XCUITest · manual-qa journey runner

**Spec:** `.project/plans/2026-08-17-server-driven-ui-design.md`

**Epic:** EPIC-0011

---

## Global Constraints

Every task's requirements implicitly include all of these. Values are verbatim
from the spec.

- **C1 — Declarative data only.** No downloaded executable code, ever. The
  server selects among components the binary already ships (Apple 3.3.2 / 2.5.2,
  Google Play Device & Network Abuse).
- **C2 — $0 hosting.** `ETag` + `If-None-Match`; steady state is `304` with no
  body. `Cache-Control: private, no-cache` — never `max-age`.
- **C3 — API-only backend access.** No client reads the manifest from
  Firestore/RTDB/Storage directly. Served by Express only.
  ([[feedback-no-direct-backend-all-via-api]], EPIC-0006)
- **C4 — Real-only outside unit tests.** No mocks/stubs/fakes except in
  `*.unit.test.*` / `commonTest` / `jvmTest`. Integration runs against the real
  local stack; device work runs on a real Android device and a real iPhone.
- **C5 — 20 locales.** Every user-facing string exists in all 20 locale files.
  A manifest referencing a label key missing from any locale must fail to
  publish.
- **C6 — Sealed set is inviolable.** Ban/suspension, App-Lock, cohort
  segregation, unsafe-device, account deletion are unreachable from any
  manifest key.
- **C7 — Tri-platform.** Android + iOS + web. Shared logic in `commonMain`;
  `./gradlew :shared:compileKotlinIosArm64` must pass on every shared change.
- **C8 — Never blocks first paint.** No manifest fetch is on the critical path
  of rendering. Cold start paints from cache or bundled defaults.
- **C9 — Fail-safe parsing.** Unknown keys ignored; a malformed section falls
  back to bundled defaults for that section only; a manifest failing top-level
  validation is discarded whole and the previous good one retained. Never a
  crash, never a blank screen.

**Dependency gate:** no task in this plan starts until **EPIC-0004** is Done.
Its cold-start rewrite is where Task 3's resolution logic lives; building
first would mean designing cold start twice.

---

## File Structure

**Shared (KMP, `shared/src/commonMain/kotlin/com/shyden/shytalk/`)**

| Path | Responsibility |
|------|----------------|
| `core/manifest/UiManifest.kt` | The data model. Pure types, no I/O. |
| `core/manifest/ManifestSchema.kt` | Parse + validate + fail-safe fallback. Pure. |
| `core/manifest/ManifestSource.kt` | The three-tier resolver. Owns cache/bundled/remote precedence. |
| `core/manifest/ManifestStore.kt` | Disk persistence (expect/actual for path only). |
| `core/manifest/SealedScreens.kt` | The sealed registry. The CI test reads this. |
| `core/manifest/ManifestTokens.kt` | Token map → Compose theme values. |
| `core/manifest/ManifestStrings.kt` | String override resolution, falls back to bundled resources. |
| `core/manifest/VisibleIf.kt` | Predicate evaluation (feature + cohort). |
| `core/manifest/RolloutBucket.kt` | Stable user-hash bucketing. Pure + deterministic. |

**Server (`express-api/src/`)**

| Path | Responsibility |
|------|----------------|
| `routes/ui-manifest.js` | `GET /api/ui-manifest` — authenticated + pre-auth variants. |
| `utils/manifest-build.js` | Compose the per-caller document from source + cohort + rollout. |
| `utils/manifest-validate.js` | Publish-time validation. Shared by CI, admin UI and the route. |
| `utils/manifest-etag.js` | Deterministic ETag over the resolved document. |
| `middleware/auth-skip.js` | **Modify** — add the pre-auth path to `skipsAuth` **and** to `requiresAppCheck`. |

**Manifest source (repo root)**

| Path | Responsibility |
|------|----------------|
| `manifests/base.json` | The committed source of truth. |
| `manifests/schema.json` | JSON Schema, consumed by validation on both sides. |

**Scripts / CI**

| Path | Responsibility |
|------|----------------|
| `scripts/validate-manifests.sh` | Runs every §6.3 rule; wired into `lint.yml`. |
| `scripts/check-sealed-screens.js` | Fails the build if any manifest key resolves to a sealed screen. |

---

## Interface Contracts

The single most important section for parallel work. **These names and types
are fixed** — a later task depending on a different name is an integration bug,
not a preference.

```kotlin
// Task 1 — core/manifest/UiManifest.kt
data class UiManifest(
    val schemaVersion: Int,
    val manifestVersion: String,
    val minAppVersion: String,
    val tokens: Map<String, TokenValue>,
    val strings: Map<String, Map<String, String>>,   // locale → key → text
    val navigation: Map<String, NavGroup>,
    val menus: Map<String, MenuGroup>,
    val features: Map<String, FeatureFlag>,
    val rollout: Rollout,
)
sealed interface TokenValue {
    data class Color(val argb: Long) : TokenValue
    data class Dimen(val dp: Float)  : TokenValue
}
data class NavGroup(val tabs: List<NavItem>)
data class NavItem(
    val id: String, val labelKey: String, val icon: String,
    val route: String, val visibleIf: VisiblePredicate?,
)
data class MenuGroup(val items: List<MenuItem>)
data class MenuItem(
    val id: String, val labelKey: String,
    val action: MenuAction, val visibleIf: VisiblePredicate?,
)
sealed interface MenuAction {
    data class Route(val route: String) : MenuAction
    data class Url(val url: String)     : MenuAction
}
data class FeatureFlag(val enabled: Boolean)
data class Rollout(val percent: Int, val cohorts: List<String>)

// Task 1 — core/manifest/ManifestSchema.kt
sealed interface ParseResult {
    data class Ok(val manifest: UiManifest, val degraded: List<String>) : ParseResult
    data class Rejected(val reason: String) : ParseResult
}
fun parseManifest(json: String, bundled: UiManifest): ParseResult

// Task 2 — core/manifest/SealedScreens.kt
enum class SealedScreen { BAN_SUSPENSION, APP_LOCK, COHORT_GATE, UNSAFE_DEVICE, ACCOUNT_DELETION }
fun isSealedRoute(route: String): Boolean

// Task 4 — core/manifest/ManifestSource.kt
enum class ManifestTier { REMOTE, CACHE, BUNDLED }
data class ResolvedManifest(val manifest: UiManifest, val tier: ManifestTier)
interface ManifestSource {
    fun current(): ResolvedManifest              // synchronous, never blocks
    suspend fun refresh(): ResolvedManifest      // background
}

// Task 5 — core/manifest/VisibleIf.kt
data class VisiblePredicate(val feature: String?, val cohorts: List<String>?)
fun evaluate(p: VisiblePredicate?, features: Map<String, FeatureFlag>, cohort: String): Boolean

// Task 8 — core/manifest/RolloutBucket.kt
fun bucketOf(uniqueId: Long, manifestVersion: String): Int   // 0..99, deterministic
```

```javascript
// Task 3 — express-api/src/utils/manifest-build.js
/** @returns {{ document: object, etag: string }} */
async function buildManifest({ uniqueId, cohort, platform, appVersion });

// Task 3 — express-api/src/utils/manifest-validate.js
/** @returns {{ ok: boolean, errors: string[] }} */
function validateManifest(document, { locales, iconRegistry, routeRegistry });
```

---

## Tasks → Stories

Each row is one story file and one PR. Effort uses this repo's scale.

| # | Story | Deliverable | Effort | Depends on |
|---|-------|-------------|--------|-----------|
| 1 | **SHY-0310** | Manifest schema + shared data model + fail-safe parser. Pure, no I/O — testable entirely in `commonTest`. | M | — |
| 2 | **SHY-0311** | Sealed-screen registry + the CI test that enforces it. **Lands second, before anything can cross the boundary.** | S | 1 |
| 3 | **SHY-0312** | `GET /api/ui-manifest` — build, cohort-resolve, ETag/304, pre-auth variant added to both `skipsAuth` and `requiresAppCheck`. | M | 1 |
| 4 | **SHY-0313** | Client three-tier resolution: remote → disk cache → bundled. Never blocks paint. Bundled default generated from `manifests/base.json` at build time. | L | 1, 3 |
| 5 | **SHY-0314** | Navigation + menus driven by the manifest. Icon registry; unknown icon skipped, not blank. `visibleIf` evaluation. | L | 4 |
| 6 | **SHY-0315** | Feature flags / kill-switch — client hides the entrance, **API refuses the request**. Both halves in one PR; a flag without server refusal is theatre. | M | 4 |
| 7 | **SHY-0316** | Server-served copy: string overrides + publish-time validation that every referenced key exists in all 20 locales. | M | 4 |
| 8 | **SHY-0317** | Staged rollout by stable bucket + rollback, including a **rollback drill** — publish a bad manifest to 5%, revert, prove recovery. | M | 3, 4 |
| 9 | **SHY-0318** | Publishing pipeline: `manifests/` in repo, `validate-manifests.sh` in `lint.yml`, CI deploy. | M | 3 |
| 10 | **SHY-0319** | Admin UI — curated forms per section (never a raw JSON editor), committing via the same App-signed `createCommitOnBranch` used by `release.yml`. **Largest line item.** | L | 9 |
| 11 | **SHY-0320** | *Spike:* count the hard-coded colour/dimension debt in `commonMain`. Files the theming implementation story with a real number. | S | — |

**Filed by Task 11, not pre-written:** the design-token theming story. Its
effort cannot be honestly stated before the spike counts the debt, and this
repo forbids skeleton stories — so the spike produces it, per the `spike`
lifecycle in CLAUDE.md.

### Ordering

```
     1 ──┬── 2  (seal the boundary early)
         ├── 3 ──┬── 9 ── 10
         │       └── 8
         └── 4 ──┬── 5
                 ├── 6
                 ├── 7
                 └── 8

     11 (spike) — independent, run any time
```

Tasks 5, 6 and 7 are mutually independent once 4 lands, but this repo runs
**WIP = 1**, so they are sequential in practice.

---

## Side tickets (NOT in EPIC-0011)

Surfaced by this design work; each stands alone.

| Story | Why it exists | Effort | Priority |
|-------|--------------|--------|----------|
| **SHY-0321** | **App Check is enforced only on unauthenticated routes.** `requiresAppCheck` is called inside the `skipsAuth` branch at `index.js:129`, so authenticated routes accept any valid Firebase ID token — which a modified build signed into a real account holds legitimately. Android proceeds; **iOS App Attest is blocked on the same Apple `.p8` key holding SHY-0151.** | M | P1 |
| **SHY-0322** | Remove the gacha age-verification gate; **keep cohort segregation**. Operator decision 2026-08-17. | M | P1 |
| **SHY-0323** | Make future tickets aware: CLAUDE.md manifest section, a required manifest-driven-vs-native question in the story template, and a sweep of existing Draft stories that add UI. | S | P1 |

---

## Self-Review — spec coverage

Checked against `2026-08-17-server-driven-ui-design.md`, section by section.

| Spec § | Covered by |
|--------|-----------|
| §4.1 document shape | Task 1 |
| §4.2 three-tier resolution | Task 4 |
| §4.3 delivery, ETag, pre-auth + App Check | Task 3 |
| §5.1 navigation and menus | Task 5 |
| §5.2 design tokens | Task 11 (spike) → filed story |
| §5.3 feature flags | Task 6 |
| §5.4 copy in 20 locales | Task 7 |
| §6.1 sealed set + CI test | Task 2 |
| §6.2 server authority | Already enforced (audited); gap → SHY-0321 |
| §6.3 version + schema safety | Tasks 1 (parse), 3 (`minAppVersion`), 9 (publish validation) |
| §7 publishing pipeline | Tasks 9 (git/CI) + 10 (admin UI) |
| §8 testing strategy | Per-story Test Plans; rollback drill in Task 8 |
| §9 sequencing | Dependency gate above — EPIC-0004 first |
| §10 age gating | SHY-0322 |
| §11 future-ticket awareness | SHY-0323 |
| §12 Phase 2 sketch | Deliberately unplanned — its own EPIC after Phase 1 |
| §13 risks | Mitigations distributed across the tasks named in that table |
| §14 open questions | Resolved: web is Phase 2; spike is Task 11; admin UI is curated forms (Task 10) |

**No gaps.** Every spec section maps to a task, a story, or an explicit
deferral.
