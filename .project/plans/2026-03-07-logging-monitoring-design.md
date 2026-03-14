# Logging, Monitoring & Device Management Design

**Date:** 2026-03-07
**Status:** Approved
**Approach:** Unified Log Ingestion Endpoint (Approach A)

## Core Principles

- **Logging is best-effort** — never breaks application functionality. All logging calls wrapped in try/catch. If Firestore is down, falls back to PM2 console logs.
- **$0 cost** — all free tiers (Firebase Spark, Cloudflare R2, Oracle Cloud Free).
- **Everything configurable** — log levels, retention, thresholds, batch settings all controllable from admin panel.

---

## 1. Log Ingestion & Storage

### Express API Changes

**New files:**
- `src/routes/logs.js` — `POST /api/logs` endpoint (accepts logs from all clients)
- `src/middleware/requestLogger.js` — Auto-logs every request/response with trace IDs, duration, sanitized bodies
- `src/utils/logger.js` — Central logger module that validates schema, applies rate limiting, writes to Firestore
- `src/cron/rotateLogs.js` — Rotates logs from Firestore to R2 based on configurable retention

### Log Ingestion Flow

```
Client (Android/iOS/Web) -> POST /api/logs -> logger.js validates & throttles -> Firestore `logs` collection
Express middleware -> logger.js -> Firestore `logs` collection
Cron (configurable interval) -> reads expired logs -> writes NDJSON to R2 -> deletes from Firestore
```

### Firestore Collections

- `logs` — live log entries
- `logConfig` — single doc with configurable settings:
  - `retentionHours` (default 48)
  - `levelPerSource` (e.g., `{ "express-api": "INFO", "android": "WARN" }`)
  - `excludedRoutes` (e.g., `["/api/health"]`)
  - `hardCapDaily` (e.g., 15000)
  - `batchSettings` (mobile interval, Wi-Fi-only toggle)

### Log Entry Schema

```json
{
  "id": "auto-generated",
  "timestamp": "2026-03-07T14:23:01.456Z",
  "level": "ERROR",
  "source": "express-api | android | ios | admin-panel | landing-page",
  "sessionTraceId": "client-generated-uuid",
  "requestTraceId": "server-generated-uuid",
  "userId": "abc123",
  "deviceId": "device-xyz",
  "message": "Failed to join room",
  "context": {
    "route": "/api/rooms/join",
    "roomId": "room456",
    "statusCode": 403,
    "durationMs": 120,
    "error": "User is banned from this room"
  },
  "appVersion": "0.52",
  "platform": "android | ios | web",
  "osVersion": "Android 14 | iOS 17.2"
}
```

### Quota Protection

- `logger.js` tracks daily write count in memory (reset at midnight UTC)
- When approaching hard cap: auto-escalates minimum level (drops DEBUG, then INFO)
- At hard cap: only ERROR/FATAL get through
- Quota widget reads a `logStats` doc updated by the logger

### R2 Archival

- Cron runs hourly, queries logs older than `retentionHours`
- Writes to R2 at `logs/YYYY/MM/DD/HH.ndjson`
- Deletes archived docs from Firestore
- R2 cleanup cron deletes files older than 90 days

### Request/Response Middleware

- Wraps every route automatically
- Generates `requestTraceId` (UUID v4)
- Reads `x-session-trace-id` header from clients
- Logs: method, path, status, duration, sanitized request body (strips `password`, `token`, `idToken`), response body
- Configurable exclusions from `logConfig`

### Resilience

- All logging calls wrapped in try/catch — failures silently swallowed (console.error to PM2 logs at most)
- `requestLogger.js` middleware: if logging fails, request proceeds normally
- `POST /api/logs` failures don't affect client-side app flow (fire-and-forget)
- If Firestore is down, logger falls back to PM2 console logs only
- Cron log rotation failures don't affect other cron jobs

---

## 2. Trace ID System

### Client-side (Android/iOS/Web)

- On app launch / page load, generate a `sessionTraceId` (UUID v4)
- Store in memory (not persisted — new session = new trace)
- Attach as `x-session-trace-id` header on every API request
- Include in every log entry sent to `POST /api/logs`

### Server-side (Express)

- On each incoming request, generate a `requestTraceId` (UUID v4)
- Read `x-session-trace-id` from request headers
- Both IDs attached to every log entry generated during that request
- Pass both IDs to downstream function calls

### KMP Implementation

- `sessionTraceId` generated in `commonMain` using KMP-compatible UUID
- Stored in a singleton `TraceManager` object
- Ktor HTTP client interceptor adds the header automatically

---

## 3. Device Information & Bindings

### Data Collected on App Startup

- Manufacturer, model, OS version
- Screen resolution, screen density
- Total RAM
- App version, build number
- Device language/locale
- IP address (derived server-side)
- Network type (Wi-Fi/mobile), carrier name
- ISP, ASN (derived server-side from IP via ip-api.com free tier)
- Country, region (derived server-side)
- Android ID / IDFV (existing device binding ID)
- Firebase Installation ID

### Enriched `deviceBindings/{deviceId}` Doc

```json
{
  "deviceId": "abc-xyz",
  "userId": "user123",
  "manufacturer": "Samsung",
  "model": "Galaxy S24",
  "osVersion": "Android 14",
  "screenResolution": "1080x2340",
  "screenDensity": 2.75,
  "totalRamMb": 8192,
  "appVersion": "0.53",
  "buildNumber": 54,
  "locale": "en-GB",
  "networkType": "wifi",
  "carrierName": "EE",
  "lastIp": "203.0.113.42",
  "isp": "BT Group",
  "asn": "AS12576",
  "country": "GB",
  "region": "London",
  "firebaseInstallationId": "fid-abc",
  "firstSeen": "2026-01-15T10:00:00Z",
  "lastSeen": "2026-03-07T14:23:00Z",
  "boundAt": "2026-01-15T10:00:00Z"
}
```

### Flow

- On app startup, client collects device info and sends `POST /api/device-info`
- Server enriches with IP-derived fields (ISP, ASN, geo) using ip-api.com (free: 45 req/min)
- Stored/updated in Firestore `deviceBindings/{deviceId}`
- Updated on every app launch (last seen timestamp, IP changes, app version)

### Admin Panel — Device Bindings Tab

- Searchable table: by device ID, user ID, manufacturer, model, IP, ISP
- Columns: Device ID, User, Model, OS, Last IP, ISP/ASN, Country, Last Seen, Status
- Click row to expand full device details
- Actions: Unbind device, Ban device, View log history (jumps to Logs tab filtered by deviceId)

### Admin Panel — Users Tab Enhancement

- Each user's detail view shows bound device(s) with key info
- Quick actions: Unbind, Ban device, View device logs

---

## 4. Full Database Backups

### Current State

Daily cron backs up only `users` collection to R2, 7-day retention.

### New Approach

**Collections to back up:**
`users`, `rooms`, `conversations`, `deviceBindings`, `gifts`, `giftCatalog`, `economyConfig`, `funFacts`, `banners`, `reports`, `appeals`, `subscriptions`, `logConfig`, `deviceBans`, `networkBans`

**Subcollections:** `rooms/{id}/messages`, `rooms/{id}/seatRequests`, `conversations/{id}/messages`

### R2 Structure

```
backups/full/YYYY-MM-DD/
  users.json
  rooms.json
  rooms_messages.json
  rooms_seatRequests.json
  conversations.json
  conversations_messages.json
  deviceBindings.json
  gifts.json
  giftCatalog.json
  economyConfig.json
  funFacts.json
  banners.json
  reports.json
  appeals.json
  subscriptions.json
  deviceBans.json
  networkBans.json
  manifest.json
```

`manifest.json` records doc counts per collection, total size, timestamp.

### Restore Options (Admin Panel)

- **Full restore** — wipe and restore entire database from a backup date
- **Collection restore** — restore a single collection
- **Missing-only restore** — only restore docs that don't currently exist
- Auto-creates a fresh backup before any restore operation
- `logs` collection is NOT backed up (transient, archived to R2 separately)

---

## 5. Device & Network Banning

### Firestore Collections

`deviceBans/{deviceId}`:
```json
{
  "deviceId": "abc-xyz",
  "reason": "Multi-accounting",
  "bannedBy": "admin-user-id",
  "bannedAt": "2026-03-07T14:00:00Z",
  "expiresAt": "2026-03-14T14:00:00Z",
  "duration": "7d",
  "linkedUserId": "user123",
  "autoApplied": true
}
```

`networkBans/{banId}`:
```json
{
  "type": "ip | subnet | asn",
  "value": "203.0.113.42 | 203.0.113.0/24 | AS12576",
  "reason": "Abuse",
  "bannedBy": "admin-user-id",
  "bannedAt": "2026-03-07T14:00:00Z",
  "expiresAt": "2026-04-06T14:00:00Z",
  "duration": "30d",
  "linkedUserId": "user123"
}
```

### Ban Enforcement

```
App launch -> POST /api/device-info -> auth middleware checks:
  1. Is deviceId in deviceBans? -> show "Device suspended" screen
  2. Is IP/subnet/ASN in networkBans? -> show "Network suspended" screen
  3. Clear -> proceed normally
```

- Bans cached in memory on Express server, refreshed every 60s from Firestore
- Ban screen reuses existing suspension UI, adapted per ban type:
  - Account suspended: "Your account has been suspended"
  - Device banned: "This device has been suspended"
  - Network banned: "Access from your network has been restricted"
  - All show reason + expiry date

### Auto-apply on Account Suspension

- Creates `deviceBan` for all devices bound to that user
- Creates `networkBan` (by IP) for user's last known IP
- Logs all auto-bans with trace ID

### Auto-expiry

- Cron runs hourly, removes expired ban docs
- FCM notification to admin on expiry
- Expiry logged with trace ID

### Admin Panel — Banning UI

- **Users tab "Bans & Restrictions" panel:**
  - Account status (Active/Suspended with date, reason, duration, expiry)
  - Device bans list (device model, reason, duration, expiry, Unban action)
  - Network bans list (type, value, reason, duration, expiry, Unban action)
  - Ban history (collapsed, all past bans)
  - Quick actions: Suspend Account (with device/network ban options + duration), Ban Device, Ban Network, Unban All, View Logs

- **Device Bindings tab:** Ban Device / Ban Network buttons per device

- **Active Bans section:** Table of all active bans, type, value, reason, expires, linked user, Unban action. Expiring-soon bans highlighted.

---

## 6. Alerting & Proactive Monitoring

### Firestore Collections

`alertConfig` — single doc:
```json
{
  "errorSpikeThreshold": 10,
  "errorSpikeWindowMinutes": 5,
  "slowEndpointThresholdMs": 3000,
  "cronFailureAlert": true,
  "crashReportAlert": true,
  "firestoreQuotaWarningPercent": 80,
  "serverMemoryWarningPercent": 85,
  "pm2RestartAlert": true,
  "fcmRecipientUserIds": ["admin-user-id-1"]
}
```

`alerts/{alertId}`:
```json
{
  "type": "error_spike | slow_endpoint | cron_failure | crash | quota_warning | server_health",
  "severity": "warning | critical",
  "title": "Error spike detected",
  "message": "12 errors in 5 minutes on POST /api/rooms/join",
  "context": { "route": "/api/rooms/join", "errorCount": 12, "sampleTraceIds": ["t1", "t2"] },
  "createdAt": "2026-03-07T14:30:00Z",
  "status": "unresolved | acknowledged | resolved",
  "acknowledgedBy": null,
  "resolvedBy": null,
  "resolvedAt": null
}
```

### Alert Triggers

| Trigger | Detection |
|---------|-----------|
| Error spike | Logger tracks error count per rolling window in memory |
| Slow endpoint | Request logger flags requests exceeding threshold |
| Cron failure | Cron catch blocks create alerts |
| App crash | Mobile FATAL log triggers alert |
| Quota warning | Daily write counter vs hard cap percentage |
| Server health | Cron (every 5 min) checks memory usage, PM2 restart count |

### Alert Delivery

1. Written to Firestore `alerts` collection
2. FCM push notification to configured admin user IDs
3. Admin panel: notification bell icon with unresolved count badge

### Alert Lifecycle

```
Generated -> Unresolved (FCM sent + badge)
  -> Acknowledge (badge clears)
  -> Resolve (moved to history)
```

---

## 7. Webpage Logging

### Shared Library: `public/js/logger.js`

```javascript
ShyTalkLogger.init({ source: "admin-panel", endpoint: "/api/logs" });
```

### Automatic Captures

- `window.onerror` + `unhandledrejection` — JS errors with stack traces
- `PerformanceObserver` — page load time, LCP, resource timing
- `fetch` wrapper — intercepts all fetch calls, logs URL, method, status, duration
- Attaches `x-session-trace-id` header to all fetch calls

### Manual Logging

```javascript
ShyTalkLogger.info("User switched to Logs tab", { tab: "logs" });
ShyTalkLogger.error("Failed to load users", { error: err.message });
```

### User Action Tracking

- `data-log` attributes on HTML elements:
  ```html
  <button data-log="suspend-user">Suspend</button>
  ```
- Clicks auto-log: `"User clicked: suspend-user"`

### Session Trace

- `sessionTraceId` generated on page load (UUID v4), stored in `sessionStorage`
- Included in all log entries and fetch headers

### Sending

- Immediate send on each event
- If POST fails, silently dropped

### Pages

- `public/admin/index.html` (source: `admin-panel`)
- `public/index.html` (source: `landing-page`)
- Any other pages in `public/`

---

## 8. Admin Panel Logs Tab

### Layout

**Filters bar:** Level, Source, Time Range, User ID, Trace ID, Keyword, Route, Search button, Live toggle

**Quota widget:** Shows estimated writes used today vs hard cap

**Alert bell:** Unresolved alert count badge in header

**Log table (default view):**
- Columns: Timestamp, Level, Source, User, Message, TraceID
- Click row to expand full context + request/response bodies
- Click TraceID to switch to Trace View

**Trace View:**
- Timeline/waterfall showing all entries for a sessionTraceId chronologically
- Each entry shows requestTraceId, timing, duration
- Click any entry to expand full context

**Live mode:**
- Toggle starts Firestore real-time listener
- New logs appear at top with highlight animation
- Filters apply in live mode
- Pause/Resume controls

**Alerts section (collapsible):**
- Unresolved alerts table with Acknowledge/Resolve/View Logs actions
- Configure Thresholds button

**Log Settings section (collapsible):**
- Firestore retention, log level per source, excluded routes, daily cap, mobile batch settings

**Export:** JSON or CSV download of filtered results

**Pagination:** For large result sets

---

## 9. Android/iOS KMP Changes

### New/Modified Files in `shared/src/commonMain/`

- `core/util/Logger.kt` — expanded with levels (DEBUG/INFO/WARN/ERROR/FATAL), ships logs to server
- `core/util/TraceManager.kt` — singleton, generates/holds `sessionTraceId`
- `core/util/DeviceInfoCollector.kt` — expect/actual, collects device info
- `data/remote/LogService.kt` — HTTP client for `POST /api/logs` and `POST /api/device-info`

### Platform-specific (expect/actual)

- `DeviceInfoCollector.android.kt` — `android.os.Build`, `DisplayMetrics`, `ActivityManager`, `ConnectivityManager`
- `DeviceInfoCollector.ios.kt` — `UIDevice`, `ProcessInfo`, `UIScreen`

### Ktor Interceptor

- Automatically attaches `x-session-trace-id` header to every API request
- No changes to existing API call sites

### Log Shipping

- Respects admin-configured settings (fetched on startup from `GET /api/log-config`)
- Configurable batch interval and Wi-Fi-only toggle
- Background coroutine, never blocks UI
- Fire-and-forget — failures silently dropped

### Logging Coverage

Add INFO+ logging to: auth flows, room operations, voice connection, messaging, profile updates, storage operations, gift/economy operations, navigation events.

### Ban Check on Startup

- `POST /api/device-info` response includes ban status
- If banned, app shows blocking screen (reuses existing suspension UI):
  - Account suspended: "Your account has been suspended"
  - Device banned: "This device has been suspended"
  - Network banned: "Access from your network has been restricted"
- Shows reason + expiry date
- User cannot navigate past this screen

---

## 10. Testing, Documentation & Legal

### Tests

**Express API (Jest/Supertest):**
- `POST /api/logs` — schema validation, rate limiting, quota throttling, level filtering
- `POST /api/device-info` — enrichment, ban checking, device binding creation
- `GET /api/admin/logs` — filters, pagination, export
- Request logger middleware — trace ID generation, body sanitization, exclusions
- Alert generation — error spike detection, threshold checking, FCM dispatch
- Ban CRUD — create/expire/auto-apply on suspension
- Log rotation cron — Firestore to R2 rotation, cleanup
- Full database backup cron — all collections, manifest, restore

**Android/KMP (JUnit + MockK):**
- `Logger` — level filtering, log entry schema, shipping
- `TraceManager` — session trace generation, header attachment
- `DeviceInfoCollector` — data collection (mocked platform APIs)
- `LogService` — batching, fire-and-forget, failure resilience
- Ban screen — correct type displayed based on ban response

### README.md

- Project description (open-source social chat app with voice rooms)
- Apache 2.0 license badge
- Prerequisites: accounts (Firebase, LiveKit, Cloudflare R2, Oracle Cloud), tools (Android Studio, Node.js, PM2)
- Environment variables list with descriptions
- Clone, setup, run instructions (Express API + Android app)
- Contribution guide (fork, branch, PR, code style, test requirements)
- Architecture overview diagram

### Legal

- Privacy policy updated: device info, IP, ISP, network type, geolocation, usage logs
- Terms of service updated: device/network banning, data retention (90 days logs, 7 days backups)

### License

- Apache 2.0 `LICENSE` file added to repo root
