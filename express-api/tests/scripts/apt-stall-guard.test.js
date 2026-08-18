'use strict';

/**
 * apt-stall-guard.test.js — SHY-0334
 *
 * Every workflow step that shells out to apt via Playwright must be preceded by
 * `./.github/actions/harden-apt` and carry a REACHABLE `timeout-minutes` — one
 * that is strictly below its own job's ceiling, since a job-level timeout is a
 * hard cap across all steps and a larger step value can never fire.
 *
 * WHY. Measured twice on 2026-08-18, identical signature in two different jobs:
 * apt reached `archive.ubuntu.com`, then emitted NOTHING until the job budget
 * expired — 119 minutes on PR #1782's webkit project, 24 on PR #1781's driver
 * checks. apt has no acquire timeout by default, so a dead socket is waited on
 * forever. That is why SHY-0329's `timeout-minutes` 10 -> 25 did not fix it: an
 * unbounded wait consumes whatever budget it is given. The WAIT must be bounded.
 *
 * Sites are DISCOVERED, not listed, so a new one fails here rather than hanging
 * on someone's PR. The discovery primitives are unit-tested against synthetic
 * input at the bottom of this file — a guard whose own parser is only exercised
 * by today's happy-path files is not a guard, it is a coincidence.
 */

const fs = require('fs');
const path = require('path');

const WORKFLOWS_DIR = path.join(__dirname, '../../../.github/workflows');
const ACTION_PATH = path.join(__dirname, '../../../.github/actions/harden-apt/action.yml');
const HARDEN_ACTION = './.github/actions/harden-apt';

/** A step header: `- name:` / `- uses:` / a compact `- run:`, at 6 spaces. */
const STEP_HEADER = /^ {6}- (name|uses|run):/;
/** A job key sits at exactly 2 spaces; its properties at 4; step properties deeper. */
const JOB_HEADER = /^ {2}([\w-]+):\s*$/;
const JOB_TIMEOUT = /^ {4}timeout-minutes:\s*(\d+)/;

/**
 * Remove YAML comments — whole-line AND trailing.
 *
 * Trailing matters most for the harden-apt check: a comment mentioning the
 * action's path on an unrelated line would otherwise satisfy "preceded by
 * harden-apt" when the guard is absent — a fail-OPEN. Quote-aware, because a
 * bare `#` appears legitimately inside shell strings in `run: |` blocks.
 */
const stripComments = (text) =>
  text
    .split('\n')
    .map((line) => {
      let quote = null;
      for (let i = 0; i < line.length; i += 1) {
        const c = line[i];
        if (quote) {
          // Skip the character after a backslash. Without this, an ODD number
          // of escaped same-type quotes flips the parity and a genuine `#`
          // inside the string reads as a comment start — truncating the line
          // and potentially dropping the very apt command being searched for.
          // A guard that silently fails to FIND a site is worse than one that
          // finds a spurious one.
          if (c === '\\') {
            i += 1;
            continue;
          }
          if (c === quote) quote = null;
        } else if (c === '"' || c === "'") {
          quote = c;
        } else if (c === '#') {
          return line.slice(0, i);
        }
      }
      return line;
    })
    .filter((l) => l.trim() !== '')
    .join('\n');

function workflowFiles() {
  return fs
    .readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => ({ name: f, src: fs.readFileSync(path.join(WORKFLOWS_DIR, f), 'utf8') }));
}

/** Job ranges, so a step can be attributed to the job that CONTAINS it. */
function jobs(src) {
  const lines = src.split('\n');
  const heads = [];
  lines.forEach((l, i) => {
    if (JOB_HEADER.test(l)) heads.push(i);
  });
  return heads.map((start, k) => ({
    id: lines[start].match(JOB_HEADER)[1],
    start,
    end: k + 1 < heads.length ? heads[k + 1] : lines.length,
  }));
}

/** Step ranges within a file. */
function steps(src) {
  const lines = src.split('\n');
  const heads = [];
  lines.forEach((l, i) => {
    if (STEP_HEADER.test(l)) heads.push(i);
  });
  return heads.map((start, k) => {
    const end = k + 1 < heads.length ? heads[k + 1] : lines.length;
    return { start, end, body: lines.slice(start, end).join('\n') };
  });
}

/**
 * Does this step body invoke apt through Playwright?
 *
 * Comments are stripped first: several workflows MENTION the install command in
 * prose explaining why it is there (a real case lives in manual-qa-matrix.yml),
 * and prose must neither register as a site nor mask one.
 */
function invokesApt(body) {
  const code = stripComments(body);
  if (code.includes('playwright install-deps')) return true;
  return code.includes('playwright install') && code.includes('--with-deps');
}

/**
 * Every apt-invoking step in ONE file, attributed to the job that CONTAINS it.
 *
 * Extracted so this logic can be driven with synthetic input. Exercising it
 * only through the real corpus cannot distinguish containment from a naive
 * backward scan: every real job declares its ceiling BEFORE its steps, so both
 * algorithms return the same number and a revert would turn nothing red.
 */
function sitesInFile(name, src) {
  const out = [];
  {
    const lines = src.split('\n');
    const jobRanges = jobs(src);
    for (const step of steps(src)) {
      if (!invokesApt(step.body)) continue;
      const job = jobRanges.find((j) => step.start >= j.start && step.start < j.end);
      // Search ONLY inside the containing job. A backward walk to the first
      // matching line would run past a job that declares no ceiling and borrow
      // the PREVIOUS job's number — silently reporting "reachable" against a
      // ceiling that does not apply. `deploy-dev.yml`'s `seed-dev-personas`
      // already has no `timeout-minutes`, so the precondition is real today.
      let jobCeiling = null;
      if (job) {
        for (const line of lines.slice(job.start, job.end)) {
          const m = line.match(JOB_TIMEOUT);
          if (m) {
            jobCeiling = Number(m[1]);
            break;
          }
        }
      }
      const st = step.body.match(/^\s{8,}timeout-minutes:\s*(\d+)/m);
      out.push({
        file: name,
        line: step.start + 1,
        jobId: job ? job.id : null,
        // harden-apt anywhere EARLIER IN THE SAME JOB, not a 3-line window —
        // inserting a cache-restore step between the guard and the install is
        // an established pattern here and must not false-fail. Comments are
        // stripped so prose naming the path cannot false-PASS either.
        jobPrelude: job ? stripComments(lines.slice(job.start, step.start).join('\n')) : '',
        jobCeiling,
        stepTimeout: st ? Number(st[1]) : null,
      });
    }
  }
  return out;
}

function aptSites() {
  return workflowFiles().flatMap(({ name, src }) => sitesInFile(name, src));
}

const SITES = aptSites();
const label = (s) => `${s.file}:${s.line}`;

describe('apt stall guard (SHY-0334)', () => {
  test('there IS at least one apt-invoking site — the guard is not vacuous', () => {
    expect(SITES.length).toBeGreaterThan(0);
  });

  test.each(SITES.map((s) => [label(s), s]))(
    'apt site %s is preceded by harden-apt in its own job',
    (_l, site) => {
      expect(site.jobPrelude).toContain(HARDEN_ACTION);
    },
  );

  test.each(SITES.map((s) => [label(s), s]))(
    'apt site %s carries its own timeout-minutes',
    (_l, site) => {
      expect(site.stepTimeout).toEqual(expect.any(Number));
    },
  );

  test.each(SITES.map((s) => [label(s), s]))(
    "apt site %s's job declares an explicit timeout-minutes",
    (_l, site) => {
      // Relying on GitHub's 360-minute default reopens the very
      // unbounded-enough-to-hurt problem this story closes: harden-apt bounds
      // the install CALL, not the job's other steps or its wall-clock.
      expect(site.jobCeiling).toEqual(expect.any(Number));
    },
  );

  test.each(SITES.map((s) => [label(s), s]))(
    'apt site %s has a REACHABLE step timeout (strictly below its job ceiling)',
    (_l, site) => {
      // The `expect.any(Number)` guard is NOT redundant with the sibling test.
      // `expect(null).toBeLessThan(25)` PASSES, because JS coerces null to 0 —
      // so without this line a step with NO timeout would satisfy a test named
      // "REACHABLE", and would only go red because a sibling happened to catch
      // it. Consolidate or drop that sibling and the regression ships green.
      expect(site.stepTimeout).toEqual(expect.any(Number));
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

    test.each(['Acquire::http::Timeout', 'Acquire::https::Timeout', 'Acquire::ftp::Timeout'])(
      '%s is bounded, not merely present',
      (key) => {
        // A presence-only check would accept "99999", which is not a bound.
        const v = valueOf(key);
        expect(v).toEqual(expect.any(Number));
        expect(v).toBeGreaterThan(0);
        expect(v).toBeLessThanOrEqual(120);
      },
    );

    test('retries at least once, and not so many times that the wait is unbounded again', () => {
      // A timeout WITHOUT retries turns a blip into a red build; retries
      // WITHOUT a timeout retry nothing. And a bounded per-attempt wait times
      // an unbounded multiplier is unbounded again — 30s x 50 is 25 minutes,
      // which is the exact failure this story exists to remove.
      const retries = valueOf('Acquire::Retries');
      expect(retries).toEqual(expect.any(Number));
      expect(retries).toBeGreaterThanOrEqual(1);
      expect(retries).toBeLessThanOrEqual(5);
    });
  });
});

// ── The discovery primitives, against synthetic input ─────────────────
//
// Exercising these only through today's workflow files proves they work on
// today's workflow files. These prove the PARSER.

describe('discovery primitives', () => {
  // The step-splitter is validated against js-yaml — the REAL parser — rather
  // than against my own belief about YAML. Review round 2 suspected a
  // column-6 line inside a `run: |` block would be a "decoy" that wrongly
  // splits a step. It is not a decoy: a block scalar's content must be
  // indented DEEPER than its key, so a column-6 line genuinely terminates the
  // block and genuinely starts a new list item. js-yaml confirms it. The
  // line-scan agrees with YAML; asserting otherwise would have "fixed" correct
  // code to match a wrong expectation.
  test('the step splitter agrees with the real YAML parser on a block-scalar edge case', () => {
    const yaml = require('js-yaml');
    const src = [
      'jobs:',
      '  j:',
      '    steps:',
      '      - name: Real step',
      '        run: |',
      '          cat > out.yml <<EOF',
      '      - name: not a real step',
      '          EOF',
      '      - name: Next real step',
      '        run: echo done',
    ].join('\n');
    const truth = yaml.load(src).jobs.j.steps.length;
    expect(steps(src)).toHaveLength(truth);
  });

  test('header-shaped content INSIDE a block scalar does not split the step', () => {
    // The case that WOULD be a decoy: properly-indented block content that
    // happens to look like a step header. STEP_HEADER requires exactly six
    // spaces, and block content under a step is always deeper, so it cannot
    // match — proven here rather than assumed.
    const src = [
      '      - name: Writes a workflow',
      '        run: |',
      '          cat > generated.yml <<EOF',
      '          - name: embedded thing',
      '            uses: some/action@v1',
      '          EOF',
      '      - name: Second step',
      '        run: echo done',
    ].join('\n');
    expect(steps(src)).toHaveLength(2);
  });

  test('finds apt inside a multi-line run: | block', () => {
    const body = [
      '      - name: X',
      '        run: |',
      '          npx playwright install-deps',
    ].join('\n');
    expect(invokesApt(body)).toBe(true);
  });

  test('finds apt in a compact single-line - run: step', () => {
    expect(invokesApt('      - run: npx playwright install --with-deps chromium')).toBe(true);
  });

  test('does NOT treat prose mentioning the command as a site', () => {
    const body = [
      '      - name: X',
      '        # npx playwright install --with-deps is slow',
      '        run: echo hi',
    ].join('\n');
    expect(invokesApt(body)).toBe(false);
  });

  test('playwright install WITHOUT --with-deps never touches apt and is exempt', () => {
    expect(invokesApt('      - run: npx playwright install')).toBe(false);
  });

  test('sitesInFile scopes a job’s ceiling to ITSELF — never borrows an earlier job’s', () => {
    // THE discriminating case, and the one the previous version of this file
    // could not express. Every real workflow declares a job's ceiling BEFORE
    // its steps, so a naive backward scan and containment return the SAME
    // number for all five live sites — reverting the containment fix turned
    // nothing red. This drives the real function against a shape the corpus
    // does not contain: a job WITH a ceiling, followed by a job WITHOUT one
    // that actually holds an apt step. A backward scan reports 120 here.
    const src = [
      'jobs:',
      '  earlier:',
      '    timeout-minutes: 120',
      '    steps:',
      '      - run: echo hi',
      '  later:',
      '    steps:',
      '      - uses: ./.github/actions/harden-apt',
      '      - name: Install',
      '        timeout-minutes: 10',
      '        run: npx playwright install --with-deps chromium',
    ].join('\n');

    const found = sitesInFile('synthetic.yml', src);
    expect(found).toHaveLength(1);
    expect(found[0].jobId).toBe('later');
    // null, honestly — NOT `earlier`'s 120.
    expect(found[0].jobCeiling).toBeNull();
  });

  test('sitesInFile reads the ceiling of the job that actually contains the step', () => {
    const src = [
      'jobs:',
      '  earlier:',
      '    timeout-minutes: 120',
      '    steps:',
      '      - run: echo hi',
      '  later:',
      '    timeout-minutes: 30',
      '    steps:',
      '      - uses: ./.github/actions/harden-apt',
      '      - name: Install',
      '        timeout-minutes: 10',
      '        run: npx playwright install --with-deps chromium',
    ].join('\n');
    const [site] = sitesInFile('synthetic.yml', src);
    expect(site.jobCeiling).toBe(30);
  });

  test('a trailing comment naming harden-apt does NOT satisfy the guard check', () => {
    // Fail-OPEN if unstripped: the step would look guarded when it is not.
    const src = [
      'jobs:',
      '  j:',
      '    timeout-minutes: 30',
      '    steps:',
      '      - run: echo hi  # see ./.github/actions/harden-apt for why',
      '      - name: Install',
      '        timeout-minutes: 10',
      '        run: npx playwright install --with-deps chromium',
    ].join('\n');
    const [site] = sitesInFile('synthetic.yml', src);
    expect(site.jobPrelude).not.toContain('./.github/actions/harden-apt');
  });

  // The quote state machine, in BOTH directions. It shipped in round 3 with no
  // test at all — deleting it entirely would have turned nothing red, which is
  // the "coincidence, not a guard" gap this whole file exists to close.
  test('a # inside a quoted string is NOT a comment', () => {
    const body = [
      '      - name: X',
      '        run: echo "a # b" && npx playwright install-deps',
    ].join('\n');
    expect(invokesApt(body)).toBe(true);
  });

  test('a # after an ESCAPED quote is still inside the string', () => {
    // Round 4's repro. Without escape handling the `\"` toggles the quote
    // closed one character early, the real `#` reads as a comment, the line is
    // truncated there — and the apt command after it vanishes. A guard that
    // silently fails to FIND a site is worse than one that finds a spurious one.
    const body = [
      '      - name: X',
      '        run: echo "value \\" # literal hash" && npx playwright install-deps',
    ].join('\n');
    expect(invokesApt(body)).toBe(true);
  });

  test('single and double quotes are tracked independently', () => {
    const body = [
      '      - name: X',
      `        run: echo 'a " b # c' && npx playwright install-deps`,
    ].join('\n');
    expect(invokesApt(body)).toBe(true);
  });

  test('a genuinely unterminated quote keeps everything after it', () => {
    // Round 5 caught that the previous version never reached the unterminated
    // state: its `#` came BEFORE the stray quote, so the ordinary truncation
    // path fired and the quote machine was never consulted — it passed
    // identically under a naive split('#')[0]. Here the quote opens and never
    // closes, so the `#` stays inside the string and the line survives whole.
    // Malformed input must fail toward finding a spurious site, never toward
    // silently losing a real one.
    const body = [
      '      - name: X',
      '        run: echo "never closes # not a real comment && npx playwright install-deps',
    ].join('\n');
    expect(invokesApt(body)).toBe(true);
  });

  test('the escape skip consumes EXACTLY the escaped character', () => {
    // An over-skip (i += 2) survives every other quote test here, because in
    // those fixtures it only eats an innocuous space. It shows up only with
    // zero gap between the escaped quote and the real closing quote: the
    // closer is swallowed too, the string never registers as closed, and the
    // trailing comment is wrongly kept instead of stripped. Mutation-verified.
    const line = '        run: echo "a\\"" # real comment';
    expect(stripComments(line)).toBe('        run: echo "a\\"" ');
  });

  test('sitesInFile’s jobPrelude stops at the STEP, not at the end of the job', () => {
    // Guards the sibling of the ceiling bug fixed in round 2: a harden-apt
    // reference placed AFTER the install step is useless, and must not satisfy
    // "preceded by harden-apt" for that step.
    const src = [
      'jobs:',
      '  j:',
      '    timeout-minutes: 30',
      '    steps:',
      '      - name: Unguarded install',
      '        timeout-minutes: 10',
      '        run: npx playwright install --with-deps chromium',
      '      - uses: ./.github/actions/harden-apt',
    ].join('\n');
    const [site] = sitesInFile('synthetic.yml', src);
    expect(site.jobPrelude).not.toContain('./.github/actions/harden-apt');
  });

  test('a trailing comment naming the install command is NOT a site', () => {
    const body = [
      '      - name: X',
      '        run: echo hi  # npx playwright install --with-deps',
      '',
    ].join('\n');
    expect(invokesApt(body)).toBe(false);
  });
});
