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

  console.log("[migrate] Running schema migration...");
  await sql.query(schemaSql);
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
