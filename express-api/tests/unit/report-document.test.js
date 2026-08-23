'use strict';

/**
 * One definition of what a report document is — SHY-0438.
 *
 * Until now `POST /reports` was the only thing that could make one, and it
 * always attributed the report to whoever was holding the request. Conversion
 * needs a report attributed to the person who raised the TICKET, not to the
 * admin pressing the button, so the shape had to come out of the route.
 *
 * Pure function, so this needs no doubles and no emulator.
 */

const {
  REPORT_ORIGIN,
  ReportDocumentError,
  buildReportDocument,
} = require('../../src/utils/report-document');

const base = {
  reporterUniqueId: 'u-reporter',
  reporterName: 'Nora',
  reporterDocUniqueId: 'u-reporter',
  reportedUserId: 'firebase-uid-of-raul',
  reportedUserUniqueId: 'u-raul',
  reason: 'Harassment',
  createdAt: 1_750_000_000_000,
};

describe('buildReportDocument', () => {
  test('a directly-filed report is attributed to the person filing it', () => {
    const doc = buildReportDocument({ ...base, origin: REPORT_ORIGIN.DIRECT });
    expect(doc.reporterId).toBe('u-reporter');
    expect(doc.origin).toBe('direct');
    expect(doc.sourceSupportTicketId).toBeNull();
  });

  test('a converted report is attributed to the ticket raiser, never the admin', () => {
    const doc = buildReportDocument({
      ...base,
      origin: REPORT_ORIGIN.SUPPORT_TICKET,
      sourceSupportTicketId: 'ticket-1',
    });
    expect(doc.reporterId).toBe('u-reporter');
    expect(doc.origin).toBe('support_ticket');
    expect(doc.sourceSupportTicketId).toBe('ticket-1');
  });

  test('a new report always starts pending and unactioned', () => {
    const doc = buildReportDocument({ ...base, origin: REPORT_ORIGIN.DIRECT });
    expect({
      status: doc.status,
      actionTaken: doc.actionTaken,
      resolvedAt: doc.resolvedAt,
      resolvedBy: doc.resolvedBy,
    }).toEqual({ status: 'pending', actionTaken: null, resolvedAt: null, resolvedBy: null });
  });

  test('absent optional fields are null, never undefined', () => {
    // Firestore drops undefined; a field that is sometimes absent and sometimes
    // null is a field every reader has to handle twice.
    const doc = buildReportDocument({ ...base, origin: REPORT_ORIGIN.DIRECT });
    const undefinedFields = Object.entries(doc)
      .filter(([, v]) => v === undefined)
      .map(([k]) => k);
    expect(undefinedFields).toEqual([]);
  });

  test('evidence defaults to an empty list rather than absent', () => {
    const doc = buildReportDocument({ ...base, origin: REPORT_ORIGIN.DIRECT });
    expect(doc.evidenceUrls).toEqual([]);
  });

  test('evidence is carried through in order', () => {
    const doc = buildReportDocument({
      ...base,
      origin: REPORT_ORIGIN.SUPPORT_TICKET,
      sourceSupportTicketId: 't',
      evidenceUrls: ['a.jpg', 'b.mp4'],
    });
    expect(doc.evidenceUrls).toEqual(['a.jpg', 'b.mp4']);
  });

  test('an origin outside the known set is refused', () => {
    expect(() => buildReportDocument({ ...base, origin: 'somewhere-else' })).toThrow(/origin/i);
  });

  test('a converted report without its ticket id is refused', () => {
    // The traceability the story requires is not optional: a report that came
    // from a ticket and cannot say which one cannot be traced back.
    expect(() => buildReportDocument({ ...base, origin: REPORT_ORIGIN.SUPPORT_TICKET })).toThrow(
      /sourceSupportTicketId/,
    );
  });

  test('a direct report may not claim a source ticket', () => {
    expect(() =>
      buildReportDocument({
        ...base,
        origin: REPORT_ORIGIN.DIRECT,
        sourceSupportTicketId: 'ticket-1',
      }),
    ).toThrow(/sourceSupportTicketId/);
  });

  test('the reporter is required', () => {
    expect(() =>
      buildReportDocument({ ...base, reporterUniqueId: '', origin: REPORT_ORIGIN.DIRECT }),
    ).toThrow(/reporterUniqueId/);
  });

  test('the reported user is required', () => {
    expect(() =>
      buildReportDocument({ ...base, reportedUserUniqueId: '', origin: REPORT_ORIGIN.DIRECT }),
    ).toThrow(/reportedUserUniqueId/);
  });

  test('reporting yourself is refused', () => {
    expect(() =>
      buildReportDocument({
        ...base,
        reportedUserUniqueId: 'u-reporter',
        origin: REPORT_ORIGIN.DIRECT,
      }),
    ).toThrow(/themselves|yourself|same/i);
  });

  test('the two origins are the only ones', () => {
    // Derived rather than listed, so a third origin added later arrives here.
    expect(Object.values(REPORT_ORIGIN).sort()).toEqual(['direct', 'support_ticket']);
  });
});

describe('what the builder refuses is distinguishable from what breaks', () => {
  /**
   * Callers answer 400 for a refusal and 500 for a fault. Without a type they
   * cannot tell them apart, and a bare catch around this builder once turned a
   * ReferenceError in the calling route into `400 attachmentKeysOf is not
   * defined` -- a bug in our code, presented to an admin as their mistake.
   */
  test('every refusal is a ReportDocumentError', () => {
    const refusals = [
      { ...base, origin: 'nope' },
      { ...base, origin: REPORT_ORIGIN.DIRECT, reporterUniqueId: null },
      { ...base, origin: REPORT_ORIGIN.DIRECT, reportedUserUniqueId: undefined },
      { ...base, origin: REPORT_ORIGIN.DIRECT, reason: '' },
      { ...base, origin: REPORT_ORIGIN.SUPPORT_TICKET },
      { ...base, origin: REPORT_ORIGIN.DIRECT, sourceSupportTicketId: 't' },
      { ...base, origin: REPORT_ORIGIN.DIRECT, reportedUserUniqueId: base.reporterUniqueId },
    ];
    const wrongType = refusals.filter((args) => {
      try {
        buildReportDocument(args);
        return true;
      } catch (err) {
        return !(err instanceof ReportDocumentError);
      }
    });
    expect(wrongType).toEqual([]);
  });

  test('a numeric uniqueId is accepted, because that is how tickets store it', () => {
    // `userId: 10000009` on a support ticket. A guard insisting on a string
    // would refuse to file a safety report for most of the userbase.
    const doc = buildReportDocument({
      ...base,
      reporterUniqueId: 10000009,
      reportedUserUniqueId: 10000042,
      origin: REPORT_ORIGIN.DIRECT,
    });
    expect(doc.reporterId).toBe(10000009);
  });

  test('the same person as a number and as a string is still the same person', () => {
    expect(() =>
      buildReportDocument({
        ...base,
        reporterUniqueId: 10000009,
        reportedUserUniqueId: '10000009',
        origin: REPORT_ORIGIN.DIRECT,
      }),
    ).toThrow(/themselves/);
  });
});
