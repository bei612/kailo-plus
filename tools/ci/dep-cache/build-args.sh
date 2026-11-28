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
#   PyPI    `ARG PYPI_MIRROR`：缓存健康（/health）时投递 PYPI_MIRROR=<缓存>/index/（proxpi 简单索引，文件链接指回缓存；pip/uv
#           仍按锁文件哈希校验）；不健康则不投递，Dockerfile 的缺省（pypi.org）生效，并打印原因。
#   PyTorch `ARG TORCH_INDEX`：同上，TORCH_INDEX=<缓存>/index/（download.pytorch.org/whl/cpu 的缓存，只有 CPU 构建）。
#   HF      `ARG HF_MIRROR`：缓存健康（/healthz）时投递 HF_MIRROR=<缓存>（作 HF_ENDPOINT；Hub 与 CDN 的跳转由缓存跟随）。
# 环境：KAILO_NPM_CACHE_URL / KAILO_GO_CACHE_URL / KAILO_PYPI_CACHE_URL / KAILO_TORCH_CACHE_URL / KAILO_HF_CACHE_URL 覆盖缓存
#       地址（缺省 kailo0 网关 10.239.0.1 的 55002/55003/55011/55013/55012，见 tools/ci/dep-cache/setup.sh），设为空串即不用缓存。
#
#   dependency_cache_kailo_env           在标准输出打印 kailo-macro 部署的 kailo.env 设置（KAILO_PYPI_MIRROR、KAILO_TORCH_INDEX、
#                                        KAILO_HF_MIRROR），只列健康的缓存；不健康的在标准错误说明。
GO_ORIGIN_PROXY="https://proxy.golang.org,direct"

dependency_cache_probe() {  # <url>：缓存健康返回 0
  curl -fsS --noproxy '*' -m 5 -o /dev/null "$1" 2>/dev/null
}

dependency_cache_python_urls() {  # 设置 pypi torch hf（缓存根地址，无结尾 /）
  pypi=${KAILO_PYPI_CACHE_URL-http://${DEP_CACHE_BIND:-10.239.0.1}:${PYPI_CACHE_PORT:-55011}}
  torch=${KAILO_TORCH_CACHE_URL-http://${DEP_CACHE_BIND:-10.239.0.1}:${TORCH_CACHE_PORT:-55013}}
  hf=${KAILO_HF_CACHE_URL-http://${DEP_CACHE_BIND:-10.239.0.1}:${HF_CACHE_PORT:-55012}}
  pypi=${pypi%/} torch=${torch%/} hf=${hf%/}
}

dependency_cache_declares() {  # <Dockerfile> <ARG 名>
  grep -qE "^[[:space:]]*ARG[[:space:]]+$2([[:space:]=]|\$)" "$1"
}

dependency_cache_kailo_env() {
  local pypi torch hf
  dependency_cache_python_urls
  if [ -n "$pypi" ] && dependency_cache_probe "$pypi/health"; then echo "KAILO_PYPI_MIRROR=$pypi/index/"
  else echo "依赖缓存：PyPI 缓存${pypi:+ $pypi }不可用，不设置 KAILO_PYPI_MIRROR" >&2; fi
  if [ -n "$torch" ] && dependency_cache_probe "$torch/health"; then echo "KAILO_TORCH_INDEX=$torch/index/"
  else echo "依赖缓存：PyTorch 索引缓存${torch:+ $torch }不可用，不设置 KAILO_TORCH_INDEX" >&2; fi
  if [ -n "$hf" ] && dependency_cache_probe "$hf/healthz"; then echo "KAILO_HF_MIRROR=$hf"
  else echo "依赖缓存：Hugging Face 缓存${hf:+ $hf }不可用，不设置 KAILO_HF_MIRROR" >&2; fi
}

dependency_cache_args() {
  local dockerfile=$1
  local npm=${KAILO_NPM_CACHE_URL-http://${DEP_CACHE_BIND:-10.239.0.1}:${NPM_CACHE_PORT:-55002}}
  local go=${KAILO_GO_CACHE_URL-http://${DEP_CACHE_BIND:-10.239.0.1}:${GO_CACHE_PORT:-55003}}
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
  local pypi torch hf
  dependency_cache_python_urls
  if dependency_cache_declares "$dockerfile" PYPI_MIRROR; then
    if [ -n "$pypi" ] && dependency_cache_probe "$pypi/health"; then
      DEPENDENCY_CACHE_ARGS+=(--build-arg "PYPI_MIRROR=$pypi/index/")
      echo "依赖缓存：PyPI 经 $pypi/index/（未命中由缓存回源）"
    else
      echo "依赖缓存：PyPI 缓存${pypi:+ $pypi }不可用，本次构建用 Dockerfile 缺省的索引（回源）"
    fi
  fi
  if dependency_cache_declares "$dockerfile" TORCH_INDEX; then
    if [ -n "$torch" ] && dependency_cache_probe "$torch/health"; then
      DEPENDENCY_CACHE_ARGS+=(--build-arg "TORCH_INDEX=$torch/index/")
      echo "依赖缓存：PyTorch CPU 轮子经 $torch/index/（未命中由缓存回源 download.pytorch.org）"
    else
      echo "依赖缓存：PyTorch 索引缓存${torch:+ $torch }不可用，本次构建用 Dockerfile 缺省的索引（回源）"
    fi
  fi
  if dependency_cache_declares "$dockerfile" HF_MIRROR; then
    if [ -n "$hf" ] && dependency_cache_probe "$hf/healthz"; then
      DEPENDENCY_CACHE_ARGS+=(--build-arg "HF_MIRROR=$hf")
      echo "依赖缓存：Hugging Face 经 $hf（未命中由缓存回源）"
    else
      echo "依赖缓存：Hugging Face 缓存${hf:+ $hf }不可用，本次构建用 Dockerfile 缺省的端点（回源）"
    fi
  fi
}
