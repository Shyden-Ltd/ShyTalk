---
id: SHY-0524
status: Draft
owner: claude
created: 2026-09-05
priority: P2
effort: M
type: refactor
roadmap_ids: []
mvp: false
---

# SHY-0524 — Fixed-duration waits still hide behind `sleep` helpers in the journey tooling

## User Story

As **a developer running the device journeys and the locale tooling**, I want
every wait in the journey runner and the scripts to end the instant its
condition holds, so that a run is as fast as the device allows and never
passes or fails on the clock.

## Why

SHY-0500's CI failure (PR #2129, `lint / Lint`, 2026-09-05) showed that the
SHY-0245 ratchet only ever counted literal `setTimeout` promises. The runner's
`const sleep = (ms) => …` helper hid **29** `await sleep(...)` calls, and five
more files hid theirs the same way. PR #2129 hardened the pattern (a helper is
now counted at every call: `await|return <x>.sleep|delay|pause(`, plus
`timers/promises`) and regenerated the baseline to **346 across 62 files**.
The newly visible entries are the debt this story pays down:

| File | Baseline | What is there |
| --- | --- | --- |
| `express-api/scripts/device-journey-runner.js` | 30 | 29 legacy `await sleep(...)` (600/900/400/1000/300 ms after taps; `sleep(owed)` catch-up) + the reasoned offline soak |
| `express-api/scripts/drivers/ui-dump-retry.js` | 2 | `await sleep(backoffMs)` — a genuine retry backoff |
| `express-api/tests/safety/safety-audit.test.js` | 2 | `await sleep(50)` |
| `express-api/tests/scripts/lib-google-translate.test.js` | 1 | `await sleep(50)` |
| `scripts/translate-strings.js` | 2 | `await sleep(100)` quota pacing |
| `scripts/translate-admin-strings.js` | 1 | `await sleep(100)` quota pacing |

`pollUntil(probe, accept, { intervalMs, deadlineMs | maxLooks })` in
`express-api/scripts/drivers/poll-until.js` is the replacement primitive; a
wait whose duration IS the check (a soak, a quota interval, a backoff) stays
fixed under a same-line `// sleep-ok: <reason>`.

## Acceptance Criteria

### Happy path

- [ ] Every `await sleep(...)` in `device-journey-runner.js` is either replaced
      by `pollUntil` with a named condition and a named interval constant, or
      carries a same-line `sleep-ok: <reason>` naming why the duration itself
      is the check. The runner's `sleep` helper is deleted.
- [ ] The five other files are converted the same way; `ui-dump-retry.js`'s
      backoff and the translate scripts' quota pacing are expected to become
      reasoned `sleep-ok` exemptions, not polls.
- [ ] `scripts/no-test-sleeps-baseline.json` is regenerated in the same PR
      (the ratchet's shrink rule fails otherwise) and the total falls by at
      least the 36 unreasoned waits above.
- [ ] `.husky/pre-push` runs `scripts/check-no-test-sleeps.sh . --baseline …`
      (about one second) before anything slower, so the next laundered wait is
      refused locally instead of by CI, as happened at `f964075a9e4`.

### Error paths

- [ ] A poll whose condition never holds fails with a message naming the
      screen, the condition awaited and the bound — never a silent continue.
- [ ] Probe errors propagate unchanged; no converted site catches and
      continues (pinned already in `poll-until.test.js`).

### Edge cases

- [ ] A wait that gated a UI animation (`sleep(600)` after a tap) becomes a
      probe of the post-animation state, not a shorter sleep.
- [ ] `sleep(owed)` catch-up waits become a deadline-bounded poll or a
      reasoned exemption; `sleep(0)`-style yields are removed.
- [ ] A condition that already holds on the first look costs no pause at all.

### Performance

- [ ] J40 and the core set on the Android phone and the iPhone complete no
      slower than before the change and faster wherever a condition holds
      early; per-journey durations before/after (from `report.json`) are
      recorded in Notes.

### Security

- [ ] No change to auth, personas or device credentials. The ratchet step in
      `lint.yml` is untouched and still refuses any new fixed wait.

### UX

- [ ] Every new failure message reads as one sentence a tester can act on
      (which screen, what was awaited, for how long).

### i18n

- [ ] No user-facing string changes. The translate scripts produce
      byte-identical locale output on a dry run before and after.

### Observability

- [ ] A converted wait that needed more than one look logs `looks` and
      `elapsedMs` at debug level, so a slow device shows where time went.

## BDD Scenarios

**Scenario: The ratchet counts every laundered wait**

- **Given** the hardened `check-no-test-sleeps.sh` from PR #2129
- **When** it runs against the converted tree with the regenerated baseline
- **Then** it reports the new total, at or below baseline, with zero growth in
  any file

**Scenario: A tap's follow-up state arrives early**

- **Given** a journey step that used to `sleep(600)` after tapping a button
- **When** the next screen renders after 120 ms
- **Then** the step continues at the first look that sees it and the journey
  finishes sooner than before

## Test Plan

- Jest: one unit test per converted site (real script or driver method,
  scripted probes, no timing assertions on wall-clock beyond the bound).
- `bash scripts/check-no-test-sleeps.sh . --baseline scripts/no-test-sleeps-baseline.json`
  green after the regeneration; the harness test asserts the runner's count.
- Full `npm test` in `express-api/` after the last JS edit.
- Local J40 + core set on both phones, then dev after the develop deploy.

## Out of Scope

- Kotlin `delay(` calls in app code — a separate ticket if any are found.
- The single `sleep-ok` line inside `poll-until.js` itself.

## Dependencies

- PR #2129 (SHY-0500) merged to `develop` — it carries `poll-until.js` and the
  hardened ratchet this story builds on.

## Risks & Mitigations

- Risk: a wait that encoded a real timing requirement (a debounce) gets
  replaced by a probe that passes too early. Mitigation: every conversion
  names the condition probed; where none exists, keep a reasoned `sleep-ok`
  rather than invent a probe.
- Risk: shortening the runner's waits exposes flaky steps on the slower phone.
  Mitigation: deadlines stay as long as the old sleeps; only the early exit
  changes.

## Definition of Done

- [ ] Merged to `develop`, all checks green, deployed to dev.
- [ ] Baseline regenerated; runner entry at or below its reasoned soaks.
- [ ] J40 + core set green on both phones, local then dev; evidence page
      linked in Notes.

## Notes

- 2026-09-05 17:15 WIB — **Filed** from the SHY-0500 lint failure at
  `f964075a9e4`: the driver's new `sleep` helper tipped the ratchet to 2 > 1
  and the investigation found the runner's helper had laundered 29 waits.
