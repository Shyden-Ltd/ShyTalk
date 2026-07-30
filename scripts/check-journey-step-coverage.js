#!/usr/bin/env node
/**
 * check-journey-step-coverage.js — SHY-0259
 *
 * Fails when the journey corpus asks for a Gherkin step that no matcher can
 * execute.
 *
 * WHY THIS EXISTS
 * ---------------
 * The corpus was written ahead of its drivers. Steps with no matcher fail at
 * runtime as STEP_NOT_IMPLEMENTED, which looks exactly like a product failure
 * in the matrix report — so a red cell could not be attributed without opening
 * a screenshot, and 94 step occurrences were structurally unable to pass no
 * matter how healthy the product was.
 *
 * Finding that out cost a four-hour device matrix. This check answers the same
 * question in under a second, with no device, no stack and no browser, so it
 * can gate a PR instead of a gauntlet.
 *
 * HOW IT DECIDES
 * --------------
 * It resolves every step against `manual-qa-runner.js`'s OWN exported matcher
 * table, using the runner's OWN annotation-stripper. It is deliberately not a
 * re-implementation: a gate with a private idea of what runs is worse than no
 * gate, because it is confidently wrong.
 *
 * Ratchets DOWN only, like scripts/check-test-defects.js. Target is 0.
 */
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const CORPUS_DIR = path.join(REPO, 'journey-tests');
const BASELINE_FILE = path.join(__dirname, 'journey-step-coverage-baseline.json');

const runner = require(path.join(REPO, 'express-api', 'scripts', 'manual-qa-runner.js'));
const { parseGherkin, stripStepAnnotation, matchers: RUNNER_MATCHERS } = runner;

/**
 * `{placeholder}` tokens resolve from ctx.scenarioVars at runtime, so their
 * value is unknowable statically. Encoding one caller's value would make the
 * gate depend on a number it invented; instead it sweeps a small class of
 * shapes a matcher might expect and treats the step as covered if ANY of them
 * resolves. Erring toward "covered" is the right direction for a CI gate:
 * a false positive blocks every run on nothing.
 */
const PROBE_VALUES = ['1', 'probe', '50000001', '"probe"'];

const PLACEHOLDER_RE = /\{(\w+)\}/g;

/** Does any matcher accept this step text? Mirrors executeStep's resolution. */
function isStepCovered(rawText, matcherTable = RUNNER_MATCHERS) {
  const text = stripStepAnnotation(rawText);
  const candidates = [text];
  if (PLACEHOLDER_RE.test(text)) {
    PLACEHOLDER_RE.lastIndex = 0;
    for (const probe of PROBE_VALUES) {
      candidates.push(text.replace(PLACEHOLDER_RE, probe));
    }
  }
  PLACEHOLDER_RE.lastIndex = 0;
  return candidates.some((c) => matcherTable.some(({ pattern }) => pattern.test(c)));
}

/**
 * Walk every .feature file and resolve every step.
 *
 * `emptyCorpus` is reported explicitly rather than inferred from `total === 0`
 * by the caller: "nothing to scan" and "nothing wrong" must not be the same
 * signal, or a mistyped --dir greens the gate (SHY-0255, same class of bug).
 */
function scanCorpus({ dir = CORPUS_DIR, matchers = RUNNER_MATCHERS } = {}) {
  const files = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.feature'))
        .sort()
    : [];

  const gaps = new Map();
  let total = 0;

  for (const file of files) {
    const parsed = parseGherkin(fs.readFileSync(path.join(dir, file), 'utf8'));
    const steps = [
      ...(parsed.background ? parsed.background.steps : []),
      ...parsed.scenarios.flatMap((s) => s.steps),
    ];
    for (const step of steps) {
      total += 1;
      if (isStepCovered(step.text, matchers)) continue;
      const text = stripStepAnnotation(step.text);
      const key = `${step.kind} ${text}`;
      let gap = gaps.get(key);
      if (!gap) {
        gap = { kind: step.kind, text, count: 0, files: new Set() };
        gaps.set(key, gap);
      }
      gap.count += 1;
      gap.files.add(file);
    }
  }

  const unmatched = [...gaps.values()]
    .map((g) => ({ ...g, files: [...g.files].sort() }))
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));

  return {
    filesScanned: files.length,
    total,
    emptyCorpus: total === 0,
    unmatched,
    unmatchedOccurrences: unmatched.reduce((n, g) => n + g.count, 0),
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
  if (report.emptyCorpus) return 1;
  if (!Number.isFinite(baseline.total)) return 0;
  return report.unmatched.length > baseline.total ? 1 : 0;
}

function main(argv = process.argv.slice(2)) {
  const report = scanCorpus();

  if (argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return verdict(report, readBaseline());
  }

  if (argv.includes('--update-baseline')) {
    const baseline = readBaseline();
    if (Number.isFinite(baseline.total) && report.unmatched.length > baseline.total) {
      console.error(
        `REFUSED: baseline ratchets DOWN only (${baseline.total} → ${report.unmatched.length}).`,
      );
      console.error('Implement the missing matchers; do not raise the bar to meet the corpus.');
      return 1;
    }
    fs.writeFileSync(
      BASELINE_FILE,
      JSON.stringify(
        {
          total: report.unmatched.length,
          occurrences: report.unmatchedOccurrences,
          note: 'Distinct Gherkin steps with no matcher. Ratchets DOWN only. Target is 0.',
          updated: new Date().toISOString().slice(0, 10),
        },
        null,
        2,
      ) + '\n',
    );
    console.log(`Baseline updated: ${report.unmatched.length}`);
    return 0;
  }

  if (report.emptyCorpus) {
    console.error(`FAIL: no journey steps found under ${CORPUS_DIR} — nothing was checked.`);
    return 1;
  }

  if (argv.includes('--list')) {
    for (const g of report.unmatched) {
      console.log(`${String(g.count).padStart(3)}  ${g.kind} ${g.text}   [${g.files.join(', ')}]`);
    }
  }

  const baseline = readBaseline();
  console.log(
    `\nJourney steps with no matcher: ${report.unmatched.length} distinct ` +
      `(${report.unmatchedOccurrences} occurrences of ${report.total} steps ` +
      `across ${report.filesScanned} feature files)` +
      (Number.isFinite(baseline.total) ? `\nBaseline ${baseline.total}, target 0.` : ''),
  );

  const code = verdict(report, baseline);
  if (code !== 0) {
    console.error(
      `\nFAIL: regressed by ${report.unmatched.length - baseline.total}. ` +
        'These steps cannot execute — they fail as STEP_NOT_IMPLEMENTED and ' +
        'are indistinguishable from a product failure in the matrix report.',
    );
    console.error('Run with --list to see each one.');
  } else if (report.unmatched.length > 0) {
    console.log('(at/below baseline — but the target is 0; run --list to see the backlog)');
  }
  return code;
}

module.exports = { scanCorpus, isStepCovered, verdict, PROBE_VALUES, CORPUS_DIR };

if (require.main === module) process.exit(main());
