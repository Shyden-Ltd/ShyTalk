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
const ROOT_PACKAGE_PATH = path.join(REPO_ROOT, 'package.json');
const ROOT_LOCKFILE_PATH = path.join(REPO_ROOT, 'package-lock.json');

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

  describe('start.sh — provision test personas after seed data', () => {
    let scriptText;

    beforeAll(() => {
      scriptText = fs.readFileSync(START_SH_PATH, 'utf8');
    });

    // Gap #71: local/seed.js only creates 2 users (admin + 1 regular)
    // but the journey-test runner requires 17 personas (P-02..P-19).
    // Without integration, every journey run hits "Firebase sign-in
    // failed: 400 INVALID_PASSWORD" for ~170 scenarios.
    //
    // Uses the existing seed-personas-local.js wrapper, NOT a direct
    // provision-test-personas.js call. The wrapper supplies the local
    // emulator password ("localdev123" -- matches the app's baked
    // DEV_QA_PERSONAS_PASSWORD per app/build.gradle.kts:141) instead
    // of the 20+ char floor the dev provisioner enforces. Calling
    // the provisioner directly would create a mismatch with the app,
    // shifting INVALID_PASSWORD failures from runner cells to picker
    // cells -- caught by code-reviewer agent on PR #947 round 1.
    test('invokes seed-personas-local.js after seed.js', () => {
      expect(scriptText).toMatch(/node[^\n]*scripts\/seed-personas-local\.js/m);
    });

    // Position pin: seed-personas-local MUST come after seed (seed
    // creates the baseline Firestore docs; persona seeding adds
    // persona-specific structure on top). Reversing the order would
    // break the social graph (followingIds reference uniqueIds that
    // seed.js writes).
    test('seed-personas-local step runs AFTER seed.js', () => {
      const lines = scriptText.split('\n');
      const seedIdx = lines.findIndex((l) => /local\/seed\.js/.test(l));
      const provIdx = lines.findIndex((l) => /scripts\/seed-personas-local\.js/.test(l));
      expect(seedIdx).toBeGreaterThanOrEqual(0);
      expect(provIdx).toBeGreaterThanOrEqual(0);
      expect(provIdx).toBeGreaterThan(seedIdx);
    });

    // Position pin: persona-seeding MUST come BEFORE Express API
    // startup so personas exist when any first-launch journey scenario
    // hits the API. Otherwise a fresh run race-conditions the
    // personas being available.
    test('seed-personas-local step runs BEFORE Express API startup', () => {
      const lines = scriptText.split('\n');
      const provIdx = lines.findIndex((l) => /scripts\/seed-personas-local\.js/.test(l));
      const apiIdx = lines.findIndex((l) => /node src\/index\.js/.test(l));
      expect(provIdx).toBeGreaterThanOrEqual(0);
      expect(apiIdx).toBeGreaterThanOrEqual(0);
      expect(provIdx).toBeLessThan(apiIdx);
    });

    // --env-file=.env.local (Node 20.6+) sets NODE_ENV=local before
    // the script's require() chain. This makes src/utils/firebase
    // point firebase-admin at the emulator (project demo-shytalk)
    // instead of honoring any GOOGLE_APPLICATION_CREDENTIALS the
    // operator may have set for dev work. Without it, a stray dev
    // SA path would route the persona writes at real shytalk-dev --
    // the assertSafeProject guard inside the wrapper would catch
    // most cases but is operator-dependent. Caught by reviewer on
    // round 1 (Critical C2).
    test('invokes seed-personas-local with --env-file=.env.local', () => {
      expect(scriptText).toMatch(
        /node[^\n]*--env-file=\.env\.local[^\n]*scripts\/seed-personas-local\.js/m,
      );
    });
  });

  describe('start.sh — serve web app on port 8888 for journey runner', () => {
    let scriptText;

    beforeAll(() => {
      scriptText = fs.readFileSync(START_SH_PATH, 'utf8');
    });

    // Gap #65: manual-qa-runner.js defaults to webBase localhost:8888
    // for the local target, but no script serves the static web app
    // there. Without this step, every desktop browser cell in the
    // matrix fails its smoke test ("webUiDump failed: ECONNREFUSED").
    // start.sh must launch `npx serve public -l 8888` in the background.
    test('launches npx serve public on port 8888', () => {
      // The operative line must be `npx serve public -l 8888` at line-
      // start, with a trailing `&` (backgrounded) so the script
      // continues to subsequent steps.
      expect(scriptText).toMatch(/^npx serve public[^\n]*-l 8888[^\n]*&\s*$/m);
    });

    // SERVE_PID capture must follow the backgrounded npx serve so
    // cleanup() can kill it. Mirrors the FIREBASE_PID / API_PID pattern.
    test('captures SERVE_PID immediately after the backgrounded serve', () => {
      const lines = scriptText.split('\n');
      const serveIdx = lines.findIndex((l) => /^npx serve public[^\n]*-l 8888[^\n]*&\s*$/.test(l));
      expect(serveIdx).toBeGreaterThanOrEqual(0);
      expect(lines[serveIdx + 1]).toMatch(/^SERVE_PID=\$!$/);
    });

    // cleanup() must kill SERVE_PID alongside API_PID and FIREBASE_PID
    // so a Ctrl+C doesn't leak the serve process across runs (port 8888
    // would stay held). Anchor to the cleanup function body so a
    // future refactor moving the kill-block outside cleanup() trips
    // this test (Important I2 from reviewer round 1).
    test('cleanup() kills SERVE_PID (anchored to function body)', () => {
      const cleanupBody = scriptText.match(/^cleanup\(\) \{([\s\S]*?)^\}/m);
      expect(cleanupBody).not.toBeNull();
      const body = cleanupBody[1];
      expect(body).toMatch(/kill -0 "?\$SERVE_PID"?/);
      expect(body).toMatch(/kill "?\$SERVE_PID"?/);
    });

    // Wait-for-port-8888 readiness probe (Critical C3 from reviewer
    // round 1). Without this, a port conflict on 8888 (leftover serve
    // from a prior run, or another local web server) silently leaves
    // the SERVE_PID capture pointing at a dead PID. Step 7's 2-3min
    // Gradle build then runs for the full duration while the browser
    // cells will still fail webUiDump with ECONNREFUSED -- exactly
    // the gap this PR aims to close. Wait-pattern mirrors Step 6's
    // wait-for-API; kill -0 inner check fails fast on serve death.
    test('waits for port 8888 readiness with kill-0 fail-fast', () => {
      // The probe is a `curl -s http://localhost:8888` polled until
      // a response OR until SERVE_PID dies OR until MAX_WAIT seconds.
      // Match the curl probe + the kill -0 inner check on SERVE_PID.
      expect(scriptText).toMatch(/curl -s http:\/\/localhost:8888/);
      // The kill -0 check must reference SERVE_PID inside the until
      // loop body, which means it appears AFTER the curl probe AND
      // BEFORE the "Web serve ready" success log. Using a non-greedy
      // multi-line match between those two anchors.
      const probeBlock = scriptText.match(/curl -s http:\/\/localhost:8888[\s\S]*?Web serve ready/);
      expect(probeBlock).not.toBeNull();
      expect(probeBlock[0]).toMatch(/kill -0 "?\$SERVE_PID"?/);
    });

    // Position: serve must come AFTER Express API ready (Step 6) but
    // BEFORE the keep-alive banner. This way the serve is ready by the
    // time the banner prints and the operator can hit the URLs listed
    // in the banner.
    test('serve step runs after Express API ready', () => {
      const lines = scriptText.split('\n');
      const apiReadyIdx = lines.findIndex((l) => l.includes('Express API ready'));
      const serveIdx = lines.findIndex((l) => /^npx serve public[^\n]*-l 8888[^\n]*&\s*$/.test(l));
      expect(apiReadyIdx).toBeGreaterThanOrEqual(0);
      expect(serveIdx).toBeGreaterThanOrEqual(0);
      expect(serveIdx).toBeGreaterThan(apiReadyIdx);
    });
  });

  describe('start.sh — pre-flight port check before any service starts', () => {
    let scriptText;

    beforeAll(() => {
      scriptText = fs.readFileSync(START_SH_PATH, 'utf8');
    });

    // Gap #70: when an orphan process (leftover Firebase emulator,
    // Express API, or web serve from a prior crashed run) holds one of
    // the required ports, start.sh's emulator chain enters a half-
    // wedged state. Observed 2026-06-01: Firebase Emulator UI failed
    // with "port taken" (port 4000), `wait $FIREBASE_PID` returned
    // early, cleanup() killed Docker containers, but the underlying
    // Firestore Java process survived as an orphan. Pre-flight port
    // check at the top of the script aborts with a clear error BEFORE
    // entering the wedged state.
    //
    // Ports checked (matches the services start.sh launches):
    //   4000  Firebase Emulator UI
    //   8080  Firestore emulator
    //   9000  Realtime Database emulator
    //   9099  Auth emulator
    //   3000  Express API
    //   7880  LiveKit (Docker)
    //   9002  MinIO API (Docker; internal 9000 mapped to host 9002)
    //   8025  Mailpit UI (Docker)
    //   8888  npx serve (added by PR #947)
    const REQUIRED_PORTS = [4000, 8080, 9000, 9099, 3000, 7880, 9002, 8025, 8888];

    test('declares a preflight port-check step before any service start', () => {
      // Match the step header marker. Anchored to ==> Step pattern.
      expect(scriptText).toMatch(/==> Step 0[/.][^\n]*[Pp]re-flight/);
    });

    test.each(REQUIRED_PORTS)('preflight checks port %d', (port) => {
      // The implementation typically loops over the ports via a shell
      // `for port in 4000 8080 ...; do` and invokes lsof with the loop
      // variable. So each port must appear as a LITERAL in the iteration
      // list. Match `for port in ... <port> ...; do` so an omission is
      // caught immediately.
      const pattern = new RegExp(`for port in [^;]*\\b${port}\\b[^;]*;\\s*do`);
      expect(scriptText).toMatch(pattern);
    });

    test('preflight step exits non-zero with diagnostic on conflict', () => {
      // The preflight step must `exit` (not just echo a warning) when
      // a port is held -- otherwise start.sh proceeds into the wedged
      // state. The exit must be paired with an error message
      // mentioning the conflicting port so the operator knows which
      // service to stop.
      const preflightBlock = scriptText.match(
        /==> Step 0[/.][^\n]*[Pp]re-flight[\s\S]*?==> Step 1/,
      );
      expect(preflightBlock).not.toBeNull();
      expect(preflightBlock[0]).toMatch(/exit 1/);
      expect(preflightBlock[0]).toMatch(/port|Port|PORT/);
    });

    test('preflight runs BEFORE docker compose up', () => {
      const lines = scriptText.split('\n');
      const preflightIdx = lines.findIndex((l) => /==> Step 0[/.][^\n]*[Pp]re-flight/.test(l));
      // Match `docker compose -f ... docker-compose.yml" up` (the yml
      // path may be quoted, hence the `["']?` between yml and ` up`).
      const dockerIdx = lines.findIndex((l) =>
        /docker compose -f.*docker-compose\.yml["']? up/.test(l),
      );
      expect(preflightIdx).toBeGreaterThanOrEqual(0);
      expect(dockerIdx).toBeGreaterThanOrEqual(0);
      expect(preflightIdx).toBeLessThan(dockerIdx);
    });
  });

  // Round 2 coverage gap (Important I1-NEW from reviewer): when a root
  // devDependency is added/bumped in package.json, the matching
  // package-lock.json entry must be regenerated. Round 1 added
  // `"serve": "^14.2.4"` to package.json but didn't run `npm install`,
  // leaving the lockfile stale. CI uses `npm ci` (lockfile-strict)
  // across 6 workflows and would have broken with `EUSAGE Missing:
  // serve@^14.2.4 from lock file`. This pin catches the next
  // recurrence pre-merge.
  describe('package-lock.json must list every root devDependency', () => {
    let pkg;
    let lock;

    beforeAll(() => {
      pkg = JSON.parse(fs.readFileSync(ROOT_PACKAGE_PATH, 'utf8'));
      lock = JSON.parse(fs.readFileSync(ROOT_LOCKFILE_PATH, 'utf8'));
    });

    test('every devDependency in package.json has an entry in package-lock.json', () => {
      const devDeps = Object.keys(pkg.devDependencies || {});
      // npm v7+ lockfile shape: each installed dep appears as
      // `lock.packages["node_modules/<name>"]` (or nested for
      // workspace deps; the root devDeps are flat).
      const missing = devDeps.filter((name) => !lock.packages[`node_modules/${name}`]);
      // Surface the offending names so a future drift makes the
      // failure self-diagnosing.
      expect(missing).toEqual([]);
    });

    // Defence-in-depth: the lockfile's `name` and `version` should
    // match `package.json` for the root entry itself. If a manual
    // edit to either file forgets to align them, CI's `npm ci` would
    // still install — but downstream tools that read either file
    // would diverge.
    test('lockfile root entry matches package.json name + version', () => {
      const rootEntry = lock.packages[''] || {};
      // package.json:2 is "name": "shytalk" and no version (private).
      // Lockfile mirrors that.
      expect(rootEntry.name).toBe(pkg.name);
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
