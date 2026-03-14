# E2E Test Workflow Design

**Date:** 2026-03-13

## Overview

A GitHub Actions workflow that runs the full E2E/instrumented test suite across a matrix of Android emulators and iOS simulators, triggered manually or via PR comments.

## Triggers

1. **`workflow_dispatch`** — manual trigger with inputs:
   - `platform`: `android`, `ios`, `both` (default: `both`)
   - `parallel`: `true`/`false` (default: `true`) — toggle for parallel vs sequential execution
   - Branch is selected via GitHub's standard branch picker

2. **PR comment** — `issue_comment` trigger, reacts to:
   - `/run-e2e` or `/run-e2e all` — both platforms
   - `/run-e2e android` — Android only
   - `/run-e2e ios` — iOS only
   - Only triggers for PR authors and collaborators

## Device Matrix

### Android (8 jobs)
| API Level | Android Version | Phone Profile | Tablet Profile |
|-----------|----------------|---------------|----------------|
| 28 | 9 (Pie) | pixel_2 | Nexus 9 |
| 30 | 11 | pixel_4 | Nexus 9 |
| 33 | 13 (Tiramisu) | pixel_6 | pixel_tablet |
| 35 | 15 | pixel_8 | pixel_tablet |

- Runner: `ubuntu-latest` (hardware acceleration via KVM)
- Emulator action: `reactivecircus/android-emulator-runner`
- Build: `./gradlew assembleDevDebug assembleDevDebugAndroidTest`
- Test: `./gradlew connectedDevDebugAndroidTest`

### iOS (6 jobs)
| iOS Version | iPhone Model | iPad Model |
|-------------|-------------|------------|
| 16 | iPhone 14 | iPad (10th gen) |
| 17 | iPhone 15 | iPad Air (M2) |
| 18 | iPhone 16 | iPad Air (M3) |

- Runner: `macos-14` (Apple Silicon, required for iOS simulators)
- Build shared KMP framework, then run XCTest via `xcodebuild test`
- Xcode version selected to match iOS simulator availability

## Workflow Structure

```
e2e-tests.yml
├── build-android (ubuntu-latest)
│   ├── Compile assembleDevDebug + test APK
│   └── Upload APKs as artifact
├── build-ios (macos-14)
│   ├── Compile shared KMP framework
│   ├── Build iOS test bundle
│   └── Upload test bundle as artifact
├── test-android (matrix: 4 API levels x 2 form factors = 8 jobs)
│   ├── Download APK artifacts
│   ├── Start emulator
│   └── Run connectedDevDebugAndroidTest
└── test-ios (matrix: 3 iOS versions x 2 form factors = 6 jobs)
    ├── Download test bundle artifacts
    ├── Boot simulator
    └── Run xcodebuild test
```

Build jobs run first; test matrix jobs depend on them. This avoids building 14 times.

## Parallelism Toggle

- `parallel: true` (default): all matrix jobs run concurrently
- `parallel: false`: matrix jobs use `max-parallel: 1`

## Timeout

- 60 minutes per job initially
- Adjust after first runs based on actual duration

## Secrets Required

- `GOOGLE_SERVICES_DEV_BASE64` (exists)
- `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD` (exist, for signing)

## Artifacts

- Test results uploaded as artifacts per matrix entry
- JUnit XML reports for GitHub Actions test summary

## Supported Devices Documentation

A `docs/supported-devices.md` file will document:
- Android: API 28-35 (Android 9-15)
- iOS: 16.0-18.x
- Minimum deployment targets and rationale
