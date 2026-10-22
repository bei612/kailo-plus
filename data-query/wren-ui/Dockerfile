FROM node:18-bookworm-slim@sha256:f9ab18e354e6855ae56ef2b290dd225c1e51a564f87584b9bd21dd651838830e AS base

# Install required packages
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Next.js collects completely anonymous telemetry data about general usage.
# Learn more here: https://nextjs.org/telemetry
# Uncomment the following line in case you want to disable telemetry during the build.
ENV NEXT_TELEMETRY_DISABLED 1
ENV NODE_ENV production

WORKDIR /app/data-query/wren-ui

# Enable corepack to manage yarn versions and set the correct yarn version
RUN corepack enable
COPY data-query/wren-ui/.yarnrc.yml data-query/wren-ui/package.json data-query/wren-ui/yarn.lock ./
COPY data-query/wren-ui/.yarn/releases/yarn-4.5.3.cjs .yarn/releases/yarn-4.5.3.cjs
RUN corepack prepare yarn@4.5.3 --activate

FROM base AS deps
WORKDIR /app/data-query/wren-ui

# Install dependencies based on the preferred package manager
RUN yarn install --immutable

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app/data-query/wren-ui
COPY --from=deps /app/data-query/wren-ui/node_modules ./node_modules
COPY data-query/wren-ui/public ./public
COPY data-query/wren-ui/src ./src
COPY data-query/wren-ui/.eslintrc.json ./
COPY data-query/wren-ui/.eslintignore ./
COPY data-query/wren-ui/.prettierrc ./
COPY data-query/wren-ui/next.config.js ./
COPY data-query/wren-ui/tsconfig.json ./
COPY client-kit/adapter/protocol.mjs /app/client-kit/adapter/protocol.mjs
# DD-133 (`07` §4.7.1): Kailo's icon (the web-client's own file), token
# stylesheet and presentation runtime are build inputs copied into this
# artifact and served from this origin; nothing is fetched from Kailo at run
# time. The runtime's type declaration is read by the type check.
COPY web-client/web/public/app-icon.png ./public/kailo/app-icon.png
COPY client-kit/embed/kailo-theme-tokens.css client-kit/embed/kailo-embed.js ./public/kailo/
COPY client-kit/embed/kailo-embed.d.ts /app/client-kit/embed/kailo-embed.d.ts

RUN yarn build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app/data-query/wren-ui

COPY --from=builder /app/data-query/wren-ui/public ./public

# Set the correct permission for prerender cache
RUN mkdir .next

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder /app/data-query/wren-ui/.next/standalone /app
COPY --from=builder /app/data-query/wren-ui/.next/static ./.next/static
COPY data-query/wren-ui/migrations ./migrations
COPY data-query/wren-ui/knexfile.js ./knexfile.js
COPY data-query/wren-ui/docker-entrypoint.mjs ./docker-entrypoint.mjs

# Copy knex and its dependencies from builder to runner
COPY --from=builder /app/data-query/wren-ui/node_modules/knex ./node_modules/knex
COPY --from=builder /app/data-query/wren-ui/node_modules/rechoir ./node_modules/rechoir
COPY --from=builder /app/data-query/wren-ui/node_modules/resolve ./node_modules/resolve
COPY --from=builder /app/data-query/wren-ui/node_modules/is-core-module ./node_modules/is-core-module
COPY --from=builder /app/data-query/wren-ui/node_modules/hasown ./node_modules/hasown
COPY --from=builder /app/data-query/wren-ui/node_modules/function-bind ./node_modules/function-bind
COPY --from=builder /app/data-query/wren-ui/node_modules/interpret ./node_modules/interpret
COPY --from=builder /app/data-query/wren-ui/node_modules/resolve-from ./node_modules/resolve-from
COPY --from=builder /app/data-query/wren-ui/node_modules/tildify ./node_modules/tildify
COPY --from=builder /app/data-query/wren-ui/node_modules/getopts ./node_modules/getopts
COPY --from=builder /app/data-query/wren-ui/node_modules/escalade/sync ./node_modules/escalade/sync
COPY --from=builder /app/data-query/wren-ui/node_modules/.yarn-state.yml ./node_modules/.yarn-state.yml

EXPOSE 3000

ENV PORT 3000

# server.js is created by next build from the standalone output
# https://nextjs.org/docs/pages/api-reference/next-config-js/output
CMD ["node", "docker-entrypoint.mjs"]
