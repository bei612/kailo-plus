"""Kailo DD-163 (design 07 §4.8.8): product help is Kailo's, so the Kailo
deployment answers the USER_GUIDE intent as a non-data question and never
fetches the upstream documentation. Original AskService and
create_service_container; no live model, document store or network."""

import asyncio
import collections
import types
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import yaml

import src.globals as service_globals
from src.config import settings
from src.web.v1.services.ask import AskRequest, AskResultRequest, AskService

TEMPLATE = Path(__file__).resolve().parents[4] / "docker/config.template.yaml"


def general_reply(text):
    return {"replies": [text], "meta": [{"finish_reason": "stop"}]}


def pipelines(intent):
    empty = {"formatted_output": {"documents": []}}
    misleading = AsyncMock(
        return_value={"misleading_assistance": general_reply("ask about your data")}
    )
    guide = AsyncMock(
        return_value={"user_guide_assistance": general_reply("upstream docs answer")}
    )
    return {
        "historical_question": types.SimpleNamespace(run=AsyncMock(return_value=empty)),
        "sql_pairs_retrieval": types.SimpleNamespace(run=AsyncMock(return_value=empty)),
        "instructions_retrieval": types.SimpleNamespace(run=AsyncMock(return_value=empty)),
        "intent_classification": types.SimpleNamespace(
            run=AsyncMock(
                return_value={"post_process": {"intent": intent, "db_schemas": []}}
            )
        ),
        "misleading_assistance": types.SimpleNamespace(
            run=misleading, retire_streaming_results=MagicMock()
        ),
        "user_guide_assistance": types.SimpleNamespace(
            run=guide, retire_streaming_results=MagicMock()
        ),
    }


async def ask(service, query="How do I use this product?"):
    request = AskRequest(query=query, id="a" * 40, project_id="7")
    request.query_id = str(uuid4())
    results = await service.ask(request)
    # _generate_general runs as a task on the same loop.
    for _ in range(5):
        await asyncio.sleep(0)
    return results, service.get_ask_result(AskResultRequest(query_id=request.query_id))


class KailoUserGuide(unittest.IsolatedAsyncioTestCase):
    async def test_closed_user_guide_is_answered_as_a_non_data_question(self):
        pipes = pipelines("USER_GUIDE")
        service = AskService(pipes, allow_user_guide=False)
        results, result = await ask(service)
        self.assertEqual(results["metadata"]["type"], "MISLEADING_QUERY")
        self.assertEqual((result.type, result.general_type), ("GENERAL", "MISLEADING_QUERY"))
        pipes["misleading_assistance"].run.assert_awaited_once()
        pipes["user_guide_assistance"].run.assert_not_called()
        self.assertEqual(result.completion.content, "ask about your data")

    async def test_original_user_guide_is_unchanged_when_allowed(self):
        pipes = pipelines("USER_GUIDE")
        service = AskService(pipes)
        results, result = await ask(service)
        self.assertEqual(results["metadata"]["type"], "GENERAL")
        self.assertEqual(result.general_type, "USER_GUIDE")
        pipes["user_guide_assistance"].run.assert_awaited_once()
        pipes["misleading_assistance"].run.assert_not_called()

    async def test_data_questions_are_not_affected(self):
        pipes = pipelines("GENERAL")
        pipes["data_assistance"] = types.SimpleNamespace(
            run=AsyncMock(return_value={"data_assistance": general_reply("data")}),
            retire_streaming_results=MagicMock(),
        )
        service = AskService(pipes, allow_user_guide=False)
        results, result = await ask(service, "What does this dataset contain?")
        self.assertEqual(result.general_type, "DATA_ASSISTANCE")
        pipes["user_guide_assistance"].run.assert_not_called()


class KailoUserGuideWiring(unittest.TestCase):
    def container(self, allow_user_guide):
        configured = settings.model_copy(update={"allow_user_guide": allow_user_guide})
        fetch = MagicMock(return_value=[{"path": "p", "content": "c"}])
        services = MagicMock()
        with patch.multiple(
            service_globals,
            fetch_wren_ai_docs=fetch,
            generation=MagicMock(),
            retrieval=MagicMock(),
            indexing=MagicMock(),
            services=services,
        ):
            service_globals.create_service_container(
                collections.defaultdict(dict), configured
            )
        return fetch, services.AskService.call_args.kwargs

    def test_closed_user_guide_fetches_no_upstream_documentation(self):
        fetch, ask_kwargs = self.container(False)
        fetch.assert_not_called()
        self.assertFalse(ask_kwargs["allow_user_guide"])

    def test_original_fetch_kept_when_allowed(self):
        fetch, ask_kwargs = self.container(True)
        fetch.assert_called_once()
        self.assertTrue(ask_kwargs["allow_user_guide"])

    def test_kailo_deployment_template_closes_the_user_guide(self):
        docs = list(yaml.safe_load_all(TEMPLATE.read_text()))
        configured = settings.model_copy()
        configured.override(docs)
        self.assertIs(configured.allow_user_guide, False)


if __name__ == "__main__":
    unittest.main()
