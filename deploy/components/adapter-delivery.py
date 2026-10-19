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
          An isolated conformance delivery (07 §8A) passes the suite PEP
          provider's endpoints and the isolated audience explicitly
          (--core-pep-url, --oidc-token-url, --action-token-audience).
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
import subprocess
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
#
# Template placeholders (every value comes from controlled delivery, an
# operator-supplied native fact or the bind plan; nothing is defaulted):
#   whole-string  {{plan:F}} {{secretFile:K}} {{socket}} {{tools}}
#                 {{envint:NAME}} {{setint:NAME}} {{setjson:NAME}} {{action:ACTION_KEY}}
#   embeddable    {{env:NAME}} {{signing:issuer|jwksFile}} {{set:NAME}} {{plan:F}}
#                 {{job:NAME}} {{deliveryDir}}
# {{env:*}} reads the platform deploy .env (--env-file, same trusted shell
# convention as deploy/local); {{signing:*}} reads ACTION_TOKEN_SIGNING_FILE;
# {{set:*}}/{{setint:*}} come from --set NAME=VALUE (non-secret native facts);
# {{setjson:*}} from --set-json NAME=FILE; {{action:K}} is the plan's
# actionVersion of K; {{job:NAME}} is the deterministic native Job identity
# kailo-<bindingId>-<NAME> shared by the adapter and native action deliveries.

WHOLE = re.compile(r"\{\{(plan|secretFile|socket|tools|envint|setint|setjson|action):?([A-Za-z0-9_.@-]*)\}\}")
EMBEDDED = re.compile(r"\{\{(env|signing|set|plan|job|deliveryDir):?([A-Za-z0-9_.@-]*)\}\}")
NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def lookup(table, name, kind):
    require(name in table, f"template needs {{{{{kind}:{name}}}}} but it was not supplied")
    return table[name]


def positive_int(value, label):
    require(isinstance(value, str) and re.fullmatch(r"[1-9][0-9]*", value) is not None, f"{label} must be a positive integer")
    return int(value)


def whole(kind, name, values):
    if kind == "plan":
        return lookup(values["plan"], name, kind)
    if kind == "secretFile":
        return lookup(values["files"], name, kind)
    if kind == "socket":
        return values["socket"]
    if kind == "tools":
        require(values["tools"] is not None, "template needs {{tools}}: pass --release-dir and --registration")
        return values["tools"]
    if kind == "envint":
        return positive_int(lookup(values["env"], name, kind), name)
    if kind == "setint":
        return positive_int(lookup(values["sets"], name, kind), name)
    if kind == "setjson":
        return lookup(values["setjson"], name, kind)
    versions = [a["actionVersion"] for a in values["plan"]["actionVersions"] if a["actionKey"] == name]
    require(len(versions) == 1, f"plan has no single actionVersion for {name}")
    return versions[0]


def embedded(kind, name, values):
    if kind == "deliveryDir":
        return values["deliveryDir"]
    if kind == "job":
        require(SEGMENT.fullmatch(name) is not None, "invalid native job name")
        return f"kailo-{values['plan']['bindingId']}-{name}"
    table = {"env": values["env"], "signing": values["signing"], "set": values["sets"], "plan": values["plan"]}[kind]
    value = lookup(table, name, kind)
    require(isinstance(value, str) and value != "", f"{kind}:{name} must be a non-empty string")
    return value


def fill(value, values):
    if isinstance(value, dict):
        return {k: fill(v, values) for k, v in value.items()}
    if isinstance(value, list):
        return [fill(v, values) for v in value]
    if isinstance(value, str):
        match = WHOLE.fullmatch(value)
        if match:
            return whole(*match.groups(), values)
        return EMBEDDED.sub(lambda m: embedded(m.group(1), m.group(2), values), value)
    return value


def placeholders(value, kinds):
    found = set()
    if isinstance(value, dict):
        for item in value.values():
            found |= placeholders(item, kinds)
    elif isinstance(value, list):
        for item in value:
            found |= placeholders(item, kinds)
    elif isinstance(value, str):
        for kind, name in re.findall(r"\{\{([a-zA-Z]+):([A-Za-z0-9_.@-]*)\}\}", value):
            if kind in kinds:
                found.add(name)
    return found


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


def deploy_env(path, names):
    """Evaluate only the requested names of the trusted platform .env (it is a
    shell file with derived values such as OIDC_ISSUER). Values stay in memory."""
    if not names:
        return {}
    require(all(NAME.fullmatch(n) for n in names), "invalid environment name")
    require(path is not None, "template reads the platform .env: pass --env-file")
    script = 'set -a; . "$1" >/dev/null 2>&1 || exit 3; shift; for k in "$@"; do printf "%s\\0" "${!k-}"; done'
    result = subprocess.run(["bash", "-c", script, "bash", str(Path(path).resolve()), *sorted(names)],
                            capture_output=True, timeout=30, check=False)
    require(result.returncode == 0, "platform .env could not be evaluated")
    values = result.stdout.decode("utf-8").split("\0")[:-1]
    require(len(values) == len(names), "platform .env evaluation was incomplete")
    env = dict(zip(sorted(names), values))
    require(all(env.values()), "a referenced platform .env value is empty: " + ",".join(k for k, v in env.items() if not v))
    return env


def signing_facts(path):
    if path is None:
        return {}
    signing = json.loads(Path(path).read_text(encoding="utf-8"))
    require(isinstance(signing, dict) and isinstance(signing.get("issuer"), str) and isinstance(signing.get("jwksFile"), str)
            and Path(signing["jwksFile"]).is_absolute(), "ACTION_TOKEN_SIGNING_FILE needs issuer and absolute jwksFile")
    # Only public facts of the delivery; secretLocator/version are not used here.
    return {"issuer": signing["issuer"], "jwksFile": signing["jwksFile"]}


PRIVATE_JWK_FIELDS = {"d", "p", "q", "dp", "dq", "qi", "k", "oth"}


def install_public(delivery, spec):
    name, _, source = spec.partition("=")
    require(SEGMENT.fullmatch(name.replace(".", "_")) is not None and source, "--public-file NAME=SOURCE required")
    jwks = json.loads(Path(source).read_text(encoding="utf-8"))
    require(isinstance(jwks, dict) and set(jwks) == {"keys"} and isinstance(jwks["keys"], list) and jwks["keys"]
            and all(isinstance(k, dict) and not set(k) & PRIVATE_JWK_FIELDS for k in jwks["keys"]),
            f"{source}: public-only JWKS required")
    text = json.dumps(jwks, indent=2, sort_keys=True) + "\n"
    target = delivery / name
    if target.exists():
        require(private_file(str(target)) == text, f"{target} exists with different content")
    else:
        write_private(target, text)
    return str(target)


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


def key_values(items, label):
    table = {}
    for item in items or []:
        name, sep, value = item.partition("=")
        require(sep == "=" and NAME.fullmatch(name) is not None and name not in table, f"{label} NAME=VALUE with unique names required")
        table[name] = value
    return table


def command_config(args):
    plan = load_plan(args.plan)
    tools = None
    if args.release_dir or args.registration:
        require(args.release_dir and args.registration, "--release-dir and --registration go together")
        tools = release_tools(args.release_dir, args.registration, plan)
    delivery = Path(args.delivery_dir)
    require(delivery.is_absolute(), "--delivery-dir must be absolute")
    template = json.loads(Path(args.template).read_text(encoding="utf-8"))
    template.pop("$comment", None)
    socket = str(delivery / args.socket_name)
    files, deliveries = {}, []
    for ref in plan["secretRefs"]:
        key = ref["secretKey"]
        require(SEGMENT.fullmatch(key) is not None and key not in files, "invalid or duplicate secretKey")
        files[key] = str(delivery / key)
        deliveries.append({"secretKey": key, "locator": ref["locator"], "version": ref["version"], "audience": ref["audience"],
                           "secretFile": files[key], "secretSocket": socket, "secretValueKey": "value"})
    setjson = {}
    for name, path in key_values(args.set_json, "--set-json").items():
        setjson[name] = json.loads(Path(path).read_text(encoding="utf-8"))
    values = {"plan": plan, "files": files, "deliveryDir": str(delivery), "socket": socket, "tools": tools,
              "env": deploy_env(args.env_file, placeholders(template, {"env", "envint"})),
              "signing": signing_facts(args.action_token_signing_file),
              "sets": key_values(args.set, "--set"), "setjson": setjson}
    config = fill(template, values)
    # 07 §8A isolated conformance delivery: the adapter and the native action
    # delivery answer to the suite PEP provider (conformance-provider.mjs
    # /oidc/token and /service/v1/adapter/pep_check) under the isolated
    # identity's audience, never the platform issuer/BFF/production audience.
    # Only explicitly supplied values replace the template's; nothing defaults.
    overrides = (("oidcTokenUrl", "--oidc-token-url", args.oidc_token_url, "/oidc/token"),
                 ("corePepUrl", "--core-pep-url", args.core_pep_url, "/service/v1/adapter/pep_check"),
                 ("actionTokenAudience", "--action-token-audience", args.action_token_audience, None))
    for key, flag, value, path in overrides:
        if value is None:
            continue
        require(key in config, f"{flag}: the template has no {key}")
        if path is None:
            # The template carries the production audience; an isolated identity
            # must never reuse it (component_conformance_identity.rs validate).
            require(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]*", value) is not None and value != config[key],
                    f"{flag}: a valid audience different from the template's production audience required")
        else:
            parts = urllib.parse.urlsplit(value)
            require(parts.scheme in ("http", "https") and parts.hostname and parts.username is None
                    and parts.password is None and not parts.query and not parts.fragment and parts.path == path,
                    f"{flag}: absolute http(s) URL ending exactly in {path} required")
        config[key] = value
    config["bindingId"] = plan["bindingId"]
    config["tenantId"] = plan["tenantId"]
    if "workspaceId" in plan:
        config["workspaceId"] = plan["workspaceId"]
    if args.kind == "adapter":
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
    else:
        # Native Cells current-actor delivery (file-storage/deploy/start.sh and
        # common/auth/native-action.go): no management or SecretRef metadata.
        require(tools is None, "--kind cells-native has no tools")
    require(not unresolved(config), "template still has {{...}} placeholders; supply the native facts (--set/--set-json) first")
    for spec in args.public_file or []:
        install_public(delivery, spec)
    out = Path(args.out)
    text = json.dumps(config, indent=2, sort_keys=True) + "\n"
    if out.exists():
        require(private_file(str(out)) == text, f"{out} exists with different content; write a new file")
    else:
        write_private(out, text)
    print(json.dumps({"out": str(out), "kind": args.kind, "bindingId": plan["bindingId"], "secretFiles": sorted(files), "socket": socket}))


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
    # A second consumer of the same binding credential in its own directory
    # (Cells native action callback: file-storage/deploy/start.sh requires its
    # delivery to be separate from the adapter's). Same version-pinned path and
    # field, rendered by the same Agent; never a copy made by this script.
    if args.extra_secret:
        require(args.extra_delivery_dir, "--extra-secret needs --extra-delivery-dir")
        extra = private_dir(args.extra_delivery_dir, "--extra-delivery-dir")
        require(all(extra != d and extra not in d.parents and d not in extra.parents for d in (outputs, bootstrap)),
                "extra delivery directory must be separate from the adapter delivery and bootstrap")
        by_key = {e["secretKey"]: e for e in validation["secretDeliveries"]}
        for key in args.extra_secret:
            require(key in by_key, f"--extra-secret {key} is not a binding secret")
            entry = by_key[key]
            parts = entry["locator"][len(namespace) + 1:].split("/")
            path = parts[0] + "/data/" + "/".join(parts[1:])
            templates.append({"contents": '{{ with secret ' + json.dumps(path + "?version=" + str(entry["version"]))
                              + ' }}{{ index .Data.data ' + json.dumps(entry["secretValueKey"]) + ' }}{{ end }}',
                              "destination": str(extra / key), "perms": "0600", "error_on_missing_key": True})
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
    # Core identifies the binding's adapter caller only by normalizedConfig.client_id
    # (application_binding_pep.rs check); the registered client must be that one.
    require(config["management"]["validation"]["normalizedConfig"].get("client_id") == client_id,
            "oidcClientId must equal the binding normalizedConfig.client_id")
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
    c.add_argument("--kind", choices=["adapter", "cells-native"], default="adapter",
                   help="adapter (adds management.validation) or the native Cells action delivery")
    c.add_argument("--env-file", help="platform deploy/local/.env for {{env:*}} / {{envint:*}}")
    c.add_argument("--action-token-signing-file", help="ACTION_TOKEN_SIGNING_FILE for {{signing:*}}")
    c.add_argument("--public-file", action="append", help="NAME=SOURCE: install a public-only JWKS into the delivery directory")
    c.add_argument("--set", action="append", help="NAME=VALUE non-secret native fact for {{set:*}} / {{setint:*}}")
    c.add_argument("--set-json", action="append", help="NAME=FILE JSON native fact for {{setjson:*}}")
    c.add_argument("--oidc-token-url", help="07 §8A isolated conformance only: explicit token endpoint replacing the "
                   "template's OIDC_ISSUER/protocol/openid-connect/token, e.g. http://conformance-provider:<port>/oidc/token")
    c.add_argument("--core-pep-url", help="07 §8A isolated conformance only: explicit PEP replacing the template's BFF "
                   "service URL, e.g. http://conformance-provider:<port>/service/v1/adapter/pep_check")
    c.add_argument("--action-token-audience", help="07 §8A isolated conformance only: the isolated identity audience "
                   "(must differ from the release's production executionConnector.actionTokenAudience)")
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
    r.add_argument("--extra-delivery-dir", help="second owner-only directory (e.g. Cells native action delivery)")
    r.add_argument("--extra-secret", action="append", help="binding secretKey also rendered into --extra-delivery-dir")
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
