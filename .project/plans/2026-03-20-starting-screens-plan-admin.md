# Starting Screens — Admin Panel Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Starting Screens" section to the admin panel with screen card management, device preview, image upload, date scheduling, allowlist management, and Playwright tests.

**Architecture:** New section in `public/admin/index.html` (single-page app). Calls `GET/PUT /api/config/startingScreens` and `/api/storage/upload`. Live device preview using HTML/CSS mockup. All client-side JavaScript, no build step.

**Tech Stack:** HTML, CSS, JavaScript (vanilla), Playwright

**Spec:** `.project/plans/2026-03-20-starting-screens-design.md`
**Depends on:** API plan must be completed first (endpoints must exist)

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `public/admin/index.html` | Modify | Add "Starting Screens" tab, section, styles, and JavaScript |
| `public/admin/assets/app-icon.png` | Create | App icon for device preview (copy from Android mipmap launcher icon) |
| `tests/web/admin-starting-screens.spec.ts` | Create | Playwright tests (in `tests/web/` per `playwright.config.ts testDir`) |
| `tests/web/admin-panel.spec.ts` | Modify | Add `'tab-starting-screens'` to expected tabs array |

---

## Chunk 1: Admin Panel Section

### Task 1: Add Starting Screens tab and section skeleton

**Files:**
- Modify: `public/admin/index.html`

- [ ] **Step 1: Add nav tab**

In the nav bar, add a "Starting Screens" tab after Users (or appropriate position). Use `#starting-screens` hash for deep linking.

```html
<button class="tab-btn" id="tab-starting-screens">Starting Screens</button>
```

Note: Must use `id="tab-starting-screens"` to match the existing `id="tab-*"` pattern used by all other tabs. Do NOT use `data-tab` — the tab system uses `$('#tab-*')` selectors.

- [ ] **Step 2: Add section container**

```html
<div id="starting-screens-panel">
  <h2>Starting Screens</h2>
  <p class="section-desc">Manage screens shown to users on app launch</p>
  <button id="add-screen-btn" style="background: var(--accent); color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">+ Add Screen</button>
  <div id="starting-screens-list"></div>
  <div id="starting-screens-empty" style="text-align: center; padding: 32px; color: var(--text2); font-size: 14px;">
    No starting screens configured. Click "Add Screen" to create one.
  </div>
</div>
```

Note: Use inline styles matching existing panel patterns — `tab-panel`, `btn-primary`, and `empty-state` CSS classes do NOT exist in the codebase.

- [ ] **Step 3: Add CSS for screen cards and device preview**

```css
/* Starting Screens */
#starting-screens-panel { display: none; }
#starting-screens-panel.visible { display: block; }
.screen-card { border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin: 16px 0; display: grid; grid-template-columns: 1fr 300px; gap: 24px; }
.screen-card-form { display: flex; flex-direction: column; gap: 12px; }
.screen-card-preview { border: 2px solid var(--border); border-radius: 24px; width: 260px; height: 520px; overflow: hidden; position: relative; background: var(--bg); }
.preview-content { padding: 24px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 12px; height: 100%; overflow-y: auto; }
.char-counter { font-size: 12px; color: var(--text2); }
.char-counter.over-limit { color: #e74c3c; font-weight: bold; }
.status-badge { padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
.status-active { background: #27ae60; color: white; }
.status-scheduled { background: #f39c12; color: white; }
.status-expired { background: #95a5a6; color: white; }
```

**Critical:** The `#starting-screens-panel { display: none; }` and `.visible` rules are required. Without them, the panel is visible by default on page load, breaking the tab layout.

- [ ] **Step 4: Add tab switching logic**

The existing `switchTab()` function is monkey-patched twice in the file (by the Logs section and the Monitor section). Follow this exact checklist:

1. **Append** `"starting-screens"` to the existing `sessionStorage` allowlist array (at ~line 4505). Do NOT replace the whole array — just append to whatever is already there. Note: the existing array is also missing `"devices"` (pre-existing bug) — fix both at the same time by appending `"devices", "starting-screens"`:
   ```javascript
   // Find the existing .includes(savedTab) line and append both missing entries:
   // ..."logs", "devices", "starting-screens"].includes(savedTab)
   ```

2. Add tab variable: `const tabStartingScreens = $("#tab-starting-screens");`

3. In the original `switchTab` function, add:
   ```javascript
   tabStartingScreens.classList.toggle("active", tab === "starting-screens");
   startingScreensPanel.classList.toggle("visible", tab === "starting-screens");
   if (tab === "starting-screens") loadStartingScreens();
   ```

4. Add click handler: `tabStartingScreens.addEventListener("click", () => switchTab("starting-screens"));`

5. Only the Logs section (~line 10748) monkey-patches `switchTab`. The Monitor section (~line 9474) only saves a reference but does NOT reassign. **The new `starting-screens` case must be inserted into the base `switchTab` function body (~line 5268–5316), NOT after the Logs monkey-patch at line 10748.** This ensures the Logs wrapper's `origSwitchTabLogs` closure captures the updated function. No changes needed to the Logs wrapper itself.

- [ ] **Step 5: Create app icon asset for preview**

```bash
mkdir -p public/admin/assets
cp app/src/main/res/mipmap-xxxhdpi/ic_launcher.webp public/admin/assets/app-icon.png
```

(Or export a PNG from the launcher icon. The preview needs a small raster image.)

- [ ] **Step 6: Commit**

```bash
git add public/admin/index.html public/admin/assets/
git commit -m "feat: add Starting Screens section skeleton to admin panel"
```

### Task 2: Screen card form and CRUD

**Files:**
- Modify: `public/admin/index.html`

- [ ] **Step 1: Implement loadStartingScreens()**

```javascript
// Use apiCall() — NOT raw fetch. 'authToken' does not exist in the codebase.
// apiCall() handles token acquisition via currentUser.getIdToken() internally.
async function loadStartingScreens() {
  try {
    const data = await apiCall("GET", "/api/config/startingScreens");
    renderScreenCards(data);
    startingScreensEmpty.style.display = Object.keys(data).length === 0 ? "block" : "none";
  } catch (err) {
    showToast("Failed to load starting screens: " + err.message, "error");
  }
}
```

- [ ] **Step 2: Implement renderScreenCards()**

For each screen, render a card with:
- Screen ID (read-only)
- Enabled toggle
- Dismissable toggle (disabled if another non-dismissable exists, with tooltip)
- Frequency dropdown
- Template dropdown
- Title input with character counter (3–100)
- Message textarea with character counter (10–500)
- Image type dropdown
- Background image upload/remove
- Start/end date pickers
- Status badge (Active/Scheduled/Expired)
- Allowlist textareas (device IDs, networks)
- Audit trail line
- Save + Delete buttons
- Device preview panel

- [ ] **Step 3: Implement saveScreen(screenId)**

```javascript
async function saveScreen(screenId) {
  const card = document.querySelector(`[data-screen-id="${screenId}"]`);
  const data = {
    [screenId]: {
      enabled: card.querySelector('.enabled-toggle').checked,
      dismissable: card.querySelector('.dismissable-toggle').checked,
      frequency: card.querySelector('.frequency-select').value,
      template: card.querySelector('.template-select').value,
      title: card.querySelector('.title-input').value,
      message: card.querySelector('.message-input').value,
      imageType: card.querySelector('.image-type-select').value || null,
      backgroundImage: card.querySelector('.bg-image-key').value || null,
      startDate: card.querySelector('.start-date').value || null,
      endDate: card.querySelector('.end-date').value || null,
      allowlist: {
        deviceIds: card.querySelector('.allowlist-devices').value.split('\n').filter(Boolean),
        networks: card.querySelector('.allowlist-networks').value.split('\n').filter(Boolean),
      },
    },
  };

  try {
    await apiCall("PUT", "/api/config/startingScreens", data);
    showToast('Screen saved');
    loadStartingScreens(); // Refresh cards
  } catch (err) {
    showToast(`Error: ${err.message || 'Failed to save'}`, 'error');
  }
}
```

- [ ] **Step 4: Implement addScreen()**

Prompt for screen ID (validate alphanumeric + hyphens/underscores), create card with defaults.

- [ ] **Step 5: Implement deleteScreen(screenId)**

Confirmation dialog, then save the full config without the deleted screen.

- [ ] **Step 6: Commit**

```bash
git add public/admin/index.html
git commit -m "feat: implement Starting Screens CRUD in admin panel"
```

### Task 3: Device preview panel

**Files:**
- Modify: `public/admin/index.html`

- [ ] **Step 1: Implement live preview**

The preview panel is a non-interactive HTML mockup rendered inside the `.screen-card-preview` div. It updates in real-time via `input` event listeners on all form fields.

```javascript
function updatePreview(card) {
  const preview = card.querySelector('.screen-card-preview');
  const template = card.querySelector('.template-select').value;
  const title = card.querySelector('.title-input').value;
  const message = card.querySelector('.message-input').value;
  const dismissable = card.querySelector('.dismissable-toggle').checked;
  const bgImage = card.querySelector('.bg-image-preview')?.src;

  preview.innerHTML = `
    <div class="preview-content" style="${bgImage ? `background-image: url(${bgImage}); background-size: cover;` : ''}">
      ${bgImage ? '<div style="position:absolute;inset:0;background:rgba(0,0,0,0.6);"></div>' : ''}
      <div style="position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:12px;padding:24px;">
        <!-- App icon: create public/admin/assets/app-icon.png from Android mipmap launcher icon -->
        <img src="assets/app-icon.png" width="48" height="48" style="border-radius:12px;" alt="ShyTalk" />
        <div style="font-size:20px;font-weight:bold;">ShyTalk</div>
        ${getTemplateIcon(template)}
        <div style="font-size:16px;font-weight:600;text-align:center;">${escapeHtml(title)}</div>
        <div style="font-size:13px;color:#888;text-align:center;">${escapeHtml(message)}</div>
        ${dismissable ? '<button style="margin-top:12px;padding:8px 24px;border-radius:8px;background:#007AFF;color:white;border:none;">Continue</button>' : ''}
      </div>
    </div>
  `;
}
```

- [ ] **Step 2: Attach event listeners**

```javascript
// On each form field: input, change → updatePreview(card)
card.querySelectorAll('input, textarea, select').forEach(el => {
  el.addEventListener('input', () => updatePreview(card));
  el.addEventListener('change', () => updatePreview(card));
});
```

- [ ] **Step 3: Commit**

```bash
git add public/admin/index.html
git commit -m "feat: add live device preview to Starting Screens admin panel"
```

### Task 4: Background image upload

**Files:**
- Modify: `public/admin/index.html`

- [ ] **Step 1: Implement image upload**

```javascript
// Use apiCall() — NOT raw fetch with authToken (authToken doesn't exist in the codebase)
async function uploadBackgroundImage(card, file) {
  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('path', 'starting-screens');

    const { url, originalSize, compressedSize } = await apiCall('POST', '/api/storage/upload', formData);
    card.querySelector('.bg-image-key').value = url;
    card.querySelector('.bg-image-preview').src = url;
    card.querySelector('.compression-info').textContent =
      `${(compressedSize / 1024).toFixed(0)}KB (from ${(originalSize / 1024).toFixed(0)}KB)`;
    updatePreview(card);
  } catch (err) {
    showToast('Image upload failed: ' + err.message, 'error');
  }
}
```

- [ ] **Step 2: Add drag-and-drop support**

- [ ] **Step 3: Commit**

```bash
git add public/admin/index.html
git commit -m "feat: add background image upload with compression info to Starting Screens"
```

### Task 5: Character counters, date pickers, status badges

**Files:**
- Modify: `public/admin/index.html`

- [ ] **Step 1: Character counters**

```javascript
function setupCharCounter(input, min, max, counterEl) {
  input.addEventListener('input', () => {
    const len = input.value.length;
    counterEl.textContent = `${len}/${max}`;
    counterEl.className = len < min || len > max ? 'char-counter over-limit' : 'char-counter';
  });
}
```

- [ ] **Step 2: Date pickers with status badges**

Compute status from start/end dates: Active, Scheduled, Expired. Show countdown for scheduled screens.

- [ ] **Step 3: Dismissable toggle constraint**

Disable non-dismissable option when another non-dismissable screen exists. Show tooltip explaining why.

- [ ] **Step 4: Unsaved changes warning**

```javascript
window.addEventListener('beforeunload', (e) => {
  if (hasUnsavedChanges) { e.preventDefault(); e.returnValue = ''; }
});
```

- [ ] **Step 5: Commit**

```bash
git add public/admin/index.html
git commit -m "feat: add validation UI, date pickers, and status badges to Starting Screens"
```

---

## Chunk 2: Playwright Tests

### Task 6: Write Playwright tests

**Files:**
- Create: `tests/web/admin-starting-screens.spec.ts`

- [ ] **Step 0: Update existing test files**

1. Add `'tab-starting-screens'` to the expected tabs array in `tests/web/admin-panel.spec.ts` (~line 46-55) so the existing tab test doesn't fail.
2. Add `'Starting Screens'` to the tabs array in `tests/web/admin-console-errors.spec.ts` (~line 57) so the new section gets console-error regression coverage.

- [ ] **Step 1: Write Playwright tests**

Key tests per spec section 6 "Playwright Tests". Use the established auth fixture pattern:

```typescript
// Import from fixtures, NOT bare @playwright/test — matches existing admin test convention
import { test, expect } from './fixtures/admin';
import { adminLogin, navigateToTab } from './helpers/admin-auth';

test.describe('Starting Screens Admin Section', () => {
  test.beforeEach(async ({ page }) => {
    // Must login first — navigateToTab only clicks a button, doesn't navigate to /admin/
    await adminLogin(page);
    await navigateToTab(page, 'Starting Screens');
  });

  test('section is visible in nav', async ({ page }) => {
    await expect(page.locator('#tab-starting-screens')).toBeVisible();
  });

  test('shows empty state when no screens configured', async ({ page }) => {
    await page.click('#tab-starting-screens');
    await expect(page.locator('#starting-screens-empty')).toBeVisible();
  });

  test('can create a new screen', async ({ page }) => {
    await page.click('#tab-starting-screens');
    await page.click('#add-screen-btn');
    // Fill form...
    // Save...
    // Verify card appears
  });

  test('preview updates live as title is typed', async ({ page }) => {
    // Type in title field, verify preview content updates
  });

  test('character counter turns red at limit', async ({ page }) => {
    // Type 101 chars in title, verify counter has .over-limit class
  });

  test('cannot enable two non-dismissable screens', async ({ page }) => {
    // Create first non-dismissable → save
    // Try to create second → toggle should be disabled
  });

  test('background image upload shows compression savings', async ({ page }) => {
    // Upload image, verify compression info text appears
  });

  // ... all other Playwright tests from spec section 6
});
```

- [ ] **Step 2: Run Playwright tests**

```bash
npx playwright test tests/web/admin-starting-screens.spec.ts
```

Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add tests/web/admin-starting-screens.spec.ts
git commit -m "test: add Playwright tests for Starting Screens admin panel"
```

### Task 7: Expand Playwright test coverage per spec

- [ ] **Step 1: Add all remaining tests from spec**

Systematically add every test from spec section 6 "Playwright Tests":
- CRUD operations (all 16 template × dismissable × frequency combinations)
- Device preview (all templates, background image, scrolling)
- Validation (title/message length, dates, blocking constraint)
- Background image (upload, remove, drag-and-drop, oversized, non-image)
- Date pickers (start, end, UTC offset, status badges)
- Allowlist (device IDs, networks, paste, trimming)
- State management (unsaved changes, rapid saves, concurrent tabs, API errors)
- Accessibility (labels, tab order, focus, screen reader)
- Cross-browser (Chrome, Firefox, Safari, Edge)
- Deep linking (`#starting-screens`)

- [ ] **Step 2: Run full Playwright suite**

```bash
npx playwright test
```

Expected: ALL PASS (existing tests unaffected)

- [ ] **Step 3: Commit**

```bash
git add tests/web/admin-starting-screens.spec.ts
git commit -m "test: exhaustive Playwright starting screens test coverage per spec"
```
