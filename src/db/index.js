const { Pool } = require("pg");
const config = require("../config");

let pool;
let sqlClient;

// Categorise errors so callers can react appropriately
const ErrorType = {
  CONNECTION: "CONNECTION_ERROR",
  TIMEOUT: "TIMEOUT_ERROR",
  AUTH: "AUTH_ERROR",
  QUERY: "QUERY_ERROR",
  UNKNOWN: "UNKNOWN_ERROR",
};

function classifyError(error) {
  const msg = error.message?.toLowerCase() ?? "";
  const code = error.code ?? "";

  if (["28p01", "28000"].includes(code)) return ErrorType.AUTH; // bad credentials
  if (
    ["econnrefused", "enotfound", "econnreset", "enetunreach"].includes(
      code.toLowerCase(),
    )
  )
    return ErrorType.CONNECTION;
  if (
    code === "ETIMEDOUT" ||
    msg.includes("timeout") ||
    msg.includes("timed out")
  )
    return ErrorType.TIMEOUT;
  if (
    error.severity === "ERROR" ||
    code.startsWith("42") ||
    code.startsWith("23")
  )
    return ErrorType.QUERY; // syntax / constraint
  return ErrorType.UNKNOWN;
}

function isRetryable(error) {
  const type = classifyError(error);
  return [ErrorType.CONNECTION, ErrorType.TIMEOUT, ErrorType.UNKNOWN].includes(
    type,
  );
}

class DbError extends Error {
  constructor(message, { type, cause, attempt, maxRetries } = {}) {
    super(message);
    this.name = "DbError";
    this.type = type ?? ErrorType.UNKNOWN;
    this.cause = cause ?? null;
    this.attempt = attempt ?? null;
    this.maxRetries = maxRetries ?? null;
  }
}

function buildTaggedQuery(strings, values) {
  let text = "";
  const params = [];

  for (let i = 0; i < strings.length; i++) {
    text += strings[i];
    if (i < values.length) {
      params.push(values[i]);
      text += `$${params.length}`;
    }
  }

  return { text, params };
}

function createSqlClient(poolRef) {
  const sql = async (strings, ...values) => {
    if (
      !Array.isArray(strings) ||
      !Object.prototype.hasOwnProperty.call(strings, "raw")
    ) {
      throw new TypeError("sql must be used as a tagged template literal");
    }

    const { text, params } = buildTaggedQuery(strings, values);
    const result = await executeWithRetry(() => poolRef.query(text, params));
    return result.rows;
  };

  // Keep raw query support for migration and health checks.
  sql.query = (text, params = []) =>
    executeWithRetry(() => poolRef.query(text, params));
  sql.raw = poolRef;

  return sql;
}

function getDb() {
  if (!pool) {
    if (!config.database.url) {
      throw new DbError("DATABASE_URL is not set", { type: ErrorType.CONFIG });
    }

    pool = new Pool({
      connectionString: config.database.url,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: config.database.connectionTimeoutMs || 30000,
      idleTimeoutMillis: 60000, // release idle clients after 60s
      max: 10,
    });

    // Log pool-level errors so they don't crash the process silently
    pool.on("error", (err, client) => {
      console.error("[db] Unexpected pool client error:", {
        message: err.message,
        code: err.code,
        type: classifyError(err),
      });
    });

    pool.on("connect", () => {
      console.log("[db] New client connected to pool");
    });

    sqlClient = createSqlClient(pool);
  }
  return sqlClient;
}

async function executeWithRetry(
  queryFn,
  maxRetries = config.database?.maxRetries ?? 3,
  retryDelay = config.database?.retryDelayMs ?? 2000,
) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await queryFn();
      if (attempt > 1) {
        console.log(`[db] Query succeeded on attempt ${attempt}/${maxRetries}`);
      }
      return result;
    } catch (error) {
      lastError = error;
      const type = classifyError(error);

      // Auth and query errors are permanent — no point retrying
      if (!isRetryable(error)) {
        console.error(`[db] Non-retryable error (${type}):`, {
          message: error.message,
          code: error.code,
          detail: error.detail ?? null,
        });
        throw new DbError(`Query failed: ${error.message}`, {
          type,
          cause: error,
          attempt,
          maxRetries,
        });
      }

      if (attempt < maxRetries) {
        const delay = retryDelay * Math.pow(2, attempt - 1); // exponential backoff
        console.warn(
          `[db] Attempt ${attempt}/${maxRetries} failed (${type} — ${error.code ?? error.message}). Retrying in ${delay}ms...`,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  // All retries exhausted
  console.error(`[db] All ${maxRetries} attempts failed. Last error:`, {
    message: lastError.message,
    code: lastError.code,
    type: classifyError(lastError),
  });

  throw new DbError(
    `Database connection failed after ${maxRetries} attempts. Original error: ${lastError.message}`,
    {
      type: classifyError(lastError),
      cause: lastError,
      attempt: maxRetries,
      maxRetries,
    },
  );
}

async function testConnection() {
  try {
    const db = getDb();
    const start = Date.now();
    await db.query("SELECT 1 AS health_check");
    console.log(`[db] Connection test successful (${Date.now() - start}ms)`);
    return true;
  } catch (error) {
    const type = classifyError(error);
    console.error("[db] Health check failed:", {
      message: error.message,
      code: error.code ?? null,
      type,
      hint: getHint(type),
    });
    return false;
  }
}

// Human-readable hints per error type
function getHint(type) {
  const hints = {
    [ErrorType.AUTH]: "Check DATABASE_URL username and password",
    [ErrorType.CONNECTION]:
      "Check network connectivity and Neon firewall / IP allowlist",
    [ErrorType.TIMEOUT]:
      "Neon may be paused or the droplet is blocking outbound port 5432",
    [ErrorType.QUERY]:
      "SQL syntax or constraint violation — not a connection issue",
    [ErrorType.UNKNOWN]: "Check Neon console for database status",
  };
  return hints[type] ?? "Unknown error";
}

async function closePool() {
  if (pool) {
    console.log("[db] Closing connection pool...");
    await pool.end();
    pool = null;
    sqlClient = null;
    console.log("[db] Pool closed");
  }
}

module.exports = {
  getDb,
  executeWithRetry,
  testConnection,
  closePool,
  DbError,
  ErrorType,
};
