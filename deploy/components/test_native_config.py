"""DD-127(7) / DD-128: the native Wren config.yaml is rendered from the repository
template and declarative deployment facts, never maintained by hand.

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


if __name__ == "__main__":
    unittest.main()
