# Roadmap Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the roadmap page redesign with suggestions board, subscription system, unified cascading identity ban graph, and admin panel additions — making all 1,248 pre-written tests pass.

**Architecture:** Express API routes (Firestore backend) serve suggestions, subscriptions, notifications, and identity graph data. The roadmap page (`public/roadmap.html`) is a single-page dark-themed HTML file consuming these APIs. The admin panel (`public/admin/index.html`) gets new tabs for suggestion moderation, identity graph visualization, and audit log. In-app Kotlin models consume notification data.

**Tech Stack:** Express.js, Firebase Admin SDK, Firestore, FCM, Nodemailer/Postfix, Playwright, Jest, Kotlin/Compose, BDD/Gherkin

---

## File Map

### New Express API Routes (create)
| File | Responsibility |
|------|---------------|
| `express-api/src/routes/suggestions.js` | Public suggestions CRUD: list, get, search, create, edit, withdraw, blocked check, tags |
| `express-api/src/routes/admin-suggestions.js` | Admin moderation: approve/reject/plan/complete/overturn, merge, disputes, link |
| `express-api/src/routes/subscriptions.js` | User subscription preferences, watch list, push token, email unsubscribe |
| `express-api/src/routes/suggestions-notifications.js` | Notification inbox: list, mark read, mark all read |
| `express-api/src/routes/identity-graph.js` | Admin identity graph CRUD, ban check, suspension cascade |
| `express-api/src/routes/admin-audit-log.js` | Admin audit log: list, filter, export CSV |
| `express-api/src/routes/suggestions-maintenance.js` | Maintenance: clear suggestions/subscriptions/notifications/graphs/audit |

### New Express API Utilities (create)
| File | Responsibility |
|------|---------------|
| `express-api/src/utils/suggestion-email-templates.js` | Email templates for suggestion notifications (20 languages) |
| `express-api/src/utils/suggestion-notifications.js` | Notification dispatch helper: creates notifications respecting channel prefs |
| `express-api/src/utils/identity-graph-util.js` | Identity graph binding, cascade logic, multi-account detection |
| `express-api/src/utils/text-sanitiser.js` | HTML stripping, XSS prevention, zero-width char removal |
| `express-api/src/utils/similarity.js` | Title similarity matching for duplicate detection and blocked topics |
| `express-api/src/utils/suggestion-constants.js` | Validation constants (max lengths, valid tags, statuses) |

### New Express API Cron (create)
| File | Responsibility |
|------|---------------|
| `express-api/src/cron/notification-dispatch.js` | Process queued notifications: email via Postfix, push via FCM, system messages |

### Modified Express API Files
| File | Change |
|------|--------|
| `express-api/src/index.js` | Mount new route modules, add rate limiters |
| `express-api/src/middleware/auth.js` | Add identity graph binding on auth, suggestions-only ban check |
| `express-api/src/cron/index.js` | Register notification dispatch cron |
| `express-api/src/utils/data-export-builder.js` | Include suggestions, votes, comments, subscriptions in GDPR export |
| `express-api/src/routes/device-info.js` | Feed device info into identity graph on login |

### Web Frontend (modify/create)
| File | Change |
|------|--------|
| `public/roadmap.html` | Complete rewrite: remove Star Wars, add dark theme, ring chart, suggestions board, subscribe modal |
| `public/js/roadmap-app.js` | Create: Main roadmap page JS (fetch data, render, handle interactions) |
| `public/js/roadmap-translations.js` | Create: Translation strings for roadmap page (20 languages) |
| `public/js/roadmap-auth.js` | Create: Firebase auth for roadmap page (login prompt, session) |
| `public/admin/index.html` | Add Suggestions tab, Identity Graph tab, Audit Log tab, Maintenance additions |

### Firestore Rules
| File | Change |
|------|--------|
| `firestore.rules` | Add rules for suggestions, votes, comments, blockedTopics, disputes, subscriptions, notifications, identityGraphs, adminAuditLog |

### Kotlin (shared)
| File | Change |
|------|--------|
| `shared/src/commonMain/.../model/RoadmapNotification.kt` | Create: Notification model for roadmap/suggestion types |
| `shared/src/commonMain/.../model/SubscriptionPreferences.kt` | Create: Subscription preferences model |

---

## Task Ordering (Dependency-Based Batches)

### Batch 1: Foundation (no dependencies) — Tasks 1-4 parallelisable
### Batch 2: Core Routes (depends on Batch 1) — Tasks 5-8
### Batch 3: Admin and Advanced (depends on Batch 2) — Tasks 9-12
### Batch 4: Frontend (depends on Batch 2) — Tasks 13-15
### Batch 5: Integration (depends on all) — Tasks 16-19

---

### Task 1: Text Sanitiser and Similarity Utils

**Files:**
- Create: `express-api/src/utils/text-sanitiser.js`
- Create: `express-api/src/utils/similarity.js`

- [ ] Create text-sanitiser.js with stripHtml, stripZeroWidth, sanitise, sanitiseTitle
- [ ] Create similarity.js with normalise, similarity (Levenshtein), editDistance
- [ ] Commit: `feat(suggestions): add text sanitiser and similarity utils`

---

### Task 2: Email Templates and Constants

**Files:**
- Create: `express-api/src/utils/suggestion-email-templates.js`
- Create: `express-api/src/utils/suggestion-constants.js`

- [ ] Create suggestion-constants.js (tags, languages, statuses, max lengths, thresholds)
- [ ] Create suggestion-email-templates.js (20-language templates with List-Unsubscribe headers)
- [ ] Commit: `feat(suggestions): add email templates and validation constants`

---

### Task 3: Notification Dispatch Helper

**Files:**
- Create: `express-api/src/utils/suggestion-notifications.js`

- [ ] Create notifySubscribers() — reads channel prefs, queues per-channel notifications
- [ ] Commit: `feat(suggestions): add notification dispatch helper`

---

### Task 4: Identity Graph Utility

**Files:**
- Create: `express-api/src/utils/identity-graph-util.js`

- [ ] Create bindIdentifier(), cascadeSuspension(), detectMultiAccount(), mergeGraphs()
- [ ] Commit: `feat(suggestions): add identity graph utility`

---

### Task 5: Public Suggestions Route

**Files:**
- Create: `express-api/src/routes/suggestions.js`
- Modify: `express-api/src/index.js`
- Tests: `suggestions.test.js` (122 tests)

- [ ] Create suggestions.js with all public endpoints (CRUD, search, blocked, tags)
- [ ] Mount in index.js
- [ ] Run tests, fix until all 122 pass
- [ ] Commit: `feat(suggestions): add public suggestions route`

---

### Task 6: Voting and Comments

**Files:**
- Modify: `express-api/src/routes/suggestions.js`
- Tests: `suggestions-voting.test.js` (41), `suggestions-comments.test.js` (30)

- [ ] Add vote endpoints (POST/DELETE /suggestions/:id/vote) with transactions
- [ ] Add comment endpoints (POST /suggestions/:id/comments)
- [ ] Add creator auto-upvote on creation
- [ ] Run tests, fix until all 71 pass
- [ ] Commit: `feat(suggestions): add voting and comments`

---

### Task 7: Subscriptions Route

**Files:**
- Create: `express-api/src/routes/subscriptions.js`
- Tests: `subscriptions.test.js` (33 tests)

- [ ] Create subscriptions.js with all endpoints
- [ ] Mount in index.js
- [ ] Run tests, fix until all 33 pass
- [ ] Commit: `feat(suggestions): add subscriptions route`

---

### Task 8: Notifications Inbox Route

**Files:**
- Create: `express-api/src/routes/suggestions-notifications.js`
- Tests: `suggestions-notifications.test.js` (36 tests)

- [ ] Create suggestions-notifications.js (inbox, mark read)
- [ ] Mount in index.js
- [ ] Run tests, fix until all 36 pass
- [ ] Commit: `feat(suggestions): add notifications inbox route`

---

### Task 9: Admin Suggestions Route

**Files:**
- Create: `express-api/src/routes/admin-suggestions.js`
- Tests: `suggestions-lifecycle.test.js` (50), `suggestions-duplicates.test.js` (35)

- [ ] Create admin-suggestions.js (moderation, merge, disputes, status changes)
- [ ] Mount in index.js
- [ ] Run tests, fix until all 85 pass
- [ ] Commit: `feat(suggestions): add admin suggestions route`

---

### Task 10: Identity Graph Route

**Files:**
- Create: `express-api/src/routes/identity-graph.js`
- Tests: `identity-graph.test.js` (50 tests)

- [ ] Create identity-graph.js (graph CRUD, ban check, cascade)
- [ ] Mount in index.js
- [ ] Run tests, fix until all 50 pass
- [ ] Commit: `feat(suggestions): add identity graph route`

---

### Task 11: Admin Audit Log and Maintenance

**Files:**
- Create: `express-api/src/routes/admin-audit-log.js`
- Create: `express-api/src/routes/suggestions-maintenance.js`
- Tests: `admin-audit-log-suggestions.test.js` (42 tests)

- [ ] Create both route files
- [ ] Mount in index.js
- [ ] Run tests, fix until all 42 pass
- [ ] Commit: `feat(suggestions): add audit log and maintenance routes`

---

### Task 12: Notification Dispatch Cron

**Files:**
- Create: `express-api/src/cron/notification-dispatch.js`
- Modify: `express-api/src/cron/index.js`
- Tests: `notification-dispatch.test.js` (26 tests)

- [ ] Create notification-dispatch.js cron job
- [ ] Register in cron/index.js
- [ ] Run tests, fix until all 26 pass
- [ ] Commit: `feat(suggestions): add notification dispatch cron`

---

### Task 13: Roadmap Page Rewrite

**Files:**
- Modify: `public/roadmap.html`
- Create: `public/js/roadmap-app.js`
- Create: `public/js/roadmap-translations.js`
- Create: `public/js/roadmap-auth.js`
- Tests: `roadmap-redesign.spec.ts` (44 tests)

- [ ] Rewrite roadmap.html (remove Star Wars, dark theme, ring chart, sticky nav)
- [ ] Create roadmap-app.js (data fetch, rendering, interactions)
- [ ] Create roadmap-translations.js (20 languages)
- [ ] Create roadmap-auth.js (Firebase auth)
- [ ] Delete Star Wars MP3 references
- [ ] Run Playwright tests, fix until all 44 pass
- [ ] Commit: `feat(roadmap): redesign roadmap page`

---

### Task 14: Suggestions Board UI

**Files:**
- Modify: `public/js/roadmap-app.js`
- Tests: `suggestions-board.spec.ts` (137), `suggestions-subscribe.spec.ts` (36), `suggestions-security.spec.ts` (31)

- [ ] Add suggestions list, cards, sort, filter, search, pagination
- [ ] Add submission form with duplicate detection
- [ ] Add voting UI
- [ ] Add subscribe modal
- [ ] Add login prompts
- [ ] Run all Playwright tests, fix until all 204 pass
- [ ] Commit: `feat(roadmap): add suggestions board UI`

---

### Task 15: Admin Panel Additions

**Files:**
- Modify: `public/admin/index.html`
- Tests: `admin-suggestions.spec.ts` (93 tests)

- [ ] Add Suggestions moderation tab
- [ ] Add Identity Graph visualization
- [ ] Add Audit Log tab
- [ ] Add Maintenance operations
- [ ] Run admin Playwright tests, fix until all 93 pass
- [ ] Commit: `feat(admin): add suggestions moderation and identity graph`

---

### Task 16: Firestore Security Rules

**Files:**
- Modify: `firestore.rules`
- Tests: `suggestions-rules.test.js` (40 tests)

- [ ] Add rules for all new collections
- [ ] Run rules tests
- [ ] Deploy to dev: `npx firebase deploy --only firestore:rules`
- [ ] Commit: `feat(firestore): add security rules for suggestions`

---

### Task 17: Kotlin Models

**Files:**
- Create: `shared/src/commonMain/.../model/RoadmapNotification.kt`
- Create: `shared/src/commonMain/.../model/SubscriptionPreferences.kt`
- Tests: `RoadmapNotificationTest.kt` (45 tests)

- [ ] Create RoadmapNotification data class with fromMap()
- [ ] Create SubscriptionPreferences data class
- [ ] Run Kotlin tests: `./gradlew :shared:jvmTest --tests "*RoadmapNotification*"`
- [ ] Commit: `feat(kotlin): add roadmap notification models`

---

### Task 18: Integration Wiring

**Files:**
- Modify: `express-api/src/index.js` (mount all routes)
- Modify: `express-api/src/middleware/auth.js` (identity binding)
- Modify: `express-api/src/utils/data-export-builder.js` (GDPR)
- Tests: `suggestions-integration.test.js` (87), `suggestions-contracts.test.js` (181)

- [ ] Wire all routes in index.js with rate limiters
- [ ] Add identity binding to auth middleware
- [ ] Extend GDPR data export
- [ ] Run integration and contracts tests
- [ ] Run full Express suite: `cd express-api && npm test`
- [ ] Commit: `feat(suggestions): wire integration and GDPR export`

---

### Task 19: Full Test Suite Pass

- [ ] Run ktlint: `ktlint --relative`
- [ ] Run Express: `cd express-api && npm test`
- [ ] Run Kotlin: `./gradlew testDevDebugUnitTest :shared:jvmTest detekt`
- [ ] Fix any remaining failures
- [ ] Commit: `chore: fix remaining test failures`

---

## Test Coverage Summary

| Framework | Tests | Status |
|-----------|-------|--------|
| Express API (Jest) | 839 | Written, awaiting implementation |
| Playwright (Web) | 341 | Written, awaiting implementation |
| Kotlin (JVM) | 45 | Written, awaiting implementation |
| E2E BDD/Gherkin | 23 | Written, awaiting implementation |
| **Total** | **1,248** | **All pre-written** |
