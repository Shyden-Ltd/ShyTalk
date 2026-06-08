# Repo Size Audit — 2026-06-08

**Scope:** investigate operator-flagged ">1GB repo size" (operator 2026-06-07 ~22:10 BST: "be careful what you're actually comitting, don't upload large files"); identify historical large-file commits; document for future cleanup; design prevention mechanisms.

**Constraint:** investigation-only — no force-push, no `git filter-repo`, no BFG (operator 2026-06-08 ~10:11 BST: "you do 1. but without force-pushes, you have to follow the processes"). History rewrite is deferred to a future explicit-auth SHY.

**Companion SHY:** [SHY-0035](../stories/SHY-0035-investigate-repo-size.md).

---

## Headline numbers

| Metric                                    | Value         | Notes                                                                                    |
| ----------------------------------------- | ------------- | ---------------------------------------------------------------------------------------- |
| Pack size (`size-pack`)                   | **12.74 GiB** | The authoritative "how much does every clone pull" number.                               |
| Loose-object size                         | 3.25 MiB      | Tiny — pack-files have absorbed nearly everything.                                       |
| In-pack object count                      | 2,046,881     | High enough to confirm large historical churn (mostly small Allure artefacts).           |
| Pack file count                           | 8             | Normal range; not a fragmentation issue.                                                 |
| `.git/` on-disk                           | 13 GiB        | Pack + loose + reflog + refs.                                                            |
| Working-tree on-disk (excl. `.git/`)      | 22 GiB        | Almost all build artefacts (gRPC.framework, Firestore framework, dev APK, KMP `.dylib`). |
| Currently-tracked files >5MB              | **6 files**   | 1× `room_background.gif` (52 MB) + 5× `police_duck.png` (5.81 MB each — cross-platform mascot asset, copied to Android `res/drawable/`, iOS `.xcassets/`, web `public/admin/assets/`, Compose `composeResources/drawable/`, and root `assets/`). All legitimate. See the detailed table below. |

The operator's "1GB" was conservative by an order of magnitude. The actual remote pack is **12.74 GiB** — every clone of the repo pulls this.

---

## `git count-objects -vH` snapshot

```
count: 594
size: 3.25 MiB
in-pack: 2046881
packs: 8
size-pack: 12.74 GiB
prune-packable: 4
garbage: 0
size-garbage: 0 bytes
```

---

## Top-40 largest blobs ever committed

Sorted by size descending. `path` is the FIRST path the blob was committed under (some blobs are referenced from many paths via renames).

| Rank | Size (bytes) | Path                                                       |
| ---: | -----------: | ---------------------------------------------------------- |
|    1 |   54,644,354 | `app/src/main/res/raw/room_background.gif`                 |
|    2 |   43,679,960 | `data/attachments/34cc1ab47f285541.zip`                    |
|    3 |   35,946,313 | `data/attachments/3579b234c54d1a20.zip`                    |
|    4 |   35,595,504 | `data/attachments/fb196c1a27d901bb.zip`                    |
|    5 |   35,585,717 | `data/attachments/3e5cb528655155.zip`                      |
|    6 |   35,568,166 | `data/attachments/a197e82649b0a4d4.zip`                    |
|    7 |   35,504,141 | `data/attachments/dcbe62ce06913d0.zip`                     |
|    8 |   21,467,958 | `data/attachments/167067ab0d83fabf.zip`                    |
|    9 |   21,425,217 | `data/attachments/cb093c3b0dea5eab.zip`                    |
|   10 |   21,407,996 | `data/attachments/7831242583d65449.zip`                    |
|   11 |   21,351,622 | `data/attachments/e29a409a7dc94c2a.zip`                    |
|   12 |   21,096,284 | `data/attachments/7302e86cf1d847e1.zip`                    |
|   13 |   20,114,534 | `data/attachments/e573d666bfd9c7ff.zip`                    |
|   14 |   20,008,537 | `data/attachments/a4594e88b7158171.zip`                    |
|   15 |   19,445,652 | `data/attachments/37f669ef6e61355d.zip`                    |
|   16 |   19,320,516 | `data/attachments/19164cedffc4bd9.zip`                     |
|   17 |   19,252,128 | `data/attachments/639176a980ca6c32.zip`                    |
|   18 |   18,882,778 | `data/attachments/4db322d70295a091.zip`                    |
|   19 |   18,808,899 | `data/attachments/475d450ce30e47a7.zip`                    |
|   20 |   18,793,538 | `data/attachments/dfe5160d9048cc62.zip`                    |
|   21 |   18,780,689 | `data/attachments/23649209e035762e.zip`                    |
|   22 |   18,741,952 | `data/attachments/c1c8706af9ac8e05.zip`                    |
|   23 |   18,731,083 | `data/attachments/e4e3a029dd1f228.zip`                    |
|   24 |   18,669,194 | `data/attachments/c32982a9273df335.zip`                    |
|   25 |   15,340,325 | `data/attachments/ed9338aee8c67ceb.zip`                    |
|   26 |   14,942,560 | `data/attachments/6e6959a13627d407.zip`                    |
|   27 |   14,504,995 | `data/attachments/6c1ff30c29f5b6f3.zip`                    |
|   28 |   14,481,338 | `data/attachments/207d49ffd093b780.zip`                    |
|   29 |   14,280,976 | `data/attachments/8fac08bdf3e2eb9b.zip`                    |
|   30 |   14,198,082 | `data/attachments/4399d6987a53fe18.zip`                    |
|   31 |   13,490,842 | `data/attachments/423c1e3408782dfd.zip`                    |
|   32 |   13,461,100 | `data/attachments/aa218ab5947218a6.zip`                    |
|   33 |   13,366,266 | `data/attachments/8dfbc0ce54a71716.zip`                    |
|   34 |   13,345,954 | `data/attachments/3cb1d250f71885da.zip`                    |
|   35 |   13,344,732 | `data/attachments/2a9ec0cd8f2bcc6f.zip`                    |
|   36 |   13,337,042 | `data/attachments/c6f52f6f4b0b9462.zip`                    |
|   37 |   13,299,951 | `data/attachments/e8d99aca0ee57cf4.zip`                    |
|   38 |   13,295,684 | `data/attachments/716b490787b9db08.zip`                    |
|   39 |   13,290,113 | `data/attachments/d9f41fa6c4e8b2ca.zip`                    |
|   40 |   12,896,181 | `playwright/pr/latest/data/attachments/525b72dadc768897.zip` |

**Pattern:** rows 2–40 are all `*.zip` files under `data/attachments/` or `playwright/pr/latest/data/attachments/` with random-hex names. This is the signature of Allure's attachment-storage layout (Allure stores test-run zips with a content-hash filename).

---

## Top-level directory bloat (ever-committed totals)

Sum of sizes of every blob whose first path-component matches the directory, across the full reachable history.

| Top-level dir   | Ever-committed (bytes) | Ever-committed (MiB) | Currently tracked? |
| --------------- | ---------------------: | -------------------: | -----------------: |
| `data/`         |         24,697,477,474 |          **23,553**  | 0 files            |
| `playwright/`   |         14,499,206,770 |          **13,827**  | 0 files            |
| `express/`      |          2,704,350,815 |           **2,579**  | 0 files            |
| `history/`      |            993,117,717 |             **947**  | 0 files            |
| `kotlin/`       |            481,379,587 |             **459**  | 0 files            |
| `express-api/`  |            304,188,302 |             **290**  | (legit dir)        |
| `android-e2e/`  |            155,080,245 |             **148**  | 0 files            |

Total ever-committed across the 6 bloat dirs (excluding the legitimate `express-api/`): **41.5 GiB uncompressed**. The pack delta-compresses this to ~12.5 GiB (most Allure trend-JSON files differ in only a few bytes per run, compressing brilliantly).

---

## Root-cause analysis: Allure CI artefact commits

All six bloat directories match the Allure-report tree structure:

- `<dir>/pr/<n>/index.html`
- `<dir>/pr/<n>/history/categories-trend.json`
- `<dir>/pr/<n>/data/attachments/<hex>.zip`
- `<dir>/deploy/...` (Allure aggregated reports per deploy)
- `<dir>/latest/...` (Allure rolling "latest" pointer)
- `history/categories-trend.json` etc (Allure history at repo root, accidentally promoted)

Sample paths confirmed:
- `android-e2e/pr/history/categories-trend.json` ✓ Allure history file
- `data/attachments/1005b41cb33ca415.zip` ✓ Allure attachment naming
- `express/pr/latest/base.css` ✓ Allure report static asset
- `kotlin/pr/latest/_1kLjCFQF6A/index.html` ✓ Allure report HTML
- `playwright/deploy/history/duration-trend.json` ✓ Allure trend file

**Hypothesised sequence (load-bearing for prevention design):**

1. Early version of an Allure-report CI workflow generated reports into the working tree at `<surface>/pr/<n>/` rather than the canonical `allure-report/` (the path the current `.gitignore` line 106 covers).
2. A separate workflow ran `git add . && git commit` to publish the reports — committing them to a branch, then either:
   - pushing that branch as `gh-pages` (the deploy path), OR
   - merging back to `main` (the accidental path).
3. Once the reports were on `main`'s history, every subsequent run of the workflow produced new reports + new commits, exponentially compounding.
4. Eventually the workflow was fixed (current `allure-report.yml` writes only to `allure-report/` which IS gitignored) but the historical commits remained.
5. All six top-level dirs were `git rm`-ed at some later point (they're 0-files-tracked today) but their blobs remain reachable through historical commits, deleted-branch refs (GitHub keeps ~90d), and reflogs.

**Conclusion:** the bloat is **purely historical**. Current workflows are NOT actively committing Allure reports back to the repo. The fix is two-pronged: (a) prevent any future regression via `.gitignore` + CI lint; (b) defer history-rewrite cleanup to an explicit-auth SHY.

---

## Currently-tracked files >5MB

Six entries surfaced by `scripts/check-large-files.sh` HEAD-mode (after exhaustive `git ls-tree -r HEAD` + `git cat-file -s` scan):

| Path                                                                               |   Size  | Legitimate?                                          | Recommendation                                  |
| ---------------------------------------------------------------------------------- | ------: | ---------------------------------------------------- | ----------------------------------------------- |
| `app/src/main/res/raw/room_background.gif`                                         | 52.11 MB | ✓ App resource (in-room background animation)        | Borderline — CDN-migration candidate in a future SHY. Out of scope here. |
| `app/src/main/res/drawable/police_duck.png`                                        |  5.81 MB | ✓ Cross-platform mascot asset (Android drawable)     | Borderline — image-optimisation candidate (likely lossless-recompressible). Out of scope. |
| `assets/police_duck.png`                                                           |  5.81 MB | ✓ Cross-platform mascot asset (root asset copy)      | Same — image-optimisation candidate.            |
| `iosApp/iosApp/Assets.xcassets/police_duck.imageset/police_duck.png`               |  5.81 MB | ✓ Cross-platform mascot asset (iOS xcassets)         | Same — image-optimisation candidate.            |
| `public/admin/assets/police_duck.png`                                              |  5.81 MB | ✓ Cross-platform mascot asset (web admin)            | Same — image-optimisation candidate.            |
| `shared/src/commonMain/composeResources/drawable/police_duck.png`                  |  5.81 MB | ✓ Cross-platform mascot asset (Compose Multiplatform)| Same — image-optimisation candidate.            |

**Why the lint accepts these in PR-mode despite HEAD-mode flagging them:** CI runs `scripts/check-large-files.sh --against origin/main`, which only inspects the **diff** (files added or modified vs `origin/main`). Pre-existing tracked blobs that no PR touches are not in any diff. The HEAD-mode (no `--against`) is for audit / baseline use; the values above are this audit's baseline.

**Why `police_duck.png` is duplicated 5×:** standard cross-platform asset packaging — each platform requires its own copy in its conventional location (Android `res/drawable/`, iOS `.xcassets/`, web `public/admin/assets/`, Compose `composeResources/drawable/`, plus the root `assets/` source-of-truth). A future de-duplication SHY could centralise these under a single Gradle/`assemble-assets` build step that copies-on-build instead of committing 5 copies; deferred until any of these assets needs a refresh.

---

## Working-tree large files (NOT tracked — local-only)

These dominate the 35 GiB working-tree footprint but are correctly excluded from git via existing `.gitignore` rules. Listed for completeness so future audits don't false-alarm.

| Path                                                                                          | Size   | Type                            | Gitignored by      |
| --------------------------------------------------------------------------------------------- | -----: | ------------------------------- | ------------------ |
| `build/ios-derived-data/.../gRPC-Core/grpc.framework/grpc`                                    | 2.9 GB | iOS gRPC build artefact         | `build/`           |
| `iosApp/build/derived/.../gRPC-Core/grpc.framework/grpc`                                      | 1.5 GB | iOS gRPC build artefact         | `iosApp/build/`    |
| `build/ios-derived-data/.../gRPC-Core.build/Objects-normal/x86_64/Binary/grpc`                | 1.5 GB | iOS gRPC build artefact         | `build/`           |
| `build/ios-derived-data/.../gRPC-Core.build/Objects-normal/arm64/Binary/grpc`                 | 1.5 GB | iOS gRPC build artefact         | `build/`           |
| `build/ios-derived-data/.../FirebaseFirestoreInternal/FirebaseFirestoreInternal.framework/.*` | 538 MB | iOS Firestore build artefact    | `build/`           |
| `shared/build/.../shared.framework/shared`                                                    | 390 MB | KMP shared framework            | `shared/build/`    |
| `firestore-debug.log`                                                                         | 332 MB | Local Firebase emulator log     | `.gitignore:132`   |
| `iosApp/build/.../iosApp.debug.dylib`                                                         | 283 MB | iOS app debug binary            | `iosApp/build/`    |
| `app/build/outputs/apk/local/debug/app-local-debug.apk`                                       | 190 MB | Android dev APK                 | `app/build/`       |

Total local-only: ~10 GiB. All confirmed gitignored.

---

## Prevention mechanisms shipped in SHY-0035

1. **`.gitignore` hardening** — explicit ignores for `/data/`, `/playwright/pr/`, `/playwright/deploy/`, `/playwright/latest/`, `/express/`, `/history/`, `/kotlin/`, `/android-e2e/` (the six confirmed Allure-pattern dirs; `/express/` and `/kotlin/` were widened from `/express/pr/` and `/kotlin/pr/` per architect Suggestion 2026-06-08 to also catch the `deploy/`/`latest/` Allure variants — `express-api/` is the actual tracked source dir, distinct path). Plus reinforced extension blocks: `*.apk`, `*.aab`, `*.ipa`, `*.zip`.
2. **`scripts/check-large-files.sh`** — pre-push + CI lint that rejects any file >5MB on the diff. Threshold matches operator's "never commit files >5MB without explicit authorisation" directive.
3. **PR-description escape hatch** — `[allow-large-file: <path> reason: <reason>]` marker in PR body grants per-PR exemption for legitimate large assets.
4. **Pin tests** — `express-api/tests/scripts/check-large-files.test.js` (17 tests, script behaviour — includes `--against=ref` equals-form added in reviewer cycle 1) + `express-api/tests/scripts/large-file-guard-pin.test.js` (11 tests, workflow wiring regression net).

See [SHY-0035](../stories/SHY-0035-investigate-repo-size.md) AC + BDD for full spec.

---

## Future SHY candidates (filed by this audit)

| Proposed SHY | Scope                                                                                                                             | Trigger condition                       |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| (TBD)        | History rewrite via `git filter-repo` to purge the 6 Allure-pattern dirs + force-push to main + reset all forks/clones            | Explicit operator authorisation only.   |
| (TBD)        | Move `app/src/main/res/raw/room_background.gif` (52MB) to CDN; runtime download + cache on first launch                           | When app size becomes a Play Store / TestFlight friction. |
| (TBD)        | Adopt Git LFS for any future large-asset additions (textures, animations, fonts)                                                  | When the next legitimate large asset is needed. |
| (TBD)        | CI metric: repo pack size growth alerter (fail-if-pack-grows-by-N% in a single PR)                                                | If the per-file lint proves insufficient. |
| (TBD)        | Warning at 80% of the 5MB threshold (4MB) — surface near-threshold additions before they cross                                    | If users start hitting the 5MB limit frequently. |

---

## Diff-from-baseline procedure (for future re-audits)

A future re-audit doc should be named `repo-size-audit-YYYY-MM-DD.md` (date-stamped, never overwrites this baseline). The future doc's "Headline numbers" section should include a comparison column versus this 2026-06-08 baseline:

| Metric             | 2026-06-08 baseline | <future date> | Δ        |
| ------------------ | ------------------- | ------------- | -------- |
| Pack size          | 12.74 GiB           | ...           | ...      |
| In-pack objects    | 2,046,881           | ...           | ...      |
| `>5MB tracked`     | 6                   | ...           | ...      |

If the pack size INCREASED, investigate via the same commands used here (`git rev-list --objects --all | git cat-file --batch-check`); the lint should have prevented per-file additions but aggregate growth from legitimate small commits is expected over time.

---

## Investigation command reference

For reproducibility, the canonical commands used to produce this audit:

```bash
# Headline numbers
du -sh .git
git count-objects -vH

# Top-40 largest blobs
git rev-list --objects --all 2>/dev/null \
  | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' 2>/dev/null \
  | awk '$1=="blob" {print $3, $4}' \
  | sort -nr \
  | head -40

# Top-level dir aggregates
git rev-list --objects --all 2>/dev/null \
  | git cat-file --batch-check='%(objecttype) %(objectsize) %(rest)' 2>/dev/null \
  | awk '$1=="blob" {n=split($3, parts, "/"); top=parts[1]; sum[top]+=$2}
         END {for (k in sum) if (sum[k] > 100*1024*1024)
              printf "%-40s %15d bytes %8.1f MiB\n", k, sum[k], sum[k]/1024/1024}' \
  | sort -k2 -nr

# Per-directory currently-tracked check
git ls-tree -r HEAD --name-only | grep -E '^data/attachments/' | wc -l

# Currently-tracked >5MB blobs
git ls-tree -r HEAD | awk '$2=="blob"' \
  | while read mode type sha rest; do
      size=$(git cat-file -s "$sha")
      [ "$size" -gt 5242880 ] && echo "$size $rest"
    done \
  | sort -nr
```

---

## Sign-off

Audit completed by Claude (claude-opus-4-7) on 2026-06-08 11:24–11:35 BST, on branch `story/SHY-0035-investigate-repo-size`. Source-of-truth findings reside in this file; SHY-0035 spec links here for the canonical "what got committed" record.
