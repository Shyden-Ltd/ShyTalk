#!/usr/bin/env node
/**
 * check-test-defects.js — a ratcheting detector for tests that can silently
 * pass without testing anything.
 *
 * Four defect classes, all of which report GREEN while proving nothing:
 *
 *   GUARD-IF     `if ((await x.count()) > 0) { ...assertions... }`
 *                The body never runs when the selector is wrong or the feature
 *                does not exist, and the test still passes. This is how a
 *                whole "Reports & Evidence" panel stayed unbuilt for months
 *                while its tests were green (SHY-0249).
 *
 *   BARE-EXPECT  `expect(await x.count()).toBe(3)`
 *                A one-shot read with no retry. Passes or fails on whatever
 *                the DOM happened to contain at that instant, so it is both
 *                flaky and a hidden sleep-dependency. `toHaveCount()` retries.
 *
 *                `count()` is NOT special here — `getAttribute`, `textContent`,
 *                `innerText` and `inputValue` have identical semantics and
 *                return null/'' before the element exists. Two roadmap-auth
 *                tests flaked on exactly that (2026-07-29) and this detector
 *                missed them because it had been shaped around the one bug
 *                already known. Each has a retrying counterpart:
 *                toHaveAttribute / toContainText / toHaveText / toHaveValue.
 *
 *   SKIP-COND    `test.skip(someCondition, '...')`
 *                The test opts itself out at runtime. Reported as "skipped",
 *                which nobody reads, so it is indistinguishable from passing.
 *
 *   PARKED       `test.skip('title', ...)` / `test.fixme('title', ...)`
 *                Never runs at all.
 *
 * Deliberately NOT flagged:
 *
 *   POLL-OK      `.count()` inside `expect.poll(...)` / `toPass(...)` /
 *                `waitFor(...)` — the callback is re-evaluated, so the read is
 *                retrying and therefore legitimate.
 *
 * Usage:
 *   node scripts/check-test-defects.js            # gate against the baseline
 *   node scripts/check-test-defects.js --list     # print every site
 *   node scripts/check-test-defects.js --json     # machine-readable
 *   node scripts/check-test-defects.js --update-baseline
 *
 * Exit 0 when total <= baseline, 1 when it regressed. The baseline only ever
 * ratchets DOWN — a fix lowers it, nothing may raise it.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const TESTS_DIR = path.join(REPO, 'tests', 'web');
const BASELINE_FILE = path.join(__dirname, 'test-defects-baseline.json');

const ACTIONABLE = ['GUARD-IF', 'BARE-EXPECT', 'SKIP-COND', 'PARKED'];

/**
 * Locator reads that resolve ONCE. Each returns a falsy placeholder rather than
 * waiting when the element is not there yet, so feeding one straight into
 * `expect` races the render instead of waiting for it.
 */
const ONE_SHOT_READS = ['count', 'getAttribute', 'textContent', 'innerText', 'inputValue'];
const ONE_SHOT_RE = new RegExp(`\\.(${ONE_SHOT_READS.join('|')})\\(`);

/** Walk the enclosing 4 lines: a poll/waitFor callback makes a count() read legitimate. */
function insideRetryingCallback(lines, i) {
  // 8 lines, not 4: a poll callback that re-searches before re-reading is
  // legitimately long, and a short window mislabelled its internal guards as
  // silent skips. The `.not.toBe`/`.toBeGreaterThan` tail proves the whole
  // callback is an assertion, so nothing inside it can pass silently.
  const window = lines.slice(Math.max(0, i - 8), i + 1).join('\n');
  return /expect\s*\n?\s*\.poll\s*\(|expect\.poll\s*\(|\btoPass\s*\(|\bwaitFor\s*\(/.test(window);
}

/**
 * Classify a `.count()` line by where its value actually GOES. A declaration is
 * only a defect once something consumes it, so follow the variable forward
 * rather than guessing from the declaration's shape.
 */
function classifyCountLine(lines, i) {
  const line = lines[i];
  if (insideRetryingCallback(lines, i)) return 'POLL-OK';
  if (/^\s*(\}\s*else\s*)?if\s*\(/.test(line) || /\bif\s*\(\s*\(?await/.test(line)) return 'GUARD-IF';
  if (new RegExp(`expect\\s*\\(\\s*await[^;]*${ONE_SHOT_RE.source}`).test(line)) return 'BARE-EXPECT';

  const decl = line.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await/);
  if (!decl) return 'OTHER';

  const name = decl[1];
  const rest = lines.slice(i + 1, i + 12);
  const useIf = rest.findIndex((l) => new RegExp(`\\bif\\s*\\([^)]*\\b${name}\\b`).test(l));
  const useExpect = rest.findIndex((l) => new RegExp(`expect\\s*\\(\\s*${name}\\b`).test(l));
  if (useIf !== -1 && (useExpect === -1 || useIf < useExpect)) return 'GUARD-IF';
  if (useExpect !== -1) return 'BARE-EXPECT';
  return 'OTHER';
}

function classifySkipLine(line) {
  const m = line.match(/\b(?:test|it|this)\.(skip|fixme)\s*\(/);
  if (!m) return null;
  const after = line.slice(line.indexOf(m[0]) + m[0].length).trim();
  // `test.skip('title', async () => {}` parks a test; `test.skip(cond, 'why')`
  // opts out at runtime; a bare `test.skip()` skips the rest of the body.
  if (/^['"`]/.test(after)) return 'PARKED';
  if (after === '' || after.startsWith(')')) return 'SKIP-COND';
  return 'SKIP-COND';
}

/**
 * An explicit, reasoned suppression on the preceding line:
 *
 *   // defect-detector:allow SKIP-COND — no touch events exist on a desktop browser
 *
 * The em-dash reason is REQUIRED — a bare allow is ignored, so the escape
 * hatch cannot be used without saying why in the diff. Reserved for genuine
 * platform-capability gates (a feature that does not exist on that surface),
 * never for "the data might not be there": absent data is a seeding bug, and
 * skipping on it is precisely what this detector exists to stop.
 */
// The category is an exact alternation, not `[A-Z-]+`: a character class
// backtracks, so `allow SKIP-COND` with NO reason parsed as category `SKIP`
// with reason `COND` and silently opened the hatch. The reason must also be
// at least three words, so it has to say something.
const ALLOW_RE = new RegExp(
  `//\\s*defect-detector:allow\\s+(${ACTIONABLE.join('|')})\\s+[—-]\\s+(\\S+(?:\\s+\\S+){2,})`,
);

function allowedAt(lines, i, category) {
  for (let k = i - 1; k >= 0 && k >= i - 2; k--) {
    const m = (lines[k] || '').match(ALLOW_RE);
    if (m) return m[1] === category;
    if ((lines[k] || '').trim() !== '') return false;
  }
  return false;
}

function scan() {
  if (!fs.existsSync(TESTS_DIR)) return [];
  const findings = [];
  for (const file of fs.readdirSync(TESTS_DIR).filter((f) => f.endsWith('.ts'))) {
    const rel = path.join('tests', 'web', file);
    const lines = fs.readFileSync(path.join(TESTS_DIR, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (ONE_SHOT_RE.test(line) && /\bawait\b/.test(line)) {
        const cat = classifyCountLine(lines, i);
        if (ACTIONABLE.includes(cat) && !allowedAt(lines, i, cat)) {
          findings.push({ file: rel, line: i + 1, category: cat, text: line.trim() });
        }
      }
      const skipCat = classifySkipLine(line);
      if (skipCat && !allowedAt(lines, i, skipCat)) {
        findings.push({ file: rel, line: i + 1, category: skipCat, text: line.trim() });
      }
    });
  }
  return findings;
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) return { total: Number.MAX_SAFE_INTEGER };
  return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
}

function main() {
  const args = process.argv.slice(2);
  const findings = scan();
  const byCat = {};
  for (const f of findings) byCat[f.category] = (byCat[f.category] || 0) + 1;
  const total = findings.length;

  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify({ total, byCategory: byCat, findings }, null, 2) + '\n');
    return 0;
  }

  if (args.includes('--update-baseline')) {
    const prev = readBaseline();
    // A rising count is normally a regression and must be refused. The one
    // legitimate exception is the DETECTOR getting wider - it then reports
    // debt that was always there but invisible. That must be stated out loud,
    // never inferred, or "the detector improved" becomes the excuse that lets
    // real regressions through.
    const reasonArg = args.find((a) => a.startsWith('--detector-widened='));
    if (Number.isFinite(prev.total) && total > prev.total && !reasonArg) {
      console.error(`REFUSED: baseline ratchets DOWN only (have ${prev.total}, asked for ${total}).`);
      console.error('If the DETECTOR widened, re-run with --detector-widened="<what it now catches>".');
      return 1;
    }
    const byFile = {};
    for (const f of findings) byFile[f.file] = (byFile[f.file] || 0) + 1;
    fs.writeFileSync(BASELINE_FILE, JSON.stringify({
      total, byCategory: byCat, byFile,
      note: 'Ratchets DOWN only. Target is 0. See scripts/check-test-defects.js.',
      ...(reasonArg ? { detectorWidened: reasonArg.split('=').slice(1).join('=') } : {}),
      updated: new Date().toISOString().slice(0, 10),
    }, null, 2) + '\n');
    console.log(`Baseline updated: ${total}`);
    return 0;
  }

  if (args.includes('--list')) {
    for (const cat of ACTIONABLE) {
      const rows = findings.filter((f) => f.category === cat);
      if (!rows.length) continue;
      console.log(`\n=== ${cat} (${rows.length}) ===`);
      for (const r of rows) console.log(`${r.file}:${r.line}  ${r.text.slice(0, 110)}`);
    }
  }

  const baseline = readBaseline();
  console.log(`\nSilently-passing test defects: ${total}` +
    (Number.isFinite(baseline.total) ? ` (baseline ${baseline.total}, target 0)` : ''));
  for (const cat of ACTIONABLE) if (byCat[cat]) console.log(`  ${String(byCat[cat]).padStart(4)}  ${cat}`);

  if (Number.isFinite(baseline.total) && total > baseline.total) {
    console.error(`\nFAIL: regressed by ${total - baseline.total}. These tests report green without testing anything.`);
    console.error('Fix them, or run --list to see each site.');
    return 1;
  }
  if (total > 0) console.log('\n(at/below baseline — but the target is 0)');
  return 0;
}

process.exit(main());
