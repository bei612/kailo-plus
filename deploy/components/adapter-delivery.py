#!/usr/bin/env python3
"""Controlled delivery for one REMOTE_ADAPTER binding (DD-70/94, 03 §9, 07 §1.2).

Three operator steps, all keyed by the binding plan that
tools/component-release/flow/component-bind.mjs --plan-only writes BEFORE the
governed application_binding.create (bindingId/servicePrincipalId are fixed
UUIDv5 values, so locators are known in advance):

  config  Render the adapter's controlled configuration from its checked-in
          template (deploy/components/<component>-adapter.template.json) and
          the plan: binding identity plus management.validation with the exact
          SecretRefs Core will freeze and the Agent output file per secretKey.
  reader  In the Tenant namespace (<parent>/<tenantId>) create the adapter's
          read-only policy for exactly those version-pinned KV paths and its
          AppRole, then write role-id, a response-wrapped one-use secret-id and
          the OpenBao Agent HCL (api_proxy force auto-auth on a private Unix
          socket + one template per secret, field `value`). Same shape as
          knowledge/fork/deploy/provision.py adapter-reader, but generic and
          with separate operator / in-network OpenBao addresses.
  client  Register the adapter's own confidential service client in the IdP
          with the Agent-rendered oidc_client_secret (never generated here),
          exactly like provision.py adapter-client. Run after the binding was
          created and the Agent rendered the file.

It never writes a binding secret value (only Core's governed create does),
never prints a credential, and never resets an existing role, policy or client
that differs: it refuses instead.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

SEGMENT = re.compile(r"[A-Za-z0-9_-]+")


class Refused(Exception):
    pass


def require(condition, reason):
    if not condition:
        raise Refused(reason)


def private_file(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode) and not info.st_mode & 0o077, f"{path}: private regular file required")
        value = stream.read(65537)
    require(0 < len(value) <= 65536, f"{path}: bounded nonempty file required")
    return value.decode("utf-8")


def write_private(path, content):
    path = Path(path)
    temporary = path.with_name("." + path.name + ".tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def canonical_uuid(value, name):
    require(isinstance(value, str) and str(uuid.UUID(value)) == value and uuid.UUID(value).int != 0, f"{name}: canonical UUID required")
    return value


def private_dir(path, name):
    path = Path(path)
    require(path.is_absolute() and path.is_dir() and not path.is_symlink() and path.resolve() == path, f"{name}: existing canonical directory required")
    info = path.stat()
    require(not info.st_mode & 0o077 and info.st_uid == os.geteuid(), f"{name}: owner-only directory of the delivery user required")
    return path


def load_plan(path):
    plan = json.loads(Path(path).read_text(encoding="utf-8"))
    for key in ("tenantId", "bindingId", "servicePrincipalId", "componentReleaseId"):
        canonical_uuid(plan.get(key), key)
    require(isinstance(plan.get("secretRefs"), list) and plan["secretRefs"], "plan.secretRefs required")
    require(isinstance(plan.get("nativeScopeRef"), str) and plan["nativeScopeRef"], "plan.nativeScopeRef required (component-bind.mjs --native-scope-ref)")
    require(re.fullmatch(r"[0-9a-f]{64}", plan.get("artifactDigest", "")) is not None, "plan.artifactDigest required")
    return plan


# ---- config -----------------------------------------------------------------

def fill(value, values):
    if isinstance(value, dict):
        return {k: fill(v, values) for k, v in value.items()}
    if isinstance(value, list):
        return [fill(v, values) for v in value]
    if isinstance(value, str):
        if value.startswith("{{deliveryDir}}/"):
            name = value[len("{{deliveryDir}}/"):]
            require(SEGMENT.fullmatch(name.replace(".", "_")) is not None, "invalid delivery file name")
            return values["deliveryDir"] + "/" + name
        if value == "{{tools}}":
            require(values["tools"] is not None, "template needs {{tools}}: pass --release-dir and --registration")
            return values["tools"]
        match = re.fullmatch(r"\{\{(plan|secretFile|deliveryDir|socket):?([A-Za-z0-9_]*)\}\}", value)
        if match:
            kind, name = match.groups()
            if kind == "plan":
                require(name in values["plan"], f"template references missing plan field {name}")
                return values["plan"][name]
            if kind == "secretFile":
                require(name in values["files"], f"template references undeclared secret {name}")
                return values["files"][name]
            return values[kind]
    return value


def unresolved(value):
    if isinstance(value, dict):
        return any(unresolved(v) for v in value.values())
    if isinstance(value, list):
        return any(unresolved(v) for v in value)
    return isinstance(value, str) and "{{" in value


def canonical_digest(value):
    # Same bytes as collab_bridge::limits::canonical_json (sorted keys, no
    # whitespace, UTF-8 kept) and the adapters' canonical().
    text = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def release_tools(release_dir, registration_paths, plan):
    """Adapter MCP tool list from the approved release's toolDefinitions and
    the ACTIVE contract schema documents (digest-addressed, never hand-copied)."""
    registration = json.loads((Path(release_dir) / "registration.json").read_text(encoding="utf-8"))
    manifest = json.loads(registration["manifestJson"])
    require(manifest["id"] == plan["componentReleaseId"], "release dir does not match the plan")
    documents = {}
    for path in registration_paths:
        for text in json.loads(Path(path).read_text(encoding="utf-8"))["schemaDocuments"]:
            parsed = json.loads(text)
            documents[canonical_digest(parsed)] = parsed
    versions = {a["actionKey"]: a["version"] for a in manifest["actionDefinitions"]}
    tools = []
    for tool in manifest["toolDefinitions"]:
        require(tool["inputSchemaHash"] in documents, f"no contract schema for tool {tool['name']}")
        tools.append({"name": tool["name"], "actionKey": tool["actionKey"], "actionVersion": versions[tool["actionKey"]],
                      "inputSchemaDigest": tool["inputSchemaHash"], "inputSchema": documents[tool["inputSchemaHash"]]})
    return tools


def command_config(args):
    plan = load_plan(args.plan)
    tools = None
    if args.release_dir or args.registration:
        require(args.release_dir and args.registration, "--release-dir and --registration go together")
        tools = release_tools(args.release_dir, args.registration, plan)
    delivery = Path(args.delivery_dir)
    require(delivery.is_absolute(), "--delivery-dir must be absolute")
    socket = str(delivery / args.socket_name)
    files, deliveries = {}, []
    for ref in plan["secretRefs"]:
        key = ref["secretKey"]
        require(SEGMENT.fullmatch(key) is not None and key not in files, "invalid or duplicate secretKey")
        files[key] = str(delivery / key)
        deliveries.append({"secretKey": key, "locator": ref["locator"], "version": ref["version"], "audience": ref["audience"],
                           "secretFile": files[key], "secretSocket": socket, "secretValueKey": "value"})
    template = json.loads(Path(args.template).read_text(encoding="utf-8"))
    template.pop("$comment", None)
    config = fill(template, {"plan": plan, "files": files, "deliveryDir": str(delivery), "socket": socket, "tools": tools})
    config["bindingId"] = plan["bindingId"]
    config["tenantId"] = plan["tenantId"]
    if "workspaceId" in plan:
        config["workspaceId"] = plan["workspaceId"]
    config["management"] = {
        "componentTypeKey": plan["componentTypeKey"], "componentReleaseId": plan["componentReleaseId"],
        "artifactDigest": plan["artifactDigest"], "protocolRange": "1",
        "validation": {
            "bindingVersion": plan["bindingVersion"], "servicePrincipalId": plan["servicePrincipalId"],
            "adapterServiceRef": plan["adapterServiceRef"], "nativeInstanceRef": plan["nativeInstanceRef"],
            "nativeScopeRef": plan["nativeScopeRef"], "isolationMode": plan["isolationMode"],
            "normalizedConfig": plan["normalizedConfig"], "secretDeliveries": deliveries,
            "actionVersions": plan["actionVersions"],
        },
    }
    require(not unresolved(config), "template still has {{...}} placeholders; fill the native facts first")
    out = Path(args.out)
    text = json.dumps(config, indent=2, sort_keys=True) + "\n"
    if out.exists():
        require(private_file(str(out)) == text, f"{out} exists with different content; write a new file")
    else:
        write_private(out, text)
    print(json.dumps({"out": str(out), "bindingId": plan["bindingId"], "secretFiles": sorted(files), "socket": socket}))


# ---- reader -----------------------------------------------------------------

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class API:
    def __init__(self, base, timeout, headers):
        self.base, self.timeout, self.headers = base.rstrip("/"), timeout, headers
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def request(self, method, path, body=None, missing=False, headers=None):
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(self.base + path, data=data, method=method,
                                         headers={**self.headers, **(headers or {}), "Content-Type": "application/json"})
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                raw = response.read()
        except urllib.error.HTTPError as error:
            if missing and error.code == 404:
                return None
            raise Refused(f"{method} {path.split('?')[0]}: HTTP {error.code}") from None
        return json.loads(raw) if raw.strip() else {}


def seconds(value):
    match = re.fullmatch(r"([1-9][0-9]*)(s|m|h)", value)
    require(match is not None, "TTL must look like 30m / 1h")
    return int(match[1]) * {"s": 1, "m": 60, "h": 3600}[match[2]]


def command_reader(args):
    config = json.loads(private_file(args.config))
    validation = config["management"]["validation"]
    tenant = canonical_uuid(config["tenantId"], "tenantId")
    namespace = f"{args.tenant_parent}/{tenant}"
    bootstrap = private_dir(args.bootstrap_dir, "--bootstrap-dir")
    paths, templates, sockets, outputs = set(), [], set(), None
    for entry in validation["secretDeliveries"]:
        require(set(entry) == {"secretKey", "locator", "version", "audience", "secretFile", "secretSocket", "secretValueKey"}, "exact delivery fields required")
        require(entry["locator"].startswith(namespace + "/"), "cross-tenant SecretRef refused")
        parts = entry["locator"][len(namespace) + 1:].split("/")
        require(len(parts) >= 2 and all(SEGMENT.fullmatch(p) for p in parts), "invalid KV locator")
        require(type(entry["version"]) is int and entry["version"] > 0 and SEGMENT.fullmatch(entry["secretValueKey"]), "fixed version and field required")
        destination, socket = Path(entry["secretFile"]), Path(entry["secretSocket"])
        outputs = outputs or destination.parent
        require(destination.parent == outputs and socket.parent == outputs, "credentials and socket must be direct outputs of one delivery directory")
        sockets.add(str(socket))
        path = parts[0] + "/data/" + "/".join(parts[1:])
        paths.add(path)
        templates.append({"contents": '{{ with secret ' + json.dumps(path + "?version=" + str(entry["version"]))
                          + ' }}{{ index .Data.data ' + json.dumps(entry["secretValueKey"]) + ' }}{{ end }}',
                          "destination": str(destination), "perms": "0600", "error_on_missing_key": True})
    require(len(sockets) == 1, "exactly one Agent socket required")
    private_dir(outputs, "delivery directory")
    require(outputs != bootstrap and outputs not in bootstrap.parents and bootstrap not in outputs.parents, "bootstrap must not be mounted into adapter outputs")
    role = args.role
    require(SEGMENT.fullmatch(role) is not None, "--role must be one path segment")
    token = json.loads(private_file(args.root_token_file))["root_token"]
    api = API(args.bao_url, args.timeout, {"X-Vault-Token": token, "X-Vault-Namespace": namespace})
    mounts = api.request("GET", "/v1/sys/mounts")["data"]
    for mount in {p.split("/")[0] for p in paths}:
        require(mounts.get(mount + "/", {}).get("type") == "kv" and mounts[mount + "/"].get("options", {}).get("version") == "2", "Tenant KV v2 mount missing")
    require(api.request("GET", "/v1/sys/auth")["data"].get("approle/", {}).get("type") == "approle", "Tenant AppRole auth missing (Tenant provisioning incomplete)")
    policy = "".join(f'path "{p}" {{ capabilities = ["read"] }}\n' for p in sorted(paths))
    policy_path = "/v1/sys/policies/acl/" + role
    current = api.request("GET", policy_path, missing=True)
    if current is None:
        api.request("PUT", policy_path, {"policy": policy})
        current = api.request("GET", policy_path)
    require(current["data"].get("policy") == policy, "existing policy differs; refusing to overwrite")
    ttl = seconds(args.token_ttl)
    wanted = {"bind_secret_id": True, "secret_id_num_uses": 1, "token_policies": [role], "token_ttl": ttl, "token_max_ttl": ttl}
    role_path = "/v1/auth/approle/role/" + role
    current = api.request("GET", role_path, missing=True)
    if current is None:
        api.request("POST", role_path, wanted)
        current = api.request("GET", role_path)
    require(all(current["data"].get(k) == v for k, v in wanted.items()), "existing AppRole differs; refusing to overwrite")
    role_id = api.request("GET", role_path + "/role-id")["data"]["role_id"]
    wrapped = api.request("POST", role_path + "/secret-id", {}, headers={"X-Vault-Wrap-TTL": args.wrap_ttl})["wrap_info"]["token"]
    write_private(bootstrap / "adapter-role-id", role_id)
    write_private(bootstrap / "adapter-wrapped-secret-id", wrapped)
    quote = json.dumps
    agent = ("exit_after_auth = false\n" + f"vault {{ address = {quote(args.agent_bao_url)} }}\n"
             + 'auto_auth {\n method "approle" {\n' + f"  namespace = {quote(namespace)}\n  config = {{\n"
             + f"   role_id_file_path = {quote(str(bootstrap / 'adapter-role-id'))}\n"
             + f"   secret_id_file_path = {quote(str(bootstrap / 'adapter-wrapped-secret-id'))}\n"
             + f"   secret_id_response_wrapping_path = {quote('auth/approle/role/' + role + '/secret-id')}\n"
             + "  }\n }\n}\n"
             + 'api_proxy { use_auto_auth_token = "force" }\n'
             + f'listener "unix" {{\n address = {quote(next(iter(sockets)))}\n socket_mode = "0600"\n tls_disable = true\n}}\n'
             + "template_config { exit_on_retry_failure = true }\n")
    for template in templates:
        agent += "template {\n" + "".join(f" {k} = {quote(v)}\n" for k, v in template.items()) + "}\n"
    write_private(bootstrap / args.hcl_name, agent)
    print(json.dumps({"bindingId": config["bindingId"], "namespace": namespace, "role": role,
                      "agentConfig": str(bootstrap / args.hcl_name), "templates": len(templates), "socket": next(iter(sockets))}))


# ---- client -----------------------------------------------------------------

def command_client(args):
    config = json.loads(private_file(args.config))
    client_id = config["oidcClientId"]
    refused = {c for c in args.refuse_client_ids.split(",") if c}
    issuer = args.issuer.rstrip("/")
    require(isinstance(client_id, str) and SEGMENT.fullmatch(client_id) and client_id not in refused, "independent adapter client id required")
    require(config["oidcTokenUrl"] == issuer + "/protocol/openid-connect/token", "adapter oidcTokenUrl must be the platform issuer token endpoint")
    deliveries = config["management"]["validation"]["secretDeliveries"]
    require(any(d["secretFile"] == config["oidcClientSecretFile"] for d in deliveries), "oidcClientSecretFile must be an Agent-delivered SecretRef")
    secret = private_file(config["oidcClientSecretFile"]).strip()
    require(secret and not any(c in secret for c in "\r\n\x00"), "delivered client secret unavailable")
    base = urllib.parse.urlunsplit(urllib.parse.urlsplit(issuer)[:2] + ("", "", ""))
    realm = issuer.rsplit("/realms/", 1)[1]
    form = urllib.parse.urlencode({"grant_type": "password", "client_id": "admin-cli", "username": args.admin_user,
                                   "password": private_file(args.admin_password_file).strip()}).encode()
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(urllib.request.Request(f"{base}/realms/master/protocol/openid-connect/token", data=form), timeout=args.timeout) as r:
            token = json.loads(r.read())["access_token"]
    except urllib.error.HTTPError as error:
        raise Refused(f"IdP admin login: HTTP {error.code}") from None
    api = API(f"{base}/admin/realms/{realm}", args.timeout, {"Authorization": "Bearer " + token})
    mapper = {"name": "adapter-core-service-audience", "protocol": "openid-connect", "protocolMapper": "oidc-audience-mapper",
              "consentRequired": False, "config": {"included.custom.audience": args.service_audience, "access.token.claim": "true",
              "id.token.claim": "false", "userinfo.token.claim": "false", "introspection.token.claim": "true"}}
    wanted = {"clientId": client_id, "enabled": True, "protocol": "openid-connect", "publicClient": False,
              "standardFlowEnabled": False, "implicitFlowEnabled": False, "directAccessGrantsEnabled": False,
              "serviceAccountsEnabled": True, "fullScopeAllowed": False, "redirectUris": [], "webOrigins": []}
    lookup = "/clients?" + urllib.parse.urlencode({"clientId": client_id})
    found = api.request("GET", lookup)
    require(isinstance(found, list) and len(found) <= 1, "client lookup not unique")
    if not found:
        try:
            api.request("POST", "/clients", {**wanted, "secret": secret, "protocolMappers": [mapper]})
        except Refused:
            pass  # resolved only by exact read-back below; never re-POST or reset
        found = api.request("GET", lookup)
    require(isinstance(found, list) and len(found) == 1, "client creation unconfirmed")
    path = "/clients/" + urllib.parse.quote(found[0]["id"], safe="")
    current = api.request("GET", path)
    require(all(current.get(k) == v for k, v in wanted.items()), "existing client differs; explicit change required")
    mappers = api.request("GET", path + "/protocol-mappers/models")
    require(isinstance(mappers, list) and len(mappers) == 1 and all(mappers[0].get(k) == v for k, v in mapper.items() if k != "config")
            and mappers[0]["config"] == {**mappers[0]["config"], **mapper["config"]}, "exact audience mapper required")
    stored = api.request("GET", path + "/client-secret")
    require(stored.get("value") == secret, "stored client secret differs from the binding SecretRef; explicit rotation required")
    print(json.dumps({"bindingId": config["bindingId"], "clientId": client_id, "identityVerified": True, "bindingActivated": False}))


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    c = sub.add_parser("config")
    c.add_argument("--plan", required=True)
    c.add_argument("--template", required=True)
    c.add_argument("--delivery-dir", required=True)
    c.add_argument("--socket-name", default="bao.sock")
    c.add_argument("--out", required=True)
    c.add_argument("--release-dir", help="render.mjs output; with --registration fills {{tools}}")
    c.add_argument("--registration", action="append", help="contracts/adapter/<category>.v<N>/registration.json (repeatable)")
    r = sub.add_parser("reader")
    r.add_argument("--config", required=True)
    r.add_argument("--role", required=True)
    r.add_argument("--bootstrap-dir", required=True)
    r.add_argument("--bao-url", required=True, help="operator address, e.g. http://127.0.0.1:58200")
    r.add_argument("--agent-bao-url", required=True, help="address the Agent container uses, e.g. http://openbao:8200")
    r.add_argument("--root-token-file", required=True)
    r.add_argument("--tenant-parent", default="tenants")
    r.add_argument("--token-ttl", default="1h")
    r.add_argument("--wrap-ttl", default="30m")
    r.add_argument("--hcl-name", default="adapter-agent.hcl")
    r.add_argument("--timeout", type=int, default=15)
    k = sub.add_parser("client")
    k.add_argument("--config", required=True)
    k.add_argument("--issuer", required=True)
    k.add_argument("--admin-user", required=True)
    k.add_argument("--admin-password-file", required=True)
    k.add_argument("--service-audience", required=True, help="OIDC_SERVICE_CLIENT_ID")
    k.add_argument("--refuse-client-ids", default="", help="platform client ids the adapter must not reuse")
    k.add_argument("--timeout", type=int, default=15)
    args = parser.parse_args()
    try:
        {"config": command_config, "reader": command_reader, "client": command_client}[args.command](args)
    except (Refused, OSError, ValueError, KeyError, TypeError) as error:
        # Refused messages carry field names only; other parser/transport
        # errors can contain values, so they are not echoed.
        print(str(error) if isinstance(error, Refused) else "adapter delivery refused; inspect the controlled inputs", file=sys.stderr)
        sys.exit(78)


if __name__ == "__main__":
    main()
