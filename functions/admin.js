const express = require("express");
const cors = require("cors");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, Timestamp, FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");

const app = express();

app.use(cors({ origin: "https://shytalk.shyden.co.uk" }));
app.use(express.json());

// --- Auth middleware: verify Firebase ID token + admin claim ---
app.use(async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }

  const idToken = authHeader.split("Bearer ")[1];
  try {
    const decoded = await getAuth().verifyIdToken(idToken);
    if (decoded.admin !== true) {
      return res.status(403).json({ error: "Not an admin" });
    }
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
});

// --- Field validation config ---
const VALID_USER_TYPES = ["MEMBER", "SHYTALK_OFFICIAL", "MC_SINGER", "MC_EVENT_HOST", "TEACHER"];

const FIELD_SCHEMA = {
  displayName:      { type: "string", nullable: false },
  profilePhotoUrl:  { type: "string", nullable: true },
  coverPhotoUrl:    { type: "string", nullable: true },
  description:      { type: "string", nullable: true },
  nationality:      { type: "string", nullable: true },
  email:            { type: "string", nullable: true },
  currentRoomId:    { type: "string", nullable: true },
  userType:         { type: "enum", values: VALID_USER_TYPES },
  uniqueId:         { type: "number" },
  hideFollowing:    { type: "boolean" },
  hideOnlineStatus: { type: "boolean" },
  hideAge:          { type: "boolean" },
  blockedUserIds:   { type: "array_of_strings" },
  followingIds:     { type: "array_of_strings" },
  followerIds:      { type: "array_of_strings" },
  dateOfBirth:      { type: "timestamp", nullable: true },
  createdAt:        { type: "timestamp", nullable: false },
  lastSeenAt:       { type: "timestamp", nullable: false },
  isSuspended:           { type: "boolean" },
  suspensionReason:      { type: "string", nullable: true },
  suspensionStartDate:   { type: "timestamp", nullable: true },
  suspensionEndDate:     { type: "timestamp", nullable: true },
  suspensionCanAppeal:   { type: "boolean" },
  suspendedBy:           { type: "string", nullable: true },
  shyCoins:              { type: "number" },
  shyBeans:              { type: "number" },
  isSuperShy:            { type: "boolean" },
  superShyExpiry:        { type: "timestamp", nullable: true },
  superShyTier:          { type: "string", nullable: true },
  luckScore:             { type: "number" },
  pityCounter:           { type: "number" },
  loginStreak:           { type: "number" },
  lastLoginDate:         { type: "string", nullable: true },
  lastLoginRewardDate:   { type: "string", nullable: true },
};

function validateAndConvert(field, value) {
  const schema = FIELD_SCHEMA[field];
  if (!schema) return { error: `Unknown field: ${field}` };

  // Nullable fields can be set to null
  if (value === null) {
    if (schema.nullable) return { value: null };
    return { error: `${field} cannot be null` };
  }

  switch (schema.type) {
    case "string":
      if (typeof value !== "string") return { error: `${field} must be a string` };
      return { value };

    case "enum":
      if (!schema.values.includes(value)) {
        return { error: `${field} must be one of: ${schema.values.join(", ")}` };
      }
      return { value };

    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return { error: `${field} must be a finite number` };
      }
      return { value };

    case "boolean":
      if (typeof value !== "boolean") return { error: `${field} must be a boolean` };
      return { value };

    case "array_of_strings":
      if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
        return { error: `${field} must be an array of strings` };
      }
      return { value };

    case "timestamp":
      // Accept ISO-8601 string, convert to Firestore Timestamp
      if (typeof value !== "string") return { error: `${field} must be an ISO-8601 date string` };
      const date = new Date(value);
      if (isNaN(date.getTime())) return { error: `${field} is not a valid date` };
      return { value: Timestamp.fromDate(date) };

    default:
      return { error: `Unknown type for ${field}` };
  }
}

// --- GET /api/search/uniqueId/:id ---
app.get("/api/search/uniqueId/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "uniqueId must be a number" });
    }

    const snapshot = await getFirestore().collection("users")
      .where("uniqueId", "==", id)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ error: "No user found with that uniqueId" });
    }

    const doc = snapshot.docs[0];
    const data = doc.data();

    for (const [key, val] of Object.entries(data)) {
      if (val && typeof val.toDate === "function") {
        data[key] = val.toDate().toISOString();
      }
    }

    return res.json({ uid: doc.id, ...data });
  } catch (err) {
    console.error("GET /api/search/uniqueId error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// --- POST /api/resolve/uids-to-uniqueIds ---
// Takes { uids: [...] }, returns { mapping: { firebaseUid: { uniqueId, displayName }, ... } }
app.post("/api/resolve/uids-to-uniqueIds", async (req, res) => {
  try {
    const { uids } = req.body;
    if (!Array.isArray(uids) || !uids.every((u) => typeof u === "string")) {
      return res.status(400).json({ error: "uids must be an array of strings" });
    }
    if (uids.length === 0) return res.json({ mapping: {} });

    const db = getFirestore();
    const mapping = {};

    // Firestore getAll supports batch doc reads
    for (let i = 0; i < uids.length; i += 30) {
      const batch = uids.slice(i, i + 30);
      const refs = batch.map((uid) => db.collection("users").doc(uid));
      const docs = await db.getAll(...refs);
      for (const doc of docs) {
        if (doc.exists) {
          const data = doc.data();
          mapping[doc.id] = {
            uniqueId: data.uniqueId ?? null,
            displayName: data.displayName ?? "",
          };
        }
      }
    }

    return res.json({ mapping });
  } catch (err) {
    console.error("POST /api/resolve/uids-to-uniqueIds error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// --- POST /api/resolve/uniqueIds-to-uids ---
// Takes { uniqueIds: [...] }, returns { mapping: { uniqueId: firebaseUid, ... } }
app.post("/api/resolve/uniqueIds-to-uids", async (req, res) => {
  try {
    const { uniqueIds } = req.body;
    if (!Array.isArray(uniqueIds) || !uniqueIds.every((n) => typeof n === "number")) {
      return res.status(400).json({ error: "uniqueIds must be an array of numbers" });
    }
    if (uniqueIds.length === 0) return res.json({ mapping: {} });

    const db = getFirestore();
    const mapping = {};

    // Firestore 'in' queries support max 30 items
    for (let i = 0; i < uniqueIds.length; i += 30) {
      const batch = uniqueIds.slice(i, i + 30);
      const snapshot = await db.collection("users")
        .where("uniqueId", "in", batch)
        .get();
      for (const doc of snapshot.docs) {
        mapping[doc.data().uniqueId] = doc.id;
      }
    }

    return res.json({ mapping });
  } catch (err) {
    console.error("POST /api/resolve/uniqueIds-to-uids error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// --- GET /api/user/:uid ---
app.get("/api/user/:uid", async (req, res) => {
  try {
    const doc = await getFirestore().collection("users").doc(req.params.uid).get();
    if (!doc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    const data = doc.data();

    // Convert Firestore Timestamps to ISO strings for the frontend
    for (const [key, val] of Object.entries(data)) {
      if (val && typeof val.toDate === "function") {
        data[key] = val.toDate().toISOString();
      }
    }

    return res.json({ uid: doc.id, ...data });
  } catch (err) {
    console.error("GET /api/user error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// --- PATCH /api/user/:uid ---
app.patch("/api/user/:uid", async (req, res) => {
  try {
    const updates = req.body;

    if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
      return res.status(400).json({ error: "Body must be a JSON object" });
    }

    if ("uid" in updates) {
      return res.status(400).json({ error: "uid is immutable" });
    }

    const firestoreUpdates = {};
    const errors = [];

    for (const [field, value] of Object.entries(updates)) {
      const result = validateAndConvert(field, value);
      if (result.error) {
        errors.push(result.error);
      } else {
        firestoreUpdates[field] = result.value;
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join("; ") });
    }

    if (Object.keys(firestoreUpdates).length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    const docRef = getFirestore().collection("users").doc(req.params.uid);
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    await docRef.update(firestoreUpdates);
    return res.json({ success: true, updatedFields: Object.keys(firestoreUpdates) });
  } catch (err) {
    console.error("PATCH /api/user error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// --- POST /api/user/:uid/suspend ---
app.post("/api/user/:uid/suspend", async (req, res) => {
  try {
    const { reason, endDate, canAppeal } = req.body;

    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      return res.status(400).json({ error: "reason is required" });
    }
    if (typeof canAppeal !== "boolean") {
      return res.status(400).json({ error: "canAppeal must be a boolean" });
    }

    let endTimestamp = null;
    if (endDate !== null && endDate !== undefined) {
      const d = new Date(endDate);
      if (isNaN(d.getTime())) {
        return res.status(400).json({ error: "endDate must be a valid ISO-8601 date or null" });
      }
      if (d.getTime() <= Date.now()) {
        return res.status(400).json({ error: "endDate must be in the future" });
      }
      endTimestamp = Timestamp.fromDate(d);
    }

    const docRef = getFirestore().collection("users").doc(req.params.uid);
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    const userData = doc.data();
    const preSuspension = {
      displayName: userData.displayName || "",
      profilePhotoUrl: userData.profilePhotoUrl || null,
      coverPhotoUrl: userData.coverPhotoUrl || null,
    };

    await docRef.update({
      isSuspended: true,
      suspensionReason: reason.trim(),
      suspensionStartDate: Timestamp.now(),
      suspensionEndDate: endTimestamp,
      suspensionCanAppeal: canAppeal,
      suspendedBy: req.admin.uid,
      _preSuspension: preSuspension,
    });

    return res.json({ success: true });
  } catch (err) {
    console.error("POST /api/user/:uid/suspend error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// --- POST /api/user/:uid/unsuspend ---
app.post("/api/user/:uid/unsuspend", async (req, res) => {
  try {
    const docRef = getFirestore().collection("users").doc(req.params.uid);
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    const userData = doc.data();
    const updates = { isSuspended: false };

    // Restore pre-suspension profile data if available
    if (userData._preSuspension) {
      updates.displayName = userData._preSuspension.displayName || userData.displayName;
      updates.profilePhotoUrl = userData._preSuspension.profilePhotoUrl || null;
      updates.coverPhotoUrl = userData._preSuspension.coverPhotoUrl || null;
      updates._preSuspension = FieldValue.delete();
    }

    await docRef.update(updates);
    return res.json({ success: true });
  } catch (err) {
    console.error("POST /api/user/:uid/unsuspend error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// --- GET /api/appeals ---
app.get("/api/appeals", async (req, res) => {
  try {
    const db = getFirestore();
    const status = req.query.status || "pending";
    if (!["pending", "approved", "rejected"].includes(status)) {
      return res.status(400).json({ error: "status must be pending, approved, or rejected" });
    }

    // Single-field query avoids composite index requirement
    const snapshot = await db.collection("suspensionAppeals")
      .where("status", "==", status)
      .limit(50)
      .get();

    const appeals = snapshot.docs.map((doc) => {
      const data = doc.data();
      for (const [key, val] of Object.entries(data)) {
        if (val && typeof val.toDate === "function") {
          data[key] = val.toDate().toISOString();
        }
      }
      return { id: doc.id, ...data };
    });

    // Sort by submittedAt desc in memory
    appeals.sort((a, b) => {
      const ta = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
      const tb = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
      return tb - ta;
    });

    // Enrich each appeal with user suspension info and reports
    const userIds = [...new Set(appeals.map((a) => a.userId).filter(Boolean))];
    const userMap = {};
    for (let i = 0; i < userIds.length; i += 30) {
      const batch = userIds.slice(i, i + 30);
      const refs = batch.map((uid) => db.collection("users").doc(uid));
      const docs = await db.getAll(...refs);
      for (const doc of docs) {
        if (doc.exists) {
          const ud = doc.data();
          const convertTs = (v) => v && typeof v.toDate === "function" ? v.toDate().toISOString() : v;
          userMap[doc.id] = {
            displayName: ud.displayName || "",
            profilePhotoUrl: ud.profilePhotoUrl || null,
            uniqueId: ud.uniqueId || 0,
            suspensionReason: ud.suspensionReason || null,
            suspensionStartDate: convertTs(ud.suspensionStartDate),
            suspensionEndDate: convertTs(ud.suspensionEndDate),
            suspendedBy: ud.suspendedBy || null,
            preSuspension: ud._preSuspension || null,
          };
        }
      }
    }

    // Fetch reports for each user
    const reportsMap = {};
    for (const uid of userIds) {
      try {
        const reportsSnap = await db.collection("reports")
          .where("reportedUserId", "==", uid)
          .orderBy("timestamp", "desc")
          .limit(20)
          .get();
        reportsMap[uid] = reportsSnap.docs.map((doc) => {
          const rd = doc.data();
          for (const [key, val] of Object.entries(rd)) {
            if (val && typeof val.toDate === "function") {
              rd[key] = val.toDate().toISOString();
            }
          }
          return { reportId: doc.id, ...rd };
        });
      } catch (e) {
        // If composite index doesn't exist, fall back without ordering
        const reportsSnap = await db.collection("reports")
          .where("reportedUserId", "==", uid)
          .limit(20)
          .get();
        reportsMap[uid] = reportsSnap.docs.map((doc) => {
          const rd = doc.data();
          for (const [key, val] of Object.entries(rd)) {
            if (val && typeof val.toDate === "function") {
              rd[key] = val.toDate().toISOString();
            }
          }
          return { reportId: doc.id, ...rd };
        });
      }
    }

    // Attach user info and reports to each appeal
    for (const appeal of appeals) {
      const userInfo = userMap[appeal.userId];
      if (userInfo) {
        appeal.userInfo = userInfo;
        // Use original name from preSuspension if available
        if (userInfo.preSuspension) {
          appeal.originalDisplayName = userInfo.preSuspension.displayName;
          appeal.originalProfilePhotoUrl = userInfo.preSuspension.profilePhotoUrl;
        }
      }
      appeal.reports = reportsMap[appeal.userId] || [];
    }

    return res.json({ appeals });
  } catch (err) {
    console.error("GET /api/appeals error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// --- PATCH /api/appeals/:id ---
app.patch("/api/appeals/:id", async (req, res) => {
  try {
    const { status, adminNote } = req.body;
    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({ error: "status must be approved or rejected" });
    }

    const db = getFirestore();
    const appealRef = db.collection("suspensionAppeals").doc(req.params.id);
    const appealDoc = await appealRef.get();
    if (!appealDoc.exists) {
      return res.status(404).json({ error: "Appeal not found" });
    }

    const appealData = appealDoc.data();
    const appealUpdates = {
      status,
      reviewedBy: req.admin.uid,
      reviewedAt: Timestamp.now(),
    };
    if (adminNote !== undefined) {
      appealUpdates.adminNote = adminNote;
    }

    await appealRef.update(appealUpdates);

    // Update user doc based on appeal outcome
    const userRef = db.collection("users").doc(appealData.userId);
    if (status === "approved") {
      const userDoc = await userRef.get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        const userUpdates = { isSuspended: false, suspensionAppealStatus: "approved" };
        if (userData._preSuspension) {
          userUpdates.displayName = userData._preSuspension.displayName || userData.displayName;
          userUpdates.profilePhotoUrl = userData._preSuspension.profilePhotoUrl || null;
          userUpdates.coverPhotoUrl = userData._preSuspension.coverPhotoUrl || null;
          userUpdates._preSuspension = FieldValue.delete();
        }
        await userRef.update(userUpdates);
      }
    } else {
      await userRef.update({ suspensionAppealStatus: "rejected" });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("PATCH /api/appeals/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// --- GCS Helper ---
function computeDisplayScore(floor, lastDeductionAt) {
  if (lastDeductionAt == null) return Math.min(100, floor);
  const now = Date.now();
  const deductionTime = lastDeductionAt.toDate ? lastDeductionAt.toDate().getTime() : new Date(lastDeductionAt).getTime();
  const monthsSince = (now - deductionTime) / (30 * 24 * 60 * 60 * 1000);
  return Math.min(100, Math.floor(floor + 2 * monthsSince));
}

// --- Timestamp Formatting Helper ---
function formatTimestamp(firestoreTimestamp) {
  if (!firestoreTimestamp) return "an unknown date";
  const date = firestoreTimestamp.toDate ? firestoreTimestamp.toDate() : new Date(firestoreTimestamp);
  if (isNaN(date.getTime())) return "an unknown date";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = date.getUTCDate();
  const month = months[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${day} ${month} ${year} at ${hours}:${minutes} UTC`;
}

// --- Audit Log Helper ---
async function writeAuditLog(db, { adminUid, action, targetUserId, reportId, severity, note }) {
  await db.collection("admin_audit_log").add({
    adminUid,
    action,
    targetUserId: targetUserId || null,
    reportId: reportId || null,
    severity: severity || null,
    note: note || null,
    timestamp: Timestamp.now(),
  });
}

// --- sendSystemPm (imported from index.js at runtime) ---
async function sendSystemPm(recipientUid, text) {
  // Re-implement inline to avoid circular dependency with index.js
  const SYSTEM_UID = "SHYTALK_SYSTEM";
  const SYSTEM_NAME = "ShyTalk";
  const db = getFirestore();

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

  // Use deterministic ID matching app's Conversation.generateId()
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

  const msgRef = convRef.collection("messages").doc();
  await msgRef.set({
    senderId: SYSTEM_UID,
    senderName: SYSTEM_NAME,
    text,
    type: "TEXT",
    createdAt: FieldValue.serverTimestamp(),
  });

  await convRef.update({
    lastMessage: lastMessagePreview,
    lastMessageAt: FieldValue.serverTimestamp(),
  });
}

// --- GET /api/reports ---
app.get("/api/reports", async (req, res) => {
  try {
    const status = req.query.status || "pending";
    const search = req.query.search || null;
    const userId = req.query.userId || null;

    if (!["pending", "resolved", "archived"].includes(status)) {
      return res.status(400).json({ error: "status must be pending, resolved, or archived" });
    }

    const db = getFirestore();
    const collection = status === "archived" ? "reports_archive" : "reports";

    let query = db.collection(collection).where("status", "==", status === "archived" ? "resolved" : status);

    if (userId) {
      query = query.where("reportedUserId", "==", userId);
    }

    const snapshot = await query.limit(200).get();

    // Group by reportedUserId
    const grouped = {};
    for (const doc of snapshot.docs) {
      const data = doc.data();
      // Convert timestamps
      for (const [key, val] of Object.entries(data)) {
        if (val && typeof val.toDate === "function") {
          data[key] = val.toDate().toISOString();
        }
      }
      data.reportId = doc.id;

      const reportedUid = data.reportedUserId;
      if (!grouped[reportedUid]) {
        grouped[reportedUid] = { uid: reportedUid, reports: [] };
      }
      grouped[reportedUid].reports.push(data);
    }

    // Fetch user docs for all reported users
    const reportedUids = Object.keys(grouped);
    for (let i = 0; i < reportedUids.length; i += 30) {
      const batch = reportedUids.slice(i, i + 30);
      const refs = batch.map((uid) => db.collection("users").doc(uid));
      const docs = await db.getAll(...refs);
      for (const doc of docs) {
        if (doc.exists && grouped[doc.id]) {
          const userData = doc.data();
          // For suspended users, show original name/photo from _preSuspension
          const preSus = userData._preSuspension;
          grouped[doc.id].displayName = (preSus && preSus.displayName) || userData.displayName || "";
          grouped[doc.id].uniqueId = userData.uniqueId || 0;
          grouped[doc.id].profilePhotoUrl = (preSus && preSus.profilePhotoUrl) || userData.profilePhotoUrl || null;
          grouped[doc.id].warningCount = userData.warningCount || 0;
          grouped[doc.id].isSuspended = userData.isSuspended || false;

          const floor = userData.goodCharacterScore ?? 100;
          const lastDeduction = userData.goodCharacterLastDeductionAt || null;
          grouped[doc.id].gcs = {
            floor,
            displayScore: computeDisplayScore(floor, lastDeduction),
            lastDeductionAt: lastDeduction && typeof lastDeduction.toDate === "function"
              ? lastDeduction.toDate().toISOString() : lastDeduction,
          };
        }
      }
    }

    // Enrich reporter info for reports missing reporterName (backfill old reports)
    const allReporterUids = new Set();
    for (const group of Object.values(grouped)) {
      for (const r of group.reports) {
        if (!r.reporterName && r.reporterId) allReporterUids.add(r.reporterId);
      }
    }
    const reporterUids = [...allReporterUids];
    const reporterMap = {};
    for (let i = 0; i < reporterUids.length; i += 30) {
      const batch = reporterUids.slice(i, i + 30);
      const refs = batch.map((uid) => db.collection("users").doc(uid));
      const docs = await db.getAll(...refs);
      for (const doc of docs) {
        if (doc.exists) {
          const d = doc.data();
          reporterMap[doc.id] = { name: d.displayName || "", uniqueId: d.uniqueId || 0 };
        }
      }
    }
    // Backfill reporter names
    for (const group of Object.values(grouped)) {
      for (const r of group.reports) {
        if (!r.reporterName && reporterMap[r.reporterId]) {
          r.reporterName = reporterMap[r.reporterId].name;
          r.reporterUniqueId = reporterMap[r.reporterId].uniqueId;
        }
      }
    }

    let users = Object.values(grouped);

    // Search filter
    if (search) {
      const searchNum = Number(search);
      users = users.filter((u) => {
        if (Number.isFinite(searchNum) && u.uniqueId === searchNum) return true;
        // Also check reporter uniqueIds
        return u.reports.some((r) => {
          if (r.reporterUniqueId === searchNum) return true;
          return false;
        });
      });
    }

    // Sort by most recent report first (newest at top)
    users.sort((a, b) => {
      const aLatest = a.reports.reduce((max, r) => {
        const t = r.timestamp ? new Date(r.timestamp).getTime() : 0;
        return t > max ? t : max;
      }, 0);
      const bLatest = b.reports.reduce((max, r) => {
        const t = r.timestamp ? new Date(r.timestamp).getTime() : 0;
        return t > max ? t : max;
      }, 0);
      return bLatest - aLatest;
    });

    // Sort reports within each user (most recent first) and count
    users.forEach((u) => {
      u.reports.sort((a, b) => {
        const aTime = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const bTime = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return bTime - aTime;
      });
      u.reportCount = u.reports.length;
    });

    // Fetch active review locks
    const locksSnap = await db.collection("report_locks").get();
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    const lockMap = {};
    for (const lockDoc of locksSnap.docs) {
      const ld = lockDoc.data();
      const lockTime = ld.timestamp?.toDate?.()?.getTime() || 0;
      if (lockTime > fiveMinAgo) {
        lockMap[lockDoc.id] = {
          adminUid: ld.adminUid,
          displayName: ld.displayName || "Admin",
          lockedAt: ld.timestamp?.toDate?.()?.toISOString(),
        };
      }
    }
    users.forEach((u) => { u.lock = lockMap[u.uid] || null; });

    return res.json({ users });
  } catch (err) {
    console.error("GET /api/reports error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// --- GET /api/conversations/:id/messages ---
// Fetch messages from a conversation for admin review
app.get("/api/conversations/:id/messages", async (req, res) => {
  try {
    const conversationId = req.params.id;
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const db = getFirestore();

    const snapshot = await db.collection("conversations").doc(conversationId)
      .collection("messages")
      .orderBy("timestamp", "desc")
      .limit(limit)
      .get();

    const messages = snapshot.docs.map((doc) => {
      const data = doc.data();
      // Convert timestamps
      for (const [key, val] of Object.entries(data)) {
        if (val && typeof val.toDate === "function") {
          data[key] = val.toDate().toISOString();
        }
      }
      data.messageId = doc.id;
      return data;
    }).reverse(); // chronological order

    return res.json({ messages });
  } catch (err) {
    console.error("GET /api/conversations/:id/messages error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// --- POST /api/reports/:id/resolve ---
app.post("/api/reports/:id/resolve", async (req, res) => {
  try {
    const { action, severity, adminNote, suspensionDays, canAppeal } = req.body;

    if (!["warn", "suspend", "dismiss"].includes(action)) {
      return res.status(400).json({ error: "action must be warn, suspend, or dismiss" });
    }
    if (action !== "dismiss" && (typeof severity !== "number" || severity < 1 || severity > 5)) {
      return res.status(400).json({ error: "severity must be 1-5 for warn/suspend" });
    }

    const db = getFirestore();
    const reportRef = db.collection("reports").doc(req.params.id);
    const reportDoc = await reportRef.get();
    if (!reportDoc.exists) {
      return res.status(404).json({ error: "Report not found" });
    }
    const report = reportDoc.data();
    if (report.status !== "pending") {
      return res.status(400).json({ error: "Report is already resolved" });
    }

    const reportedUserId = report.reportedUserId;
    const reporterId = report.reporterId;
    const reportType = (report.reason && report.reason.toLowerCase() !== "other") ? report.reason : "a policy violation";

    // Update report status
    await reportRef.update({
      status: "resolved",
      resolvedAction: action,
      resolvedBy: req.admin.uid,
      resolvedAt: Timestamp.now(),
      severity: action !== "dismiss" ? severity : null,
      adminNote: adminNote || null,
    });

    let autoEscalateSuggested = false;

    if (action === "warn" || action === "suspend") {
      // GCS deduction
      const userRef = db.collection("users").doc(reportedUserId);
      const userDoc = await userRef.get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        const currentFloor = userData.goodCharacterScore ?? 100;
        const lastDeduction = userData.goodCharacterLastDeductionAt || null;
        const currentDisplay = computeDisplayScore(currentFloor, lastDeduction);
        const deduction = severity * 5;
        const newFloor = Math.max(0, currentDisplay - deduction);

        const updates = {
          goodCharacterScore: newFloor,
          goodCharacterLastDeductionAt: Timestamp.now(),
        };

        if (action === "warn") {
          updates.warningCount = FieldValue.increment(1);
          updates.hasActiveWarning = true;
          updates.warningReason = reportType;
          updates.warningIssuedAt = Timestamp.now();

          const newWarningCount = (userData.warningCount || 0) + 1;
          if (newWarningCount >= 5) {
            autoEscalateSuggested = true;
          }

          // Revoke tokens to force logout
          try {
            await getAuth().revokeRefreshTokens(reportedUserId);
          } catch (err) {
            console.error(`Failed to revoke tokens for ${reportedUserId}:`, err);
          }
        }

        await userRef.update(updates);
      }

      // Suspend action
      if (action === "suspend") {
        let endDate = null;
        if (suspensionDays && suspensionDays > 0) {
          endDate = new Date(Date.now() + suspensionDays * 86400000).toISOString();
        }

        // Reuse the suspend endpoint logic
        const userRef2 = db.collection("users").doc(reportedUserId);
        const userDoc2 = await userRef2.get();
        if (userDoc2.exists) {
          const userData2 = userDoc2.data();
          const preSuspension = {
            displayName: userData2.displayName || "",
            profilePhotoUrl: userData2.profilePhotoUrl || null,
            coverPhotoUrl: userData2.coverPhotoUrl || null,
          };

          await userRef2.update({
            isSuspended: true,
            suspensionReason: reportType,
            suspensionStartDate: Timestamp.now(),
            suspensionEndDate: endDate ? Timestamp.fromDate(new Date(endDate)) : null,
            suspensionCanAppeal: canAppeal === true,
            suspendedBy: req.admin.uid,
            _preSuspension: preSuspension,
          });
        }
      }
    }

    // Send system PMs
    const reporterName = report.reporterName || "there";
    const reportedUserName = report.reportedUserName || "a user";
    const reportedUserUniqueId = report.reportedUserUniqueId || "unknown";
    const reportDate = formatTimestamp(report.timestamp);
    const evidenceLine = (Array.isArray(report.evidenceUrls) && report.evidenceUrls.length > 0)
      ? " Your attached evidence was reviewed as part of our investigation."
      : "";

    if (action === "warn") {
      await sendSystemPm(reporterId,
        `Hi ${reporterName},\n\nWe've reviewed your report against ${reportedUserName} (ID: ${reportedUserUniqueId}), submitted on ${reportDate} regarding ${reportType}.${evidenceLine}\n\nAction has been taken against this user. If they continue to violate our Community Guidelines (available in Settings > About), please don't hesitate to report them again. You can also block them from their profile if you'd prefer not to interact with them.\n\nThank you for helping keep ShyTalk safe.`);
      await sendSystemPm(reportedUserId,
        `Your account has been reviewed for ${reportType}. Please ensure your behaviour follows our community guidelines.`);
    } else if (action === "suspend") {
      await sendSystemPm(reporterId,
        `Hi ${reporterName},\n\nWe've reviewed your report against ${reportedUserName} (ID: ${reportedUserUniqueId}), submitted on ${reportDate} regarding ${reportType}.${evidenceLine}\n\nThe reported user has been suspended. If you encounter similar issues with other users, please report them — it helps us keep the community safe. You can review our Community Guidelines in Settings > About.\n\nThank you for your report.`);
      // Suspended user already gets the suspension notice on login, no PM needed
    } else if (action === "dismiss") {
      await sendSystemPm(reporterId,
        `Hi ${reporterName},\n\nWe've reviewed your report against ${reportedUserName} (ID: ${reportedUserUniqueId}), submitted on ${reportDate} regarding ${reportType}.${evidenceLine}\n\nAfter careful investigation, no action was taken at this time. This may be because the reported behaviour didn't meet the threshold for action under our Community Guidelines (available in Settings > About), but your report has been noted. If this user's behaviour continues or escalates, please report them again.\n\nThank you for bringing this to our attention.`);
    }

    // Audit log
    await writeAuditLog(db, {
      adminUid: req.admin.uid,
      action: `report_${action}`,
      targetUserId: reportedUserId,
      reportId: req.params.id,
      severity: action !== "dismiss" ? severity : null,
      note: adminNote,
    });

    return res.json({ success: true, autoEscalateSuggested });
  } catch (err) {
    console.error("POST /api/reports/:id/resolve error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// --- POST /api/reports/resolve-all/:reportedUserId ---
app.post("/api/reports/resolve-all/:reportedUserId", async (req, res) => {
  try {
    const { action, severity, adminNote, suspensionDays, canAppeal } = req.body;
    const reportedUserId = req.params.reportedUserId;

    if (!["warn", "suspend", "dismiss"].includes(action)) {
      return res.status(400).json({ error: "action must be warn, suspend, or dismiss" });
    }
    if (action !== "dismiss" && (typeof severity !== "number" || severity < 1 || severity > 5)) {
      return res.status(400).json({ error: "severity must be 1-5 for warn/suspend" });
    }

    const db = getFirestore();

    // Get all pending reports for this user
    const reportsSnap = await db.collection("reports")
      .where("reportedUserId", "==", reportedUserId)
      .where("status", "==", "pending")
      .get();

    if (reportsSnap.empty) {
      return res.status(404).json({ error: "No pending reports found for this user" });
    }

    // Resolve all reports
    const batch = db.batch();
    const reportIds = [];
    let reportType = "a policy violation";
    let reporterId = null;

    for (const doc of reportsSnap.docs) {
      reportIds.push(doc.id);
      const data = doc.data();
      if (!reporterId) reporterId = data.reporterId;
      if (data.reason && data.reason.toLowerCase() !== "other") reportType = data.reason;

      batch.update(doc.ref, {
        status: "resolved",
        resolvedAction: action,
        resolvedBy: req.admin.uid,
        resolvedAt: Timestamp.now(),
        severity: action !== "dismiss" ? severity : null,
        adminNote: adminNote || null,
      });
    }
    await batch.commit();

    let autoEscalateSuggested = false;

    // Single GCS deduction for all reports
    if (action === "warn" || action === "suspend") {
      const userRef = db.collection("users").doc(reportedUserId);
      const userDoc = await userRef.get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        const currentFloor = userData.goodCharacterScore ?? 100;
        const lastDeduction = userData.goodCharacterLastDeductionAt || null;
        const currentDisplay = computeDisplayScore(currentFloor, lastDeduction);
        const deduction = severity * 5;
        const newFloor = Math.max(0, currentDisplay - deduction);

        const updates = {
          goodCharacterScore: newFloor,
          goodCharacterLastDeductionAt: Timestamp.now(),
        };

        if (action === "warn") {
          updates.warningCount = FieldValue.increment(1);
          updates.hasActiveWarning = true;
          updates.warningReason = reportType;
          updates.warningIssuedAt = Timestamp.now();

          if ((userData.warningCount || 0) + 1 >= 5) {
            autoEscalateSuggested = true;
          }

          try {
            await getAuth().revokeRefreshTokens(reportedUserId);
          } catch (err) {
            console.error(`Failed to revoke tokens: ${err}`);
          }
        }

        await userRef.update(updates);
      }

      if (action === "suspend") {
        let endDate = null;
        if (suspensionDays && suspensionDays > 0) {
          endDate = new Date(Date.now() + suspensionDays * 86400000).toISOString();
        }

        const userRef2 = db.collection("users").doc(reportedUserId);
        const userDoc2 = await userRef2.get();
        if (userDoc2.exists) {
          const userData2 = userDoc2.data();
          await userRef2.update({
            isSuspended: true,
            suspensionReason: reportType,
            suspensionStartDate: Timestamp.now(),
            suspensionEndDate: endDate ? Timestamp.fromDate(new Date(endDate)) : null,
            suspensionCanAppeal: canAppeal === true,
            suspendedBy: req.admin.uid,
            _preSuspension: {
              displayName: userData2.displayName || "",
              profilePhotoUrl: userData2.profilePhotoUrl || null,
              coverPhotoUrl: userData2.coverPhotoUrl || null,
            },
          });
        }
      }
    }

    // System PMs (send to each unique reporter + reported user)
    const sentReporters = new Set();
    for (const doc of reportsSnap.docs) {
      const data = doc.data();
      const rid = data.reporterId;
      if (!rid || sentReporters.has(rid)) continue;
      sentReporters.add(rid);

      const rName = data.reporterName || "there";
      const ruName = data.reportedUserName || "a user";
      const ruId = data.reportedUserUniqueId || "unknown";
      const rDate = formatTimestamp(data.timestamp);
      const rType = (data.reason && data.reason.toLowerCase() !== "other") ? data.reason : "a policy violation";
      const eLine = (Array.isArray(data.evidenceUrls) && data.evidenceUrls.length > 0)
        ? " Your attached evidence was reviewed as part of our investigation."
        : "";

      if (action === "warn") {
        await sendSystemPm(rid,
          `Hi ${rName},\n\nWe've reviewed your report against ${ruName} (ID: ${ruId}), submitted on ${rDate} regarding ${rType}.${eLine}\n\nAction has been taken against this user. If they continue to violate our Community Guidelines (available in Settings > About), please don't hesitate to report them again. You can also block them from their profile if you'd prefer not to interact with them.\n\nThank you for helping keep ShyTalk safe.`);
      } else if (action === "suspend") {
        await sendSystemPm(rid,
          `Hi ${rName},\n\nWe've reviewed your report against ${ruName} (ID: ${ruId}), submitted on ${rDate} regarding ${rType}.${eLine}\n\nThe reported user has been suspended. If you encounter similar issues with other users, please report them — it helps us keep the community safe. You can review our Community Guidelines in Settings > About.\n\nThank you for your report.`);
      } else if (action === "dismiss") {
        await sendSystemPm(rid,
          `Hi ${rName},\n\nWe've reviewed your report against ${ruName} (ID: ${ruId}), submitted on ${rDate} regarding ${rType}.${eLine}\n\nAfter careful investigation, no action was taken at this time. This may be because the reported behaviour didn't meet the threshold for action under our Community Guidelines (available in Settings > About), but your report has been noted. If this user's behaviour continues or escalates, please report them again.\n\nThank you for bringing this to our attention.`);
      }
    }
    // Warn PM to the reported user
    if (action === "warn") {
      await sendSystemPm(reportedUserId,
        `Your account has been reviewed for ${reportType}. Please ensure your behaviour follows our community guidelines.`);
    }

    // Audit log
    await writeAuditLog(db, {
      adminUid: req.admin.uid,
      action: `bulk_report_${action}`,
      targetUserId: reportedUserId,
      reportId: reportIds.join(","),
      severity: action !== "dismiss" ? severity : null,
      note: adminNote,
    });

    return res.json({ success: true, resolvedCount: reportIds.length, autoEscalateSuggested });
  } catch (err) {
    console.error("POST /api/reports/resolve-all error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// --- POST /api/user/:uid/reset-gcs ---
app.post("/api/user/:uid/reset-gcs", async (req, res) => {
  try {
    const db = getFirestore();
    const userRef = db.collection("users").doc(req.params.uid);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    await userRef.update({
      goodCharacterScore: 100,
      goodCharacterLastDeductionAt: null,
      warningCount: 0,
    });

    await writeAuditLog(db, {
      adminUid: req.admin.uid,
      action: "reset_gcs",
      targetUserId: req.params.uid,
    });

    return res.json({ success: true });
  } catch (err) {
    console.error("POST /api/user/:uid/reset-gcs error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// --- Review lock endpoints ---
app.post("/api/report-locks/:reportedUserId/lock", async (req, res) => {
  try {
    const db = getFirestore();
    const lockRef = db.collection("report_locks").doc(req.params.reportedUserId);
    const lockDoc = await lockRef.get();

    if (lockDoc.exists) {
      const lockData = lockDoc.data();
      const lockAge = Date.now() - (lockData.timestamp?.toDate?.()?.getTime() || 0);
      // Lock expires after 5 minutes
      if (lockAge < 5 * 60 * 1000 && lockData.adminUid !== req.admin.uid) {
        return res.json({
          locked: true,
          lockedBy: lockData.displayName || "Another admin",
          lockedAt: lockData.timestamp?.toDate?.()?.toISOString(),
        });
      }
    }

    await lockRef.set({
      adminUid: req.admin.uid,
      displayName: req.admin.name || req.admin.email || "Admin",
      timestamp: Timestamp.now(),
    });

    return res.json({ locked: false });
  } catch (err) {
    console.error("POST /api/report-locks/:id/lock error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.delete("/api/report-locks/:reportedUserId", async (req, res) => {
  try {
    const db = getFirestore();
    await db.collection("report_locks").doc(req.params.reportedUserId).delete();
    return res.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/report-locks error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// --- GET /api/reports/export ---
app.get("/api/reports/export", async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ error: "from and to query params required (ISO dates)" });
    }

    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return res.status(400).json({ error: "Invalid date format" });
    }

    const db = getFirestore();
    const snapshot = await db.collection("reports")
      .where("status", "==", "resolved")
      .where("resolvedAt", ">=", Timestamp.fromDate(fromDate))
      .where("resolvedAt", "<=", Timestamp.fromDate(toDate))
      .limit(5000)
      .get();

    const header = "Report ID,Reporter,Reported User,Type,Reason,Action Taken,Severity,Admin Note,Created At,Resolved At";
    const rows = snapshot.docs.map((doc) => {
      const d = doc.data();
      const escape = (v) => `"${String(v || "").replace(/"/g, '""')}"`;
      const ts = (v) => v && typeof v.toDate === "function" ? v.toDate().toISOString() : (v || "");
      return [
        escape(doc.id),
        escape(d.reporterName),
        escape(d.reportedUserName),
        escape(d.type),
        escape(d.reason),
        escape(d.resolvedAction),
        d.severity || "",
        escape(d.adminNote),
        escape(ts(d.timestamp)),
        escape(ts(d.resolvedAt)),
      ].join(",");
    });

    const csv = [header, ...rows].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="reports_${from}_${to}.csv"`);
    return res.send(csv);
  } catch (err) {
    console.error("GET /api/reports/export error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// --- GET /api/reports/stats ---
app.get("/api/reports/stats", async (req, res) => {
  try {
    const db = getFirestore();
    const period = req.query.period || "7d";

    let daysBack = 7;
    if (period === "30d") daysBack = 30;
    else if (period === "all") daysBack = 3650;

    const cutoff = new Date(Date.now() - daysBack * 86400000);

    const pendingSnap = await db.collection("reports").where("status", "==", "pending").get();
    const pendingCount = pendingSnap.size;

    // Resolved today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const resolvedTodaySnap = await db.collection("reports")
      .where("status", "==", "resolved")
      .where("resolvedAt", ">=", Timestamp.fromDate(todayStart))
      .get();

    // Average response time in the period
    const resolvedInPeriodSnap = await db.collection("reports")
      .where("status", "==", "resolved")
      .where("resolvedAt", ">=", Timestamp.fromDate(cutoff))
      .limit(500)
      .get();

    let totalResponseMs = 0;
    let countWithTimes = 0;
    for (const doc of resolvedInPeriodSnap.docs) {
      const d = doc.data();
      if (d.timestamp && d.resolvedAt) {
        const created = d.timestamp.toDate ? d.timestamp.toDate().getTime() : new Date(d.timestamp).getTime();
        const resolved = d.resolvedAt.toDate ? d.resolvedAt.toDate().getTime() : new Date(d.resolvedAt).getTime();
        if (resolved > created) {
          totalResponseMs += resolved - created;
          countWithTimes++;
        }
      }
    }

    const avgResponseHours = countWithTimes > 0
      ? Math.round(totalResponseMs / countWithTimes / 3600000 * 10) / 10
      : null;

    // Active reviewers (locks in last 5 min)
    const locksSnap = await db.collection("report_locks").get();
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    const activeReviewers = locksSnap.docs.filter((doc) => {
      const data = doc.data();
      const lockTime = data.timestamp?.toDate?.()?.getTime() || 0;
      return lockTime > fiveMinAgo;
    }).length;

    return res.json({
      pendingCount,
      resolvedToday: resolvedTodaySnap.size,
      avgResponseHours,
      activeReviewers,
    });
  } catch (err) {
    console.error("GET /api/reports/stats error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// --- POST /api/cleanup/system-conversations ---
// One-off: delete duplicate system conversations with auto-generated IDs
app.post("/api/cleanup/system-conversations", async (req, res) => {
  try {
    const db = getFirestore();
    const snap = await db.collection("conversations")
      .where("participantIds", "array-contains", "SHYTALK_SYSTEM")
      .get();

    const deleted = [];
    for (const doc of snap.docs) {
      const data = doc.data();
      const parts = data.participantIds || [];
      const otherUid = parts.find(id => id !== "SHYTALK_SYSTEM");
      const expectedId = [otherUid, "SHYTALK_SYSTEM"].sort().join("_");

      if (doc.id !== expectedId) {
        // Delete subcollections first
        const msgSnap = await doc.ref.collection("messages").get();
        const settingsSnap = await doc.ref.collection("settings").get();
        const batch = db.batch();
        msgSnap.docs.forEach(d => batch.delete(d.ref));
        settingsSnap.docs.forEach(d => batch.delete(d.ref));
        batch.delete(doc.ref);
        await batch.commit();
        deleted.push(doc.id);
      }
    }

    // Also delete empty deterministic-ID conversations
    const remainSnap = await db.collection("conversations")
      .where("participantIds", "array-contains", "SHYTALK_SYSTEM")
      .get();

    for (const doc of remainSnap.docs) {
      const msgSnap = await doc.ref.collection("messages").limit(1).get();
      if (msgSnap.empty) {
        const settingsSnap = await doc.ref.collection("settings").get();
        const batch = db.batch();
        settingsSnap.docs.forEach(d => batch.delete(d.ref));
        batch.delete(doc.ref);
        await batch.commit();
        deleted.push(doc.id + " (empty)");
      }
    }

    return res.json({ deleted, count: deleted.length });
  } catch (err) {
    console.error("Cleanup error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// --- POST /api/user/:uid/warn --- Direct warning without a report ---
app.post("/api/user/:uid/warn", async (req, res) => {
  try {
    const { reason, severity, adminNote } = req.body;
    const uid = req.params.uid;

    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      return res.status(400).json({ error: "reason is required" });
    }
    if (typeof severity !== "number" || severity < 1 || severity > 5) {
      return res.status(400).json({ error: "severity must be 1-5" });
    }

    const db = getFirestore();
    const userRef = db.collection("users").doc(uid);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    const userData = userDoc.data();
    const reportType = reason.toLowerCase() !== "other" ? reason : "a policy violation";

    // GCS deduction
    const currentFloor = userData.goodCharacterScore ?? 100;
    const lastDeduction = userData.goodCharacterLastDeductionAt || null;
    const currentDisplay = computeDisplayScore(currentFloor, lastDeduction);
    const deduction = severity * 5;
    const newFloor = Math.max(0, currentDisplay - deduction);

    const updates = {
      goodCharacterScore: newFloor,
      goodCharacterLastDeductionAt: Timestamp.now(),
      warningCount: FieldValue.increment(1),
      hasActiveWarning: true,
      warningReason: reportType,
      warningIssuedAt: Timestamp.now(),
    };

    await userRef.update(updates);

    const newWarningCount = (userData.warningCount || 0) + 1;
    let autoEscalateSuggested = false;
    if (newWarningCount >= 5) {
      autoEscalateSuggested = true;
    }

    // Revoke tokens to force logout
    try {
      await getAuth().revokeRefreshTokens(uid);
    } catch (err) {
      console.error(`Failed to revoke tokens for ${uid}:`, err);
    }

    // Send system PM
    await sendSystemPm(uid,
      `Your account has been reviewed for ${reportType}. Please ensure your behaviour follows our community guidelines.`);

    // Audit log
    await writeAuditLog(db, {
      adminUid: req.admin.uid,
      action: "direct_warn",
      targetUserId: uid,
      reportId: null,
      severity,
      note: adminNote || null,
    });

    return res.json({
      success: true,
      autoEscalateSuggested,
      newGCS: newFloor,
      warningCount: newWarningCount,
    });
  } catch (err) {
    console.error("POST /api/user/:uid/warn error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// --- Storage helpers ---
function extractStoragePath(url) {
  if (!url) return null;
  const match = url.match(/\/o\/(.+?)\?/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function deleteStorageFolder(prefix) {
  const bucket = getStorage().bucket();
  const [files] = await bucket.getFiles({ prefix });
  let deleted = 0;
  for (const file of files) {
    await file.delete();
    deleted++;
  }
  return deleted;
}

async function auditStorageFolder(prefix) {
  const bucket = getStorage().bucket();
  const [files] = await bucket.getFiles({ prefix });
  let totalBytes = 0;
  for (const file of files) {
    const [metadata] = await file.getMetadata();
    totalBytes += parseInt(metadata.size || "0", 10);
  }
  return { files: files.length, bytes: totalBytes };
}

// --- POST /api/cleanup/all-system-conversations ---
// Delete ALL conversations with SHYTALK_SYSTEM (and their subcollections)
app.post("/api/cleanup/all-system-conversations", async (req, res) => {
  try {
    const db = getFirestore();
    const snap = await db.collection("conversations")
      .where("participantIds", "array-contains", "SHYTALK_SYSTEM")
      .get();

    let deleted = 0;
    const storagePaths = [];
    const bucket = getStorage().bucket();
    for (const doc of snap.docs) {
      const msgSnap = await doc.ref.collection("messages").get();
      // Collect storage paths from messages with imageUrls
      for (const msgDoc of msgSnap.docs) {
        const urls = msgDoc.data().imageUrls || [];
        for (const url of urls) {
          const match = url.match(/\/o\/(.+?)\?/);
          if (match) storagePaths.push(decodeURIComponent(match[1]));
        }
      }
      const settingsSnap = await doc.ref.collection("settings").get();
      const batch = db.batch();
      msgSnap.docs.forEach(d => batch.delete(d.ref));
      settingsSnap.docs.forEach(d => batch.delete(d.ref));
      batch.delete(doc.ref);
      await batch.commit();
      deleted++;
    }

    // Delete collected storage files
    let storageFilesDeleted = 0;
    for (const path of storagePaths) {
      try {
        await bucket.file(path).delete();
        storageFilesDeleted++;
      } catch (_) { /* file may already be gone */ }
    }

    await writeAuditLog(db, {
      adminUid: req.admin.uid,
      action: "cleanup_all_system_conversations",
      note: `Deleted ${deleted} system conversations, ${storageFilesDeleted} storage files`,
    });

    return res.json({ success: true, deleted, storageFilesDeleted });
  } catch (err) {
    console.error("Cleanup all system conversations error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// --- POST /api/cleanup/all-reports ---
// Delete all reports, archived reports, and report locks
app.post("/api/cleanup/all-reports", async (req, res) => {
  try {
    const db = getFirestore();
    let deleted = 0;

    // Delete from reports collection
    const reportsSnap = await db.collection("reports").get();
    for (let i = 0; i < reportsSnap.docs.length; i += 500) {
      const batch = db.batch();
      reportsSnap.docs.slice(i, i + 500).forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      deleted += Math.min(500, reportsSnap.docs.length - i);
    }

    // Delete from reports_archive collection
    const archiveSnap = await db.collection("reports_archive").get();
    for (let i = 0; i < archiveSnap.docs.length; i += 500) {
      const batch = db.batch();
      archiveSnap.docs.slice(i, i + 500).forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }
    const archivedCount = archiveSnap.docs.length;

    // Delete all report locks
    const locksSnap = await db.collection("report_locks").get();
    if (!locksSnap.empty) {
      const batch = db.batch();
      locksSnap.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }

    // Delete report evidence files from Storage
    const storageFilesDeleted = await deleteStorageFolder("report_evidence/");

    await writeAuditLog(db, {
      adminUid: req.admin.uid,
      action: "cleanup_all_reports",
      note: `Deleted ${deleted} reports, ${archivedCount} archived, ${locksSnap.docs.length} locks, ${storageFilesDeleted} storage files`,
    });

    return res.json({
      success: true,
      reports: deleted,
      archived: archivedCount,
      locks: locksSnap.docs.length,
      storageFilesDeleted,
    });
  } catch (err) {
    console.error("Cleanup all reports error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// --- POST /api/cleanup/all-warnings ---
// Reset warning fields on ALL users who have active warnings
app.post("/api/cleanup/all-warnings", async (req, res) => {
  try {
    const db = getFirestore();
    const snap = await db.collection("users")
      .where("warningCount", ">", 0)
      .get();

    let cleared = 0;
    for (let i = 0; i < snap.docs.length; i += 500) {
      const batch = db.batch();
      snap.docs.slice(i, i + 500).forEach(doc => {
        batch.update(doc.ref, {
          warningCount: 0,
          hasActiveWarning: false,
          warningReason: null,
          warningIssuedAt: null,
          goodCharacterScore: 100,
          goodCharacterLastDeductionAt: null,
        });
      });
      await batch.commit();
      cleared += Math.min(500, snap.docs.length - i);
    }

    // Also clear any users with hasActiveWarning but warningCount == 0
    const activeSnap = await db.collection("users")
      .where("hasActiveWarning", "==", true)
      .get();

    let extraCleared = 0;
    for (const doc of activeSnap.docs) {
      await doc.ref.update({
        hasActiveWarning: false,
        warningReason: null,
        warningIssuedAt: null,
      });
      extraCleared++;
    }

    await writeAuditLog(db, {
      adminUid: req.admin.uid,
      action: "cleanup_all_warnings",
      note: `Cleared warnings on ${cleared + extraCleared} users`,
    });

    return res.json({ success: true, cleared: cleared + extraCleared });
  } catch (err) {
    console.error("Cleanup all warnings error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// --- GET /api/storage/audit ---
// Audit all storage folders: file counts and total sizes
app.get("/api/storage/audit", async (req, res) => {
  try {
    const folders = ["pm_images/", "stickers/", "report_evidence/", "profile_photos/", "cover_photos/"];
    const results = {};
    for (const folder of folders) {
      results[folder.replace("/", "")] = await auditStorageFolder(folder);
    }
    return res.json({ success: true, ...results });
  } catch (err) {
    console.error("GET /api/storage/audit error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// --- POST /api/cleanup/orphaned-storage ---
// Smart cross-referencing: delete only files not referenced in Firestore
app.post("/api/cleanup/orphaned-storage", async (req, res) => {
  try {
    const db = getFirestore();
    const referencedPaths = new Set();

    // Hardcoded system asset
    referencedPaths.add("system/shytalk_icon.webp");

    // Users → profilePhotoUrl, coverPhotoUrl, _preSuspension.*
    const usersSnap = await db.collection("users").get();
    for (const doc of usersSnap.docs) {
      const data = doc.data();
      for (const url of [
        data.profilePhotoUrl,
        data.coverPhotoUrl,
        data._preSuspension && data._preSuspension.profilePhotoUrl,
        data._preSuspension && data._preSuspension.coverPhotoUrl,
      ]) {
        const p = extractStoragePath(url);
        if (p) referencedPaths.add(p);
      }
    }

    // Conversations → groupPhotoUrl + messages (IMAGE → imageUrls, STICKER → stickerUrl)
    const convsSnap = await db.collection("conversations").get();
    for (const doc of convsSnap.docs) {
      const data = doc.data();
      const gp = extractStoragePath(data.groupPhotoUrl);
      if (gp) referencedPaths.add(gp);

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
    }

    await writeAuditLog(db, {
      adminUid: req.admin.uid,
      action: "cleanup_orphaned_storage",
      note: `Smart cleanup: ${totalDeleted} orphaned files deleted`,
    });

    return res.json({ success: true, totalDeleted, results });
  } catch (err) {
    console.error("POST /api/cleanup/orphaned-storage error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── Gift Catalog ─────────────────────────────────────────────

// GET /api/gifts — List all gifts in the catalog
app.get("/api/gifts", async (req, res) => {
  try {
    const db = getFirestore();
    const snap = await db.collection("gifts").orderBy("order").get();
    const gifts = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    return res.json({ gifts });
  } catch (err) {
    console.error("GET gifts error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/gifts/seed — Seed the 27-gift catalog (idempotent)
app.post("/api/gifts/seed", async (req, res) => {
  try {
    const db = getFirestore();
    const catalog = [
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

    const batch = db.batch();
    for (const gift of catalog) {
      const docId = gift.name.toLowerCase().replace(/\s+/g, "_");
      const ref = db.collection("gifts").doc(docId);
      batch.set(ref, {
        ...gift,
        animationUrl: "",
        soundUrl: "",
        iconUrl: "",
        showInStore: true,
        showOnWheel: gift.order <= 16,
      }, { merge: true });
    }
    await batch.commit();

    await writeAuditLog(db, {
      adminUid: req.admin.uid,
      action: "seed_gifts",
      note: `Seeded ${catalog.length} gifts`,
    });

    return res.json({ success: true, count: catalog.length });
  } catch (err) {
    console.error("POST gifts/seed error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Economy Admin Endpoints ───────────────────────────────────

// GET /api/users/:uid/economy — Full economy snapshot
app.get("/api/users/:uid/economy", async (req, res) => {
  try {
    const db = getFirestore();
    const userDoc = await db.collection("users").doc(req.params.uid).get();
    if (!userDoc.exists) return res.status(404).json({ error: "User not found" });
    const u = userDoc.data();

    return res.json({
      shyCoins: u.shyCoins || 0,
      shyBeans: u.shyBeans || 0,
      isSuperShy: u.isSuperShy || false,
      superShyExpiry: u.superShyExpiry?.toDate?.()?.toISOString() || null,
      superShyTier: u.superShyTier || null,
      luckScore: u.luckScore || 0,
      pityCounter: u.pityCounter || 0,
      loginStreak: u.loginStreak || 0,
      lastLoginDate: u.lastLoginDate || null,
      lastLoginRewardDate: u.lastLoginRewardDate || null,
    });
  } catch (err) {
    console.error("GET economy error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/users/:uid/backpack — List user's backpack items (enriched with gift catalog info)
app.get("/api/users/:uid/backpack", async (req, res) => {
  try {
    const db = getFirestore();
    const [bpSnap, giftSnap] = await Promise.all([
      db.collection("users").doc(req.params.uid).collection("backpack").get(),
      db.collection("gifts").get(),
    ]);
    const giftMap = {};
    giftSnap.docs.forEach((doc) => { giftMap[doc.id] = doc.data(); });

    const items = bpSnap.docs.map((doc) => {
      const gift = giftMap[doc.id] || {};
      return {
        giftId: doc.id,
        ...doc.data(),
        giftName: gift.name || doc.id,
        coinValue: gift.coinValue || 0,
        lastAcquired: doc.data().lastAcquired?.toDate?.()?.toISOString() || null,
      };
    });
    return res.json({ items });
  } catch (err) {
    console.error("GET backpack error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/users/:uid/backpack — Set gift quantity (0 = remove), with transaction audit
app.post("/api/users/:uid/backpack", async (req, res) => {
  try {
    const { giftId, quantity } = req.body;
    if (!giftId || typeof quantity !== "number") {
      return res.status(400).json({ error: "giftId and quantity required" });
    }

    const db = getFirestore();
    const userRef = db.collection("users").doc(req.params.uid);
    const bpRef = userRef.collection("backpack").doc(giftId);

    // Get current quantity for audit delta
    const bpDoc = await bpRef.get();
    const previousQty = bpDoc.exists ? (bpDoc.data().quantity || 0) : 0;
    const delta = quantity - previousQty;

    const batch = db.batch();

    if (quantity <= 0) {
      batch.delete(bpRef);
    } else {
      batch.set(bpRef, { quantity, lastAcquired: Timestamp.now() }, { merge: true });
    }

    // Write transaction record for audit
    const action = quantity <= 0 ? "removed" : (delta > 0 ? "added" : "set");
    const txRef = userRef.collection("transactions").doc();
    batch.set(txRef, {
      type: "ADMIN_BACKPACK",
      amount: Math.abs(delta),
      currency: "COINS",
      balanceAfter: 0,
      giftId,
      details: `Admin ${action} backpack item ${giftId}: ${previousQty} -> ${Math.max(0, quantity)} (by ShyTalk Official)`,
      timestamp: Timestamp.now(),
    });

    await batch.commit();

    await writeAuditLog(db, {
      adminUid: req.admin.uid,
      action: "edit_backpack",
      targetUserId: req.params.uid,
      note: `${action} ${giftId}: ${previousQty} -> ${Math.max(0, quantity)}`,
    });

    return res.json({ success: true });
  } catch (err) {
    console.error("POST backpack error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/users/:uid/luck — Get luck score + pity counter
app.get("/api/users/:uid/luck", async (req, res) => {
  try {
    const db = getFirestore();
    const userDoc = await db.collection("users").doc(req.params.uid).get();
    if (!userDoc.exists) return res.status(404).json({ error: "User not found" });
    const u = userDoc.data();
    return res.json({
      luckScore: u.luckScore || 0,
      pityCounter: u.pityCounter || 0,
    });
  } catch (err) {
    console.error("GET luck error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/users/:uid/adjust-balance — Add/deduct coins or beans with audit
app.post("/api/users/:uid/adjust-balance", async (req, res) => {
  try {
    const { currency, amount, operation } = req.body;
    if (!["COINS", "BEANS"].includes(currency)) {
      return res.status(400).json({ error: "currency must be COINS or BEANS" });
    }
    if (typeof amount !== "number" || amount <= 0) {
      return res.status(400).json({ error: "amount must be a positive number" });
    }
    if (!["add", "deduct"].includes(operation)) {
      return res.status(400).json({ error: "operation must be add or deduct" });
    }

    const db = getFirestore();
    const userRef = db.collection("users").doc(req.params.uid);
    const userDoc = await userRef.get();
    if (!userDoc.exists) return res.status(404).json({ error: "User not found" });

    const userData = userDoc.data();
    const field = currency === "COINS" ? "shyCoins" : "shyBeans";
    const currentBalance = userData[field] || 0;
    const delta = operation === "deduct" ? -amount : amount;
    const newBalance = Math.max(0, currentBalance + delta);

    const batch = db.batch();

    // Update balance
    batch.update(userRef, { [field]: newBalance });

    // Write transaction record
    const txRef = userRef.collection("transactions").doc();
    batch.set(txRef, {
      type: "ADMIN_ADJUSTMENT",
      amount: delta,
      currency,
      balanceAfter: newBalance,
      details: `Admin ${operation} ${amount} ${currency.toLowerCase()} (by ShyTalk Official)`,
      timestamp: Timestamp.now(),
    });

    await batch.commit();

    await writeAuditLog(db, {
      adminUid: req.admin.uid,
      action: "adjust_balance",
      targetUserId: req.params.uid,
      note: `${operation} ${amount} ${currency.toLowerCase()} (${currentBalance} -> ${newBalance})`,
    });

    return res.json({ success: true, newBalance });
  } catch (err) {
    console.error("POST adjust-balance error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/users/:uid/luck — Update luck score / pity counter
app.post("/api/users/:uid/luck", async (req, res) => {
  try {
    const { luckScore, pityCounter } = req.body;
    const updates = {};

    if (typeof luckScore === "number") {
      if (luckScore < 0 || luckScore > 100) {
        return res.status(400).json({ error: "luckScore must be 0-100" });
      }
      updates.luckScore = luckScore;
    }
    if (typeof pityCounter === "number") {
      if (pityCounter < 0 || pityCounter > 80) {
        return res.status(400).json({ error: "pityCounter must be 0-80" });
      }
      updates.pityCounter = pityCounter;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "Provide luckScore and/or pityCounter" });
    }

    const db = getFirestore();
    const userRef = db.collection("users").doc(req.params.uid);
    const userDoc = await userRef.get();
    if (!userDoc.exists) return res.status(404).json({ error: "User not found" });

    await userRef.update(updates);

    await writeAuditLog(db, {
      adminUid: req.admin.uid,
      action: "edit_luck",
      targetUserId: req.params.uid,
      note: JSON.stringify(updates),
    });

    return res.json({ success: true, ...updates });
  } catch (err) {
    console.error("POST luck error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/users/:uid/transactions — Paginated transaction audit
app.get("/api/users/:uid/transactions", async (req, res) => {
  try {
    const db = getFirestore();
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const typeFilter = req.query.type || null;

    let query = db.collection("users").doc(req.params.uid)
      .collection("transactions")
      .orderBy("timestamp", "desc")
      .limit(limit);

    if (typeFilter) {
      query = db.collection("users").doc(req.params.uid)
        .collection("transactions")
        .where("type", "==", typeFilter)
        .orderBy("timestamp", "desc")
        .limit(limit);
    }

    const snap = await query.get();
    const transactions = snap.docs.map((doc) => {
      const data = doc.data();
      if (data.timestamp && typeof data.timestamp.toDate === "function") {
        data.timestamp = data.timestamp.toDate().toISOString();
      }
      return { id: doc.id, ...data };
    });

    return res.json({ transactions });
  } catch (err) {
    console.error("GET transactions error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Bulk Cleanup Endpoints ───────────────────────────────────

// POST /api/cleanup/all-backpacks
app.post("/api/cleanup/all-backpacks", async (req, res) => {
  try {
    const db = getFirestore();
    const usersSnap = await db.collection("users").select().get();
    let usersCleared = 0;
    let itemsDeleted = 0;

    for (const userDoc of usersSnap.docs) {
      const bpSnap = await userDoc.ref.collection("backpack").get();
      if (bpSnap.empty) continue;

      for (let i = 0; i < bpSnap.docs.length; i += 500) {
        const batch = db.batch();
        bpSnap.docs.slice(i, i + 500).forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
      }
      itemsDeleted += bpSnap.docs.length;
      usersCleared++;
    }

    await writeAuditLog(db, {
      adminUid: req.admin.uid,
      action: "cleanup_all_backpacks",
      note: `Cleared ${usersCleared} users, ${itemsDeleted} items`,
    });

    return res.json({ success: true, usersCleared, itemsDeleted });
  } catch (err) {
    console.error("POST cleanup/all-backpacks error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/cleanup/all-giftwalls
app.post("/api/cleanup/all-giftwalls", async (req, res) => {
  try {
    const db = getFirestore();
    const usersSnap = await db.collection("users").select().get();
    let usersCleared = 0;
    let itemsDeleted = 0;

    for (const userDoc of usersSnap.docs) {
      const gwSnap = await userDoc.ref.collection("giftWall").get();
      if (gwSnap.empty) continue;

      for (let i = 0; i < gwSnap.docs.length; i += 500) {
        const batch = db.batch();
        gwSnap.docs.slice(i, i + 500).forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
      }
      itemsDeleted += gwSnap.docs.length;
      usersCleared++;
    }

    await writeAuditLog(db, {
      adminUid: req.admin.uid,
      action: "cleanup_all_giftwalls",
      note: `Cleared ${usersCleared} users, ${itemsDeleted} items`,
    });

    return res.json({ success: true, usersCleared, itemsDeleted });
  } catch (err) {
    console.error("POST cleanup/all-giftwalls error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/cleanup/all-coins
app.post("/api/cleanup/all-coins", async (req, res) => {
  try {
    const db = getFirestore();
    const snap = await db.collection("users").where("shyCoins", ">", 0).get();
    let usersCleared = 0;

    for (let i = 0; i < snap.docs.length; i += 500) {
      const batch = db.batch();
      snap.docs.slice(i, i + 500).forEach((doc) => {
        batch.update(doc.ref, { shyCoins: 0 });
      });
      await batch.commit();
      usersCleared += Math.min(500, snap.docs.length - i);
    }

    await writeAuditLog(db, {
      adminUid: req.admin.uid,
      action: "cleanup_all_coins",
      note: `Reset coins for ${usersCleared} users`,
    });

    return res.json({ success: true, usersCleared });
  } catch (err) {
    console.error("POST cleanup/all-coins error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/cleanup/all-beans
app.post("/api/cleanup/all-beans", async (req, res) => {
  try {
    const db = getFirestore();
    const snap = await db.collection("users").where("shyBeans", ">", 0).get();
    let usersCleared = 0;

    for (let i = 0; i < snap.docs.length; i += 500) {
      const batch = db.batch();
      snap.docs.slice(i, i + 500).forEach((doc) => {
        batch.update(doc.ref, { shyBeans: 0 });
      });
      await batch.commit();
      usersCleared += Math.min(500, snap.docs.length - i);
    }

    await writeAuditLog(db, {
      adminUid: req.admin.uid,
      action: "cleanup_all_beans",
      note: `Reset beans for ${usersCleared} users`,
    });

    return res.json({ success: true, usersCleared });
  } catch (err) {
    console.error("POST cleanup/all-beans error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/cleanup/all-spin-history
app.post("/api/cleanup/all-spin-history", async (req, res) => {
  try {
    const db = getFirestore();
    const usersSnap = await db.collection("users").select().get();
    let usersCleared = 0;
    let txDeleted = 0;
    let pityReset = 0;

    for (const userDoc of usersSnap.docs) {
      // Delete GACHA_PULL transactions
      const txSnap = await userDoc.ref.collection("transactions")
        .where("type", "==", "GACHA_PULL").get();
      if (!txSnap.empty) {
        for (let i = 0; i < txSnap.docs.length; i += 500) {
          const batch = db.batch();
          txSnap.docs.slice(i, i + 500).forEach((doc) => batch.delete(doc.ref));
          await batch.commit();
        }
        txDeleted += txSnap.docs.length;
        usersCleared++;
      }

      // Reset pity counter
      const userData = (await userDoc.ref.get()).data();
      if (userData && userData.pityCounter > 0) {
        await userDoc.ref.update({ pityCounter: 0 });
        pityReset++;
      }
    }

    await writeAuditLog(db, {
      adminUid: req.admin.uid,
      action: "cleanup_all_spin_history",
      note: `Cleared ${usersCleared} users, ${txDeleted} transactions, reset ${pityReset} pity counters`,
    });

    return res.json({ success: true, usersCleared, txDeleted, pityReset });
  } catch (err) {
    console.error("POST cleanup/all-spin-history error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/cleanup/all-supershy
app.post("/api/cleanup/all-supershy", async (req, res) => {
  try {
    const db = getFirestore();
    const snap = await db.collection("users").where("isSuperShy", "==", true).get();
    let usersCleared = 0;

    for (let i = 0; i < snap.docs.length; i += 500) {
      const batch = db.batch();
      snap.docs.slice(i, i + 500).forEach((doc) => {
        batch.update(doc.ref, {
          isSuperShy: false,
          superShyExpiry: null,
          superShyTier: null,
        });
      });
      await batch.commit();
      usersCleared += Math.min(500, snap.docs.length - i);
    }

    await writeAuditLog(db, {
      adminUid: req.admin.uid,
      action: "cleanup_all_supershy",
      note: `Removed Super Shy from ${usersCleared} users`,
    });

    return res.json({ success: true, usersCleared });
  } catch (err) {
    console.error("POST cleanup/all-supershy error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── Economy Config Endpoints ─────────────────────────────────

const ECONOMY_CONFIG_FIELDS = {
  beanConversionRate: "number",
  beanRedeemBonusThreshold: "number",
  beanRedeemBonusMultiplier: "number",
  pullCosts: "object",
  broadcastSendThreshold: "number",
  broadcastWinThreshold: "number",
  dropRateExponent: "number",
  pitySoftStart: "number",
  pityHardLimit: "number",
  pitySoftMaxShift: "number",
  pityHighValueThreshold: "number",
  dailyBase: "number",
  milestoneRewards: "object",
  maxRoomDurationMinutes: "number",
  superShyRoomDurationMinutes: "number",
  normalSeatCount: "number",
};

// GET /api/config/economy
app.get("/api/config/economy", async (req, res) => {
  try {
    const db = getFirestore();
    const doc = await db.collection("config").doc("economy").get();
    if (!doc.exists) {
      return res.json({ config: {} });
    }
    return res.json({ config: doc.data() });
  } catch (err) {
    console.error("GET config/economy error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /api/config/economy
app.put("/api/config/economy", async (req, res) => {
  try {
    const updates = req.body;
    if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
      return res.status(400).json({ error: "Body must be a JSON object" });
    }

    const errors = [];
    const validated = {};

    for (const [key, value] of Object.entries(updates)) {
      const expectedType = ECONOMY_CONFIG_FIELDS[key];
      if (!expectedType) {
        errors.push(`Unknown field: ${key}`);
        continue;
      }
      if (expectedType === "number") {
        if (typeof value !== "number" || !Number.isFinite(value)) {
          errors.push(`${key} must be a finite number`);
          continue;
        }
        if (value < 0) {
          errors.push(`${key} must be non-negative`);
          continue;
        }
      } else if (expectedType === "object") {
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
          errors.push(`${key} must be an object`);
          continue;
        }
        // Validate that all values are numbers
        for (const [k, v] of Object.entries(value)) {
          if (typeof v !== "number" || !Number.isFinite(v)) {
            errors.push(`${key}.${k} must be a finite number`);
          }
        }
      }
      validated[key] = value;
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join("; ") });
    }

    if (Object.keys(validated).length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    const db = getFirestore();
    await db.collection("config").doc("economy").set(validated, { merge: true });

    await writeAuditLog(db, {
      adminUid: req.admin.uid,
      action: "update_economy_config",
      note: `Updated: ${Object.keys(validated).join(", ")}`,
    });

    return res.json({ success: true, updatedFields: Object.keys(validated) });
  } catch (err) {
    console.error("PUT config/economy error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Gift CRUD ────────────────────────────────────────────────

// PUT /api/gifts/:id — Update an existing gift
app.put("/api/gifts/:id", async (req, res) => {
  try {
    const db = getFirestore();
    const giftId = req.params.id;
    const ref = db.collection("gifts").doc(giftId);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: "Gift not found" });

    const allowed = ["name", "coinValue", "animationUrl", "soundUrl", "iconUrl", "order", "showInStore", "showOnWheel"];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        if (key === "coinValue" || key === "order") {
          const v = Number(req.body[key]);
          if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: `${key} must be a non-negative number` });
          updates[key] = v;
        } else if (key === "showInStore" || key === "showOnWheel") {
          updates[key] = !!req.body[key];
        } else {
          updates[key] = String(req.body[key]);
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    await ref.update(updates);

    await writeAuditLog(db, {
      adminUid: req.admin.uid,
      action: "update_gift",
      targetId: giftId,
      note: `Updated gift ${giftId}: ${Object.keys(updates).join(", ")}`,
    });

    return res.json({ success: true, updatedFields: Object.keys(updates) });
  } catch (err) {
    console.error("PUT gift error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/gifts — Create a new gift
app.post("/api/gifts", async (req, res) => {
  try {
    const db = getFirestore();
    const { name, coinValue, animationUrl, soundUrl, iconUrl, order } = req.body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "name is required" });
    }
    if (coinValue === undefined || !Number.isFinite(Number(coinValue)) || Number(coinValue) < 0) {
      return res.status(400).json({ error: "coinValue must be a non-negative number" });
    }

    const docId = name.trim().toLowerCase().replace(/\s+/g, "_");
    const existing = await db.collection("gifts").doc(docId).get();
    if (existing.exists) {
      return res.status(409).json({ error: `Gift with ID "${docId}" already exists` });
    }

    const giftData = {
      name: name.trim(),
      coinValue: Number(coinValue),
      animationUrl: animationUrl || "",
      soundUrl: soundUrl || "",
      iconUrl: iconUrl || "",
      order: Number(order) || 0,
      showInStore: true,
    };

    await db.collection("gifts").doc(docId).set(giftData);

    await writeAuditLog(db, {
      adminUid: req.admin.uid,
      action: "create_gift",
      targetId: docId,
      note: `Created gift: ${name} (${coinValue} coins)`,
    });

    return res.json({ success: true, id: docId, gift: giftData });
  } catch (err) {
    console.error("POST gift error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/gifts/:id — Delete a gift from catalog
app.delete("/api/gifts/:id", async (req, res) => {
  try {
    const db = getFirestore();
    const giftId = req.params.id;
    const ref = db.collection("gifts").doc(giftId);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: "Gift not found" });

    const giftData = doc.data();
    await ref.delete();

    await writeAuditLog(db, {
      adminUid: req.admin.uid,
      action: "delete_gift",
      targetId: giftId,
      note: `Deleted gift: ${giftData.name || giftId}`,
    });

    return res.json({ success: true });
  } catch (err) {
    console.error("DELETE gift error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// --- POST /api/users/:uid/guarantee-next-pull ---
// Set a guaranteed gift for the user's next gacha pull
app.post("/api/users/:uid/guarantee-next-pull", async (req, res) => {
  try {
    const { giftId } = req.body;
    const uid = req.params.uid;

    if (!giftId || typeof giftId !== "string") {
      return res.status(400).json({ error: "giftId is required" });
    }

    const db = getFirestore();

    // Validate gift exists
    const giftDoc = await db.collection("gifts").doc(giftId).get();
    if (!giftDoc.exists) {
      return res.status(404).json({ error: "Gift not found in catalog" });
    }

    // Validate user exists
    const userDoc = await db.collection("users").doc(uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    const giftData = giftDoc.data();

    await db.collection("users").doc(uid).update({
      guaranteedNextPull: {
        giftId,
        setBy: req.admin.uid,
        setAt: Timestamp.now(),
      },
    });

    await writeAuditLog(db, {
      adminUid: req.admin.uid,
      action: "guarantee_next_pull",
      targetUserId: uid,
      note: `Guaranteed next pull: ${giftData.name} (${giftId}, ${giftData.coinValue} coins)`,
    });

    return res.json({
      success: true,
      giftId,
      giftName: giftData.name,
      coinValue: giftData.coinValue,
    });
  } catch (err) {
    console.error("POST /api/users/:uid/guarantee-next-pull error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// --- DELETE /api/users/:uid/guarantee-next-pull ---
// Revoke a pending guaranteed pull before it's used
app.delete("/api/users/:uid/guarantee-next-pull", async (req, res) => {
  try {
    const uid = req.params.uid;
    const db = getFirestore();

    const userDoc = await db.collection("users").doc(uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    await db.collection("users").doc(uid).update({
      guaranteedNextPull: FieldValue.delete(),
    });

    await writeAuditLog(db, {
      adminUid: req.admin.uid,
      action: "revoke_guarantee_next_pull",
      targetUserId: uid,
    });

    return res.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/users/:uid/guarantee-next-pull error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// --- GET /api/users/:uid/guarantee-next-pull ---
// Check current guarantee status for a user
app.get("/api/users/:uid/guarantee-next-pull", async (req, res) => {
  try {
    const uid = req.params.uid;
    const db = getFirestore();

    const userDoc = await db.collection("users").doc(uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    const userData = userDoc.data();
    const guarantee = userData.guaranteedNextPull || null;

    if (!guarantee) {
      return res.json({ active: false });
    }

    // Enrich with gift info
    const giftDoc = await db.collection("gifts").doc(guarantee.giftId).get();
    const giftData = giftDoc.exists ? giftDoc.data() : null;

    return res.json({
      active: true,
      giftId: guarantee.giftId,
      giftName: giftData ? giftData.name : "Unknown",
      coinValue: giftData ? giftData.coinValue : 0,
      setBy: guarantee.setBy || null,
      setAt: guarantee.setAt && typeof guarantee.setAt.toDate === "function"
        ? guarantee.setAt.toDate().toISOString()
        : guarantee.setAt || null,
    });
  } catch (err) {
    console.error("GET /api/users/:uid/guarantee-next-pull error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = app;
