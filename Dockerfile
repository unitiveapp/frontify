# ── Stage 1: deps + build ──────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils \
    libvips-dev \
    python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/uniplate/package.json ./packages/uniplate/

RUN pnpm install --frozen-lockfile --filter uniplate...

COPY packages/uniplate ./packages/uniplate/

RUN pnpm --filter uniplate build

# ── Stage 2: runner ────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS runner

RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils \
    libvips42 \
 && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@latest --activate

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/uniplate/package.json ./packages/uniplate/

RUN pnpm install --frozen-lockfile --filter uniplate... --prod

COPY --from=builder /app/packages/uniplate/.next ./packages/uniplate/.next
COPY --from=builder /app/packages/uniplate/public ./packages/uniplate/public

EXPOSE 3000
CMD ["pnpm", "--filter", "uniplate", "start"]
