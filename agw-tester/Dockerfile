# Build UI
FROM oven/bun:1 AS ui-builder
WORKDIR /app/ui
COPY ui/package.json ui/bun.lock* ./
RUN bun install --frozen-lockfile
COPY ui/ ./
RUN bun run build

# Build Server
FROM oven/bun:1 AS server-builder
WORKDIR /app/server
COPY server/package.json server/bun.lock* ./
RUN bun install --frozen-lockfile
COPY server/ ./
RUN bun run build

# Production
FROM oven/bun:1-slim
WORKDIR /app

# Copy built assets
COPY --from=server-builder /app/server/dist ./dist
COPY --from=ui-builder /app/ui/dist ./public
COPY --from=server-builder /app/server/package.json ./

# Install production dependencies only
RUN bun install --production --frozen-lockfile

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["bun", "run", "dist/index.js"]
