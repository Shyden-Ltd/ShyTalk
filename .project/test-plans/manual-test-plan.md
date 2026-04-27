# ShyTalk Manual QA Test Plan

**Last updated:** 2026-04-27
**Total test cases:** 293
**Test approach:** Action-based functional tests covering every screen, sub-page, interactive element, user role, platform, viewport, locale, state, accessibility dimension, and cross-platform integration flow.

## Coverage Checklist
- [x] App -- Splash / Fun Fact screen
- [x] App -- Auth (Email OTP, PIN setup, Lock screen, Biometric)
- [x] App -- Legal Acceptance screen
- [x] App -- Profile Setup screen
- [x] App -- Required DOB screen
- [x] App -- Warning screen
- [x] App -- Main screen (Bottom nav, FABs, top bar)
- [x] App -- Home / Room list (banner carousel, pull-to-refresh, create room, replace room)
- [x] App -- Room screen (seats, chat, voice, toolbar, gifts, gacha, daily reward, backpack, PM sheet)
- [x] App -- Room settings sheet (lock seating, seat count, self-destruct, close room)
- [x] App -- Room components (participant list, user card, seat actions, expiry upsell, closed summary)
- [x] App -- Profile screen (own: edit, tabs, cover photo, gift wall, backpack; other: follow, block, report, DM)
- [x] App -- Follow list screen
- [x] App -- Messaging -- Conversation list (search, delete, context menu)
- [x] App -- Messaging -- Private chat (send text, images, stickers, reactions, edit, self-destruct, read receipts)
- [x] App -- Messaging -- Group chat (create, settings, members, admin actions)
- [x] App -- Messaging -- New message screen
- [x] App -- Messaging -- Report review screen
- [x] App -- Wallet screen (coin balance, packages, transaction history)
- [x] App -- Super Shy subscription (bottom sheet, trial, purchase)
- [x] App -- Gacha / Lucky Spin (overlay, wheel, summary, confetti, tiers)
- [x] App -- Daily Reward (calendar dialog, streak, claim)
- [x] App -- Settings -- Main (menu items, language picker, sign out)
- [x] App -- Settings -- Blocked Users
- [x] App -- Settings -- Account (linked accounts, delete account, data export)
- [x] App -- Settings -- Privacy (hide following, hide online, hide age, PM privacy)
- [x] App -- Settings -- Notifications (PM notifications, sound, preview, timestamps, DND, self-destruct alert)
- [x] App -- Settings -- Permissions
- [x] App -- Settings -- About (legal links, check for updates, clear cache)
- [x] App -- Settings -- Security (app lock, biometric, timeout, reset PIN)
- [x] App -- Legal pages (Privacy Policy, Community Standards, Terms, Cyber Bullying Policy)
- [x] Web -- Landing Page (index.html)
- [x] Web -- Roadmap Page (roadmap.html) -- phases, voting, suggestions, subscribe, comments
- [x] Web -- Portal (portal/index.html) -- login, dashboard, profile, security, data export
- [x] Web -- Admin Panel -- all 15 tabs (users, reports, appeals, devices, banners, gifts, economy, fun facts, logs, audit log, maintenance, suggestions, spin monitor, starting screens, backups)
- [x] Web -- Legal Pages (privacy, terms, community-guidelines, cyber-bullying)
- [x] Cross-Platform -- Admin action to app verification
- [x] Cross-Platform -- Web to Firestore data flows
- [x] Viewports (320px, 375px, 768px, 1024px, 1920px)
- [x] Locale spot-checks (English, Arabic RTL, Chinese, Khmer)
- [x] State coverage (empty, first-time, loaded, error, loading, offline, degraded)
- [x] Accessibility (keyboard nav, screen reader, contrast, touch targets)
- [x] User roles (owner, host, regular, suspended, banned, no-account)
- [x] Suspension cascade matrix (owner→close, host→demote, seated→clear, visitor→remove, multi-room)
- [x] Warning behaviour matrix (room state preserved for every role)
- [x] Host action permissions on full 8-seat room (kick, remove-from-seat, force-mute, take-seat, invite)

## Environment Prerequisites
- Docker Desktop running
- `bash local/start.sh` (Firebase Emulators + LiveKit + MinIO + Mailpit)
- `cd express-api && npm run local` (Express API on :3000)
- `npx serve public -l 8888` (static pages on :8888)
- `node local/seed.js` (seed comprehensive test data)
- Verify: `curl http://localhost:3000/api/health` returns 200
- Verify: `curl http://localhost:4000` returns Firebase Emulator UI

## Seeded Test Accounts
| Email | Password | Role | UniqueID |
|-------|----------|------|----------|
| claude-test@shytalk.dev | localdev123 | ADMIN | 100000001 |
| user@test.com | localdev123 | MEMBER | 100000002 |
| host@test.com | localdev123 | MC_HOST | 100000003 |
| alice@test.com | localdev123 | MEMBER | 100000004 |
| bob@test.com | localdev123 | MEMBER | 100000005 |
| suspended@test.com | localdev123 | MEMBER (suspended) | 100000006 |

## Seeded Data Summary
- 6 users with profiles, follower/following relationships, profile photos
- 3 voice rooms (2 active, 1 inactive) with 6 room messages
- 2 conversations with private messages
- Gifts, backpack items, economy config
- Banners, fun facts, starting screens

---

## 1. Splash / Fun Fact Screen

### TC-001: Splash screen displays on cold start
- **Area**: Splash
- **Platform**: All
- **Steps**: 1. Kill the app completely. 2. Open the app from launcher. 3. Observe the splash screen.
- **Expected**: ShyTalk title text appears with a fun fact subtitle or tagline. "Continue" button shows as disabled with "Getting ready..." text until warm-up completes, then becomes enabled with "Continue" text.
- **Priority**: P0

### TC-002: Fun fact rotates on cold start
- **Area**: Splash
- **Platform**: All
- **Steps**: 1. Kill and reopen the app 5 times. 2. Note the subtitle text each time.
- **Expected**: At least 2 different fun fact texts appear across 5 launches (random selection from server-fetched fun facts).
- **Priority**: P2

### TC-003: Splash continue navigates to auth
- **Area**: Splash
- **Platform**: All
- **Steps**: 1. Open the app (first install, no stored credential). 2. Wait for "Continue" to enable. 3. Tap "Continue".
- **Expected**: Navigates to the email OTP auth screen.
- **Priority**: P0

---

## 2. Authentication

### TC-004: Email OTP -- valid email sends OTP
- **Area**: Auth
- **Platform**: All
- **Steps**: 1. On the auth screen, enter a valid email. 2. Tap "Send OTP" / submit.
- **Expected**: Loading indicator appears. Success state shows "Check your email" message. Email is received in Mailpit (localhost:8025).
- **Priority**: P0

### TC-005: Email OTP -- disposable email rejected
- **Area**: Auth
- **Platform**: All
- **Steps**: 1. Enter an email with a disposable domain (e.g. user@mailinator.com). 2. Tap send.
- **Expected**: Error message shown: disposable emails are not allowed.
- **Priority**: P1

### TC-006: Email OTP -- invalid email format rejected
- **Area**: Auth
- **Platform**: All
- **Steps**: 1. Enter "notanemail". 2. Tap send.
- **Expected**: Form validation prevents submission or shows inline error.
- **Priority**: P1

### TC-007: PIN setup -- first-time user creates PIN
- **Area**: Auth / PIN Setup
- **Platform**: All
- **Steps**: 1. Complete email OTP for a new user. 2. PIN setup screen appears. 3. Enter a 4-8 digit PIN. 4. Confirm the same PIN.
- **Expected**: PIN is stored securely. User proceeds to legal acceptance.
- **Priority**: P0

### TC-008: PIN setup -- mismatched confirmation
- **Area**: Auth / PIN Setup
- **Platform**: All
- **Steps**: 1. Enter PIN "1234". 2. Enter confirmation "5678".
- **Expected**: Error message displayed, PIN dots reset, user can retry.
- **Priority**: P1

### TC-009: Lock screen -- correct PIN unlocks
- **Area**: Auth / Lock Screen
- **Platform**: All
- **Steps**: 1. With app lock enabled, kill and reopen the app. 2. Lock screen appears with PIN keypad. 3. Enter the correct PIN. 4. Tap "Unlock".
- **Expected**: App unlocks and navigates to the main screen.
- **Priority**: P0

### TC-010: Lock screen -- wrong PIN shows error
- **Area**: Auth / Lock Screen
- **Platform**: All
- **Steps**: 1. On lock screen, enter wrong PIN. 2. Tap "Unlock".
- **Expected**: Error text appears (e.g., "Incorrect PIN"). PIN dots reset. Remaining attempts shown if applicable.
- **Priority**: P0

### TC-011: Lock screen -- lockout after max attempts
- **Area**: Auth / Lock Screen
- **Platform**: All
- **Steps**: 1. Enter wrong PIN repeatedly until lockout.
- **Expected**: Account locked message appears. "PIN locked, re-authenticate" text shown. Keypad is hidden. User must re-authenticate with email.
- **Priority**: P0

### TC-012: Lock screen -- biometric unlock (Android)
- **Area**: Auth / Lock Screen
- **Platform**: Android
- **Steps**: 1. Enable biometric in security settings. 2. Kill and reopen the app. 3. Biometric prompt appears automatically.
- **Expected**: Successful fingerprint/face unlocks the app directly without PIN entry.
- **Priority**: P1

### TC-013: Auth -- suspended user sees suspension screen
- **Area**: Auth
- **Platform**: All
- **Steps**: 1. Log in as suspended@test.com.
- **Expected**: Suspension screen shown with reason, end date, and appeal option (if canAppeal is true). User cannot proceed to main app.
- **Priority**: P0

### TC-014: Auth -- device-banned user blocked
- **Area**: Auth
- **Platform**: All
- **Steps**: 1. Ban the device via admin panel. 2. Try to open the app on that device.
- **Expected**: Device ban screen shown with reason. No access to any app feature.
- **Priority**: P0

### TC-015: Auth -- backend unreachable shows error
- **Area**: Auth
- **Platform**: All
- **Steps**: 1. Stop the Express API server. 2. Try to authenticate.
- **Expected**: "Backend unreachable" error displayed. User cannot proceed.
- **Priority**: P1

---

## 3. Legal Acceptance

### TC-016: Legal acceptance -- all checkboxes required
- **Area**: Legal
- **Platform**: All
- **Steps**: 1. On legal acceptance screen with no checkboxes checked. 2. Observe "Accept All and Continue" button.
- **Expected**: Button is disabled when any checkbox is unchecked.
- **Priority**: P0

### TC-017: Legal acceptance -- view each document
- **Area**: Legal
- **Platform**: All
- **Steps**: 1. Tap each document link: Privacy Policy, Community Standards, Terms & Conditions, Cyber Bullying Policy.
- **Expected**: Each document opens in an in-app WebView or browser. Content is readable and scrollable.
- **Priority**: P1

### TC-018: Legal acceptance -- all checked enables continue
- **Area**: Legal
- **Platform**: All
- **Steps**: 1. Check all four checkboxes. 2. Tap "Accept All and Continue".
- **Expected**: User proceeds to profile setup (new user) or main screen (returning user with updated legal version).
- **Priority**: P0

---

## 4. Profile Setup / Required DOB

### TC-019: Profile setup -- display name required
- **Area**: Profile Setup
- **Platform**: All
- **Steps**: 1. Leave display name empty. 2. Observe continue button.
- **Expected**: Continue button is disabled.
- **Priority**: P0

### TC-020: Profile setup -- display name max 20 characters
- **Area**: Profile Setup
- **Platform**: All
- **Steps**: 1. Type 25 characters into display name field.
- **Expected**: Only 20 characters are accepted. Counter shows "20/20".
- **Priority**: P1

### TC-021: Profile setup -- DOB selection via date picker
- **Area**: Profile Setup
- **Platform**: All
- **Steps**: 1. Tap "Select Date of Birth" button. 2. Date picker dialog opens. 3. Select a valid date (user at least 13 years old).
- **Expected**: Date appears on the button. No error shown. Continue button becomes enabled.
- **Priority**: P0

### TC-022: Profile setup -- underage DOB rejected
- **Area**: Profile Setup
- **Platform**: All
- **Steps**: 1. Select a date of birth making the user younger than 13.
- **Expected**: Error text appears below the date button (e.g., age validation error). Continue button remains disabled.
- **Priority**: P0

### TC-023: Profile setup -- successful submission
- **Area**: Profile Setup
- **Platform**: All
- **Steps**: 1. Enter valid display name "TestUser". 2. Select valid DOB. 3. Tap "Continue".
- **Expected**: Loading indicator on button. Profile saved. User navigates to the main screen.
- **Priority**: P0

### TC-024: Required DOB -- existing user without DOB
- **Area**: Required DOB
- **Platform**: All
- **Steps**: 1. Log in as a user who has a profile but no DOB set.
- **Expected**: Required DOB screen appears with "One more step" title. User must select DOB before continuing.
- **Priority**: P1

---

## 5. Warning Screen

### TC-025: Warning screen displays with reason
- **Area**: Warning
- **Platform**: All
- **Steps**: 1. Issue a warning to a user via admin panel with reason "Spam". 2. Open the app as that user.
- **Expected**: Warning screen appears with police duck image, "Official Warning" title, reason text mentioning "Spam", consequence text, "View Community Standards" link, and "I Understand and Accept" button. Emergency tone plays.
- **Priority**: P0

### TC-026: Warning screen -- accept dismisses warning
- **Area**: Warning
- **Platform**: All
- **Steps**: 1. On warning screen, tap "I Understand and Accept".
- **Expected**: Warning is acknowledged. User proceeds to the main screen. Warning does not reappear on next launch.
- **Priority**: P0

### TC-027: Warning screen -- community standards link
- **Area**: Warning
- **Platform**: All
- **Steps**: 1. On warning screen, tap "View Community Standards".
- **Expected**: Community standards document opens. Back navigation returns to warning screen.
- **Priority**: P1

### TC-028: Warning screen -- no reason shows generic text
- **Area**: Warning
- **Platform**: All
- **Steps**: 1. Issue a warning with reason null or "other".
- **Expected**: Generic warning text displayed without specific reason.
- **Priority**: P2

---

## 6. Main Screen / Bottom Navigation

### TC-029: Bottom nav -- Rooms tab selected by default
- **Area**: Main
- **Platform**: All
- **Steps**: 1. Open the app and log in.
- **Expected**: Bottom navigation shows 3 tabs: Rooms, Messages, Profile. Rooms tab is selected. Top bar title says "Rooms".
- **Priority**: P0

### TC-030: Bottom nav -- switch to Messages tab
- **Area**: Main
- **Platform**: All
- **Steps**: 1. Tap the Messages tab in bottom nav.
- **Expected**: Messages tab selected. Top bar title changes to "Messages". Conversation list content loads. New message FAB appears.
- **Priority**: P0

### TC-031: Bottom nav -- switch to Profile tab
- **Area**: Main
- **Platform**: All
- **Steps**: 1. Tap the Profile tab in bottom nav.
- **Expected**: Profile tab selected. Top bar title changes to "Profile". Settings gear icon appears in top bar actions. Own profile content loads.
- **Priority**: P0

### TC-032: Bottom nav -- unread badge on Messages
- **Area**: Main
- **Platform**: All
- **Steps**: 1. Send a PM to the test user from another account. 2. Observe the Messages tab icon.
- **Expected**: Badge appears on Messages tab showing unread count. Shows "99+" if count exceeds 99.
- **Priority**: P1

### TC-033: Create room FAB -- visible on Rooms tab only
- **Area**: Main
- **Platform**: All
- **Steps**: 1. On Rooms tab, observe FAB. 2. Switch to Messages tab. 3. Switch to Profile tab.
- **Expected**: Create room FAB (+) visible on Rooms. New message FAB visible on Messages. No FAB on Profile.
- **Priority**: P1

### TC-034: Settings gear -- navigates to settings
- **Area**: Main
- **Platform**: All
- **Steps**: 1. Switch to Profile tab. 2. Tap the settings gear icon in top bar.
- **Expected**: Navigates to the Settings screen.
- **Priority**: P0

### TC-035: Degraded mode banner
- **Area**: Main
- **Platform**: All
- **Steps**: 1. Simulate backend degraded state. 2. Observe main screen.
- **Expected**: Degraded mode banner appears above the content area.
- **Priority**: P1

---

## 7. Home / Room List

### TC-036: Room list -- displays active rooms
- **Area**: Home
- **Platform**: All
- **Steps**: 1. Ensure seeded rooms exist. 2. Open Rooms tab.
- **Expected**: Room cards display with name, seat count (e.g., "2/8 seats"), participant count, nationality flags, and seated user photos.
- **Priority**: P0

### TC-037: Room list -- empty state
- **Area**: Home
- **Platform**: All
- **Steps**: 1. Delete all rooms. 2. Pull to refresh.
- **Expected**: Empty state shows "No active rooms" with "Tap + to create one" subtitle. Scrollable for pull-to-refresh to work.
- **Priority**: P1

### TC-038: Room list -- pull to refresh
- **Area**: Home
- **Platform**: All
- **Steps**: 1. Pull down on the room list.
- **Expected**: Refresh indicator appears. Room list reloads with latest data.
- **Priority**: P1

### TC-039: Room list -- tap room navigates to room
- **Area**: Home
- **Platform**: All
- **Steps**: 1. Tap a room card.
- **Expected**: Navigates to the room screen with that room's ID loaded.
- **Priority**: P0

### TC-040: Room list -- closed room shows visitor count
- **Area**: Home
- **Platform**: All
- **Steps**: 1. Close a room. 2. Return to room list.
- **Expected**: Closed room card shows "X speakers, Y seats" and "Z visitors" instead of "in room" count.
- **Priority**: P2

### TC-041: Banner carousel -- displays and clicks
- **Area**: Home
- **Platform**: All
- **Steps**: 1. Create a banner via admin panel. 2. Observe room list.
- **Expected**: Banner carousel appears above room list with banner image (160dp height, rounded corners). Tapping a banner triggers the configured action (URL, ROOM, SCREEN, or NONE).
- **Priority**: P1

### TC-042: Create room dialog -- opens from FAB
- **Area**: Home
- **Platform**: All
- **Steps**: 1. Tap the + FAB on Rooms tab.
- **Expected**: Create Room dialog appears with title "Create Room", room name text field, Cancel and Create buttons.
- **Priority**: P0

### TC-043: Create room dialog -- name validation
- **Area**: Home
- **Platform**: All
- **Steps**: 1. Open create room dialog. 2. Leave name empty. 3. Observe Create button.
- **Expected**: Create button is disabled when name is blank.
- **Priority**: P1

### TC-044: Create room dialog -- max 50 characters
- **Area**: Home
- **Platform**: All
- **Steps**: 1. Type 55 characters into room name field.
- **Expected**: Only 50 characters accepted.
- **Priority**: P2

### TC-045: Create room -- successful creation
- **Area**: Home
- **Platform**: All
- **Steps**: 1. Enter "My Test Room" in create dialog. 2. Tap Create.
- **Expected**: Dialog closes. Loading state shows. User navigates to the newly created room automatically.
- **Priority**: P0

### TC-046: Replace room confirmation
- **Area**: Home
- **Platform**: All
- **Steps**: 1. User already owns an active room. 2. Attempt to create a new room.
- **Expected**: Replace room confirmation dialog appears with title, message, and Confirm/Cancel buttons. Confirming replaces the existing room.
- **Priority**: P1

---

## 8. Room Screen

### TC-047: Room screen -- joins and displays room
- **Area**: Room
- **Platform**: All
- **Steps**: 1. Navigate to an active room.
- **Expected**: Room loads with toolbar (room name, settings, participant count), seat grid, chat panel, and action carousel. Microphone permission requested. Keep screen on activated.
- **Priority**: P0

### TC-048: Room screen -- seat grid shows occupied/empty seats
- **Area**: Room
- **Platform**: All
- **Steps**: 1. Enter a room with some occupied and some empty seats.
- **Expected**: Occupied seats show user avatar/name. Empty seats show placeholder. Seat 0 is always the owner seat.
- **Priority**: P0

### TC-049: Room screen -- tap seat to sit/unsit
- **Area**: Room
- **Platform**: All
- **Steps**: 1. Tap an empty seat as a regular user. 2. Tap your own occupied seat.
- **Expected**: Sitting: seat updates to show your avatar. Unsitting: seat returns to empty. Seat action feedback shown.
- **Priority**: P0

### TC-050: Room screen -- owner seat actions (kick, mute, ban)
- **Area**: Room
- **Platform**: All
- **Steps**: 1. As room owner, tap an occupied seat of another user. 2. User card popup appears.
- **Expected**: User card shows kick, mute, ban options. Executing each triggers the corresponding action with confirmation.
- **Priority**: P0

### TC-051: Room screen -- mute/unmute microphone
- **Area**: Room
- **Platform**: All
- **Steps**: 1. Join a room and sit in a seat. 2. Toggle mute in the action carousel.
- **Expected**: Mute icon appears on your seat. Other users see the muted indicator. Audio is not transmitted.
- **Priority**: P0

### TC-052: Room screen -- chat panel send message
- **Area**: Room
- **Platform**: All
- **Steps**: 1. Type a message in the room chat input. 2. Tap send.
- **Expected**: Message appears in the chat panel with your name, timestamp, and message text.
- **Priority**: P0

### TC-053: Room screen -- chat panel scroll
- **Area**: Room
- **Platform**: All
- **Steps**: 1. Send 20+ messages in room chat. 2. Scroll up and down.
- **Expected**: Chat scrolls smoothly. New messages auto-scroll to bottom unless user has scrolled up.
- **Priority**: P1

### TC-054: Room toolbar -- room name and participant count
- **Area**: Room
- **Platform**: All
- **Steps**: 1. Enter a room with 3 participants.
- **Expected**: Toolbar shows room name (truncated if too long) and participant count icon.
- **Priority**: P1

### TC-055: Room toolbar -- settings gear (owner only)
- **Area**: Room
- **Platform**: All
- **Steps**: 1. As room owner, tap settings icon in toolbar.
- **Expected**: Room settings bottom sheet opens.
- **Priority**: P0

### TC-056: Room toolbar -- participant list panel
- **Area**: Room
- **Platform**: All
- **Steps**: 1. Tap participant count in toolbar.
- **Expected**: Participant list panel slides in showing voice users (seated) and listeners (not seated), sorted by role then name.
- **Priority**: P1

### TC-057: Room screen -- user card popup from seat tap
- **Area**: Room
- **Platform**: All
- **Steps**: 1. Tap on an occupied seat.
- **Expected**: User card popup shows profile photo, display name, follow button, DM button, report button. Tapping profile photo navigates to full profile.
- **Priority**: P0

### TC-058: Room screen -- gift sending from user card
- **Area**: Room
- **Platform**: All
- **Steps**: 1. Open user card for another user. 2. Tap gift icon. 3. Backpack sheet opens. 4. Select a gift and send.
- **Expected**: Gift sent. Gift animation plays (for rare+ gifts). Broadcast banner slides in showing "X sent Y to Z". Coin balance deducted.
- **Priority**: P1

### TC-059: Room screen -- gift effect overlay
- **Area**: Room
- **Platform**: All
- **Steps**: 1. Send a rare or higher gift to another user in the room.
- **Expected**: Full-screen gift effect animation plays over the room UI.
- **Priority**: P2

### TC-060: Room screen -- broadcast banner
- **Area**: Room
- **Platform**: All
- **Steps**: 1. A high-value gift is sent in any room.
- **Expected**: Broadcast banner slides in showing the gift send event with sender name, recipient name, gift name, and coin value.
- **Priority**: P2

### TC-061: Room screen -- kicked user dialog
- **Area**: Room
- **Platform**: All
- **Steps**: 1. As room owner, kick a user from the room. 2. Observe the kicked user's screen.
- **Expected**: Kicked user sees "Removed from room" dialog with kicker name (if available) and reason. Only "OK" button dismisses and navigates back.
- **Priority**: P0

### TC-062: Room screen -- banned user blocked from re-entry
- **Area**: Room
- **Platform**: All
- **Steps**: 1. Ban a user from a room. 2. That user tries to enter the room again.
- **Expected**: "Banned from room" dialog appears. User cannot enter. No "Enter anyway" option.
- **Priority**: P0

### TC-063: Room screen -- blocked user in room warning
- **Area**: Room
- **Platform**: All
- **Steps**: 1. Block user A. 2. Enter a room where user A is present.
- **Expected**: Warning dialog: "A user you blocked is in this room". Options: "Enter" (proceed anyway) or "Choose another room" (go back).
- **Priority**: P1

### TC-064: Room screen -- blocked by room owner
- **Area**: Room
- **Platform**: All
- **Steps**: 1. Room owner blocks you. 2. Try to enter that room.
- **Expected**: "Cannot enter room" dialog. "Not allowed to enter" message. Only "Go back" button.
- **Priority**: P1

### TC-065: Room screen -- gacha wheel opens from action carousel
- **Area**: Room
- **Platform**: All
- **Steps**: 1. Tap the Lucky Spin button in action carousel.
- **Expected**: Lucky Spin overlay appears with wheel, spin count selector, cost display, and Spin button.
- **Priority**: P1

### TC-066: Room screen -- daily reward dialog
- **Area**: Room
- **Platform**: All
- **Steps**: 1. Tap the Daily Reward button in action carousel.
- **Expected**: Daily reward dialog opens showing calendar grid for current month, claimed days highlighted, today's reward available.
- **Priority**: P1

### TC-067: Room screen -- PM sheet opens
- **Area**: Room
- **Platform**: All
- **Steps**: 1. Tap the PM/message icon in action carousel.
- **Expected**: PM bottom sheet opens with conversation list. Can search, open, and send messages without leaving the room.
- **Priority**: P1

### TC-068: Room screen -- backpack sheet
- **Area**: Room
- **Platform**: All
- **Steps**: 1. Open backpack from action carousel or user card. 2. View gifts in backpack.
- **Expected**: Backpack sheet shows owned gifts in a grid. Tapping a gift shows preview popup with Send option.
- **Priority**: P1

### TC-069: Room screen -- self-destruct countdown
- **Area**: Room
- **Platform**: All
- **Steps**: 1. Owner leaves the room. 2. Wait until self-destruct countdown begins (owner away timer).
- **Expected**: Owner away banner shows countdown. If self-destruct alert is enabled, TTS announces "Room self destruct sequence activated".
- **Priority**: P1

### TC-070: Room screen -- room closed summary
- **Area**: Room
- **Platform**: All
- **Steps**: 1. Room owner closes the room while you are in it.
- **Expected**: Room closed summary panel appears showing room stats (duration, participant count, messages).
- **Priority**: P1

### TC-071: Room screen -- degraded mode banner
- **Area**: Room
- **Platform**: All
- **Steps**: 1. Enter a room while backend is degraded.
- **Expected**: Degraded mode banner appears at top. When service restores, snackbar shows "Service restored -- close this room and open a new one for full functionality".
- **Priority**: P1

### TC-072: Room screen -- rename room (owner)
- **Area**: Room
- **Platform**: All
- **Steps**: 1. As owner, tap room name in toolbar. 2. Edit room name dialog appears. 3. Enter new name. 4. Submit.
- **Expected**: Room name updates in toolbar and on room list for all participants.
- **Priority**: P2

### TC-073: Room screen -- seasonal background
- **Area**: Room
- **Platform**: All
- **Steps**: 1. During an active seasonal event, enter a room.
- **Expected**: Seasonal background (starfield or themed) renders behind the room UI.
- **Priority**: P2

---

## 9. Room Settings Sheet

### TC-074: Room settings -- lock seating toggle
- **Area**: Room Settings
- **Platform**: All
- **Steps**: 1. As owner, open room settings. 2. Toggle "Lock Seating".
- **Expected**: When locked, non-owner users cannot sit in seats. Toggle state persists.
- **Priority**: P1

### TC-075: Room settings -- seat count slider
- **Area**: Room Settings
- **Platform**: All
- **Steps**: 1. Adjust seat count slider.
- **Expected**: Seat grid updates to show the new number of seats. Existing seated users are not displaced.
- **Priority**: P1

### TC-076: Room settings -- close room
- **Area**: Room Settings
- **Platform**: All
- **Steps**: 1. Tap "Close Room" button. 2. Confirm.
- **Expected**: Room transitions to CLOSED state. All participants see the closed summary. Room appears as closed on the home screen.
- **Priority**: P0

---

## 10. Profile Screen

### TC-077: Own profile -- displays all info
- **Area**: Profile
- **Platform**: All
- **Steps**: 1. Navigate to own profile (Profile tab).
- **Expected**: Shows profile photo, cover photo, display name (styled), unique ID, nationality flag, age, description, follower/following counts, online status indicator, wallet button, settings button.
- **Priority**: P0

### TC-078: Own profile -- edit mode
- **Area**: Profile
- **Platform**: All
- **Steps**: 1. Tap edit button on own profile.
- **Expected**: Edit mode activates. Display name becomes editable text field. Description becomes editable. Country picker button appears. Camera icons appear on profile and cover photos. Save button appears.
- **Priority**: P0

### TC-079: Own profile -- save edits
- **Area**: Profile
- **Platform**: All
- **Steps**: 1. Enter edit mode. 2. Change display name to "NewName". 3. Change description. 4. Tap Save.
- **Expected**: Profile updates. Edit mode exits. New values visible.
- **Priority**: P0

### TC-080: Own profile -- upload profile photo
- **Area**: Profile
- **Platform**: All
- **Steps**: 1. Enter edit mode. 2. Tap camera icon on profile photo. 3. Select an image.
- **Expected**: Photo uploads and profile photo updates.
- **Priority**: P1

### TC-081: Own profile -- upload cover photo
- **Area**: Profile
- **Platform**: All
- **Steps**: 1. Enter edit mode. 2. Tap camera icon on cover photo. 3. Select an image.
- **Expected**: Cover photo uploads and updates.
- **Priority**: P1

### TC-082: Own profile -- country picker
- **Area**: Profile
- **Platform**: All
- **Steps**: 1. Enter edit mode. 2. Tap country selector. 3. Country picker dialog opens. 4. Search for "Japan". 5. Select it.
- **Expected**: Country picker shows searchable list of countries. Selected country code saved. Flag emoji updates on profile.
- **Priority**: P1

### TC-083: Own profile -- tabs (Gift Wall, Backpack)
- **Area**: Profile
- **Platform**: All
- **Steps**: 1. On own profile, observe tabs. 2. Switch between tabs.
- **Expected**: Profile has Gift Wall tab and Backpack tab. Gift Wall shows received gifts. Backpack shows owned items in a grid.
- **Priority**: P1

### TC-084: Own profile -- gift wall display
- **Area**: Profile
- **Platform**: All
- **Steps**: 1. Receive a gift from another user. 2. Open Gift Wall tab.
- **Expected**: Gift appears in the wall with gift name and count.
- **Priority**: P1

### TC-085: Own profile -- follower/following counts clickable
- **Area**: Profile
- **Platform**: All
- **Steps**: 1. Tap follower count. 2. Tap following count.
- **Expected**: Each navigates to the Follow List screen filtered by "followers" or "following" respectively.
- **Priority**: P1

### TC-086: Own profile -- Super Shy subscription
- **Area**: Profile
- **Platform**: All
- **Steps**: 1. On own profile, observe Super Shy badge or upsell area. 2. Tap it.
- **Expected**: Super Shy bottom sheet opens showing subscription plans, benefits, trial option, and purchase button.
- **Priority**: P1

### TC-087: Own profile -- wallet button
- **Area**: Profile
- **Platform**: All
- **Steps**: 1. Tap wallet icon on own profile.
- **Expected**: Navigates to the Wallet screen.
- **Priority**: P1

### TC-088: Own profile -- fullscreen photo viewer
- **Area**: Profile
- **Platform**: All
- **Steps**: 1. Tap on profile photo (not in edit mode).
- **Expected**: Fullscreen photo viewer opens with black overlay. Close button (X) in top-right. Tapping background dismisses.
- **Priority**: P2

### TC-089: Own profile -- pull to refresh
- **Area**: Profile
- **Platform**: All
- **Steps**: 1. Pull down on own profile.
- **Expected**: Profile data reloads from server.
- **Priority**: P2

### TC-090: Other user profile -- follow/unfollow
- **Area**: Profile
- **Platform**: All
- **Steps**: 1. Navigate to another user's profile. 2. Tap Follow button. 3. Tap Unfollow button.
- **Expected**: Follow: button changes to "Following", follower count increments. Unfollow: button changes to "Follow", follower count decrements.
- **Priority**: P0

### TC-091: Other user profile -- block user
- **Area**: Profile
- **Platform**: All
- **Steps**: 1. On another user's profile, tap Block. 2. Confirmation dialog appears. 3. Confirm.
- **Expected**: User is blocked. Block button changes to "Unblock". Blocked user's messages hidden.
- **Priority**: P0

### TC-092: Other user profile -- report user
- **Area**: Profile
- **Platform**: All
- **Steps**: 1. Tap Report on another user's profile. 2. Report dialog opens. 3. Select reason, add description. 4. Optionally add evidence image. 5. Submit.
- **Expected**: Report submitted. Thank you snackbar appears. Report appears in admin panel.
- **Priority**: P0

### TC-093: Other user profile -- send DM
- **Area**: Profile
- **Platform**: All
- **Steps**: 1. On another user's profile, tap DM/message icon.
- **Expected**: Navigates to private chat with that user.
- **Priority**: P1

### TC-094: Other user profile -- blocked by target
- **Area**: Profile
- **Platform**: All
- **Steps**: 1. Navigate to a user who has blocked you.
- **Expected**: "Profile not available" message with "Blocked by this user" text. Display name and unique ID still shown. Report button available.
- **Priority**: P1

### TC-095: Other user profile -- suspended user
- **Area**: Profile
- **Platform**: All
- **Steps**: 1. Navigate to a suspended user's profile.
- **Expected**: "Account suspended" label with description. No profile content visible.
- **Priority**: P1

### TC-096: Other user profile -- user not found
- **Area**: Profile
- **Platform**: All
- **Steps**: 1. Navigate to profile with non-existent user ID.
- **Expected**: "Profile not found" text displayed.
- **Priority**: P2

---

## 11. Follow List

### TC-097: Follow list -- followers tab
- **Area**: Follow List
- **Platform**: All
- **Steps**: 1. Navigate to follow list > Followers tab.
- **Expected**: List of users who follow the target user. Each item shows avatar, display name, follow button.
- **Priority**: P1

### TC-098: Follow list -- following tab
- **Area**: Follow List
- **Platform**: All
- **Steps**: 1. Navigate to follow list > Following tab.
- **Expected**: List of users the target user follows.
- **Priority**: P1

### TC-099: Follow list -- tap user navigates to profile
- **Area**: Follow List
- **Platform**: All
- **Steps**: 1. Tap a user in the follow list.
- **Expected**: Navigates to that user's profile.
- **Priority**: P1

---

## 12. Messaging -- Conversation List

### TC-100: Conversation list -- displays conversations
- **Area**: Messaging
- **Platform**: All
- **Steps**: 1. Navigate to Messages tab.
- **Expected**: List of conversations with last message preview, timestamp, unread indicator, and user avatar.
- **Priority**: P0

### TC-101: Conversation list -- empty state
- **Area**: Messaging
- **Platform**: All
- **Steps**: 1. New user with no conversations opens Messages tab.
- **Expected**: Empty state with message icon and "No conversations yet" text.
- **Priority**: P1

### TC-102: Conversation list -- search conversations
- **Area**: Messaging
- **Platform**: All
- **Steps**: 1. Tap search icon. 2. Type a user's name. 3. Observe filtered results.
- **Expected**: Conversations filter to match the search query. Clear button (X) resets search.
- **Priority**: P1

### TC-103: Conversation list -- long press context menu
- **Area**: Messaging
- **Platform**: All
- **Steps**: 1. Long press on a conversation.
- **Expected**: Context menu appears with options (e.g., delete conversation).
- **Priority**: P1

### TC-104: Conversation list -- delete conversation
- **Area**: Messaging
- **Platform**: All
- **Steps**: 1. Long press > Delete. 2. Confirm deletion.
- **Expected**: Conversation removed from list. Confirmation dialog shown before deletion.
- **Priority**: P1

### TC-105: Conversation list -- pull to refresh
- **Area**: Messaging
- **Platform**: All
- **Steps**: 1. Pull down on conversation list.
- **Expected**: Conversations reload with latest data.
- **Priority**: P2

### TC-106: New message -- navigate from FAB
- **Area**: Messaging
- **Platform**: All
- **Steps**: 1. On Messages tab, tap the new message FAB (edit icon).
- **Expected**: New message screen opens with user search/selection.
- **Priority**: P0

---

## 13. Messaging -- Private Chat

### TC-107: Private chat -- send text message
- **Area**: Private Chat
- **Platform**: All
- **Steps**: 1. Open a conversation. 2. Type "Hello". 3. Tap send.
- **Expected**: Message appears in chat with sender name, text, timestamp. Auto-scrolls to bottom.
- **Priority**: P0

### TC-108: Private chat -- send image
- **Area**: Private Chat
- **Platform**: All
- **Steps**: 1. Tap image picker icon. 2. Select up to 10 images. 3. Send.
- **Expected**: Images upload and appear as thumbnails in chat bubble.
- **Priority**: P1

### TC-109: Private chat -- send sticker
- **Area**: Private Chat
- **Platform**: All
- **Steps**: 1. Tap emoji/sticker icon. 2. Sticker picker opens. 3. Select a sticker.
- **Expected**: Sticker appears as an image in chat.
- **Priority**: P1

### TC-110: Private chat -- message reactions
- **Area**: Private Chat
- **Platform**: All
- **Steps**: 1. Long press or double-tap a message. 2. Reaction picker appears. 3. Select a reaction.
- **Expected**: Reaction emoji appears on the message bubble. Visible to both participants.
- **Priority**: P1

### TC-111: Private chat -- edit message
- **Area**: Private Chat
- **Platform**: All
- **Steps**: 1. Long press your own message. 2. Select Edit. 3. Modify text. 4. Confirm.
- **Expected**: Message text updates. "Edited" indicator appears. Edit history accessible via dialog.
- **Priority**: P1

### TC-112: Private chat -- self-destruct timer
- **Area**: Private Chat
- **Platform**: All
- **Steps**: 1. Enable self-destruct on a conversation. 2. Send a message. 3. Wait for timer to expire.
- **Expected**: Message disappears after the configured duration.
- **Priority**: P2

### TC-113: Private chat -- read receipts (online indicator)
- **Area**: Private Chat
- **Platform**: All
- **Steps**: 1. Open a conversation. 2. Other user is online.
- **Expected**: Online indicator (green dot) appears next to other user's name in top bar.
- **Priority**: P2

### TC-114: Private chat -- scroll to load history
- **Area**: Private Chat
- **Platform**: All
- **Steps**: 1. In a conversation with 50+ messages, scroll to top.
- **Expected**: Older messages load as user scrolls up.
- **Priority**: P1

### TC-115: Private chat -- report from chat
- **Area**: Private Chat
- **Platform**: All
- **Steps**: 1. Tap overflow menu (3 dots) in chat toolbar. 2. Select Report.
- **Expected**: Report dialog opens for the other user with pre-filled context.
- **Priority**: P1

### TC-116: Private chat -- mute conversation
- **Area**: Private Chat
- **Platform**: All
- **Steps**: 1. Tap overflow menu. 2. Select Mute.
- **Expected**: Conversation muted. Mute icon appears in toolbar. No push notifications from this conversation.
- **Priority**: P2

---

## 14. Messaging -- Group Chat

### TC-117: Group chat -- create group
- **Area**: Group Chat
- **Platform**: All
- **Steps**: 1. From new message screen, select multiple users. 2. Tap "Create Group". 3. Set group name. 4. Confirm.
- **Expected**: Group created. Group chat screen opens. Group name shown in toolbar. Group icon visible.
- **Priority**: P1

### TC-118: Group chat -- group settings sheet
- **Area**: Group Chat
- **Platform**: All
- **Steps**: 1. Open a group chat. 2. Tap group settings icon.
- **Expected**: Group settings bottom sheet opens showing member list, group name, admin actions.
- **Priority**: P1

### TC-119: Group chat -- add/remove members
- **Area**: Group Chat
- **Platform**: All
- **Steps**: 1. Open group settings. 2. Add a new member. 3. Remove an existing member.
- **Expected**: Member list updates. Added member can see the group. Removed member loses access.
- **Priority**: P1

---

## 15. Wallet

### TC-120: Wallet -- displays coin balance
- **Area**: Wallet
- **Platform**: All
- **Steps**: 1. Navigate to Wallet screen.
- **Expected**: Current coin balance displayed prominently. Transaction history button in toolbar.
- **Priority**: P0

### TC-121: Wallet -- coin packages tab
- **Area**: Wallet
- **Platform**: All
- **Steps**: 1. On Wallet screen, observe coin packages tab.
- **Expected**: Coin packages displayed as cards with amount, price, and buy button.
- **Priority**: P1

### TC-122: Wallet -- purchase coin package
- **Area**: Wallet
- **Platform**: All
- **Steps**: 1. Tap "Buy" on a coin package. 2. Complete purchase flow.
- **Expected**: Coins added to balance. Success snackbar shown.
- **Priority**: P1

### TC-123: Wallet -- transaction history
- **Area**: Wallet
- **Platform**: All
- **Steps**: 1. Tap transaction history button in toolbar.
- **Expected**: Transaction history screen shows list of transactions (purchases, gifts sent/received, daily rewards, gacha spins) with amount, description, and timestamp.
- **Priority**: P1

### TC-124: Wallet -- error handling
- **Area**: Wallet
- **Platform**: All
- **Steps**: 1. Trigger a purchase error (e.g., network timeout).
- **Expected**: Error snackbar shown. Balance unchanged.
- **Priority**: P1

---

## 16. Super Shy Subscription

### TC-125: Super Shy sheet -- displays plans
- **Area**: Super Shy
- **Platform**: All
- **Steps**: 1. Open Super Shy bottom sheet from profile.
- **Expected**: Shows subscription benefits with checkmark icons, plan options (monthly/yearly), price, purchase/trial buttons.
- **Priority**: P1

### TC-126: Super Shy -- claim trial
- **Area**: Super Shy
- **Platform**: All
- **Steps**: 1. Tap "Claim Trial" (first time only).
- **Expected**: Trial activated. Super Shy badge appears on profile. Benefits active.
- **Priority**: P1

---

## 17. Gacha / Lucky Spin

### TC-127: Lucky Spin -- overlay opens
- **Area**: Gacha
- **Platform**: All
- **Steps**: 1. Tap Lucky Spin from room action carousel.
- **Expected**: Full-screen overlay with spin wheel, spin count selector (+/- buttons), cost display, "Spin" button, close (X) button.
- **Priority**: P1

### TC-128: Lucky Spin -- single spin
- **Area**: Gacha
- **Platform**: All
- **Steps**: 1. Set spin count to 1. 2. Tap Spin.
- **Expected**: Wheel animates. Prize result shown in summary popup. Coins deducted. Gift added to backpack.
- **Priority**: P1

### TC-129: Lucky Spin -- multi-spin
- **Area**: Gacha
- **Platform**: All
- **Steps**: 1. Set spin count to 10. 2. Tap Spin.
- **Expected**: Wheel spins 10 times (or batch). Summary popup shows all results. Total cost deducted.
- **Priority**: P2

### TC-130: Lucky Spin -- insufficient coins
- **Area**: Gacha
- **Platform**: All
- **Steps**: 1. Set spin count exceeding coin balance. 2. Tap Spin.
- **Expected**: Error message: insufficient coins.
- **Priority**: P1

### TC-131: Lucky Spin -- confetti on rare win
- **Area**: Gacha
- **Platform**: All
- **Steps**: 1. Win a rare or higher tier gift.
- **Expected**: Confetti animation plays. Gift effect overlay shows for high-value wins (500+ coins).
- **Priority**: P2

### TC-132: Lucky Spin -- auto-send toggle
- **Area**: Gacha
- **Platform**: All
- **Steps**: 1. Toggle auto-send switch in Lucky Spin overlay.
- **Expected**: When enabled, won gifts are automatically sent to a target user instead of going to backpack.
- **Priority**: P2

---

## 18. Daily Reward

### TC-133: Daily reward -- calendar displays current month
- **Area**: Daily Reward
- **Platform**: All
- **Steps**: 1. Open daily reward dialog.
- **Expected**: Calendar grid shows current month. Already claimed days have a check icon. Today is highlighted. Streak count displayed.
- **Priority**: P1

### TC-134: Daily reward -- claim today
- **Area**: Daily Reward
- **Platform**: All
- **Steps**: 1. Tap "Claim" button on today's date.
- **Expected**: Coins credited. Day marked as claimed with check icon. Celebration dialog may appear for milestones. Loading indicator during API call.
- **Priority**: P0

### TC-135: Daily reward -- already claimed
- **Area**: Daily Reward
- **Platform**: All
- **Steps**: 1. Open daily reward after already claiming today.
- **Expected**: Today's date already shows claimed. Claim button disabled or hidden.
- **Priority**: P1

---

## 19. Settings -- Main Menu

### TC-136: Settings main -- all menu items present
- **Area**: Settings
- **Platform**: All
- **Steps**: 1. Navigate to Settings.
- **Expected**: Menu items visible in order: Blocked Users, Account, Privacy, Notifications, Language (with current language subtitle), Permissions, About. Sign Out button at bottom (red/error color).
- **Priority**: P0

### TC-137: Settings main -- back button navigates back
- **Area**: Settings
- **Platform**: All
- **Steps**: 1. Tap back arrow in settings toolbar.
- **Expected**: Returns to the main screen (Profile tab).
- **Priority**: P1

### TC-138: Settings -- language picker
- **Area**: Settings
- **Platform**: All
- **Steps**: 1. Tap Language menu item. 2. Language dialog opens showing all 20 languages with radio buttons.
- **Expected**: 20 languages listed: English, Espanol, Arabic, Japanese, Korean, Chinese, French, German, Portuguese, Russian, Hindi, Turkish, Italian, Thai, Vietnamese, Indonesian, Polish, Dutch, Swedish, Ukrainian. Current language pre-selected. Selecting a new language triggers app restart.
- **Priority**: P0

### TC-139: Settings -- sign out flow
- **Area**: Settings
- **Platform**: All
- **Steps**: 1. Tap "Sign Out" button. 2. Confirmation dialog appears. 3. Tap "Sign Out" (red text).
- **Expected**: User signed out. Navigates to auth/splash screen. Session cleared.
- **Priority**: P0

### TC-140: Settings -- sign out cancel
- **Area**: Settings
- **Platform**: All
- **Steps**: 1. Tap "Sign Out". 2. Tap "Cancel" in dialog.
- **Expected**: Dialog closes. User remains in settings, still signed in.
- **Priority**: P2

---

## 20. Settings -- Blocked Users

### TC-141: Blocked users -- list displays blocked users
- **Area**: Settings / Blocked Users
- **Platform**: All
- **Steps**: 1. Block a user. 2. Navigate to Settings > Blocked Users.
- **Expected**: Blocked user appears in list with avatar and display name.
- **Priority**: P1

### TC-142: Blocked users -- unblock user
- **Area**: Settings / Blocked Users
- **Platform**: All
- **Steps**: 1. Tap unblock on a blocked user.
- **Expected**: User removed from blocked list. User's content becomes visible again.
- **Priority**: P1

### TC-143: Blocked users -- empty list
- **Area**: Settings / Blocked Users
- **Platform**: All
- **Steps**: 1. Unblock all users. 2. Open Blocked Users page.
- **Expected**: Empty state message shown.
- **Priority**: P2

---

## 21. Settings -- Account

### TC-144: Account -- linked accounts navigation
- **Area**: Settings / Account
- **Platform**: All
- **Steps**: 1. Navigate to Settings > Account. 2. Tap "Linked Accounts".
- **Expected**: Linked Accounts page shows connected providers (Google, Apple, Email) with link/unlink options.
- **Priority**: P1

### TC-145: Account -- request account deletion
- **Area**: Settings / Account
- **Platform**: All
- **Steps**: 1. Navigate to Settings > Account. 2. Tap "Delete Account". 3. Enter PIN to confirm.
- **Expected**: Account deletion requested. Confirmation shown. Account scheduled for deletion.
- **Priority**: P0

### TC-146: Account -- cancel deletion
- **Area**: Settings / Account
- **Platform**: All
- **Steps**: 1. After requesting deletion, tap "Cancel Deletion".
- **Expected**: Deletion cancelled. Account restored to normal state.
- **Priority**: P1

### TC-147: Account -- request data export
- **Area**: Settings / Account
- **Platform**: All
- **Steps**: 1. Tap "Request Data Export".
- **Expected**: Export request submitted. User notified about delivery timeline.
- **Priority**: P1

---

## 22. Settings -- Privacy

### TC-148: Privacy -- hide following toggle
- **Area**: Settings / Privacy
- **Platform**: All
- **Steps**: 1. Toggle "Hide Following" switch on.
- **Expected**: Other users can no longer see your following list.
- **Priority**: P1

### TC-149: Privacy -- hide online status toggle
- **Area**: Settings / Privacy
- **Platform**: All
- **Steps**: 1. Toggle "Hide Online Status" on.
- **Expected**: Online indicator not shown to other users on your profile.
- **Priority**: P1

### TC-150: Privacy -- hide age toggle
- **Area**: Settings / Privacy
- **Platform**: All
- **Steps**: 1. Toggle "Hide Age" on.
- **Expected**: Age no longer visible on your profile to other users.
- **Priority**: P1

### TC-151: Privacy -- PM privacy radio buttons
- **Area**: Settings / Privacy
- **Platform**: All
- **Steps**: 1. Select each PM privacy option (Everyone, Followers Only, Nobody).
- **Expected**: Radio button selection updates. PM access restricted accordingly for other users.
- **Priority**: P1

---

## 23. Settings -- Notifications

### TC-152: Notifications -- PM notifications toggle
- **Area**: Settings / Notifications
- **Platform**: All
- **Steps**: 1. Toggle PM notifications off.
- **Expected**: No push notifications for new private messages.
- **Priority**: P1

### TC-153: Notifications -- PM sound toggle
- **Area**: Settings / Notifications
- **Platform**: All
- **Steps**: 1. Toggle PM sound off.
- **Expected**: PMs received without sound.
- **Priority**: P2

### TC-154: Notifications -- PM preview toggle
- **Area**: Settings / Notifications
- **Platform**: All
- **Steps**: 1. Toggle PM preview off.
- **Expected**: Push notifications show "New message" without content preview.
- **Priority**: P2

### TC-155: Notifications -- PM timestamps toggle
- **Area**: Settings / Notifications
- **Platform**: All
- **Steps**: 1. Toggle PM timestamps off.
- **Expected**: Message timestamps hidden in chat UI.
- **Priority**: P2

### TC-156: Notifications -- DND mode
- **Area**: Settings / Notifications
- **Platform**: All
- **Steps**: 1. Enable DND. 2. Set start hour and end hour. 3. Receive a message during DND window.
- **Expected**: No notifications during DND window. Start/end time pickers functional.
- **Priority**: P1

### TC-157: Notifications -- self-destruct alert toggle
- **Area**: Settings / Notifications
- **Platform**: All
- **Steps**: 1. Toggle self-destruct alert on.
- **Expected**: TTS announces room self-destruct sequence when room expiry countdown begins.
- **Priority**: P2

---

## 24. Settings -- Permissions

### TC-158: Permissions -- system settings links
- **Area**: Settings / Permissions
- **Platform**: Android/iOS
- **Steps**: 1. Navigate to Settings > Permissions.
- **Expected**: Links to open system settings for microphone, notifications, and other relevant permissions.
- **Priority**: P2

---

## 25. Settings -- About

### TC-159: About -- legal document links
- **Area**: Settings / About
- **Platform**: All
- **Steps**: 1. Navigate to Settings > About. 2. Tap Privacy Policy. 3. Tap Community Standards. 4. Tap Terms & Conditions. 5. Tap Cyber Bullying Policy.
- **Expected**: Each link opens the respective legal document in a WebView/browser.
- **Priority**: P1

### TC-160: About -- check for updates
- **Area**: Settings / About
- **Platform**: Android
- **Steps**: 1. Tap "Check for Updates".
- **Expected**: One of: "Up to date" dialog, "Update available (vX.X)" with "Download Now" and "Later" buttons, or error dialog.
- **Priority**: P1

### TC-161: About -- clear cache
- **Area**: Settings / About
- **Platform**: All
- **Steps**: 1. Tap "Clear Cache". 2. Confirmation dialog shows cache size. 3. Tap "Clear".
- **Expected**: Cache cleared. Success dialog: "Cache cleared" with OK button.
- **Priority**: P1

---

## 26. Settings -- Security

### TC-162: Security -- app lock toggle
- **Area**: Settings / Security
- **Platform**: All
- **Steps**: 1. Navigate to Security settings. 2. Toggle App Lock on.
- **Expected**: App lock enabled. Lock screen required on next app open (after timeout expires).
- **Priority**: P1

### TC-163: Security -- biometric toggle
- **Area**: Settings / Security
- **Platform**: Android
- **Steps**: 1. Toggle Biometric on.
- **Expected**: Biometric authentication enabled for unlock.
- **Priority**: P1

### TC-164: Security -- lock timeout selection
- **Area**: Settings / Security
- **Platform**: All
- **Steps**: 1. Tap lock timeout dropdown. 2. Select "5 minutes" from options (1min, 5min, 15min, 30min, Never).
- **Expected**: Timeout updates. App requires lock screen after 5 minutes of inactivity.
- **Priority**: P1

### TC-165: Security -- reset PIN
- **Area**: Settings / Security
- **Platform**: All
- **Steps**: 1. Tap "Reset PIN".
- **Expected**: Navigates to PIN setup flow to create a new PIN.
- **Priority**: P1

### TC-166: Security -- linked accounts link
- **Area**: Settings / Security
- **Platform**: All
- **Steps**: 1. Tap "Linked Accounts" in security settings.
- **Expected**: Navigates to linked accounts page.
- **Priority**: P2

---

## 27. Web -- Landing Page

### TC-167: Landing page -- loads correctly
- **Area**: Web / Landing
- **Platform**: Chrome, Firefox, Safari
- **Steps**: 1. Navigate to the landing page URL.
- **Expected**: Page loads with ShyTalk logo/title, "Coming Soon" subtitle, radial glow background, no console errors.
- **Priority**: P0

### TC-168: Landing page -- responsive layout
- **Area**: Web / Landing
- **Platform**: Web
- **Steps**: 1. View at 320px width. 2. View at 768px. 3. View at 1920px.
- **Expected**: Content centered and readable at all widths. Logo font scales via clamp(). Max-width 520px container.
- **Priority**: P1

---

## 28. Web -- Roadmap Page

### TC-169: Roadmap -- phase sections display
- **Area**: Web / Roadmap
- **Platform**: Chrome, Firefox, Safari
- **Steps**: 1. Navigate to roadmap.html.
- **Expected**: Phase sections display with status indicators (Done/green, In Progress/orange, Planned/blue). Features listed within each phase.
- **Priority**: P0

### TC-170: Roadmap -- suggestion submission
- **Area**: Web / Roadmap
- **Platform**: Web
- **Steps**: 1. Log in to roadmap. 2. Navigate to Suggestions section. 3. Submit a new suggestion.
- **Expected**: Suggestion submitted. Appears in the suggestions list. Admin notified.
- **Priority**: P1

### TC-171: Roadmap -- voting on suggestions
- **Area**: Web / Roadmap
- **Platform**: Web
- **Steps**: 1. Find a suggestion. 2. Click vote/upvote.
- **Expected**: Vote registered. Vote count increments. User cannot vote twice on same suggestion.
- **Priority**: P1

### TC-172: Roadmap -- comments on suggestions
- **Area**: Web / Roadmap
- **Platform**: Web
- **Steps**: 1. Open a suggestion. 2. Add a comment. 3. Submit.
- **Expected**: Comment appears below the suggestion.
- **Priority**: P2

### TC-173: Roadmap -- subscribe for updates
- **Area**: Web / Roadmap
- **Platform**: Web
- **Steps**: 1. Click Subscribe button. 2. Login modal appears (shared login). 3. Authenticate.
- **Expected**: User subscribed to roadmap updates. Button changes to "Subscribed".
- **Priority**: P1

### TC-174: Roadmap -- SEO metadata
- **Area**: Web / Roadmap
- **Platform**: Web
- **Steps**: 1. View page source.
- **Expected**: OG tags present (og:title, og:description, og:url). Canonical URL set. Robots meta allows indexing on prod, blocks on dev.
- **Priority**: P2

---

## 29. Web -- Portal

### TC-175: Portal -- login form (email/password)
- **Area**: Web / Portal
- **Platform**: Chrome, Firefox, Safari
- **Steps**: 1. Navigate to portal/index.html. 2. Enter email and password. 3. Click "Sign In".
- **Expected**: Login succeeds. Dashboard loads.
- **Priority**: P0

### TC-176: Portal -- Google sign-in
- **Area**: Web / Portal
- **Platform**: Web
- **Steps**: 1. Click "Sign in with Google".
- **Expected**: Google OAuth flow opens. Successful auth redirects to dashboard.
- **Priority**: P1

### TC-177: Portal -- Apple sign-in
- **Area**: Web / Portal
- **Platform**: Web
- **Steps**: 1. Click "Sign in with Apple".
- **Expected**: Apple OAuth flow opens. Successful auth redirects to dashboard.
- **Priority**: P1

### TC-178: Portal -- remember me checkbox
- **Area**: Web / Portal
- **Platform**: Web
- **Steps**: 1. Check "Remember me". 2. Log in. 3. Close browser. 4. Reopen portal.
- **Expected**: Session persisted. User auto-logged in.
- **Priority**: P2

### TC-179: Portal -- login error display
- **Area**: Web / Portal
- **Platform**: Web
- **Steps**: 1. Enter wrong password. 2. Submit.
- **Expected**: Error message appears in red alert box below form.
- **Priority**: P1

### TC-180: Portal -- dashboard
- **Area**: Web / Portal
- **Platform**: Web
- **Steps**: 1. Log in. 2. Observe dashboard.
- **Expected**: Dashboard shows account overview, profile info, and navigation to profile/security/data sections.
- **Priority**: P1

### TC-181: Portal -- i18n data-i18n attributes
- **Area**: Web / Portal
- **Platform**: Web
- **Steps**: 1. Change browser language to Arabic. 2. Reload portal.
- **Expected**: All elements with data-i18n attributes translated to Arabic. RTL layout applied.
- **Priority**: P1

---

## 30. Web -- Admin Panel

### TC-182: Admin -- login screen
- **Area**: Web / Admin
- **Platform**: Chrome, Firefox, Safari
- **Steps**: 1. Navigate to admin/index.html. 2. Login screen shows.
- **Expected**: Login box with email/password fields. Loading spinner during auth check.
- **Priority**: P0

### TC-183: Admin -- non-admin user rejected
- **Area**: Web / Admin
- **Platform**: Web
- **Steps**: 1. Log in as user@test.com (MEMBER role).
- **Expected**: Access denied. Remains on login screen or shows error.
- **Priority**: P0

### TC-184: Admin -- Users tab
- **Area**: Web / Admin
- **Platform**: Web
- **Steps**: 1. Log in as admin. 2. Navigate to Users tab. 3. Search for a user. 4. View user details.
- **Expected**: User list loads. Search works. User details show profile, roles, suspension status, economy, linked accounts.
- **Priority**: P0

### TC-185: Admin -- Reports tab
- **Area**: Web / Admin
- **Platform**: Web
- **Steps**: 1. Navigate to Reports tab. 2. View pending reports.
- **Expected**: Reports listed with severity, reporter, reported user, reason, evidence. Actions: warn, suspend, dismiss.
- **Priority**: P0

### TC-186: Admin -- Appeals tab
- **Area**: Web / Admin
- **Platform**: Web
- **Steps**: 1. Navigate to Appeals tab.
- **Expected**: List of suspension appeals with user info, appeal text, and approve/deny actions.
- **Priority**: P1

### TC-187: Admin -- Devices tab
- **Area**: Web / Admin
- **Platform**: Web
- **Steps**: 1. Navigate to Devices tab. 2. Search by device ID.
- **Expected**: Device list shows device info, linked users, ban status.
- **Priority**: P1

### TC-188: Admin -- Banners tab
- **Area**: Web / Admin
- **Platform**: Web
- **Steps**: 1. Navigate to Banners tab. 2. Create a new banner with image URL, title, action type, action value. 3. Save.
- **Expected**: Banner created. Appears in app's banner carousel.
- **Priority**: P1

### TC-189: Admin -- Gifts tab
- **Area**: Web / Admin
- **Platform**: Web
- **Steps**: 1. Navigate to Gifts tab. 2. View/edit gift configuration.
- **Expected**: Gift list with name, coin value, rarity tier. Edit and create functionality.
- **Priority**: P1

### TC-190: Admin -- Economy Config tab
- **Area**: Web / Admin
- **Platform**: Web
- **Steps**: 1. Navigate to Economy Config tab. 2. View/edit economy parameters.
- **Expected**: Economy config fields (daily reward amounts, spin costs, etc.) editable and saveable.
- **Priority**: P1

### TC-191: Admin -- Fun Facts tab
- **Area**: Web / Admin
- **Platform**: Web
- **Steps**: 1. Navigate to Fun Facts tab. 2. Add a new fun fact. 3. Save.
- **Expected**: Fun fact added. Appears in app's splash screen rotation.
- **Priority**: P2

### TC-192: Admin -- Logs tab
- **Area**: Web / Admin
- **Platform**: Web
- **Steps**: 1. Navigate to Logs tab. 2. Apply filters (level, source, date range).
- **Expected**: Logs filtered and displayed. Pagination works.
- **Priority**: P1

### TC-193: Admin -- Audit Log tab
- **Area**: Web / Admin
- **Platform**: Web
- **Steps**: 1. Navigate to Audit Log tab.
- **Expected**: All admin actions logged with timestamp, admin user, action type, target user.
- **Priority**: P1

### TC-194: Admin -- Maintenance tab
- **Area**: Web / Admin
- **Platform**: Web
- **Steps**: 1. Navigate to Maintenance tab.
- **Expected**: Cleanup operations, migration tools, system maintenance actions available.
- **Priority**: P2

### TC-195: Admin -- Suggestions tab
- **Area**: Web / Admin
- **Platform**: Web
- **Steps**: 1. Navigate to Suggestions tab. 2. Approve/reject/merge suggestions.
- **Expected**: Suggestion management with approve, reject, merge, link, complete, overturn actions.
- **Priority**: P1

### TC-196: Admin -- Spin Monitor tab
- **Area**: Web / Admin
- **Platform**: Web
- **Steps**: 1. Navigate to Spin Monitor tab.
- **Expected**: Live gacha spin statistics, win rates, high-value wins displayed.
- **Priority**: P2

### TC-197: Admin -- Starting Screens tab
- **Area**: Web / Admin
- **Platform**: Web
- **Steps**: 1. Navigate to Starting Screens tab. 2. Configure starting screen content.
- **Expected**: Starting screen fields editable and saveable.
- **Priority**: P2

### TC-198: Admin -- Backups tab
- **Area**: Web / Admin
- **Platform**: Web
- **Steps**: 1. Navigate to Backups tab. 2. Trigger a backup.
- **Expected**: Backup initiated. Status displayed. Download link available when complete.
- **Priority**: P2

### TC-199: Admin -- noindex meta tag
- **Area**: Web / Admin
- **Platform**: Web
- **Steps**: 1. View page source of admin panel.
- **Expected**: `<meta name="robots" content="noindex, nofollow">` present.
- **Priority**: P2

---

## 31. Web -- Legal Pages

### TC-200: Legal pages -- privacy policy loads
- **Area**: Web / Legal
- **Platform**: Chrome, Firefox, Safari
- **Steps**: 1. Navigate to privacy.html.
- **Expected**: Privacy policy content loads. Scrollable. No broken links.
- **Priority**: P1

### TC-201: Legal pages -- terms loads
- **Area**: Web / Legal
- **Platform**: Web
- **Steps**: 1. Navigate to terms.html.
- **Expected**: Terms and conditions content loads.
- **Priority**: P1

### TC-202: Legal pages -- community guidelines loads
- **Area**: Web / Legal
- **Platform**: Web
- **Steps**: 1. Navigate to community-guidelines.html.
- **Expected**: Community guidelines content loads.
- **Priority**: P1

### TC-203: Legal pages -- cyber bullying policy loads
- **Area**: Web / Legal
- **Platform**: Web
- **Steps**: 1. Navigate to cyber-bullying.html.
- **Expected**: Cyber bullying policy content loads.
- **Priority**: P1

---

## 32. Cross-Platform Integration

### TC-204: Admin suspend user -- app sees suspension
- **Area**: Cross-Platform
- **Platform**: Web Admin + Android/iOS
- **Steps**: 1. Suspend a user via admin panel (3-day suspension, reason "Harassment"). 2. Open the app as that user.
- **Expected**: App shows suspension screen with reason "Harassment", end date (3 days from now), and appeal option. User cannot access main app features.
- **Priority**: P0

### TC-205: Admin warn user -- app shows warning
- **Area**: Cross-Platform
- **Platform**: Web Admin + Android/iOS
- **Steps**: 1. Issue a warning via admin panel. 2. Open the app as that user.
- **Expected**: Warning screen appears with reason text and police duck image on next app open.
- **Priority**: P0

### TC-206: Admin ban device -- app blocked
- **Area**: Cross-Platform
- **Platform**: Web Admin + Android/iOS
- **Steps**: 1. Ban a device via admin panel. 2. Open the app on that device.
- **Expected**: Device ban screen shown. No access to any app feature.
- **Priority**: P0

### TC-207: Admin adjust economy -- wallet updates
- **Area**: Cross-Platform
- **Platform**: Web Admin + Android/iOS
- **Steps**: 1. Admin adjusts a user's coin balance (+500 coins). 2. Open the app as that user. 3. Check wallet.
- **Expected**: Wallet shows updated balance. Transaction history shows admin adjustment entry.
- **Priority**: P1

### TC-208: Admin edit profile -- profile updates
- **Area**: Cross-Platform
- **Platform**: Web Admin + Android/iOS
- **Steps**: 1. Admin edits a user's display name via admin panel. 2. Open the app as that user.
- **Expected**: Profile shows the new display name set by admin.
- **Priority**: P1

### TC-209: Admin create banner -- app shows banner
- **Area**: Cross-Platform
- **Platform**: Web Admin + Android/iOS
- **Steps**: 1. Create a banner via admin panel with image URL and action. 2. Open the app.
- **Expected**: Banner appears in the home screen carousel.
- **Priority**: P1

### TC-210: Roadmap suggestion -- admin approves -- roadmap updates
- **Area**: Cross-Platform
- **Platform**: Web Roadmap + Web Admin
- **Steps**: 1. Submit a suggestion on roadmap. 2. Approve it in admin. 3. Refresh roadmap.
- **Expected**: Suggestion status changes to approved on the roadmap page.
- **Priority**: P1

### TC-211: App report -- admin sees report
- **Area**: Cross-Platform
- **Platform**: Android/iOS + Web Admin
- **Steps**: 1. Report a user from the app with evidence. 2. Check admin Reports tab.
- **Expected**: Report appears with all details: reporter, reported user, reason, description, evidence images.
- **Priority**: P0

### TC-212: PM sent in app -- real-time delivery
- **Area**: Cross-Platform
- **Platform**: Android/iOS
- **Steps**: 1. User A sends a PM to User B from the app. 2. Observe User B's app.
- **Expected**: Message appears in real-time on User B's conversation (within 2 seconds). Notification delivered if User B has notifications enabled.
- **Priority**: P0

### TC-213: Portal profile edit -- app reflects changes
- **Area**: Cross-Platform
- **Platform**: Web Portal + Android/iOS
- **Steps**: 1. Edit profile in portal. 2. Open the app.
- **Expected**: App profile reflects changes made in portal.
- **Priority**: P1

---

## 33. Viewport Testing

### TC-214: Web pages at 320px (small phone)
- **Area**: Viewport
- **Platform**: Web
- **Steps**: 1. Set browser viewport to 320px width. 2. Load landing page. 3. Load roadmap. 4. Load portal. 5. Load admin panel.
- **Expected**: No horizontal scrollbar. All content readable. Buttons tappable (min 44px touch targets). No text truncation of critical info.
- **Priority**: P1

### TC-215: Web pages at 375px (iPhone SE)
- **Area**: Viewport
- **Platform**: Web
- **Steps**: 1. Set viewport to 375px. 2. Load each web page.
- **Expected**: Layout well-balanced. Navigation elements accessible.
- **Priority**: P1

### TC-216: Web pages at 768px (tablet portrait)
- **Area**: Viewport
- **Platform**: Web
- **Steps**: 1. Set viewport to 768px. 2. Load each web page.
- **Expected**: Two-column layouts where appropriate. Admin panel sidebar usable.
- **Priority**: P1

### TC-217: Web pages at 1024px (tablet landscape)
- **Area**: Viewport
- **Platform**: Web
- **Steps**: 1. Set viewport to 1024px. 2. Load each web page.
- **Expected**: Desktop-like layout. Admin panel fully functional with all tabs visible.
- **Priority**: P1

### TC-218: Web pages at 1920px (desktop full HD)
- **Area**: Viewport
- **Platform**: Web
- **Steps**: 1. Set viewport to 1920px. 2. Load each web page.
- **Expected**: Content width constrained by max-width. No excessive whitespace. Images not stretched.
- **Priority**: P1

---

## 34. Locale Spot-Checks

### TC-219: English locale -- baseline
- **Area**: Locale
- **Platform**: All
- **Steps**: 1. Set app language to English. 2. Navigate all screens.
- **Expected**: All strings in English. No missing translations (no string keys visible).
- **Priority**: P0

### TC-220: Arabic (RTL) locale
- **Area**: Locale
- **Platform**: All
- **Steps**: 1. Set app language to Arabic. 2. Navigate: Rooms tab, Profile, Settings, Room screen, Messaging.
- **Expected**: Full RTL layout. Back arrows mirror. Text alignment right-to-left. Navigation icons mirror. Arabic text renders correctly. No overlapping elements.
- **Priority**: P0

### TC-221: Chinese locale
- **Area**: Locale
- **Platform**: All
- **Steps**: 1. Set app language to Chinese. 2. Navigate: auth, home, room, settings.
- **Expected**: All strings in Chinese. Characters render correctly. No clipping or overflow due to character width.
- **Priority**: P1

### TC-222: Khmer locale
- **Area**: Locale
- **Platform**: All
- **Steps**: 1. Set app language to Khmer. 2. Navigate: auth, home, room, settings.
- **Expected**: Khmer script renders correctly with proper line height. No clipping of tall characters. Text wraps appropriately.
- **Priority**: P1

### TC-223: Arabic RTL -- web pages
- **Area**: Locale
- **Platform**: Web
- **Steps**: 1. Set browser language to Arabic. 2. Load portal page.
- **Expected**: Portal elements with data-i18n attributes translated. Layout direction adjusted for RTL.
- **Priority**: P1

---

## 35. State Coverage

### TC-224: Empty state -- no rooms
- **Area**: State
- **Platform**: All
- **Steps**: 1. Delete all rooms. 2. Open Rooms tab.
- **Expected**: "No active rooms" / "Tap + to create one" empty state.
- **Priority**: P1

### TC-225: Empty state -- no messages
- **Area**: State
- **Platform**: All
- **Steps**: 1. New user opens Messages tab.
- **Expected**: Empty conversation list state.
- **Priority**: P1

### TC-226: Empty state -- no followers
- **Area**: State
- **Platform**: All
- **Steps**: 1. Open follow list for a user with 0 followers.
- **Expected**: Empty follower list state.
- **Priority**: P2

### TC-227: Loading state -- room list
- **Area**: State
- **Platform**: All
- **Steps**: 1. Open the app. 2. Observe room list while loading.
- **Expected**: CircularProgressIndicator displayed while rooms load.
- **Priority**: P1

### TC-228: Loading state -- profile
- **Area**: State
- **Platform**: All
- **Steps**: 1. Navigate to a profile. 2. Observe while loading.
- **Expected**: CircularProgressIndicator centered on screen.
- **Priority**: P1

### TC-229: Error state -- snackbar display
- **Area**: State
- **Platform**: All
- **Steps**: 1. Trigger an error (e.g., network failure during room creation).
- **Expected**: Error snackbar appears at bottom with error message. Automatically dismissed after timeout.
- **Priority**: P1

### TC-230: Offline state -- no network
- **Area**: State
- **Platform**: Android/iOS
- **Steps**: 1. Enable airplane mode. 2. Try to create a room / send a message.
- **Expected**: Error shown. Cached data still visible where applicable.
- **Priority**: P1

### TC-231: Degraded state -- API partially down
- **Area**: State
- **Platform**: All
- **Steps**: 1. Stop the Express API but keep Firebase running.
- **Expected**: Degraded mode banner appears. Core Firestore features still work. LiveKit/API-dependent features show errors.
- **Priority**: P1

### TC-232: First-time state -- new install
- **Area**: State
- **Platform**: All
- **Steps**: 1. Fresh install. 2. Open app.
- **Expected**: Splash screen > Auth > PIN setup > Legal acceptance > Profile setup > Main screen. No crashes or missing screens.
- **Priority**: P0

---

## 36. Accessibility

### TC-233: Keyboard navigation -- web portal
- **Area**: Accessibility
- **Platform**: Web
- **Steps**: 1. On portal login page, use Tab key to navigate between email, password, remember me, sign in button.
- **Expected**: Focus ring visible on each element. Enter key submits form. Tab order logical.
- **Priority**: P1

### TC-234: Keyboard navigation -- web admin
- **Area**: Accessibility
- **Platform**: Web
- **Steps**: 1. In admin panel, Tab through tabs and form elements.
- **Expected**: All interactive elements reachable via keyboard. Focus visible.
- **Priority**: P1

### TC-235: Screen reader -- app content descriptions
- **Area**: Accessibility
- **Platform**: Android/iOS
- **Steps**: 1. Enable TalkBack (Android) or VoiceOver (iOS). 2. Navigate through main screen, room, profile.
- **Expected**: All icons have contentDescription. Buttons announce their action. Images have alt text. Live regions announce errors.
- **Priority**: P1

### TC-236: Screen reader -- lock screen PIN entry
- **Area**: Accessibility
- **Platform**: Android/iOS
- **Steps**: 1. With screen reader on, navigate the PIN keypad.
- **Expected**: Each digit key announced. Backspace key announced. PIN dots announce count. Error messages use liveRegion.
- **Priority**: P1

### TC-237: Contrast -- dark theme
- **Area**: Accessibility
- **Platform**: All
- **Steps**: 1. Open app in dark theme. 2. Check text contrast on all screens.
- **Expected**: All text meets WCAG AA contrast ratio (4.5:1 for normal text, 3:1 for large text).
- **Priority**: P1

### TC-238: Contrast -- web pages
- **Area**: Accessibility
- **Platform**: Web
- **Steps**: 1. Run automated contrast checker on landing page, roadmap, portal, admin.
- **Expected**: All text/background combinations pass WCAG AA.
- **Priority**: P1

### TC-239: Touch targets -- app buttons
- **Area**: Accessibility
- **Platform**: Android/iOS
- **Steps**: 1. Check button sizes across auth, room, settings, profile screens.
- **Expected**: All interactive elements at least 48dp x 48dp (Android) / 44pt x 44pt (iOS).
- **Priority**: P1

### TC-240: Screen reader -- web portal sr-only labels
- **Area**: Accessibility
- **Platform**: Web
- **Steps**: 1. Inspect portal HTML for sr-only (screen reader only) labels.
- **Expected**: Form inputs have associated labels (sr-only class). Loading spinner has `role="status"` with sr-only text.
- **Priority**: P2

### TC-241: Semantics -- role annotations
- **Area**: Accessibility
- **Platform**: All
- **Steps**: 1. Check that toggle switches have proper role semantics.
- **Expected**: Security settings switch uses `semantics { role = Role.Switch }`. All checkboxes, radio buttons, and switches have correct roles.
- **Priority**: P2

---

## 37. User Role Testing

### TC-242: Owner role -- full room control
- **Area**: Roles
- **Platform**: All
- **Steps**: 1. Create a room (become owner). 2. Verify: can rename room, lock seating, change seat count, kick users, mute users, ban users, close room, access room settings.
- **Expected**: All owner actions available and functional.
- **Priority**: P0

### TC-243: Host (MC_HOST) role -- elevated permissions
- **Area**: Roles
- **Platform**: All
- **Steps**: 1. Log in as host@test.com. 2. Enter another user's room. 3. Verify host-specific actions available (if any).
- **Expected**: Host role recognized. Host badge displayed if applicable.
- **Priority**: P1

### TC-244: Regular user role -- standard permissions
- **Area**: Roles
- **Platform**: All
- **Steps**: 1. Log in as user@test.com. 2. Enter a room owned by another user.
- **Expected**: Can sit, unsit, chat, send gifts. Cannot: rename room, kick users, lock seating, close room. Room settings gear not visible (or only showing applicable options).
- **Priority**: P0

### TC-245: Suspended user -- restricted access
- **Area**: Roles
- **Platform**: All
- **Steps**: 1. Log in as suspended@test.com.
- **Expected**: Suspension screen blocks access. Cannot enter rooms, send messages, or access main features.
- **Priority**: P0

### TC-246: Banned user -- fully blocked
- **Area**: Roles
- **Platform**: All
- **Steps**: 1. Device-ban a user via admin. 2. Try to access the app.
- **Expected**: Ban screen shown. Complete access block.
- **Priority**: P0

### TC-247: No-account user -- web pages accessible
- **Area**: Roles
- **Platform**: Web
- **Steps**: 1. Without logging in, visit landing page, roadmap, legal pages.
- **Expected**: Public pages accessible without authentication. Roadmap voting/suggestions require login.
- **Priority**: P1

---

## 38. Edge Cases and Negative Tests

### TC-248: Room name -- special characters
- **Area**: Edge Case
- **Platform**: All
- **Steps**: 1. Create a room with name containing emoji, Unicode, and special chars: "Hello World 🌍 <script>".
- **Expected**: Room created. Name displayed correctly (emoji rendered, HTML not executed).
- **Priority**: P1

### TC-249: Display name -- whitespace only
- **Area**: Edge Case
- **Platform**: All
- **Steps**: 1. Try to set display name to "   " (spaces only).
- **Expected**: Validation rejects whitespace-only name. Trimmed result is blank, so continue button disabled.
- **Priority**: P1

### TC-250: PM -- empty message
- **Area**: Edge Case
- **Platform**: All
- **Steps**: 1. Open a chat. 2. Try to send an empty message.
- **Expected**: Send button disabled or message not sent.
- **Priority**: P1

### TC-251: Evidence upload -- oversized file
- **Area**: Edge Case
- **Platform**: All
- **Steps**: 1. In report dialog, try to attach a file exceeding EVIDENCE_MAX_SIZE_BYTES.
- **Expected**: Snackbar shows "File too large" error. File not attached.
- **Priority**: P1

### TC-252: Concurrent room join -- same user
- **Area**: Edge Case
- **Platform**: All
- **Steps**: 1. Join a room on device A. 2. Join the same room on device B with the same account.
- **Expected**: Handled gracefully. One session takes priority or both work without conflict.
- **Priority**: P2

### TC-253: Rapid button taps -- create room
- **Area**: Edge Case
- **Platform**: All
- **Steps**: 1. Tap "Create" button rapidly 5 times in create room dialog.
- **Expected**: Only one room created. No duplicate rooms.
- **Priority**: P1

### TC-254: Long text -- room chat message
- **Area**: Edge Case
- **Platform**: All
- **Steps**: 1. Send a 5000-character message in room chat.
- **Expected**: Message sent (or truncated to max length). Display handles long text with wrapping, no UI break.
- **Priority**: P2

### TC-255: Nationality flags -- all countries render
- **Area**: Edge Case
- **Platform**: All
- **Steps**: 1. Set nationality to various countries (US, JP, SA, KH, BR). 2. Observe flag emoji on room cards and profile.
- **Expected**: Flag emojis render correctly for all country codes. No missing/broken emojis.
- **Priority**: P2

### TC-256: Deep link to non-existent room
- **Area**: Edge Case
- **Platform**: All
- **Steps**: 1. Navigate to a room with a non-existent room ID.
- **Expected**: Error handled gracefully. User redirected back or error message shown.
- **Priority**: P1

### TC-257: Profile photo -- null photoUrl
- **Area**: Edge Case
- **Platform**: All
- **Steps**: 1. View a room card where a seated user has no profile photo.
- **Expected**: Placeholder icon (person icon) shown in primaryContainer color instead of broken image.
- **Priority**: P1

### TC-258: Session expiry -- Firebase token refresh
- **Area**: Edge Case
- **Platform**: All
- **Steps**: 1. Keep app open for 60+ minutes without interaction. 2. Perform an action.
- **Expected**: Firebase SDK auto-refreshes token. Action succeeds without re-authentication.
- **Priority**: P1

### TC-259: PIN -- boundary lengths
- **Area**: Edge Case
- **Platform**: All
- **Steps**: 1. Try to create a 3-digit PIN (below minimum). 2. Create a 4-digit PIN (minimum). 3. Create an 8-digit PIN (maximum). 4. Try 9 digits.
- **Expected**: 3 digits: submit button disabled (min 4). 4 digits: accepted. 8 digits: accepted. 9 digits: keypad stops accepting input (max 8).
- **Priority**: P1

### TC-260: Admin panel -- concurrent admin actions
- **Area**: Edge Case
- **Platform**: Web Admin
- **Steps**: 1. Two admins simultaneously suspend the same user.
- **Expected**: No crash or data corruption. Last action wins or conflict handled.
- **Priority**: P2

### TC-261: Gacha spin -- exactly zero coins
- **Area**: Edge Case
- **Platform**: All
- **Steps**: 1. Set coin balance to 0. 2. Open Lucky Spin. 3. Try to spin.
- **Expected**: Insufficient coins error. Spin does not execute.
- **Priority**: P1

### TC-262: Self-destruct TTS -- deactivation
- **Area**: Edge Case
- **Platform**: All
- **Steps**: 1. Self-destruct countdown starts (TTS announces). 2. Owner returns before timeout.
- **Expected**: TTS announces "Self destruct sequence deactivated." Owner away banner disappears.
- **Priority**: P2

### TC-263: Web admin -- CSP compliance
- **Area**: Edge Case
- **Platform**: Web
- **Steps**: 1. Open admin panel. 2. Check browser console for CSP violations.
- **Expected**: No Content-Security-Policy violations in console. All scripts, styles, and connections allowed by the CSP header.
- **Priority**: P1


## 31. Suspension Cascade -- Room State Matrix

These cases prove that suspending a user has the right effect on every active room they participate in or own. The contract is implemented in `express-api/src/utils/evict-suspended-user.js`; the manual cases here verify the user-visible behaviour end-to-end through the admin panel + app.

### TC-264: Suspend room owner -- room closes immediately
- **Area**: Moderation cascade
- **Platform**: Web Admin + App (Android, iOS)
- **Setup**: User A owns "TestRoom" with seats 0..7 occupied (A is owner; B + C are hosts; D..H are attendees). All 8 are connected on app + iOS Simulator.
- **Steps**: 1. Admin opens user A in Users -> Moderation. 2. Click "Suspend" with reason "QA owner cascade". 3. Confirm.
- **Expected**:
  - Room A's `state` flips to `CLOSED` in Firestore within 5 s.
  - All clients (owner A, hosts B+C, attendees D..H) receive `room_closed` RTDB event and navigate back to home.
  - `participantIds` and `hostIds` are emptied (clients can't re-join the closed room).
  - RTDB node `rooms/{roomId}` is removed.
  - User A's profile shows the suspension state on next sign-in.
- **Priority**: P0

### TC-265: Suspend room owner who has already left their room
- **Area**: Moderation cascade (edge)
- **Platform**: Web Admin
- **Setup**: User A owns "TestRoom" but has navigated away (A no longer in `participantIds`). Some attendees still present.
- **Steps**: 1. Suspend user A.
- **Expected**: Room A still closes (state=CLOSED). The owner-only Firestore query catches this case even when A is absent from `participantIds`.
- **Priority**: P0

### TC-266: Suspend a seated host -- demote + remove from seat
- **Area**: Moderation cascade
- **Platform**: Web Admin + App
- **Setup**: User B is a host (in `hostIds`) and seated in seat 1 of "TestRoom" owned by user A.
- **Steps**: 1. Admin suspends user B.
- **Expected**:
  - Room A `state` stays `ACTIVE`.
  - B is removed from `hostIds` AND `participantIds`.
  - Seat 1 becomes `{ userId: null, state: 'EMPTY', isMuted: false }`.
  - Other seats (owner A in 0, host C in 2, attendees in 3..7) are untouched.
  - Other clients receive `room_updated` RTDB event.
  - RTDB room node is NOT removed (room is still alive).
- **Priority**: P0

### TC-267: Suspend a host who is NOT seated
- **Area**: Moderation cascade
- **Platform**: Web Admin + App
- **Setup**: User B is a host (in `hostIds`) but no seat (still in `participantIds`).
- **Steps**: 1. Admin suspends user B.
- **Expected**: Removed from `hostIds` and `participantIds`. All seats unchanged. Room stays open.
- **Priority**: P0

### TC-268: Suspend a seated non-host attendee
- **Area**: Moderation cascade
- **Platform**: Web Admin + App
- **Setup**: User D is seated in seat 3 of "TestRoom" but is NOT in `hostIds`.
- **Steps**: 1. Admin suspends user D.
- **Expected**: Removed from `participantIds`. Seat 3 becomes empty. `hostIds` unchanged. Owner + hosts + other attendees unaffected.
- **Priority**: P0

### TC-269: Suspend a visitor (in room, not seated)
- **Area**: Moderation cascade
- **Platform**: Web Admin + App
- **Setup**: User V is in `participantIds` but no seat assigned.
- **Steps**: 1. Admin suspends user V.
- **Expected**: V removed from `participantIds`. Seats untouched. `hostIds` untouched. Room stays open.
- **Priority**: P0

### TC-270: Suspend a user who owns one room AND hosts another
- **Area**: Moderation cascade (multi-room)
- **Platform**: Web Admin
- **Setup**: User M owns "RoomA" (alone in it) and is also a host in "RoomB" (owned by another user, M is seated in seat 2).
- **Steps**: 1. Admin suspends user M.
- **Expected**:
  - RoomA: closed (state=CLOSED, RTDB node removed).
  - RoomB: M removed from `hostIds` + `participantIds`, seat 2 cleared, RoomB stays open.
  - Both rooms processed in the same suspension call.
- **Priority**: P1

### TC-271: Suspend a user with no active rooms
- **Area**: Moderation cascade (edge)
- **Platform**: Web Admin
- **Setup**: User L is offline and not in any rooms.
- **Steps**: 1. Admin suspends user L.
- **Expected**: No room state changes anywhere. User L's `currentRoomId` is cleared (was already null). Suspension still applied normally.
- **Priority**: P2

### TC-272: Concurrent suspension of all 8 users in a fully-occupied room
- **Area**: Moderation cascade (stress)
- **Platform**: Web Admin
- **Setup**: All 8 seats of "TestRoom" occupied: owner A, hosts B+C, attendees D..H.
- **Steps**: 1. Admin suspends user A. 2. Within 1 s, admin (or another admin tab) suspends each of B..H one after the other.
- **Expected**: Owner suspension closes the room first; subsequent suspensions on already-evicted users still cleanly clear `currentRoomId` and apply suspension to user docs. No 500 errors. No data corruption (`hostIds` / `participantIds` arrays don't desync).
- **Priority**: P1


## 32. Warning -- Room State Preserved

A warning is a SOFT moderation action: the user's GCS score drops, they get a notification, but their seat / role / room presence is preserved. These cases verify that contract for every user role.

### TC-273: Warn the room owner -- room state unchanged
- **Area**: Moderation soft-action
- **Platform**: Web Admin + App
- **Setup**: User A owns "TestRoom" with full 8-seat occupancy. A is online with the room screen open on Android + iOS.
- **Steps**: 1. Admin opens A's Users -> Moderation tab. 2. Issue warning "QA owner warning" severity 3. 3. Click "Issue Warning".
- **Expected**:
  - A's app shows WarningScreen overlay (real-time listener reacts to `hasActiveWarning=true`).
  - Room A is STILL `ACTIVE` -- no `state` change in Firestore.
  - A's `participantIds`/`hostIds`/seat occupancy unchanged.
  - A's GCS score decremented per severity table; `warningCount`++.
  - Other users (hosts + attendees) see no UI change.
- **Priority**: P0

### TC-274: Warn a seated host -- they keep their seat + host privileges
- **Area**: Moderation soft-action
- **Platform**: Web Admin + App
- **Setup**: User B is a host in seat 1 of A's "TestRoom".
- **Steps**: 1. Admin issues warning to B severity 4.
- **Expected**: B sees WarningScreen overlay. After acknowledging, B is still in seat 1, still in `hostIds`, can still kick attendees / mute / take seats. Room state unchanged.
- **Priority**: P0

### TC-275: Warn a seated non-host -- they keep their seat
- **Area**: Moderation soft-action
- **Platform**: Web Admin + App
- **Setup**: User D is in seat 3 (attendee).
- **Steps**: 1. Admin issues warning to D.
- **Expected**: D sees WarningScreen. After acknowledging, D is still in seat 3, still in `participantIds`. Room state unchanged.
- **Priority**: P0

### TC-276: Warn a visitor (not seated)
- **Area**: Moderation soft-action
- **Platform**: Web Admin + App
- **Setup**: User V is in `participantIds` but not seated.
- **Steps**: 1. Admin issues warning to V.
- **Expected**: V sees WarningScreen. After acknowledging, V is still in the room as visitor. No room state change.
- **Priority**: P0

### TC-277: Warning fields update on the user doc but NOT on the room doc
- **Area**: Moderation soft-action -- data integrity
- **Platform**: Web Admin (Firestore inspection)
- **Steps**: 1. Issue warning to a seated user. 2. Inspect Firestore `users/{uniqueId}` doc. 3. Inspect `rooms/{roomId}` doc.
- **Expected**: User doc has `gcsScore` decremented, `hasActiveWarning=true`, `hasNewWarning=true`, `warningCount` incremented, `warningReason` set, new doc at `users/{uid}/warnings/{warningId}`. Room doc has NO changes (no `state` flip, no `participantIds` edit, no `hostIds` edit, no seat change).
- **Priority**: P1


## 33. Host Action Permissions -- 8-Seat Full Room Matrix

These cases prove the policy gates inside `ChatRoom.canKickUser/canRemoveFromSeat/canForceMute/canTakeSeatDirectly/canInvite` (mirror of `ActiveRoomManager` enforcement) hold end-to-end. Run on a fully-occupied room with mixed roles.

### Setup for TC-278..TC-291
"TestRoom" with 8 seats occupied:
- Seat 0: User A -- owner
- Seat 1: User B -- host
- Seat 2: User C -- host
- Seat 3..7: Users D, E, F, G, H -- attendees

### TC-278: Owner can kick any host or attendee
- **Area**: Permission matrix
- **Platform**: App (Android, iOS)
- **Steps**: 1. As owner A, long-press host B's seat. 2. Tap "Kick". 3. Confirm. 4. Repeat for host C, attendee D, attendee H.
- **Expected**: Each kick succeeds; the target leaves the room (real-time listener disconnects them); their seat empties; system message "A user was kicked from the room. Reason: ..." is added to chat.
- **Priority**: P0

### TC-279: Owner cannot kick themselves
- **Area**: Permission matrix
- **Platform**: App
- **Steps**: 1. As owner A, attempt to long-press their own seat 0. 2. Look for kick option.
- **Expected**: Kick option is hidden / disabled for the owner's own seat. Attempting via API directly returns no-op (the policy rejects).
- **Priority**: P1

### TC-280: Host can kick attendees but NOT another host
- **Area**: Permission matrix
- **Platform**: App
- **Steps**: 1. As host B, kick attendee D -- expect success. 2. Long-press host C's seat -- "Kick" option must be hidden / disabled.
- **Expected**: Step 1 succeeds. Step 2: kick UI is not exposed for host C; if forced via dev tools / direct repository call, the policy rejects (no-op).
- **Priority**: P0

### TC-281: Host cannot kick the owner
- **Area**: Permission matrix
- **Platform**: App
- **Steps**: 1. As host B, long-press owner A's seat. 2. Look for kick option.
- **Expected**: Kick option not exposed. Direct API call rejected.
- **Priority**: P0

### TC-282: Attendee cannot kick anyone
- **Area**: Permission matrix
- **Platform**: App
- **Steps**: 1. As attendee D, long-press each other seat (owner, hosts, other attendees).
- **Expected**: No kick option visible on any seat. Attempted API call rejected.
- **Priority**: P0

### TC-283: Owner can remove any host/attendee from their seat (but not seat 0)
- **Area**: Permission matrix
- **Platform**: App
- **Steps**: 1. As owner A, long-press host B's seat -> "Remove from seat" -> confirm. 2. Repeat on attendee D's seat. 3. Try to "Remove from seat" on seat 0 (own seat).
- **Expected**: Steps 1+2 succeed -- the seat empties, user moves to "audience" / participant. Step 3: option not exposed.
- **Priority**: P0

### TC-284: Host can remove attendees but NOT other hosts from seats
- **Area**: Permission matrix
- **Platform**: App
- **Steps**: 1. As host B, "Remove from seat" attendee D -- expect success. 2. Long-press host C's seat -> look for option.
- **Expected**: Step 1 succeeds. Step 2: option not exposed. Direct API call rejected.
- **Priority**: P0

### TC-285: Attendee cannot remove anyone from a seat
- **Area**: Permission matrix
- **Platform**: App
- **Steps**: 1. As attendee D, long-press other seats.
- **Expected**: "Remove from seat" never exposed. API call rejected.
- **Priority**: P0

### TC-286: Owner can force-mute any host or attendee
- **Area**: Permission matrix
- **Platform**: App + admin RTDB inspection
- **Setup**: All 8 seated; mics unmuted.
- **Steps**: 1. As owner A, force-mute host B. 2. Force-mute attendee D.
- **Expected**: Each target's seat shows muted indicator; their voice transmission stops on other clients; only the user themselves can unmute (owner cannot un-force-mute -- second tap should be a no-op).
- **Priority**: P0

### TC-287: Host can force-mute attendees but NOT other hosts or the owner
- **Area**: Permission matrix
- **Platform**: App
- **Steps**: 1. As host B, force-mute attendee D -- expect success. 2. Try host C -- option not exposed. 3. Try owner A -- option not exposed.
- **Expected**: Step 1 succeeds. Steps 2+3: option not exposed. Direct API rejected.
- **Priority**: P0

### TC-288: Already-muted seat cannot be force-muted again
- **Area**: Permission matrix (idempotency)
- **Platform**: App
- **Setup**: Attendee D's seat is already muted (they self-muted).
- **Steps**: 1. As owner A, attempt to force-mute D's seat.
- **Expected**: No-op. Force-mute is a one-way action; only the user themselves can unmute.
- **Priority**: P1

### TC-289: Only owner can take seat 0; non-owners cannot
- **Area**: Permission matrix (seat policy)
- **Platform**: App
- **Setup**: Owner has temporarily left seat 0 (seat 0 EMPTY).
- **Steps**: 1. As host B, attempt to tap seat 0 to sit. 2. As attendee D, attempt to tap seat 0. 3. As owner A, tap seat 0.
- **Expected**: Steps 1+2: rejected (no-op or "owner only" message). Step 3: A takes seat 0.
- **Priority**: P0

### TC-290: Host can self-invite to a non-owner seat when room does NOT require approval
- **Area**: Permission matrix (seat policy)
- **Platform**: App
- **Setup**: Room A `requireApproval=false`. Seat 5 is empty. User B is a host but NOT seated.
- **Steps**: 1. As host B, tap seat 5.
- **Expected**: B is seated immediately in seat 5. No approval round-trip. Seat 5 OCCUPIED with B.
- **Priority**: P0

### TC-291: Host CANNOT self-invite when room DOES require approval
- **Area**: Permission matrix (seat policy)
- **Platform**: App
- **Setup**: Room A `requireApproval=true`. Seat 5 empty. User B is a host but not seated.
- **Steps**: 1. As host B, tap seat 5.
- **Expected**: A seat-request is created (same flow as attendees). B does NOT bypass approval just because they're a host. Owner A sees the request and approves/denies.
- **Priority**: P0

### TC-292: Attendee can NEVER take a seat directly -- always goes through seat-request
- **Area**: Permission matrix (seat policy)
- **Platform**: App
- **Setup**: Seat 5 empty in BOTH a no-approval room AND an approval-required room.
- **Steps**: 1. As attendee D in the no-approval room, tap seat 5. 2. As attendee D in the approval-required room, tap seat 5.
- **Expected**: Both cases create a seat-request rather than seating directly. The presence/absence of `requireApproval` does not change attendee behaviour.
- **Priority**: P0

### TC-293: Host can invite peers when no approval required; not when required
- **Area**: Permission matrix (invite policy)
- **Platform**: App
- **Steps**: 1. Open Invite User flow as host B in a `requireApproval=false` room -- send. 2. Switch to a `requireApproval=true` room -- attempt invite.
- **Expected**: Step 1: invite sent (FCM push fires). Step 2: invite UI not exposed / rejected.
- **Priority**: P1

