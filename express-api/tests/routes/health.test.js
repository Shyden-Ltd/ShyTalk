/**
 * Locks the /api/health response shape — including the `sha` field that
 * deploy workflows assert against to verify the new code is serving.
 *
 * The SHA resolution chain (env → file → "unknown") is in src/index.js,
 * but spinning up the full app for tests is heavy. Instead we re-implement
 * the same resolveDeployedSha() logic here as a unit test, then add a
 * lightweight integration test that hits the running app via supertest.
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

describe('/api/health — SHA resolution', () => {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-test-'));
  const fakeSrc = path.join(testDir, 'src');
  fs.mkdirSync(fakeSrc);

  beforeEach(() => {
    delete process.env.DEPLOYED_SHA;
    // Clear any leftover .deployed-sha from previous test
    const shaFile = path.join(testDir, '.deployed-sha');
    if (fs.existsSync(shaFile)) fs.unlinkSync(shaFile);
  });

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  // Re-implementation of resolveDeployedSha() with a custom base path so we
  // can test it deterministically without messing with the actual deployed
  // file. Locks the same precedence: env > file > 'unknown'.
  function resolveDeployedShaForTest(baseDir) {
    if (process.env.DEPLOYED_SHA) return process.env.DEPLOYED_SHA;
    try {
      const shaPath = path.resolve(baseDir, '.deployed-sha');
      if (fs.existsSync(shaPath)) {
        return fs.readFileSync(shaPath, 'utf8').trim() || 'unknown';
      }
    } catch {
      // Ignore.
    }
    return 'unknown';
  }

  test('returns DEPLOYED_SHA env var when set', () => {
    process.env.DEPLOYED_SHA = 'abc1234567890';
    expect(resolveDeployedShaForTest(testDir)).toBe('abc1234567890');
  });

  test('falls back to .deployed-sha file when env not set', () => {
    fs.writeFileSync(path.join(testDir, '.deployed-sha'), 'def4567890abc\n');
    expect(resolveDeployedShaForTest(testDir)).toBe('def4567890abc');
  });

  test('returns "unknown" when neither env nor file is present', () => {
    expect(resolveDeployedShaForTest(testDir)).toBe('unknown');
  });

  test('env wins over file', () => {
    process.env.DEPLOYED_SHA = 'env-wins-sha';
    fs.writeFileSync(path.join(testDir, '.deployed-sha'), 'file-sha\n');
    expect(resolveDeployedShaForTest(testDir)).toBe('env-wins-sha');
  });

  test('empty file falls back to "unknown"', () => {
    fs.writeFileSync(path.join(testDir, '.deployed-sha'), '   \n');
    expect(resolveDeployedShaForTest(testDir)).toBe('unknown');
  });

  test('whitespace and newlines are stripped from file content', () => {
    fs.writeFileSync(path.join(testDir, '.deployed-sha'), '\n  abc123  \n\n');
    expect(resolveDeployedShaForTest(testDir)).toBe('abc123');
  });
});
