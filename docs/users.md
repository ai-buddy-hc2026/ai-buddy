# Синтетические пользователи


## Команды

| node | name |
|---|---|
| `team_1` | Team 1 |
| `team_2` | Team 2 |

## Пользователи

| login | display_name | role | team_code | buddy_id | manager_id |
|---|---|---|---|---|---|
| `intern_anya` | Anya | `intern` | `team_1` | `buddy_ilya` | `lead_maria` |
| `buddy_ilya` | Ilya | `buddy` | `team_1` | `NULL` | `lead_maria` |
| `lead_maria` | Maria | `lead` | `team_1` | `NULL` | `NULL` |
| `intern_petr` | Petr | `intern` | `team_2` | `buddy_olga` | `lead_alexey` |
| `buddy_olga` | Olga | `buddy` | `team_2` | `NULL` | `lead_alexey` |
| `lead_alexey` | Alexey | `lead` | `team_2` | `NULL` | `NULL` |

`buddy_id` и `manager_id` хранят ссылки на пользователей той же команды.

## Связи и планы

- `intern_anya` и `intern_petr` получают по одному активному `onboarding_plans`.
- В каждый план попадают задачи чек-листа с уникальными `seed_key`, этапом, позицией,
  ответственным и дедлайном относительно `start_date`.
- Задачи `intern_anya` и `intern_petr` назначаются соответствующему стажёру или его
  наставнику; ссылки на документы базы знаний указываются через `kb_document_id`.
- Для каждого стажёра действует только один активный план.

## Ограничения доступа

- `intern_anya` и `intern_petr` видят только собственный план, задачи и историю чата.
- `buddy_ilya` видит планы и эскалации назначенных стажёров команды `team_1`.
- `buddy_olga` видит планы и эскалации назначенных стажёров команды `team_2`.
- `lead_maria` видит тестовые данные только команды `team_1`.
- `lead_alexey` видит тестовые данные только команды `team_2`.
- Роль, команда и наличие JWT не заменяют проверки владельца, назначения наставника и
  активности пользователя в Go.
