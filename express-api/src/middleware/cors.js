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
  // SHY-0147 — the portal's MFA-remember cookie is httpOnly, and the portal is
  // a different ORIGIN from this API (shytalk.shyden.co.uk -> api.shytalk...),
  // so without this the browser silently discards the Set-Cookie and the
  // feature does nothing at all.
  //
  // This does NOT widen who may call the API. The origin check above is an
  // explicit allowlist and is unchanged; `credentials` only permits the
  // browser to attach cookies on requests from origins already allowed. It is
  // safe precisely BECAUSE the allowlist never contains `*` — the two are
  // mutually exclusive in the CORS spec, and a wildcard here would be rejected
  // by the browser rather than silently accepted.
  credentials: true,
});
