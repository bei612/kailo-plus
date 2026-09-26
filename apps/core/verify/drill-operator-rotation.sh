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
  deploy/local/start-core.sh >/dev/null 2>&1 || return 2
  for _ in $(seq 1 60); do
    st=$(sudo -n docker inspect -f '{{.State.Status}}' "$(DC ps -aq core-bff)")
    [ "$st" = exited ] && return 1
    curl -fsS -o /dev/null "$VERIFY_BFF_URL/healthz" && return 0
    sleep 1
  done
  return 1
}

step "0. 轮换前"
for file in relay_operator_pubkey.retiring relay_operator_pubkey.closing relay_operator_private_key.retiring; do
  [ ! -e "$S/$file" ] || { echo "退役文件仍在，先人工核对上次轮换：$file" >&2; exit 2; }
done
old=$(cat "$S/relay_operator_pubkey")
before=$(row)
before_locator=$(PSQL "select private_key_secret_ref from identity.relay_operator_identity where state='ACTIVE'")
[ "$(PSQL "select pubkey from identity.relay_operator_identity where state='ACTIVE'")" = "$old" ] \
  || { echo "部署的旧公钥与库中 ACTIVE operator 不一致" >&2; exit 2; }
echo "  在用 $(row)"

step "1. 生成新 key，退役中的 pubkey 进入并列窗口（先不重建 Relay）"
mv "$S/relay_operator_pubkey" "$S/relay_operator_pubkey.retiring"
mv "$S/relay_operator_private_key" "$S/relay_operator_private_key.retiring"
(cd deploy/local && bash bootstrap.sh >/dev/null)
new=$(cat "$S/relay_operator_pubkey")
echo "  新 pubkey $new；buzz-relay.env 的 allow-list：$(grep -c "$new" $S/buzz-relay.env) 处含新、$(grep -c "$old" $S/buzz-relay.env) 处含旧"
echo "  破坏核验——Relay 仍是旧 allow-list 时启动 Core："
if core_up; then
  echo "Core 接受了未入 Relay allow-list 的新 key，演练失败" >&2
  exit 1
else
  result=$?
  [ "$result" -eq 1 ] || { echo "Core 构建、投递或启动等待失败，不是准入拒绝" >&2; exit 1; }
fi
failure_log=$(DC logs --tail 20 core-bff 2>&1)
grep -q '未被 Relay 接受' <<< "$failure_log" && grep -q '403' <<< "$failure_log" \
  || { echo "Core 退出原因不是 Relay 403 准入拒绝" >&2; exit 1; }
[ "$(row)" = "$before" ] \
  || { echo "Relay 拒绝后 operator 身份行发生变化" >&2; exit 1; }
echo "  Core 按 Relay 403 拒绝启动，库中身份未变"
echo "  库中身份未变：$(row)"

step "2. 重建 Relay（新旧并列），再启动 Core"
DC up -d --no-deps --force-recreate buzz-relay >/dev/null 2>&1
for _ in $(seq 1 60); do curl -sf -o /dev/null "$RELAY_OPERATOR_API_ORIGIN/_readiness" && break; sleep 1; done
curl -sf -o /dev/null "$RELAY_OPERATOR_API_ORIGIN/_readiness" \
  || { echo "Relay 在并列窗口未就绪" >&2; exit 1; }
core_up || { echo "Core 在并列窗口未就绪" >&2; exit 1; }
echo "  Core 已启动：$(DC logs core-bff 2>&1 | grep -o 'RelayOperatorIdentity 已轮换' | tail -1)"
[ "$(PSQL "select pubkey from identity.relay_operator_identity where state='ACTIVE'")" = "$new" ] \
  || { echo "库中 ACTIVE operator 不是新公钥" >&2; exit 1; }
after_locator=$(PSQL "select private_key_secret_ref from identity.relay_operator_identity where state='ACTIVE'")
[ -n "$before_locator" ] && [ -n "$after_locator" ] && [ "$before_locator" != "$after_locator" ] \
  || { echo "新旧 operator 必须有独立的定版 SecretRef locator" >&2; exit 1; }
echo "  库中身份：$(row)"
echo "  审计：$(PSQL "select result_code||' '||evidence_refs::text from audit.audit_event where action_key='relay_operator.rotate' order by occurred_at desc limit 1")"
new_probe=$(probe "$S/relay_operator_private_key")
old_probe=$(probe "$S/relay_operator_private_key.retiring")
[ "$new_probe" = "ACCEPTED $new" ] && [ "$old_probe" = "ACCEPTED $old" ] \
  || { echo "并列窗口的新旧 key 探针结果不符" >&2; exit 1; }
echo "  新 key：$new_probe"
echo "  旧 key（窗口内）：$old_probe"

step "3. 以新 key 建一个 Tenant（scope_lifecycle）"
(cd core && cargo test -q -p kailo-core --test scope_lifecycle tenant_and_workspace 2>&1 | grep -E "test result")

step "4. 关闭窗口：移除退役 pubkey，重建 Relay"
# 先移走而不销毁；若重建或探针失败，旧公钥还能移回并恢复并列窗口。
mv "$S/relay_operator_pubkey.retiring" "$S/relay_operator_pubkey.closing"
(cd deploy/local && bash bootstrap.sh >/dev/null)
DC up -d --no-deps --force-recreate buzz-relay >/dev/null 2>&1
for _ in $(seq 1 60); do curl -sf -o /dev/null "$RELAY_OPERATOR_API_ORIGIN/_readiness" && break; sleep 1; done
curl -sf -o /dev/null "$RELAY_OPERATOR_API_ORIGIN/_readiness" \
  || { echo "Relay 在关闭窗口后未就绪" >&2; exit 1; }
! grep -q "$old" "$S/buzz-relay.env" \
  || { echo "关闭窗口后 allow-list 仍含旧公钥" >&2; exit 1; }
new_probe=$(probe "$S/relay_operator_private_key")
old_probe=$(probe "$S/relay_operator_private_key.retiring")
[ "$new_probe" = "ACCEPTED $new" ] && [ "$old_probe" = "REJECTED 403 $old" ] \
  || { echo "关闭窗口后的新旧 key 探针结果不符" >&2; exit 1; }
echo "  新 key：$new_probe"
echo "  旧 key：$old_probe"
rm -f "$S/relay_operator_pubkey.closing"
rm -f "$S/relay_operator_private_key.retiring"
echo "  已删除退役私钥文件；旧 OpenBao KV 路径按 RB-02 保留到终态证据收敛"
