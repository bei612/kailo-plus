#!/usr/bin/env bash
# Web 端真实浏览器走查：经 AgentGateway 登录，在一个真实 Workspace 里收发消息、
# 看成员与审计、经历一次 BFF 重启、注销。
#
# 集成测试在 HTTP 层证明 BFF 的每个端点成立；这里证明 Web 端代码真的按这些
# 端点工作——SSE 续流、消息渲染、失败时的状态、注销顺序都在浏览器里。
#
# Workspace 由 verify_workspace 夹具经真实 lifecycle Workflow 开通，OIDC subject
# 取自 IdP 里那个真能登录的核验用户。夹具在 stdin 关闭时拆除，trap 保证任何
# 退出路径都会关闭它。
#
# 需要 Docker 权限（走查中途重启 core-bff，夹具拆除时清 SpiceDB 关系）。
# 用法：core/verify/web-walkthrough.sh <证据输出目录>
set -euo pipefail
cd "$(dirname "$0")/../.."
. core/verify/integration-env.sh
out="$(realpath -m "${1:?用法: web-walkthrough.sh <证据输出目录>}")"
mkdir -p "$out"

# 浏览器的取消场景会短暂停止本地 Worker。入口要求它原本运行；任何退出
# 路径先恢复它，再拆夹具，不能让失败走查留下停止的任务处理器。
worker_container="$(docker compose -f "$local_dir/compose.yaml" ps --status running -q worker)"
[ -n "$worker_container" ] || {
  echo "本地 Worker 未运行，不能开始浏览器取消走查" >&2
  exit 1
}

# 核验用户的 subject 由 IdP 签发
subject="$(bash core/verify/idp-subject.sh)"

fifo="$(mktemp -u)"
mkfifo "$fifo"
(cd core && exec cargo run -q -p kailo-core --example verify_workspace -- "$subject" --governance) \
  <"$fifo" >"$out/workspace.json" 2>"$out/fixture.log" &
fixture=$!
# 持有写端：夹具读 stdin 读到 EOF 才拆除，关掉它即触发拆除
exec 3>"$fifo"
cleanup() {
  worker_restore_failed=0
  docker start "$worker_container" >/dev/null || worker_restore_failed=1
  exec 3>&-
  rm -f "$fifo"
  # 拆除失败必须让整次走查失败：留下的 Tenant 是脏数据，而「走查通过」会把它藏起来
  if ! wait "$fixture"; then
    echo "夹具拆除失败，见 $out/fixture.log" >&2
    exit 1
  fi
  if [ "$worker_restore_failed" -ne 0 ]; then
    echo "本地 Worker 未恢复，须人工检查" >&2
    exit 1
  fi
}
trap cleanup EXIT

while kill -0 "$fixture" 2>/dev/null && [ ! -s "$out/workspace.json" ]; do sleep 1; done
[ -s "$out/workspace.json" ] || { cat "$out/fixture.log" >&2; exit 1; }
workspace="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["workspace"])' "$out/workspace.json")"
echo "Workspace 已开通：$workspace"

node core/verify/web-walkthrough.mjs \
  --gateway-port "$AGENTGATEWAY_PORT" --keycloak-port "$KEYCLOAK_PORT" \
  --user "$VERIFY_USER" --password-file "$local_dir/secrets/verify_user_password" \
  --compose-file "$local_dir/compose.yaml" --retry-millis "$BFF_STREAM_RETRY_MILLIS" \
  --fixture "$out/workspace.json" \
  --out "$out"

# 注销前那条会话必须在 Core 里已被撤销，而不只是网关清了 cookie（SF-AGW-21）。
# 按会话 ID 查，不按「此人有没有 ACTIVE 会话」查：IdP 会话还在时浏览器会重新
# 登录并得到一条新会话，那是正确行为。
revoked="$(tr -d '[:space:]' <"$out/revoked-session.txt")"
[[ "$revoked" =~ ^[0-9a-f-]{36}$ ]] || { echo "revoked-session.txt 不是会话 ID" >&2; exit 1; }
state="$(PGPASSWORD="$(cat "$local_dir/secrets/core_db_password")" psql -h 127.0.0.1 -p "$CORE_DB_PORT" \
  -U "$CORE_DB_USER" -d "$CORE_DB_NAME" -tA -c \
  "select status from identity.platform_session where id = '$revoked'")"
echo "注销前的会话 $revoked：$state" | tee "$out/sessions.txt"
[ "$state" = "REVOKED" ] || { echo "注销前的会话未被撤销" >&2; exit 1; }

# 页面上的两次审批控制以 Core 库为准，而不是以页面文案为准：撤回的那条经 Temporal
# 进入 CANCELLED；批准的那条走完重新准入与派发后被消费（CONSUMED），在收敛上界内。
field() { python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$out/workspace.json" "$1"; }
approval() {
  PGPASSWORD="$(cat "$local_dir/secrets/core_db_password")" psql -h 127.0.0.1 -p "$CORE_DB_PORT" \
    -U "$CORE_DB_USER" -d "$CORE_DB_NAME" -tA -c \
    "select status from projection.approval_projection where workflow_id = '$1'"
}
withdrawn="$(approval "$(field myApproval)")"
deadline=$((SECONDS + VERIFY_CONVERGE_BOUND_SECS))
until [ "$(approval "$(field approvalForMe)")" = "CONSUMED" ] || [ $SECONDS -ge $deadline ]; do sleep 1; done
approved="$(approval "$(field approvalForMe)")"
echo "撤回的审批：$withdrawn；批准的审批：$approved" | tee "$out/approvals.txt"
[ "$withdrawn" = "CANCELLED" ] || { echo "撤回的审批不是 CANCELLED" >&2; exit 1; }
[ "$approved" = "CONSUMED" ] || { echo "批准的审批未在收敛上界内被消费" >&2; exit 1; }
