/**
 * Pins the gauntlet progress dashboard wiring.
 *
 * Operator 2026-07-31: "i have no visibility of what it's done and still to do.
 * so i want the gauntlet to have some sort of UI to appear here on the desktop
 * showing progress."
 *
 * The dashboard is a convenience, so it is exactly the kind of thing that gets
 * quietly dropped in a refactor and is not missed until the next unattended
 * multi-hour run. These assertions make dropping it a test failure.
 *
 * The safety properties matter more than the feature: a progress viewer must
 * never be able to take down the run it is watching.
 */
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const GAUNTLET = path.join(REPO_ROOT, 'express-api/scripts/gauntlet');
const MATRIX_SH = path.join(GAUNTLET, '50-matrix.sh');

const read = (p) => fs.readFileSync(p, 'utf8');

describe('gauntlet progress dashboard — files exist', () => {
  it.each([
    ['progress-model.js', 'the parser'],
    ['progress-server.js', 'the read-only server'],
    ['progress-dashboard.html', 'the page itself'],
  ])('ships %s (%s)', (file) => {
    expect(fs.existsSync(path.join(GAUNTLET, file))).toBe(true);
  });

  it('the dashboard page is self-contained — no external CDN or font', () => {
    // It has to render on a machine that may have no network, and a blocked
    // asset must never be why the operator cannot see progress.
    const html = read(path.join(GAUNTLET, 'progress-dashboard.html'));
    expect(html).not.toMatch(/src="https?:\/\//);
    expect(html).not.toMatch(/href="https?:\/\/[^"]*\.css/);
  });

  it('the dashboard re-polls rather than assuming a single render', () => {
    // Behaviour, not mechanism: setInterval OR a self-rescheduling setTimeout.
    // The original asserted setInterval literally and broke when the reconnect
    // loop moved to recursive setTimeout — which is what allows a variable
    // backoff at all. Pin that it keeps polling, not how.
    const html = read(path.join(GAUNTLET, 'progress-dashboard.html'));
    expect(html).toMatch(/setInterval\(|setTimeout\(\s*tick/);
  });

  it('the dashboard keeps retrying and recovers on its own', () => {
    const html = read(path.join(GAUNTLET, 'progress-dashboard.html'));
    // A viewer that gives up when its server blips is not a viewer.
    expect(html).toMatch(/retryDelay/);
    expect(html).toMatch(/lastGood/); // last-known data stays on screen
  });
});

describe('50-matrix.sh — launches the dashboard', () => {
  const script = read(MATRIX_SH);

  it('starts the progress server on launch', () => {
    expect(script).toMatch(/progress-server\.js/);
  });

  it('points the server at THIS run’s directory, not just the latest', () => {
    // Two runs in a session would otherwise have the dashboard follow whichever
    // directory happened to be newest. The supervisor passes $tmpdir into the
    // loop, which forwards it as --run-dir, so assert the wiring rather than
    // one literal spelling of it.
    const block = script.slice(script.indexOf('progress-server.js'));
    expect(script).toMatch(/--run-dir/);
    expect(block).toMatch(/"\$tmpdir"/);
  });

  it('supervises the viewer so a crash self-heals', () => {
    // Operator 2026-07-31: "the service must try to repair itself."
    const block = script.slice(script.indexOf('progress-server.js') - 600);
    expect(block).toMatch(/respawn/i);
    // Bounded: a permanently-broken viewer must not spin forever.
    expect(block).toMatch(/restarts\b/);
  });

  it('prints the dashboard URL where the operator will see it', () => {
    expect(script).toMatch(/Dashboard:\s+http:\/\/127\.0\.0\.1/);
  });

  it('can be disabled without editing the script', () => {
    expect(script).toMatch(/GAUNTLET_UI:-1/);
  });

  it('starts the UI AFTER the runner, so it can never delay dispatch', () => {
    const runnerAt = script.indexOf('manual-qa-runner.js');
    const uiAt = script.indexOf('progress-server.js');
    expect(runnerAt).toBeGreaterThan(-1);
    expect(uiAt).toBeGreaterThan(runnerAt);
  });

  it('swallows UI failures so the viewer cannot abort the run', () => {
    // The single most important property here. `set -uo pipefail` is on, and a
    // gauntlet that refuses to start because a dashboard port was busy would
    // be strictly worse than having no dashboard.
    const block = script.slice(script.indexOf('progress-server.js'));
    expect(block).toMatch(/\)\s*\|\|\s*true/);
  });
});

describe('progress-server.js — read-only and loopback-only', () => {
  const server = read(path.join(GAUNTLET, 'progress-server.js'));

  it('binds to loopback only — it exposes device serials and run paths', () => {
    expect(server).toMatch(/listen\(\s*port\s*,\s*'127\.0\.0\.1'/);
  });

  it('never writes to the run directory it is watching', () => {
    expect(server).not.toMatch(/writeFileSync|appendFileSync|unlinkSync|rmSync|mkdirSync/);
  });

  it('never signals the runner or touches a device', () => {
    // process.kill(pid, 0) is an existence check and delivers no signal; any
    // other signal would mean the viewer can kill the run.
    const signals = server.match(/process\.kill\([^)]*\)/g) || [];
    expect(signals.every((s) => /,\s*0\s*\)/.test(s))).toBe(true);
    expect(server).not.toMatch(/adb\s+shell|force-stop|uiautomator/);
  });

  it('retries a busy port instead of dying immediately', () => {
    // EADDRINUSE is usually a previous instance still shutting down. Exiting on
    // it is what left the operator on "progress server unreachable" with
    // nothing recovering.
    const onError = server.slice(server.indexOf("server.on('error'"));
    expect(onError).toMatch(/EADDRINUSE/);
    expect(onError).toMatch(/server\.listen/);
  });

  it('still exits 0 when it finally gives up, never non-zero', () => {
    // A non-zero exit would propagate into the launcher's failure paths.
    const onError = server.slice(server.indexOf("server.on('error'"));
    expect(onError).toMatch(/process\.exit\(0\)/);
  });

  it('survives an unexpected error rather than taking the viewer down', () => {
    expect(server).toMatch(/uncaughtException/);
  });
});

/**
 * The runner must sign in with the SAME password the seeder forced.
 *
 * 20-reseed.sh forces PERSONAS_PASSWORD=localdev123 on the local target,
 * because the .local app flavour bakes that value in. But 50-matrix.sh does
 * `set -a; source ~/.shytalk/dev-personas.env` which exports the 32-char DEV
 * password into the runner's environment.
 *
 * Result: personas are seeded with one password and signed in with another.
 * Every persona sign-in returns INVALID_PASSWORD, so every device cell reaches
 * the persona picker and can never get past it. Observed 2026-07-31 as the
 * phone "thrashing on the persona picker, closing the app, and repeating",
 * with both device cells stalled at 0 scenarios while chromium progressed.
 *
 * This is auth wiring, not product debt — see
 * [[reference-local-matrix-persona-password-mismatch]].
 */
describe('50-matrix.sh — persona password matches what was seeded', () => {
  const script = read(MATRIX_SH);
  const reseed = read(path.join(GAUNTLET, '20-reseed.sh'));

  it('the seeder forces localdev123 on the local target', () => {
    expect(reseed).toMatch(/PERSONAS_PASSWORD=localdev123/);
  });

  it('the launcher forces the SAME password into the local runner', () => {
    // Without this the 32-char dev password sourced from dev-personas.env wins,
    // because it is exported before the runner starts.
    const localPrefix = script
      .split('\n')
      .filter((l) => l.includes('env_prefix=') && l.includes('local'))
      .join(' ');
    expect(localPrefix).toMatch(/PERSONAS_PASSWORD=localdev123/);
  });

  it('does NOT force it on the dev target, where the real password is correct', () => {
    const devPrefix = script
      .split('\n')
      .filter((l) => l.includes('env_prefix=') && l.includes('"dev"'))
      .join(' ');
    expect(devPrefix).not.toMatch(/PERSONAS_PASSWORD=localdev123/);
  });
});
