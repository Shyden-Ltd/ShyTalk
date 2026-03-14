# Users Tab Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the global Save button with per-field auto-save, reorganise card layouts, add side-by-side preview, and redesign the backpack as a visual grid.

**Architecture:** Backend gains a `?silent=true` param on PATCH to suppress PMs, a new batched notify endpoint, and a stalkers read endpoint. Frontend replaces the save workflow with per-field auto-save on blur/change, reorganises cards across sub-tabs, adds a live profile preview, and rebuilds the backpack as an icon grid with search/filter.

**Tech Stack:** Express.js (backend), vanilla JS + HTML/CSS (admin panel), Firebase Admin SDK, Firestore

---

## Task 1: Backend — Add `silent` Query Param to PATCH Endpoint

**Files:**
- Modify: `express-api/src/routes/admin-users.js:135-211`

**Step 1: Add silent param check**

In the PATCH `/user/:uid` handler, after the existing admin check (line 137), read the `silent` query param and conditionally skip PM sending:

```javascript
// Inside router.patch('/user/:uid', ...) — after line 180 (after db update):
const silent = req.query.silent === 'true';

// Wrap the existing PM block (lines 192-204) in:
if (!silent) {
  // ... existing PM logic stays unchanged ...
}
```

The existing PM logic (lines 192-204) already sends individual PMs per field. When `silent=true`, we skip all of them because the frontend will batch-notify via Task 2's endpoint.

**Step 2: Test manually**

```
curl -X PATCH "https://api.shytalk.shyden.co.uk/api/user/TEST_UID?silent=true" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"description":"test silent"}'
```

Expected: `{ success: true, updatedFields: ["description"] }` — no PM sent.

**Step 3: Commit**

```bash
git add express-api/src/routes/admin-users.js
git commit -m "feat(admin): add silent query param to PATCH /user/:uid to suppress PMs"
```

---

## Task 2: Backend — Add Notify-Changes Endpoint

**Files:**
- Modify: `express-api/src/routes/admin-users.js` (add new route)

**Step 1: Add the endpoint**

After the existing PATCH handler, add:

```javascript
// ── Batched change notification ──
router.post('/user/:uid/notify-changes', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const { fields } = req.body;
    if (!Array.isArray(fields) || fields.length === 0) {
      return res.status(400).json({ error: 'fields must be a non-empty array' });
    }

    // Only notify for user-visible fields
    const NOTIFIABLE = new Set([
      'displayName', 'userType', 'email', 'description',
      'profilePhotoUrl', 'coverPhotoUrl',
    ]);
    const relevant = fields.filter(f => NOTIFIABLE.has(f));
    if (relevant.length === 0) {
      return res.json({ ok: true, notified: false, reason: 'No notifiable fields' });
    }

    const friendlyNames = {
      displayName: 'display name',
      userType: 'account type',
      email: 'email address',
      description: 'profile description',
      profilePhotoUrl: 'profile photo',
      coverPhotoUrl: 'cover photo',
    };

    const fieldList = relevant.map(f => friendlyNames[f] || f).join(', ');
    const text = `A moderator has updated your profile. Changed: ${fieldList}.`;
    await sendSystemPm(req.params.uid, text);

    log.info('admin-users', 'Sent batched change notification', {
      adminId: req.auth.uid,
      targetUid: req.params.uid,
      fields: relevant,
    });

    res.json({ ok: true, notified: true, fields: relevant });
  } catch (err) {
    log.error('admin-users', 'notify-changes failed', {
      uid: req.params.uid,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

**Step 2: Update the file header comment**

Add to the JSDoc block at the top:
```
 * POST   /user/:uid/notify-changes → Batched change notification PM (admin)
```

**Step 3: Test manually**

```
curl -X POST "https://api.shytalk.shyden.co.uk/api/user/TEST_UID/notify-changes" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"fields":["displayName","email"]}'
```

Expected: `{ ok: true, notified: true, fields: ["displayName","email"] }`

**Step 4: Commit**

```bash
git add express-api/src/routes/admin-users.js
git commit -m "feat(admin): add POST /user/:uid/notify-changes for batched PM"
```

---

## Task 3: Backend — Add Admin Stalkers Read Endpoint

**Files:**
- Modify: `express-api/src/routes/admin-users.js` (add new route)

**Step 1: Add the endpoint**

Stalkers are stored in `users/{uid}/stalkers/{visitorId}` subcollection. Add:

```javascript
// ── Read stalkers list (admin) ──
router.get('/user/:uid/stalkers', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const snap = await db.collection(`users/${req.params.uid}/stalkers`).get();
    const stalkerIds = snap.docs.map(doc => doc.id);

    res.json({ stalkers: stalkerIds, count: stalkerIds.length });
  } catch (err) {
    log.error('admin-users', 'GET stalkers failed', {
      uid: req.params.uid,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

**Step 2: Update file header**

```
 * GET    /user/:uid/stalkers       → Read stalkers list (admin)
```

**Step 3: Commit**

```bash
git add express-api/src/routes/admin-users.js
git commit -m "feat(admin): add GET /user/:uid/stalkers endpoint"
```

---

## Task 4: Deploy Backend Changes

**Step 1: Deploy to Oracle Cloud**

```bash
cd express-api
tar czf ../deploy.tar.gz --exclude=node_modules .
scp -i ~/.ssh/shytalk-oci ../deploy.tar.gz ubuntu@145.241.224.13:/tmp/
ssh -i ~/.ssh/shytalk-oci ubuntu@145.241.224.13 "cd /home/ubuntu/shytalk-api && tar xzf /tmp/deploy.tar.gz && npm install --production && pm2 restart shytalk-api"
```

**Step 2: Verify endpoints**

```bash
ssh -i ~/.ssh/shytalk-oci ubuntu@145.241.224.13 "pm2 logs shytalk-api --lines 20"
```

**Step 3: Commit (if any deploy config changed)**

No commit needed — code was committed in Tasks 1-3.

---

## Task 5: Frontend — Auto-Save Infrastructure

**Files:**
- Modify: `public/admin/index.html`

This is the largest task. It replaces the global Save button with per-field auto-save.

### Step 1: Add auto-save CSS

Add these styles to the existing `<style>` block:

```css
/* Auto-save feedback */
.field-feedback {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: 8px;
  font-size: 0.8rem;
  opacity: 0;
  transition: opacity 0.3s ease;
}
.field-feedback.visible { opacity: 1; }
.field-feedback.saved { color: #4caf50; }
.field-feedback.failed { color: #f44336; }
.field-feedback .undo-link {
  cursor: pointer;
  color: #90caf9;
  text-decoration: underline;
  font-size: 0.75rem;
}
.field-saving {
  border-color: #ffc107 !important;
}
.field-save-failed {
  border-color: #f44336 !important;
  animation: flash-red 0.5s ease;
}
@keyframes flash-red {
  0%, 100% { border-color: #f44336; }
  50% { border-color: #ff7961; }
}
```

### Step 2: Add auto-save JS infrastructure

Add a new section in the `<script>` block. Key functions:

```javascript
// ─── Auto-Save System ─────────────────────────────────────
const autoSaveState = {
  pendingNotifyFields: [],
  notifyTimer: null,
  NOTIFY_DEBOUNCE_MS: 30000,
};

function showFieldFeedback(fieldEl, status, previousValue) {
  let fb = fieldEl.parentElement.querySelector('.field-feedback');
  if (!fb) {
    fb = document.createElement('span');
    fb.className = 'field-feedback';
    fieldEl.parentElement.appendChild(fb);
  }

  // Clear previous content
  while (fb.firstChild) fb.removeChild(fb.firstChild);

  if (status === 'saved') {
    fb.className = 'field-feedback visible saved';
    const checkSpan = document.createElement('span');
    checkSpan.textContent = '\u2713 Saved';
    fb.appendChild(checkSpan);

    // Add undo link
    const undoLink = document.createElement('span');
    undoLink.className = 'undo-link';
    undoLink.textContent = 'Undo';
    undoLink.addEventListener('click', () => undoFieldSave(fieldEl, previousValue));
    fb.appendChild(undoLink);

    // Fade out after 5 seconds
    setTimeout(() => { fb.classList.remove('visible'); }, 5000);
  } else if (status === 'failed') {
    fb.className = 'field-feedback visible failed';
    const failSpan = document.createElement('span');
    failSpan.textContent = '\u2717 Failed';
    fb.appendChild(failSpan);
  } else if (status === 'saving') {
    fb.className = 'field-feedback visible saved';
    const savingSpan = document.createElement('span');
    savingSpan.textContent = 'Saving...';
    fb.appendChild(savingSpan);
  }
}

async function autoSaveField(fieldEl) {
  const fieldName = fieldEl.dataset.field;
  if (!fieldName || !selectedUser) return;

  const previousValue = selectedUser[fieldName];
  let newValue = fieldEl.type === 'checkbox' ? fieldEl.checked : fieldEl.value;

  // Type coercion for numeric fields
  if (fieldEl.type === 'number') newValue = Number(newValue) || 0;

  // Skip if value hasn't changed
  if (String(newValue) === String(previousValue)) return;

  fieldEl.classList.add('field-saving');
  showFieldFeedback(fieldEl, 'saving', previousValue);

  try {
    const resp = await apiCall(`/user/${selectedUser.id}?silent=true`, 'PATCH', {
      [fieldName]: newValue,
    });
    if (resp.success) {
      fieldEl.classList.remove('field-saving');
      showFieldFeedback(fieldEl, 'saved', previousValue);
      // Update local state
      selectedUser[fieldName] = newValue;
      // Queue for batched notification
      queueNotifyField(fieldName);
      // Update preview if applicable
      if (typeof updateDraftPreview === 'function') updateDraftPreview();
    } else {
      throw new Error(resp.error || 'Save failed');
    }
  } catch (err) {
    fieldEl.classList.remove('field-saving');
    fieldEl.classList.add('field-save-failed');
    showFieldFeedback(fieldEl, 'failed', previousValue);
    setTimeout(() => fieldEl.classList.remove('field-save-failed'), 2000);
  }
}

async function undoFieldSave(fieldEl, previousValue) {
  const fieldName = fieldEl.dataset.field;
  if (!fieldName || !selectedUser) return;

  try {
    await apiCall(`/user/${selectedUser.id}?silent=true`, 'PATCH', {
      [fieldName]: previousValue,
    });
    // Restore UI
    if (fieldEl.type === 'checkbox') {
      fieldEl.checked = !!previousValue;
    } else {
      fieldEl.value = previousValue ?? '';
    }
    selectedUser[fieldName] = previousValue;
    showFieldFeedback(fieldEl, 'saved', null);
    if (typeof updateDraftPreview === 'function') updateDraftPreview();
  } catch (err) {
    showFieldFeedback(fieldEl, 'failed', null);
  }
}

function queueNotifyField(fieldName) {
  if (!autoSaveState.pendingNotifyFields.includes(fieldName)) {
    autoSaveState.pendingNotifyFields.push(fieldName);
  }
  clearTimeout(autoSaveState.notifyTimer);
  autoSaveState.notifyTimer = setTimeout(flushNotifications, autoSaveState.NOTIFY_DEBOUNCE_MS);
}

async function flushNotifications() {
  if (!selectedUser || autoSaveState.pendingNotifyFields.length === 0) return;
  const fields = [...autoSaveState.pendingNotifyFields];
  autoSaveState.pendingNotifyFields = [];
  try {
    await apiCall(`/user/${selectedUser.id}/notify-changes`, 'POST', { fields });
  } catch (err) {
    console.error('Failed to send batched notification:', err);
  }
}
```

### Step 3: Wire auto-save to form fields

Attach blur/change listeners to all `[data-field]` elements when a user is loaded. In the `populateForm` function (or right after it completes), add:

```javascript
function attachAutoSaveListeners() {
  document.querySelectorAll('#users-detail [data-field]').forEach(el => {
    // Remove old listeners (use a flag to avoid duplicates)
    if (el._autoSaveBound) return;
    el._autoSaveBound = true;

    if (el.type === 'checkbox' || el.tagName === 'SELECT') {
      el.addEventListener('change', () => autoSaveField(el));
    } else {
      el.addEventListener('blur', () => autoSaveField(el));
    }
  });
}
```

Call `attachAutoSaveListeners()` at the end of `populateFormFull()`.

### Step 4: Flush notifications on user switch

In the user selection handler (when clicking a different user in the list), call `flushNotifications()` before loading the new user:

```javascript
// At the top of the user-select click handler:
await flushNotifications();
```

### Step 5: Remove old save infrastructure

Remove:
- The "Save Changes" button element
- The `getModifiedFields()` function and its economy override
- The `.modified` CSS class and field highlighting
- The "X fields modified" counter display
- The sub-tab unsaved-change dot indicators
- The `saveChanges()` function

### Step 6: Commit

```bash
git add public/admin/index.html
git commit -m "feat(admin): replace global save with per-field auto-save + undo + batched PM"
```

---

## Task 6: Frontend — Reorganise Profile Sub-tab

**Files:**
- Modify: `public/admin/index.html`

### Step 1: Add side-by-side profile preview

At the top of the Profile sub-tab content area, add a preview container:

```html
<div class="profile-preview-row" style="display:flex; gap:24px; margin-bottom:24px;">
  <!-- Current (live) profile -->
  <div class="preview-card" id="preview-current" style="flex:1;">
    <h4>Current Profile</h4>
    <div class="preview-cover" id="pc-cover"></div>
    <div class="preview-avatar" id="pc-avatar"></div>
    <div class="preview-name" id="pc-name"></div>
    <div class="preview-id" id="pc-id"></div>
    <div class="preview-badge" id="pc-badge"></div>
    <div class="preview-desc" id="pc-desc"></div>
    <div class="preview-flag" id="pc-flag"></div>
    <div class="preview-counts" id="pc-counts"></div>
  </div>
  <!-- Draft (as-you-edit) profile -->
  <div class="preview-card" id="preview-draft" style="flex:1;">
    <h4>Draft Preview</h4>
    <div class="preview-cover" id="pd-cover"></div>
    <div class="preview-avatar" id="pd-avatar"></div>
    <div class="preview-name" id="pd-name"></div>
    <div class="preview-id" id="pd-id"></div>
    <div class="preview-badge" id="pd-badge"></div>
    <div class="preview-desc" id="pd-desc"></div>
    <div class="preview-flag" id="pd-flag"></div>
    <div class="preview-counts" id="pd-counts"></div>
  </div>
</div>
```

Build the preview using safe DOM methods:

```javascript
function updateCurrentPreview() {
  if (!selectedUser) return;
  const u = selectedUser;
  setPreviewField('pc-name', u.displayName);
  setPreviewField('pc-id', u.uniqueId ? '#' + u.uniqueId : '');
  setPreviewField('pc-badge', u.userType);
  setPreviewField('pc-desc', u.description || '');
  setPreviewFlag('pc-flag', u.nationality);
  setPreviewImage('pc-avatar', u.profilePhotoUrl);
  setPreviewImage('pc-cover', u.coverPhotoUrl);
  setPreviewCounts('pc-counts', u);
}

function updateDraftPreview() {
  // Read current form values
  const getName = (sel) => {
    const el = document.querySelector(sel);
    return el ? el.value : '';
  };
  setPreviewField('pd-name', getName('[data-field="displayName"]'));
  setPreviewField('pd-id', selectedUser?.uniqueId ? '#' + selectedUser.uniqueId : '');
  setPreviewField('pd-badge', getName('[data-field="userType"]'));
  setPreviewField('pd-desc', getName('[data-field="description"]'));
  setPreviewFlag('pd-flag', getName('[data-field="nationality"]'));
  setPreviewImage('pd-avatar', getName('[data-field="profilePhotoUrl"]'));
  setPreviewImage('pd-cover', getName('[data-field="coverPhotoUrl"]'));
  setPreviewCounts('pd-counts', selectedUser);
}

function setPreviewField(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text || '';
}

function setPreviewImage(id, url) {
  const el = document.getElementById(id);
  if (!el) return;
  if (url) {
    el.style.backgroundImage = 'url(' + CSS.escape(url) + ')';
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
  } else {
    el.style.backgroundImage = '';
    el.style.backgroundColor = '#333';
  }
}

function setPreviewFlag(id, nationality) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = nationality ? getFlagEmoji(nationality) + ' ' + nationality : '';
}

function setPreviewCounts(id, user) {
  const el = document.getElementById(id);
  if (!el) return;
  const following = (user?.followingIds || []).length;
  const followers = (user?.followerIds || []).length;
  const stalkers = user?._stalkerCount ?? '...';
  el.textContent = 'Following: ' + following + ' | Followers: ' + followers + ' | Stalkers: ' + stalkers;
}
```

Wire `updateDraftPreview()` to fire on input/change events for preview-relevant fields.

### Step 2: Reorganise Profile cards

Rearrange the Profile sub-tab HTML into these cards (in order):

1. **Identity card** — displayName, userType (select), nationality (select), description (textarea)
2. **Account card** — email, dateOfBirth (datetime-local), uniqueId (read-only), tempId
3. **Media card** — profilePhotoUrl, coverPhotoUrl (with image previews)
4. **Privacy card** — hideFollowing, hideOnlineStatus, hideAge (checkboxes)
5. **Lists card** — blockedUserIds, followingIds, followerIds (textareas), stalkers (read-only list fetched from new endpoint)

### Step 3: Fetch and display stalkers

When loading a user, fetch stalkers:

```javascript
async function loadStalkers(uid) {
  try {
    const data = await apiCall('/user/' + uid + '/stalkers', 'GET');
    selectedUser._stalkerCount = data.count;
    const container = document.getElementById('stalkers-list');
    if (!container) return;
    // Clear previous content safely
    while (container.firstChild) container.removeChild(container.firstChild);
    if (data.stalkers.length === 0) {
      const emptyEl = document.createElement('span');
      emptyEl.className = 'text-muted';
      emptyEl.textContent = 'No stalkers';
      container.appendChild(emptyEl);
    } else {
      data.stalkers.forEach(id => {
        const tag = document.createElement('span');
        tag.className = 'uid-tag';
        tag.textContent = id;
        container.appendChild(tag);
      });
    }
    // Update preview counts
    updateCurrentPreview();
    updateDraftPreview();
  } catch (err) {
    console.error('Failed to load stalkers:', err);
  }
}
```

Call `loadStalkers(uid)` alongside the user profile fetch.

### Step 4: Move createdAt and lastSeenAt to Moderation sub-tab

Remove the timestamp fields from the Profile sub-tab. They'll be added in Task 7.

### Step 5: Commit

```bash
git add public/admin/index.html
git commit -m "feat(admin): reorganise profile sub-tab with side-by-side preview and stalkers"
```

---

## Task 7: Frontend — Reorganise Moderation Sub-tab

**Files:**
- Modify: `public/admin/index.html`

### Step 1: Reorganise card order

Rearrange the Moderation sub-tab into:

1. **Account Info card** — createdAt, lastSeenAt (read-only, moved from Profile)
2. **Device Binding card** — current device info, unbind action
3. **GCS card** — gcsScore, gcsDisplayScore, Reset GCS action
4. **Warnings card** — warningCount, warningReason, hasActiveWarning, Issue Warning action
5. **Suspension & Bans card** — merge the existing separate Suspension and Bans cards into one:
   - Suspend/unsuspend actions, reason, end date
   - Device list with per-device ban/unban, network bans

### Step 2: Merge Suspension + Bans cards

Combine the existing HTML for suspension actions and device/network bans into a single card with two sections. Use existing action handlers — just reorganise the layout.

### Step 3: Commit

```bash
git add public/admin/index.html
git commit -m "feat(admin): reorganise moderation sub-tab, merge suspension & bans"
```

---

## Task 8: Frontend — Backpack Visual Grid Redesign

**Files:**
- Modify: `public/admin/index.html`

### Step 1: Add backpack grid CSS

```css
.backpack-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 12px;
  padding: 12px 0;
}
.backpack-item {
  position: relative;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.2s;
}
.backpack-item:hover { border-color: var(--primary); }
.backpack-item img {
  width: 48px;
  height: 48px;
  object-fit: contain;
  margin-bottom: 6px;
}
.backpack-qty-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  background: var(--primary);
  color: #fff;
  font-size: 0.7rem;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 10px;
  min-width: 20px;
  text-align: center;
}
.backpack-item-name {
  font-size: 0.75rem;
  color: var(--text);
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.backpack-remove-btn {
  position: absolute;
  top: 4px;
  left: 4px;
  background: rgba(244, 67, 54, 0.8);
  color: #fff;
  border: none;
  border-radius: 50%;
  width: 20px;
  height: 20px;
  font-size: 12px;
  cursor: pointer;
  display: none;
  align-items: center;
  justify-content: center;
  line-height: 1;
}
.backpack-item:hover .backpack-remove-btn { display: flex; }
.backpack-edit-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: rgba(0,0,0,0.85);
  padding: 8px;
  border-radius: 0 0 8px 8px;
  display: none;
}
.backpack-item.editing .backpack-edit-overlay { display: block; }
```

### Step 2: Add search bar + category filter

Above the grid:

```html
<div style="display:flex; gap:12px; margin-bottom:12px;">
  <input type="text" id="backpack-search" placeholder="Search gifts..." style="flex:1;" />
  <select id="backpack-category-filter">
    <option value="">All Categories</option>
    <!-- Populated dynamically from gift catalog -->
  </select>
</div>
```

### Step 3: Build the visual grid with safe DOM methods

```javascript
function renderBackpackGrid(backpack, giftCatalog) {
  const container = document.getElementById('backpack-grid');
  if (!container) return;
  while (container.firstChild) container.removeChild(container.firstChild);

  const search = (document.getElementById('backpack-search')?.value || '').toLowerCase();
  const catFilter = document.getElementById('backpack-category-filter')?.value || '';

  const entries = Object.entries(backpack).filter(([giftId, qty]) => {
    if (qty <= 0) return false;
    const gift = giftCatalog[giftId];
    if (!gift) return true; // Show unknown gifts
    if (search && !gift.name.toLowerCase().includes(search)) return false;
    if (catFilter && gift.category !== catFilter) return false;
    return true;
  });

  entries.forEach(([giftId, qty]) => {
    const gift = giftCatalog[giftId] || {};
    const card = document.createElement('div');
    card.className = 'backpack-item';
    card.dataset.giftId = giftId;

    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.className = 'backpack-remove-btn';
    removeBtn.textContent = '\u00D7';
    removeBtn.title = 'Remove';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      autoSaveBackpackItem(giftId, 0, card);
    });
    card.appendChild(removeBtn);

    // Quantity badge
    const badge = document.createElement('span');
    badge.className = 'backpack-qty-badge';
    badge.textContent = String(qty);
    card.appendChild(badge);

    // Gift icon
    const img = document.createElement('img');
    img.src = gift.iconUrl || '/img/gift-placeholder.png';
    img.alt = gift.name || giftId;
    img.loading = 'lazy';
    card.appendChild(img);

    // Gift name
    const nameEl = document.createElement('div');
    nameEl.className = 'backpack-item-name';
    nameEl.textContent = gift.name || giftId;
    nameEl.title = gift.name || giftId;
    card.appendChild(nameEl);

    // Edit overlay (shown on click)
    const overlay = document.createElement('div');
    overlay.className = 'backpack-edit-overlay';
    const qtyInput = document.createElement('input');
    qtyInput.type = 'number';
    qtyInput.min = '0';
    qtyInput.value = String(qty);
    qtyInput.style.cssText = 'width:100%; text-align:center;';
    qtyInput.addEventListener('blur', () => {
      const newQty = parseInt(qtyInput.value, 10) || 0;
      card.classList.remove('editing');
      if (newQty !== qty) {
        autoSaveBackpackItem(giftId, newQty, card);
      }
    });
    overlay.appendChild(qtyInput);
    card.appendChild(overlay);

    // Click to toggle edit
    card.addEventListener('click', () => {
      card.classList.toggle('editing');
      if (card.classList.contains('editing')) {
        qtyInput.focus();
        qtyInput.select();
      }
    });

    container.appendChild(card);
  });

  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'grid-column: 1 / -1; text-align: center; color: var(--text-muted); padding: 24px;';
    empty.textContent = search || catFilter ? 'No matching gifts' : 'Backpack is empty';
    container.appendChild(empty);
  }
}

async function autoSaveBackpackItem(giftId, newQty, cardEl) {
  try {
    const backpack = { ...selectedUser.backpack };
    const oldQty = backpack[giftId] || 0;
    if (newQty <= 0) {
      delete backpack[giftId];
    } else {
      backpack[giftId] = newQty;
    }
    await apiCall('/user/' + selectedUser.id + '?silent=true', 'PATCH', { backpack });
    selectedUser.backpack = backpack;
    renderBackpackGrid(backpack, giftCatalogCache);

    // Show undo toast
    showBackpackUndo(giftId, oldQty);
  } catch (err) {
    console.error('Backpack save failed:', err);
  }
}
```

### Step 4: Add "Add Gift" row below grid

```html
<div class="add-gift-row" style="display:flex; gap:8px; align-items:center; margin-top:12px;">
  <select id="add-gift-select" style="flex:1;">
    <option value="">Select a gift...</option>
    <!-- Populated from catalog with small icon text -->
  </select>
  <input type="number" id="add-gift-qty" min="1" value="1" style="width:80px;" />
  <button id="add-gift-btn" class="btn-primary">Add</button>
</div>
```

Populate the select using safe DOM:

```javascript
function populateGiftSelect(catalog) {
  const sel = document.getElementById('add-gift-select');
  if (!sel) return;
  // Keep first placeholder option, remove rest
  while (sel.options.length > 1) sel.remove(1);
  Object.entries(catalog).forEach(([id, gift]) => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = gift.name || id;
    sel.appendChild(opt);
  });
}
```

### Step 5: Add Clear All with destructive protection

```javascript
function showClearAllConfirmation() {
  // Create modal overlay
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:10000;';

  const dialog = document.createElement('div');
  dialog.style.cssText = 'background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px;max-width:400px;width:90%;text-align:center;';

  const warning = document.createElement('p');
  warning.style.cssText = 'color:#f44336;font-weight:700;margin-bottom:16px;';
  warning.textContent = 'This will permanently remove all items from this user\'s backpack.';
  dialog.appendChild(warning);

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:12px;justify-content:center;';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn-secondary';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => document.body.removeChild(overlay));
  btnRow.appendChild(cancelBtn);

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'btn-danger';
  confirmBtn.disabled = true;
  let countdown = 5;
  confirmBtn.textContent = 'Confirm (' + countdown + ')';

  const timer = setInterval(() => {
    countdown--;
    if (countdown <= 0) {
      clearInterval(timer);
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Confirm';
    } else {
      confirmBtn.textContent = 'Confirm (' + countdown + ')';
    }
  }, 1000);

  confirmBtn.addEventListener('click', async () => {
    if (confirmBtn.disabled) return;
    clearInterval(timer);
    document.body.removeChild(overlay);
    await clearAllBackpack();
  });
  btnRow.appendChild(confirmBtn);

  dialog.appendChild(btnRow);
  overlay.appendChild(dialog);

  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      clearInterval(timer);
      document.body.removeChild(overlay);
    }
  });

  document.body.appendChild(overlay);
}

async function clearAllBackpack() {
  try {
    await apiCall('/user/' + selectedUser.id + '?silent=true', 'PATCH', { backpack: {} });
    selectedUser.backpack = {};
    renderBackpackGrid({}, giftCatalogCache);
  } catch (err) {
    console.error('Clear all failed:', err);
  }
}
```

### Step 6: Wire search and filter

```javascript
document.getElementById('backpack-search')?.addEventListener('input', () => {
  renderBackpackGrid(selectedUser?.backpack || {}, giftCatalogCache);
});
document.getElementById('backpack-category-filter')?.addEventListener('change', () => {
  renderBackpackGrid(selectedUser?.backpack || {}, giftCatalogCache);
});
```

### Step 7: Add `backpack` to allowedFields in backend

In `express-api/src/routes/admin-users.js`, add `'backpack'` to the `allowedFields` array in the PATCH handler.

### Step 8: Commit

```bash
git add public/admin/index.html express-api/src/routes/admin-users.js
git commit -m "feat(admin): redesign backpack as visual grid with search, filter, clear-all"
```

---

## Task 9: Deploy & Test

**Step 1: Deploy backend (if Task 8 step 7 changed it)**

Same deploy process as Task 4.

**Step 2: Deploy frontend**

```bash
npx wrangler pages deploy public --project-name shytalk-site
```

**Step 3: Manual test checklist**

- [ ] Load a user — profile preview shows Current + Draft side by side
- [ ] Edit displayName, blur out — "Saved" + "Undo" appears inline
- [ ] Click Undo — reverts the field and saves
- [ ] Edit multiple fields quickly — only one PM sent after 30s
- [ ] Switch to different user — PM flushes immediately
- [ ] Profile sub-tab: Identity, Account, Media, Privacy, Lists cards in order
- [ ] Stalkers list loads in Lists card
- [ ] Moderation sub-tab: Account Info, Device Binding, GCS, Warnings, Suspension & Bans
- [ ] Economy sub-tab: backpack shows visual grid with icons
- [ ] Search bar filters backpack items
- [ ] Click a backpack item — quantity input overlay appears
- [ ] Change quantity, blur — saves and updates badge
- [ ] Click X on item — removes it (saves qty 0)
- [ ] Add Gift: select gift + quantity, click Add
- [ ] Clear All: confirmation dialog appears with 5s countdown
- [ ] Cannot click Confirm until countdown reaches 0
- [ ] After Clear All: backpack is empty

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix(admin): users tab redesign polish and bug fixes"
```

**Step 5: Push and create PR**

```bash
git push origin feature/logging-monitoring
```

Create PR targeting `main` with the redesign summary.
