# Private Messaging System - Comprehensive Manual Test Plan

## Prerequisites
- Two test devices (or emulators) with ShyTalk installed
- Two test accounts (User A and User B)
- One admin test account (for Phase 15)
- Firebase Console access for verifying Firestore data
- Internet connection

---

## Phase 1: Conversation List

### TC-1.1: Empty state
- [ ] Open Messages tab with no existing conversations
- [ ] Verify empty state UI displays ("No conversations yet")

### TC-1.2: Start a new conversation
- [ ] Navigate to a user's profile (User B)
- [ ] Tap "Message" button
- [ ] Verify conversation is created and chat screen opens
- [ ] Navigate back to Messages tab
- [ ] Verify new conversation appears in the list

### TC-1.3: Conversation list ordering
- [ ] Send a message in Conversation 1
- [ ] Send a message in Conversation 2
- [ ] Verify Conversation 2 appears above Conversation 1 (sorted by lastMessageAt)

### TC-1.4: Last message preview
- [ ] Send "Hello there" in a conversation
- [ ] Go back to conversation list
- [ ] Verify preview shows "Hello there" with sender name and timestamp

### TC-1.5: Unread count badge
- [ ] From User B, send a message to User A
- [ ] On User A's device, check conversation list shows unread indicator
- [ ] Open the conversation and go back
- [ ] Verify unread indicator is cleared

---

## Phase 2: Basic Text Messaging

### TC-2.1: Send a text message
- [ ] Open a chat with User B
- [ ] Type "Hello" and tap send
- [ ] Verify message appears in the chat with "Sent" status (single checkmark)

### TC-2.2: Receive a text message
- [ ] From User B's device, send a message to User A
- [ ] On User A's device, verify message appears in real-time

### TC-2.3: Message length limit
- [ ] Attempt to type a message longer than 2000 characters
- [ ] Verify input field stops accepting characters at the limit

### TC-2.4: Empty message
- [ ] Verify send button is disabled when text field is empty
- [ ] Verify send button is disabled with only whitespace

### TC-2.5: Read receipts
- [ ] From User A, send a message to User B
- [ ] On User A, verify single checkmark (sent)
- [ ] On User B, open the conversation
- [ ] On User A, verify double checkmark appears (read)

---

## Phase 3: Image Messaging

### TC-3.1: Send a single image
- [ ] Tap image picker in chat
- [ ] Select one image (under 5MB)
- [ ] Verify image uploads and appears in chat bubble

### TC-3.2: Send multiple images
- [ ] Select multiple images (up to 10)
- [ ] Verify image grid renders correctly (1 image: full width, 2: side by side, 3+: grid)

### TC-3.3: Image size limit
- [ ] Attempt to send an image larger than 5MB
- [ ] Verify appropriate error message

### TC-3.4: Image tap to view
- [ ] Tap a sent/received image
- [ ] Verify full-screen image viewer opens

---

## Phase 4: Reply to Messages

### TC-4.1: Reply to a text message
- [ ] Long-press a message
- [ ] Tap "Reply" from context menu
- [ ] Verify reply preview bar appears above input field
- [ ] Type a reply and send
- [ ] Verify the sent message shows quoted reply preview

### TC-4.2: Reply to an image message
- [ ] Long-press an image message and tap "Reply"
- [ ] Verify reply preview shows "[Image]"
- [ ] Send the reply and verify it displays correctly

### TC-4.3: Cancel reply
- [ ] Start a reply (long-press > Reply)
- [ ] Tap the X button on the reply preview bar
- [ ] Verify reply is cancelled and preview disappears

---

## Phase 5: Edit Messages

### TC-5.1: Edit a sent message within 15 minutes
- [ ] Send a message
- [ ] Long-press the message
- [ ] Tap "Edit" from context menu
- [ ] Verify editing indicator bar appears and text field is pre-populated
- [ ] Change text and send
- [ ] Verify message updates and shows "Edited (1)" label

### TC-5.2: Edit window expiry
- [ ] Send a message and wait 15+ minutes
- [ ] Long-press the message
- [ ] Verify "Edit" option is NOT available in context menu

### TC-5.3: Cancel edit
- [ ] Start editing a message
- [ ] Tap X on the editing indicator bar
- [ ] Verify edit is cancelled and text field clears

### TC-5.4: Edit history
- [ ] Edit a message multiple times
- [ ] Tap "Edited (N)" on the message
- [ ] Verify edit history dialog shows previous versions with timestamps

---

## Phase 6: Copy Message

### TC-6.1: Copy text message
- [ ] Long-press a text message
- [ ] Tap "Copy" from context menu
- [ ] Paste in another app
- [ ] Verify correct text was copied

---

## Phase 7: Conversation Settings (Mute, Pin)

### TC-7.1: Mute conversation
- [ ] Open chat overflow menu (3 dots)
- [ ] Tap "Mute Notifications"
- [ ] Verify menu now shows "Unmute Notifications"
- [ ] Have User B send a message — verify NO notification on User A

### TC-7.2: Pin conversation
- [ ] Tap "Pin" from overflow menu
- [ ] Go to conversation list
- [ ] Verify pinned conversation appears at top

### TC-7.4: Delete (hide) conversation
- [ ] Tap "Delete Conversation" from overflow menu
- [ ] Verify you navigate back to conversation list
- [ ] Verify conversation no longer appears in list

---

## Phase 8: Block & Privacy Restrictions

### TC-8.1: Block prevents messaging
- [ ] User A blocks User B from their profile
- [ ] User B navigates to User A's chat
- [ ] Verify blocked banner shows: "You are blocked by this user"
- [ ] Verify input field is hidden

### TC-8.2: Self-block message
- [ ] User A navigates to blocked User B's chat
- [ ] Verify banner shows: "You have blocked this user. Unblock them to send messages."

### TC-8.3: PM Privacy - NO_ONE
- [ ] Set User B's PM privacy to NO_ONE
- [ ] User A tries to message User B
- [ ] Verify: "This user does not accept private messages."

### TC-8.4: PM Privacy - FOLLOWERS_ONLY
- [ ] Set User B's PM privacy to FOLLOWERS_ONLY
- [ ] User A (not followed by B) tries to message B
- [ ] Verify: "This user only accepts messages from people they follow."
- [ ] Have User B follow User A
- [ ] Retry — verify messaging now works

---

## Phase 9: Report Message

### TC-9.1: Report a received message
- [ ] Long-press a message from User B
- [ ] Tap "Report Message"
- [ ] Verify report dialog appears with reason options
- [ ] Select "Harassment" and add optional description
- [ ] Tap "Submit Report"
- [ ] Verify snackbar confirmation: "Report submitted"

### TC-9.2: Cannot report own messages
- [ ] Long-press your own sent message
- [ ] Verify "Report Message" is NOT in the context menu

### TC-9.3: Verify report in Firestore
- [ ] Open Firebase Console > Firestore > `reports` collection
- [ ] Verify report document exists with correct reporterId, reason, messageText

---

## Phase 10: Typing Indicators

### TC-10.1: Show typing indicator
- [ ] User A opens chat with User B
- [ ] User B starts typing in the chat
- [ ] On User A's device, verify "typing..." appears in green below User B's name in the top bar

### TC-10.2: Typing indicator auto-clears
- [ ] User B starts typing then stops
- [ ] After ~5 seconds, verify "typing..." disappears on User A's screen
- [ ] Verify online status or "Last seen" returns

### TC-10.3: Typing clears on send
- [ ] User B types and sends a message
- [ ] Verify "typing..." disappears immediately on User A's screen

---

## Phase 11: Date Separators & Timestamps

### TC-11.1: Date separators
- [ ] In a conversation with messages from different days
- [ ] Verify date separator pills appear between days (e.g., "Today", "Yesterday", "Feb 15, 2026")

### TC-11.2: Timestamps on messages
- [ ] Verify each message shows a relative timestamp (e.g., "2m", "1h", "Yesterday")

### TC-11.3: Toggle timestamp display
- [ ] Go to Settings > Notifications
- [ ] Toggle "Show Timestamps" off
- [ ] Go back to chat — verify timestamps are hidden
- [ ] Toggle back on — verify timestamps reappear

### TC-11.4: Toggle date separators
- [ ] Toggle "Show Date Separators" off in Settings > Notifications
- [ ] Verify date separator pills are hidden in chat

---

## Phase 12: Pagination (Load Older Messages)

### TC-12.1: Load older messages
- [ ] In a conversation with 50+ messages
- [ ] Scroll to the top
- [ ] Verify loading indicator appears
- [ ] Verify older messages load above
- [ ] Repeat until no more messages (loading indicator stops appearing)

---

## Phase 13: PM Notifications (Cloud Function)

### TC-13.1: Receive push notification
- [ ] User A has app in background
- [ ] User B sends a message to User A
- [ ] Verify User A receives a push notification with sender name and message preview

### TC-13.2: Muted conversation - no notification
- [ ] User A mutes a conversation
- [ ] User B sends a message
- [ ] Verify User A does NOT receive a push notification

### TC-13.3: DND schedule blocks notifications
- [ ] Set DND schedule in Settings (e.g., 22:00 - 08:00)
- [ ] Have User B send a message during DND hours
- [ ] Verify no notification received
- [ ] Send a message outside DND hours — verify notification IS received

---

## Phase 14: Online Status & Last Seen

### TC-14.1: Online status in chat
- [ ] Both users have the chat open
- [ ] Verify "Online" shows in green below the other user's name

### TC-14.2: Last seen
- [ ] User B closes the app
- [ ] After 5+ minutes, check User A's chat header
- [ ] Verify "Last seen X ago" appears

### TC-14.3: Hide online status
- [ ] User B enables "Hide Online Status" in their profile
- [ ] On User A's chat, verify online/last seen info is hidden

---

## Phase 15: Admin Report Review Dashboard

### TC-15.1: Access report review screen
- [ ] Navigate to report review screen (via admin navigation)
- [ ] Verify list of pending reports loads

### TC-15.2: View report details
- [ ] Tap a report card
- [ ] Verify action dialog shows options: Warning, Temp Suspension, Perm Suspension, PM Ban, No Action Needed

### TC-15.3: Resolve a report
- [ ] Select an action and confirm
- [ ] Verify report disappears from pending list
- [ ] In Firestore, verify report status is "RESOLVED" with action recorded

---

## Phase 16: Emoji Reactions

### TC-16.1: Add reaction via context menu
- [ ] Long-press a message
- [ ] Tap "React"
- [ ] Verify reaction picker appears with 6 emoji options
- [ ] Tap heart emoji
- [ ] Verify heart reaction badge appears below the message

### TC-16.2: Toggle reaction off
- [ ] Tap the heart reaction badge on a message you already reacted to
- [ ] Verify the reaction is removed

### TC-16.3: Multiple reactions from different users
- [ ] User A reacts with heart, User B reacts with thumbs up
- [ ] Verify both reaction badges appear with correct counts
- [ ] User B also reacts with heart
- [ ] Verify heart badge shows count "2"

### TC-16.4: Own reaction highlighting
- [ ] Add a reaction to a message
- [ ] Verify your reaction badge has primary container background (highlighted)
- [ ] Verify other users' reactions have surface variant background

---

## Phase 17: Auto-Moderation

### TC-17.1: Prohibited word detection
- [ ] Add test prohibited words via Firestore `config/moderation` document
- [ ] Try to send a message containing a prohibited word
- [ ] Verify warning: "Your message may contain inappropriate content."
- [ ] Verify message is NOT sent

### TC-17.2: Spam detection
- [ ] Send the exact same message 3 times within 1 minute
- [ ] Verify 3rd attempt shows: "Please wait before sending the same message again."
- [ ] Wait 1 minute and try again — verify it goes through

### TC-17.3: Different messages are not spam
- [ ] Send 3 different messages rapidly
- [ ] Verify all go through without spam warning

---

## Phase 18: Background Sync Service

### TC-18.1: PmSyncService starts
- [ ] Open a conversation to trigger service
- [ ] Check running services (Settings > Apps > ShyTalk > Running Services)
- [ ] Verify "Syncing messages" notification appears with minimum priority

### TC-18.2: Service survives app background
- [ ] Put app in background
- [ ] Verify service notification remains
- [ ] Verify messages still sync in the background

---

## Phase 19: Sticker Picker

### TC-19.1: Open sticker picker
- [ ] Verify sticker picker UI has two tabs: "Recent" and "My Stickers"
- [ ] Verify "No recent stickers" empty state on Recent tab
- [ ] Verify "No stickers yet" empty state on My Stickers tab

### TC-19.2: Sticker grid layout
- [ ] Add test stickers via Firestore
- [ ] Verify 4-column grid displays stickers
- [ ] Verify tapping a sticker triggers selection callback

---

## Phase 20: In-Chat Message Search

### TC-20.1: Open search
- [ ] Tap the search icon in the chat top bar
- [ ] Verify search bar appears below the top bar

### TC-20.2: Search messages
- [ ] Type a search query (at least 2 characters)
- [ ] Verify result count label appears (e.g., "3 result(s)")
- [ ] Verify message list filters to show only matching messages

### TC-20.3: Close search
- [ ] Tap the X button on the search bar
- [ ] Verify search bar disappears
- [ ] Verify full message list is restored

### TC-20.4: No results
- [ ] Search for a term that doesn't exist in the conversation
- [ ] Verify "0 result(s)" or empty list

---

## Phase 22: Do Not Disturb Schedule

### TC-22.1: Enable DND
- [ ] Go to Settings > Notifications
- [ ] Toggle DND on
- [ ] Verify DND time display shows (e.g., "22:00 - 08:00")

### TC-22.2: DND fields saved to user
- [ ] Enable DND with custom hours
- [ ] In Firestore, verify user document has `dndEnabled: true`, `dndStartHour`, `dndStartMinute`, `dndEndHour`, `dndEndMinute`

### TC-22.3: DND wraps midnight
- [ ] Set DND from 23:00 to 07:00
- [ ] Verify notification suppression works across midnight boundary

---

## Phase 23: Group Chats (Infrastructure)

### TC-23.1: Group conversation model
- [ ] In Firestore, manually create a conversation with `isGroup: true`, `groupName`, `groupAdminIds`, `participantIds` (3+ users)
- [ ] Verify the conversation loads in the app's conversation list

### TC-23.2: Group name display
- [ ] Verify group conversations show `groupName` instead of the other user's name

### TC-23.3: Group admin helpers
- [ ] Verify `isAdmin()` returns true for creator and admin IDs
- [ ] Verify `isOneOnOne` returns false for group conversations

### TC-23.4: Add/remove participants
- [ ] Call `addGroupParticipant` via test code or Firestore
- [ ] Verify participant appears in `participantIds` array
- [ ] Call `removeGroupParticipant`
- [ ] Verify participant is removed

### TC-23.5: Update group name
- [ ] Call `updateGroupName` with a new name
- [ ] Verify group name updates in Firestore

---

## Phase 24: Notification Settings

### TC-24.1: Notification settings page
- [ ] Go to Settings
- [ ] Tap "Notifications"
- [ ] Verify all toggles are visible: PM Notifications, Sound, Message Preview

### TC-24.2: Toggle PM notifications
- [ ] Toggle PM Notifications off
- [ ] Have another user send a message
- [ ] Verify no notification received

### TC-24.3: Toggle sound
- [ ] Toggle Sound off
- [ ] Receive a message — verify notification is silent

### TC-24.4: Toggle message preview
- [ ] Toggle "Message Preview" off
- [ ] Receive a message — verify notification shows sender name but NOT message content

### TC-24.5: Chat display toggles
- [ ] Toggle timestamps and date separators
- [ ] Verify changes apply to chat screen

---

## Cross-Cutting Tests

### TC-X.1: Offline behavior
- [ ] Enable airplane mode
- [ ] Try to send a message
- [ ] Verify appropriate offline indicator or retry behavior

### TC-X.2: Rapid navigation
- [ ] Quickly navigate between conversation list and multiple chats
- [ ] Verify no crashes or state corruption

### TC-X.3: Large conversation
- [ ] Open a conversation with 100+ messages
- [ ] Verify smooth scrolling and proper pagination

### TC-X.4: App kill and restore
- [ ] Open a chat, kill the app, relaunch
- [ ] Navigate to the same chat
- [ ] Verify all messages are intact

### TC-X.5: Multiple active conversations
- [ ] Have both users send messages in different conversations simultaneously
- [ ] Verify all conversations update correctly without crosstalk

---

## Notes

- All Firestore document checks can be done via Firebase Console
- For DND testing, you may need to adjust device time or set DND window to current time
- Cloud Function logs viewable via `firebase functions:log`
- For deep link testing, use `adb shell am start` with the appropriate intent URI
