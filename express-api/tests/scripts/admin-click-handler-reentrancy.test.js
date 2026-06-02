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
 *     where handleX is a FunctionDeclaration or const-arrow IN THE SAME
 *     FILE) ARE now resolved via collectFunctionDecls(). Cross-file
 *     imports are NOT resolved — if a future handler is imported from
 *     another module, add a hard-coded pin test.
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
 *   - Guard regex `[^)]{0,40}` after `.disabled\b` terminates at the
 *     first `)`. A guard with a nested-call condition like
 *     `if (btn.disabled && helper() === true) return;` would prematurely
 *     terminate and not match. No such pattern exists today; document
 *     the bound here so future developers know to use simple guard
 *     conditions.
 *   - MemberExpression handler arguments (e.g. `addEventListener("click",
 *     obj.method)` or `addEventListener("click", this.fn.bind(this))`)
 *     are NOT resolved — they fall through to the silent `return` at the
 *     end of the CallExpression visitor. No such pattern exists in the
 *     admin or shared JS today; if a future class-based module appears,
 *     add a hard-coded pin test for it like the inline-onclick globals
 *     and revokeWarning sections below.
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

// Collect every FunctionDeclaration in the file keyed by name. Used to
// resolve `addEventListener("click", namedFn)` to its actual body so the
// invariants apply to named-function refs, not just inline arrows.
function collectFunctionDecls(ast, source) {
  const map = new Map();
  traverse(ast, {
    FunctionDeclaration(p) {
      if (!p.node.id?.name) return;
      map.set(p.node.id.name, source.slice(p.node.body.start, p.node.body.end));
    },
    VariableDeclarator(p) {
      const init = p.node.init;
      if (!init || !p.node.id?.name) return;
      if (init.type !== 'ArrowFunctionExpression' && init.type !== 'FunctionExpression') return;
      const bodyNode = init.body;
      map.set(p.node.id.name, source.slice(bodyNode.start, bodyNode.end));
    },
  });
  return map;
}

function analyseBody(bodyText) {
  const hasConfirm = /\bconfirm\s*\(/.test(bodyText);
  const hasApiCall = /\bapiCall\s*\(/.test(bodyText) || /\bfetch\s*\(/.test(bodyText);
  const racePattern = (hasConfirm && hasApiCall) || setsDisabledBeforeAwait(bodyText);
  if (!racePattern) return null;
  return {
    hasGuard: hasGuard(bodyText),
    // `finally` only matters when the handler actually disables the
    // button. Handlers using a module-level in-flight flag manage
    // their own finally separately.
    needsFinally: /\.\s*disabled\s*=\s*true/.test(bodyText),
    hasFinally: reEnablesInFinally(bodyText),
  };
}

function collectClickHandlers(file) {
  const source = fs.readFileSync(file, 'utf-8');
  let ast;
  try {
    ast = parser.parse(source, { sourceType: 'module' });
  } catch (_e) {
    ast = parser.parse(source, { sourceType: 'script' });
  }
  const fnDecls = collectFunctionDecls(ast, source);
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
      let bodyText;
      if (handler.type === 'ArrowFunctionExpression' || handler.type === 'FunctionExpression') {
        bodyText = source.slice(handler.body.start, handler.body.end);
      } else if (handler.type === 'Identifier' && fnDecls.has(handler.name)) {
        // `addEventListener("click", namedFn)` — resolve to the
        // function body declared in the same file.
        bodyText = fnDecls.get(handler.name);
      } else {
        return;
      }
      const analysis = analyseBody(bodyText);
      if (!analysis) return;
      hits.push({
        file: path.relative(REPO_ROOT, file),
        line: node.loc.start.line,
        ...analysis,
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
  // explicitly by name. Convention: exactly `let _<name>InFlight = false`
  // (no `_is` prefix variation); a future global must follow this
  // convention so the regex pin stays consistent with the guard pattern.
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
        `Each must declare exactly \`let _<name>InFlight = false\` (no _is prefix) ` +
        `and check it on entry.`,
    );
  });

  // Multi-step wizard step-locks: nuclear-reset.js + sync-prod.js have
  // a `let *StepLock = false` module-level flag that prevents step-1→2
  // rapid double-tap from skipping the "last warning" UI. Without
  // pinning by name, GUARD_PATTERN[0] (`btn.disabled`) is enough to
  // pass the broader invariant — but a future refactor could silently
  // remove the step-lock and re-introduce the UX-skip bug. Pin by
  // name, structure, and the setTimeout-cleared release semantics.
  test('multi-step wizard handlers carry a step-transition lock', () => {
    const cases = [
      { file: 'public/admin/js/nuclear-reset.js', name: 'nuclearStepLock' },
      { file: 'public/admin/js/sync-prod.js', name: 'syncStepLock' },
    ];
    const issues = [];
    for (const { file, name } of cases) {
      const src = fs.readFileSync(path.join(REPO_ROOT, file), 'utf-8');
      // Declaration: `let <name> = false`.
      const declRe = new RegExp(`let\\s+${name}\\s*=\\s*false`);
      // Entry check: `if (<name>) return`.
      const checkRe = new RegExp(`if\\s*\\(\\s*${name}\\s*\\)\\s*return`);
      // Set then schedule release on next macrotask:
      //   <name> = true;
      //   ...setTimeout(() => { <name> = false; }, 0)
      // The releaseRe assumes a single-line setTimeout shape with no
      // commas in the body slice between `false` and the `, 0)` tail.
      // A future refactor that adds commas inside the arrow body (e.g.
      // a sequence expression) would false-negative — keep the shape
      // simple, no comma operators in the release body.
      const setRe = new RegExp(`${name}\\s*=\\s*true\\b`);
      const releaseRe = new RegExp(`setTimeout\\([^,]+${name}\\s*=\\s*false[^,]+,\\s*0\\s*\\)`);
      if (!declRe.test(src)) issues.push(`${file}: missing \`let ${name} = false\` declaration`);
      if (!checkRe.test(src)) issues.push(`${file}: missing \`if (${name}) return\` entry check`);
      if (!setRe.test(src)) issues.push(`${file}: missing \`${name} = true\` set`);
      if (!releaseRe.test(src)) {
        issues.push(`${file}: missing setTimeout(0) release of ${name}`);
      }
    }
    if (issues.length === 0) return;
    throw new Error(`Multi-step wizard step-lock invariants violated:\n  ${issues.join('\n  ')}`);
  });

  // revokeWarning is a thin-wrapper handler: registered via
  // `() => revokeWarning(uid, w.id, w.gcsDeduction, rb)` so the AST
  // scan sees the arrow wrapper (no confirm/apiCall in the wrapper body
  // — both live inside revokeWarning itself). Pin its discipline
  // explicitly: must carry a `btn.disabled` guard at the top. Success
  // path destroys the button via list re-render, so finally-symmetry
  // does NOT apply — the catch-only re-enable is intentional.
  test('revokeWarning carries the entry guard', () => {
    const usersJs = fs.readFileSync(path.join(REPO_ROOT, 'public/admin/js/tabs/users.js'), 'utf-8');
    // Match the function header + the next ~200 chars; assert the guard
    // lands before the first `confirm(`.
    const fnIdx = usersJs.search(/export\s+async\s+function\s+revokeWarning\s*\(/);
    if (fnIdx < 0) {
      throw new Error('revokeWarning function not found in users.js — refactor may have moved it');
    }
    const window = usersJs.slice(fnIdx, fnIdx + 400);
    const guardIdx = window.search(/if\s*\(\s*btn\.disabled\s*\)\s*return/);
    const confirmIdx = window.search(/\bconfirm\s*\(/);
    if (guardIdx < 0) {
      throw new Error('revokeWarning is missing the `if (btn.disabled) return;` guard at the top');
    }
    if (confirmIdx >= 0 && guardIdx > confirmIdx) {
      throw new Error('revokeWarning guard must come BEFORE the confirm() — same race as PR #968');
    }
  });
});
