---
id: SHY-0377
status: Draft
owner: unassigned
created: 2026-08-20
priority: P3
effort: XS
type: bug
roadmap_ids: []
mvp: false
---

# SHY-0377: The non-prod challenge page is unreadable in the app

## User Story

As **anyone who lands on a restricted page**, I want to be able to read why I was
refused, so that I know what happened instead of staring at a blank-looking
screen.

## Why

**Found while root-causing SHY-0376, 2026-08-20.** The operator reported "black
text on a black background" when the dev app opened the cyber-bullying banner.
The page itself is fine — `public/cyber-bullying.html` defines its own theme
inline (`--bg: #0f0d15`, `--text: #e8e0f0`). What actually rendered was the
lockdown's 401 body:

```js
// functions/_lib/lockdown.js:135
new Response(body, {
  status: 401,
  headers: { 'Content-Type': 'text/plain; charset=utf-8', … })
```

`text/plain` carries no styling, so it renders in the client's default text
colour — black — inside a dark WebView. The message is there and is well
written; it is simply invisible.

The comment above it says the body exists so "a visitor stumbling onto a dev URL
doesn't see an empty white page". In the app, that is exactly what they get.

## Acceptance Criteria

### Happy path

- [ ] The challenge page is legible on a light background and on a dark one.
- [ ] It still says what it says today: this is a non-prod environment, and where
      the public site is.

### Error paths

- [ ] The 401 status, `WWW-Authenticate` header and `X-Robots-Tag` are unchanged
      — a browser must still show its native credential prompt.

### Edge cases

- [ ] Readable in an in-app WebView on Android and iOS, not only in a browser.
- [ ] Readable with the OS in dark mode and in light mode.
- [ ] Self-contained: no external stylesheet, font, or image, because the request
      that would fetch them is behind the same gate.

### Performance

- [ ] The body stays small — a single inline `<style>`, no assets.

### Security

- [ ] No change to what is disclosed. The body must not name the environment's
      internals, credentials, or how to obtain them.
- [ ] Still `noindex`.

### UX

- [ ] Someone who arrived by mistake can read the sentence and find the public
      site.

### i18n

- [ ] English only, deliberately — it is an infrastructure gate reached before
      any locale is known. No new translated strings.

### Observability

- [ ] N/A.

## BDD Scenarios

**Scenario: A refused visitor can read why**

- **Given** someone reaches a restricted address
- **When** the page loads
- **Then** they can read the explanation whatever their device theme

## Test Plan

1. Assert the response is HTML with an explicit colour and background, not bare
   `text/plain`.
2. Assert the 401 status, `WWW-Authenticate` and `X-Robots-Tag` headers survive —
   the existing `dev-lockdown-middleware.test.js` cases must stay green.
3. Assert the body embeds no external URL (a self-containment check), since
   anything it referenced would itself be gated.
4. Screenshot it in an app WebView in both dark and light mode — this defect was
   invisible to assertions and only visible to eyes.

## Out of Scope

- Whether the app should be challenged at all — **SHY-0376**.

## Dependencies

- Pairs with SHY-0376. Worth doing even after that lands: a refusal should always
  be legible.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Styling the page turns it into a maintained asset | Keep it one inline `<style>` and a sentence; no external files. |
| Someone adds detail while restyling | An AC pins the disclosure surface as unchanged. |

## Definition of Done

- [ ] Legible in both themes in a real app WebView, with screenshots.
- [ ] Existing lockdown tests green; story `In Review` before merge; CI green by
      name; merged to develop.
- [ ] `released_in:` set on the next release cut.

## Notes (running log)

- **2026-08-20** — filed alongside SHY-0376. Worth keeping separate: SHY-0376 is
  an access-control design change needing device proof, this is a two-line
  presentation fix that should not wait for it.
