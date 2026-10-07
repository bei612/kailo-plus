FROM node:24-alpine@sha256:f70403e87646dc51b45295f4b8b70cdad0b63d2297c4c9899119b03f7af7a6b3 AS build

# The original virtua postinstall patch is part of the shared UI input.
RUN --mount=type=cache,target=/var/cache/apk,sharing=locked apk add patch

# 构建上下文是 apps/（ADR-16）：client-kit/ts 以本地路径依赖（file:）接入，保持与仓库里相同的
# 相对位置；上下文的取舍见同名 Dockerfile.dockerignore。
COPY client-kit/ts/contracts /src/client-kit/ts/contracts
COPY client-kit/ts/platform /src/client-kit/ts/platform
COPY collaboration/patches/virtua@0.49.3.patch /src/collaboration/patches/virtua@0.49.3.patch
WORKDIR /src/web-client/web
COPY web-client/web/package.json web-client/web/package-lock.json ./
COPY web-client/web/.npmrc ./
# file: 依赖按副本安装，必须保留上面的完整 client-kit 输入。
# 共享源码变化会重做安装，但 registry 包复用同一 BuildKit 的持久下载缓存。
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --prefer-offline --no-audit --no-fund

COPY web-client/web/ ./
ARG VITE_BASE_PATH=/app/
ENV VITE_BASE_PATH=${VITE_BASE_PATH}
ARG PLATFORM_BUILD_ID
ENV PLATFORM_BUILD_ID=${PLATFORM_BUILD_ID}
RUN npm run build

FROM caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d

RUN setcap -r /usr/bin/caddy
# A deployment without a display name must never serve an unlabeled or stale UI.
ENTRYPOINT ["/bin/sh", "-ec", "case \"${PLATFORM_DISPLAY_NAME:-}\" in *[![:space:]]*) ;; *) echo 'PLATFORM_DISPLAY_NAME is required' >&2; exit 1;; esac; exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile"]
COPY web-client/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/web-client/web/dist /srv/app

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/app/healthz || exit 1
