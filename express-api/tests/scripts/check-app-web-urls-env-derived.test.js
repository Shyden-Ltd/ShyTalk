/**
 * check-app-web-urls-env-derived.test.js (SHY-0182 / EPIC-0007)
 *
 * Meta-test for the CI guard that keeps the APP from hardcoding a
 * cross-environment web-page URL (the leak that shipped prod legal pages to
 * dev/local builds). Runs the REAL script against REAL temp trees + the real
 * repo roots. No doubles. Fixture-tests the DETECTOR itself so it can't
 * silently rot into a no-op ([[feedback-detector-must-report-not-guess]]).
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(REPO_ROOT, 'scripts/check-app-web-urls-env-derived.sh');

function run(...roots) {
  return spawnSync('/bin/bash', [SCRIPT, ...roots], { encoding: 'utf8', timeout: 20000 });
}

function mkTree(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const write = (rel, body) => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
    return full;
  };
  return { root, write };
}

describe('check-app-web-urls-env-derived.sh', () => {
  test('exit 0 on a clean tree (no hardcoded web-page URLs)', () => {
    const { root, write } = mkTree('webguard-ok-');
    write(
      'shared/src/commonMain/Ok.kt',
      'val u = WebUrls.legalForCurrentBuild(WebUrls.LegalDoc.PRIVACY)\n',
    );
    const r = run(path.join(root, 'shared/src/commonMain'));
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/no hardcoded cross-env web-page URLs/);
  });

  test('exit 1 and NAMES the offender for the dev web host in runtime code', () => {
    const { root, write } = mkTree('webguard-dev-');
    write(
      'shared/src/commonMain/Leak.kt',
      'val u = "https://dev.shytalk.shyden.co.uk/privacy.html"\n',
    );
    const r = run(path.join(root, 'shared/src/commonMain'));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/HARDCODED cross-env web URL/);
    expect(r.stderr).toMatch(/Leak\.kt:1/);
  });

  test('exit 1 for a hardcoded prod legal-page URL', () => {
    const { root, write } = mkTree('webguard-legal-');
    write(
      'shared/src/commonMain/Leak.kt',
      'val u = "https://shytalk.shyden.co.uk/community-guidelines.html"\n',
    );
    const r = run(path.join(root, 'shared/src/commonMain'));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/community-guidelines\.html/);
  });

  test('does NOT flag out-of-scope shytalk hosts/pages (no false positives)', () => {
    const { root, write } = mkTree('webguard-fp-');
    // roadmap.html (different feature), dev-api (API host), images (R2), the
    // bare email-link domain, livekit — all legitimate, none is an app web PAGE.
    write(
      'shared/src/commonMain/Fine.kt',
      [
        'val r = "https://shytalk.shyden.co.uk/roadmap.html#x"',
        'val a = "https://dev-api.shytalk.shyden.co.uk"',
        'val i = "https://images.shytalk.shyden.co.uk/pic.png"',
        'val e = "shytalk.shyden.co.uk"',
        'val k = "https://livekit.shytalk.shyden.co.uk"',
        '',
      ].join('\n'),
    );
    const r = run(path.join(root, 'shared/src/commonMain'));
    expect(r.status).toBe(0);
  });

  test('allowlists the WebUrls.kt single source of truth', () => {
    const { root, write } = mkTree('webguard-ssot-');
    write(
      'shared/src/commonMain/core/util/WebUrls.kt',
      'const val DEV = "https://dev.shytalk.shyden.co.uk"\n',
    );
    const r = run(path.join(root, 'shared/src/commonMain'));
    expect(r.status).toBe(0);
  });

  test('allowlists test sources (they legitimately assert the host literals)', () => {
    const { root, write } = mkTree('webguard-test-');
    write(
      'shared/src/commonTest/WebUrlsTest.kt',
      'assertEquals("https://dev.shytalk.shyden.co.uk", x)\n',
    );
    const r = run(path.join(root, 'shared/src/commonTest'));
    expect(r.status).toBe(0);
  });

  test('catches a case-variant host literal (case-insensitive match)', () => {
    // Host matching is case-insensitive (DNS + WebUrls' own .lowercase()); an
    // upper/mixed-case literal must not slip past the guard.
    const { root, write } = mkTree('webguard-case-');
    write(
      'shared/src/commonMain/Leak.kt',
      'val u = "https://DEV.ShyTalk.Shyden.CO.UK/privacy.html"\n',
    );
    const r = run(path.join(root, 'shared/src/commonMain'));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Leak\.kt/);
  });

  test('skips generated build output (a local Xcode/Gradle build leaves it under the roots)', () => {
    const { root, write } = mkTree('webguard-build-');
    // A vendored file under build/ with the literal — must NOT trip the guard.
    write(
      'iosApp/build/SourcePackages/checkouts/vendor/Foo.swift',
      'let u = "https://dev.shytalk.shyden.co.uk/x.html"\n',
    );
    const r = run(path.join(root, 'iosApp'));
    expect(r.status).toBe(0);
  });

  test('the guard covers every WebUrls.LegalDoc page (drift guard)', () => {
    // If a 5th LegalDoc is added without updating the script's forbidden list,
    // a hardcoded URL for that page would bypass the guard. Tie the two lists
    // together: every LegalDoc `.page` filename must appear in the script.
    const webUrls = fs.readFileSync(
      path.join(REPO_ROOT, 'shared/src/commonMain/kotlin/com/shyden/shytalk/core/util/WebUrls.kt'),
      'utf8',
    );
    const script = fs.readFileSync(SCRIPT, 'utf8');
    // Extract the enum page literals, e.g. PRIVACY("privacy.html").
    const pages = [...webUrls.matchAll(/\(\s*"([a-z-]+\.html)"\s*\)/g)].map((m) => m[1]);
    expect(pages.length).toBeGreaterThanOrEqual(4); // sanity: we found the enum
    for (const page of pages) {
      const stem = page.replace(/\.html$/, '');
      expect(script).toContain(stem); // the forbidden alternation lists this page
    }
  });

  test('exit 0 against the REAL repo (the estate is clean today)', () => {
    // The whole point: this guard passes now, and any future hardcoded URL
    // trips it. Run with no args → the script scans its default app roots.
    const r = spawnSync('/bin/bash', [SCRIPT], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 30000,
    });
    expect(r.status).toBe(0);
  });
});
