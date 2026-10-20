"""Deliver a native page entry's Core-projected model key (DD-128(5)).

Run from deploy/local through ``bootstrap.sh --native-model-delivery``. It never
creates a binding, route, Gateway key or KV version: Core owns those inside the
original COMPONENT_BINDING workflow. This program only

* ``export``: reads the frozen, non-secret model projection of one ACTIVE native
  page binding from the Core database (read-only transaction);
* ``prepare``: reads back or creates the per-binding read-only policy and a
  one-use AppRole in that Tenant namespace and writes the OpenBao Agent input;
* ``materialize``: after the Agent rendered ``credential.json``, publishes the
  key into the component-only env file named by the native configuration;
* ``retire``: removes the per-binding policy/role after the binding is DISABLED.

No value read here is printed; diagnostics never include the key.
"""

import fcntl
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
from uuid import UUID

ROLE = re.compile(r"application-model-[0-9a-f]{32}")
DELIVERY_FILES = ("projection.json", "model-role-id", "model-wrapped-secret-id",
                  "model-agent.hcl", "credential.json")


class Refused(Exception):
    pass


def require(value, reason="native model delivery refused; verify the frozen binding and controlled files"):
    if not value:
        raise Refused(reason)


def unique(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result)
        result[key] = value
    return result


def private_path(raw, directory=False):
    path = Path(raw)
    require(path.is_absolute() and str(path) == str(raw) and path.resolve(strict=True) == path,
            "controlled path must be absolute, canonical and existing")
    info = path.stat()
    require((stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode))
            and not info.st_mode & 0o077 and info.st_uid == os.geteuid(),
            "controlled path must be owner-only and owned by this account")
    return path


def read(path):
    private_path(str(path))
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), encoding="utf-8") as stream:
        return stream.read()


def document(path):
    return json.loads(read(path), object_pairs_hook=unique)


def identifier(value):
    try:
        parsed = UUID(value) if isinstance(value, str) else None
    except ValueError:
        parsed = None
    require(parsed is not None and str(parsed) == value and parsed.int != 0, "canonical identifier required")
    return value


def seconds(value):
    match = re.fullmatch(r"([1-9][0-9]*)(s|m|h)", value or "")
    require(match, "OpenBao TTL must be <n>s|m|h")
    return int(match[1]) * {"s": 1, "m": 60, "h": 3600}[match[2]]


def write(path, text):
    """Atomically publish a complete owner-only file; never truncate in place."""
    if os.path.lexists(path):
        private_path(str(path))
    fd, temporary = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def compose(env, *args):
    return ["sudo", "-n", "docker", "compose", "--env-file", ".env", "-f", "compose.yaml", *args]


def validate_projection(value, binding=None):
    """The frozen DD-128 projection: one native page binding, one KV version."""
    require(isinstance(value, dict) and set(value) == {
        "bindingId", "generation", "tenantId", "workspaceId", "gatewayPrincipalId",
        "deliveryMode", "nativeModels", "routeResourceIds", "serviceSecretRef", "secretRef",
        "secretReader"}, "projection fields differ from DD-128")
    identifier(value["bindingId"])
    identifier(value["tenantId"])
    identifier(value["gatewayPrincipalId"])
    if value["workspaceId"] is not None:
        identifier(value["workspaceId"])
    require(binding is None or value["bindingId"] == binding)
    require(type(value["generation"]) is int and value["generation"] > 0)
    require(value["deliveryMode"] == "NATIVE_PAGE", "not a native page entry projection")
    models, routes = value["nativeModels"], value["routeResourceIds"]
    require(isinstance(models, list) and models and len(set(models)) == len(models) == len(routes)
            and all(isinstance(m, str) and re.fullmatch(r"[A-Za-z0-9._:/-]+", m) for m in models))
    for route in routes:
        identifier(route)
    reference, core, reader = value["serviceSecretRef"], value["secretRef"], value["secretReader"]
    role = "application-model-" + UUID(value["bindingId"]).hex
    require(set(reference) == {"locator", "version", "audience"} and set(core) == {"locator", "version"}
            and type(reference["version"]) is int and reference["version"] > 0
            and reference["locator"] == core["locator"] and reference["version"] == core["version"]
            and reader == {"roleName": role, "audience": role, "servicePrincipalId": value["gatewayPrincipalId"]}
            and reference["audience"] == role, "SecretRef or reader differs from the binding identity")
    parts = reference["locator"].split("/")
    require(len(parts) == 6 and parts[1] == value["tenantId"]
            and parts[3:] == ["application-model", value["bindingId"], str(value["generation"])]
            and all(re.fullmatch(r"[A-Za-z0-9_-]+", part) for part in parts),
            "SecretRef locator is not this binding generation")
    return value


EXPORT_SQL = """select jsonb_build_object('state',b.state,'modelCallMode',b.model_call_mode,
  'nativePage',(r.manifest->'executionConnector'->>'mode'='NONE' and r.manifest->'implements'='[]'::jsonb
     and r.manifest->'frontendDelivery'->>'mode'='NATIVE_PAGE'),
  'componentTypeKey',b.component_type_key,'modelState',p.model_state,
  'projection',jsonb_build_object('bindingId',m->'bindingId','generation',m->'generation',
     'tenantId',m->'tenantId','workspaceId',m->'workspaceId','gatewayPrincipalId',m->'gatewayPrincipalId',
     'deliveryMode',m->'deliveryMode','nativeModels',m->'nativeModels','routeResourceIds',m->'routeResourceIds',
     'serviceSecretRef',m->'serviceSecretRef','secretReader',m->'secretReader',
     'secretRef',jsonb_build_object('locator',m->'secretRef'->'locator','version',m->'secretRef'->'version')))
 from catalog.application_binding b
 join projection.application_runtime p on p.binding_id=b.id and p.generation=b.active_projection_generation
 join catalog.component_release r on r.id=p.component_release_id
 cross join lateral (select p.model_projection m) frozen
 where b.id='{binding}'::uuid"""


def export(env, directory, binding, runner=subprocess.run):
    identifier(binding)
    directory = private_path(directory, directory=True)
    command = compose(env, "exec", "-T", "-e", "PGOPTIONS=-c default_transaction_read_only=on",
                      "core-db", "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1",
                      "-U", env["CORE_DB_USER"], "-d", env["CORE_DB_NAME"],
                      "-c", EXPORT_SQL.format(binding=binding))
    result = runner(command, text=True, capture_output=True, timeout=int(env["OPENBAO_HTTP_TIMEOUT_SECONDS"]))
    require(result.returncode == 0 and result.stdout.strip(), "binding not found or Core database unavailable")
    row = json.loads(result.stdout.strip(), object_pairs_hook=unique)
    require(row["nativePage"] is True, "binding release is not a native page entry")
    require(row["state"] == "ACTIVE" and row["modelCallMode"] == "PLATFORM_LLM_ROUTE"
            and row["modelState"] == "ACTIVE", "binding model projection is not ACTIVE")
    projection = validate_projection(row["projection"], binding)
    target = directory / "projection.json"
    text = json.dumps(projection, indent=2, sort_keys=True) + "\n"
    if os.path.lexists(target):
        require(read(target) == text, "delivery directory holds another binding/generation; use a new directory")
    else:
        write(target, text)
    return {"operation": "export", "bindingId": binding, "generation": projection["generation"],
            "componentTypeKey": row["componentTypeKey"], "nativeModels": projection["nativeModels"]}


class Bao:
    """The same local compose/CLI transport as secret-store-init.sh run_bao."""

    def __init__(self, env, namespace):
        self.env, self.namespace = env, namespace
        self.token = document(Path.cwd() / "secrets/openbao_init.json")["root_token"]
        self.timeout = int(env["OPENBAO_HTTP_TIMEOUT_SECONDS"])
        require(self.timeout > 0)

    def request(self, path, fields=None, *, missing=False, wrap=None, delete=False):
        args = ["delete" if delete else "read" if fields is None else "write", "-format=json"]
        if wrap:
            args.append("-wrap-ttl=" + wrap)
        if fields == {}:
            args.append("-f")
        args.append(path)
        for key, value in (fields or {}).items():
            encoded = ",".join(value) if isinstance(value, list) else json.dumps(value) if isinstance(value, (bool, dict)) else str(value)
            args.append(key + "=" + encoded)
        command = compose(self.env, "exec", "-T", "-e", "BAO_ADDR=" + self.env["OPENBAO_ADDR"],
                          "-e", "BAO_NAMESPACE=" + self.namespace, "openbao", "sh", "-c",
                          'IFS= read -r BAO_TOKEN; export BAO_TOKEN; exec bao "$@"', "bao", *args)
        result = subprocess.run(command, input=self.token + "\n", text=True, capture_output=True, timeout=self.timeout)
        if missing and result.returncode and "No value found at " + path in result.stderr:
            return None
        require(result.returncode == 0, "OpenBao request failed; inspect OpenBao audit, not this output")
        return json.loads(result.stdout) if result.stdout.strip() else None


def locator(projection):
    parts = projection["serviceSecretRef"]["locator"].split("/")
    return "/".join(parts[:2]), parts[2], "/".join(parts[3:])


def policy_text(projection):
    _, mount, path = locator(projection)
    return f'path "{mount}/data/{path}" {{ capabilities = ["read"] }}\n'


def agent_config(env, directory, projection, role):
    namespace, mount, path = locator(projection)
    version = projection["serviceSecretRef"]["version"]
    contents = ('{{ with secret "' + mount + '/data/' + path + '?version=' + str(version) + '" }}'
                '{"bindingId":' + json.dumps(projection["bindingId"]) + ',"generation":'
                + str(projection["generation"]) + ',"requestId":{{ .RequestID | toJSON }},'
                '"version":{{ .Data.metadata.version | toJSON }},"value":{{ .Data.data.value | toJSON }}}{{ end }}')
    quote = json.dumps
    return ('exit_after_auth = true\n' + f'vault {{ address = {quote(env["OPENBAO_ADDR"])} }}\n'
            + 'auto_auth {\n method "approle" {\n' + f' namespace = {quote(namespace)}\n config = {{\n'
            + f' role_id_file_path = {quote(str(directory / "model-role-id"))}\n'
            + f' secret_id_file_path = {quote(str(directory / "model-wrapped-secret-id"))}\n'
            + f' secret_id_response_wrapping_path = {quote("auth/approle/role/" + role + "/secret-id")}\n'
            + ' }\n }\n}\ntemplate_config { exit_on_retry_failure = true }\n'
            + 'template {\n' + f' contents = {quote(contents)}\n destination = {quote(str(directory / "credential.json"))}\n'
            + ' perms = "0600"\n error_on_missing_key = true\n}\n')


def prepare(env, directory, api_factory=Bao):
    directory = private_path(directory, directory=True)
    projection = validate_projection(document(directory / "projection.json"))
    namespace, mount, _ = locator(projection)
    role = projection["secretReader"]["roleName"]
    require(ROLE.fullmatch(role))
    api = api_factory(env, namespace)
    existing_mount = api.request("sys/mounts")["data"][mount + "/"]
    require(existing_mount["type"] == "kv" and existing_mount["options"] == {"version": "2"})
    require(api.request("sys/auth")["data"]["approle/"]["type"] == "approle")
    policy_path = "sys/policies/acl/" + role
    policy = policy_text(projection)
    current = api.request(policy_path, missing=True)
    if current is None:
        api.request(policy_path, {"policy": policy})
        current = api.request(policy_path)
    require(current["data"]["policy"] == policy, "a different policy with this role name exists; refusing to replace it")
    ttl, secret_ttl = env["OPENBAO_TOKEN_PERIOD"], env["OPENBAO_SECRET_ID_TTL"]
    wanted = {"bind_secret_id": True, "secret_id_num_uses": 1, "secret_id_ttl": seconds(secret_ttl),
              "token_policies": [role], "token_ttl": seconds(ttl), "token_max_ttl": seconds(ttl)}
    role_path = "auth/approle/role/" + role
    current = api.request(role_path, missing=True)
    if current is None:
        api.request(role_path, wanted)
        current = api.request(role_path)
    require(all(current["data"].get(k) == v for k, v in wanted.items()),
            "a different AppRole with this name exists; refusing to replace it")
    role_id = api.request(role_path + "/role-id")["data"]["role_id"]
    seconds(env["OPENBAO_SECRET_ID_WRAP_TTL"])
    wrapped = api.request(role_path + "/secret-id", {}, wrap=env["OPENBAO_SECRET_ID_WRAP_TTL"])
    agent = agent_config(env, directory, projection, role)
    for name, expected in (("model-agent.hcl", agent), ("model-role-id", role_id)):
        target = directory / name
        if os.path.lexists(target):
            require(read(target) == expected, "delivery directory holds another reader; use a new directory")
    if os.path.lexists(directory / "credential.json"):
        os.unlink(directory / "credential.json")  # a previous render of this same projection
    write(directory / "model-role-id", role_id)
    write(directory / "model-wrapped-secret-id", wrapped["wrap_info"]["token"])
    # The HCL is published last; a partial preparation is never a complete one.
    write(directory / "model-agent.hcl", agent)
    return {"operation": "prepare", "bindingId": projection["bindingId"],
            "generation": projection["generation"], "role": role}


def wren_consumers(config_path, projection, model_base):
    """Names of the keys the original Wren config.yaml reads; models must be exactly the frozen set."""
    import yaml

    documents = list(yaml.safe_load_all(read(config_path)))
    names, models = set(), set()
    for entry in documents:
        if not isinstance(entry, dict) or entry.get("type") not in ("llm", "embedder"):
            continue
        require(entry.get("provider") == "litellm_" + entry["type"], "only the litellm providers are delivered")
        group = {k: v for k, v in entry.items() if k not in ("type", "models", "provider")}
        for model in entry["models"]:
            effective = {**model, **group}
            require(not {"api_key", "api_base", "model", "api_version"} & set(model.get("kwargs", {})),
                    "model kwargs must not override key, base or model")
            name = effective.get("api_key_name")
            require(isinstance(name, str) and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name),
                    "every platform model needs api_key_name")
            require(effective.get("api_base") == model_base,
                    "api_base must be the AgentGateway independent model listener")
            require(isinstance(effective.get("model"), str) and effective["model"].startswith("openai/"))
            names.add(name)
            models.add(effective["model"][len("openai/"):])
    require(models == set(projection["nativeModels"]),
            "config.yaml models must be exactly the binding's frozen native models")
    return sorted(names)


def materialize(env, directory, destination, names):
    directory = private_path(directory, directory=True)
    descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        projection = validate_projection(document(directory / "projection.json"))
        material = document(directory / "credential.json")
        identifier(material["requestId"])
        require(set(material) == {"bindingId", "generation", "requestId", "version", "value"}
                and material["bindingId"] == projection["bindingId"]
                and material["generation"] == projection["generation"]
                and material["version"] == projection["serviceSecretRef"]["version"]
                and isinstance(material["value"], str) and re.fullmatch(r"[0-9a-f]{64}", material["value"]),
                "rendered credential is not this binding generation")
        destination = Path(destination)
        require(destination.is_absolute() and destination.name not in DELIVERY_FILES)
        private_path(str(destination.parent), directory=True)
        require(names and all(re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", n) for n in names))
        if os.path.lexists(destination):
            previous = [line for line in read(destination).splitlines() if line]
            parsed = [re.fullmatch(r'([A-Za-z_][A-Za-z0-9_]*)="[0-9a-f]{64}"', line) for line in previous]
            # An empty file or an earlier delivery of the same names may be replaced;
            # an unrelated env file is never overwritten.
            require(all(parsed) and (not parsed or {m[1] for m in parsed} == set(names)),
                    "destination holds unrelated settings; refusing to overwrite")
        write(destination, "".join(f'{name}="{material["value"]}"\n' for name in sorted(names)))
        os.unlink(directory / "credential.json")  # the env file is the sole consumer copy
        return {"operation": "materialize", "bindingId": projection["bindingId"],
                "generation": projection["generation"], "requestId": material["requestId"],
                "keyNames": sorted(names), "restartRequired": True}
    finally:
        os.close(descriptor)


def retire(env, directory, api_factory=Bao):
    directory = private_path(directory, directory=True)
    projection = validate_projection(document(directory / "projection.json"))
    namespace, _, _ = locator(projection)
    role = projection["secretReader"]["roleName"]
    api = api_factory(env, namespace)
    if api.request("auth/approle/role/" + role, missing=True) is not None:
        api.request("auth/approle/role/" + role, delete=True)
    if api.request("sys/policies/acl/" + role, missing=True) is not None:
        api.request("sys/policies/acl/" + role, delete=True)
    require(api.request("auth/approle/role/" + role, missing=True) is None
            and api.request("sys/policies/acl/" + role, missing=True) is None)
    for name in ("model-role-id", "model-wrapped-secret-id", "model-agent.hcl", "credential.json"):
        if os.path.lexists(directory / name):
            os.unlink(directory / name)
    return {"operation": "retire", "bindingId": projection["bindingId"],
            "generation": projection["generation"], "role": role}


def main(argv, env):
    operation = argv[0] if argv else ""
    if operation == "export" and len(argv) == 3:
        return export(env, argv[1], argv[2])
    if operation == "prepare" and len(argv) == 2:
        return prepare(env, argv[1])
    if operation == "materialize-wren" and len(argv) == 1:
        directory = env["WREN_NATIVE_MODEL_DELIVERY_DIR"]
        projection = validate_projection(document(private_path(directory, directory=True) / "projection.json"))
        names = wren_consumers(Path(env["WREN_PROJECT_DIR"]) / "config.yaml", projection,
                               env["AGENTGATEWAY_MODEL_BASE_URL"])
        return materialize(env, directory, env["WREN_AI_SECRET_ENV_FILE"], names)
    if operation == "retire" and len(argv) == 2:
        return retire(env, argv[1])
    raise Refused("usage: export <dir> <binding-id> | prepare <dir> | materialize-wren | retire <dir>")


if __name__ == "__main__":
    try:
        print(json.dumps(main(sys.argv[1:], os.environ)))
    except Refused as error:
        print(str(error), file=sys.stderr)
        sys.exit(78)
    except Exception:
        # CLI/JSON/transport diagnostics can contain tokens or bodies.
        print("native model delivery incomplete; inspect controlled inputs and retry by read-back", file=sys.stderr)
        sys.exit(78)
