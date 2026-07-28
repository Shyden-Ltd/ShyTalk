/**
 * Every admin action that CHANGES something must leave an audit trail.
 *
 * Four tests in `admin-audit-log-suggestions.test.js` claimed exactly this —
 * "every suggestion action creates entry", "every ban/suspension action creates
 * entry", "every identity graph change logged", "every dispute resolution
 * logged" — and each had an empty body with a comment where the assertions
 * should be. They passed for as long as they existed while proving nothing
 * (SHY-0245).
 *
 * Per-route tests would not have delivered what those names promise either: a
 * NEW unaudited admin route would leave every existing per-route test green.
 * The claim is about completeness, so the test is structural — it reads the
 * route sources, finds every mutating admin handler, and requires each to write
 * an audit entry.
 *
 * This matters beyond tidiness. ShyTalk is a minors-facing service; an admin
 * ban, merge or identity-graph edit that leaves no record is a compliance
 * problem, not a style one.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src', 'routes');

/** Route files whose mutating admin handlers must all be audited. */
const AUDITED_FILES = ['suggestions.js', 'admin-bans.js', 'identity-graph.js', 'admin-gifts.js'];

/**
 * Anything that writes a durable admin record.
 *
 * There are THREE audit collections in play — `moderationLog` (via
 * createAuditEntry), `adminAuditLog`, and `auditLog`. That is not tidy, but it
 * is the truth, and a detector that only knew two of them reported the dispute
 * resolve route as unaudited when it was not. `AUDIT_COLLECTIONS` below pins
 * the set so the read surface has to keep covering all of it.
 */
const AUDIT_COLLECTIONS = ['moderationLog', 'adminAuditLog', 'auditLog'];

const AUDIT_WRITERS = [
  /createAuditEntry\s*\(/,
  ...AUDIT_COLLECTIONS.map((c) => new RegExp(c)),
  /recordAgeVerificationAudit\s*\(/,
  /recordSegregationAudit\s*\(/,
];

const MUTATING = /router\.(post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g;

/**
 * Split a route file into one chunk per handler, so "does this handler audit?"
 * is asked of the handler and not of the file. A file-level grep would let a
 * single audited route vouch for a dozen silent ones.
 */
function handlersOf(source) {
  const starts = [];
  for (const m of source.matchAll(MUTATING)) {
    starts.push({ method: m[1], route: m[2], index: m.index });
  }
  return starts.map((s, i) => ({
    ...s,
    body: source.slice(s.index, i + 1 < starts.length ? starts[i + 1].index : source.length),
  }));
}

/**
 * Routes that legitimately write no audit entry, each with the reason. Keep
 * this list short and specific — it is the only way an unaudited admin route
 * can pass, so a vague entry here is how the guarantee erodes.
 */
const EXEMPT = new Map([
  // Ordinary users acting on their own content, not admins acting on others'.
  ['POST /suggestions', 'a person submitting their own suggestion'],
  ['POST /suggestions/:id/vote', 'a person voting'],
  ['DELETE /suggestions/:id/vote', 'a person withdrawing their own vote'],
  ['POST /suggestions/:id/comments', 'a person commenting'],
  ['POST /suggestions/:id/dispute', 'a person disputing a merge — the RESOLUTION is audited'],
]);

describe('admin audit completeness', () => {
  const findings = [];

  for (const file of AUDITED_FILES) {
    const source = fs.readFileSync(path.join(SRC, file), 'utf8');
    for (const handler of handlersOf(source)) {
      const key = `${handler.method.toUpperCase()} ${handler.route}`;
      const isAdmin = handler.route.includes('/admin/');
      const audited = AUDIT_WRITERS.some((re) => re.test(handler.body));
      findings.push({ file, key, isAdmin, audited, exempt: EXEMPT.has(key) });
    }
  }

  test('the route scan actually found admin routes to check', () => {
    // A regex that silently matches nothing would make every assertion below
    // vacuously true — the exact failure mode this whole file exists to stop.
    const adminRoutes = findings.filter((f) => f.isAdmin);
    expect(adminRoutes.length).toBeGreaterThan(8);
  });

  test('every mutating admin route writes an audit entry', () => {
    const unaudited = findings
      .filter((f) => f.isAdmin && !f.audited && !f.exempt)
      .map((f) => `${f.key} (${f.file})`);
    expect(unaudited).toEqual([]);
  });

  test('every exemption names a route that exists', () => {
    // An exemption for a route that has been renamed or removed is dead cover
    // — it stops protecting anything and hides the next real gap.
    const keys = new Set(findings.map((f) => f.key));
    const stale = [...EXEMPT.keys()].filter((k) => !keys.has(k));
    expect(stale).toEqual([]);
  });

  test('the admin audit view reads every collection that is written to', () => {
    // Writing an audit entry into a collection nothing reads is the same as
    // not writing one — worse, because it looks done. The three collections
    // grew organically; this is what stops a fourth appearing unnoticed.
    const source = fs.readFileSync(path.join(SRC, 'suggestions.js'), 'utf8');
    // The history view is the surface an admin actually reads a suggestion's
    // trail from — GET /admin/suggestions/:id/history.
    const viewStart = source.indexOf("router.get('/admin/suggestions/:id/history'");
    // Jest's expect takes ONE argument — the message form is Playwright's.
    expect({ route: 'GET /admin/suggestions/:id/history', found: viewStart > -1 }).toEqual({
      route: 'GET /admin/suggestions/:id/history',
      found: true,
    });
    const viewBody = source.slice(viewStart, viewStart + 4000);
    const unread = AUDIT_COLLECTIONS.filter((c) => !viewBody.includes(c));
    expect(unread).toEqual([]);
  });

  test('no exemption covers a route under /admin/', () => {
    // The exemptions are for ordinary users acting on their own content. An
    // /admin/ route slipping into that list would be exactly the wrong thing
    // to wave through.
    const wrong = [...EXEMPT.keys()].filter((k) => k.includes('/admin/'));
    expect(wrong).toEqual([]);
  });
});
