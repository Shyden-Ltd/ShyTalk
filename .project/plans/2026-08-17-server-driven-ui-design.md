# Server-Driven UI — design

**Date:** 2026-08-17
**Status:** Approved (operator, 2026-08-17). Spec pending review.
**Author:** claude
**Epic:** EPIC-0011 (Phase 1). Phase 2 gets its own EPIC, raised when Phase 1 closes.
**Supersedes:** nothing. First SDUI design in this repo.

---

## 1. Summary

Move as much of the app's visual surface as safely possible behind a
server-served document, so look-and-feel, menus, navigation, options, copy and
feature availability can change **without a Play Store or App Store release**.

Delivered in two phases:

| Phase | What it is | In MVP? |
|-------|-----------|---------|
| **1 — plumbing + config layer** | The manifest pipeline (fetch, cache, fallback, versioning, rollback, admin UI, cohort-aware serving, sealed-screen enforcement) plus a config layer covering navigation, menus, settings, design tokens, copy and feature flags. | **Yes** |
| **2 — renderer** | A layout-tree renderer over a fixed component catalogue, enabling remotely-composed screens and arrangements never shipped in a binary. | No — follows Phase 1 |

Phase 1 is not a smaller version of Phase 2; it is **the first half of it**. The
plumbing is identical for both, so nothing built in Phase 1 is rewritten in
Phase 2.

### Decisions locked (operator, 2026-08-17)

1. **Approach:** Phase 2 via Phase 1 — plumbing + config layer first.
2. **Publishing:** git-backed source of truth **and** an admin UI, both from
   the start, sharing one pipeline.
3. **Safety line:** five enforcement screens are sealed from the manifest.
4. **Server-side enforcement is the real control**, not the sealed UI — a
   modified client that never draws a gate must still be refused by the API.
5. **Age gating:** the gacha age-verification gate is removed; cohort
   segregation is **kept**. See §10.
6. **Sequencing:** EPIC-0004 (persistent session / cold start) lands **first**
   and carries the manifest fetch.

---

## 2. Why

Every visual change today costs a store release: a build, a submission, and
1–7 days of review, with no ability to correct a mistake inside that window.
That is the wrong cost curve for a pre-launch product that expects to iterate
on look, menus and options continuously, and it is a genuinely bad failure mode
for a mistake that is live in front of users.

The operator's framing was "as much as we possibly can without causing major
issues" — so the design maximises reach and spends its complexity budget on
bounding the blast radius rather than on narrowing scope.

---

## 3. Constraints

These are not preferences; each one eliminates otherwise-reasonable designs.

**C1 — App-store policy. Data may be downloaded; executable code may not.**
Apple's Guidelines 3.3.2 / 2.5.2 and Google Play's Device and Network Abuse
policy converge here. The manifest is therefore a *declarative document
interpreted by a renderer that ships inside the binary*. The server chooses
among components the app already has; it can never introduce a new kind of
component. This is the same shape used by Airbnb's Ghost Platform, Spotify's
HubFramework and Lyft. It bounds Phase 2's ceiling permanently, and is the
reason the component catalogue is a first-class, versioned artefact.

**C2 — $0 hosting.** Serving a document to every client on every cold start is
a bandwidth line item. Mitigated by ETag + conditional GET: the steady state is
a `304 Not Modified` with no body, so bandwidth is paid per *change*, not per
*launch*.

**C3 — API-only backend access** ([[feedback-no-direct-backend-all-via-api]],
EPIC-0006). Clients must not read the manifest from Firestore directly. It is
served by the Express API — which is a benefit, not a tax: the API already
resolves the caller's identity and cohort, so cohort-aware manifests and
segregation come free and are enforced at the same chokepoint as everything
else.

**C4 — No stubs/mocks/fakes outside unit tests.** The manifest pipeline is
integration-shaped by nature (network, disk cache, cold start). Its tests run
against the real local stack and real devices. The acceptance test for the epic
is a real-device journey that edits a manifest and observes the running app
change without reinstall.

**C5 — 20 locales.** Server-served copy must cover all 20, or a remotely-added
menu item is untranslated — which defeats the purpose. See §5.4.

**C6 — Minors-facing app.** Cohort segregation is a child-safety control and is
retained. See §6 and §10.

**C7 — Tri-platform.** Android, iOS and web all consume the manifest. The
config layer is shared Kotlin in `commonMain`; the web reads the same document
through its own consumer.

---

## 4. Architecture

### 4.1 The document

One versioned JSON document per client, resolved server-side against the
caller's identity, cohort, platform and app version.

```jsonc
{
  "schemaVersion": 1,
  "manifestVersion": "2026-08-17T11:42:00Z#a1b2c3d",
  "minAppVersion": "1.4.0",

  "tokens": {
    "color.primary":   "#7C3AED",
    "color.surface":   "#0F0D15",
    "spacing.md":      12,
    "radius.card":     16
  },

  "strings": {
    "en": { "beans_label": "Beans" },
    "id": { "beans_label": "Kacang" }
  },

  "navigation": {
    "home": {
      "tabs": [
        { "id": "rooms",  "labelKey": "nav_rooms",  "icon": "mic",    "route": "rooms" },
        { "id": "feed",   "labelKey": "nav_feed",   "icon": "feed",   "route": "feed" },
        { "id": "shop",   "labelKey": "nav_shop",   "icon": "gift",   "route": "shop",
          "visibleIf": { "feature": "shop" } }
      ]
    }
  },

  "menus": {
    "settings": {
      "items": [
        { "id": "account",  "labelKey": "set_account", "action": { "route": "account" } },
        { "id": "support",  "labelKey": "set_support", "action": { "url": "https://…" } }
      ]
    }
  },

  "features": {
    "gacha": { "enabled": true },
    "shop":  { "enabled": true }
  },

  "rollout": { "percent": 100, "cohorts": ["adult", "minor"] }
}
```

Phase 2 adds a `screens` key holding layout trees. Same document, same
endpoint, same pipeline — `schemaVersion` goes to 2.

**Design note — why one document rather than per-feature endpoints.** A single
document is atomically consistent: a menu item and the string it references and
the feature flag that reveals it either all arrive or none do. Split endpoints
would allow a half-applied change, which is precisely the failure that has no
visible symptom. The cost is a larger payload, which C2's ETag strategy makes
irrelevant in the steady state.

### 4.2 Resolution — three tiers, never blocking

```
        ┌─────────────────────────────────────────────┐
        │  1. FRESH FETCH   GET /api/ui-manifest       │
        │     (background, never blocks first paint)   │
        └───────────────────────┬─────────────────────┘
                                │ fails / slow / offline
        ┌───────────────────────▼─────────────────────┐
        │  2. DISK CACHE    last good manifest         │
        │     (written only after successful parse)    │
        └───────────────────────┬─────────────────────┘
                                │ absent (first launch)
        ┌───────────────────────▼─────────────────────┐
        │  3. BUNDLED       compiled into the binary   │
        │     ALWAYS present. The app is fully usable  │
        │     having never reached the server.         │
        └─────────────────────────────────────────────┘
```

The bundled default is a hard requirement, not a nicety. It is what runs on
first launch before any network call completes, in airplane mode, on a failed
fetch, and on a manifest that fails schema validation. It is generated from the
committed `manifests/` source at build time so it cannot drift from the schema.

**The UI never waits on the network.** Cold start reads tier 2 or 3
synchronously and paints; a fresh fetch resolves in the background and applies
on the next natural recomposition. This is the same optimistic-cold-start
principle EPIC-0004 is already building, which is why the two belong together.

### 4.3 Delivery

`GET /api/ui-manifest`

- **Authenticated variant** — cohort-aware, personalised by feature
  entitlements. Uses the existing global auth gate at `index.js:117`.
- **Pre-auth variant** — served to a client with no session (needed because
  cold start paints before sign-in resolves). Contains no
  cohort-dependent content. Goes on the `auth-skip` allowlist, and **must be
  added to the `requiresAppCheck` predicate** so it is attested — being on the
  skip list does not confer that by itself; `requiresAppCheck` names specific
  paths. Follows the SHY-0300 precedent set for the other skip-list paths.
- **`ETag` + `If-None-Match`** → `304` in the steady state (C2).
- **`Cache-Control: private, no-cache`** — revalidate always, but the ETag
  saves the payload. Deliberately *not* `max-age`: a manifest inside a
  max-age window is a change you published and cannot see, which is the
  hot-fix path failing silently. This mirrors the same fix applied to the
  suggestions read path.

---

## 5. The config layer (Phase 1 capability)

### 5.1 Navigation and menus

Server-defined item lists: id, label key, icon name, action (route or URL),
ordering, and a `visibleIf` predicate over features and cohort. Icons are
resolved against a **shipped icon registry** — a name the binary doesn't know
is skipped, not drawn as a blank.

### 5.2 Design tokens

A flat token map (colour, spacing, radius, typography) consumed by the Compose
theme and by web CSS custom properties. This is the highest-leverage item in
Phase 1: it reaches all 236 composables at once without touching any of them
individually, provided they consume the theme rather than hard-coded values.

**Prerequisite work:** an audit of hard-coded colours/dimensions in
`commonMain`. Any composable using a literal is invisible to theming. This is
its own story and is a genuine prerequisite, not a nice-to-have.

### 5.3 Feature flags

`features.<id>.enabled` — the kill-switch. Consumed by `visibleIf` predicates
and directly by native screens. **A disabled feature must also be refused
server-side** (§6.2); the flag hides the entrance, the API closes the door.

### 5.4 Copy, in 20 locales

Server strings **override** bundled strings by key; a key absent from the
manifest falls back to the bundled resource. A remotely-added item whose label
key exists in no locale renders the key name, which is visibly wrong — so
publish-time validation rejects a manifest referencing a label key that is
missing from any of the 20 locales. This overlaps with SHY-0072 (lazy
translation service) and the two should share the translation path rather than
grow separate ones.

---

## 6. Safety model

### 6.1 The sealed set

Five screens are unreachable from any manifest key:

| Screen | Why sealed |
|--------|-----------|
| Ban / suspension | Failure is invisible and permissive — a hidden ban screen looks like a working app, and the only witness is the banned user |
| App-Lock / unlock prompt | Same shape; a skipped lock is a silent grant |
| Cohort segregation gate | Child-safety boundary; a silent failure mixes minors and adults with no visible symptom |
| Unsafe-device screen | Integrity gate; failure grants |
| Account deletion | Irreversible; a mislabelled confirm destroys data |

The common property is not importance — it is that **these fail open and
silently**, in the permissive direction, with no error, no crash, and no
complaint. Every other screen fails visibly and self-corrects fast, which is
exactly what makes them safe to hot-push.

**Enforcement:** the set is a Kotlin sealed type; a CI test enumerates the
manifest key space and fails the build if any key resolves to a sealed screen.
The boundary cannot erode by accident, only by deliberately editing the test.

**Not frozen — just not hot-pushable.** These screens change through a normal
release like any other code. Moving one out of the sealed set later is a small
change; the reverse, after a bad push, is not.

### 6.2 The server is the authority

The sealed set is defence in depth. **The actual control is server-side
enforcement**, because a modified client does not need to hide a gate — it
simply never draws one.

Audited 2026-08-17. Already enforced on every authenticated `/api` request in
`express-api/src/middleware/auth.js`, in **both** auth paths — `authMiddleware`
(:175) and `authMiddlewareStrict` (:311):

- **Suspension** → `403 Account suspended` (`auth.js:201`, and `:346` in the
  strict path)
- **Ban** — device + network, re-checked per request (`auth.js:215–241`, and
  `:361–381` strict) → `403 { code: 'banned', banType }`
- **Auth** is deny-by-default at `index.js:117`, with a small unit-tested skip
  allowlist in `middleware/auth-skip.js`
- **Cohort** via `requireSameCohort` — 23 call sites plus dedicated middleware

**Deliberate exemptions, and they are correct.** `isSuspensionExemptPath`
(`auth.js:259`) and `isBanExemptPath` (`:297`) carve out the appeal,
GDPR-export and ban-screen paths. A ban must not confiscate the rights that
let a user contest it or retrieve their data — a gate that also blocks the
appeal is a gate with no exit. Any new endpoint added to those lists is a
security-review item.

The per-route `requireNotSuspended` calls in `routes/suggestions.js` are a
second local check, not the primary one.

**Gap found: App Check is enforced only on unauthenticated routes.**
`requiresAppCheck` is called inside the `skipsAuth` branch at `index.js:129`,
so authenticated routes accept any request bearing a valid Firebase ID token —
and a modified build signed into a genuine account has one legitimately. App
Check (Play Integrity / App Attest) is the control that proves the *binary* is
unmodified. Filed as its own story; **Android can proceed, iOS App Attest is
blocked on the Apple `.p8` key that also holds SHY-0151** in EPIC-0005.

This gap predates and is independent of SDUI, but SDUI raises its value: once
UI is remotely configurable, "the client didn't show the gate" becomes a
cheaper attack to attempt.

### 6.3 Version and schema safety

- **`minAppVersion`** — a client older than the manifest's floor ignores it
  entirely and stays on its bundled default, rather than rendering a document
  referencing components it lacks.
- **Fail-safe parsing** — unknown keys ignored; a malformed section falls back
  to bundled defaults for *that section only*; a manifest failing top-level
  validation is discarded whole and the previous good one retained. Never a
  crash, never a blank screen.
- **Publish-time validation** — schema, referenced label keys present in all 20
  locales, referenced icons present in the registry, referenced routes present
  in the nav graph, no sealed-screen references. A manifest that fails does not
  publish.

---

## 7. Publishing pipeline

Git-backed source of truth **and** an admin UI, sharing one path — the admin UI
does not bypass git, it writes through it.

```
   ┌────────────────┐        ┌────────────────┐
   │  Admin UI edit │        │  PR (manifest  │
   │                │        │  JSON in repo) │
   └───────┬────────┘        └───────┬────────┘
           │                          │
           ▼                          │
   ┌────────────────┐                 │
   │ Validate       │  reject on fail │
   │ (§6.3 rules)   │                 │
   └───────┬────────┘                 │
           │                          │
           ▼                          ▼
   ┌──────────────────────────────────────────┐
   │  Commit to `manifests/*.json` on develop  │
   │  via App-signed createCommitOnBranch      │
   │  (same mutation release.yml already uses) │
   └────────────────────┬─────────────────────┘
                        ▼
              ┌───────────────────┐
              │  CI deploy → API  │
              └───────────────────┘
```

Consequences, all of them deliberate:

- **Every live edit produces a real commit** with a real diff and a real
  author. There is no such thing as an un-auditable manifest change.
- **Rollback is `git revert`.** The admin "restore version N" button performs
  exactly that; there is one rollback mechanism, not two.
- **Staged rollout** — `rollout: { percent, cohorts }`, bucketed on a stable
  hash of the user id so a given user's assignment is consistent across
  launches. A bad push reaches 5% before it reaches everyone.
- **`manifestVersion` is reported in client telemetry**, so "which manifest was
  this user on" is answerable during an incident.

**Publish latency:** minutes (validate + commit + CI deploy), against 1–7 days
for a store release. The admin UI's value is removing the PR round-trip, not
removing CI.

---

## 8. Testing strategy

Per C4, real-only outside unit tests.

| Layer | What it proves |
|-------|----------------|
| **Unit** (`*.unit.test.*`, `commonTest`) | Schema parsing, fallback selection, `visibleIf` evaluation, rollout bucketing determinism, version comparison |
| **Contract** | Server-emitted and client-parsed schemas agree; golden manifest fixtures pinned both sides |
| **Sealed-screen CI test** | No manifest key resolves to a sealed screen |
| **Publish validation** | Every §6.3 rule rejects a real bad manifest |
| **Integration (real stack)** | Endpoint serves cohort-correct manifests; ETag returns 304; pre-auth variant requires App Check |
| **Device journey (real Android + real iPhone)** | **The epic's acceptance test:** edit a manifest, observe the running app change without reinstall |
| **Offline / first-launch (real, radio off)** | App fully usable on bundled defaults having never reached the server |
| **Rollback drill** | Publish a deliberately-bad manifest to a 5% bucket, revert, confirm recovery |

The rollback drill is deliberately included. A rollback path that has never
been executed is a rollback path that does not work.

---

## 9. Sequencing

**EPIC-0004 (persistent session & instant cold-start) lands first.**

Not merely operator preference — that work is already rewriting cold start to
be optimistic and to resolve state *before* routing, which is exactly where the
manifest fetch and its three-tier resolution belong. Building SDUI first would
mean designing cold start twice and then reconciling the two designs.

EPIC-0004 is also, in its own words, a testing accelerator: it removes the
per-launch sign-in tax from every device/browser gauntlet cycle, which
compounds across the whole remaining MVP programme — including this epic's own
device journeys.

> **Caveat:** SHY-0143's spec is stale following SHY-0187
> ([[project-shy0143-spec-stale-after-shy0187]]) and must be re-validated at
> pickup before implementation starts.

Then Phase 1 of this design, then Phase 2.

---

## 10. Age gating (related decision, same session)

Operator decision 2026-08-17: **remove the gacha age-verification gate; keep
cohort segregation.** Reasoning: gacha awards no cash-out value, so the
gambling-age rationale does not apply. Segregation is retained because it is a
child-safety control for a voice-chat product, not a gambling control — a
distinct mechanism that the gacha reasoning does not reach.

Recorded with its full context, including the points raised before the decision
(Indonesia is stricter on gambling than the UK; jurisdiction follows the user
rather than the company; store Families policy is contractual and global), in
[[project-indonesia-relocation-and-age-gating-decision]].

Filed as its own story. It is **not** part of this epic — it is sequenced
alongside it because it removes a screen the sealed set would otherwise have
had to cover.

---

## 11. Impact on existing and future work

The operator's instruction: *"make sure all the future tickets are aware of
this major change."* Three mechanisms, none of them a note in a document
someone has to remember to read:

1. **CLAUDE.md section** — the manifest contract, the sealed set, and the rule
   that new UI is manifest-driven by default.
2. **A required story question** — *does this add UI, and is it
   manifest-driven or native?* Native requires a stated reason. Added to the
   story template so `scripts/check-story-frontmatter.sh` can see it, making it
   mechanically enforced rather than remembered.
3. **A sweep of existing Draft stories** — tag every one that adds UI so it is
   re-scoped *before* pickup rather than discovered mid-implementation.

---

## 12. Phase 2 sketch (not in MVP)

Recorded so Phase 1's interfaces don't foreclose it, not for implementation now.

- **Component catalogue** — a versioned, closed set of primitives (`column`,
  `row`, `card`, `text`, `image`, `button`, `list`, `spacer`) plus opaque
  **native embeds** (`voiceRoom`, `gachaReel`) that let a remote layout host a
  complex native screen as a single node.
- **Layout trees** under a `screens` key, `schemaVersion: 2`.
- **Unknown-node behaviour is the critical design point** — an unrecognised
  component must degrade to nothing-drawn while its siblings still render,
  never to a blank screen. This is what makes `minAppVersion` a safety net
  rather than the only defence.
- The renderer is comparable in size to the whole of Phase 1 and needs its own
  test apparatus, which is why it is not in MVP.

---

## 13. Risks

| Risk | Mitigation |
|------|-----------|
| A bad manifest reaches all users instantly | Staged rollout by bucket; publish-time validation; git revert as rollback; rollback drill in the test plan |
| Store rejects the approach | Declarative-data-only (C1); no downloaded executable code; matches the pattern used by shipping apps at scale |
| Theming reaches only part of the UI | Hard-coded colour/dimension audit is an explicit prerequisite story, not an assumption |
| Manifest bandwidth cost | ETag/304 steady state; measured against the $0 budget before Phase 1 closes |
| Admin UI expands scope | Sized explicitly as the largest Phase 1 line item; git+CI path ships first so the admin UI is additive, never blocking |
| Sealed boundary erodes over time | CI test, not convention |
| A modified client ignores the UI entirely | Server-side enforcement is the real control (§6.2); App Check gap filed separately |

---

## 14. Open questions

1. **Web consumption** — does the website read the same manifest, or only the
   apps in Phase 1? Serving both from one document is cheaper long-term but
   widens Phase 1. *Recommendation: apps only in Phase 1, web in Phase 2.*
2. **Token audit size** — the hard-coded colour/dimension debt in `commonMain`
   is unmeasured. Needs a counting spike before Phase 1 is estimated.
3. **Admin UI surface** — full manifest editing, or a curated form per section?
   *Recommendation: curated forms; a raw JSON editor in an admin panel is a
   production incident with an autocomplete.*

These are scoping questions for the implementation plan, not blockers to it.
