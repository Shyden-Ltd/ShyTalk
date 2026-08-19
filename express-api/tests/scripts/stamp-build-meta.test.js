/**
 * scripts/stamp-build-meta.mjs — deploy-time git-identity stamping for the
 * web tier (SHY-0205).
 *
 * The web preview watermark reads `<meta name="shytalk-git-*">` tags that
 * this script writes into every html page under public/ at DEV deploy time.
 * Real-process tests: each case runs the actual script via `node` against
 * a REAL scratch git repo — no mocks.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
// Absolute binaries — sonarjs/no-os-command-from-path (repo convention:
// spawned commands are never PATH-resolved).
const NODE = process.execPath;
const GIT = '/usr/bin/git';
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'stamp-build-meta.mjs');

/** Runs the stamp script; returns { status, stdout, stderr }. */
function runStamp(args, opts = {}) {
  try {
    const stdout = execFileSync(NODE, [SCRIPT, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...opts,
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    return {
      status: err.status ?? 1,
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? '',
    };
  }
}

/** Creates a scratch git repo with an html tree; returns its root. */
function makeScratchRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-meta-'));
  const run = (cmd, args) => execFileSync(cmd, args, { cwd: dir, stdio: 'ignore' });
  run(GIT, ['init', '-q', '-b', 'story/SHY-0205-test-branch']);
  run(GIT, ['config', 'user.email', 'stamp-test@shytalk.dev']);
  run(GIT, ['config', 'user.name', 'Stamp Test']);
  fs.mkdirSync(path.join(dir, 'public', 'events'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'public', 'index.html'),
    '<!doctype html><html><head><title>x</title></head><body>hi</body></html>',
  );
  fs.writeFileSync(
    path.join(dir, 'public', 'events', 'party.html'),
    '<!doctype html><html><head></head><body>party</body></html>',
  );
  fs.writeFileSync(path.join(dir, 'public', 'headless-fragment.html'), '<div>no head here</div>');
  fs.writeFileSync(path.join(dir, 'public', 'style.css'), 'body{}');
  run(GIT, ['add', '.']);
  run(GIT, ['commit', '-q', '-m', 'seed']);
  return dir;
}

describe('stamp-build-meta.mjs (SHY-0205)', () => {
  let repo;
  beforeEach(() => {
    repo = makeScratchRepo();
  });
  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  test('refuses any target other than dev — prod HTML must carry no git metadata', () => {
    const out = runStamp(['--target', 'prod', '--root', 'public'], { cwd: repo });
    expect(out.status).not.toBe(0);
    const index = fs.readFileSync(path.join(repo, 'public', 'index.html'), 'utf8');
    expect(index).not.toContain('shytalk-git-branch');
  });

  test('refuses when --target is absent', () => {
    const out = runStamp(['--root', 'public'], { cwd: repo });
    expect(out.status).not.toBe(0);
  });

  test('stamps every html file under the root with the git identity', () => {
    const out = runStamp(['--target', 'dev', '--root', 'public'], { cwd: repo });
    expect(out.status).toBe(0);
    const sha = execFileSync(GIT, ['rev-parse', '--short', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim();
    for (const rel of ['index.html', path.join('events', 'party.html')]) {
      const html = fs.readFileSync(path.join(repo, 'public', rel), 'utf8');
      expect(html).toContain('name="shytalk-git-branch" content="story/SHY-0205-test-branch"');
      expect(html).toContain(`name="shytalk-git-sha" content="${sha}"`);
      expect(html).toContain('name="shytalk-git-dirty" content="0"');
      expect(html).toMatch(/name="shytalk-built-at" content="[0-9T:.-]+Z"/);
      // Tags land INSIDE the head, before its close.
      expect(html.indexOf('shytalk-git-branch')).toBeLessThan(html.indexOf('</head>'));
    }
  });

  test('marks a dirty working tree with content="1"', () => {
    fs.writeFileSync(path.join(repo, 'public', 'style.css'), 'body{color:red}');
    const out = runStamp(['--target', 'dev', '--root', 'public'], { cwd: repo });
    expect(out.status).toBe(0);
    const html = fs.readFileSync(path.join(repo, 'public', 'index.html'), 'utf8');
    expect(html).toContain('name="shytalk-git-dirty" content="1"');
  });

  test('SHYTALK_DEPLOY_REF env overrides the branch label (CI effective-ref)', () => {
    const out = runStamp(['--target', 'dev', '--root', 'public'], {
      cwd: repo,
      env: { ...process.env, SHYTALK_DEPLOY_REF: 'story/SHY-9999-dispatched' },
    });
    expect(out.status).toBe(0);
    const html = fs.readFileSync(path.join(repo, 'public', 'index.html'), 'utf8');
    expect(html).toContain('name="shytalk-git-branch" content="story/SHY-9999-dispatched"');
  });

  test('--build writes the shytalk-build meta the watermark already consumes', () => {
    const out = runStamp(['--target', 'dev', '--root', 'public', '--build', '0.97.15-b123'], {
      cwd: repo,
    });
    expect(out.status).toBe(0);
    const html = fs.readFileSync(path.join(repo, 'public', 'index.html'), 'utf8');
    expect(html).toContain('name="shytalk-build" content="0.97.15-b123"');
  });

  test('double-run is idempotent — each meta appears exactly once with fresh values', () => {
    expect(runStamp(['--target', 'dev', '--root', 'public'], { cwd: repo }).status).toBe(0);
    expect(runStamp(['--target', 'dev', '--root', 'public'], { cwd: repo }).status).toBe(0);
    const html = fs.readFileSync(path.join(repo, 'public', 'index.html'), 'utf8');
    expect(html.match(/name="shytalk-git-branch"/g)).toHaveLength(1);
    expect(html.match(/name="shytalk-git-sha"/g)).toHaveLength(1);
    expect(html.match(/name="shytalk-built-at"/g)).toHaveLength(1);
  });

  test('a head-less fragment is skipped with a warning, not corrupted, and the run still succeeds', () => {
    const before = fs.readFileSync(path.join(repo, 'public', 'headless-fragment.html'), 'utf8');
    const out = runStamp(['--target', 'dev', '--root', 'public'], { cwd: repo });
    expect(out.status).toBe(0);
    const after = fs.readFileSync(path.join(repo, 'public', 'headless-fragment.html'), 'utf8');
    expect(after).toBe(before);
    expect(out.stdout + out.stderr).toMatch(/headless-fragment\.html.*no <\/head>/i);
  });

  test('non-html assets are never touched', () => {
    runStamp(['--target', 'dev', '--root', 'public'], { cwd: repo });
    expect(fs.readFileSync(path.join(repo, 'public', 'style.css'), 'utf8')).toBe('body{}');
  });

  test('outside a git repo the stamp degrades to placeholder-free omission and exit 0', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-nogit-'));
    fs.mkdirSync(path.join(bare, 'public'));
    fs.writeFileSync(
      path.join(bare, 'public', 'index.html'),
      '<html><head></head><body></body></html>',
    );
    const out = runStamp(['--target', 'dev', '--root', 'public'], {
      cwd: bare,
      env: { ...process.env, SHYTALK_DEPLOY_REF: '' },
    });
    expect(out.status).toBe(0);
    const html = fs.readFileSync(path.join(bare, 'public', 'index.html'), 'utf8');
    // No git → no git metas (the watermark renders "?"), but built-at still lands.
    expect(html).not.toContain('shytalk-git-sha');
    expect(html).toContain('shytalk-built-at');
    fs.rmSync(bare, { recursive: true, force: true });
  });

  test('escapeAttr neutralises a hostile --build value (the one un-sanitised slot)', () => {
    // branch/sha pass sanitizeLabel first; --build is the only value that
    // reaches the attribute with escapeAttr as its SOLE defence — prove it.
    const out = runStamp(
      ['--target', 'dev', '--root', 'public', '--build', '<script>"x"&</script>'],
      { cwd: repo },
    );
    expect(out.status).toBe(0);
    const html = fs.readFileSync(path.join(repo, 'public', 'index.html'), 'utf8');
    expect(html).toContain(
      'name="shytalk-build" content="&lt;script&gt;&quot;x&quot;&amp;&lt;/script&gt;"',
    );
    expect(html).not.toContain('<script>"x"&</script>');
  });

  test('detached HEAD stamps sha but degrades branch to omission (renders ?)', () => {
    execFileSync(GIT, ['checkout', '-q', '--detach', 'HEAD'], { cwd: repo });
    const out = runStamp(['--target', 'dev', '--root', 'public'], {
      cwd: repo,
      env: { ...process.env, SHYTALK_DEPLOY_REF: '' },
    });
    expect(out.status).toBe(0);
    const html = fs.readFileSync(path.join(repo, 'public', 'index.html'), 'utf8');
    expect(html).not.toContain('shytalk-git-branch');
    expect(html).not.toContain('content="HEAD"');
    expect(html).toContain('shytalk-git-sha');
  });

  describe('workflow wiring', () => {
    const devYml = fs.readFileSync(
      path.join(REPO_ROOT, '.github', 'workflows', 'deploy-dev.yml'),
      'utf8',
    );
    const prodYml = fs.readFileSync(
      path.join(REPO_ROOT, '.github', 'workflows', 'deploy-prod.yml'),
      'utf8',
    );

    test('deploy-dev stamps public/ BEFORE the wrangler upload', () => {
      const stampIdx = devYml.indexOf('stamp-build-meta.mjs --target dev --root public');
      const wranglerIdx = devYml.indexOf('wrangler pages deploy public');
      expect(stampIdx).toBeGreaterThan(-1);
      expect(wranglerIdx).toBeGreaterThan(-1);
      expect(stampIdx).toBeLessThan(wranglerIdx);
    });

    test('deploy-dev passes the effective deploy ref to the stamper', () => {
      // The web-deploy step must carry SHYTALK_DEPLOY_REF so a
      // dispatched `ref` input stamps the DEPLOYED branch, not the ref
      // the workflow happened to run on.
      expect(devYml).toMatch(/SHYTALK_DEPLOY_REF:.*inputs\.ref/);
    });

    test('deploy-prod NEVER stamps — prod pages carry no git metadata', () => {
      expect(prodYml).not.toContain('stamp-build-meta');
    });
  });

  test('branch labels are sanitised to the safe charset', () => {
    const out = runStamp(['--target', 'dev', '--root', 'public'], {
      cwd: repo,
      env: { ...process.env, SHYTALK_DEPLOY_REF: 'weird "branch" <name>' },
    });
    expect(out.status).toBe(0);
    const html = fs.readFileSync(path.join(repo, 'public', 'index.html'), 'utf8');
    expect(html).toContain('name="shytalk-git-branch" content="weird--branch---name-"');
  });
});
