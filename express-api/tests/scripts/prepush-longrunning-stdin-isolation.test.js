/**
 * Pins that long-running commands in the pre-push hook do NOT inherit the
 * hook's stdin.
 *
 * The hook's stdin IS git's pre-push protocol pipe — the
 * `<local ref> <local sha> <remote ref> <remote sha>` lines the force-push
 * guard at the top of the hook reads. Handing that descriptor to a command
 * that outlives the read (Playwright, and every browser it spawns) lets it
 * disturb the pipe, and git then dies with SIGPIPE (exit 141) AFTER the hook
 * has already printed its success line.
 *
 * That failure mode is expensive because it is SILENT-GREEN: the gate reports
 * "✓ Playwright chromium tests passed", the hook exits 0, and the push simply
 * never happens. Observed 2026-07-28 — two 40-minute pushes and a third full
 * 16.8-minute gate all ended with the remote unmoved. Pushes that SKIPPED the
 * Playwright branch succeeded on the identical tree, which is what isolated it.
 */
const fs = require('fs');
const path = require('path');

const HOOK_PATH = path.join(__dirname, '../../../.husky/pre-push');

/**
 * Join backslash continuations into logical lines.
 *
 * `./gradlew sonar` spans five physical lines and carries its redirect on the
 * last one, so testing the matched PHYSICAL line reports a false violation —
 * which this pin did on its first run.
 */
function logicalLines(text) {
  const out = [];
  let buf = '';
  for (const raw of text.split('\n')) {
    // trimEnd(), not /\s+$/ — the regex form is flagged by sonarjs/slow-regex
    // for super-linear backtracking, and the built-in does the same job.
    const line = raw.trimEnd();
    if (line.endsWith('\\')) {
      // trimEnd BEFORE re-adding the separator: `'a \'.slice(0, -1)` leaves a
      // trailing space, which would otherwise double up on every join.
      buf += line.slice(0, -1).trimEnd() + ' ';
    } else {
      out.push(buf + line);
      buf = '';
    }
  }
  if (buf) out.push(buf);
  return out;
}

describe('.husky/pre-push — stdin isolation for long-running commands', () => {
  let hook;
  let lines;

  beforeAll(() => {
    if (!fs.existsSync(HOOK_PATH)) {
      throw new Error(`pre-push hook not found at expected path: ${HOOK_PATH}`);
    }
    hook = fs.readFileSync(HOOK_PATH, 'utf8');
    lines = logicalLines(hook);
  });

  test('the hook still reads git ref lines from stdin (why this matters)', () => {
    // If this ever stops being true the pin below is moot — but the force-push
    // guard depends on it, so it should never stop being true.
    expect(hook).toMatch(/while read -r local_ref local_sha remote_ref remote_sha/);
  });

  test('the Playwright invocation redirects stdin from /dev/null', () => {
    const pw = lines.find((l) => /npx playwright test/.test(l) && !l.trim().startsWith('#'));
    expect(pw).toBeDefined();
    expect(pw).toMatch(/<\s*\/dev\/null/);
  });

  test('no long-running command in the hook is left inheriting stdin', () => {
    // Commands that can outlive the stdin read and spawn children of their own.
    // `git`/`curl`/`grep` are excluded: short-lived, no lingering subprocesses.
    const LONG_RUNNING = [
      /npx playwright test/,
      /\.\/gradlew\s+sonar/,
      /gradlew\s+:shared:jvmTest/,
      /node_modules\/\.bin\/jest/,
    ];
    for (const pattern of LONG_RUNNING) {
      const line = lines.find((l) => pattern.test(l) && !l.trim().startsWith('#'));
      if (!line) continue; // not present in this revision — nothing to pin
      expect(line).toMatch(/<\s*\/dev\/null/);
    }
  });

  test('the continuation joiner actually joins (guards this pin against itself)', () => {
    const joined = logicalLines('a \\\nb \\\nc\nd');
    expect(joined).toEqual(['a b c', 'd']);
  });
});
