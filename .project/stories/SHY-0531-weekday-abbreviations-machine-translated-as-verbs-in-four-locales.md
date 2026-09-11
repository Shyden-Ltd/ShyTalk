---
id: SHY-0531
status: Draft
owner: unassigned
created: 2026-09-11
priority: P1
effort: S
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0531: Weekday abbreviations machine-translated as verbs in four locales — Indonesian "Wed" reads "Menikahi" (to marry)

## User Story

As an Indonesian, Chinese, Vietnamese or Thai speaker opening ShyTalk, I want
the daily-reward calendar's weekday row to name the days of the week, so that
the first screen I see is not showing me the words *marry*, *sit* and *the sun*
where Wednesday, Saturday and Sunday belong.

## Why

The three-letter English abbreviations `Wed`, `Sat` and `Sun` were
machine-translated as the **verb** and the **celestial body**, not as day names.
Read directly from `shared/src/commonMain/composeResources/values-*/strings.xml`
on `develop`, 2026-09-11:

| locale | Mon | Tue | Wed | Thu | Fri | Sat | Sun |
| --- | --- | --- | --- | --- | --- | --- | --- |
| en (base) | Mon | Tue | Wed | Thu | Fri | Sat | Sun |
| id | Senin | Selasa | **Menikahi** | Kam | Jumat | **Duduk** | **Matahari** |
| zh | 周一 | 星期二 | 周三 | 星期四 | 周五 | 周六 | **太阳** |
| vi | Thứ hai | thứ ba | Thứ tư | Thứ năm | Thứ sáu | **Đã ngồi** | **Mặt trời** |
| th | จันทร์ | อ | พ | พฤ | ศุกร์ | **นั่ง** | **ดวงอาทิตย์** |

What the wrong values mean:

| value | locale | actual meaning | should be |
| --- | --- | --- | --- |
| `Menikahi` | id | **to marry** | Rab (Rabu) |
| `Duduk` | id | to sit | Sab (Sabtu) |
| `Matahari` | id | the sun (the star) | Min (Minggu) |
| `太阳` | zh | the sun (the star) | 周日 |
| `Đã ngồi` | vi | sat (past tense of sit) | Thứ bảy |
| `Mặt trời` | vi | the sun (the star) | Chủ nhật |
| `นั่ง` | th | to sit | ส. (เสาร์) |
| `ดวงอาทิตย์` | th | the sun (the star) | อา. (อาทิตย์) |

**`Menikahi` means "to marry".** ShyTalk's hard product guardrail is that it is
not a dating app, and the platform has a minor cohort, which is why age
segregation exists. A weekday column that reads *"Marry"* to every Indonesian
user is precisely the dating-adjacent signal that guardrail exists to catch —
arriving not through a feature decision but through an unreviewed string. That
is why this is P1 rather than cosmetic.

This is a **known, named defect class**: the same failure as
`vi.rosterColSex = 'Tình dục'` (*sexual intercourse*) in shyden.co.uk#114.
Machine translation fails on **bare labels** and passes on **sentences**,
because a three-letter source carries no context to disambiguate the sense.
Every surrounding sentence in these files is correct; only the abbreviations
are wrong.

**No existing guard could have caught it.** An identical-to-English check
catches untranslated strings; an empty-copy check catches blanks. A string that
is translated *and wrong* is neither.

Two secondary defects surfaced in the same read:

- **The month name is hardcoded English by construction.**
  `DailyRewardDialog.kt:95` renders `now.month.name` — the
  `kotlinx.datetime.Month` enum name, always `SEPTEMBER`-style English. No
  translation exists or can exist for it as written.
- **Register is inconsistent inside every locale**: `zh` mixes `周一`/`周三`
  with `星期二`/`星期四`; `th` mixes full words (`จันทร์`) with bare letters
  (`อ`, `พ`, `พฤ`); `id` mixes full names with the truncation `Kam`; `vi`
  mixes capitalisation (`Thứ hai` against `thứ ba`).

Blast radius is contained: `day_*` is consumed only at
`DailyRewardDialog.kt:171-177`. But that dialog is shown on app open, so every
user in these four locales sees it.

## Acceptance Criteria

### Happy path

- [ ] All seven `day_*` values are correct day names in `id`, `zh`, `vi` and
      `th`, reviewed by a speaker of each.
- [ ] Within each locale the seven values use one consistent register — all
      short forms or all full names, never a mixture.

### i18n

- [ ] The month name is localised rather than rendered from `Month.name`, or
      the design deliberately drops it; a hardcoded English month sitting beside
      translated day names is not an acceptable end state.
- [ ] Every string of three words or fewer in every machine-seeded locale is
      audited separately from prose, because that is where this class lives.
      Findings are recorded on this story even where a label turns out correct.

### Edge cases

- [ ] The audit derives its file set from the filesystem, not from the list
      written into this story — a sweep driven by a hand-written list is not a
      sweep.
- [ ] Locales added in future are covered by the guard automatically rather
      than needing a new case.

### Error paths

- [ ] A `day_*` key missing from a locale fails the guard rather than silently
      falling back to English.

### UX

- [ ] The weekday row reads as a calendar header to a native speaker of each
      locale, not as a list of unrelated words.

### Security

- [ ] No change here widens what the daily-reward dialog reads or writes; this
      is a resource-string change only.

### Observability

- [ ] The guard names the offending locale and key when it fails, so the
      verdict is actionable without opening the file.

### Performance

- [ ] The guard runs in the existing unit suite and adds no measurable time to
      it.

## BDD Scenarios

**Scenario: An Indonesian speaker opens the app**

- **Given** the app language is Indonesian
- **When** the daily-reward dialog appears on open
- **Then** the weekday row reads as the seven Indonesian day names
- **And** no cell reads "Menikahi", "Duduk" or "Matahari"

**Scenario: A Thai speaker sees a consistent register**

- **Given** the app language is Thai
- **When** the daily-reward dialog appears
- **Then** all seven weekday labels use the same form as each other

**Scenario: The guard refuses a re-introduced mistranslation**

- **Given** a guard asserting no `day_*` value carries a known wrong sense
- **When** a developer restores `day_sat` to "Duduk" in the Indonesian file
- **Then** the guard fails and names the locale and the key

**Scenario: A missing day key is loud rather than silent**

- **Given** a locale file with `day_wed` removed
- **When** the guard runs
- **Then** it fails and names the missing key, rather than the app falling back
  to English unnoticed

**Scenario: A newly added locale is covered without a code change**

- **Given** a sixth locale directory is added under `composeResources`
- **When** the guard runs
- **Then** it audits that locale's `day_*` values too, having derived the set
  from the filesystem

**Scenario: The month name is not English in a non-English locale**

- **Given** the app language is Vietnamese
- **When** the daily-reward dialog appears
- **Then** the month is shown in Vietnamese, or not shown at all

**Scenario: Short labels elsewhere are audited for the same failure**

- **Given** the audit of every label of three words or fewer
- **When** it completes
- **Then** its findings are recorded on this story, including the labels that
  were checked and found correct

## Test Plan

- A unit guard over `composeResources/values-*/strings.xml`, deriving the locale
  set from the filesystem, asserting each locale's seven `day_*` values against
  a reviewed table and asserting register consistency within a locale.
- **Mutation-verify both ways**: restore one of the eight wrong values and watch
  the guard go red naming that locale and key; then remove a `day_*` key
  entirely and watch the missing-key branch fire. A guard whose branches have
  never matched anything is itself vacuous.
- Manual confirmation on a real device in each of the four locales, since this
  class is only visible by reading the rendered row — no automated check caught
  it for the months it has been shipping.

## Out of Scope

- Re-reviewing the full translation catalogues. This story covers the weekday
  row plus the short-label sweep that the same defect class demands.
- The Super Shy seat-count behaviour and any other room-screen work.

## Dependencies

- A speaker of each of `id`, `zh`, `vi` and `th` to confirm the replacement day
  names, per the standing rule that machine-translated copy is a first draft.

## Risks & Mitigations

- **Risk:** the replacement abbreviations are themselves machine-chosen and
  wrong in a subtler way. **Mitigation:** speaker review is an acceptance
  criterion, not a follow-up, and the guard pins the reviewed values so a later
  edit cannot quietly drift.
- **Risk:** the sweep of short labels finds a large number of further defects
  and the story grows without bound. **Mitigation:** findings are recorded here
  and split into their own stories; this one stays scoped to the weekday row.

## Definition of Done

- [ ] Guard red before the fix and green after, mutation-verified in both
      directions (a restored wrong value, and a removed key).
- [ ] All seven `day_*` values reviewed by a speaker in each of `id`, `zh`,
      `vi`, `th`; register consistent within each locale.
- [ ] Month name localised or deliberately dropped, with the decision recorded
      here.
- [ ] Short-label sweep complete, its file set derived from the filesystem, and
      its findings recorded on this story.
- [ ] Story `In Review` with a `Reviewed-up-to` marker; index row updated.

## Notes


During shyden.co.uk#138, capturing real ShyTalk room screenshots for the
shyden.co.uk homepage. The app was switched to Thai on a real device (OnePlus
CPH2653, Android 16) and the daily-reward dialog happened to be on screen.
Reading the row is what exposed it; no test failed, and nothing in CI would
have.
