# Integration Tests

Multi-service integration tests for the ShyTalk Express API + Firebase
Emulators + LiveKit Docker + MinIO + Mailpit local stack.

## What this tier covers

| Tier | What it tests | What it mocks |
|---|---|---|
| **Unit** (`express-api/tests/`, `shared/src/jvmTest/`) | Business logic | All I/O |
| **Integration** (this dir) | Cross-service contracts (Express ↔ Firestore ↔ RTDB ↔ R2 ↔ LiveKit) | Browser, app UI |
| **E2E** (`app/src/androidTest/`, `tests/web/*.spec.ts`) | UI contracts via real user actions | Some Firebase fakes |
| **Smoke** (`tests/web/dev-smoke.spec.ts`) | Real deployed dev infrastructure | Nothing |

The integration tier sits between unit (mocked I/O) and E2E (UI-driven).
Tests here exercise REAL services: Firebase Admin SDK against the
emulator, Express API against Firestore/RTDB, R2 PUT/GET via MinIO.

## Running locally

```bash
# 1. Start the local stack
bash local/start.sh
cd express-api && npm run local &

# 2. Run integration tests (from repo root)
npm run test:integration
```

The global-setup probes the stack before tests run and fails loud
with a "run bash local/start.sh first" message if anything is down.

## Running in CI

`.github/workflows/integration-tests.yml` (separate PR) brings up
the stack via the same composite actions used by `playwright-tests.yml`,
then runs `npm run test:integration`.

## Adding new tests

1. Create `NN-name.spec.ts` (numbered for order)
2. Use the helpers in `helpers/` for common assertions/fixtures
3. Use `fixtures/scenarios.ts` (PR B+) for multi-account flows
4. Each test must be deterministic — no retries on this tier (per
   `playwright.integration.config.ts`). A flaky integration test
   masks a real cross-system regression.

## Reference

Full implementation plan:
[`.project/plans/2026-05-05-integration-test-framework.md`](../../.project/plans/2026-05-05-integration-test-framework.md)
