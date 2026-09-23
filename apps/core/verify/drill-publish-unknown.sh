#!/usr/bin/env bash
# RB-07 的演练工具：消息发布结果不明，对账按 event id 收敛成确定结论（DD-81）
# （docs/runbooks/RB-07-unknown-external-results.md）。
#
# 停掉 Relay 后经 BFF 发布：得到 UNKNOWN 与 operation id，审计只有 DISPATCH；
# 恢复 Relay 后，settle 窗口过去仍查不到这条事件，对账追加 NOT_DELIVERED。
#
# 为了不等满 900 秒以上，演练前把 .env 的 PUBLISH_RESULT_SETTLE_SECONDS 临时调小
# 并重建 core-bff，演练后还原。这只在演练里成立：这条事件在 Relay 停机时签发、
# 从未送达，不存在「稍后被接受」的可能；生产取值不得小于 Relay 的时间漂移窗口
# （07 §1）。
#
# 用法（在 apps 根目录）：bash core/verify/drill-publish-unknown.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
. core/verify/integration-env.sh
DC() { sudo -n docker compose --env-file deploy/local/.env -f deploy/local/compose.yaml "$@"; }
PSQL() { psql "$DATABASE_URL" -Atc "$1"; }
step() { printf '\n== %s（%s）\n' "$1" "$(date -u +%T)"; }

step "0. 开通真实 Workspace"
subject="unknown-$(date +%s)"
touch /tmp/rbunk.hold
{ while [ -e /tmp/rbunk.hold ]; do sleep 1; done; } | \
  (cd core && cargo run -q -p kailo-core --example verify_workspace -- "$subject") \
  >/tmp/rbunk.fixture 2>/tmp/rbunk.fixture.err &
fixture_pid=$!
cleanup() {
  DC start buzz-relay >/dev/null 2>&1 || true
  for _ in $(seq 1 60); do curl -sf -o /dev/null "$RELAY_OPERATOR_API_ORIGIN/_readiness" && break; sleep 1; done
  rm -f /tmp/rbunk.hold; wait "$fixture_pid" || true
  tail -1 /tmp/rbunk.fixture.err; rm -f /tmp/rbunk.fixture /tmp/rbunk.fixture.err /tmp/rbunk.body
}
trap cleanup EXIT
for _ in $(seq 1 180); do [ -s /tmp/rbunk.fixture ] && break; sleep 1; done
ws=$(python3 -c 'import json;print(json.load(open("/tmp/rbunk.fixture"))["workspace"])')

step "1. 停 Relay 后发布"
DC stop buzz-relay >/dev/null 2>&1
code=$(curl -s -o /tmp/rbunk.body -w '%{http_code}' -X POST "$VERIFY_BFF_URL/api/v1/workspaces/$ws/messages" \
  -H "x-kailo-oidc-issuer: $OIDC_ISSUER" -H "x-kailo-oidc-subject: $subject" \
  -H 'Content-Type: application/json' -d '{"content":"drill unknown"}')
echo "  发布：HTTP $code $(cat /tmp/rbunk.body)"
op=$(python3 -c 'import json;print(json.load(open("/tmp/rbunk.body"))["operationId"])')
echo "  审计：$(PSQL "select string_agg(event_type||'/'||result_code, ' → ' order by occurred_at) from audit.audit_event where operation_id='$op'")"

step "2. 恢复 Relay；窗口内不下结论"
DC start buzz-relay >/dev/null 2>&1
for _ in $(seq 1 60); do curl -sf -o /dev/null "$RELAY_OPERATOR_API_ORIGIN/_readiness" && break; sleep 1; done
sleep "$PUBLISH_RECONCILE_INTERVAL_SECONDS"
echo "  审计：$(PSQL "select string_agg(event_type||'/'||result_code, ' → ' order by occurred_at) from audit.audit_event where operation_id='$op'")"

step "3. 超出 settle 窗口后对账结论"
bound=$((PUBLISH_RESULT_SETTLE_SECONDS + PUBLISH_RECONCILE_INTERVAL_SECONDS * 3))
for _ in $(seq 1 "$bound"); do
  [ -n "$(PSQL "select 1 from audit.audit_event where operation_id='$op' and event_type='RECONCILIATION'")" ] && break
  sleep 1
done
echo "  审计：$(PSQL "select string_agg(event_type||'/'||result_code, ' → ' order by occurred_at) from audit.audit_event where operation_id='$op'")"
