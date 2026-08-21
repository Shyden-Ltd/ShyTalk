/**
 * SHY-0416 — every dev build that renders a persona picker can actually use it.
 *
 * `BuildVariant.isPersonaPickerAvailable` is `!localDevPersonasPassword.isNullOrEmpty()`,
 * baked at BUILD time from `DEV_QA_PERSONAS_PASSWORD`. A distribution job that
 * does not pass it ships an app nobody can sign in to.
 *
 * That is exactly what happened: `distribute-android` passed it and the iOS job
 * did not, so **no iOS dev build has ever been sign-in-able** — which is why iOS
 * journey proof was permanently "owed" and was repeatedly misattributed to
 * TestFlight, to device signing, and to discipline.
 *
 * Neither job's own success can reveal this. Both build fine; the app is only
 * unusable afterwards, on a device, by a person. It is a seam between two jobs,
 * so the assertion has to compare them.
 *
 * See [[feedback-assert-the-seam-not-the-sides]].
 */

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../../..');
const WORKFLOW = '.github/workflows/deploy-dev.yml';
const CREDENTIAL = 'DEV_QA_PERSONAS_PASSWORD';

const workflow = () => {
  const p = path.join(repoRoot, WORKFLOW);
  expect(fs.existsSync(p)).toBe(true);
  return fs.readFileSync(p, 'utf8');
};

/**
 * The body of one job, from its key to the next top-level job key.
 *
 * Read by indentation rather than parsed as YAML deliberately: the question is
 * "does this job's env mention the credential", and a structural parse would
 * need the same slicing anyway.
 */
const jobBody = (src, jobKey) => {
  const start = src.indexOf(`\n  ${jobKey}:`);
  expect(start).toBeGreaterThan(-1);
  const rest = src.slice(start + 1);
  const next = rest.search(/\n {2}[a-z][\w-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next);
};

describe('dev distribution jobs all bake the persona credential', () => {
  const src = workflow();

  test('the jobs are findable, so this cannot pass vacuously', () => {
    expect(jobBody(src, 'distribute-android').length).toBeGreaterThan(200);
    expect(jobBody(src, 'distribute-ios').length).toBeGreaterThan(200);
  });

  test('the Android job passes it', () => {
    expect(jobBody(src, 'distribute-android')).toContain(CREDENTIAL);
  });

  test('the iOS job passes it too', () => {
    // The asymmetry SHY-0416 records. An iOS build without this renders a
    // persona picker that cannot sign anybody in.
    expect(jobBody(src, 'distribute-ios')).toContain(CREDENTIAL);
  });

  test('it comes from a secret, never a literal', () => {
    for (const job of ['distribute-android', 'distribute-ios']) {
      const line = jobBody(src, job)
        .split('\n')
        .find((l) => l.includes(CREDENTIAL) && l.includes(':'));
      expect(line).toBeDefined();
      expect(line).toMatch(/\$\{\{\s*secrets\./);
    }
  });
});
