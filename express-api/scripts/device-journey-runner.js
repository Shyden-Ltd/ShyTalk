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
const SUPPORT_PERSONA_BY_PLATFORM = {
  android: 'adult-power@shytalk.dev',
  ios: 'host@shytalk.dev',
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
  async dumpXml() {
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

async function dump(device) {
  return parseNodes(await device.dumpXml());
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
async function tapResolved(device, node, { relocate, label } = {}) {
  // An identifier is unambiguous, so the element route is safe: the backend
  // resolves and clicks in one operation with no window at all.
  if (node.id && typeof device.tapElement === 'function') {
    await device.tapElement(node.id);
    return;
  }

  const fresh = await dump(device);
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

  // Label-based element click ONLY when the label is unique on screen. Appium's
  // `/element` returns the first match, so using it on an ambiguous label would
  // reintroduce exactly the bug above by another route.
  const labelText = again.text || again.desc;
  if (
    !again.id &&
    labelText &&
    typeof device.tapElementByLabel === 'function' &&
    fresh.filter((n) => n.text === labelText || n.desc === labelText).length === 1
  ) {
    await device.tapElementByLabel(labelText);
    return;
  }
  if (again.id && typeof device.tapElement === 'function') {
    await device.tapElement(again.id);
    return;
  }

  // No identifier and an ambiguous label: a coordinate from the dump taken on
  // the line above is the tightest window available, and the caller's own rule
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
  if (typeof device.tapElement === 'function') {
    await device.tapElement(id);
    return;
  }
  const nodes = await dump(device);
  const n = byId(nodes, id);
  if (!n) throw new Error(`tap target #${id} not found on screen`);
  await tapResolved(device, n, `#${id}`);
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
  const target = lowestWithText(await dump(device), text);
  if (!target) throw new Error(`no "${text}" node to tap`);
  // The rule travels with the node. Without it the re-resolve takes the FIRST
  // match, which in a confirmation dialog is the title rather than the button.
  await tapResolved(device, target, {
    relocate: (fresh) => lowestWithText(fresh, text),
    label: `lowest "${text}"`,
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
async function typeInto(device, id, text) {
  if (device.kind === 'ios') {
    // Addressed by identifier and set directly. Typing key-by-key through the
    // on-screen keyboard is slower and can drop characters when the field
    // scrolls under it -- which looks like the product losing input.
    await device.typeText(id, text);
    await sleep(400);
    return;
  }
  await tapId(device, id);
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
    const nodes = await dump(device);
    if (byId(nodes, id)) return nodes;
    last = summarizeScreen(nodes).testTags;
    await sleep(800);
  }
  throw new Error(
    `timed out (${timeoutMs}ms) waiting for #${id}; screen showed: ${last.join(', ') || '(none)'}`,
  );
}

async function waitForText(device, sub, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  while (Date.now() < deadline) {
    const nodes = await dump(device);
    if (byTextContains(nodes, sub)) return nodes;
    last = summarizeScreen(nodes).testTags;
    await sleep(700);
  }
  throw new Error(
    `timed out (${timeoutMs}ms) waiting for text "${sub}"; screen showed: ${last.join(', ') || '(none)'}`,
  );
}

// Persona picker rows carry NO testTag — only visible text (display name,
// email, cohort). Match the unique email and scroll the dialog when the row
// sits below the fold (P-10+ start off-screen).
async function selectPersonaByText(device, needle) {
  const { w, h } = device.size();
  for (let i = 0; i < 8; i++) {
    const nodes = await dump(device);
    const n = byTextContains(nodes, needle);
    if (n) {
      await tapResolved(device, n);
      await sleep(1000);
      return;
    }
    await device.swipe(
      Math.floor(w / 2),
      Math.floor(h * 0.62),
      Math.floor(w / 2),
      Math.floor(h * 0.32),
      450,
    );
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
async function handlePermissionDialog(device, nodes) {
  for (const id of PERMISSION_ALLOW) {
    const n = byId(nodes, id);
    if (n) {
      await tapResolved(device, n);
      return true;
    }
  }
  return false;
}

// Daily check-in / rewards calendar pops over Home right after sign-in. It's
// a Compose dialog (text only, no testTags), so match button text. Dismiss
// via "Later" (no side effects); fall back to claiming if that's all there is.
async function handleRewardCalendar(device, nodes) {
  const btn = byText(nodes, 'Later') || byTextContains(nodes, 'Claim Today');
  if (!btn) return false;
  await tapResolved(device, btn);
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
  await tapResolved(device, n);
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
      await sleep(700);
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
    await sleep(800);
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
    nodes = await settle(device, 20000);
  } catch (_e) {
    nodes = null;
  }
  if (nodes && atSignIn(nodes)) return;
  if (nodes && anyMainTab(nodes)) {
    await signOutFlow(device);
    return;
  }
  await device.forceStop(pkg);
  device.launch(pkg);
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
  await reachSignIn(device, 12000);
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
 * @param {string|null} nameToken text the debug overlay must show to confirm
 *   WHO is signed in. Pass `null` when the persona has no seeded display name
 *   AND the journey makes its own, stronger identity assertion — see J38, which
 *   compares the on-device account id against the account the API bound its
 *   seeded ticket to. Skipping the check with nothing in its place would let a
 *   journey assert on one account's screen while seeding another's data.
 */
async function signInAs(device, reporter, ctx, email, nameToken) {
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
      await tapId(device, 'persona_picker_open');
      await waitForText(device, 'Sign in as test persona', 8000);
      await selectPersonaByText(device, email);
      await sleep(2500);
      if (!byId(await dump(device), 'persona_picker_open')) {
        return `selected ${email} (attempt ${attempt})`;
      }
    }
    throw new Error(`selecting ${email} bounced back to SignIn 3x (sign-in failing?)`);
  });
  await reporter.step(device, `Land on Home`, async () => {
    await advanceToMain(device);
    return 'home reached — interstitials cleared';
  });
  if (nameToken === null) return;
  await reporter.step(device, `Confirm identity ${nameToken}`, async () => {
    await waitForText(device, nameToken, 6000);
    return `debug overlay shows "${nameToken}"`;
  });
}

// Auth-smoke journey: sign in as a persona + assert their Firestore doc.
function personaJourney(id, title, email, nameToken, uid, cohort) {
  return {
    id,
    title,
    async run(device, reporter, ctx) {
      await signInAs(device, reporter, ctx, email, nameToken);
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
    await signInAs(device, reporter, ctx, 'minor-power@shytalk.dev', 'Marcus (P-04');
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
    await signInAs(device, reporter, ctx, 'adult-prober@shytalk.dev', 'Vexa (P-07');
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
    await signInAs(device, reporter, ctx, 'admin@shytalk.dev', 'Greta (P-12');
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
    await signInAs(device, reporter, ctx, 'victim@shytalk.dev', 'Nora (P-09');
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
    await signInAs(device, reporter, ctx, 'adult-power@shytalk.dev', 'Alice (P-02');
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
    await signInAs(device, reporter, ctx, 'admin@shytalk.dev', 'Greta (P-12');
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
const J38 = {
  id: 'J38',
  title: 'j38 — a second support request is warned about, never refused (SHY-0396)',
  async run(device, reporter, ctx) {
    const pkg = ctx.pkg;
    let token;
    let openBefore = 0;
    let seededTicketId = null;
    let seededUserId = null;

    await reporter.step(device, 'Alice already has a request open', async () => {
      token = await getIdToken(ctx.supportPersona);
      // Seeded through the API rather than assumed: the warning cannot be
      // asserted against a person who has nothing open, and leaving that to
      // whatever the device happened to do earlier makes the run flaky.
      const raised = await apiCall('POST', '/api/support-tickets', {
        token,
        body: { message: `J38 seed: my coins never arrived (${Date.now()})`, category: 'payment' },
      });
      if (raised.status !== 200) throw new Error(`seed failed: ${raised.status}`);
      seededTicketId = raised.body?.ticketId;
      const open = await apiCall('GET', '/api/support-tickets/mine/open', { token });
      openBefore = open.body?.tickets?.length ?? 0;
      if (openBefore < 1) throw new Error('seeded a ticket but nothing is open');
      // Which account the server bound it to. The device is checked against
      // this below -- a walk that asserts on one account's screen while seeding
      // another account's data proves nothing at all.
      const doc = await dbGet(ctx.db, `supportTickets/${seededTicketId}`);
      seededUserId = doc?.userId;
      return `${openBefore} open before the walk, owned by ${seededUserId}`;
    });

    // `null`: this persona has no seeded display name, so the overlay cannot
    // confirm WHO is signed in by name. The step below is a stronger check
    // anyway -- it compares the account on the device against the account the
    // server bound the seeded ticket to.
    await signInAs(device, reporter, ctx, ctx.supportPersona, null);
    if (!ctx.db) return;

    await reporter.step(device, 'The phone is signed in as the account we seeded', async () => {
      const nodes = await dump(device);
      const uidNode = nodes.find((n) => /^UID:\s*\d+/.test(n.text));
      if (!uidNode) throw new Error('the debug overlay is not showing an account id');
      const onDevice = Number(/UID:\s*(\d+)/.exec(uidNode.text)[1]);
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
      await settle(device, 60000);
      await waitForId(device, 'main_profileTab', 20000);
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

    const typed = 'J38: nobody can hear me in voice rooms since this morning';

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
      const snap = await ctx.db
        .collection('supportTickets')
        .where('userId', '==', seededUserId)
        .where('message', '==', typed)
        .get();
      if (snap.empty) {
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
        device.launch(pkg);
        await openSupport();

        const followUp = 'J38: it happened again just now';
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

// j05 — monetization (IAP). In non-prod the /economy/purchase endpoint SKIPS
// real store verification (only NODE_ENV=production hits Google/Apple), so a
// test purchaseToken credits coins — the real IAP code path, no money. Alice
// buys a coin pack and her shyCoins go up. A unique token per run avoids the
// 409 replay guard (receiptId = sha256(purchaseToken)).
const J05 = {
  id: 'J05',
  title: 'j05 — monetization: IAP coin purchase (non-prod test path) credits coins',
  async run(device, reporter, ctx) {
    await signInAs(device, reporter, ctx, 'adult-power@shytalk.dev', 'Alice (P-02');
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
    await signInAs(device, reporter, ctx, 'adult-power@shytalk.dev', 'Alice (P-02');
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

function buildJourneys(ctx) {
  const smoke = {
    id: 'J-SMOKE',
    title: 'Clean install launches and reaches SignIn',
    async run(device, reporter) {
      if (ctx.reset) {
        await reporter.step(device, `Clean reinstall (${ctx.pkg})`, async () => {
          device.uninstall(ctx.pkg);
          const out = device.install(ctx.apkAbs);
          return out.trim().split('\n').pop();
        });
      }
      await reporter.step(device, `Launch app`, async () => {
        await device.forceStop(ctx.pkg);
        device.launch(ctx.pkg);
        await sleep(2500);
        return 'launcher intent sent';
      });
      await reporter.step(device, `Reaches SignIn (backend reachable)`, async () => {
        await reachSignIn(device, 75000);
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
      'Alice (P-02',
      '50000010',
      'adult',
    ),
    personaJourney(
      'J-MARCUS',
      'Minor persona (P-04 Marcus) signs in',
      'minor-power@shytalk.dev',
      'Marcus (P-04',
      '60000010',
      'minor',
    ),
    personaJourney(
      'J-ADMIN',
      'Admin persona (P-12 Greta) signs in',
      'admin@shytalk.dev',
      'Greta (P-12',
      '90000001',
      'adult',
    ),
    J02,
    J08,
    J04,
    J11,
    J07,
    J12,
    J05,
    J06,
    J38,
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
  --serial <serial>    adb serial (default auto-select)
  --journeys <ids>     comma list e.g. J-SMOKE,J-ALICE (default all)
  --rebuild            rebuild the APK first
  --no-reset           skip clean reinstall in J-SMOKE
  --no-record          skip the screen recording (default: record)
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
  }

  const reporter = new Reporter(opts.out, { target: opts.target, serial, device: deviceModel });
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
  let journeys = buildJourneys(ctx);
  if (opts.journeys) journeys = journeys.filter((j) => opts.journeys.includes(j.id));
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
module.exports = {
  parseArgs,
  tapResolved,
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
};
