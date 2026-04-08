#!/bin/bash

# Network Diagnostics Script for Neon Database Connection
# Run this on your droplet to diagnose connectivity issues

echo "═══════════════════════════════════════════"
echo "  BlueMQ - Network Diagnostics"
echo "═══════════════════════════════════════════"
echo ""

# Extract host from DATABASE_URL
if [ -f .env ]; then
    source .env
    NEON_HOST=$(echo $DATABASE_URL | grep -oP '(?<=@)[^/]+' | cut -d: -f1)
    echo "✓ Neon Host: $NEON_HOST"
else
    echo "❌ .env file not found"
    exit 1
fi

echo ""
echo "1️⃣  Testing DNS Resolution..."
echo "────────────────────────────────────────────"
if nslookup $NEON_HOST > /dev/null 2>&1; then
    echo "✅ DNS resolution successful"
    nslookup $NEON_HOST | grep -A2 "Name:"
else
    echo "❌ DNS resolution FAILED"
    echo "   Try: sudo nano /etc/resolv.conf"
    echo "   Add: nameserver 8.8.8.8"
fi

echo ""
echo "2️⃣  Testing Network Connectivity (ping)..."
echo "────────────────────────────────────────────"
if ping -c 3 -W 5 $NEON_HOST > /dev/null 2>&1; then
    echo "✅ Ping successful"
    ping -c 3 $NEON_HOST | tail -2
else
    echo "⚠️  Ping failed (may be blocked, not critical)"
fi

echo ""
echo "3️⃣  Testing Port 5432 (PostgreSQL)..."
echo "────────────────────────────────────────────"
if timeout 10 bash -c "cat < /dev/null > /dev/tcp/$NEON_HOST/5432" 2>/dev/null; then
    echo "✅ Port 5432 is OPEN and reachable"
else
    echo "❌ Port 5432 is BLOCKED or unreachable"
    echo "   This is the problem!"
fi

echo ""
echo "4️⃣  Testing HTTPS Connectivity..."
echo "────────────────────────────────────────────"
if curl -s --max-time 10 https://$NEON_HOST > /dev/null 2>&1; then
    echo "✅ HTTPS connection successful"
else
    echo "⚠️  HTTPS connection failed"
fi

echo ""
echo "5️⃣  Checking Firewall (UFW)..."
echo "────────────────────────────────────────────"
if command -v ufw &> /dev/null; then
    UFW_STATUS=$(sudo ufw status | grep -i "Status:")
    echo "$UFW_STATUS"
    
    if echo "$UFW_STATUS" | grep -q "active"; then
        echo ""
        echo "Checking outbound rules for port 5432:"
        sudo ufw status | grep 5432 || echo "   ⚠️  No explicit rule for port 5432"
    fi
else
    echo "UFW not installed"
fi

echo ""
echo "6️⃣  Checking iptables..."
echo "────────────────────────────────────────────"
if sudo iptables -L OUTPUT -n | grep -q "5432"; then
    echo "iptables rules for port 5432:"
    sudo iptables -L OUTPUT -n | grep 5432
else
    echo "No explicit iptables rules for port 5432"
fi

echo ""
echo "7️⃣  Testing with netcat..."
echo "────────────────────────────────────────────"
if command -v nc &> /dev/null; then
    if timeout 10 nc -zv $NEON_HOST 5432 2>&1 | grep -q "succeeded"; then
        echo "✅ netcat connection successful"
    else
        echo "❌ netcat connection FAILED"
        timeout 10 nc -zv $NEON_HOST 5432 2>&1
    fi
else
    echo "netcat not installed (optional)"
fi

echo ""
echo "8️⃣  Checking routing..."
echo "────────────────────────────────────────────"
if command -v traceroute &> /dev/null; then
    echo "Traceroute to $NEON_HOST (first 5 hops):"
    timeout 15 traceroute -m 5 $NEON_HOST 2>&1 | head -10
else
    echo "traceroute not installed (optional)"
fi

echo ""
echo "9️⃣  Testing with curl to Neon API..."
echo "────────────────────────────────────────────"
# Try to connect using HTTP/HTTPS fetch (like Node.js does)
if curl -v --max-time 30 "https://$NEON_HOST" 2>&1 | grep -q "Connected"; then
    echo "✅ Can establish TCP connection via curl"
else
    echo "❌ Cannot establish TCP connection via curl"
    echo "   This matches the Node.js fetch() failure"
fi

echo ""
echo "═══════════════════════════════════════════"
echo "  Diagnostics Complete"
echo "═══════════════════════════════════════════"
echo ""
echo "📋 Summary:"
echo ""

# Summary
if timeout 10 bash -c "cat < /dev/null > /dev/tcp/$NEON_HOST/5432" 2>/dev/null; then
    echo "✅ Your droplet CAN reach Neon database"
    echo "   The issue might be:"
    echo "   1. Database credentials incorrect"
    echo "   2. SSL/TLS configuration"
    echo "   3. Neon database paused/suspended"
else
    echo "❌ Your droplet CANNOT reach Neon database"
    echo ""
    echo "🔧 Fixes to try:"
    echo ""
    echo "1️⃣  Allow outbound connections on port 5432:"
    echo "   sudo ufw allow out 5432/tcp"
    echo "   sudo ufw reload"
    echo ""
    echo "2️⃣  Check if your ISP/datacenter blocks PostgreSQL port:"
    echo "   Some providers block port 5432 for security"
    echo "   Contact DigitalOcean support"
    echo ""
    echo "3️⃣  Try using Neon's non-pooler connection string:"
    echo "   (without '-pooler' in the hostname)"
    echo ""
    echo "4️⃣  Check DigitalOcean Droplet firewall in web console:"
    echo "   https://cloud.digitalocean.com/networking/firewalls"
    echo ""
    echo "5️⃣  Consider using a different database provider temporarily:"
    echo "   - Supabase (provides connection strings that work)"
    echo "   - Railway PostgreSQL"
    echo "   - AWS RDS"
fi

echo ""
echo "═══════════════════════════════════════════"
