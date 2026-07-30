#!/usr/bin/env node
/**
 * check-driver-coverage.js — SHY-0259
 *
 * Fails when a driver declares a method it never implements.
 *
 * WHY THIS EXISTS
 * ---------------
 * Each driver wires EVERY method in its `listMethods()` list to a stub that
 * logs `stub:<name>` and returns false, then real implementations override
 * the ones that exist. A method nobody implemented therefore still RESOLVES:
 * the matcher finds it, the step is reached, and the driver quietly announces
 * it did nothing.
 *
 * That is worse than a missing method. A missing method fails loudly as "not
 * configured"; a stub returns `false`, which reads as "the product did not do
 * the thing" — a harness gap wearing a product failure's clothes. 64 step
 * occurrences were in that state, `webAdminShowsDashboardCounters` alone
 * accounting for 59.
 *
 * HOW IT DECIDES
 * --------------
 * Static, so it needs no device, browser or Appium session: it parses each
 * driver with acorn and collects every `driver.<name> = …` assignment that is
 * NOT the stub loop's computed `driver[methodName] = …`. Anything in
 * `listMethods()` without such an assignment is still a stub.
 *
 * Parsed, not grepped, for the same reason check-test-defects.js is: a regex
 * cannot tell `driver.foo = …` in code from the same text inside a comment or
 * a template literal, and a gate that cries wolf gets switched off.
 *
 * Ratchets DOWN only. Target is 0.
 */
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const REPO = path.resolve(__dirname, '..');
const DRIVERS_DIR = path.join(REPO, 'express-api', 'scripts', 'drivers');
const BASELINE_FILE = path.join(__dirname, 'driver-coverage-baseline.json');

const requireFromApi = createRequire(path.join(REPO, 'express-api', 'package.json'));
const acorn = requireFromApi('acorn');

/**
 * Driver modules only. Helpers in the same directory (retry wrappers, CDP
 * shims, the loader) have no `listMethods` and are skipped by that test
 * rather than by a filename pattern that would silently drift.
 */
function driverFiles() {
  return fs
    .readdirSync(DRIVERS_DIR)
    .filter((f) => f.endsWith('.js'))
    .sort()
    .map((f) => path.join(DRIVERS_DIR, f));
}

/** Every `driver.<name> = …` (or `driver.<name>.foo = …`) written literally. */
function implementedMethods(source) {
  const names = new Set();
  let ast;
  try {
    ast = acorn.parse(source, { ecmaVersion: 2023, sourceType: 'script' });
  } catch (e) {
    throw new Error(`could not parse driver: ${e.message}`);
  }
  const visit = (node) => {
    if (!node || typeof node.type !== 'string') return;
    if (
      node.type === 'AssignmentExpression' &&
      node.left.type === 'MemberExpression' &&
      node.left.object.type === 'Identifier' &&
      node.left.object.name === 'driver' &&
      // `driver[methodName] = …` is the stub loop itself — computed, so the
      // property name is not knowable here and must not count as an
      // implementation of anything.
      node.left.computed === false &&
      node.left.property.type === 'Identifier'
    ) {
      names.add(node.left.property.name);
    }
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child.type === 'string') visit(child);
    }
  };
  visit(ast);
  return names;
}

/** Load a driver module with device env scrubbed, as driver-surface-report does. */
function declaredMethods(file) {
  const saved = {};
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('APPIUM_') || key.startsWith('ANDROID_') || key.startsWith('IOS_')) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  }
  try {
    delete require.cache[require.resolve(file)];
    const mod = require(file);
    return typeof mod.listMethods === 'function' ? mod.listMethods() : null;
  } finally {
    for (const [k, v] of Object.entries(saved)) process.env[k] = v;
  }
}

/**
 * Driver method names the runner can DISPATCH to.
 *
 * Deliberately not called "reached": proving a given corpus step reaches a
 * given method would mean resolving every step to its matcher and then
 * through that matcher's platform branch. This is the weaker, honest claim —
 * the runner contains a call site for the method, so a step CAN land on it.
 * A method with no call site anywhere costs nothing until one appears.
 *
 * Collected two ways, because the matchers use both forms:
 *   ctx.uiDriver.androidTapByTag(...)      — a literal member access
 *   const methodName = 'webAdminShowsStat' — a literal chosen per platform,
 *                                            then applied as driver[methodName]
 */
function reachedMethods() {
  // The runner AND the drivers themselves. A driver method that delegates to
  // a sibling — `driver.iosOpenScreen = () => driver.iosTapByTag(...)` —
  // makes that sibling reachable just as surely as a matcher does. Scanning
  // only the runner missed exactly that, so a delegation to an unimplemented
  // tap looked implemented while silently returning false.
  const sources = [
    path.join(REPO, 'express-api', 'scripts', 'manual-qa-runner.js'),
    ...driverFiles(),
  ];
  const names = new Set();
  const DRIVER_HOLDERS = new Set(['uiDriver', 'webDriver', 'driver']);
  const looksLikeDriverMethod = (v) =>
    typeof v === 'string' && /^(android|ios|web|inject)[A-Z]/.test(v);

  // Literal method names are only a dispatch signal in the RUNNER, where a
  // platform branch picks one and applies it as driver[methodName]. Inside a
  // driver, the same literals are its own listMethods() declaration array —
  // counting those made every declared method look self-reaching, which
  // reported two implemented methods as stubs.
  let literalsAreDispatch = true;

  const visit = (node, isAssignTarget = false) => {
    if (!node || typeof node.type !== 'string') return;
    const isHolderMember =
      node.object &&
      node.object.type === 'MemberExpression' &&
      node.object.property &&
      node.object.property.type === 'Identifier' &&
      DRIVER_HOLDERS.has(node.object.property.name);
    // Inside a driver module the object is a bare local named `driver`.
    // Only READS count — `driver.foo = …` is the implementation, not a call
    // site, and counting it would make every method trivially self-reaching.
    const isBareDriverRead =
      node.object &&
      node.object.type === 'Identifier' &&
      node.object.name === 'driver' &&
      !isAssignTarget;
    if (
      node.type === 'MemberExpression' &&
      node.computed === false &&
      node.property.type === 'Identifier' &&
      (isHolderMember || isBareDriverRead)
    ) {
      names.add(node.property.name);
    }
    // Literal method names selected per platform and applied dynamically.
    if (literalsAreDispatch && node.type === 'Literal' && looksLikeDriverMethod(node.value)) {
      names.add(node.value);
    }
    for (const key of Object.keys(node)) {
      const child = node[key];
      // The left side of an assignment is a definition, not a use.
      const asTarget = node.type === 'AssignmentExpression' && key === 'left';
      if (Array.isArray(child)) child.forEach((c) => visit(c, asTarget));
      else if (child && typeof child.type === 'string') visit(child, asTarget);
    }
  };
  for (const file of sources) {
    literalsAreDispatch = path.dirname(file) !== DRIVERS_DIR;
    visit(acorn.parse(fs.readFileSync(file, 'utf8'), { ecmaVersion: 2023, sourceType: 'script' }));
  }
  return names;
}
/**
 * Driver modules that some non-test code path can actually load.
 *
 * A stub in a driver nothing loads cannot produce a misattributed red cell,
 * which is this gate's entire criterion — so counting it would inflate the
 * number with debt that costs nothing. `ios-simctl-driver.js` is in that
 * state: the loader's routing maps even `--driver simctl` to devicectl, so
 * no path constructs it and only its own tests require it.
 *
 * DERIVED, never hard-coded: the set is computed by scanning non-test
 * sources for requires. Wire simctl back into the loader and its 64 stubs
 * reappear in the count automatically — the exclusion cannot go stale into
 * a lie.
 */
function loadableDrivers() {
  const roots = [
    path.join(REPO, 'express-api', 'scripts'),
    path.join(REPO, 'express-api', 'src'),
    path.join(REPO, 'scripts'),
  ];
  const referenced = new Set();
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'tests') continue;
        walk(full);
        continue;
      }
      if (!e.name.endsWith('.js') || e.name.includes('.test.')) continue;
      const isDriver = path.dirname(full) === DRIVERS_DIR && e.name.endsWith('-driver.js');
      const src = fs.readFileSync(full, 'utf8');
      for (const m of src.matchAll(/drivers\/([a-z0-9-]+-driver)/g)) {
        // A driver never counts as loading ITSELF.
        if (isDriver && `${m[1]}.js` === e.name) continue;
        referenced.add(`${m[1]}.js`);
      }
    }
  };
  roots.forEach(walk);
  return referenced;
}

function scanDrivers() {
  const reached = reachedMethods();
  const loadable = loadableDrivers();
  const rows = [];
  for (const file of driverFiles()) {
    const declared = declaredMethods(file);
    if (!declared) continue; // not a driver — no method surface to cover
    const implemented = implementedMethods(fs.readFileSync(file, 'utf8'));
    const stubs = declared.filter((m) => !implemented.has(m)).sort();
    rows.push({
      driver: path.basename(file),
      declared: declared.length,
      implemented: declared.length - stubs.length,
      stubs,
      loadable: loadable.has(path.basename(file)),
      // Dispatchable AND in a driver something can actually construct.
      reachedStubs: loadable.has(path.basename(file)) ? stubs.filter((m) => reached.has(m)) : [],
      unloadableStubs: loadable.has(path.basename(file))
        ? 0
        : stubs.filter((m) => reached.has(m)).length,
    });
  }
  return {
    drivers: rows,
    driversScanned: rows.length,
    totalStubs: rows.reduce((n, r) => n + r.stubs.length, 0),
    // The blocking number: a stub with no call site costs nothing.
    reachedStubs: rows.reduce((n, r) => n + r.reachedStubs.length, 0),
    unloadableStubs: rows.reduce((n, r) => n + (r.unloadableStubs || 0), 0),
    noDriversFound: rows.length === 0,
  };
}

function readBaseline() {
  try {
    return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

/** Exit code for a scan against a baseline. Pure, so the ratchet is testable. */
function verdict(report, baseline) {
  // "No drivers found" and "no stubs found" print the same 0 unless they are
  // told apart — a moved directory would otherwise report perfect coverage.
  if (report.noDriversFound) return 1;
  if (!Number.isFinite(baseline.reachedStubs)) return 0;
  return report.reachedStubs > baseline.reachedStubs ? 1 : 0;
}

function main(argv = process.argv.slice(2)) {
  const report = scanDrivers();

  if (argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return verdict(report, readBaseline());
  }

  if (argv.includes('--update-baseline')) {
    const baseline = readBaseline();
    if (Number.isFinite(baseline.reachedStubs) && report.reachedStubs > baseline.reachedStubs) {
      console.error(
        `REFUSED: baseline ratchets DOWN only (${baseline.reachedStubs} → ${report.reachedStubs}).`,
      );
      return 1;
    }
    fs.writeFileSync(
      BASELINE_FILE,
      JSON.stringify(
        {
          reachedStubs: report.reachedStubs,
          totalStubs: report.totalStubs,
          byDriver: Object.fromEntries(report.drivers.map((r) => [r.driver, r.stubs.length])),
          note: 'Driver methods declared but never implemented (they resolve, then do nothing). Ratchets DOWN only. Target is 0.',
          updated: new Date().toISOString().slice(0, 10),
        },
        null,
        2,
      ) + '\n',
    );
    console.log(`Baseline updated: ${report.totalStubs}`);
    return 0;
  }

  if (report.noDriversFound) {
    console.error(`FAIL: no drivers found under ${DRIVERS_DIR} — nothing was checked.`);
    return 1;
  }

  if (argv.includes('--list')) {
    for (const r of report.drivers) {
      if (!r.reachedStubs.length) continue;
      console.log(
        `\n=== ${r.driver} — ${r.reachedStubs.length} dispatchable stub(s) of ${r.stubs.length} unimplemented ===`,
      );
      for (const m of r.reachedStubs) console.log(`  ${m}`);
    }
  }

  const baseline = readBaseline();
  console.log(
    `\nDriver methods declared but not implemented: ${report.totalStubs} ` +
      `across ${report.driversScanned} drivers.\n` +
      `Of those, ${report.reachedStubs} have a call site in the runner, so a ` +
      `step can land on them. A further ${report.unloadableStubs} sit in ` +
      'drivers no code path loads, so they cannot mis-colour a cell.' +
      (Number.isFinite(baseline.reachedStubs)
        ? `\nBaseline ${baseline.reachedStubs} dispatchable, target 0.`
        : ''),
  );
  for (const r of report.drivers) {
    if (r.reachedStubs.length) {
      console.log(`  ${String(r.reachedStubs.length).padStart(4)}  ${r.driver}  (dispatchable)`);
    }
  }

  const code = verdict(report, baseline);
  if (code !== 0) {
    console.error(
      `\nFAIL: regressed by ${report.reachedStubs - baseline.reachedStubs}. ` +
        'A stubbed method RESOLVES and returns false, so the step reads as a ' +
        'product failure rather than a harness gap.',
    );
    console.error('Run with --list to see each one.');
  } else if (report.reachedStubs > 0) {
    console.log('\n(at/below baseline — but the target is 0; run --list to see the backlog)');
  }
  return code;
}

module.exports = {
  scanDrivers,
  implementedMethods,
  reachedMethods,
  loadableDrivers,
  verdict,
  DRIVERS_DIR,
};

if (require.main === module) process.exit(main());
