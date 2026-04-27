module.exports = {
  testEnvironment: 'node',
  // 2 workers + 256MB recycle threshold + 10s test timeout combine to
  // produce deterministic runs across the 4225-test suite.
  //
  // * maxWorkers: 2 — fewer workers = more memory each, fewer GC stalls
  //   under sustained load. Higher counts caused per-run flake.
  // * workerIdleMemoryLimit: 256MB — recycle workers eagerly so heap
  //   doesn't accumulate across hundreds of test files in one process.
  // * testTimeout: 10000 — every test in this suite passes in <100ms in
  //   isolation. The 5s Jest default starts triggering false-positive
  //   timeouts only when a worker is mid-GC or supertest's ephemeral HTTP
  //   server is slow to bind under macOS's loopback contention. 10s is
  //   *not* slack for slow test logic — it's slack for OS-level resource
  //   contention that's invisible to the test code itself.
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
