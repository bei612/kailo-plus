#!/usr/bin/env bash
# 打印核验用户在 IdP 里的 subject。经 admin API 按用户名取回；口令从文件读入
# 进程内存，不进命令行、不进环境变量。由调用方先 source integration-env.sh。
set -euo pipefail
python3 - "$KEYCLOAK_PORT" "$OIDC_REALM" "$KEYCLOAK_ADMIN_USER" \
  "$VERIFY_KEYCLOAK_ADMIN_PASSWORD_FILE" "$VERIFY_USER" <<'PY'
import json, sys, urllib.parse, urllib.request
port, realm, admin, pw_file, user = sys.argv[1:]
base = f"http://127.0.0.1:{port}"
body = urllib.parse.urlencode({
    "grant_type": "password", "client_id": "admin-cli",
    "username": admin, "password": open(pw_file).read().strip(),
}).encode()
token = json.load(urllib.request.urlopen(
    f"{base}/realms/master/protocol/openid-connect/token", body))["access_token"]
req = urllib.request.Request(
    f"{base}/admin/realms/{realm}/users?exact=true&username={urllib.parse.quote(user)}",
    headers={"Authorization": f"Bearer {token}"})
users = json.load(urllib.request.urlopen(req))
if len(users) != 1:
    sys.exit(f"用户名 {user} 应恰好对应 1 个 IdP 用户，实际 {len(users)}")
print(users[0]["id"])
PY
