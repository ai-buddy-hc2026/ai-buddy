# checklist.update_status

Статус задачи. Действующий профиль реализации.

## Вход и права

Параметры предложения: `task_id` (UUID), `status` (todo/in_progress/blocked/done), `version` из текущей задачи. Менять может только исполнитель в доступном плане; правила видимости те же, что у checklist.get_plan.

## Поведение

Python публикует action_proposal. Прямой MCP-write возвращает CONFIRMATION_REQUIRED. Go выполняет действие после HTTP-confirm; результат содержит task_id, old_status, status, version, updated_at. Прямой PATCH из UI является отдельным пользовательским запросом.

## Контракт и ошибки

Точные JSON Schema и примеры: [MCP, раздел 5](../../docs/mcp.md#5-данные-и-json-schema).
Ответ MCP имеет ok/data либо ok/error; коды ошибок и retryable определены
в [разделе 7](../../docs/mcp.md#7-ошибки-и-повторы). Go проверяет права при каждом вызове.
Внутренние ID - UUID; внешний номер заявки сохраняет формат интеграции.
