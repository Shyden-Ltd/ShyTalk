---
id: SHY-0282
status: Draft
owner: claude
created: 2026-08-05
priority: P2
effort: S
type: bug
roadmap_ids: []
public: true
phase: Website & Presence
---

# SHY-0282: The site header offers "Sign In" to people who are already signed in

## User Story

As **a signed-in visitor opening any ShyTalk web page**,
I want **the header to wait until it knows who I am before it decides what to show me**,
So that **I am not invited to sign in to an account I am already using**.

## Why

`shared-header.js` decides between "Sign In" and the visitor's name by reading `window.shytalkAuth.currentUser`. Before the page's Firebase check has finished, that value is `null` — and the header treats it as *signed out* rather than *not known yet*, so it renders the **Sign In** button. When the check resolves a moment later, the header removes itself and rebuilds with the visitor's name.

Every signed-in visitor therefore sees a Sign In button flash on **every page load**. Measured during [[SHY-0279]] on the local stack: the window between the header's first render and the sign-in check resolving was **~500-600 ms** — long enough to read, and long enough to click.

Clicking it during that window is the real cost: on `roadmap.html` it opens the login modal for someone who is already authenticated, and on the legal pages it navigates them away to `/portal/`. Both are the "asked to sign in while signed in" failure the W1 fix set out to remove — that fix closed the *profile-loading* window (`getAuth()` deliberately treats `profile === null` as signed-in, and its comment says so in as many words), but the earlier *auth-unknown* window was left open because there was nothing to test for.

There is now. [[SHY-0279]] published `window.shytalkAuth.authStateKnown` precisely so a consumer can tell "signed out" from "we don't know yet", and `roadmap-auth.js` already uses that flag internally for its own container — `renderAuthUI()` shows a neutral "Loading..." until the state is known. The shared header simply never got the same treatment.

One wrinkle to design around, not around which to give up: `404.html` and `index.html` load `shared-header.js` **without** `roadmap-auth.js`, so `window.shytalkAuth` is never defined there at all and no flag will ever arrive. On those pages "Sign In" is the correct and final answer, and it must not be delayed.

## Acceptance Criteria

### Happy path

- [ ] A signed-in visitor never sees the Sign In button on a page that loads the auth module.
- [ ] A signed-out visitor still sees the Sign In button, with no added delay once the check resolves.

### Error paths

- [ ] If the sign-in check never resolves, the header falls back to the signed-out presentation rather than staying blank forever.
- [ ] On a page that does not load the auth module at all (`404.html`, `index.html`), the header renders its signed-out state immediately — it must not wait for a flag that will never come.

### Edge cases

- [ ] A visitor whose profile is still loading (`profile === null`) is shown as signed in, preserving the existing W1 behaviour.
- [ ] A Firebase identity with no ShyTalk account (`profile === false`) still shows Sign In.
- [ ] The header does not reserve a differently-sized placeholder that makes the page jump when the real state arrives.

### Performance

- [ ] No additional network request, and no delay to first paint for the signed-out case on auth-less pages.

### Security

- [ ] The pre-resolution state reveals nothing about whether a visitor is signed in.

### UX

- [ ] Nothing in the header's right-hand slot changes identity mid-interaction — no control appears under a pointer already travelling toward it.
- [ ] The transition into the resolved state is not a visible flicker.

### i18n

- [ ] Any placeholder carries no untranslated user-facing string, or uses the existing `data-i18n` mechanism if it carries text.

### Observability

- [ ] A check pins that the header consults `authStateKnown` rather than inferring signed-out from a null user.

## BDD Scenarios

**Scenario: A signed-in visitor is never offered a sign-in**
- **Given** a visitor is signed in
- **When** they open a page that shows the site header
- **Then** the header never offers them Sign In

**Scenario: A signed-out visitor still gets the sign-in option**
- **Given** a visitor is not signed in
- **When** the page finishes checking
- **Then** the header offers them Sign In

**Scenario: Pages without the sign-in check are not left waiting**
- **Given** a page that does not check who the visitor is
- **When** the visitor opens it
- **Then** the header offers Sign In straight away

## Test Plan

**Red (written first, must fail against today's code):**

- `tests/web/shared-header.spec.ts` (extend)
  - `no Sign In button is rendered before the sign-in check resolves` — **fails today**: it renders immediately with `currentUser === null`.
  - `a signed-in visitor never renders a Sign In button at any point during load` — records the header's right-slot contents from before the first paint (the `recordAuthPublications` accessor pattern from `auth-state-known-contract.spec.ts` extended to a `MutationObserver`) and asserts `header-signin-btn` never appears. **Fails today.**
  - `a page without the auth module renders Sign In immediately` — guards the `404.html` / `index.html` case against a fix that waits for a flag that never arrives.
- `tests/web/auth-injection-discipline.spec.ts` (extend)
  - `the header consults authStateKnown` — structural; fails today.

**Green:** the full `shared-header.spec.ts`, `shared-header-i18n.spec.ts` and `shared-header-signin-fallback.spec.ts` on all five projects — 20 assertion sites across those three files read the header's auth slot and are the blast radius of any render-timing change.

**Real services only:** the signed-in case is driven through the real Firebase Auth emulator (`createTestUser` + `roadmapLogin` in `tests/web/helpers/roadmap-auth.ts`), not an injected global — the defect is precisely about the window *before* the real check resolves, which an injection would skip over.

## Out of Scope

- The double-publish and stale-callback defects in `roadmap-auth.js` — [[SHY-0280]].
- Any change to what the header shows once the state IS known.
- The auth container's own "Loading..." presentation inside the suggestions board.

## Dependencies

- Requires [[SHY-0279]] (merged), which published `authStateKnown`. Without it the header has nothing to consult.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Waiting for the flag leaves auth-less pages headerless forever | The `404.html`/`index.html` case is an explicit AC with its own red test; those pages resolve immediately because no auth module is present |
| A placeholder causes layout shift | AC forbids a size change between placeholder and resolved state; the responsive checks at 320px already guard the header's geometry |
| The change ripples through the 20 header assertion sites | All three header spec files run on all five projects as the green gate |

## Definition of Done

- [ ] Red tests observed failing against unmodified code.
- [ ] No Sign In button is ever rendered to a signed-in visitor, proven with a real sign-in.
- [ ] `code-reviewer` 100% clean; CI green by name.
- [ ] LOCAL gauntlet green on real Android + real iOS + the full browser matrix (`public/**` is a shipped runtime surface), then DEV, then judgment-merge.

## Notes (running log)

- **2026-08-05 03:45 WIB** — Found during [[SHY-0279]] and deliberately kept out of it: that story published the flag and made the checks deterministic without changing a single pixel, which is what let it land as the PR that finally gets `playwright-web` running. This one changes shipped rendering and needs the full device/browser gauntlet, so folding it in would have held the queue-unblocking fix behind a gauntlet.
- **2026-08-05 03:46 WIB** — The irony worth recording: `getAuth()` in `shared-header.js` carries an eight-line comment explaining that requiring a truthy profile "would briefly flash the Sign In button to an already-signed-in user on every page load". The author closed that window and missed the one immediately before it, because at the time there was no way to observe the difference.
