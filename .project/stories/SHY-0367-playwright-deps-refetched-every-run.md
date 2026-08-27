---
id: SHY-0367
status: Draft
owner: unassigned
created: 2026-08-20
priority: P1
effort: M
type: infra
roadmap_ids: []
mvp: false
---

# SHY-0367: A slow apt mirror can fail any build, because every run re-fetches the same packages

## User Story

As **a developer waiting on CI**, I want a green branch to stay green when
GitHub's package mirror is slow, so that a red gate means my change is wrong
rather than that the network was.

## Why

**Twice on the night of 2026-08-19**, unrelated jobs failed for the same reason —
a degraded Azure apt mirror:

| Job | Failure |
| --- | --- |
| `Dev Sanity Check` (deploy run `32289832760`) | `Install Playwright browsers` timed out after **6 min** |
| `playwright-web / Playwright (chromium)` on #1846 (run `32298628247`) | `Install system dependencies` timed out after **15 min** |

Measured from the sanity-check log, the mirror was delivering at roughly
**40 KB/s** — `fonts-freefont-ttf` (5.6 MB) took 148 seconds.

Neither failure had anything to do with the change under test. #1846 is a splash
retirement; the sanity check ran against an already-deployed, verifiably healthy
dev API.

### The two existing fixes do not cover this

- **SHY-0334** bounded an *inactive* apt socket at 30 s. This mirror was never
  inactive — it delivered, slowly, right to the step ceiling. A wait bounded
  per-fetch is still unbounded in aggregate.
- **SHY-0356** scoped `install-deps` to the shard's own browser, cutting the
  package set from the three-engine union to one. **That fix is in force**, and
  chromium's remaining 21 packages *still* blew a 15-minute cap tonight.

Both were the right fixes. The gap they leave is that **every run still fetches
the same unchanging packages from the network**, so any mirror slow enough will
fail the build no matter how tight the timeout or how small the set.

## Acceptance Criteria

### Happy path

- [ ] A repeat run does not re-download Playwright's browsers or their apt
      packages; it restores them from cache.
- [ ] A cache hit is visible in the log, so "did it use the cache?" is answerable
      without inference.

### Error paths

- [ ] A cache **miss** falls back to the network path and still succeeds — the
      cache is an optimisation, never a hard dependency.
- [ ] A corrupt or partial cache entry is rejected rather than half-restored.

### Edge cases

- [ ] The cache key includes the Playwright version **and** the runner image, so
      an upgrade cannot silently restore stale browsers.
- [ ] Both consumers are covered — `playwright-tests.yml` **and**
      `deploy-dev.yml`'s sanity-check and smoke-test legs, which have their own
      installs at 6 and 8 minute caps.
- [ ] A first-ever run on a new key still completes inside its step cap.

### Performance

- [ ] Recorded before/after wall-clock for the install step, from real runs, not
      estimated.

### Security

- [ ] The cache holds only public browser binaries and OS packages. No
      credential, token or build artefact enters it.
- [ ] Cache keys cannot be influenced by PR-controlled input in a way that lets a
      fork poison a shared entry.

### UX

- [ ] N/A — CI-internal. The developer-facing outcome is not being handed a red
      gate for a slow mirror.

### i18n

- [ ] N/A.

### Observability

- [ ] The log states cache hit or miss and the restored key, so a future slow-run
      investigation starts from evidence.

## BDD Scenarios

**Scenario: A slow network does not fail an unrelated change**

- **Given** the package mirror is responding slowly
- **When** the automated checks run for a change that does not touch the browser setup
- **Then** the checks complete without waiting on that download

## Test Plan

**RED first.** The failing state is recorded above with two run ids, two job
names, two different timeout ceilings, and a measured transfer rate.

1. A workflow test asserting every Playwright install step is cache-backed —
   which fails today.
2. Prove the fallback: a forced cache miss still succeeds.
3. Prove the key: bumping the Playwright version produces a miss, not a stale hit.
4. Record real before/after timings.

## Out of Scope

- Changing which browsers or packages are installed. SHY-0356 settled that.
- Self-hosted runners — explicitly excluded by standing operator decision.
- Retrying flaky *tests*. This is about the environment, not test stability.

## Dependencies

- Builds on **SHY-0334** (bounded stalls) and **SHY-0356** (scoped set). Neither
  is superseded; this is the third leg.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A stale cache serves the wrong browser | Key includes the Playwright version and runner image; a version bump is a miss by construction, and it is tested. |
| The cache silently stops working and nobody notices | Hit/miss is logged and asserted, so a silent regression to the network path is visible. |
| Cache restore is itself slow | Before/after timings are recorded from real runs; if restore is not faster, the change is not worth keeping. |

## Definition of Done

- [ ] Both workflows cache-backed; a slow mirror no longer fails an unrelated PR.
- [ ] Story `In Review` before merge.
- [ ] CI green by name; merged to develop; dev deploy dispatched.
- [ ] `released_in:` set on the next release cut.

## Notes (running log)

- **2026-08-20** — Filed after the same degraded mirror failed two unrelated
  gates within three hours. Worth stating plainly: SHY-0356's scoping fix **was
  already in force** for the #1846 failure, so this is not a regression of that
  work — it is the part neither existing ticket addresses.
