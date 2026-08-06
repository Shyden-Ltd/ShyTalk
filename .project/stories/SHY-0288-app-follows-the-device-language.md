---
id: SHY-0288
status: Draft
owner: claude
created: 2026-08-06
priority: P1
effort: M
type: refactor
roadmap_ids: []
epic: EPIC-0010
pr:
---

# SHY-0288: The app follows the device language; remove in-app selection

## User Story

As someone whose phone is already set to Vietnamese,
I want ShyTalk to open in Vietnamese without my choosing anything,
So that I never have to hunt through settings in a language I cannot read.

## Why

An in-app language picker asks a person to state something the phone already
knows. Worse, it can disagree with the phone, so notifications arrive in one
language and the screen behind them is in another. And it has a bootstrapping
problem: if the app opens in a language you cannot read, finding the setting
that fixes it is the hardest possible first task.

The app has no URLs, so it cannot take shyden.co.uk's routing. What it can take
is the underlying principle — the language is a property of the context, not a
setting to manage — and for a phone, the context is the phone's own locale.

## Acceptance Criteria

### Happy path

- [ ] The app renders in the device language when it is one of the five MVP
      languages, on first launch, with no prompt and no choice.
- [ ] Changing the phone's language and returning to the app changes the app's
      language.

### Error paths

- [ ] A device set to a language ShyTalk does not support renders in English.
- [ ] A device set to a regional variant (`zh-Hant`, `vi-VN`) resolves to the
      supported base language rather than falling back to English.

### Edge cases

- [ ] An existing user who had previously chosen an in-app language is moved to
      the device language on upgrade, without a crash and without a blank screen.
- [ ] A device set to a right-to-left language renders in English left-to-right,
      since no RTL locale is supported after SHY-0289.

### Performance

- [ ] No language resolution work happens on the main thread at startup in a
      way that delays first paint.

### Security

- [ ] N/A — removing a local preference introduces no new data flow, and no
      language state leaves the device.

### UX

- [ ] No language picker exists anywhere in the app, and no setting row for it.
- [ ] Every screen the removal touches keeps its layout in all five languages
      at low resolution.

### i18n

- [ ] Exactly five locales resolve; a missing string in any of them fails the
      build rather than rendering English inside a translated screen.
- [ ] Strings removed with the picker are deleted from all five locale files,
      not orphaned.

### Observability

- [ ] The resolved locale is logged once at startup, so a support report can say
      which language the app actually chose.

## BDD Scenarios

**Scenario: The app opens in the phone's language**

- **Given** a phone set to Thai
- **When** someone opens ShyTalk for the first time
- **Then** the app is in Thai
- **And** they were not asked to choose a language

**Scenario: An unsupported phone language falls back**

- **Given** a phone set to German
- **When** someone opens ShyTalk
- **Then** the app is in English

**Scenario: A regional variant resolves to its language**

- **Given** a phone set to Vietnamese as used in Vietnam
- **When** someone opens ShyTalk
- **Then** the app is in Vietnamese

**Scenario: An existing chooser is moved across on upgrade**

- **Given** someone previously chose a language inside the app
- **When** they upgrade and open it
- **Then** the app is in their phone's language
- **And** no language setting is offered

## Test Plan

**RED first:**

- `shared/src/commonTest/.../LocaleResolverTest.kt` — device tag to supported
  locale for all five, an unsupported tag, `zh-Hant`, `vi-VN`, empty and
  malformed tags.
- `shared/src/commonTest/.../StringCatalogTest.kt` — the five catalogues have
  identical key sets and no blank values; a removed key fails.
- `app/src/androidTest/.../LanguageFollowsDeviceTest.kt` — instrumented, real
  device: set locale, assert on-screen text; assert no settings row for language.
- `iosApp/iosAppUITests` — the equivalent on a real iPhone.
- Upgrade case: a stored legacy preference is ignored and does not crash.

**GREEN:** device-locale resolver; delete the picker, its screen, its
navigation entry, its stored preference and its strings.

**Regression:** `./gradlew testDevDebugUnitTest :shared:jvmTest detekt`,
`:shared:compileKotlinIosArm64`, full instrumented BDD corpus.

## Out of Scope

- Deleting the 15 non-MVP locale files (SHY-0289) — this story keeps them
  resolving to English until then.
- Web surfaces (SHY-0285/0286/0287).
- Notification language, which follows the same device locale and needs no
  change.

## Dependencies

- None on the web stories; can run in parallel with them.

## Risks & Mitigations

- **Removing a visible feature can read as a regression.** Mitigation: the
  release note states that ShyTalk now follows the phone's language; the
  behaviour is what most apps do and needs no explanation beyond that.
- **A user who deliberately ran the app in a second language loses that.**
  Accepted: operator decision 2026-08-06. The phone-level setting remains
  available to them.
- **Upgrade path can strand someone on a dead preference.** Mitigation: an
  explicit upgrade test with a legacy preference present.

## Definition of Done

- [ ] All AC met; tests written RED first across Kotlin unit, Android
      instrumented and iOS UI.
- [ ] Journeys walked on a real Android device AND a real iPhone in all five
      languages, local then dev.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to:` recorded.
- [ ] CI green by name.

## Notes (running log)

- 2026-08-06 — Created under EPIC-0010. Operator chose "follow the device
  language, no picker" over keeping a reduced picker.
