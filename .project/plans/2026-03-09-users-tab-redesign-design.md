# Users Tab Redesign — Design Document

**Date:** 2026-03-09

## Overview

Redesign the admin panel Users tab to replace the global "Save Changes" button with per-field auto-save, reorganise card layouts across sub-tabs, add side-by-side profile preview, and redesign the backpack card as a visual grid.

---

## 1. Auto-Save System

### Behavior
- All editable fields save on **blur** (text/number inputs) or **change** (select/checkbox/datetime)
- Each save sends `PATCH /user/:uid?silent=true` with a single field
- Inline feedback next to the field: "✓ Saved" + "Undo" link; undo fades after 5 seconds
- On failure: red border flash + "Failed" text

### Batched PM Notifications
- First auto-save starts a 30-second debounce timer, accumulates changed field names
- Each subsequent save resets the timer
- Timer fires OR admin navigates to a different user → one PM sent summarizing changes
- New endpoint: `POST /api/admin/users/:uid/notify-changes` with `{ fields: [...] }`
- **Notifiable fields only:** displayName, userType, email, description, profilePhotoUrl, coverPhotoUrl
- **Not notified:** nationality, gender, dateOfBirth, privacy toggles, economy fields, moderation fields, lists

### Removed
- Global "Save Changes" button
- "X fields modified" counter
- `.modified` field highlighting
- Sub-tab unsaved change dot indicators
- `getModifiedFields()` batching logic

---

## 2. Profile Sub-tab Layout

1. **Side-by-side Preview** — Current (left) | Draft (right)
   - Both show: avatar, cover photo, displayName, uniqueId, userType badge, description, nationality flag
   - Counts row: Following / Followers / Stalkers
   - Draft updates in real-time as fields are edited below
2. **Identity card** — displayName, userType, nationality, description
3. **Account card** — email, dateOfBirth, uniqueId (read-only), tempId
4. **Media card** — profilePhotoUrl, coverPhotoUrl
5. **Privacy card** — hideFollowing, hideOnlineStatus, hideAge
6. **Lists card** — blockedUserIds, followingIds, followerIds, stalkers (read-only fetch from subcollection)

---

## 3. Moderation Sub-tab Layout

1. **Account Info card** — createdAt, lastSeenAt (read-only) — moved from Profile
2. **Device Binding card** — current device info, unbind action
3. **GCS card** — gcsScore, gcsDisplayScore, reset GCS action
4. **Warnings card** — warningCount, warningReason, hasActiveWarning, issue warning action
5. **Suspension & Bans card** — merged from separate Suspension + Bans cards:
   - Suspend/unsuspend actions, reason, end date
   - Device list with per-device ban/unban, network bans

---

## 4. Economy Sub-tab Layout

1. **Balance card** — shyCoins, shyBeans with add/deduct actions
2. **SuperShy card** — isSuperShy, superShyExpiry (auto-save)
3. **Stats card** — loginStreak, pityCounter (auto-save)
4. **Backpack card** — redesigned:
   - **Visual grid** (4-5 cards per row): gift icon image (from catalog iconUrl), gift name, quantity badge (top-right corner)
   - Click card to reveal quantity input, auto-saves on blur with inline Saved/Undo
   - Remove overlay button — auto-saves quantity to 0, shows undo
   - **Search bar + category filter** above the grid
   - **Add gift row** below grid: gift select dropdown with small icons + quantity input + Add button
   - **Clear All button** with destructive action protection:
     - Confirmation dialog with warning text: "This will permanently remove all items from this user's backpack"
     - 5-second countdown on confirm button (disabled until 0)
     - Cancel button always active

---

## 5. Backend Changes

- `PATCH /user/:uid` gains `?silent=true` query param — skips system PM when present
- New `POST /api/admin/users/:uid/notify-changes` endpoint — accepts `{ fields: ["displayName", ...] }`, sends one batched system PM to the user
