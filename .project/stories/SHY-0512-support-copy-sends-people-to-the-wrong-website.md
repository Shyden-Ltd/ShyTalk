---
id: SHY-0512
status: Draft
owner: unassigned
created: 2026-09-04
priority: P2
effort: S
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0512: The device-lock and suspension screens send people to the wrong website for support

## User Story

As **somebody locked out of ShyTalk on a device that already has an account,
or suspended**, I want the screen that turns me away to point me at the
ShyTalk website for help, so that I go to the product's own site and not the
company's.

## Why

**Reported by the operator, 2026-09-04**, on a real device: signing in to a
second account on a device that already holds one is correctly refused, but
the message ends *"For support, visit shyden.co.uk"* — the company site, not
the ShyTalk site.

Two strings carry the company domain as the support destination, in every
shipped locale:

| Key | Screen | Locales |
| --- | --- | --- |
| `device_locked_description` (`shared/src/commonMain/composeResources/values/strings.xml:632`) | `SignInScreen.kt:241` — the one-account-per-device refusal | en, zh, id, vi, th |
| `suspension_support_contact` (`strings.xml:727`) | `SuspensionScreen.kt:364` — "if you cannot appeal here" | en, zh, id, vi, th |

Both are plain text: the person is told to *visit* a domain they must then
type. And the domain is a literal inside translated copy, ten times, which is
how it came to be wrong everywhere at once and why a fix that edits one string
would be incomplete.

`shyden_ltd_brand` (`strings.xml:603`) also names shyden.co.uk — correctly: it
is the company registration line. It stays.

The right destination is the **ShyTalk website of the app's own environment**
— the same environment-derived host rule every in-app web link must follow
([[feedback-web-urls-env-derived-never-cross]]): a dev build points at the dev
site, prod at prod. SHY-0376 is delivering that resolver (today
`Constants.LEGAL_BASE_URL`, `Constants.kt:75`, is a literal prod host); this
story uses it rather than adding a second one.

## Acceptance Criteria

### Happy path

- [ ] Both strings say *the ShyTalk website* in words and no longer contain a
      hostname, in all five shipped locales.
- [ ] The words are a tappable link that opens the environment's ShyTalk site
      through the resolver SHY-0376 introduces (dev build → dev site, prod →
      prod, local → the local static serve), on Android and iOS.
- [ ] The rest of each message is unchanged.

### Error paths

- [ ] If the link cannot be opened (no browser, resolver failure), the text is
      still readable and names the site in words; the failure is logged, never
      swallowed.

### Edge cases

- [ ] The link target never crosses environments: a dev build cannot produce
      the prod host from either screen (negative test per environment, as the
      rule requires).
- [ ] Locales with no spaces (zh, th) still render the link region correctly;
      the link is the site's name, not a bare URL, so line breaks are natural.

### Performance

- [ ] N/A — two static strings and one existing link handler.

### Security

- [ ] A pin test asserts no string resource in any locale contains
      `shyden.co.uk` except `shyden_ltd_brand`, so the company domain cannot
      creep back into support copy.
- [ ] The link opens in the system browser, never an in-app WebView with
      credentials.

### UX

- [ ] Link styled as the app's other in-text links (underline or accent
      colour), announced as a link by screen readers, with a touch target of at
      least 48 dp.

### i18n

- [ ] All five shipped locales updated; the translations are reviewed by a
      reader of each language because both screens are safety-adjacent copy.
      Rendered text asserted, not keys.

### Observability

- [ ] Tapping the link logs `support-link:open <screen> <host>` at info so a
      cross-environment host would be visible in device logs.

## BDD Scenarios

**Scenario: A locked device points to the ShyTalk website**

- **Given** somebody signs in on a device that already holds another account
- **When** they are refused
- **Then** the message tells them to visit the ShyTalk website for support
- **And** tapping it opens the ShyTalk website

**Scenario: A suspended person is pointed to the ShyTalk website**

- **Given** somebody whose account is suspended and who cannot appeal in the app
- **When** they read the suspension screen
- **Then** they are told to get in touch through the ShyTalk website

**Scenario: A dev build opens the dev website**

- **Given** somebody using a dev build on a locked device
- **When** they tap the support link
- **Then** the dev ShyTalk website opens, not the public one

**Scenario: The company site is no longer named for support**

- **Given** any shipped language
- **When** the refusal or suspension message is shown
- **Then** it names the ShyTalk website and never the company's

## Test Plan

### Red

- `shared/src/jvmTest/kotlin/com/shyden/shytalk/feature/auth/SupportCopyNamesTheShyTalkSiteTest.kt`
  — reads every `values*/strings.xml` through the existing compose-locale
  helper; asserts neither key contains a hostname in any locale and that the
  only key containing `shyden.co.uk` is `shyden_ltd_brand`.
- `SupportLinkOpensOwnEnvironmentTest.kt` — for each `BuildVariant.environment`
  the link host is that environment's ShyTalk site and never another's.
- Journey step on both phones: the locked-device screen (J-device-lock) and the
  suspension screen (existing suspension journey) read the new wording and the
  tap opens the browser on the dev site.

### Green

- Strings in five locales with a link annotation; link handler reusing the
  SHY-0376 resolver; log line.

## Out of Scope

- The environment-matched access gate itself — SHY-0376.
- Where on the ShyTalk site support lives (the site has no support page today;
  SHY-0395 and EPIC-0012 own the mailbox and the ticket route). Until it has
  one, the link opens the site's home page.
- The company line `shyden_ltd_brand`.

## Dependencies

- SHY-0376 — the environment-derived website resolver this link must use.
  Picked up after it, or in the same sprint with SHY-0376 landing first.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A second, literal host resolver is written for the link | Dependency on SHY-0376; the negative per-environment test fails on any literal host. |
| Machine translation changes the safety copy's meaning | Reviewed by a reader of each language before merge (Security criterion). |
| The domain creeps back through a future string | The pin test allowlists exactly one key. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Device-proven on both phones: the operator repeats the second-account
      sign-in on dev and reads the corrected message; the tap opens the dev
      site.
- [ ] Evidence page signed off.

## Notes

- **2026-09-04** — Filed from the operator's device report. Both offending
  strings and all ten locale instances listed above so the fix is a sweep, not
  a single edit. The same day the operator re-reported SHY-0376 (dev site
  refusing the dev app); that story is the dependency here.
- **2026-09-04** — SHY-0376 reproduction, recorded here because the pre-merge
  gate refuses a notes append on a Draft story (SHY-0518): tapping the
  cyber-bullying banner in the dev app opens the dev page and the dev
  restriction refuses it. Operator: *"when on the dev version of the app, all
  the dev links should work as normal without restrictions."* Same rule as
  SHY-0376's 2026-08-20 quote; still Draft, P1, MVP after fifteen days.
