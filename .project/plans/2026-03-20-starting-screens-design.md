# Starting Screens — Design Spec

**Date:** 2026-03-20
**Status:** Spec
**Goal:** Configurable starting screens (blocking or dismissable) shown on app launch, managed via admin panel, with remote config toggle, device/network allowlisting, and full cross-platform support (Android + iOS).

---

## 1. Data Model

### Firestore Document: `config/startingScreens`

Each key is a screen ID (alphanumeric + hyphens/underscores only):

```json
{
  "preLaunchGate": {
    "enabled": true,
    "dismissable": false,
    "frequency": "every_launch",
    "template": "warning",
    "title": "ShyTalk is not available yet",
    "message": "ShyTalk has not been released yet. To apply to test the application, contact Shyden. Testing is available for iOS and Android users.",
    "imageType": "police_duck",
    "backgroundImage": null,
    "startDate": null,
    "endDate": null,
    "allowlist": {
      "deviceIds": [],
      "networks": []
    },
    "lastModifiedBy": "admin-uid",
    "lastModifiedAt": "2026-03-20T12:00:00Z"
  }
}
```

### Field Definitions

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `enabled` | boolean | yes | Must be boolean |
| `dismissable` | boolean | yes | Must be boolean. Max 1 non-dismissable screen enabled at a time |
| `frequency` | string | yes | `"every_launch"` or `"once"` |
| `template` | string | yes | `"warning"`, `"promotional"`, `"announcement"`, or `"info"` |
| `title` | string | yes | 3–100 chars. Trimmed. Zero-width chars stripped (except ZWJ). NFC normalised |
| `message` | string | yes | 10–500 chars. Trimmed. Control chars stripped. Max 2 consecutive newlines |
| `imageType` | string | no | Known image key (`"police_duck"`) or `null`. Overrides template default icon |
| `backgroundImage` | string | no | Valid R2 storage key or `null`. Full-screen background behind all content |
| `startDate` | string | no | ISO 8601 with time component, or `null`. Screen active when `now >= startDate` |
| `endDate` | string | no | ISO 8601 with time component, or `null`. Screen active when `now < endDate` (exclusive). Must be after `startDate` if both set. Must be in the future when saving |
| `allowlist` | object | no | Defaults to `{ deviceIds: [], networks: [] }` |
| `allowlist.deviceIds` | string[] | no | Device IDs that see blocking screen as dismissable |
| `allowlist.networks` | string[] | no | IP addresses or CIDR ranges. `/0` rejected |
| `lastModifiedBy` | string | read-only | Admin UID, set by API on write |
| `lastModifiedAt` | string | read-only | ISO timestamp, set by API on write |

### Screen ID Validation
- Alphanumeric + hyphens + underscores only
- Non-empty
- No dots, slashes, or unicode

### Active Screen Logic
A screen is active when: `enabled == true` AND (`startDate == null` OR `now >= startDate`) AND (`endDate == null` OR `now < endDate`).

### Templates

| Template | Default Icon | Accent |
|----------|-------------|--------|
| `warning` | Police duck | Amber/red |
| `promotional` | Gift/star | Brand accent |
| `announcement` | Megaphone | Neutral |
| `info` | Info circle | Blue |

If `imageType` is set, it overrides the template's default icon. Templates only affect visual presentation (colours, default icon, tone).

### Screen Layout (fixed, all screens)

1. **ShyTalk app icon + logo** — always present, not configurable, cannot be removed
2. **Template/image icon** — from `imageType` or template default
3. **Title**
4. **Message**
5. **Dismiss button** — only if `dismissable: true`
6. **Background image** — full-screen behind all content with semi-transparent dark overlay (`0.6 alpha`) for text readability. If not set, solid themed background.

### Content Hash

Each screen in the API response includes a `contentHash` — SHA-256 of JSON-sorted content fields (`title`, `message`, `template`, `imageType`, `backgroundImage`, `dismissable`, `frequency`). Used by clients for cache invalidation. Does NOT include `enabled`, `allowlist`, `startDate`, `endDate`, or audit fields.

---

## 2. API Changes

### Route Registration Order

**Critical:** Both `GET /api/config/startingScreens` and `PUT /api/config/startingScreens` must be registered **before line 21** of `config.js` — the generic `GET /api/config/:key` route. The generic GET is the first route in the file and will match `/config/startingScreens` if the dedicated route is placed after it. Both the new GET and PUT must come before both generic routes (GET at line 21, PUT at line 124). This differs from `PUT /api/config/economy` which only needed to pre-empt the generic PUT — the new `startingScreens` endpoint has both verbs so both must be placed first.

Do NOT add `startingScreens` to `CONFIG_ALLOWED_FIELDS` — the dedicated routes handle their own validation with different semantics (nested objects, 409 blocking constraint, audit fields).

### Auth Middleware Exemption

**Critical:** `GET /api/config/startingScreens` must be exempted from the auth middleware in `index.js` (line 42-51). Currently only `/health`, `/log-config`, `/auth/*`, and `/test/*` are exempt. Without this, every unauthenticated app call returns 401 and the feature is non-functional.

Add to the exemption list in `index.js`:
```javascript
req.path === '/config/startingScreens' ||  // Starting screens — pre-auth endpoint
```

Only GET needs to be exempt. PUT remains behind auth middleware (admin-only).

### `GET /api/config/startingScreens`

**Authentication:** None required (pre-auth endpoint, exempted from auth middleware above).

**Behaviour:**
- Reads `config/startingScreens` from Firestore
- Filters to only active screens (date-windowed, `enabled: true`)
- Checks `X-Device-Id` header and request IP against each screen's `allowlist` — if matched, overrides `dismissable` to `true` in the response
- Returns `contentHash` per screen
- Returns `lastModifiedAt` per screen (for admin panel display)
- Does NOT return `allowlist` in response (internal data)
- Does NOT return `lastModifiedBy` to non-admin callers
- Returns screens in alphabetical order by screen ID
- Includes `ETag` header based on combined content hashes (disabled when allowlist override applies — per-device responses)
- Supports `If-None-Match` for 304 responses

**Response shape:**
```json
{
  "preLaunchGate": {
    "enabled": true,
    "dismissable": false,
    "frequency": "every_launch",
    "template": "warning",
    "title": "...",
    "message": "...",
    "imageType": "police_duck",
    "backgroundImage": null,
    "startDate": null,
    "endDate": null,
    "contentHash": "a1b2c3...",
    "lastModifiedAt": "2026-03-20T12:00:00Z"
  }
}
```

**Headers:** `Content-Type: application/json; charset=utf-8`, `X-Content-Type-Options: nosniff`, `ETag` (when no allowlist override).

### `PUT /api/config/startingScreens`

**Authentication:** Admin required (403 for non-admin).

**Dedicated route** (not using generic `PUT /config/:key`). Handles its own validation.

**Validation:**
- All field validations per the data model table above
- Reject second non-dismissable screen → 409 with `{ error: "...", existingBlocker: "screenId" }`
- Non-dismissable screen with `startDate` in future still counts toward the limit
- Screen ID validation (alphanumeric + hyphens/underscores)
- Reject CIDR `/0` in allowlist networks
- `startDate` must be before `endDate` if both set
- `endDate` must be in the future

**Error responses:** Consistent shape `{ error: string, field?: string }`. No stack traces, no internal paths.

**Audit:** Sets `lastModifiedBy` and `lastModifiedAt` automatically.

### `X-Device-Id` Header

**Sent by app on every API call** (GET, POST, PUT, DELETE — authenticated and unauthenticated).

- Android: `ANDROID_ID` (already available via Koin)
- iOS: `UIDevice.current.identifierForVendor?.uuidString`
- Added to HTTP client (`WorkerApiClient` on Android, `URLSession` on iOS)
- Header read by starting screens endpoint for allowlist check
- Broader benefit: device tracing for debugging and malicious behaviour detection

### Image Compression

**When:** Before storing any uploaded image to R2.

**Library:** `sharp` (Node.js). Must be added to `express-api/package.json` dependencies using `npm install sharp@x.x.x --save-exact` (pinned version, not `^` range — native module requires binary compatibility). Note: existing native dep `bcrypt` uses `^` range; `sharp` is an exception due to its binary size and build sensitivity. For HEIC support, verify the installed `sharp` build includes `libvips` with HEIC/HEIF codec. New utility: `utils/imageCompressor.js`.

**Strategy (lossless/near-lossless):**
- JPEG: `sharp().jpeg({ quality: 95, mozjpeg: true })` — strip EXIF, auto-rotate
- PNG: `sharp().png({ effort: 10, compressionLevel: 9 })` — preserve alpha, strip metadata
- WebP: `sharp().webp({ quality: 95, nearLossless: true })` — preserve alpha
- GIF: Pass through unchanged
- HEIC/HEIF: Convert to JPEG, then compress. **Requires adding `'image/heic'` and `'image/heif'` to `ALLOWED_MIME_TYPES` in `storage.js`** — otherwise the route rejects HEIC before compression runs
- SVG: Rejected (not raster, XSS risk)
- Animated WebP/GIF: Pass through (can't optimise without losing frames)

**Additional processing:**
- Strip EXIF/metadata (privacy)
- Auto-rotate based on EXIF orientation
- Convert CMYK to sRGB
- Convert 16-bit to 8-bit colour depth
- Preserve original dimensions (no resizing)
- Reject images > 4096×4096 or < 100×100

**Limits:**
- Pre-compression: 10MB (existing multer limit)
- Compression timeout: 10 seconds
- `sharp` failure: graceful fallback to storing uncompressed

**Response enhancement:** Upload response includes `originalSize` and `compressedSize`.

**Applied to all image uploads**, not just starting screens.

**Upload path for background images:** Add `'starting-screens'` to `ALLOWED_UPLOAD_PATHS` in `storage.js`. Without this, admin panel background image uploads will receive `400 Invalid upload path`. Background image keys will follow the format `starting-screens/{adminUniqueId}/{timestamp}-{random}.{ext}`.

---

## 3. Android App Changes

### `AppConfigService` Interface Addition

**Architecture decision:** `getStartingScreens()` is added to the `AppConfigService` interface in `commonMain`. This requires platform-specific implementations:
- **Android:** `AndroidAppConfigService` (existing, in `app/`) — calls API via `WorkerApiClient`
- **iOS:** iOS does NOT use this KMP interface. iOS has its own standalone Swift implementation (`StartingScreenService.swift`) that calls the API via `URLSession`. This avoids the KMP/cinterop complexity and keeps the iOS path simple. The `StartingScreen` data model is duplicated as a Swift `Codable` struct.

```kotlin
// In commonMain — AppConfigService.kt
data class StartingScreen(
    val screenId: String,
    val enabled: Boolean,
    val dismissable: Boolean,
    val frequency: String, // "every_launch" | "once"
    val template: String, // "warning" | "promotional" | "announcement" | "info"
    val title: String,
    val message: String,
    val imageType: String?,
    val backgroundImage: String?,
    val startDate: String?,
    val endDate: String?,
    val contentHash: String = "",  // Server-computed, default empty for test construction and cache migration
)

suspend fun getStartingScreens(): Resource<Map<String, StartingScreen>>
```

### `X-Device-Id` Header

**Mechanism:** Add `deviceId: String` as the 4th constructor parameter to `WorkerApiClient`:

```kotlin
class WorkerApiClient(
    private val okHttpClient: OkHttpClient,
    private val baseUrl: String,
    private val auth: FirebaseAuth,
    private val deviceId: String  // NEW
)
```

Update Koin binding in `AppKoinModule.kt`:
```kotlin
single { WorkerApiClient(get(), BuildConfig.API_BASE_URL, get(), get(named("deviceId"))) }
```

**All request paths must include the header:**
- `executeWithRetry()` lambda (used by `get()`, `post()`, `put()`, `delete()`) — add `.addHeader("X-Device-Id", deviceId)` to the `Request.Builder`
- `getPublic()` and `postPublic()` — these build requests inline via `Request.Builder()` (NOT through `executeWithRetry`). Must add `.addHeader("X-Device-Id", deviceId)` to their inline builders explicitly. Easy to miss since they're separate code paths.
- `executeArrayWithRetry()` (used by `getArray()`) — a fourth code path at line ~150 that builds requests separately from `executeWithRetry`. Must also include the header via the same pattern.

### `MainActivity` Startup Chain (revised)

Starting screens check inserted as the **first** check, before all others:

1. **Check local cache** for blocking screen
2. **Call API** `GET /api/config/startingScreens` with `X-Device-Id` header
3. **If API succeeds:**
   - Blocking screen in response → compare `contentHash` with cache → update cache if changed → show blocking screen → **STOP all further loading**
   - No blocking screen → clear blocking cache if present → continue to step 4
4. **If API fails:**
   - Cache exists with blocker → show cached blocking screen → STOP (fail-safe)
   - No cache → proceed normally (fail-open)
5. Continue existing chain: unsafe device → force update → backend health → legal acceptance → auth → app
6. After auth + normal loading: show any active dismissable screens before entering main app

### Blocking Screen Behaviour

When a non-dismissable screen is active:
- Rendered immediately, all further loading stops
- No Firebase Auth initialised
- No RTDB connection
- No LiveKit
- No FCM token registration
- No permission requests
- No sound, no haptics
- No analytics events
- Back button consumed (no effect)
- Home button works (system), returning shows blocker
- System back gesture consumed

### Caching

**Storage:** JSON file in `context.cacheDir` (`starting_screens_cache.json`). NOT SharedPreferences or DataStore — file-based caching allows atomic writes and mixed JSON + file path structure. `dismissedOnceScreenIds` stored separately in `SharedPreferences` (simple string set, no atomicity concerns).

**Cache structure** (`starting_screens_cache.json`):
```json
{
  "cacheVersion": 1,
  "blockingScreen": {
    "screenId": "preLaunchGate",
    "contentHash": "a1b2c3...",
    "content": { ... },
    "backgroundImagePath": "/local/path/bg.jpg"
  }
}
```

**Cache behaviours:**
- Atomic writes (write to temp file in cacheDir, then rename)
- Cache version mismatch → discard, fresh fetch
- Corrupt/empty/zero-byte cache → treated as empty
- Deserialization exceptions (e.g. missing `contentHash` field in old cache format) → caught alongside IO exceptions, treated as empty cache (use try/catch around ALL JSON parsing, not just file reads)
- Disk full → logged, proceed with API response only
- Background image cached separately, re-downloaded only when `backgroundImage` key changes
- Old background images cleaned up when screen removed or image changed

### New Composable: `StartingScreen`

**Location:** `app/src/main/java/com/shyden/shytalk/feature/starting/StartingScreen.kt`

**Layout:**
- `Surface` fills screen with `MaterialTheme.colorScheme.background` (or background image + overlay)
- `Column` with `verticalScroll`, centred, `padding(32.dp)`
- ShyTalk app icon + logo (always present, not configurable). App icon: reuse launcher icon via `context.packageManager.getApplicationIcon()` rendered as `BitmapPainter`. Logo text: "ShyTalk" in `headlineLarge` with app brand font. If a dedicated logo drawable is needed, add `ic_shytalk_logo.xml` to `app/src/main/res/drawable/`
- Template/image icon (from `imageType` or template default)
- Title: `headlineMedium`, `textAlign = Center`
- Message: `bodyLarge`, `textAlign = Center`, `onSurfaceVariant`
- Dismiss button (only if `dismissable`, `testTag("startingScreen_dismissButton")`)
- Background image: `ContentScale.Crop`, centred, with `Color.Black.copy(alpha = 0.6f)` overlay
- All images have `contentDescription` for accessibility
- Proportional/relative sizing for all screen sizes

**i18n:** Known screen IDs (e.g. `preLaunchGate`) use localised string resources from all 19 locales + default. Unknown/dynamic screen IDs fall back to Firestore text.

### New String Resources

Added to all 19 locale files + default (`shared/src/commonMain/composeResources/values*/strings.xml`):
- `starting_screen_pre_launch_title`
- `starting_screen_pre_launch_message`
- `starting_screen_dismiss`
- `starting_screen_police_duck_description` (accessibility)

---

## 4. iOS App Changes

### New SwiftUI Screen: `StartingScreenView`

**Location:** `iosApp/iosApp/feature/starting/StartingScreenView.swift`

**Layout:** Mirrors Android — ShyTalk branding, template icon, title, message, dismiss button, optional background image with dark overlay. Uses SwiftUI `ScrollView`, `VStack`, `Image`, `Text`, `Button`.

- `ContentMode.fill` + `.clipped()` for background image
- `GeometryReader` for screen-size-aware layout
- Dark overlay: `Color.black.opacity(0.6)`
- Touch target ≥ 44×44pt for dismiss button (Apple HIG)
- Status bar visible, home indicator visible
- No navigation bar

### `X-Device-Id` Header

`URLSession` configuration adds `X-Device-Id: identifierForVendor` to all requests. Handles `nil` gracefully (omit header).

### iOS Entry Point (`iOSApp.swift`) — Structural Change

The current `iOSApp.swift` is minimal (`var body: some Scene { WindowGroup { ContentView() } }`). This must be restructured to support an async pre-render check:

```swift
@main
struct iOSApp: App {
    @StateObject private var coordinator = StartingScreenCoordinator()

    var body: some Scene {
        WindowGroup {
            Group {
                if coordinator.isBlocked {
                    StartingScreenView(screen: coordinator.blockingScreen!,
                                       onDismiss: { coordinator.dismiss() })
                } else if !coordinator.isReady {
                    // Loading state while checking API
                    ProgressView()
                } else {
                    ContentView()
                }
            }
            .task { await coordinator.checkStartingScreens() }
        }
    }
}
```

**`StartingScreenCoordinator`** (`iosApp/iosApp/feature/starting/StartingScreenCoordinator.swift`):
- `@Published var isBlocked: Bool`
- `@Published var isReady: Bool`
- `@Published var blockingScreen: StartingScreen?`
- `func checkStartingScreens()` — calls API, checks cache, sets state
- `func dismiss()` — for allowlisted devices on blocking screens
- Uses `StartingScreenService` for API calls and `StartingScreenCache` for persistence

**`StartingScreenService`** (`iosApp/iosApp/feature/starting/StartingScreenService.swift`):
- Standalone Swift implementation (NOT using KMP `AppConfigService`)
- Calls `GET /api/config/startingScreens` via `URLSession`
- Parses response into Swift `StartingScreen` struct (`Codable`)
- Sends `X-Device-Id` header

When `isBlocked == true`, `ContentView` (and therefore `MainViewController` / KMP layer) is never instantiated — preventing any KMP startup code from running.

### iOS Caching

**Blocking screen cache:** JSON file in `FileManager.cachesDirectory` (`starting_screens_cache.json`). NOT `UserDefaults` — `UserDefaults` is backed up to iCloud which violates the privacy requirement. Same atomic write pattern as Android (write to temp, rename).

**Dismissed one-time screen IDs:** `UserDefaults` string set (acceptable — screen IDs are not PII and iCloud sync of dismissed IDs is harmless).

### Police Duck Asset

Added to `iosApp/iosApp/Assets.xcassets/police_duck.imageset/` — same PNG as Android (reused from `app/src/main/res/drawable/police_duck.png`).

### i18n

`Localizable.strings` files for all supported locales with same keys as Android.

### Privacy

- `identifierForVendor` usage declared in `PrivacyInfo.xcprivacy`
- Blocking screen cache stored in `Caches` directory (not backed up to iCloud, system can evict)
- Dismissed screen IDs in `UserDefaults` (backed up, but contain no PII — only screen ID strings)
- No ATT required (first-party functionality)

---

## 5. Admin Panel Changes

### New "Starting Screens" Section

**Location:** `public/admin/index.html` — new tab after Users section.

**URL routing:** `#starting-screens` deep link.

### Screen Card UI

Each configured screen is a card showing:
- Screen ID (read-only after creation)
- **Enabled** toggle
- **Dismissable** toggle — disabled with tooltip if another non-dismissable screen exists
- **Frequency** dropdown (`Every Launch`, `Once`)
- **Template** dropdown (`Warning`, `Promotional`, `Announcement`, `Info`)
- **Title** text field — character counter (3–100), turns red at limit
- **Message** textarea — character counter (10–500), turns red at limit
- **Image type** dropdown (optional: `None`, `Police Duck`, extensible)
- **Background image** — upload/remove buttons, thumbnail preview, shows compression savings (`"1920×1080, 245KB compressed from 1.2MB"`)
- **Start date/time** picker — optional, "Immediately" if unset, UTC offset shown
- **End date/time** picker — optional, "Never expires" if unset, cannot set in past
- **Status badge** — `Active`, `Scheduled` (with countdown), `Expired` (greyed out)
- **Allowlist** — two textareas: device IDs (one per line) and networks (one per line, IP/CIDR)
- **Audit trail** — "Last modified by [admin] at [datetime]"
- **Save** button per card
- **Delete** button with confirmation dialog

### Device Preview Panel

Each card includes a live preview:
- Phone frame (~390×844 aspect ratio)
- Renders actual layout: branding → icon → title → message → dismiss button
- Updates in real-time as admin edits fields
- Shows background image with overlay when uploaded
- Shows/hides dismiss button based on toggle
- **Non-interactive** — preview elements are not clickable
- Scrolls if content overflows device frame

### Other UI

- **"Add Screen"** button → empty form with defaults
- **Empty state:** "No starting screens configured" with "Add Screen" CTA
- **Loading state:** Spinner while fetching config
- **Error state:** Error message with retry button
- Form dirty state → browser confirmation dialog on navigation
- All form fields have `<label>` elements for accessibility
- Tab order follows visual order
- Focus visible on all interactive elements

---

## 6. Testing

### Express API Tests

#### `tests/routes/config.test.js` — Starting Screens GET

**Core functionality:**
- Returns active starting screens with all fields
- Returns empty object when no screens configured
- Returns empty object when all screens disabled
- Returns `contentHash` per screen
- Returns `lastModifiedAt` per screen
- Returns screens in alphabetical order by screen ID
- Response shape matches frozen contract snapshot

**Date filtering:**
- Omits screens where `startDate` is in the future
- Omits screens where `endDate` is in the past
- Returns screen where `startDate` is null (immediately active)
- Returns screen where `endDate` is null (never expires)
- Boundary: `startDate` exactly at frozen time → active (`>=`)
- Boundary: `endDate` exactly at frozen time → NOT active (`<` exclusive)
- `startDate` 1ms after frozen time → not active
- `endDate` 1ms after frozen time → active
- Both `startDate` and `endDate` null → always returned
- `startDate` null + `endDate` set and valid → returned
- `startDate` set + `endDate` null → returned
- Multiple screens with overlapping windows → all active ones returned
- Screen transitions from active to expired → correctly omitted
- All date tests use `jest.useFakeTimers()` / `jest.setSystemTime()`

**Allowlist:**
- Device ID exact match → `dismissable` overridden to `true`
- Device ID case-sensitive — different case → no match
- IP exact match → overridden
- CIDR match (e.g. `192.168.1.0/24` matches `192.168.1.50`) → overridden
- IP not in CIDR range → not overridden
- Both device ID and IP match → overridden
- Neither matches → unchanged
- Empty allowlist → no override
- `X-Device-Id` header missing → no device match, IP still checked
- Allowlist on already-dismissable screen → no-op
- IPv6 matching
- IPv4-mapped IPv6 (`::ffff:192.168.1.1`) → matches equivalent IPv4
- Loopback (`127.0.0.1`) matching
- CIDR `/32` → single IP match
- CIDR `/0` → should have been rejected on PUT (never stored)

**Content hash:**
- Deterministic: same content → same hash across requests
- Changes when `title` changes
- Changes when `message` changes
- Changes when `template` changes
- Changes when `imageType` changes
- Changes when `backgroundImage` changes
- Changes when `dismissable` changes
- Changes when `frequency` changes
- Does NOT change when `enabled` toggles
- Does NOT change when `allowlist` changes
- Does NOT change when `startDate`/`endDate` changes
- SHA-256 hex string, 64 chars

**Multi-screen:**
- 0 screens enabled → empty response
- 1 blocking + 1 dismissable → both returned
- 2 dismissable → both returned in ID order
- 1 blocking + 2 dismissable → all 3 returned
- 1 expired + 1 active → only active
- 1 scheduled (future) + 1 active → only active
- 2 blocking in Firestore (manual insert) → API returns first alphabetically, logs warning

**ETag/conditional:**
- Response includes `ETag` header
- `If-None-Match` with matching ETag → 304
- `If-None-Match` with stale ETag → 200 with full body
- ETag changes when content changes
- ETag disabled when allowlist override applies

**Absence:**
- Response does NOT include `allowlist`
- Response does NOT include `lastModifiedBy` for non-admin callers
- Response does NOT include disabled screens
- Response does NOT include expired screens
- Response does NOT include future-scheduled screens
- Error responses do NOT include stack traces or Firestore paths

**Security:**
- `X-Device-Id` with extremely long value → truncated or sanitised
- `X-Device-Id` with special characters → sanitised before logging
- Uses existing `generalLimiter` rate limit (200 req/min per IP for unauthenticated callers — matches `rateLimit.js` configuration). No dedicated tighter limiter needed since this is a low-cost single-document Firestore read

**HTTP correctness:**
- POST → 405 (requires explicit `router.post('/config/startingScreens', (req, res) => res.status(405).json({error: 'Method not allowed'}))`)
- DELETE → 405 (same explicit handler needed)
- PATCH → 405 (same)
- Note: without these handlers, Express returns 404 for unregistered verbs. Add `router.all('/config/startingScreens', ...)` catch-all after GET/PUT returning 405
- Response `Content-Type: application/json; charset=utf-8`
- Response `X-Content-Type-Options: nosniff`
- No `Server` or `X-Powered-By` headers
- gzip compressed when `Accept-Encoding: gzip`
- Response < 5KB for 5 screens

**Idempotency:**
- GET called 100 times with no changes → identical response, same ETag

**Logging:**
- `log.info` with screen count, device ID, allowlist match status
- No PII at INFO level

#### `tests/routes/config.test.js` — Starting Screens PUT

**Validation — title:**
- Too short (2 chars) → 400 with field name
- Too long (101 chars) → 400 with field name
- Exactly 3 chars → accepted
- Exactly 100 chars → accepted
- Only whitespace → 400
- Unicode/emoji → accepted (char length, not bytes)
- HTML tags → accepted (stored as plain text)
- Zero-width characters stripped (except ZWJ)

**Validation — message:**
- Too short (9 chars) → 400
- Too long (501 chars) → 400
- Exactly 10 chars → accepted
- Exactly 500 chars → accepted
- Only whitespace → 400
- Control characters stripped
- Excessive newlines (>3 consecutive) → collapsed to 2

**Validation — enums:**
- Invalid frequency → 400
- Invalid template → 400
- Invalid imageType → 400
- Valid imageType `null` → accepted

**Validation — dates:**
- `startDate` after `endDate` → 400
- `startDate` equals `endDate` → 400 (zero-length window)
- `endDate` in the past → 400
- `startDate` 1ms before `endDate` → accepted
- Invalid ISO 8601 → 400
- Date without time component → 400
- Date with timezone offset → accepted
- `startDate` in the past → accepted (already active)

**Validation — background image:**
- Valid R2 key → accepted
- `null` → accepted
- Empty string → 400
- Invalid key → 400

**Validation — allowlist:**
- `deviceIds` is array of strings → accepted
- `networks` is array of strings → accepted
- `deviceIds` not array → 400
- `networks` not array → 400
- Empty string in `deviceIds` → 400
- Invalid CIDR in `networks` → 400
- CIDR `/0` → 400
- `allowlist` missing → defaults to empty

**Validation — screen ID:**
- Dots/slashes → 400
- Spaces → 400
- Unicode → 400
- Empty string → 400
- Alphanumeric + hyphens + underscores → accepted

**Validation — types:**
- `enabled` as string `"true"` → 400
- `enabled` as number `1` → 400
- `title` as number → 400
- `startDate` as epoch number → 400
- Nested object where string expected → 400
- Array where object expected → 400
- Extra unknown fields → ignored

**Blocking constraint:**
- Enable non-dismissable when none exist → accepted
- Enable second non-dismissable → 409 with existing blocker ID
- Change existing non-dismissable to dismissable, then enable new → accepted
- Non-dismissable with `startDate` in future → still counts toward limit
- Modifying own non-dismissable screen (not changing dismissable) → accepted (not double-counting itself)

**Merge behaviour:**
- Updating only `enabled` → other fields preserved
- Updating `title` on existing → other fields preserved
- Creating screen with same ID → overwrites

**Audit:**
- `lastModifiedBy` set to admin UID
- `lastModifiedAt` set to current ISO timestamp
- Audit fields not settable by client

**Auth:**
- Unauthenticated → 401
- Non-admin → 403
- Admin → accepted

**Idempotency:**
- Same data PUT twice → same result, same contentHash

**Logging:**
- `log.info` with admin UID, screen ID, fields changed
- Validation failure → `log.warn` with field and reason
- No values logged (redacted)

**Error format:**
- All errors: `{ error: string, field?: string }`
- Blocking constraint: `{ error: "...", existingBlocker: "screenId" }`
- No stack traces

#### `tests/routes/config.test.js` — Combinatorial Decision Table

Key combinations tested using pairwise/boundary approach (not full Cartesian product). The specific 15 rows from the decision table in the design discussion are tested, plus additional boundary cases for dates and allowlist. Each row is an individual GET test verifying the correct screen is returned or omitted.

#### `tests/utils/imageCompressor.test.js`

- JPEG → compressed, smaller than input
- PNG → lossless compressed, smaller or equal
- WebP → compressed, smaller
- GIF → passed through unchanged
- HEIC → converted to JPEG, compressed
- HEIF → converted to JPEG, compressed
- SVG → rejected
- Animated WebP → passed through
- Animated GIF → passed through
- Transparency preserved in PNG
- Transparency preserved in WebP
- Dimensions unchanged after compression
- EXIF metadata stripped from JPEG
- EXIF metadata stripped from PNG
- Auto-rotation applied based on EXIF orientation
- CMYK converted to sRGB
- 16-bit converted to 8-bit
- Corrupted image buffer → descriptive error
- Empty buffer → descriptive error
- Zero-byte file → error
- Very small image (< 1KB) → not bloated
- Compression idempotent → already-compressed image not degraded
- Output MIME type matches input
- `originalSize` and `compressedSize` returned correctly
- Progressive JPEG handled correctly
- ICC profile stripped
- Image > 4096×4096 → rejected
- Image < 100×100 → rejected
- 1×1 pixel → rejected (below minimum)
- Panoramic (10000×500) → rejected (exceeds max dimension)
- sharp failure → graceful fallback to uncompressed
- sharp timeout (>10s) → abort and fallback
- No memory leak on repeated calls

#### `tests/routes/storage.test.js` — Compression Integration

- Upload response includes `originalSize` and `compressedSize`
- Compressed file stored to R2, not original
- Compression failure → fallback to storing original
- sharp dependency missing → graceful fallback

#### `tests/contracts/starting-screens-contract.test.js`

- Response shape matches frozen snapshot
- All required fields present
- Optional fields can be null
- `contentHash` always 64-char hex string
- `dismissable` always boolean (even after allowlist override)
- Empty document → `{}` (not null, not array)
- Any field addition → contract test fails
- Any field removal → contract test fails
- Any type change → contract test fails

#### Feature Isolation / Regression

- Existing `GET /api/config/app` → unaffected
- Existing `GET /api/config/economy` → unaffected
- Existing `PUT /api/config/app` → unaffected
- `GET /api/health` → unaffected
- All existing test suites still pass
- `config/startingScreens` document deleted → GET returns empty, no crash
- Feature rolled back → Firestore document harmlessly orphaned

### Kotlin Unit Tests

#### StartingScreenService/Repository

- Parses API response with all fields
- Handles missing optional fields
- `contentHash` match → cache hit
- `contentHash` mismatch → cache miss, triggers update
- Blocking screen detected → blocking state
- No blocker → proceed state
- API failure + cached blocker → blocking (fail-safe)
- API failure + no cache → proceed (fail-open)
- `frequency: "once"` + already dismissed → filtered out
- `frequency: "every_launch"` → always included
- Allowlist override from API response respected
- Date-expired screen removed from API → cache cleared
- Unknown template value → fallback to `info`
- Unknown imageType → render without custom image
- Unknown fields in response → ignored
- Malformed JSON → treated as API failure
- API 500 → treated as failure
- API timeout → treated as failure
- Background image URL construction from R2 key
- Background image 404 → screen shown without background

#### Caching

- Blocking screen cached after API success
- Cache updated when `contentHash` changes
- Cache cleared when blocker no longer in response
- Dismissed one-time IDs persisted across restarts
- Background image path cached alongside content
- Cache version mismatch → discarded
- Corrupt cache → treated as empty
- Zero-byte cache → treated as empty
- Truncated cache → treated as empty
- Atomic write (temp file + rename)
- Disk full → logged, API response used
- Old background images cleaned up on change
- Cache survives app update
- Cache file size < 5KB for 1 screen

#### X-Device-Id Header

- Present on all API calls (GET, POST, PUT, DELETE)
- Present on unauthenticated calls (config, health)
- Present on authenticated calls
- Value matches ANDROID_ID
- Value non-empty
- Value consistent across calls
- Value persists across app restarts

#### StartingScreen Composable

- ShyTalk branding always present
- Template default icon when no imageType
- Specific image when imageType set (police duck)
- Title rendered
- Message rendered
- Dismiss button visible when dismissable
- Dismiss button absent from tree when non-dismissable (not just hidden)
- Background image rendered full-screen
- Dark overlay (0.6 alpha) over background image
- No background image → solid theme background
- Background image loading → solid background, image fades in
- Scrollable on small screens
- Accessible content descriptions
- Touch target ≥ 48dp on dismiss button
- Contrast ratio ≥ 4.5:1 for body text
- Very long title (100 chars) → wraps
- Very long message (500 chars) → scrollable
- RTL locale → layout mirrors
- Dark mode → themed correctly
- Large font (200% scale) → scrollable
- Foldable fold/unfold → recomposes
- Display cutout → content below cutout
- testTag on key elements

#### State Machine

All transitions tested (see design section on state machine):
- `NO_CACHE → API_LOADING → BLOCKED`
- `NO_CACHE → API_LOADING → PROCEED_NORMAL` (no blocker)
- `NO_CACHE → API_LOADING → PROCEED_NORMAL` (API fail)
- `CACHED_BLOCKER → API_LOADING → BLOCKED` (confirmed)
- `CACHED_BLOCKER → API_LOADING → BLOCKED` (API fail, fail-safe)
- `CACHED_BLOCKER → API_LOADING → PROCEED_NORMAL` (blocker removed)
- `BLOCKED → DISMISSED` (allowlisted)
- `DISMISSED → PROCEED_NORMAL`
- Invalid transitions verified impossible

#### Absence Testing

- Blocking screen: no Firebase Auth initialised
- Blocking screen: no RTDB connection
- Blocking screen: no LiveKit
- Blocking screen: no FCM token registration
- Blocking screen: no permission requests
- Blocking screen: no sound/haptics
- Blocking screen: no analytics events
- Blocking screen: no WorkManager scheduling
- Blocking screen: no notification channels created

#### Platform-Specific

- Back button consumed on non-dismissable
- Back button dismisses on dismissable
- Home → return → still blocked
- App killed → restart → cached blocker shown
- PIN/biometric check: blocking screen shown BEFORE PIN prompt
- Deeplink while blocked → blocker shown, intent discarded
- Notification tap while blocked → blocker shown
- System locale change while displayed → recomposes
- Theme change while displayed → recomposes
- Font scale change → layout adapts
- Split-screen mode → renders correctly

#### Regression

- **Ordering invariant:** starting screen check runs BEFORE unsafe device check, force update check, health check, and auth
- ForceUpdateScreen still works after starting screens addition
- UnsafeDeviceScreen still works
- DegradedModeScreen still works
- Legal acceptance still works
- Auth flow unchanged
- No starting screens active → startup time increase < 100ms
- **Blocker vs suspension/ban priority:** when a blocking starting screen is active, suspension/ban checks never run (those are post-auth). This is intentional — the starting screen blocks the entire app before auth. If a user is both blocked by starting screen AND suspended/banned, the starting screen takes precedence. Once the starting screen is disabled, the suspension/ban check runs normally on next launch. Document this in the spec as expected behaviour, not a bug.

#### Property-Based (Kotest)

- Any valid StartingScreen: serialise → parse → identical
- Any valid title (3-100 chars): renders without crash
- Any valid message (10-500 chars): renders without crash
- Any template × imageType × backgroundImage combo: renders without crash
- `contentHash` deterministic: same input → same hash
- `contentHash` distinct: any field change → different hash
- Any screen with `dismissable: false` → dismiss button absent
- Any screen with `dismissable: true` → dismiss button present

#### Flaky Test Prevention

- All time tests use `jest.useFakeTimers()` / `TestCoroutineScheduler`
- All network tests use mock HTTP client
- All cache tests use in-memory or temp directory
- No `Thread.sleep()` or `delay()` — use `advanceUntilIdle()` / `runTest`
- Each test sets up and tears down own state

### E2E Gherkin Scenarios

#### Blocking

- Blocking screen prevents app access — no auth, no navigation
- Back button has no effect
- Cannot swipe to dismiss
- Home → return → still blocked
- App killed → relaunch → still blocked (cache)
- Admin disables → next launch proceeds normally
- Admin changes content → next launch shows updated content
- API failure + cached blocker → blocked
- API failure + no cache → normal app loads
- App left on blocking screen for 1 hour → no crash/ANR

#### Dismissable

- Tap dismiss → normal app loads
- Back button acts as dismiss
- One-time: shown once, not on next launch
- One-time: NOT dismissed (app killed before) → shown again on next launch
- Every-launch: shown on every start
- 3 dismissable screens → shown in sequence, dismiss all → app loads
- Mix of once + every-launch → correct filtering after dismissals

#### Allowlist

- Blocking screen + allowlisted device → dismiss button appears
- Allowlisted device removed → next launch blocked again

#### Scheduling

- Before start date → not shown
- After start date → shown
- After end date → not shown
- Boundary: app launched exactly on startDate → shown

#### Visual

- Background image displayed behind content with overlay
- No background → solid themed background
- Content readable over background image
- All 4 templates render correctly
- ShyTalk branding visible on every template
- Police duck renders for warning template with imageType
- Small screen device → scrollable, nothing cut off
- Large screen → centred, not stretched
- Dark mode → correct theme
- Light mode → correct theme
- Portrait and landscape

#### Pipeline

- Admin creates screen → app shows it
- Admin updates title → app shows new title
- Admin uploads background image → appears on device
- Admin changes template → new styling
- Admin sets start date → screen appears after date

#### Test Data Management

- Given/Then with test helper API for setup/teardown
- Each scenario isolated (unique screen IDs or clear between tests)
- Test device ID deterministic and known

### Playwright Tests (Admin Panel)

#### Section Navigation

- Starting Screens section visible in nav
- `#starting-screens` deep link works
- Browser refresh → section reloads
- Browser back → returns to previous section

#### CRUD Operations

- Create new screen with all fields → saves successfully
- Edit existing screen → saves
- Delete screen → confirmation → removed
- Create with every template × dismissable × frequency combo (16 combinations)

#### Device Preview

- Preview shows phone frame
- Updates live as title/message typed
- Updates when template changes
- Shows background image with overlay when uploaded
- Shows/hides dismiss button based on toggle
- Shows ShyTalk branding
- Non-interactive (clicking dismiss in preview does nothing)
- Scrolls if content overflows frame

#### Validation

- Title < 3 chars → error
- Title > 100 chars → error
- Message < 10 chars → error
- Message > 500 chars → error
- Character counter visible, turns red at limit
- Cannot enable two non-dismissable → toggle disabled with tooltip
- Start date after end date → error
- End date in past → error
- Saving with invalid fields → error toast with specific field

#### Background Image

- Upload → shows compression savings
- Upload > 10MB → rejected
- Upload non-image → rejected
- Drag-and-drop upload works
- Upload progress indicator
- Remove → preview reverts to solid background
- Dimensions displayed after upload

#### Dates

- Start date picker works
- End date picker works
- UTC offset shown
- Active/Scheduled/Expired badge correct
- Scheduled: countdown shown

#### Allowlist

- Device IDs: one per line, validates non-empty
- Networks: one per line, validates IP/CIDR
- Paste from clipboard → parsed
- Trailing whitespace trimmed

#### State Management

- Unsaved changes → browser confirmation on navigate
- Rapid save clicks → debounced, single API call
- Page refresh → repopulates from Firestore
- Concurrent tabs → last write wins
- API down on load → error with retry
- API down on save → error with retry

#### Accessibility

- All fields have `<label>`
- Tab order follows visual order
- Focus visible on all elements
- Screen reader announces validation errors
- Keyboard-only operation: create, edit, save, delete

#### Cross-Browser

- Chrome, Firefox, Safari, Edge latest
- Mobile Chrome, Mobile Safari

### iOS Tests (XCTest)

#### StartingScreenView

- Renders ShyTalk branding
- Renders title and message
- Shows dismiss button when dismissable
- Hides dismiss button when non-dismissable (absent from hierarchy)
- Renders background image (ContentMode.fill, clipped, centred)
- Renders without background image (solid systemBackground)
- Dark overlay rendered above image, below text
- Dark mode themed correctly
- Light mode themed correctly
- iPhone SE → renders correctly
- iPhone 16 Pro Max → renders correctly
- iPad → renders correctly
- iPad multitasking slide-over → adapts
- iPad Stage Manager → variable window size
- Landscape → adapts
- Dynamic Type XXL → scrollable, no clipping
- Bold Text → renders bold
- Reduce Motion → no animations
- Reduce Transparency → overlay adjusted
- VoiceOver reading order: branding → image → title → message → dismiss
- VoiceOver focus trapped on blocking screen
- Switch Control → all elements reachable
- RTL (Arabic) → mirrored
- Long German text → scrollable, no truncation
- CJK characters → render correctly
- Emoji → render correctly

#### Blocking Behaviour

- Blocks further view hierarchy loading
- Swiping back does not dismiss
- No navigation bar visible
- Status bar visible
- Home indicator visible

#### Caching

- Cache stores and retrieves blocking screen
- Cache cleared when API says disabled
- `contentHash` mismatch → cache updated
- `contentHash` match → cached content used
- Background image cached to disk
- Background image cache cleared on screen disable
- Corrupt file cache (cachesDirectory JSON) → treated as empty
- Cache survives app update
- Cache survives iOS update

#### Networking

- `X-Device-Id` sent with identifierForVendor
- `identifierForVendor` nil → header omitted gracefully
- API timeout (10s) → falls back to cache
- API failure + cache → cached blocker
- API failure + no cache → proceeds
- Correct URL for prod environment

#### Privacy

- `identifierForVendor` in PrivacyInfo.xcprivacy
- Cache in Caches directory (not iCloud backed up)

#### State Machine

All transitions mirroring Kotlin tests.

#### Upgrade/Downgrade

- Version without feature → update → clean first fetch
- Cached blocker → update → cache survives
- Dismissed once-screens → update → survive
- Downgrade → orphaned data, no crash

---

## 7. i18n

### New String Keys

For all 19 locales + default:

**Android** (`shared/src/commonMain/composeResources/values*/strings.xml`):
- `starting_screen_pre_launch_title` — "ShyTalk is not available yet"
- `starting_screen_pre_launch_message` — "ShyTalk has not been released yet. To apply to test the application, contact Shyden. Testing is available for iOS and Android users."
- `starting_screen_dismiss` — "Dismiss" / "Continue"
- `starting_screen_police_duck_description` — "Warning illustration"
- `starting_screen_loading` — "Loading…" (used during startup check spinner — do NOT reuse `checking_for_updates` which is misleading)

**iOS** (`Localizable.xcstrings` String Catalog) — same keys including `starting_screen_loading`.

### i18n Testing
- All 19 locale files contain new keys (i18n-checker validation)
- Missing key → falls back to English default
- Arabic → full RTL layout mirroring
- German → long text wraps, scrollable
- Japanese/Chinese → correct line breaking
- Thai/Hindi → complex script rendering correct
- Emoji in strings → rendered correctly

---

## 8. Implementation Order

1. Express API: Install `sharp` (`npm install sharp@x.x.x --save-exact`) + `utils/imageCompressor.js` + storage upload integration + tests. Note: adding `originalSize`/`compressedSize` to upload response is additive (non-breaking for existing callers)
2. Express API: `config/startingScreens` dedicated GET/PUT routes (registered BEFORE generic `:key` routes) + `router.all` 405 catch-all + validation + allowlist + tests
3. Express API: contract tests
4. Android: `X-Device-Id` header on all API calls + tests
5. Android: `StartingScreen` data class + service + repository + caching + tests
6. Android: `StartingScreen` composable + tests
7. Android: `MainActivity` startup chain integration + tests
8. Android: i18n strings (all 19 locales)
9. Android: E2E Gherkin scenarios
10. iOS: `X-Device-Id` header + `StartingScreenView` + caching + tests
11. iOS: Entry point integration + i18n
12. Admin panel: Starting Screens section + preview + tests
13. Playwright tests
14. Integration testing + deployment verification
