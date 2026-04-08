const fs = require("fs");
const path = require("path");
const { getDb, executeWithRetry, testConnection } = require("./index");

/**
 * Run the schema.sql file against Neon to create / update tables.
 * Safe to run multiple times (uses IF NOT EXISTS).
 */
async function migrate() {
  console.log("[migrate] Testing database connection...");
  
  // Test connection before running migration
  const isConnected = await testConnection();
  if (!isConnected) {
    throw new Error(
      "Cannot connect to database. Please check:\n" +
      "  1. DATABASE_URL is correct in .env\n" +
      "  2. Network connectivity to Neon (firewall rules, DNS resolution)\n" +
      "  3. Database is not paused/suspended in Neon console\n" +
      "  4. Your IP is allowed (if IP allowlist is enabled in Neon)"
    );
  }
  
  console.log("[migrate] Connection test successful.");
  
  const sql = getDb();
  const schemaPath = path.join(__dirname, "schema.sql");
  const schemaSql = fs.readFileSync(schemaPath, "utf-8");

  // Neon serverless does not support multi-statement queries in one call.
  // Remove full-line comments first so semicolons in comments do not split statements.
  const sqlWithoutCommentLines = schemaSql
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  const statements = sqlWithoutCommentLines
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  console.log(
    `[migrate] Running schema migration (${statements.length} statements)...`,
  );
  
  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i];
    try {
      await executeWithRetry(() => sql`${sql.unsafe(statement + ";")}`);
      
      // Log progress for long migrations
      if (statements.length > 5 && (i + 1) % 3 === 0) {
        console.log(`[migrate] Progress: ${i + 1}/${statements.length} statements completed`);
      }
    } catch (error) {
      console.error(`[migrate] Failed on statement ${i + 1}:`, statement.substring(0, 100));
      throw error;
    }
  }
  
  console.log("[migrate] Schema migration complete.");
}

// Allow running directly: node src/db/migrate.js
if (require.main === module) {
  migrate()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[migrate] Failed:", err);
      process.exit(1);
    });
}

module.exports = { migrate };
