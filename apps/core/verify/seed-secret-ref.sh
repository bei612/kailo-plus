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
: "${OPENBAO_PLATFORM_NAMESPACE:?}" "${OPENBAO_KV_MOUNT:?}"

root_token=$(python3 -c 'import json;print(json.load(open("secrets/openbao_init.json"))["root_token"])')
ns() {
  sudo -n docker compose --env-file .env -f compose.yaml exec -T \
    -e BAO_ADDR=http://127.0.0.1:8200 -e BAO_TOKEN="$root_token" \
    -e BAO_NAMESPACE="$OPENBAO_PLATFORM_NAMESPACE" openbao bao "$@"
}

ns kv put "${OPENBAO_KV_MOUNT}/verify/secret-ref" value=v1 >/dev/null
ns kv put "${OPENBAO_KV_MOUNT}/verify/secret-ref" value=v2 >/dev/null
printf '已写入 %s/%s/verify/secret-ref 的版本 1 与 2\n' \
  "$OPENBAO_PLATFORM_NAMESPACE" "$OPENBAO_KV_MOUNT"
