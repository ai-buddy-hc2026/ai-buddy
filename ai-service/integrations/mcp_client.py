import asyncio
import logging
import time
from typing import Any, Awaitable, Callable

import httpx2
import jsonschema
from jsonschema import Draft202012Validator, FormatChecker
from mcp import ClientSession, types
from mcp.client.streamable_http import streamable_http_client

from config import get_settings

logger = logging.getLogger(__name__)

PROTOCOL_VERSION = "2025-06-18"
MAX_CALL_TIMEOUT_SEC = 10.0
RETRY_DELAY_SEC = 0.2
WRITE_TOOLS = {"checklist.update_status", "absences.create_request"}
HTTP_ERROR_CODES = {
    400: "INVALID_REQUEST_ID",
    401: "UNAUTHORIZED",
    403: "ORIGIN_NOT_ALLOWED",
    404: "REQUEST_NOT_FOUND",
    410: "REQUEST_CLOSED",
    503: "CONTEXT_UNAVAILABLE",
}


class MCPContractError(Exception):
    def __init__(self, code: str, message: str, retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


class GenerationMCPClient:
    def __init__(
        self,
        request_id: str,
        deadline_monotonic: float,
        publish_action_proposal: Callable[[str, dict[str, Any]], Awaitable[None]],
        server_url: str | None = None,
        service_token: str | None = None,
        app_version: str = "0.1.0",
    ):
        self.request_id = request_id
        self.deadline_monotonic = deadline_monotonic
        self.publish_action_proposal = publish_action_proposal
        settings = get_settings()
        self.server_url = server_url or settings.MCP_SERVER_URL
        self.service_token = service_token or settings.MCP_SERVICE_TOKEN
        if not self.service_token:
            raise MCPContractError(
                "INTERNAL_ERROR",
                "Не настроен токен для подключения к MCP",
            )
        self.app_version = app_version

        self._session: ClientSession | None = None
        self._exit_stack = None
        self._tools_schemas: dict[str, dict[str, Any]] = {}
        self._format_checker = FormatChecker()

    def _remaining_budget(self) -> float:
        return self.deadline_monotonic - time.monotonic()

    def _compute_call_timeout(self) -> float:
        remaining = self._remaining_budget()
        if remaining <= 0:
            raise MCPContractError("TIMEOUT", "Дедлайн генерации истек", retryable=False)
        return min(MAX_CALL_TIMEOUT_SEC, remaining)

    def _build_headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.service_token}",
            "X-Request-ID": self.request_id,
            "Accept": "application/json, text/event-stream",
        }

    @staticmethod
    def _http_error(exc: httpx2.HTTPStatusError) -> MCPContractError:
        status = exc.response.status_code
        code = HTTP_ERROR_CODES.get(status, "INTERNAL_ERROR")
        try:
            body = exc.response.json()
        except ValueError:
            body = None

        if isinstance(body, dict):
            error = body.get("error")
            if isinstance(error, dict) and isinstance(error.get("code"), str):
                code = error["code"]

        return MCPContractError(
            code,
            "Ошибка HTTP при обращении к MCP",
            retryable=status == 503,
        )

    async def __aenter__(self) -> "GenerationMCPClient":
        from contextlib import AsyncExitStack

        logger.info("Подключение MCP request_id=%s", self.request_id)
        self._exit_stack = AsyncExitStack()
        try:
            timeout = self._compute_call_timeout()
            http_client = httpx2.AsyncClient(
                headers=self._build_headers(),
                timeout=timeout,
            )
            await self._exit_stack.enter_async_context(http_client)
            read_stream, write_stream, _ = await self._exit_stack.enter_async_context(
                streamable_http_client(
                    url=self.server_url,
                    http_client=http_client,
                ),
            )
            self._session = await self._exit_stack.enter_async_context(
                ClientSession(read_stream, write_stream),
            )

            init_result = await asyncio.wait_for(
                self._session.send_request(
                    types.InitializeRequest(
                        params=types.InitializeRequestParams(
                            protocolVersion=PROTOCOL_VERSION,
                            capabilities=types.ClientCapabilities(),
                            clientInfo=types.Implementation(
                                name="ai-buddy-python",
                                version=self.app_version,
                            ),
                        ),
                    ),
                    types.InitializeResult,
                ),
                timeout=self._compute_call_timeout(),
            )

            if init_result.protocol_version != PROTOCOL_VERSION:
                raise MCPContractError(
                    "INTERNAL_ERROR",
                    f"Несовместимая версия протокола MCP: {init_result.protocol_version}",
                )

            if not getattr(init_result.capabilities, "tools", None):
                raise MCPContractError(
                    "INTERNAL_ERROR",
                    "Сервер не объявил capability tools",
                )

            self._session.adopt(init_result)
            await self._session.send_notification(types.InitializedNotification())
            tools_response = await asyncio.wait_for(
                self._session.list_tools(),
                timeout=self._compute_call_timeout(),
            )

            for tool in tools_response.tools:
                self._tools_schemas[tool.name] = {
                    "description": tool.description or "",
                    "inputSchema": tool.input_schema,
                    "outputSchema": getattr(tool, "output_schema", None),
                }

            logger.info(
                "MCP-сессия готова request_id=%s protocol=%s tools=%s",
                self.request_id,
                init_result.protocol_version,
                len(self._tools_schemas),
            )
            return self
        except asyncio.TimeoutError as exc:
            await self._close_after_failed_enter()
            raise MCPContractError(
                "TIMEOUT",
                "Таймаут инициализации MCP",
                retryable=True,
            ) from exc
        except httpx2.HTTPStatusError as exc:
            await self._close_after_failed_enter()
            raise self._http_error(exc) from exc
        except httpx2.RequestError as exc:
            await self._close_after_failed_enter()
            raise MCPContractError(
                "DEPENDENCY_UNAVAILABLE",
                "Сетевой сбой при подключении к Go",
                retryable=True,
            ) from exc
        except MCPContractError:
            await self._close_after_failed_enter()
            raise
        except Exception as exc:
            await self._close_after_failed_enter()
            raise MCPContractError(
                "INTERNAL_ERROR",
                "Не удалось инициализировать MCP-сессию",
            ) from exc
        except BaseException:
            await self._close_after_failed_enter()
            raise

    async def _close_after_failed_enter(self) -> None:
        if self._exit_stack:
            await self._exit_stack.aclose()
        self._session = None

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        if self._exit_stack:
            await self._exit_stack.aclose()
        self._session = None
        logger.info("MCP-сессия закрыта request_id=%s", self.request_id)

    def get_tools_for_llm(self) -> list[dict[str, Any]]:
        return [
            {
                "name": name,
                "description": meta["description"],
                "inputSchema": meta["inputSchema"],
            }
            for name, meta in self._tools_schemas.items()
        ]

    def _validate_json(
        self,
        instance: Any,
        schema: dict[str, Any] | None,
        label: str,
    ) -> None:
        if not schema:
            raise MCPContractError("INTERNAL_ERROR", f"Отсутствует схема для {label}")
        try:
            validator = Draft202012Validator(schema, format_checker=self._format_checker)
            validator.validate(instance)
        except jsonschema.ValidationError as exc:
            raise MCPContractError(
                "INVALID_ARGUMENT",
                f"Ошибка валидации {label}: {exc.message}",
                retryable=False,
            ) from exc

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        if not self._session:
            raise RuntimeError("MCP-клиент не инициализирован. Используйте async with.")

        if name not in self._tools_schemas:
            raise MCPContractError(
                "POLICY_DENIED",
                f"Инструмент {name} недоступен",
                retryable=False,
            )

        schemas = self._tools_schemas[name]

        self._validate_json(arguments, schemas["inputSchema"], f"{name}.input")

        if name in WRITE_TOOLS:
            raise MCPContractError(
                "CONFIRMATION_REQUIRED",
                "Для записи требуется action_proposal и подтверждение пользователя.",
            )

        attempt = 0
        while True:
            attempt += 1
            try:
                logger.info(
                    "Вызов MCP-инструмента request_id=%s tool=%s attempt=%s",
                    self.request_id,
                    name,
                    attempt,
                )
                return await self._execute_read_call(
                    name,
                    arguments,
                    schemas["outputSchema"],
                )
            except MCPContractError as err:
                can_retry = (
                    err.retryable
                    and attempt == 1
                    and self._remaining_budget() > (RETRY_DELAY_SEC + 0.5)
                )
                if not can_retry:
                    logger.error(
                        "Вызов MCP-инструмента завершился ошибкой request_id=%s "
                        "tool=%s code=%s",
                        self.request_id,
                        name,
                        err.code,
                    )
                    raise
                logger.warning(
                    "Повтор вызова MCP-инструмента request_id=%s tool=%s code=%s",
                    self.request_id,
                    name,
                    err.code,
                )
                await asyncio.sleep(RETRY_DELAY_SEC)

    async def propose_action(
        self,
        name: str,
        arguments: dict[str, Any],
    ) -> dict[str, Any]:
        if not self._session:
            raise RuntimeError("MCP-клиент не инициализирован. Используйте async with.")
        if name not in WRITE_TOOLS or name not in self._tools_schemas:
            raise MCPContractError(
                "POLICY_DENIED",
                f"Инструмент {name} недоступен для предложения",
            )

        schemas = self._tools_schemas[name]
        self._validate_json(arguments, schemas["inputSchema"], f"{name}.input")
        failure = {
            "ok": False,
            "error": {
                "code": "CONFIRMATION_REQUIRED",
                "message": "Действие предложено и ожидает подтверждения пользователя.",
                "retryable": False,
            },
        }
        self._validate_json(failure, schemas["outputSchema"], f"{name}.output")
        await self.publish_action_proposal(name, arguments)
        logger.info(
            "Создано предложение действия request_id=%s tool=%s",
            self.request_id,
            name,
        )
        return failure

    async def _execute_read_call(
        self,
        name: str,
        arguments: dict[str, Any],
        output_schema: dict[str, Any] | None,
    ) -> dict[str, Any]:
        timeout = self._compute_call_timeout()

        try:
            result = await asyncio.wait_for(
                self._session.call_tool(name=name, arguments=arguments),
                timeout=timeout,
            )
        except asyncio.TimeoutError as exc:
            raise MCPContractError(
                "TIMEOUT",
                f"Таймаут вызова {name}",
                retryable=True,
            ) from exc
        except httpx2.HTTPStatusError as exc:
            raise self._http_error(exc) from exc
        except httpx2.RequestError as exc:
            raise MCPContractError(
                "DEPENDENCY_UNAVAILABLE",
                "Сетевой сбой при обращении к Go",
                retryable=True,
            ) from exc

        structured = getattr(result, "structured_content", None)
        if structured is None:
            raise MCPContractError(
                "INTERNAL_ERROR",
                f"Ответ инструмента {name} не содержит structuredContent",
            )

        self._validate_json(structured, output_schema, f"{name}.output")

        is_error = bool(getattr(result, "is_error", False))
        ok_flag = structured.get("ok")

        if is_error != (ok_flag is False):
            raise MCPContractError(
                "INTERNAL_ERROR",
                "Несогласованность флагов isError и structuredContent.ok",
                retryable=False,
            )

        if is_error:
            err_body = structured["error"]
            raise MCPContractError(
                code=err_body["code"],
                message=err_body["message"],
                retryable=bool(err_body.get("retryable", False)),
            )
        return structured["data"]
