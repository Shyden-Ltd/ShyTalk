/**
 * check-web-pages-have-lang-resolver.test.js (SHY-0181)
 *
 * Meta-test for the CI guard that keeps every owned web page loading the
 * shared language resolver (so the site-wide `?lang=` flag reaches it — now
 * and for future pages). Runs the REAL script against REAL temp trees + the
 * real `public/` tree. No doubles.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(REPO_ROOT, 'scripts/check-web-pages-have-lang-resolver.sh');

function run(root) {
  return spawnSync('/bin/bash', [SCRIPT, root], { encoding: 'utf8', timeout: 20000 });
}

describe('check-web-pages-have-lang-resolver.sh', () => {
  test('exit 0 when every html page includes language-selector.js', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lang-guard-ok-'));
    fs.mkdirSync(path.join(root, 'admin'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'index.html'),
      '<script src="/js/language-selector.js"></script>',
    );
    fs.writeFileSync(
      path.join(root, 'admin', 'index.html'),
      '<html><script src="/js/language-selector.js"></script></html>',
    );
    const r = run(root);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/all web pages/);
  });

  test('exit 1 and NAMES the offending page when one omits the resolver', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lang-guard-bad-'));
    fs.writeFileSync(
      path.join(root, 'good.html'),
      '<script src="/js/language-selector.js"></script>',
    );
    fs.writeFileSync(path.join(root, 'orphan.html'), '<html>no resolver here</html>');
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/MISSING language resolver/);
    expect(r.stderr).toMatch(/orphan\.html/);
    expect(r.stderr).not.toMatch(/good\.html/); // only the offender is named
  });

  test('exit 2 on a missing root (usage error, not a false pass)', () => {
    const r = run(path.join(os.tmpdir(), 'definitely-not-a-dir-xyz'));
    expect(r.status).toBe(2);
  });

  test('the REAL public/ tree passes (all 11 owned pages carry the resolver)', () => {
    const r = run(path.join(REPO_ROOT, 'public'));
    expect(r.status).toBe(0);
  });
});
