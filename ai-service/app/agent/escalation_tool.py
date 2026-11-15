"""Модельный инструмент для предложения передачи вопроса наставнику."""

ESCALATION_MCP_NAME = "escalation.create"
ESCALATION_MODEL_NAME = "escalation_create"

TOOL_DEFINITION = {
    "name": ESCALATION_MCP_NAME,
    "description": (
        "Предложить стажёру передать текущий вопрос назначенному наставнику. "
        "Используй только по просьбе стажёра или если поиск по базе не нашёл ответ. "
        "Инструмент создаёт карточку для подтверждения и сам ничего не отправляет."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {},
        "additionalProperties": False,
    },
}


def proposal_details(question: str, history: list[dict] | None = None) -> dict:
    """Снимок включает только сообщения с ID, переданными доверенным Go API."""
    history = history or []
    question = question.strip()
    normalized_question = question.casefold()
    transfer_requested = (
        any(
            marker in normalized_question
            for marker in ("передай", "передать", "спроси", "эскалиру")
        )
        and any(marker in normalized_question for marker in ("наставник", "mentor"))
    ) or any(
        marker in normalized_question for marker in ("ask my mentor", "tell my mentor")
    )
    if transfer_requested:
        previous_questions = [
            item.get("content", "").strip()
            for item in history
            if item.get("role") == "user"
            and isinstance(item.get("content"), str)
            and item.get("content", "").strip()
        ]
        if previous_questions:
            question = previous_questions[-1]
    snapshot = []
    for message in history[-10:]:
        message_id = message.get("message_id")
        if not message_id:
            continue
        sources = message.get("sources") or []
        snapshot.append(
            {
                "message_id": str(message_id),
                "role": message.get("role"),
                "content": message.get("content", ""),
                "sources": [
                    (
                        source.model_dump(mode="json")
                        if hasattr(source, "model_dump")
                        else source
                    )
                    for source in sources
                ],
            },
        )
    return {"question": question, "context_snapshot": snapshot}
