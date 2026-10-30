import asyncio
import logging
import json
from typing import Dict, List, Literal, Optional
from uuid import UUID

from cachetools import TTLCache
from fastapi import HTTPException
from langfuse.decorators import observe
from pydantic import AliasChoices, BaseModel, Field

from src.core.engine import SQLGenerationEmpty
from src.core.pipeline import BasicPipeline
from src.utils import trace_metadata
from src.web.v1.services import BaseRequest, SSEEvent
from src.providers.engine.native_identity import NativeQueryPending

logger = logging.getLogger("wren-ai-service")


class AskHistory(BaseModel):
    sql: str
    question: str


# POST /v1/asks
class AskRequest(BaseRequest):
    native_task_id: Optional[UUID] = None
    query: str
    # don't recommend to use id as a field name, but it's used in the older version of API spec
    # so we need to support as a choice, and will remove it in the future
    mdl_hash: Optional[str] = Field(validation_alias=AliasChoices("mdl_hash", "id"))
    histories: Optional[list[AskHistory]] = Field(default_factory=list)
    ignore_sql_generation_reasoning: bool = False
    enable_column_pruning: bool = False
    use_dry_plan: bool = False
    allow_dry_plan_fallback: bool = True
    custom_instruction: Optional[str] = None


class AskResponse(BaseModel):
    query_id: str


# PATCH /v1/asks/{query_id}
class StopAskRequest(BaseRequest):
    status: Literal["stopped"]


class StopAskResponse(BaseModel):
    query_id: str


# GET /v1/asks/{query_id}/result
class AskResult(BaseModel):
    sql: str
    type: Literal["llm", "view"] = "llm"
    viewId: Optional[str] = None


class AskError(BaseModel):
    # NO_SQL_GENERATED (Kailo): the model returned no SQL text at all.
    code: Literal["NO_RELEVANT_DATA", "NO_RELEVANT_SQL", "NO_SQL_GENERATED", "OTHERS"]
    message: str


class AskResultRequest(BaseModel):
    query_id: str


class AskCompletion(BaseModel):
    query_id: str
    content: str


class _AskResultResponse(BaseModel):
    status: Literal[
        "understanding",
        "searching",
        "planning",
        "generating",
        "correcting",
        "finished",
        "failed",
        "stopped",
    ]
    completion: Optional[AskCompletion] = None
    rephrased_question: Optional[str] = None
    intent_reasoning: Optional[str] = None
    sql_generation_reasoning: Optional[str] = None
    type: Optional[Literal["GENERAL", "TEXT_TO_SQL"]] = None
    retrieved_tables: Optional[List[str]] = None
    response: Optional[List[AskResult]] = None
    invalid_sql: Optional[str] = None
    error: Optional[AskError] = None
    trace_id: Optional[str] = None
    is_followup: bool = False
    general_type: Optional[
        Literal["MISLEADING_QUERY", "DATA_ASSISTANCE", "USER_GUIDE"]
    ] = None


class AskResultResponse(_AskResultResponse):
    is_followup: Optional[bool] = Field(False, exclude=True)
    general_type: Optional[
        Literal["MISLEADING_QUERY", "DATA_ASSISTANCE", "USER_GUIDE"]
    ] = Field(None, exclude=True)


class AskService:
    def __init__(
        self,
        pipelines: Dict[str, BasicPipeline],
        allow_intent_classification: bool = True,
        allow_sql_generation_reasoning: bool = True,
        allow_sql_functions_retrieval: bool = True,
        allow_sql_diagnosis: bool = True,
        enable_column_pruning: bool = False,
        max_sql_correction_retries: int = 3,
        max_histories: int = 5,
        maxsize: int = 1_000_000,
        ttl: int = 120,
        allow_user_guide: bool = True,
    ):
        self._pipelines = pipelines
        self._ask_results: Dict[str, AskResultResponse] = TTLCache(
            maxsize=maxsize, ttl=ttl
        )
        self._allow_sql_generation_reasoning = allow_sql_generation_reasoning
        self._allow_sql_functions_retrieval = allow_sql_functions_retrieval
        self._allow_intent_classification = allow_intent_classification
        self._allow_sql_diagnosis = allow_sql_diagnosis
        self._allow_user_guide = allow_user_guide
        self._enable_column_pruning = enable_column_pruning
        self._max_histories = max_histories
        self._max_sql_correction_retries = max_sql_correction_retries

    def _is_stopped(self, query_id: str, container: dict):
        if (
            result := container.get(query_id)
        ) is not None and result.status == "stopped":
            return True

        return False

    @observe(name="Ask Question")
    @trace_metadata
    async def ask(
        self,
        ask_request: AskRequest,
        **kwargs,
    ):
        trace_id = kwargs.get("trace_id")
        results = {
            "ask_result": {},
            "metadata": {
                "type": "",
                "error_type": "",
                "error_message": "",
                "request_from": ask_request.request_from,
            },
        }

        query_id = ask_request.query_id
        histories = ask_request.histories[: self._max_histories][
            ::-1
        ]  # reverse the order of histories
        rephrased_question = None
        intent_reasoning = None
        sql_generation_reasoning = None
        sql_samples = []
        instructions = []
        api_results = []
        table_names = []
        error_message = None
        invalid_sql = None
        allow_sql_generation_reasoning = (
            self._allow_sql_generation_reasoning
            and not ask_request.ignore_sql_generation_reasoning
        )
        enable_column_pruning = (
            self._enable_column_pruning or ask_request.enable_column_pruning
        )
        allow_sql_functions_retrieval = self._allow_sql_functions_retrieval
        allow_sql_diagnosis = self._allow_sql_diagnosis
        max_sql_correction_retries = self._max_sql_correction_retries
        current_sql_correction_retries = 0
        use_dry_plan = ask_request.use_dry_plan
        allow_dry_plan_fallback = ask_request.allow_dry_plan_fallback

        expected: Optional[AskResultResponse] = kwargs.get("expected_result")
        if expected is not None and self._ask_results.get(query_id) is not expected:
            return results

        def owns_result():
            # Only this invocation's current native cache object may advance.
            # Expiry/replacement is missing authority, not permission to recreate
            # the old task or dispatch another stage under its query ID.
            return (
                expected is not None
                and self._ask_results.get(query_id) is expected
                and expected.status != "stopped"
            )

        try:
            user_query = ask_request.query

            # ask status can be understanding, searching, generating, finished, failed, stopped
            # we will need to handle business logic for each status
            if not self._is_stopped(query_id, self._ask_results):
                self._ask_results[query_id] = expected = AskResultResponse(
                    status="understanding",
                    trace_id=trace_id,
                    is_followup=True if histories else False,
                )

                historical_question = await self._pipelines["historical_question"].run(
                    query=user_query,
                    project_id=ask_request.project_id,
                )

                if not owns_result():
                    return results

                # we only return top 1 result
                historical_question_result = historical_question.get(
                    "formatted_output", {}
                ).get("documents", [])[:1]

                if historical_question_result:
                    api_results = [
                        AskResult(
                            **{
                                "sql": result.get("statement"),
                                "type": "view" if result.get("viewId") else "llm",
                                "viewId": result.get("viewId"),
                            }
                        )
                        for result in historical_question_result
                    ]
                    sql_generation_reasoning = ""
                else:
                    # Run both pipeline operations concurrently
                    sql_samples_task, instructions_task = await asyncio.gather(
                        self._pipelines["sql_pairs_retrieval"].run(
                            query=user_query,
                            project_id=ask_request.project_id,
                        ),
                        self._pipelines["instructions_retrieval"].run(
                            query=user_query,
                            project_id=ask_request.project_id,
                            scope="sql",
                        ),
                    )

                    if not owns_result():
                        return results

                    # Extract results from completed tasks
                    sql_samples = sql_samples_task["formatted_output"].get(
                        "documents", []
                    )
                    instructions = instructions_task["formatted_output"].get(
                        "documents", []
                    )

                    if self._allow_intent_classification:
                        intent_classification_result = (
                            await self._pipelines["intent_classification"].run(
                                query=user_query,
                                histories=histories,
                                sql_samples=sql_samples,
                                instructions=instructions,
                                project_id=ask_request.project_id,
                                configuration=ask_request.configurations,
                            )
                        ).get("post_process", {})
                        if not owns_result():
                            return results
                        intent = intent_classification_result.get("intent")
                        # Kailo DD-163 (07 §4.8.8): product help is Kailo's; a
                        # "how do I use this product" question is answered as a
                        # non-data question, never from upstream documentation.
                        if intent == "USER_GUIDE" and not self._allow_user_guide:
                            intent = "MISLEADING_QUERY"
                        rephrased_question = intent_classification_result.get(
                            "rephrased_question"
                        )
                        intent_reasoning = intent_classification_result.get("reasoning")

                        if rephrased_question:
                            user_query = rephrased_question

                        if intent == "MISLEADING_QUERY":
                            self._ask_results[query_id] = expected = AskResultResponse(
                                status="finished",
                                type="GENERAL",
                                rephrased_question=rephrased_question,
                                intent_reasoning=intent_reasoning,
                                trace_id=trace_id,
                                is_followup=True if histories else False,
                                general_type="MISLEADING_QUERY",
                            )
                            asyncio.create_task(
                                self._generate_general(
                                    "misleading_assistance",
                                    self._ask_results[query_id],
                                    query=user_query,
                                    histories=histories,
                                    db_schemas=intent_classification_result.get(
                                        "db_schemas"
                                    ),
                                    language=ask_request.configurations.language,
                                    query_id=ask_request.query_id,
                                    custom_instruction=ask_request.custom_instruction,
                                )
                            )

                            results["metadata"]["type"] = "MISLEADING_QUERY"
                            return results
                        elif intent == "GENERAL":
                            self._ask_results[query_id] = expected = AskResultResponse(
                                status="finished",
                                type="GENERAL",
                                rephrased_question=rephrased_question,
                                intent_reasoning=intent_reasoning,
                                trace_id=trace_id,
                                is_followup=True if histories else False,
                                general_type="DATA_ASSISTANCE",
                            )
                            asyncio.create_task(
                                self._generate_general(
                                    "data_assistance",
                                    self._ask_results[query_id],
                                    query=user_query,
                                    histories=histories,
                                    db_schemas=intent_classification_result.get(
                                        "db_schemas"
                                    ),
                                    language=ask_request.configurations.language,
                                    query_id=ask_request.query_id,
                                    custom_instruction=ask_request.custom_instruction,
                                )
                            )

                            results["metadata"]["type"] = "GENERAL"
                            return results
                        elif intent == "USER_GUIDE":
                            self._ask_results[query_id] = expected = AskResultResponse(
                                status="finished",
                                type="GENERAL",
                                rephrased_question=rephrased_question,
                                intent_reasoning=intent_reasoning,
                                trace_id=trace_id,
                                is_followup=True if histories else False,
                                general_type="USER_GUIDE",
                            )
                            asyncio.create_task(
                                self._generate_general(
                                    "user_guide_assistance",
                                    self._ask_results[query_id],
                                    query=user_query,
                                    language=ask_request.configurations.language,
                                    query_id=ask_request.query_id,
                                    custom_instruction=ask_request.custom_instruction,
                                )
                            )

                            results["metadata"]["type"] = "GENERAL"
                            return results
                        else:
                            self._ask_results[query_id] = expected = AskResultResponse(
                                status="understanding",
                                type="TEXT_TO_SQL",
                                rephrased_question=rephrased_question,
                                intent_reasoning=intent_reasoning,
                                trace_id=trace_id,
                                is_followup=True if histories else False,
                            )
            if owns_result() and not api_results:
                self._ask_results[query_id] = expected = AskResultResponse(
                    status="searching",
                    type="TEXT_TO_SQL",
                    rephrased_question=rephrased_question,
                    intent_reasoning=intent_reasoning,
                    trace_id=trace_id,
                    is_followup=True if histories else False,
                )

                retrieval_result = await self._pipelines["db_schema_retrieval"].run(
                    query=user_query,
                    histories=histories,
                    project_id=ask_request.project_id,
                    enable_column_pruning=enable_column_pruning,
                )
                if not owns_result():
                    return results
                _retrieval_result = retrieval_result.get(
                    "construct_retrieval_results", {}
                )
                documents = _retrieval_result.get("retrieval_results", [])
                table_names = [document.get("table_name") for document in documents]
                table_ddls = [document.get("table_ddl") for document in documents]

                if not documents:
                    logger.exception(f"ask pipeline - NO_RELEVANT_DATA: {user_query}")
                    if owns_result():
                        self._ask_results[query_id] = expected = AskResultResponse(
                            status="failed",
                            type="TEXT_TO_SQL",
                            error=AskError(
                                code="NO_RELEVANT_DATA",
                                message="No relevant data",
                            ),
                            rephrased_question=rephrased_question,
                            intent_reasoning=intent_reasoning,
                            trace_id=trace_id,
                            is_followup=True if histories else False,
                        )
                    results["metadata"]["error_type"] = "NO_RELEVANT_DATA"
                    results["metadata"]["type"] = "TEXT_TO_SQL"
                    return results

            if owns_result() and not api_results and allow_sql_generation_reasoning:
                self._ask_results[query_id] = expected = AskResultResponse(
                    status="planning",
                    type="TEXT_TO_SQL",
                    rephrased_question=rephrased_question,
                    intent_reasoning=intent_reasoning,
                    retrieved_tables=table_names,
                    trace_id=trace_id,
                    is_followup=True if histories else False,
                )

                if histories:
                    sql_generation_reasoning = (
                        await self._pipelines["followup_sql_generation_reasoning"].run(
                            query=user_query,
                            contexts=table_ddls,
                            histories=histories,
                            sql_samples=sql_samples,
                            instructions=instructions,
                            configuration=ask_request.configurations,
                            query_id=query_id,
                        )
                    ).get("post_process", {})
                else:
                    sql_generation_reasoning = (
                        await self._pipelines["sql_generation_reasoning"].run(
                            query=user_query,
                            contexts=table_ddls,
                            sql_samples=sql_samples,
                            instructions=instructions,
                            configuration=ask_request.configurations,
                            query_id=query_id,
                        )
                    ).get("post_process", {})

                if not owns_result():
                    return results

                self._ask_results[query_id] = expected = AskResultResponse(
                    status="planning",
                    type="TEXT_TO_SQL",
                    rephrased_question=rephrased_question,
                    intent_reasoning=intent_reasoning,
                    retrieved_tables=table_names,
                    sql_generation_reasoning=sql_generation_reasoning,
                    trace_id=trace_id,
                    is_followup=True if histories else False,
                )

            if owns_result() and not api_results:
                self._ask_results[query_id] = expected = AskResultResponse(
                    status="generating",
                    type="TEXT_TO_SQL",
                    rephrased_question=rephrased_question,
                    intent_reasoning=intent_reasoning,
                    retrieved_tables=table_names,
                    sql_generation_reasoning=sql_generation_reasoning,
                    trace_id=trace_id,
                    is_followup=True if histories else False,
                )

                if allow_sql_functions_retrieval:
                    sql_functions = await self._pipelines[
                        "sql_functions_retrieval"
                    ].run(
                        project_id=ask_request.project_id,
                    )
                else:
                    sql_functions = []

                if not owns_result():
                    return results

                has_calculated_field = _retrieval_result.get(
                    "has_calculated_field", False
                )
                has_metric = _retrieval_result.get("has_metric", False)
                has_json_field = _retrieval_result.get("has_json_field", False)

                if histories:
                    text_to_sql_generation_results = await self._pipelines[
                        "followup_sql_generation"
                    ].run(
                        query=user_query,
                        contexts=table_ddls,
                        sql_generation_reasoning=sql_generation_reasoning,
                        histories=histories,
                        project_id=ask_request.project_id,
                        sql_samples=sql_samples,
                        instructions=instructions,
                        has_calculated_field=has_calculated_field,
                        has_metric=has_metric,
                        has_json_field=has_json_field,
                        sql_functions=sql_functions,
                        use_dry_plan=use_dry_plan,
                        allow_dry_plan_fallback=allow_dry_plan_fallback,
                    )
                else:
                    text_to_sql_generation_results = await self._pipelines[
                        "sql_generation"
                    ].run(
                        query=user_query,
                        contexts=table_ddls,
                        sql_generation_reasoning=sql_generation_reasoning,
                        project_id=ask_request.project_id,
                        sql_samples=sql_samples,
                        instructions=instructions,
                        has_calculated_field=has_calculated_field,
                        has_metric=has_metric,
                        has_json_field=has_json_field,
                        sql_functions=sql_functions,
                        use_dry_plan=use_dry_plan,
                        allow_dry_plan_fallback=allow_dry_plan_fallback,
                    )

                if not owns_result():
                    return results

                if sql_valid_result := text_to_sql_generation_results["post_process"][
                    "valid_generation_result"
                ]:
                    api_results = [
                        AskResult(
                            **{
                                "sql": sql_valid_result.get("sql"),
                                "type": "llm",
                            }
                        )
                    ]
                elif failed_dry_run_result := text_to_sql_generation_results[
                    "post_process"
                ]["invalid_generation_result"]:
                    while current_sql_correction_retries < max_sql_correction_retries:
                        if failed_dry_run_result["type"] == "TIME_OUT":
                            break

                        original_sql = failed_dry_run_result["original_sql"]
                        invalid_sql = failed_dry_run_result["sql"]
                        error_message = failed_dry_run_result["error"]
                        current_sql_correction_retries += 1

                        self._ask_results[query_id] = expected = AskResultResponse(
                            status="correcting",
                            type="TEXT_TO_SQL",
                            rephrased_question=rephrased_question,
                            intent_reasoning=intent_reasoning,
                            retrieved_tables=table_names,
                            sql_generation_reasoning=sql_generation_reasoning,
                            trace_id=trace_id,
                            is_followup=True if histories else False,
                        )

                        if allow_sql_diagnosis:
                            sql_diagnosis_results = await self._pipelines[
                                "sql_diagnosis"
                            ].run(
                                contexts=table_ddls,
                                original_sql=original_sql,
                                invalid_sql=invalid_sql,
                                error_message=error_message,
                                language=ask_request.configurations.language,
                            )
                            sql_diagnosis_reasoning = sql_diagnosis_results[
                                "post_process"
                            ].get("reasoning")

                        if not owns_result():
                            return results

                        sql_correction_results = await self._pipelines[
                            "sql_correction"
                        ].run(
                            contexts=table_ddls,
                            instructions=instructions,
                            invalid_generation_result={
                                "sql": original_sql,
                                "error": sql_diagnosis_reasoning
                                if allow_sql_diagnosis
                                else error_message,
                            },
                            project_id=ask_request.project_id,
                            use_dry_plan=use_dry_plan,
                            allow_dry_plan_fallback=allow_dry_plan_fallback,
                            sql_functions=sql_functions,
                        )

                        if not owns_result():
                            return results

                        if valid_generation_result := sql_correction_results[
                            "post_process"
                        ]["valid_generation_result"]:
                            api_results = [
                                AskResult(
                                    **{
                                        "sql": valid_generation_result.get("sql"),
                                        "type": "llm",
                                    }
                                )
                            ]
                            break

                        failed_dry_run_result = sql_correction_results["post_process"][
                            "invalid_generation_result"
                        ]

            if api_results:
                if owns_result():
                    self._ask_results[query_id] = expected = AskResultResponse(
                        status="finished",
                        type="TEXT_TO_SQL",
                        response=api_results,
                        rephrased_question=rephrased_question,
                        intent_reasoning=intent_reasoning,
                        retrieved_tables=table_names,
                        sql_generation_reasoning=sql_generation_reasoning,
                        trace_id=trace_id,
                        is_followup=True if histories else False,
                    )
                results["ask_result"] = api_results
                results["metadata"]["type"] = "TEXT_TO_SQL"
            else:
                logger.exception(f"ask pipeline - NO_RELEVANT_SQL: {user_query}")
                if owns_result():
                    self._ask_results[query_id] = expected = AskResultResponse(
                        status="failed",
                        type="TEXT_TO_SQL",
                        error=AskError(
                            code="NO_RELEVANT_SQL",
                            message=error_message or "No relevant SQL",
                        ),
                        rephrased_question=rephrased_question,
                        intent_reasoning=intent_reasoning,
                        retrieved_tables=table_names,
                        sql_generation_reasoning=sql_generation_reasoning,
                        invalid_sql=invalid_sql,
                        trace_id=trace_id,
                        is_followup=True if histories else False,
                    )
                results["metadata"]["error_type"] = "NO_RELEVANT_SQL"
                results["metadata"]["error_message"] = error_message
                results["metadata"]["type"] = "TEXT_TO_SQL"

            return results
        except NativeQueryPending:
            # The original query AE may be awaiting approval or reconciliation.
            # Do not turn that query into FAILED (or correct/re-dispatch SQL).
            # Stop/rerun remains the original user operation; the UI re-observes
            # every registered child query before it permits a new task ID.
            if owns_result():
                self._ask_results[query_id] = expected = AskResultResponse(
                    status="stopped",
                    type="TEXT_TO_SQL",
                    error=AskError(code="OTHERS", message="NATIVE_EXECUTION_UNKNOWN"),
                    trace_id=trace_id,
                )
            results["metadata"]["error_type"] = "OTHERS"
            results["metadata"]["error_message"] = "Native query outcome unavailable"
            return results
        except SQLGenerationEmpty as e:
            # Nothing reached the engine and nothing is left to correct: fail
            # now with the reason, not as an unknown internal error.
            logger.warning(f"ask pipeline - NO_SQL_GENERATED: {e}")

            if owns_result():
                self._ask_results[query_id] = expected = AskResultResponse(
                    status="failed",
                    type="TEXT_TO_SQL",
                    error=AskError(code="NO_SQL_GENERATED", message=str(e)),
                    trace_id=trace_id,
                    is_followup=True if histories else False,
                )

            results["metadata"]["error_type"] = "NO_SQL_GENERATED"
            results["metadata"]["error_message"] = str(e)
            results["metadata"]["type"] = "TEXT_TO_SQL"
            return results
        except Exception as e:
            logger.exception(f"ask pipeline - OTHERS: {e}")

            if owns_result():
                self._ask_results[query_id] = expected = AskResultResponse(
                    status="failed",
                    type="TEXT_TO_SQL",
                    error=AskError(
                        code="OTHERS",
                        message=str(e),
                    ),
                    trace_id=trace_id,
                    is_followup=True if histories else False,
                )

            results["metadata"]["error_type"] = "OTHERS"
            results["metadata"]["error_message"] = str(e)
            results["metadata"]["type"] = "TEXT_TO_SQL"
            return results

    async def _generate_general(self, pipeline_name, expected, **request):
        query_id = request["query_id"]
        if (
            self._ask_results.get(query_id) is not expected
            or expected.status != "finished"
            or expected.type != "GENERAL"
        ):
            return
        try:
            result = await self._pipelines[pipeline_name].run(**request)
            generated = result.get(pipeline_name) if isinstance(result, dict) else None
            replies = generated.get("replies") if isinstance(generated, dict) else None
            meta = generated.get("meta") if isinstance(generated, dict) else None
            if (
                not isinstance(replies, list)
                or len(replies) != 1
                or not isinstance(replies[0], str)
                or not isinstance(meta, list)
                or len(meta) != 1
                or not isinstance(meta[0], dict)
                or meta[0].get("finish_reason") != "stop"
                or self._ask_results.get(query_id) is not expected
                or expected.status != "finished"
                or expected.type != "GENERAL"
            ):
                return
            # Mutate only the same existing cache object, preserving its TTL.
            expected.completion = AskCompletion(query_id=query_id, content=replies[0])
            self._pipelines[pipeline_name].retire_streaming_results(query_id)
        except Exception:
            # Classification finished is not proof of a finished explanation.
            # Missing/truncated/failed returns stay unresolved; never generate again.
            logger.warning("Original general explanation result unavailable")

    def stop_ask(
        self,
        stop_ask_request: StopAskRequest,
    ):
        self._ask_results[stop_ask_request.query_id] = AskResultResponse(
            status="stopped",
        )

    def get_ask_result(
        self,
        ask_result_request: AskResultRequest,
    ) -> AskResultResponse:
        if (result := self._ask_results.get(ask_result_request.query_id)) is None:
            logger.exception(
                f"ask pipeline - OTHERS: {ask_result_request.query_id} is not found"
            )
            raise HTTPException(
                status_code=404, detail="Native task evidence unavailable"
            )

        return result

    async def get_ask_streaming_result(
        self,
        query_id: str,
    ):
        expected = self._ask_results.get(query_id)
        if expected is not None:
            _pipeline_name = ""
            if expected.type == "GENERAL":
                if expected.general_type == "USER_GUIDE":
                    _pipeline_name = "user_guide_assistance"
                elif expected.general_type == "DATA_ASSISTANCE":
                    _pipeline_name = "data_assistance"
                elif expected.general_type == "MISLEADING_QUERY":
                    _pipeline_name = "misleading_assistance"
            else:
                reasoning = (
                    "followup_sql_generation_reasoning"
                    if expected.is_followup
                    else "sql_generation_reasoning"
                )
                # The task can advance to SQL generation before the browser
                # opens its original reasoning stream. Consume its real queue,
                # not a fabricated completion inferred from that phase change.
                pipeline = self._pipelines.get(reasoning)
                if pipeline and (
                    expected.status == "planning" or query_id in pipeline._user_queues
                ):
                    _pipeline_name = reasoning

            if _pipeline_name:
                general = expected.type == "GENERAL"
                emitted = ""
                if general and expected.completion:
                    if self._ask_results.get(query_id) is not expected:
                        return
                    event = SSEEvent(
                        data=SSEEvent.SSEEventMessage(
                            message=expected.completion.content
                        )
                    )
                    yield event.serialize()
                    if self._ask_results.get(query_id) is expected:
                        yield f"data: {json.dumps({'done': True, 'queryId': query_id})}\n\n"
                    return
                async for chunk in self._pipelines[
                    _pipeline_name
                ].get_streaming_results(query_id):
                    if general and self._ask_results.get(query_id) is not expected:
                        return
                    if chunk is None:
                        if general:
                            complete = expected.completion
                            if not complete or not complete.content.startswith(emitted):
                                return
                            remainder = complete.content[len(emitted) :]
                            if remainder:
                                yield SSEEvent(
                                    data=SSEEvent.SSEEventMessage(message=remainder)
                                ).serialize()
                            if self._ask_results.get(query_id) is not expected:
                                return
                        yield f"data: {json.dumps({'done': True, 'queryId': query_id})}\n\n"
                        return
                    emitted += chunk
                    event = SSEEvent(
                        data=SSEEvent.SSEEventMessage(message=chunk),
                    )
                    yield event.serialize()
