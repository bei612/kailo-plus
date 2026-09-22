#!/usr/bin/env bash
# 生成本地开发用 secret。开发用 secret 也经受控投递面取得，
# 不在仓库、环境文件或脚本中出现明文（07-运行与运维基线.md §2）。
# 本脚本只生成随机值并写入 gitignore 的目录，不接受人工传入的口令。
set -euo pipefail
cd "$(dirname "$0")"

mkdir -p secrets
umask 077

gen() {
  local path="secrets/$1"
  if [ -s "$path" ]; then
    printf '  已存在，保留：%s\n' "$path"
    return
  fi
  # 32 字节随机，base64 去掉换行；不落任何中间文件
  head -c 32 /dev/urandom | base64 | tr -d '\n' > "$path"
  chmod 600 "$path"
  printf '  已生成：%s\n' "$path"
}

gen core_db_password
gen keycloak_admin_password
gen temporal_db_password
gen spicedb_preshared_key
# SpiceDB 镜像是 distroless，无法在容器内读取挂载的 secret，改以 env_file 投递。
# 该文件与上面的原始 secret 同源，保持单一真值。
{ printf 'SPICEDB_GRPC_PRESHARED_KEY='; cat secrets/spicedb_preshared_key; printf '\n'; } > secrets/spicedb.env
chmod 600 secrets/spicedb.env
printf '  已生成：secrets/spicedb.env\n'

gen kailo_core_client_secret

# Keycloak 的 realm 定义入库，但客户端密钥不入库：把占位符替换成本机生成的值，
# 渲染到 gitignore 的目录后挂载。入库文件始终只有占位符。
mkdir -p secrets/keycloak-import
# namespace 名来自 .env，不写死在 realm 定义里：Temporal 的 default claim mapper
# 按 "<namespace>:<role>" 解析 permissions，namespace 写错即全部调用被拒。
[ -f .env ] && . ./.env
: "${TEMPORAL_NAMESPACE:?bootstrap 需要 .env 中的 TEMPORAL_NAMESPACE}"
sed -e "s|__KAILO_CORE_CLIENT_SECRET__|$(cat secrets/kailo_core_client_secret)|" \
    -e "s|__TEMPORAL_NAMESPACE__|${TEMPORAL_NAMESPACE}|g" \
  keycloak/kailo-realm.json > secrets/keycloak-import/kailo-realm.json
chmod 600 secrets/keycloak-import/kailo-realm.json
printf '  已渲染：secrets/keycloak-import/kailo-realm.json\n'

if [ ! -f .env ]; then
  printf '\n缺少 deploy/local/.env。复制 .env.example 并填写后再启动：\n  cp .env.example .env\n' >&2
  exit 1
fi

printf '\n就绪。启动：docker compose --env-file .env -f compose.yaml up -d\n'
