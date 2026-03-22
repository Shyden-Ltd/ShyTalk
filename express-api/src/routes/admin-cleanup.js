/**
 * Admin cleanup routes — data reset, storage audit, orphan cleanup.
 *
 * All endpoints require admin. They operate on Firestore collections and R2 directly.
 *
 * POST /api/cleanup/system-conversations       → Delete duplicate system conversations
 * POST /api/cleanup/all-system-conversations    → Delete ALL system conversations
 * POST /api/cleanup/all-reports                 → Delete all reports + locks
 * POST /api/cleanup/all-warnings               → Reset warnings on all users
 * POST /api/cleanup/all-backpacks              → Clear all backpack items
 * POST /api/cleanup/all-giftwalls              → Clear all gift walls
 * POST /api/cleanup/all-coins                  → Reset all coin balances
 * POST /api/cleanup/all-beans                  → Reset all bean balances
 * POST /api/cleanup/all-spin-history           → Delete gacha transactions + reset pity
 * POST /api/cleanup/all-transactions          → Delete ALL transaction records
 * POST /api/cleanup/all-supershy               → Clear Super Shy status
 * POST /api/cleanup/all-appeals                → Delete all suspension appeals
 * POST /api/cleanup/backfill-user-type          → Set userType=MEMBER for users missing it
 * POST /api/cleanup/all-private-messages       → Delete all 1-on-1 PMs + R2 media
 * POST /api/cleanup/all-group-chats            → Delete all group chats + R2 media
 * POST /api/cleanup/all-rooms                  → Delete all closed rooms + subcollections
 * POST /api/cleanup/all-broadcasts             → Delete all broadcast records
 * POST /api/cleanup/all-audit-logs             → Delete all admin audit logs
 * POST /api/cleanup/destroyed-users            → Delete corrupted user profiles
 * POST /api/cleanup/all-device-bindings        → Delete all device bindings
 * POST /api/cleanup/device-binding/:uniqueId   → Delete device binding for a user
 * GET  /api/storage/audit                      → R2 folder audit
 * POST /api/cleanup/orphaned-storage           → Smart R2 cleanup
 * POST /api/cleanup/all-stalkers              → Delete all stalker records + reset counts
 */

const router = require('express').Router();
const { db } = require('../utils/firebase');
const { requireAdmin } = require('../middleware/auth');
const r2 = require('../utils/r2');
const { queryDocs } = require('../utils/firestore-helpers');
const log = require('../utils/log');

const listObjectsWithMeta = r2.listObjectsWithMetadata;

/**
 * Delete a conversation and all its associated subcollection data from Firestore.
 */
async function deleteConversation(convId) {
  const [messages, userSettings, mutes] = await Promise.all([
    queryDocs(db.collection(`conversations/${convId}/messages`)),
    queryDocs(db.collection(`conversations/${convId}/userSettings`)),
    queryDocs(db.collection(`conversations/${convId}/mutes`)),
  ]);

  const allDocs = [
    ...messages.map((m) => `conversations/${convId}/messages/${m.id}`),
    ...userSettings.map((s) => `conversations/${convId}/userSettings/${s.id}`),
    ...mutes.map((m) => `conversations/${convId}/mutes/${m.id}`),
    `conversations/${convId}`,
  ];

  for (let i = 0; i < allDocs.length; i += 500) {
    const batch = db.batch();
    for (const path of allDocs.slice(i, i + 500)) {
      batch.delete(db.doc(path));
    }
    await batch.commit();
  }
}

/**
 * Delete a room and all its associated subcollection data from Firestore.
 */
async function deleteRoom(roomId) {
  const [messages, seatRequests] = await Promise.all([
    queryDocs(db.collection(`rooms/${roomId}/messages`)),
    queryDocs(db.collection(`rooms/${roomId}/seatRequests`)),
  ]);

  const allDocs = [
    ...messages.map((m) => `rooms/${roomId}/messages/${m.id}`),
    ...seatRequests.map((s) => `rooms/${roomId}/seatRequests/${s.id}`),
    `rooms/${roomId}`,
  ];

  for (let i = 0; i < allDocs.length; i += 500) {
    const batch = db.batch();
    for (const path of allDocs.slice(i, i + 500)) {
      batch.delete(db.doc(path));
    }
    await batch.commit();
  }

  // Clean up RTDB presence and events for this room
  try {
    const { rtdb } = require('../utils/firebase');
    await rtdb.ref(`rooms/${roomId}`).remove();
  } catch (err) {
    log.error('admin-cleanup', 'Failed to clear RTDB for room', { roomId, error: err.message });
  }
}

/**
 * Delete all R2 objects under a prefix.
 */
async function deleteR2Prefix(prefix) {
  const keys = await r2.listObjects(prefix);
  if (keys.length > 0) {
    await r2.deleteObjects(keys);
  }
}

// ══════════════════════════════════════════════════════════════
// CLEANUP ROUTES
// ══════════════════════════════════════════════════════════════

// ── Delete duplicate system conversations ──
router.post('/cleanup/system-conversations', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    log.info('admin-cleanup', 'Deleting duplicate system conversations', {
      adminId: req.auth.uniqueId,
    });

    const snap = await db
      .collection('conversations')
      .where('participantIds', 'array-contains', 'SHYTALK_SYSTEM')
      .get();
    const systemConvs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    let deleted = 0;
    const seen = new Map(); // recipientUid → first conversation id

    for (const conv of systemConvs) {
      const participantIds = conv.participantIds || [];
      const otherUid = participantIds.find((id) => id !== 'SHYTALK_SYSTEM');
      if (!otherUid) continue;

      const expectedId = [otherUid, 'SHYTALK_SYSTEM'].sort().join('_');

      if (conv.id === expectedId) {
        seen.set(otherUid, conv.id);
        continue;
      }

      // This is a duplicate — delete it
      if (seen.has(otherUid)) {
        await deleteConversation(conv.id);
        deleted++;
      } else {
        seen.set(otherUid, conv.id);
      }
    }

    res.json({ success: true, deleted });
  } catch (err) {
    log.error('admin-cleanup', 'Cleanup system conversations failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Delete ALL system conversations ──
router.post('/cleanup/all-system-conversations', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    log.info('admin-cleanup', 'Deleting all system conversations', { adminId: req.auth.uniqueId });

    const snap = await db
      .collection('conversations')
      .where('participantIds', 'array-contains', 'SHYTALK_SYSTEM')
      .get();
    const systemConvs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    for (const conv of systemConvs) {
      await deleteConversation(conv.id);
    }

    res.json({ success: true, deleted: systemConvs.length });
  } catch (err) {
    log.error('admin-cleanup', 'Cleanup all system conversations failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Delete all reports ──
router.post('/cleanup/all-reports', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    log.info('admin-cleanup', 'Deleting all reports', { adminId: req.auth.uniqueId });

    // Delete R2 evidence files first
    await deleteR2Prefix('evidence/');

    // Delete all docs from reports, reportsArchive, reportLocks collections
    const [reports, reportsArchive, reportLocks] = await Promise.all([
      queryDocs(db.collection('reports')),
      queryDocs(db.collection('reportsArchive')),
      queryDocs(db.collection('reportLocks')),
    ]);

    const allDocs = [
      ...reports.map((d) => `reports/${d.id}`),
      ...reportsArchive.map((d) => `reportsArchive/${d.id}`),
      ...reportLocks.map((d) => `reportLocks/${d.id}`),
    ];

    for (let i = 0; i < allDocs.length; i += 500) {
      const batch = db.batch();
      for (const path of allDocs.slice(i, i + 500)) {
        batch.delete(db.doc(path));
      }
      await batch.commit();
    }

    res.json({ success: true });
  } catch (err) {
    log.error('admin-cleanup', 'Cleanup all reports failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Reset all warnings ──
router.post('/cleanup/all-warnings', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    log.info('admin-cleanup', 'Resetting all warnings', { adminId: req.auth.uniqueId });

    const [usersSnap, activeSnap] = await Promise.all([
      db.collection('users').where('warningCount', '>', 0).get(),
      db.collection('users').where('hasActiveWarning', '==', true).get(),
    ]);

    const allIds = new Set([
      ...usersSnap.docs.map((d) => d.id),
      ...activeSnap.docs.map((d) => d.id),
    ]);

    const uids = Array.from(allIds);
    for (let i = 0; i < uids.length; i += 500) {
      const batch = db.batch();
      for (const uid of uids.slice(i, i + 500)) {
        batch.update(db.doc(`users/${uid}`), {
          gcsScore: 100,
          gcsLastDeductionAt: null,
          warningCount: 0,
          hasActiveWarning: false,
          hasNewWarning: false,
          warningReason: null,
          warningIssuedAt: null,
        });
      }
      await batch.commit();
    }

    res.json({ success: true, affected: allIds.size });
  } catch (err) {
    log.error('admin-cleanup', 'Cleanup all warnings failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Clear all backpacks ──
router.post('/cleanup/all-backpacks', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    log.info('admin-cleanup', 'Clearing all backpacks', { adminId: req.auth.uniqueId });

    const usersSnap = await db.collection('users').orderBy('uid').get();
    const users = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    let deleted = 0;
    for (const user of users) {
      const uid = user.uid ?? user.id;
      const itemsSnap = await db.collection(`users/${uid}/backpack`).get();
      if (itemsSnap.empty) continue;

      const items = itemsSnap.docs;
      for (let i = 0; i < items.length; i += 500) {
        const batch = db.batch();
        for (const item of items.slice(i, i + 500)) {
          batch.delete(item.ref);
        }
        await batch.commit();
      }
      deleted += items.length;
    }

    res.json({ success: true, deleted });
  } catch (err) {
    log.error('admin-cleanup', 'Cleanup all backpacks failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Clear all gift walls ──
router.post('/cleanup/all-giftwalls', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    log.info('admin-cleanup', 'Clearing all gift walls', { adminId: req.auth.uniqueId });

    const usersSnap = await db.collection('users').orderBy('uid').get();
    const users = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    let deleted = 0;
    for (const user of users) {
      const uid = user.uid ?? user.id;
      const giftsSnap = await db.collection(`users/${uid}/giftWall`).get();
      if (giftsSnap.empty) continue;

      const gifts = giftsSnap.docs;
      for (let i = 0; i < gifts.length; i += 500) {
        const batch = db.batch();
        for (const gift of gifts.slice(i, i + 500)) {
          batch.delete(gift.ref);
        }
        await batch.commit();
      }
      deleted += gifts.length;
    }

    res.json({ success: true, deleted });
  } catch (err) {
    log.error('admin-cleanup', 'Cleanup all gift walls failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Reset all coins ──
router.post('/cleanup/all-coins', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    log.info('admin-cleanup', 'Resetting all coin balances', { adminId: req.auth.uniqueId });

    const snap = await db.collection('users').where('shyCoins', '>', 0).get();
    const docs = snap.docs;

    for (let i = 0; i < docs.length; i += 500) {
      const batch = db.batch();
      for (const doc of docs.slice(i, i + 500)) {
        batch.update(doc.ref, { shyCoins: 0 });
      }
      await batch.commit();
    }

    res.json({ success: true, affected: docs.length });
  } catch (err) {
    log.error('admin-cleanup', 'Cleanup all coins failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Reset all beans ──
router.post('/cleanup/all-beans', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    log.info('admin-cleanup', 'Resetting all bean balances', { adminId: req.auth.uniqueId });

    const snap = await db.collection('users').where('shyBeans', '>', 0).get();
    const docs = snap.docs;

    for (let i = 0; i < docs.length; i += 500) {
      const batch = db.batch();
      for (const doc of docs.slice(i, i + 500)) {
        batch.update(doc.ref, { shyBeans: 0 });
      }
      await batch.commit();
    }

    res.json({ success: true, affected: docs.length });
  } catch (err) {
    log.error('admin-cleanup', 'Cleanup all beans failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Delete gacha spin history + reset pity ──
router.post('/cleanup/all-spin-history', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    log.info('admin-cleanup', 'Deleting all spin history', { adminId: req.auth.uniqueId });

    // Clear pity counters on all users who have one
    const pitySnap = await db.collection('users').where('pityCounter', '>', 0).get();
    const pityDocs = pitySnap.docs;

    for (let i = 0; i < pityDocs.length; i += 500) {
      const batch = db.batch();
      for (const doc of pityDocs.slice(i, i + 500)) {
        batch.update(doc.ref, { pityCounter: 0 });
      }
      await batch.commit();
    }

    // Delete GACHA_PULL transactions from every user's transactions subcollection
    const usersSnap = await db.collection('users').orderBy('uid').get();
    const users = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    let txDeleted = 0;
    for (const user of users) {
      const uid = user.uid ?? user.id;
      const txSnap = await db
        .collection(`users/${uid}/transactions`)
        .where('type', '==', 'GACHA_PULL')
        .get();
      if (txSnap.empty) continue;

      const txDocs = txSnap.docs;
      for (let i = 0; i < txDocs.length; i += 500) {
        const batch = db.batch();
        for (const doc of txDocs.slice(i, i + 500)) {
          batch.delete(doc.ref);
        }
        await batch.commit();
      }
      txDeleted += txDocs.length;
    }

    res.json({ success: true, pityReset: pityDocs.length, txDeleted });
  } catch (err) {
    log.error('admin-cleanup', 'Cleanup all spin history failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Clear Super Shy status ──
router.post('/cleanup/all-supershy', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    log.info('admin-cleanup', 'Clearing all Super Shy status', { adminId: req.auth.uniqueId });

    const snap = await db.collection('users').where('isSuperShy', '==', true).get();
    const docs = snap.docs;

    for (let i = 0; i < docs.length; i += 500) {
      const batch = db.batch();
      for (const doc of docs.slice(i, i + 500)) {
        batch.update(doc.ref, {
          isSuperShy: false,
          superShyExpiry: null,
          superShyTier: null,
          hasClaimedSuperShyTrial: false,
        });
      }
      await batch.commit();
    }

    res.json({ success: true, affected: docs.length });
  } catch (err) {
    log.error('admin-cleanup', 'Cleanup all Super Shy failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Clear all transactions (all types) ──
router.post('/cleanup/all-transactions', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    log.info('admin-cleanup', 'Deleting all transactions', { adminId: req.auth.uniqueId });

    const usersSnap = await db.collection('users').orderBy('uid').get();
    const users = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    let deleted = 0;
    for (const user of users) {
      const uid = user.uid ?? user.id;
      const txSnap = await db.collection(`users/${uid}/transactions`).get();
      if (txSnap.empty) continue;

      const txDocs = txSnap.docs;
      for (let i = 0; i < txDocs.length; i += 500) {
        const batch = db.batch();
        for (const doc of txDocs.slice(i, i + 500)) {
          batch.delete(doc.ref);
        }
        await batch.commit();
      }
      deleted += txDocs.length;
    }

    res.json({ success: true, deleted, usersProcessed: users.length });
  } catch (err) {
    log.error('admin-cleanup', 'Cleanup all transactions failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Delete all suspension appeals ──
router.post('/cleanup/all-appeals', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    log.info('admin-cleanup', 'Deleting all suspension appeals', { adminId: req.auth.uniqueId });

    const snap = await db.collection('suspensionAppeals').get();
    const docs = snap.docs;

    for (let i = 0; i < docs.length; i += 500) {
      const batch = db.batch();
      for (const doc of docs.slice(i, i + 500)) {
        batch.delete(doc.ref);
      }
      await batch.commit();
    }

    res.json({ success: true, deleted: docs.length });
  } catch (err) {
    log.error('admin-cleanup', 'Cleanup all appeals failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Backfill userType for users missing it ──
router.post('/cleanup/backfill-user-type', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    log.info('admin-cleanup', 'Backfilling userType', { adminId: req.auth.uniqueId });

    const snap = await db.collection('users').limit(5000).get();
    const users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const missing = users.filter((u) => !u.userType && !u.user_type);

    if (missing.length === 0) {
      return res.json({ success: true, updated: 0, message: 'All users already have a userType' });
    }

    for (let i = 0; i < missing.length; i += 500) {
      const batch = db.batch();
      for (const u of missing.slice(i, i + 500)) {
        batch.update(db.doc(`users/${u.uid ?? u.id}`), { userType: 'MEMBER' });
      }
      await batch.commit();
    }

    res.json({ success: true, updated: missing.length });
  } catch (err) {
    log.error('admin-cleanup', 'Backfill userType failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Delete all private messages (1-on-1 conversations) + R2 media ──
router.post('/cleanup/all-private-messages', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    log.info('admin-cleanup', 'Deleting all private messages', { adminId: req.auth.uniqueId });

    const snap = await db.collection('conversations').limit(5000).get();
    const allConvs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const pms = allConvs.filter((c) => !c.isGroup);

    if (pms.length === 0) {
      return res.json({
        success: true,
        deleted: 0,
        mediaDeleted: 0,
        message: 'No private messages found',
      });
    }

    const CDN_PREFIX = r2.CDN_URL + '/';
    let mediaDeleted = 0;

    for (const conv of pms) {
      const msgsSnap = await db.collection(`conversations/${conv.id}/messages`).get();
      for (const doc of msgsSnap.docs) {
        const msg = doc.data();
        const urls = msg.imageUrls || [];
        for (const url of urls) {
          if (url && url.startsWith(CDN_PREFIX)) {
            try {
              await r2.deleteObject(url.slice(CDN_PREFIX.length));
              mediaDeleted++;
            } catch (err) {
              log.warn('admin-cleanup', 'R2 delete failed', {
                key: url.slice(CDN_PREFIX.length),
                error: err.message,
              });
            }
          }
        }
      }
      await deleteConversation(conv.id);
    }

    res.json({ success: true, deleted: pms.length, mediaDeleted });
  } catch (err) {
    log.error('admin-cleanup', 'Cleanup all private messages failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Delete all group chats + R2 media ──
router.post('/cleanup/all-group-chats', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    log.info('admin-cleanup', 'Deleting all group chats', { adminId: req.auth.uniqueId });

    const snap = await db
      .collection('conversations')
      .where('isGroup', '==', true)
      .limit(5000)
      .get();
    const allConvs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    if (allConvs.length === 0) {
      return res.json({
        success: true,
        deleted: 0,
        mediaDeleted: 0,
        message: 'No group chats found',
      });
    }

    const CDN_PREFIX = r2.CDN_URL + '/';
    let mediaDeleted = 0;

    for (const conv of allConvs) {
      // Delete group photo from R2
      const photoUrl = conv.groupPhotoUrl || conv.group_photo_url;
      if (photoUrl && photoUrl.startsWith(CDN_PREFIX)) {
        try {
          await r2.deleteObject(photoUrl.slice(CDN_PREFIX.length));
          mediaDeleted++;
        } catch (err) {
          log.warn('admin-cleanup', 'R2 delete failed', {
            key: photoUrl.slice(CDN_PREFIX.length),
            error: err.message,
          });
        }
      }
      // Delete message images
      const msgsSnap = await db.collection(`conversations/${conv.id}/messages`).get();
      for (const doc of msgsSnap.docs) {
        const msg = doc.data();
        const urls = msg.imageUrls || [];
        for (const url of urls) {
          if (url && url.startsWith(CDN_PREFIX)) {
            try {
              await r2.deleteObject(url.slice(CDN_PREFIX.length));
              mediaDeleted++;
            } catch (err) {
              log.warn('admin-cleanup', 'R2 delete failed', {
                key: url.slice(CDN_PREFIX.length),
                error: err.message,
              });
            }
          }
        }
      }
      await deleteConversation(conv.id);
    }

    res.json({ success: true, deleted: allConvs.length, mediaDeleted });
  } catch (err) {
    log.error('admin-cleanup', 'Cleanup all group chats failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Delete all closed rooms + subcollections ──
router.post('/cleanup/all-rooms', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    log.info('admin-cleanup', 'Deleting all closed rooms', { adminId: req.auth.uniqueId });

    const snap = await db.collection('rooms').where('state', '==', 'CLOSED').limit(200).get();
    const closedRooms = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    if (closedRooms.length === 0) {
      return res.json({ success: true, deleted: 0, message: 'No closed rooms found' });
    }

    let deleted = 0;
    for (let i = 0; i < closedRooms.length; i += 20) {
      const batch = closedRooms.slice(i, i + 20);
      for (const room of batch) {
        try {
          await deleteRoom(room.id);
          deleted++;
        } catch (err) {
          log.warn('admin-cleanup', 'Room delete failed', { roomId: room.id, error: err.message });
        }
      }
    }

    res.json({ success: true, deleted, total: closedRooms.length });
  } catch (err) {
    log.error('admin-cleanup', 'Cleanup all rooms failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Delete all broadcasts ──
router.post('/cleanup/all-broadcasts', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    log.info('admin-cleanup', 'Deleting all broadcasts', { adminId: req.auth.uniqueId });

    const snap = await db.collection('broadcasts').limit(5000).get();
    const docs = snap.docs;

    if (docs.length === 0) {
      return res.json({ success: true, deleted: 0, message: 'No broadcasts found' });
    }

    for (let i = 0; i < docs.length; i += 500) {
      const batch = db.batch();
      for (const doc of docs.slice(i, i + 500)) {
        batch.delete(doc.ref);
      }
      await batch.commit();
    }

    res.json({ success: true, deleted: docs.length });
  } catch (err) {
    log.error('admin-cleanup', 'Cleanup all broadcasts failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Delete all admin audit logs ──
router.post('/cleanup/all-audit-logs', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    log.info('admin-cleanup', 'Deleting all audit logs', { adminId: req.auth.uniqueId });

    const snap = await db.collection('adminAuditLog').limit(5000).get();
    const docs = snap.docs;

    if (docs.length === 0) {
      return res.json({ success: true, deleted: 0, message: 'No audit logs found' });
    }

    for (let i = 0; i < docs.length; i += 500) {
      const batch = db.batch();
      for (const doc of docs.slice(i, i + 500)) {
        batch.delete(doc.ref);
      }
      await batch.commit();
    }

    res.json({ success: true, deleted: docs.length });
  } catch (err) {
    log.error('admin-cleanup', 'Cleanup all audit logs failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Clean up destroyed user profiles ──
router.post('/cleanup/destroyed-users', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    log.info('admin-cleanup', 'Cleaning up destroyed user profiles', {
      adminId: req.auth.uniqueId,
    });

    const snap = await db.collection('users').limit(5000).get();
    const users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const destroyed = users.filter((u) => !u.createdAt);
    const intact = users.length - destroyed.length;

    if (destroyed.length === 0) {
      return res.json({ success: true, destroyed: 0, intact, message: 'No destroyed users found' });
    }

    for (let i = 0; i < destroyed.length; i += 500) {
      const batch = db.batch();
      for (const u of destroyed.slice(i, i + 500)) {
        batch.delete(db.doc(`users/${u.id}`));
      }
      await batch.commit();
    }

    res.json({
      success: true,
      destroyed: destroyed.length,
      intact,
      deletedUids: destroyed.map((u) => u.id),
    });
  } catch (err) {
    log.error('admin-cleanup', 'Cleanup destroyed users failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Delete all device bindings ──
router.post('/cleanup/all-device-bindings', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    log.info('admin-cleanup', 'Deleting all device bindings', { adminId: req.auth.uniqueId });

    const snap = await db.collection('deviceBindings').limit(5000).get();
    const docs = snap.docs;

    if (docs.length === 0) {
      return res.json({ success: true, deleted: 0, message: 'No device bindings found' });
    }

    for (let i = 0; i < docs.length; i += 500) {
      const batch = db.batch();
      for (const doc of docs.slice(i, i + 500)) {
        batch.delete(doc.ref);
      }
      await batch.commit();
    }

    res.json({ success: true, deleted: docs.length });
  } catch (err) {
    log.error('admin-cleanup', 'Cleanup all device bindings failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Delete device binding for a specific user ──
router.post('/cleanup/device-binding/:uniqueId', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const rawId = req.params.uniqueId;
    const numId = Number(rawId);
    // Query both string and number variants — Firestore equality is type-strict
    const uniqueId = isNaN(numId) ? rawId : numId;
    log.info('admin-cleanup', 'Deleting device binding for user', {
      adminId: req.auth.uniqueId,
      targetUniqueId: uniqueId,
    });
    const snap = await db
      .collection('deviceBindings')
      .where('uniqueId', '==', uniqueId)
      .limit(50)
      .get();
    const docs = snap.docs;

    if (docs.length === 0) {
      return res.json({ success: true, deleted: 0, message: 'No device bindings for this user' });
    }

    const batch = db.batch();
    for (const doc of docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();

    res.json({ success: true, deleted: docs.length });
  } catch (err) {
    log.error('admin-cleanup', 'Cleanup device binding failed', {
      uniqueId: req.params.uniqueId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ══════════════════════════════════════════════════════════════
// STORAGE AUDIT & ORPHAN CLEANUP
// ══════════════════════════════════════════════════════════════

// ── R2 folder audit ──
router.get('/storage/audit', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const folders = [
      'profiles/',
      'covers/',
      'messages/',
      'groups/',
      'evidence/',
      'stickers/',
      'banners/',
    ];
    const results = {};
    let totalFiles = 0;
    let totalBytes = 0;

    for (const folder of folders) {
      const objects = await listObjectsWithMeta(folder);
      const count = objects.length;
      let bytes = 0;
      for (const obj of objects) {
        bytes += obj.size || 0;
      }

      const name = folder.replace('/', '');
      results[name] = { count, bytes };
      totalFiles += count;
      totalBytes += bytes;
    }

    res.json({ folders: results, totalFiles, totalBytes });
  } catch (err) {
    log.error('admin-cleanup', 'Storage audit failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Smart R2 orphan cleanup ──
router.post('/cleanup/orphaned-storage', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    log.info('admin-cleanup', 'Running orphaned storage cleanup', { adminId: req.auth.uniqueId });

    const CDN_PREFIX = r2.CDN_URL + '/';
    const extractKey = (url) => {
      if (!url || !url.startsWith(CDN_PREFIX)) return null;
      return url.slice(CDN_PREFIX.length);
    };

    const referencedKeys = new Set();
    referencedKeys.add('system/shytalk_icon.webp');

    // ── Users ──
    const usersSnap = await db.collection('users').orderBy('uid').get();
    for (const doc of usersSnap.docs) {
      const userData = doc.data();
      for (const field of [
        'profilePhotoUrl',
        'coverPhotoUrl',
        'preSuspensionProfilePhotoUrl',
        'preSuspensionCoverPhotoUrl',
        'profile_photo_url',
        'cover_photo_url',
        'pre_suspension_profile_photo_url',
        'pre_suspension_cover_photo_url',
      ]) {
        const storageKey = extractKey(userData[field]);
        if (storageKey) referencedKeys.add(storageKey);
      }
    }

    // ── Conversations (group photo + message images) ──
    const convsSnap = await db.collection('conversations').limit(2000).get();
    const convs = convsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    for (const conv of convs) {
      const storageKey = extractKey(conv.groupPhotoUrl ?? conv.group_photo_url);
      if (storageKey) referencedKeys.add(storageKey);
    }

    // ── Conversation messages (IMAGE type) — cap at 30 convs ──
    const convsToScan = convs.slice(0, 30);
    for (const conv of convsToScan) {
      const msgsSnap = await db
        .collection(`conversations/${conv.id}/messages`)
        .where('type', '==', 'IMAGE')
        .limit(200)
        .get();
      for (const doc of msgsSnap.docs) {
        const msg = doc.data();
        const urls = msg.imageUrls ?? msg.image_urls;
        if (Array.isArray(urls)) {
          for (const url of urls) {
            const imageKey = extractKey(url);
            if (imageKey) referencedKeys.add(imageKey);
          }
        }
      }
    }

    // ── Room messages (IMAGE type) — cap at 30 rooms ──
    const roomsSnap = await db.collection('rooms').limit(200).get();
    const rooms = roomsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const roomsToScan = rooms.slice(0, 30);
    for (const room of roomsToScan) {
      const msgsSnap = await db
        .collection(`rooms/${room.id}/messages`)
        .where('type', '==', 'IMAGE')
        .limit(200)
        .get();
      for (const doc of msgsSnap.docs) {
        const msg = doc.data();
        const urls = msg.imageUrls ?? msg.image_urls;
        if (Array.isArray(urls)) {
          for (const url of urls) {
            const imageKey = extractKey(url);
            if (imageKey) referencedKeys.add(imageKey);
          }
        }
      }
    }

    // ── Reports + archive ──
    const [reportsSnap, archiveSnap] = await Promise.all([
      db.collection('reports').get(),
      db.collection('reportsArchive').get(),
    ]);
    for (const doc of [...reportsSnap.docs, ...archiveSnap.docs]) {
      const row = doc.data();
      const urls = row.evidenceUrls ?? row.evidence_urls;
      if (Array.isArray(urls)) {
        for (const url of urls) {
          const evidenceKey = extractKey(url);
          if (evidenceKey) referencedKeys.add(evidenceKey);
        }
      }
    }

    // ── Banners ──
    const bannersSnap = await db.collection('banners').get();
    for (const doc of bannersSnap.docs) {
      const bannerData = doc.data();
      const storageKey = extractKey(bannerData.imageUrl ?? bannerData.image_url);
      if (storageKey) referencedKeys.add(storageKey);
    }

    // ── List and delete orphans ──
    const folders = [
      'profiles/',
      'covers/',
      'messages/',
      'groups/',
      'evidence/',
      'stickers/',
      'banners/',
    ];
    const summary = {};
    let totalDeleted = 0;

    for (const folder of folders) {
      const allKeys = await r2.listObjects(folder);
      const toDelete = allKeys.filter((k) => !referencedKeys.has(k));

      if (toDelete.length > 0) {
        await r2.deleteObjects(toDelete);
      }

      summary[folder.replace('/', '')] = { total: allKeys.length, deleted: toDelete.length };
      totalDeleted += toDelete.length;
    }

    res.json({ success: true, summary, totalDeleted });
  } catch (err) {
    log.error('admin-cleanup', 'Orphaned storage cleanup failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Clear all stalkers from all users ──
router.post('/cleanup/all-stalkers', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    log.info('admin-cleanup', 'Clearing all stalkers', { adminId: req.auth.uniqueId });

    const usersSnap = await db.collection('users').orderBy('uid').get();
    let totalDeleted = 0;
    let usersReset = 0;

    for (const userDoc of usersSnap.docs) {
      const uid = userDoc.data().uid ?? userDoc.id;

      // Delete stalker subcollection
      const stalkersSnap = await db.collection(`users/${uid}/stalkers`).get();
      if (!stalkersSnap.empty) {
        for (let i = 0; i < stalkersSnap.docs.length; i += 500) {
          const batch = db.batch();
          for (const doc of stalkersSnap.docs.slice(i, i + 500)) {
            batch.delete(doc.ref);
          }
          await batch.commit();
        }
        totalDeleted += stalkersSnap.docs.length;
      }

      // Reset stalker counts on user doc
      const data = userDoc.data();
      if (
        (data.stalkerCount || 0) > 0 ||
        (data.newStalkerCount || 0) > 0 ||
        data.stalkersLastViewedAt
      ) {
        await db.doc(`users/${uid}`).update({
          stalkerCount: 0,
          newStalkerCount: 0,
          stalkersLastViewedAt: null,
        });
        usersReset++;
      }
    }

    log.info('admin-cleanup', 'Stalker cleanup complete', { totalDeleted, usersReset });
    res.json({ success: true, stalkersDeleted: totalDeleted, usersReset });
  } catch (err) {
    log.error('admin-cleanup', 'Stalker cleanup failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/cleanup/user-coins/:uniqueId — reset coins for a single user
router.post('/cleanup/user-coins/:uniqueId', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;
    await db.doc(`users/${req.params.uniqueId}`).update({ shyCoins: 0 });
    res.json({ success: true });
  } catch (err) {
    log.error('admin-cleanup', 'User coin reset failed', {
      uniqueId: req.params.uniqueId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/cleanup/user-beans/:uniqueId — reset beans for a single user
router.post('/cleanup/user-beans/:uniqueId', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;
    await db.doc(`users/${req.params.uniqueId}`).update({ shyBeans: 0 });
    res.json({ success: true });
  } catch (err) {
    log.error('admin-cleanup', 'User bean reset failed', {
      uniqueId: req.params.uniqueId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
