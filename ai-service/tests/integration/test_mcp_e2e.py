import asyncio
import json
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import date, timedelta
from types import SimpleNamespace

import httpx
import pytest
import pytest_asyncio
import uvicorn

from api.v1.chat import get_ai_service
from main import app

BACKEND_URL = os.getenv("TEST_BACKEND_URL", "http://backend:8080")
EXPECTED_INTERN_TOOLS = {
    "absences.create_request",
    "absences.get_policy",
    "checklist.get_plan",
    "checklist.update_status",
    "employees.get_manager",
    "knowledge_search",
}
EXPECTED_BUDDY_TOOLS = EXPECTED_INTERN_TOOLS | {"absences.list_for_employee"}


class ScriptedAIService:
    llm_client = object()

    def __init__(self) -> None:
        self.calls: list[tuple[list[dict], list[dict]]] = []
        self.scenario = "manager"
        self.absence_date = (date.today() + timedelta(days=30)).isoformat()

    async def stream_step(
        self,
        messages: list[dict],
        tools: list[dict],
    ) -> AsyncIterator[dict]:
        self.calls.append((messages, tools))
        if self.scenario == "foreign_absences":
            async for chunk in self._stream_foreign_absences_scenario(
                messages,
                tools,
            ):
                yield chunk
            return

        if self.scenario == "absence":
            async for chunk in self._stream_absence_scenario(messages, tools):
                yield chunk
            return

        if len(self.calls) == 1:
            tool_names = {tool["name"] for tool in tools}
            assert tool_names == EXPECTED_INTERN_TOOLS
            assert "absences.list_for_employee" not in tool_names
            yield {
                "type": "tool_call_delta",
                "tool_call": SimpleNamespace(
                    index=0,
                    id="mcp-e2e-call",
                    function=SimpleNamespace(
                        name="employees_get_manager",
                        arguments="{}",
                    ),
                ),
            }
            return

        assert len(self.calls) == 2
        tool_message = messages[-1]
        assert tool_message["role"] == "tool"
        assert tool_message["tool_call_id"] == "mcp-e2e-call"
        tool_result = json.loads(tool_message["content"])
        assert "error" not in tool_result
        assert "manager" in tool_result
        yield {"type": "token", "text": "Я проверил информацию через Go."}

    async def _stream_absence_scenario(
        self,
        messages: list[dict],
        tools: list[dict],
    ) -> AsyncIterator[dict]:
        if len(self.calls) == 1:
            tool_names = {tool["name"] for tool in tools}
            assert tool_names == EXPECTED_BUDDY_TOOLS
            yield {
                "type": "tool_call_delta",
                "tool_call": SimpleNamespace(
                    index=0,
                    id="mcp-create-absence",
                    function=SimpleNamespace(
                        name="absences_create_request",
                        arguments=json.dumps(
                            {"date": self.absence_date, "type": "day_off"},
                        ),
                    ),
                ),
            }
            return

        if len(self.calls) == 2:
            confirmation = json.loads(messages[-1]["content"])
            assert messages[-1]["role"] == "tool"
            assert confirmation["error"]["code"] == "CONFIRMATION_REQUIRED"
            yield {
                "type": "tool_call_delta",
                "tool_call": SimpleNamespace(
                    index=0,
                    id="mcp-list-absences",
                    function=SimpleNamespace(
                        name="absences_list_for_employee",
                        arguments="{}",
                    ),
                ),
            }
            return

        assert len(self.calls) == 3
        absence_result = json.loads(messages[-1]["content"])
        assert messages[-1]["tool_call_id"] == "mcp-list-absences"
        assert absence_result["items"] == []
        yield {
            "type": "token",
            "text": "Заявка подготовлена и ожидает подтверждения.",
        }

    async def _stream_foreign_absences_scenario(
        self,
        messages: list[dict],
        tools: list[dict],
    ) -> AsyncIterator[dict]:
        if len(self.calls) == 1:
            tool_names = {tool["name"] for tool in tools}
            assert tool_names == EXPECTED_INTERN_TOOLS
            assert "absences.list_for_employee" not in tool_names
            yield {
                "type": "tool_call_delta",
                "tool_call": SimpleNamespace(
                    index=0,
                    id="mcp-forbidden-absences",
                    function=SimpleNamespace(
                        name="absences_list_for_employee",
                        arguments="{}",
                    ),
                ),
            }
            return

        assert len(self.calls) == 2
        denied_result = json.loads(messages[-1]["content"])
        assert messages[-1]["role"] == "tool"
        assert denied_result["error"]["code"] == "POLICY_DENIED"
        yield {
            "type": "token",
            "text": "Я не могу показывать чужие заявки на отсутствие.",
        }


@pytest_asyncio.fixture
async def ai_service_server() -> AsyncIterator[ScriptedAIService]:
    scripted_ai = ScriptedAIService()
    app.dependency_overrides[get_ai_service] = lambda: scripted_ai
    config = uvicorn.Config(
        app,
        host=os.getenv("TEST_AI_BIND_HOST", "0.0.0.0"),
        port=int(os.getenv("TEST_AI_PORT", "8000")),
        log_level="warning",
        lifespan="on",
    )
    server = uvicorn.Server(config)
    server_task = asyncio.create_task(server.serve())
    try:
        async with asyncio.timeout(15):
            while not server.started:
                if server_task.done():
                    await server_task
                await asyncio.sleep(0.05)
        yield scripted_ai
    finally:
        server.should_exit = True
        await server_task
        app.dependency_overrides.pop(get_ai_service, None)


@asynccontextmanager
async def _backend_client(token: str) -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(
        base_url=BACKEND_URL,
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    ) as client:
        yield client


async def _read_sse_events(
    client: httpx.AsyncClient,
    stream_url: str,
) -> list[dict]:
    events = []
    current_data: list[str] = []
    async with client.stream("GET", stream_url) as response:
        assert response.status_code == 200, await response.aread()
        async for line in response.aiter_lines():
            if line.startswith("data:"):
                current_data.append(line.removeprefix("data:").strip())
            elif not line and current_data:
                events.append(json.loads("\n".join(current_data)))
                current_data.clear()
                if events[-1]["event"] in {"done", "error"}:
                    break
    return events


@pytest.mark.asyncio
async def test_chat_calls_go_mcp_and_returns_tool_result_to_model(
    ai_service_server: ScriptedAIService,
) -> None:
    async with httpx.AsyncClient(base_url=BACKEND_URL, timeout=30) as client:
        login = await client.post("/auth/mock-login", json={"login": "intern_anya"})
        assert login.status_code == 200, login.text
        token = login.json()["access_token"]

    async with _backend_client(token) as client:
        chat_response = await client.post(
            "/chat/messages",
            json={"message": "Кто мой наставник?"},
        )
        assert chat_response.status_code == 202, chat_response.text
        response_data = chat_response.json()
        assert response_data["request_id"]
        events = await _read_sse_events(client, response_data["stream_url"])

    assert len(ai_service_server.calls) == 2
    assert [event["event"] for event in events] == [
        "tool_call",
        "token",
        "done",
    ]
    assert [event["seq"] for event in events] == [1, 2, 3]
    assert events[0]["data"]["tool_name"] == "employees.get_manager"
    assert events[1]["data"]["text"] == "Я проверил информацию через Go."
    assert events[-1]["data"]["full_text"] == "Я проверил информацию через Go."
    assert all(event["request_id"] == response_data["request_id"] for event in events)


@pytest.mark.asyncio
async def test_absence_proposal_requires_confirmation_and_persists_result(
    ai_service_server: ScriptedAIService,
) -> None:
    ai_service_server.scenario = "absence"
    async with httpx.AsyncClient(base_url=BACKEND_URL, timeout=30) as client:
        login = await client.post("/auth/mock-login", json={"login": "buddy_ilya"})
        assert login.status_code == 200, login.text
        token = login.json()["access_token"]

    async with _backend_client(token) as client:
        chat_response = await client.post(
            "/chat/messages",
            json={"message": "Подготовь заявку на отгул"},
        )
        assert chat_response.status_code == 202, chat_response.text
        response_data = chat_response.json()
        events = await _read_sse_events(client, response_data["stream_url"])

        actions_response = await client.get(
            "/actions",
            params={"conversation_id": response_data["conversation_id"]},
        )
        assert actions_response.status_code == 200, actions_response.text

    actions = actions_response.json()["items"]
    proposals = [
        action
        for action in actions
        if action["request_id"] == response_data["request_id"]
        and action["action_type"] == "absences.create_request"
    ]
    assert len(proposals) == 1
    proposal = proposals[0]
    assert proposal["status"] == "proposed"
    assert proposal["result"] == {}
    assert proposal["attempt_count"] == 0

    assert len(ai_service_server.calls) == 3
    assert [event["event"] for event in events] == [
        "tool_call",
        "action_proposal",
        "tool_call",
        "token",
        "done",
    ]
    proposal_event = events[1]["data"]
    assert proposal_event["action_type"] == "absences.create_request"
    assert proposal_event["details"]["date"] == ai_service_server.absence_date
    assert proposal_event["details"]["type"] == "day_off"
    assert events[3]["data"]["text"] == ("Заявка подготовлена и ожидает подтверждения.")
    assert all(event["request_id"] == response_data["request_id"] for event in events)

    action_id = proposal["id"]
    assert proposal_event["action_id"] == action_id

    async with _backend_client(token) as client:
        confirmation = await client.post(f"/actions/{action_id}/confirm")
        assert confirmation.status_code in {200, 202}, confirmation.text

        for _ in range(40):
            actions_response = await client.get(
                "/actions",
                params={"conversation_id": response_data["conversation_id"]},
            )
            assert actions_response.status_code == 200, actions_response.text
            actions = actions_response.json()["items"]
            confirmed_action = next(
                action for action in actions if action["id"] == action_id
            )
            if confirmed_action["status"] == "succeeded":
                break
            await asyncio.sleep(0.25)
        else:
            pytest.fail(
                "Подтвержденное действие не перешло в succeeded: " f"{confirmed_action}",
            )

        assert confirmed_action["result"]["external_id"]
        assert confirmed_action["result"]["status"] == "pending_approval"

        duplicate_confirmation = await client.post(
            f"/actions/{action_id}/confirm",
        )
        assert duplicate_confirmation.status_code == 200
        assert duplicate_confirmation.json()["result"] == confirmed_action["result"]

        history_response = await client.get(
            "/chat/messages",
            params={"conversation_id": response_data["conversation_id"]},
        )
        assert history_response.status_code == 200, history_response.text

    history = history_response.json()
    history_actions = [
        action
        for turn in history["items"]
        for action in turn["actions"]
        if action["id"] == action_id
    ]
    assert len(history_actions) == 1
    assert history_actions[0]["status"] == "succeeded"
    assert history_actions[0]["result"] == confirmed_action["result"]


@pytest.mark.asyncio
async def test_intern_cannot_read_foreign_absences(
    ai_service_server: ScriptedAIService,
) -> None:
    ai_service_server.scenario = "foreign_absences"
    async with httpx.AsyncClient(base_url=BACKEND_URL, timeout=30) as client:
        login = await client.post("/auth/mock-login", json={"login": "intern_anya"})
        assert login.status_code == 200, login.text
        token = login.json()["access_token"]

    async with _backend_client(token) as client:
        chat_response = await client.post(
            "/chat/messages",
            json={"message": "Покажи заявки на отгул другого сотрудника"},
        )
        assert chat_response.status_code == 202, chat_response.text
        response_data = chat_response.json()
        events = await _read_sse_events(client, response_data["stream_url"])

        actions_response = await client.get(
            "/actions",
            params={"conversation_id": response_data["conversation_id"]},
        )
        assert actions_response.status_code == 200, actions_response.text

    assert len(ai_service_server.calls) == 2
    assert [event["event"] for event in events] == [
        "token",
        "done",
    ]
    assert events[0]["data"]["text"] == (
        "Я не могу показывать чужие заявки на отсутствие."
    )
    assert events[-1]["data"]["full_text"] == events[0]["data"]["text"]
    assert "ABS-" not in events[-1]["data"]["full_text"]
    assert actions_response.json()["items"] == []
