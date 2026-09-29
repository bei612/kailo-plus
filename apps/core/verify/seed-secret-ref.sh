#!/usr/bin/env bash
# SecretRef 解析核验的夹具：在平台 namespace 的 KV v2 上写两个版本。
#
# 两个版本是必需的，不是凑数：核验要断言「取到的正是请求的那个版本」，
# 只有一个版本时该断言恒真，等于没验。值取 v1/v2 便于断言区分。
#
# 这是核验夹具，不是产品数据路径。真实的 secret 写入是受治理动作，
# 由 BFF 在同一 Governed Action 内以 Core 的 service token 完成
# （.design/03 §9），不经本脚本。
set -euo pipefail
cd "$(dirname "$0")/../../deploy/local"
. ./.env
: "${OPENBAO_PLATFORM_NAMESPACE:?}" "${OPENBAO_TENANT_PARENT_NAMESPACE:?}" \
  "${OPENBAO_TENANT_VERIFY_ROLE_NAME:?}" "${OPENBAO_KV_MOUNT:?}"

root_token=$(python3 -c 'import json;print(json.load(open("secrets/openbao_init.json"))["root_token"])')
# 令牌经 stdin 进入容器，不上命令行（与 secret-store-init.sh 同一做法）
ns() {
  printf '%s\n' "$root_token" | sudo -n docker compose --env-file .env -f compose.yaml exec -T \
    -e BAO_ADDR=http://127.0.0.1:8200 -e BAO_NAMESPACE="$OPENBAO_PLATFORM_NAMESPACE" openbao \
    sh -c 'IFS= read -r BAO_TOKEN; export BAO_TOKEN; exec bao "$@"' bao "$@"
}
tenant_parent() {
  printf '%s\n' "$root_token" | sudo -n docker compose --env-file .env -f compose.yaml exec -T \
    -e BAO_ADDR=http://127.0.0.1:8200 -e BAO_NAMESPACE="$OPENBAO_TENANT_PARENT_NAMESPACE" openbao \
    sh -c 'IFS= read -r BAO_TOKEN; export BAO_TOKEN; exec bao "$@"' bao "$@"
}

# 写两版并把版本号回传给核验用例。
#
# 不假设它们是 1 和 2：KV v2 会按 max_versions 裁掉旧版本，同一路径反复写之后
# 最旧可读版本会往后移。断言「版本 1 可读」在跑够次数后必然失败，而那看起来
# 像 SecretRef 解析坏了——实际是版本已被裁掉（见 core/verify/secret-ref.md）。
secret_path="${OPENBAO_KV_MOUNT}/verify/secret-ref"
if metadata=$(ns kv metadata get -format=json "$secret_path" 2>/dev/null); then
  current_version=$(printf '%s' "$metadata" | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"]["current_version"])')
else
  # 首次写入用 KV v2 的 cas=0；权限或依赖失败时后续写入仍会被 OpenBao 拒绝。
  current_version=0
fi
v1=$(ns kv put -cas="$current_version" -format=json "$secret_path" value=v1 \
     | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"]["version"])')
v2=$(ns kv put -cas="$v1" -format=json "$secret_path" value=v2 \
     | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"]["version"])')
printf 'VERIFY_SECRET_VERSION_V1=%s\nVERIFY_SECRET_VERSION_V2=%s\n' "$v1" "$v2"

# SecretStore 的真实投递路径：platform-verify 与 platform-core 同策略、同样单次使用并以
# response wrapping 投递，只是不绑 CIDR——核验跑在宿主上（secret-store-init.sh）。
# wrapping token 在 OPENBAO_SECRET_ID_WRAP_TTL 内由 secret-store 的核验消费。
: "${OPENBAO_SECRET_ID_WRAP_TTL:?}"
printf 'OPENBAO_ROLE_ID=%s\n' "$(ns read -field=role_id auth/approle/role/platform-verify/role-id)"
printf 'OPENBAO_ROLE_NAME=platform-verify\n'
printf 'OPENBAO_WRAPPED_SECRET_ID=%s\n' "$(ns write -wrap-ttl="$OPENBAO_SECRET_ID_WRAP_TTL" -f -format=json auth/approle/role/platform-verify/secret-id \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["wrap_info"]["token"])')"

# SecretStore 在取用平台 KV 前也必须验证 Tenant provisioner 已取得一次性凭据。
# 宿主集成用的 role 与 Core provisioner 同策略，但不带容器网络 CIDR 限制。
printf 'OPENBAO_TENANT_ROLE_ID=%s\n' "$(tenant_parent read -field=role_id "auth/approle/role/${OPENBAO_TENANT_VERIFY_ROLE_NAME}/role-id")"
printf 'OPENBAO_TENANT_ROLE_NAME=%s\n' "$OPENBAO_TENANT_VERIFY_ROLE_NAME"
printf 'OPENBAO_TENANT_WRAPPED_SECRET_ID=%s\n' "$(tenant_parent write -wrap-ttl="$OPENBAO_SECRET_ID_WRAP_TTL" -f -format=json "auth/approle/role/${OPENBAO_TENANT_VERIFY_ROLE_NAME}/secret-id" \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["wrap_info"]["token"])')"
