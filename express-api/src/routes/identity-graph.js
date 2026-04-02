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

function requireAdmin(req, res) {
  if (!req.auth?.token?.admin) {
    res.status(403).json({ error: 'Admin access required' });
    return true;
  }
  return false;
}

function normaliseIp(ip) {
  if (!ip) return null;
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

    const { ip, fingerprint, uid } = req.query;
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
