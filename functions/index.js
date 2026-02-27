const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onValueDeleted } = require("firebase-functions/v2/database");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getDatabase } = require("firebase-admin/database");
const { AccessToken } = require("livekit-server-sdk");
const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = require("@aws-sdk/client-s3");

initializeApp();

const livekitApiKey = defineSecret("LIVEKIT_API_KEY");
const livekitApiSecret = defineSecret("LIVEKIT_API_SECRET");

const MAX_SEATS = 8;
const OWNER_SEAT_INDEX = 0;

// Extract a storage path from a Firebase Storage download URL (legacy — kept for reference)
function extractStoragePath(url) {
  if (!url) return null;
  const match = url.match(/\/o\/(.+?)\?/);
  return match ? decodeURIComponent(match[1]) : null;
}

// Extract an R2 object key from a public R2 URL
// e.g. "https://images.shytalk.shyden.co.uk/profile_photos/uid/123.jpg" → "profile_photos/uid/123.jpg"
function extractR2Key(url) {
  const prefix = "https://images.shytalk.shyden.co.uk/";
  if (!url || !url.startsWith(prefix)) return null;
  return url.slice(prefix.length);
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
          // Remove non-owner from room and ban to prevent auto-rejoin
          const updates = {
            participantIds: FieldValue.arrayRemove(userId),
            bannedUserIds: FieldValue.arrayUnion(userId),
            [`kickInfo.${userId}`]: { reason: "Account suspended", kickerName: "System" },
          };
          const seats = room.seats || {};
          for (let i = 0; i < MAX_SEATS; i++) {
            const seat = seats[i.toString()];
            if (seat && seat.userId === userId) {
              updates[`seats.${i}`] = { userId: null, state: "EMPTY", isMuted: false };
            }
          }
          await roomRef.update(updates);
          console.log(`Removed and banned ${userId} from room ${roomDoc.id}`);
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

        // Skip unread increment if recipient has already read past this message
        if (settings.lastReadAt && message.createdAt && settings.lastReadAt >= message.createdAt) {
          continue;
        }

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

// --- Scheduled: Daily orphaned-storage cleanup (uses Cloudflare R2 via S3-compatible API) ---
async function cleanupOrphanedFiles() {
  const db = getFirestore();
  const referencedKeys = new Set();

  // Hardcoded system asset
  referencedKeys.add("system/shytalk_icon.webp");

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
      const key = extractR2Key(url);
      if (key) referencedKeys.add(key);
    }
  }

  // Conversations → groupPhotoUrl + messages (IMAGE → imageUrls, STICKER → stickerUrl)
  const convsSnap = await db.collection("conversations").get();
  for (const doc of convsSnap.docs) {
    const data = doc.data();
    const gKey = extractR2Key(data.groupPhotoUrl);
    if (gKey) referencedKeys.add(gKey);

    const imageSnap = await doc.ref.collection("messages").where("type", "==", "IMAGE").get();
    for (const msgDoc of imageSnap.docs) {
      for (const url of (msgDoc.data().imageUrls || [])) {
        const k = extractR2Key(url);
        if (k) referencedKeys.add(k);
      }
    }

    const stickerSnap = await doc.ref.collection("messages").where("type", "==", "STICKER").get();
    for (const msgDoc of stickerSnap.docs) {
      const k = extractR2Key(msgDoc.data().stickerUrl);
      if (k) referencedKeys.add(k);
    }
  }

  // Reports + archive → evidenceUrls[]
  for (const col of ["reports", "reports_archive"]) {
    const snap = await db.collection(col).get();
    for (const doc of snap.docs) {
      for (const url of (doc.data().evidenceUrls || [])) {
        const k = extractR2Key(url);
        if (k) referencedKeys.add(k);
      }
    }
  }

  // List and delete orphaned objects in R2 via S3-compatible API
  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY,
      secretAccessKey: process.env.R2_SECRET_KEY,
    },
  });
  const bucketName = "shytalk-media";
  const folders = ["pm_images/", "stickers/", "report_evidence/", "profile_photos/", "cover_photos/", "group_photos/"];
  const results = {};
  let totalDeleted = 0;

  for (const folder of folders) {
    // Paginate through all objects in the folder
    const allKeys = [];
    let continuationToken;
    do {
      const listResp = await s3.send(new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: folder,
        ContinuationToken: continuationToken,
      }));
      for (const obj of (listResp.Contents || [])) {
        allKeys.push(obj.Key);
      }
      continuationToken = listResp.IsTruncated ? listResp.NextContinuationToken : undefined;
    } while (continuationToken);

    const toDelete = allKeys.filter((k) => !referencedKeys.has(k));

    // Batch delete — up to 1000 per request (S3 limit)
    for (let i = 0; i < toDelete.length; i += 1000) {
      const batch = toDelete.slice(i, i + 1000).map((k) => ({ Key: k }));
      await s3.send(new DeleteObjectsCommand({
        Bucket: bucketName,
        Delete: { Objects: batch },
      }));
    }

    results[folder.replace("/", "")] = { total: allKeys.length, deleted: toDelete.length };
    totalDeleted += toDelete.length;
    console.log(`${folder}: ${toDelete.length}/${allKeys.length} files deleted`);
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

// Default economy config — overridden by Firestore config/economy document
const DEFAULT_ECONOMY_CONFIG = {
  beanConversionRate: 0.6,
  beanRedeemBonusThreshold: 2000,
  beanRedeemBonusMultiplier: 1.1,
  pullCosts: { "1": 10, "10": 100, "100": 1000 },
  broadcastSendThreshold: 0,
  broadcastWinThreshold: 5000,
  dropRateExponent: 1.5,
  pitySoftStart: 80,
  pityHardLimit: 120,
  pitySoftMaxShift: 0.15,
  pityHighValueThreshold: 5000,
  dailyBase: 50,
  milestoneRewards: { "7": 100, "14": 200, "30": 500, "60": 1000, "90": 2000 },
};

async function loadEconomyConfig() {
  const db = getFirestore();
  const doc = await db.collection("config").doc("economy").get();
  if (doc.exists) {
    return { ...DEFAULT_ECONOMY_CONFIG, ...doc.data() };
  }
  return { ...DEFAULT_ECONOMY_CONFIG };
}

exports.claimDailyReward = onCall({ region: "asia-southeast1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");
  const uid = request.auth.uid;
  const db = getFirestore();
  const userRef = db.collection("users").doc(uid);

  const config = await loadEconomyConfig();

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

    const milestoneRewards = config.milestoneRewards || {};
    const milestoneKeys = Object.keys(milestoneRewards).map(Number);
    const rawReward = milestoneRewards[String(newStreak)];
    const isMilestone = milestoneKeys.includes(newStreak);

    // Determine reward type: gift object or coin amount
    let coinReward = 0;
    let giftReward = null; // { giftId, quantity }

    if (rawReward && typeof rawReward === "object" && rawReward.type === "gift") {
      giftReward = { giftId: rawReward.giftId, quantity: rawReward.quantity || 1 };
    } else {
      // Number (legacy) or {type:"coins", amount} or fallback to dailyBase
      coinReward = (typeof rawReward === "number") ? rawReward
        : (rawReward && rawReward.amount) ? rawReward.amount
        : config.dailyBase;
      // Super Shy 10% bonus (rounded up)
      if (user.isSuperShy) {
        coinReward = Math.ceil(coinReward * 1.1);
      }
    }

    const newBalance = (user.shyCoins || 0) + coinReward;

    const userUpdate = {
      loginStreak: newStreak,
      lastLoginDate: today,
      lastLoginRewardDate: today,
    };
    if (coinReward > 0) userUpdate.shyCoins = newBalance;
    tx.update(userRef, userUpdate);

    // Add gift to backpack if gift reward
    let giftName = null;
    if (giftReward) {
      const bpRef = userRef.collection("backpack").doc(giftReward.giftId);
      tx.set(bpRef, {
        quantity: FieldValue.increment(giftReward.quantity),
        lastAcquired: FieldValue.serverTimestamp(),
      }, { merge: true });

      // Look up gift name from gifts collection (outside transaction read)
      giftName = giftReward.giftId;
    }

    // Write transaction record
    const txRef = userRef.collection("transactions").doc();
    const txRecord = {
      type: "DAILY_REWARD",
      timestamp: FieldValue.serverTimestamp(),
    };
    if (giftReward) {
      txRecord.amount = giftReward.quantity;
      txRecord.currency = "GIFT";
      txRecord.details = `Day ${newStreak} (milestone) — ${giftReward.quantity}x ${giftReward.giftId}`;
      txRecord.balanceAfter = newBalance;
    } else {
      txRecord.amount = coinReward;
      txRecord.currency = "COINS";
      txRecord.balanceAfter = newBalance;
      txRecord.details = `Day ${newStreak}${isMilestone ? " (milestone)" : ""}`;
    }
    tx.set(txRef, txRecord);

    const result = { coinsAwarded: coinReward, newStreak, isMilestone, newBalance };
    if (giftReward) {
      result.giftId = giftReward.giftId;
      result.giftQuantity = giftReward.quantity;
    }
    return result;
  });
});

exports.pullGacha = onCall({ region: "asia-southeast1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");
  const uid = request.auth.uid;
  const pullCount = request.data.pullCount;
  const expectedCost = request.data.expectedCost;

  if (![1, 10, 100].includes(pullCount)) {
    throw new HttpsError("invalid-argument", "pullCount must be 1, 10, or 100");
  }

  const db = getFirestore();
  const config = await loadEconomyConfig();
  const pullCosts = config.pullCosts || { "1": 10, "10": 100, "100": 1000 };
  const cost = pullCosts[String(pullCount)];
  if (!cost) throw new HttpsError("invalid-argument", "Invalid pull count");

  // Price validation: if client sent expectedCost and it doesn't match, reject without charging
  const currentPullCostsInt = {};
  for (const [k, v] of Object.entries(pullCosts)) {
    currentPullCostsInt[k] = v;
  }
  if (expectedCost != null && expectedCost !== cost) {
    return {
      priceChanged: true,
      currentPullCosts: currentPullCostsInt,
      gifts: [],
      coinsSpent: 0,
      newBalance: 0,
      newPityCounter: 0,
      newLuckScore: 0,
    };
  }

  const userRef = db.collection("users").doc(uid);

  // Load gift catalog
  const giftsSnap = await db.collection("gifts").orderBy("order").get();
  if (giftsSnap.empty) throw new HttpsError("failed-precondition", "Gift catalog not configured");

  const allGifts = giftsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const winnableGifts = allGifts.filter((g) => g.coinValue > 0 && g.showOnWheel !== false).slice(0, 16);
  if (winnableGifts.length === 0) throw new HttpsError("failed-precondition", "No winnable gifts");

  // Compute base weights: 1 / coinValue^exponent
  const exponent = config.dropRateExponent;
  const baseWeights = winnableGifts.map((g) => 1 / Math.pow(g.coinValue, exponent));

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

    const highValueThreshold = config.pityHighValueThreshold;

    // Check for admin-guaranteed next pull (first pull only)
    let guaranteedFirstPull = false;
    if (user.guaranteedNextPull && user.guaranteedNextPull.giftId) {
      const guaranteedGiftId = user.guaranteedNextPull.giftId;
      const guaranteedGift = winnableGifts.find((g) => g.id === guaranteedGiftId);
      if (guaranteedGift) {
        results.push(guaranteedGift);
        guaranteedFirstPull = true;
        // Reset pity on high-value gift
        if (guaranteedGift.coinValue >= highValueThreshold) {
          pity = 0;
        } else {
          pity++;
        }
      }
      // Clear the guarantee field regardless (even if gift not found)
      tx.update(userRef, { guaranteedNextPull: FieldValue.delete() });
    }

    for (let i = guaranteedFirstPull ? 1 : 0; i < pullCount; i++) {
      const weights = [...baseWeights];

      // Pity system (coin-value-based)
      if (pity >= config.pityHardLimit) {
        // Hard pity: force high-value gifts only
        for (let j = 0; j < winnableGifts.length; j++) {
          if (winnableGifts[j].coinValue < highValueThreshold) {
            weights[j] = 0;
          }
        }
        // If no high-value gifts exist, keep all weights (safety)
        if (weights.every((w) => w === 0)) {
          for (let j = 0; j < weights.length; j++) weights[j] = baseWeights[j];
        }
      } else if (pity >= config.pitySoftStart) {
        // Soft pity: linearly shift probability toward high-value gifts
        const pityProgress = (pity - config.pitySoftStart) / (config.pityHardLimit - config.pitySoftStart);
        const shift = config.pitySoftMaxShift * pityProgress;

        // Calculate total weight of low and high value gifts
        let lowTotal = 0;
        let highTotal = 0;
        for (let j = 0; j < winnableGifts.length; j++) {
          if (winnableGifts[j].coinValue >= highValueThreshold) highTotal += weights[j];
          else lowTotal += weights[j];
        }

        if (lowTotal > 0 && highTotal > 0) {
          const totalWeight = lowTotal + highTotal;
          const shiftAmount = shift * totalWeight;
          // Reduce low-value weights proportionally, increase high-value
          for (let j = 0; j < winnableGifts.length; j++) {
            if (winnableGifts[j].coinValue >= highValueThreshold) {
              weights[j] += shiftAmount * (weights[j] / highTotal);
            } else {
              weights[j] -= shiftAmount * (weights[j] / lowTotal);
              if (weights[j] < 0) weights[j] = 0;
            }
          }
        }
      }

      // Luck boost (up to 5%): shift from cheapest gifts to everything else
      const luckBoost = (luck / 100) * 0.05;
      if (luckBoost > 0) {
        const totalWeight = weights.reduce((s, w) => s + w, 0);
        const shiftAmount = luckBoost * totalWeight;
        // Find the cheapest gift(s) — reduce their weight
        const minValue = Math.min(...winnableGifts.map((g) => g.coinValue));
        let cheapTotal = 0;
        let expensiveTotal = 0;
        for (let j = 0; j < winnableGifts.length; j++) {
          if (winnableGifts[j].coinValue === minValue) cheapTotal += weights[j];
          else expensiveTotal += weights[j];
        }
        if (cheapTotal > shiftAmount && expensiveTotal > 0) {
          for (let j = 0; j < winnableGifts.length; j++) {
            if (winnableGifts[j].coinValue === minValue) {
              weights[j] -= shiftAmount * (weights[j] / cheapTotal);
            } else {
              weights[j] += shiftAmount * (weights[j] / expensiveTotal);
            }
          }
        }
      }

      // Normalize to probabilities
      const total = weights.reduce((s, w) => s + w, 0);
      if (total <= 0) {
        // Safety fallback
        results.push(winnableGifts[0]);
        pity++;
        continue;
      }

      // Roll
      const roll = Math.random() * total;
      let cumulative = 0;
      let selectedIndex = 0;
      for (let j = 0; j < weights.length; j++) {
        cumulative += weights[j];
        if (roll <= cumulative) { selectedIndex = j; break; }
      }

      const gift = winnableGifts[selectedIndex];
      results.push(gift);

      // Reset pity on high-value gift
      if (gift.coinValue >= highValueThreshold) {
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
      const bpUpdate = {
        quantity: FieldValue.increment(1),
        lastAcquired: FieldValue.serverTimestamp(),
      };
      if (gift.expiresAfterDays) {
        bpUpdate.expiresAt = new Date(Date.now() + gift.expiresAfterDays * 86400000);
      }
      tx.set(bpRef, bpUpdate, { merge: true });
    }

    // Write transaction
    const txRef = userRef.collection("transactions").doc();
    const txRecord = {
      type: "GACHA_PULL",
      amount: -cost,
      currency: "COINS",
      balanceAfter: newBalance,
      pullCount,
      details: results.map((g) => g.name).join(", "),
      timestamp: FieldValue.serverTimestamp(),
    };
    if (guaranteedFirstPull) {
      txRecord.guaranteed = true;
    }
    tx.set(txRef, txRecord);

    return {
      gifts: results.map((g) => ({
        giftId: g.id,
        giftName: g.name,
        coinValue: g.coinValue,
        iconUrl: g.iconUrl || "",
      })),
      coinsSpent: cost,
      newBalance,
      newPityCounter: pity,
      newLuckScore: luck,
      currentPullCosts: currentPullCostsInt,
    };
  }).then(async (result) => {
    // Broadcast qualifying gacha wins (outside transaction)
    const winThreshold = config.broadcastWinThreshold;
    const qualifyingGifts = result.gifts.filter((g) => g.coinValue >= winThreshold);

    if (qualifyingGifts.length > 0) {
      const winnerDoc = await userRef.get();
      const winnerData = winnerDoc.data();
      const broadcastsRef = db.collection("broadcasts");

      for (const g of qualifyingGifts) {
        await broadcastsRef.add({
          type: "GACHA_WIN",
          senderName: winnerData.displayName || "",
          senderPhotoUrl: winnerData.profilePhotoUrl || null,
          recipientName: "",
          giftName: g.giftName,
          giftIconUrl: g.iconUrl || "",
          giftCoinValue: g.coinValue,
          timestamp: FieldValue.serverTimestamp(),
        });
      }

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

exports.sendGift = onCall({ region: "asia-southeast1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");
  const senderUid = request.auth.uid;
  const { recipientId, giftId } = request.data;
  const quantity = Math.max(1, Math.min(9999, parseInt(request.data.quantity) || 1));

  if (!recipientId || !giftId) {
    throw new HttpsError("invalid-argument", "recipientId and giftId required");
  }
  if (giftId === "super_shy_trial") {
    throw new HttpsError("invalid-argument", "Trial items cannot be transferred");
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

  const _sendGiftConfig = await loadEconomyConfig();
  const _sendGiftBeanRate = _sendGiftConfig.beanConversionRate;

  return await db.runTransaction(async (tx) => {
    const bpRef = senderRef.collection("backpack").doc(giftId);
    const bpDoc = await tx.get(bpRef);

    if (!bpDoc.exists || (bpDoc.data().quantity || 0) < quantity) {
      throw new HttpsError("failed-precondition", "Insufficient items in backpack");
    }

    const senderDoc = await tx.get(senderRef);
    const recipientDoc = await tx.get(recipientRef);
    if (!recipientDoc.exists) throw new HttpsError("not-found", "Recipient not found");

    const sender = senderDoc.data();
    const recipient = recipientDoc.data();
    const beanReward = Math.floor(gift.coinValue * _sendGiftBeanRate * quantity);

    // Decrement sender backpack
    const newQty = (bpDoc.data().quantity || 0) - quantity;
    if (newQty <= 0) {
      tx.delete(bpRef);
    } else {
      tx.update(bpRef, { quantity: newQty });
    }

    // Update recipient gift wall
    const wallRef = recipientRef.collection("giftWall").doc(giftId);
    tx.set(wallRef, {
      receivedCount: FieldValue.increment(quantity),
      [`senders.${senderUid}`]: FieldValue.increment(quantity),
    }, { merge: true });

    // Credit beans to recipient
    tx.update(recipientRef, {
      shyBeans: FieldValue.increment(beanReward),
    });

    // Write lastGiftEvent to room if sender is in a room
    const roomId = sender.currentRoomId;
    if (roomId) {
      const roomRef = db.collection("rooms").doc(roomId);
      tx.update(roomRef, {
        lastGiftEvent: {
          senderId: senderUid,
          senderName: sender.displayName || "Someone",
          recipientId,
          recipientName: recipient.displayName || "Someone",
          giftId,
          giftName: gift.name,
          coinValue: gift.coinValue,
          quantity,
          timestamp: FieldValue.serverTimestamp(),
        },
      });

      // Write gift chat message to room messages
      const sName = sender.displayName || "Someone";
      const rName = recipient.displayName || "Someone";
      const qtyLabel = quantity > 1 ? `${quantity}x ` : "";
      const msgRef = roomRef.collection("messages").doc();
      tx.set(msgRef, {
        messageId: msgRef.id,
        senderId: senderUid,
        senderName: sName,
        text: `${sName} sent ${qtyLabel}${gift.name} to ${rName}`,
        createdAt: FieldValue.serverTimestamp(),
        type: "GIFT",
        isEdited: false,
        giftId,
        giftIconUrl: gift.iconUrl || "",
      });
    }

    // Transaction records
    const senderTxRef = senderRef.collection("transactions").doc();
    tx.set(senderTxRef, {
      type: "GIFT_SENT",
      amount: -quantity,
      currency: "COINS",
      balanceAfter: sender.shyCoins || 0,
      giftId, giftName: gift.name,
      recipientId,
      quantity,
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
      quantity,
      timestamp: FieldValue.serverTimestamp(),
    });

    return { success: true, beanReward, giftName: gift.name, quantity };
  }).then(async (result) => {
    // Broadcast if gift value meets threshold (outside transaction)
    if (gift.coinValue >= _sendGiftConfig.broadcastSendThreshold) {
      const senderDoc = await senderRef.get();
      const recipientDoc = await recipientRef.get();
      const senderData = senderDoc.data();
      const recipientData = recipientDoc.data();

      const broadcastsRef = db.collection("broadcasts");
      await broadcastsRef.add({
        type: "GIFT_SEND",
        senderName: senderData.displayName || "",
        senderPhotoUrl: senderData.profilePhotoUrl || null,
        recipientName: recipientData.displayName || "",
        giftName: gift.name,
        giftIconUrl: gift.iconUrl || "",
        giftCoinValue: gift.coinValue,
        quantity,
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

exports.sendGiftDirect = onCall({ region: "asia-southeast1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");
  const senderUid = request.auth.uid;
  const { recipientId, giftId } = request.data;
  const quantity = Math.max(1, Math.min(9999, parseInt(request.data.quantity) || 1));

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
  const totalCost = gift.coinValue * quantity;

  const _directConfig = await loadEconomyConfig();
  const _directBeanRate = _directConfig.beanConversionRate;

  return await db.runTransaction(async (tx) => {
    const senderDoc = await tx.get(senderRef);
    const recipientDoc = await tx.get(recipientRef);
    if (!senderDoc.exists) throw new HttpsError("not-found", "Sender not found");
    if (!recipientDoc.exists) throw new HttpsError("not-found", "Recipient not found");

    const sender = senderDoc.data();
    const recipient = recipientDoc.data();

    if ((sender.shyCoins || 0) < totalCost) {
      throw new HttpsError("failed-precondition", "Insufficient coins");
    }

    const beanReward = Math.floor(gift.coinValue * _directBeanRate * quantity);
    const newSenderCoins = (sender.shyCoins || 0) - totalCost;

    // Deduct coins from sender
    tx.update(senderRef, { shyCoins: newSenderCoins });

    // Update recipient gift wall
    const wallRef = recipientRef.collection("giftWall").doc(giftId);
    tx.set(wallRef, {
      receivedCount: FieldValue.increment(quantity),
      [`senders.${senderUid}`]: FieldValue.increment(quantity),
    }, { merge: true });

    // Credit beans to recipient
    tx.update(recipientRef, {
      shyBeans: FieldValue.increment(beanReward),
    });

    // Write lastGiftEvent to room if sender is in a room
    const roomId = sender.currentRoomId;
    if (roomId) {
      const roomRef = db.collection("rooms").doc(roomId);
      tx.update(roomRef, {
        lastGiftEvent: {
          senderId: senderUid,
          senderName: sender.displayName || "Someone",
          recipientId,
          recipientName: recipient.displayName || "Someone",
          giftId,
          giftName: gift.name,
          coinValue: gift.coinValue,
          quantity,
          timestamp: FieldValue.serverTimestamp(),
        },
      });

      // Write gift chat message to room messages
      const sName = sender.displayName || "Someone";
      const rName = recipient.displayName || "Someone";
      const qtyLabel = quantity > 1 ? `${quantity}x ` : "";
      const msgRef = roomRef.collection("messages").doc();
      tx.set(msgRef, {
        messageId: msgRef.id,
        senderId: senderUid,
        senderName: sName,
        text: `${sName} sent ${qtyLabel}${gift.name} to ${rName}`,
        createdAt: FieldValue.serverTimestamp(),
        type: "GIFT",
        isEdited: false,
        giftId,
        giftIconUrl: gift.iconUrl || "",
      });
    }

    // Transaction records
    const senderTxRef = senderRef.collection("transactions").doc();
    tx.set(senderTxRef, {
      type: "GIFT_SENT",
      amount: -totalCost,
      currency: "COINS",
      balanceAfter: newSenderCoins,
      giftId, giftName: gift.name,
      recipientId,
      quantity,
      details: `Sent ${quantity > 1 ? quantity + "x " : ""}${gift.name} directly (${totalCost} coins)`,
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
      quantity,
      timestamp: FieldValue.serverTimestamp(),
    });

    return { success: true, beanReward, giftName: gift.name, coinsSpent: totalCost, quantity };
  }).then(async (result) => {
    // Broadcast if gift value meets threshold (outside transaction)
    if (gift.coinValue >= _directConfig.broadcastSendThreshold) {
      const senderDoc = await senderRef.get();
      const recipientDoc = await recipientRef.get();
      const senderData = senderDoc.data();
      const recipientData = recipientDoc.data();

      const broadcastsRef = db.collection("broadcasts");
      await broadcastsRef.add({
        type: "GIFT_SEND",
        senderName: senderData.displayName || "",
        senderPhotoUrl: senderData.profilePhotoUrl || null,
        recipientName: recipientData.displayName || "",
        giftName: gift.name,
        giftIconUrl: gift.iconUrl || "",
        giftCoinValue: gift.coinValue,
        quantity,
        timestamp: FieldValue.serverTimestamp(),
      });

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

  const config = await loadEconomyConfig();

  return await db.runTransaction(async (tx) => {
    const userDoc = await tx.get(userRef);
    if (!userDoc.exists) throw new HttpsError("not-found", "User not found");
    const user = userDoc.data();

    if ((user.shyBeans || 0) < amount) {
      throw new HttpsError("failed-precondition", "Insufficient beans");
    }

    const threshold = config.beanRedeemBonusThreshold;
    const multiplier = config.beanRedeemBonusMultiplier;
    const hasBonus = amount >= threshold;
    const coins = hasBonus ? Math.floor(amount * multiplier) : amount;
    const newBeans = (user.shyBeans || 0) - amount;
    const newCoins = (user.shyCoins || 0) + coins;

    tx.update(userRef, {
      shyBeans: newBeans,
      shyCoins: newCoins,
    });

    const bonusPct = Math.round((multiplier - 1) * 100);
    const txRef = userRef.collection("transactions").doc();
    tx.set(txRef, {
      type: "BEAN_REDEEM",
      amount: coins,
      currency: "COINS",
      balanceAfter: newCoins,
      details: `Redeemed ${amount} beans${hasBonus ? ` (${bonusPct}% bonus)` : ""}`,
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
    { name: "Rose", coinValue: 8, order: 1 },
    { name: "Heart", coinValue: 10, order: 2 },
    { name: "Thumbs Up", coinValue: 12, order: 3 },
    { name: "Star", coinValue: 15, order: 4 },
    { name: "Smiley", coinValue: 18, order: 5 },
    { name: "Coffee", coinValue: 20, order: 6 },
    { name: "Candy", coinValue: 25, order: 7 },
    { name: "Balloon", coinValue: 30, order: 8 },
    { name: "Teddy Bear", coinValue: 50, order: 9 },
    { name: "Perfume", coinValue: 80, order: 10 },
    { name: "Diamond Ring", coinValue: 120, order: 11 },
    { name: "Bouquet", coinValue: 150, order: 12 },
    { name: "Fireworks", coinValue: 200, order: 13 },
    { name: "Music Box", coinValue: 300, order: 14 },
    { name: "Treasure Chest", coinValue: 500, order: 15 },
    { name: "Crown", coinValue: 800, order: 16 },
    { name: "Sports Car", coinValue: 1200, order: 17 },
    { name: "Yacht", coinValue: 1800, order: 18 },
    { name: "Dragon", coinValue: 2500, order: 19 },
    { name: "Phoenix", coinValue: 3500, order: 20 },
    { name: "Crystal Ball", coinValue: 5000, order: 21 },
    { name: "Castle", coinValue: 8000, order: 22 },
    { name: "Spaceship", coinValue: 12000, order: 23 },
    { name: "Aurora", coinValue: 16000, order: 24 },
    { name: "Galaxy Unicorn", coinValue: 20000, order: 25 },
    { name: "ShyTalk Emblem", coinValue: 35000, order: 26 },
    { name: "Celestial Throne", coinValue: 52000, order: 27 },
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

  // Economy config
  batch.set(db.collection("config").doc("economy"), DEFAULT_ECONOMY_CONFIG, { merge: true });

  await batch.commit();
  return { giftsSeeded: giftCatalog.length, packagesSeeded: coinPackages.length, configSeeded: true };
});


// --- Batch gift sending (multiple recipients) ---
exports.sendGiftBatch = onCall({ region: "asia-southeast1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");
  const senderUid = request.auth.uid;
  const { recipientIds, giftId, fromBackpack } = request.data;
  const quantity = Math.max(1, Math.min(9999, parseInt(request.data.quantity) || 1));

  if (!Array.isArray(recipientIds) || recipientIds.length < 1 || recipientIds.length > 8) {
    throw new HttpsError("invalid-argument", "recipientIds must be an array of 1-8 user IDs");
  }
  if (!giftId) {
    throw new HttpsError("invalid-argument", "giftId required");
  }
  if (giftId === "super_shy_trial") {
    throw new HttpsError("invalid-argument", "Trial items cannot be transferred");
  }
  if (recipientIds.includes(senderUid)) {
    throw new HttpsError("invalid-argument", "Cannot send gift to yourself");
  }

  const db = getFirestore();
  const senderRef = db.collection("users").doc(senderUid);
  const giftRef = db.collection("gifts").doc(giftId);

  const giftDoc = await giftRef.get();
  if (!giftDoc.exists) throw new HttpsError("not-found", "Gift not found");
  const gift = giftDoc.data();

  const config = await loadEconomyConfig();
  const beanRate = config.beanConversionRate;
  const totalItems = quantity * recipientIds.length;

  return await db.runTransaction(async (tx) => {
    // --- All reads first (Firestore requires reads before writes) ---
    const senderDoc = await tx.get(senderRef);
    if (!senderDoc.exists) throw new HttpsError("not-found", "Sender not found");
    const sender = senderDoc.data();

    let bpDoc = null;
    if (fromBackpack) {
      const bpRef = senderRef.collection("backpack").doc(giftId);
      bpDoc = await tx.get(bpRef);
    }

    const recipientDocs = [];
    for (const rid of recipientIds) {
      const rRef = db.collection("users").doc(rid);
      const rDoc = await tx.get(rRef);
      if (!rDoc.exists) throw new HttpsError("not-found", `Recipient ${rid} not found`);
      recipientDocs.push({ ref: rRef, data: rDoc.data(), id: rid });
    }

    // --- All writes after reads ---
    if (fromBackpack) {
      const bpRef = senderRef.collection("backpack").doc(giftId);
      if (!bpDoc.exists || (bpDoc.data().quantity || 0) < totalItems) {
        throw new HttpsError("failed-precondition", "Insufficient items in backpack");
      }
      const newQty = (bpDoc.data().quantity || 0) - totalItems;
      if (newQty <= 0) {
        tx.delete(bpRef);
      } else {
        tx.update(bpRef, { quantity: newQty });
      }
    } else {
      const totalCost = gift.coinValue * totalItems;
      if ((sender.shyCoins || 0) < totalCost) {
        throw new HttpsError("failed-precondition", "Insufficient coins");
      }
      const newCoins = (sender.shyCoins || 0) - totalCost;
      tx.update(senderRef, { shyCoins: newCoins });
    }

    const beanPerRecipient = Math.floor(gift.coinValue * beanRate * quantity);
    const sName = sender.displayName || "Someone";
    const roomId = sender.currentRoomId;
    const roomRef = roomId ? db.collection("rooms").doc(roomId) : null;

    for (const r of recipientDocs) {
      // Gift wall
      const wallRef = r.ref.collection("giftWall").doc(giftId);
      tx.set(wallRef, {
        receivedCount: FieldValue.increment(quantity),
        [`senders.${senderUid}`]: FieldValue.increment(quantity),
      }, { merge: true });

      // Beans
      tx.update(r.ref, { shyBeans: FieldValue.increment(beanPerRecipient) });

      // Recipient transaction
      const rTxRef = r.ref.collection("transactions").doc();
      tx.set(rTxRef, {
        type: "GIFT_RECEIVED",
        amount: beanPerRecipient,
        currency: "BEANS",
        balanceAfter: (r.data.shyBeans || 0) + beanPerRecipient,
        giftId, giftName: gift.name,
        senderId: senderUid,
        quantity,
        timestamp: FieldValue.serverTimestamp(),
      });

      // Room message per recipient
      if (roomRef) {
        const rName = r.data.displayName || "Someone";
        const qtyLabel = quantity > 1 ? `${quantity}x ` : "";
        const msgRef = roomRef.collection("messages").doc();
        tx.set(msgRef, {
          messageId: msgRef.id,
          senderId: senderUid,
          senderName: sName,
          text: `${sName} sent ${qtyLabel}${gift.name} to ${rName}`,
          createdAt: FieldValue.serverTimestamp(),
          type: "GIFT",
          isEdited: false,
          giftId,
          giftIconUrl: gift.iconUrl || "",
        });
      }
    }

    // Last gift event (use first recipient for animation)
    if (roomRef && recipientDocs.length > 0) {
      const firstR = recipientDocs[0];
      const recipientLabel = recipientDocs.length > 1
        ? `${firstR.data.displayName || "Someone"} +${recipientDocs.length - 1}`
        : firstR.data.displayName || "Someone";
      tx.update(roomRef, {
        lastGiftEvent: {
          senderId: senderUid,
          senderName: sName,
          recipientId: firstR.id,
          recipientName: recipientLabel,
          giftId,
          giftName: gift.name,
          coinValue: gift.coinValue,
          quantity: quantity * recipientDocs.length,
          timestamp: FieldValue.serverTimestamp(),
        },
      });
    }

    // Sender transaction
    const totalCost = fromBackpack ? totalItems : gift.coinValue * totalItems;
    const senderTxRef = senderRef.collection("transactions").doc();
    tx.set(senderTxRef, {
      type: "GIFT_SENT",
      amount: fromBackpack ? -totalItems : -totalCost,
      currency: fromBackpack ? "ITEMS" : "COINS",
      balanceAfter: fromBackpack ? (sender.shyCoins || 0) : ((sender.shyCoins || 0) - totalCost),
      giftId, giftName: gift.name,
      recipientIds,
      quantity,
      totalRecipients: recipientIds.length,
      timestamp: FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      giftName: gift.name,
      quantity,
      totalRecipients: recipientIds.length,
      totalItems,
    };
  }).then(async (result) => {
    // Broadcast if gift value meets threshold (outside transaction)
    if (gift.coinValue >= config.broadcastSendThreshold) {
      const senderDoc = await senderRef.get();
      const senderData = senderDoc.data();
      const firstRecipientRef = db.collection("users").doc(recipientIds[0]);
      const firstRecipientDoc = await firstRecipientRef.get();
      const firstRecipientData = firstRecipientDoc.data();
      const recipientLabel = recipientIds.length > 1
        ? `${firstRecipientData.displayName || "Someone"} +${recipientIds.length - 1}`
        : firstRecipientData.displayName || "Someone";

      const broadcastsRef = db.collection("broadcasts");
      await broadcastsRef.add({
        type: "GIFT_SEND",
        senderName: senderData.displayName || "",
        senderPhotoUrl: senderData.profilePhotoUrl || null,
        recipientName: recipientLabel,
        giftName: gift.name,
        giftIconUrl: gift.iconUrl || "",
        giftCoinValue: gift.coinValue,
        quantity: quantity * recipientIds.length,
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

// --- Send entire backpack to a recipient ---
exports.sendEntireBackpack = onCall({ region: "asia-southeast1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");
  const senderUid = request.auth.uid;
  const { recipientId } = request.data;

  if (!recipientId) {
    throw new HttpsError("invalid-argument", "recipientId required");
  }
  if (senderUid === recipientId) {
    throw new HttpsError("invalid-argument", "Cannot send backpack to yourself");
  }

  const db = getFirestore();
  const senderRef = db.collection("users").doc(senderUid);
  const recipientRef = db.collection("users").doc(recipientId);

  // Verify recipient exists
  const recipientCheck = await recipientRef.get();
  if (!recipientCheck.exists) throw new HttpsError("not-found", "Recipient not found");

  const config = await loadEconomyConfig();
  const beanRate = config.beanConversionRate;

  // Read sender's full backpack (outside transaction to get all items)
  const backpackSnap = await senderRef.collection("backpack").get();
  const backpackItems = [];
  for (const doc of backpackSnap.docs) {
    // Skip trial items — they are non-transferable
    if (doc.id === "super_shy_trial") continue;
    const data = doc.data();
    if ((data.quantity || 0) > 0) {
      backpackItems.push({ giftId: doc.id, quantity: data.quantity });
    }
  }

  if (backpackItems.length === 0) {
    throw new HttpsError("failed-precondition", "Backpack is empty");
  }

  // Load gift catalog for each backpack item
  const giftDetails = {};
  for (const item of backpackItems) {
    const giftDoc = await db.collection("gifts").doc(item.giftId).get();
    if (giftDoc.exists) {
      giftDetails[item.giftId] = giftDoc.data();
    }
  }

  return await db.runTransaction(async (tx) => {
    // ── All reads first ──
    const senderDoc = await tx.get(senderRef);
    const recipientDoc = await tx.get(recipientRef);
    if (!senderDoc.exists) throw new HttpsError("not-found", "Sender not found");
    if (!recipientDoc.exists) throw new HttpsError("not-found", "Recipient not found");

    const sender = senderDoc.data();
    const recipient = recipientDoc.data();

    const bpDocs = [];
    for (const item of backpackItems) {
      const bpRef = senderRef.collection("backpack").doc(item.giftId);
      const bpDoc = await tx.get(bpRef);
      bpDocs.push({ item, bpRef, bpDoc });
    }

    // ── All writes after reads ──
    let totalBeanReward = 0;
    let totalItemsSent = 0;
    const giftsSent = [];

    for (const { item, bpRef, bpDoc } of bpDocs) {
      if (!bpDoc.exists) continue;

      const currentQty = bpDoc.data().quantity || 0;
      if (currentQty <= 0) continue;

      const gift = giftDetails[item.giftId];
      if (!gift) continue;

      tx.delete(bpRef);

      const recipientBpRef = recipientRef.collection("backpack").doc(item.giftId);
      tx.set(recipientBpRef, {
        quantity: FieldValue.increment(currentQty),
        lastAcquired: FieldValue.serverTimestamp(),
      }, { merge: true });

      const wallRef = recipientRef.collection("giftWall").doc(item.giftId);
      tx.set(wallRef, {
        receivedCount: FieldValue.increment(currentQty),
        [`senders.${senderUid}`]: FieldValue.increment(currentQty),
      }, { merge: true });

      const beanReward = Math.floor(gift.coinValue * beanRate * currentQty);
      totalBeanReward += beanReward;
      totalItemsSent += currentQty;

      giftsSent.push({
        giftId: item.giftId,
        giftName: gift.name,
        quantity: currentQty,
      });
    }

    if (totalItemsSent === 0) {
      throw new HttpsError("failed-precondition", "Backpack is empty");
    }

    tx.update(recipientRef, {
      shyBeans: FieldValue.increment(totalBeanReward),
    });

    // Write gift chat message to room
    const roomId = sender.currentRoomId;
    if (roomId) {
      const roomRef = db.collection("rooms").doc(roomId);
      const sName = sender.displayName || "Someone";
      const rName = recipient.displayName || "Someone";
      const giftList = giftsSent.map((g) => `${g.quantity}x ${g.giftName}`).join(", ");

      const msgRef = roomRef.collection("messages").doc();
      tx.set(msgRef, {
        messageId: msgRef.id,
        senderId: senderUid,
        senderName: sName,
        text: `${sName} sent entire backpack to ${rName}: ${giftList}`,
        createdAt: FieldValue.serverTimestamp(),
        type: "GIFT",
        isEdited: false,
        giftId: "backpack",
        giftIconUrl: "",
      });
    }

    const senderTxRef = senderRef.collection("transactions").doc();
    tx.set(senderTxRef, {
      type: "BACKPACK_SENT",
      amount: -totalItemsSent,
      currency: "ITEMS",
      balanceAfter: sender.shyCoins || 0,
      recipientId,
      totalItemsSent,
      details: giftsSent.map((g) => `${g.quantity}x ${g.giftName}`).join(", "),
      timestamp: FieldValue.serverTimestamp(),
    });

    const recipientTxRef = recipientRef.collection("transactions").doc();
    tx.set(recipientTxRef, {
      type: "BACKPACK_RECEIVED",
      amount: totalBeanReward,
      currency: "BEANS",
      balanceAfter: (recipient.shyBeans || 0) + totalBeanReward,
      senderId: senderUid,
      totalItemsReceived: totalItemsSent,
      details: giftsSent.map((g) => `${g.quantity}x ${g.giftName}`).join(", "),
      timestamp: FieldValue.serverTimestamp(),
    });

    return {
      totalItemsSent,
      giftsSent,
      _roomId: roomId || null,
      _senderName: sender.displayName || "Someone",
      _recipientName: recipient.displayName || "Someone",
    };
  }).then(async (result) => {
    // Queue gift animations one per gift type so each plays in sequence
    if (result._roomId && result.giftsSent.length > 0) {
      const roomRef = db.collection("rooms").doc(result._roomId);
      const sorted = [...result.giftsSent].sort((a, b) => {
        const aVal = giftDetails[a.giftId]?.coinValue || 0;
        const bVal = giftDetails[b.giftId]?.coinValue || 0;
        return bVal - aVal;
      });

      for (const g of sorted) {
        const details = giftDetails[g.giftId];
        if (!details) continue;
        await roomRef.update({
          lastGiftEvent: {
            senderId: senderUid,
            senderName: result._senderName,
            recipientId,
            recipientName: result._recipientName,
            giftId: g.giftId,
            giftName: g.giftName,
            coinValue: details.coinValue,
            quantity: g.quantity,
            timestamp: FieldValue.serverTimestamp(),
          },
        });
        // Small delay so client listener detects each distinct event
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    return { totalItemsSent: result.totalItemsSent, giftsSent: result.giftsSent };
  });
});

// --- Clean up expired backpack items (daily) ---
exports.cleanExpiredBackpackItems = onSchedule(
  { schedule: "every 24 hours", region: "asia-southeast1" },
  async () => {
    const db = getFirestore();
    const now = new Date();
    const expiredSnap = await db.collectionGroup("backpack")
      .where("expiresAt", ">", new Date(0))
      .where("expiresAt", "<=", now)
      .get();

    if (expiredSnap.empty) return;

    const batchSize = 500;
    const docs = expiredSnap.docs;
    for (let i = 0; i < docs.length; i += batchSize) {
      const batch = db.batch();
      docs.slice(i, i + batchSize).forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    }
    console.log(`Cleaned ${docs.length} expired backpack items`);
  }
);

// --- Test Coins (development/testing only) ---
exports.addTestCoins = onCall({ region: "asia-southeast1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");
  const uid = request.auth.uid;
  const { amount } = request.data;

  if (!amount || typeof amount !== "number" || amount <= 0 || amount > 100000) {
    throw new HttpsError("invalid-argument", "amount must be a positive number (max 100,000)");
  }

  const db = getFirestore();
  const userRef = db.collection("users").doc(uid);

  return await db.runTransaction(async (tx) => {
    const userDoc = await tx.get(userRef);
    if (!userDoc.exists) throw new HttpsError("not-found", "User not found");
    const user = userDoc.data();
    const newBalance = (user.shyCoins || 0) + amount;

    tx.update(userRef, { shyCoins: newBalance });

    const txDocRef = userRef.collection("transactions").doc();
    tx.set(txDocRef, {
      type: "PURCHASE",
      amount: amount,
      currency: "COINS",
      balanceAfter: newBalance,
      details: `Test purchase (+${amount} coins)`,
      timestamp: FieldValue.serverTimestamp(),
    });

    return { success: true, coinsAdded: amount, newBalance };
  });
});

// --- Super Shy Trial ---
exports.claimSuperShyTrial = onCall({ region: "asia-southeast1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");
  const uid = request.auth.uid;

  const db = getFirestore();
  const userRef = db.collection("users").doc(uid);

  return await db.runTransaction(async (tx) => {
    const userDoc = await tx.get(userRef);
    if (!userDoc.exists) throw new HttpsError("not-found", "User not found");

    const userData = userDoc.data();
    if (userData.hasClaimedSuperShyTrial) {
      throw new HttpsError("already-exists", "Trial already claimed");
    }

    // Mark trial as claimed
    tx.update(userRef, { hasClaimedSuperShyTrial: true });

    // Create backpack item
    const bpRef = userRef.collection("backpack").doc("super_shy_trial");
    tx.set(bpRef, { quantity: 1 });

    // Record transaction
    const txDocRef = userRef.collection("transactions").doc();
    tx.set(txDocRef, {
      type: "TRIAL_CLAIM",
      amount: 0,
      currency: "COINS",
      balanceAfter: userData.shyCoins || 0,
      details: "Claimed 30 days of Super Shy",
      timestamp: FieldValue.serverTimestamp(),
    });

    return { success: true };
  });
});

exports.activateSuperShyTrial = onCall({ region: "asia-southeast1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in");
  const uid = request.auth.uid;

  const db = getFirestore();
  const userRef = db.collection("users").doc(uid);
  const bpRef = userRef.collection("backpack").doc("super_shy_trial");

  return await db.runTransaction(async (tx) => {
    const userDoc = await tx.get(userRef);
    const bpDoc = await tx.get(bpRef);

    if (!userDoc.exists) throw new HttpsError("not-found", "User not found");
    if (!bpDoc.exists || (bpDoc.data().quantity || 0) < 1) {
      throw new HttpsError("failed-precondition", "No trial item in backpack");
    }

    const userData = userDoc.data();

    // Delete backpack item
    tx.delete(bpRef);

    // Set Super Shy — don't downgrade existing tier
    const now = Date.now();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const currentExpiry = userData.superShyExpiry ? userData.superShyExpiry.toMillis() : 0;
    const baseTime = Math.max(currentExpiry, now);
    const newExpiry = baseTime + thirtyDays;
    const currentTier = userData.superShyTier;
    // Only set trial tier if user has no existing tier or it's already trial
    const newTier = (currentTier && currentTier !== "trial") ? currentTier : "trial";

    tx.update(userRef, {
      isSuperShy: true,
      superShyExpiry: new Date(newExpiry),
      superShyTier: newTier,
    });

    // Record transaction
    const txDocRef = userRef.collection("transactions").doc();
    tx.set(txDocRef, {
      type: "TRIAL_ACTIVATE",
      amount: 0,
      currency: "COINS",
      balanceAfter: userData.shyCoins || 0,
      details: "Activated 30 days of Super Shy",
      timestamp: FieldValue.serverTimestamp(),
    });

    return { success: true, newTier, newExpiry };
  });
});

// --- Stalker visit counter (profile visitors) ---
const { onDocumentWritten } = require("firebase-functions/v2/firestore");

exports.onStalkerWrite = onDocumentWritten(
  { document: "users/{uid}/stalkers/{visitorId}", region: "asia-southeast1" },
  async (event) => {
    const { uid } = event.params;
    const db = getFirestore();
    const userRef = db.collection("users").doc(uid);

    const isCreate = !event.data.before.exists;
    if (isCreate) {
      // First visit — set firstVisitedAt and increment both counters
      await event.data.after.ref.update({ firstVisitedAt: FieldValue.serverTimestamp() });
      await userRef.update({
        stalkerCount: FieldValue.increment(1),
        newStalkerCount: FieldValue.increment(1),
      });
    } else {
      // Repeat visit — only increment newStalkerCount
      await userRef.update({
        newStalkerCount: FieldValue.increment(1),
      });
    }
  }
);

// --- Admin API ---
const adminApp = require("./admin");
exports.adminApi = onRequest({ region: "asia-southeast1" }, adminApp);

// deploy 1771560904
