'use strict';

/**
 * apt-stall-guard.test.js — SHY-0334
 *
 * Every workflow step that shells out to apt via Playwright must be preceded by
 * `./.github/actions/harden-apt` and carry its own `timeout-minutes`.
 *
 * WHY. Measured twice on 2026-08-18, identical signature in two different jobs:
 * apt reached `archive.ubuntu.com`, then emitted NOTHING until the job budget
 * expired — 119 minutes on PR #1782's webkit project, 24 on PR #1781's driver
 * checks. apt has no acquire timeout by default, so a dead socket is waited on
 * forever.
 *
 * That is why SHY-0329's `timeout-minutes` 10 -> 25 did not fix it: an unbounded
 * wait consumes whatever budget it is given. The WAIT has to be bounded.
 *
 * This test is deliberately written against a DISCOVERED set, not a hardcoded
 * list of five files — a sixth apt site added later must fail here rather than
 * hang on someone's PR at 3am.
 */

const fs = require('fs');
const path = require('path');

const WORKFLOWS_DIR = path.join(__dirname, '../../../.github/workflows');
const HARDEN_ACTION = './.github/actions/harden-apt';

/** A run: line that makes Playwright invoke apt. `install` WITHOUT `--with-deps`
 *  only downloads browsers and never touches apt, so it is correctly exempt. */
function invokesApt(line) {
  const t = line.trim();
  if (!t.startsWith('run:')) return false;
  return (
    t.includes('playwright install-deps') ||
    (t.includes('playwright install') && t.includes('--with-deps'))
  );
}

function workflowFiles() {
  return fs
    .readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => ({ name: f, src: fs.readFileSync(path.join(WORKFLOWS_DIR, f), 'utf8') }));
}

/** Every apt-invoking site, as {file, line, index}. */
function aptSites() {
  const sites = [];
  for (const { name, src } of workflowFiles()) {
    src.split('\n').forEach((line, i) => {
      if (invokesApt(line)) sites.push({ file: name, line: line.trim(), index: i });
    });
  }
  return sites;
}

/** The step containing line `index`: walk back to its `- name:`/`- uses:` header. */
function stepBlock(src, index) {
  const lines = src.split('\n');
  let start = index;
  while (start >= 0 && !/^ {6}- (name|uses):/.test(lines[start])) start -= 1;
  return { lines, start: Math.max(start, 0) };
}

describe('apt stall guard (SHY-0334)', () => {
  test('there IS at least one apt-invoking site — the guard is not vacuous', () => {
    // Without this, deleting every apt step would make the suite "pass" while
    // proving nothing. A guard that can never fail is not a guard.
    expect(aptSites().length).toBeGreaterThan(0);
  });

  test.each(aptSites().map((s) => [`${s.file}:${s.index + 1}`, s]))(
    'apt site %s is preceded by harden-apt',
    (_label, site) => {
      const src = workflowFiles().find((w) => w.name === site.file).src;
      const { lines, start } = stepBlock(src, site.index);
      // The guard must be the immediately preceding step, so nothing can run
      // apt between it and the install.
      const preceding = lines
        .slice(Math.max(0, start - 3), start)
        .map((l) => l.trim())
        .join('\n');
      expect(preceding).toContain(HARDEN_ACTION);
    },
  );

  test.each(aptSites().map((s) => [`${s.file}:${s.index + 1}`, s]))(
    'apt site %s carries its own timeout-minutes',
    (_label, site) => {
      const src = workflowFiles().find((w) => w.name === site.file).src;
      const { lines, start } = stepBlock(src, site.index);
      const block = lines.slice(start, site.index + 1).join('\n');
      // A step ceiling bounds even the retry loop, so a pathological mirror
      // cannot eat a 120-minute job budget.
      expect(block).toMatch(/^\s*timeout-minutes:\s*\d+/m);
    },
  );

  test('the harden-apt action sets a bounded acquire timeout AND retries', () => {
    const action = fs.readFileSync(
      path.join(__dirname, '../../../.github/actions/harden-apt/action.yml'),
      'utf8',
    );
    // A timeout without retries turns a transient blip into a hard failure;
    // retries without a timeout retry nothing, because the first wait never ends.
    expect(action).toMatch(/Acquire::http::Timeout\s+"\d+"/);
    expect(action).toMatch(/Acquire::https::Timeout\s+"\d+"/);
    expect(action).toMatch(/Acquire::Retries\s+"\d+"/);
  });
});
