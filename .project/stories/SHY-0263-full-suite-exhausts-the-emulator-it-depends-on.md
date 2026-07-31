---
id: SHY-0263
status: Draft
owner: claude
created: 2026-07-31
priority: P1
effort: M
type: infra
roadmap_ids: []
---

# SHY-0263: The full test suite exhausts the emulator it runs against, so a green run cannot be trusted

## User Story

**As a** developer relying on the test suite to tell me whether the product works
**I want** a full run to give the same verdict every time
**So that** "the suite is green" means the code is sound, rather than meaning the
emulator happened to still be healthy when the run finished.

## Why

Observed three times on 2026-07-31 in a single session. A full `npm test` run
starts clean and degrades as it proceeds, until suites begin failing for reasons
that have nothing to do with the code under test:

```
{"error":{"code":500,"status":"UNKNOWN"}}
  at loadFirestoreRules (@firebase/rules-unit-testing/src/impl/rules.ts:63:11)
```

Every failure of this shape is emulator exhaustion, not a rules regression. It is
confirmed each time by restarting the stack and re-running, with no code change:

| Run | Result |
| --- | --- |
| Full suite, degraded emulator | 4 suites failed, 108 tests failed |
| Restart stack, same commit | **428/428 suites, 13,924 passed, 0 failed** |
| Full suite, degraded again | 2 suites failed, 9 tests failed |

The second-order symptom is worse than the failures, because it is quieter:
**runtime inflates without failing**. In the degraded run,
`tests/scripts/sync-stories-to-issues.test.js` took **3,922 seconds** for a
`--dry-run` that normally completes in seconds, and
`journey-moderation-seed-givens` took 386s. A run that would previously finish in
~275s exceeded a 2,400s timeout. So the failure mode is not only "some tests go
red", it is "the suite becomes too slow to finish", which reads as a hung machine
rather than a diagnosable defect.

**Why this is a real bug and not just an annoyance.** The suite is the mechanism
by which every other defect is caught. If its verdict depends on how much history
the emulator has accumulated, then a green run is evidence about the emulator's
age, not about the code — and the natural workaround (restart and re-run until
green) is indistinguishable from retrying until a flake passes, which is exactly
what the project's no-auto-retry rule forbids.

**Root cause — SUPERSEDED. The original hypothesis below is wrong; see the
measured replacement underneath it and the 2026-07-31 15:0x Notes entry.**

> ~~`@firebase/rules-unit-testing` `initializeTestEnvironment` calls
> `loadFirestoreRules` for a project id, and every rules suite uses a distinct
> per-worker project id (`demo-shytalk-<name>-${JEST_WORKER_ID}`). A long-lived
> emulator accumulates these across runs, and past a threshold it starts refusing
> NEW project ids with an opaque 500.~~

That mechanism cannot be operating: the rules-suite project ids are **deterministic**
— `demo-shytalk-rooms-rules-${JEST_WORKER_ID}` carries no timestamp — so a second run
reuses the first run's ids rather than minting new ones. `room-rules.test.js:75-77`
states the design outright ("`testEnv.cleanup()` closes the whole fixed set"). The
population is bounded by suites × workers, and nothing accumulates across runs.

**Root cause (measured 2026-07-31, refined twice — this is the third and current
statement).** The emulator is **squeezed out of physical memory by co-resident
tenants**, and every Firestore call then pays decompression / page-fault cost. The
emulator is the victim, not the leaker: its own footprint is stable at ~1.3 GB.

The tenants, by real footprint on this 8 GB host:

| Tenant | Footprint | Note |
| --- | --- | --- |
| Docker Desktop VM | **2869 MB** | hosts only 202 MB of containers (livekit 21 + mailpit 20 + minio 161) |
| Orphaned Gradle daemon | **1298 MB** | `ppid=1`, survives the build that spawned it |
| Orphaned Kotlin compile daemon | **942 MB** | child of the above |
| `watchman` | **477 MB** | also the source of the `Recrawled 135 times` warning |
| Orphaned Express APIs ×2 | — | 20 h and 18 h old, from prior sessions |
| Orphaned `serve` procs ×2 | — | ~1 d 19 h old |

**`local/start.sh` is itself the orphan factory.** Its step 8/8 builds and installs
the Android app, which spawns the Gradle + Kotlin daemons; they detach to `ppid=1`
and outlive the stack. So starting the stack creates the ~2.2 GB of build daemons
that then starve the emulator that same stack just started. Confirmed directly:
a fresh `start.sh` respawned a `ppid=1` Gradle daemon at 464 MB within 36 seconds.

Reclaiming those tenants (no code change, no restart) moved the host measurably:
compressor **2826 MB → 1343 MB**, swap **4729 MB → 3133 MB**, free **131 MB →
385 MB**, load average **9.44 → 4.85**. The emulator JVM's *compressed* portion
fell **1251 MB → 293 MB** at an unchanged ~1286 MB footprint — roughly a gigabyte
of its heap decompressed back into real RAM purely from evicting freeloaders.

⚠️ **The earlier "RSS climbed 639 → 1142 MB then collapsed to 33 MB" reading was an
artifact and is withdrawn.** That was macOS compressing the JVM's pages, not a heap
growing and being reclaimed. **RSS is the wrong instrument for this diagnosis** —
under memory pressure a starved process's RSS *falls*, so RSS points at the victim
as the healthiest process on the box. Measure `phys_footprint` (`top -stats mem,cmprs`).

The discriminator is **document counts, which stay flat while the symptoms appear**:
a full run's net growth is +42 documents (26,989 → 27,031), and `auditLog` does not
move at all. So degradation is not proportional to data. It tracks memory.

Degradation is a **continuum, not a cliff** — which is why a green verdict is not
proof of health. Same commit, same suite, three conditions:

| Condition | Verdict | Wall clock |
| --- | --- | --- |
| Healthy, fresh emulator | 432/432 green | **366 s** |
| Starved by ~2.2 GB of orphan daemons | 432/432 green, 0 timeouts | **3382 s** (9.2×) |
| Starved further | 122 FAIL, 140 `Exceeded timeout` | killed unfinished at 14 min |

`auditLog`'s 25,857 rows are a red herring worth naming explicitly, because the
obvious workaround does not work: they live in the **seed export**
(`local/firebase-emulator-data/`, dated 2026-07-20), which every emulator start
re-hydrates. Purging the collection is undone by the next restart.

Health is still not the same as capacity — the original story was right about that.
The emulator answered 200 on `/` throughout run 3 while being unusable.

## Acceptance Criteria

### Happy path

- [ ] A full `npm test` run produces the same pass/fail verdict on a freshly
      started stack and on a stack that has already served several full runs.
- [ ] Total wall-clock for a full run stays within a stated budget across
      consecutive runs (no unbounded inflation).

### Error paths

- [ ] When the host cannot keep the emulator resident, the suite says so
      explicitly — "insufficient memory headroom, reclaim tenants / restart the
      stack" — not as an ordinary assertion failure.
- [ ] The classifier keys on the **resource condition**, never on one error
      string: the same starvation has surfaced as `loadFirestoreRules 500
      UNKNOWN` (2026-07-30) and as 140 × `Exceeded timeout` with no 500 at all
      (2026-07-31). Both must be classified as capacity.
- [ ] The guidance is emitted once per run, not once per failing test.

### Edge cases

- [ ] Starvation that manifests only as *slowness* is still caught: a run that
      passes 432/432 but takes 3382s instead of ~366s is a capacity failure, not
      a green run. A verdict of "green" is not sufficient evidence of health.
- [ ] The preflight measures **phys_footprint**, never RSS. Under macOS memory
      pressure a starved process's pages are compressed, so its RSS *falls* as
      pressure *rises* — the emulator read 8 MB RSS while holding a 1286 MB
      footprint. An RSS-based check reports the starving process as the healthy
      one.
- [ ] Reclaiming tenants is idempotent and never touches the live stack
      (the running emulator JVMs, the Express API, the web server).

### Performance

- [ ] Consecutive full runs do not inflate: the third run's duration is within a
      stated tolerance of the first's.
- [ ] No suite silently grows its runtime by an order of magnitude between runs.

### Security

- N/A — test infrastructure only; no product surface, no user data, no
  authorisation decision changes.

### UX

- [ ] A developer hitting this sees an actionable message instead of an opaque
      500 and a hung run.

### i18n

- N/A — developer-facing tooling, no user-facing strings.

### Observability

- [ ] A run records host memory headroom and the emulator JVM's phys_footprint
      at start and at end, so a slow-but-green run is still diagnosable after
      the fact.
- [ ] A run records which co-resident tenants it reclaimed (name, pid, footprint
      freed) — silence is not proof that none were found.
- [ ] The capacity failure is distinguishable in CI logs from a genuine rules
      regression, so a red build is triaged correctly first time.

## BDD Scenarios

**Scenario: the same code gives the same answer twice**

- **Given** a full test run has already completed against a running emulator
- **When** the same tests are run again without restarting anything
- **Then** the result is the same as the first run

**Scenario: the machine is too busy to run the tests properly**

- **Given** a machine with too little memory free for the test database to work in
- **When** the suite runs
- **Then** it says the machine is short of memory and names what is using it
- **And** it does not present the problem as a failure of the code being tested
- **And** it says so once, not once for every test that suffered

**Scenario: a run does not quietly become slower**

- **Given** several consecutive full runs against the same emulator
- **When** the last run finishes
- **Then** it took about as long as the first one

**Scenario: passing slowly is not passing**

- **Given** a run where every single test passed
- **When** that run took nine times longer than a healthy run
- **Then** it is reported as a failure, not as a pass
- **And** the reason given is the machine, not the tests

**Scenario: the same problem is recognised however it shows up**

- **Given** two runs starved of memory in the same way
- **When** one of them fails by refusing to start the tests
- **And** the other fails by having its tests give up waiting
- **Then** both are reported as the same underlying problem

**Scenario: tidying up never disturbs work in progress**

- **Given** leftover programs from earlier sessions are still holding memory
- **And** the test database and the API the tests need are running
- **When** the suite tidies up before starting
- **Then** the leftovers are cleared away
- **And** everything the run depends on is still running afterwards

**Scenario: starting the stack does not leave litter behind**

- **Given** a freshly started local stack
- **When** it has finished starting up
- **Then** no leftover build programs are still holding memory

## Test Plan

**Red first.** ~~A meta-test creating N distinct project ids~~ is withdrawn — it
targets the refuted root cause and would pass trivially, certifying the wrong thing.
~~"Given a *simulated* `loadFirestoreRules` 500"~~ is likewise withdrawn: a simulated
collaborator is a mock, which the no-stubs rule bans outside unit locations. The
classifier is pure logic, so it takes **real captured error fixtures** (test data,
permitted) in a `tests/unit/` location.

1. `tests/unit/memory-preflight.unit.test.js` — `measureHostMemory()` returns
   `phys_footprint`, not RSS. RED because no such helper exists. Pin the trap
   directly: given a real captured `top -stats mem,cmprs` sample of the starved
   emulator (8 MB RSS / 1286 MB footprint / 1251 MB compressed), the helper reports
   ~1286 MB. An RSS-based implementation returns 8 MB and fails.
2. `tests/unit/capacity-classifier.unit.test.js` — parameterised over **both real
   captured failure shapes**, since the symptom is not stable:
   the 2026-07-30 `loadFirestoreRules 500 UNKNOWN` body, and a 2026-07-31 run log
   carrying 140 × `Exceeded timeout` and no 500 at all. Both must classify as
   `capacity`. A third fixture — a genuine assertion failure — must classify as
   `product`, or the classifier is just returning `capacity` unconditionally.
3. `tests/unit/tenant-reclaim.unit.test.js` — over a real captured `ps`/`top`
   snapshot, `findReclaimableTenants()` identifies the `ppid=1` Gradle daemon,
   the Kotlin compile daemon, and the stale Express/`serve` processes, and
   **excludes every live-stack pid** (the Firestore/RTDB emulator JVMs, the
   current Express API, the current web server). The exclusion assertion is the
   one that matters — a reclaimer that kills the emulator "frees memory" too.
4. A run-level guard asserting the preflight emits its summary **once per run**,
   not once per failing test.

**Green — the fix, in dependency order:**

1. **Reclaim before the run.** A preflight that terminates the orphaned build
   daemons and stale session processes. This is the highest-value, lowest-risk
   lever: measured at compressor −1483 MB / swap −1596 MB, and Gradle daemons are
   disposable caches, so the cost of being wrong is one slower next build.
2. **Stop manufacturing the orphans.** `local/start.sh` spawns the Gradle + Kotlin
   daemons at step 8/8 and leaves them at `ppid=1`. It should stop them when the
   install completes — fixing the source, not just sweeping up after it
   (`./gradlew --stop`, already an established rule for the pre-push Sonar hook).
3. **Fail fast and say why.** When headroom is still insufficient *after*
   reclamation, refuse to start and name the largest tenants with their footprints.
   Keying on the resource condition, never on one error string.
4. **Right-size the Docker VM** — 3.827 GiB allocated to host 202 MB of containers
   is the single largest remaining tenant at 2869 MB. This is an operator machine
   setting, so the story **recommends** it and the preflight **reports** it; it is
   not changed automatically.

Note for whoever implements (4): stopping a *container* does not return memory to
the host. That was tried on 2026-07-31 — stopping a 1.1 GiB container freed memory
inside the guest while the host's wired allocation did not move, and the run got
*slower*, not faster. Only resizing the VM helps.

**Verification:** three consecutive full runs on one emulator, comparing verdict
**and duration** — a green run at 9× the baseline duration counts as a FAILURE,
per the Edge-cases AC. Plus the existing suites staying green.

## Out of Scope

- The `journey-moderation-seed-givens` audit-log-floor assertion and the
  `sync-stories-to-issues` dry-run timing. Both are symptoms observed under a
  degraded emulator; if either still fails on a healthy stack after this lands, it
  gets its own ticket rather than being folded in here.
- Rewriting rules tests to avoid `@firebase/rules-unit-testing`.
- CI runner sizing. CI starts a fresh emulator per job and does not exhibit this;
  the problem is specific to a long-lived local stack.

## Dependencies

- None. Self-contained in the test harness and the emulator lifecycle scripts.

## Risks & Mitigations

- **Risk (highest):** the reclaimer kills something the run depends on. Killing the
  live emulator "frees memory" and destroys the run — and would look like the very
  capacity failure it was meant to prevent.
  **Mitigation:** allow-list by process *identity*, never by port. Port 8080 is held
  by both the emulator JVM and a node proxy, so `lsof -ti tcp:8080 | head -1` returns
  a different process run to run. Select via `pgrep -f 'cloud-firestore-emulator.*\.jar'`
  and assert exactly one match. Red test 3 pins the exclusion.
- **Risk:** the threshold at which starvation begins is unknown, so a fix could
  appear to work merely by delaying it.
  **Mitigation:** the DoD requires three consecutive runs to agree on verdict **and**
  duration, so "delayed" is distinguishable from "fixed" — this is exactly what caught
  the original bug, where runs 1 and 2 looked perfect and run 3 collapsed.
- **Risk:** a green verdict is mistaken for proof the fix worked.
  **Mitigation:** duration is a first-class part of the verdict. The 2026-07-31
  starved run was 432/432 green with **zero** timeouts at 9.2× the baseline; on
  pass/fail alone it is indistinguishable from a healthy run.
- **Risk:** the measurement instrument reports the starving process as the healthiest
  one, sending the next investigator the wrong way — as it already did twice here.
  **Mitigation:** footprint, never RSS; red test 1 pins it with a real captured sample.
- **Risk:** this is invisible in CI, so it is easy to under-prioritise while local
  runs quietly become untrustworthy.
  **Mitigation:** recorded here with the measured evidence so the next person does
  not have to rediscover it — as three separate sessions already have.

## Definition of Done

- [ ] Three consecutive full suite runs on one emulator agree on the verdict **and**
      stay within the duration budget. A green run outside the budget fails this
      clause — pass/fail alone is not the verdict.
- [ ] The capacity failure is explicitly classified and actionable, proven against
      **both** recorded failure shapes (the 500 and the timeout storm).
- [ ] `local/start.sh` leaves no `ppid=1` build daemon behind: after a full start,
      a footprint census finds no orphaned Gradle or Kotlin daemon.
- [ ] The reclaimer is proven not to touch the live stack.
- [ ] The existing suites remain green.
- [ ] `code-reviewer` 100% clean.

## Notes

**2026-07-31** — Filed after hitting this three times in one session while
delivering SHY-0261 and SHY-0258. Each time the failures looked like product
regressions and each time a stack restart cleared them with no code change, which
is precisely why it is worth a ticket: the cost is not the lost minutes, it is
that a red suite stops being informative and a green one stops being reassuring.

Prior art in the operator's own notes:
`reference-emulator-degrades-as-test-projects-accumulate` records the same
diagnosis from 2026-07-30 (three rules suites failing 109/109 while others passed
against the same `firestore.rules`). This ticket exists because a remembered
workaround is not a fix.

**2026-07-31 15:0x WIB — reproduced deliberately; the symptom is confirmed and the
root cause is corrected.** Three consecutive full runs, one emulator, no code change
between them, nothing else started or stopped:

| Run | Verdict | Wall clock |
| --- | --- | --- |
| 1 (fresh emulator) | 432/432 suites, 13,999 passed | 366.2s |
| 2 (same emulator) | 432/432 suites, 13,999 passed | 354.7s |
| 3 (same emulator) | 122 FAIL markers, 140 `Exceeded timeout`; never terminated | >14 min, killed |

Run 3's slowest suites: `admin-audit-log-completeness` 197.3s, `gate-rate-limit`
190.9s, `journey-moderation-seed-givens` 91.9s — all of which pass in seconds on a
fresh emulator. Note the DoD's "three consecutive runs" was exactly the right bar:
two runs looked perfectly stable and would have closed this as unreproducible.

Measurements taken alongside (helper: a per-collection census + a heap sampler):

- Documents: 26,989 → 27,031 across a full run (+42). `auditLog` unchanged at
  25,857 — it ships in the 2026-07-20 seed export and is re-hydrated on every start.
- ~~Emulator JVM RSS during run 3: 639 → 1142 MB against a 1 GB `-Xmx` cap, then
  33 MB after the OS reclaimed its pages.~~ **Withdrawn 2026-07-31 16:2x — RSS
  artifact, see the next entry.**
- System: 8 GB RAM, 4.7 GB of 6.1 GB swap in use.
- ~~Largest single non-essential tenant was a `sonarqube-mcp` Docker container at
  **1.111 GiB**; stopping it during suite runs is the cheapest single lever.~~
  **Withdrawn — this was tested and is false.** See the next entry.

**2026-07-31 16:1x–16:2x WIB — the memory diagnosis is CONFIRMED in mechanism but the
lever and the instrument were both wrong. Root cause re-stated a second time.**

The experiment the previous entry proposed was run: stop the 1.1 GiB `sonarqube-mcp`
container, restart the stack, three full runs. **Result: run 1 passed 432/432 with
zero timeouts in 3382 s — 9.2× the 366 s baseline.** The lever made things worse, so
the experiment was stopped after run 1 rather than spending two more hours on an
invalid comparison. Two independent reasons it could never have worked:

1. **Container ≠ host.** `sonarqube-mcp` runs inside Docker Desktop's Linux VM, which
   is allocated 3.827 GiB. Stopping a container frees memory *inside the guest*; the
   host's wired allocation does not move. Measured across the change: `wired`
   2516M → 2524M, swap 4729 MB unchanged. (Incidentally the container was created by
   `sonar run mcp` with `--rm`, so stopping it *deleted* it — it is recreated
   automatically on the next MCP connect, and the image was never removed.)
2. **Confounded anyway.** Between the baseline and run 1, an orphaned Gradle daemon
   (1298 MB) and Kotlin compile daemon (942 MB) appeared. They were invisible to every
   census taken up to that point, because those censuses measured **RSS** — and both
   daemons were ~99% compressed, so they read as ~10 MB each.

**The instrument was the deeper error.** Under macOS memory pressure, pages are
compressed, so a starved process's RSS *falls* as pressure *rises*. The Firestore
emulator read **8 MB RSS while holding a 1286 MB footprint, 1251 MB of it compressed**.
Every RSS-based conclusion in the entry above is therefore unreliable, including the
"heap grew to 1142 MB then collapsed" trajectory — that was compression, not a heap.
Use `top -l 1 -pid <pid> -stats mem,cmprs` (phys_footprint).

Reclaiming the real tenants — the two build daemons, two orphaned Express APIs (20 h
and 18 h old), two orphaned `serve` processes (~1 d 19 h) — with no code change and no
restart:

| Metric | Before | After |
| --- | --- | --- |
| Compressor | 2826 MB | **1343 MB** |
| Swap used | 4729 MB | **3133 MB** |
| Free | 131 MB | **385 MB** |
| Load average | 9.44 | **4.85** |
| Emulator JVM *compressed* | 1251 MB | **293 MB** (footprint unchanged ~1286 MB) |

That last row is the proof: ~1 GB of the emulator's heap returned to real RAM purely
from evicting freeloaders. It was never leaking — it was being squeezed.

**And the loop closes on `local/start.sh` itself:** its step 8/8 Android install spawns
the Gradle + Kotlin daemons that then starve the emulator the same script just started.
A fresh `start.sh` respawned a `ppid=1` Gradle daemon at 464 MB within 36 seconds of
the reclamation above.

**Two process lessons worth keeping.** (a) The original root cause was inferred from
a plausible-looking code pattern and never measured; the deterministic project ids
were visible in the same file that the hypothesis cited. (b) My first heap
measurements were **wrong and looked plausible** — the census helper picked the RSS
of whatever `lsof -ti tcp:8080 | head -1` returned, and port 8080 is held by both the
emulator JVM and a node proxy, so consecutive samples silently compared different
processes (164.5 MB vs 36.9 MB, read as a memory drop). Selecting the JVM by jar name
gave 513.5 MB for the same instant. A detector that reports the wrong process is
worse than no detector ([[feedback-detector-must-report-not-guess]]).

**2026-07-31 16:3x–17:0x WIB — implemented (tests-first).** RED confirmed before any
implementation existed (3 suites, module-not-found), then GREEN.

Delivered in `express-api/scripts/preflight/`:

- `host-memory.js` — phys_footprint census + `PhysMem` parse. Two SEPARATE signals:
  `starved` (free < 512 MB — the only condition that refuses a run) and `degraded`
  (compressor > 1536 MB — warns only). They are deliberately not merged: the
  compressor figure correlated with the 3382 s run, but there is **no measurement of
  a healthy run's compressor** to calibrate against, and refusing on an uncalibrated
  threshold would block legitimate local work — worse than the bug. Promote `degraded`
  to a refusal once a healthy baseline exists.
- `capacity-classifier.js` — classifies both recorded shapes plus the duration case.
- `tenant-reclaim.js` — default-deny orphan finder with six independent guards.
- `index.js` — CLI; wired as `pretest` in `package.json`, so `npm test` gates on it.
  Skips entirely on CI and on non-darwin; `PREFLIGHT_SKIP=1` overrides deliberately.

Root-cause fix: `local/start.sh` now runs `./gradlew --stop` after step 7's build
(`|| true`, since `--stop` exits non-zero with no daemon running and it is the last
step). Pinned by 4 new assertions in `tests/scripts/local-stack-resource-diet.test.js`.

**Two defects found in my own work, both worth recording:**

1. **Mutation testing caught what the tests could not.** Deleting the live-stack
   protection and deleting the `ppid=1` requirement BOTH left 18/18 green. Every
   process the tests called "protected" was protected by a *different* guard as well,
   so no test isolated either one. Fixed by exporting `isProtected` and asking each
   guard directly. All six guards now redden when removed:
   live-stack signature (3 fail) · ppid=1 (1) · age (1) · port-holder (2) ·
   cwd (3) · reserved-pid (1).
2. **Running it for real caught a design bug no fixture could.** The cwd guard —
   added so another project's `node src/index.js` is never killed — was applied
   universally, and a Gradle daemon's cwd is legitimately `~/.gradle/daemon/<version>`.
   It was therefore shielding the exact orphan this ticket exists to reclaim
   ("no reclaimable tenants found" while a 465 MB daemon sat there). The cwd
   requirement now attaches only to the two ambiguously-named node rules; the daemon
   rules identify unambiguously by `GradleDaemon` / `kotlin-build-tools-compat` in argv.

Also fixed en route: 6 `sonarjs/slow-regex` errors (replaced backtracking-prone
`(.*)$` patterns with whitespace splits) and 21 lint warnings.

Verified live on the diagnosed machine: report mode exits 0 and names what it would
reclaim; live mode reclaimed the orphaned Gradle daemon and freed ~440 MB; CI mode
skips; the refusal names the largest tenants by footprint.

**Still owed:** the DoD's three consecutive full runs. They cannot be run right now —
the host is genuinely starved (371 MB free, Docker VM 2871 MB) and the preflight
correctly refuses. Right-sizing the Docker VM (Test Plan item 4, operator's call) is
the remaining lever; it is 2871 MB hosting 202 MB of containers.
