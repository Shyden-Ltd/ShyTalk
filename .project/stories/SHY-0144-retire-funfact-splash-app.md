---
id: SHY-0144
status: Draft
owner: claude
created: 2026-07-01
priority: P1
effort: M
type: refactor
roadmap_ids: []
epic: EPIC-0004
pr:
mvp: true
---

# SHY-0144: Retire the FunFact splash + app-side fun-fact code

## User Story

**As** a ShyTalk user (returning or signing in for the first time),
**I want** the FunFact splash screen gone entirely, so the app moves straight from auth to the room list,
**So that** no one ever waits on a fun-fact loading screen again — the data the splash used to preload simply loads lazily, the way the home screen already does.

## Why

SHY-0143 routes **returning** users around the splash via the optimistic `startDestination`, but the splash still sits in the **first-time** auth flow (`SignIn`, `ProfileSetup`, `RequiredDOB`, `LegalAcceptance` → `Screen.Splash` → `Main`) and remains a live screen. The operator has decided to delete it entirely (2026-07-01). The blast-radius investigation confirmed this is safe: the splash's 6 warm-up preloads are **redundant** — banners, user data, blocked-user IDs, rooms, and conversations are all re-fetched by the home screen's own real-time listeners (`HomeViewModel`), costing only ~100-300 ms of lazy first-paint latency (exactly the "loads in the background" behaviour we want). The **only** splash-exclusive thing is the fun facts themselves, whose data/backend/admin teardown is **SHY-0145**; this story removes everything **Kotlin/app-side** (splash UI + the app's fun-fact repo/model that read the collection).

Critically, **banners are independent of the splash** — loaded *and displayed* by `HomeViewModel:108-120` → `MainScreen`'s banner carousel (the splash only *preloaded* banner images it never displayed). So banners, their admin tab, backend routes, and R2 images all stay; this story must **not** regress them.

## Acceptance Criteria

### Happy path
- [ ] `Screen.Splash` (`shared/.../navigation/Screen.kt:57`) is removed; `FunFactSplashScreen.kt` + `FunFactSplashViewModel.kt` + `BannerImagePreloader.kt` + `WebContentPreloader.kt` are deleted.
- [ ] All four auth-flow navigations that targeted `Screen.Splash` route to `Screen.Main` instead — in **both** `shared/.../navigation/SharedNavGraph.kt:179-180,186-187,210-211,220-221` and `app/.../navigation/NavGraph.kt:198,205,228,238` — and the splash composable blocks (`SharedNavGraph:239-253`, `NavGraph:245-256`) are removed.
- [ ] After completing sign-in / profile-setup / DOB / legal acceptance, a first-time user lands on the room list with **no** splash.
- [ ] The app-side fun-fact code is removed: `FunFactRepository.kt`, `core/model/FunFact.kt`, `FunFactRepositoryImpl.kt` (+ its `fun_facts_cache.json` disk cache), and the Koin bindings (`AppKoinModule.kt:156,173-174`; `IosPlatformModule.kt:197-198`; `TestKoinModule.kt`).

### Error paths
- [ ] The conditional auth-flow branches still reach their correct **non-splash** destinations: profile-incomplete → `ProfileSetup`, DOB-missing → `RequiredDOB`, legal-acceptance-needed → its screen — and each, on completion, proceeds to `Main` (not a now-deleted Splash route).
- [ ] No navigation references a removed route at runtime (a `Screen.Splash` reference would be a compile error — build must be clean, not a lurking dead branch).

### Edge cases
- [ ] **Back-stack:** with the splash gone, `Main` is the post-auth root; pressing back from `Main` does not attempt to pop a non-existent Splash entry.
- [ ] **Process-death / restore:** relaunch after process death lands on `Main` (via SHY-0143's optimistic path), never on a Splash route.
- [ ] No orphaned imports remain (`NavGraph.kt:93-94` splash imports, `SharedNavGraph.kt:68-69`, and any `FunFact*` imports) — the build is import-clean.

### Performance
- [ ] App start no longer blocks on the splash `warmUpComplete` gate; the redundant preloads are removed and the home screen's existing real-time listeners load rooms/conversations/banners lazily (~100-300 ms first-paint latency, no blocking screen).

### Security
- N/A — removing a UI screen + a redundant preloader; no auth/cohort/permission surface changes. Banners' own access path (Firestore rules, server-only writes) is untouched.

### UX
- [ ] No user — returning **or** first-time — sees the FunFact splash on any path; the "continue" tap that the splash required is gone (auth proceeds straight to the room list).
- [ ] **Banners still load and display** in the home-screen carousel (regression guard — they are independent of the splash).

### i18n
- [ ] The `splash_tagline` string is removed from **all 20** locale files (`shared/.../composeResources/values*/strings.xml`) — no orphaned key, no dangling `stringResource(...)` reference to it.

### Observability
- [ ] Splash warm-up log lines are removed with the ViewModel; no dangling references to a deleted logger/tag remain. The auth→Main routing decision remains observable via SHY-0143's cold-start logging.

## BDD Scenarios

**Scenario: a new user goes straight to their rooms after signing in**
- **Given** someone signing in for the first time who has finished their profile, entered their date of birth, and agreed to the terms
- **When** they finish signing in
- **Then** they arrive at their room list right away
- **And** the fun-fact loading screen never appears

**Scenario: someone still finishing setup isn't shown a loading screen**
- **Given** a person who has signed in but hasn't finished setting up their profile
- **When** the app moves them to the next step
- **Then** they are taken to profile setup, and once that's done they arrive at their room list
- **And** no fun-fact loading screen appears at any point

**Scenario: promotional banners still show on the home screen**
- **Given** there are active promotional banners to display
- **When** someone opens the app to their room list
- **Then** the banners still appear in the home-screen carousel, exactly as before

**Scenario: a returning user never sees the loading screen either**
- **Given** a returning user who is already signed in
- **When** they open the app
- **Then** they land on their room list with no fun-fact loading screen shown

## Test Plan

Kotlin app/shared change (no `express-api/**`) → **NOT `*.md`-only → runs the app + real-device legs** (real Android + real iPhone). No web surface. Per § No Stubs, behaviour proven on the real device; host-set Kotlin tests cover the nav-decision logic.

**Red → Green (framework by framework):**
- **Shared host-unit (`commonTest`)** `./gradlew :shared:testDebugUnitTest`:
  - update `app/src/test/java/com/shyden/shytalk/navigation/ScreenTest.kt` — remove the `Screen.Splash` route assertions (`:31,:169`); add an assertion that no `Splash` route exists.
  - a nav-decision test (host) asserting each auth-completion branch resolves to `Screen.Main` (RED while the code still targets `Screen.Splash`).
- **Android instrumented (`androidTest`, real device)** `./gradlew connectedDevDebugAndroidTest`:
  - a first-time sign-in journey asserting the post-auth screen is the room list, **not** the splash (RED before re-wiring).
  - a **banner regression** test: home screen renders the banner carousel with seeded active banners (guards the kept-feature).
  - delete `app/src/androidTest/assets/features/splash.feature`; fold the still-relevant "app loads to room list" assertion into the auth/cold-start feature.
- **Deletions (must leave the suite green):** remove `app/src/test/java/com/shyden/shytalk/feature/splash/FunFactSplashViewModelTest.kt`, `.../data/repository/FunFactRepositoryImplTest.kt`, `.../core/model/FunFactFromMapTest.kt` — confirm no surviving test imports the deleted classes.
- **Static/quality:** Kotlin lint/detekt 0 warnings; `scripts/check-no-new-stubs.js` clean; full `:shared` + `:app` host-unit suites green after deletions; build is import-clean (no unresolved `Screen.Splash`/`FunFact*`).
- **Phase 1 LOCAL gauntlet:** real Android + real iPhone — first-time sign-in and returning cold-start both land on the room list with no splash; banners visible on home.
- **Phase 2:** `code-reviewer` 100% clean → In Review + `Reviewed-up-to:` → push → CI green by name.
- **Phase 3 (DEV):** re-run the sign-in + home journeys on dev to confirm banners still load from real `shytalk-dev`.

## Out of Scope
- The fun-facts **backend routes, admin tab, Firestore collection, rules, and data deletion** — that is **SHY-0145** (this story is Kotlin/app-side only).
- **Banners** — kept entirely (separate feature; regression-guarded here).
- The optimistic cold-start routing itself — delivered by **SHY-0143** (this story assumes it; together they mean no user sees login *or* splash).
- The maintenance/announcement **starting-screens** (separate subsystem, untouched).

## Dependencies
- **SHY-0143 lands first** (its optimistic `startDestination` already bypasses the splash for returning users; this story removes it for everyone).
- `HomeViewModel` (`:108-120`) + `MainScreen` banner carousel — the surviving banner load/display path that must keep working.
- The auth-flow screens (`SignIn`, `ProfileSetup`, `RequiredDOB`, `LegalAcceptance`) whose `→ Splash` edges are re-pointed to `Main`.

## Risks & Mitigations
- **Risk:** removing the splash's preloads regresses banners (loaded by both splash and home). **Mitigation:** the blast-radius pass confirmed `HomeViewModel` loads + `MainScreen` displays banners independently; an explicit banner-regression instrumented test guards it.
- **Risk:** a missed `Screen.Splash` reference compiles to a dead branch or breaks navigation. **Mitigation:** removing the route makes any reference a **compile error** — the build is the backstop; plus a grep-clean AC + nav-decision tests.
- **Risk:** first-paint feels slower without the preloads. **Mitigation:** ~100-300 ms lazy latency only; the home screen's real-time listeners populate immediately; operator accepted this "loads in background" behaviour.
- **Risk:** a surviving test imports a deleted fun-fact class → compile break. **Mitigation:** delete the dependent tests in the same change; host-unit suite green is the gate.

## Definition of Done
- [ ] Splash UI/VM/preloaders + app-side fun-fact repo/model/cache + Koin bindings deleted; all four auth-flow routes re-pointed to `Main`; `splash_tagline` removed in 20 locales; splash/fun-fact tests deleted; build import-clean.
- [ ] **Pre-Merge Testing Protocol satisfied:** host-unit RED→GREEN (nav-decision + ScreenTest) + Android instrumented (post-auth lands on room list; banner regression) + iOS verification → LOCAL gauntlet green on real Android + real iPhone (no splash anywhere; banners intact) → `code-reviewer` 100% clean → In Review + `Reviewed-up-to:` → push → CI green by name → DEV gauntlet green → **judgment-merge** (NO auto-merge; notify operator).
- [ ] `released_in: vX.Y.Z` set on the next release cut.

## Notes (running log)
- 2026-07-01 — **CREATED fully-refined** ([[feedback-no-skeleton-stories-fully-refined]]) under [[EPIC-0004-persistent-session-instant-coldstart]]. Scope from the splash blast-radius Explore pass: only fun-facts are splash-exclusive; banners are independent (home screen) and explicitly kept + regression-guarded; the 5 other preloads are redundant. Operator-approved full splash deletion (2026-07-01). Lands after SHY-0143, before SHY-0145.
