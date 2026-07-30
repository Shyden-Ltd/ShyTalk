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
const { createRequire } = require('module');

const REPO = path.resolve(__dirname, '..');

// acorn lives in express-api's node_modules (declared there as a devDependency
// for exactly this). Resolved explicitly rather than assumed on the root path,
// so a missing install fails with a sentence instead of a stack trace.
let acorn;
try {
  acorn = createRequire(path.join(REPO, 'express-api', 'package.json'))('acorn');
} catch {
  console.error('FATAL: acorn is not installed. Run `npm ci` in express-api/.');
  console.error('       Without a parser this detector cannot inspect the Jest suites,');
  console.error('       and a gate that silently stops checking is the defect it hunts.');
  process.exit(2);
}
const BASELINE_FILE = path.join(__dirname, 'test-defects-baseline.json');

const ACTIONABLE = ['GUARD-IF', 'BARE-EXPECT', 'SKIP-COND', 'PARKED', 'NO-ASSERT', 'PARSE-FAIL'];

/**
 * The corpora this detector is responsible for, and what each one can
 * meaningfully be accused of.
 *
 * Until 2026-07-30 this scanned `tests/web/*.ts` NON-recursively, which meant
 * 419 Jest suites and 11 files in `tests/web` subdirectories were invisible to
 * a gate whose whole job is finding tests that pass without testing.
 *
 * `oneShotReads` is per-corpus on purpose. In Playwright a locator read
 * resolves ONCE, so feeding one straight to `expect` races the render — that
 * is the BARE-EXPECT defect. Jest has no retrying matcher at all, so
 * `expect(await x)` is simply how Jest is written; applying BARE-EXPECT there
 * would bury the real findings under hundreds of false positives.
 */
const CORPORA = [
  {
    label: 'playwright',
    dir: path.join(REPO, 'tests', 'web'),
    ext: '.ts',
    oneShotReads: true,
    astAnalysis: false,
  },
  {
    label: 'jest',
    dir: path.join(REPO, 'express-api', 'tests'),
    ext: '.test.js',
    oneShotReads: false,
    astAnalysis: true,
  },
];

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
  if (/^\s*(\}\s*else\s*)?if\s*\(/.test(line) || /\bif\s*\(\s*\(?await/.test(line))
    return 'GUARD-IF';
  if (new RegExp(`expect\\s*\\(\\s*await[^;]*${ONE_SHOT_RE.source}`).test(line))
    return 'BARE-EXPECT';

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
  // `todo` is included deliberately. It is the HONEST marker for "spec exists,
  // implementation does not" — far better than an empty body that reports as a
  // pass — but it must still be counted, or the debt could be cleared simply by
  // rewriting every empty test as a todo. Honest and invisible are different
  // things, and only the first is acceptable.
  const m = line.match(/\b(?:test|it|this)\.(skip|fixme|todo)\s*\(/);
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

/** Every file under `dir` whose name ends in `ext`, recursively. */
function walk(dir, ext, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walk(full, ext, out);
    } else if (entry.name.endsWith(ext)) {
      out.push(full);
    }
  }
  return out;
}

/** Strip strings and line comments so their braces and keywords do not count. */
function stripNoise(line) {
  return line
    .replace(/\\./g, '')
    .replace(/'[^']*'|"[^"]*"|`[^`]*`/g, "''")
    .replace(/\/\/.*$/, '');
}

/**
 * Blank out /* … *\/ comment bodies while preserving every newline, so line
 * numbers stay truthful. Without this the prose in a file header ("A. Workflow
 * env exposes…") was parsed as code and reported as a defective test.
 */
function stripBlockComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

// The lookbehind is load-bearing: `\b(?:test|it)\s*\(` also matches the `test(`
// inside `/^[a-z]/.test(name)`, so without it every regex predicate in the
// suite was reported as a test that asserts nothing. A test call is never a
// member access, so anything preceded by `.` or a word character is not one.
/**
 * This suite's real assertion vocabulary. `expect` dominates (23,609 calls),
 * but the Firestore-rules suites assert exclusively through
 * assertSucceeds/assertFails (126 calls) — counting only `expect` reported
 * every one of those tests as asserting nothing.
 */
const ASSERT_IDENTS = new Set(['expect', 'assertSucceeds', 'assertFails']);
const TEST_IDENTS = new Set(['test', 'it']);
/** Runs the body conditionally, so an assertion inside may never execute. */
const PARKED_MEMBERS = new Set(['skip', 'todo', 'fixme', 'failing']);

function isAssertCall(node, assertingHelpers = new Set()) {
  if (node.type !== 'CallExpression') return false;
  const c = node.callee;
  if (c.type === 'Identifier') return ASSERT_IDENTS.has(c.name) || assertingHelpers.has(c.name);
  if (c.type !== 'MemberExpression') return false;
  // expect.assertions(n) / expect.hasAssertions()
  if (c.object.type === 'Identifier' && c.object.name === 'expect') return true;
  // supertest: `await probeAs(caller).expect(200)` — the `.expect(...)` at the
  // end of a request chain IS the assertion, and hundreds of route tests
  // assert only that way.
  return c.property.type === 'Identifier' && c.property.name === 'expect';
}

/**
 * Names of same-file functions that assert, computed to a fixpoint so a helper
 * calling a helper still counts. Tests here routinely delegate — `expectDenied
 * (req)`, `assertBanned(user)` — and counting only literal `expect` inside the
 * test body reported every one of those as asserting nothing.
 */
function collectAssertingHelpers(ast) {
  const bodies = new Map();
  walkAst(ast, false, (node) => {
    if (node.type === 'FunctionDeclaration' && node.id) bodies.set(node.id.name, node);
    if (
      node.type === 'VariableDeclarator' &&
      node.id.type === 'Identifier' &&
      node.init &&
      /Function/.test(node.init.type)
    ) {
      bodies.set(node.id.name, node.init);
    }
  });

  const asserting = new Set();
  let grew = true;
  while (grew) {
    grew = false;
    for (const [name, fn] of bodies) {
      if (asserting.has(name)) continue;
      let found = false;
      walkAst(fn.body, false, (n) => {
        if (found) return;
        if (isAssertCall(n, asserting)) found = true;
      });
      if (found) {
        asserting.add(name);
        grew = true;
      }
    }
  }
  return asserting;
}

/** `test(...)`, `it(...)`, `test.only(...)` — but not `test.skip(...)`. */
function testCallName(node) {
  if (node.type !== 'CallExpression') return null;
  const c = node.callee;
  if (c.type === 'Identifier' && TEST_IDENTS.has(c.name)) return c.name;
  if (
    c.type === 'MemberExpression' &&
    c.object.type === 'Identifier' &&
    TEST_IDENTS.has(c.object.name) &&
    c.property.type === 'Identifier' &&
    !PARKED_MEMBERS.has(c.property.name)
  ) {
    return c.object.name;
  }
  return null;
}

/**
 * Edges that make everything below them conditional.
 *
 * Loops are deliberately absent: iterating a fixture array is the idiomatic
 * shape throughout this suite, so treating every loop body as a silent skip
 * would drown the real findings. An assertion that only runs when a runtime
 * collection is non-empty is a narrower defect deserving its own pass.
 */
function isConditionalEdge(node, key) {
  switch (node.type) {
    case 'IfStatement':
    case 'ConditionalExpression':
      return key === 'consequent' || key === 'alternate';
    case 'TryStatement': {
      if (key !== 'handler') return false;
      // `try { await mustThrow(); throw new Error('expected it to throw') }
      //  catch (e) { expect(e.status).toBe(400) }`
      // is the deliberate must-throw idiom. The catch is guaranteed to run or
      // the test fails on the throw, so its assertions are not optional.
      const stmts = node.block.body;
      const last = stmts[stmts.length - 1];
      return !(last && last.type === 'ThrowStatement');
    }
    case 'LogicalExpression':
      return key === 'right';
    case 'SwitchCase':
      return key === 'consequent';
    default:
      return false;
  }
}

const SKIP_KEYS = new Set(['type', 'start', 'end', 'loc', 'range', 'raw']);

function walkAst(node, cond, visit) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, cond);
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const val = node[key];
    const childCond = cond || isConditionalEdge(node, key);
    if (Array.isArray(val)) {
      for (const c of val) walkAst(c, childCond, visit);
    } else if (val && typeof val.type === 'string') {
      walkAst(val, childCond, visit);
    }
  }
}

/**
 * A Jest test that cannot fail, judged from the parsed body rather than from
 * line shapes:
 *
 *   NO-ASSERT — no assertion anywhere in the body, so it passes as long as
 *               nothing throws.
 *   GUARD-IF  — every assertion sits under an if/ternary/catch/&&, so a falsy
 *               condition means the test asserts nothing and still passes.
 *
 * One unconditional assertion is enough to clear a body: the conditional ones
 * are then extra coverage rather than the only coverage.
 *
 * Parsing, not pattern-matching, because the regex version counted the braces
 * inside `/\$\{[^}]*\}/` as real braces and lost the end of the test body —
 * reporting tests that assert plainly as asserting nothing.
 */
function scanJestAst(src, rel, findings) {
  let ast = null;
  let parseError = null;
  for (const sourceType of ['script', 'module']) {
    try {
      ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType, locations: true });
      parseError = null;
      break;
    } catch (e) {
      parseError = e;
    }
  }
  if (!ast) {
    // Never silent: a file the detector cannot parse is a file it cannot
    // vouch for, which is exactly the blind spot this tool exists to remove.
    findings.push({
      file: rel,
      line: parseError?.loc?.line ?? 1,
      category: 'PARSE-FAIL',
      text: `detector could not parse this file: ${parseError?.message ?? 'unknown error'}`,
    });
    return;
  }

  const assertingHelpers = collectAssertingHelpers(ast);

  walkAst(ast, false, (node) => {
    if (!testCallName(node)) return;
    const body = [...node.arguments].reverse().find((a) => /Function/.test(a.type));
    if (!body) return;
    let asserts = 0;
    let guarded = 0;
    walkAst(body.body, false, (inner, cond) => {
      // A `throw` is an assertion too — it is how you fail a test without a
      // matcher. `if (idx === -1) { expect(idx).toBe(-1); return; } throw
      // new Error(...)` guards its only expect, but the fall-through path
      // throws, so the test cannot pass while proving nothing.
      const asserted = isAssertCall(inner, assertingHelpers) || inner.type === 'ThrowStatement';
      if (!asserted) return;
      asserts++;
      if (cond) guarded++;
    });
    let category = null;
    if (asserts === 0) category = 'NO-ASSERT';
    else if (guarded === asserts) category = 'GUARD-IF';
    if (category) {
      findings.push({
        file: rel,
        line: node.loc.start.line,
        category,
        text: (src.split('\n')[node.loc.start.line - 1] || '').trim(),
      });
    }
  });
}

function scan() {
  const findings = [];
  for (const corpus of CORPORA) {
    for (const full of walk(corpus.dir, corpus.ext)) {
      const rel = path.relative(REPO, full);
      const src = fs.readFileSync(full, 'utf8');
      const lines = stripBlockComments(src).split('\n');
      lines.forEach((line, i) => {
        if (corpus.oneShotReads && ONE_SHOT_RE.test(line) && /\bawait\b/.test(line)) {
          const cat = classifyCountLine(lines, i);
          if (ACTIONABLE.includes(cat) && !allowedAt(lines, i, cat)) {
            findings.push({ file: rel, line: i + 1, category: cat, text: line.trim() });
          }
        }
        // stripNoise first: a `test.skip('x')` written INSIDE a string literal
        // is a fixture, not a parked test — the detector's own test file is
        // full of them. Stripping preserves real detection, because a real
        // `test.skip('title', …)` still reads as `test.skip('', …)` and the
        // leading-quote check that distinguishes PARKED from SKIP-COND holds.
        const skipCat = classifySkipLine(stripNoise(line));
        if (skipCat && !allowedAt(lines, i, skipCat)) {
          findings.push({ file: rel, line: i + 1, category: skipCat, text: line.trim() });
        }
      });
      if (corpus.astAnalysis) {
        const before = findings.length;
        scanJestAst(src, rel, findings);
        // Honour the same reasoned escape hatch the line scanners use.
        for (let k = findings.length - 1; k >= before; k--) {
          if (allowedAt(lines, findings[k].line - 1, findings[k].category)) findings.splice(k, 1);
        }
      }
    }
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
      console.error(
        `REFUSED: baseline ratchets DOWN only (have ${prev.total}, asked for ${total}).`,
      );
      console.error(
        'If the DETECTOR widened, re-run with --detector-widened="<what it now catches>".',
      );
      return 1;
    }
    const byFile = {};
    for (const f of findings) byFile[f.file] = (byFile[f.file] || 0) + 1;
    fs.writeFileSync(
      BASELINE_FILE,
      JSON.stringify(
        {
          total,
          byCategory: byCat,
          byFile,
          note: 'Ratchets DOWN only. Target is 0. See scripts/check-test-defects.js.',
          ...(reasonArg ? { detectorWidened: reasonArg.split('=').slice(1).join('=') } : {}),
          updated: new Date().toISOString().slice(0, 10),
        },
        null,
        2,
      ) + '\n',
    );
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
  console.log(
    `\nSilently-passing test defects: ${total}` +
      (Number.isFinite(baseline.total) ? ` (baseline ${baseline.total}, target 0)` : ''),
  );
  for (const cat of ACTIONABLE)
    if (byCat[cat]) console.log(`  ${String(byCat[cat]).padStart(4)}  ${cat}`);

  if (Number.isFinite(baseline.total) && total > baseline.total) {
    console.error(
      `\nFAIL: regressed by ${total - baseline.total}. These tests report green without testing anything.`,
    );
    console.error('Fix them, or run --list to see each site.');
    return 1;
  }
  if (total > 0) console.log('\n(at/below baseline — but the target is 0)');
  return 0;
}

/**
 * Analyse one Jest source string. Exported so the detector's own tests can
 * drive it directly — a gate whose correctness nothing verifies is the same
 * failure mode it exists to catch, and this one shipped four distinct classes
 * of false positive before anyone looked at what it was reporting.
 */
function scanJestSource(src, rel = 'fixture.test.js') {
  const findings = [];
  scanJestAst(src, rel, findings);
  return findings;
}

module.exports = { scanJestSource, classifySkipLine, classifyCountLine, ACTIONABLE };

if (require.main === module) process.exit(main());
