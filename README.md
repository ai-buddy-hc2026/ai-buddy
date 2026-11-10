# AI-buddy

Помощник стажёра Авито в онбординге. Проект для Hack&Change 2026.

## Структура

| Папка | Что внутри |
|-------|------------|
| `backend/` | API на Go, роли и права, MCP-сервисы |
| `ai-service/` | AI-сервис на Python: агент, стриминг, LLM |
| `frontend/` | Интерфейс стажёра и наставника (React + TS) |
| `specs/` | SDD-спецификации: агент, инструменты, сценарии |
| `seed/` | Тестовые данные и база знаний |
| `docs/` | Документы: OpenAPI, схема БД, метрики, качество |
| `tests/eval/` | Тестовые вопросы и атаки на права |

## Как работаем

1. `main` защищён. Прямой push в `main` запрещён, только через PR.
2. Каждая задача - issue на доске. Берёшь задачу - ставишь себя в Assignees и двигаешь карточку в `In progress`.
3. Ветка на задачу: `feat/...`, `fix/...`, `docs/...`, `test/...`, `chore/...`.
4. Коммиты в формате `тип: описание`, например `feat: GET /health`.
5. В описании PR пишем `Closes #номер`. Ревью делает любой другой участник.
6. Координация только текстом: общий чат команды и GitHub.

```bash
git clone https://github.com/ai-buddy-hc2026/ai-buddy.git
cd ai-buddy
git checkout -b feat/my-task
# работа
git push -u origin feat/my-task
# открыть PR на GitHub
```

## Запуск

Нужны Docker Engine (или Docker Desktop с Linux-контейнерами) и Docker Compose v2.
Окружение предназначено для локальной разработки; порты доступны только на `127.0.0.1`,
пароль БД в примере тестовый.

Скопировать настройки (PowerShell):

```powershell
Copy-Item .env.example .env
docker compose config --quiet
```

В Bash вместо `Copy-Item` использовать `cp .env.example .env`.

В репозитории есть [каркас Go API](backend/README.md). PostgreSQL 16 с pgvector и Redis 7
можно запустить отдельно:

```bash
docker compose up -d --wait postgres redis
docker compose ps
docker compose exec postgres psql -U ai_buddy -d ai_buddy -c "SELECT extversion FROM pg_extension WHERE extname = 'vector';"
docker compose exec redis redis-cli ping
```

Если менялись `POSTGRES_USER` или `POSTGRES_DB`, подставить их в команду `psql`.
Ожидаются версия расширения `vector` и ответ `PONG`.

Каркас backend можно запустить вместе с PostgreSQL и Redis:

```bash
docker compose up --build -d backend
curl -i http://localhost:8080/health
```

Полный запуск станет доступен после добавления кода frontend и `frontend/Dockerfile`:

```bash
docker compose up --build -d
docker compose ps
docker compose logs -f backend frontend
```

Контракт Dockerfile и конфигурации приложений:

| Сервис | Настройки |
|--------|-----------|
| `backend` | Слушает `0.0.0.0:8080` (`HOST`, `PORT`), читает `DATABASE_URL` и `REDIS_URL`. Запускается после успешных healthcheck PostgreSQL и Redis. |
| `frontend` | Слушает `0.0.0.0:5173`. Dockerfile принимает `ARG VITE_API_BASE_URL` и передаёт его Vite до сборки. Клиент использует `import.meta.env.VITE_API_BASE_URL`. |
| `postgres` | Внутри сети доступен как `postgres:5432`. Расширение `vector` создаётся при первой инициализации БД. |
| `redis` | Внутри сети доступен как `redis:6379`, включено сохранение AOF. |

По умолчанию интерфейс будет доступен по `http://localhost:5173`, API -
`http://localhost:8080` (проверка каркаса: `GET /health`). Для запросов из браузера
backend должен разрешать CORS с адреса frontend. Адреса `backend`, `postgres` и `redis`
используются только внутри Docker-сети. При изменении `BACKEND_PORT` обновить
`VITE_API_BASE_URL` и пересобрать frontend. Особые символы в логине/пароле БД требуют
URL-кодирования в переопределённом `DATABASE_URL`.

`ai-service` и зависимости от него в Compose не добавлены: их добавит Макс.

Остановка с сохранением данных:

```bash
docker compose down
```

Данные хранятся в именованных томах `postgres_data` и `redis_data`. Изменение
`POSTGRES_*` в `.env` не меняет пользователей и базы в уже созданном томе.
SQL из `docker/postgres/init/` выполняется только для новой БД; миграции и seed
приложения должны быть добавлены вместе с backend.
