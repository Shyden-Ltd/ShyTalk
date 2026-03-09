# Admin Panel Users Tab — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 7 bugs, restructure the Users tab with sub-tabs, add system messages on admin changes, implement temporary Unique IDs, enhance device ban UI, and add a profile preview panel.

**Architecture:** All admin UI lives in a single file (`public/admin/index.html`). API routes are Express.js modules in `express-api/src/routes/`. The User model is shared Kotlin in `shared/src/commonMain/`. System messages use the existing `sendSystemPm()` utility.

**Tech Stack:** HTML/CSS/JS (admin panel), Express.js + Firebase Admin SDK (API), Kotlin Multiplatform (shared model), node-cron (scheduled jobs)

---

### Task 1: Remove phone number field

**Files:**
- Modify: `public/admin/index.html:2765` (phone input)
- Modify: `public/admin/index.html` (populateForm — remove phoneNumber handling)

**Step 1: Remove phone number HTML**

Delete the phone number field group around line 2765:
```html
<!-- DELETE this entire field group -->
<label>Phone Number</label>
<input type="text" data-field="phoneNumber" readonly aria-label="Phone Number">
```

**Step 2: Remove phone number from populateForm()**

In `populateForm()` (around line 4393), remove any reference to `phoneNumber` field population if present. The `data-field="phoneNumber"` auto-population should stop once the HTML element is removed.

**Step 3: Verify in browser**

Open `https://shytalk.shyden.co.uk/admin/`, search for a user, confirm phone number no longer appears.

**Step 4: Commit**
```
feat(admin): remove phone number field from Users tab
```

---

### Task 2: Fix email address display

**Files:**
- Modify: `public/admin/index.html` (populateForm email logic ~lines 4457-4462)
- Modify: `express-api/src/routes/admin-users.js` (GET /user/:uid ~lines 84-94)

**Step 1: Check API returns email**

Read `express-api/src/routes/admin-users.js` lines 84-94. The GET /user/:uid handler fetches email from Firebase Auth. Verify:
- Firebase Auth `getUser()` is called
- `email` field is included in the response
- No error swallowing that hides auth failures

**Step 2: Fix email population in admin panel**

In `populateForm()` around lines 4457-4462, the email is masked with `maskEmail()`. Verify:
- `data.email` is being read from the API response
- The `email-input` element receives the masked value
- The show/hide toggle works

If the email comes from Firebase Auth (not Firestore), ensure the API response includes it under the `email` key.

**Step 3: Test**

Search for a user in the admin panel. Confirm email appears (masked by default, revealed on Show click).

**Step 4: Commit**
```
fix(admin): ensure email address is displayed in Users tab
```

---

### Task 3: Fix report history internal server error

**Files:**
- Modify: `express-api/src/routes/reports.js` (~lines 134-240)

**Step 1: Reproduce and diagnose**

Call `GET /api/reports?status=resolved&userId={testUid}` via curl with a valid admin token. Check server logs for the error.

**Step 2: Fix the route handler**

Common causes:
- Missing index on Firestore query (compound query on `status` + `reportedUserId`)
- Field name mismatch (`userId` vs `reportedUserId` in query)
- Pagination/ordering issue

Fix the query to match the actual Firestore field names and ensure the compound query is supported.

**Step 3: Test via curl**

```bash
curl -H "Authorization: Bearer $TOKEN" "https://api.shytalk.shyden.co.uk/api/reports?status=resolved&userId=$UID"
```

Expected: 200 with `{ users: [...] }` or empty array.

**Step 4: Deploy and verify in admin panel**

**Step 5: Commit**
```
fix(api): fix report history query for resolved reports by userId
```

---

### Task 4: Fix coins/beans adjust-balance errors

**Files:**
- Modify: `express-api/src/routes/admin-economy.js` (~lines 49-107)
- Possibly modify: `public/admin/index.html` (coins/beans click handlers ~lines 6027-6062)

**Step 1: Reproduce and diagnose**

The error "Firebase: Error (auth/network-request-failed)" suggests the admin panel's client-side Firebase Auth is interfering, or the `apiCall()` function is failing. Since we fixed the CORS `x-session-trace-id` issue, test if this is already resolved.

**Step 2: If still broken, fix the endpoint**

Check `POST /api/users/:uid/adjust-balance` in admin-economy.js. Ensure:
- The route uses server-side Firebase Admin SDK (not client SDK)
- The auth middleware extracts the token correctly
- The Firestore transaction succeeds

**Step 3: Test via admin panel**

Search for a test user, attempt to add 100 coins. Confirm balance updates.

**Step 4: Commit**
```
fix(api): fix coins/beans balance adjustment endpoint
```

---

### Task 5: Fix transaction history errors

**Files:**
- Modify: `express-api/src/routes/admin-economy.js` (~lines 209-232)

**Step 1: Reproduce and diagnose**

Same "auth/network-request-failed" pattern. Test `GET /api/users/:uid/transactions` after the CORS fix.

**Step 2: Fix if still broken**

Ensure the route handler works and returns the correct response structure. The admin panel expects `data.transactions` (array).

**Step 3: Test in admin panel**

Load transaction history for a user. Confirm entries display.

**Step 4: Commit**
```
fix(api): fix transaction history endpoint
```

---

### Task 6: Fix save changes button

**Files:**
- Modify: `public/admin/index.html` (save handler ~lines 4635-4702, getModifiedFields ~lines 4519-4547)

**Step 1: Debug the click handler**

Add a `console.log` before the `getModifiedFields()` call (line 4636) to verify the handler fires. Then log the result of `getModifiedFields()` to see if it returns an empty object.

**Step 2: Identify the issue**

Likely causes:
- `getModifiedFields()` returns `{}` because field change tracking is broken (original values not stored, or comparison logic wrong)
- The click handler isn't attached (check the event listener wiring)
- The `apiCall` silently fails

**Step 3: Fix the root cause**

If `getModifiedFields()` returns empty: fix the change detection logic to properly compare current field values vs. stored originals.

If the handler isn't attached: wire up the event listener.

If the API call fails: fix the PATCH endpoint or the request payload.

**Step 4: Test**

Search for a user, change display name, click Save. Confirm toast shows success and the change persists on reload.

**Step 5: Commit**
```
fix(admin): fix save changes button in Users tab
```

---

### Task 7: Fix backpack access

**Files:**
- Modify: `express-api/src/routes/admin-economy.js` or `express-api/src/routes/economy.js`
- Possibly modify: `public/admin/index.html` (loadBackpack ~lines 6097-6109)

**Step 1: Reproduce and diagnose**

The admin panel calls `GET /api/users/:uid/backpack`. Check if this route exists for admin access or if it only allows the user themselves (ownership check in economy.js lines 1288-1290).

**Step 2: Fix the route**

If the user-facing endpoint has an ownership check blocking admin access, either:
- Add admin bypass to the existing endpoint, OR
- Create an admin-specific backpack GET endpoint in `admin-economy.js`

**Step 3: Test**

Search for a user, scroll to backpack section. Confirm items load.

**Step 4: Commit**
```
fix(api): allow admin access to user backpack
```

---

### Task 8: Replace SuperShy tier with expiry date

**Files:**
- Modify: `public/admin/index.html` (SuperShy HTML ~lines 3063-3077, populateEconomySection ~lines 6002-6015, getModifiedFields)

**Step 1: Replace tier dropdown with date picker**

Replace the SuperShy Tier dropdown HTML (lines 3068-3077) with:
```html
<div class="field-group">
    <label>Super Shy Expiry</label>
    <input type="datetime-local" id="eco-super-shy-expiry" aria-label="Super Shy Expiry">
</div>
```

**Step 2: Update populateEconomySection()**

In `populateEconomySection()` (~line 6009), populate the date picker from `data.superShyExpiry` (convert timestamp to datetime-local format).

**Step 3: Update getModifiedFields()**

Ensure `superShyExpiry` is captured as a timestamp when the date picker changes. Remove `superShyTier` from the modified fields.

**Step 4: Update the enable/disable logic**

The expiry date picker should be disabled when SuperShy is "No", enabled when "Yes" (same as the old tier dropdown).

**Step 5: Test**

Toggle SuperShy to Yes, set an expiry date, save. Reload and confirm it persists.

**Step 6: Commit**
```
feat(admin): replace SuperShy tier with expiry date picker
```

---

### Task 9: Create device binding card

**Files:**
- Modify: `public/admin/index.html` (remove old reset button ~line 2748, add new card HTML, add JS to populate)

**Step 1: Remove the inline reset button**

Remove the "Reset Device Binding" button from beside the UID field (line 2748).

**Step 2: Add device binding card HTML**

Add a new card section (will go in the Moderation sub-tab later in Task 10). Include:
- Card header: "Bound Device"
- Info grid: manufacturer, model, OS, app version, screen, network, carrier, IP, ISP, ASN, country, region, first seen, last seen
- "Reset Device Binding" button at bottom of card

**Step 3: Add populateDeviceCard() function**

```javascript
async function populateDeviceCard(uid) {
  try {
    const data = await apiCall("GET", `/api/admin/devices/user/${uid}`);
    const devices = data.devices || [];
    // Render device info into the card
  } catch (err) {
    // Show "No device bound" message
  }
}
```

Call this from `populateFormFull()`.

**Step 4: Test**

Search for a user with a bound device. Confirm all device info displays. Click Reset and confirm it clears.

**Step 5: Commit**
```
feat(admin): add device binding info card to Users tab
```

---

### Task 10: Restructure Users tab with sub-tabs

**Files:**
- Modify: `public/admin/index.html` (HTML structure, CSS, JS)

**Step 1: Add sub-tab CSS**

Add styles for the sub-tab bar (similar to the main tab bar but smaller, nested within the Users tab).

```css
.user-subtabs { display: flex; gap: 8px; padding: 12px 0; border-bottom: 1px solid var(--border); }
.user-subtab { padding: 6px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; background: var(--surface2); color: var(--text2); border: none; }
.user-subtab.active { background: var(--accent); color: #fff; }
.user-subpanel { display: none; }
.user-subpanel.visible { display: block; }
```

**Step 2: Add sub-tab HTML**

Insert after the search bar, before the form fields:
```html
<div class="user-subtabs" id="user-subtabs" style="display:none">
    <button class="user-subtab active" data-subtab="profile">Profile</button>
    <button class="user-subtab" data-subtab="moderation">Moderation</button>
    <button class="user-subtab" data-subtab="economy">Economy</button>
</div>
```

**Step 3: Wrap existing sections in sub-panels**

Wrap the existing card sections into three `<div class="user-subpanel">` containers:

- **Profile panel**: Identity, Profile, Privacy, Timestamps, Lists (Blocked/Following/Followers/Stalkers)
- **Moderation panel**: Suspension, Bans & Restrictions, Device Card (from Task 9), GCS, Warnings, Report History
- **Economy panel**: Coins/Beans, SuperShy, Login Streak, Pity Counter, Backpack, Transaction History

**Step 4: Add sub-tab switching JS**

```javascript
function switchUserSubtab(subtab) {
  document.querySelectorAll(".user-subtab").forEach(b => b.classList.toggle("active", b.dataset.subtab === subtab));
  document.querySelectorAll(".user-subpanel").forEach(p => p.classList.toggle("visible", p.dataset.subtab === subtab));
}
document.querySelectorAll(".user-subtab").forEach(btn => {
  btn.addEventListener("click", () => switchUserSubtab(btn.dataset.subtab));
});
```

Show sub-tabs only when a user is loaded. Default to "Profile" sub-tab.

**Step 5: Ensure search bar and save button remain fixed**

Search bar stays above the sub-tabs. Save button stays at the bottom below all sub-panels.

**Step 6: Test**

Search for a user. Click through Profile / Moderation / Economy sub-tabs. Confirm all sections appear in the correct sub-tab. Confirm search and save remain visible across all sub-tabs.

**Step 7: Commit**
```
feat(admin): restructure Users tab into Profile/Moderation/Economy sub-tabs
```

---

### Task 11: Send system messages on admin changes

**Files:**
- Modify: `express-api/src/routes/admin-users.js` (PATCH handler)
- Modify: `express-api/src/routes/admin-economy.js` (adjust-balance, SuperShy)
- Modify: `express-api/src/routes/admin-bans.js` (ban/unban)
- Modify: `express-api/src/routes/admin-devices.js` (device reset)

**Step 1: Import sendSystemPm in all affected route files**

```javascript
const { sendSystemPm } = require('../utils/system-pm');
```

**Step 2: Add system messages to PATCH /user/:uid**

After the Firestore update succeeds (~line 161 of admin-users.js), check which fields changed and send appropriate messages:

```javascript
if (updates.displayName !== undefined) {
  await sendSystemPm(uid, 'Your display name was updated by a moderator.');
}
if (updates.profilePhotoUrl === '' || updates.profilePhotoUrl === null) {
  await sendSystemPm(uid, 'Your profile photo was removed by a moderator.');
}
if (updates.coverPhotoUrl === '' || updates.coverPhotoUrl === null) {
  await sendSystemPm(uid, 'Your cover photo was removed by a moderator.');
}
if (updates.description === '' || updates.description === null) {
  await sendSystemPm(uid, 'Your profile description was cleared by a moderator.');
}
if (updates.isSuperShy !== undefined) {
  const msg = updates.isSuperShy
    ? 'Super Shy has been activated on your account.'
    : 'Super Shy has been removed from your account.';
  await sendSystemPm(uid, msg);
}
```

**Step 3: Add system messages to adjust-balance**

After successful balance adjustment in admin-economy.js:
```javascript
const action = operation === 'add' ? 'added to' : 'deducted from';
const currencyName = currency === 'COINS' ? 'Shy Coins' : 'Shy Beans';
await sendSystemPm(uid, `${amount} ${currencyName} ${action === 'added to' ? 'were added to' : 'were deducted from'} your account.`);
```

**Step 4: Add system messages to ban/unban endpoints**

In admin-bans.js, after device/network ban creation:
```javascript
await sendSystemPm(linkedUserId, 'A restriction has been placed on your account.');
```

After unban:
```javascript
await sendSystemPm(userId, 'A restriction on your account has been lifted.');
```

**Step 5: Add system message to device binding reset**

In admin-devices.js, after device unbinding:
```javascript
await sendSystemPm(userId, 'Your device binding has been reset by a moderator.');
```

**Step 6: Wrap all sendSystemPm calls in try/catch**

System messages should never block the admin action. Wrap each call:
```javascript
try { await sendSystemPm(uid, msg); } catch (e) { log.warn('system-pm', 'Failed to send system PM', { uid, error: e.message }); }
```

**Step 7: Test**

Adjust a user's coins in the admin panel. Check that user's messages in the app (or Firestore) for the system PM.

**Step 8: Commit**
```
feat(api): send system messages when admin modifies user data
```

---

### Task 12: Implement temporary Unique ID

**Files:**
- Modify: `shared/src/commonMain/kotlin/com/shyden/shytalk/core/model/User.kt`
- Create: `express-api/src/routes/admin-temp-id.js`
- Modify: `express-api/src/index.js` (mount new route)
- Modify: `express-api/src/cron/index.js` (add expiry cron)
- Create: `express-api/src/cron/expireTempIds.js`
- Modify: `public/admin/index.html` (Identity section UI)
- Modify: `express-api/src/routes/admin-users.js` (search by temp ID)

**Step 1: Add fields to User model**

In `User.kt`, add to the data class:
```kotlin
val tempUniqueId: Long? = null,
val tempUniqueIdExpiry: Long? = null,
```

No need for `tempUniqueIdOriginal` — the real `uniqueId` field already holds the real ID.

**Step 2: Add displayUniqueId extension**

In `User.kt`:
```kotlin
val User.displayUniqueId: Long
    get() {
        val now = currentTimeMillis()
        return if (tempUniqueId != null && tempUniqueIdExpiry != null && tempUniqueIdExpiry > now) {
            tempUniqueId
        } else {
            uniqueId
        }
    }
```

**Step 3: Create admin-temp-id.js route**

```javascript
// GET /admin/users/check-id/:id — check availability
// POST /admin/users/:uid/temp-id — set temp ID {tempUniqueId, expiryDate}
// DELETE /admin/users/:uid/temp-id — clear temp ID
```

Check-id logic:
1. Query `users` where `uniqueId == id` → conflict type "real"
2. Query `users` where `tempUniqueId == id` AND `tempUniqueIdExpiry > now` → conflict type "temp"
3. Return `{available, conflictType, conflictUser}`

Set temp-id logic:
1. Run the same availability check
2. If available, update user doc with `tempUniqueId`, `tempUniqueIdExpiry`
3. Send system PM: "Your display ID has been temporarily changed to {id}."
4. Audit log

Clear temp-id logic:
1. Set `tempUniqueId: null, tempUniqueIdExpiry: null`
2. Send system PM: "Your display ID has been restored to your original ID."
3. Audit log

**Step 4: Mount route in index.js**

```javascript
app.use('/api', require('./routes/admin-temp-id'));
```

**Step 5: Extend user search to include temp IDs**

In admin-users.js, the search endpoint resolves uniqueId → uid. Add a fallback query:
```javascript
// If not found by uniqueId, try tempUniqueId
const tempSnap = await db.collection('users').where('tempUniqueId', '==', numericId).limit(1).get();
```

**Step 6: Create expiry cron job**

Create `express-api/src/cron/expireTempIds.js`:
```javascript
async function expireTempIds() {
  const now = Date.now();
  const snap = await db.collection('users')
    .where('tempUniqueIdExpiry', '<=', now)
    .where('tempUniqueIdExpiry', '>', 0)
    .get();
  for (const doc of snap.docs) {
    await doc.ref.update({ tempUniqueId: null, tempUniqueIdExpiry: null });
  }
  if (snap.size > 0) log.info('cron', `Expired ${snap.size} temp IDs`);
}
```

Register in `cron/index.js` on daily schedule: `0 0 * * *`

**Step 7: Add admin UI**

In the Identity section of the admin panel, add after the Unique ID field:
```html
<div class="field-group" id="temp-id-section">
    <label>Temporary ID</label>
    <div class="field-row">
        <input type="number" id="temp-id-input" placeholder="Enter temp ID">
        <button type="button" id="temp-id-check">Check</button>
    </div>
    <div id="temp-id-check-result" style="font-size:12px;margin-top:4px"></div>
    <div class="field-row" style="margin-top:8px">
        <input type="datetime-local" id="temp-id-expiry">
        <button type="button" id="temp-id-apply">Apply</button>
        <button type="button" id="temp-id-clear">Clear</button>
    </div>
    <div id="temp-id-current" style="font-size:12px;color:var(--text2);margin-top:4px"></div>
</div>
```

**Step 8: Add admin JS handlers**

- Check button: calls `GET /api/admin/users/check-id/:id`, shows green "Available" or red "In use as {type} by user {id}"
- Apply button: calls `POST /api/admin/users/:uid/temp-id` with validation
- Clear button: calls `DELETE /api/admin/users/:uid/temp-id`
- On user load: populate current temp ID + expiry if active

**Step 9: Update app display code**

Search the shared Kotlin codebase for all places where `user.uniqueId` is displayed to the user (profile screens, chat, room seats, user cards). Replace with `user.displayUniqueId`. Key files:
- Profile screens
- Chat message bubbles / user mentions
- Room seat labels
- User search results
- User card popups

**Step 10: Test**

1. Set a temp ID on a test user via admin panel
2. Verify the check button works (try an existing ID — should show conflict)
3. Verify the app displays the temp ID
4. Verify search works by temp ID
5. Wait for expiry (or manually trigger cron) — confirm ID reverts

**Step 11: Commit**
```
feat: implement temporary Unique ID system with admin UI, validation, and cron expiry
```

---

### Task 13: Enhance device bans with full device info

**Files:**
- Modify: `public/admin/index.html` (Bans & Restrictions section ~lines 2888-2913, populateBansSection JS)

**Step 1: Redesign the bound devices section**

Replace the simple device list in Bans & Restrictions with expandable device cards. Each card shows:
- Header: manufacturer + model + ban status badge
- Expandable body: all device fields (OS, app version, screen, network, IP, ISP, ASN, country, region, timestamps)
- Actions: "Ban This Device" (with reason input + duration picker) or "Unban" if already banned

**Step 2: Update populateBansSection()**

Fetch devices via `GET /api/admin/devices/user/:userId` and bans via `GET /api/admin/bans/user/:userId`. Cross-reference to show ban status per device.

**Step 3: Add per-device ban handler**

Wire "Ban This Device" to `POST /api/admin/bans/device` with the device's ID, reason, and optional duration.

Wire "Unban" to `DELETE /api/admin/bans/device/:deviceId`.

**Step 4: Test**

View a user with multiple devices. Expand a device card, verify all info shows. Ban one device, confirm red badge appears. Unban, confirm badge clears.

**Step 5: Commit**
```
feat(admin): show full device info and per-device ban controls
```

---

### Task 14: Add profile preview panel

**Files:**
- Modify: `public/admin/index.html` (Profile sub-tab, CSS, JS)

**Step 1: Add preview CSS**

Style a profile card that mimics the app's profile screen:
```css
.profile-preview { background: var(--surface); border-radius: 12px; overflow: hidden; margin-bottom: 16px; }
.profile-preview-cover { height: 120px; background-size: cover; background-position: center; background-color: var(--surface2); }
.profile-preview-avatar { width: 72px; height: 72px; border-radius: 50%; border: 3px solid var(--surface); margin-top: -36px; margin-left: 16px; object-fit: cover; background: var(--surface2); }
.profile-preview-info { padding: 8px 16px 16px; }
.profile-preview-name { font-size: 18px; font-weight: 600; }
.profile-preview-id { font-size: 13px; color: var(--text2); }
.profile-preview-desc { font-size: 13px; color: var(--text2); margin-top: 8px; }
.profile-preview-badges { display: flex; gap: 6px; margin-top: 6px; }
.profile-preview-badge { font-size: 11px; padding: 2px 8px; border-radius: 4px; background: var(--accent); color: #fff; }
.profile-preview-stats { display: flex; gap: 24px; margin-top: 12px; font-size: 13px; }
```

**Step 2: Add preview HTML**

At the top of the Profile sub-panel:
```html
<div class="profile-preview" id="profile-preview">
    <div class="profile-preview-toggle">
        <button class="user-subtab active" id="preview-current-btn">Current</button>
        <button class="user-subtab" id="preview-draft-btn">Preview</button>
    </div>
    <div id="profile-preview-cover" class="profile-preview-cover"></div>
    <img id="profile-preview-avatar" class="profile-preview-avatar" src="" alt="">
    <div class="profile-preview-info">
        <div class="profile-preview-name" id="preview-name"></div>
        <div class="profile-preview-id" id="preview-id"></div>
        <div class="profile-preview-badges" id="preview-badges"></div>
        <div class="profile-preview-desc" id="preview-desc"></div>
        <div class="profile-preview-stats" id="preview-stats"></div>
    </div>
</div>
```

**Step 3: Add preview JS**

```javascript
let previewMode = "current"; // "current" or "draft"

function updateProfilePreview() {
  if (previewMode === "current") {
    // Read from stored user data (the data object from API)
    renderPreview(loadedUserData);
  } else {
    // Read from current form field values
    renderPreview(getFormValues());
  }
}

function renderPreview(data) {
  // Set cover image, avatar, name, ID (or temp ID), badges, description, follower counts
}
```

Attach `input` event listeners to all Profile sub-tab form fields so the preview updates live when in "Preview" mode.

**Step 4: Toggle between Current and Preview**

Wire the two toggle buttons. "Current" shows saved data. "Preview" shows live form values.

**Step 5: Test**

Search for a user. Confirm profile preview shows their current data. Switch to Preview mode. Edit the display name in the form. Confirm the preview updates in real-time. Switch back to Current — confirm it shows the original name.

**Step 6: Commit**
```
feat(admin): add profile preview panel with current/preview modes
```

---

### Task 15: Deploy and verify

**Step 1: Deploy Express API**

```bash
cd express-api && tar -czf /tmp/shytalk-api.tar.gz --exclude=node_modules --exclude=.git -C . .
scp -i ~/.ssh/shytalk-oci /tmp/shytalk-api.tar.gz ubuntu@145.241.224.13:/tmp/shytalk-api.tar.gz
ssh -i ~/.ssh/shytalk-oci ubuntu@145.241.224.13 "cd /home/ubuntu/express-api && tar -xzf /tmp/shytalk-api.tar.gz && npm install --production && pm2 restart shytalk-api"
```

**Step 2: Deploy Firestore rules (if changed)**

```bash
npx firebase deploy --only firestore:rules
```

**Step 3: Deploy admin panel (Cloudflare Pages)**

```bash
npx wrangler pages deploy public --project-name shytalk-site
```

**Step 4: Build and install app (for temp ID display changes)**

```bash
./gradlew installDebug
```

**Step 5: Full verification**

Walk through every item:
1. Phone number removed
2. Email shows
3. Report history loads
4. Coins/beans adjustments work
5. Transaction history loads
6. Save button works
7. Backpack loads
8. SuperShy shows expiry date
9. Device card shows info
10. Sub-tabs work
11. System messages sent on changes
12. Temp ID: set, check, search, display in app, expiry
13. Per-device bans with info
14. Profile preview current + draft modes

**Step 6: Commit**
```
chore: deploy admin panel users tab improvements
```
