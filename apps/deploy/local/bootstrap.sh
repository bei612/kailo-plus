#!/usr/bin/env bash
# 生成本地开发用 secret。开发用 secret 也经受控投递面取得，
# 不在仓库、环境文件或脚本中出现明文（07-运行与运维基线.md §2）。
# 本脚本只生成随机值并写入 gitignore 的目录，不接受人工传入的口令。
set -euo pipefail
cd "$(dirname "$0")"

[ -s .env ] || { echo '缺少 deploy/local/.env' >&2; exit 2; }
. ./.env
: "${OIDC_ISSUER:?缺少 OIDC_ISSUER}" "${OIDC_REALM:?缺少 OIDC_REALM}" \
  "${PUBLIC_ORIGIN:?缺少 PUBLIC_ORIGIN}" "${PUBLIC_HOST:?缺少 PUBLIC_HOST}" \
  "${OIDC_HOST:?缺少 OIDC_HOST}" "${BUZZ_RELAY_HOST:?缺少 BUZZ_RELAY_HOST}" \
  "${BUZZ_RELAY_PORT:?缺少 BUZZ_RELAY_PORT}" "${AGENTGATEWAY_PORT:?缺少 AGENTGATEWAY_PORT}" \
  "${KEYCLOAK_PORT:?缺少 KEYCLOAK_PORT}" \
  "${CORE_DB_PORT:?缺少 CORE_DB_PORT}" \
  "${CORE_DB_USER:?缺少 CORE_DB_USER}" "${CORE_DB_NAME:?缺少 CORE_DB_NAME}"
# 本地拓扑导入 Keycloak realm；issuer 的 realm 必须与导入对象完全相同。
# PUBLIC_ORIGIN 是浏览器入口的唯一根地址，回调与邀请页均从它派生。
OIDC_ISSUER="$OIDC_ISSUER" OIDC_REALM="$OIDC_REALM" PUBLIC_ORIGIN="$PUBLIC_ORIGIN" \
PUBLIC_HOST="$PUBLIC_HOST" OIDC_HOST="$OIDC_HOST" BUZZ_RELAY_HOST="$BUZZ_RELAY_HOST" \
BUZZ_RELAY_PORT="$BUZZ_RELAY_PORT" AGENTGATEWAY_PORT="$AGENTGATEWAY_PORT" \
KEYCLOAK_PORT="$KEYCLOAK_PORT" CORE_DB_USER="$CORE_DB_USER" CORE_DB_NAME="$CORE_DB_NAME" \
CORE_DB_PORT="$CORE_DB_PORT" \
PLATFORM_DISPLAY_NAME="${PLATFORM_DISPLAY_NAME:-}" \
python3 - <<'PYCONFIG'
import os
import re
from urllib.parse import urlsplit

if not os.environ["PLATFORM_DISPLAY_NAME"].strip():
    raise SystemExit("PLATFORM_DISPLAY_NAME 不能为空或仅含空白")

def invalid_chars(raw):
    return any(c.isspace() or ord(c) < 0x20 or c in (chr(92), chr(34), chr(39)) for c in raw)

def host(name):
    raw = os.environ[name]
    if invalid_chars(raw):
        raise SystemExit(f"{name} 含无效字符")
    try:
        value = urlsplit("http://" + raw)
        port = value.port
    except ValueError:
        raise SystemExit(f"{name} 不是有效主机名") from None
    if (not value.hostname or value.netloc != raw or port is not None
            or value.path or value.query or value.fragment or value.username):
        raise SystemExit(f"{name} 必须是单一主机名，不含端口、路径或凭据")
    return value.hostname

def checked_port(name):
    raw = os.environ[name]
    try:
        port = int(raw)
    except ValueError:
        raise SystemExit(f"{name} 必须是有效端口") from None
    if not 1 <= port <= 65535 or str(port) != raw:
        raise SystemExit(f"{name} 必须是 1..65535 的十进制端口")
    return port

realm = os.environ["OIDC_REALM"]
if not realm or invalid_chars(realm) or any(c in realm for c in "/?#%"):
    raise SystemExit("OIDC_REALM 必须是单个 URL path segment")
for name, expected_path, host_name, port_name in (
        ("OIDC_ISSUER", "/realms/" + realm, "OIDC_HOST", "KEYCLOAK_PORT"),
        ("PUBLIC_ORIGIN", "", "PUBLIC_HOST", "AGENTGATEWAY_PORT")):
    raw = os.environ[name]
    if invalid_chars(raw):
        raise SystemExit(f"{name} 含无效字符")
    try:
        value = urlsplit(raw)
        port = value.port
    except ValueError:
        raise SystemExit(f"{name} 不是有效 URL") from None
    if (value.scheme != "http" or not value.hostname
            or value.username or value.password or value.query or value.fragment
            or value.path != expected_path or port != checked_port(port_name)
            or value.hostname != host(host_name)):
        raise SystemExit(f"{name} 的 scheme、authority、host 或 path 与本地拓扑不符")
host("BUZZ_RELAY_HOST")
checked_port("BUZZ_RELAY_PORT")
checked_port("CORE_DB_PORT")
for name in ("CORE_DB_USER", "CORE_DB_NAME"):
    if not re.fullmatch(r"[A-Za-z0-9_-]+", os.environ[name]):
        raise SystemExit(f"{name} 不适合 PostgreSQL URL")
PYCONFIG
# 三个 IdP 用户各自只属于一个 Tenant：一期同一 HumanIdentity 在多个 Tenant 有
# ACTIVE membership 时登录被拒（TENANT_SELECTION_NOT_AVAILABLE），Catalog admin 也
# 不得绑定业务 Tenant（DD-96）。Keycloak 用户名不区分大小写，按小写比较。
: "${VERIFY_USER:?缺少 VERIFY_USER}" "${BOOTSTRAP_USER:?缺少 BOOTSTRAP_USER}" \
  "${PLATFORM_ADMIN_USER:?缺少 PLATFORM_ADMIN_USER}"
[ "${BOOTSTRAP_USER,,}" != "${VERIFY_USER,,}" ] \
  && [ "${PLATFORM_ADMIN_USER,,}" != "${VERIFY_USER,,}" ] \
  && [ "${PLATFORM_ADMIN_USER,,}" != "${BOOTSTRAP_USER,,}" ] || {
  echo 'BOOTSTRAP_USER、VERIFY_USER 与 PLATFORM_ADMIN_USER 必须两两不同：一期不能在登录时选择 Tenant，Catalog admin 不得绑定业务 Tenant' >&2
  exit 2
}
if [ "${1:-}" = '--validate-config' ] && [ "$#" -eq 1 ]; then
  exit 0
fi
# 持久化 realm 不会再次导入 JSON。只同步已有浏览器客户端的回调，不重建用户、
# client 或 credential；HTTP 结果不明时退出失败，重跑先读当前值再收敛。
if [ "${1:-}" = '--sync-browser-client' ] && [ "$#" -eq 1 ]; then
  python3 - "$KEYCLOAK_PORT" "$OIDC_REALM" "${KEYCLOAK_ADMIN_USER:?}" \
    "${OIDC_BROWSER_CLIENT_ID:?}" "$PUBLIC_ORIGIN" "${VERIFY_BOOTSTRAP_WAIT_SECONDS:?}" <<'PYSYNC'
import json
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request

port, realm, admin, client_id, origin, timeout = sys.argv[1:]
timeout = int(timeout)
if timeout <= 0:
    raise SystemExit("VERIFY_BOOTSTRAP_WAIT_SECONDS 必须为正整数")
base = "http://127.0.0.1:" + port
desired = {"redirectUris": [origin + "/oauth/callback"], "webOrigins": ["+"]}
try:
    password = pathlib.Path("secrets/keycloak_admin_password").read_text().strip()
    login = urllib.parse.urlencode({"grant_type": "password", "client_id": "admin-cli",
                                   "username": admin, "password": password}).encode()
    with urllib.request.urlopen(base + "/realms/master/protocol/openid-connect/token",
                                login, timeout=timeout) as response:
        token = json.load(response)["access_token"]

    def request(path, body=None):
        req = urllib.request.Request(base + path,
            data=json.dumps(body).encode() if body is not None else None,
            method="PUT" if body is not None else "GET",
            headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return json.load(response) if body is None else None

    clients_path = "/admin/realms/" + urllib.parse.quote(realm, safe="") + "/clients"
    clients = request(clients_path + "?" + urllib.parse.urlencode({"clientId": client_id}))
    if len(clients) != 1 or clients[0].get("clientId") != client_id:
        raise SystemExit("浏览器客户端不存在或不唯一，拒绝创建替代身份")
    path = clients_path + "/" + urllib.parse.quote(clients[0]["id"], safe="")
    current = request(path)
    changed = any(current.get(key) != value for key, value in desired.items())
    if changed:
        # 只发送这两项，其他 client 属性、protocol mapper 与 secret 均不投递。
        request(path, desired)
    confirmed = request(path)
    if any(confirmed.get(key) != value for key, value in desired.items()):
        raise SystemExit("浏览器客户端回调回读不一致，初始化未完成")
    print("浏览器客户端回调已同步并查证" if changed else "浏览器客户端回调已一致，无需更新")
except (urllib.error.URLError, OSError, ValueError, KeyError, TypeError):
    raise SystemExit("浏览器客户端同步未完成；修复 IdP 连接或配置后重跑查证，不重建 realm") from None
PYSYNC
  exit 0
fi
# 持久化 realm 同样不会因导入文件新增平台管理员。只按用户名补齐这一个用户：
# 恰好 0 个则按 realm 模板中的同一条定义创建，恰好 1 个不改动，多于 1 个拒绝；
# 其他用户、client、角色与 mapper 不读不写。口令只从文件读入进程内存并放进请求体。
if [ "${1:-}" = '--ensure-platform-admin' ] && [ "$#" -eq 1 ]; then
  python3 - "$KEYCLOAK_PORT" "$OIDC_REALM" "${KEYCLOAK_ADMIN_USER:?}" \
    "$PLATFORM_ADMIN_USER" "${VERIFY_BOOTSTRAP_WAIT_SECONDS:?}" <<'PYADMIN'
import copy
import json
import pathlib
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

port, realm, admin, username, timeout = sys.argv[1:]
timeout = int(timeout)
if timeout <= 0:
    raise SystemExit("VERIFY_BOOTSTRAP_WAIT_SECONDS 必须为正整数")
base = "http://127.0.0.1:" + port
users_path = "/admin/realms/" + urllib.parse.quote(realm, safe="") + "/users"
lookup = users_path + "?" + urllib.parse.urlencode({"exact": "true", "username": username})
try:
    template = json.loads(pathlib.Path("keycloak/kailo-realm.json").read_text(encoding="utf-8"))
    entries = [u for u in template.get("users", []) if u.get("username") == "__PLATFORM_ADMIN_USER__"]
    if len(entries) != 1:
        raise SystemExit("realm 模板中平台管理员定义不存在或不唯一")
    secret_file = pathlib.Path("secrets/platform_admin_password")
    if not secret_file.is_file() or not secret_file.read_text().strip():
        raise SystemExit("缺少 secrets/platform_admin_password；先运行 bootstrap.sh 生成")
    password = pathlib.Path("secrets/keycloak_admin_password").read_text().strip()
    login = urllib.parse.urlencode({"grant_type": "password", "client_id": "admin-cli",
                                   "username": admin, "password": password}).encode()
    with urllib.request.urlopen(base + "/realms/master/protocol/openid-connect/token",
                                login, timeout=timeout) as response:
        token = json.load(response)["access_token"]

    def request(path, body=None):
        req = urllib.request.Request(base + path,
            data=json.dumps(body).encode() if body is not None else None,
            method="POST" if body is not None else "GET",
            headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return json.load(response) if body is None else None

    found = request(lookup)
    if len(found) > 1:
        raise SystemExit("平台管理员用户名对应多个 IdP 用户，拒绝选择")
    created = not found
    if created:
        user = copy.deepcopy(entries[0])
        user["username"] = username
        user["credentials"] = [{"type": "password", "temporary": False,
                                "value": secret_file.read_text().strip()}]
        if re.search(r"__[A-Z][A-Z_]*__", json.dumps(user)):
            raise SystemExit("平台管理员定义中还有未替换的占位符")
        try:
            request(users_path, user)
        except urllib.error.HTTPError as error:
            # 409 表示同名用户已被并发建立；由下面的回读判定是否恰好一个。
            if error.code != 409:
                raise
    confirmed = request(lookup)
    if len(confirmed) != 1:
        raise SystemExit("平台管理员回读不是恰好 1 个 IdP 用户，初始化未完成")
    if not confirmed[0].get("enabled"):
        raise SystemExit("平台管理员 IdP 用户已停用；入口不重新启用它")
    print("平台管理员 IdP 用户已创建并查证" if created else "平台管理员 IdP 用户已存在，未改动")
except (urllib.error.URLError, OSError, ValueError, KeyError, TypeError):
    raise SystemExit("平台管理员补齐未完成；修复 IdP 连接或配置后重跑查证，不重建 realm") from None
PYADMIN
  exit 0
fi
[ "$#" -eq 0 ] || { echo 'bootstrap.sh 不接受该参数' >&2; exit 2; }
OIDC_REDIRECT_URI="${PUBLIC_ORIGIN}/oauth/callback"
RELAY_OPERATOR_API_ORIGIN="http://${BUZZ_RELAY_HOST}:${BUZZ_RELAY_PORT}"

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
# Compose 会在启动单个 registry 服务时解析其它服务的 env_file，因此该投递文件
# 必须在首次 compose 调用之前存在；它由唯一的 DB 输入与已有 secret 派生。
. ./database-url.sh
core_database_dsn="$(core_database_url core-db:5432)"
printf 'DATABASE_URL=%s\n' "$core_database_dsn" > secrets/core-db-url.env
chmod 600 secrets/core-db-url.env
unset core_database_dsn
printf '  已生成：secrets/core-db-url.env\n'
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
mkdir -p data/registry
if [ ! -s secrets/relay_operator_pubkey ] || [ ! -s secrets/relay_operator_private_key ]; then
  # 取 Relay 服务实际运行的镜像（补丁构建，按 digest 存于本地 registry），
  # 而不是另写一个镜像名：两处脱节时生成密钥的与运行的就不是同一份二进制。
  # 由 Compose 自己解析同一份 .env 与 image 字段；手写 dotenv 解析器读到
  # ${HOST} 这类派生值时只会得到未展开的字符串，不能拿来启动容器。
  # --images 在目标服务与依赖上解析镜像，不要求此时尚未生成的其它 env_file；
  # --format json 会扫描全模型并在首次生成 operator key 前因那些文件缺失而失败。
  relay_image=$(sudo -n docker compose --env-file .env -f compose.yaml \
    config --no-env-resolution --images buzz-relay \
    | REGISTRY_HOST="$REGISTRY_HOST" python3 -c '
import os, sys
prefix = os.environ["REGISTRY_HOST"] + "/upstream-buzz@sha256:"
images = {line.strip() for line in sys.stdin if line.strip().startswith(prefix)}
if len(images) != 1:
    raise SystemExit("Compose 未提供唯一的 Buzz Relay 定版镜像")
print(next(iter(images)))')
  sudo -n docker compose --env-file .env -f compose.yaml up -d registry >/dev/null
  kp=$(sudo -n docker run --rm --entrypoint /usr/local/bin/buzz-admin \
        "$relay_image" generate-key 2>/dev/null | grep -E "^(Public|Secret) key:")
  printf '%s' "$kp" | awk '/Public/{print $3}' | tr -d '\n' > secrets/relay_operator_pubkey
  printf '%s' "$kp" | awk '/Secret/{print $3}' | tr -d '\n' > secrets/relay_operator_private_key
  chmod 600 secrets/relay_operator_pubkey secrets/relay_operator_private_key
  printf '  已生成：RelayOperatorIdentity 密钥对\n'
else
  printf '  已存在，保留：RelayOperatorIdentity 密钥对\n'
fi
gen verify_user_password
gen bootstrap_user_password
gen platform_admin_password

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
: "${TEMPORAL_NAMESPACE:?bootstrap 需要 .env 中的 TEMPORAL_NAMESPACE}"
# 渲染在进程内完成：secret 从文件读入内存，不经命令行——`sed "s|…|$(cat …)|"`
# 会把每个 client secret 与核验口令都摆进进程表，任何能 ps 的人都看得见。
: "${OIDC_REDIRECT_URI:?bootstrap 需要从 PUBLIC_ORIGIN 派生的 OIDC_REDIRECT_URI}"
: "${OIDC_REALM:?bootstrap 需要 .env 中的 OIDC_REALM}"
: "${OIDC_SERVICE_CLIENT_ID:?bootstrap 需要 .env 中的 OIDC_SERVICE_CLIENT_ID}"
: "${OIDC_WORKER_CLIENT_ID:?bootstrap 需要 .env 中的 OIDC_WORKER_CLIENT_ID}"
: "${OIDC_BROWSER_CLIENT_ID:?bootstrap 需要 .env 中的 OIDC_BROWSER_CLIENT_ID}"
: "${OIDC_NATIVE_CLIENT_ID:?bootstrap 需要 .env 中的 OIDC_NATIVE_CLIENT_ID}"
: "${OIDC_NATIVE_AUDIENCE:?bootstrap 需要 .env 中的 OIDC_NATIVE_AUDIENCE}"
: "${OIDC_NATIVE_MOBILE_REDIRECT_URI:?bootstrap 需要 .env 中的 OIDC_NATIVE_MOBILE_REDIRECT_URI}"
TEMPORAL_NAMESPACE="$TEMPORAL_NAMESPACE" VERIFY_USER="$VERIFY_USER" \
BOOTSTRAP_USER="$BOOTSTRAP_USER" PLATFORM_ADMIN_USER="$PLATFORM_ADMIN_USER" \
OIDC_REALM="$OIDC_REALM" OIDC_SERVICE_CLIENT_ID="$OIDC_SERVICE_CLIENT_ID" \
OIDC_WORKER_CLIENT_ID="$OIDC_WORKER_CLIENT_ID" OIDC_BROWSER_CLIENT_ID="$OIDC_BROWSER_CLIENT_ID" \
OIDC_REDIRECT_URI="$OIDC_REDIRECT_URI" OIDC_NATIVE_CLIENT_ID="$OIDC_NATIVE_CLIENT_ID" \
OIDC_NATIVE_AUDIENCE="$OIDC_NATIVE_AUDIENCE" \
OIDC_NATIVE_MOBILE_REDIRECT_URI="$OIDC_NATIVE_MOBILE_REDIRECT_URI" python3 - <<'RENDER'
import json
import os
from_file = {
    "__KAILO_CORE_CLIENT_SECRET__": "secrets/kailo_core_client_secret",
    "__KAILO_WORKER_CLIENT_SECRET__": "secrets/kailo_worker_client_secret",
    "__BROWSER_CLIENT_SECRET__": "secrets/browser_client_secret",
    "__VERIFY_USER_PASSWORD__": "secrets/verify_user_password",
    "__BOOTSTRAP_USER_PASSWORD__": "secrets/bootstrap_user_password",
    "__PLATFORM_ADMIN_USER_PASSWORD__": "secrets/platform_admin_password",
}
from_env = ["TEMPORAL_NAMESPACE", "VERIFY_USER", "BOOTSTRAP_USER", "PLATFORM_ADMIN_USER", "OIDC_REALM",
            "OIDC_SERVICE_CLIENT_ID", "OIDC_WORKER_CLIENT_ID", "OIDC_BROWSER_CLIENT_ID", "OIDC_REDIRECT_URI",
            "OIDC_NATIVE_CLIENT_ID", "OIDC_NATIVE_AUDIENCE", "OIDC_NATIVE_MOBILE_REDIRECT_URI"]
with open("keycloak/kailo-realm.json", encoding="utf-8") as fh:
    document = json.load(fh)
substitutions = {}
for placeholder, path in from_file.items():
    with open(path, encoding="utf-8") as fh:
        substitutions[placeholder] = fh.read().strip()
for name in from_env:
    substitutions[f"__{name}__"] = os.environ[name]
import re
token = re.compile(r"__[A-Z][A-Z_]*__")
def replace(node):
    if isinstance(node, str):
        return token.sub(lambda match: substitutions.get(match.group(), match.group()), node)
    if isinstance(node, list):
        return [replace(item) for item in node]
    if isinstance(node, dict):
        return {key: replace(value) for key, value in node.items()}
    return node
document = replace(document)
left = sorted(set(token.findall(json.dumps(document))))
if left:
    raise SystemExit(f"realm 模板里还有未替换的占位符：{left}")
fd = os.open("secrets/keycloak-import/kailo-realm.json", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w", encoding="utf-8") as fh:
    json.dump(document, fh, ensure_ascii=False)
RENDER
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
  # 轮换窗口（RB-02 步骤 F）：退役中的 operator pubkey 与在用的并列，直到 Core
  # 已切到新 key 并查证；删掉 .retiring 文件再派生一次即关闭窗口。
  printf 'RELAY_OPERATOR_PUBKEYS='; cat secrets/relay_operator_pubkey
  [ -s secrets/relay_operator_pubkey.retiring ] && { printf ','; cat secrets/relay_operator_pubkey.retiring; }
  printf '\n'
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

# Core 自己的两把凭据：连 Temporal 的 OIDC client secret（SF-TMP-06），
# 与平台引导用的 RelayOperatorIdentity 私钥（.design/09 第 3 步）。
#
# 走 env_file 而不是 compose 的 secrets：非 swarm 模式下 secrets 就是把宿主
# 文件 bind mount 进去，uid/gid/mode 全部被忽略。宿主上这些文件是 0600 属主
# 为当前用户，而 core 镜像以 uid 10001 运行，因此读不到。同一原因下
# SpiceDB 也走 env_file（它是 distroless）。
{ printf 'OIDC_SERVICE_CLIENT_SECRET='; cat secrets/kailo_core_client_secret; printf '\n'
  printf 'RELAY_OPERATOR_PRIVATE_KEY='; cat secrets/relay_operator_private_key; printf '\n'; } > secrets/core-service.env
chmod 600 secrets/core-service.env
printf '  已生成：secrets/core-service.env\n'

# Worker 的两把凭据：自己的 OIDC client secret 与 SpiceDB 的 PSK。
# 与上面的原始 secret 同源，保持单一真值。
{ printf 'OIDC_WORKER_CLIENT_SECRET='; cat secrets/kailo_worker_client_secret; printf '\n'
  printf 'SPICEDB_GRPC_PRESHARED_KEY='; cat secrets/spicedb_preshared_key; printf '\n'; } > secrets/worker.env
chmod 600 secrets/worker.env
printf '  已生成：secrets/worker.env\n'

# Core 的准入 fresh Check 经 SpiceDB HTTP gateway（ADR-10），同一把 PSK 作 Bearer。
{ printf 'SPICEDB_PRESHARED_KEY='; cat secrets/spicedb_preshared_key; printf '\n'; } > secrets/core-spicedb.env
chmod 600 secrets/core-spicedb.env
printf '  已生成：secrets/core-spicedb.env\n'

# zed 写 schema 用同一把 PSK，但不应拿到数据库连接串——它只需要 gRPC 凭据。
{ printf 'ZED_TOKEN='; cat secrets/spicedb_preshared_key; printf '\n'; } > secrets/zed.env
chmod 600 secrets/zed.env
printf '  已生成：secrets/zed.env\n'

# 对象存储自身的凭据；与 Relay 侧同源，保持单一真值。
{ printf 'MINIO_ROOT_USER=%s\n' "${BUZZ_OBJECTS_USER:?}"
  printf 'MINIO_ROOT_PASSWORD='; cat secrets/buzz_objects_root_password; printf '\n'
  printf 'BUZZ_S3_BUCKET=%s\n' "${BUZZ_S3_BUCKET:?}"
  # mc 的 alias 由环境变量声明，凭据不上命令行（进程列表可见；以 `-` 开头的随机口令
  # 还会被当成选项）。mc 原样使用 userinfo、不做百分号解码，因此只接受 URL 安全字符，
  # 其他字符直接拒绝；与上方同一份凭据派生。
  printf 'MC_HOST_obj='
  python3 -c 'import re, sys; user, secret = sys.argv[1], open(sys.argv[2]).read().strip(); ok = re.compile(r"[A-Za-z0-9._~=-]+"); (ok.fullmatch(user) and ok.fullmatch(secret)) or sys.exit("对象存储用户或口令含 URL 不安全字符，mc 无法原样使用"); print("http://%s:%s@buzz-objects:9000" % (user, secret))' \
    "${BUZZ_OBJECTS_USER:?}" secrets/buzz_objects_root_password; } > secrets/buzz-objects.env
chmod 600 secrets/buzz-objects.env
printf '  已生成：secrets/buzz-objects.env\n'
chmod 600 secrets/buzz-relay.env
printf '  已生成：secrets/buzz-relay.env\n'

if [ ! -f .env ]; then
  printf '\n缺少 deploy/local/.env。复制 .env.example 并填写后再启动：\n  cp .env.example .env\n' >&2
  exit 1
fi

# Core 的 OpenBao 引导凭据由 start-core.sh 在每次启动 Core 前现取（wrapped
# secret_id，一次性）。compose 解析时要求每个 env_file 都存在——缺它连对 openbao
# 容器的 exec 都执行不了。先放一个空文件：此时启动的 Core 缺投递会当场拒绝启动。
[ -e secrets/openbao-core.env ] || { : > secrets/openbao-core.env; chmod 600 secrets/openbao-core.env; }

printf '\n就绪。启动：docker compose --env-file .env -f compose.yaml up -d，\n'
printf '随后 ./openbao-init.sh（解封与 role），再 ./start-core.sh（投递引导凭据并启动 Core）\n'
