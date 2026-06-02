/**
 * Economy Config tab — global economy parameters, gacha costs, milestones.
 *
 * Extracted from inline script block in index.html (PR B).
 */

import { apiCall } from '/js/core/api.js';
import { showToast, escapeHtml } from '/js/core/ui.js';

// ── State ──────────────────────────────────────────────────────────

let cachedPityHardLimit = 120;
let milestoneData = [];
let giftsCache = [];

const ECO_NUMBER_FIELDS = [
  'beanConversionRate',
  'beanRedeemBonusThreshold',
  'beanRedeemBonusMultiplier',
  'dropRateExponent',
  'pitySoftStart',
  'pityHardLimit',
  'pitySoftMaxShift',
  'pityHighValueThreshold',
  'dailyBase',
  'broadcastSendThreshold',
  'broadcastWinThreshold',
  'maxRoomDurationMinutes',
  'superShyRoomDurationMinutes',
  'normalSeatCount',
  'wheelInnerThreshold',
];
const ECO_JSON_FIELDS = [];
const PULL_COST_KEYS = ['1', '10', '100'];

// ── Dependencies ───────────────────────────────────────────────────

let _apiBase = '';
let _getToken = () => Promise.resolve(null);

// ── Public API ─────────────────────────────────────────────────────

export function init(deps) {
  _apiBase = deps.apiBase;
  _getToken = deps.getToken;

  // Slider labels
  const shiftSlider = $('#eco-pitySoftMaxShift');
  if (shiftSlider) {
    shiftSlider.addEventListener('input', (e) => {
      $('#eco-pitySoftMaxShift-val').textContent = e.target.value;
    });
  }
  const dropSlider = $('#eco-dropRateExponent');
  if (dropSlider) {
    dropSlider.addEventListener('input', (e) => {
      $('#eco-dropRateExponent-val').textContent = e.target.value;
    });
  }

  // Add milestone
  const addBtn = $('#ms-add-btn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      const maxDay =
        milestoneData.length > 0
          ? Math.max(...milestoneData.map((r) => r.day))
          : 0;
      milestoneData.push({
        day: maxDay + 7,
        type: 'coins',
        amount: 100,
        giftId: '',
        quantity: 1,
      });
      renderMilestoneRows();
    });
  }

  // Save
  const saveBtn = $('#eco-save-btn');
  if (saveBtn) saveBtn.addEventListener('click', save);
}

export function activate() {
  load();
}

export function deactivate() {
  // No cleanup
}

/** Expose pity hard limit for other tabs (e.g., users economy subtab). */
export function getPityHardLimit() {
  return cachedPityHardLimit;
}

/** Expose gifts cache for other tabs. */
export function getGiftsCache() {
  return giftsCache;
}

// ── Internal ───────────────────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);

async function load() {
  try {
    // Refresh gift catalog for milestone dropdowns
    try {
      const raw = await apiCall('GET', '/api/gifts/all');
      giftsCache = Array.isArray(raw) ? raw : raw.gifts || [];
    } catch (giftErr) {
      console.warn(
        'Failed to load gift catalog for milestones:',
        giftErr.message,
      );
    }

    const token = await _getToken();
    const resp = await fetch(`${_apiBase}/api/config/economy`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Failed to load');
    const config = data;

    for (const f of ECO_NUMBER_FIELDS) {
      const el = $(`#eco-${f}`);
      if (el) el.value = config[f] ?? '';
    }

    // Sync slider labels
    const shiftEl = $('#eco-pitySoftMaxShift');
    if (shiftEl)
      $('#eco-pitySoftMaxShift-val').textContent =
        shiftEl.value || '0.15';
    const dropEl = $('#eco-dropRateExponent');
    if (dropEl)
      $('#eco-dropRateExponent-val').textContent =
        dropEl.value || '1.5';

    // Cache pity hard limit (also update inline shim for spin monitor)
    if (config.pityHardLimit) {
      cachedPityHardLimit = config.pityHardLimit;
      if (typeof window._updatePityHardLimit === 'function') {
        window._updatePityHardLimit(cachedPityHardLimit);
      }
      const pityInput = $('#eco-pity');
      if (pityInput) {
        pityInput.max = cachedPityHardLimit;
        const label = pityInput
          .closest('.field-group')
          ?.querySelector('label');
        if (label)
          label.textContent = `Pity Counter (0-${cachedPityHardLimit})`;
      }
    }

    // Pull costs
    const pullCosts = config.pullCosts || {};
    for (const k of PULL_COST_KEYS) {
      const el = $(`#eco-pullCost-${k}`);
      if (el) el.value = pullCosts[k] ?? '';
    }

    for (const f of ECO_JSON_FIELDS) {
      const el = $(`#eco-${f}`);
      if (el) el.value = config[f] ? JSON.stringify(config[f]) : '';
    }

    // Milestone rewards
    loadMilestoneUI(config.milestoneRewards || {});
  } catch (err) {
    showToast(
      'Failed to load economy config: ' + err.message,
      'error',
    );
  }
}

// ── Milestone Rewards Editor ───────────────────────────────────────

function loadMilestoneUI(obj) {
  milestoneData = [];
  for (const [day, val] of Object.entries(obj).sort(
    (a, b) => Number(a[0]) - Number(b[0]),
  )) {
    if (typeof val === 'number') {
      milestoneData.push({
        day: Number(day),
        type: 'coins',
        amount: val,
        giftId: '',
        quantity: 1,
      });
    } else if (val && typeof val === 'object') {
      if (val.type === 'gift') {
        milestoneData.push({
          day: Number(day),
          type: 'gift',
          amount: 0,
          giftId: val.giftId || '',
          quantity: val.quantity || 1,
        });
      } else {
        milestoneData.push({
          day: Number(day),
          type: 'coins',
          amount: val.amount || 0,
          giftId: '',
          quantity: 1,
        });
      }
    }
  }
  renderMilestoneRows();
}

function buildGiftOptions() {
  return giftsCache
    .map(
      (g) =>
        `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name || g.id)} (${g.coinValue} coins)</option>`,
    )
    .join('');
}

function renderMilestoneRows() {
  const container = $('#milestone-rows');
  container.innerHTML = '';
  const giftOpts = buildGiftOptions();
  milestoneData.forEach((row, idx) => {
    const div = document.createElement('div');
    div.className = 'milestone-row';
    const isGift = row.type === 'gift';
    div.innerHTML = `
      <span style="color:var(--text2);font-size:12px;width:28px;text-align:right;flex-shrink:0">Day</span>
      <input type="number" class="ms-day" min="1" value="${row.day}" data-idx="${idx}" data-field="day">
      <select class="ms-type" data-idx="${idx}" data-field="type">
        <option value="coins" ${!isGift ? 'selected' : ''}>Coins</option>
        <option value="gift" ${isGift ? 'selected' : ''}>Gift</option>
      </select>
      ${
        isGift
          ? `
        <select class="ms-gift-select" data-idx="${idx}" data-field="giftId">
          <option value="">Select gift...</option>
          ${giftOpts}
        </select>
        <span style="color:var(--text2);font-size:12px;flex-shrink:0">&times;</span>
        <input type="number" class="ms-qty" min="1" value="${row.quantity}" data-idx="${idx}" data-field="quantity">
      `
          : `
        <input type="number" class="ms-amount" min="0" value="${row.amount}" data-idx="${idx}" data-field="amount" placeholder="Coins">
      `
      }
      ${idx > 0 ? `<button type="button" class="ms-swap-btn" data-idx="${idx}" title="Swap with row above">\u2191</button>` : '<span style="width:28px"></span>'}
      <button type="button" class="ms-remove-btn" data-idx="${idx}" title="Remove">\u2715</button>
    `;
    container.appendChild(div);

    if (isGift && row.giftId) {
      const sel = div.querySelector('.ms-gift-select');
      if (sel) sel.value = row.giftId;
    }
  });

  // Wire events
  for (const el of container.querySelectorAll('[data-field]')) {
    el.addEventListener('change', () => {
      const idx = Number(el.dataset.idx);
      const field = el.dataset.field;
      if (field === 'type') {
        milestoneData[idx].type = el.value;
        renderMilestoneRows();
      } else if (field === 'day') {
        milestoneData[idx].day = Number(el.value) || 1;
      } else if (field === 'amount') {
        milestoneData[idx].amount = Number(el.value) || 0;
      } else if (field === 'giftId') {
        milestoneData[idx].giftId = el.value;
      } else if (field === 'quantity') {
        milestoneData[idx].quantity = Math.max(
          1,
          Number(el.value) || 1,
        );
      }
    });
  }
  for (const btn of container.querySelectorAll('.ms-swap-btn')) {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      [milestoneData[idx - 1], milestoneData[idx]] = [
        milestoneData[idx],
        milestoneData[idx - 1],
      ];
      renderMilestoneRows();
    });
  }
  for (const btn of container.querySelectorAll('.ms-remove-btn')) {
    btn.addEventListener('click', () => {
      milestoneData.splice(Number(btn.dataset.idx), 1);
      renderMilestoneRows();
    });
  }
}

function collectMilestoneRewards() {
  const obj = {};
  for (const row of milestoneData) {
    const key = String(row.day);
    if (row.type === 'gift') {
      if (!row.giftId) continue;
      obj[key] = {
        type: 'gift',
        giftId: row.giftId,
        quantity: row.quantity || 1,
      };
    } else {
      obj[key] = row.amount;
    }
  }
  return obj;
}

// ── Save ───────────────────────────────────────────────────────────

async function save() {
  const btn = $('#eco-save-btn');
  const info = $('#eco-save-info');
  if (btn.disabled) return;
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const updates = {};
    for (const f of ECO_NUMBER_FIELDS) {
      const el = $(`#eco-${f}`);
      if (el && el.value !== '') {
        const v = Number(el.value);
        if (!Number.isFinite(v))
          throw new Error(`${f} must be a number`);
        updates[f] = v;
      }
    }

    const pullCosts = {};
    let hasPullCost = false;
    for (const k of PULL_COST_KEYS) {
      const el = $(`#eco-pullCost-${k}`);
      if (el && el.value !== '') {
        const v = Number(el.value);
        if (!Number.isFinite(v) || v < 0)
          throw new Error(
            `Pull cost for ${k} spins must be a positive number`,
          );
        pullCosts[k] = v;
        hasPullCost = true;
      }
    }
    if (hasPullCost) updates.pullCosts = pullCosts;

    for (const f of ECO_JSON_FIELDS) {
      const el = $(`#eco-${f}`);
      if (el && el.value.trim() !== '') {
        try {
          updates[f] = JSON.parse(el.value);
        } catch (_) {
          throw new Error(`${f} must be valid JSON`);
        }
      }
    }

    updates.milestoneRewards = collectMilestoneRewards();

    if (Object.keys(updates).length === 0)
      throw new Error('No fields to save');

    const token = await _getToken();
    const resp = await fetch(`${_apiBase}/api/config/economy`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updates),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Save failed');

    const fields = Array.isArray(data.updatedFields)
      ? data.updatedFields
      : Object.keys(updates);
    info.textContent = `Saved: ${fields.join(', ')}`;
    info.style.color = 'var(--success)';
    showToast('Economy config saved', 'success');
  } catch (err) {
    info.textContent = err.message;
    info.style.color = 'var(--danger)';
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Economy Config';
  }
}
