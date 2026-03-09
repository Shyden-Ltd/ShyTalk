# Admin Panel Users Tab — Design Document

**Date:** 2026-03-09
**Scope:** 14 items — bug fixes, UI improvements, and new features for the admin panel Users tab

---

## 1. Quick Fixes

### 1a. Remove phone number field
Delete the phone number row from the Identity card in the admin HTML.

### 1b. Show email address
The email field exists with a show/hide toggle. Verify the field is populated from user data and fix if not.

### 1c. Report history internal server error
Debug `GET /api/reports?status=resolved&userId={uid}` — identify and fix the 500 error.

### 1d. Coins/beans "auth/network-request-failed"
Debug `POST /api/users/:uid/adjust-balance`. May already be fixed by the CORS `x-session-trace-id` fix. Verify and fix any remaining issues.

### 1e. Transaction history "auth/network-request-failed"
Same pattern as coins/beans. Debug `GET /api/users/:uid/transactions`.

### 1f. Save changes button does nothing
Trace the click handler: `getModifiedFields()` → `PATCH /api/user/:uid`. Determine if the handler isn't wired, fields aren't detected as changed, or the API call silently fails.

### 1g. Cannot access another user's backpack
Debug `GET /api/users/:uid/backpack`. Fix the route or the admin panel's request.

---

## 2. SuperShy: Expiry Date Instead of Tier

Replace the SuperShy tier dropdown (Monthly/Yearly/Lifetime) with an expiry date picker.

- Keep the Super Shy yes/no toggle
- Replace tier dropdown with a date input for `superShyExpiry`
- Display current expiry if one exists
- Remove `superShyTier` from the admin UI (field remains in DB for backward compat)

---

## 3. Device Binding Card

Create a proper card in the Users tab showing all bound device information:

- Manufacturer + model
- OS version
- App version + build number
- Screen resolution + density
- Network type + carrier
- Last IP + ISP + ASN
- Country + region
- First seen + last seen timestamps
- "Reset Device Binding" button (moved from Identity section)

Data source: `deviceBindings` collection via `GET /admin/devices/user/:userId`.

---

## 4. Users Tab Sub-tabs

Split the Users tab into three sub-tabs to reduce scrolling:

### Profile sub-tab
- Profile Preview Panel (new — see section 8)
- Identity (minus phone number)
- Profile (description, photos)
- Privacy (checkboxes)
- Timestamps (DOB, created, last seen)
- Lists (Blocked, Following, Followers, Stalkers)

### Moderation sub-tab
- Suspension
- Bans & Restrictions (enhanced with per-device bans — see section 7)
- Device Binding Card (new — see section 3)
- Good Character Score
- Warnings
- Report History

### Economy sub-tab
- Coins/Beans (with add/deduct)
- SuperShy (with expiry date — see section 2)
- Login Streak
- Pity Counter
- Backpack
- Transaction History

**Fixed elements:** Search bar stays at top, Save Changes button stays at bottom across all sub-tabs.

---

## 5. System Messages on Admin Changes

When an admin modifies user-visible data, send a system PM via `sendSystemPm()`.

**Triggering actions:**
- Display name changed or cleared
- Profile photo or cover photo cleared
- Description cleared
- Suspension applied or lifted
- Warning issued
- Coins/beans adjusted (add or deduct)
- SuperShy toggled or expiry changed
- Device binding reset
- Ban applied or lifted

**Message format:** Neutral notifications, e.g.:
- "Your display name was updated by a moderator."
- "Your account has been suspended. Reason: {reason}"
- "{amount} coins were added to your account."

---

## 6. Temporary Unique ID

### Data model
Add three fields to the User model (`User.kt`):
- `tempUniqueId: Long? = null` — the temporary display ID
- `tempUniqueIdExpiry: Long? = null` — expiry timestamp (millis)
- `tempUniqueIdOriginal: Long? = null` — stores the real ID for reference

### Validation rules
- **Real IDs are permanently unique** — no user can ever take another user's real ID as their own real or temp ID
- **Temp IDs are unique while active** — only one user holds a given temp ID at a time
- **Temp IDs are recyclable** — once expired or cleared, the value can be reused

### API endpoints
- `GET /api/admin/users/check-id/:id` — check availability
  - Returns `{available: bool, conflictType?: "real"|"temp", conflictUser?: uniqueId}`
- `POST /api/admin/users/:uid/temp-id` — set temp ID with `{tempUniqueId, expiryDate}`
  - Server-side validates conflicts before applying
- `DELETE /api/admin/users/:uid/temp-id` — clear temp ID

### Admin UI (Identity section, Profile sub-tab)
- Temp ID input + expiry date picker + "Check Availability" button + Apply/Clear buttons
- Check button shows green/red result: "Available" or "ID 12345678 is in use as [real/temp] ID by user {uniqueId}"
- Apply also validates server-side and blocks on conflict

### Search
Extend user search to check `tempUniqueId` in addition to `uniqueId`.

### App display
Add `User.displayUniqueId` utility (in shared Kotlin code):
- If `tempUniqueId` is set and not expired → return `tempUniqueId`
- Otherwise → return `uniqueId`
- Used everywhere uniqueId is displayed (profile, chat, room seats, etc.)

### Expiry cron
Daily cron job clears expired temp IDs (sets all three fields to null).

---

## 7. Per-device Bans with Full Device Info

Enhance the Bans & Restrictions card in the Moderation sub-tab:

- **Device list with full info** — each bound device as an expandable card showing all collected data (manufacturer, model, OS, IP, ISP, ASN, country, region, etc.)
- **Per-device ban button** — each device gets "Ban This Device" with reason input + optional duration
- **Ban status indicator** — banned devices show red badge with reason + expiry
- **Per-device unban** — banned devices get an "Unban" button

Existing API endpoints: `POST /admin/bans/device`, `DELETE /admin/bans/device/:deviceId`, `GET /admin/devices/user/:userId`.

---

## 8. Profile Preview Panel

A visual rendering of the user's profile at the top of the Profile sub-tab, styled to match the app.

**Displays:** Profile photo, cover photo, display name, unique ID (or active temp ID), nationality flag, SuperShy badge, user type badge, description, follower/following counts.

**Two modes (toggle button):**
- **Current** — shows live saved data from the server
- **Preview** — updates in real-time as admin edits form fields (before saving)

Front-end only — no API changes.

---

## Architecture Notes

- All admin panel changes are in `public/admin/index.html` (single-file admin panel)
- API changes in `express-api/src/routes/` and `express-api/src/utils/`
- User model changes in `shared/src/commonMain/.../core/model/User.kt`
- System messages use existing `sendSystemPm()` from `express-api/src/utils/system-pm.js`
- Sub-tabs are CSS/JS only, no API changes
- Profile preview is front-end only
