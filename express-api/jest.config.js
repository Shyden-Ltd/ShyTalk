module.exports = {
  testEnvironment: 'node',
  // Capped workers + per-worker idle memory + extended timeout exist
  // together to absorb OS-level resource contention, not slow test logic.
  //
  // * maxWorkers: 2 — fewer workers = more memory each, fewer GC stalls
  //   under sustained load. Higher counts caused per-run flake.
  // * workerIdleMemoryLimit: 1GB — recycle workers when the heap crosses
  //   the limit so memory doesn't accumulate across hundreds of test
  //   files within one worker process.
  // * testTimeout: 10000 — individual tests pass in milliseconds in
  //   isolation. The 5s Jest default triggers false-positive timeouts
  //   only when a worker is mid-GC or supertest's ephemeral HTTP server
  //   is slow to bind under macOS's loopback contention.
  maxWorkers: 2,
  workerIdleMemoryLimit: '1GB',
  testTimeout: 10000,
  // Enable per-test retry for transient socket failures (ECONNRESET / hang up
  // from ephemeral port exhaustion). See jest-retry-setup.js for the why.
  setupFiles: ['./tests/_helpers/jest-retry-setup.js'],
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
