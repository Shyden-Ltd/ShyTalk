/**
 * Suggestions tab -- suggestion review, disputes, bulk actions, timelines.
 *
 * Extracted from inline script block in index.html.
 */

import { apiCall } from '/js/core/api.js';
import { showToast, showConfirm, escapeHtml } from '/js/core/ui.js';

// ── Helpers ───────────────────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);

// ── State ─────────────────────────────────────────────────────────

let suggestionsFilterState = {
  statusTab: 'pending',
  submitterFilter: '',
  sortBy: 'newest',
  cached: [],
};

let completeSuggestionId = null;
let overturnSuggestionId = null;
let roadmapLinkSuggestionId = null;

// ── Dependencies ──────────────────────────────────────────────────

let _searchUserByUniqueId = () => {};
let _switchTab = () => {};
let _currentTab = () => 'users';

// ── Public API ────────────────────────────────────────────────────

/**
 * @param deps.searchUserByUniqueId -- navigate to Users tab and search by unique ID
 * @param deps.switchTab            -- switch the active admin tab
 * @param deps.currentTab           -- getter for the current tab name
 */
export function init(deps) {
  _searchUserByUniqueId = deps.searchUserByUniqueId || _searchUserByUniqueId;
  _switchTab = deps.switchTab || _switchTab;
  _currentTab = deps.currentTab || _currentTab;

  // ── Status tab switching (pending / accepted / planned / completed / rejected / disputed) ──
  document.querySelectorAll('.sg-status-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const status = btn.dataset.status;
      suggestionsFilterState.statusTab = status === 'disputed' ? 'disputed' : status;
      document.querySelectorAll('.sg-status-tab').forEach((b) => {
        b.classList.toggle('active', b === btn);
        if (b === btn) {
          b.style.background = 'var(--accent)';
          b.style.color = '#fff';
          b.style.border = 'none';
        } else {
          b.style.background = 'var(--surface2)';
          b.style.color = 'var(--text)';
          b.style.border = '1px solid var(--border)';
        }
      });
      if (status === 'disputed') {
        // Show dispute queue instead
        $('#suggestions-pending-queue').style.display = 'none';
        $('#suggestions-dispute-queue').style.display = 'block';
      } else {
        $('#suggestions-pending-queue').style.display = 'block';
        $('#suggestions-dispute-queue').style.display = 'none';
        renderSuggestionsForCurrentTab();
      }
    });
  });

  // ── Filter + sort ──
  const filterBtn = document.getElementById('suggestions-filter-btn');
  if (filterBtn) filterBtn.addEventListener('click', () => {
    suggestionsFilterState.submitterFilter = document.getElementById('suggestions-filter-submitter').value;
    suggestionsFilterState.sortBy = document.getElementById('suggestions-sort-select').value;
    renderSuggestionsForCurrentTab();
  });
  const sortSelect = document.getElementById('suggestions-sort-select');
  if (sortSelect) sortSelect.addEventListener('change', () => {
    suggestionsFilterState.sortBy = sortSelect.value;
    renderSuggestionsForCurrentTab();
  });

  // ── Select All (canonical + legacy aliases) ──
  const selectAll = document.getElementById('suggestions-select-all');
  if (selectAll) selectAll.addEventListener('change', (e) => {
    const checked = e.target.checked;
    document.querySelectorAll('#suggestions-pending-queue .sg-checkbox').forEach((cb) => {
      cb.checked = checked;
    });
  });

  // ── Bulk approve -- opens confirmation dialog, then approves all selected ──
  const bulkApproveBtn = document.getElementById('suggestions-bulk-approve-btn');
  if (bulkApproveBtn) bulkApproveBtn.addEventListener('click', () => {
    const selected = [...document.querySelectorAll('#suggestions-pending-queue .sg-checkbox:checked')].map((cb) => cb.dataset.sgId);
    if (selected.length === 0) { showToast('No suggestions selected', 'error'); return; }
    const dialog = document.getElementById('suggestions-bulk-confirm-dialog');
    document.getElementById('bulk-confirm-message').textContent = 'Approve ' + selected.length + ' suggestion(s)?';
    dialog.style.display = 'flex';
    dialog.dataset.action = 'approve';
    dialog.dataset.ids = JSON.stringify(selected);
  });

  // ── Bulk reject -- opens reject dialog with reason input ──
  const bulkRejectBtn = document.getElementById('suggestions-bulk-reject-btn');
  if (bulkRejectBtn) bulkRejectBtn.addEventListener('click', () => {
    const selected = [...document.querySelectorAll('#suggestions-pending-queue .sg-checkbox:checked')].map((cb) => cb.dataset.sgId);
    if (selected.length === 0) { showToast('No suggestions selected', 'error'); return; }
    const dialog = document.getElementById('suggestions-bulk-reject-dialog');
    dialog.style.display = 'flex';
    dialog.dataset.ids = JSON.stringify(selected);
  });

  // Bulk handler — runs each id's primary endpoint, falls back to the
  // legacy PUT /status endpoint, and reports per-id success/failure.
  // Uses Promise.allSettled so a single failure does not mask the
  // outcome of the other ids (Promise.all would reject on the first
  // failure and showToast(`Approved N`) on the success path was firing
  // even when some/all ids individually failed both endpoints).
  async function runBulkSuggestionAction({ ids, primary, fallback, verb }) {
    const settled = await Promise.allSettled(ids.map(async (id) => {
      try { return await primary(id); } catch (_) { return await fallback(id); }
    }));
    const failed = [];
    settled.forEach((r, i) => { if (r.status === 'rejected') failed.push({ id: ids[i], error: r.reason?.message || String(r.reason) }); });
    if (failed.length === 0) {
      showToast(`${verb} ${ids.length} suggestion(s)`, 'success');
    } else if (failed.length === ids.length) {
      showToast(`${verb} failed for all ${ids.length} suggestion(s): ${failed[0].error}`, 'error');
    } else {
      const sample = failed.slice(0, 3).map((f) => f.id).join(', ');
      const more = failed.length > 3 ? ` (+${failed.length - 3} more)` : '';
      showToast(`${verb} ${ids.length - failed.length} of ${ids.length} — failed: ${sample}${more}`, 'error');
    }
    loadSuggestions();
  }

  // ── Confirm bulk action ──
  document.querySelector('#suggestions-bulk-confirm-dialog .btn-confirm-bulk').addEventListener('click', async () => {
    const dialog = document.getElementById('suggestions-bulk-confirm-dialog');
    const ids = JSON.parse(dialog.dataset.ids || '[]');
    dialog.style.display = 'none';
    await runBulkSuggestionAction({
      ids,
      verb: 'Approved',
      primary: (id) => apiCall('POST', `/api/admin/suggestions/${id}/approve`),
      fallback: (id) => apiCall('PUT', `/api/admin/suggestions/${id}/status`, { status: 'accepted' }),
    });
  });
  document.querySelector('#suggestions-bulk-confirm-dialog .btn-cancel-bulk').addEventListener('click', () => {
    document.getElementById('suggestions-bulk-confirm-dialog').style.display = 'none';
  });

  // ── Confirm bulk reject ──
  document.querySelector('#suggestions-bulk-reject-dialog .btn-confirm-bulk-reject').addEventListener('click', async () => {
    const dialog = document.getElementById('suggestions-bulk-reject-dialog');
    const ids = JSON.parse(dialog.dataset.ids || '[]');
    const reason = document.getElementById('bulk-reject-reason').value || '';
    dialog.style.display = 'none';
    await runBulkSuggestionAction({
      ids,
      verb: 'Rejected',
      primary: (id) => apiCall('POST', `/api/admin/suggestions/${id}/reject`, { reason }),
      fallback: (id) => apiCall('PUT', `/api/admin/suggestions/${id}/status`, { status: 'rejected', reason }),
    });
  });
  document.querySelector('#suggestions-bulk-reject-dialog .btn-cancel-bulk-reject').addEventListener('click', () => {
    document.getElementById('suggestions-bulk-reject-dialog').style.display = 'none';
  });

  // ── Per-suggestion reject dialog ──
  const rejectDialogConfirm = document.querySelector('#suggestion-reject-dialog .btn-confirm-reject');
  if (rejectDialogConfirm) rejectDialogConfirm.addEventListener('click', async () => {
    const dialog = document.getElementById('suggestion-reject-dialog');
    const suggestionId = dialog.dataset.suggestionId;
    const reason = document.getElementById('reject-reason-input').value.trim();
    const warning = dialog.querySelector('.reject-warning');
    // First click without a reason: show the warning and wait for confirmation.
    if (!reason && dialog.dataset.warningShown !== 'true') {
      if (warning) warning.style.display = 'block';
      dialog.dataset.warningShown = 'true';
      return;
    }
    dialog.style.display = 'none';
    try {
      await apiCall('POST', `/api/admin/suggestions/${suggestionId}/reject`, { reason });
      showToast('Suggestion rejected', 'success');
      loadSuggestions();
    } catch (err) {
      showToast('Reject failed: ' + err.message, 'error');
    }
  });
  const rejectDialogCancel = document.querySelector('#suggestion-reject-dialog .btn-cancel-reject');
  if (rejectDialogCancel) rejectDialogCancel.addEventListener('click', () => {
    document.getElementById('suggestion-reject-dialog').style.display = 'none';
  });

  // ── Complete dialog ──
  document.querySelector('#suggestion-complete-dialog .btn-confirm-complete').addEventListener('click', async () => {
    if (!completeSuggestionId) return;
    try {
      const result = await apiCall('PUT', `/api/admin/suggestions/${completeSuggestionId}/status`, { status: 'completed' });
      window.PartialFailureToast?.showResultToast(showToast, result, 'Suggestion marked as completed');
      document.getElementById('suggestion-complete-dialog').style.display = 'none';
      completeSuggestionId = null;
      loadSuggestions();
    } catch (err) { showToast(err.message, 'error'); }
  });
  document.querySelector('#suggestion-complete-dialog .btn-cancel-complete').addEventListener('click', () => {
    document.getElementById('suggestion-complete-dialog').style.display = 'none';
    completeSuggestionId = null;
  });

  // ── Overturn dialog ──
  document.querySelector('#suggestion-overturn-dialog .btn-confirm-overturn').addEventListener('click', async () => {
    if (!overturnSuggestionId) return;
    const targetStatus = document.getElementById('overturn-target-status').value;
    const reason = document.getElementById('overturn-reason-input').value.trim();
    try {
      await apiCall('POST', `/api/admin/suggestions/${overturnSuggestionId}/overturn`, { targetStatus, reason: reason || undefined });
      showToast('Suggestion overturned to ' + targetStatus, 'success');
      document.getElementById('suggestion-overturn-dialog').style.display = 'none';
      document.getElementById('overturn-reason-input').value = '';
      overturnSuggestionId = null;
      loadSuggestions();
    } catch (err) { showToast(err.message, 'error'); }
  });
  document.querySelector('#suggestion-overturn-dialog .btn-cancel-overturn').addEventListener('click', () => {
    document.getElementById('suggestion-overturn-dialog').style.display = 'none';
    overturnSuggestionId = null;
  });

  // ── Roadmap link dialog ──
  document.getElementById('roadmap-link-confirm').addEventListener('click', async () => {
    const dropdown = document.getElementById('roadmap-link-dropdown');
    const featureId = dropdown.value;
    if (!featureId || !roadmapLinkSuggestionId) { showToast('Select a feature first', 'error'); return; }
    try {
      await apiCall('PUT', `/api/admin/suggestions/${roadmapLinkSuggestionId}/link`, { roadmapFeatureId: featureId });
      showToast('Suggestion linked to roadmap', 'success');
      document.getElementById('roadmap-link-dialog').style.display = 'none';
      roadmapLinkSuggestionId = null;
      loadSuggestions();
    } catch (err) { showToast(err.message, 'error'); }
  });
  document.getElementById('roadmap-link-cancel').addEventListener('click', () => {
    document.getElementById('roadmap-link-dialog').style.display = 'none';
    roadmapLinkSuggestionId = null;
  });

  // ── Per-suggestion merge dialog ──
  const mergeSearchBtn = document.getElementById('merge-search-btn');
  if (mergeSearchBtn) mergeSearchBtn.addEventListener('click', async () => {
    const query = document.getElementById('merge-search-input').value.trim();
    const resultsList = document.getElementById('merge-results-list');
    resultsList.innerHTML = '<div style="color:var(--text2);font-size:12px;">Searching\u2026</div>';
    try {
      const data = await apiCall('GET', '/api/admin/suggestions?q=' + encodeURIComponent(query));
      const matches = (data.suggestions || []).filter((s) =>
        (s.title || '').toLowerCase().includes(query.toLowerCase()),
      );
      resultsList.innerHTML = '';
      if (matches.length === 0) {
        resultsList.innerHTML = '<div style="color:var(--text2);font-size:12px;">No matches.</div>';
        return;
      }
      matches.forEach((m) => {
        const row = document.createElement('div');
        row.className = 'merge-result';
        row.dataset.id = m.id;
        row.style.cssText = 'padding:10px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:13px;';
        row.innerHTML = '<div style="font-weight:600;">' + escapeHtml(m.title || '(no title)') + '</div>' +
          '<div style="color:var(--text2);font-size:11px;">' + escapeHtml(m.status || '') + ' \u2014 ' + escapeHtml(m.id) + '</div>';
        row.addEventListener('click', () => {
          document.querySelectorAll('#merge-results-list .merge-result').forEach((r) => {
            r.style.background = 'var(--surface2)';
          });
          row.style.background = 'var(--accent)';
          const dialog = document.getElementById('suggestion-merge-dialog');
          dialog.dataset.targetId = m.id;
          const confirmBtn = dialog.querySelector('.btn-confirm-merge');
          confirmBtn.disabled = false;
          confirmBtn.style.opacity = '1';
        });
        resultsList.appendChild(row);
      });
    } catch (err) {
      resultsList.innerHTML = '<div style="color:var(--danger);font-size:12px;">Search failed: ' + escapeHtml(err.message) + '</div>';
    }
  });
  const mergeConfirm = document.querySelector('#suggestion-merge-dialog .btn-confirm-merge');
  if (mergeConfirm) mergeConfirm.addEventListener('click', async () => {
    const dialog = document.getElementById('suggestion-merge-dialog');
    const suggestionId = dialog.dataset.suggestionId;
    const targetId = dialog.dataset.targetId;
    if (!targetId) return;
    dialog.style.display = 'none';
    try {
      await apiCall('POST', `/api/admin/suggestions/${suggestionId}/merge`, { targetId });
      showToast('Suggestion merged', 'success');
      loadSuggestions();
    } catch (err) {
      showToast('Merge failed: ' + err.message, 'error');
    }
  });
  const mergeCancel = document.querySelector('#suggestion-merge-dialog .btn-cancel-merge');
  if (mergeCancel) mergeCancel.addEventListener('click', () => {
    document.getElementById('suggestion-merge-dialog').style.display = 'none';
  });
}

export function activate() {
  loadSuggestions();
  // Clear the badge when the admin views the Suggestions tab
  const badge = $('#suggestions-badge');
  if (badge) badge.style.display = 'none';
}

export function deactivate() {}

// ── Exported utilities ────────────────────────────────────────────

/**
 * Updates the Suggestions tab badge on page load without requiring the
 * admin to navigate to the Suggestions tab. Called from onAuthStateChanged
 * after the dashboard is shown.
 */
export async function updateSuggestionsBadgeOnLoad() {
  const badge = document.getElementById('suggestions-badge');
  if (!badge) return;
  try {
    const data = await apiCall('GET', '/api/admin/suggestions?status=pending');
    // Prefer the backend's total field (authoritative count after
    // server-side filter). Fall back to client-side count from the
    // returned array for mocked responses that don't set total.
    const list = (data.suggestions || []).filter((s) => s.status === 'pending');
    const pendingCount = typeof data.total === 'number' ? data.total : list.length;
    if (pendingCount > 0) {
      badge.textContent = String(pendingCount);
      badge.style.display = 'inline-block';
    } else {
      badge.textContent = '0';
      badge.style.display = 'none';
    }
  } catch {
    // Silently ignore -- badge will be updated when the user visits the tab
  }
}

// ── Internal ──────────────────────────────────────────────────────

async function loadSuggestions() {
  // Exposed globally so Playwright tests can trigger a refresh without
  // expensive tab switches or page reloads.
  window.loadSuggestions = loadSuggestions;
  const pendingList = $('#suggestions-pending-queue');
  const disputeList = $('#suggestions-dispute-queue');
  const pendingEmpty = $('#sg-pending-empty');
  const disputeEmpty = $('#sg-dispute-empty');
  const pendingCount = $('#sg-pending-count');
  const disputeCount = $('#sg-dispute-count');
  const badge = $('#suggestions-badge');

  pendingList.innerHTML = '<div style="color:var(--text2);font-size:12px;">Loading suggestions...</div>';
  disputeList.innerHTML = '<div style="color:var(--text2);font-size:12px;">Loading disputes...</div>';

  try {
    const [suggestionsData, disputesData] = await Promise.all([
      apiCall('GET', '/api/admin/suggestions'),
      apiCall('GET', '/api/admin/suggestions/disputes'),
    ]);

    const suggestions = suggestionsData.suggestions || [];
    suggestionsFilterState.cached = suggestions;
    const pending = suggestions.filter(s => s.status === 'pending');
    const disputes = disputesData.disputes || [];

    pendingCount.textContent = pending.length + ' Pending';
    disputeCount.textContent = disputes.length + ' Disputes';

    // Update notification badge -- visible if ANY pending suggestion exists,
    // but cleared once the admin has viewed the Suggestions tab (since the
    // badge represents unseen pending work). When loadSuggestions runs
    // because the user clicked the tab, currentTab === "suggestions" and
    // we keep the badge hidden even if pending > 0.
    if (badge) {
      const currentTab = typeof _currentTab === 'function' ? _currentTab() : _currentTab;
      if (currentTab === 'suggestions') {
        badge.style.display = 'none';
      } else if (pending.length > 0) {
        badge.textContent = String(pending.length);
        badge.style.display = 'inline-block';
      } else {
        badge.style.display = 'none';
      }
    }

    // Dispute badge on dispute tab
    const disputeBadge = $('#dispute-badge');
    if (disputeBadge) {
      if (disputes.length > 0) {
        disputeBadge.textContent = String(disputes.length);
        disputeBadge.style.display = 'inline-block';
      } else {
        disputeBadge.style.display = 'none';
      }
    }

    // Render the current status tab's suggestions
    renderSuggestionsForCurrentTab();

    // Render disputes
    disputeList.textContent = '';
    if (disputes.length === 0) {
      disputeEmpty.style.display = 'block';
    } else {
      disputeEmpty.style.display = 'none';
      disputes.forEach(d => {
        disputeList.appendChild(renderDisputeCard(d));
      });
    }

    // Load legacy inline audit log if the section exists (backward compat)
    if (typeof loadAuditLog === 'function') loadAuditLog(1);
  } catch (err) {
    pendingList.innerHTML = '<div style="color:var(--danger);font-size:12px;">Failed to load: ' + escapeHtml(err.message) + '</div>';
    disputeList.innerHTML = '<div style="color:var(--danger);font-size:12px;">Failed to load</div>';
  }
}

// Re-render the pending queue from cached data based on the current tab + filters.
// Cheap to re-run -- does not hit the API.
function renderSuggestionsForCurrentTab() {
  const pendingList = $('#suggestions-pending-queue');
  const pendingEmpty = $('#sg-pending-empty');
  if (!pendingList) return;

  const status = suggestionsFilterState.statusTab;
  const submitterFilter = (suggestionsFilterState.submitterFilter || '').trim();
  let filtered = (suggestionsFilterState.cached || []).filter(s => s.status === status);
  if (submitterFilter) {
    filtered = filtered.filter(s =>
      String(s.submitterUniqueId || s.submitterUid || s.submitterId || '').includes(submitterFilter),
    );
  }

  // Sort
  if (suggestionsFilterState.sortBy === 'oldest') {
    filtered.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  } else if (suggestionsFilterState.sortBy === 'votes') {
    filtered.sort((a, b) => (b.voteCount || 0) - (a.voteCount || 0));
  } else {
    filtered.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  pendingList.textContent = '';
  if (filtered.length === 0) {
    pendingEmpty.style.display = 'block';
    // Also inject the empty message text into the queue element so
    // waitForPendingQueueLoaded (which reads queue.textContent for
    // the "No pending" / "empty" substring) detects the empty state
    // even though the sibling #sg-pending-empty div lives outside
    // #suggestions-pending-queue.
    const emptyText = document.createElement('div');
    emptyText.style.cssText = 'color:var(--text2);font-size:13px;font-style:italic;padding:12px;';
    emptyText.textContent = 'No pending suggestions (empty).';
    pendingList.appendChild(emptyText);
  } else {
    pendingEmpty.style.display = 'none';
    filtered.forEach(sg => {
      pendingList.appendChild(renderSuggestionCard(sg));
    });
  }
}

function renderSuggestionCard(sg) {
  const card = document.createElement('div');
  card.className = 'suggestion-card';
  card.dataset.id = sg.id;

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'sg-checkbox';
  cb.dataset.sgId = sg.id;
  card.appendChild(cb);

  const body = document.createElement('div');
  body.className = 'sg-body';

  const title = document.createElement('div');
  title.className = 'sg-title';
  title.textContent = sg.title || '(No title)';
  body.appendChild(title);

  const desc = document.createElement('div');
  desc.className = 'sg-desc';
  desc.textContent = sg.description || '';
  desc.title = sg.description || '';
  body.appendChild(desc);

  const meta = document.createElement('div');
  meta.className = 'sg-meta';
  const hasContactOptIn = sg.contactOptIn || sg.submitterContactOptIn;
  // Show the canonical numeric uniqueId when available so admins and
  // automated tests can filter/search by the same ID format that's shown.
  const submitterLabel = sg.submitterUniqueId || sg.submitterId || sg.submitterUid || 'Unknown';
  meta.innerHTML = '<span>By: <a href="#" class="submitter-identity-link" data-uid="' + escapeHtml(String(submitterLabel)) + '" style="color:var(--accent);text-decoration:underline;cursor:pointer;">' + escapeHtml(String(submitterLabel)) + '</a></span>' +
    '<span>' + (sg.createdAt ? new Date(sg.createdAt).toLocaleString() : 'Unknown date') + '</span>' +
    (hasContactOptIn
      ? '<span class="sg-contact contact-opt-in-indicator">Open to contact</span>'
      : '<span class="sg-no-contact contact-opt-in-indicator contact-opt-in-indicator--none">No contact</span>');
  // Identity link click handler -- navigates to Users > Identity tab for this submitter
  const identityLink = meta.querySelector('.submitter-identity-link');
  if (identityLink) {
    identityLink.addEventListener('click', async (e) => {
      e.preventDefault();
      const uid = identityLink.dataset.uid;
      _switchTab('users');
      await _searchUserByUniqueId(uid);
      const identitySubtab = document.querySelector('.user-subtab[data-subtab="identity"]');
      if (identitySubtab) identitySubtab.click();
    });
  }
  body.appendChild(meta);

  // Contact submitter button -- always rendered, disabled when submitter did not opt in.
  // Clicking the enabled button reveals a single shared popup (see
  // #submitter-contact-info below the suggestions panel) with the
  // submitter's uniqueId so the admin can look them up in the Users tab.
  // The popup is shared (not per-card) to keep the DOM unique-id-safe and
  // to satisfy Playwright strict mode when asserting visibility.
  const contactBtn = document.createElement('button');
  contactBtn.className = 'btn-contact-submitter sg-btn-contact';
  contactBtn.textContent = 'Contact Submitter';
  contactBtn.style.cssText = 'font-size:12px;padding:4px 10px;background:var(--accent);color:#fff;border:none;border-radius:4px;cursor:pointer;margin-top:4px;';
  if (!hasContactOptIn) {
    contactBtn.disabled = true;
    contactBtn.style.opacity = '0.5';
    contactBtn.style.cursor = 'not-allowed';
    contactBtn.title = 'Submitter did not opt in to admin contact';
  }
  contactBtn.addEventListener('click', () => {
    if (contactBtn.disabled) return;
    const uid = sg.submitterUniqueId || sg.submitterId || 'Unknown';
    const popup = document.getElementById('submitter-contact-info');
    if (popup) {
      popup.textContent = 'Submitter uniqueId: ' + uid + ' \u2014 look up in Users tab';
      popup.style.display = 'block';
    }
  });
  body.appendChild(contactBtn);

  // Duplicate highlighting -- show similar existing suggestions
  if (sg.status === 'pending') {
    const sgWords = (sg.title || '').toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const similar = (suggestionsFilterState.cached || []).filter(other =>
      other.id !== sg.id &&
      other.status !== 'pending' &&
      other.status !== 'rejected' &&
      sgWords.some(w => (other.title || '').toLowerCase().includes(w))
    );
    if (similar.length > 0) {
      const dupDiv = document.createElement('div');
      dupDiv.className = 'duplicate-highlight';
      dupDiv.style.cssText = 'margin-top:6px;padding:6px 10px;background:rgba(255,193,7,0.1);border:1px solid rgba(255,193,7,0.3);border-radius:4px;font-size:12px;color:var(--text2);';
      dupDiv.textContent = 'Similar: ' + similar.slice(0, 3).map(s => s.title).join(', ');
      body.appendChild(dupDiv);
    }
  }

  // View history button -- shows inline timeline of status changes
  const historyBtn = document.createElement('button');
  historyBtn.className = 'btn-view-history';
  historyBtn.textContent = 'View History';
  historyBtn.style.cssText = 'font-size:12px;padding:4px 10px;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:4px;cursor:pointer;margin-top:4px;margin-left:6px;';
  historyBtn.addEventListener('click', () => loadSuggestionTimeline(sg.id, body));
  body.appendChild(historyBtn);

  // Timeline container -- populated by loadSuggestionTimeline on demand
  const timeline = document.createElement('div');
  timeline.id = 'suggestion-timeline-' + sg.id;
  timeline.className = 'suggestion-timeline';
  timeline.style.cssText = 'display:none;margin-top:10px;padding:10px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;font-size:12px;';
  body.appendChild(timeline);

  // Reject reason input (hidden by default)
  const rejectWrap = document.createElement('div');
  rejectWrap.className = 'sg-reject-input';
  rejectWrap.innerHTML = '<input type="text" placeholder="Rejection reason...">' +
    '<button>Confirm Reject</button>';
  body.appendChild(rejectWrap);

  // Merge search input (hidden by default)
  const mergeWrap = document.createElement('div');
  mergeWrap.className = 'sg-merge-search';
  mergeWrap.innerHTML = '<input type="text" placeholder="Original suggestion ID to merge into...">' +
    '<button>Confirm Merge</button>';
  body.appendChild(mergeWrap);

  card.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'sg-actions';

  const approveBtn = document.createElement('button');
  approveBtn.className = 'sg-btn-approve';
  approveBtn.textContent = 'Approve';
  approveBtn.addEventListener('click', async () => {
    try {
      // Backend state machine uses "accepted", not "approved".
      const result = await apiCall('PUT', `/api/admin/suggestions/${sg.id}/status`, { status: 'accepted' });
      window.PartialFailureToast?.showResultToast(showToast, result, 'Suggestion approved');
      loadSuggestions();
    } catch (err) { showToast(err.message, 'error'); }
  });

  const rejectBtn = document.createElement('button');
  rejectBtn.className = 'sg-btn-reject';
  rejectBtn.textContent = 'Reject';
  rejectBtn.addEventListener('click', () => {
    // Open the shared reject dialog (one per page, populated per click)
    openSuggestionRejectDialog(sg.id);
  });

  // Legacy inline reject input (for backward compat with existing manual flows).
  rejectWrap.querySelector('button').addEventListener('click', async () => {
    const reason = rejectWrap.querySelector('input').value.trim();
    try {
      const result = await apiCall('PUT', `/api/admin/suggestions/${sg.id}/status`, { status: 'rejected', reason });
      window.PartialFailureToast?.showResultToast(showToast, result, 'Suggestion rejected');
      loadSuggestions();
    } catch (err) { showToast(err.message, 'error'); }
  });

  const mergeBtn = document.createElement('button');
  mergeBtn.className = 'sg-btn-merge';
  mergeBtn.textContent = 'Merge';
  mergeBtn.addEventListener('click', () => {
    openSuggestionMergeDialog(sg.id);
  });

  // Legacy inline merge input (backward compat)
  mergeWrap.querySelector('button').addEventListener('click', async () => {
    const targetId = mergeWrap.querySelector('input').value.trim();
    if (!targetId) { showToast('Enter a target suggestion ID', 'error'); return; }
    try {
      await apiCall('POST', `/api/admin/suggestions/${sg.id}/merge`, { targetId });
      showToast('Suggestion merged', 'success');
      loadSuggestions();
    } catch (err) { showToast(err.message, 'error'); }
  });

  // Link to Roadmap button
  const linkBtn = document.createElement('button');
  linkBtn.className = 'btn-link-roadmap';
  linkBtn.textContent = 'Link to Roadmap';
  linkBtn.style.cssText = 'font-size:12px;padding:6px 10px;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:4px;cursor:pointer;';
  linkBtn.addEventListener('click', () => openRoadmapLinkDialog(sg.id));

  // Complete button -- for planned suggestions
  const completeBtn = document.createElement('button');
  completeBtn.className = 'btn-complete';
  completeBtn.textContent = 'Complete';
  completeBtn.style.cssText = 'font-size:12px;padding:6px 10px;background:var(--success);color:#fff;border:none;border-radius:4px;cursor:pointer;';
  completeBtn.addEventListener('click', () => openSuggestionCompleteDialog(sg.id));

  // Overturn button -- for non-pending states
  const overturnBtn = document.createElement('button');
  overturnBtn.className = 'btn-overturn';
  overturnBtn.textContent = 'Overturn';
  overturnBtn.style.cssText = 'font-size:12px;padding:6px 10px;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:4px;cursor:pointer;';
  overturnBtn.addEventListener('click', () => openSuggestionOverturnDialog(sg.id));

  actions.appendChild(approveBtn);
  actions.appendChild(rejectBtn);
  actions.appendChild(mergeBtn);
  actions.appendChild(linkBtn);
  actions.appendChild(completeBtn);
  actions.appendChild(overturnBtn);
  card.appendChild(actions);

  return card;
}

function renderDisputeCard(d) {
  const card = document.createElement('div');
  card.className = 'dispute-card';

  const meta = document.createElement('div');
  meta.className = 'dispute-meta';
  meta.innerHTML = '<strong>Dispute #' + escapeHtml(d.id || '') + '</strong> | ' +
    'Original: ' + escapeHtml(d.originalId || '') + ' | ' +
    'Merged into: ' + escapeHtml(d.targetId || '') + ' | ' +
    (d.createdAt ? new Date(d.createdAt).toLocaleString() : '');
  card.appendChild(meta);

  if (d.reason) {
    const reason = document.createElement('div');
    reason.style.cssText = 'font-size:13px;margin-bottom:8px;color:var(--text);';
    reason.textContent = 'Reason: ' + d.reason;
    card.appendChild(reason);
  }

  const actions = document.createElement('div');
  actions.className = 'dispute-actions';

  const upholdBtn = document.createElement('button');
  upholdBtn.className = 'dispute-uphold';
  upholdBtn.textContent = 'Uphold Merge';
  upholdBtn.addEventListener('click', async () => {
    try {
      await apiCall('PUT', `/api/admin/suggestions/disputes/${d.id}`, { resolution: 'upheld' });
      showToast('Dispute resolved - merge upheld', 'success');
      loadSuggestions();
    } catch (err) { showToast(err.message, 'error'); }
  });

  const revertBtn = document.createElement('button');
  revertBtn.className = 'dispute-reject';
  revertBtn.textContent = 'Revert Merge';
  revertBtn.addEventListener('click', async () => {
    try {
      await apiCall('PUT', `/api/admin/suggestions/disputes/${d.id}`, { resolution: 'reverted' });
      showToast('Dispute resolved - merge reverted', 'success');
      loadSuggestions();
    } catch (err) { showToast(err.message, 'error'); }
  });

  actions.appendChild(upholdBtn);
  actions.appendChild(revertBtn);
  card.appendChild(actions);

  return card;
}

// ── Suggestion timeline rendering ──
// Per-card timeline: renders into #suggestion-timeline-{id} on the card
// that called loadSuggestionTimeline. Tests look up the per-card element
// directly rather than a shared panel.
async function loadSuggestionTimeline(suggestionId, body) {
  const container = body && body.querySelector('#suggestion-timeline-' + suggestionId);
  if (!container) return;
  container.style.display = 'block';
  container.innerHTML = '<div style="color:var(--text2);font-size:12px;">Loading history\u2026</div>';
  try {
    const data = await apiCall('GET', '/api/admin/suggestions/' + suggestionId + '/history');
    const events = data.timeline || data.events || [];
    container.innerHTML = '';
    if (events.length === 0) {
      container.innerHTML = '<div style="color:var(--text2);font-size:12px;">No history entries.</div>';
      return;
    }
    events.forEach((evt) => {
      const entry = document.createElement('div');
      entry.className = 'timeline-entry';
      entry.style.cssText = 'display:flex;flex-direction:column;gap:4px;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px;';

      const header = document.createElement('div');
      header.style.cssText = 'display:flex;gap:8px;align-items:center;';
      const action = document.createElement('span');
      action.className = 'timeline-action';
      action.style.fontWeight = '600';
      action.textContent = evt.action || '';
      header.appendChild(action);

      const admin = document.createElement('span');
      admin.className = 'timeline-admin-name';
      admin.style.color = 'var(--text2)';
      admin.textContent = evt.adminName || '';
      header.appendChild(admin);

      const ts = document.createElement('span');
      ts.className = 'timeline-timestamp';
      ts.style.cssText = 'color:var(--text2);margin-left:auto;';
      if (evt.timestamp) ts.setAttribute('data-timestamp', String(evt.timestamp));
      ts.textContent = evt.timestamp ? new Date(evt.timestamp).toLocaleString() : '';
      header.appendChild(ts);

      entry.appendChild(header);

      if (evt.reason) {
        const reason = document.createElement('div');
        reason.style.color = 'var(--text2)';
        reason.textContent = 'Reason: ' + evt.reason;
        entry.appendChild(reason);
      }
      if (evt.diff) {
        const diffEl = document.createElement('div');
        diffEl.className = 'edit-diff timeline-diff';
        diffEl.style.cssText = 'color:var(--text2);font-family:monospace;font-size:11px;padding:4px 6px;background:var(--surface);border-radius:4px;';
        diffEl.textContent = typeof evt.diff === 'object' ? JSON.stringify(evt.diff) : String(evt.diff);
        entry.appendChild(diffEl);
      }
      container.appendChild(entry);
    });
  } catch {
    container.innerHTML = '<div style="color:var(--text2);font-size:12px;">No history available.</div>';
  }
}

// ── Dialog openers ────────────────────────────────────────────────

function openSuggestionRejectDialog(suggestionId) {
  const dialog = document.getElementById('suggestion-reject-dialog');
  if (!dialog) return;
  dialog.dataset.suggestionId = suggestionId;
  dialog.dataset.warningShown = 'false';
  document.getElementById('reject-reason-input').value = '';
  const warning = dialog.querySelector('.reject-warning');
  if (warning) warning.style.display = 'none';
  dialog.style.display = 'flex';
}

function openSuggestionCompleteDialog(suggestionId) {
  completeSuggestionId = suggestionId;
  document.getElementById('suggestion-complete-dialog').style.display = 'flex';
}

function openSuggestionOverturnDialog(suggestionId) {
  overturnSuggestionId = suggestionId;
  document.getElementById('suggestion-overturn-dialog').style.display = 'flex';
}

async function openRoadmapLinkDialog(suggestionId) {
  roadmapLinkSuggestionId = suggestionId;
  const dialog = document.getElementById('roadmap-link-dialog');
  const dropdown = document.getElementById('roadmap-link-dropdown');
  if (!dialog || !dropdown) return;
  // Populate dropdown with roadmap features
  dropdown.innerHTML = '<option value="">\u2014 Loading features\u2026 \u2014</option>';
  dialog.style.display = 'flex';
  try {
    const data = await apiCall('GET', '/api/roadmap/features');
    const features = data.features || data || [];
    dropdown.innerHTML = '<option value="">\u2014 Select a feature \u2014</option>';
    for (const f of features) {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = f.name || f.title || f.id;
      dropdown.appendChild(opt);
    }
  } catch {
    // If no dedicated endpoint, try roadmap-data.json
    try {
      const resp = await fetch('/roadmap-data.json');
      const roadmap = await resp.json();
      dropdown.innerHTML = '<option value="">\u2014 Select a feature \u2014</option>';
      for (const phase of (roadmap.phases || [])) {
        for (const f of (phase.features || [])) {
          const opt = document.createElement('option');
          opt.value = f.id;
          opt.textContent = (phase.name ? phase.name + ': ' : '') + (f.name || f.title || f.id);
          dropdown.appendChild(opt);
        }
      }
    } catch {
      dropdown.innerHTML = '<option value="">No features available</option>';
    }
  }
}

function openSuggestionMergeDialog(suggestionId) {
  const dialog = document.getElementById('suggestion-merge-dialog');
  if (!dialog) return;
  dialog.dataset.suggestionId = suggestionId;
  dialog.dataset.targetId = '';
  document.getElementById('merge-search-input').value = '';
  document.getElementById('merge-results-list').innerHTML = '';
  const confirmBtn = dialog.querySelector('.btn-confirm-merge');
  confirmBtn.disabled = true;
  confirmBtn.style.opacity = '0.5';
  dialog.style.display = 'flex';
}
