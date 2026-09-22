#!/usr/bin/env bash
# 从 contracts/ 的 JSON Schema 生成四侧类型（ADR-03）。
# contracts/ 是唯一权威；生成目录只由本脚本写入，不手工编辑。
# 用法：tools/gen.sh [--check]   --check 只校验工作树与重新生成结果一致
set -euo pipefail
cd "$(dirname "$0")/.." || exit 2

QT="quicktype@23.0.171"
SRC=contracts
CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

# 目标落点由 ADR-03 固定
declare -A OUT=(
  [rs]="core/crates/contracts/src/generated/contracts.rs"
  [go]="worker/internal/contracts/generated/contracts.go"
  [ts]="web/packages/contracts/src/generated/contracts.ts"
  [dart]="mobile/lib/shared/contracts/generated/contracts.dart"
)
declare -A EXTRA=(
  [rs]="--visibility public --derive-debug --derive-clone --derive-partial-eq"
  [go]="--package generated --just-types"
  [ts]="--just-types --explicit-unions"
  [dart]="--just-types --final-props"
)

work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
fail=0

for lang in "${!OUT[@]}"; do
  dest="${OUT[$lang]}"
  tmp="$work/$(basename "$dest")"
  mkdir -p "$(dirname "$dest")"
  # shellcheck disable=SC2086
  if ! npx --yes "$QT" --src-lang schema --lang "$lang" \
        ${EXTRA[$lang]} --out "$tmp" "$SRC/canary.schema.json" >/dev/null 2>"$work/$lang.err"; then
    printf '  \033[31mFAIL\033[0m %-5s 生成失败\n' "$lang"; sed 's/^/        /' "$work/$lang.err"; fail=1; continue
  fi
  if [ "$CHECK" -eq 1 ]; then
    if [ ! -f "$dest" ] || ! diff -q "$tmp" "$dest" >/dev/null; then
      printf '  \033[31mFAIL\033[0m %-5s 生成物与工作树不一致\n' "$lang"; fail=1
    else
      printf '  \033[32mPASS\033[0m %-5s 同步\n' "$lang"
    fi
  else
    cp "$tmp" "$dest"
    printf '  \033[32mOK\033[0m   %-5s -> %s\n' "$lang" "$dest"
  fi
done
exit "$fail"
