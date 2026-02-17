const express = require("express");
const cors = require("cors");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, Timestamp, FieldValue } = require("firebase-admin/firestore");

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
    const status = req.query.status || "pending";
    if (!["pending", "approved", "rejected"].includes(status)) {
      return res.status(400).json({ error: "status must be pending, approved, or rejected" });
    }

    // Single-field query avoids composite index requirement
    const snapshot = await getFirestore().collection("suspensionAppeals")
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

module.exports = app;
