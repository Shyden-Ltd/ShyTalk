'use strict';

/**
 * SHY-0500 review (2026-09-04) — J40 invalidates a persona's session by
 * DISABLING the account through firebase-admin. That is a real, destructive
 * lever, and the helper behind it reused whatever default admin app the
 * process already had: one initialised for a real project would have disabled
 * the persona on the real service.
 *
 * The helper now talks only to the Auth emulator: it refuses any project id
 * that is not a demo project, and it uses its own named app so it can never
 * inherit an app somebody else initialised.
 */

const { localAdminAuth, LOCAL_AUTH_EMULATOR_APP } = require('../../scripts/device-journey-runner');

function harness(env) {
  const calls = { initializeApp: [], getAuth: [] };
  const apps = [];
  const deps = {
    env,
    getApps: () => apps,
    initializeApp: (options, name) => {
      const app = { name, options };
      calls.initializeApp.push({ options, name });
      apps.push(app);
      return app;
    },
    getAuth: (app) => {
      calls.getAuth.push(app);
      return { emulatorAuthFor: app };
    },
  };
  return { deps, calls, apps };
}

describe('the journey runner disables persona accounts only inside the Auth emulator', () => {
  test('refuses a real project id before touching any admin API', async () => {
    const { deps, calls } = harness({ GCLOUD_PROJECT: 'shytalk-dev' });
    await expect(localAdminAuth(deps)).rejects.toThrow(/shytalk-dev.*emulator/s);
    expect(calls.initializeApp).toHaveLength(0);
    expect(calls.getAuth).toHaveLength(0);
  });

  test('points at the emulator and initialises its own named demo app', async () => {
    const { deps, calls } = harness({});
    const auth = await localAdminAuth(deps);
    expect(deps.env.FIREBASE_AUTH_EMULATOR_HOST).toBe('localhost:9099');
    // No credentials in the emulator, so google-auth-library would otherwise
    // probe the GCE metadata server and print MetadataLookupWarning mid-run.
    expect(deps.env.METADATA_SERVER_DETECTION).toBe('none');
    expect(calls.initializeApp).toEqual([
      { options: { projectId: 'demo-shytalk' }, name: LOCAL_AUTH_EMULATOR_APP },
    ]);
    expect(auth.emulatorAuthFor.name).toBe(LOCAL_AUTH_EMULATOR_APP);
  });

  test('never borrows an app that already exists under another name', async () => {
    const { deps, calls, apps } = harness({});
    apps.push({ name: '[DEFAULT]', options: { projectId: 'shytalk-dev' } });
    const auth = await localAdminAuth(deps);
    expect(calls.initializeApp).toHaveLength(1);
    expect(auth.emulatorAuthFor.name).toBe(LOCAL_AUTH_EMULATOR_APP);
    expect(auth.emulatorAuthFor.options.projectId).toBe('demo-shytalk');
  });

  test('reuses its own app on the second call instead of initialising twice', async () => {
    const { deps, calls } = harness({ GCLOUD_PROJECT: 'demo-anything' });
    await localAdminAuth(deps);
    await localAdminAuth(deps);
    expect(calls.initializeApp).toHaveLength(1);
    expect(calls.initializeApp[0].options.projectId).toBe('demo-anything');
  });

  test('keeps an emulator host the environment already chose', async () => {
    const { deps } = harness({ FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9199' });
    await localAdminAuth(deps);
    expect(deps.env.FIREBASE_AUTH_EMULATOR_HOST).toBe('127.0.0.1:9199');
  });
});
