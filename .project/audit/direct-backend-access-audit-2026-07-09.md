# Direct Client→Backend Access Audit — ShyTalk

**Date:** 2026-07-09
**Rule under audit (operator, HARD GLOBAL):** Clients must NEVER talk to backend data services (Firestore / Realtime Database / Storage) directly. ALL backend data communication must route through the Express API (`express-api/**`), which is the authorization layer.
**Purpose:** Durable, exhaustive enumeration of every current VIOLATION so we can (a) remediate each and (b) build a CI ratchet with an accurate baseline.
**Mode:** Read-and-report only. No code was changed.

---

## 1. Headline counts

| Metric | Count |
|---|---|
| **Files with direct backend access (client)** | **26** (Android 14, iOS 8, Web 4 + 2 init/injection files) |
| **Total direct data-plane call-sites** | **~274** |
| — Android | 142 (111 Firestore + 31 RTDB) |
| — iOS | 125 (100 Firestore + 25 RTDB) |
| — Web | 7 (7 Firestore + 0 RTDB) |
| **By service** | Firestore **218** · RTDB **56** · Storage **0** |
| **Real-time streaming reads** (the architecturally-hard subset) | **~50** (Android 23, iOS 21, Web 6) |
| **DI injection points** feeding the data SDK to repos | **2** Koin modules (Android + iOS) + **2** web init sites |

**Baseline recommendation for the CI ratchet:** the most robust, reproducible baseline is the **26-file importer count** (a ratchet greps for the Firebase *data* SDK imports listed in §7). The ~274 call-site figure is a finer-grained secondary baseline. Both are enumerated below.

**Key structural findings:**
- **Storage is already 100% compliant.** No client uses the Firebase Storage SDK. Image / ID uploads go through the Express API which issues signed **Cloudflare R2** PUT URLs (`StorageRepositoryImpl`, `IosStorageRepositoryImpl`, `AgeVerification*`). Nothing to remediate here.
- **Android and iOS are near-perfect mirrors.** Every Android repo violation has an identical iOS twin (same collection, same operation). Remediation stories should fix both platforms together.
- **The repos are HYBRID, not un-migrated.** Room mutations, all economy/gift *transactions*, PM message *sends*, reports, identity, device ban-check, notifications-token, translations, follow/social graph, account-deletion/export, OTP/PIN/biometric are **already routed through the API**. What remains direct is: **all reads** (one-shot + real-time), plus a residual tail of **writes** (profile edits, block-list, `currentRoomId`, conversation/group settings & moderation writes, seat-request approve/deny, device-binding, room-chat message writes).
- **Real-time reads are the hard problem.** ~50 live listeners (Firestore `.snapshots()`/`addSnapshotListener` + RTDB `valueEvents`/`addValueEventListener`) cannot be trivially converted to request/response. They need an architectural decision (SSE / WebSocket / poll via the API) — see §8 and the Cluster R stories in §9.

---

## 2. Scope & method

**Searched (client code only), excluding `**/build/**`, `**/Pods/**`, `**/node_modules/**`, `*.framework`:**
- Android: `app/src/main/**`, `shared/src/androidMain/**` — native `com.google.firebase.firestore` / `.database` / `.storage`.
- iOS: `shared/src/iosMain/**` — `dev.gitlive.firebase.firestore` / `.database` / `.storage`.
- Common: `shared/src/commonMain/**` — any direct Firebase data access.
- Web: `public/**` — `getFirestore`, `firebase.firestore()`, `onSnapshot`, `firebase.database()`, `firebase.storage()`, etc.

**Explicitly OUT of scope (legitimate Firebase Admin SDK):** `express-api/**`, Cloud `functions/**`.

**Clean surfaces (confirmed zero data-plane access):**
- `shared/src/androidMain/**` — NONE (only Auth sign-in helpers).
- `shared/src/commonMain/**` — NONE. No `.snapshots`, no gitlive/google data SDK. Repositories are declared as interfaces here; implementations live per-platform.
- Web `public/js/**` marketing/roadmap (`roadmap-auth.js`, `shared-header.js`, `suggestions-board.js`, `preview-watermark.js`) and `public/roadmap.html` — **Auth only**, no Firestore/RTDB/Storage data plane (see §6).
- Firebase **Storage** SDK — NONE on any client.
- Firebase **RTDB** on Web — NONE (`firebase.database()`/`getDatabase` absent).

---

## 3. VIOLATIONS — Android (`app/src/main/**`)

Path prefixes: Firestore collections `rooms/`, `users/`, `conversations/`, `config/`, `gifts`, `broadcasts`, `coinPackages`, `giftRankings`, `banners`, `funFacts`, `deviceBindings`. RTDB paths `rooms/{id}/presence`, `.../events/lastEvent`, `conversations/{id}/typing`, `.../events/lastEvent`, `ownerLeft/{roomId}`, `.info/connected`.

Operation legend: **R1** = one-shot read (`.get()`), **RT** = real-time read (listener), **W** = write (set/update/add/setValue), **D** = delete/removeValue.

### 3.1 `data/repository/RoomRepositoryImpl.kt` — Firestore (14 call-sites)
| Method | line | path | op | what-it-does |
|---|---|---|---|---|
| prefetchActiveRooms | 24 | rooms (where cohort, isActive) | R1 | warms active-room list cache |
| getActiveRooms | 46-57 | rooms (where cohort==, isActive==true) | **RT** | live active-room list for a cohort |
| getRoomFlow | 79-84 | rooms/{roomId} | **RT** | live single-room state |
| getRoom | 96-98 | rooms/{roomId} | R1 | fetch one room |
| createRoom | 110,147 | rooms/{roomId} (id via collection().document().id) | W | create room doc |
| createRoom | 148 | users/{ownerId} `currentRoomId` | W | set owner's currentRoomId |
| joinRoom | 159 | users/{userId} `currentRoomId` | W | (join itself via `api.post`; currentRoomId written direct) |
| leaveRoom | 171 | users/{userId} `currentRoomId`=null | W | (leave via `api.post`; clear direct) |
| acceptInvite | 318 | users/{userId} `currentRoomId` | W | (accept via `api.post`; currentRoomId direct) |
| findActiveRoomByOwner | 334 | rooms (where ownerId) | R1 | find owner's active room |
| leaveAllRooms | 367,383 | rooms (query) + users/{userId} `currentRoomId`=null | R1+W | enumerate + clear (per-room leave via api) |
| closeAllRoomsByOwner | 396 | rooms (query) | R1 | enumerate owner rooms (close via api) |

### 3.2 `data/repository/UserRepositoryImpl.kt` — Firestore (21 call-sites)
| Method | line | path | op | what-it-does |
|---|---|---|---|---|
| emitUserUpdate (private) | 34-36 | users/{userId} | R1 | re-emit user after a mutation |
| getUser | 111-113 | users/{userId} | R1 | fetch user profile |
| userExists | 118-120 | users/{userId} | R1 | existence check |
| getBlockedUserIds | 125-127 | users/{userId} | R1 | read block list |
| getUsers | 134-141 | users (batched whereIn) | R1 | bulk profile fetch |
| getStalkers | 159-164 | users/{profileUserId}/stalkers (orderBy lastVisitedAt) | R1 | profile-visitor list |
| getAliases | 174-176 | users/{userId} | R1 | read alias map |
| observeUserFlags | 183-188 | users/{userId} | **RT** | live ban/mute/warning flags |
| getWarningReason | 203-205 | users/{userId} | R1 | read warning reason |
| observeUsers | 211-219 | users/{userId} (per id) | **RT** | live profiles for a set |
| updateDisplayName | 236 | users/{userId} `displayName` | W | rename |
| updateAvatar | 245 | users/{userId} `avatarUrl` | W | change avatar |
| updateLastSeen | 251 | users/{userId} `lastSeenAt` | W | presence timestamp |
| updateProfile | 259 | users/{userId} (fields) | W | edit profile fields |
| blockUser | 272 | users/{userId} `blockedUserIds` arrayUnion | W | block |
| unblockUser | 283 | users/{userId} `blockedUserIds` arrayRemove | W | unblock |
| checkBlockedBy | 287-299 | users (query) | R1 | reverse-block check |
| markStalkersViewed | 356 | users/{userId} | W | clear stalker badge |
| setAlias | 372 | users/{userId} `aliases.{id}` | W | set alias |
| removeAlias | 383 | users/{userId} `aliases.{id}` delete | W | remove alias |

### 3.3 `data/repository/PrivateMessageRepositoryImpl.kt` — Firestore (40 call-sites) — LARGEST
| Method | line | path | op | what-it-does |
|---|---|---|---|---|
| prefetchConversations | 35 | conversations (whereArrayContains participantIds) | R1 | warm conversation list |
| getConversations | 65-79 | conversations (where participant) | **RT** | live conversation list |
| getOrCreateConversation | 104,128 | conversations/{id} | R1+W | fetch or create 1:1 convo |
| getConversationSettings | 138 | conversations/{id}/userSettings/{userId} | R1 | read per-user settings |
| observeConversationSettings | 144-152 | .../userSettings/{userId} | **RT** | live per-user settings |
| getMessages | 167-177 | conversations/{id}/messages (orderBy, limit) | **RT** | live message stream |
| loadOlderMessages | 194-202 | conversations/{id}/messages (paginated) | R1 | history pagination |
| editMessage | 310-325 | .../messages/{mid} (+ edits/ batch) | R1+W | edit + append edit history |
| getEditHistory | 337-344 | .../messages/{mid}/edits | R1 | read edit history |
| markAsRead | 354-362 | .../userSettings/{userId} set(merge) | W | read receipts |
| resetUnreadCount | 372-379 | .../userSettings set(merge) | W | clear unread |
| muteConversation | 383-391 | .../userSettings set(merge) | W | mute |
| pinConversation | 395-403 | .../userSettings set(merge) | W | pin |
| hideConversation | 407-414 | .../userSettings set(merge) | W | hide |
| toggleReaction | 423-452 | .../messages/{mid} (transaction) `reactions` | W | emoji reaction |
| createGroupConversation | 489-536 | conversations/ + userSettings (batch) + participantIds | W | create group |
| addGroupParticipant | 543-550 | conversations/{id} `participantIds` arrayUnion | W | add member |
| removeGroupParticipant | 554-561 | conversations/{id} `participantIds` arrayRemove | W | remove member |
| updateGroupName | 565-572 | conversations/{id} `groupName` | W | rename group |
| getModerationConfig | 576-578 | config/moderation | R1 | read banned-words config |
| getConversation | 584-586 | conversations/{id} | R1 | fetch one convo |
| closeGroupConversation | 591-595 | conversations/{id} `isClosed` | W | close group |
| recallMessage | 599-606 | .../messages/{mid} | W | recall message |
| muteGroupMember | 612-629 | .../mutes/{userId} set | W | mute member |
| unmuteGroupMember | 633-640 | .../mutes/{userId} | **D** | unmute member |
| getGroupMutes | 644-648 | .../mutes | R1 | list mutes |
| hideMessage | 657-665 | .../messages/{mid} | W | hide message |
| updateGroupRoles | 671-679 | conversations/{id} (admins/mods) | W | role change |
| transferOwnership | 683-690 | conversations/{id} `createdBy` | W | transfer owner |
| updateGroupPermissions | 696-703 | conversations/{id} `permissions` | W | permissions |
| updateSystemMessageConfig | 707-714 | conversations/{id} | W | system-msg config |
| updateModNotifyMode | 718-725 | conversations/{id} | W | mod-notify mode |
| updateGroupDescription | 731-738 | conversations/{id} | W | description |
| updateGroupPhoto | 742-749 | conversations/{id} | W | group photo url |
| searchUsers | 755-762 | users (query) | R1 | user search for invites |
| getOwnedGroupCount | 776-780 | conversations (query) | R1 | count owned groups |

### 3.4 `data/repository/EconomyRepositoryImpl.kt` — Firestore (7 call-sites)
| Method | line | path | op | what-it-does |
|---|---|---|---|---|
| observeBalance | 29-39 | users/{uid} (balance) | **RT** | live coin/bean balance |
| observeEconomyConfig | 48-69 | config/economy | **RT** | live economy config |
| getCoinPackages | 201-203 | coinPackages | R1 | store packages |
| getRecentTransactions | 211-217 | users/{uid}/transactions (orderBy, limit) | R1 | recent ledger |
| getAllTransactions | 227-238 | users/{uid}/transactions (orderBy) | R1 | full ledger |

### 3.5 `data/repository/GiftRepositoryImpl.kt` — Firestore (12 call-sites)
| Method | line | path | op | what-it-does |
|---|---|---|---|---|
| observeGiftCatalog | 21-27 | gifts (where) | **RT** | live purchasable catalog |
| observeAllGifts | 41-46 | gifts | **RT** | live full catalog |
| observeBackpack | 60-65 | users/{userId}/backpack | **RT** | live owned gifts |
| observeGiftWall | 78-83 | users/{userId}/giftWall | **RT** | live gift wall |
| observeBroadcasts | 96-103 | broadcasts (orderBy) | **RT** | live gift broadcasts |
| getGiftWallSenders | 116-120 | users/{userId}/giftWall/{giftId} | R1 | senders for a gift |
| getGiftRanking | 133-134 | giftRankings/{giftId} | R1 | gift leaderboard |

### 3.6 `data/repository/MessageRepositoryImpl.kt` — Firestore, room chat (4 call-sites)
| Method | line | path | op | what-it-does |
|---|---|---|---|---|
| getMessages | 18-25 | rooms/{roomId}/messages (orderBy, limit) | **RT** | live room chat stream |
| createAndSendMessage (private) | 47-51 | rooms/{roomId}/messages/{msgId} set | W | send room message |
| editMessage | 83-91 | rooms/{roomId}/messages/{mid} | W | edit room message |

### 3.7 `data/repository/SeatRequestRepositoryImpl.kt` — Firestore (8 call-sites)
| Method | line | path | op | what-it-does |
|---|---|---|---|---|
| getPendingRequests | 19-25 | rooms/{roomId}/seatRequests | **RT** | live pending seat requests |
| getRequestsByUser | 38-47 | rooms/{roomId}/seatRequests (where) | **RT** | live my requests |
| approveRequest | 85-93 | .../seatRequests/{id} | W+R1 | approve (update + read-back) |
| denyRequest | 106 | .../seatRequests/{id} | W | deny |
| cancelApprovedRequest | 123 | .../seatRequests/{id} | W | cancel |

*(createRequest → `api.post /api/rooms/{roomId}/seat-requests` — COMPLIANT.)*

### 3.8 `data/repository/DeviceRepositoryImpl.kt` — Firestore (2 call-sites)
| Method | line | path | op | what-it-does |
|---|---|---|---|---|
| getDeviceBinding | 20-22 | deviceBindings/{deviceId} | R1 | read device→user binding |
| bindDevice | 27-34 | deviceBindings/{deviceId} set | W | write device binding |

*(checkBanStatus → `workerApiClient.post /api/device-info` — COMPLIANT.)*

### 3.9 `data/repository/BannerRepositoryImpl.kt` — Firestore (1 call-site)
| Method | line | path | op | what-it-does |
|---|---|---|---|---|
| getActiveBanners | 10-16 | banners (where isActive==true) | R1 | active promo banners |

### 3.10 `data/repository/FunFactRepositoryImpl.kt` — Firestore (1 call-site)
| Method | line | path | op | what-it-does |
|---|---|---|---|---|
| syncFacts | 25-26 | funFacts | R1 | sync fun-fact content |

### 3.11 `data/repository/NotificationRepositoryImpl.kt` — Firestore (1 call-site)
| Method | line | path | op | what-it-does |
|---|---|---|---|---|
| getPmNotificationsEnabled | 57-59 | users/{userId} | R1 | read PM-notify preference |

*(saveFcmToken / removeFcmToken / setPmNotificationsEnabled → `api` — COMPLIANT.)*

### 3.12 `data/remote/RtdbConversationService.kt` — RTDB (7 call-sites) — REAL-TIME
| Method | line | path | op | what-it-does |
|---|---|---|---|---|
| clearTypingRunnable | 41 | conversations/{cid}/typing/{userId} removeValue | D | auto-clear typing |
| connect | 61-62 | .../typing/{userId} setValue + onDisconnect().removeValue | W | mark typing + disconnect cleanup |
| connect | 65-80 | .../typing (all) addValueEventListener | **RT** | live "other is typing" |
| connect | 83-101 | .../events/lastEvent addValueEventListener | **RT** | live convo events |
| disconnect | 113-120 | .../typing/{userId} removeValue + removeEventListener | D | teardown |
| sendTyping | 135-144 | .../typing/{userId} setValue/removeValue | W/D | typing on/off |

### 3.13 `data/remote/RtdbPresenceService.kt` — RTDB (18 call-sites) — REAL-TIME
| Method | line | path | op | what-it-does |
|---|---|---|---|---|
| setPresence | 72-74 | rooms/{roomId}/presence/{userId} setValue + onDisconnect().removeValue | W | mark present + disconnect cleanup |
| setPresence | 81-102 | .info/connected addValueEventListener | **RT** | re-arm presence on reconnect |
| setPresence | 105-117 | rooms/{roomId}/presence addValueEventListener | **RT** | live room roster |
| setPresence | 120-169 | rooms/{roomId}/events/lastEvent addValueEventListener | **RT** | live room events (kick etc.) |
| setPresence | 91-94 | ownerLeft/{roomId} setValue + onDisconnect().setValue | W | owner-left disconnect signal |
| removePresence | 185-195 | rooms/{roomId}/presence/{userId} removeValue + removeListeners | D | leave room |
| isUserPresent | 216 | rooms/{roomId}/presence/{userId} `.get()` | R1 | one-shot presence check |
| armOwnerLeftSignal | 250-253 | ownerLeft/{roomId} cancel/setValue/onDisconnect().setValue | W | arm owner-away signal |
| cancelOwnerLeftSignal | 271-273 | ownerLeft/{roomId} cancel + removeValue | D | disarm signal |

*(notifyOwnerAway L285-305 → `httpClient` POST to the Express API — routes through API, NOT a direct-data violation.)*

### 3.14 `data/repository/RtdbTypingRepository.kt` — RTDB (6 call-sites) — REAL-TIME
| Method | line | path | op | what-it-does |
|---|---|---|---|---|
| setTyping | 39-55 | conversations/{cid}/typing/{userId} setValue + onDisconnect().removeValue + removeValue | W/D | typing indicator write |
| observeTyping | 66-89 | conversations/{cid}/typing/{otherUserId} addValueEventListener + awaitClose removeValue | **RT** | live typing indicator |

---

## 4. VIOLATIONS — iOS (`shared/src/iosMain/**`)

**iOS mirrors Android 1:1** — identical collections, paths, and operations via the `dev.gitlive.firebase` multiplatform SDK (`.snapshots` for real-time, `.updateFields`/`.set`/`.get()` for the rest, `.valueEvents` for RTDB). File/line anchors below; per-method semantics are identical to the Android twin in §3 unless noted.

| File | Firestore call-sites | Mirrors (Android §) |
|---|---|---|
| `data/repository/IosRoomRepositoryImpl.kt` | 13 | §3.1 — getActiveRooms `.snapshots` L57, getRoomFlow L69, getRoom L78, createRoom set L128 + users currentRoomId L129, join/leave/acceptInvite currentRoomId L140/151/307, findActiveRoomByOwner L330, leaveAll/closeAll queries L362/393 + currentRoomId L373 |
| `data/repository/IosUserRepositoryImpl.kt` | 20 | §3.2 — reads L48/69/76/82/99/116/129/138/158; observeUserFlags `.snapshots` L180; observeUsers `.snapshots` L199; writes updateFields L260/269/275/283/305/316/365/414/425 |
| `data/repository/IosPrivateMessageRepositoryImpl.kt` | 41 | §3.3 — getConversations `.snapshots` L83, observeConversationSettings L148, getMessages L166; getOrCreate L103/121; markAsRead/reset/mute/pin/hide sets L353/371/383/395/406; group writes L514/524/533/545/555/565/588/598/606/624/635(**delete**)/660/674/685/697/707/717/729/739; reads L55/135/191/308/333/457/572/580/643/759/783 |
| `data/repository/IosEconomyGiftRepositories.kt` | 12 | §3.4+§3.5 — observeBalance L41, observeEconomyConfig L71, observeGiftCatalog L346, observeAllGifts L362, observeBackpack L378, observeGiftWall L393, observeBroadcasts L410 (`.snapshots`); getCoinPackages L247, getRecent/AllTransactions L267/289, getGiftWallSenders L426, getGiftRanking L440 (`.get()`) |
| `data/repository/IosMessageRepositoryImpl.kt` | 3 | §3.6 — getMessages `.snapshots` L22; createAndSendMessage set L48; editMessage L89 |
| `data/repository/IosSeatRequestRepositoryImpl.kt` | 6 | §3.7 — getPendingRequests `.snapshots` L23, getRequestsByUser L42; approve L82+read L91, deny L105, cancel L121 |
| `data/repository/IosSmallRepositories.kt` | 5 | §3.8–3.11 — `IosDeviceRepositoryImpl` getDeviceBinding L34 + bindDevice set L48; `IosNotificationRepositoryImpl` getPmNotificationsEnabled L124; `IosBannerRepositoryImpl` getActiveBanners L403; `IosFunFactRepositoryImpl` syncFacts L428 |

### 4.1 `data/remote/IosRtdbServices.kt` — RTDB (25 call-sites) — REAL-TIME
Mirrors §3.12–3.14. Contains three impls:
| Class | key lines | path | op |
|---|---|---|---|
| `IosTypingRepositoryImpl` | setTyping L40-47 (`setValue`/`removeValue`); observeTyping `.valueEvents` L64 | conversations/{cid}/typing/{userId,otherUserId} | W/D + **RT** |
| `IosPresenceServiceImpl` | setPresence L135-137 (`setValue`+`onDisconnect().removeValue`); connected `.valueEvents` L163; re-arm presence L175-177; ownerLeft L181-184; observeRoomPresence `.valueEvents` L232; removePresence L217; isUserPresent `.valueEvents.first()` L280; armOwnerLeftSignal L326-329; cancelOwnerLeftSignal L355-357 | rooms/{roomId}/presence, ownerLeft/{roomId} | W/D + **RT** (roster, room events, presence, owner-left) |
| `IosConversationWebSocketServiceImpl` | disconnect typing cleanup L394; sendTyping L410-414 | conversations/{cid}/typing/{userId} | W/D |

---

## 5. VIOLATIONS — Web (`public/**`)

Only **two** web surfaces touch the Firestore data plane; both are internal/account tooling, NOT the marketing site.

### 5.1 `public/portal/portal.js` — user account portal (Firestore compat SDK)
| line | path | op | what-it-does |
|---|---|---|---|
| 173 | `db = firebase.firestore()` | init | **injection point** — creates the client Firestore handle |
| 833 | `db.doc('users/{uniqueId}').onSnapshot(...)` | **RT** | `setupRoleListener` — watches the user doc for `roleChanged`; forces sign-out on live role revocation |

Loaded via `<script .../firebase-firestore-compat.js>` at `public/portal/index.html:527`.

### 5.2 `public/admin/js/**` — moderation/admin console (Firestore modular SDK v11)
| file:line | path | op | what-it-does |
|---|---|---|---|
| `main.js:48` | `clientDb = getFirestore(app)` | init | **injection point** — passes `firestoreFns { collection, query, where, onSnapshot, getDocs, doc, orderBy, limit }` to tabs |
| `tabs/logs.js:667` | collection `logs` | **RT** | live server-log feed (onSnapshot) |
| `tabs/reports.js:343` | collection `reports` | **RT** | live moderation-report queue (onSnapshot; getDocs poll fallback for WebKit) |
| `tabs/spin-monitor.js:376` | collection `gifts` | R1 | spin/gacha config |
| `tabs/spin-monitor.js:470,521` | collection `users` (+ user doc + txn feed) | **RT**/R1 | live spin-economy monitor (onSnapshot + getDocs) |

Loaded via `import ... firebase-firestore.js` at `main.js:16`.

> **Operator ruling needed:** the admin console is a **staff-only moderation tool**. It may warrant a different remediation posture (e.g. an authenticated admin API surface) than the customer app, but under the stated rule it IS a direct client→Firestore violation. Flagged, not assumed exempt.

---

## 6. Firebase AUTH usage — SEPARATE LIST (needs operator ruling: legitimate token-minting vs. data-plane)

Auth (`FirebaseAuth`, `Firebase.auth`, `firebase.auth()`, `dev.gitlive.firebase.auth`) is used across all clients for **sign-in / token minting only**. Per the task, this is flagged as **"AUTH — needs operator ruling"** and is NOT counted in the data-plane violation totals. Token minting for sign-in may be a legitimate exception (the app must obtain a Firebase ID token to authenticate to the Express API — see §7 `WorkerApiClient.auth` / `IosApiClient` `Firebase.auth.currentUser?.getIdToken()`).

| Platform | File | Role |
|---|---|---|
| Android | `MainActivity.kt:40,620` | email-link sign-in detection |
| Android | `core/di/AppKoinModule.kt:89` | `single { FirebaseAuth.getInstance() }` (Auth DI) + emulator L106 |
| Android | `data/repository/AuthRepositoryImpl.kt` | Google/Apple/email-link/custom-token sign-in (whole file) |
| Android | `data/repository/IdentityRepositoryImpl.kt:12` | injects `FirebaseAuth` (uid); mutations via API |
| Android | `data/repository/EconomyRepositoryImpl.kt:25` | injects `FirebaseAuth` (current uid for balance path) |
| Android | `data/repository/StorageRepositoryImpl.kt:29` | injects `FirebaseAuth` (token for signed-URL API calls) |
| Android | `data/remote/WorkerApiClient.kt:27` | **`getIdToken()` → Authorization: Bearer** for every API call (legitimate bridge) |
| Android | `data/remote/RtdbPresenceService.kt:289` | reads token for the notify-owner-away API POST |
| Android | `shared/src/androidMain/.../auth/DevSignInHelper.android.kt:15` | dev email/pw sign-in |
| iOS | `core/di/IosPlatformModule.kt:85`, `KoinHelper.kt` | `single<FirebaseAuth> { Firebase.auth }` + emulator |
| iOS | `data/repository/IosAuthRepositoryImpl.kt` | Google/Apple/email-link/custom-token sign-in (whole file) |
| iOS | `data/repository/IosIdentityRepositoryImpl.kt:15` | injects `FirebaseAuth` (uid); mutations via API |
| iOS | `data/remote/IosApiClient.kt:80` | **`Firebase.auth.currentUser?.getIdToken()` → Bearer** (legitimate bridge) |
| iOS | `shared/src/iosMain/.../auth/DevSignInHelper.ios.kt:15` | dev email/pw sign-in |
| Common | `shared/src/commonMain/.../auth/AuthViewModel.kt`, `AuthRepository.kt`, `SignInScreen.kt`, `SharedNavGraph.kt` | sign-in orchestration (interface + VM) |
| Web | `public/admin/js/main.js:13,47,400` | admin email/pw sign-in |
| Web | `public/portal/portal.js:172,322-392,930` | portal Google/Apple/email sign-in + password reset |
| Web | `public/js/roadmap-auth.js`, `shared-header.js`, `suggestions-board.js`, `preview-watermark.js` | **marketing/roadmap sign-in only** (no data plane) |

---

## 7. DI INJECTION POINTS — the wiring remediation must remove

These are the exact sites that hand a Firestore/RTDB singleton to repositories. Removing them (and the constructor params they satisfy) is what makes the violations un-compilable — the structural "make bad states impossible" lever for the CI ratchet.

| Platform | File:line | Binding |
|---|---|---|
| **Android** | `core/di/AppKoinModule.kt:90` | `single { FirebaseFirestore.getInstance() }` ← injected into 11 repos |
| Android | `core/di/AppKoinModule.kt:105,107` | `Firebase.firestore.useEmulator(...)`, `Firebase.database.useEmulator(...)` (local flavour) |
| Android | *(RTDB has no Koin single)* | `RtdbConversationService.kt:26`, `RtdbPresenceService.kt:36`, `RtdbTypingRepository.kt:27` each self-construct `FirebaseDatabase.getInstance(BuildConfig.RTDB_URL)` — remove these `by lazy` handles |
| **iOS** | `core/di/IosPlatformModule.kt:86` | `single<FirebaseFirestore> { Firebase.firestore }` ← injected into 7 repo files |
| iOS | `core/di/IosPlatformModule.kt:87` | `single<FirebaseDatabase> { Firebase.database }` ← injected into `IosRtdbServices` |
| iOS | `core/di/KoinHelper.kt:100,102` | `Firebase.firestore.useEmulator`, `Firebase.database.useEmulator` |
| iOS | `data/firestore/DocumentSnapshotIosExt.kt` | Firestore `DocumentSnapshot`/`FIRGeoPoint` parsing helper — dead once repos stop returning snapshots |
| **Web** | `public/portal/portal.js:173` | `db = firebase.firestore()` |
| Web | `public/admin/js/main.js:48` | `clientDb = getFirestore(app)` |

**Firebase *data* SDK import signatures a CI ratchet should grep (importer baseline = 26 files):**
- Android: `com.google.firebase.firestore` · `com.google.firebase.database` → 14 files (11 Firestore repos + `AppKoinModule` + 3 RTDB services; note `AppKoinModule` is the injection point).
- iOS: `dev.gitlive.firebase.firestore` · `dev.gitlive.firebase.database` → 11 files (7 Firestore repos + `IosRtdbServices` + `IosPlatformModule` + `KoinHelper` + `DocumentSnapshotIosExt`).
- Web: `getFirestore` · `firebase.firestore(` · `firebase-firestore` → 3 files (`portal.js`, `admin/js/main.js`, `portal/index.html`) + tabs importing `firestoreFns`.
- **EXCLUDE** `*.auth*` imports (that is the §6 Auth list, a separate ruling).

---

## 8. REAL-TIME READS — call out prominently (hardest to remediate)

~50 live listeners cannot become a simple request/response. They need an **architectural decision** (Server-Sent Events, WebSocket, or client polling — all fronted by the Express API). Grouped by data domain (Android + iOS listener counts are equal mirrors):

| Domain | Firestore/RTDB listeners | Files |
|---|---|---|
| **Room chat messages** | rooms/{id}/messages `.snapshots` | Message(Ios)RepositoryImpl (getMessages) |
| **Room list / room state** | rooms (where), rooms/{id} | Room(Ios)RepositoryImpl (getActiveRooms, getRoomFlow) |
| **Room presence + events (RTDB)** | rooms/{id}/presence, .../events/lastEvent, .info/connected | RtdbPresenceService / IosPresenceServiceImpl (3 listeners each) |
| **Seat requests** | rooms/{id}/seatRequests | SeatRequest(Ios)RepositoryImpl (getPendingRequests, getRequestsByUser) |
| **PM conversation list / messages / settings** | conversations (where), .../messages, .../userSettings | PrivateMessage(Ios)RepositoryImpl (3 listeners each) |
| **Typing indicators (RTDB)** | conversations/{id}/typing | RtdbConversationService, RtdbTypingRepository / IosTypingRepositoryImpl, IosConversationWebSocketServiceImpl |
| **Economy balance + config** | users/{uid} balance, config/economy | Economy(Ios) (observeBalance, observeEconomyConfig) |
| **Gifts (catalog/backpack/wall/broadcasts)** | gifts, users/{id}/backpack, users/{id}/giftWall, broadcasts | Gift(Ios) (5 listeners each) |
| **User flags / profiles** | users/{id} | User(Ios) (observeUserFlags, observeUsers) |
| **Web: role revocation** | users/{uniqueId} | portal.js:833 |
| **Web admin: logs / reports / spin monitor** | logs, reports, gifts, users | admin/js/tabs/* |

> Note: the app already runs a foreground `PmSyncService` (Android) that *consumes* these repository flows for notifications — whatever streaming transport replaces Firestore listeners must keep feeding that consumer.

---

## 9. ALREADY-COMPLIANT flows (via the Express API) — do NOT redo

Confirmed routed through `WorkerApiClient` (Android) / `IosApiClient` (iOS) HTTP → Express, or via signed-URL uploads. These repos/operations are DONE:

**Fully compliant repos (100% API, no Firestore/RTDB):**
- **Identity:** `IdentityRepositoryImpl` / `IosIdentityRepositoryImpl` → `/api/users/sign-in`, `/api/users`, `/api/users/{id}/link-provider`.
- **Report:** `ReportRepositoryImpl` / `IosReportRepositoryImpl` → `/api/reports` (create, list, resolve).
- **Translation:** `TranslationRepositoryImpl` / `IosTranslationRepositoryImpl` → `/api/translate`, `/api/translate/quota`.
- **OTP:** `OtpRepositoryImpl` / `IosOtpRepositoryImpl` → `/api/auth/otp/*`.
- **PIN (App-Lock):** `PinRepositoryImpl` / `IosPinRepositoryImpl` → `/api/auth/pin/*`.
- **Biometric:** `BiometricRepositoryImpl` / `IosBiometricRepositoryImpl` → `/api/auth/biometric/*`.
- **Storage uploads:** `StorageRepositoryImpl` / `IosStorageRepositoryImpl` → `/api/storage/*` + signed R2 PUT (no Firebase Storage SDK).
- **Age verification:** `AgeVerificationRepositoryImpl` / `IosAgeVerificationRepositoryImpl` → `/api/age-verification/*` + signed R2 PUT.
- **App config / health / LiveKit token / billing:** `AndroidAppConfigService`, `IosServices` (AppConfig/LiveKit), `LiveKitTokenService`, `LiveKitVoiceService`, `BillingService`, `ShyTalkMessagingService` (FCM) → `/api/config/*`, `/api/health`, LiveKit endpoints.

**Compliant operations inside HYBRID repos (already migrated — leave alone):**
- **Room mutations:** join, leave, takeSeat, leaveSeat, removeFromSeat, moveSeat, kickUser, toggleMute, addHost, removeHost, updateRoomName, setRequireApproval, setOwnerAway/Returned, sendInvite, cancelInvite, acceptInvite (server part), closeRoom, recordFirstJoinTimestamp, removeDisconnectedUser → `/api/rooms/*`. *(Residual direct write: only `users/{id}.currentRoomId` — see §3.1.)*
- **Economy transactions:** claimDailyReward, pullGacha, sendGift(+Direct/Batch), sendEntireBackpack, redeemBeans, purchaseCoins/Subscription, addTestCoins, claim/activateSuperShyTrial → `/api/economy/*`.
- **PM sends:** sendTextMessage, sendImageMessage, sendStickerMessage, sendRoomInviteMessage → `/api/conversations/{id}/messages`.
- **User social/lifecycle:** createOrUpdateUser, generateUniqueId, follow/unfollow/removeFollower, recordProfileVisit, submitSuspensionAppeal, liftExpiredSuspension, checkPmLockOnLogin, acknowledgeWarning, request/cancelAccountDeletion, getAccountDeletionStatus, request/getDataExport(Status) → `/api/users/*`.
- **Seat requests:** createRequest → `/api/rooms/{id}/seat-requests`.
- **Device:** checkBanStatus → `/api/device-info`.
- **Notifications:** saveFcmToken, removeFcmToken, setPmNotificationsEnabled → `/api/notifications/*`.
- **Presence side-channel:** RtdbPresenceService.notifyOwnerAway → API POST (the RTDB writes in the same file are the violation, not this call).

---

## 10. REMEDIATION GROUPING (suggested stories)

Each cluster fixes BOTH platforms (Android + iOS twin) in one story. Ordered by suggested sequencing (compliant-write tails first, real-time streams last since they need an architecture decision). Web is separate.

| Cluster | Scope | Files | Nature | Notes |
|---|---|---|---|---|
| **A — Users: reads + profile/block writes** | getUser/userExists/getBlockedUserIds/getUsers/getStalkers/getAliases/getWarningReason/checkBlockedBy reads; updateDisplayName/Avatar/LastSeen/Profile/blockUser/unblockUser/markStalkersViewed/setAlias/removeAlias writes | User(Ios)RepositoryImpl, Notification getPmNotificationsEnabled | R1 + W | biggest write tail; add `/api/users/*` read + mutation endpoints |
| **B — Rooms: reads + currentRoomId + create** | prefetch/getActiveRooms(RT)/getRoomFlow(RT)/getRoom/findActiveRoomByOwner/leaveAll/closeAll reads; createRoom + all `currentRoomId` writes | Room(Ios)RepositoryImpl | R1 + **RT** + W | `currentRoomId` write should fold into existing `/api/rooms/*` join/leave/accept handlers server-side |
| **C — Private messaging + groups** | getConversations(RT)/getMessages(RT)/settings(RT) + loadOlder/getOrCreate/edit/read-receipts/mute/pin/hide/react + all group admin writes (create/roles/permissions/mutes/close/transfer/recall/hide/name/desc/photo) + moderation/search reads | PrivateMessage(Ios)RepositoryImpl | R1 + **RT** + W + D | largest surface (40/41 call-sites); many group-admin writes need authored `/api/conversations/*` endpoints |
| **D — Room chat messages** | getMessages(RT) + createAndSendMessage + editMessage | Message(Ios)RepositoryImpl | **RT** + W | send/edit likely belong on `/api/rooms/{id}/messages` |
| **E — Seat requests** | getPendingRequests(RT)/getRequestsByUser(RT) + approve/deny/cancel writes | SeatRequest(Ios)RepositoryImpl | **RT** + W | createRequest already API; add approve/deny/cancel + a stream |
| **F — Economy + gifts (reads + streams)** | observeBalance(RT)/observeEconomyConfig(RT)/coinPackages/transactions; gift catalog/backpack/wall/broadcasts streams + ranking/senders reads | Economy(Ios)GiftRepositories, Gift(Ios)RepositoryImpl | R1 + **RT** | transactions already API; this is the read/stream half |
| **G — Device binding** | getDeviceBinding + bindDevice | Device(Ios), IosSmallRepositories | R1 + W | checkBanStatus already API; add `/api/devices/binding` |
| **H — Static content reads** | banners, funFacts | Banner(Ios), FunFact(Ios) | R1 | simplest; pure content GETs — good CI-ratchet pilot |
| **P — Presence + typing (RTDB)** | room presence + room events + owner-left + typing indicators + `.info/connected` | RtdbPresenceService, RtdbConversationService, RtdbTypingRepository / IosRtdbServices | **RT** + W/D + onDisconnect | RTDB `onDisconnect` semantics have NO request/response equivalent — needs the biggest architecture decision (server-managed presence via WebSocket + server-side disconnect detection) |
| **R — Web: portal + admin** | portal role-revocation listener; admin logs/reports/spin-monitor | portal.js, admin/js/tabs/* | **RT** + R1 | separate operator ruling on the staff admin console (§5) |

**Cross-cutting architectural decision (blocks Clusters B/C/D/E/F/P/R real-time rows):** choose the streaming transport that replaces Firestore `.snapshots()` / RTDB listeners — **SSE vs WebSocket vs poll**, fronted by Express. RTDB presence additionally needs a **server-side disconnect story** to replace `onDisconnect()`. Recommend resolving this before scheduling the real-time clusters.

**CI ratchet:** baseline = the **26 importer files** in §7 (or the ~274 call-sites). Ratchet asserts the count only decreases. The durable "make-impossible" end state is removing the §7 DI bindings so no repo can obtain a Firestore/Database handle.

---

## 11. Appendix — reproduction commands

```sh
# Android data-plane importers (Firestore + RTDB)
rg -l -g '!**/build/**' 'com\.google\.firebase\.(firestore|database)' app/src/main shared/src/androidMain
# iOS data-plane importers
rg -l -g '!**/build/**' 'dev\.gitlive\.firebase\.(firestore|database)' shared/src/iosMain
# Common (expect none)
rg -n -g '!**/build/**' 'dev\.gitlive\.firebase\.(firestore|database|storage)|\.snapshots\b' shared/src/commonMain
# Web data-plane (expect only portal + admin)
rg -ln -g '!**/node_modules/**' '(getFirestore|firebase\.firestore\(\)|onSnapshot)' public
# Storage (expect none on clients)
rg -n -g '!**/build/**' '(com\.google\.firebase\.storage|dev\.gitlive\.firebase\.storage|firebase\.storage\(\)|getStorage)' app/src/main shared/src public
```
