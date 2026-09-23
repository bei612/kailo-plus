#!/usr/bin/env bash
# RB-10 的演练工具：灾难恢复全流程（07 §4）。
#
# 在一个真实 Workspace 上留下可核验的状态，按权威逐个备份，**销毁本地拓扑的
# 全部数据卷与数据目录**，按固定顺序恢复，在入口关闭的状态下核验投影对账，
# 最后开放入口。备份目录含凭据与全部业务数据，演练结束即删除。
#
# 破坏性：只对本地开发拓扑执行。用法（在 apps 根目录）：
#   bash core/verify/drill-dr.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
. core/verify/integration-env.sh
LOCAL=deploy/local
DC() { sudo -n docker compose --env-file "$LOCAL/.env" -f "$LOCAL/compose.yaml" "$@"; }
PSQL() { psql "$DATABASE_URL" -Atc "$1"; }
step() { printf '\n== %s（%s）\n' "$1" "$(date -u +%T)"; }
backup=$(mktemp -d /tmp/kailo-dr.XXXXXX)
# 备份只在恢复核验通过后删除。任何一步失败都保留它——那时它是唯一的数据来源
# （首次演练正是因为失败时删除了备份，本地数据只能重新引导）。
finish() {
  if [ "${restored_ok:-no}" = yes ]; then
    rm -rf "$backup"
  else
    echo "演练未完成，备份保留在 $backup（含凭据与全部业务数据，处理完即删除）" >&2
  fi
}
trap finish EXIT

step "0. 留下可核验的状态"
subject="dr-$(date +%s)"
touch /tmp/rbdr.hold
{ while [ -e /tmp/rbdr.hold ]; do sleep 1; done; } | \
  (cd core && cargo run -q -p kailo-core --example verify_workspace -- "$subject") \
  >/tmp/rbdr.fixture 2>/tmp/rbdr.fixture.err &
fixture_pid=$!
for _ in $(seq 1 180); do [ -s /tmp/rbdr.fixture ] && break; sleep 1; done
ws=$(python3 -c 'import json;print(json.load(open("/tmp/rbdr.fixture"))["workspace"])')
tenant=$(python3 -c 'import json;print(json.load(open("/tmp/rbdr.fixture"))["tenant"])')
publish() {
  curl -s -o /tmp/rbdr.body -w '%{http_code}' -X POST "$VERIFY_BFF_URL/api/v1/workspaces/$ws/messages" \
    -H "x-kailo-oidc-issuer: $OIDC_ISSUER" -H "x-kailo-oidc-subject: $subject" \
    -H 'Content-Type: application/json' -H "Idempotency-Key: $(python3 -c 'import uuid;print(uuid.uuid4())')" -d "{\"content\":\"$1\"}"
}
history_has() {
  curl -s "$VERIFY_BFF_URL/api/v1/workspaces/$ws/messages" \
    -H "x-kailo-oidc-issuer: $OIDC_ISSUER" -H "x-kailo-oidc-subject: $subject" | grep -c "$1" || true
}
code=$(publish "before disaster")
event=$(python3 -c 'import json;print(json.load(open("/tmp/rbdr.body"))["eventId"])')
echo "  Workspace $ws，发布 HTTP $code，event ${event:0:12}…"
counts() {
  PSQL "select (select count(*) from audit.audit_event)||'/'||(select count(*) from identity.tenant)||'/'||(select count(*) from projection.workflow_ref)||'/'||(select count(*) from identity.buzz_identity_binding)"
}
before=$(counts)
kc_user_id() {
  local host="${OIDC_ISSUER#*://}"; host="${host%%/realms/*}"
  local tok
  tok=$(curl -sf -H "Host: $host" "$VERIFY_KEYCLOAK_URL/realms/master/protocol/openid-connect/token" \
    --data-urlencode grant_type=password --data-urlencode client_id=admin-cli \
    --data-urlencode "username=$KEYCLOAK_ADMIN_USER" --data-urlencode "password@$VERIFY_KEYCLOAK_ADMIN_PASSWORD_FILE" \
    | python3 -c 'import json,sys;print(json.load(sys.stdin)["access_token"])')
  curl -sf -H "Host: $host" -H "Authorization: Bearer $tok" \
    "$VERIFY_KEYCLOAK_URL/admin/realms/$OIDC_REALM/users?username=$VERIFY_USER&exact=true" \
    | python3 -c 'import json,sys;print(json.load(sys.stdin)[0]["id"])'
}
idp_before=$(kc_user_id)
echo "  计数（审计/Tenant/WorkflowRef/BuzzIdentityBinding）：$before；IdP 用户 ${idp_before:0:8}…"

step "1. 按权威备份"
bash "$LOCAL/dr-backup.sh" "$backup" | tail -9

step "2. 灾难：删除全部数据卷与数据目录"
DC down >/dev/null 2>&1
for v in core-db-data buzz-db-data temporal-db-data spicedb-db-data; do sudo -n docker volume rm "kailo-local_$v" >/dev/null; done
sudo -n find "$LOCAL/data/openbao" "$LOCAL/data/buzz-objects" -mindepth 1 -delete
echo "  已删除：4 个数据卷、OpenBao 与 MinIO 的数据目录、IdP 容器"

step "3. 按顺序恢复（入口保持关闭）"
bash "$LOCAL/dr-restore.sh" "$backup"

step "4. 入口关闭时核验"
failed=0
expect() { # 名称 实际 期望
  if [ "$2" = "$3" ]; then echo "  ✓ $1：$2"; else echo "  ✗ $1：得到 $2，应为 $3"; failed=1; fi
}
for _ in $(seq 1 60); do curl -sf -o /dev/null "$VERIFY_BFF_URL/api/v1/session" -H "x-kailo-oidc-issuer: $OIDC_ISSUER" -H "x-kailo-oidc-subject: $subject" && break; sleep 2; done
expect "计数（审计/Tenant/WorkflowRef/BuzzIdentityBinding）" "$(counts)" "$before"
expect "网关在运行的实例" "$(DC ps --format '{{.Service}}' | grep -cx agentgateway || true)" 0
expect "灾难前的消息仍在 Relay 上" "$([ "$(history_has "$event")" -ge 1 ] && echo 是 || echo 否)" 是
expect "恢复后发布（Core 从恢复的 OpenBao 取私钥代签）" "$(publish "after restore")" 200
expect "SpiceDB 中 workspace→tenant 归属" "$(sudo -n docker run --rm --network "$VERIFY_DOCKER_NETWORK" --env-file "$VERIFY_ZED_ENV_FILE" \
  -e "ZED_ENDPOINT=$VERIFY_SPICEDB_ENDPOINT" -e ZED_INSECURE=true "$VERIFY_ZED_IMAGE" \
  relationship read "workspace:$ws" tenant --consistency-full 2>/dev/null | grep -c "tenant:$tenant" || true)" 1
completed=$(sudo -n docker run --rm --network "$VERIFY_DOCKER_NETWORK" "$VERIFY_TEMPORAL_ADMIN_IMAGE" \
  temporal --address "$VERIFY_TEMPORAL_INTERNAL_ADDRESS" --namespace "$TEMPORAL_NAMESPACE" \
  workflow count --query "KailoTenantId='$tenant' AND ExecutionStatus='Completed'" 2>/dev/null | grep -oE '[0-9]+' | head -1)
expect "Temporal 中该 Tenant 的已完成 Workflow 仍可查" "$([ "${completed:-0}" -ge 1 ] && echo 是 || echo 否)" 是
expect "IdP 用户 ID 未变（Core 的 ExternalIdentity 仍对得上）" "$(kc_user_id)" "$idp_before"
t0=$(date -u +%Y-%m-%dT%H:%M:%SZ)
sleep $((ROSTER_RECONCILE_INTERVAL_SECONDS * 2 + 5))
expect "恢复后 roster 对账的不一致条数" "$(DC logs --since "$t0" core-bff 2>&1 | grep -c 'roster 与成员事实不一致' || true)" 0
[ "$failed" = 0 ] || { echo "核验未通过，入口保持关闭" >&2; exit 1; }

step "5. 开放入口"
DC up -d agentgateway >/dev/null 2>&1
echo "  网关：$(DC ps --format '{{.Service}} {{.Status}}' | grep agentgateway)"

restored_ok=yes

step "6. 拆除演练夹具"
rm -f /tmp/rbdr.hold; wait "$fixture_pid" || true
tail -1 /tmp/rbdr.fixture.err; rm -f /tmp/rbdr.fixture /tmp/rbdr.fixture.err /tmp/rbdr.body
