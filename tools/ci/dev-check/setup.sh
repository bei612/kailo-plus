#!/usr/bin/env bash
# kailo-dev-check 的节点侧安装（OPS-05）。CI 节点上 ubuntu 执行，从 GitHub 取出的本目录运行：
#   tools/ci/dev-check/setup.sh install    复制 dev-check.sh、dev-check-job.sh 与 envguard.py 到运行副本 /volumes/kailo/ci/dev-check，
#                                          在 CI 缓存文件系统（ci-fs）上建工作目录（各槽的子目录由 dev-check.sh 首次用到时建）
#   tools/ci/dev-check/setup.sh status     运行副本是否与本目录一致，dev_check.slots，各槽常驻容器、库容器与各槽 target 占用
#   tools/ci/dev-check/setup.sh remove     删除各槽常驻容器、库容器与网络（工作目录保留，可手工删除）
# 槽（config.json dev_check.slots，缺省 1）：槽 0 = <root>/{src,target}、容器 kailo-dev-check；槽 i = <root>/slot-<i>/、容器 kailo-dev-check-<i>。
# 调小 slots 后，多出的槽的容器与目录不再使用：remove 后由下一次检查重建所需的容器，目录可手工删除。
# 开发机入口 kailo-dev-check 另装：sudo install -m 0755 tools/ci/dev-check/kailo-dev-check /usr/local/bin/
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
RUNTIME=${DEV_CHECK_RUNTIME:-/volumes/kailo/ci/dev-check}
CONFIG=${KAILO_CI_CONFIG:-/volumes/kailo/ci/config.json}
ROOT=${DEV_CHECK_ROOT:-/var/lib/kailo-ci/ci-fs/dev-check}
SLOTS=$(python3 -I -c 'import json,sys; print(max(1, int((json.load(open(sys.argv[1])).get("dev_check") or {}).get("slots", 1))))' "$CONFIG" 2>/dev/null || echo 1)
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
    echo "kailo-dev-check installed in $RUNTIME (work directory $ROOT, dev_check.slots=$SLOTS)" ;;
  status)
    for f in dev-check.sh dev-check-job.sh; do cmp -s "$here/$f" "$RUNTIME/$f" && echo "$f: current" || echo "$f: differs or missing"; done
    cmp -s "$here/../service/envguard.py" "$RUNTIME/envguard.py" && echo "envguard.py: current" || echo "envguard.py: differs or missing"
    echo "dev_check.slots: $SLOTS"
    docker ps -a --filter name=kailo-dev-check --format '{{.Names}}  {{.Status}}  {{.Image}}'
    for d in "$ROOT" "$ROOT"/slot-*; do
      [ -d "$d/src" ] || [ -d "$d/target" ] || continue
      printf '%s  holder: %s\n' "$d" "$(flock -n "$d/dev-check.lock" true 2>/dev/null && echo free || cat "$d/dev-check.lock.holder" 2>/dev/null)"
      du -sh "$d/target" "$d/src" 2>/dev/null || true
    done
    df -h "$ROOT" | tail -1 ;;
  remove)
    docker ps -aq --filter name='^kailo-dev-check(-[0-9]+)?(-pg)?$' | xargs -r docker rm -f >/dev/null 2>&1 || true
    docker network rm kailo-dev-check >/dev/null 2>&1 || true ;;
  *) sed -n '2,9p' "$0" >&2; exit 2 ;;
esac
