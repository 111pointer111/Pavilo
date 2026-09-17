# Pavilo Dockerfile
# Multi-stage build for minimal production image

# Stage 1: Build stage (with dev dependencies)
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (including dev dependencies for potential build steps)
RUN npm ci --omit=dev

# Stage 2: Production stage
FROM node:22-alpine

# Add labels
LABEL org.opencontainers.image.title="Pavilo"
LABEL org.opencontainers.image.description="A minimal, self-hosted chat room that is ephemeral by default"
LABEL org.opencontainers.image.url="https://github.com/caigg188/Pavilo"
LABEL org.opencontainers.image.source="https://github.com/caigg188/Pavilo"
LABEL org.opencontainers.image.licenses="MIT"

# Create non-root user
RUN addgroup -g 1001 -S pavilo && \
    adduser -u 1001 -S pavilo -G pavilo

WORKDIR /app

# Copy node_modules from builder
COPY --from=builder --chown=pavilo:pavilo /app/node_modules ./node_modules

# Copy application files
COPY --chown=pavilo:pavilo package*.json ./
COPY --chown=pavilo:pavilo server.js config.js ./
COPY --chown=pavilo:pavilo src ./src
COPY --chown=pavilo:pavilo client ./client
COPY --chown=pavilo:pavilo vendor ./vendor
COPY --chown=pavilo:pavilo index.html chat.css ./

# Switch to non-root user
USER pavilo

# Expose default port
EXPOSE 4173

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4173/healthz', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Start application
CMD ["node", "server.js"]
