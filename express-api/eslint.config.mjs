import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import sonarjs from 'eslint-plugin-sonarjs';

export default [
  js.configs.recommended,
  prettier,
  {
    plugins: { sonarjs },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: {
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-console': 'warn',
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-throw-literal': 'error',
      'no-shadow': 'warn',
      // SonarCloud security hotspot rules (caught locally before CI)
      'sonarjs/pseudo-random': 'warn',
      'sonarjs/slow-regex': 'error',
      'sonarjs/no-os-command-from-path': 'warn',
      'sonarjs/no-hardcoded-passwords': 'error',
      'sonarjs/no-hardcoded-secrets': 'error',
      'sonarjs/no-clear-text-protocols': 'error',
    },
  },
  {
    ignores: ['node_modules/', 'coverage/', 'eslint.config.mjs'],
  },
];
