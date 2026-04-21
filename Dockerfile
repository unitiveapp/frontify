# Single-stage build — simpler and avoids monorepo path issues
FROM node:24-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils \
    libvips-dev \
    python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY . .

RUN pnpm install --no-frozen-lockfile --filter uniplate...

RUN pnpm --filter uniplate build

ENV NODE_ENV=production
EXPOSE 3000

# next start reads $PORT injected by Railway (defaults to 3000)
CMD ["pnpm", "--filter", "uniplate", "start"]
