#!/usr/bin/env bash
# 启动（或重建）core-bff：现取三个 wrapped secret_id，再立即重建容器（DD-70）。
#
# Core 的引导凭据以 response wrapping 一次性投递：wrapping token 只能 unwrap 一次、
# 在 OPENBAO_SECRET_ID_WRAP_TTL 内有效，unwrap 出的 secret_id 只能登录一次。因此
# Core 的每一次启动都要一份新的投递——`docker compose restart/start core-bff`
# 会拿着已被消费的旧投递启动，Core 按泄漏处理并拒绝启动。
#
# 用法（deploy/local 下）：./start-core.sh；仅更换部署配置时 ./start-core.sh --no-build。
#
# 镜像先构建、投递后取：构建可能远长于 OPENBAO_SECRET_ID_WRAP_TTL，先取投递再构建，
# 投递在 Core 启动前就已过期。
set -euo pipefail
case "$#:$*" in
  0:) build=true ;;
  1:--no-build) build=false ;;
  *) echo '用法：start-core.sh [--no-build]' >&2; exit 2 ;;
esac
cd "$(dirname "$0")"
(cd ../.. && python3 tools/gen-registry.py --check)
. ./.env
: "${OPENBAO_PLATFORM_NAMESPACE:?}" "${OPENBAO_TENANT_PARENT_NAMESPACE:?}" \
  "${OPENBAO_TENANT_PROVISIONER_ROLE_NAME:?}" \
  "${OPENBAO_SECRET_ID_WRAP_TTL:?缺少 .env 中的 OPENBAO_SECRET_ID_WRAP_TTL}"
project=$(python3 -c 'import re,io;print(re.search(r"^name: (\S+)", io.open("compose.yaml",encoding="utf-8").read(), re.M).group(1))')
app_cidr=$(sudo -n docker network inspect "${project}_app" --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}')
[ -n "$app_cidr" ] || { echo "取不到 ${project}_app 网络子网，拒绝创建 Tenant AppRole" >&2; exit 2; }

# sudo 只保留受控构建器选择，避免 Core 镜像构建落到无 cgroup 限额的默认 builder。
compose() { sudo -n --preserve-env=BUILDX_BUILDER docker compose --env-file .env -f compose.yaml "$@"; }
root_token=$(python3 -c 'import json;print(json.load(open("secrets/openbao_init.json"))["root_token"])')
# 令牌经 stdin 进入容器，不上命令行（与 secret-store-init.sh 的 run_bao 同一做法）
run_bao() {
  local nsv=$1; shift
  local env=(-e BAO_ADDR=http://127.0.0.1:8200)
  [ -n "$nsv" ] && env+=(-e "BAO_NAMESPACE=$nsv")
  printf '%s\n' "$root_token" | compose exec -T "${env[@]}" openbao \
    sh -c 'IFS= read -r BAO_TOKEN; export BAO_TOKEN; exec bao "$@"' bao "$@"
}
wrapped() { # <namespace> <role> → wrapping token
  run_bao "$1" write -wrap-ttl="$OPENBAO_SECRET_ID_WRAP_TTL" -f -format=json "auth/approle/role/$2/secret-id" \
    | python3 -c 'import json,sys;print(json.load(sys.stdin)["wrap_info"]["token"])'
}

if [ "$build" = true ]; then
  compose build core-bff
fi

umask 077
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
{ printf 'OPENBAO_ROLE_ID=%s\n' "$(run_bao "$OPENBAO_PLATFORM_NAMESPACE" read -field=role_id auth/approle/role/platform-core/role-id)"
  printf 'OPENBAO_ROLE_NAME=platform-core\n'
  printf 'OPENBAO_WRAPPED_SECRET_ID=%s\n' "$(wrapped "$OPENBAO_PLATFORM_NAMESPACE" platform-core)"
  printf 'OPENBAO_AUDIT_ROLE_ID=%s\n' "$(run_bao "" read -field=role_id auth/approle/role/platform-core-audit/role-id)"
  printf 'OPENBAO_AUDIT_ROLE_NAME=platform-core-audit\n'
  printf 'OPENBAO_AUDIT_WRAPPED_SECRET_ID=%s\n' "$(wrapped "" platform-core-audit)"
  printf 'OPENBAO_TENANT_ROLE_ID=%s\n' "$(run_bao "$OPENBAO_TENANT_PARENT_NAMESPACE" read -field=role_id "auth/approle/role/${OPENBAO_TENANT_PROVISIONER_ROLE_NAME}/role-id")"
  printf 'OPENBAO_TENANT_ROLE_NAME=%s\n' "$OPENBAO_TENANT_PROVISIONER_ROLE_NAME"
  printf 'OPENBAO_TENANT_WRAPPED_SECRET_ID=%s\n' "$(wrapped "$OPENBAO_TENANT_PARENT_NAMESPACE" "$OPENBAO_TENANT_PROVISIONER_ROLE_NAME")"
  printf 'OPENBAO_TENANT_CORE_BOUND_CIDRS=%s\n' "$app_cidr"; } > "$tmp"
# 十行都非空才落位：半份投递会让 Core 以「缺少某项」退出，却看不出是投递失败
[ "$(grep -c '=.\+' "$tmp")" = 10 ] || { echo "投递不完整，未改动 secrets/openbao-core.env" >&2; exit 2; }
mv "$tmp" secrets/openbao-core.env
trap - EXIT

compose up -d --no-deps --force-recreate --no-build core-bff
