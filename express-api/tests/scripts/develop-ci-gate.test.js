/**
 * develop-ci-gate.test.js — SHY-0242.
 *
 * The git-flow pivot (SHY-0161) moved day-to-day merges to `develop` but never
 * wired CI to it, so `develop` PRs ran zero checks and nothing gated their
 * merge. SHY-0242 closes that: the PR-checks + CodeQL triggers now include
 * `develop`, Dependabot targets `develop`, and its auto-merge fires on `develop`
 * — so every develop PR (bot or human) gates on green, and safe dependency
 * bumps auto-merge exactly as they did on `main`.
 *
 * These pins lock the trigger/config invariants that make the gate real, so a
 * future edit that drops `develop` from a trigger (silently returning develop to
 * a no-CI branch) or forgets a `target-branch` goes RED here. The develop
 * ruleset that REQUIRES the three checks is a repository setting (not a file) —
 * verified out-of-band by `gh api` read-back, noted in the story, uncoverable by
 * a file test.
 *
 * House style: line-based parsing, no YAML dependency, ReDoS-safe list
 * extraction via indexOf (a `[^\]]*` capture trips sonarjs/slow-regex).
 */

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

// Split a single-line flow list `[a, b, c]` into trimmed, unquoted items. Pure
// string slicing — no variable-length regex.
function parseFlowList(line) {
  const open = line.indexOf('[');
  const close = line.indexOf(']', open + 1);
  if (open < 0 || close < 0) return [];
  return line
    .slice(open + 1, close)
    .split(',')
    .map((s) => s.trim().replace(/["']/g, ''))
    .filter(Boolean);
}

// Return the `branches: [ ... ]` list declared under `on.pull_request:` of a
// workflow. Line-based walk: find column-0 `on:`, then the 2-space
// `pull_request:` key (skipping a sibling `push:` block, as in codeql.yml), then
// the first 4-space `branches:` before the next 2-space sibling key. Returns []
// if any anchor is missing (a missing anchor fails the assertions loudly).
function onPullRequestBranches(yaml) {
  const lines = yaml.split('\n');
  const onIdx = lines.findIndex((l) => l === 'on:');
  if (onIdx < 0) return [];
  let prIdx = -1;
  for (let i = onIdx + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) break; // left column → out of the on: block
    if (/^ {2}pull_request:\s*$/.test(lines[i])) {
      prIdx = i;
      break;
    }
  }
  if (prIdx < 0) return [];
  for (let i = prIdx + 1; i < lines.length; i++) {
    if (/^ {2}\S/.test(lines[i]) || /^\S/.test(lines[i])) break; // next sibling / out of on:
    if (/^ {4}branches:\s*\[/.test(lines[i])) return parseFlowList(lines[i]);
  }
  return [];
}

// Split dependabot.yml into its per-ecosystem update blocks. Each block starts
// at a 2-space `- package-ecosystem:` list item and runs to the next one (or
// EOF). Returns { ecosystem, directory, text } per block.
function dependabotUpdateBlocks(yaml) {
  const lines = yaml.split('\n');
  const starts = [];
  lines.forEach((l, i) => {
    if (/^ {2}- package-ecosystem:/.test(l)) starts.push(i);
  });
  return starts.map((start, k) => {
    const end = k + 1 < starts.length ? starts[k + 1] : lines.length;
    const text = lines.slice(start, end).join('\n');
    const eco = (text.match(/package-ecosystem:\s*"([^"]+)"/) || [])[1] || '?';
    const dir = (text.match(/directory:\s*"([^"]+)"/) || [])[1] || '?';
    return { ecosystem: eco, directory: dir, text };
  });
}

// A 2-space job header `  <id>:` (id lowercase-led [a-z0-9_-]). The negated-class
// .test avoids the quantified-class-before-literal shape that trips
// sonarjs/slow-regex (mirrors pr-checks-device-e2e-deferred.test.js).
function isJobHeader(line) {
  if (!line.startsWith('  ') || line.startsWith('   ')) return false;
  if (!line.endsWith(':') || line.length < 4) return false;
  const name = line.slice(2, -1);
  return /^[a-z]/.test(name) && !/[^a-z0-9_-]/.test(name);
}

// Slice a workflow job's body: from its 2-space header to the next 2-space job
// header (or the next column-0 key / EOF). Used to assert a REQUIRED-context job
// carries no base_ref skip-gate.
function jobBody(yaml, jobId) {
  const lines = yaml.split('\n');
  const start = lines.findIndex((l) => l === `  ${jobId}:`);
  if (start < 0) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (isJobHeader(lines[i]) || /^\S/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

describe('SHY-0242: develop is CI-gated — PR-checks + CodeQL trigger on develop', () => {
  test('pr-checks.yml runs on pull requests into BOTH main and develop', () => {
    const branches = onPullRequestBranches(read('.github/workflows/pr-checks.yml'));
    expect(branches).toContain('main'); // main promotion PRs still gated
    expect(branches).toContain('develop'); // the new gate — was the whole gap
  });

  test('codeql.yml runs on pull requests into BOTH main and develop (source of the "Analyze JavaScript" required check)', () => {
    const branches = onPullRequestBranches(read('.github/workflows/codeql.yml'));
    expect(branches).toContain('main');
    expect(branches).toContain('develop');
  });

  test('branch-discipline-check.yml runs on develop PRs too (one-active-branch applies where work actually happens)', () => {
    const branches = onPullRequestBranches(read('.github/workflows/branch-discipline-check.yml'));
    expect(branches).toContain('main');
    expect(branches).toContain('develop');
  });
});

describe('SHY-0242: Dependabot targets develop and auto-merges there', () => {
  test('dependabot-auto-merge.yml triggers on pull requests into develop (not main)', () => {
    const branches = onPullRequestBranches(read('.github/workflows/dependabot-auto-merge.yml'));
    expect(branches).toContain('develop');
    // main is intentionally dropped: Dependabot no longer opens PRs into main,
    // so a lingering main trigger would be dead config.
    expect(branches).not.toContain('main');
  });

  describe('dependabot.yml sets target-branch: develop on every ecosystem', () => {
    const blocks = dependabotUpdateBlocks(read('.github/dependabot.yml'));

    test('all four ecosystems are present (gradle, express-api npm, root npm, github-actions)', () => {
      expect(blocks).toHaveLength(4);
      const ids = blocks.map((b) => `${b.ecosystem}:${b.directory}`);
      expect(ids).toEqual(
        expect.arrayContaining(['gradle:/', 'npm:/express-api', 'npm:/', 'github-actions:/']),
      );
    });

    // One assertion per block (not a single loop) so a single omission names the
    // exact ecosystem that is still pointed at the default branch.
    test.each(
      dependabotUpdateBlocks(read('.github/dependabot.yml')).map((b) => [
        `${b.ecosystem}:${b.directory}`,
        b.text,
      ]),
    )('%s declares target-branch: "develop"', (_id, text) => {
      expect(text).toMatch(/target-branch:\s*"develop"/);
    });
  });
});

describe('SHY-0242: the required-context jobs must REPORT on a develop PR (no base_ref skip-gate)', () => {
  // Once the develop ruleset requires "Detect Changes" / "PR Gate" / "Analyze
  // JavaScript" by name, a future `if: github.base_ref == 'main'` on one of these
  // jobs (mirroring the intentional device-E2E guards one job over) would make
  // the required check never report → every develop PR hangs forever. These pins
  // catch that regression — the exact failure mode this whole story prevents.
  const prChecks = read('.github/workflows/pr-checks.yml');
  const codeql = read('.github/workflows/codeql.yml');

  test('pr-checks "detect-changes" (→ Detect Changes) carries no base_ref skip-gate', () => {
    const body = jobBody(prChecks, 'detect-changes');
    expect(body).not.toBe('');
    expect(body).not.toMatch(/base_ref/);
  });

  test('pr-checks "gate" (→ PR Gate) runs if: always() and carries no base_ref skip-gate', () => {
    const body = jobBody(prChecks, 'gate');
    expect(body).toMatch(/if:\s*always\(\)/);
    expect(body).not.toMatch(/base_ref/);
  });

  test('codeql "analyze-javascript" (→ Analyze JavaScript) has no job-level if:/base_ref — a required scan must report on every develop PR', () => {
    const body = jobBody(codeql, 'analyze-javascript');
    expect(body).not.toBe('');
    expect(body).not.toMatch(/base_ref/);
    // no job-level (4-space) if:; the var-gated analyze-kotlin is a DIFFERENT,
    // non-required job and is correctly excluded from this body slice.
    expect(body).not.toMatch(/^ {4}if:/m);
  });

  test('the intentional base_ref guards REMAIN on the non-required device jobs (invariants not conflated)', () => {
    expect(jobBody(prChecks, 'android-e2e')).toMatch(/base_ref\s*==\s*'main'/);
    expect(jobBody(prChecks, 'ios-e2e')).toMatch(/base_ref\s*==\s*'main'/);
  });
});

describe('SHY-0242: parser helpers (synthetic input)', () => {
  test('onPullRequestBranches skips a sibling push: block (codeql shape)', () => {
    const yaml = [
      'on:',
      '  push:',
      '    branches: [main]',
      '  pull_request:',
      '    branches: [main, develop]',
      '  schedule:',
      "    - cron: '0 6 * * 1'",
      'jobs:',
    ].join('\n');
    expect(onPullRequestBranches(yaml)).toEqual(['main', 'develop']);
  });

  test('onPullRequestBranches returns [] when pull_request has no branches filter', () => {
    const yaml = ['on:', '  pull_request:', '    types: [opened]', 'jobs:'].join('\n');
    expect(onPullRequestBranches(yaml)).toEqual([]);
  });

  test('parseFlowList unquotes and trims', () => {
    expect(parseFlowList('    branches: ["main", develop]')).toEqual(['main', 'develop']);
  });

  test('dependabotUpdateBlocks isolates each ecosystem block', () => {
    const yaml = [
      'version: 2',
      'updates:',
      '  - package-ecosystem: "gradle"',
      '    directory: "/"',
      '    target-branch: "develop"',
      '  - package-ecosystem: "npm"',
      '    directory: "/express-api"',
      '    target-branch: "develop"',
    ].join('\n');
    const blocks = dependabotUpdateBlocks(yaml);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ ecosystem: 'gradle', directory: '/' });
    expect(blocks[1]).toMatchObject({ ecosystem: 'npm', directory: '/express-api' });
  });

  test('onPullRequestBranches returns [] when there is no on: block at all', () => {
    expect(onPullRequestBranches('jobs:\n  foo:\n    runs-on: x')).toEqual([]);
  });

  test('onPullRequestBranches returns [] for a push-only workflow (no pull_request sibling)', () => {
    const yaml = ['on:', '  push:', '    branches: [main]', 'jobs:'].join('\n');
    expect(onPullRequestBranches(yaml)).toEqual([]);
  });

  test('parseFlowList returns [] for a line with no bracket list', () => {
    expect(parseFlowList('    branches: main')).toEqual([]);
  });

  test('dependabotUpdateBlocks falls back to "?" for a block missing ecosystem quotes / directory', () => {
    const yaml = ['updates:', '  - package-ecosystem: npm', '    schedule: {}'].join('\n');
    const blocks = dependabotUpdateBlocks(yaml);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ ecosystem: '?', directory: '?' });
  });

  test('jobBody slices a job to the next 2-space header and empty for a missing job', () => {
    const yaml = ['jobs:', '  a:', '    runs-on: x', '  b:', '    if: always()'].join('\n');
    expect(jobBody(yaml, 'a')).toBe('  a:\n    runs-on: x');
    expect(jobBody(yaml, 'missing')).toBe('');
  });
});
