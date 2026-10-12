#!/usr/bin/env bash
# 打印指定用户在 IdP 里的 subject；省略参数时使用走查用户。经 admin API 按用户名取回；口令从文件读入
# 进程内存，不进命令行、不进环境变量。由调用方先 source integration-env.sh。
set -euo pipefail
user="${1:-$VERIFY_USER}"
python3 - "$OIDC_ISSUER" "$OIDC_HOST" "$KEYCLOAK_PORT" "$OIDC_REALM" "$KEYCLOAK_ADMIN_USER" \
  "$VERIFY_KEYCLOAK_ADMIN_PASSWORD_FILE" "$user" <<'PY'
import json, sys, urllib.parse, urllib.request
issuer, host, port, realm, admin, pw_file, user = sys.argv[1:]
try:
    origin = urllib.parse.urlsplit(issuer)
    valid = (origin.scheme == "http" and origin.hostname == host.lower()
             and str(origin.port) == port and 1 <= origin.port <= 65535
             and origin.path == "/realms/" + realm
             and not origin.username and not origin.password
             and not origin.query and not origin.fragment
             and not any(c.isspace() or ord(c) < 0x20 or c in (chr(92), chr(34), chr(39)) for c in issuer))
except ValueError:
    valid = False
if not valid:
    sys.exit("OIDC_ISSUER 与原本地主机、端口或 realm 不一致，拒绝读取用户")
base = urllib.parse.urlunsplit((origin.scheme, origin.netloc, "", "", ""))
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
