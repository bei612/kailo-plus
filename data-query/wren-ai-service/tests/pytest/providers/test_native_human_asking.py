"""Original FastAPI, async driver and Asking consumers; no live model or Core."""

import sys
import types
import unittest
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
from fastapi import FastAPI
from hamilton.async_driver import AsyncDriver

from src.providers.engine.native_identity import NativeQueryPending, native_ask_context
from src.web.v1.routers.ask import router
from src.globals import get_service_container, get_service_metadata, ServiceMetadata
from src.web.v1.services.ask import AskService, AskRequest, AskResultRequest


async def native_query_waiting() -> dict:
    raise NativeQueryPending()


class NativeHumanAsking(unittest.IsolatedAsyncioTestCase):
    async def test_original_fastapi_background_task_inherits_only_private_header_context(self):
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
        app.dependency_overrides[get_service_container] = lambda: types.SimpleNamespace(ask_service=service)
        app.dependency_overrides[get_service_metadata] = lambda: ServiceMetadata({}, "fixture")
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fixture") as client:
            request = {"query": "Original question", "native_task_id": task_id, "project_id": "7", "id": "a" * 40}
            headers = {"x-wren-native-authorization": "Bearer fixture-human", "x-wren-native-poll-interval-ms": "1"}
            response = await client.post("/asks", json=request, headers=headers)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), {"query_id": task_id})
            self.assertEqual((await client.post("/asks", json=request, headers=headers)).status_code, 409)
        self.assertEqual(observed, [("fixture-human", task_id, "7")])
        self.assertEqual(contexts[0].human_token, "")
        self.assertIsNone(native_ask_context.get())

    async def test_actual_hamilton_driver_preserves_pending_exception_identity(self):
        driver = AsyncDriver({}, sys.modules[__name__])
        with self.assertRaises(NativeQueryPending):
            await driver.execute(["native_query_waiting"])

    async def test_actual_original_asking_does_not_publish_failed_for_unknown_query(self):
        service = AskService({"historical_question": types.SimpleNamespace(run=AsyncMock(side_effect=NativeQueryPending()))})
        request = AskRequest(query="Original", id="a" * 40, project_id="7")
        request.query_id = str(uuid4())
        await service.ask(request)
        result = service.get_ask_result(AskResultRequest(query_id=request.query_id))
        self.assertEqual(result.status, "stopped")
        self.assertEqual(result.error.code, "OTHERS")
        self.assertEqual(result.error.message, "NATIVE_EXECUTION_UNKNOWN")
        self.assertNotIn(result.status, {"failed", "finished"})


if __name__ == "__main__":
    unittest.main()
