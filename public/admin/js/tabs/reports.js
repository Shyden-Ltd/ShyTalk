/**
 * Reports tab — report review with filtering, stats, keyboard shortcuts,
 * review locks, CSV export, and real-time Firestore listener.
 *
 * Extracted from inline script block in index.html.
 */

import { apiCall } from '/js/core/api.js';
import { showToast, showConfirm, escapeHtml } from '/js/core/ui.js';

// -- State ------------------------------------------------------------------

let currentReportFilter = 'pending';
let reportSearchQuery = '';
let reportCards = [];
let selectedCardIndex = -1;
let reportsUnsubscribe = null;
let reportsPollInterval = null;
let currentLockedUid = null;
let resolveInProgress = false;
let allReportUsers = [];
let renderedCount = 0;
const CARDS_PER_PAGE = 20;
let statsPeriod = '7d';

// -- DOM refs ---------------------------------------------------------------

let reportsList;

// -- Dependencies (injected) ------------------------------------------------

let _clientDb = null;
let _collection = null;
let _query = null;
let _where = null;
let _onSnapshot = null;
let _getCurrentTab = () => '';
let _searchUserByUniqueId = () => {};
let _switchTab = () => {};
let _flushNotifications = async () => {};
let _stopMonitoring = () => {};
let _renderEvidence = () => '';
let _openEvidenceLightbox = () => {};
let _gcsClass = () => '';
let _gcsEmoji = () => '';
let _apiBase = '';
let _getToken = () => Promise.resolve(null);
let _getCurrentUser = () => null;
let _getTabReportsEl = () => null;
let _onAuthStateChanged = () => {};
let _auth = null;

// -- Public API -------------------------------------------------------------

/**
 * One-time initialisation.
 *
 * @param deps.clientDb           — Firestore instance (client SDK)
 * @param deps.firestoreFns       — { collection, query, where, onSnapshot }
 * @param deps.getCurrentTab      — returns current tab name
 * @param deps.searchUserByUniqueId — cross-tab navigation helper
 * @param deps.switchTab          — tab switching callback
 * @param deps.flushNotifications — flush pending user-change notifications
 * @param deps.stopMonitoring     — stop real-time monitor listener
 * @param deps.renderEvidence     — shared evidence rendering function
 * @param deps.openEvidenceLightbox — shared lightbox opener
 * @param deps.gcsClass           — GCS score -> CSS class
 * @param deps.gcsEmoji           — GCS score -> emoji
 * @param deps.apiBase            — API base URL (for raw fetch calls)
 * @param deps.getToken           — () => Promise<string> for auth token
 * @param deps.getCurrentUser     — () => Firebase user object
 * @param deps.getTabReportsEl    — () => tab button element (for badge)
 * @param deps.onAuthStateChanged — Firebase auth state listener
 * @param deps.auth               — Firebase auth instance
 */
export function init(deps) {
  _clientDb = deps.clientDb;
  if (deps.firestoreFns) {
    _collection = deps.firestoreFns.collection;
    _query = deps.firestoreFns.query;
    _where = deps.firestoreFns.where;
    _onSnapshot = deps.firestoreFns.onSnapshot;
  }
  _getCurrentTab = deps.getCurrentTab || _getCurrentTab;
  _searchUserByUniqueId = deps.searchUserByUniqueId || _searchUserByUniqueId;
  _switchTab = deps.switchTab || _switchTab;
  _flushNotifications = deps.flushNotifications || _flushNotifications;
  _stopMonitoring = deps.stopMonitoring || _stopMonitoring;
  _renderEvidence = deps.renderEvidence || _renderEvidence;
  _openEvidenceLightbox = deps.openEvidenceLightbox || _openEvidenceLightbox;
  _gcsClass = deps.gcsClass || _gcsClass;
  _gcsEmoji = deps.gcsEmoji || _gcsEmoji;
  _apiBase = deps.apiBase || _apiBase;
  _getToken = deps.getToken || _getToken;
  _getCurrentUser = deps.getCurrentUser || _getCurrentUser;
  _getTabReportsEl = deps.getTabReportsEl || _getTabReportsEl;
  _onAuthStateChanged = deps.onAuthStateChanged || _onAuthStateChanged;
  _auth = deps.auth || _auth;

  reportsList = document.getElementById('reports-list');

  // Restore persisted filter
  const savedFilter = sessionStorage.getItem('admin_report_filter');
  if (savedFilter) currentReportFilter = savedFilter;

  const savedSearch = sessionStorage.getItem('admin_report_search');
  if (savedSearch) reportSearchQuery = savedSearch;

  // Filter buttons
  for (const btn of document.querySelectorAll('#report-filter-bar .tab-btn')) {
    btn.addEventListener('click', () => {
      for (const b of document.querySelectorAll('#report-filter-bar .tab-btn')) b.classList.remove('active');
      btn.classList.add('active');
      void btn.offsetHeight; // Force layout flush for WebKit
      currentReportFilter = btn.dataset.reportFilter;
      sessionStorage.setItem('admin_report_filter', currentReportFilter);
      loadReports();
    });
  }

  // Search
  const reportSearchInput = document.getElementById('report-search-input');
  const reportSearchBtn = document.getElementById('report-search-btn');
  if (reportSearchBtn) {
    reportSearchBtn.addEventListener('click', () => {
      reportSearchQuery = reportSearchInput.value.trim();
      sessionStorage.setItem('admin_report_search', reportSearchQuery);
      loadReports();
    });
  }
  if (reportSearchInput) {
    reportSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        reportSearchQuery = reportSearchInput.value.trim();
        sessionStorage.setItem('admin_report_search', reportSearchQuery);
        loadReports();
      }
    });
  }

  // Stats period toggle
  for (const btn of document.querySelectorAll('.period-toggle button')) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      for (const b of document.querySelectorAll('.period-toggle button')) b.classList.remove('active');
      btn.classList.add('active');
      statsPeriod = btn.dataset.period;
      loadReportStats();
    });
  }

  // CSV Export
  const exportCsvBtn = document.getElementById('export-csv-btn');
  const exportFrom = document.getElementById('export-from');
  const exportTo = document.getElementById('export-to');

  if (exportFrom && exportTo) {
    // Default date range: last 30 days
    const today = new Date();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
    exportTo.value = today.toISOString().split('T')[0];
    exportFrom.value = thirtyDaysAgo.toISOString().split('T')[0];
  }

  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', async () => {
      if (!exportFrom.value || !exportTo.value) {
        showToast('Select a date range', 'error');
        return;
      }
      exportCsvBtn.disabled = true;
      try {
        const token = await _getToken();
        const url = `${_apiBase}/api/reports/export?from=${exportFrom.value}&to=${exportTo.value}`;
        const res = await fetch(url, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!res.ok) {
          let errMsg = `HTTP ${res.status}`;
          try { const data = await res.json(); errMsg = data.error || errMsg; } catch (_) {}
          throw new Error(errMsg);
        }
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `reports_${exportFrom.value}_${exportTo.value}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
        showToast('CSV downloaded');
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        exportCsvBtn.disabled = false;
      }
    });
  }

  // Keyboard shortcuts (Reports tab)
  document.addEventListener('keydown', (e) => {
    if (_getCurrentTab() !== 'reports') return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (reportCards.length > 0) {
        if (selectedCardIndex < reportCards.length - 1) selectedCardIndex++;
        highlightCard();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (selectedCardIndex > 0) selectedCardIndex--;
      highlightCard();
    } else if (selectedCardIndex >= 0 && selectedCardIndex < reportCards.length) {
      const card = reportCards[selectedCardIndex];
      const uid = card.dataset.uid;
      const actionSel = card.querySelector(`[data-action-select="${uid}"]`);
      if (!actionSel) return;

      if (e.key.toLowerCase() === 'w') {
        actionSel.value = 'warn';
        actionSel.dispatchEvent(new Event('change'));
      } else if (e.key.toLowerCase() === 's') {
        actionSel.value = 'suspend';
        actionSel.dispatchEvent(new Event('change'));
      } else if (e.key.toLowerCase() === 'd') {
        actionSel.value = 'dismiss';
        actionSel.dispatchEvent(new Event('change'));
      } else if (e.key === 'Enter') {
        resolveReport(uid, false);
      }
    }
  });

  // Release lock + stop monitoring on page close (best-effort; 5-min expiry covers failure)
  window.addEventListener('beforeunload', () => {
    _stopMonitoring();
    const currentUser = _getCurrentUser();
    if (currentLockedUid && currentUser) {
      const token = currentUser.accessToken || '';
      fetch(`${_apiBase}/api/report-locks/${currentLockedUid}`, {
        method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` }, keepalive: true,
      }).catch(() => {});
    }
  });

  // Start real-time report listener when already authenticated
  // (Piggybacks on existing onAuthStateChanged -- this second listener is additive)
  if (_onAuthStateChanged && _auth) {
    _onAuthStateChanged(_auth, async (user) => {
      if (user) {
        try {
          const tokenResult = await user.getIdTokenResult();
          if (tokenResult.claims.admin === true) {
            startReportListener();
          }
        } catch (_) {}
      } else {
        if (reportsUnsubscribe) { reportsUnsubscribe(); reportsUnsubscribe = null; }
        if (reportsPollInterval) { clearInterval(reportsPollInterval); reportsPollInterval = null; }
      }
    });
  }
}

/** Called every time the Reports tab is activated. */
export function activate() {
  loadReports();
  loadReportStats();
}

/** Called when leaving the Reports tab. */
export function deactivate() {
  if (reportsUnsubscribe) { reportsUnsubscribe(); reportsUnsubscribe = null; }
  if (reportsPollInterval) { clearInterval(reportsPollInterval); reportsPollInterval = null; }
  releaseLock();
}

/** Release any held review lock. Exported for sign-out cleanup. */
export async function releaseLock() {
  if (!currentLockedUid) return;
  try { await apiCall('DELETE', `/api/report-locks/${currentLockedUid}`, null, { skipTabAbort: true }); } catch (_) {}
  currentLockedUid = null;
}

// -- Internal ---------------------------------------------------------------

function updateReportBadge(count) {
  const tabReports = _getTabReportsEl();
  if (!tabReports) return;
  let badge = tabReports.querySelector('.tab-badge');
  if (count > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'tab-badge';
      badge.setAttribute('aria-hidden', 'true');
      tabReports.appendChild(badge);
    }
    badge.textContent = count > 99 ? '99+' : count;
  } else if (badge) {
    badge.remove();
  }
}

async function loadReportStats() {
  try {
    const stats = await apiCall('GET', `/api/reports/stats?period=${statsPeriod}`);
    const el = (id) => document.getElementById(id);
    el('stat-pending').textContent = stats.pendingCount;
    el('stat-resolved-today').textContent = stats.resolvedToday;
    el('stat-avg-response').textContent = stats.avgResponseHours != null ? `${stats.avgResponseHours}h` : '-';
    el('stat-reviewers').textContent = Array.isArray(stats.activeReviewers) ? stats.activeReviewers.length : (stats.activeReviewers || 0);

    // Update tab badge
    updateReportBadge(stats.pendingCount);
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

function startReportListener() {
  if (reportsUnsubscribe) reportsUnsubscribe();
  if (!_clientDb || !_query || !_collection || !_where || !_onSnapshot) return;

  const q = _query(_collection(_clientDb, 'reports'), _where('status', '==', 'pending'));
  reportsUnsubscribe = _onSnapshot(q, (snapshot) => {
    updateReportBadge(snapshot.size);
    // Auto-refresh if on reports tab
    if (_getCurrentTab() === 'reports' && currentReportFilter === 'pending') {
      renderReportsFromSnapshot(snapshot);
    }
  });

  // Polling fallback: on WebKit, the Firestore WebChannel transport
  // may not deliver onSnapshot updates reliably.  Poll the reports
  // API every 5 seconds while the Reports tab is active so new
  // reports always appear within a reasonable window.
  if (reportsPollInterval) clearInterval(reportsPollInterval);
  reportsPollInterval = setInterval(async () => {
    if (_getCurrentTab() !== 'reports') return;
    if (resolveInProgress) return;
    try { await loadReports(); } catch (_) {}
  }, 15000);
}

function renderReportsFromSnapshot(snapshot) {
  // Skip auto-refresh while a resolve operation is in progress to avoid
  // wiping the DOM (and the action form) mid-flow.
  if (resolveInProgress) return;
  // This just triggers a reload via API for full data
  loadReports();
}

async function loadReports() {
  await releaseLock(); // Release any held lock on reload
  // Only show the loading indicator when the list is empty -- preserve
  // existing cards during a refresh so that the UI doesn't flash blank
  // while the API responds.  This also prevents the card count from
  // momentarily dropping to 0 (which confuses realtime-update checks).
  if (!reportsList.querySelector('.report-card')) {
    reportsList.innerHTML = '<div style="color:var(--text2);font-size:13px;">Loading...</div>';
  }
  try {
    let url = `/api/reports?status=${currentReportFilter}`;
    if (reportSearchQuery) url += `&search=${encodeURIComponent(reportSearchQuery)}`;
    const result = await apiCall('GET', url);

    if (result.users.length === 0) {
      reportsList.innerHTML = '<div style="color:var(--text2);font-size:13px;font-style:italic;">No reports found</div>';
      reportCards = [];
      allReportUsers = [];
      renderedCount = 0;
      return;
    }

    reportsList.innerHTML = '';
    reportCards = [];
    allReportUsers = result.users;
    renderedCount = 0;

    // Render first batch
    renderMoreCards();

  } catch (err) {
    if (err.name === 'AbortError') return; // Tab switch -- silently bail
    reportsList.innerHTML = `<div style="color:var(--danger);font-size:13px;">${escapeHtml(err.message)}</div>`;
  }
}

function renderMoreCards() {
  const batch = allReportUsers.slice(renderedCount, renderedCount + CARDS_PER_PAGE);
  if (batch.length === 0) return;

  const currentUser = _getCurrentUser();
  const myUid = currentUser?.uid;

  for (const user of batch) {
    const userId = String(user.uniqueId || user.uid);
    const card = document.createElement('div');
    card.className = 'report-card';
    card.dataset.uid = userId;
    reportCards.push(card);

    const gcsScore = user.gcsDisplayScore ?? 100;

    // Header
    let headerHtml = `<div class="report-card-header">`;
    if (user.profilePhotoUrl) {
      headerHtml += `<img class="report-user-avatar" src="${escapeHtml(user.profilePhotoUrl)}" alt="">`;
    } else {
      headerHtml += `<div class="report-user-avatar" style="display:flex;align-items:center;justify-content:center;font-size:18px;color:var(--text2);">\u{1F464}</div>`;
    }
    headerHtml += `<div class="report-user-info">
      <div class="report-user-name" data-navigate-uid="${escapeHtml(String(user.uniqueId || user.uid))}">${escapeHtml(user.displayName || 'Unknown')}${user.isSuspended ? ' <span style="color:var(--danger);font-size:11px;font-weight:600;background:rgba(231,76,60,0.1);padding:1px 6px;border-radius:4px;">Suspended</span>' : ''}</div>
      <div class="report-user-id">ID: ${escapeHtml(String(user.uniqueId || '?'))} | Warnings: ${escapeHtml(String(user.warningCount || 0))}</div>
    </div>`;
    headerHtml += `<span class="gcs-badge ${_gcsClass(gcsScore)}">${_gcsEmoji(gcsScore)} ${gcsScore}</span>`;
    headerHtml += `<span class="report-count-badge">${user.reportCount} report${user.reportCount !== 1 ? 's' : ''}</span>`;

    // Review lock badge
    if (user.lock && user.lock.adminUid !== myUid) {
      const lockAge = Date.now() - new Date(user.lock.lockedAt).getTime();
      const canTakeover = lockAge > 2 * 60 * 1000;
      headerHtml += `<span class="review-lock-badge">\u{1F512} ${escapeHtml(user.lock.displayName)}`;
      if (canTakeover) {
        headerHtml += ` <button class="takeover-btn" data-takeover-uid="${escapeHtml(userId)}">Take Over</button>`;
      }
      headerHtml += `</span>`;
    }
    headerHtml += `</div>`;

    // Reports list (show max 10, with "Show all")
    const maxShow = 10;
    const reports = user.reports || [];
    let reportsHtml = '<div class="report-list">';
    const toShow = reports.slice(0, maxShow);
    for (const r of toShow) {
      const reporterDisplay = r.reporterName
        ? `${escapeHtml(r.reporterName)} (ID: ${escapeHtml(String(r.reporterUniqueId || '?'))})`
        : 'Unknown reporter';
      reportsHtml += `<div class="report-item">
        <div class="report-item-header">
          <span class="report-item-reporter">${reporterDisplay}</span>
          <span class="report-item-date">${r.timestamp ? escapeHtml(new Date(r.timestamp).toLocaleString()) : ''}</span>
        </div>
        <div class="report-item-type">${escapeHtml(r.reason || 'Unknown')}</div>
        ${r.description ? `<div class="report-item-text">${escapeHtml(r.description)}</div>` : ''}
        ${r.messageText ? `<div class="report-item-context">\u{1F4AC} ${escapeHtml(r.messageText)}</div>` : ''}
        ${_renderEvidence(r.evidenceUrls)}
        ${r.conversationId ? `<div class="console-links">
          <a href="#" class="view-conversation-btn" data-conv-id="${escapeHtml(r.conversationId)}" data-highlight-msg="${escapeHtml(r.messageId || '')}">View Conversation</a>
        </div>` : ''}
      </div>`;
    }
    if (reports.length > maxShow) {
      reportsHtml += `<button class="show-all-btn" data-show-all="${escapeHtml(userId)}">Show all ${reports.length} reports</button>`;
    }
    reportsHtml += '</div>';

    // Action form (only for pending)
    let actionHtml = '';
    if (currentReportFilter === 'pending') {
      const safeUid = escapeHtml(userId);
      actionHtml = `<div class="report-action-form" data-form-uid="${safeUid}">
        <div class="action-row">
          <label>Action</label>
          <select data-action-select="${safeUid}">
            <option value="warn">Warn <span class="shortcut-hint">[W]</span></option>
            <option value="suspend">Suspend <span class="shortcut-hint">[S]</span></option>
            <option value="dismiss">Dismiss <span class="shortcut-hint">[D]</span></option>
          </select>
        </div>
        <div class="action-row" data-severity-row="${safeUid}">
          <label>Severity</label>
          <div class="severity-radio">
            ${[1,2,3,4,5].map((n) => `<input type="radio" name="sev-${safeUid}" id="sev-${safeUid}-${n}" value="${n}" ${n===1?'checked':''}><label for="sev-${safeUid}-${n}">${n} (-${n*5})</label>`).join('')}
          </div>
        </div>
        <div class="suspension-fields" data-suspension-fields="${safeUid}">
          <label>Duration</label>
          <select data-suspension-days="${safeUid}">
            <option value="1">1 Day</option>
            <option value="3">3 Days</option>
            <option value="7" selected>7 Days</option>
            <option value="30">30 Days</option>
            <option value="0">Permanent</option>
          </select>
          <label style="min-width:auto;"><input type="checkbox" data-can-appeal="${safeUid}"> Can Appeal</label>
        </div>
        <div class="action-row">
          <label>Note</label>
          <textarea data-admin-note="${safeUid}" placeholder="Admin note (optional)"></textarea>
        </div>
        <div class="resolve-buttons">
          <button class="btn-resolve" data-resolve-first="${safeUid}">Resolve Latest</button>
          <button class="btn-resolve-all" data-resolve-all="${safeUid}">Resolve All (${user.reportCount})</button>
        </div>
      </div>`;
    }

    // Disable action form if locked by another admin
    const isLockedByOther = user.lock && user.lock.adminUid !== myUid;
    if (isLockedByOther) {
      actionHtml = actionHtml.replace('class="report-action-form"', 'class="report-action-form locked-form" style="opacity:0.5;pointer-events:none;"');
    }

    card.innerHTML = headerHtml + reportsHtml + actionHtml;
    reportsList.appendChild(card);
  }

  renderedCount += batch.length;

  // Add or update infinite scroll sentinel
  let sentinel = reportsList.querySelector('.scroll-sentinel');
  if (sentinel) sentinel.remove();
  if (renderedCount < allReportUsers.length) {
    sentinel = document.createElement('div');
    sentinel.className = 'scroll-sentinel';
    sentinel.style.height = '1px';
    reportsList.appendChild(sentinel);
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        observer.disconnect();
        renderMoreCards();
      }
    }, { rootMargin: '200px' });
    observer.observe(sentinel);
  }

  // Wire up newly rendered cards
  wireUpReportCards();
}

function wireUpReportCards() {
  // Wire up action select to show/hide severity and suspension fields
  for (const sel of reportsList.querySelectorAll('[data-action-select]:not([data-wired])')) {
    sel.dataset.wired = '1';
    const uid = sel.dataset.actionSelect;
    sel.addEventListener('change', () => {
      const sevRow = reportsList.querySelector(`[data-severity-row="${uid}"]`);
      const susFields = reportsList.querySelector(`[data-suspension-fields="${uid}"]`);
      sevRow.style.display = sel.value === 'dismiss' ? 'none' : '';
      susFields.classList.toggle('visible', sel.value === 'suspend');
    });
  }

  // Wire up cross-tab navigation (click user name -> Users tab)
  for (const el of reportsList.querySelectorAll('[data-navigate-uid]:not([data-wired])')) {
    el.dataset.wired = '1';
    el.addEventListener('click', async () => {
      const uniqueId = el.dataset.navigateUid;
      await _flushNotifications();
      _switchTab('users');
      try {
        await _searchUserByUniqueId(uniqueId);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // Wire up resolve buttons (acquire lock first)
  for (const btn of reportsList.querySelectorAll('[data-resolve-first]:not([data-wired])')) {
    btn.dataset.wired = '1';
    btn.addEventListener('click', async () => {
      const uid = btn.dataset.resolveFirst;
      resolveInProgress = true;
      try {
        if (await acquireLock(uid)) await resolveReport(uid, false);
      } finally { resolveInProgress = false; }
    });
  }
  for (const btn of reportsList.querySelectorAll('[data-resolve-all]:not([data-wired])')) {
    btn.dataset.wired = '1';
    btn.addEventListener('click', async () => {
      const uid = btn.dataset.resolveAll;
      resolveInProgress = true;
      try {
        if (await acquireLock(uid)) await resolveReport(uid, true);
      } finally { resolveInProgress = false; }
    });
  }

  // Wire up takeover buttons
  for (const btn of reportsList.querySelectorAll('.takeover-btn:not([data-wired])')) {
    btn.dataset.wired = '1';
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const uid = btn.dataset.takeoverUid;
      try {
        // Force-acquire lock by calling the endpoint (it allows takeover after 2 min)
        await apiCall('DELETE', `/api/report-locks/${uid}`);
        const ok = await acquireLock(uid);
        if (ok) {
          showToast('Review taken over');
          loadReports();
        }
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // Wire up inline conversation viewer
  for (const link of reportsList.querySelectorAll('.view-conversation-btn:not([data-wired])')) {
    link.dataset.wired = '1';
    link.addEventListener('click', async (e) => {
      e.preventDefault();
      const convId = link.dataset.convId;
      const highlightMsgId = link.dataset.highlightMsg;
      const parent = link.closest('.report-item');
      const existing = parent.querySelector('.conv-viewer');
      if (existing) { existing.remove(); return; }
      const viewer = document.createElement('div');
      viewer.className = 'conv-viewer';
      viewer.innerHTML = '<div class="conv-viewer-loading">Loading messages...</div>';
      parent.appendChild(viewer);
      try {
        const result = await apiCall('GET', `/api/conversations/${convId}/messages?limit=50`);
        const msgs = result.messages || [];
        if (msgs.length === 0) {
          viewer.innerHTML = '<div class="conv-viewer-loading">No messages found</div>';
          return;
        }
        let html = '';
        for (const m of msgs) {
          const isHighlighted = m.messageId === highlightMsgId;
          const highlightClass = isHighlighted ? ' highlighted' : '';
          const time = m.timestamp ? escapeHtml(new Date(m.timestamp).toLocaleString()) : '';
          let contentHtml = '';
          if (m.type === 'IMAGE' && m.imageUrls && m.imageUrls.length > 0) {
            contentHtml = m.imageUrls.map(url => `<img class="conv-msg-image" src="${escapeHtml(url)}" alt="Message image" onclick="window.open(this.src,'_blank')">`).join('');
          } else if (m.type === 'STICKER' && m.stickerUrl) {
            contentHtml = `<img class="conv-msg-sticker" src="${escapeHtml(m.stickerUrl)}" alt="Sticker">`;
          } else if (m.type === 'ROOM_INVITE') {
            contentHtml = `<span class="conv-msg-type-badge">[Room Invite]</span>`;
          } else if (m.text === '[Message recalled]') {
            contentHtml = `<span class="conv-msg-type-badge">[Message recalled]</span>`;
          } else {
            contentHtml = `<div class="conv-msg-text">${escapeHtml(m.text || '')}</div>`;
          }
          html += `<div class="conv-msg conv-msg-left${highlightClass}">
            <div class="conv-msg-sender">${escapeHtml(m.senderName || m.senderId || 'Unknown')}</div>
            ${contentHtml}
            <div class="conv-msg-time">${time}</div>
          </div>`;
        }
        viewer.innerHTML = html;
        if (highlightMsgId) {
          const highlighted = viewer.querySelector('.highlighted');
          if (highlighted) highlighted.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      } catch (err) {
        viewer.innerHTML = `<div class="conv-viewer-loading" style="color:var(--danger);">Failed to load: ${escapeHtml(err.message)}</div>`;
      }
    });
  }

  // Wire up evidence thumbnail clicks
  for (const thumb of reportsList.querySelectorAll('.evidence-thumb:not([data-wired])')) {
    thumb.dataset.wired = '1';
    thumb.addEventListener('click', () => {
      _openEvidenceLightbox(thumb.dataset.evidenceUrl, thumb.dataset.evidenceType);
    });
  }
}

// -- Review Lock Functions --------------------------------------------------

async function acquireLock(uid) {
  if (currentLockedUid === uid) return true;
  if (currentLockedUid) await releaseLock();
  try {
    const result = await apiCall('POST', `/api/report-locks/${uid}/lock`);
    if (result.locked) {
      showToast(`Being reviewed by ${result.lockedBy}`, 'error');
      return false;
    }
    currentLockedUid = uid;
    return true;
  } catch (err) {
    console.error('Failed to acquire lock:', err);
    return false;
  }
}

// -- Resolve Report ---------------------------------------------------------

async function resolveReport(reportedUserId, resolveAll) {
  const form = reportsList.querySelector(`[data-form-uid="${reportedUserId}"]`);
  if (!form) return;

  const action = form.querySelector(`[data-action-select="${reportedUserId}"]`).value;
  const sevInput = form.querySelector(`input[name="sev-${reportedUserId}"]:checked`);
  const severity = sevInput ? Number(sevInput.value) : 1;
  const adminNote = form.querySelector(`[data-admin-note="${reportedUserId}"]`).value.trim();
  const suspensionDaysEl = form.querySelector(`[data-suspension-days="${reportedUserId}"]`);
  const suspensionDays = action === 'suspend' ? Number(suspensionDaysEl.value) : undefined;
  const canAppealEl = form.querySelector(`[data-can-appeal="${reportedUserId}"]`);
  const canAppeal = action === 'suspend' ? canAppealEl.checked : undefined;

  const actionLabel = { warn: 'Warn', suspend: 'Suspend', dismiss: 'Dismiss' }[action];
  const confirmed = await showConfirm(
    'Confirm Action',
    `${resolveAll ? 'Resolve ALL pending reports' : 'Resolve latest report'} for this user with action: ${actionLabel}${action !== 'dismiss' ? ` (Severity ${severity}, -${severity*5} GCS)` : ''}?`
  );
  if (!confirmed) return;

  try {
    // Fetch pending reports to get the correct Firebase Auth UID and report IDs
    const reportsData = await apiCall('GET', `/api/reports?status=pending`);
    const userReports = reportsData.users.find((u) => String(u.uniqueId || u.uid) === String(reportedUserId));
    if (!userReports || userReports.reports.length === 0) {
      showToast('No pending reports found', 'error');
      return;
    }

    let result;
    if (resolveAll) {
      // resolve-all endpoint expects the Firebase Auth UID (reportedUserId), not the uniqueId
      result = await apiCall('POST', `/api/reports/resolve-all/${userReports.reportedUserId}`, {
        action, severity: action !== 'dismiss' ? severity : undefined, adminNote,
        suspensionDays, canAppeal,
      });
    } else {
      const reportId = userReports.reports[0].id;
      result = await apiCall('POST', `/api/reports/${reportId}/resolve`, {
        action, severity: action !== 'dismiss' ? severity : undefined, adminNote,
        suspensionDays, canAppeal,
      });
    }

    // Partial-failure contract — see public/admin/js/lib/partial-failure-toast.js
    // for the full key list and ordering rationale. Extracted to a shared lib so
    // it's testable AND reusable by future admin consumers (bulk-warn, etc.).
    const partialMessage = window.PartialFailureToast.buildPartialFailureMessage(result);
    if (partialMessage) {
      showToast(partialMessage, 'error');
    } else {
      showToast(`Report${resolveAll ? 's' : ''} resolved: ${actionLabel}`);
    }

    if (result.autoEscalateSuggested) {
      showToast('This user has 5+ warnings. Consider suspending.', 'error');
    }

    // Release review lock after resolving
    await releaseLock();

    loadReports();
    loadReportStats();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// -- Keyboard Navigation Helper ---------------------------------------------

function highlightCard() {
  for (const c of reportCards) c.classList.remove('selected');
  if (selectedCardIndex >= 0 && selectedCardIndex < reportCards.length) {
    reportCards[selectedCardIndex].classList.add('selected');
    reportCards[selectedCardIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}
