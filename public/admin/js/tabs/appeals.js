/**
 * Appeals tab — suspension appeal review with approve/deny.
 *
 * Extracted from inline script block in index.html (PR B).
 */

import { apiCall } from '/js/core/api.js';
import { showToast, escapeHtml } from '/js/core/ui.js';

// ── State ──────────────────────────────────────────────────────────

let currentFilter = 'pending';

// ── Dependencies ───────────────────────────────────────────────────

let _renderEvidence = () => '';
let _openEvidenceLightbox = () => {};

// ── Public API ─────────────────────────────────────────────────────

/**
 * @param deps.renderEvidence — shared evidence rendering function
 * @param deps.openEvidenceLightbox — shared lightbox opener
 */
export function init(deps) {
  _renderEvidence = deps.renderEvidence || _renderEvidence;
  _openEvidenceLightbox =
    deps.openEvidenceLightbox || _openEvidenceLightbox;

  for (const btn of document.querySelectorAll('[data-appeal-filter]')) {
    btn.addEventListener('click', () => {
      for (const b of document.querySelectorAll(
        '[data-appeal-filter]',
      ))
        b.classList.remove('active');
      btn.classList.add('active');
      currentFilter = btn.dataset.appealFilter;
      load(currentFilter);
    });
  }
}

export function activate() {
  load('pending');
}

export function deactivate() {}

// ── Internal ───────────────────────────────────────────────────────

async function load(status) {
  const list = document.getElementById('appeals-list');
  list.innerHTML =
    '<div style="color:var(--text2);font-size:13px;">Loading...</div>';
  try {
    const raw = await apiCall('GET', `/api/appeals?status=${status}`);
    const appeals = Array.isArray(raw) ? raw : raw.appeals || [];
    if (appeals.length === 0) {
      list.innerHTML =
        '<div style="color:var(--text2);font-size:13px;font-style:italic;">No appeals found</div>';
      return;
    }
    list.innerHTML = '';
    for (const appeal of appeals) {
      list.appendChild(renderCard(appeal, status));
    }

    // Bind resolve buttons
    for (const btn of list.querySelectorAll('[data-resolve]')) {
      btn.addEventListener('click', async () => {
        const appealId = btn.dataset.resolve;
        const newStatus = btn.dataset.status;
        const noteInput = list.querySelector(
          `[data-note-for="${appealId}"]`,
        );
        const adminNote = noteInput ? noteInput.value.trim() : '';
        btn.disabled = true;
        try {
          await apiCall('PATCH', `/api/appeals/${appealId}`, {
            status: newStatus,
            ...(adminNote ? { adminNote } : {}),
          });
          showToast(`Appeal ${newStatus}`);
          load(currentFilter);
        } catch (err) {
          showToast(err.message, 'error');
        }
        btn.disabled = false;
      });
    }

    // Wire evidence thumbnail clicks
    for (const thumb of list.querySelectorAll(
      '.evidence-thumb:not([data-wired])',
    )) {
      thumb.dataset.wired = '1';
      thumb.addEventListener('click', () => {
        _openEvidenceLightbox(
          thumb.dataset.evidenceUrl,
          thumb.dataset.evidenceType,
        );
      });
    }
  } catch (err) {
    list.textContent = '';
    const errDiv = document.createElement('div');
    errDiv.style.cssText = 'color:var(--danger);font-size:13px;';
    errDiv.textContent = err.message;
    list.appendChild(errDiv);
  }
}

function renderCard(appeal, status) {
  const card = document.createElement('div');
  card.className = 'appeal-card';
  const date = appeal.submittedAt
    ? new Date(appeal.submittedAt).toLocaleString()
    : '';
  const userInfo = appeal.userInfo || {};
  const originalName =
    appeal.originalDisplayName ||
    appeal.userDisplayName ||
    userInfo.displayName ||
    'Unknown';
  const originalPhoto = appeal.originalProfilePhotoUrl || null;
  const uniqueId = appeal.userUniqueId || userInfo.uniqueId || '?';

  const profileHtml = `
    <div class="appeal-profile">
      ${originalPhoto ? `<img src="${escapeHtml(originalPhoto)}" alt="${escapeHtml(originalName)}">` : '<div class="placeholder-avatar">?</div>'}
      <div>
        <div style="font-weight:600;font-size:14px;">#${escapeHtml(String(uniqueId))} \u2014 ${escapeHtml(originalName)}</div>
        ${userInfo.displayName && userInfo.displayName !== originalName ? `<div style="font-size:11px;color:var(--text2);">Current name: ${escapeHtml(userInfo.displayName)}</div>` : ''}
      </div>
    </div>`;

  let suspensionHtml = '';
  if (userInfo.suspensionReason) {
    const since = userInfo.suspensionStartDate
      ? new Date(userInfo.suspensionStartDate).toLocaleString()
      : 'unknown';
    const until = userInfo.suspensionEndDate
      ? new Date(userInfo.suspensionEndDate).toLocaleString()
      : 'permanent';
    suspensionHtml = `
      <div class="appeal-suspension-info">
        <strong>Reason:</strong> ${escapeHtml(userInfo.suspensionReason)}<br>
        <strong>Since:</strong> ${since}<br>
        <strong>Until:</strong> ${until}
      </div>`;
  }

  const reports = appeal.reports || [];
  let reportsHtml = '';
  if (reports.length > 0) {
    const reportItems = reports
      .map((r) => {
        const reportDate = r.timestamp
          ? new Date(r.timestamp).toLocaleString()
          : '';
        const reporterName = r.reporterName || 'Unknown';
        const reporterUid = r.reporterUniqueId || '';
        const reportStatus =
          r.status === 'resolved'
            ? `(${escapeHtml(r.resolvedAction || 'resolved')})`
            : `(${escapeHtml(r.status)})`;
        return `
        <div class="appeal-report-item">
          <div class="report-reason">${escapeHtml(r.reason || 'Unknown reason')} ${reportStatus}</div>
          <div class="report-meta">
            Reported by: #${escapeHtml(String(reporterUid))} ${escapeHtml(reporterName)} | ${reportDate}
            ${r.type === 'message' ? ' | Type: Message report' : ''}
          </div>
          ${r.description ? `<div class="report-description">${escapeHtml(r.description)}</div>` : ''}
          ${r.messageText ? `<div class="report-evidence">Reported message: "${escapeHtml(r.messageText)}"</div>` : ''}
          ${_renderEvidence(r.evidenceUrls)}
          ${r.adminNote ? `<div style="margin-top:4px;font-size:11px;color:var(--text2);">Admin note: ${escapeHtml(r.adminNote)}</div>` : ''}
        </div>`;
      })
      .join('');

    reportsHtml = `
      <div class="appeal-reports">
        <details>
          <summary>Reports & Evidence (${reports.length})</summary>
          ${reportItems}
        </details>
      </div>`;
  }

  card.innerHTML = `
    ${profileHtml}
    ${suspensionHtml}
    <div class="appeal-text">${escapeHtml(appeal.appealText || '')}</div>
    <div style="font-size:11px;color:var(--text2);margin-bottom:8px;">Submitted: ${date}</div>
    ${
      status === 'pending'
        ? `
    <div class="appeal-actions">
      <input type="text" placeholder="Admin note (optional)" data-note-for="${escapeHtml(appeal.id)}">
      <button class="btn-approve" data-resolve="${escapeHtml(appeal.id)}" data-status="approved">Approve</button>
      <button class="btn-deny" data-resolve="${escapeHtml(appeal.id)}" data-status="denied">Deny</button>
    </div>`
        : `
    <div style="font-size:12px;color:var(--text2);">
      ${appeal.adminNote ? `Note: ${escapeHtml(appeal.adminNote)}` : ''}
      ${appeal.reviewedAt ? `Reviewed: ${escapeHtml(new Date(appeal.reviewedAt).toLocaleString())}` : ''}
    </div>`
    }
    ${reportsHtml}
  `;
  return card;
}
