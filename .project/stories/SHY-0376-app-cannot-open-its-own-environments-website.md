---
id: SHY-0376
status: Draft
owner: unassigned
created: 2026-08-20
priority: P1
effort: M
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0376: The app cannot open its own environment's website

## User Story

As **someone using a dev build**, I want a link in the app to open the dev
website, so that banners and legal pages work instead of being refused.

## Why

**Reported by the operator, 2026-08-20.** Tapping the cyber-bullying banner in
the dev app opens the dev website, which **refuses the request** — and offers no
way to authenticate. The operator's words: the password "isn't even an option
and just rejects the access".

### Root cause

Every non-prod hostname is behind HTTP Basic auth, served by the Cloudflare Pages
middleware (`functions/_middleware.js` → `functions/_lib/lockdown.js`). A request
without credentials gets:

```js
// functions/_lib/lockdown.js:135
new Response(body, {
  status: 401,
  headers: { 'WWW-Authenticate': 'Basic realm="ShyTalk Non-Prod"', … })
```

A desktop browser answers that header with a native credential prompt. **An
in-app WebView does not** — Android only shows one if the host app implements
`onReceivedHttpAuthRequest`, which we do not. So the request is refused with no
route forward, and the user sees the challenge body instead of the page.

The gate itself is correct and must stay: dev and local must never be publicly
reachable. What is wrong is that it does not distinguish **a stranger on the
internet** from **our own dev build opening our own dev site**.

### The rule to implement

Operator, 2026-08-20: *"any links to the dev page accessed by the dev app should
work as normal but only from the dev apps. same with local -> local and prod ->
prod."*

So access is **environment-matched**: a dev build reaches dev without a prompt,
a local build reaches local, a prod build reaches prod. A dev build must still
not reach prod's admin surfaces, and no build may bypass the gate for an
environment it does not belong to.

## Acceptance Criteria

### Happy path

- [ ] A dev build opening a dev web link renders the page, with no credential
      prompt and no refusal.
- [ ] Local builds reach local, prod builds reach prod, on the same rule.
- [ ] The cyber-bullying banner — the reported case — opens and is readable.

### Error paths

- [ ] A request with no proof of origin still gets the existing 401. The gate is
      not weakened for anyone else.
- [ ] Proof that is expired, malformed, or replayed from another environment is
      refused.

### Edge cases

- [ ] A **prod** build must not gain access to dev or local by this mechanism,
      and vice versa — the match is exact, not "any of our apps".
- [ ] A human tester in a desktop browser keeps the existing password route.
- [ ] Whatever credential the app carries must be **absent from prod builds**, so
      shipping the store binary cannot leak a dev secret.
- [ ] Works on both Android WebView and whatever iOS uses for the same link.

### Performance

- [ ] At most one extra round-trip; no perceptible delay opening a link.

### Security

- [ ] **The dev site stays non-public.** This story narrows who is challenged, it
      does not remove the challenge.
- [ ] The mechanism must not be a static secret compiled into a widely
      distributed binary if that binary reaches the public. Prefer a short-lived
      signed value over a shared password; if a shared password is used it must
      be dev/local-build-only and never in a release build.
- [ ] `X-Robots-Tag: noindex` and the blocking robots.txt behaviour are unchanged.
- [ ] No credential is written to logs or crash reports.

### UX

- [ ] The user never sees a credential prompt they cannot satisfy.

### i18n

- [ ] Any new user-facing copy goes to the **5 MVP locales only** (en, zh, id,
      vi, th).

### Observability

- [ ] A refusal is logged with the reason (no proof / wrong environment /
      expired), so "the link does not work" is diagnosable without a repro.

## BDD Scenarios

**Scenario: A link in the app opens the matching site**

- **Given** someone is using a test build of the app
- **When** they tap a link to one of our pages
- **Then** the page opens normally, without asking for a password

**Scenario: The site stays closed to everyone else**

- **Given** someone who is not using our app
- **When** they visit a test address directly
- **Then** they are still refused

## Test Plan

1. **Reproduce first** on the real dev build: tap the cyber-bullying banner,
   capture the refusal. This is the RED state.
2. Unit-test the middleware's decision function directly: valid proof for the
   matching environment passes; missing, expired, malformed, and
   wrong-environment proof all still 401. Validate the detector against the
   pre-fix middleware so a passing suite means "gate works", not "test broken".
3. Assert a prod-shaped build cannot open dev, and a dev-shaped build cannot open
   prod.
4. Assert the release build contains no dev credential (a build-artifact check,
   in the spirit of `build-debug-dev-secret-leak.unit.test.js`).
5. Device-verify on the real Android device and the real iPhone — this is a
   WebView behaviour and cannot be proven on an emulator.
6. Keep the existing dev-lockdown tests green
   (`express-api/tests/scripts/dev-lockdown-middleware.test.js`,
   `tests/web/dev-smoke.spec.ts`, `tests/web/dev-sanity.spec.ts`).

## Out of Scope

- The unreadable challenge body — **SHY-0377**. Related but separately fixable,
  and worth fixing even once this lands, because a refusal must always be
  legible.
- Changing which pages the banner links to.

## Dependencies

- None, but pairs with SHY-0377.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Widening the gate exposes dev publicly | Environment-matched proof, not a blanket exemption; explicit ACs that unmatched and unproven requests still 401. |
| A dev password ends up in a store build | Build-artifact assertion that release binaries carry no dev credential. |
| A header-based bypass is trivially forged | Prefer a short-lived signed value; a forgeable static header is not acceptable for the only thing keeping dev private. |

## Definition of Done

- [ ] Reported journey passes on a real Android device and a real iPhone.
- [ ] Dev remains unreachable from a plain browser without the password.
- [ ] Story `In Review` before merge; CI green by name; merged to develop; dev
      deploy dispatched and its health gate observed passing.
- [ ] `released_in:` set on the next release cut.

## Notes (running log)

- **2026-08-20 — reported and root-caused the same day.** The operator's
  "problem 1" (black text on a black background) is **not** a defect in
  `cyber-bullying.html`; that page defines its own dark theme inline and is fine.
  What renders is the unstyled `text/plain` 401 body from the lockdown — see
  SHY-0377. Fixing this story removes the symptom; SHY-0377 makes the failure
  legible whenever it does occur.
- **2026-09-04 — reproduced again by the operator on dev**, unchanged: tapping
  the cyber-bullying banner in the dev app opens the dev page, and the dev
  restriction refuses it. Operator: *"when on the dev version of the app, all
  the dev links should work as normal without restrictions."* Same rule as the
  2026-08-20 quote above — environment-matched access, dev app → dev site with
  no prompt. Still `Draft`, still `P1`, still `mvp: true`; fifteen days open.
  Related copy defect found the same day: SHY-0512 (the device-lock and
  suspension screens send people to shyden.co.uk for support instead of the
  ShyTalk site).
