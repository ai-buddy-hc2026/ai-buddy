# AI-buddy

Помощник стажёра Авито в онбординге. Проект для Hack&Change 2026: план адаптации, ответы с источниками, подтверждаемые действия и помощь наставника.

## Текущее состояние

Прототип пока не завершён. Таблица отражает реализацию в этой ветке; открытый PR не означает наличие изменений в main.

| Часть | Что уже есть | Что ещё предстоит |
|-------|--------------|-------------------|
| Go backend | Конфигурация, JSON-логи, /health, мок-вход/JWT, защищённый /me и пользователи PostgreSQL | Права инструментов, онбординг, чат, MCP |
| Инфраструктура | Compose для backend, PostgreSQL с pgvector и Redis; тома и healthcheck БД/Redis | Подключение остальных приложений |
| Frontend | Папка под интерфейс; каркас в [PR #57](https://github.com/ai-buddy-hc2026/ai-buddy/pull/57) | Слияние и интеграция с API |
| AI-service и CI | Добавлены MCP-клиент, tool-calling, логирование, тестовая Compose-конфигурация и Python unit/integration тесты; MCP-контракт остаётся черновиком | Сквозные MCP-тесты требуют Go API по контракту; Playwright S-3/S-SEC не входят в эту реализацию |
| База данных | Миграции пользователей, планов, задач и истории статусов; повторяемый seed: 2 команды, 6 пользователей, 2 плана, 30 задач | Таблицы чата, действий и KB; загрузка связей задач с реальными документами |

`/health` проверяет HTTP-сервер. Он не подтверждает наличие прикладных сценариев или подключение Go к PostgreSQL и Redis.

## Документация

| Вопрос | Где читать |
|--------|------------|
| Требования организаторов | [Выжимка кейса](docs/requirements/case.md) |
| Выбранный объём и критерии готовности | [MVP и сценарии](docs/mvp.md) |
| Внешний HTTP API Go, схемы и SSE | [Черновик OpenAPI](docs/openapi.yaml), требует ревью frontend и AI-service |
| Новая задача в отдельном чате, Git и передача результата | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Запуск и проверки Go API | [backend/README.md](backend/README.md) |
| Выбор контекста агентом | [AGENTS.md](AGENTS.md); вход Claude Code через [CLAUDE.md](CLAUDE.md) |
| Контракт Go/Python | [docs/ai-contract.md](docs/ai-contract.md), статус 1.2-draft |
| Контракт Go/Python MCP | [Черновик MCP-контракта](docs/mcp-contract.md), статус 1.1-draft, не согласован |
| Схема БД и подробные правила дедлайнов | [docs/db.md](docs/db.md) |

После слияния соответствующего PR заменяйте ссылку на PR ссылкой на файл. Статус «черновик» снимается после согласования, а не после появления документа в репозитории.

## Структура

| Папка | Назначение |
|-------|------------|
| backend/ | Go API, в дальнейшем авторизация, policy-слой и MCP |
| ai-service/ | Python-сервис для агента, LLM и RAG |
| frontend/ | Интерфейс React + TypeScript |
| specs/ | Спецификации поведения агента и инструментов |
| seed/ | Синтетические данные и база знаний |
| docs/ | Требования, контракты, схема БД и документация проверок |
| tests/eval/ | Вопросы для проверки ответов и атаки на права |

## Быстрый запуск того, что работает

Нужны Docker Engine с Linux-контейнерами и Docker Compose с поддержкой `--wait`. Убедитесь, что `docker version` выводит Client и Server без ошибки.

Из корня репозитория, PowerShell:

```powershell
Copy-Item .env.example .env
docker compose config --quiet
docker compose up --build -d --wait backend
curl.exe -i http://localhost:8080/health
```

При существующем `.env` повторно копировать пример не нужно. В Bash используйте `cp .env.example .env` и `curl` вместо `Copy-Item` и `curl.exe`.

Ожидается HTTP 200 с `{"status":"ok"}`. Compose поднимет PostgreSQL и Redis и запустит backend после успешных healthcheck зависимостей. Frontend этой командой не запускается; полный `docker compose up --build` требует его Dockerfile и кода.

Проверка инфраструктуры:

```bash
docker compose ps
docker compose exec postgres psql -U ai_buddy -d ai_buddy -c "SELECT extversion FROM pg_extension WHERE extname = 'vector';"
docker compose exec redis redis-cli ping
docker compose logs --tail 50 backend
```

При изменённых POSTGRES_USER или POSTGRES_DB подставьте их в команду psql. Ожидаются версия vector и ответ PONG.

## Настройки и данные

```bash
docker compose up --build -d
docker compose ps
docker compose logs -f backend frontend ai-service
```

Контракт для будущих Dockerfile и конфигурации приложений:

| Сервис | Настройки |
|--------|-----------|
| `backend` | Слушает `0.0.0.0:8080` (`HOST`, `PORT`), читает `DATABASE_URL` и `REDIS_URL`. Запускается после успешных healthcheck PostgreSQL и Redis. |
| `frontend` | Слушает `0.0.0.0:5173`. Dockerfile принимает `ARG VITE_API_BASE_URL` и передаёт его Vite до сборки. Клиент использует `import.meta.env.VITE_API_BASE_URL`. |
| `postgres` | Внутри сети доступен как `postgres:5432`. Расширение `vector` создаётся при первой инициализации БД. |
| `redis` | Внутри сети доступен как `redis:6379`, включено сохранение AOF. |
| `ai-service` | Слушает `0.0.0.0:8000`. Логи сохраняются в `logs/ai-service/ai-service.log` и выводятся в консоль контейнера. |

По умолчанию интерфейс будет доступен по `http://localhost:5173`, API -
`http://localhost:8080` (проверка каркаса: `GET /health`). Для запросов из браузера
backend должен разрешать CORS с адреса frontend. Адреса `backend`, `postgres` и `redis`
используются только внутри Docker-сети. При изменении `BACKEND_PORT` обновить
`VITE_API_BASE_URL` и пересобрать frontend. Особые символы в логине/пароле БД требуют
URL-кодирования в переопределённом `DATABASE_URL`.

- Настройки локального запуска: [.env.example](.env.example). POSTGRES_PASSWORD - тестовый пароль PostgreSQL. Мок-вход без пароля использует логины из [docs/users.md](docs/users.md). Для старого .env добавьте JWT_SIGNING_KEY и JWT_TTL по примеру; опубликованный ключ только для локального демо. Опубликованные порты привязаны к 127.0.0.1.
- Адреса postgres:5432 и redis:6379 используются внутри Docker-сети. API на хосте по умолчанию доступен по http://localhost:8080.
- При изменении BACKEND_PORT обновляется VITE_API_BASE_URL для будущего frontend: Vite использует его при сборке. Frontend явно обращается к API; backend должен разрешить соответствующий CORS origin при интеграции.
- Для специальных символов в реквизитах PostgreSQL переопределите DATABASE_URL с URL-кодированием.
- PostgreSQL и Redis используют именованные тома. Изменение POSTGRES_* в .env не меняет уже созданную базу и пользователей.
- SQL из docker/postgres/init/ выполняется при первой инициализации и включает vector. Отдельный сервис db-init применяет миграции пользователей и чек-листов, загружает SQL seed и seed/checklist.json перед backend, в том числе на существующем томе. Связи с документами KB пока остаются в JSON. Инструкции: [backend/README.md](backend/README.md#подготовка-бд-и-пользователи).

Остановка с сохранением данных:

```bash
docker compose down
```

## Проверки и работа над проектом

Команды тестов, покрытия и линтера Go: [backend/README.md](backend/README.md#проверки). Версия Go зафиксирована в backend/go.mod, настройки линтера в backend/.golangci.yml.

Проверки выбираются по изменению: [CONTRIBUTING.md](CONTRIBUTING.md#проверки-по-типу-изменения). Для документации проверяются ссылки, согласованность и формат; для Compose конфигурация и затронутые сервисы.

## Интеграционные тесты AI-сервиса в Docker Compose

Тестовая инфраструктура запускается отдельно от основной:

```powershell
docker compose -f docker-compose.test.yml up --build --detach --wait --wait-timeout 900
docker compose -f docker-compose.test.yml exec ai-service pytest tests/integration
docker compose -f docker-compose.test.yml down --volumes --remove-orphans
```

MCP-сквозной тест можно запустить отдельно:

```powershell
docker compose -f docker-compose.test.yml up --build --detach --wait --wait-timeout 900
docker compose -f docker-compose.test.yml exec ai-service pytest tests/integration/test_mcp_e2e.py -q
docker compose -f docker-compose.test.yml down --volumes --remove-orphans
```

Тест получает JWT через mock-login, отправляет сообщение в Go API, поднимает
внутри AI-service временный HTTP-сервер с детерминированным LLM и проходит весь
цикл Go API -> Python -> настоящий MCP клиент -> Go MCP -> Python -> Go SSE.
Внешняя LLM для этого теста не вызывается. Go должен направлять внутренние
запросы на `http://ai-service:8000` и использовать тестовые токены из Compose.
Сценарий отгула проверяет action_proposal, статус proposed, пустой result,
нулевое число попыток исполнения и отсутствие заявки при чтении списка до confirm.

Для полного набора AI-service замените команду pytest на `pytest tests/unit tests/integration`.
AI-service в тестовом Compose остаётся в режиме ожидания, чтобы команды pytest можно
было запускать через `docker compose exec`. Фикстуры используют запущенные Redis,
PostgreSQL и Ollama вместо создания дополнительных Testcontainers. Ollama загружает
модель `llama3.2:1b` при первом запуске; её данные хранятся в отдельном volume.

Отдельный CI workflow выполняет `tests/integration` этим же Compose-файлом.
MCP-сквозной тест ожидает, что Go предоставляет описанные в контракте
`/auth/mock-login`, `/chat/messages`, `/chat/stream/{request_id}` и `/mcp`.
Добавление теста само по себе не подтверждает наличие этих маршрутов в Go backend.

Тестовые учётные записи, настройки LLM, миграции, SDD, сквозные тесты, видео и презентация добавляются вместе с соответствующей реализацией. До этого README не заявляет их готовность.
