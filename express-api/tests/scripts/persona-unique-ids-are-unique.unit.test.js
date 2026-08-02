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

/**
 * The ephemeral set, read from the runner's source (it is not exported).
 *
 * Entry-by-entry rather than one regex across the whole block. The first version
 * used `id: '(P-\d+)',\s*uniqueId: (\d+)` and I then added an explanatory
 * comment between those two lines in the runner — `\s*` does not span a comment,
 * so the extraction silently stopped seeing P-01, THE VERY PERSONA THAT HAD
 * COLLIDED. The guard would have gone on passing while watching a set with the
 * offender removed from it.
 *
 * `entryCount()` below is what makes that impossible to repeat: it counts the
 * entries independently, and the test asserts the two agree.
 */
function ephemeralBlock() {
  const src = fs.readFileSync(path.resolve(__dirname, '../../scripts/manual-qa-runner.js'), 'utf8');
  return src.slice(src.indexOf('const EPHEMERAL_PERSONAS'), src.indexOf('function loadPersonas'));
}

/** How many entries the block declares, counted independently of the parse. */
function entryCount() {
  return (ephemeralBlock().match(/id: 'P-\d+'/g) || []).length;
}

function ephemeralPersonas() {
  const block = ephemeralBlock();
  // Split on the id line, then read each entry's own fields. Comments, blank
  // lines and reordered properties inside an entry cannot hide it.
  return [...block.matchAll(/id: '(P-\d+)'/g)].map((m, i, all) => {
    const from = m.index;
    const to = i + 1 < all.length ? all[i + 1].index : block.length;
    const entry = block.slice(from, to);
    const uid = /uniqueId:\s*(\d+)/.exec(entry);
    const name = /displayName:\s*'([^']+)'/.exec(entry);
    return {
      id: m[1],
      uniqueId: uid ? Number(uid[1]) : null,
      displayName: name ? name[1] : '(no displayName)',
    };
  });
}

describe('the scan is real', () => {
  it('reads both persona sets', () => {
    expect(personas.length).toBeGreaterThan(10);
    expect(ephemeralPersonas().length).toBeGreaterThan(0);
  });

  it('extracts EVERY ephemeral entry the block declares', () => {
    // The calibration that matters, and the one that was missing. A
    // `length > 0` check passed while the parse silently dropped P-01 — the
    // exact persona that had collided — because a comment landed between its
    // `id:` and `uniqueId:` lines. Counting the entries independently is what
    // turns "the scan found something" into "the scan found everything".
    expect(ephemeralPersonas().length).toBe(entryCount());
  });

  it('every extracted persona has a usable id', () => {
    // A null uniqueId would drop out of the collision map and hide a clash just
    // as effectively as not being parsed at all.
    for (const p of ephemeralPersonas()) {
      expect({ id: p.id, uniqueId: p.uniqueId }).toEqual({
        id: p.id,
        uniqueId: expect.any(Number),
      });
    }
  });

  it('sees P-01 specifically — the entry a comment once hid', () => {
    expect(ephemeralPersonas().map((p) => p.id)).toContain('P-01');
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
