---
id: SHY-0369
status: In Progress
owner: unassigned
created: 2026-08-20
priority: P0
effort: XS
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0369: One feature's missing secret took the whole dev API down

## User Story

As **anyone using dev**, I want a feature that is missing configuration to break
only that feature, so that the rest of the API keeps serving.

## Why

**Dev was returning 502 on every endpoint.** The deploy that followed the
2026-08-19 merge batch (`Deploy To Dev` run `32309728885`) failed its own health
gate:

```
Health check attempt 1..5: curl failed, retrying...
::error::Dev API health check failed after 5 attempts — deployed code may not be running
```

pm2 reported `online` with a restart count in the hundreds and 0s uptime — the
signature of a **crash loop**, not a stopped process.

### Root cause

`express-api/src/utils/mfa-remember.js`, added by SHY-0147 (#1853), evaluated
this **at module load**:

```js
if (!process.env.MFA_REMEMBER_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('MFA_REMEMBER_SECRET is required in production');
}
```

The import chain is `index.js:14` → `routes/portal.js:16` → this file. `index.js`
is the server entry, so the throw happened **during startup**: the process
exited, pm2 restarted it, and every endpoint 502'd.

`MFA_REMEMBER_SECRET` appears **nowhere** in any workflow, so it was never
provisioned for dev.

### The guard is right; its BLAST RADIUS was wrong

Refusing to fall back to a known development secret in production is correct and
is kept. What is wrong is that **one portal feature's missing configuration
stopped the entire API** — user accounts, rooms, messages, gifts, moderation.
Configuration validation belongs where the value is **used**, so the failure is
scoped to the calls that need it.

## Acceptance Criteria

### Happy path

- [ ] Requiring the module with `NODE_ENV=production` and no secret does **not**
      throw; the server starts and every other endpoint serves.
- [ ] With the secret configured, MFA-remember behaves exactly as before.

### Error paths

- [ ] Issuing or verifying a token in production **without** the secret still
      throws — the feature remains fail-closed. It must never silently fall back
      to the development secret in production.
- [ ] Outside production the development fallback still applies.

### Edge cases

- [ ] The check reads `process.env` **per call**, so a secret provisioned after
      boot is picked up without a restart.
- [ ] No other module in `src/` throws at require() time. Verified by a sweep
      that was itself validated against the pre-fix code, so a clean result means
      "none present" rather than "detector broken".

### Performance

- [ ] Negligible: one `process.env` read per signature instead of one per
      process.

### Security

- [ ] Production still refuses the known development secret — that property is
      the reason the guard exists and it is preserved exactly.
- [ ] The error names the missing variable and nothing else; no secret value is
      ever logged or returned.

### UX

- [ ] A user of any unrelated feature is unaffected by MFA-remember being
      unconfigured. That is the entire point.

### i18n

- [ ] N/A — an operator-facing startup error.

### Observability

- [ ] The failure now surfaces as an error on the MFA-remember request rather
      than as a silent crash loop, so it is attributable to the feature.

## BDD Scenarios

**Scenario: A misconfigured feature does not stop the service**

- **Given** one feature is missing a required setting
- **When** someone uses a different part of the app
- **Then** it works normally

## Test Plan

**RED first, and the failing state is a real outage** — dev 502, run
`32309728885`.

1. Require the module with `NODE_ENV=production` and no secret → must not throw.
   **Failed before the fix.**
2. Issue a token in the same conditions → must throw. **Failed before the fix**
   (it could not even be reached).
3. With the secret set, production issues a token normally.
4. Outside production the fallback still applies.
5. Sweep `src/` for other module-load throws, with the sweep validated against
   the pre-fix file first.

## Out of Scope

- **Provisioning `MFA_REMEMBER_SECRET` for dev and prod.** That still needs
  doing and needs the operator — it is a secret. This story stops the missing
  secret from being an outage; it does not supply it.
- **A repo guard for the whole class.** Attempted and deliberately abandoned: a
  line-based heuristic produced **30 false positives** (`throw err;` inside
  `catch` blocks are not module-level), and answering "is this throw reachable at
  require time?" properly needs an AST parse. A guard with 30 false positives is
  worse than none. Worth filing separately.

## Dependencies

- Caused by SHY-0147 (#1853). Nothing else depends on this.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The lazy check weakens the production guarantee | It does not: production still throws rather than using the dev secret. Only the TIMING moved, from import to use. |
| A per-call `process.env` read is slower | One env read per HMAC. Immeasurable next to the hash itself. |
| The real gap (unprovisioned secret) gets forgotten | Called out explicitly in Out of Scope, and it is the first thing in the story's Notes. |

## Definition of Done

- [ ] Dev API healthy again; module load cannot throw.
- [ ] Story `In Review` before merge.
- [ ] CI green by name; merged to develop; dev deploy dispatched **and its health
      gate observed passing**.
- [ ] `released_in:` set on the next release cut.

## Notes (running log)

- **2026-08-20 — OPERATOR ACTION STILL NEEDED.** `MFA_REMEMBER_SECRET` is not
  set anywhere in CI or on the dev VM. Until it is, the portal's
  "remember this browser" feature will fail closed **in production**, and on dev
  it silently uses the development secret. This fix stops that being an outage;
  it does not configure the secret.
- **2026-08-20 — found autonomously** while checking why the post-merge dev
  deploy failed. The first suspicion was the firebase-admin 13→14 bump that
  merged in the same batch; that was checked and cleared (`package.json` and the
  lockfile agree at 14.x, and no removed namespace API remains anywhere).
