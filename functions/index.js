const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onValueDeleted } = require("firebase-functions/v2/database");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { RtcTokenBuilder, RtcRole } = require("agora-token");

initializeApp();

const AGORA_APP_ID = "7bdf5596c88f49edba75568f529c4389";
const AGORA_APP_CERTIFICATE = "30d7d7008b7e458fb689135c38b49033";

const MAX_SEATS = 8;
const OWNER_SEAT_INDEX = 0;

exports.generateAgoraToken = onCall((request) => {
  const { channelName, uid } = request.data;

  if (!channelName || uid === undefined || uid === null) {
    throw new HttpsError(
      "invalid-argument",
      "channelName and uid are required"
    );
  }

  // Token expires in 24 hours
  const expirationTimeInSeconds = 86400;
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

  const token = RtcTokenBuilder.buildTokenWithUid(
    AGORA_APP_ID,
    AGORA_APP_CERTIFICATE,
    channelName,
    uid,
    RtcRole.PUBLISHER,
    privilegeExpiredTs,
    privilegeExpiredTs
  );

  return { token };
});

// Clean up Firestore when a user's presence is removed (app closed/crashed)
exports.onPresenceRemoved = onValueDeleted(
  { ref: "/presence/{roomId}/{userId}", instance: "shytalk-7ba69-default-rtdb", region: "asia-southeast1" },
  async (event) => {
    const roomId = event.params.roomId;
    const userId = event.params.userId;

    console.log(`Presence removed: room=${roomId} user=${userId}`);

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

        const updates = {
          participantIds: participantIds.filter((id) => id !== userId),
        };

        // Clear any seats occupied by this user
        const seats = room.seats || {};
        for (let i = 0; i < MAX_SEATS; i++) {
          const key = i.toString();
          const seat = seats[key];
          if (seat && seat.userId === userId && seat.state === "OCCUPIED") {
            updates[`seats.${key}`] = {
              userId: null,
              state: "EMPTY",
              isMuted: false,
            };
          }
        }

        // Clear any pending invites for this user
        if (room.pendingInvites && room.pendingInvites[userId]) {
          updates[`pendingInvites.${userId}`] = require("firebase-admin/firestore").FieldValue.delete();
        }

        // If this user is the owner, set room to OWNER_AWAY
        if (room.ownerId === userId && room.state === "ACTIVE") {
          updates.state = "OWNER_AWAY";
          updates.ownerLeftAt = require("firebase-admin/firestore").Timestamp.now();
          console.log(`Owner left room ${roomId}, setting OWNER_AWAY`);
        }

        transaction.update(roomRef, updates);
        console.log(`Cleaned up user ${userId} from room ${roomId}`);
      });
    } catch (error) {
      console.error(`Error cleaning up presence for room=${roomId} user=${userId}:`, error);
    }
  }
);
