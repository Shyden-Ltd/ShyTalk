require('dotenv').config();
const express = require('express');
const corsMiddleware = require('./middleware/cors');
const { authMiddleware, optionalAuth } = require('./middleware/auth');
const { startCronJobs } = require('./cron');
const { db } = require('./utils/firebase');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(corsMiddleware);
app.use(express.json({ limit: '10mb' }));

// Health check (no auth)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Auth middleware for all /api routes (except health)
app.use('/api', (req, res, next) => {
  if (req.path === '/health') return next();
  authMiddleware(req, res, next);
});

// Mount route modules
app.use('/api', require('./routes/config'));
app.use('/api', require('./routes/users'));
app.use('/api', require('./routes/economy'));
app.use('/api', require('./routes/livekit'));
app.use('/api', require('./routes/reports'));
app.use('/api', require('./routes/notifications'));
app.use('/api', require('./routes/rooms'));
app.use('/api', require('./routes/conversations'));
app.use('/api', require('./routes/banners'));
app.use('/api', require('./routes/fun-facts'));
app.use('/api', require('./routes/admin-users'));
app.use('/api', require('./routes/admin-economy'));
app.use('/api', require('./routes/admin-gifts'));
app.use('/api', require('./routes/admin-cleanup'));
app.use('/api', require('./routes/admin-backup'));
app.use('/api', require('./routes/storage'));
app.use('/api', require('./routes/translate'));

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`ShyTalk API listening on port ${PORT}`);
  startCronJobs();
});
