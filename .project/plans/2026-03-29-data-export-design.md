# GDPR Article 20 Data Export — Design Spec

_Date: 2026-03-29 | Status: Ready for implementation_

## Overview

User can request a downloadable ZIP of all their personal data. Server generates it asynchronously, stores temporarily in R2, emails a download link. Rate limited to once per 24 hours.

## API Endpoints

- `POST /api/users/:uniqueId/data-export` — Request export (owner, rate-limited)
- `GET /api/users/:uniqueId/data-export/status` — Poll status (owner)
- `GET /api/users/:uniqueId/data-export/download?token=hmac` — Download ZIP (token-auth)
- `GET /api/admin/data-exports` — List exports (admin)

## ZIP Structure

```
shytalk-data-export-{uniqueId}-{date}.zip
├── README.txt
├── profile.json (PII-sanitised)
├── settings.json
├── identity.json
├── followers.json
├── blocked.json
├── economy/
│   ├── balance.json
│   ├── transactions.json (max 1000)
│   └── backpack.json
├── gifts/gift-wall.json
├── conversations/
│   ├── conversations.json (metadata)
│   └── messages.json (user's messages only)
├── rooms/rooms-owned.json
├── reports/
│   ├── reports-filed.json
│   └── appeals.json
├── devices/device-bindings.json
└── moderation/warnings.json
```

## Key Decisions

- **Server-side proxy download** (not presigned R2 URLs) — simpler, no new dependency
- **HMAC download token** — `uniqueId:expiresAt` signed with `EXPORT_DOWNLOAD_SECRET`
- **48-hour expiry** on R2 ZIPs, cleaned by daily cron
- **Rate limit via Firestore** field `lastDataExportRequestedAt` (survives restarts)
- **Suspended users CAN export** (GDPR right not suspended)
- **Only user's own messages** included from conversations
- **archiver** npm package for ZIP generation

## Files to Create (6)

1. `express-api/src/routes/data-export.js`
2. `express-api/src/utils/data-export-builder.js`
3. `express-api/src/cron/expireDataExports.js`
4. `express-api/tests/routes/data-export.test.js`
5. `express-api/tests/utils/data-export-builder.test.js`
6. `express-api/tests/cron/expireDataExports.test.js`

## Files to Modify (14)

- r2.js (putExportObject), email-templates.js, index.js, cron/index.js, orphanedStorage.js
- auth.js (suspension exemption for export)
- UserRepository.kt, UserRepositoryImpl.kt, AppSettingsViewModel.kt, AppSettingsScreen.kt
- AppSettingsViewModelTest.kt, strings.xml (all locales)
