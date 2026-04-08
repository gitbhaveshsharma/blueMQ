#!/bin/bash

# Quick Fix Script for Neon Connection Issues
# This script tries several fixes in sequence

echo "═══════════════════════════════════════════"
echo "  BlueMQ - Connection Fix Attempts"
echo "═══════════════════════════════════════════"
echo ""

# Fix 1: Open outbound port 5432
echo "1️⃣  Opening outbound port 5432..."
if command -v ufw &> /dev/null; then
    sudo ufw allow out 5432/tcp
    sudo ufw reload
    echo "✅ UFW rule added"
else
    echo "⚠️  UFW not found"
fi

# Fix 2: Update DNS settings
echo ""
echo "2️⃣  Updating DNS settings..."
if [ -f /etc/resolv.conf ]; then
    # Backup existing
    sudo cp /etc/resolv.conf /etc/resolv.conf.backup
    
    # Check if Google DNS already exists
    if ! grep -q "8.8.8.8" /etc/resolv.conf; then
        echo "nameserver 8.8.8.8" | sudo tee -a /etc/resolv.conf
        echo "nameserver 8.8.4.4" | sudo tee -a /etc/resolv.conf
        echo "✅ Added Google DNS"
    else
        echo "✅ DNS already configured"
    fi
fi

# Fix 3: Clear DNS cache
echo ""
echo "3️⃣  Clearing DNS cache..."
if command -v systemd-resolve &> /dev/null; then
    sudo systemd-resolve --flush-caches 2>/dev/null || true
    echo "✅ DNS cache cleared"
elif command -v resolvectl &> /dev/null; then
    sudo resolvectl flush-caches 2>/dev/null || true
    echo "✅ DNS cache cleared"
else
    echo "⚠️  DNS cache flush not available"
fi

# Fix 4: Test connection
echo ""
echo "4️⃣  Testing connection..."
if [ -f .env ]; then
    source .env
    NEON_HOST=$(echo $DATABASE_URL | grep -oP '(?<=@)[^/]+' | cut -d: -f1)
    
    if timeout 10 bash -c "cat < /dev/null > /dev/tcp/$NEON_HOST/5432" 2>/dev/null; then
        echo "✅ SUCCESS! Can now connect to Neon"
        echo ""
        echo "Try starting your app now:"
        echo "  pm2 restart bluemq"
    else
        echo "❌ Still cannot connect"
        echo ""
        echo "This might be a DigitalOcean datacenter restriction."
        echo "Try these solutions:"
        echo ""
        echo "📝 Solution A: Use Neon's direct (non-pooler) connection"
        echo "   In your .env, replace:"
        echo "   ep-xxx-pooler.c-4.us-east-1.aws.neon.tech"
        echo "   with:"
        echo "   ep-xxx.c-4.us-east-1.aws.neon.tech"
        echo "   (remove '-pooler' from hostname)"
        echo ""
        echo "📝 Solution B: Contact DigitalOcean Support"
        echo "   Some DOs block PostgreSQL port 5432"
        echo "   Ask them to unblock it for your droplet"
        echo ""
        echo "📝 Solution C: Use Supabase instead"
        echo "   Supabase uses port 5432 with different routing"
        echo "   Sign up at: https://supabase.com"
        echo ""
        echo "📝 Solution D: Use Railway PostgreSQL"
        echo "   Add PostgreSQL plugin in Railway"
        echo "   It provides a different network path"
    fi
fi

echo ""
echo "═══════════════════════════════════════════"
