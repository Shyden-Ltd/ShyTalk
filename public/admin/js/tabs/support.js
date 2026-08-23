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
 * Everything from a ticket is escaped on the way in. The message is written by
 * a member of the public and is displayed to an admin, which is precisely the
 * shape of a stored-XSS problem if it is ever trusted.
 */

import { apiCall } from "/js/core/api.js";
import { showToast, escapeHtml } from "/js/core/ui.js";
// Reused, never re-implemented: this already renders BOTH an image and a video
// with a lightbox. SHY-0400 exists because a second, images-only path was built
// beside it and the video branch became unreachable.
// `/admin/js/...`, NOT `/js/...`. The served roots are not the same: `/js/`
// maps to public/js (core only) and the tabs live under public/admin/js. A
// 404 on an ES module import aborts the ENTIRE module, so this one wrong
// prefix left the Support tab rendering nothing at all -- no tickets, no
// empty state -- in every browser, while every source-scanning test stayed
// green. `main.js` had it right all along.
import { renderEvidence, openEvidenceLightbox } from "/admin/js/tabs/users.js";

// ── State ──────────────────────────────────────────────────────────

let currentFilter = "open";

// ── Public API ─────────────────────────────────────────────────────

export function init() {
  for (const btn of document.querySelectorAll("[data-support-filter]")) {
    btn.addEventListener("click", () => {
      for (const b of document.querySelectorAll("[data-support-filter]")) {
        b.classList.remove("active");
      }
      btn.classList.add("active");
      currentFilter = btn.dataset.supportFilter;
      load(currentFilter);
    });
  }
}

export function activate() {
  load(currentFilter);
}

export function deactivate() {}

// ── Internal ───────────────────────────────────────────────────────

async function load(status) {
  const list = document.getElementById("support-list");
  if (!list) return;
  list.innerHTML =
    '<div style="color:var(--text2);font-size:13px;">Loading...</div>';

  try {
    const raw = await apiCall("GET", `/api/support-tickets?status=${status}`);
    const tickets = Array.isArray(raw) ? raw : raw.tickets || [];

    if (tickets.length === 0) {
      list.innerHTML =
        '<div style="color:var(--text2);font-size:13px;font-style:italic;">No support tickets found</div>';
      return;
    }

    list.innerHTML = "";
    for (const ticket of tickets) {
      list.appendChild(renderCard(ticket, status));
    }

    for (const btn of list.querySelectorAll("[data-resolve-ticket]")) {
      btn.addEventListener("click", async () => {
        if (btn.disabled) return;
        const ticketId = btn.dataset.resolveTicket;
        const noteInput = list.querySelector(`[data-note-for="${ticketId}"]`);
        const adminNote = noteInput ? noteInput.value.trim() : "";
        btn.disabled = true;
        try {
          await apiCall("PATCH", `/api/support-tickets/${ticketId}`, {
            status: "resolved",
            ...(adminNote ? { adminNote } : {}),
          });
          showToast("Ticket resolved");
          load(currentFilter);
        } catch (err) {
          showToast(err.message, "error");
        } finally {
          btn.disabled = false;
        }
      });
    }
  } catch (err) {
    list.textContent = "";
    const errDiv = document.createElement("div");
    errDiv.style.cssText = "color:var(--danger);font-size:13px;";
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
  const slot = card.querySelector(
    `[data-attachments-for="${CSS.escape(String(ticketId))}"]`,
  );
  if (!slot) return;

  try {
    // `apiCall(method, path, body)`. Passing the path alone put it in the
    // METHOD slot and left `path` undefined, so this fetched
    // `<baseUrl>undefined` and threw before any request left the page -- which
    // surfaced as a red "Attachments could not be loaded" on EVERY ticket,
    // including ones with no attachments, with no request on the wire at all.
    const res = await apiCall(
      "GET",
      `/api/support-tickets/${encodeURIComponent(ticketId)}/attachments`,
    );
    const rows = Array.isArray(res?.attachments) ? res.attachments : [];
    if (rows.length === 0) return;
    // Each row is `{ index, viewUrl, contentType }`. The renderer wants URLs,
    // and a view path is a URL — it simply is not a downloadable one.
    const urls = rows.map((a) => (typeof a === "string" ? a : a.viewUrl)).filter(Boolean);
    if (urls.length === 0) return;
    slot.innerHTML = `<div style="margin-top:8px;">${renderEvidence(urls)}</div>`;

    // Wire the thumbnails, the way `appeals.js` does.
    //
    // Without this the attachments RENDER and do nothing: an admin sees a video
    // with a play badge on it, clicks, and gets no lightbox and no sound. The
    // markup came free with `renderEvidence`; the behaviour did not, and the
    // difference is invisible in a screenshot — which is how it survived a
    // source-scanning guard and a rendering test that only asked whether the
    // thumbnail appeared.
    for (const thumb of slot.querySelectorAll(
      ".evidence-thumb:not([data-wired])",
    )) {
      thumb.dataset.wired = "1";
      thumb.addEventListener("click", () => {
        openEvidenceLightbox(
          thumb.dataset.evidenceUrl,
          thumb.dataset.evidenceType,
        );
      });
    }
  } catch (err) {
    slot.innerHTML =
      '<div style="font-size:11px;color:var(--danger);margin-top:6px;">' +
      "Attachments could not be loaded</div>";
  }
}

function renderCard(ticket, status) {
  const card = document.createElement("div");
  card.className = "appeal-card";

  const raised = ticket.createdAt
    ? new Date(ticket.createdAt).toLocaleString()
    : "";
  const uniqueId = ticket.userId ?? "?";
  const category = ticket.category || "other";

  // Context is an allowlisted set of short strings, but it still came from a
  // client, so it is escaped like everything else.
  const context =
    ticket.context && typeof ticket.context === "object" ? ticket.context : {};
  const contextHtml = Object.keys(context).length
    ? `<div style="font-size:11px;color:var(--text2);margin-top:6px;">${Object.entries(
        context,
      )
        .map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(String(v))}`)
        .join(" &middot; ")}</div>`
    : "";

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
    const body = escapeHtml(String(m?.message ?? ""));
    const when = m?.addedAt
      ? ` ${escapeHtml(new Date(m.addedAt).toLocaleString())}`
      : "";
    return (
      `<div style="margin-top:6px;font-size:13px;white-space:pre-wrap;">${body}</div>` +
      `<div style="font-size:11px;color:var(--text2);">Added${when}</div>`
    );
  };
  const followUpsHtml = followUps.length
    ? `<div style="margin-top:8px;border-left:2px solid var(--text2);padding-left:8px;">${followUps.map(followUpHtml).join("")}</div>`
    : "";

  const resolvedHtml =
    status === "resolved"
      ? `<div style="font-size:11px;color:var(--text2);margin-top:8px;">
           Resolved by ${escapeHtml(String(ticket.resolvedBy ?? "unknown"))}
           ${ticket.resolvedAt ? `on ${escapeHtml(new Date(ticket.resolvedAt).toLocaleString())}` : ""}
           ${ticket.adminNote ? `<div style="margin-top:4px;">Note: ${escapeHtml(ticket.adminNote)}</div>` : ""}
         </div>`
      : "";

  const actionHtml =
    status === "resolved"
      ? ""
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
    <div style="margin-top:8px;font-size:13px;white-space:pre-wrap;">${escapeHtml(String(ticket.message ?? ""))}</div>
    ${followUpsHtml}
    ${contextHtml}
    <div data-attachments-for="${escapeHtml(String(ticket.id))}"></div>
    ${resolvedHtml}
    ${actionHtml}`;

  // Attachments are stored as storage KEYS, so the links have to be requested.
  // Fetched per card rather than in the list, which returns up to 200 tickets:
  // signing every attachment of every ticket would be thousands of signatures
  // per page load, nearly all for tickets nobody opens.
  loadAttachments(ticket.id, card);

  return card;
}
