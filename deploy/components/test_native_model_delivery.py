"""DD-128(5) / V-SCN-173: operator delivery of a native page entry model key.

Run: python3 -I -m unittest deploy/components/test_native_model_delivery.py
(from the apps root). No OpenBao, Docker or Core database is contacted.
"""

import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from uuid import uuid4

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("native_model_delivery", HERE / "native-model-delivery.py")
delivery = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(delivery)

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


class Delivery(unittest.TestCase):
    def setUp(self):
        self.work = Path(tempfile.mkdtemp())
        self.dir = self.work / "delivery"
        self.dir.mkdir(mode=0o700)
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
        calls = []

        def runner(row):
            def run(command, **kwargs):
                calls.append(command)
                return subprocess.CompletedProcess(command, 0, json.dumps(row) + "\n", "")
            return run

        row = {"state": "ACTIVE", "modelCallMode": "PLATFORM_LLM_ROUTE", "nativePage": True,
               "componentTypeKey": "wren", "modelState": "ACTIVE", "projection": self.value}
        result = delivery.export(ENV, str(self.dir), self.value["bindingId"], runner(row))
        self.assertEqual(result["generation"], 1)
        self.assertIn("PGOPTIONS=-c default_transaction_read_only=on", calls[0])
        self.assertEqual(json.loads((self.dir / "projection.json").read_text()), self.value)
        self.assertEqual(os.stat(self.dir / "projection.json").st_mode & 0o777, 0o600)
        # Re-export of the same generation is idempotent; another one is refused.
        delivery.export(ENV, str(self.dir), self.value["bindingId"], runner(row))
        for refused in ({**row, "state": "DISABLING"}, {**row, "nativePage": False},
                        {**row, "modelState": "PENDING"},
                        {**row, "projection": {**self.value, "generation": 2}}):
            with self.assertRaises(delivery.Refused):
                delivery.export(ENV, str(self.dir), self.value["bindingId"], runner(refused))
        with self.assertRaises(delivery.Refused):
            delivery.export(ENV, str(self.dir), "not-a-uuid", runner(row))

    def test_prepare_creates_only_the_exact_read_policy_and_one_use_role(self):
        self.write_projection()
        result = delivery.prepare(ENV, str(self.dir), self.factory)
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
            delivery.prepare(ENV, str(self.dir), self.factory)

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
        names = delivery.wren_consumers(self.config(), self.value, ENV["AGENTGATEWAY_MODEL_BASE_URL"])
        self.assertEqual(names, ["KAILO_MODEL_API_KEY"])
        for config in (self.config(base="https://provider.example/v1"),
                       self.config(models=("chat-route", "other-route"))):
            with self.assertRaises(delivery.Refused):
                delivery.wren_consumers(config, self.value, ENV["AGENTGATEWAY_MODEL_BASE_URL"])

    def credential(self, **change):
        material = {"bindingId": self.value["bindingId"], "generation": 1,
                    "requestId": str(uuid4()), "version": 1, "value": "ab" * 32, **change}
        private(self.dir / "credential.json", json.dumps(material))

    def test_materialize_publishes_only_the_named_key_and_drops_the_render(self):
        self.write_projection()
        destination = self.work / "ai.env"
        private(destination, "")
        self.credential()
        result = delivery.materialize(ENV, str(self.dir), str(destination), ["KAILO_MODEL_API_KEY"])
        self.assertEqual(result["keyNames"], ["KAILO_MODEL_API_KEY"])
        self.assertNotIn("value", json.dumps(result))
        self.assertEqual(destination.read_text(), 'KAILO_MODEL_API_KEY="' + "ab" * 32 + '"\n')
        self.assertEqual(os.stat(destination).st_mode & 0o777, 0o600)
        self.assertFalse((self.dir / "credential.json").exists())
        # Another generation's render and unrelated env content are refused.
        self.credential(generation=2)
        with self.assertRaises(delivery.Refused):
            delivery.materialize(ENV, str(self.dir), str(destination), ["KAILO_MODEL_API_KEY"])
        self.credential()
        private(destination, "OPENAI_API_KEY=sk-provider\n")
        with self.assertRaises(delivery.Refused):
            delivery.materialize(ENV, str(self.dir), str(destination), ["KAILO_MODEL_API_KEY"])
        self.assertEqual(destination.read_text(), "OPENAI_API_KEY=sk-provider\n")

    def test_retire_removes_the_reader_and_local_handoff(self):
        self.write_projection()
        delivery.prepare(ENV, str(self.dir), self.factory)
        delivery.retire(ENV, str(self.dir), self.factory)
        role = self.value["secretReader"]["roleName"]
        self.assertNotIn("auth/approle/role/" + role, self.bao["objects"])
        self.assertNotIn("sys/policies/acl/" + role, self.bao["objects"])
        self.assertEqual(sorted(os.listdir(self.dir)), ["projection.json"])


if __name__ == "__main__":
    unittest.main()
