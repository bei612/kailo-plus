# Platform Core/BFF 的发布单元（00-实施总纲.md Stage 0 第 8 项）。
# 构建上下文为 apps/（与 worker 共用）；进入上下文的路径由 apps/.dockerignore
# 的 allowlist 决定，secrets/ 与 data/ 不在其中。
#
# 多阶段：builder 产出静态二进制，runtime 只含二进制与运行所需证书。
# 不在镜像内保留工具链、源码或依赖缓存——它们会进 SBOM 并放大攻击面。

ARG AGENT_RUNTIME_IMAGE
FROM rust:1.90-slim-bookworm@sha256:64232e656c058f4468e8d024e990acff04f0fd5a5c0a88a574dc37773d7325c9 AS builder
WORKDIR /build/apps/core
# 先只拷清单，让依赖层在源码变动时仍可复用
COPY core/Cargo.toml core/Cargo.lock* ./
COPY core/crates ./crates
COPY core/.sqlx ./.sqlx
COPY collaboration/Cargo.toml /build/apps/collaboration/Cargo.toml
COPY collaboration/crates/buzz-core /build/apps/collaboration/crates/buzz-core
COPY tools/registry/capabilities.yaml /build/apps/tools/registry/capabilities.yaml
COPY contracts/api/action_submission.schema.json /build/apps/contracts/api/action_submission.schema.json
# 离线编译：镜像构建时没有数据库，用入库的 sqlx 查询快照做编译期 SQL 校验
ENV SQLX_OFFLINE=true
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    cargo build --release --locked --bin platform-core

# 原 helper 实际构建的固定 agent-runtime digest 是唯一 binary/config 来源。
# 直接复用其最小 runtime：包含 Codex 所需 CA/libssl/liblzma 与 /etc/codex，
# 不在 Core recipe 再编译第二份 Codex，也不只拷 executable 漏掉动态库。
FROM ${AGENT_RUNTIME_IMAGE} AS runtime
COPY --from=builder /build/apps/core/target/release/platform-core /usr/local/bin/platform-core
USER 10001
ENTRYPOINT ["/usr/local/bin/platform-core"]
