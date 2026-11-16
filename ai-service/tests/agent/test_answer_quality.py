import json
from datetime import date

from app.agent.context import UserContext
from app.agent.knowledge_tool import (
    confidence_level,
    extract_citations,
    run_knowledge_search,
)
from app.rag.store import ChunkRow, MemoryStore
from schemas.event import DoneData

INTERN = UserContext(user_id="u1", role="intern", team_id="team-a")
DOC = "40000000-0000-0000-0000-000000000001"


def _result(i, score, text="Отгул оформляют за 3 рабочих дня.", **source):
    return {
        "id": i,
        "doc_title": "Отгул",
        "section": "Сроки",
        "text": text,
        "score": score,
        "source": {
            "document_id": f"40000000-0000-0000-0000-00000000000{i}",
            "revision": 1,
            "title": "Отгул",
            "section": "Сроки",
            "url": "kb/01-otgul",
            **source,
        },
    }


def test_confidence_level_uses_margin_over_threshold():
    assert confidence_level(0.90, 0.80) == "high"
    assert confidence_level(0.83, 0.80) == "medium"
    assert confidence_level(0.80, 0.80) == "low"


def test_cited_sources_carry_quote_and_confidence():
    found = {"status": "found", "min_score": 0.8, "results": [_result(1, 0.9)]}
    _, sources = extract_citations("Ответ [источники: 1]", found)
    assert sources[0]["quote"] == "Отгул оформляют за 3 рабочих дня."
    assert sources[0]["confidence"] == "high"


def test_quote_is_trimmed_to_limit():
    long_result = _result(1, 0.9, "слово " * 200)
    found = {"status": "found", "min_score": 0.8, "results": [long_result]}
    _, sources = extract_citations("Ответ [источники: 1]", found)
    assert len(sources[0]["quote"]) <= 280
    assert sources[0]["quote"].endswith("…")


def test_uncited_fallback_is_capped_at_medium():
    found = {"status": "found", "min_score": 0.8, "results": [_result(1, 0.95)]}
    _, sources = extract_citations("Ответ без ссылок", found)
    assert sources[0]["confidence"] == "medium"


def _done(sources, **kw):
    return DoneData(
        full_text="t",
        sources=sources,
        answer_status="answered",
        question_category="other",
        **kw,
    )


SRC = {
    "document_id": DOC,
    "revision": 1,
    "title": "Отгул",
    "section": "Сроки",
    "url": "kb/01-otgul",
}


def test_done_confidence_is_best_source_level():
    done = _done([{**SRC, "confidence": "low"}, {**SRC, "confidence": "high"}])
    assert done.confidence == "high"


def test_done_without_quality_fields_keeps_old_json_shape():
    data = json.loads(_done([SRC]).model_dump_json())
    assert set(data) == {"full_text", "sources", "answer_status", "question_category"}
    assert set(data["sources"][0]) == set(SRC)


def test_done_with_quality_fields_serializes_them():
    src = {**SRC, "quote": "q", "confidence": "medium", "reviewed_at": "2026-10-01"}
    data = json.loads(_done([src]).model_dump_json())
    assert data["confidence"] == "medium"
    assert data["sources"][0]["reviewed_at"] == "2026-10-01"
    assert "owner" not in data["sources"][0]


def test_search_result_passes_freshness_to_source(embedder):
    store = MemoryStore()
    vec = embedder.embed_passages(["оформить отгул заранее"])[0]
    store.add(
        "seed",
        [
            ChunkRow(
                "Отгул",
                "Сроки",
                "оформить отгул заранее",
                vec,
                "team-a",
                DOC,
                2,
                "01-otgul",
                date(2026, 10, 1),
                "наставник команды",
            ),
        ],
    )
    r = run_knowledge_search(
        {"query": "оформить отгул заранее"},
        INTERN,
        embedder=embedder,
        store=store,
        min_score=0.3,
    )
    source = r["results"][0]["source"]
    assert source["reviewed_at"] == "2026-10-01"
    assert source["owner"] == "наставник команды"
    assert source["url"] == "kb/01-otgul"
    assert r["min_score"] == 0.3
