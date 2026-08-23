/**
 * journey-screen-recorder.js
 *
 * Video of a device walk, for both phones, from one interface.
 *
 * WHY
 * ---
 * The runner already writes a PNG per step. A still cannot show a
 * TRANSITION, and transitions are where this project's device defects live:
 * SHY-0419's Send button was drawn under the keyboard, visible for the frames
 * between the IME opening and the layout settling. Every assertion passed;
 * only a human watching caught it. The operator asked for recordings on
 * 2026-08-22 for exactly that reason.
 *
 * HOW, PER PLATFORM
 * -----------------
 * Android -- `scrcpy --record`. The video is encoded on the MAC, not the
 *   phone. This matters: on the OnePlus (ColorOS) the on-device `screenrecord`
 *   binary cannot open an output path under any directory reachable from
 *   `adb shell` -- /sdcard, /sdcard/Movies, /sdcard/DCIM and /data/local/tmp
 *   all return "Permission denied". scrcpy sidesteps the device's storage
 *   rules entirely by streaming frames over the adb socket. It also MIRRORS
 *   the screen on the Mac while it records, which is what the operator means
 *   by not running headless.
 *
 * iOS -- `ffmpeg` reading WebDriverAgent's MJPEG stream. WDA already publishes
 *   the phone's screen on localhost while a session is open, so the frames are
 *   there for the taking and no second connection to the device is needed.
 *
 *   Two other routes were tried and rejected, both for real reasons:
 *     - `ffmpeg -f avfoundation` cannot SEE a USB iPhone. macOS hides iOS
 *       screen-capture devices behind a CMIO flag that ffmpeg never sets, so
 *       the phone is simply absent from `-list_devices`.
 *     - Appium's own `start_recording_screen` answers 500 with "The screen
 *       capture process 'ffmpeg' died unexpectedly" on this setup, while
 *       ffmpeg run directly against the SAME stream records it fine. The fault
 *       is inside Appium's invocation, not the toolchain -- so this module
 *       drives ffmpeg itself rather than depending on that path.
 *
 *   The happy side effect is symmetry: both platforms are now Mac-side
 *   recorders that finalise on SIGINT, sharing one stop path.
 *
 * THE FAILURE THIS MODULE EXISTS TO PREVENT
 * -----------------------------------------
 * An mp4's `moov` atom -- the index naming where every frame lives -- is
 * written LAST, at clean shutdown. A SIGKILLed recorder leaves a file with
 * bytes, a sensible size, and no index: unplayable, and indistinguishable
 * from a good one by `existsSync` or `ls -l`. So stopping is a first-class
 * operation here, not a `child.kill()` call at a teardown site.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync, execFileSync } = require('node:child_process');

/**
 * SIGINT, always. scrcpy traps it and finalises the container; SIGKILL cannot
 * be trapped and truncates the index. Exported so the test can pin it -- a
 * future "just use SIGKILL, it's faster" edit has to argue with a red test.
 */
const RECORDING_STOP_SIGNAL = 'SIGINT';

/** How long a recorder gets to write its index before we stop being polite. */
const DEFAULT_GRACE_MS = 10_000;

/**
 * How long to wait for the first frames to reach the file before giving up.
 *
 * Generous on purpose. Recording is ALREADY running while this waits, so a
 * long wait costs nothing but a slightly later start to the walk, whereas a
 * short one aborts a healthy run on a slow first flush.
 */
const RECORDING_READY_TIMEOUT_MS = 20_000;

/**
 * Argv for scrcpy.
 *
 * Split out from the spawn so it can be asserted directly: the serial pin and
 * the absence of `--no-playback` are both requirements, and both are invisible
 * once buried in a spawn call.
 *
 * @param {object} o
 * @param {string} o.serial   adb serial to pin. Two phones are routinely
 *                            attached; without this scrcpy picks one.
 * @param {string} o.file     destination mp4.
 * @param {boolean} [o.watch] mirror the screen while recording (default true).
 * @param {string} [o.bitRate]
 * @returns {string[]}
 */
function scrcpyArgs({ serial, file, watch = true, bitRate = '8M' }) {
  const args = [
    '-s',
    serial,
    `--record=${file}`,
    '--video-bit-rate',
    bitRate,
    // The walk drives the device over adb; scrcpy is here to observe, and a
    // stray click on the mirror window must not perturb the run.
    //
    // `--stay-awake` CANNOT be combined with this. scrcpy keeps the screen on
    // by sending a control message, so with control disabled it refuses to
    // start at all -- "Cannot request to stay awake if control is disabled",
    // exit 1, before a single frame is written (scrcpy 4.1). An unperturbable
    // walk is the stronger requirement, so wakefulness is handled device-side
    // instead; see `keepAwakeWhilePluggedIn`.
    '--no-control',
  ];
  // The operator watches these runs. `--no-playback` is the headless switch,
  // so it is added only when headless was asked for explicitly.
  if (!watch) args.push('--no-playback');
  return args;
}

/**
 * Stop a recorder and WAIT for it to finish writing.
 *
 * Resolves once the child has actually exited. Escalates to SIGKILL only
 * after `graceMs`, so a wedged recorder cannot hang a journey run -- but it
 * gets its chance first, which is the entire point.
 *
 * @param {import('node:child_process').ChildProcess} child
 * @param {{graceMs?: number}} [o]
 * @returns {Promise<void>}
 */
function stopGracefully(child, { graceMs = DEFAULT_GRACE_MS } = {}) {
  // Already gone: nothing to finalise, and signalling a reaped pid can hit an
  // unrelated process. Not an error -- a journey that failed early may have
  // taken the recorder with it.
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();

  return new Promise((resolve) => {
    // Armed BEFORE the signal so it can be a const, and so an exception from
    // kill() below still lands in a scope that can clear it.
    const hardKill = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch (_e) {
        /* already gone */
      }
    }, graceMs);
    // Do not hold the event loop open on the escalation timer alone.
    if (typeof hardKill.unref === 'function') hardKill.unref();

    const done = () => {
      clearTimeout(hardKill);
      resolve();
    };
    child.once('exit', done);
    child.once('error', done);

    try {
      child.kill(RECORDING_STOP_SIGNAL);
    } catch (_e) {
      // Raced with its own exit between the check above and here.
      done();
    }
  });
}

/**
 * Default MJPEG port. WebDriverAgent's stream, pinned in the iOS driver's
 * capabilities so both ends agree on one number rather than both defaulting.
 */
const DEFAULT_MJPEG_PORT = 9100;

/**
 * Output frame rate for the iOS recording. High enough to show a
 * transition, low enough that a long walk stays a reasonable file size.
 * ONE constant, because a second default in `createRecorder` silently won
 * and produced 10fps files while this module documented 15.
 */
const DEFAULT_RECORDING_FPS = 15;

/**
 * Argv for the iOS recorder.
 *
 * Split out for the same reason as `scrcpyArgs`: the frame rate and the pixel
 * format are requirements, not incidental flags, and they vanish if inlined
 * into a spawn.
 *
 * `-pix_fmt yuv420p` is not decoration -- without it x264 picks a chroma
 * layout QuickTime and Safari refuse to play, which produces a file that
 * works on the machine that made it and shows a broken-play icon everywhere
 * the evidence is actually read.
 *
 * TIMING is the other thing that must be right, and it is easy to get wrong
 * in a way that still produces a perfectly valid file. An MJPEG stream carries
 * no timestamps. Declaring an INPUT rate (`-r N` before `-i`) is a GUESS about
 * how fast WebDriverAgent pushes frames, and a wrong guess rescales time: a
 * 6-second capture measured at 191 frames came out as a 19.1-second video
 * playing everything at a third of speed. Nothing about that file looks
 * broken -- it just quietly lies about how the app behaved, which is worse
 * than a corrupt file for something used as evidence.
 *
 * So the arrival time of each frame is used instead of a declared rate, and
 * the OUTPUT rate is fixed so the result is constant-frame-rate and plays
 * everywhere.
 *
 * @param {object} o
 * @param {string} o.file
 * @param {number} [o.port]
 * @param {number} [o.fps]  OUTPUT frame rate.
 * @returns {string[]}
 */
function ffmpegMjpegArgs({ file, port = DEFAULT_MJPEG_PORT, fps = DEFAULT_RECORDING_FPS }) {
  return [
    '-hide_banner',
    '-loglevel',
    'warning',
    // Overwrite: a run whose previous attempt left a file must not stall on
    // an interactive y/n prompt that nobody is there to answer.
    '-y',
    '-f',
    'mjpeg',
    // Reconnect when the stream drops. INPUT options — after `-i` they are
    // silently ignored, which looks exactly like the bug still being present.
    //
    // A 91-second walk produced 21 seconds of video and stopped precisely where
    // the app was relaunched. WebDriverAgent dies with the app
    // (`connect ECONNREFUSED 127.0.0.1:8100`); the runner's dump-retry opens a
    // REPLACEMENT session which claims port 9100 again, but ffmpeg was still
    // holding the dead socket and never came back. Steps 3-14 had no footage at
    // all — and a green walk with no video is exactly the case where footage is
    // worth the most, because it is the only thing that shows what an assertion
    // could not.
    '-reconnect',
    '1',
    '-reconnect_streamed',
    '1',
    // The socket is REFUSED, not closed politely, so the ordinary reconnect is
    // not enough on its own.
    '-reconnect_on_network_error',
    '1',
    // Bounded: a genuinely dead stream must still end the file rather than
    // leaving the runner waiting on a recorder that will never return.
    '-reconnect_delay_max',
    '10',
    // Stamp each frame with the moment it actually arrived, rather than
    // assuming a rate. This is what keeps playback in step with real time.
    '-use_wallclock_as_timestamps',
    '1',
    '-i',
    `http://localhost:${port}`,
    '-vcodec',
    'h264',
    // Low-latency encoding, and the ROOT CAUSE of the recorder appearing to
    // hang on a settled screen.
    //
    // x264 buffers roughly 40 frames of lookahead before it emits anything. A
    // phone sitting still sends very few frames, so those 40 can take a
    // MINUTE to accumulate — during which ffmpeg is alive and correct, the
    // file holds only its 48-byte header, and `frame=` reports 0. Measured on
    // a real-time 1fps source: with default tuning the first frame never
    // arrived within 8s; with `zerolatency` it arrived in 555ms.
    //
    // That is why recording looked healthy in every probe and failed the
    // moment the app started working — a busy home screen filled the lookahead,
    // a settled sign-in screen did not. A recorder that only works while
    // something is happening cannot record a screen that hangs, which is
    // exactly the failure worth filming.
    '-tune',
    'zerolatency',
    '-pix_fmt',
    'yuv420p',
    // Fragmented output, so bytes reach the disk CONTINUOUSLY.
    //
    // A plain mp4 muxer buffers samples and writes the index at finalize, so
    // the file can sit at 48 bytes for 50 SECONDS while ffmpeg is alive and
    // decoding happily -- measured on a static iOS sign-in screen. Readiness
    // polls the file, so recording appeared to work only when the screen had
    // enough motion to force an early flush. It therefore started failing at
    // the exact moment the app started WORKING: a busy home screen flushed, a
    // settled sign-in screen did not.
    //
    // `+empty_moov` writes a playable header immediately and `+frag_keyframe`
    // closes a fragment on every keyframe. The happy side effect is that the
    // file stays playable even if the recorder dies without finalising.
    '-movflags',
    '+frag_keyframe+empty_moov',
    // ffmpeg's own progress channel, machine-readable and flushed per update.
    // This is what readiness reads, rather than the file: see waitForFfmpegFrames.
    '-progress',
    'pipe:1',
    // Constant frame rate, stated explicitly. Measured on this setup over a
    // 10.22s capture: with `-fps_mode cfr` the file came out 10.00s; left to
    // ffmpeg's default mode it dropped to 9.93s, and an earlier run lost a
    // third of the duration outright. The flag is what makes ffmpeg DUPLICATE
    // frames to fill gaps rather than emit fewer of them.
    '-fps_mode',
    'cfr',
    // OUTPUT rate (it follows -i), the rate the CFR file is written at.
    '-r',
    String(fps),
    file,
  ];
}

/**
 * Where a recorder binary may legitimately live on a developer Mac.
 *
 * Ordered: Homebrew first on both architectures, then the system paths.
 */
const BINARY_SEARCH_PATHS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];

/**
 * Absolute path to an executable, or a throw that says how to install it.
 *
 * Spawning a bare name searches $PATH, so the binary that actually runs
 * depends on the environment of whoever launched the runner --
 * `sonarjs/no-os-command-from-path` flags it for exactly that reason.
 * Resolving here also turns the failure from a bare `ENOENT` into a sentence
 * naming the missing tool and the command that installs it.
 *
 * @param {string} name
 * @param {string} installHint
 * @returns {string} absolute path
 */
function resolveBinary(name, installHint) {
  for (const dir of BINARY_SEARCH_PATHS) {
    const abs = path.join(dir, name);
    try {
      fs.accessSync(abs, fs.constants.X_OK);
      return abs;
    } catch (_e) {
      /* try the next location */
    }
  }
  throw new Error(
    `${name} is not installed (looked in ${BINARY_SEARCH_PATHS.join(', ')}). ${installHint}`,
  );
}

/** Filesystem-safe stamp, so two runs never collide on one filename. */
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

/**
 * @typedef {object} Recorder
 * @property {() => Promise<void>} start
 * @property {() => Promise<string|null>} stop  resolves the mp4 path, or null
 *   if nothing was recorded.
 * @property {string} file
 */

/**
 * @param {object} o
 * @param {'android'|'ios'} o.platform
 * @param {string} o.serial          adb serial (android) or UDID (ios).
 * @param {string} o.outDir          run directory; the mp4 lands here.
 * @param {object} [o.device]        the IosDevice, for the Appium session.
 * @param {boolean} [o.watch]        mirror while recording (android).
 * @param {string} [o.name]
 * @returns {Recorder}
 */
function createRecorder({
  platform,
  serial,
  outDir,
  device,
  watch = true,
  name = 'walk',
  mjpegPort = DEFAULT_MJPEG_PORT,
  fps = DEFAULT_RECORDING_FPS,
}) {
  const file = path.join(outDir, `${name}-${platform}-${stamp()}.mp4`);

  if (platform === 'android') return androidRecorder({ serial, file, watch });
  if (platform === 'ios') return iosRecorder({ device, file, port: mjpegPort, fps });

  // Not a silent no-op. A recorder that shrugs at an unknown platform gives a
  // green run with no video and no complaint -- the exact failure being fixed.
  throw new Error(`Cannot record: unknown platform "${platform}" (expected android|ios)`);
}

/**
 * `stay_on_while_plugged_in` bit for USB power. The handsets here are USB-only.
 */
const STAY_ON_USB = 2;

/**
 * The value to write, given what the setting already holds.
 *
 * OR, never assignment. This runs against the operator's own handset, and
 * overwriting would silently drop their AC/wireless stay-on bits and put back
 * only what we happened to read. Extracted so that rule is assertable without
 * a phone attached.
 *
 * @param {number} previous
 * @returns {number}
 */
function desiredStayOn(previous) {
  return previous | STAY_ON_USB;
}

/**
 * Keep the screen on for the length of the walk, device-side.
 *
 * Stands in for scrcpy's `--stay-awake`, which is unavailable while control is
 * disabled (see `scrcpyArgs`). This is not a nicety: a screen that blanks
 * mid-journey records a black rectangle, and the video of a failed run and the
 * video of a passing one become indistinguishable.
 *
 * The previous value is OR-ed rather than overwritten, and put back on stop --
 * this runs against the operator's own handset, and a test must not leave its
 * power settings changed.
 *
 * @param {string} serial
 * @returns {() => void} restore, safe to call once
 */
function keepAwakeWhilePluggedIn(serial) {
  const adb = resolveBinary('adb', 'Install it with: brew install android-platform-tools');
  const setting = ['shell', 'settings', 'get', 'global', 'stay_on_while_plugged_in'];
  const previous = Number.parseInt(
    execFileSync(adb, ['-s', serial, ...setting], { encoding: 'utf8' }).trim(),
    10,
  );
  // Unreadable setting: leave the device alone rather than guess at a value to
  // put back afterwards. The walk still records, it just relies on the phone's
  // own screen timeout.
  if (!Number.isInteger(previous)) return () => {};

  const desired = desiredStayOn(previous);
  if (desired === previous) return () => {};

  const put = (v) =>
    execFileSync(adb, [
      '-s',
      serial,
      'shell',
      'settings',
      'put',
      'global',
      'stay_on_while_plugged_in',
      String(v),
    ]);
  put(desired);
  return () => put(previous);
}

function androidRecorder({ serial, file, watch }) {
  let child = null;
  let stderr = '';
  let restoreAwake = null;
  /** Idempotent: the setting is put back exactly once, however the run ends. */
  const releaseAwake = () => {
    const restore = restoreAwake;
    restoreAwake = null;
    if (restore) restore();
  };

  return {
    file,
    async start() {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      restoreAwake = keepAwakeWhilePluggedIn(serial);
      const bin = resolveBinary('scrcpy', 'Install it with: brew install scrcpy');
      child = spawn(bin, scrcpyArgs({ serial, file, watch }), {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });

      // Readiness is read from the FILE, not from a log line.
      //
      // scrcpy does still announce "Recording started", but on STDOUT, which
      // is block-buffered when it is a pipe rather than a terminal: every INFO
      // line stays in libc's buffer and is flushed only when the process
      // EXITS. Waiting for that string therefore waits forever while the
      // recording runs perfectly -- measured on scrcpy 4.1, where the whole
      // INFO block arrived in one burst at shutdown, 9s after recording began.
      //
      // Bytes arriving in the mp4 prove the encoder is live without depending
      // on how a scrcpy version words or buffers its logging, and are the same
      // evidence `stop` already trusts.
      //
      // Waiting matters because step 1 of the journey has to be IN the video;
      // starting the walk immediately loses the launch and the sign-in screen.
      //
      // Shared with the iOS recorder rather than reimplemented: both write a
      // container header before the first frame, so both need GROWTH rather
      // than the first byte, and one rule should have one implementation.
      await waitForContainerHeader(file, child, () => stderr, {
        timeoutMs: RECORDING_READY_TIMEOUT_MS,
      }).catch(async (e) => {
        // scrcpy never came up. Put the power setting back, and REAP the
        // child, before the failure propagates.
        //
        // Both halves matter. A run that dies in its first second must not
        // leave the phone configured by a recorder that is no longer running
        // -- and it must not leave scrcpy ALIVE either: an orphan holds the
        // device's video stream open, so the NEXT run gets no frames and
        // fails for a reason that has nothing to do with it. That cascade is
        // exactly how this path was found.
        releaseAwake();
        await stopGracefully(child);
        child = null;
        throw e;
      });
    },
    async stop() {
      releaseAwake();
      if (!child) return null;
      await stopGracefully(child);
      child = null;
      // The artefact, not a proxy for it. scrcpy writes the header
      // immediately, so both "the file exists" and "its size is not zero" are
      // TRUE of a recording that captured nothing at all — which is exactly
      // what a settled screen produces.
      if (!fs.existsSync(file)) {
        throw new Error(`scrcpy produced no video at ${file}:\n${stderr}`);
      }
      assertPlayable(file, { readStderr: () => stderr });
      return file;
    },
  };
}

function iosRecorder({ device, file, port, fps }) {
  let child = null;
  let stderr = '';

  return {
    file,
    async start() {
      if (!device) throw new Error('iOS recording needs the IosDevice that owns the session');
      // The MJPEG stream exists only while WDA holds a session, so the session
      // has to be open BEFORE ffmpeg connects. Without this the first walk
      // records a connection refusal.
      await device.ensureSession();

      fs.mkdirSync(path.dirname(file), { recursive: true });
      const bin = resolveBinary('ffmpeg', 'Install it with: brew install ffmpeg');
      child = spawn(bin, ffmpegMjpegArgs({ file, port, fps }), {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });

      // Frames, reported by ffmpeg itself. NOT the file -- on a still screen
      // the mp4 stays at 48 bytes for a minute while ffmpeg encodes happily.
      await waitForFfmpegFrames(child, () => stderr);
    },
    async stop() {
      if (!child) return null;
      await stopGracefully(child);
      child = null;
      if (!fs.existsSync(file) || fs.statSync(file).size === 0) {
        throw new Error(`ffmpeg produced no video at ${file}:\n${stderr}`);
      }
      return file;
    },
  };
}

/**
 * Resolve once ffmpeg reports it has actually encoded a frame.
 *
 * The file is the WRONG thing to watch here. On a still screen the recording
 * sat at 48 bytes — just the `ftyp` box — for FIFTY SECONDS while ffmpeg was
 * alive and decoding, then jumped to 234KB the instant it was signalled: at a
 * near-zero bitrate nothing fills ffmpeg's IO buffer, so nothing reaches the
 * disk. Readiness that polls the file therefore succeeds only when the screen
 * MOVES, which is why this looked healthy in every probe and then failed the
 * moment the app started working: a busy home screen flushed, a settled
 * sign-in screen did not. A recorder that works only while something is
 * happening is precisely useless for recording a screen that hangs.
 *
 * `-progress pipe:1` is ffmpeg's own machine-readable channel, flushed on each
 * update — measured here reporting its first frame in 621ms on a deliberately
 * minimal source. It answers the actual question, "has the encoder received
 * anything", without depending on buffering at all.
 *
 * scrcpy has no equivalent channel. It used to keep `waitForGrowth`, and that
 * was the same bug wearing the other platform's clothes: Android's encoder
 * emits nothing at all while the screen is still, so the wait failed on a
 * phone sitting at sign-in. It now waits for the CONTAINER HEADER, which
 * proves the capture session is up, and the frames claim moved to
 * `assertPlayable` at stop where the artefact itself can answer it
 * (SHY-0445).
 *
 * @param {import('node:child_process').ChildProcess} child
 * @param {() => string} readStderr
 * @param {{timeoutMs?: number}} [o]
 * @returns {Promise<void>}
 */
function waitForFfmpegFrames(child, readStderr, { timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      return reject(
        new Error(
          `ffmpeg exited with ${child.exitCode ?? child.signalCode} before recording:\n` +
            readStderr(),
        ),
      );
    }
    let seen = '';
    const finish = (settle, arg) => {
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.off('exit', onExit);
      settle(arg);
    };
    const onData = (d) => {
      seen += d.toString();
      // The LAST report, not the first. ffmpeg's opening progress block says
      // `frame=0`, and a plain `.match()` against an ever-growing buffer keeps
      // returning that first zero however many frames arrive after it -- so
      // readiness never fires on a slow stream. It only appeared to work
      // against a source fast enough to report a large count in its very first
      // block, which is the same "too generous a fixture" mistake that hid the
      // buffering problem this function exists to solve.
      const counts = [...seen.matchAll(/frame=\s*(\d+)/g)];
      const latest = counts.length ? Number(counts[counts.length - 1][1]) : 0;
      if (latest > 0) finish(resolve);
    };
    const onExit = (code) =>
      finish(reject, new Error(`ffmpeg exited with ${code} before recording:\n${readStderr()}`));
    const timer = setTimeout(
      () =>
        finish(
          reject,
          new Error(`ffmpeg reported no frames within ${timeoutMs}ms:\n${readStderr()}`),
        ),
      timeoutMs,
    );
    if (typeof timer.unref === 'function') timer.unref();
    child.stdout.on('data', onData);
    child.once('exit', onExit);
  });
}

/**
 * Resolve once `file` is GROWING, or reject if the recorder dies first.
 *
 * Growth, not the first byte. Both recorders write a container header before a
 * single frame is encoded, so a non-zero size proves only that the file was
 * OPENED. Treating that as readiness starts the walk against an encoder that
 * may still fail, and loses the opening screens if it does not.
 *
 * The Android path was found to need exactly this on a real device; ffmpeg
 * behaves the same way, so the rule lives here and both platforms use it
 * rather than one being fixed and the other left.
 *
 * Polled rather than slept: a fixed sleep is either too short on a cold
 * WebDriverAgent or wasted on a warm one, and this project does not sleep in
 * tests or runners.
 *
 * @param {string} file
 * @param {import('node:child_process').ChildProcess} child
 * @param {() => string} readStderr
 * @param {{timeoutMs?: number, pollMs?: number}} [o]
 * @returns {Promise<void>}
 */
/**
 * Wait until the recorder has OPENED its container — the file exists and has
 * a header — rather than until frames have arrived.
 *
 * This replaces `waitForGrowth` on the scrcpy path, which was the wrong
 * question (SHY-0445).
 *
 * Android's screen encoder emits frames only when the display CHANGES. On a
 * settled screen it produces nothing at all: measured on a real OnePlus, the
 * mp4 sat at exactly 48 bytes for ten seconds and an mkv was never even
 * created. So "did bytes arrive in the first 20 seconds" is false for a phone
 * that is simply sitting still, which is the state every walk STARTS in. The
 * runner failed with "no growing video" against a recorder that was working
 * perfectly, and had passed the night before only because that run happened to
 * begin mid-walk.
 *
 * The file's header is the earliest honest evidence available here. scrcpy
 * opens the muxer only after negotiating the video stream with the device, so
 * a header on disk proves the capture SESSION is up — which is what the wait
 * exists for. It is not evidence of frames, and this function does not claim
 * to be; that claim belongs to [assertPlayable] at stop, where it can be
 * checked against the artefact instead of guessed at from a size.
 *
 * Its stdout is no help: scrcpy block-buffers INFO lines through a pipe and
 * flushes the whole block at exit, 9s after recording began when measured on
 * 4.1.
 */
function waitForContainerHeader(
  file,
  child,
  readStderr,
  { timeoutMs = 20_000, pollMs = 200 } = {},
) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      return reject(
        new Error(
          `recorder exited with ${child.exitCode ?? child.signalCode} before recording:\n` +
            readStderr(),
        ),
      );
    }
    const deadline = Date.now() + timeoutMs;
    let died = false;
    child.once('exit', (code) => {
      died = true;
      reject(new Error(`recorder exited with ${code} before recording:\n${readStderr()}`));
    });
    const tick = () => {
      if (died) return;
      let size = 0;
      try {
        size = fs.statSync(file).size;
      } catch (_e) {
        /* not created yet */
      }
      if (size > 0) return resolve();
      if (Date.now() > deadline) {
        return reject(
          new Error(
            `recorder opened no container at ${file} within ${timeoutMs}ms:\n${readStderr()}`,
          ),
        );
      }
      setTimeout(tick, pollMs).unref?.();
    };
    tick();
  });
}

/**
 * Refuse to hand back a recording that will not play (SHY-0445).
 *
 * The start gate above deliberately proves only that the container was
 * opened. THIS is where the actual claim is checked, against the actual file:
 * ffprobe must find a video stream and a positive duration.
 *
 * That is strictly stronger than the size check it replaces, and it catches
 * two failures a size cannot:
 *
 * - a header-only file, 48 bytes, which is what a recorder that captured
 *   NOTHING leaves behind — `size !== 0` called that a pass;
 * - a truncated mp4 whose `moov` atom was never written, which is what a
 *   SIGKILLed recorder leaves. ffprobe says "moov atom not found" where a
 *   size check sees twenty perfectly good megabytes.
 *
 * Both were reachable before this existed, and both produce a report that
 * links a video nobody can open.
 */
function assertPlayable(file, { readStderr = () => '' } = {}) {
  const ffprobe = resolveBinary('ffprobe', 'Install it with: brew install ffmpeg');
  const probe = spawnSync(
    ffprobe,
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-show_entries',
      'stream=codec_type',
      '-of',
      'default=noprint_wrappers=1',
      file,
    ],
    { encoding: 'utf8' },
  );
  const out = `${probe.stdout || ''}${probe.stderr || ''}`;
  if (probe.status !== 0) {
    throw new Error(`recording at ${file} will not play:\n${out}\n${readStderr()}`);
  }
  if (!/codec_type=video/.test(out)) {
    throw new Error(`recording at ${file} carries no video stream:\n${out}`);
  }
  const duration = Number((/duration=([\d.]+)/.exec(out) || [])[1]);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`recording at ${file} has no duration — it captured nothing:\n${out}`);
  }
  return { duration };
}

function waitForGrowth(file, child, readStderr, { timeoutMs = 20_000, pollMs = 200 } = {}) {
  return new Promise((resolve, reject) => {
    // Already gone before we could listen. `exit` has fired and will not fire
    // again, so without this the caller waits out the whole timeout and
    // reports "wrote nothing" for a process that actually crashed -- pointing
    // the reader at the device instead of at the command.
    if (child.exitCode !== null || child.signalCode !== null) {
      return reject(
        new Error(
          `recorder exited with ${child.exitCode ?? child.signalCode} before recording:\n` +
            readStderr(),
        ),
      );
    }
    const deadline = Date.now() + timeoutMs;
    let firstSeen = null;
    let died = false;
    child.once('exit', (code) => {
      died = true;
      reject(new Error(`ffmpeg exited with ${code} before recording:\n${readStderr()}`));
    });
    const tick = () => {
      if (died) return;
      let size = 0;
      try {
        size = fs.statSync(file).size;
      } catch (_e) {
        /* not created yet */
      }
      if (size > 0) {
        if (firstSeen === null) firstSeen = size;
        else if (size > firstSeen) return resolve();
      }
      if (Date.now() > deadline) {
        return reject(
          new Error(`no growing video at ${file} within ${timeoutMs}ms:\n${readStderr()}`),
        );
      }
      setTimeout(tick, pollMs).unref?.();
    };
    tick();
  });
}

module.exports = {
  createRecorder,
  scrcpyArgs,
  stopGracefully,
  ffmpegMjpegArgs,
  DEFAULT_MJPEG_PORT,
  DEFAULT_RECORDING_FPS,
  resolveBinary,
  desiredStayOn,
  STAY_ON_USB,
  waitForGrowth,
  waitForContainerHeader,
  assertPlayable,
  waitForFfmpegFrames,
  BINARY_SEARCH_PATHS,
  RECORDING_STOP_SIGNAL,
  DEFAULT_GRACE_MS,
};
