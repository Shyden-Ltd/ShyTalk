'use strict';

/**
 * apt-stall-guard.test.js — SHY-0334
 *
 * Every workflow step that shells out to apt via Playwright must be preceded by
 * `./.github/actions/harden-apt` and carry a REACHABLE `timeout-minutes`.
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
 * Sites are DISCOVERED, not listed, so a new one fails here rather than hanging
 * on someone's PR. Discovery scans each STEP'S WHOLE BODY rather than matching
 * `run:` lines — review round 1 showed a line-anchored matcher silently misses
 * both a command inside a multi-line `run: |` block (the dominant style in this
 * repo) and a compact `- run:` step.
 */

const fs = require('fs');
const path = require('path');

const WORKFLOWS_DIR = path.join(__dirname, '../../../.github/workflows');
const ACTION_PATH = path.join(__dirname, '../../../.github/actions/harden-apt/action.yml');
const HARDEN_ACTION = './.github/actions/harden-apt';

/** A step header: `- name:` / `- uses:` / a compact `- run:`. */
const STEP_HEADER = /^ {6}- (name|uses|run):/;
/** A job-level `timeout-minutes` sits at exactly 4 spaces; a step's is deeper. */
const JOB_TIMEOUT = /^ {4}timeout-minutes:\s*(\d+)/;

function workflowFiles() {
  return fs
    .readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => ({ name: f, src: fs.readFileSync(path.join(WORKFLOWS_DIR, f), 'utf8') }));
}

/** Split a workflow into steps: {startLine, body, lines}. */
function steps(src) {
  const lines = src.split('\n');
  const heads = [];
  lines.forEach((l, i) => {
    if (STEP_HEADER.test(l)) heads.push(i);
  });
  return heads.map((start, k) => ({
    start,
    end: k + 1 < heads.length ? heads[k + 1] : lines.length,
    body: lines.slice(start, k + 1 < heads.length ? heads[k + 1] : lines.length).join('\n'),
  }));
}

/**
 * Does this step body invoke apt through Playwright?
 *
 * Comment lines are stripped first: several workflows MENTION the install
 * command in prose explaining why it is there, and prose must never register as
 * a site (nor mask one).
 */
function invokesApt(body) {
  const code = body
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .join('\n');
  if (code.includes('playwright install-deps')) return true;
  return code.includes('playwright install') && code.includes('--with-deps');
}

/** Every apt-invoking step across every workflow. */
function aptSites() {
  const out = [];
  for (const { name, src } of workflowFiles()) {
    const lines = src.split('\n');
    for (const step of steps(src)) {
      if (!invokesApt(step.body)) continue;
      // The job ceiling this step actually lives under.
      let jobCeiling = null;
      for (let i = step.start; i >= 0; i -= 1) {
        const m = lines[i].match(JOB_TIMEOUT);
        if (m) {
          jobCeiling = Number(m[1]);
          break;
        }
      }
      const stepTimeout = step.body.match(/^\s{8,}timeout-minutes:\s*(\d+)/m);
      out.push({
        file: name,
        line: step.start + 1,
        body: step.body,
        preceding: lines.slice(Math.max(0, step.start - 3), step.start).join('\n'),
        jobCeiling,
        stepTimeout: stepTimeout ? Number(stepTimeout[1]) : null,
      });
    }
  }
  return out;
}

const SITES = aptSites();

describe('apt stall guard (SHY-0334)', () => {
  test('there IS at least one apt-invoking site — the guard is not vacuous', () => {
    // Without this, deleting every apt step would make the suite "pass" while
    // proving nothing. A guard that can never fail is not a guard.
    expect(SITES.length).toBeGreaterThan(0);
  });

  test.each(SITES.map((s) => [`${s.file}:${s.line}`, s]))(
    'apt site %s is preceded by harden-apt',
    (_label, site) => {
      expect(site.preceding).toContain(HARDEN_ACTION);
    },
  );

  test.each(SITES.map((s) => [`${s.file}:${s.line}`, s]))(
    'apt site %s carries its own timeout-minutes',
    (_label, site) => {
      expect(site.stepTimeout).toEqual(expect.any(Number));
    },
  );

  test.each(SITES.map((s) => [`${s.file}:${s.line}`, s]))(
    'apt site %s has a REACHABLE step timeout (below its job ceiling)',
    (_label, site) => {
      // Job-level timeout-minutes is a hard cap across ALL steps, so a step
      // ceiling above it can never fire — dead code that misreports the real
      // bound. I shipped exactly this in deploy-dev.yml (step 15 inside jobs
      // capped at 10 and 12); actionlint cannot catch it, because it is a
      // cross-field relationship rather than a syntax rule.
      expect(site.jobCeiling).toEqual(expect.any(Number));
      expect(site.stepTimeout).toBeLessThan(site.jobCeiling);
    },
  );

  describe('the harden-apt action', () => {
    const action = fs.readFileSync(ACTION_PATH, 'utf8');
    const valueOf = (key) => {
      const m = action.match(new RegExp(`${key}\\s+"(\\d+)"`));
      return m ? Number(m[1]) : null;
    };

    test('bounds the acquire wait for http AND https', () => {
      // A bare presence check would accept "99999", which is not a bound.
      for (const key of ['Acquire::http::Timeout', 'Acquire::https::Timeout']) {
        const v = valueOf(key);
        expect(v).toEqual(expect.any(Number));
        expect(v).toBeGreaterThan(0);
        expect(v).toBeLessThanOrEqual(120);
      }
    });

    test('retries at least once, so a transient blip is not a hard failure', () => {
      // A timeout WITHOUT retries turns a blip into a red build; retries
      // WITHOUT a timeout retry nothing, because the first wait never ends.
      // `Retries "0"` would satisfy a presence-only assertion.
      const retries = valueOf('Acquire::Retries');
      expect(retries).toEqual(expect.any(Number));
      expect(retries).toBeGreaterThanOrEqual(1);
    });
  });
});
