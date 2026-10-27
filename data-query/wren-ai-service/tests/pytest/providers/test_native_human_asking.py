"""Original FastAPI, async driver and Asking consumers; no live model or Core."""

import asyncio
import json
import sys
import types
import unittest
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import httpx
import openai
from cachetools import TTLCache
from openai.types.chat import ChatCompletionChunk
from fastapi import BackgroundTasks, FastAPI
from hamilton.async_driver import AsyncDriver

from src.providers.engine.native_identity import NativeQueryPending, native_ask_context
from src.web.v1.routers.ask import ask as create_ask, router
from src.web.v1.routers.ask_feedbacks import router as feedback_router
from src.globals import get_service_container, get_service_metadata, ServiceMetadata
from src.web.v1.services.ask import (
    AskService,
    AskRequest,
    AskResultRequest,
    AskResultResponse,
    StopAskRequest,
)
from src.providers.llm.litellm import LitellmLLMProvider
from src.pipelines.generation.data_assistance import DataAssistance
from src.pipelines.generation.misleading_assistance import MisleadingAssistance
from src.pipelines.generation.user_guide_assistance import UserGuideAssistance
from src.web.v1.services.ask_feedback import (
    AskFeedbackService,
    AskFeedbackRequest,
    AskFeedbackResultRequest,
)


async def native_query_waiting() -> dict:
    raise NativeQueryPending()


class NativeHumanAsking(unittest.IsolatedAsyncioTestCase):
    async def test_original_fastapi_background_task_inherits_only_private_header_context(
        self,
    ):
        task_id = str(uuid4())
        observed = []
        contexts = []

        async def original_job(request, **kwargs):
            context = native_ask_context.get()
            contexts.append(context)
            observed.append((context.human_token, context.task_id, context.project_id))
            self.assertNotIn("fixture-human", request.model_dump_json())
            self.assertNotIn("fixture-human", repr(kwargs))

        service = types.SimpleNamespace(_ask_results={}, ask=original_job)
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_service_container] = lambda: types.SimpleNamespace(
            ask_service=service
        )
        app.dependency_overrides[get_service_metadata] = lambda: ServiceMetadata(
            {}, "fixture"
        )
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://fixture"
        ) as client:
            request = {
                "query": "Original question",
                "native_task_id": task_id,
                "project_id": "7",
                "id": "a" * 40,
            }
            headers = {
                "x-wren-native-authorization": "Bearer fixture-human",
                "x-wren-native-poll-interval-ms": "1",
            }
            response = await client.post("/asks", json=request, headers=headers)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), {"query_id": task_id})
            self.assertEqual(
                (await client.post("/asks", json=request, headers=headers)).status_code,
                409,
            )
        self.assertEqual(observed, [("fixture-human", task_id, "7")])
        self.assertEqual(contexts[0].human_token, "")
        self.assertIsNone(native_ask_context.get())

    async def test_actual_hamilton_driver_preserves_pending_exception_identity(self):
        driver = AsyncDriver({}, sys.modules[__name__])
        with self.assertRaises(NativeQueryPending):
            await driver.execute(["native_query_waiting"])

    async def test_actual_original_asking_does_not_publish_failed_for_unknown_query(
        self,
    ):
        service = AskService(
            {
                "historical_question": types.SimpleNamespace(
                    run=AsyncMock(side_effect=NativeQueryPending())
                )
            }
        )
        request = AskRequest(query="Original", id="a" * 40, project_id="7")
        request.query_id = str(uuid4())
        await service.ask(request)
        result = service.get_ask_result(AskResultRequest(query_id=request.query_id))
        self.assertEqual(result.status, "stopped")
        self.assertEqual(result.error.code, "OTHERS")
        self.assertEqual(result.error.message, "NATIVE_EXECUTION_UNKNOWN")
        self.assertNotIn(result.status, {"failed", "finished"})

    async def test_original_feedback_background_inherits_the_same_private_human_context(
        self,
    ):
        task_id = str(uuid4())
        contexts = []

        async def original_feedback(request, **kwargs):
            context = native_ask_context.get()
            self.assertEqual(
                (context.task_id, context.project_id, context.deployment_hash),
                (task_id, "7", "a" * 40),
            )
            self.assertEqual(context.human_token, "fixture-feedback-human")
            self.assertNotIn(context.human_token, request.model_dump_json())
            self.assertNotIn(context.human_token, repr(kwargs))
            contexts.append(context)

        service = types.SimpleNamespace(
            _ask_feedback_results={}, ask_feedback=original_feedback
        )
        app = FastAPI()
        app.include_router(feedback_router)
        app.dependency_overrides[get_service_container] = lambda: types.SimpleNamespace(
            ask_feedback_service=service
        )
        app.dependency_overrides[get_service_metadata] = lambda: ServiceMetadata(
            {}, "fixture"
        )
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://fixture"
        ) as client:
            request = {
                "question": "Original",
                "tables": ["orders"],
                "sql_generation_reasoning": "original",
                "sql": "SELECT id FROM orders",
                "native_task_id": task_id,
                "project_id": "7",
                "id": "a" * 40,
            }
            headers = {
                "x-wren-native-authorization": "Bearer fixture-feedback-human",
                "x-wren-native-poll-interval-ms": "1",
            }
            response = await client.post(
                "/ask-feedbacks", json=request, headers=headers
            )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), {"query_id": task_id})
            self.assertEqual(
                (
                    await client.post("/ask-feedbacks", json=request, headers=headers)
                ).status_code,
                409,
            )
            request["native_task_id"] = str(uuid4())
            self.assertEqual(
                (
                    await client.post(
                        "/ask-feedbacks",
                        json=request,
                        headers={
                            "x-wren-native-authorization": "Bearer fixture-feedback-human"
                        },
                    )
                ).status_code,
                401,
            )
        self.assertEqual(len(contexts), 1)
        self.assertEqual(contexts[0].human_token, "")
        self.assertIsNone(native_ask_context.get())

    async def test_actual_feedback_pending_sql_exits_native_job_without_claiming_sql_failure(
        self,
    ):
        pending = types.SimpleNamespace(run=AsyncMock(side_effect=NativeQueryPending()))
        service = AskFeedbackService(
            {
                "db_schema_retrieval": pending,
                "sql_pairs_retrieval": pending,
                "instructions_retrieval": pending,
            }
        )
        request = AskFeedbackRequest(
            question="Original",
            tables=["orders"],
            sql_generation_reasoning="original",
            sql="SELECT id FROM orders",
            id="a" * 40,
            project_id="7",
        )
        request.query_id = str(uuid4())
        await service.ask_feedback(request)
        result = service.get_ask_feedback_result(
            AskFeedbackResultRequest(query_id=request.query_id)
        )
        self.assertEqual(result.status, "stopped")
        self.assertEqual(result.error.message, "NATIVE_EXECUTION_UNKNOWN")


class NativeGeneralCompletion(unittest.IsolatedAsyncioTestCase):
    pipelines = (
        (DataAssistance, "data_assistance", "DATA_ASSISTANCE", "GENERAL"),
        (
            MisleadingAssistance,
            "misleading_assistance",
            "MISLEADING_QUERY",
            "MISLEADING_QUERY",
        ),
        (UserGuideAssistance, "user_guide_assistance", "USER_GUIDE", "USER_GUIDE"),
    )

    def service(self, entry):
        constructor, name, kind, _ = entry
        provider = LitellmLLMProvider(model="openai/fixture")
        pipeline = constructor(
            provider,
            **({"wren_ai_docs": []} if constructor is UserGuideAssistance else {}),
        )
        service = AskService({name: pipeline})
        expected = AskResultResponse(
            status="finished", type="GENERAL", general_type=kind
        )
        service._ask_results["original"] = expected
        return service, pipeline, expected

    def request(self, name):
        return dict(
            query="Original question",
            query_id="original",
            language="English",
            **({"db_schemas": []} if name != "user_guide_assistance" else {}),
        )

    def chunk(self, text=None, reason=None, usage=False):
        return ChatCompletionChunk(
            id="fixture",
            created=1,
            model="fixture",
            object="chat.completion.chunk",
            choices=[]
            if usage
            else [{"index": 0, "delta": {"content": text}, "finish_reason": reason}],
            usage={"prompt_tokens": 2, "completion_tokens": 3, "total_tokens": 5}
            if usage
            else None,
        )

    async def events(self, service):
        return [
            json.loads(event.removeprefix("data: "))
            async for event in service.get_ask_streaming_result("original")
        ]

    async def test_actual_three_hamilton_pipelines_retain_full_result_for_repeated_reads(
        self,
    ):
        for entry in self.pipelines:
            with self.subTest(pipeline=entry[1]):
                service, pipeline, expected = self.service(entry)

                async def stream():
                    yield self.chunk('首段\n"')
                    yield self.chunk('尾段"', "stop")
                    yield self.chunk(usage=True)

                remote = AsyncMock(return_value=stream())
                with patch("src.providers.llm.litellm.acompletion", remote):
                    await service._generate_general(
                        entry[1], expected, **self.request(entry[1])
                    )
                result = service.get_ask_result(AskResultRequest(query_id="original"))
                self.assertIs(result, expected)
                self.assertEqual(
                    result.completion.model_dump(),
                    {"query_id": "original", "content": '首段\n"尾段"'},
                )
                self.assertNotIn("original", pipeline._user_queues)
                first = await self.events(service)
                self.assertEqual(
                    first,
                    [
                        {"message": '首段\n"尾段"'},
                        {"done": True, "queryId": "original"},
                    ],
                )
                self.assertEqual(await self.events(service), first)
                self.assertEqual(remote.await_count, 1)

    async def test_original_general_classification_finishes_before_explanation_without_false_completion(
        self,
    ):
        for entry in self.pipelines:
            with self.subTest(pipeline=entry[1]):
                service, pipeline, _ = self.service(entry)
                entered, release = asyncio.Event(), asyncio.Event()

                async def stream():
                    entered.set()
                    await release.wait()
                    yield self.chunk("original full", "stop")

                for name in (
                    "historical_question",
                    "sql_pairs_retrieval",
                    "instructions_retrieval",
                ):
                    service._pipelines[name] = types.SimpleNamespace(
                        run=AsyncMock(
                            return_value={"formatted_output": {"documents": []}}
                        )
                    )
                service._pipelines["intent_classification"] = types.SimpleNamespace(
                    run=AsyncMock(
                        return_value={
                            "post_process": {"intent": entry[3], "db_schemas": []}
                        }
                    )
                )
                request = AskRequest(query="Original", id="a" * 40, project_id="7")
                request.query_id = "original"
                with patch(
                    "src.providers.llm.litellm.acompletion",
                    AsyncMock(return_value=stream()),
                ) as remote:
                    await service.ask(request)
                    await asyncio.wait_for(entered.wait(), 2)
                    pending = service.get_ask_result(
                        AskResultRequest(query_id="original")
                    )
                    self.assertEqual(
                        (pending.type, pending.status), ("GENERAL", "finished")
                    )
                    self.assertIsNone(pending.completion)
                    release.set()

                    async def completed():
                        while pending.completion is None:
                            await asyncio.sleep(0)

                    await asyncio.wait_for(completed(), 2)
                self.assertEqual(pending.completion.content, "original full")
                self.assertEqual(remote.await_count, 1)

    async def test_stop_during_classification_keeps_stopped_and_never_generates(self):
        for intent in ("GENERAL", "MISLEADING_QUERY", "USER_GUIDE", "error"):
            with self.subTest(intent=intent):
                service, _, _ = self.service(self.pipelines[0])
                for name in (
                    "historical_question",
                    "sql_pairs_retrieval",
                    "instructions_retrieval",
                ):
                    service._pipelines[name] = types.SimpleNamespace(
                        run=AsyncMock(
                            return_value={"formatted_output": {"documents": []}}
                        )
                    )
                entered, release = asyncio.Event(), asyncio.Event()

                async def classify(**kwargs):
                    entered.set()
                    await release.wait()
                    if intent == "error":
                        raise RuntimeError("classification failed after stop")
                    return {"post_process": {"intent": intent, "db_schemas": []}}

                service._pipelines["intent_classification"] = types.SimpleNamespace(
                    run=classify
                )
                generate = AsyncMock()
                service._generate_general = generate
                request = AskRequest(query="Original", id="a" * 40, project_id="7")
                request.query_id = "original"
                task = asyncio.create_task(service.ask(request))
                await asyncio.wait_for(entered.wait(), 2)
                stop = StopAskRequest(status="stopped")
                stop.query_id = "original"
                service.stop_ask(stop)
                release.set()
                await asyncio.wait_for(task, 2)
                self.assertEqual(
                    service.get_ask_result(
                        AskResultRequest(query_id="original")
                    ).status,
                    "stopped",
                )
                generate.assert_not_called()

    async def test_stopped_queued_general_task_does_not_call_actual_provider(self):
        for entry in self.pipelines:
            with self.subTest(pipeline=entry[1]):
                service, _, expected = self.service(entry)
                task = asyncio.create_task(
                    service._generate_general(
                        entry[1], expected, **self.request(entry[1])
                    )
                )
                stop = StopAskRequest(status="stopped")
                stop.query_id = "original"
                service.stop_ask(stop)
                with patch(
                    "src.providers.llm.litellm.acompletion", new_callable=AsyncMock
                ) as remote:
                    await task
                remote.assert_not_called()
                self.assertEqual(
                    service.get_ask_result(
                        AskResultRequest(query_id="original")
                    ).status,
                    "stopped",
                )

    async def test_registered_background_owner_cannot_start_after_expiry_or_replacement(
        self,
    ):
        for mode in ("expiry", "replacement", "stop"):
            with self.subTest(mode=mode):
                service, _, _ = self.service(self.pipelines[0])
                clock = [0]
                service._ask_results = TTLCache(
                    maxsize=2, ttl=1, timer=lambda: clock[0]
                )
                history = AsyncMock(
                    return_value={"formatted_output": {"documents": []}}
                )
                service._pipelines["historical_question"] = types.SimpleNamespace(
                    run=history
                )
                background = BackgroundTasks()
                request = AskRequest(query="Original", id="a" * 40, project_id="7")
                response = await create_ask(
                    request,
                    background,
                    types.SimpleNamespace(ask_service=service),
                    ServiceMetadata({}, "fixture"),
                )
                original = service._ask_results[response.query_id]
                replacement = original.model_copy(deep=True)
                if mode == "expiry":
                    clock[0] = 2
                elif mode == "stop":
                    stop = StopAskRequest(status="stopped")
                    stop.query_id = response.query_id
                    service.stop_ask(stop)
                    replacement = service._ask_results[response.query_id]
                else:
                    service._ask_results[response.query_id] = replacement
                with patch(
                    "src.providers.llm.litellm.acompletion", new_callable=AsyncMock
                ) as remote:
                    await background()
                history.assert_not_called()
                remote.assert_not_called()
                if mode == "expiry":
                    self.assertNotIn(response.query_id, service._ask_results)
                else:
                    self.assertIs(service._ask_results[response.query_id], replacement)

    async def test_classification_lifetime_cannot_revive_or_dispatch_a_retired_query(
        self,
    ):
        for phase in (
            "historical_question",
            "sql_pairs_retrieval",
            "intent_classification",
        ):
            for mode in ("expiry", "replacement", "stop"):
                for outcome in ("return", "error", "pending"):
                    with self.subTest(phase=phase, mode=mode, outcome=outcome):
                        service, _, _ = self.service(self.pipelines[0])
                        clock = [0]
                        service._ask_results = TTLCache(
                            maxsize=2, ttl=1, timer=lambda: clock[0]
                        )
                        entered, release = asyncio.Event(), asyncio.Event()
                        calls = []

                        def runner(name):
                            async def run(**kwargs):
                                calls.append(name)
                                if name == phase:
                                    entered.set()
                                    await release.wait()
                                    if outcome == "error":
                                        raise RuntimeError("old classification failed")
                                    if outcome == "pending":
                                        raise NativeQueryPending()
                                return (
                                    {
                                        "post_process": {
                                            "intent": "GENERAL",
                                            "db_schemas": [],
                                        }
                                    }
                                    if name == "intent_classification"
                                    else {"formatted_output": {"documents": []}}
                                )

                            return types.SimpleNamespace(run=run)

                        for name in (
                            "historical_question",
                            "sql_pairs_retrieval",
                            "instructions_retrieval",
                            "intent_classification",
                        ):
                            service._pipelines[name] = runner(name)
                        request = AskRequest(
                            query="Original", id="a" * 40, project_id="7"
                        )
                        request.query_id = "original"
                        with patch(
                            "src.providers.llm.litellm.acompletion",
                            new_callable=AsyncMock,
                        ) as remote:
                            pending = asyncio.create_task(service.ask(request))
                            await asyncio.wait_for(entered.wait(), 2)
                            original = service._ask_results["original"]
                            replacement = original.model_copy(deep=True)
                            if mode == "expiry":
                                clock[0] = 2
                            elif mode == "stop":
                                stop = StopAskRequest(status="stopped")
                                stop.query_id = "original"
                                service.stop_ask(stop)
                                replacement = service._ask_results["original"]
                            else:
                                service._ask_results["original"] = replacement
                            prior_calls = list(calls)
                            release.set()
                            await asyncio.wait_for(pending, 2)
                            await asyncio.sleep(0)
                        self.assertEqual(calls, prior_calls)
                        remote.assert_not_called()
                        if mode == "expiry":
                            self.assertNotIn("original", service._ask_results)
                        else:
                            self.assertIs(service._ask_results["original"], replacement)
                            self.assertIsNone(replacement.completion)

    async def test_owned_classification_still_dispatches_original_general_provider_once(
        self,
    ):
        for entry in self.pipelines:
            with self.subTest(pipeline=entry[1]):
                service, _, _ = self.service(entry)
                for name in (
                    "historical_question",
                    "sql_pairs_retrieval",
                    "instructions_retrieval",
                ):
                    service._pipelines[name] = types.SimpleNamespace(
                        run=AsyncMock(
                            return_value={"formatted_output": {"documents": []}}
                        )
                    )
                service._pipelines["intent_classification"] = types.SimpleNamespace(
                    run=AsyncMock(
                        return_value={
                            "post_process": {"intent": entry[3], "db_schemas": []}
                        }
                    )
                )
                request = AskRequest(query="Original", id="a" * 40, project_id="7")
                request.query_id = "original"

                async def stream():
                    yield self.chunk("owned full", "stop")

                async def completed():
                    while service._ask_results["original"].completion is None:
                        await asyncio.sleep(0)

                with patch(
                    "src.providers.llm.litellm.acompletion",
                    AsyncMock(return_value=stream()),
                ) as remote:
                    await service.ask(request)
                    await asyncio.wait_for(completed(), 2)
                self.assertEqual(remote.await_count, 1)
                self.assertEqual(
                    service._ask_results["original"].completion.content, "owned full"
                )

    async def test_sql_stages_keep_native_owner_and_original_success_or_pending_semantics(
        self,
    ):
        phases = (
            "db_schema_retrieval",
            "sql_generation_reasoning",
            "sql_functions_retrieval",
            "sql_generation",
            "sql_diagnosis",
            "sql_correction",
        )
        for phase in (*phases, "owned"):
            for mode in (
                ("expiry", "replacement", "stop") if phase != "owned" else ("success",)
            ):
                with self.subTest(phase=phase, mode=mode):
                    clock = [0]
                    service = AskService(
                        {},
                        allow_intent_classification=False,
                        max_sql_correction_retries=1,
                    )
                    service._ask_results = TTLCache(
                        maxsize=2, ttl=1, timer=lambda: clock[0]
                    )
                    entered, release = asyncio.Event(), asyncio.Event()
                    calls = []
                    outputs = {
                        "historical_question": {"formatted_output": {"documents": []}},
                        "sql_pairs_retrieval": {"formatted_output": {"documents": []}},
                        "instructions_retrieval": {
                            "formatted_output": {"documents": []}
                        },
                        "db_schema_retrieval": {
                            "construct_retrieval_results": {
                                "retrieval_results": [
                                    {
                                        "table_name": "original",
                                        "table_ddl": "CREATE TABLE original (id int)",
                                    }
                                ]
                            }
                        },
                        "sql_generation_reasoning": {
                            "post_process": "original reasoning"
                        },
                        "sql_functions_retrieval": [],
                        "sql_generation": {
                            "post_process": {
                                "valid_generation_result": None,
                                "invalid_generation_result": {
                                    "type": "INVALID_SQL",
                                    "original_sql": "SELECT wrong",
                                    "sql": "SELECT wrong",
                                    "error": "invalid",
                                },
                            }
                        },
                        "sql_diagnosis": {
                            "post_process": {"reasoning": "original correction"}
                        },
                        "sql_correction": {
                            "post_process": {
                                "valid_generation_result": {"sql": "SELECT 1"},
                                "invalid_generation_result": None,
                            }
                        },
                    }

                    def runner(name):
                        async def run(**kwargs):
                            calls.append(name)
                            if name == phase:
                                entered.set()
                                await release.wait()
                            return outputs[name]

                        return types.SimpleNamespace(run=run)

                    service._pipelines = {name: runner(name) for name in outputs}
                    request = AskRequest(query="Original", id="a" * 40, project_id="7")
                    request.query_id = "original"
                    pending = asyncio.create_task(service.ask(request))
                    if phase != "owned":
                        await asyncio.wait_for(entered.wait(), 2)
                        original = service._ask_results["original"]
                        replacement = original.model_copy(deep=True)
                        if mode == "expiry":
                            clock[0] = 2
                        elif mode == "stop":
                            stop = StopAskRequest(status="stopped")
                            stop.query_id = "original"
                            service.stop_ask(stop)
                            replacement = service._ask_results["original"]
                        else:
                            service._ask_results["original"] = replacement
                        prior_calls = list(calls)
                        release.set()
                    await asyncio.wait_for(pending, 2)
                    if phase == "owned":
                        self.assertEqual(
                            service._ask_results["original"].status, "finished"
                        )
                        self.assertEqual(
                            service._ask_results["original"].response[0].sql, "SELECT 1"
                        )
                        self.assertEqual(calls, list(outputs))
                    else:
                        self.assertEqual(calls, prior_calls)
                        if mode == "expiry":
                            self.assertNotIn("original", service._ask_results)
                        else:
                            self.assertIs(service._ask_results["original"], replacement)

    async def test_tail_observer_is_not_completed_but_original_result_can_be_reobserved(
        self,
    ):
        for entry in self.pipelines:
            with self.subTest(pipeline=entry[1]):
                service, pipeline, expected = self.service(entry)
                entered, release = asyncio.Event(), asyncio.Event()

                async def stream():
                    yield self.chunk("prefix ")
                    entered.set()
                    await release.wait()
                    yield self.chunk("tail", "stop")

                with patch(
                    "src.providers.llm.litellm.acompletion",
                    AsyncMock(return_value=stream()),
                ) as remote:
                    producer = asyncio.create_task(
                        service._generate_general(
                            entry[1], expected, **self.request(entry[1])
                        )
                    )
                    await asyncio.wait_for(entered.wait(), 2)
                    self.assertEqual(
                        await pipeline._user_queues["original"].get(), "prefix "
                    )
                    observer = asyncio.create_task(self.events(service))
                    await asyncio.sleep(0)
                    release.set()
                    await producer
                    observed = await asyncio.wait_for(observer, 2)
                self.assertEqual(observed, [{"message": "tail"}])
                self.assertEqual(
                    await self.events(service),
                    [{"message": "prefix tail"}, {"done": True, "queryId": "original"}],
                )
                self.assertEqual(remote.await_count, 1)

    async def test_truncated_filtered_or_missing_finish_is_never_a_general_completion(
        self,
    ):
        for reason in ("length", "content_filter", None):
            service, _, expected = self.service(self.pipelines[0])

            async def stream():
                yield self.chunk("partial", reason)

            with patch(
                "src.providers.llm.litellm.acompletion",
                AsyncMock(return_value=stream()),
            ):
                await service._generate_general(
                    "data_assistance", expected, **self.request("data_assistance")
                )
            self.assertIsNone(expected.completion)
            self.assertEqual(await self.events(service), [{"message": "partial"}])

    async def test_lost_provider_return_does_not_regenerate_or_publish_completion(self):
        service, pipeline, expected = self.service(self.pipelines[0])

        async def stream():
            yield self.chunk("partial")
            raise openai.APIError(
                "fixture interrupted",
                request=httpx.Request(
                    "POST", "https://gateway.example/v1/chat/completions"
                ),
                body=None,
            )

        with patch(
            "src.providers.llm.litellm.acompletion", AsyncMock(return_value=stream())
        ) as remote:
            await service._generate_general(
                "data_assistance", expected, **self.request("data_assistance")
            )
        self.assertIsNone(expected.completion)
        self.assertEqual(remote.await_count, 1)
        self.assertEqual(pipeline._user_queues["original"].qsize(), 1)

    async def test_actual_ttl_expiry_replacement_and_stop_cannot_be_revived(self):
        for mode in ("expiry", "replacement", "stop"):
            with self.subTest(mode=mode):
                service, _, expected = self.service(self.pipelines[0])
                clock = [0]
                service._ask_results = TTLCache(
                    maxsize=2, ttl=1, timer=lambda: clock[0]
                )
                service._ask_results["original"] = expected

                async def stream():
                    yield self.chunk("old")
                    if mode == "expiry":
                        clock[0] = 2
                    else:
                        service._ask_results["original"] = AskResultResponse(
                            status="stopped" if mode == "stop" else "understanding"
                        )
                    yield self.chunk(" result", "stop")

                with patch(
                    "src.providers.llm.litellm.acompletion",
                    AsyncMock(return_value=stream()),
                ):
                    await service._generate_general(
                        "data_assistance", expected, **self.request("data_assistance")
                    )
                self.assertIsNone(expected.completion)
                if mode == "expiry":
                    self.assertNotIn("original", service._ask_results)
                else:
                    self.assertIsNone(service._ask_results["original"].completion)

    async def test_native_fastapi_get_exposes_only_optional_same_task_completion(self):
        service, _, expected = self.service(self.pipelines[0])
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_service_container] = lambda: types.SimpleNamespace(
            ask_service=service
        )
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://fixture"
        ) as client:
            before = await client.get("/asks/original/result")
            self.assertEqual(before.json()["status"], "finished")
            self.assertIsNone(before.json()["completion"])

            async def stream():
                yield self.chunk("original complete", "stop")

            with patch(
                "src.providers.llm.litellm.acompletion",
                AsyncMock(return_value=stream()),
            ):
                await service._generate_general(
                    "data_assistance", expected, **self.request("data_assistance")
                )
            after = await client.get("/asks/original/result")
            self.assertEqual(
                after.json()["completion"],
                {"query_id": "original", "content": "original complete"},
            )
            self.assertNotIn("general_type", after.json())
            self.assertEqual(
                (await client.get("/asks/missing/result")).status_code, 404
            )


if __name__ == "__main__":
    unittest.main()


class NativeRecommendationTaskIdentity(unittest.IsolatedAsyncioTestCase):
    """The original FastAPI task-ID consumer, not a durable AI task claim."""

    async def test_reserved_native_id_is_used_for_original_background_and_get(self):
        from src.web.v1.routers.question_recommendation import router as recommendations
        from src.web.v1.services.question_recommendation import QuestionRecommendation

        service = QuestionRecommendation({})
        service.recommend = AsyncMock()
        app = FastAPI()
        app.include_router(recommendations)
        app.dependency_overrides[get_service_container] = lambda: types.SimpleNamespace(
            question_recommendation=service
        )
        app.dependency_overrides[get_service_metadata] = lambda: ServiceMetadata({}, "fixture")
        task_id = str(uuid4())
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fixture") as client:
            payload = {"native_task_id": task_id, "mdl": "original-model", "previous_questions": ["Original question"]}
            response = await client.post("/question-recommendations", json=payload)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), {"id": task_id})
            service.recommend.assert_awaited_once()
            request = service.recommend.await_args.args[0]
            self.assertEqual(request.event_id, task_id)
            self.assertNotIn("native_task_id", request.model_dump())
            observed = await client.get(f"/question-recommendations/{task_id}")
            self.assertEqual(observed.status_code, 200)
            self.assertEqual(observed.json()["id"], task_id)
            self.assertEqual(observed.json()["status"], "generating")
            duplicate = await client.post("/question-recommendations", json=payload)
            self.assertEqual(duplicate.status_code, 409)
            service.recommend.assert_awaited_once()
            # TTL/process-cache absence remains the original missing result;
            # this is not proof of NOT_STARTED and the UI must not POST again.
            service._cache.clear()
            missing = await client.get(f"/question-recommendations/{task_id}")
            self.assertEqual(missing.json()["error"]["code"], "RESOURCE_NOT_FOUND")
            service.recommend.assert_awaited_once()

    async def test_original_standalone_without_reserved_id_still_assigns_a_native_uuid(self):
        from src.web.v1.routers.question_recommendation import router as recommendations
        from src.web.v1.services.question_recommendation import QuestionRecommendation
        from uuid import UUID

        service = QuestionRecommendation({})
        service.recommend = AsyncMock()
        app = FastAPI()
        app.include_router(recommendations)
        app.dependency_overrides[get_service_container] = lambda: types.SimpleNamespace(question_recommendation=service)
        app.dependency_overrides[get_service_metadata] = lambda: ServiceMetadata({}, "fixture")
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fixture") as client:
            response = await client.post("/question-recommendations", json={"mdl": "original-model"})
        self.assertEqual(response.status_code, 200)
        task_id = response.json()["id"]
        self.assertEqual(str(UUID(task_id)), task_id)
        self.assertEqual(service.recommend.await_args.args[0].event_id, task_id)
