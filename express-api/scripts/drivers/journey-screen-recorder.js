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
const { spawn } = require('node:child_process');

/**
 * SIGINT, always. scrcpy traps it and finalises the container; SIGKILL cannot
 * be trapped and truncates the index. Exported so the test can pin it -- a
 * future "just use SIGKILL, it's faster" edit has to argue with a red test.
 */
const RECORDING_STOP_SIGNAL = 'SIGINT';

/** How long a recorder gets to write its index before we stop being polite. */
const DEFAULT_GRACE_MS = 10_000;

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
    // Keeps the phone awake for the length of the walk. A screen that blanks
    // mid-journey records a black rectangle and fails nothing.
    '--stay-awake',
    // The walk drives the device over adb; scrcpy is here to observe, and a
    // stray click on the mirror window must not perturb the run.
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
    // Stamp each frame with the moment it actually arrived, rather than
    // assuming a rate. This is what keeps playback in step with real time.
    '-use_wallclock_as_timestamps',
    '1',
    '-i',
    `http://localhost:${port}`,
    '-vcodec',
    'h264',
    '-pix_fmt',
    'yuv420p',
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

function androidRecorder({ serial, file, watch }) {
  let child = null;
  let stderr = '';

  return {
    file,
    async start() {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const bin = resolveBinary('scrcpy', 'Install it with: brew install scrcpy');
      child = spawn(bin, scrcpyArgs({ serial, file, watch }), {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });

      // scrcpy prints "Recording started" once the encoder is live. Waiting
      // for it means step 1 of the journey is IN the video; starting the walk
      // immediately loses the first seconds, which is where the launch and
      // the sign-in screen are.
      await new Promise((resolve, reject) => {
        const ready = setTimeout(
          () => reject(new Error(`scrcpy did not start recording within 15s:\n${stderr}`)),
          15_000,
        );
        const watchFor = (d) => {
          if (/Recording started/i.test(d.toString())) {
            clearTimeout(ready);
            child.stdout.off('data', watchFor);
            child.stderr.off('data', watchFor);
            resolve();
          }
        };
        child.stdout.on('data', watchFor);
        child.stderr.on('data', watchFor);
        child.once('exit', (code) => {
          clearTimeout(ready);
          reject(new Error(`scrcpy exited with ${code} before recording:\n${stderr}`));
        });
      });
    },
    async stop() {
      if (!child) return null;
      await stopGracefully(child);
      child = null;
      // Existence AND size. scrcpy writes the header immediately, so a file
      // appearing proves only that it opened one.
      if (!fs.existsSync(file) || fs.statSync(file).size === 0) {
        throw new Error(`scrcpy produced no video at ${file}:\n${stderr}`);
      }
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

      // ffmpeg writes the container header once the first frames arrive.
      // Waiting for the file to gain bytes proves the STREAM is flowing --
      // an ffmpeg that started and immediately failed to connect exits with
      // an empty file, and starting the walk anyway would waste the run.
      await waitForBytes(file, child, () => stderr);
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
 * Resolve once `file` has real bytes, or reject if the recorder dies first.
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
function waitForBytes(file, child, readStderr, { timeoutMs = 20_000, pollMs = 200 } = {}) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
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
      if (size > 0) return resolve();
      if (Date.now() > deadline) {
        return reject(new Error(`ffmpeg wrote nothing within ${timeoutMs}ms:\n${readStderr()}`));
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
  BINARY_SEARCH_PATHS,
  RECORDING_STOP_SIGNAL,
  DEFAULT_GRACE_MS,
};
