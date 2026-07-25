'use strict';

// SHY-0245 — the sleep ratchet. A sleep is a hard-coded guess about how fast
// someone else's machine is; it is always wrong somewhere. The guard exists so
// the 230 removed `waitForTimeout` calls cannot regrow, following the
// established `check-no-new-stubs.js` / `check-action-shas.sh` ratchet pattern.
//
// Real execution: every case runs the ACTUAL script against a throwaway tree
// and asserts on its real exit code and stdout — no mocked filesystem.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.resolve(__dirname, '../../../scripts/check-no-test-sleeps.sh');

/** Runs the guard against `root`; returns { status, stdout, stderr }. */
function runGuard(root) {
  return spawnSync('/bin/bash', [SCRIPT, root], { encoding: 'utf8', timeout: 30000 });
}

/** Builds a throwaway tree of { relativePath: contents }. */
function makeTree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shy0245-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return dir;
}

describe('check-no-test-sleeps.sh — detects sleeps (SHY-0245)', () => {
  test('a Playwright waitForTimeout is REJECTED, naming file and line', () => {
    const root = makeTree({
      'tests/web/a.spec.ts':
        "test('x', async ({ page }) => {\n  await page.waitForTimeout(1000);\n});\n",
    });
    const r = runGuard(root);
    expect(r.status).not.toBe(0); // must fail the build
    expect(r.stdout + r.stderr).toMatch(/tests\/web\/a\.spec\.ts/);
    expect(r.stdout + r.stderr).toMatch(/2/); // the line number
  });

  test('a Kotlin Thread.sleep is REJECTED', () => {
    const root = makeTree({
      'app/src/androidTest/java/T.kt': 'fun t() {\n  Thread.sleep(500)\n}\n',
    });
    expect(runGuard(root).status).not.toBe(0);
  });

  test('the setTimeout-promise sleep idiom is REJECTED', () => {
    const root = makeTree({
      'tests/web/b.spec.ts': 'await new Promise((r) => setTimeout(r, 250));\n',
    });
    expect(runGuard(root).status).not.toBe(0);
  });

  test('a Swift asyncAfter used as a wait is REJECTED', () => {
    const root = makeTree({
      'iosApp/iosAppTests/T.swift': 'DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { }\n',
    });
    expect(runGuard(root).status).not.toBe(0);
  });
});

describe('check-no-test-sleeps.sh — does NOT over-reach (SHY-0245)', () => {
  test('a clean tree PASSES with a zero count', () => {
    const root = makeTree({
      'tests/web/ok.spec.ts': 'await expect(page.getByRole("button")).toHaveCount(0);\n',
    });
    const r = runGuard(root);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/0/);
  });

  test('a bounded poll-until-true in shell is ALLOWED (exits the instant the condition holds)', () => {
    // The interval is an implementation detail of polling, not the thing being
    // waited on — correct at any machine speed. Distinct from sleep-and-hope.
    const root = makeTree({
      'scripts/wait.sh': 'until pgrep -f "$TAG"; do sleep 0.05; done\n',
    });
    expect(runGuard(root).status).toBe(0);
  });

  test("Playwright's own timeout OPTIONS are allowed — they bound failure, they are not the wait", () => {
    const root = makeTree({
      'tests/web/c.spec.ts':
        'await expect(x).toBeVisible({ timeout: 3_000 });\nawait el.waitFor({ timeout: 5_000 });\n',
    });
    expect(runGuard(root).status).toBe(0);
  });

  test('binary files are SKIPPED, not scanned as text', () => {
    // grep -rnI: a woff2/png whose bytes happen to contain a banned token must
    // not fail the build ([[feedback-text-guards-must-skip-binaries]]).
    const root = makeTree({ 'tests/web/ok.spec.ts': 'const a = 1;\n' });
    fs.writeFileSync(
      path.join(root, 'tests/web/font.woff2'),
      Buffer.concat([
        Buffer.from([0x00, 0x01, 0x02, 0x00]),
        Buffer.from('waitForTimeout(1000)'),
        Buffer.from([0x00, 0xff]),
      ]),
    );
    expect(runGuard(root).status).toBe(0);
  });

  test('an empty tree reports 0 and passes — a zero means scanned-and-clean', () => {
    // Guards the tautology: a guard that scans nothing also reports zero.
    const root = makeTree({ 'placeholder.txt': 'x\n' });
    const r = runGuard(root);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/0/);
  });
});
