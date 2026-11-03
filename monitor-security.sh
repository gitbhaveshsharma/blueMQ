#!/bin/bash

echo "======================================"
echo "BlueMQ Security Monitor"
echo "======================================"
echo ""

echo "📊 Threat Scores (Top 10):"
redis-cli --scan --pattern "security:threat:*" | head -10 | while read key; do
  ip=$(echo "$key" | sed 's/security:threat://')
  score=$(redis-cli GET "$key")
  echo "  $ip: $score points"
done

echo ""
echo "🚫 Banned IPs:"
banned_count=$(redis-cli KEYS "security:blacklist:*" | wc -l)
echo "  Total banned: $banned_count"
redis-cli --scan --pattern "security:blacklist:*" | head -5 | while read key; do
  ip=$(echo "$key" | sed 's/security:blacklist://')
  echo "  - $ip"
done

echo ""
echo "🔐 Auth Failures (Active Cooldowns):"
redis-cli --scan --pattern "security:auth:cooldown:*" | head -5 | while read key; do
  ip=$(echo "$key" | sed 's/security:auth:cooldown://')
  ttl=$(redis-cli TTL "$key")
  echo "  $ip: ${ttl}s remaining"
done

echo ""
echo "📈 Recent Security Events (last 20):"
tail -20 /var/log/pm2-bluemq.log 2>/dev/null | grep "\[security\]" || \
  pm2 logs bluemq --nostream --lines 20 2>/dev/null | grep "\[security\]" || \
  echo "  (Check logs manually: pm2 logs bluemq | grep security)"

echo ""
echo "======================================"
