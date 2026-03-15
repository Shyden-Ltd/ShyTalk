---
name: run-tests
description: Run unit tests, E2E tests, or both with clear pass/fail summary
---

Run the appropriate test suite based on the user's request. Default to running both if unspecified.

## Test Suites

**Unit tests:**
```bash
./gradlew test
```

**E2E / Instrumented tests** (requires connected device):
```bash
./gradlew connectedDevDebugAndroidTest
```

**Express API tests:**
```bash
cd express-api && npm test
```

## Instructions

1. Run the requested suite(s)
2. Parse the output for pass/fail counts
3. Report a clear summary:
   - Total tests run
   - Total passed
   - Total failed (list each failing test name)
   - Any compilation errors
4. If tests fail, suggest fixes based on the error messages

## Examples

- `/run-tests` → run unit + E2E
- `/run-tests unit` → unit tests only
- `/run-tests e2e` → E2E only
- `/run-tests api` → Express API tests only
- `/run-tests all` → all three suites
