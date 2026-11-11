from contextlib import asynccontextmanager

import redis.asyncio as aioredis
from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api.v1.core import core_router
from config import get_settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    app.state.redis = aioredis.Redis.from_url(
        settings.redis_url,
        decode_responses=True,
    )
    yield
    await app.state.redis.aclose()


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

    return application


app = create_app()
app.include_router(core_router)
