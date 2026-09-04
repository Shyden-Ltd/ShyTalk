/**
 * SHY-0521 — every open Dependabot advisory is pinned against what the
 * lockfiles actually resolve.
 *
 * Why a table of RANGES and not `>= first_patched`: an advisory names a range
 * ([[feedback-a-vulnerability-check-needs-the-advisory-range]]). A lockfile can
 * hold several majors of one package; only copies inside the range are
 * vulnerable, so a check that demands `>= patched` everywhere fails a safe
 * older major and passes an unsafe newer one.
 *
 * How to extend: when Dependabot opens an alert, add its row verbatim from
 * `gh api repos/Shyden-Ltd/ShyTalk/dependabot/alerts?state=open`; the test
 * stays red until the lockfile leaves the range. When an advisory is withdrawn
 * or the package is removed, delete its row. The anchor test refuses a vacuous
 * pass: a row naming a package that is not in the lockfile is a typo, not a fix.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');

/** Open alerts on 2026-09-04, fields verbatim from the Dependabot API. */
const ADVISORIES = [
  {
    lockfile: 'package-lock.json',
    pkg: 'fast-uri',
    ghsa: 'GHSA-jqff-g426-hqxp',
    vulnerable: '>= 3.0.0, < 3.1.6',
    firstPatched: '3.1.6',
  },
  {
    lockfile: 'package-lock.json',
    pkg: 'fast-uri',
    ghsa: 'GHSA-f65p-4m7j-42xc',
    vulnerable: '>= 3.0.0, < 3.1.6',
    firstPatched: '3.1.6',
  },
  {
    lockfile: 'express-api/package-lock.json',
    pkg: 'qs',
    ghsa: 'GHSA-x5fp-wj9c-mxmx',
    vulnerable: '>= 6.14.2, <= 6.15.3',
    firstPatched: '6.16.0',
  },
  {
    lockfile: 'package-lock.json',
    pkg: 'fast-uri',
    ghsa: 'GHSA-fph4-wmhf-6fwf',
    vulnerable: '>= 3.1.2, < 3.1.6',
    firstPatched: '3.1.6',
  },
  {
    lockfile: 'package-lock.json',
    pkg: 'fast-uri',
    ghsa: 'GHSA-5jgf-p345-68v8',
    vulnerable: '>= 3.1.3, < 3.1.6',
    firstPatched: '3.1.6',
  },
];

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) {
    throw new Error(`unparseable version "${version}"`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] < right[index] ? -1 : 1;
    }
  }
  return 0;
}

const OPERATORS = {
  '>=': (cmp) => cmp >= 0,
  '>': (cmp) => cmp > 0,
  '<=': (cmp) => cmp <= 0,
  '<': (cmp) => cmp < 0,
  '=': (cmp) => cmp === 0,
};

/**
 * True when `version` satisfies EVERY clause of a GitHub advisory range such
 * as `>= 6.14.2, <= 6.15.3` (comma-separated, one operator per clause).
 */
function isInsideRange(version, range) {
  return range.split(',').every((rawClause) => {
    const clause = rawClause.trim();
    const match = /^(>=|<=|>|<|=)\s*(\d+\.\d+\.\d+)$/.exec(clause);
    if (!match) {
      throw new Error(`unparseable range clause "${clause}" in "${range}"`);
    }
    const cmp = compareVersions(parseVersion(version), parseVersion(match[2]));
    return OPERATORS[match[1]](cmp);
  });
}

/** Every locked copy of `pkg` in `lockfile` (hoisted and nested alike). */
function lockedCopies(lockfile, pkg) {
  const lock = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, lockfile), 'utf8'));
  return Object.entries(lock.packages)
    .filter(([key]) => key === `node_modules/${pkg}` || key.endsWith(`/node_modules/${pkg}`))
    .map(([key, entry]) => ({ key, version: entry.version }));
}

describe('advisory range helper', () => {
  test.each([
    ['6.15.2', '>= 6.14.2, <= 6.15.3', true],
    ['6.14.2', '>= 6.14.2, <= 6.15.3', true],
    ['6.15.3', '>= 6.14.2, <= 6.15.3', true],
    ['6.14.1', '>= 6.14.2, <= 6.15.3', false],
    ['6.16.0', '>= 6.14.2, <= 6.15.3', false],
    ['3.1.5', '>= 3.0.0, < 3.1.6', true],
    ['3.1.6', '>= 3.0.0, < 3.1.6', false],
    ['2.9.9', '>= 3.0.0, < 3.1.6', false],
    ['10.0.0', '< 3.1.6', false],
  ])('%s inside "%s" → %s', (version, range, expected) => {
    expect(isInsideRange(version, range)).toBe(expected);
  });

  test('refuses a clause it cannot parse rather than passing silently', () => {
    expect(() => isInsideRange('1.0.0', '~1.0')).toThrow(/unparseable range clause/);
    expect(() => isInsideRange('latest', '>= 1.0.0')).toThrow(/unparseable version/);
  });
});

describe.each(ADVISORIES)('$ghsa — $pkg in $lockfile', (advisory) => {
  const copies = lockedCopies(advisory.lockfile, advisory.pkg);

  test('anchor: the package is present in the lockfile (no vacuous pass)', () => {
    expect(copies.length).toBeGreaterThan(0);
  });

  test('row sanity: the first patched version is itself outside the range', () => {
    expect(isInsideRange(advisory.firstPatched, advisory.vulnerable)).toBe(false);
  });

  test('no locked copy is inside the vulnerable range', () => {
    const vulnerable = copies.filter((copy) => isInsideRange(copy.version, advisory.vulnerable));
    expect(vulnerable).toEqual([]);
  });
});
