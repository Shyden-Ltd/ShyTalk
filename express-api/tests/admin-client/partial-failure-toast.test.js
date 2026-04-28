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

  it('legacy response shape (no Pass-9..13 keys) returns null (Pass-14 forward-compat)', () => {
    // Pre-Pass-9 responses had no warning/suspension/cascade/etc. keys. After a
    // dev/prod deploy skew, the admin client may briefly receive an older
    // response with `committed`/`failed` at the top level (no `reports.`
    // namespace). The lib must NOT misinterpret those as Pass-9 keys.
    expect(buildPartialFailureMessage({ success: true, committed: 5, failed: 0 })).toBeNull();
    expect(buildPartialFailureMessage({ success: true, committed: 5, failed: 7 })).toBeNull();
  });

  it('numeric-type guard: failed=true (boolean) does NOT trigger reports toast', () => {
    // Pass-14 silent-failure-hunter MEDIUM: a misimplemented backend sending
    // failed: true (boolean) would coerce true > 0 → false on the OLD lib,
    // silently omitting the toast. The numeric-type guard now requires the
    // value to be an actual number before comparison.
    expect(buildPartialFailureMessage({ success: true, reports: { failed: true } })).toBeNull();
    expect(buildPartialFailureMessage({ success: true, pms: { failed: 'yes' } })).toBeNull();
    expect(
      buildPartialFailureMessage({
        success: true,
        cascade: { rtdbEventsFailed: 'broken' },
      }),
    ).toBeNull();
  });
});

describe('buildPartialFailureMessage — ordering invariants', () => {
  it('cascade.partial precedes cascade.rtdbEventsFailed in the message', () => {
    // Pass-14 test-analyzer S3: lock the substring order so a future refactor
    // that shuffles the conditionals can't silently reorder admin-facing text.
    const msg = buildPartialFailureMessage({
      success: true,
      cascade: {
        partial: true,
        userDocFailed: false,
        failedRoomIds: ['r1'],
        rtdbEventsFailed: 2,
      },
    });
    const cascadeIdx = msg.indexOf('room cascade partial');
    const rtdbIdx = msg.indexOf("RTDB event(s) didn't deliver");
    expect(cascadeIdx).toBeGreaterThan(-1);
    expect(rtdbIdx).toBeGreaterThan(cascadeIdx);
  });

  it('warning precedes suspension precedes cascade in the message', () => {
    const msg = buildPartialFailureMessage({
      success: true,
      warning: { failed: true, error: 'warning_create_failed' },
      suspension: { failed: true, error: 'suspension_update_failed' },
      cascade: {
        partial: true,
        userDocFailed: false,
        failedRoomIds: [],
        rtdbEventsFailed: 0,
      },
    });
    const wIdx = msg.indexOf('warning was NOT applied');
    const sIdx = msg.indexOf('suspension was NOT applied');
    const cIdx = msg.indexOf('room cascade partial');
    expect(wIdx).toBeGreaterThan(-1);
    expect(sIdx).toBeGreaterThan(wIdx);
    expect(cIdx).toBeGreaterThan(sIdx);
  });

  it('full chain order locked: every branch fires in canonical order (Pass-15 fix)', () => {
    // Pass-15 test-analyzer criticality 7: a refactor moving `pms` ahead of
    // `auditLog` (e.g. for "delivery first" UX) would silently change the
    // admin-facing message order. Lock all 7 positions with one fixture.
    const msg = buildPartialFailureMessage({
      success: true,
      warning: { failed: true, error: 'warning_create_failed' },
      suspension: { failed: true, error: 'suspension_update_failed' },
      cascade: {
        partial: true,
        userDocFailed: false,
        failedRoomIds: ['r1', 'r2'],
        rtdbEventsFailed: 3,
      },
      reports: { committed: 2, failed: 1, total: 3, error: 'reports_commit_failed' },
      auditLog: { failed: true, error: 'audit_write_failed' },
      lockRelease: { failed: true },
      pms: { failed: 1, total: 4 },
    });
    const expected = [
      'warning was NOT applied',
      'suspension was NOT applied',
      'room cascade partial',
      "RTDB event(s) didn't deliver",
      'reports did not commit',
      'audit log failed — escalate to ops',
      'report lock not released',
      'PMs failed',
    ];
    let lastIdx = -1;
    for (const fragment of expected) {
      const idx = msg.indexOf(fragment);
      expect(idx).toBeGreaterThan(lastIdx);
      lastIdx = idx;
    }
    // Verify exactly 8 semicolon-separated parts (the 8 positions above).
    expect(msg.split('; ').length).toBe(8);
  });
});

describe('buildPartialFailureMessage — Number.isFinite edge cases (Pass-15 fix)', () => {
  // Pass-15 test-analyzer criticality 6: typeof === 'number' admits NaN,
  // ±Infinity, and negatives. NaN > 0 is false, so a misimplemented backend
  // sending `failed: NaN` would silently omit the toast — the exact
  // silent-failure class the lib was created to defend against.

  it('NaN failed counts do not trigger toasts', () => {
    expect(buildPartialFailureMessage({ success: true, reports: { failed: NaN } })).toBeNull();
    expect(buildPartialFailureMessage({ success: true, pms: { failed: NaN } })).toBeNull();
    expect(
      buildPartialFailureMessage({ success: true, cascade: { rtdbEventsFailed: NaN } }),
    ).toBeNull();
  });

  it('Infinity failed counts do not trigger toasts', () => {
    expect(buildPartialFailureMessage({ success: true, reports: { failed: Infinity } })).toBeNull();
    expect(buildPartialFailureMessage({ success: true, pms: { failed: Infinity } })).toBeNull();
    expect(
      buildPartialFailureMessage({ success: true, cascade: { rtdbEventsFailed: -Infinity } }),
    ).toBeNull();
  });

  it('negative failed counts do not trigger toasts (corrupted counter)', () => {
    expect(buildPartialFailureMessage({ success: true, reports: { failed: -3 } })).toBeNull();
    expect(buildPartialFailureMessage({ success: true, pms: { failed: -1 } })).toBeNull();
    expect(
      buildPartialFailureMessage({ success: true, cascade: { rtdbEventsFailed: -1 } }),
    ).toBeNull();
  });

  it('NaN total falls back to computed/fallback (no NaN leaks into rendered text)', () => {
    const msg = buildPartialFailureMessage({
      success: true,
      reports: { failed: 3, committed: 2, total: NaN },
    });
    // total NaN falls back to failed (3) + committed (2) = 5
    expect(msg).toContain('3/5 reports did not commit');
    expect(msg).not.toContain('NaN');
  });

  it('NaN pms.total renders ? (no NaN leak)', () => {
    const msg = buildPartialFailureMessage({
      success: true,
      pms: { failed: 2, total: NaN },
    });
    expect(msg).toContain('2/? PMs failed');
    expect(msg).not.toContain('NaN');
  });
});
