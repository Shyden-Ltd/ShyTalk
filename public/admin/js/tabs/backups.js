/**
 * Backups tab — trigger backup, list, download, restore.
 *
 * Extracted from inline script block in index.html (PR B).
 * Note: Uses raw fetch (not apiCall) because it needs blob downloads.
 */

import { showToast } from '/js/core/ui.js';

// ── Dependencies injected from main.js ─────────────────────────────

let _apiBase = '';
let _getToken = () => Promise.resolve(null);

// ── Public API ─────────────────────────────────────────────────────

/**
 * One-time initialisation.
 * @param {{ apiBase: string, getToken: () => Promise<string> }} deps
 */
export function init(deps) {
  _apiBase = deps.apiBase;
  _getToken = deps.getToken;

  document
    .getElementById('backup-trigger-btn')
    .addEventListener('click', triggerBackup);

  document
    .getElementById('backup-refresh-btn')
    .addEventListener('click', () => loadBackups());

  const recoverBtn = document.getElementById('backup-recover-photos-btn');
  if (recoverBtn) {
    recoverBtn.addEventListener('click', recoverPhotos);
  }
}

/** Called every time the Backups tab is activated. */
export function activate() {
  loadBackups();
}

/** Called when leaving the Backups tab. */
export function deactivate() {
  // No cleanup needed
}

// ── Internal ───────────────────────────────────────────────────────

async function loadBackups() {
  const list = document.getElementById('backups-list');
  list.textContent = 'Loading...';
  list.style.color = 'var(--text2)';
  try {
    const token = await _getToken();
    const res = await fetch(`${_apiBase}/api/admin/backups`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(await res.text());
    const { backups } = await res.json();
    list.textContent = '';
    list.style.color = '';
    if (backups.length === 0) {
      list.textContent =
        'No backups yet. Click "Backup Now" to create one.';
      list.style.color = 'var(--text2)';
      return;
    }
    for (const b of backups) {
      const row = document.createElement('div');
      row.style.cssText =
        'display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--card);border:1px solid var(--border);border-radius:8px;';

      const info = document.createElement('div');
      info.style.flex = '1';
      const dateEl = document.createElement('div');
      dateEl.style.cssText = 'font-weight:600;font-size:15px;';
      dateEl.textContent = b.date;
      const meta = document.createElement('div');
      meta.style.cssText = 'font-size:13px;color:var(--text2);';
      meta.textContent = `${b.userCount ?? '?'} users \u00b7 ${(b.size / 1024).toFixed(1)} KB`;
      info.appendChild(dateEl);
      info.appendChild(meta);

      const dlBtn = document.createElement('button');
      dlBtn.textContent = 'Download';
      dlBtn.style.cssText =
        'padding:6px 14px;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:13px;';
      dlBtn.addEventListener('click', () => downloadBackup(b.date));

      const restoreMissingBtn = document.createElement('button');
      restoreMissingBtn.textContent = 'Restore Missing';
      restoreMissingBtn.title =
        'Only fill in fields that are currently null/missing';
      restoreMissingBtn.style.cssText =
        'padding:6px 14px;background:#f59e0b;color:#000;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;';
      restoreMissingBtn.addEventListener('click', () =>
        restoreBackup(b.date, 'missing-only'),
      );

      const fullRestoreBtn = document.createElement('button');
      fullRestoreBtn.textContent = 'Full Restore';
      fullRestoreBtn.title = 'Overwrite all fields from backup';
      fullRestoreBtn.style.cssText =
        'padding:6px 14px;background:var(--danger);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;';
      fullRestoreBtn.addEventListener('click', () =>
        restoreBackup(b.date, 'full'),
      );

      row.appendChild(info);
      row.appendChild(dlBtn);
      row.appendChild(restoreMissingBtn);
      row.appendChild(fullRestoreBtn);
      list.appendChild(row);
    }
  } catch (err) {
    list.textContent = 'Error: ' + err.message;
    list.style.color = 'var(--danger)';
  }
}

async function downloadBackup(date) {
  try {
    const token = await _getToken();
    const res = await fetch(`${_apiBase}/api/admin/backups/${date}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(await res.text());
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shytalk-users-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Download started', 'success');
  } catch (err) {
    showToast('Download failed: ' + err.message, 'error');
  }
}

async function restoreBackup(date, mode) {
  const label =
    mode === 'full'
      ? 'FULL RESTORE (overwrites all fields)'
      : mode === 'collection'
        ? 'Restore collection'
        : 'Restore missing fields only';
  if (
    !confirm(
      label +
        ' from backup ' +
        date +
        '?\n\nThis will update user profiles in Firestore.',
    )
  )
    return;
  if (
    mode === 'full' &&
    !confirm(
      'Are you SURE? Full restore will overwrite current data with backup data.',
    )
  )
    return;
  try {
    showToast('Restoring...', 'info');
    const token = await _getToken();
    const res = await fetch(`${_apiBase}/api/admin/backups/restore/${date}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ mode }),
    });
    if (!res.ok) throw new Error(await res.text());
    const result = await res.json();
    const totals = Object.values(result.results || {}).reduce(
      (s, r) => ({
        restored: s.restored + (r.restoredCount || 0),
        total: s.total + (r.totalInBackup || 0),
      }),
      { restored: 0, total: 0 },
    );
    showToast(
      'Restored ' +
        totals.restored +
        '/' +
        totals.total +
        ' docs (' +
        mode +
        ')',
      'success',
    );
  } catch (err) {
    showToast('Restore failed: ' + err.message, 'error');
  }
}

async function triggerBackup() {
  const btn = document.getElementById('backup-trigger-btn');
  if (btn.disabled) return;
  btn.disabled = true;
  btn.textContent = 'Backing up...';
  try {
    const token = await _getToken();
    const res = await fetch(`${_apiBase}/api/admin/backups/trigger`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(await res.text());
    const result = await res.json();
    showToast('Backup complete: ' + result.message, 'success');
    await loadBackups();
  } catch (err) {
    showToast('Backup failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Backup Now';
  }
}

async function recoverPhotos() {
  const btn = document.getElementById('backup-recover-photos-btn');
  if (!btn) return;
  if (btn.disabled) return;
  if (!confirm('Recover missing profile/cover photos from R2 storage?'))
    return;
  btn.disabled = true;
  btn.textContent = 'Recovering...';
  try {
    const token = await _getToken();
    const res = await fetch(`${_apiBase}/api/admin/backups/recover-photos`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(await res.text());
    const result = await res.json();
    showToast(
      `Recovered ${result.recovered || 0} photos`,
      'success',
    );
  } catch (err) {
    showToast('Recovery failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Recover Photos from R2';
  }
}
