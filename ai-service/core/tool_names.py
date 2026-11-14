"""Соответствие имён MCP и функций модели в пределах одной генерации."""

import re
from collections.abc import Sequence


class ToolNameError(ValueError):
    pass


def valid_model_name(name: object) -> bool:
    return (
        isinstance(name, str) and re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", name) is not None
    )


class ToolNames:
    def __init__(self, tools: Sequence[dict]):
        self._model_to_mcp: dict[str, str] = {}
        self._mcp_to_model: dict[str, str] = {}
        for tool in tools:
            name = tool.get("name")
            if not isinstance(name, str):
                raise ToolNameError("Некорректное имя инструмента")
            alias = name.replace(".", "_")
            if not valid_model_name(alias):
                raise ToolNameError("Некорректное имя функции модели")
            if alias in self._model_to_mcp:
                raise ToolNameError("Имена инструментов конфликтуют")
            self._model_to_mcp[alias] = name
            self._mcp_to_model[name] = alias

    def for_model(self, name: str) -> str:
        return self._mcp_to_model[name]

    def for_mcp(self, alias: str) -> str:
        try:
            return self._model_to_mcp[alias]
        except KeyError as exc:
            raise ToolNameError("Модель вызвала недоступный инструмент") from exc
