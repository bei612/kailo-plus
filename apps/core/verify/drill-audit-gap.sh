#!/usr/bin/env bash
# RB-06 的演练工具：审计写不进去时，消息动作必须不发生（DD-81「落不下就不发」）
# （docs/runbooks/RB-06-usage-and-audit-gaps.md）。
#
# 以一个临时触发器让 audit.audit_event 的插入失败来注入故障，结束时删除它。
# 只影响演练期间本地拓扑的审计写入。
#
# 用法（在 apps 根目录）：bash core/verify/drill-audit-gap.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
. core/verify/integration-env.sh
PSQL() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "$1"; }
step() { printf '\n== %s（%s）\n' "$1" "$(date -u +%T)"; }

step "0. 开通真实 Workspace"
subject="auditgap-$(date +%s)"
touch /tmp/rbaudit.hold
{ while [ -e /tmp/rbaudit.hold ]; do sleep 1; done; } | \
  (cd core && cargo run -q -p kailo-core --example verify_workspace -- "$subject") \
  >/tmp/rbaudit.fixture 2>/tmp/rbaudit.fixture.err &
fixture_pid=$!
cleanup() {
  PSQL "drop trigger if exists drill_audit_gap on audit.audit_event; drop function if exists audit.drill_audit_gap();" >/dev/null || true
  rm -f /tmp/rbaudit.hold; wait "$fixture_pid" || true
  tail -1 /tmp/rbaudit.fixture.err; rm -f /tmp/rbaudit.fixture /tmp/rbaudit.fixture.err
}
trap cleanup EXIT
for _ in $(seq 1 180); do [ -s /tmp/rbaudit.fixture ] && break; sleep 1; done
ws=$(python3 -c 'import json;print(json.load(open("/tmp/rbaudit.fixture"))["workspace"])')
bff() {
  curl -s -o /tmp/rbaudit.body -w '%{http_code}' -X "$1" "$VERIFY_BFF_URL/api/v1/workspaces/$ws/messages" \
    -H "x-kailo-oidc-issuer: $OIDC_ISSUER" -H "x-kailo-oidc-subject: $subject" \
    ${2:+-H 'Content-Type: application/json' -H "Idempotency-Key: $(python3 -c 'import uuid;print(uuid.uuid4())')" -d "$2"}
}
in_history() { bff GET >/dev/null; grep -c "$1" /tmp/rbaudit.body || true; }

step "1. 注入：审计插入一律失败"
PSQL "create function audit.drill_audit_gap() returns trigger language plpgsql as \$\$ begin raise exception 'drill: audit unavailable'; end \$\$;
      create trigger drill_audit_gap before insert on audit.audit_event for each row execute function audit.drill_audit_gap();" >/dev/null
code=$(bff POST '{"content":"drill audit gap"}')
echo "  发布：HTTP $code $(cat /tmp/rbaudit.body)"
echo "  这条消息在 Relay 上的历史中出现 $(in_history 'drill audit gap') 次"

step "2. 恢复：删除触发器后照常发布"
PSQL "drop trigger drill_audit_gap on audit.audit_event; drop function audit.drill_audit_gap();" >/dev/null
code=$(bff POST '{"content":"drill audit restored"}')
echo "  发布：HTTP $code"
op=$(python3 -c 'import json;print(json.load(open("/tmp/rbaudit.body"))["operationId"])')
echo "  审计：$(PSQL "select string_agg(event_type||'/'||result_code, ' → ' order by occurred_at) from audit.audit_event where operation_id='$op'")"
