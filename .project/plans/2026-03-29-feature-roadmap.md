# ShyTalk Feature Roadmap

_Prioritised 2026-04-19 (revised)_

> **Tri-platform policy (2026-04-19):** All work must keep desktop (web), iOS, and Android in
> sync. No platform can fall behind. iOS build fix and parity are the immediate next priority.
> Every future feature must ship on all applicable platforms simultaneously.

---

## Phase 0 — Infrastructure & Code Health (do first)

These enable everything else. SonarCloud blocks all future PRs. Allure gives visibility. Legal
branding is quick and overdue. Phase 0 is internal infrastructure and not shown on the public
roadmap — user-facing web features previously listed here have moved to Phase 6.

| #   | Feature                                                                                                                                                                                          | Effort | Status                                                        |
|-----|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------|---------------------------------------------------------------|
| 36  | **Fix all SonarCloud issues on main** — 500+ issues, must be clean before quality gate blocks PRs                                                                                                | Medium | DONE (PR #223, 2026-03-30) — 400+ fixed, quality gate passing |
| 37  | **Allure report directory structure** — per-suite, per-environment, landing page. See `2026-03-29-allure-directory-spec.md`                                                                      | Medium | DONE (PR #241, 2026-03-31)                                    |
| 35  | **Legal docs: Shyden Ltd branding** — update all public docs and legal pages                                                                                                                     | Small  | DONE (PR #280, 2026-04-09)                                    |
| 40  | **CI workflow deduplication** — extract duplicated steps into reusable workflows (Firebase rules deploy, google-services decode, iOS signing, Allure report). 6+ workflows have duplicated logic | Small  | DONE (PR #282, 2026-04-09)                                    |
| 41  | **Admin panel restructure** — break 12,000+ line index.html into modular ES modules. PR A (core modules), PR B (tab extraction), PR C (wiring + cleanup)                                        | Large  | DONE (PR A #289, PR B #301, PR C #304, 2026-04-20)            |
| 51  | **Seasonal events system** — reusable date-gated theming for holidays (Khmer New Year, Diwali, etc.). Events.json registry, seasonal-theme.js, SeasonalTheme.kt, educational pages               | Medium | DONE (PR #302, 2026-04-16)                                    |
| 52  | **Khmer (km) as 20th locale** — full app translation to Khmer script (771/781 strings)                                                                                                           | Medium | DONE (PR #302, 2026-04-16)                                    |
| 53  | **Admin core module tests** — 34 Jest unit tests + 9 Playwright integration tests for PR A core modules                                                                                          | Small  | DONE (PR #290, 2026-04-13)                                    |
| B16 | **Cross-device E2E testing** — admin actions (suspension, moderation, ban cascade) performed in admin panel and verified in app on real device. Proves full pipeline end-to-end                  | Large  |                                                               |

---

## Phase 1 — Compliance & Legal (non-negotiable)

App store rejection or legal liability if missing. All features must be implemented on both Android AND iOS.

| #   | Feature                                                                                                                                                                | Effort | Status                     |
|-----|------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------|----------------------------|
| B1  | **Account deletion** — GDPR Art.17, Google Play & Apple requirement                                                                                                    | Large  | DONE (PR #218, 2026-03-29) |
| B2  | **Data export** — GDPR Art.20 data portability. See `2026-03-29-data-export-design.md`                                                                                 | Medium | DONE (PR #238, 2026-03-30) |
| 17  | **Age-based segregation** — UK OSA, adults/minors must not interact                                                                                                    | Large  |                            |
| B3  | **Room message reporting** — UK OSA, report mechanism on every UGC screen                                                                                              | Small  |                            |
| 16  | **Gambling self-exclusion** — responsible gambling regulation, irreversible opt-out                                                                                    | Medium |                            |
| B4  | **Privacy policy rewrite** — GDPR, missing data controller, lawful basis, DPO, children's section                                                                      | Medium |                            |
| 55  | **Inactive account deletion** — automated process to delete accounts inactive for extended period. Needs discussion on retention period, warnings, data handling       | Medium |                            |
| B15 | **VPN detection and blocking** — prevent VPN connections. Cascading ban system risks banning innocent users sharing VPN exit nodes                                     | Medium |                            |
| B19 | **Account sharing detection & prevention** — detect concurrent sessions from different devices/IPs/geolocations, impossible travel. Alert admin, force re-auth or lock | Large  |                            |
| B21 | **Automated content moderation** — AI-powered detection: image nudity, voice toxicity (speech-to-text), text profanity. Auto-flag or auto-action based on severity     | XL     |                            |

---

## Phase 2 — Platform Foundation

Keep Play Store billing current. Ship iOS alongside Android.

| #  | Feature                                                                     | Effort | Status |
|----|-----------------------------------------------------------------------------|--------|--------|
| B5 | **iOS build fix** — cinterop errors, iOS compilation                        | Medium | DONE (PRs #312-316, 2026-04-22) |
| B6 | **iOS app — full feature parity** — real Firebase repos, same data as Android, all screens functional | XL | IN PROGRESS — Phases 1-4 wiring done (PRs #312-322), real Firebase repos in progress |
| B7 | **Billing v7→v8** — Google Play Billing major version, deprecation deadline | Medium |        |

---

## Phase 3 — Revenue Engine

Monetisation features that fund everything else.

| #  | Feature                                                                                                   | Effort | Status |
|----|-----------------------------------------------------------------------------------------------------------|--------|--------|
| 13 | **Nobility system** — ranks from gift value sent, perks per rank                                          | Large  |        |
| 1  | **Relationships** — paid tiers (friend→partner→family), perks, seat connections                           | Large  |        |
| 7  | **Decorations** — profile decorations, avatar borders, speech bubbles, entrance effects, room backgrounds | Large  |        |

---

## Phase 4 — Core Social & Discovery

Features that drive daily active usage and retention.

| #   | Feature                                                                                                                                                     | Effort | Status |
|-----|-------------------------------------------------------------------------------------------------------------------------------------------------------------|--------|--------|
| 2   | **Posts & Stories** — social feed + ephemeral stories                                                                                                       | XL     |        |
| 3   | **User search** — discovery of met/unmet users, advanced filters behind SuperShy                                                                            | Medium |        |
| 14  | **Leaderboards** — multiple categories, daily/weekly/monthly/all-time                                                                                       | Medium |        |
| 15  | **Hall of Fame** — weekly & monthly top-up leaderboards                                                                                                     | Small  |        |
| 8   | **Room rankings** — rooms ranked by gift activity                                                                                                           | Small  |        |
| 20  | **Gift wall overhaul** — leaderboard, history, categories, full customization                                                                               | Large  |        |
| B20 | **Clans system** — user-created groups with leaders, members, ranks, shared chat, clan-level leaderboards, inter-clan competitions. Clan badges on profiles | XL     |        |

---

## Phase 5 — Quality of Life

Retention and UX improvements.

| #   | Feature                                                                                                                                     | Effort | Status |
|-----|---------------------------------------------------------------------------------------------------------------------------------------------|--------|--------|
| 12  | **Auto-translation** — real-time translation in chats, free tier + SuperShy full access                                                     | Medium |        |
| 30  | **Pin chats** — pin DMs/group chats to top of list                                                                                          | Small  |        |
| 9   | **Chat toggle** — room owners/hosts disable in-room text chat                                                                               | Small  |        |
| 18  | **Room filters** — filter rooms by language, category, activity                                                                             | Small  |        |
| 21  | **Gift wishlist** — users curate desired gifts                                                                                              | Small  |        |
| 22  | **Gift collections** — unlock special gift by completing a set                                                                              | Medium |        |
| 19  | **Announcements** — room-wide & global messages, gated behind nobility rank                                                                 | Medium |        |
| 10  | **Granular suspensions** — suspend specific features per user                                                                               | Medium |        |
| 11  | **Report reliability score** — track report accuracy per user                                                                               | Medium |        |
| B22 | **App startup redesign** — prevent login screen flash on auto-login (race condition), improve perceived startup time, better loading states | Medium |        |

---

## Phase 6 — Website & Public Presence

Public-facing website improvements and creator/admin tools.

| #  | Feature                                                                                                                                                                                                                                                 | Effort | Status                                                                                       |
|----|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------|----------------------------------------------------------------------------------------------|
| 47 | **Unified web portal** — single login page where users authenticate with their ShyTalk account. Routes to Admin panel, MC Host panel, MC Singer panel, Teacher panel, or suggestions+roadmap based on role. Must be done BEFORE admin restructure (#41) | Medium | DONE (PR #284, 2026-04-10)                                                                   |
| 38 | **Website About section** — service details, GitHub repo link, Allure test reports link, GitHub Issues for bug reporting with template + walkthrough                                                                                                    | Small  |                                                                                              |
| 34 | **Website support section** — FAQ + categorised support contact, matching in-app                                                                                                                                                                        | Medium |                                                                                              |
| 33 | **Website interactive demo** — screenshots + simulated video recordings of realistic users                                                                                                                                                              | Large  |                                                                                              |
| 39 | **Website public roadmap** — show upcoming features so users can see what's planned. Keep it high-level (no internal details), update when phases complete                                                                                              | Small  | DONE (PR #223, 2026-03-30)                                                                   |
| 48 | **Web personal profile** — full profile management on portal: avatar upload, display name, SuperShy status/purchase, coins, linked accounts, voting history, submitted suggestions. Needs its own design cycle                                          | Medium |                                                                                              |
| 46 | **Web page i18n completion** — full translations for all web pages including admin panel, legal pages. Language selector on every page                                                                                                                  | Medium | DONE (PR #325, 2026-04-23) — Khmer added to all 6 web translation files, English portal block, 15 i18n tests |
| 54 | **Portal CSS/i18n unification** — migrate portal from separate portal-translations.js + portal.css to shared language-selector.js + inline styles                                                                                                       | Small  |                                                                                              |
| 42 | **Admin role-based access control** — internal admin roles (super-admin, moderator, viewer) controlling which tools each admin can use. Store roles in Firestore, enforce server-side                                                                   | Medium |                                                                                              |
| 43 | **MC Host dedicated panel** — separate login + dashboard for MC Hosts to manage games, participants, prizes. Isolated from main admin panel                                                                                                             | Medium |                                                                                              |
| 49 | **MC Host Team Leader panel** — oversight panel for Team Leaders who manage multiple MC Hosts. View team performance, assign games/events, review MC Host activity, handle escalations                                                                  | Medium |                                                                                              |
| 44 | **MC Singer dedicated panel** — separate login + dashboard for MC Singers to manage singing sessions, rooms, competitions                                                                                                                               | Medium |                                                                                              |
| 50 | **MC Singer Team Leader panel** — oversight panel for Team Leaders who manage multiple MC Singers. View team performance, assign singing sessions, review MC Singer activity, handle escalations                                                        | Medium |                                                                                              |
| 45 | **Teacher dedicated panel** — separate login + dashboard for Teachers to manage teaching rooms, students, schedules                                                                                                                                     | Medium |                                                                                              |

---

## Phase 7 — Entertainment

Rich interactive features that differentiate ShyTalk.

| #  | Feature                                                                            | Effort | Status |
|----|------------------------------------------------------------------------------------|--------|--------|
| 4  | **Animated stickers** — temporary animated overlays on avatars in room seats       | Medium |        |
| 27 | **PK battles** — two rooms compete via gifts, winners get beans bonus              | Large  |        |
| B8 | **Video & screen sharing** — camera toggle + screen share in voice rooms           | Medium |        |
| 5  | **In-room games** — pool/billiards, ludo playable within voice rooms               | XL     |        |
| 26 | **Karaoke** — turn-taking singing, background music, audience scoring              | XL     |        |
| 28 | **Singing competitions** — MC Singer role, special rooms, time-limited             | Large  |        |
| 31 | **MC Host games** — MC Hosts design/run interactive games, participants win prizes | Large  |        |
| 6  | **Admin events** — one-time events with prizes/gifts for winners                   | Large  |        |

---

## Phase 8 — Support & Specialised

In-app support and niche room types.

| #   | Feature                                                                                                                            | Effort | Status |
|-----|------------------------------------------------------------------------------------------------------------------------------------|--------|--------|
| 25  | **Help & Support** — FAQ + categorised support contact (in-app)                                                                    | Small  |        |
| 24  | **Feedback system** — in-app feedback, complaints, appraisals                                                                      | Small  |        |
| 23  | **Feature requests** — in-app suggestion/voting system                                                                             | Small  |        |
| 29  | **Teaching rooms** — special room type for language teachers                                                                       | Medium |        |
| B13 | **Contact form** — private feedback/bug reports/safety concerns sent to admin panel. Category dropdown, optional email for replies | Small  |        |
| B14 | **Contact support page for suspended users** — suspended users need a way to reach support even when locked out                    | Small  |        |

---

## Resolved Backlog Items

Items previously in the backlog, now integrated into phases above or resolved:

| ID  | Item                            | Resolution                                         |
|-----|---------------------------------|----------------------------------------------------|
| B9  | E2E screen coverage gaps        | Integrated into ongoing testing work (Phase 0)     |
| B10 | Playwright BDD upgrade          | 141 scenarios now (Phase 0 testing)                |
| B11 | Branded sign-in (Apple browser) | Accepted as Firebase limitation — no action needed |
| B12 | Email sign-in                   | Blocked on self-hosted mail server — deferred      |
| B5  | iOS build fix                   | Moved to Phase 2 (Platform Foundation, 2026-04-23)  |
| B6  | iOS parity                      | Moved to Phase 2 (Platform Foundation, 2026-04-23)  |
| B18 | Admin panel restructure         | Duplicate of #41 — removed                         |
| B13 | Contact form                    | Moved to Phase 8                                   |
| B14 | Suspended user support          | Moved to Phase 8                                   |
| B15 | VPN detection                   | Moved to Phase 1 (safety)                          |
| B16 | Cross-device E2E testing        | Moved to Phase 0                                   |
| B19 | Account sharing detection       | Moved to Phase 1 (safety)                          |
| B20 | Clans system                    | Moved to Phase 4 (social)                          |
| B21 | Automated content moderation    | Moved to Phase 1 (safety)                          |
| B22 | App startup redesign            | Moved to Phase 5 (QoL)                             |

---

## Nice to Have (deferred — end-of-roadmap polish)

Items that are useful but not blocking. Do these only after all numbered phases are complete.

| ID | Item                                                                                               | Effort | Notes                                                                                                    |
|----|----------------------------------------------------------------------------------------------------|--------|----------------------------------------------------------------------------------------------------------|
| 32 | **OnPush CLI** — local doc generation (`onpush init/generate/clean`). CI is paid; run locally only | Small  | Moved from Phase 0 (2026-04-11) — productivity tool, not user-visible. Defer until core roadmap is done. |
