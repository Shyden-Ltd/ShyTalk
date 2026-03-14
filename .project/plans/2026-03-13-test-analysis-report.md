# Test Analysis Report

**Date:** 2026-03-13
**Status:** Complete

## Overview

Static analysis of all 4 test suites: Kotlin unit tests, Android E2E, Express API, Playwright web tests.

---

## Express API Tests

**Coverage: ~43% of endpoints tested (56/130)**

### Duplicates (3)
1. Auth middleware suspension tests overlap between `auth.test.js` and `auth-identity.test.js`
2. POST /users creation tested redundantly in `identity.test.js` and `users.test.js`
3. System message tests in `admin-system-messages.test.js` overlap with individual route tests

### Critical Gaps
1. **economy.js** — gacha, gift, purchase, redeem-beans (0 tests for money-handling)
2. **reports.js** — 12/14 endpoints untested (entire report lifecycle)
3. **admin-users.js** — 13/17 endpoints untested (warnings, GCS, suspend)
4. **admin-cleanup.js** — 23 data-destructive endpoints, zero tests
5. **admin-backup.js** — backup/restore endpoints, zero tests
6. **storage.js** — DELETE endpoint untested (ownership check)
7. **Systematic gap**: zero 500 error tests across entire suite
8. **Rate limiter**: zero 429 tests anywhere

### Untested Route Files (7)
- banners.js (7 endpoints)
- fun-facts.js (5 endpoints)
- admin-backup.js (6 endpoints)
- admin-cleanup.js (23 endpoints)
- admin-gifts.js (3 endpoints)
- admin-migrate.js (1 endpoint)
- test-helpers.js (4 endpoints)

### Untested Cron Jobs (6)
- archiveReports.js, backpackCleanup.js, closedRooms.js
- orphanedStorage.js, subscriptions.js, testDataCleanup.js

---

## Android E2E Tests

### Duplicates (9 instances across 5 files)
1. Wallet balance assertion duplicated in GachaOverlayTest + WalletAndTransactionsTest
2. Bottom tab navigation overlap: NavigationSmokeTest + PrivateMessagingTest
3. Profile tab overlap: NavigationSmokeTest + ProfileTest
4. Settings button overlap: NavigationSmokeTest + SettingsNavigationTest
5. Follow list tab overlap: ProfileTest + FollowListJourneyTest
6. Private chat element tests redundant with journey test
7. Warning screen overlap: AuthFlowTest + WarningAcknowledgmentTest
8. AuthFlowTest teardown redundant (Before already resets state)
9. AuthFlowTest.signIn_suspended is a false test (wrong assertions)

### Screens with Zero Coverage (10)
- RequiredDOB, Splash, GroupChat, ReportReview, Browser
- UnsafeDeviceScreen, ForceUpdateScreen, DegradedModeScreen, SuspensionScreen, BanScreen

### Screens with Partial Coverage (8)
- ProfileSetup (no form submission), LegalAcceptance (no accept action)
- Room (no seat/chat/backpack interactions), PrivateChat (no send message)
- NewMessage (no search/select), Wallet (no purchase UI)
- IdentityFlow (routing never exercised), Settings (language/notifications untested)

---

## Playwright Web Tests

### Duplicates (4, all low priority)
1. Viewport meta tag tested 5 times across 3 files
2. "Page is not empty" redundant when content also asserted
3. Footer link visibility duplicated in 2 files
4. Privacy link click navigation duplicated

### Gaps
1. **High**: docs/ legal HTML files — zero coverage
2. **High**: Admin panel authenticated tabs — zero functional coverage
3. **Medium**: Login error state never triggered
4. **Medium**: Landing page i18n substitution never verified
5. **Medium**: Play Store link href/rel not asserted
6. **Low**: Legal page footer cross-links, "Last updated" dates, responsive testing

---

## Kotlin Unit Tests

### Duplicates (5)
1. `init signs out persisted session` — tested in both AuthViewModelTest + AuthViewModelIdentityTest
2. `device locked to different user` — tested in both auth test files
3. `identity resolution error → backend unreachable` — tested in both auth test files
4. `resolveRole` (OWNER/HOST/ATTENDEE) — tested in ChatRoomTest + ChatRoomFromMapTest
5. UiState default assertions (HomeUiStateTest, GachaUiStateTest, WalletUiStateTest) overlap with ViewModel tests

### Critical Gaps
1. **FunFactSplashViewModel** — zero tests, complex init with 3 parallel coroutines
2. **BannerRepositoryImpl** — zero tests, date-window filtering logic (start/end date)
3. **GiftRepositoryImpl** — empty placeholder test file, sendGift/claimFromBackpack untested
4. **Conversation** business methods — `otherUserId()`, `generateId()` commutativity, `roleOf()`, `isAdmin()`/`isMod()` untested

### Important Gaps
5. **EconomyConfig.milestoneRewards** parsing + MilestoneReward.fromMap
6. **RoomViewModel** seat operation error paths (requestSeat, kickUser, moveSeat failures)
7. **AppSettingsViewModel** linkProvider/unlinkProvider error paths
8. **ProfileViewModel.createProfile** age gating at boundary
9. **PrivateMessageRepositoryImpl** media send with orphan-on-API-failure

---

## Summary Statistics

| Suite | Duplicates | Critical Gaps | Important Gaps | Low Gaps |
|-------|-----------|--------------|----------------|---------|
| Express API | 3 | 8 | 7 untested route files, 6 untested crons | 8 utils |
| Android E2E | 9 | 10 screens untest | 8 screens partial | — |
| Playwright | 4 | 2 | 3 | 5 |
| Kotlin Unit | 5 | 4 | 5 | 3 |
| **Total** | **21** | **24** | **16+** | **16** |

## Priority Ranking for Fixes

### Tier 1 — Money & Security (fix first)
- Express economy.js: gacha, gift, purchase, redeem-beans tests
- Express reports.js: report lifecycle tests
- Express admin-cleanup.js: destructive operation tests
- Kotlin GiftRepositoryImpl: sendGift/claimFromBackpack tests
- Kotlin BannerRepositoryImpl: date-window filtering tests

### Tier 2 — Core Features
- E2E: GroupChat, Room interactions, PrivateChat send message
- E2E: RequiredDOB, Splash, ProfileSetup form submission
- Kotlin: FunFactSplashViewModel, Conversation business methods
- Kotlin: RoomViewModel seat error paths
- Express: admin-users.js warnings/suspend, storage.js DELETE

### Tier 3 — Admin & Infrastructure
- Express: banners.js, fun-facts.js, admin-gifts.js, admin-backup.js
- Express: cron jobs (archiveReports, closedRooms, orphanedStorage, subscriptions)
- Playwright: admin panel authenticated tabs, i18n verification
- E2E: SuspensionScreen, BanScreen, ForceUpdateScreen

### Tier 4 — Polish
- Remove all 21 duplicate tests
- Express: systematic 500 error tests, rate limiter 429 tests
- Playwright: responsive testing, footer cross-links
- Kotlin: MilestoneReward, StickerStorage LRU, Conversation.generateId commutativity
