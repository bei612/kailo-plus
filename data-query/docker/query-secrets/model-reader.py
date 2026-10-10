"""Deliver the existing binding model key with the original OpenBao Agent.

No model, binding, secret value or audit receipt is created here. The reader
uses the same scoped AppRole/template procedure as Knowledge's model_reader;
the actual key and read request ID come from one Agent Secret response.
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

import yaml


class Refused(Exception):
    pass


def require(value):
    if not value:
        raise Refused("Wren model delivery refused; verify the frozen binding and controlled files")


def unique(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result)
        result[key] = value
    return result


def private_path(raw, directory=False):
    path = Path(raw)
    require(path.is_absolute() and str(path) == raw and path.resolve(strict=True) == path)
    info = path.stat()
    require((stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode))
            and not info.st_mode & 0o077 and info.st_uid == os.geteuid())
    return path


def read(path):
    private_path(str(path))
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), encoding="utf-8") as stream:
        info = os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode) and not info.st_mode & 0o077
                and info.st_uid == os.geteuid())
        return stream.read()


def document(path):
    return json.loads(read(path), object_pairs_hook=unique)


def identifier(value):
    require(isinstance(value, str) and str(UUID(value)) == value)


def seconds(value):
    match = re.fullmatch(r"([1-9][0-9]*)(s|m|h)", value)
    require(match)
    return int(match[1]) * {"s": 1, "m": 60, "h": 3600}[match[2]]


def write(path, text):
    # The caller owns the directory lock for the whole delivery, not just one
    # inode. Atomically publish a complete file, never truncate an old delivery.
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


def inputs(env):
    directory = private_path(env["WREN_MODEL_DELIVERY_DIR"], directory=True)
    value = document(directory / "input.json")
    require(set(value) == {"projection", "models"})
    p, models = value["projection"], value["models"]
    for field in ("bindingId", "tenantId", "workspaceId", "gatewayPrincipalId"):
        identifier(p[field])
    require(type(p["generation"]) is int and p["generation"] > 0
            and re.fullmatch(r"[0-9a-f]{64}", p["configDigest"])
            and re.fullmatch(r"[1-9][0-9]*", p["nativeScopeRef"]))
    reference, reader = p["serviceSecretRef"], p["secretReader"]
    require(set(reference) == {"locator", "version", "audience"}
            and type(reference["version"]) is int and reference["version"] > 0
            and reference["locator"] == p["secretRef"]["locator"]
            and reference["version"] == p["secretRef"]["version"]
            and reference["audience"] != p["secretRef"]["audience"]
            and reader["audience"] == reference["audience"]
            and reader["servicePrincipalId"] == p["gatewayPrincipalId"])
    require(re.fullmatch(r"[A-Za-z0-9_-]+", reader["roleName"]))
    locator = reference["locator"].split("/")
    require(len(locator) == 6 and locator[:2] == ["tenants", p["tenantId"]]
            and locator[3:] == ["application-model", p["bindingId"], str(p["generation"])])
    require(all(re.fullmatch(r"[A-Za-z0-9_-]+", part) for part in locator))
    adapters = document(directory / "adapter-directory.json")["adapters"]
    matches = [(a, b) for a in adapters for b in a.get("bindings", []) if b["bindingId"] == p["bindingId"]]
    require(len(matches) == 1)
    adapter, binding = matches[0]
    require(binding["isolationMode"] == "DEDICATED_INSTANCE"
            and binding["servicePrincipalId"] == p["gatewayPrincipalId"]
            and reader in adapter["secretReaders"])
    for field in ("tenantId", "workspaceId", "nativeScopeRef", "configDigest"):
        require(binding[field] == p[field])
    identities = [i for i in adapter["nativeHumanIdentities"] if i["bindingId"] == p["bindingId"]]
    require(len(identities) == 1 and identities[0]["generation"] == p["generation"]
            and identities[0]["configDigest"] == p["configDigest"])
    routes = {r["resourceId"]: r for r in p["routes"]}
    require(isinstance(models, list) and models and len(routes) == len(models)
            and len(set(p["routeResourceIds"])) == len(models)
            and set(routes) == set(p["routeResourceIds"])
            and len({m["nativeModelRef"] for m in models}) == len(models)
            and {m["routeResourceId"] for m in models} == set(routes)
            and len(p["deliveryChallenges"]) == len(models)
            and {c["routeResourceId"] for c in p["deliveryChallenges"]} == set(routes))
    require(all(re.fullmatch(r"[0-9a-f]{64}", c["verificationNonce"]) for c in p["deliveryChallenges"]))
    # Native group-over-model precedence is retained. Do not synthesize config,
    # choose a model, invent a dimension or allow a provider-owned fallback key.
    config = read(Path(env["WREN_PROJECT_DIR"]) / "config.yaml")
    documents = list(yaml.safe_load_all(config))
    configured, names, kinds = {}, set(), set()
    for entry in documents:
        if entry.get("type") not in ("llm", "embedder"):
            continue
        kind = entry["type"]
        require(entry["provider"] == "litellm_" + kind)
        kinds.add(kind)
        group = {k: v for k, v in entry.items() if k not in ("type", "models", "provider")}
        for model in entry["models"]:
            effective = {**model, **group}
            name = effective["api_key_name"]
            require(re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name))
            require(not {"api_key", "api_base", "model", "api_version"} & set(model.get("kwargs", {})))
            ref = entry["provider"] + "." + model.get("alias", model["model"])
            require(ref not in configured)
            configured[ref] = (effective["model"], effective["api_base"])
            names.add(name)
    require(kinds == {"llm", "embedder"} and set(configured) == {m["nativeModelRef"] for m in models})
    stores = [d for d in documents if d.get("type") == "document_store"]
    require(stores and all(type(d.get("embedding_model_dim")) is int and d["embedding_model_dim"] > 0 for d in stores))
    for model in models:
        require(set(model) == {"routeResourceId", "nativeModelRef", "baseUrl"})
        require(configured[model["nativeModelRef"]] == ("openai/" + routes[model["routeResourceId"]]["nativeId"], model["baseUrl"]))
    return directory, value, adapters, config, names


class Bao:
    """The same local compose/CLI transport as secret-store-init.sh run_bao."""

    def __init__(self, env, namespace):
        self.env, self.namespace = env, namespace
        self.token = document(Path.cwd() / "secrets/openbao_init.json")["root_token"]
        self.timeout = int(env["OPENBAO_HTTP_TIMEOUT_SECONDS"])
        require(self.timeout > 0)

    def request(self, path, fields=None, *, missing=False, wrap=None):
        args = ["read" if fields is None else "write", "-format=json"]
        if wrap:
            args.append("-wrap-ttl=" + wrap)
        if fields == {}:
            args.append("-f")
        args.append(path)
        for key, value in (fields or {}).items():
            encoded = ",".join(value) if isinstance(value, list) else json.dumps(value) if isinstance(value, (bool, dict)) else str(value)
            args.append(key + "=" + encoded)
        command = ["sudo", "-n", "-H", "docker", "compose", "--env-file", ".env", "-f", "compose.yaml",
                   "exec", "-T", "-e", "BAO_ADDR=" + self.env["OPENBAO_ADDR"],
                   "-e", "BAO_NAMESPACE=" + self.namespace, "openbao", "sh", "-c",
                   'IFS= read -r BAO_TOKEN; export BAO_TOKEN; exec bao "$@"', "bao", *args]
        result = subprocess.run(command, input=self.token + "\n", text=True, capture_output=True, timeout=self.timeout)
        if missing and result.returncode and "No value found at " + path in result.stderr:
            return None
        require(result.returncode == 0)
        return json.loads(result.stdout) if result.stdout.strip() else None


def deliver(env, operation, api_factory=Bao):
    original = inputs(env)
    directory, value, _, _, names = original
    descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        p = value["projection"]
        reference = p["serviceSecretRef"]
        if operation == "materialize":
            material = document(directory / "credential.json")
            identifier(material["requestId"])
            require(set(material) == {"delivery", "requestId", "version", "value"}
                    and material["delivery"] == value and type(material["version"]) is int
                    and material["version"] == reference["version"]
                    and isinstance(material["value"], str) and re.fullmatch(r"[0-9a-f]{64}", material["value"]))
            destination = Path(env["WREN_AI_SECRET_ENV_FILE"])
            require(destination.parent == directory and destination.name not in
                    ("input.json", "credential.json", "adapter-directory.json", "verified-directory.json",
                     "model-agent.hcl", "model-role-id", "model-wrapped-secret-id"))
            require(destination != Path(env["WREN_PROJECT_DIR"]) / "config.yaml")
            if os.path.lexists(destination):
                previous = read(destination).splitlines()
                parsed = [re.fullmatch(r'([A-Za-z_][A-Za-z0-9_]*)="[0-9a-f]{64}"', line) for line in previous]
                require(all(parsed) and len(parsed) == len(names)
                        and {line[1] for line in parsed} == names)
            require(inputs(env) == original)
            write(destination, "".join(name + "=" + json.dumps(material["value"]) + "\n" for name in sorted(names)))
        else:
            require(operation == "prepare")
            parts = reference["locator"].split("/")
            namespace, mount, path = "/".join(parts[:2]), parts[2], "/".join(parts[3:])
            api = api_factory(env, namespace)
            existing_mount = api.request("sys/mounts")["data"][mount + "/"]
            require(existing_mount["type"] == "kv" and existing_mount["options"] == {"version": "2"})
            require(api.request("sys/auth")["data"]["approle/"]["type"] == "approle")
            role = p["secretReader"]["roleName"]
            policy_path = "sys/policies/acl/" + role
            policy = f'path "{mount}/data/{path}" {{ capabilities = ["read"] }}\n'
            current = api.request(policy_path, missing=True)
            if current is None:
                api.request(policy_path, {"policy": policy})
                current = api.request(policy_path)
            require(current["data"]["policy"] == policy)
            ttl, secret_ttl = env["OPENBAO_TOKEN_PERIOD"], env["OPENBAO_SECRET_ID_TTL"]
            wanted = {"bind_secret_id": True, "secret_id_num_uses": 1, "secret_id_ttl": seconds(secret_ttl),
                      "token_policies": [role], "token_ttl": seconds(ttl), "token_max_ttl": seconds(ttl)}
            role_path = "auth/approle/role/" + role
            current = api.request(role_path, missing=True)
            if current is None:
                api.request(role_path, wanted)
                current = api.request(role_path)
            require(all(current["data"].get(k) == v for k, v in wanted.items()))
            role_id = api.request(role_path + "/role-id")["data"]["role_id"]
            require(inputs(env) == original)
            seconds(env["OPENBAO_SECRET_ID_WRAP_TTL"])
            wrapped = api.request(role_path + "/secret-id", {}, wrap=env["OPENBAO_SECRET_ID_WRAP_TTL"])
            metadata = json.dumps(value, separators=(",", ":"))
            contents = ('{{ with secret "' + mount + '/data/' + path + '?version=' + str(reference["version"])
                        + '" }}{"delivery":{{ ' + json.dumps(metadata) + ' }},"requestId":{{ .RequestID | toJSON }},'
                        '"version":{{ .Data.metadata.version | toJSON }},"value":{{ .Data.data.value | toJSON }}}{{ end }}')
            quote = json.dumps
            agent = ('exit_after_auth = true\n' + f'vault {{ address = {quote(env["OPENBAO_ADDR"])} }}\n'
                     + 'auto_auth {\n method "approle" {\n' + f' namespace = {quote(namespace)}\n config = {{\n'
                     + f' role_id_file_path = {quote(str(directory / "model-role-id"))}\n'
                     + f' secret_id_file_path = {quote(str(directory / "model-wrapped-secret-id"))}\n'
                     + f' secret_id_response_wrapping_path = {quote(role_path + "/secret-id")}\n'
                     + ' }\n }\n}\ntemplate_config { exit_on_retry_failure = true }\n'
                     + 'template {\n' + f' contents = {quote(contents)}\n destination = {quote(str(directory / "credential.json"))}\n'
                     + ' perms = "0600"\n error_on_missing_key = true\n}\n')
            require(inputs(env) == original)
            for name, expected in (("model-agent.hcl", agent), ("model-role-id", role_id)):
                destination = directory / name
                if os.path.lexists(destination):
                    require(read(destination) == expected)
            wrapped_path = directory / "model-wrapped-secret-id"
            if os.path.lexists(wrapped_path):
                require((directory / "model-agent.hcl").exists()
                        and (directory / "model-role-id").exists())
            write(directory / "model-role-id", role_id)
            write(directory / "model-wrapped-secret-id", wrapped["wrap_info"]["token"])
            # HCL is the last published entrypoint; a partial preparation cannot
            # be mistaken for a complete new generation by the native verifier.
            write(directory / "model-agent.hcl", agent)
        os.fsync(descriptor)
        return {"bindingId": p["bindingId"], "generation": p["generation"], "operation": operation,
                "bindingActivated": False}
    finally:
        os.close(descriptor)


if __name__ == "__main__":
    try:
        require(len(sys.argv) == 2)
        print(json.dumps(deliver(os.environ, sys.argv[1])))
    except Exception:
        # CLI/JSON/transport diagnostics can contain tokens or bodies.
        print("Wren model delivery incomplete; inspect controlled binding inputs and retry by read-back", file=sys.stderr)
        sys.exit(78)
