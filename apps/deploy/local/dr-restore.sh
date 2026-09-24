#!/usr/bin/env bash
# 按 07 §4 的固定顺序恢复本地拓扑：OpenBao → Core 数据库 → 各组件权威。
# 恢复完成后除公开入口（AgentGateway）之外全部启动；投影对账核验通过之前
# 不开放入口，开放是单独的一步：docker compose up -d agentgateway。
#
# 前提：数据卷与数据目录是空的（灾难之后的状态），secrets/ 仍在——解封分片与
# root token 在部署拓扑中由外部密钥源持有，不随数据一起丢失。
#
# 用法：deploy/local/dr-restore.sh <备份目录>
set -euo pipefail
cd "$(dirname "$0")"
. ./.env
in="${1:?用法: dr-restore.sh <备份目录>}"
(cd "$in" && sha256sum -c --quiet SHA256SUMS) || { echo "备份校验和不符，拒绝恢复" >&2; exit 2; }
umask 077
DC() { sudo -n docker compose --env-file .env -f compose.yaml "$@"; }
step() { printf '== %s（%s）\n' "$1" "$(date -u +%T)"; }
bao_status() {
  # bao status 在封存或未初始化时以非零码退出：先取输出、再解析，不让退出码
  # 混进结果（pipefail 下 `a | b || echo` 会在正常输出之后再多打一行）
  local j
  j=$(DC exec -T -e BAO_ADDR=http://127.0.0.1:8200 openbao bao status -format=json 2>/dev/null || true)
  printf '%s' "$j" | python3 -c 'import json,sys
try: d=json.load(sys.stdin)
except Exception: print("down"); raise SystemExit
print("sealed" if d.get("sealed", True) else ("standby" if d.get("ha_mode")=="standby" else "active"))'
}
wait_bao() { for _ in $(seq 1 60); do [ "$(bao_status)" = "$1" ] && return 0; sleep 2; done; echo "OpenBao 未到 $1" >&2; exit 2; }
wait_healthy() {
  for _ in $(seq 1 90); do
    [ "$(sudo -n docker inspect -f '{{.State.Health.Status}}' "$(DC ps -q "$1")" 2>/dev/null)" = healthy ] && return 0
    sleep 2
  done
  echo "$1 未就绪" >&2; exit 2
}

step "1. OpenBao：新节点初始化 → 强制恢复快照 → 以原分片解封"
mkdir -p data/openbao
sudo -n chown 100:1000 data/openbao
DC up -d openbao >/dev/null 2>&1
wait_bao sealed
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
# 新节点自己的分片与 token 只用于执行这一次恢复，之后作废
DC exec -T -e BAO_ADDR=http://127.0.0.1:8200 openbao \
  bao operator init -key-shares=1 -key-threshold=1 -format=json > "$tmp/fresh.json"
python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["unseal_keys_b64"][0],end="")' "$tmp/fresh.json" \
  | DC exec -T -e BAO_ADDR=http://127.0.0.1:8200 openbao bao write sys/unseal key=- >/dev/null
wait_bao active
{ python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["root_token"])' "$tmp/fresh.json"; cat "$in/openbao.snap"; } \
  | DC exec -T -e BAO_ADDR=http://127.0.0.1:8200 openbao \
      sh -c 'IFS= read -r BAO_TOKEN; export BAO_TOKEN; cat > /tmp/dr.snap; bao operator raft snapshot restore -force /tmp/dr.snap; rc=$?; rm -f /tmp/dr.snap; exit $rc'
rm -f "$tmp/fresh.json"
# 恢复后 barrier 换回快照里的那一套：以原分片解封（openbao-init.sh 幂等地解封并核验 audit）
bash openbao-init.sh >/dev/null
wait_bao active
echo "  OpenBao：$(bao_status)"

restore_pg() {
  local svc=$1
  step "$svc：pg_dumpall 恢复"
  DC up -d "$svc" >/dev/null 2>&1
  wait_healthy "$svc"
  # --clean 输出会尝试删除当前连接所用的角色，这类错误是预期的；其余错误逐条打印
  DC exec -T "$svc" sh -c 'psql -U "$POSTGRES_USER" -d postgres -q' < "$in/$svc.sql" 2> "$tmp/$svc.err" >/dev/null || true
  grep "ERROR" "$tmp/$svc.err" | grep -v -E 'current user cannot be dropped|role ".*" already exists|cannot drop the currently open database' || true
}

step "2. Core 数据库"
restore_pg core-db

step "3. 组件权威"
restore_pg buzz-db
restore_pg temporal-db
step "SpiceDB：空库迁移后经批量导入 API 恢复（SF-SPZ-06）"
DC up -d spicedb >/dev/null 2>&1
wait_healthy spicedb
zed_image=$(python3 -c '
import re
t=open("compose.yaml",encoding="utf-8").read()
print(re.search(r"image: (authzed/zed@sha256:[0-9a-f]+)", t).group(1))')
config=$(DC config --format json)
spicedb_endpoint=$(printf '%s' "$config" | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["worker"]["environment"]["SPICEDB_ENDPOINT"])')
component_net=$(printf '%s' "$config" | python3 -c 'import json,sys; print(json.load(sys.stdin)["networks"]["component"]["name"])')
sudo -n docker run --rm -u "$(id -u)" --network "$component_net" --env-file secrets/zed.env \
  -e "ZED_ENDPOINT=$spicedb_endpoint" -e ZED_INSECURE=true \
  -v "$(realpath "$in/spicedb.zedbackup"):/backup/spicedb.zedbackup:ro" \
  "$zed_image" backup restore /backup/spicedb.zedbackup
step "MinIO（Relay 媒体）"
mkdir -p data
sudo -n tar -C data -xf "$in/buzz-objects.tar"
step "IdP"
DC create keycloak >/dev/null 2>&1
kc=$(DC ps -a -q keycloak)
sudo -n docker cp - "$kc:/opt/keycloak/data/" < "$in/keycloak-h2.tar"

step "4. 启动其余服务（公开入口除外）"
services=$(DC config --services | grep -vx -e agentgateway -e core-bff | tr '\n' ' ')
# shellcheck disable=SC2086
DC up -d $services >/dev/null 2>&1
for s in buzz-relay keycloak temporal spicedb; do wait_healthy "$s"; done
# Core 的引导凭据是一次性投递（DD-70）：恢复出的 openbao-core.env 里那份早已被
# 消费。现取投递再启动。
./start-core.sh >/dev/null 2>&1
services="$services core-bff"
echo "  已启动：$services"
echo "  入口仍关闭。投影对账核验通过后执行：docker compose --env-file .env -f compose.yaml up -d agentgateway"
