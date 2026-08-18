---
id: SHY-0343
status: Draft
owner: claude
created: 2026-08-18
priority: P0
effort: M
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0343: Our privacy declarations say we collect a device ID and some audio; we collect far more than that

## User Story

As the **ShyTalk operator submitting to the App Store and Play Store**, I want
our privacy declarations to describe the data the app actually collects, so that
we are not shipping a statement about ourselves that is untrue.

## Why

**P0. This is not a missing form — it is an inaccurate one, which is the worse
of the two.** A blank Data Safety section blocks a Play release. A wrong one is
a policy violation, and both stores treat a minors-facing app that
under-declares as a trust matter rather than an oversight.

**What we declare today.** `iosApp/iosApp/PrivacyInfo.xcprivacy` — our entire
privacy manifest — names exactly two data types:

| Declared | Marked as |
| --- | --- |
| Device ID | not linked to the user, app functionality |
| Audio data | not linked to the user, app functionality |

plus one required-reason API (`UserDefaults`, `CA92.1`). `NSPrivacyTracking` is
`false`, which is correct — there are no advertising SDKs, and no Analytics or
Crashlytics anywhere in the tree (checked).

**What we actually collect,** every item read off `User.kt` and the feature tree,
all of it attached to an identified account:

| Data | Where it comes from |
| --- | --- |
| Email address | `email` on the user record; Google sign-in |
| Name | `displayName` |
| Photos | `avatarUrl`, `profilePhotoUrl`, `coverPhotoUrl` |
| Date of birth | `dateOfBirth`, used for age gating |
| Other user content | `description`, `nationality`, room names, private and group messages |
| Contacts / social graph | `followingIds`, `followerIds`, stalkers |
| Purchases | Play Billing and StoreKit; beans, wallet, transaction history, gifting |
| Audio | LiveKit voice rooms |
| Device identifiers | device ID for ban enforcement; `fcmTokens` for push |

**The two lists barely overlap, and where they do they disagree.** Audio is
declared "not linked to the user" — but it is live voice in a named seat, heard
by other people who know exactly whose voice it is, and it is what a ban is
enforced against. The device ID is declared unlinked while being used to tie a
banned device to an account. Everything else is simply absent: email, name,
photos, date of birth, messages, purchases, the social graph.

**Play has nothing at all.** No Data Safety artefact exists in the repository —
`app/src/main/play/` holds only release notes. Play will not accept a release
without that section completed, so this is a hard stop, not a risk.

**Apple's App Privacy labels are equally undone.** They are entered in App Store
Connect, and there is no fastlane or metadata directory to hold them, so nothing
about them is reviewable here.

**A smaller but certain rejection, found in passing.** The four purpose strings
in `iosApp/iosApp/Info.plist` — microphone, camera, photo library, Face ID — are
English-only; there is no `.lproj` or `InfoPlist.strings` anywhere. We are
launching in five languages. A user in Vietnam gets an English permission prompt,
which is both a bad first impression and a reviewer's note.

**Why this is a bug and not paperwork.** A privacy declaration is a factual claim
about the software, made in the software's own metadata. Ours is wrong in a way
that consistently understates. The fix is to make it true, and to leave behind a
check so that adding the next field to the user record cannot silently make it
untrue again.

## Acceptance Criteria

### Happy path

- [ ] The iOS privacy manifest lists every category of data the app collects, with the right purpose and the right linked-to-user setting.
- [ ] Play's Data Safety answers are completed and recorded in the repository, not only in the console.
- [ ] Apple's App Privacy answers are completed and recorded the same way.
- [ ] The three declarations agree with each other and with the privacy policy we publish.

### Error paths

- [ ] Adding a new kind of collected data without declaring it fails a check, rather than shipping quietly.
- [ ] A declaration that cannot be justified from the code is escalated, never guessed.

### Edge cases

- [ ] Data collected only in some regions, or only by a feature behind a flag, is still declared.
- [ ] Data collected by the third-party SDKs we bundle is accounted for, not only our own code.
- [ ] Data we collect but do not link to an account is declared as such, and the claim is true.
- [ ] Voice audio is declared honestly as identifiable, because a voice in a named seat is.

### Performance

- [ ] N/A — declarations and a check; no runtime surface.

### Security

- [ ] The declarations name categories, never sample values or real user data.

### UX

- [ ] Permission prompts explain the real reason for the permission in the user's own words.

### i18n

- [ ] The iOS purpose strings are localised into every launch locale, and the rendered prompt is asserted, not just the key.
- [ ] Where a store accepts localised privacy disclosures, every launch locale is covered.

### Observability

- [ ] The record shows when each declaration was last reviewed and against which version.

## BDD Scenarios

**Scenario: The declaration matches what we collect**

- **Given** the app collects email addresses, photos, dates of birth and voice
- **When** the privacy declarations are reviewed
- **Then** every one of those appears in them

**Scenario: People are asked for permission in their own language**

- **Given** a user whose phone is set to Vietnamese
- **When** the app asks for microphone access
- **Then** the reason is shown in Vietnamese

## Test Plan

**RED first.** The defect is readable today: the manifest names two data types,
the user record carries nine categories.

### Node / Jest — `express-api/tests/scripts/privacy-declarations.test.js`

- `the iOS privacy manifest declares every collected data category` — driven from a maintained inventory, so a new category with no declaration fails. **The defect, in one assertion.**
- `the Play Data Safety record exists and covers the same categories`
- `the Apple App Privacy record exists and covers the same categories`
- `the three declarations do not contradict each other`
- `audio and device identifiers are declared as linked to the user`
- `the inventory covers every personal field on the user record` — the guard that makes the others honest
- `each record names the version it was last reviewed against`

### iOS / Kotlin

- `every purpose string in Info.plist has a translation in every launch locale`

### Mutation proof

| Mutation | Must kill |
| --- | --- |
| a data type removed from the manifest | `the iOS privacy manifest declares every collected data category` |
| audio flipped back to not-linked | `audio and device identifiers are declared as linked to the user` |
| a new personal field added to the user record with no declaration | `the inventory covers every personal field on the user record` |
| one locale's purpose strings deleted | `every purpose string in Info.plist has a translation...` |
| the Play record deleted | `the Play Data Safety record exists...` |

### Real-run proof

- Both console forms are submitted and match the repository records, evidenced by
  screenshots in the notes.
- A build installed on a real device shows the localised permission prompt.

## Out of Scope

- Changing what the app collects. This story makes the declaration true; reducing
  collection is a separate decision.
- The privacy policy's own wording — SHY-0344 covers reachability, and the legal
  review is [[project-gdpr-export-osa17-legal-review]].
- Age rating — SHY-0342.
- The compliance test suite proving export and erasure behaviour — SHY-0219.

## Dependencies

- **SHY-0342** shares the store-readiness record; they should agree on where that
  record lives, and land in either order.
- **SHY-0194** (locale set) fixes which languages "every launch locale" means.

## Risks & Mitigations

| Risk | Mitigation |
| ---- | ---- |
| The inventory drifts from the code | It is generated from the user record and feature markers and asserted against them, so drift fails a test rather than aging quietly. |
| An honest declaration looks worse in the store listing | It is also the accurate one, and the alternative is a policy violation on a minors-facing app. |
| Third-party SDK collection missed | Bundled SDKs are an explicit AC and an explicit test input, not an afterthought. |
| Console and repo diverge after submission | Each record names the version it was reviewed against, and screenshots are part of Done. |

## Definition of Done

- [ ] Every AC checkbox above is met.
- [ ] Every named test exists, was observed RED first, and is now green.
- [ ] Every mutation killed its named test and was reverted with a git-verified clean tree.
- [ ] Localised permission prompts seen on a real device in at least two languages.
- [ ] `cd express-api && npm test` passes; `npm run lint` clean at `--max-warnings=0`.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] Status `In Review` before merge; `Done` on release cut with `released_in:`.

## Notes (running log)

- **2026-08-18 20:2x WIB** — Filed at operator request. The manifest exists,
  which is why this went unnoticed: `PrivacyInfo.xcprivacy` is present and
  well-formed, so a glance says "done". It declares two data types where the user
  record carries nine categories.

- **2026-08-18** — Checked rather than assumed: no Analytics and no Crashlytics
  anywhere in the tree, and no advertising SDKs, so `NSPrivacyTracking false` is
  correct and stays. Bundled SDKs are FirebaseCore/Auth/Firestore/Database/
  Messaging/AppCheck, GoogleSignIn, and LiveKit via SPM.

- **2026-08-18** — Found while reading `Info.plist` for the same purpose: the
  four permission purpose strings are English-only, with no `.lproj` or
  `InfoPlist.strings` in `iosApp/`. Included here rather than filed separately
  because it is the same claim — what we tell people we take and why — and the
  same reviewer sees both.
