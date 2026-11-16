# AI-service

Python принимает запросы от Go, вызывает модель и MCP-инструменты Go,
публикует события ответа через Redis. Go проверяет доступ, сохраняет историю
и выполняет действия после подтверждения в UI.

## Запуск с OpenAI

При первом запуске создайте корневой `.env` по `.env.example`. В существующем
файле замените только параметры модели, сохранив остальные настройки:

```dotenv
LLM_PROVIDER=openai
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
LLM_API_KEY=ваш_ключ
VITE_API_BASE_URL=/api
```

Для связи сервисов нужны `AI_SERVICE_TOKEN` и отдельный `MCP_SERVICE_TOKEN`
длиной не менее 32 символов. Внутренние URL: `MCP_SERVER_URL=http://backend:8080/mcp`
и `AI_SERVICE_URL=http://ai-service:8000`. Эти настройки уже есть в `.env.example`.
Ключ и служебные токены хранятся только в локальном `.env`.

Из корня репозитория:

```bash
docker compose up --build -d frontend backend ai-service
```

Интерфейс: `http://localhost:5173`. Запросы браузера идут через `/api`,
который nginx проксирует в Go. Изменение `.env` требует пересоздания контейнера
соответствующего сервиса; обычный `docker compose restart` не обновляет env.

## Ошибки модели

При HTTP-ошибке провайдера AI-service пишет безопасную диагностику:
`operation`, `error_type`, `status`, `code`, `param`, `provider_request_id`.
Для сетевых сбоев и таймаутов часть полей может быть `None`. Полный текст
ошибки, тело запроса и заголовок авторизации не логируются. Идентификаторы
ограничены допустимыми символами и длиной.

```bash
docker compose logs --since 5m ai-service backend
```

Сообщение UI «Ассистент временно недоступен» может означать отказ провайдера.
Например, `status=400` с `param=tools[0].function.name` указывает на ошибку
формата функции. В текущем адаптере имена MCP с точками преобразуются перед
передачей модели и восстанавливаются перед вызовом Go. Правила передачи
имён и событий: [контракт Go/Python](../docs/ai-contract.md#52-tool_call).

## Проверки

Модульные и контрактные тесты используют синтетический LLM и настоящий Redis
из Testcontainers. Из каталога `ai-service` с установленными
`requirements/test.txt` и доступным Docker:

```bash
pytest tests/agent tests/contract tests/rag tests/unit --cov=api --cov=app --cov=config --cov=core --cov=integrations --cov=schemas --cov=main --cov-fail-under=80
```

Транспортные тесты проверяют сериализованный HTTP-запрос к модели, допустимые
имена функций, потоковые фрагменты, историю вызовов и безопасную диагностику.
Тестовый HTTP-провайдер также отклоняет имена с точками, чтобы сквозные
проверки обнаруживали такие ошибки до подключения OpenAI.

Интеграционные тесты с Go и Ollama запускаются из корня:

```bash
docker compose -f docker-compose.test.yml up --build -d --wait
docker compose -f docker-compose.test.yml exec -T ai-service pytest tests/integration
docker compose -f docker-compose.test.yml down
```

Проверки интерфейса через Go и тестовый HTTP-провайдер описаны в
[frontend/README.md](../frontend/README.md#проверки).
