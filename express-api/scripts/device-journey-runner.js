#!/usr/bin/env node
/* eslint-disable no-console -- operator-facing CLI; console output is the interface. */
/**
 * ShyTalk independent on-device user-journey runner (Android).
 * ============================================================
 *
 * WHAT THIS IS
 * ------------
 * A standalone runner that drives the REAL ShyTalk app on a connected
 * Android device through end-to-end user journeys (sign in as a seeded
 * test persona, navigate, assert what's on screen) and writes a DETAILED
 * pass/fail report — per journey, per step — plus a screenshot and a
 * dump of the on-screen elements at every step. You launch it once and
 * read ONE report instead of driving each tap by hand.
 *
 * HOW IT DRIVES THE DEVICE (no Appium / no WebDriver needed)
 * ----------------------------------------------------------
 *   - `adb shell uiautomator dump`  -> the view tree as XML. Compose
 *     `testTag("x")` values surface as `resource-id="x"`, so journeys
 *     target stable testTags, not screen coordinates.
 *   - parse each <node> for resource-id / text / content-desc / bounds.
 *   - `adb shell input tap <cx> <cy>` taps the centre of a matched node.
 *   - `adb exec-out screencap -p`    -> a PNG screenshot per step.
 *
 * WHY NOT THE EXISTING drivers/android-adb-driver.js?
 * ---------------------------------------------------
 * That file is a documented SCAFFOLD — every matcher method returns
 * `false` + logs "not implemented". This runner is the working engine;
 * it reuses only its proven `selectSerial()` idea (pin one adb serial).
 *
 * PREREQUISITES (local target)
 * ----------------------------
 *   1. Local stack up:   bash local/start.sh   (Firebase emu + Express)
 *   2. Personas seeded:  cd express-api && node --env-file=.env.local \
 *                          scripts/seed-personas-local.js
 *   3. A device connected via `adb devices` (USB or wireless adb).
 * The runner builds the APK itself if it is missing.
 *
 * USAGE
 * -----
 *   node express-api/scripts/device-journey-runner.js [options]
 *     --target local|dev     environment to test (default: local)
 *     --serial <serial>      adb serial to drive (default: auto-select)
 *     --journeys <ids>       comma list, e.g. J-SMOKE,J-ALICE (default: all)
 *     --rebuild              force-rebuild the APK before running
 *     --no-reset             skip the clean uninstall+reinstall in J-SMOKE
 *     --out <dir>            results dir (default: <repo>/journey-results)
 *     --list                 print the available journeys and exit
 *     --help                 print this help and exit
 *
 * OUTPUT
 * ------
 *   <out>/latest-report.md     <- human report (READ THIS)
 *   <out>/latest-report.json   <- machine report
 *   <out>/runs/<runId>/        <- screenshots (*.png), dumps (*.xml), logs
 * Exit code 0 = all journeys passed, 1 = at least one failed.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const { createIosJourneyDevice, selectCoreDeviceUuid } = require('./drivers/ios-journey-device');
const {
  createAndroidSourceSession,
  ANDROID_SOURCE_UNAVAILABLE,
} = require('./drivers/android-source-session');
const { createRecorder } = require('./drivers/journey-screen-recorder');

// --------------------------------------------------------------------------
// Repo / target configuration
// --------------------------------------------------------------------------
const REPO_ROOT = path.resolve(__dirname, '..', '..');

/**
 * The account each platform raises support tickets as.
 *
 * The operator runs Android and iOS AT THE SAME TIME against ONE emulator, so
 * a journey that asserts on "how many requests this person has open" cannot
 * share an account between them: the other phone's ticket lands in the count
 * and the warning names a number neither run expects. Nothing fails cleanly —
 * the walks just disagree with each other, intermittently, and the obvious
 * reading is that the feature is flaky.
 *
 * Both are adult MEMBER personas with `ageVerified: true` and `locale: 'en'`,
 * so the two walks exercise the same code path and read the same English UI
 * strings. `host@shytalk.dev` is deliberately an account NO other journey
 * signs in as, so an iOS support run cannot collide with an Android voice run
 * either.
 */
// The two support walks must not share an account: Android and iOS run in
// PARALLEL, so one signed-in session would evict the other and the failure
// would read as a product defect.
//
// SHY-0456 gave J09 (room lifecycle) the voice host, `host@shytalk.dev` —
// which was ALSO the iOS support persona, so an Android J09 beside an iOS
// support walk reintroduced the collision by another route. That is exactly
// what device-journey-parallel-isolation.test.js exists to catch, and it did.
//
// The voice host stays with the voice journey; support moves to P-11, the
// only adult/en/MEMBER persona no journey signs in as. A support walk needs
// nothing of the account but that it can sign in and raise a ticket.
const SUPPORT_PERSONA_BY_PLATFORM = {
  android: 'adult-power@shytalk.dev',
  ios: 'joiner-flaky@shytalk.dev',
};

const TARGETS = {
  local: {
    pkg: 'com.shyden.shytalk.local',
    apk: 'app/build/outputs/apk/local/debug/app-local-debug.apk',
    gradleTask: ':app:assembleLocalDebug',
    gradleArgs: ['-PlocalHost=localhost'],
    // Device localhost -> Mac, so the on-device app reaches the local stack.
    // 3000 Express · 7880 LiveKit signalling · 7881 LiveKit TCP media
    // · 8080 Firestore · 8888 web · 9000 RTDB · 9002 MinIO · 9099 Auth.
    //
    // 7881 is the ONLY media transport a reverse tunnel can carry — `adb
    // reverse` forwards TCP and never UDP (SHY-0273). Kept identical to
    // start.sh's and the gauntlet's lists; pinned equal by
    // livekit-local-node-ip.test.js, which caught this list having silently
    // drifted from the gauntlet's (it was missing 8888).
    reversePorts: [3000, 7880, 7881, 8080, 8888, 9000, 9002, 9099],
    // iOS has no flavour suffix -- Debug-Local and Release share one bundle id,
    // and the environment is baked in at build time by
    // scripts/dev/ios-local-install.sh, which points the app at THIS Mac's LAN
    // address. There is no adb-reverse equivalent to fall back on.
    iosBundleId: 'com.shyden.shytalk',
  },
  dev: {
    pkg: 'com.shyden.shytalk.dev',
    apk: 'app/build/outputs/apk/dev/debug/app-dev-debug.apk',
    gradleTask: ':app:assembleDevDebug',
    gradleArgs: [],
    reversePorts: [], // dev backend is remote; no tunnelling
    iosBundleId: 'com.shyden.shytalk',
  },
};

// --------------------------------------------------------------------------
// Tiny arg parser
// --------------------------------------------------------------------------
function parseArgs(argv) {
  const a = {
    target: 'local',
    platform: 'android',
    record: true,
    serial: process.env.ANDROID_SERIAL || null,
    journeys: null,
    rebuild: false,
    reset: true,
    out: path.join(REPO_ROOT, 'journey-results'),
    list: false,
    help: false,
    debug: false,
  };
  let i = 0;
  const next = (flag) => {
    const val = argv[++i];
    if (val === undefined) throw new Error(`${flag} requires a value`);
    return val;
  };
  for (; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--target') a.target = next('--target');
    else if (v === '--platform') a.platform = next('--platform');
    else if (v === '--no-record') a.record = false;
    else if (v === '--debug') a.debug = true;
    else if (v === '--serial') a.serial = next('--serial');
    else if (v === '--journeys')
      a.journeys = next('--journeys')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    else if (v === '--out') a.out = path.resolve(next('--out'));
    else if (v === '--rebuild') a.rebuild = true;
    else if (v === '--no-reset') a.reset = false;
    else if (v === '--list') a.list = true;
    else if (v === '--help' || v === '-h') a.help = true;
    else throw new Error(`Unknown option: ${v}`);
  }
  if (!TARGETS[a.target]) throw new Error(`Unknown --target "${a.target}" (use local|dev)`);
  // Validated rather than defaulted. A typo'd `--platform iOS` silently running
  // Android would report a full green pass for a phone nobody touched, which is
  // worse than not running it at all.
  if (!['android', 'ios'].includes(a.platform)) {
    throw new Error(`Unknown --platform "${a.platform}" (use android|ios)`);
  }
  return a;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --------------------------------------------------------------------------
// adb primitives (all pinned to one serial)
// --------------------------------------------------------------------------
function sh(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

function listDevices() {
  let out;
  try {
    out = sh('adb devices');
  } catch (_e) {
    return [];
  }
  return out
    .split('\n')
    .filter((l) => /\tdevice$/.test(l))
    .map((l) => l.split('\t')[0]);
}

// Same idea as drivers/android-adb-driver.js selectSerial: prefer the
// caller's serial, then a wireless TLS-connect device, then an emulator.
function selectSerial(preferred) {
  const serials = listDevices();
  if (serials.length === 0) return null;
  if (preferred && serials.includes(preferred)) return preferred;
  return (
    serials.find((s) => s.includes('_adb-tls-connect')) ||
    serials.find((s) => s.startsWith('emulator-')) ||
    serials[0]
  );
}

class Device {
  constructor(serial) {
    this.serial = serial;
    this.adb = `adb -s ${serial}`;
    // Declared on BOTH backends. It used to be set only on the iOS one, so
    // `device.kind === 'ios'` worked by accident of `undefined` — and any
    // check the other way round would have been silently false.
    this.kind = 'android';
    // Set by attachSourceSession() when a warm reader is available. Absent is
    // a supported state, not a broken one.
    this.sourceSession = null;
  }

  /**
   * Give this device a warm screen reader if Appium can provide one. Called
   * once at startup, because standing the server up costs ~5s and must not be
   * paid per read — which is the entire point.
   */
  async attachSourceSession() {
    this.sourceSession = await createAndroidSourceSession({ serial: this.serial });
    if (this.sourceSession) {
      // Assigned on the INSTANCE, and only when a session exists, because
      // `tapResolved` routes on `typeof device.tapElement === 'function'`.
      // Defining these on the class would make the coordinate fallback
      // unreachable on a machine without the driver — the walk would fail
      // rather than tap (SHY-0448).
      this.tapElement = (tag) => this.sourceSession.tapElement(tag);
      this.tapElementByLabel = (label) => this.sourceSession.tapElementByLabel(label);
    }
    return Boolean(this.sourceSession);
  }

  shell(args) {
    return sh(`${this.adb} shell ${args}`);
  }

  reverse(port) {
    sh(`${this.adb} reverse tcp:${port} tcp:${port}`);
  }

  install(apkAbs) {
    return sh(`${this.adb} install -r -d "${apkAbs}"`, { maxBuffer: 32 * 1024 * 1024 });
  }

  uninstall(pkg) {
    try {
      sh(`${this.adb} uninstall ${pkg}`);
    } catch (_e) {
      /* not installed; fine */
    }
  }

  // `async` even though `am force-stop` is synchronous, so that ONE method name
  // means one thing on both backends. While only iOS was awaitable, `await
  // device.forceStop()` was load-bearing on one platform and decoration on the
  // other — and shared journey code cannot tell which it is looking at.
  async forceStop(pkg) {
    try {
      this.shell(`am force-stop ${pkg}`);
    } catch (_e) {
      /* ignore */
    }
  }

  launch(pkg) {
    // monkey launches the LAUNCHER activity without us knowing its name.
    this.shell(`monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`);
  }

  // uiautomator can transiently fail while the UI is animating; retry.
  /**
   * Read the screen — over a WARM UiAutomator2 server when one is available,
   * and over `uiautomator dump` when it is not (SHY-0447).
   *
   * Measured on the real OnePlus, 2026-08-23: 65ms against 2332ms, and reads
   * were 86% of a whole J38 walk. `uiautomator dump` spawns a fresh
   * instrumentation per call and costs the same on the Android launcher, so it
   * is the tool rather than the app.
   *
   * The fallback is announced ONCE, loudly. A silent one would hide a 36x
   * regression behind a run that is merely slow, and slow is exactly what
   * nobody investigates.
   */
  async dumpXml() {
    if (this.sourceSession) return this.sourceSession.dumpXml();
    if (!Device._warnedSlowSource) {
      Device._warnedSlowSource = true;
      console.log(`  ⚠ ${ANDROID_SOURCE_UNAVAILABLE}`);
    }
    return this.dumpXmlOverAdb();
  }

  async dumpXmlOverAdb() {
    let last = '';
    for (let i = 0; i < 4; i++) {
      try {
        sh(`${this.adb} exec-out uiautomator dump /sdcard/uidump.xml`, {
          stdio: ['ignore', 'ignore', 'ignore'],
        });
        const xml = sh(`${this.adb} exec-out cat /sdcard/uidump.xml`, {
          maxBuffer: 16 * 1024 * 1024,
        });
        if (xml && xml.includes('<hierarchy')) return xml;
        if (xml) last = xml.slice(0, 200);
      } catch (e) {
        last = (e.message || '').slice(0, 200);
      }
      if (i < 3) await sleep(600);
    }
    throw new Error(
      `uiautomator dump failed after 4 attempts; last response: ${last || '(empty)'}`,
    );
  }

  screencap(absPath) {
    sh(`${this.adb} exec-out screencap -p > "${absPath}"`, { maxBuffer: 64 * 1024 * 1024 });
  }

  tap(cx, cy) {
    this.shell(`input tap ${cx} ${cy}`);
  }

  swipe(x1, y1, x2, y2, ms = 400) {
    this.shell(`input swipe ${x1} ${y1} ${x2} ${y2} ${ms}`);
  }

  size() {
    const m = /(\d{1,5})x(\d{1,5})/.exec(this.shell('wm size'));
    return m ? { w: +m[1], h: +m[2] } : { w: 1080, h: 1920 };
  }
}

// --------------------------------------------------------------------------
// Dump parsing
// --------------------------------------------------------------------------
/**
 * Normalise EITHER accessibility tree into one node shape.
 *
 * uiautomator emits `<node resource-id="tag" text="..." bounds="[x,y][x,y]">`.
 * XCUITest emits `<XCUIElementTypeButton name="tag" label="..." x y width
 * height>`. Everything above this function -- `tapId`, `waitForId`,
 * `waitForText`, and every journey -- works on the normalised shape, which is
 * what lets ONE journey definition assert the same things on both phones.
 *
 * Dispatched on the content rather than on a flag the caller passes: a caller
 * that says "android" while holding an iPhone dump would produce zero nodes and
 * a timeout that reads like the screen never appeared.
 */
function parseNodes(xml) {
  return xml.includes('XCUIElementType') ? parseXcuiNodes(xml) : parseUiautomatorNodes(xml);
}

/**
 * XCUITest's tree.
 *
 * `name` is the accessibility identifier -- the iOS projection of Compose's
 * `testTag`, so it lines up with Android's `resource-id` without translation.
 * `label` is what a person reads, and `value` carries a text field's CONTENTS,
 * which is how "the words she typed are still there" is checked on iOS.
 */
function parseXcuiNodes(xml) {
  const nodes = [];
  const tagRe = /<XCUIElementType[A-Za-z]+\b[^>]*?\/?>/g;
  let m;
  while ((m = tagRe.exec(xml)) !== null) {
    const attrs = {};
    const attrRe = /([\w-]{1,64})="([^"]{0,8192})"/g;
    let a;
    while ((a = attrRe.exec(m[0])) !== null) attrs[a[1]] = a[2];
    const x = Number(attrs.x);
    const y = Number(attrs.y);
    const w = Number(attrs.width);
    const h = Number(attrs.height);
    const hasBox = [x, y, w, h].every(Number.isFinite) && w > 0 && h > 0;
    nodes.push({
      // The element TYPE, e.g. XCUIElementTypeKeyboard. Needed to tell an
      // overlay that swallows taps from ordinary content sitting behind it.
      cls: m[0].match(/<(XCUIElementType[A-Za-z]+)/)?.[1] ?? '',
      // The full box, not only its centre. Occlusion is a question about
      // rectangles: does something drawn later cover this point.
      bounds: hasBox ? { x1: x, y1: y, x2: x + w, y2: y + h } : null,
      id: attrs.name || '',
      // A text field's typed contents live in `value`; a button's caption lives
      // in `label`. Preferring value means an assertion on what somebody typed
      // reads the field rather than its placeholder.
      text: attrs.value || attrs.label || '',
      desc: attrs.label || '',
      clickable: attrs.enabled === 'true',
      enabled: attrs.enabled === 'true',
      checked: attrs.selected === 'true',
      // `visible` is XCUITest's own word for on-screen. A node the person
      // cannot see must not satisfy a wait -- that is the SHY-0419 defect
      // exactly: a Send button that existed, at coordinates under the keyboard.
      visible: attrs.visible !== 'false',
      center: hasBox ? { x: Math.round(x + w / 2), y: Math.round(y + h / 2) } : null,
    });
  }
  return nodes;
}

function parseUiautomatorNodes(xml) {
  const nodes = [];
  const tagRe = /<node\b[^>]*?\/?>/g;
  let m;
  while ((m = tagRe.exec(xml)) !== null) {
    const tag = m[0];
    const attrs = {};
    const attrRe = /([\w-]{1,64})="([^"]{0,8192})"/g;
    let a;
    while ((a = attrRe.exec(tag)) !== null) attrs[a[1]] = a[2];
    const b = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(attrs.bounds || '');
    const center = b
      ? { x: Math.round((+b[1] + +b[3]) / 2), y: Math.round((+b[2] + +b[4]) / 2) }
      : null;
    nodes.push({
      cls: attrs.class || '',
      bounds: b ? { x1: +b[1], y1: +b[2], x2: +b[3], y2: +b[4] } : null,
      id: attrs['resource-id'] || '',
      text: attrs.text || '',
      desc: attrs['content-desc'] || '',
      clickable: attrs.clickable === 'true',
      enabled: attrs.enabled === 'true',
      checked: attrs.checked === 'true',
      // uiautomator only reports what is on screen, so everything it emits is
      // visible by construction. Stated rather than left undefined, so the
      // shared matchers can read one field on both platforms.
      visible: true,
      center,
    });
  }
  return nodes;
}

const byId = (nodes, id) => nodes.find((n) => n.id === id && n.center);
const byText = (nodes, text) => nodes.find((n) => n.center && (n.text === text || n.desc === text));
const byTextContains = (nodes, sub) =>
  nodes.find((n) => n.center && (n.text.includes(sub) || n.desc.includes(sub)));

// Short, human-readable summary of what is on screen — the key to
// diagnosing failures without re-driving the device by hand.
function summarizeScreen(nodes) {
  const ids = [...new Set(nodes.map((n) => n.id).filter(Boolean))].slice(0, 40);
  const texts = [...new Set(nodes.map((n) => n.text).filter((t) => t && t.length <= 40))].slice(
    0,
    20,
  );
  return { testTags: ids, texts };
}

// --------------------------------------------------------------------------
// Reporter — records every step, writes md + json, prints live progress
// --------------------------------------------------------------------------

/**
 * Should this step's SCREEN be dumped?
 *
 * A failing step always is: the diagnostic that names what was on screen is
 * the most valuable line in a red run, and it must never become opt-in.
 *
 * A passing step only under `--debug`, because the dump is not free — ~65ms on
 * Android but ~700ms on iOS, several hundred times a matrix. Paying that on
 * every run to answer the occasional "what did the screen actually say?" is
 * the wrong default; asking for it when you want it is the right one.
 *
 * Split out as a function so the POLICY is testable without a phone, an Appium
 * server, or a step that has to fail on purpose to be observed.
 *
 * @param {'pass'|'fail'} status
 * @param {boolean} debug
 * @returns {boolean}
 */
function capturesScreenFor(status, debug) {
  return status === 'fail' || debug === true;
}

class Reporter {
  constructor(outDir, meta) {
    this.outDir = outDir;
    this.runId = `${meta.target}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    this.runDir = path.join(outDir, 'runs', this.runId);
    fs.mkdirSync(this.runDir, { recursive: true });
    this.meta = { ...meta, runId: this.runId, startedAt: new Date().toISOString() };
    this.journeys = [];
    this.current = null;
    this.shotCounter = 0;
    // Read on EVERY step, so it lives on the reporter rather than being
    // threaded through each call. Recorded in `meta` too, which means the
    // report itself says whether the passing steps carry a screen — a reader
    // should not have to infer that from whether the field happens to be set.
    this.debug = meta.debug === true;
  }

  startJourney(id, title) {
    this.current = { id, title, status: 'running', startedAt: Date.now(), steps: [] };
    this.journeys.push(this.current);
    console.log(`\n=== ${id} — ${title} ===`);
  }

  endJourney(status, error) {
    this.current.status = status;
    this.current.durationMs = Date.now() - this.current.startedAt;
    if (error) this.current.error = error;
    const icon = status === 'pass' ? '✓ PASS' : '✗ FAIL';
    console.log(
      `--- ${this.current.id}: ${icon} (${(this.current.durationMs / 1000).toFixed(1)}s)`,
    );
    this.current = null;
  }

  // Wrap a unit of work: time it, capture a screenshot + screen summary,
  // record pass/fail. On failure it throws so the journey aborts cleanly.
  async step(device, name, fn) {
    const rec = { name, status: 'running', startedAt: Date.now() };
    process.stdout.write(`  ▶ ${name} ... `);
    let caught = null;
    try {
      const detail = await fn();
      rec.status = 'pass';
      if (detail) rec.detail = detail;
    } catch (e) {
      rec.status = 'fail';
      rec.detail = e.message;
      caught = e;
    }
    if (capturesScreenFor(rec.status, this.debug)) {
      try {
        rec.screen = summarizeScreen(parseNodes(await device.dumpXml()));
      } catch (_e) {
        /* dump may itself fail */
      }
    }
    rec.durationMs = Date.now() - rec.startedAt;
    // Screenshot every step (cheap and invaluable for "see the results").
    //
    // The link is recorded only once the file EXISTS. Previously `screencap`
    // was called without awaiting it — async on iOS, synchronous on Android —
    // and `rec.screenshot` was set regardless, so every iOS run linked a final
    // screenshot that `process.exit()` had cut short. On a FAILING run that is
    // the frame of the failing step: the most valuable one, guaranteed missing.
    // A report that cites evidence which is not there is worse than one that
    // admits it has none.
    try {
      const shot = `${String(++this.shotCounter).padStart(2, '0')}-${this.current.id}-${rec.status}.png`;
      const abs = path.join(this.runDir, shot);
      await device.screencap(abs);
      if (fs.existsSync(abs) && fs.statSync(abs).size > 0) {
        rec.screenshot = `runs/${this.runId}/${shot}`;
      } else {
        console.log(`  (warn) screenshot for "${rec.name}" was not written — not linking it`);
      }
    } catch (e) {
      // Named, not swallowed. A silent screenshot failure is how a report ends
      // up quietly thinner than the run it describes.
      console.log(`  (warn) screenshot for "${rec.name}" failed: ${e.message.split('\n')[0]}`);
    }
    this.current.steps.push(rec);
    if (rec.status === 'pass') {
      console.log(`✓ (${(rec.durationMs / 1000).toFixed(1)}s)`);
      if (rec.screen)
        console.log(`     on-screen testTags: ${rec.screen.testTags.join(', ') || '(none)'}`);
    } else {
      console.log(`✗ ${rec.detail}`);
      if (rec.screen)
        console.log(`     on-screen testTags: ${rec.screen.testTags.join(', ') || '(none)'}`);
      throw caught;
    }
  }

  finish() {
    const passed = this.journeys.filter((j) => j.status === 'pass').length;
    const failed = this.journeys.filter((j) => j.status === 'fail').length;
    this.meta.finishedAt = new Date().toISOString();
    this.meta.summary = { total: this.journeys.length, passed, failed };

    const json = { ...this.meta, journeys: this.journeys };
    fs.writeFileSync(path.join(this.runDir, 'report.json'), JSON.stringify(json, null, 2));
    fs.writeFileSync(path.join(this.outDir, 'latest-report.json'), JSON.stringify(json, null, 2));
    const md = this.renderMarkdown(json);
    fs.writeFileSync(path.join(this.outDir, 'latest-report.md'), md);
    fs.writeFileSync(path.join(this.runDir, 'report.md'), md);

    console.log('\n========================================');
    console.log(
      `  RESULT: ${passed}/${this.journeys.length} journeys passed${failed ? `, ${failed} FAILED` : ''}`,
    );
    if (dumpCost.count > 0) {
      const wall = Date.now() - Date.parse(this.meta.startedAt);
      console.log(
        `  Screen reads: ${dumpCost.count} dumps, ${(dumpCost.ms / 1000).toFixed(1)}s ` +
          `(${Math.round(dumpCost.ms / dumpCost.count)}ms each, ` +
          `${Math.round((dumpCost.ms / wall) * 100)}% of the run)`,
      );
    }
    console.log(`  Report: ${path.join(this.outDir, 'latest-report.md')}`);
    console.log(`  Artifacts: ${this.runDir}`);
    console.log('========================================');
    return failed === 0;
  }

  renderMarkdown(json) {
    const L = [];
    L.push(`# ShyTalk on-device journey report`);
    L.push('');
    L.push(`- **Run:** \`${json.runId}\``);
    L.push(
      `- **Target:** ${json.target}  |  **Device:** \`${json.serial}\` (${json.device || '?'})`,
    );
    L.push(`- **Started:** ${json.startedAt}  |  **Finished:** ${json.finishedAt}`);
    if (json.video) L.push(`- **Recording:** \`${json.video}\``);
    const s = json.summary;
    const verdict =
      s.failed === 0 ? `✅ ALL ${s.total} PASSED` : `❌ ${s.failed} of ${s.total} FAILED`;
    L.push(`- **Result:** ${verdict}`);
    L.push('');
    L.push('| Journey | Result | Duration | Steps |');
    L.push('| --- | --- | --- | --- |');
    for (const j of json.journeys) {
      const icon = j.status === 'pass' ? '✅' : '❌';
      const ok = j.steps.filter((x) => x.status === 'pass').length;
      L.push(
        `| ${j.id} — ${j.title} | ${icon} | ${(j.durationMs / 1000).toFixed(1)}s | ${ok}/${j.steps.length} |`,
      );
    }
    L.push('');
    for (const j of json.journeys) {
      const icon = j.status === 'pass' ? '✅' : '❌';
      L.push(`## ${icon} ${j.id} — ${j.title}`);
      L.push('');
      for (const st of j.steps) {
        const si = st.status === 'pass' ? '✅' : '❌';
        L.push(`### ${si} ${st.name} _(${(st.durationMs / 1000).toFixed(1)}s)_`);
        if (st.detail) L.push(`- ${st.status === 'fail' ? '**Reason:** ' : ''}${st.detail}`);
        if (st.screen) {
          L.push(`- On-screen testTags: \`${st.screen.testTags.join('`, `') || '(none)'}\``);
          if (st.screen.texts.length)
            L.push(`- On-screen text: ${st.screen.texts.map((t) => `“${t}”`).join(', ')}`);
        }
        if (st.screenshot) L.push(`- ![${st.name}](${st.screenshot})`);
        L.push('');
      }
    }
    return L.join('\n');
  }
}

// --------------------------------------------------------------------------
// Screen helpers (built on the grounded testTag contract)
// --------------------------------------------------------------------------
const MAIN_TABS = ['main_roomsTab', 'main_messagesTab', 'main_profileTab'];

/**
 * Every look at the screen goes through here, and every look COSTS. Measured on
 * 2026-08-23: an Android `uiautomator dump` is ~2240ms and an iOS `/source` is
 * ~278ms, so on Android the walk spends most of its life reading the screen
 * rather than driving it.
 *
 * Counted rather than estimated, and reported at the end of a run, because
 * "the journeys are slow" is not actionable and "N dumps × Xms = Ys of the
 * walk's Zs" is.
 */
const dumpCost = { count: 0, ms: 0 };

async function dump(device) {
  const started = Date.now();
  try {
    const nodes = parseNodes(await device.dumpXml());
    // Stamped so freshness is a FACT about when the phone was read, not a
    // claim a caller can make. `tapResolved` reuses a tree only while this
    // says it is still current.
    nodes.takenAt = Date.now();
    return nodes;
  } finally {
    dumpCost.count += 1;
    dumpCost.ms += Date.now() - started;
  }
}

/**
 * How long a tree stays usable for a tap that was already being set up.
 *
 * NOT a cache. It covers the microseconds between finding a control and
 * tapping it — `tapId` dumps to find the element and hands it straight to
 * `tapResolved`, with no tap, wait or navigation in between. Re-reading there
 * cost a second ~2280ms dump on Android for a screen that could not have
 * moved.
 *
 * Far below the time any real interaction takes, so anything that has actually
 * happened puts the tree outside the window and it is read again — which is
 * the SHY-0441 guarantee, unchanged.
 */
const TREE_FRESH_MS = 400;

/**
 * The shortest gap between two looks at the screen.
 *
 * A FLOOR, not an addition. Every wait loop used to read the screen and then
 * sleep 700-800ms regardless — on Android that is 800ms piled on top of a
 * ~2280ms read, for a phone that has already had two and a half seconds to
 * settle; on iOS, where a read is 278ms, it tripled the time to notice a
 * control appearing.
 */
const POLL_FLOOR_MS = 250;

/**
 * The gap iOS keeps between looks.
 *
 * Android's problem was a 2332ms read; iOS's was already 278ms, so tightening
 * the loop there buys little and cost a great deal: with the floor applied to
 * both, twelve of thirteen iPhone journeys failed where five had passed. The
 * walk was getting ahead of the UI on a platform that never had the defect
 * this is here to fix. Matched to the problem rather than applied uniformly.
 */
const IOS_POLL_GAP_MS = 700;

/**
 * How far a row may drift between two reads and still count as still.
 *
 * Not zero: a live tree can differ by a pixel of rounding without anything
 * having moved. Enough to tell that apart from a list carrying the row away.
 */
const ROW_STABLE_PX = 4;

/**
 * Wait out whatever is still owed since `tickStarted`, and nothing more.
 *
 * A read slower than the floor returns immediately, which is the whole point:
 * on Android the read alone had already given the phone 2.3 seconds to settle
 * before the old code slept another 800ms on top.
 */
async function pollGap(tickStarted, device) {
  const floor = device?.kind === 'ios' ? IOS_POLL_GAP_MS : POLL_FLOOR_MS;
  const owed = floor - (Date.now() - tickStarted);
  if (owed > 0) await sleep(owed);
}

/**
 * Wait for the persona sheet to go away, and say whether it did.
 *
 * Returns rather than throws: the caller has two more attempts, and "still
 * open" is an outcome it handles, not an error.
 */
async function pickerClosed(device, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const tick = Date.now();
    if (!pickerIsOpen(await dump(device))) return true;
    if (Date.now() >= deadline) return false;
    await pollGap(tick, device);
  }
}

/** Is this tree recent enough to tap from? */
function treeIsFresh(nodes) {
  // Both platforms now. The gate used to be "Android only", justified by "on
  // iOS a read is 278ms, so it saves almost nothing" -- measured on the
  // near-empty SignIn screen. A read on a real screen is ~700ms, so on iOS
  // every tap was costing TWO of them: `tapId` reads to find the control and
  // `tapResolved` immediately read again to re-resolve it.
  //
  // What makes this safe is the WINDOW, not the platform. TREE_FRESH_MS covers
  // the gap between finding a control and tapping it, with no tap, wait or
  // navigation in between -- nothing we did can have moved the screen, and
  // anything older than the window is re-read exactly as before. SHY-0441's
  // protection is against a screen that moved; within 400ms of our own read,
  // it has not.
  return (
    Array.isArray(nodes) &&
    Number.isFinite(nodes.takenAt) &&
    Date.now() - nodes.takenAt <= TREE_FRESH_MS
  );
}

/** Does `box` contain `point`? */
const boxHolds = (box, point) =>
  Boolean(box && point) &&
  point.x >= box.x1 &&
  point.x <= box.x2 &&
  point.y >= box.y1 &&
  point.y <= box.y2;

/**
 * Is a row far enough into its scrolling list to be tapped?
 *
 * A `LazyColumn` composes a little beyond its viewport, so a row can be in the
 * tree — with an id, sane bounds and an enabled flag — while sitting entirely
 * OUTSIDE the list it belongs to. Tapping its centre then misses the list
 * completely, and on iOS a sheet's surroundings are a dismiss scrim: the picker
 * closes, nothing is selected, and the app is back on SignIn looking exactly
 * as though sign-in had failed.
 *
 * Measured on the real iPhone, 2026-08-24, reaching for the admin persona:
 *
 *     persona_picker_list   y 258 -> 658
 *     persona_row_P-12      y 735 -> 788   (centre 762, 77pt below the list)
 *
 * Every journey needing that persona failed this way, while personas that
 * happened to compose inside the viewport passed.
 *
 * This is SHY-0441's lesson — findable is not reachable — applied to scroll
 * viewports rather than to overlays. It is deliberately a CONTAINMENT test
 * against the specific container, not a general `visible` gate: SHY-0441
 * removed that gate because captions on a plain Home screen report
 * `visible="false"` while plainly rendered.
 */
const centreIsInside = (container, target) =>
  Boolean(container?.bounds && target?.center) && boxHolds(container.bounds, target.center);

/**
 * Things that genuinely paint over an app's controls and swallow taps.
 *
 * Deliberately a SHORT, specific list rather than a general rule. The general
 * version — "anything drawn later whose box holds the point" — was tried and
 * was wrong on the very first device run, because a UI tree is not a stack of
 * painted rectangles.
 */
const SYSTEM_OVERLAY_HINTS = [
  'keyboard', // XCUIElementTypeKeyboard
  'inputmethod', // android.inputmethodservice.SoftInputWindow
  'navigationbar', // android:id/navigationBarBackground
  'statusbar',
  'systemui',
];

const looksLikeSystemOverlay = (n) =>
  SYSTEM_OVERLAY_HINTS.some((hint) => `${n.cls || ''} ${n.id || ''}`.toLowerCase().includes(hint));

/**
 * What is covering `target`, if anything.
 *
 * ## Why this is narrow on purpose
 *
 * The first version asked a general question: is any node drawn LATER holding
 * this point? It fired on the first real screen it met, and the tree says why:
 *
 * ```xml
 * <View clickable="true"  bounds="[405,2166][608,2334]">   <- the actual button
 *   <TextView text="Later" bounds="[461,2219][553,2282]"/> <- the target
 *   <Button   text=""      bounds="[405,2180][608,2320]"/> <- flagged as coverer
 * </View>
 * ```
 *
 * Those are **Compose semantics nodes**, not painted views. The `Button` is the
 * `Role.Button` node for the SAME composable as the label — `clickable="false"`,
 * a sibling, and LARGER than the label. Sibling semantics nodes cannot occlude
 * one another, and a tap at the label's centre resolves to the one clickable
 * ancestor either way. Every Compose button reached by its text has this shape,
 * so the general rule would have reddened healthy walks broadly.
 *
 * The only exemption then was "candidate wholly INSIDE the target", which
 * anticipated label-inside-button. Compose emits the inverse.
 *
 * So this asks a specific question instead: **is a SYSTEM OVERLAY on top of
 * it?** That is exactly the two defects this exists for — SHY-0419's keyboard
 * and SHY-0428's navigation bar — and a system overlay is never a sibling of an
 * app control, so the Compose shape cannot reach it.
 *
 * A product modal covering a control is NOT caught. That is a deliberate trade:
 * a check that reddens healthy walks gets disabled, and then catches nothing at
 * all. Widening it needs tree DEPTH so ancestry can be reasoned about, which
 * neither parser records today.
 *
 * @returns {object|null} the covering overlay, or null
 */
function occluderOf(nodes, target) {
  if (!target?.bounds || !target?.center) return null;
  const from = nodes.indexOf(target);
  if (from === -1) return null;
  for (let i = from + 1; i < nodes.length; i += 1) {
    const other = nodes[i];
    if (!other?.bounds || !looksLikeSystemOverlay(other)) continue;
    if (boxHolds(other.bounds, target.center)) return other;
  }
  return null;
}

/**
 * Refuse to tap something a person could not have tapped.
 *
 * Findable is not reachable. `tapIdScrolling` asks whether the node is in the
 * tree; an occluded button is still in the tree, with an id, sane bounds and
 * `enabled=true`, so the walk clicked it and the step went green. Seen on the
 * real iPhone: the Send button entirely behind the keyboard at t≈67s of the
 * J38 recording.
 *
 * SHY-0419 WAS that defect. The journey written to prove it stays fixed could
 * not detect it, and would have gone green if it regressed. SHY-0428 is the
 * same class from the other side.
 *
 * The failure names what was in the way, because "not found" would send the
 * reader hunting for a missing element instead of looking at the overlay.
 *
 * @param {object[]} nodes
 * @param {object} target
 * @param {string} label
 */
function assertReachable(nodes, target, label) {
  // XCUITest's `visible` is NOT consulted, and that is a deliberate reversal.
  //
  // It was added here on the strength of its own name and a docstring that
  // called it "XCUITest's own word for on-screen". The device disagrees: on a
  // plain, settled Home screen the tab captions `Rooms`, `Messages` and
  // `Profile` all report `visible="false"` while rendered in front of you.
  // ShyTalk draws through Compose, so the accessibility snapshot's idea of
  // visible does not track what is painted.
  //
  // A guard that fires on plainly-visible controls is worse than no guard: it
  // reddens healthy walks, gets disabled, and then catches nothing at all.
  const over = occluderOf(nodes, target);
  if (over) {
    const name = over.cls || over.id || over.text || over.desc || '(unnamed)';
    const b = over.bounds;
    throw new Error(
      `${label} is covered by ${name} [${b.x1},${b.y1}][${b.x2},${b.y2}] — a tap at its ` +
        'centre would have hit that instead. Findable is not reachable (SHY-0419, SHY-0428).',
    );
  }
}

/**
 * Tap a node, re-resolving it IMMEDIATELY before the tap.
 *
 * Everything between a dump and a tap is a window in which the UI can move: a
 * keyboard opening, a list settling, a dialog arriving. Tapping the old point
 * then hits whatever occupies those pixels, the walk sees a plausible next
 * screen, and the step passes for the wrong reason.
 *
 * ## `relocate` is not optional decoration
 *
 * A first version re-resolved with `byText(fresh, node.text)`, which is
 * `.find()` — the FIRST match in document order. That silently threw away the
 * caller's disambiguation. `tapLowestText` deliberately picks the LOWEST node
 * with a given text, because in a confirmation dialog the title and the confirm
 * button carry the same words; re-resolving by first-match handed back the
 * title. Proven on the device: tapping the title left the dialog open and
 * sign-out hung, while the button the caller had chosen dismissed it.
 *
 * That is the inverse of the staleness bug and just as bad — a confident
 * re-resolution to the WRONG element of the same name. So a caller that picked
 * among look-alikes must pass the rule it used.
 *
 * @param {object} device
 * @param {object} node    a node from an earlier dump
 * @param {object} [o]
 * @param {(nodes: object[]) => object|null} [o.relocate] the caller's own
 *   predicate, re-applied to a fresh dump. Required whenever the node was
 *   chosen from several that match equally.
 * @param {string} [o.label] what to call it if it is gone
 */
async function tapResolved(device, node, labelOrOpts, extra) {
  const opts =
    typeof labelOrOpts === 'string'
      ? { label: labelOrOpts, ...extra }
      : { ...labelOrOpts, ...extra };
  const { relocate, label } = opts;
  // The tree is read FIRST, even when an element click is available, because
  // reachability is a question about the tree. Skipping the dump for an id'd
  // control is what let the element route bypass the check entirely — on iOS,
  // which is where SHY-0419 happened.
  //
  // A caller that has JUST read the screen may hand that tree over rather than
  // pay for a second read of the same thing (SHY-0447). Judged on when the
  // phone was actually read, not on the caller saying so, and re-read the
  // moment it is stale — so the re-resolve still protects against a screen
  // that moved, which is what SHY-0441 was about.
  const fresh = treeIsFresh(opts.nodes) ? opts.nodes : await dump(device);
  const again = relocate
    ? relocate(fresh)
    : (node.id && byId(fresh, node.id)) ||
      (node.text && byText(fresh, node.text)) ||
      (node.desc && byText(fresh, node.desc)) ||
      null;

  if (!again) {
    throw new Error(
      `tap target ${label || node.id || node.text || node.desc || '(unnamed)'} vanished between ` +
        'being found and being tapped — the screen moved, so tapping the old point would have ' +
        'hit whatever is there now',
    );
  }

  // Checked BEFORE any of the click routes, so an occluded control fails the
  // same way whichever backend is driving.
  assertReachable(fresh, again, label || again.id || again.text || '(unnamed)');

  if (again.id && typeof device.tapElement === 'function') {
    await device.tapElement(again.id);
    return;
  }

  // Label-based element click ONLY when the label is unique on screen. Appium's
  // `/element` returns the first match, so using it on an ambiguous label would
  // reintroduce the wrong-element bug by another route.
  const labelText = again.text || again.desc;
  if (
    labelText &&
    typeof device.tapElementByLabel === 'function' &&
    fresh.filter((n) => n.text === labelText || n.desc === labelText).length === 1
  ) {
    await device.tapElementByLabel(labelText);
    return;
  }

  // No identifier and an ambiguous label: a coordinate from the dump taken
  // moments ago is the tightest window available, and the caller's own rule
  // chose which of the look-alikes it belongs to.
  await device.tap(again.center.x, again.center.y);
}

/**
 * Tap the element with this id.
 *
 * Element-based where the backend can do it. Appium resolves and clicks in one
 * server-side operation, so nothing can move in between — the same thing
 * Playwright does, and the reason a locator beats a coordinate.
 *
 * The Android backend has no such primitive, so it re-resolves instead; see
 * `tapResolved`.
 */
async function tapId(device, id) {
  // Everything goes through tapResolved, including backends that can click an
  // element directly. Short-circuiting here skipped the reachability check for
  // exactly the platform whose defect motivated it.
  const nodes = await dump(device);
  const n = byId(nodes, id);
  if (!n) throw new Error(`tap target #${id} not found on screen`);
  // The tree from a moment ago, rather than a second read of the same screen.
  await tapResolved(device, n, { label: `#${id}`, nodes });
}

// Tap the lowest-on-screen node with an exact text. Used for dialog confirm
// buttons whose label also appears as the dialog heading (e.g. the "Sign
// Out" button sits below the "Sign Out" title) and which carry no testTag
// because they live in a Compose dialog.
/** The lowest node with this exact text — in a dialog, the button under the title. */
const lowestWithText = (nodes, text) => {
  const matches = nodes.filter((n) => n.center && n.text === text);
  if (matches.length === 0) return null;
  return matches.reduce((a, b) => (b.center.y > a.center.y ? b : a));
};

async function tapLowestText(device, text) {
  const nodes = await dump(device);
  const target = lowestWithText(nodes, text);
  if (!target) throw new Error(`no "${text}" node to tap`);
  // The rule travels with the node. Without it the re-resolve takes the FIRST
  // match, which in a confirmation dialog is the title rather than the button.
  await tapResolved(device, target, {
    relocate: (fresh) => lowestWithText(fresh, text),
    label: `lowest "${text}"`,
    nodes,
  });
  await sleep(900);
}

/**
 * Type into a field, addressed by testTag.
 *
 * `input text` treats a space as an argument separator, so spaces become `%s`
 * and the whole thing is quoted. A message typed without this arrives as only
 * its first word, which looks like a truncation bug in the product.
 */
/**
 * Type into a field.
 *
 * `clearFirst` matters whenever the field can arrive PRE-FILLED. Android's
 * `input text` APPENDS — it does not replace — so typing "B" into a field
 * already holding "A" leaves "AB". SHY-0456 hit this on the create-room
 * dialog, which pre-fills the last room name: the journey asked for a room
 * called JR-CORE-<t2> and got one called "JR-CORE-<t1>JR-CORE-<t2>", so the
 * lookup that followed found nothing and the failure pointed at the database
 * rather than at the keystrokes.
 *
 * Off by default so existing journeys keep the behaviour they were written
 * against; pass it wherever the field is not guaranteed empty.
 */
async function typeInto(device, id, text, { clearFirst = false } = {}) {
  if (device.kind === 'ios') {
    // Addressed by identifier and set directly. Typing key-by-key through the
    // on-screen keyboard is slower and can drop characters when the field
    // scrolls under it -- which looks like the product losing input.
    // XCUITest's /value APPENDS too — the comment that once claimed this
    // branch "sets directly" was wrong, and believing it cost SHY-0456 an
    // identical concatenated-name failure on the iPhone after it was fixed on
    // Android. The driver clears via /element/{id}/clear when asked.
    await device.typeText(id, text, { clearFirst });
    await sleep(400);
    return;
  }
  await tapId(device, id);
  if (clearFirst) {
    // Cursor to the end, then delete back through whatever was there. Bounded
    // by the longest field this is used on rather than looping on a re-read,
    // which would cost a full dump per character.
    device.shell('input keyevent KEYCODE_MOVE_END');
    device.shell(`input keyevent ${new Array(60).fill('KEYCODE_DEL').join(' ')}`);
    await sleep(200);
  }
  device.shell(`input text ${JSON.stringify(text.replace(/ /g, '%s'))}`);
  await sleep(500);
}

/** The first node whose testTag STARTS WITH `prefix` — tags that embed an id. */
const byIdPrefix = (nodes, prefix) => nodes.find((n) => n.id.startsWith(prefix) && n.center);

/**
 * Bring a control on screen, then tap it.
 *
 * A form long enough to scroll, with the keyboard up, can leave its primary
 * action below the fold — which is what a person meets, and what SHY-0419 was
 * filed for on iOS. Scrolling to it is the human action, so the journey does
 * the same rather than tapping coordinates it cannot see.
 *
 * Bounded: if the control never appears the failure NAMES it, instead of the
 * runner swiping forever on a screen that does not contain it.
 */
async function tapIdScrolling(device, id, maxSwipes = 6) {
  const { w, h } = device.size();
  for (let i = 0; i <= maxSwipes; i++) {
    if (byId(await dump(device), id)) {
      await tapId(device, id);
      return i;
    }
    // The gesture stays in the UPPER half on purpose. A swipe that STARTS
    // low lands on the on-screen keyboard, which swallows it -- so the page
    // never moves and the button below the fold stays unreachable. That is
    // indistinguishable, in a log, from a page that cannot scroll at all.
    await device.swipe(
      Math.round(w / 2),
      Math.round(h * 0.45),
      Math.round(w / 2),
      Math.round(h * 0.1),
    );
    await sleep(700);
  }
  throw new Error(`#${id} never came on screen after ${maxSwipes} swipes`);
}

async function waitForId(device, id, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  while (Date.now() < deadline) {
    const tick = Date.now();
    const nodes = await dump(device);
    if (byId(nodes, id)) return nodes;
    last = summarizeScreen(nodes).testTags;
    await pollGap(tick, device);
  }
  throw new Error(
    `timed out (${timeoutMs}ms) waiting for #${id}; screen showed: ${last.join(', ') || '(none)'}`,
  );
}

async function waitForText(device, sub, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  while (Date.now() < deadline) {
    const tick = Date.now();
    const nodes = await dump(device);
    if (byTextContains(nodes, sub)) return nodes;
    last = summarizeScreen(nodes).testTags;
    await pollGap(tick, device);
  }
  throw new Error(
    `timed out (${timeoutMs}ms) waiting for text "${sub}"; screen showed: ${last.join(', ') || '(none)'}`,
  );
}

// Persona picker rows carry NO testTag — only visible text (display name,
// email, cohort). Match the unique email and scroll the dialog when the row
// sits below the fold (P-10+ start off-screen).
/**
 * Open the dev persona picker, and wait for the picker ITSELF (SHY-0447).
 *
 * This used to wait for the text "Sign in as test persona", which is the label
 * of the BUTTON that opens the picker — on screen before the tap, during it,
 * and after. So the wait returned instantly and had never once waited for the
 * sheet.
 *
 * It went unnoticed while the walk was slow: `selectPersonaByText` sleeps
 * 700ms per scroll and has eight attempts, so the sheet always arrived during
 * the flailing. Once the Android screen read dropped from ~2332ms to ~65ms the
 * walk got ahead of the animation and swiped at a SignIn screen with no list
 * on it — every persona journey failing with "persona not found in picker
 * after scrolling" while `persona_picker_open` sat in the dump.
 *
 * `persona_picker_list` exists only while the sheet is open
 * (SignInScreen.kt), so it answers the question actually being asked.
 */
async function openPersonaPicker(device, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  // Already open is already done. The retry loop in `signInAs` calls this again
  // after a selection that did not take, and the button it presses lives on the
  // SignIn screen BEHIND the sheet -- so a second attempt reported "tap target
  // #persona_picker_open not found on screen" while the picker sat open in
  // front of it, hiding the real reason the first attempt failed.
  if (pickerIsOpen(await dump(device))) return;
  for (let attempt = 1; ; attempt++) {
    await tapId(device, 'persona_picker_open');
    try {
      // Short per-attempt window. The picker opens in ~500ms when the screen is
      // settled — measured on the iPhone — so a wait much longer than that is
      // not patience, it is a tap nobody received.
      await waitForId(device, 'persona_picker_list', Math.min(2500, deadline - Date.now()));
      return;
    } catch (e) {
      last = e;
      // The button is still there, so the tap was swallowed rather than the
      // picker having opened and closed. Press it again.
      if (Date.now() >= deadline) break;
      if (!byId(await dump(device), 'persona_picker_open')) break;
    }
  }
  throw new Error(
    `the persona picker did not open after ${timeoutMs}ms of trying: ${last?.message ?? 'unknown'}`,
  );
}

/**
 * Scroll the picker to a persona's ROW and tap the row itself.
 *
 * Not the email label inside it. A label is findable and not necessarily
 * hit-testable: on iOS the tap fell straight through to the list and nothing
 * was selected, which is why every journey needing a persona BELOW THE FOLD
 * failed while the ones above it passed.
 *
 * `tapId` goes through the element API and carries SHY-0441's reachability
 * check, so a row hidden behind the sheet header fails loudly instead of being
 * tapped into thin air.
 */
async function selectPersonaByText(device, needle) {
  const { w, h } = device.size();
  const rowTag = personaRowTag(needle);
  for (let i = 0; i < 8; i++) {
    const nodes = await dump(device);
    const row = byId(nodes, rowTag);
    // Inside the LIST, not merely in the tree. See centreIsInside.
    if (row && centreIsInside(byId(nodes, 'persona_picker_list'), row)) {
      // And STILL THERE a moment later. A list that is finishing its scroll
      // carries the row away between the read and the tap, and WebDriverAgent
      // answers `404: An element could not be located` for a row that was on
      // screen when we looked. Waiting longer is the wrong fix -- the question
      // is whether the list has stopped, and two agreeing reads answer it.
      const settled = byId(await dump(device), rowTag);
      if (settled && Math.abs(settled.center.y - row.center.y) <= ROW_STABLE_PX) {
        await tapId(device, rowTag);
        await sleep(1000);
        return;
      }
      // Still moving: fall through and look again rather than tapping at it.
      await sleep(300);
      continue;
    }
    // Anchored to the list's OWN box where it can be read. Fractions of the
    // screen are a guess about where the sheet is, and a swipe that starts
    // outside it scrolls the page behind instead -- or, on iOS, drags the sheet.
    const listBox = byId(nodes, 'persona_picker_list')?.bounds;
    const from = listBox
      ? {
          x: Math.floor((listBox.x1 + listBox.x2) / 2),
          y: Math.floor(listBox.y2 - (listBox.y2 - listBox.y1) * 0.15),
        }
      : { x: Math.floor(w / 2), y: Math.floor(h * 0.62) };
    const to = listBox
      ? { x: from.x, y: Math.floor(listBox.y1 + (listBox.y2 - listBox.y1) * 0.15) }
      : { x: Math.floor(w / 2), y: Math.floor(h * 0.32) };
    await device.swipe(from.x, from.y, to.x, to.y, 450);
    await sleep(700);
  }
  throw new Error(`persona "${needle}" not found in picker after scrolling`);
}

// Home = the three nav tabs by testTag, OR (fallback) all three tab labels
// as visible text — robust even if the nav testTags differ from the scan.
const anyMainTab = (nodes) =>
  MAIN_TABS.some((t) => byId(nodes, t)) ||
  (!!byText(nodes, 'Rooms') && !!byText(nodes, 'Messages') && !!byText(nodes, 'Profile'));

const atSignIn = (nodes) => !!byId(nodes, 'persona_picker_open');

// The legal-acceptance gate (4 checkboxes + continue) appears on cold start
// BEFORE sign-in. Tick each box only if currently unchecked — so a re-entry
// of this loop can never un-tick a box — then press continue. No-op if the
// legal screen isn't showing.
const LEGAL_BOXES = [
  'legal_acceptPrivacyCheckbox',
  'legal_acceptCommunityCheckbox',
  'legal_acceptTermsCheckbox',
  'legal_acceptCyberBullyingCheckbox',
];
async function handleLegalGate(device, nodes) {
  if (!byId(nodes, 'legal_continueButton')) return false;
  for (const box of LEGAL_BOXES) {
    const n = byId(nodes, box);
    if (n && !n.checked) {
      await tapResolved(device, n);
      await sleep(350);
    }
  }
  const cont = byId(await dump(device), 'legal_continueButton');
  if (cont && cont.enabled) {
    await tapResolved(device, cont);
    await sleep(1200);
  }
  return true;
}

// Android runtime-permission dialog (microphone for voice rooms,
// notifications, etc.) — always grant. Prefer "While using the app", fall
// back to the generic Allow / "Only this time"; never tap Deny. This is a
// separate system window (com.android.permissioncontroller), not our app.
const PERMISSION_ALLOW = [
  'com.android.permissioncontroller:id/permission_allow_foreground_only_button',
  'com.android.permissioncontroller:id/permission_allow_button',
  'com.android.permissioncontroller:id/permission_allow_one_time_button',
];
// `async` because it AWAITS the tap. Its one caller awaits it in turn — an
// unawaited tap is fire-and-forget on iOS, where tap is an HTTP round trip.
/**
 * Dismiss an overlay, treating "it went away by itself" as success (SHY-0447).
 *
 * `tapResolved` refuses to tap a control that vanished between being found and
 * being tapped — SHY-0441, and right: on a screen that moved, the old point
 * now holds something else. For an OVERLAY that reasoning inverts. The goal is
 * "nothing is in the way", and a permission dialog that auto-answered or a
 * reward sheet that dismissed itself has delivered exactly that. Failing the
 * walk because the obstacle removed itself is failing for the outcome we
 * wanted.
 *
 * Any other failure still propagates: a dialog that is present and cannot be
 * dismissed is a real problem.
 */
async function dismissOverlay(device, node) {
  try {
    await tapResolved(device, node);
  } catch (e) {
    if (!/vanished between being found and being tapped/.test(e.message || '')) throw e;
  }
  return true;
}

async function handlePermissionDialog(device, nodes) {
  for (const id of PERMISSION_ALLOW) {
    const n = byId(nodes, id);
    if (n) return dismissOverlay(device, n);
  }
  return false;
}

// Daily check-in / rewards calendar pops over Home right after sign-in. It's
// a Compose dialog (text only, no testTags), so match button text. Dismiss
// via "Later" (no side effects); fall back to claiming if that's all there is.
async function handleRewardCalendar(device, nodes) {
  const btn = byText(nodes, 'Later') || byTextContains(nodes, 'Claim Today');
  if (!btn) return false;
  await dismissOverlay(device, btn);
  await sleep(900);
  return true;
}

// The app's "Display over other apps" rationale (floating-bubble overlay
// permission). Tapping Allow bounces to a system Settings page we don't
// need, so dismiss with "Not now".
async function handleOverlayBubbleDialog(device, nodes) {
  if (
    !byTextContains(nodes, 'Display over other apps') &&
    !byTextContains(nodes, 'floating bubble')
  ) {
    return false;
  }
  const n = byTextContains(nodes, 'Not now');
  if (!n) return false;
  await dismissOverlay(device, n);
  await sleep(800);
  return true;
}

// Generic "drive forward through interstitials until <isDone>". Observed
// cold-start order on-device: Legal gate -> SignIn -> [Splash warm-up] ->
// Main. ProfileSetup / RequiredDOB must NOT appear for fully-seeded personas;
// if they do it's a real data finding and we fail with a clear message.
async function advanceUntil(device, isDone, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tick = Date.now();
    const nodes = await dump(device);

    // Overlays are cleared BEFORE deciding we have arrived.
    //
    // The other order races a modal's presentation animation. For exactly one
    // dump the tree holds BOTH the screen behind and the modal, so a check for
    // "is Home showing" matched while the daily-reward sheet was mid-present.
    // `settle` returned "Home reached", nothing dismissed the sheet, and one
    // dump later iOS marked the covered subtree inaccessible — so the tab ids
    // vanished for as long as it stayed up. The next `waitForId` then stared
    // for twenty seconds at a screen that could never satisfy it: seventeen
    // identical source polls and not one tap.
    //
    // Checking the overlays first costs a pass of cheap lookups on a screen
    // that has none, and removes the window entirely.
    if (await handlePermissionDialog(device, nodes)) {
      await pollGap(tick, device);
      continue;
    }
    if (await handleRewardCalendar(device, nodes)) continue;
    if (await handleOverlayBubbleDialog(device, nodes)) continue;
    if (await handleLegalGate(device, nodes)) continue;

    if (isDone(nodes)) return nodes;

    if (byId(nodes, 'profileSetup_continueButton'))
      throw new Error('stuck on ProfileSetup — persona has no profile (seed incomplete?)');
    if (byId(nodes, 'requiredDob_continueButton'))
      throw new Error('stuck on RequiredDOB — persona has no date of birth (seed incomplete?)');
    // `splash_continueButton` is retained for builds predating SHY-0144's
    // splash retirement (see android-adb-driver.js for the full reasoning).
    for (const cont of ['splash_continueButton', 'startingScreen_dismissButton']) {
      if (!byId(nodes, cont)?.enabled) continue;
      // Re-resolved, because `nodes` is from the TOP of this loop and the
      // handlers above may each have dismissed a dialog and rearranged
      // everything since. Tapping the remembered point would hit whatever now
      // occupies it — and the loop would carry on as if the button had been
      // pressed.
      const current = byId(await dump(device), cont);
      // Gone already: one of the handlers dealt with it. The next iteration
      // re-reads the screen rather than tapping where it used to be.
      if (!current?.enabled) break;
      await tapResolved(device, current);
      break;
    }
    await pollGap(tick, device);
  }
  const last = summarizeScreen(await dump(device)).testTags;
  throw new Error(
    `${label || 'target'} not reached within ${timeoutMs}ms; screen showed: ${last.join(', ') || '(none)'}`,
  );
}

const reachSignIn = (device, timeoutMs = 60000) =>
  advanceUntil(device, atSignIn, timeoutMs, 'SignIn');
const advanceToMain = (device, timeoutMs = 60000) =>
  advanceUntil(device, anyMainTab, timeoutMs, 'Home');
// Drive forward until we hit a STABLE anchor — either the SignIn screen or
// the Home tab bar — clearing dialogs/interstitials on the way.
const settle = (device, timeoutMs = 60000) =>
  advanceUntil(device, (n) => atSignIn(n) || anyMainTab(n), timeoutMs, 'SignIn or Home');

// Get to the SignIn screen regardless of where the app currently sits. A
// signed-in relaunch lands on Home, so settle to a stable anchor first, then
// sign out if we're signed in.
async function ensureAtSignIn(device, pkg) {
  // The first settle is allowed to FAIL. The app may have been left on any
  // screen at all by a previous run -- a half-filled support form, a dialog, a
  // detail page -- and none of those become SignIn or Home by waiting. This
  // used to throw here, before reaching its own restart path, so the recovery
  // could only ever recover from the states it had already expected. A journey
  // that cannot start from an unknown screen is a journey nobody can re-run.
  let nodes;
  try {
    // 20s, deliberately. Shortening this to 8s was tried on 2026-08-24 and made
    // the matrix WORSE -- 544s to 1019s -- because it gives up on a screen that
    // was about to settle and falls through to a force-stop and relaunch, which
    // is far more expensive than waiting. Two journeys went from 37s and 96s to
    // 301s and 367s on that change alone.
    nodes = await settle(device, 20000);
  } catch (_e) {
    nodes = null;
  }
  if (nodes && atSignIn(nodes)) return;
  if (nodes && anyMainTab(nodes)) {
    try {
      await signOutFlow(device);
      return;
    } catch (_e) {
      // Falls through to the restart below rather than failing the journey.
      // This function's whole job is to ARRIVE at SignIn, and it has a stronger
      // way of doing that a few lines down; refusing to use it because the
      // polite route was slow is how a timeout became a red journey.
    }
  }
  await device.forceStop(pkg);
  // Awaited: on iOS this foregrounds the app through the Appium session and
  // re-attaches WebDriverAgent to it. Unawaited, the next dump races the
  // activation and photographs the springboard.
  await device.launch(pkg);
  await sleep(1500);
  nodes = await settle(device, 45000);
  if (atSignIn(nodes)) return;
  if (anyMainTab(nodes)) await signOutFlow(device);
}

// Profile tab -> settings -> sign out -> confirm -> back at SignIn.
async function signOutFlow(device) {
  await tapId(device, 'main_profileTab');
  await waitForId(device, 'main_settingsButton', 6000);
  await tapId(device, 'main_settingsButton');
  await waitForId(device, 'settings_signOutButton', 6000);
  await tapId(device, 'settings_signOutButton');
  await waitForText(device, 'Are you sure you want to sign out', 6000);
  await tapLowestText(device, 'Sign Out');
  // 12s -> 45s. Signing out is a network round trip and a navigation, and on
  // the iPhone it routinely takes longer than twelve seconds. The symptom was
  // a perfectly ALTERNATING matrix: a journey that succeeded left the app on
  // Home, the next one's sign-out timed out and failed, that sign-out then
  // completed anyway, and the journey after it passed. Seven of fourteen, every
  // other one, all reporting "SignIn not reached within 12000ms".
  //
  // It only appeared once the persona-picker fixes made sign-ins SUCCEED --
  // before that, failing journeys left the app at SignIn and no sign-out was
  // ever attempted. A latent tuning, sized for Android.
  await reachSignIn(device, 45000);
}

// --------------------------------------------------------------------------
// Firestore assertions (local emulator, via firebase-admin)
// --------------------------------------------------------------------------
// The journeys pair every UI mutation with a DB-state assertion. For the
// local target we read the Firestore emulator directly (no creds needed); the
// emulator host is hardcoded for local so a DB assertion can never touch a
// real project. dev/prod DB assertions are deferred (would need creds): db is
// null there and DB steps are skipped with a clear note.
function initDb(target) {
  if (target !== 'local') return null;
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
  if (!require('firebase-admin/app').getApps().length) {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-shytalk' });
  }
  return require('firebase-admin/firestore').getFirestore();
}

async function dbGet(db, docPath) {
  const snap = await db.doc(docPath).get();
  return snap.exists ? snap.data() : null;
}

// Poll <docPath>.<field> until <predicate> holds; throw with the last value seen.
async function dbWaitField(db, docPath, field, predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let last = '(doc missing)';
  while (Date.now() < deadline) {
    const data = await dbGet(db, docPath);
    if (data) last = data[field];
    if (data && predicate(data[field])) return last;
    if (Date.now() + 500 < deadline) await sleep(500);
    else break;
  }
  throw new Error(`DB ${docPath}.${field} predicate unmet; last=${JSON.stringify(last)}`);
}

/**
 * Wait for a query to return something, bounded (SHY-0447).
 *
 * A UI action and the server write it causes are not simultaneous. The
 * assertions here used to query once, immediately after the tap, and got away
 * with it only because the walk was slow: a screen read cost 2332ms, so the
 * server had seconds of accidental grace before anyone looked.
 *
 * With the read at ~65ms the walk overtook the write and step 14 reported
 * "the request never arrived" for a ticket that arrived a moment later. That
 * is the harness racing the product, and it would have been read as a product
 * defect.
 *
 * Bounded, so a request that genuinely never arrives still fails — and fails
 * saying how long it waited.
 */
async function dbWaitQuery(runQuery, { timeoutMs = 8000, pollMs = 200, what = 'query' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const snap = await runQuery();
    if (!snap.empty) return snap;
    if (Date.now() + pollMs >= deadline) {
      throw new Error(`${what} found nothing within ${timeoutMs}ms`);
    }
    await sleep(pollMs);
  }
}

/**
 * Do the seeded personas still have what the app needs to sign them in?
 *
 * Twice on 2026-08-23 the local emulator lost its persona data mid-session,
 * and the runner found out one journey at a time: twelve failures reading
 * "stuck on RequiredDOB — persona has no date of birth (seed incomplete?)",
 * a guess in a failure message, after minutes of walking. The first time cost
 * an hour of looking at the wrong thing.
 *
 * The data is knowable before the first tap. Pure, so the check itself is
 * pinned without a device or an emulator.
 */
function personasLookSeeded(docs) {
  const list = Array.isArray(docs) ? docs : [];
  if (list.length === 0) return { ok: false, missing: [] };
  const missing = list
    .filter((d) => !d || !d.dateOfBirth)
    .map((d, i) => (d && d.uniqueId) || `#${i + 1} (document missing)`);
  return { ok: missing.length === 0, missing };
}

const arrayContains = (v, needle) => Array.isArray(v) && v.includes(needle);

// --------------------------------------------------------------------------
// Server/API assertions (local: Auth emulator + express-api on localhost)
// --------------------------------------------------------------------------
// Mint a persona's Firebase ID token from the Auth emulator (custom claims
// like uniqueId/cohort ARE included), then call the express-api as that
// persona. This verifies the server-enforced rules (cohort gate, economy,
// moderation) the journey specs assert but the shipped UI doesn't expose.
const AUTH_EMU_URL =
  'http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo';
const API_BASE_URL = 'http://localhost:3000';

async function getIdToken(email, pw = 'localdev123') {
  const r = await fetch(AUTH_EMU_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pw, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) {
    throw new Error(`ID-token mint failed for ${email}: ${JSON.stringify(j.error || j)}`);
  }
  return j.idToken;
}

async function apiCall(method, pathStr, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${API_BASE_URL}${pathStr}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_e) {
    parsed = text;
  }
  return { status: r.status, body: parsed };
}

// --------------------------------------------------------------------------
// Journey definitions
// --------------------------------------------------------------------------
// Reusable: sign in as a seeded persona via the dev picker, ride the
// first-launch interstitials to Home, and confirm identity in the debug
// overlay. Switching personas mid-journey is just signOutFlow + signInAs.
/**
 * Every seeded persona's account id, keyed by the email the journeys sign in
 * with — taken from the provisioning script itself, which is the one place
 * that decides them. A local copy of this table would be a second place for
 * an id to live, and the journeys would keep passing while asserting on an
 * account that no longer exists.
 *
 * Requiring that module is side-effect free: it only builds the table at load
 * and reaches for firebase inside its functions.
 */
const PERSONA_UNIQUE_ID_BY_EMAIL = new Map(
  require('./provision-test-personas').personas.map((p) => [p.email, p.uniqueId]),
);

/**
 * The testTag of the ROW a persona occupies in the picker — `persona_row_P-12`.
 *
 * Derived from the same table the app seeds from, so the two cannot drift.
 */
const PERSONA_ROW_TAG_BY_EMAIL = new Map(
  require('./provision-test-personas').personas.map((p) => [p.email, `persona_row_${p.id}`]),
);

function personaRowTag(email) {
  const tag = PERSONA_ROW_TAG_BY_EMAIL.get(email);
  if (tag === undefined) {
    throw new Error(
      `no seeded persona for ${JSON.stringify(email)} — ` +
        `known: ${[...PERSONA_ROW_TAG_BY_EMAIL.keys()].join(', ')}`,
    );
  }
  return tag;
}

/**
 * Is the persona picker on screen?
 *
 * By its LIST, which both platforms surface. This used to ask whether
 * `persona_picker_open` was absent — but that tag belongs to the BUTTON on the
 * SignIn screen that opens the picker, and iOS never surfaces it, so the check
 * was vacuously true there and the selection step could not fail.
 */
const pickerIsOpen = (nodes) => !!byId(nodes, 'persona_picker_list');

/**
 * The account id a persona must be signed in as.
 *
 * Throws on an unknown email rather than returning undefined: an identity
 * check that quietly compares against `undefined` is worse than no check,
 * because the report still says the step passed.
 */
function personaUniqueId(email) {
  const uid = PERSONA_UNIQUE_ID_BY_EMAIL.get(email);
  if (uid === undefined) {
    throw new Error(
      `no seeded persona for ${JSON.stringify(email)} — ` +
        `known: ${[...PERSONA_UNIQUE_ID_BY_EMAIL.keys()].join(', ')}`,
    );
  }
  return uid;
}

/**
 * Read the account the DEVICE believes it is signed in as, out of the debug
 * badge (SHY-0205's watermark, WatermarkVerbosity.COMPACT).
 *
 * The badge is a test interface, not decoration — this parse and J38's are
 * its two consumers, which is why the account line survives compaction.
 * Returns null when no such line is on screen, so callers can tell "signed in
 * as somebody else" from "the overlay is not there at all".
 */
function accountOnDevice(nodes) {
  const node = nodes.find((n) => /^UID:\s*\d+/.test(n.text));
  return node ? Number(/UID:\s*(\d+)/.exec(node.text)[1]) : null;
}

/**
 * @param {string} email seeded persona to sign in as. WHO ends up signed in
 *   is then confirmed against that persona's account id — see
 *   [accountOnDevice]. It used to be confirmed against a prefix of the
 *   display name ("Alice (P-02"), which two personas could share and which
 *   said nothing about the account underneath; a journey that asserts on one
 *   account's screen while seeding another's data proves nothing at all.
 */
async function signInAs(device, reporter, ctx, email) {
  await reporter.step(device, `Reach SignIn (for ${email})`, async () => {
    await ensureAtSignIn(device, ctx.pkg);
    return 'at SignIn (persona picker available)';
  });
  await reporter.step(device, `Pick persona ${email}`, async () => {
    // Open the dev picker + select the persona. A scroll-to-row mistap on a
    // below-the-fold persona can dismiss the picker WITHOUT signing in (bounces
    // back to SignIn). Detect that — the persona_picker_open button is back on
    // screen after the tap settles — and retry the whole open+select.
    for (let attempt = 1; attempt <= 3; attempt++) {
      await openPersonaPicker(device);
      await selectPersonaByText(device, email);
      // Polled, not slept. A flat 2.5s was paid on EVERY journey whether the
      // picker had already closed or never would -- 32 seconds across a matrix,
      // spent looking at a screen that had finished changing.
      if (await pickerClosed(device, 6000)) {
        return `selected ${email} (attempt ${attempt})`;
      }
    }
    throw new Error(`selecting ${email} bounced back to SignIn 3x (sign-in failing?)`);
  });
  await reporter.step(device, `Land on Home`, async () => {
    await advanceToMain(device);
    return 'home reached — interstitials cleared';
  });
  const expected = personaUniqueId(email);
  await reporter.step(device, `Confirm the phone is signed in as ${expected}`, async () => {
    const deadline = Date.now() + 8000;
    let seen = null;
    // The badge samples its inputs on a 2s tick, so the account can lag the
    // sign-in by a frame or two. Polled rather than slept on: a fixed wait is
    // either too short on a cold device or dead time on a warm one.
    while (Date.now() < deadline) {
      seen = accountOnDevice(await dump(device));
      if (seen === expected) return `debug overlay shows account ${seen}`;
      await sleep(500);
    }
    throw new Error(
      seen === null
        ? `the debug overlay is not showing an account id, so who is signed in ` +
            `cannot be confirmed (expected ${expected} for ${email})`
        : `the phone is signed in as ${seen} but ${email} is account ${expected} — ` +
            `every assertion after this would be about the wrong person`,
    );
  });
}

// Auth-smoke journey: sign in as a persona + assert their Firestore doc.
function personaJourney(id, title, email, uid, cohort) {
  return {
    id,
    title,
    async run(device, reporter, ctx) {
      await signInAs(device, reporter, ctx, email);
      if (ctx.db && uid) {
        await reporter.step(device, `DB users/${uid} cohort=${cohort}`, async () => {
          const got = await dbWaitField(
            ctx.db,
            `users/${uid}`,
            'cohort',
            (v) => v === cohort,
            6000,
          );
          return `Firestore users/${uid}.cohort = "${got}"`;
        });
      }
    },
  };
}

// ── Adapted journeys (j01–j19) ────────────────────────────────────────────
// Each maps the SPEC'S INTENT to the REAL app (actual testTags + seeded
// personas + Firestore). Steps referencing UI not present in the shipped app
// (e.g. email/password signup, gacha tab, a discovery screen) are adapted or
// noted in the journey rather than faked. Operator-approved approach.

// j02 — the minor cohort gets the restricted UX (PMs gated). Uses seeded
// Marcus (P-04 minor) in place of the spec's ephemeral "Mia" signup, since the
// app has no email/password signup screen (auth is OAuth/OTP/persona-picker).
const J02 = {
  id: 'J02',
  title: 'j02 — minor (Marcus P-04): UI renders + server-enforced cross-cohort gate',
  async run(device, reporter, ctx) {
    await signInAs(device, reporter, ctx, 'minor-power@shytalk.dev');
    if (ctx.db) {
      await reporter.step(device, 'DB users/60000010 cohort=minor', async () => {
        const v = await dbWaitField(ctx.db, 'users/60000010', 'cohort', (x) => x === 'minor', 6000);
        return `Firestore cohort = "${v}"`;
      });
    }
    await reporter.step(device, 'Minor profile renders (age 17 + wallet)', async () => {
      await tapId(device, 'main_profileTab');
      await waitForId(device, 'profile_displayName', 6000);
      const nodes = await dump(device);
      if (!byTextContains(nodes, '17 years old'))
        throw new Error('expected minor age "17 years old" on profile');
      if (!byId(nodes, 'profile_walletButton')) throw new Error('profile_walletButton missing');
      return 'profile shows "17 years old" + wallet';
    });
    await reporter.step(device, 'FINDING: minor UI is NOT feature-hidden', async () => {
      // Spec j02 expects minors to have the PM tab + buy-coins HIDDEN. The
      // shipped app shows both (verified on-device), so cohort enforcement is
      // action/server-side, not UI-hiding. Recorded as a divergence finding,
      // not a failure — the journey verifies real behavior per the mandate.
      const nodes = await dump(device);
      const exposed = ['main_messagesTab', 'profile_walletButton'].filter((t) => byId(nodes, t));
      return `minor UI exposes ${exposed.join(' + ')} — spec expected hidden (gating is server-side)`;
    });
    // The REAL minor restriction (server-enforced, per the FINDING above).
    if (ctx.db) {
      await reporter.step(
        device,
        'API: minor→adult follow blocked (cross-cohort 404)',
        async () => {
          const token = await getIdToken('minor-power@shytalk.dev');
          const res = await apiCall('POST', '/api/users/60000010/follow', {
            token,
            body: { targetUserId: 50000010 },
          });
          if (res.status !== 404) {
            throw new Error(
              `expected 404 cross-cohort gate; got ${res.status}: ${JSON.stringify(res.body)}`,
            );
          }
          return `POST /users/60000010/follow {target: Alice} → 404 "${res.body?.error ?? res.status}" (OSA gate)`;
        },
      );
      await reporter.step(device, 'DB: minor did NOT follow the adult', async () => {
        const data = await dbGet(ctx.db, 'users/60000010');
        if (arrayContains(data?.followingIds, 50000010)) {
          throw new Error('users/60000010.followingIds wrongly contains adult 50000010');
        }
        return 'followingIds excludes 50000010 — cross-cohort write blocked';
      });
    }
  },
};

// j08 — the cross-cohort wall. Adult prober Vexa (P-07) is blocked from the
// minor Marcus across surfaces (follow, profile view) with existence-hiding
// 404s; an adult→adult control follow SUCCEEDS, proving the gate is
// cohort-specific, not a blanket block. Server-enforced (the spec's "every
// adult→minor surface 404s" lives in requireSameCohort, not the UI).
const J08 = {
  id: 'J08',
  title: 'j08 — cross-cohort wall: adult (Vexa P-07) blocked from minor (Marcus)',
  async run(device, reporter, ctx) {
    await signInAs(device, reporter, ctx, 'adult-prober@shytalk.dev');
    if (!ctx.db) return;
    const vexa = 50000040;
    const marcus = 60000010;
    const lena = 50000020;
    let vToken;
    await reporter.step(device, 'Mint Vexa (adult) API token', async () => {
      vToken = await getIdToken('adult-prober@shytalk.dev');
      return 'ID token minted from Auth emulator';
    });
    await reporter.step(device, 'API: adult→minor follow blocked (404)', async () => {
      const r = await apiCall('POST', `/api/users/${vexa}/follow`, {
        token: vToken,
        body: { targetUserId: marcus },
      });
      if (r.status !== 404)
        throw new Error(`expected 404; got ${r.status}: ${JSON.stringify(r.body)}`);
      return `follow Marcus → 404 "${r.body?.error ?? r.status}"`;
    });
    await reporter.step(device, 'API: adult→minor profile view blocked (404)', async () => {
      const r = await apiCall('GET', `/api/users/${marcus}`, { token: vToken });
      if (r.status !== 404)
        throw new Error(`expected 404; got ${r.status}: ${JSON.stringify(r.body)}`);
      return `GET Marcus profile → 404 (existence-hidden)`;
    });
    await reporter.step(device, 'Control: adult→adult follow SUCCEEDS', async () => {
      const r = await apiCall('POST', `/api/users/${vexa}/follow`, {
        token: vToken,
        body: { targetUserId: lena },
      });
      if (r.status !== 200)
        throw new Error(`expected 200; got ${r.status}: ${JSON.stringify(r.body)}`);
      // Unfollow so re-runs stay idempotent (same-cohort, so allowed).
      const un = await apiCall('POST', `/api/users/${vexa}/unfollow`, {
        token: vToken,
        body: { targetUserId: lena },
      });
      if (un.status !== 200) throw new Error(`control unfollow cleanup failed: ${un.status}`);
      return `follow Lena → 200 (gate is cohort-specific); unfollowed for idempotency`;
    });
    await reporter.step(device, 'DB: Vexa followingIds excludes the minor', async () => {
      const d = await dbGet(ctx.db, `users/${vexa}`);
      if (arrayContains(d?.followingIds, marcus))
        throw new Error('followingIds wrongly contains minor 60000010');
      return 'followingIds excludes 60000010 — cross-cohort write never happened';
    });
  },
};

// j04 — DOB-mismatch flip. Admin Greta (custom claim isAdmin=true) downgrades
// Hayato (P-06) to minor via the cohort-override endpoint; verified by the
// 200, the cohortOverride field, and the regulatory adminAuditLog row. The
// override is cleared at the end so re-runs are idempotent.
const J04 = {
  id: 'J04',
  title:
    'j04 — cohort-override is staff-only: regular member rejected (422), staff allowed + audited',
  async run(device, reporter, ctx) {
    await signInAs(device, reporter, ctx, 'admin@shytalk.dev');
    if (!ctx.db) return;
    const hayato = 50000030;
    let gToken;
    await reporter.step(device, 'Mint Greta admin token (isAdmin claim)', async () => {
      gToken = await getIdToken('admin@shytalk.dev');
      const claims = JSON.parse(Buffer.from(gToken.split('.')[1], 'base64url').toString());
      if (!claims.admin) throw new Error('Greta token missing admin custom claim');
      return `admin token minted (admin=${claims.admin}, uniqueId=${claims.uniqueId})`;
    });
    await reporter.step(
      device,
      'API: override a REGULAR member (Hayato) is REJECTED (422)',
      async () => {
        const r = await apiCall('POST', `/api/user/${hayato}/cohort-override`, {
          token: gToken,
          body: { override: 'minor', reason: 'attempt to override a regular member' },
        });
        if (r.status !== 422)
          throw new Error(`expected 422 guard; got ${r.status}: ${JSON.stringify(r.body)}`);
        const code = r.body?.error?.code || r.body?.error;
        return `regular member → 422 "${code}" (cohort-override is staff-only)`;
      },
    );
    // FINDING: spec j04 downgrades the REGULAR user Hayato via cohort-override,
    // but the real endpoint is STAFF-ONLY — a regular user's cohort derives
    // from DOB / age-verification review, not an admin override. We verify the
    // real guard (422 above) + the real positive case (override a staff acct).
    const selma = 50000080; // P-15 MC_SINGER (staff userType)
    await reporter.step(device, 'API: override a STAFF account (Selma) → 200 + audit', async () => {
      const r = await apiCall('POST', `/api/user/${selma}/cohort-override`, {
        token: gToken,
        body: { override: 'minor', reason: 'QA: staff cohort-override smoke' },
      });
      if (r.status !== 200)
        throw new Error(`expected 200; got ${r.status}: ${JSON.stringify(r.body)}`);
      const v = await dbWaitField(
        ctx.db,
        `users/${selma}`,
        'cohortOverride',
        (x) => x === 'minor',
        6000,
      );
      const snap = await ctx.db
        .collection('adminAuditLog')
        .where('targetUserId', '==', String(selma))
        .where('action', '==', 'COHORT_OVERRIDE_SET')
        .limit(1)
        .get();
      if (snap.empty) throw new Error('no COHORT_OVERRIDE_SET audit row for staff target');
      return `staff override → 200, cohortOverride="${v}", audit row present`;
    });
    await reporter.step(device, 'Cleanup: clear staff override (idempotent re-runs)', async () => {
      const r = await apiCall('POST', `/api/user/${selma}/cohort-override`, {
        token: gToken,
        body: { override: null, reason: 'journey-runner cleanup' },
      });
      if (r.status !== 200) throw new Error(`cleanup expected 200; got ${r.status}`);
      return 'staff cohortOverride cleared';
    });
  },
};

// j11 — harassment moderation cycle (server-enforced). Nora (P-09) reports
// Raul (P-08); admin Greta suspends Raul (appealable) with an audit row; Raul
// files an appeal; Greta unsuspends. Verified at the API + Firestore. Cleans
// up (unsuspend + delete the pending appeal) so re-runs are idempotent.
const J11 = {
  id: 'J11',
  title: 'j11 — moderation cycle: report → admin suspend (+audit) → appeal → unsuspend',
  async run(device, reporter, ctx) {
    await signInAs(device, reporter, ctx, 'victim@shytalk.dev');
    if (!ctx.db) return;
    const raul = 50000050;
    let noraToken;
    let gretaToken;
    let raulToken;
    await reporter.step(device, 'Mint Nora + Greta + Raul tokens', async () => {
      // Order is load-bearing: mint Raul's token BEFORE he is suspended so the
      // appeal step has a valid ID token (ID tokens stay valid ~1h regardless).
      noraToken = await getIdToken('victim@shytalk.dev');
      gretaToken = await getIdToken('admin@shytalk.dev');
      raulToken = await getIdToken('harasser@shytalk.dev');
      return '3 persona tokens minted';
    });
    await reporter.step(device, 'API: Nora reports Raul', async () => {
      // Reports resolve the reported user SERVER-SIDE by firebaseUid (auth uid),
      // not uniqueId — see resolveUniqueId() in middleware/auth.js. firebaseUids
      // are per-seed dynamic, so read Raul's from Firestore at runtime.
      const raulDoc = await dbGet(ctx.db, `users/${raul}`);
      if (!raulDoc?.firebaseUid) throw new Error('could not read Raul firebaseUid from Firestore');
      const r = await apiCall('POST', '/api/reports', {
        token: noraToken,
        body: {
          reportedUserId: raulDoc.firebaseUid,
          reason: 'harassment',
          description: 'offensive PMs (journey-runner)',
        },
      });
      if (r.status >= 300) {
        throw new Error(`report expected 2xx; got ${r.status}: ${JSON.stringify(r.body)}`);
      }
      return `POST /reports {reported: Raul firebaseUid} → ${r.status}`;
    });
    await reporter.step(device, 'API: admin suspends Raul (appealable) + audit row', async () => {
      const r = await apiCall('POST', `/api/admin/users/${raul}/suspend`, {
        token: gretaToken,
        body: { reason: 'harassment confirmed (journey-runner)', canAppeal: true },
      });
      if (r.status !== 200) {
        throw new Error(`suspend expected 200; got ${r.status}: ${JSON.stringify(r.body)}`);
      }
      await dbWaitField(ctx.db, `users/${raul}`, 'isSuspended', (v) => v === true, 6000);
      const audit = await ctx.db
        .collection('adminAuditLog')
        .where('targetUserId', '==', String(raul))
        .where('action', '==', 'SUSPEND')
        .limit(1)
        .get();
      if (audit.empty) throw new Error('no SUSPEND audit row for Raul');
      return 'Raul isSuspended=true + adminAuditLog SUSPEND present';
    });
    await reporter.step(device, 'API: Raul files an appeal', async () => {
      const r = await apiCall('POST', '/api/appeals', {
        token: raulToken,
        body: { appealText: 'I will not do it again (journey-runner)' },
      });
      if (r.status !== 200 && r.status !== 409) {
        throw new Error(`appeal expected 200/409; got ${r.status}: ${JSON.stringify(r.body)}`);
      }
      const appeals = await ctx.db
        .collection('suspensionAppeals')
        .where('userId', '==', raul)
        .where('status', '==', 'pending')
        .limit(1)
        .get();
      if (appeals.empty) throw new Error('no pending suspensionAppeals row for Raul');
      return `appeal → ${r.status}; pending suspensionAppeals present`;
    });
    await reporter.step(
      device,
      'Cleanup: admin unsuspends Raul + clears pending appeal',
      async () => {
        const r = await apiCall('POST', `/api/admin/users/${raul}/unsuspend`, {
          token: gretaToken,
          body: { reason: 'appeal accepted (journey-runner cleanup)' },
        });
        if (r.status >= 300) {
          throw new Error(`unsuspend expected 2xx; got ${r.status}: ${JSON.stringify(r.body)}`);
        }
        await dbWaitField(
          ctx.db,
          `users/${raul}`,
          'isSuspended',
          (v) => v === false || v === undefined,
          6000,
        );
        const pending = await ctx.db
          .collection('suspensionAppeals')
          .where('userId', '==', raul)
          .where('status', '==', 'pending')
          .get();
        for (const d of pending.docs) await d.ref.delete();
        return 'Raul unsuspended; pending appeals cleared (idempotent)';
      },
    );
  },
};

// j07 — social round-trip. Alice (P-02) follows Lena (P-05), then they PM each
// other (both adult → same-cohort, so the conversation cohort gate passes).
// The express-api message-send path needs the conversation doc to pre-exist —
// the app writes it directly to Firestore, so the runner mirrors that. Cleans
// up the conversation + follow so re-runs are idempotent.
const J07 = {
  id: 'J07',
  title: 'j07 — social: follow + same-cohort PM round-trip (Alice ↔ Lena)',
  async run(device, reporter, ctx) {
    await signInAs(device, reporter, ctx, 'adult-power@shytalk.dev');
    if (!ctx.db) return;
    const alice = 50000010;
    const lena = 50000020;
    const convId = `jr-j07-${alice}-${lena}`;
    let aliceToken;
    let lenaToken;
    await reporter.step(device, 'Mint Alice + Lena tokens', async () => {
      aliceToken = await getIdToken('adult-power@shytalk.dev');
      lenaToken = await getIdToken('lapsed-adult@shytalk.dev');
      return 'tokens minted';
    });
    await reporter.step(device, 'API: Alice follows Lena (same-cohort → 200)', async () => {
      const r = await apiCall('POST', `/api/users/${alice}/follow`, {
        token: aliceToken,
        body: { targetUserId: lena },
      });
      if (r.status !== 200)
        throw new Error(`expected 200; got ${r.status}: ${JSON.stringify(r.body)}`);
      await dbWaitField(
        ctx.db,
        `users/${alice}`,
        'followingIds',
        (v) => arrayContains(v, lena),
        6000,
      );
      return 'followingIds contains Lena';
    });
    await reporter.step(device, 'Setup: create the Alice↔Lena conversation doc', async () => {
      await ctx.db.doc(`conversations/${convId}`).set({
        participantIds: [alice, lena],
        crossCohortAtMigration: false,
        isGroup: false,
        createdAt: Date.now(),
      });
      return `conversations/${convId} created`;
    });
    await reporter.step(device, 'API: Alice sends Lena a PM', async () => {
      const r = await apiCall('POST', `/api/conversations/${convId}/messages`, {
        token: aliceToken,
        body: { text: 'hi Lena (journey-runner)', type: 'TEXT' },
      });
      if (r.status !== 200)
        throw new Error(`send expected 200; got ${r.status}: ${JSON.stringify(r.body)}`);
      return 'Alice → message sent';
    });
    await reporter.step(device, 'API: Lena replies (round-trip)', async () => {
      const r = await apiCall('POST', `/api/conversations/${convId}/messages`, {
        token: lenaToken,
        body: { text: 'hi Alice (reply)', type: 'TEXT' },
      });
      if (r.status !== 200)
        throw new Error(`reply expected 200; got ${r.status}: ${JSON.stringify(r.body)}`);
      return 'Lena → reply sent';
    });
    await reporter.step(device, 'DB: conversation holds both messages', async () => {
      const msgs = await ctx.db.collection(`conversations/${convId}/messages`).get();
      if (msgs.size < 2) throw new Error(`expected >=2 messages; got ${msgs.size}`);
      return `${msgs.size} messages in conversations/${convId}`;
    });
    await reporter.step(device, 'Cleanup: delete conversation + Alice unfollows Lena', async () => {
      const msgs = await ctx.db.collection(`conversations/${convId}/messages`).get();
      for (const d of msgs.docs) await d.ref.delete();
      await ctx.db.doc(`conversations/${convId}`).delete();
      const un = await apiCall('POST', `/api/users/${alice}/unfollow`, {
        token: aliceToken,
        body: { targetUserId: lena },
      });
      if (un.status !== 200) throw new Error(`unfollow cleanup failed: ${un.status}`);
      return 'conversation + messages deleted; unfollowed';
    });
  },
};

// j12 — admin daily routine (gate check). Greta (admin) reaches the moderation
// queues; a regular member is rejected (403). Verifies the requireAdmin
// boundary on the admin endpoints — read-only, no mutations.
const J12 = {
  id: 'J12',
  title: 'j12 — admin routine: admin reaches moderation queues; non-admin rejected',
  async run(device, reporter, ctx) {
    await signInAs(device, reporter, ctx, 'admin@shytalk.dev');
    if (!ctx.db) return;
    let gretaToken;
    let aliceToken;
    await reporter.step(device, 'Mint admin (Greta) + non-admin (Alice) tokens', async () => {
      gretaToken = await getIdToken('admin@shytalk.dev');
      aliceToken = await getIdToken('adult-power@shytalk.dev');
      return 'tokens minted';
    });
    await reporter.step(device, 'API: admin GETs the reports queue (200)', async () => {
      const r = await apiCall('GET', '/api/reports', { token: gretaToken });
      if (r.status !== 200)
        throw new Error(`expected 200; got ${r.status}: ${JSON.stringify(r.body)}`);
      return 'GET /api/reports → 200 (admin)';
    });
    await reporter.step(device, 'API: admin GETs the appeals queue (200)', async () => {
      const r = await apiCall('GET', '/api/appeals', { token: gretaToken });
      if (r.status !== 200)
        throw new Error(`expected 200; got ${r.status}: ${JSON.stringify(r.body)}`);
      return 'GET /api/appeals → 200 (admin)';
    });
    await reporter.step(
      device,
      'API: non-admin (Alice) is REJECTED from reports (403)',
      async () => {
        const r = await apiCall('GET', '/api/reports', { token: aliceToken });
        if (r.status !== 403)
          throw new Error(`expected 403 admin gate; got ${r.status}: ${JSON.stringify(r.body)}`);
        return 'Alice GET /api/reports → 403 (requireAdmin gate)';
      },
    );
  },
};

/**
 * j38 — asking for help when you have already asked once (SHY-0396).
 *
 * The behaviour under test is the difference between a WARNING and a WALL. The
 * app used to REFUSE a second support request: the server answered 409 and the
 * form disabled Send, saying "You already have a request open. We will reply to
 * that one." So somebody with a payment problem open, whose account was then
 * broken into, could not tell us -- the new problem reached nobody.
 *
 * Every assertion below is therefore about the second request GETTING THROUGH,
 * and about the person being told enough to choose well rather than being
 * stopped. A test that cannot tell a warning from a wall is the test that let
 * this ship.
 *
 * Scripted rather than driven by hand: a walk decided tap-by-tap costs 10-30s
 * per step in thinking time with the phone sitting idle, and is not repeatable.
 */
/**
 * Everything J38 raises starts with this, so the sweep below can tell its
 * own leftovers from a seeded fixture or a ticket a person filed.
 */
const JOURNEY_TICKET_PREFIX = 'J38';

/** How much of the run id ends up in every message this journey types. */
const RUN_TAG_CHARS = 12;

/**
 * A per-run marker, from the reporter's run id (SHY-0432).
 *
 * Letters and digits ONLY. This string is typed into the device, and
 * `input text` is a round trip through two shells; spaces and colons are
 * the only punctuation that path has ever been proven with, and the
 * sentence around the tag supplies those. A quoting failure here would
 * arrive looking like the product truncating somebody's message.
 *
 * Refuses an empty result rather than returning one. Without a tag every
 * message collapses back to the constant it used to be, the journey
 * silently loses its isolation, and nothing says so.
 */
function runTagFrom(runId) {
  const cleaned = String(runId ?? '').replace(/[^0-9a-zA-Z]/g, '');
  if (!cleaned) {
    throw new Error(`a per-run marker needs a run id; got ${JSON.stringify(runId)}`);
  }
  return cleaned.slice(-RUN_TAG_CHARS);
}

/**
 * The three strings J38 raises and then asserts on.
 *
 * They used to be constants, which is what let the final step pass on a
 * previous run's document: the query matched leftovers, `snap.empty`
 * could never fire, and `snap.docs[0]` returned whichever the index
 * happened to hand back.
 */
function j38Messages(runTag) {
  if (!/^[0-9a-zA-Z]+$/.test(String(runTag))) {
    throw new Error(
      `run tag must be alphanumeric to survive the shell; got ${JSON.stringify(runTag)}`,
    );
  }
  return {
    seed: `${JOURNEY_TICKET_PREFIX} seed ${runTag}: my coins never arrived`,
    typed: `${JOURNEY_TICKET_PREFIX} run ${runTag}: nobody can hear me in voice rooms since this morning`,
    followUp: `${JOURNEY_TICKET_PREFIX} run ${runTag}: it happened again just now`,
  };
}

/**
 * The display cap the support API applies to `mine/open`.
 *
 * Kept in step with the server by `device-journey-run-isolation.test.js`,
 * which reads the constant out of the route and fails if the two disagree —
 * a number duplicated with nothing watching it is a number that drifts.
 */
const MAX_OPEN_TICKETS_LISTED = 5;

/** The seeded persona with the isAdmin claim; the only one that may resolve. */
const ADMIN_PERSONA = 'admin@shytalk.dev';

/**
 * Which open tickets are this journey's own leftovers, safe to resolve.
 *
 * Scoped three ways, and every one of them matters:
 * - OWNER, because Android and iOS walk at the same time on different
 *   personas and must not resolve each other's tickets mid-run;
 * - PREFIX, because seeded fixtures and anything a person filed are not
 *   ours to close ("cleanup touches only tickets this journey created");
 * - the ticket this run just seeded, which the walk is about to need.
 *
 * `userId` arrives as a number from Firestore and as a string from the
 * API, so ownership is compared as text — a strict `===` across that
 * boundary sweeps nothing and says nothing.
 */
function staleJourneyTickets(tickets, { ownerId, keepTicketId }) {
  return (tickets ?? []).filter((t) => {
    if (!t || typeof t !== 'object') return false;
    const id = t.id ?? t.ticketId; // admin list returns `id`; mine/open maps it to `ticketId`
    if (!id || id === keepTicketId) return false;
    if (String(t.userId) !== String(ownerId)) return false;
    return typeof t.message === 'string' && t.message.startsWith(JOURNEY_TICKET_PREFIX);
  });
}

/**
 * Resolve the tickets earlier runs of this journey left open (SHY-0432).
 *
 * Through the ADMIN endpoint, never by writing to Firestore: a harness that
 * reaches around the API stops exercising the API, and `PATCH
 * /api/support-tickets/:id` is the same call a real admin makes. Reads stay
 * direct, because an assertion wants ground truth.
 *
 * Enumerated from the admin list rather than `mine/open` — the latter is
 * capped at [MAX_OPEN_TICKETS_LISTED], which is the very cap the residue was
 * pushing the journey into, so it cannot see far enough to clear it.
 *
 * A failure here throws. Cleanup that silently does nothing brings the
 * accumulation straight back, with a green report over it.
 */
async function resolveStaleJourneyTickets(ctx, { ownerId, keepTicketId }) {
  // Listed straight from Firestore, resolved through the API.
  //
  // That split is deliberate. The API is the authorization layer and every
  // MUTATION goes through it -- these tickets are closed by the same admin
  // PATCH a real admin uses. The LIST is a read, and this runner already
  // reads Firestore directly for every one of its assertions, because a test
  // wants ground truth rather than the view of the thing it is testing.
  //
  // It has to be read this way, not from `GET /api/support-tickets`. That
  // endpoint returns the 200 NEWEST open tickets across EVERYBODY and offers
  // no per-user filter. Measured against the real database: 320 open, 117 of
  // them belonging to one other account, so Alice's older leftovers sat
  // outside the window entirely. One pass resolved 1 of 8 and the next found
  // none -- because resolving one ticket advances a 200-wide window by one.
  // Looping cannot fix an endpoint that cannot express the question.
  //
  // `mine/open` cannot either: capped at five, no ordering, so Firestore
  // returns the same five ids for ever. Five hand-raised tickets at the front
  // would stall the sweep on them permanently.
  const snap = await ctx.db
    .collection('supportTickets')
    .where('userId', '==', ownerId)
    .where('status', '==', 'open')
    .get();

  const stale = staleJourneyTickets(
    snap.docs.map((d) => ({ ...d.data(), id: d.id })),
    { ownerId, keepTicketId },
  );

  const adminToken = await getIdToken(ADMIN_PERSONA);
  const resolved = [];
  for (const t of stale) {
    const id = t.id ?? t.ticketId;
    const r = await apiCall('PATCH', `/api/support-tickets/${id}`, {
      token: adminToken,
      body: { status: 'resolved' },
    });
    if (r.status !== 200) throw new Error(`could not resolve leftover ticket ${id}: ${r.status}`);
    resolved.push(id);
  }
  return resolved;
}

const J38 = {
  id: 'J38',
  title: 'j38 — a second support request is warned about, never refused (SHY-0396)',
  async run(device, reporter, ctx) {
    const pkg = ctx.pkg;
    let token;
    let openBefore = 0;
    let seededTicketId = null;
    let seededUserId = null;
    // Every string this walk types and then looks for carries it (SHY-0432).
    const runTag = runTagFrom(reporter.runId);
    const messages = j38Messages(runTag);

    await reporter.step(device, 'Alice already has a request open', async () => {
      token = await getIdToken(ctx.supportPersona);
      // Seeded through the API rather than assumed: the warning cannot be
      // asserted against a person who has nothing open, and leaving that to
      // whatever the device happened to do earlier makes the run flaky.
      const raised = await apiCall('POST', '/api/support-tickets', {
        token,
        body: { message: messages.seed, category: 'payment' },
      });
      if (raised.status !== 200) throw new Error(`seed failed: ${raised.status}`);
      seededTicketId = raised.body?.ticketId;
      // Which account the server bound it to. The device is checked against
      // this below -- a walk that asserts on one account's screen while seeding
      // another account's data proves nothing at all.
      const doc = await dbGet(ctx.db, `supportTickets/${seededTicketId}`);
      seededUserId = doc?.userId;

      // Clear what earlier runs left behind, now that the owner is known.
      //
      // This journey used to leave two open tickets per walk and never
      // collect them. `mine/open` is capped at MAX_OPEN_TICKETS_LISTED = 5,
      // so within a few runs the cap was reached and the screen under test
      // was being hidden by the journey's own residue -- the duplicate
      // screen in the 20:33 run showed five cards, three of them leftovers.
      //
      // Resolved through the ADMIN endpoint, not written to Firestore: a
      // test that reaches around the API stops testing the API. Reads stay
      // direct, because ground truth is what an assertion wants.
      const swept = await resolveStaleJourneyTickets(ctx, {
        ownerId: seededUserId,
        keepTicketId: seededTicketId,
      });

      const open = await apiCall('GET', '/api/support-tickets/mine/open', { token });
      const listed = open.body?.tickets ?? [];
      openBefore = listed.length;
      if (openBefore < 1) throw new Error('seeded a ticket but nothing is open');

      // The honest requirement, and not a count.
      //
      // A count assertion was the first attempt and it was wrong: this
      // persona carries tickets from HAND-DRIVEN testing that the journey is
      // explicitly not allowed to delete ("cleanup touches only tickets this
      // journey created"), so it failed on data it must tolerate --
      // "the journeys should be robust to a shared, accumulating database".
      //
      // What actually has to be true is that the ticket THIS run seeded is
      // among the ones the app will show. `mine/open` is capped at
      // MAX_OPEN_TICKETS_LISTED and applies no ordering, so with enough
      // foreign tickets the seeded one can be squeezed out -- and then every
      // later step is asserting against somebody else's request while looking
      // perfectly green.
      if (!listed.some((t) => t.ticketId === seededTicketId)) {
        const foreign = listed
          .map((t) => (t.summary ?? '').slice(0, 40))
          .filter(Boolean)
          .join(' | ');
        throw new Error(
          `the ticket this run seeded (${seededTicketId}) is not among the ` +
            `${openBefore} the app will show, so the duplicate screen would be about ` +
            `somebody else's request. ${swept.length} of this journey's own leftovers ` +
            `were resolved; what remains was raised by hand and is not ours to close: ` +
            `${foreign}`,
        );
      }

      return (
        `${openBefore} open before the walk, owned by ${seededUserId}, ` +
        `including this run's own ticket ${seededTicketId}` +
        (swept.length ? `; resolved ${swept.length} leftover(s) from earlier runs` : '') +
        `; run tag ${runTag}`
      );
    });

    // `null`: this persona has no seeded display name, so the overlay cannot
    // confirm WHO is signed in by name. The step below is a stronger check
    // anyway -- it compares the account on the device against the account the
    // server bound the seeded ticket to.
    await signInAs(device, reporter, ctx, ctx.supportPersona);
    if (!ctx.db) return;

    await reporter.step(device, 'The phone is signed in as the account we seeded', async () => {
      // Distinct from signInAs's check, which compares the device against the
      // PERSONA TABLE. This compares it against the account the SERVER bound
      // the seeded ticket to -- so a persona whose table entry drifted from
      // its provisioned data is caught here rather than asserted around.
      const onDevice = accountOnDevice(await dump(device));
      if (onDevice === null) throw new Error('the debug overlay is not showing an account id');
      if (onDevice !== seededUserId) {
        throw new Error(
          `the phone is signed in as ${onDevice} but the ticket was seeded for ` +
            `${seededUserId} -- every assertion after this would be about the wrong person`,
        );
      }
      return `device and seed agree: account ${onDevice}`;
    });

    // The route a person actually takes: Profile -> Settings -> Contact us.
    // The settings button lives on the PROFILE tab, not on Rooms, which is
    // where signing in lands.
    const openSupport = async () => {
      // `settle`, not a bare wait for a tab. This helper is also used after a
      // force-stop, and a cold start can land on the daily-reward calendar or a
      // permission dialog before Home -- overlays `settle` already knows how to
      // clear. Waiting for the tab alone times out staring at a modal, which
      // reads like the journey broke rather than like the app asked a question.
      // Settle, then check — and if the screen goes back to nothing, settle
      // again (SHY-0447).
      //
      // A cold start after a force-stop reaches Home and can then briefly lose
      // it: the dump goes back to `android:id/content` alone while the app is
      // still recomposing, or the daily-reward calendar arrives a beat after
      // Home did. `settle` handles both, but only if somebody asks it to a
      // second time. Waiting twenty seconds at a screen with nothing on it
      // reads like the journey broke, and it did not.
      for (let attempt = 1; ; attempt++) {
        await settle(device, 60000);
        try {
          await waitForId(device, 'main_profileTab', attempt === 1 ? 8000 : 20000);
          break;
        } catch (e) {
          if (attempt >= 2) throw e;
        }
      }
      await tapId(device, 'main_profileTab');
      await waitForId(device, 'main_settingsButton', 12000);
      await tapId(device, 'main_settingsButton');
      // "Contact us" lives inside About, not on the settings root.
      await waitForId(device, 'settings_aboutItem', 12000);
      await tapId(device, 'settings_aboutItem');
      await waitForId(device, 'settings_contactUsLink', 12000);
      await tapId(device, 'settings_contactUsLink');
      await waitForId(device, 'support_input', 12000);
    };

    await reporter.step(device, 'Open Settings, then Contact support', async () => {
      await openSupport();
      return 'support form is open';
    });

    await reporter.step(
      device,
      'She is told what is already open BEFORE she types anything',
      async () => {
        const nodes = await waitForId(device, 'support_openNotice', 12000);
        const notice = byId(nodes, 'support_openNotice');
        if (!notice) throw new Error('the open-requests notice is not on the form');
        // SHY-0396's UX clause: the warning has to arrive before somebody types
        // their whole problem out again, not after they press Send.
        const input = byId(nodes, 'support_input');
        if (input && notice.center.y > input.center.y) {
          throw new Error('the notice renders BELOW the message field, so it is read too late');
        }
        return 'open-requests notice shown above the message field';
      },
    );

    const typed = messages.typed;

    await reporter.step(device, 'Pressing Send ASKS instead of sending', async () => {
      await typeInto(device, 'support_input', typed);
      await tapIdScrolling(device, 'support_send');
      await waitForId(device, 'support_duplicate', 12000);
      return 'the choice screen replaced the form; nothing was sent yet';
    });

    await reporter.step(device, 'She is offered exactly three ways forward', async () => {
      const nodes = await dump(device);
      const addToOpen = byIdPrefix(nodes, 'support_addToOpen');
      if (!addToOpen) throw new Error('no open request is offered to add to');
      if (!byId(nodes, 'support_newProblem')) throw new Error('"It is a new problem" is missing');
      if (!byId(nodes, 'support_duplicateBack')) throw new Error('"Go back" is missing');
      return `three choices present (add-to: ${addToOpen.id})`;
    });

    await reporter.step(
      device,
      'She is told a duplicate goes to the back of the queue',
      async () => {
        const nodes = await dump(device);
        if (!byTextContains(nodes, 'back of the queue')) {
          throw new Error('the back-of-the-queue reminder is not on the choice screen');
        }
        return 'reminder shown';
      },
    );

    await reporter.step(device, 'Going back costs her nothing she typed', async () => {
      await tapId(device, 'support_duplicateBack');
      const nodes = await waitForId(device, 'support_input', 8000);
      const field = byId(nodes, 'support_input');
      // Compared on the FULL string. A `contains` check passes on a field that
      // kept only the first word, which is exactly what a bad `input text`
      // escaping bug looks like.
      if (field.text !== typed) {
        throw new Error(`the field says "${field.text}" but she typed "${typed}"`);
      }
      return 'every character survived';
    });

    await reporter.step(
      device,
      'Sending again ASKS again rather than slipping through',
      async () => {
        await tapIdScrolling(device, 'support_send');
        await waitForId(device, 'support_duplicate', 12000);
        return 'go back is not a way to skip the question';
      },
    );

    await reporter.step(device, 'A genuinely new problem gets through', async () => {
      await tapId(device, 'support_newProblem');
      await waitForId(device, 'support_back', 15000);

      // Asserted by finding the TICKET, not by watching a count.
      //
      // `mine/open` is capped at MAX_OPEN_TICKETS_LISTED for display, so once
      // somebody has that many open the length cannot grow -- and an assertion
      // on it reports "the second request was refused" for a request that was
      // raised perfectly. A display cap is not a fact about how many exist.
      const snap = await dbWaitQuery(
        () =>
          ctx.db
            .collection('supportTickets')
            .where('userId', '==', seededUserId)
            .where('message', '==', typed)
            .get(),
        { what: 'a ticket carrying the words she typed' },
      ).catch(() => null);
      if (!snap || snap.empty) {
        throw new Error('no ticket carries the words she typed; the request never arrived');
      }
      const raisedId = snap.docs[0].id;
      if (raisedId === seededTicketId) {
        throw new Error('her words landed on the ticket she already had, not a new one');
      }
      return `raised as its own ticket ${raisedId}, separate from ${seededTicketId}`;
    });

    await reporter.step(
      device,
      'The same problem is added to the request already open',
      async () => {
        // Back to a fresh form the way somebody would: leave, and come in again.
        await device.forceStop(pkg);
        await device.launch(pkg);
        await openSupport();

        const followUp = messages.followUp;
        await typeInto(device, 'support_input', followUp);
        await tapIdScrolling(device, 'support_send');
        const nodes = await waitForId(device, 'support_duplicate', 12000);
        const card = byIdPrefix(nodes, 'support_addToOpen');
        if (!card) throw new Error('no open request offered on the second visit');
        const ticketId = card.id.slice('support_addToOpen'.length);
        await tapResolved(device, card);
        await sleep(1500);

        // Asserted in the DATABASE, not on screen. The confirmation is one
        // sentence and could be shown while the words went nowhere -- which is
        // precisely the failure this journey exists to catch.
        const doc = await dbGet(ctx.db, `supportTickets/${ticketId}`);
        const added = (doc?.messages ?? []).map((m) => m.message);
        if (!added.includes(followUp)) {
          throw new Error(
            `ticket ${ticketId} carries ${JSON.stringify(added)}; her follow-up is not among them`,
          );
        }
        return `follow-up landed on ticket ${ticketId}`;
      },
    );
  },
};

/**
 * j39 — choosing "Safety & another user" teaches reporting before offering a
 * ticket (SHY-0437).
 *
 * The support queue is not a reporting system: a report raised there carries no
 * reportedUserId, is not triaged by urgency, and is answered by whoever picks
 * up support. Somebody in genuine distress picks the option that says "Safety"
 * and gets the least effective route we have.
 *
 * Walked rather than asserted because the whole ticket is about what somebody
 * SEES at that moment, and because two of its clauses — the escape hatch being
 * reachable, and the guide returning for somebody who has not read it — are
 * behaviour no unit test observes.
 */
const J39 = {
  id: 'J39',
  title: 'j39 — safety shows the report guide, and the way out of it (SHY-0437)',
  async run(device, reporter, ctx) {
    await signInAs(device, reporter, ctx, ctx.supportPersona);

    // The route a person actually takes: Profile -> Settings -> About ->
    // Contact us. Same path J38 walks; a shortcut here would prove the guide
    // renders somewhere nobody arrives from.
    await reporter.step(device, 'Open Settings, then Contact support', async () => {
      for (let attempt = 1; ; attempt++) {
        await settle(device, 60000);
        try {
          await waitForId(device, 'main_profileTab', attempt === 1 ? 8000 : 20000);
          break;
        } catch (e) {
          if (attempt >= 2) throw e;
        }
      }
      await tapId(device, 'main_profileTab');
      await waitForId(device, 'main_settingsButton', 12000);
      await tapId(device, 'main_settingsButton');
      await waitForId(device, 'settings_aboutItem', 12000);
      await tapId(device, 'settings_aboutItem');
      await waitForId(device, 'settings_contactUsLink', 12000);
      await tapId(device, 'settings_contactUsLink');
      await waitForId(device, 'support_input', 12000);
      return 'support form is open, showing the message field';
    });

    await reporter.step(device, 'Choosing Safety shows the guide instead of the form', async () => {
      await tapIdScrolling(device, 'support_categorysafety');
      const nodes = await waitForId(device, 'support_reportGuide', 12000);
      // The form is REPLACED, not covered. A message field still on screen
      // means somebody can type their report into the wrong place anyway.
      if (byId(nodes, 'support_input')) {
        throw new Error('the message field is still on screen, so the form was not replaced');
      }
      if (byId(nodes, 'support_send')) {
        throw new Error('Send is still on screen, and there is nothing on this screen to send');
      }
      return 'the guide replaced the form';
    });

    await reporter.step(device, 'The way to a ticket is visible from the start', async () => {
      // "The route to a ticket is visible from the start, not hidden behind
      // finishing the guide — somebody in distress must never feel trapped."
      const nodes = await dump(device);
      if (!byId(nodes, 'support_contactAnyway')) {
        throw new Error('there is no way to reach support from the guide');
      }
      return 'the escape hatch is on screen without scrolling to the end';
    });

    await reporter.step(device, 'Choosing to contact support anyway reaches the form', async () => {
      await tapIdScrolling(device, 'support_contactAnyway');
      const nodes = await waitForId(device, 'support_input', 12000);
      if (byId(nodes, 'support_reportGuide')) {
        throw new Error('the guide is still on screen after choosing to contact support');
      }
      return 'the message field is back';
    });

    await reporter.step(device, 'Another category goes straight to the form', async () => {
      await tapIdScrolling(device, 'support_categorybug');
      const nodes = await waitForId(device, 'support_input', 12000);
      if (byId(nodes, 'support_reportGuide')) {
        throw new Error('the guide is showing for a category that is not about another person');
      }
      return 'no guide for "Something is broken"';
    });

    await reporter.step(device, 'Coming back to Safety shows the guide again', async () => {
      // Somebody who has not read it has not read it. Passing through Safety on
      // the way to another option is not reading a guide, and a remembered
      // "dismissed" would hide it from them for the rest of the session.
      await tapIdScrolling(device, 'support_categorysafety');
      await waitForId(device, 'support_reportGuide', 12000);
      return 'the guide is shown again rather than remembered as dismissed';
    });
  },
};

// j05 — monetization (IAP). In non-prod the /economy/purchase endpoint SKIPS
// real store verification (only NODE_ENV=production hits Google/Apple), so a
// test purchaseToken credits coins — the real IAP code path, no money. Alice
// buys a coin pack and her shyCoins go up. A unique token per run avoids the
// 409 replay guard (receiptId = sha256(purchaseToken)).
const J05 = {
  id: 'J05',
  title: 'j05 — monetization: IAP coin purchase (non-prod test path) credits coins',
  async run(device, reporter, ctx) {
    await signInAs(device, reporter, ctx, 'adult-power@shytalk.dev');
    if (!ctx.db) return;
    const alice = 50000010;
    let token;
    let before = 0;
    await reporter.step(device, 'Mint Alice token + read starting coins', async () => {
      token = await getIdToken('adult-power@shytalk.dev');
      const d = await dbGet(ctx.db, `users/${alice}`);
      before = typeof d?.shyCoins === 'number' ? d.shyCoins : 0;
      return `starting shyCoins=${before}`;
    });
    await reporter.step(
      device,
      'API: IAP purchase (non-prod skips store verification)',
      async () => {
        const purchaseToken = `jr-iap-${Date.now()}`;
        const r = await apiCall('POST', '/api/economy/purchase', {
          token,
          body: { productId: 'local_100_coins', purchaseToken },
        });
        if (r.status !== 200) {
          throw new Error(`purchase expected 200; got ${r.status}: ${JSON.stringify(r.body)}`);
        }
        return `POST /economy/purchase {local_100_coins} → 200 ${JSON.stringify(r.body).slice(0, 100)}`;
      },
    );
    await reporter.step(device, 'DB: Alice shyCoins increased', async () => {
      const got = await dbWaitField(
        ctx.db,
        `users/${alice}`,
        'shyCoins',
        (v) => typeof v === 'number' && v > before,
        6000,
      );
      return `shyCoins ${before} → ${got}`;
    });
  },
};

// j06 — IAP failure handling. Same /economy/purchase endpoint: an unknown
// product is rejected (404) and a replayed purchaseToken is rejected (409,
// the sha256-receipt idempotency guard). No real money, no second device.
const J06 = {
  id: 'J06',
  title: 'j06 — IAP failure handling: unknown product (404) + receipt replay (409)',
  async run(device, reporter, ctx) {
    await signInAs(device, reporter, ctx, 'adult-power@shytalk.dev');
    if (!ctx.db) return;
    let token;
    await reporter.step(device, 'Mint Alice token', async () => {
      token = await getIdToken('adult-power@shytalk.dev');
      return 'token minted';
    });
    await reporter.step(device, 'API: unknown coin package → 404', async () => {
      const r = await apiCall('POST', '/api/economy/purchase', {
        token,
        body: { productId: 'definitely_not_a_real_pack', purchaseToken: `jr-bad-${Date.now()}` },
      });
      if (r.status !== 404)
        throw new Error(`expected 404; got ${r.status}: ${JSON.stringify(r.body)}`);
      return `unknown product → 404 "${r.body?.error ?? r.status}"`;
    });
    await reporter.step(device, 'API: receipt replay rejected (409)', async () => {
      const dupToken = `jr-replay-${Date.now()}`;
      const first = await apiCall('POST', '/api/economy/purchase', {
        token,
        body: { productId: 'local_100_coins', purchaseToken: dupToken },
      });
      if (first.status !== 200) throw new Error(`first purchase expected 200; got ${first.status}`);
      const replay = await apiCall('POST', '/api/economy/purchase', {
        token,
        body: { productId: 'local_100_coins', purchaseToken: dupToken },
      });
      if (replay.status !== 409) {
        throw new Error(
          `replay expected 409; got ${replay.status}: ${JSON.stringify(replay.body)}`,
        );
      }
      return `same token replayed → 409 (sha256-receipt idempotency guard)`;
    });
  },
};

// j09 — the room lifecycle, on the phone: create → mic on → mic off → close.
//
// Written for SHY-0456 because this runner had NO room journey at all, so a
// green fourteen-of-fourteen said nothing about the product's core feature.
//
// Deliberately UI-driven for create / mic / close — the point is to prove the
// app does these things, not that the API can. Firestore is asserted after
// each one so a screen that merely LOOKS right cannot pass.
//
// Field names come from the implementation, not from
// journey-tests/j09-voice-room-host.feature, which is stale on three counts:
// it says `title` (the field is `name`), `hostId` (it is `ownerId` + a
// `hostIds` array), `seats[i].muted` (seats is a map keyed by a STRING index,
// and the field is `isMuted`), and `state: OPEN` (RoomState is ACTIVE |
// OWNER_AWAY | CLOSED — there is no OPEN).
const J09 = {
  id: 'J09',
  title: 'j09 — room lifecycle: create → mic on → mic off → close (Theo)',
  async run(device, reporter, ctx) {
    await signInAs(device, reporter, ctx, 'host@shytalk.dev');
    if (!ctx.db) return;

    const theo = 50000060;
    // Unique per run so a re-run never matches a room a previous run left.
    const roomName = `JR-CORE-${Date.now()}`;
    let roomId = null;
    let seatIndex = null;

    /** Which seat holds this user — robust to the owner not landing in seat 0. */
    const seatOf = (room, uid) => {
      for (const [idx, s] of Object.entries(room.seats || {})) {
        if (s && String(s.userId) === String(uid)) return idx;
      }
      return null;
    };

    // Idempotence. A run that fails mid-journey never reaches its cleanup, so
    // Theo is left owning an ACTIVE room — and the app then offers "replace
    // room?" instead of the create dialog. The next run would create nothing
    // and fail on a DIFFERENT step, hiding the original defect. Clear his
    // rooms on the way IN, not only on the way out.
    await reporter.step(device, 'Setup: clear any room Theo still owns', async () => {
      // Targeted queries, not a whole-collection read: an unbounded get on
      // `rooms` returned gRPC "1 CANCELLED: call already cancelled" against the
      // emulator. ownerId has been seen as both a number and a string, so ask
      // for both rather than guessing which this build wrote.
      // The first Firestore query of this journey intermittently comes back
      // "1 CANCELLED: call already cancelled" against the emulator — a gRPC
      // channel fault, not a data one: the identical query succeeds on the
      // next attempt. Retried rather than left to fail the whole core set on
      // a transport hiccup. A persistent failure still surfaces, because the
      // last error is rethrown.
      const query = async (value) =>
        ctx.db.collection('rooms').where('ownerId', '==', value).limit(20).get();

      // Query AND delete both live inside the retry. Scoping it to the query
      // alone hid the real source: the runs that failed were exactly the ones
      // with a room to remove, because the cancel comes from the delete, and
      // the runs that "passed" were the ones with nothing to delete at all.
      let deleted = 0;
      let lastErr = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const refs = new Map();
          for (const value of [theo, String(theo)]) {
            const snap = await query(value);
            for (const d of snap.docs) refs.set(d.id, d.ref);
          }
          for (const ref of refs.values()) await ref.delete();
          deleted = refs.size;
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          await sleep(500 * attempt);
        }
      }
      if (lastErr) throw lastErr;

      return deleted ? `deleted ${deleted} leftover room(s)` : 'none to clear';
    });

    await reporter.step(device, 'UI: open the rooms tab', async () => {
      await tapId(device, 'main_roomsTab');
      await waitForId(device, 'main_createRoomFab', 8000);
      return 'rooms tab shows the create-room control';
    });

    await reporter.step(device, `UI: create a room named ${roomName}`, async () => {
      await tapId(device, 'main_createRoomFab');
      await waitForId(device, 'createRoom_nameField', 8000);
      // The dialog pre-fills the last room name, and Android's input text
      // appends — so this MUST clear first or the room is created with both.
      await typeInto(device, 'createRoom_nameField', roomName, { clearFirst: true });
      await tapId(device, 'createRoom_confirmButton');
      return 'create-room dialog confirmed';
    });

    await reporter.step(device, 'DB: the room exists, ACTIVE, owned by Theo', async () => {
      const snap = await dbWaitQuery(
        () => ctx.db.collection('rooms').where('name', '==', roomName).limit(1).get(),
        { timeoutMs: 10000, what: `rooms where name == ${roomName}` },
      );
      const doc = snap.docs[0];
      roomId = doc.id;
      const room = doc.data();
      // RoomState is ACTIVE | OWNER_AWAY | CLOSED. There is no OPEN — that is
      // the fourth thing j09-voice-room-host.feature gets wrong about the model.
      if (room.state !== 'ACTIVE') throw new Error(`expected state ACTIVE; got ${room.state}`);
      if (String(room.ownerId) !== String(theo)) {
        throw new Error(`expected ownerId ${theo}; got ${room.ownerId}`);
      }
      seatIndex = seatOf(room, theo);
      if (seatIndex === null) {
        throw new Error(
          `Theo (${theo}) holds no seat in the room he created. seats=${JSON.stringify(room.seats)}`,
        );
      }
      return `rooms/${roomId} OPEN, owner ${theo}, seat ${seatIndex}`;
    });

    await reporter.step(device, 'UI: the room screen shows the seat grid', async () => {
      await waitForId(device, 'room_seatGrid', 10000);
      return 'seat grid rendered';
    });

    // The pair the operator named: a mic that turns on and off, proven in the
    // database rather than by the icon alone. A room can render a mic-on icon
    // while the seat is still muted for everyone else.
    const setMic = async (wantMuted) => {
      const label = wantMuted ? 'mute' : 'unmute';
      // Re-read the tree and retry rather than trusting one look. Immediately
      // after the first toggle the button is still IN the dump but briefly has
      // no resolvable centre, so the tap reports "not found" while the tag is
      // right there in the diagnostic. Findable is not the same as reachable.
      let tapped = false;
      let lastErr = null;
      for (let attempt = 1; attempt <= 4 && !tapped; attempt += 1) {
        try {
          await waitForId(device, 'room_micToggleButton', 6000);
          await tapId(device, 'room_micToggleButton');
          tapped = true;
        } catch (err) {
          lastErr = err;
          await sleep(400 * attempt);
        }
      }
      if (!tapped) throw lastErr;
      await dbWaitField(
        ctx.db,
        `rooms/${roomId}`,
        'seats',
        (seats) => Boolean(seats?.[seatIndex]) && seats[seatIndex].isMuted === wantMuted,
        8000,
      );
      return `seats.${seatIndex}.isMuted === ${wantMuted} after ${label}`;
    };

    await reporter.step(device, 'UI+DB: Theo opens his mic', () => setMic(false));
    await reporter.step(device, 'UI+DB: Theo closes his mic again', () => setMic(true));

    await reporter.step(device, 'UI: close the room from the settings sheet', async () => {
      // room_endRoomButton is owner-only and lives inside RoomSettingsSheet,
      // not on the room screen — it is unreachable until the sheet is open.
      await tapId(device, 'room_settingsButton');
      await waitForId(device, 'room_endRoomButton', 8000);
      await tapId(device, 'room_endRoomButton');
      // No confirmation dialog: RoomSettingsSheet wires the button straight to
      // onCloseRoom. The next step is the assertion that it took effect.
      return 'close-room tapped';
    });

    await reporter.step(device, 'DB: the room is CLOSED', async () => {
      await dbWaitField(ctx.db, `rooms/${roomId}`, 'state', (v) => v === 'CLOSED', 10000);
      return `rooms/${roomId} state === CLOSED`;
    });

    await reporter.step(device, 'Cleanup: remove the journey room', async () => {
      await ctx.db.doc(`rooms/${roomId}`).delete();
      return `rooms/${roomId} deleted`;
    });
  },
};

// ─── The core set (SHY-0456) ────────────────────────────────────────────────
//
// A fixed, small set of journeys that runs EVERY session, before anything the
// ticket asked for. It exists because a green report only proves the paths it
// walked: this runner's fourteen journeys never created a room or opened a
// microphone, and "14/14 on both devices" was offered as sign-off evidence for
// a platform whose core feature is voice rooms.
//
// The point is that it runs when the ticket has nothing to do with rooms. That
// is precisely when a break goes unnoticed.
//
// Sign-in (J-SMOKE), the room lifecycle including the mic (J09), social
// (J07), and the cross-cohort wall (J02, J08) — age segregation being the one
// defect class here with real safeguarding exposure. Adding to this list is a
// story of its own; it is pinned by tests/scripts/core-journey-set.test.js.
const CORE_JOURNEY_IDS = Object.freeze(['J-SMOKE', 'J09', 'J07', 'J02', 'J08']);

/** True when a journey id belongs to the core set — used to halt a run. */
function isCoreJourney(id) {
  return CORE_JOURNEY_IDS.includes(id);
}

/**
 * Resolve which journeys run, in order, with the core set ALWAYS first.
 *
 * A narrower `--journeys` selection cannot opt out of the core set — that is
 * the whole guard. Throws rather than returning a short list, because a core
 * set that silently selects nothing is worse than no core set at all: it
 * reports green.
 */
function selectJourneys(all, selectedIds) {
  const index = new Map((all ?? []).map((j) => [j.id, j]));

  const missingCore = CORE_JOURNEY_IDS.filter((id) => !index.has(id));
  if (missingCore.length) {
    throw new Error(
      `core journey missing from the corpus: ${missingCore.join(', ')}. ` +
        'The core set must run every session, so a missing one is a blocker, ' +
        'not a journey to skip. Either the journey was renamed or deleted — ' +
        'fix CORE_JOURNEY_IDS and say so in a story (SHY-0456).',
    );
  }

  const core = CORE_JOURNEY_IDS.map((id) => index.get(id));

  if (!selectedIds) {
    return [...core, ...all.filter((j) => !isCoreJourney(j.id))];
  }

  const unknown = selectedIds.filter((id) => !index.has(id));
  if (unknown.length) {
    throw new Error(
      `unknown journey id(s): ${unknown.join(', ')}. ` +
        `Known ids: ${[...index.keys()].join(', ')}`,
    );
  }

  const rest = selectedIds.filter((id) => !isCoreJourney(id)).map((id) => index.get(id));
  return [...core, ...rest];
}

function buildJourneys(ctx) {
  const smoke = {
    id: 'J-SMOKE',
    title: 'Clean install launches and reaches SignIn',
    async run(device, reporter) {
      if (ctx.reset) {
        // Named for what it ACTUALLY does on this platform. A step reading
        // "Clean reinstall ✓" on a phone that was not reinstalled is a report
        // that lies, and this one used to fail outright with
        // "device.uninstall is not a function" (SHY-0446).
        const isIos = device.kind === 'ios';
        const label = isIos
          ? `Skip reinstall (${ctx.pkg}) — managed by ios-local-install.sh`
          : `Clean reinstall (${ctx.pkg})`;
        await reporter.step(device, label, async () => {
          if (isIos) {
            // Not performed, and the report says so. The iOS app is built
            // with THIS Mac's LAN address baked in, because an iPhone has no
            // `adb reverse`; reinstalling from here would leave the phone
            // talking to a host it cannot reach. The next step launches the
            // app, so a missing install still fails the journey — loudly, and
            // one step later.
            return (
              'reinstall NOT performed on iOS: the app is installed and pointed at this ' +
              "Mac's LAN address by scripts/dev/ios-local-install.sh. The launch step below " +
              'is what proves it is there.'
            );
          }
          // Awaited: the iOS backend's versions are async (they refuse with a
          // reason), and an unawaited rejection is an unhandled one. Android's
          // are synchronous, so awaiting costs nothing there. Pinned by
          // "device methods are awaited everywhere".
          await device.uninstall(ctx.pkg);
          const out = await device.install(ctx.apkAbs);
          return out.trim().split('\n').pop();
        });
      }
      await reporter.step(device, `Launch app`, async () => {
        await device.forceStop(ctx.pkg);
        await device.launch(ctx.pkg);
        await sleep(2500);
        return 'launcher intent sent';
      });
      await reporter.step(device, `Reaches SignIn (backend reachable)`, async () => {
        // `ensureAtSignIn`, not a bare wait for SignIn.
        //
        // Android reinstalls the app in the step above, so it always starts
        // signed out. iOS does not -- the install is owned by
        // scripts/dev/ios-local-install.sh -- so the phone arrives here still
        // signed in from whatever ran last, sits on Home, and this step spent
        // its full 75 seconds waiting for a screen it had already gone past.
        // 82 wasted seconds and a red journey, on a build that was working.
        //
        // `ensureAtSignIn` signs out when it finds Home, which is what
        // "reaches SignIn" was always meant to assert.
        await ensureAtSignIn(device, ctx.pkg);
        const nodes = await dump(device);
        if (byId(nodes, 'signIn_retryConnection'))
          throw new Error('SignIn shows "retry connection" — backend NOT reachable from device');
        return 'persona picker button present; no connection-retry banner';
      });
    },
  };

  const all = [
    smoke,
    personaJourney(
      'J-ALICE',
      'Adult persona (P-02 Alice) signs in',
      'adult-power@shytalk.dev',
      '50000010',
      'adult',
    ),
    personaJourney(
      'J-MARCUS',
      'Minor persona (P-04 Marcus) signs in',
      'minor-power@shytalk.dev',
      '60000010',
      'minor',
    ),
    personaJourney(
      'J-ADMIN',
      'Admin persona (P-12 Greta) signs in',
      'admin@shytalk.dev',
      '90000001',
      'adult',
    ),
    J02,
    J08,
    J04,
    J11,
    J07,
    J09,
    J12,
    J05,
    J06,
    J38,
    J39,
  ];
  return all;
}

// --------------------------------------------------------------------------
// APK build (if missing or --rebuild)
// --------------------------------------------------------------------------
function ensureApk(cfg, opts, runDir) {
  const apkAbs = path.join(REPO_ROOT, cfg.apk);
  if (!opts.rebuild && fs.existsSync(apkAbs)) {
    console.log(`APK present: ${cfg.apk}`);
    return apkAbs;
  }
  const cmd = `./gradlew ${cfg.gradleTask} ${cfg.gradleArgs.join(' ')}`.trim();
  console.log(`Building APK (this can take a few minutes): ${cmd}`);
  const logPath = path.join(runDir, 'gradle-build.log');
  try {
    const out = sh(`cd "${REPO_ROOT}" && ${cmd}`, {
      maxBuffer: 64 * 1024 * 1024,
      timeout: 20 * 60 * 1000,
    });
    fs.writeFileSync(logPath, out);
  } catch (e) {
    fs.writeFileSync(logPath, `${e.stdout || ''}\n${e.stderr || ''}`);
    throw new Error(`APK build failed — see ${logPath}`, { cause: e });
  }
  if (!fs.existsSync(apkAbs)) throw new Error(`APK still missing after build: ${cfg.apk}`);
  console.log(`APK built: ${cfg.apk}`);
  return apkAbs;
}

// --------------------------------------------------------------------------
// main
// --------------------------------------------------------------------------
const HELP = `ShyTalk on-device journey runner
Usage: node express-api/scripts/device-journey-runner.js [options]
  --target local|dev   environment (default local)
  --platform android|ios  which device to drive (default android)
  --serial <serial>    adb serial (default auto-select)
  --journeys <ids>     comma list e.g. J-SMOKE,J-ALICE (default all).
                       The core set always runs first and cannot be skipped,
                       whatever you select here.
  --rebuild            rebuild the APK first
  --no-reset           skip clean reinstall in J-SMOKE
  --no-record          skip the screen recording (default: record)
  --debug              dump the on-screen testTags after EVERY step, not
                       just failures (costs one screen read per step)
  --out <dir>          results dir (default <repo>/journey-results)
  --list               list journeys and exit
  --help               this help`;

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return 0;
  }
  const cfg = TARGETS[opts.target];

  if (opts.list) {
    for (const j of buildJourneys({ ...cfg, reset: true })) console.log(`${j.id}\t${j.title}`);
    return 0;
  }

  // ONE journey definition, TWO device backends. A journey written once
  // asserts the same things on both phones, so a platform difference surfaces
  // as a failing step rather than as a walk nobody ran -- which is how
  // SHY-0419's keyboard-occluded Send button survived two green Android walks.
  let device;
  let serial;
  let deviceModel = '?';
  if (opts.platform === 'ios') {
    const udid = selectCoreDeviceUuid(opts.serial);
    if (!udid) {
      throw new Error(
        'No connected iPhone found (xcrun devicectl list devices). A SIMULATOR is not a ' +
          'substitute -- SHY-0419 was invisible to everything except the real device.',
      );
    }
    serial = udid;
    deviceModel = 'iPhone';
    // Through the factory: it resolves BOTH iPhone identifiers (CoreDevice
    // uuid for devicectl, hardware udid for Appium). Constructing directly
    // here is what let one value be spent on both.
    device = createIosJourneyDevice({
      udid,
      bundleId: cfg.iosBundleId || 'com.shyden.shytalk',
    });
    await device.measure();
  } else {
    serial = selectSerial(opts.serial);
    if (!serial) throw new Error('No adb device found. Connect a device (adb devices) and retry.');
    device = new Device(serial);
    try {
      deviceModel = device.shell('getprop ro.product.model').trim();
    } catch (_e) {
      /* ignore */
    }
    // Once, at startup. Standing the server up costs ~5s and saves ~2.3s on
    // every read after it — a J38 walk makes ~78 (SHY-0447).
    if (await device.attachSourceSession()) {
      console.log('Screen reads: UiAutomator2 (warm server, ~65ms per read)');
    }
  }

  const reporter = new Reporter(opts.out, {
    target: opts.target,
    serial,
    device: deviceModel,
    debug: opts.debug,
  });
  console.log(`Target=${opts.target} pkg=${cfg.pkg} serial=${serial} (${deviceModel})`);
  console.log(`Results -> ${opts.out}`);

  // Both are adb-only. An iPhone has no `adb reverse` equivalent, so the iOS
  // build is pointed at this Mac's LAN address at BUILD time by
  // scripts/dev/ios-local-install.sh -- which is also why the app must not be
  // reinstalled from here.
  const apkAbs = opts.platform === 'ios' ? null : ensureApk(cfg, opts, reporter.runDir);
  if (opts.platform !== 'ios') {
    for (const port of cfg.reversePorts) {
      try {
        device.reverse(port);
      } catch (e) {
        console.log(`  (warn) adb reverse tcp:${port} failed: ${e.message.split('\n')[0]}`);
      }
    }
    if (cfg.reversePorts.length)
      console.log(`adb reverse set for ports: ${cfg.reversePorts.join(', ')}`);
  }

  const db = initDb(opts.target);
  if (db) console.log('Firestore assertions: ON (local emulator)');
  const ctx = {
    ...cfg,
    apkAbs,
    reset: opts.reset,
    db,
    supportPersona: SUPPORT_PERSONA_BY_PLATFORM[opts.platform],
  };
  // Checked ONCE, before the first tap. Losing the seed mid-session used to
  // surface as twelve separate "stuck on RequiredDOB" failures after minutes
  // of walking, each one guessing at the cause (SHY-0449).
  if (db) {
    const emails = [...new Set(Object.values(SUPPORT_PERSONA_BY_PLATFORM))].concat([
      'adult-power@shytalk.dev',
      'minor-power@shytalk.dev',
      'admin@shytalk.dev',
    ]);
    const docs = await Promise.all(
      [...new Set(emails)].map((e) => dbGet(db, `users/${personaUniqueId(e)}`)),
    );
    const seeded = personasLookSeeded(docs);
    if (!seeded.ok) {
      throw new Error(
        `the seeded personas are missing their date of birth (${seeded.missing.join(', ') || 'no user documents at all'}), ` +
          'so every sign-in will stop at the "we need your date of birth" screen. ' +
          'Re-seed with: cd express-api && node --env-file=.env.local scripts/seed-personas-local.js',
      );
    }
  }

  // The core set is prepended here, not filtered in — a narrow --journeys run
  // still proves the core still works (SHY-0456).
  const journeys = selectJourneys(buildJourneys(ctx), opts.journeys ?? null);
  if (journeys.length === 0) throw new Error('No journeys selected.');

  // Video, not just stills. A PNG per step cannot show a TRANSITION, and this
  // project's device defects live in transitions -- SHY-0419's Send button was
  // drawn UNDER the keyboard for the frames between the IME opening and the
  // layout settling, and passed every assertion. The operator asked for
  // recordings on 2026-08-22 for that reason.
  let recorder = null;
  if (opts.record) {
    recorder = createRecorder({
      platform: opts.platform,
      serial,
      outDir: reporter.runDir,
      device,
    });
    try {
      await recorder.start();
      console.log(`Recording -> ${recorder.file}`);
    } catch (e) {
      // A recorder that cannot start must SAY SO and stop the run. Carrying on
      // produces a green report with no video, which is the exact hole being
      // closed -- and the operator would find out only after the walk.
      throw new Error(`Screen recording failed to start: ${e.message}`, { cause: e });
    }
  }

  try {
    for (const j of journeys) {
      reporter.startJourney(j.id, j.title);
      try {
        await j.run(device, reporter, ctx);
        reporter.endJourney('pass');
      } catch (e) {
        reporter.endJourney('fail', e.message);
      }
    }
  } finally {
    // `finally`, so a walk that throws still yields its video -- a FAILED run
    // is when the footage is worth the most.
    if (recorder) {
      try {
        const file = await recorder.stop();
        if (file) {
          reporter.meta.video = path.relative(reporter.outDir, file);
          console.log(`Recording saved -> ${file}`);
        }
      } catch (e) {
        console.log(`  (warn) screen recording could not be saved: ${e.message}`);
      }
    }

    // Hand the device session back.
    //
    // Nothing ever did. `IosDevice.quit()` existed and was called from nowhere,
    // so every run abandoned its Appium session to die of `newCommandTimeout`
    // five minutes later — and two runs inside that window collide, which is
    // how a WebDriverAgent "failed to initialize" took out a run that had
    // nothing wrong with it.
    //
    // Best-effort and last: a teardown failure must not change the verdict of a
    // walk that has already finished.
    if (device?.sourceSession) {
      // Ended deliberately rather than left to time out: a superseded session
      // holds the device's instrumentation, and the next run then collides
      // with it — the same leak the iOS side had.
      await device.sourceSession.close().catch(() => {});
    }
    if (typeof device.quit === 'function') {
      try {
        await device.quit();
      } catch (e) {
        console.log(`  (warn) could not close the device session: ${e.message}`);
      }
    }
  }

  const ok = reporter.finish();
  return ok ? 0 : 1;
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(`\nFATAL: ${e.message}`);
      process.exit(2);
    });
}

// Exported for unit tests (pure logic only; device/DB/API I/O is covered by
// the on-device integration runs). Requiring this file does NOT run main().
//
// `getIdToken` is the one exception, and deliberately so. It mints persona
// tokens against the Auth emulator, and a second consumer exists:
// scripts/dev/reset-local-journey-debris.js, which clears the environment
// state that breaks these very journeys. A second implementation of token
// minting would drift from this one, and the drift would show up as a
// housekeeping script that authenticates differently from the runs it exists
// to unblock.
module.exports = {
  // The Android backend, exported so the two journey backends can be compared
  // against each other without a phone (SHY-0446).
  AndroidJourneyDevice: Device,
  // Exported so J-SMOKE's platform branch can be exercised without a phone.
  buildJourneys,
  // The core set and the selection it drives (SHY-0456), exported so the
  // guard can be asserted without a device.
  CORE_JOURNEY_IDS,
  isCoreJourney,
  selectJourneys,
  parseArgs,
  capturesScreenFor,
  occluderOf,
  looksLikeSystemOverlay,
  assertReachable,
  tapResolved,
  tapId,
  tapLowestText,
  lowestWithText,
  advanceUntil,
  SUPPORT_PERSONA_BY_PLATFORM,
  parseNodes,
  byId,
  byText,
  byTextContains,
  summarizeScreen,
  arrayContains,
  openPersonaPicker,
  dbWaitQuery,
  personasLookSeeded,
  dismissOverlay,
  pollGap,
  POLL_FLOOR_MS,
  IOS_POLL_GAP_MS,
  dump,
  dumpCost,
  TREE_FRESH_MS,
  runTagFrom,
  j38Messages,
  staleJourneyTickets,
  personaUniqueId,
  personaRowTag,
  pickerIsOpen,
  centreIsInside,
  accountOnDevice,
  JOURNEY_TICKET_PREFIX,
  MAX_OPEN_TICKETS_LISTED,
  getIdToken,
};
