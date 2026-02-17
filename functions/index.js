const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onValueDeleted } = require("firebase-functions/v2/database");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getDatabase } = require("firebase-admin/database");
const { AccessToken } = require("livekit-server-sdk");

initializeApp();

const livekitApiKey = defineSecret("LIVEKIT_API_KEY");
const livekitApiSecret = defineSecret("LIVEKIT_API_SECRET");

const MAX_SEATS = 8;
const OWNER_SEAT_INDEX = 0;

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

// --- Admin API ---
const adminApp = require("./admin");
exports.adminApi = onRequest({ region: "asia-southeast1" }, adminApp);
