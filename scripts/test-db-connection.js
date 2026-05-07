#!/usr/bin/env node

/**
 * Database Connection Test Script
 *
 * Run this on your server to test database connectivity
 * Usage: node scripts/test-db-connection.js
 */

require("dotenv").config({ quiet: true });
const { installConsoleInterceptors } = require("../src/logger");
const { testConnection, getDb } = require("../src/db");

installConsoleInterceptors();

async function main() {
  console.log("═══════════════════════════════════════════");
  console.log("  BlueMQ — Database Connection Test");
  console.log("═══════════════════════════════════════════\n");

  // Check if DATABASE_URL is set
  if (!process.env.DATABASE_URL) {
    console.error("❌ ERROR: DATABASE_URL is not set in .env");
    process.exit(1);
  }

  // Mask the password in the URL for display
  const maskedUrl = process.env.DATABASE_URL.replace(
    /\/\/([^:]+):([^@]+)@/,
    "//$1:****@",
  );
  console.log("📊 Database URL:", maskedUrl);
  console.log(
    "⏱️  Timeout:",
    process.env.DB_CONNECTION_TIMEOUT_MS || "30000",
    "ms",
  );
  console.log("🔄 Max Retries:", process.env.DB_MAX_RETRIES || "3");
  console.log(
    "⏳ Retry Delay:",
    process.env.DB_RETRY_DELAY_MS || "2000",
    "ms\n",
  );

  console.log("🔍 Testing connection...\n");

  const startTime = Date.now();

  try {
    const isConnected = await testConnection();
    const duration = Date.now() - startTime;

    if (isConnected) {
      console.log(`✅ SUCCESS: Connected to database in ${duration}ms\n`);

      // Run a simple query to verify full functionality
      console.log("🔍 Running test query...");
      const sql = getDb();
      const result =
        await sql`SELECT version() as pg_version, current_database() as db_name, current_user as db_user`;

      console.log("📊 Database Info:");
      console.log("   Version:", result[0].pg_version);
      console.log("   Database:", result[0].db_name);
      console.log("   User:", result[0].db_user);
      console.log("\n✅ All tests passed!");
      process.exit(0);
    } else {
      console.error(
        `❌ FAILED: Could not connect to database after ${duration}ms`,
      );
      console.error("\n🔧 Troubleshooting steps:");
      console.error("   1. Check if DATABASE_URL is correct in .env");
      console.error("   2. Verify database is active in Neon console");
      console.error(
        "   3. Test network connectivity: curl -v https://your-neon-host.neon.tech",
      );
      console.error("   4. Check firewall rules");
      console.error("   5. Review DATABASE_CONNECTION_GUIDE.md for more help");
      process.exit(1);
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`❌ ERROR after ${duration}ms:`, error.message);
    console.error("\n🔧 Error details:");
    console.error("   Type:", error.name || error.code);
    console.error("   Message:", error.message);

    if (error.code === "ETIMEDOUT") {
      console.error("\n💡 This is a timeout error. Possible causes:");
      console.error("   • Slow network connection");
      console.error("   • Firewall blocking port 5432");
      console.error("   • DNS resolution issues");
      console.error(
        "\n   Try increasing timeout: DB_CONNECTION_TIMEOUT_MS=60000",
      );
    } else if (error.code === "ENOTFOUND") {
      console.error("\n💡 DNS resolution failed. Check:");
      console.error("   • Your internet connection");
      console.error("   • DNS server configuration");
      console.error("   • DATABASE_URL hostname is correct");
    } else if (error.message?.includes("password authentication failed")) {
      console.error("\n💡 Authentication error. Check:");
      console.error("   • Database password in DATABASE_URL");
      console.error("   • User exists in Neon console");
    }

    console.error(
      "\n📖 See DATABASE_CONNECTION_GUIDE.md for detailed troubleshooting",
    );
    process.exit(1);
  }
}

// Handle Ctrl+C gracefully
process.on("SIGINT", () => {
  console.log("\n\n⚠️  Test interrupted by user");
  process.exit(130);
});

main();
