module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/src/__tests__/**/*.test.js', '**/tests/**/*.test.js'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  collectCoverageFrom: ['src/**/*.js', '!src/__tests__/**'],
};
