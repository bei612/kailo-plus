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
# 运行投递（.env、secrets/、data/）在运行目录，代码与配置在本目录（ADR-20 §3）
. ./runtime-dir.sh
. "$KAILO_RUNTIME_DIR/.env"
in="${1:?用法: dr-restore.sh <备份目录>}"
(cd "$in" && sha256sum -c --quiet SHA256SUMS) || { echo "备份校验和不符，拒绝恢复" >&2; exit 2; }
umask 077
DC() { runtime_compose "$@"; }
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

# A restored writer must never reuse the publication epoch from its backup.
# Stop every local publisher and reader before changing any authority. Relay
# has a separately published native port, so stopping the web gateway alone
# does not close publication observations.
step "关闭入口、Core、Worker 与原生 Relay，保持恢复窗口"
DC stop agentgateway core-bff worker buzz-relay >/dev/null

step "1. OpenBao：新节点初始化 → 强制恢复快照 → 以原分片解封"
mkdir -p "$KAILO_RUNTIME_DIR/data/secret-store"
sudo -n chown 100:1000 "$KAILO_RUNTIME_DIR/data/secret-store"
# 第二个 audit device 的目录不在快照里；解封前必须就位（secret-store-config.hcl）
./secret-store-audit-dir.sh --prepare >/dev/null
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
# 恢复后 barrier 换回快照里的那一套：以原分片解封（secret-store-init.sh 幂等地解封并核验 audit）
bash secret-store-init.sh >/dev/null
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
step "轮换已恢复的 Community publication epoch"
# An older backup without this column has no epoch evidence to reuse: the
# original later migration creates fresh epochs before advertising readiness.
# Do not hand-apply or forge its SQLx migration record here.
DC exec -T buzz-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q' <<'SQL'
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='communities'
               AND column_name='publication_epoch') THEN
    EXECUTE 'UPDATE public.communities SET publication_epoch=gen_random_uuid()';
  END IF;
END $$;
SQL
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
sudo -n docker run --rm -u "$(id -u)" --network "$component_net" --env-file "$KAILO_RUNTIME_DIR/secrets/zed.env" \
  -e "ZED_ENDPOINT=$spicedb_endpoint" -e ZED_INSECURE=true \
  -v "$(realpath "$in/spicedb.zedbackup"):/backup/spicedb.zedbackup:ro" \
  "$zed_image" backup restore /backup/spicedb.zedbackup
step "MinIO（Relay 媒体）"
mkdir -p "$KAILO_RUNTIME_DIR/data"
# 归档内的目录名随版本不同（旧备份为 buzz-objects/），恢复一律落到 data/collab-objects
sudo -n tar -C "$KAILO_RUNTIME_DIR/data" --transform 's#^buzz-objects#collab-objects#' -xf "$in/buzz-objects.tar"
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
echo "  每个 ACTIVE Community 须回读 NIP-11 publication_policy：屏障 ready、epoch 为本次恢复后的新值；旧 epoch 的缺失证明不可授权重发。"
echo "  入口仍关闭。投影对账核验通过后执行（deploy/local 下）：KAILO_RUNTIME_DIR=$KAILO_RUNTIME_DIR docker compose --env-file $KAILO_RUNTIME_DIR/.env -f compose.yaml up -d agentgateway"
