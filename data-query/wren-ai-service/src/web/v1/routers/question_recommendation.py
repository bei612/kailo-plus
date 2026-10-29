import uuid
from dataclasses import asdict
from typing import Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel

from src.globals import (
    ServiceContainer,
    ServiceMetadata,
    get_service_container,
    get_service_metadata,
)
from src.web.v1.services import BaseRequest, QuestionRecommendation

router = APIRouter()


class PostRequest(BaseRequest):
    native_task_id: Optional[uuid.UUID] = None
    mdl: str
    previous_questions: list[str] = []
    max_questions: int = 5
    max_categories: int = 3
    regenerate: bool = False
    allow_data_preview: bool = True


class PostResponse(BaseModel):
    id: str


@router.post(
    "/question-recommendations",
    response_model=PostResponse,
)
async def recommend(
    request: PostRequest,
    background_tasks: BackgroundTasks,
    service_container: ServiceContainer = Depends(get_service_container),
    service_metadata: ServiceMetadata = Depends(get_service_metadata),
) -> PostResponse:
    # The existing UI native task row reserves this ID before dispatch, as for
    # /asks and /sql-answers. It identifies an event, never authorizes a query.
    event_id = str(request.native_task_id or uuid.uuid4())
    service = service_container.question_recommendation
    if event_id in service._cache:
        raise HTTPException(status_code=409, detail="Native task ID already registered")
    service[event_id] = QuestionRecommendation.Event(event_id=event_id)

    _request = QuestionRecommendation.Request(
        event_id=event_id, **request.model_dump(exclude={"native_task_id"})
    )

    background_tasks.add_task(
        service.recommend,
        _request,
        service_metadata=asdict(service_metadata),
    )

    return PostResponse(id=event_id)


class GetResponse(BaseModel):
    id: str
    status: Literal["generating", "finished", "failed"]
    response: Optional[dict]
    error: Optional[dict]
    trace_id: Optional[str] = None


@router.get(
    "/question-recommendations/{event_id}",
    response_model=GetResponse,
)
async def get(
    event_id: str,
    service_container: ServiceContainer = Depends(get_service_container),
) -> GetResponse:
    event: QuestionRecommendation.Event = service_container.question_recommendation[
        event_id
    ]

    def _formatter(response: dict) -> dict:
        questions = [
            question
            for _, questions in response["questions"].items()
            for question in questions
        ]
        return {"questions": questions}

    return GetResponse(
        id=event.event_id,
        status=event.status,
        response=_formatter(event.response),
        error=event.error and event.error.model_dump(),
        trace_id=event.trace_id,
    )
