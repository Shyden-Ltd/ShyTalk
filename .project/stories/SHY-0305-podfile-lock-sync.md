---
id: SHY-0305
status: In Review
owner: claude
created: 2026-08-17
priority: P0
effort: S
type: bug
roadmap_ids: []
---

# SHY-0305: Every iOS build fails, and the guard that should have caught it was skipped by the same omission

## User Story

As a **developer shipping iOS**, I want a Podfile change without a matching
lock update to fail on its own PR, so that **the iOS app keeps building**
instead of the mismatch being cached over until a deploy dies in the compiler.

## Why

`develop` cannot build iOS at all.

```
AppDelegate.swift:3:8: error: Unable to resolve module dependency: 'FirebaseAppCheck'
** ARCHIVE FAILED **
Process completed with exit code 65
```

Observed on Deploy-To-Dev run `31964207898` (2026-08-16 18:48 UTC), job
`Distribute iOS to TestFlight`, on `develop` tip `b15cf3de728`.

### What is actually wrong

SHY-0300 (`521ae15454f`) added `pod 'FirebaseAppCheck'` to `iosApp/Podfile`
and added `import FirebaseAppCheck` to `AppDelegate.swift`, but **never
regenerated `iosApp/Podfile.lock`**:

| | value |
| --- | --- |
| `PODFILE CHECKSUM` in the lock | `5845710af9927e925012ef82403d2631c1cf47e4` |
| actual `sha1(iosApp/Podfile)` | `07df03a2dfe537d27c25b79441c65adba95ce6a4` |

The lock's `DEPENDENCIES` section has no `FirebaseAppCheck` — only
`FirebaseAppCheckInterop` and `AppCheckCore`, which are transitive
dependencies of other pods and are NOT the module `AppDelegate.swift` imports.
That near-miss is why a grep for "AppCheck" in the lock looks reassuring.

### Why CI did not catch it — the part that matters

`deploy-dev.yml` already has a guard for exactly this. It does not run.

```yaml
- name: Cache iosApp/Pods
  id: pods-cache
  with:
    key: pods-${{ runner.os }}-${{ hashFiles('iosApp/Podfile.lock') }}

- name: Install CocoaPods
  # …runs fresh `pod install --deployment` which fails loud on
  # lock mismatch instead of silently regenerating…
  if: steps.pods-cache.outputs.cache-hit != 'true'
```

The cache key is derived from **`Podfile.lock` only**. A change to the
**`Podfile`** therefore leaves the key untouched, the cache hits, and the step
whose stated job is to "fail loud on lock mismatch" is skipped — by precisely
the condition it exists to catch. The failed run confirms it:
`Install CocoaPods → skipped`, while every cache step reported `success`.

So the stale `Pods/` directory from before SHY-0300 was restored, no
`FirebaseAppCheck` was ever installed, and the first thing to notice was the
Swift compiler, one hour and two cache restores later.

This is the guard-hoisting shape ([[feedback-guards-can-be-hoisted-above-what-they-protect]]):
a check placed behind a condition that the failure itself suppresses.

### Sweep — the same shape elsewhere

- `ios-tests.yml:252` — identical `pods-…-hashFiles('iosApp/Podfile.lock')`
  key with the same skip-on-hit at `:349`. Same latent defect; it has not
  fired only because that workflow has not run against this mismatch yet.
- `ios-tests.yml:280` — the `ios-derived` cache hashes `iosApp/Podfile.lock`
  among many paths, and likewise omits `iosApp/Podfile`.
- `deploy-prod.yml:520` and `:879` — plain `pod install`, no cache and no
  `--deployment`. Prod is not exposed to the skip, but it would **silently
  regenerate** a mismatched lock rather than fail, which contradicts the
  policy dev states in its own comment.

## Acceptance Criteria

### Happy path

- [ ] `iosApp/Podfile.lock` lists `FirebaseAppCheck` in `DEPENDENCIES` and its
      `PODFILE CHECKSUM` equals `sha1(iosApp/Podfile)`.
- [ ] A Deploy-To-Dev iOS run archives and uploads to TestFlight.
- [ ] `import FirebaseAppCheck` resolves in `AppDelegate.swift`.

### Error paths

- [ ] A PR that edits `iosApp/Podfile` without regenerating the lock FAILS on
      its own PR, in lint, with a message naming both files and the command to
      fix it.
- [ ] The failure does not require CocoaPods, macOS, or a network — it must
      run on the ubuntu lint runner like every other repo guard.

### Edge cases

- [ ] A PR that edits neither file is unaffected.
- [ ] A PR that regenerates the lock correctly passes.
- [ ] A lock with the right checksum but a missing declared pod is still
      caught — checksum equality alone is necessary, not sufficient.
- [ ] A `Podfile` containing a trailing-newline-only change is treated as a
      change, because CocoaPods hashes the bytes.

### Performance

- [ ] The guard is a file read and a SHA-1 — no measurable cost against a lint
      job already measured in minutes.

### Security

- [ ] The guard only reads two tracked files and executes nothing from them.

### UX

- [ ] The failure tells the operator exactly what to run
      (`cd iosApp && pod install`) and what to commit.

### i18n

- [ ] N/A — CI tooling output, English-only by design.

### Observability

- [ ] The Pods cache step's key includes the Podfile, so a Podfile change is
      visible as a cache MISS in the run log rather than a silent hit.

## BDD Scenarios

**Scenario: a Podfile change without a lock update is rejected**

- **Given** a branch that adds a pod to the Podfile but leaves the lock alone
- **When** CI runs lint on its pull request
- **Then** the run fails and names both files and the command that fixes it

**Scenario: a correctly regenerated lock is accepted**

- **Given** a branch that adds a pod and regenerates the lock
- **When** CI runs lint on its pull request
- **Then** the check passes

**Scenario: iOS builds again**

- **Given** the regenerated lock on develop
- **When** iOS is deployed to dev
- **Then** the archive succeeds and the build reaches TestFlight

**Scenario: a Podfile change is no longer hidden by the Pods cache**

- **Given** a branch whose Podfile changed but whose lock did not
- **When** the iOS deploy job restores its Pods cache
- **Then** the cache misses and the CocoaPods install step runs

## Test Plan

**Classification:** touches CI plumbing plus a committed dependency lock. No
app source, backend or website runtime change — `Podfile.lock` is generated
dependency metadata, and the iOS deploy itself is the end-to-end proof.

**RED first** — `express-api/tests/scripts/podfile-lock-in-sync.test.js` (new).
Runs against the REAL repo files, no fixtures of the lock's format:

- `the committed lock matches the committed Podfile` — compares
  `PODFILE CHECKSUM` to `sha1(iosApp/Podfile)`. **RED today** — this is the
  live defect, and it must be observed red before the lock is regenerated.
- `every pod declared in the Podfile appears in the lock's DEPENDENCIES` —
  catches the case checksum equality cannot: a hand-edited checksum. RED today
  for `FirebaseAppCheck`.
- `the guard rejects a tampered checksum` — copy both files to a temp dir,
  corrupt one byte of the Podfile, assert the guard fails.
- `the guard accepts a matching pair` — the control, so "always fail" cannot
  pass.

**Mutation checks:**

- make the guard `return 0` unconditionally ⇒ the two RED cases stay green ⇒
  proves the guard is doing the work;
- revert the cache key to `Podfile.lock` only ⇒ the workflow-pin test reddens.

**Workflow pin** — extend the existing CI-structure suite to assert every
`iosApp/Pods` cache key hashes BOTH `iosApp/Podfile` and `iosApp/Podfile.lock`,
across `deploy-dev.yml` and `ios-tests.yml`. Enumerate the keys rather than
asserting one site, so a third workflow added later is caught.

**Green** — `cd express-api && npm test -- tests/scripts/`; `actionlint` with
CI's `SHELLCHECK_OPTS='-e SC2086'`; and the real proof: a Deploy-To-Dev run
that archives iOS successfully.

## Out of Scope

- Enabling App Check enforcement (Play Integrity / App Attest console
  settings, debug tokens). SHY-0300 shipped in monitor mode deliberately and
  that remains blocked on the operator.
- Upgrading CocoaPods or any pod version. The regenerated lock must move
  `FirebaseAppCheck` and nothing else; an incidental dependency bump would
  make this P0 fix unreviewable.
- The `deploy-prod.yml` plain-`pod install` inconsistency is IN scope as a
  one-line `--deployment` addition, but any wider prod-caching rework is not.

## Dependencies

- CocoaPods `1.17.0` — the version recorded in the lock, and the version
  installed locally, so regenerating cannot drift the `COCOAPODS:` line
  (the SHY-0294 failure mode).
- `iosApp/Podfile`, `iosApp/Podfile.lock`, `.github/workflows/deploy-dev.yml`,
  `.github/workflows/ios-tests.yml`, `.github/workflows/deploy-prod.yml`.

## Risks & Mitigations

- **Risk:** `pod install` bumps unrelated pods and turns a P0 fix into a large
  dependency change. **Mitigation:** diff the lock and require that only
  `FirebaseAppCheck` (plus its own required entries) is added; the
  `COCOAPODS:` line must not move.
- **Risk:** `pod install` rewrites `iosApp.xcodeproj/project.pbxproj` and
  churns device signing ([[feedback-never-churn-working-device-signing]]).
  **Mitigation:** inspect the pbxproj diff before committing; if it contains
  anything beyond pod xcconfig/build-phase wiring, stop and surface it.
- **Risk:** adding `--deployment` to prod turns a silently-passing deploy into
  a failing one. **Mitigation:** that is the correct behaviour and the lock is
  in sync by then; it is listed here so the change is a conscious one.
- **Risk:** the new lint guard's SHA-1 assumption is wrong for some CocoaPods
  version. **Mitigation:** already verified empirically — at SHY-0300's parent
  the lock's checksum equals `sha1(Podfile)` exactly.

## Definition of Done

- [ ] RED tests written and observed failing BEFORE the lock is regenerated.
- [ ] `Podfile.lock` regenerated; diff limited to the App Check addition.
- [ ] Pods cache keys hash the Podfile as well as the lock, in every workflow
      that has such a key.
- [ ] `deploy-prod.yml` uses `--deployment` like dev.
- [ ] Mutants proven to redden their tests.
- [ ] A real Deploy-To-Dev run archives iOS and reaches TestFlight — the only
      evidence that actually settles this.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to:` recorded.

## Notes (running log)

- **2026-08-17 — found by deploying, not by reading.** Dispatched
  Deploy-To-Dev after merging #1758 (the HARD rule that every develop merge is
  followed by a dev deploy) and it failed on iOS. The 2026-08-16 handoff had
  listed "run `pod install` for the new FirebaseAppCheck pod" as an item
  *waiting on the operator*, alongside console settings. That framing was
  wrong and cost a day: it is not a nice-to-have blocked on a human, it is a
  build-breaking regression that landed with SHY-0300.
- The decisive evidence was the step list, not the log:
  `Install CocoaPods → skipped` while every cache step reported `success`.
  When a guard "did not fire", check whether it RAN before checking whether it
  works ([[feedback-absence-of-work-reported-as-success]]).
- `sha1(Podfile) == PODFILE CHECKSUM` verified against a known-good commit
  (SHY-0300's parent) before being relied on as the guard's basis.

- **2026-08-17 — `code-reviewer` round 1: 0 Critical, 9 Important, 3 Minor.**
  Every claim was checked before being acted on. The reviewer had no git access
  and could not diff the regenerated lock; that gap is closed here with
  evidence: **0 pbxproj files changed**, and the whole `Podfile.lock` diff is
  nine added `FirebaseAppCheck` lines plus the checksum swap — no pod version
  moved, `COCOAPODS:` unchanged.

  Applied:

  - the guard now runs against the REAL repository in the Jest suite, not only
    against synthetic temp trees. The live-defect tests had been using a JS
    reimplementation of the parsing, so a bug unique to the bash sed/awk would
    have been caught by lint and by nothing in `npm test`;
  - fixtures for subspecs, version constraints, `:path` pods and quoted lock
    entries — all claimed in the script's comments, none exercised;
  - the "no SHA-1 tool available" branch, unreachable on both macOS and CI and
    therefore never run anywhere, now tested with a PATH-restricted spawn. The
    dangerous outcome is a guard that cannot hash and reports success anyway;
  - a vacuity guard on the `pod install` sweep. Its sibling scan had one; this
    one did not, so a regression in its own matching regex would have made it
    pass over an empty set and prove nothing;
  - a pin on the new lint step itself, including that it carries no `if:` —
    that step is the entire "caught on every PR regardless of surface"
    guarantee and nothing asserted it existed;
  - the `ios-derived` cache-key pin, which still read as lock-only while the
    workflow it documents had both;
  - "names EVERY missing pod" and "a Podfile declaring no pods" cases;
  - the script now states its own limits: it reads the Podfile as TEXT and
    cannot evaluate Ruby, so a conditionally- or dynamically-declared pod is
    outside its reach. Neither shape exists today; if one appears, the check
    moves to `pod ipc podfile-json` rather than being loosened.

  Not fixed, with reasons. The guard does not cross-check `PODS:` /
  `SPEC CHECKSUMS:`, so a hand-crafted lock carrying a genuine checksum would
  pass it — `pod install --deployment` remains the real backstop in every iOS
  job, and reimplementing CocoaPods' resolver in bash would be worse than the
  gap. The narrow TOCTOU between the checksum step and the extraction
  pipelines requires the Podfile to be deleted mid-run; recorded, not defended
  against.

  `sonarjs/slow-regex` rejected the first version of the lint-step pin
  (`[\s\S]*?` with a lookahead, then `^\s*if:` under `/m`). Rewritten as line
  slicing plus a prefix test rather than suppressed, and re-proven to kill its
  mutant afterwards.

- Verification after review: **150 suites / 7551 tests** green; eslint
  `--max-warnings=0`, prettier, shellcheck and actionlint clean; **10/10
  mutants killed** across both rounds.

Reviewed-up-to: d234d03d3ab0acb223cda83a26ae3a23ee81dd89

- **2026-08-17 — the outstanding DoD item is now MET, with evidence.**
  Deploy-To-Dev run `32000510087` against develop `5bcc9989291`:

  ```
  success  Install CocoaPods
  success  Build, archive, and export iOS app
  success  Upload to TestFlight
  success  Ensure TestFlight internal-group auto-distribution
  ```

  iOS builds and ships again. Note `Install CocoaPods` **ran** rather than
  being skipped — that is SHY-0305's cache-key fix behaving as designed, since
  adding the Podfile to the key busted the stale Pods cache.

  Timeline across the three attempts, which is the clearest statement of what
  each fix bought:

  | run | iOS outcome |
  | --- | --- |
  | `31964207898` | failed at 9 min — `Unable to resolve module dependency: 'FirebaseAppCheck'` |
  | `31976285312` | failed at 57 min — `type 'AppCheckTokenProviderKt' has no member 'registerAppCheckBridge'` |
  | `32000510087` | **success — archived and uploaded to TestFlight** |

  Status stays `In Review`, not `Done`: Done means the release cut
  ([[feedback-done-equals-release-cut]]).
