/**
 * Every collection a test can WRITE must also be a collection teardown can
 * REMOVE.
 *
 * SHY-0245 found `suggestions` was writeable via `/api/test/write` but absent
 * from the sweep, so seeded suggestions leaked onto the public board and
 * skewed count/sort/pagination assertions in unrelated specs. The old pin
 * (`test-helpers-lifecycle.test.js` → "queries all expected collections")
 * could not catch it: it re-typed the sweep list by hand and asserted the
 * sweep contained those entries, so adding a writeable collection without a
 * matching sweep entry left it green.
 *
 * This pins the RELATIONSHIP between the two lists instead of their contents,
 * which is what actually has to hold.
 */

const {
  WRITEABLE_COLLECTIONS,
  SWEPT_BY_TEST_RUN,
  SWEPT_BY_BESPOKE_QUERY,
} = require('../../src/utils/test-collections');

describe('test-helpers teardown coverage', () => {
  test('every writeable collection is swept by teardown', () => {
    const unswept = WRITEABLE_COLLECTIONS.filter(
      (c) => !SWEPT_BY_TEST_RUN.includes(c) && !SWEPT_BY_BESPOKE_QUERY.includes(c),
    );
    expect(unswept).toEqual([]);
  });

  test('no collection is claimed by both the generic and bespoke sweeps', () => {
    // Double-sweeping is not harmful, but it means one of the two lists is
    // lying about how the collection is cleaned up — which is how the next
    // person mis-reads the invariant.
    const both = SWEPT_BY_TEST_RUN.filter((c) => SWEPT_BY_BESPOKE_QUERY.includes(c));
    expect(both).toEqual([]);
  });

  test('the bespoke-sweep exemption list only names writeable collections', () => {
    // Guards the exemption from growing into a place to hide new collections:
    // exempting something that cannot be written is meaningless, and would
    // most likely be a typo masking a real gap.
    const unknown = SWEPT_BY_BESPOKE_QUERY.filter((c) => !WRITEABLE_COLLECTIONS.includes(c));
    expect(unknown).toEqual([]);
  });

  test('neither list contains duplicates', () => {
    expect(new Set(WRITEABLE_COLLECTIONS).size).toBe(WRITEABLE_COLLECTIONS.length);
    expect(new Set(SWEPT_BY_TEST_RUN).size).toBe(SWEPT_BY_TEST_RUN.length);
  });

  test('the route module is built from these lists, not its own copies', () => {
    // The lists only mean anything if the handlers actually consult them. A
    // future edit that re-inlines an array in `test-helpers.js` would leave
    // every assertion above green while the real behaviour drifted.
    const src = require('fs').readFileSync(
      require.resolve('../../src/routes/test-helpers'),
      'utf8',
    );
    expect(src).toContain("require('../utils/test-collections')");
    expect(src).toContain('WRITEABLE_COLLECTIONS.includes(collection)');
    expect(src).toContain('for (const col of SWEPT_BY_TEST_RUN)');
  });
});
