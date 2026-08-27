---
id: SHY-0454
status: Done
owner: unassigned
created: 2026-08-25
priority: P1
effort: S
type: bug
roadmap_ids: []
mvp: true
released_in: v0.99.0
---

# SHY-0454: One screen for "cannot connect", and it never takes blame

## User Story

As **somebody who cannot reach ShyTalk**, I want to be told what to try, so that
I can fix the thing that is actually wrong instead of waiting on someone else.

## Why

Operator, 2026-08-25:

> "The 'unable to connect' message is misleading. Don't say 'if it keeps
> happening, it is our end'. Don't take the blame for it. It's very unlikely to
> be us... instead give them some quick tips to help resolve the situation."

and then, on finding a second screen doing the same thing:

> "That screen should be gone already... we should only have 1 screen, saying
> that we cannot connect. In that screen we should never take blame."

Three strings were accepting fault, across two screens:

| String | Said | Screen |
| --- | --- | --- |
| `connection_trouble` | "...may be your connection, **or it may be us**" | SignIn |
| `contact_support_hint` | "If it keeps happening, **it is our end**." | SignIn |
| `contact_support_help` | "**This is our problem, not yours.**" | DegradedMode |

Only the first two were reported. The third was found by sweeping for the
class rather than fixing the two named instances.

**Beyond tone, it left somebody with nothing to do.** Almost every real instance
of this screen is device-side — no signal, a captive portal, a VPN — and every
one of those is fixable in seconds by the person holding the phone, if we say
so. "It is our end" tells them to wait for someone who is not coming.

**And two screens for one situation is two places for the copy to drift.**
`DegradedModeScreen` was a full-screen interstitial shown whenever `/api/health`
answered `status: "degraded"`, announcing "Technical Difficulties" before
anybody could get in. Degraded is not unreachable — the app still works, and
`DegradedModeBanner` already says so in a line rather than a wall.

## What changed

- `connection_trouble` — no longer offers us as a possible cause.
- `contact_support_hint` → **`connection_tips`**, which names what to try:
  check the internet, turn off any VPN, restart the app or the phone.
- **`DegradedModeScreen` deleted**, with its Gherkin feature, its test step, its
  MainActivity branch, and all three of its strings across 21 locales.
- All copy translated for **21 locales**, hand-written with provenance stamps.

The health poll and `DegradedModeBanner` are untouched: a degraded backend is
still detected and still stated in a line, which is proportionate.

## Acceptance Criteria

### Happy path

- [x] The connection screen names concrete things to try, in the person's language.
- [x] There is exactly ONE screen for "we cannot connect".

### Error paths

- [x] No connection-facing string accepts blame, in any locale.
- [x] A degraded backend no longer blocks entry with a full-screen interstitial.

### Edge cases

- [x] The retired strings are gone from EVERY locale, not just English — an
      orphaned string is how a deleted screen quietly comes back.
- [x] The `DegradedModeBanner` still appears when the backend is degraded.

### Performance

- [x] No change.

### Security

- [x] No change. Nothing about the app's state is published to the public.

### UX

- [x] The person is given actions, not an apology.

### i18n

- [x] 21 locales, hand-translated, provenance-stamped.

### Observability

- [x] No change.

## BDD Scenarios

**Scenario: The app cannot reach us**

- **Given** somebody opening ShyTalk with no working connection
- **When** the app cannot reach our servers
- **Then** they are told what to try, and never that it is our fault

## Test Plan

| Layer | What it proves |
| --- | --- |
| Unit | No connection-facing string accepts blame; the tips name real actions; every locale carries them. |
| Unit | The deleted screen stays deleted — file, references and strings. |
| Device | The connection screen renders the new copy on both platforms. |

## Out of Scope

- **SHY-0453**, a status page — the honest answer for the case where it IS us.
- The `DegradedModeBanner` copy ("Reduced functionality — some features may be
  unavailable"). It is a line, not a screen, and was not in the operator's ask.
  **Flagged**: it still tells the public something is wrong with us.

## Dependencies

- None.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A future screen quietly reintroduces the blame | A test asserts the phrases against every connection-facing string. |
| The deleted screen comes back | A source-level guard on the file, its references and its strings. |
| A translation reintroduces blame in a language nobody here reads | The guard is English-only; the translations were hand-written, not machine-generated, and are provenance-stamped for review. **Stated, not solved.** |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Journey-walked on both devices.

## Notes

- Found while the iPhone was failing to connect and displaying the very copy
  under discussion.
