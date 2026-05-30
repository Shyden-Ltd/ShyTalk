jest.mock('child_process');
const { execSync } = require('child_process');

const {
  createIosDriver,
  listMethods,
  selectUdid,
  IOS_METHOD_NAMES,
} = require('../../../scripts/drivers/ios-simctl-driver');

beforeEach(() => {
  jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────
// selectUdid — parses `xcrun simctl list devices booted` output
// ─────────────────────────────────────────────────────────────────────

describe('ios-simctl-driver — selectUdid', () => {
  test('honours preferred UDID when simctl call succeeds (preferred wins over discovered)', () => {
    // selectUdid always invokes simctl first (early-return only on simctl
    // throwing); on success it returns preferred over the parsed UDID.
    execSync.mockReturnValueOnce('');
    const result = selectUdid('00000000-0000-0000-0000-000000000000');
    expect(result).toBe('00000000-0000-0000-0000-000000000000');
    expect(execSync).toHaveBeenCalledTimes(1);
  });

  test('returns null when execSync throws even if preferred UDID is passed', () => {
    execSync.mockImplementationOnce(() => {
      throw new Error('xcrun: simctl unavailable');
    });
    expect(selectUdid('00000000-0000-0000-0000-000000000000')).toBe(null);
  });

  test('extracts RFC-4122 UDID from booted-device line with "(Booted)" marker', () => {
    execSync.mockReturnValueOnce(
      '== Devices ==\n' +
        '-- iOS 17.4 --\n' +
        '    iPhone 15 Pro (DEADBEEF-1234-5678-9ABC-DEF012345678) (Booted)\n',
    );
    expect(selectUdid()).toBe('DEADBEEF-1234-5678-9ABC-DEF012345678');
  });

  test('extracts UDID — picks FIRST booted device when multiple are listed', () => {
    execSync.mockReturnValueOnce(
      '== Devices ==\n' +
        '    iPhone 14 (11111111-1111-1111-1111-111111111111) (Booted)\n' +
        '    iPhone 15 (22222222-2222-2222-2222-222222222222) (Booted)\n',
    );
    expect(selectUdid()).toBe('11111111-1111-1111-1111-111111111111');
  });

  test('case-insensitive UDID match (Booted vs BOOTED vs booted)', () => {
    execSync.mockReturnValueOnce('    iPad Pro (ABCDEF12-3456-7890-ABCD-EF1234567890) (booted)\n');
    expect(selectUdid()).toBe('ABCDEF12-3456-7890-ABCD-EF1234567890');
  });

  test('returns null when simctl throws', () => {
    execSync.mockImplementationOnce(() => {
      throw new Error('xcrun: command not found');
    });
    expect(selectUdid()).toBe(null);
  });

  test('returns null when simctl returns empty output (no booted simulator)', () => {
    execSync.mockReturnValueOnce('');
    expect(selectUdid()).toBe(null);
  });

  test('returns null when output has no parenthesized UDID pattern', () => {
    execSync.mockReturnValueOnce('== Devices ==\n' + '    (no booted devices)\n');
    expect(selectUdid()).toBe(null);
  });

  test('returns null when device line has UDID but no "(Booted)" marker', () => {
    execSync.mockReturnValueOnce(
      '    iPhone 15 (DEADBEEF-1234-5678-9ABC-DEF012345678) (Shutdown)\n',
    );
    expect(selectUdid()).toBe(null);
  });

  test('preferred UDID wins even when simctl WOULD return a different one', () => {
    execSync.mockReturnValueOnce('    iPhone 15 (DEADBEEF-1234-5678-9ABC-DEF012345678) (Booted)\n');
    expect(selectUdid('99999999-9999-9999-9999-999999999999')).toBe(
      '99999999-9999-9999-9999-999999999999',
    );
    // Even with preferred UDID, simctl is still called (selectUdid in this
    // module evaluates the booted list first then chooses preferred over
    // discovered) — pin the contract.
    expect(execSync).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// listMethods — canonical method-name surface
// ─────────────────────────────────────────────────────────────────────

describe('ios-simctl-driver — listMethods', () => {
  test('returns IOS_METHOD_NAMES sorted + deduped', () => {
    const methods = listMethods();
    expect(methods).toEqual([...new Set(IOS_METHOD_NAMES)].sort());
  });

  test('every name starts with "ios"', () => {
    for (const name of listMethods()) {
      expect(name.startsWith('ios')).toBe(true);
    }
  });

  test('matches the devicectl driver method-name surface (1:1 contract)', () => {
    const { listMethods: devicectlList } = require('../../../scripts/drivers/ios-devicectl-driver');
    expect(listMethods()).toEqual(devicectlList());
  });

  test('list is non-empty (catches accidental constant deletion)', () => {
    expect(listMethods().length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// IOS_METHOD_NAMES — content sanity
// ─────────────────────────────────────────────────────────────────────

describe('ios-simctl-driver — IOS_METHOD_NAMES', () => {
  test('contains canonical interaction methods used by runner matchers', () => {
    // iosTap / iosTypeText / iosShowsText / iosUiDump are attached as real
    // implementations on the driver object after stubbing, but they are NOT
    // members of IOS_METHOD_NAMES (which lists only the stub-default surface
    // the runner can call via matchers). Pin the constant's contract.
    const required = ['iosTapByTag', 'iosTapFromSurface', 'iosOpenScreen', 'iosNavigatesToPath'];
    for (const m of required) {
      expect(IOS_METHOD_NAMES).toContain(m);
    }
  });

  test('does NOT include the real-implementation method names (iosTap etc are added later, not stubbed)', () => {
    // These names exist on the driver object but live in createIosDriver,
    // not in the IOS_METHOD_NAMES array. Pin this invariant so a future
    // refactor that moves them into the array (and away from the real
    // implementation) is caught.
    const onlyRealImpls = ['iosTap', 'iosTypeText', 'iosShowsText', 'iosUiDump'];
    for (const name of onlyRealImpls) {
      expect(IOS_METHOD_NAMES).not.toContain(name);
    }
  });

  test('contains no duplicates', () => {
    expect(IOS_METHOD_NAMES.length).toBe(new Set(IOS_METHOD_NAMES).size);
  });
});

// ─────────────────────────────────────────────────────────────────────
// createIosDriver factory
// ─────────────────────────────────────────────────────────────────────

describe('ios-simctl-driver — createIosDriver factory', () => {
  function mockBooted(udid = 'AAAAAAAA-1111-2222-3333-444444444444') {
    execSync.mockReturnValueOnce(`    iPhone (${udid}) (Booted)\n`);
    return udid;
  }

  test('throws when no booted simulator', async () => {
    execSync.mockReturnValueOnce('');
    await expect(createIosDriver()).rejects.toThrow(/No booted iOS Simulator/);
  });

  test('throws with actionable error message (mentions simctl list devices booted)', async () => {
    execSync.mockReturnValueOnce('');
    await expect(createIosDriver()).rejects.toThrow(/xcrun simctl list devices booted/);
  });

  test('honours preferred UDID when simctl returns empty (preferred wins over null discovery)', async () => {
    // selectUdid honours preferred whenever the simctl call SUCCEEDED
    // (didn't throw) — even if the parse found no booted device. So a
    // caller passing preferred can still get a driver even when simctl
    // shows no booted simulator. Pin the contract.
    execSync.mockReturnValueOnce('');
    const driver = await createIosDriver({ udid: '88888888-8888-8888-8888-888888888888' });
    expect(driver._udid).toBe('88888888-8888-8888-8888-888888888888');
  });

  test('throws when simctl itself THROWS even with preferred UDID', async () => {
    // Catch-path returns null regardless of preferred — pinned distinctly
    // from the empty-output path above.
    execSync.mockImplementationOnce(() => {
      throw new Error('xcrun: command not found');
    });
    await expect(createIosDriver({ udid: '88888888-8888-8888-8888-888888888888' })).rejects.toThrow(
      /No booted iOS Simulator/,
    );
  });

  test('returns driver with all IOS_METHOD_NAMES as async methods', async () => {
    mockBooted();
    const driver = await createIosDriver();
    for (const name of IOS_METHOD_NAMES) {
      expect(typeof driver[name]).toBe('function');
    }
  });

  test('returns driver carrying selected UDID on _udid', async () => {
    const udid = mockBooted('11112222-3333-4444-5555-666677778888');
    const driver = await createIosDriver();
    expect(driver._udid).toBe(udid);
  });

  test('driver exposes simctl helper for delegated calls', async () => {
    mockBooted();
    const driver = await createIosDriver();
    expect(typeof driver.simctl).toBe('function');
  });

  test('default stub methods return false', async () => {
    mockBooted();
    const driver = await createIosDriver();
    // Pick a name that is NOT later overridden with a real implementation
    const stubMethod = IOS_METHOD_NAMES.find(
      (n) =>
        n !== 'iosOpenScreen' &&
        n !== 'iosTap' &&
        n !== 'iosTapByTag' &&
        n !== 'iosTypeText' &&
        n !== 'iosShowsText' &&
        n !== 'iosUiDump',
    );
    expect(typeof stubMethod).toBe('string');
    const result = await driver[stubMethod]('persona', 'arg2');
    expect(result).toBe(false);
  });

  test('default stub methods log to stderr with method name and udid', async () => {
    const udid = mockBooted('99998888-7777-6666-5555-444433332222');
    const driver = await createIosDriver();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const stubMethod = IOS_METHOD_NAMES.find(
      (n) =>
        n !== 'iosOpenScreen' &&
        n !== 'iosTap' &&
        n !== 'iosTapByTag' &&
        n !== 'iosTypeText' &&
        n !== 'iosShowsText' &&
        n !== 'iosUiDump',
    );
    await driver[stubMethod]('alice', 42);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const msg = errorSpy.mock.calls[0][0];
    expect(msg).toContain(stubMethod);
    expect(msg).toContain(udid);
    expect(msg).toContain('not implemented yet');
    errorSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────
// iosOpenScreen — real implementation via simctl openurl
// ─────────────────────────────────────────────────────────────────────

describe('ios-simctl-driver — iosOpenScreen', () => {
  function mockBooted(udid = '0FE5C2A4-1111-2222-3333-444444444444') {
    execSync.mockReturnValueOnce(`    iPhone (${udid}) (Booted)\n`);
    return udid;
  }

  test('calls xcrun simctl openurl with shytalk:// scheme', async () => {
    const udid = mockBooted();
    const driver = await createIosDriver();
    execSync.mockReturnValueOnce(''); // openurl success (empty stdout)
    await driver.iosOpenScreen('wallet');
    const cmd = execSync.mock.calls[1][0];
    expect(cmd).toContain('xcrun simctl openurl');
    expect(cmd).toContain(udid);
    expect(cmd).toContain('shytalk://wallet');
  });

  test('returns true when openurl succeeds (empty output)', async () => {
    mockBooted();
    const driver = await createIosDriver();
    execSync.mockReturnValueOnce('');
    expect(await driver.iosOpenScreen('discovery')).toBe(true);
  });

  test('returns false when openurl emits "error 115" (scheme not registered)', async () => {
    mockBooted();
    const driver = await createIosDriver();
    execSync.mockReturnValueOnce(
      "The operation couldn't be completed. (LSApplicationWorkspaceErrorDomain error 115.)",
    );
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(await driver.iosOpenScreen('wallet')).toBe(false);
    expect(errorSpy.mock.calls[0][0]).toContain('shytalk:// scheme is not registered');
    errorSpy.mockRestore();
  });

  test('returns false when openurl emits "failed to open"', async () => {
    mockBooted();
    const driver = await createIosDriver();
    execSync.mockReturnValueOnce('failed to open URL: bad scheme');
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(await driver.iosOpenScreen('rooms')).toBe(false);
    errorSpy.mockRestore();
  });

  test('returns false when execSync throws', async () => {
    mockBooted();
    const driver = await createIosDriver();
    execSync.mockImplementationOnce(() => {
      throw new Error('simctl: communication failure');
    });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(await driver.iosOpenScreen('profile')).toBe(false);
    expect(errorSpy.mock.calls[0][0]).toContain('iosOpenScreen(profile) failed');
    errorSpy.mockRestore();
  });

  // Input rejection isolation per [feedback-input-rejection-isolation]:
  // a reorder regression in iosOpenScreen would still surface because
  // each of these inputs gets concatenated into the deep-link path,
  // which yields a syntactically distinct URL the runner would dispatch
  // and then potentially have inert effects. Pin the cases.
  test.each([
    ['empty string', ''],
    ['whitespace', '   '],
    ['null', null],
    ['undefined', undefined],
  ])(
    'iosOpenScreen with %s screen still invokes openurl (pins call shape)',
    async (_label, screen) => {
      mockBooted();
      const driver = await createIosDriver();
      execSync.mockReturnValueOnce('');
      await driver.iosOpenScreen(screen);
      const cmd = execSync.mock.calls[1][0];
      expect(cmd).toContain('shytalk://');
      expect(cmd).toContain(`xcrun simctl openurl`);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────
// XCUI IPC methods — iosTap / iosTapByTag / iosTypeText / iosShowsText / iosUiDump
// ─────────────────────────────────────────────────────────────────────

describe('ios-simctl-driver — XCUI IPC methods', () => {
  function mockBooted(udid = 'AC1FFEC0-1111-2222-3333-444444444444') {
    execSync.mockReturnValueOnce(`    iPhone (${udid}) (Booted)\n`);
    return udid;
  }

  // Helper: queue mock returns for the (write-cmd, read-result) pair that
  // _sendXcuiCommand drives. The cmd-write call is the first execSync call
  // after createIosDriver; the result-read happens inside the polling loop.
  function queueXcuiCycle(resultJson) {
    execSync.mockReturnValueOnce(''); // cmd-write
    execSync.mockReturnValueOnce(resultJson); // result-read
    execSync.mockReturnValueOnce(''); // result-clear (rm -f)
  }

  describe('iosTap', () => {
    test('returns true when XCUI returns {ok: true}', async () => {
      mockBooted();
      const driver = await createIosDriver();
      queueXcuiCycle('{"ok":true}');
      expect(await driver.iosTap('login-button')).toBe(true);
    });

    test('returns false when XCUI returns {ok: false}', async () => {
      mockBooted();
      const driver = await createIosDriver();
      queueXcuiCycle('{"ok":false}');
      expect(await driver.iosTap('nonexistent')).toBe(false);
    });

    test('sends tap command with id in payload', async () => {
      mockBooted();
      const driver = await createIosDriver();
      queueXcuiCycle('{"ok":true}');
      await driver.iosTap('submit-btn');
      // The first execSync call after factory is the cmd-write; assert
      // payload was written.
      const writeCmd = execSync.mock.calls[1][0];
      expect(writeCmd).toContain('/tmp/qa-cmd.jsonl');
      expect(writeCmd).toContain('"op":"tap"');
      expect(writeCmd).toContain('"id":"submit-btn"');
    });
  });

  describe('iosTapByTag', () => {
    test('delegates to iosTap (same payload, same return)', async () => {
      mockBooted();
      const driver = await createIosDriver();
      queueXcuiCycle('{"ok":true}');
      expect(await driver.iosTapByTag('persona-host')).toBe(true);
    });
  });

  describe('iosTypeText', () => {
    test('sends type command with id + text payload', async () => {
      mockBooted();
      const driver = await createIosDriver();
      queueXcuiCycle('{"ok":true}');
      await driver.iosTypeText('input-field', 'hello world');
      const writeCmd = execSync.mock.calls[1][0];
      expect(writeCmd).toContain('"op":"type"');
      expect(writeCmd).toContain('"id":"input-field"');
      expect(writeCmd).toContain('"text":"hello world"');
    });

    test('returns true on {ok: true} response', async () => {
      mockBooted();
      const driver = await createIosDriver();
      queueXcuiCycle('{"ok":true}');
      expect(await driver.iosTypeText('field', 'val')).toBe(true);
    });
  });

  describe('iosShowsText', () => {
    test('returns true only when data === "true"', async () => {
      mockBooted();
      const driver = await createIosDriver();
      queueXcuiCycle('{"ok":true,"data":"true"}');
      expect(await driver.iosShowsText('expected')).toBe(true);
    });

    test('returns false when data !== "true" (e.g., "false" string)', async () => {
      mockBooted();
      const driver = await createIosDriver();
      queueXcuiCycle('{"ok":true,"data":"false"}');
      expect(await driver.iosShowsText('expected')).toBe(false);
    });

    test('returns false when ok=true but data missing', async () => {
      mockBooted();
      const driver = await createIosDriver();
      queueXcuiCycle('{"ok":true}');
      expect(await driver.iosShowsText('expected')).toBe(false);
    });

    test('sends shows_text op with text payload (not id)', async () => {
      mockBooted();
      const driver = await createIosDriver();
      queueXcuiCycle('{"ok":true,"data":"true"}');
      await driver.iosShowsText('hello');
      const writeCmd = execSync.mock.calls[1][0];
      expect(writeCmd).toContain('"op":"shows_text"');
      expect(writeCmd).toContain('"text":"hello"');
    });
  });

  describe('iosUiDump', () => {
    test('returns data field from {ok: true, data: ...}', async () => {
      mockBooted();
      const driver = await createIosDriver();
      queueXcuiCycle('{"ok":true,"data":"<ui-tree-snapshot>"}');
      expect(await driver.iosUiDump()).toBe('<ui-tree-snapshot>');
    });

    test('returns empty string when response is {ok: false}', async () => {
      mockBooted();
      const driver = await createIosDriver();
      queueXcuiCycle('{"ok":false}');
      expect(await driver.iosUiDump()).toBe('');
    });

    test('sends dump op with id="ui"', async () => {
      mockBooted();
      const driver = await createIosDriver();
      queueXcuiCycle('{"ok":true,"data":"snap"}');
      await driver.iosUiDump();
      const writeCmd = execSync.mock.calls[1][0];
      expect(writeCmd).toContain('"op":"dump"');
      expect(writeCmd).toContain('"id":"ui"');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// _sendXcuiCommand — low-level IPC bridge
// ─────────────────────────────────────────────────────────────────────

describe('ios-simctl-driver — _sendXcuiCommand', () => {
  function mockBooted(udid = 'CE5EDC4D-1111-2222-3333-444444444444') {
    execSync.mockReturnValueOnce(`    iPhone (${udid}) (Booted)\n`);
    return udid;
  }

  test('returns null when cmd-write to qa-cmd.jsonl throws', async () => {
    mockBooted();
    const driver = await createIosDriver();
    execSync.mockImplementationOnce(() => {
      throw new Error('simctl spawn failed');
    });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const result = await driver._sendXcuiCommand({ op: 'tap', id: 'x' });
    expect(result).toBe(null);
    expect(errorSpy.mock.calls[0][0]).toContain('failed to write qa-cmd.jsonl');
    errorSpy.mockRestore();
  });

  test('returns parsed JSON when result file contains valid JSON', async () => {
    mockBooted();
    const driver = await createIosDriver();
    execSync.mockReturnValueOnce(''); // cmd-write
    execSync.mockReturnValueOnce('{"ok":true,"data":"payload"}'); // result-read
    execSync.mockReturnValueOnce(''); // result-clear
    const r = await driver._sendXcuiCommand({ op: 'tap', id: 'x' });
    expect(r).toEqual({ ok: true, data: 'payload' });
  });

  test('returns null on timeout (result file never appears)', async () => {
    mockBooted();
    const driver = await createIosDriver();
    execSync.mockReturnValueOnce(''); // cmd-write
    // All subsequent read attempts throw (mimics "no such file")
    execSync.mockImplementation((cmd) => {
      if (cmd.includes('cat /tmp/qa-result.jsonl')) {
        throw new Error('No such file');
      }
      return '';
    });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const result = await driver._sendXcuiCommand({ op: 'tap', id: 'x' }, { timeoutMs: 250 });
    expect(result).toBe(null);
    expect(errorSpy.mock.calls.some((c) => c[0].includes('timeout'))).toBe(true);
    errorSpy.mockRestore();
  });

  test('clears result file after successful read (rm -f /tmp/qa-result.jsonl)', async () => {
    mockBooted();
    const driver = await createIosDriver();
    execSync.mockReturnValueOnce(''); // cmd-write
    execSync.mockReturnValueOnce('{"ok":true}'); // result-read
    execSync.mockReturnValueOnce(''); // result-clear
    await driver._sendXcuiCommand({ op: 'dump', id: 'ui' });
    const clearCmd = execSync.mock.calls[3][0];
    expect(clearCmd).toContain('rm -f /tmp/qa-result.jsonl');
  });

  test('does NOT throw when result-clear fails (best-effort)', async () => {
    mockBooted();
    const driver = await createIosDriver();
    execSync.mockReturnValueOnce(''); // cmd-write
    execSync.mockReturnValueOnce('{"ok":true}'); // result-read
    execSync.mockImplementationOnce(() => {
      throw new Error('rm: permission denied');
    });
    // Should still resolve with the parsed result
    await expect(driver._sendXcuiCommand({ op: 'tap', id: 'x' })).resolves.toEqual({ ok: true });
  });
});

// ─────────────────────────────────────────────────────────────────────
// close — stateless cleanup
// ─────────────────────────────────────────────────────────────────────

describe('ios-simctl-driver — close', () => {
  test('resolves cleanly (simctl is stateless)', async () => {
    execSync.mockReturnValueOnce('    iPhone (C105E000-1111-2222-3333-444444444444) (Booted)\n');
    const driver = await createIosDriver();
    await expect(driver.close()).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────
// simctl helper — single-quote escaping
// ─────────────────────────────────────────────────────────────────────

describe('ios-simctl-driver — simctl helper', () => {
  function mockBooted(udid = '51AC1ABE-1111-2222-3333-444444444444') {
    execSync.mockReturnValueOnce(`    iPhone (${udid}) (Booted)\n`);
    return udid;
  }

  test('wraps each arg in single quotes (POSIX literal — no shell interpretation)', async () => {
    mockBooted();
    const driver = await createIosDriver();
    execSync.mockReturnValueOnce('output');
    driver.simctl(['list', 'devices', 'booted']);
    const cmd = execSync.mock.calls[1][0];
    expect(cmd).toBe("'xcrun' 'simctl' 'list' 'devices' 'booted'");
  });

  test('returns stdout from execSync', async () => {
    mockBooted();
    const driver = await createIosDriver();
    execSync.mockReturnValueOnce('expected stdout payload');
    expect(driver.simctl(['anything'])).toBe('expected stdout payload');
  });

  test('passes encoding utf8 to execSync', async () => {
    mockBooted();
    const driver = await createIosDriver();
    execSync.mockReturnValueOnce('');
    driver.simctl(['help']);
    const opts = execSync.mock.calls[1][1];
    expect(opts).toMatchObject({ encoding: 'utf8' });
  });
});

// ─────────────────────────────────────────────────────────────────────
// Module export shape
// ─────────────────────────────────────────────────────────────────────

describe('ios-simctl-driver — module exports', () => {
  test('exports the documented surface', () => {
    const mod = require('../../../scripts/drivers/ios-simctl-driver');
    expect(Object.keys(mod).sort()).toEqual(
      ['IOS_METHOD_NAMES', 'createIosDriver', 'listMethods', 'selectUdid'].sort(),
    );
  });
});
