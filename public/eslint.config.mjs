// SHY-0448 — the admin dashboard's JavaScript, linted at last.
//
// `public/**` was in none of lint-staged's three globs, so every file under
// `public/admin/js/` was committed without ESLint or Prettier ever seeing it.
// That is the wrong surface to leave unchecked: these files take text written
// by members of the public and put it into `innerHTML`, and the discipline
// keeping that safe was entirely manual.
//
// Its own config rather than express-api's, because that one is
// `sourceType: 'commonjs'` with Node globals — the opposite of browser code.
import js from '../express-api/node_modules/@eslint/js/src/index.js';
import globals from '../express-api/node_modules/globals/index.js';

export default [
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      // Module, not script: much of public/ uses import/export, and module
      // parsing reads a plain script correctly while the reverse is a parse
      // error on every import line.
      sourceType: 'module',
      globals: {
        ...globals.browser,
        // Loaded by their own <script> tags before these files run, so they
        // are genuinely global here. Declared rather than silenced: 84 of the
        // first pass's 133 findings were these, and leaving them as errors
        // would have buried the ~19 real ones.
        sgT: 'readonly', // shared translation helper
        LEGAL_T: 'readonly', // legal-page translations
        module: 'readonly', // UMD guards: `typeof module !== 'undefined'`
        // Optional at runtime and used behind `typeof X !== 'undefined'`
        // guards. Declared so the guarded call is not reported: the guard is
        // the point, and flagging it would train people to delete guards.
        ShyTalkLogger: 'readonly',
        loadAuditLog: 'readonly',
      },
    },
    rules: {
      // Started as a report rather than a wall: this surface has never been
      // linted, so the first pass is about finding real defects, not about
      // style. Style is Prettier's job and it runs alongside.
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always'],
      'no-undef': 'error',
    },
  },
  {
    // Vendored and minified. Linting someone else's bundle reports their
    // choices, not ours.
    ignores: ['**/*.min.js', '**/vendor/**'],
  },
];
