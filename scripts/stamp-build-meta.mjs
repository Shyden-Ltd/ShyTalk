#!/usr/bin/env node
/**
 * stamp-build-meta.mjs — stamps the git identity into every html page
 * under a web root at DEV deploy time (SHY-0205).
 *
 * The web preview watermark (`public/js/preview-watermark.js`) reads
 * `<meta name="shytalk-*">` tags; this script is the deploy-pipeline
 * writer for them (`local/serve-web.js` is the local-serve writer; both
 * share `local/build-meta.js` so the contract cannot drift).
 *
 * Usage:
 *   node scripts/stamp-build-meta.mjs --target dev [--root public] [--build LABEL]
 *
 * Rules:
 *   - `--target dev` is REQUIRED and the only accepted value: prod pages
 *     must carry zero git metadata, so a prod (or absent) target refuses
 *     with exit 2 before touching anything.
 *   - Branch label precedence: SHYTALK_DEPLOY_REF env (the workflow's
 *     effective-ref — a dispatch may deploy a ref other than the one the
 *     run fired on) → live `git rev-parse --abbrev-ref HEAD`.
 *   - Outside a repo the git tags are OMITTED (watermark shows "?");
 *     `shytalk-built-at` still lands. The run stays exit 0 — a missing
 *     watermark line never fails a deploy.
 *   - Head-less fragments are skipped with a warning, never corrupted.
 *   - Idempotent: re-running replaces previous stamps exactly once.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import url from "node:url";

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(url.fileURLToPath(import.meta.url));
const { readGitIdentity, buildMetaTags, injectMetas } = require(
  path.join(scriptDir, "..", "local", "build-meta.js"),
);

function parseArgs(argv) {
  const opts = { target: null, root: "public", build: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--target") opts.target = argv[++i];
    else if (argv[i] === "--root") opts.root = argv[++i];
    else if (argv[i] === "--build") opts.build = argv[++i];
  }
  return opts;
}

function collectHtmlFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectHtmlFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".html")) out.push(full);
  }
  return out;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.target !== "dev") {
    process.stderr.write(
      `stamp-build-meta: refusing target "${opts.target ?? "(none)"}" — ` +
        "only --target dev is stampable (prod pages carry no git metadata).\n",
    );
    process.exit(2);
  }
  const root = path.resolve(opts.root);
  if (!fs.existsSync(root)) {
    process.stderr.write(`stamp-build-meta: root not found: ${root}\n`);
    process.exit(2);
  }

  const git = readGitIdentity(process.cwd());
  const refOverride = (process.env.SHYTALK_DEPLOY_REF ?? "").trim();
  const identity = {
    branch: refOverride || git?.branch || null,
    sha: git?.sha || null,
    dirty: git?.dirty ?? false,
    builtAt: new Date().toISOString(),
    build: opts.build || null,
  };
  const tags = buildMetaTags(identity);

  let stamped = 0;
  let skipped = 0;
  for (const file of collectHtmlFiles(root)) {
    const html = fs.readFileSync(file, "utf8");
    const next = injectMetas(html, tags);
    if (next === null) {
      skipped += 1;
      process.stdout.write(
        `stamp-build-meta: WARN ${path.relative(root, file)} has no </head> — skipped\n`,
      );
      continue;
    }
    fs.writeFileSync(file, next);
    stamped += 1;
  }
  process.stdout.write(
    `stamp-build-meta: stamped ${stamped} file(s), skipped ${skipped} ` +
      `(branch=${identity.branch ?? "-"} sha=${identity.sha ?? "-"} ` +
      `dirty=${identity.dirty ? "1" : "0"} build=${identity.build ?? "-"})\n`,
  );
}

main();
