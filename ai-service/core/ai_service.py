from collections.abc import AsyncIterator, Sequence

from openai import AsyncOpenAI

from config import get_settings


class LLMUnavailableError(Exception):
    pass


class AIService:
    def __init__(self):
        settings = get_settings()
        self.settings = settings
        self.llm_client = (
            AsyncOpenAI(
                base_url=settings.LLM_BASE_URL,
                api_key=settings.LLM_API_KEY,
                timeout=60,
                max_retries=0,
            )
            if settings.LLM_API_KEY
            else None
        )

    async def get_ai_stream(
        self,
        prompt: str,
        history: Sequence[dict[str, str]] = (),
    ) -> AsyncIterator[str]:
        if self.llm_client is None:
            raise LLMUnavailableError("LLM_API_KEY is not configured")

        messages = [*history, {"role": "user", "content": prompt}]
        response = await self.llm_client.chat.completions.create(
            model=self.settings.LLM_MODEL,
            messages=messages,
            stream=True,
        )
        try:
            async for chunk in response:
                token = chunk.choices[0].delta.content
                if token:
                    yield token
        finally:
            await response.close()


def get_ai_service() -> AIService:
    return AIService()
