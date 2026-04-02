# LiveKit Self-Hosting Migration — Design Spec

**Date:** 2026-03-25
**Saves:** $50/month ($600/year) — cancels LiveKit Cloud subscription

## Goal

Migrate from LiveKit Cloud (paid) to self-hosted LiveKit on Oracle Cloud Free Tier with multi-region support. Small code change in token endpoint to return server URL based on user region.

## Architecture

### Multi-Region Setup

| Region | VM | Domain | Purpose |
|--------|----|--------|---------|
| Singapore | New Oracle Cloud ARM VM | `livekit.shytalk.shyden.co.uk` | Primary — serves Southeast Asia |
| London | Existing dev VM (`145.241.224.13`) | `livekit-eu.shytalk.shyden.co.uk` | Secondary — serves Europe/Middle East. Also runs dev Express API. |

Users are routed to the nearest LiveKit server by the Express API based on IP geolocation.

### Dev Environment
- Dev Express API on London VM uses the London LiveKit instance (`livekit-eu.shytalk.shyden.co.uk`)
- Dev GitHub secret `LIVEKIT_URL` is no longer used for server connection — the API returns the URL dynamically

### Local Development
- No change — Docker container (`livekit/livekit-server:v1.9.1`) continues as-is

## Server-Side Region Routing

The Express API's `POST /api/livekit/token` endpoint currently returns only a JWT token. It will be modified to also return the LiveKit server URL based on the user's geographic region.

### Current response:
```json
{ "token": "eyJ..." }
```

### New response:
```json
{ "token": "eyJ...", "url": "wss://livekit.shytalk.shyden.co.uk" }
```

### Routing logic (in Express API):
```javascript
// Determine nearest LiveKit server from request IP
const LIVEKIT_REGIONS = {
  asia: process.env.LIVEKIT_URL_ASIA || 'wss://livekit.shytalk.shyden.co.uk',
  europe: process.env.LIVEKIT_URL_EU || 'wss://livekit-eu.shytalk.shyden.co.uk',
};

function getNearestLiveKitUrl(req) {
  // Use Cloudflare CF-IPCountry header if available, or IP geolocation
  const country = req.headers['cf-ipcountry'];
  const euCountries = ['GB', 'DE', 'FR', 'IT', 'ES', 'NL', 'SE', 'PL', 'TR', 'SA', 'AE', 'EG', 'QA', 'KW', 'BH', 'OM', 'JO', 'LB', 'IQ', 'IL', 'RU', 'UA', ...];
  if (country && euCountries.includes(country)) {
    return LIVEKIT_REGIONS.europe;
  }
  return LIVEKIT_REGIONS.asia; // default to Singapore
}
```

The API already sits behind Cloudflare (via Caddy), so the `CF-IPCountry` header is available on every request. No external geolocation service needed.

### Android app change:
`LiveKitTokenService.kt` — read `url` from the token response and pass it to `room.connect(url, token)` instead of using `BuildConfig.LIVEKIT_SERVER_URL`.

Fallback: if `url` is absent in the response (backwards compatibility), use `BuildConfig.LIVEKIT_SERVER_URL` as before.

### Local mode:
In local mode, the token endpoint returns `ws://localhost:7880` (or omits `url`), and the app falls back to `BuildConfig.LIVEKIT_SERVER_URL` which is `ws://10.0.2.2:7880`.

## Components Per Server

### LiveKit Server
- Binary: `livekit-server` (ARM64 Linux)
- Config: `/etc/livekit.yaml`
- Port: 7880 (WebSocket, behind Caddy)
- API keys: self-generated, unique per server

### coturn (TURN/STUN)
- Runs on same VM as LiveKit
- Handles NAT traversal for users behind firewalls (~10-15% of connections)
- Ports: 3478/UDP (STUN/TURN), 5349/TCP (TURN-over-TLS), 50000-50100/UDP (relay media)
- Integrated with LiveKit's built-in TURN config

### Caddy (Reverse Proxy)
- Proxies `wss://livekit[-eu].shytalk.shyden.co.uk` to LiveKit on localhost:7880
- Auto-provisions Let's Encrypt TLS certificates
- Already running on London dev VM; new install on Singapore VM

## Network / Firewall Rules

Open on each VM's Oracle Cloud security list:

| Port | Protocol | Purpose |
|------|----------|---------|
| 443 | TCP | Caddy HTTPS (WebSocket upgrade to LiveKit) |
| 7881 | TCP | LiveKit TURN/TLS |
| 3478 | UDP | coturn STUN/TURN |
| 5349 | TCP | coturn TURN-over-TLS |
| 50000-50100 | UDP | WebRTC media relay (coturn + LiveKit RTC) |

## LiveKit Configuration (`/etc/livekit.yaml`)

```yaml
port: 7880
rtc:
  port_range_start: 50000
  port_range_end: 50100
  use_external_ip: true
  # Fallback if Oracle Cloud IMDS metadata is unreachable:
  # node_ip: <static public IP of this VM>
  tcp_port: 7881
turn:
  enabled: true
  domain: livekit.shytalk.shyden.co.uk  # livekit-eu for London
  tls_port: 5349
  udp_port: 3478
  external_tls: true
keys:
  <generated-api-key>: <generated-api-secret>
logging:
  level: info
```

Note on `use_external_ip`: Oracle Cloud ARM VMs use 1:1 NAT (private 10.x.x.x mapped to public IP). LiveKit discovers the public IP via the instance metadata service (IMDS), which is accessible on OCI. If IMDS is unreachable for any reason, uncomment and set `node_ip` to the VM's static public IP.

## Caddy Configuration

### Singapore VM (new Caddyfile):
```
livekit.shytalk.shyden.co.uk {
    reverse_proxy localhost:7880
}
```

### London VM (add to existing Caddyfile):
```
livekit-eu.shytalk.shyden.co.uk {
    reverse_proxy localhost:7880
}
```

## DNS Records

Add to Cloudflare (**DNS-only, NOT proxied** -- Cloudflare breaks WebRTC):

| Record | Type | Value | Proxy |
|--------|------|-------|-------|
| `livekit.shytalk.shyden.co.uk` | A | <new Singapore VM IP> | DNS only |
| `livekit-eu.shytalk.shyden.co.uk` | A | 145.241.224.13 | DNS only |

**CRITICAL:** DNS records must be DNS-only (grey cloud in Cloudflare), NOT orange-cloud proxied. Cloudflare's HTTP proxy does not support WebSocket upgrade for WebRTC signaling.

## Configuration Changes

### Express API Code Change (small)
- `express-api/src/routes/livekit.js` -- add `url` to token response, add region routing function
- New env vars on each API server:
  - `LIVEKIT_URL_ASIA=wss://livekit.shytalk.shyden.co.uk`
  - `LIVEKIT_URL_EU=wss://livekit-eu.shytalk.shyden.co.uk`
- Each server also keeps `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` (now self-generated, matching the LiveKit server it talks to)

### Android App Code Change (small)
- `LiveKitTokenService.kt` -- read `url` from token response
- `LiveKitVoiceService.kt` -- use the returned URL for `room.connect()` instead of `BuildConfig.LIVEKIT_SERVER_URL`
- Fallback to `BuildConfig.LIVEKIT_SERVER_URL` if `url` is absent (backwards compat)

### Express API `.env` (per server)

**Prod API (Singapore):**
```env
LIVEKIT_API_KEY=<singapore-key>
LIVEKIT_API_SECRET=<singapore-secret>
LIVEKIT_URL_ASIA=wss://livekit.shytalk.shyden.co.uk
LIVEKIT_URL_EU=wss://livekit-eu.shytalk.shyden.co.uk
```

**Dev API (London):**
```env
LIVEKIT_API_KEY=<london-key>
LIVEKIT_API_SECRET=<london-secret>
LIVEKIT_URL_ASIA=wss://livekit.shytalk.shyden.co.uk
LIVEKIT_URL_EU=wss://livekit-eu.shytalk.shyden.co.uk
```

Note: Both API servers have both LiveKit URLs (for routing), but each server's API_KEY/SECRET matches its local LiveKit instance. Wait -- this is wrong. The API generates tokens, and the token must be signed with the key that matches the LiveKit server the user will connect to. Since the API routes users to different servers, it needs BOTH sets of keys:

**Corrected -- each API server needs:**
```env
LIVEKIT_KEY_ASIA=<singapore-key>
LIVEKIT_SECRET_ASIA=<singapore-secret>
LIVEKIT_KEY_EU=<london-key>
LIVEKIT_SECRET_EU=<london-secret>
LIVEKIT_URL_ASIA=wss://livekit.shytalk.shyden.co.uk
LIVEKIT_URL_EU=wss://livekit-eu.shytalk.shyden.co.uk
```

The token endpoint selects the region, then uses the matching key/secret pair to sign the token.

### GitHub Secrets
- `LIVEKIT_URL` -- keep for build-time fallback (set to Singapore as default). Used by `BuildConfig.LIVEKIT_SERVER_URL` for backwards compat only.
- Environment-scoped secrets are NOT a prerequisite since the app now gets the URL dynamically from the API.

### Local Development
- No changes. Token endpoint in local mode (`NODE_ENV=local`) returns `url: 'ws://localhost:7880'` or omits it.
- `BuildConfig.LIVEKIT_SERVER_URL` remains `ws://10.0.2.2:7880` for the local flavor.

### CI Workflows
- No changes. E2E tests use local Docker LiveKit. The `LIVEKIT_URL` secret is only used as a build-time fallback.

## Process Management

- **LiveKit:** systemd service (`livekit-server.service`)
- **coturn:** systemd service (`coturn.service`)
- **Express API:** PM2 (unchanged)
- **Caddy:** systemd service (already running on London; new on Singapore)

## Migration Steps

### Phase 1: London (Dev + EU Prod LiveKit)
1. Install LiveKit server binary on London VM
2. Install and configure coturn
3. Create `/etc/livekit.yaml` with London keys
4. Add Caddy rule for `livekit-eu.shytalk.shyden.co.uk`
5. Add DNS record (DNS-only)
6. Open firewall ports in Oracle Cloud security list
7. Start LiveKit + coturn as systemd services
8. Update Express API code (add `url` to token response, region routing)
9. Update Express API `.env` with all keys
10. Deploy and test voice rooms via dev app

### Phase 2: Singapore (Primary Prod LiveKit)
1. Provision new Oracle Cloud ARM VM in Singapore (new account if needed)
2. Install Caddy, LiveKit, coturn
3. Create `/etc/livekit.yaml` with Singapore keys
4. Add DNS record for `livekit.shytalk.shyden.co.uk`
5. Open firewall ports
6. Start services
7. Update prod Express API `.env` with all keys
8. Deploy prod app, test voice rooms from multiple regions
9. Verify TURN relay works (test from behind a corporate firewall)
10. Monitor for 2 weeks

### Phase 3: Cancel LiveKit Cloud
- **Only after 2 weeks of confirmed stability on self-hosted**
- Verify majority of active users have updated to builds with dynamic URL
- Revert `LIVEKIT_URL` GitHub secret to self-hosted Singapore URL (fallback for old builds)
- Cancel LiveKit Cloud subscription

## Rollback Plan

If self-hosted LiveKit has issues:
1. Revert Express API code to return only token (no `url` field)
2. Set `LIVEKIT_URL` GitHub secret back to LiveKit Cloud URL
3. Revert Express API `.env` to LiveKit Cloud keys
4. Restart Express API (`pm2 restart`)
5. New builds will use LiveKit Cloud again
6. Existing builds with dynamic URL will fail until updated -- this is why Phase 3 has a 2-week stability gate

**IMPORTANT:** Do NOT cancel LiveKit Cloud subscription until Phase 3 gate is passed. Keep it active as a fallback during the entire migration.

## Documentation Updates

### CLAUDE.md
- Update Environments section with LiveKit server URLs and SSH details for new prod VM
- Add LiveKit self-hosting details (server locations, keys per region)

### README.md + 19 Translations
- Update Tech Stack table: "LiveKit" -- note self-hosted on Oracle Cloud
- Update Environment Variables table with new `LIVEKIT_KEY_*` / `LIVEKIT_URL_*` vars

### express-api/.env.example
- Add `LIVEKIT_KEY_ASIA`, `LIVEKIT_SECRET_ASIA`, `LIVEKIT_URL_ASIA`
- Add `LIVEKIT_KEY_EU`, `LIVEKIT_SECRET_EU`, `LIVEKIT_URL_EU`
- Remove old single `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` (or keep as aliases)

### express-api/.env.local.example
- Keep `LIVEKIT_API_KEY=devkey` / `LIVEKIT_API_SECRET=devsecret` (local mode uses single key)

## Success Criteria

- Voice rooms work on both self-hosted servers (Singapore + London)
- Users are routed to the nearest server based on IP
- TURN relay works for users behind firewalls
- Latency is acceptable (<200ms round trip per region)
- 2 weeks stable before cancelling LiveKit Cloud
- $0/month ongoing cost

## Out of Scope

- Additional regions beyond Singapore + London (add based on user demand)
- LiveKit recording/egress features
- Load testing beyond basic functional verification
- coturn authentication (use LiveKit's built-in TURN integration)
