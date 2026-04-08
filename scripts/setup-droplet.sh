#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# BlueMQ - DigitalOcean Droplet Setup Script
# ═══════════════════════════════════════════════════════════════
# Run as root: bash setup-droplet.sh
# 
# This script:
# 1. Updates the system
# 2. Installs Node.js 20, Docker, Redis, Nginx
# 3. Creates a bluemq user
# 4. Sets up firewall
# ═══════════════════════════════════════════════════════════════

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  BlueMQ - DigitalOcean Droplet Setup${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Please run as root (sudo bash setup-droplet.sh)${NC}"
  exit 1
fi

# ─────────────────────────────────────────────────────────────
# Step 1: Update system
# ─────────────────────────────────────────────────────────────
echo -e "\n${YELLOW}[1/7] Updating system packages...${NC}"
apt update && apt upgrade -y

# ─────────────────────────────────────────────────────────────
# Step 2: Install Node.js 20
# ─────────────────────────────────────────────────────────────
echo -e "\n${YELLOW}[2/7] Installing Node.js 20 LTS...${NC}"
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
echo -e "${GREEN}Node.js version: $(node --version)${NC}"

# Install PM2 globally
npm install -g pm2

# ─────────────────────────────────────────────────────────────
# Step 3: Install Docker
# ─────────────────────────────────────────────────────────────
echo -e "\n${YELLOW}[3/7] Installing Docker...${NC}"
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker
echo -e "${GREEN}Docker version: $(docker --version)${NC}"

# ─────────────────────────────────────────────────────────────
# Step 4: Install Redis
# ─────────────────────────────────────────────────────────────
echo -e "\n${YELLOW}[4/7] Installing Redis...${NC}"
apt install -y redis-server
systemctl enable redis-server
systemctl start redis-server

# Configure Redis for production
mkdir -p /etc/redis/redis.conf.d
cat > /etc/redis/redis.conf.d/bluemq.conf << 'EOF'
maxmemory 256mb
maxmemory-policy allkeys-lru
appendonly yes
EOF

systemctl restart redis-server
echo -e "${GREEN}Redis status: $(redis-cli ping)${NC}"

# ─────────────────────────────────────────────────────────────
# Step 5: Install Nginx
# ─────────────────────────────────────────────────────────────
echo -e "\n${YELLOW}[5/7] Installing Nginx...${NC}"
apt install -y nginx certbot python3-certbot-nginx
systemctl enable nginx
systemctl start nginx

# ─────────────────────────────────────────────────────────────
# Step 6: Create bluemq user
# ─────────────────────────────────────────────────────────────
echo -e "\n${YELLOW}[6/7] Creating bluemq user...${NC}"
if id "bluemq" &>/dev/null; then
    echo "User bluemq already exists"
else
    adduser --disabled-password --gecos "" bluemq
    usermod -aG sudo bluemq
    usermod -aG docker bluemq
fi

# Create directories
mkdir -p /home/bluemq/logs
mkdir -p /home/bluemq/backups
chown -R bluemq:bluemq /home/bluemq

# ─────────────────────────────────────────────────────────────
# Step 7: Configure firewall
# ─────────────────────────────────────────────────────────────
echo -e "\n${YELLOW}[7/7] Configuring firewall...${NC}"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# ─────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────
echo -e "\n${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Setup Complete!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "Installed versions:"
echo -e "  Node.js: $(node --version)"
echo -e "  npm:     $(npm --version)"
echo -e "  Docker:  $(docker --version | cut -d' ' -f3)"
echo -e "  Redis:   $(redis-cli --version | cut -d' ' -f2)"
echo -e "  Nginx:   $(nginx -v 2>&1 | cut -d'/' -f2)"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo -e "1. Switch to bluemq user: ${GREEN}su - bluemq${NC}"
echo -e "2. Clone repo: ${GREEN}git clone https://github.com/gitbhaveshsharma/blueMQ.git${NC}"
echo -e "3. Configure environment: ${GREEN}cd blueMQ && cp .env.example .env && nano .env${NC}"
echo -e "4. Install dependencies: ${GREEN}npm install${NC}"
echo -e "5. Run migrations: ${GREEN}npm run migrate${NC}"
echo -e "6. Start WAHA: ${GREEN}cd waha && docker compose up -d${NC}"
echo -e "7. Start BlueMQ: ${GREEN}pm2 start ecosystem.config.js${NC}"
echo -e "8. Configure Nginx & SSL (see DEPLOYMENT.md)"
echo ""
echo -e "${GREEN}For detailed instructions, see DEPLOYMENT.md${NC}"
