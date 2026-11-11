from collections.abc import AsyncIterator, Sequence

from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AsyncOpenAI,
)

from config import get_settings


class LLMUnavailableError(Exception):
    pass


class LLMTimeoutError(Exception):
    pass


class AIService:
    def __init__(self):
        settings = get_settings()
        self.settings = settings
        self.llm_client = (
            AsyncOpenAI(
                base_url=settings.LLM_BASE_URL,
                api_key=settings.LLM_API_KEY,
            )
            if settings.LLM_API_KEY
            else None
        )

    async def stream_step(
        self,
        messages: list[dict],
        tools: Sequence[dict] | None = None,
    ) -> AsyncIterator[dict]:
        if self.llm_client is None:
            raise LLMUnavailableError("LLM_API_KEY is not configured")

        kwargs: dict = {}
        if tools:
            kwargs["tools"] = [
                {
                    "type": "function",
                    "function": {
                        "name": t["name"],
                        "description": t.get("description", ""),
                        "parameters": t["inputSchema"],
                    },
                }
                for t in tools
            ]
            kwargs["tool_choice"] = "auto"

        try:
            response = await self.llm_client.chat.completions.create(
                model=self.settings.LLM_MODEL,
                messages=messages,
                stream=True,
                **kwargs,
            )
            async for chunk in response:
                delta = chunk.choices[0].delta
                if delta.content:
                    yield {"type": "token", "text": delta.content}
                if delta.tool_calls:
                    for tc in delta.tool_calls:
                        yield {"type": "tool_call_delta", "tool_call": tc}
        except APITimeoutError as e:
            raise LLMTimeoutError("LLM timeout") from e
        except (APIConnectionError, APIStatusError) as e:
            raise LLMUnavailableError("LLM unavailable") from e


def get_ai_service() -> AIService:
    return AIService()
