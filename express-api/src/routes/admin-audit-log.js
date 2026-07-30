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

// ─── Shared audit reads (SHY-0260) ──────────────────────────────
//
// Two defects lived in the reads below, and both were silent.
//
// 1. `orderBy('timestamp', 'desc')` EXCLUDES documents that lack the field.
//    Almost every writer records `createdAt` instead — admin-bans
//    BAN_DEVICE, admin-devices UNBIND_DEVICE, admin-gifts CREATE_GIFT,
//    users ACCOUNT_DELETION_SCHEDULED — so the audit surface returned only
//    the suggestions-maintenance rows. Measured locally: 200 documents in,
//    2 out. An endpoint that fails is visible; this one returned 200 OK
//    with a plausible, materially incomplete answer, so "was this user
//    banned?" answered "no evidence" while the evidence sat in the
//    collection.
//
// 2. The reads were unbounded. auditLog is append-only; at 62,112 rows the
//    query does not merely run slowly, it fails outright (grpc 2 UNKNOWN
//    after 24s).
//
// So each collection is read three bounded ways and merged: newest by
// `timestamp`, newest by `createdAt`, and an unordered page that catches
// documents carrying NEITHER field. An entry with an unusable timestamp is
// still evidence that something happened; dropping it is the same failure
// in miniature.

const AUDIT_READ_CAP = 1000;

/** Time an audit entry happened, whichever convention wrote it. */
function auditEntryTime(entry) {
  const t = entry?.timestamp ?? entry?.createdAt;
  return typeof t === 'number' ? t : 0;
}

/**
 * Read one audit collection completely enough to be honest about it.
 *
 * Returns { docs, truncated }. `truncated` is true when any of the three
 * bounded queries came back full, i.e. there may be older entries this
 * response does not carry — reported rather than implied-complete, so a
 * short list is never mistaken for a whole history.
 */
async function readAuditCollection(name, cap = AUDIT_READ_CAP) {
  const col = db.collection(name);
  const [byTimestamp, byCreatedAt, unordered] = await Promise.all([
    col.orderBy('timestamp', 'desc').limit(cap).get(),
    col.orderBy('createdAt', 'desc').limit(cap).get(),
    col.limit(cap).get(),
  ]);
  const byId = new Map();
  for (const snap of [byTimestamp, byCreatedAt, unordered]) {
    for (const d of snap.docs) if (!byId.has(d.id)) byId.set(d.id, d);
  }
  const truncated = [byTimestamp, byCreatedAt, unordered].some((s) => s.size >= cap);
  // The largest page any of the three queries saw. `total` drives the admin
  // UI's pager, so it must describe the COLLECTION, not the page that was
  // returned — reporting entries.length would tell a reviewer there is one
  // entry when there are five hundred.
  const collectionSize = Math.max(
    byTimestamp.size || 0,
    byCreatedAt.size || 0,
    unordered.size || 0,
  );
  return { docs: [...byId.values()], truncated, collectionSize };
}

/** Read every audit collection, merged, deduped, newest-first. */
async function readAllAuditCollections(cap = AUDIT_READ_CAP) {
  const names = ['adminAuditLog', 'auditLog', 'moderationLog'];
  const results = await Promise.all(names.map((n) => readAuditCollection(n, cap)));
  const seen = new Set();
  const entries = [];
  for (const { docs } of results) {
    for (const d of docs) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      entries.push({ ...d.data(), id: d.id });
    }
  }
  // Entries with no usable time sort last (time 0) rather than vanishing.
  entries.sort((a, b) => auditEntryTime(b) - auditEntryTime(a));
  const truncated = results.some((r) => r.truncated);
  const totalSize = Math.max(0, ...results.map((r) => r.collectionSize || 0));
  if (truncated) {
    log.warn('admin-audit-log', 'Audit read hit its cap — response is not the whole history', {
      cap,
      returned: entries.length,
    });
  }
  return { entries, truncated, totalSize };
}

// ─── GET /admin/audit-log/export ────────────────────────────────

router.get('/admin/audit-log/export', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;

    const { entries, truncated } = await readAllAuditCollections();
    if (truncated) res.set('X-Audit-Truncated', 'true');

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
    const { entries: merged, truncated, totalSize } = await readAllAuditCollections();
    if (truncated) res.set('X-Audit-Truncated', 'true');

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
        entries = entries.filter((e) => auditEntryTime(e) >= fromTs);
      }
    }
    if (to) {
      const toTs = new Date(to).getTime() + 86400000;
      if (!isNaN(toTs)) {
        entries = entries.filter((e) => auditEntryTime(e) <= toTs);
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

// Exported for tests: the cap and the merge are the whole correctness story
// here, and asserting them by grepping this file for `.limit(` is a check
// that any refactor can silently defeat (it did — a `col` local made the
// pattern match nothing, and the "no unbounded read" test passed vacuously).
module.exports.readAuditCollection = readAuditCollection;
module.exports.readAllAuditCollections = readAllAuditCollections;
module.exports.auditEntryTime = auditEntryTime;
module.exports.AUDIT_READ_CAP = AUDIT_READ_CAP;
