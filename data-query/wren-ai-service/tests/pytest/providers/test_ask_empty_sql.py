"""An answer without SQL fails at once with its reason (data-query/fork/verify/ask-empty-sql.md).

Production 2026-10-29: the hybrid-thinking platform route spent all 8192 output
tokens on hidden reasoning, the message content was empty, the empty statement
went to the engine and the task ended minutes later as "Internal server error".
No live model, engine or Qdrant is used here.
"""

import asyncio
import types
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import yaml

from src.core.engine import SQLGenerationEmpty
from src.pipelines.generation.utils.sql import SQLGenPostProcessor
from src.providers.llm import build_message, check_finish_reason
from src.providers.llm.litellm import LitellmLLMProvider
from src.utils import extract_braces_content
from src.web.v1.services.ask import AskRequest, AskResultRequest, AskService

ROOT = Path(__file__).resolve().parents[3]


def completion(content, finish_reason="stop", **message_fields):
    message = types.SimpleNamespace(content=content, **message_fields)
    choice = types.SimpleNamespace(index=0, message=message, finish_reason=finish_reason)
    return types.SimpleNamespace(model="qwen", choices=[choice], usage={}), choice


def engine():
    return types.SimpleNamespace(
        execute_sql=AsyncMock(return_value=(True, None, {"correlation_id": "c"})),
        dry_plan=AsyncMock(return_value=(True, "")),
    )


class ReasoningOnlyCompletion(unittest.TestCase):
    def test_empty_content_with_hidden_reasoning_is_marked(self):
        for fields in (
            {"reasoning_content": "We need answer user's request..."},
            {"provider_specific_fields": {"reasoning": "We need answer..."}},
            {"reasoning": "We need answer..."},
        ):
            with self.subTest(fields=list(fields)):
                message = build_message(*completion(None, "length", **fields))
                self.assertEqual(message.content, "")
                self.assertIs(message.meta["reasoning_only"], True)
                with self.assertLogs("wren-ai-service", "WARNING") as logs:
                    check_finish_reason(message)
                self.assertIn("hidden reasoning", "\n".join(logs.output))

    def test_an_answer_is_never_reasoning_only(self):
        message = build_message(
            *completion('{"sql": "SELECT 1"}', reasoning_content="short plan")
        )
        self.assertIs(message.meta["reasoning_only"], False)
        message = build_message(*completion("", "stop"))
        self.assertIs(message.meta["reasoning_only"], False)


class EmptySQLPostProcess(unittest.IsolatedAsyncioTestCase):
    async def test_empty_answers_raise_before_the_engine(self):
        cases = (
            ([""], [{"finish_reason": "length", "reasoning_only": True}], "hidden reasoning"),
            (['{"sql": ""}'], [{"finish_reason": "stop"}], "empty answer"),
            # A fenced answer as the provider hands it over (fence removed).
            ([extract_braces_content('```json\n{"sql": "   "}\n```')], None, "empty answer"),
            (['{"sql": "SELECT month, COUNT(*) FROM orders GROUP'], [{"finish_reason": "length"}], "cut off"),
        )
        for replies, meta, reason in cases:
            with self.subTest(replies=replies):
                fake = engine()
                with self.assertRaises(SQLGenerationEmpty) as raised:
                    await SQLGenPostProcessor(engine=fake).run(
                        replies, meta=meta, use_dry_plan=True
                    )
                self.assertIn(reason, str(raised.exception))
                fake.execute_sql.assert_not_awaited()
                fake.dry_plan.assert_not_awaited()

    async def test_sql_still_reaches_the_engine(self):
        fake = engine()
        result = await SQLGenPostProcessor(engine=fake).run(
            ['{"sql": "SELECT 1"}'], meta=[{"finish_reason": "stop"}]
        )
        self.assertEqual(result["valid_generation_result"]["sql"], "SELECT 1")
        self.assertEqual(fake.execute_sql.await_args.args[0], "SELECT 1")

    async def test_unparsable_complete_answer_keeps_the_original_path(self):
        fake = engine()
        result = await SQLGenPostProcessor(engine=fake).run(
            ['{"sql": broken}'], meta=[{"finish_reason": "stop"}]
        )
        self.assertEqual(
            result, {"valid_generation_result": {}, "invalid_generation_result": {}}
        )
        fake.execute_sql.assert_not_awaited()


class AskFailsFast(unittest.IsolatedAsyncioTestCase):
    async def test_no_sql_generated_is_a_named_failure_without_correction(self):
        calls = []
        outputs = {
            "historical_question": {"formatted_output": {"documents": []}},
            "sql_pairs_retrieval": {"formatted_output": {"documents": []}},
            "instructions_retrieval": {"formatted_output": {"documents": []}},
            "db_schema_retrieval": {
                "construct_retrieval_results": {
                    "retrieval_results": [
                        {"table_name": "orders", "table_ddl": "CREATE TABLE orders (id int)"}
                    ]
                }
            },
            "sql_generation_reasoning": {"post_process": "plan"},
            "sql_functions_retrieval": [],
            "sql_diagnosis": {"post_process": {"reasoning": "unused"}},
            "sql_correction": {"post_process": {"valid_generation_result": {"sql": "SELECT 1"}}},
        }

        def runner(name):
            async def run(**kwargs):
                calls.append(name)
                if name == "sql_generation":
                    raise SQLGenerationEmpty("length", True)
                return outputs[name]

            return types.SimpleNamespace(run=run)

        service = AskService({}, allow_intent_classification=False)
        service._pipelines = {
            name: runner(name) for name in (*outputs, "sql_generation")
        }
        request = AskRequest(query="按月统计订单数量", id="a" * 40, project_id="7")
        request.query_id = "original"
        results = await asyncio.wait_for(service.ask(request), 2)

        result = service.get_ask_result(AskResultRequest(query_id="original"))
        self.assertEqual(result.status, "failed")
        self.assertEqual(result.error.code, "NO_SQL_GENERATED")
        self.assertIn("hidden reasoning", result.error.message)
        self.assertEqual(results["metadata"]["error_type"], "NO_SQL_GENERATED")
        self.assertIn("sql_generation", calls)
        self.assertNotIn("sql_diagnosis", calls)
        self.assertNotIn("sql_correction", calls)


class PlatformRouteDoesNotThink(unittest.IsolatedAsyncioTestCase):
    async def test_deployment_template_kwargs_reach_the_model_request(self):
        template = (ROOT.parent / "docker/config.template.yaml").read_text("utf-8")
        llm = next(
            doc
            for doc in yaml.safe_load_all(template)
            if doc and doc.get("type") == "llm"
        )
        kwargs = llm["models"][0]["kwargs"]
        self.assertEqual(
            kwargs["extra_body"], {"chat_template_kwargs": {"enable_thinking": False}}
        )

        response, _ = completion('{"sql": "SELECT 1"}')
        with patch(
            "src.providers.llm.litellm.acompletion", AsyncMock(return_value=response)
        ) as call:
            provider = LitellmLLMProvider(
                model="openai/route", api_base="http://gateway/v1", kwargs=kwargs
            )
            generator = provider.get_generator(system_prompt="system")
            result = await generator(prompt="question")
        self.assertEqual(result["replies"], ['{"sql": "SELECT 1"}'])
        sent = call.await_args.kwargs
        self.assertEqual(
            sent["extra_body"], {"chat_template_kwargs": {"enable_thinking": False}}
        )
        self.assertEqual(sent["max_tokens"], 8192)


if __name__ == "__main__":
    unittest.main()
