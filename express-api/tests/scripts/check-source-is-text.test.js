/**
 * check-source-is-text.test.js
 *
 * A single NUL byte inside a source file makes git classify it as binary.
 * That is not cosmetic: it silently removes the file from every text-based
 * tool at once — `git diff` shows "Binary files differ" instead of the change,
 * code review sees nothing, `git grep`/`grep -I` skip it, and any CI guard
 * built on those (this repo has several) stops inspecting it while still
 * reporting green.
 *
 * That happened for real: `scripts/check-journey-step-coverage.js` shipped
 * with a NUL where a space was intended, inside a template literal. It
 * behaved correctly and every test passed, so nothing pointed at it — the
 * only symptom was `Bin 0 -> 7047 bytes` in a --stat nobody had to read.
 *
 * This gate makes that class of invisibility impossible to reintroduce.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const guard = require(path.resolve(__dirname, '../../../scripts/check-source-is-text.js'));
const { fileHasNulByte, scanFiles, TEXT_EXTENSIONS } = guard;

let tmp;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'source-is-text-'));
});
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const write = (name, buf) => {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, buf);
  return p;
};

describe('detecting a NUL byte', () => {
  test('an ordinary UTF-8 source file is text', () => {
    const p = write('ok.js', "const s = 'héllo — wörld →';\n");
    expect(fileHasNulByte(p)).toBe(false);
  });

  test('a single NUL anywhere makes the file binary', () => {
    // Built byte-wise on purpose: a NUL written as a source-literal space is
    // exactly the mistake this guard exists to catch, and it is just as
    // invisible inside a test file as inside the code under test.
    const p = write(
      'bad.js',
      Buffer.concat([
        Buffer.from('const k = a', 'utf8'),
        Buffer.from([0]),
        Buffer.from('b;\n', 'utf8'),
      ]),
    );
    expect(fileHasNulByte(p)).toBe(true);
  });

  test('a NUL past the first 8KB is still found', () => {
    // git's own heuristic only sniffs the first 8000 bytes. Reproducing that
    // limit would let a NUL hide in any file longer than a page — and the
    // runner this guard protects is 16,000 lines.
    const p = write('late.js', Buffer.concat([Buffer.alloc(20000, 0x61), Buffer.from([0x00])]));
    expect(fileHasNulByte(p)).toBe(true);
  });

  test('an empty file is text, not a crash', () => {
    expect(fileHasNulByte(write('empty.js', ''))).toBe(false);
  });
});

describe('scanning a file list', () => {
  test('offending files are returned; clean ones are not', () => {
    const bad = write('offender.ts', Buffer.from([0x61, 0x00, 0x62]));
    const good = write('clean.ts', 'const a = 1;\n');
    expect(scanFiles([bad, good])).toEqual([bad]);
  });

  test('a file that disappeared mid-scan is skipped, not fatal', () => {
    // git ls-files can name a path deleted between listing and reading.
    expect(scanFiles([path.join(tmp, 'does-not-exist.js')])).toEqual([]);
  });

  test('the extension list covers the languages this repo actually writes', () => {
    for (const ext of ['.js', '.ts', '.kt', '.sh', '.json', '.yml', '.md', '.feature']) {
      expect(TEXT_EXTENSIONS).toContain(ext);
    }
  });
});

describe('the real repository', () => {
  test('no tracked source file contains a NUL byte', () => {
    // The guard's own live verdict. Zero today, and the ratchet is absolute:
    // there is no legitimate reason for a NUL in any of these file types.
    const offenders = guard.scanRepo();
    expect(offenders).toEqual([]);
  });

  test('the scan actually inspected files — a zero from an empty list is not a pass', () => {
    expect(guard.listTrackedSourceFiles().length).toBeGreaterThan(500);
  });
});
