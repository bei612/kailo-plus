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


if __name__ == "__main__":
    unittest.main()
