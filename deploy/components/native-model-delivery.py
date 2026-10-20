"""Deliver a native page entry's Core-projected model key (DD-128(5)).

Run from deploy/local through ``bootstrap.sh --native-model-delivery``; the
platform .env and secrets/ are read from the runtime directory that
deploy/local/runtime-dir.sh resolved and exported as KAILO_RUNTIME_DIR (ADR-20
§3), never from the current directory or the fixed release tree. It never
creates a binding, route, Gateway key or KV version: Core owns those inside the
original COMPONENT_BINDING workflow. This program only

* ``export``: reads the frozen, non-secret model projection of one ACTIVE native
  page binding from the Core database (read-only transaction);
* ``prepare``: reads back or creates the per-binding read-only policy and a
  one-use AppRole in that Tenant namespace and writes the OpenBao Agent input;
* ``materialize-<component>``: after the Agent rendered ``credential.json``,
  checks the component's native model declaration against the frozen projection
  and publishes the key into the component-only env file under the names that
  declaration references. Wren and WeKnora share this one delivery; only the
  declaration parser differs (``CONSUMERS``);
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
from typing import Callable, NamedTuple
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


def private_path(raw, directory=False, shared=False):
    """A controlled path owned by this account. Owner-only unless ``shared``: a
    non-secret native declaration a non-root container user must read may be
    readable by others, never writable by them."""
    path = Path(raw)
    require(path.is_absolute() and str(path) == str(raw) and path.resolve(strict=True) == path,
            "controlled path must be absolute, canonical and existing")
    info = path.stat()
    require((stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode))
            and not info.st_mode & (0o022 if shared else 0o077) and info.st_uid == os.geteuid(),
            "controlled path must be owner-only and owned by this account")
    return path


def runtime_dir(env):
    """The platform runtime directory (ADR-20 §3): only the canonical absolute value
    deploy/local/runtime-dir.sh exported. .env, secrets/ and data/ there must be the
    real entries, so every controlled path below it is canonical too; a release tree
    carrying symbolic links to them is refused instead of being followed."""
    raw = env.get("KAILO_RUNTIME_DIR", "")
    path = Path(raw)
    require(path.is_absolute() and str(path) == raw and os.path.realpath(raw) == raw and path.is_dir(),
            "KAILO_RUNTIME_DIR must be the canonical runtime directory resolved by deploy/local/runtime-dir.sh")
    require(not any((path / name).is_symlink() for name in (".env", "secrets", "data"))
            and (path / ".env").is_file(),
            "runtime directory .env, secrets/ and data/ must be real entries, not symbolic links")
    return path


def read(path, shared=False):
    private_path(str(path), shared=shared)
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


def write(path, text, mode=0o600):
    """Atomically publish a complete file of this account; never truncate in place.
    Owner-only unless ``mode`` makes a non-secret declaration readable by others;
    never writable by others."""
    require(mode & 0o600 == 0o600 and not mode & 0o133, "publication mode must be 0600 or 0644")
    if os.path.lexists(path):
        private_path(str(path), shared=bool(mode & 0o044))
    fd, temporary = tempfile.mkstemp(dir=path.parent)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def compose(env, *args):
    """deploy/local/runtime-dir.sh runtime_compose: configuration from this tree's
    compose.yaml, .env and ${KAILO_RUNTIME_DIR} interpolation from the runtime directory."""
    runtime = runtime_dir(env)
    return ["sudo", "-n", "--preserve-env=KAILO_RUNTIME_DIR", "docker", "compose",
            "--env-file", str(runtime / ".env"), "-f", "compose.yaml", *args]


def compose_env(env):
    """The process environment for compose(): KAILO_RUNTIME_DIR travels through sudo."""
    return {**os.environ, "KAILO_RUNTIME_DIR": str(runtime_dir(env))}


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
    result = runner(command, text=True, capture_output=True, timeout=int(env["OPENBAO_HTTP_TIMEOUT_SECONDS"]),
                    env=compose_env(env))
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
        # Owner, 0600 and canonical checks apply to the real file in the runtime directory.
        self.token = document(runtime_dir(env) / "secrets/openbao_init.json")["root_token"]
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
        result = subprocess.run(command, input=self.token + "\n", text=True, capture_output=True, timeout=self.timeout,
                                env=compose_env(self.env))
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

    return wren_models(list(yaml.safe_load_all(read(config_path))), model_base, projection["nativeModels"])


def wren_models(documents, model_base, native_models=None):
    """The platform-model rule for parsed Wren config.yaml documents, also applied by
    native-config.py before it publishes a rendered file: every litellm model calls the
    AgentGateway listener with a named key; with ``native_models`` the model set must
    equal that frozen set exactly."""
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
    require(native_models is None or models == set(native_models),
            "config.yaml models must be exactly the binding's frozen native models")
    return sorted(names)


WEKNORA_ENTRY = {"id", "name", "type", "source", "description", "is_default", "status", "parameters"}
WEKNORA_PARAMETERS = {"base_url", "api_key", "provider", "embedding_parameters", "context_window",
                      "max_output_tokens", "max_concurrency", "supports_vision"}
WEKNORA_KEY_NAME = r"KAILO_MODEL_[A-Z0-9_]+"


def weknora_consumers(config_path, projection, model_base):
    """Names of the keys the deployed WeKnora built-in model declaration references;
    models must be exactly the frozen set. Not a secret: the native process (a non-root
    container user) reads it too, so it may be readable by others."""
    return weknora_models(read(config_path, shared=True), model_base, projection["nativeModels"])


def weknora_models(text, model_base, native_models=None):
    """The platform-model rule for the raw text of a WeKnora builtin_models.yaml
    (DD-128(5), SF-WEK-17), also applied by native-config.py before it publishes a
    rendered file. The native loader replaces ${NAME} anywhere in the raw text before
    parsing, so a reference may only be a whole double-quoted api_key; with
    ``native_models`` the model set must equal that frozen set exactly."""
    import yaml

    quoted = re.findall(r'^[ \t]*api_key:[ \t]*"\$\{(' + WEKNORA_KEY_NAME + r')\}"[ \t]*$', text, re.M)
    require(sorted(re.findall(r"\$\{([^}]*)\}", text)) == sorted(quoted),
            "${NAME} may appear only as a whole double-quoted api_key: \"${KAILO_MODEL_...}\"")
    documents = list(yaml.safe_load_all(text))
    require(len(documents) == 1 and isinstance(documents[0], dict) and set(documents[0]) == {"builtin_models"},
            "builtin_models.yaml must hold exactly one builtin_models list")
    entries = documents[0]["builtin_models"]
    require(isinstance(entries, list) and entries, "builtin_models must not be empty")
    ids, names, models = set(), set(), set()
    for entry in entries:
        require(isinstance(entry, dict) and {"id", "name", "type", "parameters"} <= set(entry) <= WEKNORA_ENTRY,
                "built-in model entry fields differ from the platform model shape")
        require(isinstance(entry["id"], str) and re.fullmatch(r"[A-Za-z0-9._-]{1,64}", entry["id"])
                and entry["id"] not in ids, "built-in model ids must be unique stable identifiers")
        ids.add(entry["id"])
        require(entry["type"] in ("KnowledgeQA", "Embedding", "Rerank")
                and entry.get("source", "remote") == "remote" and entry.get("status", "active") == "active"
                and type(entry.get("is_default", False)) is bool, "only active remote chat/embedding/rerank models")
        parameters = entry["parameters"]
        require(isinstance(parameters, dict) and {"base_url", "api_key", "provider"} <= set(parameters) <= WEKNORA_PARAMETERS,
                "no provider headers, extra config or cloud credentials")
        require(parameters["base_url"] == model_base, "base_url must be the AgentGateway independent model listener")
        require(parameters["provider"] in ("openai", "generic"), "only the OpenAI-compatible native clients")
        reference = re.fullmatch(r"\$\{(" + WEKNORA_KEY_NAME + r")\}", str(parameters["api_key"]))
        require(reference, "api_key must reference the component-only env")
        if entry["type"] == "Embedding":
            dimensions = parameters.get("embedding_parameters")
            require(isinstance(dimensions, dict) and type(dimensions.get("dimension")) is int
                    and dimensions["dimension"] > 0, "an embedding model needs its measured dimension")
        require(isinstance(entry["name"], str), "model name must be the route's native id")
        names.add(reference[1])
        models.add(entry["name"])
    # One reference per entry: none hidden in a block scalar the loader would also expand.
    require(len(quoted) == len(entries), "each built-in model references the key exactly once")
    require(native_models is None or models == set(native_models),
            "builtin_models.yaml models must be exactly the binding's frozen native models")
    return sorted(names)


class Consumer(NamedTuple):
    """Where one native component reads the delivered key: the env names of its
    delivery directory, component-only secret env and native model declaration."""
    directory: str
    destination: str
    declaration: Callable[[dict], Path]
    names: Callable[[Path, dict, str], list]


CONSUMERS = {
    "wren": Consumer("WREN_NATIVE_MODEL_DELIVERY_DIR", "WREN_AI_SECRET_ENV_FILE",
                     lambda env: Path(env["WREN_PROJECT_DIR"]) / "config.yaml", wren_consumers),
    "weknora": Consumer("KNOWLEDGE_NATIVE_MODEL_DELIVERY_DIR", "KNOWLEDGE_MODEL_SECRET_ENV_FILE",
                        lambda env: Path(env["KNOWLEDGE_BUILTIN_MODELS_FILE"]), weknora_consumers),
}


def deliver(env, consumer):
    """The one materialization for every native consumer (DD-128(5))."""
    directory = env[consumer.directory]
    projection = validate_projection(document(private_path(directory, directory=True) / "projection.json"))
    names = consumer.names(consumer.declaration(env), projection, env["AGENTGATEWAY_MODEL_BASE_URL"])
    return materialize(env, directory, env[consumer.destination], names)


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
    consumer = CONSUMERS.get(operation[len("materialize-"):]) if operation.startswith("materialize-") else None
    if consumer and len(argv) == 1:
        return deliver(env, consumer)
    if operation == "retire" and len(argv) == 2:
        return retire(env, argv[1])
    raise Refused("usage: export <dir> <binding-id> | prepare <dir> | materialize-wren | materialize-weknora"
                  " | retire <dir>")


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
