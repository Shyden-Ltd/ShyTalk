---
id: SHY-0370
status: In Progress
owner: unassigned
created: 2026-08-20
priority: P0
effort: XS
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0370: A second module-load throw kept dev down after the first fix

## User Story

As **anyone using dev**, I want the API to start even when optional feature
secrets are unset, so that one unconfigured feature cannot keep the whole
service down.

## Why

**SHY-0369 fixed one instance of this and dev stayed 502.** The deploy that
carried that fix (run `32321477168`) failed its health gate exactly as before.

There was a **second** module-scope throw of the identical shape:

```
CRASH AT LOAD: EXPORT_DOWNLOAD_SECRET is required in production
  at express-api/src/routes/data-export.js:22
```

`index.js` requires this route module, so it threw during startup — process
exits, pm2 crash-loops, every endpoint 502s.

### The real lesson: the sweep was wrong, and I trusted it

SHY-0369 swept `src/` for other module-load throws and reported **none**. That
sweep was a regex over line indentation and brace depth, and it was simply
wrong — a live second instance existed the whole time. A brace-counting variant
of the same idea produced **30 false positives** (`throw err;` inside `catch` is
not module scope).

Both were guessing at the question. **The reliable detector was the failure
itself**: `require('./src/index.js')` with production env and no secrets. That is
exactly what the VM does, so it cannot be wrong about what the VM will do.

## Acceptance Criteria

### Happy path

- [ ] `require('src/index.js')` with `NODE_ENV=production` and **no** secrets
      configured loads without throwing.
- [ ] Dev API health returns 200 after deploy — **observed**, not assumed.

### Error paths

- [ ] Generating a data-export download link in production **without**
      `EXPORT_DOWNLOAD_SECRET` still throws. The feature stays fail-closed and
      must never fall back to the development secret in production.

### Edge cases

- [ ] The guard test strips **every** `*SECRET*`, `*_KEY`, `*PASSWORD*` variable
      from the child env, so it asserts the real unconfigured-box case rather
      than passing on a developer's populated `.env`.
- [ ] The guard proves its own harness: a deliberately broken entry must be
      caught, so a green result cannot mean "spawn silently failed".
- [ ] No other module-load throw survives — proven by the entry actually
      loading, not by a pattern search.

### Performance

- [ ] One `process.env` read per HMAC. Immeasurable next to the hash.

### Security

- [ ] Production still refuses the known development secret. Only the TIMING
      moves, from import to use — identical to SHY-0369.

### UX

- [ ] Users of every unrelated feature are unaffected by data-export being
      unconfigured.

### i18n

- [ ] N/A — an operator-facing startup error.

### Observability

- [ ] The guard's failure message names the offending variable
      (`LOAD_ERROR:<message>`), so a future regression is actionable rather than
      a bare exit code.

## BDD Scenarios

**Scenario: The service starts even when a feature is unconfigured**

- **Given** an optional feature has no configuration
- **When** the service starts
- **Then** it starts, and everything unrelated to that feature works

## Test Plan

**RED first, and mutation-proven.**

1. Reproduce: `require('src/index.js')` under production env → crashed with
   `EXPORT_DOWNLOAD_SECRET is required in production`.
2. Make the secret lazy; re-run → `LOADED OK`.
3. Add `server-entry-loads-in-production.test.js`, which performs exactly that
   reproduction in a child process.
4. **Mutate**: reinstate the module-level throw → the guard goes red and reports
   `LOAD_ERROR:EXPORT_DOWNLOAD_SECRET is required in production`. Restore → green.

## Out of Scope

- **Provisioning `EXPORT_DOWNLOAD_SECRET` and `MFA_REMEMBER_SECRET`.** Neither is
  set in CI or on the VM. Both features fail closed in production until they are.
  That needs the operator.
- A static/AST detector for the pattern. The entry-load test covers the thing
  that actually matters — whether the server starts — without needing one.

## Dependencies

- Follows **SHY-0369**, which fixed the first instance. Neither alone restores
  dev; both are required.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A third instance exists | The guard loads the REAL entry point, so any instance anywhere in the require graph fails it — no pattern to outrun. |
| The guard passes because spawn failed | It asserts its own harness catches a deliberately broken entry. |
| A developer's `.env` masks the problem | The child env strips every secret-shaped variable before loading. |

## Definition of Done

- [ ] Entry loads under production env; dev health **observed** returning 200.
- [ ] Story `In Review` before merge.
- [ ] CI green by name; merged to develop; dev deploy dispatched and its health
      gate observed passing.
- [ ] `released_in:` set on the next release cut.

## Notes (running log)

- **2026-08-20** — Found only because the SHY-0369 deploy still failed. The
  honest sequence: diagnosed one cause, fixed it, asserted the class was clear on
  the strength of a regex, and was wrong. Replacing the regex with the real
  reproduction is the durable part of this story.
