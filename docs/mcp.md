# MCP-контракт Go API и Python AI-service

Версия: `1.1-draft`. Дата: 11.11.2026.
Статус: предложение для ревью владельцами Go, Python и продукта. Не является утвержденным контрактом или отчетом о готовой реализации.
Предлагаемое место после согласования: `docs/mcp.md`.

## 1. Назначение и границы

Документ задает прикладной контракт инструментов между Python MCP Client и Go MCP Server: транспорт, доверенный контекст, схемы, права, ошибки, подтверждения и критерии совместимости. Нормативные слова ДОЛЖЕН и НЕЛЬЗЯ относятся к предлагаемой редакции после ее согласования.

Основа в репозитории: `docs/ai-contract.md` версии `1.2-draft`, `docs/mvp.md`, `docs/db.md` и черновик `docs/openapi.yaml`. Эти документы сами содержат несогласованные части; данная редакция не меняет их статус. До слияния необходимо синхронизировать расхождения из раздела 12.

Профиль этой поставки содержит шесть Go-инструментов:

- `checklist.get_plan`;
- `checklist.update_status`;
- `employees.get_manager`;
- `absences.get_policy`;
- `absences.create_request`;
- `absences.list_for_employee`.

Это этап интеграции, а не весь MVP. `knowledge.search` относится к RAG в Python и описывается отдельно с обязательной фильтрацией доступа. `escalation.create` нужен для сценария помощи наставника в MVP, но не входит в этот профиль. Его исключение из этой поставки не означает исключения из MVP.

Go является единственной точкой авторизации и выполнения корпоративных операций. Python не обращается к корпоративным таблицам или интеграциям в обход Go. Браузер не обращается к `/mcp`.

## 2. Базовый протокол

### 2.1. Версия и транспорт

Для воспроизводимой первой реализации предлагается MCP `2025-06-18`, JSON-RPC `2.0`, Streamable HTTP. Это выбранная базовая версия, а не утверждение, что она самая новая. Переход на другую версию требует согласованного изменения клиента, сервера и проверок.

В текущем Compose сервис Go называется `backend`, поэтому внутренний адрес:

```text
http://backend:8080/mcp
```

Переменные окружения:

```dotenv
MCP_SERVER_URL=http://backend:8080/mcp
MCP_SERVICE_TOKEN=<отдельный-случайный-секрет-python-to-go>
AI_SERVICE_TOKEN=<другой-случайный-секрет-go-to-python>
```

Это пример настроек для будущей интеграции. Наличие этих переменных и рабочего `/mcp` в текущей реализации не заявляется.

- `AI_SERVICE_TOKEN`: Go отправляет, Python проверяет при `POST /chat`.
- `MCP_SERVICE_TOKEN`: Python отправляет, Go проверяет при обращении к `/mcp`.
- Токены имеют разные значения, не передаются браузеру, LLM или в аргументы инструментов.
- HTTP допустим только во внутренней доверенной сети разработки. При передаче вне нее требуется TLS.

### 2.2. Инициализация и HTTP

Python использует стандартный MCP SDK и выполняет `initialize`, проверяет `protocolVersion` и capability `tools`, затем отправляет `notifications/initialized`. До этого `tools/list` и `tools/call` не выполняются.

Параметры initialize: `protocolVersion: "2025-06-18"`, `capabilities: {}`, `clientInfo: {"name": "ai-buddy-python", "version": "<версия приложения>"}`. Go отвечает той же версией протокола, `capabilities: {"tools": {"listChanged": false}}` и своим `serverInfo`.

Профиль Go не создает MCP-сессии и не выдает `Mcp-Session-Id`. Python выполняет жизненный цикл через SDK; отсутствие серверной сессии не означает пропуск инициализации. Отдельный экземпляр клиента на генерацию исключает перенос пользовательского контекста между конкурентными генерациями.

Все POST-запросы используют:

```http
Authorization: Bearer <MCP_SERVICE_TOKEN>
Content-Type: application/json
Accept: application/json, text/event-stream
X-Request-ID: 20000000-0000-0000-0000-000000000001
```

После initialize Python дополнительно отправляет `MCP-Protocol-Version: 2025-06-18`. X-Request-ID и служебная аутентификация обязательны также для инициализации и уведомлений этого клиента.

Go возвращает ответы на JSON-RPC requests как `application/json`. Для принятого `notifications/initialized` и других допустимых уведомлений возвращается HTTP 202 без тела. Python SDK должен поддерживать оба стандартных типа ответа Streamable HTTP, включая SSE.

`GET /mcp` возвращает 405: отдельный поток серверных уведомлений не используется. `DELETE /mcp` возвращает 405: серверных MCP-сессий нет. MCP SSE и пользовательский SSE `GET /chat/stream/{request_id}` являются разными соединениями.

Go отклоняет запрос с присутствующим Origin, не входящим в явный allowlist. Для внутреннего клиента без Origin запрос допустим при успешной аутентификации. `/mcp` не должен становиться публичным браузерным API.

### 2.3. Версии библиотек

Точные версии Go SDK и Python SDK выбираются после проверки поддержки этого профиля и фиксируются в `go.mod`/`go.sum` и действующем файле зависимостей Python. В текущем проекте Python использует `ai-service/requirements/`, а не раздел зависимостей pyproject.toml.

Непроверенные номера версий в контракт не включены. Интеграционный PR обязан указать реально использованную пару версий и результат проверки `initialize -> tools/list -> tools/call`. Без этого совместимость SDK не считается подтвержденной.

## 3. Доверенный контекст и время жизни

1. До POST /chat Go сохраняет генерацию и ее владельца.
2. Python берет request_id из принятого POST /chat и передает его в X-Request-ID. Заголовок устанавливает инфраструктурный код Python, а не LLM.
3. Go связывает идентификатор с сохраненными `chat_requests.user_id`, беседой и командой. Роль, активность пользователя, назначения наставника и права проверяются по актуальным доверенным данным, а не только по context_snapshot.
4. user_id, team_id, role, approver, idempotency_key и флаг подтверждения не принимаются как авторитетные аргументы от модели.
5. Для вызовов Python генерация должна иметь статус running, а текущий момент должен быть раньше deadline_at. Дедлайн генерации остается 60 секунд по ai-contract.md.
6. Каждый tool call повторно проверяет права. Фильтрация tools/list не заменяет проверку вызова и SQL/интеграционной выборки.
7. Результат чтения, пришедший после дедлайна или закрытия генерации, не используется для продолжения ответа.

Проверки HTTP до выполнения JSON-RPC метода:

| HTTP | error.code | Условие |
|------|------------|---------|
| 401 | UNAUTHORIZED | Нет служебного токена или он неверен. |
| 403 | ORIGIN_NOT_ALLOWED | Присутствующий Origin не разрешен. |
| 400 | INVALID_REQUEST_ID | Нет X-Request-ID или нарушен формат UUID. |
| 404 | REQUEST_NOT_FOUND | Генерация не найдена. |
| 410 | REQUEST_CLOSED | Генерация завершена либо дедлайн истек. |
| 400 | UNSUPPORTED_PROTOCOL_VERSION | Неподдерживаемый MCP-Protocol-Version после инициализации. |
| 503 | CONTEXT_UNAVAILABLE | Доверенный контекст нельзя проверить из-за сбоя зависимости. |

Ошибки этого слоя имеют тело `{"error":{"code":"...","message":"..."}}`, без JSON-RPC result. Неверный токен проверяется раньше существования request_id; ответ 401 содержит `WWW-Authenticate: Bearer`. Неизвестный request_id не раскрывает данные владельца. Стандартные ошибки HTTP-транспорта, например 405/406/415, сохраняют семантику MCP.

X-Request-ID не является разрешением на запись и не доказывает пользовательское подтверждение. Внутри границы доверия Python используется общий service token; отдельная криптографическая изоляция генераций этим профилем не заявляется.

## 4. Реестр и область доступа

Матрица фиксирует конкретный вариант для ревью. Совпадение team_id само по себе не дает buddy доступ к любому стажеру.

| Инструмент | intern | buddy | lead |
|------------|--------|-------|------|
| checklist.get_plan | Свой план; intern_id можно опустить или указать свой | Только план явно назначенного стажера своей команды; intern_id обязателен | План стажера своей команды; intern_id обязателен |
| checklist.update_status | Предложение по собственной задаче, где assignee_id равен пользователю | Предложение по задаче, назначенной самому buddy, в плане назначенного стажера своей команды | Предложение по задаче, назначенной самому lead, в плане своей команды |
| employees.get_manager | Свой наставник/руководитель | Свой наставник/руководитель | Свой наставник/руководитель |
| absences.get_policy | Правила своей команды | Правила своей команды | Правила своей команды |
| absences.create_request | Предложение только за себя | Предложение только за себя | Предложение только за себя |
| absences.list_for_employee | Запрещено | Заявки только назначенных стажеров своей команды | Заявки сотрудников своей команды |

Для write-инструментов предложение означает action_proposal, а не изменение через MCP. Прямой вызов через Python отклоняется по разделу 8 даже при допустимой роли.

tools/list содержит 5 определений для intern и 6 для buddy/lead. Это список типов операций, а не обещание существования плана или наставника. Список сортируется по name в ASCII-порядке, возвращается целиком без nextCursor; cursor для tools/list можно только опустить. Иное значение отклоняется как -32602.

При запрете инструмента по роли возвращается POLICY_DENIED. Если конкретный объект отсутствует или недоступен пользователю, возвращается одинаковый NOT_FOUND без раскрытия его существования. Известный инструмент, исключенный из tools/list, при прямом вызове все равно проверяет policy.

Права lead на принудительное изменение чужой задачи не вводятся. Расширение матрицы требует отдельного согласования.

## 5. Данные и JSON Schema

JSON кодируется в UTF-8. Внутренние ID являются ненулевыми UUID в нижнем регистре, как в ai-contract.md. Внешние номера вроде ABS-1042 передаются строкой в external_id. ID разных сущностей не взаимозаменяемы.

Даты имеют вид YYYY-MM-DD и должны существовать в календаре. Временные метки имеют RFC 3339 UTC с Z. null допустим только там, где явно разрешен схемой. Отсутствие обязательного поля не заменяется null, нулем или пустой строкой. Проверка format для UUID, дат и времени обязательна в обоих сервисах; одной регулярной проверки даты недостаточно.

Ниже пакет JSON Schema Draft 2020-12. Все ссылки локальные. Определения входов задают arguments, определения *Output - structuredContent, а не JSON-RPC оболочку. *Data для записи описывают сохраненный результат после confirm и не являются успешным ответом на прямой вызов Python.

Пакет можно вынести без изменения в `specs/mcp/schemas.json`. При публикации отдельной схемы в tools/list нужно включить локальные $defs или развернуть ссылки. Нельзя публиковать неразрешимый #/$defs/..., ссылающийся на другой JSON-документ. У опубликованной схемы указывается $schema.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$defs": {
    "UUID": {
      "type": "string",
      "format": "uuid",
      "pattern": "^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    },
    "Date": {
      "type": "string",
      "format": "date",
      "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
    },
    "Timestamp": {
      "type": "string",
      "format": "date-time",
      "pattern": "Z$"
    },
    "Stage": {
      "type": "string",
      "enum": [
        "week_1",
        "week_2",
        "weeks_3_4"
      ]
    },
    "TaskStatus": {
      "type": "string",
      "enum": [
        "todo",
        "in_progress",
        "blocked",
        "done"
      ]
    },
    "AbsenceStatus": {
      "type": "string",
      "enum": [
        "pending_approval",
        "approved",
        "rejected",
        "cancelled"
      ]
    },
    "EmptyInput": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "ErrorCode": {
      "type": "string",
      "enum": [
        "POLICY_DENIED",
        "NOT_FOUND",
        "CONFIRMATION_REQUIRED",
        "CONFLICT",
        "VERSION_CONFLICT",
        "IDEMPOTENCY_CONFLICT",
        "DEPENDENCY_UNAVAILABLE",
        "TIMEOUT",
        "INTERNAL_ERROR"
      ]
    },
    "Error": {
      "type": "object",
      "properties": {
        "code": {
          "$ref": "#/$defs/ErrorCode"
        },
        "message": {
          "type": "string",
          "minLength": 1
        },
        "retryable": {
          "type": "boolean"
        }
      },
      "required": [
        "code",
        "message",
        "retryable"
      ],
      "additionalProperties": false
    },
    "Failure": {
      "type": "object",
      "properties": {
        "ok": {
          "const": false
        },
        "error": {
          "$ref": "#/$defs/Error"
        }
      },
      "required": [
        "ok",
        "error"
      ],
      "additionalProperties": false
    },
    "GetPlanInput": {
      "type": "object",
      "properties": {
        "intern_id": {
          "$ref": "#/$defs/UUID"
        }
      },
      "required": [],
      "additionalProperties": false
    },
    "Task": {
      "type": "object",
      "properties": {
        "id": {
          "$ref": "#/$defs/UUID"
        },
        "stage": {
          "$ref": "#/$defs/Stage"
        },
        "position": {
          "type": "integer",
          "minimum": 0
        },
        "title": {
          "type": "string",
          "minLength": 1
        },
        "description": {
          "type": "string"
        },
        "status": {
          "$ref": "#/$defs/TaskStatus"
        },
        "due_date": {
          "anyOf": [
            {
              "$ref": "#/$defs/Date"
            },
            {
              "type": "null"
            }
          ]
        },
        "assignee_id": {
          "$ref": "#/$defs/UUID"
        },
        "version": {
          "type": "integer",
          "minimum": 1
        }
      },
      "required": [
        "id",
        "stage",
        "position",
        "title",
        "description",
        "status",
        "due_date",
        "assignee_id",
        "version"
      ],
      "additionalProperties": false
    },
    "NextStep": {
      "type": "object",
      "properties": {
        "task_id": {
          "$ref": "#/$defs/UUID"
        },
        "title": {
          "type": "string",
          "minLength": 1
        },
        "due_date": {
          "anyOf": [
            {
              "$ref": "#/$defs/Date"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "required": [
        "task_id",
        "title",
        "due_date"
      ],
      "additionalProperties": false
    },
    "GetPlanData": {
      "type": "object",
      "properties": {
        "employee_id": {
          "$ref": "#/$defs/UUID"
        },
        "team_id": {
          "$ref": "#/$defs/UUID"
        },
        "stage": {
          "$ref": "#/$defs/Stage"
        },
        "progress": {
          "type": "object",
          "properties": {
            "done": {
              "type": "integer",
              "minimum": 0
            },
            "total": {
              "type": "integer",
              "minimum": 0
            }
          },
          "required": [
            "done",
            "total"
          ],
          "additionalProperties": false
        },
        "tasks": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/Task"
          }
        },
        "next_step": {
          "anyOf": [
            {
              "$ref": "#/$defs/NextStep"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "required": [
        "employee_id",
        "team_id",
        "stage",
        "progress",
        "tasks",
        "next_step"
      ],
      "additionalProperties": false
    },
    "UpdateStatusInput": {
      "type": "object",
      "properties": {
        "task_id": {
          "$ref": "#/$defs/UUID"
        },
        "status": {
          "$ref": "#/$defs/TaskStatus"
        },
        "version": {
          "type": "integer",
          "minimum": 1
        }
      },
      "required": [
        "task_id",
        "status",
        "version"
      ],
      "additionalProperties": false
    },
    "UpdateStatusData": {
      "type": "object",
      "properties": {
        "task_id": {
          "$ref": "#/$defs/UUID"
        },
        "old_status": {
          "$ref": "#/$defs/TaskStatus"
        },
        "status": {
          "$ref": "#/$defs/TaskStatus"
        },
        "version": {
          "type": "integer",
          "minimum": 1
        },
        "updated_at": {
          "$ref": "#/$defs/Timestamp"
        }
      },
      "required": [
        "task_id",
        "old_status",
        "status",
        "version",
        "updated_at"
      ],
      "additionalProperties": false
    },
    "Manager": {
      "type": "object",
      "properties": {
        "id": {
          "$ref": "#/$defs/UUID"
        },
        "name": {
          "type": "string",
          "minLength": 1
        },
        "role": {
          "type": "string",
          "enum": [
            "buddy",
            "lead"
          ]
        }
      },
      "required": [
        "id",
        "name",
        "role"
      ],
      "additionalProperties": false
    },
    "GetManagerData": {
      "type": "object",
      "properties": {
        "manager": {
          "anyOf": [
            {
              "$ref": "#/$defs/Manager"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "required": [
        "manager"
      ],
      "additionalProperties": false
    },
    "AbsenceType": {
      "type": "object",
      "properties": {
        "code": {
          "type": "string",
          "pattern": "^[a-z][a-z0-9_]{0,63}$"
        },
        "label": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "code",
        "label"
      ],
      "additionalProperties": false
    },
    "GetPolicyData": {
      "type": "object",
      "properties": {
        "notice_period_days": {
          "type": "integer",
          "minimum": 0
        },
        "requires_approval": {
          "const": true
        },
        "allowed_types": {
          "type": "array",
          "minItems": 1,
          "items": {
            "$ref": "#/$defs/AbsenceType"
          }
        }
      },
      "required": [
        "notice_period_days",
        "requires_approval",
        "allowed_types"
      ],
      "additionalProperties": false
    },
    "CreateAbsenceInput": {
      "type": "object",
      "properties": {
        "date": {
          "$ref": "#/$defs/Date"
        },
        "type": {
          "type": "string",
          "pattern": "^[a-z][a-z0-9_]{0,63}$"
        }
      },
      "required": [
        "date",
        "type"
      ],
      "additionalProperties": false
    },
    "CreateAbsenceData": {
      "type": "object",
      "properties": {
        "action_id": {
          "$ref": "#/$defs/UUID"
        },
        "external_id": {
          "type": "string",
          "minLength": 1
        },
        "status": {
          "const": "pending_approval"
        },
        "approver": {
          "$ref": "#/$defs/UUID"
        }
      },
      "required": [
        "action_id",
        "external_id",
        "status",
        "approver"
      ],
      "additionalProperties": false
    },
    "ListAbsencesInput": {
      "type": "object",
      "properties": {
        "cursor": {
          "type": "string",
          "minLength": 1
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 100
        }
      },
      "required": [],
      "additionalProperties": false
    },
    "Absence": {
      "type": "object",
      "properties": {
        "external_id": {
          "type": "string",
          "minLength": 1
        },
        "employee_id": {
          "$ref": "#/$defs/UUID"
        },
        "date": {
          "$ref": "#/$defs/Date"
        },
        "type": {
          "type": "string",
          "pattern": "^[a-z][a-z0-9_]{0,63}$"
        },
        "status": {
          "$ref": "#/$defs/AbsenceStatus"
        },
        "approver": {
          "$ref": "#/$defs/UUID"
        }
      },
      "required": [
        "external_id",
        "employee_id",
        "date",
        "type",
        "status",
        "approver"
      ],
      "additionalProperties": false
    },
    "ListAbsencesData": {
      "type": "object",
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/Absence"
          }
        },
        "next_cursor": {
          "anyOf": [
            {
              "type": "string",
              "minLength": 1
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "required": [
        "items",
        "next_cursor"
      ],
      "additionalProperties": false
    },
    "GetPlanSuccess": {
      "type": "object",
      "properties": {
        "ok": {
          "const": true
        },
        "data": {
          "$ref": "#/$defs/GetPlanData"
        }
      },
      "required": [
        "ok",
        "data"
      ],
      "additionalProperties": false
    },
    "GetPlanOutput": {
      "oneOf": [
        {
          "$ref": "#/$defs/GetPlanSuccess"
        },
        {
          "$ref": "#/$defs/Failure"
        }
      ],
      "type": "object"
    },
    "GetManagerSuccess": {
      "type": "object",
      "properties": {
        "ok": {
          "const": true
        },
        "data": {
          "$ref": "#/$defs/GetManagerData"
        }
      },
      "required": [
        "ok",
        "data"
      ],
      "additionalProperties": false
    },
    "GetManagerOutput": {
      "oneOf": [
        {
          "$ref": "#/$defs/GetManagerSuccess"
        },
        {
          "$ref": "#/$defs/Failure"
        }
      ],
      "type": "object"
    },
    "GetPolicySuccess": {
      "type": "object",
      "properties": {
        "ok": {
          "const": true
        },
        "data": {
          "$ref": "#/$defs/GetPolicyData"
        }
      },
      "required": [
        "ok",
        "data"
      ],
      "additionalProperties": false
    },
    "GetPolicyOutput": {
      "oneOf": [
        {
          "$ref": "#/$defs/GetPolicySuccess"
        },
        {
          "$ref": "#/$defs/Failure"
        }
      ],
      "type": "object"
    },
    "ListAbsencesSuccess": {
      "type": "object",
      "properties": {
        "ok": {
          "const": true
        },
        "data": {
          "$ref": "#/$defs/ListAbsencesData"
        }
      },
      "required": [
        "ok",
        "data"
      ],
      "additionalProperties": false
    },
    "ListAbsencesOutput": {
      "oneOf": [
        {
          "$ref": "#/$defs/ListAbsencesSuccess"
        },
        {
          "$ref": "#/$defs/Failure"
        }
      ],
      "type": "object"
    }
  }
}
```

### 5.1. Соответствие схем инструментам

| name | inputSchema | outputSchema | description для модели |
|------|-------------|--------------|------------------------|
| checklist.get_plan | GetPlanInput | GetPlanOutput | Получить разрешенный план онбординга. Для buddy/lead укажи intern_id доступного стажера. |
| checklist.update_status | UpdateStatusInput | Failure | Для изменения статуса сформируй action_proposal с этими аргументами. Прямой вызов не меняет данные и возвращает CONFIRMATION_REQUIRED. |
| employees.get_manager | EmptyInput | GetManagerOutput | Получить своего наставника, а при его отсутствии своего руководителя. |
| absences.get_policy | EmptyInput | GetPolicyOutput | Получить актуальные структурированные правила однодневного отсутствия своей команды. |
| absences.create_request | CreateAbsenceInput | Failure | Для заявки сформируй action_proposal с этими аргументами. Прямой вызов не создает заявку и возвращает CONFIRMATION_REQUIRED. |
| absences.list_for_employee | ListAbsencesInput | ListAbsencesOutput | Получить страницу заявок: назначенные стажеры для buddy, своя команда для lead. |

Каждое определение tools/list обязательно содержит name, указанное description, inputSchema и outputSchema. Title и annotations необязательны и не участвуют в авторизации. Два write-имени сохранены для реестра и action_type; фактическое выполнение после confirm идет внутри Go, без повторного вызова Python MCP Client.

### 5.2. checklist.get_plan

- У intern отсутствие intern_id означает самого пользователя. У buddy/lead отсутствие intern_id является ошибкой аргументов -32602, data.code: INVALID_ARGUMENT.
- Go возвращает весь активный план выбранного стажера, все его этапы и задачи. Если активного плана нет, возвращается NOT_FOUND.
- stage результата - текущий этап плана. Инструмент не вычисляет его через LLM; доменный сервис использует данные плана.
- Задачи сортируются по порядку этапов week_1, week_2, weeks_3_4, затем position, затем id.
- progress.total равен числу всех задач плана, progress.done числу задач done; обязательно `0 <= done <= total`.
- Предлагаемое правило: next_step является первой задачей не в done по указанному порядку, включая blocked. Если все задачи завершены или план пуст, значение null. Правило требует сверки с чек-листом перед согласованием.
- due_date и assignee_id согласованы с именами полей БД. Роль вместо ID исполнителя не передается.

### 5.3. checklist.update_status

Параметры предложения: task_id, целевой status, ожидаемая version из плана. Допустимые статусы: todo, in_progress, blocked, done.

Предлагаемый профиль допускает переход из любого из этих статусов в любой другой при соблюдении прав и версии. Если продукту нужен более узкий граф переходов, его нужно утвердить до реализации.

При confirm Go блокирует/условно обновляет задачу и проверяет version. Несовпадение дает VERSION_CONFLICT без изменения задачи и истории. Если version актуальна и status совпадает, возвращается текущее состояние без увеличения версии и новой истории. Реальный переход увеличивает version на 1; изменение, история и событие task_status_changed сохраняются одной транзакцией.

Повтор успешного confirm возвращает сохраненный результат до повторной проверки старой version. Иначе выполненное действие ошибочно превратится в конфликт версии. updated_at для no-op остается временем последнего изменения.

### 5.4. employees.get_manager

Вход строго `{}`. Получатель определяется по текущему пользователю. Go выбирает назначенного активного buddy той же команды; при его отсутствии активного руководителя из доверенной связи пользователя с руководителем. Для текущей схемы проверяется отображение users.buddy_id и users.manager_id, поле lead_id не предполагается.

При отсутствии обоих возвращается успешный результат manager: null. Выбор относится к текущему пользователю, а не к intern_id ранее прочитанного плана. Произвольный manager_id модель не передает.

### 5.5. absences.get_policy и absences.create_request

В этой поставке заявка относится к одному календарному дню. Диапазоны дат, полдня и изменение созданной заявки не вводятся.

get_policy возвращает ограничения из конфигурации доменного сервиса своей команды. allowed_types[].code уникальны; модель использует код, например day_off, а не отображаемый текст. notice_period_days является неотрицательным числом календарных дней. В профиле requires_approval всегда true: UI-confirm подтверждает отправку, а не заменяет согласование руководителя.

Правило предлагаемого профиля: `date >= локальная_сегодня + notice_period_days`. Go вычисляет локальную дату на момент предложения и заново на момент confirm по доверенному часовому поясу пользователя/приложения. Относительную дату агент вычисляет по timestamp и timezone из POST /chat; при неоднозначности уточняет ее. Дополнительный запрет выходных не предполагается. Недопустимый тип/срок дает CONFLICT с безопасным пояснением.

Конкретные коды типов и число дней не зашиты в контракт. Для синтетического интеграционного fixture предлагаются day_off и notice_period_days: 3; это тестовые настройки, а не кадровая политика. Неопределенная политика дает DEPENDENCY_UNAVAILABLE, а не выдуманные ограничения. max_consecutive_days не возвращается: многодневных заявок в профиле нет.

Go выбирает согласующего по правилу buddy, затем руководитель, как в 5.4, исключая самого заявителя. Если согласующего нет, создание дает CONFLICT. Его UUID сохраняется Go в проверенных параметрах предложения и показывается в карточке. Перед исполнением Go проверяет актуальность назначения; изменение согласующего или других показываемых параметров требует нового предложения и подтверждения, а не молчаливой подмены карточки.

Успех интеграции возвращает CreateAbsenceData: action_id предложения, external_id заявки, status: pending_approval и UUID согласующего. action_id нельзя заменять внешним номером заявки.

Источник заявок реализуется отдельным доменным адаптером/моком. HR-интеграция, новая таблица отсутствий и миграции этим документом не считаются существующими. Мок обязан сохранять результат по ключу идемпотентности, в том числе для восстановления после перезапуска.

### 5.6. absences.list_for_employee

Вход не принимает employee_id. По умолчанию limit = 50; разрешен диапазон 1-100. Cursor можно опустить, но нельзя передать null или пустую строку. Это предложение расширяет пустой вход исходного draft только пагинацией.

Сортировка: date DESC, затем external_id ASC. Внешний ID уникален в пределах адаптера. next_cursor: null означает конец. Пустая разрешенная выборка возвращает items: [], next_cursor: null. employee_id в каждой записи нужен для отличения заявок нескольких стажеров.

Cursor непрозрачен для Python, защищен от подмены и связан с пользователем, областью выборки и limit. Некорректный cursor или использование с другим limit дает -32602, data.code: INVALID_ARGUMENT. На каждой странице Go заново вычисляет текущие права и применяет фильтр; cursor не дает доступ к прежней области. Чтение страниц не обещает snapshot при одновременном изменении заявок.

### 5.7. Синтетические примеры для проверки схем

Ниже тестовые значения по именам схем. Это не дополнительные поля MCP и не отдельная wire-оболочка. Входы EmptyInput, GetPlanInput и ListAbsencesInput также допускают `{}` с учетом ролевых правил раздела 4. Для двух записей приведен итог после confirm, а не результат прямого tools/call.

```json
{
  "GetPlanInput": {},
  "GetPlanData": {
    "employee_id": "a24a3478-cf42-51b1-b05b-9833260247a5",
    "team_id": "4496e76d-35da-5cf7-a3d5-c9a89d88c5a2",
    "stage": "week_1",
    "progress": {"done": 0, "total": 1},
    "tasks": [{
      "id": "40000000-0000-0000-0000-000000000001",
      "stage": "week_1", "position": 0,
      "title": "Настроить окружение", "description": "Подготовить локальную среду",
      "status": "todo", "due_date": "2026-11-20",
      "assignee_id": "a24a3478-cf42-51b1-b05b-9833260247a5", "version": 1
    }],
    "next_step": {
      "task_id": "40000000-0000-0000-0000-000000000001",
      "title": "Настроить окружение", "due_date": "2026-11-20"
    }
  },
  "UpdateStatusInput": {
    "task_id": "40000000-0000-0000-0000-000000000001",
    "status": "done", "version": 1
  },
  "UpdateStatusData": {
    "task_id": "40000000-0000-0000-0000-000000000001",
    "old_status": "todo", "status": "done", "version": 2,
    "updated_at": "2026-11-11T12:30:00Z"
  },
  "EmptyInput": {},
  "GetManagerData": {
    "manager": {"id": "4a59a828-3b1a-55e4-bf9b-81db5ad6183a", "name": "Илья", "role": "buddy"}
  },
  "GetPolicyData": {
    "notice_period_days": 3, "requires_approval": true,
    "allowed_types": [{"code": "day_off", "label": "Отгул"}]
  },
  "CreateAbsenceInput": {"date": "2026-11-20", "type": "day_off"},
  "CreateAbsenceData": {
    "action_id": "50000000-0000-0000-0000-000000000001",
    "external_id": "ABS-1042", "status": "pending_approval",
    "approver": "4a59a828-3b1a-55e4-bf9b-81db5ad6183a"
  },
  "ListAbsencesInput": {"limit": 50},
  "ListAbsencesData": {
    "items": [{
      "external_id": "ABS-1042", "employee_id": "a24a3478-cf42-51b1-b05b-9833260247a5",
      "date": "2026-11-20", "type": "day_off", "status": "pending_approval",
      "approver": "4a59a828-3b1a-55e4-bf9b-81db5ad6183a"
    }],
    "next_cursor": null
  }
}
```

## 6. Формат вызова и ответа

id JSON-RPC идентифицирует один RPC-вызов. X-Request-ID идентифицирует генерацию; внутри одной генерации RPC-id различаются. Ни один из них не является ключом идемпотентности действия.

Пример запроса:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "employees.get_manager",
    "arguments": {}
  }
}
```

Успешный ответ HTTP 200:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      {"type": "text", "text": "{\"ok\":true,\"data\":{\"manager\":null}}"}
    ],
    "structuredContent": {"ok": true, "data": {"manager": null}},
    "isError": false
  }
}
```

content содержит ровно один текстовый блок с JSON-сериализацией того же объекта, что в structuredContent. Python читает structuredContent, валидирует по outputSchema и проверяет согласованность isError с ok. Отсутствие структуры или несоответствие схеме является ошибкой интеграции; недостающие поля не достраиваются LLM.

Отказ инструмента HTTP 200:

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "result": {
    "content": [
      {"type": "text", "text": "{\"ok\":false,\"error\":{\"code\":\"POLICY_DENIED\",\"message\":\"Нет доступа к инструменту\",\"retryable\":false}}"}
    ],
    "structuredContent": {
      "ok": false,
      "error": {"code": "POLICY_DENIED", "message": "Нет доступа к инструменту", "retryable": false}
    },
    "isError": true
  }
}
```

isError: true обозначает отказ конкретного инструмента. Это не требует автоматически завершать генерацию техническим событием SSE error: ожидаемый отказ агент может объяснить и закончить через done.

## 7. Ошибки и повторы

### 7.1. JSON-RPC ошибки

| JSON-RPC code | Смысл | error.data.code |
|---------------|-------|-----------------|
| -32700 | Невалидный JSON | PARSE_ERROR |
| -32600 | Неверная оболочка JSON-RPC | INVALID_REQUEST |
| -32601 | Неизвестный MCP-метод | METHOD_NOT_FOUND |
| -32602 | Неизвестное имя инструмента | UNKNOWN_TOOL |
| -32602 | Аргументы не соответствуют inputSchema или контекстным ограничениям входа | INVALID_ARGUMENT |

Для невалидного JSON/оболочки ответ HTTP 400 с JSON-RPC error, id: null, если id нельзя надежно определить. Для валидного запроса с неизвестным методом/инструментом или неверными params ответ HTTP 200 с JSON-RPC error и исходным id. result и верхнеуровневый error одновременно не присутствуют. Уведомления не получают JSON-RPC-ответа.

Пример ошибки аргументов:

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "error": {
    "code": -32602,
    "message": "Некорректные аргументы инструмента",
    "data": {"code": "INVALID_ARGUMENT"}
  }
}
```

### 7.2. Ошибки выполнения инструмента

Все строки возвращаются через CallToolResult, isError: true, structuredContent.ok: false и HTTP 200.

| code | retryable | Значение |
|------|-----------|----------|
| POLICY_DENIED | false | Роль/операция запрещена. |
| NOT_FOUND | false | Объект не найден или недоступен. |
| CONFIRMATION_REQUIRED | false | Python попытался выполнить write напрямую; требуется action_proposal и UI-confirm. |
| CONFLICT | false | Нарушено бизнес-условие или изменились параметры предложения. |
| VERSION_CONFLICT | false | Задача изменилась; нужен новый снимок и новое предложение. |
| IDEMPOTENCY_CONFLICT | false | Ключ использован с другими параметрами. |
| DEPENDENCY_UNAVAILABLE | true | Временная недоступность зависимости. |
| TIMEOUT | true | Истек лимит выполнения. |
| INTERNAL_ERROR | false | Непредвиденная ошибка, без автоматического повтора. |

Для двух write-инструментов прямой вызов Python после валидации аргументов и проверки доступа возвращает CONFIRMATION_REQUIRED. Запись в каталоге не создает обхода подтверждения.

Таймаут MCP-вызова - не более 10 секунд и не больше остатка дедлайна генерации. При сетевом сбое, HTTP 503, DEPENDENCY_UNAVAILABLE или TIMEOUT Python может один раз повторить чтение через 200 мс, если хватает дедлайна. Используется новый RPC-id и прежний X-Request-ID. Переподключение MCP не продлевает генерацию.

Ошибки схемы/имени можно исправить и выполнить новый вызов; это не автоматический сетевой retry. Записи Python автоматически не повторяет. Confirm и восстановление исполнения управляются Go по устойчивому ключу.

Если после ошибки инструмента ответ невозможно корректно завершить, Python публикует error с кодом TOOL_FAILED по ai-contract.md. Секреты, внутренние адреса, stack trace и сведения о чужих объектах не попадают в message.

## 8. Предложения, подтверждение и выполнение записи

### 8.1. Единственный путь записи из агента

```text
Python -> action_proposal в Redis
Go -> проверка и сохранение actions_log -> карточка в SSE
Пользователь -> POST /actions/{action_id}/confirm в Go
Go -> повторная проверка -> доменный исполнитель -> сохраненный результат
```

Для checklist.update_status и absences.create_request обычный Python MCP Client НИКОГДА не выполняет запись напрямую. Его tools/call не создает ни эффект, ни предложение автоматически. Python публикует action_proposal через существующий канал событий. Это явное решение предлагаемого профиля для согласования: два write-инструмента доступны как описания операций, а не автономные команды LLM.

Если команда хочет выполнение подтвержденной записи отдельным MCP-клиентом Go, потребуется дополнительный контракт доверенного execution-контекста и credentials. Он не подразумевается и не разрешается пользовательским confirmed: true в arguments.

### 8.2. Формат предложения

Для отсутствия:

```json
{
  "event": "action_proposal",
  "request_id": "20000000-0000-0000-0000-000000000001",
  "seq": 3,
  "data": {
    "action_type": "absences.create_request",
    "details": {"date": "2026-11-20", "type": "day_off"}
  }
}
```

Для статуса задачи data имеет вид:

```json
{
  "action_type": "checklist.update_status",
  "details": {
    "task_id": "40000000-0000-0000-0000-000000000001",
    "status": "done",
    "version": 1
  }
}
```

details Python валидируется строго по соответствующей inputSchema. Переданные моделью action_id, approver, user_id, idempotency_key и флаг подтверждения не принимаются. Go сам формирует авторитетные поля. Обогащенные details карточки в SSE не следует повторно валидировать как исходные arguments модели.

Go сохраняет предложение идемпотентно по `(request_id, seq)`, создает action_id и отдельный случайный UUID idempotency_key, дополняет карточку и лишь после сохранения передает ее в SSE. Точный дубликат события не создает вторую карточку; противоречащий дубликат обрабатывается как INVALID_AI_EVENT по основному контракту.

### 8.3. Confirm и идемпотентность

- Confirm принимает пользовательскую авторизацию и action_id в пути. Тело с новыми параметрами или request_id не принимается.
- Go проверяет владельца действия, актуальные права, сохраненные параметры и состояние действия.
- Связь с исходным request_id хранится в Go. Новая генерация, завершение старой, переподключение SSE и перезагрузка страницы не меняют ключ и не запрещают подтверждение сохраненной карточки.
- Действие в proposed не выполняется без UI-confirm. Параметры неизменяемы после показа; исправления требуют нового предложения.
- Параллельные confirm одного action_id не запускают два исполнения. Используется атомарный захват/условный переход состояния.
- Для confirmed/executing внешний API возвращает HTTP 202 с текущим Action. Для succeeded HTTP 200 с сохраненным Action.result. Для failed разрешенная повторная попытка использует тот же ключ; для cancelled возвращается 409 ACTION_NOT_CONFIRMABLE. Полная оболочка Action остается в docs/openapi.yaml.
- Action.status = succeeded означает выполнение инструмента; result.status = pending_approval означает, что руководитель еще не согласовал отсутствие.
- Результаты: UpdateStatusData или CreateAbsenceData из пакета схем. Они записываются в Action.result без оболочки ok/data.
- Разные action_id являются разными предложениями. Контракт не обещает дедупликацию двух разных карточек с похожим содержимым.

Ключ не равен строке `{action_id}:{request_id}`: в docs/db.md поле actions_log.idempotency_key уже имеет тип UUID. Ключ создается Go один раз при сохранении предложения и используется во всех попытках.

Доменный исполнитель связывает ключ с типом действия и каноническими валидированными параметрами, включая доверенного actor и согласующего. Тот же ключ с теми же параметрами возвращает прежний результат/состояние. Тот же ключ с другими параметрами дает IDEMPOTENCY_CONFLICT без эффекта. Порядок ключей JSON не влияет на сравнение.

Изменение задачи и результат action сохраняются транзакционно. Для внешнего адаптера отсутствие ответа не означает отсутствие эффекта: после сбоя между эффектом и записью результата действие остается executing до сверки по тому же ключу. Нельзя объявлять failed и заново создавать заявку с новым ключом. Один уникальный индекс Go не обеспечивает однократность внешнего эффекта; мок/интеграция также обязаны поддерживать этот ключ.

## 9. Redis, SSE и аудит

tool_call является уведомлением о ходе работы. Оно не запускает MCP, не разрешает запись и не доказывает успех.

Для чтения Python при необходимости публикует tool_call, вызывает MCP, валидирует результат и продолжает ответ. Для записи публикуется action_proposal; текст сообщает о подготовленном предложении, а не о созданной заявке. Результат confirm приходит через внешний API Go и историю действий; Python не публикует задним числом события завершенной генерации.

Нумерация seq, сохранение карточек, единственное финальное событие и обработка Redis сохраняются из ai-contract.md. Штатный отказ по правам может завершаться объяснением и done, незавершаемый технический сбой - TOOL_FAILED.

Go фиксирует policy_denied для отказов авторизации, в том числе при маскировании недоступного объекта под NOT_FOUND. В audit доступны request_id, actor, tool_name и безопасная причина; в технических логах нет токенов, истории диалога, сырых аргументов, результатов и строк подключения. Счетчики действий не увеличиваются на повторе учтенного события/эффекта.

## 10. Приемочные проверки

Это обязательная будущая верификация реализации. Наличие таблицы не означает, что проверки уже выполнены.

| Проверка | Ожидаемый результат |
|----------|---------------------|
| initialize, initialized, tools/list, tools/call | Работают на зафиксированных SDK и MCP 2025-06-18; протокол не подменен REST. |
| Нет/неверен service token | 401 до проверки существования request_id; секрет не попадает в лог. |
| Нет/невалиден/неизвестен/закрыт request_id | Соответственно 400/400/404/410; инструменты не выполняются. |
| Параллельные генерации разных пользователей | Клиенты не смешивают X-Request-ID, роли и результаты. |
| tools/list | Intern получает 5 имен, buddy/lead 6; схемы самодостаточны, все $ref разрешаются. |
| Входы и выходы | Проверяются JSON Schema; лишние поля, null, плохие даты/UUID отклоняются. |
| Неизвестное имя/метод | Однозначные JSON-RPC коды и data.code из раздела 7. |
| Запрещенный известный инструмент | POLICY_DENIED независимо от tools/list. |
| get_plan | Свой/назначенный/командный план доступен в нужных границах; чужой и отсутствующий дают одинаковый NOT_FOUND. |
| Пустой/завершенный план | Корректный прогресс, next_step null, нет выдуманной задачи. |
| get_manager | Buddy, fallback на руководителя, manager null при отсутствии. |
| list_for_employee | Intern запрещен; buddy не видит неназначенного стажера даже той же команды; lead не видит другую команду. |
| Пагинация | Стабильный порядок неизменных данных; cursor не расширяет область; employee_id присутствует. |
| Прямой tools/call write | CONFIRMATION_REQUIRED; нет записи, истории, HR-заявки или автоматически созданной карточки. |
| action_proposal | Одна сохраненная карточка на request_id/seq; до UI-confirm нет эффекта. |
| update_status после confirm | Проверка assignee и области, version, транзакционная история; no-op без новой истории. |
| Устаревшая version | VERSION_CONFLICT, задача не изменена, нужно новое предложение. |
| create_request после confirm | Проверены актуальные сроки/тип/согласующий; action_id, external_id, pending_approval. |
| Согласующий изменился после показа | CONFLICT, нужен новый показ и confirm; скрытой смены адресата нет. |
| Повторный и параллельный confirm | Один эффект и прежний результат/текущее состояние. |
| Confirm после генерации/перезагрузки | Допустим владельцу сохраненного действия; прежний UUID ключа. |
| Один ключ, разные параметры | IDEMPOTENCY_CONFLICT, второго эффекта нет. |
| Падение после эффекта до записи результата | Восстановление с тем же ключом без дубля, включая перезапуск мока. |
| Таймаут/сбой зависимости | Чтение повторяется не более одного раза в общем дедлайне; успех не выдумывается. |
| Аудит и события | policy_denied сохранен; штатный отказ можно закончить done; технический сбой отображается корректно. |

Сценарии на моковой LLM: обычный вопрос с чтением; отгул с карточкой и confirm; статус задачи с карточкой и confirm; попытка чужих данных; вопрос без ответа. MCP Inspector использует тестовый service token и request_id реальной активной синтетической генерации; отдельного обхода policy для Inspector нет.

## 11. Готовность контракта и реализации

Контракт готов к работе, когда владельцы Go, Python и продукта согласовали раздел 12, связанные документы обновлены в одной поставке и есть фиксированная пара SDK. Согласование текста не означает готовность интеграции.

Реализация готова, когда приемочные проверки выполнены, команды/результаты воспроизводимы, секреты отсутствуют в Git и логах, README отражает фактическое состояние. Push, merge и статус готовности не следуют из появления файла.

## 12. Что согласовать перед переносом в репозиторий

Это конкретные решения данной редакции. До согласования их нельзя объявлять принятыми.

1. **Транспортный профиль:** MCP 2025-06-18, stateless Streamable HTTP, клиент на генерацию, X-Request-ID на всех запросах, HTTP-коды и лимит 10 секунд. Проверить и записать реальные версии SDK.
2. **Записи через предложения:** сохранить шесть имен, запретить прямой write Python; исполнение после confirm через Go. Два write-дескриптора являются охраняемыми операциями. Для иного профиля сначала спроектировать доверенную передачу подтверждения.
3. **Подтверждение статуса задачи:** добавить checklist.update_status в allowlist предложений и ActionType в OpenAPI, схему карточки и UI. Сейчас ActionType перечисляет только absences.create_request и escalation.create. Это согласованное расширение, а не существующая возможность. Прямой пользовательский PATCH задачи остается отдельным HTTP-сценарием; документ регулирует агентный путь.
4. **Права и выбор плана:** принять раздел 4 и optional intern_id для get_plan с обязательностью у buddy/lead. Это расширяет исходный вход {}, сохраняя сценарии наставника и руководителя из MVP. Подтвердить ограничение изменения задач собственным assignee и граф переходов.
5. **Доменные формы:** due_date, assignee_id, task.version, next_step, nullable manager, выбор согласующего через buddy_id/manager_id, однодневное отсутствие, календарный срок, статусы мока и пагинация заявок. Это предложения, а не кадровые правила организации.
6. **Совместимость:** обновить пример action_proposal в ai-contract.md с типа отгул на код day_off, синхронизировать Action.result с CreateAbsenceData (external_id вместо неоднозначного id) и UpdateStatusData. Сохранить UUID idempotency_key из db.md и confirm независимо от активной генерации.
7. **Пакет схем:** после согласования поместить документ в docs/mcp.md, вынести пакет раздела 5 в specs/mcp/schemas.json как один источник формальных схем для Go, Python и проверок. Не поддерживать две расходящиеся копии. Добавить ссылку в README; подготовить синтетический адаптер отсутствий с устойчивой идемпотентностью.
8. **Границы поставки:** шесть Go-инструментов являются этапом работы; knowledge.search и escalation.create сохраняются в общем MVP и получают контракты отдельно.

## 13. Источники протокола

Выбранная версия MCP, а не сочетание разных редакций:

- [Базовый протокол и JSON-RPC](https://modelcontextprotocol.io/specification/2025-06-18/basic).
- [Жизненный цикл и согласование версии](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle).
- [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports).
- [Инструменты и схемы](https://modelcontextprotocol.io/specification/2025-06-18/server/tools).

Внешняя спецификация задает оболочку MCP. Права, доменные схемы, подтверждение, идемпотентность и прикладные ошибки определяются проектом.
