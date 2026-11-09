from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    REDIS_HOST: str = "redis"
    REDIS_PASSWORD: str
    REDIS_USER: str
    REDIS_USER_PASSWORD: str
    REDIS_PORT: int = 6379

    @property
    def redis_url(self) -> str:
        return (
            f"redis://{self.REDIS_USER}"
            f":{self.REDIS_USER_PASSWORD}"
            f"@{self.REDIS_HOST}"
            f":{self.REDIS_PORT}/0"
        )


@lru_cache
def get_settings(**kwargs) -> Settings:
    return Settings(**kwargs)
