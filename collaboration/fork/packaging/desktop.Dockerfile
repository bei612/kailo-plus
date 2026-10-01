# Desktop 客户端的 Linux 安装包构建（DD-74、ADR-06）。
#
# 构建上下文是 apps/（ADR-16）：协作底座源码树 collaboration/ 与它以本地路径依赖（link:）
# 引用的 client-kit/ts，保持与仓库里相同的相对位置；取舍见同名 .dockerignore。产物不是镜像
# 而是 .deb：最后一个阶段只含安装包，调用方以 `--output type=local` 取出，摘要写回来源记录
# 的 artifact_digest。
#
# 工具链版本以上游源树为准，不在此另定：Rust 取源树根的 rust-toolchain.toml，
# pnpm 取根 package.json 的 packageManager（corepack），Node 与系统依赖按上游 CI
# （.github/workflows/_ci-desktop.yml）。

FROM node:24.14.1-bookworm-slim@sha256:b506e7321f176aae77317f99d67a24b272c1f09f1d10f1761f2773447d8da26c AS node

FROM ubuntu:24.04@sha256:008173c23f95b170204355c12626cb5a965d779a7e1283b09e9cffbb1bf33ca3 AS build
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential ca-certificates curl file pkg-config cmake \
      libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev \
      libssl-dev libxdo-dev libasound2-dev libopus-dev patchelf \
    && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack \
    && corepack enable --install-directory /usr/local/bin
ENV RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/usr/local/cargo PATH=/usr/local/cargo/bin:$PATH
COPY client-kit/ts/contracts /src/client-kit/ts/contracts
COPY client-kit/ts/platform /src/client-kit/ts/platform
WORKDIR /src/collaboration
COPY collaboration/ ./
# 只装 rustup 本身；具体工具链由源树的 rust-toolchain.toml 决定
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --no-modify-path --default-toolchain none \
    && cd desktop/src-tauri && rustup toolchain install
RUN COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install --frozen-lockfile
# 安装包显示名是部署配置（DD-111）：由发布配置在打包时以构建参数注入（记录的 build_args），
# 源码里的 tauri.conf.json 保持上游原样。去掉首尾空白后为空、或含 Tauri productName
# 不允许的字符时拒绝构建，不回退任何默认名。
ARG PLATFORM_DISPLAY_NAME
RUN node -e ' \
      const name = (process.env.PLATFORM_DISPLAY_NAME || "").trim(); \
      if (!name || /[\/\\:*?"<>|\u0000-\u001f]/.test(name)) { \
        console.error("PLATFORM_DISPLAY_NAME 缺失、为空或含不允许的字符"); process.exit(1); } \
      require("fs").writeFileSync("/tmp/release-config.json", JSON.stringify({ productName: name }));'
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/collaboration/desktop/src-tauri/target,sharing=locked \
    cd desktop && pnpm tauri build --bundles deb --config /tmp/release-config.json \
    && mkdir -p /out \
    && cp src-tauri/target/release/bundle/deb/*.deb /out/

FROM scratch AS bundle
COPY --from=build /out/ /
