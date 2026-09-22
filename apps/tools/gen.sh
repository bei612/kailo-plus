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
  # skip-serializing-none / omit-empty：可选字段缺省时必须省略而不是写 null，
  # 否则四侧线格式不一致，且与 schema 的 additionalProperties:false 抵触。
  [rs]="--visibility public --derive-debug --derive-clone --derive-partial-eq --skip-serializing-none"
  [go]="--package generated --omit-empty"
  [ts]="--just-types --explicit-unions"
  [dart]="--final-props"
)

work=$(mktemp -d); trap 'rm -rf "$work"' EXIT

# 顶层类型名取自 schema 的 title，不取输出文件名——否则类型名会随文件名漂移
TOPLEVEL=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["title"])' "$SRC/canary.schema.json")

# 输入集合：canary 定义可用子集，domain/ 是业务契约。
# enums/ 不单独传入——它们由 $ref 引入，单独传会生成重复类型。
SCHEMAS=("$SRC/canary.schema.json")
while IFS= read -r f; do SCHEMAS+=("$f"); done < <(find "$SRC/domain" -name '*.schema.json' 2>/dev/null | sort)
fail=0

for lang in "${!OUT[@]}"; do
  dest="${OUT[$lang]}"
  tmp="$work/$(basename "$dest")"
  mkdir -p "$(dirname "$dest")"
  # shellcheck disable=SC2086
  if ! npx --yes "$QT" --src-lang schema --lang "$lang" --top-level "$TOPLEVEL" \
        ${EXTRA[$lang]} --out "$tmp" "${SCHEMAS[@]}" >/dev/null 2>"$work/$lang.err"; then
    printf '  \033[31mFAIL\033[0m %-5s 生成失败\n' "$lang"; sed 's/^/        /' "$work/$lang.err"; fail=1; continue
  fi
  case "$lang" in
    rs) command -v rustfmt >/dev/null 2>&1 && rustfmt --edition 2021 "$tmp" ;;
    go) command -v gofmt   >/dev/null 2>&1 && gofmt -w "$tmp" ;;
    dart)
      # quicktype 的 Dart 后端把缺省的可选字段写成 null，而 schema 里这些字段
      # 的类型是 string/integer 且子集禁止联合类型——null 对 schema 非法，
      # 四侧线格式也会因此分叉。Dart 后端没有对应开关（rs 有
      # --skip-serializing-none、go 有 --omit-empty），因此在生成后做一次
      # 确定性改写：所有 toJson() 返回的字面量 Map 经 _stripNulls 过滤。
      # 正确性由四侧 round-trip 测试保证，不靠人工复核。
      python3 - "$tmp" <<'PYDART'
import re, sys
p = sys.argv[1]
src = open(p, encoding="utf-8").read()
src = re.sub(r"Map<String, dynamic> toJson\(\) => \{",
             "Map<String, dynamic> toJson() => _stripNulls({", src)
# 与上面的 `{` 配对的结尾：quicktype 固定生成 `    };`
src = re.sub(r"\n(\s*)\};\n", lambda m: "\n%s});\n" % m.group(1), src)
src += """

/// 去掉值为 null 的键。缺省的可选字段必须在线格式中省略而不是写成 null——
/// schema 未把 null 列入这些字段的类型，且可用子集禁止联合类型。
/// 由 tools/gen.sh 在生成后注入，不手工编辑。
Map<String, dynamic> _stripNulls(Map<String, dynamic> m) =>
    Map<String, dynamic>.fromEntries(m.entries.where((e) => e.value != null));
"""
open(p, "w", encoding="utf-8").write(src)
PYDART
      command -v dart >/dev/null 2>&1 && dart format --output=write "$tmp" >/dev/null 2>&1
      ;;
  esac

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
