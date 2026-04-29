#!/usr/bin/env node
/**
 * Ensure every internal TestFlight beta group has auto-distribution enabled.
 *
 * After PR #372 restored TestFlight uploads, builds were arriving in App
 * Store Connect but not reaching internal testers — the group's
 * "Enable automatic distribution" toggle was either off, or builds were
 * stuck in "Missing Compliance" (fixed in fix/ios-encryption-compliance).
 *
 * Run as a CI step after `xcrun altool --upload-app` succeeds. Idempotent —
 * if a group already has hasAccessToAllBuilds=true, it logs and moves on.
 *
 * Required env:
 *   APP_STORE_CONNECT_KEY_ID — the API key ID (10-char string)
 *   APP_STORE_CONNECT_ISSUER_ID — the issuer ID (UUID)
 *   APP_STORE_CONNECT_KEY_PATH — path to the .p8 file (defaults to
 *     ~/private_keys/AuthKey_<KEY_ID>.p8 — same path setup-ios-signing
 *     writes to)
 *
 * Optional env:
 *   BUNDLE_ID — defaults to com.shyden.shytalk
 */

const crypto = require('node:crypto');
const fs = require('node:fs');

const KEY_ID = process.env.APP_STORE_CONNECT_KEY_ID;
const ISSUER_ID = process.env.APP_STORE_CONNECT_ISSUER_ID;
const KEY_PATH =
  process.env.APP_STORE_CONNECT_KEY_PATH ||
  `${process.env.HOME}/private_keys/AuthKey_${KEY_ID}.p8`;
const BUNDLE_ID = process.env.BUNDLE_ID || 'com.shyden.shytalk';

if (!KEY_ID || !ISSUER_ID) {
  console.error('::error::APP_STORE_CONNECT_KEY_ID and APP_STORE_CONNECT_ISSUER_ID required');
  process.exit(1);
}
if (!fs.existsSync(KEY_PATH)) {
  console.error(`::error::App Store Connect API key not found at ${KEY_PATH}`);
  process.exit(1);
}

function generateJwt() {
  const key = fs.readFileSync(KEY_PATH, 'utf8');
  const header = { alg: 'ES256', kid: KEY_ID, typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  // Apple rejects tokens with exp > 20 min in the future
  const payload = { iss: ISSUER_ID, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = crypto
    .createSign('SHA256')
    .update(signingInput)
    .sign({ key, dsaEncoding: 'ieee-p1363' })
    .toString('base64url');
  return `${signingInput}.${sig}`;
}

async function asc(method, path, body) {
  const jwt = generateJwt();
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ASC API ${method} ${path} → ${res.status}: ${text}`);
  }
  // 204 No Content on PATCH success
  if (res.status === 204) return null;
  return res.json();
}

(async () => {
  console.log(`Looking up app for bundle ID: ${BUNDLE_ID}`);
  const apps = await asc('GET', `/v1/apps?filter[bundleId]=${BUNDLE_ID}`);
  if (!apps.data || apps.data.length === 0) {
    console.error(`::error::No app found in App Store Connect with bundle ID ${BUNDLE_ID}`);
    process.exit(1);
  }
  const app = apps.data[0];
  console.log(`Found app "${app.attributes.name}" (id=${app.id})`);

  // Limit=200 is well above the ~5-20 groups any sane app has.
  const groups = await asc('GET', `/v1/apps/${app.id}/betaGroups?limit=200`);
  const internalGroups = (groups.data || []).filter((g) => g.attributes.isInternalGroup);
  if (internalGroups.length === 0) {
    console.warn('::warning::No internal beta groups found. Create one in App Store Connect → TestFlight → Internal Group.');
    return;
  }
  console.log(`Found ${internalGroups.length} internal group(s):`);

  let fixedCount = 0;
  for (const group of internalGroups) {
    const { id } = group;
    const { name, hasAccessToAllBuilds } = group.attributes;
    if (hasAccessToAllBuilds) {
      console.log(`  ✓ "${name}" — auto-distribution already on`);
      continue;
    }
    console.log(`  ⚠ "${name}" — auto-distribution OFF, enabling…`);
    await asc('PATCH', `/v1/betaGroups/${id}`, {
      data: {
        type: 'betaGroups',
        id,
        attributes: { hasAccessToAllBuilds: true },
      },
    });
    console.log(`  ✓ "${name}" — auto-distribution enabled`);
    fixedCount++;
  }
  if (fixedCount > 0) {
    console.log(`Enabled auto-distribution on ${fixedCount} group(s).`);
  } else {
    console.log('All internal groups already have auto-distribution enabled.');
  }
})().catch((err) => {
  console.error(`::error::${err.message}`);
  process.exit(1);
});
