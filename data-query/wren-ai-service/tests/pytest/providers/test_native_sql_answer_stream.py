"""Run the original SQL-answer producer/consumer with only dependency boundaries substituted."""

import asyncio
from dataclasses import dataclass
import importlib.util
import json
from pathlib import Path
import sys
import types
import unittest
from uuid import UUID, uuid4
from unittest.mock import AsyncMock, patch


ROOT = Path(__file__).resolve().parents[3]


def decorator(*args, **kwargs):
    if len(args) == 1 and callable(args[0]):
        return args[0]
    return lambda value: value


class Model:
    def __init__(self, **values):
        if "sql_pairs" in values:
            values["sql_pairs"] = [Model(**value) if isinstance(value, dict) else value for value in values["sql_pairs"]]
        self.__dict__.update(values)

    def model_dump(self, **kwargs):
        return json.loads(json.dumps(self.__dict__, default=lambda value: value.model_dump() if hasattr(value, "model_dump") else str(value)))

    def with_metadata(self):
        return self


class HTTPException(Exception):
    def __init__(self, status_code, detail):
        self.status_code = status_code
        super().__init__(detail)


class Router:
    post = get = patch = delete = staticmethod(lambda *args, **kwargs: decorator)


@dataclass
class Metadata:
    source: str = "isolated-native-fixture"


class Event(Model):
    SSEEventMessage = Model

    def serialize(self):
        return f"data: {json.dumps(self.data.__dict__)}\n\n"


def load_original(name, path, dependencies=None):
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
        "pydantic": types.SimpleNamespace(BaseModel=Model, Field=lambda *args, **kwargs: None, AliasChoices=lambda *args: args),
        "fastapi": types.SimpleNamespace(HTTPException=HTTPException, APIRouter=Router,
            BackgroundTasks=Model, Response=Model, Depends=lambda value: value),
        "fastapi.responses": types.SimpleNamespace(StreamingResponse=Model),
        "src.globals": types.SimpleNamespace(ServiceContainer=Model, ServiceMetadata=Metadata,
            get_service_container=lambda: None, get_service_metadata=lambda: None),
    }
    modules.update(dependencies or {})
    with patch.dict(sys.modules, modules):
        source = importlib.util.spec_from_file_location(name, ROOT / path)
        module = importlib.util.module_from_spec(source)
        sys.modules[name] = module
        source.loader.exec_module(module)
        return module


def load_router(name, path, dependency, service):
    with patch.dict(sys.modules, {dependency: service}):
        return load_original(name, path)


pipeline_module = load_original("native_sql_answer_pipeline", "src/pipelines/generation/sql_answer.py")
service_module = load_original("native_sql_answer_service", "src/web/v1/services/sql_answer.py")
chart_module = load_original("native_chart_service", "src/web/v1/services/chart.py")
adjustment_module = load_original("native_chart_adjustment_service", "src/web/v1/services/chart_adjustment.py")
answer_router = load_router("native_answer_router", "src/web/v1/routers/sql_answers.py",
    "src.web.v1.services.sql_answer", service_module)
chart_router = load_router("native_chart_router", "src/web/v1/routers/chart.py",
    "src.web.v1.services.chart", chart_module)
adjustment_router = load_router("native_adjustment_router", "src/web/v1/routers/chart_adjustment.py",
    "src.web.v1.services.chart_adjustment", adjustment_module)
ask_module = load_original("native_ask_service", "src/web/v1/services/ask.py")
ask_router = load_router("native_ask_router", "src/web/v1/routers/ask.py",
    "src.web.v1.services.ask", ask_module)
feedback_module = load_original("native_feedback_service", "src/web/v1/services/ask_feedback.py", {
    "src.web.v1.services.ask": ask_module,
})
feedback_router = load_router("native_feedback_router", "src/web/v1/routers/ask_feedbacks.py",
    "src.web.v1.services.ask_feedback", feedback_module)
sql_pairs_module = load_original("native_sql_pairs_service", "src/web/v1/services/sql_pairs.py", {
    "src.web.v1.services": types.SimpleNamespace(BaseRequest=Model, MetadataTraceable=type("MetadataTraceable", (), {})),
    "src.pipelines.indexing.sql_pairs": types.SimpleNamespace(SqlPair=Model),
})
sql_pairs_router = load_original("native_sql_pairs_router", "src/web/v1/routers/sql_pairs.py", {
    "src.web.v1.services": types.SimpleNamespace(BaseRequest=Model, SqlPairsService=sql_pairs_module.SqlPairsService),
    "src.pipelines.indexing.sql_pairs": types.SimpleNamespace(SqlPair=Model),
})
general_modules = [
    (load_original(f"native_{name}_pipeline", f"src/pipelines/generation/{name}.py", {"src.web.v1.services.ask": ask_module}), name, class_name, general_type)
    for name, class_name, general_type in [
        ("data_assistance", "DataAssistance", "DATA_ASSISTANCE"),
        ("user_guide_assistance", "UserGuideAssistance", "USER_GUIDE"),
        ("misleading_assistance", "MisleadingAssistance", "MISLEADING_QUERY"),
    ]
]
reasoning_modules = [
    (load_original(f"native_{name}_pipeline", f"src/pipelines/generation/{name}.py", {
        "src.web.v1.services.ask": ask_module,
        "src.pipelines.generation.utils.sql": types.SimpleNamespace(construct_instructions=lambda value: value, sql_generation_reasoning_system_prompt="original"),
    }), name, class_name)
    for name, class_name in [("sql_generation_reasoning", "SQLGenerationReasoning"), ("followup_sql_generation_reasoning", "FollowUpSQLGenerationReasoning")]
]


class NativeSqlAnswerStream(unittest.IsolatedAsyncioTestCase):
    async def test_original_sql_pair_create_and_delete_keep_the_claimed_id_and_never_repeat_pending_or_finished_events(self):
        pipeline = types.SimpleNamespace(run=AsyncMock(), clean=AsyncMock())
        service = sql_pairs_module.SqlPairsService({"sql_pairs": pipeline})
        container = types.SimpleNamespace(sql_pairs_service=service)
        scheduled = []
        background = types.SimpleNamespace(add_task=lambda *args, **kwargs: scheduled.append((args, kwargs)))
        identifier = uuid4()
        request = sql_pairs_router.PostRequest(native_task_id=identifier, project_id="original-project", sql_pairs=[Model(id="7", sql="SELECT 1", question="Original")], request_from="ui")
        self.assertEqual((await sql_pairs_router.prepare(request, background, container, Metadata())).event_id, str(identifier))
        self.assertEqual((await sql_pairs_router.prepare(request, background, container, Metadata())).event_id, str(identifier))
        self.assertEqual(len(scheduled), 1)
        with self.assertRaises(HTTPException) as conflict:
            await sql_pairs_router.prepare(sql_pairs_router.PostRequest(**{**request.model_dump(), "native_task_id": identifier, "project_id": "another-project"}), background, container, Metadata())
        self.assertEqual(conflict.exception.status_code, 409)
        args, kwargs = scheduled[0]
        await args[0](*args[1:], **kwargs)
        self.assertEqual((await sql_pairs_router.get(str(identifier), container)).status, "finished")
        await sql_pairs_router.prepare(request, background, container, Metadata())
        self.assertEqual(len(scheduled), 1)
        pipeline.run.assert_awaited_once()
        delete_id = uuid4()
        deletion = sql_pairs_router.DeleteRequest(native_task_id=delete_id, project_id="original-project", sql_pair_ids=["7"], request_from="ui")
        response = Model(status_code=200)
        await sql_pairs_router.delete(deletion, response, container, Metadata())
        await sql_pairs_router.delete(deletion, response, container, Metadata())
        pipeline.clean.assert_awaited_once()
        self.assertEqual((await sql_pairs_router.get(str(delete_id), container)).status, "finished")

    async def test_original_sql_pair_missing_cache_is_unknown_not_failed_and_observation_never_dispatches(self):
        pipeline = types.SimpleNamespace(run=AsyncMock(), clean=AsyncMock())
        service = sql_pairs_module.SqlPairsService({"sql_pairs": pipeline})
        missing = str(uuid4())
        response = await sql_pairs_router.get(missing, types.SimpleNamespace(sql_pairs_service=service))
        self.assertEqual(response.event_id, missing)
        self.assertEqual(response.status, "unknown")
        pipeline.run.assert_not_awaited()
        pipeline.clean.assert_not_awaited()

    async def test_original_create_routers_keep_the_persisted_id_and_offer_read_only_observation(self):
        for router, service, member, create, read in [
            (answer_router, service_module.SqlAnswerService({}), "sql_answer_service", "sql_answer", "get_sql_answer_result"),
            (chart_router, chart_module.ChartService({}), "chart_service", "chart", "get_chart_result"),
            (adjustment_router, adjustment_module.ChartAdjustmentService({}), "chart_adjustment_service", "chart_adjustment", "get_chart_adjustment_result"),
            (ask_router, ask_module.AskService({}), "ask_service", "ask", "get_ask_result"),
            (feedback_router, feedback_module.AskFeedbackService({}), "ask_feedback_service", "ask_feedback", "get_ask_feedback_result"),
        ]:
            with self.subTest(create=create):
                identifier = uuid4()
                request = types.SimpleNamespace(native_task_id=identifier)
                container = types.SimpleNamespace(**{member: service})
                scheduled = []
                background = types.SimpleNamespace(add_task=lambda *args, **kwargs: scheduled.append((args, kwargs)))
                response = await getattr(router, create)(request, background, container, Metadata())
                self.assertEqual(response.query_id, str(identifier))
                self.assertEqual(request.query_id, str(identifier))
                self.assertEqual(len(scheduled), 1)
                self.assertEqual(scheduled[0][0][0], getattr(service, create))
                observed = await getattr(router, read)(str(identifier), container)
                self.assertIn(observed.status, ["preprocessing", "fetching", "understanding", "searching"])
                # Simulate loss of the HTTP create acknowledgement: only GET the
                # already persisted ID. Observation never schedules native work.
                self.assertIs(await getattr(router, read)(str(identifier), container), observed)
                self.assertEqual(len(scheduled), 1)
                with self.assertRaises(HTTPException) as caught:
                    await getattr(router, create)(request, background, container, Metadata())
                self.assertEqual(caught.exception.status_code, 409)
                self.assertIs(await getattr(router, read)(str(identifier), container), observed)
                self.assertEqual(len(scheduled), 1)

    async def test_original_standalone_create_routers_still_allocate_native_ids(self):
        for router, service, member, create in [
            (answer_router, service_module.SqlAnswerService({}), "sql_answer_service", "sql_answer"),
            (chart_router, chart_module.ChartService({}), "chart_service", "chart"),
            (adjustment_router, adjustment_module.ChartAdjustmentService({}), "chart_adjustment_service", "chart_adjustment"),
            (ask_router, ask_module.AskService({}), "ask_service", "ask"),
            (feedback_router, feedback_module.AskFeedbackService({}), "ask_feedback_service", "ask_feedback"),
        ]:
            with self.subTest(create=create):
                scheduled = []
                background = types.SimpleNamespace(add_task=lambda *args, **kwargs: scheduled.append(args))
                container = types.SimpleNamespace(**{member: service})
                first = await getattr(router, create)(types.SimpleNamespace(native_task_id=None), background, container, Metadata())
                second = await getattr(router, create)(types.SimpleNamespace(native_task_id=None), background, container, Metadata())
                self.assertNotEqual(first.query_id, second.query_id)
                self.assertEqual(str(UUID(first.query_id)), first.query_id)
                self.assertEqual(len(scheduled), 2)

    async def test_original_feedback_missing_observation_cannot_invent_a_failed_result(self):
        service = feedback_module.AskFeedbackService({})
        with self.assertRaises(HTTPException) as caught:
            await feedback_router.get_ask_feedback_result(
                str(uuid4()), types.SimpleNamespace(ask_feedback_service=service)
            )
        self.assertEqual(caught.exception.status_code, 404)
        self.assertEqual(service._ask_feedback_results, {})

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

    async def test_original_general_pipelines_produce_done_only_after_provider_returns_without_cross_task_chunks(self):
        for module, name, class_name, general_type in general_modules:
            with self.subTest(pipeline=name):
                pipeline = object.__new__(getattr(module, class_name))
                pipeline._user_queues = {}
                pipeline._components = {}
                pipeline._configs = {}
                pipeline._pipe = types.SimpleNamespace(execute=AsyncMock(return_value={"native": "result"}))
                service = ask_module.AskService({name: pipeline})
                for identifier in ["first", "second"]:
                    pipeline._streaming_callback(types.SimpleNamespace(content=identifier, meta={"finish_reason": "stop"}), identifier)
                    self.assertEqual(pipeline._user_queues[identifier].qsize(), 1)
                    await pipeline.run(query="question", language="Chinese", query_id=identifier, **({"db_schemas": []} if name != "user_guide_assistance" else {}))
                    service._ask_results[identifier] = types.SimpleNamespace(type="GENERAL", general_type=general_type)
                async def read(identifier):
                    return [json.loads(event.removeprefix("data: ")) async for event in service.get_ask_streaming_result(identifier)]
                first, second = await asyncio.gather(read("first"), read("second"))
                self.assertEqual(first, [{"message": "first"}, {"done": True, "queryId": "first"}])
                self.assertEqual(second, [{"message": "second"}, {"done": True, "queryId": "second"}])

    async def test_original_general_timeout_or_provider_failure_never_fabricates_native_done(self):
        for module, name, class_name, general_type in general_modules:
            with self.subTest(pipeline=name):
                pipeline = object.__new__(getattr(module, class_name))
                pipeline._user_queues = {}
                pipeline._components = {}
                pipeline._configs = {}
                pipeline._pipe = types.SimpleNamespace(execute=AsyncMock(side_effect=RuntimeError("lost provider finish")))
                pipeline._streaming_callback(types.SimpleNamespace(content="partial", meta={"finish_reason": "stop"}), "first")
                with self.assertRaisesRegex(RuntimeError, "lost provider"):
                    await pipeline.run(query="question", language="Chinese", query_id="first", **({"db_schemas": []} if name != "user_guide_assistance" else {}))
                self.assertEqual(pipeline._user_queues["first"].qsize(), 1)
                service = ask_module.AskService({name: pipeline})
                service._ask_results["first"] = types.SimpleNamespace(type="GENERAL", general_type=general_type)
                async def timeout(awaitable, **kwargs):
                    awaitable.close()
                    raise TimeoutError()
                with patch.object(module.asyncio, "wait_for", timeout):
                    events = [event async for event in service.get_ask_streaming_result("first")]
                self.assertEqual(events, [])
                with self.assertRaises(HTTPException) as caught:
                    service.get_ask_result(types.SimpleNamespace(query_id="missing"))
                self.assertEqual(caught.exception.status_code, 404)

    async def test_original_planning_and_followup_generators_emit_only_real_provider_completion_for_the_owned_task(self):
        for module, name, class_name in reasoning_modules:
            with self.subTest(pipeline=name):
                pipeline = object.__new__(getattr(module, class_name))
                pipeline._user_queues = {}
                pipeline._components = {}
                pipeline._pipe = types.SimpleNamespace(execute=AsyncMock(return_value={"post_process": "original"}))
                pipeline._streaming_callback(types.SimpleNamespace(content="原生思考", meta={"finish_reason": "stop"}), "owned")
                self.assertEqual(pipeline._user_queues["owned"].qsize(), 1)
                await pipeline.run(query="question", contexts=[], query_id="owned", **({"histories": []} if name.startswith("followup") else {}))
                service = ask_module.AskService({name: pipeline})
                service._ask_results["owned"] = types.SimpleNamespace(type="TEXT_TO_SQL", status="planning", is_followup=name.startswith("followup"))
                events = [json.loads(event.removeprefix("data: ")) async for event in service.get_ask_streaming_result("owned")]
                self.assertEqual(events, [{"message": "原生思考"}, {"done": True, "queryId": "owned"}])

    async def test_original_planning_provider_failure_and_queue_timeout_have_no_done_receipt(self):
        for module, name, class_name in reasoning_modules:
            with self.subTest(pipeline=name):
                pipeline = object.__new__(getattr(module, class_name))
                pipeline._user_queues = {}
                pipeline._components = {}
                pipeline._pipe = types.SimpleNamespace(execute=AsyncMock(side_effect=RuntimeError("provider finish lost")))
                with self.assertRaisesRegex(RuntimeError, "provider finish lost"):
                    await pipeline.run(query="question", contexts=[], query_id="owned", **({"histories": []} if name.startswith("followup") else {}))
                service = ask_module.AskService({name: pipeline})
                service._ask_results["owned"] = types.SimpleNamespace(type="TEXT_TO_SQL", status="planning", is_followup=name.startswith("followup"))
                async def timeout(awaitable, **kwargs):
                    awaitable.close()
                    raise TimeoutError()
                with patch.object(module.asyncio, "wait_for", timeout):
                    events = [event async for event in service.get_ask_streaming_result("owned")]
                self.assertEqual(events, [])


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
