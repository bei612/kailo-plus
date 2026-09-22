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
  # 32 字节随机，base64 去掉换行；不落任何中间文件。
  # 用 URL-safe 字母表：口令要拼进 postgres:// 连接串的 userinfo，标准
  # base64 的 '/' 在那里是路径分隔符，会把连接串截断成另一个库名。
  head -c 32 /dev/urandom | base64 | tr -d '\n' | tr '+/' '-_' > "$path"
  chmod 600 "$path"
  printf '  已生成：%s\n' "$path"
}

# 十六进制变体：某些上游要求特定编码。AgentGateway 的 OIDC cookie 密钥走
# hex::decode 且必须恰好 32 字节（64 个十六进制字符），base64 会被拒。
gen_hex() {
  local path="secrets/$1"
  if [ -s "$path" ]; then
    printf '  已存在，保留：%s\n' "$path"
    return
  fi
  head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$path"
  chmod 600 "$path"
  printf '  已生成：%s（%s 个十六进制字符）\n' "$path" "$(wc -c < "$path" | tr -d ' ')"
}

gen core_db_password
gen buzz_db_password
gen buzz_objects_root_password
gen keycloak_admin_password
gen temporal_db_password
gen spicedb_preshared_key
gen spicedb_db_password

gen kailo_core_client_secret
gen kailo_worker_client_secret
gen browser_client_secret
gen_hex oidc_cookie_secret
# Relay 自身的 Nostr 身份，32 字节十六进制。它与 RelayOperatorIdentity 的密钥
# 不是一回事：后者由 Core 持有、用于创建 Community（SS-BUZ-OPERATOR）。
gen_hex buzz_relay_private_key

# RelayOperatorIdentity 的密钥对：Relay 在 BUZZ_REQUIRE_RELAY_MEMBERSHIP=true
# 时要求 RELAY_OWNER_PUBKEY，而 Core 用对应私钥创建 Community（SS-BUZ-OPERATOR）。
# 用上游自带的 generate-key 生成，不自己实现 secp256k1 派生。
if [ ! -s secrets/relay_operator_pubkey ] || [ ! -s secrets/relay_operator_private_key ]; then
  kp=$(sudo -n docker run --rm --entrypoint /usr/local/bin/buzz-admin \
        "$(python3 -c '
import re,sys
t=open("compose.yaml",encoding="utf-8").read()
print(re.search(r"image: (ghcr\.io/block/buzz@sha256:[0-9a-f]+)", t).group(1))
')" generate-key 2>/dev/null | grep -E "^(Public|Secret) key:")
  printf '%s' "$kp" | awk '/Public/{print $3}' | tr -d '\n' > secrets/relay_operator_pubkey
  printf '%s' "$kp" | awk '/Secret/{print $3}' | tr -d '\n' > secrets/relay_operator_private_key
  chmod 600 secrets/relay_operator_pubkey secrets/relay_operator_private_key
  printf '  已生成：RelayOperatorIdentity 密钥对\n'
else
  printf '  已存在，保留：RelayOperatorIdentity 密钥对\n'
fi
gen verify_user_password

# Keycloak 的 realm 定义入库，但客户端密钥不入库：把占位符替换成本机生成的值，
# 渲染到 gitignore 的目录后挂载。入库文件始终只有占位符。
# OpenBao 的 raft 数据目录：镜像以 uid 100 运行，具名卷由 Docker 以 root 创建
# 会导致写入被拒。用绑定挂载并在此设好属主，避免新克隆需要手工 chown。
mkdir -p data/openbao data/registry data/buzz-objects
if [ "$(stat -c %u data/openbao)" != "100" ]; then
  sudo -n chown 100:1000 data/openbao 2>/dev/null || {
    printf '  需要一次 sudo 设置 data/openbao 属主为 100:1000\n' >&2; exit 2; }
fi
printf '  已就绪：data/openbao（uid 100）\n'

mkdir -p secrets/keycloak-import
# namespace 名来自 .env，不写死在 realm 定义里：Temporal 的 default claim mapper
# 按 "<namespace>:<role>" 解析 permissions，namespace 写错即全部调用被拒。
[ -f .env ] && . ./.env
: "${TEMPORAL_NAMESPACE:?bootstrap 需要 .env 中的 TEMPORAL_NAMESPACE}"
sed -e "s|__KAILO_CORE_CLIENT_SECRET__|$(cat secrets/kailo_core_client_secret)|" \
    -e "s|__KAILO_WORKER_CLIENT_SECRET__|$(cat secrets/kailo_worker_client_secret)|" \
    -e "s|__TEMPORAL_NAMESPACE__|${TEMPORAL_NAMESPACE}|g" \
    -e "s|__BROWSER_CLIENT_SECRET__|$(cat secrets/browser_client_secret)|" \
    -e "s|__VERIFY_USER__|${VERIFY_USER:?bootstrap 需要 .env 中的 VERIFY_USER}|" \
    -e "s|__OIDC_REDIRECT_URI__|${OIDC_REDIRECT_URI:?bootstrap 需要 .env 中的 OIDC_REDIRECT_URI}|" \
    -e "s|__VERIFY_USER_PASSWORD__|$(cat secrets/verify_user_password)|" \
  keycloak/kailo-realm.json > secrets/keycloak-import/kailo-realm.json
chmod 600 secrets/keycloak-import/kailo-realm.json
printf '  已渲染：secrets/keycloak-import/kailo-realm.json\n'

# 网关以环境变量读取浏览器客户端密钥；与上面的 secret 同源，保持单一真值。
{ printf 'OIDC_BROWSER_CLIENT_SECRET='; cat secrets/browser_client_secret; printf '\n';
  printf 'OIDC_COOKIE_SECRET='; cat secrets/oidc_cookie_secret; printf '\n'; } > secrets/browser-client.env
chmod 600 secrets/browser-client.env
printf '  已生成：secrets/browser-client.env\n'

# Relay 的数据库连接串含口令，走 env_file 而不是 .env。
{ printf 'DATABASE_URL=postgres://%s:%s@buzz-db:5432/%s\n' "${BUZZ_DB_USER:?}" "$(cat secrets/buzz_db_password)" "${BUZZ_DB_NAME:?}"
  printf 'BUZZ_RELAY_PRIVATE_KEY='; cat secrets/buzz_relay_private_key; printf '\n'
  printf 'RELAY_OWNER_PUBKEY='; cat secrets/relay_operator_pubkey; printf '\n'
  printf 'BUZZ_S3_ENDPOINT=http://buzz-objects:9000\n'
  printf 'BUZZ_S3_BUCKET=%s\n' "${BUZZ_S3_BUCKET:?}"
  printf 'BUZZ_S3_REGION=%s\n' "${BUZZ_S3_REGION:?}"
  printf 'BUZZ_S3_ADDRESSING_STYLE=path\n'
  printf 'BUZZ_S3_ACCESS_KEY=%s\n' "${BUZZ_OBJECTS_USER:?}"
  printf 'BUZZ_S3_SECRET_KEY='; cat secrets/buzz_objects_root_password; printf '\n'
  # operator 面：签名 URL 必须精确等于 origin + path，因此 origin 是配置而非
  # 入站 Host 头推导（SS-BUZ-OPERATOR）。允许的 operator pubkey 白名单同理。
  printf 'RELAY_OPERATOR_API_ORIGIN=%s\n' "${RELAY_OPERATOR_API_ORIGIN:?}"
  printf 'RELAY_OPERATOR_PUBKEYS='; cat secrets/relay_operator_pubkey; printf '\n'
  printf 'REDIS_URL=redis://buzz-replay:6379\n'; } > secrets/buzz-relay.env

# SpiceDB 镜像是 distroless，无法在容器内读取挂载的 secret，PSK 与连接串
# 都以 env_file 投递；两者与上面的原始 secret 同源，保持单一真值。
# 不写成命令行 flag：flag 在启用 tracing 时随 OTel resource 导出（SF-SPZ-04）。
{ printf 'SPICEDB_GRPC_PRESHARED_KEY='; cat secrets/spicedb_preshared_key; printf '\n'
  printf 'SPICEDB_DATASTORE_ENGINE=postgres\n'
  printf 'SPICEDB_DATASTORE_CONN_URI=postgres://%s:%s@spicedb-db:5432/%s?sslmode=disable\n' \
    "${SPICEDB_DB_USER:?}" "$(cat secrets/spicedb_db_password)" "${SPICEDB_DB_NAME:?}"; } > secrets/spicedb.env
chmod 600 secrets/spicedb.env
printf '  已生成：secrets/spicedb.env\n'

# Worker 的两把凭据：自己的 OIDC client secret 与 SpiceDB 的 PSK。
# 与上面的原始 secret 同源，保持单一真值。
{ printf 'OIDC_WORKER_CLIENT_SECRET='; cat secrets/kailo_worker_client_secret; printf '\n'
  printf 'SPICEDB_GRPC_PRESHARED_KEY='; cat secrets/spicedb_preshared_key; printf '\n'; } > secrets/worker.env
chmod 600 secrets/worker.env
printf '  已生成：secrets/worker.env\n'

# zed 写 schema 用同一把 PSK，但不应拿到数据库连接串——它只需要 gRPC 凭据。
{ printf 'ZED_TOKEN='; cat secrets/spicedb_preshared_key; printf '\n'; } > secrets/zed.env
chmod 600 secrets/zed.env
printf '  已生成：secrets/zed.env\n'

# 对象存储自身的凭据；与 Relay 侧同源，保持单一真值。
{ printf 'MINIO_ROOT_USER=%s\n' "${BUZZ_OBJECTS_USER:?}"
  printf 'MINIO_ROOT_PASSWORD='; cat secrets/buzz_objects_root_password; printf '\n'
  printf 'BUZZ_S3_BUCKET=%s\n' "${BUZZ_S3_BUCKET:?}"; } > secrets/buzz-objects.env
chmod 600 secrets/buzz-objects.env
printf '  已生成：secrets/buzz-objects.env\n'
chmod 600 secrets/buzz-relay.env
printf '  已生成：secrets/buzz-relay.env\n'

if [ ! -f .env ]; then
  printf '\n缺少 deploy/local/.env。复制 .env.example 并填写后再启动：\n  cp .env.example .env\n' >&2
  exit 1
fi

printf '\n就绪。启动：docker compose --env-file .env -f compose.yaml up -d\n'
