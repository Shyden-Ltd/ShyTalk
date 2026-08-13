---
id: SHY-0294
status: In Review
owner: claude
created: 2026-08-13
priority: P1
effort: XS
type: infra
roadmap_ids: []
pr: https://github.com/Shyden-Ltd/ShyTalk/pull/1734
mvp: false
---

# SHY-0294: The iOS build fails because the runner upgraded CocoaPods

## User Story

As the operator promoting `develop` to `main`,
I want `ios-e2e / Build iOS` to pass,
So that the promotion is not blocked by a tool upgrade that changed no
dependency.

## Why

`ios-e2e / Build iOS` fails on PR #1652 (the develop→main promotion) at the
`Install CocoaPods` step:

```
[!] There were changes to the lockfile in deployment mode:
COCOAPODS:
  New Lockfile: 1.17.0
  Old Lockfile: 1.16.2
```

**No dependency changed.** `pod install --deployment` refuses _any_ lockfile
change, and the only difference is the `COCOAPODS:` stamp at the bottom of
`iosApp/Podfile.lock` — the record of which CocoaPods version wrote the file.
The GitHub macOS runner image upgraded CocoaPods from 1.16.2 to 1.17.0, so the
file our repo committed no longer matches what the runner's tool would write.

Nothing in the repository moved. The ground did.

The fix is to bring the committed lockfile up to the version now in use.
Verified by running the real tool at the real version rather than editing the
line by hand: `pod install` under CocoaPods 1.17.0 locally produces a one-line
diff, and touches no other tracked file.

```diff
-COCOAPODS: 1.16.2
+COCOAPODS: 1.17.0
```

Every SPEC CHECKSUM, the PODFILE CHECKSUM, and all 27 resolved pods are
byte-identical. `iosApp/iosApp.xcodeproj/project.pbxproj` is **not** modified —
important, because `pod install` can rewrite it and churning it risks the
device-signing configuration.

## Acceptance Criteria

### Happy path

- [ ] `pod install --deployment` succeeds on the runner, so
      `ios-e2e / Build iOS` reaches the actual build.
- [ ] `iosApp/Podfile.lock` records `COCOAPODS: 1.17.0`.

### Error paths

- [ ] `--deployment` is retained at both sites that use it
      (`ios-tests.yml`, `deploy-dev.yml`). The lockfile stays the source of
      truth; this story updates the lockfile, it does not weaken the check that
      enforces it.

### Edge cases

- [ ] No SPEC CHECKSUM, no PODFILE CHECKSUM, and no resolved pod version
      changes — the diff is exactly one line.
- [ ] `iosApp/iosApp.xcodeproj/project.pbxproj` is unchanged, so no
      device-signing churn ([[feedback-never-churn-working-device-signing]]).

### Performance

- N/A — a one-line data change. No step is added or removed, so CI wall-clock
  is unaffected.

### Security

- N/A — no dependency, version, or checksum changes; the pinned pod set is
  byte-identical, so the resolved supply chain is untouched.

### UX

- N/A — build tooling with no user-facing surface.

### i18n

- N/A — no user-facing strings.

### Observability

- [ ] The failure was already loud and precise: CocoaPods named the file, the
      old value, and the new one. No observability change is needed, and the
      diagnosis took one log read.

## BDD Scenarios

**Scenario: the iOS build gets past CocoaPods**

- **Given** a runner whose CocoaPods is 1.17.0
- **When** `pod install --deployment` runs against the committed lockfile
- **Then** it exits 0 rather than reporting lockfile changes in deployment mode

**Scenario: the lockfile change is the stamp and nothing else**

- **Given** the committed `iosApp/Podfile.lock`
- **When** the diff against the previous revision is inspected
- **Then** exactly one line differs, and it is the `COCOAPODS:` stamp

## Test Plan

**Verification is by running the real tool, not by inspection.** CocoaPods
1.17.0 — the same version the runner image now ships — was installed locally
and `pod install` run against the real `iosApp/Podfile`:

- exit 0
- `git status iosApp` reports exactly one modified tracked file: `Podfile.lock`
- `git diff iosApp/Podfile.lock` is one line: the `COCOAPODS:` stamp

**Frameworks run:** the change is a lockfile data line. The gate that proves it
is `ios-e2e / Build iOS` in CI, which is precisely the job that was failing.

**Classification:** not `*.md`-only. It is build tooling with no app, backend,
or website runtime surface — no product code changes, so the device/browser
gauntlet exercises nothing related to it. The relevant gate is the iOS build
job itself.

## Out of Scope

- **Pinning CocoaPods to the version the lockfile names.** The durable
  alternative is a CI step that reads the `COCOAPODS:` stamp and installs that
  exact version, making the repo authoritative over the runner image. It would
  make this class of break impossible rather than periodic. It is deliberately
  not bundled here: it touches four `pod install` sites across three workflows
  (`ios-tests.yml`, `deploy-dev.yml`, `deploy-prod.yml` ×2) plus the meta-tests
  that pin CI structure, and it also freezes the toolchain rather than
  following the image — a real trade-off that deserves its own review rather
  than riding along with a promotion unblock. See Notes for the counter-argument.
- **`deploy-prod.yml`'s two plain `pod install` calls** (no `--deployment`).
  They would silently regenerate the lockfile in CI rather than fail on a
  mismatch, which is a weaker guarantee than the other two sites. Worth
  aligning, separately.
- The FirebaseCore CocoaPods deprecation warning surfaced by `pod install`
  ("no new versions published to CocoaPods after October 2026"). Real, dated,
  and much larger than this story.

## Dependencies

- None.
- Blocks: PR #1652 (develop→main promotion) — this is one of its two remaining
  failures, alongside `playwright-web / Playwright (webkit)`.

## Risks & Mitigations

- **Risk:** the one-line edit is not what `pod install` would actually produce,
  leaving `--deployment` still red.
  **Mitigation:** it was not an edit. The real tool at the real version
  generated the file; the diff is its output.
- **Risk:** `pod install` rewrites `project.pbxproj` and churns device signing.
  **Mitigation:** verified it did not — `git status iosApp` shows only
  `Podfile.lock`. The tree was clean before the run, so the check is meaningful.
- **Risk:** this recurs at the next runner-image CocoaPods bump.
  **Mitigation:** accepted, and recorded above with the durable alternative.
  The failure is loud and self-describing, so the recurrence costs one log read
  and one `pod install` — not a diagnosis.

## Definition of Done

- [ ] `iosApp/Podfile.lock` records `COCOAPODS: 1.17.0`; diff is one line.
- [ ] `pod install` verified locally at 1.17.0, exit 0, pbxproj untouched.
- [ ] Status flipped to `In Review` before merge.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] `ios-e2e / Build iOS` passes.
- [ ] Merged to `develop`.

## Notes

**2026-08-13** — Found while clearing blockers on PR #1652. `ios-e2e / Build
iOS` had been failing at 12m24s; the failing step was `Install CocoaPods` and
the log tail showed only post-job cleanup, so the cause needed the step's own
output rather than the tail.

The counter-argument to pinning, recorded so the follow-up is decided on
merit rather than reflex: runner images update CocoaPods deliberately, and
following them is normal maintenance. Pinning inverts that and freezes the
toolchain until someone remembers to bump it. On that reading the real gap is
not that we follow the image — it is that we discovered the drift through an
unrelated PR's red build instead of through a signal that says "the runner's
CocoaPods moved". Detection, not pinning, may be the better fix. Either way it
is a separate decision.

Worth recording for the next occurrence: the diagnosis is cheap because
CocoaPods names the file, the old value and the new value. The expensive part
was that a promotion was blocked on it silently — the job had been red long
enough that its cause had stopped being read.

**2026-08-13, PR #1734 pushed.** Full local gate green through `.husky/pre-push`
(Playwright chromium 1420 passed / 1 flaky / 38 skipped).

Reviewed-up-to: 3306f5a402e

Review was a self-review against the diff rather than a `code-reviewer` agent
dispatch, per the operating instruction in force this session. The diff is one
line of generated lockfile data.
