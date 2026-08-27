'use strict';

/**
 * What a report document is, in one place — SHY-0438.
 *
 * `POST /reports` used to be the only thing that could make one, and it always
 * attributed the report to whoever was holding the request. SHY-0438 needs a
 * report attributed to the person who raised a support TICKET, filed by an admin
 * on their behalf, so the shape had to come out of the route.
 *
 * Two things this deliberately does NOT do:
 *
 * - It does not resolve identities. `reportedUserUniqueId` must already be
 *   server-resolved by the caller. Trusting a client-supplied value there is the
 *   exact hole `POST /reports` documents: the suspension cascade keys off it, so
 *   a reporter could otherwise choose which account an admin suspends.
 * - It does not write. Callers own their own transaction and their own audit.
 */

/**
 * Raised when the caller asked for a report that cannot exist.
 *
 * Typed so callers can answer 400 for THIS and 500 for everything else. A bare
 * `catch` around the builder turned a ReferenceError in the calling route into
 * "400 attachmentKeysOf is not defined" -- a programming fault presented to an
 * admin as though they had typed something wrong.
 */
class ReportDocumentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReportDocumentError';
  }
}

/** Where a report came from. Reports arriving via support are measurable. */
const REPORT_ORIGIN = Object.freeze({
  DIRECT: 'direct',
  SUPPORT_TICKET: 'support_ticket',
});

const KNOWN_ORIGINS = new Set(Object.values(REPORT_ORIGIN));

/** An id that is actually there, whether it is stored as a number or a string. */
function isPresent(id) {
  if (typeof id === 'number') return Number.isFinite(id);
  return typeof id === 'string' && id.trim().length > 0;
}

/**
 * Build the document. Throws rather than returning a half-formed report: every
 * caller writes what this returns, so a silently-wrong document is a report in
 * the moderation queue that names the wrong person.
 */
function buildReportDocument({
  reporterUniqueId,
  reporterName = null,
  reporterDocUniqueId = null,
  reportedUserId = null,
  reportedUserName = null,
  reportedUserUniqueId,
  conversationId = null,
  messageId = null,
  messageText = null,
  reason,
  description = null,
  evidenceUrls = null,
  origin,
  sourceSupportTicketId = null,
  createdAt,
}) {
  if (!KNOWN_ORIGINS.has(origin)) {
    throw new ReportDocumentError(
      `origin must be one of: ${[...KNOWN_ORIGINS].join(', ')} (received ${JSON.stringify(origin)})`,
    );
  }
  // PRESENCE, not a primitive type. A uniqueId is a number in most of this
  // codebase (`userId: 10000009` on a ticket) and a string in some tests and
  // older documents. A guard that insists on one of the two silently refuses
  // half the real data -- here that would mean refusing to file safety reports
  // for anybody whose id happens to be stored as a number.
  if (!isPresent(reporterUniqueId)) {
    throw new ReportDocumentError('reporterUniqueId is required');
  }
  if (!isPresent(reportedUserUniqueId)) {
    throw new ReportDocumentError('reportedUserUniqueId is required');
  }
  // Compared as text, so 10000009 and '10000009' are the same person. They are,
  // and letting the mismatch through would file a report against somebody by
  // themselves.
  if (String(reporterUniqueId) === String(reportedUserUniqueId)) {
    throw new ReportDocumentError('a person cannot report themselves');
  }
  if (typeof reason !== 'string' || reason.length === 0) {
    throw new ReportDocumentError('reason is required');
  }
  // Traceability is not optional in either direction: a converted report that
  // cannot name its ticket cannot be traced back, and a direct report claiming
  // one would make the support-origin count wrong.
  if (origin === REPORT_ORIGIN.SUPPORT_TICKET && !sourceSupportTicketId) {
    throw new ReportDocumentError(
      'sourceSupportTicketId is required when origin is support_ticket',
    );
  }
  if (origin === REPORT_ORIGIN.DIRECT && sourceSupportTicketId) {
    throw new ReportDocumentError(
      'sourceSupportTicketId is only valid when origin is support_ticket',
    );
  }

  return {
    reporterId: reporterUniqueId,
    reporterName: reporterName ?? null,
    reporterUniqueId: reporterDocUniqueId ?? null,
    reportedUserId: reportedUserId ?? null,
    reportedUserName: reportedUserName ?? null,
    reportedUserUniqueId,
    conversationId: conversationId ?? null,
    messageId: messageId ?? null,
    messageText: messageText ?? null,
    reason,
    description: description ?? null,
    evidenceUrls: evidenceUrls ?? [],
    origin,
    sourceSupportTicketId: sourceSupportTicketId ?? null,
    status: 'pending',
    actionTaken: null,
    resolvedAt: null,
    resolvedBy: null,
    createdAt,
  };
}

module.exports = { REPORT_ORIGIN, ReportDocumentError, buildReportDocument };
