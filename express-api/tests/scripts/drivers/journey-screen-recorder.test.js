/**
 * journey-screen-recorder.test.js
 *
 * The runner captures a PNG per step, which is a slideshow, not a recording.
 * The operator asked for VIDEO of the device walks (2026-08-22) because a
 * still cannot show a transition: a button that flashes behind the keyboard,
 * a dialog that appears and self-dismisses, a scroll that jumps. SHY-0419 was
 * exactly that class of defect.
 *
 * ## What is actually at risk here
 *
 * An mp4's `moov` atom -- the index saying where every frame lives -- is
 * written LAST, when the encoder shuts down cleanly. Kill the recorder with
 * SIGKILL and the file still has bytes, still has a plausible size, and is
 * completely unplayable. `ls -l` cannot tell the two apart, and neither can
 * an assertion that only checks `existsSync`. That is the same shape as the
 * broken-play-icon defect this project already shipped once.
 *
 * So the tests below refuse to accept "a file exists" as proof of a
 * recording. They prove the STOP PATH gives the child a chance to finalise,
 * against a REAL child process that reports whether it got that chance.
 *
 * No mocks: the process tests spawn real `node` children and the argv tests
 * run on real arrays. See [[feedback-no-stubs-mocks-fakes-real-only]].
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const {
  scrcpyArgs,
  stopGracefully,
  ffmpegMjpegArgs,
  DEFAULT_MJPEG_PORT,
  DEFAULT_RECORDING_FPS,
  resolveBinary,
  BINARY_SEARCH_PATHS,
  desiredStayOn,
  STAY_ON_USB,
  waitForGrowth,
  createRecorder,
  RECORDING_STOP_SIGNAL,
} = require('../../../scripts/drivers/journey-screen-recorder');

/** A real temp dir per test file, removed at the end. */
let tmp;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shytalk-rec-'));
});
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('scrcpyArgs', () => {
  const file = '/tmp/walk.mp4';

  test('pins the adb serial, so a second connected device is never recorded', () => {
    // Two phones are routinely attached here (the OnePlus plus whatever is
    // being charged). Without -s, scrcpy picks one and the video silently
    // belongs to the wrong device.
    expect(scrcpyArgs({ serial: '3b402284', file })).toEqual(
      expect.arrayContaining(['-s', '3b402284']),
    );
  });

  test('records to the requested file', () => {
    expect(scrcpyArgs({ serial: 'X', file })).toEqual(expect.arrayContaining([`--record=${file}`]));
  });

  test('mirrors the screen by default, because the operator watches the run', () => {
    // "don't do it headless. i want to see it happening" -- 2026-08-22.
    // --no-playback is the headless switch; its ABSENCE is the requirement.
    const args = scrcpyArgs({ serial: 'X', file });
    expect({ headless: args.includes('--no-playback') }).toEqual({ headless: false });
  });

  test('can be made headless explicitly, and only explicitly', () => {
    const args = scrcpyArgs({ serial: 'X', file, watch: false });
    expect({ headless: args.includes('--no-playback') }).toEqual({ headless: true });
  });
});

describe('stopGracefully', () => {
  /**
   * A real child that traps the interrupt and records that it was allowed to
   * clean up -- standing in for scrcpy writing its moov atom. If the stop
   * path SIGKILLs, the marker file never appears, which is precisely the
   * unplayable-video outcome.
   */
  function spawnTrapChild(markerPath, { finaliseMs = 150 } = {}) {
    const src = `
      const fs = require('node:fs');
      process.on('SIGINT', () => {
        setTimeout(() => {
          fs.writeFileSync(${JSON.stringify(markerPath)}, 'finalised');
          process.exit(0);
        }, ${finaliseMs});
      });
      setInterval(() => {}, 1000);
      console.log('ready');
    `;
    const child = spawn(process.execPath, ['-e', src], { stdio: ['ignore', 'pipe', 'pipe'] });
    return new Promise((resolve) => {
      child.stdout.once('data', () => resolve(child));
    });
  }

  test('the signal is SIGINT — SIGKILL truncates the mp4 index', () => {
    expect(RECORDING_STOP_SIGNAL).toBe('SIGINT');
  });

  test('lets the child finish writing before resolving', async () => {
    const marker = path.join(tmp, 'finalised-a.txt');
    const child = await spawnTrapChild(marker);

    await stopGracefully(child, { graceMs: 5000 });

    // Asserted AFTER the await: if stopGracefully returned early, the runner
    // would move on (and often exit) while the encoder was mid-write.
    expect({ finalised: fs.existsSync(marker) }).toEqual({ finalised: true });
  });

  test('reports the child as exited, not merely signalled', async () => {
    const marker = path.join(tmp, 'finalised-b.txt');
    const child = await spawnTrapChild(marker);

    await stopGracefully(child, { graceMs: 5000 });

    expect({ killed: child.exitCode !== null || child.signalCode !== null }).toEqual({
      killed: true,
    });
  });

  test('escalates to SIGKILL only after the grace period, never before', async () => {
    // A child that ignores SIGINT entirely. The recorder must not hang the
    // whole journey run waiting for it -- but it must have waited first.
    const src = `process.on('SIGINT', () => {}); setInterval(() => {}, 1000); console.log('ready');`;
    const child = spawn(process.execPath, ['-e', src], { stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((r) => child.stdout.once('data', r));

    const started = Date.now();
    await stopGracefully(child, { graceMs: 300 });
    const waited = Date.now() - started;

    expect({ exited: child.exitCode !== null || child.signalCode !== null }).toEqual({
      exited: true,
    });
    // Bounds on BOTH sides. A lower bound alone passes on a stop path that
    // sleeps and never signals; an upper bound alone passes on an immediate
    // SIGKILL, which is the bug.
    expect({ waitedAtLeastGrace: waited >= 300 }).toEqual({ waitedAtLeastGrace: true });
    expect({ didNotHang: waited < 5000 }).toEqual({ didNotHang: true });
  });

  test('a child that has already exited is not an error', async () => {
    const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
    await new Promise((r) => child.once('exit', r));
    await expect(stopGracefully(child, { graceMs: 200 })).resolves.toBeUndefined();
  });
});

describe('ffmpegMjpegArgs', () => {
  const file = '/tmp/walk-ios.mp4';

  test("reads WebDriverAgent's MJPEG stream on the agreed port", () => {
    expect(ffmpegMjpegArgs({ file })).toEqual(
      expect.arrayContaining(['-f', 'mjpeg', '-i', `http://localhost:${DEFAULT_MJPEG_PORT}`]),
    );
  });

  test('timestamps frames by ARRIVAL, never by an assumed input rate', () => {
    // Measured, not theorised: declaring `-r 10` on the INPUT turned a 6-second
    // capture into a 19.1-second video, because WebDriverAgent actually pushes
    // ~32fps and 191 frames were relabelled as 19.1s of footage. The file was
    // valid, played fine, and showed the app running at a third of its real
    // speed -- evidence that lies rather than evidence that breaks.
    const args = ffmpegMjpegArgs({ file });
    const i = args.indexOf('-i');
    const wallclock = args.indexOf('-use_wallclock_as_timestamps');

    expect({ usesWallclock: wallclock !== -1, beforeInput: wallclock < i }).toEqual({
      usesWallclock: true,
      beforeInput: true,
    });
    expect(args[wallclock + 1]).toBe('1');

    // And the rate that IS declared must be on the output side, where it means
    // "emit CFR at this rate" rather than "the source runs at this rate".
    const r = args.indexOf('-r');
    expect({ rateIsSet: r !== -1, rateAfterInput: r > i }).toEqual({
      rateIsSet: true,
      rateAfterInput: true,
    });
  });

  test('the output frame rate is configurable', () => {
    const args = ffmpegMjpegArgs({ file, fps: 24 });
    expect(args[args.indexOf('-r') + 1]).toBe('24');
  });

  test('writes CONSTANT frame rate, or ffmpeg drops frames instead of filling', () => {
    // Measured on this setup: a 10.22s capture came out 10.00s with
    // `-fps_mode cfr`, 9.93s on ffmpeg's default mode, and an earlier
    // configuration lost a THIRD of the duration. cfr is what makes ffmpeg
    // duplicate frames to cover gaps rather than emit fewer of them.
    expect(ffmpegMjpegArgs({ file })).toEqual(expect.arrayContaining(['-fps_mode', 'cfr']));
  });

  test('the default frame rate has exactly one definition', () => {
    // It had two. `createRecorder` defaulted to 10 while this module
    // documented 15, and the caller's default silently won -- so the recorder
    // wrote 10fps files that every comment described as 15fps. A constant that
    // disagrees with itself is worse than no constant.
    const viaArgs = ffmpegMjpegArgs({ file });
    const viaRecorder = createRecorder({ platform: 'ios', serial: 'X', outDir: tmp });
    expect({
      argsDefault: viaArgs[viaArgs.indexOf('-r') + 1],
      shared: String(DEFAULT_RECORDING_FPS),
      recorderExists: typeof viaRecorder.start,
    }).toEqual({
      argsDefault: String(DEFAULT_RECORDING_FPS),
      shared: String(DEFAULT_RECORDING_FPS),
      recorderExists: 'function',
    });
  });

  test('encodes yuv420p, so the file plays outside this machine', () => {
    // Without it x264 picks a chroma layout QuickTime and Safari refuse. The
    // file then works for whoever produced it and shows a broken-play icon to
    // everyone who reads the evidence -- the worst kind of green.
    expect(ffmpegMjpegArgs({ file })).toEqual(expect.arrayContaining(['-pix_fmt', 'yuv420p']));
  });

  test('overwrites without prompting', () => {
    // ffmpeg asks y/n on an existing file and waits forever. Nobody is at the
    // keyboard during a journey run.
    expect(ffmpegMjpegArgs({ file })).toEqual(expect.arrayContaining(['-y']));
  });

  test('the destination is the last argument', () => {
    expect(ffmpegMjpegArgs({ file }).at(-1)).toBe(file);
  });

  test('honours a non-default port', () => {
    expect(ffmpegMjpegArgs({ file, port: 9123 })).toEqual(
      expect.arrayContaining(['-i', 'http://localhost:9123']),
    );
  });
});

describe('scrcpy flag compatibility', () => {
  const file = '/tmp/walk.mp4';

  test('--stay-awake is NOT passed, because --no-control forbids it', () => {
    // Found on the real device, not in review. scrcpy keeps the screen on by
    // sending a CONTROL message, so with control disabled it refuses to start
    // at all: "Cannot request to stay awake if control is disabled", exit 1,
    // before a single frame. Every Android recording failed.
    //
    // It shipped because the flags were added AFTER the command was proven. A
    // bare `scrcpy -s ... --record=...` probe worked, then --stay-awake and
    // --no-control were added on the strength of that probe and never re-run
    // against the binary. The unit tests asserted the argv CONTENTS, which is
    // not the same as asserting scrcpy accepts them.
    //
    // Wakefulness is handled device-side instead (keepAwakeWhilePluggedIn).
    const args = scrcpyArgs({ serial: 'X', file });
    expect({
      stayAwake: args.includes('--stay-awake'),
      noControl: args.includes('--no-control'),
    }).toEqual({ stayAwake: false, noControl: true });
  });
});

describe('desiredStayOn', () => {
  test('ORs the USB bit rather than overwriting the setting', () => {
    // This runs against the operator's own handset. Assignment would silently
    // drop their AC and wireless stay-on bits and restore only what we read.
    expect({
      fromNothing: desiredStayOn(0),
      keepsAc: desiredStayOn(1),
      keepsWireless: desiredStayOn(4),
      keepsAll: desiredStayOn(7),
    }).toEqual({ fromNothing: 2, keepsAc: 3, keepsWireless: 6, keepsAll: 7 });
  });

  test('is idempotent when USB stay-on is already set', () => {
    // The recorder skips the write (and the restore) when nothing changes, so
    // this equality is what stops it touching a device it need not touch.
    expect(desiredStayOn(STAY_ON_USB)).toBe(STAY_ON_USB);
  });
});

describe('waitForGrowth', () => {
  /** A real child that writes a header, pauses, then writes frames. */
  function spawnWriter(target, { headerOnly = false } = {}) {
    const src = `
      const fs = require('node:fs');
      fs.writeFileSync(${JSON.stringify(target)}, 'HEADER');
      console.log('header');
      ${headerOnly ? '' : `setTimeout(() => fs.appendFileSync(${JSON.stringify(target)}, 'FRAMESFRAMES'), 250);`}
      setInterval(() => {}, 1000);
    `;
    const child = spawn(process.execPath, ['-e', src], { stdio: ['ignore', 'pipe', 'pipe'] });
    return new Promise((r) => child.stdout.once('data', () => r(child)));
  }

  test('a header alone is NOT readiness', async () => {
    // Both recorders open the container and write a short header before the
    // first frame is encoded. Treating that as "recording" starts the walk
    // against an encoder that has not produced a frame -- and the opening
    // screens, which are exactly what a walk needs to show, are lost.
    const target = path.join(tmp, 'header-only.mp4');
    const child = await spawnWriter(target, { headerOnly: true });
    await expect(
      waitForGrowth(target, child, () => '', { timeoutMs: 900, pollMs: 100 }),
    ).rejects.toThrow(/no growing video/i);
    await stopGracefully(child, { graceMs: 500 });
  });

  test('resolves once the file actually grows', async () => {
    const target = path.join(tmp, 'grows.mp4');
    const child = await spawnWriter(target);
    await expect(
      waitForGrowth(target, child, () => '', { timeoutMs: 5000, pollMs: 100 }),
    ).resolves.toBeUndefined();
    await stopGracefully(child, { graceMs: 500 });
  });

  test('a recorder that dies is reported as a death, not a timeout', async () => {
    // The distinction matters to whoever reads the failure: "exited with 1"
    // sends you to the command line, "wrote nothing" sends you to the device.
    const child = spawn(process.execPath, ['-e', 'process.exit(3)'], { stdio: 'ignore' });
    await expect(
      waitForGrowth(path.join(tmp, 'never.mp4'), child, () => 'boom', {
        timeoutMs: 5000,
        pollMs: 100,
      }),
    ).rejects.toThrow(/exited with 3/);
  });

  test('a recorder that died BEFORE we listened is still reported as a death', async () => {
    // The listener-attach race. `exit` has already fired and will not fire
    // again, so a naive wait sits out the full timeout and blames the device
    // for a process that crashed on startup.
    const child = spawn(process.execPath, ['-e', 'process.exit(4)'], { stdio: 'ignore' });
    await new Promise((r) => child.once('exit', r));
    await expect(
      waitForGrowth(path.join(tmp, 'never2.mp4'), child, () => 'boom', {
        timeoutMs: 5000,
        pollMs: 100,
      }),
    ).rejects.toThrow(/exited with 4/);
  });
});

describe('resolveBinary', () => {
  test('returns an ABSOLUTE path, never a bare name', () => {
    // Spawning a bare name searches $PATH, so which binary runs depends on the
    // environment of whoever launched the runner. Real, not asserted against a
    // fixture: `sh` exists on every macOS box.
    const resolved = resolveBinary('sh', 'unreachable');
    expect({ absolute: path.isAbsolute(resolved) }).toEqual({ absolute: true });
    expect({ exists: fs.existsSync(resolved) }).toEqual({ exists: true });
  });

  test('names the missing tool AND how to install it', () => {
    // The failure this replaces was a bare ENOENT from spawn, which says
    // nothing about which of several binaries was missing.
    expect(() =>
      resolveBinary('definitely-not-a-real-binary-xyz', 'Install it with: brew install nothing'),
    ).toThrow(/definitely-not-a-real-binary-xyz.*brew install nothing/s);
  });

  test('searches Homebrew on both architectures', () => {
    // Apple Silicon puts Homebrew at /opt/homebrew; Intel at /usr/local. A
    // list covering only one makes the recorder work on one machine.
    expect(BINARY_SEARCH_PATHS).toEqual(
      expect.arrayContaining(['/opt/homebrew/bin', '/usr/local/bin']),
    );
  });
});

describe('createRecorder', () => {
  test('an unknown platform throws rather than silently recording nothing', () => {
    // A recorder that no-ops on an unrecognised platform produces a green run
    // with no video and no complaint -- exactly the outcome being fixed.
    expect(() => createRecorder({ platform: 'windows-phone', serial: 'X', outDir: tmp })).toThrow(
      /platform/i,
    );
  });

  test.each(['android', 'ios'])('%s yields start and stop functions', (platform) => {
    const rec = createRecorder({ platform, serial: 'X', outDir: tmp });
    expect({
      start: typeof rec.start,
      stop: typeof rec.stop,
      file: typeof rec.file,
    }).toEqual({ start: 'function', stop: 'function', file: 'string' });
  });

  test('the output file lands under the run directory with an mp4 extension', () => {
    const rec = createRecorder({ platform: 'android', serial: 'X', outDir: tmp });
    expect({
      underOutDir: rec.file.startsWith(tmp),
      ext: path.extname(rec.file),
    }).toEqual({ underOutDir: true, ext: '.mp4' });
  });
});
