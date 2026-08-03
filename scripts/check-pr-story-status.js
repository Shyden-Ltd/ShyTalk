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
 *   HEAD_REF  — the PR's branch name. When it carries a story id
 *               (`story/SHY-NNNN-...`), the In-Review requirement applies to
 *               THAT story plus any story whose `status:` line this PR
 *               changed. Other story files in the diff are incidental edits.
 *
 * SHY-0268 — the original rule was "any MODIFIED story must be In Review",
 * which is right while a PR touches one story. A corpus-wide Gherkin reformat
 * touched 194 story bodies at once, and flipping 194 unrelated Draft stories
 * to In Review to satisfy the gate would be a lie about every one of them, so
 * the sweep could never merge. The gate's actual intent is "the story THIS PR
 * implements must be ready", which the branch name states outright. With no
 * story branch (dependabot, infra) the original broader rule still applies.
 *
 * Exit: 0 = ok / skip; 1 = a story is not ready; 2 = git failure.
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ALLOWED = new Set(["In Review", "Done", "Cancelled"]);
const STORY_RE = /\.project\/stories\/SHY-\d{4}-[^/]+\.md$/;
const STORY_ID_RE = /SHY-\d{4}/;

function fail(msg) {
  process.stderr.write(`::error::${msg}\n`);
}

function main() {
  if (process.env.IS_DRAFT === "true") {
    process.stdout.write(
      "pre-merge-gate: draft PR — story-status check skipped\n",
    );
    return 0;
  }

  const base = process.env.BASE_SHA || "origin/main";
  const head = process.env.HEAD_SHA || "HEAD";

  let entries;
  try {
    entries = execFileSync(
      "git",
      ["diff", "--name-status", "--diff-filter=ACMR", `${base}...${head}`],
      { encoding: "utf8" },
    )
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((line) => {
        // "A\tpath" | "M\tpath" | "R100\told\tnew" | "C75\told\tnew".
        // First field's first char is the change code; the LAST tab-field is
        // the (new) path — correct for renames/copies too.
        const parts = line.split("\t");
        return { code: parts[0][0], file: parts[parts.length - 1] };
      });
  } catch (err) {
    fail(`pre-merge-gate: git diff ${base}...${head} failed: ${err.message}`);
    return 2;
  }

  const stories = entries.filter((e) => STORY_RE.test(e.file));
  if (stories.length === 0) {
    process.stdout.write(
      "pre-merge-gate: no story .md in the diff — not applicable, skipping\n",
    );
    return 0;
  }

  // The story this PR implements, per the branch-naming convention.
  const ownStoryId =
    (process.env.HEAD_REF || "").match(STORY_ID_RE)?.[0] || null;

  /** True when the PR's diff touches this file's frontmatter `status:` line. */
  const statusLineChanged = (file) => {
    try {
      const diff = execFileSync(
        "git",
        ["diff", `${base}...${head}`, "--", file],
        {
          encoding: "utf8",
        },
      );
      return diff.split("\n").some((l) => /^[+-]status:/.test(l));
    } catch {
      return true; // can't tell — gate it rather than wave it through
    }
  };

  let bad = 0;
  for (const { code, file } of stories) {
    // Incidental edit: not this PR's story, and its lifecycle claim is
    // untouched. Only applies when the branch names a story at all.
    if (ownStoryId && !file.includes(ownStoryId) && !statusLineChanged(file)) {
      process.stdout.write(
        `pre-merge-gate: ${file} body-only edit, not this PR's story (${ownStoryId}) — skipping\n`,
      );
      continue;
    }
    let content;
    try {
      content = fs.readFileSync(path.resolve(process.cwd(), file), "utf8");
    } catch (err) {
      fail(`pre-merge-gate: cannot read ${file}: ${err.message}`);
      bad += 1;
      continue;
    }
    const match = content.match(/^status:\s*(.+?)\s*$/m);
    const status = match ? match[1] : "(no status: field)";
    if (ALLOWED.has(status)) {
      process.stdout.write(`pre-merge-gate: ${file} status "${status}" OK\n`);
    } else if (code === "A" && status === "Draft") {
      // SHY-0131 — filing a brand-new story is legitimately Draft (not yet
      // picked up for implementation). The exemption is ADD-only: a MODIFIED or
      // RENAMED story (the implementation case) must still reach In Review, so
      // the SHY-0120 protection is preserved.
      process.stdout.write(
        `pre-merge-gate: ${file} newly-added Draft — filing exemption OK\n`,
      );
    } else {
      fail(
        `pre-merge-gate: ${file} has status "${status}" — it must be "In Review" ` +
          "(or Done/Cancelled) before this PR can merge. Flip the frontmatter status, then re-push.",
      );
      bad += 1;
    }
  }
  return bad > 0 ? 1 : 0;
}

process.exit(main());
