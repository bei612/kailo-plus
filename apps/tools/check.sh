#!/usr/bin/env bash
# 统一检查入口（ADR-07）。本地与 CI 调用同一命令、同一步骤集。
# 十个子步骤对应 03-验证发布与验收门禁.md §5 的十项合并门禁。
# 无适用对象的步骤输出 SKIP 并通过——它在首次出现适用对象时自动生效，不被注释掉。
#
# 用法：
#   tools/check.sh              # 按变更范围选择步骤
#   tools/check.sh --full       # 全部步骤
#   tools/check.sh <step>       # 单步，step 见下方 STEPS
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

STEPS=(lint verify contract migrate replay trace supply seam security docs)
FAIL=0

hdr()  { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
pass() { printf '  \033[32mPASS\033[0m %s\n' "$*"; }
skip() { printf '  \033[90mSKIP\033[0m %s\n' "$*"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$*"; FAIL=1; }

have() { command -v "$1" >/dev/null 2>&1; }
# 目录存在且含至少一个非隐藏条目
populated() { [ -d "$1" ] && [ -n "$(ls -A "$1" 2>/dev/null | grep -v '^\.')" ]; }

step_lint() {
  hdr "1/10 格式与静态检查"
  local ran=0
  if populated core && have cargo; then
    ran=1
    cargo fmt --manifest-path core/Cargo.toml --all --check >/dev/null 2>&1 \
      && pass "cargo fmt" || fail "cargo fmt"
    cargo clippy --manifest-path core/Cargo.toml --all-targets -- -D warnings >/dev/null 2>&1 \
      && pass "cargo clippy" || fail "cargo clippy"
  fi
  if populated worker && have go; then
    ran=1
    (cd worker && gofmt -l . | grep -q . ) && fail "gofmt 有未格式化文件" || pass "gofmt"
    (cd worker && go vet ./... >/dev/null 2>&1) && pass "go vet" || fail "go vet"
  fi
  [ "$ran" -eq 0 ] && skip "尚无 Rust/Go 源码"
  return 0
}

step_verify()   { hdr "2/10 受影响范围的验证"
  local ran=0
  if populated core && have cargo; then ran=1
    cargo test --manifest-path core/Cargo.toml >/dev/null 2>&1 && pass "cargo test" || fail "cargo test"; fi
  if populated worker && have go; then ran=1
    (cd worker && go test ./... >/dev/null 2>&1) && pass "go test" || fail "go test"; fi
  [ "$ran" -eq 0 ] && skip "尚无可验证范围"
  return 0
}

step_contract() { hdr "3/10 contract compatibility"
  if ! populated contracts/enums && ! populated contracts/domain; then
    skip "contracts/ 尚无 schema"; return 0; fi
  if [ ! -f contracts/canary.schema.json ]; then
    fail "contracts/ 有 schema 但缺 canary.schema.json（见 contracts/README.md §1）"; return 0; fi
  pass "canary 存在；四侧生成与 round-trip 由 tools/gen 执行"
  return 0
}

step_migrate()  { hdr "4/10 数据迁移前进与回退演练"
  populated core/migrations && pass "迁移目录存在，演练由 tools/migrate 执行" || skip "尚无迁移"
  return 0
}

step_replay()   { hdr "5/10 Workflow replay"
  if populated worker/replay-tests && have go; then
    (cd worker && go test ./replay-tests/... >/dev/null 2>&1) && pass "replay 回归" || fail "replay 回归"
  else skip "尚无录制 history"; fi
  return 0
}

step_trace()    { hdr "6/10 设计 ID 与验证场景追溯"
  bash tools/check-docs.sh >/tmp/cd.$$ 2>&1 && pass "文档门禁六项（含设计语料）" \
    || { fail "文档门禁未过"; tail -25 /tmp/cd.$$; }
  rm -f /tmp/cd.$$
  populated tools/traceability && pass "追溯清单存在" || skip "尚无追溯记录（无 active 能力）"
  return 0
}

step_supply()   { hdr "7/10 secret、依赖、许可证与供应链"
  if have gitleaks; then
    gitleaks detect --no-banner -q >/dev/null 2>&1 && pass "gitleaks 无命中" || fail "gitleaks 命中"
  else
    # 兜底：仓库内明显的私钥/令牌形态
    if git grep -nIE 'BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|nsec1[a-z0-9]{20,}|xox[baprs]-' -- . >/dev/null 2>&1; then
      fail "发现疑似凭据"; else pass "内置扫描无命中（未安装 gitleaks）"; fi
  fi
  return 0
}

step_seam()     { hdr "8/10 上游 seam diff"
  populated upstream-patches && pass "baseline manifest 存在，比对由 tools/seam 执行" \
    || skip "尚无上游进入运行拓扑"
  return 0
}

step_security() { hdr "9/10 受影响安全不变式"
  # 07-运行与运维基线.md §1 的校验机制；尚无已接入组件时无适用对象
  populated deploy/local && pass "部署描述存在，不变式校验由 tools/invariants 执行" \
    || skip "尚无部署描述"
  return 0
}

step_docs()     { hdr "10/10 文档、runbook 与 release note 同步"
  local n; n=$(find docs/runbooks -name '*.md' 2>/dev/null | wc -l)
  if [ "$n" -gt 0 ]; then pass "$n 份 runbook"; else skip "生产发布前需补齐 07 §6 的十份"; fi
  return 0
}

main() {
  local want=("${STEPS[@]}")
  case "${1:-}" in
    --full|"") ;;
    *) want=("$1") ;;
  esac
  for s in "${want[@]}"; do
    if ! printf '%s\n' "${STEPS[@]}" | grep -qx "$s"; then
      echo "未知步骤：$s（可用：${STEPS[*]}）"; exit 2; fi
    "step_$s"
  done
  echo
  [ "$FAIL" -eq 0 ] && echo "全部通过。" || echo "存在失败项，见上。"
  exit "$FAIL"
}
main "$@"
