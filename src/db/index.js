const { neon } = require("@neondatabase/serverless");
const config = require("../config");

let sql;

/**
 * Get the Neon SQL tagged-template client.
 * Lazily initialised on first call.
 */
function getDb() {
  if (!sql) {
    if (!config.database.url) {
      throw new Error("DATABASE_URL is not set");
    }
    sql = neon(config.database.url);
  }
  return sql;
}

module.exports = { getDb };
