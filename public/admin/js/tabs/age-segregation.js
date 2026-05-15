/**
 * Age Segregation top-level tab (UK OSA #17 PR 13).
 *
 * Surfaces the cohort distribution dashboard and the admin-only
 * cohort-override form.
 *
 * Endpoints:
 *   GET  /api/admin/cohort-stats           — adult/minor/missing/total counts
 *   POST /api/user/:uniqueId/cohort-override — admin-only override write
 *
 * Compliance contract:
 *   - The override is REJECTED with 422 CANNOT_OVERRIDE_REGULAR_USER
 *     when the target is a regular MEMBER. The form surfaces this
 *     specific code so the admin understands the refusal is by design.
 *   - Apply button is disabled until reason has non-whitespace content.
 *     Server independently re-checks; the disabled-button gate stops
 *     accidental empty-reason submissions before they reach the API.
 *   - A confirmation modal appears between Apply click and POST send.
 *     Two-step UX prevents a misclick from writing an audit row.
 */

import { apiCall } from '/js/core/api.js';
import { showToast } from '/js/core/ui.js';

// ── State ──────────────────────────────────────────────────────────

let _initialised = false;

// ── DOM refs ───────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

// ── Init / activate ────────────────────────────────────────────────

export function init(_deps) {
  // Idempotent — see age-verification.js for the rationale (init() may
  // re-fire on token refresh; without this guard we'd stack listeners).
  if (_initialised) return;
  _initialised = true;

  $('age-seg-refresh-btn')?.addEventListener('click', () => {
    loadStats().catch((err) =>
      showToast('Failed to refresh stats: ' + (err?.message || err), 'error'),
    );
  });

  // Apply button gating — disabled until reason has content. Re-evaluated
  // on every change to reason / target / override-select.
  const apply = $('age-seg-apply-btn');
  const reason = $('age-seg-reason');
  const target = $('age-seg-target-uid');
  const value = $('age-seg-override-value');
  const updateApplyEnabled = () => {
    if (!apply) return;
    const reasonOk = (reason?.value || '').trim().length > 0;
    const targetOk = (target?.value || '').trim().length > 0;
    const valueOk = (value?.value || '').length > 0;
    apply.disabled = !(reasonOk && targetOk && valueOk);
  };
  reason?.addEventListener('input', updateApplyEnabled);
  target?.addEventListener('input', updateApplyEnabled);
  value?.addEventListener('change', updateApplyEnabled);
  // Initial state — all empty → disabled.
  updateApplyEnabled();

  apply?.addEventListener('click', onApplyClick);
  $('age-seg-confirm-ok')?.addEventListener('click', onConfirmOk);
  $('age-seg-confirm-cancel')?.addEventListener('click', onConfirmCancel);
}

export function activate(_deps) {
  // Refresh stats on every activation so a tab switch shows fresh data.
  // Failures surface as a toast — never block the tab from rendering.
  loadStats().catch((err) =>
    showToast('Failed to load cohort stats: ' + (err?.message || err), 'error'),
  );
  clearResult();
}

export function deactivate() {
  // Close any open confirm modal so it doesn't pop back when the user
  // returns to the tab later, AND clear pending state — otherwise a
  // subsequent activate + Confirm click would fire the previous tab
  // visit's stashed override (review I4).
  hideConfirmModal();
  _pendingOverride = null;
}

// ── Stats ──────────────────────────────────────────────────────────

async function loadStats() {
  const STAT_KEYS = ['adult', 'minor', 'missing', 'total', 'overrideAdult', 'overrideMinor'];
  for (const k of STAT_KEYS) {
    const el = $(`age-seg-stat-${camelToKebab(k)}`);
    if (el) el.textContent = '…';
  }
  const res = await apiCall('GET', '/api/admin/cohort-stats');
  const counts = res?.counts || {};
  for (const k of STAT_KEYS) {
    const el = $(`age-seg-stat-${camelToKebab(k)}`);
    if (!el) continue;
    const n = Number(counts[k]);
    el.textContent = Number.isFinite(n) ? String(n) : '0';
  }
}

function camelToKebab(s) {
  return s.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

// ── Override flow ──────────────────────────────────────────────────

function onApplyClick() {
  const target = ($('age-seg-target-uid')?.value || '').trim();
  const selected = $('age-seg-override-value')?.value || '';
  const reason = ($('age-seg-reason')?.value || '').trim();

  if (!target || !selected || !reason) return; // button-gate guard

  // Normalise the option value to the API payload shape. The select
  // exposes '__clear__' for the "clear override" action — the API
  // contract is `override: null`.
  const overrideValue = selected === '__clear__' ? null : selected;

  showConfirmModal({
    targetUid: target,
    cohortLabel: overrideValue === null ? '(clear)' : overrideValue,
    reason,
  });
}

let _pendingOverride = null;

function showConfirmModal({ targetUid, cohortLabel, reason }) {
  _pendingOverride = { targetUid, cohortLabel, reason };
  const summary = $('age-seg-confirm-summary');
  if (summary) {
    summary.textContent =
      `Target: ${targetUid} — New cohort: ${cohortLabel} — Reason: ${reason}`;
  }
  const modal = $('age-seg-confirm-modal');
  if (modal) modal.style.display = 'flex';
}

function hideConfirmModal() {
  const modal = $('age-seg-confirm-modal');
  if (modal) modal.style.display = 'none';
}

function onConfirmCancel() {
  _pendingOverride = null;
  hideConfirmModal();
}

async function onConfirmOk() {
  if (!_pendingOverride) {
    hideConfirmModal();
    return;
  }
  const { targetUid, cohortLabel, reason } = _pendingOverride;
  hideConfirmModal();
  _pendingOverride = null;

  // Map the displayed cohort label back to the API value.
  const override = cohortLabel === '(clear)' ? null : cohortLabel;

  try {
    const res = await apiCall(
      'POST',
      `/api/user/${encodeURIComponent(targetUid)}/cohort-override`,
      { override, reason },
    );
    setResult(
      'success',
      `Override applied. Effective cohort: ${res?.effectiveCohort || 'unknown'}.` +
        (res?.forceTokenRefresh
          ? ' User will pick up new cohort on next request.'
          : ' Token refresh deferred — user will pick up new cohort on next sign-in.'),
    );
    // Refresh stats in the background so any change in override counts is
    // reflected immediately. Failures here don't roll back the override.
    loadStats().catch(() => {});
  } catch (err) {
    // The Express layer wraps errors as a JSON `{error}` body. The api.js
    // helper attaches the typed-error code as `err.code` and pulls the
    // nested message into `err.message`; we read those whitelisted fields
    // directly rather than walking the raw response body.
    if (err?.code === 'CANNOT_OVERRIDE_REGULAR_USER') {
      setResult(
        'error',
        'CANNOT_OVERRIDE_REGULAR_USER — Cohort override is only allowed on staff or admin accounts, not regular members.',
      );
      return;
    }
    // setResult writes via `textContent`, so no escaping is required here.
    setResult('error', 'Override failed: ' + (err?.message || String(err)));
  }
}

function setResult(status, message) {
  const el = $('age-seg-result');
  if (!el) return;
  el.dataset.status = status;
  el.style.display = 'block';
  el.textContent = message;
}

function clearResult() {
  const el = $('age-seg-result');
  if (!el) return;
  el.dataset.status = '';
  el.style.display = 'none';
  el.textContent = '';
}
