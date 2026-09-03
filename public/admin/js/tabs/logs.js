/**
 * Logs tab — system logs with filters, trace view, live mode, alerts, and settings.
 *
 * Extracted from inline script block in index.html (PR B).
 * Uses Firestore onSnapshot for live mode.
 */

import { apiCall } from '/js/core/api.js';
import { showToast, escapeHtml } from '/js/core/ui.js';

// ── State ──────────────────────────────────────────────────────────

let logsData = [];
let logsCursor = null;
let liveUnsub = null;
let quotaInterval = null;
let alertBellInterval = null;

// ── Injected dependencies ─────────────────────────────────────────

let _apiBase = '';
let _getToken = () => Promise.resolve(null);

// ── Firestore refs (injected) ──────────────────────────────────────

let _clientDb = null;
let _collection = null;
let _query = null;
let _orderBy = null;
let _limit = null;
let _onSnapshot = null;
let _switchTab = () => {};
let _getCurrentTab = () => '';

// ── Public API ─────────────────────────────────────────────────────

/**
 * @param deps.clientDb — Firestore instance (client SDK)
 * @param deps.firestoreFns — { collection, query, orderBy, limit, onSnapshot }
 * @param deps.switchTab — tab switching callback
 * @param deps.getCurrentTab — returns current tab name
 */
export function init(deps) {
  _apiBase = deps.apiBase || '';
  _getToken = deps.getToken || _getToken;
  _clientDb = deps.clientDb;
  if (deps.firestoreFns) {
    _collection = deps.firestoreFns.collection;
    _query = deps.firestoreFns.query;
    _orderBy = deps.firestoreFns.orderBy;
    _limit = deps.firestoreFns.limit;
    _onSnapshot = deps.firestoreFns.onSnapshot;
  }
  _switchTab = deps.switchTab;
  _getCurrentTab = deps.getCurrentTab;

  // Alert bell
  document.getElementById('alert-bell').addEventListener('click', () => {
    _switchTab('logs');
    const sec = document.getElementById('logs-alerts-section');
    if (sec) sec.classList.remove('collapsed');
  });

  // Alert config toggle
  document.getElementById('alerts-config-toggle').addEventListener('click', () => {
    const panel = document.getElementById('alert-config-panel');
    if (panel.style.display === 'none') {
      panel.style.display = '';
      loadAlertConfig();
    } else {
      panel.style.display = 'none';
    }
  });

  // Alert config save
  document.getElementById('alert-config-save-btn').addEventListener('click', saveAlertConfig);

  // Filter actions
  document.getElementById('log-search-btn').addEventListener('click', () => {
    stopLiveMode();
    logsCursor = null;
    loadLogs();
  });

  document.getElementById('log-clear-btn').addEventListener('click', () => {
    clearFilters();
    stopLiveMode();
    logsCursor = null;
    loadLogs();
  });

  // Load more
  document.getElementById('logs-load-more').addEventListener('click', () => loadLogs(true));

  // Live mode toggle
  document.getElementById('log-live-toggle').addEventListener('click', () => {
    if (liveUnsub) stopLiveMode();
    else startLiveMode();
  });

  // Trace back button
  document.getElementById('trace-back-btn').addEventListener('click', () => {
    document.getElementById('trace-view').classList.remove('visible');
    document.getElementById('logs-table-view').style.display = '';
    document.getElementById('logs-filters').style.display = '';
  });

  // Export buttons
  document.getElementById('log-export-json').addEventListener('click', () => exportLogs('json'));
  document.getElementById('log-export-csv').addEventListener('click', () => exportLogs('csv'));

  // Log settings save
  document.getElementById('log-settings-save-btn').addEventListener('click', saveLogConfig);

  // Inline audit log section (inside Logs panel)
  const auditSearchBtn = document.getElementById('audit-search-btn');
  if (auditSearchBtn)
    auditSearchBtn.addEventListener('click', () => {
      _auditCurrentPage = 1;
      _auditPageTokens = [null];
      loadInlineAuditLog(1);
    });
  const auditPrevBtn = document.getElementById('audit-prev-btn');
  if (auditPrevBtn)
    auditPrevBtn.addEventListener('click', () => {
      if (_auditCurrentPage > 1) loadInlineAuditLog(_auditCurrentPage - 1);
    });
  const auditNextBtn = document.getElementById('audit-next-btn');
  if (auditNextBtn)
    auditNextBtn.addEventListener('click', () => {
      if (_auditLastPageToken) loadInlineAuditLog(_auditCurrentPage + 1);
    });
  const auditExportBtn = document.getElementById('audit-export-csv-btn');
  if (auditExportBtn) auditExportBtn.addEventListener('click', exportInlineAuditCsv);
}

export function activate() {
  loadAlerts();
  loadQuotaStats();
  loadLogs();
  loadLogConfig();
  // Note: startAutoRefresh is called once globally by startGlobalRefresh() after login.
  // Do NOT call it here — would create duplicate interval if deactivate ever clears it.
}

export function deactivate() {
  stopLiveMode();
  // Keep bell refresh running globally (not tab-specific)
}

/** Start alert bell polling — called once after login. */
export function startGlobalRefresh() {
  startAlertBellRefresh();
  startAutoRefresh();
}

/** Stop all intervals on sign-out. */
export function stopAll() {
  stopLiveMode();
  if (quotaInterval) {
    clearInterval(quotaInterval);
    quotaInterval = null;
  }
  if (alertBellInterval) {
    clearInterval(alertBellInterval);
    alertBellInterval = null;
  }
}

// ── Alerts ─────────────────────────────────────────────────────────

async function loadAlerts() {
  try {
    const data = await apiCall('GET', '/api/admin/alerts?limit=50');
    const alerts = data.alerts || [];
    const tbody = document.getElementById('alerts-tbody');
    const emptyEl = document.getElementById('alerts-empty');
    tbody.textContent = '';
    if (alerts.length === 0) {
      emptyEl.style.display = '';
      return;
    }
    emptyEl.style.display = 'none';
    for (const a of alerts) {
      const tr = document.createElement('tr');
      const isCritical = a.severity === 'critical';

      const tdSev = document.createElement('td');
      tdSev.className = isCritical ? 'alert-severity-critical' : 'alert-severity-warning';
      tdSev.textContent = '\u26A0';
      tr.appendChild(tdSev);

      const tdType = document.createElement('td');
      tdType.textContent = a.type || '';
      tr.appendChild(tdType);

      const tdTitle = document.createElement('td');
      tdTitle.textContent = a.title || a.message || '';
      tr.appendChild(tdTitle);

      const tdTs = document.createElement('td');
      tdTs.style.cssText = 'font-size:12px;color:var(--text2);';
      tdTs.textContent = a.createdAt
        ? new Date(
            a.createdAt._seconds ? a.createdAt._seconds * 1000 : a.createdAt,
          ).toLocaleString()
        : '';
      tr.appendChild(tdTs);

      const tdStatus = document.createElement('td');
      tdStatus.textContent = a.status || 'new';
      tr.appendChild(tdStatus);

      const tdActions = document.createElement('td');
      if (a.status !== 'acknowledged' && a.status !== 'resolved') {
        const ackBtn = document.createElement('button');
        ackBtn.className = 'alert-btn';
        ackBtn.textContent = 'Ack';
        ackBtn.addEventListener('click', () => acknowledgeAlert(a.id));
        tdActions.appendChild(ackBtn);
      }
      if (a.status !== 'resolved') {
        const resBtn = document.createElement('button');
        resBtn.className = 'alert-btn alert-btn-resolve';
        resBtn.textContent = 'Resolve';
        resBtn.addEventListener('click', () => resolveAlert(a.id));
        tdActions.appendChild(resBtn);
      }
      if (a.sampleTraceId) {
        const link = document.createElement('span');
        link.className = 'alert-link';
        link.textContent = 'View Logs';
        link.addEventListener('click', () => filterLogsByTrace(a.sampleTraceId));
        tdActions.appendChild(link);
      }
      tr.appendChild(tdActions);
      tbody.appendChild(tr);
    }
    const unresolved = alerts.filter((a) => a.status !== 'resolved').length;
    const badge = document.getElementById('alerts-unresolved-count');
    if (unresolved > 0) {
      badge.textContent = unresolved;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  } catch (err) {
    console.error('Failed to load alerts:', err);
  }
}

async function acknowledgeAlert(id) {
  try {
    await apiCall('PATCH', `/api/admin/alerts/${id}`, {
      status: 'acknowledged',
    });
    showToast('Alert acknowledged');
    await loadAlerts();
    await loadUnresolvedCount();
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

async function resolveAlert(id) {
  try {
    await apiCall('PATCH', `/api/admin/alerts/${id}`, {
      status: 'resolved',
    });
    showToast('Alert resolved');
    await loadAlerts();
    await loadUnresolvedCount();
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

function filterLogsByTrace(traceId) {
  document.getElementById('log-filter-traceId').value = traceId;
  loadLogs();
}

async function loadUnresolvedCount() {
  try {
    const [data, data2] = await Promise.all([
      apiCall('GET', '/api/admin/alerts?status=new&limit=100'),
      apiCall('GET', '/api/admin/alerts?status=acknowledged&limit=100'),
    ]);
    const count = (data.alerts || []).length + (data2.alerts || []).length;
    const badge = document.getElementById('alert-bell-badge');
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  } catch (err) {
    console.error('Failed to load alert count:', err);
  }
}

// ── Alert Config ───────────────────────────────────────────────────

async function loadAlertConfig() {
  try {
    const data = await apiCall('GET', '/api/admin/alert-config');
    const grid = document.getElementById('alert-config-grid');
    grid.textContent = '';
    const config = data.config || data;
    const thresholds = config.thresholds || config;
    for (const [key, val] of Object.entries(thresholds)) {
      if (typeof val === 'object' && val !== null) {
        for (const [subKey, subVal] of Object.entries(val)) {
          grid.appendChild(makeConfigField(key + '.' + subKey, subVal));
        }
      } else {
        grid.appendChild(makeConfigField(key, val));
      }
    }
  } catch (err) {
    showToast('Failed to load alert config: ' + err.message, 'error');
  }
}

function makeConfigField(key, val) {
  const field = document.createElement('div');
  field.className = 'log-setting-field';
  const lbl = document.createElement('label');
  lbl.textContent = key;
  const inp = document.createElement('input');
  inp.type = typeof val === 'number' ? 'number' : 'text';
  inp.dataset.alertCfg = key;
  inp.value = val;
  field.appendChild(lbl);
  field.appendChild(inp);
  return field;
}

async function saveAlertConfig() {
  try {
    const inputs = document.querySelectorAll('[data-alert-cfg]');
    const body = {};
    for (const inp of inputs) {
      const key = inp.dataset.alertCfg;
      const val = inp.type === 'number' ? Number(inp.value) : inp.value;
      const parts = key.split('.');
      if (parts.length === 2) {
        if (!body[parts[0]]) body[parts[0]] = {};
        body[parts[0]][parts[1]] = val;
      } else {
        body[key] = val;
      }
    }
    await apiCall('PATCH', '/api/admin/alert-config', body);
    showToast('Alert config saved');
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

// ── Quota ──────────────────────────────────────────────────────────

async function loadQuotaStats() {
  try {
    const data = await apiCall('GET', '/api/logs/stats');
    const count = data.count || 0;
    const cap = data.hardCap || 15000;
    const pct = Math.min((count / cap) * 100, 100);
    document.getElementById('quota-label').textContent =
      count.toLocaleString() + ' / ' + cap.toLocaleString() + ' logs today';
    const bar = document.getElementById('quota-bar');
    bar.style.width = pct + '%';
    bar.className =
      'quota-bar-inner ' +
      (pct > 80 ? 'quota-bar-red' : pct > 60 ? 'quota-bar-yellow' : 'quota-bar-green');
  } catch (err) {
    document.getElementById('quota-label').textContent = 'Quota unavailable';
  }
}

// ── Logs ───────────────────────────────────────────────────────────

function getLogFilters() {
  const f = {};
  const fields = {
    level: 'log-filter-level',
    source: 'log-filter-source',
    userId: 'log-filter-userId',
    sessionTraceId: 'log-filter-traceId',
    keyword: 'log-filter-keyword',
    route: 'log-filter-route',
  };
  for (const [key, id] of Object.entries(fields)) {
    const val = document.getElementById(id).value.trim();
    if (val) f[key] = val;
  }
  const startTime = document.getElementById('log-filter-startTime').value;
  const endTime = document.getElementById('log-filter-endTime').value;
  if (startTime) f.startTime = new Date(startTime).toISOString();
  if (endTime) f.endTime = new Date(endTime).toISOString();
  return f;
}

async function loadLogs(append = false) {
  try {
    const filters = getLogFilters();
    const params = new URLSearchParams(filters);
    params.set('limit', '50');
    if (append && logsCursor) params.set('cursor', logsCursor);

    const data = await apiCall('GET', '/api/admin/logs?' + params.toString());
    const logs = data.logs || [];
    logsCursor = data.nextCursor || null;

    if (!append) logsData = logs;
    else logsData = logsData.concat(logs);

    renderLogTable(!append);
    document.getElementById('logs-load-more').style.display = logsCursor ? '' : 'none';
    document.getElementById('logs-empty').style.display = logsData.length === 0 ? '' : 'none';
  } catch (err) {
    showToast('Failed to load logs: ' + err.message, 'error');
  }
}

function renderLogTable(clear) {
  const tbody = document.getElementById('logs-tbody');
  if (clear) tbody.textContent = '';
  const startIdx = clear ? 0 : tbody.querySelectorAll('tr:not(.log-expanded-row)').length;
  const logs = clear ? logsData : logsData.slice(startIdx);
  for (const log of logs) {
    tbody.appendChild(renderLogRow(log));
  }
}

function renderLogRow(log) {
  const tr = document.createElement('tr');
  const level = (log.level || 'info').toLowerCase();
  const ts = log.timestamp
    ? new Date(
        log.timestamp._seconds ? log.timestamp._seconds * 1000 : log.timestamp,
      ).toLocaleString()
    : '';
  const traceShort = log.sessionTraceId ? log.sessionTraceId.substring(0, 10) + '...' : '';

  const tdTime = document.createElement('td');
  tdTime.style.cssText = 'font-size:12px;color:var(--text2);';
  tdTime.textContent = ts;
  tr.appendChild(tdTime);

  const tdLevel = document.createElement('td');
  tdLevel.className = 'log-level-' + level;
  tdLevel.style.cssText = 'font-weight:600;text-transform:uppercase;';
  tdLevel.textContent = level;
  tr.appendChild(tdLevel);

  const tdSource = document.createElement('td');
  tdSource.style.fontSize = '12px';
  tdSource.textContent = log.source || '';
  tr.appendChild(tdSource);

  const tdUser = document.createElement('td');
  tdUser.style.fontSize = '12px';
  tdUser.textContent = log.userId || '';
  tr.appendChild(tdUser);

  const tdMsg = document.createElement('td');
  tdMsg.title = log.message || '';
  tdMsg.textContent = log.message || '';
  tr.appendChild(tdMsg);

  const tdTrace = document.createElement('td');
  if (log.sessionTraceId) {
    const traceLink = document.createElement('span');
    traceLink.className = 'log-trace-link';
    traceLink.textContent = traceShort;
    traceLink.addEventListener('click', (e) => {
      e.stopPropagation();
      loadTrace(log.sessionTraceId);
    });
    tdTrace.appendChild(traceLink);
  }
  tr.appendChild(tdTrace);

  tr.addEventListener('click', () => {
    const next = tr.nextElementSibling;
    if (next && next.classList.contains('log-expanded-row')) {
      next.remove();
      return;
    }
    const expRow = document.createElement('tr');
    expRow.className = 'log-expanded-row';
    const expTd = document.createElement('td');
    expTd.setAttribute('colspan', '6');
    const pre = document.createElement('pre');
    pre.className = 'log-context-pre';
    const ctx = log.context || {};
    const displayObj = Object.assign({}, ctx);
    if (log.requestTraceId) displayObj.requestTraceId = log.requestTraceId;
    if (log.sessionTraceId) displayObj.sessionTraceId = log.sessionTraceId;
    if (log.durationMs !== undefined) displayObj.durationMs = log.durationMs;
    if (log.route) displayObj.route = log.route;
    if (log.method) displayObj.method = log.method;
    if (log.statusCode) displayObj.statusCode = log.statusCode;
    pre.textContent = JSON.stringify(displayObj, null, 2);
    expTd.appendChild(pre);
    expRow.appendChild(expTd);
    tr.parentNode.insertBefore(expRow, tr.nextSibling);
  });
  return tr;
}

// ── Trace View ─────────────────────────────────────────────────────

async function loadTrace(traceId) {
  try {
    const data = await apiCall('GET', '/api/admin/logs/trace/' + encodeURIComponent(traceId));
    const logs = data.logs || [];
    document.getElementById('logs-table-view').style.display = 'none';
    document.getElementById('logs-filters').style.display = 'none';
    document.getElementById('trace-view').classList.add('visible');
    document.getElementById('trace-view-title').textContent = 'Session Trace: ' + traceId;
    const timeline = document.getElementById('trace-timeline');
    timeline.textContent = '';
    for (const log of logs) {
      timeline.appendChild(renderTraceEntry(log));
    }
  } catch (err) {
    showToast('Failed to load trace: ' + err.message, 'error');
  }
}

function renderTraceEntry(log) {
  const div = document.createElement('div');
  div.className = 'trace-entry';
  const level = (log.level || 'info').toLowerCase();
  const ts = log.timestamp
    ? new Date(
        log.timestamp._seconds ? log.timestamp._seconds * 1000 : log.timestamp,
      ).toLocaleString()
    : '';
  const badgeColors = {
    debug: '#555',
    info: '#2980b9',
    warn: '#e67e22',
    error: '#c0392b',
    fatal: '#8b0000',
  };

  const header = document.createElement('div');
  header.className = 'trace-entry-header';

  const timeSpan = document.createElement('span');
  timeSpan.className = 'trace-entry-time';
  timeSpan.textContent = ts;
  header.appendChild(timeSpan);

  const badge = document.createElement('span');
  badge.className = 'trace-entry-badge';
  badge.style.cssText = 'background:' + (badgeColors[level] || '#555') + ';color:#fff;';
  badge.textContent = level;
  header.appendChild(badge);

  const msgSpan = document.createElement('span');
  msgSpan.className = 'trace-entry-msg';
  msgSpan.textContent = log.message || '';
  header.appendChild(msgSpan);

  if (log.requestTraceId) {
    const reqSpan = document.createElement('span');
    reqSpan.style.cssText = 'font-size:11px;color:var(--text2);font-family:monospace;';
    reqSpan.textContent = log.requestTraceId.substring(0, 8);
    header.appendChild(reqSpan);
  }

  if (log.durationMs !== undefined) {
    const durSpan = document.createElement('span');
    durSpan.className = 'trace-entry-duration';
    durSpan.textContent = log.durationMs + 'ms';
    header.appendChild(durSpan);
  }

  div.appendChild(header);

  const ctxDiv = document.createElement('div');
  ctxDiv.className = 'trace-entry-context';
  const pre = document.createElement('pre');
  pre.className = 'log-context-pre';
  pre.textContent = JSON.stringify(log.context || {}, null, 2);
  ctxDiv.appendChild(pre);
  div.appendChild(ctxDiv);

  div.addEventListener('click', () => div.classList.toggle('expanded'));
  return div;
}

// ── Live Mode ──────────────────────────────────────────────────────

function startLiveMode() {
  if (liveUnsub || !_clientDb || !_onSnapshot) return;
  const logsRef = _collection(_clientDb, 'logs');
  const q = _query(logsRef, _orderBy('timestamp', 'desc'), _limit(50));
  liveUnsub = _onSnapshot(
    q,
    (snap) => {
      logsData = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderLogTable(true);
      document.getElementById('logs-empty').style.display = logsData.length === 0 ? '' : 'none';
      document.getElementById('logs-load-more').style.display = 'none';
    },
    (err) => {
      console.error('Live mode error:', err);
      stopLiveMode();
    },
  );
  document.getElementById('log-live-toggle').classList.add('active');
}

function stopLiveMode() {
  if (liveUnsub) {
    liveUnsub();
    liveUnsub = null;
  }
  document.getElementById('log-live-toggle').classList.remove('active');
}

// ── Filters ────────────────────────────────────────────────────────

function clearFilters() {
  const ids = [
    'log-filter-level',
    'log-filter-source',
    'log-filter-userId',
    'log-filter-traceId',
    'log-filter-keyword',
    'log-filter-route',
    'log-filter-startTime',
    'log-filter-endTime',
  ];
  for (const id of ids) {
    document.getElementById(id).value = '';
  }
}

// ── Export ──────────────────────────────────────────────────────────

function exportLogs(format) {
  if (logsData.length === 0) {
    showToast('No logs to export', 'error');
    return;
  }
  let content, mime, ext;
  if (format === 'json') {
    content = JSON.stringify(logsData, null, 2);
    mime = 'application/json';
    ext = 'json';
  } else {
    const headers = [
      'timestamp',
      'level',
      'source',
      'userId',
      'message',
      'sessionTraceId',
      'requestTraceId',
      'route',
      'method',
      'statusCode',
      'durationMs',
    ];
    const rows = [headers.join(',')];
    for (const log of logsData) {
      const row = headers.map((h) => {
        let val = log[h] || '';
        if (h === 'timestamp' && val && val._seconds)
          val = new Date(val._seconds * 1000).toISOString();
        return '"' + String(val).replace(/"/g, '""') + '"';
      });
      rows.push(row.join(','));
    }
    content = rows.join('\n');
    mime = 'text/csv';
    ext = 'csv';
  }
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'shytalk-logs-' + new Date().toISOString().slice(0, 10) + '.' + ext;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Log Settings ───────────────────────────────────────────────────

async function loadLogConfig() {
  try {
    const data = await apiCall('GET', '/api/admin/log-config');
    const cfg = data.config || data;
    const el = (id) => document.getElementById(id);
    if (cfg.retentionHours) el('log-cfg-retention').value = cfg.retentionHours;
    if (cfg.dailyHardCap) el('log-cfg-hardcap').value = cfg.dailyHardCap;
    if (cfg.batchIntervalSeconds) el('log-cfg-batch-interval').value = cfg.batchIntervalSeconds;
    if (cfg.wifiOnly !== undefined) el('log-cfg-wifi-only').checked = cfg.wifiOnly;
    if (cfg.excludedRoutes)
      el('log-cfg-excluded-routes').value = (cfg.excludedRoutes || []).join(', ');
    const levels = cfg.logLevels || cfg.levelPerSource || {};
    for (const [src, lvl] of Object.entries(levels)) {
      const srcEl = el('log-cfg-level-' + src);
      if (srcEl) srcEl.value = lvl;
    }
  } catch (err) {
    console.error('Failed to load log config:', err);
  }
}

async function saveLogConfig() {
  try {
    const body = {};
    const el = (id) => document.getElementById(id);
    const retention = el('log-cfg-retention').value;
    const hardcap = el('log-cfg-hardcap').value;
    const batchInterval = el('log-cfg-batch-interval').value;
    const wifiOnly = el('log-cfg-wifi-only').checked;
    const excludedRoutes = el('log-cfg-excluded-routes').value;

    if (retention) body.retentionHours = Number(retention);
    if (hardcap) body.dailyHardCap = Number(hardcap);
    if (batchInterval) body.batchIntervalSeconds = Number(batchInterval);
    body.wifiOnly = wifiOnly;
    if (excludedRoutes)
      body.excludedRoutes = excludedRoutes
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

    const levels = {};
    const sources = ['express-api', 'android', 'ios', 'admin-panel', 'landing-page'];
    for (const src of sources) {
      const srcEl = el('log-cfg-level-' + src);
      if (srcEl) levels[src] = srcEl.value;
    }
    body.logLevels = levels;

    await apiCall('PATCH', '/api/admin/log-config', body);
    showToast('Log settings saved');
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

// ── Auto-refresh ───────────────────────────────────────────────────

function startAutoRefresh() {
  if (quotaInterval) return;
  quotaInterval = setInterval(() => {
    if (_getCurrentTab() === 'logs') loadQuotaStats();
  }, 30000);
}

function startAlertBellRefresh() {
  if (alertBellInterval) return;
  loadUnresolvedCount();
  alertBellInterval = setInterval(() => loadUnresolvedCount(), 60000);
}

// ── Inline Audit Log (section inside Logs panel) ──────────────────

let _auditCurrentPage = 1;
const _AUDIT_PAGE_SIZE = 25;
let _auditLastPageToken = null;
let _auditPageTokens = [null];

async function loadInlineAuditLog(page) {
  const tbody = document.getElementById('audit-tbody');
  const emptyMsg = document.getElementById('audit-empty');
  const pagination = document.getElementById('audit-pagination');
  const pageInfo = document.getElementById('audit-page-info');

  tbody.innerHTML =
    '<tr><td colspan="5" style="color:var(--text2);font-size:12px;">Loading...</td></tr>';
  emptyMsg.style.display = 'none';

  const params = new URLSearchParams();
  params.set('limit', _AUDIT_PAGE_SIZE);
  if (page > 1 && _auditPageTokens[page - 1]) {
    params.set('pageToken', _auditPageTokens[page - 1]);
  }

  const admin = document.getElementById('audit-filter-admin').value.trim();
  const action = document.getElementById('audit-filter-action').value;
  const target = document.getElementById('audit-filter-target').value.trim();
  const from = document.getElementById('audit-filter-from').value;
  const to = document.getElementById('audit-filter-to').value;

  if (admin) params.set('admin', admin);
  if (action) params.set('action', action);
  if (target) params.set('target', target);
  if (from) params.set('from', new Date(from).toISOString());
  if (to) params.set('to', new Date(to).toISOString());

  try {
    const data = await apiCall('GET', `/api/admin/audit-log?${params.toString()}`);
    const entries = data.entries || [];

    if (entries.length === 0 && page === 1) {
      tbody.textContent = '';
      emptyMsg.style.display = 'block';
      pagination.style.display = 'none';
      return;
    }

    emptyMsg.style.display = 'none';
    tbody.textContent = '';

    entries.forEach((entry) => {
      const tr = document.createElement('tr');

      const tdAdmin = document.createElement('td');
      tdAdmin.textContent = entry.adminName || entry.adminId || 'Unknown';
      tr.appendChild(tdAdmin);

      const tdAction = document.createElement('td');
      tdAction.textContent = entry.action || '';
      tr.appendChild(tdAction);

      const tdTarget = document.createElement('td');
      tdTarget.textContent = entry.target || '';
      tdTarget.style.cssText = 'font-family:monospace;font-size:11px;';
      tr.appendChild(tdTarget);

      const tdTime = document.createElement('td');
      tdTime.textContent = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : '';
      tr.appendChild(tdTime);

      const tdDetails = document.createElement('td');
      tdDetails.className = 'audit-details';
      tdDetails.textContent =
        typeof entry.details === 'object' ? JSON.stringify(entry.details) : entry.details || '';
      tdDetails.title = tdDetails.textContent;
      tr.appendChild(tdDetails);

      tbody.appendChild(tr);
    });

    _auditCurrentPage = page;
    _auditLastPageToken = data.nextPageToken || null;
    if (_auditLastPageToken && !_auditPageTokens[page]) {
      _auditPageTokens[page] = _auditLastPageToken;
    }

    pagination.style.display = 'flex';
    pageInfo.textContent = 'Page ' + page;
    document.getElementById('audit-prev-btn').disabled = page <= 1;
    document.getElementById('audit-next-btn').disabled = !_auditLastPageToken;
  } catch (err) {
    tbody.innerHTML =
      '<tr><td colspan="5" style="color:var(--danger);font-size:12px;">Failed: ' +
      escapeHtml(err.message) +
      '</td></tr>';
  }
}

async function exportInlineAuditCsv() {
  try {
    const token = await _getToken();
    const params = new URLSearchParams();
    const admin = document.getElementById('audit-filter-admin').value.trim();
    const action = document.getElementById('audit-filter-action').value;
    const target = document.getElementById('audit-filter-target').value.trim();
    const from = document.getElementById('audit-filter-from').value;
    const to = document.getElementById('audit-filter-to').value;
    if (admin) params.set('admin', admin);
    if (action) params.set('action', action);
    if (target) params.set('target', target);
    if (from) params.set('from', new Date(from).toISOString());
    if (to) params.set('to', new Date(to).toISOString());

    const res = await fetch(`${_apiBase}/api/admin/audit-log/export?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Export failed: HTTP ' + res.status);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'audit-log-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Audit log exported', 'success');
  } catch (err) {
    showToast('Export failed: ' + err.message, 'error');
  }
}
