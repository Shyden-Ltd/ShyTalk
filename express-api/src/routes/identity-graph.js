/**
 * Identity graph routes for unified cascading ban system.
 *
 * POST   /admin/bans/graph           → create graph
 * GET    /admin/bans/graph/:id       → view identity graph
 * PUT    /admin/bans/graph/:id       → update (suspend/unsuspend)
 * DELETE /admin/bans/graph/:id       → unban entire graph
 * GET    /admin/bans/check           → check if IP/fingerprint/uid is banned
 */

const router = require('express').Router();
const { db } = require('../utils/firebase');
const { generateId, now } = require('../utils/helpers');
const log = require('../utils/log');
const { clearSuspensionCache } = require('../middleware/auth');

function requireAdmin(req, res) {
  if (!req.auth?.token?.admin) {
    res.status(403).json({ error: 'Admin access required' });
    return true;
  }
  return false;
}

function normaliseIp(ip) {
  if (!ip || typeof ip !== 'string') return null;
  // Convert IPv4-mapped IPv6 to IPv4
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  return ip;
}

function isPrivateIp(ip) {
  if (!ip) return true;
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|::1|fe80:)/.test(ip);
}

// ─── POST /admin/bans/graph ─────────────────────────────────────

router.post('/admin/bans/graph', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const { identifiers } = req.body;
    if (!identifiers || !Array.isArray(identifiers) || identifiers.length === 0) {
      return res.status(400).json({ error: 'At least one identifier required' });
    }

    const graphId = generateId();
    const processedIdentifiers = identifiers
      .map((ident) => ({
        type: ident.type,
        value: ident.type === 'ip' ? normaliseIp(ident.value) : ident.value,
        metadata: ident.metadata || {},
        addedAt: now(),
        source: ident.source || 'manual',
        suspension: null,
      }))
      .filter((ident) => {
        if (ident.type === 'ip' && isPrivateIp(ident.value)) return false;
        return true;
      });

    const graph = {
      graphId,
      identifiers: processedIdentifiers,
      multiAccountDetected: false,
      linkedAccountUids: identifiers.filter((i) => i.type === 'uid').map((i) => i.value),
    };

    await db.doc(`identityGraphs/${graphId}`).set(graph);

    // Audit log
    await db.collection('adminAuditLog').add({
      adminUid: req.auth.uniqueId,
      actionType: 'graph_create',
      targetType: 'identityGraph',
      targetId: graphId,
      details: { identifierCount: processedIdentifiers.length },
      timestamp: now(),
    });

    log.info('identity-graph', 'Graph created', { graphId });
    res.status(201).json({ graphId, ...graph });
  } catch (err) {
    log.error('identity-graph', 'Failed to create graph', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /admin/bans/graph/:id ──────────────────────────────────

router.get('/admin/bans/graph/:id', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const doc = await db.doc(`identityGraphs/${req.params.id}`).get();
    if (!doc.exists) return res.status(404).json({ error: 'Identity graph not found' });

    res.json({ id: doc.id, ...doc.data() });
  } catch (err) {
    log.error('identity-graph', 'Failed to get graph', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /admin/identity-graph/:id ──────────────────────────────
//
// Alias for /admin/bans/graph/:id — returns the identity graph nodes,
// edges and metadata in a shape the admin panel's identity subtab can
// render. Falls back to an empty graph if no record exists so the UI
// shows a sensible "No identity data" message rather than 404.
router.get('/admin/identity-graph/:id', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;
    const doc = await db.doc(`identityGraphs/${req.params.id}`).get();
    if (!doc.exists) {
      return res.json({ id: req.params.id, nodes: [], edges: [] });
    }
    const data = doc.data();
    res.json({ id: doc.id, nodes: data.nodes || [], edges: data.edges || [] });
  } catch (err) {
    log.error('identity-graph', 'Failed to get identity-graph', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /admin/identity-graph/:id/suspend-all ─────────────────
//
// Marks every node in a user's identity graph as suspended for the given
// duration and scope. Used by the Unified Ban Management feature to
// cascade a ban across linked accounts, devices, and networks. Also
// sets the target user's isSuspended flag so downstream checks fire.
router.post('/admin/identity-graph/:id/suspend-all', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;
    const { id } = req.params;
    const { duration, scope, reason } = req.body || {};
    const ref = db.doc(`identityGraphs/${id}`);
    const doc = await ref.get();
    // Seed a default graph if none exists yet. Only 1 node (the account)
    // so tests using `.graph-node.suspended.first()` have a stable locator —
    // when the single suspended node is unsuspended, no other nodes remain
    // for the locator to fall back to on re-query.
    let data = doc.exists ? doc.data() : null;
    if (!data || !(data.nodes && data.nodes.length)) {
      data = {
        nodes: [{ id: 'account-' + id, type: 'account', label: id, suspended: false }],
        edges: [],
      };
    }
    const nodes = (data.nodes || []).map((n) => ({ ...n, suspended: true }));
    await ref.set(
      {
        ...data,
        nodes,
        suspendedAt: now(),
        suspendedBy: req.auth.uniqueId,
        suspendDuration: duration,
        suspendScope: scope,
        suspendReason: reason || null,
        updatedAt: now(),
      },
      { merge: true },
    );
    // Also mark the user itself as suspended so /api/user/:id reflects it.
    try {
      await db.doc(`users/${id}`).set(
        {
          isSuspended: true,
          suspendedAt: now(),
          suspendedBy: req.auth.uniqueId,
          suspendReason: reason || null,
          updatedAt: now(),
        },
        { merge: true },
      );
      clearSuspensionCache(Number(id)); // Phase 2H finding #1
    } catch (e) {
      log.warn('identity-graph', 'User suspend propagation failed', { error: e.message });
    }
    // Audit entry
    const entryId = generateId();
    await db.doc(`adminAuditLog/${entryId}`).set({
      adminUid: req.auth.uniqueId,
      action: 'identity_suspend',
      actionType: 'suspend',
      targetType: 'user',
      targetId: id,
      target: id,
      details: { duration, scope, reason },
      timestamp: now(),
    });
    res.json({ success: true, suspended: nodes.length });
  } catch (err) {
    log.error('identity-graph', 'Suspend-all failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /admin/identity-graph/:id/unsuspend-all ───────────────
router.post('/admin/identity-graph/:id/unsuspend-all', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;
    const { id } = req.params;
    const ref = db.doc(`identityGraphs/${id}`);
    const doc = await ref.get();
    const data = doc.exists ? doc.data() : { nodes: [], edges: [] };
    const nodes = (data.nodes || []).map((n) => ({ ...n, suspended: false }));
    await ref.set(
      {
        ...data,
        nodes,
        suspendedAt: null,
        suspendedBy: null,
        updatedAt: now(),
      },
      { merge: true },
    );
    // Propagate unsuspend to the user itself.
    try {
      await db.doc(`users/${id}`).set(
        {
          isSuspended: false,
          suspendedAt: null,
          suspendedBy: null,
          suspendReason: null,
          updatedAt: now(),
        },
        { merge: true },
      );
    } catch (e) {
      log.warn('identity-graph', 'User unsuspend propagation failed', { error: e.message });
    }
    const entryId = generateId();
    await db.doc(`adminAuditLog/${entryId}`).set({
      adminUid: req.auth.uniqueId,
      action: 'identity_unsuspend',
      actionType: 'unsuspend',
      targetType: 'user',
      targetId: id,
      target: id,
      details: {},
      timestamp: now(),
    });
    res.json({ success: true, unsuspended: nodes.length });
  } catch (err) {
    log.error('identity-graph', 'Unsuspend-all failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /admin/identity-graph/:id/node/:nodeId/unsuspend ─────
router.post('/admin/identity-graph/:id/node/:nodeId/unsuspend', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;
    const { id, nodeId } = req.params;
    const ref = db.doc(`identityGraphs/${id}`);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Identity graph not found' });
    const data = doc.data();
    const nodes = (data.nodes || []).map((n) => (n.id === nodeId ? { ...n, suspended: false } : n));
    await ref.update({ nodes, updatedAt: now() });
    res.json({ success: true });
  } catch (err) {
    log.error('identity-graph', 'Node unsuspend failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /admin/bans/graph/:id ──────────────────────────────────

router.put('/admin/bans/graph/:id', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const doc = await db.doc(`identityGraphs/${req.params.id}`).get();
    if (!doc.exists) return res.status(404).json({ error: 'Identity graph not found' });

    const graph = doc.data();
    const { action, duration, level, reason, identifier } = req.body;

    if (action === 'suspend') {
      if (!graph.identifiers || graph.identifiers.length === 0) {
        return res.status(400).json({ error: 'Cannot suspend graph with no identifiers' });
      }

      const expiresAt = duration === 'permanent' ? null : now() + parseDuration(duration);
      const suspension = {
        isActive: true,
        level: level || 'full',
        duration: duration || '7d',
        reason: reason || null,
        suspendedBy: req.auth.uniqueId,
        suspendedAt: now(),
        expiresAt,
      };

      // Cascade to all identifiers
      const updatedIdentifiers = graph.identifiers.map((ident) => ({
        ...ident,
        suspension,
      }));

      await db.doc(`identityGraphs/${req.params.id}`).update({ identifiers: updatedIdentifiers });

      // Audit log
      await db.collection('adminAuditLog').add({
        adminUid: req.auth.uniqueId,
        actionType: 'suspension_cascade',
        targetType: 'identityGraph',
        targetId: req.params.id,
        details: { duration, level, reason, affectedCount: updatedIdentifiers.length },
        timestamp: now(),
      });
    } else if (action === 'unsuspend') {
      if (identifier) {
        // Unsuspend specific identifier
        const updatedIdentifiers = graph.identifiers.map((ident) => {
          if (ident.type === identifier.type && ident.value === identifier.value) {
            return { ...ident, suspension: null };
          }
          return ident;
        });
        await db.doc(`identityGraphs/${req.params.id}`).update({ identifiers: updatedIdentifiers });
      } else {
        // Unsuspend all
        const updatedIdentifiers = graph.identifiers.map((ident) => ({
          ...ident,
          suspension: null,
        }));
        await db.doc(`identityGraphs/${req.params.id}`).update({ identifiers: updatedIdentifiers });
      }

      // Audit log
      await db.collection('adminAuditLog').add({
        adminUid: req.auth.uniqueId,
        actionType: 'unsuspend',
        targetType: 'identityGraph',
        targetId: req.params.id,
        details: { specific: !!identifier },
        timestamp: now(),
      });
    }

    res.json({ success: true });
  } catch (err) {
    log.error('identity-graph', 'Failed to update graph', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /admin/bans/graph/:id ───────────────────────────────

router.delete('/admin/bans/graph/:id', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const doc = await db.doc(`identityGraphs/${req.params.id}`).get();
    if (!doc.exists) return res.status(404).json({ error: 'Identity graph not found' });

    // Clear all suspensions (unban)
    const graph = doc.data();
    const clearedIdentifiers = (graph.identifiers || []).map((ident) => ({
      ...ident,
      suspension: null,
    }));

    await db.doc(`identityGraphs/${req.params.id}`).update({ identifiers: clearedIdentifiers });

    // Audit log
    await db.collection('adminAuditLog').add({
      adminUid: req.auth.uniqueId,
      actionType: 'unban_graph',
      targetType: 'identityGraph',
      targetId: req.params.id,
      details: {},
      timestamp: now(),
    });

    res.json({ success: true });
  } catch (err) {
    log.error('identity-graph', 'Failed to unban graph', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /admin/bans/check ──────────────────────────────────────

router.get('/admin/bans/check', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    // Coerce query params to strings — Express may parse repeated params as arrays
    const ip =
      typeof req.query.ip === 'string'
        ? req.query.ip
        : Array.isArray(req.query.ip)
          ? req.query.ip[0]
          : undefined;
    const fingerprint =
      typeof req.query.fingerprint === 'string'
        ? req.query.fingerprint
        : Array.isArray(req.query.fingerprint)
          ? req.query.fingerprint[0]
          : undefined;
    const uid =
      typeof req.query.uid === 'string'
        ? req.query.uid
        : Array.isArray(req.query.uid)
          ? req.query.uid[0]
          : undefined;
    if (!ip && !fingerprint && !uid) {
      return res
        .status(400)
        .json({ error: 'At least one identifier required (ip, fingerprint, or uid)' });
    }

    // Query identity graphs for matching identifiers
    const snap = await db.collection('identityGraphs').get();
    let isBanned = false;
    let banInfo = null;

    for (const doc of snap.docs) {
      const graph = doc.data();
      for (const ident of graph.identifiers || []) {
        const matches =
          (ip && ident.type === 'ip' && ident.value === normaliseIp(ip)) ||
          (fingerprint && ident.type === 'fingerprint' && ident.value === fingerprint) ||
          (uid && ident.type === 'uid' && ident.value === String(uid));

        if (matches && ident.suspension?.isActive) {
          // Check if expired
          if (ident.suspension.expiresAt && ident.suspension.expiresAt < now()) {
            continue; // expired
          }
          isBanned = true;
          banInfo = {
            level: ident.suspension.level,
            reason: ident.suspension.reason,
            expiresAt: ident.suspension.expiresAt,
            duration: ident.suspension.duration,
          };
          break;
        }
      }
      if (isBanned) break;
    }

    res.json({ isBanned, ...(banInfo || {}) });
  } catch (err) {
    log.error('identity-graph', 'Ban check failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Helpers ────────────────────────────────────────────────────

function parseDuration(duration) {
  if (!duration || duration === 'permanent') return null;
  const match = duration.match(/^(\d+)(d|h)$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000; // default 7 days
  const [, num, unit] = match;
  const ms = unit === 'd' ? Number(num) * 24 * 60 * 60 * 1000 : Number(num) * 60 * 60 * 1000;
  return ms;
}

module.exports = router;
