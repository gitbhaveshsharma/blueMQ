#!/bin/bash

# BlueMQ Droplet Deployment Script
# Usage: ./scripts/deploy-droplet.sh

set -e  # Exit on error

echo "═══════════════════════════════════════════"
echo "  🚀 BlueMQ Droplet Deployment"
echo "═══════════════════════════════════════════"
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to print colored output
print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Step 1: Stop app
echo "⏸️  Stopping current app..."
if pm2 stop bluemq 2>/dev/null; then
    print_success "App stopped"
else
    print_warning "App was not running"
fi

# Step 2: Pull latest changes
echo ""
echo "📥 Pulling latest changes from Git..."
if git pull origin main; then
    print_success "Code updated"
else
    print_error "Git pull failed"
    exit 1
fi

# Step 3: Install dependencies (if package.json changed)
if git diff HEAD@{1} --name-only | grep -q "package.json"; then
    echo ""
    echo "📦 Installing dependencies..."
    npm install
    print_success "Dependencies installed"
fi

# Step 4: Test database connection
echo ""
echo "🔍 Testing database connection..."
if npm run test:db; then
    print_success "Database connection verified"
else
    print_error "Database connection test failed"
    echo ""
    echo "Troubleshooting steps:"
    echo "  1. Check .env has correct DATABASE_URL"
    echo "  2. Try increasing timeout: DB_CONNECTION_TIMEOUT_MS=60000"
    echo "  3. Check network: curl -v https://your-neon-host.neon.tech"
    echo "  4. See DATABASE_CONNECTION_GUIDE.md"
    exit 1
fi

# Step 5: Run migrations
echo ""
echo "🗄️  Running database migrations..."
if npm run migrate; then
    print_success "Migrations completed"
else
    print_error "Migration failed"
    exit 1
fi

# Step 6: Start app
echo ""
echo "▶️  Starting app..."
if pm2 start ecosystem.config.js; then
    print_success "App started"
else
    print_error "Failed to start app"
    exit 1
fi

# Step 7: Save PM2 config
echo ""
echo "💾 Saving PM2 configuration..."
pm2 save
print_success "PM2 config saved"

# Step 8: Show status
echo ""
echo "═══════════════════════════════════════════"
echo "  ✅ Deployment Complete!"
echo "═══════════════════════════════════════════"
echo ""

# Wait a moment for app to initialize
sleep 3

# Show PM2 status
echo "📊 PM2 Status:"
pm2 status

echo ""
echo "📋 Recent logs:"
pm2 logs bluemq --lines 15 --nostream

echo ""
echo "═══════════════════════════════════════════"
print_success "BlueMQ is now running!"
echo ""
echo "Commands:"
echo "  • View logs:     pm2 logs bluemq"
echo "  • Check status:  pm2 status"
echo "  • Restart:       pm2 restart bluemq"
echo "  • Stop:          pm2 stop bluemq"
echo "═══════════════════════════════════════════"
