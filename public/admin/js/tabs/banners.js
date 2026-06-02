/**
 * Banners tab — CRUD for in-app promotional banners, drag reorder, scheduling.
 *
 * Extracted from inline script block in index.html (PR B).
 */

import { apiCall } from '/js/core/api.js';
import { showToast, sanitizeImageUrl } from '/js/core/ui.js';

// ── State ──────────────────────────────────────────────────────────

let bannersData = [];
let editingBannerId = null;

// ── DOM refs ───────────────────────────────────────────────────────

let dialogOverlay,
  dialogTitle,
  fileInput,
  preview,
  titleInput,
  actionType,
  actionValueGroup,
  actionValueInput,
  actionValueLabel,
  screenSelect,
  startDate,
  endDate,
  activeCheck;

// ── Helpers ────────────────────────────────────────────────────────

function isoToLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function showListLoader(listEl, label) {
  listEl.textContent = '';
  const wrapper = document.createElement('div');
  wrapper.style.cssText =
    'text-align:center;padding:32px;color:var(--text2);';
  const spinner = document.createElement('div');
  spinner.style.cssText =
    'display:inline-block;width:24px;height:24px;border:3px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin 0.8s linear infinite;';
  wrapper.appendChild(spinner);
  const text = document.createElement('div');
  text.style.marginTop = '8px';
  text.textContent = label;
  wrapper.appendChild(text);
  listEl.appendChild(wrapper);
}

// ── Public API ─────────────────────────────────────────────────────

export function init() {
  dialogOverlay = document.getElementById('banner-dialog-overlay');
  dialogTitle = document.getElementById('banner-dialog-title');
  fileInput = document.getElementById('banner-file-input');
  preview = document.getElementById('banner-preview');
  titleInput = document.getElementById('banner-title-input');
  actionType = document.getElementById('banner-action-type');
  actionValueGroup = document.getElementById('banner-action-value-group');
  actionValueInput = document.getElementById('banner-action-value-input');
  actionValueLabel = document.getElementById('banner-action-value-label');
  screenSelect = document.getElementById('banner-screen-select');
  startDate = document.getElementById('banner-start-date');
  endDate = document.getElementById('banner-end-date');
  activeCheck = document.getElementById('banner-active-check');

  actionType.addEventListener('change', onActionTypeChange);
  fileInput.addEventListener('change', onFileChange);

  document
    .getElementById('banner-add-btn')
    .addEventListener('click', () => openDialog(null));
  document
    .getElementById('banner-dialog-cancel')
    .addEventListener('click', closeDialog);
  dialogOverlay.addEventListener('click', (e) => {
    if (e.target === dialogOverlay) closeDialog();
  });
  document
    .getElementById('banner-dialog-save')
    .addEventListener('click', saveDialog);
}

export function activate() {
  loadBanners();
}

export function deactivate() {
  // No cleanup needed
}

// ── Internal ───────────────────────────────────────────────────────

function onActionTypeChange() {
  const type = actionType.value;
  if (type === 'NONE') {
    actionValueGroup.style.display = 'none';
  } else {
    actionValueGroup.style.display = '';
    if (type === 'URL') {
      actionValueLabel.textContent = 'URL';
      actionValueInput.placeholder = 'https://...';
      actionValueInput.style.display = '';
      screenSelect.style.display = 'none';
    } else if (type === 'ROOM') {
      actionValueLabel.textContent = 'Room ID';
      actionValueInput.placeholder = 'Room ID';
      actionValueInput.style.display = '';
      screenSelect.style.display = 'none';
    } else if (type === 'SCREEN') {
      actionValueLabel.textContent = 'Screen';
      actionValueInput.style.display = 'none';
      screenSelect.style.display = '';
    }
  }
}

function onFileChange() {
  const file = fileInput.files[0];
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = () => {
    const safe = sanitizeImageUrl(reader.result);
    if (!safe) return;
    preview.src = safe;
    preview.style.display = 'block';
  };
  reader.readAsDataURL(file);
}

async function loadBanners() {
  showListLoader(
    document.getElementById('banners-list'),
    'Loading banners...',
  );
  try {
    const raw = await apiCall('GET', '/api/admin/banners');
    bannersData = raw.map((b) => ({
      ...b,
      image_url: b.imageUrl ?? b.image_url,
      action_type: b.actionType ?? b.action_type ?? 'NONE',
      action_value: b.actionValue ?? b.action_value,
      sort_order: b.sortOrder ?? b.sort_order ?? 0,
      is_active: b.isActive ?? b.is_active ?? true,
      start_date: b.startDate ?? b.start_date,
      end_date: b.endDate ?? b.end_date,
    }));
    renderList();
  } catch (err) {
    document.getElementById('banners-list').textContent = '';
    showToast('Failed to load banners: ' + err.message, 'error');
  }
}

function renderList() {
  const list = document.getElementById('banners-list');
  if (bannersData.length === 0) {
    list.textContent = '';
    const p = document.createElement('p');
    p.style.cssText =
      'color:var(--text2);text-align:center;padding:32px;';
    p.textContent =
      'No banners yet. Click "+ Add Banner" to create one.';
    list.appendChild(p);
    return;
  }

  list.textContent = '';
  bannersData.forEach((b, idx) => {
    const nowMs = Date.now();
    const isScheduled = b.start_date && b.start_date > nowMs;
    const isExpired = b.end_date && b.end_date <= nowMs;

    const card = document.createElement('div');
    card.className = 'banner-card';
    card.draggable = true;
    card.dataset.bannerId = b.id;
    card.dataset.idx = idx;
    card.style.cssText =
      'display:flex;gap:14px;align-items:center;padding:12px 16px;background:var(--card);border:1px solid var(--border);border-radius:8px;cursor:grab;';

    const handle = document.createElement('div');
    handle.style.cssText =
      'display:flex;align-items:center;color:var(--text2);font-size:18px;cursor:grab;';
    handle.title = 'Drag to reorder';
    handle.textContent = '\u2630';
    card.appendChild(handle);

    const img = document.createElement('img');
    img.src = sanitizeImageUrl(b.image_url);
    img.alt = '';
    img.style.cssText =
      'width:120px;height:68px;object-fit:cover;border-radius:6px;flex-shrink:0;';
    card.appendChild(img);

    const info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0;';

    const titleRow = document.createElement('div');
    titleRow.style.cssText =
      'display:flex;align-items:center;gap:8px;margin-bottom:4px;';
    const titleEl = document.createElement('strong');
    titleEl.style.fontSize = '14px';
    titleEl.textContent = b.title || '(No title)';
    titleRow.appendChild(titleEl);

    const badge = document.createElement('span');
    badge.style.cssText =
      'padding:2px 8px;border-radius:4px;font-size:11px;color:#fff;';
    if (!b.is_active) {
      badge.style.background = 'var(--danger)';
      badge.textContent = 'Inactive';
    } else if (isExpired) {
      badge.style.background = 'var(--warning)';
      badge.style.color = '#000';
      badge.textContent = 'Expired';
    } else if (isScheduled) {
      badge.style.background = '#6366f1';
      badge.textContent = 'Scheduled';
    } else {
      badge.style.background = 'var(--success)';
      badge.textContent = 'Live';
    }
    titleRow.appendChild(badge);
    info.appendChild(titleRow);

    const actionLabels = {
      NONE: 'No action',
      URL: 'Open URL',
      ROOM: 'Go to Room',
      SCREEN: 'Go to Screen',
    };
    const actionLine = document.createElement('div');
    actionLine.style.cssText = 'font-size:12px;color:var(--text2);';
    actionLine.textContent =
      (actionLabels[b.action_type] || b.action_type) +
      (b.action_value ? ': ' + b.action_value : '');
    info.appendChild(actionLine);

    const scheduleParts = [];
    if (b.start_date)
      scheduleParts.push(
        'From: ' + new Date(b.start_date).toLocaleString(),
      );
    if (b.end_date)
      scheduleParts.push(
        'Until: ' + new Date(b.end_date).toLocaleString(),
      );
    if (scheduleParts.length) {
      const schedLine = document.createElement('div');
      schedLine.style.cssText =
        'font-size:11px;color:var(--text2);margin-top:2px;';
      schedLine.textContent = scheduleParts.join(' \u2014 ');
      info.appendChild(schedLine);
    }
    card.appendChild(info);

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:6px;flex-shrink:0;';

    const editBtn = document.createElement('button');
    editBtn.textContent = 'Edit';
    editBtn.style.cssText =
      'padding:6px 14px;background:var(--accent);color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:13px;';
    editBtn.addEventListener('click', () => {
      const banner = bannersData.find((x) => x.id === b.id);
      if (banner) openDialog(banner);
    });
    actions.appendChild(editBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete';
    deleteBtn.style.cssText =
      'padding:6px 14px;background:var(--danger);color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:13px;';
    deleteBtn.addEventListener('click', async () => {
      if (deleteBtn.disabled) return;
      if (!confirm('Delete this banner? This cannot be undone.')) return;
      deleteBtn.disabled = true;
      try {
        await apiCall('DELETE', `/api/admin/banners/${b.id}`);
        showToast('Banner deleted');
        await loadBanners();
      } catch (err) {
        showToast('Delete failed: ' + err.message, 'error');
      } finally {
        deleteBtn.disabled = false;
      }
    });
    actions.appendChild(deleteBtn);
    card.appendChild(actions);

    list.appendChild(card);
  });

  setupDragAndDrop();
}

function setupDragAndDrop() {
  const cards = document.querySelectorAll('.banner-card');
  let dragSrcIdx = null;

  cards.forEach((card) => {
    card.addEventListener('dragstart', (e) => {
      dragSrcIdx = parseInt(card.dataset.idx);
      card.style.opacity = '0.4';
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => {
      card.style.opacity = '1';
      document
        .querySelectorAll('.banner-card')
        .forEach((c) => (c.style.borderTop = ''));
    });
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      card.style.borderTop = '2px solid var(--accent)';
    });
    card.addEventListener('dragleave', () => {
      card.style.borderTop = '';
    });
    card.addEventListener('drop', async (e) => {
      e.preventDefault();
      card.style.borderTop = '';
      const dropIdx = parseInt(card.dataset.idx);
      if (dragSrcIdx === null || dragSrcIdx === dropIdx) return;

      const [moved] = bannersData.splice(dragSrcIdx, 1);
      bannersData.splice(dropIdx, 0, moved);

      const reorderPayload = bannersData.map((b, i) => ({
        id: b.id,
        sort_order: i,
      }));
      bannersData.forEach((b, i) => (b.sort_order = i));
      renderList();

      try {
        await apiCall('PUT', '/api/admin/banners/reorder', reorderPayload);
        showToast('Banner order updated');
      } catch (err) {
        showToast('Reorder failed: ' + err.message, 'error');
        await loadBanners();
      }
    });
  });
}

function openDialog(banner) {
  editingBannerId = banner ? banner.id : null;
  dialogTitle.textContent = banner ? 'Edit Banner' : 'Add Banner';
  titleInput.value = banner?.title || '';
  actionType.value = banner?.action_type || 'NONE';
  actionType.dispatchEvent(new Event('change'));
  if (banner?.action_type === 'SCREEN') {
    screenSelect.value = banner.action_value || 'wallet';
  } else {
    actionValueInput.value = banner?.action_value || '';
  }
  startDate.value = banner?.start_date
    ? isoToLocal(banner.start_date)
    : '';
  endDate.value = banner?.end_date ? isoToLocal(banner.end_date) : '';
  activeCheck.checked = banner ? !!banner.is_active : true;
  fileInput.value = '';
  if (banner?.image_url) {
    const safe = sanitizeImageUrl(banner.image_url);
    preview.src = safe;
    preview.style.display = safe ? 'block' : 'none';
  } else {
    preview.style.display = 'none';
  }
  dialogOverlay.style.display = 'flex';
}

function closeDialog() {
  dialogOverlay.style.display = 'none';
  editingBannerId = null;
}

async function saveDialog() {
  const saveBtnEl = document.getElementById('banner-dialog-save');
  if (saveBtnEl.disabled) return;
  saveBtnEl.disabled = true;
  saveBtnEl.textContent = 'Saving...';

  try {
    let imageUrl = editingBannerId
      ? bannersData.find((b) => b.id === editingBannerId)?.image_url
      : null;

    if (fileInput.files.length > 0) {
      const formData = new FormData();
      formData.append('file', fileInput.files[0]);
      const uploadResult = await apiCall(
        'POST',
        '/api/admin/banners/upload',
        formData,
      );
      imageUrl = uploadResult.imageUrl || uploadResult.image_url;
    }

    if (!imageUrl) {
      showToast('Please select an image', 'error');
      return;
    }

    const at = actionType.value;
    const av =
      at === 'SCREEN'
        ? screenSelect.value
        : at === 'NONE'
          ? null
          : actionValueInput.value || null;

    const payload = {
      title: titleInput.value || null,
      image_url: imageUrl,
      action_type: at,
      action_value: av,
      start_date: startDate.value
        ? new Date(startDate.value).getTime()
        : null,
      end_date: endDate.value
        ? new Date(endDate.value).getTime()
        : null,
      is_active: activeCheck.checked,
    };

    if (editingBannerId) {
      await apiCall(
        'PUT',
        `/api/admin/banners/${editingBannerId}`,
        payload,
      );
      showToast('Banner updated');
    } else {
      await apiCall('POST', '/api/admin/banners', payload);
      showToast('Banner created');
    }

    closeDialog();
    await loadBanners();
  } catch (err) {
    showToast('Save failed: ' + err.message, 'error');
  } finally {
    saveBtnEl.disabled = false;
    saveBtnEl.textContent = 'Save';
  }
}
