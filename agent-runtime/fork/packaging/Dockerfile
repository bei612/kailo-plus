# Codex app-server（平台 SERVER_CODEX runtime）的运行镜像（DD-26、ADR-06）。
#
# 构建上下文是 agent-runtime/ 源码树（本仓库的改动直接在树里）：tools/build-upstream.sh
# 按 fork/upstream.yaml 备好后交给本文件；固定配置是树里的 fork/runtime-config/。
# 上游没有 app-server 的 Dockerfile（只有 .github/workflows/Dockerfile.bazel 这个 CI
# 镜像），因此由本仓库维护。
#
# 工具链以源树 codex-rs/rust-toolchain.toml 为准（1.95.0）；系统依赖按上游 CI
# （.github/workflows/rust-ci-full.yml：pkg-config、libcap-dev），另加二进制动态链接的
# libssl 与 liblzma 的开发包（ldd codex-app-server：libssl.so.3、libcrypto.so.3、liblzma.so.5）。
# 多阶段：runtime 只含二进制、固定配置与 CA 证书，不带工具链、源码与依赖缓存。

FROM rust:1.95.0-slim-bookworm@sha256:d7482085ff5b415f84dba5647ae71606650bdef00db7aeb69f4b3d170c3e4082 AS builder
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential ca-certificates git pkg-config libcap-dev libssl-dev liblzma-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY . .
WORKDIR /src/codex-rs
ARG CARGO_BUILD_JOBS
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/src/codex-rs/target,sharing=locked \
    cargo build --release --locked --jobs "${CARGO_BUILD_JOBS:?build parallelism is required}" \
      -p codex-app-server --bin codex-app-server \
    && install -D target/release/codex-app-server /out/codex-app-server

FROM debian:bookworm-slim@sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251 AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libssl3 liblzma5 \
    && rm -rf /var/lib/apt/lists/*
# 以非 root 运行：app-server 只经 stdio 受 Core 控制，不需要任何特权
RUN useradd --system --uid 10001 --no-create-home platform
COPY --from=builder /out/codex-app-server /usr/local/bin/codex-app-server
# 管理员强制约束与 system 配置层（Codex 固定从 /etc/codex 读取）
COPY fork/runtime-config/requirements.toml /etc/codex/requirements.toml
COPY fork/runtime-config/config.toml /etc/codex/config.toml
# 每个 Installation 的 CODEX_HOME/environments.toml 由 Core 从这里原样写入
COPY fork/runtime-config/environments.toml /usr/share/platform/codex/environments.toml
# CODEX_HOME 缺 environments.toml 时的回退路径同样不含 local environment
# （codex-rs/exec-server/src/environment_provider.rs::normalize_exec_server_url）
ENV CODEX_EXEC_SERVER_URL=none
USER 10001
# 默认 transport 是 stdio（--listen stdio://），由 Core supervisor 逐 Installation 启动
ENTRYPOINT ["/usr/local/bin/codex-app-server"]
