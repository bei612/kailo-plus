"""DD-128(5) / V-SCN-173: operator delivery of a native page entry model key.
ADR-20 §3: platform .env and secrets/ come from the runtime directory, separated
from the fixed release tree (RuntimeDirectorySeparation).

Run: python3 -I -m unittest discover -s deploy/components -p test_native_model_delivery.py
(from the apps root). No OpenBao, Docker or Core database is contacted.
"""

import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest
from unittest import mock
from uuid import uuid4

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


delivery = load("native_model_delivery", HERE / "native-model-delivery.py")
native_config = load("native_config", HERE / "native-config.py")

ENV = {"CORE_DB_USER": "kailo", "CORE_DB_NAME": "kailo", "OPENBAO_ADDR": "http://openbao:8200",
       "OPENBAO_HTTP_TIMEOUT_SECONDS": "5", "OPENBAO_SECRET_ID_TTL": "120s",
       "OPENBAO_SECRET_ID_WRAP_TTL": "120s", "OPENBAO_TOKEN_PERIOD": "20m",
       "AGENTGATEWAY_MODEL_BASE_URL": "http://agentgateway:18081/v1"}


def projection(binding=None, generation=1):
    binding = binding or str(uuid4())
    tenant, principal = str(uuid4()), str(uuid4())
    role = "application-model-" + binding.replace("-", "")
    locator = f"tenants/{tenant}/kv/application-model/{binding}/{generation}"
    return {"bindingId": binding, "generation": generation, "tenantId": tenant, "workspaceId": None,
            "gatewayPrincipalId": principal, "deliveryMode": "NATIVE_PAGE",
            "nativeModels": ["chat-route", "embedding-route"],
            "routeResourceIds": [str(uuid4()), str(uuid4())],
            "serviceSecretRef": {"locator": locator, "version": 1, "audience": role},
            "secretRef": {"locator": locator, "version": 1},
            "secretReader": {"roleName": role, "audience": role, "servicePrincipalId": principal}}


def private(path, text):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        stream.write(text)


class FakeBao:
    def __init__(self, store, namespace):
        self.store, self.namespace = store, namespace

    def request(self, path, fields=None, *, missing=False, wrap=None, delete=False):
        self.store.setdefault("calls", []).append((self.namespace, path, fields, wrap, delete))
        if path == "sys/mounts":
            return {"data": {"kv/": {"type": "kv", "options": {"version": "2"}}}}
        if path == "sys/auth":
            return {"data": {"approle/": {"type": "approle"}}}
        if path.endswith("/role-id"):
            return {"data": {"role_id": "role-id-fixture"}}
        if path.endswith("/secret-id"):
            assert wrap == "120s" and fields == {}
            return {"wrap_info": {"token": "wrapped-fixture"}}
        objects = self.store.setdefault("objects", {})
        if delete:
            objects.pop(path, None)
            return None
        if fields is not None:
            objects[path] = {"data": dict(fields)}
            return None
        if path not in objects:
            if missing:
                return None
            raise delivery.Refused("missing")
        return objects[path]


def runtime_fixture(root):
    """A runtime directory as on the CI node: real .env, secrets/ and data/."""
    runtime = root / "runtime"
    (runtime / "secrets").mkdir(parents=True, mode=0o700)
    (runtime / "data").mkdir(mode=0o700)
    private(runtime / ".env", "CORE_DB_USER=kailo\n")
    private(runtime / "secrets" / "openbao_init.json", json.dumps({"root_token": "fixture-root-token"}))
    return runtime


class Delivery(unittest.TestCase):
    def setUp(self):
        self.work = Path(tempfile.mkdtemp())
        self.dir = self.work / "delivery"
        self.dir.mkdir(mode=0o700)
        self.env = {**ENV, "KAILO_RUNTIME_DIR": str(runtime_fixture(self.work))}
        self.value = projection()
        self.bao = {}
        self.factory = lambda env, namespace: FakeBao(self.bao, namespace)

    def tearDown(self):
        subprocess.run(["rm", "-rf", "--", str(self.work)], check=True)

    def write_projection(self, value=None):
        private(self.dir / "projection.json", json.dumps(value or self.value))

    def test_projection_is_exactly_one_native_page_binding_generation(self):
        delivery.validate_projection(self.value, self.value["bindingId"])
        for change in (
            lambda p: p.update(deliveryMode="ADAPTER"),
            lambda p: p["secretReader"].update(roleName="application-model-" + "0" * 32),
            lambda p: p["serviceSecretRef"].update(audience="core"),
            lambda p: p["serviceSecretRef"].update(locator=p["serviceSecretRef"]["locator"][:-1] + "2"),
            lambda p: p.update(nativeModels=["chat-route"]),
            lambda p: p.update(extra=True),
        ):
            value = json.loads(json.dumps(self.value))
            change(value)
            with self.assertRaises(delivery.Refused):
                delivery.validate_projection(value, self.value["bindingId"])
        with self.assertRaises(delivery.Refused):
            delivery.validate_projection(self.value, str(uuid4()))

    def test_export_reads_only_an_active_native_page_projection(self):
        calls, environments = [], []

        def runner(row):
            def run(command, **kwargs):
                calls.append(command)
                environments.append(kwargs["env"])
                return subprocess.CompletedProcess(command, 0, json.dumps(row) + "\n", "")
            return run

        row = {"state": "ACTIVE", "modelCallMode": "PLATFORM_LLM_ROUTE", "nativePage": True,
               "componentTypeKey": "wren", "modelState": "ACTIVE", "projection": self.value}
        result = delivery.export(self.env, str(self.dir), self.value["bindingId"], runner(row))
        self.assertEqual(result["generation"], 1)
        self.assertIn("PGOPTIONS=-c default_transaction_read_only=on", calls[0])
        runtime = self.env["KAILO_RUNTIME_DIR"]
        self.assertEqual(calls[0][:5], ["sudo", "-n", "--preserve-env=KAILO_RUNTIME_DIR", "docker", "compose"])
        self.assertEqual(calls[0][5:7], ["--env-file", runtime + "/.env"])
        self.assertEqual(environments[0]["KAILO_RUNTIME_DIR"], runtime)
        self.assertEqual(json.loads((self.dir / "projection.json").read_text()), self.value)
        self.assertEqual(os.stat(self.dir / "projection.json").st_mode & 0o777, 0o600)
        # Re-export of the same generation is idempotent; another one is refused.
        delivery.export(self.env, str(self.dir), self.value["bindingId"], runner(row))
        for refused in ({**row, "state": "DISABLING"}, {**row, "nativePage": False},
                        {**row, "modelState": "PENDING"},
                        {**row, "projection": {**self.value, "generation": 2}}):
            with self.assertRaises(delivery.Refused):
                delivery.export(self.env, str(self.dir), self.value["bindingId"], runner(refused))
        with self.assertRaises(delivery.Refused):
            delivery.export(self.env, str(self.dir), "not-a-uuid", runner(row))

    def test_prepare_creates_only_the_exact_read_policy_and_one_use_role(self):
        self.write_projection()
        result = delivery.prepare(self.env, str(self.dir), self.factory)
        role = self.value["secretReader"]["roleName"]
        self.assertEqual(result["role"], role)
        objects = self.bao["objects"]
        path = "application-model/" + self.value["bindingId"] + "/1"
        self.assertEqual(objects["sys/policies/acl/" + role]["data"]["policy"],
                         f'path "kv/data/{path}" {{ capabilities = ["read"] }}\n')
        wanted = objects["auth/approle/role/" + role]["data"]
        self.assertEqual((wanted["secret_id_num_uses"], wanted["token_policies"]), (1, [role]))
        self.assertTrue(all(call[0] == "tenants/" + self.value["tenantId"] for call in self.bao["calls"]))
        hcl = (self.dir / "model-agent.hcl").read_text()
        self.assertIn(f"kv/data/{path}?version=1", hcl)
        self.assertIn("exit_after_auth = true", hcl)
        for name in ("model-role-id", "model-wrapped-secret-id", "model-agent.hcl"):
            self.assertEqual(os.stat(self.dir / name).st_mode & 0o777, 0o600)
        # A same-named policy with other rights is never replaced.
        self.bao["objects"]["sys/policies/acl/" + role] = {"data": {"policy": 'path "kv/*" {}'}}
        with self.assertRaises(delivery.Refused):
            delivery.prepare(self.env, str(self.dir), self.factory)

    def config(self, base="http://agentgateway:18081/v1", models=("chat-route", "embedding-route")):
        config = self.work / "config.yaml"
        private(config, f"""type: llm
provider: litellm_llm
models:
  - alias: default
    model: openai/{models[0]}
    api_base: {base}
    api_key_name: KAILO_MODEL_API_KEY
---
type: embedder
provider: litellm_embedder
models:
  - alias: default
    model: openai/{models[1]}
    api_base: {base}
    api_key_name: KAILO_MODEL_API_KEY
---
type: document_store
provider: qdrant
embedding_model_dim: 2560
""")
        return config

    def test_wren_consumers_must_name_exactly_the_frozen_models_at_the_gateway(self):
        names = delivery.wren_consumers(self.config(), self.value, self.env["AGENTGATEWAY_MODEL_BASE_URL"])
        self.assertEqual(names, ["KAILO_MODEL_API_KEY"])
        for config in (self.config(base="https://provider.example/v1"),
                       self.config(models=("chat-route", "other-route"))):
            with self.assertRaises(delivery.Refused):
                delivery.wren_consumers(config, self.value, self.env["AGENTGATEWAY_MODEL_BASE_URL"])

    def weknora(self, text=None, mode=0o644, file="builtin_models.yaml", **fill):
        """The declaration as the deploy entry renders it from the repository template
        (native-config.py, DD-128(5), SF-WEK-17); ``fill`` overrides a rendered fact."""
        if text is None:
            values = {"KNOWLEDGE_MODEL_CHAT_ID": "chat-route", "KNOWLEDGE_MODEL_EMBEDDING_ID": "embedding-route",
                      "KNOWLEDGE_MODEL_EMBEDDING_DIM": 2560, "KNOWLEDGE_MODEL_API_KEY_NAME": "${KAILO_MODEL_API_KEY}",
                      "AGENTGATEWAY_MODEL_BASE_URL": self.env["AGENTGATEWAY_MODEL_BASE_URL"], **fill}
            text, _ = native_config.render(native_config.SPECS["knowledge"], values, "")
        declaration = self.work / file
        declaration.write_text(text, encoding="utf-8")
        declaration.chmod(mode)
        return declaration

    def test_weknora_declaration_must_reference_the_key_only_as_frozen_gateway_models(self):
        base = self.env["AGENTGATEWAY_MODEL_BASE_URL"]
        valid = self.weknora()
        self.assertEqual(delivery.weknora_consumers(valid, self.value, base), ["KAILO_MODEL_API_KEY"])
        # Owner-written, readable by the non-root native process, never writable by others.
        self.assertEqual(delivery.weknora_consumers(self.weknora(mode=0o600), self.value, base), ["KAILO_MODEL_API_KEY"])
        text = valid.read_text(encoding="utf-8")
        self.assertEqual(len(re.findall(r'^ +api_key: "\$\{KAILO_MODEL_API_KEY\}"$', text, re.M)), 2)

        def edit(pattern, replacement, count=1):
            return lambda s: re.sub(pattern, replacement, s, count=count, flags=re.M)

        refused = {
            "group writable": self.weknora(mode=0o664, file="writable.yaml"),
            "direct provider": self.weknora(file="provider.yaml", AGENTGATEWAY_MODEL_BASE_URL="https://provider.example/v1"),
            "another model": self.weknora(file="other.yaml", KNOWLEDGE_MODEL_EMBEDDING_ID="other-route"),
            "guessed dimension": self.weknora(file="dimension.yaml", KNOWLEDGE_MODEL_EMBEDDING_DIM="unknown"),
        }
        for name, change in {
            "reference in a comment": lambda s: "# api_key: \"${KAILO_MODEL_API_KEY}\"\n" + s,
            "reference in a description": edit(r"^( +)type: KnowledgeQA$",
                                               r'\1type: KnowledgeQA\n\1description: "${KAILO_MODEL_API_KEY}"'),
            "unquoted reference": edit(r'^( +)api_key: "(.*)"$', r"\1api_key: \2"),
            "literal key": edit(r'^( +)api_key: ".*"$', r'\1api_key: "' + "ab" * 32 + '"'),
            "process setting": edit("KAILO_MODEL_API_KEY", "DB_USER", 0),
            "provider header": edit(r"^( +)provider: openai$", r"\1provider: openai\n\1custom_headers: {X-Route: other}"),
            "vendor client": edit("provider: openai", "provider: aliyun"),
            "duplicate id": edit("kailo-platform-embedding", "kailo-platform-chat"),
            "local model": edit("source: remote", "source: local"),
            "second document": lambda s: s + "---\nbuiltin_models: []\n",
        }.items():
            changed = change(text)
            self.assertNotEqual(changed, text, name)
            refused[name] = self.weknora(text=changed, file=name.replace(" ", "-") + ".yaml")
        for name, declaration in refused.items():
            with self.subTest(name):
                with self.assertRaises(delivery.Refused):
                    delivery.weknora_consumers(declaration, self.value, base)

    def test_weknora_key_names_are_the_ones_the_native_entrypoint_accepts(self):
        entrypoint = load("knowledge_native_entrypoint", ROOT / "knowledge/fork/deploy/native_entrypoint.py")
        self.assertEqual(entrypoint.MODEL_KEY_NAME.pattern, delivery.WEKNORA_KEY_NAME)

    def consumer_env(self, component):
        destination = self.work / (component + ".env")
        private(destination, "")
        if component == "wren":
            project = self.work / "wren"
            project.mkdir(mode=0o700)
            self.config().rename(project / "config.yaml")
            names = {"WREN_NATIVE_MODEL_DELIVERY_DIR": str(self.dir), "WREN_AI_SECRET_ENV_FILE": str(destination),
                     "WREN_PROJECT_DIR": str(project)}
        else:
            names = {"KNOWLEDGE_NATIVE_MODEL_DELIVERY_DIR": str(self.dir),
                     "KNOWLEDGE_MODEL_SECRET_ENV_FILE": str(destination),
                     "KNOWLEDGE_BUILTIN_MODELS_FILE": str(self.weknora())}
        return names, destination

    def test_wren_and_weknora_share_one_materialization(self):
        self.write_projection()
        for component in ("wren", "weknora"):
            with self.subTest(component):
                names, destination = self.consumer_env(component)
                self.credential()
                result = delivery.main(["materialize-" + component], {**self.env, **names})
                self.assertEqual((result["operation"], result["keyNames"]), ("materialize", ["KAILO_MODEL_API_KEY"]))
                self.assertEqual(destination.read_text(), 'KAILO_MODEL_API_KEY="' + "ab" * 32 + '"\n')
                self.assertFalse((self.dir / "credential.json").exists())
        for argv in (["materialize-cells"], ["materialize-"], ["materialize-weknora", "extra"]):
            with self.assertRaises(delivery.Refused):
                delivery.main(argv, self.env)

    def test_bootstrap_materializes_weknora_from_its_compose_env_without_sourcing_it(self):
        runtime = Path(self.env["KAILO_RUNTIME_DIR"])
        private(runtime / ".env", "".join(f"{k}={v}\n" for k, v in ENV.items()))
        self.write_projection()
        names, destination = self.consumer_env("weknora")
        self.credential()
        native = self.work / "native.env"
        # A Compose env value with a space would run a command if the file were sourced.
        sourced = self.work / "sourced"
        private(native, f"KAILO_FRAME_ANCESTORS=http://a.example touch {sourced}\n"
                + "".join(f"{k}={v}\n" for k, v in names.items()))
        command = ["bash", str(ROOT / "deploy/local/bootstrap.sh"), "--native-model-delivery", "materialize-weknora"]
        env = {**{k: v for k, v in os.environ.items() if k not in ENV}, "KAILO_RUNTIME_DIR": str(runtime)}
        result = subprocess.run(command + [str(native)], env=env, cwd=self.work, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["keyNames"], ["KAILO_MODEL_API_KEY"])
        self.assertNotIn("ab" * 32, result.stdout + result.stderr)
        self.assertEqual(destination.read_text(), 'KAILO_MODEL_API_KEY="' + "ab" * 32 + '"\n')
        self.assertFalse(sourced.exists())
        native.chmod(0o640)
        self.assertEqual(subprocess.run(command + [str(native)], env=env, capture_output=True).returncode, 2)
        private(native, "KNOWLEDGE_NATIVE_MODEL_DELIVERY_DIR=" + str(self.dir) + "\n")
        native.chmod(0o600)
        missing = subprocess.run(command + [str(native)], env=env, capture_output=True, text=True)
        self.assertEqual(missing.returncode, 2)
        self.assertIn("KNOWLEDGE_MODEL_SECRET_ENV_FILE", missing.stderr)

    def credential(self, **change):
        material = {"bindingId": self.value["bindingId"], "generation": 1,
                    "requestId": str(uuid4()), "version": 1, "value": "ab" * 32, **change}
        private(self.dir / "credential.json", json.dumps(material))

    def test_materialize_publishes_only_the_named_key_and_drops_the_render(self):
        self.write_projection()
        destination = self.work / "ai.env"
        private(destination, "")
        self.credential()
        result = delivery.materialize(self.env, str(self.dir), str(destination), ["KAILO_MODEL_API_KEY"])
        self.assertEqual(result["keyNames"], ["KAILO_MODEL_API_KEY"])
        self.assertNotIn("value", json.dumps(result))
        self.assertEqual(destination.read_text(), 'KAILO_MODEL_API_KEY="' + "ab" * 32 + '"\n')
        self.assertEqual(os.stat(destination).st_mode & 0o777, 0o600)
        self.assertFalse((self.dir / "credential.json").exists())
        # Another generation's render and unrelated env content are refused.
        self.credential(generation=2)
        with self.assertRaises(delivery.Refused):
            delivery.materialize(self.env, str(self.dir), str(destination), ["KAILO_MODEL_API_KEY"])
        self.credential()
        private(destination, "OPENAI_API_KEY=sk-provider\n")
        with self.assertRaises(delivery.Refused):
            delivery.materialize(self.env, str(self.dir), str(destination), ["KAILO_MODEL_API_KEY"])
        self.assertEqual(destination.read_text(), "OPENAI_API_KEY=sk-provider\n")

    def test_retire_removes_the_reader_and_local_handoff(self):
        self.write_projection()
        delivery.prepare(self.env, str(self.dir), self.factory)
        delivery.retire(self.env, str(self.dir), self.factory)
        role = self.value["secretReader"]["roleName"]
        self.assertNotIn("auth/approle/role/" + role, self.bao["objects"])
        self.assertNotIn("sys/policies/acl/" + role, self.bao["objects"])
        self.assertEqual(sorted(os.listdir(self.dir)), ["projection.json"])


class RuntimeDirectorySeparation(unittest.TestCase):
    """ADR-20 §3: deploy entries locate .env, secrets/ and data/ through KAILO_RUNTIME_DIR.

    The fixed release tree never carries links to them; a tree that still does is
    refused instead of being followed (it made prepare exit 78: "controlled path
    must be absolute, canonical and existing")."""

    def setUp(self):
        self.work = Path(tempfile.mkdtemp())
        self.runtime = runtime_fixture(self.work)
        # The fixed release tree: code only, no runtime delivery.
        self.release = self.work / "sources" / ("a" * 40) / "apps" / "deploy" / "local"
        self.release.mkdir(parents=True)
        # The same tree as the retired component-deploy.sh / core-release.sh left it.
        self.linked = self.work / "linked" / "deploy" / "local"
        self.linked.mkdir(parents=True)
        for name in (".env", "secrets", "data"):
            (self.linked / name).symlink_to(self.runtime / name)
        self.alias = self.work / "runtime-alias"
        self.alias.symlink_to(self.runtime)
        self.reader = load("wren_model_reader", ROOT / "data-query/docker/query-secrets/model-reader.py")
        self.node = load("release_node", ROOT / "tools/release/node.py")

    def tearDown(self):
        subprocess.run(["rm", "-rf", "--", str(self.work)], check=True)

    def resolve(self, cwd, given=None):
        """Source the shell resolver exactly as the deploy/local entries do."""
        env = {k: v for k, v in os.environ.items() if k != "KAILO_RUNTIME_DIR"}
        if given is not None:
            env["KAILO_RUNTIME_DIR"] = str(given)
        script = '. "$1" && printf %s "$KAILO_RUNTIME_DIR"'
        return subprocess.run(["bash", "-c", script, "bash", str(ROOT / "deploy/local/runtime-dir.sh")],
                              cwd=cwd, env=env, capture_output=True, text=True)

    def python_rules(self, value):
        """Every Python consumer of the exported value, in the same order of truth."""
        verdicts = []
        for check, refused in ((lambda: delivery.runtime_dir({"KAILO_RUNTIME_DIR": value}), delivery.Refused),
                               (lambda: self.reader.runtime_dir({"KAILO_RUNTIME_DIR": value}), self.reader.Refused),
                               (lambda: self.node.runtime_dir({"runtime": value}), self.node.NodeError)):
            try:
                with mock.patch.dict(os.environ, {}, clear=False):
                    os.environ.pop("KAILO_RUNTIME_DIR", None)
                    verdicts.append(str(check()))
            except refused:
                verdicts.append(None)
        return verdicts

    def test_shell_resolver_defaults_to_this_directory_and_refuses_a_release_tree(self):
        local = self.resolve(self.runtime)
        self.assertEqual((local.returncode, local.stdout), (0, str(self.runtime)), local.stderr)
        # A fixed release tree has no .env: without an explicit runtime it is refused, not used.
        bare = self.resolve(self.release)
        self.assertEqual(bare.returncode, 2)
        self.assertIn("缺少 .env", bare.stderr)
        # A tree carrying links is refused too, by default or when named explicitly.
        for given in (None, self.linked):
            linked = self.resolve(self.linked, given)
            self.assertEqual(linked.returncode, 2)
            self.assertIn("软链接", linked.stderr)
        # From the release tree with the explicit runtime: the canonical runtime, never the tree.
        explicit = self.resolve(self.release, self.alias)
        self.assertEqual((explicit.returncode, explicit.stdout), (0, str(self.runtime)), explicit.stderr)
        missing = self.resolve(self.release, self.work / "absent")
        self.assertEqual(missing.returncode, 2)

    def test_python_consumers_accept_exactly_what_the_shell_resolver_exports(self):
        exported = self.resolve(self.release, self.alias).stdout
        self.assertEqual(self.python_rules(exported), [exported] * 3)
        # Delivery code only takes the already resolved value; aliases, relative paths,
        # release trees and linked trees are refused by the delivery scripts.
        for value in (str(self.alias), "runtime", str(self.release), str(self.linked), ""):
            self.assertEqual(self.python_rules(value)[:2], [None, None], value)
        # node.py canonicalises the CI configuration value itself, like the shell resolver.
        self.assertEqual(self.python_rules(str(self.alias))[2], str(self.runtime))
        self.assertEqual(self.python_rules(str(self.linked))[2], None)
        self.assertEqual(self.python_rules(str(self.release))[2], None)

    def test_node_refuses_a_second_runtime_source(self):
        config = {"runtime": str(self.alias)}
        with mock.patch.dict(os.environ, {"KAILO_RUNTIME_DIR": str(self.runtime)}):
            self.assertEqual(self.node.runtime_dir(config), str(self.runtime))
        with mock.patch.dict(os.environ, {"KAILO_RUNTIME_DIR": str(self.release)}):
            with self.assertRaises(self.node.NodeError):
                self.node.runtime_dir(config)

    def test_openbao_token_is_read_from_the_runtime_not_the_working_directory(self):
        env = {**ENV, "KAILO_RUNTIME_DIR": str(self.runtime)}
        previous = os.getcwd()
        try:
            # The operator runs from the release tree (bootstrap.sh cds to deploy/local).
            os.chdir(self.release)
            self.assertEqual(delivery.Bao(env, "tenants/x").token, "fixture-root-token")
            self.assertEqual(self.reader.Bao(env, "tenants/x").token, "fixture-root-token")
            # Linked trees, relative and aliased values never reach the token.
            for value in (str(self.linked), str(self.alias), "."):
                with self.assertRaises(delivery.Refused):
                    delivery.Bao({**ENV, "KAILO_RUNTIME_DIR": value}, "tenants/x")
                with self.assertRaises(self.reader.Refused):
                    self.reader.Bao({**ENV, "KAILO_RUNTIME_DIR": value}, "tenants/x")
        finally:
            os.chdir(previous)
        # Owner-only and regular-file checks still apply, now to the real runtime file.
        token = self.runtime / "secrets" / "openbao_init.json"
        token.chmod(0o644)
        with self.assertRaises(delivery.Refused):
            delivery.Bao(env, "tenants/x")
        token.chmod(0o600)
        token.rename(self.work / "elsewhere.json")
        token.symlink_to(self.work / "elsewhere.json")
        with self.assertRaises(delivery.Refused):
            delivery.Bao(env, "tenants/x")

    def test_compose_reads_the_runtime_env_and_keeps_the_variable_through_sudo(self):
        env = {**ENV, "KAILO_RUNTIME_DIR": str(self.runtime)}
        command = delivery.compose(env, "ps")
        self.assertEqual(command, ["sudo", "-n", "--preserve-env=KAILO_RUNTIME_DIR", "docker", "compose",
                                   "--env-file", str(self.runtime / ".env"), "-f", "compose.yaml", "ps"])
        self.assertEqual(delivery.compose_env(env)["KAILO_RUNTIME_DIR"], str(self.runtime))
        with self.assertRaises(delivery.Refused):
            delivery.compose({**ENV, "KAILO_RUNTIME_DIR": str(self.linked)}, "ps")

    def test_deploy_entries_never_link_or_locate_runtime_by_working_directory(self):
        entries = sorted({*ROOT.glob("deploy/local/*.sh"), *ROOT.glob("deploy/components/*.sh"),
                          *ROOT.glob("deploy/components/*.py"), *ROOT.glob("data-query/docker/query-secrets/*.py"),
                          ROOT / "tools/release/node.py"} - {Path(__file__).resolve()})
        forbidden = {
            "links into a tree": r"\bln\s+-s|symlink_to\(",
            "current-directory runtime": r"Path\.cwd\(\)",
            "relative .env": r"(^|[;&|(]\s*)\.\s+\./\.env\b|--env-file\s+\.env\b|\"--env-file\",\s*\"\.env\"",
            "sudo drops KAILO_RUNTIME_DIR": r"sudo -n (-H )?docker compose|\"sudo\", \"-n\", (\"-H\", )?\"docker\", \"compose\"",
        }
        found = [f"{path.relative_to(ROOT)}:{number}: {reason}"
                 for path in entries
                 for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1)
                 if not line.lstrip().startswith("#")
                 for reason, pattern in forbidden.items() if re.search(pattern, line)]
        self.assertEqual(found, [])
        for path in ROOT.glob("deploy/local/*.sh"):
            if path.name not in ("runtime-dir.sh", "database-url.sh"):
                self.assertIn("\n. ./runtime-dir.sh\n", path.read_text(encoding="utf-8"), path.name)


if __name__ == "__main__":
    unittest.main()
