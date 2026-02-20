const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onValueDeleted } = require("firebase-functions/v2/database");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getDatabase } = require("firebase-admin/database");
const { getStorage } = require("firebase-admin/storage");
const { AccessToken } = require("livekit-server-sdk");

initializeApp();

const livekitApiKey = defineSecret("LIVEKIT_API_KEY");
const livekitApiSecret = defineSecret("LIVEKIT_API_SECRET");

const MAX_SEATS = 8;
const OWNER_SEAT_INDEX = 0;

// Extract a storage path from a Firebase Storage download URL
function extractStoragePath(url) {
  if (!url) return null;
  const match = url.match(/\/o\/(.+?)\?/);
  return match ? decodeURIComponent(match[1]) : null;
}

exports.generateLiveKitToken = onCall({ secrets: [livekitApiKey, livekitApiSecret] }, async (request) => {
  const { roomName, identity } = request.data;

  if (!roomName || !identity) {
    throw new HttpsError(
      "invalid-argument",
      "roomName and identity are required"
    );
  }

  const at = new AccessToken(livekitApiKey.value(), livekitApiSecret.value(), {
    identity: identity,
    ttl: "24h",
  });

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
  });

  const token = await at.toJwt();

  console.log(`Generated LiveKit token for room=${roomName} identity=${identity}`);
  return { token };
});

// Clean up Firestore when a user's presence is removed (app closed/crashed)
exports.onPresenceRemoved = onValueDeleted(
  { ref: "/presence/{roomId}/{userId}", instance: "shytalk-7ba69-default-rtdb", region: "asia-southeast1" },
  async (event) => {
    const roomId = event.params.roomId;
    const userId = event.params.userId;

    console.log(`Presence removed: room=${roomId} user=${userId}`);

    // Grace period: wait 15 seconds then re-check presence.
    // RTDB connections can drop briefly (mobile power management, network
    // fluctuations).  If the user reconnects within the grace window their
    // presence entry reappears and we skip cleanup entirely.
    await new Promise((resolve) => setTimeout(resolve, 15000));

    const rtdb = getDatabase();
    const presenceSnap = await rtdb.ref(`presence/${roomId}/${userId}`).get();
    if (presenceSnap.exists()) {
      console.log(`User ${userId} presence re-established in room ${roomId}, skipping cleanup`);
      return;
    }

    const db = getFirestore();
    const roomRef = db.collection("rooms").doc(roomId);

    try {
      await db.runTransaction(async (transaction) => {
        const roomDoc = await transaction.get(roomRef);
        if (!roomDoc.exists) {
          console.log(`Room ${roomId} does not exist, skipping cleanup`);
          return;
        }

        const room = roomDoc.data();

        // Skip if room is already closed
        if (room.state === "CLOSED") {
          console.log(`Room ${roomId} already closed, skipping`);
          return;
        }

        // Skip if user is not in the room (already left normally)
        const participantIds = room.participantIds || [];
        if (!participantIds.includes(userId)) {
          console.log(`User ${userId} not in room ${roomId}, skipping`);
          return;
        }

        const isOwner = room.ownerId === userId;
        const seats = room.seats || {};
        const updates = {};

        // Clear any pending invites for this user
        if (room.pendingInvites && room.pendingInvites[userId]) {
          updates[`pendingInvites.${userId}`] = require("firebase-admin/firestore").FieldValue.delete();
        }

        if (isOwner) {
          // --- Owner disconnected ---
          // Owner keeps seat 0 and stays in participantIds for reconnection.
          // Only transition the room state.

          // Check if any other user is still seated (on mic)
          let anyoneOnMic = false;
          for (let i = 0; i < MAX_SEATS; i++) {
            if (i === OWNER_SEAT_INDEX) continue;
            const seat = seats[i.toString()];
            if (seat && seat.userId && seat.userId !== userId && seat.state === "OCCUPIED") {
              anyoneOnMic = true;
              break;
            }
          }

          if (anyoneOnMic) {
            // Others still on mic — mark owner away, preserve seat 0
            updates.state = "OWNER_AWAY";
            updates.ownerLeftAt = require("firebase-admin/firestore").Timestamp.now();
            const currentOwnerSeat = seats[OWNER_SEAT_INDEX.toString()];
            updates[`seats.${OWNER_SEAT_INDEX}`] = {
              userId: userId,
              state: "OCCUPIED",
              isMuted: (currentOwnerSeat && currentOwnerSeat.isMuted) || false,
            };
            console.log(`Owner left room ${roomId}, users still on mic - setting OWNER_AWAY (seat 0 preserved)`);
          } else {
            // Owner is alone — close immediately
            updates.state = "CLOSED";
            updates.closedAt = require("firebase-admin/firestore").Timestamp.now();
            updates.participantIds = [];
            for (let i = 0; i < MAX_SEATS; i++) {
              updates[`seats.${i.toString()}`] = { userId: null, state: "EMPTY", isMuted: false };
            }
            console.log(`Owner left room ${roomId}, no users on mic - closing immediately`);
          }
        } else {
          // --- Non-owner disconnected ---
          // Clear their seat but keep them in participantIds.
          // They may reconnect; seat is the only thing removed on disconnect.
          for (let i = 0; i < MAX_SEATS; i++) {
            if (i === OWNER_SEAT_INDEX) continue;
            const key = i.toString();
            const seat = seats[key];
            if (seat && seat.userId === userId && seat.state === "OCCUPIED") {
              updates[`seats.${key}`] = { userId: null, state: "EMPTY", isMuted: false };
              break;
            }
          }

          // If no one is on mic anymore and owner is away, close the room
          if (room.state === "OWNER_AWAY") {
            let anyoneOnMic = false;
            for (let i = 0; i < MAX_SEATS; i++) {
              if (i === OWNER_SEAT_INDEX) continue;
              const key = i.toString();
              // Check the seat AFTER our clear (use updates if we just cleared it)
              const seat = updates[`seats.${key}`] || seats[key];
              if (seat && seat.userId && seat.userId !== userId && seat.state === "OCCUPIED") {
                anyoneOnMic = true;
                break;
              }
            }
            if (!anyoneOnMic) {
              updates.state = "CLOSED";
              updates.closedAt = require("firebase-admin/firestore").Timestamp.now();
              updates.participantIds = [];
              for (let i = 0; i < MAX_SEATS; i++) {
                updates[`seats.${i.toString()}`] = { userId: null, state: "EMPTY", isMuted: false };
              }
              console.log(`No one on mic in OWNER_AWAY room ${roomId} — closing`);
            }
          }
        }

        transaction.update(roomRef, updates);
        console.log(`Cleaned up user ${userId} from room ${roomId}`);
      });
    } catch (error) {
      console.error(`Error cleaning up presence for room=${roomId} user=${userId}:`, error);
    }
  }
);

// --- Suspension enforcement trigger ---
exports.onUserSuspended = onDocumentUpdated(
  { document: "users/{userId}", region: "asia-southeast1" },
  async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    const userId = event.params.userId;

    // Only act when isSuspended transitions false → true
    if (before.isSuspended === true || after.isSuspended !== true) return;

    console.log(`User ${userId} suspended — enforcing`);

    // 1. Revoke Firebase Auth refresh tokens (forces sign-out on all devices)
    try {
      await getAuth().revokeRefreshTokens(userId);
      console.log(`Revoked tokens for ${userId}`);
    } catch (err) {
      console.error(`Failed to revoke tokens for ${userId}:`, err);
    }

    const db = getFirestore();

    // 2. Evict from rooms
    try {
      const roomsSnapshot = await db.collection("rooms")
        .where("participantIds", "array-contains", userId)
        .where("state", "in", ["ACTIVE", "OWNER_AWAY"])
        .get();

      for (const roomDoc of roomsSnapshot.docs) {
        const room = roomDoc.data();
        const roomRef = roomDoc.ref;
        const isOwner = room.ownerId === userId;

        if (isOwner) {
          // Close the room entirely
          const updates = {
            state: "CLOSED",
            closedAt: FieldValue.serverTimestamp(),
            participantIds: [],
          };
          for (let i = 0; i < MAX_SEATS; i++) {
            updates[`seats.${i}`] = { userId: null, state: "EMPTY", isMuted: false };
          }
          await roomRef.update(updates);
          console.log(`Closed room ${roomDoc.id} (owner suspended)`);
        } else {
          // Remove non-owner from room
          const updates = {
            participantIds: FieldValue.arrayRemove(userId),
          };
          const seats = room.seats || {};
          for (let i = 0; i < MAX_SEATS; i++) {
            const seat = seats[i.toString()];
            if (seat && seat.userId === userId) {
              updates[`seats.${i}`] = { userId: null, state: "EMPTY", isMuted: false };
            }
          }
          await roomRef.update(updates);
          console.log(`Removed ${userId} from room ${roomDoc.id}`);
        }
      }
    } catch (err) {
      console.error(`Failed to evict ${userId} from rooms:`, err);
    }

    // 3. Clear currentRoomId on user doc
    try {
      if (after.currentRoomId) {
        await db.collection("users").doc(userId).update({ currentRoomId: null });
      }
    } catch (err) {
      console.error(`Failed to clear currentRoomId for ${userId}:`, err);
    }

    // 4. Remove RTDB presence entries
    try {
      const rtdb = getDatabase();
      const presenceSnap = await rtdb.ref("presence").get();
      if (presenceSnap.exists()) {
        const rooms = presenceSnap.val();
        for (const roomId of Object.keys(rooms)) {
          if (rooms[roomId] && rooms[roomId][userId]) {
            await rtdb.ref(`presence/${roomId}/${userId}`).remove();
            console.log(`Removed presence for ${userId} in room ${roomId}`);
          }
        }
      }
    } catch (err) {
      console.error(`Failed to remove presence for ${userId}:`, err);
    }

    // 5. Mask profile (displayName → "Suspended Account", clear photos)
    // _preSuspension snapshot is already stored by the suspend endpoint
    try {
      await db.collection("users").doc(userId).update({
        displayName: "Suspended Account",
        profilePhotoUrl: null,
        coverPhotoUrl: null,
      });
      console.log(`Masked profile for ${userId}`);
    } catch (err) {
      console.error(`Failed to mask profile for ${userId}:`, err);
    }
  }
);

// --- PM Notification on new message ---
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { getMessaging } = require("firebase-admin/messaging");

exports.sendPmNotification = onDocumentCreated(
  { document: "conversations/{conversationId}/messages/{messageId}", region: "asia-southeast1" },
  async (event) => {
    const message = event.data.data();
    const conversationId = event.params.conversationId;

    if (!message || !message.senderId) {
      console.log("No message data or senderId, skipping");
      return;
    }

    console.log(`PM notification: conversation=${conversationId} sender=${message.senderId}`);

    const db = getFirestore();

    // Get conversation to find the other participant
    const convDoc = await db.collection("conversations").doc(conversationId).get();
    if (!convDoc.exists) {
      console.log("Conversation doc not found");
      return;
    }

    const conv = convDoc.data();
    // Notify all participants except the sender (supports both 1-on-1 and group)
    const recipientIds = (conv.participantIds || []).filter((id) => id !== message.senderId);
    if (recipientIds.length === 0) {
      console.log("No recipients found in participantIds");
      return;
    }

    console.log(`Recipients: ${recipientIds.join(", ")}`);

    // Get sender info once
    const senderDoc = await db.collection("users").doc(message.senderId).get();
    const senderName = senderDoc.exists ? senderDoc.data().displayName || "Someone" : "Someone";

    // Process each recipient
    for (const recipientId of recipientIds) {
      console.log(`Processing recipient: ${recipientId}`);

      // Check recipient's notification settings
      const recipientDoc = await db.collection("users").doc(recipientId).get();
      if (!recipientDoc.exists) continue;

      const recipient = recipientDoc.data();
      if (recipient.pmNotificationsEnabled === false) continue;

      // Check DND schedule
      if (recipient.dndEnabled) {
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        const currentTime = currentHour * 60 + currentMinute;
        const startTime = (recipient.dndStartHour || 22) * 60 + (recipient.dndStartMinute || 0);
        const endTime = (recipient.dndEndHour || 8) * 60 + (recipient.dndEndMinute || 0);

        let isDnd = false;
        if (startTime <= endTime) {
          isDnd = currentTime >= startTime && currentTime < endTime;
        } else {
          // Wraps midnight (e.g. 22:00 - 08:00)
          isDnd = currentTime >= startTime || currentTime < endTime;
        }
        if (isDnd) continue;
      }

      // Check if conversation is muted
      const settingsRef = db
        .collection("conversations")
        .doc(conversationId)
        .collection("settings")
        .doc(recipientId);
      const settingsDoc = await settingsRef.get();

      if (settingsDoc.exists) {
        const settings = settingsDoc.data();
        if (settings.isMuted) {
          // Still increment unread count even if muted
          await settingsRef.update({ unreadCount: FieldValue.increment(1) });
          continue;
        }
      }

      // Increment unread count for recipient
      await settingsRef.set({ unreadCount: FieldValue.increment(1) }, { merge: true });

      // Build notification body
      const showPreview = recipient.pmNotificationPreview !== false;
      let body;
      if (showPreview) {
        if (message.type === "IMAGE") body = "Sent an image";
        else if (message.type === "STICKER") body = "Sent a sticker";
        else if (message.type === "ROOM_INVITE") body = "Invited you to a room";
        else body = (message.text || "").substring(0, 100);
      } else {
        body = "New message";
      }

      // For groups, prefix with group name
      const notifTitle = conv.isGroup
        ? `${senderName} in ${conv.groupName || "Group"}`
        : senderName;

      // Send to all FCM tokens
      const tokens = recipient.fcmTokens || [];
      console.log(`FCM tokens for ${recipientId}: ${tokens.length}`);
      if (tokens.length === 0) continue;

      const payload = {
        data: {
          type: "PM",
          senderName: notifTitle,
          messageText: body,
          senderId: message.senderId,
          conversationId: conversationId,
          isGroup: String(conv.isGroup || false),
          showPreview: String(showPreview),
        },
      };

      const tokensToRemove = [];
      await Promise.all(
        tokens.map(async (token) => {
          try {
            await getMessaging().send({ ...payload, token });
          } catch (err) {
            if (
              err.code === "messaging/invalid-registration-token" ||
              err.code === "messaging/registration-token-not-registered"
            ) {
              tokensToRemove.push(token);
            }
          }
        })
      );

      // Clean up invalid tokens
      if (tokensToRemove.length > 0) {
        await db.collection("users").doc(recipientId).update({
          fcmTokens: FieldValue.arrayRemove(...tokensToRemove),
        });
        console.log(`Removed ${tokensToRemove.length} invalid FCM tokens for ${recipientId}`);
      }
    }
  }
);

// --- System PM helper ---
// Sends a private message from the SHYTALK_SYSTEM account to a recipient.
// Auto-creates the system user doc and conversation if needed.
async function sendSystemPm(recipientUid, text) {
  const SYSTEM_UID = "SHYTALK_SYSTEM";
  const SYSTEM_NAME = "ShyTalk";
  const db = getFirestore();

  // Auto-create system user doc if it doesn't exist
  const systemUserRef = db.collection("users").doc(SYSTEM_UID);
  const systemDoc = await systemUserRef.get();
  if (!systemDoc.exists) {
    await systemUserRef.set({
      displayName: SYSTEM_NAME,
      userType: "SYSTEM",
      profilePhotoUrl: "https://firebasestorage.googleapis.com/v0/b/shytalk-7ba69.firebasestorage.app/o/system%2Fshytalk_icon.webp?alt=media&token=30b0256e-3bd6-4cae-ac50-31b596df98e8",
      uniqueId: 0,
      createdAt: FieldValue.serverTimestamp(),
      lastSeenAt: FieldValue.serverTimestamp(),
    });
  }

  // Get or create 1-on-1 conversation using deterministic ID
  // Must match app's Conversation.generateId(): listOf(uid1, uid2).sorted().joinToString("_")
  const participantIds = [SYSTEM_UID, recipientUid].sort();
  const conversationId = participantIds.join("_");
  const convRef = db.collection("conversations").doc(conversationId);
  const convDoc = await convRef.get();

  const lastMessagePreview = {
    text: text.substring(0, 100),
    senderId: SYSTEM_UID,
    senderName: SYSTEM_NAME,
    createdAt: FieldValue.serverTimestamp(),
    type: "TEXT",
  };

  if (!convDoc.exists) {
    await convRef.set({
      participantIds,
      isGroup: false,
      createdAt: FieldValue.serverTimestamp(),
      lastMessage: lastMessagePreview,
      lastMessageAt: FieldValue.serverTimestamp(),
    });
    // Create default settings for both participants
    const settingsCol = convRef.collection("settings");
    await settingsCol.doc(SYSTEM_UID).set({ unreadCount: 0, isMuted: false, isPinned: false, isHidden: false });
    await settingsCol.doc(recipientUid).set({ unreadCount: 0, isMuted: false, isPinned: false, isHidden: false });
  }

  // Write message
  const msgRef = convRef.collection("messages").doc();
  await msgRef.set({
    senderId: SYSTEM_UID,
    senderName: SYSTEM_NAME,
    text,
    type: "TEXT",
    createdAt: FieldValue.serverTimestamp(),
  });

  // Update conversation last message preview
  await convRef.update({
    lastMessage: lastMessagePreview,
    lastMessageAt: FieldValue.serverTimestamp(),
  });

  return conversationId;
}

// Export for use in admin.js
exports._sendSystemPm = sendSystemPm;

// --- Admin push notification on new report ---
exports.onNewReport = onDocumentCreated(
  { document: "reports/{reportId}", region: "asia-southeast1" },
  async (event) => {
    const report = event.data.data();
    if (!report) return;

    const reportType = report.reason || "Unknown";
    const reportedUserName = report.reportedUserName || "a user";

    console.log(`New report: ${reportType} against ${reportedUserName}`);

    // Find all admin users via custom claims
    const db = getFirestore();
    const auth = getAuth();

    // Query admin tokens collection
    const tokensSnap = await db.collection("admin_tokens").get();
    if (tokensSnap.empty) {
      console.log("No admin tokens registered");
      return;
    }

    const tokens = tokensSnap.docs.map((doc) => doc.data().token).filter(Boolean);
    if (tokens.length === 0) return;

    const payload = {
      data: {
        type: "ADMIN_NEW_REPORT",
        title: "New Report",
        body: `${reportType} report against ${reportedUserName}`,
      },
    };

    const tokensToRemove = [];
    await Promise.all(
      tokens.map(async (token) => {
        try {
          await getMessaging().send({ ...payload, token });
        } catch (err) {
          if (
            err.code === "messaging/invalid-registration-token" ||
            err.code === "messaging/registration-token-not-registered"
          ) {
            tokensToRemove.push(token);
          }
        }
      })
    );

    // Clean up invalid tokens
    if (tokensToRemove.length > 0) {
      const batch = db.batch();
      const invalidSnaps = await db.collection("admin_tokens")
        .where("token", "in", tokensToRemove.slice(0, 30))
        .get();
      invalidSnaps.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      console.log(`Removed ${invalidSnaps.size} invalid admin tokens`);
    }
  }
);

// --- Scheduled: Archive old resolved reports (runs weekly) ---
const { onSchedule } = require("firebase-functions/v2/scheduler");

exports.archiveOldReports = onSchedule(
  { schedule: "every sunday 03:00", region: "asia-southeast1", timeZone: "UTC" },
  async () => {
    const db = getFirestore();
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const snapshot = await db.collection("reports")
      .where("status", "==", "resolved")
      .where("resolvedAt", "<", sixMonthsAgo)
      .limit(500)
      .get();

    if (snapshot.empty) {
      console.log("No reports to archive");
      return;
    }

    const batch = db.batch();
    for (const doc of snapshot.docs) {
      batch.set(db.collection("reports_archive").doc(doc.id), doc.data());
      batch.delete(doc.ref);
    }
    await batch.commit();
    console.log(`Archived ${snapshot.size} old reports`);
  }
);

// --- Scheduled: Daily orphaned-storage cleanup ---
async function cleanupOrphanedFiles() {
  const db = getFirestore();
  const referencedPaths = new Set();

  // Hardcoded system asset
  referencedPaths.add("system/shytalk_icon.webp");

  // Users → profilePhotoUrl, coverPhotoUrl, _preSuspension.*
  const usersSnap = await db.collection("users").get();
  for (const doc of usersSnap.docs) {
    const data = doc.data();
    const urls = [
      data.profilePhotoUrl,
      data.coverPhotoUrl,
      data._preSuspension && data._preSuspension.profilePhotoUrl,
      data._preSuspension && data._preSuspension.coverPhotoUrl,
    ];
    for (const url of urls) {
      const path = extractStoragePath(url);
      if (path) referencedPaths.add(path);
    }
  }

  // Conversations → groupPhotoUrl + messages (IMAGE → imageUrls, STICKER → stickerUrl)
  const convsSnap = await db.collection("conversations").get();
  for (const doc of convsSnap.docs) {
    const data = doc.data();
    const gPath = extractStoragePath(data.groupPhotoUrl);
    if (gPath) referencedPaths.add(gPath);

    const imageSnap = await doc.ref.collection("messages").where("type", "==", "IMAGE").get();
    for (const msgDoc of imageSnap.docs) {
      for (const url of (msgDoc.data().imageUrls || [])) {
        const p = extractStoragePath(url);
        if (p) referencedPaths.add(p);
      }
    }

    const stickerSnap = await doc.ref.collection("messages").where("type", "==", "STICKER").get();
    for (const msgDoc of stickerSnap.docs) {
      const p = extractStoragePath(msgDoc.data().stickerUrl);
      if (p) referencedPaths.add(p);
    }
  }

  // Reports + archive → evidenceUrls[]
  for (const col of ["reports", "reports_archive"]) {
    const snap = await db.collection(col).get();
    for (const doc of snap.docs) {
      for (const url of (doc.data().evidenceUrls || [])) {
        const p = extractStoragePath(url);
        if (p) referencedPaths.add(p);
      }
    }
  }

  // List and delete orphaned files across all storage folders
  const bucket = getStorage().bucket();
  const folders = ["pm_images/", "stickers/", "report_evidence/", "profile_photos/", "cover_photos/", "group_photos/"];
  const results = {};
  let totalDeleted = 0;

  for (const folder of folders) {
    const [files] = await bucket.getFiles({ prefix: folder });
    let deleted = 0;
    for (const file of files) {
      if (!referencedPaths.has(file.name)) {
        await file.delete();
        deleted++;
      }
    }
    results[folder.replace("/", "")] = { total: files.length, deleted };
    totalDeleted += deleted;
    console.log(`${folder}: ${deleted}/${files.length} files deleted`);
  }

  console.log(`Orphaned storage cleanup complete: ${totalDeleted} files deleted`);
  return { totalDeleted, results };
}

exports.cleanupOrphanedStorage = onSchedule(
  {
    schedule: "every day 04:00",
    region: "asia-southeast1",
    timeZone: "UTC",
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async () => {
    const result = await cleanupOrphanedFiles();
    console.log("Scheduled orphan cleanup result:", JSON.stringify(result));
  }
);

exports.purgeOrphanedStorageNow = onCall(
  { region: "asia-southeast1", timeoutSeconds: 540, memory: "512MiB" },
  async (request) => {
    if (!request.auth || request.auth.token.admin !== true) {
      throw new HttpsError("permission-denied", "Admin access required");
    }
    return await cleanupOrphanedFiles();
  }
);

// Export for admin.js to reuse
exports._cleanupOrphanedFiles = cleanupOrphanedFiles;

// --- Mod action notification trigger ---
exports.onModAction = onDocumentCreated(
  { document: "conversations/{conversationId}/mod_log/{logId}", region: "asia-southeast1" },
  async (event) => {
    const logEntry = event.data.data();
    const conversationId = event.params.conversationId;

    if (!logEntry) return;

    console.log(`Mod action: ${logEntry.action} in conversation=${conversationId} by ${logEntry.modName}`);

    const db = getFirestore();

    // Get conversation to determine notify mode and admin/owner list
    const convDoc = await db.collection("conversations").doc(conversationId).get();
    if (!convDoc.exists) {
      console.log("Conversation not found");
      return;
    }

    const conv = convDoc.data();
    const modNotifyMode = conv.modNotifyMode || "ALL_ADMINS";
    const groupName = conv.groupName || "Group";

    // Determine recipients based on notify mode
    let recipientIds;
    if (modNotifyMode === "OWNER_ONLY") {
      recipientIds = conv.createdBy ? [conv.createdBy] : [];
    } else {
      // ALL_ADMINS — notify owner + all admins
      const adminIds = conv.groupAdminIds || [];
      recipientIds = [...new Set([conv.createdBy, ...adminIds].filter(Boolean))];
    }

    // Exclude the mod who performed the action
    recipientIds = recipientIds.filter((id) => id !== logEntry.modId);

    if (recipientIds.length === 0) {
      console.log("No recipients for mod action notification");
      return;
    }

    // Build notification text
    const actionText = {
      MUTE: `muted ${logEntry.targetUserName}`,
      UNMUTE: `unmuted ${logEntry.targetUserName}`,
      HIDE_MESSAGE: `hid a message from ${logEntry.targetUserName}`,
    }[logEntry.action] || `performed ${logEntry.action} on ${logEntry.targetUserName}`;

    const body = `${logEntry.modName} ${actionText} in ${groupName}`;

    // Send push to each recipient
    for (const recipientId of recipientIds) {
      const userDoc = await db.collection("users").doc(recipientId).get();
      if (!userDoc.exists) continue;

      const tokens = userDoc.data().fcmTokens || [];
      if (tokens.length === 0) continue;

      const payload = {
        data: {
          type: "MOD_ACTION",
          title: `Mod Action in ${groupName}`,
          body: body,
          conversationId: conversationId,
          action: logEntry.action || "",
          modName: logEntry.modName || "",
        },
      };

      const tokensToRemove = [];
      await Promise.all(
        tokens.map(async (token) => {
          try {
            await getMessaging().send({ ...payload, token });
          } catch (err) {
            if (
              err.code === "messaging/invalid-registration-token" ||
              err.code === "messaging/registration-token-not-registered"
            ) {
              tokensToRemove.push(token);
            }
          }
        })
      );

      if (tokensToRemove.length > 0) {
        await db.collection("users").doc(recipientId).update({
          fcmTokens: FieldValue.arrayRemove(...tokensToRemove),
        });
        console.log(`Removed ${tokensToRemove.length} invalid FCM tokens for ${recipientId}`);
      }
    }
  }
);

// ─── Monetization ───────────────────────────────────────────────

const DAILY_BASE = 50;
const MILESTONE_REWARDS = {
  7: 100, 14: 200, 30: 500, 60: 1000, 90: 2000
};
function getDailyReward(day) {
  return MILESTONE_REWARDS[day] || DAILY_BASE;
}
const MILESTONES = new Set([7, 14, 30, 60, 90]);
const PULL_COSTS = { 1: 10, 10: 100, 100: 1000 };

// Base drop rates: [Common, Uncommon, Rare, Epic, Legendary]
const BASE_RATES = [0.74, 0.18, 0.06, 0.015, 0.005];
const BRACKETS = ["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"];

exports.claimDailyReward = onCall({ region: "asia-southeast1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");
  const uid = request.auth.uid;
  const db = getFirestore();
  const userRef = db.collection("users").doc(uid);

  return await db.runTransaction(async (tx) => {
    const userDoc = await tx.get(userRef);
    if (!userDoc.exists) throw new HttpsError("not-found", "User not found");
    const user = userDoc.data();

    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    if (user.lastLoginRewardDate === today) {
      throw new HttpsError("already-exists", "Already claimed today");
    }

    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    const lastDate = user.lastLoginDate || "";
    const newStreak = (lastDate === yesterday) ? (user.loginStreak || 0) + 1 : 1;

    let reward = getDailyReward(newStreak);
    const isMilestone = MILESTONES.has(newStreak);

    // Super Shy 10% bonus (rounded up)
    if (user.isSuperShy) {
      reward = Math.ceil(reward * 1.1);
    }

    const newBalance = (user.shyCoins || 0) + reward;

    tx.update(userRef, {
      shyCoins: newBalance,
      loginStreak: newStreak,
      lastLoginDate: today,
      lastLoginRewardDate: today,
    });

    // Write transaction record
    const txRef = userRef.collection("transactions").doc();
    tx.set(txRef, {
      type: "DAILY_REWARD",
      amount: reward,
      currency: "COINS",
      balanceAfter: newBalance,
      details: `Day ${newStreak}${isMilestone ? " (milestone)" : ""}`,
      timestamp: FieldValue.serverTimestamp(),
    });

    return { coinsAwarded: reward, newStreak, isMilestone, newBalance };
  });
});

exports.pullGacha = onCall({ region: "asia-southeast1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");
  const uid = request.auth.uid;
  const pullCount = request.data.pullCount;

  if (![1, 10, 100].includes(pullCount)) {
    throw new HttpsError("invalid-argument", "pullCount must be 1, 10, or 100");
  }

  const cost = PULL_COSTS[pullCount];
  const db = getFirestore();
  const userRef = db.collection("users").doc(uid);

  // Load gift catalog
  const giftsSnap = await db.collection("gifts").orderBy("order").get();
  if (giftsSnap.empty) throw new HttpsError("failed-precondition", "Gift catalog not configured");

  const giftsByBracket = {};
  for (const b of BRACKETS) giftsByBracket[b] = [];
  giftsSnap.docs.forEach((doc) => {
    const g = { id: doc.id, ...doc.data() };
    if (giftsByBracket[g.bracket]) giftsByBracket[g.bracket].push(g);
  });

  return await db.runTransaction(async (tx) => {
    const userDoc = await tx.get(userRef);
    if (!userDoc.exists) throw new HttpsError("not-found", "User not found");
    const user = userDoc.data();

    if ((user.shyCoins || 0) < cost) {
      throw new HttpsError("failed-precondition", "Insufficient coins");
    }

    let pity = user.pityCounter || 0;
    let luck = user.luckScore || 0;
    const results = [];

    for (let i = 0; i < pullCount; i++) {
      // Calculate effective rates
      const rates = [...BASE_RATES];

      // Pity system
      if (pity >= 150) {
        // Hard pity: force Epic+
        rates[0] = 0; rates[1] = 0; rates[2] = 0;
        const epicLeg = BASE_RATES[3] + BASE_RATES[4];
        rates[3] = BASE_RATES[3] / epicLeg;
        rates[4] = BASE_RATES[4] / epicLeg;
      } else if (pity >= 100) {
        const pityBoost = (pity - 100) / 50; // 0→1 linear over 50 pulls
        const shift = 0.10 * pityBoost;
        rates[0] -= shift;
        rates[3] += shift;
      }

      // Luck boost (up to 5%)
      const luckBoost = (luck / 100) * 0.05;
      if (luckBoost > 0 && rates[0] > luckBoost) {
        rates[0] -= luckBoost;
        // Distribute proportionally across higher brackets
        const higherTotal = rates[1] + rates[2] + rates[3] + rates[4];
        if (higherTotal > 0) {
          for (let b = 1; b < 5; b++) {
            rates[b] += luckBoost * (rates[b] / higherTotal);
          }
        }
      }

      // Normalize rates
      const total = rates.reduce((s, r) => s + r, 0);
      for (let b = 0; b < 5; b++) rates[b] /= total;

      // Roll
      const roll = Math.random();
      let cumulative = 0;
      let bracketIndex = 0;
      for (let b = 0; b < 5; b++) {
        cumulative += rates[b];
        if (roll <= cumulative) { bracketIndex = b; break; }
      }

      const bracket = BRACKETS[bracketIndex];
      const gifts = giftsByBracket[bracket];
      if (!gifts || gifts.length === 0) {
        // Fallback to common
        const fallback = giftsByBracket["COMMON"];
        const gift = fallback[Math.floor(Math.random() * fallback.length)];
        results.push(gift);
        pity++;
        continue;
      }

      const gift = gifts[Math.floor(Math.random() * gifts.length)];
      results.push(gift);

      // Reset pity on Epic+
      if (bracketIndex >= 3) {
        pity = 0;
      } else {
        pity++;
      }
    }

    // 100-pull luck bonus
    if (pullCount === 100) {
      luck = Math.min(100, luck + 2);
    }

    const newBalance = (user.shyCoins || 0) - cost;

    // Update user
    tx.update(userRef, {
      shyCoins: newBalance,
      pityCounter: pity,
      luckScore: luck,
    });

    // Add gifts to backpack
    for (const gift of results) {
      const bpRef = userRef.collection("backpack").doc(gift.id);
      tx.set(bpRef, {
        quantity: FieldValue.increment(1),
        lastAcquired: FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    // Write transaction
    const txRef = userRef.collection("transactions").doc();
    tx.set(txRef, {
      type: "GACHA_PULL",
      amount: -cost,
      currency: "COINS",
      balanceAfter: newBalance,
      pullCount,
      details: results.map((g) => g.name).join(", "),
      timestamp: FieldValue.serverTimestamp(),
    });

    return {
      gifts: results.map((g) => ({
        giftId: g.id,
        giftName: g.name,
        bracket: g.bracket,
        coinValue: g.coinValue,
        iconUrl: g.iconUrl || "",
      })),
      coinsSpent: cost,
      newBalance,
      newPityCounter: pity,
      newLuckScore: luck,
    };
  });
});

exports.sendGift = onCall({ region: "asia-southeast1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");
  const senderUid = request.auth.uid;
  const { recipientId, giftId } = request.data;

  if (!recipientId || !giftId) {
    throw new HttpsError("invalid-argument", "recipientId and giftId required");
  }
  if (senderUid === recipientId) {
    throw new HttpsError("invalid-argument", "Cannot send gift to yourself");
  }

  const db = getFirestore();
  const senderRef = db.collection("users").doc(senderUid);
  const recipientRef = db.collection("users").doc(recipientId);
  const giftRef = db.collection("gifts").doc(giftId);

  const giftDoc = await giftRef.get();
  if (!giftDoc.exists) throw new HttpsError("not-found", "Gift not found");
  const gift = giftDoc.data();

  return await db.runTransaction(async (tx) => {
    const bpRef = senderRef.collection("backpack").doc(giftId);
    const bpDoc = await tx.get(bpRef);

    if (!bpDoc.exists || (bpDoc.data().quantity || 0) < 1) {
      throw new HttpsError("failed-precondition", "Gift not in backpack");
    }

    const senderDoc = await tx.get(senderRef);
    const recipientDoc = await tx.get(recipientRef);
    if (!recipientDoc.exists) throw new HttpsError("not-found", "Recipient not found");

    const sender = senderDoc.data();
    const recipient = recipientDoc.data();
    const beanReward = Math.floor(gift.coinValue * 0.6);

    // Decrement sender backpack
    const newQty = (bpDoc.data().quantity || 0) - 1;
    if (newQty <= 0) {
      tx.delete(bpRef);
    } else {
      tx.update(bpRef, { quantity: newQty });
    }

    // Update recipient gift wall
    const wallRef = recipientRef.collection("giftWall").doc(giftId);
    tx.set(wallRef, {
      receivedCount: FieldValue.increment(1),
      [`senders.${senderUid}`]: FieldValue.increment(1),
    }, { merge: true });

    // Credit beans to recipient
    tx.update(recipientRef, {
      shyBeans: FieldValue.increment(beanReward),
    });

    // Transaction records
    const senderTxRef = senderRef.collection("transactions").doc();
    tx.set(senderTxRef, {
      type: "GIFT_SENT",
      amount: -1,
      currency: "COINS",
      balanceAfter: sender.shyCoins || 0,
      giftId, giftName: gift.name,
      recipientId,
      timestamp: FieldValue.serverTimestamp(),
    });

    const recipientTxRef = recipientRef.collection("transactions").doc();
    tx.set(recipientTxRef, {
      type: "GIFT_RECEIVED",
      amount: beanReward,
      currency: "BEANS",
      balanceAfter: (recipient.shyBeans || 0) + beanReward,
      giftId, giftName: gift.name,
      senderId: senderUid,
      timestamp: FieldValue.serverTimestamp(),
    });

    return { success: true, beanReward, giftName: gift.name };
  }).then(async (result) => {
    // Broadcast if eligible (outside transaction)
    if (gift.broadcastEnabled) {
      const senderDoc = await senderRef.get();
      const recipientDoc = await recipientRef.get();
      const senderData = senderDoc.data();
      const recipientData = recipientDoc.data();

      const broadcastsRef = db.collection("broadcasts");
      await broadcastsRef.add({
        senderName: senderData.displayName || "",
        senderPhotoUrl: senderData.profilePhotoUrl || null,
        recipientName: recipientData.displayName || "",
        giftName: gift.name,
        giftIconUrl: gift.iconUrl || "",
        giftCoinValue: gift.coinValue,
        timestamp: FieldValue.serverTimestamp(),
      });

      // Keep only last 50 broadcasts
      const oldBroadcasts = await broadcastsRef
        .orderBy("timestamp", "desc")
        .offset(50)
        .get();
      const batch = db.batch();
      oldBroadcasts.docs.forEach((doc) => batch.delete(doc.ref));
      if (!oldBroadcasts.empty) await batch.commit();
    }

    return result;
  });
});

exports.redeemBeans = onCall({ region: "asia-southeast1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");
  const uid = request.auth.uid;
  const amount = request.data.amount;

  if (!amount || typeof amount !== "number" || amount < 1) {
    throw new HttpsError("invalid-argument", "amount must be a positive number");
  }

  const db = getFirestore();
  const userRef = db.collection("users").doc(uid);

  return await db.runTransaction(async (tx) => {
    const userDoc = await tx.get(userRef);
    if (!userDoc.exists) throw new HttpsError("not-found", "User not found");
    const user = userDoc.data();

    if ((user.shyBeans || 0) < amount) {
      throw new HttpsError("failed-precondition", "Insufficient beans");
    }

    const coins = amount >= 2000 ? Math.floor(amount * 1.1) : amount;
    const newBeans = (user.shyBeans || 0) - amount;
    const newCoins = (user.shyCoins || 0) + coins;

    tx.update(userRef, {
      shyBeans: newBeans,
      shyCoins: newCoins,
    });

    const txRef = userRef.collection("transactions").doc();
    tx.set(txRef, {
      type: "BEAN_REDEEM",
      amount: coins,
      currency: "COINS",
      balanceAfter: newCoins,
      details: `Redeemed ${amount} beans${amount >= 2000 ? " (10% bonus)" : ""}`,
      timestamp: FieldValue.serverTimestamp(),
    });

    return { coinsReceived: coins, newCoinBalance: newCoins, newBeanBalance: newBeans };
  });
});

exports.validatePurchase = onCall({ region: "asia-southeast1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");
  const uid = request.auth.uid;
  const { productId, purchaseToken, isSubscription } = request.data;

  if (!productId || !purchaseToken) {
    throw new HttpsError("invalid-argument", "productId and purchaseToken required");
  }

  const db = getFirestore();
  const userRef = db.collection("users").doc(uid);

  // TODO: Add Google Play Developer API verification of purchaseToken here
  // For now, trust the client (acceptable during development/testing)

  if (isSubscription) {
    const tierMap = {
      super_shy_monthly: { tier: "monthly", days: 30 },
      super_shy_yearly: { tier: "yearly", days: 365 },
      super_shy_lifetime: { tier: "lifetime", days: null },
    };

    const sub = tierMap[productId];
    if (!sub) throw new HttpsError("invalid-argument", "Unknown subscription product");

    const expiry = sub.days ? new Date(Date.now() + sub.days * 86400000) : null;

    await userRef.update({
      isSuperShy: true,
      superShyExpiry: expiry ? require("firebase-admin/firestore").Timestamp.fromDate(expiry) : null,
      superShyTier: sub.tier,
    });

    const txRef = userRef.collection("transactions").doc();
    await txRef.set({
      type: "SUBSCRIPTION",
      amount: 0,
      currency: "COINS",
      balanceAfter: 0,
      details: `Super Shy ${sub.tier}`,
      timestamp: FieldValue.serverTimestamp(),
    });

    return { success: true, tier: sub.tier };
  } else {
    // Coin package
    const packagesSnap = await db.collection("coinPackages")
      .where("productId", "==", productId)
      .limit(1)
      .get();

    if (packagesSnap.empty) throw new HttpsError("not-found", "Unknown coin package");

    const pkg = packagesSnap.docs[0].data();
    const totalCoins = (pkg.coins || 0) + (pkg.bonusCoins || 0);

    return await db.runTransaction(async (tx) => {
      const userDoc = await tx.get(userRef);
      if (!userDoc.exists) throw new HttpsError("not-found", "User not found");
      const user = userDoc.data();
      const newBalance = (user.shyCoins || 0) + totalCoins;

      tx.update(userRef, { shyCoins: newBalance });

      const txDocRef = userRef.collection("transactions").doc();
      tx.set(txDocRef, {
        type: "PURCHASE",
        amount: totalCoins,
        currency: "COINS",
        balanceAfter: newBalance,
        details: `${pkg.coins} + ${pkg.bonusCoins} bonus coins`,
        timestamp: FieldValue.serverTimestamp(),
      });

      return { success: true, coinsAdded: totalCoins, newBalance };
    });
  }
});

exports.checkSubscriptionStatus = onSchedule(
  { schedule: "every day 00:00", region: "asia-southeast1", timeZone: "UTC" },
  async () => {
    const db = getFirestore();
    const now = require("firebase-admin/firestore").Timestamp.now();

    const expiredSnap = await db.collection("users")
      .where("isSuperShy", "==", true)
      .where("superShyExpiry", "<=", now)
      .get();

    let expired = 0;
    for (const doc of expiredSnap.docs) {
      const data = doc.data();
      if (data.superShyTier === "lifetime") continue;
      await doc.ref.update({
        isSuperShy: false,
        superShyExpiry: null,
        superShyTier: null,
      });
      expired++;
    }
    console.log(`Expired ${expired} Super Shy subscriptions`);
  }
);

exports.updateGiftRankings = onSchedule(
  { schedule: "every 1 hours", region: "asia-southeast1", timeZone: "UTC", memory: "512MiB" },
  async () => {
    const db = getFirestore();
    const giftsSnap = await db.collection("gifts").get();

    for (const giftDoc of giftsSnap.docs) {
      const giftId = giftDoc.id;

      // Query all users who have this gift on their wall
      const wallSnap = await db.collectionGroup("giftWall")
        .where(require("firebase-admin/firestore").FieldPath.documentId(), "==", giftId)
        .get();

      // Not feasible with collectionGroup by doc ID directly, so we iterate all users
      // Alternative approach: aggregate from giftWall subcollections
      // For now, we'll use a simpler approach based on the data we have
    }

    // Simplified: scan users' giftWall for each gift
    const usersSnap = await db.collection("users").select().get(); // Just get IDs

    for (const giftDoc of giftsSnap.docs) {
      const giftId = giftDoc.id;
      const entries = [];
      let totalSent = 0;

      for (const userDoc of usersSnap.docs) {
        const wallDoc = await db.collection("users").doc(userDoc.id)
          .collection("giftWall").doc(giftId).get();
        if (wallDoc.exists) {
          const data = wallDoc.data();
          const count = data.receivedCount || 0;
          totalSent += count;
          entries.push({ userId: userDoc.id, count });
        }
      }

      entries.sort((a, b) => b.count - a.count);
      const top100 = entries.slice(0, 100);

      // Fetch display names for top 100
      const rankings = [];
      for (const entry of top100) {
        const uDoc = await db.collection("users").doc(entry.userId).get();
        const uData = uDoc.exists ? uDoc.data() : {};
        rankings.push({
          userId: entry.userId,
          count: entry.count,
          displayName: uData.displayName || "",
          profilePhotoUrl: uData.profilePhotoUrl || null,
        });
      }

      await db.collection("giftRankings").doc(giftId).set({
        rankings,
        totalSent,
        lastUpdated: FieldValue.serverTimestamp(),
      });
    }

    console.log("Gift rankings updated");
  }
);

// --- Seed gift & coin package catalogs ---
exports.seedCatalog = onCall({ region: "asia-southeast1" }, async (request) => {
  if (!request.auth || request.auth.token.admin !== true) {
    throw new HttpsError("permission-denied", "Admin access required");
  }

  const db = getFirestore();

  const giftCatalog = [
    { name: "Rose", coinValue: 8, baseDropRate: 0.70, bracket: "COMMON", order: 1 },
    { name: "Heart", coinValue: 10, baseDropRate: 0.70, bracket: "COMMON", order: 2 },
    { name: "Thumbs Up", coinValue: 12, baseDropRate: 0.70, bracket: "COMMON", order: 3 },
    { name: "Star", coinValue: 15, baseDropRate: 0.70, bracket: "COMMON", order: 4 },
    { name: "Smiley", coinValue: 18, baseDropRate: 0.70, bracket: "COMMON", order: 5 },
    { name: "Coffee", coinValue: 20, baseDropRate: 0.70, bracket: "COMMON", order: 6 },
    { name: "Candy", coinValue: 25, baseDropRate: 0.70, bracket: "COMMON", order: 7 },
    { name: "Balloon", coinValue: 30, baseDropRate: 0.70, bracket: "COMMON", order: 8 },
    { name: "Teddy Bear", coinValue: 50, baseDropRate: 0.20, bracket: "UNCOMMON", order: 9 },
    { name: "Perfume", coinValue: 80, baseDropRate: 0.20, bracket: "UNCOMMON", order: 10 },
    { name: "Diamond Ring", coinValue: 120, baseDropRate: 0.20, bracket: "UNCOMMON", order: 11 },
    { name: "Bouquet", coinValue: 150, baseDropRate: 0.20, bracket: "UNCOMMON", order: 12 },
    { name: "Fireworks", coinValue: 200, baseDropRate: 0.20, bracket: "UNCOMMON", order: 13 },
    { name: "Music Box", coinValue: 300, baseDropRate: 0.20, bracket: "UNCOMMON", order: 14 },
    { name: "Treasure Chest", coinValue: 500, baseDropRate: 0.08, bracket: "RARE", order: 15 },
    { name: "Crown", coinValue: 800, baseDropRate: 0.08, bracket: "RARE", order: 16 },
    { name: "Sports Car", coinValue: 1200, baseDropRate: 0.08, bracket: "RARE", order: 17 },
    { name: "Yacht", coinValue: 1800, baseDropRate: 0.08, bracket: "RARE", order: 18 },
    { name: "Dragon", coinValue: 2500, baseDropRate: 0.08, bracket: "RARE", order: 19 },
    { name: "Phoenix", coinValue: 3500, baseDropRate: 0.08, bracket: "RARE", order: 20 },
    { name: "Crystal Ball", coinValue: 5000, baseDropRate: 0.018, bracket: "EPIC", order: 21 },
    { name: "Castle", coinValue: 8000, baseDropRate: 0.018, bracket: "EPIC", order: 22 },
    { name: "Spaceship", coinValue: 12000, baseDropRate: 0.018, bracket: "EPIC", order: 23 },
    { name: "Aurora", coinValue: 16000, baseDropRate: 0.018, bracket: "EPIC", order: 24 },
    { name: "Galaxy Unicorn", coinValue: 20000, baseDropRate: 0.018, bracket: "EPIC", order: 25 },
    { name: "ShyTalk Emblem", coinValue: 35000, baseDropRate: 0.002, bracket: "LEGENDARY", order: 26 },
    { name: "Celestial Throne", coinValue: 52000, baseDropRate: 0.002, bracket: "LEGENDARY", order: 27 },
  ];

  const coinPackages = [
    { productId: "coins_100", coins: 100, bonusCoins: 0, displayPrice: "$0.99", order: 1, isActive: true },
    { productId: "coins_500", coins: 500, bonusCoins: 50, displayPrice: "$4.99", order: 2, isActive: true },
    { productId: "coins_1200", coins: 1200, bonusCoins: 200, displayPrice: "$9.99", order: 3, isActive: true },
    { productId: "coins_2500", coins: 2500, bonusCoins: 500, displayPrice: "$19.99", order: 4, isActive: true },
    { productId: "coins_6500", coins: 6500, bonusCoins: 1500, displayPrice: "$49.99", order: 5, isActive: true },
    { productId: "coins_14000", coins: 14000, bonusCoins: 4000, displayPrice: "$99.99", order: 6, isActive: true },
  ];

  const batch = db.batch();

  for (const gift of giftCatalog) {
    const docId = gift.name.toLowerCase().replace(/\s+/g, "_");
    batch.set(db.collection("gifts").doc(docId), {
      ...gift,
      beanValue: Math.floor(gift.coinValue * 0.6),
      broadcastEnabled: gift.bracket === "LEGENDARY",
      animationUrl: "",
      soundUrl: "",
      iconUrl: "",
    }, { merge: true });
  }

  for (const pkg of coinPackages) {
    batch.set(db.collection("coinPackages").doc(pkg.productId), pkg, { merge: true });
  }

  // App config (force update minimum version, etc.)
  batch.set(db.collection("config").doc("app"), {
    minVersionCode: 1,
  }, { merge: true });

  await batch.commit();
  return { giftsSeeded: giftCatalog.length, packagesSeeded: coinPackages.length, configSeeded: true };
});


// --- Admin API ---
const adminApp = require("./admin");
exports.adminApi = onRequest({ region: "asia-southeast1" }, adminApp);

// deploy 1771560904
