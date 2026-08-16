# Session handoff — 2026-08-16

Durable state for the next session. Do not rely on chat scrollback.

**Read `.claude_learnings.md` at the repo root first** — it is the standing
ledger of operating rules shyden has set, and it now governs how work is done
here (TDD contract, zero-defect/no-deferral, never stop mid-queue).

---

## Shipped to develop today

Four stories merged, in this order. `develop` tip is `521ae15454f`.

| PR | Story | Squash |
|---|---|---|
| #1751 | SHY-0298 — gh-pages writers made concurrency-safe | `72b3d07d821` |
| #1752 | SHY-0143 — cold start checks bans, resolves identity, refreshes cohort | `a67287ec3a2` |
| #1755 | SHY-0300 — App Check on the unauthenticated ban gate | `521ae15454f` |

Dev was deployed after each merge (backend, web, Android, persona seed, sanity,
smoke all green). **iOS TestFlight failed on every attempt** — that is SHY-0303
below, now fixed and in review.

## Open right now

| PR | Story | State at handoff |
|---|---|---|
| **#1758** | SHY-0299 — a geo blip must not erase a device's known ASN | BLOCKED; only the 5 Playwright projects outstanding, everything else green |
| **#1759** | SHY-0303 — iOS deploys die before building anything | BLOCKED; only `test-backend / Test Backend` outstanding |

Neither has a failing check. Both were waiting on CI when the session ended.

**Next action:** wait each to `mergeStateStatus == CLEAN`, then
`BASE_REF=origin/develop bash scripts/pre-merge-check.sh <PR> && gh pr merge <PR> --squash --delete-branch`,
then dispatch Deploy-To-Dev against develop. Chain the gate with `&&`, never
`;` — `;` merges even when the gate refuses.

**Local branch at handoff:** `story/SHY-0303-ios-runtime`, clean, pushed.

---

## The one defect I had queued and did NOT get to

**`50-matrix-cmd-stop.test.js` is flaky by construction — a cross-file test
isolation leak.**

It scans for live `manual-qa-runner.js` processes **by process name**, and five
sibling suites spawn exactly that binary:

```
manual-qa-runner-shard-flag.test.js
manual-qa-runner-dry-run.test.js
manual-qa-runner-help-version.test.js
manual-qa-runner-smoke-flag.test.js
manual-qa-runner.test.js
```

Jest runs ~150 suites in parallel workers, so `cmd_stop` sees a sibling's child
and honestly reports "runner(s) STILL alive". Caught in the act: PID `24980`,
command line `manual-qa-runner.js --matrix --target local --shard`, which is
`manual-qa-runner-shard-flag.test.js`'s.

It passes in isolation (9/9) and fails intermittently in a full
`tests/scripts/` run. **This is a real defect under the repo's HARD
test-isolation rule and shyden's zero-defect policy — take it next, do not
file-and-forget.** Likely fix: scope the reaper's match to the run_id it owns
rather than the binary name (`50-matrix.sh` already has a run_id concept).

---

## Filed, refined, not started

| Story | Pri | What |
|---|---|---|
| SHY-0301 | P1 | The stuck-run reaper lists `status=queued` only and is blind to `pending`. Cost #1752 two hours BLOCKED with no failing check to look at. |
| SHY-0302 | P2 | `lib.sh:61` tests `[ -d "$REPO/.git" ]`, false in a linked worktree (`.git` is a FILE there), so every gauntlet command dies "repo not found". |

**A note lifted out of #1758 and NOT yet re-landed** — it lives at
`/private/tmp/.../scratchpad/SHY-0301-sonar-headroom-note.md` (volatile) and is
reproduced here so it survives:

> `sonarcloud.yml` sets `timeout-minutes: 15`. Measured SonarCloud Analysis
> durations: **8m37s**, **9m46s**, then **15m04s** killed by the cap — on a
> commit whose code had already passed the same job forty minutes earlier. A
> re-run passed. Roughly five minutes of headroom over an already-variable job,
> and when exceeded it presents as `##[error]The operation was canceled`, which
> reads like an infrastructure incident rather than a timeout.

Re-add that to SHY-0301's Notes when SHY-0301 is picked up. It could not ride
in #1758: **the CI pre-merge gate refuses a PR that MODIFIES a story still in
Draft** — the filing exemption only covers newly-ADDED ones.

---

## Waiting on shyden — blocks App Check enforcement, nothing else

SHY-0300 shipped in **monitor mode**, which refuses nobody and records
outcomes. It cannot be enforced until:

1. **Play Integrity and App Attest enabled** in the Firebase console for
   `shytalk-dev` and `shytalk-7ba69`.
2. **A debug token registered** for local builds.
3. **`pod install`** run for the new `FirebaseAppCheck` pod (iOS).

Until then the client obtains no token and the server records `missing` — the
designed-for state, not a failure. Flip with `APP_CHECK_MODE=enforce` once the
attested share is healthy; read it from the authenticated
`GET /api/system/app-check`.

**Also outstanding:** `gh run cancel` is blocked by the permission classifier.
It came up when a wedged run left #1752 BLOCKED for two hours. It cleared
itself, but clearing stuck CI needs a Bash permission rule.

---

## Deferred by shyden's explicit decision — do not relitigate

> *"merge both on ci green. we already decided to finish all the mvp tickets
> before running the gauntlet against everything so you can keep moving"*
> — 2026-08-16

The full device + browser gauntlet runs **once against the whole MVP set before
the release cut**, not per story. SHY-0143, SHY-0299 and SHY-0300 are backend
and/or client changes that would each normally demand it. They are merged
without it, deliberately, and **none is eligible for `Done` until it passes
that batch run**. This is recorded in each story's Notes.

Carried into that run specifically:
- cold-start path on a real Android device and a real iPhone (ban check,
  unresolved identity, cohort refresh) — SHY-0143's own DoD asks for it;
- a real App Check token obtained on real hardware — SHY-0300's acceptance
  test, and it cannot be proven on an emulator or simulator.

---

## Residuals worth checking, with what to look for

**SHY-0298 — the history cap's WRITE path has not run in production.** The
merge run reported `gh-pages history: 22 commit(s); cap threshold: 25`, so it
took the quiet path. It is ~3 publishes from firing.

- With the pre-merge code that run would have **failed** (`fatal: bad object`).
- With this code it should print `capped gh-pages: 26 commits -> 1 (tree unchanged)`.
- If it instead prints `tip moved` every time, the failure classification is
  wrong again.

The step is `continue-on-error`, so either way it cannot red-gate a PR.

---

## Two things about this codebase that cost real time today

**1. A workflow `run:` block is code nobody runs.** Regex pins over YAML tell
you the shape is right and nothing about whether it works — a loop that retries
zero times satisfies every one of them. Extracting the block and executing it
against canned tools found **three production defects** in one day:

- the gh-pages cap built its orphan through the Git Data API, so the object
  existed only server-side and the `--depth=1` clone that had to push it could
  not read it (`fatal: bad object`) — it would have reported "tip moved"
  forever while never capping once;
- `git commit-tree` ran in a fresh clone with no author identity and the runner
  has no global one (`fatal: empty ident name`) — it passed locally only
  because macOS git could synthesise one from the account;
- `xcodebuild -downloadPlatform iOS` was unconditional and has now failed in
  **both** directions from the same cause: it never asked what was installed.

**2. A source-reading pin matches text that is not code.** Three near-misses in
one story — a pin matched an `import` line after the call it checked was
deleted, and twice it matched its own KDoc quoting the call. Filter comments
**and** imports, assert a syntactic form (`header(APP_CHECK_HEADER`) not an
identifier, then mutate the code and watch it redden.

Both are written up in `.claude_learnings.md`.

---

## Verification commands that actually work here

```sh
# CI-structure suites (the ones most of today's work touched)
cd express-api && npm test -- tests/scripts/

# actionlint MUST use CI's options or it reports two SC2086 infos CI excludes
SHELLCHECK_OPTS='-e SC2086' actionlint

# a jvmTest source-reading pin needs --rerun-tasks OR its inputs declared,
# or Gradle reports BUILD SUCCESSFUL having run nothing
./gradlew :shared:jvmTest --tests "*AppCheckWiringPinTest*" --rerun-tasks
# then confirm from the XML, never from the console:
#   shared/build/test-results/jvmTest/TEST-*.xml  → tests= / failures=

# PR readiness — exit code is NOT the verdict; read the text
bash ~/.claude/scripts/wait-pr-checks.sh <PR> 2200 120   # FOREGROUND
```
