# Supported Devices & OS Versions

## Android

| Property | Value |
|----------|-------|
| **Min SDK** | 28 (Android 9 Pie) |
| **Target SDK** | 36 (Android 16) |
| **Compile SDK** | 36 |

### Tested API Levels

| API | Android Version | Status |
|-----|----------------|--------|
| 28 | 9 (Pie) | Minimum supported |
| 30 | 11 | Tested |
| 33 | 13 (Tiramisu) | Tested |
| 35 | 15 | Latest tested |

### Test Device Profiles

| API Level | Phone | Tablet |
|-----------|-------|--------|
| 28 | Pixel 2 | Nexus 9 |
| 30 | Pixel 4 | Nexus 9 |
| 33 | Pixel 6 | Pixel Tablet |
| 35 | Pixel 8 | Pixel Tablet |

## iOS

| Property | Value |
|----------|-------|
| **Deployment Target** | 16.0 |
| **Latest Supported** | 18.x |

### Tested iOS Versions

| iOS Version | Status |
|-------------|--------|
| 16 | Minimum supported |
| 17 | Tested |
| 18 | Latest tested |

### Test Device Profiles

| iOS Version | iPhone | iPad |
|-------------|--------|------|
| 16 | iPhone 14 | iPad (10th generation) |
| 17 | iPhone 15 | iPad Air (M2) |
| 18 | iPhone 16 | iPad Air (M3) |

## Rationale

- **Android minSdk 28**: Covers 95%+ of active Android devices. API 28 introduced BiometricPrompt, adaptive battery, and is the last version before scoped storage.
- **iOS 16.0**: Covers 95%+ of active iPhones. iOS 16 introduced Lock Screen widgets, SharePlay improvements, and is required for latest Swift concurrency features.
