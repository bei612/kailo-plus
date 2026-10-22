"""Pure parts of the CI node release stages (ADR-20): python3 -I -m unittest discover -s tools/release"""
import importlib.util
import os
import sys
import unittest

sys.dont_write_bytecode = True
_spec = importlib.util.spec_from_file_location("release_node", os.path.join(os.path.dirname(__file__), "node.py"))
node = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(node)

PIN = "sha256:" + "e" * 64
REF = "127.0.0.1:55000/metering@" + PIN


class JudgeImage(unittest.TestCase):
    def test_containerd_store_image_id_is_the_manifest_digest(self):
        self.assertEqual(node.judge_image(PIN, REF, PIN, PIN, True), [])

    def test_graph_driver_config_id_differs_from_the_pin(self):
        config = "sha256:" + "c" * 64
        self.assertEqual(node.judge_image(PIN, REF, config, config, True), [])

    def test_reference_must_carry_the_pin(self):
        other = "127.0.0.1:55000/metering@sha256:" + "a" * 64
        self.assertIn("运行镜像引用与 pin 不一致", node.judge_image(PIN, other, PIN, PIN, True))

    def test_local_resolution_must_be_the_running_image(self):
        self.assertIn("pin 引用解析出的镜像与容器运行镜像不同",
                      node.judge_image(PIN, REF, PIN, "sha256:" + "b" * 64, True))
        self.assertIn("本节点无法解析 pin 引用", node.judge_image(PIN, REF, PIN, None, True))

    def test_a_local_only_image_is_not_reproducible(self):
        self.assertIn("产物不在 registry，不可复现", node.judge_image(PIN, REF, PIN, PIN, False))
        self.assertIn("无法确认产物在 registry 中", node.judge_image(PIN, REF, PIN, PIN, None))


class RegistryReference(unittest.TestCase):
    def test_references_without_a_registry_host_are_unknown(self):
        self.assertIsNone(node.registry_has("metering@" + PIN))
        self.assertIsNone(node.registry_has("local/metering@" + PIN))
        self.assertIsNone(node.registry_has("127.0.0.1:55000/metering:tag"))

    def test_unreachable_registry_is_unknown_not_absent(self):
        self.assertIsNone(node.registry_has("127.0.0.1:9/metering@" + PIN, timeout=1))


class ConfigOneoffs(unittest.TestCase):
    def test_digest_follows_config_content_and_skips_deliveries(self):
        import tempfile
        _mspec = importlib.util.spec_from_file_location("release_model", os.path.join(os.path.dirname(__file__), "model.py"))
        model = importlib.util.module_from_spec(_mspec)
        _mspec.loader.exec_module(model)
        with tempfile.TemporaryDirectory() as tmp:
            os.makedirs(os.path.join(tmp, "authorization"))
            with open(os.path.join(tmp, "authorization", "schema.zed"), "w") as stream:
                stream.write("definition principal {}\n")
            text = """
services:
  spicedb-schema: {restart: "no", configs: [{source: spicedb_schema, target: /etc/schema.zed}]}
  runtime-oneoff: {restart: "no", configs: [delivered]}
  long-running: {configs: [spicedb_schema]}
configs:
  spicedb_schema: {file: ./authorization/schema.zed}
  delivered: {file: "${KAILO_RUNTIME_DIR:-.}/secrets/x"}
"""
            first = model.config_oneoffs(text, tmp)
            self.assertEqual(list(first), ["spicedb-schema"])
            self.assertEqual(model.config_oneoffs(text, tmp), first)
            with open(os.path.join(tmp, "authorization", "schema.zed"), "a") as stream:
                stream.write("definition tenant {}\n")
            self.assertNotEqual(model.config_oneoffs(text, tmp), first)


def _model():
    spec = importlib.util.spec_from_file_location("release_model_peers", os.path.join(os.path.dirname(__file__), "model.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


PEER_DIGEST = "d" * 64
PEER_COMPOSE = f"""
services:
  core-bff: {{image: "${{REGISTRY_HOST:?x}}/core@sha256:{'a' * 64}"}}
  protocol-peer-reference: {{image: "vendor/peer@sha256:{PEER_DIGEST}", restart: unless-stopped}}
  tagged: {{image: "vendor/peer:latest"}}
  oneoff: {{image: "vendor/peer@sha256:{PEER_DIGEST}", restart: "no"}}
"""


class OperatedAndPeerDelivery(unittest.TestCase):
    """ADR-20 §8: operated runtimes and the protocolPeers / conformance delivery declaration."""

    def setUp(self):
        import json
        import tempfile
        self.json = json
        self.model = _model()
        self.services = self.model.compose_services(PEER_COMPOSE)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.peer = {"adapterServiceRef": "protocol-peer-reference", "mcpUrl": "http://protocol-peer-reference:3001/mcp",
                     "nativeInstanceRef": "protocol-peer-reference", "artifactDigest": PEER_DIGEST,
                     "timeoutSeconds": 10, "maxResponseBytes": 262144, "bindings": []}
        self.conformance = {"artifactDigest": PEER_DIGEST, "mcpUrl": self.peer["mcpUrl"], "timeoutSeconds": 10,
                            "maxResponseBytes": 262144, "maxSteps": 16, "readOnlyTools": ["echo"],
                            "initializeResultJson": json.dumps({"protocolVersion": "2025-11-25"}),
                            "listResultJson": json.dumps({"tools": [{"name": "echo"}, {"name": "get-env"}]})}
        self.write()

    def write(self, directory=None, conformance=None):
        for name, value in (("directory.json", directory or {"protocolPeers": [self.peer]}),
                            ("conformance.json", conformance or self.conformance)):
            with open(os.path.join(self.tmp.name, name), "w", encoding="utf-8") as stream:
                stream.write(value if isinstance(value, str) else self.json.dumps(value))

    def decl(self, **override):
        env = {"set": {"APPLICATION_ADAPTER_DIRECTORY_FILE": "${KAILO_RUNTIME_DIR}/data/protocol-peers/adapter-directory.json",
                       "COMPONENT_CONFORMANCE_ENVIRONMENT_FILE":
                           "${KAILO_RUNTIME_DIR}/data/protocol-peers/conformance-environment.json"},
               "unset": ["COMPONENT_CONFORMANCE_FIXTURE_FILE", "COMPONENT_CONFORMANCE_IDENTITY_FILE"]}
        value = {"units": {}, "services": {"core-bff": {"command": ["./start-core.sh", "--no-build"]}},
                 "migrations": {}, "order": {}, "node": {}, "env": env, "operated": ["protocol-peer-reference"],
                 "delivery": {"protocol_peers": {"directory": os.path.join(self.tmp.name, "directory.json"),
                                                 "conformance": os.path.join(self.tmp.name, "conformance.json"),
                                                 "runtime": "data/protocol-peers", "restart": "core-bff"}}}
        value.update(override)
        return value

    def refused(self, fragment, decl=None):
        with self.assertRaises(self.model.ReleaseError) as caught:
            self.model.peer_delivery(decl or self.decl(), self.services)
        self.assertIn(fragment, str(caught.exception))

    def test_operated_accepts_only_pinned_upstream_long_running_services(self):
        self.assertEqual(self.model.operated_services(self.services, self.decl()),
                         {"protocol-peer-reference": "sha256:" + PEER_DIGEST})
        for name in ("core-bff", "tagged", "oneoff", "missing"):
            with self.assertRaises(self.model.ReleaseError):
                self.model.operated_services(self.services, self.decl(operated=[name]))

    def test_valid_declaration_and_its_digest_follow_content(self):
        first = self.model.peer_delivery(self.decl(), self.services)
        self.assertEqual(first["restart"], "core-bff")
        self.assertEqual(first["peers"], [self.peer])
        self.peer["bindings"] = [{"bindingId": "11111111-1111-4111-8111-111111111111",
                                  "tenantId": "22222222-2222-4222-8222-222222222222",
                                  "servicePrincipalId": "33333333-3333-4333-8333-333333333333",
                                  "nativeScopeRef": "default", "configDigest": "c" * 64,
                                  "isolationMode": "DEDICATED_INSTANCE"}]
        self.write()
        self.assertNotEqual(self.model.peer_delivery(self.decl(), self.services)["digest"], first["digest"])

    def test_endpoint_must_be_an_operated_runtime_with_the_pinned_digest(self):
        self.write({"protocolPeers": [dict(self.peer, mcpUrl="http://vendor.example/mcp")]},
                   dict(self.conformance, mcpUrl="http://vendor.example/mcp"))
        self.refused("operated")
        self.write({"protocolPeers": [dict(self.peer, artifactDigest="e" * 64)]},
                   dict(self.conformance, artifactDigest="e" * 64))
        self.refused("artifactDigest")
        self.write({"protocolPeers": [dict(self.peer, mcpUrl="http://u:p@protocol-peer-reference:3001/mcp")]})
        self.refused("mcpUrl")

    def test_directory_owns_only_protocol_peers_and_valid_binding_facts(self):
        self.write({"adapters": [], "protocolPeers": [self.peer]})
        self.refused("protocolPeers")
        self.write({"protocolPeers": [dict(self.peer, bindings=[{"bindingId": "x"}])]})
        self.refused("binding")
        self.write('{"protocolPeers": [], "protocolPeers": []}')
        with self.assertRaises(self.model.ReleaseError):
            self.model.peer_delivery(self.decl(), self.services)

    def test_conformance_must_be_recorded_and_match_one_peer(self):
        self.write(conformance=dict(self.conformance, initializeResultJson=""))
        self.refused("record-conformance.py")
        self.write(conformance=dict(self.conformance, readOnlyTools=["get-sum"]))
        self.refused("readOnlyTools")
        self.write(conformance=dict(self.conformance, mcpUrl="http://protocol-peer-reference:3002/mcp"))
        self.refused("一个 peer")
        self.write(conformance=dict(self.conformance, extra=True))
        self.refused("ComponentProtocolPeerEnvironment")

    def test_env_keys_must_point_at_the_rendered_files_and_clear_http_only_slots(self):
        decl = self.decl()
        decl["env"]["set"]["APPLICATION_ADAPTER_DIRECTORY_FILE"] = "/elsewhere/adapter-directory.json"
        self.refused("APPLICATION_ADAPTER_DIRECTORY_FILE", decl)
        decl = self.decl()
        decl["env"]["unset"] = ["COMPONENT_CONFORMANCE_FIXTURE_FILE"]
        self.refused("env.unset", decl)
        decl = self.decl()
        decl["delivery"]["protocol_peers"]["runtime"] = "../outside"
        self.refused("runtime", decl)
        self.assertIsNone(self.model.peer_delivery(self.decl(delivery={}), self.services))

    def test_rendered_directory_keeps_component_adapters_and_refuses_collisions(self):
        adapter = {"adapterServiceRef": "knowledge-adapter"}
        rendered = self.model.render_peer_directory({"adapters": [adapter], "protocolPeers": []}, [self.peer])
        self.assertEqual(rendered, {"adapters": [adapter], "protocolPeers": [self.peer]})
        self.assertEqual(self.model.render_peer_directory(None, [self.peer])["adapters"], [])
        for existing in ({"adapters": [{"adapterServiceRef": "protocol-peer-reference"}]},
                         {"adapters": [], "other": 1}, {"protocolPeers": []}, []):
            with self.assertRaises(self.model.ReleaseError):
                self.model.render_peer_directory(existing, [self.peer])


class RepositoryPeerDeclaration(unittest.TestCase):
    """The checked-in declaration itself: operated digest, recorded expectations and env keys agree."""

    def test_release_declaration_is_consistent(self):
        model = _model()
        delivery = model.peer_delivery()
        self.assertEqual([p["adapterServiceRef"] for p in delivery["peers"]], ["protocol-peer-reference"])
        listed = {t["name"] for t in __import__("json").loads(delivery["conformance"]["listResultJson"])["tools"]}
        self.assertTrue({"echo", "get-sum"} <= listed)


if __name__ == "__main__":
    unittest.main()
