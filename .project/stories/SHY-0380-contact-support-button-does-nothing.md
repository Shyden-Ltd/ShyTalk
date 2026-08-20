---
id: SHY-0380
status: Draft
owner: unassigned
created: 2026-08-20
priority: P1
effort: L
type: feature
roadmap_ids: []
epic: EPIC-0012
mvp: true
---

# SHY-0380: "Contact support" should raise a ticket an admin can action

## User Story

As **someone who needs help**, I want to send ShyTalk a message from inside the
app and know it has been received, so that I am not left guessing whether
anyone will ever see it.

## Why

**Reported by the operator, 2026-08-20.** The age-restriction dialog says:

> If you believe this is wrong, please **contact support** — we cannot accept ID
> submissions to override the date of birth on file.

…and offers a **Contact support** button that **closes the dialog and does
nothing else**. Both call sites pass the same lambda as the dismiss action:

| Call site | What it passes |
| --- | --- |
| `RoomScreen.kt:1279` | `onContactSupport = { gachaViewModel.dismissAgeRestrictionDialog() }` |
| `PrivateChatScreen.kt:1022` | `onContactSupport = { viewModel.dismissAgeRestrictionDialog() }` |

So the confirm button is behaviourally identical to Cancel. The screen tells
someone to do a thing, offers a control for it, and the control is inert.

### The operator's design — a ticket, not an email

**Operator, 2026-08-20:** "contacting support should open a form, similar to
reporting. where the support becomes a ticket for an admin on the admin
dashboard to action. not an email."

This is the right call and it supersedes the obvious quick fix. An email leaves
support with no queue, no status, no audit trail, and no way to tell whether
anything was answered. A ticket is trackable, and it works for someone who has
no mail app configured.

### There is already a precedent to copy, not invent

**Appeals** is structurally the same thing — a person submits free text about
their account, it lands in a queue, an admin actions it:

| Layer | Existing appeals implementation |
| --- | --- |
| Submit | `POST /appeals` (`express-api/src/routes/reports.js:1363`), takes `appealText`, writes `suspensionAppeals`, **409s if one is already pending** |
| Admin list | `GET /appeals` (`:1415`) |
| Admin action | `PATCH /appeals/:id` (`:1465`) |
| Dashboard | `public/admin/js/tabs/appeals.js`, registered in `main.js:77` |

Support tickets must follow this shape. A **third** differently-shaped
user→admin queue in the same product would be the wrong outcome.

There is no in-app appeal *screen* to copy, so the form itself is new work.

### The ticket should already know why it was raised

The age-gate case is almost always "my date of birth is wrong on file". The
person should not have to explain where they came from — the ticket carries the
originating context (which feature refused them, and what the app believed about
their eligibility) so an admin can act without a round trip.

## Acceptance Criteria

### Happy path

- [ ] Choosing **Contact support** opens a form inside the app, not a mail app
      and not a browser.
- [ ] Submitting it tells the person plainly that it has been received.
- [ ] The submission appears in the admin dashboard as an actionable item.
- [ ] An admin can mark it handled, and the person's view reflects that.
- [ ] It works from every place the age-restriction message appears — a room and
      a private chat.

### Error paths

- [ ] A failed submission says so and keeps what the person typed. Nothing is
      lost to a dropped connection.
- [ ] An empty or whitespace-only message is refused before it is sent, with a
      reason.
- [ ] If the person already has an open ticket, they are told, rather than
      silently creating a duplicate — the behaviour `POST /appeals` already has.

### Edge cases

- [ ] Submitting twice quickly creates one ticket, not two.
- [ ] A very long message is either accepted whole or bounded with a visible
      limit — never silently truncated.
- [ ] Someone under 18 can raise a ticket. **This route must survive SHY-0379**,
      which hides age-gated features from known minors; support is not an
      age-gated feature and hiding it would strand exactly the person most
      likely to need it.
- [ ] Works on Android and iOS.

### Performance

- [ ] Submitting is a single request; the form does not block the app while it
      sends.

### Security

- [ ] Submission is authenticated and the ticket is bound to the account that
      raised it. Nobody can raise or read a ticket for another account.
- [ ] Rate-limited, so the endpoint cannot be used to flood the admin queue.
- [ ] The message body is treated as untrusted text everywhere it is displayed,
      including the admin dashboard.
- [ ] The admin action is **audit-logged**. `PUT /config/:key` currently writes
      no audit entry and that is a known gap — do not repeat it here.
- [ ] Automatically attached context contains no more than is needed to action
      the ticket, and no credentials or tokens.

### UX

- [ ] Any control that says it will do something either does it, or is not
      shown. This is the general rule the bug violates.
- [ ] The person can tell, after the fact, that they raised a ticket.

### i18n

- [ ] All new copy goes to the **5 MVP locales only** (en, zh, id, vi, th) — not
      the retired `values-*` directories.

### Observability

- [ ] A raised ticket is visible in logs without recording the message body.
- [ ] It is possible to tell how many tickets are open, as `GET /reports/stats`
      does for reports.

## BDD Scenarios

**Scenario: Someone raises a ticket and knows it arrived**

- **Given** someone is looking at the age-restriction message
- **When** they choose Contact support and send a message
- **Then** they are told it has been received

**Scenario: An admin can act on it**

- **Given** someone has raised a ticket
- **When** an admin opens the dashboard
- **Then** the ticket is listed and can be marked handled

**Scenario: A second ticket is not silently created**

- **Given** someone already has an open ticket
- **When** they try to raise another
- **Then** they are told about the one they already have

**Scenario: A failed send does not lose what was typed**

- **Given** someone has written a message
- **When** the send fails
- **Then** they are told, and their message is still there

## Test Plan

| Layer | What it proves |
| --- | --- |
| Source guard | No `onContactSupport` call site is wired to a dismiss-only lambda. This is the test that would have caught the original bug, and it covers call sites that do not exist yet. |
| API tests | Submit, list, action; ownership enforced; duplicate-pending refused; rate limit; admin action writes an audit entry. Against real Firestore emulator, not mocks. |
| App tests | Form validation, failed-send retains input, confirmation shown. |
| Admin dashboard | Ticket renders, action changes status, message body is escaped. |
| Device journeys | Real Android and real iPhone: raise a ticket from the age dialog and see it land in the dashboard. |

## Out of Scope

- Replying to the person inside the app. Deciding *how* support answers is a
  separate conversation; this story delivers the queue.
- Migrating appeals or reports onto a shared ticket model. Worth considering
  later; not while introducing the first one.
- Reconciling the app's `Constants.CONTACT_EMAIL` (`shytalk.help@gmail.com`)
  with the web portal's `support@shytalk.dev`. Flagged, not decided here.
- SHY-0379, which hides age-gated features from known minors.

## Dependencies

- SHY-0379 must **not** hide the support route. Support is not age-gated.
- The appeals implementation is the template: `reports.js:1363-1500` and
  `public/admin/js/tabs/appeals.js`.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The broken button stays broken until this lands, and this is effort L | **Operator decision needed** — see Notes. Either hide the button in the interim, or accept it. |
| A third user→admin queue shape diverges from appeals and reports | Follow the appeals shape exactly; call it out in review. |
| The admin queue is floodable | Rate limit plus duplicate-pending refusal, both already proven in `POST /appeals`. |
| Admin actions are untraceable | Audit entry is an explicit acceptance criterion, because the config endpoint already got this wrong. |
| SHY-0379 hides support from minors | Called out in both stories; the minor cohort is the likeliest user of this route. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Ticket raised from a real Android device and a real iPhone, and actioned in
      the dashboard.
- [ ] Source guard present and proven to fail against the old wiring.
- [ ] Audit entry verified for the admin action.

## Notes

- **Open decision for the operator.** This started as a one-line wiring fix and
  is now effort **L** (app form + API + admin tab). Until it ships, the button
  remains inert. The options are: leave it, or hide it in the interim per the
  operator's own earlier instruction ("if its not meant to be do anything, don't
  display it"). Hiding it is the smaller, safer change and can ship immediately.
- **Part of [[EPIC-0012]]** — support ticketing with a dedicated support-agent
  role working from the website portal. That epic is gated on the portal work,
  which is why this story deliberately ships an **admin-dashboard** surface and
  should not grow features the epic will replace.
- **Splitting is reasonable** if L is too big for one PR: API + admin tab first,
  app form second. The button stays hidden until the second lands.
- Found while reviewing the age gate during SHY-0372.
- Third silent-failure of the same shape in one session: a control or code path
  that does nothing and says nothing. The others are
  `HomeViewModel.createRoom():369` (early return above its own log line) and
  SHY-0372 itself.
