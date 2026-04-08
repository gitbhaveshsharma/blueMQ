# BlueMQ Dockerfile
# Build: docker build -t bluemq .
# Run: docker run -d --env-file .env -p 3001:3001 bluemq

FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install dependencies for native modules
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy application code
COPY src/ ./src/

# Create non-root user
RUN addgroup -g 1001 -S bluemq && \
  adduser -S -u 1001 -G bluemq bluemq && \
  chown -R bluemq:bluemq /app

# Switch to non-root user
USER bluemq

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

# Start application
CMD ["node", "src/index.js"]
