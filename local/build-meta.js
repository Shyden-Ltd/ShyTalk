/**
 * build-meta.js — the single home for ShyTalk's web build/git meta-tag
 * contract (SHY-0205).
 *
 * Two writers emit these tags — `scripts/stamp-build-meta.mjs` at DEV
 * deploy time and `local/serve-web.js` at local serve time — and one
 * reader consumes them (`public/js/preview-watermark.js`). Keeping the
 * names, sanitisation, and injection rules here means the writers can
 * never drift apart from each other; the reader's names are pinned by
 * the Playwright suite against pages served through these writers.
 *
 * Tag set:
 *   shytalk-build      — human build/version label (deploy-provided)
 *   shytalk-git-branch — branch label, sanitised
 *   shytalk-git-sha    — short commit sha
 *   shytalk-git-dirty  — "1" built from uncommitted changes, else "0"
 *   shytalk-built-at   — ISO-8601 UTC stamp time (deploy stamping only;
 *                        local serve omits it — a working tree isn't
 *                        "built", and the git sha+dirty carry the signal)
 */
const { execFileSync } = require("child_process");

// Absolute binary — never PATH-resolved (sonarjs/no-os-command-from-path
// convention; /usr/bin/git exists on macOS via Apple's shim and on the
// ubuntu CI runners).
const GIT = "/usr/bin/git";

const META_NAMES = [
  "shytalk-build",
  "shytalk-git-branch",
  "shytalk-git-sha",
  "shytalk-git-dirty",
  "shytalk-built-at",
];

/**
 * Branch labels (and shas) are collapsed to a conservative charset so a
 * pathological ref name can never break out of an HTML attribute — the
 * value corrupts visibly instead of the markup corrupting silently.
 */
function sanitizeLabel(value) {
  return String(value).replace(/[^A-Za-z0-9._/-]/g, "-");
}

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Reads the live git identity of `cwd`'s repo. Returns
 * `{ branch, sha, dirty }` or null when git is unavailable / not a repo —
 * callers fail open (serve unmodified / omit the tags) because a missing
 * watermark line must never take down page serving.
 */
function readGitIdentity(cwd) {
  try {
    const run = (args) =>
      execFileSync(GIT, args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    // `--abbrev-ref HEAD` prints the LITERAL string "HEAD" (exit 0) on a
    // detached checkout (mid-rebase/bisect) — that's "branch unknown",
    // not a branch name, so degrade it to null → the watermark's "?".
    const rawBranch = run(["rev-parse", "--abbrev-ref", "HEAD"]);
    const branch = rawBranch === "HEAD" ? null : rawBranch;
    const sha = run(["rev-parse", "--short", "HEAD"]);
    const dirty = run(["status", "--porcelain"]).length > 0;
    return { branch, sha, dirty };
  } catch (err) {
    // Still fails OPEN — a missing watermark must never take down page
    // serving. But it must not fail SILENTLY: swallowing the reason is what
    // made the CI failure (watermark rendering "??" for BOTH branch and sha)
    // undiagnosable from outside. stderr only, so served bytes are unchanged.
    process.stderr.write(
      "[build-meta] git identity unavailable in " +
        cwd +
        ": " +
        (err && err.message ? err.message : String(err)) +
        "\n",
    );
    return null;
  }
}

/**
 * Builds the meta-tag block from whatever identity slots are known.
 * Absent slots emit no tag at all (the watermark renders "?") — never an
 * empty-content tag that looks populated.
 */
function buildMetaTags({ branch, sha, dirty, builtAt, build } = {}) {
  const tags = [];
  const tag = (name, content) =>
    tags.push(`<meta name="${name}" content="${escapeAttr(content)}">`);
  if (build) tag("shytalk-build", build);
  if (branch) tag("shytalk-git-branch", sanitizeLabel(branch));
  if (sha) tag("shytalk-git-sha", sanitizeLabel(sha));
  if (branch || sha) tag("shytalk-git-dirty", dirty ? "1" : "0");
  if (builtAt) tag("shytalk-built-at", builtAt);
  return tags.join("\n");
}

/** Removes any previously-injected shytalk metas (idempotent re-stamp). */
function stripExistingMetas(html) {
  const re = new RegExp(
    `[ \\t]*<meta name="(?:${META_NAMES.join("|")})" content="[^"]*">\\n?`,
    "g",
  );
  return html.replace(re, "");
}

/**
 * Injects `tags` immediately before the first `</head>` (any case).
 * Returns the new html, or null when the document has no head close —
 * the caller decides whether that is a warn-and-skip (stamper) or a
 * serve-unmodified (server).
 */
function injectMetas(html, tags) {
  if (!tags) return html;
  const cleaned = stripExistingMetas(html);
  const match = /<\/head>/i.exec(cleaned);
  if (!match) return null;
  return `${cleaned.slice(0, match.index)}${tags}\n${cleaned.slice(match.index)}`;
}

module.exports = {
  META_NAMES,
  sanitizeLabel,
  readGitIdentity,
  buildMetaTags,
  stripExistingMetas,
  injectMetas,
};
