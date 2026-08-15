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
    //
    // Coverage is resolved the SAME way as the sweep above — job group OR
    // workflow group. An earlier version checked `groupOf(def) !== GROUP` and
    // skipped every workflow-level holder, which excluded the one job that
    // actually holds the lock for a long time (allure-report.yml's
    // generate-report). Adding `npm test` to it left the suite green.
    const TEST_MARKERS = /(npm (run )?test|gradlew.*[Tt]est|playwright test|jest)/;
    const offenders = [];
    for (const file of workflowFiles()) {
      const doc = load(file);
      const wfCovered = groupOf(doc) === GROUP;
      for (const [name, def] of Object.entries(doc?.jobs ?? {})) {
        if (!wfCovered && groupOf(def) !== GROUP) continue;
        // Scan `uses:` too — a producer that runs its suite through a local
        // composite action has no `run:` for the markers to match.
        const body = (def.steps ?? []).map((s) => `${s?.run ?? ''}\n${s?.uses ?? ''}`).join('\n');
        if (TEST_MARKERS.test(body)) offenders.push(`${path.basename(file)}:${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('no job re-declares the group its own workflow already holds (self-deadlock)', () => {
    // allure-report.yml holds `gh-pages-deploy` at WORKFLOW level. A job inside
    // it that also declared the group would wait on a lock its own run holds,
    // and every allure run would hang to its 20-minute timeout. The workflow
    // documents this hazard; nothing enforced it, and adding such a job left
    // the whole suite green.
    const offenders = [];
    for (const file of workflowFiles()) {
      const doc = load(file);
      if (groupOf(doc) !== GROUP) continue;
      for (const [name, def] of Object.entries(doc?.jobs ?? {})) {
        if (groupOf(def) === GROUP) offenders.push(`${path.basename(file)}:${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ── The action's own gating and refusal must be real, not merely present ───

describe('SHY-0298 — the composite action gates every side-effecting step', () => {
  test('every step after the gate is conditioned on it', () => {
    // Deleting the `if:` from the deploy step made a dependabot run attempt a
    // push with a read-only token; the suite stayed green because the pin only
    // looked for the STRING `dependabot/` somewhere in the file.
    const steps = actionSteps();
    const gateIdx = steps.findIndex((s) => s?.id === 'gate');
    expect(gateIdx).toBe(0);
    const rest = steps.slice(gateIdx + 1);
    expect(rest.length).toBeGreaterThanOrEqual(3);
    for (const s of rest) {
      expect(String(s?.if ?? '')).toMatch(/steps\.gate\.outputs\.skip\s*==\s*'false'/);
    }
  });

  test('the gate writes skip=true on the dependabot branch, not merely mentions it', () => {
    // Flipping the then-branch to `skip=false` left the literal `dependabot/`
    // in the neighbouring echo, so a string pin could not tell the difference.
    const gate = actionSteps().find((s) => s?.id === 'gate');
    const body = stripComments(gate?.run ?? '');
    const thenBranch = body.slice(body.indexOf('dependabot/'), body.indexOf('else'));
    expect(thenBranch).toMatch(/skip=true/);
    expect(thenBranch).not.toMatch(/skip=false/);
  });

  test('EVERY refusal in the action actually fails the step', () => {
    // Checked per-guard, not once per body. A `toMatch(/exit 1/)` over the
    // whole step passed the `exit 1`→`exit 0` mutation as soon as a SECOND
    // guard existed in the same body: the other guard's `exit 1` satisfied it.
    // Walk from each `::error` to its closing `fi` instead.
    const guards = [];
    for (const step of actionSteps()) {
      const lines = stripComments(step?.run ?? '').split('\n');
      lines.forEach((line, i) => {
        if (!line.includes('::error')) return;
        const end = lines.findIndex((l, j) => j > i && /^\s*fi\b/.test(l));
        expect(end).toBeGreaterThan(i);
        guards.push(lines.slice(i, end).join('\n'));
      });
    }
    // Necessity: without this the loop above proves nothing if the guards are
    // deleted wholesale.
    expect(guards.length).toBeGreaterThanOrEqual(2);
    for (const g of guards) {
      expect(g).toMatch(/exit 1/);
      expect(g).not.toMatch(/exit 0/);
    }
  });

  test('"non-empty" is not enough — a one-file stub must be refused too', () => {
    // Both producers write metadata.json unconditionally and copy the real
    // report with `|| true`, so a suite that dies early leaves EXACTLY ONE
    // file. keep_files:false would wipe a good report and publish the stub.
    const bodies = actionSteps()
      .map((s) => stripComments(s?.run ?? ''))
      .join('\n');
    expect(bodies).toMatch(/-f\s+"\$PUBLISH_DIR\/index\.html"/);
  });

  test('a skipped publish says so where it is visible, not only on stderr', () => {
    // A green check that published nothing, with the reason on stderr, is the
    // absence-reported-as-success shape this story exists to remove.
    const gate = actionSteps().find((s) => s?.id === 'gate');
    expect(stripComments(gate?.run ?? '')).toMatch(/::notice/);
  });
});

describe('SHY-0298 — the artifact hand-off names match on both sides', () => {
  test.each([
    ['pr-checks.yml', 'kotlin-report-pages'],
    ['test-backend.yml', 'express-report-pages'],
  ])('%s uploads and downloads the same artifact name', (file, stem) => {
    // Renaming one side leaves every publish job permanently red, and nothing
    // pinned the pairing.
    const doc = load(path.join(WF_DIR, file));
    const names = [];
    for (const [, def] of Object.entries(doc?.jobs ?? {})) {
      for (const s of def?.steps ?? []) {
        if (typeof s?.uses !== 'string') continue;
        if (/actions\/(upload|download)-artifact/.test(s.uses))
          names.push(String(s.with?.name ?? ''));
      }
    }
    const matching = names.filter((n) => n.startsWith(stem));
    expect(matching.length).toBe(2);
    expect(matching[0]).toBe(matching[1]);
  });
});

// ── Gating: when a publish job must NOT run ────────────────────────────────
//
// Both findings below came from review, and neither could have been caught by
// this PR's own CI: it touches `express-api/tests/**`, which forces
// `android_app_changed=true`, so `build-and-test` runs and the artifact exists.
// The defects only appear on PRs that take the OTHER path.

describe('SHY-0298 — a publish job runs only when there is something to publish', () => {
  const publishJobsOf = (file) => publishingJobs(load(path.join(WF_DIR, file)));

  test.each([
    ['pr-checks.yml', 'build-and-test'],
    ['test-backend.yml', 'test-backend'],
  ])('%s: the publish job does not run when %s was SKIPPED', (file, producer) => {
    // `needs: X` + `if: always()` STILL RUNS when X is skipped — that is the
    // documented semantic, and the reason sibling jobs in pr-checks.yml spell
    // out `(needs.X.result == 'success' || needs.X.result == 'skipped')`.
    // `build-and-test` is conditional on `android_app_changed == 'true'`, so a
    // markdown-only PR (every `In Review` status flip is one) skips it, leaves
    // no artifact, and `download-artifact` with an explicit `name:` FAILS —
    // turning a clean PR red and blocking pre-merge-check.sh's blanket
    // `gh pr checks`.
    for (const [, def] of publishJobsOf(file)) {
      const cond = String(def.if ?? '');
      expect(cond).toMatch(new RegExp(`needs\\.${producer}\\.result`));
      expect(cond).toMatch(/!=\s*'skipped'|==\s*'success'/);
    }
  });

  test.each(['pr-checks.yml', 'test-backend.yml'])(
    '%s: the publish job does not run on a CANCELLED run',
    (file) => {
      // `always()` returns true even when the run is cancelled — that is why
      // `!cancelled()` exists. Both these workflows sit under
      // `cancel-in-progress: true`, so a routine new push cancels the producer
      // mid-flight. Its `if: always()` upload step still fires, so the artifact
      // can hold a HALF-FINISHED report — and `keep_files: false` wipes the
      // good report before copying it. Silent data loss, reported green.
      for (const [, def] of publishJobsOf(file)) {
        const cond = String(def.if ?? '');
        expect(cond).toMatch(/!\s*cancelled\(\)/);
        expect(cond).not.toMatch(/(^|[^!])\balways\(\)/);
      }
    },
  );
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
