#!/usr/bin/env bash
# core-observed/ audit device 的宿主目录（secret-store-config.hcl、03 §9、DD-70）。
#
# OpenBao（uid 100）在 data/secret-store-audit 下写 0640 的 audit.log；目录属组为
# OPENBAO_AUDIT_READER_GID 且带 setgid，新建（含截断后重建）的文件继承该组，Core
# 以同一附加组只读挂载读取。目录不在 data/secret-store（raft 数据）之内，也不是它的
# 符号链接，Core 因此读不到完整 device 与 raft 存储。
#
# 用法（deploy/local 下）：
#   ./secret-store-audit-dir.sh --prepare   建立/修正属主与权限（需要 sudo -n）
#   ./secret-store-audit-dir.sh --check     只核对，不改动
set -euo pipefail
cd "$(dirname "$0")"
case "$#:${1:-}" in
  1:--prepare) mode=prepare ;;
  1:--check) mode=check ;;
  *) echo '用法：secret-store-audit-dir.sh --prepare|--check' >&2; exit 2 ;;
esac
# .env 与 data/ 在运行目录（ADR-20 §3；缺省即本目录）
. ./runtime-dir.sh
. "$KAILO_RUNTIME_DIR/.env"
gid=${OPENBAO_AUDIT_READER_GID:?缺少 .env 中的 OPENBAO_AUDIT_READER_GID}
max=${OPENBAO_AUDIT_LOG_MAX_BYTES:?缺少 .env 中的 OPENBAO_AUDIT_LOG_MAX_BYTES}
bound=${OPENBAO_AUDIT_LOG_BOUND_BYTES:?缺少 .env 中的 OPENBAO_AUDIT_LOG_BOUND_BYTES}
interval=${OPENBAO_AUDIT_BOUND_INTERVAL_SECONDS:?缺少 .env 中的 OPENBAO_AUDIT_BOUND_INTERVAL_SECONDS}
for value in "$gid" "$max" "$bound" "$interval"; do
  [[ "$value" =~ ^[1-9][0-9]*$ ]] || { echo 'audit 观察副本的属组、上界与间隔必须是正整数' >&2; exit 2; }
done
# 截断阈值必须低于 Core 的读取上界，否则文件在截断前就先被 Core 整体拒绝。
[ "$bound" -lt "$max" ] || { echo 'OPENBAO_AUDIT_LOG_BOUND_BYTES 必须小于 OPENBAO_AUDIT_LOG_MAX_BYTES' >&2; exit 2; }
[ "$gid" != 1000 ] || { echo 'OPENBAO_AUDIT_READER_GID 不得复用 OpenBao 进程组 1000' >&2; exit 2; }

dir=$KAILO_RUNTIME_DIR/data/secret-store-audit
[ -d "$KAILO_RUNTIME_DIR/data" ] || { echo "缺少运行目录 data：$KAILO_RUNTIME_DIR/data" >&2; exit 2; }
if [ "$mode" = prepare ]; then
  [ -L "$dir" ] && { echo "$dir 不得是符号链接" >&2; exit 2; }
  sudo -n mkdir -p -- "$dir"
  sudo -n chown "100:$gid" -- "$dir"
  sudo -n chmod 2750 -- "$dir"
fi
[ -d "$dir" ] && [ ! -L "$dir" ] || { echo "$dir 不存在或是符号链接：先运行 --prepare" >&2; exit 2; }
real=$(realpath -e -- "$dir")
store=$(realpath -e -- "$KAILO_RUNTIME_DIR/data/secret-store" 2>/dev/null || true)
if [ -n "$store" ]; then
  case "$real/" in "$store"/*) echo "$dir 不得位于 raft 数据目录之内" >&2; exit 2 ;; esac
fi
actual=$(stat -c '%u:%g:%a' -- "$dir")
[ "$actual" = "100:$gid:2750" ] || { echo "$dir 属主/权限为 $actual，需要 100:$gid:2750（运行 --prepare）" >&2; exit 2; }
printf '已就绪：%s（100:%s，2750）\n' "$dir" "$gid"
