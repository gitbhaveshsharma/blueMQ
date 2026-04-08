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

    // Configure Neon client with fetch options for better timeout handling
    sql = neon(config.database.url, {
      fetchOptions: {
        // Set connection timeout to prevent indefinite hanging
        // This helps in environments with poor network connectivity
        signal: null, // Will be set per-query if needed
      },
      // Full results mode for better compatibility
      fullResults: false,
    });
  }
  return sql;
}

/**
 * Execute a query with retry logic and timeout handling.
 * @param {Function} queryFn - The query function to execute
 * @param {number} maxRetries - Maximum number of retry attempts
 * @param {number} retryDelay - Delay between retries in milliseconds
 * @returns {Promise<any>} Query result
 */
async function executeWithRetry(
  queryFn,
  maxRetries = config.database.maxRetries,
  retryDelay = config.database.retryDelayMs,
) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Create an AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        config.database.connectionTimeoutMs,
      );

      try {
        const result = await queryFn();
        clearTimeout(timeoutId);

        if (attempt > 1) {
          console.log(
            `[db] Query succeeded on attempt ${attempt}/${maxRetries}`,
          );
        }

        return result;
      } catch (error) {
        clearTimeout(timeoutId);
        throw error;
      }
    } catch (error) {
      lastError = error;

      const isTimeout =
        error.name === "AbortError" ||
        error.code === "ETIMEDOUT" ||
        error.message?.includes("fetch failed") ||
        error.message?.includes("ETIMEDOUT");

      const isNetworkError =
        error.code === "ECONNREFUSED" ||
        error.code === "ENOTFOUND" ||
        error.code === "ECONNRESET";

      // Retry on timeout or network errors
      if ((isTimeout || isNetworkError) && attempt < maxRetries) {
        const delay = retryDelay * Math.pow(2, attempt - 1); // Exponential backoff
        console.warn(
          `[db] Connection attempt ${attempt}/${maxRetries} failed (${error.code || error.name}). ` +
            `Retrying in ${delay}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      // Don't retry on other errors
      if (!isTimeout && !isNetworkError) {
        throw error;
      }

      // Max retries exhausted
      if (attempt === maxRetries) {
        console.error(
          `[db] Failed after ${maxRetries} attempts. Last error:`,
          error.message || error,
        );
        throw new Error(
          `Database connection failed after ${maxRetries} attempts. ` +
            `Check network connectivity and DATABASE_URL. ` +
            `Original error: ${error.message}`,
        );
      }
    }
  }

  throw lastError;
}

/**
 * Test database connectivity
 * @returns {Promise<boolean>} True if connection successful
 */
async function testConnection() {
  try {
    const sql = getDb();
    await executeWithRetry(() => sql`SELECT 1 as health_check`);
    return true;
  } catch (error) {
    console.error("[db] Health check failed:", error.message);
    return false;
  }
}

module.exports = { getDb, executeWithRetry, testConnection };
