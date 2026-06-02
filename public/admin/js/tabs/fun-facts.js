/**
 * Fun Facts tab — CRUD for splash screen fun facts.
 *
 * Extracted from inline script block in index.html (PR B).
 */

import { apiCall } from '/js/core/api.js';
import { showToast } from '/js/core/ui.js';

// ── State ──────────────────────────────────────────────────────────

let funFactsData = [];
let editingFunFactId = null;

// ── DOM refs ───────────────────────────────────────────────────────

let dialogOverlay;
let dialogTitle;
let textInput;
let categoryInput;
let emojiInput;
let sourcelangInput;
let activeCheck;

// ── Public API ─────────────────────────────────────────────────────

export function init() {
  dialogOverlay = document.getElementById('funfact-dialog-overlay');
  dialogTitle = document.getElementById('funfact-dialog-title');
  textInput = document.getElementById('funfact-text-input');
  categoryInput = document.getElementById('funfact-category-input');
  emojiInput = document.getElementById('funfact-emoji-input');
  sourcelangInput = document.getElementById('funfact-sourcelang-input');
  activeCheck = document.getElementById('funfact-active-check');

  document
    .getElementById('funfact-add-btn')
    .addEventListener('click', () => openDialog(null));

  document
    .getElementById('funfact-dialog-cancel')
    .addEventListener('click', closeDialog);

  dialogOverlay.addEventListener('click', (e) => {
    if (e.target === dialogOverlay) closeDialog();
  });

  document
    .getElementById('funfact-dialog-save')
    .addEventListener('click', saveDialog);
}

export function activate() {
  loadFunFacts();
}

export function deactivate() {
  // No cleanup needed
}

// ── Internal ───────────────────────────────────────────────────────

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

async function loadFunFacts() {
  showListLoader(
    document.getElementById('funfacts-list'),
    'Loading fun facts...',
  );
  try {
    const raw = await apiCall('GET', '/api/admin/fun-facts');
    funFactsData = raw.map((f) => ({
      ...f,
      source_language: f.sourceLanguage ?? f.source_language,
      is_active: f.isActive ?? f.is_active ?? true,
    }));
    renderList();
  } catch (err) {
    showToast('Failed to load fun facts: ' + err.message, 'error');
  }
}

function renderList() {
  const list = document.getElementById('funfacts-list');
  list.textContent = '';

  if (funFactsData.length === 0) {
    const p = document.createElement('p');
    p.style.cssText =
      'color:var(--text2);text-align:center;padding:32px;';
    p.textContent =
      'No fun facts yet. Click "+ Add Fun Fact" to create one.';
    list.appendChild(p);
    return;
  }

  const categoryLabels = {
    language: 'Language',
    greeting: 'Greeting',
    culture: 'Culture',
    trivia: 'Trivia',
  };
  const categoryColors = {
    language: '#6366f1',
    greeting: '#2ecc71',
    culture: '#f39c12',
    trivia: '#e74c3c',
  };

  funFactsData.forEach((f) => {
    const card = document.createElement('div');
    card.style.cssText =
      'display:flex;gap:14px;align-items:flex-start;padding:14px 16px;background:var(--card);border:1px solid var(--border);border-radius:8px;';

    const emoji = document.createElement('div');
    emoji.style.cssText =
      'font-size:28px;flex-shrink:0;width:40px;text-align:center;';
    emoji.textContent = f.emoji || '\uD83D\uDCA1';
    card.appendChild(emoji);

    const info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0;';

    const topRow = document.createElement('div');
    topRow.style.cssText =
      'display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap;';

    const badge = document.createElement('span');
    const cat = f.category || 'trivia';
    badge.style.cssText = `padding:2px 8px;border-radius:4px;font-size:11px;color:#fff;background:${categoryColors[cat] || '#888'};`;
    badge.textContent = categoryLabels[cat] || cat;
    topRow.appendChild(badge);

    if (f.source_language) {
      const lang = document.createElement('span');
      lang.style.cssText = 'font-size:12px;color:var(--text2);';
      lang.textContent = f.source_language;
      topRow.appendChild(lang);
    }

    const activeBadge = document.createElement('span');
    activeBadge.style.cssText = `padding:2px 8px;border-radius:4px;font-size:11px;color:#fff;background:${f.is_active ? 'var(--success)' : 'var(--danger)'};`;
    activeBadge.textContent = f.is_active ? 'Active' : 'Inactive';
    topRow.appendChild(activeBadge);

    info.appendChild(topRow);

    const textEl = document.createElement('div');
    textEl.style.cssText = 'font-size:14px;line-height:1.5;';
    textEl.textContent = f.text;
    info.appendChild(textEl);

    card.appendChild(info);

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:6px;flex-shrink:0;';

    const editBtn = document.createElement('button');
    editBtn.textContent = 'Edit';
    editBtn.style.cssText =
      'padding:6px 14px;background:var(--accent);color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:13px;';
    editBtn.addEventListener('click', () => openDialog(f));
    actions.appendChild(editBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete';
    deleteBtn.style.cssText =
      'padding:6px 14px;background:var(--danger);color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:13px;';
    deleteBtn.addEventListener('click', async () => {
      if (deleteBtn.disabled) return;
      if (!confirm('Delete this fun fact? This cannot be undone.')) return;
      deleteBtn.disabled = true;
      try {
        await apiCall('DELETE', `/api/admin/fun-facts/${f.id}`);
        showToast('Fun fact deleted');
        await loadFunFacts();
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
}

function openDialog(fact) {
  editingFunFactId = fact ? fact.id : null;
  dialogTitle.textContent = fact ? 'Edit Fun Fact' : 'Add Fun Fact';
  textInput.value = fact ? fact.text : '';
  categoryInput.value = fact ? fact.category || 'trivia' : 'language';
  emojiInput.value = fact ? fact.emoji || '' : '';
  sourcelangInput.value = fact ? fact.source_language || '' : '';
  activeCheck.checked = fact ? !!fact.is_active : true;
  dialogOverlay.style.display = 'flex';
}

function closeDialog() {
  dialogOverlay.style.display = 'none';
  editingFunFactId = null;
}

async function saveDialog() {
  const saveBtnEl = document.getElementById('funfact-dialog-save');
  if (saveBtnEl.disabled) return;
  const text = textInput.value.trim();
  if (!text) {
    showToast('Fact text is required', 'error');
    return;
  }

  saveBtnEl.disabled = true;
  saveBtnEl.textContent = 'Saving...';

  try {
    const payload = {
      text,
      category: categoryInput.value,
      emoji: emojiInput.value.trim(),
      source_language: sourcelangInput.value.trim(),
      is_active: activeCheck.checked,
    };

    if (editingFunFactId) {
      await apiCall(
        'PUT',
        `/api/admin/fun-facts/${editingFunFactId}`,
        payload,
      );
      showToast('Fun fact updated');
    } else {
      await apiCall('POST', '/api/admin/fun-facts', payload);
      showToast('Fun fact created');
    }

    closeDialog();
    await loadFunFacts();
  } catch (err) {
    showToast('Save failed: ' + err.message, 'error');
  } finally {
    saveBtnEl.disabled = false;
    saveBtnEl.textContent = 'Save';
  }
}
