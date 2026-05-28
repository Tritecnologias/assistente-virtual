# Stage 1: Build - Install production dependencies
FROM node:20-alpine AS build

WORKDIR /app

# Copy package files for dependency installation
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Stage 2: Production - Copy only necessary files
FROM node:20-alpine AS production

WORKDIR /app

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Create data directory for state.json persistence
RUN mkdir -p /app/data && chown -R appuser:appgroup /app/data

# Copy production dependencies from build stage
COPY --from=build /app/node_modules ./node_modules

# Copy application source and package.json
COPY package.json ./
COPY src/ ./src/

# Set ownership of app files to non-root user
RUN chown -R appuser:appgroup /app

# Switch to non-root user
USER appuser

# Expose configurable HTTP port (default 3000)
EXPOSE 3000

# Start the application
CMD ["node", "src/server.js"]
