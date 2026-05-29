# Personas — the cast for journey-based testing

Each persona has a stable identity (uniqueId, email, cohort, userType, locale, device class). Journeys instantiate one or more personas and walk them through a multi-step flow, with state assertions against Firestore + the persona's UI on the specified platform, in lock-step.

The dev environment is seeded by `express-api/scripts/provision-test-personas.js`. Local stack reseeds them on every `bash local/start.sh`. Where a journey needs ephemeral users (e.g. a fresh signup), it creates them mid-flow and references them by tag.

`UserType` values are pinned to the enum in `shared/src/commonMain/kotlin/com/shyden/shytalk/core/model/UserType.kt`: `MEMBER`, `SHYTALK_OFFICIAL`, `MC_SINGER`, `MC_EVENT_HOST`, `TEACHER`.

---

## P-01 — Adam, adult new MEMBER
- **uniqueId**: ephemeral (fresh signup per journey)
- **userType**: `MEMBER`
- **Age**: 22 (DOB 2004-01-01)
- **Cohort**: minor at signup (default until verified), flips to adult after admin approves age verification
- **Locale**: en
- **Device**: Android dev APK (emulator preferred, falls back to OnePlus physical)
- **Wallet at start**: shyCoins=0, beans=0
- **Goal**: Sign up → legal → age verification → first gift sent
- **Used by**: j01, j04 (Adam is the friend Hayato downgrades away from), j07, j11 (as bystander)

## P-02 — Alice, adult power MEMBER
- **uniqueId**: 50000010 (`adult-power@shytalk.dev`)
- **userType**: `MEMBER`
- **Age**: 28 (DOB 1998-06-15)
- **Cohort**: adult, `isAgeVerified=true`
- **Locale**: en
- **Device**: Web Chromium primary, iOS Sim spot-check
- **Wallet**: shyCoins=5000, beans=2000, gcs=100
- **Social graph**: follows 30, followed by 50, hosts the occasional room
- **Used by**: j01 (recipient), j05, j07 (Adam's first follow), j13 (Layla follows her)

## P-03 — Mia, minor new MEMBER
- **uniqueId**: ephemeral (fresh signup per journey)
- **userType**: `MEMBER`
- **Age**: 15 (DOB 2010-08-20)
- **Cohort**: minor (auto-assigned at signup by DOB)
- **Locale**: en
- **Device**: iOS Sim primary, Android emulator parity check
- **Goal**: Sign up → restricted UX → discover same-cohort users → attempt cross-cohort interactions (should be gated)
- **Used by**: j02

## P-04 — Marcus, minor power MEMBER
- **uniqueId**: 60000010 (`minor-power@shytalk.dev`)
- **userType**: `MEMBER`
- **Age**: 16 (DOB 2009-04-10)
- **Cohort**: minor
- **Locale**: en
- **Device**: Android physical
- **Wallet**: shyCoins=300, beans=100
- **Social graph**: 5 follows (all minors), 8 followers (all minors)
- **Used by**: j02 (Mia's first follow), j08 (Vexa's target)

## P-05 — Lena, lapsed returning MEMBER
- **uniqueId**: 50000020 (`lapsed-adult@shytalk.dev`)
- **userType**: `MEMBER`
- **Age**: 31
- **Cohort**: adult, verified
- **Locale**: de
- **Last activity**: 45 days ago
- **State**: loginStreak=0, accepted privacyVersion=2 (current is 4 → forced re-acceptance), fcmTokens=[] (push tokens decayed)
- **Used by**: j03

## P-06 — Hayato, DOB-mismatch flip case
- **uniqueId**: 50000030 (`dob-mismatch@shytalk.dev`)
- **userType**: `MEMBER`
- **Claimed DOB**: 2007-01-01 (adult at signup)
- **Actual DOB on ID**: 2011-05-12 (minor)
- **Cohort**: starts adult, gets downgraded to minor after admin reviews ID
- **Locale**: ja
- **Device**: Android (signup), Greta is on Web Admin
- **Used by**: j04

## P-07 — Vexa, cross-cohort prober
- **uniqueId**: 50000040 (`adult-prober@shytalk.dev`)
- **userType**: `MEMBER`
- **Cohort**: adult, verified
- **Behavior**: deliberately attempts every cross-cohort interaction (follow, PM, gift, room invite, profile view, leaderboard) against P-04 Marcus
- **Device**: Web Chromium + Android in parallel — verifies both platforms enforce the same gate
- **Used by**: j08

## P-08 — Raul, harasser
- **uniqueId**: 50000050 (`harasser@shytalk.dev`)
- **userType**: `MEMBER`
- **Cohort**: adult
- **Locale**: en
- **Device**: Android
- **Behavior**: sends offensive PMs to P-09, receives warning, re-offends, gets suspended, appeals, eventually lifted
- **Used by**: j11

## P-09 — Nora, harassment victim
- **uniqueId**: 50000051 (`victim@shytalk.dev`)
- **userType**: `MEMBER`
- **Cohort**: adult
- **Locale**: en
- **Device**: iOS Sim
- **Behavior**: receives offensive PMs, reports, monitors outcome via system PMs from P-19
- **Used by**: j11

## P-10 — Theo, voice room host (regular MEMBER who hosts a lot)
- **uniqueId**: 50000060 (`host@shytalk.dev`)
- **userType**: `MEMBER`
- **Cohort**: adult
- **Locale**: en
- **Device**: Android physical primary
- **Behavior**: creates public rooms, manages seat queue, kicks abusers, ends rooms cleanly
- **Used by**: j09, j10

## P-11 — Ines, flaky-network joiner
- **uniqueId**: 50000061 (`joiner-flaky@shytalk.dev`)
- **userType**: `MEMBER`
- **Cohort**: adult
- **Locale**: en
- **Device**: iOS Sim with Network Link Conditioner "3G" + Chrome DevTools "Slow 3G" + 30% loss in alt journey
- **Used by**: j10, j14

## P-12 — Greta, admin
- **uniqueId**: 90000001 (`admin@shytalk.dev`)
- **userType**: `MEMBER` (admin status is conferred by custom claim `isAdmin=true`, not userType)
- **Custom claims**: `isAdmin=true`, `uniqueId=90000001`, `cohort=adult`
- **Locale**: en
- **Device**: Web Admin (Chromium primary)
- **Behavior**: reviews reports, actions age verification, audits, applies cohort overrides
- **Used by**: j04, j11, j12, j15 (cleanup of test gifts), j17 (verifies teacher payout)

## P-13 — Layla, Arabic-locale MEMBER
- **uniqueId**: 50000070 (`rtl-user@shytalk.dev`)
- **userType**: `MEMBER`
- **Cohort**: adult
- **Locale**: ar
- **Device**: Web Chromium primary, Android emulator parity
- **Goal**: complete a full social loop (signup is preset, sign in → discovery → follow → gift → wallet → notifications) in Arabic with RTL
- **Used by**: j13

## P-14 — Kenji, CJK-locale MEMBER
- **uniqueId**: 50000071 (`cjk-user@shytalk.dev`)
- **userType**: `MEMBER`
- **Cohort**: adult
- **Locale**: ja
- **Device**: Web WebKit primary (Safari is the worst CJK font fallback offender), iOS Sim parity
- **Used by**: j13

## P-15 — Selma, MC singer
- **uniqueId**: 50000080 (`mc-singer@shytalk.dev`)
- **userType**: `MC_SINGER`
- **Cohort**: adult, verified
- **Locale**: en
- **Device**: Android physical (real mic), Web Chromium parity for non-audio assertions
- **Wallet**: shyCoins=200, beans=10000 (earnings concentrated in beans)
- **Social graph**: 200 followers, hosts a "singing room" 3× per week
- **Goal**: open a singing room → fans join → fans send gifts during performance → gift animations render → beans accrue → room closes → earnings tally
- **Used by**: j15

## P-16 — Tariq, MC event host (team leader)
- **uniqueId**: 50000081 (`mc-event-host@shytalk.dev`)
- **userType**: `MC_EVENT_HOST`
- **Cohort**: adult, verified
- **Locale**: en
- **Device**: Web Admin tools + Android for hosting the event
- **Wallet**: shyCoins=10000, beans=50000
- **Social graph**: leads a roster of 4 MCs (one of which is P-15 Selma); his profile shows the team badge
- **Goal**: schedule and host a multi-singer event, invite roster MCs, manage the seat queue (each MC gets a turn), receive an event-level gift summary
- **Used by**: j16

## P-17 — Bao, teacher (ShyTalk mission)
- **uniqueId**: 50000090 (`teacher@shytalk.dev`)
- **userType**: `TEACHER`
- **Cohort**: adult, verified
- **Locale**: zh
- **Device**: Web Chromium (lessons run on desktop) + iOS Sim parity
- **Wallet**: shyCoins=500, beans=3000
- **Goal**: open a "language exchange" room → students join → Bao demonstrates Mandarin → students participate → room closes → student feedback
- **Used by**: j17

## P-18 — Yuki, language student
- **uniqueId**: 50000091 (`student@shytalk.dev`)
- **userType**: `MEMBER`
- **Cohort**: adult (the student persona is adult — minor students would also flow but the journey targets the dominant adult-learner path first)
- **Locale**: ja (their native), learning zh
- **Device**: iOS Sim
- **Goal**: discover Bao's teaching room, join, follow Bao, tip with a gift
- **Used by**: j17

## P-19 — Officia, ShyTalk Official bot account
- **uniqueId**: 1 (`officia@shytalk.dev`)
- **userType**: `SHYTALK_OFFICIAL`
- **Cohort**: adult (the bot operates cross-cohort because system PMs must reach minors too — the journey verifies SHYTALK_OFFICIAL is exempt from the cohort gate)
- **Locale**: n/a (sends locale-keyed templates)
- **Device**: n/a — server-side actor only; appears as a PM sender on the recipient's device
- **Goal**: send system PMs (`age_seg_age_up_welcome_pm`, `age_seg_age_down_admin_pm`, suspension notices, etc.) — the journey verifies recipients see them with the official badge and that the PM is unblockable
- **Used by**: j04 (Hayato gets age-down PM), j11 (Raul/Nora get suspension PMs), j18

---

## Persona-to-journey coverage matrix

| Persona | j01 | j02 | j03 | j04 | j05 | j06 | j07 | j08 | j09 | j10 | j11 | j12 | j13 | j14 | j15 | j16 | j17 | j18 |
|---------|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|
| P-01 Adam | ✓ |   |   |   |   |   | ✓ |   |   |   |   |   |   |   |   |   |   |   |
| P-02 Alice | ✓ |   |   |   | ✓ | ✓ | ✓ |   |   |   |   |   | ✓ |   |   |   |   |   |
| P-03 Mia |   | ✓ |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
| P-04 Marcus |   | ✓ |   |   |   |   |   | ✓ |   |   |   |   |   |   |   |   |   |   |
| P-05 Lena |   |   | ✓ |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
| P-06 Hayato |   |   |   | ✓ |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
| P-07 Vexa |   |   |   |   |   |   |   | ✓ |   |   |   |   |   |   |   |   |   |   |
| P-08 Raul |   |   |   |   |   |   |   |   |   |   | ✓ |   |   |   |   |   |   |   |
| P-09 Nora |   |   |   |   |   |   |   |   |   |   | ✓ |   |   |   |   |   |   |   |
| P-10 Theo |   |   |   |   |   |   |   |   | ✓ | ✓ |   |   |   |   |   |   |   |   |
| P-11 Ines |   |   |   |   |   |   |   |   |   | ✓ |   |   |   | ✓ |   |   |   |   |
| P-12 Greta |   |   |   | ✓ |   |   |   |   |   |   | ✓ | ✓ |   |   |   |   |   |   |
| P-13 Layla |   |   |   |   |   |   |   |   |   |   |   |   | ✓ |   |   |   |   |   |
| P-14 Kenji |   |   |   |   |   |   |   |   |   |   |   |   | ✓ |   |   |   |   |   |
| P-15 Selma |   |   |   |   |   |   |   |   |   |   |   |   |   |   | ✓ | ✓ |   |   |
| P-16 Tariq |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   | ✓ |   |   |
| P-17 Bao |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   | ✓ |   |
| P-18 Yuki |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   | ✓ |   |
| P-19 Officia |   |   |   | ✓ |   |   |   |   |   |   | ✓ |   |   |   |   |   |   | ✓ |

## Cross-platform handoff coverage matrix

Each journey declares which platforms participate. A journey is incomplete unless every participating platform makes at least one assertion.

| Journey | Android | iOS Sim | Web | Web Admin |
|---------|---------|---------|-----|-----------|
| j01 Adam day-one | host | (parity ck) | login link | approve sub |
| j02 Mia restricted | parity | host | — | — |
| j03 Lena lapsed | — | — | host | — |
| j04 Hayato flip | host | — | — | host |
| j05 Alice monetize | parity | — | host | — |
| j06 IAP failure | host | — | — | — |
| j07 Discovery+PM | Adam | — | Alice | — |
| j08 Cross-cohort | Vexa, Marcus | — | Vexa | — |
| j09 Voice host | Theo | Joiner | Joiner | — |
| j10 Mid-room warn | Theo | Ines | — | Greta |
| j11 Moderation | Raul | Nora | — | Greta |
| j12 Admin routine | — | — | — | Greta |
| j13 Locales | parity | parity | host | — |
| j14 Low-bandwidth | — | Ines | Ines | — |
| j15 MC perf | Selma | fans | fans | — |
| j16 Event host | Tariq, MCs | — | Tariq scheduling | — |
| j17 Teacher | Bao parity | Yuki | Bao | — |
| j18 Official PMs | recipient | recipient | recipient | — |
