#!/usr/bin/env bash
# 依赖下载缓存的构建参数（07 §2.1），由 tools/build-upstream.sh 与 tools/release.sh 引入（source）。
#
#   dependency_cache_args <Dockerfile>   设置数组 DEPENDENCY_CACHE_ARGS（--build-arg …），并在标准输出说明走向
#
# 推导而非清单：只有 Dockerfile 声明了 `ARG NPM_REGISTRY` / `ARG GOPROXY` 的构建才投递，且这些 ARG 只用于构建阶段
# 的依赖下载（不进入最终镜像的层或配置）。缓存不改变依赖内容：npm/pnpm 按锁文件 integrity、Go 按 go.sum 校验。
#   npm  缓存健康（/-/ping）时投递 NPM_REGISTRY=<缓存>/；不健康则不投递，本次构建直连 registry.npmjs.org（回源），并打印原因。
#        npm 客户端没有多源回退，健康探测之后缓存若中途失败，构建会以连接错误失败（明确报错，不静默改源）。
#   Go   缓存健康时投递 GOPROXY=<缓存>|https://proxy.golang.org,direct：`|` 使缓存的任何错误（含连接失败）都回退原站；
#        不健康时投递 GOPROXY=https://proxy.golang.org,direct。
# 环境：KAILO_NPM_CACHE_URL / KAILO_GO_CACHE_URL 覆盖缓存地址（缺省本机回环 55002/55003，见 tools/ci/dep-cache/setup.sh），
#       设为空串即不用缓存。
GO_ORIGIN_PROXY="https://proxy.golang.org,direct"

dependency_cache_probe() {  # <url>：缓存健康返回 0
  curl -fsS --noproxy '*' -m 5 -o /dev/null "$1" 2>/dev/null
}

dependency_cache_args() {
  local dockerfile=$1
  local npm=${KAILO_NPM_CACHE_URL-http://127.0.0.1:${NPM_CACHE_PORT:-55002}}
  local go=${KAILO_GO_CACHE_URL-http://127.0.0.1:${GO_CACHE_PORT:-55003}}
  DEPENDENCY_CACHE_ARGS=()
  [ -f "$dockerfile" ] || { echo "依赖缓存：找不到 $dockerfile" >&2; return 2; }
  if grep -qE '^[[:space:]]*ARG[[:space:]]+NPM_REGISTRY([[:space:]=]|$)' "$dockerfile"; then
    if [ -n "$npm" ] && dependency_cache_probe "${npm%/}/-/ping"; then
      DEPENDENCY_CACHE_ARGS+=(--build-arg "NPM_REGISTRY=${npm%/}/")
      echo "依赖缓存：npm 经 ${npm%/}（未命中由缓存回源 registry.npmjs.org）"
    else
      echo "依赖缓存：npm 缓存${npm:+ ${npm%/} }不可用，本次构建直连 registry.npmjs.org（回源）"
    fi
  fi
  if grep -qE '^[[:space:]]*ARG[[:space:]]+GOPROXY([[:space:]=]|$)' "$dockerfile"; then
    if [ -n "$go" ] && dependency_cache_probe "${go%/}/healthz"; then
      DEPENDENCY_CACHE_ARGS+=(--build-arg "GOPROXY=${go%/}|$GO_ORIGIN_PROXY")
      echo "依赖缓存：Go 模块经 ${go%/}，缓存任何错误即回退 proxy.golang.org"
    else
      DEPENDENCY_CACHE_ARGS+=(--build-arg "GOPROXY=$GO_ORIGIN_PROXY")
      echo "依赖缓存：Go 缓存${go:+ ${go%/} }不可用，本次构建直连 proxy.golang.org（回源）"
    fi
  fi
}
