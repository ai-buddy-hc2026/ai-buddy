# Синтетические пользователи

## Команды

| ID | Название | Руководитель |
|---|---|---|
| `team_1` | Команда 1 | `lead_maria` |
| `team_2` | Команда 2 | `lead_maria` |

## Пользователи

| Логин | Роль | ID команды | Наставник | Руководитель |
|---|---|---|---|---|
| `intern_anya` | `intern` | `team_1` | `buddy_ilya` | `lead_maria` |
| `intern_petr` | `intern` | `team_2` | - | `lead_maria` |
| `buddy_ilya` | `buddy` | `team_1` | - | `lead_maria` |
| `lead_maria` | `lead` | `team_1`, `team_2` | - | - |

## Ограничения доступа

- `intern_anya` и `intern_petr` видят только собственный план и задачи.
- `buddy_ilya` видит план и эскалации стажёров только команды `team_1`.
- `lead_maria` видит тестовые данные обеих команд.
