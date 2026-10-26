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

  identity   the isolated Core's own ActionToken signing identity (start-core.sh
             --prepare-action-token in the staged runtime: Core generates the key into the
             isolated OpenBao, the public JWKS is rendered by the original Agent path), then
             start-core.sh --no-build so the isolated Core signs receiver actions with it

  sessions   the original native-client PKCE login for three isolated HUMAN accounts;
             retain their observed identities and refresh tokens in owner-only files

  models     DD-136(5): keyless native sources for the declared upstreams (adapters.json
             knowledge.conformanceModels and its gatewaySource bodies) written into the isolated
             AgentGateway through its admin API, then one governed llm_route.create each through the
             isolated Web origin (flow/llm-route-create.mjs) for the PLATFORM_LLM_ROUTE receiver binding

  native     independent WeKnora deployment through its original provisioning and Compose entries;
             governed native-page binding, member directory, model credential delivery and real
             OIDC Admin session; original APIs create this run's KB and exactly scoped MCP endpoint

Later stages still need the source Cells (cells@2.0.0), both receiver adapter deliveries rendered
from bootstrap identities fixed in advance, and bootstrap/seed/observe/driver inputs. A run records
what remains in auto-state.json and stops with an explicit FAILED state instead of an operator step.

Nothing here touches production state; production is only read (its .env keys, its running
Core/Worker image digests and the release-proof store).
"""
import json
import hashlib
import os
from pathlib import Path
import re
import shlex
import secrets
import socket
import urllib.parse
import urllib.request
import uuid

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
    spice_port = keys.get("SPICEDB_HTTP_CONTAINER_PORT", "").strip().strip("'\"")
    h.require(re.fullmatch(r"[0-9]{2,5}", spice_port), "isolated SpiceDB HTTP container port is missing")
    overrides.update({
        "PUBLIC_HOST": "127.0.0.1", "PUBLIC_BIND_ADDR": "127.0.0.1", "OIDC_HOST": OIDC_HOST,
        "PLATFORM_EDGE_NETWORK": f"{project}-edge",
        # Origins of the candidate releases (strings Core compares; nothing is served there).
        "NATIVE_PAGE_ORIGINS": '"http://192.168.0.193:58092 http://192.168.0.193:58094 '
                               + r.state["knowledgeNative"]["origin"] + '"',
        # The receiver bootstrap refuses a database with the production name,
        # even when it is hosted by a different isolated PostgreSQL instance.
        "CORE_DB_NAME": "receiver_" + project.rsplit("-", 1)[-1],
        # Docker registers the project-qualified container name on app. The
        # bootstrap deliberately rejects even a network-isolated service when
        # its declared origin still equals the production origin string.
        "SPICEDB_HTTP_URL": f"http://{project}-spicedb-1:{spice_port}",
        "COMPONENT_DIRECTORY_CLIENTS": "knowledge=" + r.state["knowledgeNative"]["directoryClient"],
        "AUTOMATION_WEBHOOK_PUBLIC_BASE_URL": "",
    })
    overrides.update({k: str(v) for k, v in ports.items()})
    # The automation egress network has a fixed subnet and gateway address; the isolated copy gets
    # a free /28 of its own (same shape as production's, gateway at .10).
    egress = h.free_subnets(1, prefix="10.202.", start=16, stop=250)[0]
    egress = egress.replace(".0/24", ".0/28")
    overrides.update({"AUTOMATION_EGRESS_SUBNET": egress, "AUTOMATION_EGRESS_GATEWAY_IP": egress.replace(".0/28", ".10")})
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
        "CHECK_CPUS": "4", "CHECK_MEMORY": "8g", # Short path: Chrome's browser flows bind Unix sockets under TMPDIR (108-byte limit).
        "TMPDIR": str(h.private_dir(Path("/var/lib/kailo-ci/tmp") / f"kr-{r.dir.name.rsplit('-', 1)[-1]}")),
    }
    # Resume must retain the native/bootstrap delivery, not silently truncate
    # receiver.env back to the platform-only fields.
    values.update(s.get("receiverEnv", {}))
    values.update(extra or {})
    if extra:
        r.record(receiverEnv={**s.get("receiverEnv", {}), **extra})
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


def _set_env(h, path, values):
    """Replace KEY= lines of the staged .env (non-secret values only)."""
    lines, seen = [], set()
    for line in _env_lines(path):
        match = re.match(r"^([A-Z][A-Z0-9_]*)=", line)
        if match and match.group(1) in values:
            lines.append(f"{match.group(1)}={values[match.group(1)]}")
            seen.add(match.group(1))
        else:
            lines.append(line)
    lines += [f"{k}={v}" for k, v in values.items() if k not in seen]
    h.write_private(path, "\n".join(lines) + "\n")


def ensure_action_token(h, r):
    """The isolated Core's own ActionToken identity through the original deployment-only path."""
    local = r.dir / "receiver" / "apps/deploy/local"
    marker = r.dir / "receiver" / "action-token.done"
    if marker.is_file():
        return
    namespace, mount = isolated_value(r, "OPENBAO_PLATFORM_NAMESPACE"), isolated_value(r, "OPENBAO_KV_MOUNT")
    audience = isolated_value(r, "OIDC_SERVICE_CLIENT_ID")
    h.require(namespace and mount and audience, "isolated OpenBao namespace/KV mount or Core service client unknown")
    signing_dir = local / "data" / "action-token"
    public_dir = local / "data" / "action-token-public"
    signing_dir.mkdir(mode=0o755, exist_ok=True)
    os.chmod(signing_dir, 0o755)
    public_dir.mkdir(mode=0o700, exist_ok=True)
    os.chmod(public_dir, 0o700)
    signing = signing_dir / "signing.json"
    h.write_json(signing, {"issuer": "http://core-bff:8082/action-token", "tokenSeconds": 300,
                           "secretLocator": f"{namespace}/{mount}/action-token/signing", "secretVersion": 1,
                           "secretAudience": audience, "privateKeyField": "private_jwk",
                           "jwksFile": str(public_dir / "jwks.json")}, 0o644)
    _set_env(h, local / ".env", {"ACTION_TOKEN_SIGNING_FILE": str(signing),
                                 "ACTION_TOKEN_PUBLIC_JWKS_LOCATOR": f"{namespace}/{mount}/action-token/public-jwks",
                                 "ACTION_TOKEN_JWKS_READER_ROLE": "action-token-jwks-reader"})
    config = h.read_json("/volumes/kailo/ci/config.json")["environment"]
    env = {**os.environ, "KAILO_RUNTIME_DIR": str(local), "CHECK_CPUS": "2", "CHECK_MEMORY": "4g",
           "BUILDX_BUILDER": config.get("BUILDX_BUILDER", ""),
           # High-frequency temporary writes use the CI node's NVMe (07 §2.1).
           "TMPDIR": str(h.private_dir(Path("/var/lib/kailo-ci/tmp") / f"kr-{r.dir.name.rsplit('-', 1)[-1]}"))}
    h.say("isolated-identity", action="prepare-action-token")
    # The deployment-only path is idempotent (an existing key is read back, never regenerated); on the
    # fresh isolated platform its first Agent readback has failed once without a message, so it is
    # retried once before the run stops.
    if h.run(["bash", "./start-core.sh", "--prepare-action-token"], cwd=str(local), env=env, log=r.log,
             check=False).returncode != 0:
        h.say("isolated-identity", action="prepare-action-token", retry=1)
        h.run(["bash", "./start-core.sh", "--prepare-action-token"], cwd=str(local), env=env, log=r.log)
    h.say("isolated-identity", action="restart-core")
    h.run(["bash", "./start-core.sh", "--no-build"], cwd=str(local), env=env, log=r.log, timeout=600)
    marker.write_text("")
    h.say("isolated-identity", actionToken="READY")


def ensure_receiver_links(h, r):
    """Compose replacement drops manually attached receiver network aliases."""
    state = r.state
    for service, aliases in (("core-bff", ["receiver-core", "receiver-driver"]),
                             ("keycloak", ["receiver-idp"]), ("agentgateway", ["receiver-gateway"])):
        container = state["project"] + "-" + service + "-1"
        h.require(h.docker("inspect", "--format", '{{index .Config.Labels "com.docker.compose.project"}}', container).strip() == state["project"],
                  "receiver network target is not owned by this run")
        networks = json.loads(h.docker("inspect", "--format", "{{json .NetworkSettings.Networks}}", container))
        if state["network"] not in networks:
            options = [item for alias in aliases for item in ("--alias", alias)]
            h.docker("network", "connect", *options, state["network"], container)
        else:
            h.require(set(aliases).issubset(networks[state["network"]].get("Aliases") or []), "receiver network aliases differ from this run")


def isolated_token(h, r):
    """Isolated Core service token from the isolated IdP (client credentials; kept in memory)."""
    local = r.dir / "receiver" / "apps/deploy/local"
    form = urllib.parse.urlencode({"grant_type": "client_credentials", "client_id": isolated_value(r, "OIDC_SERVICE_CLIENT_ID"),
                                   "client_secret": (local / "secrets/core_client_secret").read_text().strip()}).encode()
    url = f"http://{OIDC_HOST}:{isolated_value(r, 'KEYCLOAK_PORT')}/realms/{isolated_value(r, 'OIDC_REALM')}/protocol/openid-connect/token"
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(url, form, timeout=30) as response:
        return json.load(response)["access_token"]


def gateway_admin(h, r, method, path, body=None):
    """The isolated AgentGateway admin API (reachable only on the isolated app network): one curl
    container per call, bearer and body through a 0600 config file, never argv or output."""
    work = h.private_dir(r.dir / "gateway-admin")
    cfg = work / "curl.cfg"
    h.write_private(cfg, f'header = "authorization: Bearer {isolated_token(h, r)}"\nheader = "content-type: application/json"\n')
    argv = ["run", "--rm", "-i", "-u", f"{os.getuid()}:{os.getgid()}", "--network", f"{r.state['project']}_app",
            "-v", f"{cfg}:{cfg}:ro", "curlimages/curl:latest", "-sS", "-m", "30", "-K", str(cfg), "-X", method]
    if body is not None:
        argv += ["--data-binary", "@-"]
    argv.append(isolated_value(r, "AGENTGATEWAY_ADMIN_URL") + path)
    try:
        out = h.docker(*argv, stdin=None if body is None else json.dumps(body).encode())
    finally:
        cfg.unlink(missing_ok=True)
    return json.loads(out) if out.strip() else {}


def flow(h, r, script, *args):
    """A governed flow script against the isolated platform (its own Web origin, IdP and accounts)."""
    local = r.dir / "receiver" / "apps/deploy/local"
    env = {**os.environ, "KAILO_WEB": f"http://127.0.0.1:{isolated_value(r, 'AGENTGATEWAY_PORT')}",
           "KAILO_DEPLOY_DIR": str(local), "KAILO_FLOW_ACCOUNTS_DIR": str(r.dir / "accounts"),
           "KAILO_FLOW_OUT": str(r.dir / "flow-out"), "KAILO_PLAYWRIGHT_PACKAGE": "/volumes/kailo/apps/package.json",
           "TMPDIR": str(h.private_dir(Path("/var/lib/kailo-ci/tmp") / f"kr-{r.dir.name.rsplit('-', 1)[-1]}"))}
    return h.run(["/usr/local/bin/node", f"{r.state['source']}/tools/component-release/flow/{script}", *args],
                 env=env, log=r.log)


def ensure_tenant_admin(h, r):
    """accounts/admin.env: the isolated business Tenant's bootstrap admin (BOOTSTRAP_USER) for the flows."""
    path = h.private_dir(r.dir / "accounts") / "admin.env"
    if not path.is_file():
        local = r.dir / "receiver" / "apps/deploy/local"
        h.write_private(path, f"KAILO_ACCEPT_USER={isolated_value(r, 'BOOTSTRAP_USER')}\n"
                              f"KAILO_ACCEPT_PASSWORD={(local / 'secrets/bootstrap_user_password').read_text().strip()}\n")


def ensure_sessions(h, r):
    """Original native-client PKCE sessions, with immutable observed identities.

    The receiver runner invokes the same command before bootstrap/seed/driver
    and periodically while the driver is alive. No token enters argv or logs.
    """
    ensure_tenant_admin(h, r)
    local = r.dir / "receiver" / "apps/deploy/local"
    session_dir = h.private_dir(r.dir / "receiver" / "sessions")
    command = r.dir / "receiver" / "refresh-sessions.sh"
    values = {
        "KAILO_WEB": f"http://127.0.0.1:{isolated_value(r, 'AGENTGATEWAY_PORT')}",
        "KAILO_DEPLOY_DIR": str(local), "KAILO_FLOW_ACCOUNTS_DIR": str(r.dir / "accounts"),
        "KAILO_FLOW_OUT": str(r.dir / "flow-out"), "KAILO_PLAYWRIGHT_PACKAGE": "/volumes/kailo/apps/package.json",
        "TMPDIR": str(h.private_dir(Path("/var/lib/kailo-ci/tmp") / f"kr-{r.dir.name.rsplit('-', 1)[-1]}")),
    }
    argv = ["env", *[f"{key}={value}" for key, value in values.items()], "/usr/local/bin/node",
            f"{r.state['source']}/tools/component-release/flow/receiver-sessions.mjs", "--out", str(session_dir)]
    script = "#!/usr/bin/env bash\nset -euo pipefail\n" + shlex.join(argv) + "\n"
    native_input = r.dir / "receiver" / "knowledge" / "native-input.json"
    native_state = native_input.parent / "native.json"
    native_argv = argv[:-3] + [f"{r.state['source']}/tools/component-release/flow/receiver-knowledge-native.mjs",
                              "--input", str(native_input), "--refresh-only"]
    # Once native setup has succeeded, refresh that real session alongside the
    # isolated Core sessions before every governed seed/driver operation.
    script += f"if test -f {shlex.quote(str(native_state))}; then\n  {shlex.join(native_argv)}\nfi\n"
    h.write_private(command, script, 0o700)
    h.run([str(command)], log=r.log)
    receiver_env(h, r, {"RECEIVER_SESSION_COMMAND": str(command)})
    r.record(sessionIdentities=h.read_json(session_dir / "identities.json"))
    h.say("isolated-sessions", status="READY")


def ensure_model_routes(h, r, declaration):
    """DD-136(5): keyless Gateway sources for the declared upstreams in the isolated Gateway (the isolated
    platform operator's path) and one governed llm_route.create each; records the route Resource ids."""
    models = declaration["conformanceModels"]
    source = models["gatewaySource"]
    routes = {}
    ensure_tenant_admin(h, r)
    for role in ("chat", "embedding"):
        out = r.dir / f"route-{role}.json"
        if not out.is_file():
            name = f"conformance-{role}"
            gateway_admin(h, r, "PUT", "/api/config/resources/llm.provider", {"resources": [{"value": {
                "name": name, "params": {"baseUrl": models[role]["apiBase"]},
                "provider": {"custom": {"formats": [{"type": source["formats"][role]}]}}}}]})
            gateway_admin(h, r, "PUT", "/api/config/resources/llm.model", {"resources": [{"value": {
                "name": name, "provider": {"reference": name}, "params": {"model": models[role]["model"]},
                "authorization": source["authorization"]}}]})
            flow(h, r, "llm-route-create.mjs", "--provider-id", name, "--model-id", name, "--out", str(out))
        routes[role] = h.read_json(out)["routeResourceId"]
    r.record(modelRoutes=routes)
    h.say("isolated-model-routes", routes=len(routes))
    return routes


def declare_native(h, r):
    """Freeze independent native addresses before creating the isolated platform."""
    if "knowledgeNative" not in r.state:
        suffix = r.dir.name.rsplit("-", 1)[-1]
        port = h.free_port(59400, 59500)
        r.record(knowledgeNative={"project": f"kailo-knowledge-receiver-{suffix}",
                                  "origin": f"http://127.0.0.1:{port}", "port": port,
                                  "subnets": h.free_subnets(2, prefix="10.204.", start=16, stop=250),
                                  "directoryClient": f"knowledge-directory-{suffix}"})


def runtime_environment(h, r):
    """Resolve the staged deployment's literal non-secret declarations only."""
    values = {}
    for line in _env_lines(r.dir / "receiver/apps/deploy/local/.env"):
        match = re.fullmatch(r"([A-Z][A-Z0-9_]*)=(.*)", line)
        if match:
            values[match[1]] = match[2].strip().strip("'\"")

    def resolve(key, seen=()):
        h.require(key in values and key not in seen, "isolated deployment variable is missing or cyclic")
        return re.sub(r"\$\{([A-Z][A-Z0-9_]*)\}", lambda m: resolve(m[1], (*seen, key)), values[key])

    return {key: resolve(key) for key in values}


def ensure_gateway_identity(h, r):
    """Original Gateway jwtSign/Tool Session delivery, with a run-owned Bao key.

    The one-shot Agent needs CHOWN and DAC_OVERRIDE solely to render the 0600
    private file as the Gateway's observed uid/gid in its existing private
    volume. It sees only this role's bootstrap, the public output directory,
    and that volume; no private key is mounted into Core or copied by Python.
    """
    state = r.state
    local = r.dir / "receiver/apps/deploy/local"
    if state.get("gatewayIdentity"):
        h.require(Path(state["gatewayIdentity"]["jwksFile"]).is_file(), "confirmed Gateway public delivery is missing")
        return
    runtime = runtime_environment(h, r)
    project = state["project"]
    container = project + "-agentgateway-1"
    h.require(h.docker("inspect", "--format", '{{index .Config.Labels "com.docker.compose.project"}}', container).strip() == project,
              "Gateway container is not owned by this receiver")
    owners = {tuple(line.split()) for line in h.docker("top", container, "-eo", "uid,gid").splitlines()[1:] if line.strip()}
    h.require(len(owners) == 1, "Gateway runtime ownership is ambiguous")
    owner = next(iter(owners))
    h.require(len(owner) == 2 and all(value.isdecimal() for value in owner) and int(owner[0]) > 0, "non-root Gateway runtime ownership required")
    mounts = json.loads(h.docker("inspect", "--format", "{{json .Mounts}}", container))
    private_root = runtime["AGENTGATEWAY_PROVIDER_SECRET_DIRECTORY"]
    found = [mount for mount in mounts if mount["Destination"] == private_root]
    h.require(len(found) == 1 and found[0]["Type"] == "volume" and found[0]["RW"]
              and found[0]["Name"] == project + "_agentgateway-provider-secrets", "run-owned Gateway private volume required")
    directory = h.private_dir(r.dir / "receiver/gateway")
    bootstrap = h.private_dir(directory / "bootstrap")
    public = h.private_dir(directory / "public", 0o755)
    input_file = h.write_json(directory / "input.json", {"deployment": str(local), "project": project,
        "baoUrl": runtime["OPENBAO_ADDR"], "privateRoot": private_root, "gatewayUid": int(owner[0]), "gatewayGid": int(owner[1]),
        "operatorUid": os.getuid(), "operatorGid": os.getgid()})
    r.node(project + "_app", "tools/component-release/conformance/receiver-gateway.mjs", "--input", str(input_file))
    identity = h.read_json(directory / "identity.json")
    bao_image = h.docker("inspect", "--format", "{{.Config.Image}}", project + "-openbao-1").strip()
    h.require(re.fullmatch(r"[^\s@]+@sha256:[0-9a-f]{64}", bao_image), "Gateway Agent must use the fixed receiver OpenBao image")
    h.docker("run", "--rm", "--read-only", "--cap-drop", "ALL", "--cap-add", "CHOWN", "--cap-add", "DAC_OVERRIDE",
        "--security-opt", "no-new-privileges", "--cpus", "0.5", "--memory", "128m", "--memory-swap", "128m", "--pids-limit", "64",
        "--user", "0:0", "--network", project + "_app", "--tmpfs", "/tmp:rw,nosuid,nodev,size=16m",
        "--mount", f"type=bind,src={bootstrap},dst={bootstrap}", "--mount", f"type=bind,src={public},dst={public}",
        "--mount", f"type=volume,src={found[0]['Name']},dst={private_root}", "--entrypoint", "bao", bao_image,
        "agent", "-config=" + identity["agentConfig"], log=r.log, timeout=180)
    keys = h.read_json(identity["jwksFile"])
    h.require(len(keys.get("keys", [])) == 1 and "d" not in keys["keys"][0] and keys["keys"][0].get("kid") == identity["keyId"],
              "Gateway Agent did not render its public-only key")
    values = {"GATEWAY_SERVICE_ISSUER": identity["issuer"], "GATEWAY_SERVICE_AUDIENCE": identity["audience"],
        "GATEWAY_SERVICE_CALLER_ID": identity["callerId"], "GATEWAY_SERVICE_JWKS_FILE": identity["jwksFile"],
        "GATEWAY_SERVICE_SIGNING_KEY_FILE": identity["signingKeyFile"], "GATEWAY_SERVICE_KEY_ID": identity["keyId"],
        "GATEWAY_SERVICE_TOKEN_SECONDS": "30", "GATEWAY_SERVICE_MAX_TOKEN_SECONDS": "40",
        "AGENT_TOOL_MCP_URL": f"http://{runtime['BFF_SERVICE_NAME']}:{runtime['SERVICE_CONTAINER_PORT']}/service/v1/agent-tools/mcp",
        "AGENT_TOOL_EXT_MCP_URL": f"http://{runtime['BFF_SERVICE_NAME']}:{runtime['SERVICE_CONTAINER_PORT']}/",
        "AGENT_TOOL_SESSION_ISSUER": f"https://{project}.invalid/tool-session", "AGENT_TOOL_SESSION_AUDIENCE": project + "-tool-session",
        "AGENT_TOOL_SESSION_TOKEN_SECONDS": "300", "AGENT_TOOL_GATEWAY_NAME": "receiver-tools"}
    gateway_config = (local / "model-gateway-config.yaml").read_text()
    reserved = {int(value) for value in re.findall(r"(?m)^- port: ([0-9]+)$", gateway_config)}
    reserved.update(int(value) for value in re.findall(r"(?m)^  adminAddr: [^\s]+:([0-9]+)$", gateway_config))
    reserved.add(int(runtime["AGENTGATEWAY_MODEL_PORT"]))
    port = next(value for value in range(19000, 19100) if value not in reserved)
    values["AGENT_TOOL_GATEWAY_URL"] = f"http://agentgateway:{port}/"
    _set_env(h, local / ".env", values)
    env = {**os.environ, "KAILO_RUNTIME_DIR": str(local), "COMPOSE_PROJECT_NAME": project, "CHECK_CPUS": "2", "CHECK_MEMORY": "4g"}
    h.run(["bash", "./start-core.sh", "--no-build"], cwd=str(local), env=env, log=r.log)
    h.run(h.DOCKER + ["compose", "--project-name", project, "--project-directory", str(local), "--env-file", str(local / ".env"),
        "-f", str(local / "compose.yaml"), "-f", str(local / "secrets/agentgateway-service.compose.json"),
        "up", "-d", "--no-build", "--pull", "never", "--no-deps", "--wait", "--wait-timeout", "120", "agentgateway"],
        env=env, log=r.log, timeout=180)
    ensure_receiver_links(h, r)
    r.record(gatewayIdentity=identity)
    h.say("isolated-gateway-identity", status="DELIVERED")


def ensure_knowledge_native(h, r, declaration):
    """Original native deployment, directory, model delivery, then OIDC KB/MCP creation.

    The native-page binding is local to this receiver's Catalog and Tenant. Its
    normal workflow supplies the model key and directory authorization; no
    fixture role, model key, native ID or receipt is invented by this runner.
    """
    state = r.state
    source, facts = state["source"], state["knowledgeNative"]
    local = r.dir / "receiver/apps/deploy/local"
    directory = h.private_dir(r.dir / "receiver/knowledge")
    secrets_dir = h.private_dir(directory / "secrets")
    model_dir = h.private_dir(directory / "models")
    runtime = runtime_environment(h, r)
    runtime_env = {**os.environ, "KAILO_RUNTIME_DIR": str(local), "COMPOSE_PROJECT_NAME": state["project"]}
    recipe = hashlib.sha256((Path(source) / "tools/check.Dockerfile").read_bytes()).hexdigest()
    check_image = h.docker("image", "inspect", "--format", "{{.Id}}", f"local/kailo-check:{recipe}").strip()
    bao_image = h.docker("inspect", "--format", "{{.Config.Image}}", f"{state['project']}-openbao-1").strip()
    h.require("@sha256:" in bao_image, "isolated OpenBao image must be digest-pinned")

    def agent(hcl, mount):
        h.docker("run", "--rm", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
                 "--cpus", "0.5", "--memory", "128m", "--memory-swap", "128m", "--pids-limit", "64",
                 "--user", f"{os.getuid()}:{os.getgid()}", "--network", f"{state['project']}_app",
                 "--mount", f"type=bind,src={mount},dst={mount}", "--entrypoint", "bao", bao_image,
                 "agent", "-config=" + str(hcl), log=r.log, timeout=180)

    provision = {
        "KNOWLEDGE_PROVISION_TIMEOUT_SECONDS": "30", "KNOWLEDGE_DELIVERY_DIRECTORY": str(secrets_dir),
        "KNOWLEDGE_IDP_ADMIN_URL": f"http://{OIDC_HOST}:{runtime['KEYCLOAK_PORT']}",
        "KNOWLEDGE_IDP_REALM": runtime["OIDC_REALM"], "KNOWLEDGE_IDP_ADMIN_USER": runtime["KEYCLOAK_ADMIN_USER"],
        "KNOWLEDGE_IDP_ADMIN_PASSWORD_FILE": str(local / "secrets/keycloak_admin_password"),
        "KNOWLEDGE_NATIVE_ORIGIN": facts["origin"], "KNOWLEDGE_OIDC_CLIENT_ID": facts["project"],
        "KNOWLEDGE_OIDC_ISSUER_URL": runtime["OIDC_ISSUER"], "KNOWLEDGE_BAO_NAMESPACE": "knowledge-native",
        "KNOWLEDGE_BAO_KV_MOUNT": "kv", "KNOWLEDGE_BAO_SECRET_PATH": "native", "KNOWLEDGE_BAO_ROLE": "native-reader",
        "KNOWLEDGE_BAO_TOKEN_TTL": "1h", "KNOWLEDGE_BAO_WRAP_TTL": "5m", "KNOWLEDGE_BAO_URL": runtime["OPENBAO_ADDR"],
        "KNOWLEDGE_BAO_BOOTSTRAP_FILE": str(local / "secrets/openbao_init.json"),
    }
    provision_file = h.env_file(directory / "provision.env", provision)
    if not (secrets_dir / "redis_config").is_file():
        # Provisioning executes on the isolated platform network; the original
        # helper reads its operator credentials from this run's private mount.
        h.docker("run", "--rm", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
                 "--cpus", "1", "--memory", "256m", "--memory-swap", "256m", "--pids-limit", "64",
                 "--user", f"{os.getuid()}:{os.getgid()}", "--network", f"{state['project']}_app",
                 "--mount", f"type=bind,src={source},dst=/src,readonly",
                 "--mount", f"type=bind,src={r.dir},dst={r.dir}", "--env-file", str(provision_file),
                 "--entrypoint", "python3", check_image, "/src/knowledge/fork/deploy/provision.py", "native",
                 log=r.log, timeout=180)
        agent(secrets_dir / "agent.hcl", secrets_dir)

    page_release = h.private_dir(directory / "page-release", 0o755)
    if not (page_release / "manifest.json").is_file():
        r.node("none", "tools/component-release/render.mjs", "--component", "knowledge", "--material", "native-page",
               "--source-commit", state["commit"], "--native-page-origin", facts["origin"], "--out", str(page_release))
    flow(h, r, "component-register.mjs", "--release-dir", str(page_release))
    flow(h, r, "component-approve.mjs", "--release-dir", str(page_release), "--approver", "kailo-platform-approver")
    plan_file = directory / "page-binding.json"
    flow(h, r, "component-bind.mjs", "--component", "knowledge", "--release-dir", str(page_release),
         "--native-page-url", facts["origin"] + "/", "--native-instance-ref", facts["project"],
         "--directory-client-id", facts["directoryClient"], "--model-route-ids", ",".join(state["modelRoutes"].values()),
         "--meter-keys", "component_model_tokens", "--plan-out", str(plan_file))
    binding = h.read_json(plan_file)
    for operation, args in (("export", [str(model_dir), binding["bindingId"]]), ("prepare", [str(model_dir)])):
        h.run(["bash", "./bootstrap.sh", "--native-model-delivery", operation, *args], cwd=str(local), env=runtime_env, log=r.log)
    agent(model_dir / "model-agent.hcl", model_dir)

    # Measure the embedding through this binding's own governed Gateway key.
    # The declaration's dimension is an assertion, never a substituted result.
    # The model listener is intentionally private and has no host port. Read
    # only this run's delivered key inside a bounded container on its edge net
    # where Compose declares AGENTGATEWAY_MODEL_HOST as an alias.
    probe = '''import json, sys, urllib.request
try:
    with open(sys.argv[1]) as stream:
        key = json.load(stream)["value"]
    request = urllib.request.Request(sys.argv[2].rstrip("/") + "/embeddings", method="POST",
        data=json.dumps({"model": sys.argv[3], "input": "Kailo receiver conformance"}).encode(),
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=60) as response:
        vector = json.load(response)["data"][0]["embedding"]
    assert isinstance(vector, list) and len(vector) == int(sys.argv[4])
    assert all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in vector)
    print(len(vector))
except Exception:
    sys.exit("isolated native embedding probe failed; no credential details logged")
'''
    dimension = int(h.docker("run", "--rm", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
        "--cpus", "0.5", "--memory", "128m", "--memory-swap", "128m", "--pids-limit", "64",
        "--user", f"{os.getuid()}:{os.getgid()}", "--network", runtime["PLATFORM_EDGE_NETWORK"],
        "--mount", f"type=bind,src={model_dir / 'credential.json'},dst=/credential.json,readonly",
        "--entrypoint", "python3", check_image, "-I", "-c", probe, "/credential.json", runtime["AGENTGATEWAY_MODEL_BASE_URL"],
        declaration["conformanceModels"]["embedding"]["model"], str(declaration["conformanceModels"]["embedding"]["dimension"]),
        timeout=90).strip())

    native_env = {"COMPOSE_PROJECT_NAME": facts["project"], "KNOWLEDGE_UI_BIND_ADDRESS": "127.0.0.1",
        "KNOWLEDGE_UI_PORT": str(facts["port"]), "KNOWLEDGE_UI_SUBNET": facts["subnets"][0], "KNOWLEDGE_DATA_SUBNET": facts["subnets"][1],
        "KNOWLEDGE_DB_USER": "weknora", "KNOWLEDGE_DB_NAME": "weknora", "KNOWLEDGE_NATIVE_ORIGIN": facts["origin"],
        "KNOWLEDGE_OIDC_ISSUER_URL": runtime["OIDC_ISSUER"], "KNOWLEDGE_OIDC_DISCOVERY_URL": runtime["OIDC_ISSUER"] + "/.well-known/openid-configuration",
        "KNOWLEDGE_OIDC_CLIENT_ID": facts["project"], "KNOWLEDGE_SSRF_WHITELIST_EXTRA": OIDC_HOST,
        "PLATFORM_DISPLAY_NAME": runtime["PLATFORM_DISPLAY_NAME"], "KAILO_TENANT_ID": state["sessionIdentities"]["human"]["tenantId"],
        "KAILO_TENANT_NAME": runtime["VERIFY_TENANT_NAME"], "KAILO_SESSION_MAX_LIFETIME": "1h",
        "KNOWLEDGE_DIRECTORY_BINDING_ID": binding["bindingId"], "KNOWLEDGE_DIRECTORY_CLIENT_ID": facts["directoryClient"],
        "KNOWLEDGE_DIRECTORY_CLIENT_SECRET_FILE": str(local / "secrets/component-directory/knowledge/client_secret"),
        "KNOWLEDGE_DIRECTORY_TOKEN_URL": runtime["OIDC_ISSUER"] + "/protocol/openid-connect/token",
        "KNOWLEDGE_DIRECTORY_CORE_URL": f"http://{runtime['BFF_SERVICE_NAME']}:{runtime['SERVICE_CONTAINER_PORT']}",
        "KNOWLEDGE_DIRECTORY_INTERVAL_SECONDS": "60", "KNOWLEDGE_ADAPTER_PLATFORM_NETWORK": f"{state['project']}_app",
        "KNOWLEDGE_NATIVE_MODEL_DELIVERY_DIR": str(model_dir), "KNOWLEDGE_MODEL_SECRET_ENV_FILE": str(model_dir / "model.env"),
        "KNOWLEDGE_BUILTIN_MODELS_FILE": str(model_dir / "builtin-models.yaml"),
        "KNOWLEDGE_MODEL_CHAT_ID": declaration["conformanceModels"]["chat"]["model"],
        "KNOWLEDGE_MODEL_EMBEDDING_ID": declaration["conformanceModels"]["embedding"]["model"],
        "KNOWLEDGE_MODEL_EMBEDDING_DIM": str(dimension), "KNOWLEDGE_MODEL_API_KEY_NAME": "KAILO_MODEL_RECEIVER"}
    for key in ("DB_PASSWORD", "REDIS_PASSWORD", "REDIS_CONFIG", "SYSTEM_AES_KEY", "SYSTEM_SIGNING_KEY", "JWT_SECRET", "OIDC_CLIENT_SECRET"):
        native_env["KNOWLEDGE_" + key + "_FILE"] = str(secrets_dir / key.lower())
    for role, artifact in (("APP", "knowledge-service"), ("UI", "knowledge-native-ui"), ("DOCREADER", "knowledge-document-reader")):
        digest = h.recorded_artifact(source, "knowledge", artifact).removeprefix("sha256:")
        native_env[f"KNOWLEDGE_{role}_REPOSITORY"] = f"{declaration['registry']}/{artifact}"
        native_env[f"KNOWLEDGE_{role}_DIGEST"] = digest
    env_file = h.env_file(directory / "native.env", native_env)
    h.run(["python3", "-I", f"{source}/deploy/components/native-config.py", "apply", "knowledge", "--env", str(env_file),
           "--source", state["commit"], "--backup-dir", str(h.private_dir(directory / "backups"))], env=runtime_env, log=r.log)
    h.run(["bash", "./bootstrap.sh", "--native-model-delivery", "materialize-weknora", str(env_file)], cwd=str(local), env=runtime_env, log=r.log)
    receiver_env(h, r, {"RECEIVER_KNOWLEDGE_ENV": str(env_file)})
    # First start all independent dependencies. The platform overlay entry only
    # updates app (--no-deps); applying it to an empty project cannot work.
    native_process_env = {**runtime_env, "COMPOSE_PROJECT_NAME": facts["project"]}
    deployment = Path(source) / "knowledge/fork/deploy"
    images = h.docker("compose", "--project-directory", str(deployment), "--env-file", str(env_file),
                      "-f", str(deployment / "compose.yaml"), "config", "--images").splitlines()
    h.require(images and all(re.fullmatch(r"[^\s@]+@sha256:[0-9a-f]{64}", value) for value in images),
              "every isolated native dependency must have a fixed image digest")
    for image in sorted(set(images)):
        h.docker("pull", image, log=r.log)
    h.run(["bash", f"{source}/knowledge/fork/deploy/start.sh", "--native-env", str(env_file)], env=native_process_env, log=r.log)
    h.run(["bash", f"{source}/knowledge/fork/deploy/start.sh", "--native-env", str(env_file), "--platform-model", str(local / ".env")],
          env=native_process_env, log=r.log)
    native_input = h.write_json(directory / "native-input.json", {"directory": str(directory), "origin": facts["origin"], "name": state["project"]})
    flow(h, r, "receiver-knowledge-native.mjs", "--input", str(native_input))
    r.record(knowledgeObjects=h.read_json(directory / "native.json"))
    h.say("isolated-knowledge-native", status="READY")


def ensure_source_native(h, r):
    """Reuse the Cells native deployment helpers, without its simulated provider.

    Folder UUIDs below are proposals to the original Create API. Only the
    subsequent native read-back is retained as an observed object; the Core
    Resource identities still come exclusively from the later bootstrap.
    """
    source = r.state["source"]
    declaration = h.read_json(Path(source) / "deploy/components/adapters.json")["file-storage"]
    directory = h.private_dir(r.dir / "receiver/source-cells")
    cells = h.Run(directory)
    if not cells.state:
        suffix = r.dir.name.rsplit("-", 1)[-1]
        port = h.free_port(59510, 59599)
        def artifact(name):
            return declaration["registry"] + "/" + name + "@" + h.recorded_artifact(source, "file-storage", name)
        cells.record(component="file-storage", source=source, commit=r.state["commit"], nodeImage=r.state["nodeImage"],
            project=f"kailo-cells-conformance-source-{suffix}", network=f"{r.state['project']}_app",
            subnets=h.free_subnets(2, prefix="10.205.", start=16, stop=250), port=port, external=f"http://127.0.0.1:{port}",
            cellsImage=artifact("file-storage-service"), adapterImage=artifact("file-storage-adapter"),
            connectors=[{"id": "pydio", "name": "Pydio Cells", "type": "pydio"},
                {"id": "kailo-conformance-unused", "name": "Kailo", "type": "kailo-oidc", "config": {
                    "issuer": "http://conformance-idp.invalid/realms/kailo-conformance", "clientId": "kailo-conformance-unused",
                    "clientSecretFile": "/run/secrets/cells_oidc_client_secret", "redirectUri": f"http://127.0.0.1:{port}/auth/kailo/callback",
                    "users": [], "requestTimeout": "30s", "transactionMaxAgeSeconds": 600, "clientSecretMaxBytes": 4096,
                    "provisionUsers": False, "backchannelLogout": {"sessionMaxAgeSeconds": 36000, "logoutTokenMaxAgeSeconds": 300}}}])
    h.require(cells.state["source"] == source and cells.state["commit"] == r.state["commit"], "source native provenance changed")
    for sub in ("cells-data", "cells-database", "binding", "backups", "tmp", "native-action", "adapter-delivery", "agent-bootstrap"):
        h.private_dir(directory / sub)
    h.cells_secrets(cells)
    h.render_release(cells, "file-storage", declaration["nativePageOrigin"])
    admin, service, actor = "kailo-conformance-admin", "kailo-conformance-service", "kailo-conformance-actor"
    env_file = directory / "native.env"
    if not env_file.is_file():
        h.cells_native_env(cells, f"{admin}:rw", "")
    # Record ownership before starting: teardown can close a partially started
    # source project using the same original entry and this exact native env.
    receiver_env(h, r, {"RECEIVER_CELLS_ENV": str(env_file)})
    start = ["bash", f"{source}/file-storage/deploy/start.sh", str(env_file)]
    result = h.run(start, log=r.log, check=False)
    if result.returncode == 75:  # Original entry documents the first-install restart.
        result = h.run(start, log=r.log, check=False)
    h.require(result.returncode == 0, "source Cells native deployment refused; inspect its original run log")
    native = h.CellsNative(cells)
    admin_token = native.token(admin)
    service_id = native.ensure_user(admin_token, service)
    actor_id = native.ensure_user(admin_token, actor)
    for login, name in ((admin, "admin.pat"), (service, "service.pat"), (actor, "actor.pat")):
        if not (directory / "secrets" / name).is_file():
            h.write_private(directory / "secrets" / name, native.token(login) + "\n")
    h.cells_native_env(cells, f"{admin}:rw {service}:r {actor}:rw", service)
    h.run(["bash", f"{source}/file-storage/deploy/start.sh", "--reconcile", str(env_file)], log=r.log)
    binding = h.read_json(directory / "binding/facts.json")
    h.require(binding["instanceServiceUuid"] == service_id, "source service identity differs from native binding facts")
    requirements_file = directory / "receiver-requirements.json"
    if not requirements_file.is_file():
        r.node("none", "tools/component-release/conformance/vector-requirements.mjs", "--component", "knowledge", "--out", str(requirements_file))
    requirements = h.read_json(requirements_file)
    h.require(requirements["component"] == "knowledge" and requirements["satisfiable"] is True, "receiver vector requirements refused")
    preconditions = [entry for entry in requirements["requirements"]
                     if entry["kind"] == "weknora-precondition" and entry["role"] == "source-resource"]
    h.require(preconditions, "knowledge vectors declare no source Resources")
    folders = cells.state.get("sourceFolders", {})
    for entry in preconditions:
        key = entry["caseKey"] + "/" + entry["key"]
        if key not in folders:
            folders[key] = {"proposed": str(uuid.uuid4()), "path": "receiver-" + hashlib.sha256(key.encode()).hexdigest()[:24]}
            cells.record(sourceFolders=folders)
        item = folders[key]
        path = "n/node/" + item.get("nativeRef", item["proposed"]) + "?Flags=WithMetaDefaults"
        node = native.call(admin_token, "GET", path, api="v2", missing="nativeRef" not in item)
        if node is None:
            created = native.call(admin_token, "POST", "n/nodes/create", {"Inputs": [{
                "Locator": {"Path": binding["workspaceSlug"] + "/" + item["path"]}, "Type": "COLLECTION", "ResourceUuid": item["proposed"]}],
                "Recursive": True}, api="v2")
            nodes = created.get("Nodes", [])
            h.require(len(nodes) == 1 and nodes[0].get("Uuid") == item["proposed"], "source folder creation was not acknowledged")
            node = native.call(admin_token, "GET", path, api="v2")
        h.require(node.get("Uuid") == item["proposed"] and node.get("Type") == "COLLECTION"
                  and node.get("ContextWorkspace", {}).get("Uuid") == binding["nativeScopeRef"], "source folder read-back differs from this run")
        item["nativeRef"] = node["Uuid"]
        item["observationFile"] = str(h.write_json(directory / ("folder-" + item["nativeRef"] + ".json"), node))
        cells.record(sourceFolders=folders)
    cells.record(serviceUuid=service_id, actorUuid=actor_id)
    r.record(sourceNative={"directory": str(directory), "project": cells.state["project"], "nativeScopeRef": binding["nativeScopeRef"],
                          "nativeRootRef": binding["nativeRootRef"], "serviceUuid": service_id, "actorUuid": actor_id, "folders": folders})
    h.say("isolated-source-native", status="READY", folders=len(folders))


def drive(r, args, runtime_env, declaration, h):
    declare_native(h, r)
    s = r.state
    if "project" not in s:
        run_id = r.dir.name.rsplit("-", 1)[-1]
        r.record(project=f"kailo-receiver-{run_id}", network=f"kailo-conformance-kn-{run_id}",
                 coreProvenance=core_provenance(h))
        h.private_dir(r.dir / "receiver")
    manifest = h.render_release(r, "knowledge", declaration["nativePageOrigin"])
    s = r.state
    receiver_dir = r.dir / "receiver"
    if not (receiver_dir / "platform.done").is_file():
        # core-build.json records provenance before init-local starts anything;
        # it is not proof of a completed, healthy isolated deployment.
        h.require(not any(receiver_dir.iterdir()),
                  "isolated platform setup is incomplete; inspect its run log and close this owned run before starting a new one")
        facts = platform_env(h, r, s["project"])
        r.record(platformPorts=facts["changedPorts"])
        receiver_env(h, r)
        receiver(h, r, "platform")
    receiver_env(h, r)
    if not (receiver_dir / "contracts.done").is_file():
        ensure_approver(h, r)
        receiver(h, r, "contracts")
    ensure_action_token(h, r)
    ensure_receiver_links(h, r)
    ensure_gateway_identity(h, r)
    ensure_sessions(h, r)
    ensure_model_routes(h, r, declaration)
    ensure_knowledge_native(h, r, declaration)
    ensure_source_native(h, r)
    r.record(blockedAfterNative=(
        "adapter/bootstrap/seed/inputs/driver not automated yet: (1) source Cells cells@2.0.0 "
        "native-action and adapter delivery bound to the isolated Core: "
        "isolated IdP adapter client, Agent/AppRole in the isolated platform OpenBao, binding SecretRefs written "
        "there at the bootstrap's fixed locators, an adapters[] entry with nativeResources evidence in "
        "RECEIVER_ADAPTER_DIRECTORY_FILE; (2) WeKnora candidate adapter delivery "
        "with --platform-adapter --file-storage-sync and the forward adapter "
        "configuration for the production Worker (Core's isolated conformance identity); (3) bootstrap input "
        "(receiver-environment-bootstrap.rs prepare: endpoints, resources/preconditions, three isolated session "
        "token files), seed-knowledge input, observe receiver block and driver input; "
        "(4) production registration also needs cells@2.0.0 APPROVED in the production Catalog"))
    raise h.Refused("knowledge: isolated native objects ready; adapter and later receiver "
                    f"stages are not automated yet (auto-state.json blockedAfterNative; {manifest['componentTypeKey']}@{manifest['version']})")


def teardown(r, h):
    if (r.dir / "receiver.env").is_file():
        h.run(["bash", f"{r.state['source']}/tools/component-release/receiver-run.sh", str(r.dir / "receiver.env"), "down"],
              log=r.log, check=False)
