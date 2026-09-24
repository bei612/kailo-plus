#!/usr/bin/env bash
# RB-02 步骤 F 的演练工具：RelayOperatorIdentity 轮换
# （docs/runbooks/RB-02-secret-rotation-and-revocation.md）。
#
# 这是一次真实轮换：演练结束后本地拓扑用的就是新 operator key。它会两次重建
# buzz-relay、两次重建 core-bff。第 1 步先做破坏核验——新 key 不在 Relay 的
# allow-list 上时 Core 必须拒绝启动，库与 OpenBao 不变。
#
# 用法（在 apps 根目录）：bash core/verify/drill-operator-rotation.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
. core/verify/integration-env.sh
DC() { sudo -n docker compose --env-file deploy/local/.env -f deploy/local/compose.yaml "$@"; }
PSQL() { psql "$DATABASE_URL" -Atc "$1"; }
step() { printf '\n== %s（%s）\n' "$1" "$(date -u +%T)"; }
S=deploy/local/secrets
probe() { (cd core && cargo run -q -p kailo-core --example operator_probe -- "../$1"); }
row() { PSQL "select pubkey||' v'||version||' kv'||private_key_secret_version from identity.relay_operator_identity where state='ACTIVE'"; }
core_up() {
  # 引导凭据是一次性投递（DD-70）：每次启动都经 start-core.sh 现取
  deploy/local/start-core.sh >/dev/null 2>&1
  for _ in $(seq 1 60); do
    st=$(sudo -n docker inspect -f '{{.State.Status}}' "$(DC ps -aq core-bff)")
    [ "$st" = exited ] && return 1
    DC logs --tail 5 core-bff 2>&1 | grep -q '"listening"' && return 0
    sleep 1
  done
  return 1
}

step "0. 轮换前"
old=$(cat $S/relay_operator_pubkey)
echo "  在用 $(row)"

step "1. 生成新 key，退役中的 pubkey 进入并列窗口（先不重建 Relay）"
mv $S/relay_operator_pubkey $S/relay_operator_pubkey.retiring
mv $S/relay_operator_private_key $S/relay_operator_private_key.retiring
(cd deploy/local && bash bootstrap.sh >/dev/null)
new=$(cat $S/relay_operator_pubkey)
echo "  新 pubkey $new；buzz-relay.env 的 allow-list：$(grep -c "$new" $S/buzz-relay.env) 处含新、$(grep -c "$old" $S/buzz-relay.env) 处含旧"
echo "  破坏核验——Relay 仍是旧 allow-list 时启动 Core："
if core_up; then echo "  Core 启动了（不应发生）"; else
  echo "  Core 拒绝启动，日志末行：$(DC logs --tail 1 core-bff 2>&1 | cut -c1-240)"; fi
echo "  库中身份未变：$(row)"

step "2. 重建 Relay（新旧并列），再启动 Core"
DC up -d --no-deps --force-recreate buzz-relay >/dev/null 2>&1
for _ in $(seq 1 60); do curl -sf -o /dev/null "$RELAY_OPERATOR_API_ORIGIN/_readiness" && break; sleep 1; done
core_up && echo "  Core 已启动：$(DC logs core-bff 2>&1 | grep -o 'RelayOperatorIdentity 已轮换' | tail -1)"
echo "  库中身份：$(row)"
echo "  审计：$(PSQL "select result_code||' '||evidence_refs::text from audit.audit_event where action_key='relay_operator.rotate' order by occurred_at desc limit 1")"
echo "  新 key：$(probe $S/relay_operator_private_key)"
echo "  旧 key（窗口内）：$(probe $S/relay_operator_private_key.retiring)"

step "3. 以新 key 建一个 Tenant（scope_lifecycle）"
(cd core && cargo test -q -p kailo-core --test scope_lifecycle tenant_and_workspace 2>&1 | grep -E "test result")

step "4. 关闭窗口：移除退役 pubkey，重建 Relay"
rm -f $S/relay_operator_pubkey.retiring
(cd deploy/local && bash bootstrap.sh >/dev/null)
DC up -d --no-deps --force-recreate buzz-relay >/dev/null 2>&1
for _ in $(seq 1 60); do curl -sf -o /dev/null "$RELAY_OPERATOR_API_ORIGIN/_readiness" && break; sleep 1; done
echo "  allow-list 含旧：$(grep -c "$old" $S/buzz-relay.env)"
echo "  新 key：$(probe $S/relay_operator_private_key)"
echo "  旧 key：$(probe $S/relay_operator_private_key.retiring)"
rm -f $S/relay_operator_private_key.retiring
echo "  已删除旧私钥文件；OpenBao 里的旧 KV 版本按 RB-02 不可执行动作第 2 条保留"
