"""Ответ «не знаю»: кому писать и предложение эскалации."""

from __future__ import annotations

from app.agent.context import UserContext, clean

CONTACTS_BY_ROLE = {
    "intern": ["наставник", "руководитель", "HR BP"],
    "buddy": ["руководитель", "HR BP"],
    "lead": ["HR BP"],
}


def who_to_ask(role: str) -> list[str]:
    return list(CONTACTS_BY_ROLE.get(role, ["HR BP"]))


def can_escalate(role: str) -> bool:
    """escalation.create доступен только стажёру (таблица инструментов в MVP)."""
    return role == "intern"


def unknown_answer_text(role: str) -> str:
    """Запасной текст, если LLM недоступна или нужен детерминированный ответ."""
    contacts = ", ".join(who_to_ask(role))
    text = (
        "В базе знаний ответа на этот вопрос нет, поэтому гадать не буду. "
        f"Лучше спросить: {contacts}."
    )
    if can_escalate(role):
        text += (
            " Могу передать вопрос наставнику вместе с контекстом: "
            "нажми «Передать наставнику»."
        )
    return text


def escalation_proposal(
    question: str,
    ctx: UserContext,
    history: list[dict] | None = None,
) -> dict | None:
    """Предложение действия escalation.create (после подтверждения пользователя).
    Формат события согласовать с docs/ai-contract.md (Макс)."""
    if not can_escalate(ctx.role):
        return None
    context = [
        {"role": clean(m.get("role"), 20), "content": clean(m.get("content"), 500)}
        for m in (history or [])[-6:]
    ]
    return {
        "type": "action_proposal",
        "action": "escalation.create",
        "title": "Передать вопрос наставнику",
        "payload": {"question": clean(question, 1000), "context": context},
    }
