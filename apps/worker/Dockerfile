# Application Worker 的发布单元（00-实施总纲.md Stage 0 第 8 项）。
# 构建上下文为 apps/，与 core 一致。
#
# Go 版本从 go.mod 取——Temporal Go SDK v1.48.0 声明 Go >= 1.25.4，
# 写死低版本会让 Go 静默下载并切换工具链，使镜像内编译器版本不可控。

FROM golang:1.25-bookworm AS builder
WORKDIR /build
COPY worker/go.mod worker/go.sum ./
RUN go mod download
COPY worker ./
# 静态链接，使 runtime 层无需 libc
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/kailo-worker .

FROM gcr.io/distroless/static-debian12:nonroot AS runtime
COPY --from=builder /out/kailo-worker /usr/local/bin/kailo-worker
USER nonroot:nonroot
ENTRYPOINT ["/usr/local/bin/kailo-worker"]
