/**
 * Admin audit log routes.
 *
 * GET  /admin/audit-log        -> list entries, filterable and paginated
 * GET  /admin/audit-log/export -> CSV export
 */

const router = require('express').Router();
const { db } = require('../utils/firebase');
const log = require('../utils/log');

function requireAdmin(req, res) {
  if (!req.auth?.token?.admin) {
    res.status(403).json({ error: 'Admin access required' });
    return true;
  }
  return false;
}

// ─── GET /admin/audit-log/export ────────────────────────────────

router.get('/admin/audit-log/export', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const snap = await db.collection('auditLog').orderBy('timestamp', 'desc').get();

    const entries = snap.docs.map((d) => d.data());

    const csv = ['adminUid,actionType,targetType,targetId,details,timestamp'];
    for (const e of entries) {
      csv.push(
        [
          e.adminUid || '',
          e.actionType || e.action || '',
          e.targetType || '',
          e.targetId || '',
          JSON.stringify(e.details || {}),
          e.timestamp || '',
        ].join(','),
      );
    }

    res.set('Content-Type', 'text/csv');
    res.set('Content-Disposition', 'attachment; filename=audit-log.csv');
    res.send(csv.join('\n'));
  } catch (err) {
    log.error('audit-log', 'Export failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /admin/audit-log ───────────────────────────────────────

router.get('/admin/audit-log', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const { adminUid, actionType, targetType, from, to } = req.query;
    const page = parseInt(req.query.page, 10) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize, 10) || 50, 100);

    const snap = await db.collection('auditLog').orderBy('timestamp', 'desc').get();

    let entries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Apply filters client-side (Firestore limitation with multiple inequalities)
    if (adminUid) {
      entries = entries.filter((e) => e.adminUid === adminUid);
    }
    if (actionType) {
      entries = entries.filter((e) => (e.actionType || e.action) === actionType);
    }
    if (targetType) {
      entries = entries.filter((e) => e.targetType === targetType);
    }
    if (from) {
      const fromTs = new Date(from).getTime();
      if (!isNaN(fromTs)) {
        entries = entries.filter((e) => (e.timestamp || 0) >= fromTs);
      }
    }
    if (to) {
      const toTs = new Date(to).getTime() + 86400000;
      if (!isNaN(toTs)) {
        entries = entries.filter((e) => (e.timestamp || 0) <= toTs);
      }
    }

    // Use snap.size for total when available (supports large collections
    // where not all docs are returned in the docs array)
    const total = Math.max(snap.size || 0, entries.length);
    const offset = (page - 1) * pageSize;
    const paged = entries.slice(offset, offset + pageSize);

    res.json({ entries: paged, total, page, pageSize });
  } catch (err) {
    log.error('audit-log', 'List failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
