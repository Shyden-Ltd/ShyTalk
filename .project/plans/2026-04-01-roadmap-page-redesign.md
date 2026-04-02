# Roadmap Page Redesign — Design Spec

**Date:** 2026-04-01
**Status:** Draft
**Scope:** Remove Star Wars theme, add suggestions board, subscription system, notifications, unified cascading identity ban system

---

## 1. Overview

Redesign the roadmap page (`public/roadmap.html`) from the current Star Wars-themed static page to a clean ShyTalk dark-themed interactive platform. Three major additions:

1. **Subscription system** — users subscribe to roadmap features and suggestions, receiving notifications via email, browser push, in-app, and system messages with per-event channel control
2. **Public suggestions board** — public browsing, ShyTalk login required for interaction, moderated submissions, upvote/downvote, duplicate detection, admin lifecycle management
3. **Unified cascading identity ban system** — single identity graph linking accounts, devices, and networks across app and web. Suspensions cascade to all linked identifiers. Multi-account detection triggers automatic suspension.

### Constraints

- $0 hosting — no paid services
- All user-facing text translated into 20 languages (19 translations + English default)
- Mobile-first responsive design
- Anti-abuse: ShyTalk login required + cascading identity ban graph (network + device + account linked at every login)
- GDPR compliant (email collection for subscriptions requires consent)
- Tests written BEFORE implementation across ALL frameworks, 100% coverage, no edge case untested

---

## 2. Page Layout

**Style:** Single-scroll page with sticky nav, ShyTalk dark theme (`--bg: #0f1117`, `--surface: #1a1d27`, etc.)

**Structure:**
- Header: ShyTalk logo + "Subscribe" button
- Stats: Ring/donut chart showing overall % completion + legend (Done / In Progress / Planned counts)
- Sticky nav: Roadmap | Suggestions (anchor links — single scroll)
- Roadmap section: Per-phase progress bars (e.g. "4/5") with compact feature lists, status icons (✓ Done, ◉ In Progress, ○ Planned), per-feature 🔔 bell
- Suggestions section: Public suggestions board
- Footer: Shyden Ltd branding + disclaimer

**No Star Wars elements:** Remove intro screen, logo screen, crawl animation, star field canvas, music button, Star Wars MP3s. Delete MP3 files from repo and R2.

---

## 3. Suggestions Board

### 3.1 Public View (No Login Required)

- Info banner explaining moderation process: "All suggestions are reviewed before publishing — please don't re-submit while yours is pending. Please search for existing suggestions before submitting a new one — duplicates will be merged and your effort could be wasted."
- Sort: Most Voted (default) | Newest
- Filter: by phase category, by topic tag, by language, by status (Accepted/Planned/Completed/Rejected)
- Search: text search across suggestion titles and descriptions
- Suggestion cards: upvote/downvote arrows, net vote score (upvotes minus downvotes; separate up/down counts visible to admins only), title, description, tags, language tag, relative timestamp
- Status badges on cards: Accepted, Planned, Completed, Rejected
- Rejected suggestions show admin-written decline reason (if provided)
- Completed suggestions show "Shipped!" badge
- Pagination
- All visible without login; login prompt shown when attempting to interact (vote, suggest, comment)

### 3.2 Suggestion Lifecycle

| State | Edit | Withdraw | Vote | Comment | Subscribe | Re-suggest Topic |
|-------|------|----------|------|---------|-----------|-----------------|
| Pending | Yes (triggers re-review, user informed) | Yes | No (not public) | No | No | N/A |
| Accepted | No | No | Yes (up/down, 1 per user) | Yes (anon public or private) | Yes | N/A |
| Planned | No | No | No (locked) | Read-only | Yes | N/A |
| Completed | No | No | No | Read-only | No (final notify sent) | N/A |
| Rejected | No | No | No | No | No | Blocked permanently |

- Admin can move a suggestion to any status except back to Pending. Once an admin decision has been made, it cannot revert to pending. Valid admin transitions: accepted→rejected, accepted→planned, planned→accepted, planned→completed, completed→planned, rejected→accepted. Admin chooses target status directly.
- A user who submitted can see their own pending submission and its status
- Voters can optionally explain their vote (public anonymous or private admin-only, voter chooses)
- Users auto-subscribed to their own suggestions (can opt out)

### 3.3 Submission Flow

1. User clicks "+ Suggest"
2. If not logged in → prompt to log in (ShyTalk account required)
3. Form: title (required, max 80 chars), description (required, max 5000 chars), tags (optional, pick from list of phase categories + topic tags)
4. Language tag: auto-detected from user's language preference, with manual override dropdown
5. Opt-in checkbox: "I'm happy for an admin to reach out and discuss this with me in the app"
6. **Duplicate detection:** as user types the title, search existing suggestions (pending, accepted, planned, completed) for similar matches. Show top 3 results with "Load more" pagination (3 at a time until exhausted):
   - **Option 1:** "Yes, this is what I meant" → stop writing, redirect to upvote the existing suggestion (normal upvote flow)
   - **Option 2:** "No, my idea is different" → continue writing the suggestion
7. **Blocked topic check:** search `blockedTopics` collection for similar rejected topics. If match found, show user: 'This topic was previously considered and declined: [reason]' with a link to the rejected suggestion. User cannot proceed with this topic.
8. Submit → toast: "Your suggestion has been submitted for review. You'll be notified when it's published. Please don't re-submit."
9. Confirmation: push notification + system message sent to user's in-app inbox confirming receipt
10. Suggestion enters moderation queue in admin panel
11. Full network information + device fingerprint collected and linked to ShyTalk account (same data as in-app device tracking)

### 3.4 Voting

- Creator's suggestion is automatically upvoted server-side during creation (not via the vote endpoint). This upvote cannot be changed or removed by the creator.
- One upvote OR downvote per user per suggestion (toggle)
- Must be logged in to vote (ShyTalk account)
- Optional vote reason: text field, user chooses public (anonymous) or private (admin-only)

### 3.5 Duplicate Handling by Admin

- Admin can flag a suggestion as duplicate of an existing one
- The duplicate is removed from public view
- The submitter's intent is transferred as an upvote on the original suggestion
- Any users watching the duplicate are automatically transferred to watch the original suggestion
- Submitter is notified: "Your suggestion was merged with an existing one — [link to original]"
- Submitter can dispute: "This is not a duplicate" → suggestion re-enters moderation queue, admin is informed the user disputes the merge
- The suggestion's status remains as merged (not visible to public). The `disputePending: true` flag signals the admin to review it. If the dispute is resolved as merge_reversed, the suggestion status is set back to 'pending'.
- If admin confirms merge after dispute → final, no further appeals

---

## 4. Subscription System

### 4.1 Channels

- **Email** — via self-hosted Postfix on Oracle Cloud
- **Browser push** — via Firebase Cloud Messaging (FCM) web push
- **In-app** — notification bell in ShyTalk Android/iOS app
- **System message** — message sent to user's in-app inbox (conversation with SHYTALK_SYSTEM)

### 4.2 Subscription Scope

- **All roadmap updates** — notified on any feature status change
- **Per-feature** — subscribe to specific features via 🔔 bell icon
- **Per-suggestion** — subscribe to specific suggestions (auto-subscribed to own)

### 4.3 Subscribe Modal

Triggered by header "Subscribe" button or per-feature 🔔 bell.

- If not logged in → prompt to log in with ShyTalk account
- Shows logged-in user info
- Per-event channel control: for each event type, user picks which channels (all, some, or none)
- Scope: "All roadmap updates" or "Only features I select"
- List of currently watched features/suggestions with remove buttons
- GDPR consent checkbox: required before enabling email notifications. Consent timestamp stored.
- "Save Preferences" button

### 4.4 Notification Events & Per-Channel Control

Users can independently enable/disable each channel (email, push, in-app, system message) for each event type:

| Event | Default Channels | Recipients |
|---|---|---|
| Roadmap feature status change | In-App | Subscribers of that feature + "all updates" subscribers |
| Suggestion accepted | In-App + System Message | Submitter + suggestion subscribers |
| Suggestion planned | In-App | All suggestion subscribers |
| Suggestion completed | In-App + System Message | All subscribers (final notification, subscription cleared) |
| Suggestion rejected | In-App + System Message | Submitter only |
| Suggestion merged (duplicate) | In-App + System Message | Submitter only |
| Comment on suggestion | In-App | Suggestion subscribers |

Defaults are in-app only — users can override any combination per event (all, some, or none for each channel).

On completion: only the suggestion ID is removed from `watchedSuggestions`; the user's subscription document, channel preferences, and push tokens are preserved.

### 4.5 Notification Content

All notification text translated into 20 languages (19 translations + English default). Translation system follows the same pattern as all other web pages (`data-i18n` attributes + shared translation JS files).

**Email template:** ShyTalk branded header, feature card with status badge, CTA "View Roadmap" button, unsubscribe + manage preferences links, Shyden Ltd footer.

**Browser push:** ShyTalk icon, title (e.g. "Roadmap Update"), body (e.g. "iOS App → In Progress"), click opens roadmap page.

**In-App:** Bell icon with unread count badge, dropdown with notification items showing: icon, title, description, relative timestamp, source label (Roadmap/Suggestions), unread dot.

### 4.6 Unsubscribe

- Every email has one-click unsubscribe link (GDPR requirement, RFC 8058)
- In-app notification settings to manage preferences
- Browser push revocable from browser settings
- Manage preferences page linked from all emails

---

## 5. Anti-Abuse System

### 5.1 Authentication & Identity Binding

- ShyTalk login required to: submit suggestions, vote, comment, subscribe
- Browsing suggestions and the roadmap is fully public (no login)
- No CAPTCHA or rate limiting needed — ShyTalk account is the gate
- **On every login (app or web, anywhere):** collect and bind to the user's ShyTalk account:
  - Full network information (IP, ISP, country, ASN — same data as in-app device tracking)
  - Device fingerprint (browser fingerprint hash on web, device ID on app)
  - This binding happens at EVERY login, not just suggestion interactions
  - All identifiers are permanently linked to the account in the identity graph

### 5.2 Unified Cascading Identity Ban Graph

A single identity graph system used for ALL bans and suspensions — app, web, suggestions, everything. When a user is suspended anywhere, ALL linked identifiers are suspended at the same level.

**Identifiers linked (bound at every login):**
- IP address + full network info (ISP, country, ASN)
- Device fingerprint (browser fingerprint hash on web, device ID on app)
- ShyTalk account (uniqueId)

**Cascade logic:**
1. Admin suspends user A (e.g. 7-day suspension)
2. ALL devices and networks ever linked to user A receive the same 7-day suspension
3. If a suspended device/network appears with a NEW identifier → that identifier is auto-suspended and added to the graph
4. **Multi-account detection:** if a device is linked to multiple ShyTalk accounts, ALL linked accounts are automatically suspended with reason 'Multiple accounts detected on same device'. No admin review step — immediate enforcement.
5. Graph expansion is logged in the admin audit log

**Suspension levels cascade exactly:** if the account has a 7-day suspension, all linked identifiers get a 7-day suspension. If it's a permanent ban, all get permanent bans. If it's a feature-specific restriction (e.g. suggestions-only ban), all get that same restriction.

**Full suspension:** user cannot access the website, API, or any services except to contact support (contact us page is future work — until then, fully locked out).

**Integration:** Replaces and unifies the existing per-system ban logic (Users → Moderation → Bans & Restrictions, Devices tab). Single identity graph, single admin UI, applies everywhere.

### 5.3 Admin Audit Log

All admin actions are recorded in an audit log:
- Suggestion moderation actions (approve, reject, merge, overturn, complete)
- Ban/suspension actions (create, modify, remove, cascade events)
- Identity graph changes (new identifiers linked, auto-cascade triggers)
- Dispute resolutions

Each entry records: admin UID, action type, target, timestamp, details.

### 5.4 Future Work

- **VPN detection and blocking (IMMEDIATE NEXT — must be done right after this feature)** — without VPN detection, the cascading ban system risks banning innocent users who share a VPN exit node with a banned user. This is a critical dependency.
- **Go-live note:** IP-based cascade banning should be limited to exact IP matches only (not network/ASN-level) until VPN detection is implemented. This minimises false positives from shared IPs while still providing basic protection.
- Contact support page for suspended users

---

## 6. Admin Panel

### 6.1 Suggestions Moderation Tab

- Queue of pending suggestions with approve/reject/merge-as-duplicate actions
- Reject: reason is optional but encouraged. Admin informed: "This reason will be shown publicly on the suggestion."
- Approve moves to "Accepted" state
- **Duplicate detection for admins:** highlight potential duplicates, one-click merge with existing suggestion (transfers upvote, notifies submitter with appeal option)
- Bulk actions for multiple suggestions
- Link accepted suggestion to roadmap item → moves to "Planned"
- Mark as "Completed" when shipped
- Change status to any state except Pending (admin decisions are final, never revert to pending)
- View suggestion history (status changes, votes over time)
- View submitter's identity graph (linked accounts, devices, networks)
- Dispute queue: suggestions where submitter disputes a duplicate merge
- Unblock rejected topic: admin can lift the permanent block, allowing the topic to be re-suggested

### 6.2 Unified Ban Management

Replaces existing per-system ban UI with unified identity graph management:

- View full identity graph for any user (all linked accounts, devices, networks)
- Suspend/unsuspend from any context (user profile, suggestion, device)
- Suspension level picker: duration (1d/3d/7d/30d/permanent), scope (full/suggestions-only)
- Cascading suspension preview: "This will also affect: 2 devices, 3 networks, 1 other account"
- Multi-account detection alerts
- Full audit log of all admin actions with filters

### 6.3 Maintenance Tab Additions

Add to the existing Maintenance tab:
- **Clear all suggestions** — delete all suggestions, votes, comments (dev/testing use)
- **Clear all subscriptions** — remove all subscription preferences and push tokens
- **Clear all notifications** — delete all notification inbox entries
- **Clear identity graphs** — reset all identity bindings (dev/testing use, dangerous)
- **Clear admin audit log** — delete all audit log entries

Each action follows the existing Maintenance tab pattern: description, confirmation, progress indicator.

### 6.4 Admin Audit Log Tab

Searchable, filterable log of all admin actions across the platform:
- Filter by: admin user, action type, target user, date range
- Exportable (CSV)

---

## 7. Data Model (Firestore)

### Collections

**`suggestions`** — public suggestions
```
{
  id: string,
  title: string,
  description: string,
  tags: string[],
  language: string,
  status: "pending" | "accepted" | "planned" | "completed" | "rejected",
  rejectReason: string | null,
  linkedRoadmapFeature: string | null,
  mergedIntoSuggestionId: string | null,
  disputePending: boolean,
  submitterUid: string,
  submitterContactOptIn: boolean,
  upvotes: number,
  downvotes: number,
  createdAt: timestamp,
  updatedAt: timestamp,
  reviewedAt: timestamp | null,
  reviewedBy: string | null,
  completedAt: timestamp | null,
  editHistory: [{ title: string, description: string, editedAt: timestamp }]
}
```

**`suggestions/{id}/votes`** — one doc per voter
```
{
  voterId: string (uniqueId),
  isCreatorVote: boolean,
  vote: "up" | "down",
  reason: string | null,
  reasonVisibility: "public" | "private",
  votedAt: timestamp
}
```

**`suggestions/{id}/comments`** — discussion on accepted suggestions
```
{
  authorUid: string,
  text: string,
  isPublic: boolean,
  createdAt: timestamp
}
```

**`blockedTopics`** — rejected suggestion topics that cannot be re-suggested
```
{
  originalSuggestionId: string,
  title: string,
  rejectReason: string | null,
  blockedAt: timestamp,
  blockedBy: string
}
```

**`suggestionDisputes`** — user disputes of duplicate merges
```
{
  suggestionId: string,
  mergedIntoId: string,
  disputerUid: string,
  status: "pending" | "merge_confirmed" | "merge_reversed",
  createdAt: timestamp,
  resolvedAt: timestamp | null,
  resolvedBy: string | null
}
```

**`subscriptions`** — user notification preferences
```
{
  uid: string,
  channelPreferences: {
    roadmapUpdate: { email: boolean, push: boolean, inApp: boolean, systemMessage: boolean },
    suggestionAccepted: { email: boolean, push: boolean, inApp: boolean, systemMessage: boolean },
    suggestionPlanned: { email: boolean, push: boolean, inApp: boolean, systemMessage: boolean },
    suggestionCompleted: { email: boolean, push: boolean, inApp: boolean, systemMessage: boolean },
    suggestionRejected: { email: boolean, push: boolean, inApp: boolean, systemMessage: boolean },
    suggestionMerged: { email: boolean, push: boolean, inApp: boolean, systemMessage: boolean },
    commentOnSuggestion: { email: boolean, push: boolean, inApp: boolean, systemMessage: boolean }
  },
  scope: "all" | "selected",
  watchedFeatures: string[],
  watchedSuggestions: string[],
  language: string,
  pushToken: string | null,
  email: string | null,
  emailConsentAt: timestamp | null,
  createdAt: timestamp,
  updatedAt: timestamp
}
```

**`notifications`** — in-app notification inbox
```
{
  uid: string,
  type: "roadmap_update" | "suggestion_accepted" | "suggestion_planned" | "suggestion_completed" | "suggestion_rejected" | "suggestion_merged" | "comment",
  title: string,
  body: string,
  relatedId: string,
  isRead: boolean,
  createdAt: timestamp
}
```

**`identityGraphs`** — unified identity graph (links accounts, devices, networks)
```
{
  graphId: string,
  identifiers: [
    { type: "ip" | "fingerprint" | "uid" | "network", value: string, metadata: object, addedAt: timestamp, source: "login" | "manual" | "cascade", suspension: { isActive: boolean, level: "full" | "suggestions_only" | null, duration: "1d" | "3d" | "7d" | "30d" | "permanent" | null, reason: string | null, suspendedBy: string | null, suspendedAt: timestamp | null, expiresAt: timestamp | null } | null }
  ],
  multiAccountDetected: boolean,
  linkedAccountUids: string[]
}
```

Network metadata in identifiers includes: IP, ISP, country, ASN — same fields collected by in-app device tracking.

**`adminAuditLog`** — all admin actions
```
{
  id: string,
  adminUid: string,
  actionType: string, // e.g. "suggestion_approve", "ban_create", "suspension_cascade", "dispute_resolve"
  targetType: string, // e.g. "suggestion", "user", "identityGraph"
  targetId: string,
  details: object,
  timestamp: timestamp
}
```

---

## 8. Express API Routes

### Suggestions
- `GET /api/suggestions` — list public suggestions (accepted/planned/completed/rejected), paginated, sortable, filterable (tags, language, status, search text)
- `GET /api/suggestions/:id` — single suggestion with vote counts and comments
- `GET /api/suggestions/search?q=` — search suggestions by title/description (used for duplicate detection during submission)
- `POST /api/suggestions` — submit new suggestion (auth required)
- `PUT /api/suggestions/:id` — edit own pending suggestion (triggers re-review)
- `DELETE /api/suggestions/:id` — withdraw own pending suggestion
- `POST /api/suggestions/:id/vote` — upvote/downvote (auth required, 1 per user)
- `DELETE /api/suggestions/:id/vote` — remove vote
- `POST /api/suggestions/:id/comments` — add comment (auth required, accepted state only)
- `GET /api/suggestions/mine` — list own submissions with status
- `POST /api/suggestions/:id/dispute` — dispute a duplicate merge (submitter only)
- `GET /api/suggestions/blocked?q=` — check if a topic is blocked (returns blocked topic with reason if match found)
- `GET /api/suggestions/tags` — list available tags for filtering and submission

### Suggestion Admin
- `GET /api/admin/suggestions` — all suggestions including pending, with duplicate highlighting
- `PUT /api/admin/suggestions/:id/status` — accept/reject/plan/complete/overturn
- `PUT /api/admin/suggestions/:id/link` — link to roadmap feature
- `POST /api/admin/suggestions/:id/merge` — merge as duplicate of another suggestion
- `GET /api/admin/suggestions/disputes` — list pending duplicate disputes
- `PUT /api/admin/suggestions/disputes/:id` — resolve dispute (uphold or reject)
- `DELETE /api/admin/suggestions/blocked/:id` — unblock a rejected topic

### Subscriptions
- `GET /api/subscriptions/me` — get current user's preferences
- `PUT /api/subscriptions/me` — update preferences (per-event channel control)
- `POST /api/subscriptions/me/watch` — add feature/suggestion to watch list
- `DELETE /api/subscriptions/me/watch/:id` — remove from watch list
- `POST /api/subscriptions/push-token` — register browser push token
- `POST /api/subscriptions/unsubscribe` — one-click email unsubscribe (RFC 8058, token-based, no auth required)
- `DELETE /api/subscriptions/push-token` — revoke browser push token

### Bans (extends existing ban system)
- `POST /api/admin/bans/graph` — create ban graph
- `GET /api/admin/bans/graph/:id` — view identity graph
- `PUT /api/admin/bans/graph/:id` — update ban graph (add/remove identifiers, change scope)
- `DELETE /api/admin/bans/graph/:id` — unban entire graph
- `GET /api/admin/bans/check` — check if IP/fingerprint/uid is banned (used by middleware)

### Notifications
- `GET /api/notifications` — user's notification inbox (paginated)
- `PUT /api/notifications/:id/read` — mark as read
- `PUT /api/notifications/read-all` — mark all as read

### Data Export (extends existing)
- `GET /api/data-export` — existing GDPR data export route, extended to include suggestions, votes, comments, subscriptions, and identity graph data

### Admin Audit Log
- `GET /api/admin/audit-log` — list audit log entries (paginated, filterable by admin, action type, target, date range)
- `GET /api/admin/audit-log/export` — export audit log as CSV

---

## 9. Notification Infrastructure

### Email — Self-hosted Postfix

- Hosted on Oracle Cloud VM (dev: London, prod: Singapore)
- DKIM + SPF + DMARC configured for shytalk.shyden.co.uk
- Email templates rendered server-side with user's language preference
- Cron job checks for status changes and sends queued notifications
- Batch sends to avoid rate limits
- One-click unsubscribe header (RFC 8058)

### Browser Push — FCM Web Push

- Service worker registered on roadmap page
- Push token stored in subscriptions collection
- Server sends via Firebase Admin SDK
- Payload includes title, body, URL, icon

### In-App — Firestore

- Notifications written to `notifications` collection
- App listens via Firestore onSnapshot
- Bell icon shows unread count
- Dropdown shows recent notifications

---

## 10. Translations

All user-facing text must be translated into 20 languages (19 translations + English default):
en (default), ar, de, es, fr, hi, id, it, ja, ko, nl, pl, pt, ru, sv, th, tr, uk, vi, zh

Translation system follows the same pattern as all other web pages: `data-i18n` attributes + shared translation JS files.

**What needs translation:**
- Page UI: headings, labels, buttons, placeholders, status badges, info banners, tooltips, filter labels
- Suggestion statuses: Pending, Accepted, Planned, Completed, Rejected
- Notification templates: email subject/body, push title/body, in-app title/body
- Error messages: rate limit, banned, duplicate detected, etc.
- Moderation messages: "Your suggestion is under review", "Please don't re-submit", "Your suggestion was merged with...", "This is not a duplicate" dispute flow text

**Translation file:** `public/js/roadmap-translations.js` (shared JS file loaded by the page)
**Email templates:** Server-side with language parameter
**In-app strings:** Existing `shared/src/commonMain/composeResources/values-{locale}/strings.xml`

---

## 11. Testing

**CRITICAL: All tests written BEFORE implementation. 100% coverage. No edge case untested. Every branch, error path, boundary condition, and state transition must have a dedicated test. Unlimited audit cycles until nothing remains untested.**

### 11.1 Express API (Jest) — Suggestions CRUD & Validation

- Create: valid input returns 201
- Create: missing title returns 400
- Create: missing description returns 400
- Create: title exactly 80 chars (boundary) succeeds
- Create: title 81 chars returns 400
- Create: description exactly 5000 chars succeeds
- Create: description 5001 chars returns 400
- Create: empty title string returns 400
- Create: whitespace-only title returns 400
- Create: empty description string returns 400
- Create: whitespace-only description returns 400
- Create: title with XSS payload sanitised
- Create: description with XSS payload sanitised
- Create: title with SQL injection payload sanitised
- Create: valid tags accepted
- Create: invalid tag rejected
- Create: language auto-detected from user profile
- Create: language manual override accepted
- Create: invalid language code rejected
- Create: contactOptIn=true stored
- Create: contactOptIn=false stored
- Create: contactOptIn missing defaults to false
- Create: without auth returns 401
- Create: banned user returns 403
- Create: collects and stores IP, ISP, country, ASN, device fingerprint
- Create: title matching a blocked topic returns 403 with rejection reason
- Create: title similar (>80%) to blocked topic returns 403 with rejection reason
- Edit: owner can edit own pending suggestion
- Edit: non-owner cannot edit returns 403
- Edit: edit triggers re-review (status resets to pending)
- Edit: edit history recorded with old and new values
- Edit: cannot edit accepted suggestion returns 403
- Edit: cannot edit planned suggestion returns 403
- Edit: cannot edit completed suggestion returns 403
- Edit: cannot edit rejected suggestion returns 403
- Edit: title validation applied on edit
- Edit: description validation applied on edit
- Withdraw: owner can withdraw pending suggestion
- Withdraw: non-owner cannot withdraw returns 403
- Withdraw: cannot withdraw accepted returns 403
- Withdraw: cannot withdraw planned returns 403
- Withdraw: cannot withdraw completed returns 403
- Withdraw: cannot withdraw rejected returns 403
- List: returns paginated results
- List: default page size
- List: custom page size
- List: page 2 returns next set
- List: default sort is most voted
- List: sort by newest
- List: filter by status=accepted
- List: filter by status=planned
- List: filter by status=completed
- List: filter by status=rejected
- List: filter by tag
- List: filter by multiple tags
- List: filter by language
- List: filter by phase category
- List: combined filters (status + tag + language)
- List: empty results returns empty array
- List: does NOT return pending suggestions to non-submitter
- List: does NOT return submitter's own pending suggestions via public list endpoint (must use /mine)
- Search: text match on title
- Search: text match on description
- Search: partial match works
- Search: no results returns empty array
- Search: special characters handled
- Search: returns max 3 initially, supports load-more pagination
- Get single: returns suggestion with vote counts and comments
- Get single: 404 for non-existent ID
- Get single: rejected suggestion includes rejectReason
- Get mine: returns only submitter's suggestions
- Get mine: includes pending suggestions
- Get mine: auth required

### 11.2 Express API (Jest) — Suggestion Lifecycle Transitions

- Approve: pending → accepted, returns 200
- Approve: non-admin returns 403
- Approve: already accepted returns 400
- Approve: audit log entry created
- Reject: pending → rejected, with reason, returns 200
- Reject: pending → rejected, without reason, returns 200
- Reject: reason stored in rejectReason field
- Reject: audit log entry created
- Reject: re-suggest same topic blocked
- Plan: accepted → planned, linked to roadmap feature
- Plan: voting locked (votes endpoint returns 403)
- Plan: comments locked to read-only
- Plan: audit log entry created
- Plan: non-accepted suggestion cannot be planned returns 400
- Complete: planned → completed, completedAt set
- Complete: final notification sent to all subscribers
- Complete: subscriptions cleared after final notification
- Complete: audit log entry created
- Complete: non-planned suggestion cannot be completed returns 400
- Admin status change: rejected → accepted, status updated, re-suggest block lifted
- Admin status change: planned → accepted, voting re-enabled, comments re-enabled
- Admin status change: completed → planned, correct state restored
- Admin status change: accepted → rejected, with reason, blocked topic created
- Admin status change: accepted → planned, linked to roadmap feature
- Admin status change: completed → planned, then planned → accepted: two-step chain works
- Invalid transition: any status → pending returns 400 (admin decisions never revert to pending)
- Invalid transition: pending → planned returns 400 (must be accepted first)
- Invalid transition: pending → completed returns 400
- Reject: blockedTopics document created with title, reason, originalSuggestionId
- Admin unblock topic: blockedTopics document deleted, topic can be re-suggested

### 11.3 Express API (Jest) — Duplicate Detection & Merge

- Similar search: returns matching suggestions ranked by relevance
- Similar search: paginated, 3 at a time
- Similar search: load more returns next 3
- Similar search: exhausted returns empty
- Admin merge: duplicate removed from public view
- Admin merge: upvote transferred to original suggestion
- Admin merge: submitter notified (notification created)
- Admin merge: mergedIntoSuggestionId set on duplicate
- Admin merge: audit log entry created
- Admin merge: non-admin returns 403
- Dispute: submitter can dispute merge
- Dispute: non-submitter cannot dispute returns 403
- Dispute: creates dispute record with correct fields
- Dispute: suggestion re-enters moderation queue
- Dispute: admin sees dispute flag on suggestion
- Resolve dispute (uphold): final, suggestion stays merged
- Resolve dispute (reject): suggestion restored to pending
- Resolve dispute: audit log entry created
- Double dispute: submitter cannot dispute twice returns 400

### 11.4 Express API (Jest) — Voting

- Upvote: auth required, returns 200, count incremented
- Downvote: auth required, returns 200, count incremented
- Toggle up→down: previous vote removed, new vote applied, counts updated
- Toggle down→up: previous vote removed, new vote applied, counts updated
- Remove vote: count decremented, vote doc deleted
- Remove non-existent vote: returns 404
- Duplicate vote same direction: returns 400
- Vote on pending: returns 403
- Vote on planned: returns 403
- Vote on completed: returns 403
- Vote on rejected: returns 403
- Vote reason: stored with public visibility
- Vote reason: stored with private visibility
- Vote reason: null when not provided
- Vote without auth: returns 401
- Vote by banned user: returns 403
- Vote count: net score calculated correctly (upvotes - downvotes)

### 11.5 Express API (Jest) — Comments

- Add comment on accepted: succeeds, returns 201
- Add comment: auth required, returns 401 without
- Add comment on pending: returns 403
- Add comment on planned: returns 403 (read-only)
- Add comment on completed: returns 403 (read-only)
- Add comment on rejected: returns 403
- Comment public visibility: anonymous author in response
- Comment private visibility: admin-only, not in public response
- Comment: banned user returns 403
- Comment: empty text returns 400
- Comment: max length enforced
- Comment: XSS payload sanitised
- List comments: returns all public comments for suggestion
- List comments: admin sees private comments too

### 11.6 Express API (Jest) — Subscriptions

- Get preferences: returns defaults for new user (in-app only for most events; in-app + system message for rejection, merge, and acceptance events per Section 4.4 defaults)
- Get preferences: returns saved preferences for existing user
- Update preferences: per-event channel control saved
- Update preferences: all channels enabled for one event
- Update preferences: no channels for one event (none)
- Update preferences: mixed channels across events
- Update preferences: system message channel saved
- Watch feature: added to watchedFeatures list
- Watch feature: duplicate watch ignored (idempotent)
- Unwatch feature: removed from list
- Unwatch non-watched: returns 404
- Watch suggestion: added to watchedSuggestions list
- Auto-subscribe on own suggestion creation
- Push token: registration stores token
- Push token: update replaces old token
- Push token: clear removes token
- Auth required on all subscription endpoints
- Enable email without GDPR consent: returns 400
- Enable email with GDPR consent: succeeds, consent timestamp stored

### 11.7 Express API (Jest) — Notifications

- Created on roadmap status change: for feature subscribers + "all" subscribers
- Created on suggestion accepted: for submitter + suggestion subscribers
- Created on suggestion planned: for all suggestion subscribers
- Created on suggestion completed: for all subscribers, subscription cleared
- Created on suggestion rejected: for submitter only
- Created on suggestion merged: for submitter only
- Created on comment: for suggestion subscribers
- Respects channel preferences: email disabled → no email sent
- Respects channel preferences: push disabled → no push sent
- Respects channel preferences: system message enabled → SHYTALK_SYSTEM message created
- Email enabled → email dispatched to correct address with correct subject and translated body
- Push enabled → FCM called with correct payload (title, body, URL, icon)
- Email includes List-Unsubscribe header with correct URL
- Email includes List-Unsubscribe-Post header (RFC 8058)
- POST to unsubscribe endpoint with valid token: removes email channel preference
- POST to unsubscribe endpoint with invalid token: returns 400
- Created on suggestion rejected: submitter subscription (watchedSuggestions entry) cleaned up after notification
- Inbox: paginated, newest first
- Inbox: includes unread count
- Mark single read: isRead set to true
- Mark all read: all notifications marked
- Auth required on all notification endpoints
- System message: correct conversation structure with SHYTALK_SYSTEM

### 11.8 Express API (Jest) — Identity Graph & Suspensions

**Identity binding at login:**
- Login from web: IP + network info + browser fingerprint bound to account
- Login from app: IP + network info + device ID bound to account
- Second login from new IP: new IP added to graph
- Second login from new device: new device added to graph
- All identifiers share same graphId

**Suspension cascade:**
- Suspend account (7 days): all linked devices get 7-day suspension
- Suspend account (7 days): all linked networks get 7-day suspension
- Suspend account (permanent): all get permanent ban
- Suspend account (suggestions-only): all get suggestions-only restriction
- Suspended device used with new IP: new IP auto-suspended, added to graph, audit logged
- Suspended network used with new device: new device auto-suspended, audit logged

**Multi-account detection:**
- Device linked to 2 accounts: both auto-suspended
- Device linked to 3 accounts: all 3 auto-suspended
- Multi-account flag set on graph
- Audit log records detection event

**Full suspension enforcement:**
- Fully suspended: API requests return 403 with suspension info
- Fully suspended: cannot access suggestions (vote, comment, submit)
- Fully suspended: cannot access app features
- Suggestions-only: can still access app, cannot use suggestions
- Suspension expiry: auto-cleared after duration

**Unsuspend:**
- Unsuspend entire graph: all identifiers cleared
- Unsuspend specific identifier: only that one cleared
- Unsuspend audit logged

**Ban check middleware:**
- Check by IP: returns correct status
- Check by fingerprint: returns correct status
- Check by UID: returns correct status
- Check by any match: triggers ban response
- Non-banned identifier: passes through

**Ban graph CRUD contracts:**
- POST /api/admin/bans/graph: returns 201 with graphId
- POST /api/admin/bans/graph: non-admin returns 403
- GET /api/admin/bans/graph/:id: returns 200 with full identifier list
- GET /api/admin/bans/graph/:id: non-existent graph returns 404
- PUT /api/admin/bans/graph/:id: update suspension level returns 200
- DELETE /api/admin/bans/graph/:id: unban returns 200
- DELETE /api/admin/bans/graph/:id: non-existent returns 404

### 11.9 Express API (Jest) — Admin Audit Log

- Every suggestion action creates entry (approve, reject, merge, overturn, complete)
- Every ban/suspension action creates entry
- Every identity graph change logged (new identifier, cascade event)
- Every dispute resolution logged
- Audit log: list paginated
- Audit log: filter by admin UID
- Audit log: filter by action type
- Audit log: filter by target type
- Audit log: filter by date range
- Audit log: combined filters
- Audit log: export CSV correct format
- Audit log: auth required (admin only)

### 11.10 Playwright (Web) — Roadmap Page

- Page loads with ShyTalk dark theme
- No Star Wars elements (no intro, no crawl, no canvas, no music, no MP3 references)
- Ring chart renders with correct percentage
- Ring chart legend shows correct counts (Done, In Progress, Planned)
- Per-phase progress bar shows correct fraction (e.g. "4/5")
- Feature list shows correct status icons (✓ Done, ◉ In Progress, ○ Planned)
- Bell icon visible on each feature
- Clicking bell without login shows login prompt
- Clicking bell when logged in opens subscribe modal
- Sticky nav visible when scrolling
- Sticky nav clicks scroll to correct sections
- Last updated date displays correctly
- Footer text present
- Mobile viewport: layout responsive, no horizontal scroll
- Tablet viewport: layout adapts correctly

### 11.11 Playwright (Web) — Suggestions Board

**Public browsing (no login):**
- Suggestions list loads with cards
- Card shows: title, description, vote count, tags, language tag, timestamp, status badge
- Sort "Most Voted" works (verify order)
- Sort "Newest" works (verify order)
- Filter by status works (each status individually)
- Filter by tag works
- Filter by language works
- Filter by phase category works
- Combined filters work (status + tag + language)
- Search by text works (results match query)
- Pagination: page 1 loads, clicking page 2 loads next set
- Rejected suggestion shows decline reason (if provided)
- Rejected suggestion without reason shows no reason text
- Completed suggestion shows "Shipped!" badge
- Planned suggestion shows "Planned" badge, no vote arrows
- Info banner visible with both moderation warning and duplicate warning text
- Empty state: no suggestions shows appropriate message

**Login gate:**
- Click vote without login → login prompt
- Click "+ Suggest" without login → login prompt
- Click comment without login → login prompt
- Click subscribe bell without login → login prompt
- After login, user returned to previous action context

**Submission flow:**
- Form displays: title field (80 char limit visible), description field (5000 char limit visible), tags, language dropdown (pre-selected from user pref), contact opt-in checkbox
- Character counter updates as user types
- Title at 80 chars: counter shows 80/80, cannot type more
- Description at 5000 chars: counter shows 5000/5000
- Duplicate detection: typing title shows similar suggestions after 3+ chars
- Duplicate detection: "Yes, this is what I meant" → redirected to original, upvote flow starts
- Duplicate detection: "No, my idea is different" → form continues
- Duplicate detection: "Load more" shows 3 more results
- Duplicate detection: all results exhausted, "Load more" disappears
- Submit success: toast message shown with "don't re-submit" text
- Submit: suggestion appears in "My Suggestions" view
- Edit pending: form pre-filled with current values, re-review warning banner shown
- Withdraw pending: confirmation dialog, suggestion removed from "My Suggestions"
- Cannot edit/withdraw accepted/planned/completed/rejected (buttons not shown)

**Voting flow:**
- Upvote: arrow highlights, count increments
- Downvote: arrow highlights, count decrements
- Toggle: clicking opposite arrow switches vote, counts update
- Remove vote: clicking same arrow again removes vote
- Vote reason: optional modal appears, can choose public/private
- Planned suggestion: vote arrows disabled/hidden
- Completed suggestion: vote arrows disabled/hidden

**Comment flow:**
- Comment form visible on accepted suggestions
- Planned suggestions: "Comments are read-only" label, no form
- Submit comment: appears in comment list
- Anonymous label on public comments
- Private comment not visible to non-admins

### 11.12 Playwright (Web) — Subscribe Modal

- Opens from header "Subscribe" button
- Opens from per-feature bell icon (feature pre-selected in watch list)
- Shows login prompt when not logged in
- Shows user info when logged in
- All event types listed with 4 channel toggles each (email, push, in-app, system message)
- Default state: in-app only checked for all events
- Toggle each channel independently
- Watch list shows currently watched features/suggestions
- Remove from watch list: item disappears
- Save preferences: toast confirmation
- Reload page: preferences persist (verify API returned correct state)
- Cancel: no changes saved
- Email checkbox disabled until GDPR consent ticked

### 11.13 Playwright (Web) — Translations

- Language switcher present on page
- Switch language: all headings translated
- Switch language: all buttons translated
- Switch language: all status badges translated
- Switch language: info banner translated
- Switch language: filter labels translated
- Switch language: suggestion form labels translated
- Switch language: subscribe modal labels translated
- Switch language: error messages translated (trigger one and verify)
- Test all 20 languages: each language renders all UI labels, buttons, status badges, info banner, filter labels correctly
- RTL layout correct for Arabic

### 11.14 Playwright (Web) — Anti-Abuse

- Banned user: sees suggestions (read-only)
- Banned user: no vote/comment/suggest buttons visible
- Banned user: direct API call returns 403
- Suspended user (full): page shows suspension message, cannot interact

### 11.15 Kotlin (Unit) — In-App Notifications

- Notification model: parse all types (roadmap_update, suggestion_accepted, suggestion_planned, suggestion_completed, suggestion_rejected, suggestion_merged, comment)
- Notification model: unknown type handled gracefully
- Bell icon: unread count 0 hides badge
- Bell icon: unread count > 0 shows badge
- Bell icon: unread count > 99 shows "99+"
- Notification dropdown: items render with correct icon per type
- Notification dropdown: relative timestamp formats correctly (seconds, minutes, hours, days)
- Notification dropdown: source label (Roadmap/Suggestions) correct per type
- Notification dropdown: unread dot visible for unread, hidden for read
- Mark read: UI updates immediately
- Mark all read: all dots removed, count reset
- System message: SHYTALK_SYSTEM conversation message rendered correctly
- Subscription preferences: default values (in-app only)
- Subscription preferences: stored locally after API sync
- Subscription preferences: sent to API on change
- Identity binding: device info + network info collected on login
- Identity binding: sent to API on login

### 11.16 Playwright (Admin Panel) — Suggestions Moderation

- Pending queue loads with suggestion cards showing title, description, submitter, timestamp
- Approve button: moves to accepted, removed from queue
- Reject button: with reason (text field), reason stored
- Reject button: without reason, warning shown "reason will be displayed publicly"
- Reject button: reason is optional but encouraged (UI makes this clear)
- Merge duplicate: search for original suggestion, select, confirm
- Merge duplicate: upvote count updated on original
- Merge duplicate: submitter notified
- Dispute queue: lists disputed merges
- Dispute uphold: final, notification sent to submitter
- Dispute reject: suggestion restored to pending queue
- Link to roadmap: dropdown of roadmap features, selection saves
- Complete: button, confirmation dialog
- Overturn: available on all non-pending states, correct state transitions
- Suggestion history: timeline of status changes visible
- Submitter identity: link to view full identity graph
- Duplicate highlighting: similar existing suggestions shown alongside pending review
- Contact opt-in indicator visible on suggestion card

### 11.17 Playwright (Admin Panel) — Unified Ban Management

- Identity graph loads for selected user
- Graph shows all linked: accounts, devices, networks with metadata
- Suspend: duration picker (1d/3d/7d/30d/permanent)
- Suspend: scope picker (full/suggestions-only)
- Suspend: cascade preview ("This will also affect: N devices, N networks, N accounts")
- Suspend: confirmation required
- Suspend: all linked identifiers suspended at same level
- Multi-account alert: displayed when device linked to multiple accounts
- Unsuspend graph: all identifiers cleared
- Unsuspend specific identifier: only that one cleared
- All actions create audit log entries (verify in audit log tab)

### 11.18 Playwright (Admin Panel) — Audit Log

- Audit log tab loads with entries
- Filter by admin user works
- Filter by action type works
- Filter by target type works
- Filter by date range works
- Combined filters work
- Pagination works
- Export CSV: file downloads, correct headers, correct data
- Entries include: admin name, action, target, timestamp, details

### 11.19 Security Tests (Express + Playwright)

- Every authenticated endpoint: 401 without token
- Every admin endpoint: 403 for non-admin
- Every interactive suggestions endpoint: 403 for banned user
- Input validation: XSS in title, description, comment, vote reason — all sanitised
- Input validation: SQL injection in all text fields — all sanitised
- Input validation: oversized payloads rejected
- Network info collection: verified on login (correct IP, ISP, country stored)
- Multi-account detection: verified triggers suspension
- Cascade suspension: verified propagates to all linked identifiers
- Suspension expiry: timed suspensions expire correctly
- CORS: suggestions API accessible from roadmap page origin only
- Rate limiting: no rate limit on suggestions (login is gate), verify no artificial limits

### 11.20 Express API (Jest) — Maintenance Endpoints

- Clear all suggestions: deletes all suggestions, votes, comments
- Clear all suggestions: returns count of deleted items
- Clear all suggestions: admin only (403 for non-admin)
- Clear all suggestions: audit log entry created
- Clear all subscriptions: deletes all subscription preferences and push tokens
- Clear all subscriptions: admin only
- Clear all notifications: deletes all notification inbox entries
- Clear all notifications: admin only
- Clear identity graphs: resets all identity bindings
- Clear identity graphs: admin only, double-confirmation required
- Clear admin audit log: deletes all entries
- Clear admin audit log: admin only

### 11.21 Express API (Jest) — Submission Confirmation

- On suggestion creation: push notification sent to submitter
- On suggestion creation: system message sent to submitter's SHYTALK_SYSTEM inbox
- Push notification content: correct title, body, translated
- System message content: correct text, includes suggestion title
- Creator auto-upvote: suggestion starts with 1 upvote
- Creator auto-upvote: creator cannot remove their own upvote (returns 403)
- Creator auto-upvote: creator cannot downvote their own suggestion (returns 403)

### 11.22 Express API (Jest) — Edge Cases & Boundaries

**Concurrent operations:**
- Two users vote on same suggestion simultaneously: both votes recorded, counts correct
- User edits suggestion while admin is reviewing: edit wins, status resets to pending
- User withdraws suggestion while admin is approving: withdrawal wins, suggestion deleted
- Admin merges suggestion while submitter is editing: merge wins

**Data integrity:**
- Delete suggestion: cascades to votes, comments, subscriptions, disputes
- Merge suggestion: original suggestion vote count includes transferred vote
- Complete suggestion: all watchers notified, subscription docs cleaned up
- Reject suggestion: topic added to blocked list, verified on next submission attempt

**Empty/null handling:**
- List suggestions with no data: returns empty array, not error
- Get non-existent suggestion: 404 not 500
- Vote on non-existent suggestion: 404
- Comment on non-existent suggestion: 404
- Subscribe to non-existent feature: 404
- Update preferences with empty object: no-op, returns current preferences
- Search with empty query: returns 400 bad request

**Pagination boundaries:**
- Page 0: treated as page 1
- Page beyond max: returns empty array
- Negative page: returns 400
- Page size 0: returns 400
- Page size > max (e.g. 1000): capped at max (e.g. 50)

**Character encoding:**
- Title with emoji: stored and returned correctly
- Description with CJK characters: stored and returned correctly
- Title with RTL (Arabic): stored and returned correctly
- Tags with special characters: handled
- Vote reason with newlines: stored correctly

**Identity graph edge cases:**
- User with no prior logins: graph created on first login
- User logging in from 100+ different IPs: all stored, graph remains performant
- Suspend graph with 50+ identifiers: all suspended, cascade logged for each
- Unsuspend graph: all identifiers cleared, none missed
- Two separate graphs merge when shared identifier discovered: graphs combined

### 11.23 Playwright (Web) — Roadmap Page Layout Details

**Ring chart:**
- Percentage matches actual done/total ratio
- Chart animates on page load
- Legend counts match phase data (sum all done, in-progress, planned)
- Resize: chart scales on mobile without distortion

**Per-phase progress:**
- Each phase shows correct "X/Y" count
- Mini progress bar width proportional to completion
- Phase dot colour matches status (green=active, orange=soon, purple=planned)
- Collapsed phase: click expands feature list
- Expanded phase: click collapses
- Phase with all features done: full progress bar, green dot

**Feature list:**
- Status icon correct: ✓ for done, ◉ for in-progress, ○ for planned
- Bell icon: not subscribed state (outline)
- Bell icon: subscribed state (filled/highlighted)
- Click feature name: no navigation (it's informational)
- Long feature name: text wraps, does not overflow
- Long description: truncated with ellipsis, expandable

**Sticky nav:**
- Appears when scrolling past header
- Disappears when scrolling back to top
- "Roadmap" link scrolls to roadmap section
- "Suggestions" link scrolls to suggestions section
- Active section highlighted in nav based on scroll position
- Mobile: nav still fits on small screen

**Responsive:**
- 320px viewport: all content visible, no horizontal scroll
- 768px viewport: layout adapts (2-column where appropriate)
- 1200px viewport: max-width container, centred

### 11.24 Playwright (Web) — Suggestion Submission Edge Cases

- Submit with exactly 80 char title: succeeds
- Submit with 81 char title: prevented by form (client-side validation)
- Submit with exactly 5000 char description: succeeds
- Submit with 5001 char description: prevented by form
- Submit with only whitespace title: form validation error
- Submit with emoji in title: succeeds, displayed correctly
- Submit with RTL text (Arabic): layout correct, language tag set
- Duplicate detection: no matches → "Load more" not shown
- Duplicate detection: exactly 3 matches → shown, no "Load more"
- Duplicate detection: 4+ matches → 3 shown, "Load more" appears
- Duplicate detection: click "Yes, this is what I meant" on 2nd page of results → upvotes correct suggestion
- Back button during submission: form state preserved
- Network error during submit: error message shown, form not cleared (user can retry)
- Double-click submit button: only one submission created

### 11.25 Playwright (Web) — Voting Edge Cases

- Rapid-fire voting (click up, click down, click up quickly): final state correct
- Vote on suggestion, navigate away, come back: vote state preserved
- Two browser tabs: vote in one, other tab reflects updated count on refresh
- Downvote: count goes negative (net score can be negative)
- Vote reason with 0 chars: accepted (no reason)
- Vote reason with max chars: accepted
- Toggle vote reason visibility after submission: not possible (immutable)

### 11.26 Playwright (Web) — Subscribe Modal Edge Cases

- Open modal, change nothing, save: no API call made
- Open modal, enable all channels for all events, save: all persisted
- Open modal, disable all channels for all events, save: all cleared (effectively unsubscribed)
- Watch list with 20+ items: scrollable, all removable
- Open from bell icon: that feature pre-selected in watch list
- Open from header: no feature pre-selected
- Close modal with X: no changes saved
- Close modal by clicking backdrop: no changes saved

### 11.27 Kotlin (Unit) — Identity Binding Edge Cases

- Login with no network (offline): binding queued, sent when online
- Login on Wi-Fi: correct network info (ISP, IP)
- Login on mobile data: correct network info
- Switch network mid-session: new network info sent
- Device info: model, OS version, app version all captured
- Fingerprint: consistent across app restarts on same device

### 11.28 Kotlin (Unit) — Notification Display Edge Cases

- Notification with very long title: truncated in dropdown
- Notification with very long body: truncated with "..."
- 0 notifications: bell shows no badge, dropdown shows "No notifications"
- 1 notification: badge shows "1"
- 99 notifications: badge shows "99"
- 100+ notifications: badge shows "99+"
- Mark read while offline: queued, synced when online
- Notification for deleted suggestion: handled gracefully (show generic text)
- System message notification: opens SHYTALK_SYSTEM conversation when tapped
- Roadmap notification: opens roadmap page in browser when tapped

### 11.29 Playwright (Admin Panel) — Maintenance Tab

- Clear all suggestions: confirmation dialog, progress shown, count displayed on completion
- Clear all subscriptions: confirmation dialog, clears all
- Clear all notifications: confirmation dialog, clears all
- Clear identity graphs: double-confirmation (extra warning about danger), clears all
- Clear audit log: confirmation dialog, clears all
- Each action: admin audit log entry created (except clear audit log itself)
- Non-admin: maintenance tab not visible

### 11.30 Playwright (Admin Panel) — Moderation Edge Cases

- Approve suggestion then immediately reject: second action fails (already transitioned)
- Reject with very long reason (2000+ chars): truncated or max enforced
- Merge suggestion that has 50+ votes: all transferred correctly to original
- Merge suggestion with itself: returns error
- Dispute on already-resolved dispute: returns error
- Admin overturn: audit log shows full history (original decision + overturn)
- Two admins acting on same suggestion simultaneously: first wins, second gets conflict error
- Filter pending queue by submitter: works
- Sort pending queue by submission date: works
- Bulk approve 10 suggestions: all transitioned, all audit logged

### 11.31 Integration Tests (Express) — Full Flows

- **Happy path:** create suggestion → admin approves → users vote → admin plans → admin completes → final notification → subscription cleared
- **Rejection path:** create suggestion → admin rejects with reason → submitter notified → re-suggest blocked → verify block works
- **Duplicate path:** create suggestion → admin merges → submitter disputes → admin upholds → final state correct
- **Duplicate path 2:** create suggestion → admin merges → submitter disputes → admin rejects dispute → suggestion restored to pending
- **Subscription path:** user subscribes to feature → feature status changes → notification created in correct channels → user unsubscribes → next change → no notification
- **Ban cascade path:** user logs in from device A + IP 1 → admin suspends user → device A suspended → user logs in from device B + IP 2 (before ban) → device B also in graph → new login from IP 2 on device C → device C auto-suspended
- **Multi-account path:** user A logs in on device X → user B logs in on device X → both accounts auto-suspended → admin notified
- **Edit re-review path:** user submits → user edits → status resets to pending → admin re-reviews → approves → edit history shows both versions

### 11.32 Firestore Security Rules

- `suggestions`: unauthenticated can read accepted/planned/completed/rejected
- `suggestions`: unauthenticated cannot read pending
- `suggestions`: authenticated can create (with required fields)
- `suggestions`: only owner can update own pending suggestion
- `suggestions`: only owner can delete own pending suggestion
- `suggestions`: non-owner cannot update or delete
- `suggestions`: admin can update any suggestion (status changes)
- `suggestions/{id}/votes`: authenticated can create/update/delete own vote doc
- `suggestions/{id}/votes`: cannot create vote on pending/planned/completed/rejected suggestion
- `suggestions/{id}/votes`: cannot create two vote docs (one per user enforced)
- `suggestions/{id}/votes`: voterId in doc must match authenticated user's UID (cannot vote on behalf of another user)
- `suggestions`: authenticated user cannot directly read a specific pending suggestion doc by ID (unless they are the submitter or admin)
- `suggestions/{id}/comments`: authenticated can create on accepted suggestions only
- `suggestions/{id}/comments`: cannot create on pending/planned/completed/rejected
- `blockedTopics`: only admin can create/delete
- `blockedTopics`: anyone can read (needed for submission check)
- `suggestionDisputes`: only submitter of merged suggestion can create
- `suggestionDisputes`: only admin can update (resolve)
- `subscriptions`: only owner (uid match) can read/write own doc
- `subscriptions`: admin cannot read user subscriptions (privacy)
- `notifications`: only owner (uid match) can read/update own notifications
- `notifications`: server (admin SDK) can create for any user
- `identityGraphs`: only admin can read/write
- `identityGraphs`: regular users cannot read or write
- `adminAuditLog`: only admin can read
- `adminAuditLog`: regular users cannot read
- `contactSubmissions`: only admin can read (if added later)

### 11.33 Express API (Jest) — Firestore Rule Enforcement

- Unauthenticated request to create suggestion: rejected by middleware before Firestore
- Authenticated non-admin request to admin routes: rejected by requireAdmin
- Token with revoked/expired Firebase auth: returns 401
- Token with valid auth but suspended account: returns 403 with suspension details
- Token with valid auth but suggestions-only ban: allowed on non-suggestion routes, blocked on suggestion routes

### 11.34 Express API (Jest) — Notification Dispatch Cron

- Cron processes queued notifications in batch
- Cron skips notifications for users with channel disabled
- Cron handles Postfix connection failure gracefully (retry queue)
- Cron handles FCM token expired (remove token, mark notification as failed)
- Cron handles Firestore write failure (retry)
- Cron does not send duplicate notifications (idempotent)
- Cron processes max batch size per run (prevents timeout)
- Cron logs success/failure counts

### 11.35 Express API (Jest) — Email Template Rendering

- English template: correct subject, body, CTA link, footer
- Arabic template: correct RTL subject and body
- Chinese template: correct CJK characters
- All 20 languages: template renders without errors
- Template includes roadmap page URL as CTA
- Template includes unsubscribe link with valid token
- Template includes List-Unsubscribe header
- Template includes List-Unsubscribe-Post header
- Template includes Shyden Ltd footer
- Suggestion title in email is escaped (XSS prevention in email)
- Very long suggestion title: truncated in email subject

### 11.36 Express API (Jest) — Service Worker & Push Registration

- Register push token: valid FCM token stored in subscriptions
- Register push token: invalid token format returns 400
- Register push token: update replaces old token
- Delete push token: removes from subscriptions
- Push payload: correct structure (title, body, icon, url, data)
- Push payload: translated to user's language
- Push to expired token: FCM returns error, token removed from subscriptions

### 11.37 Express API (Jest) — Data Migration & Defaults

- Existing user with no subscription doc: first API call creates default preferences (in-app only)
- Existing user with no identity graph: first login creates graph
- Existing user with old-format ban data: migration path to identity graph (if applicable)
- New user: subscription defaults applied correctly
- New user: identity graph created on first login

### 11.38 Express API (Jest) — Network Failure Resilience

- Postfix down: email notification queued for retry, no error to user
- FCM down: push notification queued for retry, no error to user
- Firestore write failure on notification: retried, logged
- R2 down (if roadmap data served from R2): graceful fallback
- Identity graph update fails mid-cascade: partial state logged, admin alerted
- Suggestion creation succeeds but notification send fails: suggestion still created, notification retried

### 11.39 Express API (Jest) — Roadmap Data Generation

- generate-roadmap-json.js: produces valid JSON from markdown
- generate-roadmap-json.js: strips PR numbers from output
- generate-roadmap-json.js: strips internal references (SonarCloud, Allure, etc.)
- generate-roadmap-json.js: maps statuses correctly (DONE→done, IN PROGRESS→in-progress)
- generate-roadmap-json.js: skips Phase 0 (internal)
- generate-roadmap-json.js: merges translations correctly
- generate-roadmap-json.js: calculates completion stats (done count, total, percentage)
- generate-roadmap-json.js: handles empty phases
- generate-roadmap-json.js: handles missing translations gracefully

### 11.40 Playwright (Web) — Accessibility

- Keyboard navigation: tab through all interactive elements in order
- Keyboard navigation: enter/space activates buttons and toggles
- Keyboard navigation: escape closes modals
- Screen reader: all images have alt text
- Screen reader: form fields have labels
- Screen reader: status badges have aria-labels
- Screen reader: vote buttons have descriptive aria-labels ("Upvote this suggestion", "Downvote this suggestion")
- Screen reader: notification bell has aria-label with unread count
- Colour contrast: all text meets WCAG AA (4.5:1 ratio on dark theme)
- Focus indicator: visible focus ring on all interactive elements
- Skip link: "Skip to content" link present for keyboard users
- Reduced motion: animations respect prefers-reduced-motion
- Touch targets: minimum 44x44px on mobile for all buttons

### 11.41 Playwright (Web) — Deep Linking & URL Handling

- Direct URL to suggestion: `/roadmap#suggestion-{id}` scrolls to and highlights suggestion
- Direct URL to roadmap section: `/roadmap#roadmap` scrolls to roadmap
- Direct URL to suggestions section: `/roadmap#suggestions` scrolls to suggestions
- Share button on suggestion: copies direct link to clipboard
- Shared link: opens page and scrolls to correct suggestion
- Invalid suggestion ID in URL: page loads normally, no error
- URL updates when scrolling between sections (history.replaceState)

### 11.42 Playwright (Web) — SEO & Meta Tags

- Page title: "ShyTalk Roadmap" (or translated equivalent)
- Meta description present and meaningful
- Open Graph tags: og:title, og:description, og:image, og:url
- Twitter card tags present
- Canonical URL set
- robots: index, follow (public page)
- Structured data: JSON-LD for roadmap content (optional but good for SEO)

### 11.43 Playwright (Web) — CSP & Security Headers

- No console errors on page load (CSP correctly configured)
- CSP img-src includes blob: (for any dynamic images)
- CSP connect-src includes API origin
- CSP script-src allows inline (if needed) or nonce-based
- No mixed content warnings
- X-Content-Type-Options: nosniff (if served via Caddy)

### 11.44 Playwright (Web) — Performance

- Page load: roadmap data renders within 3 seconds on 3G throttle
- Ring chart: renders within 1 second of data load
- Suggestion list: first page renders within 2 seconds
- Lazy loading: off-screen suggestions not fetched until scrolled near
- Image optimization: any images use appropriate format and size
- Bundle size: total JS + CSS under 500KB (excluding translations)

### 11.45 Playwright (Web) — Error States

- API unreachable: roadmap shows fallback message with link to GitHub
- API returns 500 on suggestions list: error message shown, retry button
- API returns 500 on vote: error toast, vote state unchanged
- API returns 500 on suggestion submit: error toast, form not cleared
- API returns 500 on subscription save: error toast, preferences unchanged
- Network disconnects mid-vote: error handled gracefully
- Stale data: user votes on suggestion that was just planned by admin: error message "This suggestion is no longer accepting votes"

### 11.46 Playwright (Web) — Browser Compatibility

- Chrome (latest): all features work
- Firefox (latest): all features work
- Safari (latest): all features work
- Mobile Chrome (Android): all features work, touch interactions correct
- Mobile Safari (iOS): all features work, touch interactions correct
- Edge (latest): all features work

### 11.47 Kotlin (Unit) — Suspension Enforcement in App

- Fully suspended user: app shows suspension screen with reason and duration
- Fully suspended user: cannot navigate past suspension screen
- Suggestions-only suspended: app works normally, suggestion-related features disabled
- Suspension expiry: app re-checks on resume, clears suspension if expired
- Multi-account suspension: shows "Multiple accounts detected" as reason
- Suspension with appealable flag: shows appeal button (future work, but model should support it)

### 11.48 Kotlin (Unit) — Subscription UI in App

- Settings screen: notification preferences section visible
- Settings screen: per-event toggles for each channel
- Settings screen: defaults to in-app only
- Settings screen: changes saved to Firestore via API
- Settings screen: loading state while fetching preferences
- Settings screen: error state if API fails
- Watch list: shows watched features and suggestions
- Watch list: remove button works
- Watch list: empty state message

### 11.49 E2E (BDD/Gherkin) — Android Scenarios

- Feature: Roadmap notifications
  - Scenario: User receives in-app notification when watched feature status changes
  - Scenario: User receives system message when their suggestion is accepted
  - Scenario: User receives system message when their suggestion is rejected
  - Scenario: User taps notification and is taken to roadmap page in browser
  - Scenario: User taps system message and sees suggestion details

- Feature: Subscription management
  - Scenario: User opens notification settings and sees per-event channel toggles
  - Scenario: User enables email notifications with GDPR consent
  - Scenario: User disables all notifications for an event type
  - Scenario: User views watched features list and removes one

- Feature: Suspension display
  - Scenario: Suspended user sees suspension screen with reason and countdown
  - Scenario: Suggestions-only suspended user can use app but not suggestions features
  - Scenario: Multi-account detected user sees appropriate message

### 11.50 Integration Tests (Express) — Additional Full Flows

- **Blocked topic path:** create suggestion → admin rejects → blockedTopics created → new user tries same topic → shown rejection reason → cannot submit
- **Admin unblock path:** admin rejects suggestion → topic blocked → admin unblocks → new user can now suggest that topic
- **GDPR email path:** user enables email without consent → rejected → user ticks consent → email enabled → user receives email notification → user clicks unsubscribe in email → email channel disabled
- **Full suspension web path:** user logs in on web → admin suspends → user refreshes page → sees suspension message → cannot vote/comment/suggest → suspension expires → user can interact again
- **Identity graph merge path:** user A logs in on device 1 (graph created) → user A logs in on device 2 (device added to graph) → admin suspends user A → both devices suspended → unknown user logs in on device 1 → their account auto-suspended + added to graph
- **Suggestion lifecycle with notifications:** create → push + system message received → admin accepts → in-app notification → users vote → someone comments → comment notification to watchers → admin plans → plan notification → admin completes → final notification → subscription cleared → no more notifications
- **Dispute with identity check:** user submits suggestion → admin merges as duplicate → user disputes → admin views user's identity graph during dispute review → admin resolves dispute

### 11.51 Express API (Jest) — API Response Format Contracts

- GET /api/suggestions: response shape matches { suggestions: [...], total: number, page: number, pageSize: number }
- GET /api/suggestions/:id: response includes { id, title, description, tags, language, status, upvotes, downvotes, netScore, comments: [...], createdAt, ... }
- GET /api/suggestions/:id: rejected suggestion includes rejectReason field
- GET /api/suggestions/:id: planned suggestion includes linkedRoadmapFeature
- GET /api/suggestions/:id: merged suggestion includes mergedIntoSuggestionId
- GET /api/suggestions/:id: public comments have anonymous authorUid (not real UID)
- GET /api/suggestions/:id: private comments excluded from non-admin response
- GET /api/suggestions/:id: admin response includes private comments + submitter identity info
- GET /api/suggestions/mine: response includes pending suggestions with all fields
- GET /api/suggestions/search: response shape matches { results: [...], hasMore: boolean }
- GET /api/notifications: response includes { notifications: [...], unreadCount: number, total: number }
- GET /api/subscriptions/me: response includes full channelPreferences object with all event types
- GET /api/admin/suggestions: response includes disputePending flag on disputed suggestions
- GET /api/admin/bans/graph/:id: response includes full identifier list with metadata
- GET /api/admin/audit-log: response includes { entries: [...], total: number, page: number }
- GET /api/suggestions/blocked?q=: response includes { blocked: boolean, topics: [{ title: string, rejectReason: string | null, originalSuggestionId: string }] }
- GET /api/suggestions/tags: response includes { tags: [{ id: string, name: string, category: string }] }

### 11.52 Express API (Jest) — HTTP Method & Content-Type Enforcement

- GET on POST-only route (POST /api/suggestions): returns 404 or 405
- POST on GET-only route (GET /api/suggestions): returns 404 or 405
- PUT on DELETE-only route: returns 404 or 405
- POST /api/suggestions with Content-Type text/plain: returns 400
- POST /api/suggestions with no Content-Type: returns 400
- POST /api/suggestions with Content-Type multipart/form-data: returns 400 (JSON only)
- POST /api/suggestions/:id/vote with oversized body (>1MB): returns 413
- POST /api/suggestions with body >50KB: returns 413
- OPTIONS preflight for /api/suggestions: returns correct CORS headers
- OPTIONS preflight for /api/suggestions/:id/vote: returns correct CORS headers
- OPTIONS preflight includes Access-Control-Allow-Methods
- OPTIONS preflight includes Access-Control-Allow-Headers (Authorization)

### 11.53 Express API (Jest) — Suggestion Ranking & Ordering

- Most voted sort: suggestions ordered by net score (upvotes - downvotes) descending
- Most voted sort: tie-breaking by createdAt ascending (older first when same score)
- Most voted sort: negative net scores appear last
- Newest sort: ordered by createdAt descending
- Newest sort: suggestions created at same millisecond: stable ordering (by ID)
- Filter + sort: filters applied before sort
- Mixed statuses in results: accepted, planned, completed, rejected all sortable together
- Admin list: pending suggestions sortable by submission date

### 11.54 Express API (Jest) — Comment Pagination & Ordering

- Comments returned in chronological order (oldest first)
- Comments paginated: default page size 20
- Comments paginated: custom page size
- Comments paginated: page 2 returns next set
- Suggestion with 0 comments: empty array returned
- Suggestion with 100+ comments: only first page returned, total count included
- Admin view: private comments interleaved in chronological order

### 11.55 Express API (Jest) — Vote Count Atomicity

- Two concurrent upvotes on same suggestion: both recorded, count = initial + 2
- Upvote + downvote simultaneously: both recorded, net score unchanged
- Vote + toggle rapidly: final state consistent (no lost updates)
- Vote count fields (upvotes/downvotes) always >= 0 (cannot go negative individually)
- Net score calculation: always equals upvotes - downvotes (verified after batch operations)

### 11.56 Express API (Jest) — Tag Management

- Valid tags: only tags from the predefined list accepted
- Invalid tag: returns 400 with "invalid tag" message
- Multiple tags: up to 5 tags per suggestion
- More than 5 tags: returns 400
- Duplicate tags in submission: deduplicated silently
- Filter by tag: only returns suggestions with that tag
- Filter by multiple tags: returns suggestions matching ANY of the tags (OR logic)
- Tag list endpoint: GET /api/suggestions/tags returns available tags

### 11.57 Express API (Jest) — Language Tag Validation

- Valid ISO 639-1 language code: accepted (en, ar, de, etc.)
- Invalid language code (e.g. "xx", "123"): returns 400
- Language code case-insensitive: "EN" treated as "en"
- Missing language: defaults to user's profile language
- User profile has no language: defaults to "en"

### 11.58 Express API (Jest) — Suggestion Text Handling

- HTML in title: stripped (not just escaped — no HTML tags stored)
- HTML in description: stripped
- Markdown in description: stored as-is (plain text, not rendered)
- Newlines in description: preserved
- Leading/trailing whitespace in title: trimmed
- Leading/trailing whitespace in description: trimmed
- Unicode normalization: consistent NFC form stored
- Very long word (no spaces, 80 chars): accepted in title, no overflow in UI
- Description with only URLs: accepted
- Title with only numbers: accepted
- Title with only special characters: rejected (must contain at least one letter)

### 11.59 Express API (Jest) — Admin Search & Duplicate Highlighting

- Admin GET /api/admin/suggestions: includes similarity scores against existing suggestions
- Admin view: pending suggestion with >80% title similarity to existing: flagged as potential duplicate
- Admin view: similarity search ignores case
- Admin view: similarity search ignores punctuation
- Admin view: similarity search works across languages (same concept, different language)
- Admin can see submitter's other suggestions from suggestion detail view

### 11.60 Express API (Jest) — Notification Deduplication

- Same event fired twice (e.g. double webhook): only one notification created
- Roadmap feature updated twice in 1 minute: one notification (debounced)
- User subscribed to both "all updates" and specific feature: receives one notification, not two
- Admin approves then immediately overturns: two separate notifications (different events)

### 11.61 Express API (Jest) — Identity Graph Query Performance

- Ban check by IP: responds within 50ms (indexed query)
- Ban check by fingerprint: responds within 50ms
- Ban check by UID: responds within 50ms
- Graph with 100 identifiers: ban check still within 100ms
- Graph with 500 identifiers: ban check still within 200ms
- Lookup uses denormalized ban index (not scanning full identifier arrays)

### 11.62 Express API (Jest) — Subscription Edge Cases

- User watches same feature twice: idempotent, no duplicate
- User watches 100+ features: all stored, API returns all
- User watches suggestion that gets completed: suggestion removed from watch list after final notification
- User watches suggestion that gets rejected: suggestion removed from watch list after rejection notification
- User watches suggestion that gets merged: watch transferred to original suggestion
- User unsubscribes from all channels for all events: subscription doc preserved (not deleted) with all channels false
- GDPR consent revoked: email channel disabled, consent timestamp cleared

### 11.63 Playwright (Web) — Mobile-Specific Interactions

- Touch: tap vote arrow registers vote
- Touch: long press on suggestion card: no context menu interference
- Touch: swipe on suggestion list: does not interfere with scroll
- Touch: pinch-to-zoom on ring chart: behaves correctly
- Soft keyboard: suggestion form scrolls to keep input visible when keyboard opens
- Soft keyboard: description field doesn't get hidden behind keyboard
- Orientation: landscape mode works without layout breaking
- Orientation: portrait to landscape transition preserves scroll position

### 11.64 Playwright (Web) — Suggestion Card UI States

- Card: default state (no user interaction)
- Card: hovered state (desktop only — subtle highlight)
- Card: user has upvoted (arrow highlighted, count reflects)
- Card: user has downvoted (arrow highlighted, count reflects)
- Card: user is the submitter (shows "Your suggestion" badge)
- Card: accepted status (default card style)
- Card: planned status (accent border, "Planned" badge, vote arrows hidden)
- Card: completed status ("Shipped!" badge, vote arrows hidden, green accent)
- Card: rejected status (dimmed, decline reason expanded, vote arrows hidden)
- Card: merged/duplicate (hidden from public view)
- Card: creator's upvote shown in count but creator sees "Your vote" indicator
- Card: truncated description expands on click
- Card: tags overflow wraps to next line (no horizontal scroll)
- Card: language tag displayed with flag emoji

### 11.65 Playwright (Web) — Admin Panel Identity Graph Visualization

- Graph renders as connected node diagram
- Nodes: account (purple), device (blue), network/IP (green)
- Edges: show connection type (login, cascade)
- Suspended nodes: red border/highlight
- Node click: shows metadata (IP→ISP/country, device→model/OS, account→uniqueId/name)
- Multi-account nodes: warning icon on device node linking multiple accounts
- Graph with 50+ nodes: performant rendering, no browser freeze
- Graph zoom/pan on desktop
- Graph scrollable on mobile
- Empty graph (new user, no identifiers yet): "No identity data yet" message

### 11.66 Playwright (Web) — Token Expiry & Session Handling

- Firebase auth token expires mid-session: auto-refreshed, no user interruption
- Firebase auth token refresh fails: user prompted to re-login
- User signs out: all interactive UI disabled, login prompts shown
- User signs out: local subscription preferences cleared
- User signs in as different account: preferences loaded for new account
- Session persists across page reload
- Multiple tabs: sign out in one tab reflects in other tabs

### 11.67 Playwright (Web) — Filter & Search Combination Edge Cases

- All filters active simultaneously: results match ALL criteria
- Clear all filters: resets to default view (all accepted/planned/completed/rejected)
- Filter produces 0 results: "No suggestions match your filters" message with clear button
- Search + filter: search narrows within filtered results
- Search with 1 character: no search triggered (minimum 2 chars)
- Search with 2 characters: search triggered
- Search debounce: typing fast doesn't fire request per keystroke (300ms debounce)
- Filter state preserved on page reload (URL params or sessionStorage)
- Filter badge counts: show number of active filters

### 11.68 Kotlin (Unit) — Offline Queue & Sync

- Vote while offline: queued locally
- Vote while offline: synced when online, server state updated
- Vote while offline: conflict resolution (server wins if suggestion state changed)
- Comment while offline: queued locally
- Comment while offline: synced when online
- Notification mark-read while offline: queued, synced
- Subscription change while offline: queued, synced
- Multiple queued actions: processed in order on reconnect
- Queue persists across app restart

### 11.69 Kotlin (Unit) — Deep Link Handling

- Notification tap with suggestion ID: opens browser to roadmap page with suggestion anchor
- System message with suggestion link: tappable, opens browser
- App link to roadmap: opens external browser (not in-app WebView)
- Invalid deep link: handled gracefully, no crash

### 11.70 E2E (BDD/Gherkin) — Additional Android Scenarios

- Feature: Identity binding
  - Scenario: User logs in and device info is sent to API
  - Scenario: User switches from Wi-Fi to mobile data and new network info is sent
  - Scenario: User logs in on new device and device added to identity graph

- Feature: Notification display
  - Scenario: User receives roadmap update notification while app is in foreground
  - Scenario: User receives notification while app is in background (system tray)
  - Scenario: User opens notification dropdown and sees unread count decrease as items are read
  - Scenario: User marks all notifications as read

- Feature: Suggestion interaction from app
  - Scenario: User taps roadmap notification and is taken to roadmap webpage
  - Scenario: User receives "suggestion accepted" system message and reads it in inbox

### 11.71 Integration Tests (Express) — Stress & Concurrency Flows

- **High-vote suggestion:** 100 users vote on same suggestion concurrently → final count correct (100 votes)
- **Rapid suggestion creation:** 50 suggestions created by different users within 1 second → all stored, no duplicates, all enter moderation queue
- **Cascade storm:** admin suspends user with 20 linked devices and 30 IPs → all 50 identifiers suspended, audit log has 50 entries, completes within 5 seconds
- **Notification fan-out:** roadmap feature with 1000 subscribers changes status → 1000 notifications created, email/push dispatched in batches, no timeout
- **Concurrent admin actions:** two admins approve and reject same suggestion simultaneously → one succeeds, one gets conflict error, suggestion in consistent state

### 11.72 Express API (Jest) — GDPR Data Export & Account Deletion

**Data export (GET /api/data-export):**
- Export includes user's suggestions (all statuses including pending)
- Export includes user's votes with reasons
- Export includes user's comments
- Export includes user's subscription preferences
- Export includes user's notification history
- Export includes user's identity graph identifiers (IP, device, network)
- Export does NOT include other users' data
- Export does NOT include admin audit log entries about the user

**Account deletion cascade:**
- Delete account: user's pending suggestions withdrawn automatically
- Delete account: user's votes on other suggestions removed, counts updated
- Delete account: user's comments anonymised (author set to "deleted user")
- Delete account: user's subscription doc deleted
- Delete account: user's notifications deleted
- Delete account: user's identity graph preserved (for ban enforcement) but UID marked as deleted
- Delete account: user's accepted/planned suggestions remain (content is public, author anonymised)
- Delete account: user's disputes resolved as abandoned

### 11.73 Express API (Jest) — Vote Reason Validation

- Vote reason max length: 500 characters
- Vote reason exactly 500 chars: accepted
- Vote reason 501 chars: returns 400
- Vote reason with XSS payload: sanitised
- Vote reason with HTML tags: stripped
- Vote reason empty string: treated as null (no reason)
- Vote reason with only whitespace: treated as null
- Vote reason with newlines: preserved
- Vote reason with emoji: stored correctly

### 11.74 Express API (Jest) — Comment Validation & Limits

- Comment max length: 2000 characters
- Comment exactly 2000 chars: accepted
- Comment 2001 chars: returns 400
- Comment with newlines: preserved
- Comment with emoji: stored correctly
- Comment with links/URLs: stored as-is (plain text)
- Comment count returned on suggestion: correct total
- Comments per suggestion: no hard limit (paginated)
- Rapid comment submission (same user, 3 comments in 10s): all accepted (no rate limit on comments)

### 11.75 Express API (Jest) — Suggestion Limits & Abuse Prevention

- Max pending suggestions per user: 10 (prevents queue flooding)
- 11th pending suggestion: returns 429 "You have too many pending suggestions"
- Accepted/planned/completed/rejected suggestions don't count toward limit
- Withdrawn suggestions don't count toward limit
- User with 10 pending edits one: still at 10, allowed (not creating new)

### 11.76 Express API (Jest) — Notification Inbox Management

- Notification inbox: max 200 notifications stored per user
- 201st notification: oldest notification auto-deleted
- Notification TTL: notifications older than 90 days auto-cleaned by cron
- Notification deletion: does not affect subscription preferences
- Unread count: only counts notifications < 90 days old

### 11.77 Express API (Jest) — Audit Log Integrity

- Audit entries: immutable (cannot be updated via API, only created)
- Audit entries: include before/after state for status changes
- Audit entries: cascade events reference parent action ID
- Audit entries: timestamp is server-side (not client-provided)
- Audit log: supports 100,000+ entries without query degradation (paginated)
- Audit log: entries ordered by timestamp descending (newest first)
- Nuclear reset: audit log cleared separately (admin must explicitly choose)

### 11.78 Express API (Jest) — Admin Status Change Notifications

- rejected → accepted: submitter notified "Your suggestion has been reconsidered and accepted"
- accepted → rejected: submitter + subscribers notified "This suggestion has been declined" with reason
- planned → accepted: all subscribers notified "This feature has been moved back to community voting"
- completed → planned: all subscribers notified "This feature is back in planning"
- accepted → planned: all subscribers notified "This suggestion has been added to the roadmap"
- Every admin status change triggers audit log entry with reason field

### 11.79 Express API (Jest) — Blocked Topic Similarity Matching

- Blocked topic check: exact title match blocked
- Blocked topic check: case-insensitive match blocked
- Blocked topic check: high similarity match blocked (>80% similar)
- Blocked topic check: low similarity passes
- Blocked topic check: returns rejection reason from original rejection
- Blocked topic check: returns link to original rejected suggestion
- Blocked topic check: multiple blocked topics can match, all shown to user

### 11.80 Express API (Jest) — Admin Notification of New Suggestions

- New suggestion submitted: admin notification created
- Admin panel: suggestion count badge on Suggestions tab updates in real-time
- Admin panel: pending count shown in tab header
- Admin notification: includes submitter's identity summary

### 11.81 Express API (Jest) — API Structured Logging

- All new routes: log request/response with trace ID
- Suggestion creation: logged with submitter UID and suggestion ID
- Vote: logged with voter UID, suggestion ID, vote direction
- Admin action: logged with admin UID, action type, target
- Ban cascade: logged with trigger event, all affected identifiers
- Error responses: logged with full error details (not exposed to client)
- Log level: info for success, warn for client errors, error for server errors

### 11.82 Express API (Jest) — Health Check Integration

- GET /api/health: includes suggestion system status
- GET /api/health: includes notification dispatch status
- GET /api/health: includes identity graph service status
- Health check: responds within 1 second even under load

### 11.83 Express API (Jest) — Caching & ETags

- GET /api/suggestions: includes ETag header
- GET /api/suggestions: conditional request with If-None-Match returns 304
- GET /api/suggestions/:id: includes ETag
- POST /api/suggestions/:id/vote: invalidates suggestion ETag
- Roadmap data: Cache-Control set for CDN caching (5 minute TTL)

### 11.84 Express API (Jest) — Firestore Transaction Guarantees

- Vote count update: uses Firestore transaction
- Vote count: transaction retries on contention (up to 5 retries)
- Suggestion status transition: uses transaction to prevent race
- Merge duplicate: atomic (remove + transfer vote in single transaction)
- Subscription cleanup on complete: atomic

### 11.85 Express API (Jest) — Graceful Shutdown

- SIGTERM: pending notification dispatch completes before shutdown
- SIGTERM: in-flight API requests complete
- SIGTERM: Firestore connections closed cleanly
- SIGTERM: no orphaned notification jobs

### 11.86 Playwright (Web) — Admin Panel Responsive Design

- Admin suggestions tab: usable on 768px viewport
- Admin suggestions tab: usable on 375px viewport
- Admin identity graph: scrollable on mobile
- Admin audit log: table horizontally scrollable on mobile
- Admin moderation actions: buttons accessible on mobile

### 11.87 Playwright (Web) — Suggestion Description Display

- Plain text with newlines: rendered with line breaks
- Plain text with URLs: displayed as clickable links
- Plain text with very long URL: truncated in display
- Description with 5000 chars: scrollable within card
- Description in RTL language: text aligned right

### 11.88 Playwright (Web) — Notification Timing & Freshness

- "just now": shown for notifications < 1 minute old
- "2 minutes ago": correct relative time
- "1 hour ago": correct
- "Yesterday": shown for 24-48 hours ago
- Relative time updates without page reload (live update every 60s)
- Timestamp: uses user's local timezone

### 11.89 Playwright (Web) — Subscribe Modal GDPR Flow

- Email toggle disabled by default
- GDPR consent checkbox: unchecked by default
- Ticking consent: enables email toggle
- Un-ticking consent: disables email AND unchecks it
- GDPR consent text: translated to current language
- GDPR consent text: links to privacy policy
- Revoking consent: email channel immediately disabled, confirmation toast

### 11.90 Playwright (Web) — Error Recovery & Retry

- Vote fails (network): retry button shown
- Vote retry: resubmits vote
- Suggestion submit fails: form retains input, retry shown
- Subscribe save fails: error toast, modal stays open
- Partial page failure: working sections shown, failed sections show error with retry
- Retry: exponential backoff on repeated failures

### 11.91 Playwright (Web) — Print View

- Print page: roadmap formatted for print (no dark theme)
- Print page: suggestion cards formatted
- Print page: ring chart replaced with text summary
- Print page: no interactive elements in print

### 11.92 Playwright (Admin Panel) — Admin Notifications

- New pending suggestion: badge on Suggestions tab
- Badge count: matches actual pending count
- Badge clears: when admin views pending queue
- Dispute filed: indicator on dispute queue
- Audit log: new entries appear without page refresh

### 11.93 Playwright (Admin Panel) — Bulk Operations

- Bulk select: checkbox on each suggestion card
- Bulk select all: header checkbox selects visible page
- Bulk approve: confirmation dialog, all transitioned
- Bulk reject: confirmation dialog, optional shared reason
- Bulk merge: disabled (must be done individually)
- Bulk action: one audit entry per suggestion
- Bulk action: progress indicator for large batches

### 11.94 Playwright (Admin Panel) — Suggestion History Timeline

- Timeline: created → approved → planned → completed
- Timeline: created → rejected (with reason)
- Timeline: created → merged (with original linked)
- Timeline: created → edited → re-reviewed → approved (edit diff shown)
- Timeline: overturns with admin name and reason
- Timeline entries: include admin name and timestamp
- Timeline: chronological order

### 11.95 Playwright (Admin Panel) — Admin Contact Opt-In Flow

- Shows "Open to contact" indicator when submitter opted in
- Shows "No contact" when submitter did not opt in
- Admin clicks "Contact submitter": shows uniqueId to look up in Users tab
- Contact button disabled when submitter did not opt in

### 11.96 Kotlin (Unit) — Suspension Screen Details

- Shows reason text
- Shows duration remaining (countdown)
- Permanent ban: shows "Permanent" (no countdown)
- Suggestions-only: shows restricted features list
- Multi-account: shows "Multiple accounts detected on same device"
- Sign-out button available
- Cannot navigate away (back button returns to suspension screen)
- Suspension expiry: re-checks on app resume, clears if expired

### 11.97 Kotlin (Unit) — System Message Rendering

- SHYTALK_SYSTEM message: special styling
- "Suggestion submitted" message: includes suggestion title
- "Suggestion accepted" message: includes link/ID
- "Suggestion rejected" message: includes reason if provided
- "Suggestion merged" message: includes link to original
- Not deletable by user (system messages permanent)
- No reply option (one-way)

### 11.98 E2E (BDD/Gherkin) — Suspension Enforcement Scenarios

- Feature: Suspension enforcement
  - Scenario: Fully suspended user cannot open rooms
  - Scenario: Fully suspended user cannot send messages
  - Scenario: Fully suspended user cannot access profile settings
  - Scenario: Suggestions-only suspended user can open rooms normally
  - Scenario: Suspension expires and user regains access without app restart
  - Scenario: User suspended while in a room is kicked

- Feature: Multi-account detection
  - Scenario: Second account login triggers suspension for both accounts
  - Scenario: Suspended user sees multi-account reason

### 11.99 Integration Tests (Express) — Account Lifecycle with Suggestions

- **Account deletion with active suggestion:** accepted suggestion with 50 votes → delete account → suggestion remains (author anonymised) → votes preserved → admin can still manage
- **Account deletion with pending suggestion:** pending → delete account → auto-withdrawn
- **Account deletion with subscriptions:** 10 watched features → delete → all subscriptions removed → no further notifications
- **Suspended user data export:** export includes all user data including suggestions, votes, identity graph
- **Account re-registration:** delete → re-register → new identity graph, no link to old, old suggestions not linked

### 11.100 Integration Tests (Express) — Notification Pipeline End-to-End

- **Email pipeline:** status change → queued → cron picks up → rendered in user's language → Postfix sends → marked as sent
- **Push pipeline:** status change → queued → FCM called → success → marked as sent
- **Push failure:** FCM returns invalid token → token removed → notification failed → retry skipped
- **System message pipeline:** status change → SHYTALK_SYSTEM message created → user sees in inbox
- **Multi-channel:** email + push + in-app enabled → single event → 3 notifications → all dispatched → no duplicates
- **Unsubscribe during dispatch:** user unsubscribes while cron processing → notification skipped (check at send time)

### 11.101 Express API (Jest) — Input Sanitisation & Injection Prevention

- Title with path traversal (`../../etc/passwd`): sanitised, stored as literal text
- Suggestion ID with path traversal (`../admin`): returns 400
- Suggestion ID with NoSQL injection (`{"$gt": ""}`): returns 400
- Vote endpoint with non-string suggestion ID: returns 400
- Comment with script tag: HTML stripped
- Comment with event handler attributes (`onload=`, `onerror=`): stripped
- Vote reason with null bytes: stripped
- Title with zero-width characters (U+200B, U+FEFF): stripped
- Title with RTL override character (U+202E): stripped
- Description with excessive newlines (1000+): capped
- Tags array with 1000 items: returns 400
- Request with prototype pollution (`__proto__`, `constructor`): no effect
- SSRF via description URL: URLs stored as text, never fetched server-side

### 11.102 Express API (Jest) — API Path & Parameter Edge Cases

- GET /api/suggestions/undefined: returns 400
- GET /api/suggestions/null: returns 400
- GET /api/suggestions/ (empty ID): returns 404
- GET /api/suggestions?page=NaN: returns 400
- GET /api/suggestions?page=1.5: returns 400
- GET /api/suggestions?page=9999999: returns empty array
- GET /api/suggestions?status=invalid: returns 400
- GET /api/suggestions?status=pending: returns 403 for non-admin
- GET /api/suggestions/search?q= (empty): returns 400
- GET /api/suggestions/search?q=a (1 char): returns 400
- GET /api/suggestions/search without q param: returns 400
- PUT /api/suggestions/:id with empty body: returns 400
- POST /api/suggestions/:id/vote with no direction: returns 400
- POST /api/suggestions/:id/vote with invalid direction: returns 400
- DELETE /api/suggestions/:id by non-owner non-admin: returns 403

### 11.103 Express API (Jest) — Admin Suggestion Edge Cases (Extended)

- Admin approves suggestion by deleted user: succeeds
- Admin rejects suggestion edited while reviewing: rejection overrides
- Admin links suggestion to non-existent roadmap feature: returns 400
- Admin completes suggestion not linked to roadmap: returns 400
- Admin reject reason > 2000 chars: returns 400
- Admin chain merge: A→B then B→C, A's vote flows to C
- Admin views suggestion with 10,000 votes: responds < 2s
- Admin exports 50,000 audit entries as CSV: succeeds

### 11.104 Express API (Jest) — Identity Graph Edge Cases (Extended)

- Fingerprint collision: two devices, same fingerprint → both in same graph → both banned together
- ISP lookup timeout: graph created with IP, ISP/country null
- ISP lookup error: fallback to IP-only
- IPv6 address: stored and matched correctly
- IPv4-mapped IPv6 (::ffff:1.2.3.4): normalised to IPv4
- Private IP (10.x, 192.168.x, 127.x): not stored in graph
- Graph with 0 identifiers: suspend returns 400
- Graph merge: two graphs share new identifier → merged into one
- Graph merge: inherits stricter suspension level
- Graph split: not supported → endpoint doesn't exist (returns 404)

### 11.105 Express API (Jest) — Creator Restrictions

- Creator cannot upvote own suggestion: returns 403
- Creator cannot downvote own suggestion: returns 403
- Creator cannot remove auto-upvote: returns 403
- Creator CAN comment on own accepted suggestion
- Creator CAN subscribe to own suggestion
- Creator CAN unsubscribe from own suggestion
- Creator CAN edit own pending suggestion
- Creator CAN withdraw own pending suggestion
- Admin who is also creator: same restrictions apply
- Admin CAN vote on suggestions they didn't create

### 11.106 Express API (Jest) — Concurrent Admin Operations (Extended)

- Two admins approve same suggestion: first gets 200, second gets 409
- Admin approves while submitter withdraws: withdrawal wins, admin gets 404
- Admin rejects while submitter edits: last write wins (test both orderings)
- Admin merges while another admin approves: first wins, second gets 409
- Admin suspends user mid-suggestion-creation: creation returns 403
- Admin overturns while another admin views: viewer sees stale data

### 11.107 Playwright (Web) — Incognito & Storage Restrictions

- Incognito mode: page loads without errors
- Incognito mode: localStorage unavailable → language defaults to browser
- Incognito mode: session not persisted across tab close
- Incognito mode: login works via sessionStorage fallback
- Ad blocker: Firebase blocked → graceful degradation, "Login unavailable" message
- Cookies disabled: page loads, login fails with appropriate error

### 11.108 Playwright (Web) — Multiple Tabs & Windows

- Two tabs same user: vote in tab 1, refresh tab 2 → vote reflected
- Two tabs same user: subscribe in tab 1, modal in tab 2 → preferences match
- Two tabs same user: sign out tab 1 → tab 2 detects on next interaction
- Two tabs different users: each maintains own session
- Tab after long idle (>1hr): token auto-refreshes on first interaction

### 11.109 Playwright (Web) — Empty & Extreme States

- Roadmap 0 features: ring chart 0%, "No features yet" message
- Roadmap all features done: ring chart 100%, green colour
- Roadmap 1 feature done: ring chart 100%, single phase
- Suggestions 0 items: "No suggestions yet" message
- Suggestions 1 item: single card correct
- Suggestions 1000 items: pagination, loads < 3s
- Suggestion 0 votes (besides auto): shows score 1
- Suggestion 500 up, 499 down: shows net 1
- Suggestion 0 up, 100 down: shows net -100
- Comments 0: "No comments yet"
- Comments 500: paginated correctly
- Watch list 0 items: "Not watching anything"
- Notification inbox 0: "All caught up!"

### 11.110 Playwright (Web) — URL & Navigation Edge Cases

- /roadmap: loads correctly
- /roadmap/: redirects to /roadmap
- /roadmap?lang=ar: loads in Arabic
- /roadmap#suggestions: scrolls to section
- /roadmap#suggestion-nonexistent: no error, no scroll
- Back button after voting: state preserved
- Forward after back: state restored
- Refresh mid-submission: form cleared, no duplicate
- Section changes update URL hash without reload

### 11.111 Playwright (Web) — Third-Party Script Failure

- Firebase SDK fails: roadmap shows static content, "Service unavailable" banner
- FCM SW fails: push toggle disabled with tooltip
- roadmap-data.json fails: fallback with GitHub link
- Translation JS fails: renders in English, no errors

### 11.112 Kotlin (Unit) — Network Info Collection Edge Cases

- Wi-Fi no internet: type="wifi", IP=null
- Mobile data: ISP from carrier name
- VPN active: reports VPN type (future detection prep)
- Airplane mode: binding skipped
- Network permission denied: graceful fallback, logged
- Rapid switching (Wi-Fi→mobile→Wi-Fi): all logged, latest sent

### 11.113 Kotlin (Unit) — Notification Action Handling

- Tap (foreground): navigates to relevant screen
- Tap (background): opens app, navigates
- Tap (killed): cold start, navigates
- Tap roadmap notification: opens browser to roadmap
- Tap suggestion notification: opens browser to roadmap#suggestion-{id}
- Tap system message: opens SHYTALK_SYSTEM conversation
- Dismiss from tray: in-app state unchanged (still unread)
- Tap expired suggestion notification: "No longer available" message

### 11.114 E2E (BDD/Gherkin) — Account Deletion Scenarios

- Feature: Account deletion with suggestions
  - Scenario: Pending suggestion withdrawn on account deletion
  - Scenario: Accepted suggestion remains, author shows "Deleted User"
  - Scenario: Votes removed, counts updated on deletion
  - Scenario: Subscriptions removed, no further notifications

### 11.115 Integration Tests (Express) — Error Recovery Flows

- **Partial cascade:** 15 of 20 identifiers suspended → error on 16th → logged → retry completes remaining
- **Cron crash mid-batch:** 50 of 100 sent → crash → restart → remaining 50 processed, no duplicates
- **Merge during voting:** suggestion merged → voters redirected to original → no votes lost
- **Status change during render:** stale view → next interaction refreshes → correct state

### 11.116 Integration Tests (Express) — Cross-Feature Interactions

- **Suggestion + Roadmap:** suggestion linked to feature → roadmap shows count → feature change notifies suggestion subscribers
- **Ban + Suggestion:** banned user's suggestions remain → voting removed → unbanned restores voting
- **Subscription + Deletion:** user A watches user B's suggestion → B deletes account → suggestion remains → A still notified on status change
- **Multi-account + Suggestion:** user A submits → user B (same device) votes → multi-account detected → both suspended → suggestion remains for admin
- **GDPR + Suggestions:** export includes suggestions, votes, comments, subscriptions, identity data

---

## 12. Future Work (Out of Scope)

- Contact form (private feedback to admin panel) — separate feature
- Contact support page for suspended users
- Admin panel restructure (index.html is very large)
- **Cross-device E2E testing (HIGH PRIORITY):** Comprehensive test suite where admin actions (suspension, moderation, ban cascade) are performed in the admin panel and verified in the app on a real/emulated device. Proves the full pipeline: admin suspends user → app reflects suspension → linked devices blocked → unsuspend restores access. Requires planning and discussion.
