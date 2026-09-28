#!/usr/bin/env bash
# Kailo 本地拓扑的一次性入口：复用现有密钥、schema、Core 和 Tenant 引导脚本。
# 无参数补齐现有环境；--fresh --confirm-delete=kailo-local 仅清空本 Compose 项目。
set -euo pipefail
cd "$(dirname "$0")"

usage() {
  echo '用法：./init-local.sh [--fresh --confirm-delete=kailo-local]' >&2
  exit 2
}

fresh=false
case "${1:-}" in
  '') [ "$#" -eq 0 ] || usage ;;
  --fresh)
    [ "$#" -eq 2 ] && [ "$2" = '--confirm-delete=kailo-local' ] || usage
    fresh=true ;;
  *) usage ;;
esac

[ -s .env ] || { echo '缺少 deploy/local/.env；先复制 .env.example 并填写' >&2; exit 2; }
set -a
. ./.env
set +a
: "${VERIFY_USER:?缺少 VERIFY_USER}"
: "${BOOTSTRAP_USER:?缺少 BOOTSTRAP_USER}"
[ "$BOOTSTRAP_USER" != "$VERIFY_USER" ] || {
  echo 'BOOTSTRAP_USER 与 VERIFY_USER 必须不同：一期不能在登录时选择 Tenant' >&2; exit 2;
}
: "${VERIFY_TENANT_SLUG:?缺少 VERIFY_TENANT_SLUG}"
: "${VERIFY_TENANT_NAME:?缺少 VERIFY_TENANT_NAME}"
: "${VERIFY_BOOTSTRAP_WAIT_SECONDS:?缺少 VERIFY_BOOTSTRAP_WAIT_SECONDS}"
: "${CORE_DB_PORT:?缺少 CORE_DB_PORT}"
: "${BUILDX_BUILDER:?必须选择有 cgroup CPU/内存限额的 BuildKit builder}"
[[ "$VERIFY_BOOTSTRAP_WAIT_SECONDS" =~ ^[1-9][0-9]*$ ]] || {
  echo 'VERIFY_BOOTSTRAP_WAIT_SECONDS 必须为正整数' >&2; exit 2;
}
for tool in sudo docker sqlx python3 curl; do
  command -v "$tool" >/dev/null || { echo "缺少 $tool" >&2; exit 2; }
done
# --fresh 的不可逆删除之前验证同一份部署输入。bootstrap 的校验模式不生成密钥、
# 不启动容器；正常启动时它还会再次校验，避免单独调用 bootstrap 绕开前提。
./bootstrap.sh --validate-config
project=$(sed -n 's/^name: //p' compose.yaml)
[ "$project" = kailo-local ] || { echo 'Compose 项目名不是 kailo-local，拒绝操作' >&2; exit 2; }

# 构建前检查现有编译任务与主机压力。真正的编译限额由 builder 容器 cgroup 执行；
# 只在宿主包一层 scope 不能约束 Docker daemon 中的构建进程。
if ps -eo comm= | grep -Eq '^(cargo|rustc|go|compile|link|buildx)$' \
  || ps -eo args= | grep -Eq '[d]ocker (compose|buildx) .*build'; then
  echo '已有编译或 Docker 构建任务，拒绝并行构建；稍后重试' >&2
  exit 2
fi
printf '构建前压力：\n'
uptime
grep '^MemAvailable:' /proc/meminfo
awk 'FNR == 1 { print FILENAME, $0 }' /proc/pressure/cpu /proc/pressure/memory
builder_container="buildx_buildkit_${BUILDX_BUILDER}0"
limits=$(sudo -n docker inspect "$builder_container" \
  --format '{{.State.Running}} {{.HostConfig.Memory}} {{.HostConfig.NanoCpus}} {{.HostConfig.CpuQuota}}' 2>/dev/null) || {
  echo "找不到受限 builder 容器 $builder_container" >&2; exit 2;
}
read -r running memory_limit nano_cpus cpu_quota <<< "$limits"
[ "$running" = true ] && [ "$memory_limit" -gt 0 ] && {
  [ "$nano_cpus" -gt 0 ] || [ "$cpu_quota" -gt 0 ]; } || {
  echo 'BuildKit builder 未运行或缺少内存/CPU cgroup 限额' >&2; exit 2;
}
available_kib=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
[ "$((available_kib * 1024))" -gt "$memory_limit" ] || {
  echo '主机可用内存小于 builder 限额，拒绝开始构建' >&2; exit 2;
}
compose() { sudo -n --preserve-env=BUILDX_BUILDER docker compose --env-file .env -f compose.yaml "$@"; }

# 旧拓扑把 Keycloak 的 H2 放在容器层。直接重建该容器会换掉所有 subject，
# Core 却仍保留旧 ExternalIdentity；拒绝把这种环境伪装成无损升级。
if ! "$fresh"; then
  keycloak_container=$(compose ps -q keycloak)
  if [ -n "$keycloak_container" ] && ! sudo -n docker inspect "$keycloak_container" \
      --format '{{range .Mounts}}{{.Destination}}{{println}}{{end}}' \
      | grep -Fxq '/opt/keycloak/data/h2'; then
    echo '旧 Keycloak 容器没有持久数据卷；保留现有数据并停止，确认可删除后显式 --fresh 重建' >&2
    exit 2
  fi
fi

if "$fresh"; then
  echo '清空 kailo-local 容器和五个数据库卷，并清空本地 OpenBao、Buzz 对象和凭据。'
  echo '此操作不可恢复；保留 .env 和 data/registry 中的固定版本镜像。'
  for path in data secrets data/openbao data/buzz-objects; do
    [ ! -L "$path" ] || { echo "拒绝删除符号链接：$path" >&2; exit 2; }
  done
  compose down --volumes
  sudo -n rm -rf -- "$PWD/secrets" "$PWD/data/openbao" "$PWD/data/buzz-objects"
fi

./bootstrap.sh
compose config --quiet
compose up -d --wait core-db
core_db_password=$(<secrets/core_db_password)
host_database_url="postgres://${CORE_DB_USER}:${core_db_password}@127.0.0.1:${CORE_DB_PORT}/${CORE_DB_NAME}"
unset core_db_password
DATABASE_URL="$host_database_url" sqlx migrate run --source ../../core/migrations
unset host_database_url

compose up -d openbao
deadline=$(( $(date +%s) + VERIFY_BOOTSTRAP_WAIT_SECONDS ))
while :; do
  status=$(compose exec -T openbao bao status -format=json 2>/dev/null || true)
  [[ "$status" == *'"initialized"'* ]] && break
  [ "$(date +%s)" -lt "$deadline" ] || { echo 'OpenBao 启动超时' >&2; exit 2; }
  sleep 1
done
./openbao-init.sh

# Compose 自己等待 health 与依赖任务；namespace/schema 作业还要查终态。
compose up -d --wait keycloak temporal spicedb buzz-relay
export VERIFY_KEYCLOAK_ADMIN_PASSWORD_FILE="$PWD/secrets/keycloak_admin_password"
subject=$(../../core/verify/idp-subject.sh "$BOOTSTRAP_USER") || {
  echo '找不到首位管理员 IdP 用户；已有旧 realm 的本地环境须显式 --fresh 重建' >&2; exit 2;
}
[ -n "$subject" ] || { echo '首位管理员没有唯一 OIDC subject' >&2; exit 2; }
compose run --rm --no-deps temporal-namespace
compose run --rm --no-deps spicedb-schema

./start-core.sh
compose build worker
compose up -d --no-deps --no-build worker buzz-web agentgateway otel-collector
curl -fsS "http://127.0.0.1:${BFF_PORT:?缺少 BFF_PORT}/healthz" >/dev/null

compose exec -T core-bff /usr/local/bin/kailo-core bootstrap-tenant \
  --slug "$VERIFY_TENANT_SLUG" --name "$VERIFY_TENANT_NAME" \
  --admin-subject "$subject" --admin-display-name "$BOOTSTRAP_USER" \
  --wait-seconds "$VERIFY_BOOTSTRAP_WAIT_SECONDS"
echo 'kailo-local 已就绪；首位管理员为 BOOTSTRAP_USER，走查用户为 VERIFY_USER；两份口令分别存于 secrets/。'
