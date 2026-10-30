#!/usr/bin/env bash
# Kailo CI 节点热目录定时保留的声明式安装（07 §2.1）。
#
# 用法（CI 节点，ubuntu，需 sudo -n；从仓库检出或固定发布树执行）：
#   tools/ci/retention/setup.sh install         复制脚本与策略到运行副本目录，安装 unit，启用 timer 并回读
#   tools/ci/retention/setup.sh run [--dry-run] 以 root 立即执行一轮（--dry-run 只列出将删除的子项）
#   tools/ci/retention/setup.sh status          回读 timer、上次执行结果与运行副本摘要
#   tools/ci/retention/setup.sh uninstall       停用并删除 unit（运行副本保留）
# 运行副本目录：RETENTION_RUNTIME（缺省 /volumes/kailo/ci/hot-retention），与仓库检出无关；替换前的文件备份为 *.bak-<时间>。
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
RUNTIME=${RETENTION_RUNTIME:-/volumes/kailo/ci/hot-retention}
UNIT=kailo-ci-hot-retention
UNIT_DIR=/etc/systemd/system

die() { printf 'hot-retention: %s\n' "$*" >&2; exit 2; }

check_sources() {
  python3 -I -B "$here/hot-retention.py" --policy "$here/policy.json" --help >/dev/null
  python3 -I -c 'import json, sys; json.load(open(sys.argv[1]))' "$here/policy.json"
  grep -q "^ExecStart=/usr/bin/python3 -I -B $RUNTIME/hot-retention.py --policy $RUNTIME/policy.json\$" "$here/$UNIT.service" \
    || die "$UNIT.service 的 ExecStart 与运行副本目录 $RUNTIME 不一致"
}

cmd_install() {
  local stamp file
  check_sources
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  mkdir -p "$RUNTIME"
  for file in hot-retention.py policy.json; do
    if [ -f "$RUNTIME/$file" ] && ! cmp -s "$here/$file" "$RUNTIME/$file"; then
      cp -a "$RUNTIME/$file" "$RUNTIME/$file.bak-$stamp"
    fi
    install -m 0644 "$here/$file" "$RUNTIME/$file.tmp" && mv -f "$RUNTIME/$file.tmp" "$RUNTIME/$file"
  done
  for file in "$UNIT.service" "$UNIT.timer"; do
    if [ -f "$UNIT_DIR/$file" ] && ! cmp -s "$here/$file" "$UNIT_DIR/$file"; then
      sudo -n cp -a "$UNIT_DIR/$file" "$RUNTIME/$file.bak-$stamp"
    fi
    sudo -n install -m 0644 -o root -g root "$here/$file" "$UNIT_DIR/$file"
  done
  sudo -n systemd-analyze verify "$UNIT_DIR/$UNIT.service" "$UNIT_DIR/$UNIT.timer"
  sudo -n systemctl daemon-reload
  sudo -n systemctl enable --now "$UNIT.timer"
  cmd_status
}

cmd_run() {
  [ "${1:-}" = "" ] || [ "$1" = --dry-run ] || die "run 只接受 --dry-run"
  sudo -n /usr/bin/python3 -I -B "$RUNTIME/hot-retention.py" --policy "$RUNTIME/policy.json" ${1:+"$1"}
}

cmd_status() {
  for file in hot-retention.py policy.json; do
    if cmp -s "$here/$file" "$RUNTIME/$file"; then echo "运行副本 $file 与仓库一致"; else echo "运行副本 $file 与仓库不同或缺失"; fi
  done
  printf 'timer：%s / %s\n' "$(systemctl is-enabled "$UNIT.timer" 2>&1)" "$(systemctl is-active "$UNIT.timer" 2>&1)"
  systemctl list-timers "$UNIT.timer" --no-pager | sed -n '1,3p'
  systemctl show "$UNIT.service" -p Result -p ExecMainStatus -p ExecMainExitTimestamp --no-pager
}

cmd_uninstall() {
  sudo -n systemctl disable --now "$UNIT.timer" || true
  sudo -n rm -f "$UNIT_DIR/$UNIT.service" "$UNIT_DIR/$UNIT.timer"
  sudo -n systemctl daemon-reload
}

case "${1:-}" in
  install) cmd_install ;;
  run) shift; cmd_run "$@" ;;
  status) cmd_status ;;
  uninstall) cmd_uninstall ;;
  *) sed -n '2,9p' "$0" >&2; exit 2 ;;
esac
