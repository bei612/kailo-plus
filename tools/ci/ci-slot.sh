#!/usr/bin/env bash
# CI 节点重型临时任务的槽位（07 §2.1）：全节点同时最多 CI_SLOT_COUNT（缺省 2）个分支检查、jest、clippy、next build
# 一类的临时任务；其余排队。占槽前还要过内存与 NVMe 磁盘准入，暂存目录强制放在 NVMe 热数据根。
#
# 用法（CI 节点，任何用户）：
#   ci-slot.sh [--name 标签] <命令> [参数...]     排队取槽 → 准入 → 在槽内执行命令，退出码即命令退出码
#   ci-slot.sh --status                          列出槽位占用者与排队者（只读）
#
# 槽内命令得到的环境：
#   CI_SLOT_HELD=<槽号>      嵌套调用（例如 branch-check.sh 自己也经本脚本）直接执行，不再取槽、不会自锁
#   CI_SLOT_WORK=<目录>      本次任务独占的 NVMe 暂存目录（/var/lib/kailo-ci/slots/work/<槽号>-<pid>），结束即删
#   TMPDIR=<同上>/tmp        临时文件一律落 NVMe；调用方给出的 TMPDIR 若在机械盘（/volumes/data 的 SMR 盘）上即拒绝
# 准入（取槽前满足才占槽，不满足就继续排队并显示原因）：
#   MemAvailable ≥ CI_SLOT_MIN_MEM_GIB（缺省 12）；/var/lib/kailo-ci 可用空间 ≥ CI_SLOT_MIN_DISK_GIB（缺省 20）
# 等待上限 CI_SLOT_WAIT_SECONDS（缺省 0 = 一直等）；超时退出 75。槽由 flock 持有，进程退出（含被杀）即释放。
set -euo pipefail

ROOT=${CI_SLOT_ROOT:-/var/lib/kailo-ci/slots}
COUNT=${CI_SLOT_COUNT:-2}
MIN_MEM_GIB=${CI_SLOT_MIN_MEM_GIB:-12}
MIN_DISK_GIB=${CI_SLOT_MIN_DISK_GIB:-20}
WAIT=${CI_SLOT_WAIT_SECONDS:-0}
POLL=${CI_SLOT_POLL_SECONDS:-15}

die() { printf 'ci-slot: %s\n' "$*" >&2; exit 2; }

rotational() {  # 路径所在块设备是否机械盘：1/0/空
  local majmin node
  majmin=$(findmnt -n -o MAJ:MIN --target "$1" 2>/dev/null | head -n 1 | tr -d '[:space:]')
  [ -n "$majmin" ] || return 0
  node=/sys/dev/block/$majmin
  [ -e "$node/queue/rotational" ] || node=$node/..
  [ -r "$node/queue/rotational" ] && cat "$node/queue/rotational"
  return 0
}

status() {
  local i holder
  for i in $(seq 0 $((COUNT - 1))); do
    holder=$(cat "$ROOT/slot.$i.owner" 2>/dev/null || true)
    if flock -n "$ROOT/slot.$i.lock" true 2>/dev/null; then
      echo "槽 $i：空闲"
    else
      echo "槽 $i：占用 ${holder:-（未知）}"
    fi
  done
  echo "排队：$(find "$ROOT/queue" -maxdepth 1 -name '*.wait' 2>/dev/null | wc -l) 个"
  find "$ROOT/queue" -maxdepth 1 -name '*.wait' -printf '  %f\n' 2>/dev/null | head -20
  awk '/^MemAvailable:/ {printf "MemAvailable %.1f GiB\n", $2/1048576}' /proc/meminfo
  df -h --output=avail,target "$ROOT" | tail -n 1 | sed 's/^/NVMe 可用 /'
}

[ "$(rotational /var/lib/kailo-ci)" != 1 ] || die "/var/lib/kailo-ci 不在 NVMe 上，拒绝"
mkdir -p "$ROOT/queue" "$ROOT/work"
chmod 1777 "$ROOT" "$ROOT/queue" "$ROOT/work" 2>/dev/null || true
for i in $(seq 0 $((COUNT - 1))); do
  [ -e "$ROOT/slot.$i.lock" ] || { : > "$ROOT/slot.$i.lock"; chmod 0666 "$ROOT/slot.$i.lock" 2>/dev/null || true; }
done

name=
case "${1:-}" in
  --status) status; exit 0 ;;
  --name) name=${2:?--name 需要标签}; shift 2 ;;
  ""|-h|--help) sed -n '2,19p' "$0" >&2; exit 2 ;;
esac
[ "$#" -gt 0 ] || die "缺少要执行的命令"
name=${name:-$(basename "$1")}
[[ $name =~ ^[A-Za-z0-9._-]{1,64}$ ]] || die "标签只能是 [A-Za-z0-9._-]：$name"

# 已在槽内（嵌套调用）：直接执行
if [ -n "${CI_SLOT_HELD:-}" ]; then
  exec "$@"
fi
if [ -n "${TMPDIR:-}" ] && [ -e "$TMPDIR" ] && [ "$(rotational "$TMPDIR")" = 1 ]; then
  die "TMPDIR=$TMPDIR 在机械盘上；临时目录必须在 NVMe（不设置即由本脚本分配）"
fi

ticket="$ROOT/queue/$(date +%s).$$.$(id -un).$name.wait"
printf '%s\n' "$*" > "$ticket" 2>/dev/null || true
trap 'rm -f -- "$ticket"' EXIT
start=$(date +%s)
said=
slot=
while :; do
  mem=$(awk '/^MemAvailable:/ {print int($2/1048576)}' /proc/meminfo)
  disk=$(df --output=avail -B1G "$ROOT" | tail -n 1 | tr -d ' ')
  reason=
  [ "$mem" -ge "$MIN_MEM_GIB" ] || reason="内存 ${mem}GiB < ${MIN_MEM_GIB}GiB"
  [ "$disk" -ge "$MIN_DISK_GIB" ] || reason="${reason:+$reason；}NVMe 可用 ${disk}GiB < ${MIN_DISK_GIB}GiB"
  if [ -z "$reason" ]; then
    for i in $(seq 0 $((COUNT - 1))); do
      exec {fd}<>"$ROOT/slot.$i.lock"
      if flock -n "$fd"; then slot=$i; break; fi
      exec {fd}>&-
    done
    [ -n "$slot" ] && break
    reason="$COUNT 个槽均被占用"
  fi
  if [ "$said" != "$reason" ]; then
    printf 'ci-slot: 排队（%s）：%s\n' "$reason" "$name" >&2
    said=$reason
  fi
  if [ "$WAIT" -gt 0 ] && [ $(( $(date +%s) - start )) -ge "$WAIT" ]; then
    printf 'ci-slot: 等待超过 %s 秒，放弃：%s\n' "$WAIT" "$name" >&2
    exit 75
  fi
  sleep "$POLL"
done
rm -f -- "$ticket"
work="$ROOT/work/$slot-$$"
mkdir -p "$work/tmp"
cmd_text="$*"
printf '%s pid=%s user=%s since=%s cmd=%s\n' "$name" "$$" "$(id -un)" "$(date -u +%FT%TZ)" "${cmd_text:0:200}" > "$ROOT/slot.$slot.owner"
trap 'rm -rf -- "$work"; : > "$ROOT/slot.$slot.owner" 2>/dev/null || true' EXIT
printf 'ci-slot: 取得槽 %s（等待 %s 秒）：%s\n' "$slot" "$(( $(date +%s) - start ))" "$name" >&2
set +e
CI_SLOT_HELD=$slot CI_SLOT_WORK=$work TMPDIR=$work/tmp "$@"
code=$?
set -e
exit "$code"
