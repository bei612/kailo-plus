#!/usr/bin/env bash
# 取 Core/Worker 的服务令牌并打印到 stdout。
#
# Temporal 公开 frontend 启用了 default authorizer，无 claims 的非 health API
# 一律被拒（SF-TMP-06）。令牌由 OIDC 提供方以 client_credentials 签发，
# permissions 声明携带 "<namespace>:<role>"，namespace 取自 .env。
#
# 用法：export TEMPORAL_TOKEN="$(deploy/local/token.sh)"
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo "缺少 deploy/local/.env" >&2; exit 2; }
. ./.env
: "${KEYCLOAK_PORT:?}" "${OIDC_REALM:?}" "${OIDC_SERVICE_CLIENT_ID:?}"

secret_file=secrets/kailo_core_client_secret
[ -s "$secret_file" ] || { echo "缺少 $secret_file，先跑 ./bootstrap.sh" >&2; exit 2; }

curl -sSf -X POST \
  "http://127.0.0.1:${KEYCLOAK_PORT}/realms/${OIDC_REALM}/protocol/openid-connect/token" \
  -d grant_type=client_credentials \
  -d "client_id=${OIDC_SERVICE_CLIENT_ID}" \
  --data-urlencode "client_secret=$(cat "$secret_file")" \
| python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])'
