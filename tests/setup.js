"use strict";

// Suppress console.warn/log in tests unless explicitly needed
if (!process.env.VERBOSE_TESTS) {
  global.console.log = jest.fn();
  global.console.warn = jest.fn();
}
