#!/usr/bin/env bash
# 启动（或重建）core-bff：现取三个 wrapped secret_id，再立即重建容器（DD-70）。
#
# Core 的引导凭据以 response wrapping 一次性投递：wrapping token 只能 unwrap 一次、
# 在 OPENBAO_SECRET_ID_WRAP_TTL 内有效，unwrap 出的 secret_id 只能登录一次。因此
# Core 的每一次启动都要一份新的投递——`docker compose restart/start core-bff`
# 会拿着已被消费的旧投递启动，Core 按泄漏处理并拒绝启动。
#
# 用法（deploy/local 下）：./start-core.sh；仅更换部署配置时 ./start-core.sh --no-build。
# 首次密钥部署：--prepare-action-token（生产 ActionToken）或
# --prepare-conformance-identity（07 §8A 一致性套件的隔离签名身份）；两者都不启动服务。
#
# 镜像先构建、投递后取：构建可能远长于 OPENBAO_SECRET_ID_WRAP_TTL，先取投递再构建，
# 投递在 Core 启动前就已过期。
set -euo pipefail
prepare_action_token=false
prepare_conformance_identity=false
case "$#:$*" in
  0:) build=true ;;
  1:--no-build) build=false ;;
  1:--prepare-action-token) build=false; prepare_action_token=true ;;
  1:--prepare-conformance-identity) build=false; prepare_conformance_identity=true ;;
  *) echo '用法：start-core.sh [--no-build|--prepare-action-token|--prepare-conformance-identity]' >&2; exit 2 ;;
esac
cd "$(dirname "$0")"
# 运行投递（.env、secrets/、data/）在运行目录，代码与配置在本目录（ADR-20 §3）
. ./runtime-dir.sh
(cd ../.. && python3 tools/gen-registry.py --check)
. "$KAILO_RUNTIME_DIR/.env"
: "${OPENBAO_PLATFORM_NAMESPACE:?}" "${OPENBAO_TENANT_PARENT_NAMESPACE:?}" \
  "${OPENBAO_TENANT_PROVISIONER_ROLE_NAME:?}" \
  "${OPENBAO_SECRET_ID_WRAP_TTL:?缺少 .env 中的 OPENBAO_SECRET_ID_WRAP_TTL}"
# DD-70：Core 只读挂载 core-observed/ audit 观察副本；目录缺失或属组不对时
# binding 激活取证必然失败，在取一次性投递之前就拒绝。
./secret-store-audit-dir.sh --check >/dev/null
if [ "$prepare_action_token" = true ]; then
  : "${ACTION_TOKEN_SIGNING_FILE:?}" "${ACTION_TOKEN_PUBLIC_JWKS_LOCATOR:?}" \
    "${ACTION_TOKEN_JWKS_READER_ROLE:?}" "${CHECK_CPUS:?}" "${CHECK_MEMORY:?}"
  . ../../tools/container-safety.sh
  container_safety_init
  container_resource_preflight
fi
if [ "${prepare_conformance_identity:-false}" = true ]; then
  : "${COMPONENT_CONFORMANCE_SIGNING_FILE:?}" "${COMPONENT_CONFORMANCE_PUBLIC_JWKS_LOCATOR:?}" \
    "${COMPONENT_CONFORMANCE_JWKS_READER_ROLE:?}" "${CHECK_CPUS:?}" "${CHECK_MEMORY:?}"
  . ../../tools/container-safety.sh
  container_safety_init
  container_resource_preflight
fi
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
action_token_config=
conformance_signing_config=
tmp=
cleanup_start_core() {
  local status=$?
  trap - EXIT
  if [ -n "$runtime_config" ]; then rm -f -- "$runtime_config" || status=2; fi
  if [ -n "$gateway_config" ]; then rm -f -- "$gateway_config" || status=2; fi
  if [ -n "$adapter_config" ]; then rm -f -- "$adapter_config" || status=2; fi
  if [ -n "$action_token_config" ]; then rm -f -- "$action_token_config" || status=2; fi
  if [ -n "$conformance_signing_config" ]; then rm -f -- "$conformance_signing_config" || status=2; fi
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
# DD-49/70/94: Core reads only versioned SecretRef metadata and Agent-rendered
# public keys here. Its private signing key remains in OpenBao.
action_token_compose=()
if [ -n "${ACTION_TOKEN_SIGNING_FILE:-}" ]; then
  action_token_config=$(mktemp)
  ACTION_TOKEN_SIGNING_FILE="$ACTION_TOKEN_SIGNING_FILE" \
  ACTION_TOKEN_PREPARE="$prepare_action_token" \
  ACTION_TOKEN_PUBLIC_JWKS_LOCATOR="${ACTION_TOKEN_PUBLIC_JWKS_LOCATOR:-}" \
  CHECK_CPUS="${CHECK_CPUS:-}" CHECK_MEMORY="${CHECK_MEMORY:-}" \
  OPENBAO_SERVICE_IDENTITY="${OIDC_SERVICE_CLIENT_ID:?}" \
  OIDC_ISSUER="$OIDC_ISSUER" GATEWAY_SERVICE_ISSUER="${GATEWAY_SERVICE_ISSUER:-}" \
  python3 - "$action_token_config" <<'PYACTIONTOKEN'
import base64
import ctypes
import json
import os
from pathlib import Path, PurePosixPath
import re
import sys

def reject():
    raise SystemExit("ActionToken 投递无效：要求完整版本化 SecretRef 与匹配 public-only JWKS，不挂载私钥")

def unique(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            reject()
        value[key] = item
    return value

def document(raw):
    if not isinstance(raw, str):
        reject()
    path = Path(raw)
    canonical = PurePosixPath(raw)
    if (not canonical.is_absolute() or str(canonical) != raw or ".." in canonical.parts
            or not path.is_file() or path.resolve(strict=True) != path):
        reject()
    value = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique)
    if not isinstance(value, dict):
        reject()
    return path, value

try:
    source, value = document(os.environ["ACTION_TOKEN_SIGNING_FILE"])
    schema = json.loads(Path("../../contracts/domain/action_token_signing_delivery.schema.json").read_text(encoding="utf-8"))
    if set(value) != set(schema["required"]):
        reject()
    for name, field in schema["properties"].items():
        item = value[name]
        if field["type"] == "string" and (not isinstance(item, str) or not item or item.strip() != item
                or any(ord(c) < 32 or ord(c) == 127 for c in item)):
            reject()
        if field["type"] == "integer" and (type(item) is not int or item <= 0):
            reject()
    if (value["secretVersion"] > ctypes.c_uint32(-1).value
            or value["tokenSeconds"] > (1 << (ctypes.sizeof(ctypes.c_int64) * 8 - 1)) - 1
            or not re.fullmatch(r"platform/[A-Za-z0-9_-]+/(?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_-]+", value["secretLocator"])
            or value["secretAudience"] != os.environ["OPENBAO_SERVICE_IDENTITY"]
            or value["issuer"] in {os.environ["OIDC_ISSUER"], os.environ["GATEWAY_SERVICE_ISSUER"]}
            or value["privateKeyField"] == "purpose"):
        reject()
    preparing = os.environ["ACTION_TOKEN_PREPARE"] == "true"
    public = Path(value["jwksFile"])
    public_name = PurePosixPath(value["jwksFile"])
    if (not public_name.is_absolute() or str(public_name) != value["jwksFile"]
            or ".." in public_name.parts or public == source
            or not public.parent.is_dir() or public.parent.resolve(strict=True) != public.parent):
        reject()
    if preparing:
        locator = os.environ["ACTION_TOKEN_PUBLIC_JWKS_LOCATOR"]
        if (not re.fullmatch(r"platform/[A-Za-z0-9_-]+/(?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_-]+", locator)
                or locator == value["secretLocator"] or value["secretVersion"] != 1
                or not re.fullmatch(r"[1-9][0-9]*(?:\.[0-9]+)?", os.environ["CHECK_CPUS"])
                or not re.fullmatch(r"[1-9][0-9]*(?:[kKmMgG][bB]?)?", os.environ["CHECK_MEMORY"])
                or public.parent == source.parent or public.parent.stat().st_mode & 0o077
                or public.parent.stat().st_uid != os.geteuid()
                or public.name in {"action-token-role-id", "action-token-wrapped-secret-id", "action-token-agent.hcl"}
                or any(path.name not in {public.name, "action-token-role-id", "action-token-wrapped-secret-id", "action-token-agent.hcl"}
                    or not path.is_file() or path.is_symlink() for path in public.parent.iterdir())):
            reject()
        # The initial Core command must run before Agent can render the public
        # file. It does not listen, serve a binding or consume this absent file.
        initial = {"environment": {"ACTION_TOKEN_SIGNING_FILE": str(source),
                    "ACTION_TOKEN_PUBLIC_JWKS_LOCATOR": locator},
            "cpus": os.environ["CHECK_CPUS"], "mem_limit": os.environ["CHECK_MEMORY"],
            "memswap_limit": os.environ["CHECK_MEMORY"],
            "volumes": [{"type":"bind", "source":str(source), "target":str(source),
                "read_only":True, "bind":{"create_host_path":False}}]}
        with open(sys.argv[1], "w", encoding="utf-8") as stream:
            json.dump({"services":{"core-bff":initial}}, stream)
        raise SystemExit(0)
    public, jwks = document(value["jwksFile"])
    if public == source or set(jwks) != {"keys"} or not isinstance(jwks["keys"], list) or not jwks["keys"]:
        reject()
    ids = set()
    for key in jwks["keys"]:
        if (not isinstance(key, dict) or set(key) - {"kty", "crv", "alg", "kid", "x", "y", "use", "key_ops"}
                or key.get("kty") != "EC" or key.get("crv") != "P-256" or key.get("alg") != "ES256"
                or key.get("use", "sig") != "sig" or key.get("key_ops", ["verify"]) != ["verify"]):
            reject()
        kid = key.get("kid")
        if not isinstance(kid, str) or not re.fullmatch(r"[1-9][0-9]*", kid) or kid in ids:
            reject()
        ids.add(kid)
        for field in ("x", "y"):
            coordinate = key.get(field)
            if (not isinstance(coordinate, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", coordinate)
                    or len(base64.urlsafe_b64decode(coordinate + "=" * (-len(coordinate) % 4))) != 32):
                reject()
    if str(value["secretVersion"]) not in ids:
        reject()
    delivery = {"environment": {"ACTION_TOKEN_SIGNING_FILE": str(source)}, "volumes": [
        {"type": "bind", "source": str(path), "target": str(path), "read_only": True,
         "bind": {"create_host_path": False}} for path in (source, public)]}
    with open(sys.argv[1], "w", encoding="utf-8") as stream:
        json.dump({"services": {"core-bff": delivery}}, stream)
except (OSError, ValueError, KeyError, TypeError):
    reject()
PYACTIONTOKEN
  action_token_compose=(-f "$action_token_config")
fi
# 07 §8A, ADR-19: first-key initialization of Core's isolated conformance
# signing identity (component_conformance_identity.rs sign). Same delivery
# shape and checks as the ActionToken prepare path, but it may not share any
# key, public locator, issuer, public file, directory or reader role with the
# production ActionToken delivery. Only the initial Core command consumes it.
conformance_signing_compose=()
if [ "${prepare_conformance_identity:-false}" = true ]; then
  conformance_signing_config=$(mktemp)
  COMPONENT_CONFORMANCE_SIGNING_FILE="$COMPONENT_CONFORMANCE_SIGNING_FILE" \
  COMPONENT_CONFORMANCE_PUBLIC_JWKS_LOCATOR="$COMPONENT_CONFORMANCE_PUBLIC_JWKS_LOCATOR" \
  COMPONENT_CONFORMANCE_JWKS_READER_ROLE="$COMPONENT_CONFORMANCE_JWKS_READER_ROLE" \
  ACTION_TOKEN_SIGNING_FILE="${ACTION_TOKEN_SIGNING_FILE:-}" \
  ACTION_TOKEN_PUBLIC_JWKS_LOCATOR="${ACTION_TOKEN_PUBLIC_JWKS_LOCATOR:-}" \
  ACTION_TOKEN_JWKS_READER_ROLE="${ACTION_TOKEN_JWKS_READER_ROLE:-}" \
  CHECK_CPUS="$CHECK_CPUS" CHECK_MEMORY="$CHECK_MEMORY" \
  OPENBAO_SERVICE_IDENTITY="${OIDC_SERVICE_CLIENT_ID:?}" \
  OIDC_ISSUER="$OIDC_ISSUER" GATEWAY_SERVICE_ISSUER="${GATEWAY_SERVICE_ISSUER:-}" \
  python3 - "$conformance_signing_config" <<'PYCONFORMANCESIGNING'
import json
import os
from pathlib import Path, PurePosixPath
import re
import sys

LOCATOR = r"platform/[A-Za-z0-9_-]+/(?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_-]+"
AGENT_FILES = {"conformance-identity-role-id", "conformance-identity-wrapped-secret-id", "conformance-identity-agent.hcl"}

def reject():
    raise SystemExit("一致性签名身份投递无效：要求独立的完整版本化 SecretRef、专属公钥目录与读者角色，不与 ActionToken 共用，不挂载私钥")

def unique(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            reject()
        value[key] = item
    return value

def document(raw):
    if not isinstance(raw, str):
        reject()
    path = Path(raw)
    canonical = PurePosixPath(raw)
    if (not canonical.is_absolute() or str(canonical) != raw or ".." in canonical.parts
            or not path.is_file() or path.resolve(strict=True) != path):
        reject()
    value = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique)
    if not isinstance(value, dict):
        reject()
    return path, value

try:
    source, value = document(os.environ["COMPONENT_CONFORMANCE_SIGNING_FILE"])
    schema = json.loads(Path("../../contracts/domain/action_token_signing_delivery.schema.json").read_text(encoding="utf-8"))
    if set(value) != set(schema["required"]):
        reject()
    for name, field in schema["properties"].items():
        item = value[name]
        if field["type"] == "string" and (not isinstance(item, str) or not item or item.strip() != item
                or any(ord(c) < 32 or ord(c) == 127 for c in item)):
            reject()
        if field["type"] == "integer" and (type(item) is not int or item <= 0):
            reject()
    locator = os.environ["COMPONENT_CONFORMANCE_PUBLIC_JWKS_LOCATOR"]
    role = os.environ["COMPONENT_CONFORMANCE_JWKS_READER_ROLE"]
    public = Path(value["jwksFile"])
    public_name = PurePosixPath(value["jwksFile"])
    if (value["secretVersion"] != 1 or value["privateKeyField"] == "purpose"
            or not re.fullmatch(LOCATOR, value["secretLocator"]) or not re.fullmatch(LOCATOR, locator)
            or locator == value["secretLocator"] or not re.fullmatch(r"[A-Za-z0-9_-]+", role)
            or value["secretAudience"] != os.environ["OPENBAO_SERVICE_IDENTITY"]
            or value["issuer"] in {os.environ["OIDC_ISSUER"], os.environ["GATEWAY_SERVICE_ISSUER"]}
            or not re.fullmatch(r"[1-9][0-9]*(?:\.[0-9]+)?", os.environ["CHECK_CPUS"])
            or not re.fullmatch(r"[1-9][0-9]*(?:[kKmMgG][bB]?)?", os.environ["CHECK_MEMORY"])
            or not public_name.is_absolute() or str(public_name) != value["jwksFile"]
            or ".." in public_name.parts or public == source
            or not public.parent.is_dir() or public.parent.resolve(strict=True) != public.parent
            or public.parent == source.parent or public.parent.stat().st_mode & 0o077
            or public.parent.stat().st_uid != os.geteuid() or public.name in AGENT_FILES
            or any(path.name not in AGENT_FILES | {public.name} or not path.is_file() or path.is_symlink()
                   for path in public.parent.iterdir())):
        reject()
    # Never an alias of the production ActionToken key or its delivery.
    if os.environ["ACTION_TOKEN_SIGNING_FILE"]:
        production_source, production = document(os.environ["ACTION_TOKEN_SIGNING_FILE"])
        if (production_source == source
                or any(production.get(key) == value[key] for key in ("secretLocator", "issuer", "jwksFile"))
                or Path(production["jwksFile"]).parent == public.parent
                or production.get("secretLocator") == locator):
            reject()
    if locator in {os.environ["ACTION_TOKEN_PUBLIC_JWKS_LOCATOR"], value["secretLocator"]} \
            or role == os.environ["ACTION_TOKEN_JWKS_READER_ROLE"]:
        reject()
    initial = {"environment": {"COMPONENT_CONFORMANCE_SIGNING_FILE": str(source),
                "COMPONENT_CONFORMANCE_PUBLIC_JWKS_LOCATOR": locator},
        "cpus": os.environ["CHECK_CPUS"], "mem_limit": os.environ["CHECK_MEMORY"],
        "memswap_limit": os.environ["CHECK_MEMORY"],
        "volumes": [{"type": "bind", "source": str(source), "target": str(source),
            "read_only": True, "bind": {"create_host_path": False}}]}
    with open(sys.argv[1], "w", encoding="utf-8") as stream:
        json.dump({"services": {"core-bff": initial}}, stream)
except (OSError, ValueError, KeyError, TypeError):
    reject()
PYCONFORMANCESIGNING
  conformance_signing_compose=(-f "$conformance_signing_config")
fi
# DD-94/98: the original Core consumer reads a controlled adapter directory.
# No directory means no business-component delivery, not an empty credential or
# a platform startup dependency. Core receives only supplied facts/public JWKS;
# receiver credentials are exact private file mounts for Worker alone. Never
# create missing paths or generate native identities here.
adapter_compose=()
# Preparing the conformance identity renders the very JWKS a conformance
# identity delivery names; that one-off command consumes no adapter delivery.
if [ "${prepare_conformance_identity:-false}" != true ] \
  && [ -n "${APPLICATION_ADAPTER_DIRECTORY_FILE:-}${COMPONENT_CONFORMANCE_ENVIRONMENT_FILE:-}${COMPONENT_CONFORMANCE_FIXTURE_FILE:-}${COMPONENT_CONFORMANCE_IDENTITY_FILE:-}" ]; then
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
from urllib.parse import urlsplit
from uuid import UUID

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
        worker_files, identities = {candidate}, set()
        authorities = configuration.get("nativeReadAuthorities", [])
        if not isinstance(authorities, list) or (peer and authorities):
            reject()
        for authority in authorities:
            if not isinstance(authority, dict) or set(authority) != {
                "bindingId", "generation", "coreBaseUrl", "oidcTokenUrl", "oidcClientId", "oidcClientSecretFile"
            }:
                reject()
            binding, generation = authority["bindingId"], authority["generation"]
            if not isinstance(binding, str) or UUID(binding).int == 0 or type(generation) is not int or generation <= 0:
                reject()
            key = (UUID(binding), generation)
            if key in identities:
                reject()
            identities.add(key)
            for name in ("coreBaseUrl", "oidcTokenUrl"):
                if not isinstance(authority[name], str):
                    reject()
                endpoint = urlsplit(authority[name])
                if endpoint.scheme not in ("http", "https") or not endpoint.hostname or endpoint.username is not None or endpoint.fragment:
                    reject()
                if name == "coreBaseUrl" and (endpoint.query or endpoint.path not in ("", "/")):
                    reject()
            if not isinstance(authority["oidcClientId"], str) or not authority["oidcClientId"].strip():
                reject()
            credential = source_file(authority["oidcClientSecretFile"])
            if credential in files or credential.stat().st_mode & 0o077 or not credential.read_text(encoding="utf-8").strip():
                reject()
            # Only the original Worker reads this receiver credential. Several
            # frozen authorities may use one file; never mount its directory
            # or leak it through Core's public/configuration file set.
            worker_files.add(credential)
        services["worker"] = delivery({names[0]: str(candidate)}, worker_files)
        # The Worker consumes this delivery only through its own container env
        # and mounts; the label lets the caller recreate it exactly when they
        # change (start-core.sh tail), including a removed delivery.
        import hashlib
        fixed = json.dumps(services["worker"], sort_keys=True, separators=(",", ":")).encode()
        services["worker"]["labels"] = {"kailo.component-conformance.delivery": hashlib.sha256(fixed).hexdigest()}
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
if [ "${prepare_action_token:-false}" != true ] && [ "${prepare_conformance_identity:-false}" != true ] \
  && { [ "$gateway_present" -eq 0 ] || [ "$gateway_present" -eq "${#gateway_names[@]}" ]; }; then
  gateway_config=$(mktemp)
  for gateway_name in "${gateway_names[@]}"; do export "$gateway_name"; done
  OIDC_ISSUER="$OIDC_ISSUER" OIDC_SERVICE_CLIENT_ID="$OIDC_SERVICE_CLIENT_ID" \
  OIDC_WORKER_CLIENT_ID="$OIDC_WORKER_CLIENT_ID" BFF_SERVICE_NAME="$BFF_SERVICE_NAME" \
  SERVICE_CONTAINER_PORT="$SERVICE_CONTAINER_PORT" \
  AGENTGATEWAY_PROVIDER_SECRET_DIRECTORY="$AGENTGATEWAY_PROVIDER_SECRET_DIRECTORY" \
  AGENTGATEWAY_MODEL_PORT="$AGENTGATEWAY_MODEL_PORT" \
  AGENTGATEWAY_STREAMING_USAGE_DRAIN_TIMEOUT="${AGENTGATEWAY_STREAMING_USAGE_DRAIN_TIMEOUT:-}" \
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
    usage_drain = os.environ["AGENTGATEWAY_STREAMING_USAGE_DRAIN_TIMEOUT"]
    usage_timeout = {"streamingUsageDrainTimeout": usage_drain} if usage_drain else None
    for marker, replacement in (
        ("gateways: {} # GATEWAY_SERVICE_DELIVERY_GATEWAYS", "gateways: " + json.dumps(gateways)),
        ("backendAuth: null # GATEWAY_SERVICE_DELIVERY_AUTH", "backendAuth: " + json.dumps(value)),
        ("timeout: null # GATEWAY_STREAMING_USAGE_DRAIN_POLICY", "timeout: " + json.dumps(usage_timeout)),
    ):
        if source.count(marker) != 1:
            raise SystemExit("Gateway 原配置缺少唯一投递位置")
        source = source.replace(marker, replacement)
    runtime = Path(os.environ.get("KAILO_RUNTIME_DIR", "."))
    destination = (runtime / "secrets/agentgateway-service.yaml").resolve()
    overlay = {"configs": {"agentgateway_config": {"file": str(destination)}}}
    for target, content, mode in ((destination, source, 0o444),
                           (runtime / "secrets/agentgateway-service.compose.json", json.dumps(overlay), 0o600)):
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
compose() { sudo -n --preserve-env=BUILDX_BUILDER,KAILO_RUNTIME_DIR docker compose --env-file "$KAILO_RUNTIME_DIR/.env" -f compose.yaml "${runtime_compose[@]}" "${action_token_compose[@]}" "${conformance_signing_compose[@]}" "${adapter_compose[@]}" "${gateway_compose[@]}" "$@"; }
root_token=$(python3 -c 'import json,os;print(json.load(open(os.environ["KAILO_RUNTIME_DIR"] + "/secrets/openbao_init.json"))["root_token"])')
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
mv "$tmp" "$KAILO_RUNTIME_DIR/secrets/openbao-core.env"
tmp=

# Versioned public-JWKS rendering shared by both deployment-only signing keys:
# a scoped one-use reader AppRole and a one-off original OpenBao Agent render
# the Core-exported public record to the delivery's jwksFile, then exit.
render_public_jwks() { # <signing delivery> <public locator> <reader role> <file prefix> <label>
  SIGNING_FILE="$1" PUBLIC_JWKS_LOCATOR="$2" JWKS_READER_ROLE="$3" AGENT_FILE_PREFIX="$4" SIGNING_LABEL="$5" \
  OPENBAO_ADDR="$OPENBAO_ADDR" OPENBAO_HTTP_TIMEOUT_SECONDS="$OPENBAO_HTTP_TIMEOUT_SECONDS" \
  OPENBAO_SECRET_ID_TTL="$OPENBAO_SECRET_ID_TTL" OPENBAO_TOKEN_PERIOD="$OPENBAO_TOKEN_PERIOD" \
  OPENBAO_SECRET_ID_WRAP_TTL="$OPENBAO_SECRET_ID_WRAP_TTL" \
  CHECK_CPUS="$CHECK_CPUS" CHECK_MEMORY="$CHECK_MEMORY" AGENT_NETWORK="${project}_app" \
  python3 - <<'PYPUBLICAGENT'
import fcntl
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile

label = os.environ["SIGNING_LABEL"]
prefix = os.environ["AGENT_FILE_PREFIX"]
if prefix not in {"action-token", "conformance-identity"}:
    raise SystemExit("unknown public JWKS delivery")

def require(condition):
    if not condition:
        raise ValueError(label + " Agent delivery refused")

def private_read(path):
    require(path.is_absolute() and path.resolve(strict=True) == path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, encoding="utf-8") as stream:
        metadata = os.fstat(stream.fileno())
        require(stat.S_ISREG(metadata.st_mode) and not metadata.st_mode & 0o077)
        return stream.read()

def atomic(path, content):
    if path.exists():
        private_read(path)
    fd, temporary = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

def seconds(value):
    match = re.fullmatch(r"([1-9][0-9]*)(s|m|h)", value)
    require(match is not None)
    return int(match[1]) * {"s":1,"m":60,"h":3600}[match[2]]

try:
    config = json.loads(Path(os.environ["SIGNING_FILE"]).read_text())
    public = Path(config["jwksFile"])
    directory = public.parent
    require(directory.resolve(strict=True) == directory and not directory.stat().st_mode & 0o077
            and directory.stat().st_uid == os.geteuid())
    locator = os.environ["PUBLIC_JWKS_LOCATOR"]
    namespace, mount, keypath = locator.split("/", 2)
    require(namespace == "platform" and locator != config["secretLocator"])
    role = os.environ["JWKS_READER_ROLE"]
    require(re.fullmatch(r"[A-Za-z0-9_-]+", role) is not None)
    timeout = int(os.environ["OPENBAO_HTTP_TIMEOUT_SECONDS"])
    require(timeout > 0)
    runtime = Path(os.environ["KAILO_RUNTIME_DIR"])
    root = json.loads(private_read((runtime / "secrets/openbao_init.json").resolve()))["root_token"]
    compose = ["sudo","-n","--preserve-env=KAILO_RUNTIME_DIR","docker","compose",
               "--env-file",str(runtime / ".env"),"-f","compose.yaml"]
    def bao(path, fields=None, missing=False, wrap=None, version=None):
        args = (["kv", "get", "-version=" + str(version), "-format=json"] if version is not None
            else ["read" if fields is None else "write", "-format=json"])
        if wrap:
            args.append("-wrap-ttl=" + wrap)
        if fields == {}:
            args.append("-f")
        args.append(path)
        if fields:
            # Bodies, including policies, enter only stdin, never process args.
            args.append("-")
        command = compose + ["exec","-T","-e","BAO_ADDR=" + os.environ["OPENBAO_ADDR"],
            "-e","BAO_NAMESPACE=" + namespace,"openbao","sh","-c",
            'IFS= read -r BAO_TOKEN; export BAO_TOKEN; exec bao "$@"',"bao",*args]
        result = subprocess.run(command, input=root + "\n" + (json.dumps(fields) if fields else ""),
            capture_output=True, text=True, timeout=timeout)
        if missing and result.returncode and "No value found at " + path in result.stderr:
            return None
        require(result.returncode == 0)
        return json.loads(result.stdout) if result.stdout.strip() else None
    lock = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    try:
        record = bao(mount + "/" + keypath, version=1)
        require(record["data"]["metadata"]["version"] == 1 and set(record["data"]["data"]) == {"value"})
        exported = json.loads(record["data"]["data"]["value"])
        require(set(exported) == {"keys"} and len(exported["keys"]) == 1
                and exported["keys"][0]["kid"] == str(config["secretVersion"])
                and not set(exported["keys"][0]).intersection({"d","p","q","k"}))
        policy = f'path "{mount}/data/{keypath}" {{ capabilities = ["read"] }}\n'
        policy_path = "sys/policies/acl/" + role
        existing = bao(policy_path, missing=True)
        if existing is None:
            bao(policy_path, {"policy":policy})
            existing = bao(policy_path)
        require(existing["data"]["policy"] == policy)
        role_path = "auth/approle/role/" + role
        ttl = seconds(os.environ["OPENBAO_TOKEN_PERIOD"])
        wanted = {"bind_secret_id":True, "secret_id_num_uses":1,
            "secret_id_ttl":seconds(os.environ["OPENBAO_SECRET_ID_TTL"]),
            "token_policies":[role],"token_ttl":ttl,"token_max_ttl":ttl}
        existing = bao(role_path, missing=True)
        if existing is None:
            bao(role_path, wanted)
            existing = bao(role_path)
        require(all(existing["data"].get(k) == v for k,v in wanted.items()))
        role_id = bao(role_path + "/role-id")["data"]["role_id"]
        wrapped = bao(role_path + "/secret-id", {}, wrap=os.environ["OPENBAO_SECRET_ID_WRAP_TTL"])
        role_file = directory / (prefix + "-role-id")
        wrapped_file = directory / (prefix + "-wrapped-secret-id")
        agent_file = directory / (prefix + "-agent.hcl")
        require(public not in {role_file, wrapped_file, agent_file})
        quote = json.dumps
        template = '{{ with secret "' + mount + '/data/' + keypath + '?version=1" }}{{ .Data.data.value }}{{ end }}'
        agent = ('exit_after_auth = true\n' + f'vault {{ address = {quote(os.environ["OPENBAO_ADDR"])} }}\n'
            + 'auto_auth {\n method "approle" {\n' + f' namespace = {quote(namespace)}\n config = {{\n'
            + f' role_id_file_path = {quote(str(role_file))}\n secret_id_file_path = {quote(str(wrapped_file))}\n'
            + f' secret_id_response_wrapping_path = {quote(role_path + "/secret-id")}\n'
            + ' }\n }\n}\ntemplate_config { exit_on_retry_failure = true }\n'
            + 'template {\n' + f' contents = {quote(template)}\n destination = {quote(str(public))}\n'
            + ' perms = "0444"\n error_on_missing_key = true\n}\n')
        atomic(role_file, role_id)
        atomic(wrapped_file, wrapped["wrap_info"]["token"])
        atomic(agent_file, agent)
        description = subprocess.run(compose + ["config","--format","json"], capture_output=True, text=True, timeout=timeout)
        require(description.returncode == 0)
        image = json.loads(description.stdout)["services"]["openbao"]["image"]
        require("@sha256:" in image)
        command = ["sudo","-n","docker","create","--pull","never","--read-only",
            "--cpus",os.environ["CHECK_CPUS"],"--memory",os.environ["CHECK_MEMORY"],
            "--memory-swap",os.environ["CHECK_MEMORY"],"--user",f"{os.geteuid()}:{os.getegid()}",
            "--network",os.environ["AGENT_NETWORK"],"--cap-drop","ALL",
            "--security-opt","no-new-privileges", "--mount",f"type=bind,src={directory},dst={directory}",
            "--entrypoint","bao",image,"agent","-config="+str(agent_file)]
        # No root token is passed to Agent, only the scoped one-use wrapped role.
        created = subprocess.run(command, capture_output=True, text=True, timeout=timeout)
        require(created.returncode == 0 and re.fullmatch(r"[a-f0-9]{64}\n?", created.stdout) is not None)
        container = created.stdout.strip()
        try:
            inspected = subprocess.run(["sudo","-n","docker","inspect",container], capture_output=True, text=True, timeout=timeout)
            require(inspected.returncode == 0)
            facts = json.loads(inspected.stdout)[0]
            limits = facts["HostConfig"]
            require(facts["State"]["Status"] == "created" and limits["NanoCpus"] > 0
                    and limits["Memory"] > 0 and limits["MemorySwap"] == limits["Memory"])
            result = subprocess.run(["sudo","-n","docker","start","--attach",container], capture_output=True,
                text=True, timeout=seconds(os.environ["OPENBAO_SECRET_ID_WRAP_TTL"]))
            require(result.returncode == 0)
            ended = subprocess.run(["sudo","-n","docker","inspect",container], capture_output=True, text=True, timeout=timeout)
            require(ended.returncode == 0)
            state = json.loads(ended.stdout)[0]["State"]
            require(state["Status"] == "exited" and state["ExitCode"] == 0 and not state["OOMKilled"])
        finally:
            # Only the exact newly-created one-off Agent is stopped/removed.
            # Never leave a timed-out renderer running with its scoped token.
            stopped = subprocess.run(["sudo","-n","docker","stop",container], capture_output=True, timeout=timeout)
            require(stopped.returncode == 0)
            removed = subprocess.run(["sudo","-n","docker","rm",container], capture_output=True, timeout=timeout)
            require(removed.returncode == 0)
        require(json.loads(public.read_text()) == exported)
        print(label + " Core export and original OpenBao Agent public JWKS readback complete; no binding activated")
    finally:
        os.close(lock)
except Exception:
    raise SystemExit(label + " Agent preparation failed; preserve the exact references and inspect protected delivery, never regenerate a signing key") from None
PYPUBLICAGENT
}

if [ "$prepare_action_token" = true ]; then
  # This is a deployment bootstrap invocation, not a service restart. It writes
  # no platform business objects; a pre-bootstrap binary must fail, not fall back.
  compose run --rm --no-deps --pull never core-bff bootstrap-action-token
  render_public_jwks "$ACTION_TOKEN_SIGNING_FILE" "$ACTION_TOKEN_PUBLIC_JWKS_LOCATOR" \
    "$ACTION_TOKEN_JWKS_READER_ROLE" action-token ActionToken
  exit 0
fi
if [ "${prepare_conformance_identity:-false}" = true ]; then
  # 07 §8A: the same deployment-only path for Core's isolated conformance
  # signing identity (purpose COMPONENT_CONFORMANCE); no service is restarted.
  compose run --rm --no-deps --pull never core-bff bootstrap-conformance-identity
  render_public_jwks "$COMPONENT_CONFORMANCE_SIGNING_FILE" "$COMPONENT_CONFORMANCE_PUBLIC_JWKS_LOCATOR" \
    "$COMPONENT_CONFORMANCE_JWKS_READER_ROLE" conformance-identity "Component conformance identity"
  exit 0
fi

compose up -d --no-deps --force-recreate --no-build core-bff
# The conformance consumer runs in the original Worker, not in Core. Recreate
# it with the same overlay whenever its COMPONENT_CONFORMANCE_* delivery (env
# file path and receiver credential mounts, fixed by the overlay label)
# differs from the running container's - also when the delivery was removed,
# so a finished registration window never leaves a stale candidate behind.
desired_worker=
if [ -n "${adapter_config:-}" ]; then
  desired_worker=$(python3 -I -c 'import json,sys
worker = json.load(open(sys.argv[1], encoding="utf-8"))["services"].get("worker")
print(worker["labels"]["kailo.component-conformance.delivery"] if worker else "")' "$adapter_config")
fi
worker_id=$(compose ps -q worker | head -n 1)
running_worker=
running_environment=
if [ -n "$worker_id" ]; then
  running_worker=$(sudo -n docker inspect --format '{{index .Config.Labels "kailo.component-conformance.delivery"}}' "$worker_id")
  running_environment=$(sudo -n docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$worker_id" \
    | sed -n 's/^COMPONENT_CONFORMANCE_ENVIRONMENT_FILE=//p')
fi
# A supplied delivery always recreates (unchanged behaviour); without one the
# Worker is recreated only to drop a delivery it still carries.
if [ -n "$desired_worker" ] || [ -n "$running_worker" ] || [ -n "$running_environment" ]; then
  if [ -z "$worker_id" ] || [ -n "$desired_worker" ] || [ "$desired_worker" != "$running_worker" ] \
    || [ "${COMPONENT_CONFORMANCE_ENVIRONMENT_FILE:-}" != "$running_environment" ]; then
    compose up -d --no-deps --force-recreate --no-build worker
  fi
fi
