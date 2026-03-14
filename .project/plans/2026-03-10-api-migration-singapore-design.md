# Express API Migration to Singapore — Design

**Date:** 2026-03-10
**Goal:** Move the Express API from Oracle Cloud London (uk-london-1) to Oracle Cloud Singapore (ap-singapore-1) to co-locate with Firebase (asia-southeast1) and reduce latency for the SE Asian user base.

## Problem

The Express API runs in London while Firebase (Firestore + RTDB) is in Singapore. Every API request incurs ~170ms round-trip latency to Firestore. Most users are in South/Southeast Asia, adding further distance.

## Solution

Lift-and-shift the Express API to an Oracle Cloud Always Free ARM VM in Singapore.

**Before:** Users (Asia) → Cloudflare → Express (London) → Firestore (Singapore) ← ~170ms RTT
**After:** Users (Asia) → Cloudflare → Express (Singapore) → Firestore (Singapore) ← ~2ms RTT

No code changes. The app hits `api.shytalk.shyden.co.uk` — we just update the DNS A record.

## Infrastructure

| Service | Current | Target |
|---------|---------|--------|
| Express API | Oracle London (VM.Standard.E2.1.Micro, 1 OCPU, 1GB) | Oracle Singapore (VM.Standard.A1.Flex, 4 OCPUs, 24GB) |
| Firestore | asia-southeast1 | No change |
| RTDB | asia-southeast1 | No change |
| R2 (images) | Cloudflare CDN (global) | No change |
| LiveKit | LiveKit Cloud (auto geo-routing) | No change |
| Pages (public/) | Cloudflare CDN (global) | No change |

## Migration Steps

### 1. Provision VM
- Oracle Cloud Console → Compute → Create Instance
- Shape: VM.Standard.A1.Flex (Always Free ARM)
- Region: ap-singapore-1
- Config: 4 OCPUs, 24GB RAM, 200GB boot volume
- OS: Ubuntu 22.04 aarch64
- Security list: ports 22, 80, 443

### 2. Bootstrap Server
- Node.js 20 LTS (ARM64), PM2, Caddy (auto HTTPS)
- 2GB swap, iptables firewall rules
- Caddyfile: `api.shytalk.shyden.co.uk` → `localhost:3000`

### 3. Deploy Express API
- Tar + scp the codebase (exclude node_modules)
- `npm install --production` on the ARM VM
- Copy `.env` and Firebase service account key
- Environment variables: PORT, Firebase SA path, R2 creds, LiveKit keys, ALLOWED_ORIGINS
- `pm2 start ecosystem.config.js && pm2 save && pm2 startup`

### 4. Test Before DNS Switch
- Test directly via Singapore IP
- Verify all routes respond correctly
- Verify cron jobs execute on schedule
- Compare response times vs London

### 5. Switch DNS
- Cloudflare DNS → change A record for `api.shytalk.shyden.co.uk` to Singapore IP
- Cloudflare proxy ON → instant propagation
- No app update required

### 6. Verify Production
- Test on real device (rooms, chat, gifts, economy)
- Monitor PM2 logs for errors
- Confirm all 7 cron jobs fire correctly

### 7. Decommission London
- Keep London running 48h as rollback target
- Then stop PM2 and terminate the instance
- Update MEMORY.md with new VM IP and SSH details

## Risk Mitigation

- **Rollback:** London VM stays live for 48h. If issues arise, flip DNS back in seconds.
- **Zero downtime:** Cloudflare proxied DNS changes propagate instantly.
- **ARM compatibility:** Node.js + all npm deps support ARM64 natively. No native addons that require x86.

## Cost

$0 — Oracle Cloud Always Free tier. ARM VMs (up to 4 OCPUs, 24GB RAM) are permanently free.

## Success Criteria

- API response times from Asia drop by 100-200ms
- All 7 cron jobs run correctly
- All 331 Express tests pass
- No client-side changes needed
