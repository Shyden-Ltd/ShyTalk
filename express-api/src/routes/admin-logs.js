/**
 * Admin log query routes — query and trace logs stored in Firestore.
 *
 * GET /admin/logs            → Query logs with filters (admin only)
 * GET /admin/logs/trace/:traceId → Get all logs for a session trace (admin only)
 */

const router = require('express').Router();
const { db } = require('../utils/firebase');
const { requireAdmin } = require('../middleware/auth');
const log = require('../utils/log');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_TRACE_LIMIT = 500;

// GET /admin/logs — Query logs with filters
router.get('/admin/logs', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;
    const {
      level,
      source,
      userId,
      sessionTraceId,
      requestTraceId,
      route,
      keyword,
      startTime,
      endTime,
      cursor,
    } = req.query;

    let limit = Number.parseInt(req.query.limit, 10) || DEFAULT_LIMIT;
    if (limit < 1) limit = DEFAULT_LIMIT;
    if (limit > MAX_LIMIT) limit = MAX_LIMIT;

    let query = db.collection('logs').orderBy('timestamp', 'desc');

    // Apply Firestore .where() filters
    if (level) query = query.where('level', '==', level);
    if (source) query = query.where('source', '==', source);
    if (userId) query = query.where('userId', '==', userId);
    if (sessionTraceId) query = query.where('sessionTraceId', '==', sessionTraceId);
    if (requestTraceId) query = query.where('requestTraceId', '==', requestTraceId);

    // Time range filters
    if (startTime) query = query.where('timestamp', '>=', Number(startTime));
    if (endTime) query = query.where('timestamp', '<=', Number(endTime));

    // Pagination
    if (cursor) query = query.startAfter(Number(cursor));

    query = query.limit(limit);

    const snapshot = await query.get();

    let logs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    // Client-side filters (can't be compound-queried in Firestore)
    if (route) {
      logs = logs.filter((entry) => entry.context?.route === route || entry.route === route);
    }
    if (keyword) {
      const lowerKeyword = keyword.toLowerCase();
      logs = logs.filter(
        (entry) =>
          entry.message?.toLowerCase().includes(lowerKeyword) ||
          (entry.context && JSON.stringify(entry.context).toLowerCase().includes(lowerKeyword)),
      );
    }

    const nextCursor =
      snapshot.docs.length === limit ? snapshot.docs.at(-1).data().timestamp : null;

    res.json({ logs, nextCursor });
  } catch (err) {
    log.error('admin-logs', 'Error querying logs', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /admin/logs/trace/:traceId — Get all logs for a session trace
router.get('/admin/logs/trace/:traceId', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;
    const { traceId } = req.params;

    const snapshot = await db
      .collection('logs')
      .where('sessionTraceId', '==', traceId)
      .orderBy('timestamp', 'asc')
      .limit(MAX_TRACE_LIMIT)
      .get();

    const logs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    res.json({ logs });
  } catch (err) {
    log.error('admin-logs', 'Error querying trace logs', {
      traceId: req.params.traceId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
