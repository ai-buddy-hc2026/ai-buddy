"""Сквозная проверка чата с compose.test.yml и синтетической LLM."""

import argparse
import json
import time
import urllib.error
import urllib.request


def run(base):
    def request(path, token=None, data=None, headers=None):
        values = dict(headers or {})
        if token:
            values["Authorization"] = "Bearer " + token
        if data is not None:
            values["Content-Type"] = "application/json"
        return urllib.request.urlopen(
            urllib.request.Request(
                base + path,
                data=None if data is None else json.dumps(data).encode(),
                headers=values,
            ),
            timeout=70,
        )

    def read_json(path, token=None, data=None):
        with request(path, token, data) as response:
            return response.status, json.load(response)

    def login(name):
        return read_json("/auth/mock-login", data={"login": name})[1]["access_token"]

    def denied(path, token, expected, headers=None):
        try:
            with request(path, token, headers=headers):
                raise AssertionError("unexpected access: " + path)
        except urllib.error.HTTPError as error:
            assert error.code == expected, (error.code, expected)
            error.close()

    def events(response):
        frame = {}
        for raw in response:
            line = raw.decode("utf-8").rstrip("\r\n")
            if not line:
                if "data" in frame:
                    yield frame, json.loads(frame["data"])
                frame = {}
            elif not line.startswith(":"):
                key, value = line.split(":", 1)
                frame[key] = value.lstrip(" ")

    token, foreign = login("intern_anya"), login("intern_petr")
    status, accepted = read_json("/chat/messages", token, {"message": "Тестовый вопрос"})
    assert status == 202
    request_id, stream = accepted["request_id"], accepted["stream_url"]
    received = []
    with request(stream, token) as response:
        assert response.headers["Content-Type"] == "text/event-stream"
        for frame, event in events(response):
            assert event["request_id"] == request_id
            assert frame["id"] == request_id + ":" + str(event["seq"])
            assert frame["event"] == event["event"]
            received.append((time.monotonic(), event))
    assert [event["seq"] for _, event in received] == [1, 2, 3, 4]
    assert [event["event"] for _, event in received] == ["token"] * 3 + ["done"]
    final = received[-1][1]["data"]
    assert final == {"full_text": "Тестовый ответ по частям.", "sources": []}
    assert received[-1][0] - received[0][0] > 0.05, "SSE was buffered"

    denied(stream, None, 401)
    denied(stream, foreign, 404)
    denied(stream, token, 400, {"Last-Event-ID": "invalid"})

    with request(stream, token, headers={"Last-Event-ID": request_id + ":2"}) as response:
        replay = [event for _, event in events(response)]
    assert [event["seq"] for event in replay] == [3, 4]
    _, history = read_json("/chat/messages?conversation_id=" + accepted["conversation_id"], token)
    turn = next(item for item in history["items"] if item["request"]["request_id"] == request_id)
    assert turn["request"]["status"] == "done"
    assert [message["role"] for message in turn["messages"]] == ["user", "assistant"]
    assert turn["messages"][1]["content"] == final["full_text"]
    assert history["active_request"] is None
    print("chat: 202, live SSE, replay, history, owner checks OK")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8080")
    run(parser.parse_args().base_url.rstrip("/"))
