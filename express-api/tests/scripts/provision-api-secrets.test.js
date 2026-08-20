/* eslint-disable sonarjs/no-os-command-from-path
   -- test harness invokes `bash` and the script-under-test against temporary
   files with controlled inputs. Not security-sensitive. */
/**
 * Tests for `scripts/provision-api-secrets.sh` — SHY-0378.
 *
 * The script installs the two HMAC signing keys (`MFA_REMEMBER_SECRET`,
 * `EXPORT_DOWNLOAD_SECRET`) that `src/utils/mfa-remember.js` and
 * `src/routes/data-export.js` fall back to a REPOSITORY-COMMITTED string for
 * when unset. See `.project/stories/SHY-0378-provision-api-signing-secrets.md`.
 *
 * Exit codes (documented in the script header and --help):
 *   0  success, including "nothing to do"
 *   1  unexpected failure
 *   2  usage error
 *   3  target or prerequisite unreachable (env file missing, ssh failed)
 *   4  duplicate key conflict — two values disagree; NOTHING applied
 *   5  post-restart health check failed; previous configuration restored
 *
 * Fixture strategy: every test writes a real .env into a fresh tmpdir and runs
 * the real script against it. No mocked filesystem — the file-mutation rules
 * ARE the behaviour under test, and a mock would not catch a byte-level bug
 * such as a missing trailing newline.
 *
 * Only `--env-file` (local) mode is exercised here. The `--host` mode is a thin
 * transport that uploads this same script and runs it in `--env-file` mode on
 * the target, so the logic below is the whole logic. Its live proof is the dev
 * verification recorded in the story's Definition of Done.
 */

const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'provision-api-secrets.sh');

/** The secrets the script is responsible for. */
const MANAGED = ['MFA_REMEMBER_SECRET', 'EXPORT_DOWNLOAD_SECRET'];

/** 256 bits, hex-encoded. */
const MIN_HEX_LEN = 64;

const TEMP_DIRS = [];

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'provision-secrets-'));
  TEMP_DIRS.push(dir);
  return dir;
}

/** Write a .env with the given contents; returns its path. */
function writeEnv(contents) {
  const dir = tempDir();
  const file = path.join(dir, '.env');
  fs.writeFileSync(file, contents);
  return file;
}

function runScript(args, opts = {}) {
  const res = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf-8',
    cwd: opts.cwd ?? REPO_ROOT,
    timeout: 30_000,
    env: { ...process.env, ...(opts.env ?? {}) },
  });
  return {
    code: res.status ?? 1,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    output: (res.stdout ?? '') + (res.stderr ?? ''),
  };
}

/** Parse a .env into a map using LAST-WINS, matching dotenv's real behaviour. */
function parseEnv(file) {
  const map = {};
  for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (m) map[m[1]] = m[2];
  }
  return map;
}

function countOccurrences(file, key) {
  return fs
    .readFileSync(file, 'utf-8')
    .split('\n')
    .filter((l) => l.startsWith(`${key}=`)).length;
}

afterAll(() => {
  for (const dir of TEMP_DIRS) fs.rmSync(dir, { recursive: true, force: true });
});

describe('provision-api-secrets.sh — contract', () => {
  test('the script exists and is executable', () => {
    expect(fs.existsSync(SCRIPT)).toBe(true);
    // The owner-execute bit must be set, or CI cannot run the script.
    expect(fs.statSync(SCRIPT).mode & 0o100).toBe(0o100);
  });

  test('--help exits 0 and documents every exit code', () => {
    const r = runScript(['--help']);
    expect(r.code).toBe(0);
    for (const c of ['0', '2', '3', '4', '5']) {
      expect(r.stdout).toMatch(new RegExp(`^\\s*${c}\\s+\\S`, 'm'));
    }
  });

  test('no arguments is a usage error, not a silent no-op', () => {
    const r = runScript([]);
    expect(r.code).toBe(2);
  });

  test('a missing env file exits 3 and does not create one', () => {
    const dir = tempDir();
    const missing = path.join(dir, '.env');
    const r = runScript(['--env-file', missing]);
    expect(r.code).toBe(3);
    expect(fs.existsSync(missing)).toBe(false);
  });
});

describe('provision-api-secrets.sh — installing absent secrets', () => {
  test('adds both managed secrets when absent', () => {
    const file = writeEnv('EXISTING=value\n');
    const r = runScript(['--env-file', file]);
    expect(r.code).toBe(0);

    const env = parseEnv(file);
    for (const key of MANAGED) {
      expect(env[key]).toBeDefined();
      expect(env[key]).toMatch(/^[0-9a-f]+$/);
    }
    expect(env.EXISTING).toBe('value');
  });

  test('each generated secret is at least 256 bits', () => {
    const file = writeEnv('X=1\n');
    runScript(['--env-file', file]);
    const env = parseEnv(file);
    for (const key of MANAGED) {
      expect(env[key].length).toBeGreaterThanOrEqual(MIN_HEX_LEN);
    }
  });

  test('the two managed secrets differ from each other', () => {
    const file = writeEnv('X=1\n');
    runScript(['--env-file', file]);
    const env = parseEnv(file);
    expect(env[MANAGED[0]]).not.toBe(env[MANAGED[1]]);
  });

  test('two separate environments never receive the same key', () => {
    const a = writeEnv('X=1\n');
    const b = writeEnv('X=1\n');
    runScript(['--env-file', a]);
    runScript(['--env-file', b]);
    for (const key of MANAGED) {
      expect(parseEnv(a)[key]).not.toBe(parseEnv(b)[key]);
    }
  });

  test('never generates the repository-committed fallback', () => {
    const file = writeEnv('X=1\n');
    expect(runScript(['--env-file', file]).code).toBe(0);
    const env = parseEnv(file);
    // Assert a real value landed FIRST — without this, `undefined !== 'dev-...'`
    // passes even when the script never ran, which would make this a lying green.
    for (const key of MANAGED) expect(env[key]).toMatch(/^[0-9a-f]{64,}$/);
    expect(env.MFA_REMEMBER_SECRET).not.toBe('dev-mfa-remember-secret');
    expect(env.EXPORT_DOWNLOAD_SECRET).not.toBe('dev-export-secret');
  });

  test('amends a file that has no trailing newline without corrupting it', () => {
    const file = writeEnv('LAST_LINE=intact'); // deliberately no \n
    const r = runScript(['--env-file', file]);
    expect(r.code).toBe(0);
    expect(parseEnv(file).LAST_LINE).toBe('intact');
    expect(countOccurrences(file, 'LAST_LINE')).toBe(1);
    for (const key of MANAGED) expect(countOccurrences(file, key)).toBe(1);
  });
});

describe('provision-api-secrets.sh — never replaces a live key', () => {
  test('an already-set secret is left byte-for-byte alone', () => {
    const existing = 'a'.repeat(64);
    const file = writeEnv(`MFA_REMEMBER_SECRET=${existing}\n`);
    const r = runScript(['--env-file', file]);
    expect(r.code).toBe(0);
    expect(parseEnv(file).MFA_REMEMBER_SECRET).toBe(existing);
    expect(r.output).toMatch(/MFA_REMEMBER_SECRET.*already set/i);
  });

  test('re-running changes nothing the second time', () => {
    const file = writeEnv('X=1\n');
    runScript(['--env-file', file]);
    const afterFirst = fs.readFileSync(file, 'utf-8');
    const r = runScript(['--env-file', file]);
    expect(r.code).toBe(0);
    expect(fs.readFileSync(file, 'utf-8')).toBe(afterFirst);
  });

  test('an empty value counts as unset and is filled', () => {
    const file = writeEnv('MFA_REMEMBER_SECRET=\n');
    runScript(['--env-file', file]);
    expect(parseEnv(file).MFA_REMEMBER_SECRET.length).toBeGreaterThanOrEqual(MIN_HEX_LEN);
  });

  test('--rotate replaces a live key, and only the named one', () => {
    const file = writeEnv('X=1\n');
    runScript(['--env-file', file]);
    const before = parseEnv(file);
    const r = runScript(['--env-file', file, '--rotate', 'MFA_REMEMBER_SECRET']);
    expect(r.code).toBe(0);
    const after = parseEnv(file);
    expect(after.MFA_REMEMBER_SECRET).not.toBe(before.MFA_REMEMBER_SECRET);
    expect(after.EXPORT_DOWNLOAD_SECRET).toBe(before.EXPORT_DOWNLOAD_SECRET);
  });

  test('--rotate states the cost before acting', () => {
    const file = writeEnv('X=1\n');
    runScript(['--env-file', file]);
    const r = runScript(['--env-file', file, '--rotate', 'MFA_REMEMBER_SECRET']);
    expect(r.output).toMatch(/sign(ed)? out|invalidat/i);
  });

  test('--rotate rejects a key it does not manage', () => {
    const file = writeEnv('X=1\n');
    const r = runScript(['--env-file', file, '--rotate', 'NOT_A_MANAGED_SECRET']);
    expect(r.code).toBe(2);
  });
});

describe('provision-api-secrets.sh — duplicate keys', () => {
  test('collapses an agreeing duplicate and keeps the value', () => {
    const file = writeEnv('FIREBASE_WEB_API_KEY=same\nOTHER=x\nFIREBASE_WEB_API_KEY=same\n');
    const r = runScript(['--env-file', file]);
    expect(r.code).toBe(0);
    expect(countOccurrences(file, 'FIREBASE_WEB_API_KEY')).toBe(1);
    expect(parseEnv(file).FIREBASE_WEB_API_KEY).toBe('same');
    expect(r.output).toMatch(/FIREBASE_WEB_API_KEY/);
  });

  test('collapsing keeps the LAST occurrence, matching dotenv last-wins', () => {
    // dotenv 17 parses top-down, so the LAST occurrence is the live one. With
    // agreeing values the surviving VALUE is identical either way, so position
    // is the only observable — and it is what pins the retention rule. Asserting
    // it means a first-keeping implementation cannot pass, which matters if the
    // "values must agree" precondition is ever relaxed.
    const file = writeEnv('BEFORE=1\nDUP=same\nMIDDLE=2\nDUP=same\nAFTER=3\n');
    expect(runScript(['--env-file', file]).code).toBe(0);
    expect(countOccurrences(file, 'DUP')).toBe(1);
    expect(parseEnv(file).DUP).toBe('same');
    const keys = fs
      .readFileSync(file, 'utf-8')
      .split('\n')
      .map((l) => /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(l))
      .filter(Boolean)
      .map((m) => m[1]);
    expect(keys.indexOf('DUP')).toBeGreaterThan(keys.indexOf('MIDDLE'));
  });

  test('a disagreeing duplicate exits 4 and applies NOTHING', () => {
    const before = 'FIREBASE_WEB_API_KEY=one\nFIREBASE_WEB_API_KEY=two\n';
    const file = writeEnv(before);
    const r = runScript(['--env-file', file]);
    expect(r.code).toBe(4);
    // Nothing half-applied: no secret installed, file untouched.
    expect(fs.readFileSync(file, 'utf-8')).toBe(before);
    expect(r.output).toMatch(/FIREBASE_WEB_API_KEY/);
  });

  test('--collapse-conflicts-to-live keeps the value the loader already uses', () => {
    // Deleting the earlier copy is NOT choosing a winner: dotenv parses
    // top-down, so the earlier line is already dead to the running service.
    // Removing it therefore cannot change behaviour, which is why this is
    // allowed at all -- but it stays opt-in, because a disagreement is a
    // config mistake a human should see.
    const file = writeEnv('DUP=stale\nKEEP=1\nDUP=live\n');
    const r = runScript(['--env-file', file, '--collapse-conflicts-to-live']);
    expect(r.code).toBe(0);
    expect(countOccurrences(file, 'DUP')).toBe(1);
    expect(parseEnv(file).DUP).toBe('live');
    expect(parseEnv(file).KEEP).toBe('1');
  });

  test('--collapse-conflicts-to-live still installs the managed secrets', () => {
    const file = writeEnv('DUP=stale\nDUP=live\n');
    expect(runScript(['--env-file', file, '--collapse-conflicts-to-live']).code).toBe(0);
    for (const key of MANAGED) {
      expect(parseEnv(file)[key]).toMatch(/^[0-9a-f]{64,}$/);
    }
  });

  test('--collapse-conflicts-to-live names the key but prints neither value', () => {
    const file = writeEnv('DUP=stale-value-here\nDUP=live-value-here\n');
    const r = runScript(['--env-file', file, '--collapse-conflicts-to-live']);
    expect(r.code).toBe(0);
    expect(r.output).toMatch(/DUP/);
    expect(r.output).not.toContain('stale-value-here');
    expect(r.output).not.toContain('live-value-here');
  });

  test('--collapse-conflicts-to-live under --dry-run writes nothing', () => {
    const before = 'DUP=stale\nDUP=live\n';
    const file = writeEnv(before);
    const r = runScript(['--env-file', file, '--collapse-conflicts-to-live', '--dry-run']);
    expect(r.code).toBe(0);
    expect(fs.readFileSync(file, 'utf-8')).toBe(before);
    expect(r.output).toMatch(/DUP/);
  });

  test('the conflict message does not print either conflicting value', () => {
    const file = writeEnv('SOME_KEY=alpha-secret-one\nSOME_KEY=beta-secret-two\n');
    const r = runScript(['--env-file', file]);
    expect(r.code).toBe(4);
    expect(r.output).not.toMatch(/alpha-secret-one|beta-secret-two/);
  });
});

describe('provision-api-secrets.sh — remote mode forwards every local flag', () => {
  // Remote mode is a transport: it uploads this same script and runs it on the
  // target in --env-file mode. Any flag that changes LOCAL behaviour must
  // therefore be passed through, or it silently does nothing over SSH — which
  // is exactly what happened to --collapse-conflicts-to-live on first run.
  const TRANSPORT_ONLY = [
    '--env-file',
    '--host',
    '--remote-dir',
    '--pm2-name',
    '--health-url',
    '--ssh-key',
    '-h',
    '--help',
  ];

  const source = fs.readFileSync(SCRIPT, 'utf-8');

  /** The body of provision_remote(), where forwarding is built. */
  function remoteBody() {
    const start = source.indexOf('provision_remote() {');
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf('\n}', start);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
  }

  /** Every flag the argument parser accepts. */
  function acceptedFlags() {
    const flags = new Set();
    for (const m of source.matchAll(/^\s{4}(-[^)]*)\)/gm)) {
      for (const f of m[1].split('|')) flags.add(f.trim());
    }
    return [...flags];
  }

  test('the parser is discoverable, so this test cannot pass vacuously', () => {
    const flags = acceptedFlags();
    expect(flags).toEqual(expect.arrayContaining(['--env-file', '--dry-run', '--rotate']));
    expect(flags.length).toBeGreaterThanOrEqual(8);
  });

  test('every behaviour-changing flag is forwarded to the target', () => {
    const body = remoteBody();
    const missing = acceptedFlags()
      .filter((f) => !TRANSPORT_ONLY.includes(f))
      .filter((f) => !body.includes(f));
    expect(missing).toEqual([]);
  });
});

describe('provision-api-secrets.sh — secrets never leak', () => {
  test('no generated value appears in stdout or stderr', () => {
    const file = writeEnv('X=1\n');
    const r = runScript(['--env-file', file]);
    const env = parseEnv(file);
    for (const key of MANAGED) {
      expect(env[key].length).toBeGreaterThanOrEqual(MIN_HEX_LEN);
      expect(r.output).not.toContain(env[key]);
    }
  });

  test('no pre-existing value appears in stdout or stderr', () => {
    const live = 'live-secret-value-that-must-not-be-printed';
    const file = writeEnv(`MFA_REMEMBER_SECRET=${live}\nEXPORT_DOWNLOAD_SECRET=${live}2\n`);
    const r = runScript(['--env-file', file]);
    expect(r.code).toBe(0);
    // Prove the script actually reported on both keys — otherwise empty output
    // would satisfy the not-to-contain assertion without running anything.
    for (const key of MANAGED) expect(r.output).toMatch(new RegExp(`${key}.*already set`, 'i'));
    expect(r.output).not.toContain(live);
  });

  test('the reported fingerprint is a hash, not a prefix of the secret', () => {
    const file = writeEnv('X=1\n');
    const r = runScript(['--env-file', file]);
    const value = parseEnv(file).MFA_REMEMBER_SECRET;
    const digest = crypto.createHash('sha256').update(value).digest('hex');
    const shown = /MFA_REMEMBER_SECRET.*?([0-9a-f]{12})/.exec(r.output);
    expect(shown).not.toBeNull();
    expect(digest.startsWith(shown[1])).toBe(true);
    expect(value.startsWith(shown[1])).toBe(false);
  });
});

describe('provision-api-secrets.sh — safety net', () => {
  test('a timestamped backup is written before any change', () => {
    const file = writeEnv('X=1\n');
    runScript(['--env-file', file]);
    const backups = fs.readdirSync(path.dirname(file)).filter((f) => f.startsWith('.env.bak.'));
    expect(backups.length).toBe(1);
    expect(fs.readFileSync(path.join(path.dirname(file), backups[0]), 'utf-8')).toBe('X=1\n');
  });

  test('the backup is readable only by its owner', () => {
    const file = writeEnv('X=1\n');
    runScript(['--env-file', file]);
    const backup = fs.readdirSync(path.dirname(file)).filter((f) => f.startsWith('.env.bak.'))[0];
    const mode = fs.statSync(path.join(path.dirname(file), backup)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test('no backup is left behind when there was nothing to change', () => {
    const file = writeEnv('X=1\n');
    runScript(['--env-file', file]);
    const dir = path.dirname(file);
    const firstCount = fs.readdirSync(dir).filter((f) => f.startsWith('.env.bak.')).length;
    // Anchor the count: 0 === 0 would pass even if the script never ran.
    expect(firstCount).toBe(1);
    expect(runScript(['--env-file', file]).code).toBe(0); // no-op run
    const secondCount = fs.readdirSync(dir).filter((f) => f.startsWith('.env.bak.')).length;
    expect(secondCount).toBe(firstCount);
  });

  test('--dry-run reports intent and writes nothing', () => {
    const before = 'X=1\n';
    const file = writeEnv(before);
    const r = runScript(['--env-file', file, '--dry-run']);
    expect(r.code).toBe(0);
    expect(fs.readFileSync(file, 'utf-8')).toBe(before);
    expect(r.output).toMatch(/would add|dry.run/i);
    for (const key of MANAGED) expect(r.output).toMatch(new RegExp(key));
  });

  test('the env file keeps its original permissions', () => {
    const file = writeEnv('X=1\n');
    fs.chmodSync(file, 0o600);
    expect(runScript(['--env-file', file]).code).toBe(0);
    // The file must actually have been rewritten, or this asserts nothing.
    for (const key of MANAGED) expect(countOccurrences(file, key)).toBe(1);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });
});
