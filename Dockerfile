# syntax=docker/dockerfile:1.7
# Multi-stage build for Next.js (App Router, React 19) monorepo with pnpm
# Builds apps/web with standalone output for a small runtime image.

ARG NODE_VERSION=20-bullseye-slim

FROM node:${NODE_VERSION} AS base
ENV NODE_ENV=production \
    PNPM_HOME=/root/.local/share/pnpm \
    PATH=/root/.local/share/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app

# --- Install dependencies with caching ---
FROM base AS deps
ENV NODE_ENV=development

# Only copy files needed for dependency resolution to leverage Docker cache
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/types/package.json ./packages/types/package.json
COPY packages/query-engine/package.json ./packages/query-engine/package.json
COPY packages/introspect/package.json ./packages/introspect/package.json

# Install all workspace deps (no scripts) for faster, reproducible builds
RUN pnpm -w install --frozen-lockfile --ignore-scripts

# --- Build the Next.js app ---
FROM base AS builder
ENV NODE_ENV=production \
    CI=1
WORKDIR /app

# Build-time secret forwarded from compose: ensures better-auth can read it during Next build
ARG BETTER_AUTH_SECRET
ENV BETTER_AUTH_SECRET=$BETTER_AUTH_SECRET

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=deps /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/apps/web/package.json ./apps/web/package.json
COPY --from=deps /app/packages/types/package.json ./packages/types/package.json
COPY --from=deps /app/packages/query-engine/package.json ./packages/query-engine/package.json
COPY --from=deps /app/packages/introspect/package.json ./packages/introspect/package.json

# Copy full source
COPY . .

# Ensure proper workspace linking and binaries, then build web app
RUN pnpm -w install --frozen-lockfile --ignore-scripts --prod=false \
  && pnpm --filter @rei-db-view/web install --frozen-lockfile --ignore-scripts --prod=false \
  && pnpm --filter @rei-db-view/web build

# Next.js 'standalone' build doesn't include static/public by default
# In a monorepo, server.js usually lives at .next/standalone/apps/web/server.js
# So copy assets next to that path.
RUN mkdir -p /app/apps/web/.next/standalone/apps/web/.next \
  && if [ -d "/app/apps/web/.next/static" ]; then cp -R /app/apps/web/.next/static /app/apps/web/.next/standalone/apps/web/.next/; fi \
  && if [ -d "/app/apps/web/public" ]; then cp -R /app/apps/web/public /app/apps/web/.next/standalone/apps/web/; fi

# --- Runtime image ---
FROM node:${NODE_VERSION} AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app

# Copy the traced server and assets (standalone output)
COPY --from=builder /app/apps/web/.next/standalone ./

# Healthcheck (optional): basic TCP check on port 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "require('net').createConnection({host: process.env.HOSTNAME || '127.0.0.1', port: process.env.PORT || 3000}).on('error',()=>process.exit(1)).on('connect',c=>c.end())"

EXPOSE 3000
# Run server.js from monorepo path; fall back to root if Next outputs at top-level
CMD ["sh", "-lc", "node apps/web/server.js || node server.js"]
