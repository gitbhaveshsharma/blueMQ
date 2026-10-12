"use strict";

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.js"],
  setupFiles: ["./tests/setup.js"],
  // Longer timeout for integration tests that may hit a real DB
  testTimeout: 15000,
  // Don't transform node_modules
  transformIgnorePatterns: ["/node_modules/"],
};
