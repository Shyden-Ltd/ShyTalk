/**
 * SHY-0473 — a dev run must question dev.
 *
 * `device-journey-runner.js` chooses a package, an APK and a tunnelling policy
 * from `--target local|dev`. Its own HTTP assertions used to ignore that
 * choice: `API_BASE_URL` and the auth endpoint were module-level constants
 * pointing at localhost. On `dev` — which is deliberately untunnelled — the
 * phone talked to the remote dev API while every server-rule assertion talked
 * to whatever was listening on the laptop.
 *
 * That does not fail. It PASSES, because the normal state of the machine
 * running the matrix is "local stack up". A green dev report was evidence
 * about the laptop.
 *
 * Nothing is mocked here. The resolver is pure, and the two seams — the dev API
 * base and the dev client key — are asserted against the very files the dev APK
 * is built from, so the runner cannot drift away from the app it is driving.
 */

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const RUNNER = path.join(REPO_ROOT, 'express-api', 'scripts', 'device-journey-runner.js');
const { resolveTargetApi, TARGETS } = require(RUNNER);

/** The dev API base, read from the file the dev APK is built from. */
const devBaseFromGradle = () => {
  const gradle = fs.readFileSync(path.join(REPO_ROOT, 'app', 'build.gradle.kts'), 'utf8');
  // The dev flavour's buildConfigField. Anchored on the flavour block so the
  // prod and local lines cannot be picked up by accident.
  const all = [
    ...gradle.matchAll(/buildConfigField\("String",\s*"API_BASE_URL",\s*"\\"([^\\]+)\\""\)/g),
  ].map((m) => m[1]);
  const dev = all.filter((u) => u.includes('dev-api'));
  if (dev.length !== 1) throw new Error(`expected exactly one dev API base, found ${dev.length}`);
  return dev[0];
};

/** The dev Firebase client key, read from the dev flavour's google-services.json. */
const devKeyFromGoogleServices = () => {
  const p = path.join(REPO_ROOT, 'app', 'src', 'dev', 'google-services.json');
  return JSON.parse(fs.readFileSync(p, 'utf8')).client[0].api_key[0].current_key;
};

describe('the resolver exists and is pure', () => {
  test('it is exported, so the targets can be tested without a phone', () => {
    expect(typeof resolveTargetApi).toBe('function');
    expect(TARGETS).toHaveProperty('local');
    expect(TARGETS).toHaveProperty('dev');
  });
});

describe('local is unchanged', () => {
  const local = () => resolveTargetApi('local', {});

  test('the API base is still the local express-api', () => {
    // The release gate runs on `local`. This pins today's behaviour so the
    // refactor cannot quietly move the path that is actually used.
    expect(local().apiBaseUrl).toBe('http://localhost:3000');
  });

  test('auth is still the Auth emulator', () => {
    expect(local().authUrl).toContain('localhost:9099');
    expect(local().authUrl).toContain('identitytoolkit');
  });

  test('the local persona password needs no environment', () => {
    expect(local().password).toBe('localdev123');
  });
});

describe('dev questions dev', () => {
  const dev = () => resolveTargetApi('dev', { PERSONAS_PASSWORD: 'x' });

  test('the API base is the DEV api, not localhost', () => {
    // The defect, stated directly.
    expect(dev().apiBaseUrl).not.toContain('localhost');
    expect(dev().apiBaseUrl).toMatch(/^https:\/\//);
  });

  test('the API base is the SAME one the dev APK is built with', () => {
    // The seam. A test carrying its own copy of the URL would let the runner
    // and the app drift apart while both stayed "correct".
    expect(dev().apiBaseUrl).toBe(devBaseFromGradle());
  });

  test('auth is real Firebase, not the emulator', () => {
    expect(dev().authUrl).toContain('identitytoolkit.googleapis.com');
    expect(dev().authUrl).not.toContain('localhost');
    expect(dev().authUrl).not.toContain('key=demo');
  });

  test('the auth key is the SAME one the dev APK is built with', () => {
    expect(dev().authUrl).toContain(devKeyFromGoogleServices());
  });
});

describe('a dev run without credentials refuses', () => {
  test('it throws rather than falling back to anything', () => {
    // Falling back is what made the defect silent. There is no safe default.
    expect(() => resolveTargetApi('dev', {})).toThrow();
  });

  test('the refusal names the variable the operator must set', () => {
    expect(() => resolveTargetApi('dev', {})).toThrow(/PERSONAS_PASSWORD/);
  });

  test('the refusal says where the value lives', () => {
    expect(() => resolveTargetApi('dev', {})).toThrow(/dev-personas-credentials/);
  });

  test('an empty password is missing, not a password', () => {
    expect(() => resolveTargetApi('dev', { PERSONAS_PASSWORD: '' })).toThrow(/PERSONAS_PASSWORD/);
    expect(() => resolveTargetApi('dev', { PERSONAS_PASSWORD: '   ' })).toThrow(
      /PERSONAS_PASSWORD/,
    );
  });
});

describe('the password never reaches the output', () => {
  test('it is absent from the resolved description', () => {
    // The run header prints the target. A password that reaches a log reaches
    // CI output, a screenshot, and an evidence page.
    const planted = 'pw-must-not-appear-9f3c1a';
    const r = resolveTargetApi('dev', { PERSONAS_PASSWORD: planted });
    expect(r.password).toBe(planted);
    expect(JSON.stringify(r.describe ?? r.summary ?? '')).not.toContain(planted);
  });
});

describe('an unknown or incomplete target cannot inherit localhost', () => {
  test('an unknown target throws', () => {
    expect(() => resolveTargetApi('staging', {})).toThrow(/staging/);
  });

  test('every declared target carries its own API base', () => {
    // A target added later with no base would otherwise resolve to whatever
    // the resolver defaults to — which is how this defect was born.
    for (const name of Object.keys(TARGETS)) {
      expect(typeof TARGETS[name].apiBaseUrl).toBe('string');
      expect(TARGETS[name].apiBaseUrl.length).toBeGreaterThan(0);
    }
  });
});

describe('no target-blind constant survives in the runner', () => {
  const source = () => fs.readFileSync(RUNNER, 'utf8');

  test('the scan is non-vacuous — the file is real and substantial', () => {
    // A source-scanning guard that reads an empty string passes every
    // assertion below while proving nothing.
    expect(source().length).toBeGreaterThan(50_000);
    expect(source()).toContain('resolveTargetApi');
  });

  test('there is no module-level localhost API constant', () => {
    const offenders = source()
      .split('\n')
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(({ line }) => /^const\s+(API_BASE_URL|AUTH_EMU_URL)\s*=/.test(line));
    expect({ offenders }).toEqual({ offenders: [] });
  });
});
