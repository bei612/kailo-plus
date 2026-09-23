#!/usr/bin/env bash
# RB-04 的演练工具：在途 Workflow 遇到不确定的 Worker 发布，按镜像回滚后继续跑完
# （docs/runbooks/RB-04-replay-failure-and-worker-rollback.md）。
#
# 它会停启共享的 Relay、临时改动 Worker 源码并重建 Worker 镜像，结束时全部还原。
# 演练前把 .env 的 WORKER_CONVERGE_ROUND_INTERVAL_SECONDS 调到足以完成一次 Worker
# 构建的时长，并缩短一轮（SCHEDULE_TO_CLOSE、MAX_ATTEMPTS），演练后还原。
#
# 用法（在 apps 根目录）：bash core/verify/drill-worker-rollback.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
. core/verify/integration-env.sh
DC() { sudo -n docker compose --env-file deploy/local/.env -f deploy/local/compose.yaml "$@"; }
PSQL() { psql "$DATABASE_URL" -Atc "$1"; }
step() { printf '\n== %s（%s）\n' "$1" "$(date -u +%T)"; }

step "0. 开通真实 Workspace（夹具保持到 stdin 关闭）"
touch /tmp/rb04.hold
{ while [ -e /tmp/rb04.hold ]; do sleep 1; done; } | \
  (cd core && cargo run -q -p kailo-core --example verify_workspace -- "rb04-$(date +%s)") >/tmp/rb04.fixture 2>/tmp/rb04.fixture.err &
fixture_pid=$!
for _ in $(seq 1 180); do [ -s /tmp/rb04.fixture ] && break; sleep 1; done
ws=$(python3 -c 'import json;print(json.load(open("/tmp/rb04.fixture"))["workspace"])')
tenant=$(python3 -c 'import json;print(json.load(open("/tmp/rb04.fixture"))["tenant"])')
wm=$(PSQL "select id from identity.workspace_membership where workspace_id='$ws'")
initiator=$(PSQL "select initiator_principal_id from admission.action_execution where tenant_id='$tenant' limit 1")
echo "  workspace $ws membership $wm"

step "1. 标记当前 Worker 镜像为回滚点"
img=$(DC images worker --format json | python3 -c 'import json,sys;d=json.load(sys.stdin);d=d[0] if isinstance(d,list) else d;print(d["Repository"]+":"+d["Tag"])')
sudo -n docker tag "$img" "${img%%:*}:rollback"
echo "  $img → ${img%%:*}:rollback"

step "2. 停 Relay，启动撤权，等它进入按轮等待"
DC stop buzz-relay >/dev/null 2>&1
PSQL "update identity.workspace_membership set state='REVOKING', version=version+1 where id='$wm'" >/dev/null
action=$(python3 -c 'import uuid;print(uuid.uuid4())')
PSQL "insert into admission.action_execution (id, operation_id, tenant_id, action_key, action_version, initiator_principal_id, actor_principal_id, target_id, parameter_hash, gate_state, dispatch_state, correlation_id) values ('$action', gen_random_uuid(), '$tenant', 'drill.revoke', 1, '$initiator', '$initiator', '$wm', 'drill', 'ALLOWED', 'NOT_DISPATCHED', gen_random_uuid())" >/dev/null
token=$(curl -sf -H "Host: $OIDC_TOKEN_HOST" "$OIDC_TOKEN_URL" --data-urlencode grant_type=client_credentials \
  --data-urlencode client_id="$OIDC_WORKER_CLIENT_ID" --data-urlencode "client_secret@deploy/local/secrets/kailo_worker_client_secret" \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["access_token"])')
curl -sf -o /dev/null -w '  启动撤权 HTTP %{http_code}\n' -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
  "$CORE_SERVICE_URL/service/v1/memberships/lifecycle" \
  -d "{\"scope\":\"WORKSPACE\",\"membershipId\":\"$wm\",\"actionExecutionId\":\"$action\"}"
wf=$(PSQL "select workflow_id from projection.workflow_ref where action_execution_id='$action'")
echo "  workflow $wf"
for _ in $(seq 1 240); do
  [ "$(PSQL "select waiting_reason from projection.task_projection where workflow_id='$wf'")" = "CONVERGENCE_PENDING" ] && break; sleep 1; done
echo "  task: $(PSQL "select status||' '||coalesce(waiting_reason,'') from projection.task_projection where workflow_id='$wf'")"

step "3. 发布一个不确定的 Worker：交换 SpiceDB 与 roster 两步的顺序"
cp worker/workflows/component_task.go /tmp/rb04_ct.go
python3 - <<'PY'
p = "worker/workflows/component_task.go"
s = open(p).read()
a = s.index("\t// 1. SpiceDB 关系：授权投影。")
b = s.index("\t// 2. Buzz roster：协作数据平面的准入执行点。")
c = s.index("\t// 3. 两个投影都已查证，才让 Core 跃迁成员状态。")
s = s[:a] + s[b:c] + s[a:b] + s[c:]
open(p, "w").write(s)
PY
echo "  发布前的 replay 门禁："
(cd worker && go test ./replay-tests/... 2>&1 | grep -E "TMPRL1100|^ok|^FAIL" | head -2) || true
DC build worker >/dev/null 2>&1 && DC up -d worker >/dev/null 2>&1
echo "  已发布；等待 timer 到期后新 Worker 重放 history"
for _ in $(seq 1 180); do
  DC logs --since 3m worker 2>&1 | grep -q "TMPRL1100" && break; sleep 2; done
echo "  Worker 日志：$(DC logs --since 3m worker 2>&1 | grep -o 'TMPRL1100[^.]*' | head -1)"
echo "  Core 投影：$(PSQL "select status||' '||coalesce(waiting_reason,'') from projection.task_projection where workflow_id='$wf'")；成员 $(PSQL "select state from identity.workspace_membership where id='$wm'")"

step "4. 按镜像回滚 Worker（不重新构建）"
cp /tmp/rb04_ct.go worker/workflows/component_task.go
sudo -n docker tag "${img%%:*}:rollback" "$img"
DC up -d --no-build --force-recreate worker >/dev/null 2>&1
echo "  已回滚到 ${img%%:*}:rollback"

step "5. 恢复 Relay，撤权闭合"
DC start buzz-relay >/dev/null 2>&1
for _ in $(seq 1 60); do curl -sf -o /dev/null "$RELAY_OPERATOR_API_ORIGIN/_readiness" && break; sleep 1; done
for _ in $(seq 1 300); do
  [ "$(PSQL "select state from identity.workspace_membership where id='$wm'")" = "REVOKED" ] && break; sleep 1; done
echo "  成员 $(PSQL "select state from identity.workspace_membership where id='$wm'")；任务 $(PSQL "select status from projection.task_projection where workflow_id='$wf'")；WorkflowRef $(PSQL "select projection_state from projection.workflow_ref where workflow_id='$wf'")"

step "6. 拆除夹具"
rm -f /tmp/rb04.hold
wait "$fixture_pid" || true
tail -1 /tmp/rb04.fixture.err
rm -f /tmp/rb04.fixture /tmp/rb04.fixture.err
sudo -n docker rmi "${img%%:*}:rollback" >/dev/null
