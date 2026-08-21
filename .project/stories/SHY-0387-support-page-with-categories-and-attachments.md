---
id: SHY-0387
status: In Review
owner: unassigned
created: 2026-08-21
priority: P1
effort: M
type: feature
roadmap_ids: []
epic: EPIC-0012
mvp: true
---

# SHY-0387: Make contacting support a proper page, not a dialog

## User Story

As **somebody who needs help**, I want a real page where I can pick what my
problem is and show you a screenshot of it, so that I do not have to describe a
visual problem in words.

## Why

**Operator, 2026-08-21**, on seeing SHY-0385 on a device: *"the contact support
form looks very boring and plain. it's just a dialog box. i want a contact
support page, complete with dropdowns and categories relevant to why people would
be contacting support. they also need to be able to upload screenshots or videos
for us to look at."*

Correct, and the shape already exists elsewhere in the app.

## Reporting is the blueprint — but only one of the two

There are **two** report surfaces and they are not equivalent:

| | `ReportUserDialog` | `ReportMessageDialog` |
| --- | --- | --- |
| Reasons | localised via `reportReasonLabel()` → `Res.string.*` | **raw English** — see [[SHY-0390]] |
| Attachments | **yes** — "Attach evidence", with a compressing state | no |
| Submitting / error states | yes | minimal |

`ReportUserDialog` is the model: radio-selected reasons, free text, attach
evidence, compression feedback, inline errors, an in-flight state. This story is
the same functionality with support's context and wording — the operator's own
framing.

The upload path already exists too: age verification requests a signed R2 URL and
PUTs the bytes directly (`AgeVerificationRepository.requestUploadUrl` /
`uploadImage`). That is the mechanism to reuse rather than invent.

## Categories

Operator-approved, 2026-08-21. These drive triage in the admin queue, so they
map to different actions rather than to different feelings:

| Category | Typical ticket |
| --- | --- |
| Account & login | cannot get in, wrong account |
| Age & verification | date of birth wrong on file, verification refused |
| Coins, beans & purchases | charged twice, purchase missing |
| Safety & another user | something a person did, where reporting is not enough |
| Something is broken | a bug |
| Something else | the honest catch-all |

The server's category allowlist in `routes/support-tickets.js` must be widened to
match, and the two lists must be tested against each other rather than kept in
step by hand.

## Acceptance Criteria

### Happy path

- [x] Contacting support opens a **page**, not a dialog.
- [x] The person picks a category from the approved set.
- [x] They can attach one or more screenshots or videos and see them listed.
- [x] Submitting tells them plainly that it has been received.
- [x] The ticket, its category and its attachments are visible to an admin in
      the dashboard queue.

### Error paths

- [x] A failed send keeps everything typed **and** everything attached. This is
      the behaviour SHY-0385 established and it must survive the redesign.
- [x] An attachment that fails to upload is reported, and the rest of the ticket
      is still sendable without it.
- [x] A file that is too large, or of an unsupported type, is refused with a
      reason **before** any upload starts.

### Edge cases

- [x] Attaching, removing, then re-attaching leaves the right set.
- [x] A very large video is bounded explicitly rather than failing opaquely
      mid-upload.
- [x] Leaving the page mid-typing is handled. **Decision: an unsent draft
      survives; a sent one does not.** A back-press is easy to hit by accident and
      this page is reached by people already having a bad time, so SHY-0385's rule
      — never lose what somebody typed — applies to leaving too, not only to a
      failed send. After a successful send the form starts clean, because showing
      somebody their own sent message as an unsent draft is worse than a blank
      form. Both directions have tests and both are mutation-proven.
- [ ] Works on Android and iOS.

### Performance

- [x] Attachments are compressed before upload, as reporting already does.
- [ ] The page stays responsive while an upload runs.

### Security

- [x] Uploads use the existing signed-URL path; the client never holds a
      long-lived storage credential.
- [x] An attachment is bound to the ticket and readable only by an admin.
- [x] File type is validated **server-side**, not only in the picker.
- [x] The category is validated against the server allowlist; an unknown value
      is refused.

### UX

- [ ] The page reads as part of ShyTalk, not as a form bolted on.
- [x] A person can tell what will happen next after they send.

### i18n

- [x] All copy, **including every category label**, is localised — not rendered
      from a hardcoded English key. That is exactly the bug [[SHY-0390]] records.
- [x] Copy goes to all 21 locale files, per the parity guard and the pinned
      string count.

### Observability

- [x] A raised ticket logs its category and attachment count, and **never** the
      message body.

## BDD Scenarios

**Scenario: Somebody shows us the problem**

- **Given** somebody has a problem they can screenshot
- **When** they contact support, choose a category and attach the picture
- **Then** their request and the picture reach an admin together

**Scenario: A failed send loses nothing**

- **Given** somebody has written a message and attached a screenshot
- **When** the send fails
- **Then** their words and their attachment are both still there

**Scenario: An unsupported file is refused early**

- **Given** somebody picks a file we cannot accept
- **When** they try to attach it
- **Then** they are told why, before anything uploads

## Test Plan

| Layer | What it proves |
| --- | --- |
| ViewModel | Category selection, attachment add/remove, failed send retains BOTH text and attachments, upload failure is recoverable. |
| Contract test | The app's category list and the server's allowlist match — the pair, not each alone. This is the test that stops them drifting. |
| API | Attachment references are stored, admin-only, and type-validated server-side. |
| Copy tests | Every category label renders localised, asserted on **rendered text** in all locales — not on the key. |
| Device journeys | Real Android and real iPhone: attach a screenshot, send, see it in the dashboard. |

## Out of Scope

- The queue and admin surface ([[SHY-0380]]), beyond showing attachments.
- Replying to the person in-app; that belongs to [[EPIC-0012]].
- Fixing `ReportMessageDialog`'s unlocalised reasons ([[SHY-0390]]).

## Dependencies

- [[SHY-0385]] — the repository, typed outcome and queue integration carry
  forward unchanged; only the Compose surface is replaced.
- [[SHY-0380]] — the endpoint whose category allowlist must widen.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| App and server category lists drift | A contract test asserts the pair matches, rather than trusting review. |
| Category labels ship in English | Asserted on rendered text per locale — the exact failure SHY-0390 records. |
| A large video fails opaquely mid-upload | Explicit size bound checked before upload begins. |
| The redesign loses SHY-0385's "never lose what you typed" | That behaviour has its own test and the test survives the redesign. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Screenshot attached and sent from a real Android device and a real iPhone,
      and seen in the dashboard.
- [x] Contract test between app and server category lists passing.

## Device proof

Walked on the OnePlus CPH2653 against local, 2026-08-21:

| Step | Result |
| --- | --- |
| Contact Us opens a **page** | six categories, attachment control, back arrow |
| Category chosen from the picker | `category = "bug"` — the sixth value, which the server allowlist did not have before this story |
| Screenshot attached | listed by its own filename, removable |
| Sent | ticket `cYYSH9aymp1vfjbwClmD` |
| Stored context | `{appVersion 0.97.15, screen settings, platform android}` |
| Object in storage | 7,858 bytes, **content-type `image/png`** |
| Admin signed link | issued, and fetching it returns the actual image |

That content-type is the point of the new picker: it is what the platform
reported, not the hardcoded `image/jpeg` that made SHY-0400's video path
unreachable.

The 409 path was walked too: "You already have a request open", message kept,
shown as information rather than the person's error.

**iOS proof is owed** — a TestFlight build from this branch is in flight.

## Notes

- Supersedes SHY-0385's dialog. The plumbing beneath it — repository, typed 409
  outcome, guard, "never lose what you typed" — is unchanged.
