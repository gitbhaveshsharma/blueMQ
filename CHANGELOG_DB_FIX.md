# Database Connection Fix - Changelog

## Issue Summary

**Problem:** BlueMQ application was experiencing connection timeouts (`ETIMEDOUT`) when connecting to Neon database on Ubuntu droplet, while working perfectly on Windows development environment.

**Root Cause:**

- The `@neondatabase/serverless` driver uses `fetch` internally, which can timeout differently based on network conditions
- No retry logic existed for transient network failures
- No connection timeout configuration
- No health check before running migrations

## Changes Made

### 1. Enhanced Database Configuration (`src/config/index.js`)

Added configurable connection parameters:

```javascript
database: {
  url: process.env.DATABASE_URL,
  connectionTimeoutMs: parseInt(process.env.DB_CONNECTION_TIMEOUT_MS, 10) || 30000,
  maxRetries: parseInt(process.env.DB_MAX_RETRIES, 10) || 3,
  retryDelayMs: parseInt(process.env.DB_RETRY_DELAY_MS, 10) || 2000,
}
```

### 2. Retry Logic (`src/db/index.js`)

**New Functions:**

- **`executeWithRetry(queryFn, maxRetries, retryDelay)`**
  - Executes queries with automatic retry on network errors
  - Uses exponential backoff (2x delay each retry)
  - Handles `ETIMEDOUT`, `ECONNREFUSED`, `ENOTFOUND`, `ECONNRESET`
  - Clear console logging for debugging

- **`testConnection()`**
  - Health check function using `SELECT 1`
  - Returns boolean for connection status
  - Used before migrations to fail fast

**Features:**

- Configurable timeout per query using AbortController
- Exponential backoff: 2s → 4s → 8s (default)
- Detailed error messages with troubleshooting hints
- Progress logging on retry attempts

### 3. Enhanced Migration (`src/db/migrate.js`)

**Improvements:**

- Pre-flight health check before running any SQL
- Uses `executeWithRetry()` for each statement
- Progress logging every 3 statements (for visibility)
- Better error messages with helpful diagnostics
- Fails fast with actionable error message if connection test fails

### 4. Environment Variables (`.env`)

**New Optional Variables:**

```bash
DB_CONNECTION_TIMEOUT_MS=30000    # Connection timeout (default: 30s)
DB_MAX_RETRIES=3                   # Max retry attempts (default: 3)
DB_RETRY_DELAY_MS=2000             # Initial retry delay (default: 2s)
```

### 5. Documentation

**Created Files:**

- `DATABASE_CONNECTION_GUIDE.md` - Comprehensive troubleshooting guide
- `CHANGELOG_DB_FIX.md` - This file

## How It Works

### Before (Original Code)

```javascript
const sql = getDb();
await sql.query(statement); // ❌ Fails immediately on timeout
```

### After (Enhanced Code)

```javascript
const sql = getDb();
await executeWithRetry(() => sql`${statement}`); // ✅ Retries up to 3 times
```

**Flow:**

1. Attempt connection with 30s timeout
2. If `ETIMEDOUT`: Wait 2s → Retry (attempt 2)
3. If timeout again: Wait 4s → Retry (attempt 3)
4. If timeout again: Wait 8s → Retry (attempt 4, if maxRetries=4)
5. If all fail: Throw detailed error with troubleshooting steps

## Testing

### Local (Windows) ✅

```bash
npm run migrate
# Output:
# [migrate] Testing database connection...
# [migrate] Connection test successful.
# [migrate] Running schema migration (13 statements)...
# [migrate] Progress: 3/13 statements completed
# [migrate] Schema migration complete.
```

### Production (Ubuntu Droplet)

Deploy and test with:

```bash
ssh user@droplet-ip
cd ~/blueMQ
git pull
pm2 delete bluemq
pm2 start ecosystem.config.js
pm2 logs bluemq
```

Expected behavior:

- If network is slow: Should see retry messages but succeed
- If network is down: Clear error message with troubleshooting steps
- If DB is suspended: Health check fails with helpful message

## Benefits

1. **Resilience:** Handles transient network issues automatically
2. **Visibility:** Clear logs show what's happening during retries
3. **Configurability:** Tune timeouts/retries per environment
4. **Debugging:** Better error messages save debugging time
5. **Backward Compatible:** Works with all existing code using `getDb()`

## Recommended Settings

### Development (Good Network)

Use defaults - no env vars needed.

### Production - DigitalOcean Droplet (Variable Network)

```bash
DB_CONNECTION_TIMEOUT_MS=60000
DB_MAX_RETRIES=5
DB_RETRY_DELAY_MS=3000
```

### Production - Railway/AWS/Vercel (Excellent Network)

```bash
DB_CONNECTION_TIMEOUT_MS=15000
DB_MAX_RETRIES=2
```

## Migration Path

1. ✅ Changes are backward compatible
2. ✅ No breaking changes to API
3. ✅ Existing code continues to work
4. ✅ Optional env vars (defaults work fine)
5. ✅ Can be rolled back by setting `DB_MAX_RETRIES=1`

## Future Improvements

Consider these enhancements if issues persist:

1. **Connection pooling** - Use `pg` with connection pools for better performance
2. **Circuit breaker** - Stop trying after repeated failures
3. **Metrics** - Track retry rates, latency
4. **Alternative driver** - Fallback to `pg` if `@neondatabase/serverless` continues to have issues
5. **Local caching** - Cache some queries to reduce DB load

## Monitoring

Watch for these log patterns:

**Success:**

```
[migrate] Testing database connection...
[migrate] Connection test successful.
```

**Retry (Normal):**

```
[db] Connection attempt 1/3 failed (ETIMEDOUT). Retrying in 2000ms...
[db] Query succeeded on attempt 2/3
```

**Failure:**

```
[db] Failed after 3 attempts. Last error: ...
[migrate] Failed: Cannot connect to database. Please check: ...
```

## Rollback Plan

If issues arise:

```bash
# Option 1: Disable retries (instant fail)
DB_MAX_RETRIES=1

# Option 2: Git revert
git log --oneline -5  # Find commit before this change
git revert <commit-hash>
```

## Author & Date

**Fixed by:** GitHub Copilot CLI
**Date:** 2026-04-08
**Issue:** Database connection timeouts on Ubuntu droplet
**Status:** ✅ Ready for production testing
