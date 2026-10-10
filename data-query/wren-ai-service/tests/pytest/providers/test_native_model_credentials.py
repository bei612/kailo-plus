"""Original provider/config consumers; only remote model transport is replaced."""

import copy
import os
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

# This isolated check has no telemetry destination or writable user profile.
os.environ["HAYSTACK_TELEMETRY_ENABLED"] = "False"

from haystack import Document  # noqa: E402 - telemetry opt-out precedes imports
from litellm import EmbeddingResponse  # noqa: E402

from src.providers import generate_components  # noqa: E402
from src.providers.embedder.litellm import LitellmEmbedderProvider  # noqa: E402
from src.providers.llm.litellm import LitellmLLMProvider  # noqa: E402


def model_config(*, fallbacks=True, group=True):
    delivery = {
        "api_key_name": "FIXTURE_GATEWAY_KEY",
        "api_base": "https://gateway.example/v1/",
        "api_version": "fixture-version",
        "timeout": 17.0,
    }
    models = [
        {
            "model": "openai/fixture-primary",
            "alias": "primary",
            "kwargs": {"temperature": 0},
            "fallbacks": ["openai/fixture-backup"] if fallbacks else [],
        },
        {"model": "openai/fixture-backup", "kwargs": {"temperature": 0}},
    ]
    if not group:
        for model in models:
            model.update(delivery)
        models[1]["api_key_name"] = "FIXTURE_BACKUP_KEY"
        models[1]["api_base"] = "https://backup.example/v1/"
    return [
        {
            "type": "llm",
            "provider": "litellm_llm",
            "models": models,
            **(delivery if group else {}),
        },
        {
            "type": "pipeline",
            "pipes": [{"name": "sql_generation", "llm": "litellm_llm.primary"}],
        },
    ]


class NativeModelCredentialTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.environment = patch.dict(
            os.environ,
            {
                "FIXTURE_GATEWAY_KEY": "fixture-restricted-gateway-identity",
                "FIXTURE_BACKUP_KEY": "fixture-separate-backup-identity",
                "OPENAI_API_KEY": "fixture-unrelated-default-identity",
            },
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def provider(self, config):
        return generate_components(config)["sql_generation"].llm_provider

    async def test_direct_original_generator_uses_named_gateway_identity(self):
        provider = self.provider(model_config(fallbacks=False))
        remote = AsyncMock(return_value=SimpleNamespace(choices=[]))
        with patch("src.providers.llm.litellm.acompletion", remote):
            await provider.get_generator()("original question")
        self.assertEqual(remote.await_count, 1)
        self.assertEqual(remote.call_args.kwargs["api_key"], os.environ["FIXTURE_GATEWAY_KEY"])
        self.assertEqual(remote.call_args.kwargs["api_base"], "https://gateway.example/v1")
        self.assertEqual(remote.call_args.kwargs["api_version"], "fixture-version")
        self.assertEqual(remote.call_args.kwargs["timeout"], 17.0)

    async def test_actual_router_uses_same_group_delivery_for_primary_and_backup(self):
        config = model_config()
        original = copy.deepcopy(config)
        provider = self.provider(config)
        self.assertEqual(config, original)
        self.assertTrue(provider._has_fallbacks)
        self.assertEqual(len(provider._router.model_list), 2)
        for item in provider._router.model_list:
            params = item["litellm_params"]
            self.assertEqual(params["api_key"], os.environ["FIXTURE_GATEWAY_KEY"])
            self.assertEqual(params["api_base"], "https://gateway.example/v1")
            self.assertEqual(params["api_version"], "fixture-version")
            self.assertEqual(params["timeout"], 17.0)
            self.assertNotIn("api_key_name", params)
        remote = AsyncMock(return_value=SimpleNamespace(choices=[]))
        with patch.object(provider._router, "acompletion", remote), patch(
            "src.providers.llm.litellm.acompletion", new_callable=AsyncMock
        ) as direct:
            await provider.get_generator()("original fallback question")
        self.assertEqual(remote.await_count, 1)
        self.assertEqual(remote.call_args.kwargs["model"], "openai/fixture-primary")
        direct.assert_not_awaited()

    def test_each_original_model_can_keep_its_own_explicit_delivery(self):
        provider = self.provider(model_config(group=False))
        params = {
            item["model_name"]: item["litellm_params"]
            for item in provider._router.model_list
        }
        self.assertEqual(params["openai/fixture-primary"]["api_key"], os.environ["FIXTURE_GATEWAY_KEY"])
        self.assertEqual(params["openai/fixture-backup"]["api_key"], os.environ["FIXTURE_BACKUP_KEY"])
        self.assertEqual(params["openai/fixture-backup"]["api_base"], "https://backup.example/v1")

    def test_missing_named_backup_does_not_adopt_default_provider_identity(self):
        del os.environ["FIXTURE_BACKUP_KEY"]
        with self.assertRaisesRegex(ValueError, "Configured model credential is unavailable"):
            self.provider(model_config(group=False))

    def test_group_precedence_matches_original_direct_provider(self):
        config = model_config()
        config[0]["models"][1].update(
            {"api_key_name": "FIXTURE_BACKUP_KEY", "api_base": "https://backup.example/v1/"}
        )
        provider = self.provider(config)
        for item in provider._router.model_list:
            self.assertEqual(item["litellm_params"]["api_key"], provider._api_key)
            self.assertEqual(item["litellm_params"]["api_base"], provider._api_base)

    def test_ambiguous_named_and_inline_router_credential_is_refused(self):
        config = model_config()
        config[0]["models"][1]["kwargs"]["api_key"] = "fixture-other-key"
        with self.assertRaisesRegex(ValueError, "credential sources are ambiguous"):
            self.provider(config)

    def test_named_keys_fail_closed_before_router_creation(self):
        for value in (None, "", " ", "fixture\nkey", "fixture\x00key"):
            for constructor in (LitellmLLMProvider, LitellmEmbedderProvider):
                with self.subTest(value=repr(value), constructor=constructor.__name__):
                    if value is None:
                        os.environ.pop("FIXTURE_GATEWAY_KEY", None)
                    elif "\x00" not in value:
                        os.environ["FIXTURE_GATEWAY_KEY"] = value
                    with patch("src.providers.loader.os.getenv", return_value=value):
                        with self.assertRaisesRegex(ValueError, "credential is unavailable"):
                            constructor(model="openai/fixture-model", api_key_name="FIXTURE_GATEWAY_KEY")

    def test_empty_explicit_credential_name_is_not_independent_mode(self):
        for constructor in (LitellmLLMProvider, LitellmEmbedderProvider):
            with self.assertRaisesRegex(ValueError, "credential name is invalid"):
                constructor(model="openai/fixture-model", api_key_name="")

    def test_original_unspecified_independent_provider_is_preserved(self):
        for constructor in (LitellmLLMProvider, LitellmEmbedderProvider):
            self.assertIsNone(constructor(model="openai/fixture-model")._api_key)

    async def test_text_and_document_embedding_use_the_selected_native_key(self):
        provider = LitellmEmbedderProvider(
            model="openai/fixture-embedding",
            api_key_name="FIXTURE_GATEWAY_KEY",
            api_base="https://gateway.example/v1/",
            timeout=17.0,
        )
        response = EmbeddingResponse(
            model="fixture-embedding",
            data=[{"object": "embedding", "index": 0, "embedding": [0.1, 0.2]}],
            usage={"prompt_tokens": 1, "total_tokens": 1},
        )
        remote = AsyncMock(return_value=response)
        with patch("src.providers.embedder.litellm.aembedding", remote):
            await provider.get_text_embedder().run("original question")
            await provider.get_document_embedder().run([Document(content="original document")])
        self.assertEqual(remote.await_count, 2)
        for call in remote.await_args_list:
            self.assertEqual(call.kwargs["api_key"], os.environ["FIXTURE_GATEWAY_KEY"])
            self.assertEqual(call.kwargs["api_base"], "https://gateway.example/v1")
            self.assertEqual(call.kwargs["model"], "openai/fixture-embedding")


if __name__ == "__main__":
    unittest.main()
