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
from fastapi import FastAPI
from hamilton.async_driver import AsyncDriver

from src.providers.engine.native_identity import NativeQueryPending, native_ask_context
from src.web.v1.routers.ask import router
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
