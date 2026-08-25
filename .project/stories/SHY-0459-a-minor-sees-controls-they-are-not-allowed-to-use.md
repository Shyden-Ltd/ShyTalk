---
id: SHY-0459
status: Draft
owner: unassigned
created: 2026-08-25
priority: P2
effort: M
type: bug
roadmap_ids: []
mvp: false
---

# SHY-0459: A minor sees controls they are not allowed to use

## User Story

As **a minor using ShyTalk**, I want not to be shown things I am not allowed to
do, so that I am not repeatedly refused by an app that offered in the first
place.

## Why

Spec j02 expects a minor to have the messages tab and the wallet **hidden**.
The shipped app shows both. Cohort enforcement is server-side only, so a minor
can see the controls, tap them, and be refused.

This was known. It was encoded in the device runner as a step called
`FINDING: minor UI is NOT feature-hidden` whose status was **pass**, with the
violation written into its detail text:

> minor UI exposes main_messagesTab + profile_walletButton — spec expected
> hidden (gating is server-side)

The operator found it while reading the PR #1940 sign-off evidence on
2026-08-25 and ruled that it must fail: a known deviation recorded as green is
how a defect becomes invisible. The step now throws, so **J02 is red until this
is resolved**.

Server-side gating is doing its job — the refusal is real, and this is not a
safeguarding hole. It is a UX defect and a spec divergence, which is why it is
P2 rather than P0.

## Acceptance Criteria

### Happy path

- [ ] A minor does not see the messages tab.
- [ ] A minor does not see the wallet.
- [ ] J02 passes again, by the UI hiding them rather than the test tolerating
      them.

### Error paths

- [ ] Server-side gating stays exactly as it is. Hiding a control is not a
      substitute for refusing the action, and must not become one.

### Edge cases

- [ ] A user whose cohort changes mid-session gets the correct surface without
      a reinstall.

### Security

- [ ] No change. The refusal already holds; this is about not offering.

### UX

- [ ] This IS the UX change: stop offering a minor something they will be
      refused.

### i18n

- [ ] No new strings — features are hidden, not relabelled.

## BDD Scenarios

**Scenario: A minor opens the app**

- **Given** somebody signed in as a minor
- **When** they look at the main screen and their profile
- **Then** the messages tab is not offered
- **And** the wallet is not offered

## Test Plan

| Layer | What it proves |
| --- | --- |
| Device | J02 on a real phone: neither control is present for a minor. |
| Device | An adult still sees both. |
| Unit | The server still refuses the actions regardless of what is shown. |

## Out of Scope

- Changing the spec instead. If that is the answer, it is a decision to record,
  not a thing to do quietly — and the operator chose "make it fail" over
  "decide the spec instead" on 2026-08-25.

## Dependencies

- [[SHY-0457]] — the guard work that surfaced this.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Hiding is mistaken for enforcement | The server-side refusal keeps its own tests; this story does not touch them. |
| J02 stays red and gets ignored | It is in the core set, so it runs every evidence session and cannot be quietly skipped. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] J02 green on both real devices, by the UI hiding the controls.

## Notes

- Filed 2026-08-25. The step that hid this passed for months.
