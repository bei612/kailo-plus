# Application Worker 的发布单元（00-实施总纲.md Stage 0 第 8 项）。
# 构建上下文为 apps/，与 core 一致。
#
# Go 版本从 go.mod 取——Temporal Go SDK v1.48.0 声明 Go >= 1.25.4，
# 写死低版本会让 Go 静默下载并切换工具链，使镜像内编译器版本不可控。

FROM golang:1.25-bookworm@sha256:3b4a11519ad929d1e1d261a12cff056f0c85b735253d7d861346b9c6f8b36437 AS builder
WORKDIR /build
COPY worker/go.mod worker/go.sum ./
# 依赖下载缓存（07 §2.1）：构建入口在 CI 节点投递 GOPROXY=<本机缓存>|https://proxy.golang.org,direct，缓存任何错误
# 即回退原站；只作用于本构建阶段，模块内容仍按 go.sum 校验，不进入运行镜像。
ARG GOPROXY=https://proxy.golang.org,direct
RUN go mod download
COPY worker ./
ARG PLATFORM_BUILD_ID
# 静态链接，使 runtime 层无需 libc
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X apps/worker/activities.platformBuildID=$PLATFORM_BUILD_ID" -o /out/platform-worker .

FROM gcr.io/distroless/static-debian12:nonroot@sha256:afa5c872c891853ca7fcf1f12c3edb23f7eeef36189728842dd51042ff57f7ab AS runtime
COPY --from=builder /out/platform-worker /usr/local/bin/platform-worker
USER nonroot:nonroot
ENTRYPOINT ["/usr/local/bin/platform-worker"]
