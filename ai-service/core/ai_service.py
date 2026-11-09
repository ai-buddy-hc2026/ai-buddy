from openai import AsyncOpenAI

from config import get_settings


class AIService:
    def __init__(self):
        settings = get_settings()
        self.settings = settings
        self.llm_client = AsyncOpenAI(
            base_url=settings.LLM_BASE_URL,
            api_key=settings.LLM_API_KEY,
        )

    async def get_ai_stream(self, prompt: str):
        response = await self.llm_client.chat.completions.create(
            model=self.settings.LLM_MODEL,
            messages=[{"role": "user", "content": prompt}],
            stream=True,
        )
        async for chunk in response:
            token = chunk.choices[0].delta.content
            if token:
                yield token
