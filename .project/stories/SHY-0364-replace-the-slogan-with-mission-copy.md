---
id: SHY-0364
status: Draft
owner: unassigned
created: 2026-08-20
priority: P1
effort: S
type: chore
roadmap_ids: []
mvp: true
---

# SHY-0364: The first thing a new user reads is "Voice chat rooms, reimagined."

## User Story

As **someone opening ShyTalk for the first time**, I want the app and the site to
tell me what ShyTalk is *for*, so that I understand it is a place to learn
languages and meet cultures rather than a generic voice-chat app.

## Why

`voice_chat_reimagined` — "Voice chat rooms, reimagined." — is rendered on the
**sign-in screen** at `shared/src/commonMain/kotlin/com/shyden/shytalk/feature/auth/SignInScreen.kt:276`.
It is the first sentence a new user reads, and it says nothing about language or
culture. The same line is the website's visible tagline **and its SEO meta
description**, which is what search engines quote.

That is a positioning failure at the highest-visibility moment. It also runs
against the product guardrail: a generic "voice chat rooms" framing invites
exactly the social reading ShyTalk is steering away from, while the mission —
language and cultural exchange — is invisible.

**Operator decision 2026-08-20:** the replacement copy is

> **Learn languages. Share cultures.**

Chosen over three alternatives specifically for translatability: two plain
verb+noun clauses, no idiom, no metaphor, no wordplay, and it survives RTL and
CJK rendering. (`Where the world practises out loud.` was the most memorable in
English and the weakest in every other language.)

**This is roadmap item W3 "Slogan rebrand"**, which has sat on the internal
roadmap without a ticket. Its `project-rebrand-slogan.md` reference is dangling
— no such file exists.

### Sequencing — this is gated on SHY-0289

The copy currently fans out to **21 app locales and 21 web locales**. The MVP set
is **five** (en, zh, id, vi, th), and **SHY-0289** ("Retire the 15 non-MVP
locales from both surfaces") is still `Draft`.

**Operator decision 2026-08-20: retire first, then re-slogan.** Writing the
tagline after SHY-0289 means it is written once, in five languages that can
actually be reviewed, instead of machine-translated into sixteen that will never
ship.

## Acceptance Criteria

### Happy path

- [ ] The sign-in screen reads "Learn languages. Share cultures."
- [ ] The website homepage tagline reads the same.
- [ ] The `<meta name="description">` on `public/index.html` reads the same, so
      search results quote the mission rather than "voice chat rooms".
- [ ] Every shipping locale carries a reviewed translation — not a placeholder
      and not the English string left in place.

### Error paths

- [ ] A locale missing the new string fails the build rather than silently
      falling back to the old slogan.

### Edge cases

- [ ] The string **key** `voice_chat_reimagined` is renamed too. A key that
      names the retired slogan is a trap for the next reader.
- [ ] The locale-count pin in `express-api/tests/scripts/locale-string-content.test.js`
      is updated in its documented running-comment style if the key count moves.
- [ ] No stale copy of the old slogan survives anywhere — app, web, meta tags,
      or the roadmap's own W3 row, which quotes it.

### Performance

- [ ] N/A — a copy change.

### Security

- [ ] N/A.

### UX

- [ ] Read on a **real device** at the narrowest supported width in every
      shipping locale: the line must not wrap awkwardly, truncate, or collide
      with the sign-in buttons. Checked by looking at it, not by asserting the
      string.
- [ ] Checked on the website at mobile and desktop widths.

### i18n

- [ ] Five reviewed translations (en, zh, id, vi, th). Each conveys *learning a
      language* and *sharing culture* — a literal word-for-word rendering that
      loses the meaning is a defect, not a pass.
- [ ] Verified in RTL only if an RTL locale is still shipping after SHY-0289.

### Observability

- [ ] N/A.

## BDD Scenarios

**Scenario: A new user learns what the app is for**

- **Given** someone opens ShyTalk for the first time
- **When** they reach the sign-in screen
- **Then** they read that ShyTalk is for learning languages and sharing cultures

**Scenario: A search result describes the product honestly**

- **Given** someone finds ShyTalk through a search engine
- **When** they read the result description
- **Then** it describes language and cultural exchange

## Test Plan

**RED first.** A test asserting the sign-in screen and the homepage carry the
mission copy fails today against "Voice chat rooms, reimagined."

1. Assert the rendered TEXT on the sign-in screen, per locale — not the presence
   of a string key.
2. Assert the homepage tagline and the meta description.
3. Sweep for any surviving occurrence of the old slogan.
4. Walk the sign-in screen on a real device per shipping locale and look at it.

## Out of Scope

- **Retiring the non-MVP locales** — that is SHY-0289, and this story is
  sequenced behind it by operator decision.
- Any other marketing copy, the app name, or the logo.
- The roadmap's W3 row itself, beyond removing the quoted dead slogan.

## Dependencies

- **Blocked by SHY-0289** (retire the 15 non-MVP locales) by operator decision.
- Touches the sign-in screen, so it should be coordinated with **EPIC-0004**
  (boot/login redesign) rather than fought over.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A translation loses the meaning while being literally correct | AC requires each translation to convey learning + sharing, reviewed, not machine-checked for word equivalence. |
| The longer line wraps badly on narrow phones | Real-device check at the narrowest supported width per locale, in the AC. |
| Done before SHY-0289 and 16 throwaway translations are commissioned | Dependency is explicit, and the operator decision is recorded here. |
| EPIC-0004 rewrites the sign-in screen underneath this | Flagged as a dependency so whichever lands second inherits the copy rather than reverting it. |

## Definition of Done

- [ ] Old slogan gone from every surface; new copy live in every shipping locale.
- [ ] Story `In Review` before merge.
- [ ] CI green by name; merged to develop; dev deploy dispatched.
- [ ] `released_in:` set on the next release cut.

## Notes (running log)

- **2026-08-20** — Raised by the operator: *"we should also change that splash
  tagline (it's on the shytalk website too) to something more realistic to the
  app's goal."* Investigation found it is not only the website — the same slogan
  is live on the **app sign-in screen**, which is the higher-visibility surface.
- **2026-08-20** — Note the neighbouring string `splash_tagline` ("Voice chat
  rooms, reimagined.") was removed from all 21 locales by **SHY-0144** along with
  the FunFact splash. `voice_chat_reimagined` is a **separate, still-live** key
  and survived that removal.
- **2026-08-20** — The operator initially believed the locale set had already
  been reduced. It has not: 21 locale directories are still present, SHY-0194 was
  **cancelled** (superseded), and its successor **SHY-0289 is still Draft**.
