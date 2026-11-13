# Frontend AI-buddy

Интерфейс стажёра и наставника: React, TypeScript, Vite, TanStack Router/Query, Zustand и Zod.

## Запуск

Нужен Node.js 24.15 или новее в ветке 24, как в Docker и CI.

```bash
cd frontend
npm ci
npm run dev
```

Откроется `http://localhost:3000`. Без `VITE_API_BASE_URL` работает демо с синтетическими данными в localStorage.

Для Go API скопируйте `frontend/.env.example` в `frontend/.env.local`:

```dotenv
VITE_API_BASE_URL=/api
VITE_PROXY_TARGET=http://localhost:8080
```

Vite проксирует `/api/*` в Go без префикса, включая SSE и Bearer-заголовок. Ошибки backend показываются пользователю; автоматического переключения на моки при отказе API нет.

Через backend работают вход и профиль, план и статусы задач, чат и история, предложения и подтверждения действий, список стажёров, вопросы наставнику и публикация ответа, поиск KB. Карта, личные сообщения, события, рост и другие разделы без серверных endpoint остаются демонстрационными.

## Проверки

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:coverage
npm run build
```

Vitest проверяет логику, адаптеры HTTP/SSE и React-компоненты. Для сквозных проверок используется настоящий Go API с синтетическим LLM-провайдером.

Из корня репозитория:

```bash
docker compose --env-file .env.example -f docker-compose.yml -f compose.test.yml up --build -d --wait backend ai-service mock-llm
```

Затем из `frontend`:

```bash
npx playwright install chromium
npm run test:e2e
```

Playwright запускает Vite на `127.0.0.1:3000` в реальном API-режиме. Проект `api` проверяет серверные сценарии S-3/S-SEC; проект `ui` проверяет вход, изменение задачи, чат, подтверждение действия, восстановление истории и смену пользователя без подмены fetch. Backend по умолчанию ожидается на `127.0.0.1:8080`; другой адрес задаётся через `PLAYWRIGHT_API_URL`. Порт 3000 должен быть свободен.

## Docker

```bash
docker compose --env-file .env.example up --build -d frontend backend ai-service
```

Образ собирает frontend в реальном режиме (`VITE_API_BASE_URL=/api`). Nginx на порту 5173 отдаёт SPA и проксирует API к backend без буферизации SSE.

## Структура

| Папка             | Назначение                                |
| ----------------- | ----------------------------------------- |
| `src/app/`        | Маршруты, оболочка и провайдеры           |
| `src/entities/`   | Модели, контракт Go API и адаптеры        |
| `src/features/`   | Экраны и пользовательские сценарии        |
| `src/shared/api/` | HTTP-клиент, токен и поток SSE            |
| `src/shared/ui/`  | Общие компоненты                          |
| `e2e/`            | Playwright против настоящего backend и UI |
