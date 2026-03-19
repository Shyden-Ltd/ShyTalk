# Audit Findings — 2026-03-19

Comprehensive audit of the entire ShyTalk project. Items fixed in PR #173 are marked DONE.

## DONE (fixed in PR #173, verified by re-audit)
- [x] Test suite: 23 + 6 weak assertions eliminated (two audit rounds, zero remaining)
- [x] Backend: TEST_API_KEY guard when env undefined
- [x] Backend: stalkers + giftWall added to teardown subcollections
- [x] Backend: suspensionAppealStatus written to user doc on appeal review
- [x] Security: pinHash removed from PIN setup response
- [x] Security: fast-xml-parser CVE-2026-26278 + CVE-2026-33036 resolved
- [x] Backend: 403 test for both PUT /api/config/economy and PUT /api/config/:key
- [x] Backend: stalkers + giftWall subcollections asserted in teardown test
- [x] Backend: suspensionAppealStatus asserted in appeal review tests
- [x] Admin frontend: releaseLock now clears state on failure
- [x] Admin frontend: loadDevices re-fetches ban data on every call
- [x] CLAUDE.md: feature count updated (33 files, 141 scenarios)
- [x] Backend: config PUT 403 test coverage
- [x] CI: iOS || true removed from xcodebuild
- [x] CI: force-cancel workflow uses force-cancel API
- [x] Fixture: teardown logs warnings instead of silent swallow

## HIGH PRIORITY — Separate PRs

### Admin Panel Frontend
- [ ] XSS in biometric key list — `k.deviceId` not escaped in onclick attribute (~line 5976)
- [ ] `escapeHtml()` doesn't escape single quotes — affects device table data attributes
- [ ] Silent lock-release failure in `releaseLock` — stuck locks with no diagnostic
- [ ] Silent gift catalog load failure — empty dropdown with no indication

### Kotlin App
- [ ] Double-submission window on appeal button (no disable between click and isLoading)
- [ ] Ban type check uses `!isDevice` — fragile inverse for network classification
- [ ] `observeUserFlags` doesn't stream `suspensionAppealStatus` — denied UI never live-updates
- [ ] `liftExpiredSuspension` result unchecked — stale isSuspended flag persists on error

### Express API
- [ ] `users.js` appeal endpoint doesn't verify `isSuspended` before accepting appeal
- [ ] Log function signatures wrong in auth.js (`log.error(msg, err)` instead of `log.error(source, msg, ctx)`)
- [ ] Cleanup endpoints truncate at 5000 users with no warning in response
- [ ] Room cleanup capped at 200 with no `hasMore` indicator
- [ ] Orphan storage scan capped at 30 convs — could delete live media
- [ ] SMTP transport created per email instead of pooled

### Data Growth
- [ ] `stalkers` subcollection grows unbounded — no cleanup cron
- [ ] Conversation messages grow unbounded — no trim cron for PMs/groups
- [ ] `giftWall` subcollection grows unbounded
- [ ] `adminAuditLog` grows unbounded

### Dependencies
- [ ] Play Billing Library v7→v8 migration (Google deprecated v7)
- [ ] `fast-xml-parser` CVE-2026-33036 + CVE-2026-26278 (DoS via entity expansion)
- [ ] ktlint plugin 12.3.0→14.2.0 (2 major versions behind)
- [ ] OkHttp 4.12.0→5.3.0 (4.x is EOL)
- [ ] Enable Dependabot alerts

### Android E2E
- [ ] 33 Cucumber feature files are NEVER EXECUTED (no Cucumber runner configured)
- [ ] Missing `I wait for the text {string}` step definition (12 usages)
- [ ] Wrong routes in feature files (`user_profile` vs `profile`)
- [ ] 9 feature files reference non-existent NavGraph routes
- [ ] Hardcoded date `2026-04-01` in ModerationSteps.kt (expires soon)
- [ ] Only FakeAuthRepository has reset() — other fakes leak state between tests
- [ ] ~15 duplicate scenarios across feature files

### Infra/Security
- [ ] Admin panel: hardcoded prod logger endpoint in privacy.html + terms.html
- [ ] Admin panel: missing upper-bound validation on coin/bean adjustments
- [ ] Admin panel: `populateFormFull` overridden 6 times via closure chaining — partial failures skip later wrappers
- [ ] Admin panel: search button acquires 3 listener generations (never properly removed)
- [ ] Admin panel: object URL leak in banner file input
- [ ] No web 404 page
- [ ] `.env.example` missing SMTP variables
- [ ] Suspended users can create rooms via direct Firestore writes (rule gap)
- [ ] N+1 query in device-info ban checking
- [ ] CLAUDE.md: stale feature file count ("21 files, 81 scenarios" → actually 33 files)
