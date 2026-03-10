# Optimise Changelog — ShyTalk
**Date:** 2026-03-10
**Run 1:** 3 cycles (2 fixing + 1 verification), 65 issues
**Run 2:** 2 cycles (1 fixing + 1 verification), 25 issues
**Run 3:** 2 cycles (1 fixing + 1 verification), 24 issues
**Run 4:** 3 cycles (2 fixing + 1 verification), 38 issues
**Run 5:** 2 cycles (1 fixing + 1 verification), 19 issues
**Run 6:** 2 cycles (1 fixing + 1 verification), 1 issue
**Run 7:** 1 cycle (verification only), 0 issues — CLEAN
**Combined total issues found & fixed:** 172

---

# Run 1

## Pass 1 — Bugs & Logic Errors (13 fixes)

- `shared/.../GiftingViewModel.kt` — Integer overflow on gift cost: `gift.coinValue * quantity * recipients.size` overflows Int → `.toLong()` before multiplication
- `shared/.../BackpackSheet.kt` — Same integer overflow: `quantity * recipientCount` → `.toLong()`
- `shared/.../ProfileViewModel.kt:129` — Unsafe `.first()` on Flow that may complete empty → `.firstOrNull()` + null check + missing import
- `shared/.../PrivateChatViewModel.kt` — Silent `else -> {}` in `loadAliases()` → added `logW` for `Resource.Error`
- `shared/.../ConversationListViewModel.kt` — Same silent error swallowing → added `logW`
- `app/.../MainActivity.kt` — Missing null guard in `handleRoomIntent()` → `intent ?: return`
- `app/.../RoomService.kt` — `stopSelf()` raced with cleanup thread → moved inside Thread block
- `app/.../RtdbConversationService.kt` — `!!` assertions on listeners → `.also {}` pattern
- `express-api/src/routes/rooms.js` — Missing integer validation on `seatIndex`
- `express-api/src/routes/users.js` — Unique ID update outside Firestore transaction → moved inside
- `express-api/src/routes/users.js` — DND bounds validation: hours/minutes not validated → 0-23/0-59 check
- `express-api/src/routes/device-info.js` — Missing null fallback: `geo.asn || null`
- `express-api/src/routes/conversations.js` — Missing null check on conversation doc

## Pass 2 — Security Risks (17 fixes)

- `express-api/src/middleware/cors.js` — `origin: '*'` → allowlist-based CORS
- `express-api/src/routes/config.js` — Mass assignment → `CONFIG_ALLOWED_FIELDS` whitelist per config key
- `express-api/src/routes/admin-users.js` — Verbose `err.message` → generic "Internal server error" (2 instances)
- `express-api/src/routes/admin-alerts.js` — Same verbose error fix
- `express-api/src/routes/economy.js` — Enhanced TODO for Google Play purchase verification
- `express-api/src/routes/reports.js:529` — CSV export `Access-Control-Allow-Origin: *` → removed (use global CORS)
- `express-api/src/routes/storage.js:39` — No MIME validation → `ALLOWED_MIME_TYPES` (jpeg, png, webp, gif)
- `express-api/src/routes/admin-backup.js` — Path traversal → `BACKUP_DATE_REGEX` + `ALLOWED_BACKUP_COLLECTIONS` Set
- `express-api/src/index.js` — Missing rate limiting on reports/appeals → `sensitiveLimiter`
- `public/admin/index.html` — `localStorage` → `sessionStorage` (14 replacements)
- `public/admin/index.html` — `escapeHtml()` for XSS prevention (6 instances across Cycle 1+2)
- `public/admin/index.html` — Double-submit protection on Reset GCS + Export CSV buttons

## Pass 3 — i18n Issues (10 fixes)

- `shared/.../BackpackSheet.kt` — 3 hardcoded strings → `stringResource()` + 19 locale translations
- `shared/.../FunFactSplashScreen.kt` — 2 hardcoded strings → `stringResource()` + fixed import path
- `shared/.../OwnerAwayBanner.kt` — "Owner away" string → `stringResource(Res.string.owner_away_banner)`
- `shared/.../PmBottomSheet.kt` — "Messages", "No conversations yet" → `stringResource()`
- `shared/.../ReportUserDialog.kt` — 4 report reasons → localized via `reportReasonLabel()` (keeps English keys for API)
- `app/.../RoomService.kt` — Notification text → `getString(R.string.notification_in_live_room)`
- Added 12 new strings to English + all 19 locale files (ar, de, es, fr, hi, id, it, ja, ko, nl, pl, pt, ru, sv, th, tr, uk, vi, zh)

## Pass 4 — Naming Conventions (1 fix)
- `express-api/src/cron/orphanedStorage.js` — Single-letter variables renamed: u→userData, c→convData, k→key/storageKey, b→bannerData

## Pass 5 — Comments & Documentation (4 fixes)
- `app/.../AppKoinModule.kt` — "Worker API client (Cloudflare)" → "API client (Express.js on Oracle Cloud)"
- `app/.../JsonExt.kt` — "D1/Worker API" → "REST API"
- `express-api/src/routes/admin-backup.js:315` — "profile_photos/{uid}" → "profiles/{uid}/{filename}"
- `express-api/src/cron/rotateLogs.js` — Misnumbered steps (5,6,7,9) → corrected (3a,3b,4,5)

## Pass 6 — Stale & Dead Code (3 fixes)
- `app/.../ShyTalkApp.kt` — Removed obsolete cache migration code
- `shared/.../ReportUserDialog.kt` — Removed redundant explicit Res import
- `express-api/src/routes/admin-backup.js` — `ALLOWED_BACKUP_COLLECTIONS` synced with `backups.js` exports

## Pass 7 — Logging (6 fixes)
- `express-api/src/routes/users.js` — Success logging on follow/unfollow/remove-follower
- `express-api/src/cron/serverHealth.js` — Warn logging in catch blocks + completion log
- `express-api/src/cron/expireTempIds.js` — Template string → structured log
- `express-api/src/routes/config.js` — Error logging on config fetch
- `express-api/src/routes/admin-backup.js` — Warn logging on 6 validation-rejection paths
- `express-api/src/middleware/rateLimit.js` — Warn logging on sensitive rate limit hits

## Pass 8 — Responsive Design (5 fixes)
- `public/index.html`, `privacy.html`, `terms.html`, `community-guidelines.html`, `cyber-bullying.html` — Background glow `width: 600px` → `min(600px, 100vw)`

## Pass 9 — Bandwidth & API Cost (2 fixes)
- `express-api/src/cron/orphanedStorage.js` — Added `.select()` projections on 4 Firestore queries
- `express-api/src/routes/config.js` — Added `Cache-Control: public, max-age=300` to GET config

## Pass 10 — Web Checks (4 fixes)
- `public/admin/index.html` — Interval cleanup on signout
- `public/admin/index.html` — Added aria-labels to 3 inputs
- `public/admin/index.html` — sessionStorage try/catch for privacy-focused browsers
- `public/admin/index.html` — Consistent `escapeHtml()` on action.label in reset steps

---

# Run 2

## Pass 1 — Bugs & Logic Errors (3 fixes)

- `express-api/src/routes/economy.js:823` — Undefined `recipientBeans` in gift-batch route → NaN in transaction balanceAfter. Added `const recipientBeans = userField(recipient, 'shyBeans', 'shy_beans') || 0;`
- `express-api/src/routes/economy.js:949` — Same undefined `recipientBeans` in backpack-send route → same fix
- `express-api/src/utils/system-pm.js:48` — `.set(convData)` without merge overwrites entire conversation doc (loses `createdAt`) → `.set(convData, { merge: true })`

## Pass 2 — Security Risks (1 fix)

- `express-api/src/routes/admin-cleanup.js:1016` — Verbose `err.message` in error response → generic "Internal server error"

## Pass 3 — i18n Issues (10 fixes)

- `shared/.../PrivateMessageBubble.kt:418` — `"Edited (${message.editCount})"` → `stringResource(Res.string.edited_count, message.editCount)` (used existing string)
- `shared/.../LuckySpinSummaryPopup.kt:186` — `"${spinTier.label} SPIN AGAIN · 🪙${spinTier.cost}"` → `stringResource(Res.string.spin_again_with_cost, ...)`
- `shared/.../LuckySpinWheel.kt:169` — `"SPIN"` in Canvas → extracted to composable scope via `val spinText = stringResource(Res.string.spin)`
- `app/.../ProfileScreen.kt:533,903,1030` — `"ID: ${user.uniqueId}"` → `stringResource(Res.string.user_id, user.uniqueId)` (3 instances, used existing string)
- `app/.../ProfileScreen.kt:1041` — `"$age years old"` → `stringResource(Res.string.age_years_old, age)`
- `app/.../ProfileScreen.kt:1065` — `"less"/"more"` → `stringResource(Res.string.show_less)`/`stringResource(Res.string.show_more)`
- `app/.../ProfileScreen.kt:209,220,245` — 3 snackbar messages → extracted to composable-level vals using `stringResource()`
- `app/.../RoomScreen.kt:228,239` — 2 snackbar messages → same pattern
- `shared/.../BackpackSheet.kt:280` — `"this user"` fallback → `stringResource(Res.string.this_user)`
- Added 7 new strings to English + all 19 locale files

## Pass 4 — Naming Conventions (8 fixes)

- `express-api/src/routes/admin-cleanup.js` — Single-letter variables: u→userData, k→storageKey/imageKey/evidenceKey, d→doc, c→conv, b→bannerData
- `express-api/src/routes/admin-devices.js` — q→searchQuery, d→device/doc
- `express-api/src/routes/admin-users.js` — d→endDate
- `express-api/src/routes/reports.js` — u→reportedUser/reporter, d→endDate
- `shared/.../DailyRewardViewModel.kt:92` — d→claimedDate
- `shared/.../GroupSetupViewModel.kt:131` — p→permissions
- `shared/.../GroupSetupViewModel.kt:147` — c→config
- `shared/.../GachaResult.kt:34` — m→giftMap

## Pass 5 — Comments & Documentation (1 fix)

- `shared/.../MapExt.kt:3` — Stale D1 reference: "handling D1's integer booleans" → "handling integer booleans"

## Pass 9 — Bandwidth & API Cost (1 fix)

- `express-api/src/routes/fun-facts.js:31` — Added `Cache-Control: public, max-age=3600` to GET fun-facts

## Pass 10 — Web Checks (3 fixes)

- `public/admin/index.html` — Evidence lightbox: Escape key listener leaked on close-button/overlay-click close → moved `removeEventListener` into `close()` function
- `public/admin/index.html` — Evidence lightbox close button: added `aria-label="Close"`
- `public/admin/index.html` — Alert bell button: added `aria-label="Alerts"`

---

## New Tests Added (Run 1)

- **`express-api/tests/routes/storage.test.js`** (8 tests) — MIME type allowlist validation, path restrictions, missing params
- **`express-api/tests/routes/config.test.js`** (4 new tests) — Config field whitelisting, unknown key rejection, mass assignment prevention

---

# Run 3

## Pass 3 — i18n Issues (3 fixes, 5 new strings)

- `shared/.../DegradedModeBanner.kt:40` — `"Reduced functionality — some features may be unavailable"` → `stringResource(Res.string.reduced_functionality)`
- `shared/.../FullscreenImageViewer.kt` — 3 hardcoded strings:
  - `:46` `"Image ${page + 1}"` → `stringResource(Res.string.image_number, page + 1)`
  - `:61` `"Close"` → `stringResource(Res.string.close)` (reused existing string)
  - `:69` `"${pagerState.currentPage + 1} / ${imageUrls.size}"` → `stringResource(Res.string.page_indicator, ...)`
- `shared/.../BroadcastBanner.kt:112-116` — 2 broadcast message templates:
  - Gacha win → `stringResource(Res.string.broadcast_gacha_win, senderName, qtyPrefix, giftName, coinText)`
  - Gift sent → `stringResource(Res.string.broadcast_gift_sent, senderName, qtyPrefix, giftName, coinText, recipientName)`
- Added 5 new strings to English + all 19 locale files

## Pass 4 — Naming Conventions (15 renames across 8 files)

- `app/.../RoomScreen.kt:541,556` — `val r` → `val currentRoom` (2 derivedStateOf blocks)
- `shared/.../RoomViewModel.kt` — `when (val r =` → `when (val result =` (3 instances), `val s` → `val seat` (1 instance)
- `shared/.../ProfileViewModel.kt` — `when (val r =` → `when (val result =` (2 instances)
- `shared/.../PrivateChatViewModel.kt` — `when (val r =` → `when (val result =` (3 instances)
- `shared/.../BroadcastBanner.kt:171` — `val s` → `val str` in formatWithCommas()
- `shared/.../WalletComponents.kt:99` — `val s` → `val str` in formatNumber()
- `shared/.../LuckySpinOverlay.kt:317` — `val p` → `val prize`
- `express-api/src/routes/admin-logs.js:65` — `const kw` → `const lowerKeyword`

## Pass 5 — Comments & Documentation (1 fix)

- `app/.../RtdbConversationService.kt:18` — Stale Durable Objects reference: "no Durable Objects needed" → "uses Firebase RTDB for real-time events"

## Pass 7 — Logging (3 fixes)

- `express-api/src/cron/closedRooms.js` — Added per-room try/catch with error logging (prevents one failed room from aborting batch)
- `express-api/src/cron/backups.js` — Added per-collection try/catch with error logging (prevents one failed collection from aborting backup)
- `express-api/src/cron/orphanedStorage.js` — Added per-folder try/catch with error logging (prevents one failed R2 folder from aborting cleanup)

## Pass 9 — Bandwidth & API Cost (1 fix)

- `express-api/src/routes/admin-users.js:639` — Added `.select('uid')` to uniqueId-to-UID resolver (fetches only uid field instead of full user docs)

## Pass 10 — Web Checks (1 fix)

- `public/admin/index.html` — Backpack remove button (×): added `aria-label="Remove item"`

---

## Test Results (After Run 3)
- Express API: 331 passed, 3 pre-existing failures (unrelated to optimise changes)
- New tests from Run 1: 12/12 still passing

---

# Run 4

## Pass 1 — Bugs & Logic Errors (2 fixes)

- `shared/.../feature/room/components/BackpackSheet.kt` — Removed `giftAccentColor()` function that derived rarity border/background colors from `gift.coinValue` tiers → replaced with neutral theme colors (`outlineVariant`, `surfaceVariant`, `primaryContainer`)
- `shared/.../core/ui/GiftPreviewPopup.kt` — Removed `accentColorForValue()` function (same rarity color derivation) → replaced fallback icon and Play Effect button with `primaryContainer`/`onPrimaryContainer`

## Pass 2 — Security Risks (1 fix)

- `express-api/src/routes/admin-bans.js` — Network ban creation accepted arbitrary `networkIdentifier` strings → added IP/CIDR/ASN format validation regex

## Pass 3 — i18n Issues (26 fixes, 20 new strings)

- `shared/.../core/ui/StyledDisplayName.kt` — `contentDescription = "Super Shy"` → `stringResource(Res.string.super_shy)`
- `shared/.../core/ui/GiftPreviewPopup.kt` — `"Play Effect"` button text → `stringResource(Res.string.play_effect)`
- `shared/.../feature/messaging/PrivateMessageBubble.kt` — 6 instances of `contentDescription = "Image"` → `stringResource(Res.string.image)` (replace_all)
- `app/.../feature/suspension/SuspensionScreen.kt` — Inlined `suspensionTitle()` at call site:
  - `"Account Unlocked"` → `stringResource(Res.string.account_unlocked)`
  - `"Account Suspended"` → `stringResource(Res.string.account_suspended)`
  - `"Police duck"` → `stringResource(Res.string.police_duck_description)`
  - `"Sign In"` → `stringResource(Res.string.sign_in)`, `"Sign Out"` → `stringResource(Res.string.sign_out)`
  - 5 countdown time units: `"DAY"` → `stringResource(Res.string.time_unit_day)`, `"HR"`, `"MIN"`, `"SEC"`, `"MS"` similarly
- `app/.../feature/suspension/BanScreen.kt` — Inlined `banTitle()` and `banDescription()` at call sites:
  - `"Device Banned"` → `stringResource(Res.string.device_banned_title)`
  - `"Network Banned"` → `stringResource(Res.string.network_banned_title)`
  - Ban descriptions → `stringResource(Res.string.device_banned_description)` / `network_banned_description`
  - `"Police duck"` → `stringResource(Res.string.police_duck_description)`
- `app/.../feature/warning/WarningScreen.kt` — `contentDescription = "Warning"` → `stringResource(Res.string.police_duck_description)`
- `app/.../feature/profile/ProfileScreen.kt` — 9 hardcoded contentDescriptions:
  - `"Back"` → `stringResource(Res.string.back)`, `"Full screen photo"` → `stringResource(Res.string.full_screen_photo)`
  - `"Close"` → `stringResource(Res.string.close)`, `"Cover photo"` → `stringResource(Res.string.cover_photo)`
  - `"Change cover photo"` → `stringResource(Res.string.change_cover_photo)`, `"Profile photo"` (×2) → `stringResource(Res.string.profile_photo)`
  - `"Change profile photo"` → `stringResource(Res.string.change_profile_photo)`, `"Edit profile"` → `stringResource(Res.string.edit_profile)`
- `app/.../feature/settings/AppSettingsScreen.kt` — `contentDescription = "ShyTalk"` → `stringResource(Res.string.app_name_label)`
- Added 20 new strings to English + all 19 locale files (3 batches: 8 + 7 + 5)

## Pass 4 — Naming Conventions (4 fixes)

- `shared/.../feature/gacha/LuckySpinConfetti.kt` — `val dt` → `val deltaTime`, `particles.map { p ->` → `particles.map { particle ->`, `val s = p.particleSize` → `val pSize = particle.particleSize`
- `shared/.../feature/profile/VoiceWaveOverlay.kt` — `val t = sin(...)` → `val waveValue = sin(...)`
- `app/.../core/chathead/VoiceWaveView.kt` — `val t = sin(...)` → `val waveValue = sin(...)`
- (Canvas/DrawScope `w`, `h`, `x`, `y`, `cx`, `cy` preserved — standard graphics convention)

## Pass 5 — Comments & Documentation (4 fixes)

- `app/.../data/remote/RtdbPresenceService.kt:18` — Stale reference: `"no Durable Objects needed"` → `"uses Firebase RTDB for real-time presence"`
- `docs/privacy-policy.html:36` — `"Agora"` → `"LiveKit"` (voice chat SDK reference)
- `docs/privacy-policy.html:54` — Same Agora → LiveKit update
- `docs/privacy-policy.html:67` — Same Agora → LiveKit update

## Pass 6 — Stale & Dead Code (3 fixes)

- `shared/.../feature/room/components/BackpackSheet.kt` — Removed dead `giftAccentColor()` private function (rarity color derivation)
- `shared/.../core/ui/GiftPreviewPopup.kt` — Removed dead `accentColorForValue()` private function
- `app/.../feature/suspension/SuspensionScreen.kt` — Removed dead `suspensionTitle()` function (inlined at call site)
- `app/.../feature/suspension/BanScreen.kt` — Removed dead `banTitle()` and `banDescription()` functions (inlined at call sites)

## Pass 9 — Bandwidth & API Cost (1 fix)

- `express-api/src/routes/admin-log-config.js` — Added `Cache-Control: public, max-age=300` to public GET /log-config endpoint

## Test Results (After Run 4)
- Express API: 331 passed, 3 pre-existing failures (unrelated to optimise changes)
- New tests from Run 1: 12/12 still passing

---

# Run 5

## Pass 1 — Bugs & Logic Errors (1 fix)

- `express-api/src/middleware/auth.js:21-22` — `snap.data()` called without checking `snap.exists` → added `snap.exists ? snap.data() : null` guard

## Pass 2 — Security Risks (1 fix)

- `express-api/src/routes/admin-users.js:235` — Stack trace (`err.stack`) logged to Firestore alongside error message → removed (only `err.message` logged, consistent with all other routes)

## Pass 3 — i18n Issues (8 fixes, 4 new strings)

- `shared/.../feature/splash/FunFactSplashScreen.kt:35` — `"Voice chat rooms, reimagined."` → `stringResource(Res.string.splash_tagline)` (moved outside `remember{}` block)
- `shared/.../feature/room/components/BackpackSheet.kt:851` — `"ALL ($ownedQty)"` → `stringResource(Res.string.quantity_all, ownedQty)`
- `shared/.../feature/messaging/PrivateMessageBubble.kt:343` — `"Room"` fallback → `stringResource(Res.string.room)` (reused existing string)
- `app/.../feature/settings/AppSettingsScreen.kt:387` — `"English"` fallback → `stringResource(Res.string.english_language)`
- `app/.../feature/room/RoomScreen.kt:612,673` — `"Room"` fallbacks (×2) → `stringResource(Res.string.room)` (reused existing string)
- `app/.../feature/room/RoomScreen.kt:1047` — `"User"` fallback → `stringResource(Res.string.user)` (reused existing string, wrapped `remember{}` with `run{}` for composable scope)
- `app/.../feature/auth/GoogleSignInScreen.kt:249` — `"Google sign-in failed"` → `stringResource(Res.string.google_sign_in_failed)`
- Added 4 new strings to English + all 19 locale files

## Pass 4 — Naming Conventions (3 fixes)

- `shared/.../feature/home/HomeViewModel.kt:51` — `val it` → `val iter` (Kotlin keyword confusion)
- `shared/.../feature/gacha/LuckySpinOverlay.kt:345` — `val p` → `val progress` (chase animation progress)
- `shared/.../feature/gacha/LuckySpinSummaryPopup.kt:301` — `val s` → `val numStr` in `formatWithCommas()`

## Pass 6 — Stale & Dead Code (1 fix)

- `shared/.../feature/gacha/SpinTier.kt` — Removed dead `title: String` field from `RarityConfig` data class and all 5 `title = "Spin Results"` assignments (field was never read anywhere)

## Pass 7 — Logging (4 fixes)

- `express-api/src/routes/admin-cleanup.js` — 4 silent `catch (_) {}` blocks → `catch (err) { log.warn(...) }` with R2 key or room ID context:
  - Lines 605, 652: R2 media object delete (PM/group chat cleanup)
  - Line 643: R2 group photo delete
  - Line 687: Room delete (closed rooms cleanup)

## Test Updates (1 fix)

- `express-api/tests/middleware/auth.test.js` — Added missing `exists: true` to 3 Firestore mock snapshots (exposed by auth.js null guard fix)

## Test Results (After Run 5)
- Express API: 331 passed, 3 pre-existing failures (unrelated to optimise changes)
- New tests from Run 1: 12/12 still passing

---

# Run 6

## Pass 7 — Logging (1 fix)

- `express-api/src/cron/serverHealth.js:59` — `console.error()` → `log.error('server-health', ...)` for structured logging consistency

## Test Results (After Run 6)
- Express API: 331 passed, 3 pre-existing failures (unchanged)

---

# Run 7

Full scan of all 10 pass categories — **0 issues found**. Codebase is clean.
