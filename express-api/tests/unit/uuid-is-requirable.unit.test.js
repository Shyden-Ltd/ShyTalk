/**
 * `uuid` must stay loadable by Jest, and must still generate unique ids.
 *
 * SHY-0264. `uuid@14` is ESM-only: its exports map offers `node` and `default`
 * conditions and no `require` at all. Node 24 handles that natively
 * (require(esm) landed in 22.12), which is why production never noticed — but
 * Jest's own CJS registry does not, so
 * firebase-admin -> @google-cloud/firestore -> google-gax -> require('uuid')
 * threw `Unexpected token 'export'` and took an entire real-services suite
 * down AT IMPORT. Eleven tests reported as failures without ever running.
 *
 * That is the worst shape of red: it looks like eleven product defects and is
 * actually zero, and nothing in the failure text points at a dependency.
 *
 * A one-line guard is the cheap way to make the next occurrence obvious. If a
 * future bump or override makes uuid unloadable again, THIS fails by name
 * instead of a whole suite failing by accident.
 */

describe('uuid is requirable from Jest', () => {
  it('loads at all', () => {
    // The literal regression: this threw SyntaxError before the transform.
    expect(() => require('uuid')).not.toThrow();
  });

  it('exposes v4', () => {
    const { v4 } = require('uuid');
    expect(typeof v4).toBe('function');
  });

  it('still generates RFC-4122 v4 values after being transformed', () => {
    // The transform rewrites module syntax only, but this is an ID library:
    // a transform that quietly altered its behaviour would be far worse than
    // the load error it fixed, so the output shape is checked rather than
    // assumed.
    const { v4 } = require('uuid');
    const id = v4();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('produces distinct ids across a large sample', () => {
    // Collision here would mean the transform broke the RNG — the specific
    // catastrophe worth ruling out before trusting a transformed crypto-ish
    // dependency.
    const { v4 } = require('uuid');
    const seen = new Set();
    for (let i = 0; i < 10000; i++) seen.add(v4());
    expect(seen.size).toBe(10000);
  });
});

describe('the transform stays narrowly scoped', () => {
  const fs = require('fs');
  const path = require('path');

  it('transforms uuid and nothing else in node_modules', () => {
    // Transforming the whole dependency tree would cost far more wall-clock
    // than the bug it fixes, and would put a rewrite in front of every
    // dependency rather than the one that needs it.
    const cfg = fs.readFileSync(path.join(__dirname, '../../jest.config.js'), 'utf8');
    expect(cfg).toContain("transformIgnorePatterns: ['/node_modules/(?!uuid/)']");
  });

  it('babel targets the CURRENT node, so no syntax is needlessly down-levelled', () => {
    const babel = fs.readFileSync(path.join(__dirname, '../../babel.config.js'), 'utf8');
    expect(babel).toContain("targets: { node: 'current' }");
  });
});
