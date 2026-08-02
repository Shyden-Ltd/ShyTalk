/**
 * No two personas may share a uniqueId.
 *
 * They did. `uniqueId 90000001` belonged to BOTH:
 *
 *   registry   P-12 Greta (P-12 admin)      provision-test-personas.js
 *   ephemeral  P-01 Adam (P-01 adult new)   manual-qa-runner.js
 *
 * so they were the same `users/90000001` document and whichever seeded last
 * won. Greta is the ADMIN persona (`isAdmin: true`) and Adam is a brand-new
 * adult — meaning a run could silently strip admin rights from every scenario
 * that needs them, or hand them to a signup scenario that must not have them.
 * The corpus names that id as the admin in four journeys
 * (`adminId: 90000001` in j01, j04, j06, j10), so the ephemeral persona was the
 * one in the wrong.
 *
 * It was visible for a whole day as an unexplained oddity: signing in as P-12
 * displayed "Adam (P-01 adult new)". That reads like a display bug, which is
 * why it sat unexplained — the two personas were never compared.
 *
 * The ids live in two files that neither imports the other for this purpose, so
 * nothing could have caught it. This test is the thing that can.
 */
const path = require('path');
const fs = require('fs');

const { personas } = require('../../scripts/provision-test-personas');

/** The ephemeral set, read from the runner's source (it is not exported). */
function ephemeralPersonas() {
  const src = fs.readFileSync(path.resolve(__dirname, '../../scripts/manual-qa-runner.js'), 'utf8');
  const start = src.indexOf('const EPHEMERAL_PERSONAS');
  const block = src.slice(start, src.indexOf('function loadPersonas'));
  return [
    ...block.matchAll(/id: '(P-\d+)',\s*uniqueId: (\d+),[\s\S]*?displayName: '([^']+)'/g),
  ].map((m) => ({ id: m[1], uniqueId: Number(m[2]), displayName: m[3] }));
}

describe('the scan is real', () => {
  it('reads both persona sets', () => {
    // Calibration: an empty read would make the collision check vacuous, which
    // is exactly how this went unnoticed.
    expect(personas.length).toBeGreaterThan(10);
    expect(ephemeralPersonas().length).toBeGreaterThan(0);
  });
});

describe('every persona has a distinct uniqueId', () => {
  const all = () => [
    ...personas.map((p) => ({ ...p, source: 'registry' })),
    ...ephemeralPersonas().map((p) => ({ ...p, source: 'ephemeral' })),
  ];

  it('no id is claimed by two personas', () => {
    const byId = new Map();
    for (const p of all()) {
      if (!byId.has(p.uniqueId)) byId.set(p.uniqueId, []);
      byId.get(p.uniqueId).push(`${p.source} ${p.id} ${p.displayName}`);
    }
    const collisions = [...byId.entries()]
      .filter(([, who]) => who.length > 1)
      .map(([id, who]) => `${id}: ${who.join('  vs  ')}`);
    expect({ sharedUniqueIds: collisions }).toEqual({ sharedUniqueIds: [] });
  });

  it('no id is claimed by two personas via a STRING/number mix either', () => {
    // The registry stores numbers; a future entry added as a string would look
    // distinct to a Map while being the same document path.
    const seen = new Map();
    const dupes = [];
    for (const p of all()) {
      const key = String(p.uniqueId);
      if (seen.has(key)) dupes.push(`${key}: ${seen.get(key)} vs ${p.displayName}`);
      seen.set(key, p.displayName);
    }
    expect({ sharedAsStrings: dupes }).toEqual({ sharedAsStrings: [] });
  });

  it('the admin id the corpus hard-codes still belongs to the admin', () => {
    // j01/j04/j06/j10 assert `adminId: 90000001`. If that id ever moves to a
    // non-admin persona those four journeys start asserting the wrong actor,
    // and would pass or fail for reasons unrelated to what they test.
    const owner = personas.find((p) => p.uniqueId === 90000001);
    expect(owner).toBeDefined();
    expect(owner.isAdmin).toBe(true);
  });
});
