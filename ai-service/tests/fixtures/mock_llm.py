"""OpenAI-compatible deterministic server for chat scenarios."""

import json
import re
import time
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ORDINARY = "ordinary"
LEAVE = "leave"
FOREIGN_DATA = "foreign_data"
UNKNOWN = "unknown"


def _last_user_message(messages: list[dict]) -> str:
    return next(
        (
            str(message.get("content") or "")
            for message in reversed(messages)
            if message.get("role") == "user"
        ),
        "",
    ).casefold()


def _scenario(messages: list[dict]) -> str:
    text = _last_user_message(messages)
    foreign_markers = (
        "intern_petr",
        "team_avito_platform",
        "\u0447\u0443\u0436",
        (
            "\u0434\u0440\u0443\u0433\u043e\u0433\u043e "
            "\u0441\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a\u0430"
        ),
        "\u0434\u0440\u0443\u0433\u0438\u0445 \u0434\u0430\u043d\u043d\u044b\u0445",
        "dbfb17a0-42f7-5d7d-be94-11f5d55842bf",
        "e0a8436e-ef77-509c-af7c-2c7c676eb1a4",
        "2db7cc77-4114-52d8-a833-f670ab60e4e0",
        "e5aba0fd-91e6-59e4-a046-7960848af1a2",
    )
    if any(marker in text for marker in foreign_markers):
        return FOREIGN_DATA
    leave_markers = (
        "\u043e\u0442\u0433\u0443\u043b",
        "\u0432\u044b\u0445\u043e\u0434\u043d\u043e\u0439",
        "day off",
    )
    if any(marker in text for marker in leave_markers):
        return LEAVE
    if any(
        marker in text
        for marker in (
            "\u043d\u0435 \u0437\u043d\u0430\u044e",
            "\u043d\u0435\u0438\u0437\u0432\u0435\u0441\u0442",
            "\u0432\u044b\u043c\u044b\u0448\u043b",
            "\u0432\u043d\u0435 \u0431\u0430\u0437\u044b",
            (
                "\u0431\u044e\u0434\u0436\u0435\u0442 "
                "\u043a\u043e\u043d\u0444\u0435\u0440\u0435\u043d\u0446\u0438\u0438"
            ),
        )
    ):
        return UNKNOWN
    return ORDINARY


def _previous_tool_call(messages: list[dict]) -> str | None:
    for message in reversed(messages):
        if message.get("role") == "assistant" and message.get("tool_calls"):
            return message["tool_calls"][0]["function"]["name"]
    return None


def _stream_chunk(delta: dict, finish_reason: str | None = None) -> bytes:
    chunk = {
        "id": "synthetic-completion",
        "object": "chat.completion.chunk",
        "created": 0,
        "model": "synthetic-model",
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish_reason}],
    }
    return ("data: " + json.dumps(chunk, ensure_ascii=False) + "\n\n").encode()


def _tool_call(name: str, call_id: str, arguments: dict) -> bytes:
    return _stream_chunk(
        {
            "tool_calls": [
                {
                    "index": 0,
                    "id": call_id,
                    "type": "function",
                    "function": {
                        "name": name.replace(".", "_"),
                        "arguments": json.dumps(arguments),
                    },
                },
            ],
        },
        "tool_calls",
    )


class Handler(BaseHTTPRequestHandler):
    def log_message(self, _format, *_args):
        pass

    def _write_json(self, body: dict, status: int = 200) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(body, ensure_ascii=False).encode())

    def _write_stream(self, body: dict) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        messages = body.get("messages", [])
        scenario = _scenario(messages)
        previous_call = _previous_tool_call(messages)

        if scenario == LEAVE and previous_call is None:
            leave_date = (date.today() + timedelta(days=30)).isoformat()
            self.wfile.write(
                _tool_call(
                    "absences.create_request",
                    "mock-leave-request",
                    {"date": leave_date, "type": "day_off"},
                ),
            )
        elif scenario == FOREIGN_DATA and previous_call is None:
            self.wfile.write(
                _tool_call(
                    "checklist.get_plan",
                    "mock-foreign-data-request",
                    {"intern_id": "2db7cc77-4114-52d8-a833-f670ab60e4e0"},
                ),
            )
        else:
            answers = {
                ORDINARY: (
                    "\u0422\u0435\u0441\u0442\u043e\u0432\u044b\u0439 ",
                    "\u043e\u0442\u0432\u0435\u0442 ",
                    "\u043f\u043e \u0447\u0430\u0441\u0442\u044f\u043c.",
                ),
                LEAVE: (
                    "\u0417\u0430\u044f\u0432\u043a\u0430 "
                    "\u043f\u043e\u0434\u0433\u043e\u0442\u043e"
                    "\u0432\u043b\u0435\u043d\u0430 "
                    "\u0438 \u043e\u0436\u0438"
                    "\u0434\u0430\u0435\u0442 "
                    "\u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436"
                    "\u0434\u0435\u043d\u0438\u044f.",
                ),
                FOREIGN_DATA: (
                    "\u042f \u043d\u0435 \u043c\u043e\u0433\u0443 "
                    "\u043f\u043e\u043a\u0430\u0437\u044b\u0432\u0430\u0442\u044c "
                    "\u0447\u0443\u0436\u0438\u0435 \u0434\u0430\u043d\u043d\u044b\u0435 "
                    "\u0438\u043b\u0438 \u0437\u0430\u044f\u0432\u043a\u0438.",
                ),
                UNKNOWN: (
                    "\u041d\u0435 \u0437\u043d\u0430\u044e: "
                    "\u0432 \u0442\u0435\u0441\u0442\u043e\u0432\u043e\u0439 "
                    "\u0431\u0430\u0437\u0435 \u0437\u043d\u0430\u043d\u0438\u0439 "
                    "\u043d\u0435\u0442 \u043e\u0442\u0432\u0435\u0442\u0430 "
                    "\u043d\u0430 \u044d\u0442\u043e\u0442 "
                    "\u0432\u043e\u043f\u0440\u043e\u0441.",
                ),
            }
            for part in answers[scenario]:
                self.wfile.write(_stream_chunk({"content": part}))
                self.wfile.flush()
                time.sleep(0.05)

        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()

    def do_POST(self):  # noqa: N802 - required by BaseHTTPRequestHandler
        if self.path != "/v1/chat/completions":
            self.send_error(404)
            return
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
        names = [t["function"]["name"] for t in body.get("tools", [])]
        names += [
            call["function"]["name"]
            for message in body.get("messages", [])
            for call in message.get("tool_calls", [])
        ]
        if any(not re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", name) for name in names):
            self._write_json({"error": {"code": "invalid_tool_name"}}, status=400)
            return
        if body.get("stream", False):
            self._write_stream(body)
            return
        categories = {
            ORDINARY: "other",
            LEAVE: "task",
            FOREIGN_DATA: "access",
            UNKNOWN: "other",
        }
        content = json.dumps(
            {"category": categories[_scenario(body.get("messages", []))]},
        )
        self._write_json(
            {
                "id": "synthetic-classification",
                "object": "chat.completion",
                "created": 0,
                "model": "synthetic-model",
                "choices": [
                    {
                        "index": 0,
                        "message": {"content": content},
                        "finish_reason": "stop",
                    },
                ],
            },
        )


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8090), Handler).serve_forever()
