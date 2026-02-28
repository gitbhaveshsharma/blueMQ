const fs = require("fs");
const path = require("path");
const { getDb } = require("./index");

/**
 * Run the schema.sql file against Neon to create / update tables.
 * Safe to run multiple times (uses IF NOT EXISTS).
 */
async function migrate() {
  const sql = getDb();
  const schemaPath = path.join(__dirname, "schema.sql");
  const schemaSql = fs.readFileSync(schemaPath, "utf-8");

  // Neon serverless does not support multi-statement queries in one call.
  // Split on semicolons, strip blank/comment-only lines, run each statement.
  const statements = schemaSql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

  console.log(
    `[migrate] Running schema migration (${statements.length} statements)...`,
  );
  for (const statement of statements) {
    await sql.query(statement + ";");
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
