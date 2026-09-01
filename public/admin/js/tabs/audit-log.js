/**
 * Audit Log tab — admin action history with filters, pagination, CSV export.
 *
 * Extracted from inline script block in index.html (PR B).
 */

import { apiCall } from '/js/core/api.js';
import { escapeHtml } from '/js/core/ui.js';

// ── State ──────────────────────────────────────────────────────────

let state = { page: 1, lastEntries: [] };
let pollTimer = null;

// ── Public API ─────────────────────────────────────────────────────

export function init() {
  const searchBtn = document.getElementById('audit-log-search-btn');
  if (searchBtn) searchBtn.addEventListener('click', () => load());

  const exportBtn = document.getElementById('audit-log-export-csv');
  if (exportBtn) exportBtn.addEventListener('click', exportCsv);

  const loadMoreBtn = document.getElementById('audit-log-load-more');
  if (loadMoreBtn) loadMoreBtn.addEventListener('click', () => load(true));
}

export function activate() {
  load();
  startPolling();
}

export function deactivate() {
  stopPolling();
}

// ── Internal ───────────────────────────────────────────────────────

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => load(), 4000);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function load(append) {
  const tbody = document.getElementById('audit-log-tbody');
  const empty = document.getElementById('audit-log-empty');
  const loadMore = document.getElementById('audit-log-load-more');
  if (!tbody) return;

  if (!append) {
    state.page = 1;
    tbody.innerHTML =
      '<tr><td colspan="6" style="padding:12px;color:var(--text2);font-size:12px;">Loading\u2026</td></tr>';
  }
  empty.style.display = 'none';

  const params = new URLSearchParams();
  const admin = document.getElementById('audit-log-filter-admin').value.trim();
  const action = document.getElementById('audit-log-filter-action').value;
  const target = document.getElementById('audit-log-filter-target').value.trim();
  const start = document.getElementById('audit-log-filter-start').value;
  const end = document.getElementById('audit-log-filter-end').value;
  if (admin) params.set('admin', admin);
  if (action) params.set('action', action);
  if (target) params.set('target', target);
  if (start) params.set('start', new Date(start).toISOString());
  if (end) params.set('end', new Date(end).toISOString());
  params.set('page', String(state.page));

  try {
    const data = await apiCall('GET', `/api/admin/audit-log?${params.toString()}`);
    const entries = data.entries || [];
    state.lastEntries = append ? state.lastEntries.concat(entries) : entries;

    if (entries.length === 0 && !append) {
      tbody.textContent = '';
      empty.style.display = 'block';
      loadMore.style.display = 'none';
      return;
    }
    if (!append) tbody.textContent = '';
    entries.forEach((entry) => tbody.appendChild(buildRow(entry)));
    loadMore.style.display = entries.length > 0 ? 'block' : 'none';
  } catch (err) {
    tbody.innerHTML =
      '<tr><td colspan="6" style="padding:12px;color:var(--danger);font-size:12px;">Failed to load: ' +
      escapeHtml(err.message) +
      '</td></tr>';
  }
}

function buildRow(entry) {
  const tr = document.createElement('tr');
  tr.style.borderTop = '1px solid var(--border)';
  const mk = (cls, text, title) => {
    const td = document.createElement('td');
    td.className = cls;
    td.style.padding = '10px 12px';
    td.textContent = text || '';
    if (title) td.title = title;
    return td;
  };
  tr.appendChild(
    mk('audit-admin-name', entry.adminName || entry.adminUid || entry.adminId || 'Unknown'),
  );
  tr.appendChild(mk('audit-action', entry.actionType || entry.action || ''));
  tr.appendChild(mk('audit-target-type', entry.targetType || ''));
  const tdTarget = mk('audit-target', entry.target || entry.targetId || '');
  tdTarget.style.fontFamily = 'monospace';
  tdTarget.style.fontSize = '11px';
  tr.appendChild(tdTarget);
  const ts = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : '';
  const tdTs = mk('audit-timestamp', ts);
  tdTs.setAttribute('data-timestamp', entry.timestamp ? String(entry.timestamp) : '');
  tr.appendChild(tdTs);
  const detailsText =
    typeof entry.details === 'object' ? JSON.stringify(entry.details) : entry.details || '';
  const tdDetails = mk('audit-details', detailsText);
  tdDetails.style.maxWidth = '240px';
  tdDetails.style.overflow = 'hidden';
  tdDetails.style.textOverflow = 'ellipsis';
  tdDetails.style.whiteSpace = 'nowrap';
  tr.appendChild(tdDetails);
  return tr;
}

function exportCsv() {
  const entries = state.lastEntries || [];
  const header = 'admin,action,target,timestamp,details';
  const rows = entries.map((e) => {
    const fields = [
      e.adminName || e.adminUid || '',
      e.actionType || e.action || '',
      e.target || e.targetId || '',
      e.timestamp ? new Date(e.timestamp).toISOString() : '',
      typeof e.details === 'object' ? JSON.stringify(e.details) : e.details || '',
    ].map((f) => '"' + String(f).replace(/"/g, '""') + '"');
    return fields.join(',');
  });
  const csv = [header].concat(rows).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'audit-log-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
