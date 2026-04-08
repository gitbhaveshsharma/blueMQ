#!/bin/bash

# Complete Diagnostic and Fix Script for Neon Connection on DigitalOcean Droplet
# Run this on your droplet: bash diagnose-and-fix.sh

set -e

echo "═══════════════════════════════════════════════════════════"
echo "  BlueMQ - Complete Network Diagnostics and Fix"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Extract Neon host from .env
if [ ! -f .env ]; then
    echo -e "${RED}❌ .env file not found${NC}"
    exit 1
fi

source .env
NEON_POOLER=$(echo $DATABASE_URL | grep -oP '(?<=@)[^/]+' | cut -d: -f1)
NEON_DIRECT=$(echo $NEON_POOLER | sed 's/-pooler//')

echo "Database Configuration:"
echo "  Pooler Host: $NEON_POOLER"
echo "  Direct Host: $NEON_DIRECT"
echo ""

# Test 1: DNS Resolution
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 1: DNS Resolution"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if nslookup $NEON_POOLER > /dev/null 2>&1; then
    echo -e "${GREEN}✅ DNS Resolution WORKS${NC}"
    DNS_OK=true
else
    echo -e "${RED}❌ DNS Resolution FAILED${NC}"
    echo "   Fixing DNS..."
    
    # Backup resolv.conf
    sudo cp /etc/resolv.conf /etc/resolv.conf.backup.$(date +%s) 2>/dev/null || true
    
    # Add Google DNS
    if ! grep -q "8.8.8.8" /etc/resolv.conf 2>/dev/null; then
        echo "nameserver 8.8.8.8" | sudo tee -a /etc/resolv.conf > /dev/null
        echo "nameserver 8.8.4.4" | sudo tee -a /etc/resolv.conf > /dev/null
        echo -e "${GREEN}✅ Added Google DNS${NC}"
    fi
    
    # Test again
    if nslookup $NEON_POOLER > /dev/null 2>&1; then
        echo -e "${GREEN}✅ DNS Now WORKS${NC}"
        DNS_OK=true
    else
        echo -e "${RED}❌ DNS Still FAILING${NC}"
        DNS_OK=false
    fi
fi
echo ""

# Test 2: Port 5432 - Pooler Connection
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 2: Port 5432 - Pooler Connection"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if timeout 10 bash -c "cat < /dev/null > /dev/tcp/$NEON_POOLER/5432" 2>/dev/null; then
    echo -e "${GREEN}✅ Pooler Connection WORKS${NC}"
    POOLER_OK=true
else
    echo -e "${RED}❌ Pooler Connection BLOCKED${NC}"
    POOLER_OK=false
fi
echo ""

# Test 3: Port 5432 - Direct Connection
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 3: Port 5432 - Direct Connection (without pooler)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if timeout 10 bash -c "cat < /dev/null > /dev/tcp/$NEON_DIRECT/5432" 2>/dev/null; then
    echo -e "${GREEN}✅ Direct Connection WORKS${NC}"
    DIRECT_OK=true
else
    echo -e "${RED}❌ Direct Connection BLOCKED${NC}"
    DIRECT_OK=false
fi
echo ""

# Test 4: UFW Firewall
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 4: UFW Firewall"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if command -v ufw &> /dev/null; then
    UFW_STATUS=$(sudo ufw status 2>/dev/null | grep -i "Status:" || echo "Status: inactive")
    echo "$UFW_STATUS"
    
    if echo "$UFW_STATUS" | grep -q "active"; then
        if sudo ufw status | grep -q "5432.*ALLOW.*OUT"; then
            echo -e "${GREEN}✅ Port 5432 allowed in UFW${NC}"
        else
            echo -e "${YELLOW}⚠️  Port 5432 NOT explicitly allowed${NC}"
            echo "   Adding rule..."
            sudo ufw allow out 5432/tcp > /dev/null 2>&1
            sudo ufw reload > /dev/null 2>&1
            echo -e "${GREEN}✅ Added UFW rule for port 5432${NC}"
        fi
    else
        echo "   UFW is inactive (no blocking)"
    fi
else
    echo "   UFW not installed"
fi
echo ""

# Test 5: Check iptables
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 5: iptables Rules"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if sudo iptables -L OUTPUT -n 2>/dev/null | grep -q "5432"; then
    echo "   Found iptables rules for 5432:"
    sudo iptables -L OUTPUT -n | grep 5432
else
    echo "   No explicit iptables rules for 5432"
fi
echo ""

# Re-test after fixes
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Re-Testing After Fixes"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo "Testing Pooler connection..."
if timeout 10 bash -c "cat < /dev/null > /dev/tcp/$NEON_POOLER/5432" 2>/dev/null; then
    echo -e "${GREEN}✅ Pooler NOW WORKS${NC}"
    POOLER_OK=true
else
    echo -e "${RED}❌ Pooler STILL BLOCKED${NC}"
    POOLER_OK=false
fi

echo "Testing Direct connection..."
if timeout 10 bash -c "cat < /dev/null > /dev/tcp/$NEON_DIRECT/5432" 2>/dev/null; then
    echo -e "${GREEN}✅ Direct NOW WORKS${NC}"
    DIRECT_OK=true
else
    echo -e "${RED}❌ Direct STILL BLOCKED${NC}"
    DIRECT_OK=false
fi
echo ""

# Summary and Recommendations
echo "═══════════════════════════════════════════════════════════"
echo "  SUMMARY & RECOMMENDATIONS"
echo "═══════════════════════════════════════════════════════════"
echo ""

if [ "$POOLER_OK" = true ]; then
    echo -e "${GREEN}✅ Your droplet CAN connect to Neon (pooler)${NC}"
    echo ""
    echo "Your app should work now. Restart it:"
    echo "  pm2 restart bluemq"
    echo "  pm2 logs bluemq"
    
elif [ "$DIRECT_OK" = true ]; then
    echo -e "${GREEN}✅ Direct connection WORKS (without pooler)${NC}"
    echo -e "${YELLOW}⚠️  But pooler connection BLOCKED${NC}"
    echo ""
    echo "SOLUTION: Switch to direct connection"
    echo ""
    echo "Edit your .env file:"
    echo "  nano ~/blueMQ/.env"
    echo ""
    echo "Change DATABASE_URL from:"
    echo "  $NEON_POOLER"
    echo "To:"
    echo "  $NEON_DIRECT"
    echo ""
    echo "Then restart:"
    echo "  pm2 restart bluemq"
    
else
    echo -e "${RED}❌ Port 5432 is BLOCKED for both pooler and direct${NC}"
    echo ""
    echo "This is a DigitalOcean datacenter restriction."
    echo ""
    echo "SOLUTIONS:"
    echo ""
    echo "1️⃣  Check DigitalOcean Cloud Firewall:"
    echo "   https://cloud.digitalocean.com/networking/firewalls"
    echo "   Add outbound rule for TCP port 5432"
    echo ""
    echo "2️⃣  Contact DigitalOcean Support:"
    echo "   https://cloud.digitalocean.com/support/tickets"
    echo "   Ask them to unblock outbound port 5432"
    echo ""
    echo "3️⃣  Check your droplet region:"
    REGION=$(curl -s http://169.254.169.254/metadata/v1/region 2>/dev/null || echo "unknown")
    echo "   Your region: $REGION"
    echo "   Some regions have stricter firewall rules"
    echo ""
    echo "4️⃣  Temporary workaround - Use Neon via HTTP API:"
    echo "   (Not ideal, but works if port 5432 is permanently blocked)"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo ""

# Save report
REPORT_FILE="network-diagnostic-$(date +%Y%m%d-%H%M%S).txt"
{
    echo "Network Diagnostic Report"
    echo "Date: $(date)"
    echo "Droplet IP: $(curl -s http://169.254.169.254/metadata/v1/interfaces/public/0/ipv4/address 2>/dev/null || echo 'unknown')"
    echo "Region: $(curl -s http://169.254.169.254/metadata/v1/region 2>/dev/null || echo 'unknown')"
    echo ""
    echo "Results:"
    echo "  DNS: $DNS_OK"
    echo "  Pooler Connection: $POOLER_OK"
    echo "  Direct Connection: $DIRECT_OK"
} > $REPORT_FILE

echo "Report saved to: $REPORT_FILE"
echo ""
