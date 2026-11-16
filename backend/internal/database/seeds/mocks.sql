-- Синтетические данные моков корпоративных систем. Существующие записи сохраняются.
-- Коды сотрудников совпадают с id карточек фронта (frontend/src/entities/employees.ts).
INSERT INTO corp_employees (code, team_id, user_id, name, title, kind, tags, ask_about, birthday, desk_id, first_day) VALUES
    ('anya', '4496e76d-35da-5cf7-a3d5-c9a89d88c5a2', 'a24a3478-cf42-51b1-b05b-9833260247a5', 'Аня Тестова', 'Стажёр Backend', 'intern', '{}', '', '03-21', 'desk-anya',
     '{"time":"10:00","place_id":"lift","address":"Тестовый офис, 3 этаж","contact_code":"ilya","bring":["паспорт","ноутбук не нужен"]}'),
    ('ilya', '4496e76d-35da-5cf7-a3d5-c9a89d88c5a2', '4a59a828-3b1a-55e4-bf9b-81db5ad6183a', 'Илья Наставников', 'Senior Backend, наставник', 'mentor',
     '{code review,архитектура,онбординг,go}', 'Code review, архитектура сервисов, любые вопросы по онбордингу', '06-02', 'desk-ilya', NULL),
    ('maria', '4496e76d-35da-5cf7-a3d5-c9a89d88c5a2', '10000000-0000-0000-0000-000000000003', 'Мария Руководова', 'Руководитель команды', 'lead',
     '{отгулы,отпуск,цели,экватор}', 'Отгулы и отпуска, цели на стажировку, экватор и оффер', NULL, 'desk-maria', NULL),
    ('oleg', '4496e76d-35da-5cf7-a3d5-c9a89d88c5a2', NULL, 'Олег Деплоев', 'DevOps команды', 'colleague',
     '{деплой,ci,мониторинг,grafana,k8s,доступы}', 'CI, деплой, мониторинг в Grafana, доступы к k8s', '11-20', 'desk-oleg', NULL),
    ('sveta', '4496e76d-35da-5cf7-a3d5-c9a89d88c5a2', NULL, 'Света Аналитикова', 'Продуктовый аналитик', 'colleague',
     '{метрики,аналитика,a/b,данные}', 'Метрики, A/B-тесты, где взять тестовые данные', '11-12', 'desk-sveta', NULL),
    ('timur', '4496e76d-35da-5cf7-a3d5-c9a89d88c5a2', NULL, 'Тимур Тестировщиков', 'QA-инженер', 'colleague',
     '{тесты,стенды,баги,автотесты}', 'Тестовые стенды, автотесты, как заводить баги', '01-15', NULL, NULL),
    ('dasha', NULL, NULL, 'Даша Эйчарова', 'HR BP', 'hr',
     '{документы,дмс,оффер,программа стажировки}', 'Документы, ДМС, программа стажировки, оффер', '08-09', 'desk-dasha', NULL),
    ('petr', 'e5aba0fd-91e6-59e4-a046-7960848af1a2', '2db7cc77-4114-52d8-a833-f670ab60e4e0', 'Петр Стажёров', 'Стажёр Backend', 'intern', '{}', '', '04-04', NULL,
     '{"time":"11:00","place_id":"lift","address":"Тестовый офис, 3 этаж","contact_code":"olga","bring":["паспорт"]}'),
    ('olga', 'e5aba0fd-91e6-59e4-a046-7960848af1a2', '0f8153be-1c96-5e0f-aa4c-55b7ed7bf47a', 'Ольга Наставникова', 'Backend, наставник', 'mentor',
     '{code review,онбординг,python}', 'Code review и вопросы по онбордингу', '02-14', NULL, NULL),
    ('alexey', 'e5aba0fd-91e6-59e4-a046-7960848af1a2', '10000000-0000-0000-0000-000000000006', 'Алексей Лидов', 'Руководитель команды', 'lead',
     '{отгулы,отпуск,цели}', 'Отгулы, отпуска и цели на стажировку', NULL, NULL, NULL)
ON CONFLICT (code) DO NOTHING;

INSERT INTO map_places (id, floor, kind, name, aliases, x, y, w, d, employee_code, node_id) VALUES
    ('lift', 3, 'lift', 'Лифты', '{лифт,лифты,выход}', 0, 3, 1, 2, NULL, 'n-lift'),
    ('kitchen', 3, 'kitchen', 'Кухня', '{кухня,кофе,кофемашина,еда,обед}', 2, 0, 3, 2, NULL, 'n-kitchen'),
    ('room-baikal', 3, 'room', 'Переговорка Байкал', '{байкал,переговорка байкал}', 8, 0, 2, 2, NULL, 'n-baikal'),
    ('room-altai', 3, 'room', 'Переговорка Алтай', '{алтай,переговорка алтай}', 11, 0, 2, 2, NULL, 'n-altai'),
    ('medical', 3, 'medical', 'Медпункт', '{медпункт,врач,аптечка}', 0, 7, 2, 2, NULL, 'n-medical'),
    ('desk-anya', 3, 'desk', 'Стол Ани', '{}', 6, 5, 1, 1, 'anya', 'n-desks'),
    ('desk-ilya', 3, 'desk', 'Стол Ильи', '{}', 7, 5, 1, 1, 'ilya', 'n-desks'),
    ('desk-sveta', 3, 'desk', 'Стол Светы', '{}', 6, 7, 1, 1, 'sveta', 'n-south'),
    ('desk-oleg', 3, 'desk', 'Стол Олега', '{}', 7, 7, 1, 1, 'oleg', 'n-south'),
    ('desk-maria', 3, 'desk', 'Стол Марии', '{}', 11, 5, 1, 1, 'maria', 'n-lead'),
    ('desk-dasha', 3, 'desk', 'Стол Даши', '{}', 12, 7, 1, 1, 'dasha', 'n-lead')
ON CONFLICT (id) DO NOTHING;

INSERT INTO learning_courses (code, title, required, due_days, minutes) VALUES
    ('security-basics', 'Информационная безопасность', true, 7, 40),
    ('code-of-conduct', 'Кодекс поведения', true, 7, 20),
    ('git-flow', 'Git и код-ревью в команде', true, 14, 60),
    ('product-intro', 'Как устроен продукт', false, 21, 45)
ON CONFLICT (code) DO NOTHING;

INSERT INTO access_systems (code, title, about, approver_code, grant_after_sec) VALUES
    ('gitlab', 'GitLab', 'Код и мёрдж-реквесты', 'ilya', 10),
    ('vpn', 'VPN', 'Работа вне офиса', 'oleg', 10),
    ('confluence', 'Confluence', 'База знаний команды', 'ilya', 10),
    ('jira', 'Jira', 'Задачи и доска команды', 'maria', 15),
    ('k8s-dev', 'k8s-dev', 'Тестовый кластер', 'oleg', NULL),
    ('grafana', 'Grafana', 'Дашборды и алерты', 'oleg', 5),
    ('kafka-ui', 'Kafka UI', 'Топики и сообщения', 'oleg', 25)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_access_templates (role, system_code) VALUES
    ('intern', 'gitlab'), ('intern', 'vpn'), ('intern', 'confluence'), ('intern', 'jira'), ('intern', 'k8s-dev'), ('intern', 'grafana'),
    ('buddy', 'gitlab'), ('buddy', 'vpn'), ('buddy', 'confluence'), ('buddy', 'jira'), ('buddy', 'k8s-dev'), ('buddy', 'grafana'), ('buddy', 'kafka-ui'),
    ('lead', 'gitlab'), ('lead', 'vpn'), ('lead', 'confluence'), ('lead', 'jira')
ON CONFLICT DO NOTHING;

-- Приёмные часы на ближайшие две недели (будни). ID детерминированы: повторный запуск не дублирует слоты.
INSERT INTO calendar_slots (id, host_code, starts_at, minutes)
SELECT md5(h.code || ':' || ts::text)::uuid, h.code, ts, 30
FROM (VALUES ('ilya', time '15:00'), ('ilya', time '11:00'), ('maria', time '12:00'), ('dasha', time '11:30'), ('olga', time '14:00'), ('alexey', time '16:00')) AS h(code, at)
CROSS JOIN generate_series(1, 14) AS d(n)
CROSS JOIN LATERAL (SELECT ((current_date + d.n)::timestamp + h.at) AT TIME ZONE 'Europe/Moscow' AS ts) AS t
WHERE extract(isodow FROM current_date + d.n) < 6
ON CONFLICT DO NOTHING;
