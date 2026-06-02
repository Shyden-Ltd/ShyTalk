/**
 * Starting Screens tab — CRUD for app launch screens with templates,
 * scheduling, background images, device/network allowlists, and live preview.
 *
 * Extracted from inline script block in index.html (PR B).
 * ~480 lines of dense DOM manipulation.
 */

import { apiCall } from '/js/core/api.js';
import { showToast, escapeHtml, sanitizeImageUrl } from '/js/core/ui.js';

// ── State ──────────────────────────────────────────────────────────

let hasUnsavedChanges = false;

// ── DOM refs ───────────────────────────────────────────────────────

let screensList;
let emptyEl;

// ── Public API ─────────────────────────────────────────────────────

export function init() {
  screensList = document.getElementById('starting-screens-list');
  emptyEl = document.getElementById('starting-screens-empty');

  window.addEventListener('beforeunload', (e) => {
    if (hasUnsavedChanges) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  document
    .getElementById('add-screen-btn')
    .addEventListener('click', addScreen);

  document
    .getElementById('deleted-screens-header')
    .addEventListener('click', () => {
      const list = document.getElementById('deleted-screens-list');
      const arrow = document.getElementById('deleted-screens-arrow');
      if (list.style.display === 'none') {
        list.style.display = 'block';
        arrow.style.transform = 'rotate(90deg)';
      } else {
        list.style.display = 'none';
        arrow.style.transform = 'rotate(0deg)';
      }
    });
}

export function activate() {
  load();
}

export function deactivate() {}

// ── Helpers ────────────────────────────────────────────────────────

function getStatusBadge(screen) {
  if (!screen.enabled) {
    return '<span class="status-badge status-expired">Disabled</span>';
  }
  const now = Date.now();
  if (screen.startDate && new Date(screen.startDate).getTime() > now) {
    return '<span class="status-badge status-scheduled">Scheduled</span>';
  }
  if (screen.endDate && new Date(screen.endDate).getTime() <= now) {
    return '<span class="status-badge status-expired">Expired</span>';
  }
  return '<span class="status-badge status-active">Active</span>';
}

function setupCharCounter(input, min, max, counterEl) {
  const update = () => {
    const len = input.value.length;
    counterEl.textContent = len + '/' + max;
    counterEl.classList.toggle('over-limit', len < min || len > max);
  };
  input.addEventListener('input', update);
  update();
}

function getTemplateIconSvg(template, size) {
  size = size || 80;
  const half = size / 2;
  const icons = {
    warning: `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${half}" cy="${half}" r="${half}" fill="#e74c3c"/><text x="${half}" y="${half + 10}" text-anchor="middle" font-size="${Math.round(size * 0.5)}" font-weight="bold" fill="#fff">!</text></svg>`,
    promotional: `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${half}" cy="${half}" r="${half}" fill="#9b59b6"/><polygon points="${half},${Math.round(size * 0.15)} ${Math.round(size * 0.62)},${Math.round(size * 0.38)} ${Math.round(size * 0.82)},${Math.round(size * 0.38)} ${Math.round(size * 0.68)},${Math.round(size * 0.55)} ${Math.round(size * 0.75)},${Math.round(size * 0.82)} ${half},${Math.round(size * 0.65)} ${Math.round(size * 0.25)},${Math.round(size * 0.82)} ${Math.round(size * 0.32)},${Math.round(size * 0.55)} ${Math.round(size * 0.18)},${Math.round(size * 0.38)} ${Math.round(size * 0.38)},${Math.round(size * 0.38)}" fill="#fff"/></svg>`,
    announcement: `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${half}" cy="${half}" r="${half}" fill="#3498db"/><path d="M${Math.round(size * 0.28)} ${Math.round(size * 0.35)}L${Math.round(size * 0.7)} ${Math.round(size * 0.2)}V${Math.round(size * 0.7)}L${Math.round(size * 0.28)} ${Math.round(size * 0.55)}Z" fill="#fff"/><rect x="${Math.round(size * 0.2)}" y="${Math.round(size * 0.35)}" width="${Math.round(size * 0.1)}" height="${Math.round(size * 0.2)}" rx="2" fill="#fff"/></svg>`,
    info: `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${half}" cy="${half}" r="${half}" fill="#2ecc71"/><text x="${half}" y="${half + 10}" text-anchor="middle" font-size="${Math.round(size * 0.5)}" font-weight="bold" font-style="italic" fill="#fff">i</text></svg>`,
  };
  return icons[template] || icons.info;
}

function updatePreview(card) {
  const preview = card.querySelector('.screen-card-preview');
  const template = card.querySelector('.template-select').value;
  const title = card.querySelector('.title-input').value;
  const message = card.querySelector('.message-input').value;
  const dismissable = card.querySelector('.dismissable-toggle').checked;
  const imageType = card.querySelector('.image-type-select').value;
  const bgImageUrl = card.querySelector('.bg-image-key')
    ? card.querySelector('.bg-image-key').value
    : '';
  const bgFitSelect = card.querySelector('.bg-image-fit-select');
  const bgFit = bgFitSelect ? bgFitSelect.value : 'cover';

  const templateColors = {
    warning: '#e74c3c',
    promotional: '#9b59b6',
    announcement: '#3498db',
    info: '#2ecc71',
  };
  const color = templateColors[template] || '#888';

  let iconHtml;
  if (imageType === 'police_duck') {
    iconHtml =
      '<img src="assets/police_duck.png" width="120" height="120" style="border-radius:16px;object-fit:contain;" alt="Police Duck" />';
  } else {
    iconHtml = getTemplateIconSvg(template, 80);
  }

  const textColor = bgImageUrl ? '#fff' : 'var(--text)';
  const subColor = bgImageUrl ? '#ccc' : 'var(--text2)';
  const titleColor = bgImageUrl ? '#fff' : color;

  // Build DOM programmatically to avoid innerHTML XSS risk (CodeQL js/xss-through-dom)
  preview.textContent = '';
  const content = document.createElement('div');
  content.className = 'preview-content';
  const safeBgUrl = sanitizeImageUrl(bgImageUrl);
  if (safeBgUrl) {
    content.style.backgroundImage = `url(${encodeURI(safeBgUrl)})`;
    content.style.backgroundSize = bgFit;
    content.style.backgroundPosition = 'center';
    content.style.backgroundRepeat = 'no-repeat';
    const overlayEl = document.createElement('div');
    overlayEl.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.6);';
    content.appendChild(overlayEl);
  }
  const inner = document.createElement('div');
  inner.style.cssText = 'position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:12px;padding:24px;width:100%;';

  const appIcon = document.createElement('img');
  appIcon.src = 'assets/app-icon.webp';
  appIcon.width = 48;
  appIcon.height = 48;
  appIcon.style.borderRadius = '12px';
  appIcon.alt = 'ShyTalk';
  inner.appendChild(appIcon);

  const appName = document.createElement('div');
  appName.style.cssText = `font-size:18px;font-weight:bold;color:${textColor};`;
  appName.textContent = 'ShyTalk';
  inner.appendChild(appName);

  // iconHtml is safe (hardcoded SVG or static img tag) — parse via template
  const iconContainer = document.createElement('div');
  iconContainer.innerHTML = iconHtml;
  while (iconContainer.firstChild) inner.appendChild(iconContainer.firstChild);

  const titleEl = document.createElement('div');
  titleEl.style.cssText = `font-size:14px;font-weight:600;text-align:center;color:${titleColor};`;
  titleEl.textContent = title || 'Title';
  inner.appendChild(titleEl);

  const msgEl = document.createElement('div');
  msgEl.style.cssText = `font-size:12px;text-align:center;white-space:pre-wrap;word-break:break-word;color:${subColor};`;
  msgEl.textContent = message || 'Message';
  inner.appendChild(msgEl);

  if (dismissable) {
    const btn = document.createElement('button');
    btn.style.cssText = 'margin-top:12px;padding:8px 24px;border-radius:8px;background:#007AFF;color:white;border:none;font-size:13px;';
    btn.textContent = 'Continue';
    inner.appendChild(btn);
  }
  content.appendChild(inner);
  preview.appendChild(content);
}

async function uploadBackgroundImage(card, file) {
  const formArea = card.querySelector('.screen-card-form');
  const inputs = formArea.querySelectorAll(
    'input, select, textarea, button',
  );
  for (const inp of inputs) inp.disabled = true;
  const overlay = document.createElement('div');
  overlay.className = 'upload-overlay';
  overlay.innerHTML =
    '<div style="display:flex;flex-direction:column;align-items:center;gap:8px;"><div class="upload-spinner"></div><div style="color:#fff;font-size:13px;font-weight:600;">Uploading...</div></div>';
  formArea.style.position = 'relative';
  formArea.appendChild(overlay);

  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('path', 'starting-screens');
    const result = await apiCall('POST', '/api/storage/upload', formData);
    card.querySelector('.bg-image-key').value = result.url;
    const info = card.querySelector('.compression-info');
    if (info && result.compressedSize && result.originalSize) {
      info.textContent =
        (result.compressedSize / 1024).toFixed(0) +
        'KB (from ' +
        (result.originalSize / 1024).toFixed(0) +
        'KB)';
    }
    updatePreview(card);
    hasUnsavedChanges = true;
  } catch (err) {
    showToast('Image upload failed: ' + err.message, 'error');
  } finally {
    if (overlay.parentElement) overlay.remove();
    for (const inp of inputs) inp.disabled = false;
  }
}

// ── Device/Network Allowlist Pickers ───────────────────────────────

function setupDeviceSearchPicker(card) {
  const searchInput = card.querySelector('.device-search-input');
  const searchBtn = card.querySelector('.device-search-btn');
  const resultsDiv = card.querySelector('.device-search-results');
  if (!searchInput || !searchBtn) return;

  async function doSearch() {
    const q = searchInput.value.trim();
    if (!q || q.length < 2) {
      showToast('Enter at least 2 characters to search', 'error');
      return;
    }
    resultsDiv.style.display = 'block';
    resultsDiv.innerHTML =
      '<div style="padding:10px;color:var(--text2);font-size:13px;">Searching...</div>';
    try {
      const result = await apiCall(
        'GET',
        '/api/admin/devices?q=' + encodeURIComponent(q),
      );
      const devList = Array.isArray(result)
        ? result
        : result && result.devices
          ? result.devices
          : [];
      if (devList.length === 0) {
        resultsDiv.innerHTML =
          '<div style="padding:10px;color:var(--text2);font-size:13px;">No devices found</div>';
        return;
      }
      const existingIds = getDeviceIdsFromChips(card);
      resultsDiv.innerHTML = '';
      devList.forEach((dev) => {
        const alreadyAdded = existingIds.includes(dev.id);
        const row = document.createElement('div');
        row.style.cssText = `padding:8px 10px;border-bottom:1px solid var(--border);cursor:${alreadyAdded ? 'default' : 'pointer'};display:flex;justify-content:space-between;align-items:center;font-size:13px;${alreadyAdded ? 'opacity:0.5;' : ''}`;
        row.innerHTML = `<div><strong>${escapeHtml(dev.id ? dev.id.slice(0, 20) + '...' : '?')}</strong>${dev.uniqueId ? ` <span style="color:var(--text2);">ID: ${escapeHtml(String(dev.uniqueId))}</span>` : ''}${dev.model ? ` <span style="color:var(--text2);">${escapeHtml(dev.model)}</span>` : ''}${dev.lastIp ? ` <span style="color:var(--text2);font-size:11px;">IP: ${escapeHtml(dev.lastIp)}</span>` : ''}</div>${alreadyAdded ? '<span style="font-size:11px;color:var(--text2);">Added</span>' : '<span style="color:var(--accent);font-weight:600;">+ Add</span>'}`;
        if (!alreadyAdded) {
          row.addEventListener('click', () => {
            addDeviceChip(card, dev.id);
            syncChipsToTextarea(card, 'device');
            row.style.opacity = '0.5';
            row.style.cursor = 'default';
            hasUnsavedChanges = true;
          });
        }
        resultsDiv.appendChild(row);
      });
    } catch (_) {
      resultsDiv.innerHTML =
        '<div style="padding:10px;color:#e74c3c;font-size:13px;">Search failed</div>';
    }
  }
  searchBtn.addEventListener('click', doSearch);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doSearch();
    }
  });
}

function setupNetworkPicker(card) {
  const addInput = card.querySelector('.network-add-input');
  const addBtn = card.querySelector('.network-add-btn');
  if (!addInput || !addBtn) return;
  function doAdd() {
    const val = addInput.value.trim();
    if (!val) return;
    if (!/^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/.test(val)) {
      showToast('Invalid IP or CIDR format', 'error');
      return;
    }
    addNetworkChip(card, val);
    syncChipsToTextarea(card, 'network');
    addInput.value = '';
    hasUnsavedChanges = true;
  }
  addBtn.addEventListener('click', doAdd);
  addInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doAdd();
    }
  });
}

function getDeviceIdsFromChips(card) {
  return Array.from(
    card.querySelectorAll('.allowlist-device-chips .allowlist-chip'),
  ).map((c) => c.getAttribute('data-value'));
}

function addDeviceChip(card, deviceId) {
  const container = card.querySelector('.allowlist-device-chips');
  if (!container) return;
  for (const existing of container.querySelectorAll('.allowlist-chip')) {
    if (existing.getAttribute('data-value') === deviceId) return;
  }
  const chip = document.createElement('span');
  chip.className = 'allowlist-chip';
  chip.setAttribute('data-value', deviceId);
  chip.style.cssText =
    'display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:var(--surface2);border:1px solid var(--border);border-radius:12px;font-size:12px;font-family:monospace;color:var(--text);';
  chip.innerHTML = `${escapeHtml(deviceId.length > 24 ? deviceId.slice(0, 24) + '...' : deviceId)}<button type="button" style="background:none;border:none;color:var(--text2);cursor:pointer;font-size:14px;padding:0 2px;line-height:1;" title="Remove">&times;</button>`;
  chip.querySelector('button').addEventListener('click', () => {
    chip.remove();
    syncChipsToTextarea(card, 'device');
    hasUnsavedChanges = true;
  });
  container.appendChild(chip);
}

function addNetworkChip(card, network) {
  const container = card.querySelector('.allowlist-network-chips');
  if (!container) return;
  for (const existing of container.querySelectorAll('.allowlist-chip')) {
    if (existing.getAttribute('data-value') === network) return;
  }
  const chip = document.createElement('span');
  chip.className = 'allowlist-chip';
  chip.setAttribute('data-value', network);
  chip.style.cssText =
    'display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:var(--surface2);border:1px solid var(--border);border-radius:12px;font-size:12px;font-family:monospace;color:var(--text);';
  chip.innerHTML = `${escapeHtml(network)}<button type="button" style="background:none;border:none;color:var(--text2);cursor:pointer;font-size:14px;padding:0 2px;line-height:1;" title="Remove">&times;</button>`;
  chip.querySelector('button').addEventListener('click', () => {
    chip.remove();
    syncChipsToTextarea(card, 'network');
    hasUnsavedChanges = true;
  });
  container.appendChild(chip);
}

function syncChipsToTextarea(card, type) {
  const selector =
    type === 'device'
      ? '.allowlist-device-chips .allowlist-chip'
      : '.allowlist-network-chips .allowlist-chip';
  const textarea =
    type === 'device'
      ? card.querySelector('.allowlist-devices')
      : card.querySelector('.allowlist-networks');
  const values = Array.from(card.querySelectorAll(selector)).map((c) =>
    c.getAttribute('data-value'),
  );
  textarea.value = values.join('\n');
}

function renderAllowlistChips(card) {
  const dt = card.querySelector('.allowlist-devices');
  const nt = card.querySelector('.allowlist-networks');
  if (dt && dt.value.trim()) {
    dt.value
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((id) => addDeviceChip(card, id));
  }
  if (nt && nt.value.trim()) {
    nt.value
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((net) => addNetworkChip(card, net));
  }
}

// ── Screen Card Rendering ──────────────────────────────────────────

function renderScreenCard(
  screenId,
  screen,
  enabledNonDismissableIds,
  isLocal,
) {
  const card = document.createElement('div');
  card.className = 'screen-card';
  card.setAttribute('data-screen-id', screenId);
  if (isLocal) card.setAttribute('data-local', 'true');
  const startDateLocal = screen.startDate
    ? new Date(screen.startDate).toISOString().slice(0, 16)
    : '';
  const endDateLocal = screen.endDate
    ? new Date(screen.endDate).toISOString().slice(0, 16)
    : '';
  const lastModifiedBy = screen.lastModifiedBy || 'unknown';
  const lastModifiedAt = screen.lastModifiedAt
    ? new Date(screen.lastModifiedAt).toLocaleString()
    : 'unknown';
  const bgFit = screen.backgroundImageFit || 'cover';
  const otherNonDismissable = enabledNonDismissableIds.filter(
    (id) => id !== screenId,
  );
  const dismissableDisabled =
    otherNonDismissable.length > 0 && screen.enabled;
  const dismissableTooltip = dismissableDisabled
    ? 'Another enabled screen is already non-dismissable'
    : '';
  const statusBadge = getStatusBadge(screen);
  const inputStyle =
    'width:100%;padding:8px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:14px;font-family:inherit;';
  const labelStyle =
    'display:block;margin-bottom:4px;font-size:13px;color:var(--text2);';
  const checkboxLabelStyle =
    'display:flex;align-items:center;gap:8px;font-size:14px;color:var(--text);cursor:pointer;';
  const frequencyOnce = screen.frequency === 'once';

  // Build the card HTML — this is large but preserves exact DOM structure for Playwright compatibility
  card.innerHTML = buildScreenCardHtml(
    screenId,
    screen,
    statusBadge,
    inputStyle,
    labelStyle,
    checkboxLabelStyle,
    dismissableDisabled,
    dismissableTooltip,
    frequencyOnce,
    startDateLocal,
    endDateLocal,
    bgFit,
    lastModifiedBy,
    lastModifiedAt,
  );

  screensList.appendChild(card);

  // Wire preview device toggle
  const phoneBtn = card.querySelector('.preview-phone-btn');
  const tabletBtn = card.querySelector('.preview-tablet-btn');
  const previewEl = card.querySelector('.screen-card-preview');
  phoneBtn.addEventListener('click', () => {
    previewEl.classList.remove('tablet');
    phoneBtn.classList.add('active');
    tabletBtn.classList.remove('active');
  });
  tabletBtn.addEventListener('click', () => {
    previewEl.classList.add('tablet');
    tabletBtn.classList.add('active');
    phoneBtn.classList.remove('active');
  });

  // Character counters
  setupCharCounter(
    card.querySelector('.title-input'),
    3,
    100,
    card.querySelector('.title-counter'),
  );
  setupCharCounter(
    card.querySelector('.message-input'),
    10,
    500,
    card.querySelector('.message-counter'),
  );

  // Preview update on form change
  const previewInputs = card.querySelectorAll(
    '.title-input, .message-input, .template-select, .image-type-select, .dismissable-toggle, .enabled-toggle, .bg-image-fit-select',
  );
  for (const inp of previewInputs) {
    const handler = () => {
      updatePreview(card);
      hasUnsavedChanges = true;
    };
    inp.addEventListener('input', handler);
    inp.addEventListener('change', handler);
  }

  // Track other changes
  const otherInputs = card.querySelectorAll(
    '.frequency-select, .start-date, .end-date, .allowlist-devices, .allowlist-networks',
  );
  for (const inp of otherInputs) {
    inp.addEventListener('input', () => {
      hasUnsavedChanges = true;
    });
    inp.addEventListener('change', () => {
      hasUnsavedChanges = true;
    });
  }

  // Background image upload
  card.querySelector('.bg-image-file').addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0])
      uploadBackgroundImage(card, e.target.files[0]);
  });

  // Remove background image
  const removeBgBtn = card.querySelector('.remove-bg-btn');
  if (removeBgBtn) {
    removeBgBtn.addEventListener('click', function () {
      card.querySelector('.bg-image-key').value = '';
      const info = card.querySelector('.compression-info');
      if (info) info.textContent = '';
      updatePreview(card);
      hasUnsavedChanges = true;
      const imgP = card
        .querySelector('.bg-image-file')
        .parentElement.parentElement.querySelector('img');
      if (imgP) imgP.remove();
      this.remove();
    });
  }

  // Allowlist pickers
  setupDeviceSearchPicker(card);
  setupNetworkPicker(card);
  renderAllowlistChips(card);

  // Save/Delete
  card
    .querySelector('.save-screen-btn')
    .addEventListener('click', () => saveScreen(screenId));
  card
    .querySelector('.delete-screen-btn')
    .addEventListener('click', () => deleteScreen(screenId));

  updatePreview(card);
  return card;
}

function buildScreenCardHtml(
  screenId,
  screen,
  statusBadge,
  inputStyle,
  labelStyle,
  checkboxLabelStyle,
  dismissableDisabled,
  dismissableTooltip,
  frequencyOnce,
  startDateLocal,
  endDateLocal,
  bgFit,
  lastModifiedBy,
  lastModifiedAt,
) {
  return (
    '<div class="screen-card-form">' +
    '<div>' +
    statusBadge +
    '</div>' +
    '<div><label style="' +
    checkboxLabelStyle +
    '"><input type="checkbox" class="enabled-toggle" ' +
    (screen.enabled ? 'checked' : '') +
    ' />Enabled</label></div>' +
    '<div><label style="' +
    checkboxLabelStyle +
    '" ' +
    (dismissableTooltip
      ? 'title="' + escapeHtml(dismissableTooltip) + '"'
      : '') +
    '><input type="checkbox" class="dismissable-toggle" ' +
    (screen.dismissable ? 'checked' : '') +
    (dismissableDisabled ? ' disabled' : '') +
    ' />Dismissable' +
    (dismissableDisabled
      ? ' <span style="font-size:11px;color:var(--text2);">(locked)</span>'
      : '') +
    '</label></div>' +
    '<div><div class="frequency-toggle-wrapper"><label class="frequency-toggle-switch"><input type="checkbox" class="frequency-select" ' +
    (frequencyOnce ? 'checked' : '') +
    ' /><span class="frequency-toggle-slider"></span></label><span style="font-size:14px;color:var(--text);">Show only once</span></div></div>' +
    '<div><label style="' +
    labelStyle +
    '">Template</label><select class="template-select" style="' +
    inputStyle +
    '"><option value="warning"' +
    (screen.template === 'warning' ? ' selected' : '') +
    '>Warning</option><option value="promotional"' +
    (screen.template === 'promotional' ? ' selected' : '') +
    '>Promotional</option><option value="announcement"' +
    (screen.template === 'announcement' ? ' selected' : '') +
    '>Announcement</option><option value="info"' +
    (screen.template === 'info' ? ' selected' : '') +
    '>Info</option></select></div>' +
    '<div><label style="' +
    labelStyle +
    '">Title</label><input type="text" class="title-input" value="' +
    escapeHtml(screen.title || '') +
    '" placeholder="Screen title (3-100 chars)" maxlength="100" style="' +
    inputStyle +
    '" /><span class="title-counter char-counter"></span></div>' +
    '<div><label style="' +
    labelStyle +
    '">Message</label><textarea class="message-input" placeholder="Screen message (10-500 chars)" maxlength="500" rows="4" style="' +
    inputStyle +
    'resize:vertical;">' +
    escapeHtml(screen.message || '') +
    '</textarea><span class="message-counter char-counter"></span></div>' +
    '<div><label style="' +
    labelStyle +
    '">Image Type</label><select class="image-type-select" style="' +
    inputStyle +
    '"><option value="none"' +
    (!screen.imageType || screen.imageType === 'none'
      ? ' selected'
      : '') +
    '>None</option><option value="police_duck"' +
    (screen.imageType === 'police_duck' ? ' selected' : '') +
    '>Police Duck</option></select></div>' +
    '<div><label style="' +
    labelStyle +
    '">Background Image</label><input type="hidden" class="bg-image-key" value="' +
    escapeHtml(screen.backgroundImage || '') +
    '" /><div style="display:flex;gap:8px;align-items:center;"><input type="file" class="bg-image-file" accept="image/*" style="font-size:13px;color:var(--text);" />' +
    (screen.backgroundImage
      ? '<button type="button" class="remove-bg-btn" style="padding:4px 10px;background:var(--danger,#e74c3c);color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;">Remove</button>'
      : '') +
    '</div><span class="compression-info" style="font-size:11px;color:var(--text2);margin-top:4px;display:block;"></span>' +
    // Defense-in-depth: route the URL through the project's
    // sanitizeImageUrl helper (same one used by updatePreview at line
    // 134) so non-HTTP(S) schemes are rejected before the URL hits an
    // `src=""`. escapeHtml alone prevents HTML injection but doesn't
    // reject `javascript:` schemes; reusing the existing helper keeps
    // the URL-sanitization contract centralized.
    ((() => {
      const safe = sanitizeImageUrl(screen.backgroundImage);
      return safe
        ? '<img src="' +
          escapeHtml(safe) +
          '" style="max-width:120px;max-height:80px;border-radius:6px;margin-top:6px;border:1px solid var(--border);" />'
        : '';
    })()) +
    '</div>' +
    '<div><label style="' +
    labelStyle +
    '">Background Display Mode</label><select class="bg-image-fit-select" style="' +
    inputStyle +
    '"><option value="cover"' +
    (bgFit === 'cover' ? ' selected' : '') +
    '>Cover (fill, crop)</option><option value="contain"' +
    (bgFit === 'contain' ? ' selected' : '') +
    '>Contain (fit, letterbox)</option><option value="100% 100%"' +
    (bgFit === '100% 100%' ? ' selected' : '') +
    '>Stretch (fill, distort)</option></select></div>' +
    '<div><label style="' +
    labelStyle +
    '">Start Date</label><input type="datetime-local" class="start-date" value="' +
    startDateLocal +
    '" style="' +
    inputStyle +
    '" /></div>' +
    '<div><label style="' +
    labelStyle +
    '">End Date</label><input type="datetime-local" class="end-date" value="' +
    endDateLocal +
    '" style="' +
    inputStyle +
    '" /></div>' +
    '<div style="border:1px solid var(--border);border-radius:8px;padding:12px;">' +
    '<label style="' +
    labelStyle +
    'font-weight:600;font-size:14px;margin-bottom:8px;">Testing Allowlist</label>' +
    '<p style="font-size:12px;color:var(--text2);margin:0 0 10px 0;">Restrict to specific devices or networks for testing. Leave empty to show to all users.</p>' +
    '<div><label style="' +
    labelStyle +
    '">Device IDs <span style="font-size:11px;color:var(--text2);">(search by user ID or device)</span></label>' +
    '<div style="display:flex;gap:6px;margin-bottom:6px;"><input type="text" class="device-search-input" placeholder="Search by uniqueId, username, or device model..." style="' +
    inputStyle +
    'flex:1;" /><button type="button" class="device-search-btn" style="padding:6px 14px;background:var(--accent);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;white-space:nowrap;">Search</button></div>' +
    '<div class="device-search-results" style="display:none;max-height:180px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;margin-bottom:8px;background:var(--surface2);"></div>' +
    '<div class="allowlist-device-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;"></div>' +
    '<textarea class="allowlist-devices" rows="2" style="' +
    inputStyle +
    'resize:vertical;font-family:monospace;font-size:12px;display:none;">' +
    escapeHtml(
      screen.allowlist && screen.allowlist.deviceIds
        ? screen.allowlist.deviceIds.join('\n')
        : '',
    ) +
    '</textarea>' +
    '</div>' +
    '<div style="margin-top:10px;"><label style="' +
    labelStyle +
    '">Networks <span style="font-size:11px;color:var(--text2);">(IP addresses or CIDR ranges)</span></label>' +
    '<div class="allowlist-network-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;"></div>' +
    '<div style="display:flex;gap:6px;"><input type="text" class="network-add-input" placeholder="Enter IP or CIDR (e.g. 10.0.0.1 or 10.0.0.0/8)" style="' +
    inputStyle +
    'flex:1;" /><button type="button" class="network-add-btn" style="padding:6px 14px;background:var(--accent);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;white-space:nowrap;">Add</button></div>' +
    '<textarea class="allowlist-networks" rows="2" style="' +
    inputStyle +
    'resize:vertical;font-family:monospace;font-size:12px;display:none;">' +
    escapeHtml(
      screen.allowlist && screen.allowlist.networks
        ? screen.allowlist.networks.join('\n')
        : '',
    ) +
    '</textarea>' +
    '</div>' +
    '</div>' +
    '<div style="font-size:12px;color:var(--text2);padding:8px 0;border-top:1px solid var(--border);">Last modified by <strong>' +
    escapeHtml(lastModifiedBy) +
    '</strong> at ' +
    escapeHtml(lastModifiedAt) +
    '</div>' +
    '<div style="display:flex;gap:8px;"><button type="button" class="save-screen-btn" style="padding:8px 20px;background:var(--accent);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;">Save</button><button type="button" class="delete-screen-btn" style="padding:8px 20px;background:var(--danger,#e74c3c);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;">Delete</button></div>' +
    '</div>' +
    '<div class="screen-card-preview-wrapper">' +
    '<div class="preview-device-toggle"><button type="button" class="preview-phone-btn active">Phone</button><button type="button" class="preview-tablet-btn">Tablet</button></div>' +
    '<div class="screen-card-preview"></div>' +
    '</div>'
  );
}

// ── Deleted Screen Cards ───────────────────────────────────────────

function renderDeletedScreenCard(screenId, screen) {
  const card = document.createElement('div');
  card.className = 'screen-card deleted-screen-card';
  card.setAttribute('data-screen-id', screenId);
  card.setAttribute('data-deleted', 'true');
  const deletedAt = screen.deletedAt
    ? new Date(screen.deletedAt).toLocaleString()
    : 'unknown';
  const deletedBy = screen.deletedBy || 'unknown';
  card.style.cssText =
    'opacity:0.55;filter:grayscale(0.6);pointer-events:auto;';
  card.innerHTML = `
    <div style="padding:16px;border:1px solid var(--border);border-radius:8px;background:var(--surface2);">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
        <div>
          <div style="font-size:15px;font-weight:600;color:var(--text);text-decoration:line-through;">${escapeHtml(screen.title || '(no title)')}</div>
          <div style="font-size:12px;color:var(--text2);margin-top:4px;">ID: <code>${escapeHtml(screenId)}</code></div>
          <div style="font-size:12px;color:var(--text2);">Template: ${escapeHtml(screen.template || 'unknown')}</div>
          <div style="font-size:12px;color:var(--text2);">Deleted by <strong>${escapeHtml(deletedBy)}</strong> at ${escapeHtml(deletedAt)}</div>
        </div>
        <span class="status-badge status-expired">Deleted</span>
      </div>
      <div style="display:flex;gap:8px;">
        <button type="button" class="restore-screen-btn" style="padding:6px 16px;background:var(--accent);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;">Restore</button>
        <button type="button" class="permanent-delete-btn" style="padding:6px 16px;background:var(--danger,#e74c3c);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;">Permanently Delete</button>
      </div>
    </div>`;

  card
    .querySelector('.restore-screen-btn')
    .addEventListener('click', async function () {
      if (this.disabled) return;
      this.disabled = true;
      try {
        await apiCall(
          'POST',
          '/api/config/startingScreens/' +
            encodeURIComponent(screenId) +
            '/restore',
        );
        showToast('Screen restored');
        load();
      } catch (err) {
        showToast('Failed to restore: ' + err.message, 'error');
      } finally {
        this.disabled = false;
      }
    });

  card
    .querySelector('.permanent-delete-btn')
    .addEventListener('click', async function () {
      if (this.disabled) return;
      if (
        !confirm(
          'Permanently delete screen "' +
            screenId +
            '"? This cannot be undone.',
        )
      )
        return;
      this.disabled = true;
      try {
        await apiCall(
          'DELETE',
          '/api/config/startingScreens/' +
            encodeURIComponent(screenId) +
            '?permanent=true',
        );
        showToast('Screen permanently deleted');
        load();
      } catch (err) {
        showToast(
          'Failed to permanently delete: ' + err.message,
          'error',
        );
      } finally {
        this.disabled = false;
      }
    });

  return card;
}

// ── Screen List Rendering ──────────────────────────────────────────

function renderScreenCards(data) {
  screensList.innerHTML = '';
  const deletedScreensList = document.getElementById(
    'deleted-screens-list',
  );
  const deletedScreensSection = document.getElementById(
    'deleted-screens-section',
  );
  const deletedScreensTitle = document.getElementById(
    'deleted-screens-title',
  );
  deletedScreensList.innerHTML = '';

  const activeScreens = {};
  const deletedScreens = {};
  for (const id in data) {
    if (data[id].deleted) deletedScreens[id] = data[id];
    else activeScreens[id] = data[id];
  }

  const enabledNonDismissableIds = [];
  for (const aid in activeScreens) {
    if (activeScreens[aid].enabled && !activeScreens[aid].dismissable)
      enabledNonDismissableIds.push(aid);
  }

  for (const sid in activeScreens) {
    renderScreenCard(
      sid,
      activeScreens[sid],
      enabledNonDismissableIds,
      false,
    );
  }

  const deletedCount = Object.keys(deletedScreens).length;
  if (deletedCount > 0) {
    deletedScreensSection.style.display = 'block';
    deletedScreensTitle.textContent =
      'Deleted Screens (' + deletedCount + ')';
    deletedScreensList.style.display = 'block';
    const arrow = document.getElementById('deleted-screens-arrow');
    if (arrow) arrow.style.transform = 'rotate(90deg)';
    for (const did in deletedScreens) {
      deletedScreensList.appendChild(
        renderDeletedScreenCard(did, deletedScreens[did]),
      );
    }
  } else {
    deletedScreensSection.style.display = 'none';
  }
}

// ── CRUD Operations ────────────────────────────────────────────────

async function load() {
  try {
    const data = await apiCall(
      'GET',
      '/api/config/startingScreens/admin',
    );
    const activeCount = Object.keys(data).filter(
      (id) => !data[id].deleted,
    ).length;
    emptyEl.style.display = activeCount === 0 ? 'block' : 'none';
    renderScreenCards(data);
  } catch (err) {
    showToast(
      'Failed to load starting screens: ' + err.message,
      'error',
    );
  }
}

async function saveScreen(screenId) {
  const card = document.querySelector(
    '[data-screen-id="' + screenId + '"]',
  );
  if (!card) return;

  const title = card.querySelector('.title-input').value;
  const message = card.querySelector('.message-input').value;

  if (title.length < 3 || title.length > 100) {
    showToast('Title must be 3-100 characters', 'error');
    return;
  }
  if (message.length < 10 || message.length > 500) {
    showToast('Message must be 10-500 characters', 'error');
    return;
  }

  const screenData = {
    enabled: card.querySelector('.enabled-toggle').checked,
    dismissable: card.querySelector('.dismissable-toggle').checked,
    frequency: card.querySelector('.frequency-select').checked
      ? 'once'
      : 'every_launch',
    template: card.querySelector('.template-select').value,
    title: title,
    message: message,
    imageType:
      card.querySelector('.image-type-select').value === 'none'
        ? null
        : card.querySelector('.image-type-select').value || null,
    backgroundImage:
      card.querySelector('.bg-image-key').value || null,
    startDate: card.querySelector('.start-date').value
      ? new Date(card.querySelector('.start-date').value).toISOString()
      : null,
    endDate: card.querySelector('.end-date').value
      ? new Date(card.querySelector('.end-date').value).toISOString()
      : null,
    backgroundImageFit: card.querySelector('.bg-image-fit-select')
      ? card.querySelector('.bg-image-fit-select').value
      : 'cover',
    allowlist: {
      deviceIds: card
        .querySelector('.allowlist-devices')
        .value.split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      networks: card
        .querySelector('.allowlist-networks')
        .value.split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    },
  };

  const body = {};
  body[screenId] = screenData;

  const saveBtn = card.querySelector('.save-screen-btn');
  if (saveBtn) saveBtn.disabled = true;
  try {
    await apiCall('PUT', '/api/config/startingScreens', body);
    showToast('Screen saved');
    hasUnsavedChanges = false;
    load();
  } catch (err) {
    showToast(err.message || 'Failed to save', 'error');
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

function addScreen() {
  const screenId =
    'screen-' +
    Date.now() +
    '-' +
    Math.random().toString(36).slice(2, 6);
  const localScreen = {
    enabled: false,
    dismissable: true,
    frequency: 'every_launch',
    template: 'info',
    title: '',
    message: '',
    imageType: null,
    backgroundImage: null,
    backgroundImageFit: 'cover',
    startDate: null,
    endDate: null,
    allowlist: { deviceIds: [], networks: [] },
    lastModifiedBy: 'you',
    lastModifiedAt: new Date().toISOString(),
  };
  const enabledNonDismissableIds = [];
  screensList
    .querySelectorAll('[data-screen-id]')
    .forEach((c) => {
      const et = c.querySelector('.enabled-toggle');
      const dt = c.querySelector('.dismissable-toggle');
      if (et && et.checked && dt && !dt.checked)
        enabledNonDismissableIds.push(
          c.getAttribute('data-screen-id'),
        );
    });
  renderScreenCard(
    screenId,
    localScreen,
    enabledNonDismissableIds,
    true,
  );
  emptyEl.style.display = 'none';
  hasUnsavedChanges = true;
  showToast(
    'New screen added. Fill in the details and click Save.',
    'info',
  );
}

async function deleteScreen(screenId) {
  if (
    !confirm(
      'Delete screen "' +
        screenId +
        '"? It will be moved to Deleted Screens.',
    )
  )
    return;

  const card = document.querySelector(
    '[data-screen-id="' + screenId + '"]',
  );
  const deleteBtn = card
    ? card.querySelector('.delete-screen-btn')
    : null;
  if (deleteBtn) deleteBtn.disabled = true;
  try {
    await apiCall(
      'DELETE',
      '/api/config/startingScreens/' + encodeURIComponent(screenId),
    );
    showToast('Screen moved to deleted');
    hasUnsavedChanges = false;
    load();
  } catch (err) {
    showToast('Failed to delete screen: ' + err.message, 'error');
  } finally {
    if (deleteBtn) deleteBtn.disabled = false;
  }
}
