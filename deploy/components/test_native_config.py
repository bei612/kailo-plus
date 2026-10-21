"""DD-127(7) / DD-128 / DD-132: the native Wren config.yaml, the WeKnora built-in model
declaration and the DocumentServer local.json are rendered from repository templates
and declarative deployment facts, never maintained by hand.

Run: python3 -I -B -m unittest discover -s deploy/components -p test_native_config.py
(from the apps root; needs PyYAML). No Docker, OpenBao or Core database is contacted.
"""

import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest
from uuid import uuid4

import yaml

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


native = load("native_config", HERE / "native-config.py")

CHAT, EMBED = str(uuid4()), str(uuid4())
FACTS = {"WREN_MODEL_CHAT_ID": CHAT, "WREN_MODEL_CHAT_CONTEXT_WINDOW": "32768",
         "WREN_MODEL_EMBEDDING_ID": EMBED, "WREN_MODEL_EMBEDDING_DIM": "2560",
         "WREN_MODEL_API_KEY_NAME": "KAILO_MODEL_API_KEY"}
PLATFORM = ("AGENTGATEWAY_MODEL_HOST=agentgateway\nAGENTGATEWAY_MODEL_PORT=18081\n"
            "AGENTGATEWAY_MODEL_BASE_URL=http://${AGENTGATEWAY_MODEL_HOST}:${AGENTGATEWAY_MODEL_PORT}/v1\n"
            "SOME_SECRET_FILE=/run/secrets/x\n")
BASE = "http://agentgateway:18081/v1"


def private(path, text):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        stream.write(text)


class Render(unittest.TestCase):
    def setUp(self):
        self.work = Path(tempfile.mkdtemp()).resolve()
        self.runtime = self.work / "runtime"
        self.project = self.work / "data-query"
        self.backup = self.work / "backup"
        for directory in (self.runtime, self.project, self.backup):
            directory.mkdir(mode=0o700)
        private(self.runtime / ".env", PLATFORM)
        self.environ = {"KAILO_RUNTIME_DIR": str(self.runtime)}
        self.env_file = self.project / "native.env"
        self.write_env(FACTS)

    def tearDown(self):
        subprocess.run(["rm", "-rf", "--", str(self.work)], check=True)

    def write_env(self, facts, **extra):
        lines = {"WREN_COMPOSE_PROJECT_NAME": "platform-local-wren-native", "WREN_PROJECT_DIR": str(self.project),
                 "WREN_POSTHOG_API_KEY": "", **facts, **extra}
        private(self.env_file, "".join(f"{k}={v}\n" for k, v in lines.items()))

    def run_native(self, operation, *, backup=True, source=""):
        argv = [operation, "data-query", "--env", str(self.env_file)]
        if source:
            argv += ["--source", source]
        if backup:
            argv += ["--backup-dir", str(self.backup)]
        errors = io.StringIO()
        with contextlib.redirect_stderr(errors):
            result = native.main(argv, self.environ)
        return result, errors.getvalue()

    @property
    def config(self):
        return self.project / "config.yaml"

    def documents(self):
        return list(yaml.safe_load_all(self.config.read_text(encoding="utf-8")))

    def test_render_fills_every_fact_into_the_template_shape(self):
        result, _ = self.run_native("apply", source="a" * 40)
        self.assertEqual((result["changed"], result["written"]), (True, True))
        self.assertEqual(self.config.stat().st_mode & 0o777, 0o600)
        docs = native.identify(self.documents())
        llm = docs["llm/litellm_llm"]
        self.assertEqual(llm["timeout"], 600)
        self.assertEqual(llm["models"], [{"alias": "default", "model": "openai/" + CHAT, "context_window_size": 32768,
                                          "api_base": BASE, "api_key_name": "KAILO_MODEL_API_KEY",
                                          "kwargs": {"max_tokens": 8192, "n": 1, "seed": 0, "temperature": 0}}])
        self.assertEqual(docs["embedder/litellm_embedder"]["models"],
                         [{"model": "openai/" + EMBED, "alias": "default", "api_base": BASE,
                           "api_key_name": "KAILO_MODEL_API_KEY", "timeout": 120}])
        store = docs["document_store/qdrant"]
        self.assertEqual((store["embedding_model_dim"], store["recreate_index"]), (2560, False))
        self.assertIs(docs["settings"]["settings"]["langfuse_enable"], False)
        text = self.config.read_text(encoding="utf-8")
        self.assertNotIn("${", text)
        self.assertIn("config.template.yaml at " + "a" * 40, text.splitlines()[0])
        # The rendered file satisfies the materialize-wren consumer rule unchanged.
        self.assertEqual(native.delivery.wren_models(self.documents(), BASE, [CHAT, EMBED]), ["KAILO_MODEL_API_KEY"])

    def test_template_placeholders_are_exactly_the_declared_facts(self):
        text = native.SPECS["data-query"]["template"].read_text(encoding="utf-8")
        body = "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("#"))
        self.assertEqual(set(re.findall(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}", body)), set(native.SPECS["data-query"]["facts"]))

    def test_a_missing_or_malformed_fact_refuses_and_writes_nothing(self):
        cases = [{k: v for k, v in FACTS.items() if k != name} for name in FACTS]
        cases += [{**FACTS, name: ""} for name in FACTS]
        cases += [{**FACTS, "WREN_MODEL_EMBEDDING_DIM": "2560x"}, {**FACTS, "WREN_MODEL_EMBEDDING_DIM": "0"},
                  {**FACTS, "WREN_MODEL_CHAT_CONTEXT_WINDOW": "-1"},
                  {**FACTS, "WREN_MODEL_CHAT_ID": "<to-fill:chat-route-native-id>"},
                  {**FACTS, "WREN_MODEL_CHAT_ID": "a b"}, {**FACTS, "WREN_MODEL_CHAT_ID": "$(id)"},
                  {**FACTS, "WREN_MODEL_API_KEY_NAME": "1KEY"}]
        for facts in cases:
            with self.subTest(facts=sorted(set(FACTS.items()) ^ set(facts.items()))):
                self.write_env(facts)
                for operation in ("check", "apply"):
                    with self.assertRaises(native.Refused):
                        self.run_native(operation)
                    self.assertFalse(os.path.lexists(self.config))

    def test_the_platform_gateway_address_is_required_and_declarative(self):
        for env in ("AGENTGATEWAY_MODEL_HOST=agentgateway\n",
                    "AGENTGATEWAY_MODEL_BASE_URL=http://${MISSING}/v1\n",
                    "AGENTGATEWAY_MODEL_BASE_URL=http://$(hostname)/v1\n",
                    "AGENTGATEWAY_MODEL_BASE_URL=${AGENTGATEWAY_MODEL_BASE_URL}\n",
                    "AGENTGATEWAY_MODEL_BASE_URL=ftp://agentgateway/v1\n"):
            with self.subTest(env=env):
                private(self.runtime / ".env", env)
                with self.assertRaises(native.Refused):
                    self.run_native("apply")
                self.assertFalse(os.path.lexists(self.config))

    def test_the_runtime_directory_is_required(self):
        self.environ = {}
        with self.assertRaises(native.Refused):
            self.run_native("check")

    def test_apply_is_idempotent_and_check_never_writes(self):
        result, _ = self.run_native("check")
        self.assertEqual((result["changed"], result["written"]), (True, False))
        self.assertFalse(os.path.lexists(self.config))
        self.run_native("apply")
        before = self.config.stat()
        for operation in ("apply", "check", "apply"):
            result, errors = self.run_native(operation)
            self.assertEqual((result["changed"], result["written"], result["keys"]), (False, False, []))
            self.assertIn("semantically equal", errors)
        after = self.config.stat()
        self.assertEqual((before.st_ino, before.st_mtime_ns), (after.st_ino, after.st_mtime_ns))
        self.assertEqual(list(self.backup.iterdir()), [])

    def test_a_hand_edited_file_is_replaced_atomically_and_reported_by_key_name_only(self):
        self.run_native("apply")
        rendered = self.config.read_text(encoding="utf-8")
        docs = self.documents()
        store = native.identify(docs)["document_store/qdrant"]
        store["embedding_model_dim"] = 3072
        store["hand_added"] = "zz-hand-value"
        native.identify(docs)["settings"]["settings"]["langfuse_enable"] = True
        edited = yaml.safe_dump_all(docs, sort_keys=False, explicit_start=True)
        native.delivery.write(self.config, edited)
        inode = self.config.stat().st_ino
        result, errors = self.run_native("apply")
        self.assertEqual((result["changed"], result["written"]), (True, True))
        self.assertEqual(sorted(result["keys"]), ["- document_store/qdrant.hand_added",
                                                  "~ document_store/qdrant.embedding_model_dim",
                                                  "~ settings.settings.langfuse_enable"])
        for value in ("3072", "2560", "zz-hand-value", "True", "true", "False", CHAT):
            self.assertNotIn(value, errors)
        self.assertNotEqual(self.config.stat().st_ino, inode)  # os.replace, never truncate in place
        self.assertEqual(self.config.read_text(encoding="utf-8"), rendered)
        self.assertEqual((self.backup / "config.yaml").read_text(encoding="utf-8"), edited)
        self.assertEqual((self.backup / "config.yaml").stat().st_mode & 0o777, 0o600)

    def test_a_semantically_equal_file_is_normalised_without_a_semantic_change(self):
        self.run_native("apply")
        docs = self.documents()
        native.delivery.write(self.config, "# hand formatted\n" + yaml.safe_dump_all(docs, sort_keys=True))
        result, _ = self.run_native("apply")
        self.assertEqual((result["changed"], result["written"], result["keys"]), (False, True, []))
        self.assertEqual(self.documents(), docs)

    def test_replacing_an_existing_file_needs_a_backup_directory(self):
        self.run_native("apply")
        native.delivery.write(self.config, "type: llm\n")
        with self.assertRaises(native.Refused):
            self.run_native("apply", backup=False)
        self.assertEqual(self.config.read_text(encoding="utf-8"), "type: llm\n")

    def test_destination_must_be_owner_only(self):
        os.chmod(self.project, 0o755)
        with self.assertRaises(native.Refused):
            self.run_native("check")
        os.chmod(self.project, 0o700)
        native.delivery.write(self.config, "type: llm\n")
        os.chmod(self.config, 0o644)
        with self.assertRaises(native.Refused):
            self.run_native("apply")

    def test_models_must_be_exactly_the_frozen_binding_projection(self):
        delivery_dir = self.work / "model-delivery"
        delivery_dir.mkdir(mode=0o700)
        binding, tenant, principal = str(uuid4()), str(uuid4()), str(uuid4())
        role = "application-model-" + binding.replace("-", "")
        locator = f"tenants/{tenant}/kv/application-model/{binding}/1"

        def frozen(models):
            private(delivery_dir / "projection.json", json.dumps({
                "bindingId": binding, "generation": 1, "tenantId": tenant, "workspaceId": None,
                "gatewayPrincipalId": principal, "deliveryMode": "NATIVE_PAGE", "nativeModels": models,
                "routeResourceIds": models, "serviceSecretRef": {"locator": locator, "version": 1, "audience": role},
                "secretRef": {"locator": locator, "version": 1},
                "secretReader": {"roleName": role, "audience": role, "servicePrincipalId": principal}}))

        self.write_env(FACTS, WREN_NATIVE_MODEL_DELIVERY_DIR=str(delivery_dir))
        frozen([CHAT, EMBED])
        self.assertTrue(self.run_native("apply")[0]["written"])
        frozen([CHAT, str(uuid4())])
        with self.assertRaises(native.Refused):
            self.run_native("check")

    def test_deploy_entry_checks_before_any_change_and_renders_before_compose_up(self):
        script = (HERE / "component-deploy.sh").read_text(encoding="utf-8")
        branch = script[script.index("  data-query)"):script.index("  *) echo \"未知组件")]
        check = branch.index('"${render[@]}" check data-query')
        apply = branch.index('"${render[@]}" apply data-query')
        self.assertLess(check, branch.index('"${compose[@]}" config --quiet'))
        self.assertLess(check, branch.index("备份 Wren 原生 UI 数据卷"))
        self.assertLess(apply, branch.index('"${compose[@]}" up -d --no-build --pull never --wait'))
        self.assertIn("--force-recreate --wait --wait-timeout 900 wren-ai-service", branch)


KNOWLEDGE_FACTS = {"KNOWLEDGE_MODEL_CHAT_ID": CHAT, "KNOWLEDGE_MODEL_EMBEDDING_ID": EMBED,
                   "KNOWLEDGE_MODEL_EMBEDDING_DIM": "2560", "KNOWLEDGE_MODEL_API_KEY_NAME": "KAILO_MODEL_API_KEY"}


class RenderKnowledge(unittest.TestCase):
    """DD-128(5), SF-WEK-17: the WeKnora built-in model declaration comes from the same
    renderer and passes the same rule materialize-weknora applies to the deployed file."""

    def setUp(self):
        self.work = Path(tempfile.mkdtemp()).resolve()
        self.runtime = self.work / "runtime"
        self.component = self.work / "knowledge"
        self.backup = self.work / "backup"
        for directory in (self.runtime, self.component, self.backup):
            directory.mkdir(mode=0o700)
        private(self.runtime / ".env", PLATFORM)
        self.environ = {"KAILO_RUNTIME_DIR": str(self.runtime)}
        self.env_file = self.component / "native.env"
        self.declaration = self.component / "builtin_models.yaml"
        self.write_env(KNOWLEDGE_FACTS)

    def tearDown(self):
        subprocess.run(["rm", "-rf", "--", str(self.work)], check=True)

    def write_env(self, facts, **extra):
        # A Compose env file: values are literal, never shell (one with a space must stay inert).
        lines = {"KAILO_FRAME_ANCESTORS": "http://a.example http://b.example",
                 "KNOWLEDGE_BUILTIN_MODELS_FILE": str(self.declaration), **facts, **extra}
        private(self.env_file, "".join(f"{k}={v}\n" for k, v in lines.items()))

    def run_native(self, operation, *, backup=True):
        argv = [operation, "knowledge", "--env", str(self.env_file)] + (["--backup-dir", str(self.backup)] if backup else [])
        errors = io.StringIO()
        with contextlib.redirect_stderr(errors):
            result = native.main(argv, self.environ)
        return result, errors.getvalue()

    def frozen(self, models):
        directory = self.work / "model-delivery"
        directory.mkdir(mode=0o700, exist_ok=True)
        binding, tenant, principal = str(uuid4()), str(uuid4()), str(uuid4())
        role = "application-model-" + binding.replace("-", "")
        locator = f"tenants/{tenant}/kv/application-model/{binding}/1"
        private(directory / "projection.json", json.dumps({
            "bindingId": binding, "generation": 1, "tenantId": tenant, "workspaceId": None,
            "gatewayPrincipalId": principal, "deliveryMode": "NATIVE_PAGE", "nativeModels": models,
            "routeResourceIds": [str(uuid4()) for _ in models],
            "serviceSecretRef": {"locator": locator, "version": 1, "audience": role},
            "secretRef": {"locator": locator, "version": 1},
            "secretReader": {"roleName": role, "audience": role, "servicePrincipalId": principal}}))
        return directory

    def test_render_publishes_a_readable_declaration_that_materialize_weknora_accepts(self):
        self.write_env(KNOWLEDGE_FACTS, KNOWLEDGE_NATIVE_MODEL_DELIVERY_DIR=str(self.frozen([CHAT, EMBED])))
        result, _ = self.run_native("apply")
        self.assertEqual((result["changed"], result["written"]), (True, True))
        # No secret inside; the non-root native process must read it. Never writable by others.
        self.assertEqual(self.declaration.stat().st_mode & 0o777, 0o644)
        text = self.declaration.read_text(encoding="utf-8")
        self.assertEqual(re.findall(r"\$\{([^}]*)\}", text), ["KAILO_MODEL_API_KEY"] * 2)
        self.assertEqual(len(re.findall(r'^ +api_key: "\$\{KAILO_MODEL_API_KEY\}"$', text, re.M)), 2)
        (entries,) = [d["builtin_models"] for d in yaml.safe_load_all(text)]
        self.assertEqual([(e["id"], e["name"], e["type"], e["parameters"]["base_url"]) for e in entries],
                         [("kailo-platform-chat", CHAT, "KnowledgeQA", BASE),
                          ("kailo-platform-embedding", EMBED, "Embedding", BASE)])
        self.assertEqual(entries[1]["parameters"]["embedding_parameters"], {"dimension": 2560})
        # The very function materialize-weknora runs on the deployed file.
        projection = {"nativeModels": [CHAT, EMBED]}
        self.assertEqual(native.delivery.weknora_consumers(self.declaration, projection, BASE), ["KAILO_MODEL_API_KEY"])

    def test_template_placeholders_are_exactly_the_declared_facts(self):
        text = native.SPECS["knowledge"]["template"].read_text(encoding="utf-8")
        body = "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("#"))
        self.assertEqual(set(re.findall(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}", body)), set(native.SPECS["knowledge"]["facts"]))
        self.assertNotIn("${", "\n".join(line for line in text.splitlines() if line.lstrip().startswith("#")))

    def test_a_missing_or_malformed_fact_refuses_and_writes_nothing(self):
        cases = [{k: v for k, v in KNOWLEDGE_FACTS.items() if k != name} for name in KNOWLEDGE_FACTS]
        cases += [{**KNOWLEDGE_FACTS, name: ""} for name in KNOWLEDGE_FACTS]
        cases += [{**KNOWLEDGE_FACTS, "KNOWLEDGE_MODEL_EMBEDDING_DIM": "0"},
                  {**KNOWLEDGE_FACTS, "KNOWLEDGE_MODEL_EMBEDDING_DIM": "<to-fill>"},
                  {**KNOWLEDGE_FACTS, "KNOWLEDGE_MODEL_CHAT_ID": "$(id)"},
                  {**KNOWLEDGE_FACTS, "KNOWLEDGE_MODEL_API_KEY_NAME": "DB_PASSWORD"},
                  {**KNOWLEDGE_FACTS, "KNOWLEDGE_MODEL_API_KEY_NAME": "${KAILO_MODEL_API_KEY}"}]
        for facts in cases:
            with self.subTest(facts=sorted(set(KNOWLEDGE_FACTS.items()) ^ set(facts.items()))):
                self.write_env(facts)
                for operation in ("check", "apply"):
                    with self.assertRaises(native.Refused):
                        self.run_native(operation)
                    self.assertFalse(os.path.lexists(self.declaration))
        private(self.runtime / ".env", "AGENTGATEWAY_MODEL_HOST=agentgateway\n")
        self.write_env(KNOWLEDGE_FACTS)
        with self.assertRaises(native.Refused):
            self.run_native("apply")
        self.assertFalse(os.path.lexists(self.declaration))

    def test_models_must_be_exactly_the_frozen_binding_projection(self):
        self.write_env(KNOWLEDGE_FACTS, KNOWLEDGE_NATIVE_MODEL_DELIVERY_DIR=str(self.frozen([CHAT, str(uuid4())])))
        for operation in ("check", "apply"):
            with self.assertRaises(native.Refused):
                self.run_native(operation)
        self.assertFalse(os.path.lexists(self.declaration))

    def test_apply_is_idempotent_and_a_changed_file_is_backed_up_by_key_name_only(self):
        result, _ = self.run_native("check")
        self.assertEqual((result["changed"], result["written"]), (True, False))
        self.assertFalse(os.path.lexists(self.declaration))
        self.run_native("apply")
        rendered = self.declaration.read_text(encoding="utf-8")
        before = self.declaration.stat()
        for operation in ("apply", "check"):
            result, errors = self.run_native(operation)
            self.assertEqual((result["changed"], result["written"], result["keys"]), (False, False, []))
        after = self.declaration.stat()
        self.assertEqual((before.st_ino, before.st_mtime_ns), (after.st_ino, after.st_mtime_ns))
        self.assertEqual(list(self.backup.iterdir()), [])
        # A new measured dimension: replaced atomically, previous file kept, key names only.
        self.write_env({**KNOWLEDGE_FACTS, "KNOWLEDGE_MODEL_EMBEDDING_DIM": "3072"})
        result, errors = self.run_native("apply")
        self.assertEqual((result["changed"], result["written"]), (True, True))
        self.assertEqual(len(result["keys"]), 1)
        self.assertTrue(result["keys"][0].startswith("~ ") and result["keys"][0].endswith("embedding_parameters.dimension"))
        for value in ("3072", "2560", CHAT, EMBED):
            self.assertNotIn(value, errors)
        self.assertNotEqual(self.declaration.stat().st_ino, before.st_ino)
        self.assertEqual(self.declaration.stat().st_mode & 0o777, 0o644)
        self.assertEqual((self.backup / "builtin_models.yaml").read_text(encoding="utf-8"), rendered)
        self.assertEqual((self.backup / "builtin_models.yaml").stat().st_mode & 0o777, 0o600)
        # Replacing an existing declaration needs a backup directory.
        self.write_env({**KNOWLEDGE_FACTS, "KNOWLEDGE_MODEL_EMBEDDING_DIM": "1024"})
        with self.assertRaises(native.Refused):
            self.run_native("apply", backup=False)

    def test_destination_must_be_in_an_owner_only_directory_and_not_writable_by_others(self):
        for value in ("builtin_models.yaml", str(self.component) + "/", str(self.work / "absent" / "b.yaml")):
            with self.subTest(value=value):
                self.write_env(KNOWLEDGE_FACTS, KNOWLEDGE_BUILTIN_MODELS_FILE=value)
                with self.assertRaises(native.Refused):
                    self.run_native("check")
        self.write_env(KNOWLEDGE_FACTS)
        os.chmod(self.component, 0o755)
        with self.assertRaises(native.Refused):
            self.run_native("check")
        os.chmod(self.component, 0o700)
        self.run_native("apply")
        os.chmod(self.declaration, 0o664)
        with self.assertRaises(native.Refused):
            self.run_native("apply")

    def test_deploy_entry_checks_before_any_change_and_renders_before_compose_up(self):
        script = (HERE / "component-deploy.sh").read_text(encoding="utf-8")
        branch = script[script.index("  knowledge)"):script.index("  data-query)")]
        check = branch.index('"${render[@]}" check knowledge')
        apply = branch.index('"${render[@]}" apply knowledge')
        for later in ('ensure_image', 'if "$check"; then', "backup_pg ", 'bash "$here/start.sh"'):
            self.assertLess(check, branch.index(later), later)
        self.assertLess(branch.index("backup_pg "), apply)
        self.assertLess(apply, branch.index('bash "$here/start.sh" --native-env "$ENV"\n'))


DOCUMENT_EDITOR_FACTS = {"DOCUMENT_EDITOR_PUBLIC_ORIGIN": "http://192.168.0.193:58096",
                         "DOCUMENT_EDITOR_WOPI_SOURCE_ORIGIN": "http://192.168.0.193:58092"}


class RenderDocumentEditor(unittest.TestCase):
    """DD-132(3): the DocumentServer local.json comes from the same renderer, carries
    no secret and passes the invariants the image entrypoint checks at start."""

    def setUp(self):
        self.work = Path(tempfile.mkdtemp()).resolve()
        self.component = self.work / "document-editor"
        self.backup = self.work / "backup"
        for directory in (self.component, self.backup):
            directory.mkdir(mode=0o700)
        # No platform fact: the renderer must not need the platform runtime directory.
        self.environ = {}
        self.env_file = self.component / "native.env"
        self.local = self.component / "local.json"
        self.write_env(DOCUMENT_EDITOR_FACTS)

    def tearDown(self):
        subprocess.run(["rm", "-rf", "--", str(self.work)], check=True)

    def write_env(self, facts, **extra):
        lines = {"DOCUMENT_EDITOR_FRAME_ANCESTORS": "'http://192.168.0.193:58092 http://192.168.0.193:58090'",
                 "DOCUMENT_EDITOR_LOCAL_CONFIG_FILE": str(self.local), **facts, **extra}
        private(self.env_file, "".join(f"{k}={v}\n" for k, v in lines.items()))

    def run_native(self, operation, *, backup=True):
        argv = [operation, "document-editor", "--env", str(self.env_file)] + (["--backup-dir", str(self.backup)] if backup else [])
        errors = io.StringIO()
        with contextlib.redirect_stderr(errors):
            result = native.main(argv, self.environ)
        return result, errors.getvalue()

    def test_render_publishes_the_invariant_local_json_without_secrets(self):
        result, _ = self.run_native("apply")
        self.assertTrue(result["written"])
        self.assertEqual(self.local.stat().st_mode & 0o777, 0o644)
        config = json.loads(self.local.read_text(encoding="utf-8"))
        services = config["services"]["CoAuthoring"]
        self.assertEqual(config["wopi"], {"enable": True, "host": "http://192.168.0.193:58096"})
        self.assertEqual(config["externalRequest"]["directIfIn"], {"allowList": ["http://192.168.0.193:58092/wopi/files/"], "jwtToken": False})
        self.assertFalse(config["externalRequest"]["action"]["allow"])
        self.assertEqual(services["ipfilter"]["rules"], [{"address": "192.168.0.193", "allowed": True}, {"address": "*", "allowed": False}])
        self.assertEqual(services["token"]["enable"], {"browser": True, "request": {"inbox": True, "outbox": True}})
        for kind in ("browser", "inbox", "outbox", "session"):
            self.assertEqual(services["secret"][kind], {"string": "", "file": "/run/kailo-ds/secrets/token"})
        self.assertNotIn("storage", config)
        self.assertNotIn("secret\"", self.local.read_text(encoding="utf-8").replace('"secret":', ""))
        # The image entrypoint applies the very same rule at start.
        native.document_editor_runtime.invariants(config, "http://192.168.0.193:58096")

    def test_template_placeholders_are_exactly_the_declared_and_derived_facts(self):
        spec = native.SPECS["document-editor"]
        text = spec["template"].read_text(encoding="utf-8")
        self.assertEqual(set(re.findall(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}", text)), set(spec["facts"]) | set(spec["derived"]))

    def test_a_missing_or_malformed_fact_refuses_and_writes_nothing(self):
        for name, value in (("DOCUMENT_EDITOR_PUBLIC_ORIGIN", ""), ("DOCUMENT_EDITOR_PUBLIC_ORIGIN", "http://192.168.0.193:58096/"),
                            ("DOCUMENT_EDITOR_WOPI_SOURCE_ORIGIN", "*"), ("DOCUMENT_EDITOR_WOPI_SOURCE_ORIGIN", "ftp://cells.example"),
                            ("DOCUMENT_EDITOR_WOPI_SOURCE_ORIGIN", "http://user@cells.example")):
            with self.subTest(name=name, value=value):
                self.write_env({**DOCUMENT_EDITOR_FACTS, name: value})
                with self.assertRaises(native.Refused):
                    self.run_native("apply")
                self.assertFalse(self.local.exists())

    def test_the_rendered_file_must_keep_the_invariants(self):
        broken = {"wopi.enable": lambda c: c["wopi"].update(enable=False),
                  "allow-all ipfilter": lambda c: c["services"]["CoAuthoring"]["ipfilter"].update(rules=[{"address": "*", "allowed": True}]),
                  "jwt direct path": lambda c: c["externalRequest"]["directIfIn"].update(jwtToken=True),
                  "other outbound": lambda c: c["externalRequest"]["action"].update(allow=True),
                  "inline secret": lambda c: c["services"]["CoAuthoring"]["secret"]["inbox"].update(string="secret"),
                  "token off": lambda c: c["services"]["CoAuthoring"]["token"]["enable"].update(browser=False)}
        _, documents = native.render(native.SPECS["document-editor"], native.facts(native.SPECS["document-editor"], DOCUMENT_EDITOR_FACTS, {}), "")
        for name, change in broken.items():
            with self.subTest(name=name):
                config = json.loads(json.dumps(documents[0]))
                change(config)
                with self.assertRaises(native.Refused):
                    native.document_editor_check(DOCUMENT_EDITOR_FACTS, {}, [config], "")

    def test_apply_is_idempotent_and_a_hand_edit_is_backed_up(self):
        self.run_native("apply")
        result, _ = self.run_native("apply")
        self.assertFalse(result["written"])
        self.assertFalse(result["changed"])
        edited = json.loads(self.local.read_text(encoding="utf-8"))
        edited["wopi"]["host"] = "http://elsewhere.example"
        os.chmod(self.local, 0o644)
        self.local.write_text(json.dumps(edited), encoding="utf-8")
        result, errors = self.run_native("apply")
        self.assertTrue(result["changed"] and result["written"])
        self.assertIn("~ ", errors)
        self.assertNotIn("elsewhere", errors)
        self.assertEqual(json.loads((self.backup / "local.json").read_text(encoding="utf-8"))["wopi"]["host"], "http://elsewhere.example")

    def test_deploy_entry_checks_before_any_change_and_renders_before_start(self):
        script = (HERE / "component-deploy.sh").read_text(encoding="utf-8")
        branch = script[script.index("  document-editor)"):script.index("  *) echo \"未知组件")]
        check = branch.index('"${render[@]}" check document-editor')
        apply = branch.index('"${render[@]}" apply document-editor')
        self.assertLess(branch.index('"$adapter" && '), check)
        for later in ("ensure_image", 'if "$check"; then', "mkdir -p \"$dir\""):
            self.assertLess(check, branch.index(later), later)
        self.assertLess(apply, branch.index('bash "$here/start.sh" --force-recreate "$ENV"'))
        self.assertLess(apply, branch.index('bash "$here/start.sh" "$ENV"'))


if __name__ == "__main__":
    unittest.main()
