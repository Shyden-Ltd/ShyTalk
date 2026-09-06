# Handover — 2026-09-05 (SHY-0500 + SHY-0523 pushed; the merges are the operator's)

Written 2026-09-05 16:00 WIB by the session that finished the SHY-0500 device proof.
Supersedes `2026-09-04-session-handover-shy0500-device-proof.md`.

## What is proven

- **SHY-0500** (PR #2129, `story/SHY-0500-instant-cold-start` at `f964075a9e4`): Android run 5b
  (`journey-results/runs/local-2026-09-05T05-42-02-104Z`, APK 984eb4df0b9) and iPhone run 9
  (`local-2026-09-05T07-20-39-776Z`, build 65bc19f7403) — J40 15/15 on both phones; the core set is
  green except J07 on the iPhone, which is SHY-0522 (pre-existing). No production code changed after
  the proven builds: only runner tests (674c33b539c, b2ab6c7351b), jvmTest reader cleanups
  (9ac896961a6) and story notes.
- **SHY-0523** (PR #2156, `story/SHY-0523-ios-firestore-listener-error-aborts-the-app` at
  `df1635ad267`): fix b588919f303, baseline 959739240a7, notes df1635ad267. Inline review CLEAN;
  iPhone-proven in runs 5 and 9 (no SIGABRT, no new `.ips`).
- Gates at the SHY-0500 HEAD tree: jvmTest 1,812/0 (`--rerun`), jest 540 suites / 15,415 tests
  twice, eslint, prettier, ktlint and kmp-compat clean; pre-push Playwright 1425 passed, 1 flaky,
  37 skipped. CI: at e1dbfe42bb9 (settled 18:25 WIB, 2026-09-05) every check passes — lint / Lint (the SHY-0245 ratchet that failed at f964075a9e4), Pre-Merge Gate, test-backend, integration-tests, qa-runner-driver-checks, Build & Test, Unit Tests, CodeQL, SonarCloud, playwright-web / Playwright (chromium) + Summary + Allure; android-e2e and ios-e2e skipped by design (they run only on PRs into main)..
- Evidence page "SHY-0500 Cold Start Proof" (URL in memory `reference-shy0500-evidence-page`),
  republished with run 9 and the CI line. The iPhone walk video is omitted on purpose: its Settings
  frames carry personal data.

## The lint failure on #2129 and its fix (17:20 WIB)

CI's `lint / Lint` failed at `f964075a9e4` on the SHY-0245 ratchet ("No NEW
fixed-duration waits"): `ios-journey-device.js` 2 > 1. The branch had added a
`const sleep = …` helper to the driver; the ratchet counted the helper's
definition but none of its calls — the runner's own `sleep` helper had been
laundering 29 waits the same way since long before this branch.

Fixed properly, not by bumping the baseline to admit the new wait:

- `express-api/scripts/drivers/poll-until.js` (new) — `pollUntil(probe, accept,
  { intervalMs, deadlineMs | maxLooks })`; the driver's crash-report pull and
  both Airplane Mode waits, and the runner's first-frame and room-list waits,
  poll a condition. The offline soak keeps a reasoned `sleep-ok:` (the soak IS
  the check).
- `scripts/check-no-test-sleeps.sh` now counts `await|return <x>.sleep|delay|pause(`
  and `timers/promises`, honours same-line `sleep-ok: <reason>`; its harness
  proves a helper cannot launder a wait.
- Baseline regenerated at 346 across 62 files; every increase is pre-existing
  debt now visible — **SHY-0524 filed** (Draft, on this handover branch).
- `driver-contract.test.js` lists `poll-until.js` as a helper (the first full
  gate caught that: 6 failures, then green).
- Commits: code `50442bd2c89`, story marker `e1dbfe42bb9`. Full `npm test`
  green after the last JS edit (541 suites / 15440 tests green).

## Why PR #2129 contains SHY-0523

The iPhone abort found by SHY-0500's J40 was fixed on its own branch, and that branch was merged
into the SHY-0500 branch so run 9 could prove both at once. Consequence: on the SHY-0500 branch
`BASE_REF=origin/develop bash scripts/pre-merge-check.sh 2129 --skip-ci-check` refuses with
"51 unreviewed commit(s) since 959739240a7" until #2156 is in develop, because Gate 3 applies every
story marker found in the diff. That is the ONE-story-ONE-PR rule doing its job, not a review gap.
Note the script's default base is `origin/main`; always pass `BASE_REF=origin/develop` for a PR
into develop.

## Next steps, in order (operator)

1. `gh pr merge 2156 --repo Shyden-Ltd/ShyTalk --squash --delete-branch`
2. On the SHY-0500 branch: `BASE_REF=origin/develop bash scripts/pre-merge-check.sh 2129 --skip-ci-check`
   (expect OK), sign off the evidence page, then
   `gh pr merge 2129 --repo Shyden-Ltd/ShyTalk --squash --delete-branch`
3. `gh workflow run deploy-dev.yml --ref develop -f release-notes="Deploy from develop: SHY-0500 instant cold start (room list drawn first, revoke redirect, offline hold) + SHY-0523 iOS Firestore listener guard (no abort after a revoked session)."`
   — if #2155 (SHY-0521 qs 6.16.0) merged in the meantime, name it too.
4. J40 + the core set on dev on both phones (announce before iOS work); then flip the SHY-0500 and
   SHY-0523 notes to Done.
5. Still queued: merge #2154, #2155, #2136 (docs, qs bump, previous handover); SHY-0522 on its own
   branch from develop; then SHY-0520, SHY-0519; SHY-0417 / SHY-0376 after SHY-0518.

## Follow-ups to file (each its own ticket)

- Gate scripts assume the PR targets main: `scripts/pre-merge-check.sh:29` (`BASE_REF` default),
  `.husky/pre-push:46` and `:100`, `scripts/check-pr-story-status.js:82`,
  `scripts/check-large-files.sh --against`. Derive the base from `gh pr view --json baseRefName`.
- detekt scans only commonMain, androidMain and app (root `build.gradle.kts` ~37-43); jvmTest and
  iosMain are unscanned.
- Flaky web test: `tests/web/admin-users-profile.spec.ts:36` "search shows correct seeded user data"
  passed only on retry in the pre-push gauntlet.
- Offline cold start: confirm the claim when the network returns; cache the minimum-version verdict
  locally so a mandatory update can be drawn first.
- SHY-0522: iOS private messages bypass the API, the first DM fails (J07 red on the iPhone).

- **SHY-0524 — FILED (Draft, on this handover branch):** the laundered `sleep` debt the hardened
  SHY-0245 ratchet exposed — 36 unreasoned fixed waits across six files (runner 29, ui-dump-retry,
  safety-audit, lib-google-translate, the two translate scripts). Convert to `pollUntil` or a
  reasoned `sleep-ok:`; regenerate the baseline in the same PR.

## Token economy changes made this session (permanent, operator-driven)

- `~/.claude/settings.json`: `effortLevel` high, `autoCompactWindow` 120000, and a new
  PreToolUse(Agent) hook `~/.claude/hooks/no-review-agents.sh` that refuses review/analysis
  subagents and `fork` (operator opt-in per call: `touch ~/.claude/allow-review-agent-once`).
- Rule: review inline, ONE round per PR, a re-check reads only the fix diff. Measure usage
  including `tasks/*.output`, which the earlier measurement missed.
