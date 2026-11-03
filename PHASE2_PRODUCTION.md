# Phase 2 Security - Production Configuration

## Date: October 24, 2026

## ✅ Production-Ready Settings

### Enabled Features
```bash
# Threat Scoring - Auto-ban malicious IPs
SECURITY_ENABLE_THREAT_SCORING=true
SECURITY_THREAT_AUTO_BAN=true
SECURITY_THREAT_THRESHOLD=50

# IP Blacklist - 24 hour bans
SECURITY_ENABLE_IP_BLACKLIST=true
SECURITY_DEFAULT_BAN_DURATION=86400

# Brute Force Protection - Auth cooldowns
SECURITY_ENABLE_BRUTE_FORCE_PROTECTION=true

# CORS - Mentoracity origins (hardening disabled)
SECURITY_CORS_ALLOWED_ORIGINS=https://mentoracity.com,https://www.mentoracity.com
SECURITY_ENABLE_CORS_HARDENING=false
```

### No IP Whitelist
- Production server has NO whitelisted IPs
- All IPs subject to security rules
- Legitimate traffic passes through normally
- Malicious IPs get auto-banned

## How It Works

1. **Attack Detected** → Threat score += points
   - SQL injection: +15 points
   - Exploit path: +5 points  
   - Path traversal: +10 points

2. **Score ≥ 50** → IP auto-banned (24 hours)

3. **Banned IP** → All requests return 403 Forbidden

4. **After 24 hours** → Ban expires, IP can retry

## Deploy Now

```bash
# Restart server
pm2 restart bluemq

# Monitor
./monitor-security.sh

# Check logs
pm2 logs bluemq | grep security
```

## Expected Results

Based on your attack logs, these scanners will be banned within 1 minute:
- ✅ TLM-Audit-Scanner/2.0
- ✅ libredtail-http
- ✅ metabase-cve scanner

Legitimate users (Mentoracity) will be unaffected.

---

**Status: READY FOR PRODUCTION**
