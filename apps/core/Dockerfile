# Platform Core/BFF 的发布单元（00-实施总纲.md Stage 0 第 8 项）。
# 构建上下文为 apps/，因为 core 需要读取 contracts/ 的 schema 校验同步。
#
# 多阶段：builder 产出静态二进制，runtime 只含二进制与运行所需证书。
# 不在镜像内保留工具链、源码或依赖缓存——它们会进 SBOM 并放大攻击面。

FROM rust:1.90-slim-bookworm AS builder
WORKDIR /build
# 先只拷清单，让依赖层在源码变动时仍可复用
COPY core/Cargo.toml core/Cargo.lock* ./
COPY core/crates ./crates
COPY core/.sqlx ./.sqlx
# 离线编译：镜像构建时没有数据库，用入库的 sqlx 查询快照做编译期 SQL 校验
ENV SQLX_OFFLINE=true
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    cargo build --release --locked --bin kailo-core

FROM debian:bookworm-slim AS runtime
# 以非 root 运行：Core 不需要任何特权
RUN useradd --system --uid 10001 --no-create-home kailo
COPY --from=builder /build/target/release/kailo-core /usr/local/bin/kailo-core
USER 10001
ENTRYPOINT ["/usr/local/bin/kailo-core"]
