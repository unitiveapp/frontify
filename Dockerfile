# ── Stage 1: deps ──────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS deps

# poppler-utils: PDF rendering via sharp/libvips
RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils \
    libvips-dev \
    python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace manifests first for layer caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/uniplate/package.json ./packages/uniplate/

RUN pnpm install --frozen-lockfile --filter uniplate...

# ── Stage 2: build ─────────────────────────────────────────────────────────────
FROM deps AS builder

COPY packages/uniplate ./packages/uniplate/

WORKDIR /app/packages/uniplate
RUN pnpm exec next build

# ── Stage 3: runner ────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS runner

RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils \
    libvips42 \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

# Copy standalone output
COPY --from=builder /app/packages/uniplate/.next/standalone ./
COPY --from=builder /app/packages/uniplate/.next/static ./packages/uniplate/.next/static
COPY --from=builder /app/packages/uniplate/public ./packages/uniplate/public

EXPOSE 3000
CMD ["node", "packages/uniplate/server.js"]
