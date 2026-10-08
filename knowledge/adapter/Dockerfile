FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
WORKDIR /app/knowledge/adapter
COPY knowledge/adapter/package.json knowledge/adapter/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY knowledge/adapter/src ./src
COPY client-kit/adapter /app/client-kit/adapter
USER node
CMD ["node", "src/main.mjs"]
