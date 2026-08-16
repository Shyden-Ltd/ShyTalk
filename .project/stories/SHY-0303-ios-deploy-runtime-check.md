---
id: SHY-0303
status: In Review
owner: claude
created: 2026-08-16
priority: P1
effort: S
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0303: Every iOS deploy to dev dies before it builds anything

## User Story

As a **developer needing iOS on dev**, I want the deploy's runtime-install step
to succeed or correctly skip, so that **the iOS half of the gauntlet can run at
all** instead of every deploy reporting a failure that has nothing to do with
the code being deployed.

## Why

`Distribute iOS to TestFlight` fails at the step **`Ensure iOS platform runtime
is installed`**, which runs `sudo xcodebuild -downloadPlatform iOS`. Output,
identical on both observed runs:

```
Finding content...
Unable to connect to simulator.
##[error]Process completed with exit code 70.
```

**Reproducible, not a flake.** Two consecutive dispatches against the same
`develop` tip failed identically (runs `31955605141` at 15:25Z and
`31958212267` at 16:19Z, 2026-08-16). Earlier the same day two runs of the
same workflow SUCCEEDED (`31946323528`, `31946381627`, both ~12:10Z), and one
failed on 2026-08-14 (`31832143087`) — so the runner image or the Apple-side
service changed state during the day.

**Everything else in the deploy succeeds:** backend, web, Android
distribution, persona seeding, the dev sanity check and the dev smoke tests
all pass. Dev is therefore correct for every surface EXCEPT iOS, which makes
the failure easy to mistake for a broken deploy when it is one job.

**Why it matters now.** The MVP gauntlet requires a real iPhone running the
dev build. No iOS build reaches TestFlight, so that half of the matrix cannot
run, and the develop→main promotion is gated on it.

**This step has previous form.** Its own comment in the workflow records an
earlier incident in the opposite direction: `xcodebuild -downloadPlatform iOS`
"exited 0 as a no-op" because *an* iOS platform was present but not the
required 26.0, and every archive then died after a ~20-minute build. So the
step has already been wrong by passing; now it is wrong by failing. Both
failures share a cause — it does not check WHICH runtime is present before
acting.

## Acceptance Criteria

### Happy path

- [ ] When the required iOS runtime is already installed, the step SKIPS the
      download and reports which version it found.
- [ ] When it is genuinely absent, the step installs it and the deploy
      continues.
- [ ] A successful deploy distributes an iOS build to TestFlight, as it did on
      2026-08-16 at ~12:10Z.

### Error paths

- [ ] `Unable to connect to simulator` while a SUFFICIENT runtime is already
      present is not fatal — the step reports the condition and proceeds,
      because there is nothing to download.
- [ ] A genuine install failure with NO sufficient runtime present still fails
      the job, loudly, naming the version it needed and the versions it found.
- [ ] The step never exits 0 having installed nothing when the required
      runtime is missing — the 2026-08 regression the workflow comment
      records.

### Edge cases

- [ ] Several iOS runtimes installed: the check asserts the REQUIRED version
      specifically, never "an iOS platform exists"
      ([[feedback-version-picked-by-text-sort-selects-the-oldest]]).
- [ ] Version comparison is numeric, not lexicographic — `26.10` is newer than
      `26.9`, and a text sort says otherwise.
- [ ] A runner image that ships a NEWER runtime than required satisfies the
      check rather than triggering a download.

### Performance

- [ ] The skip path costs one `xcodebuild -showsdks` / `simctl list runtimes`
      call, versus the multi-minute download it replaces.

### Security

- [ ] N/A — no credential, secret or user data is involved; the step installs
      an Apple platform runtime on an ephemeral runner.

### UX

- [ ] The step's log states the required version, the versions found, and the
      decision taken, so a future failure is diagnosable from the log alone
      rather than by reading the script.

### i18n

- [ ] N/A — CI operator output, English-only by design.

### Observability

- [ ] A skip and an install are distinguishable in the log, so "the runtime
      was already there" is never confused with "we installed it"
      ([[feedback-absence-of-work-reported-as-success]]).

## BDD Scenarios

**Scenario: the runtime is already present**

- **Given** a runner whose installed iOS runtimes include the required version
- **When** the deploy reaches the runtime-install step
- **Then** it skips the download, logs the version it found, and continues

**Scenario: the download service is unreachable but the runtime is present**

- **Given** the required runtime is installed and `xcodebuild -downloadPlatform`
  would fail with "Unable to connect to simulator"
- **When** the step runs
- **Then** the deploy continues, because there was nothing to download

**Scenario: the runtime is genuinely missing**

- **Given** a runner with no sufficient iOS runtime
- **When** the install fails
- **Then** the job fails, naming the required version and the versions found

**Scenario: a newer runtime satisfies the requirement**

- **Given** a runner shipping a newer iOS runtime than the one required
- **When** the step runs
- **Then** it skips the download rather than trying to install an older one

## Test Plan

**CI-config-only classification:** confined to `.github/workflows/**` /
`.github/actions/**` and its pin tests — no app, backend or website runtime
surface.

**RED first**, in `express-api/tests/scripts/ios-runtime-ensure.test.js` (new).
The step's shell is EXTRACTED and EXECUTED against a canned `xcodebuild` /
`xcrun` on PATH, as `allure-report-gh-pages-cap-script.unit.test.js` does —
a regex over the YAML cannot tell a correct version check from one that
matches any runtime, which is precisely the defect:

- `a present required runtime skips the download` — the canned tool reports
  26.0 installed; assert `-downloadPlatform` is never invoked.
- `a NEWER runtime also skips`.
- `26.10 is treated as newer than 26.9` — numeric comparison.
- `an absent runtime triggers the install`.
- `a download failure with the runtime present is NOT fatal` — reproduces the
  observed "Unable to connect to simulator" exit 70 and asserts exit 0.
- `a download failure with the runtime ABSENT fails, naming the versions`.
- `the step never exits 0 having installed nothing when the runtime is missing`.

**Mutation checks** — each pin shown to fail against a mutant: compare
lexicographically; check for "any iOS platform" rather than the version;
swallow the failure unconditionally; drop the numeric comparison.

**Live proof** — dispatch Deploy-To-Dev against develop and observe an iOS
build actually reach TestFlight. The unit suite proves the logic; only a real
dispatch proves the runner agrees.

## Out of Scope

- The Xcode version pin itself, and `SHY-0195`'s deploy-pipeline work.
- The ~20-minute iOS archive time.
- Anything about the Android or web halves of the deploy, which pass.

## Dependencies

- `.github/workflows/deploy-dev.yml` — the `Distribute iOS to TestFlight` job.
- The GitHub macOS runner image, which is the thing that changed. The fix must
  therefore not depend on the image's current contents.

## Risks & Mitigations

- **Risk:** the skip is too permissive and lets a build proceed without the
  runtime it needs, reproducing the 2026-08 regression from the other side.
  **Mitigation:** the check asserts the REQUIRED version numerically, and the
  "never exits 0 having installed nothing" case has its own test and its own
  mutant.
- **Risk:** the real cause is Apple-side and returns whatever the step does.
  **Mitigation:** the skip path makes the deploy independent of the download
  service whenever the runtime is already present, which is the common case on
  a pre-provisioned image.
- **Risk:** fixed and pinned but never actually exercised, which is how the
  earlier no-op regression survived. **Mitigation:** the tests EXECUTE the
  extracted step, and the DoD requires an observed TestFlight upload.

## Definition of Done

- [ ] RED tests written and observed failing before the fix.
- [ ] The step skips when the required runtime is present and fails loudly
      when it is genuinely missing.
- [ ] Every new pin proven to fail against its mutant.
- [ ] `actionlint` (shellcheck present), `eslint --max-warnings=0`, prettier.
- [ ] A real Deploy-To-Dev dispatch puts an iOS build on TestFlight.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to:` recorded.
- [ ] Status → In Review → judgment-merge → deploy develop to dev.

## Notes (running log)

- **2026-08-16 — filed from two consecutive failures**, not from reading.
  Runs `31955605141` and `31958212267` on the same `develop` tip both died at
  `sudo xcodebuild -downloadPlatform iOS` with `Unable to connect to
  simulator` / exit 70. Two runs of the same workflow succeeded ~3 hours
  earlier, so the runner image or the Apple-side service changed state during
  the day. Every other job in both deploys passed, so dev is current for
  backend, web and Android.
- The step is reached BEFORE any build, so it cannot be caused by application
  changes — checked, because SHY-0300 had just added a `FirebaseAppCheck` pod
  in the same window and the coincidence would otherwise be suggestive.
- **2026-08-16 — FIXED, same session it was found.** shyden'''s zero-defect
  policy: a live pipeline defect is not triaged, it is fixed. The step now
  queries `xcodebuild -showsdks`, skips when an SDK >= 18 is present, installs
  only when it is genuinely missing, and RE-READS afterwards because exit 0 is
  not evidence the SDK arrived — that no-op is how the earlier regression
  shipped.

  Five mutants verified: lexicographic sort, any-SDK-satisfies, swallow a
  failed download, trust exit 0, and download unconditionally (the original
  one-liner). The ordering test initially supplied ONE version and could not
  have failed under a plain `sort`; it now supplies 26.9 AND 26.10.

  A harness bug surfaced on the way: the canned `xcodebuild` shim read its
  state file with `while read -r v`, which returns non-zero on a final line
  with no trailing newline, so it reported NO SDKs — indistinguishable from
  the step failing to detect a present one.

  actionlint is clean under CI'''s own options (`SHELLCHECK_OPTS=-e SC2086`);
  a bare local invocation reports two pre-existing SC2086 infos that CI
  excludes repo-wide by design.
