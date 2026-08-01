/**
 * Babel is used ONLY to make ESM-only dependencies loadable by Jest's CJS
 * module registry. SHY-0264.
 *
 * `uuid@14` is ESM-only — its exports map offers `node` and `default`
 * conditions and no `require` at all. Node 24 handles that natively
 * (require(esm) landed in 22.12), which is why production is unaffected, but
 * Jest's own registry does not, so `firebase-admin` -> `@google-cloud/firestore`
 * -> `google-gax` -> require('uuid') threw `Unexpected token 'export'` and took
 * an entire real-services suite down at import.
 *
 * The obvious-looking fix — dropping the `uuid: ">=14.0.0"` override — was
 * MEASURED and rejected: it takes npm audit from 5 vulnerabilities to 13 and
 * surfaces a real uuid advisory. The override is load-bearing.
 *
 * Scope is deliberately narrow. `targets: node current` means no syntax is
 * down-levelled beyond what this Node already runs, so the transform only
 * rewrites module syntax and cannot silently alter behaviour in a library
 * that generates identifiers.
 */
module.exports = {
  presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
};
