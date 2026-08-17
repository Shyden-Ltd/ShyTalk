/* eslint-disable sonarjs/no-os-command-from-path --
 * Spawns the hardcoded `bash` binary with literal argv to execute the REAL
 * "Ensure iOS platform runtime is installed" step extracted from
 * deploy-dev.yml, against canned `xcodebuild`/`xcrun` shims on PATH. No
 * user-controlled command reaches the shell. */
/**
 * `Ensure iOS platform runtime is installed` — the step, EXECUTED.
 *
 * ## The defect this exists to close
 *
 * The step was one unconditional line, `sudo xcodebuild -downloadPlatform
 * iOS`, and it has now failed in BOTH possible directions:
 *
 * 1. **Wrong by passing** (recorded in the step's own comment): an iOS
 *    platform WAS present but not the required version, so the command
 *    exited 0 as a no-op and every archive died ~20 minutes later with
 *    "iOS 26.0 is not installed".
 * 2. **Wrong by failing** (2026-08-16, runs 31955605141 and 31958212267 on
 *    the same develop tip): `Finding content... / Unable to connect to
 *    simulator. / exit 70`, before any build ran. Two runs of the same
 *    workflow had succeeded ~3 hours earlier, so the runner image or the
 *    Apple-side service changed state — not the code.
 *
 * Both share ONE cause: the step never asked which runtime was present
 * before acting. A device archive needs the **iphoneos SDK**; the simulator
 * runtime that `-downloadPlatform` also fetches is not required for it, which
 * is why the download can fail while the archive would have been fine.
 *
 * ## Why this executes the step instead of pinning it
 *
 * A regex over the YAML cannot tell a correct version check from one that
 * matches any runtime — which is precisely the defect. So the extracted shell
 * runs for real against canned tools that report a chosen state and record
 * every invocation.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const WORKFLOW = path.join(REPO_ROOT, '.github/workflows/deploy-dev.yml');
const STEP_NAME = 'Ensure iOS platform runtime is installed';

/** The minimum the archive needs, from IPHONEOS_DEPLOYMENT_TARGET. */
const REQUIRED_MAJOR = 18;

/** Extract a named step's `run:` body, de-indented exactly as GitHub does. */
function extractRunBlock(yaml, stepName) {
  const lines = yaml.split('\n');
  const nameIdx = lines.findIndex((l) => l.includes(`- name: ${stepName}`));
  if (nameIdx === -1) throw new Error(`step not found: ${stepName}`);
  let runIdx = -1;
  for (let i = nameIdx + 1; i < lines.length; i++) {
    if (/^\s+run:\s*\|/.test(lines[i])) {
      runIdx = i;
      break;
    }
    if (/^\s{0,8}- name:/.test(lines[i])) break;
  }
  if (runIdx === -1)
    throw new Error(`run: | not found under "${stepName}" — is it still a one-liner?`);
  const indent = lines[runIdx].length - lines[runIdx].trimStart().length + 2;
  const pad = ' '.repeat(indent);
  const body = [];
  for (let i = runIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '') {
      body.push('');
      continue;
    }
    if (!l.startsWith(pad)) break;
    body.push(l.slice(indent));
  }
  return body.join('\n');
}

/**
 * Run the REAL step with canned tools.
 *
 * @param {object} opts
 * @param {string[]} opts.sdks    iOS SDK versions `xcodebuild -showsdks` reports
 * @param {boolean} [opts.downloadFails]  make `-downloadPlatform` exit 70 with
 *   the exact stderr the live runners produced
 * @param {boolean} [opts.downloadInstallsNothing]  succeed but change nothing —
 *   the "wrong by passing" direction
 */
function runStep({ sdks, downloadFails = false, downloadInstallsNothing = false }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-runtime-'));
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir);
  const calls = path.join(dir, 'calls.log');
  fs.writeFileSync(calls, '');
  // State file so a "successful" download can actually change what the next
  // query reports — otherwise the install path could never be distinguished
  // from a no-op.
  const state = path.join(dir, 'sdks');
  // TRAILING NEWLINE, deliberately: `while read -r v` returns non-zero on a
  // final line without one, so the loop body never runs for it and the shim
  // silently reports NO SDKs — a harness bug that would have looked exactly
  // like the step failing to detect a present SDK.
  fs.writeFileSync(state, sdks.map((v) => `${v}\n`).join(''));

  const showsdks = `iOS SDKs:
$(while read -r v || [ -n "$v" ]; do [ -n "$v" ] && echo "	iOS $v                  	-sdk iphoneos$v"; done < "$IOS_SDK_STATE")

macOS SDKs:
	macOS 26.0                    	-sdk macosx26.0`;

  fs.writeFileSync(
    path.join(binDir, 'xcodebuild'),
    `#!/bin/bash
echo "xcodebuild $*" >> "$IOS_CALLS"
case "$*" in
  *-showsdks*)
    cat <<EOF
${showsdks}
EOF
    ;;
  *-downloadPlatform*)
    if [ "$IOS_DOWNLOAD_FAILS" = "1" ]; then
      echo "Finding content..."
      echo "Unable to connect to simulator."
      exit 70
    fi
    if [ "$IOS_DOWNLOAD_NOOP" != "1" ]; then printf '%s\\n' "${REQUIRED_MAJOR}.0" >> "$IOS_SDK_STATE"; fi
    echo "Downloaded."
    ;;
  *) echo "unexpected xcodebuild: $*" >&2; exit 64 ;;
esac
`,
    { mode: 0o755 },
  );
  // `sudo` must not actually elevate in a test; pass straight through.
  fs.writeFileSync(path.join(binDir, 'sudo'), '#!/bin/bash\nexec "$@"\n', { mode: 0o755 });

  const script =
    'set -eo pipefail\n' + extractRunBlock(fs.readFileSync(WORKFLOW, 'utf8'), STEP_NAME);
  const run = spawnSync('bash', ['-c', script], {
    cwd: dir,
    encoding: 'utf8',
    stdio: 'pipe',
    env: {
      PATH: `${binDir}:${process.env.PATH}`,
      HOME: dir,
      RUNNER_TEMP: dir,
      IOS_CALLS: calls,
      IOS_SDK_STATE: state,
      IOS_DOWNLOAD_FAILS: downloadFails ? '1' : '',
      IOS_DOWNLOAD_NOOP: downloadInstallsNothing ? '1' : '',
    },
  });
  const invocations = fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean);
  fs.rmSync(dir, { recursive: true, force: true });
  return {
    status: run.status ?? 1,
    out: String(run.stdout || '') + String(run.stderr || ''),
    invocations,
    downloads: invocations.filter((c) => c.includes('-downloadPlatform')),
  };
}

describe('the required SDK is already present', () => {
  test('the download is SKIPPED entirely', () => {
    const { status, downloads } = runStep({ sdks: ['18.0'] });
    expect({ status, downloads }).toEqual({ status: 0, downloads: [] });
  });

  test('a NEWER SDK also satisfies it', () => {
    // The runner image ships whatever it ships. Requiring an exact match would
    // trigger a pointless download on every newer image.
    const { status, downloads } = runStep({ sdks: ['26.0'] });
    expect({ status, downloads }).toEqual({ status: 0, downloads: [] });
  });

  test('with 26.9 AND 26.10 installed it reports 26.10 — version order, not text', () => {
    // BOTH must be present or sort order cannot matter: an earlier version of
    // this test passed a single SDK and would have passed under a plain
    // `sort` too — a pin that could not fail
    // ([[feedback-version-picked-by-text-sort-selects-the-oldest]]).
    //
    // Lexicographically "26.10" < "26.9", so a plain sort names the OLDER one.
    // The decision is on the major version and is unaffected either way; what
    // this protects is the DIAGNOSTIC — the log must name what is actually
    // newest, or the next person debugging a version problem is misled by it.
    const { status, downloads, out } = runStep({ sdks: ['26.9', '26.10'] });
    expect({ status, downloads }).toEqual({ status: 0, downloads: [] });
    expect(out).toContain('26.10');
    expect(out).not.toContain('26.9 present');
  });

  test('it says which version it found, so the log is self-explaining', () => {
    const { out } = runStep({ sdks: ['26.0'] });
    expect(out).toMatch(/26\.0/);
    expect(out).toMatch(/skip/i);
  });

  test('a download outage is NOT fatal when the SDK is already there', () => {
    // The exact 2026-08-16 failure. There is nothing to download, so the
    // deploy must not die on the download service being unreachable.
    const { status, downloads } = runStep({ sdks: ['26.0'], downloadFails: true });
    expect(status).toBe(0);
    expect(downloads).toEqual([]);
  });
});

describe('the required SDK is missing', () => {
  test('the download runs, and the step succeeds once it installs', () => {
    const { status, downloads, out } = runStep({ sdks: ['17.0'] });
    expect(status).toBe(0);
    expect(downloads).toHaveLength(1);
    expect(out).toMatch(/install/i);
  });

  test('a FAILED download fails the step loudly, naming both versions', () => {
    // The alternative — swallowing it — is the "wrong by passing" direction:
    // the archive would die 20 minutes later with a message about a missing
    // SDK and nothing pointing back to here.
    const { status, out } = runStep({ sdks: ['17.0'], downloadFails: true });
    expect(status).not.toBe(0);
    expect(out).toContain('::error::');
    expect(out).toMatch(/18/); // the version it needed
    expect(out).toMatch(/17\.0/); // what it actually found
  });

  test('a download that succeeds but installs NOTHING still fails', () => {
    // Recorded in the step's own history: `-downloadPlatform` exited 0 as a
    // no-op because *an* iOS platform was present, and every archive died
    // ~20 minutes later. Exit 0 is not evidence the SDK arrived.
    const { status, out } = runStep({ sdks: ['17.0'], downloadInstallsNothing: true });
    expect(status).not.toBe(0);
    expect(out).toContain('::error::');
  });

  test('no SDKs at all is handled, not crashed on', () => {
    const { status, downloads } = runStep({ sdks: [] });
    expect(downloads).toHaveLength(1);
    expect(status).toBe(0);
  });
});

describe('the step is still shaped the way this harness assumes', () => {
  test('it is a run-block that queries before it downloads', () => {
    // If someone reverts it to the one-liner, `extractRunBlock` throws with a
    // message saying so rather than this suite passing vacuously.
    const block = extractRunBlock(fs.readFileSync(WORKFLOW, 'utf8'), STEP_NAME);
    expect(block).toMatch(/-showsdks/);
    const query = block.indexOf('-showsdks');
    const download = block.indexOf('-downloadPlatform');
    expect(query).toBeGreaterThan(-1);
    expect(download).toBeGreaterThan(query);
  });
});
