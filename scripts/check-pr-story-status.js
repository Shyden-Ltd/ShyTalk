#!/usr/bin/env node
/**
 * check-pr-story-status.js — SHY-0127 Gate 1 (status In Review before merge).
 *
 * Fails if any SHY-XXXX story `.md` in the PR diff has a frontmatter `status:`
 * that is not yet ready-to-merge (must be `In Review`, `Done`, or `Cancelled`).
 * This forces the "flip the story to In Review before merging" step that was
 * silently skipped on SHY-0120. Skips (exit 0) when the diff contains no story
 * file (not applicable — e.g. a dependabot/infra PR) or when the PR is a draft.
 *
 * SHY-0131 — a newly-ADDED story `.md` at status `Draft` is EXEMPT (filing a
 * brand-new backlog story is legitimately Draft). The exemption is add-only: a
 * MODIFIED/RENAMED story (the implementation case) must still reach In Review.
 *
 * Read-only: never executes scanned files; spawns `git` with an arg array (no
 * shell); no network, no credentials.
 *
 * Env:
 *   BASE_SHA  — base ref of the PR diff (default: origin/main)
 *   HEAD_SHA  — head ref of the PR diff (default: HEAD)
 *   IS_DRAFT  — "true" => skip (a draft PR isn't mergeable)
 *
 * Exit: 0 = ok / skip; 1 = a story is not ready; 2 = git failure.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ALLOWED = new Set(['In Review', 'Done', 'Cancelled']);

/**
 * The two parts of a story an In Progress edit may NOT touch (SHY-0486).
 *
 * An umbrella deliberately sits at `In Progress` while its slices land, and its
 * running log is the place that records them. This gate refused any edit to it,
 * so the only ways to record progress were to lie about the status or to keep
 * the record somewhere the story does not point at. Neither is acceptable.
 *
 * So a body-only change to an In Progress story is allowed, and "body-only" is
 * defined by what did NOT change: the frontmatter and the Acceptance Criteria
 * must be byte-identical to the base. That is deliberately the strict
 * direction — it is far harder to smuggle an AC edit past an equality check on
 * the whole section than past a rule about where a diff hunk sits.
 *
 * What the gate was built to stop is unchanged: implementation cannot merge
 * against a story nobody has marked ready, because touching the ACs or the
 * status still fails.
 */
function frontmatterOf(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  return m ? m[1] : null;
}

function acceptanceCriteriaOf(text) {
  const start = text.indexOf('\n## Acceptance Criteria');
  if (start === -1) return null;
  const rest = text.slice(start + 1);
  const next = rest.search(/\n## (?!#)/);
  return next === -1 ? rest : rest.slice(0, next);
}

/** The file as it was at `ref`, or null when it did not exist there. */
function fileAt(ref, file) {
  try {
    return execFileSync('git', ['show', `${ref}:${file}`], { encoding: 'utf8', maxBuffer: 32e6 });
  } catch {
    return null;
  }
}
const STORY_RE = /\.project\/stories\/SHY-\d{4}-[^/]+\.md$/;

function fail(msg) {
  process.stderr.write(`::error::${msg}\n`);
}

function main() {
  if (process.env.IS_DRAFT === 'true') {
    process.stdout.write('pre-merge-gate: draft PR — story-status check skipped\n');
    return 0;
  }

  const base = process.env.BASE_SHA || 'origin/main';
  const head = process.env.HEAD_SHA || 'HEAD';

  let entries;
  try {
    entries = execFileSync(
      'git',
      ['diff', '--name-status', '--diff-filter=ACMR', `${base}...${head}`],
      { encoding: 'utf8' },
    )
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((line) => {
        // "A\tpath" | "M\tpath" | "R100\told\tnew" | "C75\told\tnew".
        // First field's first char is the change code; the LAST tab-field is
        // the (new) path — correct for renames/copies too.
        const parts = line.split('\t');
        return { code: parts[0][0], file: parts[parts.length - 1] };
      });
  } catch (err) {
    fail(`pre-merge-gate: git diff ${base}...${head} failed: ${err.message}`);
    return 2;
  }

  const stories = entries.filter((e) => STORY_RE.test(e.file));
  if (stories.length === 0) {
    process.stdout.write('pre-merge-gate: no story .md in the diff — not applicable, skipping\n');
    return 0;
  }

  let bad = 0;
  for (const { code, file } of stories) {
    let content;
    try {
      content = fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
    } catch (err) {
      fail(`pre-merge-gate: cannot read ${file}: ${err.message}`);
      bad += 1;
      continue;
    }
    const match = content.match(/^status:\s*(.+?)\s*$/m);
    const status = match ? match[1] : '(no status: field)';
    if (ALLOWED.has(status)) {
      process.stdout.write(`pre-merge-gate: ${file} status "${status}" OK\n`);
    } else if (status === 'In Progress' && code === 'M') {
      // SHY-0486 — a running-log append on a story that is deliberately open.
      const beforeText = fileAt(base, file);
      const fmSame =
        beforeText !== null && frontmatterOf(beforeText) === frontmatterOf(content);
      const acSame =
        beforeText !== null &&
        acceptanceCriteriaOf(beforeText) === acceptanceCriteriaOf(content);
      if (fmSame && acSame) {
        process.stdout.write(
          `pre-merge-gate: ${file} is In Progress, but the change is body-only ` +
            '(frontmatter and Acceptance Criteria unchanged) — running-log exemption OK\n',
        );
      } else {
        const what = !fmSame ? 'frontmatter' : 'Acceptance Criteria';
        fail(
          `pre-merge-gate: ${file} is "In Progress" and this PR changes its ${what}. ` +
            'Only a body-only change (a running-log append) is allowed while a story is ' +
            'In Progress. Do NOT flip the status to get past this — move the story to ' +
            '"In Review" only when it genuinely is.',
        );
        bad += 1;
      }
    } else if (code === 'A' && status === 'Draft') {
      // SHY-0131 — filing a brand-new story is legitimately Draft (not yet
      // picked up for implementation). The exemption is ADD-only: a MODIFIED or
      // RENAMED story (the implementation case) must still reach In Review, so
      // the SHY-0120 protection is preserved.
      process.stdout.write(`pre-merge-gate: ${file} newly-added Draft — filing exemption OK\n`);
    } else {
      fail(
        `pre-merge-gate: ${file} has status "${status}" — it must be "In Review" ` +
          '(or Done/Cancelled) before this PR can merge. Flip the frontmatter status, then re-push.',
      );
      bad += 1;
    }
  }
  return bad > 0 ? 1 : 0;
}

process.exit(main());
