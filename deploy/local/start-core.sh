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
# 可选运行投递仅在五项完整时合入同一 Compose；关闭态不能给 Core 注入空值。
runtime_names=(AGENT_RUNTIME_BINARY AGENT_RUNTIME_STATE_ROOT AGENT_RUNTIME_RPC_TIMEOUT_SECONDS
  AGENT_RUNTIME_MAX_MESSAGE_BYTES AGENT_RUNTIME_PROFILES_FILE)
runtime_present=0
for runtime_name in "${runtime_names[@]}"; do
  if [ -n "${!runtime_name:-}" ]; then runtime_present=$((runtime_present + 1)); fi
done
if [ "$runtime_present" -ne 0 ] && [ "$runtime_present" -ne "${#runtime_names[@]}" ]; then
  echo 'Agent Runtime 五项配置必须全缺省或完整投递' >&2
  exit 2
fi
runtime_config=
gateway_config=
adapter_config=
tmp=
cleanup_start_core() {
  local status=$?
  trap - EXIT
  if [ -n "$runtime_config" ]; then rm -f -- "$runtime_config" || status=2; fi
  if [ -n "$gateway_config" ]; then rm -f -- "$gateway_config" || status=2; fi
  if [ -n "$adapter_config" ]; then rm -f -- "$adapter_config" || status=2; fi
  if [ -n "$tmp" ]; then rm -f -- "$tmp" || status=2; fi
  exit "$status"
}
trap cleanup_start_core EXIT
runtime_compose=()
if [ "$runtime_present" -ne 0 ]; then
  runtime_config=$(mktemp)
  AGENT_RUNTIME_BINARY="$AGENT_RUNTIME_BINARY" AGENT_RUNTIME_STATE_ROOT="$AGENT_RUNTIME_STATE_ROOT" \
  AGENT_RUNTIME_RPC_TIMEOUT_SECONDS="$AGENT_RUNTIME_RPC_TIMEOUT_SECONDS" \
  AGENT_RUNTIME_MAX_MESSAGE_BYTES="$AGENT_RUNTIME_MAX_MESSAGE_BYTES" \
  AGENT_RUNTIME_PROFILES_FILE="$AGENT_RUNTIME_PROFILES_FILE" \
  python3 - "$runtime_config" <<'PYRUNTIME'
import json
import os
from pathlib import Path, PurePosixPath
import re
import sys

names = ("AGENT_RUNTIME_BINARY", "AGENT_RUNTIME_STATE_ROOT", "AGENT_RUNTIME_RPC_TIMEOUT_SECONDS",
         "AGENT_RUNTIME_MAX_MESSAGE_BYTES", "AGENT_RUNTIME_PROFILES_FILE")
values = {name: os.environ[name] for name in names}
for name in ("AGENT_RUNTIME_BINARY", "AGENT_RUNTIME_STATE_ROOT", "AGENT_RUNTIME_PROFILES_FILE"):
    raw = values[name]
    path = PurePosixPath(raw)
    if not path.is_absolute() or path == PurePosixPath("/") or ".." in path.parts or str(path) != raw:
        raise SystemExit(f"{name} 必须是规范绝对路径")
for name in ("AGENT_RUNTIME_RPC_TIMEOUT_SECONDS", "AGENT_RUNTIME_MAX_MESSAGE_BYTES"):
    if not re.fullmatch(r"[1-9][0-9]*", values[name]):
        raise SystemExit(f"{name} 必须是正整数")
root = Path(values["AGENT_RUNTIME_STATE_ROOT"])
profiles = Path(values["AGENT_RUNTIME_PROFILES_FILE"])
try:
    if not root.is_dir() or root.resolve(strict=True) != root:
        raise ValueError("state root")
    if not profiles.is_file() or profiles.resolve(strict=True) != profiles:
        raise ValueError("profiles")
except (OSError, ValueError):
    raise SystemExit("Agent Runtime 目录与 profile 文件必须真实存在且不能经符号链接投递") from None
# 不生成或改写 profile 内容；共享契约与 key 校验由 Core 原消费者执行。
volumes = [
    {"type": "bind", "source": str(root), "target": str(root),
     "bind": {"create_host_path": False}},
    {"type": "bind", "source": str(profiles), "target": str(profiles), "read_only": True,
     "bind": {"create_host_path": False}},
]
with open(sys.argv[1], "w", encoding="utf-8") as stream:
    json.dump({"services": {"core-bff": {"environment": values, "volumes": volumes}}}, stream)
PYRUNTIME
  runtime_compose=(-f "$runtime_config")
fi
# DD-94/98: the original Core consumer reads a controlled adapter directory.
# No directory means no business-component delivery, not an empty credential or
# a platform startup dependency. Mount only the supplied facts and public JWKS
# files; never create missing paths or generate native identities here.
adapter_compose=()
if [ -n "${APPLICATION_ADAPTER_DIRECTORY_FILE:-}${COMPONENT_CONFORMANCE_ENVIRONMENT_FILE:-}${COMPONENT_CONFORMANCE_FIXTURE_FILE:-}${COMPONENT_CONFORMANCE_IDENTITY_FILE:-}" ]; then
  adapter_config=$(mktemp)
  APPLICATION_ADAPTER_DIRECTORY_FILE="${APPLICATION_ADAPTER_DIRECTORY_FILE:-}" \
  COMPONENT_CONFORMANCE_ENVIRONMENT_FILE="${COMPONENT_CONFORMANCE_ENVIRONMENT_FILE:-}" \
  COMPONENT_CONFORMANCE_FIXTURE_FILE="${COMPONENT_CONFORMANCE_FIXTURE_FILE:-}" \
  COMPONENT_CONFORMANCE_IDENTITY_FILE="${COMPONENT_CONFORMANCE_IDENTITY_FILE:-}" \
  python3 - "$adapter_config" <<'PYADAPTER'
import json
import os
from pathlib import Path, PurePosixPath
import sys

def reject():
    raise SystemExit("Application adapter / conformance 投递必须完整、使用同一 artifact 与真实规范文件及 public-only JWKS；不生成绑定或通过证据")

def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            reject()
        result[key] = value
    return result

def source_file(raw):
    if not isinstance(raw, str):
        reject()
    path = PurePosixPath(raw)
    if not path.is_absolute() or path == PurePosixPath("/") or ".." in path.parts or str(path) != raw:
        reject()
    source = Path(raw)
    if not source.is_file() or source.resolve(strict=True) != source or not os.access(source, os.R_OK):
        reject()
    return source

def document_file(raw):
    source = source_file(raw)
    document = json.loads(source.read_text(encoding="utf-8"), object_pairs_hook=unique_object)
    if not isinstance(document, dict):
        reject()
    return source, document

def public_file(raw):
    public, jwks = document_file(raw)
    if set(jwks) != {"keys"} or not isinstance(jwks["keys"], list) or not jwks["keys"]:
        reject()
    # Private/symmetric material cannot be delivered as a verification key.
    # Full identity/algorithm checks remain in the original Core consumer.
    public_fields = {"kty", "kid", "use", "key_ops", "alg", "crv", "x", "y", "n", "e", "x5c", "x5t", "x5t#S256", "x5u"}
    if any(not isinstance(key, dict) or set(key) - public_fields for key in jwks["keys"]):
        reject()
    return public

def delivery(environment, files):
    return {"environment": environment, "volumes": [
        {"type": "bind", "source": str(source), "target": str(source), "read_only": True,
         "bind": {"create_host_path": False}} for source in sorted(files)]}

try:
    files, environment, services = set(), {}, {}
    raw = os.environ["APPLICATION_ADAPTER_DIRECTORY_FILE"]
    adapters = []
    if raw:
        directory, document = document_file(raw)
        adapters = document.get("adapters")
        if not isinstance(adapters, list):
            reject()
        files.add(directory)
        environment["APPLICATION_ADAPTER_DIRECTORY_FILE"] = str(directory)
    for adapter in adapters:
        if not isinstance(adapter, dict):
            reject()
        identities = adapter.get("nativeHumanIdentities", [])
        if not isinstance(identities, list):
            reject()
        for identity in identities:
            files.add(public_file(identity["jwksFile"]))
    names = ("COMPONENT_CONFORMANCE_ENVIRONMENT_FILE", "COMPONENT_CONFORMANCE_FIXTURE_FILE",
             "COMPONENT_CONFORMANCE_IDENTITY_FILE")
    supplied = {name: os.environ[name] for name in names if os.environ[name]}
    if supplied:
        if names[0] not in supplied:
            reject()
        candidate, configuration = document_file(supplied[names[0]])
        # HTTP adapters require all three deliveries; native MCP peers consume
        # only their original environment. Neither branch fabricates evidence.
        peer = "mcpUrl" in configuration
        if set(supplied) != ({names[0]} if peer else set(names)):
            reject()
        artifact = configuration.get("artifactDigest")
        if not isinstance(artifact, str) or not artifact:
            reject()
        for name, raw in supplied.items():
            source, document = document_file(raw)
            if document.get("artifactDigest") != artifact:
                reject()
            environment[name] = str(source)
            files.add(source)
            if name == names[2]:
                files.add(public_file(document["jwksFile"]))
        services["worker"] = delivery({names[0]: str(candidate)}, {candidate})
    services["core-bff"] = delivery(environment, files)
    with open(sys.argv[1], "w", encoding="utf-8") as stream:
        json.dump({"services": services}, stream)
except (OSError, ValueError, KeyError, TypeError):
    reject()
PYADAPTER
  adapter_compose=(-f "$adapter_config")
fi
# DD-105: exact public-only file mount is present only for a complete native
# Tool deployment. No signing key is read or mounted into Core, and no key is
# generated here. Validate before obtaining any one-use OpenBao delivery.
gateway_names=(GATEWAY_SERVICE_ISSUER GATEWAY_SERVICE_AUDIENCE GATEWAY_SERVICE_CALLER_ID
  GATEWAY_SERVICE_JWKS_FILE GATEWAY_SERVICE_MAX_TOKEN_SECONDS GATEWAY_SERVICE_SIGNING_KEY_FILE
  GATEWAY_SERVICE_KEY_ID GATEWAY_SERVICE_TOKEN_SECONDS AGENT_TOOL_MCP_URL AGENT_TOOL_EXT_MCP_URL
  AGENT_TOOL_SESSION_ISSUER AGENT_TOOL_SESSION_AUDIENCE AGENT_TOOL_SESSION_TOKEN_SECONDS
  AGENT_TOOL_GATEWAY_URL AGENT_TOOL_GATEWAY_NAME)
gateway_present=0
for gateway_name in "${gateway_names[@]}"; do
  if [ -n "${!gateway_name:-}" ]; then gateway_present=$((gateway_present + 1)); fi
done
if [ "$gateway_present" -ne 0 ] && [ "$gateway_present" -ne "${#gateway_names[@]}" ]; then
  echo 'Gateway service/Tool Session 配置必须全缺省或完整投递' >&2
  exit 2
fi
gateway_compose=()
if [ "$gateway_present" -eq 0 ] || [ "$gateway_present" -eq "${#gateway_names[@]}" ]; then
  gateway_config=$(mktemp)
  for gateway_name in "${gateway_names[@]}"; do export "$gateway_name"; done
  OIDC_ISSUER="$OIDC_ISSUER" OIDC_SERVICE_CLIENT_ID="$OIDC_SERVICE_CLIENT_ID" \
  OIDC_WORKER_CLIENT_ID="$OIDC_WORKER_CLIENT_ID" BFF_SERVICE_NAME="$BFF_SERVICE_NAME" \
  SERVICE_CONTAINER_PORT="$SERVICE_CONTAINER_PORT" \
  AGENTGATEWAY_PROVIDER_SECRET_DIRECTORY="$AGENTGATEWAY_PROVIDER_SECRET_DIRECTORY" \
  AGENTGATEWAY_MODEL_PORT="$AGENTGATEWAY_MODEL_PORT" \
  python3 - "$gateway_config" "$gateway_present" <<'PYGATEWAY'
import base64
import json
import os
from pathlib import Path, PurePosixPath
import re
import sys
import tempfile
from urllib.parse import urlsplit

def write_backend_auth(value, gateways):
    # This is deployment metadata derived from the same validated group, not a
    # new input or credential store. Keep it for init-local's subsequent Gateway
    # start, and replace the old value when returning to the all-absent mode.
    source = Path("model-gateway-config.yaml").read_text(encoding="utf-8")
    for marker, replacement in (
        ("gateways: {} # GATEWAY_SERVICE_DELIVERY_GATEWAYS", "gateways: " + json.dumps(gateways)),
        ("backendAuth: null # GATEWAY_SERVICE_DELIVERY_AUTH", "backendAuth: " + json.dumps(value)),
    ):
        if source.count(marker) != 1:
            raise SystemExit("Gateway 原配置缺少唯一投递位置")
        source = source.replace(marker, replacement)
    destination = Path("secrets/agentgateway-service.yaml").resolve()
    overlay = {"configs": {"agentgateway_config": {"file": str(destination)}}}
    for target, content, mode in ((destination, source, 0o444),
                           (Path("secrets/agentgateway-service.compose.json"), json.dumps(overlay), 0o600)):
        descriptor, temporary = tempfile.mkstemp(prefix=".gateway-service-", dir=target.parent)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
                stream.write(content + "\n")
                os.fchmod(stream.fileno(), mode)
            os.replace(temporary, target)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    return overlay

if sys.argv[2] == "0":
    delivery = write_backend_auth(None, {})
    with open(sys.argv[1], "w", encoding="utf-8") as stream:
        json.dump(delivery, stream)
    raise SystemExit(0)

def reject():
    raise SystemExit("Gateway service/Tool 投递无效；必须独立身份、精确私网 URL 与真实 public-only JWKS")

def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            reject()
        result[key] = value
    return result

def canonical(name):
    raw = os.environ[name]
    path = PurePosixPath(raw)
    if not path.is_absolute() or path == PurePosixPath("/") or ".." in path.parts or str(path) != raw:
        reject()
    return path

try:
    public = Path(canonical("GATEWAY_SERVICE_JWKS_FILE"))
    private = canonical("GATEWAY_SERVICE_SIGNING_KEY_FILE")
    private_root = canonical("AGENTGATEWAY_PROVIDER_SECRET_DIRECTORY")
    if private_root not in private.parents or private_root in public.parents or private == public:
        reject()
    if not public.is_file() or public.resolve(strict=True) != public:
        reject()
    document = json.loads(public.read_text(encoding="utf-8"), object_pairs_hook=unique_object)
    if not isinstance(document, dict) or set(document) != {"keys"}:
        reject()
    keys = document["keys"]
    if not isinstance(keys, list) or not keys:
        reject()
    ids = set()
    for key in keys:
        if not isinstance(key, dict) or set(key) - {"kty", "crv", "x", "y", "kid", "alg", "use", "key_ops"}:
            reject()
        if key.get("kty") != "EC" or key.get("crv") != "P-256" or key.get("alg") != "ES256":
            reject()
        if ("use" in key and key["use"] != "sig") or ("key_ops" in key and key["key_ops"] != ["verify"]):
            reject()
        kid = key["kid"]
        if not isinstance(kid, str) or not kid or kid in ids:
            reject()
        ids.add(kid)
        for coordinate in ("x", "y"):
            value = key[coordinate]
            if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{43}", value):
                reject()
            if len(base64.urlsafe_b64decode(value + "=")) != 32:
                reject()
    if os.environ["GATEWAY_SERVICE_KEY_ID"] not in ids:
        reject()
    for native, worker in (("ISSUER", "OIDC_ISSUER"), ("AUDIENCE", "OIDC_SERVICE_CLIENT_ID"),
                           ("CALLER_ID", "OIDC_WORKER_CLIENT_ID")):
        if os.environ["GATEWAY_SERVICE_" + native] == os.environ[worker]:
            reject()
    lifetime = os.environ["GATEWAY_SERVICE_TOKEN_SECONDS"]
    maximum = os.environ["GATEWAY_SERVICE_MAX_TOKEN_SECONDS"]
    if not re.fullmatch(r"[1-9][0-9]*", lifetime) or not re.fullmatch(r"[1-9][0-9]*", maximum):
        reject()
    if int(lifetime) + 10 > int(maximum):
        reject()
    if not re.fullmatch(r"[1-9][0-9]*", os.environ["AGENT_TOOL_SESSION_TOKEN_SECONDS"]):
        reject()
    if (os.environ["AGENT_TOOL_SESSION_ISSUER"] in (os.environ["OIDC_ISSUER"], os.environ["GATEWAY_SERVICE_ISSUER"])
        or os.environ["AGENT_TOOL_SESSION_AUDIENCE"] in (os.environ["OIDC_SERVICE_CLIENT_ID"], os.environ["GATEWAY_SERVICE_AUDIENCE"])):
        reject()
    gateway = urlsplit(os.environ["AGENT_TOOL_GATEWAY_URL"])
    source = Path("model-gateway-config.yaml").read_text(encoding="utf-8")
    bind_ports = re.findall(r"(?m)^- port: ([0-9]+)$", source)
    admin_addresses = re.findall(r"(?m)^  adminAddr: ([^\s]+)$", source)
    if not bind_ports or len(admin_addresses) != 1:
        reject()
    reserved_ports = {int(value) for value in bind_ports}
    reserved_ports.add(int(admin_addresses[0].rsplit(":", 1)[1]))
    reserved_ports.add(int(os.environ["AGENTGATEWAY_MODEL_PORT"]))
    if (gateway.scheme != "http" or gateway.hostname != "agentgateway"
        or gateway.port is None or gateway.port < 1
        or gateway.port in reserved_ports
        or gateway.path not in ("", "/")
        or gateway.username is not None or gateway.password is not None or gateway.query or gateway.fragment
        or not re.fullmatch(r"[a-z][a-z0-9-]{0,62}", os.environ["AGENT_TOOL_GATEWAY_NAME"])):
        reject()
    for name, path in (("AGENT_TOOL_MCP_URL", "/service/v1/agent-tools/mcp"),
                       ("AGENT_TOOL_EXT_MCP_URL", "/")):
        url = urlsplit(os.environ[name])
        if (url.scheme != "http" or url.hostname != os.environ["BFF_SERVICE_NAME"]
            or url.port != int(os.environ["SERVICE_CONTAINER_PORT"])
            or url.path not in (path, "" if path == "/" else path)
            or url.username is not None or url.password is not None or url.query or url.fragment):
            reject()
except (OSError, ValueError, KeyError, TypeError):
    reject()

delivery = write_backend_auth({"jwtSign": {
    "signingKey": {"file": str(private)}, "alg": "ES256",
    "kid": os.environ["GATEWAY_SERVICE_KEY_ID"],
    "claims": {"iss": os.environ["GATEWAY_SERVICE_ISSUER"],
               "aud": os.environ["GATEWAY_SERVICE_AUDIENCE"],
               "sub": os.environ["GATEWAY_SERVICE_CALLER_ID"],
               "azp": os.environ["GATEWAY_SERVICE_CALLER_ID"]},
    "ttl": lifetime + "s"}}, {os.environ["AGENT_TOOL_GATEWAY_NAME"]: {"port": gateway.port}})
delivery["services"] = {"core-bff": {"volumes": [{"type": "bind", "source": str(public),
    "target": str(public), "read_only": True, "bind": {"create_host_path": False}}]}}
with open(sys.argv[1], "w", encoding="utf-8") as stream:
    json.dump(delivery, stream)
PYGATEWAY
  gateway_compose=(-f "$gateway_config")
fi
project=$(python3 -c 'import re,io;print(re.search(r"^name: (\S+)", io.open("compose.yaml",encoding="utf-8").read(), re.M).group(1))')
app_cidr=$(sudo -n docker network inspect "${project}_app" --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}')
[ -n "$app_cidr" ] || { echo "取不到 ${project}_app 网络子网，拒绝创建 Tenant AppRole" >&2; exit 2; }

# sudo 只保留受控构建器选择，避免 Core 镜像构建落到无 cgroup 限额的默认 builder。
compose() { sudo -n --preserve-env=BUILDX_BUILDER docker compose --env-file .env -f compose.yaml "${runtime_compose[@]}" "${adapter_compose[@]}" "${gateway_compose[@]}" "$@"; }
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
tmp=

compose up -d --no-deps --force-recreate --no-build core-bff
# The conformance consumer runs in the original Worker, not in Core. Recreate
# it with the same overlay only when an isolated environment was supplied.
if [ -n "${COMPONENT_CONFORMANCE_ENVIRONMENT_FILE:-}" ]; then
  compose up -d --no-deps --force-recreate --no-build worker
fi
