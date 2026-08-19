---
id: SHY-0280
status: Draft
owner: claude
created: 2026-08-05
priority: P2
effort: M
type: bug
roadmap_ids: []
---

# SHY-0280: The signed-in roadmap path publishes twice and has never been exercised by a real sign-in

## User Story

As **a signed-in visitor to the public roadmap page**,
I want **the page to settle my sign-in state once instead of re-drawing the header twice for the same fact**,
So that **a control I am reaching for is not rebuilt underneath my finger**.

## Why

Surfaced by `code-reviewer` during [[SHY-0279]] and verified by hand against the source. Three related gaps, all in code SHY-0279 deliberately did not touch — it fixed the checks that were racing the page; these are defects in the page's own signed-in path.

**1. Two identical dispatches for one transition.** `renderAuthUI()` (`public/js/roadmap-auth.js:66-72`) handles "Firebase identity with no ShyTalk account" by clearing `currentUser` and calling `updateGlobalAuth()`. Its only caller that can reach that branch is `checkShyTalkAccount()` (line 215), which calls `updateGlobalAuth()` again on the very next line. Every call sites of `renderAuthUI()` was traced (lines 111, 118, 135, 156, 191, 215, 237, 313, 319); `currentUser` is guaranteed falsy at all of them except 215, so this is the only path that reaches the branch — and it always double-publishes, with identical state both times.

This is not cosmetic. `shared-header.js` `render()` removes and rebuilds the entire header on every `shytalk-auth-changed`. A redundant dispatch is exactly the mechanism that produced `element was detached from the DOM, retrying` in SHY-0279. Unlike that race, this one is **not timing-dependent** — it happens on every such page load.

**2. The signed-in branch has no executed proof.** The only check covering the W1 ordering contract (`roadmap-auth.spec.ts:1317`) reads the module's source text and compares string positions. It is a good pin and it catches a reordering, but it cannot see runtime behaviour: if `checkShyTalkAccount` grew an extra synchronous publish before its first `await`, the text order it checks would be unchanged and the pin would stay green. No check anywhere drives a **real** `onAuthStateChanged(user)` with a publication recorder attached — the recorder introduced by SHY-0279 and the real-sign-in helpers (`roadmapLogin`, `createTestUser`) never appear in the same file.

**3. An in-flight profile fetch can publish for the wrong visitor.** `checkShyTalkAccount(user)` (lines 196-217) writes the module-level `currentUser`/`shytalkProfile` rather than closing over its own invocation's `user`. If a second `onAuthStateChanged` fires while its fetch is in flight — sign-out, or a switch to another account — the stale callback still runs `renderAuthUI()` + `updateGlobalAuth()` against whatever the module state is *at resolution time*. The visible outcome is a header reading "Logged in as: X" for someone who has already signed out.

## Acceptance Criteria

### Happy path

- [ ] A visitor with a real Firebase identity and a valid ShyTalk profile causes exactly two `shytalk-auth-changed` dispatches for the whole sign-in lifecycle: one when the identity resolves (profile still loading) and one when the profile arrives.
- [ ] A visitor with a Firebase identity but **no** ShyTalk account causes exactly two dispatches, not three, and still sees the download prompt.

### Error paths

- [ ] A `/api/roadmap/me` failure that is neither 200 nor 404 leaves the visitor signed-in-but-profile-unknown and still publishes exactly once for that step.
- [ ] A profile fetch that rejects (network down) does not leave the header permanently mid-render.

### Edge cases

- [ ] A sign-out landing while a profile fetch is in flight never publishes the stale profile: the late callback is discarded.
- [ ] Switching accounts mid-fetch publishes the second account's profile, never the first's.
- [ ] The no-account path still clears `currentUser` before the header re-renders, so the header cannot show a name for a visitor being signed out.

### Performance

- [ ] Removing the redundant dispatch does not add a round trip or delay the header's first correct paint.

### Security

- [ ] A discarded stale callback never publishes another account's `profile` — the wrong-visitor publish in defect 3 is an information-exposure path, not merely a cosmetic one.

### UX

- [ ] The header does not visibly re-draw twice for a single sign-in outcome.

### i18n

- [ ] N/A — no user-facing string is added, removed or changed.

### Observability

- [ ] A structural check pins that `renderAuthUI()` does not publish, so the publish stays owned by the paths that decide state.

## BDD Scenarios

**Scenario: A visitor without a ShyTalk account sees the header settle once**
- **Given** a visitor signs in with an account that has no ShyTalk profile
- **When** the page finishes checking their account
- **Then** the header settles once and shows the download prompt

**Scenario: A signed-in visitor's header settles without redrawing twice**
- **Given** a visitor with a valid ShyTalk profile opens the roadmap page
- **When** their profile finishes loading
- **Then** the header updates once for the identity and once for the profile

**Scenario: Signing out during a slow profile load does not resurrect the visitor**
- **Given** a visitor signs out while their profile is still loading
- **When** the profile finally arrives
- **Then** the header still shows them as signed out

## Test Plan

**Red (written first, must fail against today's code):**

- `tests/web/roadmap-auth-publish-lifecycle.spec.ts` (new)
  - `a real sign-in with a valid profile publishes exactly twice` — fails today only if a regression exists; written first to establish the count.
  - `a real sign-in with NO ShyTalk account publishes exactly twice` — **fails today with 3**, the defect.
  - `a sign-out during an in-flight profile fetch never publishes the stale profile` — **fails today**, the wrong-visitor publish.
- `tests/web/auth-injection-discipline.spec.ts` (extend)
  - `renderAuthUI does not publish` — structural; fails today because line 72 publishes.

**Green:** the above, plus the full `roadmap-auth.spec.ts` / `shared-header.spec.ts` / `suggestions-board.spec.ts` files on `webkit` + `mobile-safari` + `chromium` to prove no dispatch-count regression reaches the header.

**Real services only:** sign-in is driven through the real Firebase Auth emulator via `createTestUser` + `roadmapLogin` (`tests/web/helpers/roadmap-auth.ts`); the no-account case is produced by creating a real auth user with no ShyTalk profile so `/api/roadmap/me` genuinely returns 404. No route mocking — the existing `page.route` fulfilments in this area are pre-existing debt, not a pattern to copy.

## Out of Scope

- The header's pre-resolution "Sign In" flash — separate defect, filed separately.
- Replacing the pre-existing `page.route(...)` fulfilments in `roadmap-auth.spec.ts` / `suggestions-board.spec.ts` with real backends.
- Any change to the SHY-0279 gate or the 12 converted injection sites.

## Dependencies

- Builds on [[SHY-0279]], which published `authStateKnown` and added the publication-recorder pattern these checks reuse. Land after it.
- Requires the local stack (real Auth emulator + Express API) for the real-sign-in checks.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Removing the publish at line 72 leaves some path unpublished | The call-site trace shows line 215 always republishes immediately after; the new lifecycle checks assert the count on every path rather than trusting the trace |
| Discarding a stale callback drops a legitimate late profile | The guard keys on the invocation's own `user`, so only a callback for a *superseded* visitor is discarded |
| Real sign-in makes these checks slow or flaky | Scoped to one new file; the auth emulator is local and already used by `suggestions-security.spec.ts` |

## Definition of Done

- [ ] Red checks observed failing against unmodified code, with the actual counts recorded.
- [ ] Dispatch count is exactly 2 on both signed-in paths.
- [ ] Stale-callback publish eliminated and covered.
- [ ] `code-reviewer` 100% clean; CI green by name; LOCAL then DEV gauntlet green (this touches `public/**`).

## Notes (running log)

- **2026-08-05 03:10 WIB** — Filed from `code-reviewer` findings on SHY-0279 (Critical #2, Important #4, Important #6). All three verified by hand against `public/js/roadmap-auth.js` before filing: the `renderAuthUI()` call-site trace was re-run independently, and line 215 is confirmed the only caller where `currentUser` can be truthy. Kept out of SHY-0279 because they are defects in code that story does not modify, and proving them needs a real sign-in harness that does not exist yet — folding them in would have held the queue-unblocking fix behind new test infrastructure.
