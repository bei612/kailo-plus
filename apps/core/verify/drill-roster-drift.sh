#!/usr/bin/env bash
# RB-05 的演练工具：roster 与 Core 成员事实不一致时，对账度量必须报出来
# （docs/runbooks/RB-05-projection-lag-and-reconciliation.md）。
#
# 以「Core 改了成员事实却没有投影」模拟缺陷：把一个在 Channel roster 上的成员
# 直接置为 REVOKED（不经 Workflow），对账应报 unexpected；还原后应恢复一致。
# 只改演练夹具自己的行，结束时夹具整体拆除。
#
# 用法（在 apps 根目录）：bash core/verify/drill-roster-drift.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
. core/verify/integration-env.sh
DC() { sudo -n docker compose --env-file deploy/local/.env -f deploy/local/compose.yaml "$@"; }
PSQL() { psql "$DATABASE_URL" -Atc "$1"; }
step() { printf '\n== %s（%s）\n' "$1" "$(date -u +%T)"; }
interval=${ROSTER_RECONCILE_INTERVAL_SECONDS:?}

# 等到某个时刻之后出现（或不出现）关于该 Workspace 的不一致日志
drift_logged_since() {
  DC logs --since "$1" core-bff 2>&1 | grep "Channel roster 与成员事实不一致" | grep -c "$ws" || true
}

step "0. 开通真实 Workspace"
touch /tmp/rbdrift.hold
{ while [ -e /tmp/rbdrift.hold ]; do sleep 1; done; } | \
  (cd core && cargo run -q -p kailo-core --example verify_workspace -- "drift-$(date +%s)") \
  >/tmp/rbdrift.fixture 2>/tmp/rbdrift.fixture.err &
fixture_pid=$!
cleanup() { rm -f /tmp/rbdrift.hold; wait "$fixture_pid" || true; tail -1 /tmp/rbdrift.fixture.err; rm -f /tmp/rbdrift.fixture /tmp/rbdrift.fixture.err; }
trap cleanup EXIT
for _ in $(seq 1 180); do [ -s /tmp/rbdrift.fixture ] && break; sleep 1; done
ws=$(python3 -c 'import json;print(json.load(open("/tmp/rbdrift.fixture"))["workspace"])')
wm=$(PSQL "select id from identity.workspace_membership where workspace_id='$ws'")
echo "  workspace $ws"

step "1. 一致时不报"
t0=$(date -u +%Y-%m-%dT%H:%M:%SZ)
sleep $((interval * 2 + 5))
echo "  期间关于该 Workspace 的不一致日志：$(drift_logged_since "$t0") 条"

step "2. 注入不一致：成员事实改为 REVOKED，roster 未动"
PSQL "update identity.workspace_membership set state='REVOKED' where id='$wm'" >/dev/null
t1=$(date -u +%Y-%m-%dT%H:%M:%SZ)
for _ in $(seq 1 $((interval * 3))); do [ "$(drift_logged_since "$t1")" -gt 0 ] && break; sleep 1; done
DC logs --since "$t1" core-bff 2>&1 | grep "Channel roster 与成员事实不一致" | grep "$ws" | head -1 \
  | python3 -c 'import json,sys; d=json.loads(sys.stdin.read().split("|",1)[1]); f=d["fields"]; print("  报出：", f["message"], "missing=%s unexpected=%s" % (f["missing"], f["unexpected"]))'

step "3. 还原事实：恢复一致后不再报"
PSQL "update identity.workspace_membership set state='ACTIVE' where id='$wm'" >/dev/null
sleep $((interval + 5))
t2=$(date -u +%Y-%m-%dT%H:%M:%SZ)
sleep $((interval * 2 + 5))
echo "  还原后关于该 Workspace 的不一致日志：$(drift_logged_since "$t2") 条"
