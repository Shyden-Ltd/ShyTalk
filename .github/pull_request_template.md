## Summary
<!-- What changed and why -->

## Test plan
<!-- How to verify this works -->

---

<details>
<summary>PR Commands</summary>

| Command | Description |
|---------|-------------|
| `/run-e2e` | Run all E2E tests (Android + iOS + Web) |
| `/run-e2e android` | Run all Android E2E devices |
| `/run-e2e ios` | Run all iOS E2E devices |
| `/run-e2e web` | Run all Playwright browser tests |
| `/run-e2e android web` | Run Android + Web only |
| `/run-e2e android:35-phone` | Run specific Android device (API-formFactor) |
| `/run-e2e web:chromium,firefox` | Run specific browsers |
| `/run-e2e ios:18.1-iphone` | Run specific iOS device |
| `/deploy` | Deploy to internal testers (Android + iOS) |

**Android devices:** `28-phone`, `28-tablet`, `30-phone`, `30-tablet`, `33-phone`, `33-tablet`, `35-phone`, `35-tablet`
**iOS devices:** `16.4-iphone`, `16.4-ipad`, `17.5-iphone`, `17.5-ipad`, `18.1-iphone`, `18.1-ipad`
**Web browsers:** `chromium`, `firefox`, `webkit`, `mobile-chrome`, `mobile-safari`

</details>
