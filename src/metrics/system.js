"use strict";

/**
 * Custom system metrics: swap memory monitoring
 * 
 * Collects swap/page file usage metrics that aren't provided by
 * @opentelemetry/instrumentation-host-metrics.
 * 
 * Platform support:
 * - Linux: reads /proc/meminfo
 * - Windows: uses wmic (basic support)
 * - Other: returns 0 (no swap data)
 */

const { metrics } = require('@opentelemetry/api');
const fs = require('fs');

const meter = metrics.getMeter('blueMQ-system', '1.0.0');

// Observable gauges for swap memory
const swapUsageGauge = meter.createObservableGauge('system.swap.usage', {
  description: 'Swap memory usage in bytes',
  unit: 'By',
});

const swapUtilizationGauge = meter.createObservableGauge('system.swap.utilization', {
  description: 'Swap memory utilization ratio (0-1)',
  unit: '1',
});

/**
 * Get swap/page file info for Linux
 */
function getLinuxSwap() {
  try {
    const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
    
    const swapTotalMatch = meminfo.match(/SwapTotal:\s+(\d+)\s+kB/);
    const swapFreeMatch = meminfo.match(/SwapFree:\s+(\d+)\s+kB/);
    
    if (!swapTotalMatch || !swapFreeMatch) {
      return { total: 0, used: 0, free: 0, utilization: 0 };
    }
    
    const swapTotal = parseInt(swapTotalMatch[1]) * 1024; // Convert kB to bytes
    const swapFree = parseInt(swapFreeMatch[1]) * 1024;
    const swapUsed = swapTotal - swapFree;
    
    return {
      total: swapTotal,
      used: swapUsed,
      free: swapFree,
      utilization: swapTotal > 0 ? swapUsed / swapTotal : 0,
    };
  } catch (err) {
    process.stderr.write(`[system-metrics] Linux swap read error: ${err.message}\n`);
    return { total: 0, used: 0, free: 0, utilization: 0 };
  }
}

/**
 * Get page file info for Windows (basic support)
 * Note: Windows swap monitoring disabled - only works on Linux production
 */
function getWindowsSwap() {
  // Windows swap monitoring not implemented
  // Use Linux production server for actual swap monitoring
  return { total: 0, used: 0, free: 0, utilization: 0 };
}

/**
 * Get swap info for current platform
 */
function getSwapInfo() {
  switch (process.platform) {
    case 'linux':
      return getLinuxSwap();
    case 'win32':
      return getWindowsSwap();
    default:
      // MacOS, FreeBSD, etc - not implemented
      return { total: 0, used: 0, free: 0, utilization: 0 };
  }
}

// Register observable callbacks
swapUsageGauge.addCallback((observableResult) => {
  const swap = getSwapInfo();
  
  // Report both used and total with state label
  observableResult.observe(swap.used, { state: 'used' });
  observableResult.observe(swap.total, { state: 'total' });
  observableResult.observe(swap.free, { state: 'free' });
});

swapUtilizationGauge.addCallback((observableResult) => {
  const swap = getSwapInfo();
  observableResult.observe(swap.utilization);
});

// Log initialization
if (process.platform === 'linux') {
  process.stderr.write('[system-metrics] Swap monitoring enabled (Linux)\n');
} else if (process.platform === 'win32') {
  process.stderr.write('[system-metrics] Swap monitoring disabled (Windows dev - will work on Linux production)\n');
} else {
  process.stderr.write(`[system-metrics] Swap monitoring not supported for platform: ${process.platform}\n`);
}

module.exports = { getSwapInfo };
