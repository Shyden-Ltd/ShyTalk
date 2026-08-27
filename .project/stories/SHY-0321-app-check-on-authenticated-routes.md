---
id: SHY-0321
status: Draft
owner: claude
created: 2026-08-17
priority: P1
effort: M
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0321: A modified build of the app is indistinguishable from the real one on every authenticated route

## User Story

As the **operator**, I want the API to be able to tell a genuine app install from
a modified copy, so that someone who repackages the app cannot use it to reach
endpoints by pretending to be a normal client.

## Why

Three different questions get conflated as "is it secure", and this repo answers
two of them well:

1. **Who are you?** Firebase ID token. Solid — deny-by-default at
   `index.js:117` with a small unit-tested skip allowlist.
2. **Are you allowed?** Ban, suspension and cohort, enforced on every
   authenticated request in both auth paths (`auth.js:201`/`:346` suspension,
   `:215–241`/`:361–381` ban, 23 `requireSameCohort` cohort call sites). Solid.
3. **Is the thing asking a genuine copy of my app?** App Check. **This is the gap.**

`requiresAppCheck` is called *inside* the `skipsAuth` branch at `index.js:129`.
That means attestation is demanded only of the handful of unauthenticated paths.
Every authenticated route accepts any request bearing a valid Firebase ID
token — and a repackaged build signed into a real account holds one **entirely
legitimately**. It signs in as a genuine user, because it is a genuine user; it
simply is not running the code we shipped.

A modified client does not need to defeat auth or bypass a ban. It just skips the
UI. That is why the operator's instruction — *"the API/backend should always be
ensuring that any request is legal and within the rules"* — is the right frame,
and why EPIC-0011 raises the value of closing this: once the interface is
remotely configurable, "the client didn't show the gate" becomes a cheaper thing
to attempt.

This gap **predates** SDUI and is independent of it. It is filed separately
because it stands on its own merits and should not wait behind an eleven-story
epic.

**iOS is blocked.** App Attest needs an Apple `.p8` key, which is the same
blocker holding SHY-0151 in EPIC-0005. Android (Play Integrity) proceeds now;
iOS lands when the operator provisions the key. The story ships Android-complete
with iOS enforcement behind a documented, tested switch rather than waiting.

## Acceptance Criteria

### Happy path

- [ ] A request from a genuine Android install carrying a valid Play Integrity App Check token reaches its authenticated route normally.
- [ ] Every authenticated `/api` route requires a valid App Check token on Android.
- [ ] The existing unauthenticated attested paths keep working unchanged.

### Error paths

- [ ] An authenticated request with no App Check token is refused with a distinct status and code, separable in logs from an auth failure.
- [ ] An authenticated request with an expired App Check token is refused.
- [ ] An authenticated request with a token minted for a different app is refused.
- [ ] A refusal reveals nothing about why attestation failed beyond that it did.

### Edge cases

- [ ] The appeal, GDPR-export and ban-screen paths keep their existing deliberate exemptions (`isBanExemptPath:297`) — attestation must not become the thing that makes a ban unappealable.
- [ ] Test routes remain reachable in non-production, as they are today, without punching a production hole.
- [ ] An iOS request is handled by the documented switch: enforced when the key is present, and explicitly, testably permissive when it is not — never silently permissive.
- [ ] A debug/local build uses the App Check debug provider so local development and the gauntlet still work.

### Performance

- [ ] Token verification adds under 10 ms per request at p95, asserted over 100 real requests.
- [ ] Verification results are cached within their validity window so a single client is not re-verified on every call.

### Security

- [ ] Enforcement is applied centrally, not per route, so a new route is attested by construction — asserted by a test that adds a route and expects it to be attested without edit.
- [ ] The iOS permissive path is explicitly asserted to be OFF by default in production configuration, so an unprovisioned key cannot quietly disable attestation for everyone.
- [ ] App Check is additive: it never replaces the auth, ban, suspension or cohort checks, asserted by a test that a banned caller with a valid App Check token is still refused.
- [ ] The debug provider is asserted unreachable in production configuration.

### UX

- [ ] A genuine user never sees an attestation error. Any user-visible failure message is generic, translated, and offers a retry rather than exposing the mechanism.
- [ ] Verified on a real Android device that normal use is completely unaffected.

### i18n

- [ ] Any new user-facing message exists in all 20 locales and is asserted on rendered text.
- [ ] If no user-facing message proves necessary — the expected outcome for genuine clients — that is recorded rather than assumed.

### Observability

- [ ] An attestation refusal logs distinctly from an auth refusal and from a ban refusal, so the three are separable during an incident.
- [ ] The rate of attestation failures is queryable, so a rollout problem is distinguishable from an attack.
- [ ] The iOS switch's current state is logged at startup, so "is iOS attested right now" is answerable without reading config.

## BDD Scenarios

**Scenario: The real app works exactly as before**

- **Given** a genuine install of the app on a real Android device
- **When** the user does anything that talks to the server
- **Then** everything works exactly as it did before

**Scenario: A repackaged copy of the app is refused**

- **Given** a modified copy of the app signed in as a real user
- **When** it makes a request to the server
- **Then** the request is refused

**Scenario: A banned user is still refused even from a genuine app**

- **Given** a banned user on a genuine install
- **When** they make a request to the server
- **Then** the request is refused because they are banned

**Scenario: A banned user can still appeal**

- **Given** a banned user on a genuine install
- **When** they submit an appeal
- **Then** the appeal is accepted

## Test Plan

**RED first.**

### Node / Jest (`express-api/tests/middleware/app-check.test.js`)

- `refuses an authenticated request with no App Check token`
- `refuses an authenticated request with an expired token`
- `refuses a token minted for a different app`
- `allows an authenticated request with a valid token`
- `refuses a banned caller even with a valid App Check token`
- `keeps the appeal path reachable for a banned caller`
- `keeps the GDPR-export path reachable for a banned caller`
- `keeps the ban-screen path reachable with no session`
- `logs an attestation refusal distinctly from an auth refusal`
- `logs an attestation refusal distinctly from a ban refusal`
- `applies enforcement centrally so a newly added route is attested without edit`
- `asserts the iOS permissive switch is off in production config`
- `asserts the debug provider is unreachable in production config`
- `caches verification within the token validity window`
- `adds under 10ms at p95 over 100 real requests`

The central-enforcement test is the one with the longest half-life: it is what
stops route number 50 shipping unattested.

### Integration, real stack

- Real Express + real emulator with a real App Check debug token: full request
  path exercised, not a unit-level stub.

### Device, REAL Android

- Genuine install with Play Integrity: normal use entirely unaffected across the
  full journey corpus.
- A request without a valid attestation token refused, demonstrated against the
  real dev API.

### Device, REAL iPhone

- Confirm the documented switch behaves as specified in its unprovisioned state
  and that this state is loudly logged.
- Full enforcement deferred until the operator provisions the Apple `.p8`.

### Mutation proof

| Mutation | Must kill |
| -------- | --------- |
| App Check applied per route instead of centrally | `applies enforcement centrally so a newly added route is attested without edit` |
| App Check replaces the ban check rather than adding to it | `refuses a banned caller even with a valid App Check token` |
| attestation applied to the appeal path | `keeps the appeal path reachable for a banned caller` |
| iOS permissive switch defaults on | `asserts the iOS permissive switch is off in production config` |
| debug provider enabled in production config | `asserts the debug provider is unreachable in production config` |
| refusal logged with the same code as an auth failure | `logs an attestation refusal distinctly from an auth refusal` |

### Backend change ⇒ FULL gauntlet

Touches `express-api/src/**` — and this one changes the gate every client passes
through, so the full device + all-browser matrix is not merely required by
policy, it is the actual risk. A mistake here locks out every real user.

## Out of Scope

- iOS App Attest enforcement, until the Apple `.p8` key is provisioned. Tracked
  by the same blocker as SHY-0151.
- Replacing any existing auth, ban, suspension or cohort check. App Check answers
  a different question and is strictly additive.
- Rate limiting or abuse detection beyond attestation.
- Client-side tamper detection — a different control with different trade-offs.

## Dependencies

- The existing `middleware/app-check.js` and the SHY-0300 precedent that
  established App Check on unauthenticated paths.
- **Operator action required for iOS:** an Apple `.p8` App Attest key. The same
  blocker currently holds SHY-0151 in EPIC-0005.
- Independent of EPIC-0011 — it neither blocks nor is blocked by that epic.

## Risks & Mitigations

| Risk | Mitigation |
| ---- | ---------- |
| Enforcement locks out every genuine user | Full gauntlet on real devices before merge, plus staged confidence: the story is explicitly about the gate every client passes through, and that risk is why the device matrix is non-negotiable here. |
| The iOS unprovisioned state silently disables attestation for everyone | Asserted off by default in production config, logged at startup, and defaulting-on is in the mutation table. |
| App Check is mistaken for a replacement for ban enforcement | Additive by AC, asserted by a test that a banned caller with a valid token is still refused. |
| Attestation makes a ban unappealable | The existing deliberate exemptions are preserved and asserted; attesting the appeal path is in the mutation table. |
| A new route ships unattested six months from now | Central enforcement asserted by a test that adds a route. |

## Definition of Done

- [ ] Every AC checkbox above is met.
- [ ] Every named test exists, was observed RED first, and is now green.
- [ ] Every mutation killed its named test and was reverted with a git-verified clean tree.
- [ ] **Android enforcement proven on a real Android device**, with the full journey corpus unaffected for a genuine install.
- [ ] A non-attested request proven refused against the real dev API.
- [ ] The iOS switch's unprovisioned behaviour proven on a real iPhone and its startup log confirmed.
- [ ] Backend change ⇒ FULL gauntlet green, then DEV green.
- [ ] `cd express-api && npm test` passes; `npm run lint` clean at `--max-warnings=0`.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] `bash scripts/pre-merge-check.sh <PR#>` emits `PRE-MERGE-CHECK: OK`.
- [ ] Status `In Review` before merge; `Done` on release cut with `released_in:`.

## Notes (running log)

- **2026-08-17** — Found during the EPIC-0011 design audit, in response to the operator's requirement: *"we also need server-side verification on these areas, in case someone tries to make a hacked copy of the app to avoid these restrictions. the API/backend should always be ensuring that any request is legal and within the rules."*
- **2026-08-17** — The audit found the other two questions already well answered: auth is deny-by-default at `index.js:117`, and ban/suspension/cohort are enforced in both auth paths. Attestation was the only real gap. Recorded in `.project/plans/2026-08-17-server-driven-ui-design.md` §6.2.
- **2026-08-17** — The deliberate appeal / GDPR-export / ban-screen exemptions (`isBanExemptPath:297`) are correct and must survive this change: a gate that also blocks the appeal is a gate with no exit.
- **2026-08-17** — iOS blocked on the Apple `.p8` key, same blocker as SHY-0151. Android proceeds rather than waiting.
