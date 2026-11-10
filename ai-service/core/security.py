import hmac

from fastapi import Header, HTTPException, status

from config import get_settings

settings = get_settings()


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or missing bearer token",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def verify_token(authorization: str | None = Header(default=None)) -> str:
    parts = authorization.split() if authorization else []
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise _unauthorized()

    ai_service_token = parts[1]
    if not hmac.compare_digest(
        ai_service_token.encode("utf-8"),
        settings.AI_SERVICE_TOKEN.encode("utf-8"),
    ):
        raise _unauthorized()

    return ai_service_token
