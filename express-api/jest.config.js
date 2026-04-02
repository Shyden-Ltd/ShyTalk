module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/src/__tests__/**/*.test.js', '**/tests/**/*.test.js'],
  // Exclude tests that require modules outside the express-api project root
  // (cross-project mocking doesn't work reliably with Jest)
  testPathIgnorePatterns: ['/node_modules/', 'tests/scripts/generate-roadmap-json.test.js'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  collectCoverageFrom: ['src/**/*.js', '!src/__tests__/**'],
};
