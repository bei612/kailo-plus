#!/usr/bin/env bash
# Kailo CI 节点：npm（Verdaccio）与 Go 模块（Athens）依赖下载缓存。用途、数据位置与回源方式见 07-运行与运维基线.md §2.1。
#
# 用法（在 CI 节点以 ubuntu 身份，从仓库检出或固定发布树执行）：
#   tools/ci/dep-cache/setup.sh up        安装运行副本、启动/更新两个缓存并等待 healthy，再经缓存实际取一次包与模块
#   tools/ci/dep-cache/setup.sh status    读回容器、健康、数据目录与占用
#   tools/ci/dep-cache/setup.sh probe     只读：经缓存取 pnpm 的 packument 与一个 Go 模块版本列表
#   tools/ci/dep-cache/setup.sh down      停止并删除容器（数据保留；构建入口探测失败后自动回源原站）
#
# 可覆盖的环境变量：
#   DEP_CACHE_DATA            数据根（默认 /var/lib/kailo-ci/dep-cache，必须在非机械盘上）
#   DEP_CACHE_RUNTIME         运行副本目录：compose.yaml、verdaccio.yaml、.env（默认 /volumes/kailo/ci/dep-cache）
#   NPM_CACHE_PORT / GO_CACHE_PORT   本机回环端口（默认 55002 / 55003，须与 build-args.sh 的缺省一致）
#   DEP_CACHE_UPSTREAM_PROXY  上游出口代理；未设置时取 DOCKER_CONFIG 中的 httpsProxy，设为空串则直连
#   DOCKER_CONFIG             构建用 Docker 客户端配置（默认 /volumes/data/kailo/ci/docker）
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
apps=$(cd "$here/../../.." && pwd)
export DOCKER_CONFIG=${DOCKER_CONFIG:-/volumes/data/kailo/ci/docker}
DEP_CACHE_DATA=${DEP_CACHE_DATA:-/var/lib/kailo-ci/dep-cache}
DEP_CACHE_RUNTIME=${DEP_CACHE_RUNTIME:-/volumes/kailo/ci/dep-cache}
NPM_CACHE_PORT=${NPM_CACHE_PORT:-55002}
GO_CACHE_PORT=${GO_CACHE_PORT:-55003}

die() { printf 'dep-cache: %s\n' "$*" >&2; exit 2; }

upstream_proxy() {
  if [ "${DEP_CACHE_UPSTREAM_PROXY+set}" = set ]; then
    printf '%s' "$DEP_CACHE_UPSTREAM_PROXY"; return
  fi
  python3 -I - "$DOCKER_CONFIG/config.json" <<'PY'
import json, sys
try:
    proxies = json.load(open(sys.argv[1], encoding="utf-8")).get("proxies", {}).get("default", {})
except FileNotFoundError:
    proxies = {}
print(proxies.get("httpsProxy", ""), end="")
PY
}

compose() {
  docker compose --project-directory "$DEP_CACHE_RUNTIME" -f "$DEP_CACHE_RUNTIME/compose.yaml" "$@"
}

install_runtime() {
  local stamp file
  mkdir -p "$DEP_CACHE_RUNTIME"
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  for file in compose.yaml verdaccio.yaml .env; do
    [ -f "$DEP_CACHE_RUNTIME/$file" ] && cp -a "$DEP_CACHE_RUNTIME/$file" "$DEP_CACHE_RUNTIME/$file.bak-$stamp"
  done
  install -m 0644 "$here/compose.yaml" "$here/verdaccio.yaml" "$DEP_CACHE_RUNTIME/"
  printf 'DEP_CACHE_DATA=%s\nDEP_CACHE_USER=%s\nNPM_CACHE_PORT=%s\nGO_CACHE_PORT=%s\nDEP_CACHE_UPSTREAM_PROXY=%s\n' \
    "$DEP_CACHE_DATA" "$(stat -c %u:%g "$DEP_CACHE_DATA")" "$NPM_CACHE_PORT" "$GO_CACHE_PORT" "$(upstream_proxy)" \
    > "$DEP_CACHE_RUNTIME/.env.tmp"
  chmod 0600 "$DEP_CACHE_RUNTIME/.env.tmp"
  mv "$DEP_CACHE_RUNTIME/.env.tmp" "$DEP_CACHE_RUNTIME/.env"
}

cmd_probe() {
  local npm="http://127.0.0.1:$NPM_CACHE_PORT" go="http://127.0.0.1:$GO_CACHE_PORT"
  curl -fsS --noproxy '*' -m 10 -o /dev/null "$npm/-/ping" || die "npm 缓存未在 $npm 响应"
  curl -fsS --noproxy '*' -m 10 -o /dev/null "$go/healthz" || die "Go 缓存未在 $go 响应"
  # 经缓存实际取内容（未命中即回源一次）：pnpm 的 packument 必须带 npm 原站的签名，Corepack 校验依赖它
  curl -fsS --noproxy '*' -m 180 "$npm/pnpm" | python3 -I -c '
import json, sys
doc = json.load(sys.stdin)
dist = doc["versions"][doc["dist-tags"]["latest"]]["dist"]
if not dist.get("integrity") or not dist.get("signatures"):
    sys.exit("npm 缓存返回的 packument 缺少 integrity 或 signatures")
print("npm 缓存：pnpm", doc["dist-tags"]["latest"], "packument 含 integrity 与原站签名")'
  curl -fsS --noproxy '*' -m 180 "$go/github.com/google/uuid/@v/list" | grep -qx 'v1.6.0' \
    || die "Go 缓存未返回 github.com/google/uuid 的版本列表"
  echo "Go 缓存：github.com/google/uuid 版本列表可取"
}

cmd_up() {
  [ -f "$apps/tools/container-safety.sh" ] || die "找不到 tools/container-safety.sh"
  # shellcheck source=../../container-safety.sh
  . "$apps/tools/container-safety.sh"
  mkdir -p "$DEP_CACHE_DATA/npm" "$DEP_CACHE_DATA/go"
  container_require_hot_path "$DEP_CACHE_DATA" >/dev/null || die "缓存数据必须位于 NVMe 热数据根（/var/lib/kailo-ci）：$DEP_CACHE_DATA"
  grep -q "\${NPM_CACHE_PORT:-$NPM_CACHE_PORT}" "$here/build-args.sh" && grep -q "\${GO_CACHE_PORT:-$GO_CACHE_PORT}" "$here/build-args.sh" \
    || die "build-args.sh 的缺省端口与 NPM_CACHE_PORT/GO_CACHE_PORT 不一致"
  install_runtime
  compose config --quiet
  compose up -d --wait --wait-timeout 120
  cmd_probe
  printf '依赖缓存就绪：npm 127.0.0.1:%s、Go 127.0.0.1:%s，数据 %s，运行副本 %s\n' \
    "$NPM_CACHE_PORT" "$GO_CACHE_PORT" "$DEP_CACHE_DATA" "$DEP_CACHE_RUNTIME"
}

cmd_status() {
  compose ps
  du -sh "$DEP_CACHE_DATA"/npm "$DEP_CACHE_DATA"/go 2>/dev/null || true
  findmnt -n -o SOURCE --target "$DEP_CACHE_DATA"
  curl -sS --noproxy '*' -m 5 -o /dev/null -w "npm /-/ping HTTP %{http_code}\n" "http://127.0.0.1:$NPM_CACHE_PORT/-/ping" || true
  curl -sS --noproxy '*' -m 5 -o /dev/null -w "go /healthz HTTP %{http_code}\n" "http://127.0.0.1:$GO_CACHE_PORT/healthz" || true
}

case "${1:-}" in
  up) shift; cmd_up "$@" ;;
  status) shift; cmd_status "$@" ;;
  probe) shift; cmd_probe "$@" ;;
  down) shift; compose down ;;
  *) sed -n '2,17p' "$0" >&2; exit 2 ;;
esac
