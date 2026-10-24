"""Unattended isolated conformance run of the Wren (data_query@2) candidate (DD-136(5), .design/07 §8A).

Loaded by tools/component-release/conformance-auto.py (`run data-query`); h is that module
(shared helpers). It drives conformance-run.sh's data-query stages 0-6 without an operator:

  instance   a dedicated Compose project kailo-wren-conformance-<id> from
             data-query/docker/docker-compose.yaml + conformance/isolated.yaml (own PostgreSQL
             for the original wren-ui metadata and the synthetic vector source, no browser Gateway),
             its own networks and the AI service on the actually discovered, keyless upstream
             model services declared in deploy/components/adapters.json (07 §8.3, no key exists
             or is invented); digest-pinned images of the candidate release.
  identity   the instance's native identity is a key pair generated for this run (the private key
             stays in an owner-only file; its public JWKS is what the instance's verifier fetches
             at the conformance-provider origin). The native SERVICE token for onboarding and the
             HUMAN token for the provider's prepare step are signed with it; tokens are 0600 files.
  source     a synthetic source database (table public.source, one INTEGER row) and a read-only
             role are created through psql on stdin; the password exists only in 0600 files and
             the run's isolated OpenBao (the binding `connection` SecretRef).
  onboarding original GraphQL saveDataSource/saveTables (native service account), whose deploy is
             the original DeployService; the retained manifest is the original MDLService output,
             checked against the hash DeployService stored.
  delivery   fresh simulated tenant/workspace/binding/actor ids (never production ones), the Wren
             query/binding deliveries (adapter-delivery.py config --kind data-query), the run's
             isolated OpenBao + component Agent.
  stages 2-6 provider prepare/observe, observe.mjs, conformance-inputs.mjs, the suite provider.

Returns the staged candidate files; facts come only from the isolated instance's answers.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import time
import uuid

COMPONENT = "data-query"
PROVIDER_PORT = 4080
TABLE = "public.source"


def _artifact(source, name):
    text = (Path(source) / "data-query/fork/upstream.yaml").read_text(encoding="utf-8")
    match = re.search(r"- name: " + re.escape(name) + r"\n(?:.*\n)*?\s+artifact_digest: (sha256:[0-9a-f]{64})", text)
    if not match:
        raise RuntimeError(f"{name} has no recorded artifact digest")
    return match.group(1)


def _template_value(source, name):
    text = (Path(source) / "deploy/components/data-query.env.template").read_text(encoding="utf-8")
    match = re.search(r"^" + re.escape(name) + r"=(\S+)$", text, re.M)
    if not match:
        raise RuntimeError(f"data-query.env.template has no {name}")
    return match.group(1)


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _node_modules(h, source):
    """The installed wren-ui dependency tree of this source's yarn.lock (check image component cache)."""
    lock = (Path(source) / "data-query/wren-ui/yarn.lock").read_bytes()
    root = Path("/volumes/data/kailo/check-cache/component-lint/data-query_wren-ui")
    for entry in sorted(root.glob("*/"), key=lambda p: p.stat().st_mtime, reverse=True):
        modules = entry / "data-query/wren-ui/node_modules"
        cached = entry / "data-query/wren-ui/yarn.lock"
        if (entry / ".complete").is_file() and modules.is_dir() and cached.is_file() and cached.read_bytes() == lock:
            return str(modules)
    h.require(False, "no installed wren-ui node_modules for this yarn.lock (run tools/check.sh lint once)")


def _node(r, h, network, script_args, alias=None, detach=None, mounts=()):
    s = r.state
    argv = h.DOCKER + ["run"]
    argv += ["-d", "--name", detach, "--restart", "no"] if detach else ["--rm"]
    argv += ["--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--cpus", "2", "--memory", "2g",
             "--memory-swap", "2g", "--pids-limit", "512", "--tmpfs", "/tmp:rw,nosuid,nodev,size=256m",
             "-u", f"{os.getuid()}:{os.getgid()}", "-e", "HOME=/tmp",
             "-v", f"{s['source']}:/src:ro", "-v", f"{r.dir}:{r.dir}", "-v", f"{s['nodeModules']}:/node_modules:ro",
             "-w", "/src", "--network", network]
    for mount in mounts:
        argv += ["-v", f"{mount}:{mount}:ro"]
    if alias:
        argv += ["--network-alias", alias]
    argv += [s["nodeImage"], "node", "tools/component-release/conformance/wren-isolated.cjs", *script_args]
    result = h.run(argv, log=r.log, capture=True)
    return result.stdout.decode("utf-8", "replace")


def _compose(r, h, env, *args, governed=False):
    s = r.state
    files = ["-f", f"{s['source']}/data-query/docker/docker-compose.yaml",
             "-f", f"{s['source']}/data-query/docker/conformance/isolated.yaml"]
    if governed:
        files += ["-f", f"{s['source']}/data-query/docker/query-governance.yaml"]
    return h.run(h.DOCKER + ["compose", "--project-name", s["project"], "--env-file", str(env), *files, *args],
                 log=r.log, capture=True, check=False)


def _psql(r, h, sql, database="postgres"):
    container = f"{r.state['project']}-native-db-1"
    h.run(h.DOCKER + ["exec", "-i", container, "psql", "-v", "ON_ERROR_STOP=1", "-q", "-U", "wren_conformance", "-d", database],
          stdin=sql.encode(), log=r.log)


def _native_env(r, h):
    s, d = r.state, r.dir
    w = d / "stages" / "wren"
    values = {
        "WREN_COMPOSE_PROJECT_NAME": s["project"], "WREN_PLATFORM": "linux/amd64",
        "WREN_UI_IMAGE": s["images"]["ui"], "WREN_AI_IMAGE": s["images"]["ai"], "WREN_ENGINE_IMAGE": s["images"]["engine"],
        "WREN_IBIS_IMAGE": s["images"]["ibis"], "WREN_GATEWAY_IMAGE": s["images"]["gateway"],
        "WREN_BOOTSTRAP_IMAGE": s["images"]["bootstrap"], "WREN_QDRANT_IMAGE": s["images"]["qdrant"],
        "WREN_CONFORMANCE_DB_IMAGE": s["images"]["db"], "WREN_CONFORMANCE_DB_ENV_FILE": f"{d}/secrets/db.env",
        "WREN_ENGINE_PORT": "8080", "WREN_ENGINE_SQL_PORT": "7432", "WREN_AI_SERVICE_PORT": "5555", "WREN_UI_PORT": "3000",
        "WREN_UI_BIND_ADDRESS": "0.0.0.0", "WREN_IBIS_SERVER_PORT": "8000", "WREN_GATEWAY_HTTP_PORT": "8080",
        "WREN_GATEWAY_ADMIN_PORT": "15000", "WREN_DB_TYPE": "pg", "WREN_SQLITE_FILE": "/app/data/db.sqlite3",
        "WREN_PRODUCT_VERSION": "0.29.1-rc.1", "WREN_ENGINE_VERSION": "0.22.0", "WREN_AI_SERVICE_VERSION": "0.29.0",
        "WREN_UI_VERSION": "0.32.2", "WREN_TELEMETRY_ENABLED": "false", "WREN_EXPERIMENTAL_ENGINE_RUST_VERSION": "false",
        "WREN_USER_UUID": "", "WREN_POSTHOG_API_KEY": "", "WREN_POSTHOG_HOST": "", "WREN_GENERATION_MODEL": "",
        "WREN_SHOULD_FORCE_DEPLOY": "", "WREN_NETWORK_SUBNET": s["subnets"][0], "WREN_AI_DATA_SUBNET": s["subnets"][1],
        "WREN_PUBLIC_BIND_ADDR": "127.0.0.1", "WREN_PUBLIC_PORT": "1", "WREN_PUBLIC_ORIGIN": s["publicOrigin"],
        "KAILO_FRAME_ANCESTORS": "", "KAILO_LOGOUT_URL": "", "PLATFORM_DISPLAY_NAME": "Kailo",
        "OIDC_ISSUER": s["providerOrigin"], "WREN_OIDC_CLIENT_ID": "kailo-conformance-unused",
        "WREN_NATIVE_IDENTITY_JSON": _canonical(s["nativeIdentity"]),
        "WREN_PROJECT_DIR": f"{d}/wren-project", "WREN_LOCAL_STORAGE": f"{d}/wren-project/data",
        "WREN_OIDC_SECRET_ENV_FILE": f"{d}/secrets/browser-oidc.env", "WREN_AI_SECRET_ENV_FILE": f"{d}/secrets/ai.env",
        "WREN_AI_IDENTITY_DIR": f"{d}/ai-identity", "WREN_UI_SECRET_ENV_FILE": f"{d}/secrets/ui-database.env",
        "WREN_NATIVE_DATA_KEY_DIR": f"{d}/data-keys",
        # Governed overlay (stage 2 on): the run's Agent delivery and the conformance network.
        "WREN_QUERY_DELIVERY_DIR": f"{w}/delivery", "WREN_QUERY_ACTION_JWKS_FILE": f"{w}/query-jwks/action-token-jwks.json",
        "GATEWAY_SERVICE_JWKS_FILE": s["gatewayJwks"], "WREN_QUERY_PLATFORM_NETWORK": s["network"],
    }
    return h.env_file(d / "native.env", values)


def _model_config(r, h, models):
    source = Path(r.state["source"])
    text = (source / "data-query/docker/config.template.yaml").read_text(encoding="utf-8")
    documents = text.split("\n---\n")
    out = []
    for document in documents:
        if "type: llm" in document:
            document = document.replace("${WREN_MODEL_CHAT_ID}", models["chat"]["model"]) \
                .replace("${WREN_MODEL_CHAT_CONTEXT_WINDOW}", str(models["chat"]["contextWindow"])) \
                .replace("${AGENTGATEWAY_MODEL_BASE_URL}", models["chat"]["apiBase"])
        elif "type: embedder" in document:
            document = document.replace("${WREN_MODEL_EMBEDDING_ID}", models["embedding"]["model"]) \
                .replace("${AGENTGATEWAY_MODEL_BASE_URL}", models["embedding"]["apiBase"])
        document = document.replace("${WREN_MODEL_EMBEDDING_DIM}", str(models["embedding"]["dimension"]))
        # The declared isolated upstreams are keyless: no key name, no key file entry.
        document = "\n".join(line for line in document.split("\n") if "api_key_name: ${WREN_MODEL_API_KEY_NAME}" not in line)
        out.append(document)
    rendered = "\n---\n".join(out)
    h.require(not any("${" in line for line in rendered.split("\n") if not line.lstrip().startswith("#")),
              "isolated model configuration still has placeholders")
    return h.write_private(r.dir / "wren-project/config.yaml", rendered)


def _secrets(r, h):
    d = r.dir
    sec = h.private_dir(d / "secrets")
    if (sec / "db.env").is_file():
        return
    db_password = h.secret_text(40)
    h.write_private(sec / "db.env", f"POSTGRES_PASSWORD={db_password}\n")
    url = f"postgres://wren_conformance:{db_password}@native-db:5432/wren_ui"
    h.write_private(sec / "ui-database.env", f"PG_URL={url}\n")
    h.write_private(sec / "database-url", url)
    h.write_private(sec / "reader-password", h.secret_text(40))
    h.write_private(sec / "browser-oidc.env", f"WREN_OIDC_CLIENT_SECRET={h.secret_text(48)}\nOIDC_COOKIE_SECRET={secrets.token_hex(32)}\n")
    h.write_private(sec / "ai.env", "")
    keys = h.private_dir(d / "data-keys")
    h.write_private(keys / "encryption-password", h.secret_text(48))
    h.write_private(keys / "encryption-salt", h.secret_text(32))
    ai = h.private_dir(d / "ai-identity")
    h.write_private(ai / "client-secret", h.secret_text(48))
    s = r.state
    h.write_json(ai / "identity.json", {"uiEndpoint": "http://wren-ui:3000", "publicOrigin": s["publicOrigin"],
                                        "tokenEndpoint": f"{s['providerOrigin']}/oidc/token",
                                        "clientId": s["nativeIdentity"]["serviceAudience"],
                                        "secretFile": "/run/wren-ai-native/client-secret"})


def _isolated_plan(r, h, manifest, record, origin):
    s = r.state
    tenant, workspace, binding, service = (str(uuid.uuid4()) for _ in range(4))
    actor, denied, policy = (str(uuid.uuid4()) for _ in range(3))
    client = f"data-query-ui-{binding[:8]}"
    normalized = {"nativePageUrl": origin, "client_id": client}
    audience = manifest["executionConnector"]["actionTokenAudience"]
    plan = {
        "tenantId": tenant, "workspaceId": workspace, "componentReleaseId": manifest["id"],
        "componentTypeKey": manifest["componentTypeKey"], "artifactDigest": manifest["adapterBuildRef"],
        "bindingId": binding, "bindingVersion": 1, "servicePrincipalId": service, "adapterServiceRef": "data-query-ui",
        "nativeInstanceRef": s["nativeInstanceRef"], "nativeScopeRef": str(record["projectId"]),
        "isolationMode": "DEDICATED_INSTANCE",
        "capabilityCategories": [{"category": i["categoryKey"], "version": i["contractVersion"]} for i in manifest["implements"]],
        "normalizedConfig": normalized, "configDigest": hashlib.sha256(_canonical(normalized).encode()).hexdigest(),
        "clientId": client, "modelCallMode": (manifest.get("allowedModelCallModes") or ["NONE"])[0],
        "retainOnTenantDelete": any(c.get("tenantDelete") == "RETAIN_ON_TENANT_DELETE" for c in manifest["capabilityDeclarations"]),
        "secretRefs": [{"secretKey": x["secretKey"], "locator": f"tenants/{tenant}/kv/application-binding/{binding}/{x['secretKey']}",
                        "version": 1, "audience": audience} for x in manifest["secretSchema"]],
        "actionVersions": [{"actionKey": a["actionKey"], "actionVersion": a["version"]} for a in manifest["actionDefinitions"]],
    }
    context = {
        "principals": {"tenantId": tenant, "workspaceId": workspace, "actorPrincipalId": actor, "deniedActorPrincipalId": denied,
                       "authorizationMinZedToken": f"conformance-simulated-{uuid.uuid4()}"},
        "bindingManagement": {"bindingId": binding, "actionDefinitionVersion": 1},
        "resultExposurePolicy": {"resultExposurePolicyId": policy, "resultExposurePolicyVersion": 1},
    }
    return plan, context


def drive(r, args, runtime_env, declaration, h):
    d = r.dir
    source = r.state["source"]
    if "project" not in r.state:
        run_id = d.name.rsplit("-", 1)[-1]
        provider_origin = f"http://conformance-provider:{PROVIDER_PORT}"
        instance = f"kailo-wren-conformance-{run_id}"
        gateway = h.docker("inspect", "--format", "{{.Config.Image}}", f"{h.compose_project()}-agentgateway-1").strip()
        r.record(project=instance, network=f"kailo-conformance-dq-{run_id}", subnets=h.free_subnets(2),
                 nativeInstanceRef=instance, providerOrigin=provider_origin,
                 publicOrigin=f"http://wren-conformance-{run_id}.invalid",
                 adapterOrigin=f"http://{instance}-wren-ui-1:3000",
                 nativeIdentity={"issuer": provider_origin, "audience": f"{instance}-human",
                                 "serviceAudience": f"{instance}-service", "jwksUrl": f"{provider_origin}/jwks",
                                 "accessClaim": "kailo_conformance_instance", "accessValue": instance,
                                 "publicOrigin": f"http://wren-conformance-{run_id}.invalid"},
                 gatewayJwks=runtime_env["GATEWAY_SERVICE_JWKS_FILE"],
                 nodeModules=_node_modules(h, source),
                 images={"ui": f"{declaration['registry']}/data-query-ui@{_artifact(source, 'data-query-ui')}",
                         "ai": f"{declaration['registry']}/data-query-ai-service@{_artifact(source, 'data-query-ai-service')}",
                         "engine": f"{declaration['registry']}/data-query-engine@{_artifact(source, 'data-query-engine')}",
                         "ibis": f"{declaration['registry']}/data-query-ibis@{_artifact(source, 'data-query-ibis')}",
                         "gateway": gateway,
                         "bootstrap": _template_value(source, "WREN_BOOTSTRAP_IMAGE"),
                         "qdrant": _template_value(source, "WREN_QDRANT_IMAGE"),
                         # The platform PostgreSQL digest the template names for Wren's own databases.
                         "db": re.search(r"postgres@sha256:[0-9a-f]{64}", (Path(source) / "deploy/components/data-query.env.template")
                                         .read_text(encoding="utf-8")).group(0)})
    s = r.state
    for sub in ("stages", "tmp", "openbao-state", "agent-bootstrap"):
        h.private_dir(d / sub)
    h.private_dir(d / "wren-project")
    h.private_dir(d / "wren-project/data")
    _secrets(r, h)
    manifest = h.render_release(r, COMPONENT, declaration["nativePageOrigin"])
    s = r.state
    h.require(f"sha256:{manifest['adapterBuildRef']}" == _artifact(source, "data-query-ui"),
              "rendered adapterBuildRef differs from the recorded data-query-ui artifact")
    _model_config(r, h, declaration["conformanceModels"])
    _native_env(r, h)
    stages = d / "stages"
    w = stages / "wren"
    r.record(runEnv={"CONFORMANCE_SOURCE": source, "CONFORMANCE_RUN_DIR": str(stages), "CONFORMANCE_NODE_IMAGE": s["nodeImage"],
                     "CONFORMANCE_NETWORK": s["network"], "CONFORMANCE_WREN_NODE_MODULES": s["nodeModules"],
                     "CONFORMANCE_ADAPTER_JWKS": str(w / "query-jwks/action-token-jwks.json")},
             runEnvFiles={"CONFORMANCE_NATIVE_ENV": str(d / "native.env"), "CONFORMANCE_OPENBAO_ENV": str(d / "openbao.env"),
                          "CONFORMANCE_SEED_FILE": str(w / "prepare.json"), "CONFORMANCE_OBSERVE_FILE": str(w / "observe.json"),
                          "CONFORMANCE_PROVIDER_FILE": str(w / "provider.json"), "CONFORMANCE_MANIFEST": s["manifest"],
                          "CONFORMANCE_WREN_IDENTITY_JSON_FILE": str(d / "native-identity.json"),
                          # Node steps outside the stage directory read the native database URL.
                          "CONFORMANCE_MOUNTS": f"{d}/secrets/database-url"})
    h.write_private(d / "native-identity.json", _canonical(s["nativeIdentity"]))
    if not (stages / "stage-0.done").exists():
        r.conformance(0)
    if not (stages / "stage-1.done").exists():
        r.conformance(1)
    for sub in ("", "prep", "fixture", "query-jwks"):
        h.private_dir(w / sub)
    h.private_dir(w / "delivery")

    # Synthetic source and its read-only role (psql on stdin; the password never in argv).
    if not s.get("sourceReady"):
        reader = (d / "secrets/reader-password").read_text(encoding="utf-8")
        _psql(r, h, "CREATE DATABASE wren_native;\n")
        _psql(r, h, (
            "CREATE TABLE public.source (value integer PRIMARY KEY);\n"
            "INSERT INTO public.source (value) VALUES (1);\n"
            f"CREATE ROLE wren_reader LOGIN PASSWORD '{reader}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;\n"
            "REVOKE CREATE, TEMPORARY ON DATABASE wren_native FROM PUBLIC;\n"
            "REVOKE CREATE ON SCHEMA public FROM PUBLIC;\n"
            "REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;\n"
            "GRANT CONNECT ON DATABASE wren_native TO wren_reader;\n"
            "GRANT USAGE ON SCHEMA public TO wren_reader;\n"
            "GRANT SELECT ON TABLE public.source TO wren_reader;\n"), database="wren_native")
        h.write_json(d / "secrets/connection.json", {"host": "native-db", "port": "5432", "database": "wren_native",
                                                    "user": "wren_reader", "password": reader, "ssl": False})
        r.record(sourceReady=True)
        s = r.state

    # The isolated native identity (key pair of this run) and the onboarding through original GraphQL.
    network = f"{s['project']}_wren"
    prep = w / "prep"
    if not (prep / "jwks.json").is_file():
        out = _node(r, h, "none", ["keygen", str(prep)])
        r.record(nativeKid=json.loads(out.strip().splitlines()[-1])["kid"])
        s = r.state
    if not s.get("onboarded"):
        server = f"kailo-wren-conformance-jwks-{d.name.rsplit('-', 1)[-1]}"
        h.run(h.DOCKER + ["rm", "-f", server], check=False)
        _node(r, h, network, ["serve-jwks", str(prep / "jwks.json"), str(PROVIDER_PORT)], alias="conformance-provider", detach=server)
        try:
            ident = s["nativeIdentity"]
            h.write_json(prep / "sign-service.json", {"privateKeyFile": str(prep / "private.pem"), "kid": s["nativeKid"],
                                                      "issuer": ident["issuer"], "audience": ident["serviceAudience"],
                                                      "azp": ident["serviceAudience"], "subject": "kailo-conformance-onboarding",
                                                      "claim": ident["accessClaim"], "value": ident["accessValue"],
                                                      "seconds": 900, "out": str(prep / "service-token")})
            _node(r, h, "none", ["sign", str(prep / "sign-service.json")])
            h.write_json(prep / "onboard.json", {"graphqlUrl": f"{s['adapterOrigin']}/api/graphql", "publicOrigin": s["publicOrigin"],
                                                 "tokenFile": str(prep / "service-token"),
                                                 "connectionFile": str(d / "secrets/connection.json"),
                                                 "displayName": "Kailo conformance source", "table": TABLE, "timeoutMs": 120000,
                                                 "aiHealthUrl": "http://wren-ai-service:5555/health"})
            for attempt in range(30):
                try:
                    _node(r, h, network, ["onboard", str(prep / "onboard.json")])
                    break
                except h.Refused:
                    if attempt == 29:
                        raise
                    # wren-ui may still be running its migrations or warming up.
                    time.sleep(10)
            r.record(onboarded=True)
            h.say("native-onboarding", project="created", table=TABLE)
        finally:
            h.run(h.DOCKER + ["rm", "-f", server], check=False)
            (prep / "service-token").unlink(missing_ok=True)
        s = r.state
    if not (w / "native-mdl.json").is_file():
        h.write_json(prep / "retain.json", {"databaseUrlFile": str(d / "secrets/database-url"), "out": str(w / "native-mdl.json"),
                                            "uiSourceRoot": "/src/data-query/wren-ui", "timeoutMs": 1800000,
                                            "experimentalEngineRust": "false",
                                            "encryptionPasswordFile": str(d / "data-keys/encryption-password"),
                                            "encryptionSaltFile": str(d / "data-keys/encryption-salt")})
        _node(r, h, network, ["retain", str(prep / "retain.json")])
    record = h.read_json(w / "native-mdl.json")
    h.say("native-deployment", projectId=record["projectId"], modelId=record["modelId"], deploymentId=record["deploymentId"])

    # Isolated bind plan, the Wren deliveries and the run's isolated OpenBao.
    identity, signing_file = h.core_identity(runtime_env)
    audience = f"kailo-conformance-{COMPONENT}"
    if not (w / "isolated-plan.json").is_file():
        plan, context = _isolated_plan(r, h, manifest, record, declaration["nativePageOrigin"])
        h.write_json(w / "isolated-plan.json", plan)
        h.write_json(w / "isolated-context.json", context)
    plan = h.read_json(w / "isolated-plan.json")
    context = h.read_json(w / "isolated-context.json")
    if not (w / "delivery/adapter.json").is_file():
        connection = h.read_json(d / "secrets/connection.json")
        h.require(sorted(connection) == record["connectionKeys"], "native connectionInfo keys differ from the delivered connection")
        h.write_private(d / "secrets/connection-secret", json.dumps(connection, separators=(",", ":")))
        h.write_private(d / "secrets/service-client-secret", h.secret_text(48))
        h.write_json(w / "query-jwks/action-token-jwks.json", {"keys": []})
        h.write_json(prep / "signing.json", {"issuer": identity["issuer"], "jwksFile": str(w / "query-jwks/action-token-jwks.json")})
        provider = s["providerOrigin"]
        h.run(["python3", "-I", f"{source}/deploy/components/adapter-delivery.py", "config", "--kind", "data-query",
               "--plan", str(w / "isolated-plan.json"), "--template", f"{source}/deploy/components/data-query-adapter.template.json",
               "--delivery-dir", str(w / "delivery"), "--env-file", runtime_env["env"],
               "--action-token-signing-file", str(prep / "signing.json"),
               "--set", f"projectConnectionDigest={record['projectConnectionDigest']}",
               "--set", f"mcpAuthority={s['adapterOrigin'].split('//', 1)[1]}",
               "--core-pep-url", f"{provider}/service/v1/adapter/pep_check", "--oidc-token-url", f"{provider}/oidc/token",
               "--action-token-audience", audience, "--out", str(w / "delivery/adapter.json")], log=r.log)
    bao_port = s.get("baoPort") or h.free_port(58290, 58299)
    r.record(baoPort=bao_port)
    run_id = d.name.rsplit("-", 1)[-1]
    h.env_file(d / "openbao.env", {
        "OPENBAO_CONFORMANCE_SOURCE": source, "OPENBAO_CONFORMANCE_NAME": f"kailo-openbao-conformance-{run_id}",
        "OPENBAO_CONFORMANCE_IMAGE": h.platform_openbao_image(), "OPENBAO_CONFORMANCE_PORT": str(bao_port),
        "OPENBAO_CONFORMANCE_STATE_DIR": str(d / "openbao-state"), "OPENBAO_CONFORMANCE_NETWORK": s["network"],
        "OPENBAO_CONFORMANCE_ADAPTER_CONFIG": str(w / "delivery/adapter.json"),
        "OPENBAO_CONFORMANCE_SECRETS": f"connection={d / 'secrets/connection-secret'} oidc_client_secret={d / 'secrets/service-client-secret'}",
        "OPENBAO_CONFORMANCE_ROLE": f"conformance-{COMPONENT}-reader",
        "ADAPTER_AGENT_PROJECT": f"kailo-agent-conformance-{run_id}",
        "ADAPTER_AGENT_UID": str(os.getuid()), "ADAPTER_AGENT_GID": str(os.getgid()),
        "ADAPTER_AGENT_BOOTSTRAP_DIR": str(d / "agent-bootstrap"), "ADAPTER_AGENT_DELIVERY_DIR": str(w / "delivery")})

    # Provider prepare inputs: an isolated preparation identity of this run's native key.
    query = h.read_json(w / "delivery/query.json")
    registration = h.read_json(f"{source}/contracts/adapter/data_query.v2/registration.json")
    h.write_json(prep / "registration.json", registration)
    h.write_json(prep / "environment.json", {"artifactDigest": manifest["adapterBuildRef"], "adapterBaseUrl": f"{s['adapterOrigin']}/",
                                             "maxResponseBytes": 1048576, "maxSteps": 400})
    h.write_json(prep / "identity.json", {"artifactDigest": manifest["adapterBuildRef"], "issuer": identity["issuer"],
                                          "audience": audience, "tokenSeconds": 3600, "secretLocator": identity["secretLocator"],
                                          "secretVersion": identity["secretVersion"], "secretAudience": identity["secretAudience"],
                                          "privateKeyField": identity["privateKeyField"], "jwksFile": str(prep / "jwks.json"),
                                          "contexts": []})
    fixture = w / "fixture/native-fixture.json"
    h.write_json(w / "prepare.json", {"mode": "CONFORMANCE_ONLY", "listenHost": "0.0.0.0", "listenPort": PROVIDER_PORT,
                                      "productionActionAudience": manifest["executionConnector"]["actionTokenAudience"],
                                      "environmentFile": str(prep / "environment.json"), "identityFile": str(prep / "identity.json"),
                                      "queryFile": str(w / "delivery/query.json"), "bindingFile": str(w / "delivery/binding.json"),
                                      "registrationFile": str(prep / "registration.json"),
                                      "databaseUrlFile": str(d / "secrets/database-url"), "nativeFixtureFile": str(fixture),
                                      "preparationGeneration": 1, "preparationFile": str(prep / "preparation.json")})
    ident = s["nativeIdentity"]
    if not (stages / "stage-3.done").exists():
        h.write_json(prep / "sign-human.json", {"privateKeyFile": str(prep / "private.pem"), "kid": s["nativeKid"],
                                                "issuer": ident["issuer"], "audience": ident["audience"],
                                                "subject": "kailo-conformance-preparer", "claim": ident["accessClaim"],
                                                "value": ident["accessValue"], "seconds": 3600, "out": str(prep / "human-token")})
        _node(r, h, "none", ["sign", str(prep / "sign-human.json")])
        h.write_json(prep / "preparation.json", {"graphqlUrl": f"{s['adapterOrigin']}/api/graphql", "publicOrigin": s["publicOrigin"],
                                                 "humanTokenFile": str(prep / "human-token"), "projectId": record["projectId"],
                                                 "modelId": record["modelId"], "manifest": record["manifest"]})
    if not (stages / "stage-2.done").exists():
        r.conformance(2)
    if not (stages / "stage-3.done").exists():
        r.conformance(3)
    h.require(fixture.is_file(), "the provider published no native fixture")

    # Observation and Core inputs.
    candidate = Path(runtime_env["COMPONENT_CONFORMANCE_DIR"] or "/nonexistent") / manifest["adapterBuildRef"]
    vectors = json.loads(registration["testVectorsJson"])
    describe = next(step for case in vectors["cases"] for step in case["steps"] if step["contractKey"] == "data_query.describe@v2")
    policy = context["resultExposurePolicy"]
    h.write_json(w / "observe.json", {
        "component": COMPONENT, "manifestFile": s["manifest"], "seed": str(uuid.uuid4()),
        "adapterBaseUrl": f"{s['adapterOrigin']}/", "suiteAdapterBaseUrl": f"{s['adapterOrigin']}/",
        "maxResponseBytes": 1048576, "maxSteps": 400,
        "adapterConfigFile": str(w / "delivery/query.json"), "adapterBindingFile": str(w / "delivery/binding.json"),
        "adapterJwksFile": query["actionTokenJwksFile"],
        "provider": {"listenHost": "0.0.0.0", "listenPort": PROVIDER_PORT,
                     "productionActionAudience": manifest["executionConnector"]["actionTokenAudience"], "requestTimeoutMs": 30000},
        "identity": {**identity, "audience": audience, "jwksFile": str(candidate / "jwks.json")},
        "principals": context["principals"], "bindingManagement": context["bindingManagement"],
        "execution": {"actionKey": "data_query.describe@v2", "target": {"resourceId": describe["referenceResourceId"]},
                      "input": json.loads(describe["inputJson"]), **policy},
        "vectorContexts": {"default": policy},
        "wren": {"databaseUrlFile": str(d / "secrets/database-url"), "nativeFixtureFile": str(fixture), "preparationGeneration": 1},
        "out": str(stages / "facts.json")})
    if not (stages / "stage-4.done").exists():
        r.conformance(4)
    if not (stages / "stage-5.done").exists():
        r.conformance(5)
    # The suite provider verifies Core-signed probes with Core's public JWKS, which stage 6 places at the
    # query delivery's actionTokenJwksFile; its identity copy names that file (the candidate's identity
    # names the candidate's own copy, installed after this run).
    provider_identity = h.read_json(stages / "inputs/identity.json")
    provider_identity["jwksFile"] = query["actionTokenJwksFile"]
    h.write_json(w / "provider-identity.json", provider_identity)
    h.write_json(w / "provider.json", {"mode": "CONFORMANCE_ONLY", "listenHost": "0.0.0.0", "listenPort": PROVIDER_PORT,
                                       "productionActionAudience": manifest["executionConnector"]["actionTokenAudience"],
                                       "environmentFile": str(stages / "inputs/environment.json"),
                                       "identityFile": str(w / "provider-identity.json"),
                                       "queryFile": str(w / "delivery/query.json"), "bindingFile": str(w / "delivery/binding.json"),
                                       "registrationFile": str(prep / "registration.json"),
                                       "databaseUrlFile": str(d / "secrets/database-url"), "nativeFixtureFile": str(fixture),
                                       "preparationGeneration": 1})
    files = r.state["runEnvFiles"]
    files["CONFORMANCE_CORE_JWKS"] = identity["jwksFile"]
    r.record(runEnvFiles=files)
    if not (stages / "stage-6.done").exists():
        r.conformance(6)
    return {"environment.json": stages / "inputs/environment.json", "fixture.json": stages / "inputs/fixture.json",
            "identity.json": stages / "inputs/identity.json", "jwks.json": identity["jwksFile"]}


def teardown(r, h):
    s = r.state
    if s.get("project") and (r.dir / "native.env").is_file():
        _compose(r, h, r.dir / "native.env", "down", "--volumes", "--remove-orphans", governed=True)
    run_id = r.dir.name.rsplit("-", 1)[-1]
    h.run(h.DOCKER + ["rm", "-f", f"kailo-wren-conformance-jwks-{run_id}"], check=False)
