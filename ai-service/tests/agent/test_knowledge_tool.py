from app.agent.context import UserContext
from app.agent.knowledge_tool import (
    TOOL_DEFINITION,
    extract_citations,
    run_knowledge_search,
)
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


def test_found(kb_dir, embedder):
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
            "source": "seed",
        },
        {
            "id": 2,
            "doc_title": "Первый pull request",
            "section": "Ревью",
            "text": "t",
            "source": "seed",
        },
    ],
}


def test_citations_extracted_and_stripped():
    text, src = extract_citations("Ревью идёт через PR.\n[источники: 2, 1, 2, 9]", FOUND)
    assert text == "Ревью идёт через PR."
    assert [s["doc_title"] for s in src] == [
        "Первый pull request",
        "Code review в команде",
    ]
    assert src[0]["label"] == "Первый pull request / Ревью"


def test_citations_fallback_to_top_result():
    _, src = extract_citations("Ответ без ссылок", FOUND)
    assert [s["doc_title"] for s in src] == ["Code review в команде"]


def test_no_sources_when_no_answer():
    text, src = extract_citations("Не знаю. [источники: 1]", {"status": "no_answer"})
    assert src == [] and "[источники" not in text
