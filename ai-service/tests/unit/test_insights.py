import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from httpx import ASGITransport, AsyncClient

from app.agent.clustering import cluster_questions, normalize
from app.agent.meeting import MeetingExtractionError, extract_meeting_summary
from config import get_settings
from core.ai_service import AIService, LLMUnavailableError, get_ai_service
from core.security import verify_token
from main import app

VALID = {
    "agreements": ["Релиз переносим на четверг"],
    "action_items": [{"title": "Обновить README", "owner": "Аня", "due": "пятница"}],
}


def replies(*answers):
    calls = []

    async def complete(messages):
        calls.append(messages)
        return answers[len(calls) - 1]

    return complete, calls


# ---------- извлечение итогов встречи ----------


async def test_meeting_summary_valid_json_first_try():
    complete, calls = replies(json.dumps(VALID, ensure_ascii=False))
    summary = await extract_meeting_summary("Обсудили релиз", complete)
    assert summary.agreements == ["Релиз переносим на четверг"]
    assert summary.action_items[0].owner == "Аня"
    assert len(calls) == 1
    assert "Обсудили релиз" in calls[0][-1]["content"]


async def test_meeting_summary_retries_once_after_invalid_json():
    complete, calls = replies("не json", json.dumps(VALID))
    summary = await extract_meeting_summary("текст", complete)
    assert summary.action_items[0].title == "Обновить README"
    assert len(calls) == 2
    assert calls[1][-2] == {"role": "assistant", "content": "не json"}
    assert "JSON" in calls[1][-1]["content"]


async def test_meeting_summary_retries_after_schema_error():
    bad = json.dumps({"agreements": "одна строка", "action_items": []})
    complete, calls = replies(bad, json.dumps(VALID))
    await extract_meeting_summary("текст", complete)
    assert len(calls) == 2


async def test_meeting_summary_fails_after_second_invalid_answer():
    complete, calls = replies("{", '{"action_items": [{"title": ""}]}')
    with pytest.raises(MeetingExtractionError):
        await extract_meeting_summary("текст", complete)
    assert len(calls) == 2


async def test_meeting_summary_strips_code_fence():
    complete, _ = replies("```json\n" + json.dumps(VALID) + "\n```")
    summary = await extract_meeting_summary("текст", complete)
    assert summary.agreements


# ---------- группировка вопросов ----------


def test_normalize_drops_stopwords_and_stems():
    assert normalize("Как мне оформить отгул?") == normalize("оформление отгулов")


def test_cluster_groups_similar_questions():
    questions = [
        ("1", "Как оформить отгул?"),
        ("2", "Как оформить отгул на пятницу?"),
        ("3", "Где взять доступ к репозиторию?"),
        ("4", "Оформить отгул заранее нужно?"),
        ("5", "Доступ к репозиторию не выдали"),
        ("6", "Какой бюджет на конференции?"),
    ]
    clusters = cluster_questions(questions)
    assert [c.size for c in clusters] == [3, 2, 1]
    assert {q.id for q in clusters[0].questions} == {"1", "2", "4"}
    assert "отгул" in clusters[0].label.lower()
    assert {q.id for q in clusters[1].questions} == {"3", "5"}


def test_cluster_empty_and_duplicate_input():
    assert cluster_questions([]) == []
    clusters = cluster_questions([(None, "Где README?"), (None, "где readme")])
    assert len(clusters) == 1 and clusters[0].size == 2


def test_cluster_question_of_only_stopwords_stays_alone():
    clusters = cluster_questions([("a", "как?"), ("b", "что?")])
    assert [c.size for c in clusters] == [1, 1]


# ---------- AIService.complete_json ----------


@pytest.fixture
def service(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "LLM_API_KEY", "synthetic-key")
    monkeypatch.setattr(settings, "LLM_BASE_URL", "https://llm.invalid/v1")
    return AIService()


async def test_complete_json_returns_message_content(service):
    response = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content='{"a": 1}'))],
    )
    create = AsyncMock(return_value=response)
    service.llm_client = SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=create)),
    )
    assert await service.complete_json([{"role": "user", "content": "x"}]) == '{"a": 1}'
    assert create.await_args.kwargs["response_format"] == {"type": "json_object"}


async def test_complete_json_without_key_is_unavailable(service):
    service.llm_client = None
    with pytest.raises(LLMUnavailableError):
        await service.complete_json([])


# ---------- HTTP ----------


class FakeAI:
    def __init__(self, *answers, error=None):
        self.answers = list(answers)
        self.error = error

    async def complete_json(self, messages, max_tokens=800):
        if self.error:
            raise self.error
        return self.answers.pop(0)


@pytest.fixture
async def http(monkeypatch):
    monkeypatch.setitem(app.dependency_overrides, verify_token, lambda: "t")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://ai") as c:
        yield c


def use_ai(monkeypatch, fake):
    monkeypatch.setitem(app.dependency_overrides, get_ai_service, lambda: fake)


async def test_meeting_endpoint_returns_summary(http, monkeypatch):
    use_ai(monkeypatch, FakeAI(json.dumps(VALID)))
    r = await http.post("/meetings/summary", json={"text": "Обсудили релиз"})
    assert r.status_code == 200
    assert r.json()["action_items"][0] == {
        "title": "Обновить README",
        "owner": "Аня",
        "due": "пятница",
    }


async def test_meeting_endpoint_invalid_output_is_502(http, monkeypatch):
    use_ai(monkeypatch, FakeAI("x", "y"))
    r = await http.post("/meetings/summary", json={"text": "текст"})
    assert r.status_code == 502
    assert r.json()["error"]["code"] == "LLM_INVALID_OUTPUT"


async def test_meeting_endpoint_llm_unavailable_is_503(http, monkeypatch):
    use_ai(monkeypatch, FakeAI(error=LLMUnavailableError("no key")))
    r = await http.post("/meetings/summary", json={"text": "текст"})
    assert r.status_code == 503


async def test_meeting_endpoint_rejects_empty_text(http, monkeypatch):
    use_ai(monkeypatch, FakeAI())
    r = await http.post("/meetings/summary", json={"text": "  "})
    assert r.status_code == 400


async def test_cluster_endpoint(http):
    r = await http.post(
        "/questions/clusters",
        json={
            "questions": [
                {"id": "q1", "text": "Как оформить отгул?"},
                {"id": "q2", "text": "Оформить отгул на пятницу"},
                {"text": "Где взять доступ к репозиторию?"},
            ],
        },
    )
    assert r.status_code == 200
    clusters = r.json()["clusters"]
    assert clusters[0]["size"] == 2
    assert [q["id"] for q in clusters[0]["questions"]] == ["q1", "q2"]


async def test_endpoints_require_token():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://ai") as c:
        r = await c.post("/questions/clusters", json={"questions": [{"text": "x"}]})
    assert r.status_code == 401
