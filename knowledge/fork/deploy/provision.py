#!/usr/bin/env python3
"""Provision this native deployment through Keycloak and OpenBao, never Core.

Like deploy/local/bootstrap.sh, credentials are read only from controlled files
and sent in authenticated request bodies. Existing identities and key versions
are verified, not reset. OpenBao Agent, not this program, renders service files.
"""

import json
import fcntl
import hashlib
import hmac
import os
from pathlib import Path
import re
import secrets
import stat
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

from native_entrypoint import ConfigurationError, http_url, required


def private_file(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
            raise ConfigurationError("operator credential: private regular file required")
        value = stream.read(65537)
    if not value or len(value) > 65536:
        raise ConfigurationError("operator credential: bounded nonempty file required")
    return value.decode("utf-8")


def segment(env, name):
    value = required(env, name)
    if not re.fullmatch(r"[A-Za-z0-9_-]+", value):
        raise ConfigurationError(f"{name}: one path segment required")
    return value


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        # These requests carry operator passwords, bearer tokens or OpenBao
        # service credentials. A redirect is not authority to deliver them to
        # another endpoint, including a same-origin replacement path.
        return None


def open_direct(request, timeout):
    # Controlled native endpoints are contacted directly. Do not inherit a
    # process proxy or urllib's default credential-forwarding redirect handler.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    return opener.open(request, timeout=timeout)


class API:
    def __init__(self, base, timeout, headers=None):
        self.base = base.rstrip("/")
        self.timeout = timeout
        self.headers = headers or {}

    def request(self, method, path, body=None, missing=False, headers=None):
        request = urllib.request.Request(
            self.base + path,
            data=None if body is None else json.dumps(body).encode(),
            method=method,
            headers={"Content-Type": "application/json", **self.headers, **(headers or {})},
        )
        try:
            with open_direct(request, self.timeout) as response:
                raw = response.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            if missing and error.code == 404:
                return None
            # Do not echo upstream error bodies, URLs, credential values or tokens.
            raise ConfigurationError(f"native provisioning request rejected: HTTP {error.code}") from None


def exact(current, wanted, kind):
    if any(current.get(key) != value for key, value in wanted.items()):
        raise ConfigurationError(f"{kind}: existing configuration differs; not overwritten")


def native_client(env, timeout):
    origin = http_url(env, "KNOWLEDGE_NATIVE_ORIGIN", origin=True).rstrip("/")
    base = http_url(env, "KNOWLEDGE_IDP_ADMIN_URL", origin=True).rstrip("/")
    realm = segment(env, "KNOWLEDGE_IDP_REALM")
    client_id = required(env, "KNOWLEDGE_OIDC_CLIENT_ID")
    issuer = http_url(env, "KNOWLEDGE_OIDC_ISSUER_URL").rstrip("/")
    if urllib.parse.urlsplit(issuer).path != "/realms/" + realm:
        raise ConfigurationError("native OIDC issuer and realm disagree")
    credentials = urllib.parse.urlencode({
        "grant_type": "password", "client_id": "admin-cli",
        "username": required(env, "KNOWLEDGE_IDP_ADMIN_USER"),
        "password": private_file(required(env, "KNOWLEDGE_IDP_ADMIN_PASSWORD_FILE")).strip(),
    }).encode()
    with open_direct(urllib.request.Request(
        base + "/realms/master/protocol/openid-connect/token", data=credentials
    ), timeout) as response:
        token = json.load(response)["access_token"]
    api = API(base, timeout, {"Authorization": "Bearer " + token})
    collection = "/admin/realms/" + realm + "/clients"
    query = collection + "?" + urllib.parse.urlencode({"clientId": client_id})
    wanted = {
        "clientId": client_id, "enabled": True, "protocol": "openid-connect",
        "publicClient": False, "standardFlowEnabled": True,
        "directAccessGrantsEnabled": False, "serviceAccountsEnabled": False,
        "redirectUris": [origin + "/api/v1/auth/oidc/callback"],
        "webOrigins": [origin],
    }
    matches = api.request("GET", query)
    if not matches:
        # No retry after a possibly committed POST. A subsequent operator run
        # resolves the exact clientId before deciding whether creation is needed.
        api.request("POST", collection, wanted)
        matches = api.request("GET", query)
    if len(matches) != 1 or matches[0].get("clientId") != client_id:
        raise ConfigurationError("native OIDC client is not unique")
    client = api.request("GET", collection + "/" + matches[0]["id"])
    exact(client, wanted, "native OIDC client")
    secret = api.request("GET", collection + "/" + client["id"] + "/client-secret")
    value = secret.get("value")
    if secret.get("type") != "secret" or not isinstance(value, str) or not value:
        raise ConfigurationError("native OIDC client secret is absent")
    return value, client["id"]


def write_private(path, content):
    # Delivery inputs are replaceable operation artifacts, not a key authority.
    # Lock the existing private directory, not a replaced inode. A crashed
    # writer releases this lock; only its owner-private staging file is retired.
    temporary = path.with_name(path.name + ".pending")
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    staged = False
    try:
        try:
            fcntl.flock(directory, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ConfigurationError("delivery directory has an active writer; retry the original delivery") from None
        if path.is_symlink():
            raise ConfigurationError("delivery file must not be a symlink")
        try:
            pending = temporary.lstat()
        except FileNotFoundError:
            pending = None
        if pending is not None:
            if (not stat.S_ISREG(pending.st_mode) or stat.S_IMODE(pending.st_mode) != 0o600
                    or pending.st_uid != os.geteuid() or pending.st_nlink != 1):
                raise ConfigurationError("delivery staging file is not an owner-private regular file")
            temporary.unlink()
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        staged = True
        with os.fdopen(fd, "w") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        staged = False
        os.fsync(directory)
    finally:
        try:
            if staged:
                temporary.unlink()
        finally:
            os.close(directory)


def model_input(env):
    """Metadata exported from the existing generation, never key material."""
    value = json.loads(private_file(required(env, "KNOWLEDGE_MODEL_DELIVERY_INPUT_FILE")))
    if not isinstance(value, dict) or set(value) != {"projection", "models"}:
        raise ConfigurationError("model delivery: exact projection and models required")
    projection = value["projection"]
    models = value["models"]
    reference = projection["serviceSecretRef"]
    reader = projection["secretReader"]
    if (set(reference) != {"locator", "version", "audience"}
        or type(reference["version"]) is not int or reference["version"] < 1
        or reference["locator"] != projection["secretRef"]["locator"]
        or reference["version"] != projection["secretRef"]["version"]
        or reference["audience"] == projection["secretRef"]["audience"]
        or reference["audience"] != reader["audience"]
        or reader["servicePrincipalId"] != projection["gatewayPrincipalId"]
        or type(projection["generation"]) is not int or projection["generation"] < 1
        or not re.fullmatch(r"[0-9a-f]{64}", projection["configDigest"])
        or not re.fullmatch(r"[1-9][0-9]*", projection["nativeScopeRef"])):
        raise ConfigurationError("model delivery: frozen service scope differs")
    for field in ("bindingId", "gatewayPrincipalId"):
        if str(uuid.UUID(projection[field])) != projection[field]:
            raise ConfigurationError("model delivery: canonical identity required")
    challenges = projection["deliveryChallenges"]
    routes = projection["routes"]
    route_ids = projection["routeResourceIds"]
    if (not isinstance(models, list) or not models or len(models) != len(route_ids)
        or len(challenges) != len(models) or len(routes) != len(models)
        or len(set(route_ids)) != len(models)):
        raise ConfigurationError("model delivery: complete route mapping required")
    seen = set()
    for model in models:
        if set(model) != {"routeResourceId", "nativeModelRef", "baseUrl"}:
            raise ConfigurationError("model delivery: unknown model mapping fields")
        route = [route for route in routes if route["resourceId"] == model["routeResourceId"]]
        challenge = [c for c in challenges if c["routeResourceId"] == model["routeResourceId"]]
        if (model["routeResourceId"] not in route_ids or len(route) != 1 or len(challenge) != 1
            or not re.fullmatch(r"[0-9a-f]{64}", challenge[0]["verificationNonce"])
            or str(uuid.UUID(model["nativeModelRef"])) != model["nativeModelRef"]
            or model["nativeModelRef"] in seen):
            raise ConfigurationError("model delivery: duplicate or invalid native mapping")
        seen.add(model["nativeModelRef"])
        http_url({"url": model["baseUrl"]}, "url")
    if len({m["routeResourceId"] for m in models}) != len(models):
        raise ConfigurationError("model delivery: duplicate route")
    return value


def model_reader(env):
    """Register the existing service reader; Agent alone fetches the fixed KV value."""
    value = model_input(env)
    projection = value["projection"]
    reference = projection["serviceSecretRef"]
    parts = reference["locator"].split("/")
    if parts[0] == "tenants" and len(parts) >= 5:
        if str(uuid.UUID(parts[1])) != parts[1] or parts[1] != projection["tenantId"]:
            raise ConfigurationError("model reader: tenant locator mismatch")
        namespace, mount, path = "/".join(parts[:2]), parts[2], "/".join(parts[3:])
    else:
        raise ConfigurationError("model reader: original tenant KV locator required")
    if any(not re.fullmatch(r"[A-Za-z0-9_-]+", p) for p in [mount, *path.split("/")]):
        raise ConfigurationError("model reader: invalid KV path")
    role = projection["secretReader"]["roleName"]
    if not re.fullmatch(r"[A-Za-z0-9_-]+", role):
        raise ConfigurationError("model reader: registered role required")
    timeout = int(required(env, "KNOWLEDGE_PROVISION_TIMEOUT_SECONDS"))
    if timeout <= 0:
        raise ConfigurationError("provision timeout must be positive")
    bao_url = http_url(env, "KNOWLEDGE_BAO_URL", origin=True).rstrip("/")
    bootstrap = json.loads(private_file(required(env, "KNOWLEDGE_BAO_BOOTSTRAP_FILE")))
    api = API(bao_url, timeout, {"X-Vault-Token": bootstrap["root_token"], "X-Vault-Namespace": namespace})
    # No namespace, mount, secret, or key creation: this is the original Core KV.
    mounts = api.request("GET", "/v1/sys/mounts")["data"]
    exact(mounts[mount + "/"], {"type": "kv", "options": {"version": "2"}}, "model KV mount")
    auth = api.request("GET", "/v1/sys/auth")["data"]
    if auth.get("approle/", {}).get("type") != "approle":
        raise ConfigurationError("model reader: existing AppRole auth required")
    policy = f'path "{mount}/data/{path}" {{ capabilities = ["read"] }}\n'
    policy_path = "/v1/sys/policies/acl/" + role
    current = api.request("GET", policy_path, missing=True)
    if current is None:
        api.request("PUT", policy_path, {"policy": policy})
        current = api.request("GET", policy_path)
    exact(current["data"], {"policy": policy}, "model reader policy")
    ttl = required(env, "KNOWLEDGE_BAO_TOKEN_TTL")
    ttl_match = re.fullmatch(r"([1-9][0-9]*)(s|m|h)", ttl)
    if not ttl_match:
        raise ConfigurationError("model reader: bounded token TTL required")
    ttl_seconds = int(ttl_match[1]) * {"s": 1, "m": 60, "h": 3600}[ttl_match[2]]
    role_path = "/v1/auth/approle/role/" + role
    wanted = {"bind_secret_id": True, "secret_id_num_uses": 1, "token_policies": [role],
              "token_ttl": ttl, "token_max_ttl": ttl}
    current = api.request("GET", role_path, missing=True)
    if current is None:
        api.request("POST", role_path, wanted)
        current = api.request("GET", role_path)
    exact(current["data"], {"bind_secret_id": True, "secret_id_num_uses": 1, "token_policies": [role]}, "model reader role")
    exact(current["data"], {"token_ttl": ttl_seconds, "token_max_ttl": ttl_seconds}, "model reader TTL")
    role_id = api.request("GET", role_path + "/role-id")["data"]["role_id"]
    directory = delivery_directory(env)
    wrapped = api.request("POST", role_path + "/secret-id", {},
                          headers={"X-Vault-Wrap-TTL": required(env, "KNOWLEDGE_BAO_WRAP_TTL")})
    write_private(directory / "model-role-id", role_id)
    write_private(directory / "model-wrapped-secret-id", wrapped["wrap_info"]["token"])
    # RequestID is the fixed openbao-template v1.0.1 Secret.RequestID, from the
    # same successful read as Data.data.value and Data.metadata.version.
    metadata = json.dumps(value, separators=(",", ":"))
    contents = ('{{ with secret "' + mount + '/data/' + path + '?version=' + str(reference["version"])
                + '" }}{"delivery":{{ ' + json.dumps(metadata) + ' }},"requestId":{{ .RequestID | toJSON }},'
                '"version":{{ .Data.metadata.version | toJSON }},"value":{{ .Data.data.value | toJSON }}}{{ end }}')
    quote = json.dumps
    agent = ('exit_after_auth = true\n' + f'vault {{ address = {quote(bao_url)} }}\n'
        + 'auto_auth {\n method "approle" {\n' + f'  namespace = {quote(namespace)}\n  config = {{\n'
        + f'   role_id_file_path = {quote(str(directory / "model-role-id"))}\n'
        + f'   secret_id_file_path = {quote(str(directory / "model-wrapped-secret-id"))}\n'
        + f'   secret_id_response_wrapping_path = {quote("auth/approle/role/" + role + "/secret-id")}\n'
        + '  }\n }\n}\n' + 'template_config { exit_on_retry_failure = true }\n'
        + 'template {\n' + f' contents = {quote(contents)}\n'
        + f' destination = {quote(str(directory / "model-credential.json"))}\n'
        + ' perms = "0600"\n error_on_missing_key = true\n}\n')
    write_private(directory / "model-agent.hcl", agent)
    print(json.dumps({"bindingId": projection["bindingId"], "generation": projection["generation"],
                      "agentConfig": str(directory / "model-agent.hcl")}))


def model_delivery(env):
    """Use only the existing native admin session and credential subresource."""
    value = model_input(env)
    projection = value["projection"]
    material = json.loads(private_file(required(env, "KNOWLEDGE_MODEL_CREDENTIAL_FILE")))
    if (set(material) != {"delivery", "requestId", "version", "value"}
        or material["delivery"] != value or material["version"] != projection["serviceSecretRef"]["version"]
        or not isinstance(material["value"], str) or not material["value"]
        or any(c in material["value"] for c in "\r\n\x00")
        or str(uuid.UUID(material["requestId"])) != material["requestId"]):
        raise ConfigurationError("model delivery: Agent output differs from fixed reference")
    timeout = int(required(env, "KNOWLEDGE_PROVISION_TIMEOUT_SECONDS"))
    if timeout <= 0:
        raise ConfigurationError("provision timeout must be positive")
    session = private_file(required(env, "KNOWLEDGE_NATIVE_ADMIN_SESSION_FILE")).strip()
    if not session or any(c.isspace() for c in session):
        raise ConfigurationError("model delivery: native session token required")
    api = API(http_url(env, "KNOWLEDGE_NATIVE_ORIGIN", origin=True) + "/api/v1", timeout,
              {"Authorization": "Bearer " + session})
    receipts = []
    for model in value["models"]:
        path = "/models/" + model["nativeModelRef"]
        route = next(r for r in projection["routes"] if r["resourceId"] == model["routeResourceId"])
        challenge = next(c for c in projection["deliveryChallenges"] if c["routeResourceId"] == model["routeResourceId"])

        def verify_model():
            response = api.request("GET", path)
            if response.get("success") is not True:
                raise ConfigurationError("model delivery: native model lookup failed")
            current = response["data"]
            exact(current, {"id": model["nativeModelRef"], "tenant_id": int(projection["nativeScopeRef"]),
                            "name": route["nativeId"], "is_builtin": False}, "native model")
            exact(current["parameters"], {"base_url": model["baseUrl"]}, "native model endpoint")

        def read_proof():
            response = api.request("PUT", path + "/credentials", {"verification_nonce": challenge["verificationNonce"]})
            if response.get("success") is not True:
                raise ConfigurationError("model delivery: native credential read-back failed")
            proof = response["data"]
            # Older native handlers silently ignored unknown request fields.
            # Missing nonce support must fail before sending any credential.
            if proof.get("verification_nonce") != challenge["verificationNonce"]:
                raise ConfigurationError("model delivery: native challenge unsupported or stale")
            if "api_key_proof" not in proof:
                if proof.get("fields", {}).get("api_key", {}).get("configured") is not False:
                    raise ConfigurationError("model delivery: native proof is absent")
            elif not isinstance(proof["api_key_proof"], str) or not re.fullmatch(r"[0-9a-f]{64}", proof["api_key_proof"]):
                raise ConfigurationError("model delivery: malformed native proof")
            return proof

        def proof_matches(proof):
            message = ("application-model-key:v1\x00" + projection["nativeScopeRef"] + "\x00"
                       + model["nativeModelRef"] + "\x00" + challenge["verificationNonce"])
            expected = hmac.new(material["value"].encode(), message.encode(), hashlib.sha256).hexdigest()
            return (proof.get("verification_nonce") == challenge["verificationNonce"]
                    and isinstance(proof.get("api_key_proof"), str)
                    and hmac.compare_digest(proof["api_key_proof"], expected))

        verify_model()
        proof = read_proof()
        if not proof_matches(proof):
            # A read proves the current value differs. One PUT only; an ambiguous
            # acknowledgement is recovered by a read, never a second write.
            try:
                api.request("PUT", path + "/credentials", {"api_key": material["value"]})
            except (ConfigurationError, OSError):
                pass
            proof = read_proof()
        if not proof_matches(proof):
            raise ConfigurationError("model delivery: stored native credential not verified")
        verify_model()
        receipts.append({"bindingId": projection["bindingId"], "generation": projection["generation"],
            "configDigest": projection["configDigest"], "servicePrincipalId": projection["gatewayPrincipalId"],
            "routeResourceId": model["routeResourceId"], "nativeScopeRef": projection["nativeScopeRef"],
            "nativeModelRef": model["nativeModelRef"], "secretRef": projection["serviceSecretRef"],
            "requestId": material["requestId"], "verificationNonce": challenge["verificationNonce"],
            "nativeProof": proof["api_key_proof"]})
    destination = delivery_directory(env) / "model-delivery-receipt.json"
    write_private(destination, json.dumps(receipts, separators=(",", ":")))
    print(json.dumps({"bindingId": projection["bindingId"], "generation": projection["generation"],
                      "receiptFile": str(destination), "modelsVerified": len(receipts)}))


def delivery_directory(env):
    directory = Path(required(env, "KNOWLEDGE_DELIVERY_DIRECTORY"))
    if not directory.is_absolute() or directory.is_symlink():
        raise ConfigurationError("delivery directory must be a canonical absolute path")
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if directory.resolve() != directory or directory.stat().st_mode & 0o077:
        raise ConfigurationError("delivery directory must be private and canonical")
    return directory


def adapter_reader(env):
    """Deliver the existing adapter's reader role; never mint its business secrets."""
    config = json.loads(private_file(required(env, "KNOWLEDGE_ADAPTER_CONFIG_FILE")))
    validation = config["management"]["validation"]
    tenant = config["tenantId"]
    if str(uuid.UUID(tenant)) != tenant or not isinstance(validation["secretDeliveries"], list):
        raise ConfigurationError("adapter reader: invalid fixed tenant or deliveries")
    outputs = delivery_directory({"KNOWLEDGE_DELIVERY_DIRECTORY": required(env, "KNOWLEDGE_ADAPTER_DELIVERY_DIRECTORY")})
    bootstrap_dir = delivery_directory({"KNOWLEDGE_DELIVERY_DIRECTORY": required(env, "KNOWLEDGE_ADAPTER_BOOTSTRAP_DIRECTORY")})
    if outputs == bootstrap_dir or outputs in bootstrap_dir.parents or bootstrap_dir in outputs.parents:
        raise ConfigurationError("adapter reader: bootstrap must not be mounted into adapter outputs")
    if config["actionTokenJwksFile"] != required(env, "KNOWLEDGE_ADAPTER_JWKS_FILE"):
        raise ConfigurationError("adapter reader: JWKS mount differs from actual adapter input")
    # Both containers run as the explicitly delivered owner. No root fallback,
    # chown of unrelated directories, or world-readable credential workaround.
    uid, gid = (int(required(env, key)) for key in ("KNOWLEDGE_ADAPTER_UID", "KNOWLEDGE_ADAPTER_GID"))
    if uid <= 0 or gid <= 0 or (os.geteuid(), os.getegid()) != (uid, gid) or any(
        (p.stat().st_uid, p.stat().st_gid) != (uid, gid) for p in (outputs, bootstrap_dir)
    ):
        raise ConfigurationError("adapter reader: private directories must match non-root runtime identity")
    namespace = "tenants/" + tenant
    paths, destinations, sockets, templates = set(), set(), set(), []
    quote = json.dumps
    for entry in validation["secretDeliveries"]:
        if set(entry) != {"secretKey", "locator", "version", "audience", "secretFile", "secretSocket", "secretValueKey"}:
            raise ConfigurationError("adapter reader: exact delivery fields required")
        prefix = namespace + "/"
        if not entry["locator"].startswith(prefix):
            raise ConfigurationError("adapter reader: cross-tenant secret refused")
        parts = entry["locator"][len(prefix):].split("/")
        if len(parts) < 2 or any(not re.fullmatch(r"[A-Za-z0-9_-]+", part) for part in parts):
            raise ConfigurationError("adapter reader: invalid fixed KV locator")
        if type(entry["version"]) is not int or entry["version"] <= 0 or not re.fullmatch(r"[A-Za-z0-9_-]+", entry["secretValueKey"]):
            raise ConfigurationError("adapter reader: fixed version and native field required")
        destination, socket = Path(entry["secretFile"]), Path(entry["secretSocket"])
        if any(not p.is_absolute() or p.parent != outputs or p.is_symlink() for p in (destination, socket)):
            raise ConfigurationError("adapter reader: credential and socket must be direct private outputs")
        if destination in destinations or destination == socket:
            raise ConfigurationError("adapter reader: duplicate or overlapping output")
        destinations.add(destination)
        sockets.add(socket)
        path = parts[0] + "/data/" + "/".join(parts[1:])
        paths.add(path)
        contents = ('{{ with secret ' + quote(path + "?version=" + str(entry["version"]))
                    + ' }}{{ index .Data.data ' + quote(entry["secretValueKey"]) + ' }}{{ end }}')
        templates.append({"contents": contents, "destination": str(destination),
                          "perms": "0600", "error_on_missing_key": True})
    if len(sockets) != 1 or sockets & destinations or not {Path(config["nativeMcpBearerFile"]), Path(config["oidcClientSecretFile"])} <= destinations:
        raise ConfigurationError("adapter reader: one dedicated proxy and all consumed credentials required")
    role = segment(env, "KNOWLEDGE_ADAPTER_BAO_ROLE")
    timeout = int(required(env, "KNOWLEDGE_PROVISION_TIMEOUT_SECONDS"))
    if timeout <= 0:
        raise ConfigurationError("provision timeout must be positive")
    bao_url = http_url(env, "KNOWLEDGE_BAO_URL", origin=True).rstrip("/")
    operator = json.loads(private_file(required(env, "KNOWLEDGE_BAO_BOOTSTRAP_FILE")))
    api = API(bao_url, timeout, {"X-Vault-Token": operator["root_token"], "X-Vault-Namespace": namespace})
    # This path registers only the existing reader; it cannot create namespace,
    # native key, ServicePrincipal, release, binding, Resource or relation.
    mounts = api.request("GET", "/v1/sys/mounts")["data"]
    for mount in {path.split("/")[0] for path in paths}:
        exact(mounts[mount + "/"], {"type": "kv", "options": {"version": "2"}}, "adapter KV mount")
    if api.request("GET", "/v1/sys/auth")["data"].get("approle/", {}).get("type") != "approle":
        raise ConfigurationError("adapter reader: existing AppRole auth required")
    policy = ''.join(f'path "{path}" {{ capabilities = ["read"] }}\n' for path in sorted(paths))
    policy_path = "/v1/sys/policies/acl/" + role
    current = api.request("GET", policy_path, missing=True)
    if current is None:
        api.request("PUT", policy_path, {"policy": policy})
        current = api.request("GET", policy_path)
    exact(current["data"], {"policy": policy}, "adapter reader policy")
    ttl = required(env, "KNOWLEDGE_BAO_TOKEN_TTL")
    matched = re.fullmatch(r"([1-9][0-9]*)(s|m|h)", ttl)
    if not matched:
        raise ConfigurationError("adapter reader: bounded token TTL required")
    seconds = int(matched[1]) * {"s": 1, "m": 60, "h": 3600}[matched[2]]
    role_path = "/v1/auth/approle/role/" + role
    wanted = {"bind_secret_id": True, "secret_id_num_uses": 1, "token_policies": [role],
              "token_ttl": ttl, "token_max_ttl": ttl}
    current = api.request("GET", role_path, missing=True)
    if current is None:
        api.request("POST", role_path, wanted)
        current = api.request("GET", role_path)
    exact(current["data"], {"bind_secret_id": True, "secret_id_num_uses": 1,
          "token_policies": [role], "token_ttl": seconds, "token_max_ttl": seconds}, "adapter reader role")
    role_id = api.request("GET", role_path + "/role-id")["data"]["role_id"]
    wrapped = api.request("POST", role_path + "/secret-id", {},
                          headers={"X-Vault-Wrap-TTL": required(env, "KNOWLEDGE_BAO_WRAP_TTL")})
    write_private(bootstrap_dir / "adapter-role-id", role_id)
    write_private(bootstrap_dir / "adapter-wrapped-secret-id", wrapped["wrap_info"]["token"])
    agent = ('exit_after_auth = false\n' + f'vault {{ address = {quote(bao_url)} }}\n'
        + 'auto_auth {\n method "approle" {\n' + f'  namespace = {quote(namespace)}\n  config = {{\n'
        + f'   role_id_file_path = {quote(str(bootstrap_dir / "adapter-role-id"))}\n'
        + f'   secret_id_file_path = {quote(str(bootstrap_dir / "adapter-wrapped-secret-id"))}\n'
        + f'   secret_id_response_wrapping_path = {quote("auth/approle/role/" + role + "/secret-id")}\n'
        + '  }\n }\n}\n'
        + 'api_proxy { use_auto_auth_token = "force" }\n'
        + f'listener "unix" {{ address = {quote(str(next(iter(sockets))))}\n socket_mode = "0600"\n tls_disable = true\n }}\n'
        + 'template_config { exit_on_retry_failure = true }\n')
    for template in templates:
        agent += 'template {\n' + ''.join(f' {key} = {quote(value)}\n' for key, value in template.items()) + '}\n'
    write_private(bootstrap_dir / "adapter-agent.hcl", agent)
    print(json.dumps({"bindingId": config["bindingId"], "bindingVersion": validation["bindingVersion"],
                      "agentConfig": str(bootstrap_dir / "adapter-agent.hcl"), "secretReferences": len(templates)}))


def provision(env):
    timeout = int(required(env, "KNOWLEDGE_PROVISION_TIMEOUT_SECONDS"))
    if timeout <= 0:
        raise ConfigurationError("provision timeout must be positive")
    directory = Path(required(env, "KNOWLEDGE_DELIVERY_DIRECTORY"))
    if not directory.is_absolute() or directory.is_symlink():
        raise ConfigurationError("delivery directory must be a canonical absolute path")
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if directory.resolve() != directory or directory.stat().st_mode & 0o077:
        raise ConfigurationError("delivery directory must be private and canonical")
    namespace = segment(env, "KNOWLEDGE_BAO_NAMESPACE")
    mount = segment(env, "KNOWLEDGE_BAO_KV_MOUNT")
    path = segment(env, "KNOWLEDGE_BAO_SECRET_PATH")
    role = segment(env, "KNOWLEDGE_BAO_ROLE")
    ttl = required(env, "KNOWLEDGE_BAO_TOKEN_TTL")
    wrap_ttl = required(env, "KNOWLEDGE_BAO_WRAP_TTL")
    bao_url = http_url(env, "KNOWLEDGE_BAO_URL", origin=True).rstrip("/")
    bootstrap = json.loads(private_file(required(env, "KNOWLEDGE_BAO_BOOTSTRAP_FILE")))
    root = API(bao_url, timeout, {"X-Vault-Token": bootstrap["root_token"]})
    if root.request("GET", "/v1/sys/namespaces/" + namespace, missing=True) is None:
        root.request("POST", "/v1/sys/namespaces/" + namespace, {})
    api = API(bao_url, timeout, {**root.headers, "X-Vault-Namespace": namespace})
    mounts = api.request("GET", "/v1/sys/mounts")["data"]
    if mount + "/" not in mounts:
        api.request("POST", "/v1/sys/mounts/" + mount, {"type": "kv", "options": {"version": "2"}})
        mounts = api.request("GET", "/v1/sys/mounts")["data"]
    exact(mounts[mount + "/"], {"type": "kv", "options": {"version": "2"}}, "native KV mount")
    secret, client_id = native_client(env, timeout)
    key = "/v1/" + mount + "/data/" + path
    existing = api.request("GET", key, missing=True)
    if existing is None:
        material = {name: secrets.token_hex(32) for name in (
            "db_password", "redis_password", "system_signing_key", "jwt_secret"
        )}
        material["system_aes_key"] = secrets.token_hex(16)  # Native AES requires 32 UTF-8 bytes.
        material["oidc_client_secret"] = secret
        api.request("POST", key, {"options": {"cas": 0}, "data": material})
        existing = api.request("GET", key)
    material = existing["data"]["data"]
    names = ("db_password", "redis_password", "system_aes_key", "system_signing_key", "jwt_secret", "oidc_client_secret")
    if set(material) != set(names) or any(
        not isinstance(material[name], str) or not material[name]
        or any(character in material[name] for character in "\r\n\x00") for name in names
    ) or len(material["system_aes_key"].encode()) != 32:
        raise ConfigurationError("existing native KV material is invalid; not replaced")
    if not secrets.compare_digest(material["oidc_client_secret"], secret):
        raise ConfigurationError("native OIDC secret differs from stored version; explicit rotation required")
    auth = api.request("GET", "/v1/sys/auth")["data"]
    if "approle/" not in auth:
        api.request("POST", "/v1/sys/auth/approle", {"type": "approle"})
    elif auth["approle/"]["type"] != "approle":
        raise ConfigurationError("native AppRole mount has a different type")
    policy = f'path "{mount}/data/{path}" {{ capabilities = ["read"] }}\n'
    policy_path = "/v1/sys/policies/acl/" + role
    current_policy = api.request("GET", policy_path, missing=True)
    if current_policy is None:
        api.request("PUT", policy_path, {"policy": policy})
    else:
        exact(current_policy["data"], {"policy": policy}, "native Agent policy")
    role_path = "/v1/auth/approle/role/" + role
    wanted_role = {"bind_secret_id": True, "secret_id_num_uses": 1,
                   "token_policies": [role], "token_ttl": ttl, "token_max_ttl": ttl}
    current_role = api.request("GET", role_path, missing=True)
    if current_role is None:
        api.request("POST", role_path, wanted_role)
    else:
        exact(current_role["data"], {"bind_secret_id": True, "secret_id_num_uses": 1,
                                    "token_policies": [role]}, "native Agent role")
    role_id = api.request("GET", role_path + "/role-id")["data"]["role_id"]
    wrapped = api.request("POST", role_path + "/secret-id", {}, headers={"X-Vault-Wrap-TTL": wrap_ttl})
    write_private(directory / "role-id", role_id)
    write_private(directory / "wrapped-secret-id", wrapped["wrap_info"]["token"])
    templates = []
    locator = mount + "/data/" + path
    version = existing["data"]["metadata"]["version"]
    for name in names:
        templates.append({"contents": '{{ with secret "' + locator + '?version=' + str(version)
                          + '" }}{{ .Data.data.' + name + ' }}{{ end }}',
                          "destination": str(directory / name), "perms": "0600", "error_on_missing_key": True})
    templates.append({"contents": '{{ with secret "' + locator + '?version=' + str(version)
                      + '" }}appendonly yes\ndir /data\nrequirepass {{ .Data.data.redis_password | toJSON }}\n{{ end }}',
                      "destination": str(directory / "redis_config"), "perms": "0600", "error_on_missing_key": True})
    quote = json.dumps
    agent = (
        'exit_after_auth = true\n'
        f'vault {{ address = {quote(bao_url)} }}\n'
        'auto_auth {\n method "approle" {\n'
        f'  namespace = {quote(namespace)}\n  config = {{\n'
        f'   role_id_file_path = {quote(str(directory / "role-id"))}\n'
        f'   secret_id_file_path = {quote(str(directory / "wrapped-secret-id"))}\n'
        f'   secret_id_response_wrapping_path = {quote("auth/approle/role/" + role + "/secret-id")}\n'
        '  }\n }\n}\n'
        'template_config { exit_on_retry_failure = true }\n'
    )
    for template in templates:
        agent += 'template {\n' + ''.join(
            f' {key} = {quote(value)}\n' for key, value in template.items()
        ) + '}\n'
    write_private(directory / "agent.hcl", agent)
    print(json.dumps({"nativeClientId": client_id, "namespace": namespace,
                      "secretVersion": version, "agentConfig": str(directory / "agent.hcl")}))


if __name__ == "__main__":
    try:
        operation = sys.argv[1] if len(sys.argv) == 2 else "native" if len(sys.argv) == 1 else ""
        actions = {"native": provision, "model-reader": model_reader, "model-delivery": model_delivery,
                   "adapter-reader": adapter_reader}
        if operation not in actions:
            raise ConfigurationError("expected native, model-reader, model-delivery, or adapter-reader")
        actions[operation](os.environ)
    except (ConfigurationError, OSError, ValueError, KeyError, TypeError) as error:
        # ConfigurationError messages contain field names only. HTTP transport
        # and JSON errors can contain URLs/body values, so never print them.
        print(str(error) if isinstance(error, ConfigurationError) else "native provisioning failed; inspect controlled configuration and retry by lookup", file=sys.stderr)
        sys.exit(78)
