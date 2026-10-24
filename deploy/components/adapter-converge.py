#!/usr/bin/env python3
"""Declarative convergence of one component adapter (DD-136(6), ADR-20 §10; run by component-deploy.sh --adapter).

The adapter's deployment facts are versioned in deploy/components/adapters.json ("adapter" of each
component). From them and the fixed release tree this derives, idempotently and without an operator:

  plan     render the candidate release (render.mjs) and the binding plan that the Tenant admin's
           governed application_binding.create will use (component-bind.mjs --plan-only --tenant-id:
           the same deterministic bindingId/servicePrincipalId/SecretRefs, no login, nothing sent)
  deliver  the adapter configuration (adapter-delivery.py config), the binding's read-only OpenBao
           policy and AppRole in its Tenant namespace with a fresh one-use response-wrapped
           secret-id and the Agent HCL (adapter-delivery.py reader), and the adapter's entry in the
           delivery directory (adapter-directory.mjs --existing, atomic replace: Core reads the
           directory per use through its folder mount, DD-136(2), no Core rebuild)
  client   once the binding exists and the Agent rendered oidc_client_secret: the binding's own
           adapter IdP client (adapter-delivery.py client); before that it reports PENDING
  secrets  the binding's native service credentials for application_binding.create, minted
           through the component's own native API/CLI into one 0600 file (never printed); the
           Tenant admin's governed create sends them once to Core, which writes the SecretRefs

It never creates a binding, writes a binding secret into OpenBao, approves anything or prints a
credential. Existing AppRoles, policies and clients that differ are refused, not overwritten.

  adapter-converge.py <plan|deliver|client|secrets> <component> --source <tree> --commit <sha>
        --runtime <KAILO_RUNTIME_DIR> [--state-dir <dir>]

Native facts are read, never typed in: Cells from the binding facts reconcile.py wrote; Wren
(data-query) by a read-only query of its own metadata database inside the running wren-ui
container (the single native project: id = nativeScopeRef, projectConnectionDigest over
{type, connectionInfo, catalog, schema} exactly as nativeBindingService.ts computes it, and the
non-secret connection fields). --state-dir only redirects the rendered release/plan for a
read-only verification of `plan`; deliver/client/secrets refuse it.
"""
import argparse
import json
import os
from pathlib import Path
import re
import secrets as random
import string
import subprocess
import sys
import tempfile

DOCKER = ["sudo", "-n", "docker"]


class Refused(Exception):
    pass


def require(condition, reason):
    if not condition:
        raise Refused(reason)


def say(step, **fields):
    print(json.dumps({"step": step, **fields}, ensure_ascii=False), flush=True)


def read_json(path):
    with open(path, encoding="utf-8") as stream:
        return json.load(stream)


def env_value(path, name):
    with open(path, encoding="utf-8") as stream:
        for line in stream:
            match = re.match(r"^" + re.escape(name) + r"=(.*)$", line.rstrip("\n"))
            if match:
                value = match.group(1)
                if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
                    value = value[1:-1]
                return value
    return ""


def write_private(path, text, mode=0o600):
    path = Path(path)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix="." + path.name + ".")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(text)
            stream.flush()
            os.fchmod(stream.fileno(), mode)
            os.fsync(stream.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def run(argv, capture=False, stdin=None):
    result = subprocess.run(argv, input=stdin, capture_output=True, check=False)
    if result.returncode != 0:
        # Tool messages carry field names only (the tools never echo values); keep the last line.
        tail = result.stderr.decode("utf-8", "replace").strip().splitlines()[-1:] or [""]
        raise Refused(f"{Path(argv[0]).name if argv[0] not in DOCKER else 'docker'} refused: {tail[0][:300]}")
    return result.stdout.decode("utf-8", "replace") if capture else None


class Context:
    def __init__(self, args):
        self.component = args.component
        self.source = Path(args.source).resolve()
        self.commit = args.commit
        self.runtime = Path(args.runtime).resolve()
        declaration = read_json(self.source / "deploy/components/adapters.json")[self.component]
        self.declaration = declaration
        self.adapter = declaration["adapter"]
        self.env = self.adapter["componentEnv"]
        require(Path(self.env).is_file(), f"component env {self.env} missing")
        self.state_override = bool(getattr(args, "state_dir", None))
        self.state = Path(args.state_dir if self.state_override else self.adapter["stateDir"])
        if not self.state.exists() and self.state.parent.is_dir():
            self.state.mkdir(mode=0o700)
        require(self.state.is_dir() and not self.state.is_symlink(), f"adapter state directory {self.state} missing")
        os.chmod(self.state, 0o700)
        self._wren = None
        self.node_image = "node@" + re.search(r"^FROM node:[^\s@]+@(sha256:[0-9a-f]{64})",
                                              (self.source / "file-storage/adapter/Dockerfile").read_text(), re.M).group(1)

    def platform(self, name):
        return env_value(self.runtime / ".env", name).replace("${KAILO_RUNTIME_DIR}", str(self.runtime))

    def component_value(self, name):
        return env_value(self.env, name)

    def node(self, script, *args, mounts=()):
        argv = DOCKER + ["run", "--rm", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
                         "--cpus", "1", "--memory", "512m", "--memory-swap", "512m", "--network", "none",
                         "--tmpfs", "/tmp:rw,nosuid,nodev,size=32m", "-u", f"{os.getuid()}:{os.getgid()}", "-e", "HOME=/tmp",
                         "-v", f"{self.source}:/src:ro", "-v", f"{self.state}:{self.state}", "-w", "/src"]
        for mount in mounts:
            argv += ["-v", f"{mount}:{mount}:ro"]
        return run(argv + [self.node_image, "node", script, *args], capture=True)

    @property
    def release_dir(self):
        return self.state / f"release-{self.commit[:12]}"

    @property
    def plan_file(self):
        return self.state / f"plan-{self.commit[:12]}.json"


WREN_PROBE = r"""
const crypto = require('crypto');
const knex = require('knex')({ client: 'better-sqlite3', connection: { filename: process.env.SQLITE_FILE, readonly: true },
  useNullAsDefault: true });
const canonical = (v) => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v !== null && typeof v === 'object'
  ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v);
(async () => {
  const projects = await knex('project').select('id', 'type', 'catalog', 'schema', 'connection_info');
  const out = projects.map((p) => {
    const info = typeof p.connection_info === 'string' ? JSON.parse(p.connection_info) : p.connection_info;
    return { projectId: p.id, type: p.type, connectionKeys: Object.keys(info || {}).sort(),
      connection: { host: info?.host, port: info?.port, database: info?.database, user: info?.user },
      projectConnectionDigest: crypto.createHash('sha256')
        .update(canonical({ type: p.type, connectionInfo: info, catalog: p.catalog, schema: p.schema })).digest('hex') };
  });
  process.stdout.write(JSON.stringify(out));
  await knex.destroy();
})().catch((e) => { process.stderr.write(`wren probe refused ${e?.code ?? e?.name}\n`); process.exit(1); });
"""


def wren_facts(ctx):
    """The single native Wren project, read-only (no connection value except host/port/database/user)."""
    if ctx._wren is None:
        project = ctx.component_value("WREN_COMPOSE_PROJECT_NAME")
        container = run(DOCKER + ["ps", "-q", "--filter", f"label=com.docker.compose.project={project}",
                                  "--filter", "label=com.docker.compose.service=wren-ui"], capture=True).split()
        require(len(container) == 1, "production wren-ui is not running")
        projects = json.loads(run(DOCKER + ["exec", "-i", "-w", "/app/data-query/wren-ui", container[0], "node", "-"],
                                  capture=True, stdin=WREN_PROBE.encode()))
        require(len(projects) == 1 and projects[0]["type"] == "POSTGRES",
                "the dedicated Wren instance must hold exactly one POSTGRES project")
        ctx._wren = projects[0]
    return ctx._wren


def native_fact(ctx, rule):
    if rule.startswith("bindingFacts:"):
        value = read_json(ctx.component_value(ctx.adapter["bindingFactsKey"])).get(rule.split(":", 1)[1])
    elif rule.startswith("wren:"):
        value = wren_facts(ctx).get(rule.split(":", 1)[1])
    elif rule.startswith("env:"):
        value = ctx.component_value(rule[4:])
    else:
        value = rule
    require(value is not None and str(value) != "", f"native fact {rule} unavailable")
    return str(value)


def config_path(ctx):
    delivery = Path(ctx.component_value(ctx.adapter["deliveryDirKey"]))
    key = ctx.adapter.get("configFileKey")
    return delivery, (Path(ctx.component_value(key)) if key else delivery / ctx.adapter["configFileName"])


def native_scope(ctx):
    rule = ctx.adapter["nativeScopeRef"]
    if rule.startswith("wren:"):
        return native_fact(ctx, rule)
    if rule.startswith("bindingFacts:"):
        facts = read_json(ctx.component_value(ctx.adapter["bindingFactsKey"]))
        value = facts.get(rule.split(":", 1)[1])
        require(isinstance(value, str) and value, "native scope is not in the component's binding facts")
        return value
    return rule


def cmd_plan(ctx):
    out = ctx.release_dir
    if not (out / "manifest.json").is_file():
        out.mkdir(mode=0o755)
        ctx.node("tools/component-release/render.mjs", "--component", ctx.component, "--source-commit", ctx.commit,
                 "--native-page-origin", ctx.declaration["nativePageOrigin"], "--out", str(out))
        for name in os.listdir(out):
            os.chmod(out / name, 0o644)
    manifest = read_json(out / "manifest.json")
    if not ctx.plan_file.is_file():
        env_copy = ctx.state / ".deploy-env"
        # component-bind.mjs reads OPENBAO_TENANT_PARENT_NAMESPACE / OPENBAO_KV_MOUNT from <dir>/.env.
        env_copy.mkdir(mode=0o700, exist_ok=True)
        write_private(env_copy / ".env", "".join(f"{k}={ctx.platform(k)}\n" for k in ("OPENBAO_TENANT_PARENT_NAMESPACE", "OPENBAO_KV_MOUNT")))
        argv = ["tools/component-release/flow/component-bind.mjs", "--component", ctx.component, "--release-dir", str(out),
                "--native-page-url", ctx.declaration["nativePageOrigin"], "--native-instance-ref", ctx.adapter["nativeInstanceRef"],
                "--native-scope-ref", native_scope(ctx), "--tenant-id", ctx.adapter["tenantId"],
                "--attempt", str(ctx.adapter["attempt"]), "--plan-only", "--plan-out", str(ctx.plan_file)]
        if ctx.adapter.get("workspaceId"):
            argv += ["--workspace-id", ctx.adapter["workspaceId"]]
        run(DOCKER + ["run", "--rm", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--network", "none",
                      "--tmpfs", "/tmp:rw,nosuid,nodev,size=32m", "-u", f"{os.getuid()}:{os.getgid()}", "-e", "HOME=/tmp",
                      "-e", f"KAILO_DEPLOY_DIR={env_copy}", "-e", f"KAILO_FLOW_OUT={ctx.state}",
                      "-v", f"{ctx.source}:/src:ro", "-v", f"{ctx.state}:{ctx.state}", "-w", "/src", ctx.node_image, "node", *argv])
    plan = read_json(ctx.plan_file)
    say("plan", release=f"{manifest['componentTypeKey']}@{manifest['version']}", artifactDigest=manifest["adapterBuildRef"],
        bindingId=plan["bindingId"], tenantId=plan["tenantId"], secretKeys=[r["secretKey"] for r in plan["secretRefs"]])
    return manifest, plan


def cmd_deliver(ctx):
    manifest, plan = cmd_plan(ctx)
    tool = str(ctx.source / "deploy/components/adapter-delivery.py")
    require(not ctx.state_override, "--state-dir only verifies plan")
    delivery, config = config_path(ctx)
    if not delivery.exists() and delivery.parent.is_dir():
        delivery.mkdir(mode=0o700)
    require(delivery.is_dir() and config.parent == delivery, "adapter delivery directory/config file mismatch in the component env")
    signing = ctx.platform("ACTION_TOKEN_SIGNING_FILE")
    if not config.is_file():
        argv = ["python3", "-I", tool, "config", "--kind", ctx.adapter["kind"], "--plan", str(ctx.plan_file),
                "--template", str(ctx.source / "deploy/components" / ctx.adapter["template"]), "--delivery-dir", str(delivery),
                "--env-file", str(ctx.runtime / ".env"), "--action-token-signing-file", signing, "--out", str(config)]
        # {{tools}} only where the template publishes MCP tools (Cells, WeKnora); Wren serves its own route.
        if ctx.adapter["registrations"]:
            argv += ["--release-dir", str(ctx.release_dir)]
        for registration in ctx.adapter["registrations"]:
            argv += ["--registration", str(ctx.source / registration)]
        if ctx.adapter["kind"] == "adapter":
            argv += ["--public-file", f"action-token-jwks.json={read_json(signing)['jwksFile']}",
                     "--public-file", f"gateway-service-jwks.json={ctx.platform('GATEWAY_SERVICE_JWKS_FILE')}"]
        for name, rule in ctx.adapter.get("sets", {}).items():
            argv += ["--set", f"{name}={native_fact(ctx, rule)}"]
        run(argv)
    else:
        current = read_json(config)
        require(current.get("bindingId") == plan["bindingId"], "existing adapter configuration belongs to another binding; refusing")
    say("config", bindingId=plan["bindingId"], configured=True)
    bootstrap = Path(ctx.component_value(ctx.adapter["bootstrapDirKey"]))
    if not bootstrap.exists() and bootstrap.parent.is_dir():
        bootstrap.mkdir(mode=0o700)
    role = f"{ctx.component}-adapter-{plan['bindingId'][:8]}"
    agent_running = subprocess.run(DOCKER + ["ps", "-q", "--filter", f"name={ctx.adapter['agentContainer']}"],
                                   capture_output=True).stdout.strip()
    if not agent_running or not (bootstrap / "adapter-agent.hcl").is_file():
        # A fresh one-use wrapped secret-id for every (re)start of the Agent.
        run(["python3", "-I", tool, "reader", "--config", str(config), "--role", role, "--bootstrap-dir", str(bootstrap),
             "--bao-url", f"http://127.0.0.1:{ctx.platform('OPENBAO_PORT')}", "--agent-bao-url", ctx.adapter["agentBaoUrl"],
             "--root-token-file", str(ctx.runtime / "secrets/openbao_init.json"), "--token-ttl", "768h"])
        say("reader", role=role, wrappedSecretId="delivered")
    # Delivery directory entry, keeping protocolPeers and other adapters (atomic replace).
    directory = Path(ctx.platform("APPLICATION_ADAPTER_DIRECTORY_FILE"))
    require(directory.is_file(), "APPLICATION_ADAPTER_DIRECTORY_FILE missing (release the platform first)")
    entry = {"adapters": [{"component": ctx.component, "release": str(ctx.release_dir),
                           "adapterServiceRef": plan["adapterServiceRef"], "baseUrl": ctx.adapter["baseUrl"],
                           "nativeInstanceRef": plan["nativeInstanceRef"], "timeoutSeconds": ctx.adapter["timeoutSeconds"],
                           "maxResponseBytes": ctx.adapter["maxResponseBytes"],
                           "secretReaders": [{"servicePrincipalId": plan["servicePrincipalId"], "roleName": role}],
                           **({"mcpUrl": ctx.adapter["mcpUrl"]} if ctx.adapter.get("mcpUrl") else {})}]}
    work = ctx.state / ".directory"
    work.mkdir(mode=0o700, exist_ok=True)
    write_private(work / "input.json", json.dumps(entry))
    existing = work / "existing.json"
    write_private(existing, directory.read_text(encoding="utf-8"))
    out = work / "directory.json"
    if out.exists():
        out.unlink()
    ctx.node("tools/component-release/adapter-directory.mjs", "--input", str(work / "input.json"),
             "--existing", str(existing), "--out", str(out), mounts=[str(ctx.release_dir)])
    rendered = out.read_text(encoding="utf-8")
    if rendered != directory.read_text(encoding="utf-8"):
        write_private(directory, rendered, 0o644)
    say("directory", adapterServiceRef=plan["adapterServiceRef"], updated=rendered != existing.read_text(encoding="utf-8"))


def cmd_client(ctx):
    require(not ctx.state_override, "--state-dir only verifies plan")
    _, plan = cmd_plan(ctx)
    _, config = config_path(ctx)
    secret = Path(read_json(config)["oidcClientSecretFile"])
    if not secret.is_file():
        say("client", bindingId=plan["bindingId"], state="PENDING", reason="the binding SecretRef is not rendered yet")
        return
    run(["python3", "-I", str(ctx.source / "deploy/components/adapter-delivery.py"), "client", "--config", str(config),
         "--issuer", ctx.platform("OIDC_ISSUER"), "--admin-user", ctx.platform("KEYCLOAK_ADMIN_USER"),
         "--admin-password-file", str(ctx.runtime / "secrets/keycloak_admin_password"),
         "--service-audience", ctx.platform("OIDC_SERVICE_CLIENT_ID"),
         "--refuse-client-ids", ",".join(filter(None, (ctx.platform("OIDC_SERVICE_CLIENT_ID"), ctx.platform("OIDC_WORKER_CLIENT_ID"))))])
    say("client", bindingId=plan["bindingId"], state="DECLARED")


def cmd_secrets(ctx):
    """bindingSecretValues for the governed create: native service credential + the adapter client secret."""
    require(not ctx.state_override, "--state-dir only verifies plan")
    _, plan = cmd_plan(ctx)
    out = ctx.state / f"binding-secrets-{plan['bindingId'][:8]}.json"
    if out.is_file():
        say("secrets", bindingId=plan["bindingId"], file=str(out), minted=False)
        return
    values = {}
    for key, rule in ctx.adapter["bindingSecrets"].items():
        if rule == "generated":
            values[key] = "".join(random.choice(string.ascii_letters + string.digits) for _ in range(48))
        elif rule.startswith("cells-token:"):
            login = ctx.component_value(rule.split(":", 1)[1])
            project = ctx.component_value("CELLS_COMPOSE_PROJECT")
            container = run(DOCKER + ["ps", "-q", "--filter", f"label=com.docker.compose.project={project}",
                                      "--filter", "label=com.docker.compose.service=cells"], capture=True).split()
            require(len(container) == 1, "production Cells is not running")
            output = run(DOCKER + ["exec", container[0], "cells", "admin", "user", "token", "-u", login, "-e",
                                   ctx.adapter.get("tokenLifetime", "8760h"), "-q"], capture=True)
            tokens = [l.strip() for l in output.splitlines() if re.fullmatch(r"[A-Za-z0-9._~+/=-]{20,}", l.strip())]
            require(len(tokens) == 1, f"native token for {login} could not be minted")
            values[key] = tokens[0]
        elif rule.startswith("wren-connection:"):
            # The original Postgres connectionInfo of the single native project (nativeBindingService.ts
            # governedConnectionInfo): its non-secret fields as stored, the read-only role's password from
            # the component's own 0600 secret env file. Never printed.
            _, file_key, password_key = rule.split(":")
            facts = wren_facts(ctx)
            require(facts["connectionKeys"] == ["database", "host", "password", "port", "user"],
                    "native connectionInfo is not the Postgres host/port/database/user/password shape")
            password = env_value(ctx.component_value(file_key), password_key)
            require(password, "read-only role password missing from the component secret env")
            values[key] = json.dumps({**facts["connection"], "password": password}, separators=(",", ":"))
        else:
            raise Refused(f"{key}: unknown binding secret rule")
    require(sorted(values) == sorted(r["secretKey"] for r in plan["secretRefs"]), "binding secrets differ from the release secretSchema")
    write_private(out, json.dumps(values))
    say("secrets", bindingId=plan["bindingId"], file=str(out), minted=True, keys=sorted(values))


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("command", choices=["plan", "deliver", "client", "secrets"])
    parser.add_argument("component", choices=["file-storage", "knowledge", "data-query"])
    parser.add_argument("--source", required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--runtime", required=True)
    parser.add_argument("--state-dir", help="verification only: render release and plan here instead of the declared stateDir")
    args = parser.parse_args()
    os.umask(0o077)
    try:
        require(re.fullmatch(r"[0-9a-f]{40}", args.commit), "--commit must be a full commit")
        ctx = Context(args)
        {"plan": cmd_plan, "deliver": cmd_deliver, "client": cmd_client, "secrets": cmd_secrets}[args.command](ctx)
    except Refused as error:
        say("refused", reason=str(error))
        sys.exit(2)
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
        say("refused", reason=type(error).__name__)
        sys.exit(2)


if __name__ == "__main__":
    main()
