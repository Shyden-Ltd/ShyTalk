/**
 * Locks the admin-client partial-failure toast contract emitted by
 * /api/reports/:id/resolve and /api/reports/resolve-all/:userId.
 *
 * Covers each Pass-9..Pass-13 response key + their text rendering, the
 * happy path (returns null), the multi-failure ordering, and defensive
 * fallbacks for missing optional fields.
 */
const path = require('path');
const { buildPartialFailureMessage } = require(
  path.resolve(__dirname, '../../../public/admin/js/lib/partial-failure-toast.js'),
);

describe('buildPartialFailureMessage — happy path', () => {
  it('returns null for fully successful response', () => {
    expect(buildPartialFailureMessage({ success: true })).toBeNull();
    expect(buildPartialFailureMessage({ success: true, resolved: 5 })).toBeNull();
  });

  it('returns null for null/undefined input', () => {
    expect(buildPartialFailureMessage(null)).toBeNull();
    expect(buildPartialFailureMessage(undefined)).toBeNull();
  });
});

describe('buildPartialFailureMessage — single-flag rendering', () => {
  it('warning.failed', () => {
    const msg = buildPartialFailureMessage({
      success: true,
      warning: { failed: true, error: 'warning_create_failed' },
    });
    expect(msg).toContain('warning was NOT applied');
    expect(msg).toContain('Please retry');
  });

  it('suspension.failed', () => {
    const msg = buildPartialFailureMessage({
      success: true,
      suspension: { failed: true, error: 'suspension_update_failed' },
    });
    expect(msg).toContain('suspension was NOT applied');
  });

  it('cascade.partial with userDocFailed=true', () => {
    const msg = buildPartialFailureMessage({
      success: true,
      cascade: { partial: true, userDocFailed: true, failedRoomIds: [], rtdbEventsFailed: 0 },
    });
    expect(msg).toContain('user-doc clear failed');
  });

  it('cascade.partial with failed rooms', () => {
    const msg = buildPartialFailureMessage({
      success: true,
      cascade: {
        partial: true,
        userDocFailed: false,
        failedRoomIds: ['r1', 'r2', 'r3'],
        rtdbEventsFailed: 0,
      },
    });
    expect(msg).toContain('3 room(s) need manual cleanup');
  });

  it('cascade.rtdbEventsFailed (Pass-13 L2)', () => {
    const msg = buildPartialFailureMessage({
      success: true,
      cascade: { partial: false, userDocFailed: false, failedRoomIds: [], rtdbEventsFailed: 2 },
    });
    expect(msg).toContain("2 RTDB event(s) didn't deliver");
    expect(msg).toContain('live clients may not see the change');
  });

  it('reports.failed with explicit total', () => {
    const msg = buildPartialFailureMessage({
      success: true,
      reports: { committed: 3, failed: 2, total: 5, error: 'reports_commit_failed' },
    });
    expect(msg).toContain('2/5 reports did not commit');
  });

  it('reports.failed falls back to failed+committed when total missing', () => {
    const msg = buildPartialFailureMessage({
      success: true,
      reports: { committed: 3, failed: 2, error: 'reports_commit_failed' },
    });
    expect(msg).toContain('2/5 reports did not commit');
  });

  it('reports.failed falls back to just failed when committed also missing', () => {
    const msg = buildPartialFailureMessage({
      success: true,
      reports: { failed: 7, error: 'reports_commit_failed' },
    });
    expect(msg).toContain('7/7 reports did not commit');
  });

  it('auditLog.failed', () => {
    const msg = buildPartialFailureMessage({
      success: true,
      auditLog: { failed: true, error: 'audit_write_failed' },
    });
    expect(msg).toContain('audit log failed — escalate to ops');
  });

  it('lockRelease.failed (Pass-12 fix)', () => {
    const msg = buildPartialFailureMessage({
      success: true,
      lockRelease: { failed: true },
    });
    expect(msg).toContain('report lock not released');
    expect(msg).toContain('admin may need to unlock manually');
  });

  it('pms.failed with explicit total', () => {
    const msg = buildPartialFailureMessage({
      success: true,
      pms: { failed: 1, total: 3 },
    });
    expect(msg).toContain('1/3 PMs failed');
  });

  it('pms.failed shows ? when total missing', () => {
    const msg = buildPartialFailureMessage({
      success: true,
      pms: { failed: 2 },
    });
    expect(msg).toContain('2/? PMs failed');
  });
});

describe('buildPartialFailureMessage — multi-failure ordering', () => {
  it('action-blocking failures come first, then audit, then PMs', () => {
    const msg = buildPartialFailureMessage({
      success: true,
      warning: { failed: true, error: 'warning_create_failed' },
      auditLog: { failed: true, error: 'audit_write_failed' },
      pms: { failed: 1, total: 2 },
      lockRelease: { failed: true },
    });
    // Verify ordering: warning before auditLog before lockRelease before pms.
    const warnIdx = msg.indexOf('warning was NOT applied');
    const auditIdx = msg.indexOf('audit log failed');
    const lockIdx = msg.indexOf('report lock not released');
    const pmsIdx = msg.indexOf('PMs failed');
    expect(warnIdx).toBeGreaterThan(-1);
    expect(auditIdx).toBeGreaterThan(warnIdx);
    expect(lockIdx).toBeGreaterThan(auditIdx);
    expect(pmsIdx).toBeGreaterThan(lockIdx);
  });

  it('joins multiple failures with semicolons', () => {
    const msg = buildPartialFailureMessage({
      success: true,
      warning: { failed: true, error: 'warning_create_failed' },
      pms: { failed: 1, total: 2 },
    });
    expect(msg.split('; ').length).toBeGreaterThanOrEqual(2);
  });

  it('combines cascade + rtdbEventsFailed in single response', () => {
    const msg = buildPartialFailureMessage({
      success: true,
      cascade: {
        partial: true,
        userDocFailed: false,
        failedRoomIds: ['r1'],
        rtdbEventsFailed: 1,
      },
    });
    expect(msg).toContain('1 room(s) need manual cleanup');
    expect(msg).toContain("1 RTDB event(s) didn't deliver");
  });
});

describe('buildPartialFailureMessage — defensive', () => {
  it('falsy failed flag does not trigger render', () => {
    const msg = buildPartialFailureMessage({
      success: true,
      warning: { failed: false },
      suspension: { failed: 0 },
    });
    expect(msg).toBeNull();
  });

  it('reports.failed: 0 does not render', () => {
    expect(
      buildPartialFailureMessage({ success: true, reports: { failed: 0, committed: 5, total: 5 } }),
    ).toBeNull();
  });

  it('pms.failed: 0 does not render', () => {
    expect(buildPartialFailureMessage({ success: true, pms: { failed: 0, total: 5 } })).toBeNull();
  });

  it('cascade.rtdbEventsFailed: 0 does not render', () => {
    expect(
      buildPartialFailureMessage({
        success: true,
        cascade: { partial: false, rtdbEventsFailed: 0, failedRoomIds: [] },
      }),
    ).toBeNull();
  });

  it('cascade.failedRoomIds undefined treated as empty', () => {
    const msg = buildPartialFailureMessage({
      success: true,
      cascade: { partial: true, userDocFailed: false },
    });
    expect(msg).toContain('0 room(s) need manual cleanup');
  });
});
