/**
 * Static guard for admin click-handler re-entrancy.
 *
 * Every async click handler that opens confirm() and then calls apiCall()
 * / fetch() must bail when the button is already in-flight. Without the
 * guard, a double-tap (or Playwright auto-accepted confirm in tests)
 * races two handler invocations through the API call.
 *
 * PR #968 fixed direct-warn-btn (users.js:1305). This test pins the
 * codebase-wide invariant so future handlers can't regress.
 *
 * Guard shapes accepted (any of):
 *   if (someBtn.disabled) return;
 *   if (this.disabled) return;
 *   if (e.target.dataset.inflight) return;
 *
 * Detection lives at the AST level so renaming variables or reformatting
 * doesn't fool it — but the guard MATCH stays as a textual regex over the
 * handler body so the test owns a single, readable invariant.
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
      if (!hasConfirm || !hasApiCall) return;
      const guardPatterns = [/if\s*\([^)]*\.\s*disabled\s*\)\s*return/i, /dataset\.inflight/i];
      const hasGuard = guardPatterns.some((p) => p.test(bodyText));
      hits.push({
        file: path.relative(REPO_ROOT, file),
        line: node.loc.start.line,
        hasGuard,
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

  test('every confirm()+api click handler has a re-entrancy guard', () => {
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
      `direct-warn-btn pattern at users.js:1305):\n${detail}`;
    throw new Error(msg);
  });
});
