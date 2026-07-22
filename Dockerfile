# better-sqlite3 has a native module; build it in a stage with compilers,
# then copy only the built result into a slim runtime image.
FROM node:26-bookworm-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:26-bookworm-slim
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# Database lives on a mounted volume so it survives image rebuilds.
ENV DB_PATH=/data/loot.db
VOLUME ["/data"]

CMD ["node", "src/index.js"]
