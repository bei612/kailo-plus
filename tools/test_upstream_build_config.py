"""DD-151: exercise the original build plan, record and source identity with public SDK inputs."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("upstream_manifest", Path(__file__).with_name("upstream_manifest.py"))
manifest = importlib.util.module_from_spec(spec)
spec.loader.exec_module(manifest)


class PublicBuildConfig(unittest.TestCase):
    def artifact(self):
        return dict(name="mobile-client", kind="bundle", build_context=".", build_dockerfile="mobile.Dockerfile",
                    inputs=["mobile"], build_args=["PLATFORM_DISPLAY_NAME"],
                    optional_build_args=["BUZZ_ANDROID_GOOGLE_SERVICES_JSON"], build_config_digest="none")

    def test_missing_optional_config_is_buildable_and_each_changed_public_input_changes_identity(self):
        art = self.artifact()
        with patch.dict(os.environ, {"PLATFORM_DISPLAY_NAME": "Test"}, clear=True):
            absent = manifest.public_build_config_digest(art)
            os.environ["BUZZ_ANDROID_GOOGLE_SERVICES_JSON"] = json.dumps({"project_info": {"project_id": "first"}})
            configured = manifest.public_build_config_digest(art)
            os.environ["BUZZ_ANDROID_GOOGLE_SERVICES_JSON"] = json.dumps({"project_info": {"project_id": "second"}})
            changed = manifest.public_build_config_digest(art)
            os.environ["PLATFORM_DISPLAY_NAME"] = "Other"
            renamed = manifest.public_build_config_digest(art)
        self.assertEqual(len({absent, configured, changed, renamed}), 4)
        with patch.object(manifest, "source_files", return_value=[]):
            self.assertNotEqual(manifest.source_digest(dict(art, build_config_digest=absent)),
                                manifest.source_digest(dict(art, build_config_digest=configured)))

    def test_missing_required_config_and_server_credentials_are_rejected_before_build_arguments(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(ValueError):
                manifest.public_build_config_digest(self.artifact())
        for invalid in [" ", "bad-json", "[]", '{"type":"service_account"}', '{"client":[{"private_key":"not-a-key"}]}']:
            with self.subTest(invalid=invalid), patch.dict(os.environ, {
                "PLATFORM_DISPLAY_NAME": "Test", "BUZZ_ANDROID_GOOGLE_SERVICES_JSON": invalid,
            }, clear=True), self.assertRaises(ValueError):
                manifest.public_build_config_digest(self.artifact())

    def test_optional_arguments_keep_original_name_secret_and_fact_boundaries(self):
        for changes, expected in [
            ({"optional_build_args": ["SECRET"], "build_secrets": ["SECRET"]}, "build_secrets"),
            ({"optional_build_args": ["PLATFORM_DISPLAY_NAME"]}, "重复项"),
            ({"optional_build_args": ["bad-name"]}, "只登记变量名"),
            ({"build_facts": {"BUZZ_ANDROID_GOOGLE_SERVICES_JSON": "source_commit"}}, "build_facts"),
        ]:
            art = dict(self.artifact(), artifact_digest="none", source_digest="none", **changes)
            model = dict(evidence_commit="a" * 40, implementation_base_commit="a" * 40,
                         reference_tree="buzz", artifacts=[art])
            with self.subTest(changes=changes), patch.object(manifest, "source_files", return_value=["collaboration/mobile/file"]), \
                    patch.object(os.path, "isdir", return_value=True), \
                    patch.object(os.path, "isfile", return_value=True), \
                    patch.object(os.path, "exists", return_value=True):
                problems = manifest.problems("collaboration/fork/upstream.yaml", model, check_digest=False)
            self.assertTrue(any(expected in problem for problem in problems), problems)

    def test_original_plan_and_record_use_the_same_configuration_bound_source_digest(self):
        art = self.artifact()
        model = {"implementation_base_commit": "a" * 40}
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp, "upstream.yaml")
            path.write_text("artifacts:\n  - name: mobile-client\n    build_config_digest: none\n    source_digest: none\n    artifact_digest: none\n")
            with patch.object(manifest, "resolve", return_value=(str(path), model, art)), \
                    patch.object(manifest, "problems", return_value=[]), \
                    patch.object(manifest, "source_files", return_value=[]), \
                    patch.dict(os.environ, {"PLATFORM_DISPLAY_NAME": "Test"}, clear=True):
                output = io.StringIO()
                with contextlib.redirect_stdout(output):
                    manifest.plan("mobile-client")
                expected = next(line.split("=", 1)[1] for line in output.getvalue().splitlines()
                                if line.startswith("source_build_id="))
                manifest.record("mobile-client", "sha256:" + "b" * 64)
            recorded = manifest.load(path)["artifacts"][0]
            self.assertEqual(recorded["source_digest"], expected)
            self.assertRegex(recorded["build_config_digest"], r"^sha256:[0-9a-f]{64}$")
            self.assertNotIn("Test", path.read_text())


if __name__ == "__main__":
    unittest.main()
