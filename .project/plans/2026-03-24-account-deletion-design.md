# Account Deletion — Design Spec

**Date:** 2026-03-24
**Status:** Approved
**Priority:** Critical (GDPR Article 17, required by both app stores)

## 1. Overview

Configurable account deletion with a grace period (default 30 days). During the grace period the account remains fully visible and functional to other users — no visible change. The owner is signed out and cannot use the app, but can sign back in to cancel. After the grace period, a cron job hard-deletes all user data across Firestore, R2 storage, Firebase Auth, and RTDB. Bans are never deleted. Minimal anonymized audit records are retained.

## 2. Triggers

| Trigger | Actor | Auth Required |
|---|---|---|
| Self-request | User | Owner auth + PIN/biometric verification |
| Admin force-delete | Admin | Admin role |
| Inactivity auto-delete | Cron | None (system) |

## 3. Configuration

Stored in `config/app` Firestore document:

```json
{
  "accountDeletionGracePeriodDays": 30,
  "inactiveAccountDeleteMonths": 0
}
```

- `accountDeletionGracePeriodDays`: Days between request and hard delete. Default 30. Set 0 for immediate.
- `inactiveAccountDeleteMonths`: Months of inactivity before auto-scheduling deletion. Default 0 (disabled).

Both configurable via admin panel or direct Firestore edit.

> **GDPR justification:** The grace period is a cooling-off period under GDPR Article 17(1) — erasure "without undue delay" permits reasonable safeguards against accidental deletion. 30 days is within the ICO's 1-month response window for data subject requests.

## 4. API Endpoints

### 4.1 POST /api/users/:uniqueId/delete

**Auth:** Owner (requireOwner middleware)
**Body:** `{ pin: string }` or `{ biometricSignature: string, deviceId: string }`
**Flow:**
1. Verify PIN or biometric
2. Set deletion fields on user doc
3. Revoke Firebase Auth refresh tokens (signs out all devices)
4. Send email notification to user's registered email
5. Send push notification to all FCM tokens
6. Return `{ success: true, deleteAt: timestamp }`

### 4.2 POST /api/admin/users/:uniqueId/delete

**Auth:** Admin (requireAdmin middleware)
**Body:** `{ reason: string }` (optional admin note)
**Flow:** Same as 4.1 but skips PIN verification. Logs admin action to adminAuditLog.

### 4.3 POST /api/users/:uniqueId/cancel-delete

**Auth:** Owner
**Flow:**
1. Verify `deletionScheduledAt` is set and `deletionExecuteAt` is in the future
2. If `deletionReason` is `"admin"`, return 403 — admin-initiated deletions cannot be cancelled by the user
3. Clear deletion fields
4. Return `{ success: true }`

> **Note:** This endpoint must never be gated behind a pending-deletion auth check.

### 4.4 GET /api/users/:uniqueId/deletion-status

**Auth:** Owner or Admin
**Response:** `{ scheduled: boolean, scheduledAt: number | null, executeAt: number | null, reason: string | null, daysRemaining: number | null }`

## 5. User Document Changes

Add fields to `users/{uniqueId}`:

| Field | Type | Default | Description |
|---|---|---|---|
| `deletionScheduledAt` | `number \| null` | `null` | Timestamp when deletion was requested |
| `deletionReason` | `string \| null` | `null` | `"self"`, `"admin"`, or `"inactivity"` |
| `deletionExecuteAt` | `number \| null` | `null` | Timestamp when hard delete should run |

## 6. Grace Period Flow

### 6.1 User Requests Deletion

```
User taps "Delete Account" in settings
  -> PIN/biometric verification dialog
  -> POST /api/users/:uniqueId/delete
  -> Server sets deletion fields:
       deletionScheduledAt = Date.now()
       deletionReason = "self"
       deletionExecuteAt = Date.now() + (gracePeriodDays * 86400000)
  -> Revoke refresh tokens (auth.revokeRefreshTokens)
  -> Evict from active room (same logic as evictSuspendedUser — remove from participantIds, clear seat, clear currentRoomId)
  -> Send email: "Your account is scheduled for deletion on [date].
     If you didn't request this, sign in before [date] to cancel."
  -> Send push notification to all FCM tokens: same message
  -> Client receives success -> sign out -> return to sign-in screen
```

### 6.2 User Signs In During Grace Period

```
User signs in (Firebase Auth still works)
  -> resolveIdentityAndProceed runs
  -> Detects user.deletionScheduledAt != null
  -> Shows dialog: "Your account is scheduled for deletion on [date].
     Would you like to cancel the deletion?"
  -> User taps "Cancel Deletion":
       -> POST /api/users/:uniqueId/cancel-delete
       -> Clears deletion fields
       -> Normal sign-in continues
  -> User taps "Continue with Deletion":
       -> Sign out
```

### 6.3 During Grace Period (Other Users)

No visible change. The account appears normal to everyone else:
- Profile is visible and unchanged
- Messages remain in conversations
- Rooms they own stay active
- Follower/following lists unchanged

### 6.4 Admin Requests Deletion

Same as 6.1 but triggered from admin panel. Admin provides an optional reason note. Logged to adminAuditLog.

## 7. Hard Delete Sequence

Executed by the `accountDeletion` cron after grace period expires. Order matters.

### Step 0: Capture data needed for notifications and audit
```
Read user doc -> store email, firebaseUid, uniqueId, isSuspended
```

### Step 1: Send final email
```
Send email: "Your ShyTalk account and all associated data have been permanently deleted."
(Must happen before user doc is deleted — need the email address)
```

### Step 2: R2 storage
```
Delete all files under these prefixes:
  - profiles/{uniqueId}/
  - covers/{uniqueId}/
  - messages/{uniqueId}/
  - groups/{uniqueId}/
  - evidence/{uniqueId}/
```

### Step 3: Conversations
```
Query conversations where participantIds contains uniqueId
For each conversation:
  - Delete subcollections: messages, userSettings, mutes, settings, mod_log
  - Delete conversation doc
```

### Step 4: Rooms
```
Query rooms where participantIds contains uniqueId
For each room:
  - Remove from participantIds, firstJoinTimestamps
  - If user is ownerId: delete room + subcollections (messages, seatRequests)
  - Clear RTDB presence data at /rooms/{roomId}/
```

### Step 5: Other users' arrays
```
Query users where followerIds contains uniqueId -> arrayRemove
Query users where followingIds contains uniqueId -> arrayRemove
```

### Step 5b: Gift rankings
```
Query giftRankings documents and remove entries where userId matches the deleted user.
```

### Step 6: Reports & appeals
```
Delete from reports where reportedUserId == uniqueId OR reporterId == uniqueId
Delete from reportsArchive where reportedUserId == uniqueId OR reporterId == uniqueId
Delete from suspensionAppeals where userId == uniqueId
Delete from reportLocks where relevant
```

### Step 7: Auth-related
```
Delete biometricKeys by doc ID prefix pattern: all docs starting with {uniqueId}:
Delete otpCodes associated with user's email
Delete emailMetrics associated with user's email
Mark purchaseReceipts where userId == uniqueId for deferred deletion
```

> **Note:** Purchase receipts are retained for 180 days for financial audit compliance, then deleted by a separate cleanup cron.

### Step 8: User doc + subcollections
```
Delete subcollections: backpack, giftWall, transactions, warnings, stalkers
Delete users/{uniqueId}
```

### Step 9: Identity map (soft-delete)
```
Query identityMap where uniqueId == deletedUser.uniqueId
(identityMap docs have a uniqueId field — see users.js line 125)
For each matching entry:
  Set:
    unlinked: true
    unlinkedAt: timestamp
    deletedAccount: true
    deletionStanding: isSuspended ? "suspended" : "clean"
  Do NOT delete the document (prevents identity reuse for suspended accounts)
```

### Step 10: Device bindings
```
Delete from deviceBindings where uniqueId == deletedUser.uniqueId
(Releases device for new account creation — ban check is separate)
```

### Step 11: Firebase Auth
```
auth.deleteUser(firebaseUid)
(LAST data operation — after this, no auth-based queries are possible)
```

### Step 12: Audit log
```
Write to adminAuditLog:
  action: "account_deleted"
  timestamp: Date.now()
  hashedUniqueId: HMAC-SHA256(serverSecret, String(uniqueId))
  reason: deletionReason
  triggeredBy: "system" | adminUid
  dataDeleted: ["user", "conversations", "rooms", "r2", "reports", ...]
  standing: "clean" | "suspended"
  (ZERO PII — uniqueId is hashed, no email, no name)
  Note: Server secret stored in environment variable AUDIT_HASH_SECRET.
        HMAC prevents rainbow table attacks on sequential IDs.
```

### What is NOT deleted

- `deviceBans` — preserved always
- `networkBans` — preserved always
- `adminAuditLog` entries — preserved for audit trail
- `logs` entries — preserved for system audit
- Identity map documents — soft-deleted only (prevents re-registration for suspended users)

## 8. Re-registration Logic

When a user tries to register with an identity that has `deletedAccount: true`:

```
Check identityMap entry:
  if deletionStanding == "clean":
    -> Allow registration as brand new account (new uniqueId)
    -> Replace old identity map entry with new uniqueId
  if deletionStanding == "suspended":
    -> Block: "Unable to create account"
```

Device and network ban checks happen BEFORE the sign-in/registration page (existing behaviour at device-info level), so they are not part of this logic.

## 9. Inactivity Auto-Delete

When `inactiveAccountDeleteMonths > 0`:

```
Cron queries: users where lastActiveAt < (now - thresholdMonths)
  AND deletionScheduledAt == null
  AND isSuspended == false (don't auto-delete suspended accounts)
For each:
  Set deletion fields with reason "inactivity"
  Send email notification
  (No push notification — user is inactive, likely has no active sessions)
```

`lastActiveAt` must be implemented as a new field updated in the auth middleware on each authenticated request. This is a prerequisite for the inactivity auto-delete feature. If not implemented before the deletion feature launches, the inactivity auto-delete should be disabled (set threshold to 0).

## 10. Cron Job

**Name:** `accountDeletion`
**Schedule:** Daily at 03:00 UTC
**Environment:** Both dev and prod (but Firestore-quota-aware)

```javascript
async function accountDeletion() {
  // 1. Process scheduled deletions past their execute date
  const pendingSnap = await db.collection('users')
    .where('deletionExecuteAt', '>', 0)
    .where('deletionExecuteAt', '<=', Date.now())
    .limit(10)  // Firestore quota awareness
    .get();

  for (const doc of pendingSnap.docs) {
    try {
      // Step 0a: Re-read deletionExecuteAt inside the function.
      // If null (cancelled during cron execution), abort.
      const freshDoc = await db.collection('users').doc(doc.id).get();
      if (!freshDoc.exists || !freshDoc.data().deletionExecuteAt) continue;

      await hardDeleteAccount(freshDoc);
    } catch (err) {
      log.error('cron', 'Account deletion failed', { uniqueId: doc.id, error: err.message });
    }
  }

  // 2. Schedule inactive accounts (if enabled)
  const config = await getAppConfig();
  const thresholdMonths = config.inactiveAccountDeleteMonths;
  if (thresholdMonths > 0) {
    const cutoff = Date.now() - (thresholdMonths * 30 * 86400000);
    const inactiveSnap = await db.collection('users')
      .where('lastActiveAt', '<', cutoff)
      .where('deletionScheduledAt', '==', null)
      .where('isSuspended', '==', false)
      .limit(10)
      .get();

    for (const doc of inactiveSnap.docs) {
      await scheduleAccountDeletion(doc, 'inactivity', config.accountDeletionGracePeriodDays);
    }
  }
}
```

**Limit of 10 per run:** Prevents Firestore quota exhaustion on dev (each account deletion does 50-500+ operations). At 10/day, this handles up to 3,650 deletions/year.

## 11. Notifications

Use `wrapTemplate()` from `email-templates.js`. Add `buildDeletionScheduledEmail(date)` and `buildDeletionCompleteEmail()` functions following the existing branded HTML template pattern.

### 11.1 On Deletion Request

**Email** (to user's registered email, via `buildDeletionScheduledEmail(date)`):
```
Subject: Your ShyTalk account is scheduled for deletion

Body (rendered via wrapTemplate):
Your ShyTalk account has been scheduled for deletion. All your data will
be permanently deleted on [date].

If you did not request this, sign in to ShyTalk before [date] to cancel.

If you have any questions, contact shytalk.help@gmail.com
```

**Push notification** (to all user's FCM tokens):
```
Title: Account Deletion Scheduled
Body: Your account will be deleted on [date]. Sign in to cancel.
```

### 11.2 On Hard Delete Complete

**Email** (sent BEFORE deleting user doc, via `buildDeletionCompleteEmail()`):
```
Subject: Your ShyTalk account has been deleted

Body (rendered via wrapTemplate):
Your ShyTalk account and all associated data have been permanently deleted.

If you believe this was an error, contact shytalk.help@gmail.com
```

No push notification (FCM tokens deleted at this point).

## 12. Android App Changes

### 12.1 AppSettingsScreen.kt
Replace placeholder "not available" dialog with:
1. Confirmation dialog explaining the grace period
2. PIN/biometric verification
3. API call to `POST /api/users/:uniqueId/delete`
4. Success → sign out → return to sign-in screen

### 12.2 AuthViewModel.kt
In `resolveIdentityAndProceed`, after identity resolution:
1. Check if `user.deletionScheduledAt != null`
2. If set, update UI state with `isPendingDeletion = true`
3. Show cancellation dialog in SignInScreen

### 12.3 New Strings (19 locales)
- `delete_account_title`: "Delete Account"
- `delete_account_confirm`: "Your account and all data will be permanently deleted after [days] days. You can cancel by signing in before then." (replaces existing `delete_account_description`)
- `delete_account_scheduled`: "Your account is scheduled for deletion on %1$s. Would you like to cancel?"
- `delete_account_cancel`: "Cancel Deletion"
- `delete_account_continue`: "Continue with Deletion"
- `delete_account_success`: "Your account has been scheduled for deletion."
- `delete_account_pin_required`: "Verify your identity to delete your account"

## 13. Admin Panel Changes

In the user profile section of the admin panel:
- "Schedule Deletion" button (with confirmation dialog and reason input)
- "Cancel Scheduled Deletion" button (when pending)
- Status badge: "Deletion scheduled - [days] days remaining"
- Deletion events visible in the audit log tab

## 14. Firestore Indexes Required

```json
{
  "collectionGroup": "users",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "deletionExecuteAt", "order": "ASCENDING" }
  ]
}
```

Also needed for identity map cleanup (Step 9):
```json
{
  "collectionGroup": "identityMap",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "uniqueId", "order": "ASCENDING" }
  ]
}
```

Also needed for inactivity query:
```json
{
  "collectionGroup": "users",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "lastActiveAt", "order": "ASCENDING" },
    { "fieldPath": "deletionScheduledAt", "order": "ASCENDING" },
    { "fieldPath": "isSuspended", "order": "ASCENDING" }
  ]
}
```

## 15. Testing Strategy

### Express API (Jest)
- All 4 endpoints: success, auth failure, validation, not found, server error
- Hard delete function: verify all 12 steps execute in order
- Cron: normal run, no pending deletions, error handling, quota limit
- Re-registration: clean standing allows, suspended blocks
- Notification sending: email + push on request, email on completion

### Kotlin (JUnit/MockK)
- ViewModel: deletion request flow, cancellation flow, pending deletion detection
- UI state transitions for all deletion states

### E2E Gherkin
- Full lifecycle: request → grace period → cancellation
- Full lifecycle: request → grace period → hard delete
- Admin-initiated deletion

### Playwright
- Admin panel: schedule deletion, cancel deletion, status badge

## 16. Firestore Quota Impact

Per account deletion (hard delete):
- Reads: ~50-200 (query conversations, rooms, reports, followers)
- Writes: 0 (no new docs created except audit log)
- Deletes: ~50-500 (all user data)
- R2 operations: ~5-20 (list + delete per prefix)

At limit of 10 deletions per cron run: max ~5,000 ops/day. Within Spark quota if combined with the dev usage reductions already in place.
