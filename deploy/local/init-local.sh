#!/usr/bin/env bash
# 本地拓扑的一次性入口：复用现有密钥、schema、Core 和 Tenant 引导脚本。
# 无参数补齐现有环境；--fresh --confirm-delete=platform-local 仅清空本 Compose 项目。
set -euo pipefail
cd "$(dirname "$0")"

usage() {
  echo '用法：./init-local.sh [--fresh --confirm-delete=platform-local]' >&2
  exit 2
}

fresh=false
case "${1:-}" in
  '') [ "$#" -eq 0 ] || usage ;;
  --fresh)
    [ "$#" -eq 2 ] && [ "$2" = '--confirm-delete=platform-local' ] || usage
    fresh=true ;;
  *) usage ;;
esac

[ -s .env ] || { echo '缺少 deploy/local/.env；先复制 .env.example 并填写' >&2; exit 2; }
set -a
. ./.env
set +a
: "${VERIFY_USER:?缺少 VERIFY_USER}"
: "${BOOTSTRAP_USER:?缺少 BOOTSTRAP_USER}"
: "${PLATFORM_ADMIN_USER:?缺少 PLATFORM_ADMIN_USER}"
[ "${BOOTSTRAP_USER,,}" != "${VERIFY_USER,,}" ] \
  && [ "${PLATFORM_ADMIN_USER,,}" != "${VERIFY_USER,,}" ] \
  && [ "${PLATFORM_ADMIN_USER,,}" != "${BOOTSTRAP_USER,,}" ] || {
  echo 'BOOTSTRAP_USER、VERIFY_USER 与 PLATFORM_ADMIN_USER 必须两两不同：一期不能在登录时选择 Tenant，Catalog admin 不得绑定业务 Tenant' >&2
  exit 2
}
: "${PLATFORM_CATALOG_TENANT_SLUG:?缺少 PLATFORM_CATALOG_TENANT_SLUG}"
: "${VERIFY_TENANT_SLUG:?缺少 VERIFY_TENANT_SLUG}"
: "${VERIFY_TENANT_NAME:?缺少 VERIFY_TENANT_NAME}"
: "${VERIFY_BOOTSTRAP_WAIT_SECONDS:?缺少 VERIFY_BOOTSTRAP_WAIT_SECONDS}"
: "${CORE_DB_PORT:?缺少 CORE_DB_PORT}"
: "${BUILDX_BUILDER:?必须选择有 cgroup CPU/内存限额的 BuildKit builder}"
[[ "$VERIFY_BOOTSTRAP_WAIT_SECONDS" =~ ^[1-9][0-9]*$ ]] || {
  echo 'VERIFY_BOOTSTRAP_WAIT_SECONDS 必须为正整数' >&2; exit 2;
}
for tool in sudo docker python3 curl; do
  command -v "$tool" >/dev/null || { echo "缺少 $tool" >&2; exit 2; }
done
# --fresh 的不可逆删除之前验证同一份部署输入。bootstrap 的校验模式不生成密钥、
# 不启动容器；正常启动时它还会再次校验，避免单独调用 bootstrap 绕开前提。
./bootstrap.sh --validate-config
project=$(sed -n 's/^name: //p' compose.yaml)
[ "$project" = platform-local ] || { echo 'Compose 项目名不是 platform-local，拒绝操作' >&2; exit 2; }

# 构建前检查现有编译任务与主机压力。真正的编译限额由 builder 容器 cgroup 执行；
# 只在宿主包一层 scope 不能约束 Docker daemon 中的构建进程。
if ps -eo comm= | grep -Eq '^(cargo|rustc|go|compile|link|buildx)$' \
  || ps -eo args= | grep -Eq '[d]ocker (compose|buildx) .*build'; then
  echo '已有编译或 Docker 构建任务，拒绝并行构建；稍后重试' >&2
  exit 2
fi
. ../../tools/container-safety.sh
container_safety_init
# 初始化的其他现有入口同样使用 sudo Docker；共享检查必须核验同一 daemon。
CONTAINER_DOCKER=(sudo -n --preserve-env=BUILDX_BUILDER docker)
CONTAINER_PRIVILEGE=(sudo -n)
container_resource_preflight
builder_receipt=$(container_require_limited_builder)
printf '%s\n' "$builder_receipt"
# 直接使用共享检查已核验的各节点预算，保留可用内存须大于 builder 限额的前提。
memory_limit=$(python3 - "$builder_receipt" <<'PY'
import json, sys
budgets = [json.loads(line.split(": ", 1)[1])["memory"]
           for line in sys.argv[1].splitlines() if line.startswith("容器限额 ")]
if not budgets:
    print("共享 builder 检查没有返回实际内存预算，拒绝构建", file=sys.stderr)
    sys.exit(2)
print(max(budgets))
PY
)
available_kib=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
[ "$((available_kib * 1024))" -gt "$memory_limit" ] || {
  echo '主机可用内存小于或等于 builder 限额，拒绝开始构建' >&2; exit 2;
}
: "${CHECK_CPUS:?执行配置必须提供 CHECK_CPUS}"
: "${CHECK_MEMORY:?执行配置必须提供 CHECK_MEMORY}"
recipe_digest=$(sha256sum ../../tools/check.Dockerfile | cut -d' ' -f1)
migration_image=$("${CONTAINER_DOCKER[@]}" image inspect --format '{{.Id}}' \
  "local/kailo-check:$recipe_digest" 2>/dev/null) || {
  echo '缺少当前 tools/check.Dockerfile 配方对应的固定检查镜像；先由现有检查入口准备' >&2
  exit 2
}
compose() { "${CONTAINER_DOCKER[@]}" compose --env-file .env -f compose.yaml "$@"; }

migrate_core_database() (
  database_container=$(compose ps -q core-db)
  [ -n "$database_container" ] || { echo 'Core 数据库容器不存在' >&2; exit 2; }
  database_network=$("${CONTAINER_DOCKER[@]}" inspect \
    --format '{{range .NetworkSettings.Networks}}{{println .NetworkID}}{{end}}' "$database_container")
  mapfile -t database_networks <<< "$database_network"
  [ "${#database_networks[@]}" -eq 1 ] && [ -n "${database_networks[0]}" ] || {
    echo 'Core 数据库没有唯一的实际私有网络，拒绝迁移' >&2; exit 2;
  }
  # 复用 bootstrap 的同一受控投递，不在宿主或 Docker 参数中另建连接串。
  IFS= read -r database_environment < secrets/core-db-url.env
  [[ "$database_environment" == DATABASE_URL=?* ]] || {
    echo 'Core 数据库连接投递缺失或为空，拒绝迁移' >&2; exit 2;
  }
  migrations=$(realpath -e ../../core/migrations)
  temporary_directory=$(mktemp -d)
  container_id=
  cleanup_migration() {
    result=$?
    trap - EXIT
    if [ -n "$container_id" ]; then
      "${CONTAINER_DOCKER[@]}" rm -f "$container_id" >/dev/null || {
        echo "无法清理本次迁移容器 $container_id" >&2; result=2;
      }
    fi
    rm -r -- "$temporary_directory" || result=2
    exit "$result"
  }
  trap cleanup_migration EXIT
  container_id=$("${CONTAINER_DOCKER[@]}" create --pull=never --interactive \
    --cpus "$CHECK_CPUS" --memory "$CHECK_MEMORY" --memory-swap "$CHECK_MEMORY" \
    --user "$(id -u):$(id -g)" --network "${database_networks[0]}" \
    --mount "type=bind,src=$migrations,dst=/migrations,readonly" \
    --mount "type=bind,src=$temporary_directory,dst=/tmp" \
    --env TMPDIR=/tmp "$migration_image" bash -ec \
    'IFS= read -r DATABASE_URL; export DATABASE_URL; exec sqlx migrate run --source /migrations')
  container_verify_limits "$container_id"
  attach_exit=0
  printf '%s\n' "${database_environment#DATABASE_URL=}" \
    | "${CONTAINER_DOCKER[@]}" start -ai "$container_id" || attach_exit=$?
  migration_state=$("${CONTAINER_DOCKER[@]}" inspect --format '{{.State.Status}}' "$container_id") || {
    echo '无法取得实际迁移容器状态，停止初始化' >&2; exit 2;
  }
  case "$migration_state" in
    running|exited|dead) ;;
    *) echo '迁移容器没有可等待的运行或终止状态，停止初始化' >&2; exit 2 ;;
  esac
  migration_exit=$("${CONTAINER_DOCKER[@]}" wait "$container_id") || {
    echo '未取得确定的迁移终态，停止初始化' >&2; exit 2;
  }
  [[ "$migration_exit" =~ ^[0-9]+$ ]] && [ "$migration_exit" -le 255 ] || {
    echo '迁移终态不是合法的进程退出码，停止初始化' >&2; exit 2;
  }
  [ "$attach_exit" -eq 0 ] || {
    echo "迁移 attach 退出 $attach_exit；容器终态退出 $migration_exit，停止初始化" >&2
    exit "$attach_exit"
  }
  exit "$migration_exit"
)

# 旧拓扑把 Keycloak 的 H2 放在容器层或挂在别的路径。直接重建该容器会换掉所有
# subject，Core 却仍保留旧 ExternalIdentity；拒绝把这种环境伪装成无损升级。
if ! "$fresh"; then
  keycloak_container=$(compose ps -q keycloak)
  if [ -n "$keycloak_container" ] && ! sudo -n docker inspect "$keycloak_container" \
      --format '{{range .Mounts}}{{.Destination}}{{println}}{{end}}' \
      | grep -Fxq '/opt/keycloak/data'; then
    echo '旧 Keycloak 容器没有持久数据卷；保留现有数据并停止，确认可删除后显式 --fresh 重建' >&2
    exit 2
  fi
fi

if "$fresh"; then
  echo '清空 platform-local 容器和本项目数据库卷，并清空本地 OpenBao、Buzz 对象和凭据。'
  echo '此操作不可恢复；保留 .env 和 data/registry 中的固定版本镜像。'
  for path in data secrets data/secret-store data/collab-objects; do
    [ ! -L "$path" ] || { echo "拒绝删除符号链接：$path" >&2; exit 2; }
  done
  compose down --volumes
  sudo -n rm -rf -- "$PWD/secrets" "$PWD/data/secret-store" "$PWD/data/collab-objects"
fi

./bootstrap.sh
compose config --quiet
compose up -d --wait core-db
migrate_core_database

compose up -d openbao
deadline=$(( $(date +%s) + VERIFY_BOOTSTRAP_WAIT_SECONDS ))
while :; do
  status=$(compose exec -T openbao bao status -format=json 2>/dev/null || true)
  [[ "$status" == *'"initialized"'* ]] && break
  [ "$(date +%s)" -lt "$deadline" ] || { echo 'OpenBao 启动超时' >&2; exit 2; }
  sleep 1
done
./secret-store-init.sh

# Compose 自己等待 health 与依赖任务；namespace/schema 作业还要查终态。
compose up -d --wait keycloak temporal spicedb buzz-relay
compose up -d --wait --no-build openmeter
./bootstrap.sh --sync-client-redirects
./bootstrap.sh --ensure-platform-admin
./bootstrap.sh --ensure-service-audience
export VERIFY_KEYCLOAK_ADMIN_PASSWORD_FILE="$PWD/secrets/keycloak_admin_password"
subject=$(../../core/verify/idp-subject.sh "$BOOTSTRAP_USER") || {
  echo '找不到首位管理员 IdP 用户；已有旧 realm 的本地环境须显式 --fresh 重建' >&2; exit 2;
}
[ -n "$subject" ] || { echo '首位管理员没有唯一 OIDC subject' >&2; exit 2; }
# 构建前取平台管理员 subject，IdP 侧缺人时不白等一次构建。
platform_subject=$(../../core/verify/idp-subject.sh "$PLATFORM_ADMIN_USER") || {
  echo '找不到平台管理员 IdP 用户' >&2; exit 2;
}
[ -n "$platform_subject" ] || { echo '平台管理员没有唯一 OIDC subject' >&2; exit 2; }
compose run --rm --no-deps temporal-namespace
compose run --rm --no-deps spicedb-schema

./start-core.sh
compose build worker
compose up -d --wait --no-build worker buzz-web agentgateway otel-collector
curl -fsS "http://127.0.0.1:${BFF_PORT:?缺少 BFF_PORT}/healthz" >/dev/null

compose exec -T core-bff /usr/local/bin/platform-core bootstrap-tenant \
  --slug "$VERIFY_TENANT_SLUG" --name "$VERIFY_TENANT_NAME" \
  --admin-subject "$subject" --admin-display-name "$BOOTSTRAP_USER" \
  --wait-seconds "$VERIFY_BOOTSTRAP_WAIT_SECONDS"
# Platform Catalog Tenant 由 Core 启动时以 PROVISIONING 与引导意图建立，名称即 slug；
# 此处经同一引导命令推进其生命周期并建立首位 admin（DD-96 的暂停/恢复发起者）。
# --name 只在 Tenant 不存在时使用，Catalog 此时必已存在，故传入与库中一致的 slug。
compose exec -T core-bff /usr/local/bin/platform-core bootstrap-tenant \
  --slug "$PLATFORM_CATALOG_TENANT_SLUG" --name "$PLATFORM_CATALOG_TENANT_SLUG" \
  --admin-subject "$platform_subject" --admin-display-name "$PLATFORM_ADMIN_USER" \
  --wait-seconds "$VERIFY_BOOTSTRAP_WAIT_SECONDS"
echo 'platform-local 已就绪；业务 Tenant 首位管理员为 BOOTSTRAP_USER，平台管理员为 PLATFORM_ADMIN_USER，走查用户为 VERIFY_USER；三份口令分别存于 secrets/。'
