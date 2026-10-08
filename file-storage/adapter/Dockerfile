# Build context is apps/: preserve the existing cross-component protocol imports.
FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
WORKDIR /app/file-storage/adapter
COPY file-storage/adapter/package.json file-storage/adapter/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY client-kit/adapter /app/client-kit/adapter
COPY file-storage/adapter/src ./src
USER node
CMD ["node", "src/main.mjs"]
