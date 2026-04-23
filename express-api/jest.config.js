module.exports = {
  testEnvironment: 'node',
  restoreMocks: true,
  clearMocks: true,
  resetMocks: false,
  testMatch: ['**/src/__tests__/**/*.test.js', '**/tests/**/*.test.js'],
  // Exclude tests that require modules outside the express-api project root
  // (cross-project mocking doesn't work reliably with Jest)
  testPathIgnorePatterns: ['/node_modules/', 'tests/scripts/generate-roadmap-json.test.js'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  collectCoverageFrom: ['src/**/*.js', '!src/__tests__/**'],
  // Strip `export` keyword from public/js/core/*.js so ESM browser modules
  // can be require()'d in Jest's CJS test environment. Only affects files
  // outside express-api — does NOT transform any express source files.
  // NOTE: adding `transform` overrides Jest's default babel-jest for ALL
  // .js files, so we re-add babel-jest as the fallback for non-matching paths.
  transform: {
    'public[\\\\/]js[\\\\/]core[\\\\/].*\\.js$': '<rootDir>/tests/client-core/esm-transform.js',
    '\\.js$': 'babel-jest',
  },
};
