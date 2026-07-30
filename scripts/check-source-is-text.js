#!/usr/bin/env node
/**
 * check-source-is-text.js
 *
 * Fails when a tracked source file contains a NUL byte.
 *
 * WHY THIS EXISTS
 * ---------------
 * A single NUL makes git classify a file as binary, and that is not a
 * cosmetic problem — it removes the file from every text-based tool at once,
 * silently:
 *
 *   - `git diff` prints "Binary files a/… and b/… differ" instead of the
 *     change, so a reviewer approves a diff they were never shown.
 *   - `git grep` and `grep -I` skip it. This repo has several CI guards built
 *     on exactly those, and they keep reporting green while no longer looking.
 *   - `git blame` is useless on it.
 *
 * Nothing else catches this. The file still parses, the tests still pass, and
 * eslint and prettier are both perfectly happy — the only visible symptom is
 * `Bin 0 -> 7047 bytes` in a --stat line nobody is required to read.
 *
 * It happened for real on scripts/check-journey-step-coverage.js (SHY-0259),
 * where a NUL landed where a space was intended inside a template literal,
 * and then immediately happened AGAIN in that file's own test. Twice in ten
 * minutes is not a typo; it is a hazard that needs a machine watching for it.
 *
 * There is no legitimate NUL in any of these file types, so unlike the other
 * ratchets in this directory there is no baseline to work down. The bar is 0.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');

const TEXT_EXTENSIONS = [
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.kt',
  '.kts',
  '.swift',
  '.sh',
  '.bash',
  '.json',
  '.yml',
  '.yaml',
  '.md',
  '.feature',
  '.xml',
  '.html',
  '.css',
  '.properties',
  '.rules',
];

/**
 * Read the file in chunks rather than sniffing a prefix.
 *
 * git's own heuristic gives up after the first 8000 bytes. Copying that limit
 * would let a NUL hide anywhere past the first page of any file — and the
 * largest file this guard protects, manual-qa-runner.js, is 16,000 lines.
 */
function fileHasNulByte(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
  } catch {
    // Listed but unreadable (deleted between `git ls-files` and now, or a
    // dangling symlink). Not this guard's failure to report.
    return false;
  }
  try {
    const buf = Buffer.allocUnsafe(64 * 1024);
    let read;
    while ((read = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      // subarray(0, read), not the whole buffer: allocUnsafe leaves stale
      // bytes past `read` that could themselves be zero.
      if (buf.subarray(0, read).indexOf(0) !== -1) return true;
    }
    return false;
  } finally {
    fs.closeSync(fd);
  }
}

function scanFiles(files) {
  return files.filter((f) => fileHasNulByte(f));
}

function listTrackedSourceFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .split('\0')
    .filter(Boolean)
    .filter((rel) => TEXT_EXTENSIONS.includes(path.extname(rel).toLowerCase()))
    .map((rel) => path.join(REPO, rel));
}

function scanRepo() {
  return scanFiles(listTrackedSourceFiles()).map((f) => path.relative(REPO, f));
}

function main() {
  const files = listTrackedSourceFiles();
  if (files.length === 0) {
    console.error('FAIL: no tracked source files found — nothing was checked.');
    return 1;
  }
  const offenders = scanFiles(files).map((f) => path.relative(REPO, f));
  if (offenders.length === 0) {
    console.log(`Source files are text: ${files.length} checked, 0 with NUL bytes.`);
    return 0;
  }
  console.error(`\nFAIL: ${offenders.length} source file(s) contain a NUL byte.`);
  console.error('git treats these as BINARY: diffs are hidden from review, and');
  console.error('`git grep` / `grep -I` — which several CI guards use — skip them.\n');
  for (const rel of offenders) console.error(`  ${rel}`);
  console.error("\nFind it with:  python3 -c \"print(open(PATH,'rb').read().index(b'\\\\x00'))\"");
  return 1;
}

module.exports = {
  fileHasNulByte,
  scanFiles,
  scanRepo,
  listTrackedSourceFiles,
  TEXT_EXTENSIONS,
};

if (require.main === module) process.exit(main());
