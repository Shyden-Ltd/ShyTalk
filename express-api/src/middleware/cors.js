const cors = require('cors');

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : ['https://shytalk.shyden.co.uk', 'https://api.shytalk.shyden.co.uk'];

module.exports = cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // Allow localhost in local/test mode (admin panel served locally)
    if (process.env.NODE_ENV === 'local' && /^http:\/\/localhost(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    // Allow Cloudflare Pages preview deployments (subdomain.pages.dev)
    if (
      /^https:\/\/[a-z0-9][a-z0-9-]*\.shytalk-site-dev\.pages\.dev$/.test(origin) ||
      /^https:\/\/[a-z0-9][a-z0-9-]*\.shytalk-site\.pages\.dev$/.test(origin)
    ) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'x-session-trace-id', 'x-device-id'],
});
