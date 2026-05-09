/**
 * Age Verification sub-tab (PR 6/14).
 *
 * Renders pending verification review UI as a sub-tab inside the
 * Users tab. Per spec answer #5 from 2026-05-04: this is a sub-tab,
 * not a top-level tab. The "Does ID match the recorded DOB?" gate
 * controls whether Approve/Reject or Modify-DOB is exposed.
 *
 * Discovery: a global pending-count badge on the sub-tab header
 * tracks how many submissions are awaiting review across the
 * system. When the currently-loaded user has no pending submission,
 * a "Jump to next pending" button hops the admin to the oldest one.
 *
 * Decision endpoints (admin-age-verification route):
 *   POST /api/admin/age-verification/:id/approve  body: {}
 *   POST /api/admin/age-verification/:id/reject   body: {reason}
 *   POST /api/admin/age-verification/:id/modify-dob body: {newDob, reason}
 *
 * Image preview endpoint added in this PR:
 *   GET /api/admin/age-verification/:id/image-url → 5-min signed URL
 */

import { apiCall } from '/js/core/api.js';
import { showToast, escapeHtml } from '/js/core/ui.js';

// ── State ──────────────────────────────────────────────────────────

let _searchUserByUniqueId = null;
let _refreshAfterDecisionCallback = null;
let _initialised = false;

// Cached pending list. Refreshed on subtab open + after decisions.
// Index lookup: by submission.userId (string keyed).
let _pending = [];

// ── DOM refs ───────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

// ── Init / dependencies ────────────────────────────────────────────

/**
 * Wire dependencies and event listeners.
 *
 * @param {Object} deps
 * @param {Function} deps.searchUserByUniqueId — re-load a user into the
 *   Users tab. Used by "Jump to next pending" to swap the current user.
 * @param {Function} deps.refreshAfterDecision — repopulate Users tab
 *   after a decision so the read-only DOB / verified badge updates.
 */
export function init(deps) {
  // Refresh deps every call — callers may rebind on re-init even though
  // listeners only get wired once.
  _searchUserByUniqueId = deps?.searchUserByUniqueId || null;
  _refreshAfterDecisionCallback = deps?.refreshAfterDecision || null;

  // Idempotent — init() runs from onAuthStateChanged in main.js. Each
  // re-fire (sign-out → sign-in, token refresh) would otherwise stack
  // another click handler on every approve / reject / modify-DOB
  // button, so a single click would dispatch N concurrent age-verif
  // approvals. It would also issue N redundant /pending GETs per
  // cycle. See tests/web/admin-init-idempotency.spec.ts.
  if (_initialised) return;
  _initialised = true;

  // Wire match-question radios
  document.querySelectorAll('input[name="age-verif-match"]').forEach((r) =>
    r.addEventListener('change', onMatchChange),
  );

  // Wire decision buttons
  $('age-verif-approve-btn')?.addEventListener('click', onApprove);
  $('age-verif-reject-btn-yes')?.addEventListener('click', () => onReject('yes'));
  $('age-verif-reject-btn-no')?.addEventListener('click', () => onReject('no'));
  $('age-verif-modify-btn')?.addEventListener('click', onModifyDob);

  // Wire jump-next
  $('age-verif-jump-next')?.addEventListener('click', onJumpNext);

  // Initial pending count fetch (for the badge); silent on failure —
  // the admin can always force a refresh by opening the subtab.
  refreshPendingList().catch(() => {});
}

// ── Pending list / badge ───────────────────────────────────────────

/**
 * Pull the current pending list from the API and refresh both the
 * sub-tab badge and the cached list.
 */
export async function refreshPendingList() {
  try {
    const data = await apiCall('GET', '/api/admin/age-verification/pending');
    _pending = Array.isArray(data?.submissions) ? data.submissions : [];
  } catch (_err) {
    // Non-fatal — leave the cache as-is. The admin can retry by
    // re-opening the sub-tab. Don't toast here; this is a background
    // refresh and a noisy toast on every failure would be annoying.
    _pending = _pending || [];
  }
  renderPendingBadge();
}

function renderPendingBadge() {
  const badge = $('age-verif-pending-badge');
  if (!badge) return;
  const total = _pending.length;
  if (total === 0) {
    badge.hidden = true;
    badge.textContent = '';
  } else {
    badge.hidden = false;
    badge.textContent = String(total);
  }
}

// ── Subtab activation ──────────────────────────────────────────────

/**
 * Called when the admin clicks the Age Verification sub-tab. Decides
 * which view to render: the per-user form (if THIS user has a
 * pending submission), or the empty state with a Jump-to-next link.
 *
 * @param {string|number|null} currentUid — the unique ID of the user
 *   currently loaded in the Users tab. May be null for the "no user
 *   selected yet" branch.
 */
export async function onSubtabOpen(currentUid) {
  await refreshPendingList();
  const uidStr = currentUid != null ? String(currentUid) : null;
  const submission = uidStr ? _pending.find((s) => String(s.userId) === uidStr) : null;
  if (submission) {
    await renderForm(submission, uidStr);
  } else {
    renderEmpty();
  }
}

function renderEmpty() {
  const empty = $('age-verif-empty');
  const form = $('age-verif-form');
  const otherCountEl = $('age-verif-other-count');
  const jumpBtn = $('age-verif-jump-next');
  if (form) form.style.display = 'none';
  if (empty) empty.style.display = 'block';
  if (otherCountEl) otherCountEl.textContent = String(_pending.length);
  if (jumpBtn) jumpBtn.style.display = _pending.length > 0 ? 'inline-block' : 'none';
}

async function renderForm(submission, uidStr) {
  const empty = $('age-verif-empty');
  const form = $('age-verif-form');
  if (empty) empty.style.display = 'none';
  if (form) form.style.display = 'block';

  $('age-verif-method').textContent = submission.idMethod || '—';
  $('age-verif-current-dob').textContent = formatDob(submission.currentDob);
  $('age-verif-submitted-at').textContent = formatTimestamp(submission.submittedAt);
  $('age-verif-submission-id').textContent = submission.id;

  // Reset the gate question + branch UI on re-open so a previous
  // decision-in-progress doesn't leak into a new submission.
  document.querySelectorAll('input[name="age-verif-match"]').forEach((r) => (r.checked = false));
  $('age-verif-yes-actions').style.display = 'none';
  $('age-verif-no-actions').style.display = 'none';
  $('age-verif-reject-reason-yes').value = '';
  $('age-verif-reject-reason-no').value = '';
  $('age-verif-modify-reason').value = '';
  $('age-verif-new-dob').value = '';

  // Remember which submission is being reviewed so the decision
  // handlers know which ID to POST to. Stored on the form element
  // rather than a module-level variable to defend against stale state
  // when the admin switches users mid-review.
  form.dataset.submissionId = submission.id;
  form.dataset.uniqueId = uidStr;

  // Fetch & display the signed image URL. Failure = show a placeholder
  // and keep the rest of the form usable; the admin can still decide
  // based on whatever they remember from a prior load.
  await loadIdImage(submission.id);
}

async function loadIdImage(submissionId) {
  const img = $('age-verif-id-image');
  const link = $('age-verif-id-image-link');
  if (!img) return;
  img.removeAttribute('src');
  img.alt = 'Loading…';
  try {
    const data = await apiCall('GET', `/api/admin/age-verification/${submissionId}/image-url`);
    if (!data?.url) throw new Error('no url returned');
    img.src = data.url;
    img.alt = 'Submitted ID';
    if (link) link.href = data.url;
  } catch (err) {
    img.alt = 'Failed to load image';
    showToast(`Failed to load ID image: ${err.message}`, 'error');
  }
}

// ── Gate question ──────────────────────────────────────────────────

function onMatchChange(e) {
  const value = e.target.value;
  $('age-verif-yes-actions').style.display = value === 'yes' ? 'block' : 'none';
  $('age-verif-no-actions').style.display = value === 'no' ? 'block' : 'none';
}

// ── Decision actions ───────────────────────────────────────────────

async function onApprove() {
  const id = currentSubmissionId();
  if (!id) return;
  if (!confirm('Mark this user as 18+ verified?')) return;
  try {
    // Approve takes no reason (per spec answer #6 — admin doesn't
    // need to justify a confirmation). Reject + Modify-DOB still do.
    await apiCall('POST', `/api/admin/age-verification/${id}/approve`, {});
    showToast('Age verification approved', 'success');
    await afterDecision();
  } catch (err) {
    showToast(`Approve failed: ${err.message}`, 'error');
  }
}

async function onReject(branch) {
  const id = currentSubmissionId();
  if (!id) return;
  const reasonEl = branch === 'no' ? $('age-verif-reject-reason-no') : $('age-verif-reject-reason-yes');
  const reason = (reasonEl?.value || '').trim();
  if (!reason) {
    showToast('Rejection reason is required.', 'error');
    return;
  }
  if (!confirm('Reject this submission? The user is notified by system PM.')) return;
  try {
    await apiCall('POST', `/api/admin/age-verification/${id}/reject`, { reason });
    showToast('Age verification rejected', 'success');
    await afterDecision();
  } catch (err) {
    showToast(`Reject failed: ${err.message}`, 'error');
  }
}

async function onModifyDob() {
  const id = currentSubmissionId();
  if (!id) return;
  const newDobInput = $('age-verif-new-dob')?.value;
  const reason = ($('age-verif-modify-reason')?.value || '').trim();
  if (!newDobInput) {
    showToast('New DOB is required.', 'error');
    return;
  }
  if (!reason) {
    showToast('Reason / notes are required for the audit trail.', 'error');
    return;
  }
  // <input type="date"> returns YYYY-MM-DD. Convert to UTC midnight ms
  // so the value matches how the rest of the app stores DOBs.
  const newDobMs = Date.parse(newDobInput + 'T00:00:00Z');
  if (!Number.isFinite(newDobMs)) {
    showToast('Invalid date.', 'error');
    return;
  }
  if (!confirm('Update the user\'s DOB to the value above? Their access is unlocked or kept locked automatically.')) return;
  try {
    await apiCall('POST', `/api/admin/age-verification/${id}/modify-dob`, {
      newDob: newDobMs,
      reason,
    });
    showToast('DOB updated', 'success');
    await afterDecision();
  } catch (err) {
    showToast(`Modify-DOB failed: ${err.message}`, 'error');
  }
}

async function afterDecision() {
  // Refresh the pending list so the badge / next-jump are accurate.
  await refreshPendingList();
  // Re-render the empty state — this user's submission is gone from
  // the pending list now.
  renderEmpty();
  // Let the Users tab update its read-only fields (verified badge,
  // DOB if Modify-DOB ran, etc.).
  const uid = $('age-verif-form')?.dataset?.uniqueId;
  if (_refreshAfterDecisionCallback && uid) {
    try {
      await _refreshAfterDecisionCallback(uid);
    } catch (err) {
      // Non-fatal — admin can manually re-search. Don't block the
      // decision flow on a stale-form refresh hiccup.
      // eslint-disable-next-line no-console
      console.warn('refreshAfterDecision failed', err);
    }
  }
}

// ── Jump-to-next ───────────────────────────────────────────────────

function onJumpNext() {
  const next = _pending[0]; // oldest first (the GET endpoint sorts asc)
  if (!next) return;
  if (!_searchUserByUniqueId) {
    showToast('Cannot jump — search hook missing', 'error');
    return;
  }
  _searchUserByUniqueId(next.userId);
}

// ── Helpers ────────────────────────────────────────────────────────

function currentSubmissionId() {
  const form = $('age-verif-form');
  const id = form?.dataset?.submissionId;
  if (!id) {
    showToast('No submission loaded — re-open the sub-tab.', 'error');
    return null;
  }
  return id;
}

function formatDob(ms) {
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function formatTimestamp(ms) {
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleString();
}

function pad(n) {
  return n < 10 ? `0${n}` : String(n);
}

// Small helper used by callers to escape values that might contain
// HTML when the form is re-populated. Currently unused but exported
// for future enhancements (e.g., a notes field that could echo user
// input). Keeping it imported quiets the lint rule.
export const _internal = { escapeHtml };
