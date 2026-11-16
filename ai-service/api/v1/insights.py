import logging

from fastapi import APIRouter, Depends, HTTPException, status

from app.agent.clustering import cluster_questions
from app.agent.meeting import MeetingExtractionError, extract_meeting_summary
from config import RouteTags
from core.ai_service import (
    AIService,
    LLMTimeoutError,
    LLMUnavailableError,
    get_ai_service,
)
from core.security import verify_token
from schemas.insights import (
    ClusterRequest,
    ClusterResponse,
    MeetingSummary,
    MeetingSummaryRequest,
    QuestionCluster,
    QuestionIn,
)

insights_router = APIRouter(tags=[RouteTags.INSIGHTS_ROUTER])
logger = logging.getLogger(__name__)


@insights_router.post("/meetings/summary")
async def summarize_meeting(
    data: MeetingSummaryRequest,
    _token: str = Depends(verify_token),
    ai_service: AIService = Depends(get_ai_service),
) -> MeetingSummary:
    try:
        return await extract_meeting_summary(data.text, ai_service.complete_json)
    except MeetingExtractionError as error:
        logger.warning("Модель вернула невалидные итоги встречи после повтора")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY) from error
    except (LLMUnavailableError, LLMTimeoutError) as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE) from error


@insights_router.post("/questions/clusters")
async def group_questions(
    data: ClusterRequest,
    _token: str = Depends(verify_token),
) -> ClusterResponse:
    clusters = cluster_questions(((q.id, q.text) for q in data.questions), data.threshold)
    return ClusterResponse(
        clusters=[
            QuestionCluster(
                label=c.label,
                size=c.size,
                questions=[QuestionIn(id=q.id, text=q.text) for q in c.questions],
            )
            for c in clusters
        ],
    )
