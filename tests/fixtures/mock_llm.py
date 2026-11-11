"""OpenAI-совместимый сервер только для воспроизводимых интеграционных проверок."""

import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    def log_message(self, _format, *_args):
        pass

    def do_POST(self):
        if self.path != "/v1/chat/completions":
            self.send_error(404)
            return
        self.rfile.read(int(self.headers.get("Content-Length", "0")))
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        for part in ("Тестовый ", "ответ ", "по частям."):
            chunk = {
                "id": "synthetic-completion",
                "object": "chat.completion.chunk",
                "created": 0,
                "model": "synthetic-model",
                "choices": [{"index": 0, "delta": {"content": part}, "finish_reason": None}],
            }
            self.wfile.write(("data: " + json.dumps(chunk) + "\n\n").encode())
            self.wfile.flush()
            time.sleep(0.15)
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8090), Handler).serve_forever()
