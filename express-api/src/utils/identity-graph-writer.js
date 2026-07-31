/**
 * Automatic identity-graph writing — SHY-0257.
 *
 * The admin routes could always build a graph BY HAND; nothing ever built one
 * from real traffic, so the anti-abuse cascade had nothing to cascade over. This
 * module is the missing half: it records the identifiers a sign-in presents and
 * links accounts that genuinely share one.
 *
 * ── Why identifiers are GRADED ───────────────────────────────────────────────
 *
 * The operator approved automatic suspension of linked accounts on one
 * condition: a false link must be near-impossible. That condition shapes
 * everything here, because the naive design is actively dangerous.
 *
 * IP addresses are shared BY DESIGN — carrier-grade NAT, schools, offices,
 * cafés, and every mobile network put thousands of unrelated people behind one
 * address. Browser fingerprints collide by construction: same phone model, same
 * browser, same settings. An identity graph that links on either of those would
 * not occasionally mislink strangers, it would do so constantly — and then
 * suspend them.
 *
 * So:
 *   STRONG — a hardware-backed device id. A claim about a physical device.
 *   WEAK   — IP, fingerprint. Context only. Recorded, never load-bearing.
 *
 * and the rules that follow:
 *
 *   1. Only a STRONG identifier can link accounts or cascade a suspension.
 *   2. An IP is never a linking identifier; it is evidence attached to a
 *      sign-in.
 *   3. Any identifier seen with more than SHARED_IDENTIFIER_ACCOUNT_THRESHOLD
 *      distinct accounts is marked `shared` and thereafter confers nothing —
 *      the more an identifier looks like infrastructure, the less it counts.
 *      This is what neutralises a shared office device or a family tablet.
 *   4. Private, loopback, link-local and CARRIER-NAT ranges are never stored.
 *      They identify nobody, and 100.64/10 in particular is a whole mobile
 *      network behind one address.
 *   5. Every automated suspension records its evidence, so an operator can see
 *      why it fired and undo it.
 *
 * The costs are asymmetric, and the thresholds are set accordingly. A missed
 * link means an abuser buys another device. A false link locks a real person —
 * plausibly a minor on a school or family network — out of their account, by an
 * automated process, with no human in the loop. We under-link on purpose.
 */

const { db } = require('./firebase');
const log = require('./log');

/** Which identifier types may carry a link, and which are context only. */
const IDENTIFIER_STRENGTH = Object.freeze({
  device: 'strong',
  ip: 'weak',
  fingerprint: 'weak',
});

/**
 * Distinct-account count above which an identifier is treated as shared
 * infrastructure and stops conferring any link at all.
 *
 * Five is deliberately low. A device legitimately used by more than a handful
 * of accounts is far likelier to be a family tablet, a demo phone or a shared
 * office machine than a ban-evader's — and the penalty for guessing wrong is
 * somebody losing their account automatically.
 */
const SHARED_IDENTIFIER_ACCOUNT_THRESHOLD = 5;

/** Bound on a single cascade, so one bad edge cannot suspend the whole userbase. */
const MAX_CASCADE_ACCOUNTS = 25;

/** Bound on graphs examined per sign-in. */
const MAX_GRAPH_SCAN = 200;

/** Suspension severity, strictest wins on merge. */
const SUSPENSION_RANK = Object.freeze({ none: 0, warned: 1, suspended: 2, banned: 3 });

/** Strength of an identifier type; unknown types are treated as weak. */
function identifierStrength(type) {
  return IDENTIFIER_STRENGTH[type] || 'weak';
}

/** IPv4-mapped IPv6 collapses to IPv4 so one address has one spelling. */
function normaliseIp(ip) {
  if (!ip || typeof ip !== 'string') return null;
  const trimmed = ip.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('::ffff:')) return trimmed.slice(7);
  return trimmed;
}

/**
 * Addresses that identify nobody and must never be stored.
 *
 * Includes 100.64.0.0/10 (carrier-grade NAT) alongside the RFC1918 ranges:
 * storing a CGNAT address would file an entire mobile network under one
 * identifier, which is the single most effective way to manufacture false
 * links at scale.
 */
function isNonIdentifyingIp(ip) {
  if (!ip) return true;
  if (/^(10\.|192\.168\.|127\.|169\.254\.|::1$|fe80:|fc00:|fd00:)/.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  // 100.64.0.0/10 — carrier-grade NAT
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) return true;
  return false;
}

/**
 * May this identifier link two accounts together?
 *
 * Strong AND not shared infrastructure. Everything else is recorded for an
 * investigator to look at and is incapable of costing anyone their account.
 */
function canLinkAccounts(identifier) {
  if (!identifier) return false;
  if (identifierStrength(identifier.type) !== 'strong') return false;
  if (identifier.shared === true) return false;
  return true;
}

/** The stricter of two suspension levels; used when graphs merge. */
function stricterSuspension(a, b) {
  const ra = SUSPENSION_RANK[a] ?? 0;
  const rb = SUSPENSION_RANK[b] ?? 0;
  return ra >= rb ? a || 'none' : b || 'none';
}

/**
 * Build the identifier rows for a sign-in, dropping anything that identifies
 * nobody. Returns [] when the sign-in presents nothing usable.
 */
function buildIdentifiers({ ip, deviceId, fingerprint, isp, country }, nowMs) {
  const identifiers = [];

  if (deviceId) {
    identifiers.push({
      type: 'device',
      value: String(deviceId),
      metadata: {},
      addedAt: nowMs,
      source: 'auto',
      suspension: null,
      shared: false,
    });
  }

  const cleanIp = normaliseIp(ip);
  if (cleanIp && !isNonIdentifyingIp(cleanIp)) {
    identifiers.push({
      type: 'ip',
      value: cleanIp,
      // ISP/country are best-effort enrichment. A lookup that timed out or
      // errored yields null, and the identifier is still recorded — an IP with
      // unknown provenance is more useful than no IP at all.
      metadata: { isp: isp ?? null, country: country ?? null },
      addedAt: nowMs,
      source: 'auto',
      suspension: null,
      shared: false,
    });
  }

  if (fingerprint) {
    identifiers.push({
      type: 'fingerprint',
      value: String(fingerprint),
      metadata: {},
      addedAt: nowMs,
      source: 'auto',
      suspension: null,
      shared: false,
    });
  }

  return identifiers;
}

/** Does a graph already contain this identifier? */
function graphHasIdentifier(graph, identifier) {
  return (graph.identifiers || []).some(
    (i) => i.type === identifier.type && String(i.value) === String(identifier.value),
  );
}

/**
 * Graphs that share at least one LINKABLE identifier with this sign-in.
 *
 * Weak identifiers are excluded from the match on purpose: a graph found via a
 * shared IP would merge two strangers into one identity. Weak identifiers are
 * still stored on whichever graph the account belongs to — they just never
 * decide which graph that is.
 */
async function findLinkedGraphs(identifiers, uniqueId) {
  const linkable = identifiers.filter(canLinkAccounts);
  const snap = await db.collection('identityGraphs').limit(MAX_GRAPH_SCAN).get();
  if (snap.empty) return [];

  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((graph) => {
      if ((graph.linkedAccountUids || []).map(String).includes(String(uniqueId))) return true;
      return linkable.some((ident) => {
        const match = (graph.identifiers || []).find(
          (i) => i.type === ident.type && String(i.value) === String(ident.value),
        );
        // The STORED identifier must itself still be linkable — one that has
        // since been demoted to shared stops joining anybody together.
        return match ? canLinkAccounts(match) : false;
      });
    });
}

/**
 * Mark identifiers that now span too many accounts as shared infrastructure.
 *
 * Applied AFTER the account list is known, so an identifier crossing the
 * threshold stops linking from that moment on. Existing links are not
 * retro-severed — that is an operator decision, and the flag makes the
 * situation visible for them to make it.
 */
function markSharedIdentifiers(graph) {
  const accountCount = (graph.linkedAccountUids || []).length;
  if (accountCount <= SHARED_IDENTIFIER_ACCOUNT_THRESHOLD) return graph;

  graph.identifiers = (graph.identifiers || []).map((i) => ({ ...i, shared: true }));
  graph.sharedInfrastructureSuspected = true;
  return graph;
}

/**
 * Record a sign-in against the identity graph.
 *
 * Returns a summary rather than nothing, so callers and tests can assert what
 * happened instead of inferring it from a silent resolve.
 *
 * Never throws: a sign-in must not fail because anti-abuse bookkeeping did.
 */
async function recordSignIn({
  uniqueId,
  ip = null,
  deviceId = null,
  fingerprint = null,
  isp = null,
  country = null,
  nowMs = Date.now(),
} = {}) {
  const summary = {
    graphId: null,
    identifiersAdded: 0,
    merged: 0,
    multiAccountDetected: false,
    cascadedAccounts: [],
  };
  if (!uniqueId) return summary;

  try {
    const identifiers = buildIdentifiers({ ip, deviceId, fingerprint, isp, country }, nowMs);
    if (identifiers.length === 0) return summary;

    const linked = await findLinkedGraphs(identifiers, uniqueId);

    // Merge: several graphs sharing a newly-presented strong identifier are
    // really one identity that we had recorded in pieces.
    let graph;
    if (linked.length === 0) {
      graph = {
        graphId: `auto-${uniqueId}-${nowMs}`,
        identifiers: [],
        linkedAccountUids: [],
        multiAccountDetected: false,
        suspensionLevel: 'none',
        createdAt: nowMs,
      };
    } else {
      graph = linked[0];
      for (const other of linked.slice(1)) {
        for (const ident of other.identifiers || []) {
          if (!graphHasIdentifier(graph, ident)) graph.identifiers.push(ident);
        }
        graph.linkedAccountUids = [
          ...new Set([...(graph.linkedAccountUids || []), ...(other.linkedAccountUids || [])]),
        ];
        // Strictest wins — a merge must never launder a ban into a milder state.
        graph.suspensionLevel = stricterSuspension(graph.suspensionLevel, other.suspensionLevel);
        graph.multiAccountDetected = graph.multiAccountDetected || other.multiAccountDetected;
        await db.doc(`identityGraphs/${other.graphId || other.id}`).delete();
        summary.merged += 1;
      }
    }

    graph.identifiers = graph.identifiers || [];
    for (const ident of identifiers) {
      if (!graphHasIdentifier(graph, ident)) {
        graph.identifiers.push(ident);
        summary.identifiersAdded += 1;
      }
    }

    const before = new Set((graph.linkedAccountUids || []).map(String));
    graph.linkedAccountUids = [...new Set([...before, String(uniqueId)])];

    // Multi-account means SEVERAL accounts joined by evidence strong enough to
    // act on. Counting weak-linked accounts here would flag every household.
    const hasStrongLink = graph.identifiers.some(canLinkAccounts);
    if (hasStrongLink && graph.linkedAccountUids.length > 1) {
      graph.multiAccountDetected = true;
      summary.multiAccountDetected = true;
    }

    markSharedIdentifiers(graph);
    graph.updatedAt = nowMs;

    const graphId = graph.graphId || graph.id;
    graph.graphId = graphId;
    // `id` is a read-time convenience from findLinkedGraphs, not part of the
    // document; writing it back would create a second spelling of the key.
    delete graph.id;
    await db.doc(`identityGraphs/${graphId}`).set(graph);
    summary.graphId = graphId;

    if (summary.multiAccountDetected) {
      await db.collection('adminAuditLog').add({
        actionType: 'identity_multi_account_detected',
        targetType: 'identityGraph',
        targetId: graphId,
        details: {
          uniqueId: String(uniqueId),
          linkedAccountUids: graph.linkedAccountUids,
          // The evidence, so an operator can judge the link rather than trust it.
          linkingIdentifiers: graph.identifiers
            .filter(canLinkAccounts)
            .map((i) => ({ type: i.type, value: i.value })),
        },
        timestamp: nowMs,
        createdAt: nowMs,
      });
    }

    summary.cascadedAccounts = await cascadeSuspension(graph, uniqueId, nowMs);
    return summary;
  } catch (err) {
    log.error('identity-graph-writer', 'recordSignIn failed', {
      uniqueId,
      error: err.message,
    });
    return summary;
  }
}

/**
 * Propagate a suspension from a suspended STRONG identifier to the accounts
 * that share it.
 *
 * The narrowness is the safeguard. A cascade requires:
 *   - a STRONG identifier (device), not an IP or a fingerprint;
 *   - that is not shared infrastructure;
 *   - that is itself already suspended by someone or something.
 *
 * A shared IP or a colliding fingerprint can therefore never suspend anybody,
 * no matter how many accounts it touches.
 */
async function cascadeSuspension(graph, triggeringUniqueId, nowMs) {
  const suspendedStrong = (graph.identifiers || []).filter(
    (i) => canLinkAccounts(i) && i.suspension && i.suspension !== 'none',
  );
  if (suspendedStrong.length === 0) return [];

  const level = suspendedStrong
    .map((i) => i.suspension)
    .reduce((acc, s) => stricterSuspension(acc, s), 'none');

  const targets = (graph.linkedAccountUids || []).slice(0, MAX_CASCADE_ACCOUNTS);
  if (targets.length === 0) return [];

  const cascaded = [];
  for (const uid of targets) {
    try {
      await db.doc(`users/${uid}`).set(
        {
          isSuspended: true,
          suspensionLevel: level,
          suspendedAt: nowMs,
          // Marked as automated and reversible: an appeal needs something to
          // act on, and a bad rule needs to be undoable in bulk.
          suspensionSource: 'identity-graph-cascade',
          suspensionEvidence: {
            graphId: graph.graphId,
            triggeredBy: String(triggeringUniqueId),
            identifiers: suspendedStrong.map((i) => ({ type: i.type, value: i.value })),
          },
        },
        { merge: true },
      );
      cascaded.push(String(uid));
    } catch (err) {
      log.error('identity-graph-writer', 'Cascade write failed', { uid, error: err.message });
    }
  }

  if (cascaded.length > 0) {
    await db.collection('adminAuditLog').add({
      actionType: 'identity_cascade_suspension',
      targetType: 'identityGraph',
      targetId: graph.graphId,
      details: {
        level,
        triggeredBy: String(triggeringUniqueId),
        affectedAccounts: cascaded,
        evidence: suspendedStrong.map((i) => ({ type: i.type, value: i.value })),
      },
      timestamp: nowMs,
      createdAt: nowMs,
    });
  }

  return cascaded;
}

module.exports = {
  IDENTIFIER_STRENGTH,
  SHARED_IDENTIFIER_ACCOUNT_THRESHOLD,
  MAX_CASCADE_ACCOUNTS,
  SUSPENSION_RANK,
  identifierStrength,
  normaliseIp,
  isNonIdentifyingIp,
  canLinkAccounts,
  stricterSuspension,
  buildIdentifiers,
  findLinkedGraphs,
  markSharedIdentifiers,
  recordSignIn,
  cascadeSuspension,
};
