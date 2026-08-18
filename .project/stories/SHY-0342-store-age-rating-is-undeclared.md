---
id: SHY-0342
status: In Review
owner: claude
created: 2026-08-18
priority: P0
effort: M
type: docs
roadmap_ids: []
mvp: true
---

# SHY-0342: Nobody has worked out what age rating this app must carry, or checked it matches what we built

## User Story

As the **ShyTalk operator submitting to the App Store and Play Store**, I want
the age rating we declare to be derived from the features we actually shipped
and recorded where it can be checked, so that submission is not the moment we
discover the rating is wrong.

## Why

**P0 because an app cannot be published without a rating, and a wrong one is
worse than a late one.** Google removes apps whose IARC questionnaire is found
inaccurate. Apple rejects under Guideline 2.3.6 for a mismatched age rating and
treats a misdeclaration on a minors-facing app as a trust problem, not a form
error.

**We have never answered the questionnaire.** There is no rating declaration
anywhere in this repository. `app/src/main/play/` — the Gradle Play Publisher
directory, and publishing IS wired up (`app/build.gradle.kts:9`, track
`internal`, `DRAFT`) — contains release notes and nothing else. There is no
listing, no content-rating record, and no iOS equivalent: no fastlane metadata,
no `Deliverfile`. So the answers exist, if at all, only in someone's memory of a
console session.

**Meanwhile the app has grown the exact features these questionnaires ask about.**
All verified present in the tree, not assumed:

| Questionnaire subject | What we actually ship |
| --- | --- |
| User-generated content | Profiles, descriptions, avatars and cover photos, room names |
| Live, unreviewed voice with strangers | LiveKit voice rooms — the core product |
| Direct messages between users | `feature/messaging`, private and group chat |
| In-app purchases of virtual currency | Play Billing + StoreKit (`IosStoreKitPurchase.kt`), beans, wallet, gifting |
| **Simulated gambling** | **`feature/gacha` — Lucky Spin wheel with tiers, spun with purchased currency** |
| Contact/social graph | Followers, following, stalkers |
| Age collection | `dateOfBirth` on the user record, feature-tiered gating (SHY-0060) |

**The gacha row is the one that will decide the rating.** A spin-the-wheel
mechanic bought with purchased currency reads as simulated gambling on both
questionnaires. The operator has already ruled that the gacha **age gate is
dropped** and cohort segregation kept
([[project-indonesia-relocation-and-age-gating-decision]]) — that decision stands
and this story does not reopen it. What this story must do is state honestly what
that decision implies for the rating we declare, so the operator chooses the
rating knowing the trade, rather than discovering it in a rejection email.

**And the rating has to agree with the app's own behaviour.** SHY-0060 shipped
per-feature age thresholds; SHY-0219 will test them. If the store says 12+ and
the app lets a 13-year-old into live voice with strangers, the two artefacts
contradict each other — and the store listing is the one a regulator reads first.
Nothing currently ties them together, so they can drift silently.

**Why it is a docs story with teeth.** The declaration itself lives in two
consoles we cannot version-control. What we CAN do — and what makes this
checkable rather than a memo — is keep the answers and their justification in the
repo, and pin the app-side constants they depend on with a test, so changing the
minimum age without revisiting the rating fails a build.

## Acceptance Criteria

### Happy path

- [ ] Both questionnaires are answered in full, and each answer names the feature that justifies it.
- [ ] The answers and the resulting rating are recorded in the repository, not only in the consoles.
- [ ] The declared rating is consistent between Apple and Google, or the reason they differ is written down.
- [ ] The operator has seen and approved the final rating before submission.

### Error paths

- [ ] A feature that would change the rating cannot be added without the discrepancy being surfaced.
- [ ] If a questionnaire answer cannot be justified from the shipped app, it is left unanswered and escalated rather than guessed.

### Edge cases

- [ ] The rating covers features that are built but disabled or behind a flag, since a reviewer may still reach them.
- [ ] The rating accounts for the regions we intend to launch in, where thresholds differ.
- [ ] The minimum age the app enforces and the age the stores advertise agree with each other.

### Performance

- [ ] N/A — a declaration and a pinning test; no runtime surface.

### Security

- [ ] The recorded answers contain no credentials and no console account details.

### UX

- [ ] Any age shown to users inside the app matches the rating we declare.

### i18n

- [ ] Where a store requires the rating or its disclosures per locale, every launch locale is covered.

### Observability

- [ ] The next person can see when the rating was last reviewed, against which version, and by whom.

## BDD Scenarios

**Scenario: The rating reflects the app we built**

- **Given** the app ships live voice chat, direct messages and a paid spin-the-wheel feature
- **When** the age rating is decided
- **Then** each of those features is accounted for in the answers

**Scenario: The operator decides, not the developer**

- **Given** a completed set of questionnaire answers and the rating they produce
- **When** the rating would restrict who can install the app
- **Then** the operator approves it before anything is submitted

## Test Plan

**RED first.** The failing state today is trivially demonstrable: no rating
record exists in the repo, so the test that asserts one fails immediately.

### Node / Jest — `express-api/tests/scripts/store-age-rating.test.js`

- `an age-rating record exists and names both stores` — **the gap, in one assertion**
- `every questionnaire subject the app implements has an answer` — driven from a list of feature markers found in the tree, so a new feature with no answer fails
- `the recorded minimum age matches the age the app enforces`
- `the record names the version it was last reviewed against`

### Kotlin unit — `shared/src/commonTest/.../`

- `the app's minimum-age constant matches the declared store rating`

### Mutation proof

| Mutation | Must kill |
| --- | --- |
| the rating record deleted | `an age-rating record exists and names both stores` |
| the app's minimum age lowered | `the recorded minimum age matches the age the app enforces` |
| the gacha answer removed from the record | `every questionnaire subject the app implements has an answer` |
| the reviewed-against version stripped | `the record names the version it was last reviewed against` |

### Real-run proof

- The questionnaires are completed in both consoles and the resulting rating
  matches the record, evidenced by a screenshot in the story notes.

### Classification

`.md` plus one new test and one constant assertion. No app, backend or website
runtime surface changes → no device gauntlet for this change itself.

## Out of Scope

- Changing any age gate, including the gacha decision, which is settled.
- The privacy declarations — SHY-0343.
- Store listing copy, screenshots and graphics — SHY-0344.
- The compliance test suite that proves age-gating behaviour — SHY-0219.

## Dependencies

- **SHY-0060** (per-feature age thresholds, Done) supplies the minimum age this
  record must agree with.
- **Operator approval is a hard gate.** The rating decides who may install the
  app; it is not a developer's call.

## Risks & Mitigations

| Risk | Mitigation |
| ---- | ---- |
| An honest answer forces a higher rating than hoped | Surfaced early and in writing, with the feature that causes it named, so the operator can choose between the rating and the feature while there is still time. |
| The record drifts from the console | The record names the version it was reviewed against, and the pinning test fails when the app's own age constant moves. |
| Answers guessed to get through submission | An unjustifiable answer is escalated, never invented — an AC, and the reason the answers cite features. |

## Definition of Done

- [ ] Every AC checkbox above is met.
- [ ] Every named test exists, was observed RED first, and is now green.
- [ ] Every mutation killed its named test and was reverted with a git-verified clean tree.
- [ ] The operator has approved the final rating, recorded in Notes with the date.
- [ ] `cd express-api && npm test` passes; `npm run lint` clean at `--max-warnings=0`.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] Status `In Review` before merge; `Done` on release cut with `released_in:`.

## Notes (running log)

- **2026-08-18 20:1x WIB** — Filed at operator request as part of the store-
  readiness set. Checked before writing: Gradle Play Publisher **is** configured
  (`app/build.gradle.kts:9`) but `app/src/main/play/` contains only
  `release-notes/`, and there is no fastlane or App Store Connect metadata in the
  tree at all. So no rating has been recorded anywhere we can inspect.

- **2026-08-18** — Every row of the questionnaire table was verified in the tree,
  not inferred: `feature/gacha` (LuckySpinWheel, SpinTier), Play Billing in
  `libs.versions.toml:144` and StoreKit in `IosStoreKitPurchase.kt`,
  `feature/messaging`, LiveKit voice rooms, and `dateOfBirth` on the user model.

- **2026-08-18** — The gacha decision is settled and not reopened here
  ([[project-indonesia-relocation-and-age-gating-decision]]). This story's job is
  to say plainly what declaring it honestly does to the rating, in time for the
  operator to weigh it.

- **2026-08-19 — the deliverable exists: `.project/store-readiness/age-rating-answers.md`.**
  Both questionnaires answered line by line, written to test the operator's 13+
  target honestly rather than to reach it. Where an answer puts 13+ at risk it
  says so plainly instead of quietly choosing the convenient option.

  **Verdict: 13+ is achievable, but not automatic.** It rests on two things
  staying true — no real-money gambling (there is no cash-out: no transfer,
  withdrawal or payout endpoint exists, checked rather than assumed), and
  moderation with reporting, blocking and a way to act on reports, which is what
  keeps a user-generated-content app out of the 17+ bucket. The two answers that
  actually decide the rating pull in opposite directions, and the sheet says
  which one is the risk: **simulated gambling**, because of the Lucky Spin.

  Two Play obligations follow that are **not yet met**, and both are compliance
  gaps rather than rating questions:
  1. **Odds disclosure for the Lucky Spin** — now filed as SHY-0349.
  2. The **Data Safety** declaration must be filed alongside the rating.

  Currency terms are used as the operator corrected them: **ShyCoins** are bought
  with real money and are what you spend to play; **ShyBeans** are what a gift
  *recipient* receives, redeemable for ShyCoins. The sheet does not say beans buy
  spins.

- **2026-08-19 — what is left is the operator's, and only the operator's.**
  Nothing has been submitted, and the sheet is headed as a draft for review. The
  App Store questionnaire was revised in 2025 with new capability questions and a
  13+/16+/18+ banding, and I could not open either console to confirm the live
  wording — so the sheet states that limitation rather than guessing at it. The
  remaining step is the operator entering the answers in both consoles and
  reading back the rating each one produces.

  Status moves to `In Review` because the work product is complete and awaiting
  exactly that review. It does not move to Done until a rating is actually
  declared.

- **2026-08-19 — self-review of the answer sheet (not an agent review, and
  labelled as such).** Claims were spot-checked against the tree rather than
  taken on trust, since the sheet's whole argument rests on them:

  - **"No cash-out exists"** — confirmed. Grepped `express-api/src/routes` for
    withdraw / payout / cashout / transfer routes: **none**. The economy surface
    is `daily-reward`, `gacha`, `gift`, `gift-direct`, `gift-batch`,
    `backpack-send`, `redeem-beans`, `purchase`, `trial-claim`,
    `trial-activate`, `test-coins`, `balance`. Nothing converts value back to
    money.
  - **One wording fix applied.** The sheet said "No transfer, withdrawal or
    payout endpoint", which reads as contradicting its own gifting rows —
    `gift-direct`, `gift-batch` and `backpack-send` *are* transfers of in-app
    value between users. On a document that may inform a store or legal
    position, that imprecision is worth removing: it now says no endpoint
    converts in-app value back into money, and states the in-app transfers
    explicitly, because that is a question the stores actually ask.
  - `/economy/redeem-beans` and `/economy/purchase` both exist as cited.

  Reviewed-up-to: b656fc2590b
