---
id: SHY-0312
status: Draft
owner: claude
created: 2026-08-17
priority: P1
effort: M
type: feature
roadmap_ids: []
epic: EPIC-0011
mvp: true
---

# SHY-0312: Serve the manifest — cohort-resolved, cheap to poll, and attested before sign-in

## User Story

As a **client on cold start**, I want one endpoint that hands me the manifest my
cohort should see, costs nothing to re-check when unchanged, and can be called
before I have a session, so the app can paint correctly on first launch without
leaking another cohort's configuration.

## Why

Three requirements collide in this one endpoint, and each eliminates the obvious
implementation of the others.

**It must be callable before sign-in.** Cold start paints before auth resolves
(that is EPIC-0004's whole design), so the app needs a manifest while it has no
session. A purely authenticated endpoint cannot serve that moment.

**It must not leak cohort configuration.** Cohort segregation is a child-safety
boundary. A pre-auth manifest therefore cannot contain anything cohort-dependent
— not "filtered for safety", but genuinely absent, because an anonymous caller
has no cohort to filter by.

**It must be nearly free to call.** `$0` hosting means a document fetched by
every client on every launch is a real bandwidth line item. `ETag` +
`If-None-Match` makes the steady state a `304` with no body, so bandwidth is paid
per change rather than per launch.

And because the pre-auth variant is unauthenticated by necessity, it goes on the
`skipsAuth` allowlist — which is exactly why it must **also** be added to
`requiresAppCheck`. Being on the skip list does not confer attestation;
`requiresAppCheck` names specific paths. This follows the SHY-0300 precedent: an
unauthenticated path must still prove it comes from a genuine app install.

`Cache-Control` is `private, no-cache`, never `max-age`. A manifest sitting
inside a max-age window is a change you published and cannot see — the hot-fix
path failing silently, which is the same defect fixed on the suggestions read
path on 2026-08-17.

## Acceptance Criteria

### Happy path

- [ ] `GET /api/ui-manifest` with a valid session returns `200` and a document whose `cohort`-dependent sections match the caller's cohort.
- [ ] The response carries an `ETag` and `Cache-Control: private, no-cache`.
- [ ] A repeat request with a matching `If-None-Match` returns `304` with an empty body.
- [ ] `GET /api/ui-manifest` with no session but a valid App Check token returns `200` and a cohort-free document.

### Error paths

- [ ] No session and no App Check token → `401`, not a manifest.
- [ ] No session and an invalid App Check token → `401`.
- [ ] A suspended or banned caller is refused by the existing global auth gate before the route runs — asserted, so a future refactor cannot quietly exempt this path.
- [ ] A caller whose `appVersion` is below the manifest's `minAppVersion` receives the last manifest whose floor they satisfy, not a `304` and not an unusable document.

### Edge cases

- [ ] A malformed `If-None-Match` is treated as absent (full `200`), never a `400`.
- [ ] A caller with no `appVersion` header receives the most conservative manifest, not the newest.
- [ ] Two callers in different cohorts receive different ETags for the same underlying source — the ETag covers the *resolved* document, not the source file.
- [ ] The same caller re-requesting after a rollout re-bucket receives a fresh ETag, so a rollout change is never masked by a stale cache validator.

### Performance

- [ ] A `304` response body is zero bytes, asserted on the wire.
- [ ] The document is built without a Firestore read per request — source is loaded once and cached in-process, invalidated on deploy.
- [ ] p95 latency under 150 ms against the real local stack, measured over 100 real requests.

### Security

- [ ] The pre-auth variant contains no cohort-dependent section at all, asserted field-by-field rather than by spot check.
- [ ] The pre-auth path appears in BOTH `skipsAuth` and `requiresAppCheck` in `middleware/auth-skip.js`; a test asserts membership of both, so adding one without the other fails.
- [ ] No manifest served by this route references a sealed screen — the SHY-0311 check runs against the resolved output, not only the committed source.
- [ ] Rate limiting applies: the route sits behind `generalLimiter` like every other `/api` path.

### UX

- [ ] N/A — no user-facing surface. Its UX contribution is that the client has a manifest available before first paint, which SHY-0313 consumes.

### i18n

- [ ] The `strings` section is served for all 20 locales in one document; the client picks its locale, so switching language needs no refetch.
- [ ] Publish-time validation (SHY-0316) rejects a document whose referenced keys are missing from any locale; this route asserts it never serves one that failed validation.

### Observability

- [ ] Every response logs the resolved `manifestVersion`, the caller's cohort, and whether it was a `200` or `304`.
- [ ] A request refused for App Check logs the reason distinctly from an auth refusal, so the two are separable in an incident.

## BDD Scenarios

**Scenario: The app gets the settings for its own age group**

- **Given** a signed-in adult and a signed-in minor
- **When** each app asks the server for its settings
- **Then** each receives the settings meant for its own age group

**Scenario: Asking again when nothing changed costs nothing**

- **Given** an app that already has the current settings
- **When** it checks whether they have changed
- **Then** the server confirms there is nothing new
- **And** sends no settings back

**Scenario: An app can get basic settings before anyone signs in**

- **Given** an app that has just started and nobody has signed in
- **When** it asks the server for settings
- **Then** it receives settings that are the same for everyone
- **And** none of them depend on age group

**Scenario: A request that cannot prove it is the real app is refused**

- **Given** a request that is not from a genuine app install
- **When** it asks the server for settings before signing in
- **Then** the request is refused

## Test Plan

**RED first** — every Jest test below is written and observed failing before the
route exists.

### Node / Jest (`express-api/tests/routes/ui-manifest.test.js`)

- `returns 200 with an ETag and no-cache for a signed-in caller`
- `returns 304 with an empty body when If-None-Match matches`
- `returns a different ETag for a different cohort`
- `returns a fresh ETag after a rollout re-bucket`
- `treats a malformed If-None-Match as absent`
- `returns 200 for an anonymous caller with a valid App Check token`
- `returns 401 for an anonymous caller with no App Check token`
- `returns 401 for an anonymous caller with an invalid App Check token`
- `serves no cohort-dependent field to an anonymous caller` (field-by-field)
- `is refused for a banned caller by the global auth gate`
- `is refused for a suspended caller by the global auth gate`
- `serves the newest manifest whose minAppVersion the caller satisfies`
- `serves the conservative manifest when appVersion is absent`
- `never serves a document referencing a sealed screen`
- `logs manifestVersion, cohort and 200-vs-304`

### Node / Jest (`express-api/tests/middleware/auth-skip.test.js` — extend)

- `the ui-manifest pre-auth path is in skipsAuth`
- `the ui-manifest pre-auth path is in requiresAppCheck`

The second is the one that matters. The design doc corrected an earlier
assumption here: skip-list membership does not confer attestation.

### Integration, real stack (`express-api/tests/integration/`)

- Real emulator + real Express: 100 sequential requests, assert p95 < 150 ms and
  that no Firestore read occurs per request.
- Real `304` on the wire with a zero-length body (asserted on
  `content-length`, not on a parsed object).

### Mutation proof

| Mutation | Must kill |
| -------- | --------- |
| ETag computed over the source file rather than the resolved document | `returns a different ETag for a different cohort` |
| `Cache-Control` set to `max-age=30` | `returns 200 with an ETag and no-cache for a signed-in caller` |
| pre-auth path removed from `requiresAppCheck` | `the ui-manifest pre-auth path is in requiresAppCheck` |
| cohort filtering applied instead of omission on the pre-auth variant | `serves no cohort-dependent field to an anonymous caller` |
| `minAppVersion` floor ignored | `serves the newest manifest whose minAppVersion the caller satisfies` |

### Backend change ⇒ FULL gauntlet

This story modifies `express-api/src/**`, so per CLAUDE.md the **full device +
all-browser matrix runs** — no per-platform skip applies. Real Android + real
iPhone + all five browsers locally, then Chrome on dev.

## Out of Scope

- Client-side fetching, caching and fallback — SHY-0313.
- The committed manifest source and its CI validation — SHY-0318.
- Rollout bucketing logic — SHY-0317 (this route consumes `bucketOf`).
- Admin authoring — SHY-0319.
- Fixing App Check on *authenticated* routes — SHY-0321. This story only ensures
  the one new pre-auth path is attested.

## Dependencies

- **SHY-0310** — the schema and model this route serialises.
- **SHY-0311** — `isSealedRoute`, asserted against resolved output.
- **EPIC-0004 must be Done** (EPIC-0011 dependency gate).
- Interface contract `buildManifest({ uniqueId, cohort, platform, appVersion })`
  is fixed in the Phase 1 plan — do not rename without updating it in the same PR.

## Risks & Mitigations

| Risk | Mitigation |
| ---- | ---------- |
| The pre-auth variant leaks cohort information | Cohort sections are *absent*, not filtered, and the test asserts field-by-field rather than sampling. Filtering is a mutation in the table above precisely because it is the plausible wrong implementation. |
| Adding a skip-list path without attestation | A dedicated test asserts membership of `requiresAppCheck`, and removing it is in the mutation table. This exact confusion was caught during spec review. |
| ETag over the source rather than the resolved document silently serves one cohort's manifest to another | Covered by `returns a different ETag for a different cohort` and by the corresponding mutation. |
| Bandwidth exceeds the $0 budget anyway | The `304`-body-is-zero-bytes assertion is on the wire; measured against the budget before EPIC-0011 closes. |

## Definition of Done

- [ ] Every AC checkbox above is met.
- [ ] Every named test exists, was observed RED first, and is now green.
- [ ] Every mutation killed its named test and was reverted with a git-verified clean tree.
- [ ] Backend change ⇒ FULL gauntlet green: real Android + real iPhone + all five local browsers, then Chrome on dev.
- [ ] `cd express-api && npm test` passes; `npm run lint` clean at `--max-warnings=0`.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] `bash scripts/pre-merge-check.sh <PR#>` emits `PRE-MERGE-CHECK: OK`.
- [ ] Status `In Review` before merge; `Done` on release cut with `released_in:`.

## Notes (running log)

- **2026-08-17** — Story raised from design doc §4.3. The `requiresAppCheck` requirement is a spec-review correction: an earlier draft claimed skip-list membership implied attestation. It does not — `requiresAppCheck` names specific paths, so the new path must be added to both lists explicitly.
- **2026-08-17** — `Cache-Control: private, no-cache` rather than `max-age`. A manifest inside a max-age window is a published change you cannot see, which is the hot-fix path failing silently. Same defect and same fix as the suggestions read path on 2026-08-17.
