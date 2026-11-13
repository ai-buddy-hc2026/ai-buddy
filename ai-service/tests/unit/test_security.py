import pytest
from fastapi import HTTPException, status

from core import security


@pytest.fixture
def configured_service_token(monkeypatch):
    monkeypatch.setattr(security.settings, "AI_SERVICE_TOKEN", "test-service-token")


@pytest.mark.parametrize(
    "authorization",
    [
        None,
        "",
        "Bearer",
        "Bearer token extra",
        "Basic test-service-token",
    ],
)
async def test_verify_token_rejects_malformed_authorization(
    authorization,
    configured_service_token,
):
    with pytest.raises(HTTPException) as exc_info:
        await security.verify_token(authorization)

    assert exc_info.value.status_code == status.HTTP_401_UNAUTHORIZED
    assert exc_info.value.headers["WWW-Authenticate"] == "Bearer"


@pytest.mark.parametrize("scheme", ["Bearer", "bearer", "BEARER"])
async def test_verify_token_accepts_valid_token(scheme, configured_service_token):
    result = await security.verify_token(f"{scheme} test-service-token")

    assert result == "test-service-token"


async def test_verify_token_rejects_wrong_token(configured_service_token):
    with pytest.raises(HTTPException) as exc_info:
        await security.verify_token("Bearer wrong-token")

    assert exc_info.value.status_code == status.HTTP_401_UNAUTHORIZED
