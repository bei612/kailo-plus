#!/usr/bin/env bash
# kailo-dev-check 的节点侧安装（OPS-05）。CI 节点上 ubuntu 执行，从 GitHub 取出的本目录运行：
#   tools/ci/dev-check/setup.sh install    复制 dev-check.sh 与 envguard.py 到运行副本 /volumes/kailo/ci/dev-check，
#                                          在 CI 缓存文件系统（ci-fs）上建工作目录
#   tools/ci/dev-check/setup.sh status     运行副本是否与本目录一致，常驻容器、库与 target 占用
#   tools/ci/dev-check/setup.sh remove     删除常驻容器、库容器与网络（工作目录保留，可手工删除）
# 开发机入口 kailo-dev-check 另装：sudo install -m 0755 tools/ci/dev-check/kailo-dev-check /usr/local/bin/
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
RUNTIME=${DEV_CHECK_RUNTIME:-/volumes/kailo/ci/dev-check}
ROOT=${DEV_CHECK_ROOT:-/var/lib/kailo-ci/ci-fs/dev-check}
export DOCKER_HOST=unix:///run/kailo-docker/docker.sock
case "${1:-}" in
  install)
    bash -n "$here/dev-check.sh"; bash -n "$here/dev-check-job.sh"
    python3 -I -B "$here/../service/envguard.py" --help >/dev/null
    mkdir -p "$RUNTIME"
    stamp=$(date -u +%Y%m%dT%H%M%SZ)
    for f in "$here/dev-check.sh" "$here/dev-check-job.sh" "$here/../service/envguard.py"; do
      dst=$RUNTIME/$(basename "$f")
      [ -f "$dst" ] && ! cmp -s "$f" "$dst" && cp -a "$dst" "$dst.bak-$stamp"
      install -m 0755 "$f" "$dst.tmp" && mv -f "$dst.tmp" "$dst"
    done
    [ -d "$ROOT" ] || sudo -n install -d -o "$(id -u)" -g "$(id -g)" -m 0755 "$ROOT"
    echo "kailo-dev-check installed in $RUNTIME (work directory $ROOT)" ;;
  status)
    for f in dev-check.sh dev-check-job.sh; do cmp -s "$here/$f" "$RUNTIME/$f" && echo "$f: current" || echo "$f: differs or missing"; done
    cmp -s "$here/../service/envguard.py" "$RUNTIME/envguard.py" && echo "envguard.py: current" || echo "envguard.py: differs or missing"
    docker ps -a --filter name=kailo-dev-check --format '{{.Names}}  {{.Status}}  {{.Image}}'
    du -sh "$ROOT/target" "$ROOT/src" 2>/dev/null || true ;;
  remove)
    docker rm -f kailo-dev-check kailo-dev-check-pg >/dev/null 2>&1 || true
    docker network rm kailo-dev-check >/dev/null 2>&1 || true ;;
  *) sed -n '2,7p' "$0" >&2; exit 2 ;;
esac
