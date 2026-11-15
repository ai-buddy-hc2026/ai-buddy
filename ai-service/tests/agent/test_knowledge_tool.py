from app.agent.context import UserContext
from app.agent.knowledge_tool import (
    TOOL_DEFINITION,
    extract_citations,
    run_knowledge_search,
)
from app.rag.search import SearchResult
from app.rag.store import ChunkRow
from tests.agent.conftest import FAKE_MIN
from tests.rag.test_search import make_store

INTERN = UserContext(user_id="u1", role="intern", team_id="team-a", name="Аня")


def run(q, ctx=INTERN, store=None, embedder=None, **kw):
    return run_knowledge_search(
        {"query": q},
        ctx,
        embedder=embedder,
        store=store,
        min_score=FAKE_MIN,
        **kw,
    )


def test_found(kb_dir, embedder, monkeypatch):
    import app.agent.knowledge_tool as knowledge_tool

    monkeypatch.setattr(
        knowledge_tool,
        "get_settings",
        lambda: type(
            "Settings",
            (),
            {
                "confidence_high_score": 1.0,
                "confidence_medium_score": 0.0,
                "confidence_high_min_results": 2,
            },
        )(),
    )
    store = make_store(kb_dir, embedder)
    r = run("Как оформить отгул?", store=store, embedder=embedder)
    assert r["status"] == "found" and r["results"][0]["id"] == 1
    assert "отгул" in r["results"][0]["doc_title"].lower()
    assert len(r["results"]) <= 4


def test_budget_is_no_answer_with_contacts(kb_dir, embedder):
    store = make_store(kb_dir, embedder)
    r = run("Какой бюджет на конференции?", store=store, embedder=embedder)
    assert r["status"] == "no_answer"
    assert r["who_to_ask"] == ["наставник", "руководитель", "HR BP"]
    assert r["suggest_escalation"] is True
    assert r["confidence"] == "low" and r["fragments"] == []


def test_high_confidence_uses_score_and_result_count(monkeypatch, embedder):
    import app.agent.knowledge_tool as knowledge_tool

    monkeypatch.setattr(
        knowledge_tool,
        "get_settings",
        lambda: type(
            "Settings",
            (),
            {
                "confidence_high_score": 0.88,
                "confidence_medium_score": 0.80,
                "confidence_high_min_results": 2,
            },
        )(),
    )
    results = [
        SearchResult("Текст 1", "Гайд", "Раздел 1", 0.91, "seed", "team-a"),
        SearchResult("Текст 2", "Гайд", "Раздел 2", 0.85, "seed", "team-a"),
    ]
    monkeypatch.setattr(knowledge_tool, "search", lambda *_args, **_kwargs: results)

    response = run("Вопрос", store=object(), embedder=embedder)

    assert response["confidence"] == "high"
    assert response["fragments"] == [
        {"doc": "Гайд", "text": "Текст 1", "score": 0.91},
        {"doc": "Гайд", "text": "Текст 2", "score": 0.85},
    ]


def test_low_confidence_does_not_return_an_answer_from_weak_matches(monkeypatch, embedder):
    import app.agent.knowledge_tool as knowledge_tool

    monkeypatch.setattr(
        knowledge_tool,
        "get_settings",
        lambda: type(
            "Settings",
            (),
            {
                "confidence_high_score": 0.88,
                "confidence_medium_score": 0.80,
                "confidence_high_min_results": 2,
            },
        )(),
    )
    result = SearchResult("Слабый фрагмент", "Гайд", "Раздел", 0.72, "seed", "team-a")
    monkeypatch.setattr(knowledge_tool, "search", lambda *_args, **_kwargs: [result])

    response = run("Вопрос", store=object(), embedder=embedder)

    assert response["status"] == "no_answer"
    assert response["confidence"] == "low"
    assert response["fragments"] == [
        {"doc": "Гайд", "text": "Слабый фрагмент", "score": 0.72},
    ]
    assert response["who_to_ask"] == ["наставник", "руководитель", "HR BP"]


def test_no_escalation_for_buddy(kb_dir, embedder):
    store = make_store(kb_dir, embedder)
    ctx = UserContext(user_id="b", role="buddy", team_id="team-a")
    r = run("Какой бюджет на конференции?", ctx=ctx, store=store, embedder=embedder)
    assert r["suggest_escalation"] is False and "наставник" not in r["who_to_ask"]


def test_model_cannot_override_team(embedder):
    from app.rag.store import MemoryStore

    store = MemoryStore()
    v = embedder.embed_passages(["ответ наставника про бюджет конференции"])[0]
    store.add(
        "mentor_answer",
        [ChunkRow("Ответ наставника", "Бюджет", "текст", v, team_id="team-a")],
    )
    other = UserContext(user_id="p", role="intern", team_id="team-b")
    r = run_knowledge_search(
        {"query": "бюджет конференции", "team_id": "team-a"},
        other,
        embedder=embedder,
        store=store,
        min_score=0.0,
    )
    assert r["status"] == "no_answer"


def test_empty_query(embedder):
    from app.rag.store import MemoryStore

    assert run("  ", store=MemoryStore(), embedder=embedder)["status"] == "error"


def test_tool_definition_hides_team_id():
    props = TOOL_DEFINITION["function"]["parameters"]["properties"]
    assert list(props) == ["query"]
    assert "." not in TOOL_DEFINITION["function"]["name"]


FOUND = {
    "status": "found",
    "results": [
        {
            "id": 1,
            "doc_title": "Code review в команде",
            "section": "Как проходит ревью",
            "text": "t",
            "source": {
                "document_id": "40000000-0000-0000-0000-000000000001",
                "revision": 1,
                "title": "Code review в команде",
                "section": "Как проходит ревью",
                "url": "kb/02-code-review",
            },
        },
        {
            "id": 2,
            "doc_title": "Первый pull request",
            "section": "Ревью",
            "text": "t",
            "source": {
                "document_id": "40000000-0000-0000-0000-000000000002",
                "revision": 3,
                "title": "Первый pull request",
                "section": "Ревью",
                "url": "kb/07-first-pr",
            },
        },
    ],
}


def test_citations_extracted_and_stripped():
    text, src = extract_citations("Ревью идёт через PR.\n[источники: 2, 1, 2, 9]", FOUND)
    assert text == "Ревью идёт через PR."
    assert [s["title"] for s in src] == [
        "Первый pull request",
        "Code review в команде",
    ]
    assert src[0]["revision"] == 3
    assert src[0]["url"] == "kb/07-first-pr"


def test_citations_fallback_to_top_result():
    _, src = extract_citations("Ответ без ссылок", FOUND)
    assert [s["title"] for s in src] == ["Code review в команде"]


def test_no_sources_when_no_answer():
    text, src = extract_citations("Не знаю. [источники: 1]", {"status": "no_answer"})
    assert src == [] and "[источники" not in text
