'use strict';

/**
 * SHY-0249 — the appeal document the TEST FIXTURE writes must have the same
 * shape the PRODUCT writes.
 *
 * This is the test that was missing, and its absence is why the appeals suite
 * stayed green through a real defect for as long as it did:
 *
 *   - `POST /api/users/:uniqueId/appeal` (users.js) writes `uniqueId`.
 *   - The test fixture (test-helpers.js) wrote `userId`.
 *   - `GET /api/appeals` (reports.js) read `userId`.
 *
 * Two out of three agreed, so every test passed. The one that disagreed was
 * the only one a real person ever went through: an appeal submitted from the
 * app resolved to no account at all, and the admin reviewing it saw appeal
 * text with no name, no id and no suspension reason attached.
 *
 * Per-behaviour tests cannot catch this — they all read the fixture's shape.
 * The only thing that catches it is comparing the two writers directly, which
 * is what this file does, by reading the sources rather than by exercising a
 * path that would just agree with itself.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src');
const USERS = fs.readFileSync(path.join(SRC, 'routes', 'users.js'), 'utf8');
const HELPERS = fs.readFileSync(path.join(SRC, 'routes', 'test-helpers.js'), 'utf8');
const REPORTS = fs.readFileSync(path.join(SRC, 'routes', 'reports.js'), 'utf8');

/** Take a balanced `{ ... }` starting at `open`. */
function braceSpan(source, open) {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(open, i + 1);
  }
  return '';
}

/**
 * The object literal written to `suspensionAppeals`, whichever way it is
 * spelled.
 *
 * The two writers do not have the same shape on the page: users.js passes the
 * literal inline to `.set()`, test-helpers.js builds `appealData` first and
 * passes the name. A fixed window either side of the doc path finds one and
 * misses the other — which is exactly what the first version of this file did,
 * reporting the fixture as having no account field at all. Follow the `.set()`
 * argument instead of guessing where the object sits.
 */
function appealWriteBlock(source) {
  const anchor = source.indexOf('suspensionAppeals/');
  if (anchor === -1) return '';
  const setAt = source.indexOf('.set(', anchor);
  if (setAt === -1) return '';

  const rest = source.slice(setAt + '.set('.length);
  const inline = rest.match(/^\s*\{/);
  if (inline) return braceSpan(source, setAt + '.set('.length + inline[0].length - 1);

  const named = rest.match(/^\s*([A-Za-z_$][\w$]*)/);
  if (!named) return '';
  const declAt = source.indexOf(`const ${named[1]} = {`);
  if (declAt === -1) return '';
  return braceSpan(source, source.indexOf('{', declAt));
}

describe('SHY-0249 — the appeal fixture writes what production writes', () => {
  const productionWrite = appealWriteBlock(USERS);
  const fixtureWrite = appealWriteBlock(HELPERS);

  it('found both writers — the scan is not vacuous', () => {
    // If either slice came back empty, every assertion below would pass for
    // the wrong reason.
    expect({
      production: productionWrite.length > 0,
      fixture: fixtureWrite.length > 0,
    }).toEqual({ production: true, fixture: true });
  });

  it('both writers identify the account with the same field', () => {
    // `[,:]` because production uses the SHORTHAND form (`uniqueId,`) and the
    // fixture writes `uniqueId: appealUser.uniqueId`. Requiring a colon found
    // only one of them.
    const accountField = (block) =>
      ['uniqueId', 'userId', 'user_id'].filter((f) => new RegExp(`\\b${f}\\s*[,:]`).test(block));

    expect({
      production: accountField(productionWrite),
      fixture: accountField(fixtureWrite),
    }).toEqual({ production: ['uniqueId'], fixture: ['uniqueId'] });
  });

  it('both writers set the same required fields', () => {
    const has = (block, field) => new RegExp(`\\b${field}\\b`).test(block);
    const required = ['appealText', 'status', 'createdAt'];

    const missing = required.filter((f) => !has(productionWrite, f) || !has(fixtureWrite, f));
    expect(missing).toEqual([]);
  });

  it('the reader resolves the field production actually writes', () => {
    // Closing the loop: agreement between the two writers is worth nothing if
    // the reader wants a third thing. `appealAccountId` is the single place
    // that decision is made.
    const resolver = REPORTS.slice(
      REPORTS.indexOf('function appealAccountId'),
      REPORTS.indexOf('function appealAccountId') + 400,
    );
    expect(resolver.length).toBeGreaterThan(0);
    expect(resolver).toMatch(/appeal\.uniqueId/);
  });

  it('the reader still accepts the legacy spellings already in Firestore', () => {
    // Documents written before this fix are still out there. Dropping them
    // would silently orphan real appeals — a regression that looks like a
    // cleanup.
    const resolver = REPORTS.slice(
      REPORTS.indexOf('function appealAccountId'),
      REPORTS.indexOf('function appealAccountId') + 400,
    );
    const missing = ['userId', 'user_id'].filter((f) => !resolver.includes(f));
    expect(missing).toEqual([]);
  });
});
