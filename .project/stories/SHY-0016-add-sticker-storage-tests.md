---
id: SHY-0016
status: Draft
owner: claude
created: 2026-06-07
priority: P2
effort: S
type: bug
roadmap_ids: [G038]
pr:
---

# SHY-0016: StickerStorage platform tests (file I/O lifecycle)

## User Story

As the ShyTalk operator, I want **`StickerStorage` to have platform-specific tests in `androidHostTest` + `iosMain` covering file I/O lifecycle (put / get / delete / list / disk-full / corruption)**, so that the sticker-cache layer has explicit coverage rather than relying on indirect coverage from feature tests.

## Why

`shared/src/androidMain/.../StickerStorage.android.kt` + `shared/src/iosMain/.../StickerStorage.ios.kt` implement an `expect/actual` contract for sticker file I/O — used to cache animated sticker assets locally for room/gift use.

Roadmap row G038 (line 65 of `.project/test-plans/exhaustive/2026-06-05-zero-gap-roadmap.md`):

> Sev: 🟡 Polish. Test — StickerStorage platform impls. Location: `shared/src/{androidMain,iosMain}/.../StickerStorage.{android,ios}.kt`. Gap: File I/O for stickers uncovered. Fix: androidHostTest + iosMain lifecycle tests. Scope: S.

P2 Tier-4 polish. Same contract-test pattern as SHY-0015 (SecureStorage), smaller surface.

## Acceptance Criteria

### Happy path

- [ ] `shared/src/commonTest/kotlin/com/shyden/shytalk/core/sticker/StickerStorageContractTest.kt` defines the shared contract: an abstract test class with ≥12 cases.
- [ ] `shared/src/androidUnitTest/kotlin/.../AndroidStickerStorageTest.kt` extends the contract (or `androidInstrumentedTest` if file I/O requires Context).
- [ ] `shared/src/iosTest/kotlin/.../IosStickerStorageTest.kt` extends the contract.
- [ ] Contract covers:
  - put(stickerId, bytes) → file written to expected location.
  - get(stickerId) returns the bytes.
  - get(stickerId) for non-existent → null.
  - delete(stickerId) → file removed; subsequent get → null.
  - list() returns all stored sticker IDs.
  - put with same ID overwrites existing.
  - large file (1 MB) handled.
- [ ] All tests pass on both platforms.
- [ ] Sonar coverage on both actual files ≥85%.

### Error paths

- [ ] Disk full → `Result.Failure(DiskFull)` with platform-appropriate exception class.
- [ ] Permission denied (file system inaccessible) → `Result.Failure(IOException)`.
- [ ] Corrupted file (partial write detected on read) → `Result.Failure(Corrupted)`; entry wiped.
- [ ] Concurrent write/read on same ID → atomic per platform; no torn writes.

### Edge cases

- [ ] Empty bytes (0-byte file) → distinguishes "stored empty" from "not stored".
- [ ] Very large file (10 MB) → handled or throws `PayloadTooLarge`.
- [ ] Special characters in sticker ID (UUID, hash) → safe filesystem path (no path traversal).
- [ ] App reinstall → cache cleared on both platforms (per platform conventions).
- [ ] Cache eviction (if implemented) → LRU or size-based; verify policy with test.

### Performance

- [ ] put(1 KB) < 50ms p99.
- [ ] get(1 KB) < 20ms p99.
- [ ] Test suite < 15s.

### Security

- [ ] Sticker ID sanitised before use as file path (no `../` traversal).
- [ ] Files stored in app-private directory (not world-readable on Android; not iCloud-backed on iOS).
- [ ] No PII in file paths or contents.

### UX

- [ ] N/A — internal cache.

### i18n

- [ ] N/A.

### Observability

- [ ] put/get/delete logged at DEBUG with sticker ID (not bytes).
- [ ] Corruption events logged at WARN.
- [ ] Sonar coverage ≥85%.

## BDD Scenarios

**Scenario: Android round-trip**

- **Given** Android StickerStorage with a writable cache dir
- **When** put("sticker-A", bytes) followed by get("sticker-A")
- **Then** the get returns identical bytes

**Scenario: iOS round-trip**

- Same as Android but on iOS.

**Scenario: Non-existent get returns null**

- **Given** empty storage
- **When** get("missing") is called
- **Then** result is null

**Scenario: Delete removes file**

- **Given** put("X", bytes); confirm file exists
- **When** delete("X") is called
- **Then** file no longer exists on disk

**Scenario: Path traversal sanitised**

- **Given** put("../../etc/passwd", bytes) attempted
- **When** the implementation processes the ID
- **Then** the file is written to a sanitised path within app-private dir (not /etc/)
- **OR** the call rejects with `Result.Failure(InvalidId)`

**Scenario: Large file boundary**

- **Given** a 10 MB byte array
- **When** put(...) is called
- **Then** either succeeds OR throws `PayloadTooLarge` with documented limit

## Test Plan (TDD)

### Red

1. Locate `StickerStorage.android.kt` + `StickerStorage.ios.kt`.
2. Add contract test + 2 platform tests.
3. Run platform test suites → RED on undertested paths (likely path-sanitisation + corruption).

### Green

1. Add minimum fixes for surfaced bugs.
2. Sonar coverage ≥85%.

## Out of Scope

- **Refactoring StickerStorage interface** — only tests.
- **Adding new sticker features** — only coverage.
- **Cache eviction policy redesign** — only verify current policy.

## Dependencies

- **SHY-0001** + **SHY-0032** — process.
- **SHY-0015** — pattern template (contract test + platform extensions).
- Platform test source set wiring (verify).

## Risks & Mitigations

- **Risk:** Android needs Context for file I/O; pure `androidUnitTest` may be insufficient. **Mitigation:** use Robolectric OR move to `androidInstrumentedTest`.
- **Risk:** Path-traversal test surfaces a real vulnerability. **Mitigation:** GOOD outcome; fix in this PR.

## Definition of Done

- [ ] 3 test files exist; ≥12 cases pass per platform.
- [ ] Any surfaced bugs fixed.
- [ ] Sonar coverage ≥85%.
- [ ] Reviewer ZERO findings.
- [ ] Per-type Done gate (`bug` → auto-merge + dev smoke).
- [ ] PR merged.
- [ ] `status: Done`; `pr:` populated.

## Notes (running log)

- 2026-06-07 ~21:31 BST — Refined under SHY-0032. Tier 4 polish.
- 2026-06-07 — Skeleton from `convert-roadmap-to-stories.sh` PR-bundle `PR-E4` (G038).
