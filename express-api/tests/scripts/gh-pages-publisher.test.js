/**
 * SHY-0298 — every gh-pages writer shares ONE serialization queue.
 *
 * Three workflows push to the `gh-pages` branch via
 * `peaceiris/actions-gh-pages`, which clones `--depth=1`, commits and pushes
 * with NO retry. Before this story only `allure-report.yml` sat inside the
 * `gh-pages-deploy` concurrency group; the Kotlin report (pr-checks.yml) and
 * the Express report (test-backend.yml) were in per-branch and per-ref groups,
 * so they could interleave between clone and push and lose to
 * `! [rejected] … (fetch first)`. Documented at test-backend.yml:122-131 and
 * verified on PR #901.
 *
 * The serialization mechanism is MEASURED, not assumed: two probe workflows
 * claiming the same group — one declaring it at workflow level, one at job
 * level, in different workflows — ran strictly sequentially (B started 5s
 * after A ended). See the story's Notes for the timestamps.
 *
 * These pins therefore assert two things that must stay true together:
 *   (a) exactly ONE peaceiris invocation exists, inside the composite action;
 *   (b) every path that reaches it is inside the `gh-pages-deploy` group.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const REPO = path.join(__dirname, '../../..');
const WF_DIR = path.join(REPO, '.github/workflows');
const ACTIONS_DIR = path.join(REPO, '.github/actions');
const PUBLISH_ACTION = path.join(ACTIONS_DIR, 'publish-gh-pages/action.yml');

const GROUP = 'gh-pages-deploy';

const workflowFiles = () =>
  fs
    .readdirSync(WF_DIR)
    .filter((f) => f.endsWith('.yml'))
    .map((f) => path.join(WF_DIR, f));

const actionFiles = () =>
  fs
    .readdirSync(ACTIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(ACTIONS_DIR, d.name, 'action.yml'))
    .filter((p) => fs.existsSync(p));

// Count at the DEFINITION site. A bare substring search for
// `peaceiris/actions-gh-pages` scores test-backend.yml as 2, because one of its
// matches is a COMMENT explaining the race — the exact mistake this repo has a
// rule about. Anchoring on `uses:` counts invocations, not mentions.
// The `- ` prefix is optional because BOTH YAML step forms are legal and a
// future writer could use either:
//     - uses: peaceiris/...            (uses is the step's first key)
//     - name: Deploy
//       uses: peaceiris/...            (uses on its own line)
// An `^\s*uses:`-only pin misses the first form entirely — found by mutation:
// injecting a `- uses: peaceiris/...` step passed the count assertion.
// Written as string operations rather than one regex: `[ \t]*-?[ \t]*` puts two
// star-quantifiers either side of an optional atom, which sonarjs/slow-regex
// flags as ambiguous backtracking. Trim-then-strip is unambiguous and reads
// better anyway.
const usesPeaceiris = (line) => {
  const afterDash = line.trim().replace(/^- +/, '');
  if (!afterDash.startsWith('uses:')) return false;
  return afterDash.slice('uses:'.length).trim().startsWith('peaceiris/actions-gh-pages');
};

const invocationsIn = (file) =>
  fs.readFileSync(file, 'utf8').split('\n').filter(usesPeaceiris).length;

// Comments in this repo's workflows deliberately quote the very tokens the
// pins look for (they explain WHY a setting is what it is), so any assertion
// about behaviour must strip them first or it measures prose.
const stripComments = (text) =>
  text
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

const actionSteps = () =>
  yaml.load(fs.readFileSync(PUBLISH_ACTION, 'utf8'), { filename: PUBLISH_ACTION })?.runs?.steps ??
  [];

const peaceirisStep = () => {
  const step = actionSteps().find(
    (s) => typeof s?.uses === 'string' && s.uses.startsWith('peaceiris/actions-gh-pages'),
  );
  expect(step).toBeDefined();
  expect(step.with).toBeDefined();
  return step;
};

describe('SHY-0298 — exactly one gh-pages writer exists', () => {
  test('no workflow invokes peaceiris directly', () => {
    const offenders = workflowFiles()
      .map((f) => [path.basename(f), invocationsIn(f)])
      .filter(([, n]) => n > 0);
    expect(offenders).toEqual([]);
  });

  test('the ONE invocation lives in the publish-gh-pages composite action', () => {
    expect(fs.existsSync(PUBLISH_ACTION)).toBe(true);
    expect(invocationsIn(PUBLISH_ACTION)).toBe(1);
  });

  test('repo-wide there is exactly one invocation, counted at the definition site', () => {
    const total = [...workflowFiles(), ...actionFiles()].reduce((n, f) => n + invocationsIn(f), 0);
    expect(total).toBe(1);
  });

  test('the action preserves keep_files: false (the SHY-0128 invariant)', () => {
    // peaceiris cleans ONLY destination_dir before copying, so each deploy
    // replaces that suite/env's latest/ rather than stranding hashed files
    // forever. Sibling suites, the root landing page and CNAME live outside
    // destination_dir and must stay untouched.
    //
    // Read the PARSED input, not the file text. A `toMatch(/keep_files:\s*false/)`
    // pin PASSED the mutation that deleted the real setting, because it matched
    // the neighbouring COMMENT that explains it — measure at the definition
    // site, not by substring.
    const step = peaceirisStep();
    expect(step.with.keep_files).toBe(false);
    expect(step.with.force_orphan).toBeUndefined();
  });

  test('the dependabot guard lives in the action, so no caller can forget it', () => {
    // A dependabot-authored run holds a read-only GITHUB_TOKEN and cannot push.
    // Keeping the guard at each call site made it a thing to remember; in the
    // action it is structural.
    //
    // Anchored on the gate step's RUN body (code), not the whole file, so a
    // comment mentioning dependabot cannot satisfy it.
    const gate = actionSteps().find((s) => /HEAD_REF|head_ref/.test(JSON.stringify(s ?? {})));
    expect(gate).toBeDefined();
    expect(stripComments(gate.run ?? '')).toMatch(/dependabot\//);
  });

  test('the action refuses to publish an empty directory over a good report', () => {
    // keep_files:false CLEANS destination_dir first, so publishing an empty
    // directory deletes a good report and leaves nothing — silent data loss
    // that reads as a green run.
    const bodies = actionSteps()
      .map((s) => stripComments(s?.run ?? ''))
      .join('\n');
    expect(bodies).toMatch(/::error/);
    // It must actually TEST the directory, not merely mention it.
    expect(bodies).toMatch(/\[\s*!\s*-d\b|\bls -A\b/);
  });
});

// ── Serialization: every path to the writer is inside the one group ────────

const load = (file) => yaml.load(fs.readFileSync(file, 'utf8'), { filename: file });

/** Jobs (name → def) that reach the publish action, in a parsed workflow. */
const publishingJobs = (doc) =>
  Object.entries(doc?.jobs ?? {}).filter(([, def]) =>
    (def?.steps ?? []).some(
      (s) => typeof s?.uses === 'string' && s.uses.includes('publish-gh-pages'),
    ),
  );

const groupOf = (node) => node?.concurrency?.group ?? node?.concurrency;

describe('SHY-0298 — every publishing path is serialized on one queue', () => {
  test('every job that publishes is covered by the gh-pages-deploy group', () => {
    // Covered EITHER by its own job-level group OR by its workflow-level one —
    // the probe proved those two share a queue. Asserting "job-level only"
    // would wrongly fail allure-report.yml, which is already correct.
    const uncovered = [];
    for (const file of workflowFiles()) {
      const doc = load(file);
      const wfGroup = groupOf(doc);
      for (const [name, def] of publishingJobs(doc)) {
        if (wfGroup === GROUP) continue;
        if (groupOf(def) === GROUP) continue;
        uncovered.push(`${path.basename(file)}:${name}`);
      }
    }
    expect(uncovered).toEqual([]);
  });

  test('at least one workflow publishes — the sweep above cannot pass vacuously', () => {
    // Without this, deleting every publish step would make the previous test
    // pass with an empty list. A guard that cannot fail is decoration.
    const total = workflowFiles().reduce((n, f) => n + publishingJobs(load(f)).length, 0);
    expect(total).toBeGreaterThanOrEqual(3);
  });

  test('a publishing job never cancels in progress — queue, never drop a report', () => {
    for (const file of workflowFiles()) {
      const doc = load(file);
      for (const [name, def] of publishingJobs(doc)) {
        const node = groupOf(def) === GROUP ? def : doc;
        expect([`${path.basename(file)}:${name}`, node.concurrency['cancel-in-progress']]).toEqual([
          `${path.basename(file)}:${name}`,
          false,
        ]);
      }
    }
  });

  test('the publish group never sits on a job that runs the test suites', () => {
    // Serializing the PRODUCERS would queue ~15-min Build & Test and ~5-min
    // Test Backend across every PR. Only the seconds-long publish may queue.
    const TEST_MARKERS = /(npm (run )?test|gradlew.*[Tt]est|playwright test|jest)/;
    const offenders = [];
    for (const file of workflowFiles()) {
      const doc = load(file);
      for (const [name, def] of Object.entries(doc?.jobs ?? {})) {
        if (groupOf(def) !== GROUP) continue;
        const runs = (def.steps ?? []).map((s) => s?.run ?? '').join('\n');
        if (TEST_MARKERS.test(runs)) offenders.push(`${path.basename(file)}:${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ── The payoff: PR branches get their Express report back ──────────────────

describe('SHY-0298 — PR-branch Express reports are published again', () => {
  test('publishing is no longer restricted to the dev/prod report envs', () => {
    // The old mitigation was avoidance: skip the PR-branch deploy so the race
    // could not fire. That is the feature this story buys back, and it is the
    // only externally observable change — without it the fix is unverifiable.
    const doc = load(path.join(WF_DIR, 'test-backend.yml'));
    const jobs = publishingJobs(doc);
    expect(jobs.length).toBeGreaterThan(0);
    for (const [, def] of jobs) {
      const conds = [def.if ?? '', ...(def.steps ?? []).map((s) => s?.if ?? '')].join(' ');
      expect(conds).not.toMatch(/report_env\s*==\s*'(dev|prod)'/);
    }
  });

  test('the Express report still publishes under a per-env destination', () => {
    // Re-enabling PR publishing must not collapse pr/dev/prod onto one path.
    const src = fs.readFileSync(path.join(WF_DIR, 'test-backend.yml'), 'utf8');
    expect(src).toMatch(/destination-dir:\s*express\/\$\{\{\s*inputs\.report_env/);
  });
});
