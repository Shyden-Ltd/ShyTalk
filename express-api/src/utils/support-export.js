/**
 * What a data export says about a support ticket (SHY-0421).
 *
 * A support ticket is a message somebody wrote about their own account — their
 * personal data by any reading, and the one user→admin queue the export
 * missed. Reports and appeals were both already in there, so this was drift
 * rather than a decision.
 *
 * Pure, so the redaction rules below can be pinned exactly. They are the part
 * worth being careful about: a support queue holds other people's words as
 * well as the requester's.
 */

'use strict';

/**
 * Shape one ticket for export, or null if the row is unusable.
 *
 * DELIBERATELY OMITTED, and why:
 *
 * - `adminNote` — written by staff ABOUT the case, not by the person. The
 *   other queues already draw this line, and the note can name or characterise
 *   somebody else.
 * - `resolvedBy` — another person's identifier is their data, not the
 *   requester's.
 * - `userId` — the requester already knows who they are, and echoing an
 *   internal id into a file that leaves our control adds nothing.
 *
 * Attachments are REFERENCED, never embedded: the bytes are as often
 * photographs of other people as of the requester, and an export is a file
 * that leaves our control. A key and a content type say what was attached
 * without shipping it.
 */
function supportTicketForExport(ticket) {
  if (!ticket || typeof ticket !== 'object') return null;

  const messages = Array.isArray(ticket.messages)
    ? ticket.messages.map((m) => ({ message: m?.message, createdAt: m?.createdAt ?? null }))
    : [];

  const attachments = Array.isArray(ticket.attachments)
    ? ticket.attachments.map((a) => ({ r2Key: a?.r2Key, contentType: a?.contentType ?? null }))
    : [];

  return {
    id: ticket.id,
    message: ticket.message,
    category: ticket.category ?? null,
    status: ticket.status ?? null,
    createdAt: ticket.createdAt ?? null,
    resolvedAt: ticket.resolvedAt ?? null,
    messages,
    attachments,
  };
}

module.exports = { supportTicketForExport };
