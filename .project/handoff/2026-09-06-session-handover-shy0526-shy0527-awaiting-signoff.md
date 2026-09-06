# Handover — 2026-09-06 (SHY-0500 + SHY-0523 deployed; SHY-0526 + SHY-0527 await sign-off)

Written 2026-09-06 12:30 WIB by the session that ran the SHY-0500 dev proof.
Supersedes `2026-09-05-session-handover-shy0500-shy0523-pushed.md`.

## Landed on develop (tip `eec80972dc8`)

- **#2157** handover docs → `b5e84e6b86c`; **#2156 SHY-0523** → `5e1f94247f2`, deploy-dev
  34001508417 SUCCESS; **#2129 SHY-0500** → `7e8902c0d12`, deploy-dev 34004769513 SUCCESS.
  All three merges were operator-run (`gh pr merge` is classifier-denied for the model; see
  memory `reference-auto-mode-classifier-denies-gh-pr-merge`).
- Dev device runs from develop (main checkout `journey-results/runs/`): Android
  `dev-2026-09-06T02-52-39-583Z` J-SMOKE + J02 pass, J08 failed on the daily-reward sheet
  (→ SHY-0527); iPhone `dev-2026-09-06T02-54-12-660Z` J-SMOKE pass, J02/J08 stopped at
  "Land on Home" on the device lock (→ SHY-0526). J40/J09/J07 are not dev-assertable by
  design (SHY-0488). Both stories carry these facts in their Notes (this PR).

## Awaiting the operator's sign-off (evidence pages first, then `gh pr merge`)

- **SHY-0526** PR #2164 (`story/SHY-0526-ios-debug-builds-bypass-device-checks` @ `48a28c23f49`,
  reviewed up to `d6125b9820f`): iOS Debug builds bypass device checks like Android debug builds
  (`bypassDeviceChecks = variant == .local || isDebugBuild`, `#if DEBUG` injected into
  `AppEnvironment.resolve`). Design note: `.release` + a Debug configuration bypasses, the same as
  Android `prodDebug`; Release configurations never define DEBUG. Evidence page:
  https://claude.ai/code/artifact/c786675b-c412-4632-9b07-0e1958d054e2
- **SHY-0527** PR #2165 (`story/SHY-0527-runner-dismisses-the-daily-reward-dialog` @ `d9e9334e7f9`,
  reviewed up to `a6281b9cb75`): the runner dismisses the daily-reward sheet by tag before reading
  the debug overlay, and records what every step cleared (`overlaysCleared` in report.json).
  Local Android `local-2026-09-06T05-19-19-676Z` 5/5 with the sheet dismissed via
  `dailyReward_dismissButton`. Evidence page:
  https://claude.ai/code/artifact/697f66ab-fcab-42e8-b7d5-3bc6ffab854c
- **SHY-0528** PR #2167 (`story/SHY-0528-pre-merge-gate-flags-base-branch-commits` @ `bc234fed864`,
  reviewed up to `d23f0d59c7d`): Gate 3 of `scripts/pre-merge-check.sh` walked
  `git rev-list "${marker}..HEAD"`, which also contains every commit the *base* branch gained since
  the marker — so this very handover branch was refused for nine commits already on develop. Fixed
  three ways: exclude `^${BASE_REF}`, widen the neutral rule to `^\.project/.*\.(md|json)$` (a
  handover and the generated `board-items.json` are tracking documents, a script under `.project/`
  is not), and fail closed when `BASE_REF` does not resolve. Six new tests against real temp repos,
  4 red before the fix, 45/45 after. **No `Reviewed-up-to` marker was bumped anywhere.** Evidence
  page: https://claude.ai/code/artifact/c076c7a5-8c0c-4722-a0e9-7b43d5c53952
- Merge order: **#2167 first** (it unblocks the local gate), then #2166 (this handover), then
  #2164, then #2165 (expect an SHY-INDEX row conflict on the last two; resolve by keeping both
  rows). Then deploy develop naming the story, rebuild the iPhone's Debug-Dev app
  from develop, rerun J-SMOKE/J02/J08 on both phones against dev plus the mandatory core set
  (create a room, mute/unmute, sign-in), add Notes, remove the worktrees
  (`ShyTalk-shy0526`, `ShyTalk-shy0527`, `ShyTalk-shy0528`, `ShyTalk-docs0906`).
- **SHY-0525** (persona credential from one source) is filed, not started.

## Findings the next session must not rediscover

- A green step can assert nothing: the first SHY-0527 local run passed 5/5 while no step recorded a
  dismissal. The `overlaysCleared` trace exists so a page can cite the step that cleared the sheet;
  on the fast local API it is "Land on Home", on dev it must show on "Confirm the phone is signed in".
- Fresh worktrees lack the gitignored `local.properties` and `express-api/.env.local`; copy both
  from the main checkout before the first build. `seed-local.sh`'s own "auth users" line reads the
  wrong endpoint; count via the Auth emulator's `accounts:query` (428 after a good seed). Jest
  wipes the Auth emulator: reseed before every device run.
- The iPhone's TestFlight app was replaced by the local Debug-Dev build (SHY-0526 proof). The
  first iOS device build after an Xcode update spent ~50 min installing the iOS runtime.
- Dependabot alerts are reported against main only; the push banner on a story branch is noise.
- `~/.shytalk/dev-personas.env` still holds a stale `PERSONAS_PASSWORD` line (the working value is
  `dev-personas-credentials`); the operator removes it. The `run-journeys` skill pre-flight still
  reads `dev-personas.env` (SHY-0525 scope). Dev device bindings 10000001/50000010 untouched.
- Classifier ceiling is two denials: `gh pr merge` and the dev admin-API helper were both denied;
  hand those to the operator.

- `scripts/pre-merge-check.sh` defaults `BASE_REF` to `origin/main`; for a PR into develop run it
  as `BASE_REF=origin/develop ./scripts/pre-merge-check.sh`. Unchanged by SHY-0528.

## Memory

`project-shy0500-state-2026-09-05` (updated to this state), `reference-shy0500-evidence-page`,
`project-shy0523-ios-firestore-listener-guard`, `reference-fresh-worktree-needs-gitignored-local-files`,
`reference-auto-mode-classifier-denies-gh-pr-merge`,
`feedback-an-insertion-must-not-orphan-the-comment-above-it` (new — caught twice this session).
