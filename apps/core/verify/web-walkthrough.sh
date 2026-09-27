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
worker_container="$(sudo -n docker compose -f "$local_dir/compose.yaml" ps --status running -q worker)"
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
  trap - EXIT
  worker_restore_failed=0
  relay_restore_failed=0
  core_restore_failed=0
  if [ -z "$(sudo -n docker compose -f "$local_dir/compose.yaml" ps --status running -q buzz-relay)" ]; then
    sudo -n docker compose -f "$local_dir/compose.yaml" start buzz-relay >/dev/null || relay_restore_failed=1
  fi
  if [ -z "$(sudo -n docker compose -f "$local_dir/compose.yaml" ps --status running -q core-bff)" ]; then
    bash "$local_dir/start-core.sh" >/dev/null || core_restore_failed=1
  fi
  sudo -n docker start "$worker_container" >/dev/null || worker_restore_failed=1
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
  if [ "$relay_restore_failed" -ne 0 ] || [ "$core_restore_failed" -ne 0 ]; then
    echo "本地 Core 或 Relay 未恢复，须人工检查" >&2
    exit 1
  fi

  # 夹具的数据库与 roster 已拆除，但 Core 缓存的 Tenant AppRole token 仍会续期。
  # 只能在精确核对本次 UUID 且停掉本地 Core 后删除该测试子 namespace。
  core_stopped_for_cleanup=0
  namespace_cleanup_failed=0
  if [ -s "$out/workspace.json" ] && ! cleanup_fixture_namespace; then
    namespace_cleanup_failed=1
  fi
  if [ "$core_stopped_for_cleanup" -eq 1 ]; then
    bash "$local_dir/start-core.sh" >/dev/null || core_restore_failed=1
  fi
  if [ "$namespace_cleanup_failed" -ne 0 ] || [ "$core_restore_failed" -ne 0 ]; then
    echo "测试 Tenant 的 OpenBao namespace 未确认清理或本地 Core 未恢复，须人工检查" >&2
    exit 1
  fi
}
trap cleanup EXIT

fixture_tenant_absent() {
  local tenant=$1 counts
  counts="$(PGPASSWORD="$(cat "$local_dir/secrets/core_db_password")" \
    psql -h 127.0.0.1 -p "$CORE_DB_PORT" -U "$CORE_DB_USER" -d "$CORE_DB_NAME" \
      -v ON_ERROR_STOP=1 -tA -c \
      "select (select count(*) from identity.tenant where id = '$tenant'),
              (select count(*) from identity.principal where tenant_id = '$tenant'),
              (select count(*) from identity.buzz_identity_binding where tenant_id = '$tenant'),
              (select count(*) from admission.secret_ref_rehome where tenant_id = '$tenant')" \
      | tr -d '[:space:]')" || return 1
  [ "$counts" = "0|0|0|0" ]
}

bao_tenant_parent() {
  printf '%s\n' "$root_token" | sudo -n docker compose --env-file "$local_dir/.env" \
    -f "$local_dir/compose.yaml" exec -T \
    -e BAO_NAMESPACE="$OPENBAO_TENANT_PARENT_NAMESPACE" openbao \
    sh -c 'IFS= read -r BAO_TOKEN; export BAO_TOKEN; exec bao "$@"' bao "$@"
}

cleanup_fixture_namespace() {
  local tenant root_token lookup listing deadline
  tenant="$(python3 -c 'import json,sys,uuid; value=json.load(open(sys.argv[1]))["tenant"]; parsed=uuid.UUID(value); assert str(parsed)==value; print(value)' "$out/workspace.json")" || return 1
  fixture_tenant_absent "$tenant" || {
    echo "测试 Tenant $tenant 仍有 Core 引用，拒绝删除 OpenBao namespace" >&2
    return 1
  }
  root_token="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["root_token"])' "$local_dir/secrets/openbao_init.json")" || return 1
  lookup="$(bao_tenant_parent namespace lookup -format=json "$tenant")" || return 1
  printf '%s\n' "$lookup" | jq -e --arg path "${OPENBAO_TENANT_PARENT_NAMESPACE%/}/$tenant/" \
    '.path == $path' >/dev/null || {
      echo "测试 Tenant $tenant 的 OpenBao 路径不符，拒绝删除" >&2
      return 1
    }
  sudo -n docker compose -f "$local_dir/compose.yaml" stop core-bff >/dev/null || return 1
  core_stopped_for_cleanup=1
  [ -z "$(sudo -n docker compose -f "$local_dir/compose.yaml" ps --status running -q core-bff)" ] || return 1
  fixture_tenant_absent "$tenant" || return 1
  lookup="$(bao_tenant_parent namespace lookup -format=json "$tenant")" || return 1
  printf '%s\n' "$lookup" | jq -e --arg path "${OPENBAO_TENANT_PARENT_NAMESPACE%/}/$tenant/" \
    '.path == $path' >/dev/null || return 1
  bao_tenant_parent namespace delete "$tenant" >/dev/null || return 1
  deadline=$((SECONDS + VERIFY_CONVERGE_BOUND_SECS))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if listing="$(bao_tenant_parent namespace list -format=json 2>&1)"; then
      :
    elif [ "$listing" != '{}' ]; then
      return 1
    fi
    if printf '%s\n' "$listing" | jq -e --arg tenant "$tenant" \
      '(type == "array" and all(.[]; rtrimstr("/") != $tenant)) or (type == "object" and length == 0)' >/dev/null; then
      echo "测试 Tenant $tenant 的 OpenBao 子 namespace 已离线清理"
      return 0
    fi
    sleep 1
  done
  echo "测试 Tenant $tenant 的 OpenBao 子 namespace 删除未在收敛上界内得到目录证据" >&2
  return 1
}

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

# 夹具预置的两条审批以 Core 库为准，而不是以页面文案为准：撤回的那条经 Temporal
# 进入 CANCELLED；批准的那条走完重新准入与派发后被消费（CONSUMED）。浏览器过程
# 动态生成的第三条重跑审批在 mjs 中按独立 ID、WAITING 和 CONSUMED 核验。
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
