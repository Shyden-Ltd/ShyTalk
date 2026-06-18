/**
 * emulator-in-ci-pin.test.js — EPIC-0003 Phase 3 (SHY-0109).
 *
 * Pins the CI wiring that provisions the Firebase Emulator stack before
 * the express Jest suite runs. Without this, a future edit could silently
 * drop the emulator step and the migrated (real-firebase) tests would
 * fail in CI with no obvious cause. Asserts presence + ORDER (emulator
 * start before Jest; JVM before emulator) by reading the workflow YAML.
 */
const fs = require('fs');
const path = require('path');

const WORKFLOWS = path.resolve(__dirname, '../../../.github/workflows');
const read = (file) => fs.readFileSync(path.join(WORKFLOWS, file), 'utf8');

const EMULATOR_ACTION = './.github/actions/start-firebase-emulators';
// EPIC-0003 / SHY-0120: the cron Jest tests also need REAL R2 (MinIO) +
// email (Mailpit), provisioned by this action. A future edit dropping it
// would fail those suites in CI's beforeAll with a connection refusal.
const LOCAL_SERVICES_ACTION = './.github/actions/start-local-services';
const MINIO_HEALTH = 'http://localhost:9002/minio/health/live';
const MAILPIT_HEALTH = 'http://localhost:8025/api/v1/messages';
const JEST_INVOCATION = 'node_modules/.bin/jest';
// The repo-wide SHA pin for actions/setup-java@v5 (see setup-jdk-gradle).
const SETUP_JAVA_PIN = 'actions/setup-java@be666c2fcd27ec809703dec50e508c2fdc7f6654';

describe('SHY-0109 — test-backend.yml provisions emulators before Jest', () => {
  const yml = read('test-backend.yml');

  test('references the start-firebase-emulators composite action', () => {
    expect(yml).toContain(EMULATOR_ACTION);
  });

  test('sets up a JVM via the SHA-pinned actions/setup-java', () => {
    expect(yml).toContain(SETUP_JAVA_PIN);
  });

  test('emulator start is ordered BEFORE the Jest run', () => {
    const emu = yml.indexOf(EMULATOR_ACTION);
    const jest = yml.indexOf(JEST_INVOCATION);
    expect(emu).toBeGreaterThan(-1);
    expect(jest).toBeGreaterThan(-1);
    expect(emu).toBeLessThan(jest);
  });

  test('JVM setup is ordered BEFORE the emulator start (Firestore/RTDB are JVM-based)', () => {
    const java = yml.indexOf(SETUP_JAVA_PIN);
    const emu = yml.indexOf(EMULATOR_ACTION);
    expect(java).toBeGreaterThan(-1);
    expect(java).toBeLessThan(emu);
  });

  test('raises the job timeout to absorb cold-cache emulator boot', () => {
    expect(yml).toMatch(/timeout-minutes:\s*15/);
  });

  test('provisions the REAL R2 (MinIO) + email (Mailpit) services via start-local-services, before Jest', () => {
    const svc = yml.indexOf(LOCAL_SERVICES_ACTION);
    const jest = yml.indexOf(JEST_INVOCATION);
    expect(svc).toBeGreaterThan(-1);
    expect(svc).toBeLessThan(jest);
  });

  test('waits for MinIO + Mailpit readiness before Jest', () => {
    expect(yml).toContain(MINIO_HEALTH);
    expect(yml).toContain(MAILPIT_HEALTH);
    expect(yml.indexOf(MINIO_HEALTH)).toBeLessThan(yml.indexOf(JEST_INVOCATION));
  });
});

describe('SHY-0109 — sonarcloud.yml provisions emulators before Jest', () => {
  const yml = read('sonarcloud.yml');

  test('references the start-firebase-emulators composite action', () => {
    expect(yml).toContain(EMULATOR_ACTION);
  });

  test('emulator start is ordered BEFORE the Jest run', () => {
    const emu = yml.indexOf(EMULATOR_ACTION);
    const jest = yml.indexOf(JEST_INVOCATION);
    expect(emu).toBeGreaterThan(-1);
    expect(jest).toBeGreaterThan(-1);
    expect(emu).toBeLessThan(jest);
  });

  test('reuses the existing setup-jdk-gradle JVM (no duplicate setup-java)', () => {
    // sonarcloud.yml already provides a JVM via setup-jdk-gradle; adding a
    // second JVM setup would be redundant. The emulator action must come
    // after that existing JDK step.
    const jdk = yml.indexOf('./.github/actions/setup-jdk-gradle');
    const emu = yml.indexOf(EMULATOR_ACTION);
    expect(jdk).toBeGreaterThan(-1);
    expect(jdk).toBeLessThan(emu);
  });

  test('provisions the REAL R2 (MinIO) + email (Mailpit) services via start-local-services, before Jest', () => {
    const svc = yml.indexOf(LOCAL_SERVICES_ACTION);
    const jest = yml.indexOf(JEST_INVOCATION);
    expect(svc).toBeGreaterThan(-1);
    expect(svc).toBeLessThan(jest);
  });

  test('waits for MinIO + Mailpit readiness before Jest', () => {
    expect(yml).toContain(MINIO_HEALTH);
    expect(yml).toContain(MAILPIT_HEALTH);
    expect(yml.indexOf(MINIO_HEALTH)).toBeLessThan(yml.indexOf(JEST_INVOCATION));
  });
});
