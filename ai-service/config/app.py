from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    REDIS_HOST: str = "redis"
    REDIS_PORT: int = 6379

    LLM_PROVIDER: str
    LLM_BASE_URL: str
    LLM_MODEL: str
    LLM_API_KEY: str = ""
    POSTGRES_URL: str = ""

    AI_SERVICE_TOKEN: str

    @property
    def redis_url(self) -> str:
        return f"redis://{self.REDIS_HOST}:{self.REDIS_PORT}/0"


@lru_cache
def get_settings(**kwargs) -> Settings:
    return Settings(**kwargs)
