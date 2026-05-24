/**
 * Pins the local-stack memory caps so the 8GB MacBook can run the
 * full local Firebase Emulator + Docker stack during journey testing
 * without crossing the OOM threshold.
 *
 * Caps applied (rationale per service in the YAML comments):
 *   - livekit:        256m  (Go binary)
 *   - minio:          512m  (S3-like, small fixture data)
 *   - mailpit:        128m  (in-memory SMTP sink)
 *   - emulator JVM:   1g    (firestore + auth fixture sizes)
 *
 * Implementation: regex assertions on the raw YAML / shell text via
 * an extract-per-service-block helper that anchors each assertion to
 * a single block. Avoids the cross-boundary false-positive class
 * caught by code-review on the first cut of this file.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const COMPOSE_PATH = path.join(REPO_ROOT, 'local/docker-compose.yml');
const START_SH_PATH = path.join(REPO_ROOT, 'local/start.sh');

/**
 * Extract a single service's YAML block from docker-compose.yml so
 * subsequent assertions are scoped to ONE service and can't drift
 * across boundaries (e.g. asserting livekit's cap by accidentally
 * matching minio's). Anchored on the `^  <name>:$` line and stops
 * at the next `^  <word>:$` line.
 */
function extractServiceBlock(yamlText, serviceName) {
  const lines = yamlText.split('\n');
  const startPattern = new RegExp(`^  ${serviceName}:$`);
  const nextServicePattern = /^ {2}\w[\w-]*:$/;
  let inBlock = false;
  const block = [];
  for (const line of lines) {
    if (startPattern.test(line)) {
      inBlock = true;
      continue;
    }
    if (inBlock) {
      if (nextServicePattern.test(line)) break;
      block.push(line);
    }
  }
  if (!inBlock) {
    throw new Error(
      `Could not find service "${serviceName}" in ${COMPOSE_PATH}. ` +
        'Service was renamed or removed — update this test to match.',
    );
  }
  return block.join('\n');
}

describe('Local-stack resource diet', () => {
  describe('docker-compose.yml — per-service memory caps', () => {
    let yamlText;
    let livekitBlock;
    let minioBlock;
    let mailpitBlock;

    beforeAll(() => {
      yamlText = fs.readFileSync(COMPOSE_PATH, 'utf8');
      livekitBlock = extractServiceBlock(yamlText, 'livekit');
      minioBlock = extractServiceBlock(yamlText, 'minio');
      mailpitBlock = extractServiceBlock(yamlText, 'mailpit');
    });

    // Service-body lines under a top-level `  service:` header are
    // indented with exactly 4 spaces in this file's YAML style. Using
    // ` {4}` (fixed-width) avoids sonarjs/slow-regex flagging on the
    // unbounded `\s+` quantifier, and is also more precise.

    // livekit — Go binary, ~50-100MB steady-state; 256m cap is generous
    // but prevents balloon under voice-room peer-connection spikes.
    test('livekit has mem_limit 256m', () => {
      expect(livekitBlock).toMatch(/^ {4}mem_limit: 256m$/m);
    });

    test('livekit has memswap_limit 256m (swap disabled)', () => {
      expect(livekitBlock).toMatch(/^ {4}memswap_limit: 256m$/m);
    });

    // minio — pages recent blocks; 512m is generous for fixture sizes.
    test('minio has mem_limit 512m', () => {
      expect(minioBlock).toMatch(/^ {4}mem_limit: 512m$/m);
    });

    test('minio has memswap_limit 512m (swap disabled)', () => {
      expect(minioBlock).toMatch(/^ {4}memswap_limit: 512m$/m);
    });

    // mailpit — tiny in-memory SMTP sink, 128m is plenty.
    test('mailpit has mem_limit 128m', () => {
      expect(mailpitBlock).toMatch(/^ {4}mem_limit: 128m$/m);
    });

    test('mailpit has memswap_limit 128m (swap disabled)', () => {
      expect(mailpitBlock).toMatch(/^ {4}memswap_limit: 128m$/m);
    });

    // Round-3 gap: pin the relationship mem_limit == memswap_limit so a
    // future edit that touches only memswap_limit (intent: enable swap
    // headroom) breaks loudly, surfacing the policy decision rather than
    // silently passing the two independent value tests.
    const memEqualitySpec = [
      ['livekit', () => livekitBlock],
      ['minio', () => minioBlock],
      ['mailpit', () => mailpitBlock],
    ];
    test.each(memEqualitySpec)('%s mem_limit equals memswap_limit', (_, getBlock) => {
      const block = getBlock();
      const memLimit = block.match(/^ {4}mem_limit: (\S+)$/m)?.[1];
      const memswapLimit = block.match(/^ {4}memswap_limit: (\S+)$/m)?.[1];
      expect(memLimit).toBeDefined();
      expect(memswapLimit).toBeDefined();
      expect(memLimit).toBe(memswapLimit);
    });
  });

  describe('start.sh — Firebase Emulator JVM heap cap is scoped to the firebase process', () => {
    let scriptText;

    beforeAll(() => {
      scriptText = fs.readFileSync(START_SH_PATH, 'utf8');
    });

    // The cap is applied via `env VAR=val cmd` prefix so it scopes to
    // the firebase CLI process only — NOT exported at shell-scope where
    // it would leak into the later `./gradlew` invocation in Step 7
    // and starve Kotlin compilation (which needs 2-4 GB heap).
    test('uses env-prefix scoping, not a shell-scope export', () => {
      // The operative line must be of the form
      // `env JAVA_TOOL_OPTIONS="-Xmx1g" npx firebase emulators:start ...`
      // anchored at line-start to skip comments that reference the
      // identifier.
      expect(scriptText).toMatch(/^env JAVA_TOOL_OPTIONS="-Xmx1g" npx firebase emulators:start/m);
    });

    // Defence-in-depth against C1 recurring: ensure a shell-scope
    // `export JAVA_TOOL_OPTIONS=...` doesn't sneak back in. The
    // env-prefix form above is the ONLY acceptable scoping.
    test('does NOT export JAVA_TOOL_OPTIONS at shell scope (would leak into gradlew)', () => {
      // Match `export JAVA_TOOL_OPTIONS` anchored at line-start so
      // comments mentioning the identifier don't false-positive. The
      // `env` prefix on the operative line doesn't match this pattern.
      expect(scriptText).not.toMatch(/^export JAVA_TOOL_OPTIONS=/m);
    });

    // start.sh has a later `./gradlew assembleLocalDebug` invocation
    // (Step 7). Verify the firebase emulator launch precedes it,
    // since the env-scoping depends on order. Both names appear in
    // comments earlier in the file, so we match operative-line
    // patterns rather than bare substrings.
    test('the env-prefixed firebase launch runs before any gradlew invocation', () => {
      // Operative firebase line: starts with `env ` at column 0.
      const firebaseMatch = scriptText.match(
        /^env JAVA_TOOL_OPTIONS=.*npx firebase emulators:start/m,
      );
      // Operative gradlew line: `./gradlew` preceded by whitespace
      // OR `&&` — i.e. actual shell command, not a comment word.
      const gradlewMatch = scriptText.match(/(?:&&|\s)\.\/gradlew\b/);
      // I1 fix (round 2): both are REQUIRED to exist — without the
      // gradlew call this whole ordering test is meaningless, and a
      // PR that removes the gradlew call should fail loudly, not
      // silently vacuously-pass.
      expect(firebaseMatch).not.toBeNull();
      expect(gradlewMatch).not.toBeNull();
      expect(firebaseMatch.index).toBeLessThan(gradlewMatch.index);
    });

    // I2 fix (round 2): pin the trailing `&`. Without `&`, the script
    // blocks at the firebase emulators:start call indefinitely and
    // never reaches Step 3 onward. `FIREBASE_PID=$!` would capture
    // the wrong PID (the shell's, not firebase's).
    test('firebase emulator launch is backgrounded with trailing &', () => {
      expect(scriptText).toMatch(/^ {2}--export-on-exit=local\/firebase-emulator-data &$/m);
    });

    // Coverage gap (round 2): pin the FIREBASE_PID=$! capture
    // immediately after the firebase backgrounded command. A refactor
    // that moves it or captures the wrong PID would break cleanup
    // (the trap function relies on FIREBASE_PID being valid).
    test('FIREBASE_PID is captured on the line immediately after the firebase & command', () => {
      const lines = scriptText.split('\n');
      const ampLineIdx = lines.findIndex((l) =>
        l.match(/^ {2}--export-on-exit=local\/firebase-emulator-data &$/),
      );
      expect(ampLineIdx).toBeGreaterThanOrEqual(0);
      expect(lines[ampLineIdx + 1]).toMatch(/^FIREBASE_PID=\$!$/);
    });

    // Round-3 gap (I3 — real bug): pin that the Express API's
    // backgrounded `node` command captures `node`'s PID, not the PID
    // of a downstream pipe command. The original line piped node
    // through sed for colour-prefix, which makes `$!` capture sed's
    // PID — cleanup would kill sed but orphan node, leaving the API
    // port held open. The fix replaces the pipe with process
    // substitution (`> >(sed ...) 2>&1`), so node remains the
    // backgrounded process and $! captures it.
    test('API_PID is captured immediately after a backgrounded node, with no pipe before &', () => {
      const lines = scriptText.split('\n');
      const apiLineIdx = lines.findIndex((l) => l.match(/\bnode src\/index\.js\b.*&\s*$/));
      expect(apiLineIdx).toBeGreaterThanOrEqual(0);
      // The line must NOT contain a pipe (`|`) — if it does, $!
      // captures the last pipeline stage's PID, not node's. Process
      // substitution `>(...)` is fine because the parens are not a
      // pipe character. Plain `.includes('|')` is non-regex and
      // can't backtrack — surface-level check is sufficient because
      // a legitimate node invocation has no reason to contain `|`.
      const apiLine = lines[apiLineIdx];
      expect(apiLine.includes('|')).toBe(false);
      // I2 fix (round 4): also pin that process substitution is the
      // mechanism. Without this, a future edit to `> /dev/null` would
      // pass the pipe-absence check while discarding all API output —
      // silently regressing log visibility (the whole reason sed was
      // there in the first place).
      expect(apiLine.includes('>(')).toBe(true);
      expect(lines[apiLineIdx + 1]).toMatch(/^API_PID=\$!$/);
    });

    // Round-3 gap: pin the keep-alive `wait $FIREBASE_PID` line at
    // the end of start.sh. A rename of the PID variable would break
    // the script's "keep running until Ctrl+C" behaviour silently.
    //
    // Round-4 fix (C1): `|| true` is required. Under `set -e`, an
    // unguarded `wait` propagates a non-zero exit code from a crashed
    // Firebase emulator and aborts the shell BEFORE reaching the
    // cleanup() call below. That leaves Docker containers running.
    // `|| true` makes the wait fall through to cleanup regardless of
    // Firebase's exit code.
    test('keep-alive uses `wait $FIREBASE_PID || true` (guarded against set-e)', () => {
      expect(scriptText).toMatch(/^wait "?\$FIREBASE_PID"? \|\| true$/m);
    });

    // Round-4 fix (I1): the keep-alive wait must be positioned AFTER
    // the "Press Ctrl+C to stop..." banner — without this, a refactor
    // moving the wait earlier (e.g., to step 3 for readiness) would
    // pass the line-content test but break the run-until-Ctrl+C
    // contract by hanging mid-startup before the user-facing banner.
    test('keep-alive wait is positioned after the Press-Ctrl+C banner', () => {
      const lines = scriptText.split('\n');
      const bannerIdx = lines.findIndex((l) => l.includes('Press Ctrl+C'));
      const waitIdx = lines.findIndex((l) => /^wait "?\$FIREBASE_PID"? \|\| true$/.test(l));
      expect(bannerIdx).toBeGreaterThanOrEqual(0);
      expect(waitIdx).toBeGreaterThanOrEqual(0);
      expect(waitIdx).toBeGreaterThan(bannerIdx);
    });
  });

  // Coverage gap (round 2): exercise the error branch of
  // extractServiceBlock so a malformed-yaml or renamed-service
  // regression surfaces with the intended diagnostic, not a silent
  // beforeAll crash that takes down every test in the file.
  describe('extractServiceBlock helper — error branch', () => {
    let yamlText;

    beforeAll(() => {
      yamlText = fs.readFileSync(COMPOSE_PATH, 'utf8');
    });

    test('throws a clear error for unknown service names', () => {
      expect(() => extractServiceBlock(yamlText, 'nonexistent-service')).toThrow(
        /Could not find service "nonexistent-service"/,
      );
    });

    // Round-3 gap (I4): the helper constructs a RegExp from the
    // service-name arg. A name with regex metacharacters (e.g.
    // `livekit.*`) would build a valid but over-broad pattern.
    // The helper has no input sanitisation — for now only
    // hard-coded service names are passed, but a future
    // dynamic-name caller would silently match the wrong block or
    // hit confusing failures. Pin the failure-with-metachar case so
    // a future input-sanitisation refactor is forced through TDD.
    test('does not silently succeed for service names with regex metacharacters', () => {
      // Currently `livekit.*` would match `^  livekit:` (since
      // `.*` matches zero chars) — i.e. it WOULD pass through and
      // return livekit's block, which is wrong. This test pins
      // the current (limited) behaviour and forces the next caller
      // who hits this case to add explicit sanitisation.
      //
      // Per the round-3 reviewer: this is a low-severity coverage
      // gap, low-priority because no current caller passes user
      // input. Pinning makes the gap visible.
      expect(() => extractServiceBlock(yamlText, 'livekit.*nonexistent')).toThrow(
        /Could not find service "livekit\.\*nonexistent"/,
      );
    });
  });
});
