# Nginx Real IP Fix - Applied

## Date: October 25, 2026

## Problem Identified
All security logs showed `ip: '::ffff:127.0.0.1'` (localhost) instead of real attacker IPs because Express wasn't trusting Nginx proxy headers.

## Fix Applied

### Changed File: `src/index.js`
Added after line 51:
```javascript
// Trust proxy headers (Nginx forwards real client IP via X-Forwarded-For, X-Real-IP)
// This is required for correct IP detection in security middleware
app.set('trust proxy', true);
```

### What This Does:
- Tells Express to trust `X-Forwarded-For` header from Nginx
- Tells Express to trust `X-Real-IP` header from Nginx
- `req.ip` will now return the REAL client IP, not `127.0.0.1`

### Nginx Config (Already Correct):
```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3001/;
    proxy_set_header X-Real-IP $remote_addr;           ✅
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; ✅
    ...
}
```

## Deploy Instructions

### 1. Commit the change:
```bash
cd ~/blueMQ
git add src/index.js
git commit -m "fix: trust proxy headers for real IP detection"
git push origin main
```

### 2. Deploy to production:
```bash
# Pull latest code
git pull origin main

# Restart PM2
pm2 restart bluemq-api

# Watch logs for real IPs
pm2 logs bluemq-api | grep security
```

### 3. Verify Real IPs:
After restart, security logs should show REAL attacker IPs:
```
[security] Blocked request: { ip: '185.220.101.45', ... }
[security] Threat score incremented: { ip: '185.220.101.45', ... }
[security] IP auto-banned: { ip: '185.220.101.45', ... }
```

NOT localhost:
```
❌ { ip: '::ffff:127.0.0.1', ... }
```

## Expected Results

### Before Fix:
```
ip: '::ffff:127.0.0.1'  (localhost - wrong!)
```
- Banning localhost (useless)
- Real attackers not tracked
- Attackers can retry from different IPs

### After Fix:
```
ip: '45.142.212.61'  (real attacker IP!)
```
- Banning actual attackers
- Threat scores per real IP
- Attackers blocked for 24 hours

## Testing

After restart, trigger a test block:
```bash
# From external IP
curl https://bluemq.me/api/.env
```

Check logs:
```bash
pm2 logs bluemq-api --lines 20 | grep security
```

Should see your real external IP, not 127.0.0.1!

---

**Status: FIX READY TO DEPLOY**

Deploy now to start tracking and banning REAL attacker IPs! 🎯
