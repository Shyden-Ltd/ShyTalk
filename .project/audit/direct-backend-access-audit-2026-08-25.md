# Direct Client→Backend Access — complete call-site inventory

**Date:** 2026-08-25
**Rule:** [[feedback-no-direct-backend-all-via-api]] — clients NEVER touch Firestore / RTDB /
Storage directly. All backend data access routes through the Express API, which is the
authorization layer.
**Epic:** [[EPIC-0006]] · **Transport decision:** [[SHY-0169]] — **SSE, ratified 2026-08-25**
**Mode:** read-only static scan. Reproducible: `node scripts/audit-direct-backend.js`

Supersedes the 2026-07-09 audit (~274 call sites, hand-enumerated). This one is generated, so it
can be re-run after every remediation story instead of being re-counted by hand.

---

## 1. Headline

| | |
| --- | --- |
| **Files with direct access** | **24** (+4 that only hold the SDK — see §5) |
| **Total call sites** | **244** |
| — one-shot reads | **62** → ordinary `GET` endpoints |
| — **live subscriptions** | **74** → **SSE** — the architecturally hard set |
| — writes | **85** → ordinary `POST` / `PATCH` |
| — deletes | **23** → ordinary `DELETE` |
| Android | 12 files · read 30 · listen 48 · write 58 · delete 14 |
| iOS | 8 files · read 30 · listen 21 · write 25 · delete 9 |
| Web | 4 files · read 2 · listen 5 · write 2 · delete 0 |

**Storage: zero.** Already 100% compliant — uploads go through the API's signed Cloudflare R2 URLs.

---

## 2. Every file, ordered by size of the job

| File | Platform | read | listen | write | del |
| --- | --- | ---: | ---: | ---: | ---: |
| `PrivateMessageRepositoryImpl.kt` | android | 10 | 8 | 28 | 1 |
| `IosPrivateMessageRepositoryImpl.kt` | ios | 11 | 3 | 12 | 1 |
| `IosRtdbServices.kt` | ios | 0 | 4 | 11 | 8 |
| `UserRepositoryImpl.kt` | android | 6 | 6 | 8 | 1 |
| `RoomRepositoryImpl.kt` | android | 5 | 7 | 6 | 0 |
| `RtdbPresenceService.kt` | android | 1 | 3 | 9 | 4 |
| `GiftRepositoryImpl.kt` | android | 2 | 10 | 0 | 0 |
| `IosEconomyGiftRepositories.kt` | ios | 5 | 7 | 0 | 0 |
| `EconomyRepositoryImpl.kt` | android | 3 | 5 | 0 | 0 |
| `SeatRequestRepositoryImpl.kt` | android | 1 | 4 | 3 | 0 |
| `IosRoomRepositoryImpl.kt` | ios | 5 | 2 | 1 | 0 |
| `IosUserRepositoryImpl.kt` | ios | 6 | 2 | 0 | 0 |
| `RtdbConversationService.kt` | android | 0 | 2 | 1 | 4 |
| `RtdbTypingRepository.kt` | android | 0 | 1 | 1 | 4 |
| `admin/js/tabs/spin-monitor.js` | web | 2 | 2 | 2 | 0 |
| `MessageRepositoryImpl.kt` | android | 0 | 2 | 2 | 0 |
| `IosSeatRequestRepositoryImpl.kt` | ios | 1 | 2 | 0 | 0 |
| `IosMessageRepositoryImpl.kt` | ios | 0 | 1 | 1 | 0 |
| `IosSmallRepositories.kt` | ios | 2 | 0 | 0 | 0 |
| `BannerRepositoryImpl.kt` | android | 1 | 0 | 0 | 0 |
| `NotificationRepositoryImpl.kt` | android | 1 | 0 | 0 | 0 |
| `admin/js/tabs/logs.js` | web | 0 | 1 | 0 | 0 |
| `admin/js/tabs/reports.js` | web | 0 | 1 | 0 | 0 |
| `portal/portal.js` | web | 0 | 1 | 0 | 0 |

**Android and iOS are near-mirrors.** Every Android repository has an iOS twin hitting the same
collections. Remediation stories should move both together or the platforms drift.

---

## 3. Two blind spots this audit had to fix in itself

Recorded because both would have produced a confident, wrong number.

**Import-only detection misses injected SDKs.** `public/admin/js/tabs/*.js` never import Firebase —
they receive it as `deps.firestoreFns` and call `_onSnapshot(...)`, `_getDocs(...)`. The first pass
reported **zero** call sites across three admin tabs that make thirteen between them, eight in
`spin-monitor.js` alone. The scanner now admits files that *receive* the SDK as well as those that
import it.

**Requiring SDK context on the same line misses multi-line chains.** The first pass gated every
bucket behind "this line also mentions firestore/collection", and reported **zero live listeners on
Android** — against 42 real `addSnapshotListener` calls — because `addSnapshotListener {` on its own
line says neither. Markers are now split: unambiguous ones (`addSnapshotListener`, `setDoc`,
`batch.update`) count alone; ordinary Kotlin (`.get()`, `.set(`) still needs nearby context, over a
six-line window rather than one line.

`batch.update(` and `transaction.update(` were found hiding in the residual — real Firestore writes
whose surrounding lines never say "firestore".

---

## 4. Remediation shape

**62 reads + 85 writes + 23 deletes = 170 sites** map onto ordinary request/response endpoints.
Decision-independent; they can start now.

**74 live subscriptions** need SSE ([[SHY-0169]]). The transport now exists — `express-api/src/utils/sse.js`
plus `GET /api/conversations/stream` as the worked example, with **authorization re-checked per
fan-out**. Every remaining listener follows that pattern.

The RTDB set (`RtdbPresenceService`, `RtdbConversationService`, `RtdbTypingRepository`,
`IosRtdbServices` — 10 listeners, 22 writes, 20 deletes) carries the extra `onDisconnect()` problem:
it fires server-side when a socket drops. SSE gives the server a connection-close event, which is
the equivalent signal, but presence needs that wired deliberately rather than assumed.

**Suggested sequence** — biggest blast radius first, both platforms together:

1. Private messaging (`PrivateMessageRepositoryImpl` + iOS twin) — 74 sites. **Started**: get-or-create
   and the list are already behind the API ([[SHY-0458]]).
2. RTDB presence + typing + conversation services — the `onDisconnect` question.
3. Rooms + seat requests (`RoomRepositoryImpl`, `SeatRequestRepositoryImpl` + twins).
4. Users (`UserRepositoryImpl` + twin).
5. Economy + gifts (22 listeners between them, no writes — read-only, so SSE plus GETs).
6. Web: admin tabs + portal — 9 sites, staff-only, smallest blast radius.
7. Banners + notifications — 2 sites, trivial.

---

## 5. Files that hold the SDK but make no data calls

Legitimate. They provide or adapt the SDK; they do not read or write.

- `app/src/main/java/com/shyden/shytalk/core/di/AppKoinModule.kt`
- `shared/src/iosMain/kotlin/com/shyden/shytalk/core/di/IosPlatformModule.kt`
- `shared/src/iosMain/kotlin/com/shyden/shytalk/core/di/KoinHelper.kt`
- `shared/src/iosMain/kotlin/com/shyden/shytalk/data/firestore/DocumentSnapshotIosExt.kt`
- `public/admin/js/main.js` — the web equivalent: `const clientDb = getFirestore(app)`, then
  injects `firestoreFns` into the tabs. Holds the SDK; makes no calls of its own.

They leave the ratchet baseline last, once nothing needs the SDK injected any more. Until then they
are the honest reason the ratchet counts 29 files and this audit counts 24.

---

## 5b. Second sweep — where else was checked, and found clean

The first pass had a *scope*, and a scope is an assumption. Everything below was
searched afterwards specifically because it lay outside it. **Nothing new was
found.** Recorded so the next person does not have to re-derive that.

| Area | Result |
| --- | --- |
| `iosApp/` — 21 native **Swift** files | Clean. The only `Firestore` mention in our own Swift is a comment; every real import lives in vendored `iosApp/Pods/`. |
| `app/src/dev/`, `app/src/local/` — flavour source sets | Resources, manifests and `google-services.json` only. No code. |
| `shared/src/{jvmMain,jvmTest,commonTest,androidHostTest}` | Zero files with a data SDK. |
| `functions/` | Cloudflare Pages middleware (basic-auth + robots). No Firebase. |
| `public/js/**` — 19 files | Clean. All traffic goes through `public/js/core/api.js` → `fetch(apiBase + path)`. Firebase **Auth** only in 3 files (allowed exception). |
| `public/*.html` inline scripts | `roadmap.html` loads firebase-app + firebase-**auth** only (allowed). `admin/index.html` mentions firebaseio in a CSP header. |
| **Direct REST**, bypassing the SDK entirely | `firestore.googleapis.com` appears only in `tests/web/dev-smoke.spec.ts`, which deliberately writes as a client would in order to TEST `firestore.rules`. Legitimate — and note it becomes the *only* exercise of those rules once no client connects. |
| `identitytoolkit` / `securetoken` REST | Auth plane, in tests and test helpers. Allowed exception. |
| **R2 / MinIO / S3** direct from client | None. Uploads go through the API's signed URLs. |
| `local/seed.js`, `scripts/*.mjs` | Dev-machine tooling on the **Admin SDK**, shipped to no client. Sanctioned. |
| Dev/ops tooling, `.github/`, `.claude/` | Not client code. |

Two things found that are **not** violations but should be remembered:

- **`public/portal/index.html` loads `firebase-firestore-compat.js` in a script tag.** Its consumer
  `portal/portal.js` is already counted, so this is not a separate site — but removing the JS usage
  must also remove the script tag, or the SDK keeps shipping to browsers for nothing.
- **LiveKit is a direct client→media WebSocket** (`ws://…:7880`). The *authorization* is the token,
  which the API issues (`POST /api/livekit/token`); media cannot be proxied through Express. It is
  architecturally necessary and out of scope for this rule, but it is a direct backend connection and
  should be a deliberate exception rather than an oversight — worth the operator's ratification.

## 6. Out of scope

- **Firebase Auth** — the auth plane, not the data plane. Client sign-in and ID-token minting stay
  client-side; it is how the client proves identity *to* the API. Ruled an allowed exception
  2026-07-09.
- **The Express API's own Admin SDK use** — that IS the sanctioned channel.
- **Rewriting `firestore.rules`** — they stay as defence in depth, and tighten to deny-by-default
  once no client connects. Note [[SHY-0458]] found the `get` rule denies reads of documents that do
  not exist (`Null value error`), which is only harmless once no client performs that read.

---

## 7. Re-running this

```sh
node scripts/audit-direct-backend.js            # summary table
node scripts/audit-direct-backend.js --json     # machine-readable
node scripts/audit-direct-backend.js --file UserRepositoryImpl   # every hit in one file
```

Run it after each remediation story. The number must only ever go down, and
`scripts/check-no-direct-backend.js` must have its baseline shrunk to match — never grown.
