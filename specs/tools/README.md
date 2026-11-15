# Инструменты AI-buddy

Матрица прав и JSON Schema: [MCP](../../docs/mcp.md). Реализация проверок:
[policy Go](../../backend/internal/policy/policy.go). Аргументы модели не определяют права.

| Операция | Доступ | Подтверждение |
|---|---|---|
| checklist.get_plan | intern: свой; buddy: назначенные; lead: своя команда | нет |
| checklist.update_status | исполнитель в доступном плане | да, для агентного пути |
| employees.get_manager | все, про себя | нет |
| absences.get_policy | все, своя команда | нет |
| absences.create_request | все, за себя | да |
| absences.list_for_employee | buddy: назначенные; lead: команда; intern запрещено | нет |
| knowledge.search | intern, своя команда после проверки Go | нет |
| escalation.create | внутренний исполнитель Go для intern; Python не подключён | да |

Первые шесть операций опубликованы в MCP. knowledge.search выполняется в Python
после POST /mcp/knowledge-scope. escalation.create не входит в MCP tools/list.
Служебный токен и request_id связывают вызов с доверенным контекстом Go.
Имена MCP с точками преобразуются для LLM и восстанавливаются транспортным адаптером.
