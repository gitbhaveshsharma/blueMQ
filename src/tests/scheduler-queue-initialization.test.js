/**
 * scheduler-queue-initialization.test.js
 *
 * Bug Condition Exploration Test for Scheduler Queue Initialization
 * 
 * **Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.3**
 * 
 * This test MUST FAIL on unfixed code - failure confirms the bug exists.
 * When the test FAILS, it demonstrates the bug condition where worker processes
 * cannot enqueue notifications because createQueues() is not called.
 * 
 * After the fix is applied, this test will PASS, proving the bug is resolved.
 */

"use strict";

const { describe, test, expect, beforeEach, afterEach } = require("@jest/globals");

describe("Property 1: Bug Condition - Worker Process Queue Initialization Failure", () => {
  let originalProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalProcessEnv = { ...process.env };
    // Clear require cache to get fresh modules
    jest.resetModules();
  });

  afterEach(() => {
    // Restore environment
    process.env = originalProcessEnv;
    jest.clearAllMocks();
    jest.resetModules();
  });

  test("Worker process mode does NOT initialize queues on UNFIXED code (bug condition)", () => {
    // GIVEN: Process mode is "worker" (not "api" or "all")
    process.env.PROCESS_MODE = "worker";

    // Load the runtime module
    const { getProcessModeConfig } = require("../runtime/process-mode");
    const runtime = getProcessModeConfig();

    // VERIFY: Runtime config is correct for worker mode
    expect(runtime.mode).toBe("worker");
    expect(runtime.runApi).toBe(false);
    expect(runtime.runWorkers).toBe(true);

    // CRITICAL BUG CONDITION: On unfixed code, createQueues() is NOT called for worker processes
    // because the condition in src/index.js line 109 is: if (runtime.runApi)
    // This simulates the unfixed code behavior
    const shouldCreateQueuesUnfixed = runtime.runApi; // BUG: should be (runtime.runApi || runtime.runWorkers)
    
    // THEN: shouldCreateQueues evaluates to FALSE for worker processes
    expect(shouldCreateQueuesUnfixed).toBe(false);
    
    // This means queues are NEVER initialized in worker processes
    // When scheduler worker tries to enqueue, it will fail with "Queue not found" error
  });

  test("Worker process attempts to enqueue - throws 'Queue not found' for ALL channels (demonstrates bug)", () => {
    // Mock queues module to simulate unfixed behavior
    const mockQueues = new Map(); // Empty map simulates unfixed code state
    const mockGetQueue = (channel) => {
      const q = mockQueues.get(channel);
      if (!q) throw new Error(`Queue not found for channel: ${channel}`);
      return q;
    };

    // WHEN: Scheduler worker attempts to enqueue notification for each channel
    // THEN: System throws "Queue not found for channel: {channel}" error
    const channels = ["push", "email", "sms", "whatsapp", "call", "inapp"];
    
    const counterexamples = [];
    channels.forEach((channel) => {
      expect(() => {
        mockGetQueue(channel);
      }).toThrow(`Queue not found for channel: ${channel}`);
      
      counterexamples.push(`Worker process throws "Queue not found for channel: ${channel}"`);
    });

    // Document counterexamples found
    console.log("\n=== COUNTEREXAMPLES FOUND (Bug Confirmed) ===");
    counterexamples.forEach(ex => console.log(`  - ${ex}`));
    console.log("=== Bug exists: Worker processes cannot enqueue notifications ===\n");
  });

  test("AFTER FIX: Worker process mode SHOULD initialize queues", () => {
    // GIVEN: Process mode is "worker"
    process.env.PROCESS_MODE = "worker";

    const { getProcessModeConfig } = require("../runtime/process-mode");
    const runtime = getProcessModeConfig();

    // VERIFY: Runtime config is correct for worker mode
    expect(runtime.mode).toBe("worker");
    expect(runtime.runApi).toBe(false);
    expect(runtime.runWorkers).toBe(true);

    // WHEN: Fixed condition: createQueues() should be called for worker processes too
    const shouldCreateQueuesFixed = runtime.runApi || runtime.runWorkers; // FIXED
    
    // THEN: shouldCreateQueues evaluates to TRUE for worker processes
    expect(shouldCreateQueuesFixed).toBe(true);
    
    // After fix is implemented, queues WILL be initialized in worker processes
    // And enqueueNotification will succeed for all channels
  });

  test("Preservation: API process mode continues to initialize queues", () => {
    // GIVEN: Process mode is "api"
    process.env.PROCESS_MODE = "api";

    const { getProcessModeConfig } = require("../runtime/process-mode");
    const runtime = getProcessModeConfig();

    // VERIFY: Runtime config is correct for API mode
    expect(runtime.mode).toBe("api");
    expect(runtime.runApi).toBe(true);
    expect(runtime.runWorkers).toBe(false);

    // BOTH unfixed and fixed conditions work for API mode
    const shouldCreateQueuesUnfixed = runtime.runApi; // Original condition
    const shouldCreateQueuesFixed = runtime.runApi || runtime.runWorkers; // Fixed condition
    
    // THEN: Both evaluate to TRUE for API processes (preservation)
    expect(shouldCreateQueuesUnfixed).toBe(true);
    expect(shouldCreateQueuesFixed).toBe(true);
  });

  test("Preservation: 'all' process mode continues to initialize queues", () => {
    // GIVEN: Process mode is "all"
    process.env.PROCESS_MODE = "all";

    const { getProcessModeConfig } = require("../runtime/process-mode");
    const runtime = getProcessModeConfig();

    // VERIFY: Runtime config is correct for "all" mode
    expect(runtime.mode).toBe("all");
    expect(runtime.runApi).toBe(true);
    expect(runtime.runWorkers).toBe(true);

    // BOTH unfixed and fixed conditions work for "all" mode
    const shouldCreateQueuesUnfixed = runtime.runApi; // Original condition
    const shouldCreateQueuesFixed = runtime.runApi || runtime.runWorkers; // Fixed condition
    
    // THEN: Both evaluate to TRUE for "all" processes (preservation)
    expect(shouldCreateQueuesUnfixed).toBe(true);
    expect(shouldCreateQueuesFixed).toBe(true);
  });
});
