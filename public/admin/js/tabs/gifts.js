/**
 * Gifts tab — batch-edit gift catalog (CRUD with pending changes).
 *
 * Extracted from inline script block in index.html (PR B).
 * Manages local pending state (edits, adds, deletes) until user confirms.
 */

import { apiCall } from '/js/core/api.js';
import { showToast, escapeHtml } from '/js/core/ui.js';

// ── State ──────────────────────────────────────────────────────────

let giftsCache = [];
let pendingEdits = {};
let pendingDeletes = new Set();
let pendingAdds = [];

// ── Public API ─────────────────────────────────────────────────────

export function init() {
  const $ = (sel) => document.querySelector(sel);

  $('#gift-add-btn').addEventListener('click', addGift);
  $('#gift-discard-btn').addEventListener('click', discard);
  $('#gift-apply-btn').addEventListener('click', showConfirmation);
  $('#gift-confirm-cancel').addEventListener('click', () => {
    $('#gift-confirm-overlay').classList.remove('visible');
  });
  $('#gift-confirm-submit').addEventListener('click', applyChanges);
}

export function activate() {
  load();
}

export function deactivate() {}

/** Expose cache for economy-config milestone dropdowns. */
export function getCache() {
  return giftsCache;
}

// ── Internal ───────────────────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);

async function load() {
  try {
    const raw = await apiCall('GET', '/api/gifts/all');
    giftsCache = Array.isArray(raw) ? raw : raw.gifts || [];
    clearPending();
    renderTable();
  } catch (err) {
    showToast('Failed to load gifts: ' + err.message, 'error');
  }
}

function clearPending() {
  pendingEdits = {};
  pendingDeletes = new Set();
  pendingAdds = [];
}

function getEffective() {
  const result = [];
  for (const g of giftsCache) {
    if (pendingDeletes.has(g.id)) continue;
    const edits = pendingEdits[g.id];
    result.push(edits ? { ...g, ...edits } : { ...g });
  }
  for (const a of pendingAdds) result.push({ ...a });
  return result;
}

function getWheelCount() {
  return getEffective().filter(
    (g) => g.coinValue > 0 && g.showOnWheel !== false,
  ).length;
}

function getChangeCount() {
  return (
    Object.keys(pendingEdits).length +
    pendingDeletes.size +
    pendingAdds.length
  );
}

function updatePendingUI() {
  const count = getChangeCount();
  const applyBtn = $('#gift-apply-btn');
  const discardBtn = $('#gift-discard-btn');
  applyBtn.style.display = count > 0 ? 'inline-block' : 'none';
  discardBtn.style.display = count > 0 ? 'inline-block' : 'none';
  applyBtn.querySelector('.badge').textContent = count;

  const wheelCount = getWheelCount();
  const effective = getEffective();
  const wheelEl = $('#wheel-count');
  wheelEl.textContent = `(${wheelCount}/16 on wheel)`;
  wheelEl.style.color =
    wheelCount === 16
      ? 'var(--success, #4caf50)'
      : 'var(--danger, #f44336)';
  wheelEl.style.fontWeight = wheelCount === 16 ? 'normal' : 'bold';
  wheelEl.title = `Gacha wheel has 16 slots. Currently ${wheelCount} qualifying.`;
  $('#gifts-count').textContent = `${effective.length} gifts`;
}

function renderTable() {
  const tbody = $('#gifts-tbody');
  tbody.innerHTML = '';
  updatePendingUI();

  for (const gift of giftsCache) {
    const isDeleted = pendingDeletes.has(gift.id);
    const edits = pendingEdits[gift.id];
    const isModified = !!edits;
    const effective = isModified ? { ...gift, ...edits } : gift;

    const tr = document.createElement('tr');
    tr.dataset.giftId = gift.id;
    if (isDeleted) tr.classList.add('gift-deleted');
    else if (isModified) tr.classList.add('gift-modified');

    tr.innerHTML = `
      <td><input type="number" class="gift-order-input" data-field="order" value="${effective.order || 0}"></td>
      <td style="text-align:center"><input type="checkbox" data-field="showInStore" ${effective.showInStore !== false ? 'checked' : ''}></td>
      <td style="text-align:center"><input type="checkbox" data-field="showOnWheel" ${effective.showOnWheel !== false ? 'checked' : ''}></td>
      <td>${effective.iconUrl ? `<img src="${escapeHtml(effective.iconUrl)}" class="gift-icon-preview" alt="Gift icon" onerror="this.style.display='none'">` : '<span style="color:var(--text2)">\u2014</span>'}</td>
      <td><input type="text" class="gift-name-input" data-field="name" value="${escapeHtml(effective.name || '')}"></td>
      <td><input type="number" class="gift-value-input" data-field="coinValue" value="${effective.coinValue || 0}"></td>
      <td><input type="text" class="gift-url-input" data-field="animationUrl" value="${escapeHtml(effective.animationUrl || '')}" placeholder="URL"></td>
      <td><input type="text" class="gift-url-input" data-field="soundUrl" value="${escapeHtml(effective.soundUrl || '')}" placeholder="URL"></td>
      <td><input type="text" class="gift-url-input" data-field="iconUrl" value="${escapeHtml(effective.iconUrl || '')}" placeholder="URL"></td>
      <td class="gift-actions">
        ${isDeleted ? `<button class="gift-undo-del-btn" data-gift-id="${gift.id}">Undo</button>` : `<button class="gift-delete-btn" data-gift-id="${gift.id}">Del</button>`}
      </td>`;

    if (!isDeleted) {
      for (const inp of tr.querySelectorAll('[data-field]')) {
        const handler = () => {
          const field = inp.dataset.field;
          let newVal;
          if (inp.type === 'checkbox') newVal = inp.checked;
          else if (inp.type === 'number')
            newVal = Number(inp.value) || 0;
          else newVal = inp.value;
          let origVal = gift[field];
          if (origVal === undefined || origVal === null) {
            origVal =
              inp.type === 'checkbox'
                ? true
                : inp.type === 'number'
                  ? 0
                  : '';
          }
          if (!pendingEdits[gift.id]) pendingEdits[gift.id] = {};
          if (newVal === origVal) {
            delete pendingEdits[gift.id][field];
            if (Object.keys(pendingEdits[gift.id]).length === 0)
              delete pendingEdits[gift.id];
          } else {
            pendingEdits[gift.id][field] = newVal;
          }
          tr.classList.toggle('gift-modified', !!pendingEdits[gift.id]);
          updatePendingUI();
        };
        inp.addEventListener('change', handler);
        inp.addEventListener('input', handler);
      }
    }
    tbody.appendChild(tr);
  }

  // Pending new gifts
  for (const add of pendingAdds) {
    const tr = document.createElement('tr');
    tr.dataset.tempId = add.tempId;
    tr.classList.add('gift-new');
    tr.innerHTML = `
      <td><input type="number" class="gift-order-input" data-field="order" value="${add.order || 0}"></td>
      <td style="text-align:center"><input type="checkbox" data-field="showInStore" ${add.showInStore !== false ? 'checked' : ''}></td>
      <td style="text-align:center"><input type="checkbox" data-field="showOnWheel" ${add.showOnWheel !== false ? 'checked' : ''}></td>
      <td><span style="color:var(--text2)">\u2014</span></td>
      <td><input type="text" class="gift-name-input" data-field="name" value="${escapeHtml(add.name || '')}" placeholder="Gift name"></td>
      <td><input type="number" class="gift-value-input" data-field="coinValue" value="${add.coinValue || 0}"></td>
      <td><input type="text" class="gift-url-input" data-field="animationUrl" value="${escapeHtml(add.animationUrl || '')}" placeholder="URL"></td>
      <td><input type="text" class="gift-url-input" data-field="soundUrl" value="${escapeHtml(add.soundUrl || '')}" placeholder="URL"></td>
      <td><input type="text" class="gift-url-input" data-field="iconUrl" value="${escapeHtml(add.iconUrl || '')}" placeholder="URL"></td>
      <td class="gift-actions"><button class="gift-remove-btn" data-temp-id="${add.tempId}">Remove</button></td>`;

    for (const inp of tr.querySelectorAll('[data-field]')) {
      const handler = () => {
        const field = inp.dataset.field;
        if (inp.type === 'checkbox') add[field] = inp.checked;
        else if (inp.type === 'number')
          add[field] = Number(inp.value) || 0;
        else add[field] = inp.value;
        updatePendingUI();
      };
      inp.addEventListener('change', handler);
      inp.addEventListener('input', handler);
    }
    tbody.appendChild(tr);
  }

  // Wire delete/undo/remove buttons
  for (const btn of tbody.querySelectorAll('.gift-delete-btn')) {
    btn.addEventListener('click', () => {
      pendingDeletes.add(btn.dataset.giftId);
      renderTable();
    });
  }
  for (const btn of tbody.querySelectorAll('.gift-undo-del-btn')) {
    btn.addEventListener('click', () => {
      pendingDeletes.delete(btn.dataset.giftId);
      renderTable();
    });
  }
  for (const btn of tbody.querySelectorAll('.gift-remove-btn')) {
    btn.addEventListener('click', () => {
      pendingAdds = pendingAdds.filter(
        (a) => a.tempId !== btn.dataset.tempId,
      );
      renderTable();
    });
  }
}

function addGift() {
  const maxOrder = Math.max(
    0,
    ...giftsCache.map((g) => g.order || 0),
    ...pendingAdds.map((a) => a.order || 0),
  );
  pendingAdds.push({
    tempId: `new_${Date.now()}`,
    name: '',
    coinValue: 0,
    order: maxOrder + 1,
    showInStore: true,
    showOnWheel: true,
    animationUrl: '',
    soundUrl: '',
    iconUrl: '',
  });
  renderTable();
}

function discard() {
  clearPending();
  renderTable();
  showToast('All pending changes discarded', 'info');
}

function showConfirmation() {
  const wheelCount = getWheelCount();
  const wheelOk = wheelCount === 16;

  const statusEl = $('#gift-confirm-wheel-status');
  if (wheelOk) {
    statusEl.className = 'gift-confirm-ok';
    statusEl.textContent = `Wheel: ${wheelCount}/16 \u2014 ready`;
  } else {
    statusEl.className = 'gift-confirm-warning';
    statusEl.textContent = `\u26A0 Wheel: ${wheelCount}/16 \u2014 need exactly 16 items on the wheel`;
  }

  let html = '';
  if (pendingAdds.length > 0) {
    html += `<div class="gift-confirm-section"><h4>New Gifts (${pendingAdds.length})</h4><ul>`;
    for (const a of pendingAdds) {
      html += `<li>+ ${escapeHtml(a.name || '(unnamed)')} <span class="change-detail">(${a.coinValue} coins)</span></li>`;
    }
    html += '</ul></div>';
  }

  const editIds = Object.keys(pendingEdits);
  if (editIds.length > 0) {
    html += `<div class="gift-confirm-section"><h4>Modified Gifts (${editIds.length})</h4><ul>`;
    for (const id of editIds) {
      const orig = giftsCache.find((g) => g.id === id);
      const changes = pendingEdits[id];
      const fieldDescs = Object.entries(changes)
        .map(([field, newVal]) => {
          let origVal = orig[field];
          if (origVal === undefined || origVal === null) {
            origVal =
              typeof newVal === 'boolean'
                ? true
                : typeof newVal === 'number'
                  ? 0
                  : '';
          }
          return `${field}: ${origVal}\u2192${newVal}`;
        })
        .join(', ');
      html += `<li>\u270E ${escapeHtml(orig?.name || id)} <span class="change-detail">${escapeHtml(fieldDescs)}</span></li>`;
    }
    html += '</ul></div>';
  }

  if (pendingDeletes.size > 0) {
    html += `<div class="gift-confirm-section"><h4>Deleted Gifts (${pendingDeletes.size})</h4><ul>`;
    for (const id of pendingDeletes) {
      const orig = giftsCache.find((g) => g.id === id);
      html += `<li>\u2715 ${escapeHtml(orig?.name || id)}</li>`;
    }
    html += '</ul></div>';
  }

  $('#gift-confirm-title').textContent = `Review Changes (${getChangeCount()} total)`;
  $('#gift-confirm-body').innerHTML = html;
  $('#gift-confirm-submit').disabled = !wheelOk;
  $('#gift-confirm-overlay').classList.add('visible');
}

async function applyChanges() {
  const submitBtn = $('#gift-confirm-submit');
  const cancelBtn = $('#gift-confirm-cancel');
  if (submitBtn.disabled) return;
  submitBtn.disabled = true;
  cancelBtn.disabled = true;
  submitBtn.textContent = 'Applying...';

  try {
    for (const add of pendingAdds) {
      const { tempId, ...payload } = add;
      await apiCall('POST', '/api/gifts', payload);
    }
    for (const [giftId, changes] of Object.entries(pendingEdits)) {
      await apiCall('PUT', `/api/gifts/${giftId}`, changes);
    }
    for (const giftId of pendingDeletes) {
      await apiCall('DELETE', `/api/gifts/${giftId}`);
    }

    showToast(
      `${getChangeCount()} changes applied successfully`,
      'success',
    );
    $('#gift-confirm-overlay').classList.remove('visible');
    load();
  } catch (err) {
    showToast(
      'Apply failed: ' +
        err.message +
        ' \u2014 pending changes kept for retry',
      'error',
    );
  } finally {
    submitBtn.disabled = false;
    cancelBtn.disabled = false;
    submitBtn.textContent = 'Confirm';
  }
}
