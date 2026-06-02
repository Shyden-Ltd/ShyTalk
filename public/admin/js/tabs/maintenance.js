/**
 * Maintenance tab — destructive cleanup actions, storage audit/purge.
 *
 * Extracted from inline script block in index.html (PR B).
 * Uses raw fetch (not apiCall) because some endpoints return non-JSON.
 */

import { showToast } from '/js/core/ui.js';

// ── Dependencies ───────────────────────────────────────────────────

let _apiBase = '';
let _getToken = () => Promise.resolve(null);

// ── Public API ─────────────────────────────────────────────────────

export function init(deps) {
  _apiBase = deps.apiBase;
  _getToken = deps.getToken;

  // Store original button labels for reset after action
  for (const btn of document.querySelectorAll(
    '#maintenance-panel button',
  )) {
    btn.dataset.label = btn.textContent;
  }

  // Cleanup actions
  wire(
    'clear-system-msgs-btn',
    'clear-system-msgs-result',
    'all-system-conversations',
    'Delete ALL system message conversations? This cannot be undone.',
  );
  wire(
    'clear-reports-btn',
    'clear-reports-result',
    'all-reports',
    'Delete ALL reports (pending, resolved, archived) and locks? This cannot be undone.',
  );
  wire(
    'clear-warnings-btn',
    'clear-warnings-result',
    'all-warnings',
    'Reset warnings and GCS for ALL users? This cannot be undone.',
  );

  // Wire any other maintenance buttons using data attributes
  for (const btn of document.querySelectorAll(
    '[data-maintenance-action]',
  )) {
    const action = btn.dataset.maintenanceAction;
    const resultId = btn.dataset.resultId || 'maintenance-result';
    const msg =
      btn.dataset.confirmMsg || `Run ${action}? This cannot be undone.`;
    btn.addEventListener('click', () =>
      runAction(btn.id, resultId, action, msg),
    );
  }

  // Storage audit
  const auditBtn = document.getElementById('audit-storage-btn');
  if (auditBtn) auditBtn.addEventListener('click', auditStorage);

  // Storage purge
  const purgeBtn = document.getElementById('purge-storage-btn');
  if (purgeBtn) purgeBtn.addEventListener('click', purgeStorage);
}

export function activate() {
  // No load needed — maintenance is on-demand actions
}

export function deactivate() {
  // No cleanup needed
}

// ── Internal ───────────────────────────────────────────────────────

function wire(btnId, resultId, endpoint, confirmMsg) {
  const btn = document.getElementById(btnId);
  if (btn) {
    btn.addEventListener('click', () =>
      runAction(btnId, resultId, endpoint, confirmMsg),
    );
  }
}

async function runAction(btnId, resultId, endpoint, confirmMsg) {
  const btn = document.getElementById(btnId);
  const result = document.getElementById(resultId);
  if (!btn || !result) return;
  if (btn.disabled) return;
  if (!confirm(confirmMsg)) return;

  btn.disabled = true;
  btn.textContent = 'Processing...';
  result.className = 'maintenance-result';
  result.style.display = 'none';

  try {
    const token = await _getToken();
    // Support both short names (e.g. "all-backpacks" → /api/cleanup/all-backpacks)
    // and full paths (e.g. "/api/admin/maintenance/clear-suggestions")
    const url = endpoint.startsWith('/') ? `${_apiBase}${endpoint}` : `${_apiBase}/api/cleanup/${endpoint}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Request failed');
    result.className = 'maintenance-result success';
    result.textContent = JSON.stringify(data, null, 2);
    result.style.display = 'block';
  } catch (err) {
    result.className = 'maintenance-result error';
    result.textContent = err.message;
    result.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = btn.dataset.label || 'Run';
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
}

async function auditStorage() {
  const btn = document.getElementById('audit-storage-btn');
  const result = document.getElementById('storage-result');
  if (btn.disabled) return;
  btn.disabled = true;
  btn.textContent = 'Auditing...';
  result.className = 'maintenance-result';
  result.style.display = 'none';

  try {
    const token = await _getToken();
    const resp = await fetch(`${_apiBase}/api/storage/audit`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Request failed');

    const folders = data.folders || {};
    const lines = Object.entries(folders).map(
      ([folder, info]) =>
        `${folder}: ${info.count} files (${formatBytes(info.bytes)})`,
    );
    lines.push(
      `Total: ${data.totalFiles} files (${formatBytes(data.totalBytes)})`,
    );
    result.className = 'maintenance-result success';
    result.textContent = lines.join('\n');
    result.style.display = 'block';
  } catch (err) {
    result.className = 'maintenance-result error';
    result.textContent = err.message;
    result.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Audit Storage';
  }
}

async function purgeStorage() {
  const btn = document.getElementById('purge-storage-btn');
  const result = document.getElementById('storage-result');
  if (btn.disabled) return;
  const folders = ['pm_images/', 'stickers/', 'report_evidence/'];
  if (
    !confirm(
      `Purge ALL files from:\n- ${folders.join('\n- ')}\n\nProfile and cover photos will NOT be affected. This cannot be undone.`,
    )
  )
    return;

  btn.disabled = true;
  btn.textContent = 'Purging...';
  result.className = 'maintenance-result';
  result.style.display = 'none';

  try {
    const token = await _getToken();
    const resp = await fetch(`${_apiBase}/api/cleanup/orphaned-storage`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ folders }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Request failed');
    result.className = 'maintenance-result success';
    result.textContent = JSON.stringify(data, null, 2);
    result.style.display = 'block';
  } catch (err) {
    result.className = 'maintenance-result error';
    result.textContent = err.message;
    result.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Purge Orphaned Files';
  }
}
