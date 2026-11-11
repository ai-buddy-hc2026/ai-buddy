import logging
import os
import sys
import time
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler
from pathlib import Path

import redis.asyncio as aioredis
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import RequestResponseEndpoint

from api.v1.core import core_router
from config import get_settings


def configure_logging() -> None:
    level_name = os.getenv("AI_SERVICE_LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, None)
    if not isinstance(level, int):
        raise ValueError(f"Недопустимый уровень логирования: {level_name}")

    log_dir = Path(os.getenv("AI_SERVICE_LOG_DIR", "logs"))
    log_dir.mkdir(parents=True, exist_ok=True)
    formatter = logging.Formatter(
        "%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    file_handler = RotatingFileHandler(
        log_dir / "ai-service.log",
        maxBytes=10 * 1024 * 1024,
        backupCount=5,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)

    root_logger = logging.getLogger()
    root_logger.handlers.clear()
    root_logger.setLevel(level)
    root_logger.addHandler(console_handler)
    root_logger.addHandler(file_handler)

    for logger_name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        uvicorn_logger = logging.getLogger(logger_name)
        uvicorn_logger.handlers.clear()
        uvicorn_logger.setLevel(level)
        uvicorn_logger.propagate = True


configure_logging()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    app.state.redis = aioredis.Redis.from_url(
        settings.redis_url,
        decode_responses=True,
    )
    logger.info("ai-service запущен")
    try:
        yield
    finally:
        await app.state.redis.aclose()
        logger.info("ai-service остановлен")


async def http_error_handler(_request, error: HTTPException):
    codes = {
        400: ("INVALID_REQUEST", "Некорректный запрос."),
        401: ("UNAUTHORIZED", "Требуется служебная авторизация."),
        409: ("REQUEST_ID_CONFLICT", "Идентификатор использован с другими данными."),
        503: ("SERVICE_UNAVAILABLE", "AI-сервис временно недоступен."),
    }
    code, message = codes.get(error.status_code, ("INTERNAL_ERROR", "Ошибка AI-сервиса."))
    return JSONResponse(
        status_code=error.status_code,
        content={"error": {"code": code, "message": message}},
        headers=error.headers,
    )


async def invalid_request_handler(_request, _error: RequestValidationError):
    return JSONResponse(
        status_code=400,
        content={"error": {"code": "INVALID_REQUEST", "message": "Некорректный запрос."}},
    )


def create_app() -> FastAPI:
    application = FastAPI(
        title="AI-buddy",
        lifespan=lifespan,
    )
    application.add_exception_handler(HTTPException, http_error_handler)
    application.add_exception_handler(RequestValidationError, invalid_request_handler)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @application.middleware("http")
    async def log_requests(
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> Response:
        started_at = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            duration_ms = (time.perf_counter() - started_at) * 1000
            logger.exception(
                "HTTP запрос завершился ошибкой method=%s path=%s duration_ms=%.2f",
                request.method,
                request.url.path,
                duration_ms,
            )
            raise

        duration_ms = (time.perf_counter() - started_at) * 1000
        logger.info(
            "HTTP запрос method=%s path=%s status=%s duration_ms=%.2f",
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
        )
        return response

    return application


app = create_app()
app.include_router(core_router)
