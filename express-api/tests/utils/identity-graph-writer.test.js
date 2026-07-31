/**
 * identity-graph-writer.test.js — SHY-0257
 *
 * The admin routes could always build an identity graph BY HAND; nothing ever
 * built one from real traffic, so the anti-abuse cascade had nothing to cascade
 * over. Sixteen specs sat as `test.todo` describing the missing half.
 *
 * The operator approved building it INCLUDING automatic suspension, on one
 * condition: a false link must be near-impossible. So the tests that matter
 * most here are the ones asserting what must NOT happen — a shared IP must not
 * link strangers, a colliding fingerprint must not suspend anybody, and a
 * device that looks like shared infrastructure must stop counting.
 *
 * Real Firestore emulator throughout: every claim is about which documents
 * exist and what they say after a write, which is exactly what a double would
 * simply agree with.
 */
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const { db } = require('../../src/utils/firebase');
const { assertEmulatorReachable } = require('../helpers/firebase-emulator');
const {
  SHARED_IDENTIFIER_ACCOUNT_THRESHOLD,
  identifierStrength,
  normaliseIp,
  isNonIdentifyingIp,
  canLinkAccounts,
  stricterSuspension,
  buildIdentifiers,
  recordSignIn,
} = require('../../src/utils/identity-graph-writer');

const RUN = `shy257-w${process.env.JEST_WORKER_ID || '0'}-${Date.now().toString(36)}`;
let seq = 0;
const createdGraphs = [];
const createdUsers = [];

function nextAccount() {
  seq += 1;
  const uid = `${RUN}-acct${seq}`;
  createdUsers.push(uid);
  return uid;
}

function nextDevice() {
  seq += 1;
  return `${RUN}-device${seq}`;
}

async function graphsForRun() {
  const snap = await db.collection('identityGraphs').get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter(
      (g) =>
        String(g.graphId || g.id).includes(RUN) ||
        (g.linkedAccountUids || []).some((u) => String(u).includes(RUN)),
    );
}

async function trackGraph(graphId) {
  if (graphId && !createdGraphs.includes(graphId)) createdGraphs.push(graphId);
}

async function auditEntriesOfType(actionType) {
  const snap = await db.collection('adminAuditLog').where('actionType', '==', actionType).get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((e) => JSON.stringify(e.details || {}).includes(RUN));
}

beforeAll(async () => {
  await assertEmulatorReachable();
});

afterEach(async () => {
  const graphs = await graphsForRun();
  await Promise.all(graphs.map((g) => db.doc(`identityGraphs/${g.graphId || g.id}`).delete()));
  await Promise.all(createdUsers.map((u) => db.doc(`users/${u}`).delete()));
  for (const type of ['identity_multi_account_detected', 'identity_cascade_suspension']) {
    const entries = await auditEntriesOfType(type);
    await Promise.all(entries.map((e) => db.doc(`adminAuditLog/${e.id}`).delete()));
  }
  createdGraphs.length = 0;
  createdUsers.length = 0;
});

afterAll(() => {
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

// ═══════════════════════════════════════════════════════════════
// Identifier grading — the safeguard everything else rests on
// ═══════════════════════════════════════════════════════════════

describe('how much an identifier is allowed to prove', () => {
  test('a device id is STRONG; an IP and a fingerprint are not', () => {
    expect(identifierStrength('device')).toBe('strong');
    expect(identifierStrength('ip')).toBe('weak');
    expect(identifierStrength('fingerprint')).toBe('weak');
  });

  test('an unknown identifier type is treated as weak, never strong', () => {
    // Fail-safe direction: a new identifier type added later must not silently
    // gain the power to suspend people before anyone decides it should.
    expect(identifierStrength('retina-scan')).toBe('weak');
    expect(identifierStrength(undefined)).toBe('weak');
  });

  test('only a strong, non-shared identifier may link accounts', () => {
    expect(canLinkAccounts({ type: 'device', shared: false })).toBe(true);
    expect(canLinkAccounts({ type: 'device', shared: true })).toBe(false);
    expect(canLinkAccounts({ type: 'ip', shared: false })).toBe(false);
    expect(canLinkAccounts({ type: 'fingerprint', shared: false })).toBe(false);
    expect(canLinkAccounts(null)).toBe(false);
  });
});

describe('addresses that identify nobody are never stored', () => {
  test.each([
    ['10.0.0.5', 'RFC1918'],
    ['192.168.1.1', 'home router'],
    ['172.16.0.1', 'RFC1918'],
    ['172.31.255.1', 'RFC1918 upper bound'],
    ['127.0.0.1', 'loopback'],
    ['169.254.1.1', 'link-local'],
    ['::1', 'IPv6 loopback'],
    ['fe80::1', 'IPv6 link-local'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['100.127.255.255', 'CGNAT upper bound'],
  ])('%s (%s) is rejected', (ip) => {
    expect(isNonIdentifyingIp(ip)).toBe(true);
  });

  test('a normal public address IS storable', () => {
    expect(isNonIdentifyingIp('81.2.69.142')).toBe(false);
    expect(isNonIdentifyingIp('172.32.0.1')).toBe(false); // just outside RFC1918
    expect(isNonIdentifyingIp('100.128.0.1')).toBe(false); // just outside CGNAT
  });

  test('carrier-grade NAT is excluded, which is the whole point', () => {
    // 100.64/10 is an entire mobile network behind one address. Storing it
    // would file thousands of unrelated people under one identifier — the most
    // efficient way to manufacture false links at scale.
    expect(isNonIdentifyingIp('100.64.0.1')).toBe(true);
    expect(isNonIdentifyingIp('100.100.50.7')).toBe(true);
  });

  test('an IPv4-mapped IPv6 address collapses to one spelling', () => {
    expect(normaliseIp('::ffff:81.2.69.142')).toBe('81.2.69.142');
    expect(normaliseIp('  81.2.69.142  ')).toBe('81.2.69.142');
    expect(normaliseIp('')).toBeNull();
    expect(normaliseIp(null)).toBeNull();
  });

  test('a private IP is dropped from a sign-in, but the rest is kept', () => {
    const built = buildIdentifiers(
      { ip: '192.168.1.5', deviceId: 'dev-1', fingerprint: 'fp-1' },
      1000,
    );
    expect(built.map((i) => i.type).sort()).toEqual(['device', 'fingerprint']);
  });
});

// ═══════════════════════════════════════════════════════════════
// Binding identifiers at sign-in
// ═══════════════════════════════════════════════════════════════

describe('binding a sign-in to the graph', () => {
  test('a sign-in from the app binds IP, network info and device id', async () => {
    const uid = nextAccount();
    const device = nextDevice();

    const res = await recordSignIn({
      uniqueId: uid,
      ip: '81.2.69.142',
      deviceId: device,
      isp: 'Example ISP',
      country: 'GB',
    });
    await trackGraph(res.graphId);

    const doc = await db.doc(`identityGraphs/${res.graphId}`).get();
    const graph = doc.data();
    expect(graph.linkedAccountUids).toEqual([uid]);

    const ipIdent = graph.identifiers.find((i) => i.type === 'ip');
    expect(ipIdent.value).toBe('81.2.69.142');
    expect(ipIdent.metadata.isp).toBe('Example ISP');
    expect(ipIdent.metadata.country).toBe('GB');
    expect(graph.identifiers.find((i) => i.type === 'device').value).toBe(device);
  });

  test('a sign-in from the web binds IP, network info and browser fingerprint', async () => {
    const uid = nextAccount();

    const res = await recordSignIn({
      uniqueId: uid,
      ip: '81.2.69.143',
      fingerprint: `${RUN}-fp-web`,
      isp: 'Example ISP',
      country: 'GB',
    });
    await trackGraph(res.graphId);

    const graph = (await db.doc(`identityGraphs/${res.graphId}`).get()).data();
    expect(graph.identifiers.map((i) => i.type).sort()).toEqual(['fingerprint', 'ip']);
  });

  test('a later sign-in from a NEW IP adds it to the same graph', async () => {
    const uid = nextAccount();
    const device = nextDevice();

    const first = await recordSignIn({ uniqueId: uid, ip: '81.2.69.144', deviceId: device });
    await trackGraph(first.graphId);
    const second = await recordSignIn({ uniqueId: uid, ip: '81.2.69.145', deviceId: device });

    expect(second.graphId).toBe(first.graphId);
    const graph = (await db.doc(`identityGraphs/${first.graphId}`).get()).data();
    const ips = graph.identifiers
      .filter((i) => i.type === 'ip')
      .map((i) => i.value)
      .sort();
    expect(ips).toEqual(['81.2.69.144', '81.2.69.145']);
  });

  test('a later sign-in from a NEW device adds it to the same graph', async () => {
    const uid = nextAccount();
    const deviceA = nextDevice();
    const deviceB = nextDevice();

    const first = await recordSignIn({ uniqueId: uid, ip: '81.2.69.146', deviceId: deviceA });
    await trackGraph(first.graphId);
    const second = await recordSignIn({ uniqueId: uid, ip: '81.2.69.146', deviceId: deviceB });

    expect(second.graphId).toBe(first.graphId);
    const graph = (await db.doc(`identityGraphs/${first.graphId}`).get()).data();
    const devices = graph.identifiers.filter((i) => i.type === 'device').map((i) => i.value);
    expect(devices.sort()).toEqual([deviceA, deviceB].sort());
  });

  test('re-signing in with the same details does not duplicate identifiers', async () => {
    const uid = nextAccount();
    const device = nextDevice();

    const first = await recordSignIn({ uniqueId: uid, ip: '81.2.69.147', deviceId: device });
    await trackGraph(first.graphId);
    const second = await recordSignIn({ uniqueId: uid, ip: '81.2.69.147', deviceId: device });

    expect(second.identifiersAdded).toBe(0);
    const graph = (await db.doc(`identityGraphs/${first.graphId}`).get()).data();
    expect(graph.identifiers).toHaveLength(2);
  });

  test('a sign-in with nothing identifying writes no graph at all', async () => {
    // A private IP and no device is not evidence of anything. Creating an empty
    // graph would be noise that later merges could latch onto.
    const uid = nextAccount();
    const res = await recordSignIn({ uniqueId: uid, ip: '10.0.0.9' });
    expect(res.graphId).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// Network enrichment failures
// ═══════════════════════════════════════════════════════════════

describe('when the ISP lookup does not answer', () => {
  test('a timeout still records the IP, with ISP and country null', async () => {
    const uid = nextAccount();
    const res = await recordSignIn({
      uniqueId: uid,
      ip: '81.2.69.148',
      deviceId: nextDevice(),
      isp: null,
      country: null,
    });
    await trackGraph(res.graphId);

    const graph = (await db.doc(`identityGraphs/${res.graphId}`).get()).data();
    const ipIdent = graph.identifiers.find((i) => i.type === 'ip');
    expect(ipIdent.value).toBe('81.2.69.148');
    expect(ipIdent.metadata.isp).toBeNull();
    expect(ipIdent.metadata.country).toBeNull();
  });

  test('an omitted lookup falls back to IP-only rather than dropping the IP', async () => {
    // An address with unknown provenance is more useful than no address.
    const uid = nextAccount();
    const res = await recordSignIn({ uniqueId: uid, ip: '81.2.69.149', deviceId: nextDevice() });
    await trackGraph(res.graphId);

    const graph = (await db.doc(`identityGraphs/${res.graphId}`).get()).data();
    expect(graph.identifiers.find((i) => i.type === 'ip').metadata).toEqual({
      isp: null,
      country: null,
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// Linking — and, more importantly, NOT linking
// ═══════════════════════════════════════════════════════════════

describe('what links two accounts together', () => {
  test('two accounts sharing a device are linked and flagged', async () => {
    const a = nextAccount();
    const b = nextAccount();
    const device = nextDevice();

    const first = await recordSignIn({ uniqueId: a, ip: '81.2.69.150', deviceId: device });
    await trackGraph(first.graphId);
    const second = await recordSignIn({ uniqueId: b, ip: '81.2.69.151', deviceId: device });

    expect(second.graphId).toBe(first.graphId);
    expect(second.multiAccountDetected).toBe(true);
    const graph = (await db.doc(`identityGraphs/${first.graphId}`).get()).data();
    expect(graph.linkedAccountUids.sort()).toEqual([a, b].sort());
    expect(graph.multiAccountDetected).toBe(true);
  });

  test('three accounts sharing a device all land in one graph', async () => {
    const [a, b, c] = [nextAccount(), nextAccount(), nextAccount()];
    const device = nextDevice();

    const first = await recordSignIn({ uniqueId: a, deviceId: device, ip: '81.2.69.152' });
    await trackGraph(first.graphId);
    await recordSignIn({ uniqueId: b, deviceId: device, ip: '81.2.69.153' });
    const third = await recordSignIn({ uniqueId: c, deviceId: device, ip: '81.2.69.154' });

    const graph = (await db.doc(`identityGraphs/${third.graphId}`).get()).data();
    expect(graph.linkedAccountUids.sort()).toEqual([a, b, c].sort());
  });

  test('a SHARED IP does NOT link two strangers', async () => {
    // The single most important assertion in this file. Carrier NAT, schools,
    // offices and cafés put unrelated people on one address; linking on it
    // would mislink strangers constantly and then suspend them.
    const a = nextAccount();
    const b = nextAccount();
    const sharedIp = '81.2.69.155';

    const first = await recordSignIn({ uniqueId: a, ip: sharedIp, deviceId: nextDevice() });
    await trackGraph(first.graphId);
    const second = await recordSignIn({ uniqueId: b, ip: sharedIp, deviceId: nextDevice() });
    await trackGraph(second.graphId);

    expect(second.graphId).not.toBe(first.graphId);
    expect(second.multiAccountDetected).toBe(false);
  });

  test('a COLLIDING fingerprint does NOT link two strangers', async () => {
    // The original spec said "fingerprint collision: two devices same
    // fingerprint → both in same graph" — which, taken literally, specifies a
    // false link. Fingerprints collide by construction (same model, same
    // browser, same settings), so they are recorded and never load-bearing.
    const a = nextAccount();
    const b = nextAccount();
    const sharedFp = `${RUN}-colliding-fp`;

    const first = await recordSignIn({ uniqueId: a, ip: '81.2.69.156', fingerprint: sharedFp });
    await trackGraph(first.graphId);
    const second = await recordSignIn({ uniqueId: b, ip: '81.2.69.157', fingerprint: sharedFp });
    await trackGraph(second.graphId);

    expect(second.graphId).not.toBe(first.graphId);
  });

  test('one account signing in from many places stays ONE graph', async () => {
    const uid = nextAccount();
    const device = nextDevice();
    const first = await recordSignIn({ uniqueId: uid, ip: '81.2.69.158', deviceId: device });
    await trackGraph(first.graphId);
    await recordSignIn({ uniqueId: uid, ip: '81.2.69.159', deviceId: device });
    const third = await recordSignIn({ uniqueId: uid, ip: '81.2.69.160', deviceId: device });

    expect(third.graphId).toBe(first.graphId);
    const graph = (await db.doc(`identityGraphs/${first.graphId}`).get()).data();
    expect(graph.multiAccountDetected).toBeFalsy();
  });
});

describe('an identifier that starts looking like infrastructure', () => {
  test(`a device seen by more than ${SHARED_IDENTIFIER_ACCOUNT_THRESHOLD} accounts is marked shared`, async () => {
    // A device used by that many accounts is far likelier to be a family
    // tablet, a demo phone or an office machine than a ban-evader's.
    const device = nextDevice();
    let last;
    for (let i = 0; i <= SHARED_IDENTIFIER_ACCOUNT_THRESHOLD; i++) {
      last = await recordSignIn({ uniqueId: nextAccount(), deviceId: device, ip: '81.2.69.161' });
      await trackGraph(last.graphId);
    }

    const graph = (await db.doc(`identityGraphs/${last.graphId}`).get()).data();
    expect(graph.sharedInfrastructureSuspected).toBe(true);
    expect(graph.identifiers.every((i) => i.shared === true)).toBe(true);
  });

  test('a shared identifier stops linking new accounts in', async () => {
    // Once demoted it confers nothing, so the next person to use that office
    // machine is not swept into the existing graph.
    const device = nextDevice();
    let last;
    for (let i = 0; i <= SHARED_IDENTIFIER_ACCOUNT_THRESHOLD; i++) {
      last = await recordSignIn({ uniqueId: nextAccount(), deviceId: device, ip: '81.2.69.162' });
      await trackGraph(last.graphId);
    }

    const newcomer = await recordSignIn({
      uniqueId: nextAccount(),
      deviceId: device,
      ip: '81.2.69.163',
    });
    await trackGraph(newcomer.graphId);

    expect(newcomer.graphId).not.toBe(last.graphId);
  });
});

// ═══════════════════════════════════════════════════════════════
// Merging
// ═══════════════════════════════════════════════════════════════

describe('merging graphs that turn out to be one identity', () => {
  test('two graphs sharing a newly-presented device merge into one', async () => {
    const a = nextAccount();
    const b = nextAccount();
    const deviceA = nextDevice();
    const deviceB = nextDevice();

    const g1 = await recordSignIn({ uniqueId: a, deviceId: deviceA, ip: '81.2.69.164' });
    await trackGraph(g1.graphId);
    const g2 = await recordSignIn({ uniqueId: b, deviceId: deviceB, ip: '81.2.69.165' });
    await trackGraph(g2.graphId);
    expect(g2.graphId).not.toBe(g1.graphId);

    // `a` now signs in on `b`'s device — the two records are one person.
    const merged = await recordSignIn({ uniqueId: a, deviceId: deviceB, ip: '81.2.69.166' });
    await trackGraph(merged.graphId);

    expect(merged.merged).toBeGreaterThanOrEqual(1);
    const graph = (await db.doc(`identityGraphs/${merged.graphId}`).get()).data();
    expect(graph.linkedAccountUids.sort()).toEqual([a, b].sort());
  });

  test('a merged graph inherits the STRICTER suspension level', async () => {
    // A merge must never launder a ban into a milder state.
    expect(stricterSuspension('none', 'banned')).toBe('banned');
    expect(stricterSuspension('banned', 'warned')).toBe('banned');
    expect(stricterSuspension('warned', 'suspended')).toBe('suspended');
    expect(stricterSuspension('suspended', 'suspended')).toBe('suspended');
    expect(stricterSuspension(undefined, undefined)).toBe('none');
  });

  test('the stricter level survives a real merge', async () => {
    const a = nextAccount();
    const b = nextAccount();
    const deviceA = nextDevice();
    const deviceB = nextDevice();

    const g1 = await recordSignIn({ uniqueId: a, deviceId: deviceA, ip: '81.2.69.167' });
    await trackGraph(g1.graphId);
    await db
      .doc(`identityGraphs/${g1.graphId}`)
      .set({ suspensionLevel: 'banned' }, { merge: true });

    const g2 = await recordSignIn({ uniqueId: b, deviceId: deviceB, ip: '81.2.69.168' });
    await trackGraph(g2.graphId);

    const merged = await recordSignIn({ uniqueId: b, deviceId: deviceA, ip: '81.2.69.169' });
    await trackGraph(merged.graphId);

    const graph = (await db.doc(`identityGraphs/${merged.graphId}`).get()).data();
    expect(graph.suspensionLevel).toBe('banned');
  });
});

// ═══════════════════════════════════════════════════════════════
// The cascade — the part that can cost somebody their account
// ═══════════════════════════════════════════════════════════════

describe('suspension cascades', () => {
  async function suspendDeviceOnGraph(graphId, device, level = 'suspended') {
    const doc = await db.doc(`identityGraphs/${graphId}`).get();
    const graph = doc.data();
    graph.identifiers = graph.identifiers.map((i) =>
      i.type === 'device' && i.value === device ? { ...i, suspension: level } : i,
    );
    await db.doc(`identityGraphs/${graphId}`).set(graph);
  }

  test('a suspended device suspends the accounts that share it', async () => {
    const a = nextAccount();
    const b = nextAccount();
    const device = nextDevice();

    const g = await recordSignIn({ uniqueId: a, deviceId: device, ip: '81.2.69.170' });
    await trackGraph(g.graphId);
    await recordSignIn({ uniqueId: b, deviceId: device, ip: '81.2.69.171' });
    await suspendDeviceOnGraph(g.graphId, device);

    const res = await recordSignIn({ uniqueId: b, deviceId: device, ip: '81.2.69.172' });

    expect(res.cascadedAccounts.sort()).toEqual([a, b].sort());
    const userA = (await db.doc(`users/${a}`).get()).data();
    expect(userA.isSuspended).toBe(true);
    expect(userA.suspensionSource).toBe('identity-graph-cascade');
  });

  test('a new IP used with a suspended device is added AND the account cascaded', async () => {
    const a = nextAccount();
    const device = nextDevice();
    const g = await recordSignIn({ uniqueId: a, deviceId: device, ip: '81.2.69.173' });
    await trackGraph(g.graphId);
    await suspendDeviceOnGraph(g.graphId, device);

    const res = await recordSignIn({ uniqueId: a, deviceId: device, ip: '81.2.69.174' });

    const graph = (await db.doc(`identityGraphs/${g.graphId}`).get()).data();
    expect(graph.identifiers.some((i) => i.type === 'ip' && i.value === '81.2.69.174')).toBe(true);
    expect(res.cascadedAccounts).toContain(a);
  });

  test('a suspended NETWORK does NOT suspend anybody', async () => {
    // The asymmetry that keeps innocent people out of this. An IP is context;
    // it can be recorded as suspended and still must not cost anyone access,
    // because thousands of unrelated people can sit behind it.
    const a = nextAccount();
    const device = nextDevice();
    const g = await recordSignIn({ uniqueId: a, deviceId: device, ip: '81.2.69.175' });
    await trackGraph(g.graphId);

    const doc = await db.doc(`identityGraphs/${g.graphId}`).get();
    const graph = doc.data();
    graph.identifiers = graph.identifiers.map((i) =>
      i.type === 'ip' ? { ...i, suspension: 'banned' } : i,
    );
    await db.doc(`identityGraphs/${g.graphId}`).set(graph);

    const res = await recordSignIn({ uniqueId: a, deviceId: device, ip: '81.2.69.176' });

    expect(res.cascadedAccounts).toEqual([]);
    expect((await db.doc(`users/${a}`).get()).exists).toBe(false);
  });

  test('a suspended SHARED device does not cascade', async () => {
    // Once a device is demoted to infrastructure it can no longer take anyone's
    // account, even if it is itself suspended.
    const device = nextDevice();
    let last;
    for (let i = 0; i <= SHARED_IDENTIFIER_ACCOUNT_THRESHOLD; i++) {
      last = await recordSignIn({ uniqueId: nextAccount(), deviceId: device, ip: '81.2.69.177' });
      await trackGraph(last.graphId);
    }
    await suspendDeviceOnGraph(last.graphId, device);

    const victim = nextAccount();
    const res = await recordSignIn({ uniqueId: victim, deviceId: device, ip: '81.2.69.178' });
    await trackGraph(res.graphId);

    expect(res.cascadedAccounts).toEqual([]);
  });

  test('an automated suspension records its evidence so it can be judged and undone', async () => {
    const a = nextAccount();
    const device = nextDevice();
    const g = await recordSignIn({ uniqueId: a, deviceId: device, ip: '81.2.69.179' });
    await trackGraph(g.graphId);
    await suspendDeviceOnGraph(g.graphId, device, 'banned');

    await recordSignIn({ uniqueId: a, deviceId: device, ip: '81.2.69.180' });

    const user = (await db.doc(`users/${a}`).get()).data();
    expect(user.suspensionSource).toBe('identity-graph-cascade');
    expect(user.suspensionLevel).toBe('banned');
    expect(user.suspensionEvidence.graphId).toBe(g.graphId);
    expect(user.suspensionEvidence.identifiers).toEqual([{ type: 'device', value: device }]);
  });

  test('a graph with no suspended identifier cascades nothing', async () => {
    const a = nextAccount();
    const res = await recordSignIn({ uniqueId: a, deviceId: nextDevice(), ip: '81.2.69.181' });
    await trackGraph(res.graphId);
    expect(res.cascadedAccounts).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════
// Audit trail
// ═══════════════════════════════════════════════════════════════

describe('what an operator can see afterwards', () => {
  test('multi-account detection is audit-logged with the linking evidence', async () => {
    const a = nextAccount();
    const b = nextAccount();
    const device = nextDevice();

    const g = await recordSignIn({ uniqueId: a, deviceId: device, ip: '81.2.69.182' });
    await trackGraph(g.graphId);
    await recordSignIn({ uniqueId: b, deviceId: device, ip: '81.2.69.183' });

    const entries = await auditEntriesOfType('identity_multi_account_detected');
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const entry = entries[entries.length - 1];
    expect(entry.details.linkedAccountUids.sort()).toEqual([a, b].sort());
    // The evidence, not just the verdict — an operator must be able to judge
    // the link rather than take it on trust.
    expect(entry.details.linkingIdentifiers).toEqual([{ type: 'device', value: device }]);
  });

  test('a cascade is audit-logged with everyone it affected', async () => {
    const a = nextAccount();
    const b = nextAccount();
    const device = nextDevice();

    const g = await recordSignIn({ uniqueId: a, deviceId: device, ip: '81.2.69.184' });
    await trackGraph(g.graphId);
    await recordSignIn({ uniqueId: b, deviceId: device, ip: '81.2.69.185' });

    const doc = await db.doc(`identityGraphs/${g.graphId}`).get();
    const graph = doc.data();
    graph.identifiers = graph.identifiers.map((i) =>
      i.type === 'device' ? { ...i, suspension: 'suspended' } : i,
    );
    await db.doc(`identityGraphs/${g.graphId}`).set(graph);

    await recordSignIn({ uniqueId: b, deviceId: device, ip: '81.2.69.186' });

    const entries = await auditEntriesOfType('identity_cascade_suspension');
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const entry = entries[entries.length - 1];
    expect(entry.details.affectedAccounts.sort()).toEqual([a, b].sort());
    expect(entry.details.level).toBe('suspended');
    expect(entry.details.evidence).toEqual([{ type: 'device', value: device }]);
  });

  test('an ordinary sign-in generates no detection noise', async () => {
    const before = (await auditEntriesOfType('identity_multi_account_detected')).length;
    const res = await recordSignIn({
      uniqueId: nextAccount(),
      deviceId: nextDevice(),
      ip: '81.2.69.187',
    });
    await trackGraph(res.graphId);

    expect((await auditEntriesOfType('identity_multi_account_detected')).length).toBe(before);
  });
});

// ═══════════════════════════════════════════════════════════════
// Bookkeeping must never break a sign-in
// ═══════════════════════════════════════════════════════════════

describe('failure containment', () => {
  test('a sign-in with no account id is a no-op, not an error', async () => {
    expect(await recordSignIn({ uniqueId: null, deviceId: 'd' })).toEqual({
      graphId: null,
      identifiersAdded: 0,
      merged: 0,
      multiAccountDetected: false,
      cascadedAccounts: [],
    });
  });

  test('called with nothing at all, it still returns a summary', async () => {
    const res = await recordSignIn();
    expect(res.graphId).toBeNull();
  });
});
