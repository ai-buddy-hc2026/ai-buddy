# checklist.update_status

Смена статуса задачи. Результат сохраняется в `task_status_history`.

## Вход
| Поле | Тип | Обязательно | Описание |
|---|---|---|---|
| task_id | string | да | Идентификатор задачи |
| status | enum | да | todo, in_progress, blocked, done |

## Выход
```json
{"task_id": "T-7", "status": "done", "previous_status": "in_progress", "updated_at": "2026-11-11T10:15:00Z"}
```

## Права
Стажёр меняет только свои задачи. Наставник и руководитель этим инструментом статусы не меняют.

## Подтверждение
Не требуется: действие обратимо и ограничено своими задачами.

## Ошибки
| Код | Когда |
|---|---|
| policy_denied | чужая задача (HTTP 403) |
| task_not_found | нет такой задачи |
| invalid_status | статус вне списка (HTTP 422) |

## События
`task_status_changed`.
