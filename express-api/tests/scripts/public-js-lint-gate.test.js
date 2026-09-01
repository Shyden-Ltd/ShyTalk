/**
 * SHY-0448 — the public/ lint and format gate, asserted by BREAKING it.
 *
 * The story is explicit that this must be proved "by introducing one, not by
 * reading the config". Reading a config tells you what somebody intended; it
 * does not tell you whether a mistake in an admin tab actually stops a commit.
 *
 * Both halves matter and both are asserted:
 *   - a file with a lint finding FAILS, and
 *   - a clean file PASSES.
 * Without the second, a gate that rejected every new file under public/ would
 * satisfy the first and be useless.
 *
 * Nothing is mocked. The real ratchet runs over the real tree, which is what it
 * does on every commit and in CI.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const RATCHET = path.join(REPO_ROOT, 'scripts', 'check-public-js-lint.js');
const NODE = process.execPath;

// Own filename, own directory: two suites planting `probe.js` would each see
// the other's findings and neither would know why (SHY-0464).
const PROBE = path.join(REPO_ROOT, 'public', 'shy0448-lint-gate-probe.js');

/** Runs the ratchet, returning { code, output } rather than throwing. */
function runRatchet() {
  try {
    return { code: 0, output: execFileSync(NODE, [RATCHET], { cwd: REPO_ROOT, encoding: 'utf8' }) };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

/**
 * Runs Prettier's own binary through node, rather than `npx` from PATH.
 *
 * Deterministic — this is the installed version, not whatever a PATH lookup
 * finds — and it keeps the test out of the shell entirely.
 */
const PRETTIER = path.join(
  REPO_ROOT,
  'express-api',
  'node_modules',
  'prettier',
  'bin',
  'prettier.cjs',
);

function runPrettier(file) {
  try {
    execFileSync(NODE, [PRETTIER, '--check', path.relative(REPO_ROOT, file)], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return 0;
  } catch (err) {
    return err.status ?? 1;
  }
}

afterEach(() => fs.rmSync(PROBE, { force: true }));

describe('a mistake under public/ stops the commit', () => {
  test('the tree is clean before anything is planted', () => {
    // The control. If the ratchet were already failing, the assertions below
    // would pass while proving nothing about the probe.
    expect(runRatchet().code).toBe(0);
  });

  test('a lint finding in a new public/ file FAILS the ratchet, and names the file', () => {
    fs.writeFileSync(
      PROBE,
      '// SHY-0448 probe.\nexport function probe() {\n' +
        "  const neverUsed = 1;\n  if (1 == '1') return null;\n  return undefined;\n}\n",
    );
    const { code, output } = runRatchet();
    expect(code).not.toBe(0);
    // Naming the file is the difference between a gate somebody can act on and
    // one they have to go hunting behind.
    expect(output).toContain('shy0448-lint-gate-probe.js');
  });

  test('a CLEAN new public/ file PASSES — the gate is not just "new file rejected"', () => {
    fs.writeFileSync(PROBE, '// SHY-0448 probe.\nexport function probe() {\n  return 1;\n}\n');
    expect(runRatchet().code).toBe(0);
  });
});

describe('formatting is checked too, not only lint', () => {
  test('a badly formatted file fails prettier --check', () => {
    fs.writeFileSync(PROBE, "export function probe(){return    'x'}\n");
    expect(runPrettier(PROBE)).not.toBe(0);
  });

  test('the same file formatted correctly passes', () => {
    fs.writeFileSync(PROBE, "export function probe() {\n  return 'x';\n}\n");
    expect(runPrettier(PROBE)).toBe(0);
  });
});

describe('the exclusions are explicit, not accidental', () => {
  test('the root .prettierignore exists and names why each entry is there', () => {
    const ignore = fs.readFileSync(path.join(REPO_ROOT, '.prettierignore'), 'utf8');
    // Vendored assets, and the locale tables that are compressed on purpose.
    expect(ignore).toContain('**/*.min.js');
    expect(ignore).toContain('public/js/legal-translations.js');
    // A bare list rots. The reasons are what stop somebody deleting a line
    // because it looked arbitrary.
    expect(ignore).toMatch(/one line per locale/i);
  });

  test('ESLint and Prettier agree about what is vendored', () => {
    // Two tools with different ideas of "vendored" means one of them formats
    // or lints a file nobody owns.
    const eslintCfg = fs.readFileSync(path.join(REPO_ROOT, 'public', 'eslint.config.mjs'), 'utf8');
    const ignore = fs.readFileSync(path.join(REPO_ROOT, '.prettierignore'), 'utf8');
    for (const pattern of ['**/*.min.js', '**/vendor/**']) {
      expect(eslintCfg).toContain(pattern);
      expect(ignore).toContain(pattern);
    }
  });
});
