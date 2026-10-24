"""Unattended knowledge@3 conformance driver (DD-136(5), DD-124(4), .design/07 §8A).

Loaded by tools/component-release/conformance-auto.py (`run knowledge`). knowledge@3 carries
RECEIVER cases, so the candidate is observed from the isolated receiver deployment of
tools/component-release/receiver-run.sh (its own Core/Worker/SpiceDB/Temporal/OpenBao/IdP, same
Core/Worker image digests as production). This module writes every input of that runner from
deployment facts and run-local secrets, stage by stage, without an operator:

  platform   platform.env derived from the production runtime .env (non-secret configuration;
             loopback publication, ports free on this host, OIDC_HOST keycloak.kailo.local which
             /etc/hosts maps to loopback for the host and the compose alias maps to the isolated
             IdP for containers; every production delivery path blanked), Core provenance from
             the CI release-proof store; receiver-run.sh platform
  contracts  the isolated second Catalog admin created in the isolated IdP (random password,
             0600 account file only); receiver-run.sh contracts

Later stages (native, bootstrap, seed, inputs, driver) need the isolated platform's own
ActionToken identity, a governed model route for the PLATFORM_LLM_ROUTE receiver binding and the
source Cells instance; they are listed in `blocked_after_contracts` with the reason, so a run stops
there with an explicit state instead of an operator step.

Nothing here touches production state; production is only read (its .env keys, its running
Core/Worker image digests and the release-proof store).
"""
import json
import os
from pathlib import Path
import re
import secrets
import socket
import urllib.parse
import urllib.request

RUNTIME_PRODUCTION_PROJECT = "platform-local"
OIDC_HOST = "keycloak.kailo.local"  # /etc/hosts: 127.0.0.1 on the CI node; compose alias in containers

# Production deliveries the isolated platform must not reuse (it prepares its own or runs without).
BLANK = (
    "ACTION_TOKEN_SIGNING_FILE", "ACTION_TOKEN_PUBLIC_JWKS_LOCATOR", "ACTION_TOKEN_JWKS_READER_ROLE",
    "COMPONENT_CONFORMANCE_SIGNING_FILE", "COMPONENT_CONFORMANCE_PUBLIC_JWKS_LOCATOR", "COMPONENT_CONFORMANCE_JWKS_READER_ROLE",
    "COMPONENT_CONFORMANCE_ENVIRONMENT_FILE", "COMPONENT_CONFORMANCE_FIXTURE_FILE", "COMPONENT_CONFORMANCE_IDENTITY_FILE",
    "COMPONENT_CONFORMANCE_DIR", "COMPONENT_CONFORMANCE_WORKER_DIR", "APPLICATION_ADAPTER_DIRECTORY_FILE",
    "GATEWAY_SERVICE_ISSUER", "GATEWAY_SERVICE_AUDIENCE", "GATEWAY_SERVICE_CALLER_ID", "GATEWAY_SERVICE_JWKS_FILE",
    "GATEWAY_SERVICE_MAX_TOKEN_SECONDS", "GATEWAY_SERVICE_SIGNING_KEY_FILE", "GATEWAY_SERVICE_KEY_ID",
    "GATEWAY_SERVICE_TOKEN_SECONDS", "AGENT_TOOL_MCP_URL", "AGENT_TOOL_EXT_MCP_URL", "AGENT_TOOL_SESSION_ISSUER",
    "AGENT_TOOL_SESSION_AUDIENCE", "AGENT_TOOL_SESSION_TOKEN_SECONDS", "AGENT_TOOL_GATEWAY_URL", "AGENT_TOOL_GATEWAY_NAME",
    "AGENT_RUNTIME_BINARY", "AGENT_RUNTIME_STATE_ROOT", "AGENT_RUNTIME_RPC_TIMEOUT_SECONDS", "AGENT_RUNTIME_MAX_MESSAGE_BYTES",
    "AGENT_RUNTIME_PROFILES_FILE", "NATIVE_OIDC_CLIENTS", "COMPONENT_DIRECTORY_CLIENTS",
)


def _env_lines(path):
    with open(path, encoding="utf-8") as stream:
        return stream.read().splitlines()


def _in_use(port):
    with socket.socket() as probe:
        return probe.connect_ex(("127.0.0.1", port)) == 0


def platform_env(h, r, project):
    """Isolated platform .env from the production runtime .env (values never printed)."""
    production = Path(r.state["runtime"]) / ".env"
    lines = _env_lines(production)
    keys = {}
    for line in lines:
        match = re.match(r"^([A-Z][A-Z0-9_]*)=(.*)$", line)
        if match:
            keys[match.group(1)] = match.group(2)
    taken = set()
    published = h.docker("ps", "-a", "--format", "{{.Ports}}")
    ports = {}

    def fresh():
        for port in range(59100, 59400):
            if port not in taken and f":{port}->" not in published and not _in_use(port):
                taken.add(port)
                return port
        raise h.Refused("no free loopback port for the isolated platform")

    for key, value in keys.items():
        raw = value.strip().strip("'\"")
        if key.endswith("_PORT") and not key.endswith("_CONTAINER_PORT") and re.fullmatch(r"[0-9]{2,5}", raw):
            port = int(raw)
            if port in taken or _in_use(port) or f":{port}->" in published:
                ports[key] = fresh()
            else:
                taken.add(port)
    overrides = {k: "" for k in BLANK}
    overrides.update({
        "PUBLIC_HOST": "127.0.0.1", "PUBLIC_BIND_ADDR": "127.0.0.1", "OIDC_HOST": OIDC_HOST,
        "PLATFORM_EDGE_NETWORK": f"{project}-edge",
        # Origins of the candidate releases (strings Core compares; nothing is served there).
        "NATIVE_PAGE_ORIGINS": "\"http://192.168.0.193:58092 http://192.168.0.193:58094\"",
        "AUTOMATION_WEBHOOK_PUBLIC_BASE_URL": "",
    })
    overrides.update({k: str(v) for k, v in ports.items()})
    out = []
    for line in lines:
        match = re.match(r"^([A-Z][A-Z0-9_]*)=", line)
        if match and match.group(1) in overrides:
            out.append(f"{match.group(1)}={overrides.pop(match.group(1))}")
        else:
            out.append(line)
    out += [f"{k}={v}" for k, v in overrides.items() if k not in BLANK and k not in keys]
    path = h.write_private(r.dir / "platform.env", "\n".join(out) + "\n")
    webhook = ports.get("AGENTGATEWAY_WEBHOOK_PORT")
    if webhook:
        text = path.read_text(encoding="utf-8").replace(
            "AUTOMATION_WEBHOOK_PUBLIC_BASE_URL=\n", f"AUTOMATION_WEBHOOK_PUBLIC_BASE_URL=http://127.0.0.1:{webhook}\n")
        h.write_private(path, text)
    return {"changedPorts": sorted(ports), "agentgatewayPort": ports.get("AGENTGATEWAY_PORT") or keys.get("AGENTGATEWAY_PORT")}


def core_provenance(h):
    config = h.read_json("/volumes/kailo/ci/config.json")
    image = h.docker("inspect", "--format", "{{.Config.Image}}", f"{RUNTIME_PRODUCTION_PROJECT}-core-bff-1").strip()
    digest = image.rsplit("@sha256:", 1)[-1]
    path = Path(config["release_proofs"]) / f"core.{digest}.provenance.json"
    h.require(path.is_file(), "production Core provenance is not in the release-proof store")
    return str(path)


def receiver_env(h, r, extra=None):
    s = r.state
    values = {
        "RECEIVER_SOURCE": s["source"], "RECEIVER_RUN_DIR": str(r.dir / "receiver"), "RECEIVER_PROJECT": s["project"],
        "RECEIVER_NETWORK": s["network"], "RECEIVER_NODE_IMAGE": s["nodeImage"],
        "RECEIVER_PLATFORM_ENV": str(r.dir / "platform.env"), "RECEIVER_PRODUCTION_PROJECT": RUNTIME_PRODUCTION_PROJECT,
        "RECEIVER_CORE_PROVENANCE": s["coreProvenance"],
        "RECEIVER_FLOW_NODE": "/usr/local/bin/node", "RECEIVER_PLAYWRIGHT_PACKAGE": "/volumes/kailo/apps/package.json",
        "RECEIVER_ACCOUNTS_DIR": str(r.dir / "accounts"), "RECEIVER_MANIFEST": s.get("manifest", ""),
        "CHECK_CPUS": "4", "CHECK_MEMORY": "8g", "TMPDIR": str(h.private_dir(r.dir / "tmp")),
    }
    values.update(extra or {})
    return h.env_file(r.dir / "receiver.env", {k: v for k, v in values.items() if v != ""})


def receiver(h, r, stage):
    h.say("receiver-run", stage=stage)
    h.run(["bash", f"{r.state['source']}/tools/component-release/receiver-run.sh", str(r.dir / "receiver.env"), stage], log=r.log)


def isolated_value(r, name):
    """A non-secret key of the isolated platform's own .env (staged runtime)."""
    env = r.dir / "receiver" / "apps/deploy/local/.env"
    for line in _env_lines(env):
        if line.startswith(name + "="):
            return line.split("=", 1)[1].strip().strip("'\"")
    return ""


def ensure_approver(h, r):
    """The isolated second Catalog admin: an IdP user of the isolated realm only, its random password
    in one 0600 account file (lib.mjs format), never printed."""
    accounts = h.private_dir(r.dir / "accounts")
    path = accounts / "kailo-platform-approver.env"
    if path.is_file():
        return
    secrets_dir = r.dir / "receiver" / "apps/deploy/local/secrets"
    base = f"http://127.0.0.1:{isolated_value(r, 'KEYCLOAK_PORT')}"
    realm = isolated_value(r, "OIDC_REALM")
    form = urllib.parse.urlencode({"grant_type": "password", "client_id": "admin-cli",
                                   "username": isolated_value(r, "KEYCLOAK_ADMIN_USER"),
                                   "password": (secrets_dir / "keycloak_admin_password").read_text().strip()}).encode()
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(f"{base}/realms/master/protocol/openid-connect/token", form, timeout=30) as response:
        token = json.load(response)["access_token"]

    def call(method, path_, body=None):
        request = urllib.request.Request(f"{base}/admin/realms/{realm}{path_}", method=method,
                                         data=None if body is None else json.dumps(body).encode(),
                                         headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
        with opener.open(request, timeout=30) as response:
            raw = response.read()
            return json.loads(raw) if raw else None

    name = "kailo-platform-approver"
    found = call("GET", f"/users?exact=true&username={name}")
    if not found:
        call("POST", "/users", {"username": name, "email": f"{name}@kailo.test", "emailVerified": True, "enabled": True,
                                "firstName": "Approver", "lastName": "Conformance"})
        found = call("GET", f"/users?exact=true&username={name}")
    password = secrets.token_urlsafe(24)
    call("PUT", f"/users/{found[0]['id']}/reset-password", {"type": "password", "value": password, "temporary": False})
    h.write_private(path, f"KAILO_ACCEPT_USER={name}\nKAILO_ACCEPT_PASSWORD={password}\n")
    h.say("isolated-account", user=name, created=True)


def drive(r, args, runtime_env, declaration, h):
    s = r.state
    if "project" not in s:
        run_id = r.dir.name.rsplit("-", 1)[-1]
        r.record(project=f"kailo-receiver-{run_id}", network=f"kailo-conformance-kn-{run_id}",
                 coreProvenance=core_provenance(h))
        h.private_dir(r.dir / "receiver")
    manifest = h.render_release(r, "knowledge", declaration["nativePageOrigin"])
    s = r.state
    receiver_dir = r.dir / "receiver"
    if not (receiver_dir / "core-build.json").is_file():
        facts = platform_env(h, r, s["project"])
        r.record(platformPorts=facts["changedPorts"])
        receiver_env(h, r)
        receiver(h, r, "platform")
    receiver_env(h, r)
    if not (receiver_dir / "contracts.done").is_file():
        ensure_approver(h, r)
        receiver(h, r, "contracts")
    r.record(blockedAfterContracts=(
        "native/bootstrap/seed/inputs/driver need: the isolated platform's own ActionToken signing identity "
        "(start-core.sh --prepare-action-token in the isolated runtime), a governed PLATFORM_LLM_ROUTE model route "
        "for the receiver binding (receiver_environment_bootstrap requires modelCallMode PLATFORM_LLM_ROUTE), the "
        "source Cells instance of cells@2.0.0 with its native-action delivery, and the WeKnora candidate with "
        "--platform-adapter --file-storage-sync; not automated yet"))
    raise h.Refused("knowledge: isolated platform and contracts ready; later receiver stages are not automated yet "
                    f"(manifest {manifest['componentTypeKey']}@{manifest['version']})")


def teardown(r, h):
    if (r.dir / "receiver.env").is_file():
        h.run(["bash", f"{r.state['source']}/tools/component-release/receiver-run.sh", str(r.dir / "receiver.env"), "down"],
              log=r.log, check=False)
