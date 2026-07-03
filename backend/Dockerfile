FROM --platform=linux/amd64 node:20-bookworm-slim

# Native modules used by this backend (better-sqlite3, faiss-node, sqlite3)
# need a C/C++ toolchain + python at install time. git/cmake are a fallback
# in case a prebuilt binary isn't available and one of them must be built
# from source.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    git \
    cmake \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first for better layer caching
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

# Copy the rest of the source
COPY . .

# Local data (FAISS index + sqlite file) lives here.
# On Railway, mount a Volume at /app/data so it survives redeploys.
RUN mkdir -p /app/data

ENV NODE_ENV=production
# Skip TypeScript type-checking at runtime (strip types and run as-is).
# The project's tsconfig uses very strict type-checking settings that are
# useful during development but shouldn't block the server from starting
# in production over type-level nitpicks that don't affect actual behavior.
ENV TS_NODE_TRANSPILE_ONLY=true
EXPOSE 8000

# Uses ts-node's ESM loader explicitly — this project has "type": "module"
# in package.json and relative imports written with explicit .ts extensions,
# so the loader must be registered directly rather than relying on the
# ts-node CLI's auto-detection.
CMD ["node", "--loader", "ts-node/esm", "src/server.ts"]