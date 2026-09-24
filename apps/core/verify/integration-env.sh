# 集成核验与浏览器走查共用的环境（由调用方 source，不单独执行）。
#
# 变量名与产品侧同名，但值换成本机发布端口：部署里 OPENBAO_ADDR 是
# http://openbao:8200、SPICEDB_ENDPOINT 是 spicedb:50051，都只在容器网络内可达。
# KAILO_INTEGRATION 是显式开关——谁 source 过 deploy/local/.env 再跑门禁，
# 没有它就会让本该跳过的用例拿着网内地址去连。
#
# 调用方须位于 apps 根目录。
local_dir=deploy/local
[ -f "$local_dir/.env" ] || { echo "缺少 $local_dir/.env，先跑 $local_dir/bootstrap.sh" >&2; return 2; }

set -a
. "$local_dir/.env"
set +a
# Core 的引导凭据是一次性投递（start-core.sh），核验不碰它。核验读写 KV 用一枚
# 现签的、与 Core 同策略（kailo-core）的令牌：它证明的仍是「那条策略给出的能力」，
# 有效期取部署登记的令牌周期。root token 经 stdin 进入容器，不上命令行。
OPENBAO_VERIFY_TOKEN="$(python3 -c 'import json;print(json.load(open("'"$local_dir"'/secrets/openbao_init.json"))["root_token"])' \
  | sudo -n docker compose --env-file "$local_dir/.env" -f "$local_dir/compose.yaml" exec -T \
      -e BAO_ADDR=http://127.0.0.1:8200 -e BAO_NAMESPACE="$OPENBAO_PLATFORM_NAMESPACE" openbao \
      sh -c 'IFS= read -r BAO_TOKEN; export BAO_TOKEN; exec bao "$@"' bao \
      token create -policy=kailo-core -ttl="$OPENBAO_TOKEN_PERIOD" -format=json \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["auth"]["client_token"])')"
export OPENBAO_VERIFY_TOKEN

export KAILO_INTEGRATION=1
export DATABASE_URL="${CORE_DATABASE_URL/@core-db:5432/@127.0.0.1:${CORE_DB_PORT}}"
export OPENBAO_ADDR="http://127.0.0.1:${OPENBAO_PORT}"
export OPENBAO_SERVICE_IDENTITY="${OIDC_SERVICE_CLIENT_ID}"
export SPICEDB_ENDPOINT="127.0.0.1:${SPICEDB_PORT}"
export SPICEDB_INSECURE=true
export SPICEDB_GRPC_PRESHARED_KEY="$(cat "$local_dir/secrets/spicedb_preshared_key")"
export CORE_SERVICE_URL="http://127.0.0.1:${SERVICE_PORT}"
export OIDC_TOKEN_URL="http://127.0.0.1:${KEYCLOAK_PORT}/realms/${OIDC_REALM}/protocol/openid-connect/token"
# Keycloak 按请求 Host 推导 issuer；令牌里的 iss 必须逐字符等于 Core 配置的那个
export OIDC_TOKEN_HOST="${OIDC_ISSUER#*://}"; OIDC_TOKEN_HOST="${OIDC_TOKEN_HOST%%/realms/*}"
export WORKER_CLIENT_SECRET="$(cat "$local_dir/secrets/kailo_worker_client_secret")"
export RELAY_OPERATOR_PRIVATE_KEY="$(cat "$local_dir/secrets/relay_operator_private_key")"
export VERIFY_SECRET_LOCATOR="${OPENBAO_PLATFORM_NAMESPACE}/${OPENBAO_KV_MOUNT}/verify/secret-ref"
export VERIFY_DOCKER_NETWORK=kailo-local_component
export VERIFY_ZED_ENV_FILE="$(pwd)/$local_dir/secrets/zed.env"
export VERIFY_SPICEDB_ENDPOINT=spicedb:50051
# Catalog Tenant 的 slug：核验要按它找到平台引导建立的那个 Tenant
export PLATFORM_CATALOG_TENANT_SLUG
# BFF 面：核验从 app 网络外经发布端口访问，与 Browser 经网关到达的是同一个 router
export VERIFY_BFF_URL="http://127.0.0.1:${BFF_PORT}"
# zed 镜像按 digest 引用（ADR-06），与 compose 中同一个
export VERIFY_ZED_IMAGE="$(python3 -c '
import re,io
t=io.open("deploy/local/compose.yaml",encoding="utf-8").read()
print(re.search(r"image: (authzed/zed@sha256:[0-9a-f]+)", t).group(1))')"
# Temporal 的官方 CLI 与其经内部 frontend 的地址，都取 compose 里 namespace 初始化
# 用的那一份：核验与部署用同一个镜像、同一个入口
eval "$(python3 -c '
import re,io
t=io.open("deploy/local/compose.yaml",encoding="utf-8").read()
svc=t.split("\n  temporal-namespace:\n",1)[1].split("\n  spicedb-schema:",1)[0]
print("export VERIFY_TEMPORAL_ADMIN_IMAGE=" + re.search(r"image: (\S+)", svc).group(1))
print("export VERIFY_TEMPORAL_INTERNAL_ADDRESS=" + re.search(r"TEMPORAL_ADDRESS: (\S+)", svc).group(1))')"
# 原生端（DD-78）：经网关原生入口、以 PKCE 取得的 Bearer 调用。核验像原生应用
# 一样登录 IdP，口令从文件读入进程，不进环境变量。
export VERIFY_NATIVE_URL="http://127.0.0.1:${AGENTGATEWAY_NATIVE_PORT}"
export VERIFY_KEYCLOAK_URL="http://127.0.0.1:${KEYCLOAK_PORT}"
export VERIFY_USER_PASSWORD_FILE="$(pwd)/$local_dir/secrets/verify_user_password"
export VERIFY_KEYCLOAK_ADMIN_PASSWORD_FILE="$(pwd)/$local_dir/secrets/keycloak_admin_password"
# 整条链要串起三步投影，其中 roster 那步以 Relay 的对账间隔为界
export VERIFY_CONVERGE_BOUND_SECS=$(( BUZZ_NIP43_RECONCILE_INTERVAL_SECS * 4 + 20 ))
# 部署引导（ADR-11）只能在 Core 容器内执行：核验经 compose exec 进入同一个容器
export VERIFY_COMPOSE_FILE="$(pwd)/$local_dir/compose.yaml"
export VERIFY_COMPOSE_ENV_FILE="$(pwd)/$local_dir/.env"
