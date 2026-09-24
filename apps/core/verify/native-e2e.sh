#!/usr/bin/env bash
# 原生端（Buzz Desktop / Buzz Mobile）的 Kailo 接入端到端核验：以该端自己的代码登录
# IdP、登记设备公钥、取 Community 连接事实、以设备私钥直连 Relay 发消息，并核验治理
# 与撤销。两端走同一个夹具与同一组环境变量，只在最后跑各自的测试。
#
# Workspace 由 verify_workspace 夹具经真实 lifecycle Workflow 开通，成员是 IdP 里
# 那个真能登录的核验用户。Community host 在本机没有 DNS：演练期间在 /etc/hosts
# 临时加一行，结束时删除。
#
# 用法（apps 根目录）：core/verify/native-e2e.sh <desktop|mobile> <已接入 Kailo 的 buzz 源码树>
set -euo pipefail
cd "$(dirname "$0")/../.."
. core/verify/integration-env.sh
surface="${1:?用法: native-e2e.sh <desktop|mobile> <buzz 源码树>}"
src="$(realpath "${2:?用法: native-e2e.sh <desktop|mobile> <buzz 源码树>}")"
case "$surface" in
  desktop) dir="$src/desktop/src-tauri"; run=(cargo test --lib kailo::e2e -- --ignored --nocapture) ;;
  mobile)  dir="$src/mobile";            run=(flutter test test/kailo_e2e --reporter expanded) ;;
  *) echo "未知的端：$surface（desktop 或 mobile）" >&2; exit 2 ;;
esac
[ -d "$dir" ] || { echo "$src 里没有 $surface 端（$dir）" >&2; exit 2; }

subject="$(bash core/verify/idp-subject.sh)"
work="$(mktemp -d)"
fifo="$work/hold"
mkfifo "$fifo"
(cd core && exec cargo run -q -p kailo-core --example verify_workspace -- "$subject") \
  <"$fifo" >"$work/workspace.json" 2>"$work/fixture.log" &
fixture=$!
exec 3>"$fifo"
name=""
cleanup() {
  [ -n "$name" ] && sudo -n sed -i "/ $name\$/d" /etc/hosts
  exec 3>&-
  if ! wait "$fixture"; then
    echo "夹具拆除失败，见 $work/fixture.log" >&2
    exit 1
  fi
  rm -rf "$work"
}
trap cleanup EXIT

while kill -0 "$fixture" 2>/dev/null && [ ! -s "$work/workspace.json" ]; do sleep 1; done
[ -s "$work/workspace.json" ] || { cat "$work/fixture.log" >&2; exit 1; }
field() { python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$work/workspace.json" "$1"; }
tenant="$(field tenant)"
workspace="$(field workspace)"
host="$(psql "$DATABASE_URL" -Atc "select normalized_host from projection.tenant_buzz_binding where tenant_id = '$tenant'")"
# BUZZ_COMMUNITY_DOMAIN 带非默认端口时 Community host 含端口；hosts 只认名字
name="${host%%:*}"
echo "127.0.0.1 $name" | sudo -n tee -a /etc/hosts >/dev/null
echo "Workspace $workspace 已开通，Community $host"

cd "$dir"
KAILO_E2E_NATIVE_URL="$VERIFY_NATIVE_URL" \
KAILO_E2E_OIDC_ISSUER="$OIDC_ISSUER" \
KAILO_E2E_CLIENT_ID="$OIDC_NATIVE_CLIENT_ID" \
KAILO_E2E_USER="$VERIFY_USER" \
KAILO_E2E_PASSWORD_FILE="$VERIFY_USER_PASSWORD_FILE" \
KAILO_E2E_WORKSPACE="$workspace" \
KAILO_E2E_CONVERGE_SECS="$VERIFY_CONVERGE_BOUND_SECS" \
  "${run[@]}"
