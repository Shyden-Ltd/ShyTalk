# Optimise Summary — ShyTalk

**Date:** 2026-03-09

## Overview

The ShyTalk codebase is in strong shape. This second `/optimise` cycle focused on the Express API and web pages, finding 5 issues — 1 critical syntax error, 2 security gaps, and 2 quality improvements. All were fixed immediately and covered by 19 new regression tests.

## Key Stats

- Audit cycles completed: 2 (zero new issues on verification pass)
- Total issues found & fixed: 8
- Critical security fixes: 2 (FCM token injection, log field injection)
- Pre-existing test failures fixed: 7 (conversations + device-info mocks)
- Tests added: 19
- Duplicate test removed: 1
- All tests passing: Yes (255 Express + 1829 Kotlin = 2084 total)

## Highlights

1. **FCM token type validation** — Objects/arrays could be stored in the `fcmTokens` Firestore array, corrupting FCM delivery. Now enforced as string-only on both save and remove endpoints.

2. **Economy.js duplicate declaration** — `const newCoins` was declared twice in the same scope, causing a `SyntaxError` that prevented the entire module from loading in Jest. The bean-redeem route was affected.

3. **Log entry field validation** — `source` and `message` fields in the log ingestion endpoint now have type checks and length caps, preventing object injection and log bloat from compromised clients.

4. **7 pre-existing test failures fixed** — conversations.test.js (5 failures) and device-info.test.js (2 failures) had incomplete mocks: missing `.set()` on `db.doc()` and IPv6-mapped loopback address bypassing the IPv4 geo regex.

5. **Semantic HTML** — Landing page container changed from `<div>` to `<main>` for accessibility compliance.

## Recommendations

- **Flaky PrivateChatViewModelTest** — `hideConversation calls repo` intermittently fails with `UncaughtExceptionsBeforeTest` when run in the full suite (passes in isolation). This is caused by a coroutine exception leak from a different test class — it's nondeterministic and didn't reproduce this session. Duplicate test was removed; the intermittent issue remains but is rare.
