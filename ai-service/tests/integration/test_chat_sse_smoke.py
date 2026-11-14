"""SSE smoke test for the Go API using the synthetic AI-service provider."""

import json
import os

import httpx2
import pytest

BACKEND_URL = os.getenv("TEST_BACKEND_URL", "http://backend:8080")
pytestmark = pytest.mark.skipif(
    os.getenv("RUN_CHAT_SSE_SMOKE") != "1",
    reason="requires compose.test.yml with the synthetic LLM server",
)
EXPECTED_TEXT = (
    "\u0422\u0435\u0441\u0442\u043e\u0432\u044b\u0439 "
    "\u043e\u0442\u0432\u0435\u0442 \u043f\u043e "
    "\u0447\u0430\u0441\u0442\u044f\u043c."
)


async def _login(client: httpx2.AsyncClient, login: str) -> str:
    response = await client.post("/auth/mock-login", json={"login": login})
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


async def _read_events(
    client: httpx2.AsyncClient,
    url: str,
    headers: dict[str, str],
) -> list[tuple[dict[str, str], dict]]:
    frames: list[tuple[dict[str, str], dict]] = []
    frame: dict[str, str] = {}
    async with client.stream("GET", url, headers=headers) as response:
        assert response.status_code == 200, await response.aread()
        assert response.headers["content-type"].startswith("text/event-stream")
        async for line in response.aiter_lines():
            if not line:
                if "data" in frame:
                    frames.append((frame, json.loads(frame["data"])))
                    if frames[-1][1]["event"] in {"done", "error"}:
                        break
                frame = {}
            elif not line.startswith(":"):
                key, separator, value = line.partition(":")
                assert separator
                frame[key] = value.lstrip(" ")
    return frames


@pytest.mark.asyncio
async def test_chat_sse_replay_history_and_owner_access():
    async with httpx2.AsyncClient(base_url=BACKEND_URL, timeout=70) as client:
        token = await _login(client, "intern_anya")
        foreign_token = await _login(client, "intern_petr")
        headers = {"Authorization": f"Bearer {token}"}

        accepted_response = await client.post(
            "/chat/messages",
            headers=headers,
            json={"message": "Synthetic smoke question"},
        )
        assert accepted_response.status_code == 202, accepted_response.text
        accepted = accepted_response.json()
        request_id = accepted["request_id"]
        stream_url = accepted["stream_url"]

        received = await _read_events(client, stream_url, headers)
        assert [event["seq"] for _, event in received] == [1, 2, 3, 4]
        assert [event["event"] for _, event in received] == ["token"] * 3 + ["done"]
        assert received[-1][1]["data"] == {
            "full_text": EXPECTED_TEXT,
            "sources": [],
            "answer_status": "answered",
            "question_category": "other",
        }
        assert all(event["request_id"] == request_id for _, event in received)
        assert all(
            frame["id"] == f"{request_id}:{event['seq']}"
            and frame["event"] == event["event"]
            for frame, event in received
        )

        denied = await client.get(stream_url)
        assert denied.status_code == 401
        foreign = await client.get(
            stream_url,
            headers={"Authorization": f"Bearer {foreign_token}"},
        )
        assert foreign.status_code == 404
        invalid_cursor = await client.get(
            stream_url,
            headers={**headers, "Last-Event-ID": "invalid"},
        )
        assert invalid_cursor.status_code == 400

        replay = await _read_events(
            client,
            stream_url,
            {**headers, "Last-Event-ID": f"{request_id}:2"},
        )
        assert [event["seq"] for _, event in replay] == [3, 4]

        history_response = await client.get(
            "/chat/messages",
            headers=headers,
            params={"conversation_id": accepted["conversation_id"]},
        )
        assert history_response.status_code == 200, history_response.text
        history = history_response.json()
        turn = next(
            item
            for item in history["items"]
            if item["request"]["request_id"] == request_id
        )
        assert turn["request"]["status"] == "done"
        assert [message["role"] for message in turn["messages"]] == ["user", "assistant"]
        assert turn["messages"][1]["content"] == EXPECTED_TEXT
        assert history["active_request"] is None
