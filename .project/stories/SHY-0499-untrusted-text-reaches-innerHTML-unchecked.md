---
id: SHY-0499
status: Draft
owner: unassigned
created: 2026-09-01
priority: P1
effort: M
type: bug
roadmap_ids: []
mvp: false
epic: EPIC-0003
---

# SHY-0499: Text written by the public reaches innerHTML with nothing checking it

## User Story

As **an administrator opening the moderation console**, I want text that other
people wrote to be unable to run code in my browser, so that reading a report
cannot take over the account that acts on it.

## Why

Counted, not estimated, while wiring up SHY-0448's linting:

- **148** assignments to `innerHTML` / `outerHTML` / `insertAdjacentHTML` under
  `public/`. The heaviest are `admin/js/tabs/users.js` (37),
  `admin/js/tabs/suggestions.js` (22) and `js/suggestions-board.js` (14).
- **`escapeHtml` is defined four separate times** — in `portal/portal.js`,
  `js/roadmap-auth.js`, `js/core/ui.js` and `js/shared-header.js`. Four
  implementations of one security primitive, none of which knows about the
  others, and no test that they agree.

The admin console renders display names, report descriptions, appeal text and
suggestions — all written by members of the public — into an interface whose
whole purpose is to act on accounts. That makes the target an administrator, and
the payload something a moderator opens *because* it was reported.

SHY-0448 asked for `no-unsanitized` or an equivalent to be considered and the
decision recorded. It was, and the decision was **yes, and not there**: switching
the rule on inside a linting-setup story leaves two bad options — around 148
inline suppressions, which is a way of not having the rule while appearing to, or
a gate nobody can get past. The reasoning is recorded in
`public/eslint.config.mjs` next to the config it explains.

P1 because the surface is unprotected today and the discipline holding it
together is entirely manual.

## Acceptance Criteria

### Happy path

- [ ] There is exactly ONE escaping helper, and every surface uses it.
- [ ] A rule fails the build when untrusted text reaches an HTML sink without it.

### Error paths

- [ ] A suppression cannot be added silently — one requires a stated reason, and
      that is enforced rather than asked for.
- [ ] The existing sinks are recorded as a baseline that may only SHRINK, so the
      count cannot quietly grow while the rule appears to be on.

### Edge cases

- [ ] Text that is already HTML by design — the icon templates in
      `starting-screens.js`, the SVG in `suggestions-board.js` — is distinguished
      from untrusted text rather than blanket-suppressed.
- [ ] The four current `escapeHtml` implementations are compared before being
      replaced: if they differ, the differences say which one was right.

### Security

- [ ] A display name containing a script tag renders as text in the admin
      console, proved by rendering one, not by reading the escaping function.
- [ ] The same for a report description and an appeal, which are the longest
      free-text fields an administrator opens.

### Performance

- [ ] No measurable change to admin console rendering.

### UX

- [ ] No visible change. Correctly escaped text looks exactly as it does now,
      including accented characters, emoji and right-to-left scripts.

### i18n

- [ ] Escaping does not mangle non-Latin text. Asserted for Chinese, Vietnamese,
      Thai and Arabic, which are MVP or legal-page locales.

### Observability

- [ ] N/A.

## BDD Scenarios

**Scenario: A hostile display name is only ever text**

- **Given** somebody whose display name contains markup
- **When** an administrator opens their record in the console
- **Then** the name is shown as the characters they typed
- **And** nothing in it runs

**Scenario: A new unsafe sink cannot be added quietly**

- **Given** a developer adding a new admin surface
- **When** they put untrusted text straight into the page
- **Then** the build fails and names the line

## Test Plan

- Unit: the single escaping helper, including the boundary cases the four
  current implementations disagree on, and non-Latin input.
- Integration: render a report, an appeal and a display name containing markup
  through the real admin modules and assert the text is inert.
- Static: the baseline may only shrink; a suppression without a reason fails.

## Out of Scope

- A Content Security Policy for the admin console. Worth having and a separate
  decision.
- Rewriting the admin tabs to build DOM nodes instead of HTML strings. That is
  the better end state and far larger than this.

## Dependencies

- SHY-0448 (put linting over `public/` in the first place, and measured this).

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| 148 sinks means a large, risky sweep | Baseline first so nothing new lands, then shrink deliberately. The rule arrives before the cleanup finishes. |
| Blanket suppressions to get green | A suppression must carry a stated reason, and that is enforced, not requested. |
| Replacing four helpers with one changes behaviour somewhere | Compare them first; differences are findings, not merge conflicts. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] A display name containing a script tag is demonstrably inert in the admin
      console.

## Notes

- Filed 2026-09-01 from SHY-0448's Security criterion, which asked for the
  decision to be recorded rather than for the work to be done. The numbers above
  are measured, and the same reasoning sits in `public/eslint.config.mjs`.
