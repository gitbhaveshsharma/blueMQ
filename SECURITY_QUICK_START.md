# Security Middleware - Quick Start Guide

## ✨ What's New

BlueMQ now includes comprehensive security middleware protecting against:
- ✅ Path traversal attacks
- ✅ SQL injection attempts  
- ✅ Exploit path scanning (PHPUnit, .env, etc.)
- ✅ Prototype pollution
- ✅ Brute force attacks (rate limiting)
- ✅ DDoS attempts (rate limiting)

## 🚀 Quick Setup

### 1. Environment Configuration (Optional)

Security works out-of-the-box with safe defaults. To customize:

```bash
# Copy example configuration
cp .env.example .env

# Edit security settings (all optional)
# Feature toggles
SECURITY_ENABLE_RATE_LIMITING=true
SECURITY_ENABLE_REQUEST_VALIDATION=true

# Rate limits (adjust per environment)
SECURITY_RATE_LIMIT_GLOBAL_MAX=1000          # requests per 15min per IP
SECURITY_RATE_LIMIT_AUTH_MAX=10              # auth requests per 15min per IP
SECURITY_RATE_LIMIT_NOTIFY_MAX=100           # notify requests per min per API key

# IP whitelist (optional - bypass rate limits)
SECURITY_WHITELIST_IPS=127.0.0.1,::1,YOUR_OFFICE_IP
```

### 2. Start Server

```bash
npm start
```

You'll see:
```
[security] Security middleware enabled:
  - Request validation: true
  - Rate limiting: true
  - Security headers: true
```

### 3. Test Protection

```bash
# This should be BLOCKED (400 Bad Request)
curl "http://localhost:3001/api?q=../../etc/passwd"

# This should be ALLOWED (200 OK)
curl "http://localhost:3001/health"
```

## 📊 Rate Limit Headers

Every response includes rate limit information:

```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 950
X-RateLimit-Reset: 1697654321
```

When rate limited (429 response):
```
Retry-After: 60
```

## 🔧 Common Configurations

### Development (Permissive)

```bash
SECURITY_RATE_LIMIT_GLOBAL_MAX=10000
SECURITY_RATE_LIMIT_AUTH_MAX=100
SECURITY_WHITELIST_IPS=127.0.0.1,::1
```

### Production (Strict)

```bash
SECURITY_RATE_LIMIT_GLOBAL_MAX=1000
SECURITY_RATE_LIMIT_AUTH_MAX=10
SECURITY_WHITELIST_IPS=YOUR_MONITORING_IP
SECURITY_CORS_ALLOWED_ORIGINS=https://your-domain.com
```

### Testing/CI (Disabled)

```bash
SECURITY_ENABLE_RATE_LIMITING=false
SECURITY_ENABLE_REQUEST_VALIDATION=false
```

## 🎯 Whitelist Your IP

If you're getting rate limited:

```bash
# Add your IP to whitelist
SECURITY_WHITELIST_IPS=127.0.0.1,::1,YOUR_IP_HERE
```

Whitelisted IPs bypass ALL rate limits.

## 📈 Monitor Security Events

Check Redis for metrics:

```bash
redis-cli
> GET security:metrics:requests.blocked.validation
> GET security:metrics:rate_limit.exceeded.global
```

Or in Node.js:

```javascript
const { getMetric } = require('./src/utils/redis-security');
const blocked = await getMetric('requests.blocked.validation');
console.log(`Blocked requests: ${blocked}`);
```

## 🐛 Troubleshooting

### "Too Many Requests" Error

**Problem:** Getting 429 responses

**Solutions:**
1. Wait for rate limit window to reset (check `Retry-After` header)
2. Add your IP to whitelist: `SECURITY_WHITELIST_IPS=YOUR_IP`
3. Increase limits: `SECURITY_RATE_LIMIT_GLOBAL_MAX=10000`

### Legitimate Requests Blocked

**Problem:** Valid requests returning 400 Bad Request

**Solutions:**
1. Check logs for the specific pattern triggering the block
2. Disable specific check if needed:
   ```bash
   SECURITY_BLOCK_SQL_INJECTION=false  # Use with caution!
   ```
3. Report false positive for pattern improvement

### Redis Connection Issues

**Problem:** Security middleware errors in logs

**Solutions:**
1. Check Redis is running: `redis-cli ping`
2. Verify `REDIS_URL` in `.env`
3. Security middleware fails-open (allows traffic) if Redis is down

## 🔒 Security Best Practices

1. **Never disable all security** - Use feature flags for specific checks only
2. **Monitor metrics** - Check `security:metrics:*` daily
3. **Review logs** - Look for `[security]` prefix in logs
4. **Use HTTPS** - Required for HSTS and other security headers
5. **Whitelist conservatively** - Only add trusted IPs
6. **Test changes** - Try attacks in staging before production

## 📚 Full Documentation

- [SECURITY_IMPLEMENTATION.md](./SECURITY_IMPLEMENTATION.md) - Complete implementation guide
- [SECURITY_SUMMARY.md](./SECURITY_SUMMARY.md) - Technical summary
- [.kiro/specs/security-middleware-enhancement/](./kiro/specs/security-middleware-enhancement/) - Original spec

## 🆘 Need Help?

1. Check `[security]` prefix in logs
2. Review Redis metrics: `security:metrics:*`
3. Test with `curl -i` to see response headers
4. Disable specific features for debugging

## ✅ Verification Checklist

- [ ] Server starts without errors
- [ ] Rate limit headers present in responses
- [ ] Malicious requests blocked (test with path traversal)
- [ ] Legitimate requests allowed
- [ ] Rate limiting works (test with multiple requests)
- [ ] Metrics tracking in Redis
- [ ] Security headers present (check with `curl -I`)

---

**Quick Start Complete!** Your API is now protected. 🛡️

For advanced configuration and Phase 2 features (brute force protection, threat scoring), see the full documentation.
