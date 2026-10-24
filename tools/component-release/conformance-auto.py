#!/usr/bin/env python3
"""Unattended isolated conformance run of one REMOTE_ADAPTER candidate (DD-136(5), .design/07 §8A).

Called by deploy/components/component-deploy.sh --conformance / --conformance-close
(the component deploy entry); CI node only. It drives the existing stages of
tools/component-release/conformance-run.sh and their tools end to end, without
an operator between stages:

  * every isolated native credential (Cells install admin, binding service and
    actor users and their personal tokens; datasource keys; the isolated OAuth
    and unused OIDC client secrets) is generated here or minted through the
    isolated instance's own API/CLI, written only as 0600 files inside the
    owner-only run directory or into the run's isolated OpenBao, and never
    printed, logged, passed as an argument or as an environment value;
  * precondition values and expectations come only from the isolated
    instance's actual answers (seed and observe tools, DD-124(1));
  * on success the candidate (fixture, identity, environment and the public
    JWKS the identity names) is installed under
    <COMPONENT_CONFORMANCE_DIR>/<artifactDigest>/ (DD-136(2)), and the
    production Worker is attached to the run's dedicated network for the
    registration window; `close` removes both and the isolated environment.

Nothing here touches production Core state, its database, production OpenBao
or a production binding. The run directory keeps logs and facts for review; a
failed stage stops the run and leaves everything for inspection, a new run
uses a new directory.

  conformance-auto.py run <component> --source <release tree apps/> --commit <40-hex>
        --runtime <KAILO_RUNTIME_DIR> [--run-root DIR] [--no-install]
  conformance-auto.py close <run dir> --runtime <KAILO_RUNTIME_DIR>
  conformance-auto.py status <run dir>

Output is one JSON line per step with names, counts and states only.
"""
import argparse
import base64
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import shutil
import socket
import stat
import string
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

DOCKER = ["sudo", "-n", "docker"]
RUN_ROOT = "/volumes/data/kailo/conformance/runs"
HEX64 = re.compile(r"[0-9a-f]{64}")
STATE_FILE = "auto-state.json"


class Refused(Exception):
    pass


def require(condition, reason):
    if not condition:
        raise Refused(reason)


def say(step, **fields):
    print(json.dumps({"step": step, **fields}, ensure_ascii=False), flush=True)


# ---- files -------------------------------------------------------------------

def private_dir(path, mode=0o700):
    path = Path(path)
    path.mkdir(mode=mode, parents=True, exist_ok=True)
    # Native state directories are taken over by the service uid (e.g. PostgreSQL) once started.
    if path.stat().st_uid == os.getuid():
        os.chmod(path, mode)
    return path


def write_private(path, content, mode=0o600):
    """Create-or-replace an owner-only file through a temporary file; never logged."""
    path = Path(path)
    tmp = path.with_name("." + path.name + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())
    os.chmod(tmp, mode)
    os.replace(tmp, path)
    return path


def write_json(path, value, mode=0o600):
    return write_private(path, json.dumps(value, ensure_ascii=False, indent=2) + "\n", mode)


def read_json(path):
    with open(path, encoding="utf-8") as stream:
        return json.load(stream)


def secret_text(length, alphabet=string.ascii_letters + string.digits):
    return "".join(secrets.choice(alphabet) for _ in range(length))


def env_file(path, values):
    """KEY=VALUE lines; values are non-secret paths, ids and digests (secrets stay in files)."""
    lines = []
    for key, value in values.items():
        value = str(value)
        require("\n" not in value, f"{key}: single-line value required")
        lines.append(f"{key}={shlex.quote(value) if re.search(r'[^A-Za-z0-9_./:@,=+-]', value) else value}")
    return write_private(path, "\n".join(lines) + "\n")


def env_value(path, name):
    """One non-secret key of a KEY=VALUE env file (no sourcing, no echo of the file)."""
    with open(path, encoding="utf-8") as stream:
        for line in stream:
            match = re.match(r"^" + re.escape(name) + r"=(.*)$", line.rstrip("\n"))
            if match:
                value = match.group(1)
                if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
                    value = value[1:-1]
                return value
    return ""


# ---- processes ---------------------------------------------------------------

def run(argv, log=None, cwd=None, stdin=None, env=None, check=True, capture=False, timeout=None):
    """Run a command; stdout/stderr go to the run log (never to our stdout unless captured)."""
    out = subprocess.PIPE if capture else (open(log, "ab") if log else subprocess.DEVNULL)
    try:
        result = subprocess.run(argv, cwd=cwd, input=stdin, env=env, stdout=out,
                                stderr=(open(log, "ab") if log else subprocess.DEVNULL), timeout=timeout, check=False)
    finally:
        if not capture and log:
            out.close()
    if check and result.returncode != 0:
        raise Refused(f"{Path(argv[0]).name if argv[0] not in DOCKER else 'docker'} {' '.join(a for a in argv[1:3] if not a.startswith('/'))} exited {result.returncode}; see the run log")
    return result


def docker(*args, capture=True, check=True, stdin=None, log=None, timeout=None):
    result = run(DOCKER + list(args), capture=capture, check=check, stdin=stdin, log=log, timeout=timeout)
    return result.stdout.decode("utf-8", "replace") if capture else result


def exists(kind, name):
    return run(DOCKER + [kind, "inspect", name], check=False).returncode == 0


# ---- environment facts -------------------------------------------------------

def node_image(source):
    """The constrained Node SDK image: the digest-pinned base of the adapter images (AGENTS rule 22)."""
    text = (Path(source) / "file-storage/adapter/Dockerfile").read_text(encoding="utf-8")
    match = re.search(r"^FROM (node:[^\s@]+@sha256:[0-9a-f]{64})", text, re.M)
    require(match, "file-storage/adapter/Dockerfile has no digest-pinned Node base")
    ref = "node@" + match.group(1).split("@", 1)[1]
    if not exists("image", ref):
        docker("pull", "--quiet", ref)
    return ref


def used_subnets():
    nets = []
    for name in docker("network", "ls", "--format", "{{.Name}}").split():
        try:
            info = json.loads(docker("network", "inspect", name))[0]
        except (Refused, ValueError, IndexError):
            continue
        for config in (info.get("IPAM") or {}).get("Config") or []:
            if config.get("Subnet"):
                try:
                    nets.append(ipaddress.ip_network(config["Subnet"], strict=False))
                except ValueError:
                    pass
    return nets


def free_subnets(count, prefix="10.200.", start=60, stop=120):
    used = used_subnets()
    out = []
    for third in range(start, stop):
        net = ipaddress.ip_network(f"{prefix}{third}.0/24")
        if not any(net.overlaps(u) for u in used):
            out.append(str(net))
            if len(out) == count:
                return out
    raise Refused("no free isolated subnet")


def free_port(start, stop):
    published = docker("ps", "-a", "--format", "{{.Ports}}")
    for port in range(start, stop):
        if f":{port}->" in published:
            continue
        with socket.socket() as probe:
            try:
                probe.bind(("127.0.0.1", port))
            except OSError:
                continue
        return port
    raise Refused("no free loopback port")


def runtime_facts(runtime):
    runtime = Path(runtime)
    env = runtime / ".env"
    require(env.is_file(), "runtime .env missing")
    facts = {name: env_value(env, name) for name in (
        "COMPONENT_CONFORMANCE_DIR", "COMPONENT_CONFORMANCE_SIGNING_FILE", "GATEWAY_SERVICE_JWKS_FILE")}
    facts["COMPONENT_CONFORMANCE_DIR"] = facts["COMPONENT_CONFORMANCE_DIR"].replace("${KAILO_RUNTIME_DIR}", str(runtime))
    facts["env"] = str(env)
    return facts


def compose_project():
    config = read_json("/volumes/kailo/ci/config.json")
    return config.get("compose_project") or "platform-local"


def platform_openbao_image():
    image = docker("inspect", "--format", "{{.Config.Image}}", f"{compose_project()}-openbao-1").strip()
    require(re.fullmatch(r"[^\s@]+@sha256:[0-9a-f]{64}", image), "platform OpenBao image is not digest-pinned")
    return image


# ---- shared stages -----------------------------------------------------------

class Run:
    def __init__(self, directory):
        self.dir = Path(directory)
        self.log = self.dir / "run.log"
        self.state_path = self.dir / STATE_FILE

    @property
    def state(self):
        return read_json(self.state_path) if self.state_path.is_file() else {}

    def record(self, **fields):
        state = self.state
        state.update(fields)
        write_json(self.state_path, state)

    def run_env(self):
        """run.env for the existing runner. It bind-mounts every named input file into its Node
        steps, and Docker would create a missing source as a root-owned directory, so optional
        inputs are named only once they exist."""
        state = self.state
        values = {k: v for k, v in state.get("runEnv", {}).items()}
        for key, path in state.get("runEnvFiles", {}).items():
            if key == "CONFORMANCE_MOUNTS":
                present = [p for p in path.split() if Path(p).is_file()]
                if present:
                    values[key] = " ".join(present)
            elif Path(path).is_file():
                values[key] = path
        return env_file(self.dir / "run.env", values)

    def conformance(self, stage):
        """One stage of the existing runner (it keeps its own done markers)."""
        self.run_env()
        state = self.state
        say("conformance-run", component=state["component"], stage=stage)
        run(["bash", f"{state['source']}/tools/component-release/conformance-run.sh", state["component"],
             str(self.dir / "run.env"), "--stage", str(stage)], log=self.log)

    def node(self, network, script, *args, mounts=(), extra=()):
        state = self.state
        argv = DOCKER + ["run", "--rm", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
                         "--cpus", "1", "--memory", "768m", "--memory-swap", "768m", "--pids-limit", "256",
                         "--tmpfs", "/tmp:rw,nosuid,nodev,size=64m", "-u", f"{os.getuid()}:{os.getgid()}", "-e", "HOME=/tmp",
                         "-v", f"{state['source']}:/src:ro", "-v", f"{self.dir}:{self.dir}", "-w", "/src", "--network", network]
        for mount in mounts:
            argv += ["-v", f"{mount}:{mount}:ro"]
        argv += list(extra) + [state["nodeImage"], "node", script, *args]
        return run(argv, log=self.log, capture=True).stdout.decode("utf-8", "replace")


def render_release(r, component, origin):
    state = r.state
    out = r.dir / "release"
    if not (out / "manifest.json").is_file():
        private_dir(out, 0o755)
        r.node("none", "tools/component-release/render.mjs", "--component", component, "--source-commit", state["commit"],
               "--native-page-origin", origin, "--out", str(out))
    manifest = read_json(out / "manifest.json")
    require(HEX64.fullmatch(manifest.get("adapterBuildRef", "")), "rendered manifest has no adapter digest")
    for name in os.listdir(out):
        os.chmod(out / name, 0o644)
    r.record(manifest=str(out / "manifest.json"), releaseDir=str(out), artifactDigest=manifest["adapterBuildRef"],
             releaseId=manifest["id"], release=f"{manifest['componentTypeKey']}@{manifest['version']}")
    say("render", release=f"{manifest['componentTypeKey']}@{manifest['version']}", artifactDigest=manifest["adapterBuildRef"])
    return manifest


def core_identity(runtime_env):
    """Core's isolated conformance signing identity (public facts only, 07 §8A, ADR-19)."""
    signing_file = runtime_env["COMPONENT_CONFORMANCE_SIGNING_FILE"]
    require(signing_file, "COMPONENT_CONFORMANCE_SIGNING_FILE is not deployed")
    signing = read_json(signing_file)
    keys = ("issuer", "tokenSeconds", "secretLocator", "secretVersion", "secretAudience", "privateKeyField", "jwksFile")
    require(set(keys) <= set(signing), "conformance signing delivery incomplete")
    jwks = read_json(signing["jwksFile"])
    require(isinstance(jwks.get("keys"), list) and jwks["keys"]
            and not any(set(k) & {"d", "p", "q", "dp", "dq", "qi", "k"} for k in jwks["keys"]),
            "conformance JWKS must be public-only")
    return {k: signing[k] for k in keys}, signing_file


def install_candidate(r, runtime_env, staged):
    """Write the candidate (DD-136(2)): <dir>/<digest>/{environment,fixture,identity,jwks}.json, 0644 in 0755."""
    state = r.state
    root = Path(runtime_env["COMPONENT_CONFORMANCE_DIR"])
    require(root.is_absolute() and root.is_dir() and not root.is_symlink(),
            "COMPONENT_CONFORMANCE_DIR does not exist (release the platform with DD-136(2) first)")
    digest = state["artifactDigest"]
    final = root / digest
    require(not final.exists() or set(os.listdir(final)) <= {"environment.json", "fixture.json", "identity.json", "jwks.json"},
            "an existing candidate of this digest is not a REMOTE_ADAPTER candidate; refusing to replace it")
    tmp = root / f".{digest}.{os.getpid()}"
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir(mode=0o755)
    for name in ("environment.json", "fixture.json", "identity.json", "jwks.json"):
        source = Path(staged[name])
        document = read_json(source)
        if name != "jwks.json":
            require(document.get("artifactDigest") == digest, f"{name}: artifactDigest differs from the candidate")
        if name == "identity.json":
            require(document.get("jwksFile") == str(final / "jwks.json"), "identity.jwksFile must name the candidate's own JWKS")
        write_json(tmp / name, document, 0o644)
    os.chmod(tmp, 0o755)
    if final.exists():
        old = root / f".{digest}.old.{os.getpid()}"
        os.replace(final, old)
        os.replace(tmp, final)
        shutil.rmtree(old)
    else:
        os.replace(tmp, final)
    r.record(candidate=str(final))
    say("candidate", artifactDigest=digest, files=sorted(os.listdir(final)))


def attach_worker(r, network):
    worker = f"{compose_project()}-worker-1"
    networks = json.loads(docker("inspect", "--format", "{{json .NetworkSettings.Networks}}", worker))
    if network not in networks:
        docker("network", "connect", network, worker)
    r.record(workerNetwork=network)
    say("worker-window", network=network, attached=True)


def detach_worker(network):
    worker = f"{compose_project()}-worker-1"
    if not exists("container", worker):
        return
    networks = json.loads(docker("inspect", "--format", "{{json .NetworkSettings.Networks}}", worker))
    if network in networks:
        docker("network", "disconnect", network, worker)
    say("worker-window", network=network, attached=False)


# ---- file-storage (Cells, file_storage@2) ------------------------------------

CELLS = "file-storage"


def cells_native_env(r, principals, service_login, with_delivery=False):
    s = r.state
    d = r.dir
    values = {
        "CELLS_COMPOSE_PROJECT": s["project"],
        "CELLS_IMAGE": s["cellsImage"],
        "CELLS_INSTALL_FILE": f"{d}/secrets/install.json",
        "CELLS_DB_PASSWORD_FILE": f"{d}/secrets/db_password",
        "CELLS_OAUTH_CONNECTORS": json.dumps(s["connectors"], separators=(",", ":")),
        "CELLS_OIDC_CLIENT_SECRET_FILE": f"{d}/secrets/oidc_client_secret",
        "CELLS_OAUTH_SECRET_FILE": f"{d}/secrets/oauth_secret.json",
        "CELLS_DATASOURCE_KEY_FILE": f"{d}/secrets/datasource_key",
        "CELLS_DATASOURCE_SECRET_FILE": f"{d}/secrets/datasource_secret",
        "CELLS_DATA_DIR": f"{d}/cells-data",
        "CELLS_DB_DATA_DIR": f"{d}/cells-database",
        "CELLS_MIGRATION_BACKUP_DIR": f"{d}/backups",
        "CELLS_DATA_SUBNET": s["subnets"][0],
        "CELLS_UI_SUBNET": s["subnets"][1],
        "CELLS_DB_NAME": "cells", "CELLS_DB_USER": "cells", "CELLS_DB_PORT": "5432",
        "CELLS_DB_CPUS": "1", "CELLS_DB_MEMORY": "1g", "CELLS_CPUS": "2", "CELLS_MEMORY": "4g",
        "CELLS_BIND": ":8080", "CELLS_EXTERNAL": s["external"], "CELLS_NO_TLS": "1",
        "CELLS_CONTAINER_PORT": "8080", "CELLS_PUBLIC_PORT": str(s["port"]), "CELLS_PUBLIC_ADDRESS": "127.0.0.1",
        "CELLS_HEALTH_URL": "http://127.0.0.1:8080/a/frontend/bootconf",
        "CELLS_HEALTH_INTERVAL": "10s", "CELLS_HEALTH_TIMEOUT": "5s", "CELLS_HEALTH_RETRIES": "30",
        "CELLS_HEALTH_START_PERIOD": "60s", "CELLS_START_TIMEOUT_SECONDS": "600",
        "KAILO_FRAME_ANCESTORS": "", "PLATFORM_DISPLAY_NAME": "Kailo", "TMPDIR": f"{d}/tmp",
        "CELLS_DRAFT_NAMESPACE": "usermeta-kailo-draft",
        "CELLS_BINDING_DATASOURCE": "kailobinding", "CELLS_BINDING_VERSIONING_POLICY": "keep-all",
        "CELLS_BINDING_ROOT_FOLDER": "kailo-binding", "CELLS_BINDING_WORKSPACE_SLUG": "kailo-binding",
        "CELLS_BINDING_WORKSPACE_LABEL": "Kailo binding",
        "CELLS_BINDING_PRINCIPALS": principals,
        "CELLS_BINDING_SERVICE_LOGIN": service_login,
        "CELLS_BINDING_FACTS_FILE": f"{d}/binding/facts.json",
    }
    if with_delivery:
        values.update({
            "CELLS_ADAPTER_IMAGE": s["adapterImage"],
            "CELLS_ADAPTER_UID": str(os.getuid()), "CELLS_ADAPTER_GID": str(os.getgid()),
            "CELLS_ADAPTER_CPUS": "0.5", "CELLS_ADAPTER_MEMORY": "256m",
            "CELLS_ADAPTER_DELIVERY_DIR": f"{d}/adapter-delivery",
            "CELLS_ADAPTER_CONFIG_FILE": f"{d}/adapter-delivery/adapter.json",
            "CELLS_ADAPTER_PLATFORM_NETWORK": s["network"],
            "CELLS_NATIVE_ACTION_DELIVERY_DIR": f"{d}/native-action",
            "CELLS_NATIVE_ACTION_CONFIG_FILE": f"{d}/native-action/native.json",
        })
        return env_file(d / "delivery.env", values)
    return env_file(d / "native.env", values)


def cells_secrets(r):
    d = private_dir(r.dir / "secrets")
    if (d / "install.json").is_file():
        return
    db_password = secret_text(40)
    write_private(d / "db_password", db_password + "\n")
    write_private(d / "datasource_key", secret_text(32) + "\n")
    write_private(d / "datasource_secret", secret_text(48) + "\n")
    write_private(d / "oauth_secret.json", json.dumps(secret_text(64)))
    # The isolated instance never federates: a dedicated, unused OIDC client secret.
    write_private(d / "oidc_client_secret", secret_text(48) + "\n")
    dsn = ("postgres://cells:" + db_password + "@cells-db:5432/cells?sslmode=disable"
           "&prefix={{.Meta.prefix}}&policies={{.Meta.policies}}&singular={{.Meta.singular}}")
    write_json(d / "install.json", {
        "dbConnectionType": "manual", "dbManualDSN": dsn,
        "frontendLogin": "kailo-conformance-admin", "frontendPassword": secret_text(32),
        "frontendDefaultLanguage": "zh-cn", "frontendApplicationTitle": "Kailo Conformance",
        "dsType": "LOCAL", "dsFolder": "/var/cells/data"})


class CellsNative:
    """Original Cells admin entries of the isolated instance (REST v1 with a minted admin PAT, CLI)."""

    def __init__(self, r):
        self.r = r
        s = r.state
        self.container = docker("compose", "--project-name", s["project"], "--env-file", str(r.dir / "native.env"),
                                "-f", f"{s['source']}/file-storage/deploy/compose.yaml", "ps", "--quiet", "cells").split()
        require(len(self.container) == 1, "isolated Cells is not running")
        self.container = self.container[0]
        self.base = f"http://127.0.0.1:{s['port']}/a/"

    def token(self, login, seconds=14400):
        out = docker("exec", self.container, "cells", "admin", "user", "token", "-u", login, "-e", f"{seconds}s", "-q", timeout=180)
        tokens = [line.strip() for line in out.splitlines() if re.fullmatch(r"[A-Za-z0-9._~+/=-]{20,}", line.strip())]
        require(len(tokens) == 1, f"native token for {login} could not be minted")
        return tokens[0]

    def call(self, admin_token, method, path, body=None):
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(self.base + path, data=data, method=method)
        request.add_header("Authorization", "Bearer " + admin_token)
        request.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                raw = response.read(1 << 20)
        except urllib.error.HTTPError as error:
            error.close()
            raise Refused(f"{method} /a/{path.split('/')[0]}: native HTTP {error.code}") from None
        return json.loads(raw) if raw.strip() else {}

    def ensure_user(self, admin_token, login):
        """Create a standard native user through REST PUT /a/user/{Login} (password in the body only)."""
        try:
            found = self.call(admin_token, "GET", "user/" + login)
            if found.get("Uuid"):
                return found["Uuid"]
        except Refused:
            pass
        created = self.call(admin_token, "PUT", "user/" + login, {
            "Login": login, "Password": secret_text(32), "GroupPath": "/",
            "Attributes": {"profile": "standard"}})
        require(created.get("Uuid"), f"native user {login} was not created")
        return created["Uuid"]


def file_storage(r, args, runtime_env, declaration):
    s = r.state
    d = r.dir
    source = s["source"]
    upstream = (Path(source) / "file-storage/fork/upstream.yaml").read_text(encoding="utf-8")

    def artifact(name):
        match = re.search(r"- name: " + re.escape(name) + r"\n(?:.*\n)*?\s+artifact_digest: (sha256:[0-9a-f]{64})", upstream)
        require(match, f"{name} has no recorded artifact digest")
        return match.group(1)

    if "project" not in s:
        run_id = d.name.rsplit("-", 1)[-1]
        subnets = free_subnets(2)
        port = free_port(58190, 58199)
        r.record(project=f"kailo-cells-conformance-{run_id}", network=f"kailo-conformance-fs-{run_id}", subnets=subnets,
                 port=port, external=f"http://127.0.0.1:{port}",
                 cellsImage=f"{declaration['registry']}/file-storage-service@{artifact('file-storage-service')}",
                 adapterImage=f"{declaration['registry']}/file-storage-adapter@{artifact('file-storage-adapter')}",
                 connectors=[{"id": "pydio", "name": "Pydio Cells", "type": "pydio"},
                             {"id": "kailo-conformance-unused", "name": "Kailo", "type": "kailo-oidc", "config": {
                                 "issuer": "http://conformance-idp.invalid/realms/kailo-conformance",
                                 "clientId": "kailo-conformance-unused",
                                 "clientSecretFile": "/run/secrets/cells_oidc_client_secret",
                                 "redirectUri": f"http://127.0.0.1:{port}/auth/kailo/callback", "users": [],
                                 "requestTimeout": "30s", "transactionMaxAgeSeconds": 600, "clientSecretMaxBytes": 4096,
                                 "provisionUsers": False,
                                 "backchannelLogout": {"sessionMaxAgeSeconds": 36000, "logoutTokenMaxAgeSeconds": 300}}}])
        s = r.state
    for sub in ("cells-data", "cells-database", "binding", "backups", "tmp", "stages", "native-action", "agent-bootstrap",
                "openbao-state", "provider", "inputs-staging"):
        private_dir(d / sub)
    private_dir(d / "adapter-delivery")
    cells_secrets(r)
    manifest = render_release(r, CELLS, declaration["nativePageOrigin"])
    require(f"sha256:{manifest['adapterBuildRef']}" == artifact("file-storage-adapter"),
            "rendered adapterBuildRef differs from the recorded adapter artifact")
    admin = "kailo-conformance-admin"
    service, actor = "kailo-conformance-service", "kailo-conformance-actor"
    stages = d / "stages"
    if not (stages / "stage-1.done").exists():
        cells_native_env(r, f"{admin}:rw", "")
    r.record(runEnv={
        "CONFORMANCE_SOURCE": source, "CONFORMANCE_RUN_DIR": str(stages), "CONFORMANCE_NODE_IMAGE": s["nodeImage"],
        "CONFORMANCE_NETWORK": s["network"], "CONFORMANCE_ADAPTER_JWKS": str(d / "adapter-delivery" / "action-token-jwks.json")},
        runEnvFiles={
        "CONFORMANCE_NATIVE_ENV": str(d / "native.env"), "CONFORMANCE_DELIVERY_ENV": str(d / "delivery.env"),
        "CONFORMANCE_OPENBAO_ENV": str(d / "openbao.env"), "CONFORMANCE_SEED_FILE": str(d / "seed.json"),
        "CONFORMANCE_OBSERVE_FILE": str(d / "observe.json"), "CONFORMANCE_PROVIDER_FILE": str(d / "provider" / "provider.json"),
        "CONFORMANCE_MANIFEST": s["manifest"],
        "CONFORMANCE_MOUNTS": f"{d}/secrets/admin.pat {d}/secrets/actor.pat"})
    if not (stages / "stage-0.done").exists():
        r.conformance(0)
    if not (stages / "stage-1.done").exists():
        r.conformance(1)

    # Native principals of the isolated instance, minted through its own API/CLI.
    native = CellsNative(r)
    admin_token = native.token(admin)
    service_uuid = native.ensure_user(admin_token, service)
    actor_uuid = native.ensure_user(admin_token, actor)
    for login, name in ((admin, "admin.pat"), (service, "service.pat"), (actor, "actor.pat")):
        if not (d / "secrets" / name).is_file():
            write_private(d / "secrets" / name, native.token(login) + "\n")
    r.record(serviceUuid=service_uuid, actorUuid=actor_uuid)
    say("native-principals", users=3, tokens=3)
    principals = f"{admin}:rw {service}:r {actor}:rw"
    cells_native_env(r, principals, service)

    if not (stages / "stage-2.done").exists():
        write_json(d / "seed.json", {
            "requirementsFile": str(stages / "requirements.json"), "cellsOrigin": "http://cells:8080",
            "cellsExternal": s["external"], "restBasePath": "/v2/", "restV1BasePath": "/a/",
            "workspaceSlug": "kailo-binding", "rootName": f"kailo-conformance-{d.name}",
            "adminTokenFile": str(d / "secrets/admin.pat"), "actorTokenFile": str(d / "secrets/actor.pat"),
            "s3Secret": "gatewaysecret", "timeoutMs": 30000, "out": str(stages / "native-facts.json")})
        r.conformance(2)

    # Isolated bind plan with fresh simulated identities (never production ones).
    identity, signing_file = core_identity(runtime_env)
    audience = f"kailo-conformance-{CELLS}"
    port = 8399
    provider = f"http://conformance-provider:{port}"
    if not (d / "isolated-plan.json").is_file():
        run(["python3", "-I", f"{source}/tools/component-release/conformance/isolated-plan.py",
             "--release-dir", s["releaseDir"], "--native-facts", str(stages / "native-facts.json"),
             "--binding-facts", str(d / "binding/facts.json"), "--native-page-url", declaration["nativePageOrigin"],
             "--native-instance-ref", s["project"], "--kv-mount", "kv", "--actor-native-user", actor_uuid,
             "--source-root", source, "--plan-out", str(d / "isolated-plan.json"),
             "--context-out", str(d / "isolated-context.json")], log=r.log)
    plan = read_json(d / "isolated-plan.json")
    context = read_json(d / "isolated-context.json")
    # Provider binding client secret: the oidc_client_secret SecretRef value of the simulated binding.
    if not (d / "provider/client_secret").is_file():
        write_private(d / "provider/client_secret", secret_text(48) + "\n")

    # Adapter and native action deliveries rendered from the isolated plan.
    if not (d / "adapter-delivery/adapter.json").is_file():
        write_json(d / "native-actors.json", context["actors"])
        common = ["--plan", str(d / "isolated-plan.json"), "--env-file", runtime_env["env"],
                  "--core-pep-url", f"{provider}/service/v1/adapter/pep_check", "--oidc-token-url", f"{provider}/oidc/token"]
        tool = f"{source}/deploy/components/adapter-delivery.py"
        run(["python3", "-I", tool, "config", "--kind", "adapter", *common,
             "--template", f"{source}/deploy/components/file-storage-adapter.template.json",
             "--delivery-dir", str(d / "adapter-delivery"), "--action-token-signing-file", signing_file,
             "--action-token-audience", audience,
             "--public-file", f"action-token-jwks.json={identity['jwksFile']}",
             "--public-file", f"gateway-service-jwks.json={runtime_env['GATEWAY_SERVICE_JWKS_FILE']}",
             "--set", f"nativeRootRef={read_json(d / 'binding/facts.json')['nativeRootRef']}",
             "--set", f"downloadOrigin={s['external']}", "--set", "bindingGeneration=1",
             "--release-dir", s["releaseDir"],
             "--registration", f"{source}/contracts/adapter/file_storage.v2/registration.json",
             "--out", str(d / "adapter-delivery/adapter.json")], log=r.log)
        sets = []
        for name, value in context["nativeActionSets"].items():
            sets += ["--set", f"{name}={value}"]
        run(["python3", "-I", tool, "config", "--kind", "cells-native", *common,
             "--template", f"{source}/deploy/components/file-storage-native-action.template.json",
             "--delivery-dir", str(d / "native-action"), *sets, "--set-json", f"actors={d / 'native-actors.json'}",
             "--out", str(d / "native-action/native.json")], log=r.log)
    cells_native_env(r, principals, service, with_delivery=True)
    bao_port = s.get("baoPort") or free_port(58290, 58299)
    r.record(baoPort=bao_port, coreJwks=identity["jwksFile"])
    env_file(d / "openbao.env", {
        "OPENBAO_CONFORMANCE_SOURCE": source, "OPENBAO_CONFORMANCE_NAME": f"kailo-openbao-conformance-{d.name.rsplit('-', 1)[-1]}",
        "OPENBAO_CONFORMANCE_IMAGE": platform_openbao_image(), "OPENBAO_CONFORMANCE_PORT": str(bao_port),
        "OPENBAO_CONFORMANCE_STATE_DIR": str(d / "openbao-state"), "OPENBAO_CONFORMANCE_NETWORK": s["network"],
        "OPENBAO_CONFORMANCE_ADAPTER_CONFIG": str(d / "adapter-delivery/adapter.json"),
        "OPENBAO_CONFORMANCE_SECRETS": f"cells_bearer={d / 'secrets/service.pat'} oidc_client_secret={d / 'provider/client_secret'}",
        "OPENBAO_CONFORMANCE_ROLE": f"conformance-{CELLS}-reader",
        "OPENBAO_CONFORMANCE_EXTRA_SECRETS": "oidc_client_secret",
        "ADAPTER_AGENT_PROJECT": f"kailo-agent-conformance-{d.name.rsplit('-', 1)[-1]}",
        "ADAPTER_AGENT_UID": str(os.getuid()), "ADAPTER_AGENT_GID": str(os.getgid()),
        "ADAPTER_AGENT_BOOTSTRAP_DIR": str(d / "agent-bootstrap"), "ADAPTER_AGENT_DELIVERY_DIR": str(d / "adapter-delivery"),
        "ADAPTER_AGENT_EXTRA_DIR": str(d / "native-action")})
    files = r.state["runEnvFiles"]
    files["CONFORMANCE_CORE_JWKS"] = identity["jwksFile"]
    r.record(runEnvFiles=files)
    if not (stages / "stage-3.done").exists():
        r.conformance(3)

    # Observation inputs: suite provider shape + the protocol execution of a forward vector step.
    targets = read_json(stages / "native-facts.json")["targets"]
    write_json(d / "provider/targets.json", targets)
    binding = context["providerBinding"]
    binding = {**binding, "serviceClientSecretFile": str(d / "provider/client_secret")}
    write_json(d / "provider/binding.json", binding)
    vectors = json.loads(read_json(f"{source}/contracts/adapter/file_storage.v2/registration.json")["testVectorsJson"])
    listing = next(step for case in vectors["cases"] for step in case["steps"] if step["contractKey"] == "file_storage.list@v2")
    list_input = json.loads(listing["inputJson"])
    policy = context["resultExposurePolicy"]
    candidate = Path(runtime_env["COMPONENT_CONFORMANCE_DIR"] or "/nonexistent") / s["artifactDigest"]
    provider_config = {"listenHost": "0.0.0.0", "listenPort": port, "productionActionAudience": manifest["executionConnector"]["actionTokenAudience"],
                       "bindingFile": str(d / "provider/binding.json"), "targetsFile": str(d / "provider/targets.json"),
                       "nativeCheck": {"kind": "cells", "restBaseUrl": "http://cells:8080/v2/", "bearerFile": str(d / "secrets/service.pat")},
                       "requestTimeoutMs": 10000, "requestMaxBytes": 1048576,
                       "releaseManifestFile": s["manifest"], "nativeTaskTypes": {"file_storage.delete@v2": "job"}}
    write_json(d / "observe.json", {
        "component": CELLS, "manifestFile": s["manifest"], "seed": str(uuid.uuid4()),
        "adapterBaseUrl": "http://cells-adapter:8080/", "suiteAdapterBaseUrl": "http://cells-adapter:8080/",
        "maxResponseBytes": 1048576, "maxSteps": 400,
        "adapterConfigFile": str(d / "adapter-delivery/adapter.json"),
        "adapterJwksFile": str(d / "adapter-delivery/action-token-jwks.json"),
        "provider": {k: provider_config[k] for k in ("listenHost", "listenPort", "productionActionAudience", "bindingFile",
                                                      "targetsFile", "nativeCheck", "requestTimeoutMs", "requestMaxBytes")},
        "identity": {**identity, "audience": audience, "jwksFile": str(candidate / "jwks.json")},
        "principals": context["principals"], "bindingManagement": context["bindingManagement"],
        "execution": {"actionKey": "file_storage.list@v2", "target": {"resourceId": list_input["resourceId"]},
                      "input": list_input, **policy},
        "vectorContexts": {"default": policy},
        "nativeFactsFile": str(stages / "native-facts.json"), "out": str(stages / "facts.json")})
    if not (stages / "stage-4.done").exists():
        r.conformance(4)
    if not (stages / "stage-5.done").exists():
        r.conformance(5)
    # The suite provider verifies Core-signed probes against Core's public JWKS; stage 6 places that
    # JWKS in the adapter delivery, so the provider's copy of the identity names it there (the
    # candidate's identity names the candidate's own copy, installed after this run).
    provider_identity = read_json(stages / "inputs/identity.json")
    provider_identity["jwksFile"] = str(d / "adapter-delivery/action-token-jwks.json")
    write_json(d / "provider/identity.json", provider_identity)
    write_json(d / "provider/provider.json", {"mode": "CONFORMANCE_ONLY", **provider_config,
                                               "identityFile": str(d / "provider/identity.json")})
    if not (stages / "stage-6.done").exists():
        r.conformance(6)
    return {"environment.json": stages / "inputs/environment.json", "fixture.json": stages / "inputs/fixture.json",
            "identity.json": stages / "inputs/identity.json", "jwks.json": identity["jwksFile"]}


DRIVERS = {"file-storage": file_storage}


def driver(component):
    """Built-in driver, or conformance/auto_<component>.py whose drive(r, args, runtime_env, declaration, h)
    receives this module as h (shared helpers); each returns the staged candidate files and records
    "network" (the run's dedicated network) and "artifactDigest"."""
    if component in DRIVERS:
        return DRIVERS[component]
    import importlib.util
    path = Path(__file__).resolve().parent / "conformance" / f"auto_{component.replace('-', '_')}.py"
    require(path.is_file(), f"{component}: no unattended driver")
    spec = importlib.util.spec_from_file_location(f"auto_{component.replace('-', '_')}", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    helpers = sys.modules[__name__]
    return lambda r, args, runtime_env, declaration: module.drive(r, args, runtime_env, declaration, helpers)


def cmd_run(args):
    drive = driver(args.component)
    require(re.fullmatch(r"[0-9a-f]{40}", args.commit), "--commit must be a full commit")
    source = Path(args.source).resolve()
    require((source / "tools/component-release/conformance-run.sh").is_file(), "--source is not a release tree")
    declarations = read_json(source / "deploy/components/adapters.json")
    declaration = declarations[args.component]
    runtime_env = runtime_facts(args.runtime)
    if args.resume:
        r = Run(args.resume)
        require(r.state.get("component") == args.component, "--resume names another component's run")
        r.record(source=str(source), commit=args.commit, state="RUNNING")
    else:
        root = private_dir(args.run_root)
        r = Run(private_dir(root / f"{args.component}-{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}-{secrets.token_hex(3)}"))
        r.record(component=args.component, source=str(source), commit=args.commit, runtime=str(Path(args.runtime).resolve()),
                 nodeImage=node_image(source), state="RUNNING")
    say("run", component=args.component, run=str(r.dir))
    try:
        staged = drive(r, args, runtime_env, declaration)
        if args.no_install:
            r.record(state="INPUTS_READY")
            say("done", state="INPUTS_READY", run=str(r.dir))
            return
        install_candidate(r, runtime_env, staged)
        attach_worker(r, r.state["network"])
        r.record(state="CANDIDATE_INSTALLED")
        say("done", state="CANDIDATE_INSTALLED", artifactDigest=r.state["artifactDigest"], run=str(r.dir))
    except Refused as error:
        r.record(state="FAILED", reason=str(error))
        say("failed", reason=str(error), run=str(r.dir))
        sys.exit(1)
    except (OSError, ValueError, KeyError, TypeError, StopIteration):
        # Python tracebacks name code locations and keys, never file contents; they go to the
        # owner-only run log only.
        import traceback
        with open(r.log, "a", encoding="utf-8") as stream:
            traceback.print_exc(file=stream)
        r.record(state="FAILED", reason="internal error; see the run log")
        say("failed", reason="internal error; see the run log", run=str(r.dir))
        sys.exit(1)


def cmd_close(args):
    r = Run(args.run)
    s = r.state
    require(s.get("component"), "not a conformance-auto run directory")
    runtime_env = runtime_facts(args.runtime)
    if s.get("candidate"):
        candidate = Path(s["candidate"])
        root = Path(runtime_env["COMPONENT_CONFORMANCE_DIR"])
        require(candidate.parent == root and candidate.name == s["artifactDigest"], "recorded candidate is outside the candidate set")
        if candidate.is_dir():
            require(set(os.listdir(candidate)) <= {"environment.json", "fixture.json", "identity.json", "jwks.json"},
                    "candidate is not a REMOTE_ADAPTER candidate; refusing to remove it")
            shutil.rmtree(candidate)
        say("candidate", artifactDigest=s["artifactDigest"], removed=True)
    if s.get("network"):
        detach_worker(s["network"])
        name = f"kailo-conformance-provider-{s['component']}"
        run(DOCKER + ["rm", "-f", name], check=False)
        if (r.dir / "openbao.env").is_file():
            run(["bash", f"{s['source']}/tools/component-release/conformance/isolated-openbao.sh", "down", str(r.dir / "openbao.env")],
                log=r.log, check=False)
        if s["component"] != CELLS:
            import importlib.util
            path = Path(__file__).resolve().parent / "conformance" / f"auto_{s['component'].replace('-', '_')}.py"
            if path.is_file():
                spec = importlib.util.spec_from_file_location("auto_close", path)
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                if hasattr(module, "teardown"):
                    module.teardown(r, sys.modules[__name__])
        elif s.get("project"):
            for env in ("delivery.env", "native.env"):
                if (r.dir / env).is_file():
                    files = ["-f", f"{s['source']}/file-storage/deploy/compose.yaml", "-f",
                             f"{s['source']}/file-storage/deploy/compose.native-actions.yaml", "-f",
                             f"{s['source']}/file-storage/deploy/compose.adapter.yaml"] if env == "delivery.env" else \
                        ["-f", f"{s['source']}/file-storage/deploy/compose.yaml"]
                    run(DOCKER + ["compose", "--project-name", s["project"], "--env-file", str(r.dir / env), *files,
                                  "down", "--volumes", "--remove-orphans"], log=r.log, check=False)
                    break
        run(DOCKER + ["network", "rm", s["network"]], check=False)
        say("isolated", project=s.get("project"), network=s["network"], removed=True)
    r.record(state="CLOSED")


def cmd_status(args):
    s = Run(args.run).state
    print(json.dumps({k: s.get(k) for k in ("component", "release", "artifactDigest", "state", "reason", "candidate", "network")},
                     ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("run")
    p.add_argument("component")
    p.add_argument("--source", required=True)
    p.add_argument("--commit", required=True)
    p.add_argument("--runtime", required=True)
    p.add_argument("--run-root", default=RUN_ROOT)
    p.add_argument("--resume", help="continue a run directory whose last stage failed after the cause was fixed")
    p.add_argument("--no-install", action="store_true", help="stop after the inputs (no candidate, no Worker window)")
    c = sub.add_parser("close")
    c.add_argument("run")
    c.add_argument("--runtime", required=True)
    t = sub.add_parser("status")
    t.add_argument("run")
    args = parser.parse_args()
    os.umask(0o077)
    try:
        {"run": cmd_run, "close": cmd_close, "status": cmd_status}[args.command](args)
    except Refused as error:
        say("refused", reason=str(error))
        sys.exit(2)
    except (OSError, ValueError, KeyError, TypeError) as error:
        say("refused", reason=f"{type(error).__name__}; see the run log")
        sys.exit(2)


if __name__ == "__main__":
    main()
