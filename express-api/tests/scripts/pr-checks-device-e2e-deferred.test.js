/**
 * pr-checks-device-e2e-deferred.test.js
 *
 * SHY-0163: the heavy device E2E jobs (android-e2e, ios-e2e) are DEFERRED off
 * the per-PR PR Gate. The CI Android emulator flakes on infrastructure — the
 * emulator process dies mid-run (`adb: device 'emulator-5554' not found` /
 * `port 5554 connection refused` ~31 min into connectedLocalDebugAndroidTest,
 * no JUnit results) — so a required PR Gate that `needs` it blocks every merge.
 * Under the MVP-sprint model real-device verification is concentrated in ONE
 * end-of-batch gauntlet on REAL devices before the develop→main promotion, so
 * the CI emulator/simulator E2E must not gate individual PRs.
 *
 * These pins lock the invariant so a future edit cannot silently re-add the
 * flaky device jobs to the required gate, and so the deferral stays honest
 * (device jobs run only on base-main, fast jobs stay per-PR).
 *
 * Two layers of pin:
 *   1. STRUCTURAL — the gate's `needs:`/result-loop text excludes the device
 *      jobs and retains every fast job; the device jobs carry the base-main
 *      guard. Cheap regression tripwires.
 *   2. BEHAVIORAL — the gate's "Evaluate results" shell is extracted and RUN
 *      in real bash against synthetic job-result maps, proving the AC's central
 *      safety claim ("a genuinely-failing fast check still blocks PR Gate") is
 *      actually true of the runtime, not merely present in the text. Mirrors the
 *      sibling precedent in pr-checks-app-changed-split.test.js (`classifyFiles`).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PR_CHECKS = fs.readFileSync(
  path.resolve(__dirname, '../../../.github/workflows/pr-checks.yml'),
  'utf8',
);

// A top-level job header: exactly 2-space indent, a lowercase-led kebab/snake
// identifier, then a trailing colon. The char-class checks are deliberately
// UNQUANTIFIED single-char `.test`s — a `[a-z0-9_-]*:` regex would trip
// sonarjs/slow-regex (a quantified class before a literal is a backtracking
// point). This form cannot backtrack super-linearly.
//
// NOTE: in isolation this also returns true for `  pull_request:` (2-space
// indent under `on:`) — that is harmless because jobSection() only ever scans
// FORWARD from a matched job header, and every job lives below the `on:` block.
function isJobHeader(line) {
  if (!line.startsWith('  ') || line.startsWith('   ')) return false;
  if (!line.endsWith(':') || line.length < 4) return false;
  const name = line.slice(2, -1);
  return /^[a-z]/.test(name) && !/[^a-z0-9_-]/.test(name);
}

// Slice a job body: from `  <name>:` (2-space indent) to the next 2-space job
// header (or EOF). Line-based + bounded — no backtracking regex over the whole
// file. `source` is injectable so the helper can be unit-tested on synthetic
// YAML; it defaults to the real workflow file.
function jobSection(name, source = PR_CHECKS) {
  const lines = source.split('\n');
  const start = lines.findIndex((l) => l === `  ${name}:`);
  if (start < 0) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (isJobHeader(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

// Parse a gate section's single-line flow-style `needs: [a, b, c]` into trimmed
// job names. Pure string slicing (no regex) — a `[^\]]*]` capture trips
// sonarjs/slow-regex. Block-style (`needs:\n  - a`) is intentionally NOT parsed
// (returns []); the retention assertions below fail loud if the form ever
// changes, so a silent reformat cannot hide a re-added device job.
function gateNeeds(section) {
  const line = section.split('\n').find((l) => l.trim().startsWith('needs: ['));
  if (!line) return [];
  const open = line.indexOf('[');
  const close = line.indexOf(']', open + 1);
  if (open < 0 || close < 0) return [];
  return line
    .slice(open + 1, close)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const gate = jobSection('gate');
const androidE2e = jobSection('android-e2e');
const iosE2e = jobSection('ios-e2e');

// The fast jobs the gate MUST keep gating on (device jobs deliberately absent).
const RETAINED_GATE_JOBS = [
  'detect-changes',
  'pre-merge-gate',
  'lint',
  'build-and-test',
  'sonarcloud',
  'test-backend',
  'playwright-web',
  'integration-tests',
  'qa-runner-driver-checks',
];

// Extract the `run: |` block-scalar body of the gate's "Evaluate results" step,
// dedented to a runnable script. The gate is the last job in the file, so the
// body runs to EOF; the loop stops at the first line indented no deeper than
// `run:` as a safety bound.
function gateEvalScript() {
  const lines = gate.split('\n');
  const runIdx = lines.findIndex((l) => l.trim() === 'run: |');
  if (runIdx < 0) throw new Error('gate: no "run: |" block found');
  const runIndent = lines[runIdx].search(/\S/);
  const body = [];
  for (let i = runIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') {
      body.push('');
      continue;
    }
    if (line.search(/\S/) <= runIndent) break;
    body.push(line);
  }
  const indents = body.filter((l) => l.trim() !== '').map((l) => l.search(/\S/));
  const min = Math.min(...indents);
  return body.map((l) => (l.trim() === '' ? '' : l.slice(min))).join('\n');
}

// Substitute each `${{ needs.<job>.result }}` placeholder in `source` with a
// literal result (default 'success') and run the resulting script in real bash.
// Only RETAINED_GATE_JOBS keys are substituted — so if `source` references a job
// NOT in that list (e.g. a re-added android-e2e), its placeholder survives and
// the `${{`-remnant guard throws: that is the deferral's regression tripwire.
// `source` defaults to the real gate script and is injectable so a synthetic
// "regressed" script can exercise that tripwire directly. Returns the process
// exit status. Uses pure string replace (no regex) to stay ReDoS-free, and
// absolute `/bin/bash` to satisfy sonarjs/no-os-command-from-path + match the
// runner's bash.
function runGate(overrides = {}, source = gateEvalScript()) {
  let script = source;
  for (const job of RETAINED_GATE_JOBS) {
    const result = Object.prototype.hasOwnProperty.call(overrides, job)
      ? overrides[job]
      : 'success';
    script = script.split(`\${{ needs.${job}.result }}`).join(result);
  }
  if (script.includes('${{')) {
    throw new Error(`Unsubstituted expression remains in gate script:\n${script}`);
  }
  const res = spawnSync('/bin/bash', ['-c', `set -e\n${script}`], {
    encoding: 'utf8',
  });
  return res.status;
}

describe('SHY-0163: device E2E deferred off the per-PR PR Gate', () => {
  test('the gate job is the required "PR Gate"', () => {
    expect(gate).toMatch(/name: PR Gate/);
  });

  describe('PR Gate needs list', () => {
    const needs = gateNeeds(gate);

    test('is parsed non-empty (guards against a silent block-style reformat)', () => {
      expect(needs.length).toBeGreaterThan(0);
    });
    test('excludes android-e2e (deferred device job)', () => {
      expect(needs).not.toContain('android-e2e');
    });
    test('excludes ios-e2e (deferred device job)', () => {
      expect(needs).not.toContain('ios-e2e');
    });
    test('still includes playwright-web (headless browsers stay per-PR)', () => {
      expect(needs).toContain('playwright-web');
    });
    test('still includes integration-tests (backend stays per-PR)', () => {
      expect(needs).toContain('integration-tests');
    });
    // One independent test per job (not a single loop) so a simultaneous
    // multi-drop reports every missing job, not just the first.
    test.each(RETAINED_GATE_JOBS)('still includes fast gate %s', (job) => {
      expect(needs).toContain(job);
    });
  });

  describe('PR Gate result-evaluation loop', () => {
    test('does not evaluate needs.android-e2e.result', () => {
      expect(gate).not.toContain('needs.android-e2e.result');
    });
    test('does not evaluate needs.ios-e2e.result', () => {
      expect(gate).not.toContain('needs.ios-e2e.result');
    });
    // Every retained fast job must STILL be evaluated by the gate — an
    // over-broad edit that drops one silently weakens non-device gating.
    // detect-changes is checked separately (top guard, not the loop).
    test.each(RETAINED_GATE_JOBS.filter((j) => j !== 'detect-changes'))(
      'still evaluates retained fast job %s',
      (job) => {
        expect(gate).toContain(`needs.${job}.result`);
      },
    );
    test('still guards on detect-changes (top-of-step short-circuit)', () => {
      expect(gate).toContain('needs.detect-changes.result');
    });
  });

  describe('device jobs run only on base-main (skipped on feature→develop once develop joins the trigger)', () => {
    test("android-e2e if: gates on github.base_ref == 'main'", () => {
      expect(androidE2e).toMatch(/github\.base_ref\s*==\s*'main'/);
    });
    test('android-e2e retains its android_app_changed gate', () => {
      expect(androidE2e).toMatch(/android_app_changed\s*==\s*'true'/);
    });
    test("ios-e2e if: gates on github.base_ref == 'main'", () => {
      expect(iosE2e).toMatch(/github\.base_ref\s*==\s*'main'/);
    });
    test('ios-e2e retains its ios_app_changed gate', () => {
      expect(iosE2e).toMatch(/ios_app_changed\s*==\s*'true'/);
    });
  });

  // BEHAVIORAL — extract the real "Evaluate results" shell and run it. This is
  // the layer that proves the AC's central safety claim: the deferral removes
  // the device jobs WITHOUT weakening the fast-check gating.
  describe('PR Gate "Evaluate results" — real bash execution', () => {
    test('the runtime body references no device job (deferral is real in the RUN block, not just the needs list)', () => {
      const script = gateEvalScript();
      expect(script).not.toContain('android-e2e');
      expect(script).not.toContain('ios-e2e');
    });

    test('all retained jobs success → gate passes (exit 0)', () => {
      expect(runGate()).toBe(0);
    });

    test('build-and-test failure (the AC-named example) → gate blocks (exit 1)', () => {
      expect(runGate({ 'build-and-test': 'failure' })).toBe(1);
    });

    // Every retained fast job must still block the gate when it genuinely fails
    // or is cancelled — the deferral must not weaken non-device gating.
    const blockingJobs = RETAINED_GATE_JOBS.filter((j) => j !== 'detect-changes');
    test.each(blockingJobs)('fast job %s = failure → gate blocks (exit 1)', (job) => {
      expect(runGate({ [job]: 'failure' })).toBe(1);
    });
    test.each(blockingJobs)('fast job %s = cancelled → gate blocks (exit 1)', (job) => {
      expect(runGate({ [job]: 'cancelled' })).toBe(1);
    });

    test('detect-changes not success → gate blocks (top guard, exit 1)', () => {
      expect(runGate({ 'detect-changes': 'failure' })).toBe(1);
      expect(runGate({ 'detect-changes': 'cancelled' })).toBe(1);
    });

    test('a legitimately-skipped fast job among successes → gate passes (exit 0)', () => {
      expect(runGate({ sonarcloud: 'skipped', 'test-backend': 'skipped' })).toBe(0);
    });

    test('re-adding a device job to the gate is CAUGHT — its placeholder survives substitution and the harness throws (deferral regression tripwire)', () => {
      // The real gate references no device job, so RETAINED_GATE_JOBS covers
      // every placeholder in it. Simulate a regression where a future edit
      // re-adds `needs.android-e2e.result` to the loop: runGate won't substitute
      // it (not a retained job), the `${{`-remnant guard fires, and the suite
      // fails loud — which is exactly how this behavioral layer keeps the
      // deferral honest. (This proves the mechanism a no-op override could not.)
      const regressed =
        'for r in "${{ needs.android-e2e.result }}"; do [ "$r" = failure ] && exit 1; done';
      expect(() => runGate({}, regressed)).toThrow(/Unsubstituted expression/);
      // And the genuine gate script substitutes fully (no remnant) and passes.
      expect(runGate()).toBe(0);
    });
  });

  // Direct unit tests of the private parser helpers against synthetic YAML —
  // the assertions above only exercise them incidentally via the one real file.
  describe('parser helpers (synthetic input)', () => {
    describe('isJobHeader', () => {
      test.each([
        ['  gate:', true],
        ['  android-e2e:', true],
        ['  a:', true],
        ['  test-backend:', true],
      ])('%s → %s (valid 2-space job header)', (line, expected) => {
        expect(isJobHeader(line)).toBe(expected);
      });
      test.each([
        ['    if: always()', 'nested 4-space key'],
        ['name: PR Checks', 'top-level 0-space key'],
        ['  # a comment:', 'a #-comment ending in colon (not a-z led)'],
        ['  UPPER:', 'not lowercase-led'],
        ['  no-colon', 'no trailing colon'],
        ['', 'empty line'],
        ['  :', 'colon only (too short)'],
      ])('rejects %s (%s)', (line) => {
        expect(isJobHeader(line)).toBe(false);
      });
    });

    describe('jobSection', () => {
      const yaml = ['  foo:', '    a: 1', '    b: 2', '  bar:', '    c: 3'].join('\n');
      test('slices a middle job up to the next 2-space header', () => {
        expect(jobSection('foo', yaml)).toBe('  foo:\n    a: 1\n    b: 2');
      });
      test('slices the last job to EOF', () => {
        expect(jobSection('bar', yaml)).toBe('  bar:\n    c: 3');
      });
      test('returns empty string for a missing job', () => {
        expect(jobSection('missing', yaml)).toBe('');
      });
    });

    describe('gateNeeds', () => {
      test('parses a single-line flow-style needs list', () => {
        expect(gateNeeds('    needs: [a, b, c]')).toEqual(['a', 'b', 'c']);
      });
      test('returns [] for an empty flow list', () => {
        expect(gateNeeds('    needs: []')).toEqual([]);
      });
      test('returns [] when there is no needs line', () => {
        expect(gateNeeds('    if: always()')).toEqual([]);
      });
      test('returns [] for block-style needs (flow-style only, by design)', () => {
        expect(gateNeeds('    needs:\n      - a\n      - b')).toEqual([]);
      });
    });
  });
});
