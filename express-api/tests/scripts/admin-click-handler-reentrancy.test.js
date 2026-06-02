/**
 * Static guard for admin click-handler re-entrancy + finally symmetry.
 *
 * Two invariants pinned here:
 *
 * 1. **Re-entrancy guard** — every async click handler whose body opens
 *    confirm() and then calls apiCall()/fetch() must bail when the
 *    button is already in-flight. Without the guard, a double-tap (or
 *    Playwright auto-accepted confirm in tests) races two handler
 *    invocations through the API call. The same invariant applies to
 *    handlers that set `btn.disabled = true` before an `await` — even
 *    without confirm(), the gap between sync-disable-set and the await
 *    yield is wide enough for two queued events to both pass the guard
 *    check (see PR #968 direct-warn-btn for the original surface).
 *
 * 2. **Re-enable symmetry** — every handler that disables a button must
 *    re-enable it in a `finally` block, so confirm-cancel, API errors,
 *    or thrown exceptions inside `catch` all flow through to the same
 *    re-enable. A bare `btn.disabled = false` after try/catch silently
 *    leaks a stuck-disabled button when the catch itself throws.
 *
 * Guard shapes accepted (any of):
 *   if (someBtn.disabled) return;
 *   if (this.disabled) return;
 *   if (this.disabled === true) return;       // === / !== variants
 *   if (someFlagInFlight) return;             // module-level boolean
 *   if (e.target.dataset.inflight) return;    // dataset alternative
 *
 * KNOWN LIMITATIONS (documented as accepted gaps, not bugs):
 *   - Named-function references (`addEventListener("click", handleX)`
 *     where handleX is declared elsewhere) are NOT resolved. Add a
 *     direct test case for new exported handlers that fit this shape.
 *   - Inline `onclick=` HTML attributes are NOT scanned. Functions
 *     exposed via `window.X = X` for HTML onclick (e.g. resetPinLockout,
 *     revokeBiometricKey in users.js) must carry their own module-level
 *     in-flight flag — verified by separate test below.
 *   - Nested function handlers inside the outer body share the body
 *     text slice. The regex check on `bodyText` may false-positive if a
 *     nested inner handler carries the guard while the outer doesn't,
 *     or false-negative in the inverse case. For the current codebase
 *     this is not a problem; revisit if `addEventListener` calls become
 *     nested.
 */

const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');
const traverseModule = require('@babel/traverse');
const traverse = traverseModule.default || traverseModule;
const glob = require('glob');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCAN_GLOBS = [
  path.join(REPO_ROOT, 'public/admin/**/*.js'),
  path.join(REPO_ROOT, 'public/js/**/*.js'),
];

// Guard accepts: .disabled-check OR module-flag-check OR dataset.inflight.
// `=== true|false`, `!== true|false` variants all allowed. Quantifiers are
// bounded to keep the regex linear (no super-linear backtracking).
const GUARD_PATTERNS = [
  /if\s*\(\s*(?:this|\w{1,40})\.disabled\b[^)]{0,40}\)\s*return/i,
  /if\s*\(\s*_?[a-z]\w{0,40}InFlight\b[^)]{0,5}\)\s*return/,
  /dataset\.inflight/i,
];

function hasGuard(bodyText) {
  return GUARD_PATTERNS.some((p) => p.test(bodyText));
}

// `disabled = true` followed (later) by an `await`. Either ordering of
// confirm()/await inside try is fine — we just need the disable to land
// before any yield point.
function setsDisabledBeforeAwait(bodyText) {
  if (!/\.\s*disabled\s*=\s*true/.test(bodyText)) return false;
  return /\bawait\b/.test(bodyText);
}

// Re-enable must live inside a `finally` block to survive throws. The
// finally-aware window keeps the regex bounded (no nested `[\s\S]*?`).
function reEnablesInFinally(bodyText) {
  const idx = bodyText.search(/\bfinally\s*\{/);
  if (idx < 0) return false;
  const win = bodyText.slice(idx, idx + 500);
  return /\.\s*disabled\s*=\s*false/.test(win);
}

function collectClickHandlers(file) {
  const source = fs.readFileSync(file, 'utf-8');
  let ast;
  try {
    ast = parser.parse(source, { sourceType: 'module' });
  } catch (_e) {
    ast = parser.parse(source, { sourceType: 'script' });
  }
  const hits = [];
  traverse(ast, {
    CallExpression(nodePath) {
      const node = nodePath.node;
      if (node.callee.type !== 'MemberExpression') return;
      if (node.callee.property.name !== 'addEventListener') return;
      if (node.arguments.length < 2) return;
      const arg0 = node.arguments[0];
      if (arg0.type !== 'StringLiteral' || arg0.value !== 'click') return;
      const handler = node.arguments[1];
      if (handler.type !== 'ArrowFunctionExpression' && handler.type !== 'FunctionExpression') {
        return;
      }
      const body = handler.body;
      const bodyText = source.slice(body.start, body.end);
      const hasConfirm = /\bconfirm\s*\(/.test(bodyText);
      const hasApiCall = /\bapiCall\s*\(/.test(bodyText) || /\bfetch\s*\(/.test(bodyText);
      const racePattern = (hasConfirm && hasApiCall) || setsDisabledBeforeAwait(bodyText);
      if (!racePattern) return;
      hits.push({
        file: path.relative(REPO_ROOT, file),
        line: node.loc.start.line,
        hasGuard: hasGuard(bodyText),
        // `finally` only matters when the handler actually disables the
        // button. Handlers using a module-level in-flight flag manage
        // their own finally separately.
        needsFinally: /\.\s*disabled\s*=\s*true/.test(bodyText),
        hasFinally: reEnablesInFinally(bodyText),
      });
    },
  });
  return hits;
}

describe('admin click-handler re-entrancy', () => {
  const files = SCAN_GLOBS.flatMap((g) => glob.sync(g));

  test('discovers at least one click handler (sanity)', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test('every confirm()+api or disable+await click handler has a re-entrancy guard', () => {
    const allHits = [];
    for (const file of files) {
      allHits.push(...collectClickHandlers(file));
    }
    const missing = allHits.filter((h) => !h.hasGuard);
    if (missing.length === 0) return;
    const detail = missing.map((m) => `  ${m.file}:${m.line}`).join('\n');
    const msg =
      `${missing.length} click handler(s) missing re-entrancy guard ` +
      `(must early-return when button is already in-flight — see PR #968 ` +
      `direct-warn-btn pattern in users.js, the original surface):\n${detail}`;
    throw new Error(msg);
  });

  test('every handler that disables a button re-enables in finally', () => {
    const allHits = [];
    for (const file of files) {
      allHits.push(...collectClickHandlers(file));
    }
    const broken = allHits.filter((h) => h.needsFinally && !h.hasFinally);
    if (broken.length === 0) return;
    const detail = broken.map((m) => `  ${m.file}:${m.line}`).join('\n');
    const msg =
      `${broken.length} click handler(s) disable the button without a ` +
      `'finally { btn.disabled = false }' re-enable — a throw inside catch ` +
      `leaks a stuck-disabled button:\n${detail}`;
    throw new Error(msg);
  });

  // Inline-onclick globals: confirm()+apiCall() functions exposed via
  // `window.X = X` for HTML onclick=. The AST scan above doesn't see
  // them (no addEventListener wrapper). Pin their in-flight discipline
  // explicitly by name.
  test('inline-onclick globals carry module-level in-flight flags', () => {
    const usersJs = fs.readFileSync(path.join(REPO_ROOT, 'public/admin/js/tabs/users.js'), 'utf-8');
    const targets = ['resetPinLockout', 'revokeBiometricKey'];
    const missing = [];
    for (const name of targets) {
      // Each must declare a backing flag and check it on entry.
      const flagDecl = new RegExp(`_${name}InFlight\\s*=\\s*false`);
      const flagCheck = new RegExp(`if\\s*\\(\\s*_${name}InFlight\\s*\\)\\s*return`);
      if (!flagDecl.test(usersJs) || !flagCheck.test(usersJs)) {
        missing.push(name);
      }
    }
    if (missing.length === 0) return;
    throw new Error(
      `Inline-onclick admin globals missing in-flight flag: ${missing.join(', ')}. ` +
        `Each must declare \`let _<name>InFlight = false\` and check it on entry.`,
    );
  });
});
