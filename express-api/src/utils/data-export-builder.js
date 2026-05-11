/**
 * Build a GDPR data export ZIP for a single user.
 *
 * Collects all personal data from Firestore, strips sensitive internal
 * fields, and assembles a ZIP buffer using archiver.
 *
 * Partial-failure contract: each subcollection query is wrapped in a try
 * block. On failure the section is omitted (or empty), the failure is
 * recorded in `failedSections`, and the export still completes. The caller
 * MUST surface partial state to the user (per GDPR Article 20 — exports
 * claiming completeness while silently missing data are a compliance
 * issue). The ZIP itself includes a `manifest.json` enumerating all
 * sections + their status, so the user can see exactly what was retrieved.
 *
 * @param {string} uniqueId - The user's uniqueId
 * @returns {Promise<{buffer: Buffer, partial: boolean, failedSections: string[]}>}
 */

// archiver v8 is ESM-only and exports named class constructors instead of a
// callable factory (the v7 shape `archiver('zip', opts)` is gone). The rest
// of express-api (and the Jest runner) remains CommonJS, so we can't
// `require()` v8 directly — use a cached dynamic import. `import()` is
// available in CJS, and the consuming function is already async. The
// promise resolves once per process; subsequent builds await the
// already-settled value at effectively zero cost.
const zipArchivePromise = import('archiver').then((m) => m.ZipArchive);
const { db } = require('./firebase');
const { queryDocs } = require('./firestore-helpers');
const log = require('./log');

// Fields to strip from the profile (internal/sensitive)
const STRIP_FIELDS = [
  'pinHash',
  'pinSetAt',
  'pinAttempts',
  'pinLockedUntil',
  'pinLockoutCount',
  'firebaseUid',
  'fcmTokens',
  'dataExportR2Key',
  'dataExportStatus',
  'dataExportExpiresAt',
  'lastDataExportRequestedAt',
  '_testRun',
];

async function buildDataExport(uniqueId) {
  // Track every section's outcome so the manifest + caller can see exactly
  // which subcollection queries succeeded. Insertion order matches the order
  // of section reads below — useful for debugging which doc is failing on
  // a given user.
  const failedSections = [];
  function recordFailure(section, err) {
    failedSections.push(section);
    log.error('data-export', `Failed to query ${section}`, {
      uniqueId,
      section,
      error: err.message,
    });
  }

  // Read user doc
  const userSnap = await db.doc(`users/${uniqueId}`).get();
  if (!userSnap.exists) {
    throw new Error('User not found');
  }
  const userData = { ...userSnap.data() };

  // Strip sensitive fields
  for (const field of STRIP_FIELDS) {
    delete userData[field];
  }

  // Collect all data
  const profile = { ...userData };
  delete profile.followerIds;
  delete profile.followingIds;
  delete profile.blockedUserIds;

  const settings = {
    pmPrivacy: userData.pmPrivacy,
    pmNotificationsEnabled: userData.pmNotificationsEnabled,
    pmSoundEnabled: userData.pmSoundEnabled,
    pmShowTimestamps: userData.pmShowTimestamps,
    pmShowDateSeparators: userData.pmShowDateSeparators,
    pmNotificationPreview: userData.pmNotificationPreview,
    dndEnabled: userData.dndEnabled,
    dndStartHour: userData.dndStartHour,
    dndStartMinute: userData.dndStartMinute,
    dndEndHour: userData.dndEndHour,
    dndEndMinute: userData.dndEndMinute,
    minGiftAnimationValue: userData.minGiftAnimationValue,
    selfDestructAlertEnabled: userData.selfDestructAlertEnabled,
    language: userData.language,
  };

  const followers = {
    followerIds: userData.followerIds || [],
    followingIds: userData.followingIds || [],
  };

  const blocked = { blockedUserIds: userData.blockedUserIds || [] };

  const balance = {
    shyCoins: userData.shyCoins || 0,
    shyBeans: userData.shyBeans || 0,
    luckScore: userData.luckScore || 0,
    pityCounter: userData.pityCounter || 0,
  };

  // Subcollections — each individually try-catched so a transient failure
  // on one (e.g., a bad rules deploy on `warnings`) doesn't abort the
  // entire export and lose the rest of the user's data.
  let backpack = [];
  try {
    backpack = await queryDocs(db.collection(`users/${uniqueId}/backpack`));
  } catch (err) {
    recordFailure('backpack', err);
  }
  let giftWall = [];
  try {
    giftWall = await queryDocs(db.collection(`users/${uniqueId}/giftWall`));
  } catch (err) {
    recordFailure('giftWall', err);
  }
  let transactions = [];
  try {
    transactions = await queryDocs(db.collection(`users/${uniqueId}/transactions`));
  } catch (err) {
    recordFailure('transactions', err);
  }
  let warnings = [];
  try {
    warnings = await queryDocs(db.collection(`users/${uniqueId}/warnings`));
  } catch (err) {
    recordFailure('warnings', err);
  }

  // Conversations (only user's own messages)
  let conversations = [];
  const userMessages = [];
  try {
    const convSnap = await db
      .collection('conversations')
      .where('participantIds', 'array-contains', Number.parseInt(uniqueId, 10))
      .get();
    const numericId = Number.parseInt(uniqueId, 10);
    conversations = convSnap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        type: data.type,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        participantCount: data.participantIds ? data.participantIds.length : undefined,
        userRole: data.roles ? data.roles[uniqueId] : undefined,
        isUserOwner: data.ownerId === numericId,
      };
    });

    // Collect user's own messages from each conversation (max 1000 total)
    for (const conv of convSnap.docs) {
      if (userMessages.length >= 1000) break;
      try {
        const remaining = 1000 - userMessages.length;
        const msgSnap = await db
          .collection(`conversations/${conv.id}/messages`)
          .where('senderId', '==', uniqueId)
          .orderBy('createdAt', 'desc')
          .limit(remaining)
          .get();
        for (const m of msgSnap.docs) {
          userMessages.push({ conversationId: conv.id, id: m.id, ...m.data() });
        }
      } catch (msgErr) {
        // Per-conversation message failure: record the conversation id in
        // the section name so operators can identify which conversation
        // is poisoned without needing log correlation.
        recordFailure(`conversations/${conv.id}/messages`, msgErr);
      }
    }
  } catch (err) {
    recordFailure('conversations', err);
  }

  // Rooms owned by user
  let roomsOwned = [];
  try {
    const roomSnap = await db.collection('rooms').where('ownerId', '==', uniqueId).get();
    roomsOwned = roomSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    recordFailure('rooms', err);
  }

  // Reports filed by user
  let reportsFiled = [];
  try {
    const reportSnap = await db.collection('reports').where('reporterId', '==', uniqueId).get();
    reportsFiled = reportSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    recordFailure('reports', err);
  }

  // Appeals
  let appeals = [];
  try {
    const appealSnap = await db
      .collection('suspensionAppeals')
      .where('userId', '==', uniqueId)
      .get();
    appeals = appealSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    recordFailure('appeals', err);
  }

  // Identity
  let identity = [];
  try {
    const idSnap = await db
      .collection('identityMap')
      .where('uniqueId', '==', Number.parseInt(uniqueId, 10))
      .get();
    identity = idSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    recordFailure('identity', err);
  }

  // Device bindings
  let deviceBindings = [];
  try {
    const bindSnap = await db
      .collection('deviceBindings')
      .where('uniqueId', '==', Number.parseInt(uniqueId, 10))
      .get();
    deviceBindings = bindSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    recordFailure('deviceBindings', err);
  }

  // Suggestions (GDPR: include all user's suggestions)
  let suggestions = [];
  try {
    const sugSnap = await db
      .collection('suggestions')
      .where('submitterUid', '==', Number.parseInt(uniqueId, 10))
      .get();
    suggestions = sugSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    recordFailure('suggestions', err);
  }

  // Suggestion votes by this user — collection-group query (Phase 2A finding #1).
  // Previously this read EVERY suggestion in the corpus then did N+1 individual
  // vote lookups per suggestion. With ~1000 suggestions that's 2K reads per
  // export, on a Spark-tier 50K/day quota that's a quota grenade once exports
  // become routine. The collection-group query reads ONLY the docs where
  // `voterId === uniqueId` — at most ~hundreds per user. Requires a
  // collection-group composite index on `votes.voterId` (added in firestore.indexes.json).
  const suggestionVotes = [];
  try {
    const numericUid = Number.parseInt(uniqueId, 10);
    const votesSnap = await db.collectionGroup('votes').where('voterId', '==', numericUid).get();
    for (const voteDoc of votesSnap.docs) {
      // votes are stored at suggestions/{suggestionId}/votes/{voterId}, so the
      // suggestion ID is the parent's parent (the votes subcollection's parent
      // doc, which is the suggestion). Defensive null check in case a future
      // collection-group expansion introduces a different `votes` subcollection
      // at another nesting level.
      const suggestionRef = voteDoc.ref.parent.parent;
      if (!suggestionRef || suggestionRef.parent.id !== 'suggestions') continue;
      suggestionVotes.push({ suggestionId: suggestionRef.id, ...voteDoc.data() });
    }
  } catch (err) {
    recordFailure('suggestionVotes', err);
  }

  // Subscription preferences
  let subscriptionPrefs = null;
  try {
    const subSnap = await db.doc(`subscriptions/${uniqueId}`).get();
    if (subSnap.exists) subscriptionPrefs = subSnap.data();
  } catch (err) {
    recordFailure('subscriptionPrefs', err);
  }

  // Notification history
  let notificationHistory = [];
  try {
    const notifSnap = await db
      .collection('notifications')
      .where('uid', '==', Number.parseInt(uniqueId, 10))
      .get();
    notificationHistory = notifSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    recordFailure('notifications', err);
  }

  const partial = failedSections.length > 0;

  // Manifest enumerates every section in the export — its presence in the
  // ZIP guarantees the user can reconstruct what was attempted vs. what
  // succeeded, even years later when this code has changed. The `partial`
  // flag drives caller-side notification ("we couldn't get all your data,
  // please retry") and the entry in failedSections is what they retry on.
  const manifest = {
    uniqueId,
    exportDate: new Date().toISOString(),
    partial,
    failedSections,
    sections: {
      profile: 'ok',
      settings: 'ok',
      identity: failedSections.includes('identity') ? 'failed' : 'ok',
      followers: 'ok',
      blocked: 'ok',
      backpack: failedSections.includes('backpack') ? 'failed' : 'ok',
      giftWall: failedSections.includes('giftWall') ? 'failed' : 'ok',
      transactions: failedSections.includes('transactions') ? 'failed' : 'ok',
      warnings: failedSections.includes('warnings') ? 'failed' : 'ok',
      conversations: failedSections.includes('conversations') ? 'failed' : 'ok',
      rooms: failedSections.includes('rooms') ? 'failed' : 'ok',
      reports: failedSections.includes('reports') ? 'failed' : 'ok',
      appeals: failedSections.includes('appeals') ? 'failed' : 'ok',
      deviceBindings: failedSections.includes('deviceBindings') ? 'failed' : 'ok',
      suggestions: failedSections.includes('suggestions') ? 'failed' : 'ok',
      suggestionVotes: failedSections.includes('suggestionVotes') ? 'failed' : 'ok',
      subscriptionPrefs: failedSections.includes('subscriptionPrefs') ? 'failed' : 'ok',
      notifications: failedSections.includes('notifications') ? 'failed' : 'ok',
    },
  };

  // Build ZIP
  const ZipArchive = await zipArchivePromise;
  const buffer = await new Promise((resolve, reject) => {
    const chunks = [];
    const archive = new ZipArchive({ zlib: { level: 9 } });

    archive.on('data', (chunk) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);

    const readmeLines = [
      'ShyTalk Data Export',
      '===================',
      '',
      `User ID: ${uniqueId}`,
      `Export date: ${new Date().toISOString()}`,
      '',
    ];
    if (partial) {
      // Surface partial-export state explicitly in the README so the user
      // sees it without parsing manifest.json. The list of failed sections
      // tells them exactly what they're missing.
      readmeLines.push(
        '⚠️  PARTIAL EXPORT',
        '',
        'This export is incomplete. The following sections could not be',
        'retrieved due to a transient backend failure:',
        '',
        ...failedSections.map((s) => `  - ${s}`),
        '',
        'You can request a fresh export in 24 hours. We apologise for the',
        'inconvenience — this is a compliance issue we take seriously.',
        '',
      );
    } else {
      readmeLines.push(
        'This ZIP contains all personal data associated with your ShyTalk account.',
        '',
      );
    }
    readmeLines.push(
      'Files:',
      '  manifest.json     — Section-by-section status of this export',
      '  profile.json      — Your profile information',
      '  settings.json     — Your privacy and notification settings',
      '  identity.json     — Your linked sign-in providers',
      '  followers.json    — Your followers and following lists',
      '  blocked.json      — Your blocked users list',
      '  economy/          — Your coins, beans, transactions, and backpack',
      '  gifts/            — Your gift wall',
      '  conversations/    — Your conversation metadata and messages',
      '  rooms/            — Rooms you own',
      '  reports/          — Reports you filed and appeals',
      '  devices/          — Your device bindings',
      '  moderation/       — Your warning history',
    );
    const readme = readmeLines.join('\n');

    archive.append(readme, { name: 'README.txt' });
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
    archive.append(JSON.stringify(profile, null, 2), { name: 'profile.json' });
    archive.append(JSON.stringify(settings, null, 2), {
      name: 'settings.json',
    });
    archive.append(JSON.stringify(identity, null, 2), {
      name: 'identity.json',
    });
    archive.append(JSON.stringify(followers, null, 2), {
      name: 'followers.json',
    });
    archive.append(JSON.stringify(blocked, null, 2), { name: 'blocked.json' });
    archive.append(JSON.stringify(balance, null, 2), {
      name: 'economy/balance.json',
    });
    archive.append(JSON.stringify(transactions.slice(0, 1000), null, 2), {
      name: 'economy/transactions.json',
    });
    archive.append(JSON.stringify(backpack, null, 2), {
      name: 'economy/backpack.json',
    });
    archive.append(JSON.stringify(giftWall, null, 2), {
      name: 'gifts/gift-wall.json',
    });
    archive.append(JSON.stringify(conversations, null, 2), {
      name: 'conversations/conversations.json',
    });
    archive.append(JSON.stringify(userMessages, null, 2), {
      name: 'conversations/messages.json',
    });
    archive.append(JSON.stringify(roomsOwned, null, 2), {
      name: 'rooms/rooms-owned.json',
    });
    archive.append(JSON.stringify(reportsFiled, null, 2), {
      name: 'reports/reports-filed.json',
    });
    archive.append(JSON.stringify(appeals, null, 2), {
      name: 'reports/appeals.json',
    });
    archive.append(JSON.stringify(deviceBindings, null, 2), {
      name: 'devices/device-bindings.json',
    });
    archive.append(JSON.stringify(warnings, null, 2), {
      name: 'moderation/warnings.json',
    });
    archive.append(JSON.stringify(suggestions, null, 2), {
      name: 'suggestions/suggestions.json',
    });
    archive.append(JSON.stringify(suggestionVotes, null, 2), {
      name: 'suggestions/votes.json',
    });
    if (subscriptionPrefs) {
      archive.append(JSON.stringify(subscriptionPrefs, null, 2), {
        name: 'suggestions/subscription-preferences.json',
      });
    }
    archive.append(JSON.stringify(notificationHistory, null, 2), {
      name: 'suggestions/notifications.json',
    });

    archive.finalize();
  });

  return { buffer, partial, failedSections };
}

module.exports = buildDataExport;
