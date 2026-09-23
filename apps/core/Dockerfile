# Platform Core/BFF 的发布单元（00-实施总纲.md Stage 0 第 8 项）。
# 构建上下文为 apps/（与 worker 共用）；进入上下文的路径由 apps/.dockerignore
# 的 allowlist 决定，secrets/ 与 data/ 不在其中。
#
# 多阶段：builder 产出静态二进制，runtime 只含二进制与运行所需证书。
# 不在镜像内保留工具链、源码或依赖缓存——它们会进 SBOM 并放大攻击面。

FROM rust:1.90-slim-bookworm@sha256:64232e656c058f4468e8d024e990acff04f0fd5a5c0a88a574dc37773d7325c9 AS builder
WORKDIR /build
# 先只拷清单，让依赖层在源码变动时仍可复用
COPY core/Cargo.toml core/Cargo.lock* ./
COPY core/crates ./crates
COPY core/.sqlx ./.sqlx
# 离线编译：镜像构建时没有数据库，用入库的 sqlx 查询快照做编译期 SQL 校验
ENV SQLX_OFFLINE=true
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    cargo build --release --locked --bin kailo-core

FROM debian:bookworm-slim@sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251 AS runtime
# 以非 root 运行：Core 不需要任何特权
RUN useradd --system --uid 10001 --no-create-home kailo
COPY --from=builder /build/target/release/kailo-core /usr/local/bin/kailo-core
USER 10001
ENTRYPOINT ["/usr/local/bin/kailo-core"]
