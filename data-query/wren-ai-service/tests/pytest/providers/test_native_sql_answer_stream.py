"""Run the original SQL-answer producer/consumer with only dependency boundaries substituted."""

import asyncio
import importlib.util
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import AsyncMock, patch


ROOT = Path(__file__).resolve().parents[3]


def decorator(*args, **kwargs):
    if len(args) == 1 and callable(args[0]):
        return args[0]
    return lambda value: value


class Model:
    def __init__(self, **values):
        self.__dict__.update(values)


class HTTPException(Exception):
    def __init__(self, status_code, detail):
        self.status_code = status_code
        super().__init__(detail)


class Event(Model):
    SSEEventMessage = Model

    def serialize(self):
        return f"data: {json.dumps(self.data.__dict__)}\n\n"


def load_original(name, path):
    configuration = type("Configuration", (), {"show_current_time": lambda _: "fixture-time"})
    modules = {
        "hamilton": types.SimpleNamespace(base=types.SimpleNamespace(DictResult=object)),
        "hamilton.async_driver": types.SimpleNamespace(AsyncDriver=object),
        "haystack.components.builders.prompt_builder": types.SimpleNamespace(PromptBuilder=object),
        "langfuse.decorators": types.SimpleNamespace(observe=decorator),
        "src.core.pipeline": types.SimpleNamespace(BasicPipeline=object),
        "src.core.provider": types.SimpleNamespace(LLMProvider=object),
        "src.pipelines.common": types.SimpleNamespace(clean_up_new_lines=lambda value: value),
        "src.utils": types.SimpleNamespace(trace_cost=decorator, trace_metadata=decorator),
        "src.web.v1.services": types.SimpleNamespace(Configuration=configuration, BaseRequest=Model, SSEEvent=Event),
        "cachetools": types.SimpleNamespace(TTLCache=lambda **kwargs: {}),
        "pydantic": types.SimpleNamespace(BaseModel=Model),
        "fastapi": types.SimpleNamespace(HTTPException=HTTPException),
    }
    with patch.dict(sys.modules, modules):
        source = importlib.util.spec_from_file_location(name, ROOT / path)
        module = importlib.util.module_from_spec(source)
        sys.modules[name] = module
        source.loader.exec_module(module)
        return module


pipeline_module = load_original("native_sql_answer_pipeline", "src/pipelines/generation/sql_answer.py")
service_module = load_original("native_sql_answer_service", "src/web/v1/services/sql_answer.py")
chart_module = load_original("native_chart_service", "src/web/v1/services/chart.py")
adjustment_module = load_original("native_chart_adjustment_service", "src/web/v1/services/chart_adjustment.py")


class NativeSqlAnswerStream(unittest.IsolatedAsyncioTestCase):
    def pipeline(self):
        pipeline = object.__new__(pipeline_module.SQLAnswer)
        pipeline._user_queues = {}
        pipeline._components = {}
        pipeline._pipe = types.SimpleNamespace(execute=AsyncMock(return_value={"generate_answer": "native-provider-result"}))
        return pipeline

    def service(self, pipeline, ids):
        service = service_module.SqlAnswerService({"sql_answer": pipeline})
        for identifier in ids:
            service._sql_answer_results[identifier] = types.SimpleNamespace(status="succeeded")
        return service

    async def test_original_producer_and_service_emit_exact_native_completion_after_provider_returns(self):
        pipeline = self.pipeline()
        pipeline._streaming_callback(types.SimpleNamespace(content="<DONE>", meta={"finish_reason": "stop"}), "first")
        # Model text/finish hints cannot settle the original task before the provider returns.
        self.assertEqual(pipeline._user_queues["first"].qsize(), 1)
        await pipeline.run("question", "SQL", {}, "Chinese", query_id="first")
        events = [event async for event in self.service(pipeline, ["first"]).get_sql_answer_streaming_result("first")]
        self.assertEqual([json.loads(event.removeprefix("data: ")) for event in events], [
            {"message": "<DONE>"}, {"done": True, "queryId": "first"},
        ])
        self.assertNotIn("first", pipeline._user_queues)

    async def test_original_timeout_has_no_completion_receipt(self):
        pipeline = self.pipeline()
        async def timeout(awaitable, **kwargs):
            awaitable.close()
            raise TimeoutError()
        with patch.object(pipeline_module.asyncio, "wait_for", timeout):
            events = [event async for event in self.service(pipeline, ["first"]).get_sql_answer_streaming_result("first")]
        self.assertEqual(events, [])

    async def test_original_provider_failure_never_enqueues_completion(self):
        pipeline = self.pipeline()
        pipeline._streaming_callback(types.SimpleNamespace(content="partial", meta={"finish_reason": "stop"}), "first")
        pipeline._pipe.execute.side_effect = RuntimeError("provider lost final acknowledgement")
        with self.assertRaisesRegex(RuntimeError, "provider lost"):
            await pipeline.run("question", "SQL", {}, "Chinese", query_id="first")
        self.assertEqual(pipeline._user_queues["first"].qsize(), 1)
        self.assertEqual(await pipeline._user_queues["first"].get(), "partial")

    async def test_two_original_native_tasks_do_not_share_chunk_state(self):
        pipeline = self.pipeline()
        for identifier in ["first", "second"]:
            pipeline._streaming_callback(types.SimpleNamespace(content=identifier, meta={}), identifier)
            await pipeline.run("question", "SQL", {}, "Chinese", query_id=identifier)
        service = self.service(pipeline, ["first", "second"])
        async def read(identifier):
            return [json.loads(event.removeprefix("data: ")) async for event in service.get_sql_answer_streaming_result(identifier)]
        first, second = await asyncio.gather(read("first"), read("second"))
        self.assertEqual(first, [{"message": "first"}, {"done": True, "queryId": "first"}])
        self.assertEqual(second, [{"message": "second"}, {"done": True, "queryId": "second"}])

    async def test_original_missing_ai_task_is_not_a_fabricated_failed_terminal(self):
        service = self.service(self.pipeline(), [])
        with self.assertRaises(HTTPException) as caught:
            service.get_sql_answer_result(types.SimpleNamespace(query_id="expired-original-task"))
        self.assertEqual(caught.exception.status_code, 404)


class NativeChartData(unittest.IsolatedAsyncioTestCase):
    async def test_original_generation_and_adjustment_use_the_disclosed_data_without_sql_callback(self):
        for adjustment in [False, True]:
            with self.subTest(adjustment=adjustment):
                sql = types.SimpleNamespace(run=AsyncMock(side_effect=AssertionError("unadmitted SERVICE SQL callback")))
                result = {"reasoning": "original", "chart_type": "line", "chart_schema": {"mark": "line"}}
                pipeline = types.SimpleNamespace(run=AsyncMock(return_value={"post_process": {"results": result}}))
                data = {"columns": [{"name": "value", "type": "int"}], "data": []}
                request = types.SimpleNamespace(
                    query_id="original-chart-id", query="original", sql="SELECT value FROM native_model",
                    data=data, request_from="ui", project_id="original-project",
                    configurations=types.SimpleNamespace(language="Chinese"),
                    remove_data_from_chart_schema=True, custom_instruction=None,
                    adjustment_option={"chart_type": "line"}, chart_schema={"mark": "bar"},
                )
                if adjustment:
                    service = adjustment_module.ChartAdjustmentService({"sql_executor": sql, "chart_adjustment": pipeline})
                    await service.chart_adjustment(request)
                    terminal = service.get_chart_adjustment_result(request)
                else:
                    service = chart_module.ChartService({"sql_executor": sql, "chart_generation": pipeline})
                    await service.chart(request)
                    terminal = service.get_chart_result(request)
                sql.run.assert_not_called()
                self.assertIs(pipeline.run.call_args.kwargs["data"], data)
                self.assertEqual(terminal.status, "finished")
                self.assertEqual(terminal.response.chart_schema, {"mark": "line"})

    async def test_original_standalone_adjustment_keeps_its_native_sql_executor(self):
        data = {"columns": [], "data": []}
        sql = types.SimpleNamespace(run=AsyncMock(return_value={"execute_sql": {"results": data}}))
        pipeline = types.SimpleNamespace(run=AsyncMock(return_value={"post_process": {"results": {
            "reasoning": "original", "chart_type": "bar", "chart_schema": {"mark": "bar"},
        }}}))
        service = adjustment_module.ChartAdjustmentService({"sql_executor": sql, "chart_adjustment": pipeline})
        request = types.SimpleNamespace(
            query_id="original-adjustment", query="original", sql="original SQL", data=None,
            request_from="ui", project_id="original-project", configurations=types.SimpleNamespace(language="English"),
            adjustment_option={"chart_type": "bar"}, chart_schema={"mark": "line"},
        )
        await service.chart_adjustment(request)
        sql.run.assert_awaited_once_with(sql=request.sql, project_id=request.project_id)
        self.assertIs(pipeline.run.call_args.kwargs["data"], data)

    async def test_missing_chart_tasks_are_unknown_not_fabricated_failed_terminals(self):
        for service, read in [
            (chart_module.ChartService({}), "get_chart_result"),
            (adjustment_module.ChartAdjustmentService({}), "get_chart_adjustment_result"),
        ]:
            with self.subTest(read=read), self.assertRaises(HTTPException) as caught:
                getattr(service, read)(types.SimpleNamespace(query_id="expired-original-id"))
            self.assertEqual(caught.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
