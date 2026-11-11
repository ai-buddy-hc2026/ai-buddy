# Frontend AI-buddy

Интерфейс стажёра и наставника.

Стек: Vite, React 19, TypeScript, TanStack Router, TanStack Query, Zustand, Zod, ESLint, Prettier.

## Запуск

```bash
cd frontend
npm ci
npm run dev
```

Откроется `http://localhost:5173`. Адрес API берётся из `VITE_API_BASE_URL` (по умолчанию `http://localhost:8080`).

## Команды

| Команда                | Что делает                         |
| ---------------------- | ---------------------------------- |
| `npm run dev`          | Dev-сервер с горячей перезагрузкой |
| `npm run build`        | Проверка типов и сборка в `dist/`  |
| `npm run lint`         | ESLint                             |
| `npm run format`       | Prettier, исправляет файлы         |
| `npm run format:check` | Prettier, только проверка (для CI) |
| `npm run typecheck`    | Проверка типов                     |

## Docker

Образ собирает статику и раздаёт её через nginx на порту `5173`.

```bash
docker build -t ai-buddy-frontend ./frontend
docker run --rm -p 127.0.0.1:5173:5173 ai-buddy-frontend
```

В общем `docker compose up` фронт поднимется вместе с остальными сервисами, когда у backend появится Dockerfile.

## Структура

| Папка             | Что внутри                                         |
| ----------------- | -------------------------------------------------- |
| `src/api/`        | Zod-схемы, заглушки данных, запросы TanStack Query |
| `src/store/`      | Zustand: сессия пользователя                       |
| `src/components/` | Шапка, панель «Мой онбординг», чат                 |
| `src/pages/`      | Страницы                                           |
| `src/router.tsx`  | Маршруты TanStack Router                           |

Сейчас данные - заглушки из `src/api/mocks.ts`. Когда появится `docs/openapi.yaml`, схемы сверим с контрактом и заменим заглушки на запросы к API.
