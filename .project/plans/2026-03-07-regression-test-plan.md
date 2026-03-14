# ShyTalk Regression Test Plan — Logging, Monitoring & Device Management

**Version:** 1.0
**Date:** 2026-03-07
**Scope:** Full regression covering new logging/monitoring features + existing functionality

---

## 1. Express API Tests (Automated — 117 tests)

Run: `cd express-api && npm test`

| Suite | Tests | Description |
|-------|-------|-------------|
| logger.test.js | 11 | Logger writes to Firestore, sanitizes sensitive fields, respects quota |
| requestLogger.test.js | 14 | Middleware generates trace IDs, logs request/response, assigns correct levels |
| logs.test.js | 8 | POST /api/logs ingestion (single, batch, validation) |
| admin-logs.test.js | 5 | GET /admin/logs (filters, pagination, trace view) |
| admin-log-config.test.js | 9 | GET/PATCH /admin/log-config (retrieval, update, defaults) |
| rotateLogs.test.js | 6 | Hourly log rotation cron (Firestore → R2, pruning) |
| device-info.test.js | 8 | POST /api/device-info (enrichment, ban check, CIDR matching) |
| admin-bans.test.js | 14 | Device/network ban CRUD, bulk unban, auto-apply |
| expireBans.test.js | 4 | Ban expiry cron (remove expired, FCM notification) |
| alertManager.test.js | 9 | Alert creation, error spike detection, slow endpoint tracking |
| admin-alerts.test.js | 9 | Alert listing, acknowledge, resolve, config |
| serverHealth.test.js | 2 | Memory usage alerting |
| backups.test.js | 7 | Full database backup (15 collections + subcollections) |
| admin-devices.test.js | 11 | Device bindings list, search, get, unbind |

---

## 2. Android/KMP Unit Tests (Automated)

Run: `./gradlew :app:test`

### New tests added:
| Test Class | Tests | Description |
|-----------|-------|-------------|
| TraceManagerTest | 3 | Session trace ID generation, stability, UUID format |
| LoggerTest | 6 | logD/logI/logW/logE/logF don't throw |
| LogServiceTest | 3 | LogEntry, BatchSettings, LogConfig data class defaults |
| DeviceInfoCollectorTest | 3 | DeviceInfo construction, nullable fields, copy |
| WorkerApiClientTraceTest | 2 | Trace ID availability and consistency |
| AuthViewModelBanTest | 7 | Device ban, network ban, no ban, lenient errors, sign-out |
| BanScreenTest | 4 | banTitle and banDescription helper functions |
| DeviceRepositoryImplTest | 4 | checkBanStatus (not banned, device ban, network ban, error) |

### Existing tests (must still pass):
- ~96 test classes covering ViewModels, repositories, models, utilities

---

## 3. Admin Panel — Manual Testing

### 3.1 Logs Tab
| # | Test Case | Steps | Expected Result |
|---|-----------|-------|----------------|
| 1 | Tab loads | Click "Logs" tab | Logs table, filters, quota widget visible |
| 2 | Load logs | Wait for initial load | Logs appear in table with level, source, timestamp, message |
| 3 | Filter by level | Select "ERROR" from level filter | Only ERROR logs shown |
| 4 | Filter by source | Select "express-api" from source filter | Only Express API logs shown |
| 5 | Search keyword | Type "auth" in keyword field, click Search | Logs containing "auth" shown |
| 6 | Date range | Set start/end time, click Search | Only logs in range shown |
| 7 | Filter by userId | Enter a userId, click Search | Logs for that user only |
| 8 | Pagination | Click Next Page | Next page of logs loads |
| 9 | Trace view | Click a trace ID in the table | Timeline view opens showing all logs for that trace |
| 10 | Live mode | Toggle "Live" switch | New logs appear automatically without refresh |
| 11 | Stop live mode | Toggle "Live" off | Logs stop streaming |
| 12 | Export JSON | Click "Export JSON" | JSON file downloads with current filtered logs |
| 13 | Export CSV | Click "Export CSV" | CSV file downloads |
| 14 | Alerts section | Check alerts panel | Unresolved alerts listed with type, message, timestamp |
| 15 | Acknowledge alert | Click "Ack" on an alert | Alert status changes to "acknowledged" |
| 16 | Resolve alert | Click "Resolve" on an alert | Alert status changes to "resolved" |
| 17 | Alert bell | Check top-right bell icon | Badge shows count of unresolved alerts |
| 18 | Quota widget | Check quota section | Shows daily log count, hard cap, percentage used |
| 19 | Log settings | Open settings panel | Shows log levels per source, retention, batch settings |
| 20 | Update settings | Change a log level, click Save | Setting saved, success message shown |

### 3.2 Device Bindings Tab
| # | Test Case | Steps | Expected Result |
|---|-----------|-------|----------------|
| 21 | Tab loads | Click "Devices" tab | Device list table visible |
| 22 | List devices | Wait for load | Devices shown with ID, User, Model, OS, IP, ISP, Country, Last Seen |
| 23 | Search devices | Type a model name, press Enter | Filtered results shown |
| 24 | Search by IP | Type an IP address, press Enter | Matching devices shown |
| 25 | Device detail | Click a device row | Expanded row shows full device details |
| 26 | Unbind device | Click "Unbind" on a device | Confirmation prompt, device removed from list |
| 27 | Ban device | Click "Ban" on a device | Ban dialog, device added to device bans |
| 28 | Ban network | Click "Ban Net" on a device | Ban dialog, IP added to network bans |
| 29 | View logs | Click "Logs" on a device | Switches to Logs tab filtered by that user |
| 30 | Pagination | Scroll or click next | More devices load |

### 3.3 Users Tab — Bans & Restrictions
| # | Test Case | Steps | Expected Result |
|---|-----------|-------|----------------|
| 31 | Load user | Search for a user in Users tab | User details load including Bans & Restrictions section |
| 32 | View device bans | Check device bans panel | Lists any device bans for this user |
| 33 | View network bans | Check network bans panel | Lists any network bans for this user |
| 34 | View bound devices | Check devices panel | Lists all devices bound to this user |
| 35 | Ban all devices | Click "Ban All Devices" | All user's devices get banned |
| 36 | Ban last IP | Click "Ban Last IP" | User's last known IP gets banned |
| 37 | Unban all | Click "Unban All" | All bans for user removed |
| 38 | View user logs | Click "View Logs" | Switches to Logs tab filtered by userId |

---

## 4. Android App — Manual Testing

### 4.1 Ban Screen
| # | Test Case | Steps | Expected Result |
|---|-----------|-------|----------------|
| 39 | Device ban | Ban device via admin panel, open app | Ban screen shows "Device Banned", reason, expiry |
| 40 | Network ban | Ban network via admin panel, open app on same network | Ban screen shows "Network Restricted", reason |
| 41 | No ban | Open app normally (no bans) | App loads normally, no ban screen |
| 42 | Ban sign out | On ban screen, tap "Sign Out" | Returns to sign-in screen |
| 43 | Expired ban | Wait for temporary ban to expire, reopen app | App loads normally |
| 44 | Ban screen support email | Check ban screen | Support email shown |

### 4.2 Logging
| # | Test Case | Steps | Expected Result |
|---|-----------|-------|----------------|
| 45 | Auth logging | Sign in, check admin Logs tab | See INFO logs for auth flow |
| 46 | Room logging | Join a room, check logs | See INFO logs for room join |
| 47 | Message logging | Send a private message, check logs | See INFO log for message send |
| 48 | Error logging | Trigger an error (e.g., network off), check logs | See ERROR logs |
| 49 | Trace ID header | Check admin logs for mobile requests | `sessionTraceId` present in log context |
| 50 | Trace correlation | Filter by sessionTraceId in admin panel | All logs from same app session shown |

### 4.3 Existing Functionality (Regression)
| # | Test Case | Steps | Expected Result |
|---|-----------|-------|----------------|
| 51 | Sign in (Google) | Tap Google Sign-In | Signs in successfully |
| 52 | Sign in (Apple) | Tap Apple Sign-In | Signs in successfully |
| 53 | Profile creation | New user completes profile setup | Profile saved, navigates to home |
| 54 | Profile edit | Edit display name, save | Name updated |
| 55 | Photo upload | Change profile photo | Photo uploads to R2, displays correctly |
| 56 | Cover photo | Change cover photo | Cover photo uploads and displays |
| 57 | Room list | Open home screen | Room list loads, banner carousel visible |
| 58 | Create room | Create a new room | Room created, owner seated |
| 59 | Join room | Join an existing room | User joins as listener |
| 60 | Voice chat | Request and take a seat | Voice works, speaking indicators animate |
| 61 | Room chat | Send message in room | Message appears for all participants |
| 62 | Leave room | Leave the room | Returns to home, room list refreshes |
| 63 | Private messages | Send a private message | Message delivered, conversation appears |
| 64 | Group chat | Create group, send message | Group works with admin/mod permissions |
| 65 | Typing indicators | Type in a conversation | Typing indicator shows for other user |
| 66 | Daily rewards | Open daily reward dialog | Reward claimed, streak tracked |
| 67 | Lucky Spin | Spin the gacha wheel | Prize awarded, backpack updated |
| 68 | Send gift | Send a gift in a room | Gift effect plays, coins deducted |
| 69 | Gift wall | Check user's gift wall | Gifts displayed correctly |
| 70 | Wallet | Check wallet screen | Balance, transactions shown |
| 71 | Follow/unfollow | Follow a user | Following count updated |
| 72 | Block user | Block a user | User blocked across app |
| 73 | Report user | File a report | Report submitted |
| 74 | Settings | Open app settings | All settings accessible |
| 75 | Suspension screen | Suspend via admin, open app | Suspension screen with countdown |
| 76 | Warning screen | Issue warning via admin, open app | Warning acknowledgment screen |
| 77 | Device binding | Sign in on new device | Device bound to user |
| 78 | Device lock | Try second account on bound device | Device locked screen shown |
| 79 | Legal acceptance | New legal version | Legal acceptance screen shown |
| 80 | Force update | Set min version higher than current | Force update screen shown |
| 81 | Stickers | Send sticker in chat | Sticker renders correctly |
| 82 | Chathead | Leave room screen with active call | Floating chathead appears |
| 83 | Splash screen | Open app | Fun fact shown on splash |
| 84 | Sign out | Sign out | Returns to sign-in, state cleared |

---

## 5. Webpage Logger — Manual Testing

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|----------------|
| 85 | Landing page init | Open landing page, check console | "ShyTalkLogger initialized" in console |
| 86 | Error tracking | Force a JS error on landing page | Error logged to POST /api/logs |
| 87 | Click tracking | Click an element with `data-log` attribute | Click event logged |
| 88 | Admin panel init | Open admin panel | Logger initializes with "admin-panel" source |
| 89 | Fetch interception | Admin panel makes API call | Fetch logged to POST /api/logs |
| 90 | Privacy page | Open privacy.html | Logger initializes, page renders correctly |
| 91 | Terms page | Open terms.html | Logger initializes, page renders correctly |

---

## 6. Cron Jobs — Manual Verification

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|----------------|
| 92 | Log rotation | Wait for hourly cron, check R2 `logs/` prefix | NDJSON archive file created |
| 93 | R2 pruning | Check R2 for >90-day logs | Old archives deleted |
| 94 | Ban expiry | Create temp ban, wait for 15-min cron | Expired ban auto-removed |
| 95 | Server health | Check PM2 memory usage | Health alert created if memory > 80% |
| 96 | Full backup | Wait for 02:00 UTC daily cron | All collections backed up to R2 |

---

## 7. Firestore Security Rules

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|----------------|
| 97 | Logs — auth read | Authenticated non-admin reads /logs | Denied |
| 98 | Logs — admin read | Admin reads /logs | Allowed |
| 99 | Logs — client write | Client writes to /logs | Denied |
| 100 | Log config — auth read | Authenticated user reads /logConfig | Allowed |
| 101 | Device bans — admin read | Admin reads /deviceBans | Allowed |
| 102 | Device bans — non-admin | Non-admin reads /deviceBans | Denied |
| 103 | Network bans — admin | Admin reads /networkBans | Allowed |
| 104 | Alerts — admin | Admin reads /alerts | Allowed |
| 105 | Alert config — admin | Admin reads /alertConfig | Allowed |

---

## 8. Deployment Verification

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|----------------|
| 106 | Express API starts | SSH, `pm2 logs shytalk-api` | No errors on startup |
| 107 | Health check | `curl https://api.shytalk.shyden.co.uk/api/health` | `{"status":"ok"}` |
| 108 | Log endpoint | POST to /api/logs with valid entry | 200 OK |
| 109 | Admin panel loads | Open `https://shytalk.shyden.co.uk/admin/` | All tabs render |
| 110 | Privacy page | Open `https://shytalk.shyden.co.uk/privacy.html` | Page renders |
| 111 | Terms page | Open `https://shytalk.shyden.co.uk/terms.html` | Page renders |
| 112 | Firestore rules deployed | `npx firebase deploy --only firestore:rules` | Deploy successful |
| 113 | Android app runs | Launch installed app | App opens, sign-in works |

---

## Summary

| Category | Automated | Manual | Total |
|----------|-----------|--------|-------|
| Express API | 117 | — | 117 |
| Kotlin Unit | ~96+ | — | 96+ |
| Admin Panel | — | 38 | 38 |
| Android App | — | 46 | 46 |
| Webpage Logger | — | 7 | 7 |
| Cron Jobs | — | 5 | 5 |
| Firestore Rules | — | 9 | 9 |
| Deployment | — | 8 | 8 |
| **Total** | **213+** | **113** | **326+** |
