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
const { buildReadme } = require('./data-export-readme-i18n');

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

/**
 * Walk a collection-group snapshot and keep only docs whose grandparent is
 * the top-level `suggestions` collection. Pulled out of the votes + comments
 * loops because (a) the defensive grandparent-id guard is the load-bearing
 * privacy invariant — any rogue subcollection with the same leaf name (e.g.
 * a future `posts/{id}/comments`) must NOT leak into a user's export — and
 * (b) inline, the guard's behavior could only be tested by decoding the
 * compressed ZIP buffer (no unzip lib is on the project's dep tree). As an
 * exported helper it can be unit-tested directly with mixed-legit-and-rogue
 * inputs, which is the only shape that actually pins `continue` as
 * filter-not-pass-all. The `mapper` lets each caller shape its own payload
 * (votes spread voteDoc.data(); comments also expose `id` because comment
 * doc IDs are auto-generated and meaningful to users, unlike vote doc IDs
 * which are just the voterId).
 *
 * @param {Array<{ref: {parent: {parent: {id: string, parent: {id: string}}}}, data: () => object, id?: string}>} docs
 * @param {(suggestionId: string, doc: object) => object} mapper
 * @returns {Array<object>}
 */
function collectSuggestionScopedEntries(docs, mapper) {
  const result = [];
  for (const doc of docs) {
    const suggestionRef = doc.ref.parent.parent;
    // Three failure modes to short-circuit BEFORE the `.parent.id` deref:
    //   (1) `suggestionRef === null` — top-level collection-group hit
    //       (a root-level `comments`/`votes` collection, if Firestore
    //       ever permits one).
    //   (2) `suggestionRef.parent === null` — pathologically deep nesting
    //       where the grandparent doc exists but its containing collection
    //       has no parent. Cannot happen in current Firestore semantics
    //       (every doc has a parent collection) but a malformed test
    //       fixture or an Admin-SDK version drift could surface it; the
    //       guard prevents a TypeError in either case.
    //   (3) The grandparent collection's name isn't `suggestions` — this
    //       is the actual privacy guard: any sibling subcollection with
    //       the same leaf name (e.g. `posts/{id}/comments`) must NOT leak.
    if (!suggestionRef || !suggestionRef.parent || suggestionRef.parent.id !== 'suggestions') {
      continue;
    }
    result.push(mapper(suggestionRef.id, doc));
  }
  return result;
}

// Per-section mappers, extracted as module-level constants so the test
// suite can pin each one's payload shape directly (the previous inline
// arrow functions made `id: commentDoc.id` propagation only testable
// through the compressed ZIP buffer, which has no unzip lib on the dep
// tree).
//
// Votes: doc ID is the voter's uniqueId (path `votes/{voterId}`), so
//   it's redundant with the `voterId` field in the payload — no `id:`.
// Comments: doc ID is `generateId()`-derived (path `comments/{auto}`),
//   so it's the ONLY stable identifier the user can use to correlate
//   an exported comment with one cited in a moderation appeal — `id:`
//   is required.
//
// Spread order: payload spread FIRST, explicit fields LAST. The trusted
// values (`suggestionId` from the doc-path, `id` from the doc-ref) must
// win over any same-named field that might end up in the payload — a
// future schema or a malicious write storing `id: '<spoofed>'` or
// `suggestionId: '<wrong>'` in the data must NOT be able to misattribute
// the entry in a user's GDPR export.
const _suggestionVoteMapper = (suggestionId, voteDoc) => ({
  ...voteDoc.data(),
  suggestionId,
});
const _suggestionCommentMapper = (suggestionId, commentDoc) => ({
  ...commentDoc.data(),
  suggestionId,
  id: commentDoc.id,
});

// Per-section mappers for the remaining eight GDPR-export sections. Same
// testability + spread-order reasoning as the two suggestion mappers above:
// each places trusted reference fields (`id` from the doc ref, and
// `conversationId` from the parent conversation doc for user messages)
// AFTER the payload spread so a same-named field in the payload — whether
// from a future schema or an adversarial Firestore write — cannot
// misattribute the entry in a user's GDPR export. See the
// `_suggestionCommentMapper` block above for the full rationale.
//
// `_userMessageMapper` carries two trusted fields (parent-conversation id
// + message-doc id); the remaining seven are single-arg `id`-only shapes.
const _userMessageMapper = (conv, m) => ({
  ...m.data(),
  conversationId: conv.id,
  id: m.id,
});
const _roomOwnedMapper = (d) => ({ ...d.data(), id: d.id });
const _reportFiledMapper = (d) => ({ ...d.data(), id: d.id });
const _appealMapper = (d) => ({ ...d.data(), id: d.id });
const _identityEntryMapper = (d) => ({ ...d.data(), id: d.id });
const _deviceBindingMapper = (d) => ({ ...d.data(), id: d.id });
const _submittedSuggestionMapper = (d) => ({ ...d.data(), id: d.id });
const _notificationMapper = (d) => ({ ...d.data(), id: d.id });

async function buildDataExport(uniqueId) {
  // Single numeric coercion shared by every Firestore equality query in
  // this function — the function previously did this seven times inline
  // (and once as a separately-named `numericId` local in the conversations
  // block). `parseInt` is safe to call before any awaits; if the input is
  // non-numeric the result is NaN and the downstream `where(...==..., NaN)`
  // returns an empty set, matching Firestore's strict-equality semantics.
  const numericUid = Number.parseInt(uniqueId, 10);

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
      .where('participantIds', 'array-contains', numericUid)
      .get();
    conversations = convSnap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        type: data.type,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        participantCount: data.participantIds ? data.participantIds.length : undefined,
        userRole: data.roles ? data.roles[uniqueId] : undefined,
        isUserOwner: data.ownerId === numericUid,
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
          userMessages.push(_userMessageMapper(conv, m));
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
    roomsOwned = roomSnap.docs.map(_roomOwnedMapper);
  } catch (err) {
    recordFailure('rooms', err);
  }

  // Reports filed by user
  let reportsFiled = [];
  try {
    const reportSnap = await db.collection('reports').where('reporterId', '==', uniqueId).get();
    reportsFiled = reportSnap.docs.map(_reportFiledMapper);
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
    appeals = appealSnap.docs.map(_appealMapper);
  } catch (err) {
    recordFailure('appeals', err);
  }

  // Identity
  let identity = [];
  try {
    const idSnap = await db.collection('identityMap').where('uniqueId', '==', numericUid).get();
    identity = idSnap.docs.map(_identityEntryMapper);
  } catch (err) {
    recordFailure('identity', err);
  }

  // Device bindings
  let deviceBindings = [];
  try {
    const bindSnap = await db
      .collection('deviceBindings')
      .where('uniqueId', '==', numericUid)
      .get();
    deviceBindings = bindSnap.docs.map(_deviceBindingMapper);
  } catch (err) {
    recordFailure('deviceBindings', err);
  }

  // Suggestions (GDPR: include all user's suggestions)
  let suggestions = [];
  try {
    const sugSnap = await db
      .collection('suggestions')
      .where('submitterUid', '==', numericUid)
      .get();
    suggestions = sugSnap.docs.map(_submittedSuggestionMapper);
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
  let suggestionVotes = [];
  try {
    const votesSnap = await db.collectionGroup('votes').where('voterId', '==', numericUid).get();
    // Votes live at `suggestions/{suggestionId}/votes/{voterId}` — the doc
    // ID is the voter's uniqueId so it's redundant with `voterId` in the
    // payload (no `id:` in the mapper, unlike comments). The grandparent-id
    // guard inside `collectSuggestionScopedEntries` rejects any rogue
    // `votes` subcollection at a different nesting level.
    suggestionVotes = collectSuggestionScopedEntries(votesSnap.docs, _suggestionVoteMapper);
  } catch (err) {
    recordFailure('suggestionVotes', err);
  }

  // Suggestion comments authored by this user — same collection-group shape
  // as votes above, same quota motivation. Comments live at
  // `suggestions/{suggestionId}/comments/{commentId}` with `authorUid` as the
  // user FK, so the index override is on `comments.authorUid` (added in
  // firestore.indexes.json alongside the votes override). The mapper exposes
  // `id: commentDoc.id` because comment doc IDs are auto-generated (not
  // derived from any payload field) and are the only stable identifier a
  // user can use to correlate an exported comment with one cited in a
  // moderation appeal or admin response.
  let suggestionComments = [];
  try {
    const commentsSnap = await db
      .collectionGroup('comments')
      .where('authorUid', '==', numericUid)
      .get();
    suggestionComments = collectSuggestionScopedEntries(
      commentsSnap.docs,
      _suggestionCommentMapper,
    );
  } catch (err) {
    recordFailure('suggestionComments', err);
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
    const notifSnap = await db.collection('notifications').where('uid', '==', numericUid).get();
    notificationHistory = notifSnap.docs.map(_notificationMapper);
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
      suggestionComments: failedSections.includes('suggestionComments') ? 'failed' : 'ok',
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

    // README.txt is rendered via the locale-aware builder. The owner's
    // language preference is on the user doc (set by the in-app
    // language picker). Untranslated locales fall back to English
    // automatically — see src/utils/data-export-readme-i18n.js for
    // the translation table and the contributor guidance for adding
    // a new locale.
    const readme = buildReadme({
      language: userData.language,
      uniqueId,
      exportDateIso: new Date().toISOString(),
      partial,
      failedSections,
    });

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
    archive.append(JSON.stringify(suggestionComments, null, 2), {
      name: 'suggestions/comments.json',
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
// Exposed for direct unit testing of the privacy-critical grandparent-id
// guard with mixed-legit-and-rogue inputs (the only assertion shape that
// actually pins the guard's behavior — see test file for the rationale).
// The per-section mappers are also exported so each one's payload shape
// (notably `id: commentDoc.id` for comments) can be pinned without
// decoding the compressed ZIP buffer.
module.exports._collectSuggestionScopedEntries = collectSuggestionScopedEntries;
module.exports._suggestionVoteMapper = _suggestionVoteMapper;
module.exports._suggestionCommentMapper = _suggestionCommentMapper;
module.exports._userMessageMapper = _userMessageMapper;
module.exports._roomOwnedMapper = _roomOwnedMapper;
module.exports._reportFiledMapper = _reportFiledMapper;
module.exports._appealMapper = _appealMapper;
module.exports._identityEntryMapper = _identityEntryMapper;
module.exports._deviceBindingMapper = _deviceBindingMapper;
module.exports._submittedSuggestionMapper = _submittedSuggestionMapper;
module.exports._notificationMapper = _notificationMapper;
