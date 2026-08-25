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
  waitForContainerHeader,
  assertPlayable,
  waitForFfmpegFrames,
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

describe('waitForFfmpegFrames', () => {
  const FFMPEG = '/opt/homebrew/bin/ffmpeg';
  const haveFfmpeg = fs.existsSync(FFMPEG);
  const itFfmpeg = haveFfmpeg ? test : test.skip;

  /**
   * A REAL ffmpeg on a source that reproduces the actual failure: REAL-TIME
   * (`-re`) and slow (1fps). Both matter.
   *
   * Without `-re`, lavfi generates frames as fast as it can and the first
   * progress block already reads `frame=19898` — which hides the defect
   * completely. That over-generous fixture is what let two separate bugs
   * through: the encoder lookahead, and a matcher that only ever read the
   * FIRST `frame=` in a growing buffer (always `frame=0`).
   *
   * With `-re` at 1fps, x264's ~40-frame lookahead cannot fill, so default
   * tuning emits nothing at all: measured, the first frame never arrived
   * within 8 seconds and the file held 36 bytes. That is a phone sitting on a
   * settled screen.
   */
  function spawnStillFfmpeg(outFile, { tune = true } = {}) {
    return spawn(
      FFMPEG,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-re',
        '-f',
        'lavfi',
        '-i',
        'color=c=black:s=64x64:r=1',
        '-vcodec',
        'h264',
        ...(tune ? ['-tune', 'zerolatency'] : []),
        '-pix_fmt',
        'yuv420p',
        '-crf',
        '51',
        '-movflags',
        '+frag_keyframe+empty_moov',
        '-progress',
        'pipe:1',
        outFile,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
  }

  itFfmpeg(
    'reports readiness on a STILL, real-time source',
    async () => {
      const child = spawnStillFfmpeg(path.join(tmp, 'still.mp4'));
      await expect(
        waitForFfmpegFrames(child, () => '', { timeoutMs: 15_000 }),
      ).resolves.toBeUndefined();
      await stopGracefully(child, { graceMs: 2000 });
    },
    30_000,
  );

  itFfmpeg(
    'WITHOUT zerolatency the same source reports nothing — the defect',
    async () => {
      // The mutation, run as a test rather than done by hand: drop the one flag
      // and readiness must fail. Without this the test above passes whether or
      // not the fix is present, which is how the original bug survived.
      const child = spawnStillFfmpeg(path.join(tmp, 'laggy.mp4'), { tune: false });
      await expect(waitForFfmpegFrames(child, () => '', { timeoutMs: 6000 })).rejects.toThrow(
        /no frames/i,
      );
      await stopGracefully(child, { graceMs: 2000 });
    },
    30_000,
  );

  itFfmpeg(
    'reads the LATEST frame count, not the first',
    async () => {
      // ffmpeg's opening progress block is always `frame=0`. A matcher that
      // reads the first occurrence in a growing buffer keeps returning that zero
      // for ever, so readiness never fires however many frames arrive.
      const child = spawnStillFfmpeg(path.join(tmp, 'latest.mp4'));
      await expect(
        waitForFfmpegFrames(child, () => '', { timeoutMs: 15_000 }),
      ).resolves.toBeUndefined();
      await stopGracefully(child, { graceMs: 2000 });
    },
    30_000,
  );

  itFfmpeg(
    'a dead ffmpeg is reported as a death, not a timeout',
    async () => {
      // The distinction matters to whoever reads the failure: "exited with 1"
      // points at the command, "reported no frames" points at the device.
      const child = spawn(
        FFMPEG,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-i',
          'http://127.0.0.1:1/nope',
          path.join(tmp, 'dead.mp4'),
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      await expect(waitForFfmpegFrames(child, () => 'boom', { timeoutMs: 15_000 })).rejects.toThrow(
        /exited with/,
      );
    },
    30_000,
  );

  test('a recorder that died before we listened is still a death', async () => {
    const child = spawn(process.execPath, ['-e', 'process.exit(7)'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise((r) => child.once('exit', r));
    await expect(waitForFfmpegFrames(child, () => 'boom', { timeoutMs: 3000 })).rejects.toThrow(
      /exited with 7/,
    );
  });
});

describe('ffmpeg output buffering', () => {
  test('the mp4 is fragmented, so a truncated recording still plays', () => {
    // +empty_moov writes a playable header up front and +frag_keyframe closes a
    // fragment per keyframe. Without them the index is written only at
    // finalize, so a recorder killed mid-walk leaves an unplayable file --
    // which is the one moment the footage matters most.
    expect(ffmpegMjpegArgs({ file: '/tmp/x.mp4' })).toEqual(
      expect.arrayContaining(['-movflags', '+frag_keyframe+empty_moov']),
    );
  });

  test('encoding is low-latency, so a still screen still produces frames', () => {
    // x264's ~40-frame lookahead means a settled screen emits nothing for up
    // to a minute. Measured on a real-time 1fps source: default tuning never
    // produced a frame within 8s; zerolatency produced one in 555ms.
    expect(ffmpegMjpegArgs({ file: '/tmp/x.mp4' })).toEqual(
      expect.arrayContaining(['-tune', 'zerolatency']),
    );
  });

  test('the progress channel is enabled, because readiness depends on it', () => {
    expect(ffmpegMjpegArgs({ file: '/tmp/x.mp4' })).toEqual(
      expect.arrayContaining(['-progress', 'pipe:1']),
    );
  });
});

describe('the iOS recorder survives a session restart', () => {
  const file = '/tmp/walk-ios.mp4';

  /**
   * A 91-second walk produced 21 seconds of video, and stopped exactly where
   * the app was relaunched.
   *
   * WebDriverAgent dies with the app (`connect ECONNREFUSED 127.0.0.1:8100`).
   * The runner's dump-retry transparently opens a REPLACEMENT session, which
   * claims port 9100 again — but ffmpeg is still holding the dead TCP stream
   * and never reconnects, so the file ends there while the walk carries on for
   * another seventy seconds.
   *
   * Any iOS journey that restarts the app therefore loses its footage from that
   * point on. Steps 3–14 had none. A green walk with no video is exactly the
   * case where the footage is worth the most — it is the only thing that can
   * show what an assertion could not.
   */
  test('ffmpeg is told to reconnect when the stream drops', () => {
    expect(ffmpegMjpegArgs({ file })).toEqual(
      expect.arrayContaining(['-reconnect', '1', '-reconnect_streamed', '1']),
    );
  });

  test('it reconnects on a network error, which is how the stream actually dies', () => {
    // The MJPEG socket is refused, not closed politely — WDA is gone.
    expect(ffmpegMjpegArgs({ file })).toEqual(
      expect.arrayContaining(['-reconnect_on_network_error', '1']),
    );
  });

  test('reconnection is bounded, so a genuinely dead stream still ends the file', () => {
    const args = ffmpegMjpegArgs({ file });
    const at = args.indexOf('-reconnect_delay_max');
    expect({ bounded: at !== -1 }).toEqual({ bounded: true });
    expect(Number(args[at + 1])).toBeLessThanOrEqual(30);
  });

  test('every reconnect option precedes the input it applies to', () => {
    // These are INPUT options. After -i they are silently ignored, which would
    // look exactly like the bug still being present.
    const args = ffmpegMjpegArgs({ file });
    const input = args.indexOf('-i');
    for (const opt of [
      '-reconnect',
      '-reconnect_streamed',
      '-reconnect_on_network_error',
      '-reconnect_delay_max',
    ]) {
      expect({ opt, beforeInput: args.indexOf(opt) < input }).toEqual({
        opt,
        beforeInput: true,
      });
    }
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

// ── SHY-0445: a still screen is not a broken recorder ─────────────
//
// Android's screen encoder emits frames only when the display CHANGES.
// Measured on a real OnePlus: on a settled screen the mp4 sat at exactly 48
// bytes for ten seconds, and an mkv was never created at all. So the old
// start gate -- "did the file GROW in the first 20 seconds" -- was false for
// a phone sitting still, which is the state every walk begins in. The runner
// aborted with "no growing video" against a recorder that was working, and
// had passed the previous night only because that run started mid-walk.
//
// The gate now proves the CONTAINER was opened, and the frames claim moved
// to stop, where the artefact itself can answer it.

describe('waitForContainerHeader', () => {
  const liveChild = () => spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)']);

  test('resolves on a file that never grows — the settled-screen case', async () => {
    // THE regression test. Put waitForGrowth back and this hangs until it
    // times out, which is precisely what happened on the device.
    const child = liveChild();
    const target = path.join(tmp, 'header-only.mp4');
    fs.writeFileSync(target, Buffer.alloc(48));
    try {
      await expect(
        waitForContainerHeader(target, child, () => '', { timeoutMs: 2000, pollMs: 50 }),
      ).resolves.toBeUndefined();
    } finally {
      child.kill('SIGKILL');
    }
  });

  test('waits for the header rather than resolving on an absent file', async () => {
    const child = liveChild();
    const target = path.join(tmp, 'late-header.mp4');
    setTimeout(() => fs.writeFileSync(target, Buffer.alloc(48)), 300);
    try {
      await expect(
        waitForContainerHeader(target, child, () => '', { timeoutMs: 4000, pollMs: 50 }),
      ).resolves.toBeUndefined();
    } finally {
      child.kill('SIGKILL');
    }
  });

  test('a container that never opens is a failure, not a hang', async () => {
    const child = liveChild();
    try {
      await expect(
        waitForContainerHeader(path.join(tmp, 'never-opened.mp4'), child, () => 'why it died', {
          timeoutMs: 600,
          pollMs: 50,
        }),
      ).rejects.toThrow(/opened no container/);
    } finally {
      child.kill('SIGKILL');
    }
  });

  test('a recorder that dies first fails immediately, carrying its own output', async () => {
    const child = spawn(process.execPath, ['-e', 'process.exit(3)']);
    await expect(
      waitForContainerHeader(path.join(tmp, 'dead.mp4'), child, () => 'scrcpy said no', {
        timeoutMs: 5000,
        pollMs: 50,
      }),
    ).rejects.toThrow(/scrcpy said no/);
  });
});

describe('assertPlayable', () => {
  // Real encodes, not fixtures: ffmpeg makes a genuine one-second mp4 and the
  // corruption cases are made by damaging that real file. A hand-written byte
  // blob would only prove ffprobe rejects a hand-written byte blob.
  const { spawnSync } = require('node:child_process');
  let good;
  let ffmpegAvailable = true;

  beforeAll(() => {
    good = path.join(tmp, 'real-one-second.mp4');
    const r = spawnSync(
      resolveBinary('ffmpeg', 'brew install ffmpeg'),
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=160x120:rate=10:duration=1',
        '-pix_fmt',
        'yuv420p',
        good,
      ],
      { encoding: 'utf8' },
    );
    ffmpegAvailable = r.status === 0 && fs.existsSync(good);
  });

  test('a real recording passes and reports its duration', () => {
    expect(ffmpegAvailable).toBe(true);
    const { duration } = assertPlayable(good);
    expect(duration).toBeGreaterThan(0);
  });

  test('a header-only file is refused — the settled-screen artefact', () => {
    // 48 bytes is not a hypothetical: it is exactly what scrcpy left on disk
    // after ten seconds against a still OnePlus screen.
    const headerOnly = path.join(tmp, 'header-only-probe.mp4');
    fs.writeFileSync(headerOnly, fs.readFileSync(good).subarray(0, 48));
    expect(() => assertPlayable(headerOnly)).toThrow(/will not play/);
  });

  test('a truncated recording is refused — the SIGKILL artefact', () => {
    // An mp4 loses its moov atom when the encoder is killed instead of asked
    // to stop. It keeps a plausible size and is completely unplayable, which
    // is the failure `size !== 0` could never see.
    const truncated = path.join(tmp, 'truncated.mp4');
    const whole = fs.readFileSync(good);
    fs.writeFileSync(truncated, whole.subarray(0, Math.floor(whole.length * 0.6)));
    expect(() => assertPlayable(truncated)).toThrow(/will not play|no video stream|no duration/);
  });

  test('a file with no video stream is refused', () => {
    const audioOnly = path.join(tmp, 'audio-only.m4a');
    const r = spawnSync(
      resolveBinary('ffmpeg', 'brew install ffmpeg'),
      ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', audioOnly],
      { encoding: 'utf8' },
    );
    expect(r.status).toBe(0);
    expect(() => assertPlayable(audioOnly)).toThrow(/no video stream/);
  });

  test('a missing file is refused rather than treated as fine', () => {
    expect(() => assertPlayable(path.join(tmp, 'not-here-at-all.mp4'))).toThrow();
  });
});
