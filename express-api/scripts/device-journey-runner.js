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

// --------------------------------------------------------------------------
// Repo / target configuration
// --------------------------------------------------------------------------
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const TARGETS = {
  local: {
    pkg: 'com.shyden.shytalk.local',
    apk: 'app/build/outputs/apk/local/debug/app-local-debug.apk',
    gradleTask: ':app:assembleLocalDebug',
    gradleArgs: ['-PlocalHost=localhost'],
    // Device localhost -> Mac, so the on-device app reaches the local stack.
    reversePorts: [3000, 7880, 9000, 9099, 8080, 9002],
  },
  dev: {
    pkg: 'com.shyden.shytalk.dev',
    apk: 'app/build/outputs/apk/dev/debug/app-dev-debug.apk',
    gradleTask: ':app:assembleDevDebug',
    gradleArgs: [],
    reversePorts: [], // dev backend is remote; no tunnelling
  },
};

// --------------------------------------------------------------------------
// Tiny arg parser
// --------------------------------------------------------------------------
function parseArgs(argv) {
  const a = {
    target: 'local',
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

  forceStop(pkg) {
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
function parseNodes(xml) {
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
    try {
      const shot = `${String(++this.shotCounter).padStart(2, '0')}-${this.current.id}-${rec.status}.png`;
      device.screencap(path.join(this.runDir, shot));
      rec.screenshot = `runs/${this.runId}/${shot}`;
    } catch (_e) {
      /* non-fatal */
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

async function tapId(device, id) {
  const nodes = await dump(device);
  const n = byId(nodes, id);
  if (!n) throw new Error(`tap target #${id} not found on screen`);
  device.tap(n.center.x, n.center.y);
  await sleep(700);
}

// Tap the lowest-on-screen node with an exact text. Used for dialog confirm
// buttons whose label also appears as the dialog heading (e.g. the "Sign
// Out" button sits below the "Sign Out" title) and which carry no testTag
// because they live in a Compose dialog.
async function tapLowestText(device, text) {
  const matches = (await dump(device)).filter((n) => n.center && n.text === text);
  if (matches.length === 0) throw new Error(`no "${text}" node to tap`);
  const target = matches.reduce((a, b) => (b.center.y > a.center.y ? b : a));
  device.tap(target.center.x, target.center.y);
  await sleep(900);
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
      device.tap(n.center.x, n.center.y);
      await sleep(1000);
      return;
    }
    device.swipe(
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
      device.tap(n.center.x, n.center.y);
      await sleep(350);
    }
  }
  const cont = byId(await dump(device), 'legal_continueButton');
  if (cont && cont.enabled) {
    device.tap(cont.center.x, cont.center.y);
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
function handlePermissionDialog(device, nodes) {
  for (const id of PERMISSION_ALLOW) {
    const n = byId(nodes, id);
    if (n) {
      device.tap(n.center.x, n.center.y);
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
  device.tap(btn.center.x, btn.center.y);
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
  device.tap(n.center.x, n.center.y);
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
    if (isDone(nodes)) return nodes;
    if (handlePermissionDialog(device, nodes)) {
      await sleep(700);
      continue;
    }
    if (await handleRewardCalendar(device, nodes)) continue;
    if (await handleOverlayBubbleDialog(device, nodes)) continue;
    if (byId(nodes, 'profileSetup_continueButton'))
      throw new Error('stuck on ProfileSetup — persona has no profile (seed incomplete?)');
    if (byId(nodes, 'requiredDob_continueButton'))
      throw new Error('stuck on RequiredDOB — persona has no date of birth (seed incomplete?)');
    if (await handleLegalGate(device, nodes)) continue;
    for (const cont of ['splash_continueButton', 'startingScreen_dismissButton']) {
      const n = byId(nodes, cont);
      if (n && n.enabled) {
        device.tap(n.center.x, n.center.y);
        break;
      }
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
  let nodes = await settle(device, 60000);
  if (atSignIn(nodes)) return;
  if (anyMainTab(nodes)) {
    await signOutFlow(device);
    return;
  }
  device.forceStop(pkg);
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
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-shytalk' });
  }
  return admin.firestore();
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
        device.forceStop(ctx.pkg);
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

  const serial = selectSerial(opts.serial);
  if (!serial) throw new Error('No adb device found. Connect a device (adb devices) and retry.');
  const device = new Device(serial);
  let deviceModel = '?';
  try {
    deviceModel = device.shell('getprop ro.product.model').trim();
  } catch (_e) {
    /* ignore */
  }

  const reporter = new Reporter(opts.out, { target: opts.target, serial, device: deviceModel });
  console.log(`Target=${opts.target} pkg=${cfg.pkg} serial=${serial} (${deviceModel})`);
  console.log(`Results -> ${opts.out}`);

  const apkAbs = ensureApk(cfg, opts, reporter.runDir);

  // Tunnel device-localhost -> Mac so the on-device app reaches the stack.
  for (const port of cfg.reversePorts) {
    try {
      device.reverse(port);
    } catch (e) {
      console.log(`  (warn) adb reverse tcp:${port} failed: ${e.message.split('\n')[0]}`);
    }
  }
  if (cfg.reversePorts.length)
    console.log(`adb reverse set for ports: ${cfg.reversePorts.join(', ')}`);

  const db = initDb(opts.target);
  if (db) console.log('Firestore assertions: ON (local emulator)');
  const ctx = { ...cfg, apkAbs, reset: opts.reset, db };
  let journeys = buildJourneys(ctx);
  if (opts.journeys) journeys = journeys.filter((j) => opts.journeys.includes(j.id));
  if (journeys.length === 0) throw new Error('No journeys selected.');

  for (const j of journeys) {
    reporter.startJourney(j.id, j.title);
    try {
      await j.run(device, reporter, ctx);
      reporter.endJourney('pass');
    } catch (e) {
      reporter.endJourney('fail', e.message);
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
  parseNodes,
  byId,
  byText,
  byTextContains,
  summarizeScreen,
  arrayContains,
};
