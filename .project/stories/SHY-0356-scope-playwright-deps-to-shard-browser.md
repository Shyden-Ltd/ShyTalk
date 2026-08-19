---
id: SHY-0356
status: In Review
owner: unassigned
created: 2026-08-19
priority: P1
effort: S
type: infra
roadmap_ids: []
mvp: true
---

# SHY-0356: A browser shard installs every other browser's dependencies

## User Story

As a **developer waiting on CI**, I want each browser shard to install only the
packages that browser actually needs, so that a slow mirror has three times less
to deliver and a healthy run stops paying for downloads nothing will open.

## Why

**Measured on PR #1696, run `32238343275`, job `Playwright (chromium)`:**

```
10:15:48  Get:59 .../noble/universe amd64 libflite1 amd64 2.2-6build3 [13.6 MB]
10:22:55  ##[error]The action 'Install system dependencies' has timed out after 15 minutes.
```

`libflite1` is a **WebKit** dependency. Playwright's own manifest
(`playwright-core`, `ubuntu24.04`) lists it under `webkit:` and nowhere else.
It was being downloaded by the **chromium** shard, which will never launch
WebKit, because `.github/workflows/playwright-tests.yml:194` runs

```
npx playwright install-deps
```

with **no browser argument** — which means "every browser".

Per that manifest, on `ubuntu24.04`:

| Browser | apt packages |
| --- | --- |
| chromium | 21 |
| firefox | 25 |
| **webkit** | **52** |

Every one of the five shards installs the union. WebKit's half is the expensive
half — it is the GStreamer/ffmpeg media stack (`libflite1` 13.6 MB,
`libavcodec60` 5.8 MB, `libass9`, `libbluray2`, `libopenmpt0t64`, `libx265-199`,
`libzvbi0t64`), and chromium's own 21 were all reported
`already the newest version` by the same log.

**This is a different failure mode from [SHY-0334], whose fix was in force in
this very run.** `harden-apt` bounds an *inactive* socket at 30 s. This mirror
was never inactive — it delivered, slowly, right up to the step ceiling. A wait
that is bounded per-fetch is still unbounded in aggregate when there are 98
fetches. SHY-0334 anticipated exactly this in its own Risks table
("a slow-but-working mirror") and mitigated it with retries; retries do not help
when nothing ever fails.

Bounding the wait was correct and stays. This story removes the **bytes** — the
only lever that makes a slow mirror cheaper rather than merely better-behaved.

## Acceptance Criteria

### Happy path

- [x] Each browser shard installs the dependency set for **its own** browser only.
- [x] A `chromium` shard's install log contains no WebKit-only package.
- [x] The five Playwright projects each resolve to a real Playwright browser name.

### Error paths

- [x] An unknown or misspelled project name fails the step loudly, rather than
      silently falling back to installing everything.
- [x] Removing the scoping turns exactly one named test RED (mutation-proven).

### Edge cases

- [x] `mobile-chrome` and `mobile-safari` are Playwright **projects**, not
      browsers; they map to `chromium` and `webkit` respectively and are covered
      by name, not by prefix-guessing.
- [x] A sixth project added to the matrix without a mapping fails the test rather
      than silently installing the union.
- [x] The guard is not vacuous: it asserts the matrix is non-empty, so emptying
      the matrix cannot make it pass trivially.

### Performance

- [ ] The chromium, firefox, mobile-chrome shards no longer download WebKit's
      media stack. Recorded as a before/after byte count in the story Notes from
      a real run, not estimated.

### Security

- [ ] N/A — narrows an install set. No credential, permission or package-source
      change; mirrors and pins are untouched.

### UX

- [ ] N/A — CI-internal. The developer-facing outcome is fewer red gates on PRs
      that are fine.

### i18n

- [ ] N/A — no user-facing strings.

### Observability

- [x] The resolved browser name is echoed before the install, so a log reader can
      see which set was requested without inferring it from the packages.
- [x] The mapping carries the measured evidence above in a comment, so the next
      reader meets the numbers rather than a bare argument.

## BDD Scenarios

**Scenario: A browser test run only fetches what that browser needs**

- **Given** a test run is scheduled for one browser
- **When** the run prepares that browser
- **Then** it fetches only that browser's requirements

**Scenario: An unrecognised browser stops the run**

- **Given** a test run names a browser the system does not recognise
- **When** the run prepares that browser
- **Then** it stops and says which name it did not recognise

## Test Plan

**RED first.** The failing state is measured above with timestamps and a run id.

### Node / Jest — `express-api/tests/scripts/playwright-deps-scoping.test.js`

- `the web matrix is non-empty — the guard is not vacuous`
- **`every matrix project maps to a known Playwright browser`** — per project
- **`install-deps is invoked WITH a browser argument`**
- `the mapping covers exactly the matrix — no orphan entries, no missing ones`
- `an unknown project name is rejected rather than defaulted`
- `webkit-only packages are absent from the chromium set` — asserted against
  `playwright-core`'s own manifest as the oracle, not a hardcoded list

### Mutation proof

| Mutation | Must kill |
| --- | --- |
| browser argument removed from `install-deps` | `install-deps is invoked WITH a browser argument` |
| `mobile-safari` mapped to `chromium` | `webkit-only packages are absent...` / mapping test |
| a matrix project added with no mapping | `every matrix project maps to...` |
| the mapping's unknown-name branch made to default instead of fail | `an unknown project name is rejected...` |
| the matrix emptied | `the web matrix is non-empty` |

### Real-run proof

- A `Playwright (chromium)` job completes `Install system dependencies` with no
  WebKit package in its log, and the before/after byte count is recorded in Notes.

### CI-config-only classification

Touches `.github/workflows/**` and a test under `express-api/tests/scripts/**`.
No app, backend or website runtime surface → **CI-config-only**.

## Out of Scope

- **Raising or lowering `timeout-minutes`.** Sizing a budget is what [SHY-0329]
  did and it did not hold; this story changes the work, not the allowance.
- **Auto-retrying the job.** Explicitly refused — a retry hides the run that
  told us the set was wrong.
- **Unifying the Playwright cache keys.** Still open from SHY-0334's Out of Scope.

## Dependencies

- Builds on [SHY-0334] (bounded apt waits), which stays in force. This is the
  complementary half: SHY-0334 bounds the wait, SHY-0356 shrinks the payload.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A shard turns out to need a package from another browser's set | The real-run proof is per-project; a missing package fails that shard immediately and visibly, not subtly. |
| The project→browser mapping drifts as the matrix grows | The test derives the matrix from the workflow and fails on any project it has no mapping for. |
| `install-deps <browser>` behaves differently across Playwright versions | The manifest in `playwright-core` is the oracle the test reads, so a version bump that moves a package is caught by the test rather than by a hung build. |

## Definition of Done

- [ ] Every AC checkbox above is met.
- [ ] Every named test exists, was observed RED first, and is now green.
- [ ] Every mutation killed its named test and was reverted with a git-verified clean tree.
- [ ] `npm run lint` clean at `--max-warnings=0`; `actionlint` clean under CI's `SHELLCHECK_OPTS`.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] Status `In Review` before merge; `Done` on release cut with `released_in:`.

## Notes (running log)

Reviewed-up-to: __SHA__

- **2026-08-19 — filed after the SAME failure blocked four separate CI runs in
  one evening** (#1696 twice, #1826, and the `qa-runner-driver-checks` job on
  #1846). Each time the step that died was a Playwright apt install against a
  slow mirror.
- **2026-08-19 — a narrower fix than I first assumed, because I checked.** My
  first instinct was to scope the browser install in
  `qa-runner-driver-checks.yml` too, since that job only ever runs
  `--filter chromium`. It does not work: the `--check-drivers` step in the same
  job bootstraps **all three** desktop browsers and expects each to report
  `ok`, so firefox and webkit are genuinely needed there. Scoping it would have
  broken a real check to save download time. The fix therefore applies only to
  `playwright-tests.yml`, where the matrix genuinely shards by browser.
- **2026-08-19 — mapping, not guessing.** `mobile-chrome` and `mobile-safari`
  are Playwright PROJECTS, not browsers; `install-deps mobile-safari` is not a
  thing. They are mapped explicitly to `chromium` and `webkit`, and a test pins
  exactly that — the obvious way to get this wrong is to pass the project name
  through unchanged.
- **2026-08-19 — mutation-proven.** Four mutations, all killed: the browser
  argument removed, `mobile-safari` mapped to chromium, a `deps` value
  Playwright does not understand, and the catalog emptied (which would
  otherwise make every per-entry assertion pass by iterating nothing).
- **2026-08-19 — CI-config-only.** Touches `.github/workflows/**` and one
  meta-test under `express-api/tests/scripts/**`; no app, backend or website
  runtime surface. `actionlint` exit 0, prettier clean, guard 10/10.

- **2026-08-19** — Found while re-running PR #1696's Playwright job for the
  second time. The handoff called this "the package mirror, re-run it", and a
  re-run is the right immediate move, but the log says something narrower and
  fixable: the chromium shard was fetching a WebKit-only package. Checked
  against `playwright-core`'s manifest rather than assuming — `libflite1` appears
  under `webkit:` and under no other browser, and the ubuntu24.04 counts are
  21 / 25 / 52.
- **2026-08-19** — Recording that SHY-0334's fix was **present and working** in
  the failing run. It is not at fault and should not be reopened: a 30 s
  inactivity bound cannot fire against a mirror that never goes inactive.
