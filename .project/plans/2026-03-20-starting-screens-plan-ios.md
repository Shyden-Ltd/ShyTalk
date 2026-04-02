# Starting Screens — iOS Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build iOS starting screen support: SwiftUI blocking screen, `StartingScreenCoordinator` for startup flow, `StartingScreenService` for API calls, file-based caching, and `X-Device-Id` header on all requests.

**Architecture:** Standalone Swift implementation (NOT using KMP `AppConfigService`). `StartingScreenCoordinator` as `@StateObject` in `iOSApp.swift` conditionally renders `StartingScreenView` or `ContentView`. Cache in `FileManager.cachesDirectory`. Dismissed one-time IDs in `UserDefaults`.

**Tech Stack:** SwiftUI, URLSession, XCTest, Codable

**Spec:** `.project/plans/2026-03-20-starting-screens-design.md`
**Depends on:** API plan must be completed first (endpoints must exist)

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `iosApp/iosApp/feature/starting/StartingScreen.swift` | Create | `Codable` data model |
| `iosApp/iosApp/feature/starting/StartingScreenView.swift` | Create | SwiftUI blocking/dismissable screen |
| `iosApp/iosApp/feature/starting/StartingScreenService.swift` | Create | API calls via URLSession, `X-Device-Id` header |
| `iosApp/iosApp/feature/starting/StartingScreenCache.swift` | Create | File-based cache + UserDefaults dismissed IDs |
| `iosApp/iosApp/feature/starting/StartingScreenCoordinator.swift` | Create | `ObservableObject` orchestrating startup flow |
| `iosApp/iosApp/iOSApp.swift` | Modify | Restructure with `@StateObject` coordinator |
| `iosApp/iosApp/Assets.xcassets/police_duck.imageset/` | Create | Police duck image asset |
| `iosApp/iosApp/PrivacyInfo.xcprivacy` | Create | Privacy manifest declaring `identifierForVendor` usage |
| `iosApp/iosApp/Localizable.xcstrings` | Create | String Catalog for all locales (project uses `LOCALIZATION_PREFERS_STRING_CATALOGS = YES`) |
| `iosApp/iosApp/Assets.xcassets/shytalk_logo.imageset/` | Create | App logo for in-app display (AppIcon sets are NOT loadable via `UIImage(named:)`) |
| `iosApp/iosAppTests/StartingScreenServiceTests.swift` | Create | API service tests |
| `iosApp/iosAppTests/StartingScreenCacheTests.swift` | Create | Cache tests |
| `iosApp/iosAppTests/StartingScreenCoordinatorTests.swift` | Create | State machine tests |
| `iosApp/iosAppTests/StartingScreenViewTests.swift` | Create | SwiftUI view tests |

---

## Chunk 0: Xcode Project Setup (Prerequisites)

### Task 0a: Create iosAppTests test target

The Xcode project currently has NO test target. All XCTest steps require this.

- [ ] **Step 1: Add test target to Xcode project**

In Xcode (or by editing `project.pbxproj`):
- Add a new `iosAppTests` Unit Testing Bundle target
- Link against `XCTest.framework`
- Set host application to `iosApp`
- Add `PBXNativeTarget`, `PBXSourcesBuildPhase`, `PBXResourcesBuildPhase`
- Link against `XCTest.framework` in the test target's `PBXFrameworksBuildPhase`
- Update `iosApp.xcscheme`: add a `<Testables>` entry inside `<TestAction>` pointing to the new test target's `BlueprintIdentifier`. The current `<TestAction>` has no `<Testables>` — without this, `xcodebuild test` silently skips the test bundle even with `shouldAutocreateTestPlan = "YES"`
- Create `iosApp/iosAppTests/` directory

- [ ] **Step 2: Verify test target works**

```bash
cd iosApp && xcodebuild test -project iosApp.xcodeproj -scheme iosApp -sdk iphonesimulator -destination 'platform=iOS Simulator,OS=latest,name=iPhone 16' CODE_SIGNING_ALLOWED=NO
```

Expected: Build succeeds with 0 test cases (empty target)

- [ ] **Step 3: Commit**

```bash
git add iosApp/
git commit -m "chore: add iosAppTests test target to Xcode project"
```

### Task 0b: Register all new files in project.pbxproj

**Critical:** Every new Swift file, asset, and resource MUST be added to `project.pbxproj` — files dropped into the directory without registration are silently ignored by Xcode.

For each chunk below, after creating files:
- Add `PBXFileReference` entries
- Add to appropriate `PBXGroup`
- Add Swift files to `PBXSourcesBuildPhase` (app target for source, test target for tests)
- Add assets/resources to `PBXResourcesBuildPhase`

This step is called out explicitly in each chunk. If using Xcode IDE, drag-and-drop handles this automatically. If editing `project.pbxproj` manually, use a tool or follow existing entry patterns.

---

## Chunk 1: Data Model + Service

### Task 1: Create StartingScreen model and API service

**Files:**
- Create: `iosApp/iosApp/feature/starting/StartingScreen.swift`
- Create: `iosApp/iosApp/feature/starting/StartingScreenService.swift`
- Create: `iosApp/iosAppTests/StartingScreenServiceTests.swift`

- [ ] **Step 1: Create data model**

```swift
import Foundation

struct StartingScreen: Codable, Equatable {
    var screenId: String  // var — set from dictionary key after decoding
    let enabled: Bool
    let dismissable: Bool
    let frequency: String // "every_launch" | "once"
    let template: String // "warning" | "promotional" | "announcement" | "info"
    let title: String
    let message: String
    let imageType: String?
    let backgroundImage: String?
    let startDate: String?
    let endDate: String?
    let contentHash: String
    let lastModifiedAt: String?  // From API response

    enum CodingKeys: String, CodingKey {
        case screenId = "_screenId"  // Not in API JSON, used for cache round-trip
        case enabled, dismissable, frequency, template, title, message
        case imageType, backgroundImage, startDate, endDate, contentHash, lastModifiedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.screenId = (try? container.decode(String.self, forKey: .screenId)) ?? ""
        self.enabled = try container.decode(Bool.self, forKey: .enabled)
        self.dismissable = try container.decode(Bool.self, forKey: .dismissable)
        self.frequency = try container.decode(String.self, forKey: .frequency)
        self.template = try container.decode(String.self, forKey: .template)
        self.title = try container.decode(String.self, forKey: .title)
        self.message = try container.decode(String.self, forKey: .message)
        self.imageType = try? container.decodeIfPresent(String.self, forKey: .imageType)
        self.backgroundImage = try? container.decodeIfPresent(String.self, forKey: .backgroundImage)
        self.startDate = try? container.decodeIfPresent(String.self, forKey: .startDate)
        self.endDate = try? container.decodeIfPresent(String.self, forKey: .endDate)
        self.contentHash = (try? container.decode(String.self, forKey: .contentHash)) ?? ""
        self.lastModifiedAt = try? container.decodeIfPresent(String.self, forKey: .lastModifiedAt)
    }

    // encode(to:) is auto-synthesised from CodingKeys — screenId is stored under "_screenId"
    // for cache round-trip. API JSON doesn't have _screenId so it's decoded as "" and set externally.

    init(screenId: String, enabled: Bool, dismissable: Bool, frequency: String,
         template: String, title: String, message: String, imageType: String? = nil,
         backgroundImage: String? = nil, startDate: String? = nil, endDate: String? = nil,
         contentHash: String = "", lastModifiedAt: String? = nil) {
        self.screenId = screenId
        self.enabled = enabled
        self.dismissable = dismissable
        self.frequency = frequency
        self.template = template
        self.title = title
        self.message = message
        self.imageType = imageType
        self.backgroundImage = backgroundImage
        self.startDate = startDate
        self.endDate = endDate
        self.contentHash = contentHash
        self.lastModifiedAt = lastModifiedAt
    }
}
```

- [ ] **Step 2: Create StartingScreenService**

```swift
import Foundation
import UIKit

class StartingScreenService {
    private let baseURL: String
    private let session: URLSession

    init(baseURL: String = "https://api.shytalk.shyden.co.uk", session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    func fetchStartingScreens() async throws -> [String: StartingScreen] {
        guard let url = URL(string: "\(baseURL)/api/config/startingScreens") else {
            throw URLError(.badURL)
        }

        var request = URLRequest(url: url, timeoutInterval: 10)

        // X-Device-Id header
        if let deviceId = UIDevice.current.identifierForVendor?.uuidString {
            request.setValue(deviceId, forHTTPHeaderField: "X-Device-Id")
        }

        let (data, _) = try await session.data(for: request)

        // Parse: { "screenId": { ...fields } }
        let raw = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        var screens: [String: StartingScreen] = [:]

        for (id, value) in raw {
            guard let screenData = try? JSONSerialization.data(withJSONObject: value),
                  var screen = try? JSONDecoder().decode(StartingScreen.self, from: screenData) else {
                continue
            }
            // Set screenId from dictionary key
            screen = StartingScreen(
                screenId: id, enabled: screen.enabled, dismissable: screen.dismissable,
                frequency: screen.frequency, template: screen.template, title: screen.title,
                message: screen.message, imageType: screen.imageType,
                backgroundImage: screen.backgroundImage, startDate: screen.startDate,
                endDate: screen.endDate, contentHash: screen.contentHash,
                lastModifiedAt: screen.lastModifiedAt
            )
            screens[id] = screen
        }

        return screens
    }
}
```

- [ ] **Step 3: Write service tests**

Key tests: successful parse, empty response, malformed JSON, API timeout, X-Device-Id header sent, unknown fields ignored.

- [ ] **Step 4: Commit**

```bash
git add iosApp/
git commit -m "feat: add iOS StartingScreen model and StartingScreenService"
```

---

## Chunk 2: Cache

### Task 2: Implement file-based cache

**Files:**
- Create: `iosApp/iosApp/feature/starting/StartingScreenCache.swift`
- Create: `iosApp/iosAppTests/StartingScreenCacheTests.swift`

- [ ] **Step 1: Implement cache**

```swift
class StartingScreenCache {
    private let cacheVersion = 1
    private let fileManager = FileManager.default

    private var cacheURL: URL {
        fileManager.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("starting_screens_cache.json")
    }

    func getCachedBlocker() -> StartingScreen? {
        // Read JSON file, check version, parse, return or nil
    }

    func cacheBlocker(_ screen: StartingScreen, backgroundImagePath: String?) {
        // Atomic write: temp file, then rename
    }

    func clearBlocker() {
        try? fileManager.removeItem(at: cacheURL)
    }

    // Dismissed IDs in UserDefaults (acceptable — no PII)
    func isDismissed(_ screenId: String) -> Bool {
        let dismissed = UserDefaults.standard.stringArray(forKey: "dismissed_once_screens") ?? []
        return dismissed.contains(screenId)
    }

    func markDismissed(_ screenId: String) {
        var dismissed = UserDefaults.standard.stringArray(forKey: "dismissed_once_screens") ?? []
        dismissed.append(screenId)
        UserDefaults.standard.set(dismissed, forKey: "dismissed_once_screens")
    }
}
```

- [ ] **Step 2: Write cache tests**

Per spec: roundtrip, version mismatch, corrupt file, zero-byte file, atomic write, dismissed IDs persist, content hash comparison.

- [ ] **Step 3: Commit**

```bash
git add iosApp/
git commit -m "feat: add iOS StartingScreenCache with atomic file writes"
```

---

## Chunk 3: SwiftUI View

### Task 3: Build StartingScreenView

**Files:**
- Create: `iosApp/iosApp/feature/starting/StartingScreenView.swift`
- Create: `iosApp/iosApp/Assets.xcassets/police_duck.imageset/`

- [ ] **Step 1: Copy police duck asset**

Copy `app/src/main/res/drawable/police_duck.png` to `iosApp/iosApp/Assets.xcassets/police_duck.imageset/` with appropriate `Contents.json`.

- [ ] **Step 2: Implement SwiftUI view**

```swift
struct StartingScreenView: View {
    let screen: StartingScreen
    let onDismiss: () -> Void

    var body: some View {
        ZStack {
            // Background (image + overlay or solid colour)
            if let bgImage = screen.backgroundImage {
                // Load from URL, ContentMode.fill, clipped
                Color.black.opacity(0.6) // overlay
            } else {
                Color(UIColor.systemBackground)
            }

            ScrollView {
                VStack(spacing: 24) {
                    // ShyTalk branding (always present)
                    // NOTE: AppIcon sets are NOT loadable via UIImage(named:). Use dedicated "shytalk_logo" asset.
                    Image("shytalk_logo")
                        .resizable().frame(width: 80, height: 80).cornerRadius(16)
                    Text("ShyTalk").font(.largeTitle).bold()

                    // Template/custom image
                    if screen.imageType == "police_duck" {
                        Image("police_duck").resizable().frame(width: 160, height: 160).clipShape(Circle())
                    }

                    Text(screen.title).font(.title2).multilineTextAlignment(.center)
                    Text(screen.message).font(.body).foregroundColor(.secondary).multilineTextAlignment(.center)

                    if screen.dismissable {
                        Button(NSLocalizedString("starting_screen_dismiss", comment: "")) {
                            onDismiss()
                        }
                        .buttonStyle(.borderedProminent)
                        .accessibilityIdentifier("startingScreen_dismissButton")
                    }
                }
                .padding(32)
            }
        }
        .ignoresSafeArea()
        .accessibilityElement(children: .contain)
    }
}
```

- [ ] **Step 3: Write view tests**

Per spec: renders branding, renders title/message, dismiss button visible/absent, background image, dark mode, VoiceOver, Dynamic Type.

- [ ] **Step 4: Commit**

```bash
git add iosApp/
git commit -m "feat: add iOS StartingScreenView with branding, templates, and accessibility"
```

---

## Chunk 4: Coordinator + Entry Point

### Task 4: Create coordinator and restructure iOSApp.swift

**Files:**
- Create: `iosApp/iosApp/feature/starting/StartingScreenCoordinator.swift`
- Modify: `iosApp/iosApp/iOSApp.swift`
- Create: `iosApp/iosAppTests/StartingScreenCoordinatorTests.swift`

- [ ] **Step 1: Implement coordinator**

```swift
@MainActor
class StartingScreenCoordinator: ObservableObject {
    @Published var isBlocked = false
    @Published var isReady = false
    @Published var blockingScreen: StartingScreen?
    @Published var dismissableScreens: [StartingScreen] = []

    private let service = StartingScreenService()
    private let cache = StartingScreenCache()

    func checkStartingScreens() async {
        do {
            let screens = try await service.fetchStartingScreens()

            // Filter out dismissed once-screens
            let activeScreens = screens.filter { (_, screen) in
                if screen.frequency == "once" && cache.isDismissed(screen.screenId) {
                    return false
                }
                return true
            }

            let blocker = activeScreens.values.first { !$0.dismissable }

            if let blocker = blocker {
                if cache.getCachedBlocker()?.contentHash != blocker.contentHash {
                    cache.cacheBlocker(blocker, backgroundImagePath: nil)
                }
                blockingScreen = blocker
                isBlocked = true
            } else {
                cache.clearBlocker()
                // Store dismissable screens for showing after app loads
                dismissableScreens = activeScreens.values.filter { $0.dismissable }
                isBlocked = false
            }
        } catch {
            // API failed — use cache (fail-safe)
            if let cached = cache.getCachedBlocker() {
                blockingScreen = cached
                isBlocked = true
            } else {
                isBlocked = false // fail-open
            }
        }
        isReady = true
    }

    func dismiss() {
        isBlocked = false
        if let screen = blockingScreen, screen.frequency == "once" {
            cache.markDismissed(screen.screenId)
        }
    }
}
```

- [ ] **Step 2: Restructure iOSApp.swift**

**Note:** The design spec's example uses `coordinator.blockingScreen!` (force-unwrap) — that is a bug in the spec. Use `if let` binding as shown below to avoid a crash when `isBlocked` and `blockingScreen` are updated in separate `@Published` cycles.

```swift
@main  // MUST retain @main — this is the app entry point
struct iOSApp: App {
    @StateObject private var coordinator = StartingScreenCoordinator()

    var body: some Scene {
        WindowGroup {
            Group {
                if coordinator.isBlocked, let screen = coordinator.blockingScreen {
                    StartingScreenView(screen: screen,
                                       onDismiss: { coordinator.dismiss() })
                } else if !coordinator.isReady {
                    ProgressView()
                } else {
                    ContentView()
                }
            }
            .task { await coordinator.checkStartingScreens() }
        }
    }
}
```

- [ ] **Step 3: Write coordinator tests**

Per spec — all state machine transitions:
- `NO_CACHE → API_LOADING → BLOCKED`
- `NO_CACHE → API_LOADING → PROCEED_NORMAL`
- `CACHED_BLOCKER → API_LOADING → BLOCKED` (confirmed)
- `CACHED_BLOCKER → API_LOADING → BLOCKED` (API fail, fail-safe)
- `CACHED_BLOCKER → API_LOADING → PROCEED_NORMAL` (blocker removed)
- `BLOCKED → DISMISSED` (allowlisted)
- Invalid transitions verified impossible

- [ ] **Step 4: Verify iOS build**

```bash
cd iosApp && xcodebuild build -project iosApp.xcodeproj -scheme iosApp -sdk iphonesimulator -destination 'platform=iOS Simulator,OS=latest,name=iPhone 16' CODE_SIGNING_ALLOWED=NO
```

- [ ] **Step 5: Commit**

```bash
git add iosApp/
git commit -m "feat: restructure iOSApp.swift with StartingScreenCoordinator for pre-render blocking"
```

---

## Chunk 5: i18n + Privacy

### Task 5: Add localised strings and privacy manifest

**Files:**
- Create: `iosApp/iosApp/Localizable.xcstrings` (String Catalog — project uses `LOCALIZATION_PREFERS_STRING_CATALOGS = YES`)
- Modify: `iosApp/iosApp/PrivacyInfo.xcprivacy`

- [ ] **Step 1: Create Localizable.xcstrings String Catalog**

The project has `LOCALIZATION_PREFERS_STRING_CATALOGS = YES` in build settings, so use `.xcstrings` format (NOT `.lproj/Localizable.strings`).

Create `iosApp/iosApp/Localizable.xcstrings` as a String Catalog containing:
- `starting_screen_pre_launch_title` — "ShyTalk is not available yet" (+ all 19 locale translations)
- `starting_screen_pre_launch_message` — "ShyTalk has not been released yet..." (+ translations)
- `starting_screen_dismiss` — "Continue" (+ translations)
- `starting_screen_police_duck_description` — "Warning illustration" (+ translations)
- `starting_screen_loading` — "Loading…" (+ translations, used during startup check spinner)

Add the `.xcstrings` file to `project.pbxproj` `PBXResourcesBuildPhase`.

- [ ] **Step 2: Create PrivacyInfo.xcprivacy**

Create `iosApp/iosApp/PrivacyInfo.xcprivacy` (file does NOT exist yet) with `identifierForVendor` usage declaration. Add as `PBXFileReference` in `project.pbxproj` and register in `PBXResourcesBuildPhase` so it's embedded in the app bundle for App Store submission.

- [ ] **Step 3: Commit**

```bash
git add iosApp/
git commit -m "feat: add iOS starting screen i18n strings and privacy manifest"
```

---

## Chunk 6: Deep Test Coverage

### Task 6: Add all remaining tests per spec

- [ ] **Step 1: Implement all XCTest cases from spec section 6**

Cover: view rendering across device sizes, dark/light mode, Dynamic Type, VoiceOver, RTL, blocking behaviour, caching edge cases, network failures, upgrade/downgrade paths, absence testing.

See spec section 6 "iOS Tests (XCTest)" for the complete listing.

- [ ] **Step 2: Run all iOS tests**

```bash
cd iosApp && xcodebuild test -project iosApp.xcodeproj -scheme iosApp -sdk iphonesimulator -destination 'platform=iOS Simulator,OS=latest,name=iPhone 16'
```

- [ ] **Step 3: Commit**

```bash
git add iosApp/
git commit -m "test: exhaustive iOS starting screen test coverage per spec"
```
