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
const { resolveTargetApi, TARGETS, devFirebaseKey, DEV_GOOGLE_SERVICES } = require(RUNNER);

/**
 * A stand-in key, so the dev tests do not depend on a gitignored file.
 *
 * `app/src/dev/google-services.json` is written from a secret and matched by a
 * recursive gitignore glob, so it is present on a machine that can build the
 * dev APK and absent in CI. The first cut of these tests read it directly and
 * passed locally while failing CI with ENOENT — the exact shape of defect this
 * story is about, committed by its own test.
 */
const FAKE_KEY = 'AIzaTestKeyNotARealCredential';
const devEnv = (extra = {}) => ({
  PERSONAS_PASSWORD: 'x',
  DEV_FIREBASE_API_KEY: FAKE_KEY,
  ...extra,
});

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
  const dev = () => resolveTargetApi('dev', devEnv());

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

  test('the key comes from the environment when one is given', () => {
    expect(dev().authUrl).toContain(FAKE_KEY);
  });
});

describe('a dev run without credentials refuses', () => {
  test('it throws rather than falling back to anything', () => {
    // Falling back is what made the defect silent. There is no safe default.
    expect(() => resolveTargetApi('dev', { DEV_FIREBASE_API_KEY: FAKE_KEY })).toThrow();
  });

  test('the refusal names the variable the operator must set', () => {
    expect(() => resolveTargetApi('dev', { DEV_FIREBASE_API_KEY: FAKE_KEY })).toThrow(
      /PERSONAS_PASSWORD/,
    );
  });

  test('the refusal says where the value lives', () => {
    expect(() => resolveTargetApi('dev', { DEV_FIREBASE_API_KEY: FAKE_KEY })).toThrow(
      /dev-personas-credentials/,
    );
  });

  test('an empty password is missing, not a password', () => {
    expect(() =>
      resolveTargetApi('dev', { DEV_FIREBASE_API_KEY: FAKE_KEY, PERSONAS_PASSWORD: '' }),
    ).toThrow(/PERSONAS_PASSWORD/);
    expect(() =>
      resolveTargetApi('dev', { DEV_FIREBASE_API_KEY: FAKE_KEY, PERSONAS_PASSWORD: '   ' }),
    ).toThrow(/PERSONAS_PASSWORD/);
  });
});

describe('the password never reaches the output', () => {
  test('it is absent from the resolved description', () => {
    // The run header prints the target. A password that reaches a log reaches
    // CI output, a screenshot, and an evidence page.
    const planted = 'pw-must-not-appear-9f3c1a';
    const r = resolveTargetApi('dev', devEnv({ PERSONAS_PASSWORD: planted }));
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

describe('the dev key has two sources, and neither is a silent default', () => {
  test('the environment wins when it is set', () => {
    expect(devFirebaseKey({ DEV_FIREBASE_API_KEY: FAKE_KEY })).toBe(FAKE_KEY);
  });

  test('a blank environment value is not a value', () => {
    // Otherwise an unset CI secret expands to '' and becomes the key, and the
    // sign-in fails somewhere far away from the cause.
    const present = fs.existsSync(DEV_GOOGLE_SERVICES);
    if (present) {
      expect(devFirebaseKey({ DEV_FIREBASE_API_KEY: '  ' })).not.toBe('  ');
    } else {
      expect(() => devFirebaseKey({ DEV_FIREBASE_API_KEY: '  ' })).toThrow(/DEV_FIREBASE_API_KEY/);
    }
  });

  test('with no environment value it falls back to the APK config, or says why it cannot', () => {
    // Both branches assert. The file is gitignored, so which branch runs is a
    // property of the machine, not of the code — and a test that quietly did
    // nothing on one of them would be the defect this story is about.
    const present = fs.existsSync(DEV_GOOGLE_SERVICES);
    if (present) {
      const fromFile = JSON.parse(fs.readFileSync(DEV_GOOGLE_SERVICES, 'utf8')).client[0].api_key[0]
        .current_key;
      expect(devFirebaseKey({})).toBe(fromFile);
      // The seam: on a machine that can build the dev APK, the runner and the
      // app must agree about which Firebase project they are talking to.
      expect(resolveTargetApi('dev', { PERSONAS_PASSWORD: 'x' }).authUrl).toContain(fromFile);
    } else {
      expect(() => devFirebaseKey({})).toThrow(/DEV_FIREBASE_API_KEY/);
      expect(() => devFirebaseKey({})).toThrow(/google-services\.json/);
    }
  });
});
