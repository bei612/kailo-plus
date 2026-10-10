"""Actual provider startup receipts; no live authorization or model dispatch."""

import copy
import hashlib
import hmac
import json
import os
import stat
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from uuid import UUID

os.environ["HAYSTACK_TELEMETRY_ENABLED"] = "False"

import jsonschema  # noqa: E402

from src.providers import generate_components  # noqa: E402
from src.providers.native_model_delivery import (  # noqa: E402
    ModelDeliveryUnavailable,
    NativeModelDelivery,
)


def identity(number):
    return str(UUID(int=number))


class NativeModelDeliveryTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.settings = SimpleNamespace(
            model_delivery_input_file=str(self.root / "input.json"),
            model_credential_file=str(self.root / "credential.json"),
            model_adapter_directory_file=str(self.root / "adapter-directory.json"),
            model_delivery_output_file=str(self.root / "verified-directory.json"),
        )
        self.output = Path(self.settings.model_delivery_output_file)
        self.key = "fixture-restricted-gateway-key"
        self.environment = patch.dict(os.environ, {"FIXTURE_MODEL_KEY": self.key})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.config = [
            {"type": "llm", "provider": "litellm_llm", "api_key_name": "FIXTURE_MODEL_KEY",
             "api_base": "https://gateway.example/v1", "models": [
                 {"model": "openai/primary", "alias": "primary", "kwargs": {}, "fallbacks": ["openai/backup"]},
                 {"model": "openai/backup", "alias": "backup", "kwargs": {}}]},
            {"type": "embedder", "provider": "litellm_embedder", "api_key_name": "FIXTURE_MODEL_KEY",
             "api_base": "https://gateway.example/v1", "models": [{"model": "openai/embedding", "alias": "embedding"}]},
            {"type": "pipeline", "pipes": [{"name": "fixture", "llm": "litellm_llm.primary", "embedder": "litellm_embedder.embedding"}]},
        ]
        reader = {"servicePrincipalId": identity(4), "audience": "fixture-wren", "roleName": "fixture-reader"}
        self.projection = {
            "bindingId": identity(2), "tenantId": identity(1), "workspaceId": identity(3),
            "gatewayPrincipalId": identity(4), "generation": 2, "configDigest": "a" * 64,
            "nativeScopeRef": "42", "secretReader": reader,
            "serviceSecretRef": {"locator": "fixture/kv/model", "version": 1, "audience": "fixture-wren"},
            "secretRef": {"locator": "fixture/kv/model", "version": 1, "audience": "fixture-core"},
            "routeResourceIds": [identity(i) for i in (5, 6, 7)],
            "routes": [{"resourceId": identity(i), "nativeId": model} for i, model in zip((5, 6, 7), ("primary", "backup", "embedding"))],
            "deliveryChallenges": [{"routeResourceId": identity(i), "verificationNonce": "b" * 64} for i in (5, 6, 7)],
        }
        self.delivery = {"projection": self.projection, "models": [
            {"routeResourceId": identity(i), "nativeModelRef": ref, "baseUrl": "https://gateway.example/v1"}
            for i, ref in zip((5, 6, 7), ("litellm_llm.primary", "litellm_llm.backup", "litellm_embedder.embedding"))]}
        self.material = {"delivery": self.delivery, "requestId": identity(8), "version": 1, "value": self.key}
        public = self.root / "public-jwks.json"
        self.write(public, {"keys": [{"kty": "RSA", "kid": "fixture", "n": "AQ", "e": "AQAB"}]})
        self.directory = {"adapters": [{
            "adapterServiceRef": "fixture-wren", "baseUrl": "https://wren.example", "nativeInstanceRef": "fixture-instance",
            "artifactDigest": "a" * 64, "actionTokenAudience": "fixture-adapter", "timeoutSeconds": 10, "maxResponseBytes": 65536,
            "secretReaders": [reader], "bindings": [{"bindingId": identity(2), "tenantId": identity(1), "workspaceId": identity(3),
                "servicePrincipalId": identity(4), "nativeScopeRef": "42", "configDigest": "a" * 64, "isolationMode": "DEDICATED_INSTANCE"}],
            "nativeHumanIdentities": [{"bindingId": identity(2), "generation": 2, "configDigest": "a" * 64,
                "identityProviderId": identity(9), "audience": "fixture-human", "jwksFile": str(public)}],
        }]}
        self.save()

    def write(self, path, value):
        Path(path).write_text(json.dumps(value), encoding="utf-8")
        Path(path).chmod(0o600)

    def save(self):
        for path, value in zip((self.settings.model_delivery_input_file, self.settings.model_credential_file,
                                self.settings.model_adapter_directory_file), (self.delivery, self.material, self.directory)):
            self.write(path, value)

    def publish(self, change=None):
        with NativeModelDelivery(self.settings) as delivery:
            components = generate_components(self.config)
            if change:
                change(components)
            delivery.publish(components, self.config)
            return json.loads(self.output.read_text())

    def test_real_loaded_router_direct_embedding_and_original_directory_consumers(self):
        with NativeModelDelivery(self.settings) as delivery:
            delivery.publish(generate_components(self.config), self.config)
            value = json.loads(self.output.read_text())
            receipts = value["adapters"][0]["modelCredentialDeliveries"]
            self.assertEqual(len(receipts), 3)
            for receipt in receipts:
                message = "application-model-key:v1\x0042\x00" + receipt["nativeModelRef"] + "\x00" + "b" * 64
                self.assertEqual(receipt["nativeProof"], hmac.new(self.key.encode(), message.encode(), hashlib.sha256).hexdigest())
            self.assertEqual(self.output.stat().st_mode & 0o777, 0o600)
            self.assertNotIn(self.key, self.output.read_text())
            schema = json.loads(Path(os.environ["DIRECTORY_CONTRACT_FILE"]).read_text())
            jsonschema.Draft202012Validator(schema, format_checker=jsonschema.FormatChecker()).validate(value)
            # Execute the existing controlled-directory producer verbatim, not
            # another implementation of its admission or mount checks.
            source = Path(os.environ["ORIGINAL_START_CORE_FILE"]).read_text()
            code = source.split("<<'PYADAPTER'\n", 1)[1].split("\nPYADAPTER", 1)[0]
            composed = self.root / "compose.json"
            result = subprocess.run([sys.executable, "-c", code, str(composed)], env={**os.environ,
                "APPLICATION_ADAPTER_DIRECTORY_FILE": str(self.output)}, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            environment = json.loads(composed.read_text())["services"]["core-bff"]["environment"]
            self.assertEqual(environment["APPLICATION_ADAPTER_DIRECTORY_FILE"], str(self.output))
        self.assertFalse(self.output.exists())

    def test_loaded_key_cannot_be_replaced_by_bao_material_for_proof(self):
        def change(components):
            components["fixture"].embedder_provider._api_key = "fixture-wrong-key"
        with self.assertRaises(ModelDeliveryUnavailable):
            self.publish(change)
        self.assertFalse(self.output.exists())

    def test_direct_llm_consumes_actual_key_without_router(self):
        self.config[0]["models"][0]["fallbacks"] = []
        self.config[2]["pipes"].append({"name": "backup", "llm": "litellm_llm.backup"})
        self.assertEqual(len(self.publish()["adapters"][0]["modelCredentialDeliveries"]), 3)

    def test_prior_generations_and_other_bindings_are_not_overwritten(self):
        old = self.publish()["adapters"][0]["modelCredentialDeliveries"]
        for receipt in old:
            receipt["generation"] = 1
        unrelated = copy.deepcopy(old[0])
        unrelated["bindingId"] = identity(99)
        self.directory["adapters"][0]["modelCredentialDeliveries"] = [*old, unrelated]
        self.save()
        receipts = self.publish()["adapters"][0]["modelCredentialDeliveries"]
        self.assertEqual(receipts[:4], [*old, unrelated])
        self.assertEqual(len(receipts), 7)

    def test_actual_fallback_endpoint_and_model_are_checked(self):
        for key, value in (("api_base", "https://other.example/v1"), ("model", "openai/other")):
            with self.subTest(key=key):
                def change(components):
                    components["fixture"].llm_provider._router.model_list[1]["litellm_params"][key] = value
                with self.assertRaises(ModelDeliveryUnavailable):
                    self.publish(change)

    def test_unmapped_real_provider_refuses_partial_receipt(self):
        self.delivery["models"][2]["nativeModelRef"] = "not-loaded"
        self.save()
        with self.assertRaises(ModelDeliveryUnavailable):
            self.publish()

    def test_generation_and_scope_must_match_controlled_directory(self):
        for key, value in (("generation", 1), ("configDigest", "c" * 64)):
            with self.subTest(key=key):
                changed = copy.deepcopy(self.directory)
                changed["adapters"][0]["nativeHumanIdentities"][0][key] = value
                self.write(self.settings.model_adapter_directory_file, changed)
                with self.assertRaises(ModelDeliveryUnavailable):
                    self.publish()

    def test_source_changes_during_startup_refuse_publication(self):
        def change(_):
            changed = copy.deepcopy(self.directory)
            changed["adapters"][0]["nativeInstanceRef"] = "another-instance"
            self.write(self.settings.model_adapter_directory_file, changed)
        with self.assertRaises(ModelDeliveryUnavailable):
            self.publish(change)

    def test_source_changed_while_output_is_flushed_refuses_publication(self):
        original = os.fsync

        def flush(descriptor):
            original(descriptor)
            if stat.S_ISREG(os.fstat(descriptor).st_mode):
                changed = copy.deepcopy(self.directory)
                changed["adapters"][0]["nativeInstanceRef"] = "another-instance"
                self.write(self.settings.model_adapter_directory_file, changed)

        with patch("src.providers.native_model_delivery.os.fsync", side_effect=flush):
            with self.assertRaises(ModelDeliveryUnavailable):
                self.publish()
        self.assertFalse(self.output.exists())

    def test_symlink_permissions_partial_and_alias_paths_refuse(self):
        original = self.settings.model_credential_file
        Path(original).chmod(0o640)
        with self.assertRaises(ModelDeliveryUnavailable):
            self.publish()
        Path(original).chmod(0o600)
        link = self.root / "credential-link.json"
        link.symlink_to(original)
        self.settings.model_credential_file = str(link)
        with self.assertRaises(ModelDeliveryUnavailable):
            self.publish()
        self.settings.model_credential_file = None
        with self.assertRaises(ModelDeliveryUnavailable):
            self.publish()
        self.settings.model_credential_file = original
        self.settings.model_delivery_output_file = original
        with self.assertRaises(ModelDeliveryUnavailable):
            self.publish()
        self.assertEqual(json.loads(Path(original).read_text()), self.material)

    def test_startup_failure_clears_prior_success_and_no_new_success(self):
        self.write(self.output, self.publish())
        with self.assertRaisesRegex(RuntimeError, "fixture startup failed"):
            with NativeModelDelivery(self.settings):
                raise RuntimeError("fixture startup failed")
        self.assertFalse(self.output.exists())

    def test_misdirected_output_is_not_deleted(self):
        self.write(self.output, {"unrelated": "owner-only data"})
        with self.assertRaises(ModelDeliveryUnavailable):
            self.publish()
        self.assertEqual(json.loads(self.output.read_text()), {"unrelated": "owner-only data"})

    def test_concurrent_lifespan_cannot_replace_active_writer(self):
        with NativeModelDelivery(self.settings) as delivery:
            delivery.publish(generate_components(self.config), self.config)
            original = self.output.read_bytes()
            with self.assertRaises(ModelDeliveryUnavailable):
                self.publish()
            self.assertEqual(self.output.read_bytes(), original)

    def test_shutdown_does_not_remove_a_newer_replacement_inode(self):
        with NativeModelDelivery(self.settings) as delivery:
            delivery.publish(generate_components(self.config), self.config)
            replacement = self.root / "newer.json"
            self.write(replacement, {"newer": "controlled replacement"})
            replacement.replace(self.output)
        self.assertEqual(json.loads(self.output.read_text()), {"newer": "controlled replacement"})

    def test_failure_after_publication_removes_this_receipt(self):
        with self.assertRaisesRegex(RuntimeError, "fixture lifetime failed"):
            with NativeModelDelivery(self.settings) as delivery:
                delivery.publish(generate_components(self.config), self.config)
                raise RuntimeError("fixture lifetime failed")
        self.assertFalse(self.output.exists())

    def test_unconfigured_standalone_does_not_create_proof(self):
        independent = SimpleNamespace(**{key: None for key in vars(self.settings)})
        with NativeModelDelivery(independent) as delivery:
            delivery.publish({}, [])
        self.assertFalse(self.output.exists())

    async def test_original_lifespan_consumes_and_removes_receipt(self):
        from src import __main__ as native
        self.settings.components = self.config
        app = SimpleNamespace(state=SimpleNamespace())
        with patch.object(native, "settings", self.settings), patch.object(native, "create_service_container"), \
             patch.object(native, "create_service_metadata"), patch.object(native, "init_langfuse"), \
             patch.object(native.langfuse_context, "flush"):
            async with native.lifespan(app):
                self.assertEqual(len(json.loads(self.output.read_text())["adapters"][0]["modelCredentialDeliveries"]), 3)
        self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main()
