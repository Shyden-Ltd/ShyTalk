# OSA #17 — journey-coverage matrix (prod-readiness gate)

Generated 2026-05-16 to verify the hard rule: nothing ships to prod until every
OSA behavior has a journey scenario verified green on dev.

Legend: ✅ covered by named scenario · 🟡 implicit/partial · ❌ GAP — must add

## PR → behavior → covering journey scenario

| PR | Behavior shipped | Covering scenario(s) | Status |
|---|---|---|---|
| #661 PR 1 | `User.cohort` field on signup | j01 Scenario 1 (cohort=minor on signup line 34), j02 Scenario 1 | ✅ |
| #661 PR 1 | Sign-in lazy cohort flip (DOB → cohort) | j01 (cohort→adult after verify), j04 (downgrade) | ✅ |
| #661 PR 1 | `pm-lock-check` refuses cross-cohort | j07 cross-cohort PM scenario | ✅ |
| #662 PR 2 | Custom claim `admin` (not `isAdmin`) | j12 Scenario "admin claim uses correct key" (line 108) | ✅ |
| #662 PR 2 | Custom claim `cohort` on token | j04 line 58 ("JWT custom claim cohort equals minor"), j01 line 69 | ✅ |
| #662 PR 2 | Admin route writes claim atomically | j01 (admin-approve → cohort claim flip propagates) | 🟡 implicit |
| #662 PR 2 | `AuthRepository.refreshIdToken` after claim change | j04 (effects observed within 5000ms) | 🟡 implicit |
| #663 PR 3 | Firestore rules: cross-cohort user-doc read denied | j02 Scenario 3 (defence-in-depth), j08 (probing) | 🟡 server-API-only; direct-SDK read deferred to `10-firestore-cohort-rules.spec.ts` |
| #663 PR 3 | `segregationEvents` write-only by server | covered by rules spec | (deferred to integration spec — acceptable) |
| #664 PR 4 | `requireSameCohort` middleware → 404 + audit | j02 (cross-cohort follow 404 + audit), j04, j07, j08 | ✅ |
| #665 PR 5 | `/api/users/discover` cohort filter | j02 Scenario 1 (search 1 result, cohort=minor) | ✅ |
| #665 PR 5 | `/api/users/search` cohort filter | j02 (cross-cohort not visible by name) | ✅ |
| #665 PR 5 | Composite indexes deployed | j07 `j07-bug-discover-missing-index` regression guard | ✅ |
| #666 PR 6 | Follow gated by same-cohort | j02 (same-cohort follow succeeds; cross-cohort 404) | ✅ |
| #666 PR 6 | Migration script removes cross-cohort followingIds | — | ❌ GAP — see Fill-1 |
| #667 PR 7 | Room cohort tag on creation | j09, j10 (minor-cohort room context) | 🟡 implicit (room cohort is created via Background, not asserted) |
| #667 PR 7 | Cross-cohort room join refused | j09 Scenario 2 (minor cannot join adult room line 89) | ✅ |
| #667 PR 7 | LiveKit token carries cohort claim | — | ❌ GAP — see Fill-2 |
| #667 PR 7 | Mixed-room migration closes mixed-cohort rooms | — | ❌ GAP — see Fill-3 |
| #668 PR 8 | New cross-cohort conversation gated | j07 cross-cohort PM scenario | ✅ |
| #668 PR 8 | Existing cross-cohort conversation frozen + banner | — | ❌ GAP — see Fill-4 (uses `age_seg_frozen_conversation_*` strings) |
| #668 PR 8 | Migration script flags pre-OSA cross-cohort convos | — | ❌ GAP — see Fill-3 (bundle with mixed-room migration) |
| #669 PR 9 | Cross-cohort gift refused | j08 line 45-49 (`/api/economy/send-gift` → 404 + balances unchanged) | ✅ |
| #669 PR 9 | Cross-cohort P2P coin transfer refused | — | ❌ GAP — see Fill-5 |
| #670 PR 10 | Leaderboard `/api/economy/leaderboards` cohort filter | j02 line 76-77, j05 line 71, j08 line 59 | ✅ |
| #670 PR 10 | Gift-wall cross-cohort view refused | j04 line 76 (collections drop cross-cohort) | 🟡 implicit |
| #671 PR 11 | FCM dispatcher cohort gate | j08 lines 65-72 (FCM gate + audit) | ✅ |
| #671 PR 11 | Same-cohort FCM still delivers | j05 line 60-66 (Selma gets gift FCM), j07 line 65 (Alice gets Adam FCM) | ✅ |
| #672 PR 12 | Compose `CohortAwareItemFilter` client-side hide | j02 Scenario 3 (stale followingIds hidden) | ✅ |
| #672 PR 12 | iOS parity — same client filter | j02 Scenario 3 (iOS Sim primary persona) + j04 (Android persona, cross-checked iOS) | 🟡 acceptable — iOS parity is verified at the unit level (`AgeSegregationTests.swift`) and journey is platform-agnostic |
| #673 PR 13 | Admin sub-tab — cohort population stats | j12 Scenario "Greta processes daily queue" line 78 ("Blocked cross-cohort attempts (24h)" stat) | ✅ |
| #673 PR 13 | Admin sub-tab rate-limit | — | 🟡 minor edge; covered by `rateLimit.test.js` unit; acceptable to defer |
| #674 PR 14 | 9 `age_seg_*` strings in 20 locales | j04 (Japanese banner line 64), j13 (locales/RTL/CJK) | ✅ |
| #674 PR 14 | privacy.html age-seg section | j03 line 33 (Lena sees section 11 "UK OSA cohorts") | ✅ |
| #674 PR 14 | App Gherkin AgeSegregationSteps E2E | (Android instrumentation, runs separately) | — (out of journey scope) |
| #675 | Dev-smoke pre-creates same-cohort room | (CI smoke test — its own spec) | — (out of journey scope) |

## Gaps to fill before prod

| # | Gap | Target journey | New Scenario tag | Severity |
|---|---|---|---|---|
| Fill-1 | Migration: cross-cohort followingIds removed (PR 6) | j04 or new `j19-osa-migration.feature` | `@regression @blocker` | Blocker |
| Fill-2 | LiveKit token cohort claim (PR 7) | j09 | `@regression` | Major |
| Fill-3 | Mixed-room migration + cross-cohort convo migration (PR 7 + PR 8) | new `j19-osa-migration.feature` | `@regression @blocker` | Blocker |
| Fill-4 | Frozen cross-cohort conversation banner (PR 8) | j08 or new mini-scenario in j04 (post-flip) | `@regression @blocker` | Blocker |
| Fill-5 | Cross-cohort gift send + P2P coin send refused (PR 9) | j08 (extend cross-cohort probe) | `@regression @blocker` | Blocker |

## Verification plan (after gaps filled)

For each scenario in the matrix:
- **Runner-executable** (API + Firestore assertions only) → run `node express-api/scripts/manual-qa-runner.js --target=dev --journey=<j*>` and require finding-count = 0.
- **UI-driven** (Android / iOS / Web Playwright) → execute via the platform driver; record screenshot; ledger entry with `lastVerifiedCommit=HEAD`.
- **@manual** (FCM push, OAuth account picker, voice audio, biometric) → interactive `/manual-qa` interactive-mode sign-off; ledger entry.

Prod deploy is unblocked only when:
1. All ❌ GAPs are converted to ✅
2. All scenarios are verified green on dev
3. Ledger has fresh entries for every @manual scenario at HEAD's commit
