/**
 * Locks the admin-client partial-failure toast contract emitted by
 * /api/reports/:id/resolve and /api/reports/resolve-all/:userId.
 *
 * Covers each Pass-9..Pass-13 response key + their text rendering, the
 * happy path (returns null), the multi-failure ordering, and defensive
 * fallbacks for missing optional fields.
 */
const path = require('path');
const { buildPartialFailureMessage, showResultToast } = require(
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

  it('suggestionsCascade.partial with failed suggestions', () => {
    const msg = buildPartialFailureMessage({
      success: true,
      suggestionsCascade: {
        partial: true,
        failedSuggestionIds: ['sug-1', 'sug-2'],
        error: 'Firestore unavailable',
      },
    });
    expect(msg).toContain('suggestion cascade partial');
    expect(msg).toContain('2 suggestion(s) need manual cleanup');
  });

  it('suggestionsCascade.partial with empty failedSuggestionIds (cascade utility threw)', () => {
    const msg = buildPartialFailureMessage({
      success: true,
      suggestionsCascade: {
        partial: true,
        failedSuggestionIds: [],
        error: 'cascade_failed',
      },
    });
    expect(msg).toContain('suggestion cascade partial');
    // Falls back to a generic "manual cleanup" hint when the failed list
    // is empty (utility threw before populating failedSuggestionIds).
    expect(msg).toContain('manual cleanup');
  });

  it('suggestionsCascade.partial=false does NOT render even with non-empty failedSuggestionIds', () => {
    // Defensive: protects against a state contradiction where a future code path
    // sets failedSuggestionIds without flipping `partial: true`. The toast must
    // gate on `partial`, not on failed-list length, so a fully-committed cascade
    // never produces a misleading "partial" toast.
    const result = buildPartialFailureMessage({
      success: true,
      suggestionsCascade: {
        partial: false,
        failedSuggestionIds: ['sug-this-should-not-render'],
        error: null,
      },
    });
    expect(result).toBeNull();
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
    // admin-facing message order. Lock all positions with one fixture.
    //
    // Reviewer-flagged 2026-06-04: the suggestions ban-cascade (slot 4, between
    // room cascade and RTDB events) was added without being represented here,
    // so the fixture didn't lock its position. Now included.
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
      suggestionsCascade: {
        partial: true,
        failedSuggestionIds: ['sug-1'],
        error: 'Firestore unavailable',
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
      'suggestion cascade partial',
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
    // Verify exactly 9 semicolon-separated parts (the 9 positions above).
    expect(msg.split('; ').length).toBe(9);
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

describe('showResultToast — shared helper for tab handlers', () => {
  let calls;
  const fakeToast = (msg, kind) => calls.push({ msg, kind });
  beforeEach(() => {
    calls = [];
  });

  it('shows error toast on partial failure', () => {
    showResultToast(fakeToast, { pms: { failed: 1, total: 1 } }, 'OK');
    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe('error');
    expect(calls[0].msg).toContain('PMs failed');
  });

  it('shows success toast on full success', () => {
    showResultToast(fakeToast, { success: true }, 'Done');
    expect(calls).toEqual([{ msg: 'Done', kind: 'success' }]);
  });

  it('shows nothing on full success when successMessage is null', () => {
    // Used by autosave handlers that don't want a success toast.
    showResultToast(fakeToast, { success: true }, null);
    expect(calls).toEqual([]);
  });

  it('shows nothing on full success when successMessage is undefined', () => {
    showResultToast(fakeToast, { success: true });
    expect(calls).toEqual([]);
  });

  it('partial failure overrides null successMessage (always surface failures)', () => {
    showResultToast(fakeToast, { pms: { failed: 1, total: 2 } }, null);
    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe('error');
  });

  // Defensive cases — these cover what happens when the API response
  // is malformed or callers pass unexpected shapes. The lib markets
  // itself as "the silent-failure class this lib defends against",
  // so the defensive surface needs to be locked.

  it('null result body falls through to success (no toast on null successMessage)', () => {
    // If the API call returned null body (rare but possible — e.g. 204),
    // buildPartialFailureMessage(null) returns null → success path runs.
    showResultToast(fakeToast, null, null);
    expect(calls).toEqual([]);
  });

  it('null result body shows success toast when successMessage given', () => {
    showResultToast(fakeToast, null, 'Worked');
    expect(calls).toEqual([{ msg: 'Worked', kind: 'success' }]);
  });

  it('undefined result body behaves the same as null', () => {
    showResultToast(fakeToast, undefined, 'Worked');
    expect(calls).toEqual([{ msg: 'Worked', kind: 'success' }]);
  });

  it('string-shaped result (not an object) falls through to success', () => {
    // A misimplemented backend returning a string instead of {pms:…}
    // shouldn't trigger a partial-failure toast — there's nothing to
    // grep against. Show the success message, not a confusing error.
    showResultToast(fakeToast, 'whatever', 'OK');
    expect(calls).toEqual([{ msg: 'OK', kind: 'success' }]);
  });

  it('result with pms but failed=0 shows success', () => {
    // The "no failures" case still passes through pms but isPositiveCount
    // rejects 0 → success path. Locks against accidental "show partial
    // even when failed=0" regression.
    showResultToast(fakeToast, { pms: { failed: 0, total: 5 } }, 'OK');
    expect(calls).toEqual([{ msg: 'OK', kind: 'success' }]);
  });

  it('throws if showToast is not a function', () => {
    // If a caller forgets to pass showToast, fail loudly rather than
    // silently dropping the toast. (Catching this in tests beats
    // catching it in production.)
    expect(() => {
      showResultToast(undefined, { pms: { failed: 1, total: 1 } }, 'OK');
    }).toThrow(TypeError);
  });
});
