# Phase 2 Security - NOW ENABLED

## Date: October 24, 2026

## Reason for Activation
Active attack scanning detected from multiple sources:
- TLM-Audit-Scanner/2.0
- libredtail-http  
- metabase-cve-2026-72898-detect

Attacks being blocked:
- SQL injection attempts (/*,  /auth/*, /users/*, /v1/*)
- Exploit path scanning (/.env, /phpinfo.php, PHPUnit)
- Credential harvesting (/credentials, /config.js)

## Enabled Features

### ✅ Threat Scoring (ACTIVE)
- Tracks attack patterns per IP
- Auto-ban at 50 points (24hr ban)
- Points: SQL=15, Path Traversal=10, Exploit=5

### ✅ IP Blacklist (ACTIVE)
- Automatically bans malicious IPs
- Default ban duration: 24 hours
- Manual unbanning via Redis

### ✅ Brute Force Protection (ACTIVE)
- Tracks authentication failures
- Cooldown: 3 failures = 60s, 5 = 15min, 10 = 1hr

### ⚠️ CORS Hardening (DISABLED)
- Allowed origins: https://mentoracity.com
- Currently using permissive CORS
- Enable when ready: SECURITY_ENABLE_CORS_HARDENING=true

## Configuration

```bash
SECURITY_ENABLE_THREAT_SCORING=true
SECURITY_THREAT_AUTO_BAN=true
SECURITY_THREAT_THRESHOLD=50

SECURITY_ENABLE_IP_BLACKLIST=true
SECURITY_DEFAULT_BAN_DURATION=86400

SECURITY_ENABLE_BRUTE_FORCE_PROTECTION=true

SECURITY_CORS_ALLOWED_ORIGINS=https://mentoracity.com,https://www.mentoracity.com
SECURITY_ENABLE_CORS_HARDENING=false
```

## Monitoring

### Check Threat Scores
```bash
redis-cli KEYS "security:threat:*"
redis-cli GET "security:threat:<IP>"
```

### Check Banned IPs
```bash
redis-cli KEYS "security:blacklist:*"
```

### Check Brute Force Tracking
```bash
redis-cli KEYS "security:auth:failures:*"
redis-cli KEYS "security:auth:cooldown:*"
```

### View Security Logs
```bash
pm2 logs bluemq | grep "\[security\]"
```

## Expected Behavior

1. **First Attack**: Threat score incremented
2. **Multiple Attacks**: Score accumulates
3. **Score ≥ 50**: IP automatically banned for 24 hours
4. **Banned Request**: Returns 403 Forbidden
5. **After 24hrs**: Ban expires, IP can retry

## Manual IP Management

### Ban an IP manually
```bash
redis-cli SETEX "security:blacklist:<IP>" 86400 '{"reason":"manual ban","timestamp":"2026-10-24"}'
```

### Unban an IP
```bash
redis-cli DEL "security:blacklist:<IP>"
redis-cli DEL "security:threat:<IP>"
redis-cli DEL "security:auth:failures:<IP>"
```

## Next Steps

1. ✅ Restart server to apply Phase 2
2. ✅ Monitor logs for 24-48 hours
3. ⚠️ Watch for false positives
4. ⚠️ Enable CORS hardening when Mentoracity frontend is ready

## Rollback Plan

If issues occur, disable Phase 2:
```bash
SECURITY_ENABLE_THREAT_SCORING=false
SECURITY_ENABLE_IP_BLACKLIST=false
SECURITY_ENABLE_BRUTE_FORCE_PROTECTION=false
```

Then restart server.

---

**Status: ✅ ACTIVE IN PRODUCTION**
