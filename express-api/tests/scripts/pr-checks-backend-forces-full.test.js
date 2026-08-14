/**
 * pr-checks-backend-forces-full.test.js — SHY-0127 (pre-merge gate hardening).
 *
 * Pins Gate 4: the Express backend is the shared core of every app + webpage,
 * so detect-changes MUST force the full client matrix (app / android / ios /
 * web / integration) on — and ignore the per-platform E2E skip markers —
 * whenever BACKEND is true. Without this pin a future edit could drop the
 * forcing block and a backend regression would silently skip the client suites
 * it can break (operator directive 2026-06-18: "if there's any backend
 * changes… everything needs testing… the backend is the core").
 *
 * Static pin over the workflow YAML (pattern: emulator-in-ci-pin.test.js).
 */
const fs = require('fs');
const path = require('path');

const yml = fs.readFileSync(
  path.resolve(__dirname, '../../../.github/workflows/pr-checks.yml'),
  'utf8',
);
const FORCE = 'if [ "$BACKEND" = "true" ]; then';

describe('SHY-0127 — detect-changes forces the full matrix on backend changes', () => {
  test('contains a BACKEND-true forcing block', () => {
    expect(yml).toContain(FORCE);
  });

  test('the forcing block sets every client flag true', () => {
    const block = yml.slice(yml.indexOf(FORCE), yml.indexOf(FORCE) + 400);
    expect(block).toMatch(/APP=true/);
    expect(block).toMatch(/ANDROID_APP=true/);
    expect(block).toMatch(/IOS_APP=true/);
    expect(block).toMatch(/WEB=true/);
    expect(block).toMatch(/INTEGRATION=true/);
  });

  test('the forcing block disables the per-platform E2E skip markers', () => {
    const block = yml.slice(yml.indexOf(FORCE), yml.indexOf(FORCE) + 400);
    expect(block).toMatch(/SKIP_ANDROID_E2E=false/);
    expect(block).toMatch(/SKIP_IOS_E2E=false/);
  });

  test('forcing happens before the GITHUB_OUTPUT write (so forced flags are emitted)', () => {
    const force = yml.indexOf(FORCE);
    const outputWrite = yml.indexOf('>> "$GITHUB_OUTPUT"');
    expect(force).toBeGreaterThan(-1);
    expect(outputWrite).toBeGreaterThan(-1);
    expect(force).toBeLessThan(outputWrite);
  });

  test('forcing runs AFTER the WORKFLOW_ONLY computation (cannot flip workflow_only)', () => {
    // WORKFLOW_ONLY is computed from BACKEND/APP/... before the forcing block, so
    // a backend change keeps workflow_only=false (BACKEND was already true there).
    const workflowOnly = yml.indexOf('WORKFLOW_ONLY=false');
    const force = yml.indexOf(FORCE);
    expect(workflowOnly).toBeGreaterThan(-1);
    expect(workflowOnly).toBeLessThan(force);
  });
});
