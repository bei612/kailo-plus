#!/usr/bin/env bash
# RB-02 步骤 E 的演练工具：Web 托管 HUMAN 身份的 key revoke 与重建
# （docs/runbooks/RB-02-secret-rotation-and-revocation.md）。
#
# 在真实开通的 Workspace 上按 runbook 的命令执行 revoke 与重建。revoke 期间停掉
# Worker：撤销 Workflow 因此无法移出 roster，已建立的 BFF 流只能由 Core 的再准入
# 关闭——这正是 Relay 不可达时唯一剩下的「关已知连接」执行点。结束时恢复 Worker、
# 拆除夹具。
#
# 用法（在 apps 根目录）：bash core/verify/drill-server-key-rotation.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
. core/verify/integration-env.sh
DC() { sudo -n docker compose --env-file deploy/local/.env -f deploy/local/compose.yaml "$@"; }
PSQL() { psql "$DATABASE_URL" -Atc "$1"; }
step() { printf '\n== %s（%s）\n' "$1" "$(date -u +%T)"; }
bound=${VERIFY_CONVERGE_BOUND_SECS:?}
readmit=${BFF_STREAM_READMIT_SECONDS:?}
wait_for() { # <SQL> <期望值>
  for _ in $(seq 1 "$bound"); do [ "$(PSQL "$1")" = "$2" ] && return 0; sleep 1; done
  echo "  超时：$1 未得到 $2（实际 $(PSQL "$1")）" >&2; return 1
}

step "0. 开通真实 Workspace（夹具保持到 stdin 关闭）"
subject="key-$(date +%s)"
touch /tmp/rbkey.hold
{ while [ -e /tmp/rbkey.hold ]; do sleep 1; done; } | \
  (cd core && cargo run -q -p kailo-core --example verify_workspace -- "$subject") \
  >/tmp/rbkey.fixture 2>/tmp/rbkey.fixture.err &
fixture_pid=$!
stream_pid=""
cleanup() {
  [ -n "$stream_pid" ] && kill "$stream_pid" 2>/dev/null || true
  DC start worker >/dev/null 2>&1 || true
  rm -f /tmp/rbkey.hold; wait "$fixture_pid" || true
  tail -1 /tmp/rbkey.fixture.err; rm -f /tmp/rbkey.fixture /tmp/rbkey.fixture.err /tmp/rbkey.stream
}
trap cleanup EXIT
for _ in $(seq 1 180); do [ -s /tmp/rbkey.fixture ] && break; sleep 1; done
fx() { python3 -c "import json;print(json.load(open('/tmp/rbkey.fixture'))['$1'])"; }
tenant=$(fx tenant); workspace=$(fx workspace); principal=$(fx principal)
initiator=$(PSQL "select initiator_principal_id from admission.action_execution where tenant_id='$tenant' limit 1")
old=$(PSQL "select pubkey from identity.buzz_identity_binding where principal_id='$principal' and custody='SERVER' and state='ACTIVE'")
echo "  principal $principal，Web 托管 pubkey $old"

token=$(curl -sf -H "Host: $OIDC_TOKEN_HOST" "$OIDC_TOKEN_URL" --data-urlencode grant_type=client_credentials \
  --data-urlencode client_id="$OIDC_WORKER_CLIENT_ID" --data-urlencode "client_secret@deploy/local/secrets/kailo_worker_client_secret" \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["access_token"])')
admit() { # runbook 步骤 E 第 1 步的同一条语句
  local a; a=$(python3 -c 'import uuid;print(uuid.uuid4())')
  PSQL "insert into admission.action_execution (id, operation_id, tenant_id, action_key, action_version,
    initiator_principal_id, actor_principal_id, target_id, parameter_hash, gate_state, dispatch_state, correlation_id)
    values ('$a', gen_random_uuid(), '$tenant', '$1', 1, '$initiator', '$initiator', '$principal', '$2', 'ALLOWED', 'NOT_DISPATCHED', gen_random_uuid())" >/dev/null
  echo "$a"
}
call() { curl -s -w ' HTTP %{http_code}' -H "Authorization: Bearer $token" -H 'Content-Type: application/json' "$CORE_SERVICE_URL$1" -d "$2"; }
publish() {
  curl -s -o /dev/null -w '%{http_code}' -H "x-kailo-oidc-issuer: $OIDC_ISSUER" -H "x-kailo-oidc-subject: $subject" \
    -H "idempotency-key: $(python3 -c 'import uuid;print(uuid.uuid4())')" -H 'Content-Type: application/json' \
    "$VERIFY_BFF_URL/api/v1/workspaces/$workspace/messages" -d "{\"content\":\"$1\"}"
}
echo "  轮换前发言：HTTP $(publish before)"

step "1. 建立一条 BFF 流，停掉 Worker（撤销 Workflow 无法推进）"
curl -sN -H "x-kailo-oidc-issuer: $OIDC_ISSUER" -H "x-kailo-oidc-subject: $subject" \
  "$VERIFY_BFF_URL/api/v1/workspaces/$workspace/stream" >/tmp/rbkey.stream 2>/dev/null &
stream_pid=$!
sleep 2
DC stop worker >/dev/null 2>&1
echo "  流已建立，Worker 已停"

step "2. RB-02 E.2 revoke"
a1=$(admit identity.key_revoke "$old")
echo "  revoke：$(call /service/v1/identities/server-keys/revoke "{\"pubkey\":\"$old\",\"actionExecutionId\":\"$a1\"}")"
echo "  binding：$(PSQL "select state from identity.buzz_identity_binding where pubkey='$old'")；此刻发言：HTTP $(publish during)"
for _ in $(seq 1 $((readmit * 3 + 5))); do grep -q "^event: closed" /tmp/rbkey.stream && break; sleep 1; done
echo "  流的关闭帧：$(grep -A1 '^event: closed' /tmp/rbkey.stream | tail -1)"

step "3. 恢复 Worker，撤销收敛"
DC start worker >/dev/null 2>&1
wait_for "select state from identity.buzz_identity_binding where pubkey='$old'" REVOKED
echo "  $old → REVOKED"

step "4. RB-02 E.3 重建（再以同键重发一次）"
a2=$(admit identity.key_provision "$old")
echo "  重建：$(call /service/v1/identities/server-keys/provision "{\"principalId\":\"$principal\",\"actionExecutionId\":\"$a2\"}")"
echo "  同键重发：$(call /service/v1/identities/server-keys/provision "{\"principalId\":\"$principal\",\"actionExecutionId\":\"$a2\"}")"
new=$(PSQL "select pubkey from identity.buzz_identity_binding where principal_id='$principal' and custody='SERVER' and state <> 'REVOKED'")
wait_for "select state from identity.buzz_identity_binding where pubkey='$new'" ACTIVE

step "5. RB-02 E.4 核验"
echo "  新 pubkey $new（与旧不同：$([ "$new" != "$old" ] && echo 是 || echo 否)）"
echo "  SecretRef：$(PSQL "select private_key_secret_ref||' v'||private_key_secret_version from identity.buzz_identity_binding where pubkey='$old'") → $(PSQL "select private_key_secret_ref||' v'||private_key_secret_version from identity.buzz_identity_binding where pubkey='$new'")"
echo "  轮换后发言：HTTP $(publish after)"
echo "  审计：$(PSQL "select string_agg(action_key||'='||result_code, ', ' order by occurred_at) from audit.audit_event where target_id='$principal' and action_key like 'identity.key_%'")"

step "6. 拆除夹具"
