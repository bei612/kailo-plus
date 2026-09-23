#!/usr/bin/env bash
# 按权威逐个备份本地拓扑（07 §4：权威分散在多个系统，不存在「一次备份全部」）。
#
# 每个权威用它自己的上游工具：Postgres 用 pg_dumpall，OpenBao 用 raft 快照，
# MinIO 与 IdP 在停写时复制数据目录。备份目录与 secrets/ 同样敏感，权限 700。
#
# 不在备份范围内的：secrets/（解封分片、root token、各服务凭据）——它们在部署
# 拓扑中由外部密钥源持有，不与数据放在一起；本地的 registry 数据——它是供应链
# 产物仓库，按 digest 可重建引用，不是业务权威。
#
# 用法：deploy/local/dr-backup.sh <备份目录>
set -euo pipefail
cd "$(dirname "$0")"
. ./.env
out="${1:?用法: dr-backup.sh <备份目录>}"
mkdir -p "$out"; chmod 700 "$out"
umask 077
DC() { sudo -n docker compose --env-file .env -f compose.yaml "$@"; }
step() { printf '== %s\n' "$1"; }

step "OpenBao：raft 快照（root token 经 stdin）"
root_token=$(python3 -c 'import json;print(json.load(open("secrets/openbao_init.json"))["root_token"])')
printf '%s\n' "$root_token" | DC exec -T -e BAO_ADDR=http://127.0.0.1:8200 openbao \
  sh -c 'IFS= read -r BAO_TOKEN; export BAO_TOKEN; bao operator raft snapshot save /tmp/dr.snap >/dev/null && cat /tmp/dr.snap && rm -f /tmp/dr.snap' \
  > "$out/openbao.snap"
[ -s "$out/openbao.snap" ] || { echo "OpenBao 快照为空" >&2; exit 2; }

for svc in core-db buzz-db temporal-db; do
  step "$svc：pg_dumpall"
  DC exec -T "$svc" sh -c 'pg_dumpall -U "$POSTGRES_USER" --clean --if-exists' > "$out/$svc.sql"
  [ -s "$out/$svc.sql" ] || { echo "$svc 备份为空" >&2; exit 2; }
done

# SpiceDB 不能按 SQL 转储：revision 是 Postgres 事务 id，恢复到另一个集群后
# 全部关系不可见（SF-SPZ-06）。经它自己的批量导出 API 做逻辑备份。
step "SpiceDB：zed backup（批量导出 schema 与关系）"
zed_image=$(python3 -c '
import re
t=open("compose.yaml",encoding="utf-8").read()
print(re.search(r"image: (authzed/zed@sha256:[0-9a-f]+)", t).group(1))')
config=$(DC config --format json)
spicedb_endpoint=$(printf '%s' "$config" | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["worker"]["environment"]["SPICEDB_ENDPOINT"])')
component_net=$(printf '%s' "$config" | python3 -c 'import json,sys; print(json.load(sys.stdin)["networks"]["component"]["name"])')
sudo -n docker run --rm --network "$component_net" --env-file secrets/zed.env \
  -e "ZED_ENDPOINT=$spicedb_endpoint" -e ZED_INSECURE=true "$zed_image" backup create - > "$out/spicedb.zedbackup"
[ -s "$out/spicedb.zedbackup" ] || { echo "SpiceDB 备份为空" >&2; exit 2; }

step "MinIO（Relay 媒体）：停写后复制数据目录"
DC stop buzz-objects >/dev/null 2>&1
sudo -n tar -C data -cf - buzz-objects > "$out/buzz-objects.tar"
DC start buzz-objects >/dev/null 2>&1

step "IdP：停写后复制数据目录"
DC stop keycloak >/dev/null 2>&1
kc=$(DC ps -a -q keycloak)
sudo -n docker cp "$kc:/opt/keycloak/data/h2" - > "$out/keycloak-h2.tar"
DC start keycloak >/dev/null 2>&1

sha256sum "$out"/* > "$out/SHA256SUMS"
ls -l "$out"
