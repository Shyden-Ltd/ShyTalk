/**
 * Admin audit log routes.
 *
 * GET  /admin/audit-log        -> list entries, filterable and paginated
 * GET  /admin/audit-log/export -> CSV export
 */

const router = require('express').Router();
const { db } = require('../utils/firebase');
const log = require('../utils/log');

const { requireAdmin } = require('../middleware/auth'); // shared — live claim check

// ─── GET /admin/audit-log/export ────────────────────────────────

router.get('/admin/audit-log/export', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;

    const [auditSnap, adminSnap, modSnap] = await Promise.all([
      db.collection('auditLog').orderBy('timestamp', 'desc').get(),
      db.collection('adminAuditLog').orderBy('timestamp', 'desc').get(),
      db.collection('moderationLog').orderBy('timestamp', 'desc').get(),
    ]);
    const seen = new Set();
    const entries = [];
    for (const d of [...adminSnap.docs, ...auditSnap.docs, ...modSnap.docs]) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      entries.push(d.data());
    }
    entries.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

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
    if (await requireAdmin(req, res)) return;

    // Accept both canonical and shortened query param names so the admin
    // panel frontend (which uses `action`, `admin`, `target`, `start`, `end`)
    // and the test infra can both call this endpoint.
    const adminUid = req.query.adminUid || req.query.admin;
    const actionType = req.query.actionType || req.query.action;
    const targetType = req.query.targetType;
    const targetId = req.query.target;
    const from = req.query.from || req.query.start;
    const to = req.query.to || req.query.end;
    const page = parseInt(req.query.page, 10) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize, 10) || 50, 100);

    // Query all three audit collections so every admin action is visible
    // regardless of which collection it was written to:
    //   - auditLog: merge actions, legacy entries
    //   - adminAuditLog: canonical admin actions
    //   - moderationLog: suggestion approve/reject/overturn/edit actions
    const [auditSnap, adminSnap, modSnap] = await Promise.all([
      db.collection('auditLog').orderBy('timestamp', 'desc').get(),
      db.collection('adminAuditLog').orderBy('timestamp', 'desc').get(),
      db.collection('moderationLog').orderBy('timestamp', 'desc').get(),
    ]);
    const totalSize = Math.max(auditSnap.size || 0, adminSnap.size || 0, modSnap.size || 0);
    const seen = new Set();
    const merged = [];
    for (const d of [...adminSnap.docs, ...auditSnap.docs, ...modSnap.docs]) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      merged.push({ id: d.id, ...d.data() });
    }
    merged.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    let entries = merged;

    // Apply filters client-side (Firestore limitation with multiple inequalities).
    // Admin filter uses case-insensitive substring match across both
    // adminUid and adminName so searching for "admin" matches entries
    // with adminUid="admin1" or adminName="admin".
    if (adminUid) {
      const needle = adminUid.toLowerCase();
      entries = entries.filter(
        (e) =>
          String(e.adminUid || '')
            .toLowerCase()
            .includes(needle) ||
          String(e.adminName || '')
            .toLowerCase()
            .includes(needle),
      );
    }
    if (actionType) {
      // Match either the exact action or any action whose last segment
      // matches (e.g. "suggestion_approve" matches "approve" filter).
      entries = entries.filter((e) => {
        const act = e.actionType || e.action || '';
        if (act === actionType) return true;
        const tail = act.split('_').pop();
        return tail === actionType;
      });
    }
    if (targetType) {
      entries = entries.filter((e) => e.targetType === targetType);
    }
    if (targetId) {
      // `target` query param is overloaded: the UI's filter dropdown can send
      // a target TYPE (e.g. "suggestion") or a specific target ID substring.
      // Match either: exact targetType OR substring id.
      entries = entries.filter(
        (e) =>
          e.targetType === targetId ||
          String(e.targetId || '').includes(targetId) ||
          String(e.target || '').includes(targetId),
      );
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
    const total = Math.max(totalSize, entries.length);
    const offset = (page - 1) * pageSize;
    const paged = entries.slice(offset, offset + pageSize);

    res.json({ entries: paged, total, page, pageSize });
  } catch (err) {
    log.error('audit-log', 'List failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
