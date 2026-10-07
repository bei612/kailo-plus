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
  "${CORE_DB_USER:?缺少 CORE_DB_USER}" "${CORE_DB_NAME:?缺少 CORE_DB_NAME}" \
  "${AGENTGATEWAY_DB_USER:?缺少 AGENTGATEWAY_DB_USER}" "${AGENTGATEWAY_DB_NAME:?缺少 AGENTGATEWAY_DB_NAME}" \
  "${OPENMETER_HOST:?缺少 OPENMETER_HOST}" "${OPENMETER_API_PORT:?缺少 OPENMETER_API_PORT}" \
  "${OPENMETER_CUSTOMERS_URL:?缺少 OPENMETER_CUSTOMERS_URL}" "${OPENMETER_NAMESPACE:?缺少 OPENMETER_NAMESPACE}" \
  "${OPENMETER_HTTP_TIMEOUT_SECONDS:?缺少 OPENMETER_HTTP_TIMEOUT_SECONDS}" \
  "${OPENMETER_CORE_TOKEN_FILE:?缺少 OPENMETER_CORE_TOKEN_FILE}" \
  "${OPENMETER_CONFIG_FILE:?缺少 OPENMETER_CONFIG_FILE}" \
  "${OPENMETER_DB_NAME:?缺少 OPENMETER_DB_NAME}" "${OPENMETER_DB_USER:?缺少 OPENMETER_DB_USER}" \
  "${OPENMETER_CLICKHOUSE_DB_NAME:?缺少 OPENMETER_CLICKHOUSE_DB_NAME}" \
  "${OPENMETER_CLICKHOUSE_USER:?缺少 OPENMETER_CLICKHOUSE_USER}" \
  "${OPENMETER_KAFKA_CLUSTER_ID:?缺少 OPENMETER_KAFKA_CLUSTER_ID}" \
  "${OPENMETER_REDIS_PORT:?缺少 OPENMETER_REDIS_PORT}" \
  "${OPENMETER_REDIS_DATABASES:?缺少 OPENMETER_REDIS_DATABASES}" \
  "${OPENMETER_INGRESS_DEDUPE_DATABASE:?缺少 OPENMETER_INGRESS_DEDUPE_DATABASE}" \
  "${OPENMETER_SINK_DEDUPE_DATABASE:?缺少 OPENMETER_SINK_DEDUPE_DATABASE}" \
  "${OPENMETER_DEDUPE_EXPIRATION:?缺少 OPENMETER_DEDUPE_EXPIRATION}" \
  "${OPENMETER_REDIS_MAXMEMORY:?缺少 OPENMETER_REDIS_MAXMEMORY}" \
  "${OPENMETER_SINK_TELEMETRY_PORT:?缺少 OPENMETER_SINK_TELEMETRY_PORT}" \
  "${OPENMETER_REDIS_HEALTH_INTERVAL_SECONDS:?缺少 OPENMETER_REDIS_HEALTH_INTERVAL_SECONDS}" \
  "${OPENMETER_REDIS_HEALTH_TIMEOUT_SECONDS:?缺少 OPENMETER_REDIS_HEALTH_TIMEOUT_SECONDS}" \
  "${OPENMETER_REDIS_HEALTH_RETRIES:?缺少 OPENMETER_REDIS_HEALTH_RETRIES}" \
  "${OPENMETER_SINK_HEALTH_INTERVAL_SECONDS:?缺少 OPENMETER_SINK_HEALTH_INTERVAL_SECONDS}" \
  "${OPENMETER_SINK_HEALTH_TIMEOUT_SECONDS:?缺少 OPENMETER_SINK_HEALTH_TIMEOUT_SECONDS}" \
  "${OPENMETER_SINK_HEALTH_RETRIES:?缺少 OPENMETER_SINK_HEALTH_RETRIES}" \
  "${OPENMETER_API_CPUS:?缺少 OPENMETER_API_CPUS}" "${OPENMETER_API_MEMORY:?缺少 OPENMETER_API_MEMORY}" \
  "${OPENMETER_KAFKA_CPUS:?缺少 OPENMETER_KAFKA_CPUS}" "${OPENMETER_KAFKA_MEMORY:?缺少 OPENMETER_KAFKA_MEMORY}" \
  "${OPENMETER_KAFKA_HEAP_OPTS:?缺少 OPENMETER_KAFKA_HEAP_OPTS}" \
  "${OPENMETER_CLICKHOUSE_CPUS:?缺少 OPENMETER_CLICKHOUSE_CPUS}" "${OPENMETER_CLICKHOUSE_MEMORY:?缺少 OPENMETER_CLICKHOUSE_MEMORY}" \
  "${OPENMETER_POSTGRES_CPUS:?缺少 OPENMETER_POSTGRES_CPUS}" "${OPENMETER_POSTGRES_MEMORY:?缺少 OPENMETER_POSTGRES_MEMORY}" \
  "${OPENMETER_SINK_CPUS:?缺少 OPENMETER_SINK_CPUS}" "${OPENMETER_SINK_MEMORY:?缺少 OPENMETER_SINK_MEMORY}" \
  "${OPENMETER_REDIS_CPUS:?缺少 OPENMETER_REDIS_CPUS}" "${OPENMETER_REDIS_MEMORY:?缺少 OPENMETER_REDIS_MEMORY}"
: "${AGENT_MEMORY_READ_TIMEOUT_SECONDS:?缺少 AGENT_MEMORY_READ_TIMEOUT_SECONDS}"
# 本地拓扑导入 Keycloak realm；issuer 的 realm 必须与导入对象完全相同。
# PUBLIC_ORIGIN 是浏览器入口的唯一根地址，回调与邀请页均从它派生。
OIDC_ISSUER="$OIDC_ISSUER" OIDC_REALM="$OIDC_REALM" PUBLIC_ORIGIN="$PUBLIC_ORIGIN" \
NATIVE_PAGE_ORIGINS="${NATIVE_PAGE_ORIGINS:-}" \
EDITOR_ORIGINS="${EDITOR_ORIGINS:-}" WEB_EDITOR_ORIGINS="${WEB_EDITOR_ORIGINS:-}" \
PUBLIC_HOST="$PUBLIC_HOST" OIDC_HOST="$OIDC_HOST" BUZZ_RELAY_HOST="$BUZZ_RELAY_HOST" \
BUZZ_RELAY_PORT="$BUZZ_RELAY_PORT" AGENTGATEWAY_PORT="$AGENTGATEWAY_PORT" \
KEYCLOAK_PORT="$KEYCLOAK_PORT" CORE_DB_USER="$CORE_DB_USER" CORE_DB_NAME="$CORE_DB_NAME" \
CORE_DB_PORT="$CORE_DB_PORT" \
AGENTGATEWAY_DB_USER="$AGENTGATEWAY_DB_USER" AGENTGATEWAY_DB_NAME="$AGENTGATEWAY_DB_NAME" \
OPENMETER_HOST="$OPENMETER_HOST" OPENMETER_API_PORT="$OPENMETER_API_PORT" \
OPENMETER_CUSTOMERS_URL="$OPENMETER_CUSTOMERS_URL" OPENMETER_NAMESPACE="$OPENMETER_NAMESPACE" \
OPENMETER_HTTP_TIMEOUT_SECONDS="$OPENMETER_HTTP_TIMEOUT_SECONDS" \
OPENMETER_CORE_TOKEN_FILE="$OPENMETER_CORE_TOKEN_FILE" \
OPENMETER_CONFIG_FILE="$OPENMETER_CONFIG_FILE" \
OPENMETER_DB_NAME="$OPENMETER_DB_NAME" OPENMETER_DB_USER="$OPENMETER_DB_USER" \
OPENMETER_CLICKHOUSE_DB_NAME="$OPENMETER_CLICKHOUSE_DB_NAME" OPENMETER_CLICKHOUSE_USER="$OPENMETER_CLICKHOUSE_USER" \
OPENMETER_KAFKA_CLUSTER_ID="$OPENMETER_KAFKA_CLUSTER_ID" \
OPENMETER_REDIS_PORT="$OPENMETER_REDIS_PORT" OPENMETER_REDIS_DATABASES="$OPENMETER_REDIS_DATABASES" \
OPENMETER_INGRESS_DEDUPE_DATABASE="$OPENMETER_INGRESS_DEDUPE_DATABASE" \
OPENMETER_SINK_DEDUPE_DATABASE="$OPENMETER_SINK_DEDUPE_DATABASE" \
OPENMETER_DEDUPE_EXPIRATION="$OPENMETER_DEDUPE_EXPIRATION" \
OPENMETER_REDIS_MAXMEMORY="$OPENMETER_REDIS_MAXMEMORY" \
OPENMETER_SINK_TELEMETRY_PORT="$OPENMETER_SINK_TELEMETRY_PORT" \
OPENMETER_REDIS_HEALTH_INTERVAL_SECONDS="$OPENMETER_REDIS_HEALTH_INTERVAL_SECONDS" \
OPENMETER_REDIS_HEALTH_TIMEOUT_SECONDS="$OPENMETER_REDIS_HEALTH_TIMEOUT_SECONDS" \
OPENMETER_REDIS_HEALTH_RETRIES="$OPENMETER_REDIS_HEALTH_RETRIES" \
OPENMETER_SINK_HEALTH_INTERVAL_SECONDS="$OPENMETER_SINK_HEALTH_INTERVAL_SECONDS" \
OPENMETER_SINK_HEALTH_TIMEOUT_SECONDS="$OPENMETER_SINK_HEALTH_TIMEOUT_SECONDS" \
OPENMETER_SINK_HEALTH_RETRIES="$OPENMETER_SINK_HEALTH_RETRIES" \
OPENMETER_API_CPUS="$OPENMETER_API_CPUS" OPENMETER_API_MEMORY="$OPENMETER_API_MEMORY" \
OPENMETER_KAFKA_CPUS="$OPENMETER_KAFKA_CPUS" OPENMETER_KAFKA_MEMORY="$OPENMETER_KAFKA_MEMORY" \
OPENMETER_KAFKA_HEAP_OPTS="$OPENMETER_KAFKA_HEAP_OPTS" \
OPENMETER_CLICKHOUSE_CPUS="$OPENMETER_CLICKHOUSE_CPUS" OPENMETER_CLICKHOUSE_MEMORY="$OPENMETER_CLICKHOUSE_MEMORY" \
OPENMETER_POSTGRES_CPUS="$OPENMETER_POSTGRES_CPUS" OPENMETER_POSTGRES_MEMORY="$OPENMETER_POSTGRES_MEMORY" \
OPENMETER_SINK_CPUS="$OPENMETER_SINK_CPUS" OPENMETER_SINK_MEMORY="$OPENMETER_SINK_MEMORY" \
OPENMETER_REDIS_CPUS="$OPENMETER_REDIS_CPUS" OPENMETER_REDIS_MEMORY="$OPENMETER_REDIS_MEMORY" \
PLATFORM_DISPLAY_NAME="${PLATFORM_DISPLAY_NAME:-}" \
AGENT_MEMORY_READ_TIMEOUT_SECONDS="$AGENT_MEMORY_READ_TIMEOUT_SECONDS" \
python3 - <<'PYCONFIG'
import os
import re
from ctypes import c_int, sizeof
from decimal import Decimal, InvalidOperation
from fractions import Fraction
from pathlib import PurePosixPath
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
origin_sets = {}
for name in ("NATIVE_PAGE_ORIGINS", "EDITOR_ORIGINS", "WEB_EDITOR_ORIGINS"):
    configured = os.environ[name]
    if any(ord(char) < 0x20 or ord(char) == 0x7f for char in configured):
        raise SystemExit(f"{name} 只允许以空格分隔的精确 HTTP(S) origin")
    origins = set()
    for raw in configured.split():
        if not re.fullmatch(r"https?://(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:]+\])(?::[1-9][0-9]*)?", raw):
            raise SystemExit(f"{name} 不允许路径、凭据、通配符或 CSP 指令")
        try:
            value = urlsplit(raw)
            port = value.port
        except ValueError:
            raise SystemExit(f"{name} 含无效 origin") from None
        if (port == 0 or (value.scheme == "http" and port == 80)
                or (value.scheme == "https" and port == 443)
                or raw == os.environ["PUBLIC_ORIGIN"] or raw in origins):
            raise SystemExit(f"{name} 必须规范化、去重且不同于平台来源")
        origins.add(raw)
    origin_sets[name] = origins
if not origin_sets["WEB_EDITOR_ORIGINS"].issubset(origin_sets["EDITOR_ORIGINS"]):
    raise SystemExit("WEB_EDITOR_ORIGINS 不得扩大 EDITOR_ORIGINS 部署许可")
host("BUZZ_RELAY_HOST")
checked_port("BUZZ_RELAY_PORT")
checked_port("CORE_DB_PORT")
for name in ("CORE_DB_USER", "CORE_DB_NAME", "AGENTGATEWAY_DB_USER", "AGENTGATEWAY_DB_NAME"):
    if not re.fullmatch(r"[A-Za-z0-9_-]+", os.environ[name]):
        raise SystemExit(f"{name} 不适合 PostgreSQL URL")
for name in ("OPENMETER_DB_USER", "OPENMETER_DB_NAME", "OPENMETER_CLICKHOUSE_USER", "OPENMETER_CLICKHOUSE_DB_NAME"):
    if not re.fullmatch(r"[A-Za-z0-9_]+", os.environ[name]):
        raise SystemExit(f"{name} 必须是字母、数字或下划线组成的原生存储标识")
native_host = host("OPENMETER_HOST")
native_port = checked_port("OPENMETER_API_PORT")
if os.environ["OPENMETER_CUSTOMERS_URL"] != f"http://{native_host}:{native_port}/api/v3/openmeter/customers":
    raise SystemExit("OPENMETER_CUSTOMERS_URL 必须由 OPENMETER_HOST/API_PORT 派生为原生 v3 Customer 路径")
for name in ("OPENMETER_NAMESPACE", "OPENMETER_KAFKA_CLUSTER_ID"):
    if invalid_chars(os.environ[name]) or not re.fullmatch(r"[A-Za-z0-9_-]+", os.environ[name]):
        raise SystemExit(f"{name} 含无效的原生 namespace 或集群标识字符")
if not re.fullmatch(r"[1-9][0-9]*", os.environ["OPENMETER_HTTP_TIMEOUT_SECONDS"]):
    raise SystemExit("OPENMETER_HTTP_TIMEOUT_SECONDS 必须是正整数秒")
if not re.fullmatch(r"[1-9][0-9]*", os.environ["AGENT_MEMORY_READ_TIMEOUT_SECONDS"]):
    raise SystemExit("AGENT_MEMORY_READ_TIMEOUT_SECONDS 必须是正整数秒")
for name in ("OPENMETER_REDIS_HEALTH_INTERVAL_SECONDS", "OPENMETER_REDIS_HEALTH_TIMEOUT_SECONDS",
             "OPENMETER_REDIS_HEALTH_RETRIES", "OPENMETER_SINK_HEALTH_INTERVAL_SECONDS",
             "OPENMETER_SINK_HEALTH_TIMEOUT_SECONDS", "OPENMETER_SINK_HEALTH_RETRIES"):
    if not re.fullmatch(r"[1-9][0-9]*", os.environ[name]):
        raise SystemExit(f"{name} 必须是正整数")
paths = {}
for name in ("OPENMETER_CORE_TOKEN_FILE", "OPENMETER_CONFIG_FILE"):
    raw = os.environ[name]
    path = PurePosixPath(raw)
    if (invalid_chars(raw) or not raw.startswith("/") or raw.endswith("/")
            or str(path) != raw or ".." in path.parts):
        raise SystemExit(f"{name} 必须是规范的容器内绝对文件路径")
    paths[name] = path
config_path = paths["OPENMETER_CONFIG_FILE"]
token_path = paths["OPENMETER_CORE_TOKEN_FILE"]
if config_path.suffix not in (".yaml", ".yml"):
    raise SystemExit("OPENMETER_CONFIG_FILE 必须是原生 YAML 配置文件路径")
# API 现有挂载只有 token；sink 无既有挂载。禁止同路径或父子覆盖该文件挂载。
if (config_path == token_path or token_path in config_path.parents
        or config_path in token_path.parents):
    raise SystemExit("OPENMETER_CONFIG_FILE 不得覆盖 OpenMeter token 挂载")
checked_port("OPENMETER_REDIS_PORT")
checked_port("OPENMETER_SINK_TELEMETRY_PORT")
database_values = {}
for name in ("OPENMETER_REDIS_DATABASES", "OPENMETER_INGRESS_DEDUPE_DATABASE", "OPENMETER_SINK_DEDUPE_DATABASE"):
    raw = os.environ[name]
    if not re.fullmatch(r"0|[1-9][0-9]*", raw):
        raise SystemExit(f"{name} 必须是规范的非负十进制整数")
    database_values[name] = int(raw)
database_count = database_values["OPENMETER_REDIS_DATABASES"]
# Redis databases 配置采用 C int；索引必须小于投递给 Redis 的实际库数量。
if not 0 < database_count < 1 << (sizeof(c_int) * 8 - 1):
    raise SystemExit("OPENMETER_REDIS_DATABASES 必须是原生 Redis 可接受的正整数")
ingress_database = database_values["OPENMETER_INGRESS_DEDUPE_DATABASE"]
sink_database = database_values["OPENMETER_SINK_DEDUPE_DATABASE"]
if ingress_database >= database_count or sink_database >= database_count:
    raise SystemExit("OpenMeter 去重逻辑库必须小于 OPENMETER_REDIS_DATABASES")
if ingress_database == sink_database:
    raise SystemExit("OpenMeter ingress 与 sink 去重不可共用逻辑库")
expiration = os.environ["OPENMETER_DEDUPE_EXPIRATION"]
duration_part = r"([0-9]+(?:\.[0-9]*)?|\.[0-9]+)(ns|us|µs|μs|ms|s|m|h)"
if expiration != "0" and not re.fullmatch(f"(?:{duration_part})+", expiration):
    raise SystemExit("OPENMETER_DEDUPE_EXPIRATION 必须是非负的原生 Go duration")
unit_nanoseconds = {"ns": 1, "us": 1000, "µs": 1000, "μs": 1000,
                    "ms": 1000000, "s": 1000000000, "m": 60000000000, "h": 3600000000000}
duration_nanoseconds = sum(int(Fraction(value) * unit_nanoseconds[unit])
                           for value, unit in re.findall(duration_part, expiration))
if duration_nanoseconds >= 1 << 63:
    raise SystemExit("OPENMETER_DEDUPE_EXPIRATION 超出原生 time.Duration 范围")
memory_values = {}
for component in ("API", "KAFKA", "CLICKHOUSE", "POSTGRES", "SINK", "REDIS"):
    name = f"OPENMETER_{component}_CPUS"
    try:
        cpus = Decimal(os.environ[name])
    except InvalidOperation:
        raise SystemExit(f"{name} 必须是有限正数") from None
    if not cpus.is_finite() or cpus <= 0:
        raise SystemExit(f"{name} 必须是有限正数")
    name = f"OPENMETER_{component}_MEMORY"
    if not re.fullmatch(r"[1-9][0-9]*(?:[bBkKmMgG]|[kKmMgG][bB])?", os.environ[name]):
        raise SystemExit(f"{name} 必须是正的 Compose 内存容量")
    amount, suffix = re.fullmatch(r"([1-9][0-9]*)([a-z]*)", os.environ[name].lower()).groups()
    memory_values[component] = int(amount) * 1024 ** {"": 0, "b": 0, "k": 1, "kb": 1,
                                                     "m": 2, "mb": 2, "g": 3, "gb": 3}[suffix]
kafka_heap = {}
for option in os.environ["OPENMETER_KAFKA_HEAP_OPTS"].split():
    match = re.fullmatch(r"-Xm([sx])([1-9][0-9]*)([kKmMgG]?)", option)
    if not match or match[1] in kafka_heap:
        raise SystemExit("OPENMETER_KAFKA_HEAP_OPTS 必须恰含一份正容量 -Xms 与 -Xmx")
    kafka_heap[match[1]] = int(match[2]) * 1024 ** {"": 0, "k": 1, "m": 2, "g": 3}[match[3].lower()]
if set(kafka_heap) != {"s", "x"} or kafka_heap["s"] > kafka_heap["x"]:
    raise SystemExit("OPENMETER_KAFKA_HEAP_OPTS 必须含 -Xms<=-Xmx")
if kafka_heap["x"] >= memory_values["KAFKA"]:
    raise SystemExit("Kafka -Xmx 必须小于容器预算，保留非堆内存与健康检查余量")
maxmemory = os.environ["OPENMETER_REDIS_MAXMEMORY"].lower()
match = re.fullmatch(r"([1-9][0-9]*)(b|k|kb|m|mb|g|gb)?", maxmemory)
if not match:
    raise SystemExit("OPENMETER_REDIS_MAXMEMORY 必须是原生 Redis 可接受的正容量")
amount, suffix = match.groups()
redis_units = {None: 1, "b": 1, "k": 1000, "kb": 1024, "m": 1000000,
               "mb": 1048576, "g": 1000000000, "gb": 1073741824}
if int(amount) * redis_units[suffix] >= memory_values["REDIS"]:
    raise SystemExit("OPENMETER_REDIS_MAXMEMORY 必须小于 Redis 容器内存预算")
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
if [ -n "${BUZZ_DELETION_PORT:-}" ]; then
  [[ "$BUZZ_DELETION_PORT" =~ ^[1-9][0-9]*$ ]] \
    && (( BUZZ_DELETION_PORT <= 65535 )) \
    && [[ "${BUZZ_DELETION_HTTP_TIMEOUT_SECONDS:-}" =~ ^[1-9][0-9]*$ ]] || {
    echo '私有删除端口必须为有效 TCP 端口，HTTP timeout 必须为正整数秒' >&2
    exit 2
  }
fi
if [ "${1:-}" = '--validate-config' ] && [ "$#" -eq 1 ]; then
  exit 0
fi
# 原生登录页语言只由同一 realm 模板投递。已有 realm 不会重新导入，故仅 PUT
# 这三个展示字段；不读写用户、角色、凭据或认证流程。结果不明时退出，重入先读回。
if [ "${1:-}" = '--sync-realm-locales' ] && [ "$#" -eq 1 ]; then
  python3 - "$OIDC_ISSUER" "$OIDC_REALM" "${KEYCLOAK_ADMIN_USER:?}" \
    "${VERIFY_BOOTSTRAP_WAIT_SECONDS:?}" <<'PYLOCALE'
import json
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request

issuer, realm, admin, timeout = sys.argv[1:]
timeout = int(timeout)
if timeout <= 0:
    raise SystemExit("VERIFY_BOOTSTRAP_WAIT_SECONDS 必须为正整数")
origin = urllib.parse.urlsplit(issuer)
base = urllib.parse.urlunsplit((origin.scheme, origin.netloc, "", "", ""))
KEYS = ("internationalizationEnabled", "supportedLocales", "defaultLocale")


def same(current, desired):
    return (current.get("internationalizationEnabled") is desired["internationalizationEnabled"]
            and sorted(current.get("supportedLocales") or []) == sorted(desired["supportedLocales"])
            and current.get("defaultLocale") == desired["defaultLocale"])


try:
    template = json.loads(pathlib.Path("identity-provider/realm.json").read_text(encoding="utf-8"))
    desired = {key: template[key] for key in KEYS}
    if (desired["internationalizationEnabled"] is not True
            or desired["defaultLocale"] != "zh-CN"
            or not isinstance(desired["supportedLocales"], list)
            or sorted(desired["supportedLocales"]) != ["en", "zh-CN"]):
        raise SystemExit("realm 语言模板必须启用中文默认与中英选择")
    password = pathlib.Path("secrets/keycloak_admin_password").read_text().strip()
    login = urllib.parse.urlencode({"grant_type": "password", "client_id": "admin-cli",
                                   "username": admin, "password": password}).encode()
    with urllib.request.urlopen(base + "/realms/master/protocol/openid-connect/token",
                                login, timeout=timeout) as response:
        token = json.load(response)["access_token"]

    path = "/admin/realms/" + urllib.parse.quote(realm, safe="")

    def request(body=None):
        req = urllib.request.Request(base + path,
            data=json.dumps(body).encode() if body is not None else None,
            method="PUT" if body is not None else "GET",
            headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return json.load(response) if body is None else None

    current = request()
    if current.get("realm") != realm:
        raise SystemExit("realm 语言读取对象不匹配，拒绝更新")
    changed = not same(current, desired)
    if changed:
        request(desired)
    confirmed = request()
    if confirmed.get("realm") != realm or not same(confirmed, desired):
        raise SystemExit("realm 语言回读不一致，同步未完成")
    print("realm 原生中英语言已同步并查证" if changed else "realm 原生中英语言已一致，无需更新")
except (urllib.error.URLError, OSError, ValueError, KeyError, TypeError):
    raise SystemExit("realm 语言同步未完成；修复 IdP 连接或配置后重跑查证，不重建 realm") from None
PYLOCALE
  exit 0
fi
# 持久化 realm 不会再次导入 JSON。只收敛已有浏览器与原生客户端的回调：期望值取自本次渲染的导入文件
# （与首次导入同源），不重建用户、client 或 credential；HTTP 结果不明时退出失败，重跑先读当前值再收敛。
if [ "${1:-}" = '--sync-client-redirects' ] && [ "$#" -eq 1 ]; then
  python3 - "$KEYCLOAK_PORT" "$OIDC_REALM" "${KEYCLOAK_ADMIN_USER:?}" \
    "${OIDC_BROWSER_CLIENT_ID:?}" "${OIDC_NATIVE_CLIENT_ID:?}" "${VERIFY_BOOTSTRAP_WAIT_SECONDS:?}" <<'PYSYNC'
import json
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request

port, realm, admin, browser_id, native_id, timeout = sys.argv[1:]
timeout = int(timeout)
if timeout <= 0:
    raise SystemExit("VERIFY_BOOTSTRAP_WAIT_SECONDS 必须为正整数")
base = "http://127.0.0.1:" + port
KEYS = ("redirectUris", "webOrigins")


def same(current, desired):
    # Keycloak 把回调与来源当作集合保存，返回顺序不保证与导入顺序一致。
    return all(sorted(current.get(k) or []) == sorted(v) for k, v in desired.items())
try:
    rendered = json.loads(pathlib.Path("secrets/idp-import/realm.json").read_text(encoding="utf-8"))
    wanted = {}
    for client_id in (browser_id, native_id):
        entries = [c for c in rendered.get("clients", []) if c.get("clientId") == client_id]
        if len(entries) != 1:
            raise SystemExit(f"渲染后的 realm 中客户端 {client_id} 不唯一")
        wanted[client_id] = {k: entries[0][k] for k in KEYS if k in entries[0]}
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
    for client_id, desired in wanted.items():
        clients = request(clients_path + "?" + urllib.parse.urlencode({"clientId": client_id}))
        if len(clients) != 1 or clients[0].get("clientId") != client_id:
            raise SystemExit(f"客户端 {client_id} 不存在或不唯一，拒绝创建替代身份")
        path = clients_path + "/" + urllib.parse.quote(clients[0]["id"], safe="")
        current = request(path)
        changed = not same(current, desired)
        if changed:
            # 只发送回调相关字段，其他 client 属性、protocol mapper 与 secret 均不投递。
            request(path, desired)
        confirmed = request(path)
        if not same(confirmed, desired):
            raise SystemExit(f"客户端 {client_id} 回调回读不一致，初始化未完成")
        print(f"客户端 {client_id} 回调已同步并查证" if changed else f"客户端 {client_id} 回调已一致，无需更新")
except (urllib.error.URLError, OSError, ValueError, KeyError, TypeError):
    raise SystemExit("客户端回调同步未完成；修复 IdP 连接或配置后重跑查证，不重建 realm") from None
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
    template = json.loads(pathlib.Path("identity-provider/realm.json").read_text(encoding="utf-8"))
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
# 持久化 realm 同样不会因导入文件给已有 client 增加 protocol mapper。只收敛 Core 服务
# client 上网关管理面 audience 这一个 mapper：定义取自本次渲染的导入文件（与首次导入同源），
# 恰好 0 个则创建，恰好 1 个且与定义一致不改动，其余情形拒绝；其他 mapper 与 secret 不读不写。
if [ "${1:-}" = '--ensure-service-audience' ] && [ "$#" -eq 1 ]; then
  python3 - "$KEYCLOAK_PORT" "$OIDC_REALM" "${KEYCLOAK_ADMIN_USER:?}" \
    "${OIDC_SERVICE_CLIENT_ID:?}" "${VERIFY_BOOTSTRAP_WAIT_SECONDS:?}" <<'PYAUD'
import json
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request

port, realm, admin, client_id, timeout = sys.argv[1:]
timeout = int(timeout)
if timeout <= 0:
    raise SystemExit("VERIFY_BOOTSTRAP_WAIT_SECONDS 必须为正整数")
MAPPER = "agentgateway-admin-audience"
base = "http://127.0.0.1:" + port
try:
    rendered = json.loads(pathlib.Path("secrets/idp-import/realm.json").read_text(encoding="utf-8"))
    wanted = [m for c in rendered.get("clients", []) if c.get("clientId") == client_id
              for m in c.get("protocolMappers", []) if m.get("name") == MAPPER]
    if len(wanted) != 1:
        raise SystemExit("渲染后的 realm 中 Core 服务 client 的网关 audience mapper 不唯一")
    wanted = wanted[0]
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

    clients_path = "/admin/realms/" + urllib.parse.quote(realm, safe="") + "/clients"
    clients = request(clients_path + "?" + urllib.parse.urlencode({"clientId": client_id}))
    if len(clients) != 1 or clients[0].get("clientId") != client_id:
        raise SystemExit("Core 服务 client 不存在或不唯一，拒绝创建替代身份")
    mappers_path = clients_path + "/" + urllib.parse.quote(clients[0]["id"], safe="") + "/protocol-mappers/models"

    def matching():
        return [m for m in request(mappers_path) if m.get("name") == MAPPER]

    def same(m):
        return (m.get("protocolMapper") == wanted["protocolMapper"]
                and all(m.get("config", {}).get(k) == v for k, v in wanted["config"].items()))

    current = matching()
    if len(current) > 1 or (current and not same(current[0])):
        raise SystemExit("已有同名 mapper 与定义不一致或不唯一，拒绝覆盖；人工核对后处置")
    created = not current
    if created:
        request(mappers_path, wanted)
    confirmed = matching()
    if len(confirmed) != 1 or not same(confirmed[0]):
        raise SystemExit("网关 audience mapper 回读不一致，初始化未完成")
    print("网关管理面 audience mapper 已创建并查证" if created else "网关管理面 audience mapper 已一致，无需更新")
except (urllib.error.URLError, OSError, ValueError, KeyError, TypeError):
    raise SystemExit("网关 audience mapper 同步未完成；修复 IdP 连接或配置后重跑查证，不重建 realm") from None
PYAUD
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
# AgentGateway 的 request log / usage outbox 库（SS-AGW-USAGE）。连接串在网关配置里以
# ${AGENTGATEWAY_LOG_DATABASE_URL} 展开；与 core-db-url.env 同理须在首次 compose 调用前存在。
gen agentgateway_db_password
{ printf 'AGENTGATEWAY_LOG_DATABASE_URL=postgres://%s:%s@agentgateway-db:5432/%s\n' \
    "$AGENTGATEWAY_DB_USER" "$(cat secrets/agentgateway_db_password)" "$AGENTGATEWAY_DB_NAME"; } > secrets/agentgateway-db.env
chmod 600 secrets/agentgateway-db.env
printf '  已生成：secrets/agentgateway-db.env\n'
# 原生 API 只接受数据库口令环境变量；从唯一 secret 文件投递，不在 .env 维护副本。
# Core 与原生鉴权共用只读 token 文件。Compose 本地文件 secret 忽略 uid/mode，
# 所以宿主文件显式归 Core 的 uid 10001；当前部署用户组可读，其他用户不可读。
gen openmeter_db_password
gen openmeter_clickhouse_password
[ ! -L secrets/openmeter_core_token ] || { echo '拒绝 OpenMeter token 符号链接' >&2; exit 2; }
gen openmeter_core_token
sudo -n chown "10001:$(id -g)" secrets/openmeter_core_token
sudo -n chmod 0440 secrets/openmeter_core_token
{ printf 'POSTGRES_PASSWORD='; cat secrets/openmeter_db_password; printf '\n'
  printf 'AGGREGATION_CLICKHOUSE_PASSWORD='; cat secrets/openmeter_clickhouse_password; printf '\n'; } > secrets/openmeter.env
chmod 600 secrets/openmeter.env
printf '  已投递：secrets/openmeter.env 与只读 OpenMeter Core token\n'
gen buzz_db_password
gen buzz_objects_root_password
gen keycloak_admin_password
gen temporal_db_password
gen spicedb_preshared_key
gen spicedb_db_password

gen core_client_secret
gen worker_client_secret
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
prefix = os.environ["REGISTRY_HOST"] + "/collaboration-relay@sha256:"
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
mkdir -p data/secret-store data/registry data/collab-objects
if [ "$(stat -c %u data/secret-store)" != "100" ]; then
  sudo -n chown 100:1000 data/secret-store 2>/dev/null || {
    printf '  需要一次 sudo 设置 data/secret-store 属主为 100:1000\n' >&2; exit 2; }
fi
printf '  已就绪：data/secret-store（uid 100）\n'

mkdir -p secrets/idp-import
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
# Core 的 service client 令牌带此 audience 才被 AgentGateway 管理面接受（SS-AGW-ADMIN）。
: "${AGENTGATEWAY_ADMIN_AUDIENCE:?bootstrap 需要 .env 中的 AGENTGATEWAY_ADMIN_AUDIENCE}"
TEMPORAL_NAMESPACE="$TEMPORAL_NAMESPACE" VERIFY_USER="$VERIFY_USER" \
BOOTSTRAP_USER="$BOOTSTRAP_USER" PLATFORM_ADMIN_USER="$PLATFORM_ADMIN_USER" \
OIDC_REALM="$OIDC_REALM" OIDC_SERVICE_CLIENT_ID="$OIDC_SERVICE_CLIENT_ID" \
OIDC_WORKER_CLIENT_ID="$OIDC_WORKER_CLIENT_ID" OIDC_BROWSER_CLIENT_ID="$OIDC_BROWSER_CLIENT_ID" \
OIDC_REDIRECT_URI="$OIDC_REDIRECT_URI" OIDC_NATIVE_CLIENT_ID="$OIDC_NATIVE_CLIENT_ID" \
OIDC_NATIVE_AUDIENCE="$OIDC_NATIVE_AUDIENCE" AGENTGATEWAY_ADMIN_AUDIENCE="$AGENTGATEWAY_ADMIN_AUDIENCE" \
OIDC_NATIVE_MOBILE_REDIRECT_URI="$OIDC_NATIVE_MOBILE_REDIRECT_URI" python3 - <<'RENDER'
import json
import os
from_file = {
    "__CORE_CLIENT_SECRET__": "secrets/core_client_secret",
    "__WORKER_CLIENT_SECRET__": "secrets/worker_client_secret",
    "__BROWSER_CLIENT_SECRET__": "secrets/browser_client_secret",
    "__VERIFY_USER_PASSWORD__": "secrets/verify_user_password",
    "__BOOTSTRAP_USER_PASSWORD__": "secrets/bootstrap_user_password",
    "__PLATFORM_ADMIN_USER_PASSWORD__": "secrets/platform_admin_password",
}
from_env = ["TEMPORAL_NAMESPACE", "VERIFY_USER", "BOOTSTRAP_USER", "PLATFORM_ADMIN_USER", "OIDC_REALM",
            "OIDC_SERVICE_CLIENT_ID", "OIDC_WORKER_CLIENT_ID", "OIDC_BROWSER_CLIENT_ID", "OIDC_REDIRECT_URI",
            "OIDC_NATIVE_CLIENT_ID", "OIDC_NATIVE_AUDIENCE", "OIDC_NATIVE_MOBILE_REDIRECT_URI",
            "AGENTGATEWAY_ADMIN_AUDIENCE"]
with open("identity-provider/realm.json", encoding="utf-8") as fh:
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
fd = os.open("secrets/idp-import/realm.json", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w", encoding="utf-8") as fh:
    json.dump(document, fh, ensure_ascii=False)
RENDER
chmod 600 secrets/idp-import/realm.json
printf '  已渲染：secrets/idp-import/realm.json\n'

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
  if [ -n "${BUZZ_DELETION_PORT:-}" ]; then
    printf 'BUZZ_DELETION_BIND_ADDR=0.0.0.0:%s\n' "$BUZZ_DELETION_PORT"
  fi
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
{ if [ -n "${BUZZ_DELETION_PORT:-}" ]; then
    printf 'BUZZ_DELETION_API_URL=http://%s:%s\n' "$BUZZ_RELAY_HOST" "$BUZZ_DELETION_PORT"
    printf 'BUZZ_DELETION_HTTP_TIMEOUT_SECONDS=%s\n' "$BUZZ_DELETION_HTTP_TIMEOUT_SECONDS"
  fi
  printf 'OIDC_SERVICE_CLIENT_SECRET='; cat secrets/core_client_secret; printf '\n'
  printf 'RELAY_OPERATOR_PRIVATE_KEY='; cat secrets/relay_operator_private_key; printf '\n'; } > secrets/core-service.env
chmod 600 secrets/core-service.env
printf '  已生成：secrets/core-service.env\n'

# Worker 的两把凭据：自己的 OIDC client secret 与 SpiceDB 的 PSK。
# 与上面的原始 secret 同源，保持单一真值。
{ printf 'OIDC_WORKER_CLIENT_SECRET='; cat secrets/worker_client_secret; printf '\n'
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
printf '随后 ./secret-store-init.sh（解封与 role），再 ./start-core.sh（投递引导凭据并启动 Core）\n'
