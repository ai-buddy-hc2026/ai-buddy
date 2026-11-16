"""Инструмент knowledge.search для агента и разбор ссылок на источники."""

from __future__ import annotations

import re

from app.agent.context import UserContext
from app.agent.unknown import can_escalate, who_to_ask
from app.rag.embeddings import Embedder
from app.rag.search import SearchResult, search
from app.rag.settings import get_settings
from app.rag.store import Store

MCP_NAME = "knowledge.search"  # имя в контракте MCP
OPENAI_NAME = "knowledge_search"  # в function calling точки не допускаются

TOOL_DEFINITION = {
    "type": "function",
    "function": {
        "name": OPENAI_NAME,
        "description": (
            "Поиск по базе знаний команды (тестовые инструкции). "
            "Используй для любого вопроса про команду, "
            "процессы и правила. Возвращает фрагменты с источниками или status no_answer."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Вопрос пользователя своими словами",
                },
            },
            "required": ["query"],
            "additionalProperties": False,
        },
    },
}

FOUND_INSTRUCTION = (
    "Отвечай только по этим фрагментам. "
    "В конце ответа укажи номера использованных фрагментов: [источники: 1, 2]."
)
NO_ANSWER_INSTRUCTION = (
    "В базе нет ответа. Скажи об этом честно, не придумывай. "
    "Назови, к кому обратиться (who_to_ask). "
    "Если suggest_escalation равно true, предложи передать вопрос наставнику."
)


QUOTE_MAX_CHARS = 280
# Насколько лучший фрагмент выше порога поиска. Пороги относительные: порог
# KB_MIN_SCORE калибруется под модель, а запас над ним показывает уверенность.
HIGH_MARGIN = 0.06
MEDIUM_MARGIN = 0.02


def confidence_level(score: float, min_score: float) -> str:
    margin = score - min_score
    if margin >= HIGH_MARGIN:
        return "high"
    if margin >= MEDIUM_MARGIN:
        return "medium"
    return "low"


def _quote(text: str) -> str:
    text = " ".join(str(text).split())
    if len(text) <= QUOTE_MAX_CHARS:
        return text
    return text[: QUOTE_MAX_CHARS - 1].rstrip() + "…"


def _source(r: SearchResult) -> dict | None:
    if not (r.document_id and r.revision and r.slug):
        return None
    return {
        "document_id": r.document_id,
        "revision": r.revision,
        "title": r.doc_title,
        "section": r.section,
        "url": f"kb/{r.slug}",
        "reviewed_at": r.reviewed_at.isoformat() if r.reviewed_at else None,
        "owner": r.owner,
    }


def run_knowledge_search(
    args: dict,
    ctx: UserContext,
    *,
    embedder: Embedder,
    store: Store,
    min_score: float | None = None,
    top_k: int | None = None,
) -> dict:
    """team_id берётся только из контекста (JWT). Любой team_id в args игнорируется."""
    query = str(args.get("query", "")).strip()
    if not query:
        return {"status": "error", "error": "empty_query"}
    min_score = get_settings().min_score if min_score is None else min_score
    results = search(
        query,
        ctx.team_id,
        embedder=embedder,
        store=store,
        top_k=top_k,
        min_score=min_score,
    )
    if not results:
        return {
            "status": "no_answer",
            "who_to_ask": who_to_ask(ctx.role),
            "suggest_escalation": can_escalate(ctx.role),
            "instruction": NO_ANSWER_INSTRUCTION,
        }
    return {
        "status": "found",
        "results": [
            {
                "id": i,
                "doc_title": r.doc_title,
                "section": r.section,
                "text": r.text,
                "score": round(r.score, 3),
                "source": _source(r),
            }
            for i, r in enumerate(results, 1)
        ],
        "min_score": min_score,
        "instruction": FOUND_INSTRUCTION,
    }


_CITATION = re.compile(r"\[\s*источник(?:и|а)?\s*:\s*([\d,\s]+)\]", re.IGNORECASE)


def extract_citations(text: str, tool_result: dict) -> tuple[str, list[dict]]:
    """Убирает строку [источники: 1, 2], возвращает (чистый текст, источники).
    Если модель не указала номера, берётся первый (лучший) фрагмент."""
    if tool_result.get("status") != "found":
        return _CITATION.sub("", text).strip(), []
    by_id = {r["id"]: r for r in tool_result["results"]}
    ids: list[int] = []
    for m in _CITATION.finditer(text):
        ids += [int(x) for x in re.findall(r"\d+", m.group(1))]
    chosen = [i for i in dict.fromkeys(ids) if i in by_id]
    cited = bool(chosen)
    chosen = chosen or [min(by_id)]
    clean_text = _CITATION.sub("", text).strip()
    min_score = float(tool_result.get("min_score", get_settings().min_score))
    sources = []
    for i in chosen:
        r = by_id[i]
        source = r.get("source")
        if source is None:
            continue
        level = confidence_level(float(r.get("score", 0.0)), min_score)
        if not cited and level == "high":
            level = "medium"  # модель не сослалась на фрагмент, опора не подтверждена
        quote = _quote(r.get("text", ""))
        sources.append({**source, "quote": quote, "confidence": level})
    return clean_text, sources
