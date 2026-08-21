---
id: SHY-0404
status: Draft
owner: unassigned
created: 2026-08-21
priority: P0
effort: L
type: chore
roadmap_ids: []
mvp: true
---

# SHY-0404: Nobody in 471 scenarios ever translates a message

## User Story

As **somebody using ShyTalk to talk to a person who does not share my language**,
I want the translate button to be known to work, so that the reason I installed
this app is not the least-tested thing in it.

## Why

ShyTalk is a language and cultural learning platform. Translating what somebody
said is not a feature of the product — it is close to being the product.

A verified audit of the whole corpus — **68 feature files, 471 scenarios** —
found **zero** scenarios that translate a message.

The 16 steps matching "translat" are all UI localisation:

```gherkin
Then Lena's Web UI shows German translation of "Sign in" in the page heading
Then Layla's Web UI shows the Arabic translation of "Discover"
```

That is the app's own labels being localised. It is not one person reading
another person's message in their own language.

### What is actually there, untested

`express-api/src/routes/translate.js` is a substantial, careful feature:

- `POST /api/translate` — authenticated chat translation, a **per-user daily
  quota**, a **Firestore message-doc cache**, `{translatedText,
  detectedSourceLang, cached}`, and **502 when no provider can translate**
- an anonymous public-page flow with a **provider chain** (gtx →
  LibreTranslate), fail-silent English, a `X-Translation-Missed` header and a
  dedup'd miss queue
- `GET /api/translate/quota`

Client side: `MessageBubble`, `ChatPanel`, `RoomViewModel`, `RoomSettingsSheet`.

Quota, cache hit, provider fallback, provider total failure, and the raw-storage
escaping rule (SHY-0073 — translations are stored RAW and escaped by the
renderer) are each a way this can fail in front of a person, and **not one of
them is walked.**

The escaping one deserves naming: a translated string is stored raw and escaped
at insertion. If a renderer ever forgets, translated text becomes an injection
vector — from a stranger's message, in a room with minors present.

## Acceptance Criteria

### Happy path

- [ ] Somebody in a room translates another person's message and reads it in
      their own language.
- [ ] The same in a private message.
- [ ] The original remains available — translating does not destroy what was said.
- [ ] The detected source language is shown, and it is right.

### Error paths

- [ ] Translation failing shows a plain message and leaves the original readable.
- [ ] Exhausting the daily quota is explained, not a silent no-op.
- [ ] Every provider failing produces the failure state, not a spinner forever.

### Edge cases

- [ ] Translating the same message twice is served from cache and does not spend
      quota twice.
- [ ] A message already in the reader's language.
- [ ] An empty message, a message that is only emoji, and a very long message.
- [ ] A message containing HTML-ish text renders as TEXT — the SHY-0073 raw
      storage rule, asserted at the renderer.
- [ ] Right-to-left target, and a CJK target, both render correctly.
- [ ] Walked on real Android **and** real iPhone, plus Web.

### Performance

- [ ] A cached translation returns without a visible wait.

### Security

- [ ] Translating a message in a conversation the caller is not part of is refused.
- [ ] Anonymous callers cannot use the authenticated chat contract — the route
      already returns 401 for chat-shaped anonymous bodies; assert it.
- [ ] Quota is per user and cannot be spent on somebody else's behalf.

### UX

- [ ] It is obvious which text is the translation and which is the original.

### i18n

- [ ] The translate control and its error copy render per locale, asserted on
      rendered text.

### Observability

- [ ] A translation miss is countable — the miss queue exists; assert something
      lands in it.

## BDD Scenarios

**Scenario: Reading a room message in my own language**

- **Given** a message written in a language the reader does not speak
- **When** they translate it
- **Then** they see it in their own language

**Scenario: The original is still there**

- **Given** a message that has been translated
- **When** the reader looks at it again
- **Then** both the translation and the original wording are available

**Scenario: Translating the same message twice costs one translation**

- **Given** a message that has already been translated once
- **When** somebody translates it again
- **Then** it is served from the cache and the quota is unchanged

**Scenario: Running out of translations says so**

- **Given** somebody who has used their daily quota
- **When** they translate another message
- **Then** they are told the quota is spent

**Scenario: Translation being unavailable does not hide the message**

- **Given** translation is failing
- **When** somebody translates a message
- **Then** they are told, and the original is still readable

**Scenario: Translated text is shown as text**

- **Given** a message containing angle-bracketed markup
- **When** it is translated and displayed
- **Then** the markup is shown as characters, not rendered

## Test Plan

| Layer | What it proves |
| --- | --- |
| **Journey, Android + iPhone + Web** | Somebody actually reads a stranger's message in their own language, in a room and in a PM. The far end is the READER'S screen, not a 200 from the API. |
| Quota | Spend to the limit, assert the refusal copy, assert a cache hit does not spend. Against the real quota store, not a stub. |
| Provider chain | First provider down → second serves; both down → 502 and the failure state in the UI. |
| Security | Cross-conversation translate refused; anonymous chat-shaped body 401; quota not spendable for another user. Each its own assertion. |
| Renderer | A message containing markup is asserted as TEXT on screen — the SHY-0073 rule, at the point where forgetting it becomes an injection. |
| i18n | RTL and CJK targets asserted on rendered text. |

## Out of Scope

- Changing translation behaviour, providers or quota values. This is coverage
  for what exists.

## Dependencies

- The journey driver needs a step for tapping translate on a specific message and
  reading the result. Model it on the existing per-message steps in `j07`.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A journey asserts the API returned a translation, not that anybody saw it | Every happy-path AC names the reader's screen as the far end. |
| Quota is tested with a stub that always says "quota left" | Asserted against the real quota store, spending it for real. |
| Cache behaviour is assumed because the code has a cache | A second translate asserts BOTH the cached flag and an unchanged quota. |
| The escaping rule is tested at the API, where it is correct by design | Asserted at the renderer, which is where forgetting it would bite. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] A real message translated and read on a real Android device, a real iPhone
      and a browser.

## Notes

- Found 2026-08-21 in the second, deeper journey audit. The first pass missed it
  because "translat" matches 16 steps and looks covered — every one of them is
  the app localising its own labels. **Match on what the STEP does, not on the
  word it contains.**
