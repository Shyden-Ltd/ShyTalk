/**
 * Devices tab — device binding search, ban/unban, network bans.
 *
 * Extracted from inline script block in index.html (PR B).
 * Depends on core modules: apiCall, showToast, escapeHtml.
 */

import { apiCall } from '/js/core/api.js';
import { showToast, showConfirm, escapeHtml } from '/js/core/ui.js';

// ── State ──────────────────────────────────────────────────────────

let devicesOffset = 0;
const devicesLimit = 50;
let devicesTotal = 0;
let devicesBannedSet = new Set();

// ── DOM refs (resolved lazily on init) ─────────────────────────────

let devicesSearchInput;
let devicesSearchBtn;
let devicesTbody;
let devicesEmpty;
let devicesPrevBtn;
let devicesNextBtn;
let devicesPageInfo;
let devicesTotalInfo;

/** Callback to switch tabs (injected by main.js to avoid circular dep). */
let _switchTab = () => {};

// ── Public API ─────────────────────────────────────────────────────

/**
 * One-time initialisation. Called after DOM is ready.
 * @param {{ switchTab: Function }} deps - injected dependencies
 */
export function init(deps) {
  _switchTab = deps.switchTab;

  devicesSearchInput = document.getElementById('devices-search-input');
  devicesSearchBtn = document.getElementById('devices-search-btn');
  devicesTbody = document.getElementById('devices-tbody');
  devicesEmpty = document.getElementById('devices-empty');
  devicesPrevBtn = document.getElementById('devices-prev-btn');
  devicesNextBtn = document.getElementById('devices-next-btn');
  devicesPageInfo = document.getElementById('devices-page-info');
  devicesTotalInfo = document.getElementById('devices-total-info');

  // Event listeners
  devicesSearchBtn.addEventListener('click', () => {
    devicesOffset = 0;
    loadDevices();
  });
  devicesSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      devicesOffset = 0;
      loadDevices();
    }
  });
  devicesPrevBtn.addEventListener('click', () => {
    devicesOffset = Math.max(0, devicesOffset - devicesLimit);
    loadDevices();
  });
  devicesNextBtn.addEventListener('click', () => {
    devicesOffset += devicesLimit;
    loadDevices();
  });
}

/** Called every time the Devices tab is activated. */
export function activate() {
  loadDevices();
}

/** Called when leaving the Devices tab. */
export function deactivate() {
  // No cleanup needed — no listeners or intervals to stop
}

// ── Internal ───────────────────────────────────────────────────────

async function loadDevices(query) {
  const q =
    query !== undefined
      ? query
      : (devicesSearchInput.value || '').trim();
  try {
    const params = new URLSearchParams({
      limit: devicesLimit,
      offset: devicesOffset,
    });
    if (q) params.set('q', q);
    const data = await apiCall('GET', `/api/admin/devices?${params}`);
    devicesTotal = data.total || 0;

    // Also load banned devices set
    try {
      const bansData = await apiCall('GET', '/api/admin/bans');
      devicesBannedSet = new Set(
        (bansData.deviceBans || []).map((b) => b.deviceId),
      );
    } catch (_) {
      /* ignore — banned set is best-effort */
    }

    renderDevicesTable(data);
  } catch (err) {
    showToast('Failed to load devices: ' + err.message, 'error');
  }
}

function renderDevicesTable(data) {
  const devices = data.devices || [];
  devicesTbody.innerHTML = '';

  if (devices.length === 0) {
    devicesEmpty.style.display = 'block';
    devicesTbody.parentElement.querySelector('thead').style.display = 'none';
  } else {
    devicesEmpty.style.display = 'none';
    devicesTbody.parentElement.querySelector('thead').style.display = '';
  }

  for (const d of devices) {
    const isBanned = devicesBannedSet.has(d.id);
    const lastSeen = d.lastSeen
      ? new Date(d.lastSeen).toLocaleString()
      : 'N/A';
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    tr.innerHTML = `
      <td class="device-id-cell" title="${escapeHtml(d.id)}">${escapeHtml(d.id.substring(0, 16))}${d.id.length > 16 ? '...' : ''}</td>
      <td>${escapeHtml(d.uniqueId || 'N/A')}</td>
      <td>${escapeHtml((d.manufacturer ? d.manufacturer + ' ' : '') + (d.model || 'N/A'))}</td>
      <td>${escapeHtml(d.osVersion || d.os || 'N/A')}</td>
      <td style="font-family:monospace;font-size:11px;">${escapeHtml(d.lastIp || 'N/A')}</td>
      <td>${escapeHtml(d.isp || 'N/A')}</td>
      <td>${escapeHtml(d.country || 'N/A')}</td>
      <td style="font-size:11px;">${lastSeen}</td>
      <td><span class="${isBanned ? 'device-status-banned' : 'device-status-active'}">${isBanned ? 'BANNED' : 'Active'}</span></td>
      <td class="device-actions">
        <button class="device-btn-unbind" data-unbind="${escapeHtml(d.id)}">Unbind</button>
        <button class="device-btn-ban" data-ban-device="${escapeHtml(d.id)}" data-ban-user="${escapeHtml(d.uniqueId || '')}">Ban</button>
        <button class="device-btn-ban-net" data-ban-net-ip="${escapeHtml(d.lastIp || '')}" data-ban-net-user="${escapeHtml(d.uniqueId || '')}">Ban Net</button>
        <button class="device-btn-logs" data-view-logs-user="${escapeHtml(d.uniqueId || '')}">Logs</button>
      </td>`;

    // Detail row (expandable)
    const detailTr = document.createElement('tr');
    detailTr.innerHTML = `<td colspan="10"><div class="device-detail" id="detail-${escapeHtml(d.id)}">
      <dl class="device-detail-grid">
        <dt>Device ID</dt><dd>${escapeHtml(d.id)}</dd>
        <dt>User ID</dt><dd>${escapeHtml(d.uniqueId || 'N/A')}</dd>
        <dt>Manufacturer</dt><dd>${escapeHtml(d.manufacturer || 'N/A')}</dd>
        <dt>Model</dt><dd>${escapeHtml(d.model || 'N/A')}</dd>
        <dt>OS Version</dt><dd>${escapeHtml(d.osVersion || d.os || 'N/A')}</dd>
        <dt>App Version</dt><dd>${escapeHtml(d.appVersion || 'N/A')}</dd>
        <dt>Last IP</dt><dd>${escapeHtml(d.lastIp || 'N/A')}</dd>
        <dt>ISP</dt><dd>${escapeHtml(d.isp || 'N/A')}</dd>
        <dt>Country</dt><dd>${escapeHtml(d.country || 'N/A')}</dd>
        <dt>Region</dt><dd>${escapeHtml(d.region || 'N/A')}</dd>
        <dt>City</dt><dd>${escapeHtml(d.city || 'N/A')}</dd>
        <dt>Last Seen</dt><dd>${lastSeen}</dd>
        <dt>Created At</dt><dd>${d.createdAt ? new Date(d.createdAt).toLocaleString() : 'N/A'}</dd>
        <dt>Status</dt><dd class="${isBanned ? 'device-status-banned' : 'device-status-active'}">${isBanned ? 'BANNED' : 'Active'}</dd>
      </dl>
    </div></td>`;

    tr.addEventListener('click', () => {
      const detail = detailTr.querySelector('.device-detail');
      detail.classList.toggle('visible');
    });

    devicesTbody.appendChild(tr);
    devicesTbody.appendChild(detailTr);
  }

  // Pagination
  const page = Math.floor(devicesOffset / devicesLimit) + 1;
  const totalPages = Math.ceil(devicesTotal / devicesLimit) || 1;
  devicesPageInfo.textContent = `Page ${page} of ${totalPages}`;
  devicesTotalInfo.textContent = `(${devicesTotal} total)`;
  devicesPrevBtn.disabled = devicesOffset === 0;
  devicesNextBtn.disabled = devicesOffset + devicesLimit >= devicesTotal;

  // Wire action buttons
  for (const btn of devicesTbody.querySelectorAll('[data-unbind]')) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      unbindDevice(btn.dataset.unbind);
    });
  }
  for (const btn of devicesTbody.querySelectorAll('[data-ban-device]')) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      banDeviceFromDevices(btn.dataset.banDevice, btn.dataset.banUser);
    });
  }
  for (const btn of devicesTbody.querySelectorAll('[data-ban-net-ip]')) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      banNetworkFromDevices(btn.dataset.banNetIp, btn.dataset.banNetUser);
    });
  }
  for (const btn of devicesTbody.querySelectorAll('[data-view-logs-user]')) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const uid = btn.dataset.viewLogsUser;
      if (!uid) return;
      const logsUserFilter = document.getElementById('log-filter-userId');
      if (logsUserFilter) logsUserFilter.value = uid;
      _switchTab('logs');
    });
  }
}

async function unbindDevice(deviceId) {
  if (!confirm(`Unbind device ${deviceId}?`)) return;
  try {
    const result = await apiCall('DELETE', `/api/admin/devices/${deviceId}`);
    window.PartialFailureToast?.showResultToast(showToast, result, 'Device unbound successfully');
    loadDevices();
  } catch (err) {
    showToast('Failed to unbind: ' + err.message, 'error');
  }
}

async function banDeviceFromDevices(deviceId, userId) {
  if (!deviceId) return;
  if (!confirm('Ban this device?')) return;
  const reason = prompt('Reason (optional):') || '';
  try {
    const result = await apiCall('POST', '/api/admin/bans/device', {
      deviceId,
      reason,
      linkedUniqueId: userId || null,
    });
    window.PartialFailureToast?.showResultToast(showToast, result, 'Device banned');
    loadDevices();
  } catch (err) {
    showToast('Failed to ban device: ' + err.message, 'error');
  }
}

async function banNetworkFromDevices(ip, userId) {
  if (!ip) {
    showToast('No IP address available', 'error');
    return;
  }
  if (!confirm('Ban IP ' + ip + '?')) return;
  const reason = prompt('Reason (optional):') || '';
  try {
    const result = await apiCall('POST', '/api/admin/bans/network', {
      type: 'ip',
      value: ip,
      reason,
      linkedUniqueId: userId || null,
    });
    window.PartialFailureToast?.showResultToast(showToast, result, 'Network banned');
    loadDevices();
  } catch (err) {
    showToast('Failed to ban network: ' + err.message, 'error');
  }
}
