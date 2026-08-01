/**
 * A test may not carry its own copy of production logic.
 *
 * THE BUG THIS EXISTS TO PREVENT (2026-08-01, twice in one file):
 *
 *   describe('androidTypeText escaping — the shell-injection trap', () => {
 *     const escape = (t) => String(t).replace(/'/g, `'\\''`).replace(/ /g, '%s');
 *     it('neutralises an apostrophe …', () => expect(escape("Selma's")).toBe(…));
 *
 * That test defined the rule locally and asserted on its own copy, so it
 * passed no matter what the driver did — and the driver was broken: the
 * escaping targeted the HOST shell while `adb shell` hands everything to a
 * shell ON THE DEVICE. Verified against the real phone,
 * `/system/bin/sh: no closing quote`. Every journey step typing a name with
 * an apostrophe had been failing, under a green test.
 *
 * `androidSearchIn` had the same duplicate in PRODUCTION code, and both
 * copies were wrong in the same way — which is what two implementations of
 * one rule always eventually buys.
 *
 * The distinctive fragments below are the ones that have actually been
 * duplicated. A test containing one without importing the helper is
 * re-implementing it.
 */
const fs = require('fs');
const path = require('path');

const TESTS_DIR = path.join(__dirname, '..');

/**
 * fragment  — a distinctive piece of the helper's implementation
 * helper    — what a test should import instead
 * module    — where it lives
 */
const SHARED_RULES = [
  {
    name: 'POSIX single-quote escaping',
    // The `'\''` idiom. Only one rule in this repo needs it.
    fragment: /replace\(\/'\/g/,
    helper: 'deviceShellArg',
    module: 'scripts/drivers/device-shell',
  },
  {
    name: 'adb input-text space encoding',
    fragment: /replace\(\/ \/g, ?'%s'\)/,
    helper: 'escapeInputText',
    module: 'scripts/drivers/ui-dump-query',
  },
];

/** Source with comments removed — a mention in prose is not an implementation. */
function stripComments(src) {
  return src.replace(/\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g, '').replace(/^[ \t]*\/\/[^\n]*$/gm, '');
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walk(p, out);
    } else if (/\.test\.js$/.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
}

const TEST_FILES = walk(TESTS_DIR);

describe('the scan is real', () => {
  it('finds the test corpus', () => {
    expect(TEST_FILES.length).toBeGreaterThan(100);
  });

  it('each rule names a helper that actually exists', () => {
    // A rule pointing at a non-existent helper would tell people to import
    // something they cannot.
    for (const rule of SHARED_RULES) {
      const mod = require(path.join(__dirname, '../..', rule.module));
      expect(typeof mod[rule.helper]).toBe('function');
    }
  });

  it('each fragment actually appears in the helper it names', () => {
    // Otherwise the fragment is not distinctive of that rule and the guard is
    // pointing at the wrong thing.
    for (const rule of SHARED_RULES) {
      const src = fs.readFileSync(path.join(__dirname, '../..', `${rule.module}.js`), 'utf8');
      expect(rule.fragment.test(src)).toBe(true);
    }
  });
});

describe('no test re-implements a shared rule', () => {
  it.each(SHARED_RULES.map((r) => [r.name, r]))('%s', (_name, rule) => {
    const offenders = TEST_FILES.filter((file) => {
      // Comments stripped first: a test that DOCUMENTS the rule it delegates
      // is doing the right thing, and flagging it would push people to delete
      // the explanation. Same lesson as the exec-detector, which counted a
      // docstring mention as a call site.
      const src = stripComments(fs.readFileSync(file, 'utf8'));
      if (!rule.fragment.test(src)) return false;
      // Importing the helper and ALSO showing the fragment in a comment is
      // fine — the comment documents why the helper exists.
      if (src.includes(rule.helper)) return false;
      return true;
    }).map((f) => path.relative(TESTS_DIR, f));

    // Named in the failure, with the fix: import the helper.
    expect({ rule: rule.name, offenders }).toEqual({ rule: rule.name, offenders: [] });
  });
});

describe('the guard can fail', () => {
  it('detects a re-implementation when one is present', () => {
    // Mutation in miniature. Without this, a fragment that matched nothing
    // would make every assertion above vacuous.
    const rule = SHARED_RULES[0];
    const fakeTest = `const escape = (t) => t.replace(/'/g, "'\\\\''");`;
    expect(rule.fragment.test(fakeTest)).toBe(true);
    expect(fakeTest.includes(rule.helper)).toBe(false);
  });

  it('does not flag a test that imports the helper', () => {
    const rule = SHARED_RULES[0];
    const goodTest = `const { deviceShellArg } = require('../../scripts/drivers/device-shell');`;
    expect(goodTest.includes(rule.helper)).toBe(true);
  });
});
