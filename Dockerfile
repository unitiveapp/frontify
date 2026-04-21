FROM node:24-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils \
    libvips-dev \
    python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only the uniplate package — skip workspace lockfile entirely
COPY packages/uniplate/package.json ./package.json

RUN npm install

COPY packages/uniplate/ .

RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]
