# Go API

Каркас API на Go 1.27, без внешних Go-зависимостей.

## Локальный запуск

Из каталога `backend`:

```bash
go run ./cmd/api
```

Проверка из другого терминала:

```bash
curl -i http://localhost:8080/health
```

Ожидаются HTTP 200, `Content-Type: application/json` и `{"status":"ok"}`.
`POST /health` возвращает 405, неизвестные пути возвращают 404.
Остановка: Ctrl+C или SIGTERM, до 10 секунд на завершение активных запросов.

## Настройки

| Переменная | Значение по умолчанию | Назначение |
|------------|----------------------|------------|
| `HOST` | `0.0.0.0` | Адрес прослушивания, поддерживается IPv6 |
| `PORT` | `8080` | Порт от 1 до 65535 |
| `LOG_LEVEL` | `INFO` | Уровень JSON-логов: DEBUG, INFO, WARN, ERROR |
| `DATABASE_URL` | пусто | Строка подключения PostgreSQL для будущих интеграций |
| `REDIS_URL` | пусто | Строка подключения Redis для будущих интеграций |

Приложение читает окружение процесса. `.env` автоматически читает только Docker Compose.
Каркас не подключается к БД и Redis; `/health` проверяет только работу HTTP-сервера.
Ошибки настройки и запуска завершают процесс с кодом 1. URL подключений в логи не пишутся.

## Docker

Из корня репозитория, после создания `.env` по примеру:

```bash
docker compose up --build -d backend
curl -i http://localhost:8080/health
docker compose logs backend
```

Compose также поднимет PostgreSQL и Redis. Frontend и AI-сервис не нужны для проверки API.
Dockerfile собирает статический бинарник, запускает его без прав root и устанавливает CA-сертификаты.

## Проверки

Из каталога `backend` (golangci-lint v2):

```bash
go test '-coverprofile=coverage.out' ./...
go tool cover '-func=coverage.out'
go vet ./...
golangci-lint run
```

## Структура

- `cmd/api`: точка входа, сигналы завершения, сборка зависимостей.
- `internal/config`: чтение и проверка env.
- `internal/httpapi`: маршруты и логирование запросов.
- `internal/server`: HTTP-сервер и корректное завершение.
