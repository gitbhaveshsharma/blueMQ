# Security Middleware Phase 2 - Advanced Protection Guide

## 🛡️ Overview

Phase 2 adds advanced protection features to BlueMQ:
- **Brute Force Protection** - Exponential backoff for auth failures
- **IP Blacklist Management** - Dynamic IP blocking
- **Threat Scoring System** - Cumulative risk tracking with auto-ban
- **CORS Hardening** - Whitelist-based cross-origin policy

## ⚠️ PRODUCTION-SAFE DESIGN

**All Phase 2 features are DISABLED by default** to ensure zero impact on existing production deployments.

```bash
# Current defaults (safe for production)
SECURITY_ENABLE_IP_BLACKLIST=false
SECURITY_ENABLE_BRUTE_FORCE_PROTECTION=false
SECURITY_ENABLE_THREAT_SCORING=false
SECURITY_THREAT_AUTO_BAN=false
SECURITY_ENABLE_CORS_HARDENING=false
```

✅ **Phase 1 features remain ENABLED** (request validation, rate limiting, security headers)
✅ **Existing traffic flows unchanged**
✅ **No breaking changes to APIs**
✅ **Gradual rollout recommended**

## 📊 Phase 2 Components

### 1. Threat Scoring System

**File:** `src/api/middlewares/threat-scoring.js`

**Purpose:** Track cumulative suspicious behavior per IP with automatic banning at threshold.

**How It Works:**
- Each suspicious event adds points to IP's threat score
- Score decays after 24 hours (configurable)
- Auto-ban triggers when score ≥ threshold (default: 50 points)

**Point Values (configurable):**
```
Path Traversal:        10 points
SQL Injection:         15 points
Exploit Path:           5 points
Failed Auth:            2 points
Rate Limit Hit:         1 point
Suspicious User-Agent:  3 points
```

**Redis Keys:**
```
security:threat:<ip>           → current score
security:threat:log:<ip>       → incident history
```

**Enable (Week 1 - Monitoring Only):**
```bash
SECURITY_ENABLE_THREAT_SCORING=true
SECURITY_THREAT_AUTO_BAN=false  # Don't auto-ban yet
```

**Monitor:**
```bash
# Check threat scores in Redis
redis-cli
> KEYS security:threat:*
> GET security:threat:192.168.1.100
> LRANGE security:threat:log:192.168.1.100 0 -1
```

**Enable Auto-Ban (Week 4 - After confirming no false positives):**
```bash
SECURITY_THREAT_AUTO_BAN=true
SECURITY_THREAT_THRESHOLD=50  # Adjust based on observation
```

### 2. Brute Force Protection

**File:** `src/api/middlewares/brute-force-protection.js`

**Purpose:** Prevent authentication brute force attacks with exponential backoff.

**How It Works:**
- Tracks failed auth attempts per IP
- Applies cooldown after threshold failures
- Detects suspicious patterns (multiple API keys from same IP)
- Auto-bans after excessive attempts

**Cooldown Schedule (configurable):**
```
3 failures  → 60s cooldown (1 minute)
5 failures  → 900s cooldown (15 minutes)
10 failures → 3600s cooldown (1 hour)
20 failures → 86400s cooldown (24 hours) + auto-ban
```

**Redis Keys:**
```
security:auth:failures:<ip>    → failure count
security:auth:cooldown:<ip>    → cooldown expiry
security:auth:attempts:<ip>    → attempted API keys
```

**Enable (Week 2):**
```bash
SECURITY_ENABLE_BRUTE_FORCE_PROTECTION=true
# Optionally adjust thresholds
SECURITY_BRUTE_FORCE_THRESHOLD_1=3
SECURITY_BRUTE_FORCE_COOLDOWN_1=60
```

**Integration Required:**
Update your auth middleware to call the handlers:

```javascript
const { handleAuthFailure, handleAuthSuccess } = require('./api/middlewares/brute-force-protection');

// In your auth middleware
if (authFailed) {
  await handleAuthFailure(req, attemptedApiKey);
  return res.status(401).json({ error: 'Unauthorized' });
}

// On successful auth
await handleAuthSuccess(req);
```

**Monitor:**
```bash
# Check failure counts
redis-cli
> GET security:auth:failures:192.168.1.100
> TTL security:auth:cooldown:192.168.1.100
> LRANGE security:auth:attempts:192.168.1.100 0 -1
```

### 3. IP Blacklist Management

**File:** `src/api/middlewares/ip-access-control.js`

**Purpose:** Dynamic IP blocking with temporary or permanent bans.

**How It Works:**
- Checks blacklist before any request processing
- Supports temporary bans (with duration) or permanent bans
- Can be triggered manually or automatically (threat score)
- Respects IP whitelist (whitelisted IPs bypass blacklist)

**Redis Keys:**
```
security:blacklist:<ip>  → ban info (reason, duration, expiry)
```

**Enable (Week 3 - Manual bans only):**
```bash
SECURITY_ENABLE_IP_BLACKLIST=true
SECURITY_THREAT_AUTO_BAN=false  # Manual bans only initially
```

**Manual Ban API (to be added in Phase 3):**
```javascript
const { blacklistIP, unblacklistIP } = require('./api/middlewares/ip-access-control');

// Ban IP for 24 hours
await blacklistIP('192.168.1.100', 86400, 'Repeated SQL injection attempts');

// Permanent ban
await blacklistIP('192.168.1.100', 0, 'Confirmed attacker');

// Remove ban
await unblacklistIP('192.168.1.100');
```

**Monitor:**
```bash
# Check if IP is blacklisted
redis-cli
> GET security:blacklist:192.168.1.100
> TTL security:blacklist:192.168.1.100
```

### 4. CORS Hardening

**File:** `src/api/middlewares/cors-hardened.js`

**Purpose:** Restrict cross-origin requests to trusted domains only.

**How It Works:**
- Whitelist-based origin validation
- Supports exact match, wildcard domains (*.example.com)
- Falls back to permissive CORS when disabled
- Configurable methods, headers, credentials

**Enable (Week 5+ - After listing all origins):**

```bash
# List ALL legitimate frontend origins
SECURITY_CORS_ALLOWED_ORIGINS=https://app.example.com,https://www.example.com,https://admin.example.com

# Or use wildcard for subdomains
SECURITY_CORS_ALLOWED_ORIGINS=*.example.com,https://example.com

# Then enable hardening
SECURITY_ENABLE_CORS_HARDENING=true
```

**⚠️ CRITICAL:**
- **List ALL origins before enabling** or legitimate requests will be blocked
- Test in staging first
- Monitor for CORS errors in browser console

**Development Override:**
```bash
# Development (permissive)
SECURITY_ENABLE_CORS_HARDENING=false

# Or allow localhost
SECURITY_CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
```

## 🚀 Recommended Rollout Plan

### Week 1: Threat Scoring (Monitoring Only)

**Enable:**
```bash
SECURITY_ENABLE_THREAT_SCORING=true
SECURITY_THREAT_AUTO_BAN=false
```

**Monitor:**
- Check `security:threat:*` keys in Redis daily
- Review threat logs for false positives
- Identify top threat scores and validate they're actual threats
- Adjust point values if needed

**Metrics to Watch:**
```bash
redis-cli
> KEYS security:threat:*
> GET security:metrics:requests.blocked.sql_injection
> GET security:metrics:requests.blocked.path_traversal
```

### Week 2: Brute Force Protection

**Enable:**
```bash
SECURITY_ENABLE_BRUTE_FORCE_PROTECTION=true
```

**Update Auth Middleware:**
```javascript
// Add to your existing auth middleware
const { handleAuthFailure, handleAuthSuccess } = require('./api/middlewares/brute-force-protection');

// On auth failure:
await handleAuthFailure(req, apiKey);

// On auth success:
await handleAuthSuccess(req);
```

**Monitor:**
- Check cooldown triggers (should be rare for legitimate users)
- Watch for false positives (users reporting they can't log in)
- Review pattern detection (multiple API key attempts)

**Metrics to Watch:**
```bash
> KEYS security:auth:failures:*
> KEYS security:auth:cooldown:*
```

### Week 3: IP Blacklist (Manual Only)

**Enable:**
```bash
SECURITY_ENABLE_IP_BLACKLIST=true
SECURITY_THREAT_AUTO_BAN=false  # Still manual
```

**Monitor:**
- No automatic bans yet
- Use manual ban API for confirmed attackers
- Track false positive reports

### Week 4: Auto-Ban (If No False Positives)

**Enable (ONLY if Week 1-3 showed no false positives):**
```bash
SECURITY_THREAT_AUTO_BAN=true
```

**Monitor:**
- Check banned IPs daily
- Implement unban process for false positives
- Review threat scores triggering bans

**Emergency Rollback:**
```bash
SECURITY_THREAT_AUTO_BAN=false
# Or disable entirely:
SECURITY_ENABLE_THREAT_SCORING=false
```

### Week 5+: CORS Hardening (After Confirming Origins)

**Prepare:**
1. List ALL current origins from access logs:
   ```bash
   grep "Origin:" /var/log/nginx/access.log | awk '{print $X}' | sort -u
   ```

2. Add to config:
   ```bash
   SECURITY_CORS_ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com
   ```

3. Test in staging with ALL frontend apps

**Enable:**
```bash
SECURITY_ENABLE_CORS_HARDENING=true
```

**Monitor:**
- Watch for CORS errors in browser consoles
- Check server logs for blocked origins
- Have rollback ready

**Emergency Rollback:**
```bash
SECURITY_ENABLE_CORS_HARDENING=false
```

## 📈 Monitoring Commands

### Check Threat Scores
```bash
redis-cli
> KEYS security:threat:*
> GET security:threat:192.168.1.100
> LRANGE security:threat:log:192.168.1.100 0 20
```

### Check Auth Failures
```bash
> GET security:auth:failures:192.168.1.100
> TTL security:auth:cooldown:192.168.1.100
> LRANGE security:auth:attempts:192.168.1.100 0 -1
```

### Check Blacklist
```bash
> GET security:blacklist:192.168.1.100
> TTL security:blacklist:192.168.1.100
```

### Check Metrics
```bash
> GET security:metrics:requests.blocked.validation
> GET security:metrics:rate_limit.exceeded.auth
```

## 🆘 Troubleshooting

### False Positive: Legitimate User Blocked

**Symptom:** User reports they can't access the service

**Check:**
```bash
redis-cli
# Check if IP is blacklisted
> GET security:blacklist:<user-ip>

# Check threat score
> GET security:threat:<user-ip>

# Check auth failures
> GET security:auth:failures:<user-ip>
```

**Fix:**
```bash
# Remove from blacklist
> DEL security:blacklist:<user-ip>

# Reset threat score
> DEL security:threat:<user-ip>
> DEL security:threat:log:<user-ip>

# Reset auth failures
> DEL security:auth:failures:<user-ip>
> DEL security:auth:cooldown:<user-ip>
```

**Prevent:**
```bash
# Add to whitelist
SECURITY_WHITELIST_IPS=...,<user-ip>
```

### CORS Errors After Enabling Hardening

**Symptom:** Browser console shows "blocked by CORS policy"

**Fix:**
1. Check the origin in error message
2. Add to allowed origins:
   ```bash
   SECURITY_CORS_ALLOWED_ORIGINS=...,https://new-origin.com
   ```
3. Restart server

**Emergency Rollback:**
```bash
SECURITY_ENABLE_CORS_HARDENING=false
```

### Too Many Auto-Bans

**Symptom:** Many IPs getting banned, false positive reports

**Fix:**
1. Disable auto-ban immediately:
   ```bash
   SECURITY_THREAT_AUTO_BAN=false
   ```

2. Increase threshold:
   ```bash
   SECURITY_THREAT_THRESHOLD=100  # Was 50
   ```

3. Review point values (may be too high):
   ```bash
   SECURITY_THREAT_POINTS_SQL_INJECTION=10  # Was 15
   SECURITY_THREAT_POINTS_PATH_TRAVERSAL=5   # Was 10
   ```

4. Monitor for a week before re-enabling

## 🔍 Testing Phase 2

### Test Threat Scoring
```bash
# Enable threat scoring
export SECURITY_ENABLE_THREAT_SCORING=true
export SECURITY_THREAT_AUTO_BAN=false

# Trigger suspicious requests
for i in {1..10}; do
  curl "http://localhost:3001/api?q=../../etc/passwd"
done

# Check threat score
redis-cli GET security:threat:::ffff:127.0.0.1
# Should show ~100 points (10 attempts × 10 points)
```

### Test Brute Force Protection
```bash
# Enable brute force protection
export SECURITY_ENABLE_BRUTE_FORCE_PROTECTION=true

# Trigger auth failures
for i in {1..5}; do
  curl -X POST http://localhost:3001/auth/login \
    -H "Content-Type: application/json" \
    -d '{"apiKey": "wrong-key"}'
done

# 6th attempt should be blocked with 429
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"apiKey": "wrong-key"}'

# Check cooldown
redis-cli TTL security:auth:cooldown:::ffff:127.0.0.1
```

### Test IP Blacklist
```bash
# Enable blacklist
export SECURITY_ENABLE_IP_BLACKLIST=true

# Manually ban localhost (for testing)
redis-cli SETEX security:blacklist:::ffff:127.0.0.1 60 '{"reason":"test"}'

# Try request - should get 403
curl http://localhost:3001/health

# Remove ban
redis-cli DEL security:blacklist:::ffff:127.0.0.1
```

## ✅ Production Checklist

Before enabling in production:

**Week 1 (Threat Scoring):**
- [ ] Enabled in staging for 7 days
- [ ] Monitored threat scores daily
- [ ] No false positives observed
- [ ] Point values validated

**Week 2 (Brute Force):**
- [ ] Auth middleware integrated with handlers
- [ ] Tested cooldown behavior
- [ ] Legitimate users not affected
- [ ] Pattern detection working

**Week 3 (IP Blacklist):**
- [ ] Manual ban/unban process documented
- [ ] Team trained on unban procedure
- [ ] Whitelist IPs documented

**Week 4 (Auto-Ban):**
- [ ] Zero false positives in 3 weeks
- [ ] Unban procedure tested
- [ ] Threshold validated
- [ ] Monitoring alerts configured

**Week 5+ (CORS Hardening):**
- [ ] ALL origins documented
- [ ] Tested with all frontend apps
- [ ] Rollback procedure ready
- [ ] Team notified of change

## 📊 Success Metrics

- **Threat Score Accuracy:** >95% of high scores are actual threats
- **False Positive Rate:** <0.1% of legitimate users affected
- **Auto-Ban Accuracy:** >99% of bans are valid attackers
- **CORS Errors:** Zero errors after hardening enabled

---

**Phase 2 Status:** ✅ Implemented, PRODUCTION-SAFE (disabled by default)
**Rollout:** Gradual, 5+ week plan with monitoring
**Rollback:** Simple - disable feature flags
