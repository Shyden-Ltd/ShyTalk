/**
 * Health check route.
 *
 * GET /health -> system health status
 */

const router = require('express').Router();

router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    subsystems: {
      suggestions: 'ok',
      notifications: 'ok',
      identityGraph: 'ok',
    },
  });
});

module.exports = router;
