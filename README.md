# AI-buddy

[![Go](https://github.com/ai-buddy-hc2026/ai-buddy/actions/workflows/ci_go_test.yml/badge.svg)](https://github.com/ai-buddy-hc2026/ai-buddy/actions/workflows/ci_go_test.yml)
[![Python](https://github.com/ai-buddy-hc2026/ai-buddy/actions/workflows/ci_ai_service_test.yml/badge.svg)](https://github.com/ai-buddy-hc2026/ai-buddy/actions/workflows/ci_ai_service_test.yml)
[![Python lint](https://github.com/ai-buddy-hc2026/ai-buddy/actions/workflows/ci_linter_ai_service_test.yml/badge.svg)](https://github.com/ai-buddy-hc2026/ai-buddy/actions/workflows/ci_linter_ai_service_test.yml)
[![Integration](https://github.com/ai-buddy-hc2026/ai-buddy/actions/workflows/ci_ai_service_integration_test.yml/badge.svg)](https://github.com/ai-buddy-hc2026/ai-buddy/actions/workflows/ci_ai_service_integration_test.yml)
[![Frontend](https://github.com/ai-buddy-hc2026/ai-buddy/actions/workflows/ci_frontend_test.yml/badge.svg)](https://github.com/ai-buddy-hc2026/ai-buddy/actions/workflows/ci_frontend_test.yml)
[![E2E](https://github.com/ai-buddy-hc2026/ai-buddy/actions/workflows/ci_playwright_e2e.yml/badge.svg)](https://github.com/ai-buddy-hc2026/ai-buddy/actions/workflows/ci_playwright_e2e.yml)

Помощник стажёра Авито для Hack&Change 2026. Показывает план адаптации, отвечает по базе знаний с источниками и готовит действия, которые пользователь подтверждает в интерфейсе. Цель - сократить повторяющиеся вопросы наставнику и помочь пройти первые недели работы. Экономия времени пока не измерена.

Все пользователи, инструкции и заявки синтетические. Это демонстрационный MVP с mock-login, без настоящего SSO и HR-интеграций.

## Возможности и ограничения

| Сценарий | Состояние реализации |
|---|---|
| S-1: онбординг | План, этапы, прогресс, следующий шаг и изменение статуса сохраняются в Go/PostgreSQL. |
| S-2: ответы с источниками | Python ищет по KB после проверки доступа в Go; ответ и редакции источников сохраняются в истории. Нужны доступная LLM и индексация E5. |
| S-3: отгул | Агент предлагает однодневный `day_off`; Go выполняет мок-заявку после подтверждения. Повтор использует сохранённый ключ идемпотентности. |
| S-SEC: права | Go проверяет роль, команду, владельца и назначение. Есть негативные тесты; критерий приёмки - отсутствие утечек на полном наборе атак. |
| S-5: вопрос наставнику | Если в KB нет ответа, Python предлагает стажёру карточку «Вопрос наставнику». Go сам выбирает наставника и контекст беседы, после «Отправить» создаёт эскалацию, она видна у `buddy_ilya`. |
| S-6: ответ наставника | Наставник отвечает на эскалацию из S-5 и явно публикует ответ в KB. Python индексирует опубликованные ответы перед поиском. |

Карта, личные сообщения, события, рост и другие разделы без серверных endpoint показывают демонстрационные данные. Метрики имеют [методику](docs/metrics.md). `GET /analytics/summary` считает их по БД для `lead_maria` (вся команда) и `buddy_ilya` (назначенные стажёры): доля вопросов без наставника, «не знаю», действия, отказы политики, чек-лист и ряд за 7 дней. Экономия времени наставника - оценка по допущению 10 минут на вопрос, а не измеренный эффект. Страница «Аналитика» в режиме API показывает эти данные. Материалы задач пока не загружаются в `task_kb_documents`.

Таблица описывает код, а не успешный результат последнего прогона. Команды проверок приведены ниже. S-5 и S-6 покрыты тестами Go и Python, сквозной прогон в UI нужно повторить перед демо.

## Запуск приложения

Нужны Docker Engine с Linux-контейнерами и Docker Compose. Из корня репозитория в PowerShell, только при отсутствии своего `.env`:

```powershell
Copy-Item .env.example .env
```

В Bash используйте `cp .env.example .env`. В `.env` задайте `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_MODEL` и `LLM_API_KEY` для выбранной модели; пример настройки находится в [AI-service README](ai-service/Readme.md#запуск-с-openai). Сохраните отдельные `JWT_SIGNING_KEY`, `AI_SERVICE_TOKEN`, `MCP_SERVICE_TOKEN` и `VITE_API_BASE_URL=/api`. Секреты не коммитятся.

```bash
docker compose config --quiet
docker compose up --build -d frontend backend ai-service
docker compose ps
```

Откройте [интерфейс](http://localhost:5173). Выберите `intern_anya`; наставник - `buddy_ilya`, руководитель - `lead_maria`. Для проверки границ есть `intern_petr` из другой команды. Полные связи и UUID: [пользователи](docs/users.md).

`db-init` применяет миграции и seed до запуска Go: 2 команды, 6 пользователей, 2 плана, 30 задач. Python загружает модель `intfloat/multilingual-e5-base` и индексирует `seed/kb`; первый запуск требует времени и доступа к весам модели. Чат требует работающего провайдера LLM. При его отказе панель и история остаются доступны, а чат сообщает об ошибке.

```bash
docker compose logs --tail 50 backend ai-service frontend
docker compose down
```

Остановка сохраняет именованные тома. Изменение `.env` требует пересоздания соответствующих контейнеров, а не только restart. Изменение `POSTGRES_*` не изменяет пользователей уже созданной БД. Адреса `backend`, `postgres`, `redis` доступны внутри Docker-сети; браузер обращается через nginx `/api`. `GET /health` подтверждает только работу HTTP-сервера.

Локальный frontend без Docker работает на порту 3000; инструкции и отличие демо-режима от API: [frontend README](frontend/README.md).

## Демонстрация на 3-5 минут

1. Войти как `intern_anya`, показать план, изменить свою задачу и перезагрузить страницу.
2. Спросить о code review, показать постепенный ответ, источник и пометку тестовой инструкции. Предварительно дождаться индексации KB.
3. Попросить отгул на дату не раньше чем через 3 календарных дня по часовому поясу команды. Проверить карточку и подтвердить отправку. Показать внешний ID и `pending_approval` в истории после перезагрузки.
4. Попросить чужие данные и показать отказ. Для доказательства серверных проверок использовать S-SEC, а не только текст ответа модели.
5. Задать вопрос вне KB, получить «не знаю» и карточку «Вопрос наставнику», нажать «Отправить». Войти как `buddy_ilya`, ответить на вопрос и опубликовать ответ в KB. Объяснить, какие экраны показывают демонстрационные данные.

Требования ко всей приёмке, включая сбои и повторное выполнение: [MVP](docs/mvp.md). Видео, PDF-презентация и отчёт о прохождении должны быть подготовлены перед сдачей; этот README не подтверждает их наличие.

## Архитектура

| Часть | Ответственность |
|---|---|
| `backend/`, Go | Внешний API, JWT, права, история, SSE, MCP и выполнение подтверждённых действий. |
| `ai-service/`, Python | Агент, LLM, RAG, E5 и публикация событий через Redis. |
| `frontend/`, React + TypeScript | Интерфейс стажёра и наставника, HTTP/SSE, подтверждения. |
| PostgreSQL + pgvector | Пользователи, планы, задачи, чат, действия, KB, векторы и события. |
| Redis | Временные данные и Pub/Sub; постоянная история хранится в PostgreSQL. |

## Проверки

- [Go: тесты, интеграция и линтер](backend/README.md#проверки).
- [Python: тесты и покрытие](ai-service/Readme.md#проверки).
- [Frontend: Vitest, сборка и Playwright с Go](frontend/README.md#проверки).
- [30 вопросов](tests/eval/questions.md) и [10 атак](tests/eval/attacks.md) для оценки качества.

`compose.test.yml` дополняет основной Compose синтетическим HTTP-провайдером LLM для сквозных проверок. `docker-compose.test.yml` - отдельное окружение Python-интеграционных тестов. Тестовые команды и ограничения приведены в README сервисов. Наличие тестов не означает достигнутого покрытия: нужен воспроизводимый отчёт для проверяемого коммита.

## Документация

| Вопрос | Документ |
|---|---|
| Требования организаторов и состав сдачи | [Кейс](docs/requirements/case.md) |
| Объём MVP и критерии | [MVP](docs/mvp.md), [сценарии](specs/agent.md) |
| HTTP API | [OpenAPI](docs/openapi.yaml) |
| Go/Python и SSE | [Контракт](docs/ai-contract.md) |
| MCP, права и схемы | [MCP](docs/mcp-contract.md), [инструменты](specs/tools/README.md) |
| Хранение | [БД](docs/db.md), [события](docs/events.md) |
| Действия и помощь наставника | [Действия](docs/activity.md) |
| Данные | [Пользователи](docs/users.md), [чек-лист](docs/checklist.md) |
| Оценка пользы | [Метрики](docs/metrics.md) |
| Разработка и вклад | [CONTRIBUTING](CONTRIBUTING.md), [AGENTS](AGENTS.md) |
