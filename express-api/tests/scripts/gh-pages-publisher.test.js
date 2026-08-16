/**
 * SHY-0298 — concurrent gh-pages writers are made SAFE, not prevented.
 *
 * Three workflows publish to the `gh-pages` branch. `peaceiris/actions-gh-pages`
 * clones `--depth=1`, commits and pushes with NO retry, so two writers that
 * interleave between clone and push leave the loser with
 * `! [rejected] … (fetch first)` — verified on PR #901.
 *
 * The first attempt at this story serialized every writer on one
 * `gh-pages-deploy` concurrency group. Review found that to be WRONG, and the
 * repo had already lived the failure: a concurrency group holds exactly ONE
 * pending entry, so a third contender CANCELS the pending second
 * (`scripts/check-workflow-concurrency-scoping.sh`, incidents #568/#570). A
 * single backend PR run has three contenders, and a cancelled
 * `publish-express-report` propagates through the `test-backend` reusable
 * workflow into `PR Gate` — a REQUIRED check. The lock would have red-gated
 * innocent PRs at PR frequency. Per-destination groups do not help either: the
 * race is on the BRANCH, a single git ref.
 *
 * So the vendor action is replaced by an owned push that RETRIES against the
 * moving tip, and the lock is removed everywhere. Because each publish is a
 * whole-directory replacement, a retry needs no rebase — re-read the tip and
 * re-apply.
 *
 * These pins assert that both halves stay true: no lock anywhere, and a push
 * that genuinely loses gracefully to a concurrent writer.
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

describe('SHY-0298 — one owned writer, no vendor action', () => {
  test('the publish action exists and is the only publishing entry point', () => {
    expect(fs.existsSync(PUBLISH_ACTION)).toBe(true);
  });

  test('peaceiris is gone repo-wide — it cannot retry, and a uses: step cannot be retried', () => {
    // Counted at the DEFINITION site. A bare substring search over
    // test-backend.yml scores 2, because one match is a COMMENT explaining the
    // race — the exact mistake this repo has a rule about.
    const total = [...workflowFiles(), ...actionFiles()].reduce((n, f) => n + invocationsIn(f), 0);
    expect(total).toBe(0);
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

// ── C3: the lock is GONE; concurrent pushes are made safe instead ──────────
//
// Review found the design error: a concurrency group holds exactly ONE pending
// entry, so a third contender CANCELS the pending second (this repo's own
// incident #568/#570, documented in check-workflow-concurrency-scoping.sh).
// After serializing three writers, a single backend PR run had three
// contenders — and a cancelled `publish-express-report` propagates through the
// `test-backend` reusable workflow into `PR Gate`, a REQUIRED check. The lock
// would have red-gated innocent PRs at PR frequency.
//
// A lock cannot be made safe here (per-destination groups do not help: the race
// is on the BRANCH, one git ref). So the push itself is made concurrency-safe
// and the group is removed everywhere.

describe('SHY-0298 — the gh-pages-deploy lock is gone', () => {
  test('no workflow or job anywhere still claims the group', () => {
    const holders = [];
    for (const file of workflowFiles()) {
      const doc = load(file);
      if (groupOf(doc) === GROUP) holders.push(`${path.basename(file)}:<workflow>`);
      for (const [name, def] of Object.entries(doc?.jobs ?? {})) {
        if (groupOf(def) === GROUP) holders.push(`${path.basename(file)}:${name}`);
      }
    }
    expect(holders).toEqual([]);
  });

  test('at least three jobs publish — the lock sweep above cannot pass vacuously', () => {
    // Without this, deleting every publish path would make "no job claims the
    // group" pass trivially. A guard that cannot fail is decoration.
    const total = workflowFiles().reduce((n, f) => n + publishingJobs(load(f)).length, 0);
    expect(total).toBeGreaterThanOrEqual(3);
  });

  test('the publish action retries its push instead of relying on a lock', () => {
    // peaceiris does NOT retry, and a `uses:` step cannot be retried, which is
    // why the vendor action was replaced with an owned push.
    const bodies = actionSteps()
      .map((s) => stripComments(s?.run ?? ''))
      .join('\n');
    expect(bodies).toMatch(/for\s+attempt\b|while\b.*attempt|seq\s+1\s+\$\{?MAX/i);
    expect(bodies).toMatch(/git push/);
  });

  test('a retry re-reads the remote tip rather than force-pushing over it', () => {
    // The whole point is to LOSE gracefully to a concurrent writer and redo the
    // work on their tip. A force push would silently discard their report.
    const bodies = actionSteps()
      .map((s) => stripComments(s?.run ?? ''))
      .join('\n');
    expect(bodies).toMatch(/git fetch/);
    // Line-based rather than one alternation of `.*` runs — `push\s+.*--force`
    // style patterns trip sonarjs/slow-regex on backtracking.
    const pushLines = bodies.split('\n').filter((l) => l.includes('git push'));
    expect(pushLines.length).toBeGreaterThan(0);
    for (const l of pushLines) {
      expect(l).not.toContain('--force');
      expect(l).not.toContain('+refs');
    }
  });

  test('only the destination directory is replaced, never the whole branch', () => {
    // The SHY-0128 invariant, now enforced on our own push rather than on
    // peaceiris' keep_files flag: sibling suites, the root landing page and
    // CNAME live outside destination_dir and must survive.
    const bodies = actionSteps()
      .map((s) => stripComments(s?.run ?? ''))
      .join('\n');
    expect(bodies).toMatch(/rm -rf\s+"?\$\{?DESTINATION_DIR|rm -rf\s+"\$TARGET/);
    expect(bodies).not.toMatch(/git checkout --orphan\b.*\n.*rm -rf \.\s*$/m);
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
        // A refusal ends at its enclosing `fi`/`done`, or at the end of the
        // script when it is the terminal failure of a retry loop. Assuming
        // `fi` only was wrong once the retry-exhausted error was added after a
        // `done` — the walker found no terminator and silently produced -1.
        let end = lines.findIndex((l, j) => j > i && /^\s*(fi|done)\b/.test(l));
        if (end === -1) end = lines.length;
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

describe('a publish failure must not red-gate the PR (SHY-0298 Error-paths AC)', () => {
  const readWf = (name) => fs.readFileSync(path.join(WF_DIR, name), 'utf8');

  test('the express publish cannot fail the reusable workflow it lives in', () => {
    // `publish-express-report` is a job INSIDE test-backend.yml, and a
    // reusable workflow's conclusion is the aggregate of its jobs — so
    // without this, a green backend suite whose coverage HTML failed to
    // publish made the caller's `test-backend` job `failure`. That job is in
    // PR Gate's `needs`, so a missing report blocked the merge with no test
    // failure behind it.
    const doc = yaml.load(readWf('test-backend.yml'));
    expect(doc.jobs['publish-express-report']['continue-on-error']).toBe(true);
  });

  test('the backend SUITE itself still gates', () => {
    // The other half: making the publish non-gating must not make the tests
    // non-gating.
    const doc = yaml.load(readWf('pr-checks.yml'));
    expect(doc.jobs.gate.needs).toContain('test-backend');
    expect(doc.jobs['test-backend']['continue-on-error']).toBeUndefined();
  });

  test('no OTHER job inside the gated reusable workflow is allowed to fail silently', () => {
    // `continue-on-error` is a sharp tool: it is right for a report and wrong
    // for a test. Anything else in this workflow acquiring it should be a
    // deliberate decision, not a copy-paste.
    const doc = yaml.load(readWf('test-backend.yml'));
    const lenient = Object.entries(doc.jobs)
      .filter(([, j]) => j['continue-on-error'] === true)
      .map(([name]) => name);
    expect(lenient).toEqual(['publish-express-report']);
  });
});
