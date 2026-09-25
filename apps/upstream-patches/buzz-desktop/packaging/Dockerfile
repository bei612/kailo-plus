# Buzz Desktop（Kailo 版）的 Linux 安装包构建（DD-74、ADR-06）。
#
# 构建上下文是打过 Kailo patch 的 block/buzz 源树（由 tools/build-upstream.sh 取源、
# 按 remove_paths 裁剪、按 patch_series 打补丁后交给本文件）。产物不是镜像而是
# .deb：最后一个阶段只含安装包，调用方以 `--output type=local` 取出，摘要写回
# baseline manifest 的 artifact_digest。
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
WORKDIR /src
COPY . .
# 只装 rustup 本身；具体工具链由源树的 rust-toolchain.toml 决定
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --no-modify-path --default-toolchain none \
    && cd desktop/src-tauri && rustup toolchain install
RUN COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install --frozen-lockfile
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/desktop/src-tauri/target,sharing=locked \
    cd desktop && pnpm tauri build --bundles deb \
    && mkdir -p /out \
    && cp src-tauri/target/release/bundle/deb/*.deb /out/

FROM scratch AS bundle
COPY --from=build /out/ /
