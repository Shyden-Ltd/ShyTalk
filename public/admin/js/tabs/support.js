/**
 * Support tab — SHY-0380.
 *
 * Lists support tickets raised from inside the app and lets an admin resolve one
 * with an internal note.
 *
 * Shaped on the appeals tab deliberately. ShyTalk already has two user-to-admin
 * queues; this is the third, and it should look and behave like the others
 * rather than inventing a new idiom.
 *
 * INTERIM by design. EPIC-0012 replaces this with a support-agent role working
 * from the website portal, so this must not grow assignment, replies, or a
 * lifecycle beyond open/resolved.
 *
 * ONE deliberate exception, SHY-0438: turning a ticket into a report. That is
 * not support-agent workflow -- it is the escape hatch for somebody who could
 * not manage the report flow (SHY-0437), and without it their safety report is
 * answered as correspondence and never reaches moderation. The state it leaves
 * behind is terminal (SHY-0439), so it adds no lifecycle to work through.
 *
 * Everything from a ticket is escaped on the way in. The message is written by
 * a member of the public and is displayed to an admin, which is precisely the
 * shape of a stored-XSS problem if it is ever trusted.
 */

import { apiCall, fetchObjectUrl } from '/js/core/api.js';
import { showToast, escapeHtml } from '/js/core/ui.js';
// Reused, never re-implemented: this already renders BOTH an image and a video
// with a lightbox. SHY-0400 exists because a second, images-only path was built
// beside it and the video branch became unreachable.
// `/admin/js/...`, NOT `/js/...`. The served roots are not the same: `/js/`
// maps to public/js (core only) and the tabs live under public/admin/js. A
// 404 on an ES module import aborts the ENTIRE module, so this one wrong
// prefix left the Support tab rendering nothing at all -- no tickets, no
// empty state -- in every browser, while every source-scanning test stayed
// green. `main.js` had it right all along.
import { renderEvidence, openEvidenceLightbox } from '/admin/js/tabs/users.js';

// ── State ──────────────────────────────────────────────────────────

let currentFilter = 'open';

/**
 * Object URLs minted for attachment thumbnails, so they can be released.
 *
 * Each one pins its bytes in memory until it is revoked. An admin working
 * through a queue of tickets with photographs and 30-second videos would
 * otherwise accumulate every one they had scrolled past for as long as the tab
 * stayed open.
 */
let attachmentObjectUrls = [];

function releaseAttachmentObjectUrls() {
  for (const url of attachmentObjectUrls) URL.revokeObjectURL(url);
  attachmentObjectUrls = [];
}

// ── Public API ─────────────────────────────────────────────────────

export function init() {
  for (const btn of document.querySelectorAll('[data-support-filter]')) {
    btn.addEventListener('click', () => {
      for (const b of document.querySelectorAll('[data-support-filter]')) {
        b.classList.remove('active');
      }
      btn.classList.add('active');
      currentFilter = btn.dataset.supportFilter;
      load(currentFilter);
    });
  }
}

export function activate() {
  load(currentFilter);
}

export function deactivate() {
  // Leaving the tab releases the bytes. Coming back re-fetches them, which is
  // the correct trade: these are photographs and videos of real people.
  releaseAttachmentObjectUrls();
}

// ── Internal ───────────────────────────────────────────────────────

async function load(status) {
  // Every reload replaces the whole list, so the previous cards' object URLs
  // are unreachable from the moment `list.innerHTML` is cleared -- released
  // here rather than left to the garbage collector, which does not revoke them.
  releaseAttachmentObjectUrls();
  const list = document.getElementById('support-list');
  if (!list) return;
  list.innerHTML = '<div style="color:var(--text2);font-size:13px;">Loading...</div>';

  try {
    const raw = await apiCall('GET', `/api/support-tickets?status=${status}`);
    const tickets = Array.isArray(raw) ? raw : raw.tickets || [];

    if (tickets.length === 0) {
      list.innerHTML =
        '<div style="color:var(--text2);font-size:13px;font-style:italic;">No support tickets found</div>';
      return;
    }

    list.innerHTML = '';
    for (const ticket of tickets) {
      list.appendChild(renderCard(ticket, status));
    }

    for (const btn of list.querySelectorAll('[data-resolve-ticket]')) {
      btn.addEventListener('click', async () => {
        if (btn.disabled) return;
        const ticketId = btn.dataset.resolveTicket;
        const noteInput = list.querySelector(`[data-note-for="${ticketId}"]`);
        const adminNote = noteInput ? noteInput.value.trim() : '';
        btn.disabled = true;
        try {
          await apiCall('PATCH', `/api/support-tickets/${ticketId}`, {
            status: 'resolved',
            ...(adminNote ? { adminNote } : {}),
          });
          showToast('Ticket resolved');
          load(currentFilter);
        } catch (err) {
          showToast(err.message, 'error');
        } finally {
          btn.disabled = false;
        }
      });
    }

    // SHY-0438 — turning a ticket into a report.
    for (const btn of list.querySelectorAll('[data-convert-ticket]')) {
      btn.addEventListener('click', async () => {
        if (btn.disabled) return;
        const ticketId = btn.dataset.convertTicket;
        const userInput = list.querySelector(`[data-report-user-for="${ticketId}"]`);
        const reasonInput = list.querySelector(`[data-report-reason-for="${ticketId}"]`);
        const reportedUserId = userInput ? userInput.value.trim() : '';
        const reason = reasonInput ? reasonInput.value : '';

        // Asked here rather than let the server answer 400, because the server's
        // refusal would arrive after the admin thinks they have filed it.
        if (!reportedUserId) {
          showToast('Who is this report about? Enter the reported user id.', 'error');
          return;
        }

        // The close is permanent and the person cannot undo it, so it is
        // confirmed once, naming what happens.
        const confirmed = window.confirm(
          `File a report against ${reportedUserId} for "${reason}" on this person's behalf?\n\n` +
            'Their support ticket will be closed permanently and cannot be reopened.',
        );
        if (!confirmed) return;

        btn.disabled = true;
        try {
          const result = await apiCall(
            'POST',
            `/api/support-tickets/${ticketId}/convert-to-report`,
            { reportedUserId, reason },
          );
          // Missing evidence is stated rather than swallowed: the moderator
          // opening this report needs to know what they will not find.
          const missing = Array.isArray(result?.missingAttachments)
            ? result.missingAttachments.length
            : 0;
          showToast(
            missing > 0
              ? `Report filed. ${missing} attachment(s) were no longer in storage.`
              : 'Report filed and ticket closed',
          );
          load(currentFilter);
        } catch (err) {
          // The ticket is untouched when this fails -- the server creates the
          // report first -- so the admin can simply try again.
          showToast(err.message, 'error');
        } finally {
          btn.disabled = false;
        }
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

/**
 * Fill in a card's attachments.
 *
 * VIEW routes, not download links (SHY-0420). The API used to hand back a
 * signed GET URL per attachment, which a moderator could paste anywhere or
 * save — for a stranger's file that is often a photograph of a real person and
 * sometimes of abuse. It now returns a path this panel fetches, rendered
 * inline; there is nothing to hand to a download manager and nothing that
 * outlives the session.
 *
 * A failure is shown rather than swallowed. An attachment that silently does not
 * appear looks exactly like a ticket that never had one, and the moderator would
 * act on a report while unaware evidence exists.
 */
async function loadAttachments(ticketId, card) {
  const slot = card.querySelector(`[data-attachments-for="${CSS.escape(String(ticketId))}"]`);
  if (!slot) return;

  try {
    // `apiCall(method, path, body)`. Passing the path alone put it in the
    // METHOD slot and left `path` undefined, so this fetched
    // `<baseUrl>undefined` and threw before any request left the page -- which
    // surfaced as a red "Attachments could not be loaded" on EVERY ticket,
    // including ones with no attachments, with no request on the wire at all.
    const res = await apiCall(
      'GET',
      `/api/support-tickets/${encodeURIComponent(ticketId)}/attachments`,
    );
    const rows = Array.isArray(res?.attachments) ? res.attachments : [];
    if (rows.length === 0) return;

    // SHY-0449. `viewUrl` is an AUTHENTICATED path, unlike the public CDN URLs
    // this renderer was built for on the Reports and Appeals tabs. An `<img>`
    // cannot send a bearer token, so putting the path straight into `src`
    // answered 401 and drew a broken image -- silently, because a failed image
    // fires no error the page reports. Every support attachment has been
    // invisible to moderators since SHY-0420 moved them off signed URLs.
    //
    // Fetched with the token and handed to the renderer as object URLs. That
    // keeps what SHY-0420 was for: no signed URL, no address that outlives the
    // session, and every read still passing through a route that knows who is
    // asking.
    const paths = rows.map((a) => (typeof a === 'string' ? a : a.viewUrl)).filter(Boolean);
    if (paths.length === 0) return;

    const fetched = await Promise.all(
      paths.map(async (path) => {
        try {
          return await fetchObjectUrl(path);
        } catch {
          // One unreadable attachment must not cost the others. Reported below.
          return null;
        }
      }),
    );
    const urls = fetched.filter(Boolean).map((f) => f.url);
    attachmentObjectUrls.push(...urls);
    if (urls.length === 0) {
      slot.innerHTML =
        '<div style="font-size:11px;color:var(--danger);margin-top:6px;">' +
        'Attachments could not be loaded</div>';
      return;
    }

    // The renderer decides image or video from the URL, and an object URL says
    // nothing about its type -- so the content type from the fetch is passed
    // with it. Without this every video renders as an image with no play badge.
    const entries = fetched
      .filter(Boolean)
      .map((f) => ({ url: f.url, contentType: f.contentType }));
    slot.innerHTML = `<div style="margin-top:8px;">${renderEvidence(entries)}</div>`;

    // Wire the thumbnails, the way `appeals.js` does.
    //
    // Without this the attachments RENDER and do nothing: an admin sees a video
    // with a play badge on it, clicks, and gets no lightbox and no sound. The
    // markup came free with `renderEvidence`; the behaviour did not, and the
    // difference is invisible in a screenshot — which is how it survived a
    // source-scanning guard and a rendering test that only asked whether the
    // thumbnail appeared.
    for (const thumb of slot.querySelectorAll('.evidence-thumb:not([data-wired])')) {
      thumb.dataset.wired = '1';
      thumb.addEventListener('click', () => {
        openEvidenceLightbox(thumb.dataset.evidenceUrl, thumb.dataset.evidenceType);
      });
    }
  } catch (err) {
    slot.innerHTML =
      '<div style="font-size:11px;color:var(--danger);margin-top:6px;">' +
      'Attachments could not be loaded</div>';
  }
}

function renderCard(ticket, status) {
  const card = document.createElement('div');
  card.className = 'appeal-card';

  const raised = ticket.createdAt ? new Date(ticket.createdAt).toLocaleString() : '';
  const uniqueId = ticket.userId ?? '?';
  const category = ticket.category || 'other';

  // Context is an allowlisted set of short strings, but it still came from a
  // client, so it is escaped like everything else.
  const context = ticket.context && typeof ticket.context === 'object' ? ticket.context : {};
  const contextHtml = Object.keys(context).length
    ? `<div style="font-size:11px;color:var(--text2);margin-top:6px;">${Object.entries(context)
        .map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(String(v))}`)
        .join(' &middot; ')}</div>`
    : '';

  // SHY-0396: what somebody ADDED after choosing "it is the problem I already
  // reported". Without this the append endpoint writes their words into
  // Firestore where no human ever reads them -- the same outcome as dropping
  // the message, reached by a longer route.
  //
  // Escaped with the same function as the original message: a follow-up is the
  // same untrusted text, typed by the same person, into the same queue.
  const followUps = Array.isArray(ticket.messages) ? ticket.messages : [];
  // Each follow-up is assembled on ONE source line, because the element it goes
  // in is `white-space: pre-wrap` -- which renders the template literal's own
  // indentation as leading spaces on every line. A prettily-indented template
  // pushed follow-ups ~90px to the right with blank gaps between them. The
  // original message div has always been a single line, which is why it was
  // never affected and the difference was easy to miss.
  const followUpHtml = (m) => {
    const body = escapeHtml(String(m?.message ?? ''));
    const when = m?.addedAt ? ` ${escapeHtml(new Date(m.addedAt).toLocaleString())}` : '';
    return (
      `<div style="margin-top:6px;font-size:13px;white-space:pre-wrap;">${body}</div>` +
      `<div style="font-size:11px;color:var(--text2);">Added${when}</div>`
    );
  };
  const followUpsHtml = followUps.length
    ? `<div style="margin-top:8px;border-left:2px solid var(--text2);padding-left:8px;">${followUps.map(followUpHtml).join('')}</div>`
    : '';

  const resolvedHtml =
    status === 'resolved'
      ? `<div style="font-size:11px;color:var(--text2);margin-top:8px;">
           Resolved by ${escapeHtml(String(ticket.resolvedBy ?? 'unknown'))}
           ${ticket.resolvedAt ? `on ${escapeHtml(new Date(ticket.resolvedAt).toLocaleString())}` : ''}
           ${ticket.adminNote ? `<div style="margin-top:4px;">Note: ${escapeHtml(ticket.adminNote)}</div>` : ''}
         </div>`
      : '';

  // SHY-0439: what became of it, and which report to look in.
  const convertedHtml =
    status === 'converted_to_report'
      ? `<div style="font-size:11px;color:var(--text2);margin-top:8px;">
           Became report ${escapeHtml(String(ticket.convertedToReportId ?? 'unknown'))}
           ${ticket.convertedAt ? `on ${escapeHtml(new Date(ticket.convertedAt).toLocaleString())}` : ''}
         </div>`
      : '';

  // SHY-0438. Offered on EVERY open ticket, not only the safety ones: an admin
  // reading a ticket filed under "other" may be the first person to recognise
  // what it actually is.
  //
  // Deliberately below the resolve row and visually separate from it. It closes
  // somebody's ticket permanently, and a destructive control sitting beside an
  // everyday one gets pressed by accident.
  const convertActionHtml =
    status === 'open'
      ? `<details style="margin-top:10px;border-top:1px solid var(--text2);padding-top:8px;">
           <summary style="font-size:12px;cursor:pointer;">Turn this into a report</summary>
           <div style="font-size:11px;color:var(--text2);margin:6px 0;">
             Files a report in the moderation queue on this person's behalf, carrying
             their message and every attachment. Their ticket is then closed
             permanently and they cannot reopen it.
           </div>
           <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
             <input type="text" data-report-user-for="${escapeHtml(String(ticket.id))}"
                    placeholder="Reported user id"
                    style="flex:1;min-width:160px;padding:6px 8px;font-size:12px;">
             <select data-report-reason-for="${escapeHtml(String(ticket.id))}"
                     style="padding:6px 8px;font-size:12px;">
               <option value="Harassment">Harassment</option>
               <option value="Spam">Spam</option>
               <option value="Inappropriate Content">Inappropriate Content</option>
               <option value="Other">Other</option>
             </select>
             <button class="btn" data-convert-ticket="${escapeHtml(String(ticket.id))}">File report</button>
           </div>
         </details>`
      : '';

  const actionHtml =
    status !== 'open'
      ? ''
      : `<div style="margin-top:10px;display:flex;gap:8px;align-items:center;">
           <input type="text" data-note-for="${escapeHtml(String(ticket.id))}"
                  placeholder="Internal note (optional)"
                  style="flex:1;padding:6px 8px;font-size:12px;">
           <button class="btn" data-resolve-ticket="${escapeHtml(String(ticket.id))}">Resolve</button>
         </div>`;

  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;">
      <div style="font-weight:600;font-size:14px;">#${escapeHtml(String(uniqueId))}</div>
      <div style="font-size:11px;color:var(--text2);">${escapeHtml(category)} &middot; ${escapeHtml(raised)}</div>
    </div>
    <div style="margin-top:8px;font-size:13px;white-space:pre-wrap;">${escapeHtml(String(ticket.message ?? ''))}</div>
    ${followUpsHtml}
    ${contextHtml}
    <div data-attachments-for="${escapeHtml(String(ticket.id))}"></div>
    ${resolvedHtml}
    ${convertedHtml}
    ${actionHtml}
    ${convertActionHtml}`;

  // Attachments are stored as storage KEYS, so the links have to be requested.
  // Fetched per card rather than in the list, which returns up to 200 tickets:
  // signing every attachment of every ticket would be thousands of signatures
  // per page load, nearly all for tickets nobody opens.
  loadAttachments(ticket.id, card);

  return card;
}
