require('dotenv').config({ quiet: true });
const express = require('express');
const helmet = require('helmet');
const corsMiddleware = require('./middleware/cors');
const { authMiddleware } = require('./middleware/auth');
const { generalLimiter, writeLimiter, sensitiveLimiter } = require('./middleware/rateLimit');
const { startCronJobs } = require('./cron');
require('./utils/firebase'); // Initialize Firebase before routes
const { patchConsole } = require('./utils/consoleLogger');

// Route all console.log/warn/error through structured logger
patchConsole();

// Catch unhandled promise rejections (e.g., fire-and-forget in cron jobs)
process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('Unhandled promise rejection:', reason);
});

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(corsMiddleware);
app.use(express.json({ limit: '1mb' }));

// Request/response logging (after body parsing, before auth)
const logger = require('./utils/loggerInstance');
const { createRequestLogger } = require('./middleware/requestLogger');
app.use(createRequestLogger(logger));

// Health check (no auth)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Auth routes (mounted BEFORE auth middleware — these handle their own auth)
app.use('/api', require('./routes/auth'));

// Auth middleware for all /api routes (except health, log-config, auth, and pre-auth endpoints)
app.use('/api', (req, res, next) => {
  if (
    req.path === '/health' ||
    req.path === '/log-config' ||
    req.path.startsWith('/auth/') ||
    (req.method === 'GET' && req.path === '/config/startingScreens') ||
    (req.path.startsWith('/test/') && process.env.NODE_ENV !== 'production')
  )
    return next();
  authMiddleware(req, res, next);
});

// General rate limit on all API routes
app.use('/api', generalLimiter);

// Stricter limits on write-heavy routes
app.use('/api/conversations', writeLimiter);
app.use('/api/economy/gacha', writeLimiter);
app.use('/api/economy/gift', writeLimiter);
app.use('/api/economy/gift-direct', writeLimiter);
app.use('/api/economy/gift-batch', writeLimiter);
app.use('/api/economy/backpack-send', writeLimiter);
app.use('/api/translate', writeLimiter);

// Strictest limits on sensitive operations
app.use('/api/economy/purchase', sensitiveLimiter);
app.use('/api/economy/trial-claim', sensitiveLimiter);
app.use('/api/economy/trial-activate', sensitiveLimiter);
app.use('/api/reports', sensitiveLimiter);
app.use('/api/appeals', sensitiveLimiter);
app.use('/api/users/:uniqueId/delete', sensitiveLimiter);
app.use('/api/users/:uniqueId/data-export', sensitiveLimiter);

// Mount route modules
app.use('/api', require('./routes/config'));
app.use('/api', require('./routes/users'));
app.use('/api', require('./routes/economy'));
app.use('/api', require('./routes/livekit'));
app.use('/api', require('./routes/reports'));
app.use('/api', require('./routes/notifications'));
app.use('/api', require('./routes/rooms'));
app.use('/api', require('./routes/data-export'));
app.use('/api', require('./routes/conversations'));
app.use('/api', require('./routes/banners'));
app.use('/api', require('./routes/fun-facts'));
app.use('/api', require('./routes/admin-users'));
app.use('/api', require('./routes/admin-economy'));
app.use('/api', require('./routes/admin-gifts'));
app.use('/api', require('./routes/admin-cleanup'));
app.use('/api', require('./routes/admin-backup'));
app.use('/api', require('./routes/admin-logs'));
app.use('/api', require('./routes/admin-log-config'));
app.use('/api', require('./routes/storage'));
app.use('/api', require('./routes/device-info'));
app.use('/api', require('./routes/admin-bans'));
app.use('/api', require('./routes/admin-devices'));
app.use('/api', require('./routes/admin-temp-id'));
app.use('/api', require('./routes/admin-alerts'));
app.use('/api', require('./routes/translate'));

const { createLogsRouter } = require('./routes/logs');
app.use('/api', createLogsRouter(logger));

// Dev-only routes
if (process.env.NODE_ENV !== 'production') {
  app.use('/api', require('./routes/test-helpers'));
  app.use('/api', require('./routes/admin-migrate'));
}

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, _next) => {
  logger.log({
    level: 'ERROR',
    source: 'server',
    message: 'Unhandled error',
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`ShyTalk API listening on port ${PORT}`);
  startCronJobs();
});
