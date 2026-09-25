#!/usr/bin/env bash
# RB-01 第 7 步的演练工具：搁浅实体按 runbook 的命令重跑
# （docs/runbooks/RB-01-invariant-check-failure.md）。
#
# 故障注入：在一个真实开通的 Tenant 下，把它的 TenantBuzzBinding 暂时置为
# DISABLED，再建立第二个 Workspace。WORKSPACE_LIFECYCLE 取不到 ACTIVE 的 CONTROL
# 身份而被确定拒绝（403 → ADMISSION_DENIED），Workflow FAILED，Workspace 停在
# PROVISIONING——与 RB-01 的 Tenant 激活被拒是同一种搁浅。还原 binding（修复原因）
# 后按 runbook 第 7 步的四个小步重跑。只改演练夹具自己的行，结束时夹具整体拆除。
#
# 用法（在 apps 根目录）：bash core/verify/drill-task-rerun.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
. core/verify/integration-env.sh
PSQL() { psql "$DATABASE_URL" -Atc "$1"; }
step() { printf '\n== %s（%s）\n' "$1" "$(date -u +%T)"; }
bound=${VERIFY_CONVERGE_BOUND_SECS:?}
wait_for() { # <SQL> <期望值>
  for _ in $(seq 1 "$bound"); do [ "$(PSQL "$1")" = "$2" ] && return 0; sleep 1; done
  echo "  超时：$1 未得到 $2（实际 $(PSQL "$1")）" >&2; return 1
}

step "0. 开通真实 Workspace（夹具保持到 stdin 关闭）"
touch /tmp/rbrerun.hold
{ while [ -e /tmp/rbrerun.hold ]; do sleep 1; done; } | \
  (cd core && cargo run -q -p kailo-core --example verify_workspace -- "rerun-$(date +%s)") \
  >/tmp/rbrerun.fixture 2>/tmp/rbrerun.fixture.err &
fixture_pid=$!
ws2=""
cleanup() {
  # 第二个 Workspace 的 SpiceDB 归属关系不在夹具的拆除清单里，先删掉
  if [ -n "$ws2" ]; then
    sudo -n docker run --rm --network "$VERIFY_DOCKER_NETWORK" --env-file "$VERIFY_ZED_ENV_FILE" \
      -e "ZED_ENDPOINT=$VERIFY_SPICEDB_ENDPOINT" -e ZED_INSECURE=true "$VERIFY_ZED_IMAGE" \
      relationship delete "workspace:$ws2" tenant "tenant:$tenant" >/dev/null 2>&1 || true
  fi
  rm -f /tmp/rbrerun.hold; wait "$fixture_pid" || true
  tail -1 /tmp/rbrerun.fixture.err; rm -f /tmp/rbrerun.fixture /tmp/rbrerun.fixture.err
}
trap cleanup EXIT
for _ in $(seq 1 180); do [ -s /tmp/rbrerun.fixture ] && break; sleep 1; done
tenant=$(python3 -c 'import json;print(json.load(open("/tmp/rbrerun.fixture"))["tenant"])')
initiator=$(PSQL "select initiator_principal_id from admission.action_execution where tenant_id='$tenant' limit 1")
echo "  tenant $tenant，运维 Principal $initiator"

token=$(curl -sf -H "Host: $OIDC_TOKEN_HOST" "$OIDC_TOKEN_URL" --data-urlencode grant_type=client_credentials \
  --data-urlencode client_id="$OIDC_WORKER_CLIENT_ID" --data-urlencode "client_secret@deploy/local/secrets/kailo_worker_client_secret" \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["access_token"])')
admit() { # <target> → 新 ActionExecution ID（runbook 第 7.2 步的同一条语句）
  local a; a=$(python3 -c 'import uuid;print(uuid.uuid4())')
  PSQL "insert into admission.action_execution (id, operation_id, tenant_id, action_key, action_version,
    initiator_principal_id, actor_principal_id, target_id, parameter_hash, gate_state, dispatch_state, correlation_id)
    values ('$a', gen_random_uuid(), '$tenant', '$2', 1, '$initiator', '$initiator', '$1', '$3', 'ALLOWED', 'NOT_DISPATCHED', gen_random_uuid())" >/dev/null
  echo "$a"
}
call() { # <path> <json>
  curl -s -w ' HTTP %{http_code}' -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
    "$CORE_SERVICE_URL$1" -d "$2"
}

# 与 workflow_reconcile 计 kailo.entity.stranded 同一判据：收敛中状态，且驱动当前版本的 Workflow 已终结
stranded() {
  PSQL "select count(*) from identity.workspace e where e.id='$ws2' and e.state='PROVISIONING' and exists (
    select 1 from projection.workflow_ref w where w.projection_state='TERMINAL'
      and split_part(w.workflow_id, ':', 4) = e.id::text and split_part(w.workflow_id, ':', 5) = e.version::text)"
}

step "1. 注入故障：TenantBuzzBinding 置为 DISABLED，建立第二个 Workspace"
PSQL "update projection.tenant_buzz_binding set state='DISABLED' where tenant_id='$tenant'" >/dev/null
ws2=$(python3 -c 'import uuid;print(uuid.uuid4())')
PSQL "insert into identity.workspace (id, tenant_id, slug, name, state) values ('$ws2', '$tenant', 'w${ws2:0:8}', 'w${ws2:0:8}', 'PROVISIONING')" >/dev/null
a1=$(admit "$ws2" scope.provision drill)
echo "  启动：$(call /service/v1/scopes/lifecycle "{\"kind\":\"WORKSPACE\",\"id\":\"$ws2\",\"actionExecutionId\":\"$a1\"}")"
wf1=$(PSQL "select workflow_id from projection.workflow_ref where action_execution_id='$a1'")
wait_for "select status from projection.task_projection where workflow_id='$wf1'" FAILED
echo "  $wf1 → FAILED；Workspace $(PSQL "select state||' v'||version from identity.workspace where id='$ws2'")"
echo "  搁浅：$(stranded)"

step "2. 修复原因：还原 binding"
PSQL "update projection.tenant_buzz_binding set state='ACTIVE' where tenant_id='$tenant'" >/dev/null

step "3. RB-01 7.1 定位"
PSQL "select w.workflow_id, w.action_execution_id, w.tenant_id, t.status from projection.workflow_ref w
  join projection.task_projection t using (workflow_id) join identity.workspace e
    on split_part(w.workflow_id, ':', 4) = e.id::text and split_part(w.workflow_id, ':', 5) = e.version::text
  where e.id = '$ws2' and w.projection_state = 'TERMINAL' and t.status <> 'COMPLETED'" | sed 's/^/  /'

step "4. RB-01 7.2 记录准入，7.3 重跑（再以同键重发一次）"
a2=$(admit "$a1" task.rerun "$wf1")
echo "  重跑：$(call /service/v1/tasks/rerun "{\"workflowId\":\"$wf1\",\"actionExecutionId\":\"$a2\"}")"
echo "  同键重发：$(call /service/v1/tasks/rerun "{\"workflowId\":\"$wf1\",\"actionExecutionId\":\"$a2\"}")"
a3=$(admit "$a1" task.rerun "$wf1")
echo "  另一张准入重跑同一条旧 Workflow：$(call /service/v1/tasks/rerun "{\"workflowId\":\"$wf1\",\"actionExecutionId\":\"$a3\"}")"

step "5. RB-01 7.4 核验"
wf2=$(PSQL "select workflow_id from projection.workflow_ref where action_execution_id='$a2'")
wait_for "select state from identity.workspace where id='$ws2'" ACTIVE
wait_for "select status from projection.task_projection where workflow_id='$wf2'" COMPLETED
echo "  Workspace $(PSQL "select state||' v'||version from identity.workspace where id='$ws2'")"
echo "  新 $wf2 → $(PSQL "select projection_state||' '||status from projection.workflow_ref join projection.task_projection using (workflow_id) where workflow_id='$wf2'")"
echo "  旧 $wf1 → $(PSQL "select projection_state||' '||status from projection.workflow_ref join projection.task_projection using (workflow_id) where workflow_id='$wf1'")"
echo "  审计 RERUN_ACCEPTED 条数：$(PSQL "select count(*) from audit.audit_event where target_id='$a1' and result_code='RERUN_ACCEPTED'")"
echo "  搁浅：$(stranded)"

step "6. 拆除夹具"
